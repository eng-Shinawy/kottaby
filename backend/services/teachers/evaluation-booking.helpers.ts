/**
 * EvaluationBookingService — booking-flow internals (module extraction,
 * behavior-identical): the transaction body of `bookEvaluation`,
 * decomposed into composable units that keep the fixed write order
 * visible:
 *
 *   1. the applicant lock plus the evaluation-stage status gate plus the
 *      active-cycle probe (all under ONE row lock — the per-applicant
 *      mutation mutex);
 *   2. the cycle's entitlement gates: capacity, then per-cycle evaluator
 *      distinctness (both decided from ONE aggregate read);
 *   3. the evaluator certification + governance lock (the teacher row's
 *      certification flags joined with the owning account's governance
 *      flags, FOR UPDATE — the value this booking commits against);
 *   4. the idempotency claim insert (savepoint-bracketed so a duplicate
 *      key rolls back only the claim statement and keeps the surrounding
 *      transaction readable for the replay lookup) followed by the
 *      session insert with server-owned columns and the claim's session-id
 *      backfill.
 *
 * On a duplicate claim key the flow REPLAYS BY THROWING
 * (`ConflictError("DUPLICATE_REQUEST")` — never a row): throwing is what
 * keeps the replayed attempt free of charge; its own partial writes roll
 * back with the transaction. A key spent by a DIFFERENT caller is denied
 * with the oracle-safe session-not-found error — another user's claim is
 * never surfaced.
 *
 * The public surface stays the `EvaluationBookingService` namespace in
 * `evaluation-booking.service.ts` (the namespace method owns the
 * boundary validation, the governance re-check, the captured instant, the
 * `withTransaction` composition, and the post-commit notification).
 * Nothing in this module is part of the public API.
 */

import {
  ApplicantRepository,
  SessionRepository,
  SessionRequestIdempotencyRepository,
  TeacherRepository,
} from "@/backend/db/repo";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ApplicantStatus } from "@/backend/enum/teachers/applicant-status.enum";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { isClaimKeyUniqueViolation } from "@/backend/services/classes/session-lifecycle.guards";
import type { DBTransaction, SessionRequestIdempotencySelectType, SessionReturnType } from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS } from "@/shared/constants/session-fees.constants";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants/verification-plan.constants";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The localized errors handle threaded through every gate. */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The ONE bounded denial-log entry a rejection emits: code, entity, entity
 * id. The `entityId` is the DENIED entity's id — for the evaluator gate
 * denials (`EVALUATOR_ALREADY_USED`, `TEACHER_NOT_FOUND`,
 * `TEACHER_NOT_CERTIFIED`) that is the client-submitted evaluator id (the
 * only value the denial has); idempotency-key denials log the actor's
 * applicant id. Never the submitted payload, never a counterparty value.
 */
function logDenial(message: string, code: string, entity: string, entityId: number): void {
  logger.logDomainError(message, { code, entity, entityId });
}

/**
 * Resolves a duplicate-claim booking into its replay outcome: every
 * same-caller duplicate (claimed, backfilled, or vanished — fail-closed)
 * surfaces the duplicate-request conflict, while a key spent by a
 * DIFFERENT caller is denied with the oracle-safe session-not-found
 * error. Throwing keeps the replay free of charge — its partial writes
 * roll back with the transaction.
 */
async function replayBooking(
  key: string,
  actorApplicantUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<never> {
  const claim = await SessionRequestIdempotencyRepository.findByKey(key, tx);
  if (claim !== null && claim.userId !== actorApplicantUserId) {
    logDenial(
      "Evaluation booking replay denied: key claimed by another caller",
      "SESSION_NOT_FOUND",
      "session",
      actorApplicantUserId
    );
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }
  logDenial(
    "Evaluation booking replay blocked: key already claimed",
    "DUPLICATE_REQUEST",
    "session",
    actorApplicantUserId
  );
  throw new ConflictError("DUPLICATE_REQUEST", t.duplicateRequest);
}

/**
 * The applicant lock plus the evaluation-stage status gate plus the
 * active-cycle probe, all under ONE row lock. Every booking by this
 * applicant serializes on the row, so the cycle decision and the
 * aggregate below observe any committed rival booking; a subscription
 * activation racing this booking is serialized on the same row too.
 */
async function lockApplicantInActiveCycle(
  applicantUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<Date> {
  const lockedApplicant = await ApplicantRepository.findForBookingGate(applicantUserId, tx);
  if (lockedApplicant === null) {
    logDenial("Evaluation booking denied: applicant not found", "APPLICANT_NOT_FOUND", "applicants", applicantUserId);
    throw new NotFoundError("APPLICANT", t.applicantNotFound);
  }
  if (lockedApplicant.status !== ApplicantStatus.InEvaluation) {
    logDenial(
      "Evaluation booking denied: applicant not in evaluation stage",
      "APPLICANT_NOT_IN_EVALUATION",
      "applicants",
      applicantUserId
    );
    throw new ConflictError("APPLICANT_NOT_IN_EVALUATION", t.applicantNotInEvaluation);
  }
  const cycle = await SessionRepository.resolveCurrentEvaluationCycle(applicantUserId, tx);
  if (cycle.cycleStart === null) {
    logDenial(
      "Evaluation booking denied: no active verification subscription",
      "VERIFICATION_NOT_ACTIVE",
      "applicants",
      applicantUserId
    );
    throw new ConflictError("VERIFICATION_NOT_ACTIVE", t.verificationSubscriptionNotActive);
  }
  return cycle.cycleStart;
}

/**
 * The cycle's entitlement gates: capacity — a full cycle that also
 * completed all sessions is the congratulatory loop-complete denial, a
 * full cycle with live sessions left is the credits-exhausted denial —
 * then per-cycle evaluator distinctness (cancelled rows do not occupy a
 * slot; the aggregate excludes them).
 */
async function assertCycleCapacity(
  applicantUserId: number,
  cycleStart: Date,
  evaluatorId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<void> {
  const { booked, completed, evaluators } = await SessionRepository.countEvaluationBookingsInCycle(
    applicantUserId,
    cycleStart,
    tx
  );
  if (booked >= VERIFICATION_PLAN_SESSION_COUNT) {
    if (completed >= VERIFICATION_PLAN_SESSION_COUNT) {
      logDenial(
        "Evaluation booking denied: evaluation loop complete",
        "EVALUATION_LOOP_COMPLETE",
        "applicants",
        applicantUserId
      );
      throw new ConflictError("EVALUATION_LOOP_COMPLETE", t.evaluationLoopComplete);
    }
    logDenial(
      "Evaluation booking denied: no evaluation credits remaining",
      "NO_EVALUATION_CREDITS_REMAINING",
      "applicants",
      applicantUserId
    );
    throw new ConflictError("NO_EVALUATION_CREDITS_REMAINING", t.noEvaluationCreditsRemaining);
  }
  if (evaluators.includes(evaluatorId)) {
    logDenial(
      "Evaluation booking denied: evaluator already used in this cycle",
      "EVALUATOR_ALREADY_USED",
      "teacher",
      evaluatorId
    );
    throw new ConflictError("EVALUATOR_ALREADY_USED", t.evaluatorAlreadyUsed);
  }
}

/**
 * The evaluator certification + governance lock — the certification value
 * this booking commits against (the teacher row's flags joined with the
 * owning account's governance flags, `FOR UPDATE`): a teacherless id never
 * mints certification, either flag missing is the same typed not-certified
 * conflict, and a governance-unclean account (deleted, blocked, or
 * suspended) collapses into the SAME oracle-safe not-found denial as an
 * unknown evaluator — the picker already hides governed evaluators, so
 * "not found" is the honest, privacy-preserving answer that burns no
 * credit and notifies no governed account.
 */
async function assertEvaluatorCertified(evaluatorId: number, tx: DBTransaction, t: ErrorsTranslations): Promise<void> {
  const evaluator = await TeacherRepository.findForEvaluationGateById(evaluatorId, tx);
  if (evaluator === null) {
    logDenial("Evaluation booking denied: evaluator not found", "TEACHER_NOT_FOUND", "teacher", evaluatorId);
    throw new NotFoundError("TEACHER", t.teacherNotFound);
  }
  if (evaluator.isApproved !== true || evaluator.isEvaluator !== true) {
    logDenial("Evaluation booking denied: evaluator not certified", "TEACHER_NOT_CERTIFIED", "teacher", evaluatorId);
    throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
  }
  if (evaluator.isDeleted === true || evaluator.isBlocked === true || evaluator.suspended === true) {
    logDenial("Evaluation booking denied: evaluator not found", "TEACHER_NOT_FOUND", "teacher", evaluatorId);
    throw new NotFoundError("TEACHER", t.teacherNotFound);
  }
}

/**
 * The idempotency claim — savepoint-bracketed so a duplicate key poisons
 * only the savepoint, keeping the transaction readable for the replay
 * lookup. Any other failure surfaces untouched (the transaction rolls
 * the whole booking and the claim back together — a failed booking
 * never burns its key).
 */
async function claimIdempotencyOrReplay(
  idempotencyKey: string,
  applicantUserId: number,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<SessionRequestIdempotencySelectType> {
  try {
    return await tx.transaction(claimTx =>
      SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey, userId: applicantUserId }, claimTx)
    );
  } catch (error) {
    if (!isClaimKeyUniqueViolation(error)) {
      throw error;
    }
    return replayBooking(idempotencyKey, applicantUserId, tx, t);
  }
}

/**
 * The session insert — every server-controlled column set field by field
 * (the evaluator id is the ONLY client-owned value). Evaluation sessions
 * draw no escrow: fee, hold flag, and lane stay null/false; the
 * confirmation deadline derives from the flow's single captured instant.
 */
async function insertEvaluationSession(
  applicantUserId: number,
  evaluatorId: number,
  now: Date,
  tx: DBTransaction
): Promise<SessionReturnType> {
  return SessionRepository.insertSession(
    {
      teacherId: evaluatorId,
      studentId: applicantUserId,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.TeacherEvaluation,
      intent: SessionIntent.Evaluation,
      fee: null,
      feeHeld: false,
      heldBalanceLane: null,
      startedAt: null,
      endedAt: null,
      confirmedByStudentAt: null,
      confirmedByTeacherAt: null,
      confirmationDeadline: new Date(now.getTime() + SESSION_CONFIRMATION_WINDOW_MS),
      cancelReason: null,
      disputeReason: null,
      disputedAt: null,
      resolutionNote: null,
      resolutionOutcome: null,
      resolvedAt: null,
    },
    tx
  );
}

/**
 * The booking transaction body — the fixed, never-reordered order:
 * applicant lock → status gate → cycle probe → capacity + distinctness
 * gates → evaluator certification + governance lock → idempotency claim →
 * session insert → claim backfill. Any failure rolls the whole booking back,
 * which also releases the claim (a failed booking never burns its key).
 */
export async function bookEvaluationInTx(
  applicantUserId: number,
  evaluatorId: number,
  idempotencyKey: string,
  now: Date,
  tx: DBTransaction,
  t: ErrorsTranslations
): Promise<SessionReturnType> {
  const cycleStart = await lockApplicantInActiveCycle(applicantUserId, tx, t);
  await assertCycleCapacity(applicantUserId, cycleStart, evaluatorId, tx, t);
  await assertEvaluatorCertified(evaluatorId, tx, t);
  const claim = await claimIdempotencyOrReplay(idempotencyKey, applicantUserId, tx, t);
  const createdSession = await insertEvaluationSession(applicantUserId, evaluatorId, now, tx);
  await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, createdSession.id, tx);
  return createdSession;
}
