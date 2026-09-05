/**
 * WalletPothosObject + TeacherTransactionPothosObject — the single
 * canonical GraphQL object types for a teacher's wallet and one of its
 * ledger rows (DEV3-013, R-301).
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by the canonical `WalletViewType` /
 *    `TeacherTransactionSelectType` from `@/backend/types` — no local type
 *    definitions here. Every field is a structural map or passthrough;
 *    there is NO business logic in this module.
 *  - `Wallet` exposes `id` FIRST (Apollo cache normalization — the
 *    `requestWithdrawal` payload converges `Wallet:<id>` without a
 *    refetch), then the balance surface, then the ledger page.
 *  - `currency` is a CONSTANT "EGP" — the platform currency lives in
 *    `SESSION_FEE_CURRENCY` (the `wallet` table has no currency column);
 *    it is a render label only, never a column read.
 *  - `transactions` is a passthrough of the canonical view's ledger page
 *    (newest-first, service-capped at 50 rows — full pagination is F10).
 *  - `sessionId` on the ledger row is deliberately exposed (cache-friendly
 *    `ID`, nullable) — a NULL means the row is not session-linked
 *    (withdrawals/bonuses), never "unknown".
 *
 * Enum fields map the pgEnum string unions carried by the canonical rows
 * onto the Pothos enums registered ONCE in `shared/enum.pothos.ts` through
 * exhaustive, type-safe mapping helpers — never `as` casts (the same
 * fail-closed `never` guard idiom `session.pothos.ts` uses). Timestamps
 * use the `DateTime` scalar.
 *
 * Consumed by the wallet query/mutation resolver modules, whose imports
 * transitively register the types through the `gqlSchema.ts` side-effect
 * chain.
 */

import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { TransactionStatusPothosEnum, TransactionTypePothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { TeacherTransactionSelectType, WalletViewType } from "@/backend/types";

/**
 * Maps the `transaction_type` pgEnum value carried by the canonical
 * `TeacherTransactionSelectType` row onto the `TransactionType` TS enum.
 *
 * EXHAUSTIVE over the pgEnum vocabulary — one case per member, NO
 * `default`: the fail-closed trailing throw guards a runtime-only drift
 * (a DB enum ahead of the TS schema) by surfacing a resolver error instead
 * of passing an unmapped value through.
 */
function toTransactionType(type: TeacherTransactionSelectType["type"]): TransactionType {
  switch (type) {
    case "earning":
      return TransactionType.Earning;
    case "withdrawal":
      return TransactionType.Withdrawal;
    case "bonus":
      return TransactionType.Bonus;
  }
  const exhaustive: never = type;
  throw new Error(`Unexpected transaction type: ${String(exhaustive)}`);
}

/**
 * Maps the `transaction_status` pgEnum value carried by the canonical
 * `TeacherTransactionSelectType` row onto the `TransactionStatus` TS
 * enum — exhaustive switch (one case per member, no `default`) with the
 * same fail-closed never-guard fallback.
 */
function toTransactionStatus(status: TeacherTransactionSelectType["status"]): TransactionStatus {
  switch (status) {
    case "pending":
      return TransactionStatus.Pending;
    case "completed":
      return TransactionStatus.Completed;
    case "failed":
      return TransactionStatus.Failed;
  }
  const exhaustive: never = status;
  throw new Error(`Unexpected transaction status: ${String(exhaustive)}`);
}

/**
 * The canonical `TeacherTransaction` GraphQL object — one append-only
 * ledger row. Producers return `TeacherTransactionSelectType` (the
 * `teacher_transaction` table's derived select row). `id` first.
 */
export const TeacherTransactionPothosObject = gqlSchemaBuilder
  .objectRef<TeacherTransactionSelectType>("TeacherTransaction")
  .implement({
    fields: t => ({
      // ID FIRST — Apollo cache normalization identity.
      id: t.exposeID("id"),
      // The owning wallet id — exposed as `ID` for cache/debuggability; the
      // surface is teacher-self-scoped so this is the caller's own wallet.
      walletId: t.exposeID("walletId"),
      // Nullable session link (set null on session deletion) — withdrawals
      // and bonuses carry NULL honestly.
      sessionId: t.exposeID("sessionId", { nullable: true }),
      // Money fields — decimal STRINGS exposed verbatim (money discipline:
      // never numbers, never floats).
      amount: t.exposeString("amount"),
      description: t.exposeString("description", { nullable: true }),
      // Ledger vocabulary — mapped exhaustively onto the registered enums.
      type: t.field({
        type: TransactionTypePothosEnum,
        resolve: parent => toTransactionType(parent.type),
      }),
      status: t.field({
        type: TransactionStatusPothosEnum,
        resolve: parent => toTransactionStatus(parent.status),
      }),
      createdAt: t.expose("createdAt", { type: "DateTime" }),
      updatedAt: t.expose("updatedAt", { type: "DateTime" }),
    }),
  });

/**
 * The canonical `Wallet` GraphQL object — the teacher's wallet row plus
 * its newest-first ledger page. Producers return `WalletViewType`
 * (`{ wallet, transactions }`).
 */
export const WalletPothosObject = gqlSchemaBuilder.objectRef<WalletViewType>("Wallet").implement({
  fields: t => ({
    // ID FIRST — Apollo cache normalization identity (the wallet row's PK;
    // the `requestWithdrawal` payload's balance update converges
    // `Wallet:<id>` without a refetch).
    id: t.id({ resolve: parent => parent.wallet.id }),
    // Balance surface — decimal STRINGS verbatim (money discipline).
    balance: t.string({ resolve: parent => parent.wallet.balance }),
    totalEarning: t.string({ resolve: parent => parent.wallet.totalEarning }),
    // Render label only — the platform currency constant (no column read;
    // the `wallet` table has no currency column).
    currency: t.string({ resolve: () => "EGP" }),
    createdAt: t.field({
      type: "DateTime",
      resolve: parent => parent.wallet.createdAt,
    }),
    updatedAt: t.field({
      type: "DateTime",
      resolve: parent => parent.wallet.updatedAt,
    }),
    // The ledger page — newest first, service-capped at 50 rows (F10).
    transactions: t.field({
      type: [TeacherTransactionPothosObject],
      resolve: parent => parent.transactions,
    }),
  }),
});
