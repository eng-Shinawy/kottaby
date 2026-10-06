/**
 * Cross-actor journey — the in-session availability lock and its
 * marker-gated release, proven END-TO-END across the real actor cast
 * (students, certified teachers, an admin) through the REAL service layer
 * against the REAL test database. Every step observes the shared state
 * earlier steps committed; every denial fails through the genuine
 * certification / in-session / governance gates (nothing monkey-patched).
 *
 * Journeys (the persisted `teacher.was_online_before_lock` marker is the
 * shared entity — the availability value in force at lock acquisition,
 * restored once the LAST started session exits and cleared to NULL):
 *
 *  - J1 (REQ-016) — book → start (locked) → denied Available toggle →
 *    complete → restored. The lock drives `is_online=false` at start and
 *    captures the pre-lock intent (`true`); the Available-direction toggle
 *    is denied `TEACHER_IN_ACTIVE_SESSION` with oracle safety (no session
 *    id anywhere in the denial payload); completion restores per the
 *    marker and clears it.
 *  - J2 (REQ-017) — never-resurrect. Variant A: a teacher who toggled
 *    Unavailable BEFORE starting stays Unavailable after completion.
 *    Variant B: a teacher Available at start who toggles Unavailable
 *    MID-session (the Unavailable direction is ungated — the toggle
 *    succeeds and the latest intent wins) stays Unavailable after
 *    completion. Both variants clear the marker.
 *  - J3 (REQ-018) — admin governance cancel releases the lock. Cancelling
 *    a STARTED session composes the marker-gated release inside the
 *    cancel's own transaction (an Available-when-locked teacher is
 *    restored) while the governance-cancel notification wave still fires
 *    exactly once. Variant: cancelling a NEVER-STARTED `scheduled` row
 *    (carrying the reschedule-polluted `started_at` residue) leaves the
 *    teacher's availability byte-untouched — the release resolves
 *    no_lock_held and writes nothing.
 *  - J4 (REQ-019) — deferred restore. Two students book the same teacher
 *    (booking has no availability gate — both bookings compose while the
 *    teacher is online) and the teacher starts BOTH (the second start
 *    re-arms the same lock — first-lock-wins). Completing session A
 *    defers the restore (`is_online` stays `false`, marker INTACT);
 *    completing session B — the last exit — restores per the ORIGINAL
 *    pre-lock marker and clears it.
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - committed fixtures in ONE `beforeAll` `db.transaction(...)`
 *    (commit-or-nothing) — NO `runInRollback` anywhere: the services own
 *    their transactions and every step observes committed state;
 *  - per-run `jrn_lock_<8hex>` prefix on every idempotency key — repeated
 *    or parallel runs never collide;
 *  - tracked hard-delete teardown: EVERY fixture row AND every row the
 *    services create (sessions, idempotency claims) is registered in the
 *    `TrackedFixtures` registry; `afterAll` sweeps the governance-cancel
 *    audit rows first (append-only table), hard-deletes every tracked row
 *    in reverse registration order (FK-safe), and re-probes the database
 *    for EVERY registered row — zero residue is mandatory, not advisory;
 *  - external effects are SPIED, never sent: the notification publish
 *    boundary (`NotificationEngine.publishReceipts`) is installed once and
 *    records every delivery receipt, so each wave is asserted both THAT it
 *    fired and WHICH recipient ids it targeted while nothing reaches a
 *    realtime channel;
 *  - denial assertions pin the code + the EXACT translated message from
 *    `getServerTranslations("en").errorsTranslations` (never raw keys,
 *    never server internals) via a try/catch helper — never
 *    `expect(...).rejects.toThrow()`;
 *  - observer-perspective outcomes are read through the direct-DB oracle
 *    `readTeacherLockState` (the persisted `is_online` + marker pair) —
 *    never through a service projection, never a spy on the services.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/in-session-lock-release.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError } from "@/backend/lib/errors";
import { SessionAdminGovernanceService } from "@/backend/services/classes/session-admin-governance";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { TeacherAvailabilityService } from "@/backend/services/teachers/teacher-availability.service";
import type { DBTransaction, NotificationDeliveryReceipt, SessionReturnType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * Default journey locale. Denial assertions pin English translated
 * substrings from the errors namespace; localized-copy parity lives in
 * the service-tier test suite.
 */
const LOCALE_EN = "en" as const;

/** Per-run journey prefix (AGENTS.md rule 3) — every booking key carries it. */
const JOURNEY_PREFIX = journeyPrefix("lock");

/** One idempotency key per booking — per-run unique, spent exactly once. */
const KEY_J1 = `${JOURNEY_PREFIX}-j1-booking`;
const KEY_J2A = `${JOURNEY_PREFIX}-j2-variant-a`;
const KEY_J2B = `${JOURNEY_PREFIX}-j2-variant-b`;
const KEY_J3_STARTED = `${JOURNEY_PREFIX}-j3-started`;
const KEY_J3_SCHEDULED = `${JOURNEY_PREFIX}-j3-scheduled`;
const KEY_J4A = `${JOURNEY_PREFIX}-j4-session-a`;
const KEY_J4B = `${JOURNEY_PREFIX}-j4-session-b`;

/** The audit row's entity label for the governance surface (the service's constant). */
const SESSION_ENTITY_TYPE = "session";

/** The persisted lock-state shape the direct-DB oracle reads. */
interface TeacherLockState {
  readonly isOnline: boolean | null;
  readonly wasOnlineBeforeLock: boolean | null;
}

/** Fixture registry — the hard-delete worklist drained by `afterAll`. */
const tracked = new TrackedFixtures();

/** Sessions created mid-journey (service-created rows, tracked on creation). */
const journeySessionIds: number[] = [];

// ─── Journey state (ordered tests share the committed cast) ─────────────

let teacherJ1: JourneyActor;
let studentJ1: JourneyActor;
let teacherJ2: JourneyActor;
let studentJ2a: JourneyActor;
let studentJ2b: JourneyActor;
let teacherJ3: JourneyActor;
let studentJ3: JourneyActor;
let adminJ3: JourneyActor;
let teacherJ3b: JourneyActor;
let studentJ3b: JourneyActor;
let teacherJ4: JourneyActor;
let studentJ4a: JourneyActor;
let studentJ4b: JourneyActor;

let j1Session: SessionReturnType;
let j2aSession: SessionReturnType;
let j2bSession: SessionReturnType;
let j3StartedSession: SessionReturnType;
let j3ScheduledSession: SessionReturnType;
let j4aSession: SessionReturnType;
let j4bSession: SessionReturnType;

/**
 * Returns the localized errors bundle for the default journey locale. Used
 * for byte-exact denial-message assertions (never raw keys, never the
 * code echoed into the copy).
 */
function errorsFor() {
  return getServerTranslations(LOCALE_EN).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/**
 * Runs a service call through a try/catch and returns the rejection — the
 * journey-layer replacement for `expect(...).rejects.toThrow()`. Fails the
 * test when the call resolves successfully (a missing denial is exactly the
 * bug class journeys exist to catch).
 */
async function catchDenial(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
  throw new Error("expected the call to be denied, but it resolved successfully");
}

/**
 * Independent read-back oracle — the persisted lock state for one teacher
 * id (`is_online` + the `was_online_before_lock` marker), read as a direct
 * Drizzle select on the global `db` (NOT via the service, NOT via a
 * projection). Used by every journey's read-your-writes assertions: the
 * committed row pair is the ONLY observer-perspective truth.
 */
async function readTeacherLockState(teacherId: number): Promise<TeacherLockState | null> {
  const [row] = await db
    .select({ isOnline: teacher.isOnline, wasOnlineBeforeLock: teacher.wasOnlineBeforeLock })
    .from(teacher)
    .where(eq(teacher.id, teacherId));
  return row ?? null;
}

/** Narrows a nullable lock-state read to a row, failing loudly when null. */
function requiredLockState(state: TeacherLockState | null, label: string): TeacherLockState {
  if (state === null) {
    throw new Error(`journey: teacher lock state for ${label} vanished (fixture integrity failure)`);
  }
  return state;
}

/** Independent read-back oracle: the FULL session row (not via the service). */
async function readSessionRow(sessionId: number): Promise<SessionReturnType> {
  const [row] = await db.select().from(session).where(eq(session.id, sessionId));
  if (!row) {
    throw new Error(`journey: session row ${String(sessionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Audit rows ABOUT one session entity (the governance exactly-once oracle). */
async function readAuditsForSession(sessionId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), eq(auditLogs.entityId, sessionId)));
}

/**
 * Books one session through the REAL booking flow (the student actor's
 * step) and tracks every row the service created: the session row and its
 * idempotency claim. Booking consumes the student's trial lane — the
 * fixture cast funds one unit per booking student.
 */
async function bookSessionFor(
  student: JourneyActor,
  bookedTeacher: JourneyActor,
  key: string
): Promise<SessionReturnType> {
  const booked = await SessionLifecycleService.createSession(
    student.userId,
    { teacherId: bookedTeacher.userId, intent: SessionIntent.Hifz },
    key,
    LOCALE_EN
  );
  tracked.register(session, booked.id);
  journeySessionIds.push(booked.id);

  const [claim] = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  if (!claim) {
    throw new Error(`journey: idempotency claim for ${key} not found (fixture tracking failure)`);
  }
  tracked.register(sessionRequestIdempotency, claim.id);
  return booked;
}

/**
 * Funds one student's trial lane (one unit + the registration-grant
 * timestamp) inside the suite's committing `beforeAll` transaction — the
 * same fixture shape the session-journey cast builders produce. Booking
 * eligibility IS the balance, so every booking student holds exactly the
 * one unit his journey booking consumes.
 */
async function fundTrialLane(tx: DBTransaction, student: JourneyActor): Promise<void> {
  await tx.update(students).set({ balanceTrial: 1, trialGrantedAt: new Date() }).where(eq(students.id, student.userId));
}

/** Installs the publish-boundary spy once; `stop` restores the original. */
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

/** How many publish dispatches the spy has recorded so far. */
function publicationCallCount(): number {
  return publication?.calls.length ?? 0;
}

/**
 * Baseline for a step's wave-delta assertions: the publish-call count (one
 * call per post-commit wave — a wave is ONE `publishReceipts` invocation
 * carrying the exit's delivery receipts) and the flattened recipient-id
 * count (receipts can target several users, so recipient deltas must be
 * sliced by the FLATTENED length, never by the call count).
 */
function publishBaseline(): { calls: number; recipients: number } {
  return { calls: publicationCallCount(), recipients: publishedUserIds().length };
}

/**
 * Writes the reschedule-polluted `started_at` residue onto a scheduled row
 * in its OWN committed transaction — the exact shape the admin-reschedule
 * path's guarded write leaves behind on a never-started row (a stale
 * started instant with the status still `scheduled`). The governance
 * release under test must classify the row by its marker (held by no
 * started session), never by the polluted timestamp.
 */
async function polluteStartedAt(sessionId: number): Promise<void> {
  await db.transaction(async tx => {
    await tx.update(session).set({ startedAt: new Date(), updatedAt: new Date() }).where(eq(session.id, sessionId));
  });
}

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind. Registration
  // order is FK-safe by construction (each actor's `users` row first, its
  // role-child row second), so the registry's reverse-deletion sweep
  // deletes role-child rows BEFORE their `users` parents; session and
  // claim rows registered mid-journey come after the whole cast and are
  // therefore deleted FIRST.
  await db.transaction(async tx => {
    teacherJ1 = await provisionCertifiedTeacherActor(tx, { tracked });
    studentJ1 = await provisionStudentActor(tx, { tracked });

    teacherJ2 = await provisionCertifiedTeacherActor(tx, { tracked });
    studentJ2a = await provisionStudentActor(tx, { tracked });
    studentJ2b = await provisionStudentActor(tx, { tracked });

    teacherJ3 = await provisionCertifiedTeacherActor(tx, { tracked });
    studentJ3 = await provisionStudentActor(tx, { tracked });
    adminJ3 = await provisionAdminActor(tx, { tracked });
    teacherJ3b = await provisionCertifiedTeacherActor(tx, { tracked });
    studentJ3b = await provisionStudentActor(tx, { tracked });

    teacherJ4 = await provisionCertifiedTeacherActor(tx, { tracked });
    studentJ4a = await provisionStudentActor(tx, { tracked });
    studentJ4b = await provisionStudentActor(tx, { tracked });

    await fundTrialLane(tx, studentJ1);
    await fundTrialLane(tx, studentJ2a);
    await fundTrialLane(tx, studentJ2b);
    await fundTrialLane(tx, studentJ3);
    await fundTrialLane(tx, studentJ3b);
    await fundTrialLane(tx, studentJ4a);
    await fundTrialLane(tx, studentJ4b);
  });

  // No realtime delivery for the whole suite: every publish is recorded
  // (completion prompts, governance-cancel waves) and asserted by receipt
  // count + targeted recipient ids.
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // Defensive totality sweep BEFORE the FK-ordered hard delete: ANY
  // session row or claim row referencing the fixture actors is tracked,
  // so a mid-test failure can never strand restrict-FK children and block
  // the `users` deletes (the same sessions/claims the success legs
  // tracked).
  const fixtureStudentIds = [studentJ1, studentJ2a, studentJ2b, studentJ3, studentJ3b, studentJ4a, studentJ4b].map(
    actor => actor.userId
  );
  const fixtureTeacherIds = [teacherJ1, teacherJ2, teacherJ3, teacherJ3b, teacherJ4].map(actor => actor.userId);
  const residualSessions = await db
    .select({ id: session.id })
    .from(session)
    .where(or(inArray(session.studentId, fixtureStudentIds), inArray(session.teacherId, fixtureTeacherIds)));
  for (const row of residualSessions) {
    tracked.register(session, row.id);
  }
  const residualClaims = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(inArray(sessionRequestIdempotency.userId, fixtureStudentIds));
  for (const row of residualClaims) {
    tracked.register(sessionRequestIdempotency, row.id);
  }

  // The governance cancels append append-only audit rows (RESTRICT-delete
  // into `users`) — sweep them FIRST under the suspended-trigger helper,
  // then hard-delete every tracked fixture row FK-safely.
  await withAuditDeleteTriggersSuspended(async () => {
    await db.delete(auditLogs).where(eq(auditLogs.actorId, adminJ3.userId));
    if (journeySessionIds.length > 0) {
      await db
        .delete(auditLogs)
        .where(and(eq(auditLogs.entityType, SESSION_ENTITY_TYPE), inArray(auditLogs.entityId, journeySessionIds)));
    }
  });

  // Hard-deletes every tracked row in reverse registration order
  // (sessions and claims first, role-child rows before `users` parents)
  // and verifies zero residue — a leaking `afterAll` fails the suite.
  await tracked.cleanup();
  await tracked.verifyAllAbsent();
});

describe("Journey J1 — book → start (locked) → denied toggle → complete → restored (REQ-016)", () => {
  test("step 1 — T1 toggles Available: persisted is_online=true, no lock marker", async () => {
    const projection = await TeacherAvailabilityService.setAvailability(teacherJ1.userId, true, LOCALE_EN);
    expect(projection.isOnline).toBe(true);

    expect(requiredLockState(await readTeacherLockState(teacherJ1.userId), "T1 after the Available toggle")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 2 — S1 books T1 through the real booking flow: the teacher is STILL online (booking has no availability gate)", async () => {
    j1Session = await bookSessionFor(studentJ1, teacherJ1, KEY_J1);
    expect(j1Session.status).toBe(SessionStatus.Scheduled);
    expect(j1Session.teacherId).toBe(teacherJ1.userId);
    expect(j1Session.startedAt).toBeNull();

    // Booking composes ZERO availability writes — the lock belongs to the
    // start transition, never to booking.
    expect(requiredLockState(await readTeacherLockState(teacherJ1.userId), "T1 after the booking")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 3 — T1 starts the session: the in-session lock drives is_online=false and captures the marker (true)", async () => {
    const baseline = publishBaseline();

    // Transition first, assert afterwards: every step's state change
    // commits even when a later assertion fails, so the ordered journey
    // always reaches its next step.
    const started = await SessionLifecycleService.startSession(teacherJ1.userId, j1Session.id, LOCALE_EN);
    const studentView = await SessionLifecycleService.getSessionById(studentJ1.userId, j1Session.id);
    const lockState = await readTeacherLockState(teacherJ1.userId);

    expect(started.status).toBe(SessionStatus.Started);
    expect(started.startedAt).not.toBeNull();

    // Cross-actor visibility: the student (other participant) observes the
    // started state; no dispatch fires for the start (REQ-013).
    expect(studentView?.status).toBe(SessionStatus.Started);
    expect(publicationCallCount()).toBe(baseline.calls);

    // The lock oracle — the flag is driven false AND the pre-lock intent
    // is captured as the marker (first-lock-wins capture).
    expect(requiredLockState(lockState, "T1 in-session")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 4 — T1's Available toggle mid-session: TEACHER_IN_ACTIVE_SESSION (409), oracle-safe denial", async () => {
    const denied = await catchDenial(() =>
      TeacherAvailabilityService.setAvailability(teacherJ1.userId, true, LOCALE_EN)
    );

    expect(denied).toBeInstanceOf(ConflictError);
    expect(rejectionCode(denied)).toBe("TEACHER_IN_ACTIVE_SESSION");
    expect(denied.message).toBe(errorsFor().teacherInActiveSession);

    // Oracle safety: the denial payload carries NO session id — neither in
    // the localized message nor in any structured extension.
    expect(denied.message).not.toContain(String(j1Session.id));
    expect(JSON.stringify(denied)).not.toContain(String(j1Session.id));

    // The denial wrote nothing: the lock state is unchanged.
    expect(requiredLockState(await readTeacherLockState(teacherJ1.userId), "T1 after the denial")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 5 — T1 completes: restore per the captured marker (is_online=true), marker cleared (NULL)", async () => {
    const baseline = publishBaseline();

    const completed = await SessionLifecycleService.completeSession(teacherJ1.userId, j1Session.id, LOCALE_EN);
    const studentView = await SessionLifecycleService.getSessionById(studentJ1.userId, j1Session.id);
    const lockState = await readTeacherLockState(teacherJ1.userId);

    expect(completed.status).toBe(SessionStatus.Completed);
    expect(completed.endedAt).not.toBeNull();

    // The ONE sanctioned dispatch — the completion prompt wave: exactly one
    // post-commit publish invocation, targeting exactly the student.
    expect(publicationCallCount()).toBe(baseline.calls + 1);
    expect(publishedUserIds().slice(baseline.recipients)).toEqual([studentJ1.userId]);

    // Cross-actor visibility: the student observes the completion.
    expect(studentView?.status).toBe(SessionStatus.Completed);

    // The marker-gated restore — the original intent is written back and
    // the marker is cleared.
    expect(requiredLockState(lockState, "T1 post-completion")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });
});

describe("Journey J2 — never-resurrect: a deliberately Unavailable teacher stays Unavailable (REQ-017)", () => {
  test("step 1 — variant A: T2 toggles Available then Unavailable BEFORE starting (persisted offline intent)", async () => {
    await TeacherAvailabilityService.setAvailability(teacherJ2.userId, true, LOCALE_EN);
    const projection = await TeacherAvailabilityService.setAvailability(teacherJ2.userId, false, LOCALE_EN);
    expect(projection.isOnline).toBe(false);

    expect(requiredLockState(await readTeacherLockState(teacherJ2.userId), "T2 pre-start (variant A)")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 2 — variant A: S2a books; T2 starts (the marker captures false); completes → STAYS Unavailable, marker NULL", async () => {
    j2aSession = await bookSessionFor(studentJ2a, teacherJ2, KEY_J2A);
    await SessionLifecycleService.startSession(teacherJ2.userId, j2aSession.id, LOCALE_EN);

    // Snapshot the in-session lock state BEFORE the exit, then complete —
    // the assertions run after the transitions so the ordered journey
    // always reaches its next step even while this leg is red.
    const inSessionState = await readTeacherLockState(teacherJ2.userId);
    const completed = await SessionLifecycleService.completeSession(teacherJ2.userId, j2aSession.id, LOCALE_EN);
    const postCompletionState = await readTeacherLockState(teacherJ2.userId);

    expect(completed.status).toBe(SessionStatus.Completed);

    // The lock drove the flag false; the marker captured the pre-lock
    // intent — an OFFLINE teacher.
    expect(requiredLockState(inSessionState, "T2 in-session (variant A)")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: false,
    });

    // NEVER-RESURRECT: the restore reads the ORIGINAL intent — the
    // teacher's deliberate Unavailable survives the session's exit.
    expect(requiredLockState(postCompletionState, "T2 post-completion (variant A)")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 3 — variant B: T2 is back Available; S2b books; T2 starts (the marker captures true)", async () => {
    const projection = await TeacherAvailabilityService.setAvailability(teacherJ2.userId, true, LOCALE_EN);

    j2bSession = await bookSessionFor(studentJ2b, teacherJ2, KEY_J2B);
    await SessionLifecycleService.startSession(teacherJ2.userId, j2bSession.id, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ2.userId);

    expect(projection.isOnline).toBe(true);

    expect(requiredLockState(lockState, "T2 in-session (variant B)")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 4 — variant B: the MID-SESSION Unavailable toggle SUCCEEDS (the Unavailable direction is ungated) and dispatches nothing", async () => {
    const baseline = publishBaseline();

    const projection = await TeacherAvailabilityService.setAvailability(teacherJ2.userId, false, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ2.userId);

    expect(projection.isOnline).toBe(false);

    // The mid-session toggle persists (latest intent wins) and emits no
    // notification of any kind.
    expect(lockState?.isOnline).toBe(false);
    expect(publicationCallCount()).toBe(baseline.calls);
  });

  test("step 5 — variant B completes → STAYS Unavailable (the mid-session intent wins), marker NULL", async () => {
    const completed = await SessionLifecycleService.completeSession(teacherJ2.userId, j2bSession.id, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ2.userId);

    expect(completed.status).toBe(SessionStatus.Completed);

    // The mid-session Unavailable OVERWROTE the captured intent — the
    // restore writes the latest intent, never the pre-lock value.
    expect(requiredLockState(lockState, "T2 post-completion (variant B)")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: null,
    });
  });
});

describe("Journey J3 — the admin governance cancel releases the lock (REQ-018)", () => {
  test("step 1 — T3 Available; S3 books; T3 starts: locked with the marker captured (true)", async () => {
    await TeacherAvailabilityService.setAvailability(teacherJ3.userId, true, LOCALE_EN);
    j3StartedSession = await bookSessionFor(studentJ3, teacherJ3, KEY_J3_STARTED);
    await SessionLifecycleService.startSession(teacherJ3.userId, j3StartedSession.id, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ3.userId);

    expect(requiredLockState(lockState, "T3 in-session")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 2 — the admin cancels the STARTED session: availability restored per marker; the governance-cancel wave fires exactly once", async () => {
    const baseline = publishBaseline();

    const cancelled = await SessionAdminGovernanceService.cancel(
      adminJ3.userId,
      { sessionId: j3StartedSession.id, reason: " Journey governance cancel " },
      LOCALE_EN,
      null
    );
    const rowAfter = await readSessionRow(j3StartedSession.id);
    const auditRows = await readAuditsForSession(j3StartedSession.id);
    const lockState = await readTeacherLockState(teacherJ3.userId);

    expect(cancelled.status).toBe(SessionStatus.Cancelled);
    expect(rowAfter.status).toBe(SessionStatus.Cancelled);

    // The governance mutation appended EXACTLY ONE audit row (unchanged
    // cancel semantics — the release composes into the same transaction,
    // it does not add audit surface).
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.actionType).toBe(AuditActionType.Override);
    expect(auditRows[0]?.actorId).toBe(adminJ3.userId);

    // The governance-cancel wave — exactly once: ONE post-commit publish
    // invocation carrying the exit's delivery receipts, targeting the two
    // participants and nobody else.
    expect(publicationCallCount()).toBe(baseline.calls + 1);
    expect(publishedUserIds().slice(baseline.recipients)).toEqual([studentJ3.userId, teacherJ3.userId]);

    // THE LEAK FIX under test: the cancel's own transaction composes the
    // marker-gated release — the Available-when-locked teacher is
    // restored in the SAME transaction that cancels the session.
    expect(requiredLockState(lockState, "T3 post-cancel")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 3 — variant: the admin cancels a NEVER-STARTED scheduled row (reschedule-polluted started_at) → availability untouched (no_lock_held no-op)", async () => {
    await TeacherAvailabilityService.setAvailability(teacherJ3b.userId, true, LOCALE_EN);
    j3ScheduledSession = await bookSessionFor(studentJ3b, teacherJ3b, KEY_J3_SCHEDULED);

    // The reschedule pollution — a scheduled row carrying a stale started
    // instant, exactly the residue the admin-reschedule path leaves on a
    // never-started row. The release must classify by the MARKER, never
    // by the polluted timestamp.
    await polluteStartedAt(j3ScheduledSession.id);
    const pollutedRow = await readSessionRow(j3ScheduledSession.id);

    const baseline = publishBaseline();
    const cancelled = await SessionAdminGovernanceService.cancel(
      adminJ3.userId,
      { sessionId: j3ScheduledSession.id },
      LOCALE_EN,
      null
    );
    const lockState = await readTeacherLockState(teacherJ3b.userId);

    expect(pollutedRow.status).toBe(SessionStatus.Scheduled);
    expect(pollutedRow.startedAt).not.toBeNull();
    expect(cancelled.status).toBe(SessionStatus.Cancelled);

    // The cancel still waves (governance semantics unchanged for the
    // scheduled lane)…
    expect(publicationCallCount()).toBe(baseline.calls + 1);
    expect(publishedUserIds().slice(baseline.recipients)).toEqual([studentJ3b.userId, teacherJ3b.userId]);

    // …but availability is UNTOUCHED: a never-started row holds no lock —
    // the release resolves no_lock_held and writes NOTHING (the marker
    // stays NULL, the flag stays at its pre-cancel value).
    expect(requiredLockState(lockState, "T3b post-scheduled-cancel")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });
});

describe("Journey J4 — two started sessions defer the restore to the LAST exit (REQ-019)", () => {
  test("step 1 — T4 Available; S4a AND S4b both book T4: booking has no availability gate (both compose while T4 is online)", async () => {
    await TeacherAvailabilityService.setAvailability(teacherJ4.userId, true, LOCALE_EN);
    j4aSession = await bookSessionFor(studentJ4a, teacherJ4, KEY_J4A);
    j4bSession = await bookSessionFor(studentJ4b, teacherJ4, KEY_J4B);

    expect(j4aSession.status).toBe(SessionStatus.Scheduled);
    expect(j4bSession.status).toBe(SessionStatus.Scheduled);
    expect(j4aSession.id).not.toBe(j4bSession.id);
    expect(j4aSession.teacherId).toBe(teacherJ4.userId);
    expect(j4bSession.teacherId).toBe(teacherJ4.userId);

    // Neither booking touched the availability pair.
    expect(requiredLockState(await readTeacherLockState(teacherJ4.userId), "T4 with two bookings")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });

  test("step 2 — T4 starts BOTH sessions: the second start re-arms the same lock (first-lock-wins — one marker over two started rows)", async () => {
    const startedA = await SessionLifecycleService.startSession(teacherJ4.userId, j4aSession.id, LOCALE_EN);
    const startedB = await SessionLifecycleService.startSession(teacherJ4.userId, j4bSession.id, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ4.userId);

    expect(startedA.status).toBe(SessionStatus.Started);
    expect(startedB.status).toBe(SessionStatus.Started);

    // ONE lock over TWO started rows: the flag is false and the marker
    // captured the pre-lock intent exactly once.
    expect(requiredLockState(lockState, "T4 double-started")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 3 — completing session A DEFERS the restore: T4 stays locked (is_online=false) and the marker stays INTACT", async () => {
    const baseline = publishBaseline();

    const completed = await SessionLifecycleService.completeSession(teacherJ4.userId, j4aSession.id, LOCALE_EN);
    const lockState = await readTeacherLockState(teacherJ4.userId);

    expect(completed.status).toBe(SessionStatus.Completed);
    expect(publishedUserIds().slice(baseline.recipients)).toEqual([studentJ4a.userId]);

    // Another started session REMAINS → the restore is deferred: the flag
    // STAYS false and the marker is NOT cleared (the last-exit guard).
    expect(requiredLockState(lockState, "T4 after completing A")).toEqual({
      isOnline: false,
      wasOnlineBeforeLock: true,
    });
  });

  test("step 4 — completing session B (the LAST exit) restores per the ORIGINAL marker: is_online=true, marker NULL", async () => {
    const completed = await SessionLifecycleService.completeSession(teacherJ4.userId, j4bSession.id, LOCALE_EN);
    expect(completed.status).toBe(SessionStatus.Completed);

    // The last started exit restores the ORIGINAL pre-lock intent and
    // clears the marker.
    expect(requiredLockState(await readTeacherLockState(teacherJ4.userId), "T4 after completing B")).toEqual({
      isOnline: true,
      wasOnlineBeforeLock: null,
    });
  });
});
