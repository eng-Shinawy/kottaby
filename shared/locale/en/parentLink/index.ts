import type { ParentLinkLabels } from "@/shared/locale/types/parentLink";

export const parentLinkEn: ParentLinkLabels = {
  studentPageTitle: "Link Requests",
  studentPageSubtitle: "Review requests from parents who want to link to your account.",
  incomingEmptyTitle: "No link requests yet",
  incomingEmptyBody: "When a parent sends you a link request, it will appear here.",
  listSummaryLabel: "Request status summary",
  summaryCountChip: (statusLabel: string, count: number) => `${statusLabel} · ${count}`,
  incomingHintBody: "New link requests from parents will appear here.",
  fromLabel: "From",
  sentAtLabel: "Sent at",
  expiresLine: (date: string) => `Expires on ${date}`,
  statusPending: "Pending",
  statusConfirmed: "Confirmed",
  statusRejected: "Rejected",
  statusExpired: "Expired",
  confirmAction: "Confirm",
  rejectAction: "Reject",
  confirmDialogTitle: "Confirm this link request?",
  confirmDialogBody: (parentName: string) =>
    `${parentName} will be linked to your account and will be able to follow your progress.`,
  rejectDialogTitle: "Reject this link request?",
  rejectDialogBody: (parentName: string) =>
    `${parentName} will not be linked to your account. They can send a new request later.`,
  confirmSuccessToast: "Link request confirmed.",
  rejectSuccessToast: "Link request rejected.",
  dashboardCardTitle: "Pending link requests",
  dashboardCardCount: (count: number) => (count === 1 ? "1 pending request" : `${count} pending requests`),
  dashboardCardLatestRequester: (parentName: string) => `Latest request from ${parentName}`,
  dashboardCardCta: "Review requests",
  dashboardCardLoading: "Loading link requests…",
  dashboardCardLoadError: "We couldn't load your link requests right now. Please try again.",
  cancelAction: "Cancel request",
  cancelDialogTitle: "Cancel this link request?",
  cancelDialogBody: "This request will be withdrawn and the student will no longer see it.",
  cancelSuccessToast: "Link request cancelled.",
  outgoingTitle: "Requests you've sent",
  outgoingEmptyTitle: "No requests sent yet",
  outgoingEmptyBody: "When you send a link request, its status will appear here.",
  sendRequestAction: "Send link request",
  sendRequestSuccessToast: "Link request sent.",
  // Inline INFO alert for the SUCCESSFUL send (mutation resolved with a row).
  // Success-flavored copy — the "already pending" conflict wording belongs to
  // the `denied` path (`errors.parentLinkAlreadyPending`), not this branch
  // (QA finding: success toast + conflict notice rendered together).
  requestPendingNotice: "Link request sent — it stays pending until the student approves it.",
  sendUnavailableNotice: "This link request can't be sent right now. Please try again later.",
};
