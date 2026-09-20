/**
 * Wallet namespace labels — the teacher self-service wallet surface:
 * the balance header, the withdrawal-request dialog, and the
 * transaction ledger.
 *
 * Used by:
 *  - `frontend/views/teacher/wallet/TeacherWalletContainer.tsx`
 *    (`useAppTranslation(Wallet)` with property access).
 *  - Server Components rendering the page via
 *    `await getTranslations(locale)` → property access.
 *
 * All keys MUST have both `en` and `ar` implementations with EXACT key-set
 * parity (compile-typed on both leaves + `wallet-namespace.parity.test.ts`
 * runtime belt). Property access only — never call-by-key.
 */
export interface WalletLabels {
  /** Wallet page <title>/header. */
  readonly pageTitle: string;
  /** Balance summary card label — the spendable balance. */
  readonly balanceLabel: string;
  /** Balance summary card label — the lifetime earnings counter. */
  readonly totalEarningLabel: string;
  /** Primary CTA — opens the withdrawal dialog. */
  readonly requestWithdrawal: string;
  /** Withdrawal dialog title. */
  readonly withdrawDialogTitle: string;
  /** Withdrawal dialog explainer — debit-on-request semantics. */
  readonly withdrawDialogBody: string;
  /** Amount field label (EGP-denominated). */
  readonly amountLabel: string;
  /** Amount field placeholder. */
  readonly amountPlaceholder: string;
  /** Live available-balance hint under the amount field (ICU {balance}). */
  readonly availableBalanceHint: (balance: string) => string;
  /**
   * Live preview under the quick-amount chips — the wallet balance that will
   * remain once the typed request is accepted and its funds frozen
   * (ICU {remaining}; renders only while the typed amount is client-valid).
   */
  readonly balanceAfterRequest: (remaining: string) => string;
  /** Withdrawal dialog submit CTA. */
  readonly withdrawSubmit: string;
  /** Success snackbar after an accepted withdrawal request. */
  readonly withdrawSuccessNotice: string;
  /** Client-side mirror of the server's invalid-amount rejection. */
  readonly invalidAmount: string;
  /** Generic failure fallback for the withdrawal flow. */
  readonly genericError: string;
  /** Ledger section heading. */
  readonly ledgerTitle: string;
  /** Ledger filter chip — the unfiltered view. */
  readonly filterAll: string;
  /** Honest empty state when the selected type filter matches zero rows. */
  readonly ledgerFilteredTitle: string;
  readonly ledgerFilteredEmpty: string;
  /** Ledger type vocabulary — mirrors EVERY TransactionType value. */
  readonly typeEarning: string;
  readonly typeWithdrawal: string;
  readonly typeBonus: string;
  /** The dispute-arbitration clawback chip (teacher-side compensating debit). */
  readonly typeArbitrationReversal: string;
  /** Ledger status vocabulary — mirrors EVERY TransactionStatus value. */
  readonly statusPending: string;
  readonly statusCompleted: string;
  readonly statusFailed: string;
  /** Ledger column label — row timestamp. */
  readonly createdAt: string;
  /** Ledger desktop column header — the type + description column. */
  readonly ledgerColumnTransaction: string;
  /** Ledger desktop column header — the row status column. */
  readonly ledgerColumnStatus: string;
  /** Ledger desktop column header — the signed-amount column. */
  readonly ledgerColumnAmount: string;
  /** Ledger card footer — every fetched row is on screen (count of visible, total fetched). */
  readonly ledgerShownAll: (visibleCount: number, fetchedCount: number) => string;
  /**
   * Ledger card footer — a page window with a KNOWN server total still
   * partially unloaded (count of visible, total on the server).
   */
  readonly ledgerShownPage: (visibleCount: number, totalCount: number) => string;
  /**
   * Ledger card footer — a full first page whose server total is not yet
   * known (the "load more" affordance may reveal older rows).
   */
  readonly ledgerShownLatest: (visibleCount: number) => string;
  /** Ledger "load more" CTA — fetches the next page of older rows. */
  readonly ledgerLoadMore: string;
  /**
   * Ledger description written on the pending-withdrawal debit row (the
   * server composes it per the requester's locale — `wallet.service`).
   */
  readonly withdrawalLedgerDescription: string;
  /** Withdraw dialog — accessible name of the quick-amount chip group. */
  readonly quickAmountsAria: string;
  /** Withdraw dialog — the 25% quick-amount chip label. */
  readonly quickAmountQuarter: string;
  /** Withdraw dialog — the 50% quick-amount chip label. */
  readonly quickAmountHalf: string;
  /** Withdraw dialog — the 100% quick-amount chip label. */
  readonly quickAmountFull: string;
  /** Ledger header — accessible label of the CSV export button. */
  readonly exportCsv: string;
  /** Empty-ledger title. */
  readonly ledgerEmptyTitle: string;
  /** Empty-ledger body. */
  readonly ledgerEmptyBody: string;
  /** Pending-teacher empty state title — no wallet exists before approval. */
  readonly pendingTeacherTitle: string;
}
