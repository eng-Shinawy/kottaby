/**
 * WalletRepository tests — the teacher `wallet` table's data-access layer
 * (`ensureWalletOnce`, `creditEarningOnce`, `findByTeacherId`,
 * `listTransactionsByWalletId`, `debitForWithdrawalOnce`,
 * `listRecentTransactions`) against the live `kottaby_test` PostgreSQL
 * instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    every method under test `tx` is the LAST parameter).
 *  - Entities are created ONLY via `entity-setup.ts` helpers — never seed
 *    data; count assertions are scoped to fixture ids.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket so the outer
 *    transaction stays queryable.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every method's hit branch returns the row or
 *    projection; the cold-path miss (`findByTeacherId` for an absent
 *    teacher) returns null; the guarded withdrawal debit's miss (zero rows
 *    matched) returns null and commits ZERO writes — the guarded UPDATE
 *    runs before the ledger INSERT, so no pending withdrawal row is ever
 *    live inside the caller's transaction.
 *  - Tier 2 (boundaries): `ensureWalletOnce` idempotent re-enter (exactly
 *    one wallet row per teacher); additive credit increments with verbatim
 *    decimal-string fidelity ("25.00" + "12.50" → "37.50"); the exact
 *    withdrawal boundary (balance == amount lands on "0.00"); the ledger
 *    page limit and newest-first (`id DESC`) ordering.
 *  - Tier 4 (security/static): CHECK constraint probes — a direct negative
 *    balance / total_earning write and a direct negative ledger amount
 *    insert are each rejected by their named CHECK constraint inside a
 *    savepoint bracket; namespace-closure pin (exactly the documented
 *    method surface, no update/delete primitive for the append-only ledger); the
 *    defensive zero-row INSERT guards exercised through a typed executor
 *    stub (unreachable through a live PostgreSQL INSERT ... RETURNING).
 *
 * Money discipline mirrors the production code: amounts are decimal STRINGS
 * end-to-end; the suite performs NO numeric arithmetic on money values —
 * every balance oracle is an exact string read-back.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { WalletRepository } from "@/backend/db/repo";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestSession,
  createTestStudent,
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import {
  expectUniqueViolation,
  probeInsideSavepoint,
} from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import type { DBTransaction, SessionSelectType, TeacherTransactionSelectType, WalletSelectType } from "@/backend/types";
import { withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";

/** PostgreSQL error code for `check_violation`. */
const PG_CHECK_VIOLATION = "23514";

/**
 * Shared-PK fixture: one certified teacher (users row + teachers role-child
 * row with the shared primary key).
 *
 * @returns The teacher id (shared across `users` and `teachers`).
 */
async function createTeacherFixture(tx: DBTransaction): Promise<number> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  return teacherUser.id;
}

/**
 * Fixture session between a fresh student and the given teacher — the
 * `teacher_transaction.session_id` FK target for earning credits.
 *
 * @returns The session id.
 */
async function createSessionFixture(tx: DBTransaction, teacherId: number): Promise<number> {
  const studentUser = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, studentUser.id);
  const sessionRow = await createTestSession(tx, teacherId, student.id);
  return sessionRow.id;
}

/** Read-back oracle: the wallet row straight off the table. */
async function readWallet(tx: DBTransaction, walletId: number): Promise<WalletSelectType> {
  const [row] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
  if (!row) {
    throw new Error(`readWallet: expected wallet ${walletId} to exist`);
  }
  return row;
}

/**
 * Ledger row count scoped to ONE wallet (never a global table count —
 * pre-existing data must not break the assertion).
 */
async function countLedgerRows(tx: DBTransaction, walletId: number): Promise<number> {
  const [row] = await tx
    .select({ ledgerCount: sql<number>`count(*)::int` })
    .from(teacherTransaction)
    .where(eq(teacherTransaction.walletId, walletId));
  return row?.ledgerCount ?? 0;
}

/** An integer teacher id that cannot exist as a `teachers` row in this transaction. */
async function absentTeacherId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${teacher.id}), 0)::int` }).from(teacher);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Inserts `count` settled earning ledger rows sequentially — the rows share
 * one transaction connection, so parallel inserts would serialize on it
 * anyway and sequential ordering keeps the id sequence deterministic.
 *
 * @returns The inserted rows in insertion (ascending id) order.
 */
async function insertLedgerRows(
  tx: DBTransaction,
  walletId: number,
  count: number
): Promise<TeacherTransactionSelectType[]> {
  const rows: TeacherTransactionSelectType[] = [];
  const insertNext = async (index: number): Promise<void> => {
    if (index >= count) {
      return;
    }
    rows.push(await createTestTeacherTransaction(tx, walletId, null, { amount: `${index + 1}.00` }));
    await insertNext(index + 1);
  };
  await insertNext(0);
  return rows;
}

/**
 * Walks the Drizzle error cause chain (cycle-safe) for the original
 * PostgreSQL SQLSTATE code — Drizzle masks driver errors behind a generic
 * "failed query" message.
 */

/**
 * Walks the same cause chain searching for an `Error.message` containing
 * the given substring — the PostgreSQL diagnostic that names the rejecting
 * constraint is reachable only through the chain.
 */
function causeChainContainsMessage(error: unknown, substring: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (typeof current.message === "string" && current.message.includes(substring)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Type guard for the zero-row INSERT stub: it claims the single `insert`
 * seam the defensive guards consume (a live `DBTransaction` shape is never
 * structurally checked here — the guards only ever call `insert`).
 */
function isZeroRowInsertStub(value: unknown): value is DBTransaction {
  return typeof value === "object" && value !== null && "insert" in value;
}

/**
 * Typed executor stub whose `insert(...).values(...).returning()` resolves
 * to zero rows (and whose guarded debit UPDATE succeeds with one returned
 * row, so the debit writer's UPDATE-first flow reaches the ledger INSERT).
 * A live PostgreSQL INSERT ... RETURNING always yields one row per inserted
 * tuple, so the repositories' defensive zero-row guards cannot be reached
 * through the database — the stub exercises those guards without touching a
 * connection (no rollback wrap is needed).
 */
function zeroReturningExecutor(): DBTransaction {
  const stub = {
    insert: () => ({
      values: () => ({
        returning: async (): Promise<TeacherTransactionSelectType[]> => [],
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: async (): Promise<{ id: number }[]> => [{ id: 1 }],
        }),
      }),
    }),
  };
  if (!isZeroRowInsertStub(stub)) {
    throw new Error("zeroReturningExecutor: stub failed its own type guard");
  }
  return stub;
}

describe("WalletRepository — transactional paths (runInRollback)", () => {
  test("ensureWalletOnce creates a zeroed wallet for a teacher without one", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);

      const created = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      expect(created.id).toBeGreaterThan(0);
      expect(created.teacherId).toBe(teacherUserId);
      expect(created.balance).toBe("0.00");
      expect(created.totalEarning).toBe("0.00");
    });
  });

  test("ensureWalletOnce re-enter is conflict-idempotent: the same row, exactly one wallet per teacher", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);

      const first = await WalletRepository.ensureWalletOnce(teacherUserId, tx);
      const second = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      expect(second.id).toBe(first.id);
      expect(second.balance).toBe("0.00");

      // Scoped to the fixture teacher: the ON CONFLICT DO NOTHING re-enter
      // never grew the table.
      const [row] = await tx
        .select({ walletCount: sql<number>`count(*)::int` })
        .from(wallet)
        .where(eq(wallet.teacherId, teacherUserId));
      expect(row?.walletCount ?? 0).toBe(1);
    });
  });

  test("creditEarningOnce inserts one completed earning row and adds the amount to balance AND total_earning", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const sessionId = await createSessionFixture(tx, teacherUserId);
      const fixtureWallet = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      const ledger = await WalletRepository.creditEarningOnce(
        {
          walletId: fixtureWallet.id,
          sessionId,
          amount: "25.00",
          description: "completed session earning",
        },
        tx
      );

      expect(ledger.walletId).toBe(fixtureWallet.id);
      expect(ledger.sessionId).toBe(sessionId);
      expect(ledger.amount).toBe("25.00");
      expect(ledger.description).toBe("completed session earning");
      expect(ledger.type).toBe(TransactionType.Earning);
      expect(ledger.status).toBe(TransactionStatus.Completed);

      const after = await readWallet(tx, fixtureWallet.id);
      expect(after.balance).toBe("25.00");
      expect(after.totalEarning).toBe("25.00");
    });
  });

  test("creditEarningOnce is additive across credits and carries each amount verbatim (decimal-string fidelity)", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const sessionId = await createSessionFixture(tx, teacherUserId);
      const fixtureWallet = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      await WalletRepository.creditEarningOnce(
        { walletId: fixtureWallet.id, sessionId, amount: "25.00", description: "first earning" },
        tx
      );
      await WalletRepository.creditEarningOnce(
        { walletId: fixtureWallet.id, sessionId, amount: "12.50", description: "second earning" },
        tx
      );

      const after = await readWallet(tx, fixtureWallet.id);
      expect(after.balance).toBe("37.50");
      expect(after.totalEarning).toBe("37.50");

      const ledgerRows = await WalletRepository.listTransactionsByWalletId(fixtureWallet.id, tx);
      expect(ledgerRows.map(row => row.amount)).toEqual(["12.50", "25.00"]);
    });
  });

  test("INV-W7: creditEarningOnce ledger rows carry the fixture sessionId (signature-level enforcement)", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const sessionId = await createSessionFixture(tx, teacherUserId);
      const fixtureWallet = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      const ledger = await WalletRepository.creditEarningOnce(
        { walletId: fixtureWallet.id, sessionId, amount: "25.00", description: "session-linked earning" },
        tx
      );

      // The earning row's session link is enforced at the repository
      // signature — `sessionId` is a required parameter of the earning
      // credit, while the ledger column itself is a plain nullable FK with
      // no CHECK tying earning rows to a session. The honest pin is the
      // positive read-back: the persisted row carries the fixture session.
      expect(ledger.sessionId).toBe(sessionId);
      const [row] = await tx
        .select({ id: teacherTransaction.id, sessionId: teacherTransaction.sessionId })
        .from(teacherTransaction)
        .where(eq(teacherTransaction.id, ledger.id))
        .limit(1);
      expect(row?.id).toBe(ledger.id);
      expect(row?.sessionId).toBe(sessionId);
    });
  });

  test("findByTeacherId returns the wallet row for the owning teacher and null for an absent teacher", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await WalletRepository.ensureWalletOnce(teacherUserId, tx);

      const found = await WalletRepository.findByTeacherId(teacherUserId, tx);
      expect(found?.id).toBe(fixtureWallet.id);

      const missing = await WalletRepository.findByTeacherId(await absentTeacherId(tx), tx);
      expect(missing).toBeNull();
    });
  });

  test("listTransactionsByWalletId returns every ledger row for the wallet, newest first (id DESC)", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId);
      const rows = await insertLedgerRows(tx, fixtureWallet.id, 3);

      const listed = await WalletRepository.listTransactionsByWalletId(fixtureWallet.id, tx);

      expect(listed.map(row => row.id)).toEqual([rows[2]?.id, rows[1]?.id, rows[0]?.id]);
      expect(listed.every(row => row.walletId === fixtureWallet.id)).toBe(true);
      expect(await countLedgerRows(tx, fixtureWallet.id)).toBe(3);
    });
  });

  test("listRecentTransactions respects the limit and stays newest-first", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId);
      const rows = await insertLedgerRows(tx, fixtureWallet.id, 4);

      const page = await WalletRepository.listRecentTransactions(fixtureWallet.id, 2, tx);
      expect(page.map(row => row.id)).toEqual([rows[3]?.id, rows[2]?.id]);

      // A limit beyond the row count returns every row, still newest-first.
      const fullPage = await WalletRepository.listRecentTransactions(fixtureWallet.id, 10, tx);
      expect(fullPage.map(row => row.id)).toEqual([rows[3]?.id, rows[2]?.id, rows[1]?.id, rows[0]?.id]);
    });
  });

  test("debitForWithdrawalOnce debits the guarded balance, records one pending withdrawal row, and leaves total_earning untouched", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId, {
        balance: "50.00",
        totalEarning: "50.00",
      });

      const ledger = await WalletRepository.debitForWithdrawalOnce(
        { walletId: fixtureWallet.id, amount: "10.00", description: "payout request" },
        tx
      );
      if (!ledger) {
        throw new Error("expected the funded withdrawal debit to succeed");
      }

      expect(ledger.walletId).toBe(fixtureWallet.id);
      expect(ledger.sessionId).toBeNull();
      expect(ledger.amount).toBe("10.00");
      expect(ledger.description).toBe("payout request");
      expect(ledger.type).toBe(TransactionType.Withdrawal);
      expect(ledger.status).toBe(TransactionStatus.Pending);

      const after = await readWallet(tx, fixtureWallet.id);
      expect(after.balance).toBe("40.00");
      expect(after.totalEarning).toBe("50.00");
      expect(await countLedgerRows(tx, fixtureWallet.id)).toBe(1);
    });
  });

  test('debitForWithdrawalOnce at the exact boundary (balance == amount) succeeds and lands on "0.00"', async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId, {
        balance: "25.00",
        totalEarning: "25.00",
      });

      const ledger = await WalletRepository.debitForWithdrawalOnce(
        { walletId: fixtureWallet.id, amount: "25.00", description: "full-balance payout" },
        tx
      );
      if (!ledger) {
        throw new Error("expected the exact-boundary debit to succeed");
      }

      const after = await readWallet(tx, fixtureWallet.id);
      expect(after.balance).toBe("0.00");
      expect(after.totalEarning).toBe("25.00");
    });
  });

  test("insufficient funds: the guarded debit returns null and commits ZERO writes (no orphan ledger row is live)", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId, {
        balance: "10.00",
        totalEarning: "10.00",
      });

      // The guarded UPDATE runs BEFORE the ledger INSERT, so a funds miss
      // returns null with zero writes performed — no pending withdrawal row
      // is ever live inside the caller's transaction (no rollback needed).
      const debited = await WalletRepository.debitForWithdrawalOnce(
        { walletId: fixtureWallet.id, amount: "25.00", description: "over-budget payout" },
        tx
      );
      expect(debited).toBeNull();

      const untouched = await readWallet(tx, fixtureWallet.id);
      expect(untouched.balance).toBe("10.00");
      expect(untouched.totalEarning).toBe("10.00");
      expect(await countLedgerRows(tx, fixtureWallet.id)).toBe(0);
    });
  });
});

describe("WalletRepository — namespace closure", () => {
  test("exposes exactly the documented methods — no update or delete primitive for the append-only ledger", () => {
    const exposed = Object.keys(WalletRepository).toSorted((a, b) => a.localeCompare(b));

    expect(exposed).toEqual([
      "countPendingWithdrawals",
      "countTransactions",
      "countTransactionsForAdmin",
      "creditBonusOnce",
      "creditEarningOnce",
      "debitAdjustmentOnce",
      "debitForArbitrationOnce",
      "debitForWithdrawalOnce",
      "ensureWalletOnce",
      "findAdminWalletProbe",
      "findById",
      "findByTeacherId",
      "findSettlementProbe",
      "listPendingWithdrawals",
      "listRecentTransactions",
      "listTransactionsByWalletId",
      "listTransactionsForAdmin",
      "listTransactionsPage",
      "restoreWithdrawalDebitOnce",
      "settleWithdrawalOnce",
      "sumPendingWithdrawals",
    ]);
    expect(exposed.some(name => /update|delete/i.test(name))).toBe(false);
  });
});

describe("WalletRepository — defensive zero-row guards (typed executor stub)", () => {
  test("creditEarningOnce throws when the ledger INSERT returns zero rows", async () => {
    const error = await expectRepoError(() =>
      WalletRepository.creditEarningOnce(
        { walletId: 1, sessionId: 1, amount: "25.00", description: "stub probe" },
        zeroReturningExecutor()
      )
    );

    expect(error.message).toContain("creditEarningOnce");
    expect(error.message).toContain("zero rows");
  });

  test("debitForWithdrawalOnce throws when the ledger INSERT returns zero rows", async () => {
    const error = await expectRepoError(() =>
      WalletRepository.debitForWithdrawalOnce(
        { walletId: 1, amount: "10.00", description: "stub probe" },
        zeroReturningExecutor()
      )
    );

    expect(error.message).toContain("debitForWithdrawalOnce");
    expect(error.message).toContain("zero rows");
  });
});

describe("WalletRepository — CHECK constraint probes (savepoint-bracketed)", () => {
  test("direct negative writes at the DB tier are rejected by the named wallet and ledger CHECK constraints", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId, {
        balance: "10.00",
        totalEarning: "10.00",
      });

      // Bracket 1 — a direct negative balance write (repo bypassed).
      await tx.execute(sql`savepoint wallet_balance_probe`);
      const balanceError = await expectRepoError(() =>
        tx.update(wallet).set({ balance: "-1.00" }).where(eq(wallet.id, fixtureWallet.id))
      );
      await tx.execute(sql`rollback to savepoint wallet_balance_probe`);
      expect(constraintNameOf(balanceError)).toBe("wallet_balance_check");
      expect(hasPostgresErrorCode(balanceError, PG_CHECK_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(balanceError, "wallet_balance_check")).toBe(true);

      // Bracket 2 — a direct negative total_earning write.
      await tx.execute(sql`savepoint wallet_total_earning_probe`);
      const totalEarningError = await expectRepoError(() =>
        tx.update(wallet).set({ totalEarning: "-1.00" }).where(eq(wallet.id, fixtureWallet.id))
      );
      await tx.execute(sql`rollback to savepoint wallet_total_earning_probe`);
      expect(constraintNameOf(totalEarningError)).toBe("wallet_total_earning_check");
      expect(hasPostgresErrorCode(totalEarningError, PG_CHECK_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(totalEarningError, "wallet_total_earning_check")).toBe(true);

      // Bracket 3 — a direct negative amount insert into the ledger.
      await tx.execute(sql`savepoint ledger_amount_probe`);
      const amountError = await expectRepoError(() =>
        tx.insert(teacherTransaction).values({
          walletId: fixtureWallet.id,
          sessionId: null,
          amount: "-5.00",
          type: TransactionType.Withdrawal,
          status: TransactionStatus.Pending,
        })
      );
      await tx.execute(sql`rollback to savepoint ledger_amount_probe`);
      expect(constraintNameOf(amountError)).toBe("teacher_transaction_amount_check");
      expect(hasPostgresErrorCode(amountError, PG_CHECK_VIOLATION)).toBe(true);
      expect(causeChainContainsMessage(amountError, "teacher_transaction_amount_check")).toBe(true);

      // The savepoint brackets kept the transaction queryable and the
      // fixture wallet intact.
      const after = await readWallet(tx, fixtureWallet.id);
      expect(after.balance).toBe("10.00");
      expect(after.totalEarning).toBe("10.00");
      expect(await countLedgerRows(tx, fixtureWallet.id)).toBe(0);
    });
  });

  test("INV-W3: a raw second wallet INSERT bypassing ON CONFLICT raises 23505 on wallet_teacher_id_unique", async () => {
    await runInRollback(async tx => {
      const teacherUserId = await createTeacherFixture(tx);
      const fixtureWallet = await createTestWallet(tx, teacherUserId);

      // A RAW insert is the only path that can reach the unique constraint:
      // the repository's ensure flow absorbs the conflict with ON CONFLICT
      // DO NOTHING, so the one-wallet-per-teacher rule is proven here at the
      // tier that actually enforces it.
      const error = await probeInsideSavepoint(tx, "wallet teacher unique probe", () =>
        tx.insert(wallet).values({ teacherId: teacherUserId })
      );
      expectUniqueViolation(error, "wallet_teacher_id_unique");

      // The savepoint rollback kept the fixture intact: still exactly one
      // wallet row for the teacher.
      expect(fixtureWallet.teacherId).toBe(teacherUserId);
      const [row] = await tx
        .select({ walletCount: sql<number>`count(*)::int` })
        .from(wallet)
        .where(eq(wallet.teacherId, teacherUserId));
      expect(row?.walletCount ?? 0).toBe(1);
    });
  });
});

/** Shared-PK ids for one booking pair (wallet.teacher_id / session participants). */
interface WalletActors {
  teacherUserId: number;
  studentUserId: number;
}

/** Creates one certified teacher + one student pair with shared-PK rows. */
async function createWalletActors(tx: DBTransaction): Promise<WalletActors> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await tx.insert(teacher).values({ id: teacherUser.id, isApproved: true });
  const studentUser = await createTestUser(tx, { role: "student" });
  await createTestStudent(tx, studentUser.id);
  return { teacherUserId: teacherUser.id, studentUserId: studentUser.id };
}

/** Direct wallet-row insert (full balance control for the funds-guard matrix). */
async function insertWalletRow(
  tx: DBTransaction,
  teacherUserId: number,
  balance: string,
  totalEarning = "0.00"
): Promise<WalletSelectType> {
  const [row] = await tx.insert(wallet).values({ teacherId: teacherUserId, balance, totalEarning }).returning();
  if (!row) {
    throw new Error("insertWalletRow: insert returned no rows");
  }
  return row;
}

/**
 * The disputed consumed-escrow session the compensating row points at —
 * a dual-confirmed completed session whose fee was earned (the exact
 * provenance of an arbitration reversal).
 */
async function insertDisputedSessionRow(tx: DBTransaction, actors: WalletActors): Promise<SessionSelectType> {
  const stamp = new Date(Math.floor((Date.now() - 60_000) / 1000) * 1000);
  const [row] = await tx
    .insert(session)
    .values({
      teacherId: actors.teacherUserId,
      studentId: actors.studentUserId,
      status: SessionStatus.Disputed,
      fee: "25.00",
      feeHeld: false,
      heldBalanceLane: HeldBalanceLane.Hifz,
      startedAt: stamp,
      endedAt: stamp,
      confirmedByTeacherAt: stamp,
      confirmedByStudentAt: stamp,
    })
    .returning();
  if (!row) {
    throw new Error("insertDisputedSessionRow: insert returned no rows");
  }
  return row;
}

/** Reads the wallet row straight off the table (read-back oracle). */
async function readWalletRow(tx: DBTransaction, id: number): Promise<WalletSelectType> {
  const [row] = await tx.select().from(wallet).where(eq(wallet.id, id)).limit(1);
  if (!row) {
    throw new Error("readWalletRow: expected the wallet row to exist");
  }
  return row;
}

/** Ledger rows for one wallet, oldest first (insertion order = id order). */
async function readLedgerRows(tx: DBTransaction, walletId: number): Promise<TeacherTransactionSelectType[]> {
  return tx
    .select()
    .from(teacherTransaction)
    .where(eq(teacherTransaction.walletId, walletId))
    .orderBy(sql`${teacherTransaction.id} ASC`);
}

describe("WalletRepository.debitForArbitrationOnce — transactional paths (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("the reversal slice inserts the completed compensating row and debits exactly the amount", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "50.00", "80.00");
      const description = "Dispute refund reversal";

      const ledger = await WalletRepository.debitForArbitrationOnce(
        { walletId: walletRow.id, sessionId: sessionRow.id, amount: "15.99", description },
        tx
      );

      expect(ledger).not.toBeNull();
      expect(ledger?.walletId).toBe(walletRow.id);
      expect(ledger?.sessionId).toBe(sessionRow.id);
      expect(ledger?.amount).toBe("15.99");
      expect(ledger?.description).toBe(description);
      expect(ledger?.type).toBe(TransactionType.ArbitrationReversal);
      expect(ledger?.status).toBe(TransactionStatus.Completed);
      expect(ledger?.createdAt).not.toBeNull();

      // The debit moved ONLY the spendable balance — the gross lifetime
      // earnings counter and every identity column are frozen.
      const after = await readWalletRow(tx, walletRow.id);
      expect(after.balance).toBe("34.01");
      expect(after.totalEarning).toBe("80.00");
      expect(after.teacherId).toBe(actors.teacherUserId);
      expect(after.createdAt.getTime()).toBe(walletRow.createdAt.getTime());

      // Exactly one ledger row, and it is the compensating one.
      const rows = await readLedgerRows(tx, walletRow.id);
      expect(rows).toHaveLength(1);
      expect(ledger?.id).toBe(rows[0]?.id);
    });
  });

  test("the reversal slice returns null on insufficient funds and leaves the balance untouched", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "10.00", "30.00");

      const denied = await WalletRepository.debitForArbitrationOnce(
        { walletId: walletRow.id, sessionId: sessionRow.id, amount: "15.99", description: "reversal" },
        tx
      );

      expect(denied).toBeNull();
      const after = await readWalletRow(tx, walletRow.id);
      expect(after.balance).toBe("10.00");
      expect(after.totalEarning).toBe("30.00");
    });
  });

  test("a denied arbitration commits neither the compensating row nor the debit — the caller's throw rolls the slice back", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "10.00", "30.00");

      // The service-tier denial shape (requestWithdrawal's precedent): the
      // primitive returns null, the caller throws, and the nested
      // transaction (savepoint) rolls the compensating INSERT back with the
      // failed flow — the outer transaction stays queryable.
      const denialError = await expectRepoError(() =>
        tx.transaction(async nested => {
          const ledger = await WalletRepository.debitForArbitrationOnce(
            { walletId: walletRow.id, sessionId: sessionRow.id, amount: "15.99", description: "reversal" },
            nested
          );
          expect(ledger).toBeNull();
          throw new Error("arbitration denied: insufficient wallet balance");
        })
      );
      expect(denialError.message).toContain("insufficient wallet balance");

      // Either both effects commit or neither does: zero ledger rows, zero
      // balance movement after the rolled-back denial.
      expect(await readLedgerRows(tx, walletRow.id)).toHaveLength(0);
      const after = await readWalletRow(tx, walletRow.id);
      expect(after.balance).toBe("10.00");

      // The outer transaction survived the savepoint rollback.
      const stillThere = await WalletRepository.findByTeacherId(actors.teacherUserId, tx);
      expect(stillThere?.id).toBe(walletRow.id);
    });
  });

  // ─── Tier 2: money boundaries ───────────────────────────────────────

  test("the funds guard is inclusive at the exact balance and misses one cent short", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const otherActors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);

      const exact = await insertWalletRow(tx, actors.teacherUserId, "20.00", "20.00");
      const exactLedger = await WalletRepository.debitForArbitrationOnce(
        { walletId: exact.id, sessionId: sessionRow.id, amount: "20.00", description: "full fee" },
        tx
      );
      expect(exactLedger).not.toBeNull();
      expect((await readWalletRow(tx, exact.id)).balance).toBe("0.00");

      const short = await insertWalletRow(tx, otherActors.teacherUserId, "19.99", "19.99");
      const shortLedger = await WalletRepository.debitForArbitrationOnce(
        { walletId: short.id, sessionId: sessionRow.id, amount: "20.00", description: "full fee" },
        tx
      );
      expect(shortLedger).toBeNull();
      expect((await readWalletRow(tx, short.id)).balance).toBe("19.99");
    });
  });

  test("zero and maximal decimal(10,2) amounts behave as plain bound strings", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const otherActors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);

      // A zero-amount ledger row violates the append-only ledger's
      // `teacher_transaction_amount_check` (amount > 0 — no no-op movements
      // are ever recorded); the savepoint bracket keeps the probe
      // transaction queryable, mirroring the CHECK-probe tier above.
      const zero = await insertWalletRow(tx, actors.teacherUserId, "5.00", "5.00");
      await tx.execute(sql`savepoint zero_amount_probe`);
      let zeroError: unknown;
      try {
        await WalletRepository.debitForArbitrationOnce(
          { walletId: zero.id, sessionId: sessionRow.id, amount: "0.00", description: "zero" },
          tx
        );
      } catch (error) {
        zeroError = error;
      }
      await tx.execute(sql`rollback to savepoint zero_amount_probe`);
      expect(constraintNameOf(zeroError)).toBe("teacher_transaction_amount_check");
      expect(hasPostgresErrorCode(zeroError, PG_CHECK_VIOLATION)).toBe(true);
      expect((await readWalletRow(tx, zero.id)).balance).toBe("5.00");

      // The column's full decimal(10,2) range drains to exactly zero.
      const max = await insertWalletRow(tx, otherActors.teacherUserId, "99999999.99", "99999999.99");
      const maxLedger = await WalletRepository.debitForArbitrationOnce(
        { walletId: max.id, sessionId: sessionRow.id, amount: "99999999.99", description: "max" },
        tx
      );
      expect(maxLedger?.amount).toBe("99999999.99");
      expect((await readWalletRow(tx, max.id)).balance).toBe("0.00");
      expect((await readWalletRow(tx, max.id)).totalEarning).toBe("99999999.99");
    });
  });

  test("an over-precision amount flows through the decimal columns' two-fraction storage — the repo never re-rounds", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "20.00", "40.00");

      // The amount is bound verbatim; the decimal(10,2) columns own the
      // storage convention (the service tier validates precision BEFORE
      // this primitive is reached).
      const ledger = await WalletRepository.debitForArbitrationOnce(
        { walletId: walletRow.id, sessionId: sessionRow.id, amount: "15.999", description: "over-precision" },
        tx
      );

      expect(ledger?.amount).toBe("16.00");
      const after = await readWalletRow(tx, walletRow.id);
      expect(after.balance).toBe("4.00");
      expect(after.totalEarning).toBe("40.00");
    });
  });

  // ─── Tier 3: guarded debits under duplication ───────────────────────

  test("a double arbitration on one wallet debits exactly once — the funds guard serializes the loser", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "30.00", "30.00");

      // Raw statements race (the harness's single rollback connection
      // serializes them in call order): the first slice debits the full
      // balance, the second's `balance >= amount` predicate matches zero
      // rows and returns the honest null.
      const outcomes = await Promise.allSettled([
        WalletRepository.debitForArbitrationOnce(
          { walletId: walletRow.id, sessionId: sessionRow.id, amount: "30.00", description: "first" },
          tx
        ),
        WalletRepository.debitForArbitrationOnce(
          { walletId: walletRow.id, sessionId: sessionRow.id, amount: "30.00", description: "second" },
          tx
        ),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.description).toBe("first");

      // The balance drained EXACTLY once — the financial invariant the
      // funds guard owns (no double debit, no negative balance). The
      // debit-first composition (the shared writer's ruling) means the
      // loser's guard miss returns null with ZERO writes — no orphan
      // ledger row is ever live inside the transaction.
      expect((await readWalletRow(tx, walletRow.id)).balance).toBe("0.00");
      const rows = await readLedgerRows(tx, walletRow.id);
      expect(rows.map(row => row.description)).toEqual(["first"]);
    });
  });

  test("an arbitration and a withdrawal racing the same funds guard debit exactly once", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "30.00", "30.00");

      // The arbitration slice is enqueued first, the withdrawal second; the
      // loser's `balance >= amount` predicate matches zero rows against the
      // winner's effect — the loser gets the honest null and no negative
      // balance can ever land (INV-W1's guarded-UPDATE shape).
      const outcomes = await Promise.allSettled([
        WalletRepository.debitForArbitrationOnce(
          { walletId: walletRow.id, sessionId: sessionRow.id, amount: "30.00", description: "arbitration" },
          tx
        ),
        WalletRepository.debitForWithdrawalOnce(
          { walletId: walletRow.id, amount: "30.00", description: "withdrawal" },
          tx
        ),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.description).toBe("arbitration");
      expect(winners[0]?.sessionId).toBe(sessionRow.id);

      // One debit moved the balance; the debit-first composition means the
      // loser's guard miss leaves ZERO writes — the ledger carries the
      // winner's reversal row alone.
      expect((await readWalletRow(tx, walletRow.id)).balance).toBe("0.00");
      const rows = await readLedgerRows(tx, walletRow.id);
      expect(rows.map(row => row.description)).toEqual(["arbitration"]);
      expect(rows.map(row => row.type)).toEqual([TransactionType.ArbitrationReversal]);
    });
  });

  // ─── Tier 4: security/tenancy ───────────────────────────────────────

  test("hostile description text rides as parameterized data — stored verbatim, nothing executes", async () => {
    await runInRollback(async tx => {
      const actors = await createWalletActors(tx);
      const sessionRow = await insertDisputedSessionRow(tx, actors);
      const walletRow = await insertWalletRow(tx, actors.teacherUserId, "50.00", "50.00");
      const hostileDescription = "reversal'); DELETE FROM wallet; UPDATE wallet SET balance = 0; --";

      const ledger = await WalletRepository.debitForArbitrationOnce(
        { walletId: walletRow.id, sessionId: sessionRow.id, amount: "10.00", description: hostileDescription },
        tx
      );

      // The text landed verbatim as data and nothing executed: the wallet
      // row is exactly as the guarded debit left it.
      expect(ledger?.description).toBe(hostileDescription);
      const after = await readWalletRow(tx, walletRow.id);
      expect(after.balance).toBe("40.00");
      expect(after.teacherId).toBe(actors.teacherUserId);
    });
  });
});

/**
 * Standalone executor branch — the `tx ?? db` write fallback. This branch
 * runs WITHOUT a transaction by definition, so its fixtures must be
 * COMMITTED (an uncommitted row is invisible to the pool path). They are
 * registered here and hard-deleted in `afterAll` (rule 9) in FK-dependency
 * order (ledger rows first — the wallet FK is restrict-bound; sessions
 * before the participant rows — the teacher/student FKs are restrict-bound
 * while sessions reference them). The push-provisioned test database
 * carries no immutability trigger on the ledger (the migration-installed
 * triggers only exist in migrate-provisioned environments), so the ledger
 * delete needs no trigger suspension here.
 */
describe("WalletRepository.debitForArbitrationOnce — standalone executor path (committed fixtures)", () => {
  const committedTeacherTransactionIds: number[] = [];
  const committedWalletIds: number[] = [];
  const committedSessionIds: number[] = [];
  const committedUserIds: number[] = [];

  afterAll(async () => {
    // Ledger rows first (wallet FK restrict), then sessions (participant
    // FKs restrict), then the users cascade the role rows. The ledger is
    // append-only in production — the sweep runs under the sanctioned
    // immutability-trigger suspension, mirroring the journey teardowns.
    await withImmutabilityTriggersSuspended(["teacher_transaction"], async () => {
      await Promise.all(
        committedTeacherTransactionIds.map(id => db.delete(teacherTransaction).where(eq(teacherTransaction.id, id)))
      );
    });
    committedTeacherTransactionIds.length = 0;
    await Promise.all(committedWalletIds.map(id => db.delete(wallet).where(eq(wallet.id, id))));
    committedWalletIds.length = 0;
    await Promise.all(committedSessionIds.map(id => db.delete(session).where(eq(session.id, id))));
    committedSessionIds.length = 0;
    await Promise.all(
      committedUserIds.map(async userId => {
        await db.delete(teacher).where(eq(teacher.id, userId));
        await db.delete(students).where(eq(students.id, userId));
        await db.delete(users).where(eq(users.id, userId));
      })
    );
    committedUserIds.length = 0;
  });

  test("the reversal slice runs on the pool fallback and commits both effects", async () => {
    const fixture = await db.transaction(async tx => {
      const pair = await createWalletActors(tx);
      committedUserIds.push(pair.teacherUserId, pair.studentUserId);
      const sessionRow = await insertDisputedSessionRow(tx, pair);
      const walletRow = await insertWalletRow(tx, pair.teacherUserId, "40.00", "40.00");
      committedSessionIds.push(sessionRow.id);
      committedWalletIds.push(walletRow.id);
      return { pair, sessionRow, walletRow };
    });

    const ledger = await WalletRepository.debitForArbitrationOnce({
      walletId: fixture.walletRow.id,
      sessionId: fixture.sessionRow.id,
      amount: "25.00",
      description: "pool reversal",
    });

    expect(ledger).not.toBeNull();
    committedTeacherTransactionIds.push(ledger?.id ?? 0);
    expect(ledger?.type).toBe(TransactionType.ArbitrationReversal);
    expect(ledger?.status).toBe(TransactionStatus.Completed);
    expect(ledger?.sessionId).toBe(fixture.sessionRow.id);
    expect(ledger?.amount).toBe("25.00");

    const after = await WalletRepository.findByTeacherId(fixture.pair.teacherUserId);
    expect(after?.balance).toBe("15.00");
    expect(after?.totalEarning).toBe("40.00");
  });
});
