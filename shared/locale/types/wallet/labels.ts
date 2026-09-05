/**
 * Wallet namespace labels — the teacher self-service wallet surface
 * (DEV3-013): the balance header, the withdrawal-request dialog, and the
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
  /** Ledger type vocabulary — mirrors EVERY TransactionType value. */
  readonly typeEarning: string;
  readonly typeWithdrawal: string;
  readonly typeBonus: string;
  /** Ledger status vocabulary — mirrors EVERY TransactionStatus value. */
  readonly statusPending: string;
  readonly statusCompleted: string;
  readonly statusFailed: string;
  /** Ledger column label — row timestamp. */
  readonly createdAt: string;
  /** Empty-ledger title. */
  readonly ledgerEmptyTitle: string;
  /** Empty-ledger body. */
  readonly ledgerEmptyBody: string;
}
