import type { SessionsLabels } from "@/shared/locale/types/sessions";

export const sessionsAr: SessionsLabels = {
  studentPageTitle: "جلساتي",
  teacherPageTitle: "جلسات التدريس",
  statusFilterAll: "جميع الحالات",
  status: "الحالة",
  intent: "النوع",
  fee: "الرسوم",
  deadline: "الموعد النهائي",
  createdAt: "تاريخ الإنشاء",
  teacherConfirmedAt: "تأكيد المعلم",
  studentConfirmedAt: "تأكيد الطالب",
  studentEmptyTitle: "لا توجد جلسات بعد",
  studentEmptyBody: "عند حجزك جلسة مع أحد المعلمين، ستظهر هنا.",
  teacherEmptyTitle: "لا توجد جلسات بعد",
  teacherEmptyBody: "عند حجز الطلاب جلسات معك، ستظهر هنا.",
  filteredEmptyTitle: "لا توجد جلسات مطابقة لهذا الفلتر",
  filteredEmptyBody: "جرّب حالة مختلفة لعرض المزيد من جلساتك.",
  statusScheduled: "مجدولة",
  statusStarted: "جارية",
  statusCompleted: "مكتملة",
  statusCancelled: "ملغاة",
  statusDisputed: "قيد النزاع",
  startSession: "بدء الجلسة",
  completeSession: "إكمال الجلسة",
  confirmCompletion: "تأكيد الإنجاز",
  confirmCompletionTooltip: "بالتأكيد سيتم تحويل الرسوم المحجوزة إلى محفظة معلمك واعتبار هذه الجلسة نهائية.",
  awaitingStudentConfirmation: "بانتظار تأكيد الطالب",
  cancelSession: "إلغاء الجلسة",
  cancelConfirmTitle: "إلغاء هذه الجلسة؟",
  cancelConfirmBody: "سيتم إلغاء الجلسة وإعادة الرسوم المحجوزة إلى رصيدك.",
  cancelReasonLabel: "السبب (اختياري)",
  cancelReasonPlaceholder: "اذكر سبب الإلغاء (اختياري)",
  openDispute: "فتح نزاع",
  disputeConfirmTitle: "فتح نزاع على هذه الجلسة؟",
  disputeConfirmBody: "سيتم تحويل الجلسة إلى إدارة المنصة للتحكيم. صِف المشكلة حتى يتمكن المسؤول من مراجعتها.",
  disputeReasonLabel: "السبب (مطلوب)",
  disputeReasonPlaceholder: "صف المشكلة في هذه الجلسة",
  disputeReasonRequired: "يرجى وصف سبب النزاع.",
  disputeOpenedNotice: "تم فتح النزاع وسيقوم المسؤول بمراجعته.",
  cancelDisabledDisputed: "الجلسة قيد النزاع بانتظار تحكيم المسؤول ولم يعد بالإمكان إلغاؤها.",
  cancelReasonLine: "سبب الإلغاء",
  disputeReasonLine: "سبب النزاع",
  arbitrationOutcomeLine: "نتيجة التحكيم",
  outcomeCancel: "ملغاة — مع رد الرسوم",
  outcomeComplete: "مكتملة كما جرت",
  outcomeRefund: "رد كامل المبلغ",
  outcomePartialRefund: "رد جزئي للمبلغ",
  outcomeUphold: "أُيدت لصالح الشيخ",
  outcomeUnrecorded: "تم الفصل",
  sessionStartedNotice: "بدأت الجلسة.",
  sessionCompletedNotice: "اكتملت الجلسة.",
  sessionConfirmedNotice: "تم تأكيد الإنجاز وتم تحويل الرسوم المحجوزة إلى المعلم.",
  sessionCancelledNotice: "تم إلغاء الجلسة.",
  holdReleasedNotice: "أُعيدت الرسوم المحجوزة إلى رصيدك.",
  duplicateBookingInfo: "تم إرسال طلب الحجز هذا مسبقاً، ولم يتكرر أي حجز.",
  genericError: "حدث خطأ ما. يرجى المحاولة مرة أخرى.",
  adminDisputesPageTitle: "نزاعات الجلسات",
  adminDisputesCountLine: (count: number) =>
    count === 1 ? "جلسة واحدة بانتظار التحكيم" : `${count} جلسات بانتظار التحكيم`,
  adminDisputesEmptyTitle: "لا توجد جلسات قيد النزاع",
  adminDisputesEmptyBody: "ستظهر هنا الجلسات التي فتح المشاركون نزاعاً عليها لتحكيم المسؤولين.",
  disputeReasonMeta: "سبب النزاع",
  disputedAtLabel: "تاريخ فتح النزاع",
  participantsLabel: "المشاركون",
  resolveDispute: "حل",
  resolveDisputeTitle: "حل النزاع",
  resolveDisputeBody: "اختر نتيجة نهائية واحدة لهذه الجلسة قيد النزاع.",
  resolutionCancelLabel: "إلغاء الجلسة (مع رد الرسوم)",
  resolutionCancelHelper: "سيتم إلغاء الجلسة وإعادة أي رسوم محجوزة إلى حوض الرصيد الأصلي.",
  resolutionCompleteLabel: "وضع كمكتملة",
  resolutionCompleteHelper: "تُعتبر الجلسة مكتملة ويُستهلك حجز الرسوم. لا يمكن إكمال إلا الجلسات التي بدأت فعلاً.",
  resolutionNoteLabel: "ملاحظة (اختيارية)",
  resolutionNotePlaceholder: "أضف ملاحظة تحكيم للسجل (اختياري)",
  resolveDisputeSubmit: "حسم النزاع",
  disputeResolvedNotice: "تم حل النزاع.",
  disputeReasonExpand: "عرض السبب كاملاً",
  disputeReasonCollapse: "عرض أقل",
  pagerPreviousLabel: "الصفحة السابقة",
  pagerNextLabel: "الصفحة التالية",
  ratingStarAriaLabel: (position: number) => `النجمة ${position} من 5`,
  rateTeacher: "تقييم المعلم",
  rateTeacherTooltip: "قيّم معلمك في هذه الجلسة. لا يمكن إرسال التقييم إلا مرة واحدة.",
  rateTeacherDialogTitle: "قيّم معلمك",
  rateTeacherDialogSubmit: "إرسال التقييم",
  rateTeacherDialogCancel: "إلغاء",
  rateTeacherSuccess: "تم إرسال تقييمك للمعلم.",
  teacherRatedChip: "تم التقييم",
  ratingEmptyLabelText: "فارغ",
  escrowHeldChip: "الرسوم محجوزة",
  escrowConsumedChip: "الرسوم مستهلكة",
  resolutionRefundLabel: "رد الرسوم للطالب",
  resolutionRefundHelper: "يُعاد كامل رسوم الجلسة المكتملة إلى الطالب ويُخصم المبلغ من محفظة المعلم.",
  resolutionPartialRefundLabel: "رد جزئي",
  resolutionPartialRefundHelper: "يُعاد جزء محدد من الرسوم إلى الطالب ويبقى الباقي للمعلم. يُحدد المبلغ أدناه.",
  resolutionUpholdLabel: "إقرار الإنجاز",
  resolutionUpholdHelper: "تبقى الجلسة المكتملة كما هي ولا تتحرك أي مبالغ.",
  partialAmountLabel: "مبلغ الرد",
  partialAmountPlaceholder: "مثال: 12.50",
  partialAmountFeeReference: "رسوم الجلسة: {fee} {currency}",
  reviewCase: "مراجعة الملف",
  caseReviewTitle: "مراجعة ملف النزاع",
  caseReviewReportTitle: "تقرير الجلسة",
  caseReviewHomeworkTitle: "واجب الجلسة",
  caseReviewRecitationTitle: "سجل التلاوة",
  caseReviewAuditTitle: "سجل التدقيق",
  caseReviewRatingLabel: "تقييم المعلم للطالب",
  caseReviewHomeworkCurrentLabel: "الواجب الحالي",
  caseReviewHomeworkRevisionLabel: "واجب المراجعة",
  caseReviewEmptyReport: "لم يتم إرسال تقرير لهذه الجلسة.",
  caseReviewEmptyHomework: "لم يُسجل أي واجب لهذه الجلسة.",
  caseReviewEmptyRecitation: "لا يوجد سجل تلاوة لهذه الجلسة.",
  caseReviewEmptyAudit: "لم يتم تسجيل أي إدخالات تدقيق لهذه الجلسة.",
  teacherCaseCta: "تفاصيل النزاع",
  teacherCaseTitle: "ملف النزاع",
  teacherCaseStudentLabel: "الطالب",
  teacherCaseResolutionTitle: "قرار التحكيم",
  teacherCasePendingLine: "بانتظار التحكيم — سيراجع المسؤول هذا النزاع ويصدر القرار.",
  teacherCaseReportTitle: "تقريرك عن الجلسة",
  teacherCaseRatingLabel: "تقييمك للطالب",
  teacherCaseResolvedAtLabel: "تاريخ القرار",
  studentCaseTeacherLabel: "المعلم",
  studentCaseReportTitle: "تقرير الجلسة",
  studentCaseRatingLabel: "تقييم الشيخ",
  adminDisputeAnalyticsTitle: "نظرة عامة على التحكيم",
  adminDisputeAnalyticsOpen: "بانتظار التحكيم",
  adminDisputeAnalyticsResolved: "إجمالي المحسوم",
  adminDisputeAnalyticsOutcomes: "النتائج",

  // ─── Session Report Submission (Jadid & Madi) ───────────────────────────────
  sessionReportAction: "تقرير الجلسة",
  viewHomeworkAction: "الواجب",
  reportDialogPrepareTitle: "مراجعة الواجب السابق",
  reportDialogSubmitTitle: "إرسال تقرير الجلسة",
  reportDialogReviewTitle: "تقرير الجلسة",
  reportNotesLabel: "ملاحظات",
  reportNotesPlaceholder: "دوّن ملاحظاتك عن أداء الطالب في هذه الجلسة (مطلوب، حتى ٢٠٠٠ حرف).",
  reportNotesRequiredMessage: "الملاحظات مطلوبة.",
  reportNotesTooLongMessage: "لا يجوز أن تتجاوز الملاحظات ٢٠٠٠ حرف.",
  reportRatingLabel: "تقييم الطالب",
  reportRatingRequiredMessage: "التقييم مطلوب.",
  reportSubmitLabel: "إرسال التقرير",
  reportCancelLabel: "إلغاء",
  reportSubmitSuccessNotice: "تم إرسال تقرير الجلسة.",
  reportAlreadySubmittedNotice: "تم إرسال تقرير لهذه الجلسة من قبل.",
  reportBlocksRequiredMessage: "يجب إدخال واجب واحد على الأقل (جديد أو مراجعة).",
  reportAyahRangeMessage: "يجب أن تكون الآية من أصغر من أو تساوي الآية إلى.",
  reportGradeRangeMessage: "يجب أن تكون الدرجة بين ٠ و ١٠٠.",
  reportSurahJuzRequiredMessage: "السورة/الجزء مطلوبة لكتلة غير فارغة.",
  jadidSectionTitle: "الحفظ الجديد (جديد)",
  madiSectionTitle: "المراجعة (ماضٍ)",
  fromAyahLabel: "من آية",
  toAyahLabel: "إلى آية",
  surahJuzPickerLabel: "السورة / الجزء",
  gradePreviousSectionTitle: "تقييم الواجب السابق",
  reportFirstSessionHint: "هذه أول جلسة للطالب — لا يوجد واجب سابق لتقييمه.",
  reportAlreadyGradedLabel: "تم التقييم",
  reportGradeJadidLabel: "درجة الجديد",
  reportGradeMadiLabel: "درجة المراجعة",
  reportGradeAriaLabel: (gradeLabel, grade) => `${gradeLabel}: ${grade}`,
  reportTrackEmptyLabel: "لا يوجد واجب لهذا المسار.",
  reportHistorySectionTitle: "سجل الواجب",
  reportHistoryEmptyMessage: "لا يوجد واجب سابق لهذا الطالب بعد.",
  reportSessionDateLabel: "تاريخ الجلسة",
  reportReviewedNotesLabel: "ملاحظات المعلم",
  reportReviewedRatingLabel: "تقييم الطالب",
  surahJuzLabel: (ref: string): string => {
    // Five surah legs as equality-guard early returns (the function-size
    // lint ceiling forbids 35 two-line cases in one switch body); the juz
    // legs ride a switch below. The trailing default is the fail-closed
    // fallback for an unknown ref.
    if (ref === "surah_al_fatihah") return "سورة الفاتحة";
    if (ref === "surah_al_baqarah") return "سورة البقرة";
    if (ref === "surah_aal_imran") return "سورة آل عمران";
    if (ref === "surah_an_nisa") return "سورة النساء";
    if (ref === "surah_al_maidah") return "سورة المائدة";
    switch (ref) {
      case "juz_1":
        return "الجزء ١";
      case "juz_2":
        return "الجزء ٢";
      case "juz_3":
        return "الجزء ٣";
      case "juz_4":
        return "الجزء ٤";
      case "juz_5":
        return "الجزء ٥";
      case "juz_6":
        return "الجزء ٦";
      case "juz_7":
        return "الجزء ٧";
      case "juz_8":
        return "الجزء ٨";
      case "juz_9":
        return "الجزء ٩";
      case "juz_10":
        return "الجزء ١٠";
      case "juz_11":
        return "الجزء ١١";
      case "juz_12":
        return "الجزء ١٢";
      case "juz_13":
        return "الجزء ١٣";
      case "juz_14":
        return "الجزء ١٤";
      case "juz_15":
        return "الجزء ١٥";
      case "juz_16":
        return "الجزء ١٦";
      case "juz_17":
        return "الجزء ١٧";
      case "juz_18":
        return "الجزء ١٨";
      case "juz_19":
        return "الجزء ١٩";
      case "juz_20":
        return "الجزء ٢٠";
      case "juz_21":
        return "الجزء ٢١";
      case "juz_22":
        return "الجزء ٢٢";
      case "juz_23":
        return "الجزء ٢٣";
      case "juz_24":
        return "الجزء ٢٤";
      case "juz_25":
        return "الجزء ٢٥";
      case "juz_26":
        return "الجزء ٢٦";
      case "juz_27":
        return "الجزء ٢٧";
      case "juz_28":
        return "الجزء ٢٨";
      case "juz_29":
        return "الجزء ٢٩";
      case "juz_30":
        return "الجزء ٣٠";
      default:
        // Fail-closed: an unknown ref rides the raw value verbatim so the
        // UI never renders an empty string and the bug surfaces visibly.
        return ref;
    }
  },
};
