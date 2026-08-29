import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

export const studentPlansEn: StudentPlansLabels = {
  pageTitle: "Subscription Plans",
  pageSubtitle: "Choose the plan that fits your Quran learning journey.",
  loading: "Loading plans…",
  emptyStateTitle: "No plans available yet",
  emptyStateBody: "The academy hasn't published any subscription plans yet — please check back soon.",
  errorStateTitle: "Couldn't load the plans",
  errorStateBody: "Something went wrong while fetching the catalog. You can try again.",
  errorStateRetry: "Try again",
  labelSessions: "Sessions",
  labelInterval: "Renewal",
  intervalDays: days => `Every ${days} days`,
  subscribeCta: "Subscribe",
  purchaseDialogTitle: "Online subscription is coming soon",
  purchaseDialogBody: planTitle =>
    `We're putting the finishing touches on online payments. For now, contact the academy administration to subscribe to «${planTitle}».`,
  purchaseDialogClose: "Close",
};
