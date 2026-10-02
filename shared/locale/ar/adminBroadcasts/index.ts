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
  countryHelperText:
    "يُسلَّم إلى كل مستخدم مُدار تطابق دولته المسجَّلة مع التحديد، بما في ذلك السجلات القديمة المحفوظة كنص عرض.",
  planLabel: "خطة الاشتراك",
  planLoading: "جارٍ تحميل الخطط…",
  previewDisclaimer: "يُحدَّد المستلمون وقت الإرسال — لا تُعرض قائمة المستلمين قبل الإرسال.",
  confirmTitle: "إرسال هذا الإعلان؟",
  confirmBody: "سيتم تسليم الإعلان كإشعار لكل مستلم ضمن الجمهور المحدد.",
  confirmSummaryTitle: "الإعلان",
  confirmSummaryAudience: "الجمهور",
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

  // ─── History & lifecycle surface ────────────────────────────────────────
  historyTab: "السجل",
  composeTab: "إنشاء",
  historyTitle: "سجل الإعلانات",
  historySubtitle: "كل إعلان مُرسل من هذه اللوحة، مع أعداد التسليم وحالته الحالية.",
  filterSearchLabel: "البحث حسب العنوان",
  filterStatusLabel: "الحالة",
  filterAudienceLabel: "نوع الجمهور",
  filterAllLabel: "الكل",
  filterApply: "تطبيق المرشّحات",
  filterReset: "إعادة تعيين المرشّحات",
  columnTitle: "العنوان",
  columnAudience: "الجمهور",
  columnRecipientCount: "المستلمون",
  columnStatus: "الحالة",
  columnSentAt: "وقت الإرسال",
  columnSentBy: "المُرسِل",
  columnActions: "إجراءات",
  statusActive: "نشِط",
  statusStopped: "متوقِّف",
  viewDetails: "عرض التفاصيل",
  stopAction: "إيقاف",
  detailTitle: "تفاصيل الإعلان",
  detailAudience: "الجمهور",
  detailRecipients: "المستلمون",
  detailDelivered: "تم التسليم",
  detailRead: "تمت القراءة",
  detailUnread: "لم تُقرأ",
  detailSentAt: "وقت الإرسال",
  detailStoppedAt: "وقت الإيقاف",
  detailStoppedBy: "تم الإيقاف بواسطة",
  detailRetractedNote: "تم إيقاف هذا الإعلان وسحب إشعاره — لم يعد يُعرض على المستلمين.",
  stopConfirmTitle: "إيقاف هذا الإعلان؟",
  // Same CLDR plural discipline as `successToast` (see the comment there).
  stopConfirmBody: (count: number) => {
    if (count === 0) return "لم يصل الإعلان إلى أي مستلم بعد. سيمنع إيقافه الآن أي تسليم إضافي.";
    if (count === 1) return "وصل هذا الإعلان بالفعل إلى مستلم واحد. سيؤدي إيقافه إلى سحب الإشعار ومنع أي تسليم إضافي.";
    if (count === 2) return "وصل هذا الإعلان بالفعل إلى مستلمين. سيؤدي إيقافه إلى سحب الإشعار ومنع أي تسليم إضافي.";
    const cycle = count % 100;
    if (cycle >= 3 && cycle <= 10) {
      return `وصل هذا الإعلان بالفعل إلى ${count} مستلمين. سيؤدي إيقافه إلى سحب الإشعار ومنع أي تسليم إضافي.`;
    }
    return `وصل هذا الإعلان بالفعل إلى ${count} مستلماً. سيؤدي إيقافه إلى سحب الإشعار ومنع أي تسليم إضافي.`;
  },
  stopConfirmAction: "إيقاف الإعلان",
  stopConfirmCancel: "إلغاء",
  // Same CLDR plural discipline as `successToast` (see the comment there).
  stopSuccessToast: (count: number) => {
    if (count === 0) return "تم إيقاف الإعلان قبل وصوله إلى أي مستلم";
    if (count === 1) return "تم إيقاف الإعلان — كان قد وصل إلى مستلم واحد";
    if (count === 2) return "تم إيقاف الإعلان — كان قد وصل إلى مستلمين";
    const cycle = count % 100;
    if (cycle >= 3 && cycle <= 10) return `تم إيقاف الإعلان — كان قد وصل إلى ${count} مستلمين`;
    return `تم إيقاف الإعلان — كان قد وصل إلى ${count} مستلماً`;
  },
  emptyTitle: "لا توجد إعلانات بعد",
  emptyBody: "ستظهر الإعلانات التي ترسلها من تبويب الإنشاء هنا مع أعداد التسليم وحالتها.",
  pagerPrev: "الصفحة السابقة",
  pagerNext: "الصفحة التالية",
};
