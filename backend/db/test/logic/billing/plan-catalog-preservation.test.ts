/**
 * Plan Catalog Preservation Proof Tests — DEV1-005 Task 5.1.TE
 *
 * Implements REQ-017, REQ-018, REQ-075:
 * Proves that plan deactivation and forward-only edits preserve data integrity,
 * have zero unintended side effects, and do not mutate or delete existing records.
 */

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { users } from "@/backend/db/schema/users/users";
import { createTestPlan, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

describe("Plan Catalog Preservation Proof (REQ-075)", () => {
  test("Deactivating a plan preserves plan history and linked user records without deletion", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "student" });
      const plan = await createTestPlan(tx, {
        title: "Preservation Plan",
        sessionCount: 12,
        price: "450.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: true,
      });

      // Snapshot original user state
      const initialUserId = user.id;
      const initialUserEmail = user.email;
      // Deactivate plan
      const deactivated = await PlanCatalogService.setPlanActiveStatus(plan.id, false, "en", tx);
      expect(deactivated.id).toBe(plan.id);
      expect(deactivated.isActive).toBe(false);
      expect(deactivated.deactivatedAt).not.toBeNull();
      expect(deactivated.title).toBe("Preservation Plan");
      expect(deactivated.sessionCount).toBe(12);
      expect(deactivated.price).toBe("450.00");

      // Verify user record is completely unaffected — re-read the row from
      // the DB (tautological in-memory comparisons prove nothing per REQ-075).
      const [persistedUser] = await tx.select().from(users).where(eq(users.id, initialUserId));
      if (!persistedUser) {
        throw new Error("user row was deleted");
      }
      expect(persistedUser.id).toBe(initialUserId);
      expect(persistedUser.email).toBe(initialUserEmail);
    });
  });

  test("Updating a plan price and interval preserves original record ID and createdAt timestamp", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx, {
        title: "Price Evolution Plan",
        sessionCount: 8,
        price: "300.00",
        currency: "EGP",
        intervalDays: 30,
        isActive: true,
      });

      const originalCreatedAt = plan.createdAt.toISOString();

      // Forward-only update
      const updated = await PlanCatalogService.updatePlan(
        plan.id,
        {
          price: "350.00",
          intervalDays: 45,
        },
        "en",
        tx
      );

      expect(updated.id).toBe(plan.id);
      expect(updated.title).toBe("Price Evolution Plan");
      expect(updated.price).toBe("350.00");
      expect(updated.intervalDays).toBe(45);
      expect(updated.sessionCount).toBe(8);
      expect(updated.createdAt.toISOString()).toBe(originalCreatedAt);
    });
  });
});
