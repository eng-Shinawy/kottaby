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
  typeParentLinkRequest: "Parent Link Request",
  typeSystemBroadcast: "System Announcement",
  typePaymentConfirmation: "Payment Confirmation",
  typeEvaluationResult: "Evaluation Result",
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
  eventParentLinkRequestTitle: "New link request",
  eventParentLinkRequestBody: (parentName: string) => `${parentName} sent you a link request.`,
  eventParentLinkAcceptedTitle: "Link request confirmed",
  eventParentLinkAcceptedBody: (studentName: string) => `${studentName} confirmed your link request.`,
  eventParentLinkRejectedTitle: "Link request rejected",
  eventParentLinkRejectedBody: (studentName: string) => `${studentName} declined your link request.`,
  eventParentLinkExpiringTitle: "Reminder: your link request is expiring soon",
  eventParentLinkExpiringBody: (studentName: string) =>
    `Your link request for ${studentName} is about to expire — the student can still confirm or decline before it lapses.`,
};
