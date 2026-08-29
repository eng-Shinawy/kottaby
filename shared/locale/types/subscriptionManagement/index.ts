/**
 * `subscriptionManagement` namespace labels — the ADMIN subscription
 * lifecycle manager (DEV1-009).
 *
 * Used by:
 *  - `/admin/subscriptions` page header (title + subtitle).
 *  - The status filter (All + the five lifecycle statuses, committed by an
 *    explicit Apply — draft/applied discipline mirrors the audit trail).
 *  - Subscription cards (subscriber summary, plan + price + sessions,
 *    status chip, validity period, payment stamps, requested date, cancel
 *    CTA — terminal rows render NO cancel CTA).
 *  - Cancel dialog (title, interpolated body, confirm/dismiss actions).
 *  - Cancellation feedback (success / failure toasts).
 *  - Pagination (server-total page window, prev/next + SR labels).
 *  - Empty + error states (with retry).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/subscription-management-namespace.parity.test.ts`) pins
 * the key sets and both formatter shapes identical across locales.
 *
 * NOTE: this namespace deliberately does NOT reuse the `paymentVerification`
 * namespace — lifecycle management is a different workflow (filtering +
 * cancellation posture over EVERY status, not a FIFO pending queue), and
 * verification copy churn must never leak into the lifecycle surface.
 */
export interface SubscriptionManagementLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Subscriptions page title. */
  readonly pageTitle: string;
  /** Subscriptions page subtitle under the title. */
  readonly pageSubtitle: string;

  // ── Async states ─────────────────────────────────────────────────────────
  /** Loading-state copy. */
  readonly loading: string;
  /** Empty-list state title. */
  readonly emptyStateTitle: string;
  /** Empty-list state body. */
  readonly emptyStateBody: string;
  /** Load-failure state title. */
  readonly errorStateTitle: string;
  /** Load-failure state body. */
  readonly errorStateBody: string;
  /** Retry action on the error state. */
  readonly errorStateRetry: string;

  // ── Status filter ────────────────────────────────────────────────────────
  /** The "all statuses" filter option (chip label). */
  readonly filterAll: string;
  /** The `active` status filter option (chip label + chip display). */
  readonly filterActive: string;
  /** The `pending` status filter option (chip label + chip display). */
  readonly filterPending: string;
  /** The `expired` status filter option (chip label + chip display). */
  readonly filterExpired: string;
  /** The `cancelled` status filter option (chip label + chip display). */
  readonly filterCancelled: string;
  /** The `suspended` status filter option (chip label + chip display). */
  readonly filterSuspended: string;
  /** Apply CTA — commits the draft status filter to the query. */
  readonly applyFilters: string;

  // ── Subscription card ────────────────────────────────────────────────────
  /** Card row label: the subscriber (name + email follow as data). */
  readonly labelSubscriber: string;
  /** Card row label: the subscribed plan's title. */
  readonly labelPlan: string;
  /** Card spec label: session count. */
  readonly labelSessions: string;
  /** Card spec label: price. */
  readonly labelPrice: string;
  /** The status chip's accessible label prefix ("Status: Active"). */
  readonly labelStatus: string;
  /** Card row label: the validity period (started/ends lines follow). */
  readonly labelPeriod: string;
  /** Period line label: when the subscription started. */
  readonly labelStarted: string;
  /** Period line label: when the subscription ends. */
  readonly labelEnds: string;
  /** Period line value for a row whose lifecycle has not begun (pending). */
  readonly labelNotStarted: string;
  /** Period line value for a row with no fixed end date (locale-neutral). */
  readonly labelOpenEnded: string;
  /** Card row label: the payment stamps (method + reference when present). */
  readonly labelPayment: string;
  /** Card row label: when the subscription was requested (timestamp follows). */
  readonly labelRequestedAt: string;

  // ── Cancel flow ──────────────────────────────────────────────────────────
  /** Card primary action: open the cancel dialog (active/pending rows only). */
  readonly cancelCta: string;
  /** Cancel dialog title. */
  readonly cancelDialogTitle: string;
  /**
   * Cancel dialog body — interpolates the subscriber name AND the plan title
   * (two sentinels, verified by the parity suite). Both arguments expand
   * exactly once in BOTH locales.
   */
  readonly cancelDialogBody: (subscriberName: string, planTitle: string) => string;
  /** Dialog confirm button (fires the cancel mutation). */
  readonly cancelDialogConfirm: string;
  /** Dialog dismiss button (keeps the subscription). */
  readonly cancelDialogDismiss: string;
  /** Success toast after the cancellation settles. */
  readonly cancelSuccessToast: string;
  /** Failure toast when the mutation errors (generic, retryable copy). */
  readonly cancelFailedToast: string;

  // ── Pagination ───────────────────────────────────────────────────────────
  /**
   * Page-window formatter — `{from}–{to} of {total}`, all three arguments
   * expand in BOTH locales (mirrors the audit namespace's `pageInfo`).
   */
  readonly pageInfo: (from: number, to: number, total: number) => string;
  /** Static "per page" caption beside the fixed page size. */
  readonly rowsPerPage: string;
  /** Previous-page button label. */
  readonly pagePrev: string;
  /** Next-page button label. */
  readonly pageNext: string;
  /** Previous-page button accessible label. */
  readonly pagePrevAriaLabel: string;
  /** Next-page button accessible label. */
  readonly pageNextAriaLabel: string;
}
