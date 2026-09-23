/**
 * SessionArbitrationService — flow internals (module extraction, the
 * sibling-helpers layout of the session services): the consumed-escrow
 * dispute path's pre-DB guards, denial classifiers, financial-leg
 * composition, and the arbitration audit contract.
 *
 * The dispute generations are discriminated by the row's persisted hold
 * marker (`fee_held`): a held dispute resolves through the shipped
 * held-family service (Cancel | Complete), a consumed dispute — the fee
 * already credited to the teacher's wallet by the dual confirmation —
 * resolves HERE through the three-outcome vocabulary (Refund |
 * PartialRefund | Uphold). Every classifier below is a typed denial that
 * logs exactly one bounded domain error; the not-found / state-conflict
 * pair is shared verbatim with the governance surface's classifiers so
 * every session surface emits the same two denial shapes.
 *
 * Financial legs:
 *  - the teacher reversal is the compensating ledger row: one `arbitration_reversal`
 *    ledger row keyed to the session, plus the guarded balance decrement,
 *    on the caller's transaction — a `null` from the guarded debit means
 *    insufficient funds, which fails the whole arbitration (zero financial
 *    writes survive);
 *  - the student compensation is the quantized session-credit ruling: ONE
 *    credit to the row's recorded provenance lane for BOTH refund
 *    outcomes, never a fractional lane write; a row with no recorded lane
 *    refunds nothing (the never-held defensive case), an unreadable lane
 *    fails closed;
 *  - the partial amount is a strict decimal string: two fractions at
 *    most, strictly positive, strictly below the session fee — validated
 *    before the first write, and the exact supplied string is what the
 *    debit and the audit row carry (never re-parsed, never re-rounded).
 *
 * Nothing in this module is part of the public API.
 */

import { StudentRepository, WalletRepository } from "@/backend/db/repo";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { DisputeResolution, isDisputeResolution } from "@/backend/enum/scheduling/dispute-resolution.enum";
import { type HeldBalanceLane, isHeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { ConflictError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  rejectSessionNotFound,
  rejectStateConflict,
} from "@/backend/services/classes/session-admin-governance.helpers";
import { SESSION_COMPLETED_STATUS, SESSION_DISPUTED_STATUS } from "@/backend/services/classes/session-lifecycle.guards";
import type { AuditLogWriteContract, DBTransaction, SessionArbitrationProbeType } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace slice, typed once for this module's denial classifiers. */
type ArbitrationErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * The strict decimal shape of a partial refund amount: digits only, an
 * optional fraction of AT MOST two places — the `decimal(10,2)` money
 * convention. Anything else (signs, exponent forms, thousand separators,
 * a third fraction) is rejected before the value ever reaches a ledger.
 */
const PARTIAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/** The audit row's entity label for this surface (the short lowercase entity label). */
const SESSION_ENTITY_TYPE = "session";

/**
 * The compensating ledger row's distinguishing description: the reversal
 * is traceable end to end through the ledger because the row names its
 * session (and the row's `session_id` FK keys it again structurally).
 */
function disputeRefundLedgerDescription(sessionId: number): string {
  return `Dispute refund reversal — Session #${sessionId}`;
}

/**
 * Classification-mismatch denial: the submitted resolution does not apply
 * to the row's escrow generation. Typed as the plain `VALIDATION` code per
 * the arbitration error matrix, carrying the dedicated localized copy.
 */
export function rejectResolutionFamilyMismatch(
  denial: string,
  sessionId: number,
  t: ArbitrationErrorsTranslations
): never {
  logger.logDomainError(denial, {
    code: "VALIDATION",
    entity: "session",
    entityId: sessionId,
  });
  throw new ValidationError(t.disputeResolutionMismatch);
}

/** Partial-amount denial: the supplied amount failed the validation matrix. */
function rejectPartialAmountInvalid(denial: string, sessionId: number, t: ArbitrationErrorsTranslations): never {
  logger.logDomainError(denial, {
    code: "VALIDATION",
    entity: "session",
    entityId: sessionId,
  });
  throw new ValidationError(t.partialRefundAmountInvalid);
}

/**
 * Pre-DB resolution policy for the arbitration surface: the resolution
 * vocabulary is re-guarded at runtime (a payload that skipped the
 * boundary's enum parse fails closed), and the held-family outcomes are
 * rejected outright — they belong to the shipped held-escrow resolution
 * service, and accepting them here would apply Cancel/Complete semantics
 * to a consumed row.
 */
export function assertArbitrationResolution(
  resolution: DisputeResolution,
  sessionId: number,
  t: ArbitrationErrorsTranslations
): void {
  if (!isDisputeResolution(resolution)) {
    throw new ValidationError(t.validation);
  }
  if (resolution === DisputeResolution.Cancel || resolution === DisputeResolution.Complete) {
    rejectResolutionFamilyMismatch(
      "Session arbitration denied: Cancel/Complete resolve held-escrow disputes, not consumed ones",
      sessionId,
      t
    );
  }
}

/** Strict decimal shape check for a partial refund amount (see the pattern). */
function isPartialAmountShape(value: string): boolean {
  return PARTIAL_AMOUNT_PATTERN.test(value);
}

/**
 * Resolves the arbitration's teacher-debit amount BEFORE any write, from
 * the row's classification read. The full amount policy in one place:
 *  - `Refund` → the session's own fee, carried verbatim (a disputed
 *    consumed row always carries its fee — the booking invariant — so a
 *    null fee is a data impossibility that fails closed);
 *  - `PartialRefund` → the supplied string, which must be present, match
 *    the strict decimal shape, and sit strictly between zero and the
 *    session fee; the exact supplied string is returned (never re-parsed
 *    into a number for storage, never re-rounded);
 *  - `Uphold` → `null` (zero financial writes).
 * A stray amount supplied alongside ANY non-partial outcome is rejected —
 * no money input is ever silently ignored on any resolution.
 */
export function resolveArbitrationDebitAmount(
  resolution: DisputeResolution,
  partialAmount: string | null,
  feeCeiling: string | null,
  sessionId: number,
  t: ArbitrationErrorsTranslations
): string | null {
  if (resolution !== DisputeResolution.PartialRefund && partialAmount !== null) {
    return rejectPartialAmountInvalid(
      "Session arbitration denied: partial amount supplied without a PartialRefund outcome",
      sessionId,
      t
    );
  }
  if (resolution === DisputeResolution.Refund) {
    if (feeCeiling === null) {
      throw new Error("SessionArbitrationService.arbitrateDispute: disputed consumed session without a fee");
    }
    return feeCeiling;
  }
  if (resolution === DisputeResolution.PartialRefund) {
    if (partialAmount === null || !isPartialAmountShape(partialAmount)) {
      return rejectPartialAmountInvalid("Session arbitration denied: malformed partial refund amount", sessionId, t);
    }
    if (feeCeiling === null) {
      throw new Error("SessionArbitrationService.arbitrateDispute: disputed consumed session without a fee");
    }
    const amountValue = Number(partialAmount);
    const feeValue = Number(feeCeiling);
    if (amountValue <= 0 || amountValue >= feeValue) {
      return rejectPartialAmountInvalid(
        "Session arbitration denied: partial refund amount outside the open (0, fee) range",
        sessionId,
        t
      );
    }
    return partialAmount;
  }
  return null;
}

/**
 * Composes the arbitration's audit-log write contract: ONE `Override` row
 * for the session entity whose `details` carries the resolution, the
 * refunded amount under its outcome's own key (`refundAmount` for the
 * full refund, `partialAmount` for the partial), and the note's PRESENCE
 * only — the note's free-text content never enters the trail. The
 * composed row is persisted by `AuditService.createAuditLog` on the
 * arbitration's own transaction so it can never outlive a rolled-back
 * resolution.
 */
export function buildArbitrationAuditContract(
  adminId: number,
  sessionId: number,
  resolution: DisputeResolution,
  amount: string | null,
  notePresent: boolean
): AuditLogWriteContract {
  let details: Record<string, unknown>;
  if (resolution === DisputeResolution.Refund) {
    details = { resolution, refundAmount: amount, notePresent };
  } else if (resolution === DisputeResolution.PartialRefund) {
    details = { resolution, partialAmount: amount, notePresent };
  } else {
    details = { resolution, notePresent };
  }
  return {
    actorId: adminId,
    actionType: AuditActionType.Override,
    entityType: SESSION_ENTITY_TYPE,
    entityId: sessionId,
    details: JSON.stringify(details),
  };
}

/**
 * Credits the student's originally-held balance lane with ONE session
 * credit (the quantized refund unit — integer lanes cannot represent a
 * fractional credit) on the caller's transaction. A
 * row with no recorded lane has nothing to refund — the skip is a no-op,
 * mirroring the held-family refund primitive's semantics, while the
 * teacher debit still applies. The provenance column is read back from
 * the arbitration write's own probe: an unreadable value fails closed
 * (the refusal rolls the arbitration back, leaving the row and both
 * ledgers consistent).
 */
export async function creditLaneForArbitration(
  studentId: number,
  lane: HeldBalanceLane | null,
  sessionId: number,
  tx: DBTransaction
): Promise<void> {
  if (lane === null) {
    return;
  }
  if (!isHeldBalanceLane(lane)) {
    logger.error("Session arbitration blocked: unreadable held-balance lane", {
      sessionId,
    });
    throw new Error("SessionArbitrationService.arbitrateDispute: unreadable held-balance lane");
  }
  await StudentRepository.incrementLane(studentId, lane, tx);
}

/**
 * The teacher reversal leg on the caller's transaction: the wallet row is
 * ensured (the credit slice's idempotent writer — a teacher credited by
 * the dual confirmation already has one), then ONE compensating
 * `arbitration_reversal` ledger row keyed to the session plus the guarded balance
 * decrement. A `null` from the guarded debit means insufficient funds:
 * the typed conflict fails the whole arbitration transaction, so the
 * compensating row, the debit, the session flip, and the lane credit all
 * roll back together (zero financial writes survive a shortfall).
 */
export async function debitTeacherWalletForArbitration(
  teacherId: number,
  sessionId: number,
  amount: string,
  t: ArbitrationErrorsTranslations,
  tx: DBTransaction
): Promise<void> {
  const teacherWallet = await WalletRepository.ensureWalletOnce(teacherId, tx);
  const debited = await WalletRepository.debitForArbitrationOnce(
    {
      walletId: teacherWallet.id,
      sessionId,
      amount,
      description: disputeRefundLedgerDescription(sessionId),
    },
    tx
  );
  if (debited === null) {
    logger.logDomainError("Session arbitration denied: insufficient teacher wallet balance", {
      code: "WALLET_INSUFFICIENT_FUNDS",
      entity: "session",
      entityId: sessionId,
    });
    throw new ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance);
  }
}

/**
 * Classifies the post-confirmation dispute entry's pre-write probe for the
 * CALLING STUDENT (the participant-only oracle contract): an unknown id
 * and a caller who is not the session's student are the SAME not-found
 * denial — a foreign target is indistinguishable from a nonexistent one,
 * so the student identity is only ever the caller's own. A row the caller
 * owns that is not in the disputable shape (dual-confirmed `completed`
 * with the escrow consumed) is the lifecycle-state conflict.
 */
export function classifyOpenDisputeProbe(
  probe: SessionArbitrationProbeType,
  callerUserId: number,
  sessionId: number,
  t: ArbitrationErrorsTranslations
): void {
  if (probe.studentId !== callerUserId) {
    rejectSessionNotFound("Post-confirmation dispute denied: caller is not the session's student", sessionId, t);
  }
  // Arbitration terminality: a stamped `resolved_at` means an admin has
  // already decided this row's dispute (BOTH resolution families stamp it)
  // — the decision is binding, so the row can never re-enter the disputed
  // state (a re-opened case could be re-arbitrated into a second money
  // movement for the same fee).
  if (probe.resolvedAt !== null) {
    rejectStateConflict("Post-confirmation dispute denied: the dispute was already arbitrated", sessionId, t);
  }
  if (probe.status !== SESSION_COMPLETED_STATUS || probe.confirmedByStudentAt === null || probe.feeHeld !== false) {
    rejectStateConflict("Post-confirmation dispute denied: session not disputable in its current state", sessionId, t);
  }
}

/**
 * Classifies the arbitration's pre-write probe for the ADMIN surface (the
 * role-gated surface distinguishes state, never participants): an unknown
 * id is the not-found denial, a row outside the disputed state is the
 * lifecycle-state conflict, and a DISPUTED row whose fee is still held is
 * the classification mismatch — a held-generation dispute resolves through
 * the shipped held-family service, never through the consumed-family
 * vocabulary.
 */
export function classifyArbitrationProbe(
  probe: SessionArbitrationProbeType,
  sessionId: number,
  t: ArbitrationErrorsTranslations
): void {
  if (probe.status !== SESSION_DISPUTED_STATUS) {
    rejectStateConflict("Session arbitration denied: session not resolvable in its current state", sessionId, t);
  }
  if (probe.feeHeld !== false) {
    rejectResolutionFamilyMismatch(
      "Session arbitration denied: a held-escrow dispute resolves through the held-family service",
      sessionId,
      t
    );
  }
}
