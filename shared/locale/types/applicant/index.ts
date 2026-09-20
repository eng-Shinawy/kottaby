/**
 * Applicant namespace labels — teacher-applicant lifecycle status card and
 * verification-attempt surfaces.
 *
 * Used by:
 *  - Frontend `ApplicantStatusCard` (`useAppTranslation(Applicant)`) for the
 *    teacher-dashboard status-card branches (visual state matrix:
 *    pending / in-evaluation / failed+active-cooldown / failed+eligible /
 *    certified-passed).
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `applicant-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface ApplicantLabels {
  /** Status chip — application awaiting purchase of the verification plan (pending). */
  readonly statusPending: string;
  /** Status chip — under evaluation. */
  readonly statusInEvaluation: string;
  /** Status chip — evaluation failed; cooldown affordances below carry the next step. */
  readonly statusFailed: string;
  /** Status chip — verification passed (paired with `certifiedSummary`). */
  readonly statusPassed: string;
  /** Dashboard status-card heading. */
  readonly statusCardTitle: string;
  /** Pending-branch prompt — awaiting purchase of a verification session (the purchase flow itself lives outside this namespace). */
  readonly pendingPrompt: string;
  /** Attempts-count row label on the status card. */
  readonly attemptCountLabel: string;
  /**
   * Failed+active-cooldown line rendering the re-application expiry moment.
   * ICU placeholder `{cooldownUntil}` is expanded by the consumer into a
   * locale-formatted timestamp; the placeholder NAME is pinned
   * identical across both locales by the parity test.
   */
  readonly cooldownExpiryLine: string;
  /** Failed+expired-cooldown affordance copy shown beside the enabled re-apply CTA. */
  readonly eligibleToReapply: string;
  /** Enabled re-apply call-to-action button label. */
  readonly reapplyCta: string;
  /** Certified summary copy for the passed branch — never pending/evaluation copy (cross-branch copy must not leak). */
  readonly certifiedSummary: string;
  /**
   * Informational teaching-surfaces hint rendered ONLY by the single-null
   * certified branch (the "shortcut to main teaching surfaces" state).
   * Pure copy — mentions no route; navigation itself stays in
   * the existing dashboard sidebar.
   */
  readonly certifiedSurfacesHint: string;
  /** In-evaluation progress hint rendered beneath the attempts counter. */
  readonly inEvaluationHint: string;
  /** Notification title emitted to the newly certified teacher when an admin completes the certification directly. */
  readonly coldStartCertifiedTitle: string;
  /** Notification body emitted alongside `coldStartCertifiedTitle` — pure copy, no identifiers. */
  readonly coldStartCertifiedBody: string;
  /** Pending-branch purchase call-to-action button label (opens the purchase confirmation dialog). */
  readonly purchaseCta: string;
  /** Purchase confirmation-dialog title. */
  readonly purchaseDialogTitle: string;
  /**
   * One-line plan descriptor rendered inside the purchase confirmation
   * dialog. ICU placeholders expand in the FIXED order
   * `(title, price, currency, sessions, days)` from the title-matched
   * planCatalog row; the parity test pins the ORDER in both locales.
   */
  readonly purchasePlanLine: string;
  /** Purchase confirmation-dialog confirm button label. */
  readonly purchaseConfirmCta: string;
  /** Purchase confirmation-dialog cancel button label (also the close icon's accessible label). */
  readonly purchaseCancelCta: string;
  /** Success notice raised after the purchase mutation settles successfully. */
  readonly purchaseSuccess: string;
  /**
   * Generic failure notice for every unmapped purchase rejection code —
   * also the missing-plan error posture inside the dialog. Raw server
   * messages are never echoed through it.
   */
  readonly purchaseGenericError: string;
  /**
   * In-evaluation loop progress line rendering the CURRENT cycle counts.
   * The four numeric values expand in the FIXED order
   * `(booked, completed, remaining, total)`; the parity test pins the
   * template ORDER identical across both locales.
   */
  readonly evaluationProgressLine: (booked: number, completed: number, remaining: number, total: number) => string;
  /** Evaluation-zone call-to-action button label (opens the booking dialog). */
  readonly bookEvaluationCta: string;
  /** Booking-dialog empty state — every certified evaluator is already used in this cycle. */
  readonly availableEvaluatorsEmpty: string;
  /** Success notice raised after the booking mutation settles successfully. */
  readonly evaluationBookingSuccess: string;
  /** Booking-dialog cancel button label. */
  readonly evaluationBookingCancelCta: string;
  /** Booking-dialog confirm button label (fires the mutation). */
  readonly evaluationBookingConfirmCta: string;
  /** Booking-dialog title. */
  readonly evaluationBookingDialogTitle: string;
  /** Evaluation-zone heading on the teacher dashboard. */
  readonly evaluationZoneTitle: string;
}
