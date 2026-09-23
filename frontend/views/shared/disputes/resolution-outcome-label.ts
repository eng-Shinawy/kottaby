import { DisputeResolution as WireDisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * Pure wire→label map for the persisted arbitration outcome. Exhaustive
 * over the `DisputeResolution` wire enum with a `never` guard; `null`
 * (a resolved row that predates the stored outcome) falls back to the
 * honest generic "Resolved" label — never fabricated copy.
 *
 * Standalone non-component module: every rendering surface (the student
 * session row, the participant case dialog) imports the label from here,
 * so the component files stay components-only under fast refresh.
 */
export function resolutionOutcomeLabel(outcome: WireDisputeResolution | null, t: SessionsLabels): string {
  switch (outcome) {
    case WireDisputeResolution.Cancel:
      return t.outcomeCancel;
    case WireDisputeResolution.Complete:
      return t.outcomeComplete;
    case WireDisputeResolution.Refund:
      return t.outcomeRefund;
    case WireDisputeResolution.PartialRefund:
      return t.outcomePartialRefund;
    case WireDisputeResolution.Uphold:
      return t.outcomeUphold;
    case null:
      return t.outcomeUnrecorded;
  }
  const exhaustive: never = outcome;
  throw new Error(`Unexpected resolution outcome: ${String(exhaustive)}`);
}
