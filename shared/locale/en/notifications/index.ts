import { isolateBidiRun as iso, LRM } from "@/shared/locale/bidi";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

export const notificationsEn: NotificationsLabels = {
  title: "Notifications",
  emptyTitle: "You're all caught up",
  emptyBody: "New notifications will appear here as they arrive.",
  loadErrorTitle: "Couldn't load notifications",
  loadErrorBody: "Something went wrong while loading your notifications. Please try again.",
  filterAll: "All",
  filterUnread: "Unread",
  typeSessionRequest: "Session Request",
  typeSessionCompletion: "Session Completion",
  typeSessionCancellation: "Session Cancellation",
  typeSessionDisputeOpened: "Session Dispute Opened",
  typeSessionDisputeResolved: "Session Dispute Resolved",
  typeParentLinkRequest: "Parent Link Request",
  typeSystemBroadcast: "System Announcement",
  typePaymentConfirmation: "Payment Confirmation",
  typeEvaluationResult: "Evaluation Result",
  typeApplicantOutcome: "Applicant Outcome",
  markRead: "Mark as read",
  markReadAriaLabel: (notificationTitle: string) => `Mark as read: ${notificationTitle}`,
  markAllRead: "Mark all as read",
  markAllConfirmTitle: "Mark all as read?",
  markAllConfirmBody: "All of your unread notifications will be marked as read.",
  markAllResult: (count: number) => {
    if (count === 0) return "No unread notifications";
    if (count === 1) return "1 notification marked as read";
    return `${count} notifications marked as read`;
  },
  badgeAriaLabel: "Open notifications",
  unreadCount: (count: number) => {
    if (count === 0) return "No unread notifications";
    if (count === 1) return "1 unread notification";
    return `${count} unread notifications`;
  },
  viewAllNotifications: "View all notifications",
  realtimeToast: (typeLabel: string, notificationTitle: string) =>
    `New notification — ${typeLabel}: ${notificationTitle}`,
  reconnecting: "Reconnecting…",
  reconnectedQuietly: "Realtime notifications restored",
  eventSessionRequestTitle: "New session request",
  eventSessionAcceptedTitle: "Session request accepted",
  eventSessionDeclinedTitle: "Session request declined",
  eventSessionAutoRejectedTitle: "Session request automatically declined",
  eventSessionQueuedTitle: "Session request queued",
  eventSessionAlternativesOfferedTitle: "Alternative teachers offered",
  eventSessionRequestBody: (studentName: string, intentLabel: string) =>
    `${LRM}${iso(studentName)} requested a session with you (${intentLabel}).`,
  eventSessionAcceptedBody: (teacherName: string) => `${LRM}${iso(teacherName)} accepted your session request.`,
  eventSessionDeclinedBody: (teacherName: string) => `${LRM}${iso(teacherName)} declined your session request.`,
  eventSessionAutoRejectedBody: (teacherName: string) =>
    `Your session request to ${iso(teacherName)} was automatically declined.`,
  eventSessionQueuedBody: (teacherName: string) =>
    `Your session request to ${iso(teacherName)} was added to the queue.`,
  eventSessionAlternativesOfferedBody: (teacherName: string) =>
    `${LRM}${iso(teacherName)} can't take your request, so we offered you alternative teachers.`,
  eventSessionCompletionPromptTitle: "Confirm your completed session",
  eventSessionAutoCancelledTitle: "Session auto-cancelled",
  eventSessionCompletionPromptBody: (teacherName: string) =>
    `${LRM}${iso(teacherName)} marked your session as complete — please confirm it so the session can be settled.`,
  eventSessionAutoCancelledBody: (teacherName: string) =>
    `Your session with ${iso(teacherName)} was auto-cancelled because it wasn't confirmed within 24 hours.`,
  intentHifz: "Hifz",
  intentTajweed: "Tajweed",
  intentEvaluation: "Evaluation",
  eventParentLinkRequestTitle: "New link request",
  eventParentLinkRequestBody: (parentName: string) => `${LRM}${iso(parentName)} sent you a link request.`,
  eventParentLinkAcceptedTitle: "Link request confirmed",
  eventParentLinkAcceptedBody: (studentName: string) => `${LRM}${iso(studentName)} confirmed your link request.`,
  eventParentLinkRejectedTitle: "Link request rejected",
  eventParentLinkRejectedBody: (studentName: string) => `${LRM}${iso(studentName)} declined your link request.`,
  eventParentLinkExpiringTitle: "Reminder: your link request is expiring soon",
  eventParentLinkExpiringBody: (studentName: string) =>
    `Your link request for ${iso(studentName)} is about to expire — the student can still confirm or decline before it lapses.`,
  eventPaymentConfirmedTitle: "Payment confirmed",
  eventPaymentConfirmedBody: (planTitle: string) =>
    `Your payment for ${planTitle} was received — the subscription is now active and your sessions are available.`,
  eventPaymentFailedTitle: "Payment failed",
  eventPaymentFailedBody: (planTitle: string) =>
    `Your payment for ${planTitle} was not completed — the subscription was not activated and no sessions were added. You can retry the purchase at any time.`,
  eventSessionReportReadyTitle: "Session report ready",
  eventSessionReportReadyBody: (teacherName: string) =>
    `${LRM}${iso(teacherName)} submitted a report for your session.`,
  eventSessionReportReadyParentBody: (studentName: string, teacherName: string) =>
    `${LRM}${iso(teacherName)} submitted a session report for ${iso(studentName)}.`,
  eventSessionGovernanceRescheduledTitle: "Session rescheduled",
  eventSessionGovernanceRescheduledBody:
    "A platform administrator changed your session's schedule. Open the session to see the new time.",
  eventSessionGovernanceCancelledTitle: "Session cancelled",
  eventSessionGovernanceCancelledBody: "A platform administrator cancelled your session.",
  eventSessionGovernanceTeacherReassignedTitle: "Session teacher changed",
  eventSessionGovernanceTeacherReassignedBody:
    "A platform administrator changed the teacher for your session. Open the session to see the details.",
  eventSessionDisputeOpenedTitle: "Session dispute opened",
  eventSessionDisputeOpenedBody:
    "A completed session was disputed and awaits arbitration. Open the disputes console to review the case.",
  eventSessionDisputeResolvedTitle: "Session dispute resolved",
  eventSessionDisputeResolvedRefundBody:
    "The arbitration for your session was decided: the session fee was refunded. Open the session to see the recorded outcome.",
  eventSessionDisputeResolvedPartialRefundBody:
    "The arbitration for your session was decided: the session fee was partially refunded. Open the session to see the recorded outcome.",
  eventSessionDisputeResolvedUpholdBody:
    "The arbitration for your session was decided: the session's completion was upheld. Open the session to see the recorded outcome.",
  eventApplicantOverrideCertifiedTitle: "Application approved",
  eventApplicantOverrideCertifiedBody:
    "A platform administrator approved your application — you are now a certified teacher. Welcome aboard!",
  eventApplicantOverrideRejectedTitle: "Application rejected",
  eventApplicantOverrideRejectedBody: (days: number) =>
    `A platform administrator rejected your application — you can re-apply in ${days} ${days === 1 ? "day" : "days"}.`,
  eventApplicantOverrideReEvaluationTitle: "Re-evaluation granted",
  eventApplicantOverrideReEvaluationBody:
    "A platform administrator granted you a re-evaluation — your waiting period has been cleared, so you can book a new evaluation session now.",
};
