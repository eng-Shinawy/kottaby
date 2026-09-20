import type { CheckoutLabels } from "@/shared/locale/types/checkout";

export const checkoutAr: CheckoutLabels = {
  pageTitle: "اختر خطتك",
  pageSubtitle: "قارن بين الخطط المتاحة واختر الأنسب لرحلتك التعليمية.",
  metaTitle: "اختر خطتك",
  metaDescription: "تصفّح خطط الاشتراك المتاحة، وقارن الأسعار وعدد الحصص، واشترك في خطوات بسيطة.",
  buyButton: "اشترك الآن",
  sessionsIncludedLine: (count: number) => {
    if (count === 1) return "تشمل حصة واحدة";
    if (count === 2) return "تشمل حصتين";
    if (count <= 10) return `تشمل ${count} حصص`;
    return `تشمل ${count} حصة`;
  },
  validityLine: (days: number) => {
    if (days === 1) return "صالحة لمدة يوم واحد";
    if (days === 2) return "صالحة لمدة يومين";
    if (days <= 10) return `صالحة لمدة ${days} أيام`;
    return `صالحة لمدة ${days} يوماً`;
  },
  perSessionLine: (amount: string) => `≈ ${amount} للحصة`,
  laneHifz: "الحفظ",
  laneTajweed: "التجويد",
  laneReviews: "المراجعة",
  laneGeneralLabel: "الحساب",
  currencyEgp: "ج.م",
  paymobTrustNote: "مدفوعات آمنة عبر Paymob — تدعم البطاقات البنكية والمحافظ الإلكترونية.",
  laneCreditLine: (laneLabel: string) => `تُضاف الحصص إلى رصيد ${laneLabel}`,
  emptyTitle: "لا توجد خطط متاحة حالياً",
  emptyBody: "ستظهر خطط الاشتراك الجديدة هنا فور نشرها.",
  emptyActionButton: "تحديث",

  confirmDialogTitle: "تأكيد الشراء",
  planLabel: "الخطة",
  sessionsLabel: "عدد الحصص",
  validityLabel: "مدة الصلاحية",
  amountDueLabel: "المبلغ المستحق",
  confirmDialogSecureNote: "سيتم تحويلك إلى صفحة الدفع الآمنة عبر Paymob — ندعم البطاقات البنكية والمحافظ الإلكترونية.",
  confirmButton: "تأكيد ودفع",
  confirmBusyButton: "جاري المعالجة...",
  cancelButton: "إلغاء",
  purchaseCompletedNotice: "تم تأكيد الدفع — اشتراكك مفعّل الآن.",

  resultMetaTitle: "نتيجة الدفع",
  resultCheckingTitle: "جاري التحقق من حالة الدفع...",
  resultCheckingBody: "انتظر لحظات ريثما نتحقق من عملية الدفع مع مزوّد الدفع.",
  resultSuccessTitle: "تم الدفع بنجاح",
  resultSuccessBody: "تم تأكيد دفعتك، واشتراكك مفعّل الآن.",
  resultFailedTitle: "فشل الدفع",
  resultFailedBody: "لم تكتمل عملية الدفع ولم يتم خصم أي مبلغ. يمكنك إعادة المحاولة أو مراجعة اشتراكاتك.",
  resultPendingTitle: "الدفع قيد المعالجة",
  resultPendingBody: "ما زلنا نعالج عملية الدفع، وسيتم تفعيل اشتراكك تلقائياً فور تأكيدها.",
  retryButton: "إعادة المحاولة",
  viewSubscriptionsButton: "عرض اشتراكاتي",

  subscriptionsPageTitle: "اشتراكاتي",
  subscriptionsPageSubtitle: "خطط اشتراكك وحالة الدفع الخاصة بها.",
  subscriptionsMetaTitle: "اشتراكاتي",
  subscriptionsMetaDescription: "اطّلع على خطط اشتراكك وحالة الدفع ومدد الصلاحية.",
  statusColumn: "الحالة",
  startDateColumn: "تاريخ البدء",
  endDateColumn: "تاريخ الانتهاء",
  emptyValue: "—",
  statusActive: "نشط",
  statusPending: "معلّق",
  statusExpired: "منتهي",
  statusCancelled: "ملغى",
  statusSuspended: "موقوف",
  statusFailed: "فشل الدفع",
  failedPaymentGuidance: "لم تكتمل عملية الدفع لهذا الاشتراك. أعد المحاولة من صفحة الخطط لتفعيله.",
  subscriptionsEmptyTitle: "لا توجد اشتراكات بعد",
  subscriptionsEmptyBody: "اختر خطة من صفحة الخطط لتبدأ في حجز الحصص.",
  browsePlansButton: "استعرض الخطط",
  genericError: "حدث خطأ ما.",
};
