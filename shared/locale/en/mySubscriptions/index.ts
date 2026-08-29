import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";

export const mySubscriptionsEn: MySubscriptionsLabels = {
  pageTitle: "My Subscriptions",
  pageSubtitle: "Track your plan requests, active memberships, and history.",
  loading: "Loading your subscriptions…",
  emptyStateTitle: "No subscriptions yet",
  emptyStateBody: "You haven't requested any plan yet — browse the catalog to get started.",
  browsePlansCta: "Browse plans",
  errorStateTitle: "Couldn't load your subscriptions",
  errorStateBody: "Something went wrong while fetching your subscriptions. You can try again.",
  errorStateRetry: "Try again",

  summaryTitle: "Overview",
  summaryActiveLabel: "Active",
  summaryPendingLabel: "Pending",
  summaryAllLabel: "All",

  statusPending: "Pending",
  statusActive: "Active",
  statusExpired: "Expired",
  statusCancelled: "Cancelled",
  statusSuspended: "Suspended",
  labelStatus: "Status",

  labelPrice: "Price",
  labelSessions: "Sessions",
  labelInterval: "Renewal",
  intervalDays: days => `Every ${days} days`,
  labelPeriod: "Period",
  labelStarted: "Started",
  labelEnds: "Ends",
  labelNotStarted: "Not started yet",
  labelOpenEnded: "—",
  labelPayment: "Payment",
  labelRequestedAt: "Requested",

  renewCta: "Renew",
  renewBlockedPending: "Awaiting payment confirmation",
  renewUnavailableInactive: "This plan is currently unavailable",
  renewDialogTitle: "Confirm your renewal request",
  renewDialogBody: planTitle =>
    `You are requesting a renewal of «${planTitle}». The academy administration will confirm your payment — the renewal completes once that's done.`,
  renewRequestCta: "Submit renewal request",
  renewDialogClose: "Close",
  renewSuccessToast: "Renewal request submitted — pending payment confirmation.",
  renewFailedToast: "Couldn't submit your renewal request. Please try again.",
};
