import { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";

/**
 * Client-side validation for the partial-refund amount (the UI-seam
 * convenience gate — the server re-validates the same policy before any
 * write). An amount is submittable ONLY when it is a two-decimal money
 * string strictly between 0 and the disputed session's fee:
 *
 *  - shape: `^\d+(\.\d{1,2})?$` (no sign, no separators, ≤ 2 fraction
 *    digits — the same strict decimal validator the backend applies);
 *  - range: `0 < amount < fee`, compared numerically against the row's
 *    verbatim decimal-string fee.
 *
 * A missing fee fails CLOSED: the classification cannot prove the range,
 * so no amount is offered to the wire from the UI seam.
 */

/** The wire value of the amount-carrying outcome (string-vs-string comparisons). */
const PARTIAL_REFUND_WIRE_VALUE = DisputeResolution.PartialRefund.toString();

/** Two-decimal money shape — digits only, at most two fraction digits. */
const PARTIAL_AMOUNT_SHAPE = /^\d+(\.\d{1,2})?$/;

/** Validates one raw amount against the fee-bounded range policy above. */
export function isPartialAmountValid(raw: string, fee: string | null): boolean {
  if (!PARTIAL_AMOUNT_SHAPE.test(raw)) {
    return false;
  }
  if (fee === null) {
    return false;
  }
  const amount = Number.parseFloat(raw);
  const sessionFee = Number.parseFloat(fee);
  if (Number.isNaN(amount) || Number.isNaN(sessionFee)) {
    return false;
  }
  return amount > 0 && amount < sessionFee;
}

/** The selectable-outcome wire values the dialog option group renders. */
type OutcomeOption = { value: DisputeResolution; label: string };

/** The live, derived draft state the resolve dialog renders from. */
export type ResolveDisputeDraftState = {
  pickedValue: string | null;
  isPartialRefund: boolean;
  selectionOffClass: boolean;
  amountError: string | null;
};

/**
 * Derives the dialog's live draft state from the current selection: the
 * picked outcome travels as a string (the shipped wire-comparison idiom),
 * a stale selection whose value no longer belongs to the row's escrow
 * class is surfaced (never coerced), and the amount-policy copy raises
 * live once the entered amount is non-empty and invalid — never on a
 * pristine field.
 */
export function deriveResolveDisputeDraftState(params: {
  resolution: DisputeResolution | null;
  options: readonly OutcomeOption[];
  fee: string | null;
  partialAmount: string;
  amountErrorArmed: boolean;
  amountInvalidCopy: string;
}): ResolveDisputeDraftState {
  const { resolution, options, fee, partialAmount, amountErrorArmed, amountInvalidCopy } = params;
  const pickedValue =
    resolution === null
      ? null
      : (options.find(option => option.value.toString() === resolution.toString())?.value.toString() ?? null);
  const isPartialRefund = pickedValue === PARTIAL_REFUND_WIRE_VALUE;
  const selectionOffClass = resolution !== null && pickedValue === null;
  const amountInvalid = isPartialRefund && !isPartialAmountValid(partialAmount, fee);
  return {
    pickedValue,
    isPartialRefund,
    selectionOffClass,
    amountError: amountInvalid && (amountErrorArmed || partialAmount.length > 0) ? amountInvalidCopy : null,
  };
}
