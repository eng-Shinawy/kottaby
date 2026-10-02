/**
 * Cross-actor journey — the write-once recitation record of a session.
 *
 * One committed recitation record hangs off one started session. The journey
 * walks that shared record across every actor that can (and cannot) touch
 * it, in strict order, through the REAL service layer on the REAL test
 * database:
 *
 *  step 1  owning teacher   → setSessionRecitation      → exactly ONE row; zero
 *                                                          external effects anywhere
 *  step 2  student          → getSessionRecitation      → observes name/description verbatim
 *  step 3  owning teacher   → repeat write              → RECITATION_ALREADY_EXISTS; the
 *                                                          original row stays byte-identical
 *  step 4  foreign student  → getSessionRecitation      → null (never learns the row exists)
 *  step 5  foreign teacher  → write on the SAME session → SESSION_NOT_FOUND, byte-identical
 *                                                          to the nonexistent-id denial
 *  step 6  parent           → read + write              → null; the ownership predicate denies
 *  step 7  governed teacher → write while suspended     → FORBIDDEN at the service re-check
 *  step 8  owning teacher   → two concurrent writes     → exactly one row, one
 *                                                          RECITATION_ALREADY_EXISTS loser;
 *                                                          both participants read the same record
 *
 * Layer contract (test/workflows/AGENTS.md): committed fixtures in
 * `beforeAll` — the actor cast in ONE committing transaction, then the shared
 * session booked by the student and started by its owning teacher through the
 * real lifecycle services — plus tracked hard-deletes in `afterAll` via the
 * fixture registry. NO `runInRollback` in this layer. Actors are real users
 * holding real role rows; nothing is monkey-patched. The notification
 * dispatch boundary is spied (passthrough) AND external-effect absence is
 * proven by row-count deltas scoped to fixture ids on EVERY step. Denials are
 * captured with `catchJourneyError` and asserted on the typed `DomainError`
 * contract plus the exact translated message — never
 * `expect(...).rejects.toThrow()`.
 *
 * Run:
 *   bun run test/scripts/run-test.ts test/workflows/sessions/recitation-record.journey.test.ts
 *   bun run test/scripts/run-test.ts test/workflows
 */

import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { recitation } from "@/backend/db/schema/classes/recitation";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from "@/backend/lib/errors";
import { RecitationRecordService, SessionLifecycleService } from "@/backend/services/classes";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  RecitationReturnType,
  RecitationSelectType,
  SessionRecitationSubmitInput,
  SessionReturnType,
  SessionSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  buildSessionJourneyCast,
  catchJourneyError,
  countAuditLogsForActor,
  countNotificationsForUser,
  countTeacherTransactionsForTeacher,
  countWalletsForTeacher,
  createSessionFixtureRegistry,
  journeyPrefix,
  type SessionJourneyCast,
  setGovernanceFixture,
} from "@/test/workflows/helpers";

/** The journey runs on the default test locale throughout. */
const LOCALE = "en";

/** Per-run prefix — unique user labels, idempotency keys, and record copy per suite run. */
const PREFIX = journeyPrefix("recitation");

/** The booking idempotency key of the journey's shared started session. */
const BOOKING_KEY = `${PREFIX}-lifecycle-booking`;

/**
 * The owner's record payload. `description` is an explicit `null` or string —
 * the submission whitelist carries no undefined.
 */
const RECITATION_INPUT: SessionRecitationSubmitInput = {
  name: `${PREFIX} Al-Fatiha revision`,
  description: "Recited Surah Al-Fatiha with tajweed review; two corrections on madd rules.",
};

/**
 * The repeat-write payload: deliberately DIFFERENT content, so step 3 proves
 * the write-once rule (no upsert — a second submission never rewrites the
 * stored record).
 */
const REPEAT_INPUT: SessionRecitationSubmitInput = {
  name: `${PREFIX} hostile overwrite`,
  description: null,
};

/** The payload non-owner write attempts carry (any valid shape — identity is server-resolved). */
const FOREIGN_INPUT: SessionRecitationSubmitInput = {
  name: `${PREFIX} foreign attempt`,
  description: null,
};

/** The identical double-submit payload both racing owner writes carry. */
const RACE_INPUT: SessionRecitationSubmitInput = {
  name: `${PREFIX} race submission`,
  description: "Concurrent double-submit of the same record.",
};

// ─── Journey state (ordered tests share the committed cast) ─────────────

/** The fixture registry — the hard-delete worklist drained by `afterAll`. */
const registry = createSessionFixtureRegistry();

/** The committed actor cast (assigned once by `beforeAll`). */
let cast: SessionJourneyCast;

/** The journey's shared started session (booked by the student, owned by the teacher). */
let sessionA: SessionReturnType;

/** The stored record as read straight from the table after the owner's write. */
let storedRecord: RecitationSelectType | null = null;

/** The foreign teacher's denial fingerprint from step 5 — reused for cross-actor pairings. */
let foreignWriteShape: DenialShape | null = null;

// ─── Assertion helpers ───────────────────────────────────────────────────

/** The errors-namespace translations for the default journey locale. */
function t() {
  return getServerTranslations(LOCALE).errorsTranslations;
}

/** Type-guard read of a caught rejection's `extensions.code` contract. */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** The denial fingerprint used for the identical-shape oracle pairings. */
interface DenialShape {
  readonly name: string;
  readonly code: string;
  readonly message: string;
}

/** Captures the denial fingerprint (class name, code, exact message). */
function denialShape(error: Error): DenialShape {
  return { name: error.name, code: rejectionCode(error), message: error.message };
}

/**
 * Asserts a caught error is a `DomainError` carrying EXACTLY the expected
 * `extensions.code` and EXACTLY the translated message (never the raw key,
 * never the code echoed into the copy).
 */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

// ─── Independent read-back oracles (NOT via the services under test) ─────

/** Reads one session row straight from the table. */
async function readSessionRow(sessionId: number): Promise<SessionSelectType | null> {
  const [row] = await db.select().from(session).where(eq(session.id, sessionId));
  return row ?? null;
}

/** Reads one student row's escrow lane balances straight from the table. */
async function readStudentLanes(studentId: number): Promise<{
  trial: number;
  hifz: number | null;
  tajweed: number | null;
}> {
  const [row] = await db
    .select({ trial: students.balanceTrial, hifz: students.balanceHifz, tajweed: students.balanceTajweed })
    .from(students)
    .where(eq(students.id, studentId));
  if (!row) {
    throw new Error(`readStudentLanes: students row ${String(studentId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads the session's recitation record straight from the table (the 1:1 row, or null). */
async function readRecitationRow(recitationSessionId: number): Promise<RecitationSelectType | null> {
  const [row] = await db.select().from(recitation).where(eq(recitation.sessionId, recitationSessionId));
  return row ?? null;
}

/** Counts the recitation rows of one session (the row-count oracle for the 1:1 contract). */
function countRecitationRows(recitationSessionId: number): Promise<number> {
  return db.$count(recitation, eq(recitation.sessionId, recitationSessionId));
}

/**
 * An id that is guaranteed NOT to exist: one million past the current
 * identity high-water mark, so repeated or parallel journey runs (each with
 * their own fresh rows) can never collide with it.
 */
async function nonexistentSessionId(): Promise<number> {
  const [row] = await db.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Registers one service-created idempotency claim (by key) for cleanup. */
async function trackIdempotencyClaim(key: string): Promise<void> {
  const [claim] = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(eq(sessionRequestIdempotency.idempotencyKey, key));
  if (!claim) {
    throw new Error("journey: idempotency claim not found (fixture tracking failure)");
  }
  registry.track("session_request_idempotency", claim.id);
}

// ─── External-effect absence oracles ─────────────────────────────────────

/** One fixture actor's side-effect counters, keyed for snapshot comparison. */
interface ActorCounters {
  readonly key: string;
  readonly userId: number;
}

/** Every cast actor whose notification inbox and audit trail must stay empty. */
function journeyActors(): readonly ActorCounters[] {
  return [
    { key: "ownerTeacher", userId: cast.teacher.userId },
    { key: "secondTeacher", userId: cast.secondTeacher.userId },
    { key: "primaryStudent", userId: cast.primaryStudent.userId },
    { key: "secondStudent", userId: cast.secondStudent.userId },
    { key: "applicant", userId: cast.applicant.userId },
    { key: "parent", userId: cast.parent.userId },
    { key: "admin", userId: cast.admin.userId },
  ];
}

/** The teacher-role actors whose wallet and ledger tables must stay untouched. */
function journeyTeachers(): readonly ActorCounters[] {
  return [
    { key: "ownerTeacher", userId: cast.teacher.userId },
    { key: "secondTeacher", userId: cast.secondTeacher.userId },
  ];
}

/** One user row's governance state (the `users` write-purity oracle). */
interface GovernanceStateRow {
  readonly userId: number;
  readonly isDeleted: boolean;
  readonly isBlocked: boolean;
  readonly suspended: boolean;
}

/** Reads every cast user's governance state, order-stable for comparison. */
async function readGovernanceStates(): Promise<readonly GovernanceStateRow[]> {
  const rows = await db
    .select({
      userId: users.id,
      isDeleted: users.isDeleted,
      isBlocked: users.isBlocked,
      suspended: users.suspended,
    })
    .from(users)
    .where(
      inArray(
        users.id,
        journeyActors().map(actor => actor.userId)
      )
    );
  // A NULL governance column means the flag was never set — not governed.
  return rows
    .map(row => ({
      userId: row.userId,
      isDeleted: row.isDeleted ?? false,
      isBlocked: row.isBlocked ?? false,
      suspended: row.suspended ?? false,
    }))
    .toSorted((a, b) => a.userId - b.userId);
}

/**
 * Row-count snapshot of every external-effect surface the recitation surface
 * could touch: notification inboxes and audit trails per cast actor, the
 * users rows' governance state, the teachers' role rows, and the teachers'
 * wallet and ledger tables. All counters are scoped to fixture ids, so
 * pre-existing shared-DB data can never satisfy a delta assertion.
 */
interface SideEffectSnapshot {
  readonly notificationsByActor: Readonly<Record<string, number>>;
  readonly auditLogsByActor: Readonly<Record<string, number>>;
  readonly governanceStates: readonly GovernanceStateRow[];
  readonly teacherRowCount: number;
  readonly walletRowsByTeacher: Readonly<Record<string, number>>;
  readonly teacherTransactionRowsByTeacher: Readonly<Record<string, number>>;
}

/** Captures the side-effect snapshot for the current cast. */
async function captureSideEffectSnapshot(): Promise<SideEffectSnapshot> {
  const actors = journeyActors();
  const teachers = journeyTeachers();
  const [notificationEntries, auditEntries, governanceStates, teacherRowCount, walletEntries, ledgerEntries] =
    await Promise.all([
      Promise.all(
        actors.map(actor => countNotificationsForUser(actor.userId).then(count => [actor.key, count] as const))
      ),
      Promise.all(actors.map(actor => countAuditLogsForActor(actor.userId).then(count => [actor.key, count] as const))),
      readGovernanceStates(),
      db.$count(
        teacher,
        inArray(
          teacher.id,
          teachers.map(entry => entry.userId)
        )
      ),
      Promise.all(
        teachers.map(entry => countWalletsForTeacher(entry.userId).then(count => [entry.key, count] as const))
      ),
      Promise.all(
        teachers.map(entry =>
          countTeacherTransactionsForTeacher(entry.userId).then(count => [entry.key, count] as const)
        )
      ),
    ]);
  return {
    notificationsByActor: Object.fromEntries(notificationEntries),
    auditLogsByActor: Object.fromEntries(auditEntries),
    governanceStates,
    teacherRowCount,
    walletRowsByTeacher: Object.fromEntries(walletEntries),
    teacherTransactionRowsByTeacher: Object.fromEntries(ledgerEntries),
  };
}

// ─── Notification dispatch boundary spy ──────────────────────────────────

/**
 * Passthrough spies over the notification engine's dispatch entries: the
 * recitation surface must NEVER dispatch, so the recorded call log must stay
 * empty on every step's window (each `beforeEach` re-arms it). Passthrough —
 * not stubbed — so the engine's real behavior is unchanged should a
 * forbidden call ever fire; the row-count deltas below catch the persisted
 * half of any such violation independently.
 */
function installDispatchSpies() {
  return [
    spyOn(NotificationEngine, "emitForUser"),
    spyOn(NotificationEngine, "emitForUsers"),
    spyOn(NotificationEngine, "publishReceipts"),
  ];
}

let dispatchSpies: ReturnType<typeof installDispatchSpies> = [];

/** Asserts zero dispatch calls were recorded in the current step's window. */
function expectZeroDispatches(): void {
  for (const spy of dispatchSpies) {
    expect(spy.mock.calls).toHaveLength(0);
  }
}

/** Asserts a step produced ZERO deltas on every side-effect counter (and zero dispatches). */
function expectZeroSideEffectDeltas(before: SideEffectSnapshot, after: SideEffectSnapshot): void {
  expect(after.notificationsByActor).toEqual(before.notificationsByActor);
  expect(after.auditLogsByActor).toEqual(before.auditLogsByActor);
  expect(after.governanceStates).toEqual(before.governanceStates);
  expect(after.teacherRowCount).toBe(before.teacherRowCount);
  expect(after.walletRowsByTeacher).toEqual(before.walletRowsByTeacher);
  expect(after.teacherTransactionRowsByTeacher).toEqual(before.teacherTransactionRowsByTeacher);
  expectZeroDispatches();
}

// ─── Fixture lifecycle ───────────────────────────────────────────────────

beforeAll(async () => {
  await db.transaction(async tx => {
    cast = await buildSessionJourneyCast(tx, registry, {
      prefix: PREFIX,
      // The primary student funds BOTH bookings: the shared session consumes
      // the trial lane, the race leg's second session consumes the hifz lane.
      primaryStudent: { trial: 1, hifz: 1 },
    });
  });

  // The journey's shared entity: a REAL started session owned by the cast
  // teacher — booked by the primary student and started by its owning
  // teacher, both through the real lifecycle services (the honest
  // production path; every created row is tracked for teardown).
  dispatchSpies = installDispatchSpies();
  sessionA = await SessionLifecycleService.createSession(
    cast.primaryStudent.userId,
    { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
    BOOKING_KEY,
    LOCALE
  );
  registry.track("session", sessionA.id);
  await trackIdempotencyClaim(BOOKING_KEY);
  await SessionLifecycleService.startSession(cast.teacher.userId, sessionA.id, LOCALE);
});

beforeEach(() => {
  // Re-arm the dispatch spy so every step asserts its OWN zero-publish window.
  for (const spy of dispatchSpies) {
    spy.mockClear();
  }
});

afterAll(async () => {
  for (const spy of dispatchSpies) {
    spy.mockRestore();
  }

  // Defensive totality sweep before the FK-ordered hard delete: ANY session
  // row or claim row referencing the fixture actors is tracked, so a
  // mid-test failure can never strand restrict-FK children and block the
  // users deletes.
  const fixtureStudentIds = [cast.primaryStudent.userId, cast.secondStudent.userId];
  const fixtureTeacherIds = [cast.teacher.userId, cast.secondTeacher.userId];
  const residualSessions = await db
    .select({ id: session.id })
    .from(session)
    .where(or(inArray(session.studentId, fixtureStudentIds), inArray(session.teacherId, fixtureTeacherIds)));
  registry.trackAll(
    "session",
    residualSessions.map(row => row.id)
  );
  const residualClaims = await db
    .select({ id: sessionRequestIdempotency.id })
    .from(sessionRequestIdempotency)
    .where(inArray(sessionRequestIdempotency.userId, fixtureStudentIds));
  registry.trackAll(
    "session_request_idempotency",
    residualClaims.map(row => row.id)
  );

  const trackedSessionIds = [...registry.ids("session")];
  await registry.cleanup();

  // Recitation rows cascade with their session rows: after teardown the
  // journey's sessions must carry ZERO recitation residue.
  if (trackedSessionIds.length > 0) {
    expect(await db.$count(recitation, inArray(recitation.sessionId, trackedSessionIds))).toBe(0);
  }
});

// ─── The journey ─────────────────────────────────────────────────────────

describe("Recitation record journey — one write-once record per session, across actors", () => {
  test("step 1 — owning teacher writes the record on a started session: exactly ONE row, zero effects anywhere", async () => {
    // Fixture premise: the shared session is started and owned by the cast teacher.
    const sessionRow = await readSessionRow(sessionA.id);
    expect(sessionRow?.status).toBe(SessionStatus.Started);
    expect(sessionRow?.teacherId).toBe(cast.teacher.userId);
    expect(sessionRow?.studentId).toBe(cast.primaryStudent.student.id);

    const before = await captureSideEffectSnapshot();
    const lanesBefore = await readStudentLanes(cast.primaryStudent.student.id);

    const written = await RecitationRecordService.setSessionRecitation(
      cast.teacher.userId,
      sessionA.id,
      RECITATION_INPUT,
      LOCALE
    );

    expect(written.id).toBeGreaterThan(0);
    expect(written.sessionId).toBe(sessionA.id);
    expect(written.name).toBe(RECITATION_INPUT.name);
    expect(written.description).toBe(RECITATION_INPUT.description);
    expect(written.createdAt).toBeInstanceOf(Date);
    expect(written.updatedAt).toBeInstanceOf(Date);

    // Exactly ONE recitation row for the session — the 1:1 structural contract.
    expect(await countRecitationRows(sessionA.id)).toBe(1);

    // Write purity: the lifecycle-owned siblings are untouched by the write.
    expect(await readSessionRow(sessionA.id)).toEqual(sessionRow);
    expect(await readStudentLanes(cast.primaryStudent.student.id)).toEqual(lanesBefore);

    storedRecord = await readRecitationRow(sessionA.id);
    expect(storedRecord).not.toBeNull();

    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 2 — student participant reads the record: name and description observed verbatim", async () => {
    const before = await captureSideEffectSnapshot();

    const observed = await RecitationRecordService.getSessionRecitation(cast.primaryStudent.userId, sessionA.id);

    expect(observed).not.toBeNull();
    expect(observed?.id).toBe(storedRecord?.id);
    expect(observed?.sessionId).toBe(sessionA.id);
    expect(observed?.name).toBe(RECITATION_INPUT.name);
    expect(observed?.description).toBe(RECITATION_INPUT.description);
    expect(observed).toEqual(storedRecord);

    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 3 — owner repeat write: RECITATION_ALREADY_EXISTS; the original row stays byte-identical", async () => {
    const before = await captureSideEffectSnapshot();
    const rowBefore = await readRecitationRow(sessionA.id);
    expect(rowBefore).toEqual(storedRecord);

    const denied = await catchJourneyError(() =>
      RecitationRecordService.setSessionRecitation(cast.teacher.userId, sessionA.id, REPEAT_INPUT, LOCALE)
    );
    expect(denied).toBeInstanceOf(ConflictError);
    expectDomainDenial(denied, "RECITATION_ALREADY_EXISTS", t().recitationAlreadyExists);

    // Write-once, never upsert: a DIFFERENT payload was offered and the
    // rejected attempt left the original record byte-identical.
    expect(await countRecitationRows(sessionA.id)).toBe(1);
    expect(await readRecitationRow(sessionA.id)).toEqual(rowBefore);

    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 4 — foreign student read collapses to null: never learns the record exists", async () => {
    const before = await captureSideEffectSnapshot();

    expect(await RecitationRecordService.getSessionRecitation(cast.secondStudent.userId, sessionA.id)).toBeNull();

    // The nonexistent-id pairing: the SAME null for an id that never was.
    const ghostId = await nonexistentSessionId();
    expect(await RecitationRecordService.getSessionRecitation(cast.secondStudent.userId, ghostId)).toBeNull();

    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 5 — foreign teacher write on the SAME session: SESSION_NOT_FOUND, byte-identical to the nonexistent-id denial", async () => {
    const before = await captureSideEffectSnapshot();
    const rowBefore = await readRecitationRow(sessionA.id);

    const foreignDenied = await catchJourneyError(() =>
      RecitationRecordService.setSessionRecitation(cast.secondTeacher.userId, sessionA.id, FOREIGN_INPUT, LOCALE)
    );
    expect(foreignDenied).toBeInstanceOf(NotFoundError);
    const foreignShape = denialShape(foreignDenied);
    expect(foreignShape.code).toBe("SESSION_NOT_FOUND");
    expect(foreignShape.message).toBe(t().sessionNotFound);
    foreignWriteShape = foreignShape;

    // The nonexistent-id pairing: SAME class, SAME code, SAME message — a
    // foreign session id is byte-indistinguishable from one that never was,
    // so session existence is never an oracle.
    const ghostId = await nonexistentSessionId();
    const ghostDenied = await catchJourneyError(() =>
      RecitationRecordService.setSessionRecitation(cast.secondTeacher.userId, ghostId, FOREIGN_INPUT, LOCALE)
    );
    expect(denialShape(ghostDenied)).toEqual(foreignShape);

    expect(await countRecitationRows(sessionA.id)).toBe(1);
    expect(await readRecitationRow(sessionA.id)).toEqual(rowBefore);
    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 6 — parent: read collapses to null; the write denial comes from the DB-row ownership predicate", async () => {
    // The parent is not a session participant. The read is the oracle-safe
    // collapse (absent ≡ foreign ≡ non-participant — one null).
    //
    // The parent's ROLE gate is a pre-resolver scope denial asserted on the
    // live GraphQL tier; the service layer carries no role gate at all — its
    // only truth is the session row's participant ids. A parent-sourced write
    // call must therefore be denied by the ownership predicate exactly like
    // any other non-owner (no identity parameter beyond sessionId exists
    // here to smuggle).
    const before = await captureSideEffectSnapshot();
    const rowBefore = await readRecitationRow(sessionA.id);

    expect(await RecitationRecordService.getSessionRecitation(cast.parent.userId, sessionA.id)).toBeNull();

    const parentDenied = await catchJourneyError(() =>
      RecitationRecordService.setSessionRecitation(cast.parent.userId, sessionA.id, FOREIGN_INPUT, LOCALE)
    );
    expectDomainDenial(parentDenied, "SESSION_NOT_FOUND", t().sessionNotFound);
    // Cross-actor byte-identity: the parent receives EXACTLY the denial the
    // foreign teacher received in step 5.
    const foreignShape = foreignWriteShape;
    expect(foreignShape).not.toBeNull();
    if (foreignShape !== null) {
      expect(denialShape(parentDenied)).toEqual(foreignShape);
    }

    expect(await countRecitationRows(sessionA.id)).toBe(1);
    expect(await readRecitationRow(sessionA.id)).toEqual(rowBefore);
    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 7 — governed (suspended) teacher write: FORBIDDEN at the service re-check; zero rows", async () => {
    // A real governance flip on the second teacher's real users row — the
    // same teacher whose UNGOVERNED write in step 5 received the ownership
    // not-found. The flip is a fixture write BEFORE this step's snapshot, so
    // the zero-delta oracle below stays scoped to the write attempt itself.
    await setGovernanceFixture(cast.secondTeacher.userId, {
      suspended: true,
      suspendedAt: new Date(),
      suspendedPeriodDays: 7,
    });

    const before = await captureSideEffectSnapshot();
    const rowBefore = await readRecitationRow(sessionA.id);

    const denied = await catchJourneyError(() =>
      RecitationRecordService.setSessionRecitation(cast.secondTeacher.userId, sessionA.id, FOREIGN_INPUT, LOCALE)
    );
    expect(denied).toBeInstanceOf(ForbiddenError);
    expectDomainDenial(denied, "FORBIDDEN", t().forbidden);

    // The governance re-check fires pre-transaction — it pre-empts the
    // ownership not-found this same actor received while clean — and the
    // stored record stays untouched either way.
    expect(await countRecitationRows(sessionA.id)).toBe(1);
    expect(await readRecitationRow(sessionA.id)).toEqual(rowBefore);
    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });

  test("step 8 — concurrent double owner-write: exactly one row, one RECITATION_ALREADY_EXISTS loser, both participants read the same record", async () => {
    // A fresh started session for the race: the shared session's record is
    // already present, so the write-once arbiter needs an ABSENT state to
    // arbitrate. Booked by the student, started by the owner — the same
    // honest path as the shared session.
    const raceKey = `${PREFIX}-race-booking`;
    const raceSession = await SessionLifecycleService.createSession(
      cast.primaryStudent.userId,
      { teacherId: cast.teacher.userId, intent: SessionIntent.Hifz },
      raceKey,
      LOCALE
    );
    registry.track("session", raceSession.id);
    await trackIdempotencyClaim(raceKey);
    await SessionLifecycleService.startSession(cast.teacher.userId, raceSession.id, LOCALE);

    const raceSessionBefore = await readSessionRow(raceSession.id);
    const before = await captureSideEffectSnapshot();

    // Two concurrent owner writes carrying the identical double-submit
    // payload — the unique constraint is the arbiter.
    const attempts = await Promise.allSettled([
      RecitationRecordService.setSessionRecitation(cast.teacher.userId, raceSession.id, RACE_INPUT, LOCALE),
      RecitationRecordService.setSessionRecitation(cast.teacher.userId, raceSession.id, RACE_INPUT, LOCALE),
    ]);
    const fulfilled = attempts.filter(
      (result): result is PromiseFulfilledResult<RecitationReturnType> => result.status === "fulfilled"
    );
    const rejected = attempts.filter((result): result is PromiseRejectedResult => result.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const winner = fulfilled[0]?.value;
    expect(winner?.id).toBeGreaterThan(0);
    expect(winner?.sessionId).toBe(raceSession.id);
    expect(winner?.name).toBe(RACE_INPUT.name);
    expect(winner?.description).toBe(RACE_INPUT.description);

    const loserReason = rejected[0]?.reason;
    expect(loserReason).toBeInstanceOf(Error);
    if (loserReason instanceof Error) {
      expectDomainDenial(loserReason, "RECITATION_ALREADY_EXISTS", t().recitationAlreadyExists);
    }
    expect(loserReason).toBeInstanceOf(ConflictError);

    // No partial state: exactly one committed row; the lifecycle-owned
    // session row is untouched by the race.
    expect(await countRecitationRows(raceSession.id)).toBe(1);
    expect(await readSessionRow(raceSession.id)).toEqual(raceSessionBefore);

    // Both participants observe the same single stored record afterwards.
    const teacherView = await RecitationRecordService.getSessionRecitation(cast.teacher.userId, raceSession.id);
    const studentView = await RecitationRecordService.getSessionRecitation(cast.primaryStudent.userId, raceSession.id);
    expect(teacherView).not.toBeNull();
    expect(studentView).toEqual(teacherView);
    expect(teacherView?.id).toBe(winner?.id);

    expectZeroSideEffectDeltas(before, await captureSideEffectSnapshot());
  });
});
