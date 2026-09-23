import { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** One offered arbitration outcome — the wire value plus its localized copy. */
export interface ResolveDisputeOutcomeOption {
  readonly value: DisputeResolution;
  readonly label: string;
  readonly helper: string;
}

/**
 * The outcome vocabulary of ONE escrow class, in render order: the held
 * class offers exactly the shipped `Cancel`/`Complete` pair, the consumed
 * class exactly the `Refund`/`PartialRefund`/`Uphold` family. The dialog
 * derives its list from the row's `feeHeld` through this mapping — the
 * radios can never offer an outcome outside the row's class.
 */
export function resolveDisputeOutcomeOptions(
  feeHeld: boolean,
  t: SessionsLabels
): readonly ResolveDisputeOutcomeOption[] {
  if (feeHeld) {
    return [
      { value: DisputeResolution.Cancel, label: t.resolutionCancelLabel, helper: t.resolutionCancelHelper },
      { value: DisputeResolution.Complete, label: t.resolutionCompleteLabel, helper: t.resolutionCompleteHelper },
    ];
  }
  return [
    { value: DisputeResolution.Refund, label: t.resolutionRefundLabel, helper: t.resolutionRefundHelper },
    {
      value: DisputeResolution.PartialRefund,
      label: t.resolutionPartialRefundLabel,
      helper: t.resolutionPartialRefundHelper,
    },
    { value: DisputeResolution.Uphold, label: t.resolutionUpholdLabel, helper: t.resolutionUpholdHelper },
  ];
}
