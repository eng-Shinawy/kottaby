/**
 * Plans namespace labels — subscription plan catalog management.
 *
 * Used by:
 *  - Admin plans catalog page (`/admin/plans`)
 *  - Create/edit plan dialogs
 *  - Status confirmation dialogs
 *  - Admin sidebar navigation
 */
export interface PlansLabels {
  readonly pageTitle: string;
  readonly pageSubtitle: string;
  readonly createPlanButton: string;
  readonly editPlanButton: string;
  readonly activatePlanButton: string;
  readonly deactivatePlanButton: string;
  readonly activeStatus: string;
  readonly inactiveStatus: string;
  readonly titleColumn: string;
  readonly sessionCountColumn: string;
  readonly priceColumn: string;
  readonly currencyColumn: string;
  readonly intervalDaysColumn: string;
  readonly statusColumn: string;
  readonly createdAtColumn: string;
  readonly deactivatedAtColumn: string;
  readonly actionsColumn: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly createPlanDialogTitle: string;
  readonly editPlanDialogTitle: string;
  readonly titleFieldLabel: string;
  readonly titleFieldPlaceholder: string;
  readonly sessionCountFieldLabel: string;
  readonly priceFieldLabel: string;
  readonly currencyFieldLabel: string;
  readonly intervalDaysFieldLabel: string;
  readonly cancelButton: string;
  readonly saveButton: string;
  readonly savingButton: string;
  readonly confirmDeactivateTitle: string;
  readonly confirmDeactivateMessage: string;
  readonly confirmReactivateTitle: string;
  readonly confirmReactivateMessage: string;
  readonly confirmButton: string;
  readonly createSuccessToast: string;
  readonly updateSuccessToast: string;
  readonly statusChangeSuccessToast: string;
  readonly navPlans: string;
  /** REQ-062 localized page metadata. */
  readonly metaTitle: string;
  readonly metaDescription: string;
  /** Short interval unit label for dense mobile layouts (e.g. "30 يوم" / "30 days"). */
  readonly intervalDaysShort: string;
  /** Placeholder for absent values (e.g. no deactivation date). */
  readonly emptyValue: string;
  /** Generic form-level failure when the thrown error carries no usable message. */
  readonly unexpectedErrorMessage: string;
  /** Generic status-toggle failure when the thrown error carries no usable message. */
  readonly statusChangeErrorMessage: string;
  /** Client-side validation: plan title length out of bounds. */
  readonly validationTitleMessage: string;
  /** Client-side validation: session count must be a positive integer. */
  readonly validationSessionCountMessage: string;
  /** Client-side validation: price must be a non-negative decimal with ≤2 fraction digits. */
  readonly validationPriceMessage: string;
  /** Client-side validation: currency must be a 3-letter ISO code. */
  readonly validationCurrencyMessage: string;
  /** Client-side validation: interval days must be a positive integer. */
  readonly validationIntervalDaysMessage: string;
}
