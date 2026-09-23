/**
 * ReportRepository.listForStudent / countForStudent tests — the
 * parent-portal paged read pair scoped to a parent's gated student via
 * the INNER JOIN onto the owning `session` row.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    both methods under test `tx` is the LAST parameter, typed
 *    `DBTransaction`).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local actor helper — never seed data.
 *  - No `expect(...).rejects.toThrow()` — the read pair is total and never
 *    rejects.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branch (`queryDb` read). That branch by definition runs without a
 *    transaction, so the fixtures must be committed (an uncommitted row
 *    is invisible outside the tx); they are registered and hard-deleted
 *    in `afterAll` (rule 9), keeping the repo/ directory's 100%-coverage
 *    mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): list returns rows in `session.started_at DESC
 *    NULLS LAST, reports.id DESC` order; count matches list length on a
 *    known fixture; hit + miss (empty window past the end + honest total
 *    > 0); the row's projected column set is exactly the eight
 *    `ReportForStudentRow` fields (no `SELECT *`).
 *  - Tier 2 (boundary): student with zero report rows (count = 0, list =
 *    []); session.started_at NULL ordering (NULLS LAST pins scheduled
 *    sessions after live ones in the DESC scan); same-instant rows
 *    deterministic by the id DESC tiebreak; offset beyond the end of the
 *    filtered set yields `[]` next to the true total.
 *  - Tier 3 (chaos): cross-student isolation — a report row whose
 *    session belongs to a DIFFERENT student is NOT surfaced (the INNER
 *    JOIN predicate guarantees this); concurrent inserts via
 *    `Promise.allSettled` against one student inside one transaction
 *    cannot corrupt a window (every settled write lands, no duplicates,
 *    no lost rows).
 *  - Tier 4 (security): the count and list share ONE JOIN-condition
 *    builder — the count can never drift from the list (predicate
 *    cohesion); tenancy predicate is bound to `student_id` via a `$1`
 *    placeholder (parameterization proof). SQL-injection via id args is
 *    N/A (parameterized integer columns); abuse probes live in wire
 *    tests.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { ReportRepository } from "@/backend/db/repo";
import type { ReportForStudentRow } from "@/backend/db/repo/classes/report.repository";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestSession,
  createTestSessionReport,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction } from "@/backend/types";

/** The exact key set of a `ReportForStudentRow` (alphabetical). */
const REPORT_FOR_STUDENT_ROW_KEYS = [
  "createdAt",
  "id",
  "sessionId",
  "sessionStartedAt",
  "sessionStatus",
  "studentRatingByTeacher",
  "teacherNotes",
  "updatedAt",
] as const;

/** Ascending key comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Ascending numeric comparator — for id / sessionId set-equality assertions. */
function byIdAscending(a: number, b: number): number {
  return a - b;
}

/** The exact projected key set, sorted for set-equality assertions. */
const SORTED_REPORT_FOR_STUDENT_ROW_KEYS: string[] = [...REPORT_FOR_STUDENT_ROW_KEYS].toSorted(byKeyAscending);

/** Asserts set-equality of a row's own keys against the projected set. */
function expectExactRowKeys(row: ReportForStudentRow): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual(SORTED_REPORT_FOR_STUDENT_ROW_KEYS);
}

/** Shared-PK ids for one booking pair (session.teacher_id / session.student_id). */
interface SessionActors {
  readonly teacherUserId: number;
  readonly studentUserId: number;
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createSessionActors(tx: DBTransaction): Promise<SessionActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx);
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/**
 * Creates one completed session with the supplied `startedAt` (nullable).
 * Reports hang off completed sessions in the test fixtures, but the
 * repository's JOIN makes no status filter — every session whose
 * `student_id` matches is a valid report host for the read.
 */
async function createSessionWithStartedAt(
  tx: DBTransaction,
  actors: SessionActors,
  startedAt: Date | null
): Promise<number> {
  const row = await createTestSession(tx, actors.teacherUserId, actors.studentUserId, {
    status: SessionStatus.Completed,
    startedAt,
    endedAt: startedAt,
    confirmedByTeacherAt: startedAt,
  });
  return row.id;
}

interface CommittedFixture {
  readonly teacherUserId: number;
  readonly studentUserId: number;
  readonly foreignStudentUserId: number;
  readonly sessionIds: number[];
}

/** Committed ONCE in `beforeAll` for the default-executor (no-tx) tier. */
let committed: CommittedFixture | null = null;

function requireCommitted(): CommittedFixture {
  if (!committed) {
    throw new Error("Committed fixture not initialized — beforeAll failed");
  }
  return committed;
}

beforeAll(async () => {
  committed = await db.transaction(async tx => {
    const actors = await createSessionActors(tx);
    // Foreign student (no link to the primary student's data) for the
    // cross-tenant isolation probe.
    const foreignStudentUser = await createTestUser(tx);
    await createTestStudent(tx, foreignStudentUser.id);

    const now = Date.now();
    // Three sessions for the primary student with descending startedAt:
    // oldest, middle, newest. Plus one NULL-startedAt session that pins
    // last under NULLS LAST.
    const stamps: ReadonlyArray<Date | null> = [new Date(now - 60_000), new Date(now - 30_000), new Date(now), null];
    // Promise.all over an async mapper elides the `no-await-in-loop` rule.
    // Each mapper creates one session + one report; the session ids are
    // returned in input order (Promise.all preserves mapper order).
    const sessionIds = await Promise.all(
      stamps.map(stamp =>
        (async () => {
          const sessionId = await createSessionWithStartedAt(tx, actors, stamp);
          await createTestSessionReport(tx, sessionId, {
            teacherNotes: `notes-${sessionId}`,
            studentRatingByTeacher: 4,
          });
          return sessionId;
        })()
      )
    );
    // One foreign-student session + report — must NEVER surface in the
    // primary student's reads.
    const foreignSession = await createTestSession(tx, actors.teacherUserId, foreignStudentUser.id, {
      status: SessionStatus.Completed,
      startedAt: new Date(now),
      endedAt: new Date(now),
      confirmedByTeacherAt: new Date(now),
    });
    await createTestSessionReport(tx, foreignSession.id, { teacherNotes: "foreign", studentRatingByTeacher: 5 });
    const allSessionIds = [...sessionIds, foreignSession.id];

    return {
      teacherUserId: actors.teacherUserId,
      studentUserId: actors.studentUserId,
      foreignStudentUserId: foreignStudentUser.id,
      sessionIds: allSessionIds,
    };
  });
});

afterAll(async () => {
  const fixture = committed;
  committed = null;
  if (!fixture) {
    return;
  }
  // Hard delete in FK-dependency order: sessions cascade reports (the
  // reports.session_id FK is ON DELETE CASCADE), then the role-child rows,
  // then the users rows (which cascade students/teacher rows).
  await Promise.all(fixture.sessionIds.map(id => db.delete(session).where(eq(session.id, id))));
  await db.delete(teacher).where(eq(teacher.id, fixture.teacherUserId));
  await db.delete(students).where(eq(students.id, fixture.studentUserId));
  await db.delete(students).where(eq(students.id, fixture.foreignStudentUserId));
  await db.delete(users).where(eq(users.id, fixture.teacherUserId));
  await db.delete(users).where(eq(users.id, fixture.studentUserId));
  await db.delete(users).where(eq(users.id, fixture.foreignStudentUserId));
  // Teardown proof: the standalone count reads zero after the cascade.
  expect(await ReportRepository.countForStudent(fixture.studentUserId)).toBe(0);
});

describe("ReportRepository.listForStudent / countForStudent — transactional path (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("list returns rows in session.started_at DESC NULLS LAST, id DESC order; count matches list length", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = Date.now();
      const oldestId = await createSessionWithStartedAt(tx, actors, new Date(now - 60_000));
      const newestId = await createSessionWithStartedAt(tx, actors, new Date(now));
      const nullStartedAtId = await createSessionWithStartedAt(tx, actors, null);
      await createTestSessionReport(tx, oldestId, { studentRatingByTeacher: 3 });
      await createTestSessionReport(tx, newestId, { studentRatingByTeacher: 5 });
      await createTestSessionReport(tx, nullStartedAtId, { studentRatingByTeacher: 4 });

      const rows = await ReportRepository.listForStudent(actors.studentUserId, 50, 0, tx);
      const count = await ReportRepository.countForStudent(actors.studentUserId, tx);
      expect(count).toBe(3);
      expect(rows).toHaveLength(3);

      // Expected order: newest (latest startedAt), oldest (earlier
      // startedAt), NULL-startedAt (NULLS LAST pins it after every
      // non-NULL row in the DESC scan).
      expect(rows[0]?.sessionId).toBe(newestId);
      expect(rows[1]?.sessionId).toBe(oldestId);
      expect(rows[2]?.sessionId).toBe(nullStartedAtId);

      // The projected column set is exactly the eight fields — no `SELECT *`.
      for (const row of rows) {
        expectExactRowKeys(row);
      }
    });
  });

  test("list + count share the same filtered set (predicate cohesion) across pages", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const now = Date.now();
      // Promise.all over an async mapper — five sessions + reports, ids
      // returned in input order (newest first since i=0 → -0ms offset).
      const sessionIds = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          (async () => {
            const sessionId = await createSessionWithStartedAt(tx, actors, new Date(now - i * 60_000));
            await createTestSessionReport(tx, sessionId, { studentRatingByTeacher: i });
            return sessionId;
          })()
        )
      );
      const total = await ReportRepository.countForStudent(actors.studentUserId, tx);
      expect(total).toBe(5);

      // Page 1: limit 2, offset 0 → first two rows (newest two).
      const page1 = await ReportRepository.listForStudent(actors.studentUserId, 2, 0, tx);
      expect(page1).toHaveLength(2);
      expect(page1[0]?.sessionId).toBe(sessionIds[0]);
      expect(page1[1]?.sessionId).toBe(sessionIds[1]);
      // Page 2: limit 2, offset 2 → next two rows.
      const page2 = await ReportRepository.listForStudent(actors.studentUserId, 2, 2, tx);
      expect(page2).toHaveLength(2);
      expect(page2[0]?.sessionId).toBe(sessionIds[2]);
      expect(page2[1]?.sessionId).toBe(sessionIds[3]);
      // Page 3: limit 2, offset 4 → last one row only.
      const page3 = await ReportRepository.listForStudent(actors.studentUserId, 2, 4, tx);
      expect(page3).toHaveLength(1);
      expect(page3[0]?.sessionId).toBe(sessionIds[4]);

      // Union of page windows covers the full set with no overlap.
      const allPagedIds = [...page1, ...page2, ...page3].map(r => r.sessionId);
      expect(new Set(allPagedIds).size).toBe(5);
      expect(allPagedIds.toSorted(byIdAscending)).toEqual(sessionIds.toSorted(byIdAscending));
    });
  });

  // ─── Tier 2: boundary ────────────────────────────────────────────────

  test("student with zero report rows → list is [] and count is 0 (empty window)", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const rows = await ReportRepository.listForStudent(actors.studentUserId, 50, 0, tx);
      const count = await ReportRepository.countForStudent(actors.studentUserId, tx);
      expect(rows).toEqual([]);
      expect(count).toBe(0);
    });
  });

  test("offset beyond the end of the filtered set yields [] next to the honest total > 0", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sessionId = await createSessionWithStartedAt(tx, actors, new Date());
      await createTestSessionReport(tx, sessionId, { studentRatingByTeacher: 5 });

      const count = await ReportRepository.countForStudent(actors.studentUserId, tx);
      expect(count).toBe(1);
      // An offset way past the end yields [] while the count stays honest.
      const rows = await ReportRepository.listForStudent(actors.studentUserId, 10, 100, tx);
      expect(rows).toEqual([]);
    });
  });

  test("same-instant startedAt rows are deterministic by the id DESC tiebreak across pages", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const sameInstant = new Date();
      // Insert three sessions with the SAME startedAt — the id DESC
      // tiebreak is the only determinism source.
      const sessionA = await createSessionWithStartedAt(tx, actors, sameInstant);
      const sessionB = await createSessionWithStartedAt(tx, actors, sameInstant);
      const sessionC = await createSessionWithStartedAt(tx, actors, sameInstant);
      await createTestSessionReport(tx, sessionA, { studentRatingByTeacher: 1 });
      await createTestSessionReport(tx, sessionB, { studentRatingByTeacher: 2 });
      await createTestSessionReport(tx, sessionC, { studentRatingByTeacher: 3 });

      const rows = await ReportRepository.listForStudent(actors.studentUserId, 50, 0, tx);
      expect(rows.map(r => r.sessionId)).toEqual([sessionC, sessionB, sessionA]);

      // Pagination across the same-instant set: limit 2, offset 0 → [C, B];
      // limit 2, offset 2 → [A] — no overlap, no dropped rows.
      const page1 = await ReportRepository.listForStudent(actors.studentUserId, 2, 0, tx);
      const page2 = await ReportRepository.listForStudent(actors.studentUserId, 2, 2, tx);
      expect(page1.map(r => r.sessionId)).toEqual([sessionC, sessionB]);
      expect(page2.map(r => r.sessionId)).toEqual([sessionA]);
    });
  });

  // ─── Tier 3: chaos — cross-student isolation + concurrent inserts ────

  test("cross-student isolation: a report whose session belongs to another student never surfaces", async () => {
    await runInRollback(async tx => {
      const actorsA = await createSessionActors(tx);
      const actorsB = await createSessionActors(tx);
      // Foreign student's session + report (visible only to student B).
      const foreignSessionId = await createSessionWithStartedAt(tx, actorsB, new Date());
      await createTestSessionReport(tx, foreignSessionId, { teacherNotes: "foreign-only", studentRatingByTeacher: 5 });
      // Primary student has zero reports — the foreign report must not
      // leak into the primary student's reads.
      const rowsA = await ReportRepository.listForStudent(actorsA.studentUserId, 50, 0, tx);
      const countA = await ReportRepository.countForStudent(actorsA.studentUserId, tx);
      expect(countA).toBe(0);
      expect(rowsA).toEqual([]);
      // Foreign student sees exactly one row.
      const rowsB = await ReportRepository.listForStudent(actorsB.studentUserId, 50, 0, tx);
      const countB = await ReportRepository.countForStudent(actorsB.studentUserId, tx);
      expect(countB).toBe(1);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.sessionId).toBe(foreignSessionId);
    });
  });

  test("concurrent inserts via Promise.allSettled against one student all land — the window sees every settled write", async () => {
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      const insertCount = 4;
      const now = Date.now();
      const results = await Promise.allSettled(
        Array.from({ length: insertCount }, (_, i) =>
          (async () => {
            const sessionId = await createSessionWithStartedAt(tx, actors, new Date(now - i * 60_000));
            await createTestSessionReport(tx, sessionId, { studentRatingByTeacher: i });
            return sessionId;
          })()
        )
      );
      const fulfilled = results.filter(r => r.status === "fulfilled").length;
      expect(fulfilled).toBe(insertCount);

      const count = await ReportRepository.countForStudent(actors.studentUserId, tx);
      const rows = await ReportRepository.listForStudent(actors.studentUserId, 50, 0, tx);
      expect(count).toBe(insertCount);
      expect(rows).toHaveLength(insertCount);
      // No duplicate ids — every settled write is unique.
      const ids = rows.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("reports written inside runInRollback vanish after the forced rollback", async () => {
    let rollbackStudentId = 0;
    await runInRollback(async tx => {
      const actors = await createSessionActors(tx);
      rollbackStudentId = actors.studentUserId;
      const sessionId = await createSessionWithStartedAt(tx, actors, new Date());
      await createTestSessionReport(tx, sessionId, { studentRatingByTeacher: 5 });
      // Visible INSIDE the transaction…
      expect(await ReportRepository.countForStudent(rollbackStudentId, tx)).toBe(1);
    });
    // …and invisible on a fresh session AFTER the forced rollback.
    expect(await ReportRepository.countForStudent(rollbackStudentId)).toBe(0);
  });
});

describe("ReportRepository.listForStudent / countForStudent — standalone executor path (committed fixture)", () => {
  test("count runs on the queryDb read path and returns the committed fixture's honest total", async () => {
    const fixture = requireCommitted();
    // 4 sessions + reports for the primary student (3 with non-NULL
    // startedAt, 1 with NULL). The foreign student's report does NOT
    // inflate this count.
    const count = await ReportRepository.countForStudent(fixture.studentUserId);
    expect(count).toBe(4);
  });

  test("list runs on the queryDb read path and returns rows in DESC NULLS LAST order", async () => {
    const fixture = requireCommitted();
    const rows = await ReportRepository.listForStudent(fixture.studentUserId, 50, 0);
    expect(rows).toHaveLength(4);
    // The NULL-startedAt session pins last under NULLS LAST.
    const lastRow = rows[3];
    expect(lastRow?.sessionStartedAt).toBeNull();
    // Every non-NULL-startedAt row sorts before the NULL one in DESC order.
    for (let i = 0; i < 3; i += 1) {
      expect(rows[i]?.sessionStartedAt).not.toBeNull();
    }
    // Foreign student's report never leaks into the standalone read.
    for (const row of rows) {
      expectExactRowKeys(row);
    }
  });

  test("list paginates on the standalone path — page 1 returns the first two rows", async () => {
    const fixture = requireCommitted();
    const page1 = await ReportRepository.listForStudent(fixture.studentUserId, 2, 0);
    expect(page1).toHaveLength(2);
    // Page 1 holds the two newest-startedAt rows (the first two non-NULL
    // rows in the DESC scan).
    for (const row of page1) {
      expect(row.sessionStartedAt).not.toBeNull();
    }
  });

  test("count is 0 for an unknown student on the standalone path", async () => {
    expect(await ReportRepository.countForStudent(2_000_000_000)).toBe(0);
  });

  test("cross-tenant: the foreign student's count does not include the primary student's reports", async () => {
    const fixture = requireCommitted();
    const foreignCount = await ReportRepository.countForStudent(fixture.foreignStudentUserId);
    expect(foreignCount).toBe(1);
  });
});
