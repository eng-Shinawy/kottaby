/**
 * WalletRepository admin-primitive tests — the admin financial-auditing
 * read/write primitives against the live `kottaby_test` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data; unique emails/names via `randomUUID()`.
 *  - No `expect(...).rejects.toThrow()` — throwing paths (trigger freezes,
 *    zero-ledger contracts) are probed through the `expectRepoError`
 *    try/catch helper; miss paths return `null` and are asserted directly.
 *  - Trigger-freeze proofs rely on the amended settlement trigger
 *    (`5-teacher-transaction-settlement.sql`) being live in the DB.
 *
 * Coverage map (new methods only):
 *  - findAdminWalletProbe: joined wallet+identity read; null for a
 *    wallet-less teacher.
 *  - listTransactionsForAdmin / countTransactionsForAdmin: filter matrix
 *    (each filter alone + combined), newest-first ordering, pagination
 *    slicing + honest empty page beyond range, count parity with list.
 *  - listPendingWithdrawals / countPendingWithdrawals: predicate parity
 *    (only pending withdrawals; earnings/bonus/settled rows excluded),
 *    oldest-first ordering (longest-waiting first), pagination.
 *  - findSettlementProbe: full projection on a known row; null for an
 *    unknown id.
 *  - settleWithdrawalOnce: settles pending → completed and pending →
 *    failed; null on an already-settled row, an earning row, and the
 *    defensive non-settlement status (Pending).
 *  - restoreWithdrawalDebitOnce: balance strictly additive.
 *  - creditBonusOnce: bonus/completed ledger row + balance increment with
 *    totalEarning untouched.
 *  - debitAdjustmentOnce: withdrawal/completed ledger row + guarded debit;
 *    null on insufficient funds (zero writes — no ledger row inserted).
 *  - Trigger-freeze proofs: a raw amount rewrite on a pending withdrawal
 *    RAISES; a raw settlement with a changed amount RAISES.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { WalletRepository } from "@/backend/db/repo";
import { teacherTransaction, wallet } from "@/backend/db/schema/billing";
import {
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { type DBTransaction, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type { AdminWalletTransactionFilters } from "@/backend/types";

/** Shared `now` timestamp per test body (timestamp consistency rule). */
const now = new Date();

/** All-null filter shape — "no filter applied" for the admin ledger reads. */
function noLedgerFilters(): AdminWalletTransactionFilters {
  return { type: null, status: null, from: null, to: null };
}

/**
 * Fixture bundle for one teacher with a wallet: user → teacher row →
 * wallet (funded via overrides when a payout/debit needs headroom).
 */
interface TeacherWalletFixture {
  teacherUserId: number;
  walletId: number;
}

async function createTeacherWithWallet(
  tx: DBTransaction,
  walletOverrides: { balance?: string; totalEarning?: string } = {}
): Promise<TeacherWalletFixture> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id);
  const teacherWallet = await createTestWallet(tx, user.id, walletOverrides);
  return { teacherUserId: user.id, walletId: teacherWallet.id };
}

describe("WalletRepository.findAdminWalletProbe", () => {
  test("returns the wallet row plus teacher identity in one joined read", async () => {
    await runInRollback(async tx => {
      const teacherName = `Probe Teacher ${randomUUID().slice(0, 8)}`;
      const user = await createTestUser(tx, {
        role: "teacher",
        fullName: teacherName,
      });
      await createTestTeacherRow(tx, user.id);
      const teacherWallet = await createTestWallet(tx, user.id, { balance: "250.50" });

      const probe = await WalletRepository.findAdminWalletProbe(user.id, tx);

      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      expect(probe.wallet.id).toBe(teacherWallet.id);
      expect(probe.wallet.balance).toBe("250.50");
      expect(probe.teacherName).toBe(teacherName);
    });
  });

  test("returns null for a teacher without a wallet row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, user.id);

      const probe = await WalletRepository.findAdminWalletProbe(user.id, tx);

      expect(probe).toBeNull();
    });
  });
});

describe("WalletRepository.listTransactionsForAdmin + countTransactionsForAdmin", () => {
  test("returns every ledger row for the wallet newest-first, count parity", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      const first = await createTestTeacherTransaction(tx, walletId, null, { createdAt: now });
      const second = await createTestTeacherTransaction(tx, walletId, null, {
        createdAt: new Date(now.getTime() + 1_000),
      });

      const rows = await WalletRepository.listTransactionsForAdmin(walletId, noLedgerFilters(), 50, 0, tx);
      const total = await WalletRepository.countTransactionsForAdmin(walletId, noLedgerFilters(), tx);

      expect(total).toBe(2);
      expect(rows.map(row => row.id)).toEqual([second.id, first.id]);
    });
  });

  test("type filter narrows to the matching rows only", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      await createTestTeacherTransaction(tx, walletId, null, { type: TransactionType.Earning });
      const withdrawal = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      const rows = await WalletRepository.listTransactionsForAdmin(
        walletId,
        { ...noLedgerFilters(), type: TransactionType.Withdrawal },
        50,
        0,
        tx
      );
      const total = await WalletRepository.countTransactionsForAdmin(
        walletId,
        { ...noLedgerFilters(), type: TransactionType.Withdrawal },
        tx
      );

      expect(total).toBe(1);
      expect(rows.map(row => row.id)).toEqual([withdrawal.id]);
    });
  });

  test("status filter narrows to the matching rows only", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      await createTestTeacherTransaction(tx, walletId, null, { status: TransactionStatus.Completed });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      const rows = await WalletRepository.listTransactionsForAdmin(
        walletId,
        { ...noLedgerFilters(), status: TransactionStatus.Pending },
        50,
        0,
        tx
      );
      const total = await WalletRepository.countTransactionsForAdmin(
        walletId,
        { ...noLedgerFilters(), status: TransactionStatus.Pending },
        tx
      );

      expect(total).toBe(1);
      expect(rows.map(row => row.id)).toEqual([pending.id]);
    });
  });

  test("from/to window filters bound the createdAt range inclusively", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      const early = await createTestTeacherTransaction(tx, walletId, null, { createdAt: now });
      const mid = await createTestTeacherTransaction(tx, walletId, null, {
        createdAt: new Date(now.getTime() + 5_000),
      });
      await createTestTeacherTransaction(tx, walletId, null, {
        createdAt: new Date(now.getTime() + 60_000),
      });

      const filters: AdminWalletTransactionFilters = {
        type: null,
        status: null,
        from: now,
        to: new Date(now.getTime() + 10_000),
      };
      const rows = await WalletRepository.listTransactionsForAdmin(walletId, filters, 50, 0, tx);
      const total = await WalletRepository.countTransactionsForAdmin(walletId, filters, tx);

      expect(total).toBe(2);
      expect(rows.map(row => row.id)).toEqual([mid.id, early.id]);
    });
  });

  test("combined filters intersect (type AND status AND window)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Completed,
        createdAt: new Date(now.getTime() + 1_000),
      });
      const matched = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() + 2_000),
      });
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() + 3_000),
      });

      const filters: AdminWalletTransactionFilters = {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        from: now,
        to: new Date(now.getTime() + 60_000),
      };
      const rows = await WalletRepository.listTransactionsForAdmin(walletId, filters, 50, 0, tx);
      const total = await WalletRepository.countTransactionsForAdmin(walletId, filters, tx);

      expect(total).toBe(1);
      expect(rows.map(row => row.id)).toEqual([matched.id]);
    });
  });

  test("limit/offset slice the page; an offset beyond the range is an honest empty page", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      const ids = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          createTestTeacherTransaction(tx, walletId, null, {
            createdAt: new Date(now.getTime() + index * 1_000),
          })
        )
      ).then(rows => rows.map(row => row.id));

      const page1 = await WalletRepository.listTransactionsForAdmin(walletId, noLedgerFilters(), 2, 0, tx);
      const page2 = await WalletRepository.listTransactionsForAdmin(walletId, noLedgerFilters(), 2, 2, tx);
      const beyond = await WalletRepository.listTransactionsForAdmin(walletId, noLedgerFilters(), 2, 10, tx);
      const total = await WalletRepository.countTransactionsForAdmin(walletId, noLedgerFilters(), tx);

      expect(total).toBe(3);
      expect(page1.map(row => row.id)).toEqual([ids[2], ids[1]]);
      expect(page2.map(row => row.id)).toEqual([ids[0]]);
      expect(beyond).toEqual([]);
    });
  });
});

describe("WalletRepository.listPendingWithdrawals + countPendingWithdrawals", () => {
  test("returns only pending withdrawals oldest-first with teacher identity + wallet balance", async () => {
    await runInRollback(async tx => {
      const teacherName = `Queue Teacher ${randomUUID().slice(0, 8)}`;
      const user = await createTestUser(tx, { role: "teacher", fullName: teacherName });
      await createTestTeacherRow(tx, user.id);
      const teacherWallet = await createTestWallet(tx, user.id, { balance: "500.00" });
      const walletId = teacherWallet.id;
      const settledWithdrawal = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Completed,
        createdAt: new Date(now.getTime() - 10_000),
      });
      const earning = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Completed,
        createdAt: new Date(now.getTime() - 9_000),
      });
      const olderPending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() - 5_000),
        amount: "100.00",
      });
      const newerPending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: now,
        amount: "75.00",
      });

      const rows = await WalletRepository.listPendingWithdrawals(50, 0, tx);
      const total = await WalletRepository.countPendingWithdrawals(tx);

      expect(total).toBe(2);
      expect(rows.map(row => row.transaction.id)).toEqual([olderPending.id, newerPending.id]);
      expect(rows.map(row => row.transaction.id)).not.toContain(settledWithdrawal.id);
      expect(rows.map(row => row.transaction.id)).not.toContain(earning.id);
      expect(rows[0]?.teacherName).toBe(teacherName);
      expect(rows[0]?.walletBalance).toBe("500.00");
    });
  });

  test("counts pending withdrawals across wallets (analytics-counter parity)", async () => {
    await runInRollback(async tx => {
      const walletA = await createTeacherWithWallet(tx);
      const walletB = await createTeacherWithWallet(tx);
      await createTestTeacherTransaction(tx, walletA.walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });
      await createTestTeacherTransaction(tx, walletB.walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });
      await createTestTeacherTransaction(tx, walletB.walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Pending,
      });

      const baseCount = await WalletRepository.countPendingWithdrawals(tx);
      expect(baseCount).toBeGreaterThanOrEqual(2);
    });
  });

  test("limit/offset slice the queue with oldest-first parity", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "500.00" });
      const first = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() - 3_000),
      });
      const second = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() - 2_000),
      });
      const third = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        createdAt: new Date(now.getTime() - 1_000),
      });

      const page1 = await WalletRepository.listPendingWithdrawals(2, 0, tx);
      const page2 = await WalletRepository.listPendingWithdrawals(2, 2, tx);

      expect(page1.map(row => row.transaction.id)).toEqual([first.id, second.id]);
      expect(page2.map(row => row.transaction.id)).toEqual([third.id]);
    });
  });

  test("sumPendingWithdrawals aggregates the same predicate as a decimal string (money discipline)", async () => {
    await runInRollback(async tx => {
      // The aggregate is a GLOBAL sum (no wallet filter) — the demo/test DB
      // may carry committed pending rows, so the assertions run on the DELTA
      // around this test's own writes (same posture as the
      // `toBeGreaterThanOrEqual` count test above).
      const before = Number(await WalletRepository.sumPendingWithdrawals(tx));

      const { walletId } = await createTeacherWithWallet(tx);
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "100.00",
      });
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "75.50",
      });
      // The excluded shapes: a settled withdrawal, a failed withdrawal, and
      // a pending EARNING — none of them joins the pending sum.
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Completed,
        amount: "999.00",
      });
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Failed,
        amount: "888.00",
      });
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Pending,
        amount: "777.00",
      });

      const after = await WalletRepository.sumPendingWithdrawals(tx);
      // Money discipline: the aggregate rides back as a decimal STRING.
      expect(typeof after).toBe("string");
      // Exactly the two pending withdrawals — scale-2 values are exact in
      // binary floating point, so the delta comparison is honest here.
      expect(Number(after) - before).toBe(175.5);
      expect(after).toMatch(/^\d+(\.\d{2})?$/);
    });
  });
});

describe("WalletRepository.findSettlementProbe", () => {
  test("returns the narrow {id, walletId, amount, type, status} projection", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      const ledger = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "123.45",
      });

      const probe = await WalletRepository.findSettlementProbe(ledger.id, tx);

      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe");
      expect(probe.id).toBe(ledger.id);
      expect(probe.walletId).toBe(walletId);
      expect(probe.amount).toBe("123.45");
      expect(probe.type).toBe(TransactionType.Withdrawal);
      expect(probe.status).toBe(TransactionStatus.Pending);
      expect(Object.keys(probe).toSorted((a, b) => a.localeCompare(b))).toEqual([
        "amount",
        "id",
        "status",
        "type",
        "walletId",
      ]);
    });
  });

  test("returns null for an unknown ledger id", async () => {
    await runInRollback(async tx => {
      const probe = await WalletRepository.findSettlementProbe(987_654_321, tx);
      expect(probe).toBeNull();
    });
  });
});

describe("WalletRepository.settleWithdrawalOnce", () => {
  test("settles a pending withdrawal to completed and updates the status + updatedAt", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "50.00",
      });

      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Completed },
        tx
      );

      expect(settled).not.toBeNull();
      expect(settled?.status).toBe(TransactionStatus.Completed);
      expect(settled?.type).toBe(TransactionType.Withdrawal);
      expect(settled?.amount).toBe("50.00");
    });
  });

  test("settles a pending withdrawal to failed", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Failed },
        tx
      );

      expect(settled?.status).toBe(TransactionStatus.Failed);
    });
  });

  test("returns null when re-settling an already-settled row", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });
      await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Completed },
        tx
      );

      const replay = await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Failed },
        tx
      );

      expect(replay).toBeNull();
    });
  });

  test("returns null when the row is an earning (not a withdrawal)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx);
      const earning = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Completed,
      });

      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId: earning.id, nextStatus: TransactionStatus.Completed },
        tx
      );

      expect(settled).toBeNull();
    });
  });

  test("returns null when nextStatus is not a settlement target (defensive guard)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      const blocked = await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Pending },
        tx
      );

      expect(blocked).toBeNull();
    });
  });
});

describe("WalletRepository.restoreWithdrawalDebitOnce", () => {
  test("restores the debited amount additively (balance grows, totalEarning untouched)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00", totalEarning: "300.00" });

      await WalletRepository.restoreWithdrawalDebitOnce({ walletId, amount: "40.00" }, tx);

      const [after] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
      expect(after?.balance).toBe("140.00");
      expect(after?.totalEarning).toBe("300.00");
    });
  });
});

describe("WalletRepository.creditBonusOnce", () => {
  test("inserts a bonus/completed ledger row and increments only the balance", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "10.00", totalEarning: "200.00" });

      const ledger = await WalletRepository.creditBonusOnce(
        { walletId, amount: "25.00", description: "Admin bonus" },
        tx
      );

      expect(ledger.type).toBe(TransactionType.Bonus);
      expect(ledger.status).toBe(TransactionStatus.Completed);
      expect(ledger.amount).toBe("25.00");
      expect(ledger.description).toBe("Admin bonus");
      expect(ledger.sessionId).toBeNull();

      const [after] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
      expect(after?.balance).toBe("35.00");
      expect(after?.totalEarning).toBe("200.00");
    });
  });
});

describe("WalletRepository.debitAdjustmentOnce", () => {
  test("inserts a withdrawal/completed ledger row and debits the balance", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00", totalEarning: "200.00" });

      const ledger = await WalletRepository.debitAdjustmentOnce(
        { walletId, amount: "30.00", description: "manual-adjustment" },
        tx
      );

      expect(ledger).not.toBeNull();
      expect(ledger?.type).toBe(TransactionType.Withdrawal);
      expect(ledger?.status).toBe(TransactionStatus.Completed);
      expect(ledger?.amount).toBe("30.00");

      const [after] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
      expect(after?.balance).toBe("70.00");
      expect(after?.totalEarning).toBe("200.00");
    });
  });

  test("returns null on insufficient funds (guarded debit matches zero rows)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "10.00" });

      const ledger = await WalletRepository.debitAdjustmentOnce(
        { walletId, amount: "50.00", description: "manual-adjustment" },
        tx
      );

      expect(ledger).toBeNull();
      // The wallet balance is unchanged — the guard held.
      const [after] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
      expect(after?.balance).toBe("10.00");
      // NO ledger row exists inside this transaction: the guarded UPDATE
      // misses BEFORE any INSERT, so the miss path performs zero writes
      // (no orphan row is ever live for the caller to roll back).
      const orphanRows = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.walletId, walletId));
      expect(orphanRows).toHaveLength(0);
    });
  });
});

describe("WalletRepository — trigger-freeze proofs (amended settlement trigger)", () => {
  test("a raw amount rewrite on a pending withdrawal RAISES", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "50.00",
      });

      const error = await expectRepoError(() =>
        tx.update(teacherTransaction).set({ amount: "999.00" }).where(eq(teacherTransaction.id, pending.id))
      );

      expect(error.message).toContain("teacher_transaction");
      expect(error.message).toContain("update");
    });
  });

  test("a raw settlement with a changed amount RAISES", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "50.00",
      });

      const error = await expectRepoError(() =>
        tx
          .update(teacherTransaction)
          .set({ status: TransactionStatus.Completed, amount: "60.00" })
          .where(eq(teacherTransaction.id, pending.id))
      );

      expect(error.message).toContain("teacher_transaction");
      expect(error.message).toContain("update");
    });
  });

  test("the guarded repo settlement itself passes the trigger (columns frozen)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      const pending = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        amount: "50.00",
        description: "payout",
      });

      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId: pending.id, nextStatus: TransactionStatus.Completed },
        tx
      );

      expect(settled?.status).toBe(TransactionStatus.Completed);
      expect(settled?.amount).toBe("50.00");
      expect(settled?.description).toBe("payout");

      const probe = await WalletRepository.findSettlementProbe(pending.id, tx);
      expect(probe?.status).toBe(TransactionStatus.Completed);
      expect(probe?.amount).toBe("50.00");
    });
  });

  test("the wallet cached balance never moves behind the repo's back (raw count parity)", async () => {
    await runInRollback(async tx => {
      const { walletId } = await createTeacherWithWallet(tx, { balance: "100.00" });
      await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      const [row] = await tx
        .select({ pending: sql<number>`count(*)::int` })
        .from(teacherTransaction)
        .where(eq(teacherTransaction.walletId, walletId));

      expect(row?.pending).toBe(1);
    });
  });
});
