import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export const adminAcademicEn: AdminAcademicLabels = {
  // ─── Dashboard page chrome ──────────────────────────────────────────────
  dashboardPageTitle: "Academic Tracking",
  dashboardPageSubtitle:
    "Monitor every student's memorization and revision milestones, homework grades, and advancement — read-only.",
  searchLabel: "Search students",
  searchPlaceholder: "Search by name or email...",
  searchClearLabel: "Clear search",
  refreshLabel: "Refresh",
  rowsCount: (count: number) => {
    if (count === 0) return "No students";
    if (count === 1) return "1 student";
    return `${count} students`;
  },
  columnName: "Student",
  columnEmail: "Email",
  columnLatestJadidPosition: "Latest Jadid position",
  columnLatestMadiPosition: "Latest Madi position",
  columnJadidAverage: "Jadid average",
  columnMadiAverage: "Madi average",
  columnProgressRows: "Progress entries",
  columnLastGradedAt: "Last graded",
  columnAttention: "Attention",
  viewDetailAction: "View details",

  // ─── Dashboard empty states ─────────────────────────────────────────────
  emptyTitle: "No students yet",
  emptyBody: "Student academic progress will appear here once students and homework records exist.",
  emptyFilteredTitle: "No matching students",
  emptyFilteredBody: "No students match your search. Try a different name or email.",

  // ─── Advancement statistics block ───────────────────────────────────────
  statsHeading: "Advancement statistics",
  statTrackedStudents: "Tracked students",
  statStudentsWithGradedHomework: "With graded homework",
  statAverageJadidGrade: "Average Jadid grade",
  statAverageMadiGrade: "Average Madi grade",
  statNeedingAttention: "Needing attention",

  // ─── Track / position / grade vocabulary ────────────────────────────────
  trackJadid: "Jadid (new memorization)",
  trackMadi: "Madi (revision)",
  trackJadidShort: "Jadid",
  trackMadiShort: "Madi",
  trackNoneAssigned: "None assigned",
  latestJadidPositionLabel: "Latest Jadid position",
  latestMadiPositionLabel: "Latest Madi position",
  positionNone: "None",
  gradeNotGraded: "Not graded yet",
  gradedHomeworkCount: (count: number) => {
    if (count === 0) return "None graded";
    if (count === 1) return "1 graded";
    return `${count} graded`;
  },
  ayahRangeLabel: "Ayahs",

  // ─── Attention flags ────────────────────────────────────────────────────
  attentionBadgeLabel: "Needs attention",
  attentionSectionTitle: "Needs attention",
  attentionReasonLowGrade: "Low grades",
  attentionReasonStaleProgress: "Stalled progress",

  // ─── Drill-down page header + governance banner ─────────────────────────
  detailPageTitle: (studentName: string) => `${studentName}'s academic progress`,
  detailPageSubtitle: "Read-only view of the student's memorization, revision, homework, and session reports.",
  backToDashboardAction: "Back to Academic Tracking",
  emailLabel: "Email",
  lastGradedAtLabel: "Last graded",
  accountDeletedBannerTitle: "Account deleted",
  accountDeletedBannerBody:
    "This student's account has been deleted. The academic history below is retained for audit and is read-only.",

  // ─── Drill-down progress + histories ────────────────────────────────────
  progressSectionTitle: "Progress",
  progressRowCount: (count: number) => {
    if (count === 0) return "No recorded progress";
    if (count === 1) return "1 progress entry";
    return `${count} progress entries`;
  },
  homeworkSectionTitle: "Homework history",
  homeworkCount: (count: number) => {
    if (count === 0) return "No homework";
    if (count === 1) return "1 homework entry";
    return `${count} homework entries`;
  },
  homeworkEmptyTitle: "No homework yet",
  homeworkEmptyBody: "Homework entries will appear here after sessions are completed.",
  homeworkColumnDate: "Date",
  homeworkColumnTeacher: "Teacher",
  homeworkColumnJadid: "Jadid",
  homeworkColumnMadi: "Madi",
  homeworkColumnGrade: "Grade",
  reportsSectionTitle: "Session reports",
  reportsCount: (count: number) => {
    if (count === 0) return "No reports";
    if (count === 1) return "1 report";
    return `${count} reports`;
  },
  reportsEmptyTitle: "No reports yet",
  reportsEmptyBody: "Session reports will appear here after sessions are completed.",
  reportsColumnDate: "Date",
  reportsColumnTeacher: "Teacher",
  reportsColumnNotes: "Teacher notes",
  reportsColumnRating: "Rating",
  reportNotesNotSubmitted: "Not submitted",
  reportRatingNotRated: "Not rated yet",

  // ─── Loading / error scaffolding ────────────────────────────────────────
  loadingLabel: "Loading…",
  loadErrorBody: "We couldn't load this information right now. Please try again.",

  // ─── Pagination ─────────────────────────────────────────────────────────
  paginationPageOf: (page: number, pageCount: number): string => `Page ${page} of ${pageCount}`,
  paginationPrevious: "Previous",
  paginationNext: "Next",
};
