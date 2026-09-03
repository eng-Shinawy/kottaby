/**
 * SessionLifecycleService — dual-confirmation flow internals (module
 * extraction, behavior-identical): the transaction body of
 * `confirmSessionCompletion`, the second half of the dual-confirmation
 * contract. The flow is IDEMPOTENT and its financial slice fires EXACTLY
 * once per session:
 *
 *  - STUDENT caller on a completed row with the hold still marked and
 *    both stamps completable: ONE guarded UPDATE writes the student
 *    stamp and flips `fee_held = false` (the exactly-once guard lives in
 *    the statement's predicate), then — same transaction — the credit
 *    slice composes through the wallet repository: the teacher's wallet
 *    row is ensured (idempotent ON CONFLICT insert; no approval-time
 *    wallet writer exists yet), ONE `earning` ledger row is inserted
 *    with the session's `fee` taken verbatim, and the wallet's
 *    `balance`/`total_earning` increase by exactly that fee (no DB
 *    trigger exists — the increment is explicit, atomic with the ledger
 *    row).
 *  - Already-confirmed student, an already-released hold (admin
 *    arbitration consumed it first), or the TEACHER caller (whose stamp
 *    `completeSessionOnce` already wrote): the current row is returned
 *    untouched — ZERO financial writes, the honest idempotent answer.
 *  - A zero-row guarded miss on a live-state row is classified by one
 *    cold probe read (unknown/non-participant → not-found, oracle-safe;
 *    anything else → transition conflict), so a foreign caller can never
 *    distinguish a missing row from one they do not own.
 *
 * The public surface stays the `SessionLifecycleService` namespace in
 * `session-lifecycle.service.ts` (the namespace method owns the boundary
 * id guard and the `withTransaction` composition). Nothing in this module
 * is part of the public API.
 */

import { SessionRepository, WalletRepository } from "@/backend/db/repo";
import { ConflictError, NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SESSION_COMPLETED_STATUS } from "@/backend/services/classes/session-lifecycle.guards";
import type { DBTransaction, SessionReturnType, SessionTransitionProbeRowType } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Teacher-earning credit slice — same transaction, composed through the
 * wallet repository: ensure the wallet, insert the `earning` ledger row
 * with the fee VERBATIM, increment the wallet. The fee is passed
 * pre-narrowed by the caller's null check (a hold-marked row always
 * carries its platform fee — the booking invariant).
 */
async function creditTeacherEarning(confirmed: SessionReturnType, fee: string, tx: DBTransaction): Promise<void> {
  const teacherWallet = await WalletRepository.ensureWalletOnce(confirmed.teacherId, tx);
  await WalletRepository.creditEarningOnce(
    {
      walletId: teacherWallet.id,
      sessionId: confirmed.id,
      amount: fee,
      description: `Session #${confirmed.id} earning (dual confirmation)`,
    },
    tx
  );
}

/**
 * Oracle-safe not-found denial: the probe read found no row, or the row
 * belongs to neither participant — a foreign caller can never distinguish
 * a missing row from one they do not own.
 */
function rejectUnknownCaller(
  sessionId: number,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): never {
  logger.logDomainError("Session confirmation denied: session not found for caller", {
    code: "SESSION_NOT_FOUND",
    entity: "session",
    entityId: sessionId,
  });
  throw new NotFoundError("SESSION", t.sessionNotFound);
}

/**
 * Participant idempotence arms — the row exists and the caller owns it.
 * Any already-settled shape returns the CURRENT row untouched: the student
 * re-confirming, the teacher confirming (their stamp was written by
 * `completeSessionOnce`), or a hold the admin arbitration already
 * consumed. A `completed` row is the only idempotent shape; anything else
 * is a lifecycle-state conflict.
 */
async function resolveSettledOrConflict(
  sessionId: number,
  probe: SessionTransitionProbeRowType,
  tx: DBTransaction,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<SessionReturnType> {
  if (probe.status === SESSION_COMPLETED_STATUS) {
    const current = await SessionRepository.findById(sessionId, tx);
    if (current !== null) {
      return current;
    }
  }
  logger.logDomainError("Session confirmation denied: session not confirmable in its current state", {
    code: "SESSION_INVALID_TRANSITION",
    entity: "session",
    entityId: sessionId,
  });
  throw new ConflictError("SESSION_INVALID_TRANSITION", t.sessionInvalidTransition);
}

/**
 * The confirmation transaction body: the exactly-once slice (student stamp
 * + hold release in ONE guarded statement) with the teacher-earning credit
 * composed on the same transaction, and the zero-row miss classified by
 * ONE cold probe read (classification-only — it never feeds a write).
 */
export async function confirmCompletionInTx(
  callerUserId: number,
  sessionId: number,
  tx: DBTransaction,
  t: ReturnType<typeof getServerTranslations>["errorsTranslations"]
): Promise<SessionReturnType> {
  const confirmed = await SessionRepository.confirmStudentCompletionOnce(sessionId, callerUserId, tx);
  if (confirmed !== null) {
    // A hold-marked row always carries its platform fee (the booking
    // invariant) — a null here is a data impossibility that
    // fails closed instead of crediting an unpriced lesson.
    if (confirmed.fee === null) {
      logger.error("Dual-confirmation blocked: completed hold-marked session without a fee", {
        sessionId: confirmed.id,
      });
      throw new Error("SessionLifecycleService.confirmSessionCompletion: missing session fee");
    }
    await creditTeacherEarning(confirmed, confirmed.fee, tx);
    return confirmed;
  }

  // Zero-row miss — classify. The probe read is classification-only.
  const probe = await SessionRepository.findTransitionProbe(sessionId, tx);
  if (probe === null || (probe.studentId !== callerUserId && probe.teacherId !== callerUserId)) {
    return rejectUnknownCaller(sessionId, t);
  }
  return resolveSettledOrConflict(sessionId, probe, tx, t);
}
