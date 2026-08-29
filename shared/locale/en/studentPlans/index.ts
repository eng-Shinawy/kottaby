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
  purchasePendingCta: "Requested",
  purchaseDialogTitle: "Confirm your subscription request",
  purchaseDialogBody: planTitle =>
    `You are requesting a subscription to «${planTitle}». The academy administration will confirm your payment — the plan activates once that's done.`,
  purchaseRequestCta: "Submit request",
  purchaseDialogClose: "Close",
  purchaseRequestSuccessToast: "Request submitted — pending payment confirmation.",
  purchaseRequestFailedToast: "Couldn't submit your request. Please try again.",
};
