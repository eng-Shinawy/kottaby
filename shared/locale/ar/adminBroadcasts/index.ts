import type { AdminBroadcastsLabels } from "@/shared/locale/types/adminBroadcasts";

export const adminBroadcastsAr: AdminBroadcastsLabels = {
  pageTitle: "إرسال إعلان",
  pageSubtitle: "أنشئ إعلاناً على مستوى النظام وسلّمه إلى كل مستلم ضمن الجمهور الذي تختاره.",
  titleLabel: "العنوان",
  titlePlaceholder: "مثال: صيانة مجدولة يوم الجمعة",
  titleRequired: "العنوان مطلوب.",
  bodyLabel: "نص الإعلان",
  bodyPlaceholder: "اكتب الإعلان الذي سيظهر للمستلمين.",
  audienceLabel: "الجمهور المستهدف",
  audienceAll: "جميع المستخدمين",
  audienceRole: "حسب الدور",
  audienceCountry: "حسب الدولة",
  audiencePlan: "حسب خطة الاشتراك",
  roleLabel: "الدور",
  countryLabel: "الدولة",
  countryPlaceholder: "مثال: مصر",
  countryHelperText: "تتم المطابقة التامة مع الدولة المسجلة لكل مستلم، بحد أقصى 100 حرف.",
  planLabel: "خطة الاشتراك",
  planLoading: "جارٍ تحميل الخطط…",
  previewDisclaimer: "يُحدَّد المستلمون وقت الإرسال — لا تُعرض قائمة المستلمين قبل الإرسال.",
  confirmTitle: "إرسال هذا الإعلان؟",
  confirmBody: "سيتم تسليم الإعلان كإشعار لكل مستلم ضمن الجمهور المحدد.",
  confirmAction: "إرسال الآن",
  cancelAction: "إلغاء",
  sendAction: "إرسال الإعلان",
  sendingAction: "جارٍ الإرسال…",
  successToast: (count: number) => {
    if (count === 0) return "لم يتم إشعار أي مستلم";
    if (count === 1) return "تم إرسال الإعلان إلى مستلم واحد";
    if (count === 2) return "تم إرسال الإعلان إلى مستلمين";
    // CLDR Arabic classes: one/two apply to n = 1/2 EXACTLY; few = 3–10
    // (counted plural); many = 11–99 (tamyiz singular); everything else —
    // including 100/101/102 and their ×100 re-entries — is `other`.
    const cycle = count % 100;
    if (cycle >= 3 && cycle <= 10) return `تم إرسال الإعلان إلى ${count} مستلمين`;
    return `تم إرسال الإعلان إلى ${count} مستلماً`;
  },
  errorTitle: "تعذّر إرسال الإعلان",
};
