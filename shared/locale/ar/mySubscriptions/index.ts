import type { MySubscriptionsLabels } from "@/shared/locale/types/mySubscriptions";

export const mySubscriptionsAr: MySubscriptionsLabels = {
  pageTitle: "اشتراكاتي",
  pageSubtitle: "تابع طلبات باقاتك واشتراكاتك النشطة وسجلّك.",
  loading: "جارٍ تحميل اشتراكاتك…",
  emptyStateTitle: "لا توجد اشتراكات بعد",
  emptyStateBody: "لم تطلب أي باقة بعد — تصفّح الكتالوج للبدء.",
  browsePlansCta: "تصفّح الباقات",
  errorStateTitle: "تعذّر تحميل اشتراكاتك",
  errorStateBody: "حدث خطأ أثناء جلب اشتراكاتك. يمكنك المحاولة مرة أخرى.",
  errorStateRetry: "إعادة المحاولة",

  summaryTitle: "نظرة عامة",
  summaryActiveLabel: "نشط",
  summaryPendingLabel: "معلّق",
  summaryAllLabel: "الكل",

  statusPending: "معلّق",
  statusActive: "نشط",
  statusExpired: "منتهٍ",
  statusCancelled: "ملغى",
  statusSuspended: "موقوف",
  labelStatus: "الحالة",

  labelPrice: "السعر",
  labelSessions: "الجلسات",
  labelInterval: "التجديد",
  intervalDays: days => `كل ${days} يومًا`,
  labelPeriod: "الفترة",
  labelStarted: "بدأت",
  labelEnds: "تنتهي",
  labelNotStarted: "لم تبدأ بعد",
  labelOpenEnded: "—",
  labelPayment: "الدفع",
  labelRequestedAt: "تاريخ الطلب",

  renewCta: "تجديد",
  renewBlockedPending: "بانتظار تأكيد الدفع",
  renewUnavailableInactive: "هذه الباقة غير متاحة حالياً",
  renewDialogTitle: "أكّد طلب التجديد",
  renewDialogBody: planTitle =>
    `أنت تطلب تجديد باقة «${planTitle}». ستؤكد إدارة الأكاديمية الدفع — ويكتمل التجديد بمجرد إتمام ذلك.`,
  renewRequestCta: "إرسال طلب التجديد",
  renewDialogClose: "إغلاق",
  renewSuccessToast: "تم إرسال طلب التجديد — بانتظار تأكيد الدفع.",
  renewFailedToast: "تعذّر إرسال طلب التجديد. يُرجى المحاولة مرة أخرى.",
};
