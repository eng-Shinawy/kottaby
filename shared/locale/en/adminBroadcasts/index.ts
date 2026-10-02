import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

export const adminBroadcastsEn: AdminBroadcastsLabels = {
  pageTitle: "Send a Broadcast",
  pageSubtitle: "Compose a system-wide announcement and deliver it to every recipient in your chosen audience.",
  titleLabel: "Title",
  titlePlaceholder: "e.g. Scheduled maintenance this Friday",
  titleRequired: "Title is required.",
  bodyLabel: "Message",
  bodyPlaceholder: "Write the announcement your recipients will see.",
  audienceLabel: "Audience",
  audienceAll: "All users",
  audienceRole: "By role",
  audienceCountry: "By country",
  audiencePlan: "By subscription plan",
  roleLabel: "Role",
  countryLabel: "Country",
  countryHelperText:
    "Delivered to every governed user whose registered country matches the selection, including legacy records stored as display text.",
  planLabel: "Subscription plan",
  planLoading: "Loading plans…",
  previewDisclaimer: "Recipients are resolved at send time — no recipient list is shown before sending.",
  confirmTitle: "Send this broadcast?",
  confirmBody: "The announcement will be delivered as a notification to every recipient in the selected audience.",
  confirmSummaryTitle: "Broadcast",
  confirmSummaryAudience: "Audience",
  confirmAction: "Send now",
  cancelAction: "Cancel",
  sendAction: "Send broadcast",
  sendingAction: "Sending…",
  successToast: (count: number) => {
    if (count === 0) return "No recipients were reached";
    if (count === 1) return "Broadcast sent to 1 recipient";
    return `Broadcast sent to ${count} recipients`;
  },
  errorTitle: "Couldn't send the broadcast",

  // ─── History & lifecycle surface ────────────────────────────────────────
  historyTab: "History",
  composeTab: "Compose",
  historyTitle: "Broadcast history",
  historySubtitle: "Every broadcast sent from this dashboard, with its delivery counts and current lifecycle state.",
  filterSearchLabel: "Search by title",
  filterStatusLabel: "Status",
  filterAudienceLabel: "Audience type",
  filterAllLabel: "All",
  filterApply: "Apply filters",
  filterReset: "Reset filters",
  columnTitle: "Title",
  columnAudience: "Audience",
  columnRecipientCount: "Recipients",
  columnStatus: "Status",
  columnSentAt: "Sent at",
  columnSentBy: "Sent by",
  columnActions: "Actions",
  statusActive: "Active",
  statusStopped: "Stopped",
  viewDetails: "View details",
  stopAction: "Stop",
  detailTitle: "Broadcast details",
  detailAudience: "Audience",
  detailRecipients: "Recipients",
  detailDelivered: "Delivered",
  detailRead: "Read",
  detailUnread: "Unread",
  detailSentAt: "Sent at",
  detailStoppedAt: "Stopped at",
  detailStoppedBy: "Stopped by",
  detailRetractedNote:
    "This broadcast was stopped and its notification retracted — it is no longer shown to recipients.",
  stopConfirmTitle: "Stop this broadcast?",
  stopConfirmBody: (count: number) => {
    if (count === 0) return "No recipients have been reached yet. Stopping now prevents any further delivery.";
    if (count === 1)
      return "This broadcast has already reached 1 recipient. Stopping it retracts the notification and prevents any further delivery.";
    return `This broadcast has already reached ${count} recipients. Stopping it retracts the notification and prevents any further delivery.`;
  },
  stopConfirmAction: "Stop broadcast",
  stopConfirmCancel: "Cancel",
  stopSuccessToast: (count: number) => {
    if (count === 0) return "The broadcast was stopped before reaching any recipient";
    if (count === 1) return "The broadcast was stopped — it had already reached 1 recipient";
    return `The broadcast was stopped — it had already reached ${count} recipients`;
  },
  emptyTitle: "No broadcasts yet",
  emptyBody: "Broadcasts you send from the compose tab appear here with their delivery counts and status.",
  pagerPrev: "Previous page",
  pagerNext: "Next page",
};
