/**
 * Billing-domain shared GraphQL documents barrel.
 *
 * Re-exports the plan-catalog documents (DEV1-005 / PR #28) and the teacher
 * wallet documents (DEV3-013): the self-wallet read (`myWallet`) and the
 * payout write (`requestWithdrawal`).
 */
export * from "./plan-catalog.documents";
export * from "./wallet.documents";
