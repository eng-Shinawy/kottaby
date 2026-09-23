/**
 * ProgressRepository — data-access layer for the `progress` table.
 *
 * The `progress` table tracks a student's progression through lessons:
 * each row is a (student, lesson) pair with creation and update
 * timestamps. The table carries no `completed_at` or `score` columns
 * today — it is a skeleton whose writers and richer readers land in
 * later curriculum tickets. The parent-portal progress surface renders
 * an honest row count from this table plus the latest homework position
 * per track (read through `HomeWorkRepository.findLatestByStudentId`)
 * as the curriculum-position indicator; deep traversal stats are
 * deferred to a future curriculum ticket.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx` as its LAST parameter. Reads run on the
 *    caller's executor when one is supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise.
 *  - No prepared statements: the non-transactional read branch runs
 *    through `queryDb` (Neon HTTP), which excludes module-level
 *    prepared statements (`docs/drizzle/prepared-statements.md`). No
 *    array-membership operators, no SQL line-comment sequences.
 *  - No business logic, no permission checks, no i18n or logging
 *    imports — the caller decides what a count of zero means.
 */
import { eq, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { progress } from "@/backend/db/schema/classes/progress";
import type { DBQueryExecutor, DBTransaction } from "@/backend/types";

/** Type guard — narrows `DBQueryExecutor` to `DBTransaction`. */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

export namespace ProgressRepository {
  /**
   * Counts the `progress` rows belonging to one student by the
   * `student_id` equality predicate. The portal's progress surface
   * renders this count as an honest signal: `0` means "no recorded
   * progress yet" — never a fabricated percentage. Rides the
   * `progress_student_id_idx` index for the equality scan.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle count
   * select; standalone it runs as raw parameterized SQL via `queryDb`
   * (the student id rides a bound parameter). The count is mapped to a
   * JavaScript number on both branches — Drizzle's `.mapWith(Number)`
   * on the transactional branch and `Number(...)` on the raw-SQL branch
   * — so callers always receive a `number` regardless of PostgreSQL's
   * bigint-as-string default for `count(*)`.
   *
   * @returns The row count. Zero when the student has no progress rows
   *          or the student id is unknown — the caller classifies the
   *          miss; the repository raises nothing.
   */
  export async function countForStudent(studentId: number, tx?: DBQueryExecutor): Promise<number> {
    if (tx && isDBTransaction(tx)) {
      const rows = await tx
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(progress)
        .where(eq(progress.studentId, studentId));
      return rows[0]?.count ?? 0;
    }
    if (tx) {
      // Pool / PoolClient executor — run the raw SQL through the SUPPLIED
      // executor so the count shares the caller's connection (and, inside
      // an explicit transaction, its snapshot). `queryDb` would route the
      // count through the global pool and could observe a different
      // snapshot than the caller's other reads.
      const result = await tx.query<{ count: string | number }>(
        `SELECT count(*) AS count FROM progress WHERE student_id = $1`,
        [studentId]
      );
      return Number(result.rows[0]?.count ?? 0);
    }
    const result = await queryDb<{ count: string | number }>(
      `SELECT count(*) AS count FROM progress WHERE student_id = $1`,
      [studentId]
    );
    return Number(result.rows[0]?.count ?? 0);
  }
}
