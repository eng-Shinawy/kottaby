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
  countryPlaceholder: "e.g. Egypt",
  countryHelperText: "Matched exactly against each recipient's registered country, up to 100 characters.",
  planLabel: "Subscription plan",
  planLoading: "Loading plans…",
  previewDisclaimer: "Recipients are resolved at send time — no recipient list is shown before sending.",
  confirmTitle: "Send this broadcast?",
  confirmBody: "The announcement will be delivered as a notification to every recipient in the selected audience.",
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
};
