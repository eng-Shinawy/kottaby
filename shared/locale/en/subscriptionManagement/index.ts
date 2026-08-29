import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

/**
 * English labels for the admin subscription lifecycle manager
 * (`subscriptionManagement` namespace, DEV1-009).
 */
export const subscriptionManagementEn: SubscriptionManagementLabels = {
  // Page header
  pageTitle: "Subscriptions",
  pageSubtitle: "Every subscription across the academy — review, filter, and cancel when needed.",

  // Async states
  loading: "Loading subscriptions…",
  emptyStateTitle: "No subscriptions found",
  emptyStateBody: "Subscriptions appear here once members request plans and payments are confirmed.",
  errorStateTitle: "Couldn't load subscriptions",
  errorStateBody: "Something went wrong while fetching the subscriptions. You can try again.",
  errorStateRetry: "Try again",

  // Status filter
  filterAll: "All",
  filterActive: "Active",
  filterPending: "Pending",
  filterExpired: "Expired",
  filterCancelled: "Cancelled",
  filterSuspended: "Suspended",
  applyFilters: "Apply",

  // Subscription card
  labelSubscriber: "Subscriber",
  labelPlan: "Plan",
  labelSessions: "Sessions",
  labelPrice: "Price",
  labelStatus: "Status",
  labelPeriod: "Period",
  labelStarted: "Started",
  labelEnds: "Ends",
  labelNotStarted: "Not started",
  labelOpenEnded: "—",
  labelPayment: "Payment",
  labelRequestedAt: "Requested",

  // Cancel flow
  cancelCta: "Cancel subscription",
  cancelDialogTitle: "Cancel this subscription?",
  cancelDialogBody: (subscriberName, planTitle) =>
    `This will cancel «${planTitle}» for ${subscriberName}. The member loses access immediately.`,
  cancelDialogConfirm: "Cancel subscription",
  cancelDialogDismiss: "Keep it",
  cancelSuccessToast: "Subscription cancelled.",
  cancelFailedToast: "Couldn't cancel the subscription. Please try again.",

  // Pagination
  pageInfo: (from, to, total) => `${from}–${to} of ${total}`,
  rowsPerPage: "Per page",
  pagePrev: "Previous",
  pageNext: "Next",
  pagePrevAriaLabel: "Previous page",
  pageNextAriaLabel: "Next page",
};
