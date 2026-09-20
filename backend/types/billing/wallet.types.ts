import type { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import type { wallet } from "@/backend/db/schema/billing/wallet";

export type WalletSelectType = typeof wallet.$inferSelect;

/**
 * The canonical wallet READ shape (R-301): the wallet row plus
 * its newest-first ledger page (the documented 50-row cap is applied by
 * the service). The GraphQL `Wallet` object is backed EXCLUSIVELY by this
 * shape — `id` normalization rides `wallet.id`, and the `transactions`
 * field is a passthrough of the ledger page.
 */
export type WalletViewType = {
  readonly wallet: WalletSelectType;
  readonly transactions: readonly TeacherTransactionSelectType[];
};

/**
 * One page of the caller's paginated ledger read (`myWalletLedger`): the
 * newest-first window plus the pagination truth (`totalCount` + `hasMore`)
 * so the client can drive a "load more" affordance without guessing.
 * The row shape is the SAME canonical `teacher_transaction` select row the
 * `Wallet.transactions` page exposes — one ledger row type across both
 * surfaces.
 */
export type WalletLedgerPageViewType = {
  readonly rows: readonly TeacherTransactionSelectType[];
  readonly totalCount: number;
  readonly hasMore: boolean;
};

type TeacherTransactionSelectType = typeof teacherTransaction.$inferSelect;
