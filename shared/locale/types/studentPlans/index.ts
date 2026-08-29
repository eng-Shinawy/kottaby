/**
 * `studentPlans` namespace labels — the consumer (student / parent /
 * teacher) subscription-plans storefront.
 *
 * Used by:
 *  - `/plans` storefront page header (title + subtitle).
 *  - Plan cards (price / sessions / interval specs + subscribe CTA).
 *  - Purchase-request dialog (DEV1-006 Phase A: submits a PENDING
 *    subscription request; the academy administration confirms the
 *    offline payment to activate it — decision B.9 posture).
 *  - Request feedback (success / failure toasts) and the pending-request
 *    card state (disabled CTA + chip).
 *  - Empty + error states (with retry).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/student-plans-namespace.parity.test.ts`) pins the
 * plan-title interpolation shape identical across both locales.
 *
 * NOTE: this namespace deliberately does NOT reuse the admin `plans`
 * namespace — the consumer surface carries different copy (browse +
 * subscribe intent, no lifecycle/admin vocabulary), and admin copy churn
 * must never leak into the student-facing store.
 */
export interface StudentPlansLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Storefront page title. */
  readonly pageTitle: string;
  /** Storefront page subtitle under the title. */
  readonly pageSubtitle: string;

  // ── Async states ─────────────────────────────────────────────────────────
  /** Loading-state copy. */
  readonly loading: string;
  /** Empty-catalog state title. */
  readonly emptyStateTitle: string;
  /** Empty-catalog state body. */
  readonly emptyStateBody: string;
  /** Load-failure state title. */
  readonly errorStateTitle: string;
  /** Load-failure state body. */
  readonly errorStateBody: string;
  /** Retry action on the error state. */
  readonly errorStateRetry: string;

  // ── Plan card ────────────────────────────────────────────────────────────
  /** Card spec label: session count. */
  readonly labelSessions: string;
  /** Card spec label: renewal interval. */
  readonly labelInterval: string;
  /**
   * Interval spec value — interpolates ONLY the day count (single sentinel,
   * verified by the parity suite).
   */
  readonly intervalDays: (days: number) => string;
  /** Card primary action: open the subscribe request dialog. */
  readonly subscribeCta: string;
  /**
   * Chip + CTA label for a plan the current user ALREADY holds an ACTIVE
   * subscription to — informational (the service allows an early
   * re-request), so the CTA relabels to the renew intent instead of
   * blocking.
   */
  readonly activeChip: string;
  /**
   * Card CTA label when the user's latest subscription for the plan is in a
   * TERMINAL state (expired / cancelled / suspended) — same request flow,
   * renewal intent.
   */
  readonly renewCta: string;
  /**
   * Disabled card CTA + chip label for a plan with an unresolved PENDING
   * request from the current user.
   */
  readonly purchasePendingCta: string;

  // ── Purchase-request dialog ─────────────────────────────────────────────
  /** Request dialog title. */
  readonly purchaseDialogTitle: string;
  /**
   * Request dialog body — interpolates ONLY the plan title (single
   * sentinel, verified by the parity suite). Carries the offline-payment
   * posture: the academy administration confirms the payment to activate.
   */
  readonly purchaseDialogBody: (planTitle: string) => string;
  /** Request dialog submit button (fires the mutation). */
  readonly purchaseRequestCta: string;
  /** Request dialog dismiss button. */
  readonly purchaseDialogClose: string;

  // ── Request feedback ─────────────────────────────────────────────────────
  /** Success toast after the request is accepted (status pending). */
  readonly purchaseRequestSuccessToast: string;
  /** Failure toast when the mutation errors (generic, retryable copy). */
  readonly purchaseRequestFailedToast: string;
}
