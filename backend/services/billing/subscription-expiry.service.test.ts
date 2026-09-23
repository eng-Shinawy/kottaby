/**
 * SubscriptionExpiryService tests — the system-scope expiry sweep (one
 * transaction, one captured `now`, the guarded batch flip, the batched
 * plan-lane resolution, and the conditional same-transaction lane zeroing)
 * against the live database on REAL repositories.
 *
 * Per `backend/db/test/AGENTS.md` (the DB-backed service-test rules the
 * sibling suites apply):
 *  - Every transactional case runs inside `runInRollback`; the `tx` is
 *    propagated to the service as its `outerTx` seam so the whole sweep
 *    executes as a SAVEPOINT on the caller's transaction. The exceptions
 *    are the true-concurrency chaos cases, which need REAL independent
 *    transactions (committed fixtures + FK-ordered teardown below).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data.
 *  - NO `expect(...).rejects.toThrow()` — the induced mid-cohort failure
 *    is asserted through a try/catch helper, never through a pinned
 *    rejection inside the rollback wrapper.
 *  - Log seams are SPIED (never real output assertions): every spy is
 *    tracked and restored per test (bun reuses ONE mock per object+method
 *    pair until restored).
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): an empty cohort sweeps to honest zero
 *    counts with no error noise; a NULL-lane plan skips zeroing with one
 *    correlated warning while its subscription still flips (fail-safe,
 *    not fail-silent); two expired subscriptions on ONE (student, lane)
 *    settle with exactly ONE zeroing attempt (dedupe); a mixed cohort
 *    reports honest counts — `expired` counts only the flipped rows and
 *    `lanesZeroed` counts only the guarded statements that matched, with
 *    a still-covered lane (second ACTIVE subscription on the lane) counted
 *    as nothing and a `pending` row excluded from the flip.
 *  - Tier 2 (boundary): an `end_date` equal to the pre-sweep instant is
 *    due (the inclusive window close) while a future `end_date` is not.
 *    The millisecond-equality probe (`end_date == now`) is pinned at the
 *    repository layer where the comparison instant is a caller argument;
 *    the service captures its own clock inside the transaction, so this
 *    suite pins the observable: an already-arrived window close is swept,
 *    a future one never is. The trial balance survives every zeroing
 *    (structural INV-B3 exemption — no map member, never a target).
 *  - Tier 3 (chaos): two concurrent production sweeps on independent
 *    transactions converge — the flip set is partitioned by the row locks
 *    (one flips, the loser matches zero) and the terminal state is
 *    identical either way (no torn cohort, no double zeroing); the sweep
 *    races a booking-style lane debit — the row lock serializes the two
 *    guarded statements, so exactly the seeded units disappear (debit
 *    first ⇒ zeroing burns the remainder, sweep first ⇒ the debit misses),
 *    never negative, never double-spent, never half-zeroed; the atomicity
 *    probe — an induced mid-cohort zeroing failure rolls the WHOLE cohort
 *    back (flip included), leaving every subscription active and every
 *    balance intact on the outer transaction.
 *  - Tier 4 (abuse): not applicable at this layer — the sweep carries no
 *    caller input to abuse (system-scope, actor-less; the route layer owns
 *    the bearer/trust-boundary abuse surface).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository, SubscriptionRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SubscriptionCreditLane } from "@/backend/enum/billing/subscription-credit-lane.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { logger } from "@/backend/lib/logger";
import { SubscriptionExpiryService } from "@/backend/services/billing/subscription-expiry.service";
import type {
  DBTransaction,
  PlanSelectType,
  StudentSelectType,
  SubscriptionSelectType,
  UserSelectType,
} from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

/** Concurrent-transaction cases run ONLY on a real multi-connection PostgreSQL. */
const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

/** One day in milliseconds — the fixture backdating unit. */
const MS_PER_DAY = 86_400_000;

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy is registered here and
 * restored by the file-level `afterEach`.
 */
const trackedSpies: Array<{ restore(): void }> = [];

function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
  trackedSpies.push({ restore: () => spy.mockRestore() });
  return spy;
}

afterEach(() => {
  for (const entry of trackedSpies) {
    entry.restore();
  }
  trackedSpies.length = 0;
});

/** One student actor plus one plan crediting the requested lane. */
interface LaneSubscriber {
  readonly user: UserSelectType;
  readonly student: StudentSelectType;
  readonly plan: PlanSelectType;
}

async function createLaneSubscriber(
  tx: DBTransaction,
  lane: SubscriptionCreditLane | null,
  studentOverrides: Partial<StudentSelectType> = {}
): Promise<LaneSubscriber> {
  const user = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, user.id, studentOverrides);
  const plan = await createTestPlan(tx, { balanceLane: lane, sessionCount: 5, intervalDays: 30 });
  return { user, student, plan };
}

/** A past-window `active` subscription: a 30-day window that closed `daysBack` ago. */
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

/** Read-back oracle: subscription id → current row status (on the tx). */
async function readStatuses(tx: DBTransaction, ids: number[]): Promise<Map<number, SubscriptionSelectType["status"]>> {
  const rows = await tx
    .select({ id: subscriptions.id, status: subscriptions.status })
    .from(subscriptions)
    .where(inArray(subscriptions.id, ids));
  return new Map(rows.map(row => [row.id, row.status]));
}

/** Read-back oracle: the student's live balance lanes (on the tx). */
async function readBalances(tx: DBTransaction, studentId: number): Promise<StudentSelectType> {
  const rows = await tx.select().from(students).where(eq(students.id, studentId)).limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error("fixture vanished: student row not found");
  }
  return row;
}

/**
 * Try/catch helper for asserting that the sweep aborts — the rollback-safe
 * replacement for a pinned rejection (which deadlocks inside
 * `runInRollback`).
 */
async function expectSweepFailure(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  expect(errorCaught).not.toBeNull();
  if (!(errorCaught instanceof Error)) {
    throw new Error("sweep failure was not an Error instance");
  }
  return errorCaught;
}

/**
 * Call-through spy on the zeroing seam — every call still performs the real
 * guarded statement, while the test observes the attempt count (the dedupe
 * proof) at the exact seam the sweep drives.
 */
function spyZeroLaneCallThrough(): ReturnType<typeof spyOn> {
  const original = StudentRepository.zeroLaneIfNoCoveringSubscription;
  const spy = trackSpy(spyOn(StudentRepository, "zeroLaneIfNoCoveringSubscription"));
  spy.mockImplementation((studentId: number, lane: SubscriptionCreditLane, tx?: DBTransaction) =>
    original(studentId, lane, tx)
  );
  return spy;
}

/**
 * Scopes the sweep's repository claim seam to the test's fixture users —
 * the REAL guarded flip still runs (the query, its row locks, and the
 * rollback semantics stay fully exercised), but the claimed projections
 * are filtered to the fixture owners before the service settles them, so
 * the exact sweep-count assertions are isolated from unrelated committed
 * due rows (own-commit suites on the same shared test database may hold
 * due rows this file never created). An empty scope short-circuits to an
 * empty claim set without touching the database — the hermetic
 * empty-cohort stub. Restored per test via the tracked-spy `afterEach`.
 */
function scopeSweepToUsers(userIds: readonly number[]): ReturnType<typeof spyOn> {
  const original = SubscriptionRepository.expireDueActive;
  const spy = trackSpy(spyOn(SubscriptionRepository, "expireDueActive"));
  spy.mockImplementation(async (now: Date, tx?: DBTransaction) => {
    if (userIds.length === 0) {
      return [];
    }
    const claimed = await original(now, tx);
    return claimed.filter(row => userIds.includes(row.userId));
  });
  return spy;
}

describe("SubscriptionExpiryService — sweep branches (Tier 1)", () => {
  test("empty cohort: honest zero counts, no error noise", async () => {
    await runInRollback(async tx => {
      const errorSpy = trackSpy(spyOn(logger, "error"));
      scopeSweepToUsers([]);

      const sweep = await SubscriptionExpiryService.expireDue(tx);

      expect(sweep).toEqual({ expired: 0, lanesZeroed: 0 });
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  test("NULL-lane plan: the subscription still flips, zeroing is skipped with one correlated warning", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { user, student, plan } = await createLaneSubscriber(tx, null, { balanceHifz: 2, balanceTrial: 4 });
      const past = await createPastWindowActive(tx, user.id, plan.id, now, 30);
      const warnSpy = trackSpy(spyOn(logger, "warn"));
      scopeSweepToUsers([user.id]);

      const sweep = await SubscriptionExpiryService.expireDue(tx);

      expect(sweep).toEqual({ expired: 1, lanesZeroed: 0 });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      const [warnMessage] = warnSpy.mock.calls[0] ?? [];
      expect(warnMessage).toContain("no credited lane");

      // The flip stands; the (unknown-lane) zeroing is withheld and NO
      // balance moved — fail-safe, not fail-silent.
      expect((await readStatuses(tx, [past.id])).get(past.id)).toBe(SubscriptionStatus.Expired);
      const balances = await readBalances(tx, student.id);
      expect(balances.balanceHifz).toBe(2);
      expect(balances.balanceTrial).toBe(4);
    });
  });

  test("dedupe: two expired subscriptions on one (student, lane) settle with exactly ONE zeroing attempt", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { user, student, plan } = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz, {
        balanceHifz: 3,
      });
      const secondPlan = await createTestPlan(tx, { balanceLane: SubscriptionCreditLane.Hifz });
      const first = await createPastWindowActive(tx, user.id, plan.id, now, 30);
      const second = await createPastWindowActive(tx, user.id, secondPlan.id, now, 10);
      const zeroSpy = spyZeroLaneCallThrough();
      scopeSweepToUsers([user.id]);

      const sweep = await SubscriptionExpiryService.expireDue(tx);

      expect(sweep).toEqual({ expired: 2, lanesZeroed: 1 });
      expect(zeroSpy).toHaveBeenCalledTimes(1);

      const statuses = await readStatuses(tx, [first.id, second.id]);
      expect(statuses.get(first.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(second.id)).toBe(SubscriptionStatus.Expired);
      expect((await readBalances(tx, student.id)).balanceHifz).toBe(0);
    });
  });

  test("mixed cohort: honest counts — flips counted as flips, matched zeroings as zeroings, coverage counted as nothing", async () => {
    await runInRollback(async tx => {
      const now = new Date();

      // Student A: uncovered hifz plan → zeroed; trial balance must survive.
      const subscriberA = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz, {
        balanceHifz: 2,
        balanceTrial: 4,
      });
      const lanelessPlanA = await createTestPlan(tx, { balanceLane: null });
      const expiredA = await createPastWindowActive(tx, subscriberA.user.id, subscriberA.plan.id, now, 30);
      // A stale `pending` row is never sweep-eligible — excluded from the
      // flip. It rides a lane-less plan so it cannot cover A's hifz lane.
      const stalePending = await createTestSubscription(tx, subscriberA.user.id, lanelessPlanA.id, {
        status: SubscriptionStatus.Pending,
        startDate: new Date(now.getTime() - 60 * MS_PER_DAY),
        endDate: new Date(now.getTime() - 30 * MS_PER_DAY),
      });

      // Student B: expired hifz plan, but a second ACTIVE in-window
      // subscription still covers the lane → NOT zeroed (shared-lane guard).
      const subscriberB = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz, { balanceHifz: 6 });
      const expiredB = await createPastWindowActive(tx, subscriberB.user.id, subscriberB.plan.id, now, 40);
      const covering = await createTestSubscription(tx, subscriberB.user.id, subscriberB.plan.id, {
        status: SubscriptionStatus.Active,
        startDate: new Date(now.getTime() - 5 * MS_PER_DAY),
        endDate: new Date(now.getTime() + 25 * MS_PER_DAY),
      });

      // Student C: uncovered tajweed plan → zeroed.
      const subscriberC = await createLaneSubscriber(tx, SubscriptionCreditLane.Tajweed, { balanceTajweed: 5 });
      const expiredC = await createPastWindowActive(tx, subscriberC.user.id, subscriberC.plan.id, now, 20);

      scopeSweepToUsers([subscriberA.user.id, subscriberB.user.id, subscriberC.user.id]);
      const sweep = await SubscriptionExpiryService.expireDue(tx);

      expect(sweep).toEqual({ expired: 3, lanesZeroed: 2 });

      const statuses = await readStatuses(tx, [expiredA.id, stalePending.id, expiredB.id, covering.id, expiredC.id]);
      expect(statuses.get(expiredA.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(stalePending.id)).toBe(SubscriptionStatus.Pending);
      expect(statuses.get(expiredB.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(covering.id)).toBe(SubscriptionStatus.Active);
      expect(statuses.get(expiredC.id)).toBe(SubscriptionStatus.Expired);

      const balancesA = await readBalances(tx, subscriberA.student.id);
      expect(balancesA.balanceHifz).toBe(0);
      expect(balancesA.balanceTrial).toBe(4);
      expect((await readBalances(tx, subscriberB.student.id)).balanceHifz).toBe(6);
      expect((await readBalances(tx, subscriberC.student.id)).balanceTajweed).toBe(0);
    });
  });
});

describe("SubscriptionExpiryService — window boundary (Tier 2)", () => {
  test("an end date equal to the pre-sweep instant is due; a future end date is not", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const { user, student, plan } = await createLaneSubscriber(tx, SubscriptionCreditLane.Reviews, {
        balanceReviews: 3,
      });
      // endDate captured at setup — by the time the sweep's internal clock
      // is read inside the transaction, the window has already closed; the
      // inclusive comparison must claim it. The in-window companion rides a
      // lane-less plan so it cannot cover the reviews lane.
      const lanelessPlan = await createTestPlan(tx, { balanceLane: null });
      const boundary = await createTestSubscription(tx, user.id, plan.id, {
        status: SubscriptionStatus.Active,
        startDate: new Date(now.getTime() - 30 * MS_PER_DAY),
        endDate: now,
      });
      const justInside = await createTestSubscription(tx, user.id, lanelessPlan.id, {
        status: SubscriptionStatus.Active,
        startDate: now,
        endDate: new Date(now.getTime() + 60 * 60 * 1000),
      });

      scopeSweepToUsers([user.id]);
      const sweep = await SubscriptionExpiryService.expireDue(tx);

      expect(sweep).toEqual({ expired: 1, lanesZeroed: 1 });
      const statuses = await readStatuses(tx, [boundary.id, justInside.id]);
      expect(statuses.get(boundary.id)).toBe(SubscriptionStatus.Expired);
      expect(statuses.get(justInside.id)).toBe(SubscriptionStatus.Active);
      expect((await readBalances(tx, student.id)).balanceReviews).toBe(0);
    });
  });
});

describe("SubscriptionExpiryService — atomicity (Tier 3: rollback probe)", () => {
  test("an induced mid-cohort zeroing failure rolls the WHOLE cohort back — nothing half-swept", async () => {
    await runInRollback(async tx => {
      const now = new Date();
      const subscriberA = await createLaneSubscriber(tx, SubscriptionCreditLane.Hifz, { balanceHifz: 2 });
      const expiredA = await createPastWindowActive(tx, subscriberA.user.id, subscriberA.plan.id, now, 30);
      const subscriberB = await createLaneSubscriber(tx, SubscriptionCreditLane.Tajweed, { balanceTajweed: 4 });
      const expiredB = await createPastWindowActive(tx, subscriberB.user.id, subscriberB.plan.id, now, 40);

      const errorSpy = trackSpy(spyOn(logger, "error"));
      const original = StudentRepository.zeroLaneIfNoCoveringSubscription;
      const zeroSpy = trackSpy(spyOn(StudentRepository, "zeroLaneIfNoCoveringSubscription"));
      zeroSpy.mockImplementation((studentId: number, lane: SubscriptionCreditLane, innerTx?: DBTransaction) => {
        if (studentId === subscriberB.student.id) {
          throw new Error("induced zeroing failure");
        }
        return original(studentId, lane, innerTx);
      });
      scopeSweepToUsers([subscriberA.user.id, subscriberB.user.id]);

      const caught = await expectSweepFailure(() => SubscriptionExpiryService.expireDue(tx));

      expect(caught.message).toContain("induced zeroing failure");
      expect(errorSpy).not.toHaveBeenCalled();

      // The savepoint rolled back: the flip that HAD already matched inside
      // the sweep is undone — every row back to `active`, every balance
      // intact, and the outer transaction still usable for these read-backs.
      const statuses = await readStatuses(tx, [expiredA.id, expiredB.id]);
      expect(statuses.get(expiredA.id)).toBe(SubscriptionStatus.Active);
      expect(statuses.get(expiredB.id)).toBe(SubscriptionStatus.Active);
      expect((await readBalances(tx, subscriberA.student.id)).balanceHifz).toBe(2);
      expect((await readBalances(tx, subscriberB.student.id)).balanceTajweed).toBe(4);
    });
  });
});

describe("SubscriptionExpiryService — true concurrency (Tier 3: independent transactions)", () => {
  testOnRealPostgres(
    "concurrent sweeps on independent transactions: the flip set partitions across row locks, terminal state identical",
    async () => {
      // Committed fixtures — the production path opens its OWN transaction
      // per call, so the race needs real committed entities.
      const fixture = await db.transaction(async fixtureTx => {
        const subscriberA = await createLaneSubscriber(fixtureTx, SubscriptionCreditLane.Hifz, { balanceHifz: 3 });
        const subscriberB = await createLaneSubscriber(fixtureTx, SubscriptionCreditLane.Tajweed, {
          balanceTajweed: 5,
          balanceTrial: 2,
        });
        const subA = await createPastWindowActive(fixtureTx, subscriberA.user.id, subscriberA.plan.id, new Date(), 30);
        const subB = await createPastWindowActive(fixtureTx, subscriberB.user.id, subscriberB.plan.id, new Date(), 40);
        return {
          userA: subscriberA.user.id,
          userB: subscriberB.user.id,
          planA: subscriberA.plan.id,
          planB: subscriberB.plan.id,
          studentA: subscriberA.student.id,
          studentB: subscriberB.student.id,
          subA: subA.id,
          subB: subB.id,
        };
      });

      try {
        scopeSweepToUsers([fixture.userA, fixture.userB]);
        const attempts = await Promise.allSettled([
          SubscriptionExpiryService.expireDue(),
          SubscriptionExpiryService.expireDue(),
        ]);

        // Neither sweep may reject — a lost race is a zero-row no-op, never
        // an error.
        expect(attempts.every(entry => entry.status === "fulfilled")).toBe(true);
        const sweeps = attempts.map(entry => (entry.status === "fulfilled" ? entry.value : null));
        // The cohort partitions across the row locks: every row is claimed
        // by EXACTLY one sweep, and both zeroings land exactly once.
        const totalExpired = sweeps.reduce((sum, sweep) => sum + (sweep?.expired ?? 0), 0);
        const totalZeroed = sweeps.reduce((sum, sweep) => sum + (sweep?.lanesZeroed ?? 0), 0);
        expect(totalExpired).toBe(2);
        expect(totalZeroed).toBe(2);

        // Identical terminal state either way — no torn cohort.
        const statuses = await db
          .select({ id: subscriptions.id, status: subscriptions.status })
          .from(subscriptions)
          .where(inArray(subscriptions.id, [fixture.subA, fixture.subB]));
        expect(new Map(statuses.map(row => [row.id, row.status]))).toEqual(
          new Map([
            [fixture.subA, SubscriptionStatus.Expired],
            [fixture.subB, SubscriptionStatus.Expired],
          ])
        );
        const balanceA = await db.select().from(students).where(eq(students.id, fixture.studentA)).limit(1);
        expect(balanceA[0]?.balanceHifz).toBe(0);
        const balanceB = await db.select().from(students).where(eq(students.id, fixture.studentB)).limit(1);
        expect(balanceB[0]?.balanceTajweed).toBe(0);
        expect(balanceB[0]?.balanceTrial).toBe(2);
      } finally {
        // FK-ordered teardown of the committed fixtures.
        await db.delete(subscriptions).where(inArray(subscriptions.userId, [fixture.userA, fixture.userB]));
        await db.delete(plans).where(inArray(plans.id, [fixture.planA, fixture.planB]));
        await db.delete(students).where(inArray(students.id, [fixture.studentA, fixture.studentB]));
        await db.delete(users).where(inArray(users.id, [fixture.userA, fixture.userB]));
      }
    }
  );

  testOnRealPostgres(
    "sweep races a booking-style lane debit: the row lock serializes them — never double-spent, never half-zeroed",
    async () => {
      const fixture = await db.transaction(async fixtureTx => {
        const subscriber = await createLaneSubscriber(fixtureTx, SubscriptionCreditLane.Hifz, { balanceHifz: 2 });
        const sub = await createPastWindowActive(fixtureTx, subscriber.user.id, subscriber.plan.id, new Date(), 30);
        return {
          user: subscriber.user.id,
          plan: subscriber.plan.id,
          student: subscriber.student.id,
          sub: sub.id,
          seeded: 2,
        };
      });

      try {
        scopeSweepToUsers([fixture.user]);
        const [sweepOutcome, debitOutcome] = await Promise.allSettled([
          SubscriptionExpiryService.expireDue(),
          StudentRepository.decrementLaneIfAvailable(fixture.student, HeldBalanceLane.Hifz),
        ]);

        expect(sweepOutcome.status).toBe("fulfilled");
        expect(debitOutcome.status).toBe("fulfilled");
        const sweep = sweepOutcome.status === "fulfilled" ? sweepOutcome.value : null;
        const debited = debitOutcome.status === "fulfilled" ? debitOutcome.value : null;

        // Whichever order the row lock imposes: the flip claims the row, the
        // zeroing matches (the debit either consumed one unit first or missed
        // entirely) — so the lane burns down to EXACTLY zero, one unit per
        // guarded statement, never negative, never double-spent.
        expect(sweep).toEqual({ expired: 1, lanesZeroed: 1 });
        expect(typeof debited).toBe("boolean");
        const balance = await db.select().from(students).where(eq(students.id, fixture.student)).limit(1);
        expect(balance[0]?.balanceHifz).toBe(0);
        const rows = await db.select().from(subscriptions).where(eq(subscriptions.id, fixture.sub)).limit(1);
        expect(rows[0]?.status).toBe(SubscriptionStatus.Expired);
      } finally {
        await db.delete(subscriptions).where(eq(subscriptions.userId, fixture.user));
        await db.delete(plans).where(eq(plans.id, fixture.plan));
        await db.delete(students).where(eq(students.id, fixture.student));
        await db.delete(users).where(eq(users.id, fixture.user));
      }
    }
  );
});
