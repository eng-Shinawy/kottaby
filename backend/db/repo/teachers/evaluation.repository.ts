/**
 * EvaluationRepository — data-access layer for the `evaluations` table.
 *
 * An evaluation is a write-once score record shared by two flows: the
 * certified-sheikh evaluation of a teacher applicant (`session_id` NULL)
 * and the student→teacher session rating (`session_id` set, `score` on the
 * table's 0-100 scale the rating flow maps from whole stars). At most one
 * row may exist per (session_id, evaluator_id) pair: the table's
 * `evaluations_session_evaluator_unique` arbiter rejects duplicates with a
 * raw `23505` unique violation, so a pre-check INSERT guard would be a
 * pointless TOCTOU window. NULL `session_id` values are treated as
 * distinct by PostgreSQL unique semantics, so applicant evaluations never
 * collide.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Writes take a REQUIRED `tx: DBTransaction` (last parameter) — they
 *    always join the caller's atomic unit of work and never fall back to
 *    the global handle. The insert payload is typed field-by-field (the
 *    four meaningful columns; schema defaults fill the rest).
 *  - Reads run on the caller's transaction (Drizzle select) when one is
 *    supplied and fall back to raw parameterized SQL via `queryDb` (the
 *    Neon-HTTP-eligible pattern) otherwise. In `listByEvaluator`, the
 *    read is caller-scoped: the evaluator id is the ONLY filter — no
 *    parameter exists through which a caller could widen the read toward
 *    other evaluators or a chosen rated subject.
 *  - `aggregateLiveRatings` is the one exception to the dual-branch read
 *    convention: a single-row SQL-template aggregate over a rated
 *    subject's LIVE student-rating family (session-linked, scored,
 *    non-deleted rows), keyed by the evaluated subject id. It takes a
 *    REQUIRED `tx` because its result feeds the caller's same-transaction
 *    write of that result — a standalone branch could read a different
 *    snapshot than the write commits against. The mean is computed in
 *    SQL (never by materializing rows and reducing them client-side) and
 *    cast `::float8`, the count `::int`, so both arrive as JavaScript
 *    numbers — a bare `numeric` mean reaches the driver as a string.
 *  - Soft-delete is exclusion-only: live rows are those whose
 *    `is_deleted` flag is false OR null (only an explicit deleted flag
 *    excludes — the same NULL-safe rule the platform analytics readers
 *    apply).
 *  - No prepared statements: the non-transactional read branch runs
 *    through `queryDb`, and the write is always transactional. No
 *    array-membership operators, no SQL line-comment sequences.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what an empty list or a raw constraint error
 *    means.
 */
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import type {
  DBQueryExecutor,
  DBTransaction,
  EvaluationInsertType,
  EvaluationRatingAggregateType,
  EvaluationSelectType,
} from "@/backend/types";

/**
 * Type guard — narrows `DBQueryExecutor` to `DBTransaction`.
 *
 * `DBTransaction` (Drizzle's transaction object) exposes the `.select()`
 * builder API; raw `Pool` / `PoolClient` from `pg` do not. The presence of
 * `.select` therefore distinguishes the two at runtime without an unsafe
 * cast.
 */
function isDBTransaction(tx: DBQueryExecutor): tx is DBTransaction {
  return typeof tx === "object" && "select" in tx;
}

export namespace EvaluationRepository {
  /**
   * Inserts one `evaluations` row and returns it (`INSERT … RETURNING`).
   *
   * The caller supplies exactly the four meaningful columns — the rated
   * subject, the rater, the optional session link, and the score on the
   * table's 0-100 scale (the rating flow's star-to-score conversion
   * happens upstream; this method stores the value verbatim). Schema
   * defaults fill the soft-delete pair, the notes column, and the
   * timestamps. A (session_id, evaluator_id) pair that already carries a
   * row makes the statement fail with the raw `23505` unique violation on
   * `evaluations_session_evaluator_unique` — the database is the
   * write-once arbiter, and the error is NOT caught or translated here
   * (mapping it into a domain conflict is the service layer's decision).
   *
   * @returns The inserted row with all server-generated columns populated.
   */
  export async function insertOnce(
    values: Pick<EvaluationInsertType, "evaluatedId" | "evaluatorId" | "sessionId" | "score">,
    tx: DBTransaction
  ): Promise<EvaluationSelectType> {
    const [row] = await tx.insert(evaluations).values(values).returning();
    if (!row) {
      throw new Error("EvaluationRepository.insertOnce: insert returned no rows");
    }
    return row;
  }

  /**
   * Lists one evaluator's own evaluation rows, newest first.
   *
   * Read-only: on the caller's transaction it runs as a Drizzle select;
   * standalone (or on a raw pool/client executor) it runs as raw
   * parameterized SQL via `queryDb` — the evaluator id and the live-row
   * flag ride bound parameters. The read is caller-scoped: the evaluator
   * id is the only filter, so the result is exactly the caller's own
   * rating history and nothing else. Soft-deleted rows are excluded
   * NULL-safely (only an explicit deleted flag excludes), and the order
   * is `created_at DESC, id DESC` — the id breaks ties between rows
   * created in the same instant.
   *
   * @returns The live rows, newest first; empty when the evaluator has
   *          none (the caller owns any not-found semantics).
   */
  export async function listByEvaluator(
    evaluatorId: number,
    tx?: DBQueryExecutor
  ): Promise<readonly EvaluationSelectType[]> {
    if (tx && isDBTransaction(tx)) {
      return tx
        .select()
        .from(evaluations)
        .where(
          and(
            eq(evaluations.evaluatorId, evaluatorId),
            or(eq(evaluations.isDeleted, false), isNull(evaluations.isDeleted))
          )
        )
        .orderBy(desc(evaluations.createdAt), desc(evaluations.id));
    }
    const result = await queryDb<EvaluationSelectType>(
      `SELECT id, evaluated_id AS "evaluatedId", evaluator_id AS "evaluatorId",
              session_id AS "sessionId", score, notes,
              is_deleted AS "isDeleted", deleted_at AS "deletedAt",
              created_at AS "createdAt", updated_at AS "updatedAt"
         FROM evaluations
        WHERE evaluator_id = $1
          AND coalesce(is_deleted, false) = $2
        ORDER BY created_at DESC, id DESC`,
      [evaluatorId, false]
    );
    return result.rows;
  }

  /**
   * Aggregates one rated subject's LIVE student-rating family into a
   * single row: `averageScore` is the SQL mean of `score` over the family
   * on the table's 0-100 scale, `ratingCount` the sample size behind it.
   *
   * The family is exactly the rows with `evaluated_id` = the subject, a
   * session link (applicant evaluations are the other flow on the shared
   * table), a non-null score, and no explicit deleted flag (NULL-safe
   * exclusion) — the score filter keeps the mean and the count agreeing
   * on the same family. The mean is computed in SQL, never by
   * materializing rows into the caller and reducing them there, and is
   * cast `::float8` so it arrives as a JavaScript number: Drizzle `sql`
   * templates bypass column mappers and a bare `numeric` mean reaches the
   * driver as a string, contradicting the projection.
   *
   * `tx` is REQUIRED (no standalone branch): the result feeds the
   * caller's same-transaction write of this value, so a read from any
   * other executor could observe a different snapshot than the write
   * commits against.
   *
   * @returns The aggregate; an empty family yields
   *          `{ averageScore: null, ratingCount: 0 }` — SQL `avg` over
   *          zero rows is NULL and `count(*)` is 0, an honest null rather
   *          than a fabricated value.
   */
  export async function aggregateLiveRatings(
    evaluatedId: number,
    tx: DBTransaction
  ): Promise<EvaluationRatingAggregateType> {
    const [row] = await tx
      .select({
        averageScore: sql<number | null>`avg(${evaluations.score})::float8`.as("average_score"),
        ratingCount: sql<number>`count(*)::int`.as("rating_count"),
      })
      .from(evaluations)
      .where(
        and(
          eq(evaluations.evaluatedId, evaluatedId),
          isNotNull(evaluations.sessionId),
          isNotNull(evaluations.score),
          or(eq(evaluations.isDeleted, false), isNull(evaluations.isDeleted))
        )
      );
    return {
      averageScore: row?.averageScore ?? null,
      ratingCount: row?.ratingCount ?? 0,
    };
  }
}
