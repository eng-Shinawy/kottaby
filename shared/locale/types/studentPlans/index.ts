/**
 * `studentPlans` namespace labels — the consumer (student / parent)
 * subscription-plans storefront.
 *
 * Used by:
 *  - `/plans` storefront page header (title + subtitle).
 *  - Plan cards (price / sessions / interval specs + subscribe CTA).
 *  - Purchase-notice dialog (honest "coming soon" posture until DEV1-006
 *    lands the real purchase flow).
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
  /** Card primary action: open the subscribe notice. */
  readonly subscribeCta: string;

  // ── Purchase-notice dialog ───────────────────────────────────────────────
  /** Notice dialog title (online purchase not available yet). */
  readonly purchaseDialogTitle: string;
  /**
   * Notice dialog body — interpolates ONLY the plan title (single sentinel,
   * verified by the parity suite).
   */
  readonly purchaseDialogBody: (planTitle: string) => string;
  /** Notice dialog dismiss button. */
  readonly purchaseDialogClose: string;
}
