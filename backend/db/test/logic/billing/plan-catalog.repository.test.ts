/**
 * PlanRepository unit tests — 4-Tier verification suite.
 *
 * Tier 1: Happy path operations (insert, update, toggle active status, find, list).
 * Tier 2: Boundary conditions (nonexistent IDs, filtering active vs all, ordering).
 * Tier 3: Chaos & concurrency (atomic double-transition guard returns null).
 * Tier 4: Security (direct CHECK constraint violation handling via expectRepoError).
 */

import { describe, expect, test } from "bun:test";
import { PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";

describe("PlanRepository", () => {
  // ─── Tier 1: Happy Path Operations ──────────────────────────────────────────

  test("insertPlan creates a plan and returns all fields with defaults", async () => {
    await runInRollback(async tx => {
      const plan = await PlanRepository.insertPlan(
        {
          title: "Tier 1 Plan",
          sessionCount: 10,
          price: "150.00",
          currency: "EGP",
          intervalDays: 30,
        },
        tx
      );

      expect(plan.id).toBeGreaterThan(0);
      expect(plan.title).toBe("Tier 1 Plan");
      expect(plan.sessionCount).toBe(10);
      expect(plan.price).toBe("150.00");
      expect(plan.currency).toBe("EGP");
      expect(plan.intervalDays).toBe(30);
      expect(plan.isActive).toBe(true);
      expect(plan.deactivatedAt).toBeNull();
      expect(plan.createdAt).toBeInstanceOf(Date);
      expect(plan.updatedAt).toBeInstanceOf(Date);
    });
  });

  test("updatePlanFields updates specified fields and updates updatedAt", async () => {
    await runInRollback(async tx => {
      const created = await createTestPlan(tx, { title: "Original Title", price: "100.00" });

      const updated = await PlanRepository.updatePlanFields(
        created.id,
        {
          title: "Updated Title",
          price: "175.50",
          sessionCount: 12,
        },
        tx
      );

      expect(updated).not.toBeNull();
      if (updated) {
        expect(updated.id).toBe(created.id);
        expect(updated.title).toBe("Updated Title");
        expect(updated.price).toBe("175.50");
        expect(updated.sessionCount).toBe(12);
        expect(updated.currency).toBe(created.currency);
        expect(updated.intervalDays).toBe(created.intervalDays);
      }
    });
  });

  test("setActiveStatusOnce transitions active state correctly", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, { isActive: true });

      // Deactivate
      const deactivated = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
      expect(deactivated).not.toBeNull();
      if (deactivated) {
        expect(deactivated.isActive).toBe(false);
        expect(deactivated.deactivatedAt).toBeInstanceOf(Date);
      }

      // Reactivate
      const reactivated = await PlanRepository.setActiveStatusOnce(plan.id, true, tx);
      expect(reactivated).not.toBeNull();
      if (reactivated) {
        expect(reactivated.isActive).toBe(true);
        expect(reactivated.deactivatedAt).toBeNull();
      }
    });
  });

  test("findById and existsById return accurate records", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, { title: "Findable Plan" });

      const found = await PlanRepository.findById(plan.id, tx);
      expect(found).not.toBeNull();
      if (found) {
        expect(found.id).toBe(plan.id);
        expect(found.title).toBe("Findable Plan");
      }

      const exists = await PlanRepository.existsById(plan.id, tx);
      expect(exists).toBe(true);
    });
  });

  // ─── Tier 2: Boundary Conditions ──────────────────────────────────────────

  test("updatePlanFields on nonexistent ID returns null", async () => {
    await runInRollback(async tx => {
      const result = await PlanRepository.updatePlanFields(99999999, { title: "Ghost Plan" }, tx);
      expect(result).toBeNull();
    });
  });

  test("findById and existsById on nonexistent ID return null and false", async () => {
    await runInRollback(async tx => {
      const found = await PlanRepository.findById(99999999, tx);
      expect(found).toBeNull();

      const exists = await PlanRepository.existsById(99999999, tx);
      expect(exists).toBe(false);
    });
  });

  test("listActive excludes deactivated plans and orders by createdAt ASC", async () => {
    await runInRollback(async tx => {
      const p1 = await createTestPlan(tx, { title: "Active A", isActive: true });
      await createTestPlan(tx, { title: "Inactive B", isActive: false, deactivatedAt: new Date() });
      const p3 = await createTestPlan(tx, { title: "Active C", isActive: true });

      const activeList = await PlanRepository.listActive(tx);
      const activeIds = activeList.map(p => p.id);

      expect(activeIds).toContain(p1.id);
      expect(activeIds).toContain(p3.id);

      for (const p of activeList) {
        expect(p.isActive).toBe(true);
      }
    });
  });

  test("listAll includes both active and inactive plans ordered by createdAt ASC", async () => {
    await runInRollback(async tx => {
      const p1 = await createTestPlan(tx, { title: "Active 1", isActive: true });
      const p2 = await createTestPlan(tx, { title: "Inactive 2", isActive: false, deactivatedAt: new Date() });

      const allList = await PlanRepository.listAll(tx);
      const allIds = allList.map(p => p.id);

      expect(allIds).toContain(p1.id);
      expect(allIds).toContain(p2.id);
    });
  });

  // ─── Tier 3: Chaos & Concurrency ──────────────────────────────────────────

  test("setActiveStatusOnce double-transition returns null on subsequent identical calls", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, { isActive: true });

      // First deactivation succeeds
      const firstTransition = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
      expect(firstTransition).not.toBeNull();

      // Second deactivation fails guard (already false) and returns null
      const secondTransition = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
      expect(secondTransition).toBeNull();

      // First reactivation succeeds
      const firstReactivation = await PlanRepository.setActiveStatusOnce(plan.id, true, tx);
      expect(firstReactivation).not.toBeNull();

      // Second reactivation fails guard (already true) and returns null
      const secondReactivation = await PlanRepository.setActiveStatusOnce(plan.id, true, tx);
      expect(secondReactivation).toBeNull();
    });
  });

  // ─── Tier 4: Security & CHECK Constraints ─────────────────────────────────

  // Each CHECK-violation case gets its OWN rollback transaction — a CHECK
  // violation aborts the surrounding transaction (25P02), so the second case
  // in the same transaction would report the abort error, not its constraint
  // (CodeRabbit fix). Constraint names asserted for specificity.
  test("insertPlan rejects sessionCount CHECK violation at DB layer", async () => {
    await runInRollback(async tx => {
      const err1 = await expectRepoError(async () => {
        await PlanRepository.insertPlan(
          {
            title: "Invalid Sessions",
            sessionCount: 0,
            price: "100.00",
            currency: "EGP",
            intervalDays: 30,
          },
          tx
        );
      });
      expect(err1).toBeInstanceOf(Error);
      expect(constraintNameOf(err1)).toBe("plans_session_count_check");
    });
  });

  test("insertPlan rejects price CHECK violation at DB layer", async () => {
    await runInRollback(async tx => {
      const err2 = await expectRepoError(async () => {
        await PlanRepository.insertPlan(
          {
            title: "Invalid Price",
            sessionCount: 5,
            price: "-50.00",
            currency: "EGP",
            intervalDays: 30,
          },
          tx
        );
      });
      expect(err2).toBeInstanceOf(Error);
      expect(constraintNameOf(err2)).toBe("plans_price_check");
    });
  });
});
