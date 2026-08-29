import type { StudentPlansLabels } from "@/shared/locale/types/studentPlans";

export const studentPlansAr: StudentPlansLabels = {
  pageTitle: "باقات الاشتراك",
  pageSubtitle: "اختر الباقة الأنسب لرحلة تعلّم القرآن.",
  loading: "جارٍ تحميل الباقات…",
  emptyStateTitle: "لا توجد باقات متاحة بعد",
  emptyStateBody: "لم تنشر الأكاديمية أي باقات اشتراك حتى الآن — يُرجى الزيارة مرة أخرى قريباً.",
  errorStateTitle: "تعذّر تحميل الباقات",
  errorStateBody: "حدث خطأ أثناء جلب كتالوج الباقات. يمكنك المحاولة مرة أخرى.",
  errorStateRetry: "إعادة المحاولة",
  labelSessions: "الجلسات",
  labelInterval: "التجديد",
  intervalDays: days => `كل ${days} يومًا`,
  subscribeCta: "اشترك",
  purchasePendingCta: "تم الطلب",
  purchaseDialogTitle: "أكّد طلب الاشتراك",
  purchaseDialogBody: planTitle =>
    `أنت تطلب الاشتراك في باقة «${planTitle}». ستؤكد إدارة الأكاديمية الدفع — وتُفعّل الباقة بمجرد إتمام ذلك.`,
  purchaseRequestCta: "إرسال الطلب",
  purchaseDialogClose: "إغلاق",
  purchaseRequestSuccessToast: "تم إرسال الطلب — بانتظار تأكيد الدفع.",
  purchaseRequestFailedToast: "تعذّر إرسال طلبك. يُرجى المحاولة مرة أخرى.",
};
