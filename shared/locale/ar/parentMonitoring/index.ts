import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

export const parentMonitoringAr: ParentMonitoringLabels = {
  // ─── Portal root / linked-children list ─────────────────────────────────
  portalPageTitle: "أبناؤك",
  portalPageSubtitle: "تابع حضور كل طفل وتقاريره وواجباته وتقييماته وتقدّمه.",
  childSwitcherLabel: "اختر الطفل",
  // Plural classes follow Arabic rules: 0 / 1 / 2 / 3–10 / 11+.
  childrenCount: (count: number) => {
    if (count === 0) return "لا يوجد أبناء مرتبطون";
    if (count === 1) return "طفل واحد مرتبط";
    if (count === 2) return "طفلان مرتبطان";
    if (count <= 10) return `${count.toLocaleString("ar")} أبناء مرتبطون`;
    return `${count.toLocaleString("ar")} طفلاً مرتبطاً`;
  },
  childrenEmptyTitle: "لا يوجد أبناء مرتبطون بعد",
  childrenEmptyBody: "بمجرد أن يؤكد طفلك طلب الربط، سيظهر هنا.",
  childrenEmptyCta: "إرسال طلب ربط",
  sessionTargetUnavailableNotice: "تفاصيل هذه الجلسة لم تعد متاحة.",

  // ─── Detail page header ─────────────────────────────────────────────────
  detailPageTitle: (childName: string) => `تقدّم ${childName}`,
  detailPageSubtitle: "مراقبة للحضور والتقارير والواجبات والتقييمات والتقدّم — للقراءة فقط.",

  // ─── Session deep-link row chip ────────────────────────────────────────
  deepLinkChip: "من إشعار الجلسة",

  // ─── Tab labels ─────────────────────────────────────────────────────────
  tabAttendance: "الحضور",
  tabReports: "التقارير",
  tabHomework: "الواجبات",
  tabEvaluations: "التقييمات",
  tabProgress: "التقدّم",

  // ─── Homework track vocabulary ──────────────────────────────────────────
  trackJadid: "الجديد (حفظ جديد)",
  trackMadi: "الماضي (مراجعة)",
  trackNoneAssigned: "لا يوجد",

  // ─── Rating / progress / position fallbacks ─────────────────────────────
  ratingNotRated: "لم يُقيَّم بعد",
  ratingColumnLabel: "التقييم",
  progressNoRecorded: "لا يوجد تقدّم مسجَّل بعد",
  progressPositionNone: "لا يوجد",
  progressLatestJadidLabel: "آخر موضع في الجديد",
  progressLatestMadiLabel: "آخر موضع في الماضي",

  // ─── Attendance tab ─────────────────────────────────────────────────────
  attendanceSectionTitle: "سجل الحضور",
  attendanceCount: (count: number) => {
    if (count === 0) return "لا توجد جلسات";
    if (count === 1) return "جلسة واحدة";
    if (count === 2) return "جلستان";
    if (count <= 10) return `${count.toLocaleString("ar")} جلسات`;
    return `${count.toLocaleString("ar")} جلسة`;
  },
  attendanceEmptyTitle: "لا توجد جلسات بعد",
  attendanceEmptyBody: "سيظهر الحضور هنا بمجرد جدولة جلسات طفلك.",
  attendanceColumnDate: "التاريخ",
  attendanceColumnStatus: "الحالة",
  attendanceStatusAttended: "حضر",
  attendanceStatusCancelled: "ملغاة",
  attendanceStatusDisputed: "قيد النزاع",
  attendanceStatusScheduled: "مجدولة",
  attendanceStatusStarted: "جارية",

  // ─── Reports tab ────────────────────────────────────────────────────────
  reportsSectionTitle: "تقارير الجلسات",
  reportsCount: (count: number) => {
    if (count === 0) return "لا توجد تقارير";
    if (count === 1) return "تقرير واحد";
    if (count === 2) return "تقريران";
    if (count <= 10) return `${count.toLocaleString("ar")} تقارير`;
    return `${count.toLocaleString("ar")} تقريراً`;
  },
  reportsEmptyTitle: "لا توجد تقارير بعد",
  reportsEmptyBody: "ستظهر ملاحظات المعلم والتقييمات هنا بعد كل جلسة مكتملة.",
  reportsColumnDate: "التاريخ",
  reportsColumnNotes: "ملاحظات المعلم",
  reportsColumnRating: "التقييم",

  // ─── Homework tab ───────────────────────────────────────────────────────
  homeworkSectionTitle: "الواجبات",
  homeworkCount: (count: number) => {
    if (count === 0) return "لا توجد واجبات";
    if (count === 1) return "واجب واحد";
    if (count === 2) return "واجبان";
    if (count <= 10) return `${count.toLocaleString("ar")} واجبات`;
    return `${count.toLocaleString("ar")} واجباً`;
  },
  homeworkEmptyTitle: "لا توجد واجبات بعد",
  homeworkEmptyBody: "ستظهر مسارات الجديد والماضي هنا بعد كل جلسة مكتملة.",
  homeworkColumnDate: "التاريخ",
  homeworkColumnJadid: "الجديد",
  homeworkColumnMadi: "الماضي",
  homeworkColumnGrade: "الدرجة",

  // ─── Evaluations tab ────────────────────────────────────────────────────
  evaluationsSectionTitle: "تقييمات المعلم",
  evaluationsCount: (count: number) => {
    if (count === 0) return "لا توجد تقييمات";
    if (count === 1) return "تقييم واحد";
    if (count === 2) return "تقييمان";
    if (count <= 10) return `${count.toLocaleString("ar")} تقييمات`;
    return `${count.toLocaleString("ar")} تقييماً`;
  },
  evaluationsEmptyTitle: "لا توجد تقييمات بعد",
  evaluationsEmptyBody: "ستظهر التقييمات لكل جلسة هنا بعد كل جلسة مكتملة.",
  evaluationsColumnDate: "التاريخ",
  evaluationsColumnScore: "الدرجة",
  evaluationsColumnNotes: "ملاحظات",

  // ─── Progress tab ───────────────────────────────────────────────────────
  progressSectionTitle: "التقدّم في المنهج",
  progressRowCount: (count: number) => {
    if (count === 0) return "لا يوجد تقدّم مسجَّل";
    if (count === 1) return "سجل تقدّم واحد";
    if (count === 2) return "سجلا تقدّم";
    if (count <= 10) return `${count.toLocaleString("ar")} سجلات تقدّم`;
    return `${count.toLocaleString("ar")} سجل تقدّم`;
  },
  progressEmptyTitle: "لا يوجد تقدّم مسجَّل بعد",
  progressEmptyBody: "ستظهر مؤشرات موضع المنهج هنا بمجرد تسجيل التقدّم.",

  // ─── Loading / error scaffolding ────────────────────────────────────────
  loadingLabel: "جارٍ التحميل…",
  loadErrorBody: "تعذّر تحميل هذه المعلومات الآن. يرجى المحاولة مرة أخرى.",
  refreshLabel: "تحديث",
  ayahRangeLabel: "الآيات",
  backToChildrenAction: "العودة إلى أبنائي",
  lastUpdatedLabel: (timestamp: string): string => `آخر تحديث: ${timestamp}`,
  statTotalChildren: "إجمالي الأبناء",
  statRecentSessions: "الحصص الأخيرة",
  printLabel: "طباعة / تصدير",
  printDialogTitle: "تصدير التقارير",
  printOption: "طباعة",
  exportCsvOption: "تصدير كـ CSV",
  exportSuccess: "تم التصدير بنجاح",
  calendarViewLabel: "عرض التقويم",
  listViewLabel: "عرض القائمة",
  calendarMonthLabel: "الشهر",
  printTimestampLabel: (timestamp: string): string => `طُبع في ${timestamp}`,
  csvStatusColumn: "حالة الحصة",
  statTotalSessions: "إجمالي الحصص",
  statCompletedSessions: "مكتملة",
  statCompletionRate: "نسبة الإكمال",
  statUpcomingSessions: "قادمة",
  summaryHeading: "الملخص",
  homeworkSummaryHeading: "تقدم الواجبات",
  statLatestJadid: "أحدث الجديد",
  statLatestMadi: "أحدث الماضي",
  statAverageGrade: "متوسط الدرجة",
  statHomeworkCount: "عدد الواجبات",
  ratingTrendHeading: "اتجاه التقييم",
  ratingTrendAxisLabel: "التقييم",
  ratingTrendSessionLabel: "الحصة",
  ratingTrendEmpty: "لا توجد بيانات تقييم بعد",
  progressSummaryHeading: "نظرة عامة على التقدم",
  statProgressRows: "صفوف التقدم",
  statCoverageAreas: "المناطق المغطاة",
  statActiveTrack: "المسار النشط",
  statEnrolledSince: "تاريخ الالتحاق",
  evaluationsSummaryHeading: "نظرة عامة على التقييمات",
  statTotalEvaluations: "إجمالي التقييمات",
  statAverageScore: "متوسط الدرجة",
  statHighestScore: "أعلى درجة",
  statRatedSessions: "الحصص المقيّمة",
  searchPlaceholder: "ابحث بالملاحظات أو التاريخ...",
  searchClearLabel: "مسح البحث",
  searchNoResults: "لا توجد نتائج مطابقة لبحثك",
  filterByRatingLabel: "تصفية حسب التقييم",
  filterAllRatings: "كل التقييمات",
  sortByLabel: "ترتيب حسب",
  sortDateDesc: "التاريخ (الأحدث)",
  sortDateAsc: "التاريخ (الأقدم)",
  sortRatingDesc: "التقييم (الأعلى)",
  sortRatingAsc: "التقييم (الأقل)",
  csvJadidColumn: "الجديد - السورة/الجزء",
  csvMadiColumn: "الماضي - السورة/الجزء",
  csvGradeColumn: "الدرجة",
  homeworkPrintDialogTitle: "تصدير الواجبات",
};
