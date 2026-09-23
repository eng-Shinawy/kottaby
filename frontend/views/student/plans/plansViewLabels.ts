/**
 * plansViewLabels — lane-label resolution for the student plan catalog.
 *
 * The balance-lane VALUE arrives from the plan row (`balanceLane`); the
 * LABEL is namespace-owned localized copy — never raw server data. The
 * lookup table mirrors the codegen `SubscriptionCreditLane` vocabulary
 * (the lookup-table convention — never a switch on enum values). The
 * lookup is typed partial so an impossible wire value keeps the fallback
 * branch live instead of a dead comparison.
 */

import type { SubscriptionCreditLane } from "@/frontend/graphql/generated/gql/graphql";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/** The lane → label lookup over the checkout namespace copy. */
const LANE_LABELS: Partial<Record<SubscriptionCreditLane, (t: CheckoutLabels) => string>> = {
  Hifz: t => t.laneHifz,
  Tajweed: t => t.laneTajweed,
  Reviews: t => t.laneReviews,
};

/**
 * Resolves the localized lane label for a `balanceLane` value; unknown
 * values (unreachable over the codegen vocabulary) fall back to the raw
 * value so the lookup never yields `undefined` output.
 */
export function resolveLaneLabel(lane: SubscriptionCreditLane, t: CheckoutLabels): string {
  const resolve = LANE_LABELS[lane];
  if (resolve === undefined) {
    return lane;
  }
  return resolve(t);
}
