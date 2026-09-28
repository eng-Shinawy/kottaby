import { formatArabicCooldownDays } from "@/shared/locale/arabic-cooldown-days";
import { isolateBidiRun as iso, RLM } from "@/shared/locale/bidi";
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
  typeSessionDisputeOpened: "تم فتح نزاع جلسة",
  typeSessionDisputeResolved: "تم حل نزاع الجلسة",
  typeParentLinkRequest: "طلب ربط ولي الأمر",
  typeSystemBroadcast: "إعلان النظام",
  typePaymentConfirmation: "تأكيد الدفع",
  typeEvaluationResult: "نتيجة التقييم",
  typeApplicantOutcome: "نتيجة طلب الانتساب",
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
  eventSessionRequestTitle: "طلب جلسة جديد",
  eventSessionAcceptedTitle: "تم قبول طلب الجلسة",
  eventSessionDeclinedTitle: "تم رفض طلب الجلسة",
  eventSessionAutoRejectedTitle: "تم رفض طلب الجلسة تلقائيًا",
  eventSessionQueuedTitle: "طلب الجلسة في قائمة الانتظار",
  eventSessionAlternativesOfferedTitle: "تم اقتراح معلمين بدلاء",
  eventSessionRequestBody: (studentName: string, intentLabel: string) =>
    `طلب ${iso(studentName)} جلسة ${intentLabel} معك.`,
  eventSessionAcceptedBody: (teacherName: string) => `قبل ${iso(teacherName)} طلب جلستك.`,
  eventSessionDeclinedBody: (teacherName: string) => `اعتذر ${iso(teacherName)} عن طلب جلستك.`,
  eventSessionAutoRejectedBody: (teacherName: string) => `تم رفض طلب جلستك لدى ${iso(teacherName)} تلقائيًا.`,
  eventSessionQueuedBody: (teacherName: string) => `أُضيف طلب جلستك لدى ${iso(teacherName)} إلى قائمة الانتظار.`,
  eventSessionAlternativesOfferedBody: (teacherName: string) =>
    `تعذّر على ${iso(teacherName)} قبول طلبك، لذا اقترحنا لك معلمين بدلاء.`,
  eventSessionCompletionPromptTitle: "أكّد اكتمال جلستك",
  eventSessionAutoCancelledTitle: "تم إلغاء جلستك تلقائيًا",
  eventSessionCompletionPromptBody: (teacherName: string) =>
    `علّم ${iso(teacherName)} جلستك كمكتملة — يرجى تأكيد الاكتمال حتى تُحتسب الجلسة.`,
  eventSessionAutoCancelledBody: (teacherName: string) =>
    `أُلغيت جلستك مع ${iso(teacherName)} تلقائيًا لعدم تأكيد الاكتمال خلال 24 ساعة.`,
  intentHifz: "الحفظ",
  intentTajweed: "التجويد",
  intentEvaluation: "التقييم",
  eventParentLinkRequestTitle: "طلب ربط جديد",
  eventParentLinkRequestBody: (parentName: string) => `${RLM}${iso(parentName)} أرسل إليك طلب ربط.`,
  eventParentLinkAcceptedTitle: "تم تأكيد طلب الربط",
  eventParentLinkAcceptedBody: (studentName: string) => `أكّد ${iso(studentName)} طلب ربطك.`,
  eventParentLinkRejectedTitle: "تم رفض طلب الربط",
  eventParentLinkRejectedBody: (studentName: string) => `رفض ${iso(studentName)} طلب ربطك.`,
  eventParentLinkExpiringTitle: "تذكير: طلب ربطك على وشك الانتهاء",
  eventParentLinkExpiringBody: (studentName: string) =>
    `طلب ربطك بـ ${iso(studentName)} سينتهي قريبًا — يمكن للطالب التأكيد أو الرفض قبل انتهاء صلاحيته.`,
  eventPaymentConfirmedTitle: "تم تأكيد الدفع",
  eventPaymentConfirmedBody: (planTitle: string) =>
    `تم استلام دفعتك لخطة ${planTitle} — اشتراكك مفعّل الآن وحصصك متاحة.`,
  eventPaymentFailedTitle: "فشل الدفع",
  eventPaymentFailedBody: (planTitle: string) =>
    `لم تكتمل عملية الدفع لخطة ${planTitle} — لم يتم تفعيل الاشتراك ولم تُضف أي حصص. يمكنك إعادة محاولة الشراء في أي وقت.`,
  eventSessionReportReadyTitle: "تقرير الجلسة جاهز",
  eventSessionReportReadyBody: (teacherName: string) => `قدّم ${iso(teacherName)} تقرير جلستك.`,
  eventSessionReportReadyParentBody: (studentName: string, teacherName: string) =>
    `قدّم ${iso(teacherName)} تقرير جلسة ${iso(studentName)}.`,
  eventSessionGovernanceRescheduledTitle: "تمت إعادة جدولة الجلسة",
  eventSessionGovernanceRescheduledBody:
    "قام أحد مشرفي المنصة بتغيير موعد جلستك. افتح الجلسة للاطلاع على الموعد الجديد.",
  eventSessionGovernanceCancelledTitle: "تم إلغاء الجلسة",
  eventSessionGovernanceCancelledBody: "قام أحد مشرفي المنصة بإلغاء جلستك.",
  eventSessionGovernanceTeacherReassignedTitle: "تم تغيير معلم الجلسة",
  eventSessionGovernanceTeacherReassignedBody:
    "قام أحد مشرفي المنصة بتغيير معلم جلستك. افتح الجلسة للاطلاع على التفاصيل.",
  eventSessionDisputeOpenedTitle: "تم فتح نزاع على جلسة",
  eventSessionDisputeOpenedBody: "تم فتح نزاع على جلسة مكتملة وهو بانتظار التحكيم. افتح شاشة النزاعات لمراجعة الحالة.",
  eventSessionDisputeResolvedTitle: "تم حل نزاع الجلسة",
  eventSessionDisputeResolvedRefundBody:
    "تم حسم التحكيم الخاص بجلستك: تمت استعادة قيمة الجلسة بالكامل. افتح الجلسة للاطلاع على القرار المسجّل.",
  eventSessionDisputeResolvedPartialRefundBody:
    "تم حسم التحكيم الخاص بجلستك: تمت استعادة جزء من قيمة الجلسة. افتح الجلسة للاطلاع على القرار المسجّل.",
  eventSessionDisputeResolvedUpholdBody:
    "تم حسم التحكيم الخاص بجلستك: تم تأكيد اكتمال الجلسة كما هو. افتح الجلسة للاطلاع على القرار المسجّل.",
  eventApplicantOverrideCertifiedTitle: "تم اعتماد طلبك",
  eventApplicantOverrideCertifiedBody: "قام أحد مشرفي المنصة باعتماد طلبك — أصبحت الآن معلمًا معتمدًا. أهلًا بك!",
  eventApplicantOverrideRejectedTitle: "تم رفض طلبك",
  eventApplicantOverrideRejectedBody: (days: number) =>
    `قام أحد مشرفي المنصة برفض طلبك — يمكنك إعادة التقديم بعد ${formatArabicCooldownDays(days)}.`,
  eventApplicantOverrideReEvaluationTitle: "تم منحك إعادة تقييم",
  eventApplicantOverrideReEvaluationBody:
    "قام أحد مشرفي المنصة بمنحك إعادة تقييم — تم إلغاء فترة الانتظار، ويمكنك حجز جلسة تقييم جديدة الآن.",
};
