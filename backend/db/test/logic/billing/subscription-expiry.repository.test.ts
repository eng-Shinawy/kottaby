/**
 * SubscriptionRepository expiry tests — the guarded batch `active → expired`
 * transition (`expireDueActive`) and the booking-path lane-coverage probe
 * (`hasUncoveredExpiredLane`).
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated: every test runs inside `runInRollback`; `tx` is
 *    passed to EVERY repo call, entity-setup helper, and direct Drizzle
 *    query (on both methods under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - No `expect(...).rejects.toThrow()` — both methods signal misses
 *    through zero-row / `false` outcomes, never throws, so no error
 *    helper is exercised here.
 *
 * Coverage map:
 *  - Tier 1 (branch): past-window active flips with the exact
 *    `{ id, userId, planId }` projection; in-window, pending, cancelled,
 *    suspended, and null-`end_date` actives are all untouched; a re-run is
 *    a zero-row replay; the lane-probe truth table (expired-only → true;
 *    active/pending coverage → false; none → false; lane- and owner-
 *    scoped misses → false).
 *  - Tier 2 (boundary): `end_date == now` IS due (the inclusive `<=`
 *    sweep comparison) while `end_date == now + 1ms` is not; a lagging
 *    `active` row (window closed, sweep not yet run) does not count as
 *    coverage.
 *  - Tier 3 (chaos): two overlapping sweep calls converge on the identical
 *    terminal state — exactly one statement claims the row, the other
 *    matches zero, and the row ends `expired` either way.
 */

import { describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { SubscriptionRepository } from "@/backend/db/repo/billing/subscription.repository";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { createTestPlan, createTestSubscription, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { DBTransaction, SubscriptionSelectType } from "@/backend/types";

/** One day in milliseconds — the fixture backdating unit. */
const MS_PER_DAY = 86_400_000;

/**
 * Creates the minimal expiry actor: one student user plus one plan that
 * credits the requested lane. The probe predicates key on the
 * subscription's `user_id` and the plan's `balance_lane`, so this pair is
 * the whole fixture universe a test case needs.
 */
async function createLaneSubscriber(
  tx: DBTransaction,
  lane: SubscriptionCreditLane
): Promise<{ userId: number; planId: number }> {
  const user = await createTestUser(tx, { role: "student" });
  const plan = await createTestPlan(tx, { balanceLane: lane });
  return { userId: user.id, planId: plan.id };
}

/** Creates a past-window `active` subscription: a 30-day window that closed `daysBack` ago. */
async function createPastWindowActive(
  tx: DBTransaction,
  userId: number,
  planId: number,
  now: Date,
  daysBack: number
): Promise<SubscriptionSelectType> {
  return createTestSubscription(tx, userId, planId, {
    status: SubscriptionStatus.Active,
    startDate: new Date(now.getTime() - (daysBack + 30) * MS_PER_DAY),
    endDate: new Date(now.getTime() - daysBack * MS_PER_DAY),
  });
}

/** Read-back oracle: subscription id → current row status (in-tx). */
async function readStatuses(tx: DBTransaction, ids: number[]): Promise<Map<number, SubscriptionSelectType["status"]>> {
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await tx
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(inArray(subscriptions.id, ids));
  return new Map(rows.map(row => [row.id, row.status]));
}

describe("SubscriptionRepository — expiry sweep & lane coverage probes", () => {
  // ─── Tier 1: the guarded flip and every exclusion branch ─────────────

  test("expireDueActive flips ONLY past-window active rows; every other shape is untouched", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { userId, planId } = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);

      const past = await createPastWindowActive(tx, userId, planId, now, 30);
      const inWindow = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Active,
        startDate: new Date(now.getTime() - 10 * MS_PER_DAY),
        endDate: new Date(now.getTime() + 20 * MS_PER_DAY),
      });
      const pending = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Pending,
        startDate: null,
        endDate: null,
      });
      const cancelled = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Cancelled,
        startDate: new Date(now.getTime() - 60 * MS_PER_DAY),
        endDate: new Date(now.getTime() - 30 * MS_PER_DAY),
      });
      const suspended = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Suspended,
        startDate: new Date(now.getTime() - 60 * MS_PER_DAY),
        endDate: new Date(now.getTime() - 30 * MS_PER_DAY),
      });
      const openEnded = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Active,
        startDate: now,
        endDate: null,
      });
      const allIds = [past.id, inWindow.id, pending.id, cancelled.id, suspended.id, openEnded.id];

      const flipped = await SubscriptionRepository.expireDueActive(now, tx);

      // Exactly the past-window active row flips, reported with the exact
      // settlement projection and no extra columns.
      expect(flipped.filter(row => row.userId === userId)).toEqual([{ id: past.id, userId, planId }]);

      const statuses = await readStatuses(tx, allIds);
      expect(statuses.get(past.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(inWindow.id)).toBe(SubscriptionStatus.Active);
      expect(statuses.get(pending.id)).toBe(SubscriptionStatus.Pending);
      expect(statuses.get(cancelled.id)).toBe(SubscriptionStatus.Cancelled);
      expect(statuses.get(suspended.id)).toBe(SubscriptionStatus.Suspended);
      expect(statuses.get(openEnded.id)).toBe(SubscriptionStatus.Active);

      // The flip mutates the status only — the validity window is history,
      // and the explicit `updated_at` stamp is present.
      const [flippedRow] = await tx.select().from(subscriptions).where(eq(subscriptions.id, past.id));
      expect(flippedRow?.status).toBe(SubscriptionStatus.Expired);
      expect((flippedRow?.endDate?.getTime() ?? 0) - (flippedRow?.startDate?.getTime() ?? 0)).toBe(30 * MS_PER_DAY);
      expect(flippedRow?.updatedAt).toBeInstanceOf(Date);
    });
  });

  test("re-running the sweep after a flip matches zero rows (replay is a no-op)", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { userId, planId } = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      const past = await createPastWindowActive(tx, userId, planId, now, 30);

      const first = await SubscriptionRepository.expireDueActive(now, tx);
      expect(first.some(row => row.id === past.id)).toBe(true);

      const replay = await SubscriptionRepository.expireDueActive(now, tx);
      expect(replay).toHaveLength(0);

      expect((await readStatuses(tx, [past.id])).get(past.id)).toBe(SubscriptionStatus.Expired);
    });
  });

  // ─── Tier 2: the inclusive window boundary ────────────────────────────

  test("end_date exactly equal to now IS due; one millisecond later is not", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { userId, planId } = await createLaneSubscriber(tx, SubscriptionCreditLane.Tajweed);

      const boundary = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Active,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
      });
      const justInside = await createTestSubscription(tx, userId, planId, {
        status: SubscriptionStatus.Active,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: new Date(now.getTime() + 1),
      });

      const flipped = await SubscriptionRepository.expireDueActive(now, tx);
      expect(flipped.some(row => row.id === boundary.id)).toBe(true);

      const statuses = await readStatuses(tx, [boundary.id, justInside.id]);
      expect(statuses.get(boundary.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(justInside.id)).toBe(SubscriptionStatus.Active);
    });
  });

  // ─── Tier 3: overlapping sweeps converge on one terminal state ────────

  test("two overlapping sweep calls converge: exactly one claims the row, terminal state identical", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { userId, planId } = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      const past = await createPastWindowActive(tx, userId, planId, now, 30);

      const [first, second] = await Promise.allSettled([
        SubscriptionRepository.expireDueActive(now, tx),
        SubscriptionRepository.expireDueActive(now, tx),
      ]);
      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("fulfilled");

      // The guarded predicate is the lock: the union of both statements'
      // claims is exactly the one due row — no double flip, no lost row —
      // whichever statement serialized first.
      const claimedIds = [
        ...(first.status === "fulfilled" ? first.value.map(row => row.id) : []),
        ...(second.status === "fulfilled" ? second.value.map(row => row.id) : []),
      ];
      expect(claimedIds).toEqual([past.id]);

      expect((await readStatuses(tx, [past.id])).get(past.id)).toBe(SubscriptionStatus.Expired);
    });
  });

  // ─── Tier 1: hasUncoveredExpiredLane truth table ──────────────────────

  test("hasUncoveredExpiredLane truth table: expired-only → true; covered/none → false", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const past = (daysBack: number) => new Date(now.getTime() - daysBack * MS_PER_DAY);

      // Expired-only lane → uncovered.
      const lone = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      await createTestSubscription(tx, lone.userId, lone.planId, {
        status: SubscriptionStatus.Expired,
        startDate: past(60),
        endDate: past(30),
      });
      expect(await SubscriptionRepository.hasUncoveredExpiredLane(lone.userId, SubscriptionCreditLane.Hifz, tx)).toBe(
        true
      );

      // A second, in-window active subscription on the same lane covers it.
      await createTestSubscription(tx, lone.userId, lone.planId, {
        status: SubscriptionStatus.Active,
        startDate: past(1),
        endDate: new Date(now.getTime() + 29 * MS_PER_DAY),
      });
      expect(await SubscriptionRepository.hasUncoveredExpiredLane(lone.userId, SubscriptionCreditLane.Hifz, tx)).toBe(
        false
      );

      // A pending subscription on the same lane covers it too.
      const pendingCover = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      await createTestSubscription(tx, pendingCover.userId, pendingCover.planId, {
        status: SubscriptionStatus.Expired,
        startDate: past(60),
        endDate: past(30),
      });
      await createTestSubscription(tx, pendingCover.userId, pendingCover.planId, {
        status: SubscriptionStatus.Pending,
        startDate: null,
        endDate: null,
      });
      expect(
        await SubscriptionRepository.hasUncoveredExpiredLane(pendingCover.userId, SubscriptionCreditLane.Hifz, tx)
      ).toBe(false);

      // No subscriptions at all → false; the owner predicate also keeps
      // every other student's expired row invisible to this probe.
      const outsider = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      expect(
        await SubscriptionRepository.hasUncoveredExpiredLane(outsider.userId, SubscriptionCreditLane.Hifz, tx)
      ).toBe(false);

      // Lane scoping: the same student's expired hifz lane says nothing
      // about the tajweed lane.
      expect(
        await SubscriptionRepository.hasUncoveredExpiredLane(lone.userId, SubscriptionCreditLane.Tajweed, tx)
      ).toBe(false);

      // A lagging active row (window already closed, sweep not yet run)
      // does NOT count as coverage — the sweep owns that transition.
      const lagging = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz);
      await createTestSubscription(tx, lagging.userId, lagging.planId, {
        status: SubscriptionStatus.Expired,
        startDate: past(60),
        endDate: past(30),
      });
      await createTestSubscription(tx, lagging.userId, lagging.planId, {
        status: SubscriptionStatus.Active,
        startDate: past(60),
        endDate: past(30),
      });
      expect(
        await SubscriptionRepository.hasUncoveredExpiredLane(lagging.userId, SubscriptionCreditLane.Hifz, tx)
      ).toBe(true);
    });
  });
});
