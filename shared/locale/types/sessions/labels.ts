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
  /** List column label — student-confirmation moment (DEV3-012; rendered only when set). */
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
   * Student action (DEV3-012) — confirm a completed session (the second
   * dual-confirmation half; releases the held fee to the teacher's wallet).
   */
  readonly confirmCompletion: string;
  /**
   * Confirm-CTA tooltip (DEV3-012) — the financial consequence of the
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
  /** Success notice — the session was started. */
  readonly sessionStartedNotice: string;
  /** Success notice — the session was completed. */
  readonly sessionCompletedNotice: string;
  /** Success notice (DEV3-012) — the student confirmed; the held fee reached the teacher's wallet. */
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
}
