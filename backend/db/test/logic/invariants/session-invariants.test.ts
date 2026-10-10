/**
 * Data-level residual probes for the session domain — homework cannot
 * exist without its session report.
 *
 * The report-then-homework composition is the only sanctioned way a
 * homework row enters the database: the homework insert runs inside the
 * report-submission transaction. This suite proves the data-level reading
 * of that composition — every `home_work` row joins to a matching
 * `reports` row through `session_id`, and the composition leaves zero
 * orphaned homework rows behind.
 *
 * The residual sweep is table-wide: a single report-less homework row
 * anywhere is a violation. The detector-liveness leg proves the sweep can
 * actually fire — the database tier itself has no cross-table guard, so
 * a raw report-less insert lands inside a savepoint bracket and is
 * rolled back, keeping the outer rolled-back transaction clean.
 *
 * The single-writer source pin and the database-tier constraint probes
 * (session_id NOT NULL/UNIQUE trips, grade CHECK trips) live in their
 * own co-located suites — this file carries only the cross-table
 * residual sweep.
 */
import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import {
  createTestHomeWork,
  createTestSession,
  createTestSessionReport,
  createTestStudent,
  createTestTeacherRow,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction } from "@/backend/types";

/** Savepoint bracket for the detector-liveness leg's report-less insert. */
const ORPHAN_DETECTOR_SAVEPOINT = "inv_s8_orphan_detector_probe";

/**
 * Counts homework rows with no matching report row through the
 * `session_id` join — the data-level residual of the report composition.
 */
async function orphanHomeWorkCount(tx: DBTransaction): Promise<number> {
  const result = await tx.execute(sql`
    SELECT count(*)::int AS orphan_count
    FROM home_work hw
    LEFT JOIN reports r ON r.session_id = hw.session_id
    WHERE r.id IS NULL
  `);
  return Number(result.rows[0]?.orphan_count ?? 0);
}

/**
 * Provisions a certified teacher and a student — the two participant rows
 * a session needs. Returns the ids a session row references
 * (`teachers.id` is the shared user PK).
 */
async function provisionSessionParticipants(tx: DBTransaction): Promise<{ teacherId: number; studentId: number }> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  const studentUser = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, studentUser.id);
  return { teacherId: teacherUser.id, studentId: student.id };
}

describe("session invariants — homework implies its session report", () => {
  test("INV-S8: every home_work row implies a matching reports row (LEFT JOIN zero probe)", async () => {
    await runInRollback(async tx => {
      const { teacherId, studentId } = await provisionSessionParticipants(tx);
      const now = new Date();

      // The sanctioned composition, in write order: a completed session,
      // its report, then the homework composed inside that submission.
      const completedSession = await createTestSession(tx, teacherId, studentId, {
        status: SessionStatus.Completed,
        startedAt: now,
        endedAt: now,
      });
      await createTestSessionReport(tx, completedSession.id);
      await createTestHomeWork(tx, completedSession.id);

      expect(await orphanHomeWorkCount(tx)).toBe(0);
    });
  });

  test("the residual sweep fires on a report-less homework row (savepoint-bracketed detector liveness)", async () => {
    await runInRollback(async tx => {
      const { teacherId, studentId } = await provisionSessionParticipants(tx);
      const unreportedSession = await createTestSession(tx, teacherId, studentId);

      expect(await orphanHomeWorkCount(tx)).toBe(0);

      await tx.execute(sql.raw(`savepoint ${ORPHAN_DETECTOR_SAVEPOINT}`));
      // Raw insert bypassing the report composition — the database tier has
      // no homework-to-report guard, so the row lands and the sweep must
      // see it.
      await tx.execute(sql`insert into home_work (session_id) values (${unreportedSession.id})`);
      expect(await orphanHomeWorkCount(tx)).toBe(1);

      await tx.execute(sql.raw(`rollback to savepoint ${ORPHAN_DETECTOR_SAVEPOINT}`));
      expect(await orphanHomeWorkCount(tx)).toBe(0);
    });
  });
});
