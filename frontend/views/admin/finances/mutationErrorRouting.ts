/**
 * mutationErrorRouting — the shared mutation error classification of the
 * admin finance mutations (`/admin/finances`): routes every GraphQL error
 * code to its outcome arm up to the container. Classification runs through
 * the SINGLE `extractErrorCode` + `normalizeGraphQLErrorCode` transport
 * contract; the server `message` is NEVER echoed.
 *
 * Arms (extensions.code family):
 * - `*_NOT_FOUND` → `onRequestNotFound`
 * - `CONFLICT` → `onNotPending` (the adjust hook pre-empts with its own
 *   insufficient-balance lane — the code alone cannot distinguish the two
 *   conflict arms, so the caller pre-classified by operation)
 * - `VALIDATION` / `BAD_USER_INPUT` → `onReasonRequired` (the adjust hook
 *   pre-empts with its amount lane by construction)
 * - `FORBIDDEN` → `onForbidden`
 * - everything else (masked failures, unknown codes) → `onFailure`
 */

import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";

/** Every mutation outcome arm the container surfaces (localized up-calls). */
export interface MutationOutcomeCallbacks {
  /** Success — the mutation settled and the cache refresh is in flight. */
  readonly onSettled: () => void;
  /** `withdrawalRequestNotFound` — unknown/non-withdrawal transaction id. */
  readonly onRequestNotFound: () => void;
  /** `withdrawalNotPending` — lost a settlement race (or a stale row). */
  readonly onNotPending: () => void;
  /** `insufficientBalance` — an over-balance debit adjustment. */
  readonly onInsufficientBalance: () => void;
  /** `invalidAdjustmentAmount` — the amount failed the decimal grammar. */
  readonly onInvalidAmount: () => void;
  /** `adjustmentReasonRequired` — empty/oversize adjustment reason. */
  readonly onReasonRequired: () => void;
  /** `FORBIDDEN` — a non-admin actor reached the mutation. */
  readonly onForbidden: () => void;
  /** Everything else — masked transport failures and unknown codes. */
  readonly onFailure: () => void;
}

/** Shared mutation error classification — routes every code to its arm. */
export function routeMutationError(error: unknown, callbacks: MutationOutcomeCallbacks): void {
  const rawCode = extractErrorCode(error);
  const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
  if (code.endsWith("_NOT_FOUND") || code === "NOT_FOUND") {
    callbacks.onRequestNotFound();
    return;
  }
  if (code === "CONFLICT") {
    // The conflict family carries the translated copy server-side, but the
    // two conflict arms here (settlement race vs over-balance debit) have
    // dedicated localized lanes — the code alone cannot distinguish them,
    // so the caller pre-classified by operation: the insufficient-balance
    // code arrives as CONFLICT too, disambiguated per operation by the
    // caller's arm wiring (adjustments route to onInsufficientBalance
    // first; settlements to onNotPending).
    callbacks.onNotPending();
    return;
  }
  if (code === "VALIDATION" || code === "BAD_USER_INPUT") {
    // The adjustment service throws both validation denials as bare
    // `VALIDATION` codes (no per-field payload) — the operation's own
    // pre-flight classification routes the arm: the adjust hook fires the
    // amount lane first (its input already passed the client grammar check,
    // so a server VALIDATION there is the amount denial by construction);
    // the settle hooks never carry an amount, so a VALIDATION lands on the
    // reason lane.
    callbacks.onReasonRequired();
    return;
  }
  if (code === "FORBIDDEN") {
    callbacks.onForbidden();
    return;
  }
  callbacks.onFailure();
}
