/**
 * EvaluationRepository — data-access layer for the `evaluations` table.
 *
 * An evaluation is a write-once score record shared by two flows: the
 * certified evaluator's rubric scoring of a teacher applicant on their own
 * booked, completed `teacher_evaluation` session (session-linked: `session_id`
 * set, `evaluated_id` = the applicant, an optional `weakness_area` when the
 * score is below the pass threshold) and the student→teacher session rating
 * (`session_id` set, `score` on the table's 0-100 scale the rating flow maps
 * from whole stars, `weakness_area` never recorded). At most one row may
 * exist per (session_id, evaluator_id) pair: the table's
 * `evaluations_session_evaluator_unique` arbiter rejects duplicates with a
 * raw `23505` unique violation, so a pre-check INSERT guard would be a
 * pointless TOCTOU window. NULL `session_id` values are treated as
 * distinct by PostgreSQL unique semantics, so legacy NULL-session rows
 * never collide.
 *
 * Conventions per `backend/db/repo/AGENTS.md`:
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Writes take a REQUIRED `tx: DBTransaction` (last parameter) — they
 *    always join the caller's atomic unit of work and never fall back to
 *    the global handle. The insert payload is typed field-by-field (the
 *    six meaningful columns; schema defaults fill the rest).
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
 *  - Soft-delete is exclusion-only for the listing and aggregate reads:
 *    live rows are those whose `is_deleted` flag is false OR null (only an
 *    explicit deleted flag excludes — the same NULL-safe rule the platform
 *    analytics readers apply). The (session, evaluator) pair read
 *    deliberately does NOT filter the flag — the unique arbiter sees
 *    soft-deleted rows too (a deleted row still holds its slot), so the
 *    pair read must observe exactly what a colliding insert would hit.
 *    The `listCycleRubricSubmissions` quorum read likewise deliberately
 *    does NOT filter the flag — a soft-deleted row still holds its unique
 *    (session, evaluator) slot, so it must stay aggregable for the count.
 *  - `listCycleRubricSubmissions` is the rubric quorum read: the scored
 *    submissions linked to an applicant's completed evaluation sessions
 *    inside a half-open creation window (the same cycle shape the booking
 *    aggregate uses). It returns the sealed projection the caller derives
 *    the verdict from — never raw rows.
 *  - No prepared statements: the non-transactional read branch runs
 *    through `queryDb`, and the write is always transactional. No
 *    array-membership operators, no SQL line-comment sequences.
 *  - No business logic, no permission checks, no i18n or logging imports —
 *    the caller decides what an empty list or a raw constraint error
 *    means.
 */
import { and, asc, desc, eq, gte, isNotNull, isNull, or, sql } from "drizzle-orm";
import { queryDb } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { evaluations } from "@/backend/db/schema/teachers/evaluations";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { isRubricWeaknessArea, type RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import type {
  DBQueryExecutor,
  DBTransaction,
  EvaluationInsertType,
  EvaluationRatingAggregateType,
  EvaluationSelectType,
  RubricCycleSubmissionRow,
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

/**
 * Maps the `rubric_weakness_area` pgEnum's raw stored value onto the
 * canonical TS enum through the vocabulary's fail-closed guard — a total
 * map over the two-member vocabulary, so the raw string union never leaks
 * into the typed read-model and a foreign stored value degrades to null
 * instead of fabricating a member. NULL (the student-rating shape, which
 * never records a weakness) passes through as null.
 */
function toWeaknessAreaMember(value: "tajweed" | "hifz" | null): RubricWeaknessArea | null {
  if (isRubricWeaknessArea(value)) {
    return value;
  }
  return null;
}

export namespace EvaluationRepository {
  /**
   * Inserts one `evaluations` row and returns it (`INSERT … RETURNING`).
   *
   * The caller supplies exactly the meaningful columns — the rated
   * subject, the rater, the optional session link, and the score on the
   * table's 0-100 scale (the rating flow's star-to-score conversion
   * happens upstream; this method stores the value verbatim) — plus the
   * two rubric-only members: the free-text observations and the failure
   * area. Both are optional in the insert type: the rubric flow supplies
   * notes always and the weakness area exactly when the score is below
   * the pass threshold, while the rating flow omits both and the schema
   * defaults store NULL. A (session_id, evaluator_id) pair that already
   * carries a row makes the statement fail with the raw `23505` unique
   * violation on `evaluations_session_evaluator_unique` — the database is
   * the write-once arbiter, and the error is NOT caught or translated
   * here (mapping it into a domain conflict is the service layer's
   * decision).
   *
   * @returns The inserted row with all server-generated columns populated.
   */
  export async function insertOnce(
    values: Pick<
      EvaluationInsertType,
      "evaluatedId" | "evaluatorId" | "sessionId" | "score" | "notes" | "weaknessArea"
    >,
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
              weakness_area AS "weaknessArea",
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

  /**
   * Reads the ONE evaluation row a (session, evaluator) pair can carry —
   * a single indexed probe over the `evaluations_session_evaluator_unique`
   * columns. The caller (the rubric submission flow) uses it as the
   * duplicate PRE-CHECK: an optimization on the common path only, because
   * the unique index itself stays the write-once arbiter for the race a
   * pre-check can never close.
   *
   * The read deliberately does NOT filter the soft-delete flag: the unique
   * index sees soft-deleted rows too (a deleted row still holds its
   * (session_id, evaluator_id) slot), so the pre-check must observe
   * exactly the set of rows a colliding insert would hit — filtering here
   * would let the caller walk into a guaranteed `23505`.
   *
   * `tx` is REQUIRED: the check runs inside the caller's submission
   * transaction, so it observes that transaction's own uncommitted writes.
   *
   * @returns The pair's row (any soft-delete state), or `null` when the
   *          pair has none.
   */
  export async function findBySessionAndEvaluator(
    sessionId: number,
    evaluatorId: number,
    tx: DBTransaction
  ): Promise<EvaluationSelectType | null> {
    const rows = await tx
      .select()
      .from(evaluations)
      .where(and(eq(evaluations.sessionId, sessionId), eq(evaluations.evaluatorId, evaluatorId)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Reads the scored rubric submissions of one teacher applicant's current
   * cycle: `evaluations` rows INNER JOINed to their sessions on the session
   * link, filtered to the applicant on BOTH legs — the session's student
   * leg AND the evaluation row's own evaluated-subject leg, so a scored row
   * that reaches the join through the applicant's session but was evaluated
   * for someone else is never aggregable — plus the
   * teacher-evaluation session type, the completed lifecycle state, a
   * non-null score (an unscored row is not aggregable), and the half-open
   * creation window `created_at >= cycleStart` (prior-cycle rows created
   * history, not this cycle's quorum). The (session_id, evaluator_id)
   * unique arbiter makes every returned row a distinct session/evaluator
   * pair by construction. The projection is the sealed quorum shape — the
   * `session_id` leg is selected off the joined session (the INNER JOIN
   * equates the two, and the session side is NOT NULL) and the `score`
   * non-null guarantee the WHERE predicate provides is asserted on the
   * projection, never by a post-read rewrite. The order is
   * `created_at ASC, id ASC` — earliest submission first, the
   * deterministic order a failure-area tie-break consumes.
   *
   * `tx` is REQUIRED: the quorum count runs under the caller's applicant
   * row lock inside the submission transaction, so a rival evaluator's
   * committed submission is visible before the caller decides whether the
   * quorum has fired.
   *
   * @returns The cycle's scored submissions, earliest first; empty when
   *          the cycle holds none (the caller owns the verdict logic).
   */
  export async function listCycleRubricSubmissions(
    applicantUserId: number,
    cycleStart: Date,
    tx: DBTransaction
  ): Promise<readonly RubricCycleSubmissionRow[]> {
    const rows = await tx
      .select({
        id: evaluations.id,
        sessionId: session.id,
        evaluatorId: evaluations.evaluatorId,
        score: sql<number>`${evaluations.score}`,
        weaknessArea: evaluations.weaknessArea,
        createdAt: evaluations.createdAt,
      })
      .from(evaluations)
      .innerJoin(session, eq(evaluations.sessionId, session.id))
      .where(
        and(
          eq(session.studentId, applicantUserId),
          eq(evaluations.evaluatedId, applicantUserId),
          eq(session.sessionType, SessionType.TeacherEvaluation),
          eq(session.status, SessionStatus.Completed),
          isNotNull(evaluations.score),
          gte(session.createdAt, cycleStart)
        )
      )
      .orderBy(asc(evaluations.createdAt), asc(evaluations.id));
    return rows.map(row => ({
      id: row.id,
      sessionId: row.sessionId,
      evaluatorId: row.evaluatorId,
      score: row.score,
      weaknessArea: toWeaknessAreaMember(row.weaknessArea),
      createdAt: row.createdAt,
    }));
  }
}
