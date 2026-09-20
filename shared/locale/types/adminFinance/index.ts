/**
 * Admin Finance namespace labels — the admin financial auditing console
 * (three-tab surface): the payments audit panel, the withdrawal payout
 * queue, and the teacher wallet inspector.
 *
 * Used by:
 *  - The admin finances page shell (`getTranslations(locale)` →
 *    `adminFinanceTranslations` for the Next.js metadata title/description).
 *  - The finances console container and its three tab panels
 *    (`useAppTranslation(AdminFinance)` for the tab labels, the payment
 *    filter bar + table headers, the approve/reject actions + reject
 *    dialog, the wallet inspector + adjustment dialog, and the
 *    loading/error/denied/empty state copy).
 *
 * Count-rendering keys are typed pluralization functions
 * `(count: number) => string`; every other key is a readonly string. No
 * monetary amount or user identifier is ever embedded in copy — values
 * render beside the labels.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `adminFinance-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface AdminFinanceLabels {
  /** Next.js metadata title for `/admin/finances`. */
  readonly metaTitle: string;
  /** Next.js metadata description for `/admin/finances`. */
  readonly metaDescription: string;
  /** Page title. */
  readonly title: string;
  /** Page subtitle — what the console covers. */
  readonly subtitle: string;
  // ─── Tab labels ─────────────────────────────────────────────────────────────
  /** Payments audit tab. */
  readonly paymentsTab: string;
  /** Withdrawal payout queue tab. */
  readonly withdrawalsTab: string;
  /** Teacher wallet inspector tab. */
  readonly walletInspectorTab: string;
  // ─── Payments panel — filters ───────────────────────────────────────────────
  /** Filter card title (covers search, status, gateway, and the date window). */
  readonly filtersTitle: string;
  /** Student search filter label. */
  readonly studentSearchLabel: string;
  /** Student search placeholder hint. */
  readonly studentSearchPlaceholder: string;
  /** Payment-status filter label. */
  readonly statusFilterLabel: string;
  /** Payment-gateway filter label. */
  readonly gatewayFilterLabel: string;
  /** Date-range filter label — the inclusive lower bound. */
  readonly dateFromLabel: string;
  /** Date-range filter label — the inclusive upper bound. */
  readonly dateToLabel: string;
  /** Filter bar apply action. */
  readonly applyFilters: string;
  /** Filter bar reset action. */
  readonly resetFilters: string;
  /** Status filter unset option — any status (no status constraint). */
  readonly allStatusesOption: string;
  /** Gateway filter unset option — any gateway (no gateway constraint). */
  readonly allGatewaysOption: string;
  // ─── Payments panel — table headers ─────────────────────────────────────────
  /** Payments table header — the student column. */
  readonly studentHeader: string;
  /** Payments table header — the amount column (also the withdrawal queue). */
  readonly amountHeader: string;
  /** Payments table header — the currency column. */
  readonly currencyHeader: string;
  /** Payments table header — the gateway column. */
  readonly gatewayHeader: string;
  /** Payments table header — the status column (also the withdrawal queue). */
  readonly statusHeader: string;
  /** Payments table header — the date column. */
  readonly dateHeader: string;
  /** Payments result-count caption above the table. */
  readonly paymentsResultCount: (count: number) => string;
  /** Pagination bar — the previous page control. */
  readonly previousPageLabel: string;
  /** Pagination bar — the next page control. */
  readonly nextPageLabel: string;
  /** Pagination bar — the current-page-of-total caption. */
  readonly pageCountLabel: (page: number, totalPages: number) => string;
  // ─── Withdrawal payout queue ────────────────────────────────────────────────
  /** Withdrawal queue header — the teacher column. */
  readonly teacherHeader: string;
  /** Withdrawal queue header — the reserved wallet-balance column. */
  readonly walletBalanceHeader: string;
  /** Withdrawal queue header — the requested-at column. */
  readonly requestedAtHeader: string;
  /** Withdrawal queue header — pending-count badge/title. */
  readonly pendingWithdrawalsCount: (count: number) => string;
  /** Row action — approve the pending withdrawal. */
  readonly approveAction: string;
  /** Row action — open the reject dialog. */
  readonly rejectAction: string;
  /** Withdrawal queue header — the settle-actions column. */
  readonly actionsHeader: string;
  /** Withdrawal-queue lifecycle status label — pending payout. */
  readonly statusPending: string;
  /** Withdrawal-queue lifecycle status label — settled to completed. */
  readonly statusCompleted: string;
  /** Withdrawal-queue lifecycle status label — settled to failed. */
  readonly statusFailed: string;
  /** Payment lifecycle status label — paid. */
  readonly statusPaid: string;
  /** Payment lifecycle status label — refunded. */
  readonly statusRefunded: string;
  /** Payment gateway label — Stripe. */
  readonly gatewayStripe: string;
  /** Payment gateway label — PayPal. */
  readonly gatewayPaypal: string;
  /** Payment gateway label — Paymob. */
  readonly gatewayPaymob: string;
  /** Payment gateway label — Fawry. */
  readonly gatewayFawry: string;
  /** Payment gateway label — offline cash. */
  readonly gatewayOfflineCash: string;
  /** Payment gateway label — bank transfer. */
  readonly gatewayBankTransfer: string;
  /** Payment gateway label — scholarship waiver. */
  readonly gatewayScholarship: string;
  /** Payment gateway label — mock gateway (test surface). */
  readonly gatewayMock: string;
  /** Payment gateway label — other. */
  readonly gatewayOther: string;
  /** Reject dialog title. */
  readonly rejectDialogTitle: string;
  /** Reject dialog reason field label. */
  readonly rejectReasonLabel: string;
  /** Reject dialog reason field placeholder. */
  readonly rejectReasonPlaceholder: string;
  /** Reject dialog confirm CTA. */
  readonly rejectConfirm: string;
  /** Reject dialog cancel CTA. */
  readonly rejectCancel: string;
  // ─── Wallet inspector ───────────────────────────────────────────────────────
  /** Teacher picker field label. */
  readonly teacherPickerLabel: string;
  /** Teacher picker field placeholder. */
  readonly teacherPickerPlaceholder: string;
  /** Inspector summary card — the spendable balance. */
  readonly balanceLabel: string;
  /** Inspector summary card — the lifetime earnings counter. */
  readonly totalEarningsLabel: string;
  /** Transactions table header — the entry-type column. */
  readonly typeHeader: string;
  /** Transactions table header — the description column. */
  readonly descriptionHeader: string;
  /** Ledger entry-type label — a session earning. */
  readonly typeEarning: string;
  /** Ledger entry-type label — a manual bonus adjustment. */
  readonly typeBonus: string;
  /** Ledger entry-type label — a withdrawal. */
  readonly typeWithdrawal: string;
  // ─── Adjustment dialog ──────────────────────────────────────────────────────
  /** Manual wallet-adjustment dialog title. */
  readonly adjustDialogTitle: string;
  /** Adjustment direction choice — adds to the balance. */
  readonly directionCredit: string;
  /** Adjustment direction choice — subtracts from the balance. */
  readonly directionDebit: string;
  /** Adjustment amount field label. */
  readonly adjustAmountLabel: string;
  /** Adjustment reason field label. */
  readonly adjustReasonLabel: string;
  /** Adjustment dialog submit CTA. */
  readonly adjustSubmit: string;
  /** Success snackbar — a withdrawal settlement settled (approve/reject). */
  readonly settlementSuccessMessage: string;
  /** Success snackbar — a manual wallet adjustment booked. */
  readonly adjustSuccessMessage: string;
  /** Adjustment amount validation message — the decimal grammar or nonzero-digit check failed. */
  readonly adjustAmountInvalidMessage: string;
  /** Adjustment reason validation message — the reason is empty or whitespace-only. */
  readonly adjustReasonInvalidMessage: string;
  // ─── Loading / error / denied / empty states ────────────────────────────────
  /** In-flight load indicator label. */
  readonly loadingLabel: string;
  /** Load-failure state title. */
  readonly errorTitle: string;
  /** Query-context FORBIDDEN denied-notice title. */
  readonly forbiddenTitle: string;
  /** Query-context FORBIDDEN denied-notice body. */
  readonly forbiddenBody: string;
  /** Payments panel empty state — no rows match the current filters. */
  readonly paymentsEmpty: string;
  /** Withdrawal queue empty state — no pending requests. */
  readonly withdrawalsEmpty: string;
  /**
   * Withdrawal queue summary strip — the EGP total of the pending payout
   * amounts visible on the CURRENT page (renders only while the whole queue
   * fits on one page, so the figure is never a partial sum presented as the
   * full queue total — honesty rule for financial copy).
   */
  readonly withdrawalsPendingTotal: (total: string) => string;
  /** Wallet inspector empty state — no transactions to display. */
  readonly inspectorEmpty: string;
  /** Unpicked-picker hint under the empty-state copy. */
  readonly walletEmptyHint: string;
}
