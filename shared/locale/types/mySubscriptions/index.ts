/**
 * `mySubscriptions` namespace labels — the student-facing "My Subscriptions"
 * surface (`/subscriptions`, DEV1-010).
 *
 * Used by:
 *  - `/subscriptions` page header (title + subtitle).
 *  - The overview strip (active / pending / all counts).
 *  - Subscription lifecycle cards (status chips, price / sessions /
 *    renewal / period / payment / requested-at specs).
 *  - The renewal flow: terminal rows (`expired` | `cancelled` |
 *    `suspended`) on an active plan surface a Renew CTA that opens the
 *    confirm dialog and submits `requestPlanSubscription` again (the
 *    service deliberately only fences an UNRESOLVED PENDING request —
 *    terminal histories never block a re-request).
 *  - Pending-blocked and plan-inactive inline notes (the renew CTA's
 *    mirrored postures).
 *  - Empty + error states (with retry + a browse-plans jump).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/my-subscriptions-namespace.parity.test.ts`) pins the
 * interpolation shapes identical across both locales.
 *
 * NOTE: this namespace deliberately does NOT reuse the admin
 * `subscriptionManagement` namespace — the student surface carries
 * first-person copy and a renew flow the admin manager never renders, and
 * admin copy churn must never leak into the student-facing surface. It
 * also does not reuse `studentPlans` — the storefront is browse intent;
 * this surface is lifecycle-tracking intent (chips, periods, payments).
 */
export interface MySubscriptionsLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Page title. */
  readonly pageTitle: string;
  /** Page subtitle under the title. */
  readonly pageSubtitle: string;

  // ── Async states ─────────────────────────────────────────────────────────
  /** Loading-state copy. */
  readonly loading: string;
  /** Empty-history state title. */
  readonly emptyStateTitle: string;
  /** Empty-history state body. */
  readonly emptyStateBody: string;
  /** Empty-history action: jump to the `/plans` storefront. */
  readonly browsePlansCta: string;
  /** Load-failure state title. */
  readonly errorStateTitle: string;
  /** Load-failure state body. */
  readonly errorStateBody: string;
  /** Retry action on the error state. */
  readonly errorStateRetry: string;

  // ── Overview strip ───────────────────────────────────────────────────────
  /** Overview strip heading. */
  readonly summaryTitle: string;
  /** Overview tile caption: active subscriptions count. */
  readonly summaryActiveLabel: string;
  /** Overview tile caption: pending requests count. */
  readonly summaryPendingLabel: string;
  /** Overview tile caption: total subscriptions (any status). */
  readonly summaryAllLabel: string;

  // ── Status chips ─────────────────────────────────────────────────────────
  /** `pending` machine code display name. */
  readonly statusPending: string;
  /** `active` machine code display name. */
  readonly statusActive: string;
  /** `expired` machine code display name. */
  readonly statusExpired: string;
  /** `cancelled` machine code display name. */
  readonly statusCancelled: string;
  /** `suspended` machine code display name. */
  readonly statusSuspended: string;
  /** Chip aria-label prefix ("Status: Active"). */
  readonly labelStatus: string;

  // ── Card specs ───────────────────────────────────────────────────────────
  /** Card spec label: price. */
  readonly labelPrice: string;
  /** Card spec label: session count. */
  readonly labelSessions: string;
  /** Card spec label: renewal interval. */
  readonly labelInterval: string;
  /**
   * Interval spec value — interpolates ONLY the day count (single sentinel,
   * verified by the parity suite).
   */
  readonly intervalDays: (days: number) => string;
  /** Card spec label: validity period. */
  readonly labelPeriod: string;
  /** Period line label: started stamp. */
  readonly labelStarted: string;
  /** Period line label: ends stamp. */
  readonly labelEnds: string;
  /** Period value for a lifecycle that has not begun (pending rows). */
  readonly labelNotStarted: string;
  /** Period value for a non-pending row without a fixed end (neutral dash). */
  readonly labelOpenEnded: string;
  /** Card spec label: payment stamps. */
  readonly labelPayment: string;
  /** Card spec label: request date. */
  readonly labelRequestedAt: string;

  // ── Renewal flow ─────────────────────────────────────────────────────────
  /** Card action on a renewable row (terminal status, plan still active). */
  readonly renewCta: string;
  /** Inline note replacing the CTA while the plan already has an unresolved pending request. */
  readonly renewBlockedPending: string;
  /** Inline note replacing the CTA when the plan is no longer active. */
  readonly renewUnavailableInactive: string;
  /** Renewal dialog title. */
  readonly renewDialogTitle: string;
  /**
   * Renewal dialog body — interpolates ONLY the plan title (single
   * sentinel, verified by the parity suite). Carries the offline-payment
   * posture: the academy administration confirms the payment to complete
   * the renewal.
   */
  readonly renewDialogBody: (planTitle: string) => string;
  /** Renewal dialog submit button (fires the mutation). */
  readonly renewRequestCta: string;
  /** Renewal dialog dismiss button. */
  readonly renewDialogClose: string;
  /** Success toast after the renewal request is accepted. */
  readonly renewSuccessToast: string;
  /** Failure toast when the mutation errors (generic, retryable copy). */
  readonly renewFailedToast: string;
}
