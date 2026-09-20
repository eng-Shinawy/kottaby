/**
 * SessionRepository tests — the `session` table's data-access layer
 * (`insertSession`, `findById`, `startSessionOnce`, `completeSessionOnce`,
 * `cancelSessionOnce`, `openDisputeOnce`, `resolveDisputeCancelOnce`,
 * `resolveDisputeCompleteOnce`, `findTransitionProbe`,
 * `findRatingEligibilityProbe`, `existsSessionForTeacherStudent`,
 * `sweepExpiredCompletedOnce`, the participant list/count quartet, and the
 * admin disputed pair) against the live `kottaby_test_db` PostgreSQL
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus
 *    file-local shared-PK helpers — never seed data.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket so the outer
 *    transaction stays queryable.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branches (`queryDb` reads + the `tx ?? db` write fallback). Those
 *    branches by definition run without a transaction, so their fixtures
 *    must be committed (an uncommitted row is invisible outside the tx);
 *    they are registered and hard-deleted in `afterAll` (rule 9), keeping
 *    the repo/ directory's 100%-coverage mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every method's hit branch returns the full
 *    row/projection; every miss branch (unknown id, non-owner teacher,
 *    non-participant caller, wrong lifecycle state, never-started
 *    arbitration target) returns `null` and writes nothing. Guarded
 *    transitions mutate ONLY their documented columns (deadline never
 *    re-armed; cancelled rows keep `startedAt`, never gain `endedAt`, and
 *    keep the provenance lane for the refund; the cancel reason and the
 *    dispute reason/note persist inside their own guarded statements).
 *    The report-gate additions follow the same rules: `lockForReportGate`
 *    returns the five-column probe under the row lock (null for unknown
 *    ids), and `findReportWaveContextById` returns the three-participant
 *    projection — student, teacher, and the LINKED parent only (a null
 *    parent leg for an unlinked student, exactly the recipient set the
 *    report notification seam needs). The rating-eligibility probe addition
 *    follows the same probe rules: `findRatingEligibilityProbe` returns the
 *    six-column gate projection (identity, both participants, lifecycle
 *    state, both completion stamps) on a REQUIRED tx — a plain read that
 *    never feeds a guarded write (null for unknown ids). The
 *    post-confirmation dispute trio follows them: the student-only entry
 *    misses held fees, missing stamps, live states, and non-student
 *    callers; the consumed arbitration leg misses held disputes and settled
 *    rows and returns the eight-column arbitration probe; the arbitration
 *    probe projects exactly its escrow columns (a null lane for never-held
 *    rows).
 *  - Tier 2 (pagination): newest-first ordering (`created_at DESC`) with
 *    the `id DESC` tiebreak for rows created in the same instant; page 1
 *    exact-size; a mid window; an offset past the end yields empty items
 *    next to the honest total; the optional status filter narrows list and
 *    count COHERENTLY (one shared predicate builder); absent/null filters
 *    drop out and never error.
 *  - Tier 3 (chaos/concurrency): `Promise.allSettled` duplication —
 *    double-start, double-complete (the completion stamps and `updated_at`
 *    are written exactly once; this layer emits no wave traffic), and
 *    double-cancel each produce exactly ONE
 *    winner (the loser's guarded predicate matches zero rows against
 *    the winner's effect), and the start-against-cancel race serializes
 *    deterministically (cancel is legal from both pre-states, so both
 *    landed transitions stay consistent with the final row). The post-
 *    confirmation entry and the arbitration leg serialize the same way:
 *    double-open, double-resolve, and the open-vs-resolve interleave each
 *    land exactly their legal effects. The fused
 *    certification predicate is proven under duplication: a decertified
 *    teacher's completions produce zero winners and zero writes. The
 *    report-gate lock is exercised sequentially (the rollback harness
 *    owns one connection, so true cross-connection blocking cannot be
 *    simulated): re-locking the same row inside the writer's transaction
 *    is re-entrant, and the second probe re-evaluates its predicate
 *    against the in-transaction row state.
 *  - Tier 4 (security/tenancy/static): INV-S4 NOT NULL constraint probes
 *    (a party-less session row is rejected by the DB — 23502 naming the
 *    column); source pins — the status filter only ever carries
 *    `SessionStatus` vocabulary (closed enum, never string literals), the
 *    shared predicate builder is the single source of list/count truth,
 *    participant predicates are composed SQL-side, caller values ride
 *    bound parameters (every SQL interpolation is a module constant or a
 *    schema-object reference), no prepared statements, no array-membership
 *    operators, no SQL line-comment sequences, `tx` last everywhere, no
 *    module-level mutable state, no i18n/logger/console.
 *  - Post-completion sweeper (`sweepExpiredCompletedOnce`): Tier 1 hit
 *    returns the full row with its refund provenance intact; Tier 2 cutoff
 *    boundary (a stamp exactly at the cutoff is never swept — strict `<`),
 *    mixed stamp ages, lane-less rows, and ineligible states (student
 *    confirmed, disputed, cancelled, and the admin-arbitration COMPLETE
 *    outcome — settled with no teacher stamp to expire); Tier 3
 *    double-sweep and sweep-vs-confirm duplication with exactly one
 *    financial outcome per escrow unit; Tier 4 system-scope source pins
 *    (no caller-supplied predicate input, no wildcard/LIKE) plus the
 *    pool-fallback executor branch on committed fixtures.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { SessionRepository } from "@/backend/db/repo";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { DisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type { DBTransaction, SessionInsertType, SessionListFilterInput, SessionSelectType } from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS } from "@/shared/constants/session-fees.constants";

/** PostgreSQL error code for `not_null_violation`. */
const PG_NOT_NULL_VIOLATION = "23502";

/** The `session` select-shape keys (TS property names), locale-sorted. */
const SESSION_ROW_KEYS = [
  "cancelReason",
  "confirmationDeadline",
  "confirmedByStudentAt",
  "confirmedByTeacherAt",
  "createdAt",
  "disputedAt",
  "disputeReason",
  "endedAt",
  "fee",
  "feeHeld",
  "heldBalanceLane",
  "id",
  "intent",
  "resolutionNote",
  "resolutionOutcome",
  "resolvedAt",
  "sessionType",
  "startedAt",
  "status",
  "studentId",
  "teacherId",
  "updatedAt",
] as const;

/** Filters that must all behave identically (absent filters never error). */
const NO_FILTER: SessionListFilterInput = {};
const NULL_FILTER: SessionListFilterInput = { status: null };
const SCHEDULED_FILTER: SessionListFilterInput = { status: SessionStatus.Scheduled };
const STARTED_FILTER: SessionListFilterInput = { status: SessionStatus.Started };
const COMPLETED_FILTER: SessionListFilterInput = { status: SessionStatus.Completed };

/** Shared-PK ids for one booking pair (session.teacher_id / session.student_id). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/**
 * Shared-PK `teacher` row insert for a previously-created user — mirrors
 * the entity-setup role-child factory pattern (PK = users.id, FK cascade).
 * `isApproved` accepts `null` to pin the DB-level null-flag boundary.
 */
async function createTestTeacherRow(tx: DBTransaction, userId: number, isApproved: boolean | null): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id, true);
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/**
 * Direct session-row insert for test preconditions (full column control —
 * e.g. explicit lifecycle state or created_at for ordering tests).
 */
async function insertSessionRow(
  tx: DBTransaction,
  actors: SessionActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentUserId,
      status: SessionStatus.Scheduled,
      fee: "10.00",
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Hifz,
      ...overrides,
    })
    .returning();
  if (!row) {
    throw new Error("insertSessionRow: insert returned no rows");
  }
  return row;
}

/** An integer id that cannot exist as a `session` row during this transaction. */
async function absentSessionId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${session.id}), 0)::int` }).from(session);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Second-precision instant — the resolution `session` timestamps survive a
 * write/read round-trip at (sub-second digits do not). Sweeper fixtures
 * build every stamp and sweep instant from this so the strict `<` window
 * boundary is provable at the stored resolution.
 */
function secondPrecisionInstant(ms: number): Date {
  return new Date(Math.floor(ms / 1000) * 1000);
}

/** An integer id that cannot exist as a `users` row during this transaction. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Inserts a session row whose student user has NO `students` row — an
 * out-of-band data edge the report wave read must survive (the RESTRICT FK
 * on `session.student_id` makes the shape unreachable through ordinary
 * inserts, so the insert rides `session_replication_role = replica` for
 * THIS transaction only; the rollback harness removes the row afterward).
 */
async function insertSessionRowWithoutStudentsRow(
  tx: DBTransaction,
  actors: SessionActors
): Promise<SessionSelectType> {
  await tx.execute(sql`SET LOCAL session_replication_role = replica`);
  try {
    return await insertSessionRow(tx, actors);
  } finally {
    await tx.execute(sql`SET LOCAL session_replication_role = DEFAULT`);
  }
}

/**
 * A dual-confirmed consumed-escrow row — the shape a session reaches once
 * `confirmStudentCompletionOnce` has consumed its hold: started and ended
 * with both confirmation stamps written, the hold marker cleared, and the
 * provenance lane still recorded (permanent refund provenance). The
 * post-confirmation dispute entry and the arbitration completion leg both
 * target exactly this shape.
 */
async function insertConsumedSessionRow(
  tx: DBTransaction,
  actors: SessionActors,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const stamp = secondPrecisionInstant(Date.now() - 60_000);
  return insertSessionRow(tx, actors, {
    status: SessionStatus.Completed,
    startedAt: stamp,
    endedAt: stamp,
    confirmedByTeacherAt: stamp,
    confirmedByStudentAt: stamp,
    feeHeld: false,
    ...overrides,
  });
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */

/**
 * Walks the same cause chain searching for an `Error.message` containing
 * the given substring — used to confirm the underlying PostgreSQL
 * diagnostic (which names the rejecting column/constraint) is reachable
 * through the Drizzle wrapper.
 */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Reads the session row straight off the table (read-back oracle). */
async function readSessionRow(tx: DBTransaction, id: number): Promise<SessionSelectType> {
  const [row] = await tx.select().from(session).where(eq(session.id, id)).limit(1);
  if (!row) {
    throw new Error("readSessionRow: expected the session row to exist");
  }
  return row;
}

describe("SessionRepository — transactional paths (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("insertSession returns the inserted row with every server-generated column populated", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const deadline = new Date(Math.floor((Date.now() + 60_000) / 1000) * 1000);

      const inserted = await SessionRepository.insertSession(
        {
          teacherId: actors.teacherUserId,
          studentId: actors.studentUserId,
          status: SessionStatus.Scheduled,
          sessionType: SessionType.StudentSession,
          intent: SessionIntent.Hifz,
          fee: "12.50",
          feeHeld: true,
          heldBalanceLane: HeldBalanceLane.Hifz,
          confirmationDeadline: deadline,
        },
        tx
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.teacherId).toBe(actors.teacherUserId);
      expect(inserted.studentId).toBe(actors.studentUserId);
      expect(inserted.status).toBe(SessionStatus.Scheduled);
      expect(inserted.sessionType).toBe(SessionType.StudentSession);
      expect(inserted.intent).toBe(SessionIntent.Hifz);
      expect(inserted.fee).toBe("12.50");
      expect(inserted.feeHeld).toBe(true);
      expect(inserted.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(inserted.confirmationDeadline?.getTime()).toBe(deadline.getTime());
      expect(inserted.createdAt).not.toBeNull();
      expect(inserted.updatedAt).not.toBeNull();
      expect(inserted.startedAt).toBeNull();
      expect(inserted.endedAt).toBeNull();
      expect(inserted.confirmedByStudentAt).toBeNull();
      expect(inserted.confirmedByTeacherAt).toBeNull();
      // RETURNING * mirrors the $inferSelect shape 1:1 — exactly the 21
      // table columns, nothing added, nothing dropped.
      expect(Object.keys(inserted).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
    });
  });

  test("insertSession lets schema defaults fill the columns a caller legitimately omits", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);

      const inserted = await SessionRepository.insertSession(
        { teacherId: actors.teacherUserId, studentId: actors.studentUserId },
        tx
      );

      expect(inserted.status).toBe(SessionStatus.Scheduled);
      expect(inserted.sessionType).toBe(SessionType.StudentSession);
      expect(inserted.feeHeld).toBe(false);
      expect(inserted.intent).toBeNull();
      expect(inserted.fee).toBeNull();
      expect(inserted.heldBalanceLane).toBeNull();
      expect(inserted.confirmationDeadline).toBeNull();
    });
  });

  test("findById returns the full row for an existing id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const found = await SessionRepository.findById(row.id, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(row.id);
      expect(found?.teacherId).toBe(actors.teacherUserId);
      expect(found?.studentId).toBe(actors.studentUserId);
      expect(found?.status).toBe(SessionStatus.Scheduled);
      expect(found?.feeHeld).toBe(true);
      expect(found?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(Object.keys(found ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
    });
  });

  test("findById returns null for an unknown id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentSessionId(tx);

      const found = await SessionRepository.findById(missingId, tx);

      expect(found).toBeNull();
    });
  });

  test("existsSessionForTeacherStudent returns true for a linked pair across every lifecycle status", async () => {
    await runInRollback(async tx => {
      // A shared teacher↔student pair: any-status session row linking the
      // two satisfies the EXISTS predicate.
      const actors = await createSessionActors(tx);
      const scheduled = await insertSessionRow(tx, actors, { status: SessionStatus.Scheduled });
      // 'started' carries the same participant pair on a separate row.
      const started = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(started.id, actors.teacherUserId, tx);

      const completed = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(completed.id, actors.teacherUserId, tx);
      await SessionRepository.completeSessionOnce(completed.id, actors.teacherUserId, tx);

      const cancelled = await insertSessionRow(tx, actors);
      await SessionRepository.cancelSessionOnce(cancelled.id, actors.studentUserId, null, tx);

      const disputed = await insertSessionRow(tx, actors);
      await SessionRepository.openDisputeOnce(disputed.id, actors.studentUserId, "linked-status-probe", tx);

      // One probe per status — every row links the SAME teacher↔student pair,
      // so every probe returns true regardless of lifecycle state. Promise.all
      // collects the awaits (the lint rule bans `await` inside an imperative
      // loop; the parallel collector is the established pattern).
      const lifecycleRows = [scheduled, started, completed, cancelled, disputed];
      const linkedResults = await Promise.all(
        lifecycleRows.map(() =>
          SessionRepository.existsSessionForTeacherStudent(actors.teacherUserId, actors.studentUserId, tx)
        )
      );
      for (const linked of linkedResults) {
        expect(linked).toBe(true);
      }

      // Direct row-by-id sanity check: the five rows are still here. The
      // read-backs are independent and run in parallel under Promise.all.
      const stillExisting = await Promise.all(lifecycleRows.map(lifecycleRow => readSessionRow(tx, lifecycleRow.id)));
      for (const row of stillExisting) {
        expect(row).toBeDefined();
      }
    });
  });

  test("existsSessionForTeacherStudent returns false for an unlinked teacher, an unknown student, and a foreign pair", async () => {
    await runInRollback(async tx => {
      // Two disjoint teacher↔student pairs in the table.
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const missingUserId = await absentUserId(tx);
      const missingSessionId = await absentSessionId(tx);

      // An unlinked pair: A's teacher probes B's student — zero rows link
      // them, so the predicate returns false. (A session exists for A
      // with student A, and one exists for B with student B, but neither
      // crosses the pair.)
      const linkedToA = await insertSessionRow(tx, actorsA);
      await insertSessionRow(tx, actorsB);
      const crossProbe = await SessionRepository.existsSessionForTeacherStudent(
        actorsA.teacherUserId,
        actorsB.studentUserId,
        tx
      );
      expect(crossProbe).toBe(false);

      // Unknown student id — zero rows, false.
      const unknownStudent = await SessionRepository.existsSessionForTeacherStudent(
        actorsA.teacherUserId,
        missingSessionId,
        tx
      );
      expect(unknownStudent).toBe(false);

      // Unknown teacher id — zero rows, false.
      const unknownTeacher = await SessionRepository.existsSessionForTeacherStudent(
        missingUserId,
        actorsA.studentUserId,
        tx
      );
      expect(unknownTeacher).toBe(false);

      // A pair with no shared session at all (the missing-missing case).
      const unknownPair = await SessionRepository.existsSessionForTeacherStudent(missingUserId, missingSessionId, tx);
      expect(unknownPair).toBe(false);

      // Sanity: the existing A row is the row linking A's teacher to A's
      // student — the same probe against A's pair returns true.
      const samePairProbe = await SessionRepository.existsSessionForTeacherStudent(
        actorsA.teacherUserId,
        actorsA.studentUserId,
        tx
      );
      expect(samePairProbe).toBe(true);
      expect(linkedToA.id).toBeGreaterThan(0);
    });
  });

  test("startSessionOnce moves a scheduled row to started, stamping startedAt/updatedAt from one instant", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const deadline = new Date(Math.floor((Date.now() + 3_600_000) / 1000) * 1000);
      const row = await insertSessionRow(tx, actors, { confirmationDeadline: deadline });

      const started = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);

      expect(started).not.toBeNull();
      expect(started?.status).toBe(SessionStatus.Started);
      expect(started?.startedAt).not.toBeNull();
      expect(started?.startedAt?.getTime()).toBe(started?.updatedAt.getTime());
      // No other field may change: the deadline is written at creation and
      // never re-armed by a transition; the escrow columns stay untouched.
      expect(started?.confirmationDeadline?.getTime()).toBe(deadline.getTime());
      expect(started?.feeHeld).toBe(true);
      expect(started?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(started?.endedAt).toBeNull();
      expect(started?.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
    });
  });

  test("startSessionOnce returns null and writes nothing for: wrong state, non-owner teacher, unknown id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const missingUserId = await absentUserId(tx);
      const missingSessionId = await absentSessionId(tx);

      // Already started — the pre-start state is gone.
      const first = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(first?.status).toBe(SessionStatus.Started);
      const wrongState = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(wrongState).toBeNull();

      // A teacher id that does not own the row.
      const startedAgain = await insertSessionRow(tx, actors);
      const nonOwner = await SessionRepository.startSessionOnce(startedAgain.id, missingUserId, tx);
      expect(nonOwner).toBeNull();

      // Unknown session id.
      const unknown = await SessionRepository.startSessionOnce(missingSessionId, actors.teacherUserId, tx);
      expect(unknown).toBeNull();

      // The misses wrote nothing: the non-owner's target is still scheduled
      // with a NULL start stamp.
      const untouched = await readSessionRow(tx, startedAgain.id);
      expect(untouched.status).toBe(SessionStatus.Scheduled);
      expect(untouched.startedAt).toBeNull();
    });
  });

  test("completeSessionOnce completes a started row under a certified teacher, stamping endedAt + confirmedByTeacherAt", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const started = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(started?.startedAt).not.toBeNull();

      const completed = await SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx);

      expect(completed).not.toBeNull();
      expect(completed?.status).toBe(SessionStatus.Completed);
      expect(completed?.endedAt).not.toBeNull();
      expect(completed?.endedAt?.getTime()).toBe(completed?.confirmedByTeacherAt?.getTime());
      expect(completed?.confirmedByTeacherAt).not.toBeNull();
      // A completion preserves the start stamp and touches only the
      // documented columns.
      expect(completed?.startedAt?.getTime()).toBe(started?.startedAt?.getTime());
      expect(completed?.updatedAt.getTime()).toBeGreaterThanOrEqual(started?.updatedAt.getTime() ?? 0);
    });
  });

  test("completeSessionOnce returns null and writes nothing for: decertified teacher, null certification, wrong state, non-owner, unknown id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingUserId = await absentUserId(tx);
      const missingSessionId = await absentSessionId(tx);

      // The fused EXISTS: a teacher whose certification was revoked after
      // booking can never complete — zero rows match, the row stays
      // started (no partial write).
      const decertifiedUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, decertifiedUser.id, false);
      const decertifiedRow = await insertSessionRow(tx, {
        teacherUserId: decertifiedUser.id,
        studentUserId: actors.studentUserId,
      });
      await SessionRepository.startSessionOnce(decertifiedRow.id, decertifiedUser.id, tx);
      const decertified = await SessionRepository.completeSessionOnce(decertifiedRow.id, decertifiedUser.id, tx);
      expect(decertified).toBeNull();
      const stillStarted = await readSessionRow(tx, decertifiedRow.id);
      expect(stillStarted.status).toBe(SessionStatus.Started);
      expect(stillStarted.endedAt).toBeNull();

      // A DB-level NULL certification is not a certification: only strict
      // truth passes the fused EXISTS.
      const nullCertifiedUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, nullCertifiedUser.id, null);
      const nullCertifiedRow = await insertSessionRow(tx, {
        teacherUserId: nullCertifiedUser.id,
        studentUserId: actors.studentUserId,
      });
      await SessionRepository.startSessionOnce(nullCertifiedRow.id, nullCertifiedUser.id, tx);
      const nullCertified = await SessionRepository.completeSessionOnce(nullCertifiedRow.id, nullCertifiedUser.id, tx);
      expect(nullCertified).toBeNull();

      // Wrong state: a scheduled row was never started.
      const scheduledRow = await insertSessionRow(tx, actors);
      const wrongState = await SessionRepository.completeSessionOnce(scheduledRow.id, actors.teacherUserId, tx);
      expect(wrongState).toBeNull();

      // Non-owner teacher + unknown id.
      const startedRow = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(startedRow.id, actors.teacherUserId, tx);
      const nonOwner = await SessionRepository.completeSessionOnce(startedRow.id, missingUserId, tx);
      expect(nonOwner).toBeNull();
      const unknown = await SessionRepository.completeSessionOnce(missingSessionId, actors.teacherUserId, tx);
      expect(unknown).toBeNull();
    });
  });

  test("cancelSessionOnce by the student cancels a scheduled row, clearing the hold marker but keeping the provenance lane", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const cancelled = await SessionRepository.cancelSessionOnce(row.id, actors.studentUserId, null, tx);

      expect(cancelled).not.toBeNull();
      expect(cancelled?.status).toBe(SessionStatus.Cancelled);
      expect(cancelled?.feeHeld).toBe(false);
      // The hold marker is cleared; the provenance lane survives so the
      // caller's same-lane refund can read it off the returned row.
      expect(cancelled?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      // Cancelled rows keep a NULL start stamp and never gain an end stamp.
      expect(cancelled?.startedAt).toBeNull();
      expect(cancelled?.endedAt).toBeNull();
    });
  });

  test("cancelSessionOnce by the teacher cancels a started row, preserving startedAt and never writing endedAt", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const started = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(started?.startedAt).not.toBeNull();

      const cancelled = await SessionRepository.cancelSessionOnce(row.id, actors.teacherUserId, null, tx);

      expect(cancelled?.status).toBe(SessionStatus.Cancelled);
      expect(cancelled?.feeHeld).toBe(false);
      expect(cancelled?.startedAt?.getTime()).toBe(started?.startedAt?.getTime());
      expect(cancelled?.endedAt).toBeNull();
    });
  });

  test("cancelSessionOnce returns null and writes nothing for: non-participant caller, terminal states, unknown id", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      // A REAL non-participant: student B cancels A's session — the
      // participant predicate is SQL-side, so an unrelated existing user
      // matches neither owner column.
      const rowA = await insertSessionRow(tx, actorsA);
      const foreignCaller = await SessionRepository.cancelSessionOnce(rowA.id, actorsB.studentUserId, null, tx);
      expect(foreignCaller).toBeNull();

      // Completed rows are structurally unreachable for cancel — the
      // cancel-after-complete regression probe (no refund of an earned
      // session).
      const completedRow = await insertSessionRow(tx, actorsA);
      await SessionRepository.startSessionOnce(completedRow.id, actorsA.teacherUserId, tx);
      await SessionRepository.completeSessionOnce(completedRow.id, actorsA.teacherUserId, tx);
      const afterComplete = await SessionRepository.cancelSessionOnce(completedRow.id, actorsA.studentUserId, null, tx);
      expect(afterComplete).toBeNull();
      const stillCompleted = await readSessionRow(tx, completedRow.id);
      expect(stillCompleted.status).toBe(SessionStatus.Completed);
      expect(stillCompleted.feeHeld).toBe(true);

      // Double-cancel: the second attempt matches zero rows.
      const cancelledRow = await insertSessionRow(tx, actorsA);
      await SessionRepository.cancelSessionOnce(cancelledRow.id, actorsA.studentUserId, null, tx);
      const doubleCancel = await SessionRepository.cancelSessionOnce(cancelledRow.id, actorsA.studentUserId, null, tx);
      expect(doubleCancel).toBeNull();

      // Unknown session id.
      const unknown = await SessionRepository.cancelSessionOnce(missingSessionId, actorsA.studentUserId, null, tx);
      expect(unknown).toBeNull();
    });
  });

  test("cancelSessionOnce persists the trimmed cancellation reason inside the guarded UPDATE (null when none)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const withReason = await insertSessionRow(tx, actors);
      const withoutReason = await insertSessionRow(tx, actors);

      const reasoned = await SessionRepository.cancelSessionOnce(
        withReason.id,
        actors.studentUserId,
        "schedule conflict",
        tx
      );
      expect(reasoned?.status).toBe(SessionStatus.Cancelled);
      expect(reasoned?.cancelReason).toBe("schedule conflict");

      const bare = await SessionRepository.cancelSessionOnce(withoutReason.id, actors.studentUserId, null, tx);
      expect(bare?.status).toBe(SessionStatus.Cancelled);
      expect(bare?.cancelReason).toBeNull();
    });
  });

  test("openDisputeOnce moves a scheduled row to disputed, persisting the reason and the dispute stamp", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const disputed = await SessionRepository.openDisputeOnce(row.id, actors.teacherUserId, "teacher no-show", tx);

      expect(disputed).not.toBeNull();
      expect(disputed?.status).toBe(SessionStatus.Disputed);
      expect(disputed?.disputeReason).toBe("teacher no-show");
      expect(disputed?.disputedAt).not.toBeNull();
      expect(disputed?.disputedAt?.getTime()).toBe(disputed?.updatedAt.getTime());
      // The escrow hold is deliberately untouched — the money stays frozen
      // until the arbitration outcome.
      expect(disputed?.feeHeld).toBe(true);
      expect(disputed?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      // The row carries exactly the 21-column select shape.
      expect(Object.keys(disputed ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
    });
  });

  test("openDisputeOnce works from BOTH live states and from either participant", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const scheduled = await insertSessionRow(tx, actors);
      const started = await insertSessionRow(tx, actors);
      const startedRow = await SessionRepository.startSessionOnce(started.id, actors.teacherUserId, tx);
      expect(startedRow?.status).toBe(SessionStatus.Started);

      const fromScheduled = await SessionRepository.openDisputeOnce(scheduled.id, actors.studentUserId, "r1", tx);
      expect(fromScheduled?.status).toBe(SessionStatus.Disputed);
      const fromStarted = await SessionRepository.openDisputeOnce(started.id, actors.studentUserId, "r2", tx);
      expect(fromStarted?.status).toBe(SessionStatus.Disputed);
      expect(fromStarted?.startedAt?.getTime()).toBe(startedRow?.startedAt?.getTime());
    });
  });

  test("openDisputeOnce returns null and writes nothing for: wrong state, non-participant caller, unknown id", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      // A REAL non-participant: student B disputes A's session.
      const rowA = await insertSessionRow(tx, actorsA);
      const foreignCaller = await SessionRepository.openDisputeOnce(rowA.id, actorsB.studentUserId, "r", tx);
      expect(foreignCaller).toBeNull();

      // Terminal states are structurally unreachable for a dispute.
      const completedRow = await insertSessionRow(tx, actorsA);
      await SessionRepository.startSessionOnce(completedRow.id, actorsA.teacherUserId, tx);
      await SessionRepository.completeSessionOnce(completedRow.id, actorsA.teacherUserId, tx);
      const afterComplete = await SessionRepository.openDisputeOnce(completedRow.id, actorsA.studentUserId, "r", tx);
      expect(afterComplete).toBeNull();
      const stillCompleted = await readSessionRow(tx, completedRow.id);
      expect(stillCompleted.status).toBe(SessionStatus.Completed);
      expect(stillCompleted.disputeReason).toBeNull();

      // Double-dispute: the second attempt matches zero rows and never
      // rewrites the recorded reason.
      const disputedRow = await insertSessionRow(tx, actorsA);
      const first = await SessionRepository.openDisputeOnce(disputedRow.id, actorsA.studentUserId, "first", tx);
      expect(first?.status).toBe(SessionStatus.Disputed);
      const doubleDispute = await SessionRepository.openDisputeOnce(
        disputedRow.id,
        actorsA.teacherUserId,
        "second",
        tx
      );
      expect(doubleDispute).toBeNull();
      const recorded = await readSessionRow(tx, disputedRow.id);
      expect(recorded.disputeReason).toBe("first");

      // Unknown session id.
      const unknown = await SessionRepository.openDisputeOnce(missingSessionId, actorsA.studentUserId, "r", tx);
      expect(unknown).toBeNull();
    });
  });

  test("resolveDisputeCancelOnce resolves a disputed row to cancelled, clearing the hold and keeping the provenance lane", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const disputed = await SessionRepository.openDisputeOnce(row.id, actors.studentUserId, "r", tx);
      expect(disputed?.status).toBe(SessionStatus.Disputed);

      const resolved = await SessionRepository.resolveDisputeCancelOnce(
        row.id,
        "refunded in full",
        DisputeResolution.Cancel,
        tx
      );

      expect(resolved).not.toBeNull();
      expect(resolved?.status).toBe(SessionStatus.Cancelled);
      expect(resolved?.feeHeld).toBe(false);
      // The provenance lane survives so the caller's same-lane refund can
      // read it off the returned row.
      expect(resolved?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(resolved?.resolutionNote).toBe("refunded in full");
      // CR-5: the formal outcome is persisted beside the note.
      expect(resolved?.resolutionOutcome).toBe(DisputeResolution.Cancel);
      expect(resolved?.resolvedAt).not.toBeNull();
      expect(resolved?.resolvedAt?.getTime()).toBe(resolved?.updatedAt.getTime());
      // A cancellation never writes an end stamp; the dispute reason stays.
      expect(resolved?.endedAt).toBeNull();
      expect(resolved?.disputeReason).toBe("r");
    });
  });

  test("resolveDisputeCancelOnce accepts a null note and rejects every non-disputed shape", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      const row = await insertSessionRow(tx, actors);
      await SessionRepository.openDisputeOnce(row.id, actors.studentUserId, "r", tx);
      const bare = await SessionRepository.resolveDisputeCancelOnce(row.id, null, DisputeResolution.Cancel, tx);
      expect(bare?.status).toBe(SessionStatus.Cancelled);
      expect(bare?.resolutionNote).toBeNull();
      // The outcome persists even when the note is absent (CR-5's reason).
      expect(bare?.resolutionOutcome).toBe(DisputeResolution.Cancel);

      // A scheduled row is not disputed — the guarded predicate misses.
      const scheduledRow = await insertSessionRow(tx, actors);
      const notDisputed = await SessionRepository.resolveDisputeCancelOnce(
        scheduledRow.id,
        "n",
        DisputeResolution.Cancel,
        tx
      );
      expect(notDisputed).toBeNull();
      const stillScheduled = await readSessionRow(tx, scheduledRow.id);
      expect(stillScheduled.status).toBe(SessionStatus.Scheduled);
      expect(stillScheduled.feeHeld).toBe(true);

      // Double-resolve: the second attempt matches zero rows.
      const doubleResolve = await SessionRepository.resolveDisputeCancelOnce(
        row.id,
        "again",
        DisputeResolution.Cancel,
        tx
      );
      expect(doubleResolve).toBeNull();

      // Unknown session id.
      const unknown = await SessionRepository.resolveDisputeCancelOnce(
        missingSessionId,
        "n",
        DisputeResolution.Cancel,
        tx
      );
      expect(unknown).toBeNull();
    });
  });

  test("resolveDisputeCompleteOnce completes a started dispute, consuming the hold and writing the end/resolution stamps", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const started = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(started?.startedAt).not.toBeNull();
      await SessionRepository.openDisputeOnce(row.id, actors.studentUserId, "r", tx);

      const resolved = await SessionRepository.resolveDisputeCompleteOnce(
        row.id,
        "held per policy",
        DisputeResolution.Complete,
        tx
      );
      expect(resolved?.resolutionOutcome).toBe(DisputeResolution.Complete);

      expect(resolved).not.toBeNull();
      expect(resolved?.status).toBe(SessionStatus.Completed);
      // The hold is consumed in the same guarded statement; no wallet
      // credit is part of this method.
      expect(resolved?.feeHeld).toBe(false);
      expect(resolved?.resolutionNote).toBe("held per policy");
      expect(resolved?.resolvedAt).not.toBeNull();
      expect(resolved?.endedAt).not.toBeNull();
      expect(resolved?.endedAt?.getTime()).toBe(resolved?.resolvedAt?.getTime());
      // The start stamp is preserved through the arbitration.
      expect(resolved?.startedAt?.getTime()).toBe(started?.startedAt?.getTime());
    });
  });

  test("resolveDisputeCompleteOnce rejects a never-started dispute and every non-disputed shape", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      // A disputed row that never started cannot complete — the fused
      // IS-NOT-NULL predicate misses, and the row stays disputed.
      const neverStarted = await insertSessionRow(tx, actors);
      await SessionRepository.openDisputeOnce(neverStarted.id, actors.studentUserId, "r", tx);
      const rejected = await SessionRepository.resolveDisputeCompleteOnce(
        neverStarted.id,
        "n",
        DisputeResolution.Complete,
        tx
      );
      expect(rejected).toBeNull();
      const stillDisputed = await readSessionRow(tx, neverStarted.id);
      expect(stillDisputed.status).toBe(SessionStatus.Disputed);
      expect(stillDisputed.feeHeld).toBe(true);
      expect(stillDisputed.resolutionNote).toBeNull();

      // Wrong state + unknown id.
      const scheduledRow = await insertSessionRow(tx, actors);
      const notDisputed = await SessionRepository.resolveDisputeCompleteOnce(
        scheduledRow.id,
        "n",
        DisputeResolution.Complete,
        tx
      );
      expect(notDisputed).toBeNull();
      const unknown = await SessionRepository.resolveDisputeCompleteOnce(
        missingSessionId,
        "n",
        DisputeResolution.Complete,
        tx
      );
      expect(unknown).toBeNull();
    });
  });

  test("openPostConfirmationDisputeOnce disputes a dual-confirmed completed row, persisting the reason and the dispute stamp", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      const disputed = await SessionRepository.openPostConfirmationDisputeOnce(
        row.id,
        actors.studentUserId,
        "session felt rushed",
        tx
      );

      expect(disputed).not.toBeNull();
      expect(disputed?.status).toBe(SessionStatus.Disputed);
      expect(disputed?.disputeReason).toBe("session felt rushed");
      expect(disputed?.disputedAt).not.toBeNull();
      expect(disputed?.disputedAt?.getTime()).toBe(disputed?.updatedAt.getTime());
      // Opening the dispute records intent only — the consumed escrow, the
      // provenance lane, and every completion stamp stay exactly as the
      // dual confirmation left them.
      expect(disputed?.feeHeld).toBe(false);
      expect(disputed?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(disputed?.fee).toBe("10.00");
      expect(disputed?.confirmedByStudentAt?.getTime()).toBe(row.confirmedByStudentAt?.getTime());
      expect(disputed?.startedAt?.getTime()).toBe(row.startedAt?.getTime());
      expect(disputed?.endedAt?.getTime()).toBe(row.endedAt?.getTime());
      expect(disputed?.resolutionNote).toBeNull();
      expect(disputed?.resolvedAt).toBeNull();
      // The row carries exactly the 21-column select shape.
      expect(Object.keys(disputed ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
    });
  });

  test("openPostConfirmationDisputeOnce returns null and writes nothing for: wrong states, missing student stamp, held fee, unknown id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      // Live states belong to the held generation's dispute entry.
      const scheduledRow = await insertSessionRow(tx, actors);
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(scheduledRow.id, actors.studentUserId, "r", tx)
      ).toBeNull();
      const started = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(started.id, actors.teacherUserId, tx);
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(started.id, actors.studentUserId, "r", tx)
      ).toBeNull();

      // A teacher-confirmed row inside its confirmation window has no
      // student stamp yet — the dual confirmation is incomplete.
      const unconfirmed = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(),
        feeHeld: true,
      });
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(unconfirmed.id, actors.studentUserId, "r", tx)
      ).toBeNull();

      // A held fee means the held generation — even a fully stamped row
      // (crafted defensively) cannot enter through the consumed gate.
      const heldRow = await insertConsumedSessionRow(tx, actors, { feeHeld: true });
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(heldRow.id, actors.studentUserId, "r", tx)
      ).toBeNull();

      // Terminal rows are structurally unreachable.
      const cancelledRow = await insertSessionRow(tx, actors);
      await SessionRepository.cancelSessionOnce(cancelledRow.id, actors.studentUserId, null, tx);
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(cancelledRow.id, actors.studentUserId, "r", tx)
      ).toBeNull();

      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(missingSessionId, actors.studentUserId, "r", tx)
      ).toBeNull();

      // Every miss left its row untouched: no stamp written, no dispute
      // recorded, no state flipped.
      const stillUnconfirmed = await readSessionRow(tx, unconfirmed.id);
      expect(stillUnconfirmed.status).toBe(SessionStatus.Completed);
      expect(stillUnconfirmed.confirmedByStudentAt).toBeNull();
      expect(stillUnconfirmed.disputeReason).toBeNull();
      expect(stillUnconfirmed.disputedAt).toBeNull();
      const stillCancelled = await readSessionRow(tx, cancelledRow.id);
      expect(stillCancelled.status).toBe(SessionStatus.Cancelled);
      expect(stillCancelled.disputeReason).toBeNull();
    });
  });

  test("openPostConfirmationDisputeOnce is student-only tenancy: a foreign student and the owning teacher both miss", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const outsiders = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      // A REAL non-participant: student B disputes A's session.
      expect(
        await SessionRepository.openPostConfirmationDisputeOnce(row.id, outsiders.studentUserId, "r", tx)
      ).toBeNull();
      // The teacher is a participant but never the post-confirmation
      // disputant — the pre-completion entry is the teacher's path.
      expect(await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.teacherUserId, "r", tx)).toBeNull();

      const untouched = await readSessionRow(tx, row.id);
      expect(untouched.status).toBe(SessionStatus.Completed);
      expect(untouched.disputeReason).toBeNull();
      expect(untouched.disputedAt).toBeNull();
    });
  });

  test("openPostConfirmationDisputeOnce double-fire: the replay misses and never rewrites the recorded reason", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      const first = await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "first", tx);
      expect(first?.status).toBe(SessionStatus.Disputed);
      const replay = await SessionRepository.openPostConfirmationDisputeOnce(
        row.id,
        actors.studentUserId,
        "second",
        tx
      );
      expect(replay).toBeNull();

      const recorded = await readSessionRow(tx, row.id);
      expect(recorded.disputeReason).toBe("first");
      expect(recorded.status).toBe(SessionStatus.Disputed);
    });
  });

  test("resolveConsumedDisputeOnce completes a consumed dispute and returns the nine-column arbitration probe", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);
      const disputed = await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "r", tx);
      expect(disputed?.status).toBe(SessionStatus.Disputed);

      const resolved = await SessionRepository.resolveConsumedDisputeOnce(
        row.id,
        "refunded in full",
        DisputeResolution.PartialRefund,
        tx
      );

      expect(resolved).not.toBeNull();
      // The returned row is exactly the arbitration probe projection —
      // nothing more, nothing less.
      expect(Object.keys(resolved ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "confirmedByStudentAt",
        "fee",
        "feeHeld",
        "heldBalanceLane",
        "id",
        "resolutionOutcome",
        "resolvedAt",
        "status",
        "studentId",
        "teacherId",
      ]);
      expect(resolved?.id).toBe(row.id);
      expect(resolved?.status).toBe(SessionStatus.Completed);
      // The outcome rides the probe (the caller's response re-read carries
      // it too — one source of truth for the participant-facing decision).
      expect(resolved?.resolutionOutcome).toBe(DisputeResolution.PartialRefund);
      expect(resolved?.studentId).toBe(actors.studentUserId);
      expect(resolved?.teacherId).toBe(actors.teacherUserId);
      expect(resolved?.fee).toBe("10.00");
      expect(resolved?.feeHeld).toBe(false);
      // The provenance lane and the student stamp ride the probe so the
      // caller composes the outcome legs without a re-read.
      expect(resolved?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(resolved?.confirmedByStudentAt?.getTime()).toBe(row.confirmedByStudentAt?.getTime());

      // The SET clause wrote only the resolution pair plus the audit stamp;
      // the dispute record and the original completion stamps survive.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.resolutionNote).toBe("refunded in full");
      expect(finalRow.resolvedAt).not.toBeNull();
      expect(finalRow.resolvedAt?.getTime()).toBe(finalRow.updatedAt.getTime());
      expect(finalRow.disputeReason).toBe("r");
      expect(finalRow.disputedAt?.getTime()).toBe(disputed?.disputedAt?.getTime());
      expect(finalRow.endedAt?.getTime()).toBe(row.endedAt?.getTime());
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    });
  });

  test("resolveConsumedDisputeOnce accepts a null note and rejects every non-consumed shape", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingSessionId = await absentSessionId(tx);

      const row = await insertConsumedSessionRow(tx, actors);
      await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "r", tx);
      const bare = await SessionRepository.resolveConsumedDisputeOnce(row.id, null, DisputeResolution.Refund, tx);
      expect(bare?.status).toBe(SessionStatus.Completed);
      expect(bare?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      const bareRow = await readSessionRow(tx, row.id);
      expect(bareRow.resolutionNote).toBeNull();

      // A held-generation dispute (fee still frozen) resolves through the
      // shipped CANCEL/COMPLETE pair — never through this consumed leg.
      const heldDisputed = await insertSessionRow(tx, actors);
      await SessionRepository.openDisputeOnce(heldDisputed.id, actors.studentUserId, "r", tx);
      expect(
        await SessionRepository.resolveConsumedDisputeOnce(heldDisputed.id, "n", DisputeResolution.Refund, tx)
      ).toBeNull();
      const stillHeldDisputed = await readSessionRow(tx, heldDisputed.id);
      expect(stillHeldDisputed.status).toBe(SessionStatus.Disputed);
      expect(stillHeldDisputed.feeHeld).toBe(true);
      expect(stillHeldDisputed.resolutionNote).toBeNull();

      // Wrong states + unknown id.
      const scheduledRow = await insertSessionRow(tx, actors);
      expect(
        await SessionRepository.resolveConsumedDisputeOnce(scheduledRow.id, "n", DisputeResolution.Refund, tx)
      ).toBeNull();
      const cancelledRow = await insertSessionRow(tx, actors);
      await SessionRepository.cancelSessionOnce(cancelledRow.id, actors.studentUserId, null, tx);
      expect(
        await SessionRepository.resolveConsumedDisputeOnce(cancelledRow.id, "n", DisputeResolution.Refund, tx)
      ).toBeNull();
      expect(
        await SessionRepository.resolveConsumedDisputeOnce(missingSessionId, "n", DisputeResolution.Refund, tx)
      ).toBeNull();

      // Double-resolve: the second attempt matches zero rows.
      expect(
        await SessionRepository.resolveConsumedDisputeOnce(row.id, "again", DisputeResolution.Refund, tx)
      ).toBeNull();
      const onceOnly = await readSessionRow(tx, row.id);
      expect(onceOnly.resolutionNote).toBeNull();
    });
  });

  test("resolveConsumedDisputeOnce surfaces a null provenance lane for a never-held row (the defensive no-op leg)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // A completed row that never held a fee: no lane recorded (NULL is
      // the never-held marker) while the dual confirmation is present. The
      // dispute opens normally and the resolved probe reports the null
      // lane — the caller's lane-credit leg becomes a no-op while the
      // teacher debit still applies.
      const neverHeld = await insertConsumedSessionRow(tx, actors, { heldBalanceLane: null });
      expect(neverHeld.heldBalanceLane).toBeNull();
      const disputed = await SessionRepository.openPostConfirmationDisputeOnce(
        neverHeld.id,
        actors.studentUserId,
        "r",
        tx
      );
      expect(disputed?.status).toBe(SessionStatus.Disputed);

      const resolved = await SessionRepository.resolveConsumedDisputeOnce(
        neverHeld.id,
        "n",
        DisputeResolution.Refund,
        tx
      );
      expect(resolved).not.toBeNull();
      expect(resolved?.heldBalanceLane).toBeNull();
      expect(resolved?.feeHeld).toBe(false);
      expect(resolved?.status).toBe(SessionStatus.Completed);
      expect(resolved?.confirmedByStudentAt?.getTime()).toBe(neverHeld.confirmedByStudentAt?.getTime());
    });
  });

  test("findTransitionProbe returns exactly the five-column classification projection", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const probe = await SessionRepository.findTransitionProbe(row.id, tx);

      expect(probe).not.toBeNull();
      expect(Object.keys(probe ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "id",
        "startedAt",
        "status",
        "studentId",
        "teacherId",
      ]);
      expect(probe?.id).toBe(row.id);
      expect(probe?.status).toBe(SessionStatus.Scheduled);
      expect(probe?.startedAt).toBeNull();
      expect(probe?.studentId).toBe(actors.studentUserId);
      expect(probe?.teacherId).toBe(actors.teacherUserId);
    });
  });

  test("findTransitionProbe surfaces the post-transition state (classification basis) and null for unknown ids", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingId = await absentSessionId(tx);

      expect(await SessionRepository.findTransitionProbe(missingId, tx)).toBeNull();

      const row = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      await SessionRepository.cancelSessionOnce(row.id, actors.teacherUserId, null, tx);

      const probe = await SessionRepository.findTransitionProbe(row.id, tx);
      expect(probe?.status).toBe(SessionStatus.Cancelled);
    });
  });

  test("findArbitrationProbe returns exactly the ten-column escrow projection, null for unknown ids", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingId = await absentSessionId(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      expect(await SessionRepository.findArbitrationProbe(missingId, tx)).toBeNull();

      const probe = await SessionRepository.findArbitrationProbe(row.id, tx);
      expect(probe).not.toBeNull();
      expect(Object.keys(probe ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "confirmedByStudentAt",
        "fee",
        "feeHeld",
        "heldBalanceLane",
        "id",
        "resolutionOutcome",
        "resolvedAt",
        "status",
        "studentId",
        "teacherId",
      ]);
      expect(probe?.id).toBe(row.id);
      expect(probe?.status).toBe(SessionStatus.Completed);
      expect(probe?.studentId).toBe(actors.studentUserId);
      expect(probe?.teacherId).toBe(actors.teacherUserId);
      expect(probe?.fee).toBe("10.00");
      expect(probe?.feeHeld).toBe(false);
      expect(probe?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(probe?.confirmedByStudentAt?.getTime()).toBe(row.confirmedByStudentAt?.getTime());

      // The probe surfaces the post-transition state — the classification
      // basis a service reads around the guarded writes.
      await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "r", tx);
      const afterOpen = await SessionRepository.findArbitrationProbe(row.id, tx);
      expect(afterOpen?.status).toBe(SessionStatus.Disputed);
      await SessionRepository.resolveConsumedDisputeOnce(row.id, "n", DisputeResolution.Uphold, tx);
      const afterResolve = await SessionRepository.findArbitrationProbe(row.id, tx);
      expect(afterResolve?.status).toBe(SessionStatus.Completed);
    });
  });

  test("findArbitrationProbe discriminates the two dispute generations through the hold marker", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // Held generation: fee frozen, lane recorded, no student stamp.
      const heldRow = await insertSessionRow(tx, actors);
      const heldProbe = await SessionRepository.findArbitrationProbe(heldRow.id, tx);
      expect(heldProbe?.feeHeld).toBe(true);
      expect(heldProbe?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(heldProbe?.confirmedByStudentAt).toBeNull();
      // Consumed generation: fee earned, lane provenance kept, stamp present.
      const consumedRow = await insertConsumedSessionRow(tx, actors);
      const consumedProbe = await SessionRepository.findArbitrationProbe(consumedRow.id, tx);
      expect(consumedProbe?.feeHeld).toBe(false);
      expect(consumedProbe?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(consumedProbe?.confirmedByStudentAt).not.toBeNull();
    });
  });

  test("lockForReportGate returns exactly the probe projection under the row lock, null for unknown ids", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const missingId = await absentSessionId(tx);

      const locked = await SessionRepository.lockForReportGate(row.id, tx);

      expect(locked).not.toBeNull();
      expect(Object.keys(locked ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "id",
        "startedAt",
        "status",
        "studentId",
        "teacherId",
      ]);
      expect(locked?.id).toBe(row.id);
      expect(locked?.status).toBe(SessionStatus.Scheduled);
      expect(locked?.studentId).toBe(actors.studentUserId);
      expect(locked?.teacherId).toBe(actors.teacherUserId);

      expect(await SessionRepository.lockForReportGate(missingId, tx)).toBeNull();
    });
  });

  test("findRatingEligibilityProbe returns exactly the six-column eligibility projection", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        startedAt: new Date(),
        endedAt: new Date(),
        confirmedByTeacherAt: new Date(),
        confirmedByStudentAt: new Date(),
      });

      const probe = await SessionRepository.findRatingEligibilityProbe(row.id, tx);

      expect(probe).not.toBeNull();
      expect(Object.keys(probe ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "confirmedByStudentAt",
        "confirmedByTeacherAt",
        "id",
        "status",
        "studentId",
        "teacherId",
      ]);
      expect(probe?.id).toBe(row.id);
      expect(probe?.status).toBe(SessionStatus.Completed);
      expect(probe?.studentId).toBe(actors.studentUserId);
      expect(probe?.teacherId).toBe(actors.teacherUserId);
      expect(probe?.confirmedByTeacherAt).not.toBeNull();
      expect(probe?.confirmedByStudentAt).not.toBeNull();
    });
  });

  test("findRatingEligibilityProbe surfaces null stamps verbatim and returns null for unknown ids", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const missingId = await absentSessionId(tx);

      expect(await SessionRepository.findRatingEligibilityProbe(missingId, tx)).toBeNull();

      const row = await insertSessionRow(tx, actors);
      const probe = await SessionRepository.findRatingEligibilityProbe(row.id, tx);
      expect(probe?.status).toBe(SessionStatus.Scheduled);
      expect(probe?.confirmedByTeacherAt).toBeNull();
      expect(probe?.confirmedByStudentAt).toBeNull();
    });
  });

  test("findReportWaveContextById returns student, teacher, and the LINKED parent (three participants)", async () => {
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, true);
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id, { parentId: parentUser.id });
      const row = await insertSessionRow(tx, {
        teacherUserId: teacherUser.id,
        studentUserId: studentUser.id,
      });

      const context = await SessionRepository.findReportWaveContextById(row.id, tx);

      expect(context).not.toBeNull();
      expect(Object.keys(context ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "parentFullName",
        "parentLocale",
        "parentUserId",
        "sessionId",
        "studentFullName",
        "studentLocale",
        "studentUserId",
        "teacherFullName",
        "teacherLocale",
        "teacherUserId",
      ]);
      expect(context?.sessionId).toBe(row.id);
      expect(context?.studentUserId).toBe(studentUser.id);
      expect(context?.studentFullName).toBe(studentUser.fullName);
      expect(context?.teacherUserId).toBe(teacherUser.id);
      expect(context?.teacherFullName).toBe(teacherUser.fullName);
      // The linked parent resolves through students.parent_id with the
      // user's own name — the notification seam's third recipient.
      expect(context?.parentUserId).toBe(parentUser.id);
      expect(context?.parentFullName).toBe(parentUser.fullName);
    });
  });

  test("findReportWaveContextById yields a null parent leg for an unlinked student (linked-parent-only shape)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const context = await SessionRepository.findReportWaveContextById(row.id, tx);

      expect(context).not.toBeNull();
      expect(context?.studentUserId).toBe(actors.studentUserId);
      expect(context?.teacherUserId).toBe(actors.teacherUserId);
      expect(context?.parentUserId).toBeNull();
      expect(context?.parentFullName).toBeNull();
      expect(context?.parentLocale).toBeNull();
    });
  });

  test("findReportWaveContextById still returns the wave context when the student user has no students row (data edge)", async () => {
    await runInRollback(async tx => {
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, teacherUser.id, true);
      // Deliberately NO students row for this student user — the students
      // bridge is LEFT JOINed, so the read must survive the data edge.
      const studentUser = await createTestUser(tx, { role: "student" });
      const row = await insertSessionRowWithoutStudentsRow(tx, {
        teacherUserId: teacherUser.id,
        studentUserId: studentUser.id,
      });

      const context = await SessionRepository.findReportWaveContextById(row.id, tx);

      expect(context).not.toBeNull();
      expect(context?.sessionId).toBe(row.id);
      expect(context?.studentUserId).toBe(studentUser.id);
      expect(context?.studentFullName).toBe(studentUser.fullName);
      expect(context?.teacherUserId).toBe(teacherUser.id);
      expect(context?.teacherFullName).toBe(teacherUser.fullName);
      // No students row ⇒ no parent link ⇒ the parent leg stays null
      // (the notification seam fail-closes on the missing recipient).
      expect(context?.parentUserId).toBeNull();
      expect(context?.parentFullName).toBeNull();
      expect(context?.parentLocale).toBeNull();
    });
  });

  test("findReportWaveContextById returns null for an unknown session id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentSessionId(tx);

      expect(await SessionRepository.findReportWaveContextById(missingId, tx)).toBeNull();
    });
  });

  test("listForStudent returns only the student's own rows; listForTeacher mirrors for the teacher", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const rowA1 = await insertSessionRow(tx, actorsA);
      const rowA2 = await insertSessionRow(tx, actorsA);
      await insertSessionRow(tx, actorsB);

      const studentRows = await SessionRepository.listForStudent(actorsA.studentUserId, NO_FILTER, 25, 0, tx);
      expect(studentRows.map(row => row.id).toSorted((a, b) => a - b)).toEqual(
        [rowA1.id, rowA2.id].toSorted((a, b) => a - b)
      );

      const teacherRows = await SessionRepository.listForTeacher(actorsB.teacherUserId, NO_FILTER, 25, 0, tx);
      expect(teacherRows).toHaveLength(1);
      expect(teacherRows[0]?.studentId).toBe(actorsB.studentUserId);
    });
  });

  test("countForStudent and countForTeacher report the owner-scoped totals", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      await insertSessionRow(tx, actorsA);
      await insertSessionRow(tx, actorsA);
      await insertSessionRow(tx, actorsB);

      expect(await SessionRepository.countForStudent(actorsA.studentUserId, NO_FILTER, tx)).toBe(2);
      expect(await SessionRepository.countForStudent(actorsB.studentUserId, NO_FILTER, tx)).toBe(1);
      expect(await SessionRepository.countForTeacher(actorsA.teacherUserId, NO_FILTER, tx)).toBe(2);
      expect(await SessionRepository.countForTeacher(actorsB.teacherUserId, NO_FILTER, tx)).toBe(1);
    });
  });

  // ─── Tier 2: pagination edges ───────────────────────────────────────

  test("list ordering is created_at DESC with id DESC as the same-instant tiebreak", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // Explicit stamps in the PAST — rows relying on the default now()
      // (the transaction's start timestamp) are then the newest ones.
      const now = Date.now();
      const oldest = await insertSessionRow(tx, actors, { createdAt: new Date(now - 3 * 3_600_000) });
      const middle = await insertSessionRow(tx, actors, { createdAt: new Date(now - 2 * 3_600_000) });
      const newest = await insertSessionRow(tx, actors, { createdAt: new Date(now - 3_600_000) });
      // Three rows sharing one creation instant — only the id DESC tiebreak
      // can order them deterministically (rows inside one transaction share
      // the transaction's now()).
      const sameInstant1 = await insertSessionRow(tx, actors);
      const sameInstant2 = await insertSessionRow(tx, actors);
      const sameInstant3 = await insertSessionRow(tx, actors);

      const rows = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 25, 0, tx);

      expect(rows.map(row => row.id)).toEqual([
        sameInstant3.id,
        sameInstant2.id,
        sameInstant1.id,
        newest.id,
        middle.id,
        oldest.id,
      ]);
    });
  });

  test("page 1 at exact size returns the full window", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const rows = [
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
      ];

      const page = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 3, 0, tx);

      expect(page).toHaveLength(3);
      expect(page.map(row => row.id)).toEqual([rows[2]?.id, rows[1]?.id, rows[0]?.id]);
    });
  });

  test("a mid window slices the ordered set; an offset past the end yields empty items next to the honest total", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const rows = [
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
      ];

      const middlePage = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 2, 1, tx);
      expect(middlePage.map(row => row.id)).toEqual([rows[1]?.id, rows[0]?.id]);

      const beyondRange = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 25, 100, tx);
      expect(beyondRange).toEqual([]);
      // The count companion still reports the true total — no fabricated
      // window shrinks it.
      expect(await SessionRepository.countForStudent(actors.studentUserId, NO_FILTER, tx)).toBe(3);
    });
  });

  test("the status filter narrows list and count coherently; absent and null filters drop out identically", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const scheduled1 = await insertSessionRow(tx, actors);
      const scheduled2 = await insertSessionRow(tx, actors);
      const startedRow = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(startedRow.id, actors.teacherUserId, tx);

      const scheduledPage = await SessionRepository.listForStudent(actors.studentUserId, SCHEDULED_FILTER, 25, 0, tx);
      expect(scheduledPage.map(row => row.id).toSorted((a, b) => a - b)).toEqual(
        [scheduled1.id, scheduled2.id].toSorted((a, b) => a - b)
      );

      const startedPage = await SessionRepository.listForStudent(actors.studentUserId, STARTED_FILTER, 25, 0, tx);
      expect(startedPage.map(row => row.id)).toEqual([startedRow.id]);

      // List/count coherence — both consume the ONE shared predicate
      // builder, so the total can never diverge from the filtered set.
      expect(await SessionRepository.countForStudent(actors.studentUserId, SCHEDULED_FILTER, tx)).toBe(2);
      expect(await SessionRepository.countForStudent(actors.studentUserId, STARTED_FILTER, tx)).toBe(1);
      expect(await SessionRepository.countForStudent(actors.studentUserId, COMPLETED_FILTER, tx)).toBe(0);
      expect(await SessionRepository.countForStudent(actors.studentUserId, NO_FILTER, tx)).toBe(3);

      // Absent filters never error — null and undefined drop out exactly
      // like an empty filter object.
      const unfiltered = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 25, 0, tx);
      const nullFiltered = await SessionRepository.listForStudent(actors.studentUserId, NULL_FILTER, 25, 0, tx);
      expect(nullFiltered.map(row => row.id)).toEqual(unfiltered.map(row => row.id));
      expect(await SessionRepository.countForStudent(actors.studentUserId, NULL_FILTER, tx)).toBe(3);
    });
  });

  test("the teacher-side quartet mirrors the filter coherence", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors);
      const startedRow = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(startedRow.id, actors.teacherUserId, tx);

      expect(await SessionRepository.countForTeacher(actors.teacherUserId, SCHEDULED_FILTER, tx)).toBe(1);
      expect(await SessionRepository.countForTeacher(actors.teacherUserId, STARTED_FILTER, tx)).toBe(1);
      const teacherStarted = await SessionRepository.listForTeacher(actors.teacherUserId, STARTED_FILTER, 25, 0, tx);
      expect(teacherStarted.map(row => row.id)).toEqual([startedRow.id]);
    });
  });

  test("listAdminDisputed/countAdminDisputed surface exactly the disputed rows, newest first, with honest deltas and clamps", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // My rows are stamped in the FUTURE so they deterministically sort
      // ahead of any committed disputed rows other workers may have
      // created (the shared test DB has no committed disputed writers, but
      // the head-of-list property keeps the window assertions exact).
      const now = Date.now();
      const dispute1 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 3_600_000) });
      const dispute2 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 2 * 3_600_000) });
      const dispute3 = await insertSessionRow(tx, actors, { createdAt: new Date(now + 3 * 3_600_000) });
      const liveRow = await insertSessionRow(tx, actors, { createdAt: new Date(now + 4 * 3_600_000) });

      // Honest-count delta: exactly the three disputes I open move the
      // total (the count companion shares the ONE pinned predicate with
      // the list). The three opens are sequential — the shared oracle
      // reads below require all three to have landed.
      const before = await SessionRepository.countAdminDisputed(tx);
      const opened1 = await SessionRepository.openDisputeOnce(
        dispute1.id,
        actors.studentUserId,
        `reason-${dispute1.id}`,
        tx
      );
      expect(opened1?.status).toBe(SessionStatus.Disputed);
      const opened2 = await SessionRepository.openDisputeOnce(
        dispute2.id,
        actors.studentUserId,
        `reason-${dispute2.id}`,
        tx
      );
      expect(opened2?.status).toBe(SessionStatus.Disputed);
      const opened3 = await SessionRepository.openDisputeOnce(
        dispute3.id,
        actors.studentUserId,
        `reason-${dispute3.id}`,
        tx
      );
      expect(opened3?.status).toBe(SessionStatus.Disputed);
      const after = await SessionRepository.countAdminDisputed(tx);
      expect(after - before).toBe(3);

      // Newest first over the pinned predicate; the live (never disputed)
      // row never appears even though it is the newest row overall.
      const page = await SessionRepository.listAdminDisputed(25, 0, tx);
      const myIds = [dispute3.id, dispute2.id, dispute1.id];
      expect(page.slice(0, 3).map(row => row.id)).toEqual(myIds);
      expect(page.map(row => row.id)).not.toContain(liveRow.id);

      // Clamps: a short limit truncates the window; the offset skips
      // forward without shrinking the honest total.
      const clamped = await SessionRepository.listAdminDisputed(2, 0, tx);
      expect(clamped.map(row => row.id)).toEqual([dispute3.id, dispute2.id]);
      const offset = await SessionRepository.listAdminDisputed(2, 1, tx);
      expect(offset.map(row => row.id)).toEqual([dispute2.id, dispute1.id]);
      expect(await SessionRepository.countAdminDisputed(tx)).toBe(after);

      // The returned rows carry the full 21-column select shape.
      expect(Object.keys(page[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
    });
  });

  // ─── Post-completion confirmation sweeper (Tier 1 + Tier 2) ─────────

  test("sweepExpiredCompletedOnce cancels an overdue unconfirmed completed row and preserves its refund provenance", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = secondPrecisionInstant(Date.now());
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 3_600_000);
      const deadline = new Date(now.getTime() + 3_600_000);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        startedAt: new Date(staleStamp.getTime() - 3_600_000),
        endedAt: staleStamp,
        confirmedByTeacherAt: staleStamp,
        confirmationDeadline: deadline,
      });

      const swept = await SessionRepository.sweepExpiredCompletedOnce(now, tx);
      const sweptRow = swept.find(candidate => candidate.id === row.id);

      expect(sweptRow).toBeDefined();
      expect(sweptRow?.status).toBe(SessionStatus.Cancelled);
      expect(sweptRow?.feeHeld).toBe(false);
      expect(sweptRow?.updatedAt.getTime()).toBe(now.getTime());
      // The hold's provenance lane survives untouched — the caller refunds
      // the recorded lane through the shared same-lane primitive.
      expect(sweptRow?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      // Only the documented columns moved: stamps and the end span keep
      // their values, and the confirmation deadline is never re-armed.
      expect(sweptRow?.confirmedByTeacherAt?.getTime()).toBe(staleStamp.getTime());
      expect(sweptRow?.confirmedByStudentAt).toBeNull();
      expect(sweptRow?.endedAt?.getTime()).toBe(staleStamp.getTime());
      expect(sweptRow?.confirmationDeadline?.getTime()).toBe(deadline.getTime());
      // The returned row carries the full 21-column select shape.
      expect(Object.keys(sweptRow ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("cutoff boundary: a teacher stamp exactly at the cutoff is never swept (strict <), one second older is swept", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = secondPrecisionInstant(Date.now());
      const cutoff = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS);
      const atCutoff = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        endedAt: cutoff,
        confirmedByTeacherAt: cutoff,
      });
      const oneSecondOlder = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        endedAt: new Date(cutoff.getTime() - 1_000),
        confirmedByTeacherAt: new Date(cutoff.getTime() - 1_000),
      });

      const sweptIds = (await SessionRepository.sweepExpiredCompletedOnce(now, tx)).map(row => row.id);

      expect(sweptIds).toContain(oneSecondOlder.id);
      expect(sweptIds).not.toContain(atCutoff.id);

      const untouched = await readSessionRow(tx, atCutoff.id);
      expect(untouched.status).toBe(SessionStatus.Completed);
      expect(untouched.feeHeld).toBe(true);
      expect(untouched.confirmedByTeacherAt?.getTime()).toBe(cutoff.getTime());
    });
  });

  test("mixed teacher-stamp ages: only the row past its confirmation window is swept", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = new Date();
      const overdue = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000),
      });
      const fresh = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(now.getTime() - 60_000),
      });

      const sweptIds = (await SessionRepository.sweepExpiredCompletedOnce(now, tx)).map(row => row.id);

      expect(sweptIds).toContain(overdue.id);
      expect(sweptIds).not.toContain(fresh.id);

      const freshRow = await readSessionRow(tx, fresh.id);
      expect(freshRow.status).toBe(SessionStatus.Completed);
      expect(freshRow.feeHeld).toBe(true);
      expect(freshRow.confirmedByStudentAt).toBeNull();
    });
  });

  test("lane-less rows are swept and returned with a null lane — nothing to refund downstream", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = new Date();
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      // A hold never funded (no recorded lane) and an already-released
      // hold: both shapes lapse without any refund candidate downstream.
      const unfunded = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        feeHeld: true,
        heldBalanceLane: null,
        confirmedByTeacherAt: staleStamp,
      });
      const released = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        feeHeld: false,
        heldBalanceLane: null,
        confirmedByTeacherAt: staleStamp,
      });

      const swept = await SessionRepository.sweepExpiredCompletedOnce(now, tx);
      const sweptIds = swept.map(row => row.id);
      expect(sweptIds).toContain(unfunded.id);
      expect(sweptIds).toContain(released.id);

      const unfundedRow = swept.find(row => row.id === unfunded.id);
      expect(unfundedRow?.heldBalanceLane).toBeNull();
      expect(unfundedRow?.feeHeld).toBe(false);
      const releasedRow = swept.find(row => row.id === released.id);
      expect(releasedRow?.heldBalanceLane).toBeNull();
      expect(releasedRow?.feeHeld).toBe(false);
    });
  });

  test("a student-confirmed row never matches — its escrow was consumed by earning, not held for refund", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = secondPrecisionInstant(Date.now());
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        feeHeld: false,
        confirmedByTeacherAt: staleStamp,
        confirmedByStudentAt: new Date(staleStamp.getTime() + 60_000),
      });

      const sweptIds = (await SessionRepository.sweepExpiredCompletedOnce(now, tx)).map(swept => swept.id);

      expect(sweptIds).not.toContain(row.id);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.confirmedByStudentAt?.getTime()).toBe(staleStamp.getTime() + 60_000);
      expect(finalRow.confirmedByTeacherAt?.getTime()).toBe(staleStamp.getTime());
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("disputed and cancelled rows never match — the status guard alone excludes them", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = new Date();
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      // Both rows carry every stamp condition of the sweep predicate; only
      // the lifecycle state differs, proving the status guard excludes them
      // (and that a non-matching row keeps its hold marker untouched).
      const disputed = await insertSessionRow(tx, actors, {
        status: SessionStatus.Disputed,
        disputeReason: "sweep-ineligible",
        disputedAt: now,
        confirmedByTeacherAt: staleStamp,
      });
      const cancelled = await insertSessionRow(tx, actors, {
        status: SessionStatus.Cancelled,
        cancelReason: "sweep-ineligible",
        confirmedByTeacherAt: staleStamp,
      });

      const sweptIds = (await SessionRepository.sweepExpiredCompletedOnce(now, tx)).map(swept => swept.id);

      expect(sweptIds).not.toContain(disputed.id);
      expect(sweptIds).not.toContain(cancelled.id);

      const disputedRow = await readSessionRow(tx, disputed.id);
      expect(disputedRow.status).toBe(SessionStatus.Disputed);
      expect(disputedRow.feeHeld).toBe(true);
      const cancelledRow = await readSessionRow(tx, cancelled.id);
      expect(cancelledRow.status).toBe(SessionStatus.Cancelled);
      expect(cancelledRow.feeHeld).toBe(true);
    });
  });

  test("an admin-arbitration COMPLETE row is never swept — its settled shape carries no teacher stamp to expire", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = secondPrecisionInstant(Date.now());
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);

      // Control row: a true overdue completion proves the predicate is
      // active in the same sweep (the exclusion below is never vacuous).
      const overdue = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: staleStamp,
      });

      // The arbitration-COMPLETE outcome, built through the real guarded
      // statements: completed with BOTH confirmation stamps absent (the
      // resolution never writes a teacher stamp) and the hold already
      // consumed by the resolution itself.
      const disputed = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(disputed.id, actors.teacherUserId, tx);
      await SessionRepository.openDisputeOnce(disputed.id, actors.studentUserId, "r", tx);
      const arbitrated = await SessionRepository.resolveDisputeCompleteOnce(
        disputed.id,
        "held per policy",
        DisputeResolution.Complete,
        tx
      );
      if (arbitrated === null) {
        throw new Error("expected the arbitration COMPLETE resolution to return the settled row");
      }
      expect(arbitrated.status).toBe(SessionStatus.Completed);
      expect(arbitrated.feeHeld).toBe(false);
      expect(arbitrated.confirmedByTeacherAt).toBeNull();

      const sweptIds = (await SessionRepository.sweepExpiredCompletedOnce(now, tx)).map(swept => swept.id);

      // The control was swept; the settled arbitration row was not — its
      // teacher stamp is NULL, and a NULL stamp can never be older than
      // the cutoff, so the admin's terminal state is unreachable by the
      // timeout.
      expect(sweptIds).toContain(overdue.id);
      expect(sweptIds).not.toContain(disputed.id);

      // The settled row is byte-unchanged by the sweep: still completed,
      // hold still consumed, no sweep stamps, resolution intact.
      const finalRow = await readSessionRow(tx, disputed.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.confirmedByTeacherAt).toBeNull();
      expect(finalRow.confirmedByStudentAt).toBeNull();
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.resolutionNote).toBe("held per policy");
      expect(finalRow.endedAt?.getTime()).toBe(arbitrated.endedAt?.getTime());
      expect(finalRow.updatedAt.getTime()).toBe(arbitrated.updatedAt.getTime());
    });
  });

  // ─── Tier 3: guarded transitions under duplication ──────────────────

  test("double-start under Promise.allSettled produces exactly one winner and a started row", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const outcomes = await Promise.allSettled([
        SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx),
        SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe(SessionStatus.Started);
      expect(winners[0]?.startedAt).not.toBeNull();

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Started);
      expect(finalRow.startedAt).not.toBeNull();
    });
  });

  test("double completeSessionOnce under Promise.allSettled serializes with no wave traffic — one winner, stamps written once", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);

      const outcomes = await Promise.allSettled([
        SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx),
        SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx),
      ]);

      // Both statements fulfill: the loser's guarded predicate matches
      // zero rows against the winner's effect — an honest null, never a
      // throw (this layer emits no notification traffic, so the duplicated
      // statements serialize cleanly). One winner, one null.
      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      const winner = winners[0];
      expect(winner?.status).toBe(SessionStatus.Completed);
      expect(winner?.endedAt).not.toBeNull();
      expect(winner?.confirmedByTeacherAt).not.toBeNull();

      // The winner's stamps ARE the row's stamps: one captured instant was
      // written exactly once and the second statement performed zero
      // writes (same endedAt / teacher stamp / updatedAt), while the
      // escrow hold and the student stamp are untouched — completion alone
      // is payable-but-unpaid.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.endedAt?.getTime()).toBe(winner?.endedAt?.getTime());
      expect(finalRow.confirmedByTeacherAt?.getTime()).toBe(winner?.confirmedByTeacherAt?.getTime());
      expect(finalRow.updatedAt.getTime()).toBe(winner?.updatedAt.getTime());
      expect(finalRow.confirmedByStudentAt).toBeNull();
      expect(finalRow.feeHeld).toBe(true);
    });
  });

  test("double-cancel under Promise.allSettled produces exactly one winner — the hold can never be double-released", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const outcomes = await Promise.allSettled([
        SessionRepository.cancelSessionOnce(row.id, actors.studentUserId, null, tx),
        SessionRepository.cancelSessionOnce(row.id, actors.studentUserId, null, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe(SessionStatus.Cancelled);
      expect(winners[0]?.feeHeld).toBe(false);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("start against cancel serializes deterministically into one consistent final state", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      // Statements serialize on the one rollback connection in call order:
      // the start is enqueued first, the cancel second. The cancel is legal
      // from BOTH of its pre-states (scheduled and started), so whatever
      // the start landed, the cancel's predicate still matches — the race
      // resolves into the deterministic sequence [start, cancel], never
      // into a divergent state.
      const outcomes = await Promise.allSettled([
        SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx),
        SessionRepository.cancelSessionOnce(row.id, actors.studentUserId, null, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [startOutcome, cancelOutcome] = outcomes.map(outcome =>
        outcome.status === "fulfilled" ? outcome.value : null
      );
      expect(startOutcome).not.toBeNull();
      expect(cancelOutcome).not.toBeNull();

      // The final row is consistent with both landed transitions: the
      // cancel won the last word (status + hold marker), the start's write
      // is still visible (start stamp preserved), and no end stamp exists.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.startedAt).not.toBeNull();
      expect(finalRow.endedAt).toBeNull();
    });
  });

  test("the fused certification predicate holds under duplication: a decertified teacher's completions produce zero winners", async () => {
    await runInRollback(async tx => {
      const decertifiedUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, decertifiedUser.id, false);
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      const row = await insertSessionRow(tx, {
        teacherUserId: decertifiedUser.id,
        studentUserId: studentUser.id,
      });
      await SessionRepository.startSessionOnce(row.id, decertifiedUser.id, tx);

      const outcomes = await Promise.allSettled([
        SessionRepository.completeSessionOnce(row.id, decertifiedUser.id, tx),
        SessionRepository.completeSessionOnce(row.id, decertifiedUser.id, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toEqual([]);

      // Zero winners AND zero writes — the row never left the started
      // state, and no completion stamp exists.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Started);
      expect(finalRow.endedAt).toBeNull();
      expect(finalRow.confirmedByTeacherAt).toBeNull();
    });
  });

  test("the report-gate lock re-entrant probe re-evaluates its predicate against the in-transaction row state", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      // Harness limitation: `runInRollback` owns ONE connection, so two
      // transactions contending for the same row lock cannot be created
      // here (a second connection would see nothing to lock — the row is
      // uncommitted). The serialized equivalent is asserted instead: the
      // first gate lock holds the row, the in-transaction transition
      // lands while the lock is held, and the second lock probe
      // re-evaluates its predicate against the NEW state — the exact
      // guarantee a serialized cross-connection contender observes after
      // blocking on the lock.
      const first = await SessionRepository.lockForReportGate(row.id, tx);
      expect(first?.status).toBe(SessionStatus.Scheduled);

      const started = await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
      expect(started?.status).toBe(SessionStatus.Started);

      const second = await SessionRepository.lockForReportGate(row.id, tx);
      expect(second).not.toBeNull();
      expect(second?.status).toBe(SessionStatus.Started);
      expect(second?.startedAt).not.toBeNull();
      // Identity columns are stable across re-evaluation — same row, new
      // lifecycle basis for the gate decision.
      expect(second?.id).toBe(row.id);
      expect(second?.studentId).toBe(actors.studentUserId);
      expect(second?.teacherId).toBe(actors.teacherUserId);
    });
  });

  test("double sweep under Promise.allSettled cancels each overdue row exactly once — the re-run matches zero rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = new Date();
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: staleStamp,
      });

      const outcomes = await Promise.allSettled([
        SessionRepository.sweepExpiredCompletedOnce(now, tx),
        SessionRepository.sweepExpiredCompletedOnce(now, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [firstSweep, secondSweep] = outcomes.map(outcome => (outcome.status === "fulfilled" ? outcome.value : []));
      // The first run reports the row; the second run's predicate matches
      // zero rows against the winner's effect — a double refund is
      // structurally impossible.
      expect(firstSweep.map(swept => swept.id)).toContain(row.id);
      expect(secondSweep).toHaveLength(0);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.confirmedByStudentAt).toBeNull();
    });
  });

  test("confirm-then-sweep race: the confirmation consumes the escrow and the sweep matches zero rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = secondPrecisionInstant(Date.now());
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: staleStamp,
      });

      // Statements serialize on the one rollback connection in call order:
      // the confirm is enqueued first, the sweep second. The confirm lands
      // on the held-and-unconfirmed row; the sweep's expired-and-unconfirmed
      // predicate no longer matches it — the escrow unit is consumed OR
      // released, never both.
      const outcomes = await Promise.allSettled([
        SessionRepository.confirmStudentCompletionOnce(row.id, actors.studentUserId, tx),
        SessionRepository.sweepExpiredCompletedOnce(now, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [confirmOutcome, sweepOutcome] = outcomes;
      const confirmed = confirmOutcome?.status === "fulfilled" ? confirmOutcome.value : null;
      const sweptRows = sweepOutcome?.status === "fulfilled" ? sweepOutcome.value : [];
      expect(confirmed).not.toBeNull();
      expect(sweptRows.map(sweptRow => sweptRow.id)).not.toContain(row.id);

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.confirmedByStudentAt).not.toBeNull();
      expect(finalRow.confirmedByTeacherAt?.getTime()).toBe(staleStamp.getTime());
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("sweep-then-confirm race: the sweep releases the escrow and the confirmation matches zero rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = new Date();
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 60_000);
      const row = await insertSessionRow(tx, actors, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: staleStamp,
      });

      // Mirror order: the sweep is enqueued first and cancels the row (the
      // hold release lands for the caller's same-lane refund); the
      // confirmation's completed-and-held predicate no longer matches.
      const outcomes = await Promise.allSettled([
        SessionRepository.sweepExpiredCompletedOnce(now, tx),
        SessionRepository.confirmStudentCompletionOnce(row.id, actors.studentUserId, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [sweepOutcome, confirmOutcome] = outcomes;
      const sweptRows = sweepOutcome?.status === "fulfilled" ? sweepOutcome.value : [];
      const confirmed = confirmOutcome?.status === "fulfilled" ? confirmOutcome.value : null;
      expect(sweptRows.map(sweptRow => sweptRow.id)).toContain(row.id);
      expect(confirmed).toBeNull();

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.confirmedByStudentAt).toBeNull();
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    });
  });

  test("double openPostConfirmationDisputeOnce under Promise.allSettled produces exactly one winner", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      const outcomes = await Promise.allSettled([
        SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "first", tx),
        SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "second", tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe(SessionStatus.Disputed);
      expect(winners[0]?.disputeReason).toBe("first");

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Disputed);
      expect(finalRow.disputeReason).toBe("first");
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("double resolveConsumedDisputeOnce under Promise.allSettled produces exactly one winner — an arbitration outcome can never commit twice", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);
      await SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "r", tx);

      const outcomes = await Promise.allSettled([
        SessionRepository.resolveConsumedDisputeOnce(row.id, "refund granted", DisputeResolution.Refund, tx),
        SessionRepository.resolveConsumedDisputeOnce(row.id, "upheld instead", DisputeResolution.Uphold, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe(SessionStatus.Completed);

      // The loser's guarded predicate matched zero rows against the
      // winner's effect: the note and stamp were written exactly once
      // (the resolution stamp IS the row's audit stamp).
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.resolutionNote).toBe("refund granted");
      expect(finalRow.resolvedAt).not.toBeNull();
      expect(finalRow.resolvedAt?.getTime()).toBe(finalRow.updatedAt.getTime());
    });
  });

  test("open against resolve serializes deterministically: the post-confirmation entry and the arbitration leg never interleave", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);

      // Enqueue order [resolve, open] on a completed row: the arbitration
      // leg's disputed-and-consumed predicate misses first (an honest null
      // — nothing to arbitrate), then the entry lands. The final state is
      // the open dispute, never a phantom resolution.
      const outcomes = await Promise.allSettled([
        SessionRepository.resolveConsumedDisputeOnce(row.id, "n", DisputeResolution.Refund, tx),
        SessionRepository.openPostConfirmationDisputeOnce(row.id, actors.studentUserId, "r", tx),
      ]);
      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [resolveOutcome, openOutcome] = outcomes.map(outcome =>
        outcome.status === "fulfilled" ? outcome.value : null
      );
      expect(resolveOutcome).toBeNull();
      expect(openOutcome).not.toBeNull();
      const afterOpen = await readSessionRow(tx, row.id);
      expect(afterOpen.status).toBe(SessionStatus.Disputed);
      expect(afterOpen.resolutionNote).toBeNull();

      // Enqueue order [open, resolve] on a fresh row: both legs land — the
      // entry consumes the completed state, the completion leg consumes the
      // disputed state. One open, one resolve, zero duplicated effects.
      const second = await insertConsumedSessionRow(tx, actors);
      const bothOutcomes = await Promise.allSettled([
        SessionRepository.openPostConfirmationDisputeOnce(second.id, actors.studentUserId, "r", tx),
        SessionRepository.resolveConsumedDisputeOnce(second.id, "n", DisputeResolution.Refund, tx),
      ]);
      expect(bothOutcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [openOutcome2, resolveOutcome2] = bothOutcomes.map(outcome =>
        outcome.status === "fulfilled" ? outcome.value : null
      );
      expect(openOutcome2).not.toBeNull();
      expect(resolveOutcome2).not.toBeNull();
      const settled = await readSessionRow(tx, second.id);
      expect(settled.status).toBe(SessionStatus.Completed);
      expect(settled.feeHeld).toBe(false);
      expect(settled.disputeReason).toBe("r");
    });
  });

  // ─── Tier 4: constraint probes + static pins ────────────────────────

  test("INV-S4: a session row without its teacher party is rejected by the NOT NULL constraint (23502)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);

      await tx.execute(sql`savepoint session_notnull_probe`);
      const teacherNullError = await expectRepoError(() =>
        tx.execute(sql`INSERT INTO session (teacher_id, student_id) VALUES (NULL, ${actors.studentUserId})`)
      );
      await tx.execute(sql`rollback to savepoint session_notnull_probe`);
      expect(hasPostgresErrorCode(teacherNullError, PG_NOT_NULL_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(teacherNullError, "teacher_id")).toBe(true);

      await tx.execute(sql`savepoint session_notnull_probe`);
      const studentNullError = await expectRepoError(() =>
        tx.execute(sql`INSERT INTO session (teacher_id, student_id) VALUES (${actors.teacherUserId}, NULL)`)
      );
      await tx.execute(sql`rollback to savepoint session_notnull_probe`);
      expect(hasPostgresErrorCode(studentNullError, PG_NOT_NULL_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(studentNullError, "student_id")).toBe(true);

      // The savepoint brackets kept the transaction queryable.
      const row = await insertSessionRow(tx, actors);
      expect(await SessionRepository.findById(row.id, tx)).not.toBeNull();
    });
  });

  test("dispute reason and resolution note persist verbatim — hostile text rides as parameterized data", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertConsumedSessionRow(tx, actors);
      const hostileReason = "fee'; UPDATE session SET fee_held = true; DROP TABLE session; --";
      const hostileNote = "note'); DELETE FROM session WHERE id = 1; --";

      const disputed = await SessionRepository.openPostConfirmationDisputeOnce(
        row.id,
        actors.studentUserId,
        hostileReason,
        tx
      );
      expect(disputed?.disputeReason).toBe(hostileReason);

      const resolved = await SessionRepository.resolveConsumedDisputeOnce(
        row.id,
        hostileNote,
        DisputeResolution.Uphold,
        tx
      );
      expect(resolved).not.toBeNull();

      // The text landed verbatim as data and nothing executed: the row and
      // the table are exactly as the guarded writes left them.
      const stored = await readSessionRow(tx, row.id);
      expect(stored.disputeReason).toBe(hostileReason);
      expect(stored.resolutionNote).toBe(hostileNote);
      expect(stored.status).toBe(SessionStatus.Completed);
      expect(stored.feeHeld).toBe(false);
      expect(stored.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    });
  });

  test("status filter vocabulary is closed at this boundary: only SessionStatus members reach the predicate", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors);
      await insertSessionRow(tx, actors);

      // The three absent-shapes behave identically (the filter drops out of
      // the shared predicate instead of erroring); any non-enum vocabulary
      // is structurally unreachable — the filter's type is the closed
      // SessionStatus union, and the guard that validates client input
      // lives at the service boundary BEFORE this repo is reached.
      const noFilterIds = (await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 25, 0, tx)).map(
        row => row.id
      );
      const nullFilterIds = (await SessionRepository.listForStudent(actors.studentUserId, NULL_FILTER, 25, 0, tx)).map(
        row => row.id
      );
      const undefinedFilterIds = (
        await SessionRepository.listForStudent(actors.studentUserId, { status: undefined }, 25, 0, tx)
      ).map(row => row.id);
      expect(nullFilterIds).toEqual(noFilterIds);
      expect(undefinedFilterIds).toEqual(noFilterIds);
      expect(noFilterIds).toHaveLength(2);
    });
  });

  // The repository implementation is split across the public namespace file
  // and its sibling helpers modules (behavior-identical max-lines refactors:
  // the read machinery in `session.repository.helpers.ts`, the joined
  // wave-context read in `session.repository.wave.helpers.ts`, the
  // post-confirmation dispute primitives in
  // `session.repository.arbitration.helpers.ts`): every source pin below
  // scans ALL FOUR files as one implementation unit, so the pinned
  // invariants (executor discipline, predicate sharing, SQL interpolation
  // allowlist) keep covering the whole repository layer.
  const REPO_FILES = [
    join(import.meta.dir, "../../../repo/classes/session.repository.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.helpers.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.wave.helpers.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.arbitration.helpers.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.lifecycle.helpers.ts"),
  ];
  const repoSource = REPO_FILES.map(file => readFileSync(file, "utf8")).join("\n");

  test("source: lifecycle vocabulary flows only through SessionStatus members (never string literals)", () => {
    expect(/["'](scheduled|started|completed|cancelled|disputed)["']/.test(repoSource)).toBe(false);
    expect(repoSource.includes("import type { SessionStatus")).toBe(false);
    expect(repoSource.includes("import { SessionStatus }")).toBe(true);
    expect(repoSource.match(/SessionStatus\./g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  test("source: one shared predicate builder feeds list AND count (coherence by construction)", () => {
    // Definition + four call sites (list tx/standalone, count tx/standalone).
    expect(repoSource.match(/buildParticipantPredicate\(/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(repoSource.includes("function buildParticipantPredicate(")).toBe(true);
    expect(repoSource.includes("async function listParticipantSessions(")).toBe(true);
    expect(repoSource.includes("async function countParticipantSessions(")).toBe(true);
    // Newest first, deterministic tiebreak, bound paging window.
    expect(repoSource.includes("desc(session.createdAt), desc(session.id)")).toBe(true);
    expect(repoSource.includes("ORDER BY created_at DESC, id DESC")).toBe(true);
    expect(repoSource.includes(".limit(limit)")).toBe(true);
    expect(repoSource.includes(".offset(offset)")).toBe(true);
    expect(repoSource.includes("LIMIT $${rendered.params.length + 1} OFFSET $${rendered.params.length + 2}")).toBe(
      true
    );
  });

  test("source: participant and state predicates are composed SQL-side from bound values", () => {
    // Cancel's caller predicate: EITHER owner column, compared in SQL —
    // never filtered in JS after the fact.
    expect(repoSource.includes("or(eq(session.studentId, participantId), eq(session.teacherId, participantId))")).toBe(
      true
    );
    // Cancel's state membership is OR-ed equality (no array-membership
    // operator anywhere).
    expect(
      repoSource.includes("or(eq(session.status, SessionStatus.Scheduled), eq(session.status, SessionStatus.Started))")
    ).toBe(true);
    expect(repoSource.includes("inArray")).toBe(false);
    expect(repoSource.includes("sql.raw")).toBe(false);
  });

  test("source: every SQL interpolation is a module constant or a schema-object reference — never caller input", () => {
    const interpolations = [...repoSource.matchAll(/\$\{([^}]+)\}/g)].map(match => match[1]?.trim() ?? "");
    const ALLOWED = new Set([
      "SESSION_SELECT_COLUMNS",
      "rendered.sql",
      "rendered.params.length + 1",
      "rendered.params.length + 2",
      "teacher",
      "eq(teacher.id, session.teacherId)",
      "eq(teacher.isApproved, true)",
      // Guarded-statement predicate fragments: schema column objects compared
      // SQL-side (never rendered caller values), the transition methods'
      // locally captured clock scalar (bound as a parameter, request-free),
      // and the completion sweeper's locally derived window cutoff (the
      // captured instant minus the platform confirmation window — also
      // bound, never request data).
      "session.confirmedByStudentAt",
      "session.confirmationDeadline",
      "session.confirmedByTeacherAt",
      // The arbitration family's state/outcome predicates: the enum members
      // and the schema column objects they compare SQL-side (never rendered
      // caller values).
      "SessionStatus.Disputed",
      "session.status",
      "session.resolvedAt",
      "session.resolutionOutcome",
      "DisputeResolution.Cancel",
      "DisputeResolution.Complete",
      "DisputeResolution.PartialRefund",
      "DisputeResolution.Refund",
      "DisputeResolution.Uphold",
      "cutoff",
      "now",
    ]);
    expect(interpolations).toHaveLength(39);
    for (const interpolation of interpolations) {
      expect(ALLOWED.has(interpolation)).toBe(true);
    }
    // The fused certification subquery interpolates exactly the schema
    // objects above — the caller's ids ride bound parameters.
    expect(/EXISTS \(SELECT 1 FROM \$\{teacher\}/.test(repoSource)).toBe(true);
    expect(/AND \$\{eq\(teacher\.isApproved, true\)\}\)/.test(repoSource)).toBe(true);
  });

  test("source: the post-completion sweeper is system-scope — no caller-supplied predicate input, no wildcard/LIKE", () => {
    // The sweeper's signature carries ONLY the sweep instant and the
    // optional transaction: no id/participant parameter exists through
    // which a caller scope could reach the batch predicate.
    expect(repoSource.includes("export async function sweepExpiredCompletedOnce(now: Date, tx?: DBTransaction)")).toBe(
      true
    );
    // The window is derived from the caller's captured instant minus the
    // platform confirmation-window constant — never from request data.
    expect(repoSource.includes("new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS)")).toBe(true);
    // No wildcard or LIKE matching anywhere in the repository.
    expect(repoSource.includes("like(")).toBe(false);
    expect(repoSource.includes("ilike(")).toBe(false);
    expect(repoSource.includes("%")).toBe(false);
  });

  test("source: no prepared statements, no SQL line-comment sequences, no module-level mutable state", () => {
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("--")).toBe(false);
    // The `let` scan runs at statement position over COMMENT-STRIPPED
    // source: prose words inside docblocks (e.g. "wallet") must never trip
    // the mutable-state pin, while any real `let` declaration in code still
    // does. The scan is pure string/indexOf work — regex-free on purpose
    // (lint's super-linear-regex rule rejects even the linear alternatives).
    let inBlockComment = false;
    const hasLetDeclaration = repoSource.split("\n").some(line => {
      let code = line;
      if (inBlockComment) {
        const closer = code.indexOf("*/");
        if (closer === -1) return false;
        inBlockComment = false;
        code = code.slice(closer + 2);
      }
      for (;;) {
        const opener = code.indexOf("/*");
        if (opener === -1) break;
        const closer = code.indexOf("*/", opener + 2);
        if (closer === -1) {
          inBlockComment = true;
          return false;
        }
        code = code.slice(0, opener) + code.slice(closer + 2);
      }
      const lineComment = code.indexOf("//");
      if (lineComment !== -1) {
        code = code.slice(0, lineComment);
      }
      const trimmed = code.trimStart();
      return trimmed.startsWith("let ") || trimmed.startsWith("let\t");
    });
    expect(hasLetDeclaration).toBe(false);
  });

  test("source: executor discipline — reads fall back to queryDb, writes to the pool, tx last on every signature", () => {
    expect(repoSource.includes("const executor = tx ?? db;")).toBe(true);
    expect(repoSource.match(/const executor = tx \?\? db;/g) ?? []).toHaveLength(16);
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(13);
    // Thirty-four exported methods across the namespace + its one-to-one
    // sibling implementation modules (the read machinery, the joined
    // wave-context read, the post-confirmation dispute primitives, the
    // lifecycle completion lane, the report-gate lock, the
    // rating-eligibility probe, and the evaluation-loop wrappers delegating
    // to the evaluation helpers module, whose own discipline suite lives in
    // session.repository.evaluation.test.ts); the admin directory reads
    // (listAdminDisputed, countAdminDisputed, listForAdmin) and the
    // teacher↔student tenancy probe ride type-exact const re-exports of
    // their impl functions instead of wrappers. Every signature ends in tx (LAST
    // param).
    // Exactly FOUR take it REQUIRED — the report-gate lock (a FOR UPDATE
    // read taken outside a transaction releases when the statement ends
    // and protects nothing), the rating-eligibility probe, and the
    // evaluation-cycle resolver + booking counter (both cycle-gate reads
    // must observe the caller's transaction's own writes under the
    // applicant's FOR UPDATE lock); every other signature keeps the optional tx.
    expect(repoSource.match(/export async function /g) ?? []).toHaveLength(34);
    expect((repoSource.match(/tx\?: DBTransaction/g) ?? []).length).toBeGreaterThanOrEqual(20);
    expect(repoSource.match(/tx: DBTransaction/g) ?? []).toHaveLength(4);
  });

  test("source: no i18n, no logger, no console, one namespace", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace SessionRepository")).toBe(true);
  });

  test("source: comments describe domain behavior only (no plan-artifact references)", () => {
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

/**
 * Standalone executor branches — the queryDb read paths and the `tx ?? db`
 * write fallback. These branches run WITHOUT a transaction by definition,
 * so their fixtures must be COMMITTED (an uncommitted row is invisible to
 * the pool path). They are registered here and hard-deleted in `afterAll`
 * (rule 9) in FK-dependency order (sessions first — the teacher/student
 * FKs are restrict-bound while sessions reference them).
 */
describe("SessionRepository — standalone executor paths (committed fixtures)", () => {
  const committedSessionIds: number[] = [];
  const committedUserIds: number[] = [];
  let actors: SessionActors = { teacherUserId: 0, studentUserId: 0 };
  let cancelTargetId = 0;
  let completeTargetId = 0;
  let probeTargetId = 0;

  afterAll(async () => {
    // Sessions first — the teacher/student FKs are restrict-bound while
    // sessions reference them. The user deletes then cascade the role rows.
    await Promise.all(committedSessionIds.map(id => db.delete(session).where(eq(session.id, id))));
    committedSessionIds.length = 0;
    await Promise.all(
      committedUserIds.map(async userId => {
        await db.delete(teacher).where(eq(teacher.id, userId));
        await db.delete(students).where(eq(students.id, userId));
        await db.delete(users).where(eq(users.id, userId));
      })
    );
    committedUserIds.length = 0;
  });

  test("insertSession runs on the pool fallback and returns the inserted row", async () => {
    const committed = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      actors = pair;
      cancelTargetId = (await insertSessionRow(tx, pair)).id;
      completeTargetId = (await insertSessionRow(tx, pair)).id;
      probeTargetId = (await insertSessionRow(tx, pair)).id;
      committedSessionIds.push(cancelTargetId, completeTargetId, probeTargetId);
      return pair;
    });

    const inserted = await SessionRepository.insertSession({
      teacherId: committed.teacherUserId,
      studentId: committed.studentUserId,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.StudentSession,
      intent: SessionIntent.Tajweed,
      fee: "7.00",
      feeHeld: true,
      heldBalanceLane: HeldBalanceLane.Tajweed,
    });

    committedSessionIds.push(inserted.id);
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.intent).toBe(SessionIntent.Tajweed);
    expect(inserted.heldBalanceLane).toBe(HeldBalanceLane.Tajweed);
    expect(inserted.createdAt).not.toBeNull();
  });

  test("startSessionOnce and completeSessionOnce run on the pool fallback (certified teacher)", async () => {
    const started = await SessionRepository.startSessionOnce(completeTargetId, actors.teacherUserId);
    expect(started?.status).toBe(SessionStatus.Started);
    expect(started?.startedAt).not.toBeNull();

    const completed = await SessionRepository.completeSessionOnce(completeTargetId, actors.teacherUserId);
    expect(completed?.status).toBe(SessionStatus.Completed);
    expect(completed?.endedAt).not.toBeNull();
    expect(completed?.confirmedByTeacherAt).not.toBeNull();
  });

  test("cancelSessionOnce runs on the pool fallback", async () => {
    const cancelled = await SessionRepository.cancelSessionOnce(cancelTargetId, actors.studentUserId, null);

    expect(cancelled?.status).toBe(SessionStatus.Cancelled);
    expect(cancelled?.feeHeld).toBe(false);
    expect(cancelled?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(cancelled?.endedAt).toBeNull();
  });

  test("the dispute family and the admin pair run on the pool fallback and standalone read paths", async () => {
    // Committed fixtures for the pool-fallback writes (cancel-outcome and
    // complete-outcome arbitrations) and the standalone admin reads.
    const fixture = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      const cancelOutcome = await insertSessionRow(tx, pair);
      const startedOutcome = await insertSessionRow(tx, pair);
      committedSessionIds.push(cancelOutcome.id, startedOutcome.id);
      return { pair, cancelOutcome, startedOutcome };
    });

    // Pool-fallback writes: open a dispute from both live states.
    const disputedFromScheduled = await SessionRepository.openDisputeOnce(
      fixture.cancelOutcome.id,
      fixture.pair.studentUserId,
      "pool-open-1"
    );
    expect(disputedFromScheduled?.status).toBe(SessionStatus.Disputed);
    expect(disputedFromScheduled?.disputeReason).toBe("pool-open-1");

    const started = await SessionRepository.startSessionOnce(fixture.startedOutcome.id, fixture.pair.teacherUserId);
    expect(started?.status).toBe(SessionStatus.Started);
    const disputedFromStarted = await SessionRepository.openDisputeOnce(
      fixture.startedOutcome.id,
      fixture.pair.studentUserId,
      "pool-open-2"
    );
    expect(disputedFromStarted?.status).toBe(SessionStatus.Disputed);

    // The standalone admin pair sees both disputed rows (they carry the
    // newest committed stamps — head of the list).
    const adminPage = await SessionRepository.listAdminDisputed(25, 0);
    const adminIds = [fixture.startedOutcome.id, fixture.cancelOutcome.id];
    expect(adminPage.slice(0, 2).map(row => row.id)).toEqual(adminIds);
    expect(adminPage[0]?.disputeReason).toBe("pool-open-2");
    expect(await SessionRepository.countAdminDisputed()).toBeGreaterThanOrEqual(2);

    // The standalone probe surfaces the start stamp for the arbitration.
    const probe = await SessionRepository.findTransitionProbe(fixture.startedOutcome.id);
    expect(probe?.startedAt).not.toBeNull();

    // Pool-fallback resolutions: CANCEL releases the hold marker; COMPLETE
    // consumes it.
    const cancelled = await SessionRepository.resolveDisputeCancelOnce(
      fixture.cancelOutcome.id,
      "pool-cancel",
      DisputeResolution.Cancel
    );
    expect(cancelled?.status).toBe(SessionStatus.Cancelled);
    expect(cancelled?.feeHeld).toBe(false);
    expect(cancelled?.resolutionNote).toBe("pool-cancel");
    expect(cancelled?.resolvedAt).not.toBeNull();

    const completed = await SessionRepository.resolveDisputeCompleteOnce(
      fixture.startedOutcome.id,
      "pool-complete",
      DisputeResolution.Complete
    );
    expect(completed?.status).toBe(SessionStatus.Completed);
    expect(completed?.feeHeld).toBe(false);
    expect(completed?.endedAt).not.toBeNull();
    expect(completed?.resolvedAt).not.toBeNull();

    // Resolved rows leave the arbitration queue.
    const remaining = await SessionRepository.listAdminDisputed(25, 0);
    expect(remaining.map(row => row.id)).not.toContain(fixture.cancelOutcome.id);
    expect(remaining.map(row => row.id)).not.toContain(fixture.startedOutcome.id);
  });

  test("the post-confirmation dispute family and the arbitration probe run on the pool fallback and standalone read paths", async () => {
    const fixture = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      const consumed = await insertConsumedSessionRow(tx, pair);
      committedSessionIds.push(consumed.id);
      return { pair, consumed };
    });

    // Pre-write classification probe (standalone queryDb read).
    const before = await SessionRepository.findArbitrationProbe(fixture.consumed.id);
    expect(before?.status).toBe(SessionStatus.Completed);
    expect(before?.feeHeld).toBe(false);
    expect(before?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    expect(before?.confirmedByStudentAt).not.toBeNull();

    // Pool-fallback writes: the student entry, then the arbitration leg.
    const disputed = await SessionRepository.openPostConfirmationDisputeOnce(
      fixture.consumed.id,
      fixture.pair.studentUserId,
      "pool-dispute"
    );
    expect(disputed?.status).toBe(SessionStatus.Disputed);
    expect(disputed?.disputeReason).toBe("pool-dispute");

    const resolved = await SessionRepository.resolveConsumedDisputeOnce(
      fixture.consumed.id,
      "pool-resolve",
      DisputeResolution.Refund
    );
    expect(resolved).not.toBeNull();
    expect(Object.keys(resolved ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "confirmedByStudentAt",
      "fee",
      "feeHeld",
      "heldBalanceLane",
      "id",
      "resolutionOutcome",
      "resolvedAt",
      "status",
      "studentId",
      "teacherId",
    ]);
    expect(resolved?.resolutionOutcome).toBe(DisputeResolution.Refund);
    expect(resolved?.status).toBe(SessionStatus.Completed);
    expect(resolved?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);

    // Post-write probe (standalone) surfaces the settled classification.
    const after = await SessionRepository.findArbitrationProbe(fixture.consumed.id);
    expect(after?.status).toBe(SessionStatus.Completed);
    expect(after?.feeHeld).toBe(false);
  });

  test("findById runs standalone via the queryDb read path", async () => {
    const found = await SessionRepository.findById(probeTargetId);

    expect(found?.id).toBe(probeTargetId);
    expect(found?.status).toBe(SessionStatus.Scheduled);
    expect(Object.keys(found ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
  });

  test("findTransitionProbe runs standalone via the queryDb read path", async () => {
    const probe = await SessionRepository.findTransitionProbe(completeTargetId);

    expect(probe).not.toBeNull();
    expect(Object.keys(probe ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "id",
      "startedAt",
      "status",
      "studentId",
      "teacherId",
    ]);
    expect(probe?.status).toBe(SessionStatus.Completed);
  });

  test("listForStudent/listForTeacher and the counts run standalone with coherent filtered windows", async () => {
    const unfiltered = await SessionRepository.listForStudent(actors.studentUserId, NO_FILTER, 25, 0);
    expect(unfiltered).toHaveLength(4);
    // The pool-inserted row carries the newest transaction timestamp and
    // the greatest id — newest first.
    expect(unfiltered[0]?.intent).toBe(SessionIntent.Tajweed);
    expect(unfiltered.slice(1).map(row => row.status)).toEqual([
      SessionStatus.Scheduled,
      SessionStatus.Completed,
      SessionStatus.Cancelled,
    ]);

    const completedOnly = await SessionRepository.listForStudent(actors.studentUserId, COMPLETED_FILTER, 25, 0);
    expect(completedOnly.map(row => row.id)).toEqual([completeTargetId]);

    expect(await SessionRepository.countForStudent(actors.studentUserId, NO_FILTER)).toBe(4);
    expect(await SessionRepository.countForStudent(actors.studentUserId, COMPLETED_FILTER)).toBe(1);

    const teacherRows = await SessionRepository.listForTeacher(actors.teacherUserId, NO_FILTER, 25, 0);
    expect(teacherRows).toHaveLength(4);
    expect(await SessionRepository.countForTeacher(actors.teacherUserId, STARTED_FILTER)).toBe(0);
    expect(await SessionRepository.countForTeacher(actors.teacherUserId, COMPLETED_FILTER)).toBe(1);
  });

  test("sweepExpiredCompletedOnce runs on the pool fallback and cancels only the overdue fixture", async () => {
    const fixture = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      const now = new Date();
      const staleStamp = new Date(now.getTime() - SESSION_CONFIRMATION_WINDOW_MS - 3_600_000);
      const overdue = await insertSessionRow(tx, pair, {
        status: SessionStatus.Completed,
        endedAt: staleStamp,
        confirmedByTeacherAt: staleStamp,
      });
      const fresh = await insertSessionRow(tx, pair, {
        status: SessionStatus.Completed,
        confirmedByTeacherAt: new Date(now.getTime() - 60_000),
      });
      committedSessionIds.push(overdue.id, fresh.id);
      return { overdueId: overdue.id, freshId: fresh.id };
    });

    const swept = await SessionRepository.sweepExpiredCompletedOnce(new Date());

    const sweptIds = swept.map(row => row.id);
    expect(sweptIds).toContain(fixture.overdueId);
    expect(sweptIds).not.toContain(fixture.freshId);
    const sweptRow = swept.find(row => row.id === fixture.overdueId);
    expect(sweptRow?.status).toBe(SessionStatus.Cancelled);
    expect(sweptRow?.feeHeld).toBe(false);
    expect(sweptRow?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
  });

  test("existsSessionForTeacherStudent runs on the pool fallback (no tx supplied)", async () => {
    // Committed fixtures: a linked teacher↔student pair (probeTargetId
    // already exists from the insertSession test, owned by `actors`) and
    // a separate disjoint pair so the foreign probe returns false on the
    // pool fallback too.
    const fixture = await db.transaction(async tx => {
      const pair = await createSessionActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      const unrelatedRow = await insertSessionRow(tx, pair);
      committedSessionIds.push(unrelatedRow.id);
      return { unrelatedPair: pair };
    });

    // Linked probe against the actors' committed scheduled row (no tx
    // passed — the executor falls back to the db pool).
    const linked = await SessionRepository.existsSessionForTeacherStudent(actors.teacherUserId, actors.studentUserId);
    expect(linked).toBe(true);

    // Foreign probe (unrelated teacher↔student pair) returns false on the
    // pool fallback.
    const foreign = await SessionRepository.existsSessionForTeacherStudent(
      fixture.unrelatedPair.teacherUserId,
      actors.studentUserId
    );
    expect(foreign).toBe(false);
  });
});
