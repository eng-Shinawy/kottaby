/**
 * Plan Catalog Seeder Tests — DEV1-005 Task 3.5.TE
 *
 * Verifies:
 *  - REQ-019, REQ-021: Demo catalog seeding produces expected plans.
 *  - Verification plan has `sessionCount = 5`.
 *  - Idempotency: Multiple seed passes produce no duplicate rows.
 *  - Deactivated demo plan is correctly marked inactive.
 */

import { describe, expect, test } from "bun:test";
import { INITIAL_DEMO_PLANS, seedOrGet } from "@/backend/db/seeds/billing/seed-plans";
import { runInRollback } from "@/backend/db/test/test-utils";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

describe("Plan Catalog Seeding", () => {
  test("seedOrGet creates all demo plans and is idempotent on repeat execution", async () => {
    await runInRollback(async tx => {
      // First pass: creates all demo plans
      const firstPass = await seedOrGet("en", tx);
      expect(firstPass).toHaveLength(INITIAL_DEMO_PLANS.length);

      // Verify "New Teacher Verification & Evaluation Plan" has sessionCount = 5
      const verificationPlan = firstPass.find(p => p.title === "New Teacher Verification & Evaluation Plan");
      expect(verificationPlan).toBeDefined();
      expect(verificationPlan?.sessionCount).toBe(5);
      expect(verificationPlan?.isActive).toBe(true);

      // Verify deactivated demo plan
      const deactivatedPlan = firstPass.find(p => p.title === "Legacy Trial Plan");
      expect(deactivatedPlan).toBeDefined();
      expect(deactivatedPlan?.isActive).toBe(false);
      expect(deactivatedPlan?.deactivatedAt).not.toBeNull();

      // Second pass: must be idempotent and return identical plans without duplicate inserts
      const secondPass = await seedOrGet("en", tx);
      expect(secondPass).toHaveLength(INITIAL_DEMO_PLANS.length);
      expect(secondPass.map(p => p.id)).toEqual(firstPass.map(p => p.id));

      const allPlans = await PlanCatalogService.listForAdmin({ includeInactive: true }, "en", tx);
      for (const demoPlan of INITIAL_DEMO_PLANS) {
        const found = allPlans.find(p => p.title === demoPlan.title);
        expect(found).toBeDefined();
      }
    });
  });
});
