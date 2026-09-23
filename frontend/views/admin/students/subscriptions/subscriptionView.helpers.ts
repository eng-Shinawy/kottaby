/**
 * Pure view helpers shared by the admin drawer's subscription-management
 * presentational components: the enum-keyed status-label table and the
 * row-card label bundle resolver. Extracted from the section/rows-view
 * pair (the 150-line view-file convention) so the resolution exists ONCE
 * — the section's digest, the rows view's cards, and any future consumer
 * can never drift apart.
 *
 * Enum discipline: the table keys flow from a VALUE import of the
 * generated enum through an exhaustive Record lookup — never runtime
 * string literals.
 */

import { SubscriptionStatus } from "@/frontend/graphql/generated/gql/graphql";
import type { SubscriptionRowCardLabels } from "@/frontend/views/admin/students/subscriptions/SubscriptionRowCard";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

/**
 * The per-status label table resolved once per render from the namespace's
 * per-enum slots (keyed by the wire enum — never runtime string literals).
 */
export function statusLabelsOf(labels: SubscriptionAdminLabels): Record<SubscriptionStatus, string> {
  return {
    [SubscriptionStatus.Active]: labels.status.active,
    [SubscriptionStatus.Expired]: labels.status.expired,
    [SubscriptionStatus.Pending]: labels.status.pending,
    [SubscriptionStatus.Cancelled]: labels.status.cancelled,
    [SubscriptionStatus.Suspended]: labels.status.suspended,
  };
}

/**
 * The per-row caption + action + quick-action label bundle the row card
 * renders, resolved once per render from the namespace (the same shape the
 * rows view used to inline per card).
 */
export function rowCardLabelsOf(
  labels: SubscriptionAdminLabels,
  activityLabels: AdminUsersLabels["activity"]
): SubscriptionRowCardLabels {
  return {
    fields: labels.fields,
    planFacts: labels.planFacts,
    actions: labels.actions,
    expiryBadge: labels.expiryBadge,
    copyId: labels.copyId,
    auditLink: labels.auditLink,
    auditLinkCount: labels.auditLinkCount,
    activityLabels,
  };
}
