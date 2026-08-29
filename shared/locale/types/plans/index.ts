/**
 * `plans` namespace labels — the admin plan-catalog surfaces.
 *
 * Used by (structural handle today; UI wiring follows in the admin plans views):
 *  - Plan catalog page header (title + subtitle + create action).
 *  - Catalog table (column headers, row actions, loading state).
 *  - Status chips (active / inactive).
 *  - Create + edit dialogs (titles, field labels + placeholders, dialog buttons).
 *  - Status-confirmation dialog (deactivate / activate copy).
 *  - Toasts (created / updated / activated / deactivated + generic failure).
 *  - Empty + error states (with retry).
 *
 * All keys MUST have both `en` and `ar` implementations; the parity suite
 * (`shared/locale/plans-namespace.parity.test.ts`) pins the plan-title
 * interpolation shape identical across both locales.
 */
export interface PlansLabels {
  // ── Page header ──────────────────────────────────────────────────────────
  /** Catalog page title. */
  readonly pageTitle: string;
  /** Catalog page subtitle under the title. */
  readonly pageSubtitle: string;
  /** Primary page-header action that opens the create dialog. */
  readonly createButton: string;

  // ── Catalog table ────────────────────────────────────────────────────────
  /** Column header: plan name. */
  readonly columnTitle: string;
  /** Column header: session count. */
  readonly columnSessionCount: string;
  /** Column header: price. */
  readonly columnPrice: string;
  /** Column header: renewal interval in days. */
  readonly columnIntervalDays: string;
  /** Column header: lifecycle status chip. */
  readonly columnStatus: string;
  /** Column header: deactivation timestamp (em-dash when the plan is active). */
  readonly columnDeactivatedAt: string;
  /** Column header: creation timestamp. */
  readonly columnCreatedAt: string;
  /** Column header: row actions. */
  readonly columnActions: string;
  /** Row action: edit the plan (opens the edit dialog). */
  readonly actionEdit: string;
  /** Row action: activate a deactivated plan (opens the confirmation dialog). */
  readonly actionActivate: string;
  /** Row action: deactivate an active plan (opens the confirmation dialog). */
  readonly actionDeactivate: string;
  /** Table loading-state copy. */
  readonly loading: string;

  // ── Status chips ─────────────────────────────────────────────────────────
  /** Chip label for an active (visible) plan. */
  readonly statusActive: string;
  /** Chip label for a deactivated (hidden) plan. */
  readonly statusInactive: string;

  // ── Create + edit dialogs ────────────────────────────────────────────────
  /** Create dialog title. */
  readonly createDialogTitle: string;
  /** Create dialog subtitle — purpose + validation posture. */
  readonly formSubtitleCreate: string;
  /** Edit dialog title. */
  readonly editDialogTitle: string;
  /** Edit dialog subtitle — forward-only safety assurance. */
  readonly formSubtitleEdit: string;
  /** Field label: plan name (admin-authored content, NOT a translation key). */
  readonly fieldTitle: string;
  /** Field placeholder: plan-name example. */
  readonly fieldTitlePlaceholder: string;
  /** Field label: session count. */
  readonly fieldSessionCount: string;
  /** Field placeholder: session-count example. */
  readonly fieldSessionCountPlaceholder: string;
  /** Field label: price. */
  readonly fieldPrice: string;
  /** Field placeholder: price example. */
  readonly fieldPricePlaceholder: string;
  /** Static hint under the price field while it carries no error. */
  readonly helperPrice: string;
  /** Field label: currency code. */
  readonly fieldCurrency: string;
  /** Field placeholder: currency-code example. */
  readonly fieldCurrencyPlaceholder: string;
  /** Static hint under the currency field while it carries no error. */
  readonly helperCurrency: string;
  /** Field label: renewal interval in days. */
  readonly fieldIntervalDays: string;
  /** Field placeholder: interval example. */
  readonly fieldIntervalDaysPlaceholder: string;
  /** Dialog primary submit button. */
  readonly save: string;
  /** Dialog dismiss button. */
  readonly cancel: string;
  /** Accessible label for the dialog header close (X) icon button. */
  readonly close: string;
  /** In-flight dialog submit-state copy. */
  readonly submitting: string;

  // ── Status-confirmation dialog ───────────────────────────────────────────
  /** Confirmation dialog title for deactivating a plan. */
  readonly deactivateConfirmTitle: string;
  /**
   * Confirmation dialog body for deactivating a plan — interpolates ONLY the
   * plan title (single sentinel, verified by the parity suite).
   */
  readonly deactivateConfirmBody: (planTitle: string) => string;
  /** Confirmation dialog title for reactivating a plan. */
  readonly activateConfirmTitle: string;
  /**
   * Confirmation dialog body for reactivating a plan — interpolates ONLY the
   * plan title (single sentinel, verified by the parity suite).
   */
  readonly activateConfirmBody: (planTitle: string) => string;
  /** Confirmation dialog confirm button. */
  readonly confirm: string;

  // ── Toasts ───────────────────────────────────────────────────────────────
  /** Success toast after creating a plan — interpolates the plan title once. */
  readonly toastCreated: (planTitle: string) => string;
  /** Success toast after updating a plan — interpolates the plan title once. */
  readonly toastUpdated: (planTitle: string) => string;
  /** Success toast after activating a plan — interpolates the plan title once. */
  readonly toastActivated: (planTitle: string) => string;
  /** Success toast after deactivating a plan — interpolates the plan title once. */
  readonly toastDeactivated: (planTitle: string) => string;
  /** Generic failure toast when a catalog mutation fails. */
  readonly toastActionFailed: string;

  // ── Empty + error states ─────────────────────────────────────────────────
  /** Empty-catalog state title. */
  readonly emptyStateTitle: string;
  /** Empty-catalog state body. */
  readonly emptyStateBody: string;
  /** Catalog load-failure state title. */
  readonly errorStateTitle: string;
  /** Catalog load-failure state body. */
  readonly errorStateBody: string;
  /** Retry action on the error state. */
  readonly errorStateRetry: string;
}
