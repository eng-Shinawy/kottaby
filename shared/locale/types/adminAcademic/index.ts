/**
 * `adminAcademic` namespace labels — the admin-only academic monitoring
 * surface (`/admin/academic-tracking` + its `[studentId]` drill-down):
 * dashboard chrome, per-track position/grade vocabulary, aggregate
 * advancement statistics, attention flags, per-student drill-down sections,
 * the soft-delete governance banner, and pagination/empty/loading states.
 *
 *  Surfaces covered:
 *  1. Dashboard (`/admin/academic-tracking`) — page heading, search bar,
 *     the all-students table (identity + latest positions + grade averages
 *     + progress + last-graded + attention columns), the advancement
 *     statistics block, pagination, and empty/loading/error states.
 *  2. Drill-down (`/admin/academic-tracking/[studentId]`) — the student
 *     header (name/email/last-graded), the "account deleted" governance
 *     banner, the attention section, the honest progress count, and the
 *     paginated homework + session-report histories.
 *  3. Track vocabulary — Jadid (new memorization) and Madi (revision)
 *     names MIRROR the `parentMonitoring` terms exactly (one shared
 *     vocabulary across both surfaces; no divergent terminology).
 *
 * Copy functions receive ALREADY-ASSEMBLED display values (student name,
 * count, page numbers) — never raw ids, codes, or grades. Plural counts
 * are typed as `(count: number) => string` so each locale owns its
 * plural-class branching; the component passes the resolved number only.
 *
 * Used by:
 *  - Frontend `AdminAcademicTrackingContainer` and
 *    `AdminStudentAcademicDetailContainer` via
 *    `useAppTranslation(AdminAcademic)`.
 *  - Server shells on the two routes via
 *    `getTranslations(locale).adminAcademicTranslations`.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `adminAcademic-namespace.parity
 * .test.ts` runtime belt). Property access only — never call-by-key.
 * Denial copy (non-admin 403s, not-found, bounds validation) stays on the
 * `errors` namespace — this namespace owns monitoring UI copy only and
 * never states WHY an actor was denied.
 */
export interface AdminAcademicLabels {
  // ─── Dashboard page chrome ──────────────────────────────────────────────
  /** Dashboard page heading (page header band + `generateMetadata`). */
  readonly dashboardPageTitle: string;
  /** Dashboard intro line under the heading. */
  readonly dashboardPageSubtitle: string;
  /** Accessible label for the student search input. */
  readonly searchLabel: string;
  /** Placeholder shown inside an empty search input. */
  readonly searchPlaceholder: string;
  /** Accessible label for the clear-search button inside the search input. */
  readonly searchClearLabel: string;
  /** Refresh button label (re-fetches the active query). */
  readonly refreshLabel: string;
  /**
   * Pluralized count of students in the current listing scope (zero, one,
   * or many) — rendered beside the table / over the empty states.
   */
  readonly rowsCount: (count: number) => string;
  /** Table column header — student identity (name; email below). */
  readonly columnName: string;
  /** Table column header — student email. */
  readonly columnEmail: string;
  /** Table column header — latest Jadid (new memorization) position. */
  readonly columnLatestJadidPosition: string;
  /** Table column header — latest Madi (revision) position. */
  readonly columnLatestMadiPosition: string;
  /** Table column header — Jadid average grade. */
  readonly columnJadidAverage: string;
  /** Table column header — Madi average grade. */
  readonly columnMadiAverage: string;
  /** Table column header — recorded progress rows (honest count). */
  readonly columnProgressRows: string;
  /** Table column header — last graded homework activity timestamp. */
  readonly columnLastGradedAt: string;
  /** Table column header — attention flag. */
  readonly columnAttention: string;
  /** Per-row drill-down link label. */
  readonly viewDetailAction: string;

  // ─── Dashboard empty states ─────────────────────────────────────────────
  /** Empty-state title when no students exist at all. */
  readonly emptyTitle: string;
  /** Empty-state body explaining when rows will appear (zero students). */
  readonly emptyBody: string;
  /** Empty-state title when the search returned zero matches. */
  readonly emptyFilteredTitle: string;
  /** Empty-state body suggesting a different search. */
  readonly emptyFilteredBody: string;

  // ─── Advancement statistics block ───────────────────────────────────────
  /** Section heading for the aggregate statistics block. */
  readonly statsHeading: string;
  /** Stat card label — tracked (non-deleted) student count. */
  readonly statTrackedStudents: string;
  /** Stat card label — students with at least one graded homework row. */
  readonly statStudentsWithGradedHomework: string;
  /** Stat card label — average Jadid grade (null until graded rows exist). */
  readonly statAverageJadidGrade: string;
  /** Stat card label — average Madi grade (null until graded rows exist). */
  readonly statAverageMadiGrade: string;
  /** Stat card label — students currently flagged as needing attention. */
  readonly statNeedingAttention: string;

  // ─── Track / position / grade vocabulary (mirrors parentMonitoring) ─────
  /** Jadid track label (new memorization). */
  readonly trackJadid: string;
  /** Madi track label (revision). */
  readonly trackMadi: string;
  /** Short track labels for dense-table grade cells (no parenthetical). */
  readonly trackJadidShort: string;
  readonly trackMadiShort: string;
  /** Inline copy when a homework track block is wholly absent (null). */
  readonly trackNoneAssigned: string;
  /** Section/column label introducing the latest Jadid position slot. */
  readonly latestJadidPositionLabel: string;
  /** Section/column label introducing the latest Madi position slot. */
  readonly latestMadiPositionLabel: string;
  /** Inline copy when a latest-position slot (Jadid or Madi) is null. */
  readonly positionNone: string;
  /** Inline copy for an ungraded track (null average — never fabricated as 0). */
  readonly gradeNotGraded: string;
  /** Pluralized count of a track's graded homework rows. */
  readonly gradedHomeworkCount: (count: number) => string;
  /** Localized "Ayah(s)" prefix for a surah/ayah run (position block). */
  readonly ayahRangeLabel: string;

  // ─── Attention flags ────────────────────────────────────────────────────
  /** Badge label rendered on a flagged dashboard row. */
  readonly attentionBadgeLabel: string;
  /** Detail-page section heading for the student's attention flag. */
  readonly attentionSectionTitle: string;
  /** Attention-reason label — low recent Jadid grade average (`lowGrade`). */
  readonly attentionReasonLowGrade: string;
  /**
   * Attention-reason label — graded homework gone quiet past the attention
   * window (`staleProgress`).
   */
  readonly attentionReasonStaleProgress: string;

  // ─── Drill-down page header + governance banner ─────────────────────────
  /**
   * Drill-down page title — interpolates the student's already-resolved
   * display name (an admin-only surface rendering directory data).
   */
  readonly detailPageTitle: (studentName: string) => string;
  /** Drill-down page subtitle / context line under the heading. */
  readonly detailPageSubtitle: string;
  /** Drill-down recovery action: navigate back to the dashboard list. */
  readonly backToDashboardAction: string;
  /** Header row caption for the student email. */
  readonly emailLabel: string;
  /** Header row caption for the last graded homework timestamp. */
  readonly lastGradedAtLabel: string;
  /**
   * Governance banner title — the soft-deleted student marker (`isDeleted`
   * on the drill-down echo). States the deletion as a fact; the banner MUST
   * stay free of deletion cause, date, or actor details (those never cross
   * the wire).
   */
  readonly accountDeletedBannerTitle: string;
  /**
   * Governance banner body — the retained-for-audit explanation under the
   * title. Same disclosure discipline: the fact and the read-only history,
   * nothing else.
   */
  readonly accountDeletedBannerBody: string;

  // ─── Drill-down progress + histories ────────────────────────────────────
  /** Drill-down section heading for the honest progress row count. */
  readonly progressSectionTitle: string;
  /** Pluralized count of recorded progress rows (bare count, never a %). */
  readonly progressRowCount: (count: number) => string;
  /** Homework-history section heading (both tracks). */
  readonly homeworkSectionTitle: string;
  /** Pluralized count of homework history entries. */
  readonly homeworkCount: (count: number) => string;
  /** Empty-state title (no homework yet). */
  readonly homeworkEmptyTitle: string;
  /** Empty-state body (where homework entries will appear). */
  readonly homeworkEmptyBody: string;
  /** Column header for the session date (falls back to the row's creation). */
  readonly homeworkColumnDate: string;
  /** Column header for the owning teacher. */
  readonly homeworkColumnTeacher: string;
  /** Column header for the Jadid track block. */
  readonly homeworkColumnJadid: string;
  /** Column header for the Madi track block. */
  readonly homeworkColumnMadi: string;
  /** Column header for the grade. */
  readonly homeworkColumnGrade: string;
  /** Report-history section heading. */
  readonly reportsSectionTitle: string;
  /** Pluralized count of report history entries. */
  readonly reportsCount: (count: number) => string;
  /** Empty-state title (no reports yet). */
  readonly reportsEmptyTitle: string;
  /** Empty-state body (where reports will appear). */
  readonly reportsEmptyBody: string;
  /** Column header for the session date (falls back to the row's creation). */
  readonly reportsColumnDate: string;
  /** Column header for the owning teacher. */
  readonly reportsColumnTeacher: string;
  /** Column header for the teacher notes. */
  readonly reportsColumnNotes: string;
  /** Column header for the per-session teacher rating (0–5 scale). */
  readonly reportsColumnRating: string;
  /** Inline copy for null teacher notes ("not submitted" — never coerced). */
  readonly reportNotesNotSubmitted: string;
  /** Inline copy for a null teacher rating ("not rated yet" — never 0). */
  readonly reportRatingNotRated: string;

  // ─── Loading / error scaffolding ────────────────────────────────────────
  /** Loading copy for `aria-busy` skeletons while a query is in flight. */
  readonly loadingLabel: string;
  /**
   * Inline-alert body when a query fails (the retry affordance reuses
   * `CommonLabels.retry` — no separate key).
   */
  readonly loadErrorBody: string;

  // ─── Pagination ─────────────────────────────────────────────────────────
  /** Page counter — interpolates the effective page and ceiling page count. */
  readonly paginationPageOf: (page: number, pageCount: number) => string;
  /** Previous-page button label. */
  readonly paginationPrevious: string;
  /** Next-page button label. */
  readonly paginationNext: string;
}
