/**
 * subscriptionsPresentation — pure type→presentation maps for the
 * my-subscriptions view (the `plansViewLabels` precedent: namespace-owned
 * localized copy, never raw server data).
 *
 * Rows carry the codegen `SubscriptionStatus` lifecycle value; the derived
 * payment-failed chip is presentation-only (a failed payment leaves the
 * subscription row `Pending` — `SubscriptionStatus` has no failed member).
 * The status chip resolves through the shared
 * `subscriptionStatusPresentation` map; this file keeps the view's
 * derived-payment-failed chip only.
 */
import type { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import { subscriptionStatusChipLabel } from "@/frontend/views/student/subscriptionStatusPresentation";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/** The lifecycle chip label per `SubscriptionStatus` — resolved through the
 * shared map (every view rendering a subscription chip consumes the same
 * checkout-namespace vocabulary). */
export function statusChipLabel(status: SubscriptionStatus, t: CheckoutLabels): string {
  return subscriptionStatusChipLabel(status, t);
}

/** The derived payment-failed chip label (the failed-payment row's chip). */
export function paymentFailedChipLabel(t: CheckoutLabels): string {
  return t.statusFailed;
}
