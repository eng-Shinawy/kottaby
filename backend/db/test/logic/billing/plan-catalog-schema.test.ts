/**
 * `plans` table lifecycle-columns schema tests — information_schema probes
 * plus CHECK-constraint boundary writes against the live PostgreSQL
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY direct
 *    Drizzle query.
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and never used here.
 *  - No entity-setup helpers apply: this suite probes table structure and
 *    constraint behavior directly (inserts are rolled back with the tx).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): information_schema reports `is_active`
 *    (NOT NULL, boolean default true) and `deactivated_at` (nullable, no
 *    default).
 *  - Tier 1 also pins the durable lifecycle-pair invariant (REQ-014/015):
 *    every persisted row satisfies `is_active = (deactivated_at IS NULL)` —
 *    the pair moves together through the guarded transition primitive.
 *    (The migration-moment backfill itself — all rows active at push time —
 *    is a point-in-time property that a shared dev database outlives: the
 *    seed suite legitimately creates a deactivated demo plan, so an
 *    "every row is active" assertion would be unsound here.)
 *  - Tier 2 (boundary): direct INSERT violating session_count = 0 and
 *    price < 0 each raise the corresponding check_violation (23514) with
 *    the exact constraint name.
 *  - Tier 3 (chaos/concurrency entry-point for the catalog admin work):
 *    direct INSERT with interval_days = 0 is also rejected; a valid minimal
 *    insert confirms the lifecycle columns default server-side
 *    (`is_active = true`, `deactivated_at` null) with no client input.
 */

import { describe, expect, test } from "bun:test";
import { or, sql } from "drizzle-orm";
import { plans } from "@/backend/db/schema/billing/plans";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL error code for `check_violation`. */
const PG_CHECK_VIOLATION = "23514";

interface PlanColumnRow {
  column_name: string;
  is_nullable: string;
  column_default: string | null;
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given property/value pair — Drizzle
 * wraps driver errors behind its own generic "failed query" message. Mirrors
 * the established traversal precedent in
 * `backend/db/test/logic/teachers/applicant-lifecycle.test.ts`
 * (`hasPostgresErrorCode`) and `isUniqueViolation` in
 * `backend/services/auth/registration.service.ts`.
 */
function pgErrorCarries(error: unknown, key: "code" | "constraint", value: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (key === "code" && "code" in current && current.code === value) {
      return true;
    }
    if (key === "constraint" && "constraint" in current && current.constraint === value) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Normalizes driver-specific result shapes: bare row array vs `{ rows }` envelope. */
function extractRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && "rows" in value && Array.isArray(value.rows)) {
    return value.rows;
  }
  return [];
}

/**
 * Independent structural oracle — direct information_schema probe on the
 * same tx (not routed through the Drizzle schema), normalizing the
 * driver-specific result shape defensively (no unsafe type assertions).
 */
async function probePlanColumns(tx: DBTransaction): Promise<PlanColumnRow[]> {
  const raw: unknown = await tx.execute(sql`
    select column_name, is_nullable, column_default
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'plans'
      and column_name in ('is_active', 'deactivated_at')
  `);

  return extractRows(raw).flatMap(row => {
    if (!isRecord(row) || typeof row.column_name !== "string") return [];
    return [
      {
        column_name: row.column_name,
        is_nullable: typeof row.is_nullable === "string" ? row.is_nullable : "",
        column_default: typeof row.column_default === "string" ? row.column_default : null,
      },
    ];
  });
}

describe("plans schema — lifecycle columns", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("information_schema reports is_active NOT NULL with a boolean true default", async () => {
    await runInRollback(async tx => {
      const columns = await probePlanColumns(tx);
      const isActive = columns.find(c => c.column_name === "is_active");
      if (!isActive) throw new Error("expected is_active column to exist");
      expect(isActive.is_nullable).toBe("NO");
      expect(isActive.column_default).toMatch(/true/);
    });
  });

  test("information_schema reports deactivated_at nullable with no default", async () => {
    await runInRollback(async tx => {
      const columns = await probePlanColumns(tx);
      const deactivatedAt = columns.find(c => c.column_name === "deactivated_at");
      if (!deactivatedAt) throw new Error("expected deactivated_at column to exist");
      expect(deactivatedAt.is_nullable).toBe("YES");
      expect(deactivatedAt.column_default).toBeNull();
    });
  });

  test("every persisted row satisfies the lifecycle-pair invariant: is_active = (deactivated_at IS NULL)", async () => {
    await runInRollback(async tx => {
      const drifted = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(
          or(
            // Active rows must have NO deactivation timestamp...
            sql`${plans.isActive} = true AND ${plans.deactivatedAt} IS NOT NULL`,
            // ...and inactive rows MUST carry one (set exactly once by the
            // guarded transition primitive — never hand-cleared).
            sql`${plans.isActive} = false AND ${plans.deactivatedAt} IS NULL`
          )
        );
      expect(drifted).toHaveLength(0);
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("direct insert with session_count=0 violates plans_session_count_check", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() =>
        tx.insert(plans).values({
          title: "Boundary Probe — zero sessions",
          sessionCount: 0,
          price: "10.00",
          intervalDays: 30,
        })
      );

      expect(pgErrorCarries(error, "code", PG_CHECK_VIOLATION)).toBe(true);
      expect(pgErrorCarries(error, "constraint", "plans_session_count_check")).toBe(true);
    });
  });

  test("direct insert with price<0 violates plans_price_check", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() =>
        tx.insert(plans).values({
          title: "Boundary Probe — negative price",
          sessionCount: 5,
          price: "-0.01",
          intervalDays: 30,
        })
      );

      expect(pgErrorCarries(error, "code", PG_CHECK_VIOLATION)).toBe(true);
      expect(pgErrorCarries(error, "constraint", "plans_price_check")).toBe(true);
    });
  });

  // ─── Tier 3: chaos/concurrency entry-point ──────────────────────────

  test("direct insert with interval_days=0 violates plans_interval_days_check", async () => {
    await runInRollback(async tx => {
      const error = await expectRepoError(() =>
        tx.insert(plans).values({
          title: "Chaos Probe — zero interval",
          sessionCount: 5,
          price: "10.00",
          intervalDays: 0,
        })
      );

      expect(pgErrorCarries(error, "code", PG_CHECK_VIOLATION)).toBe(true);
      expect(pgErrorCarries(error, "constraint", "plans_interval_days_check")).toBe(true);
    });
  });

  test("valid minimal insert defaults lifecycle server-side (is_active=true, deactivated_at null)", async () => {
    await runInRollback(async tx => {
      const [row] = await tx
        .insert(plans)
        .values({
          title: "Lifecycle Default Probe",
          sessionCount: 5,
          price: "10.00",
          intervalDays: 30,
        })
        .returning();

      if (!row) throw new Error("expected inserted plan row");
      expect(row.isActive).toBe(true);
      expect(row.deactivatedAt).toBeNull();
      expect(row.currency).toBe("EGP");
    });
  });
});
