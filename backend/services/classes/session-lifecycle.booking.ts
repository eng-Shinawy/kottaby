/**
 * SessionLifecycleService — booking flow internals (module extraction,
 * behavior-identical): the transaction body of `createSession`, decomposed
 * into composable units that keep the fixed write order visible:
 *
 *   1. the teacher certification lock (a `SELECT … FOR UPDATE` read whose
 *      certification value is the one the booking commits against);
 *   2. the guarded trial-first balance debit ladder (the trial lane is
 *      attempted first, then the intent's own lane; an all-miss booking
 *      throws and the transaction rolls back — the rollback is the only
 *      cleanup, no compensating writes exist);
 *   3. the idempotency claim insert (savepoint-bracketed so a duplicate key
 *      rolls back only the claim statement and keeps the surrounding
 *      transaction readable for the replay lookup);
 *   4. the session insert with server-side defaults (lifecycle state, type,
 *      intent, platform fee, hold marker + provenance lane, confirmation
 *      deadline) followed by the claim's session-id backfill.
 *
 * On a duplicate claim key the flow REPLAYS BY THROWING
 * (`ConflictError("DUPLICATE_REQUEST")` — never a row): throwing is what
 * keeps the replayed attempt free of charge, its own partial writes roll
 * back with the transaction. A key spent by a DIFFERENT caller is denied
 * with the oracle-safe session-not-found error — another user's claim is
 * never surfaced.
 *
 * The public surface stays the `SessionLifecycleService` namespace in
 * `session-lifecycle.service.ts` (the namespace method owns the boundary
 * validation ordering, the governance re-check, the captured instant, and
 * the `withTransaction` composition). Nothing in this module is part of
 * the public API.
 */

import {
  SessionRepository,
  SessionRequestIdempotencyRepository,
  StudentRepository,
  TeacherRepository,
} from "@/backend/db/repo";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionIntent } from "@/backend/enum/scheduling/session-intent.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { SessionType } from "@/backend/enum/scheduling/session-type.enum";
import { ConflictError, NotFoundError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  intentLaneFor,
  isClaimKeyUniqueViolation,
  isPositiveSafeInteger,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  sessionFeeForIntent,
} from "@/backend/services/classes/session-lifecycle.guards";
import type {
  DBTransaction,
  SessionRequestIdempotencySelectType,
  SessionReturnType,
  SessionStudentIntentType,
  SessionSubmitInput,
} from "@/backend/types";
import { SESSION_CONFIRMATION_WINDOW_MS } from "@/shared/constants/session-fees.constants";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Pre-DB boundary validation — the client-controlled whitelist and the
 * acting student's identity fail closed BEFORE any database work: the
 * participant ids as positive safe integers, the idempotency key within
 * the claim column's length (carried verbatim — never trimmed, never
 * coerced, never logged), and the intent against the bookable vocabulary.
 */
export function assertBookingBoundary(
  studentId: number,
  input: SessionSubmitInput,
  idempotencyKey: string,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): void {
  if (!isPositiveSafeInteger(studentId)) {
    throw new ValidationError(t.validation);
  }
  if (!isPositiveSafeInteger(input.teacherId)) {
    throw new ValidationError(t.validation);
  }
  if (idempotencyKey.length === 0 || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ValidationError(t.idempotencyKeyRequired);
  }
  if (input.intent !== SessionIntent.Hifz && input.intent !== SessionIntent.Tajweed) {
    throw new ValidationError(t.invalidSessionIntent);
  }
}

/**
 * Trial-first debit ladder: the trial lane is always attempted first, then
 * the intent's own lane. An all-miss booking throws — the transaction
 * rollback is the only cleanup. Returns the provenance lane that funded
 * the hold.
 */
async function debitBookingLadder(
  studentId: number,
  intent: SessionStudentIntentType,
  tx: DBTransaction,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<HeldBalanceLane> {
  const trialDebited = await StudentRepository.decrementLaneIfAvailable(studentId, HeldBalanceLane.Trial, tx);
  if (trialDebited) {
    return HeldBalanceLane.Trial;
  }
  const intentLane = intentLaneFor(intent);
  const intentDebited = await StudentRepository.decrementLaneIfAvailable(studentId, intentLane, tx);
  if (!intentDebited) {
    logger.logDomainError("Session booking rejected: insufficient balance", {
      code: "INSUFFICIENT_BALANCE",
      entity: "session",
      entityId: studentId,
    });
    throw new ValidationError("INSUFFICIENT_BALANCE", t.insufficientBalance);
  }
  return intentLane;
}

/**
 * The session insert — every server-controlled column is set here, field
 * by field (BOPLA: never a spread of caller input). The fee is the
 * platform constant for the intent, carried verbatim as a decimal string;
 * the confirmation deadline is the captured instant plus the platform
 * confirmation window.
 */
async function insertBookedSession(
  studentId: number,
  input: SessionSubmitInput,
  heldLane: HeldBalanceLane,
  now: Date,
  tx: DBTransaction
): Promise<SessionReturnType> {
  return SessionRepository.insertSession(
    {
      teacherId: input.teacherId,
      studentId,
      status: SessionStatus.Scheduled,
      sessionType: SessionType.StudentSession,
      intent: input.intent,
      fee: sessionFeeForIntent(input.intent),
      feeHeld: true,
      heldBalanceLane: heldLane,
      confirmationDeadline: new Date(now.getTime() + SESSION_CONFIRMATION_WINDOW_MS),
    },
    tx
  );
}

/**
 * Resolves a duplicate-claim booking into its replay outcome.
 *
 * Every same-caller duplicate — a claim with or without its session
 * pointer, and a vanished claim (fail-closed) — surfaces the
 * duplicate-replay conflict. THROWING (never returning a row) is what
 * makes a replay free of charge: this attempt's own partial writes (its
 * debit-ladder step) roll back with the transaction, so the replay
 * commits zero new rows and burns no second allowance unit;
 * the success-equivalent experience is the client-side mapping of this
 * 409 per the error-handling contract (`duplicateSuccessEquivalent`).
 * A key spent by a DIFFERENT caller is denied with the oracle-safe
 * session-not-found error — another user's claim is never surfaced.
 */
async function replayBooking(
  key: string,
  actorStudentId: number,
  tx: DBTransaction,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<never> {
  const claim = await SessionRequestIdempotencyRepository.findByKey(key, tx);
  if (claim !== null && claim.userId !== actorStudentId) {
    logger.logDomainError("Session booking replay denied: key claimed by another caller", {
      code: "SESSION_NOT_FOUND",
      entity: "session",
      entityId: actorStudentId,
    });
    throw new NotFoundError("SESSION", t.sessionNotFound);
  }
  logger.logDomainError("Session booking replay blocked: key already claimed", {
    code: "DUPLICATE_REQUEST",
    entity: "session",
  });
  throw new ConflictError("DUPLICATE_REQUEST", t.duplicateRequest);
}

/**
 * The booking transaction body — the FOUR writes in their fixed, never
 * reordered order (certification lock → debit ladder → savepoint-bracketed
 * idempotency claim → session insert + claim backfill). Any failure rolls
 * the whole booking back, which also releases the claim (a failed booking
 * never burns its key). A duplicate claim key never reaches the insert:
 * the flow replays by throwing through `replayBooking`.
 */
export async function bookSessionInTx(
  studentId: number,
  input: SessionSubmitInput,
  idempotencyKey: string,
  now: Date,
  tx: DBTransaction,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<SessionReturnType> {
  // The teacher certification lock — the certification value this
  // booking commits against (a teacherless id never mints certification).
  const lockedTeacher = await TeacherRepository.lockForCertificationCheck(input.teacherId, tx);
  if (lockedTeacher === null) {
    logger.logDomainError("Session booking rejected: teacher target not found", {
      code: "TEACHER_NOT_FOUND",
      entity: "session",
      entityId: input.teacherId,
    });
    throw new NotFoundError("TEACHER", t.teacherNotFound);
  }
  if (lockedTeacher.isApproved !== true) {
    logger.logDomainError("Session booking rejected: teacher not certified", {
      code: "TEACHER_NOT_CERTIFIED",
      entity: "session",
      entityId: input.teacherId,
    });
    throw new ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified);
  }

  const heldLane = await debitBookingLadder(studentId, input.intent, tx, t);

  // The idempotency claim — savepoint-bracketed so a duplicate key
  // poisons only the savepoint, keeping the transaction readable for the
  // replay lookup below.
  let claim: SessionRequestIdempotencySelectType;
  try {
    claim = await tx.transaction(claimTx =>
      SessionRequestIdempotencyRepository.insertClaim({ idempotencyKey, userId: studentId }, claimTx)
    );
  } catch (error) {
    if (!isClaimKeyUniqueViolation(error)) {
      // Not a duplicate key — surface untouched; the transaction rolls
      // the whole booking (and the claim) back together.
      throw error;
    }
    // Duplicate key → the idempotent replay branch.
    return replayBooking(idempotencyKey, studentId, tx, t);
  }

  const createdSession = await insertBookedSession(studentId, input, heldLane, now, tx);

  // Backfill the claim's session pointer in the same transaction — the
  // claim and the session commit atomically.
  await SessionRequestIdempotencyRepository.updateClaimSessionId(claim.id, createdSession.id, tx);

  return createdSession;
}
