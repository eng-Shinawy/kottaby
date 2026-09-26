/**
 * ProgressRepository — data-access layer for the `progress` table.
 *
 * The `progress` table tracks a student's progression through lessons.
 * Its curriculum contract is a pointer row: at most one row per
 * (student, governing plan) whose `lesson_id` IS the student's current
 * lesson in that plan's `id ASC` sequence — created lazily on the
 * student's first completed session and advanced by the settlement
 * path, which owns the write discipline (the serialization lock and the
 * next-lesson computation are the caller's decisions; this repository
 * only reads and writes rows). The parent-portal progress surface
 * renders an honest row count from this table plus the latest homework
 * position per track (read through
 * `HomeWorkRepository.findLatestByStudentId`) as the curriculum-position
 * indicator; deep traversal stats are deferred to a future curriculum
 * ticket.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx` as its LAST parameter. Reads run on the
 *    caller's executor when one is supplied and fall back to raw
 *    parameterized SQL via `queryDb` (the Neon-HTTP-eligible pattern)
 *    otherwise. The write methods take a REQUIRED `tx: DBTransaction` —
 *    a write only ever rides the caller's transaction, and it throws on
 *    genuine failures (constraint violations, connection loss) so the
 *    caller fails closed; the caller decides what a miss means.
 *  - No prepared statements: the non-transactional read branch runs
 *    through `queryDb` (Neon HTTP), which excludes module-level
 *    prepared statements (`docs/drizzle/prepared-statements.md`). No
 *    array-membership operators, no SQL line-comment sequences.
 *  - No business logic, no permission checks, no i18n or logging
 *    imports — the caller decides what a count of zero means.
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import { ConflictError } from "@/backend/lib/errors";
import type { DBQueryExecutor, DBTransaction, ProgressInsertType, ProgressSelectType } from "@/backend/types";

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

  /**
   * Reads the student's pointer row for ONE plan: the newest `progress`
   * row whose `lesson_id` still belongs to that plan's curriculum. The
   * INNER JOIN folds the plan scoping into the ON clause, so a row whose
   * lesson moved to another plan — or whose lesson was deleted
   * (`lesson_id` set NULL) — is invisible here and reads as no-row: the
   * caller treats that miss as a fresh-start signal, not an error.
   * Newest-first ordering (`id DESC`) is the deterministic answer when a
   * legacy student ever holds more than one matching row.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle join
   * select; standalone it runs as raw parameterized SQL via `queryDb`
   * (both ids ride bound parameters).
   *
   * @returns The pointer row, or `null` when the student holds no row
   *          the plan can claim.
   */
  export async function findRowForStudentPlan(
    studentId: number,
    planId: number,
    tx?: DBQueryExecutor
  ): Promise<ProgressSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle join on the supplied executor.
      const rows = await tx
        .select({
          id: progress.id,
          studentId: progress.studentId,
          lessonId: progress.lessonId,
          createdAt: progress.createdAt,
          updatedAt: progress.updatedAt,
        })
        .from(progress)
        .innerJoin(lessons, and(eq(progress.lessonId, lessons.id), eq(lessons.planId, planId)))
        .where(eq(progress.studentId, studentId))
        .orderBy(desc(progress.id))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<ProgressSelectType>(
      `SELECT progress.id, progress.student_id AS "studentId", progress.lesson_id AS "lessonId",
              progress.created_at AS "createdAt", progress.updated_at AS "updatedAt"
       FROM progress
       INNER JOIN lessons ON lessons.id = progress.lesson_id AND lessons.plan_id = $2
       WHERE progress.student_id = $1
       ORDER BY progress.id DESC
       LIMIT 1`,
      [studentId, planId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * The re-anchor probe: reads the student's newest UNATTRIBUTABLE pointer
   * row — the row an admin lesson delete leaves behind (`lesson_id` set
   * NULL by the FK's ON DELETE SET NULL contract). Such a row is invisible
   * to the plan-scoped `findRowForStudentPlan` join, so the increment
   * calls this when that read misses and re-anchors the returned row IN
   * PLACE instead of inserting a duplicate pointer beside it. Newest-first
   * ordering (`id DESC`) is the deterministic answer when a legacy student
   * ever holds more than one lesson-less row.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle select;
   * standalone it runs as raw parameterized SQL via `queryDb` (the
   * student id rides a bound parameter).
   *
   * @returns The lesson-less pointer row, or `null` when the student
   *          holds none — the caller classifies the miss; the repository
   *          raises nothing.
   */
  export async function findNullLessonRowForStudent(
    studentId: number,
    tx?: DBQueryExecutor
  ): Promise<ProgressSelectType | null> {
    if (tx && isDBTransaction(tx)) {
      // Transactional read — Drizzle select on the supplied executor.
      const rows = await tx
        .select({
          id: progress.id,
          studentId: progress.studentId,
          lessonId: progress.lessonId,
          createdAt: progress.createdAt,
          updatedAt: progress.updatedAt,
        })
        .from(progress)
        .where(and(eq(progress.studentId, studentId), isNull(progress.lessonId)))
        .orderBy(desc(progress.id))
        .limit(1);
      return rows[0] ?? null;
    }
    // Non-transactional read — raw SQL via queryDb (Neon HTTP fast path).
    const result = await queryDb<ProgressSelectType>(
      `SELECT progress.id, progress.student_id AS "studentId", progress.lesson_id AS "lessonId",
              progress.created_at AS "createdAt", progress.updated_at AS "updatedAt"
       FROM progress
       WHERE progress.student_id = $1 AND progress.lesson_id IS NULL
       ORDER BY progress.id DESC
       LIMIT 1`,
      [studentId]
    );
    return result.rows[0] ?? null;
  }

  /**
   * Inserts one `progress` row (the lazy first pointer write) in a single
   * INSERT … RETURNING on the caller's transaction. `tx` is REQUIRED —
   * the write only ever commits or rolls back together with the caller's
   * surrounding settlement work.
   *
   * @returns The inserted row with server defaults applied.
   * @throws The raw database failure when the insert cannot complete
   *         (an FK violation names the missing student/lesson) — the
   *         caller fails closed.
   * @throws ConflictError when the INSERT somehow returns no row — the
   *         append invariant makes that unreachable, so it can only mean
   *         a broken driver contract.
   */
  export async function insertRow(insert: ProgressInsertType, tx: DBTransaction): Promise<ProgressSelectType> {
    const [row] = await tx.insert(progress).values(insert).returning();
    if (!row) {
      throw new ConflictError("ProgressRepository.insertRow: insert returned no rows");
    }
    return row;
  }

  /**
   * Moves the pointer: sets `lesson_id` on exactly one row identified by
   * its primary key and stamps `updated_at` from one captured instant —
   * no other column is in the SET clause, so a caller-supplied extra
   * field has nowhere to land.
   *
   * @returns The updated row, or `null` when zero rows matched (the row
   *          vanished mid-transaction — the caller classifies the miss;
   *          the settlement caller logs it as the unreachable
   *          `pointer-row-missing-on-update` domain error rather than
   *          throwing, since the miss cannot fire under the student-row
   *          lock).
   */
  export async function updateRowLesson(
    id: number,
    lessonId: number,
    tx: DBTransaction
  ): Promise<ProgressSelectType | null> {
    const [row] = await tx
      .update(progress)
      .set({ lessonId, updatedAt: new Date() })
      .where(eq(progress.id, id))
      .returning();
    return row ?? null;
  }
}
