/**
 * SessionRepository tests — the `session` table's data-access layer
 * (`insertSession`, `findById`, `startSessionOnce`, `completeSessionOnce`,
 * `cancelSessionOnce`, `openDisputeOnce`, `resolveDisputeCancelOnce`,
 * `resolveDisputeCompleteOnce`, `findTransitionProbe`, the participant
 * list/count quartet, and the admin disputed pair) against the live
 * `kottaby_test_db` PostgreSQL instance.
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
 *  - Tier 2 (pagination): newest-first ordering (`created_at DESC`) with
 *    the `id DESC` tiebreak for rows created in the same instant; page 1
 *    exact-size; a mid window; an offset past the end yields empty items
 *    next to the honest total; the optional status filter narrows list and
 *    count COHERENTLY (one shared predicate builder); absent/null filters
 *    drop out and never error.
 *  - Tier 3 (chaos/concurrency): `Promise.allSettled` duplication —
 *    double-start, double-complete, and double-cancel each produce exactly
 *    ONE winner (the loser's guarded predicate matches zero rows against
 *    the winner's effect), and the start-against-cancel race serializes
 *    deterministically (cancel is legal from both pre-states, so both
 *    landed transitions stay consistent with the final row). The fused
 *    certification predicate is proven under duplication: a decertified
 *    teacher's completions produce zero winners and zero writes.
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
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type { DBTransaction, SessionInsertType, SessionListFilterInput, SessionSelectType } from "@/backend/types";

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

/** An integer id that cannot exist as a `users` row during this transaction. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

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

      const resolved = await SessionRepository.resolveDisputeCancelOnce(row.id, "refunded in full", tx);

      expect(resolved).not.toBeNull();
      expect(resolved?.status).toBe(SessionStatus.Cancelled);
      expect(resolved?.feeHeld).toBe(false);
      // The provenance lane survives so the caller's same-lane refund can
      // read it off the returned row.
      expect(resolved?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(resolved?.resolutionNote).toBe("refunded in full");
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
      const bare = await SessionRepository.resolveDisputeCancelOnce(row.id, null, tx);
      expect(bare?.status).toBe(SessionStatus.Cancelled);
      expect(bare?.resolutionNote).toBeNull();

      // A scheduled row is not disputed — the guarded predicate misses.
      const scheduledRow = await insertSessionRow(tx, actors);
      const notDisputed = await SessionRepository.resolveDisputeCancelOnce(scheduledRow.id, "n", tx);
      expect(notDisputed).toBeNull();
      const stillScheduled = await readSessionRow(tx, scheduledRow.id);
      expect(stillScheduled.status).toBe(SessionStatus.Scheduled);
      expect(stillScheduled.feeHeld).toBe(true);

      // Double-resolve: the second attempt matches zero rows.
      const doubleResolve = await SessionRepository.resolveDisputeCancelOnce(row.id, "again", tx);
      expect(doubleResolve).toBeNull();

      // Unknown session id.
      const unknown = await SessionRepository.resolveDisputeCancelOnce(missingSessionId, "n", tx);
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

      const resolved = await SessionRepository.resolveDisputeCompleteOnce(row.id, "held per policy", tx);

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
      const rejected = await SessionRepository.resolveDisputeCompleteOnce(neverStarted.id, "n", tx);
      expect(rejected).toBeNull();
      const stillDisputed = await readSessionRow(tx, neverStarted.id);
      expect(stillDisputed.status).toBe(SessionStatus.Disputed);
      expect(stillDisputed.feeHeld).toBe(true);
      expect(stillDisputed.resolutionNote).toBeNull();

      // Wrong state + unknown id.
      const scheduledRow = await insertSessionRow(tx, actors);
      const notDisputed = await SessionRepository.resolveDisputeCompleteOnce(scheduledRow.id, "n", tx);
      expect(notDisputed).toBeNull();
      const unknown = await SessionRepository.resolveDisputeCompleteOnce(missingSessionId, "n", tx);
      expect(unknown).toBeNull();
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

  test("double-complete under Promise.allSettled produces exactly one winner; the timestamp is written once", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);

      const outcomes = await Promise.allSettled([
        SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx),
        SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe(SessionStatus.Completed);
      expect(winners[0]?.endedAt).not.toBeNull();
      expect(winners[0]?.confirmedByTeacherAt).not.toBeNull();

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Completed);
      expect(finalRow.confirmedByTeacherAt).not.toBeNull();
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
  // and its sibling helpers module (behavior-identical max-lines refactor):
  // every source pin below scans BOTH files as one implementation unit, so
  // the pinned invariants (executor discipline, predicate sharing, SQL
  // interpolation allowlist) keep covering the whole repository layer.
  const REPO_FILES = [
    join(import.meta.dir, "../../../repo/classes/session.repository.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.helpers.ts"),
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
      // SQL-side (never rendered caller values) and the transition methods'
      // locally captured clock scalar (bound as a parameter, request-free).
      "session.confirmedByStudentAt",
      "session.confirmationDeadline",
      "now",
    ]);
    expect(interpolations).toHaveLength(17);
    for (const interpolation of interpolations) {
      expect(ALLOWED.has(interpolation)).toBe(true);
    }
    // The fused certification subquery interpolates exactly the schema
    // objects above — the caller's ids ride bound parameters.
    expect(/EXISTS \(SELECT 1 FROM \$\{teacher\}/.test(repoSource)).toBe(true);
    expect(/AND \$\{eq\(teacher\.isApproved, true\)\}\)/.test(repoSource)).toBe(true);
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
    expect(repoSource.match(/const executor = tx \?\? db;/g) ?? []).toHaveLength(9);
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(7);
    // Eighteen exported methods, every one ending in the optional tx (LAST
    // param); no REQUIRED-tx signature exists in this repository.
    expect(repoSource.match(/export async function /g) ?? []).toHaveLength(18);
    expect((repoSource.match(/tx\?: DBTransaction/g) ?? []).length).toBeGreaterThanOrEqual(18);
    expect(repoSource.includes("tx: DBTransaction")).toBe(false);
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
    const cancelled = await SessionRepository.resolveDisputeCancelOnce(fixture.cancelOutcome.id, "pool-cancel");
    expect(cancelled?.status).toBe(SessionStatus.Cancelled);
    expect(cancelled?.feeHeld).toBe(false);
    expect(cancelled?.resolutionNote).toBe("pool-cancel");
    expect(cancelled?.resolvedAt).not.toBeNull();

    const completed = await SessionRepository.resolveDisputeCompleteOnce(fixture.startedOutcome.id, "pool-complete");
    expect(completed?.status).toBe(SessionStatus.Completed);
    expect(completed?.feeHeld).toBe(false);
    expect(completed?.endedAt).not.toBeNull();
    expect(completed?.resolvedAt).not.toBeNull();

    // Resolved rows leave the arbitration queue.
    const remaining = await SessionRepository.listAdminDisputed(25, 0);
    expect(remaining.map(row => row.id)).not.toContain(fixture.cancelOutcome.id);
    expect(remaining.map(row => row.id)).not.toContain(fixture.startedOutcome.id);
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
});
