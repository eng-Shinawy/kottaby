/**
 * Parent-monitoring namespace labels — the read-only portal that lets a
 * parent follow a confirmed-linked child's Quranic studies.
 *
 *  Surfaces covered:
 *  1. Portal root (`/parent/children`) — the linked-children list, child
 *     switcher, the zero-children empty state with a handshake CTA, and
 *     the transient notice for an unresolvable session deep link.
 *  2. Child detail (`/parent/children/<studentId>`) — header, MUI Tabs
 *     strip (attendance / reports / homework / evaluations / progress),
 *     per-tab empty states, and per-tab column headers.
 *  3. Homework track vocabulary — the Jadid (new memorization) and Madi
 *     (revision) track names, plus the "none assigned" inline copy used
 *     when a track block is wholly absent on a homework row.
 *  4. Rating / progress / position fallbacks — "not rated yet" for null
 *     teacher ratings (never fabricated as 0), "no recorded progress
 *     yet" for empty progress, and "—" style copy for null position
 *     slots.
 *
 * Copy functions receive ALREADY-ASSEMBLED display values (child name,
 * count, formatted date) — never raw ids, codes, or contact data. Plural
 * counts are typed as `(count: number) => string` so each locale owns
 * its plural-class branching; the component passes the resolved number
 * only.
 *
 * Used by:
 *  - Frontend `ParentChildrenRootContainer` and `ParentChildDetailContainer`
 *    via `useAppTranslation(ParentMonitoring)`.
 *  - The five portal tab components (`AttendanceTab`, `ReportsTab`,
 *    `HomeworkTab`, `EvaluationsTab`, `ProgressTab`).
 *  - Server components on the portal routes via
 *    `getTranslations(locale).parentMonitoringTranslations`.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `parentMonitoring-namespace
 * .parity.test.ts` runtime belt). Property access only — never
 * call-by-key. Denial copy for 403 responses stays on the `errors`
 * namespace; this namespace owns portal UI copy only.
 */
export interface ParentMonitoringLabels {
  // ─── Portal root / linked-children list ─────────────────────────────────
  /** Page heading for the portal root (the parent's linked-children list). */
  readonly portalPageTitle: string;
  /** Page intro copy under the portal root heading. */
  readonly portalPageSubtitle: string;
  /** Accessible label for the child switcher (MUI Select on the detail header). */
  readonly childSwitcherLabel: string;
  /**
   * Pluralized count of linked children — receives the resolved count
   * (zero, one, or many). Rendered above the children list or in the
   * detail header strip.
   */
  readonly childrenCount: (count: number) => string;
  /** Empty-state title when the parent has zero linked children. */
  readonly childrenEmptyTitle: string;
  /** Empty-state body directing the parent to the handshake flow. */
  readonly childrenEmptyBody: string;
  /** CTA label deep-linking to the parent handshake route. */
  readonly childrenEmptyCta: string;
  /**
   * Transient inline notice shown on the portal root when a session
   * deep link fails to resolve (stale link, severed link, or a session
   * outside this parent's scope). States unavailability only — the copy
   * MUST stay free of session ids, child names, grades, scores, notes,
   * and digits (existence non-disclosure); the portal then falls through
   * to its normal first-child behavior.
   */
  readonly sessionTargetUnavailableNotice: string;

  // ─── Detail page header ─────────────────────────────────────────────────
  /**
   * Detail page title — interpolates the child's already-localized
   * display name (a confirmed-linked child's full name is shown to its
   * own parent unmasked).
   */
  readonly detailPageTitle: (childName: string) => string;
  /** Detail page subtitle / context line under the heading. */
  readonly detailPageSubtitle: string;

  // ─── Session deep-link row chip ────────────────────────────────────────
  /**
   * Chip label on the row a `?session=` deep link points at (rendered at
   * the row's top-start corner on the reports / homework / evaluations
   * tabs to explain why that row is highlighted).
   */
  readonly deepLinkChip: string;

  // ─── Tab labels ─────────────────────────────────────────────────────────
  /** Attendance tab label (session-status-derived history). */
  readonly tabAttendance: string;
  /** Reports tab label (teacher notes + ratings). */
  readonly tabReports: string;
  /** Homework tab label (Jadid & Madi tracks). */
  readonly tabHomework: string;
  /** Evaluations tab label (per-session evaluation lens on reports). */
  readonly tabEvaluations: string;
  /** Progress tab label (curriculum position indicators). */
  readonly tabProgress: string;

  // ─── Homework track vocabulary ──────────────────────────────────────────
  /** Jadid track label (new memorization). */
  readonly trackJadid: string;
  /** Madi track label (revision). */
  readonly trackMadi: string;
  /** Inline copy when a homework track block is wholly absent (null). */
  readonly trackNoneAssigned: string;

  // ─── Rating / progress / position fallbacks ─────────────────────────────
  /**
   * Inline copy for a null teacher rating ("not rated yet" — never
   * fabricated as 0).
   */
  readonly ratingNotRated: string;
  /** Column-header label for the teacher rating column. */
  readonly ratingColumnLabel: string;
  /** Inline copy when no progress rows exist for the child. */
  readonly progressNoRecorded: string;
  /** Inline copy when the latest position slot (Jadid or Madi) is null. */
  readonly progressPositionNone: string;
  /** Section label introducing the latest Jadid position slot. */
  readonly progressLatestJadidLabel: string;
  /** Section label introducing the latest Madi position slot. */
  readonly progressLatestMadiLabel: string;

  // ─── Attendance tab ─────────────────────────────────────────────────────
  /** Attendance tab section heading. */
  readonly attendanceSectionTitle: string;
  /** Pluralized count of attendance (session) rows. */
  readonly attendanceCount: (count: number) => string;
  /** Empty-state title (no sessions yet). */
  readonly attendanceEmptyTitle: string;
  /** Empty-state body (where attendance will appear). */
  readonly attendanceEmptyBody: string;
  /** Column header for the session date. */
  readonly attendanceColumnDate: string;
  /** Column header for the session status. */
  readonly attendanceColumnStatus: string;
  /** Status label — completed session (attended). */
  readonly attendanceStatusAttended: string;
  /** Status label — cancelled session. */
  readonly attendanceStatusCancelled: string;
  /** Status label — disputed session. */
  readonly attendanceStatusDisputed: string;
  /** Status label — scheduled session (upcoming). */
  readonly attendanceStatusScheduled: string;
  /** Status label — started session (in progress). */
  readonly attendanceStatusStarted: string;

  // ─── Reports tab ────────────────────────────────────────────────────────
  /** Reports tab section heading. */
  readonly reportsSectionTitle: string;
  /** Pluralized count of report rows. */
  readonly reportsCount: (count: number) => string;
  /** Empty-state title (no reports yet). */
  readonly reportsEmptyTitle: string;
  /** Empty-state body (where reports will appear). */
  readonly reportsEmptyBody: string;
  /** Column header for the session date. */
  readonly reportsColumnDate: string;
  /** Column header for the teacher notes. */
  readonly reportsColumnNotes: string;
  /** Column header for the teacher rating. */
  readonly reportsColumnRating: string;

  // ─── Homework tab ───────────────────────────────────────────────────────
  /** Homework tab section heading. */
  readonly homeworkSectionTitle: string;
  /** Pluralized count of homework rows. */
  readonly homeworkCount: (count: number) => string;
  /** Empty-state title (no homework yet). */
  readonly homeworkEmptyTitle: string;
  /** Empty-state body (where homework will appear). */
  readonly homeworkEmptyBody: string;
  /** Column header for the session date. */
  readonly homeworkColumnDate: string;
  /** Column header for the Jadid track block. */
  readonly homeworkColumnJadid: string;
  /** Column header for the Madi track block. */
  readonly homeworkColumnMadi: string;
  /** Column header for the grade. */
  readonly homeworkColumnGrade: string;

  // ─── Evaluations tab ────────────────────────────────────────────────────
  /** Evaluations tab section heading. */
  readonly evaluationsSectionTitle: string;
  /** Pluralized count of evaluation rows (reads through the reports lens). */
  readonly evaluationsCount: (count: number) => string;
  /** Empty-state title (no evaluations yet). */
  readonly evaluationsEmptyTitle: string;
  /** Empty-state body (where evaluations will appear). */
  readonly evaluationsEmptyBody: string;
  /** Column header for the session date. */
  readonly evaluationsColumnDate: string;
  /** Column header for the evaluation score. */
  readonly evaluationsColumnScore: string;
  /** Column header for the teacher notes (evaluation lens). */
  readonly evaluationsColumnNotes: string;

  // ─── Progress tab ───────────────────────────────────────────────────────
  /** Progress tab section heading. */
  readonly progressSectionTitle: string;
  /** Pluralized count of recorded progress rows. */
  readonly progressRowCount: (count: number) => string;
  /** Empty-state title (no recorded progress yet). */
  readonly progressEmptyTitle: string;
  /** Empty-state body (where progress will appear). */
  readonly progressEmptyBody: string;

  // ─── Loading / error scaffolding ────────────────────────────────────────
  /** Loading copy for `aria-busy` skeletons while a portal query is in flight. */
  readonly loadingLabel: string;
  /**
   * Inline-alert body when a portal query fails (the retry affordance
   * reuses `CommonLabels.retry` — no separate key).
   */
  readonly loadErrorBody: string;

  // ─── Extended portal actions (refresh + last-updated) ──────────────────
  /** Accessible label for the portal refresh button (re-fetches the active query). */
  readonly refreshLabel: string;
  /** Localized "Ayah(s)" prefix for a surah/ayah run (ProgressTab position block). */
  readonly ayahRangeLabel: string;
  /** Denied-state recovery action: navigate back to the children list. */
  readonly backToChildrenAction: string;
  /** Label for the last-updated timestamp (interpolates a formatted time). */
  readonly lastUpdatedLabel: (timestamp: string) => string;
  /** Quick-stats card label — total linked children. */
  readonly statTotalChildren: string;
  /** Quick-stats card label — recent sessions count. */
  readonly statRecentSessions: string;

  // ─── Print/Export feature ──────────────────────────────────────────────
  /** Label for the print/export button. */
  readonly printLabel: string;
  /** Title for the print/export dialog. */
  readonly printDialogTitle: string;
  /** Label for the print option (browser print dialog). */
  readonly printOption: string;
  /** Label for the CSV export option. */
  readonly exportCsvOption: string;
  /** Success message after CSV export. */
  readonly exportSuccess: string;

  // ─── Calendar view feature ─────────────────────────────────────────────
  /** Label for the calendar view toggle. */
  readonly calendarViewLabel: string;
  /** Label for the list view toggle. */
  readonly listViewLabel: string;
  /** Label for the current month. */
  readonly calendarMonthLabel: string;

  // ─── Print timestamp + CSV status column ──────────────────────────────
  /** Label for the print-timestamp footer (interpolates a formatted date). */
  readonly printTimestampLabel: (timestamp: string) => string;
  /** CSV column header for the session status column. */
  readonly csvStatusColumn: string;

  // ─── Attendance summary stats card ───────────────────────────────────
  /** Label for the total sessions count stat. */
  readonly statTotalSessions: string;
  /** Label for the completed sessions count stat. */
  readonly statCompletedSessions: string;
  /** Label for the completion rate stat (percentage). */
  readonly statCompletionRate: string;
  /** Label for the upcoming (scheduled) sessions count stat. */
  readonly statUpcomingSessions: string;
  /** Section heading for the summary stats card. */
  readonly summaryHeading: string;

  // ─── Homework summary stats card ──────────────────────────────────────
  /** Section heading for the homework summary card. */
  readonly homeworkSummaryHeading: string;
  /** Label for the latest Jadid surah/juz position stat. */
  readonly statLatestJadid: string;
  /** Label for the latest Madi surah/juz position stat. */
  readonly statLatestMadi: string;
  /** Label for the average grade stat. */
  readonly statAverageGrade: string;
  /** Label for the homework completion count stat. */
  readonly statHomeworkCount: string;

  // ─── Reports rating trend chart ───────────────────────────────────────
  /** Section heading for the rating trend chart. */
  readonly ratingTrendHeading: string;
  /** Label for the rating (y-axis) on the chart. */
  readonly ratingTrendAxisLabel: string;
  /** Label for the session (x-axis) on the chart. */
  readonly ratingTrendSessionLabel: string;
  /** Label shown when no rating data is available for the chart. */
  readonly ratingTrendEmpty: string;

  // ─── Progress tab summary card ────────────────────────────────────────
  /** Section heading for the progress summary card. */
  readonly progressSummaryHeading: string;
  /** Label for the progress row count stat. */
  readonly statProgressRows: string;
  /** Label for the curriculum coverage stat (surahs/juz covered). */
  readonly statCoverageAreas: string;
  /** Label for the active track stat (Jadid or Madi). */
  readonly statActiveTrack: string;
  /** Label for the last activity date stat. */
  readonly statEnrolledSince: string;

  // ─── Evaluations tab summary card ─────────────────────────────────────
  /** Section heading for the evaluations summary card. */
  readonly evaluationsSummaryHeading: string;
  /** Label for the total evaluations count stat. */
  readonly statTotalEvaluations: string;
  /** Label for the average score stat. */
  readonly statAverageScore: string;
  /** Label for the highest score stat. */
  readonly statHighestScore: string;
  /** Label for the rated sessions count stat. */
  readonly statRatedSessions: string;

  // ─── Search / filter feature ──────────────────────────────────────────
  /** Placeholder for the search input on reports/homework tabs. */
  readonly searchPlaceholder: string;
  /** Accessible label for the clear search button. */
  readonly searchClearLabel: string;
  /** Label shown when no rows match the search query. */
  readonly searchNoResults: string;
  /** Label for the rating filter dropdown. */
  readonly filterByRatingLabel: string;
  /** Label for the "all ratings" filter option. */
  readonly filterAllRatings: string;

  // ─── Sort functionality ──────────────────────────────────────────────
  /** Label for the sort dropdown. */
  readonly sortByLabel: string;
  /** Sort option: by date (newest first). */
  readonly sortDateDesc: string;
  /** Sort option: by date (oldest first). */
  readonly sortDateAsc: string;
  /** Sort option: by rating (highest first). */
  readonly sortRatingDesc: string;
  /** Sort option: by rating (lowest first). */
  readonly sortRatingAsc: string;

  // ─── Homework CSV export columns ──────────────────────────────────────
  /** CSV column header for the Jadid surah/juz. */
  readonly csvJadidColumn: string;
  /** CSV column header for the Madi surah/juz. */
  readonly csvMadiColumn: string;
  /** CSV column header for the grade. */
  readonly csvGradeColumn: string;
  /** Dialog title for the homework export. */
  readonly homeworkPrintDialogTitle: string;
}
