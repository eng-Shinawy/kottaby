/**
 * WalletRepository — data-access layer for the teacher `wallet` table and
 * its append-only `teacher_transaction` ledger.
 *
 * Dual-confirmation credit slice (R-202): composes THREE
 * writes on the caller's transaction — ensure the wallet row exists, insert
 * the `earning` ledger row, increment the wallet's `balance` and
 * `total_earning` by the credited amount. The schema docblocks describe a
 * consistency trigger, but no such trigger exists in the database yet
 * (verified via information_schema on the dev cluster), so the wallet
 * increment is an EXPLICIT guarded UPDATE inside the same transaction —
 * the ledger row and the balance move commit atomically or not at all.
 *
 * File layout: the admin-scoped read/write primitives (the admin ledger
 * page + count, the pending-withdrawal queue + count, the wallet and
 * settlement probes, the guarded settlement, the debit restore, the bonus
 * credit, and the manual debit adjustment) live in the sibling
 * `wallet.repository.admin.helpers.ts` module (extracted verbatim); the
 * teacher-facing primitives stay in this file, and the guarded-debit pair
 * (`debitForWithdrawalOnce` / `debitAdjustmentOnce`) delegates to the
 * shared `debitWithLedgerRow` writer in
 * `wallet.repository.shared-writer.ts`. Every admin method is a one-to-one
 * delegation wrapper, so the public API (names, signatures, behavior) is
 * unchanged.
 *
 * Conventions per `backend/db/repo/AGENTS.md` (mirroring
 * `SessionRepository`):
 *  - One `namespace` per repository file; the namespace name is the
 *    canonical export.
 *  - Every method takes `tx?: DBTransaction` as its LAST parameter; writes
 *    execute on `tx ?? db`.
 *  - NO prepared statements, NO business logic, NO permission checks, NO
 *    i18n or logging imports — the caller decides what every result means.
 *  - Financial vocabulary is carried by the `TransactionType` /
 *    `TransactionStatus` enum members, never string literals.
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import * as walletRepositoryAdminImpl from "@/backend/db/repo/billing/wallet.repository.admin.helpers";
import { debitWithLedgerRow } from "@/backend/db/repo/billing/wallet.repository.shared-writer";
import { teacherTransaction, wallet } from "@/backend/db/schema/billing";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type { DBTransaction, TeacherTransactionSelectType, WalletSelectType } from "@/backend/types";

export namespace WalletRepository {
  /**
   * Ensures a wallet row exists for the teacher (the schema docblock's
   * "created when a teacher is approved" writer does not exist yet, so the
   * credit primitive is self-sufficient): one idempotent
   * `INSERT … ON CONFLICT (teacher_id) DO NOTHING` followed by the
   * authoritative SELECT, on the caller's transaction. The unique
   * `wallet_teacher_id_unique` constraint makes the ensure step safe under
   * concurrent confirms — exactly one row ever exists per teacher.
   *
   * @returns The teacher's wallet row (pre-existing or just created).
   */
  export async function ensureWalletOnce(teacherId: number, tx?: DBTransaction): Promise<WalletSelectType> {
    const executor = tx ?? db;
    await executor.insert(wallet).values({ teacherId }).onConflictDoNothing();
    const rows = await executor.select().from(wallet).where(eq(wallet.teacherId, teacherId)).limit(1);
    return rows[0];
  }

  /**
   * Inserts ONE `earning` ledger row and increments the wallet's
   * `balance` and `total_earning` by the credited amount — the completed
   * dual-confirmation credit slice, on the caller's transaction. The
   * amount is the session's `fee` decimal string taken VERBATIM (never
   * re-parsed or re-rounded — B.3's platform-owned pricing). The wallet
   * increment is an explicit guarded UPDATE (no DB trigger exists); its
   * `>= 0` CHECK constraints hold because the increment is strictly
   * additive.
   *
   * @returns The inserted ledger row.
   */
  export async function creditEarningOnce(
    insert: {
      readonly walletId: number;
      readonly sessionId: number;
      readonly amount: string;
      readonly description: string;
    },
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType> {
    const executor = tx ?? db;
    const ledgerRows = await executor
      .insert(teacherTransaction)
      .values({
        walletId: insert.walletId,
        sessionId: insert.sessionId,
        description: insert.description,
        amount: insert.amount,
        type: TransactionType.Earning,
        status: TransactionStatus.Completed,
      })
      .returning();
    const ledger = ledgerRows[0];
    if (!ledger) {
      throw new Error("WalletRepository.creditEarningOnce: ledger INSERT returned zero rows");
    }
    await executor
      .update(wallet)
      .set({
        balance: sql`${wallet.balance} + ${insert.amount}`,
        totalEarning: sql`${wallet.totalEarning} + ${insert.amount}`,
        updatedAt: new Date(),
      })
      .where(eq(wallet.id, insert.walletId));
    return ledger;
  }

  /**
   * Cold-path read of the teacher's wallet (probe/verification use).
   *
   * @returns The wallet row, or `null` when the teacher has none.
   */
  export async function findByTeacherId(teacherId: number, tx?: DBTransaction): Promise<WalletSelectType | null> {
    const executor = tx ?? db;
    const rows = await executor.select().from(wallet).where(eq(wallet.teacherId, teacherId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Cold-path read of one wallet row by its primary key (probe/verification
   * use).
   *
   * @returns The wallet row, or `null` when no wallet has that id.
   */
  export async function findById(walletId: number, tx?: DBTransaction): Promise<WalletSelectType | null> {
    const executor = tx ?? db;
    const rows = await executor.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
    return rows[0] ?? null;
  }

  /**
   * Cold-path ledger read for one wallet (test/verification use).
   *
   * @returns Every ledger row for the wallet, newest first.
   */
  export async function listTransactionsByWalletId(
    walletId: number,
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType[]> {
    const executor = tx ?? db;
    return executor
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.walletId, walletId))
      .orderBy(sql`${teacherTransaction.id} DESC`);
  }

  /**
   * The withdrawal debit slice, on the caller's transaction: inserts ONE `pending` `withdrawal` ledger row (the
   * in-flight payout record; the append-only contract means settlement is
   * a future compensating flow, never an in-place flip) and debits the
   * wallet `balance` by exactly `amount` via ONE guarded UPDATE.
   *
   * @returns The inserted ledger row, or `null` when the guarded UPDATE
   *     matched zero rows (insufficient funds — the caller classifies).
   */
  export async function debitForWithdrawalOnce(
    insert: {
      readonly walletId: number;
      readonly amount: string;
      readonly description: string;
    },
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType | null> {
    return debitWithLedgerRow(insert, TransactionStatus.Pending, "WalletRepository.debitForWithdrawalOnce", tx);
  }

  /**
   * The guarded balance debit shared by both debit primitives: ONE UPDATE
   * whose predicate carries the funds guard (`balance >= amount`) and whose
   * SET clause touches ONLY the balance and the audit stamp —
   * `total_earning` is deliberately untouched (a debit spends the balance;
   * it never rewrites the gross lifetime earnings counter). The DB-side
   * `wallet_balance_check >= 0` CHECK is the concurrent-overdraw backstop
   * behind the predicate.
   *
   * @returns Whether the debit landed — `false` means zero rows matched
   *          (insufficient funds; the caller classifies).
   */
  async function guardedBalanceDebit(walletId: number, amount: string, tx?: DBTransaction): Promise<boolean> {
    const executor = tx ?? db;
    const debited = await executor
      .update(wallet)
      .set({ balance: sql`${wallet.balance} - ${amount}`, updatedAt: new Date() })
      .where(and(eq(wallet.id, walletId), gte(wallet.balance, amount)))
      .returning({ id: wallet.id });
    return debited.length > 0;
  }

  /**
   * The arbitration reversal debit slice (the consumed-dispute outcomes'
   * teacher leg), on the caller's transaction: debits the wallet `balance`
   * by exactly `amount` via ONE guarded UPDATE FIRST — the funds guard
   * lives in the statement's predicate (`balance >= amount`), the same
   * composition ruling the shared `debitWithLedgerRow` writer owns — and,
   * only after the guard holds, inserts ONE `completed`
   * `arbitration_reversal` ledger row keyed to the disputed session through
   * the ledger's session FK so the reversal stays traceable end to end.
   * The amount is a decimal STRING bound verbatim (never re-parsed or
   * re-rounded — money discipline; the decimal columns own the
   * two-fraction storage). `total_earning` is deliberately untouched (a
   * reversal claws back the balance; it never rewrites the gross lifetime
   * earnings counter). The debit runs strictly BEFORE the ledger INSERT, so
   * a missed debit returns `null` with ZERO writes — no orphan ledger row
   * is ever live inside the caller's transaction, and no rollback is needed
   * to clean one up. A nonexistent wallet id also surfaces as `null` (the
   * caller's insufficient-funds classification) rather than a FK violation,
   * because the funds guard misses before any row is written.
   *
   * @returns The inserted ledger row, or `null` when the guarded UPDATE
   *     matched zero rows (insufficient funds — the caller classifies and
   *     fails the transaction).
   */
  export async function debitForArbitrationOnce(
    insert: {
      readonly walletId: number;
      readonly sessionId: number;
      readonly amount: string;
      readonly description: string;
    },
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType | null> {
    const executor = tx ?? db;
    const debited = await guardedBalanceDebit(insert.walletId, insert.amount, tx);
    if (!debited) {
      return null;
    }
    const ledgerRows = await executor
      .insert(teacherTransaction)
      .values({
        walletId: insert.walletId,
        sessionId: insert.sessionId,
        description: insert.description,
        amount: insert.amount,
        type: TransactionType.ArbitrationReversal,
        status: TransactionStatus.Completed,
      })
      .returning();
    const ledger = ledgerRows[0];
    if (!ledger) {
      throw new Error("WalletRepository.debitForArbitrationOnce: ledger INSERT returned zero rows");
    }
    return ledger;
  }

  /**
   * Newest-first ledger page for one wallet, capped at `limit` rows (the
   * service passes the documented 50-row surface cap; full pagination is
   * a forward item).
   *
   * @returns Up to `limit` most-recent ledger rows, newest first.
   */
  export async function listRecentTransactions(
    walletId: number,
    limit: number,
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType[]> {
    const executor = tx ?? db;
    return executor
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.walletId, walletId))
      .orderBy(desc(teacherTransaction.id))
      .limit(limit);
  }

  /**
   * One offset page of the newest-first ledger for one wallet — the
   * teacher self-service "load more" primitive (`myWalletLedger`). Same
   * ordering (`id` DESC) and row shape as `listRecentTransactions`; the
   * service clamps the window, the repository executes it verbatim.
   *
   * @returns Up to `limit` ledger rows starting at `offset`, newest first.
   */
  export async function listTransactionsPage(
    walletId: number,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType[]> {
    const executor = tx ?? db;
    return executor
      .select()
      .from(teacherTransaction)
      .where(eq(teacherTransaction.walletId, walletId))
      .orderBy(desc(teacherTransaction.id))
      .limit(limit)
      .offset(offset);
  }

  /**
   * Total ledger row count for one wallet — the pagination truth behind
   * the paged read (`hasMore` = offset + rows.length < count).
   *
   * @returns The number of ledger rows the wallet carries.
   */
  export async function countTransactions(walletId: number, tx?: DBTransaction): Promise<number> {
    const executor = tx ?? db;
    const rows = await executor
      .select({ total: sql<number>`count(*)::int` })
      .from(teacherTransaction)
      .where(eq(teacherTransaction.walletId, walletId));
    return rows[0]?.total ?? 0;
  }

  /**
   * Newest-first admin-audit page over one wallet's `teacher_transaction`
   * ledger with optional type/status/date-window filters — one-to-one
   * delegation to the admin module (same signature and behavior).
   *
   * @returns Up to `limit` ledger rows starting at `offset`, newest first.
   */
  export async function listTransactionsForAdmin(
    walletId: number,
    filters: Parameters<typeof walletRepositoryAdminImpl.listTransactionsForAdmin>[1],
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType[]> {
    return walletRepositoryAdminImpl.listTransactionsForAdmin(walletId, filters, limit, offset, tx);
  }

  /**
   * Count of the admin ledger view — the exact same predicate chain as
   * `listTransactionsForAdmin`.
   *
   * @returns The number of ledger rows the filtered page contains.
   */
  export async function countTransactionsForAdmin(
    walletId: number,
    filters: Parameters<typeof walletRepositoryAdminImpl.countTransactionsForAdmin>[1],
    tx?: DBTransaction
  ): Promise<number> {
    return walletRepositoryAdminImpl.countTransactionsForAdmin(walletId, filters, tx);
  }

  /**
   * Cold-path admin probe: the teacher's wallet row plus the teacher's
   * display identity, resolved in ONE joined read (`wallet.teacher_id`
   * shares the `teacher` PK with `users.id`, so the join chain is
   * wallet → teacher → users).
   *
   * @returns The probe row, or `null` when the teacher has no wallet.
   */
  export async function findAdminWalletProbe(
    teacherId: number,
    tx?: DBTransaction
  ): Promise<ReturnType<typeof walletRepositoryAdminImpl.findAdminWalletProbe>> {
    return walletRepositoryAdminImpl.findAdminWalletProbe(teacherId, tx);
  }

  /**
   * The pending-withdrawal settlement queue, oldest first (the
   * longest-waiting payout heads the queue per the settlement specs) —
   * one-to-one delegation to the admin module (same signature and
   * behavior).
   *
   * @returns Up to `limit` queue rows starting at `offset`, oldest first.
   */
  export async function listPendingWithdrawals(
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<ReturnType<typeof walletRepositoryAdminImpl.listPendingWithdrawals>> {
    return walletRepositoryAdminImpl.listPendingWithdrawals(limit, offset, tx);
  }

  /**
   * Count of the pending-withdrawal settlement queue — the exact same
   * predicate as `listPendingWithdrawals` (analytics-counter parity).
   *
   * @returns The number of pending withdrawal rows in the queue.
   */
  export async function countPendingWithdrawals(tx?: DBTransaction): Promise<number> {
    return walletRepositoryAdminImpl.countPendingWithdrawals(tx);
  }

  /**
   * Sum of the pending-withdrawal settlement queue amounts — the exact same
   * predicate as `listPendingWithdrawals` / `countPendingWithdrawals`
   * (analytics-counter parity), aggregated server-side as a decimal TEXT
   * string (money discipline: never a JS number).
   *
   * @returns The queue's total pending amount as a decimal string.
   */
  export async function sumPendingWithdrawals(tx?: DBTransaction): Promise<string> {
    return walletRepositoryAdminImpl.sumPendingWithdrawals(tx);
  }

  /**
   * Narrow settlement probe for one ledger row — identity, wallet link,
   * amount, and the type/status pair the settlement guard inspects. A
   * human-readable disambiguation read for tests and trigger verification;
   * never trusted for the write decision.
   *
   * @returns The probe, or `null` when no ledger row has that id.
   */
  export async function findSettlementProbe(
    transactionId: number,
    tx?: DBTransaction
  ): Promise<ReturnType<typeof walletRepositoryAdminImpl.findSettlementProbe>> {
    return walletRepositoryAdminImpl.findSettlementProbe(transactionId, tx);
  }

  /**
   * One guarded settlement — a single `UPDATE … WHERE id = ? AND type =
   * 'withdrawal' AND status = 'pending' … RETURNING` that flips the status
   * to `completed` or `failed` — one-to-one delegation to the admin module
   * (same signature and behavior).
   *
   * @returns The settled ledger row, or `null` when the row is missing,
   *     already settled, not a withdrawal, or `nextStatus` is not a
   *     permitted settlement target.
   */
  export async function settleWithdrawalOnce(
    insert: Parameters<typeof walletRepositoryAdminImpl.settleWithdrawalOnce>[0],
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType | null> {
    return walletRepositoryAdminImpl.settleWithdrawalOnce(insert, tx);
  }

  /**
   * Restores a withdrawal debit to the wallet balance — the compensating
   * half of a rejected payout, on the caller's transaction. The amount is a
   * decimal STRING bound verbatim (money discipline). The update is strictly
   * additive, so the `wallet_balance_check >= 0` CHECK cannot fire and no
   * lower guard exists.
   */
  export async function restoreWithdrawalDebitOnce(
    insert: Parameters<typeof walletRepositoryAdminImpl.restoreWithdrawalDebitOnce>[0],
    tx?: DBTransaction
  ): Promise<void> {
    return walletRepositoryAdminImpl.restoreWithdrawalDebitOnce(insert, tx);
  }

  /**
   * Credits a bonus to the wallet — the bonus slice, on the caller's
   * transaction: inserts ONE `bonus/completed` ledger row, then increments
   * the wallet's `balance` by the amount — one-to-one delegation to the
   * admin module (same signature and behavior).
   *
   * @returns The inserted ledger row.
   * @throws Error when the ledger INSERT somehow returns zero rows — the
   *     append invariant makes that unreachable, so it can only mean a
   *     broken driver contract (same contract as `creditEarningOnce`).
   */
  export async function creditBonusOnce(
    insert: Parameters<typeof walletRepositoryAdminImpl.creditBonusOnce>[0],
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType> {
    return walletRepositoryAdminImpl.creditBonusOnce(insert, tx);
  }

  /**
   * Manual debit adjustment — the admin-correction slice, on the caller's
   * transaction: inserts ONE `withdrawal/completed` ledger row (the
   * description carries the machine-distinguishable manual-adjustment
   * marker composed by the SERVICE), then debits the wallet `balance` via
   * ONE guarded UPDATE (`balance >= amount` in the predicate — the funds
   * guard, mirroring `debitForWithdrawalOnce`) — one-to-one delegation to
   * the admin module (same signature and behavior).
   *
   * @returns The inserted ledger row, or `null` when the guarded debit
   *     matched zero rows (insufficient funds — the caller classifies).
   */
  export async function debitAdjustmentOnce(
    insert: Parameters<typeof walletRepositoryAdminImpl.debitAdjustmentOnce>[0],
    tx?: DBTransaction
  ): Promise<TeacherTransactionSelectType | null> {
    return walletRepositoryAdminImpl.debitAdjustmentOnce(insert, tx);
  }
}
