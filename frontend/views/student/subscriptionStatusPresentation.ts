/**
 * subscriptionStatusPresentation — the shared `SubscriptionStatus`
 * lifecycle chip label map, consumed by every view that renders a
 * subscription row's chip (the my-subscriptions card and the checkout
 * result summary). The checkout namespace owns the copy; this module owns
 * the codegen-value → label resolution exactly once (the `Record`
 * lookup-table convention — never a switch on enum values), so the map is
 * total by construction: every codegen member carries an entry.
 */
import type { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { CheckoutLabels } from "@/shared/locale/types/checkout";

/** The lifecycle chip label per `SubscriptionStatus` — the checkout
 * namespace's COMPLETE lifecycle chip vocabulary. */
const STATUS_LABELS: Readonly<Record<SubscriptionStatus, (t: CheckoutLabels) => string>> = {
  Active: t => t.statusActive,
  Pending: t => t.statusPending,
  Expired: t => t.statusExpired,
  Cancelled: t => t.statusCancelled,
  Suspended: t => t.statusSuspended,
};

/** Resolves the localized chip label for a subscription status value. */
export function subscriptionStatusChipLabel(status: SubscriptionStatus, t: CheckoutLabels): string {
  return STATUS_LABELS[status](t);
}
