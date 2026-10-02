/**
 * EvaluationRubricService — submission-flow internals (module extraction):
 * the transaction body of `submitRubricEvaluation`, decomposed into
 * composable units that keep the fixed write order visible:
 *
 *   1. the session gate — the target must exist, be a completed
 *      teacher-evaluation session, and be owned by the caller (unknown,
 *      foreign, and mistyped targets share the ONE session-not-found
 *      denial — the denial shape leaks nothing);
 *   2. the submitter's certification re-check, fresh inside the
 *      transaction (FOR UPDATE — the value the submission commits
 *      against);
 *   3. the evaluated applicant's row lock plus the in-evaluation status
 *      gate (the evaluated subject is ALWAYS the gated session's student,
 *      never a caller-supplied id — the lock is the per-applicant
 *      finalization mutex);
 *   4. the cycle-membership probe — a session created before the
 *      applicant's current verification cycle folds into the SAME
 *      session-not-found denial as an unknown one;
 *   5. the duplicate pre-check (an optimization — the table's unique
 *      arbiter stays the write-once authority for the race a pre-check
 *      cannot close);
 *   6. the submission insert (a unique-violation in the cause chain maps
 *      onto the same typed duplicate conflict);
 *   7. the quorum read under the held applicant lock — below the quorum
 *      the submission commits alone; at the quorum the SAME transaction
 *      derives the verdict and finalizes:
 *      - PASS: the teacher row is inserted certified (or, on a duplicate,
 *        elevated WITHOUT demoting a pre-existing evaluator — the locked
 *        row's own evaluator flag is the elevate argument) and the
 *        applicant is finalized; a lost guarded write rolls the whole
 *        transaction back;
 *      - FAIL: the primary failure area is derived deterministically
 *        (lowest score, ties to the earliest submission) and the
 *        applicant transitions to `failed` with the cooldown instant
 *        stamped verbatim; a lost guarded write rolls the whole
 *        transaction back;
 *   8. the in-transaction notification — composed in the APPLICANT's
 *      persisted locale (falling back to the platform default) — and the
 *      receipt returned OUT of the transaction for the post-commit
 *      publish (owned by the public service method).
 *
 * The public surface stays the `EvaluationRubricService` namespace in
 * `evaluation-rubric.service.ts` (the namespace method owns the boundary
 * validation, the governance re-check, the captured instant, the
 * `withTransaction` composition, and the post-commit publish). Nothing in
 * this module is part of the public API.
 */

import {
  ApplicantRepository,
  EvaluationRepository,
  SessionRepository,
  TeacherRepository,
  UserRepository,
} from "@/backend/db/repo";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { isRubricWeaknessArea, RubricWeaknessArea } from "@/backend/enum/teachers/rubric-weakness-area.enum";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import { isUniqueViolation } from "@/backend/services/shared";
import { ApplicantConversionService } from "@/backend/services/teachers/applicant-conversion.service";
import { expandCooldownTemplate } from "@/backend/services/teachers/applicant-lifecycle.service";
import type {
  DBTransaction,
  EvaluationSelectType,
  NotificationDeliveryReceipt,
  NotificationEmitInput,
  RubricCycleSubmissionRow,
  RubricEvaluationReturnType,
  RubricEvaluationSubmitInput,
  RubricSubmissionInsertInput,
  SessionSelectType,
} from "@/backend/types";
import {
  HIFZ_COOLDOWN_DAYS,
  RUBRIC_PASS_THRESHOLD,
  TAJWEED_COOLDOWN_DAYS,
} from "@/shared/constants/evaluation-rubric.constants";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants/verification-plan.constants";
import { defaultLocale } from "@/shared/locale/AppLocale";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized errors handle threaded through every gate. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/** Milliseconds in one day — the cooldown durations are day-count constants. */
const MS_PER_DAY = 86_400_000;

/** The derived verdict of a completed evaluation cycle. */
type RubricVerdict = "passed" | "failed";

/**
 * The finalization outcome a quorum-complete submission produced: a pass
 * carries no cooldown, a fail carries the exact re-application instant the
 * guarded write stamped.
 */
type RubricFinalization =
  | { readonly verdict: "passed"; readonly cooldownUntil: null }
  | { readonly verdict: "failed"; readonly cooldownUntil: Date };

/** What the transaction body hands back to the public method. */
interface RubricSubmissionTxOutcome {
  /** The submission read-model with the post-verdict applicant status. */
  readonly submission: RubricEvaluationReturnType;
  /** The delivery receipt of a finalizing submission; undefined below the quorum. */
  readonly receipt: NotificationDeliveryReceipt | undefined;
  /** The locale the finalization copy was composed (and must be published) in. */
  readonly recipientLocale: string | undefined;
}

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id. The `entityId` is the DENIED entity's id — session gates log the
 * target session id, certification and applicant gates log the acting
 * evaluator / evaluated applicant. Never the submitted payload, never the
 * free-text observations.
 */
function logDenial(message: string, code: string, entity: string, entityId: number): void {
  logger.logDomainError(message, { code, entity, entityId });
}

/** The shared already-finalized denial log of the two guarded verdict writes. */
function logAlreadyFinalized(applicantUserId: number): void {
  logDenial("Rubric denied: already finalized", "APPLICANT_ALREADY_FINALIZED", "applicants", applicantUserId);
}

/**
 * The session gate: the target must exist, be a teacher-evaluation session
 * with the evaluation intent, be OWNED by the calling evaluator, and be
 * completed. Unknown, foreign, mistyped, and prior-state targets are
 * pairwise-distinguished only by their two codes — the not-found denial is
 * shared by everything whose existence or provenance must not leak.
 */
async function findGatedCompletedSession(
  sessionId: number,
  evaluatorUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<SessionSelectType> {
  const sessionRow = await SessionRepository.findById(sessionId, tx);
  // The session row's columns are the raw pg-enum string unions, so the
  // comparisons run against the widened string identity of the members —
  // the vocabulary still flows from the enums, never from bare literals.
  const evaluationType: string = SessionType.TeacherEvaluation;
  const evaluationIntent: string = SessionIntent.Evaluation;
  const completedStatus: string = SessionStatus.Completed;
  if (
    sessionRow?.sessionType !== evaluationType ||
    sessionRow.intent !== evaluationIntent ||
    sessionRow.teacherId !== evaluatorUserId
  ) {
    logDenial("Rubric denied: no evaluation session for the caller", "SESSION_NOT_FOUND", "session", sessionId);
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }
  if (sessionRow.status !== completedStatus) {
    logDenial("Rubric submission denied: session not completed", "RUBRIC_SESSION_NOT_COMPLETED", "session", sessionId);
    throw new ConflictError("RUBRIC_SESSION_NOT_COMPLETED", t.rubricSessionNotCompleted);
  }
  return sessionRow;
}

/**
 * The certification re-check, fresh inside the submission transaction (the
 * row is locked FOR UPDATE, so the flags this submission commits against
 * cannot change underneath it): the caller's teacher row must exist and
 * carry both certification flags.
 */
async function assertSubmitterCertified(
  evaluatorUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<void> {
  const gate = await TeacherRepository.findForEvaluationGateById(evaluatorUserId, tx);
  if (gate?.isApproved !== true || gate.isEvaluator !== true) {
    logDenial("Rubric denied: caller not a certified evaluator", "TEACHER_NOT_CERTIFIED", "teacher", evaluatorUserId);
    throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
  }
}

/**
 * The evaluated applicant's row lock plus the in-evaluation status gate —
 * the per-applicant finalization mutex. Every submission for the same
 * applicant serializes on this row, so the quorum read below observes any
 * committed rival submission, and the verdict writes commit against a
 * frozen status.
 */
async function lockApplicantInEvaluation(
  applicantUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<void> {
  const lockedApplicant = await ApplicantRepository.findForBookingGate(applicantUserId, tx);
  if (lockedApplicant?.status !== ApplicantStatus.InEvaluation) {
    logDenial(
      "Rubric submission denied: evaluated applicant not in evaluation",
      "APPLICANT_NOT_IN_EVALUATION",
      "applicants",
      applicantUserId
    );
    throw new ConflictError("APPLICANT_NOT_IN_EVALUATION", t.applicantNotInEvaluation);
  }
}

/**
 * The cycle-membership probe: the session must fall inside the evaluated
 * applicant's CURRENT verification cycle. A closed cycle or a prior-cycle
 * session folds into the SAME session-not-found denial as an unknown
 * session (history is not scorable, and the denial reveals nothing).
 *
 * @returns The current cycle's start instant — the quorum read's lower bound.
 */
async function resolveCurrentCycleStart(
  sessionRow: SessionSelectType,
  sessionId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<Date> {
  const cycle = await SessionRepository.resolveCurrentEvaluationCycle(sessionRow.studentId, tx);
  if (cycle.cycleStart === null || sessionRow.createdAt.getTime() < cycle.cycleStart.getTime()) {
    logDenial("Rubric denied: no evaluation session for the caller", "SESSION_NOT_FOUND", "session", sessionId);
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }
  return cycle.cycleStart;
}

/**
 * The duplicate pre-check: a (session, evaluator) pair that already carries
 * a row is the typed duplicate conflict on the common path. The table's
 * unique arbiter stays the write-once authority — the insert below maps a
 * unique-violation race onto the SAME conflict.
 */
async function assertFirstSubmission(
  sessionId: number,
  evaluatorUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<void> {
  const existing = await EvaluationRepository.findBySessionAndEvaluator(sessionId, evaluatorUserId, tx);
  if (existing !== null) {
    logDenial("Rubric denied: pair already scored", "EVALUATION_ALREADY_SUBMITTED", "evaluations", sessionId);
    throw new ConflictError("EVALUATION_ALREADY_SUBMITTED", t.evaluationAlreadySubmitted);
  }
}

/**
 * The submission insert — the sealed payload assembled field by field into
 * its canonical type (`RubricSubmissionInsertInput`: the evaluated subject
 * from the gated session's student, the evaluator from the authenticated
 * caller; never spread from client input). A unique violation in the cause
 * chain — the race the pre-check cannot close — maps onto the SAME typed
 * duplicate conflict; every other failure rethrows untouched (the
 * transaction rolls the submission back with it).
 */
async function insertSubmission(
  sessionRow: SessionSelectType,
  evaluatorUserId: number,
  input: RubricEvaluationSubmitInput,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<EvaluationSelectType> {
  try {
    const sealedPayload: RubricSubmissionInsertInput = {
      evaluatedId: sessionRow.studentId,
      evaluatorId: evaluatorUserId,
      sessionId: sessionRow.id,
      score: input.score,
      notes: input.notes,
      weaknessArea: input.weaknessArea,
    };
    return await EvaluationRepository.insertOnce(sealedPayload, tx);
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    logDenial("Rubric denied: pair already scored", "EVALUATION_ALREADY_SUBMITTED", "evaluations", sessionRow.id);
    throw new ConflictError("EVALUATION_ALREADY_SUBMITTED", t.evaluationAlreadySubmitted, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/**
 * Derives the cycle verdict: PASS only when EVERY scored submission meets
 * the per-evaluation threshold — a single failing score fails the whole
 * cycle regardless of the mean (the threshold is a per-evaluation minimum,
 * never an average).
 */
function deriveRubricVerdict(submissions: readonly RubricCycleSubmissionRow[]): RubricVerdict {
  return submissions.every(row => row.score >= RUBRIC_PASS_THRESHOLD) ? "passed" : "failed";
}

/**
 * Derives the primary failure area of a failed cycle: the weakness area of
 * the single LOWEST-scoring failing submission; ties break to the EARLIEST
 * submission (the feed arrives earliest-first, so a strictly lower score is
 * the only thing that replaces the running minimum — the first-submitted of
 * a tied minimum wins). Every failing submission carries an area by the
 * input contract, so the derivation is total over any failed cycle; a
 * missing area or a foreign stored value is a fail-closed integrity
 * tripwire, never a lenient fallback.
 */
function derivePrimaryFailureArea(submissions: readonly RubricCycleSubmissionRow[]): RubricWeaknessArea {
  let primary: RubricCycleSubmissionRow | undefined;
  for (const row of submissions) {
    if (row.score < RUBRIC_PASS_THRESHOLD && (primary === undefined || row.score < primary.score)) {
      primary = row;
    }
  }
  if (primary === undefined || !isRubricWeaknessArea(primary.weaknessArea)) {
    throw new Error("EvaluationRubricService: failed cycle has no usable primary weakness area");
  }
  return primary.weaknessArea;
}

/**
 * Resolves the re-application instant for a failed cycle: the failure
 * area's day-count duration added to the flow's single captured instant.
 * The instant is stored verbatim downstream — no further enforcement or
 * rounding happens anywhere in the flow.
 */
function resolveFinalizationCooldownUntil(area: RubricWeaknessArea, now: Date): Date {
  const durationDays = area === RubricWeaknessArea.Tajweed ? TAJWEED_COOLDOWN_DAYS : HIFZ_COOLDOWN_DAYS;
  return new Date(now.getTime() + durationDays * MS_PER_DAY);
}

/**
 * The PASS finalization: the applicant's `teacher` row is inserted directly
 * in the certified state (`is_approved=true`, `is_evaluator=false`). A
 * duplicate (the defense-in-depth arm for a pre-existing row) locks the row
 * and either no-ops on an already-approved row or elevates it with the
 * LOCKED row's OWN evaluator flag — a blind `false` would demote a
 * pre-existing evaluator. The applicant row is then finalized
 * (`passed`, cooldown cleared); a zero-row finalize means a concurrent
 * finalization won, and the typed conflict rolls the whole transaction
 * back (exactly one verdict ever commits). The verdict commits with the
 * `teacher` role restored for a previously converted account: the guarded
 * `student` → `teacher` flip runs on the SAME transaction after the
 * finalize and is a silent no-op for a never-converted applicant (already
 * `teacher`). The historical `students` row is never touched.
 */
async function finalizeRubricPass(applicantUserId: number, tx: DBTransaction, t: ErrorsTranslations): Promise<void> {
  try {
    // The collision-prone insert runs on a nested savepoint of the caller's
    // transaction: a `23505` rolls back TO the savepoint and rethrows here,
    // leaving the caller's transaction alive for the elevate arm below.
    // PostgreSQL aborts a transaction on ANY statement error — without the
    // savepoint, every subsequent statement of the arm would die with
    // `25P02 current transaction is aborted`.
    await tx.transaction(sp => TeacherRepository.insertColdStartCertified(applicantUserId, false, sp));
  } catch (error) {
    if (!isUniqueViolation(error)) {
      throw error;
    }
    // A teacher row already exists for the passed applicant — the locked
    // read pins it while the elevate decision commits against it. The
    // elevate argument is the locked row's OWN evaluator flag.
    const locked = await TeacherRepository.findForEvaluationGateById(applicantUserId, tx);
    if (locked?.isApproved !== true) {
      if ((await TeacherRepository.elevateToCertified(applicantUserId, locked?.isEvaluator === true, tx)) === null) {
        // The FOR UPDATE read above pinned the row's unapproved state — a
        // zero-row elevate against that pin is an internal inconsistency.
        throw new Error("EvaluationRubricService: teacher elevation matched zero rows for an unapproved row", {
          cause: error,
        });
      }
    }
  }
  const finalized = await ApplicantRepository.finalizeOnCertification(applicantUserId, tx);
  if (!finalized) {
    logAlreadyFinalized(applicantUserId);
    throw new ConflictError("APPLICANT_ALREADY_FINALIZED", t.applicantAlreadyFinalized);
  }
  // The pass verdict has committed its authoritative pre-state; restore the
  // teacher role of a previously converted account on the SAME transaction.
  // A never-converted applicant is already `teacher`, so the guarded flip
  // matches zero rows — the documented silent no-op.
  await ApplicantConversionService.restoreTeacherRole(applicantUserId, tx);
}

/**
 * The FAIL finalization: ONE guarded UPDATE flips the applicant to
 * `failed` and stamps the cooldown instant verbatim, with the
 * `in_evaluation` pre-state folded into the predicate — a concurrent
 * finalization matching zero rows surfaces the typed conflict and rolls
 * the whole transaction back (no suspension fields are written). Only once
 * that guarded write has matched does the finalization convert the
 * applicant to a `student` in the SAME transaction: a zeroed `students`
 * role-child row with a fresh unique handshake code plus the guarded
 * `teacher` → `student` role flip, atomic with the verdict — a conversion
 * failure rolls the verdict back. The `applicants` row is untouched by the
 * conversion itself (the guarded write above is its only writer here).
 */
async function finalizeRubricFail(
  applicantUserId: number,
  cooldownUntil: Date,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<void> {
  const failed = await ApplicantRepository.transitionToFailed(applicantUserId, cooldownUntil, tx);
  if (failed === null) {
    logAlreadyFinalized(applicantUserId);
    throw new ConflictError("APPLICANT_ALREADY_FINALIZED", t.applicantAlreadyFinalized);
  }
  // The guarded verdict write is the per-applicant concurrency guard: the
  // conversion runs only for the ONE finalization that matched, on the SAME
  // transaction — any conversion failure rolls the verdict back with it.
  await ApplicantConversionService.convertToStudent(applicantUserId, tx, t);
}

/**
 * The in-transaction notification for a finalizing submission: ONE
 * evaluation-result row for the applicant, composed in the APPLICANT's
 * persisted locale (a user row without one falls back to the platform
 * default) — the engine stores copy verbatim, so recipient-locale
 * composition is this flow's obligation. The failed body interpolates the
 * locale-formatted cooldown instant. The receipt is returned unpublished;
 * the public method owns the strictly-post-commit publish.
 */
async function emitFinalizationReceipt(
  applicantUserId: number,
  sessionId: number,
  finalization: RubricFinalization,
  tx: DBTransaction
): Promise<{ receipt: NotificationDeliveryReceipt; recipientLocale: string }> {
  const applicantAccount = await UserRepository.findById(applicantUserId, tx);
  const recipientLocale = applicantAccount?.locale ?? defaultLocale;
  const applicantCopy = getServerTranslations(recipientLocale).applicantTranslations;
  const passed = finalization.verdict === "passed";
  const emitInput: NotificationEmitInput = {
    userId: applicantUserId,
    type: NotificationType.EvaluationResult,
    title: passed ? applicantCopy.evaluationPassedTitle : applicantCopy.evaluationFailedTitle,
    body: passed
      ? applicantCopy.evaluationPassedBody
      : expandCooldownTemplate(applicantCopy.evaluationFailedBody, finalization.cooldownUntil, recipientLocale),
    relatedEntityType: "session",
    relatedEntityId: sessionId,
  };
  const emitResult = await NotificationEngine.emitForUser(emitInput, recipientLocale, tx);
  if (!("notifications" in emitResult)) {
    throw new Error("EvaluationRubricService: in-transaction emit returned a bare row instead of a receipt");
  }
  return { receipt: emitResult, recipientLocale };
}

/**
 * Shapes the sealed rubric read-model from a stored evaluation row (the
 * free-text observations stay server-side — the read-model type carries no
 * notes member) plus the applicant status observed at read time. The raw
 * stored weakness value is mapped through the vocabulary's fail-closed
 * guard, so a foreign stored value degrades to null instead of fabricating
 * a member.
 */
function toReadModel(row: EvaluationSelectType, applicantStatus: ApplicantStatus): RubricEvaluationReturnType {
  return {
    id: row.id,
    sessionId: row.sessionId,
    evaluatedId: row.evaluatedId,
    evaluatorId: row.evaluatorId,
    score: row.score,
    weaknessArea: isRubricWeaknessArea(row.weaknessArea) ? row.weaknessArea : null,
    createdAt: row.createdAt,
    applicantStatus,
  };
}

/**
 * The submission transaction body — the fixed, never-reordered order:
 * session gate → completion gate → certification re-check → applicant
 * lock + status gate → cycle membership → duplicate pre-check → insert →
 * quorum read (under the held applicant lock) → below the quorum the
 * submission commits alone; at the quorum the SAME transaction derives the
 * verdict, finalizes (PASS: insert-or-elevate teacher + finalize; FAIL:
 * guarded failed transition with the cooldown stamp), and emits the
 * in-transaction notification. Any failure rolls the whole transaction
 * back — the verdict commits with its submission or not at all.
 *
 * @param evaluatorUserId  The authenticated caller (the submitting evaluator).
 * @param sessionId  The target evaluation session (pre-validated shape).
 * @param input  The validated submission payload (score, trimmed notes,
 *     guarded weakness area).
 * @param now  The flow's single captured instant (cooldown arithmetic base).
 * @param tx  The caller's transaction.
 * @param t  The localized errors handle for every gate's typed denial.
 */
export async function submitRubricEvaluationInTx(
  evaluatorUserId: number,
  sessionId: number,
  input: RubricEvaluationSubmitInput,
  now: Date,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<RubricSubmissionTxOutcome> {
  const sessionRow = await findGatedCompletedSession(sessionId, evaluatorUserId, tx, t);
  await assertSubmitterCertified(evaluatorUserId, tx, t);
  await lockApplicantInEvaluation(sessionRow.studentId, tx, t);
  const cycleStart = await resolveCurrentCycleStart(sessionRow, sessionId, tx, t);
  await assertFirstSubmission(sessionId, evaluatorUserId, tx, t);
  const inserted = await insertSubmission(sessionRow, evaluatorUserId, input, tx, t);

  // The quorum read runs under the applicant row lock taken above, so a
  // rival evaluator's committed submission is visible before the caller
  // decides whether the quorum has fired.
  const submissions = await EvaluationRepository.listCycleRubricSubmissions(sessionRow.studentId, cycleStart, tx);
  if (submissions.length < VERIFICATION_PLAN_SESSION_COUNT) {
    return {
      submission: toReadModel(inserted, ApplicantStatus.InEvaluation),
      receipt: undefined,
      recipientLocale: undefined,
    };
  }

  const verdict = deriveRubricVerdict(submissions);
  let finalization: RubricFinalization;
  if (verdict === "passed") {
    await finalizeRubricPass(sessionRow.studentId, tx, t);
    finalization = { verdict: "passed", cooldownUntil: null };
  } else {
    const area = derivePrimaryFailureArea(submissions);
    const cooldownUntil = resolveFinalizationCooldownUntil(area, now);
    await finalizeRubricFail(sessionRow.studentId, cooldownUntil, tx, t);
    finalization = { verdict: "failed", cooldownUntil };
  }

  const { receipt, recipientLocale } = await emitFinalizationReceipt(sessionRow.studentId, sessionId, finalization, tx);
  return {
    submission: toReadModel(inserted, verdict === "passed" ? ApplicantStatus.Passed : ApplicantStatus.Failed),
    receipt,
    recipientLocale,
  };
}
