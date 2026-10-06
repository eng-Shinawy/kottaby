/**
 * Cross-actor journey — the inactivity auto-offline sweep end-to-end across
 * the real actor cast (teachers, student, admin observer) and the system
 * actor (the sweep), driven through the REAL service layer against the REAL
 * test database. Each step observes the shared state that earlier steps
 * committed; denial probes fail through the genuine certification and
 * in-session gates (nothing monkey-patched).
 *
 * Layer contract (`test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`):
 *  - committed fixtures in ONE `beforeAll` `db.transaction(...)` (commit-or-nothing);
 *  - tracked hard-delete in `afterAll` via `TrackedFixtures.cleanup()` —
 *    session rows BEFORE role-child rows BEFORE `users` rows (FK-safe
 *    registration order; reverse-deletion by the registry), plus the
 *    inbox rows the session lifecycle's prompt wave persisted;
 *  - post-teardown `verifyAllAbsent` re-probes (zero residue is mandatory,
 *    not advisory);
 *  - NO `runInRollback` around service calls — services own their
 *    transactions (this layer is the documented exception to the
 *    `backend/db/test/` rollback rule);
 *  - NEVER fake timers: every staleness precondition is a BACKDATED
 *    `users.last_active_at` row built at second precision.
 *
 * Shared-entity state machine (teacher availability over `teacher.is_online`
 * + `users.last_active_at`):
 *  - Offline → Available: the teacher's manual toggle (certification +
 *    in-session gates; the toggle carries a fresh in-transaction activity
 *    stamp — the explicit-intent stamp).
 *  - Available → Offline: the system sweep, activity strictly older than
 *    the staleness cutoff, no started session. The sweep stamps NOTHING —
 *    `users.last_active_at` keeps its historical value.
 *  - Available → In-Session: `startSession` locks `is_online = false`.
 *  - In-Session → In-Session: the sweep observes the lock and changes
 *    nothing (lock priority — even with the flag transiently online).
 *  - In-Session → Available: the release at session conclusion restores
 *    the flag unconditionally; a teacher who is still inactive is swept at
 *    the next pass (the documented self-healing cycle — observable-only
 *    here; the release path itself is consumed, never modified).
 *
 * The sweep's victim selection is PREDICATE-driven and table-wide, so every
 * exact-count assertion opens with a DRAIN pass (the same real sweep) BEFORE
 * the step's fixtures go online — the pass then counts only what the step
 * itself created (pre-existing-data discipline).
 *
 * Cast (provisioned in ONE committing `beforeAll` transaction):
 *  - Certified teacher T — the sweep victim and the resume actor.
 *  - Certified teacher A — the fresh-toggle actor whose explicit-intent
 *    stamp keeps the staleness predicate false.
 *  - Certified teacher L — the in-session actor (locked, released, swept).
 *  - Student S — the session counter-party for L's started session.
 *  - Uncertified teacher U — the present-but-not-certified shape driving
 *    the certification denial honestly.
 *  - Boundary/stale/replay teachers — created per step via committed
 *    fixture writes with controlled activity stamps.
 *
 * Steps (each maps to one cross-actor scenario):
 *  1. Idle teacher swept offline; the admin observer watches
 *     `onlineNowCount` decay; 14 minutes idle stays online; the sweep
 *     never stamps activity; the observer sees COUNTS, never identities.
 *  2. The swept teacher resumes: the next toggle re-stamps activity and
 *     restores availability; the uncertified teacher is still denied.
 *  3. A fresh toggle survives the sweep while a stale online teacher falls
 *     in the SAME pass (intent stamp composes with the staleness predicate);
 *     the sweep publishes nothing.
 *  4. In-session lock: the sweep changes nothing for a started-session
 *     teacher (honest zero for him; session untouched).
 *  5. The in-session gate still denies the Available toggle while the
 *     session is live (oracle-safe denial payload).
 *  6. Lock priority holds even with the flag transiently online (the
 *     documented sub-second race window) — the started-session exemption
 *     is structural.
 *  7. Release restores the stale teacher; the next sweep re-offlines him
 *     (self-healing, observable-only).
 *  8. The strict freshness boundary at second precision: a stamp inside
 *     the threshold survives, one second past it falls.
 *  9. Replay: the immediate second sweep is a zero-row no-op.
 * 10. Overlapping sweeps: two concurrent passes against one stale-online
 *     fixture sum to ONE pass — the row lock plus the guarded predicate
 *     make the losing pass a zero-row no-op (the winner is
 *     nondeterministic; the summed count never is).
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { PlatformAnalyticsRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestSession, createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, DomainError, ForbiddenError } from "@/backend/lib/errors";
import { SessionLifecycleService } from "@/backend/services/classes/session-lifecycle.service";
import { NotificationEngine } from "@/backend/services/notifications";
import { TeacherAvailabilityService } from "@/backend/services/teachers/teacher-availability.service";
import { TeacherInactivityService } from "@/backend/services/teachers/teacher-inactivity.service";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  secondPrecisionMs,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/**
 * Default journey locale. Denial assertions pin English translated
 * substrings from the errors namespace; localized-copy parity lives in
 * the service-tier test suite.
 */
const LOCALE_EN = "en" as const;

/** The inactivity threshold the journey's staleness fixtures derive from. */
const FIFTEEN_MINUTES_MS = 15 * 60_000;

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
 * Independent read-back oracle — the persisted `teacher.is_online` value
 * for one teacher id (NOT via the service, a direct Drizzle select on the
 * global `db`).
 */
async function readTeacherIsOnline(teacherId: number): Promise<boolean | null> {
  const [row] = await db.select({ isOnline: teacher.isOnline }).from(teacher).where(eq(teacher.id, teacherId));
  return row?.isOnline ?? null;
}

/**
 * Independent read-back oracle — the persisted activity stamp for one user
 * id. The sweep must never touch it; the toggle must always advance it.
 */
async function readLastActiveAt(userId: number): Promise<Date | null> {
  const [row] = await db.select({ lastActiveAt: users.lastActiveAt }).from(users).where(eq(users.id, userId));
  return row?.lastActiveAt ?? null;
}

/** Independent read-back oracle — the persisted status of one session row. */
async function readSessionStatus(sessionId: number): Promise<string | null> {
  const [row] = await db.select({ status: session.status }).from(session).where(eq(session.id, sessionId));
  return row?.status ?? null;
}

/**
 * Clock-advance fixture — backdates one user's stored activity stamp to the
 * supplied past instant inside ONE committed transaction. A direct fixture
 * write on the activity column: the production clock is never mocked, and
 * every later read observes the same stored instant the way time would
 * have left it.
 */
async function backdateLastActiveAt(userId: number, stamp: Date): Promise<void> {
  const rows = await db.transaction(async tx =>
    tx.update(users).set({ lastActiveAt: stamp }).where(eq(users.id, userId)).returning({ id: users.id })
  );
  if (rows.length === 0) {
    throw new Error(`clock-advance fixture: no users row ${userId} to backdate`);
  }
}

/**
 * Availability-flag fixture — drives `teacher.is_online` directly inside
 * ONE committed transaction. Used ONLY to emulate the documented sub-second
 * race window where the lifecycle's lock write has not yet landed (the
 * lock-priority probe); the production writers are never bypassed for
 * journey steps that have a real service path.
 */
async function forceTeacherOnlineFlag(teacherId: number, online: boolean): Promise<void> {
  const rows = await db.transaction(async tx =>
    tx.update(teacher).set({ isOnline: online }).where(eq(teacher.id, teacherId)).returning({ id: teacher.id })
  );
  if (rows.length === 0) {
    throw new Error(`availability-flag fixture: no teacher row ${teacherId} to drive`);
  }
}

/**
 * An instant `minutes` before now, floored to the second precision the
 * staleness fixtures are built at so the strict `<` boundary stays
 * provable at stored resolution.
 */
function minutesAgoSecondPrecision(minutes: number): Date {
  return new Date(secondPrecisionMs(Date.now()) - minutes * 60_000);
}

// ─── Journey state (ordered tests share the committed cast) ─────────────

const tracked = new TrackedFixtures();

/** Every user id the journey generates (cast + per-step fixtures) — the inbox-teardown worklist. */
const journeyUserIds: number[] = [];

let certifiedTeacherT: JourneyActor;
let freshToggleTeacherA: JourneyActor;
let inSessionTeacherL: JourneyActor;
let studentS: JourneyActor;
let uncertifiedTeacherU: JourneyActor;
let inSessionId = 0; // the session row started in step 4 (locks L)
let inSessionStaleStamp = new Date(0); // L's backdated stamp (step 4) — the release must not move it

/**
 * The fan-out publish spy — installed over the engine's publish boundary so
 * the completion prompt's delivery never reaches a real transport; restored
 * in `afterAll`. The wave's inbox rows still persist and are swept in the
 * teardown (delivery interception, not persistence).
 */
const publishReceiptsSpy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async () => {});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Recipient user ids of the most recent publish (the receipt fan-out oracle). */
function lastPublishedRecipientIds(): number[] {
  const lastCall = publishReceiptsSpy.mock.calls.at(-1);
  const receipts = lastCall?.[0];
  if (!Array.isArray(receipts)) {
    throw new Error("expected the last publish to carry an array of delivery receipts");
  }
  const ids: number[] = [];
  for (const receipt of receipts) {
    const recipientUserIds = isRecord(receipt) ? receipt.recipientUserIds : undefined;
    if (Array.isArray(recipientUserIds) && recipientUserIds.every(value => typeof value === "number")) {
      ids.push(...recipientUserIds);
    }
  }
  return ids;
}

/**
 * Provisions the uncertified-teacher U row inside the suite's committing
 * `beforeAll` transaction: a real `users` row with `role="teacher"` plus a
 * real `teacher` row with `isApproved=false` (the explicit present-but-
 * not-certified shape). Both rows are tracked for `afterAll` hard-delete
 * cleanup.
 */
async function provisionUncertifiedTeacherActor(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<JourneyActor> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id, { isApproved: false, isOnline: false });
  tracked.register(users, user.id);
  tracked.register(teacher, user.id);
  journeyUserIds.push(user.id);
  return { userId: user.id, locale: LOCALE_EN, role: user.role };
}

/**
 * Committed per-step fixture — an ONLINE teacher with a controlled activity
 * stamp (a teacher whose availability flag is up but whose recorded
 * activity carries no fresh intent stamp). Returns the teacher id (shared
 * PK with the owning user).
 */
async function createOnlineTeacherFixture(lastActiveAt: Date): Promise<number> {
  const created = await db.transaction(async tx => {
    const user = await createTestUser(tx, { role: "teacher", lastActiveAt });
    await createTestTeacherRow(tx, user.id, { isOnline: true });
    return user;
  });
  tracked.register(users, created.id);
  tracked.register(teacher, created.id);
  journeyUserIds.push(created.id);
  return created.id;
}

/**
 * DRAIN pass — the sweep's predicate is global (unlike row-scoped writes),
 * so any pre-existing stale-online row — seed residue or a leaked fixture —
 * is transitioned BEFORE the step's fixtures go online, and the step's
 * fixture pass then counts only what the journey itself created.
 */
async function drainOnlinePopulation(): Promise<void> {
  await TeacherInactivityService.sweepInactiveTeachers();
}

beforeAll(async () => {
  // ONE committing transaction: provisioning is commit-or-nothing — a
  // throwing setup rolls back and leaves nothing behind. Registration order
  // is FK-safe by construction (`users` row first, role-child row second).
  await db.transaction(async tx => {
    certifiedTeacherT = await provisionCertifiedTeacherActor(tx, { tracked });
    freshToggleTeacherA = await provisionCertifiedTeacherActor(tx, { tracked });
    inSessionTeacherL = await provisionCertifiedTeacherActor(tx, { tracked });
    studentS = await provisionStudentActor(tx, { tracked });
    uncertifiedTeacherU = await provisionUncertifiedTeacherActor(tx);
  });
  journeyUserIds.push(certifiedTeacherT.userId, freshToggleTeacherA.userId, inSessionTeacherL.userId, studentS.userId);
});

afterAll(async () => {
  // Restore the publish boundary first, then sweep the inbox rows the
  // session lifecycle's prompt wave persisted for the cast (the publish
  // spy intercepts DELIVERY, not persistence), then hard-delete every
  // tracked row in reverse registration order and verify zero residue.
  // A leaking `afterAll` fails the suite loudly.
  publishReceiptsSpy.mockRestore();
  if (journeyUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, journeyUserIds));
    const inboxResidue = await db.$count(notifications, inArray(notifications.userId, journeyUserIds));
    expect(inboxResidue).toBe(0);
  }
  await tracked.cleanup();
  await tracked.verifyAllAbsent();
});

describe("Cross-actor journey — the inactivity auto-offline sweep", () => {
  test("step 1 — idle teacher swept offline; the admin observer watches the online count decay (counts, never identities)", async () => {
    await drainOnlinePopulation();

    // Admin observer, before: the presence-stats projection is a COUNTS-only
    // surface — three aggregates, no per-teacher rows, no identities.
    const statsBefore = await PlatformAnalyticsRepository.getTeacherPresenceStats();
    expect(new Set(Object.keys(statsBefore))).toEqual(new Set(["certifiedCount", "evaluatorCount", "onlineNowCount"]));
    expect(typeof statsBefore.onlineNowCount).toBe("number");

    // T toggles Available through the real service — the admin observer sees
    // the rise too (the online pool is one teacher richer).
    const toggle = await TeacherAvailabilityService.setAvailability(certifiedTeacherT.userId, true, LOCALE_EN);
    expect(toggle.isOnline).toBe(true);
    const statsAfterToggle = await PlatformAnalyticsRepository.getTeacherPresenceStats();
    expect(statsAfterToggle.onlineNowCount).toBe(statsBefore.onlineNowCount + 1);

    // 14 minutes idle: strictly inside the threshold — the sweep leaves the
    // teacher online (the ticket's "inactive for 14 min" scenario).
    await backdateLastActiveAt(certifiedTeacherT.userId, minutesAgoSecondPrecision(14));
    const insideThreshold = await TeacherInactivityService.sweepInactiveTeachers();
    expect(insideThreshold).toEqual({ offlined: 0 });
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(true);

    // Silent past the threshold: the sweep flips the teacher offline.
    const staleStamp = minutesAgoSecondPrecision(30);
    await backdateLastActiveAt(certifiedTeacherT.userId, staleStamp);
    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 1 });
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);

    // The sweep stamps NOTHING — `users.last_active_at` keeps the
    // historical value the fixture wrote (byte-exact round-trip).
    expect((await readLastActiveAt(certifiedTeacherT.userId))?.getTime()).toBe(staleStamp.getTime());

    // Admin observer, after: `onlineNowCount` decremented by exactly the
    // flipped teacher (cross-actor visibility — counts, never identities).
    const statsAfterSweep = await PlatformAnalyticsRepository.getTeacherPresenceStats();
    expect(statsAfterSweep.onlineNowCount).toBe(statsAfterToggle.onlineNowCount - 1);
  });

  test("step 2 — the swept teacher resumes: the next toggle re-stamps activity and restores availability; the uncertified teacher is still denied", async () => {
    // Precondition: T was swept offline in step 1 and carries the
    // historical stamp the sweep left untouched.
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(false);
    const stampBefore = await readLastActiveAt(certifiedTeacherT.userId);

    // The next authenticated activity — the manual toggle itself — succeeds
    // through the unchanged gates (certified, not in-session) and commits a
    // fresh in-transaction activity stamp with the restored availability.
    const resume = await TeacherAvailabilityService.setAvailability(certifiedTeacherT.userId, true, LOCALE_EN);
    expect(resume.isOnline).toBe(true);
    expect(await readTeacherIsOnline(certifiedTeacherT.userId)).toBe(true);
    const stampAfter = await readLastActiveAt(certifiedTeacherT.userId);
    expect(stampAfter?.getTime() ?? 0).toBeGreaterThan(stampBefore?.getTime() ?? 0);

    // The sweep never weakens the certification gate: the uncertified
    // teacher's re-toggle attempt is denied through the real gate.
    const denied = await catchDenial(() =>
      TeacherAvailabilityService.setAvailability(uncertifiedTeacherU.userId, true, LOCALE_EN)
    );
    expect(denied).toBeInstanceOf(ForbiddenError);
    expect(rejectionCode(denied)).toBe("FORBIDDEN");
    expect(denied.message).toBe(errorsFor().teacherNotCertified);
    expect(await readTeacherIsOnline(uncertifiedTeacherU.userId)).toBe(false);
  });

  test("step 3 — a fresh toggle survives the sweep; a stale online teacher falls in the SAME pass; the sweep publishes nothing", async () => {
    await drainOnlinePopulation();

    // A's fresh toggle: the explicit-intent stamp commits with the flag in
    // the SAME transaction, so the staleness predicate stays false — never
    // a false offline, whichever write commits first.
    const freshToggle = await TeacherAvailabilityService.setAvailability(freshToggleTeacherA.userId, true, LOCALE_EN);
    expect(freshToggle.isOnline).toBe(true);

    // W: an online teacher with NO fresh intent stamp — availability flag
    // up, recorded activity half an hour old (committed fixture writes).
    const staleTeacherId = await createOnlineTeacherFixture(minutesAgoSecondPrecision(30));

    // The sweep pass evaluates BOTH teachers against one captured now.
    const publishesBefore = publishReceiptsSpy.mock.calls.length;
    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 1 });

    // The fresh toggle survived; the stale online teacher fell.
    expect(await readTeacherIsOnline(freshToggleTeacherA.userId)).toBe(true);
    expect(await readTeacherIsOnline(staleTeacherId)).toBe(false);

    // Side-effect silence: the sweep sends no notifications on any arm.
    expect(publishReceiptsSpy.mock.calls).toHaveLength(publishesBefore);
  });

  test("step 4 — in-session lock: the sweep changes nothing for a started-session teacher (honest zero for him)", async () => {
    await drainOnlinePopulation();

    // L toggles Available, then a real session is booked and started through
    // the shipped lifecycle service — the start lock drives the flag down
    // inside the transition's own transaction.
    const toggle = await TeacherAvailabilityService.setAvailability(inSessionTeacherL.userId, true, LOCALE_EN);
    expect(toggle.isOnline).toBe(true);

    const scheduled = await db.transaction(async tx =>
      createTestSession(tx, inSessionTeacherL.userId, studentS.userId, {
        status: SessionStatus.Scheduled,
        sessionType: SessionType.StudentSession,
        // A real tutoring intent — the lifecycle's completion wave resolves
        // the wave context through the stored intent and fails closed on a
        // NULL one, so the fixture carries the honest booked-session shape.
        intent: SessionIntent.Hifz,
      })
    );
    inSessionId = scheduled.id;
    tracked.register(session, inSessionId);

    await SessionLifecycleService.startSession(inSessionTeacherL.userId, inSessionId, LOCALE_EN);
    expect(await readSessionStatus(inSessionId)).toBe(SessionStatus.Started);
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(false);

    // L goes silent past the threshold WHILE in-session.
    inSessionStaleStamp = minutesAgoSecondPrecision(30);
    await backdateLastActiveAt(inSessionTeacherL.userId, inSessionStaleStamp);

    // The sweep runs: nothing changes — the teacher is not treated as an
    // offlined count, the flag stays where the lock drove it, the session
    // stays live.
    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 0 });
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(false);
    expect(await readSessionStatus(inSessionId)).toBe(SessionStatus.Started);
  });

  test("step 5 — the in-session gate still denies the Available toggle while the session is live (oracle-safe denial)", async () => {
    // Precondition: the session started in step 4 is still live.
    expect(await readSessionStatus(inSessionId)).toBe(SessionStatus.Started);

    const denied = await catchDenial(() =>
      TeacherAvailabilityService.setAvailability(inSessionTeacherL.userId, true, LOCALE_EN)
    );

    expect(denied).toBeInstanceOf(ConflictError);
    expect(rejectionCode(denied)).toBe("TEACHER_IN_ACTIVE_SESSION");
    expect(denied.message).toBe(errorsFor().teacherInActiveSession);

    // Oracle safety: the denial payload carries NO session id — neither in
    // the error message, nor in any structured extension.
    expect(denied.message).not.toContain(String(inSessionId));
    expect(JSON.stringify(denied)).not.toContain(String(inSessionId));

    // The denial left the locked state untouched.
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(false);
  });

  test("step 6 — lock priority holds even with the flag transiently online (the documented sub-second window)", async () => {
    // Emulate the race window: the availability flag reads `true` while the
    // started session exists (a committed fixture write — the lifecycle's
    // lock write has "not landed yet").
    await forceTeacherOnlineFlag(inSessionTeacherL.userId, true);
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(true);

    // The sweep still skips the teacher: the started-session exemption is
    // structural (the flag alone is not enough to become a victim), and the
    // sweep's zero-count for him stays honest.
    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 0 });
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(true);
    expect(await readSessionStatus(inSessionId)).toBe(SessionStatus.Started);

    // Restore the lifecycle-driven locked state before the release leg.
    await forceTeacherOnlineFlag(inSessionTeacherL.userId, false);
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(false);
  });

  test("step 7 — release restores the stale teacher; the next sweep re-offlines him (self-healing, observable-only)", async () => {
    // The session concludes through the shipped lifecycle service; the
    // release restores the flag unconditionally (the documented hazard the
    // sweep heals — consumed here, never modified). The completion prompt's
    // publish is intercepted at the fan-out boundary.
    const publishesBefore = publishReceiptsSpy.mock.calls.length;
    const completed = await SessionLifecycleService.completeSession(inSessionTeacherL.userId, inSessionId, LOCALE_EN);
    expect(completed.status).toBe(SessionStatus.Completed);
    expect(publishReceiptsSpy.mock.calls).toHaveLength(publishesBefore + 1);
    expect(lastPublishedRecipientIds()).toContain(studentS.userId);

    // Resurrected-but-inactive: the release put the flag back up while the
    // recorded activity is still the backdated stamp — the release stamps
    // nothing.
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(true);
    expect((await readLastActiveAt(inSessionTeacherL.userId))?.getTime()).toBe(inSessionStaleStamp.getTime());

    // The next pass heals the state: the stale resurrected teacher is swept.
    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 1 });
    expect(await readTeacherIsOnline(inSessionTeacherL.userId)).toBe(false);
    expect((await readLastActiveAt(inSessionTeacherL.userId))?.getTime()).toBe(inSessionStaleStamp.getTime());
  });

  test("step 8 — the strict freshness boundary at second precision: a stamp inside the threshold survives, one second past it falls", async () => {
    await drainOnlinePopulation();

    // The service captures its sweep instant INSIDE the call, so the
    // journey pins the strict `<` boundary at the second-resolution edges
    // backdating can prove deterministically: the inside stamp is held one
    // step clear of the threshold (its stored second-aligned value stays
    // above every cutoff the running sweep can derive), and the past stamp
    // sits a full second beyond it. The millisecond-exact equality leg is
    // the repository/service tiers' (caller-supplied or frozen cutoff).
    const base = secondPrecisionMs(Date.now());
    const insideEdge = await createOnlineTeacherFixture(new Date(base - FIFTEEN_MINUTES_MS + 2_000));
    const pastEdge = await createOnlineTeacherFixture(new Date(base - FIFTEEN_MINUTES_MS - 1_000));

    const swept = await TeacherInactivityService.sweepInactiveTeachers();
    expect(swept).toEqual({ offlined: 1 });

    // Not older than the cutoff → survives (strict `<`); older by one
    // second → falls.
    expect(await readTeacherIsOnline(insideEdge)).toBe(true);
    expect(await readTeacherIsOnline(pastEdge)).toBe(false);
  });

  test("step 9 — replay: the immediate second sweep is a zero-row no-op (the ops overlap contract)", async () => {
    await drainOnlinePopulation();

    const replayTeacherId = await createOnlineTeacherFixture(minutesAgoSecondPrecision(30));

    const firstPass = await TeacherInactivityService.sweepInactiveTeachers();
    expect(firstPass).toEqual({ offlined: 1 });
    expect(await readTeacherIsOnline(replayTeacherId)).toBe(false);
    const stampAfterFirstPass = await readLastActiveAt(replayTeacherId);

    // The immediate second pass matches zero rows — the availability gate
    // makes the replay safe — and mutates nothing.
    const secondPass = await TeacherInactivityService.sweepInactiveTeachers();
    expect(secondPass).toEqual({ offlined: 0 });
    expect(await readTeacherIsOnline(replayTeacherId)).toBe(false);
    expect((await readLastActiveAt(replayTeacherId))?.getTime()).toBe(stampAfterFirstPass?.getTime() ?? -1);
  });

  test("step 10 — overlapping sweeps: two concurrent passes against one stale-online fixture sum to a single pass", async () => {
    await drainOnlinePopulation();

    // One stale-online victim; the two racing passes below must not both
    // count him.
    const staleStamp = minutesAgoSecondPrecision(30);
    const victimId = await createOnlineTeacherFixture(staleStamp);

    // Two cron fires race (allSettled — a rejected pass must fail this leg
    // loudly, never reject the runner): each pass opens its OWN top-level
    // transaction, so the victim's row lock plus the guarded predicate
    // serialize the flips — whichever UPDATE lands first takes the row and
    // commits, and the other pass re-evaluates against the flipped row and
    // matches nothing. WHICH pass wins is nondeterministic; the summed
    // count never is.
    const settled = await Promise.allSettled([
      TeacherInactivityService.sweepInactiveTeachers(),
      TeacherInactivityService.sweepInactiveTeachers(),
    ]);

    const offlinedCounts: number[] = [];
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        throw new Error(`an overlapping sweep pass must never reject: ${String(outcome.reason)}`);
      }
      offlinedCounts.push(outcome.value.offlined);
    }
    expect(offlinedCounts.toSorted((a, b) => a - b)).toEqual([0, 1]);

    // Exactly one flip landed — the victim is offline, and the overlapping
    // passes stamped nothing (the historical fixture stamp survives
    // byte-exact, whoever won).
    expect(await readTeacherIsOnline(victimId)).toBe(false);
    expect((await readLastActiveAt(victimId))?.getTime()).toBe(staleStamp.getTime());
  });
});
