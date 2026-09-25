import { formatArabicReportsCount } from "@/shared/locale/arabic-reports-count";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export const adminAcademicAr: AdminAcademicLabels = {
  // ─── Dashboard page chrome ──────────────────────────────────────────────
  dashboardPageTitle: "التتبع الأكاديمي",
  dashboardPageSubtitle: "تابع مواضع الحفظ والمراجعة ودرجات الواجبات وتقدّم كل طالب — للقراءة فقط.",
  searchLabel: "البحث في الطلاب",
  searchPlaceholder: "ابحث بالاسم أو البريد الإلكتروني...",
  searchClearLabel: "مسح البحث",
  refreshLabel: "تحديث",
  // Plural classes follow Arabic rules: 0 / 1 / 2 / 3–10 / 11+.
  rowsCount: (count: number) => {
    if (count === 0) return "لا يوجد طلاب";
    if (count === 1) return "طالب واحد";
    if (count === 2) return "طالبان";
    if (count <= 10) return `${count.toLocaleString("ar")} طلاب`;
    return `${count.toLocaleString("ar")} طالباً`;
  },
  columnName: "الطالب",
  columnEmail: "البريد الإلكتروني",
  columnLatestJadidPosition: "آخر موضع في الجديد",
  columnLatestMadiPosition: "آخر موضع في الماضي",
  columnJadidAverage: "متوسط الجديد",
  columnMadiAverage: "متوسط الماضي",
  columnProgressRows: "سجلات التقدّم",
  columnLastGradedAt: "آخر تقييم",
  columnAttention: "تنبيه",
  viewDetailAction: "عرض التفاصيل",

  // ─── Dashboard empty states ─────────────────────────────────────────────
  emptyTitle: "لا يوجد طلاب بعد",
  emptyBody: "سيظهر التقدّم الأكاديمي للطلاب هنا بمجرد وجود طلاب وسجلات واجبات.",
  emptyFilteredTitle: "لا يوجد طلاب مطابقون",
  emptyFilteredBody: "لا يوجد طلاب مطابقون لبحثك. جرّب اسمًا أو بريدًا إلكترونيًا آخر.",

  // ─── Advancement statistics block ───────────────────────────────────────
  statsHeading: "إحصاءات التقدّم",
  statTrackedStudents: "الطلاب المتتبَّعون",
  statStudentsWithGradedHomework: "لديهم واجبات مُقيَّمة",
  statAverageJadidGrade: "متوسط درجة الجديد",
  statAverageMadiGrade: "متوسط درجة الماضي",
  statNeedingAttention: "بحاجة إلى تنبيه",

  // ─── Track / position / grade vocabulary ────────────────────────────────
  trackJadid: "الجديد (حفظ جديد)",
  trackMadi: "الماضي (مراجعة)",
  trackJadidShort: "الجديد",
  trackMadiShort: "الماضي",
  trackNoneAssigned: "لا يوجد",
  latestJadidPositionLabel: "آخر موضع في الجديد",
  latestMadiPositionLabel: "آخر موضع في الماضي",
  positionNone: "لا يوجد",
  gradeNotGraded: "لم تُقيَّم بعد",
  gradedHomeworkCount: (count: number) => {
    if (count === 0) return "لا توجد واجبات مُقيَّمة";
    if (count === 1) return "واجب مُقيَّم واحد";
    if (count === 2) return "واجبان مُقيَّمان";
    if (count <= 10) return `${count.toLocaleString("ar")} واجبات مُقيَّمة`;
    return `${count.toLocaleString("ar")} واجباً مُقيَّماً`;
  },
  ayahRangeLabel: "الآيات",

  // ─── Attention flags ────────────────────────────────────────────────────
  attentionBadgeLabel: "بحاجة إلى تنبيه",
  attentionSectionTitle: "بحاجة إلى تنبيه",
  attentionReasonLowGrade: "درجات منخفضة",
  attentionReasonStaleProgress: "تقدّم متوقّف",

  // ─── Drill-down page header + governance banner ─────────────────────────
  detailPageTitle: (studentName: string) => `التقدّم الأكاديمي لـ${studentName}`,
  detailPageSubtitle: "عرض للقراءة فقط لحفظ الطالب ومراجعته وواجباته وتقارير جلساته.",
  backToDashboardAction: "العودة إلى التتبع الأكاديمي",
  emailLabel: "البريد الإلكتروني",
  lastGradedAtLabel: "آخر تقييم",
  accountDeletedBannerTitle: "الحساب محذوف",
  accountDeletedBannerBody: "تم حذف حساب هذا الطالب. يُحتفظ بالسجل الأكاديمي أدناه لأغراض التدقيق وهو للقراءة فقط.",

  // ─── Drill-down progress + histories ────────────────────────────────────
  progressSectionTitle: "التقدّم",
  progressRowCount: (count: number) => {
    if (count === 0) return "لا يوجد تقدّم مسجَّل";
    if (count === 1) return "سجل تقدّم واحد";
    if (count === 2) return "سجلا تقدّم";
    if (count <= 10) return `${count.toLocaleString("ar")} سجلات تقدّم`;
    return `${count.toLocaleString("ar")} سجل تقدّم`;
  },
  homeworkSectionTitle: "سجل الواجبات",
  homeworkCount: (count: number) => {
    if (count === 0) return "لا توجد واجبات";
    if (count === 1) return "واجب واحد";
    if (count === 2) return "واجبان";
    if (count <= 10) return `${count.toLocaleString("ar")} واجبات`;
    return `${count.toLocaleString("ar")} واجباً`;
  },
  homeworkEmptyTitle: "لا توجد واجبات بعد",
  homeworkEmptyBody: "ستظهر الواجبات هنا بعد اكتمال الجلسات.",
  homeworkColumnDate: "التاريخ",
  homeworkColumnTeacher: "المعلم",
  homeworkColumnJadid: "الجديد",
  homeworkColumnMadi: "الماضي",
  homeworkColumnGrade: "الدرجة",
  reportsSectionTitle: "تقارير الجلسات",
  reportsCount: formatArabicReportsCount,
  reportsEmptyTitle: "لا توجد تقارير بعد",
  reportsEmptyBody: "ستظهر تقارير الجلسات هنا بعد اكتمال الجلسات.",
  reportsColumnDate: "التاريخ",
  reportsColumnTeacher: "المعلم",
  reportsColumnNotes: "ملاحظات المعلم",
  reportsColumnRating: "التقييم",
  reportNotesNotSubmitted: "لم تُقدَّم",
  reportRatingNotRated: "لم يُقيَّم بعد",

  // ─── Loading / error scaffolding ────────────────────────────────────────
  loadingLabel: "جارٍ التحميل…",
  loadErrorBody: "تعذّر تحميل هذه المعلومات الآن. يرجى المحاولة مرة أخرى.",

  // ─── Pagination ─────────────────────────────────────────────────────────
  paginationPageOf: (page: number, pageCount: number): string =>
    `صفحة ${page.toLocaleString("ar")} من ${pageCount.toLocaleString("ar")}`,
  paginationPrevious: "السابق",
  paginationNext: "التالي",
};
