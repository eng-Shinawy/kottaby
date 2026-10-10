/**
 * Launch financial probe — the §2 launch-day DB-tier legs for the escrow
 * money rules: the NAMED CHECK constraints the escrow substrate leans on
 * (student lane floors, wallet floors, the strictly-positive ledger amount)
 * plus the post-settlement ledger immutability triggers.
 *
 * Proven per the repo's probe discipline (docblock precedents
 * `backend/db/test/repo/billing/wallet.repository.test.ts:15` and
 * `backend/db/test/logic/billing/financial-immutability.test.ts:16-18`):
 *  - every statement runs inside `runInRollback` with `tx` passed through
 *    to every repo call, entity-setup helper, and direct Drizzle query;
 *  - every RAISE leg is bracketed in its OWN savepoint via
 *    `probeInsideSavepoint` — `runInRollback` has no savepoint of its own,
 *    so the bracket is MANDATORY (a raised exception would otherwise abort
 *    the outer transaction and deadlock the rollback wrapper);
 *  - errors are captured with the try/catch scaffold (NEVER
 *    `expect(...).rejects.toThrow()`) and classified by SQLSTATE + the
 *    exact PostgreSQL constraint name / trigger RAISE text — an unrelated
 *    failure can never satisfy a probe;
 *  - every fixture row is created by THIS suite via `entity-setup.ts`
 *    helpers (never seed data) and every read-back is scoped to the
 *    fixture's own id, so pre-existing rows can never satisfy or break an
 *    assertion.
 *
 * Legs:
 *  1. The four student lane CHECKs — a direct negative write to any lane
 *     (`balance_trial` / `balance_hifz` / `balance_tajweed` /
 *     `balance_reviews`) is rejected by its NAMED constraint
 *     (`students_balance_*_check`) — the DB-tier floor behind "student
 *     balance cannot go negative".
 *  2. The wallet CHECKs — direct negative `balance` and `total_earning`
 *     writes raise `wallet_balance_check` / `wallet_total_earning_check`.
 *  3. The ledger amount CHECK — a negative AND a zero ledger amount are
 *     both rejected by `teacher_transaction_amount_check` (the schema pins
 *     `amount > 0` STRICTLY positive, so zero is rejected too).
 *  4. Post-settlement ledger immutability — the guarded
 *     pending→completed settlement transition is permitted (the trigger's
 *     only carve-out), and once the row is settled any further UPDATE
 *     raises the amended guard's exception and any DELETE raises the
 *     immutability trigger's exception, with the row byte-unchanged after
 *     both probes.
 *
 * The trigger tier is skipped on the PGlite provider (the immutability
 * triggers are PostgreSQL functions; the CHECK legs still run there —
 * same split as `financial-immutability.test.ts`).
 *
 * Run:
 *   bun run test/scripts/run-test.ts backend/db/test/logic/billing/launch-financial-probe.test.ts
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { students } from "@/backend/db/schema/students/students";
import {
  createTestStudent,
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import {
  expectCheckViolation,
  expectTriggerRaise,
  probeInsideSavepoint,
} from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { runInRollback } from "@/backend/db/test/test-utils";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type { DBTransaction, StudentSelectType, TeacherTransactionSelectType, WalletSelectType } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

// ─── RAISE-message contracts (canonical migration DDL) ───────────────────────

/** The teacher-transaction immutability guard's exception prefix. */
const TEACHER_TX_IMMUTABLE = "teacher_transaction is immutable";
/** The settlement-amended UPDATE guard's permitted-transition fragment. */
const TEACHER_TX_UPDATE_MSG = "UPDATE is permitted only to settle a pending withdrawal";
/** The immutability DELETE trigger's exception fragment. */
const TEACHER_TX_DELETE_MSG = "DELETE is not permitted";

/** PGlite has no PL/pgSQL immutability triggers — the trigger tier is PG-only. */
const describeTriggerTier = isPgliteProvider() ? describe.skip : describe;

// ─── Fixture helpers (entity-setup only — never seed data) ──────────────────

/**
 * One student row with every lane at a positive fixture value — each lane's
 * CHECK floor is then probed by a direct negative write to THAT lane only.
 */
async function createStudentWithAllLanes(tx: DBTransaction): Promise<StudentSelectType> {
  const user = await createTestUser(tx);
  return createTestStudent(tx, user.id, {
    balanceTrial: 2,
    balanceHifz: 1,
    balanceTajweed: 1,
    balanceReviews: 1,
  });
}

/** One certified teacher + a wallet holding fixture money on both columns. */
async function createFundedWalletFixture(tx: DBTransaction): Promise<WalletSelectType> {
  const user = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, user.id);
  return createTestWallet(tx, user.id, { balance: "10.00", totalEarning: "10.00" });
}

/**
 * One pending withdrawal ledger row on a fixture wallet — the row the
 * guarded settlement transition then settles.
 */
async function createPendingWithdrawalFixture(
  tx: DBTransaction,
  walletId: number
): Promise<TeacherTransactionSelectType> {
  return createTestTeacherTransaction(tx, walletId, null, {
    type: TransactionType.Withdrawal,
    status: TransactionStatus.Pending,
    amount: "40.00",
    description: null,
  });
}

/** Ledger row count scoped to ONE fixture wallet (never a global count). */
async function countLedgerRows(tx: DBTransaction, walletId: number): Promise<number> {
  const [row] = await tx
    .select({ ledgerCount: sql<number>`count(*)::int` })
    .from(teacherTransaction)
    .where(eq(teacherTransaction.walletId, walletId));
  return row?.ledgerCount ?? 0;
}

/** Read-back oracle: the fixture student row straight off the table. */
async function readStudent(tx: DBTransaction, id: number): Promise<StudentSelectType> {
  const [row] = await tx.select().from(students).where(eq(students.id, id)).limit(1);
  if (!row) {
    throw new Error(`readStudent: expected student ${id} to exist`);
  }
  return row;
}

/** Read-back oracle: the fixture wallet row straight off the table. */
async function readWalletRow(tx: DBTransaction, walletId: number): Promise<WalletSelectType> {
  const [row] = await tx.select().from(wallet).where(eq(wallet.id, walletId)).limit(1);
  if (!row) {
    throw new Error(`readWalletRow: expected wallet ${walletId} to exist`);
  }
  return row;
}

/** Read-back oracle: the fixture ledger row straight off the table. */
async function readLedgerRow(tx: DBTransaction, ledgerId: number): Promise<TeacherTransactionSelectType> {
  const [row] = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.id, ledgerId)).limit(1);
  if (!row) {
    throw new Error(`readLedgerRow: expected teacher_transaction ${ledgerId} to exist`);
  }
  return row;
}

// ─── Leg 1 — the four student lane CHECK floors ──────────────────────────────

describe("launch financial probe — student lane CHECK floors", () => {
  test("a direct negative write to any lane raises its named students_balance_*_check", async () => {
    await runInRollback(async tx => {
      const fixture = await createStudentWithAllLanes(tx);

      const trialError = await probeInsideSavepoint(tx, "students trial floor probe", () =>
        tx.update(students).set({ balanceTrial: -1 }).where(eq(students.id, fixture.id))
      );
      expectCheckViolation(trialError, "students_balance_trial_check");

      const hifzError = await probeInsideSavepoint(tx, "students hifz floor probe", () =>
        tx.update(students).set({ balanceHifz: -1 }).where(eq(students.id, fixture.id))
      );
      expectCheckViolation(hifzError, "students_balance_hifz_check");

      const tajweedError = await probeInsideSavepoint(tx, "students tajweed floor probe", () =>
        tx.update(students).set({ balanceTajweed: -1 }).where(eq(students.id, fixture.id))
      );
      expectCheckViolation(tajweedError, "students_balance_tajweed_check");

      const reviewsError = await probeInsideSavepoint(tx, "students reviews floor probe", () =>
        tx.update(students).set({ balanceReviews: -1 }).where(eq(students.id, fixture.id))
      );
      expectCheckViolation(reviewsError, "students_balance_reviews_check");

      // The savepoint brackets kept the transaction queryable and every
      // fixture lane intact — the floors rejected the writes, the row never
      // absorbed one.
      const after = await readStudent(tx, fixture.id);
      expect(after.balanceTrial).toBe(2);
      expect(after.balanceHifz).toBe(1);
      expect(after.balanceTajweed).toBe(1);
      expect(after.balanceReviews).toBe(1);
    });
  });
});

// ─── Leg 2 — the wallet CHECK floors ─────────────────────────────────────────

describe("launch financial probe — wallet CHECK floors", () => {
  test("direct negative balance and total_earning writes raise their named wallet CHECKs", async () => {
    await runInRollback(async tx => {
      const fixtureWallet = await createFundedWalletFixture(tx);

      const balanceError = await probeInsideSavepoint(tx, "wallet balance floor probe", () =>
        tx.update(wallet).set({ balance: "-1.00" }).where(eq(wallet.id, fixtureWallet.id))
      );
      expectCheckViolation(balanceError, "wallet_balance_check");

      const totalEarningError = await probeInsideSavepoint(tx, "wallet total earning floor probe", () =>
        tx.update(wallet).set({ totalEarning: "-1.00" }).where(eq(wallet.id, fixtureWallet.id))
      );
      expectCheckViolation(totalEarningError, "wallet_total_earning_check");

      const after = await readWalletRow(tx, fixtureWallet.id);
      expect(after.balance).toBe("10.00");
      expect(after.totalEarning).toBe("10.00");
    });
  });
});

// ─── Leg 3 — the strictly-positive ledger amount CHECK ───────────────────────

describe("launch financial probe — ledger amount CHECK", () => {
  test("a negative AND a zero ledger amount both raise teacher_transaction_amount_check (amount > 0 strictly)", async () => {
    await runInRollback(async tx => {
      const fixtureWallet = await createFundedWalletFixture(tx);

      const negativeError = await probeInsideSavepoint(tx, "ledger negative amount probe", () =>
        tx.insert(teacherTransaction).values({
          walletId: fixtureWallet.id,
          sessionId: null,
          amount: "-5.00",
          type: TransactionType.Withdrawal,
          status: TransactionStatus.Pending,
        })
      );
      expectCheckViolation(negativeError, "teacher_transaction_amount_check");

      const zeroError = await probeInsideSavepoint(tx, "ledger zero amount probe", () =>
        tx.insert(teacherTransaction).values({
          walletId: fixtureWallet.id,
          sessionId: null,
          amount: "0.00",
          type: TransactionType.Withdrawal,
          status: TransactionStatus.Pending,
        })
      );
      expectCheckViolation(zeroError, "teacher_transaction_amount_check");

      expect(await countLedgerRows(tx, fixtureWallet.id)).toBe(0);
    });
  });
});

// ─── Leg 4 — post-settlement ledger immutability (PG-only trigger tier) ──────

describeTriggerTier("launch financial probe — post-settlement ledger immutability", () => {
  test("the guarded pending→completed settle is permitted; the settled row then refuses any further UPDATE", async () => {
    await runInRollback(async tx => {
      const fixtureWallet = await createFundedWalletFixture(tx);
      const pending = await createPendingWithdrawalFixture(tx, fixtureWallet.id);

      // The trigger's ONLY carve-out: a pending withdrawal settles to
      // completed with every other column unchanged — this write must be
      // permitted (not savepoint-bracketed; it is the legitimate settle).
      const [settled] = await tx
        .update(teacherTransaction)
        .set({ status: TransactionStatus.Completed })
        .where(eq(teacherTransaction.id, pending.id))
        .returning();
      if (!settled) {
        throw new Error("settle UPDATE returned no rows");
      }
      expect(settled.status).toBe(TransactionStatus.Completed);

      // Post-settlement: any further UPDATE raises the amended guard.
      const updateError = await probeInsideSavepoint(tx, "settled ledger update probe", () =>
        tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, settled.id))
      );
      expectTriggerRaise(updateError, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(updateError, TEACHER_TX_UPDATE_MSG);

      const after = await readLedgerRow(tx, settled.id);
      expect(after.amount).toBe("40.00");
      expect(after.status).toBe(TransactionStatus.Completed);
    });
  });

  test("a settled ledger row refuses DELETE — the immutability trigger keeps the row on the books", async () => {
    await runInRollback(async tx => {
      const fixtureWallet = await createFundedWalletFixture(tx);
      const pending = await createPendingWithdrawalFixture(tx, fixtureWallet.id);
      const [settled] = await tx
        .update(teacherTransaction)
        .set({ status: TransactionStatus.Completed })
        .where(eq(teacherTransaction.id, pending.id))
        .returning();
      if (!settled) {
        throw new Error("settle UPDATE returned no rows");
      }

      const deleteError = await probeInsideSavepoint(tx, "settled ledger delete probe", () =>
        tx.delete(teacherTransaction).where(eq(teacherTransaction.id, settled.id))
      );
      expectTriggerRaise(deleteError, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(deleteError, TEACHER_TX_DELETE_MSG);

      const after = await readLedgerRow(tx, settled.id);
      expect(after.amount).toBe("40.00");
      expect(after.status).toBe(TransactionStatus.Completed);
    });
  });
});
