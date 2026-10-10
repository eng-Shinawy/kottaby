/**
 * Plan-catalog residual probes — plan rows are never hard-deleted by the
 * application surface.
 *
 * The write surface of the `plans` table is deliberately delete-free: the
 * repository namespace exposes insert, field-update, and the deactivation
 * transition only. The GraphQL SDL pins its own no-deletePlan mutation in
 * the schema-surface suite (`backend/graphql/test/plan-catalog.schema.test.ts`)
 * — deliberately not duplicated here — and the deactivation semantics
 * (is_active flip + deactivated_at) are owned by the plan-catalog
 * service/repository suites.
 *
 * The database tier itself carries no delete guard for plans: the only
 * restrict referencer is the subscriptions plan FK (`lessons.plan_id` is
 * set-null). This suite pins exactly that shipped reality — the writer
 * absence, the FK backstop that protects referenced plans, and the
 * documented accepted boundary that an unreferenced plan row is deletable
 * via raw SQL (the deactivation transition is the sanctioned retirement
 * path, never a hard delete).
 *
 * RESTRICT semantics note: the SQLSTATE of an `ON DELETE RESTRICT`
 * rejection is server-version dependent — PostgreSQL 18+ reports
 * `restrict_violation` (23001) per the SQL standard, while PG ≤ 17 (and
 * PGlite) report the generic `foreign_key_violation` (23503). The probe
 * accepts either code and disambiguates via the live constraint name
 * generated for the single-column reference:
 * `subscriptions_plan_id_plans_id_fkey`.
 */
import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { createTestPlan, createTestSubscription, createTestUser } from "@/backend/db/test/entity-setup";
import { probeInsideSavepoint } from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { hasPostgresRestrictCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, runInRollback } from "@/backend/db/test/test-utils";

/** Repository source, resolved relative to this test file (caller-cwd independent). */
const PLAN_REPOSITORY_SOURCE = join(__dirname, "..", "..", "..", "repo", "billing", "plan.repository.ts");

/** The live single-column reference name Drizzle generated for `subscriptions.plan_id`. */
const SUBSCRIPTIONS_PLAN_FK = "subscriptions_plan_id_plans_id_fkey";

/**
 * Walks the Drizzle cause chain searching for an `Error.message` containing
 * the given substring — the PostgreSQL diagnostic (which names the rejecting
 * constraint) is reachable only through the wrapped driver error.
 */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Asserts the caught error is the subscriptions restrict FK firing on a
 * plan delete: the FK rejection SQLSTATE (23001 on PG ≥ 18, 23503 on
 * PG ≤ 17 — see `hasPostgresRestrictCode`), the live constraint name on
 * the error object, and the same name in the cause-chain text.
 */
function expectPlanRestrictViolation(error: Error): void {
  expect(hasPostgresRestrictCode(error)).toBe(true);
  expect(constraintNameOf(error)).toBe(SUBSCRIPTIONS_PLAN_FK);
  expect(causeChainContainsMessage(error, SUBSCRIPTIONS_PLAN_FK)).toBe(true);
}

describe("plan-catalog invariants — plans are never hard-deleted", () => {
  test("INV-PC3: PlanRepository exposes no delete method (writer-absence source pin)", async () => {
    // Live namespace enumeration — the complete exported surface, so a
    // delete primitive cannot hide behind any naming variant.
    const exposed = Object.keys(PlanRepository).toSorted((a, b) => a.localeCompare(b));
    expect(exposed).toEqual([
      "existsById",
      "findActiveById",
      "findBalanceLanesByIds",
      "findById",
      "findByIds",
      "insertPlan",
      "listActive",
      "listAll",
      "setActiveStatusOnce",
      "updatePlanFields",
    ]);
    expect(exposed.some(name => /delete|remove/i.test(name))).toBe(false);

    // Source scan — the repository module never reaches for the Drizzle
    // delete builder in any form, comment included.
    const source = await readFile(PLAN_REPOSITORY_SOURCE, "utf-8");
    expect(source).not.toContain("delete");
    expect(source).not.toContain("remove");
  });

  test("INV-PC3: a referenced-plan raw DELETE is rejected by the subscriptions_plan_id_plans_id_fkey restrict FK (SQLSTATE 23001 on PG≥18, 23503 on PG≤17); an unreferenced-plan DELETE succeeds then rolls back", async () => {
    await runInRollback(async tx => {
      // Referenced leg — a subscription row pins the plan through the
      // restrict FK: the raw delete cannot cross it.
      const user = await createTestUser(tx);
      const referencedPlan = await createTestPlan(tx);
      await createTestSubscription(tx, user.id, referencedPlan.id);

      const error = await probeInsideSavepoint(tx, "referenced plan delete", () =>
        tx.delete(plans).where(eq(plans.id, referencedPlan.id))
      );
      expectPlanRestrictViolation(error);

      // The savepoint rollback restored a queryable transaction — the
      // rejected delete left the referenced plan row intact.
      const survived = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, referencedPlan.id));
      expect(survived).toHaveLength(1);

      // Unreferenced leg — the accepted design boundary: no database guard
      // exists for plans, so a raw DELETE of an unreferenced row
      // succeeds. The enclosing rolled-back transaction discards it; only
      // the app-layer writer absence (previous test) keeps production
      // off this path.
      const unreferencedPlan = await createTestPlan(tx);
      await tx.delete(plans).where(eq(plans.id, unreferencedPlan.id));
      const gone = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, unreferencedPlan.id));
      expect(gone).toHaveLength(0);
    });
  });
});
