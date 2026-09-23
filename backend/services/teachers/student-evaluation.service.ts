/**
 * StudentEvaluationService — the student→teacher session rating and the
 * rater's own rating history.
 *
 * A session can be rated by its student exactly once, and only after the
 * session's completion handshake has finished: the row is `completed` AND
 * both confirmation stamps (`confirmed_by_teacher_at`,
 * `confirmed_by_student_at`) are set. Both properties are read through the
 * session repository's non-locking eligibility probe — post-confirmation
 * state is monotonic, so a plain read is race-free for this decision and no
 * lock is taken (nothing here ever writes the session row: the lifecycle
 * owns it exclusively, and this flow consumes its state read-only).
 *
 *  - `submitTeacherEvaluation` is the write-once submission gate. The
 *    pipeline order is the contract: pre-DB shape guards (target session id
 *    + whole-star rating) fail before any database read; then ONE
 *    transaction resolves the eligibility probe, collapses a miss or a
 *    non-participant student onto the identical session-not-found denial
 *    (a foreign id is byte-indistinguishable from one that never was),
 *    rejects a session whose handshake has not finished, and inserts the
 *    rating; the transaction then re-averages the rated teacher's live
 *    rating family and writes the result — divided back onto the star
 *    scale and formatted to exactly two decimals — into the teacher row's
 *    cached average column. The recompute reads the stored rows (never an
 *    incremental merge), so the cache is a pure function of the family the
 *    transaction sees; a teacher row missing at that write is an internal
 *    invariant break, logged once and raised untranslated. The rater is
 *    ALWAYS the caller-supplied student id — there is
 *    no client-owned identity channel — and the rated subject is the
 *    session row's teacher, never an argument. The per-(session, evaluator)
 *    unique constraint is the write-once arbiter: a duplicate surfaces as
 *    the typed already-submitted conflict, and the stored rating is never
 *    updated or replaced (no such surface exists). The star input (whole
 *    stars 1..5) is converted to the table's 0-100 score scale HERE, so
 *    every producer stores one canonical scale.
 *  - `listMyTeacherEvaluations` is the caller-scoped read: the evaluator
 *    id is the only filter, so the result is exactly the caller's own live
 *    rating history, newest first, with the soft-delete internals, the
 *    free-text notes, and the server-managed update stamp stripped from
 *    the returned shape.
 *
 * Cross-surface purity: the service writes to the `evaluations` table and
 * — inside that SAME transaction — to the rated teacher's row, where ONLY
 * the cached average column moves; zero notification, audit, wallet,
 * ledger, or session-row writes, and it never imports the notification or
 * audit surfaces.
 *
 * All user-facing messages resolve through `getServerTranslations(locale)`;
 * every denial logs exactly ONE bounded `logger.logDomainError` entry
 * (code, entity, entity id, locale — never the submitted payload, never a
 * counterparty value), while happy paths and the read surface log nothing.
 * No module-level mutable state; every repository call inside the write
 * flow receives the SAME transaction.
 */

import { EvaluationRepository, SessionRepository, TeacherRepository } from "@/backend/db/repo";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { ConflictError, DomainError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  assertPositiveSafeSessionId,
  isPositiveSafeSessionId,
  SESSION_COMPLETED_STATUS,
} from "@/backend/services/classes/session-lifecycle.guards";
import { isUniqueViolation } from "@/backend/services/shared";
import type {
  ApiFieldErrorType,
  DBQueryExecutor,
  DBTransaction,
  EvaluationReturnType,
  EvaluationSelectType,
  EvaluationSubmitInput,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Lowest whole star a student may award. */
const RATING_MIN = 1;

/** Highest whole star a student may award. */
const RATING_MAX = 5;

/** Score points per whole star on the table's 0-100 scale (1★ → 20 … 5★ → 100). */
const SCORE_POINTS_PER_STAR = 20;

/** The localized errors handle threaded through every guard and gate. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id, locale — never the submitted payload, never a counterparty value.
 * The `entity` label names the table `entityId` points AT, not the flow's
 * subject — `"session"` for every session-gated arm (the sibling
 * session-gate taxonomy in `session-lifecycle.enforcement.ts` /
 * `session-report.service.ts`), and `"teacher"` when the failing entity is
 * the rated teacher's row (the aggregation's missing-profile failure).
 */
function logDenial(message: string, code: string, entity: string, entityId: number, locale: string): void {
  logger.logDomainError(message, { code, entity, entityId, locale });
}

/**
 * The `rating` field projection of the whole-star denial — names the
 * offending field, never the submitted value.
 */
function ratingFieldError(t: ErrorsTranslations): ApiFieldErrorType {
  return { field: "rating", code: "TEACHER_RATING_INVALID", message: t.teacherRatingInvalid };
}

/**
 * Strips the server-side columns from a stored row into the rating flow's
 * return shape — member by member, never a spread (the soft-delete
 * internals, the free-text notes, and the update stamp stay server-side).
 */
function toEvaluationReturnType(row: EvaluationSelectType): EvaluationReturnType {
  return {
    id: row.id,
    evaluatedId: row.evaluatedId,
    evaluatorId: row.evaluatorId,
    sessionId: row.sessionId,
    score: row.score,
    createdAt: row.createdAt,
  };
}

/**
 * The transactional body of a rating submission: resolves the eligibility
 * probe on the caller's transaction, applies the participant oracle and
 * the completion gate, inserts the rating with every stored column
 * derived server-side (the rated subject from the probe row, the rater
 * from the caller, the score from the whole-star input), then recomputes
 * the rated teacher's cached average over the live rating family and
 * writes it to the teacher row on the SAME transaction — a recompute from
 * the stored rows, never an incremental merge. A teacher row missing at
 * that write is an invariant break: one bounded log entry, then a plain
 * internal error (the transaction rolls back with zero residual rows).
 */
async function submitWithinTransaction(
  studentUserId: number,
  sessionId: number,
  rating: number,
  t: ErrorsTranslations,
  locale: string,
  tx: DBTransaction
): Promise<EvaluationReturnType> {
  const probe = await SessionRepository.findRatingEligibilityProbe(sessionId, tx);
  if (probe?.studentId !== studentUserId) {
    // Foreign ≡ nonexistent — one byte-identical denial, so session
    // existence is never an oracle.
    logDenial(
      "Student evaluation denied: session not found for the requesting student",
      "SESSION_NOT_FOUND",
      "session",
      sessionId,
      locale
    );
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }
  // A rating closes a FINISHED handshake: the row is completed and both
  // participants have stamped. Either stamp missing (or the wrong status)
  // is the same typed conflict. The comparison borrows the guards module's
  // widened status constant because the probe row's `status` arrives as the
  // raw pg-enum string union — the same probe-row vocabulary treatment the
  // lifecycle's own pre-write probes use, so every consumer compares the
  // enum member's string identity through ONE shared constant instead of
  // per-flow re-declarations (never a bare literal).
  if (
    probe.status !== SESSION_COMPLETED_STATUS ||
    probe.confirmedByTeacherAt === null ||
    probe.confirmedByStudentAt === null
  ) {
    logDenial(
      "Student evaluation denied: the session is not completed and confirmed by both participants",
      "EVALUATION_SESSION_NOT_COMPLETED",
      "session",
      sessionId,
      locale
    );
    throw new ConflictError("EVALUATION_SESSION_NOT_COMPLETED", t.evaluationSessionNotCompleted);
  }
  const row = await EvaluationRepository.insertOnce(
    {
      evaluatedId: probe.teacherId,
      evaluatorId: studentUserId,
      sessionId,
      score: rating * SCORE_POINTS_PER_STAR,
    },
    tx
  );
  const aggregate = await EvaluationRepository.aggregateLiveRatings(probe.teacherId, tx);
  if (aggregate.averageScore === null) {
    // Unreachable by construction (the just-inserted row is live), but the
    // honest-null contract is defended here: no live family ⇒ nothing to
    // write, and the cached average keeps its previous value.
    return toEvaluationReturnType(row);
  }
  const averageRating = (aggregate.averageScore / SCORE_POINTS_PER_STAR).toFixed(2);
  const updatedTeacher = await TeacherRepository.updateAverageRating(probe.teacherId, averageRating, tx);
  if (!updatedTeacher) {
    logDenial(
      "Teacher rating aggregation failed: the rated teacher's profile row is missing",
      "TEACHER_PROFILE_MISSING",
      "teacher",
      probe.teacherId,
      locale
    );
    throw new DomainError("TEACHER_PROFILE_MISSING", "Student evaluation failed: the rated teacher has no teacher row");
  }
  return toEvaluationReturnType(row);
}

export namespace StudentEvaluationService {
  /**
   * Submits the calling student's rating of a session's teacher, exactly
   * once per session.
   *
   * The target session id is guarded as a positive safe integer and the
   * rating as a whole star within 1..5 — both BEFORE any database read, so
   * a garbage shape can never reach SQL. The rating denial projects the
   * offending field by NAME (`rating`), never the submitted value. Inside
   * ONE transaction the session's eligibility probe is resolved: a miss
   * and a non-participant student surface the identical session-not-found
   * denial (existence is never an oracle), a session whose completion
   * handshake has not finished (wrong status or either stamp missing) is
   * the typed not-completed conflict, and otherwise the rating is inserted
   * with the score derived server-side (`rating × 20`), the rater derived
   * from the caller, and the rated subject derived from the session row —
   * and the rated teacher's cached average is recomputed over the live
   * rating family and written to the teacher row inside the SAME
   * transaction (a rollback of the submission is a rollback of the average
   * move with it).
   * A (session, rater) pair that already carries a rating surfaces the
   * typed write-once conflict — the unique constraint is the arbiter, the
   * stored rating stays byte-identical, and every other failure inside the
   * transaction is rethrown untouched (the transaction rolls back with
   * zero residual rows).
   *
   * @param studentUserId  The acting student's id (shared PK — the value
   *     the session's student column stores for this participant).
   * @param sessionId  The target session id.
   * @param input  The client-controlled star input (the ONLY client-owned
   *     value; every stored column is server-derived).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction. When provided, the flow
   *     runs inside a SAVEPOINT on it; production callers omit it and the
   *     service opens its own transaction.
   * @returns The created rating row in its GraphQL-facing shape.
   */
  export async function submitTeacherEvaluation(
    studentUserId: number,
    sessionId: number,
    input: EvaluationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<EvaluationReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;

    // Pre-DB shape guards — fail before any database read, in order.
    //
    // The target id is denied by the shared assertion helper (the canonical
    // VALIDATION throw); the bounded denial log fires once on that path,
    // before the shared guard raises.
    if (!isPositiveSafeSessionId(sessionId)) {
      logDenial("Student evaluation denied: malformed session id", "VALIDATION", "session", sessionId, locale);
    }
    assertPositiveSafeSessionId(sessionId, t);

    // Whole-star guard: an integer within 1..5. The offender projects the
    // same single field — by name, never the submitted value.
    if (!Number.isInteger(input.rating) || input.rating < RATING_MIN || input.rating > RATING_MAX) {
      logDenial(
        "Student evaluation denied: rating outside the whole-star range",
        "VALIDATION",
        "session",
        sessionId,
        locale
      );
      throw new ValidationError(t.teacherRatingInvalid, [ratingFieldError(t)]);
    }

    try {
      return await withTransaction(outerTx, tx =>
        submitWithinTransaction(studentUserId, sessionId, input.rating, t, locale, tx)
      );
    } catch (error) {
      // The per-(session, evaluator) unique constraint is the write-once
      // arbiter: ONLY a `23505` on the cause chain maps to the typed
      // conflict — every other failure is rethrown untouched (no masked
      // catch).
      if (isUniqueViolation(error)) {
        logDenial(
          "Student evaluation denied: a rating for this session was already submitted",
          "EVALUATION_ALREADY_SUBMITTED",
          "session",
          sessionId,
          locale
        );
        throw new ConflictError("EVALUATION_ALREADY_SUBMITTED", t.evaluationAlreadySubmitted);
      }
      throw error;
    }
  }

  /**
   * Lists one student's own teacher ratings, newest first.
   *
   * Caller-scoped by construction: the evaluator id is the read's only
   * filter (no parameter exists through which the result could be widened
   * toward another rater), soft-deleted rows are excluded, and the rows
   * are returned in the GraphQL-facing shape (soft-delete internals, the
   * free-text notes, and the update stamp stripped). No pagination — a
   * student's rating history is naturally bounded. Logs nothing.
   *
   * @param studentUserId  The calling student's id.
   * @param tx  Optional read executor — propagated so a caller-owned
   *     atomic flow stays atomic (standalone callers resolve through the
   *     repository's parameterized cold read).
   */
  export async function listMyTeacherEvaluations(
    studentUserId: number,
    tx?: DBQueryExecutor
  ): Promise<readonly EvaluationReturnType[]> {
    const rows = await EvaluationRepository.listByEvaluator(studentUserId, tx);
    return rows.map(toEvaluationReturnType);
  }
}
