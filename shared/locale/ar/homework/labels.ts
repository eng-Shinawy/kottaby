import type { HomeworkLabels } from "@/shared/locale/types/homework";

export const homeworkAr: HomeworkLabels = {
  pageTitle: "الواجبات",
  listHeading: "واجباتك",
  summaryTotalLabel: "الواجبات",
  summaryGradedLabel: "المُقيَّمة",
  summaryPendingLabel: "بانتظار التقييم",
  trackJadid: "الجديد (حفظ جديد)",
  trackMadi: "الماضي (مراجعة)",
  trackNoneAssigned: "لا يوجد",
  gradeLabel: "الدرجة",
  assignedPrefix: "أُسندت في",
  sessionLine: (id: number) => `الجلسة #${id}`,
  countLine: (count: number) => {
    if (count === 0) return "لا واجبات";
    if (count === 1) return "واجب واحد";
    if (count === 2) return "واجبان";
    if (count <= 10) return `${count} واجبات`;
    return `${count} واجبًا`;
  },
  emptyTitle: "لا واجبات بعد",
  emptyBody: "تظهر الواجبات هنا بعد إكمال الجلسة — يُسجِّل الشيخ مقاطع الحفظ الجديد والمراجعة، ثم يضع الدرجات مع تقدمك.",
  errorTitle: "تعذَّر تحميل الواجبات",
  errorBody: "حدث خطأ ما. حاول مرة أخرى.",
  loadingLabel: "جارٍ تحميل الواجبات",
  printLabel: "طباعة الواجبات أو تصديرها",
  printDialogTitle: "طباعة الواجبات أو تصديرها",
  printOption: "طباعة",
  exportCsvOption: "تصدير كـ CSV",
  csvColumnDate: "التاريخ",
  csvColumnJadid: "الجديد - السورة/الجزء",
  csvColumnMadi: "الماضي - السورة/الجزء",
  csvColumnGrade: "الدرجة",
  filterAllLabel: "عرض كل الواجبات",
  filterGradedLabel: "عرض الواجبات المُقيَّمة فقط",
  filterPendingLabel: "عرض الواجبات بانتظار التقييم فقط",
  statusGradedChip: "مُقيَّم",
  statusPendingChip: "بانتظار التقييم",
  filterEmptyTitle: "لا شيء في هذا التصنيف",
  filterEmptyBody: "لا واجبات تطابق هذا التصنيف بعد — اختر البطاقة مرة أخرى (أو الكل) لعرض كامل السجل.",
  searchPlaceholder: "ابحث بالمقطع أو التاريخ...",
  searchClearLabel: "مسح البحث",
  searchNoResults: "لا توجد نتائج مطابقة لبحثك",
  searchEmptyBody: "جرّب مقطعًا أو تاريخًا آخرًا — أو امسح البحث لعرض كامل السجل.",
};
