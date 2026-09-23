/**
 * EvaluationRubricService — the evaluator-facing surfaces of the
 * five-session evaluation loop: the rubric submission write
 * (`submitRubricEvaluation`) and its two reads (the evaluator's
 * not-yet-scored completed evaluation sessions, and the evaluator's own
 * submission for one session).
 *
 * The submission write is the loop's terminal trigger: EVERY submission
 * runs inside ONE transaction whose fixed order is the contract — the
 * session gate (unknown, foreign, and mistyped targets share the ONE
 * oracle-free session-not-found denial), the completion gate, the
 * fresh-in-transaction certification re-check (FOR UPDATE), the evaluated
 * applicant's row lock plus the in-evaluation status gate (the evaluated
 * subject is ALWAYS the gated session's student, never a caller-supplied
 * id), the cycle-membership probe (a prior-cycle session folds into the
 * same session-not-found denial), the duplicate pre-check, the sealed
 * insert (the table's unique arbiter maps any racing duplicate onto the
 * same typed conflict), and the quorum read under the held lock. Below
 * the quorum the submission commits alone; at the quorum the SAME
 * transaction derives the verdict — PASS only when every score meets the
 * per-evaluation threshold (never a mean) — finalizes the applicant
 * (PASS: certified teacher row insert-or-elevate with the demotion guard
 * + finalize; FAIL: deterministic primary failure area, the day-count
 * cooldown instant, and ONE guarded failed transition), and emits the
 * applicant's notification in the APPLICANT'S persisted locale. The
 * receipt publishes strictly AFTER the commit — a denied, rolled-back, or
 * caller-owned-transaction flow never pushes. There is deliberately no
 * idempotency-key machinery: the (session, evaluator) unique index is the
 * replay arbiter.
 *
 * The reads are caller-keyed by construction: the pending page is
 * certification-gated (a non-certified caller gets the empty page — the
 * oracle-safe answer that reveals nothing) and the own-submission read
 * denies unknown and foreign pairs with the identical session-not-found
 * error. The read-model never carries the free-text observations — they
 * stay server-side.
 *
 * All user-facing messages resolve through `getServerTranslations(locale)`;
 * every denial logs exactly ONE bounded `logger.logDomainError` entry (code
 * + entity ids only — never the observations); happy paths log nothing. No
 * module-level mutable state; every repository call inside the transaction
 * body receives the SAME transaction. The transactional write pipeline
 * lives in the sibling `evaluation-rubric.helpers.ts` module (not part of
 * the public API).
 */

import { ApplicantRepository, EvaluationRepository, SessionRepository, TeacherRepository } from "@/backend/db/repo";
import { isApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { isRubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { withTransaction } from "@/backend/lib/db/with-transaction";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorGovernanceClean } from "@/backend/services/classes/session-lifecycle.governance";
import { isPositiveSafeInteger } from "@/backend/services/classes/session-lifecycle.guards";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import { submitRubricEvaluationInTx } from "@/backend/services/teachers/evaluation-rubric.helpers";
import type {
  DBTransaction,
  RubricEvaluationReturnType,
  RubricEvaluationSubmitInput,
  SessionPageReturnType,
} from "@/backend/types";
import { RUBRIC_NOTES_MAX_LENGTH, RUBRIC_PASS_THRESHOLD } from "@/shared/constants/evaluation-rubric.constants";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** Pending-page size fallback. */
const PENDING_DEFAULT_PAGE_SIZE = 25;

/** Upper bound of the pending-page size. */
const PENDING_MAX_PAGE_SIZE = 100;

/**
 * The localized errors handle threaded through the boundary checks (the
 * transaction body receives the same handle).
 */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id. The `entityId` is the DENIED entity's id — pre-DB shape denials log
 * the acting caller, session-scoped denials log the target session. Never
 * the submitted payload, never the free-text observations.
 */
function logDenial(message: string, code: string, entity: string, entityId: number): void {
  logger.logDomainError(message, { code, entity, entityId });
}

/**
 * The pre-DB submission validation — zero database reads, the input
 * contract enforced in one pass in a fixed order: the score shape, the
 * observations bound, the weakness iff-rule in both directions, and the
 * fail-closed weakness vocabulary guard. Every branch logs the ONE bounded
 * denial entry (code + the acting caller — a pre-DB shape denial has no
 * other honest entity id) before the typed rejection.
 *
 * @returns The trimmed observations — the value the sealed insert
 *     persists (whitespace padding is never stored).
 */
function validateRubricSubmission(
  input: RubricEvaluationSubmitInput,
  evaluatorUserId: number,
  t: ErrorsTranslations
): string {
  const weaknessArea = input.weaknessArea ?? null;
  if (!Number.isInteger(input.score) || input.score < 0 || input.score > 100) {
    logDenial(
      "Rubric submission denied: score outside the 0-100 integer band",
      "RUBRIC_SCORE_INVALID",
      "evaluations",
      evaluatorUserId
    );
    throw new ValidationError("RUBRIC_SCORE_INVALID", t.rubricScoreInvalid);
  }
  const notes = input.notes.trim();
  if (notes.length === 0 || notes.length > RUBRIC_NOTES_MAX_LENGTH) {
    logDenial(
      "Rubric submission denied: observations empty or over the bound",
      "RUBRIC_NOTES_REQUIRED",
      "evaluations",
      evaluatorUserId
    );
    throw new ValidationError("RUBRIC_NOTES_REQUIRED", t.rubricNotesRequired);
  }
  if (input.score < RUBRIC_PASS_THRESHOLD && weaknessArea === null) {
    logDenial(
      "Rubric submission denied: failing score without a weakness area",
      "RUBRIC_WEAKNESS_REQUIRED",
      "evaluations",
      evaluatorUserId
    );
    throw new ValidationError("RUBRIC_WEAKNESS_REQUIRED", t.rubricWeaknessRequired);
  }
  if (input.score >= RUBRIC_PASS_THRESHOLD && weaknessArea !== null) {
    logDenial(
      "Rubric submission denied: passing score with a weakness area",
      "RUBRIC_WEAKNESS_NOT_ALLOWED",
      "evaluations",
      evaluatorUserId
    );
    throw new ValidationError("RUBRIC_WEAKNESS_NOT_ALLOWED", t.rubricWeaknessNotAllowed);
  }
  if (weaknessArea !== null && !isRubricWeaknessArea(weaknessArea)) {
    logDenial(
      "Rubric submission denied: weakness area outside the vocabulary",
      "RUBRIC_WEAKNESS_INVALID",
      "evaluations",
      evaluatorUserId
    );
    throw new ValidationError("RUBRIC_WEAKNESS_INVALID", t.rubricWeaknessInvalid);
  }
  return notes;
}

/**
 * Normalizes the pending-page window before any database work: a page
 * below 1 (or a non-integer) falls back to the first page; a page size
 * outside 1..100 falls back to the default. The normalized values are what
 * the callers see echoed back — honest windows only (the repository
 * applies the same fallback, so the delegate can never drift).
 */
function normalizePendingPageBounds(page: number, pageSize: number): { page: number; pageSize: number } {
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1;
  const safePageSize =
    Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= PENDING_MAX_PAGE_SIZE
      ? pageSize
      : PENDING_DEFAULT_PAGE_SIZE;
  return { page: safePage, pageSize: safePageSize };
}

export namespace EvaluationRubricService {
  /**
   * Submits the calling evaluator's rubric for one of their OWN completed
   * evaluation sessions — write-once per (session, evaluator). Pre-DB
   * shape guards, the input contract, and the governance re-check fail
   * before any database work; inside ONE transaction the session gate,
   * the completion gate, the certification re-check, the applicant lock +
   * status gate, the cycle-membership probe, the duplicate pre-check, the
   * sealed insert, and the quorum read run in a fixed order (the sibling
   * helpers module). At the quorum the same transaction finalizes the
   * applicant and emits the outcome notification in the applicant's
   * persisted locale. After the commit the receipt publishes outside the
   * transaction; a publish failure is logged by the engine and never
   * rolls back or retries the verdict.
   *
   * @param evaluatorUserId  The authenticated caller's users id.
   * @param sessionId  The target evaluation session id.
   * @param input  The client-controlled submission input (score, notes,
   *     weakness area — the evaluated subject is resolved server-side from
   *     the session, never accepted from the caller).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction — the flow runs inside a
   *     SAVEPOINT on it; production callers omit it. On a caller-owned
   *     transaction the finalization receipt is intentionally NOT published
   *     by this method (the caller owns the commit boundary).
   * @returns The submission read-model with the LIVE post-write applicant
   *     status — `passed`/`failed` when THIS submission finalized the
   *     cycle, `in_evaluation` while the quorum is pending. The free-text
   *     observations are never part of the returned shape.
   */
  export async function submitRubricEvaluation(
    evaluatorUserId: number,
    sessionId: number,
    input: RubricEvaluationSubmitInput,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RubricEvaluationReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(evaluatorUserId) || !isPositiveSafeInteger(sessionId)) {
      logDenial("Rubric submission denied: malformed ids", "VALIDATION", "evaluations", evaluatorUserId);
      throw new ValidationError(t.validation);
    }
    const notes = validateRubricSubmission(input, evaluatorUserId, t);
    await assertActorGovernanceClean(evaluatorUserId, t, outerTx);
    const now = new Date();
    const { submission, receipt, recipientLocale } = await withTransaction(outerTx, tx =>
      submitRubricEvaluationInTx(
        evaluatorUserId,
        sessionId,
        { score: input.score, notes, weaknessArea: input.weaknessArea ?? null },
        now,
        tx,
        t
      )
    );
    // Publish strictly AFTER the commit — a denied or rolled-back
    // submission never pushes, and the finalization copy is published in
    // the locale it was composed in (the recipient's, not the caller's).
    // On a caller-owned transaction this method intentionally does NOT
    // publish the receipt (the caller owns the commit boundary, so it
    // cannot know the receipt survived it).
    if (outerTx === undefined && receipt !== undefined && recipientLocale !== undefined) {
      await NotificationEngine.publishReceipts([receipt], recipientLocale);
    }
    return submission;
  }

  /**
   * Lists the calling certified evaluator's completed evaluation sessions
   * that still await a rubric submission, newest first, paged. The
   * certification gate is the oracle-safe filter: a caller whose teacher
   * row is missing, lacks either certification flag, or is
   * governance-unclean (deleted, blocked, or suspended) gets the EMPTY page
   * (never an error — the denial would reveal certification state), plus
   * the one bounded domain log. The gate row is read under the evaluation
   * gate's lock inside the caller's transaction, so the flags the page
   * commits against cannot change underneath it. The returned rows are the
   * caller's OWN by
   * construction (the owner equality on the session's teacher leg); page
   * bounds normalize like the repository delegate (a page below 1 falls
   * back to the first page, a page size outside 1..100 falls back to the
   * default) and the effective values echo honestly.
   *
   * @param callerUserId  The calling user's id.
   * @param page  Requested page (≥ 1; invalid values normalize to 1).
   * @param pageSize  Requested page size (1..100; invalid values normalize
   *     to 25).
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction for the read.
   * @returns The pending-session page with an honest total (an
   *     out-of-range page yields empty items next to the unchanged total).
   */
  export async function myRubricPendingSessions(
    callerUserId: number,
    page: number,
    pageSize: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<SessionPageReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(callerUserId)) {
      logDenial("Rubric pending sessions denied: malformed caller id", "VALIDATION", "teacher", callerUserId);
      throw new ValidationError(t.validation);
    }
    const bounds = normalizePendingPageBounds(page, pageSize);
    return withTransaction(outerTx, async tx => {
      const teacherRow = await TeacherRepository.findForEvaluationGateById(callerUserId, tx);
      if (
        teacherRow?.isApproved !== true ||
        teacherRow.isEvaluator !== true ||
        teacherRow.isDeleted === true ||
        teacherRow.isBlocked === true ||
        teacherRow.suspended === true
      ) {
        logDenial(
          "Rubric pending sessions denied: caller not a certified evaluator",
          "TEACHER_NOT_CERTIFIED",
          "teacher",
          callerUserId
        );
        return { items: [], totalCount: 0, page: bounds.page, pageSize: bounds.pageSize };
      }
      const result = await SessionRepository.listCompletedRubricPendingSessions(
        callerUserId,
        { page: bounds.page, pageSize: bounds.pageSize },
        tx
      );
      return { items: result.items, totalCount: result.totalCount, page: bounds.page, pageSize: bounds.pageSize };
    });
  }

  /**
   * Reads the calling evaluator's OWN rubric submission for one session.
   * The (session, evaluator) pair read is the only scope: an unknown pair
   * and a foreign pair (another evaluator's session) share the ONE
   * session-not-found denial — no oracle. A hit returns the read-model
   * (the free-text observations stay server-side) with the applicant's
   * LIVE status — `passed`/`failed` once the cycle finalized,
   * `in_evaluation` while the quorum is pending.
   *
   * @param callerUserId  The calling user's id.
   * @param sessionId  The target session id.
   * @param locale  Active request locale (for the localized error messages).
   * @param outerTx  Optional outer transaction for the read.
   * @returns The caller's own submission read-model.
   */
  export async function myRubricEvaluation(
    callerUserId: number,
    sessionId: number,
    locale: string,
    outerTx?: DBTransaction
  ): Promise<RubricEvaluationReturnType> {
    const t = getServerTranslations(locale).errorsTranslations;
    if (!isPositiveSafeInteger(callerUserId) || !isPositiveSafeInteger(sessionId)) {
      logDenial("Rubric submission read denied: malformed ids", "VALIDATION", "evaluations", callerUserId);
      throw new ValidationError(t.validation);
    }
    return withTransaction(outerTx, async tx => {
      const row = await EvaluationRepository.findBySessionAndEvaluator(sessionId, callerUserId, tx);
      if (row === null) {
        logDenial(
          "Rubric submission read denied: no submission for the caller's pair",
          "SESSION_NOT_FOUND",
          "session",
          sessionId
        );
        throw new NotFoundError("SESSION", t.sessionNotFound);
      }
      // The live applicant status is ONE indexed read off the submission's
      // evaluated subject; a missing row or a foreign stored status is a
      // fail-closed integrity denial (a rubric submission's subject always
      // carries an applicant row in this domain — anything else is corrupt).
      const applicant = await ApplicantRepository.findByUserId(row.evaluatedId, tx);
      if (applicant === null || !isApplicantStatus(applicant?.status)) {
        throw new ValidationError("APPLICANT_STATUS_CORRUPT", t.applicantStatusCorrupt);
      }
      return {
        id: row.id,
        sessionId: row.sessionId,
        evaluatedId: row.evaluatedId,
        evaluatorId: row.evaluatorId,
        score: row.score,
        weaknessArea: isRubricWeaknessArea(row.weaknessArea) ? row.weaknessArea : null,
        createdAt: row.createdAt,
        applicantStatus: applicant.status,
      };
    });
  }
}
