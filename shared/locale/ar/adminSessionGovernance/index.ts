import type { AdminSessionGovernanceLabels } from "@/shared/locale/types/adminSessionGovernance";

export const adminSessionGovernanceAr: AdminSessionGovernanceLabels = {
  pageTitle: "حوكمة الجلسات",
  countLine: (count: number) => {
    if (count === 0) return "لا توجد جلسات";
    if (count === 1) return "جلسة واحدة";
    if (count === 2) return "جلستان";
    if (count <= 10) return `${count} جلسات`;
    return `${count} جلسة`;
  },
  summaryScopeHint: "تعكس الأعداد الصفحة المحمّلة فقط.",
  needsAttentionLabel: "تحتاج إلى انتباه",

  filterBarLabel: "مرشّحات الدليل",
  filterTeacherIdLabel: "معرّف المعلّم",
  filterStudentIdLabel: "معرّف الطالب",
  filterTypeLabel: "النوع",
  filterStatusLabel: "الحالة",
  filterDateFromLabel: "أُنشئت من",
  filterDateToLabel: "أُنشئت قبل",
  filterApply: "تطبيق المرشّحات",
  filterReset: "إعادة التعيين",
  filterTypeAll: "كل الأنواع",
  filterStatusAll: "كل الحالات",
  filterInvalidId: "يجب أن تكون معرّفات المستخدمين أعدادًا صحيحة.",
  typeStudentSession: "جلسة طالب",
  typeTeacherEvaluation: "تقييم معلّم",
  typeReEvaluation: "إعادة تقييم",
  intentHifz: "الحفظ",
  intentTajweed: "التجويد",
  intentEvaluation: "التقييم",

  emptyTitle: "لا توجد جلسات",
  emptyBody: "ستظهر هنا جميع جلسات المنصّة بمجرّد أن ينشئها المشاركون.",
  filteredEmptyTitle: "لا توجد جلسات مطابقة لهذه المرشّحات",
  filteredEmptyBody: "عدّل المرشّحات أو أعد تعيينها لتوسيع نطاق البحث.",
  errorTitle: "تعذّر تحميل دليل الجلسات",
  retryLabel: "إعادة المحاولة",

  rowTypeLabel: "النوع",
  rowDurationLabel: "المدة",
  rowStartLabel: "وقت البدء",
  rowEndLabel: "وقت الانتهاء",
  rowDeadlineLabel: "الموعد النهائي للتأكيد",
  rowActionsAriaLabel: "إجراءات الجلسة",
  durationMinutesValue: (minutes: number) => {
    if (minutes === 1) return "دقيقة واحدة";
    if (minutes === 2) return "دقيقتان";
    if (minutes <= 10) return `${minutes} دقائق`;
    return `${minutes} دقيقة`;
  },

  actionViewDetails: "عرض التفاصيل",
  actionReschedule: "إعادة جدولة",
  actionCancel: "إلغاء الجلسة",
  actionReassign: "إسناد معلّم آخر",
  actionViewAndObserve: "عرض ومراقبة",
  rescheduleDisabledHint: "لا يمكن إعادة جدولة إلا الجلسات المجدولة أو الجارية.",
  cancelDisabledHint: "لا يمكن إلغاء إلا الجلسات المجدولة أو الجارية.",
  reassignDisabledHint: "لا يمكن إسناد معلّم آخر إلا للجلسات المجدولة.",
  joinDisabledHint: "لا يمكن الانضمام كمراقب إلا للجلسات الجارية.",

  detailTitle: "تفاصيل الجلسة",
  detailCloseAriaLabel: "إغلاق تفاصيل الجلسة",
  detailMissingBody: "هذه الجلسة غير موجودة أو لم تعد متاحة.",
  detailSessionIdLabel: "معرّف الجلسة",
  detailIntentLabel: "الغرض",
  detailStartLabel: "وقت البدء",
  detailEndLabel: "وقت الانتهاء",
  detailDeadlineLabel: "الموعد النهائي للتأكيد",
  detailConfirmedByStudentLabel: "أكّد الطالب",
  detailConfirmedByTeacherLabel: "أكّد المعلّم",
  detailCancelReasonLabel: "سبب الإلغاء",
  detailDisputeReasonLabel: "سبب النزاع",
  detailResolutionLabel: "ملاحظة تحكيم",
  detailResolvedAtLabel: "تاريخ التحكيم",

  rescheduleTitle: "إعادة جدولة الجلسة",
  rescheduleBody: "حدّد وقت بدء وانتهاء جديدًا. يُطبَّق التغيير فورًا ويُبلَّغ الطرفان.",
  rescheduleStartLabel: "وقت البدء الجديد",
  rescheduleEndLabel: "وقت الانتهاء الجديد",
  rescheduleSubmit: "حفظ الجدول الجديد",
  rescheduleSuccess: "أُعيدت جدولة الجلسة.",

  cancelTitle: "إلغاء الجلسة",
  cancelBody: "يُنهي الإلغاء هذه الجلسة، ويُعيد أي رسوم محجوزة إلى حوض الرصيد الأصلي، ويُبلِّغ الطرفين.",
  cancelReasonLabel: "السبب (اختياري)",
  cancelReasonPlaceholder: "لماذا يتم إلغاء هذه الجلسة؟",
  cancelSubmit: "إلغاء الجلسة",
  cancelSuccess: "أُلغيت الجلسة.",

  reassignTitle: "إسناد معلّم آخر",
  reassignBody: "أسند هذه الجلسة المجدولة إلى معلّم معتمد آخر. سيُبلَّغ الطالب والمعلّمان.",
  reassignTeacherIdLabel: "معرّف المعلّم الجديد",
  reassignTeacherIdPlaceholder: "معرّف المستخدم للمعلّم المستهدف",
  reassignSubmit: "إسناد",
  reassignSuccess: "أُسند المعلّم.",

  joinBannerTitle: "هذه الجلسة جارية الآن",
  joinBannerBody: "يسجّل الانضمام إدخال تدقيق واحدًا فقط ويفتح الجلسة لك كمراقب للقراءة فقط.",
  joinBannerAction: "الانضمام كمراقب",
  joinSuccess: "انضممت كمراقب.",
};
