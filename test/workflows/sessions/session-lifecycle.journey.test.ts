/**
 * Journey J1 — Full Happy Lifecycle (cross-actor session workflow).
 *
 * The canonical request → hold → start → complete arc plus a bookend
 * cancel-with-refund leg, executed SEQUENTIALLY through the real
 * `SessionLifecycleService` (production transaction path — no outer tx) on
 * the real test database, with every step attributed to a different real
 * actor from one committed fixture cast (real `users.role` values + real
 * role-child rows; authorization and ownership resolve through the same
 * row-side predicates production uses — never monkey-patched).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - NO `runInRollback` — fixtures commit in `beforeAll`; every row
 *    (fixtures AND service-created sessions/claims) is registered in a
 *    `SessionFixtureRegistry` and hard-deleted FK-safely in `afterAll`.
 *  - Per-run `jrn_sessions_<8hex>` prefix on user labels and idempotency
 *    keys — repeated or parallel runs never collide.
 *  - Negative steps fail through the REAL service denials, asserted by
 *    `DomainError.code` + the exact translated message (try/catch helper —
 *    never `expect(...).rejects.toThrow()`).
 *  - REQ-019 (zero side effects): this surface dispatches nothing and the
 *    journey EXPECTS no dispatch, so every mutating step proves
 *    side-effect absence by ROW-COUNT DELTAS through the helper counters
 *    (notifications, audit logs, wallets, teacher transactions), scoped to
 *    fixture ids so pre-existing shared-DB rows can never satisfy a delta.
 *  - REQ-J6 (zero residual state): the suite is verified by TWO
 *    consecutive green runs — the second run rebuilds a fresh cast with
 *    fresh ids/keys and observes none of the first run's rows.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/session-lifecycle.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import type { SessionReturnType, SessionSubmitInput } from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS, SESSION_FEE_HIFZ } from "@/shared/constants/session-fees.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  buildSessionJourneyCast,
  countAuditLogsForActor,
  countNotificationsForUser,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
} from "@/test/workflows/helpers";

/**
 * The journey runs on the default test locale throughout.
 */
const LOCALE = "en";

/**
 * Idempotency keys K1 (Student A) and K2 (Student B) — per-run unique via
 * the journey prefix, carried verbatim into the service (never trimmed,
 * never coerced).
 */
const JOURNEY_PREFIX = journeyPrefix("sessions");
const KEY_A = `${JOURNEY_PREFIX}-studentA-k1`;
const KEY_B = `${JOURNEY_PREFIX}-studentB-k2`;

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** Session A — booked by Student A under key K1 (the start→complete leg). */
let sessionA: SessionReturnType;

/** Session B — booked by Student B under key K2 (the cancel-refund leg). */
let sessionB: SessionReturnType;

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

/** Narrows a nullable read to a row, failing loudly when null. */
function requiredSessionRow(value: SessionReturnType | null, label: string): SessionReturnType {
  if (value === null) {
    throw new Error(`journey: expected a visible session row for ${label}`);
  }
  return value;
}

/** Narrows a nullable timestamp, failing loudly when null. */
function requiredDate(value: Date | null, label: string): Date {
  if (value === null) {
    throw new Error(`journey: expected non-null ${label}`);
  }
  return value;
}

/** Finds one listed session by id (list order is not part of any contract). */
function listedItemById(items: readonly SessionReturnType[], id: number): SessionReturnType | undefined {
  return items.find(item => item.id === id);
}

/** Reads the student's escrow-lane balances straight from the row. */
async function readStudentLanes(studentId: number): Promise<{
  trial: number;
  hifz: number | null;
  tajweed: number | null;
}> {
  const rows = await db
    .select({
      trial: students.balanceTrial,
      hifz: students.balanceHifz,
      tajweed: students.balanceTajweed,
    })
    .from(students)
    .where(eq(students.id, studentId));
  const row = rows[0];
  if (!row) {
    throw new Error(`journey: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Counts the sessions scoped to one journey teacher (owner-side truth). */
async function countTeacherSessions(teacherUserId: number): Promise<number> {
  return db.$count(session, eq(session.teacherId, teacherUserId));
}

/** Counts the idempotency claims spent under one key. */
async function countClaimsForKey(key: string): Promise<number> {
  return db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.idempotencyKey, key));
}

/** Counts the idempotency claims owned by one user. */
async function countClaimsForUser(userId: number): Promise<number> {
  return db.$count(sessionRequestIdempotency, eq(sessionRequestIdempotency.userId, userId));
}

/**
 * Row-count snapshot of every external-effect table the lifecycle surface
 * could touch (REQ-019): notifications per actor, audit logs per actor,
 * the teacher's wallet rows and teacher-transaction ledger rows. All
 * counters are scoped to fixture user ids.
 */
interface SideEffectSnapshot {
  readonly notificationsStudentA: number;
  readonly notificationsStudentB: number;
  readonly notificationsTeacher: number;
  readonly auditStudentA: number;
  readonly auditStudentB: number;
  readonly auditTeacher: number;
  readonly teacherWalletRows: number;
  readonly teacherTransactionRows: number;
}

/** Captures the side-effect snapshot for the current cast. */
async function sideEffectSnapshot(currentCast: SessionJourneyCast): Promise<SideEffectSnapshot> {
  return {
    notificationsStudentA: await countNotificationsForUser(currentCast.primaryStudent.userId),
    notificationsStudentB: await countNotificationsForUser(currentCast.secondStudent.userId),
    notificationsTeacher: await countNotificationsForUser(currentCast.teacher.userId),
    auditStudentA: await countAuditLogsForActor(currentCast.primaryStudent.userId),
    auditStudentB: await countAuditLogsForActor(currentCast.secondStudent.userId),
    auditTeacher: await countAuditLogsForActor(currentCast.teacher.userId),
    teacherWalletRows: await countWalletsForTeacher(currentCast.teacher.userId),
    teacherTransactionRows: await countTeacherTransactionsForTeacher(currentCast.teacher.userId),
  };
}

/** Asserts a step produced ZERO deltas on every side-effect counter. */
function expectZeroSideEffectDeltas(before: SideEffectSnapshot, after: SideEffectSnapshot): void {
  expect(after.notificationsStudentA).toBe(before.notificationsStudentA);
  expect(after.notificationsStudentB).toBe(before.notificationsStudentB);
  expect(after.notificationsTeacher).toBe(before.notificationsTeacher);
  expect(after.auditStudentA).toBe(before.auditStudentA);
  expect(after.auditStudentB).toBe(before.auditStudentB);
  expect(after.auditTeacher).toBe(before.auditTeacher);
  expect(after.teacherWalletRows).toBe(before.teacherWalletRows);
  expect(after.teacherTransactionRows).toBe(before.teacherTransactionRows);
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string, label: string): Promise<void> {
  const rows = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  const claim = rows[0];
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${label} not found (fixture tracking failure)`);
  }
  registry.track("session_request_idempotency", claim.id);
}

/**
 * Asserts the session's confirmation deadline is the captured creation
 * instant + 24h EXACTLY: the service derives it from one instant captured
 * between the bracketing reads, so `deadline` must lie inside
 * [before + 24h, after + 24h] (REQ-022, B.2).
 */
function expectDeadlineWindow(deadline: Date, before: Date, after: Date): void {
  const deadlineMs = deadline.getTime();
  expect(deadlineMs).toBeGreaterThanOrEqual(before.getTime() + SESSION_CONFIRMATION_WINDOW_MS);
  expect(deadlineMs).toBeLessThanOrEqual(after.getTime() + SESSION_CONFIRMATION_WINDOW_MS);
}

/**
 * Asserts the common server-owned shape of a freshly booked session row:
 * scheduled, student-session type, Hifz intent, the platform fee carried
 * verbatim, the hold marker with its trial-lane provenance, and every
 * lifecycle/confirmation stamp still unwritten.
 */
function expectBookedShape(row: SessionReturnType, booking: SessionSubmitInput, expectedStudentId: number): void {
  expect(row.teacherId).toBe(booking.teacherId);
  expect(row.studentId).toBe(expectedStudentId);
  expect(row.status).toBe(SessionStatus.Scheduled);
  expect(row.sessionType).toBe(SessionType.StudentSession);
  expect(row.intent).toBe(SessionIntent.Hifz);
  expect(row.fee).toBe(SESSION_FEE_HIFZ);
  expect(row.feeHeld).toBe(true);
  expect(row.heldBalanceLane).toBe(HeldBalanceLane.Trial);
  expect(row.startedAt).toBeNull();
  expect(row.endedAt).toBeNull();
  expect(row.confirmedByStudentAt).toBeNull();
  expect(row.confirmedByTeacherAt).toBeNull();
  expect(row.confirmationDeadline).not.toBeNull();
}

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: JOURNEY_PREFIX,
      // Student A: trial + 1 hifz unit (the funded booker). Student B:
      // trial only (his booking must bind HIS trial lane).
      primaryStudent: { trial: 1, hifz: 1 },
      secondStudent: { trial: 1 },
    });
  });
});

afterAll(async () => {
  // Hard-deletes every tracked fixture AND service-created row (sessions,
  // idempotency claims) inside one committed transaction, FK-safe order.
  await registry.cleanup();
});

describe("Journey J1 — Full Happy Lifecycle (cross-actor, real services)", () => {
  test("step 1 — fixture cast commits as tracked ids with real role rows (INV-TV1 by construction)", async () => {
    expect(cast).toBeDefined();
    expect(registry.trackedCount()).toBe(14);
    expect(registry.ids("users")).toHaveLength(7);
    expect(registry.ids("students")).toHaveLength(2);
    expect(registry.ids("teacher")).toHaveLength(2);
    expect(registry.ids("applicants")).toHaveLength(1);
    expect(registry.ids("parents")).toHaveLength(1);
    expect(registry.ids("admin")).toHaveLength(1);

    // Real role-child rows, honest certification only.
    expect(cast.teacher.teacher.isApproved).toBe(true);
    expect(cast.secondTeacher.teacher.isApproved).toBe(true);

    // The applicant holds a teacher-role user + a REAL applicants row and
    // deliberately NO teacher row — booking impossibility by construction.
    expect(cast.applicant.user.role).toBe("teacher");
    expect(await db.$count(teacher, eq(teacher.id, cast.applicant.userId))).toBe(0);
  });

  test("step 2 — Student A books T (Hifz, key K1): scheduled, trial-lane hold, fee, 24h deadline; trial consumed BEFORE paid", async () => {
    const before = await sideEffectSnapshot(cast);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesBefore.trial).toBe(1);
    expect(lanesBefore.hifz).toBe(1);

    const bookingA: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    const callStart = new Date();
    sessionA = await SessionLifecycleService.createSession(cast.primaryStudent.userId, bookingA, KEY_A, LOCALE);
    const callEnd = new Date();

    expectBookedShape(sessionA, bookingA, cast.primaryStudent.student.id);
    expectDeadlineWindow(
      requiredDate(sessionA.confirmationDeadline, "sessionA.confirmationDeadline"),
      callStart,
      callEnd
    );

    // The trial lane was consumed BEFORE the paid lane: trial 1→0 while the
    // hifz unit stays untouched (the debit ladder's trial-first ordering).
    const lanesAfter = await readStudentLanes(cast.primaryStudent.student.id);
    expect(lanesAfter.trial).toBe(0);
    expect(lanesAfter.hifz).toBe(1);
    expect(lanesAfter.tajweed).toBe(0);

    registry.track("session", sessionA.id);
    await trackIdempotencyClaim(KEY_A, "key K1 (Student A)");

    expect(await countClaimsForKey(KEY_A)).toBe(1);
    expect(await countClaimsForUser(cast.primaryStudent.userId)).toBe(1);
    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));
  });

  test("step 2b — Student B books T (Hifz, key K2): HIS trial binds — trial-first across both bookings", async () => {
    const before = await sideEffectSnapshot(cast);
    const lanesBefore = await readStudentLanes(cast.secondStudent.student.id);
    expect(lanesBefore.trial).toBe(1);

    const bookingB: SessionSubmitInput = { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz };
    const callStart = new Date();
    sessionB = await SessionLifecycleService.createSession(cast.secondStudent.userId, bookingB, KEY_B, LOCALE);
    const callEnd = new Date();

    expect(sessionB.id).not.toBe(sessionA.id);
    expect(sessionB.status).toBe(SessionStatus.Scheduled);
    expect(sessionB.feeHeld).toBe(true);
    expect(sessionB.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(sessionB.fee).toBe(SESSION_FEE_HIFZ);
    expect(sessionB.studentId).toBe(cast.secondStudent.student.id);
    expectDeadlineWindow(
      requiredDate(sessionB.confirmationDeadline, "sessionB.confirmationDeadline"),
      callStart,
      callEnd
    );

    // B's own trial lane paid for HIS hold — the second booking in a row to
    // bind the trial lane (both bookings consumed trial units before any
    // paid lane would have been touched).
    const lanesAfter = await readStudentLanes(cast.secondStudent.student.id);
    expect(lanesAfter.trial).toBe(0);
    expect(lanesAfter.hifz).toBe(0);
    expect(lanesAfter.tajweed).toBe(0);

    registry.track("session", sessionB.id);
    await trackIdempotencyClaim(KEY_B, "key K2 (Student B)");

    expect(await countClaimsForKey(KEY_B)).toBe(1);
    expect(await countClaimsForUser(cast.secondStudent.userId)).toBe(1);
    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));
  });

  test("step 3 — cross-actor visibility: teacher sees both scheduled; each student sees own only; every other role sees NOTHING", async () => {
    // Teacher T (observer) — both sessions, scheduled, with fee + deadline.
    const teacherList = await SessionLifecycleService.listMyTeacherSessions(cast.teacher.userId, {}, 1, 25);
    expect(teacherList.totalCount).toBe(2);
    expect(teacherList.items).toHaveLength(2);
    const teacherViewA = listedItemById(teacherList.items, sessionA.id);
    const teacherViewB = listedItemById(teacherList.items, sessionB.id);
    if (!teacherViewA || !teacherViewB) {
      throw new Error("journey: teacher list is missing one of the two cast sessions");
    }
    for (const view of [teacherViewA, teacherViewB]) {
      expect(view.status).toBe(SessionStatus.Scheduled);
      expect(view.fee).toBe(SESSION_FEE_HIFZ);
      expect(view.feeHeld).toBe(true);
      expect(view.confirmationDeadline).not.toBeNull();
    }
    expect(requiredDate(teacherViewA.confirmationDeadline, "T-view deadline A").getTime()).toBe(
      requiredDate(sessionA.confirmationDeadline, "created deadline A").getTime()
    );
    expect(requiredDate(teacherViewB.confirmationDeadline, "T-view deadline B").getTime()).toBe(
      requiredDate(sessionB.confirmationDeadline, "created deadline B").getTime()
    );

    // Student A (observer) — own session ONLY; B's is invisible to him.
    const studentAList = await SessionLifecycleService.listMyStudentSessions(cast.primaryStudent.userId, {}, 1, 25);
    expect(studentAList.totalCount).toBe(1);
    expect(studentAList.items).toHaveLength(1);
    expect(studentAList.items[0]?.id).toBe(sessionA.id);
    expect(listedItemById(studentAList.items, sessionB.id)).toBeUndefined();

    // Student B (observer) — own session ONLY.
    const studentBList = await SessionLifecycleService.listMyStudentSessions(cast.secondStudent.userId, {}, 1, 25);
    expect(studentBList.totalCount).toBe(1);
    expect(studentBList.items[0]?.id).toBe(sessionB.id);

    // Every other role observes NOTHING: no list rows, no read — the
    // oracle-safe non-participant read resolves to the identical `null`
    // (foreign ≡ nonexistent). Honest row-side scoping: the service has no
    // admin/parent bypass path.
    const secondTeacherList = await SessionLifecycleService.listMyTeacherSessions(cast.secondTeacher.userId, {}, 1, 25);
    expect(secondTeacherList.totalCount).toBe(0);
    expect(secondTeacherList.items).toHaveLength(0);
    const parentList = await SessionLifecycleService.listMyStudentSessions(cast.parent.userId, {}, 1, 25);
    expect(parentList.totalCount).toBe(0);
    const adminList = await SessionLifecycleService.listMyStudentSessions(cast.admin.userId, {}, 1, 25);
    expect(adminList.totalCount).toBe(0);
    expect(await SessionLifecycleService.getSessionById(cast.parent.userId, sessionA.id)).toBeNull();
    expect(await SessionLifecycleService.getSessionById(cast.admin.userId, sessionA.id)).toBeNull();
    expect(await SessionLifecycleService.getSessionById(cast.applicant.userId, sessionA.id)).toBeNull();
    expect(await SessionLifecycleService.getSessionById(cast.secondTeacher.userId, sessionA.id)).toBeNull();
  });

  test("step 4 — Student A replays K1: ConflictError DUPLICATE_REQUEST; zero new rows; balances static; teacher list stable", async () => {
    const before = await sideEffectSnapshot(cast);
    const sessionsBefore = await countTeacherSessions(cast.teacher.userId);
    const claimsAKeyBefore = await countClaimsForKey(KEY_A);
    const claimsABefore = await countClaimsForUser(cast.primaryStudent.userId);
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);
    const teacherListBefore = await SessionLifecycleService.listMyTeacherSessions(cast.teacher.userId, {}, 1, 25);

    const caught = await expectServiceDenial("DUPLICATE_REQUEST", errorTexts().duplicateRequest, () =>
      SessionLifecycleService.createSession(
        cast.primaryStudent.userId,
        { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
        KEY_A,
        LOCALE
      )
    );
    expect(caught).toBeInstanceOf(ConflictError);

    // Zero new rows anywhere; balances static (the replayed attempt's own
    // partial writes — its debit-ladder step — rolled back with the tx).
    expect(await countTeacherSessions(cast.teacher.userId)).toBe(sessionsBefore);
    expect(await countClaimsForKey(KEY_A)).toBe(claimsAKeyBefore);
    expect(await countClaimsForUser(cast.primaryStudent.userId)).toBe(claimsABefore);
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual(lanesBefore);
    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));

    // The observer's list count is stable — the replay created nothing.
    const teacherListAfter = await SessionLifecycleService.listMyTeacherSessions(cast.teacher.userId, {}, 1, 25);
    expect(teacherListAfter.totalCount).toBe(teacherListBefore.totalCount);
    expect(teacherListAfter.totalCount).toBe(2);
  });

  test("step 5 — Teacher T starts session A: started + startedAt; Student A observes started; non-participants stay blind", async () => {
    const before = await sideEffectSnapshot(cast);
    const deadlineBefore = requiredDate(sessionA.confirmationDeadline, "sessionA.confirmationDeadline").getTime();

    const started = await SessionLifecycleService.startSession(cast.teacher.userId, sessionA.id, LOCALE);
    expect(started.id).toBe(sessionA.id);
    expect(started.status).toBe(SessionStatus.Started);
    expect(started.startedAt).not.toBeNull();
    expect(started.endedAt).toBeNull();

    // The student (other participant) observes the transition.
    const studentView = requiredSessionRow(
      await SessionLifecycleService.getSessionById(cast.primaryStudent.userId, sessionA.id),
      "Student A reading session A after start"
    );
    expect(studentView.status).toBe(SessionStatus.Started);
    expect(requiredDate(studentView.startedAt, "student-view startedAt").getTime()).toBe(
      requiredDate(started.startedAt, "teacher-view startedAt").getTime()
    );

    // The start never re-arms the confirmation deadline (REQ-022).
    sessionA = started;
    expect(requiredDate(sessionA.confirmationDeadline, "post-start deadline").getTime()).toBe(deadlineBefore);

    // Non-participants still observe NOTHING.
    expect(await SessionLifecycleService.getSessionById(cast.secondStudent.userId, sessionA.id)).toBeNull();
    expect(await SessionLifecycleService.getSessionById(cast.parent.userId, sessionA.id)).toBeNull();

    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));
  });

  test("step 6 — Teacher T completes session A: completed + endedAt + confirmedByTeacherAt + deadline UNCHANGED; ZERO wallet/ledger/notification/audit deltas", async () => {
    const before = await sideEffectSnapshot(cast);
    const rowBefore = requiredSessionRow(
      await SessionLifecycleService.getSessionById(cast.primaryStudent.userId, sessionA.id),
      "Student A reading session A before completion"
    );
    const deadlineBefore = requiredDate(rowBefore.confirmationDeadline, "pre-completion deadline").getTime();

    const completed = await SessionLifecycleService.completeSession(cast.teacher.userId, sessionA.id, LOCALE);
    expect(completed.id).toBe(sessionA.id);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.endedAt).not.toBeNull();
    expect(completed.confirmedByTeacherAt).not.toBeNull();
    expect(requiredDate(completed.endedAt, "endedAt").getTime()).toBeGreaterThanOrEqual(
      requiredDate(completed.startedAt, "startedAt").getTime()
    );

    // The completion never re-writes the confirmation deadline (B.2).
    expect(requiredDate(completed.confirmationDeadline, "post-completion deadline").getTime()).toBe(deadlineBefore);

    // Student confirmation + wallet deliberately absent (D2-owned): the
    // student-side confirmation stamp stays null and NO wallet/ledger row
    // appeared for anyone (count-delta proof, REQ-019/REQ-J2).
    expect(completed.confirmedByStudentAt).toBeNull();
    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));

    // The student (observer) sees `completed` — with no balance movement
    // observable on his side either.
    const studentView = requiredSessionRow(
      await SessionLifecycleService.getSessionById(cast.primaryStudent.userId, sessionA.id),
      "Student A reading session A after completion"
    );
    expect(studentView.status).toBe(SessionStatus.Completed);
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual({ trial: 0, hifz: 1, tajweed: 0 });

    sessionA = completed;
  });

  test("step 7 — Student B cancels session B: cancelled + feeHeld=false + HIS trial lane refunded EXACTLY once; teacher observes cancelled", async () => {
    const before = await sideEffectSnapshot(cast);
    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 0, hifz: 0, tajweed: 0 });

    const cancelled = await SessionLifecycleService.cancelSession(cast.secondStudent.userId, sessionB.id, null, LOCALE);
    expect(cancelled.id).toBe(sessionB.id);
    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(cancelled.feeHeld).toBe(false);
    // The provenance lane is retained on the row (the refund reads it) and
    // the refund went back to the EXACT SAME lane that funded the hold.
    expect(cancelled.heldBalanceLane).toBe(HeldBalanceLane.Trial);
    expect(cancelled.startedAt).toBeNull();
    expect(cancelled.endedAt).toBeNull();

    // The trial lane is restored +1 EXACTLY once (0 → 1, not 2) and no
    // other lane moved — same-lane refund, once.
    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 1, hifz: 0, tajweed: 0 });

    // Teacher T (observer) sees the cancellation in his list; A's leg is
    // still completed and untouched.
    const teacherList = await SessionLifecycleService.listMyTeacherSessions(cast.teacher.userId, {}, 1, 25);
    expect(teacherList.totalCount).toBe(2);
    const teacherViewB = listedItemById(teacherList.items, sessionB.id);
    if (!teacherViewB) {
      throw new Error("journey: teacher list is missing session B after the cancellation");
    }
    expect(teacherViewB.status).toBe(SessionStatus.Cancelled);
    expect(teacherViewB.feeHeld).toBe(false);
    expect(listedItemById(teacherList.items, sessionA.id)?.status).toBe(SessionStatus.Completed);

    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));
    sessionB = cancelled;
  });

  test("step 8 — Teacher T cancels the COMPLETED session A: SESSION_INVALID_TRANSITION; row byte-identical", async () => {
    const before = await sideEffectSnapshot(cast);
    const rowBefore = requiredSessionRow(
      await SessionLifecycleService.getSessionById(cast.primaryStudent.userId, sessionA.id),
      "Student A reading session A before the terminal cancel probe"
    );

    await expectServiceDenial("SESSION_INVALID_TRANSITION", errorTexts().sessionInvalidTransition, () =>
      SessionLifecycleService.cancelSession(cast.teacher.userId, sessionA.id, null, LOCALE)
    );

    // The terminal row is immutable: byte-identical after the denial, and
    // no lane moved anywhere (a terminal cancel never refunds).
    const rowAfter = requiredSessionRow(
      await SessionLifecycleService.getSessionById(cast.primaryStudent.userId, sessionA.id),
      "Student A reading session A after the terminal cancel probe"
    );
    expect(rowAfter).toEqual(rowBefore);
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual({ trial: 0, hifz: 1, tajweed: 0 });
    expect(await readStudentLanes(cast.secondStudent.student.id)).toEqual({ trial: 1, hifz: 0, tajweed: 0 });
    expectZeroSideEffectDeltas(before, await sideEffectSnapshot(cast));
  });

  test("step 9 — teardown worklist is complete: every service-created row is tracked for the afterAll hard-delete", () => {
    expect(registry.ids("session").toSorted((a, b) => a - b)).toEqual(
      [sessionA.id, sessionB.id].toSorted((a, b) => a - b)
    );
    expect(registry.ids("session_request_idempotency")).toHaveLength(2);
    // 14 fixture rows (7 users + 2 students + 2 teachers + 1 applicant +
    // 1 parent + 1 admin) + 2 sessions + 2 idempotency claims.
    expect(registry.trackedCount()).toBe(18);
  });
});
