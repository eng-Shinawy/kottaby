/**
 * WalletAdjustmentDirection — service-layer vocabulary for a manual wallet
 * adjustment recorded through the admin auditing service. NOT a pgEnum and
 * NOT persisted as a column: the direction is resolved at service time into
 * the credit/debit ledger movement against the teacher's wallet.
 */
export enum WalletAdjustmentDirection {
  Credit = "credit",
  Debit = "debit",
}
