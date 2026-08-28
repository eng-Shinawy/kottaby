/**
 * Self-tests for the `plans` entity-setup helpers — `createTestPlan` and
 * `createTestPlanWithSubscription`.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback` with `tx` passed to every direct
 *    Drizzle query; the helper inserts ride the same transaction.
 *  - The post-rollback residue probe is the only deliberately
 *    out-of-transaction read (read-only, on the pooled `db`) — it proves the
 *    forced rollback left zero plan/subscription rows behind.
 *
 * Coverage map:
 *  - Uniqueness: two helper-created plans get distinct ids and distinct
 *    randomized titles, with CHECK-safe defaults on every column.
 *  - Override merging: per-column overrides win over defaults and the full
 *    inserted row (including the lifecycle pair) is returned and persisted.
 *  - Linkage: the composite fixture wires plan → subscription →
 *    student-subscriptions → student balance lanes coherently.
 *  - Rollback hygiene: created plans and subscriptions vanish after the
 *    wrapping transaction rolls back.
 */

import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { createTestPlan, createTestPlanWithSubscription } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { PlanSelectType } from "@/backend/types";

describe("plans entity-setup helpers", () => {
  test("two created plans carry unique ids and unique titles with safe defaults", async () => {
    await runInRollback(async tx => {
      const first = await createTestPlan(tx);
      const second = await createTestPlan(tx);

      expect(first.id).not.toBe(second.id);
      expect(first.title).not.toBe(second.title);
      for (const plan of [first, second]) {
        expect(plan.title).toMatch(/^Test Plan /);
        expect(plan.sessionCount).toBe(5);
        expect(plan.price).toBe("10.00");
        expect(plan.currency).toBe("EGP");
        expect(plan.intervalDays).toBe(30);
        expect(plan.isActive).toBe(true);
        expect(plan.deactivatedAt).toBeNull();
        expect(plan.createdAt).toBeInstanceOf(Date);
        expect(plan.updatedAt).toBeInstanceOf(Date);
      }
    });
  });

  test("overrides merge over defaults and the full inserted row is returned", async () => {
    await runInRollback(async tx => {
      const deactivatedAt = new Date("2024-01-02T03:04:05.000Z");
      const plan = await createTestPlan(tx, {
        title: "Override Probe Plan",
        sessionCount: 12,
        price: "25.50",
        intervalDays: 7,
        isActive: false,
        deactivatedAt,
      });

      expect(plan.title).toBe("Override Probe Plan");
      expect(plan.sessionCount).toBe(12);
      expect(plan.price).toBe("25.50");
      expect(plan.intervalDays).toBe(7);
      expect(plan.isActive).toBe(false);
      expect(plan.deactivatedAt).toEqual(deactivatedAt);

      const [persisted] = await tx.select().from(plans).where(eq(plans.id, plan.id));
      expect(persisted).toEqual(plan);
    });
  });

  test("linkage fixture wires plan → subscription → student balance lane", async () => {
    await runInRollback(async tx => {
      const { plan, user, student, subscription, studentSubscription } = await createTestPlanWithSubscription(tx);

      expect(subscription.planId).toBe(plan.id);
      expect(subscription.userId).toBe(user.id);
      expect(subscription.status).toBe("active");
      expect(subscription.startDate).toBeInstanceOf(Date);
      expect(subscription.endDate).toBeNull();
      expect(studentSubscription.studentId).toBe(student.id);
      expect(studentSubscription.subscriptionId).toBe(subscription.id);
      expect(studentSubscription.enrolledAt).toBeInstanceOf(Date);
      expect(student.id).toBe(user.id);
      expect(student.balanceHifz).toBe(0);
      expect(student.balanceTajweed).toBe(0);
      expect(student.balanceReviews).toBe(0);
    });
  });

  test("rollback leaves zero plan and subscription residue", async () => {
    const createdPlans: PlanSelectType[] = [];
    const subscriptionIds: number[] = [];

    await runInRollback(async tx => {
      createdPlans.push(await createTestPlan(tx));
      createdPlans.push(await createTestPlan(tx));
      const linkage = await createTestPlanWithSubscription(tx);
      createdPlans.push(linkage.plan);
      subscriptionIds.push(linkage.subscription.id);

      const inTx = await tx
        .select({ id: plans.id })
        .from(plans)
        .where(
          inArray(
            plans.id,
            createdPlans.map(plan => plan.id)
          )
        );
      expect(inTx).toHaveLength(3);
    });

    const planResidue = await db
      .select({ id: plans.id })
      .from(plans)
      .where(
        inArray(
          plans.id,
          createdPlans.map(plan => plan.id)
        )
      );
    expect(planResidue).toHaveLength(0);

    const subscriptionResidue = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(inArray(subscriptions.id, subscriptionIds));
    expect(subscriptionResidue).toHaveLength(0);
  });
});
