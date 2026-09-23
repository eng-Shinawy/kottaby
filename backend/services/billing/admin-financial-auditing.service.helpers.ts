/**
 * AdminFinancialAuditingService — pure pre-DB validators, normalizers, and
 * audit-contract builders (module extraction, per the service-layer
 * `.helpers.ts` convention). Nothing here touches the database, opens a
 * transaction, or logs — every function is pure (or throws the canonical
 * typed `VALIDATION` denial) and every builder is a closed vocabulary.
 *
 * Members:
 *  - the amount validator (`assertValidAdjustmentAmount`) — the decimal-string
 *    grammar + positivity, fail-closed BEFORE any database work;
 *  - the reason normalizer (`normalizeAdjustmentReason`) — trim + length cap,
 *    whitespace-only and over-limit content reject with the localized denial;
 *  - the description-marker composers (`composeCreditDescription` /
 *    `composeDebitDescription`) — machine-distinguishable ledger vocabulary
 *    that never collides with the shipped payout-request wording;
 *  - the audit-contract builders (`buildWithdrawalSettleAuditContract` /
 *    `buildWalletAdjustmentAuditContract`) — the D-4 vocabulary mapped onto
 *    the single-writer `AuditLogWriteContract` shape; `reasonPresent` is a
 *    BOOLEAN — the raw reason text is NEVER persisted in audit details.
 */

import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { ValidationError } from "@/backend/lib/errors";
import type { AuditLogWriteContract } from "@/backend/types";
import type { getServerTranslations } from "@/shared/locale/server-graphql";

/** The audit entity label for settlement/adjustment rows (`audit_logs.entity_type`). */
const TRANSACTION_ENTITY_TYPE = "teacher_transaction";

/**
 * The render label for wallet amounts (the platform currency constant).
 * The `wallet` table has no currency column — the constant rides the same
 * convention as the shipped wallet Pothos object's `currency` field.
 */
export const ADMIN_WALLET_CURRENCY_LABEL = "EGP";

/**
 * The adjustment amount shape: 1-7 integer digits, an optional 1-2 digit
 * fraction — the exact decimal-string grammar the shipped payout request
 * uses. The cap matches the `wallet.balance` column capacity
 * (`decimal(10,2)`): an amount that could never fit a real balance is
 * rejected pre-DB instead of a generic overflow error.
 */
const ADJUSTMENT_AMOUNT_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

/**
 * A free-text adjustment reason longer than this is rejected before any DB
 * work. The cap is the `teacher_transaction.description` column capacity
 * (`varchar(255)`) minus the 26 chars of composed-prefix headroom: the
 * ledger description is the sanctioned reason store and prepends a 25-char
 * marker, so a longer reason would overflow the column inside the mutation
 * (Postgres 22001 surfacing as a generic internal error instead of the
 * typed VALIDATION denial).
 */
const MAX_REASON_LENGTH = 229;

/** The `audit_logs.details` column ceiling — payloads are capped BEFORE insert. */
const AUDIT_DETAILS_MAX_LENGTH = 2000;

/** Localized-error bundle type (the errorsTranslations namespace). */
type ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"];

/**
 * Validates an adjustment amount (pre-DB, fail-closed). The value must match
 * the decimal-string grammar AND be strictly positive — positivity is a
 * "contains at least one nonzero digit" string check, so no numeric parse
 * ever touches a money value.
 *
 * @returns The TRIMMED amount (the value carried onward verbatim).
 */
export function assertValidAdjustmentAmount(rawAmount: string, t: ErrorsTranslations): string {
  const trimmed = rawAmount.trim();
  if (!ADJUSTMENT_AMOUNT_PATTERN.test(trimmed) || !/[1-9]/.test(trimmed)) {
    throw new ValidationError(t.invalidAdjustmentAmount);
  }
  return trimmed;
}

/**
 * Normalizes a REQUIRED free-text adjustment reason: trims, then rejects
 * whitespace-only and over-limit content with the pre-DB `VALIDATION`
 * denial. The trimmed value feeds the ledger description marker — the audit
 * details only ever record a `reasonPresent` boolean, never the raw text.
 */
export function normalizeAdjustmentReason(value: string, t: ErrorsTranslations): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_REASON_LENGTH) {
    throw new ValidationError(t.adjustmentReasonRequired);
  }
  return trimmed;
}

/**
 * Composes the bonus (credit) ledger description: the machine-distinguishable
 * manual-adjustment marker followed by the normalized reason. The ledger row
 * is the ONLY place the reason text is stored (write-once at adjustment time
 * per the rejection-reason discipline).
 */
export function composeCreditDescription(reason: string): string {
  return `Manual bonus adjustment: ${reason}`;
}

/**
 * Composes the debit ledger description: the same manual-adjustment marker
 * vocabulary, direction-explicit so a `withdrawal/completed` adjustment row
 * can never be confused with a teacher-filed payout request (whose shipped
 * description wording is different by contract).
 */
export function composeDebitDescription(reason: string): string {
  return `Manual debit adjustment: ${reason}`;
}

/**
 * Serializes audit details under the `audit_logs.details` column ceiling
 * WITHOUT ever storing truncated (unparseable) JSON: a plain slice can cut
 * mid-JSON, so instead the details object is rebuilt with keys dropped
 * (least-significant first) until the serialized form fits the cap. Every
 * value here is a bounded primitive (short string / number / boolean), so
 * key-dropping always converges well before the object is emptied; if a
 * pathological payload still overflowed, the final fallback is a
 * minimal parseable record. The `action` marker is preserved whenever it
 * can possibly fit — it is the audit trail's decision vocabulary.
 */
function serializeAuditDetails(details: Record<string, unknown>): string {
  if (JSON.stringify(details).length <= AUDIT_DETAILS_MAX_LENGTH) {
    return JSON.stringify(details);
  }
  const keys = Object.keys(details)
    .filter(key => key !== "action")
    .toReversed();
  let candidate: Record<string, unknown> = { ...details };
  for (const key of keys) {
    const { [key]: _dropped, ...rest } = candidate;
    candidate = rest;
    const serialized = JSON.stringify(candidate);
    if (serialized.length <= AUDIT_DETAILS_MAX_LENGTH) {
      return serialized;
    }
  }
  const action = details.action;
  const minimal: Record<string, unknown> = typeof action === "string" ? { action } : {};
  return JSON.stringify(minimal);
}

/**
 * Builds the audit contract for a settled withdrawal (approve / reject) —
 * the D-4 vocabulary: `Override` action on the `teacher_transaction` entity,
 * details carrying the action marker, the verbatim amount, the wallet and
 * teacher ids, and — for rejections only — a `reasonPresent` BOOLEAN (the
 * raw reason text is NEVER persisted in audit details).
 */
export function buildWithdrawalSettleAuditContract(input: {
  readonly actorId: number;
  readonly transactionId: number;
  readonly walletId: number;
  readonly teacherId: number;
  readonly amount: string;
  readonly action: "withdrawal_approved" | "withdrawal_rejected";
  readonly reasonPresent?: boolean;
}): AuditLogWriteContract {
  const details: Record<string, unknown> = {
    action: input.action,
    amount: input.amount,
    walletId: input.walletId,
    teacherId: input.teacherId,
  };
  if (input.reasonPresent !== undefined) {
    details.reasonPresent = input.reasonPresent;
  }
  return {
    actorId: input.actorId,
    actionType: AuditActionType.Override,
    entityType: TRANSACTION_ENTITY_TYPE,
    entityId: input.transactionId,
    details: serializeAuditDetails(details),
  };
}

/**
 * Builds the audit contract for a manual wallet adjustment — the D-4
 * vocabulary: `Adjust` action, details carrying the action marker, the
 * direction, the verbatim amount, the wallet and teacher ids, the
 * `reasonPresent` BOOLEAN (never the raw reason), and the post-write
 * `balanceAfter` read back from the wallet.
 */
export function buildWalletAdjustmentAuditContract(input: {
  readonly actorId: number;
  readonly transactionId: number;
  readonly walletId: number;
  readonly teacherId: number;
  readonly amount: string;
  readonly direction: WalletAdjustmentDirection;
  readonly balanceAfter: string;
  readonly reasonPresent: boolean;
}): AuditLogWriteContract {
  const details: Record<string, unknown> = {
    action: "wallet_adjustment",
    direction: input.direction,
    amount: input.amount,
    teacherId: input.teacherId,
    walletId: input.walletId,
    reasonPresent: input.reasonPresent,
    balanceAfter: input.balanceAfter,
  };
  return {
    actorId: input.actorId,
    actionType: AuditActionType.Adjust,
    entityType: TRANSACTION_ENTITY_TYPE,
    entityId: input.transactionId,
    details: serializeAuditDetails(details),
  };
}
