/**
 * Sessions namespace labels — the student/teacher session-list surfaces and
 * the session lifecycle controls (start / complete / cancel) with their
 * feedback notices.
 *
 * Used by:
 *  - Frontend session-list views for both roles
 *    (`useAppTranslation(Sessions)` with property access).
 *  - Server Components rendering the pages via
 *    `await getTranslations(locale)` → property access.
 *
 * Status-chip keys mirror EVERY `SessionStatus` value (including
 * `disputed`, rendered by the dispute surfaces and the admin arbitration
 * queue) so the chip vocabulary never forks.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `sessions-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface SessionsLabels {
  /** Student-side sessions page title. */
  readonly studentPageTitle: string;
  /** Teacher-side sessions page title. */
  readonly teacherPageTitle: string;
  /** Status-filter dropdown option that clears the status filter. */
  readonly statusFilterAll: string;
  /** List column label — lifecycle status chip. */
  readonly status: string;
  /** List column label — booked session intent (hifz / tajweed / evaluation). */
  readonly intent: string;
  /** List column label — platform fee (rendered verbatim + currency label). */
  readonly fee: string;
  /** List column label — confirmation deadline moment (locale date formatter). */
  readonly deadline: string;
  /** List column label — creation moment (locale date formatter). */
  readonly createdAt: string;
  /** List column label — teacher-confirmation moment (rendered only when set). */
  readonly teacherConfirmedAt: string;
  /** List column label — student-confirmation moment (rendered only when set). */
  readonly studentConfirmedAt: string;
  /** Empty-state heading on the student sessions page. */
  readonly studentEmptyTitle: string;
  /** Empty-state body on the student sessions page. */
  readonly studentEmptyBody: string;
  /** Empty-state heading on the teacher sessions page. */
  readonly teacherEmptyTitle: string;
  /** Empty-state body on the teacher sessions page. */
  readonly teacherEmptyBody: string;
  /** Filtered-empty heading — a status filter is active and matched nothing. */
  readonly filteredEmptyTitle: string;
  /** Filtered-empty body — steers the user to another status chip. */
  readonly filteredEmptyBody: string;
  /** Status chip — scheduled (awaiting start). */
  readonly statusScheduled: string;
  /** Status chip — started (in progress). */
  readonly statusStarted: string;
  /** Status chip — completed. */
  readonly statusCompleted: string;
  /** Status chip — cancelled. */
  readonly statusCancelled: string;
  /** Status chip — disputed (unreachable today; vocabulary-stability pin). */
  readonly statusDisputed: string;
  /** Teacher action — start a scheduled session. */
  readonly startSession: string;
  /** Teacher action — complete a started session. */
  readonly completeSession: string;
  /**
   * Student action — confirm a completed session (the second
   * dual-confirmation half; releases the held fee to the teacher's wallet).
   */
  readonly confirmCompletion: string;
  /**
   * Confirm-CTA tooltip — the financial consequence of the
   * student's confirmation (the held fee becomes the teacher's earning).
   */
  readonly confirmCompletionTooltip: string;
  /** Row hint — a completed session still awaiting the student's confirmation. */
  readonly awaitingStudentConfirmation: string;
  /** Action — cancel a scheduled session (opens the confirm dialog). */
  readonly cancelSession: string;
  /** Cancel-confirm dialog title. */
  readonly cancelConfirmTitle: string;
  /** Cancel-confirm dialog body — what cancelling does to the held fee. */
  readonly cancelConfirmBody: string;
  /** Optional cancel-reason field label. */
  readonly cancelReasonLabel: string;
  /** Optional cancel-reason field placeholder. */
  readonly cancelReasonPlaceholder: string;
  /** Action — open a dispute on a scheduled/started session (opens the dispute dialog). */
  readonly openDispute: string;
  /** Dispute-confirm dialog title. */
  readonly disputeConfirmTitle: string;
  /** Dispute-confirm dialog body — what opening a dispute triggers (admin arbitration). */
  readonly disputeConfirmBody: string;
  /** REQUIRED dispute-reason field label. */
  readonly disputeReasonLabel: string;
  /** REQUIRED dispute-reason field placeholder. */
  readonly disputeReasonPlaceholder: string;
  /** Inline field error — the dispute reason is required (UI-seam gate). */
  readonly disputeReasonRequired: string;
  /** Success notice — the dispute was opened and waits for admin arbitration. */
  readonly disputeOpenedNotice: string;
  /** Disabled cancel-CTA tooltip on disputed rows — the state machine forbids cancelling them. */
  readonly cancelDisabledDisputed: string;
  /** Meta label for a cancelled row's persisted cancellation reason. */
  readonly cancelReasonLine: string;
  /** Participant row line label — the reason a participant filed for the dispute. */
  readonly disputeReasonLine: string;
  /** Participant row line label — the arbitration note the admin recorded. */
  readonly arbitrationOutcomeLine: string;
  /** The formal arbitration outcome vocabulary — mirrors EVERY DisputeResolution value. */
  readonly outcomeCancel: string;
  readonly outcomeComplete: string;
  readonly outcomeRefund: string;
  readonly outcomePartialRefund: string;
  readonly outcomeUphold: string;
  /** The generic outcome label used when a resolved row predates the stored outcome. */
  readonly outcomeUnrecorded: string;
  /** Success notice — the session was started. */
  readonly sessionStartedNotice: string;
  /** Success notice — the session was completed. */
  readonly sessionCompletedNotice: string;
  /** Success notice — the student confirmed; the held fee reached the teacher's wallet. */
  readonly sessionConfirmedNotice: string;
  /** Success notice — the session was cancelled. */
  readonly sessionCancelledNotice: string;
  /** Success notice — the held fee was released back to the caller's balance. */
  readonly holdReleasedNotice: string;
  /**
   * Success-equivalent info notice for a duplicate booking replay — the
   * identical request was already accepted, so nothing new was created.
   * Informational tone, never an error treatment.
   */
  readonly duplicateBookingInfo: string;
  /** Generic error-state copy when a session surface fails without a mapped code. */
  readonly genericError: string;
  /** Admin disputes page title. */
  readonly adminDisputesPageTitle: string;
  /** Admin disputes count line — honest total of the arbitration queue. */
  readonly adminDisputesCountLine: (count: number) => string;
  /** Admin disputes empty-state heading (single pinned status — no filtered variant). */
  readonly adminDisputesEmptyTitle: string;
  /** Admin disputes empty-state body. */
  readonly adminDisputesEmptyBody: string;
  /** Row meta label — the dispute reason the participant filed. */
  readonly disputeReasonMeta: string;
  /** Row meta label — the moment the dispute was opened (locale date formatter). */
  readonly disputedAtLabel: string;
  /** Row meta label — the student/teacher participant ids. */
  readonly participantsLabel: string;
  /** Row action — open the arbitration dialog for one disputed session. */
  readonly resolveDispute: string;
  /** Arbitration dialog title. */
  readonly resolveDisputeTitle: string;
  /** Arbitration dialog body — exactly one terminal outcome must be chosen. */
  readonly resolveDisputeBody: string;
  /** Resolution radio — CANCEL outcome label. */
  readonly resolutionCancelLabel: string;
  /** Resolution radio — CANCEL outcome helper (refund to the paying lane). */
  readonly resolutionCancelHelper: string;
  /** Resolution radio — COMPLETE outcome label. */
  readonly resolutionCompleteLabel: string;
  /** Resolution radio — COMPLETE outcome helper (requires the session started). */
  readonly resolutionCompleteHelper: string;
  /** Optional arbitration-note field label. */
  readonly resolutionNoteLabel: string;
  /** Optional arbitration-note field placeholder. */
  readonly resolutionNotePlaceholder: string;
  /** Arbitration dialog submit button. */
  readonly resolveDisputeSubmit: string;
  /** Success notice — the dispute was resolved into a terminal state. */
  readonly disputeResolvedNotice: string;
  /** Admin row action — expand the clamped dispute reason to its full text. */
  readonly disputeReasonExpand: string;
  /** Admin row action — collapse the expanded dispute reason back to the clamp. */
  readonly disputeReasonCollapse: string;
  /** Admin pager — previous page (icon-button aria-label). */
  readonly pagerPreviousLabel: string;
  /** Admin pager — next page (icon-button aria-label). */
  readonly pagerNextLabel: string;
  /** Student action — rate the teacher on a dual-confirmed session (opens the rating dialog). */
  readonly rateTeacher: string;
  /** Rate-CTA tooltip — the rating is one-shot: a session can be rated only once. */
  readonly rateTeacherTooltip: string;
  /** Teacher-rating dialog title. */
  readonly rateTeacherDialogTitle: string;
  /** Teacher-rating dialog submit button. */
  readonly rateTeacherDialogSubmit: string;
  /** Teacher-rating dialog cancel button. */
  readonly rateTeacherDialogCancel: string;
  /** Success notice — the teacher rating was submitted. */
  readonly rateTeacherSuccess: string;
  /** Read-only chip shown on a session row the student has already rated. */
  readonly teacherRatedChip: string;
  /**
   * Accessible label for the rating control's empty-value radio (MUI
   * `Rating`'s `emptyLabelText` — the built-in "Empty" default, localized so
   * the control carries no untranslated MUI-owned copy).
   */
  readonly ratingEmptyLabelText: string;
  /**
   * Per-star accessible label for the rating control — interpolates ONLY the
   * star position through the single argument `position` (typed template
   * function, not an ICU string; identical signature in both locales).
   */
  readonly ratingStarAriaLabel: (position: number) => string;
  /** Escrow-class chip — the fee hold still sits in its original balance lane. */
  readonly escrowHeldChip: string;
  /** Escrow-class chip — the fee was consumed at dual confirmation (post-confirmation dispute). */
  readonly escrowConsumedChip: string;
  /** Resolution radio — REFUND outcome label (consumed-escrow rows only). */
  readonly resolutionRefundLabel: string;
  /** Resolution radio — REFUND outcome helper (the fee returns to the student; the teacher's wallet is debited). */
  readonly resolutionRefundHelper: string;
  /** Resolution radio — PARTIAL_REFUND outcome label (consumed-escrow rows only). */
  readonly resolutionPartialRefundLabel: string;
  /** Resolution radio — PARTIAL_REFUND outcome helper (a chosen slice of the fee returns to the student). */
  readonly resolutionPartialRefundHelper: string;
  /** Resolution radio — UPHOLD outcome label (consumed-escrow rows only). */
  readonly resolutionUpholdLabel: string;
  /** Resolution radio — UPHOLD outcome helper (the completed session stands; no money moves). */
  readonly resolutionUpholdHelper: string;
  /** Partial-refund amount field label — rendered only for the PARTIAL_REFUND outcome. */
  readonly partialAmountLabel: string;
  /** Partial-refund amount field placeholder. */
  readonly partialAmountPlaceholder: string;
  /** Partial-refund fee reference — the verbatim fee the amount is bounded by; `{fee}` and `{currency}` interpolate. */
  readonly partialAmountFeeReference: string;
  /** Admin row action — open the case-review dialog for one disputed session. */
  readonly reviewCase: string;
  /** Case-review dialog title. */
  readonly caseReviewTitle: string;
  /** Case-review section heading — the teacher's session report. */
  readonly caseReviewReportTitle: string;
  /** Case-review section heading — the session homework. */
  readonly caseReviewHomeworkTitle: string;
  /** Case-review section heading — the session recitation record. */
  readonly caseReviewRecitationTitle: string;
  /** Case-review section heading — the session-scoped audit trail. */
  readonly caseReviewAuditTitle: string;
  /** Case-review report meta label — the rating the student received from the teacher. */
  readonly caseReviewRatingLabel: string;
  /** Case-review homework meta label — the homework assigned for the current lesson. */
  readonly caseReviewHomeworkCurrentLabel: string;
  /** Case-review homework meta label — the revision homework. */
  readonly caseReviewHomeworkRevisionLabel: string;
  /** Case-review empty state — no report has been submitted for the session. */
  readonly caseReviewEmptyReport: string;
  /** Case-review empty state — no homework was recorded for the session. */
  readonly caseReviewEmptyHomework: string;
  /** Case-review empty state — no recitation record exists for the session. */
  readonly caseReviewEmptyRecitation: string;
  /** Case-review empty state — the session-scoped audit trail is empty. */
  readonly caseReviewEmptyAudit: string;
  /** Teacher row action — open the dispute case dialog for one of the teacher's own sessions. */
  readonly teacherCaseCta: string;
  /** Teacher case dialog title. */
  readonly teacherCaseTitle: string;
  /** Teacher case dialog meta label — the student on the other side of the case. */
  readonly teacherCaseStudentLabel: string;
  /** Teacher case dialog section heading — the arbitration decision block. */
  readonly teacherCaseResolutionTitle: string;
  /** Teacher case dialog pending state — the dispute is open and not yet arbitrated. */
  readonly teacherCasePendingLine: string;
  /** Teacher case dialog section heading — the teacher's own session report. */
  readonly teacherCaseReportTitle: string;
  /** Teacher case dialog meta label — the teacher's own rating of the student. */
  readonly teacherCaseRatingLabel: string;
  /** Teacher case dialog meta label — the moment the arbitration decision was issued. */
  readonly teacherCaseResolvedAtLabel: string;

  /** The student case dialog's counterparty label (the session's teacher). */
  readonly studentCaseTeacherLabel: string;
  /** The student case dialog's report-section title (the teacher-authored report). */
  readonly studentCaseReportTitle: string;
  /** The student case dialog's rating label (the teacher's rating of the student). */
  readonly studentCaseRatingLabel: string;
  /** Analytics card title — the aggregate dispute snapshot on the admin queue. */
  readonly adminDisputeAnalyticsTitle: string;
  /** Analytics stat label — the currently open (queued) dispute count. */
  readonly adminDisputeAnalyticsOpen: string;
  /** Analytics stat label — the all-time resolved dispute count. */
  readonly adminDisputeAnalyticsResolved: string;
  /** Analytics section label — the per-outcome breakdown chips row. */
  readonly adminDisputeAnalyticsOutcomes: string;

  // ─── Session Report Submission (Jadid & Madi) ───────────────────────────────
  // Teacher CTA labels (pinned names — consumed by Task 4's arms matrix).
  /** Teacher row action — submit the report for a completed session. */
  readonly sessionReportAction: string;
  /** Teacher row action — view the homework of a started session. */
  readonly viewHomeworkAction: string;

  // Dialog mode titles.
  /** Dialog title — preparing the report (reading prior homework). */
  readonly reportDialogPrepareTitle: string;
  /** Dialog title — submitting the report (form state). */
  readonly reportDialogSubmitTitle: string;
  /** Dialog title — reviewing a submitted report (read-only). */
  readonly reportDialogReviewTitle: string;

  // Notes field.
  /** Label — teacher notes (required, ≤2000 chars). */
  readonly reportNotesLabel: string;
  /** Placeholder for the notes field. */
  readonly reportNotesPlaceholder: string;
  /** Inline field error — notes are required. */
  readonly reportNotesRequiredMessage: string;
  /** Inline field error — notes exceed 2000 chars. */
  readonly reportNotesTooLongMessage: string;

  // Rating field.
  /** Label — student rating by teacher (0–5). */
  readonly reportRatingLabel: string;
  /** Inline field error — rating is required. */
  readonly reportRatingRequiredMessage: string;

  // Submit / cancel CTAs and notices.
  /** Submit button label. */
  readonly reportSubmitLabel: string;
  /** Cancel button label. */
  readonly reportCancelLabel: string;
  /** Success notice — the report was submitted. */
  readonly reportSubmitSuccessNotice: string;
  /** Info notice — a report was already submitted (replay safe). */
  readonly reportAlreadySubmittedNotice: string;

  // Validation messages (mirrors server vocabulary).
  /** Inline field error — at least one homework block (Jadid OR Madi) is required. */
  readonly reportBlocksRequiredMessage: string;
  /** Inline field error — `fromAyah` must be ≤ `toAyah`. */
  readonly reportAyahRangeMessage: string;
  /** Inline field error — grades must be in 0–100. */
  readonly reportGradeRangeMessage: string;
  /** Inline field error — `surahJuz` is required for a non-empty block. */
  readonly reportSurahJuzRequiredMessage: string;

  // Assignment blocks.
  /** Section heading — the new memorization (Jadid) block. */
  readonly jadidSectionTitle: string;
  /** Section heading — the revision (Madi) block. */
  readonly madiSectionTitle: string;
  /** Field label — start ayah of a block. */
  readonly fromAyahLabel: string;
  /** Field label — end ayah of a block. */
  readonly toAyahLabel: string;
  /** Field label — the Surah/Juz picker. */
  readonly surahJuzPickerLabel: string;

  // Grade-previous section (renders when prior homework exists).
  /** Section heading — the previous-homework grading block. */
  readonly gradePreviousSectionTitle: string;
  /** First-session hint — no prior homework to evaluate. */
  readonly reportFirstSessionHint: string;
  /** Read-only chip — the previous homework was already graded. */
  readonly reportAlreadyGradedLabel: string;
  /** Field label — the Jadid track's grade input. */
  readonly reportGradeJadidLabel: string;
  /** Field label — the Madi track's grade input. */
  readonly reportGradeMadiLabel: string;
  /**
   * Read-only grade chip — the complete accessible name, composed by the
   * locale (separator and ordering are copy decisions, never hardcoded).
   */
  readonly reportGradeAriaLabel: (gradeLabel: string, grade: number) => string;
  /** Empty-state label — a track block is absent on the prior homework. */
  readonly reportTrackEmptyLabel: string;

  // History list (compact rows).
  /** Section heading — the student's homework history list. */
  readonly reportHistorySectionTitle: string;
  /** Empty-state body — no prior homework exists for this student. */
  readonly reportHistoryEmptyMessage: string;
  /** Row meta label — the session's date. */
  readonly reportSessionDateLabel: string;

  // Review state (reuses the case-review display posture).
  /** Meta label — the reviewed notes display. */
  readonly reportReviewedNotesLabel: string;
  /** Meta label — the reviewed rating display. */
  readonly reportReviewedRatingLabel: string;

  /**
   * Resolves a `SurahJuzRef` enum member value to its localized display
   * label. Returns the raw ref on an unknown key (fail-closed — never
   * throws, never renders an empty string). Same signature in both locales;
   * exhaustive over the 35-member vocabulary (5 surahs + 30 juz).
   */
  readonly surahJuzLabel: (ref: string) => string;

  // ─── Rubric Evaluation Submission (evaluator dialog) ────────────────────────
  /** Teacher row action — submit the rubric evaluation for one of the teacher's completed evaluation sessions. */
  readonly submitEvaluationAction: string;
  /** Row pill shown on the teacher surface while the session still owes a rubric submission. */
  readonly awaitingEvaluation: string;
  /** Rubric dialog title. */
  readonly rubricDialogTitle: string;
  /** Rubric score field label — integer 0..100; the per-evaluation verdict is derived server-side, never supplied. */
  readonly rubricScoreLabel: string;
  /** Live band chip shown on the score field while the entered score sits at or above the pass threshold. */
  readonly rubricScoreBandPassing: string;
  /** Live band chip shown on the score field while the entered score sits below the pass threshold. */
  readonly rubricScoreBandFailing: string;
  /** Rubric qualitative-observations field label. */
  readonly rubricNotesLabel: string;
  /** Weakness-area select label (rendered only while the entered score is below the pass threshold). */
  readonly rubricWeaknessLabel: string;
  /** Weakness-area select option — the tajweed failure area. */
  readonly rubricWeaknessTajweed: string;
  /** Weakness-area select option — the hifz failure area. */
  readonly rubricWeaknessHifz: string;
  /** Weakness-area helper line — why the select appears and what the recorded area drives. */
  readonly rubricWeaknessHelper: string;
  /** Rubric dialog submit button (fires the submission mutation). */
  readonly rubricSubmitCta: string;
  /** Success notice — the rubric evaluation was submitted. */
  readonly rubricSubmittedSuccess: string;
  /** Impact callout shown while the entered score sits at or above the pass threshold. */
  readonly rubricImpactPass: string;
  /** Impact callout shown while the entered score sits below the pass threshold. */
  readonly rubricImpactFail: string;

  /** Restored-draft notice — the dialog re-seeded its controls from a parked draft. */
  readonly rubricDraftRestoredNotice: string;
  /** Restored-draft discard CTA — clears the parked draft and resets the dialog. */
  readonly rubricDraftDiscardCta: string;
  /** Saved-at provenance label — prefixes the relative "saved ago" caption inside the restored notice. */
  readonly rubricDraftSavedAtLabel: string;
  /** Parked-draft row chip — marks a pending row that carries a restorable parked draft. */
  readonly rubricDraftParkedChip: string;

  /**
   * Hygiene diagnostics — the parked-draft prune sweep removed `count` stale
   * drafts (the `adminDisputesCountLine` template-function precedent; each
   * locale owns its plural rules).
   */
  readonly rubricDraftsPrunedLine: (count: number) => string;

  // ─── Pending-rubric banner (teacher sessions surface) ───────────────────────
  /**
   * Banner headline — the honest pending count (the `adminDisputesCountLine`
   * template-function precedent; each locale owns its plural rules).
   */
  readonly pendingRubricCountLine: (count: number) => string;
  /** Banner toggle hint while the pending-only filter is OFF. */
  readonly pendingRubricFilterCta: string;
  /** Banner toggle hint while the pending-only filter is ON. */
  readonly pendingRubricFilterActiveCta: string;
}
