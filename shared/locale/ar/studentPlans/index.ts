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
  purchaseDialogTitle: "الاشتراك الإلكتروني قريبًا",
  purchaseDialogBody: planTitle =>
    `نُجهّز حاليًا إمكانية الدفع الإلكتروني. حتى ذلك الحين، تواصل مع إدارة الأكاديمية للاشتراك في باقة «${planTitle}».`,
  purchaseDialogClose: "إغلاق",
};
