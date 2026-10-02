/**
 * Journey — Session State Machine (enforcement verification slice).
 *
 * Three cross-actor arcs through the REAL `SessionLifecycleService` on the
 * production transaction path (no outer tx), with every step attributed to
 * a different real actor from one committed fixture cast:
 *
 *  J1 — dispute, arbitration, refund, lock: a `started` session is
 *       disputed by its student, appears in the admin arbitration queue,
 *       denies a duplicate dispute AND the teacher's cross-actor complete,
 *       then the admin's CANCEL resolution refunds the held lane to its
 *       provenance and lifts the INV-S6 lock — each terminal write exactly
 *       once (the repeat resolve is a denial).
 *  J2 — the INV-S6 in-session lock: an online teacher starts (⇒ offline in
 *       the same commit), then is restored by BOTH exits — the participant
 *       cancel and the teacher complete.
 *  SWEEP — the illegal-transition matrix sweep: completed→start,
 *       cancelled→cancel, cancelled→start, disputed→start,
 *       scheduled→complete — every attempt denied with the canonical
 *       `SESSION_INVALID_TRANSITION` and ZERO database delta (full-row
 *       equality before/after).
 *  RACE — two concurrent admin resolves of one disputed row: exactly one
 *       wins, the loser receives the typed conflict, the refund fires
 *       exactly once (real-PG posture — the premise is one connection per
 *       concurrent call; skipped on the single-connection PGlite sandbox
 *       exactly like the sibling suites' chaos tiers).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims) is registered in the
 *    `SessionFixtureRegistry` and hard-deleted FK-safely in `afterAll`.
 *  - Per-run `jrn_session-state-machine_<8hex>` prefix on user labels and
 *    idempotency keys — repeated or parallel runs never collide.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *  - Twice-green requirement (zero residual state): the suite is run TWO
 *    consecutive times to surface cross-test state leakage — the second
 *    run rebuilds a fresh cast with fresh ids/keys and observes none of
 *    the first run's rows.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/session-state-machine.journey.test.ts
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  NotificationDeliveryReceipt,
  SessionReturnType,
  SessionSelectType,
  SessionStudentIntentType,
  SessionSubmitInput,
} from "@/backend/types";
import { SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";
import {
  buildSessionJourneyCast,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run unique prefix — repeated/parallel runs never collide. */
const JOURNEY_PREFIX = journeyPrefix("session-state-machine");

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** The exact translated denial messages for the default test locale. */
function errorTexts() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code`. */
function denialCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a denial through the real service and asserts the typed-denial
 * contract: a `DomainError` carrying EXACTLY `code` and EXACTLY the
 * translated message (never the raw key). Returns the caught error so a
 * call site can assert the concrete subclass (e.g. `ConflictError`).
 * Fails the test when the action resolves instead of rejecting.
 */
async function expectServiceDenial(code: string, message: string, action: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown;
  try {
    await action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DomainError);
  expect(denialCode(caught)).toBe(code);
  if (caught instanceof Error) {
    expect(caught.message).toBe(message);
  }
  return caught;
}

/** Reads the FULL session row straight from the database (row-equality oracle). */
async function readFullSessionRow(sessionId: number): Promise<SessionSelectType> {
  const rows = await db.select().from(session).where(eq(session.id, sessionId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the teacher's `is_online` flag straight from the row. */
async function readTeacherOnline(teacherUserId: number): Promise<boolean | null> {
  const rows = await db.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherUserId));
  return rows[0]?.isOnline ?? null;
}

/** Forces the fixture teacher online (the J2 cast posture — committed). */
async function forceTeacherOnline(teacherUserId: number): Promise<void> {
  await db.update(teacher).set({ isOnline: true }).where(eq(teacher.id, teacherUserId));
}

/** Reads the student's escrow-lane balances straight from the row. */
async function readStudentLanes(
  studentId: number
): Promise<{ trial: number; hifz: number | null; tajweed: number | null }> {
  const rows = await db
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows[0];
  if (!claim) {
    throw new Error("journey: idempotency claim not found (fixture tracking failure)");
  }
  registry.track("session_request_idempotency", claim.id);
}

/** Books one session for the primary student on the production path and tracks it. */
async function bookSession(intent: SessionStudentIntentType, key: string): Promise<SessionReturnType> {
  const booking: SessionSubmitInput = { teacherId: cast.teacher.userId, intent };
  const booked = await SessionLifecycleService.createSession(cast.primaryStudent.userId, booking, key, LOCALE);
  registry.track("session", booked.id);
  await trackIdempotencyClaim(key);
  return booked;
}

/**
 * Installs a recording no-op over the notification engine's publish
 * contract: no realtime channel is ever touched, and each dispatch is
 * recorded together with its receipts (and recipient ids) so a step can
 * assert BOTH that a publish happened and WHICH users it targeted (the
 * layer's rule 5). Installed once in `beforeAll`, restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flatMap(receipts => receipts.flatMap(receipt => receipt.recipientUserIds));
}

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      // Two trial + four hifz units: the ladder consumes trial first, and
      // this journey books six sessions across its arcs.
      primaryStudent: { trial: 2, hifz: 4 },
    });
  });
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();
  // Hard-deletes every tracked fixture AND service-created row (sessions,
  // idempotency claims) inside one committed transaction, FK-safe order.
  await registry.cleanup();
});

// ─── Journey J1 — dispute, arbitration, refund, lock ─────────────────────

describe("Journey J1 — dispute → arbitration → lane-intact refund + unlock", () => {
  let disputedSession: SessionReturnType;
  const KEY_T1 = `${JOURNEY_PREFIX}-t1`;

  test("step 1 — student books, teacher starts; the lock takes the teacher offline", async () => {
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesBefore.trial).toBe(2);

    disputedSession = await bookSession(SessionIntent.Hifz, KEY_T1);
    expect(disputedSession.status).toBe(SessionStatus.Scheduled);
    expect(disputedSession.fee).toBe(SESSION_FEE_HIFZ);
    expect(disputedSession.feeHeld).toBe(true);
    expect(disputedSession.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect((await readStudentLanes(cast.primaryStudent.student.id)).trial).toBe(1);

    await forceTeacherOnline(cast.teacher.userId);
    const started = await SessionLifecycleService.startSession(cast.teacher.userId, disputedSession.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(false);
  });

  test("step 2 — student disputes: the row enters arbitration exactly once and the queue sees it", async () => {
    const queueBefore = await SessionLifecycleService.listAdminDisputedSessions({}, 50, 0);

    const disputed = await SessionLifecycleService.openSessionDispute(
      cast.primaryStudent.userId,
      disputedSession.id,
      "session did not match the booking",
      LOCALE
    );
    expect(disputed.status).toBe(SessionStatus.Disputed);
    expect(disputed.disputeReason).toBe("session did not match the booking");
    expect(disputed.disputedAt).not.toBeNull();
    // The hold stays frozen and the start stamp survives the dispute.
    expect(disputed.feeHeld).toBe(true);
    expect(disputed.startedAt).not.toBeNull();

    const queueAfter = await SessionLifecycleService.listAdminDisputedSessions({}, 50, 0);
    expect(queueAfter.totalCount).toBe(queueBefore.totalCount + 1);
    expect(queueAfter.items.some(item => item.id === disputedSession.id)).toBe(true);
  });

  test("step 3 — a duplicate dispute is denied with ZERO writes (row equality)", async () => {
    const before = await readFullSessionRow(disputedSession.id);
    const denial = await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.openSessionDispute(
        cast.primaryStudent.userId,
        disputedSession.id,
        "duplicate attempt",
        LOCALE
      )
    );
    expect(denial).toBeInstanceOf(ConflictError);
    expect(await readFullSessionRow(disputedSession.id)).toEqual(before);
  });

  test("step 4 — the teacher cannot complete a disputed row (cross-actor denial, zero writes)", async () => {
    const before = await readFullSessionRow(disputedSession.id);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.completeSession(cast.teacher.userId, disputedSession.id, LOCALE)
    );
    expect(await readFullSessionRow(disputedSession.id)).toEqual(before);
  });

  test("step 5 — admin resolves CANCEL: terminal, lane-intact refund, lock lifted", async () => {
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesBefore.trial).toBe(1);
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(false);

    const resolved = await SessionLifecycleService.resolveSessionDispute(
      cast.admin.userId,
      disputedSession.id,
      DisputeResolution.Cancel,
      "refunded to the student",
      LOCALE
    );
    expect(resolved.status).toBe(SessionStatus.Cancelled);
    expect(resolved.feeHeld).toBe(false);
    expect(resolved.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(resolved.resolutionNote).toBe("refunded to the student");
    expect(resolved.resolvedAt).not.toBeNull();

    // The refund returns to the RECORDED provenance lane (INV-B8): +1 trial.
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(2);
    expect(lanesAfter.hifz).toBe(lanesBefore.hifz);

    // The INV-S6 lock lifts with the arbitration exit (the row had started).
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(true);
  });

  test("step 6 — the admin repeat resolve is denied exactly-once with ZERO writes", async () => {
    const before = await readFullSessionRow(disputedSession.id);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.resolveSessionDispute(
        cast.admin.userId,
        disputedSession.id,
        DisputeResolution.Cancel,
        null,
        LOCALE
      )
    );
    expect(await readFullSessionRow(disputedSession.id)).toEqual(before);
    // The refund fired exactly once: the trial lane still holds 2 units.
    expect((await readStudentLanes(cast.primaryStudent.student.id)).trial).toBe(2);
  });
});

// ─── Journey J2 — the INV-S6 in-session lock across BOTH exits ───────────

describe("Journey J2 — in-session lock: start locks, cancel and complete both restore", () => {
  test("leg 1 — online teacher → start ⇒ offline → cancel ⇒ restored (+ lane refund)", async () => {
    const KEY_T2 = `${JOURNEY_PREFIX}-t2`;
    await forceTeacherOnline(cast.teacher.userId);
    const booked = await bookSession(SessionIntent.Hifz, KEY_T2);
    expect((await readStudentLanes(cast.primaryStudent.student.id)).trial).toBe(1);

    const started = await SessionLifecycleService.startSession(cast.teacher.userId, booked.id, LOCALE);
    expect(started.status).toBe(SessionStatus.Started);
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(false);

    const cancelled = await SessionLifecycleService.cancelSession(
      cast.primaryStudent.userId,
      booked.id,
      "cancel leg",
      LOCALE
    );
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(cancelled.startedAt).not.toBeNull();
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(true);
    expect((await readStudentLanes(cast.primaryStudent.student.id)).trial).toBe(2);
  });

  test("leg 2 — online teacher → start ⇒ offline → complete ⇒ restored (the completed leg feeds the sweep)", async () => {
    const KEY_T3 = `${JOURNEY_PREFIX}-t3`;
    await forceTeacherOnline(cast.teacher.userId);
    const booked = await bookSession(SessionIntent.Hifz, KEY_T3);
    // The trial-first ladder: both trial units were consumed-and-refunded
    // earlier, so THIS booking consumes the last trial unit; hifz is 4.
    const lanesAfterBooking = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfterBooking.trial).toBe(1);
    expect(lanesAfterBooking.hifz).toBe(4);

    await SessionLifecycleService.startSession(cast.teacher.userId, booked.id, LOCALE);
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(false);

    const publishesBefore = (publication?.calls ?? []).length;
    const completed = await SessionLifecycleService.completeSession(cast.teacher.userId, booked.id, LOCALE);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.endedAt).not.toBeNull();
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(true);
    // The completion confirm-prompt wave is published exactly once,
    // targeting the acting student (dispatch + recipient assert).
    expect(publication?.calls ?? []).toHaveLength(publishesBefore + 1);
    expect(publishedUserIds()).toContain(cast.primaryStudent.userId);
  });
});

// ─── Illegal-transition sweep — zero-write row-equality denials ──────────

describe("Sweep — every off-matrix transition denied with ZERO database delta", () => {
  let completedSessionId = 0;
  let cancelledSessionId = 0;
  let disputedSessionId = 0;
  let scheduledSessionId = 0;

  beforeAll(async () => {
    // cancelled fixture: the J2 cancel leg's row.
    const KEY_T2 = `${JOURNEY_PREFIX}-t2`;
    const claims = await db
      .select({ sessionId: sessionRequestIdempotency.sessionId })
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_T2));
    cancelledSessionId = Number(claims[0]?.sessionId);
    // completed fixture: the J2 complete leg's row.
    const KEY_T3 = `${JOURNEY_PREFIX}-t3`;
    const completedClaims = await db
      .select({ sessionId: sessionRequestIdempotency.sessionId })
      .from(sessionRequestIdempotency)
      .where(eq(sessionRequestIdempotency.idempotencyKey, KEY_T3));
    completedSessionId = Number(completedClaims[0]?.sessionId);
    // disputed fixture: booked, started, disputed — stays disputed.
    const disputed = await bookSession(SessionIntent.Hifz, `${JOURNEY_PREFIX}-t4`);
    await SessionLifecycleService.startSession(cast.teacher.userId, disputed.id, LOCALE);
    await SessionLifecycleService.openSessionDispute(cast.primaryStudent.userId, disputed.id, "sweep fixture", LOCALE);
    disputedSessionId = disputed.id;
    // scheduled fixture: booked and left pre-start.
    const scheduled = await bookSession(SessionIntent.Hifz, `${JOURNEY_PREFIX}-t5`);
    scheduledSessionId = scheduled.id;
  });

  test("completed → start is denied (INV-S1: completed is terminal), zero writes", async () => {
    const before = await readFullSessionRow(completedSessionId);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.startSession(cast.teacher.userId, completedSessionId, LOCALE)
    );
    expect(await readFullSessionRow(completedSessionId)).toEqual(before);
  });

  test("cancelled → cancel is denied (INV-S2: cancelled is terminal), zero writes", async () => {
    const before = await readFullSessionRow(cancelledSessionId);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.cancelSession(cast.primaryStudent.userId, cancelledSessionId, null, LOCALE)
    );
    expect(await readFullSessionRow(cancelledSessionId)).toEqual(before);
  });

  test("cancelled → start is denied, zero writes", async () => {
    const before = await readFullSessionRow(cancelledSessionId);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.startSession(cast.teacher.userId, cancelledSessionId, LOCALE)
    );
    expect(await readFullSessionRow(cancelledSessionId)).toEqual(before);
  });

  test("disputed → start is denied (B.18: only admin exits disputed), zero writes", async () => {
    const before = await readFullSessionRow(disputedSessionId);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.startSession(cast.teacher.userId, disputedSessionId, LOCALE)
    );
    expect(await readFullSessionRow(disputedSessionId)).toEqual(before);
  });

  test("scheduled → complete is denied (cannot complete what never started), zero writes", async () => {
    const before = await readFullSessionRow(scheduledSessionId);
    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.completeSession(cast.teacher.userId, scheduledSessionId, LOCALE)
    );
    expect(await readFullSessionRow(scheduledSessionId)).toEqual(before);
  });
});

// ─── Race — two concurrent admin resolves (real-PG posture) ──────────────

const testOnRealPostgres = isPgliteProvider() ? test.skip : test;

testOnRealPostgres(
  "Race — two concurrent admin resolves: exactly one wins, the refund fires exactly once",
  async () => {
    const KEY_T6 = `${JOURNEY_PREFIX}-t6`;
    const booked = await bookSession(SessionIntent.Hifz, KEY_T6);
    await SessionLifecycleService.startSession(cast.teacher.userId, booked.id, LOCALE);
    await SessionLifecycleService.openSessionDispute(cast.primaryStudent.userId, booked.id, "race fixture", LOCALE);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    // The start above locked the teacher offline; assert that state holds
    // BEFORE the concurrent resolutions so the final `true` below proves
    // the winning resolve is what lifted the lock (never pre-restored).
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(false);

    const outcomes = await Promise.allSettled([
      SessionLifecycleService.resolveSessionDispute(
        cast.admin.userId,
        booked.id,
        DisputeResolution.Cancel,
        null,
        LOCALE
      ),
      SessionLifecycleService.resolveSessionDispute(
        cast.admin.userId,
        booked.id,
        DisputeResolution.Cancel,
        null,
        LOCALE
      ),
    ]);

    const fulfillments = outcomes.flatMap(outcome => (outcome.status === "fulfilled" ? [outcome.value] : []));
    const rejections = outcomes.flatMap(outcome => (outcome.status === "rejected" ? [outcome.reason] : []));
    expect(fulfillments).toHaveLength(1);
    expect(rejections).toHaveLength(1);
    expect(fulfillments[0]?.status).toBe(SessionStatus.Cancelled);
    expect(rejections[0]).toBeInstanceOf(DomainError);
    expect(denialCode(rejections[0])).toBe("SESSION_INVALID_TRANSITION");

    // EXACTLY one refund landed on the recorded lane.
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect((lanesAfter.trial ?? 0) - (lanesBefore.trial ?? 0)).toBe(1);
    // The lock lifted exactly once (same-tx with the winning resolution).
    expect(await readTeacherOnline(cast.teacher.userId)).toBe(true);
  }
);
