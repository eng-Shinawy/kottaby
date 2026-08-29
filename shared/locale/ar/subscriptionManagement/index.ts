import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

/**
 * Arabic labels for the admin subscription lifecycle manager
 * (`subscriptionManagement` namespace, DEV1-009).
 */
export const subscriptionManagementAr: SubscriptionManagementLabels = {
  // Page header
  pageTitle: "الاشتراكات",
  pageSubtitle: "كل اشتراكات الأكاديمية — راجعها وصفّها وألغِ ما يلزم.",

  // Async states
  loading: "جارٍ تحميل الاشتراكات…",
  emptyStateTitle: "لا توجد اشتراكات",
  emptyStateBody: "ستظهر الاشتراكات هنا بعد أن يطلب الأعضاء الباقات ويُؤكَّد الدفع.",
  errorStateTitle: "تعذّر تحميل الاشتراكات",
  errorStateBody: "حدث خطأ ما أثناء جلب الاشتراكات. يمكنك المحاولة مرة أخرى.",
  errorStateRetry: "حاول مجدداً",

  // Status filter
  filterAll: "الكل",
  filterActive: "نشط",
  filterPending: "معلّق",
  filterExpired: "منتهٍ",
  filterCancelled: "ملغى",
  filterSuspended: "موقوف",
  applyFilters: "تطبيق",

  // Subscription card
  labelSubscriber: "المشترك",
  labelPlan: "الباقة",
  labelSessions: "الجلسات",
  labelPrice: "السعر",
  labelStatus: "الحالة",
  labelPeriod: "الفترة",
  labelStarted: "البدء",
  labelEnds: "الانتهاء",
  labelNotStarted: "لم تبدأ بعد",
  labelOpenEnded: "—",
  labelPayment: "الدفع",
  labelRequestedAt: "تاريخ الطلب",

  // Cancel flow
  cancelCta: "إلغاء الاشتراك",
  cancelDialogTitle: "إلغاء هذا الاشتراك؟",
  cancelDialogBody: (subscriberName, planTitle) =>
    `سيؤدي هذا إلى إلغاء باقة «${planTitle}» للمشترك ${subscriberName}. سيفقد العضو صلاحية الوصول فوراً.`,
  cancelDialogConfirm: "إلغاء الاشتراك",
  cancelDialogDismiss: "الإبقاء عليه",
  cancelSuccessToast: "تم إلغاء الاشتراك.",
  cancelFailedToast: "تعذّر إلغاء الاشتراك. يرجى المحاولة مرة أخرى.",

  // Pagination
  pageInfo: (from, to, total) => `${from}–${to} من ${total}`,
  rowsPerPage: "لكل صفحة",
  pagePrev: "السابق",
  pageNext: "التالي",
  pagePrevAriaLabel: "الصفحة السابقة",
  pageNextAriaLabel: "الصفحة التالية",
};
