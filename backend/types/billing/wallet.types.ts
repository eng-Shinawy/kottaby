import type { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import type { wallet } from "@/backend/db/schema/billing/wallet";

export type WalletSelectType = typeof wallet.$inferSelect;
export type WalletInsertType = typeof wallet.$inferInsert;

/**
 * DEV3-013 (R-301) — the canonical wallet READ shape: the wallet row plus
 * its newest-first ledger page (the documented 50-row cap is applied by
 * the service). The GraphQL `Wallet` object is backed EXCLUSIVELY by this
 * shape — `id` normalization rides `wallet.id`, and the `transactions`
 * field is a passthrough of the ledger page.
 */
export type WalletViewType = {
  readonly wallet: WalletSelectType;
  readonly transactions: readonly TeacherTransactionSelectType[];
};

type TeacherTransactionSelectType = typeof teacherTransaction.$inferSelect;
