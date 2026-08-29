import type { SeedConfig } from "@/backend/db/seeds/lib";
import { logger } from "@/backend/lib/logger";
import { PlanCatalogService } from "@/backend/services";
import type { DBTransaction, PlanReturnType, PlanSubmitInput } from "@/backend/types";

/**
 * Demo plan-catalog seeder — provisions the frozen demo catalog (Task 1.5
 * seed contract, REQ-019/REQ-021) EXCLUSIVELY through `PlanCatalogService`.
 *
 * Per `backend/db/seeds/AGENTS.md` (Service-Only Data Access):
 *  - No `@/backend/db/**` imports — every read and write goes through the
 *    service namespace (`listForAdmin` / `createPlan` / `setPlanActiveStatus`).
 *  - Idempotency via find-or-create keyed on the stable `plans.title` value.
 *    `createPlan` tolerates duplicate titles by design (no unique key), so
 *    this look-before-create guard is the ONLY idempotency mechanism.
 *  - The deactivated demo plan is provisioned in two service calls
 *    (`createPlan` then `setPlanActiveStatus(id, false, "en")`) because
 *    `PlanSubmitInput` structurally excludes lifecycle columns — there is no
 *    service path to create a plan pre-deactivated. On re-run the row is
 *    found by title and must NOT be re-activated (INV-PC1 demo visibility).
 *  - Carries no credentials and performs no users/roles writes (3.5.SEC).
 *
 * The optional `tx` is propagated verbatim to every service call so a
 * caller-owned atomic flow (e.g. the `runInRollback` idempotency test) stays
 * atomic; the seed runner itself calls this without a transaction.
 */

/** Frozen demo-catalog fixture spec (Task 1.5 contract table). */
export interface DemoPlanSpec {
  /** Stable title — the idempotency key; frozen by the Task 1.5 contract. */
  title: string;
  sessionCount: number;
  /** Decimal string, never a number (PlanSubmitInput contract). */
  price: string;
  currency: string;
  intervalDays: number;
  /** Target lifecycle state after bootstrap; `false` deactivates after create. */
  active: boolean;
}

/**
 * The demo catalog. Titles and the verification plan's `sessionCount = 5`
 * (FR-2.3) are FROZEN parity keys; commercial values are the declared
 * Task 1.5 defaults for determinism.
 */
export const DEMO_PLAN_CATALOG: readonly DemoPlanSpec[] = [
  {
    title: "Hifz Jadid — Full Memorization Plan",
    sessionCount: 8,
    price: "250.00",
    currency: "EGP",
    intervalDays: 30,
    active: true,
  },
  {
    title: "Tajweed Mastery",
    sessionCount: 4,
    price: "150.00",
    currency: "EGP",
    intervalDays: 30,
    active: true,
  },
  {
    title: "New Teacher Verification & Evaluation Plan",
    sessionCount: 5,
    price: "0.00",
    currency: "EGP",
    intervalDays: 30,
    active: true,
  },
  {
    title: "Legacy Tajweed Plan 2025",
    sessionCount: 4,
    price: "90.00",
    currency: "EGP",
    intervalDays: 30,
    active: false,
  },
] as const;

/** Title of the cross-ticket verification plan (FR-2.3 / REQ-019 lookup constant). */
export const VERIFICATION_PLAN_TITLE = "New Teacher Verification & Evaluation Plan";

/**
 * Seeds (or retrieves) the demo plan catalog.
 *
 * `_config` is accepted for seeder-signature parity with the master
 * controller convention (`seedOrGetUsers(seedConfig)`); this seeder carries
 * no credentials, so the config is deliberately unused (3.5.SEC).
 *
 * @param config Unused — see above (signature parity only).
 * @param tx    Optional transaction propagated to every service call.
 * @returns The seeded or retrieved demo plans, in fixture order.
 */
export async function seedOrGet(_config?: SeedConfig, tx?: DBTransaction): Promise<PlanReturnType[]> {
  logger.info("Seeding demo plan catalog via PlanCatalogService...");
  const locale = "en";

  // Look-before-create: one admin listing (includes inactive) covers all
  // exact-title lookups. `listForAdmin(true, ...)` is the service's only
  // read surface that sees deactivated rows too — required so the
  // deactivated demo is found (and never re-created or re-activated).
  const existing = await PlanCatalogService.listForAdmin(true, locale, tx);
  const existingByTitle = new Map(existing.map(plan => [plan.title, plan]));

  const results: PlanReturnType[] = [];
  let createdCount = 0;
  let reusedCount = 0;

  // Sequential bootstrap (deterministic fixture order, one write at a time)
  // via the reduce-chaining idiom mandated by the repo's no-await-in-loop
  // rule — the same pattern `users/seed-users.ts` uses.
  await DEMO_PLAN_CATALOG.reduce<Promise<void>>(async (previous, spec) => {
    await previous;

    const found = existingByTitle.get(spec.title);
    if (found) {
      // Found by stable title — reuse as-is. Deliberately NO lifecycle
      // write here: an already-inactive demo plan must stay inactive.
      results.push(found);
      reusedCount += 1;
    } else {
      const submission: PlanSubmitInput = {
        title: spec.title,
        sessionCount: spec.sessionCount,
        price: spec.price,
        currency: spec.currency,
        intervalDays: spec.intervalDays,
      };
      // System seeding is ACTORLESS (no admin session to attribute): the
      // undefined actorId keeps the catalog service's logger marker alone
      // and writes NO audit row — DEV3-020 audit rows require a real actor.
      const created = await PlanCatalogService.createPlan(submission, locale, undefined, tx);
      createdCount += 1;

      // An inactive fixture deactivates through the same guarded transition
      // admin actions use — there is no create-pre-deactivated service path.
      results.push(
        spec.active ? created : await PlanCatalogService.setPlanActiveStatus(created.id, false, locale, undefined, tx)
      );
    }
  }, Promise.resolve());

  logger.info(`Demo plan catalog seeding completed (${createdCount} created, ${reusedCount} reused).`);
  return results;
}
