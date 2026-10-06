/**
 * TeacherDirectory namespace labels — the canonical student-facing copy for
 * the on-demand teacher directory browse (route + filter bar + teacher
 * cards + request-session dialog + pagination + empty state).
 *
 * Consumers:
 *  - The student teacher-directory browse UI (`/student/teachers`) renders
 *    every key here through its own translation hook; the recitation
 *    display NAMES on the cards resolve through the separate `recitation`
 *    namespace (the canonical per-reading label set).
 *  - The namespace is live the moment it is wired into the bundle slices —
 *    no UI consumer is required for it to resolve.
 *
 * The service layer itself is copy-free: it returns the honest page
 * envelope (items + totals); presentation copy lives exclusively here.
 * Admin-side teacher-directory copy (`adminTeachers`) is a separate,
 * admin-gated surface and is NOT reused or altered by this namespace.
 *
 * Copy discipline (mirrors the seeded empty-state line):
 *  - Every leaf is a STATIC string with ZERO ICU placeholders — counts,
 *    ranges, and page numbers are DATA composed alongside the copy by the
 *    components (e.g. `${showingPrefix} 1–25 ${of} 43`), never interpolated
 *    into a leaf.
 *  - All keys MUST have both `en` and `ar` implementations with EXACT
 *    key-set parity (compile-typed on both leaves +
 *    `teacherDirectory-namespace.parity.test.ts` runtime belt). Property
 *    access only — never call-by-key.
 */
export interface TeacherDirectoryLabels {
  /** Empty-state line rendered when a browse returns zero eligible teachers. */
  readonly noTeachersAvailable: string;
  /** Page heading of the student browse surface. */
  readonly browseTitle: string;
  /** Page subtitle under the heading — what the browse does. */
  readonly browseSubtitle: string;
  /** Filter-bar label above the Qira'ah recitation select. */
  readonly recitationLabel: string;
  /** Filter-bar label above the subject (intent) select. */
  readonly intentLabel: string;
  /** Browse-intent choice: memorization. */
  readonly intentHifz: string;
  /** Browse-intent choice: tajweed + tilawa. */
  readonly intentTajweed: string;
  /** Filter-bar apply action (submits the narrowed browse). */
  readonly applyFilters: string;
  /** Filter-bar reset action (restores the unfiltered first page). */
  readonly resetFilters: string;
  /** Results-region heading above the teacher cards. */
  readonly resultsTitle: string;
  /** Leading word of the range caption composed as `${showingPrefix} ${from}–${to} ${of} ${total}`. */
  readonly showingPrefix: string;
  /** "of" word in the same range caption. */
  readonly of: string;
  /** Online badge on a teacher card (the compose-rule eligible flag). */
  readonly onlineNow: string;
  /** Rating fallback on a teacher card with no recorded average (honest null — never a fabricated zero). */
  readonly unrated: string;
  /** Card caption above the Qira'ah certification chips. */
  readonly cardRecitations: string;
  /** Card caption above the fluency chips. */
  readonly cardLanguages: string;
  /** Empty-state hint under `noTeachersAvailable` — the browse narrows by choice, so a different one may match. */
  readonly emptyStateHint: string;
  /** Accessible name of the pagination navigation region. */
  readonly paginationLabel: string;
  /** Accessible label of the previous-page arrow. */
  readonly previousPage: string;
  /** Accessible label of the next-page arrow. */
  readonly nextPage: string;
  /** "Page" word composed with the page number as data in the per-item accessible labels. */
  readonly pageWord: string;
  /** Card CTA that opens the request-session dialog for that teacher. */
  readonly requestSessionCta: string;
  /** Title of the request-session confirmation dialog. */
  readonly requestDialogTitle: string;
  /** Label above the intent select inside the request dialog. */
  readonly requestDialogIntentLabel: string;
  /** Dialog note stating the server validates the caller's balance/trial lane before holding the fee. */
  readonly requestDialogNote: string;
  /**
   * Credits-strip label above the four prepaid lane chips inside the
   * request-session dialog (the caller's own `mySessionBalance` read).
   */
  readonly requestDialogCreditsLabel: string;
  /** Credits-strip lane chip: the free trial lane (the debit ladder's first lane). */
  readonly creditLaneTrial: string;
  /** Credits-strip lane chip: the hifz (memorization) prepaid lane. */
  readonly creditLaneHifz: string;
  /** Credits-strip lane chip: the tajweed prepaid lane. */
  readonly creditLaneTajweed: string;
  /** Credits-strip lane chip: the reviews (tilawa) prepaid lane. */
  readonly creditLaneReviews: string;
  /**
   * Honest MAY-decline caption rendered when the selected intent's
   * effective prepaid credits (trial + intent lane) are zero: the booking
   * MAY be declined for insufficient credits — the server remains
   * authoritative (subscription coverage is not probed by the strip).
   */
  readonly requestDialogInsufficientCreditsNote: string;
  /** Dialog cancel action. */
  readonly requestCancel: string;
  /** Dialog confirm action (submits the `createSession` mutation). */
  readonly requestConfirm: string;
  /** Success notice after the booking lands (the student is routed to their sessions page). */
  readonly requestSuccessNotice: string;
  /** Info notice for the idempotent `DUPLICATE_REQUEST` replay — the request already landed server-side. */
  readonly requestDuplicateNotice: string;
  /** Generic retryable failure notice (dialog stays open; a retry replays the same idempotency key). */
  readonly requestGenericFailure: string;
  /** Accessible name of the applied-filter chip (the current filter summary). */
  readonly appliedFiltersLabel: string;
  /** Known fluency-profile token `arabic` → localized label (unknown tokens fall back to the raw token). */
  readonly languageArabic: string;
  /** Known fluency-profile token `english` → localized label (unknown tokens fall back to the raw token). */
  readonly languageEnglish: string;
  /** Known fluency-profile token `french` → localized label (unknown tokens fall back to the raw token). */
  readonly languageFrench: string;
  /** Filter-bar label above the display-name search field. */
  readonly searchLabel: string;
  /** Placeholder inside the name-search field. */
  readonly searchPlaceholder: string;
  /** Filter-bar label above the minimum-rating select. */
  readonly minRatingLabel: string;
  /** Minimum-rating choice: no rating floor (unrated included). */
  readonly ratingAny: string;
  /** Minimum-rating choice: 3.0 and above. */
  readonly ratingThreePlus: string;
  /** Minimum-rating choice: 4.0 and above. */
  readonly ratingFourPlus: string;
  /** Minimum-rating choice: 4.5 and above. */
  readonly ratingFourFivePlus: string;
  /** Filter-bar label above the ordering (sort) select. */
  readonly sortLabel: string;
  /** Sort choice: top rated first (the default post-tier ordering). */
  readonly sortTopRated: string;
  /** Sort choice: display name A→Z. */
  readonly sortNameAZ: string;
  /** Sort choice: newest listed teachers first. */
  readonly sortNewest: string;
  /** Applied-filter prefix composed before the quoted name-search chip. */
  readonly appliedSearchPrefix: string;
  /** Applied-filter prefix composed before the minimum-rating chip. */
  readonly appliedRatingPrefix: string;
  /** Applied-filter prefix composed before the ordering chip (shown only for a non-default sort). */
  readonly appliedSortPrefix: string;
}
