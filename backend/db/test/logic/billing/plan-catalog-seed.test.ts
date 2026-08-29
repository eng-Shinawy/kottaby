/**
 * Demo plan-catalog seed idempotency tests (Task 3.5.TE) — verifies the
 * Task 1.5 seed-contract parity keys against the live `kottab_test`
 * PostgreSQL instance.
 *
 * The bootstrap runs TWICE inside `runInRollback` (per
 * `backend/db/test/AGENTS.md`): `tx` is propagated into every service call,
 * so nothing commits and the non-transactional pool path stays unexercised.
 * The seeder passes a literal locale ("en") — per Rule 19,
 * `getServerTranslations` never appears in test scaffolding.
 *
 * Parity assertions (Task 1.5 contract → 3.5.TE):
 *  1. Run 1 provisions exactly the four frozen titles with the contract
 *     values; the verification plan has `sessionCount === 5` (FR-2.3).
 *  2. Exactly one fixture is inactive, with `deactivatedAt` set, and it is
 *     excluded from `listActiveCatalog` (INV-PC1 at seed level).
 *  3. Run 2 is a no-op: identical ids per title, unchanged admin-listing row
 *     count (relative to the post-run-1 snapshot), no duplicate titles.
 *  4. The deactivated demo is NOT re-activated (nor re-deactivated) by
 *     run 2 — its lifecycle columns are byte-identical across runs.
 *  5. Import hygiene (3.5.SEC/IV): the seed module contains no
 *     `@/backend/db/**` (schema/repo) or `drizzle-orm` imports — the
 *     service-bootstrap rule is enforced statically here.
 *
 * Note: assertions are RELATIVE to the pre-test baseline because the dev
 * database legally contains additional committed plan rows (find-or-create
 * is global). Only demo-title uniqueness and count stability across the two
 * runs are absolute.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO_PLAN_CATALOG, seedOrGet, VERIFICATION_PLAN_TITLE } from "@/backend/db/seeds/billing/seed-plan-catalog";
import { runInRollback } from "@/backend/db/test/test-utils";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

const LOCALE = "en";

/** The frozen demo titles (fixture order preserved). */
function titlesOf(specs: readonly { title: string }[]): string[] {
  return specs.map(spec => spec.title);
}

/** Unwraps a mandatory timestamp — keeps `toBe` args non-optional. */
function requiredTime(value: Date | null | undefined): number {
  if (value === null || value === undefined) {
    throw new Error("expected a non-null timestamp");
  }
  return value.getTime();
}

describe("plan-catalog seed (service bootstrap parity)", () => {
  test("run 1 provisions the four frozen demo plans with contract values", async () => {
    await runInRollback(async tx => {
      const baseline = await PlanCatalogService.listForAdmin(true, LOCALE, tx);
      const baselineTitles = new Set(baseline.map(plan => plan.title));
      const preExistingDemoTitles = DEMO_PLAN_CATALOG.filter(spec => baselineTitles.has(spec.title));

      const seeded = await seedOrGet(undefined, tx);
      expect(seeded).toHaveLength(DEMO_PLAN_CATALOG.length);

      const afterRun1 = await PlanCatalogService.listForAdmin(true, LOCALE, tx);
      expect(afterRun1).toHaveLength(baseline.length + (DEMO_PLAN_CATALOG.length - preExistingDemoTitles.length));

      const byTitle = new Map(afterRun1.map(plan => [plan.title, plan]));
      for (const spec of DEMO_PLAN_CATALOG) {
        const row = byTitle.get(spec.title);
        expect(row).toBeDefined();
        expect(row?.sessionCount).toBe(spec.sessionCount);
        expect(row?.price).toBe(spec.price);
        expect(row?.currency).toBe(spec.currency);
        expect(row?.intervalDays).toBe(spec.intervalDays);
        expect(row?.isActive).toBe(spec.active);
      }

      // FR-2.3 (frozen): the verification plan carries sessionCount = 5.
      const verification = byTitle.get(VERIFICATION_PLAN_TITLE);
      expect(verification?.sessionCount).toBe(5);
      expect(verification?.price).toBe("0.00");
    });
  });

  test("run 2 is a no-op — stable ids, unchanged counts, no duplicate titles", async () => {
    await runInRollback(async tx => {
      const first = await seedOrGet(undefined, tx);
      const afterRun1 = await PlanCatalogService.listForAdmin(true, LOCALE, tx);

      const second = await seedOrGet(undefined, tx);
      const afterRun2 = await PlanCatalogService.listForAdmin(true, LOCALE, tx);

      // Row count UNCHANGED between run 1 and run 2 (find-or-create hit on
      // every demo title — the only idempotency mechanism, since
      // createPlan tolerates duplicate titles by design).
      expect(afterRun2).toHaveLength(afterRun1.length);
      expect(second).toHaveLength(DEMO_PLAN_CATALOG.length);

      // Every demo title appears EXACTLY once after both runs.
      const titles = afterRun2.map(plan => plan.title);
      for (const spec of DEMO_PLAN_CATALOG) {
        expect(titles.filter(title => title === spec.title)).toHaveLength(1);
      }

      // Run 2 returned the same rows run 1 found/created — stable ids per
      // title (deep equality on the {title, id} identity pairs, fixture
      // order preserved by the seeder).
      expect(second.map(plan => ({ title: plan.title, id: plan.id }))).toEqual(
        first.map(plan => ({ title: plan.title, id: plan.id }))
      );
    });
  });

  test("deactivated demo stays inactive across runs and is excluded from the active catalog", async () => {
    await runInRollback(async tx => {
      const inactiveSpecs = DEMO_PLAN_CATALOG.filter(spec => !spec.active);
      expect(inactiveSpecs).toHaveLength(1);
      const inactiveTitle = inactiveSpecs[0]?.title;
      expect(inactiveTitle).toBeString();

      const first = await seedOrGet(undefined, tx);
      const run1Inactive = first.find(plan => plan.title === inactiveTitle);
      expect(run1Inactive).toBeDefined();
      expect(run1Inactive?.isActive).toBe(false);
      expect(run1Inactive?.deactivatedAt).not.toBeNull();
      const run1DeactivatedAt = requiredTime(run1Inactive?.deactivatedAt);

      await seedOrGet(undefined, tx);
      const afterRun2 = await PlanCatalogService.listForAdmin(true, LOCALE, tx);

      // Exactly one DEMO fixture is inactive (the dev DB legally contains
      // additional committed plan rows — assertions stay scoped to the demo
      // set). Not re-activated (nor re-transitioned) by run 2.
      const demoRows = afterRun2.filter(plan => titlesOf(DEMO_PLAN_CATALOG).includes(plan.title));
      const stillInactive = demoRows.filter(plan => !plan.isActive);
      expect(stillInactive).toHaveLength(1);
      expect(stillInactive[0]?.title).toBe(inactiveTitle);
      expect(requiredTime(stillInactive[0]?.deactivatedAt)).toBe(run1DeactivatedAt);

      // INV-PC1 at seed level: the active catalog excludes the deactivated
      // demo and includes exactly the three active fixtures.
      const activeCatalog = await PlanCatalogService.listActiveCatalog(LOCALE, tx);
      for (const spec of DEMO_PLAN_CATALOG) {
        const visible = activeCatalog.some(plan => plan.title === spec.title);
        expect(visible).toBe(spec.active);
      }
    });
  });

  test("seed module import hygiene — no direct database-layer imports (3.5.SEC/IV)", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "..", "seeds", "billing", "seed-plan-catalog.ts"),
      "utf8"
    );
    // The service-bootstrap rule (backend/db/seeds/AGENTS.md): seeders must
    // not import from the database layer — schema, repo, drizzleDb,
    // migrations — nor query application tables with drizzle-orm directly.
    expect(source).not.toMatch(/@\/backend\/db\/(schema|repo|migration|drizzleDb)/);
    expect(source).not.toMatch(/from\s+"drizzle-orm"/);
    // And it must bootstrap through the service namespace, per Task 1.5.
    expect(source).toContain('from "@/backend/services"');
    expect(source).toContain("PlanCatalogService");
  });
});
