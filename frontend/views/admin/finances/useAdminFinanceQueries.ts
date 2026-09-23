/**
 * useAdminFinanceQueries — the barrel of the admin finance Apollo bindings
 * (`/admin/finances`), split into per-surface hook modules in this
 * directory:
 *
 * - {@link ./usePaymentsQuery} — the filterable/paginated payments audit
 *   read (`useAdminStudentPayments`) and the applied-filter record.
 * - {@link ./useWalletQuery} — the teacher wallet inspector read
 *   (`useAdminTeacherWallet`, `skipToken` while no teacher is picked) and
 *   the applied wallet-filter record.
 * - {@link ./useWithdrawalQueries} — the pending-withdrawal queue read
 *   (`useAdminPendingWithdrawals`) and the approve/reject settlement
 *   mutation hooks.
 * - {@link ./useAdjustWalletMutation} — the manual credit/debit adjustment
 *   mutation (`useAdjustTeacherWallet`).
 * - {@link ./mutationErrorRouting} — the shared mutation error
 *   classification (`MutationOutcomeCallbacks`, `routeMutationError`).
 *
 * The hooks keep their original names; consumers import through this
 * barrel or directly from the surface modules.
 */

export * from "./mutationErrorRouting";
export * from "./useAdjustWalletMutation";
export * from "./usePaymentsQuery";
export * from "./useWalletQuery";
export * from "./useWithdrawalQueries";
