/**
 * Repository self-tests for `PlanRepository` (plans catalog data access).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback` with the `tx` passed as the LAST
 *    argument of every repository call; nothing commits.
 *  - Rejections are asserted via `expectRepoError` (try/catch) — never
 *    `expect(...).rejects.toThrow()` inside `runInRollback`.
 *  - Failures surface through assertions only — no direct process output.
 *
 * Coverage map (4 tiers):
 *  - Happy path: every method with `tx` propagation — insert returns the full
 *    row, whitelist update patches all five commercial fields, the guarded
 *    transition maintains the lifecycle pair, reads observe persisted state.
 *  - Boundary: update on a nonexistent id returns `null`; the active catalog
 *    excludes deactivated rows while the admin catalog includes them; both
 *    list reads order oldest-first across three fixtures; missing ids probe
 *    `false`.
 *  - Chaos: the guarded transition rejects the second identical transition in
 *    BOTH directions with `null` and leaves the row transitioned exactly
 *    once; deactivate → activate → deactivate converges deterministically;
 *    guard transitions plus field edits leave linked subscription rows
 *    byte-identical; duplicate titles are tolerated (double-submit ruling —
 *    two rows may share a title); lifecycle keys smuggled into
 *    the patch are a compile error AND a runtime no-op.
 *  - Database-layer security: direct writes violating the CHECK constraints
 *    (session_count <= 0, price < 0, interval_days <= 0) are rejected with
 *    the check-violation code.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { type PlanFieldPatch, PlanRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { studentSubscriptions } from "@/backend/db/schema/billing/student-subscriptions";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { createTestPlan, createTestPlanWithSubscription } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { PlanInsertType } from "@/backend/types";

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find the original
 * PostgreSQL error code — Drizzle wraps driver errors behind its own generic
 * "failed query" message. Mirrors the established traversal precedent in
 * `plan-catalog-schema.test.ts` (`pgErrorCarries`). No unsafe casts.
 */
function pgErrorCode(error: unknown): string {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && typeof current.code === "string") {
      return current.code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return "missing-code";
}

/** Explicit insert payload with a collision-proof unique title. */
function planInsertValues(title: string): PlanInsertType {
  return { title, sessionCount: 7, price: "15.00", currency: "EGP", intervalDays: 60 };
}

describe("PlanRepository", () => {
  describe("happy path", () => {
    test("insertPlan inserts a plan and returns the full persisted row", async () => {
      await runInRollback(async tx => {
        const title = `Repo Insert ${randomUUID()}`;
        const inserted = await PlanRepository.insertPlan(planInsertValues(title), tx);

        expect(inserted.id).toBeGreaterThan(0);
        expect(inserted.title).toBe(title);
        expect(inserted.sessionCount).toBe(7);
        expect(inserted.price).toBe("15.00");
        expect(inserted.currency).toBe("EGP");
        expect(inserted.intervalDays).toBe(60);
        expect(inserted.isActive).toBe(true);
        expect(inserted.deactivatedAt).toBeNull();
        expect(inserted.createdAt).toBeInstanceOf(Date);
        expect(inserted.updatedAt).toBeInstanceOf(Date);
        expect(await PlanRepository.existsById(inserted.id, tx)).toBe(true);
      });
    });

    test("updatePlanFields patches all five whitelisted fields and stamps updatedAt", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);
        const updated = await PlanRepository.updatePlanFields(
          plan.id,
          {
            title: `Edited ${randomUUID()}`,
            sessionCount: 12,
            price: "42.50",
            currency: "USD",
            intervalDays: 90,
          },
          tx
        );

        expect(updated).not.toBeNull();
        expect(updated?.title).toMatch(/^Edited /);
        expect(updated?.sessionCount).toBe(12);
        expect(updated?.price).toBe("42.50");
        expect(updated?.currency).toBe("USD");
        expect(updated?.intervalDays).toBe(90);
        expect(updated?.isActive).toBe(true);
        expect(updated?.deactivatedAt).toBeNull();
        expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(plan.updatedAt.getTime());
      });
    });

    test("setActiveStatusOnce deactivates and reactivates with the lifecycle pair moving together", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        const deactivated = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
        expect(deactivated?.isActive).toBe(false);
        expect(deactivated?.deactivatedAt).toBeInstanceOf(Date);

        const reactivated = await PlanRepository.setActiveStatusOnce(plan.id, true, tx);
        expect(reactivated?.isActive).toBe(true);
        expect(reactivated?.deactivatedAt).toBeNull();
      });
    });

    test("existsById and both list reads observe persisted state through the transaction", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        expect(await PlanRepository.existsById(plan.id, tx)).toBe(true);
        expect((await PlanRepository.listAll(tx)).map(row => row.id)).toContain(plan.id);
        expect((await PlanRepository.listActive(tx)).map(row => row.id)).toContain(plan.id);
      });
    });
  });

  describe("boundary", () => {
    test("updatePlanFields on a nonexistent id returns null", async () => {
      await runInRollback(async tx => {
        const updated = await PlanRepository.updatePlanFields(999_999_999, { title: "Ghost" }, tx);
        expect(updated).toBeNull();
      });
    });

    test("listActive excludes deactivated plans while listAll includes them", async () => {
      await runInRollback(async tx => {
        const active = await createTestPlan(tx, { title: "Active Catalog Plan" });
        const deactivated = await createTestPlan(tx, {
          title: "Retired Catalog Plan",
          isActive: false,
          deactivatedAt: new Date("2024-06-01T00:00:00.000Z"),
        });

        const activeIds = (await PlanRepository.listActive(tx)).map(row => row.id);
        const allIds = (await PlanRepository.listAll(tx)).map(row => row.id);
        expect(activeIds).toContain(active.id);
        expect(activeIds).not.toContain(deactivated.id);
        expect(allIds).toContain(active.id);
        expect(allIds).toContain(deactivated.id);
      });
    });

    test("listActive and listAll order rows oldest-first by created_at across three fixtures", async () => {
      await runInRollback(async tx => {
        const march = await createTestPlan(tx, {
          title: `Mar ${randomUUID()}`,
          createdAt: new Date("2024-03-01T00:00:00.000Z"),
        });
        const january = await createTestPlan(tx, {
          title: `Jan ${randomUUID()}`,
          createdAt: new Date("2024-01-01T00:00:00.000Z"),
        });
        const february = await createTestPlan(tx, {
          title: `Feb ${randomUUID()}`,
          createdAt: new Date("2024-02-01T00:00:00.000Z"),
        });

        const expectedOrder = [january.id, february.id, march.id];
        expect((await PlanRepository.listAll(tx)).map(row => row.id).filter(id => expectedOrder.includes(id))).toEqual(
          expectedOrder
        );
        expect(
          (await PlanRepository.listActive(tx)).map(row => row.id).filter(id => expectedOrder.includes(id))
        ).toEqual(expectedOrder);
      });
    });

    test("existsById returns false for a missing id", async () => {
      await runInRollback(async tx => {
        expect(await PlanRepository.existsById(987_654_321, tx)).toBe(false);
      });
    });
  });

  describe("guarded transition chaos", () => {
    test("second identical transition returns null and the row is transitioned exactly once", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        // Already active — activating again matches zero rows.
        expect(await PlanRepository.setActiveStatusOnce(plan.id, true, tx)).toBeNull();

        const deactivated = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
        expect(deactivated?.isActive).toBe(false);

        // Double-deactivation: guard fails, nothing is written.
        expect(await PlanRepository.setActiveStatusOnce(plan.id, false, tx)).toBeNull();
        if (!deactivated) {
          throw new Error("expected the first deactivation to return the transitioned row");
        }

        const reread = (await tx.select().from(plans).where(eq(plans.id, plan.id)))[0];
        expect(reread).toEqual(deactivated);
      });
    });

    test("deactivate, activate, deactivate converges to the same lifecycle state each step", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        const firstDeactivate = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
        expect(firstDeactivate?.isActive).toBe(false);
        expect(firstDeactivate?.deactivatedAt).toBeInstanceOf(Date);

        const activated = await PlanRepository.setActiveStatusOnce(plan.id, true, tx);
        expect(activated?.isActive).toBe(true);
        expect(activated?.deactivatedAt).toBeNull();

        const secondDeactivate = await PlanRepository.setActiveStatusOnce(plan.id, false, tx);
        expect(secondDeactivate?.isActive).toBe(false);
        expect(secondDeactivate?.deactivatedAt).toBeInstanceOf(Date);
        expect(secondDeactivate?.deactivatedAt?.getTime()).toBeGreaterThanOrEqual(
          firstDeactivate?.deactivatedAt?.getTime() ?? 0
        );
      });
    });

    test("guard transitions and field edits leave linked subscription rows byte-identical", async () => {
      await runInRollback(async tx => {
        const fixture = await createTestPlanWithSubscription(tx);
        const subscriptionBefore = fixture.subscription;
        const junctionBefore = fixture.studentSubscription;

        const deactivated = await PlanRepository.setActiveStatusOnce(fixture.plan.id, false, tx);
        expect(deactivated?.isActive).toBe(false);
        const edited = await PlanRepository.updatePlanFields(
          fixture.plan.id,
          { title: `Rewritten ${randomUUID()}`, price: "99.99" },
          tx
        );
        expect(edited?.title).toMatch(/^Rewritten /);

        const [subscriptionAfter] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, subscriptionBefore.id));
        expect(subscriptionAfter).toEqual(subscriptionBefore);
        // Junction rows carry a composite (student_id, subscription_id) key —
        // re-read through BOTH key halves.
        const [junctionAfter] = await tx
          .select()
          .from(studentSubscriptions)
          .where(
            and(
              eq(studentSubscriptions.studentId, junctionBefore.studentId),
              eq(studentSubscriptions.subscriptionId, junctionBefore.subscriptionId)
            )
          );
        expect(junctionAfter).toEqual(junctionBefore);
        expect(edited?.updatedAt.getTime()).toBeGreaterThanOrEqual(fixture.plan.updatedAt.getTime());
      });
    });

    test("duplicate titles are tolerated — two rows may share a title (double-submit tolerance)", async () => {
      await runInRollback(async tx => {
        // Plans carry no natural unique key: a double-submitted create yields
        // two distinct rows with the same title, per the documented ruling.
        const title = `Double Submit ${randomUUID()}`;
        const first = await PlanRepository.insertPlan(planInsertValues(title), tx);
        const second = await PlanRepository.insertPlan(planInsertValues(title), tx);

        expect(first.id).not.toBe(second.id);
        expect(second.title).toBe(title);
      });
    });

    test("lifecycle keys smuggled into the patch are a type error and a runtime no-op", async () => {
      await runInRollback(async tx => {
        const plan = await createTestPlan(tx);

        // Compile-time proof: the patch type rejects lifecycle keys outright.
        // @ts-expect-error — isActive is outside the PlanFieldPatch whitelist
        const rejected: PlanFieldPatch = { title: "Smuggler", isActive: false };
        expect(rejected.title).toBe("Smuggler");

        // Runtime proof: keys added past the type system are not copied.
        const patch: PlanFieldPatch = { title: `Whitelist ${randomUUID()}` };
        Object.assign(patch, { isActive: false, deactivatedAt: new Date(), id: 987_654 });
        const patched = await PlanRepository.updatePlanFields(plan.id, patch, tx);

        expect(patched?.isActive).toBe(true);
        expect(patched?.deactivatedAt).toBeNull();
        expect(patched?.id).toBe(plan.id);
        expect(patched?.title).toMatch(/^Whitelist /);
      });
    });
  });

  describe("database-layer CHECK enforcement", () => {
    test("session_count <= 0 is rejected by the check constraint", async () => {
      await runInRollback(async tx => {
        const error = await expectRepoError(() =>
          PlanRepository.insertPlan({ ...planInsertValues(`Check ${randomUUID()}`), sessionCount: 0 }, tx)
        );
        expect(pgErrorCode(error)).toBe("23514");
      });
    });

    test("price < 0 is rejected by the check constraint", async () => {
      await runInRollback(async tx => {
        const error = await expectRepoError(() =>
          PlanRepository.insertPlan({ ...planInsertValues(`Check ${randomUUID()}`), price: "-0.01" }, tx)
        );
        expect(pgErrorCode(error)).toBe("23514");
      });
    });

    test("interval_days <= 0 is rejected by the check constraint", async () => {
      await runInRollback(async tx => {
        const error = await expectRepoError(() =>
          PlanRepository.insertPlan({ ...planInsertValues(`Check ${randomUUID()}`), intervalDays: 0 }, tx)
        );
        expect(pgErrorCode(error)).toBe("23514");
      });
    });
  });

  test("non-transactional read branches run on the pool and cannot observe uncommitted rows", async () => {
    await runInRollback(async tx => {
      const plan = await createTestPlan(tx);

      // No `tx` argument → queryDb fast path on the global pool, which sits
      // OUTSIDE the wrapping transaction: the uncommitted fixture is invisible.
      expect(await PlanRepository.existsById(plan.id)).toBe(false);
      expect((await PlanRepository.listAll()).some(row => row.id === plan.id)).toBe(false);
      expect((await PlanRepository.listActive()).some(row => row.id === plan.id)).toBe(false);

      // The same reads through the transaction DO observe the fixture.
      expect(await PlanRepository.existsById(plan.id, tx)).toBe(true);
    });
  });
});
