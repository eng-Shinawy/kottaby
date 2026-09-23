/**
 * WalletRepository admin-scoped primitives — the module-scope admin read
 * methods (ledger page + count, pending-withdrawal queue + count, wallet and
 * settlement probes) and the admin write primitives (guarded settlement,
 * withdrawal-debit restore, bonus credit, manual debit adjustment),
 * extracted VERBATIM from `wallet.repository.ts` (behavior-identical
 * extraction; zero logic change). The public surface stays the
 * `WalletRepository` namespace in `wallet.repository.ts`: the methods below
 * back the namespace's admin members as one-to-one delegation targets, and
 * the manual debit adjustment delegates to the shared `debitWithLedgerRow`
 * writer in `wallet.repository.shared-writer.ts`. Nothing in this module is
 * part of the public API.
 *
 * Conventions carried over unchanged (per `backend/db/repo/AGENTS.md`,
 * mirroring `SessionRepository`):
 *  - Every function takes `tx?: DBTransaction` as its LAST parameter; writes
 *    execute on `tx ?? db`.
 *  - NO prepared statements, NO business logic, NO permission checks, NO
 *    i18n or logging imports — the caller decides what every result means.
 *  - Financial vocabulary is carried by the `TransactionType` /
 *    `TransactionStatus` enum members, never string literals.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { debitWithLedgerRow } from "@/backend/db/repo/billing/wallet.repository.shared-writer";
import { teacherTransaction, wallet } from "@/backend/db/schema/billing";
import type { transactionStatus, transactionType } from "@/backend/db/schema/enums";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type {
  AdminTeacherWalletProbe,
  AdminWalletTransactionFilters,
  AdminWithdrawalQueueRow,
  DBTransaction,
  TeacherTransactionSelectType,
  WithdrawalSettlementProbe,
} from "@/backend/types";

/**
 * The raw pgEnum string-literal unions carried by the `$inferSelect` projection.
 */
type PgTransactionType = (typeof transactionType)["enumValues"][number];
type PgTransactionStatus = (typeof transactionStatus)["enumValues"][number];

/**
 * The map arms from the raw pgEnum string-literal unions to the canonical
 * TS enums (lexically identical values). `Record` over the union makes the
 * mapping exhaustive over the KEYS — a schema/pgEnum change that adds or
 * renames a value fails the type check here instead of slipping through at
 * runtime — while the `| undefined` VALUES keep the fail-closed miss guard
 * type-sound (the pgEnum constraint makes it unreachable at runtime).
 */
const TRANSACTION_TYPE_BY_PG_VALUE: Record<PgTransactionType, TransactionType | undefined> = {
  earning: TransactionType.Earning,
  withdrawal: TransactionType.Withdrawal,
  bonus: TransactionType.Bonus,
  arbitration_reversal: TransactionType.ArbitrationReversal,
};

const TRANSACTION_STATUS_BY_PG_VALUE: Record<PgTransactionStatus, TransactionStatus | undefined> = {
  pending: TransactionStatus.Pending,
  completed: TransactionStatus.Completed,
  failed: TransactionStatus.Failed,
};

/**
 * Builds the ANDed predicate chain from the normalized admin ledger
 * filters: the wallet scope plus the optional type/status/date-window
 * members. Absent or null members are skipped; the `and(...)` spread over
 * the non-empty conditions always yields a defined SQL node.
 */
function buildAdminLedgerFilterChain(walletId: number, filters: AdminWalletTransactionFilters) {
  const conditions = [eq(teacherTransaction.walletId, walletId)];
  if (filters.type !== null) {
    conditions.push(eq(teacherTransaction.type, filters.type));
  }
  if (filters.status !== null) {
    conditions.push(eq(teacherTransaction.status, filters.status));
  }
  if (filters.from !== null) {
    conditions.push(gte(teacherTransaction.createdAt, filters.from));
  }
  if (filters.to !== null) {
    conditions.push(lte(teacherTransaction.createdAt, filters.to));
  }
  return and(...conditions);
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
): Promise<AdminTeacherWalletProbe | null> {
  const executor = tx ?? db;
  const rows = await executor
    .select({
      wallet: wallet,
      teacherName: users.fullName,
    })
    .from(wallet)
    .innerJoin(teacher, eq(teacher.id, wallet.teacherId))
    .innerJoin(users, eq(users.id, teacher.id))
    .where(eq(wallet.teacherId, teacherId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Newest-first admin-audit page over one wallet's `teacher_transaction`
 * ledger with optional type/status/date-window filters. A plain Drizzle
 * select on `tx ?? db` — the service always calls this inside its
 * transaction.
 *
 * @returns Up to `limit` ledger rows starting at `offset`, newest first.
 */
export async function listTransactionsForAdmin(
  walletId: number,
  filters: AdminWalletTransactionFilters,
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<TeacherTransactionSelectType[]> {
  const executor = tx ?? db;
  return executor
    .select()
    .from(teacherTransaction)
    .where(buildAdminLedgerFilterChain(walletId, filters))
    .orderBy(desc(teacherTransaction.id))
    .limit(limit)
    .offset(offset);
}

/**
 * Count of the admin ledger view — the exact same predicate chain as
 * `listTransactionsForAdmin`.
 *
 * @returns The number of ledger rows the filtered page contains.
 */
export async function countTransactionsForAdmin(
  walletId: number,
  filters: AdminWalletTransactionFilters,
  tx?: DBTransaction
): Promise<number> {
  const executor = tx ?? db;
  const rows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(teacherTransaction)
    .where(buildAdminLedgerFilterChain(walletId, filters));
  return rows[0]?.total ?? 0;
}

/**
 * The pending-withdrawal settlement queue, oldest first (the
 * longest-waiting payout heads the queue per the settlement specs):
 * ordered by `createdAt` ascending with `id` as the stable tie-breaker,
 * so a backfilled withdrawal with an older `createdAt` cannot be
 * stranded behind newer insertion-order rows. The
 * predicate is EXACT parity with the analytics counter
 * (`type = withdrawal AND status = pending`). Each row carries the
 * teacher's display name and the wallet's current balance (decimal
 * string) via the wallet → teacher → users join chain.
 *
 * @returns Up to `limit` queue rows starting at `offset`, oldest first.
 */
export async function listPendingWithdrawals(
  limit: number,
  offset: number,
  tx?: DBTransaction
): Promise<AdminWithdrawalQueueRow[]> {
  const executor = tx ?? db;
  return executor
    .select({
      transaction: teacherTransaction,
      teacherName: users.fullName,
      walletBalance: wallet.balance,
    })
    .from(teacherTransaction)
    .innerJoin(wallet, eq(wallet.id, teacherTransaction.walletId))
    .innerJoin(teacher, eq(teacher.id, wallet.teacherId))
    .innerJoin(users, eq(users.id, teacher.id))
    .where(
      and(
        eq(teacherTransaction.type, TransactionType.Withdrawal),
        eq(teacherTransaction.status, TransactionStatus.Pending)
      )
    )
    .orderBy(teacherTransaction.createdAt, teacherTransaction.id)
    .limit(limit)
    .offset(offset);
}

/**
 * Count of the pending-withdrawal settlement queue — the exact same
 * predicate as `listPendingWithdrawals` (analytics-counter parity).
 *
 * @returns The number of pending withdrawal rows in the queue.
 */
export async function countPendingWithdrawals(tx?: DBTransaction): Promise<number> {
  const executor = tx ?? db;
  const rows = await executor
    .select({ total: sql<number>`count(*)::int` })
    .from(teacherTransaction)
    .where(
      and(
        eq(teacherTransaction.type, TransactionType.Withdrawal),
        eq(teacherTransaction.status, TransactionStatus.Pending)
      )
    );
  return rows[0]?.total ?? 0;
}

/**
 * Sum of the pending-withdrawal settlement queue amounts — the exact same
 * predicate as `listPendingWithdrawals` / `countPendingWithdrawals`
 * (analytics-counter parity), aggregated server-side so the admin queue
 * header can render the payout total for ANY queue size (the round-4
 * feature: the client previously summed only the current page, which the
 * financial-copy honesty rule then had to hide for multi-page queues).
 * Money discipline: the decimal SUM rides back as a TEXT decimal string —
 * never a JS number.
 *
 * @returns The queue's total pending amount as a decimal string (`"0"` when
 *   the queue is empty — COALESCE, never null).
 */
export async function sumPendingWithdrawals(tx?: DBTransaction): Promise<string> {
  const executor = tx ?? db;
  const rows = await executor
    .select({ total: sql<string>`coalesce(sum(${teacherTransaction.amount}), 0)::text` })
    .from(teacherTransaction)
    .where(
      and(
        eq(teacherTransaction.type, TransactionType.Withdrawal),
        eq(teacherTransaction.status, TransactionStatus.Pending)
      )
    );
  return rows[0]?.total ?? "0";
}

/**
 * Narrows the raw `$inferSelect` pgEnum string-literal unions to the
 * canonical TS enums via the exhaustive map arms above (lexically identical
 * values — the same pure type-level narrowing the payment repository's
 * admin row mapper performs). An unrecognized value is a hard error, never
 * a silent fallback — the pgEnum constraint makes it unreachable, so
 * reaching it means a broken schema contract that must surface loudly.
 */
function toTransactionTypeEnum(type: PgTransactionType): TransactionType {
  const mapped = TRANSACTION_TYPE_BY_PG_VALUE[type];
  if (mapped === undefined) {
    throw new Error(
      `WalletRepository: unrecognized teacher_transaction.type value ${JSON.stringify(type)} — the pgEnum constraint makes this unreachable`
    );
  }
  return mapped;
}

function toTransactionStatusEnum(status: PgTransactionStatus): TransactionStatus {
  const mapped = TRANSACTION_STATUS_BY_PG_VALUE[status];
  if (mapped === undefined) {
    throw new Error(
      `WalletRepository: unrecognized teacher_transaction.status value ${JSON.stringify(status)} — the pgEnum constraint makes this unreachable`
    );
  }
  return mapped;
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
): Promise<WithdrawalSettlementProbe | null> {
  const executor = tx ?? db;
  const rows = await executor
    .select({
      id: teacherTransaction.id,
      walletId: teacherTransaction.walletId,
      amount: teacherTransaction.amount,
      type: teacherTransaction.type,
      status: teacherTransaction.status,
    })
    .from(teacherTransaction)
    .where(eq(teacherTransaction.id, transactionId))
    .limit(1);
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    walletId: row.walletId,
    amount: row.amount,
    type: toTransactionTypeEnum(row.type),
    status: toTransactionStatusEnum(row.status),
  };
}

/**
 * One guarded settlement — a single `UPDATE … WHERE id = ? AND type =
 * 'withdrawal' AND status = 'pending' … RETURNING` that flips the status
 * to `completed` or `failed`. The pending predicate is the concurrency
 * lock: a replayed settlement matches zero rows. Every frozen column is
 * unchanged (the amended DB trigger independently re-verifies the freeze
 * and re-raises on any other mutation). `nextStatus` is validated by the
 * CALLER to be `completed | failed`; the repo also defends: any other
 * member returns `null` without touching the row (the repo has no i18n
 * to explain a rejection).
 *
 * @returns The settled ledger row, or `null` when the row is missing,
 *     already settled, not a withdrawal, or `nextStatus` is not a
 *     permitted settlement target.
 */
export async function settleWithdrawalOnce(
  insert: { readonly transactionId: number; readonly nextStatus: TransactionStatus },
  tx?: DBTransaction
): Promise<TeacherTransactionSelectType | null> {
  if (insert.nextStatus !== TransactionStatus.Completed && insert.nextStatus !== TransactionStatus.Failed) {
    return null;
  }
  const executor = tx ?? db;
  const rows = await executor
    .update(teacherTransaction)
    .set({ status: insert.nextStatus, updatedAt: new Date() })
    .where(
      and(
        eq(teacherTransaction.id, insert.transactionId),
        eq(teacherTransaction.type, TransactionType.Withdrawal),
        eq(teacherTransaction.status, TransactionStatus.Pending)
      )
    )
    .returning();
  return rows[0] ?? null;
}

/**
 * Restores a withdrawal debit to the wallet balance — the compensating
 * half of a rejected payout, on the caller's transaction. The amount is a
 * decimal STRING bound verbatim (money discipline). The update is strictly
 * additive, so the `wallet_balance_check >= 0` CHECK cannot fire and no
 * lower guard exists.
 */
export async function restoreWithdrawalDebitOnce(
  insert: { readonly walletId: number; readonly amount: string },
  tx?: DBTransaction
): Promise<void> {
  const executor = tx ?? db;
  await executor
    .update(wallet)
    .set({ balance: sql`${wallet.balance} + ${insert.amount}`, updatedAt: new Date() })
    .where(eq(wallet.id, insert.walletId));
}

/**
 * Credits a bonus to the wallet — the bonus slice, on the caller's
 * transaction: inserts ONE `bonus/completed` ledger row, then increments
 * the wallet's `balance` by the amount. `total_earning` is deliberately
 * untouched (a bonus is not lifetime teaching earnings — the same
 * discipline as the withdrawal debit). The increment is strictly
 * additive, so the `>= 0` CHECK constraints hold.
 *
 * @returns The inserted ledger row.
 * @throws Error when the ledger INSERT somehow returns zero rows — the
 *     append invariant makes that unreachable, so it can only mean a
 *     broken driver contract (same contract as `creditEarningOnce`).
 */
export async function creditBonusOnce(
  insert: { readonly walletId: number; readonly amount: string; readonly description: string },
  tx?: DBTransaction
): Promise<TeacherTransactionSelectType> {
  const executor = tx ?? db;
  const ledgerRows = await executor
    .insert(teacherTransaction)
    .values({
      walletId: insert.walletId,
      sessionId: null,
      description: insert.description,
      amount: insert.amount,
      type: TransactionType.Bonus,
      status: TransactionStatus.Completed,
    })
    .returning();
  const ledger = ledgerRows[0];
  if (!ledger) {
    throw new Error("WalletRepository.creditBonusOnce: ledger INSERT returned zero rows");
  }
  await executor
    .update(wallet)
    .set({
      balance: sql`${wallet.balance} + ${insert.amount}`,
      updatedAt: new Date(),
    })
    .where(eq(wallet.id, insert.walletId));
  return ledger;
}

/**
 * Manual debit adjustment — the admin-correction slice, on the caller's
 * transaction: inserts ONE `withdrawal/completed` ledger row (the
 * description carries the machine-distinguishable manual-adjustment
 * marker composed by the SERVICE), then debits the wallet `balance` via
 * ONE guarded UPDATE (`balance >= amount` in the predicate — the funds
 * guard, mirroring `debitForWithdrawalOnce`). Unlike the withdrawal debit
 * the ledger row lands FIRST at `completed` status: if the guarded debit
 * misses, the `null` return makes the caller classify the miss, and the
 * caller's transaction rollback removes the ledger row (everything
 * composes inside one tx).
 *
 * @returns The inserted ledger row, or `null` when the guarded debit
 *     matched zero rows (insufficient funds — the caller classifies).
 */
export async function debitAdjustmentOnce(
  insert: { readonly walletId: number; readonly amount: string; readonly description: string },
  tx?: DBTransaction
): Promise<TeacherTransactionSelectType | null> {
  return debitWithLedgerRow(insert, TransactionStatus.Completed, "WalletRepository.debitAdjustmentOnce", tx);
}
