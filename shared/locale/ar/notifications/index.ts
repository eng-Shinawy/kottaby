import type { NotificationsLabels } from "@/shared/locale/types/notifications";

export const notificationsAr: NotificationsLabels = {
  title: "الإشعارات",
  emptyTitle: "لا جديد لديك",
  emptyBody: "ستظهر الإشعارات الجديدة هنا فور وصولها.",
  loadErrorTitle: "تعذّر تحميل الإشعارات",
  loadErrorBody: "حدث خطأ أثناء تحميل إشعاراتك. يرجى المحاولة مرة أخرى.",
  filterAll: "الكل",
  filterUnread: "غير المقروءة",
  typeSessionRequest: "طلب جلسة",
  typeSessionCompletion: "اكتمال الجلسة",
  typeSessionCancellation: "إلغاء الجلسة",
  typeParentLinkRequest: "طلب ربط ولي الأمر",
  typeSystemBroadcast: "إعلان النظام",
  typePaymentConfirmation: "تأكيد الدفع",
  typeEvaluationResult: "نتيجة التقييم",
  markRead: "تحديد كمقروء",
  markReadAriaLabel: (notificationTitle: string) => `تحديد كمقروء: ${notificationTitle}`,
  markAllRead: "تحديد الكل كمقروء",
  markAllConfirmTitle: "تحديد جميع الإشعارات كمقروءة؟",
  markAllConfirmBody: "سيتم تحديد جميع إشعاراتك غير المقروءة كمقروءة.",
  markAllResult: (count: number) => {
    if (count === 0) return "لا توجد إشعارات غير مقروءة";
    if (count === 1) return "تم تحديد إشعار واحد كمقروء";
    if (count === 2) return "تم تحديد إشعارين كمقروءين";
    if (count >= 3 && count <= 10) return `تم تحديد ${count} إشعارات كمقروءة`;
    return `تم تحديد ${count} إشعاراً كمقروءاً`;
  },
  badgeAriaLabel: "فتح الإشعارات",
  unreadCount: (count: number) => {
    if (count === 0) return "لا توجد إشعارات غير مقروءة";
    if (count === 1) return "إشعار واحد غير مقروء";
    if (count === 2) return "إشعاران غير مقروءان";
    if (count >= 3 && count <= 10) return `${count} إشعارات غير مقروءة`;
    return `${count} إشعاراً غير مقروءاً`;
  },
  viewAllNotifications: "عرض كل الإشعارات",
  realtimeToast: (typeLabel: string, notificationTitle: string) => `إشعار جديد — ${typeLabel}: ${notificationTitle}`,
  reconnecting: "جارٍ إعادة الاتصال…",
  reconnectedQuietly: "تم استعادة الإشعارات الفورية",
  eventParentLinkRequestTitle: "طلب ربط جديد",
  eventParentLinkRequestBody: (parentName: string) => `${parentName} أرسل إليك طلب ربط.`,
  eventParentLinkAcceptedTitle: "تم تأكيد طلب الربط",
  eventParentLinkAcceptedBody: (studentName: string) => `أكّد ${studentName} طلب ربطك.`,
  eventParentLinkRejectedTitle: "تم رفض طلب الربط",
  eventParentLinkRejectedBody: (studentName: string) => `رفض ${studentName} طلب ربطك.`,
  eventParentLinkExpiringTitle: "تذكير: طلب ربطك على وشك الانتهاء",
  eventParentLinkExpiringBody: (studentName: string) =>
    `طلب ربطك بـ ${studentName} سينتهي قريبًا — يمكن للطالب التأكيد أو الرفض قبل انتهاء صلاحيته.`,
};
