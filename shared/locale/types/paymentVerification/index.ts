/**
 * `paymentVerification` namespace labels — the ADMIN payment-verification
 * queue (DEV1-006 Phase B).
 *
 * Used by:
 *  - `/admin/verifications` page header (title + subtitle).
 *  - Pending-request cards (purchaser summary, plan specs, requested date,
 *    verify CTA).
 *  - Verify-payment dialog (payment-method choice, receipt reference input,
 *    confirm/cancel actions).
 *  - Verification feedback (success / failure toasts).
 *  - Empty + error states (with retry).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/payment-verification-namespace.parity.test.ts`) pins the
 * key sets and the plan-title interpolation shape identical across locales.
 *
 * NOTE: this namespace deliberately does NOT reuse the admin `plans`
 * namespace — verification copy is a different workflow (people + money +
 * confirmation posture, not catalog CRUD vocabulary), and catalog copy churn
 * must never leak into the verification surface.
 */
export interface PaymentVerificationLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Verification-queue page title. */
  readonly pageTitle: string;
  /** Verification-queue page subtitle under the title. */
  readonly pageSubtitle: string;

  // ── Async states ─────────────────────────────────────────────────────────
  /** Loading-state copy. */
  readonly loading: string;
  /** Empty-queue state title. */
  readonly emptyStateTitle: string;
  /** Empty-queue state body. */
  readonly emptyStateBody: string;
  /** Load-failure state title. */
  readonly errorStateTitle: string;
  /** Load-failure state body. */
  readonly errorStateBody: string;
  /** Retry action on the error state. */
  readonly errorStateRetry: string;

  // ── Request card ─────────────────────────────────────────────────────────
  /** Card row label: who submitted the request (name + email follow). */
  readonly labelRequestedBy: string;
  /** Card row label: the requested plan's title. */
  readonly labelPlan: string;
  /** Card spec label: session count. */
  readonly labelSessions: string;
  /** Card spec label: price. */
  readonly labelPrice: string;
  /** Card row label: when the request was submitted (timestamp follows). */
  readonly labelRequestedAt: string;
  /** Card primary action: open the verify-payment dialog. */
  readonly verifyCta: string;

  // ── Verify-payment dialog ────────────────────────────────────────────────
  /** Verify dialog title. */
  readonly verifyDialogTitle: string;
  /**
   * Verify dialog body — interpolates ONLY the plan title (single sentinel,
   * verified by the parity suite). The purchaser summary renders as labeled
   * rows, not interpolated prose.
   */
  readonly verifyDialogBody: (planTitle: string) => string;
  /** Dialog field label: the offline payment method choice. */
  readonly labelPaymentMethod: string;
  /** Payment-method option: cash recorded offline. */
  readonly methodOfflineCash: string;
  /** Payment-method option: bank transfer recorded offline. */
  readonly methodBankTransfer: string;
  /** Dialog field label: the payment reference (receipt number). */
  readonly labelPaymentReference: string;
  /** Dialog field placeholder for the payment reference input. */
  readonly paymentReferencePlaceholder: string;
  /** Dialog confirm button (fires the mutation). */
  readonly verifyDialogConfirm: string;
  /** Dialog dismiss button. */
  readonly verifyDialogCancel: string;

  // ── Verification feedback ────────────────────────────────────────────────
  /** Success toast after the verification activates the subscription. */
  readonly verifySuccessToast: string;
  /** Failure toast when the mutation errors (generic, retryable copy). */
  readonly verifyFailedToast: string;
}
