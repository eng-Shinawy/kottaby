/**
 * SessionRepository — admin governance surface tests (`listForAdmin`,
 * `getAnyByIdForAdmin`, `guardReschedule`, `guardCancelPreTerminal`,
 * `guardReassignTeacher`) against the live PostgreSQL instance.
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
 *    branches (the `queryDb` directory/detail reads + the `tx ?? db` guard
 *    fallback); the fixtures are committed FIRST (bun runs tests in
 *    declaration order) and hard-deleted in `afterAll` (rule 9).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): the directory returns EVERY row regardless of
 *    state or ownership in `created_at DESC, id DESC` order with the
 *    honest total; the browse read answers any state with the full row
 *    and an unknown id with `null`; each guard's hit branch returns the
 *    updated row and each miss branch (wrong state, terminal, disputed,
 *    replayed, unknown id) returns `null` and writes nothing.
 *  - Tier 2 (boundary): every filter member narrows list and total
 *    coherently while absent members drop out; the creation window is
 *    half-open (`>= dateFrom`, `< dateTo` — a zero-width window is an
 *    empty result, an exact `dateFrom` stamp is included, an exact
 *    `dateTo` stamp is excluded); the page window normalizes exactly
 *    like the participant lists (page < 1 → 1, pageSize outside 1..50 →
 *    25, offset past the end → empty rows next to the honest total) and
 *    deep pagination is ceilinged (a page whose resolved offset would
 *    start past the scan ceiling answers the empty window next to the
 *    honest total, without error); the `needsAttention` badge flags
 *    exactly the disputed rows and the scheduled rows with a lapsed
 *    deadline (presentation only); the
 *    guarded SET clauses touch ONLY their whitelisted columns (the admin
 *    cancel leaves the hold marker and provenance lane intact for the
 *    caller's refund composition — unlike the participant cancel).
 *  - Tier 3 (chaos): guarded transitions under duplication — a replayed
 *    admin cancel produces exactly one winner; a reschedule race
 *    serializes into the last write while the row stays eligible; a
 *    cancel-then-reassign race fails closed (the scheduled-only
 *    reassignment predicate misses the cancelled row); an admin cancel
 *    racing a participant start lands both transitions consistently.
 *  - Tier 4 (security/static): the reassignment target is FK-bound (an
 *    unknown teacher id surfaces the untranslated driver violation —
 *    23503) and the row survives untouched via its savepoint bracket;
 *    source pins — the admin guards share ONE live-state predicate and
 *    write exactly their whitelisted SET columns, the directory
 *    predicate is the single list/count truth carrying the half-open
 *    window, and the badge flag is a pure presentation projection.
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
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import type { DBTransaction, SessionInsertType, SessionSelectType } from "@/backend/types";

/** PostgreSQL error code for `foreign_key_violation`. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

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

/** The admin directory row = the canonical row plus the derived badge flag (locale-sorted). */
const ADMIN_ROW_KEYS = [
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
  "needsAttention",
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

/**
 * A second-aligned instant offset from now — the `timestamp` columns store
 * whole seconds, so every value asserted through a database round-trip is
 * built through this helper (the main repository suite's clock aid).
 */
function alignedInstant(offsetMs: number): Date {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

/** Shared-PK ids for one booking pair (session.teacher_id / session.student_id). */
interface SessionActors {
  teacherUserId: number;
  studentUserId: number;
}

/**
 * Shared-PK `teacher` row insert for a previously-created user — mirrors
 * the entity-setup role-child factory pattern (PK = users.id, FK cascade).
 */
async function createTestTeacherRow(tx: DBTransaction, userId: number): Promise<void> {
  await tx.insert(teacher).values({ id: userId, isApproved: true });
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
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

/** Reads the session row straight off the table (read-back oracle). */
async function readSessionRow(tx: DBTransaction, id: number): Promise<SessionSelectType> {
  const [row] = await tx.select().from(session).where(eq(session.id, id)).limit(1);
  if (!row) {
    throw new Error("readSessionRow: expected the session row to exist");
  }
  return row;
}

/**
 * Drives one freshly inserted `scheduled` row into the requested lifecycle
 * state through the guarded transitions themselves (so every precondition
 * row is reachable by the same statements production uses).
 */
async function createSessionInState(
  tx: DBTransaction,
  actors: SessionActors,
  status: SessionStatus,
  overrides: Partial<SessionInsertType> = {}
): Promise<SessionSelectType> {
  const row = await insertSessionRow(tx, actors, overrides);
  if (status === SessionStatus.Started || status === SessionStatus.Completed) {
    await SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx);
  }
  if (status === SessionStatus.Completed) {
    await SessionRepository.completeSessionOnce(row.id, actors.teacherUserId, tx);
  }
  if (status === SessionStatus.Cancelled) {
    await SessionRepository.cancelSessionOnce(row.id, actors.studentUserId, null, tx);
  }
  if (status === SessionStatus.Disputed) {
    await SessionRepository.openDisputeOnce(row.id, actors.studentUserId, "admin-governance-probe", tx);
  }
  return readSessionRow(tx, row.id);
}

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message.
 */

describe("SessionRepository — admin governance surface (runInRollback)", () => {
  // ─── Tier 1: the directory + browse reads ───────────────────────────

  test("listForAdmin returns every row regardless of state or ownership, newest first with the id tiebreak", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      // Future stamps keep my rows at the head of the shared table's list
      // (the shared test DB has no committed session writers, but the
      // head-of-list property keeps the window assertions exact).
      const now = Date.now();
      const disputeRow = await insertSessionRow(tx, actorsA, { createdAt: new Date(now + 3 * 3_600_000) });
      const liveRow = await insertSessionRow(tx, actorsB, { createdAt: new Date(now + 2 * 3_600_000) });
      const terminalRow = await insertSessionRow(tx, actorsA, { createdAt: new Date(now + 3_600_000) });
      await SessionRepository.startSessionOnce(liveRow.id, actorsB.teacherUserId, tx);
      await SessionRepository.openDisputeOnce(disputeRow.id, actorsA.studentUserId, "directory-scan", tx);
      await SessionRepository.cancelSessionOnce(terminalRow.id, actorsA.studentUserId, null, tx);
      // Three rows sharing one creation instant — only the id DESC tiebreak
      // can order them deterministically. A future stamp keeps them ahead
      // of any concurrent tests writing rows at now().
      const sameInstant = new Date(now + 1_800_000);
      const sameInstant1 = await insertSessionRow(tx, actorsB, { createdAt: sameInstant });
      const sameInstant2 = await insertSessionRow(tx, actorsB, { createdAt: sameInstant });
      const sameInstant3 = await insertSessionRow(tx, actorsB, { createdAt: sameInstant });

      const page = await SessionRepository.listForAdmin({}, 1, 25, tx);

      expect(page.rows.map(row => row.id).slice(0, 6)).toEqual([
        disputeRow.id,
        liveRow.id,
        terminalRow.id,
        sameInstant3.id,
        sameInstant2.id,
        sameInstant1.id,
      ]);
      // The 21-column canonical row plus the derived badge flag — the
      // projection adds exactly one key, drops none.
      expect(Object.keys(page.rows[0] ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...ADMIN_ROW_KEYS]);
    });
  });

  test("the directory total is honest: it moves by exactly the rows the transaction adds", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      // The participant filter isolates the total delta from rows other
      // parallel files commit between the two reads.
      const filter = { teacherUserId: actors.teacherUserId };
      const before = await SessionRepository.listForAdmin(filter, 1, 25, tx);

      const created = [
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
        await insertSessionRow(tx, actors),
      ];

      const after = await SessionRepository.listForAdmin(filter, 1, 25, tx);
      expect(after.total - before.total).toBe(created.length);
      // The windowed rows and the total describe the SAME filtered set —
      // the scoped page carries exactly the rows this transaction created.
      expect(after.rows.map(row => row.id).toSorted((a, b) => a - b)).toEqual(
        created.map(row => row.id).toSorted((a, b) => a - b)
      );
    });
  });

  test("getAnyByIdForAdmin answers any lifecycle state with the full row and an unknown id with null", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const scheduled = await createSessionInState(tx, actors, SessionStatus.Scheduled);
      const started = await createSessionInState(tx, actors, SessionStatus.Started);
      const completed = await createSessionInState(tx, actors, SessionStatus.Completed);
      const cancelled = await createSessionInState(tx, actors, SessionStatus.Cancelled);
      const disputed = await createSessionInState(tx, actors, SessionStatus.Disputed);

      const stateRows = [scheduled, started, completed, cancelled, disputed];
      const foundRows = await Promise.all(stateRows.map(row => SessionRepository.getAnyByIdForAdmin(row.id, tx)));
      for (const [index, row] of stateRows.entries()) {
        const found = foundRows[index];
        expect(found).not.toBeNull();
        expect(found?.id).toBe(row.id);
        expect(found?.status).toBe(row.status);
        // The browse read is the unscoped read: it answers with the full
        // canonical row for ANY state — no ownership narrowing and no
        // lifecycle restriction exists on this path by contract.
        expect(Object.keys(found ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...SESSION_ROW_KEYS]);
      }

      const missingId = await absentSessionId(tx);
      expect(await SessionRepository.getAnyByIdForAdmin(missingId, tx)).toBeNull();
    });
  });

  // ─── Tier 2: filters, window, page normalization, badge matrix ──────

  test("every filter member narrows list and total coherently; absent members drop out", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      const aScheduled = await insertSessionRow(tx, actorsA);
      const aStarted = await insertSessionRow(tx, actorsA, { sessionType: SessionType.TeacherEvaluation });
      await SessionRepository.startSessionOnce(aStarted.id, actorsA.teacherUserId, tx);
      const bScheduled = await insertSessionRow(tx, actorsB);

      const teacherFiltered = await SessionRepository.listForAdmin({ teacherUserId: actorsA.teacherUserId }, 1, 25, tx);
      expect(teacherFiltered.rows.map(row => row.id).toSorted((a, b) => a - b)).toEqual(
        [aScheduled.id, aStarted.id].toSorted((a, b) => a - b)
      );
      expect(teacherFiltered.total).toBe(2);

      const studentFiltered = await SessionRepository.listForAdmin({ studentUserId: actorsB.studentUserId }, 1, 25, tx);
      expect(studentFiltered.rows.map(row => row.id)).toEqual([bScheduled.id]);

      const typeFiltered = await SessionRepository.listForAdmin(
        { teacherUserId: actorsA.teacherUserId, type: SessionType.TeacherEvaluation },
        1,
        25,
        tx
      );
      expect(typeFiltered.rows.map(row => row.id)).toEqual([aStarted.id]);
      expect(typeFiltered.total).toBe(1);

      const statusFiltered = await SessionRepository.listForAdmin(
        { teacherUserId: actorsA.teacherUserId, status: SessionStatus.Started },
        1,
        25,
        tx
      );
      expect(statusFiltered.rows.map(row => row.id)).toEqual([aStarted.id]);

      // List/count coherence: the total always describes the exact set the
      // page windows over (ONE shared predicate builder feeds both).
      const startedTotal = await SessionRepository.listForAdmin({ status: SessionStatus.Started }, 1, 25, tx);
      expect(startedTotal.total).toBe(1);

      // An all-absent filter never errors and returns the unscoped set.
      const unfiltered = await SessionRepository.listForAdmin({}, 1, 25, tx);
      expect(unfiltered.total).toBeGreaterThanOrEqual(3);
    });
  });

  test("the creation window is half-open over createdAt: >= dateFrom, < dateTo", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = Date.now();
      const early = await insertSessionRow(tx, actors, { createdAt: new Date(now + 1 * 3_600_000) });
      const middle = await insertSessionRow(tx, actors, { createdAt: new Date(now + 2 * 3_600_000) });
      const late = await insertSessionRow(tx, actors, { createdAt: new Date(now + 3 * 3_600_000) });

      // Lower bound inclusive: a window opening exactly on `middle`'s stamp
      // keeps it (and every newer row); committed rows carry past stamps so
      // they never cross a future-stamped window.
      const fromExact = await SessionRepository.listForAdmin({ dateFrom: middle.createdAt }, 1, 25, tx);
      expect(fromExact.rows.map(row => row.id)).toEqual([late.id, middle.id]);

      // Upper bound exclusive: a window closing exactly on `middle`'s stamp
      // drops it; `early` is the newest row inside.
      const toExact = await SessionRepository.listForAdmin({ dateTo: middle.createdAt }, 1, 25, tx);
      expect(toExact.rows.map(row => row.id).slice(0, 1)).toEqual([early.id]);
      expect(toExact.rows.map(row => row.id)).not.toContain(middle.id);
      expect(toExact.rows.map(row => row.id)).not.toContain(late.id);

      // Zero-width window: an empty result, never an error.
      const zeroWidth = await SessionRepository.listForAdmin(
        { dateFrom: new Date(now + 90 * 60_000), dateTo: new Date(now + 90 * 60_000) },
        1,
        25,
        tx
      );
      expect(zeroWidth.rows).toEqual([]);

      // A spanning window selects exactly the inside rows.
      const spanning = await SessionRepository.listForAdmin(
        { dateFrom: new Date(now + 90 * 60_000), dateTo: new Date(now + 150 * 60_000) },
        1,
        25,
        tx
      );
      expect(spanning.rows.map(row => row.id)).toEqual([middle.id]);
      expect(spanning.total).toBeGreaterThanOrEqual(1);
    });
  });

  test("page normalization mirrors the participant clamp window (page >= 1, pageSize 1..50 else 25)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = Date.now();
      const insertedRows = await Promise.all(
        Array.from({ length: 30 }, (_, index) =>
          insertSessionRow(tx, actors, { createdAt: new Date(now + (index + 1) * 60_000) })
        )
      );
      // Newest first: the ascending stamps mean the head of the list is the
      // LAST created row.
      const expectedHead = insertedRows.map(row => row.id).toReversed();

      // Scope to this test's own teacher: other parallel files commit
      // directory rows of their own, and only the participant filter keeps
      // the exact page/total assertions deterministic under that traffic.
      const filter = { teacherUserId: actors.teacherUserId };

      const baseline = await SessionRepository.listForAdmin(filter, 1, 50, tx);
      expect(baseline.rows.map(row => row.id)).toEqual(expectedHead);
      expect(baseline.total).toBe(30);

      // A page below 1 falls back to the first page; an oversized pageSize
      // falls back to the default window of 25.
      const pageZero = await SessionRepository.listForAdmin(filter, 0, 100, tx);
      expect(pageZero.rows).toHaveLength(25);
      expect(pageZero.rows.map(row => row.id)).toEqual(expectedHead.slice(0, 25));

      const negativePage = await SessionRepository.listForAdmin(filter, -3, 0, tx);
      expect(negativePage.rows).toHaveLength(25);

      // The pageSize bounds are honored verbatim.
      const singleRow = await SessionRepository.listForAdmin(filter, 1, 1, tx);
      expect(singleRow.rows.map(row => row.id)).toEqual([expectedHead[0]]);

      const fullWindow = await SessionRepository.listForAdmin(filter, 1, 50, tx);
      expect(fullWindow.rows.map(row => row.id)).toEqual(expectedHead);

      // An offset past the end yields empty rows next to the honest total.
      const beyond = await SessionRepository.listForAdmin(filter, 3, 25, tx);
      expect(beyond.rows).toEqual([]);
      expect(beyond.total).toBe(baseline.total);

      // A mid window slices the ordered set: the five oldest rows close out
      // the scoped directory.
      const mid = await SessionRepository.listForAdmin(filter, 2, 25, tx);
      expect(mid.rows.map(row => row.id)).toEqual(expectedHead.slice(25, 30));
    });
  });

  test("deep pagination is ceilinged: a page whose offset would start past the scan ceiling answers the empty window next to the honest total", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      await insertSessionRow(tx, actors, {});
      // The participant filter isolates the honest-total assertions from
      // rows other parallel files commit between reads.
      const filter = { teacherUserId: actors.teacherUserId };
      const baseline = await SessionRepository.listForAdmin(filter, 1, 25, tx);
      expect(baseline.total).toBe(1);

      // A page far past any real data resolves to the EMPTY window with
      // the honest total — and never errors: the resolved offset is
      // refused before it can reach the sorted scan as a hostile
      // multi-billion-row OFFSET.
      const huge = await SessionRepository.listForAdmin(filter, 1_000_000_000, 50, tx);
      expect(huge.rows).toEqual([]);
      expect(huge.total).toBe(baseline.total);

      // The deepest window the ceiling still admits resolves through the
      // normal path (empty here only because the directory holds a single
      // row) — the ceiling changes nothing for reachable windows.
      const atCeilingEdge = await SessionRepository.listForAdmin(filter, 201, 50, tx);
      expect(atCeilingEdge.rows).toEqual([]);
      expect(atCeilingEdge.total).toBe(baseline.total);
    });
  });

  test("needsAttention flags exactly the disputed rows and the scheduled rows with a lapsed deadline", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const lapsedDeadline = new Date(Date.now() - 60_000);
      const futureDeadline = new Date(Date.now() + 3_600_000);

      const disputed = await createSessionInState(tx, actors, SessionStatus.Disputed, {
        confirmationDeadline: lapsedDeadline,
      });
      const scheduledLapsed = await insertSessionRow(tx, actors, { confirmationDeadline: lapsedDeadline });
      const scheduledFuture = await insertSessionRow(tx, actors, { confirmationDeadline: futureDeadline });
      const scheduledNoDeadline = await insertSessionRow(tx, actors);
      const startedLapsed = await createSessionInState(tx, actors, SessionStatus.Started, {
        confirmationDeadline: lapsedDeadline,
      });
      const completed = await createSessionInState(tx, actors, SessionStatus.Completed);
      const cancelled = await createSessionInState(tx, actors, SessionStatus.Cancelled);

      const myIds = [
        disputed.id,
        scheduledLapsed.id,
        scheduledFuture.id,
        scheduledNoDeadline.id,
        startedLapsed.id,
        completed.id,
        cancelled.id,
      ];
      const page = await SessionRepository.listForAdmin({}, 1, 50, tx);
      const byId = new Map(page.rows.map(row => [row.id, row]));
      for (const id of myIds) {
        expect(byId.has(id)).toBe(true);
      }

      expect(byId.get(disputed.id)?.needsAttention).toBe(true);
      expect(byId.get(scheduledLapsed.id)?.needsAttention).toBe(true);
      expect(byId.get(scheduledFuture.id)?.needsAttention).toBe(false);
      expect(byId.get(scheduledNoDeadline.id)?.needsAttention).toBe(false);
      // The badge tracks the scheduling deadline, not the hold: a started
      // row is never flagged even with a lapsed deadline.
      expect(byId.get(startedLapsed.id)?.needsAttention).toBe(false);
      expect(byId.get(completed.id)?.needsAttention).toBe(false);
      expect(byId.get(cancelled.id)?.needsAttention).toBe(false);
      // The flag rides on rows that keep the full canonical shape.
      const flagged = byId.get(disputed.id);
      expect(Object.keys(flagged ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual([...ADMIN_ROW_KEYS]);
    });
  });

  // ─── Tier 1: the guarded admin writes ───────────────────────────────

  test("guardReschedule rewrites only the timing pair on scheduled and started rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const deadline = new Date(Math.floor((Date.now() + 3_600_000) / 1000) * 1000);
      const scheduledRow = await insertSessionRow(tx, actors, { confirmationDeadline: deadline });
      const startedRow = await insertSessionRow(tx, actors, { confirmationDeadline: deadline });
      await SessionRepository.startSessionOnce(startedRow.id, actors.teacherUserId, tx);

      const nextStart = alignedInstant(2 * 3_600_000);
      const nextEnd = alignedInstant(3 * 3_600_000);

      const rescheduledScheduled = await SessionRepository.guardReschedule(scheduledRow.id, nextStart, nextEnd, tx);
      expect(rescheduledScheduled).not.toBeNull();
      expect(rescheduledScheduled?.status).toBe(SessionStatus.Scheduled);
      expect(rescheduledScheduled?.startedAt?.getTime()).toBe(nextStart.getTime());
      expect(rescheduledScheduled?.endedAt?.getTime()).toBe(nextEnd.getTime());
      // Nothing outside the whitelist moved: the deadline is never
      // re-armed, the hold columns stay untouched.
      expect(rescheduledScheduled?.confirmationDeadline?.getTime()).toBe(deadline.getTime());
      expect(rescheduledScheduled?.feeHeld).toBe(true);
      expect(rescheduledScheduled?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(rescheduledScheduled?.updatedAt.getTime()).toBeGreaterThanOrEqual(scheduledRow.updatedAt.getTime());

      const rescheduledStarted = await SessionRepository.guardReschedule(startedRow.id, nextStart, nextEnd, tx);
      expect(rescheduledStarted).not.toBeNull();
      expect(rescheduledStarted?.status).toBe(SessionStatus.Started);
      expect(rescheduledStarted?.startedAt?.getTime()).toBe(nextStart.getTime());
      expect(rescheduledStarted?.endedAt?.getTime()).toBe(nextEnd.getTime());
      // The original start stamp is replaced by the admin's timing — the
      // reschedule is the timing surface's single writer.
      expect(rescheduledStarted?.startedAt?.getTime()).not.toBe(startedRow.startedAt?.getTime());
    });
  });

  test("guardReschedule refuses completed, cancelled, disputed, and unknown rows without writing", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const nextStart = alignedInstant(3_600_000);
      const nextEnd = alignedInstant(4 * 3_600_000);
      const states = [
        await createSessionInState(tx, actors, SessionStatus.Completed),
        await createSessionInState(tx, actors, SessionStatus.Cancelled),
        await createSessionInState(tx, actors, SessionStatus.Disputed),
      ];

      const missedRows = await Promise.all(
        states.map(row => SessionRepository.guardReschedule(row.id, nextStart, nextEnd, tx))
      );
      for (const missed of missedRows) {
        expect(missed).toBeNull();
      }
      const untouchedRows = await Promise.all(states.map(row => readSessionRow(tx, row.id)));
      for (const [index, row] of states.entries()) {
        const untouched = untouchedRows[index];
        expect(untouched.startedAt?.getTime() ?? null).toBe(row.startedAt?.getTime() ?? null);
        expect(untouched.endedAt?.getTime() ?? null).toBe(row.endedAt?.getTime() ?? null);
        expect(untouched.status).toBe(row.status);
      }

      const missingId = await absentSessionId(tx);
      expect(await SessionRepository.guardReschedule(missingId, nextStart, nextEnd, tx)).toBeNull();
    });
  });

  test("guardCancelPreTerminal cancels scheduled and started rows clearing the hold marker and leaving the provenance lane for the caller's refund", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const scheduledRow = await insertSessionRow(tx, actors);
      const startedRow = await insertSessionRow(tx, actors);
      await SessionRepository.startSessionOnce(startedRow.id, actors.teacherUserId, tx);

      const cancelledScheduled = await SessionRepository.guardCancelPreTerminal(scheduledRow.id, tx);
      expect(cancelledScheduled).not.toBeNull();
      expect(cancelledScheduled?.status).toBe(SessionStatus.Cancelled);
      // The terminal shape mirrors the participant cancel exactly: the hold
      // marker is cleared INSIDE the guarded statement (a committed admin
      // cancellation can never leave a fee_held=true terminal row behind)
      // while the provenance lane stays untouched — the RETURNING row still
      // carries the recorded lane the caller's same-transaction refund
      // composes against.
      expect(cancelledScheduled?.feeHeld).toBe(false);
      expect(cancelledScheduled?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(cancelledScheduled?.endedAt).toBeNull();
      expect(cancelledScheduled?.updatedAt.getTime()).toBeGreaterThanOrEqual(scheduledRow.updatedAt.getTime());

      const cancelledStarted = await SessionRepository.guardCancelPreTerminal(startedRow.id, tx);
      expect(cancelledStarted).not.toBeNull();
      expect(cancelledStarted?.status).toBe(SessionStatus.Cancelled);
      expect(cancelledStarted?.startedAt).not.toBeNull();
      expect(cancelledStarted?.endedAt).toBeNull();
      expect(cancelledStarted?.feeHeld).toBe(false);
    });
  });

  test("guardCancelPreTerminal refuses completed, disputed, replayed, and unknown rows without writing", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const completed = await createSessionInState(tx, actors, SessionStatus.Completed);
      const disputed = await createSessionInState(tx, actors, SessionStatus.Disputed);

      // A disputed row belongs to the arbitration surface — the only writer
      // allowed to exit it into a terminal state. The governance cancel's
      // live-state predicate structurally excludes it.
      const disputedMiss = await SessionRepository.guardCancelPreTerminal(disputed.id, tx);
      expect(disputedMiss).toBeNull();
      const disputedAfter = await readSessionRow(tx, disputed.id);
      expect(disputedAfter.status).toBe(SessionStatus.Disputed);

      const completedMiss = await SessionRepository.guardCancelPreTerminal(completed.id, tx);
      expect(completedMiss).toBeNull();
      expect((await readSessionRow(tx, completed.id)).status).toBe(SessionStatus.Completed);

      // The replay: the first cancel lands, the second matches zero rows —
      // the eligibility clause IS the exactly-once gate.
      const replayTarget = await insertSessionRow(tx, actors);
      const first = await SessionRepository.guardCancelPreTerminal(replayTarget.id, tx);
      expect(first?.status).toBe(SessionStatus.Cancelled);
      const second = await SessionRepository.guardCancelPreTerminal(replayTarget.id, tx);
      expect(second).toBeNull();

      const missingId = await absentSessionId(tx);
      expect(await SessionRepository.guardCancelPreTerminal(missingId, tx)).toBeNull();
    });
  });

  test("guardReassignTeacher swaps the owning teacher on a scheduled row, touching only the teacher id", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const candidates = await createSessionActors(tx);
      const deadline = alignedInstant(3_600_000);
      const row = await insertSessionRow(tx, actors, { confirmationDeadline: deadline });

      const reassigned = await SessionRepository.guardReassignTeacher(row.id, candidates.teacherUserId, tx);
      expect(reassigned).not.toBeNull();
      expect(reassigned?.teacherId).toBe(candidates.teacherUserId);
      expect(reassigned?.studentId).toBe(actors.studentUserId);
      expect(reassigned?.status).toBe(SessionStatus.Scheduled);
      // Nothing outside the whitelist moved.
      expect(reassigned?.confirmationDeadline?.getTime()).toBe(deadline.getTime());
      expect(reassigned?.feeHeld).toBe(true);
      expect(reassigned?.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
      expect(reassigned?.startedAt).toBeNull();
      expect(reassigned?.updatedAt.getTime()).toBeGreaterThanOrEqual(row.updatedAt.getTime());
    });
  });

  test("guardReassignTeacher refuses started, completed, cancelled, disputed, and unknown rows without writing", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const candidates = await createSessionActors(tx);
      const states = [
        await createSessionInState(tx, actors, SessionStatus.Started),
        await createSessionInState(tx, actors, SessionStatus.Completed),
        await createSessionInState(tx, actors, SessionStatus.Cancelled),
        await createSessionInState(tx, actors, SessionStatus.Disputed),
      ];

      const missedRows = await Promise.all(
        states.map(row => SessionRepository.guardReassignTeacher(row.id, candidates.teacherUserId, tx))
      );
      for (const missed of missedRows) {
        expect(missed).toBeNull();
      }
      const untouchedRows = await Promise.all(states.map(row => readSessionRow(tx, row.id)));
      for (const [index, row] of states.entries()) {
        const untouched = untouchedRows[index];
        expect(untouched.teacherId).toBe(actors.teacherUserId);
        expect(untouched.status).toBe(row.status);
      }

      const missingId = await absentSessionId(tx);
      expect(await SessionRepository.guardReassignTeacher(missingId, candidates.teacherUserId, tx)).toBeNull();
    });
  });

  test("guardReassignTeacher refuses a same-teacher swap without writing (the different-teacher fold)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      // The owning teacher IS the candidate: the no-op swap is denied
      // fail-closed at the guard — zero rows match and nothing is written,
      // the same eligibility-fold miss shape as a wrong-state row, so the
      // caller's transition probe classifies it as the state conflict.
      const sameTeacherMiss = await SessionRepository.guardReassignTeacher(row.id, actors.teacherUserId, tx);
      expect(sameTeacherMiss).toBeNull();
      expect(await readSessionRow(tx, row.id)).toEqual(row);

      // The fold composes with the state clause: a DIFFERENT candidate
      // still swaps the same scheduled row.
      const candidates = await createSessionActors(tx);
      const swapped = await SessionRepository.guardReassignTeacher(row.id, candidates.teacherUserId, tx);
      expect(swapped?.teacherId).toBe(candidates.teacherUserId);
      expect(swapped?.status).toBe(SessionStatus.Scheduled);
    });
  });

  // ─── Tier 4: the reassignment target is FK-bound ────────────────────

  test("an unknown reassignment target surfaces the untranslated FK violation; the row survives via its savepoint", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const missingUserId = await absentUserId(tx);

      await tx.execute(sql`savepoint reassign_fk_probe`);
      const fkError = await expectRepoError(() => SessionRepository.guardReassignTeacher(row.id, missingUserId, tx));
      await tx.execute(sql`rollback to savepoint reassign_fk_probe`);

      expect(hasPostgresErrorCode(fkError, PG_FOREIGN_KEY_VIOLATION)).toBe(true);
      // The savepoint bracket kept the transaction queryable and the row
      // byte-identical: the certification pre-assertion upstream is what
      // keeps this driver-level rejection a cold-path race guard.
      const untouched = await readSessionRow(tx, row.id);
      expect(untouched.teacherId).toBe(actors.teacherUserId);
      expect(untouched.status).toBe(SessionStatus.Scheduled);
    });
  });

  // ─── Tier 3: guarded transitions under duplication ──────────────────

  test("double admin-cancel under Promise.allSettled produces exactly one winner — the replay matches zero rows", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const outcomes = await Promise.allSettled([
        SessionRepository.guardCancelPreTerminal(row.id, tx),
        SessionRepository.guardCancelPreTerminal(row.id, tx),
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

  test("reschedule races serialize into the last write while the row stays eligible", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);
      const firstStart = alignedInstant(3_600_000);
      const firstEnd = alignedInstant(4 * 3_600_000);
      const secondStart = alignedInstant(5 * 3_600_000);
      const secondEnd = alignedInstant(6 * 3_600_000);

      const outcomes = await Promise.allSettled([
        SessionRepository.guardReschedule(row.id, firstStart, firstEnd, tx),
        SessionRepository.guardReschedule(row.id, secondStart, secondEnd, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      // Rescheduling never leaves the eligible set, so both attempts land;
      // statements serialize in call order on the one rollback connection
      // and the second write is the final timing.
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Scheduled);
      expect(finalRow.startedAt?.getTime()).toBe(secondStart.getTime());
      expect(finalRow.endedAt?.getTime()).toBe(secondEnd.getTime());
    });
  });

  test("cancel against reassign fails closed: the scheduled-only reassignment misses the cancelled row", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const candidates = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      const outcomes = await Promise.allSettled([
        SessionRepository.guardCancelPreTerminal(row.id, tx),
        SessionRepository.guardReassignTeacher(row.id, candidates.teacherUserId, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const [cancelOutcome, reassignOutcome] = outcomes.map(outcome =>
        outcome.status === "fulfilled" ? outcome.value : null
      );
      // The cancel (enqueued first) wins; the reassignment's scheduled-only
      // predicate then matches zero rows — the race can never swap the
      // teacher of a row the governance surface just cancelled.
      expect(cancelOutcome).not.toBeNull();
      expect(reassignOutcome).toBeNull();

      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.teacherId).toBe(actors.teacherUserId);
      expect(finalRow.feeHeld).toBe(false);
    });
  });

  test("admin cancel against participant start serializes into one consistent final state", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const row = await insertSessionRow(tx, actors);

      // Statements serialize on the one rollback connection in call order:
      // the start is enqueued first, the admin cancel second. The cancel is
      // legal from BOTH of the start's possible pre-states, so whatever the
      // start landed, the cancel's predicate still matches — the race
      // resolves into the deterministic sequence [start, admin cancel].
      const outcomes = await Promise.allSettled([
        SessionRepository.startSessionOnce(row.id, actors.teacherUserId, tx),
        SessionRepository.guardCancelPreTerminal(row.id, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const finalRow = await readSessionRow(tx, row.id);
      expect(finalRow.status).toBe(SessionStatus.Cancelled);
      expect(finalRow.startedAt).not.toBeNull();
      expect(finalRow.endedAt).toBeNull();
      // The hold marker is cleared by whichever write landed the cancel —
      // the terminal shape is identical for both pre-states — while the
      // provenance lane survives: the recorded lane the caller's
      // same-transaction refund composes against.
      expect(finalRow.feeHeld).toBe(false);
      expect(finalRow.heldBalanceLane).toBe(HeldBalanceLane.Hifz);
    });
  });

  // ─── Tier 4: admin-surface source pins ──────────────────────────────

  // The repository implementation is split across the public namespace file
  // and its sibling helpers modules: every source pin below scans them as
  // one implementation unit (mirroring the main repository suite).
  const REPO_FILES = [
    join(import.meta.dir, "../../../repo/classes/session.repository.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.helpers.ts"),
    join(import.meta.dir, "../../../repo/classes/session.repository.arbitration.helpers.ts"),
  ];
  const repoSource = REPO_FILES.map(file => readFileSync(file, "utf8")).join("\n");

  test("source: the admin guards share ONE live-state predicate and write exactly their whitelisted columns", () => {
    // Definition + the two sharing guards (reschedule, cancel).
    expect(repoSource.match(/buildAdminLiveStatePredicate\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(repoSource.includes("function buildAdminLiveStatePredicate(")).toBe(true);
    // The SET clauses are field-by-field whitelists — no caller object is
    // ever spread into an update.
    expect(repoSource.includes(".set({ startedAt, endedAt, updatedAt: now })")).toBe(true);
    expect(repoSource.includes(".set({ status: SessionStatus.Cancelled, feeHeld: false, updatedAt: now })")).toBe(true);
    expect(repoSource.includes(".set({ teacherId: newTeacherId, updatedAt: now })")).toBe(true);
    expect(repoSource.includes("...input")).toBe(false);
    expect(repoSource.includes("...filter")).toBe(false);
    // The reassignment's scheduled-only, different-teacher eligibility
    // rides the same composed-SQL shape as every other guarded transition.
    expect(
      /and\(\s*eq\(session\.id, sessionId\),\s*eq\(session\.status, SessionStatus\.Scheduled\),\s*ne\(session\.teacherId, newTeacherId\)\s*\)/.test(
        repoSource
      )
    ).toBe(true);
    expect(repoSource.includes("inArray")).toBe(false);
  });

  test("source: the directory predicate is the single list/count truth with the half-open window", () => {
    // Definition + the list and count call sites (each consumes the ONE
    // shared builder on both executor branches).
    expect(repoSource.match(/buildAdminDirectoryPredicate\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(repoSource.includes("function buildAdminDirectoryPredicate(")).toBe(true);
    // Half-open window vocabulary — inclusive lower, exclusive upper.
    expect(repoSource.includes("gte(session.createdAt, filter.dateFrom)")).toBe(true);
    expect(repoSource.includes("lt(session.createdAt, filter.dateTo)")).toBe(true);
    expect(repoSource.includes("lte(session.createdAt")).toBe(false);
    expect(repoSource.includes("gt(session.createdAt")).toBe(false);
    // The window normalizes exactly like the participant lists' clamp.
    expect(repoSource.includes("MAX_PAGE_SIZE = 50")).toBe(true);
    expect(repoSource.includes("DEFAULT_PAGE_SIZE = 25")).toBe(true);
    // Deep pagination is ceilinged: the resolved offset is capped before
    // any database work (a page past the scan ceiling answers the empty
    // window — the hostile OFFSET never reaches SQL).
    expect(repoSource.includes("MAX_DIRECTORY_SCAN_ROWS = 10_000")).toBe(true);
    expect(repoSource.includes("resolvedOffset > MAX_DIRECTORY_SCAN_ROWS")).toBe(true);
  });

  test("source: the badge flag is a pure presentation projection", () => {
    // Definition + exactly one call site (the page projection).
    expect(repoSource.match(/isNeedsAttention\(/g)?.length ?? 0).toBe(2);
    expect(repoSource.includes("function isNeedsAttention(")).toBe(true);
    // The flag derives from the deadline and the status vocabulary only —
    // the projection body carries no authorization-bearing vocabulary.
    expect(repoSource.includes("row.status === DISPUTED_STATUS")).toBe(true);
    expect(repoSource.includes("(row.status === SCHEDULED_STATUS && deadlineLapsed)")).toBe(true);
  });
});

/**
 * Standalone executor branches — the `queryDb` directory/detail reads and
 * the `tx ?? db` guard fallback. These branches run WITHOUT a transaction by
 * definition, so their fixtures must be COMMITTED (an uncommitted row is
 * invisible to the pool path). The fixture commitment runs FIRST (bun runs
 * tests in declaration order); every fixture is registered here and
 * hard-deleted in `afterAll` (rule 9) in FK-dependency order (sessions
 * first — the teacher/student FKs are restrict-bound while sessions
 * reference them).
 */
describe("SessionRepository — admin standalone executor paths (committed fixtures)", () => {
  const committedSessionIds: number[] = [];
  const committedUserIds: number[] = [];
  let actorsA: SessionActors = { teacherUserId: 0, studentUserId: 0 };
  let actorsB: SessionActors = { teacherUserId: 0, studentUserId: 0 };
  let completedRowId = 0;
  let scheduledRowId = 0;
  let browseTargetId = 0;
  let rescheduleTargetId = 0;
  let cancelTargetId = 0;
  let reassignTargetId = 0;

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

  test("the standalone fixtures are committed first (pool-visible rows)", async () => {
    await db.transaction(async tx => {
      actorsA = await createSessionActors(tx);
      actorsB = await createSessionActors(tx);
      committedUserIds.push(actorsA.teacherUserId, actorsA.studentUserId, actorsB.teacherUserId, actorsB.studentUserId);
      // Future stamps keep my rows at the head of the shared table's list.
      const now = Date.now();
      completedRowId = (await insertSessionRow(tx, actorsA, { createdAt: new Date(now + 3 * 3_600_000) })).id;
      scheduledRowId = (await insertSessionRow(tx, actorsA, { createdAt: new Date(now + 2 * 3_600_000) })).id;
      browseTargetId = (await insertSessionRow(tx, actorsA, { createdAt: new Date(now + 3_600_000) })).id;
      rescheduleTargetId = (await insertSessionRow(tx, actorsA)).id;
      cancelTargetId = (await insertSessionRow(tx, actorsA)).id;
      reassignTargetId = (await insertSessionRow(tx, actorsA)).id;
      committedSessionIds.push(
        completedRowId,
        scheduledRowId,
        browseTargetId,
        rescheduleTargetId,
        cancelTargetId,
        reassignTargetId
      );
    });
    // The completed fixture is driven through the guarded transitions on
    // the pool path (start, then complete — completion requires started).
    await SessionRepository.startSessionOnce(completedRowId, actorsA.teacherUserId);
    await SessionRepository.completeSessionOnce(completedRowId, actorsA.teacherUserId);

    expect(completedRowId).toBeGreaterThan(0);
    expect(scheduledRowId).toBeGreaterThan(0);
    expect(browseTargetId).toBeGreaterThan(0);
    expect(rescheduleTargetId).toBeGreaterThan(0);
    expect(cancelTargetId).toBeGreaterThan(0);
    expect(reassignTargetId).toBeGreaterThan(0);
  });

  test("the directory and browse reads run standalone (queryDb path)", async () => {
    // Unfiltered standalone read — renders WITHOUT a WHERE clause.
    const unfiltered = await SessionRepository.listForAdmin({}, 1, 50);
    expect(unfiltered.rows.map(row => row.id).slice(0, 3)).toEqual([completedRowId, scheduledRowId, browseTargetId]);
    expect(typeof unfiltered.total).toBe("number");

    // Filtered standalone read — renders the shared predicate to
    // parameterized SQL; list and total stay coherent.
    const filtered = await SessionRepository.listForAdmin({ status: SessionStatus.Completed }, 1, 50);
    expect(filtered.rows.map(row => row.id)).toContain(completedRowId);
    expect(filtered.rows.map(row => row.id)).not.toContain(scheduledRowId);
    const filteredHead = filtered.rows.find(row => row.id === completedRowId);
    expect(filteredHead?.status).toBe(SessionStatus.Completed);
    expect(filtered.total).toBeGreaterThanOrEqual(1);

    // The badge projection rides the standalone branch identically.
    const completedHead = unfiltered.rows.find(row => row.id === completedRowId);
    expect(completedHead?.needsAttention).toBe(false);

    // Browse read: any committed state by id, unknown id → null.
    const browsed = await SessionRepository.getAnyByIdForAdmin(browseTargetId);
    expect(browsed?.id).toBe(browseTargetId);
    expect(await SessionRepository.getAnyByIdForAdmin(browseTargetId + 1_000_000)).toBeNull();
  });

  test("the three guards run on the pool fallback (tx ?? db write branch)", async () => {
    const nextStart = alignedInstant(3_600_000);
    const nextEnd = alignedInstant(4 * 3_600_000);

    const rescheduled = await SessionRepository.guardReschedule(rescheduleTargetId, nextStart, nextEnd);
    expect(rescheduled).not.toBeNull();
    expect(rescheduled?.startedAt?.getTime()).toBe(nextStart.getTime());
    expect(rescheduled?.endedAt?.getTime()).toBe(nextEnd.getTime());
    expect(rescheduled?.status).toBe(SessionStatus.Scheduled);

    const cancelled = await SessionRepository.guardCancelPreTerminal(cancelTargetId);
    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe(SessionStatus.Cancelled);
    // The participant-cancel terminal shape on the pool branch too: the
    // marker is cleared, the lane stays for the caller's refund composition.
    expect(cancelled?.feeHeld).toBe(false);

    const reassigned = await SessionRepository.guardReassignTeacher(reassignTargetId, actorsB.teacherUserId);
    expect(reassigned).not.toBeNull();
    expect(reassigned?.teacherId).toBe(actorsB.teacherUserId);
    expect(reassigned?.status).toBe(SessionStatus.Scheduled);

    // The pool-fallback miss branch: unknown id → null, no throw.
    const missingId = reassignTargetId + 1_000_000;
    expect(await SessionRepository.guardReschedule(missingId, nextStart, nextEnd)).toBeNull();
    expect(await SessionRepository.guardCancelPreTerminal(missingId)).toBeNull();
    expect(await SessionRepository.guardReassignTeacher(missingId, actorsB.teacherUserId)).toBeNull();
  });
});
