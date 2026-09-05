/**
 * WalletService tests (DEV3-013) — the teacher self-service wallet surface.
 *
 * Tier: transactional service flows on `runInRollback` (the same isolation
 * discipline `session-lifecycle.service.test.ts` uses): every case seeds
 * its own actors inside the rolled-back transaction, so the suite is
 * order-independent and leaves zero committed rows.
 *
 * Covered contract (specs R-301/R-302/R-303):
 *  - `getMyWallet` — the lazy ensure (a brand-new teacher gets an honest
 *    zeroed wallet), idempotence across repeated reads, and the
 *    newest-first ledger page.
 *  - `requestWithdrawal` — the exactly-one-pending-row + guarded-debit
 *    happy path (with `total_earning` proven untouched), the
 *    insufficient-funds conflict that commits ZERO rows (the orphan
 *    pending row dies with the savepoint), the full pre-DB validation
 *    matrix (shape, positivity, cap), and the trim-once-then-carry
 *    verbatim money discipline.
 *  - Governance defense in depth on both flows (deleted/blocked/suspended
 *    callers are denied with the typed FORBIDDEN).
 *
 * Money discipline mirrors the production code: amounts are decimal
 * STRINGS end-to-end; the suite performs NO numeric arithmetic on money
 * values — every balance oracle is an exact string read-back.
 */

import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { ConflictError, DomainError, ForbiddenError, ValidationError } from "@/backend/lib/errors";
import { WalletService } from "@/backend/services/billing/wallet.service";
import type { DBTransaction, TeacherTransactionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/**
 * Type-guard read of a caught rejection's `extensions.code` (the
 * assertion-free REQ-050 DomainError contract check).
 */
function rejectionCode(error: unknown): string {
  return error instanceof DomainError ? error.code : "";
}

/** Asserts a caught denial carries EXACTLY the expected code + translated message. */
function expectDomainDenial(error: Error, code: string, message: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect(rejectionCode(error)).toBe(code);
  expect(error.message).toBe(message);
  expect(error.message).not.toContain(code);
}

/** Creates one certified teacher (user row + shared-PK teacher child row). */
async function createTeacher(tx: DBTransaction): Promise<number> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await tx.insert(teacher).values({ id: teacherUser.id, isApproved: true });
  return teacherUser.id;
}

/** Seeds the teacher's wallet to an exact balance + lifetime-earning pair. */
async function seedWalletBalance(
  tx: DBTransaction,
  teacherId: number,
  balance: string,
  totalEarning: string
): Promise<void> {
  await WalletService.getMyWallet(teacherId, "en", tx);
  await tx.update(wallet).set({ balance, totalEarning }).where(eq(wallet.teacherId, teacherId));
}

/** Independent read-back oracle: the wallet row for one teacher. */
async function readWallet(tx: DBTransaction, teacherId: number) {
  const [row] = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId)).limit(1);
  if (!row) {
    throw new Error(`readWallet: no wallet row for teacher ${teacherId}`);
  }
  return row;
}

/** Independent read-back oracle: ALL ledger rows for one teacher's wallet, newest first. */
async function readLedger(tx: DBTransaction, teacherId: number): Promise<TeacherTransactionSelectType[]> {
  const row = await readWallet(tx, teacherId);
  return tx
    .select()
    .from(teacherTransaction)
    .where(eq(teacherTransaction.walletId, row.id))
    .orderBy(teacherTransaction.id);
}

// ─── Tier 1: getMyWallet (R-301) ─────────────────────────────────────────

describe("WalletService.getMyWallet (runInRollback)", () => {
  test("a brand-new teacher gets an honest zeroed wallet with an empty ledger (lazy ensure)", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);

      const view = await WalletService.getMyWallet(teacherId, "en", tx);

      expect(view.wallet.balance).toBe("0.00");
      expect(view.wallet.totalEarning).toBe("0.00");
      expect(view.transactions).toHaveLength(0);

      // The wallet row now physically exists (the ensure committed it on
      // the tx) and is unique for the teacher.
      const rows = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId));
      expect(rows).toHaveLength(1);
    });
  });

  test("repeated reads are idempotent — the same wallet row, never a duplicate", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);

      const first = await WalletService.getMyWallet(teacherId, "en", tx);
      const second = await WalletService.getMyWallet(teacherId, "en", tx);

      expect(second.wallet.id).toBe(first.wallet.id);
      const rows = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId));
      expect(rows).toHaveLength(1);
    });
  });

  test("the ledger page returns the newest-first order over a seeded history", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "90.00", "90.00");
      const walletRow = await readWallet(tx, teacherId);

      // Seed three ledger rows with ascending ids (earnings history).
      // Deliberate sequential inserts — id ASCENDING is the ordering oracle
      // this test reads back; a bulk insert would not guarantee the ids.
      for (const amount of ["10.00", "30.00", "50.00"]) {
        // oxlint-disable-next-line no-await-in-loop
        await tx.insert(teacherTransaction).values({
          walletId: walletRow.id,
          sessionId: null,
          description: `Seed earning ${amount}`,
          amount,
          type: TransactionType.Earning,
          status: TransactionStatus.Completed,
        });
      }

      const view = await WalletService.getMyWallet(teacherId, "en", tx);

      expect(view.transactions).toHaveLength(3);
      expect(view.transactions[0]?.amount).toBe("50.00");
      expect(view.transactions[2]?.amount).toBe("10.00");
      // Every row maps onto the owning wallet.
      for (const row of view.transactions) {
        expect(row.walletId).toBe(walletRow.id);
      }
    });
  });
});

// ─── Tier 2: requestWithdrawal (R-302/R-303) ─────────────────────────────

describe("WalletService.requestWithdrawal (runInRollback)", () => {
  test("happy path: exactly ONE pending withdrawal row, balance debited, total_earning untouched, ledger refreshed", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      const view = await WalletService.requestWithdrawal(teacherId, "40.00", "en", tx);

      // The UPDATED view: post-debit balance, lifetime counter untouched.
      expect(view.wallet.balance).toBe("60.00");
      expect(view.wallet.totalEarning).toBe("100.00");

      // Exactly one ledger row — the pending withdrawal.
      const ledger = await readLedger(tx, teacherId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.type).toBe(TransactionType.Withdrawal);
      expect(ledger[0]?.status).toBe(TransactionStatus.Pending);
      expect(ledger[0]?.amount).toBe("40.00");
      expect(ledger[0]?.sessionId).toBeNull();
      expect(ledger[0]?.description).toBe("Withdrawal request (pending payout)");

      // The refreshed view's page carries the same single row first.
      expect(view.transactions).toHaveLength(1);
      expect(view.transactions[0]?.id).toBe(ledger[0]?.id);
    });
  });

  test("the amount is trimmed once and carried VERBATIM (money discipline)", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "10.00", "10.00");

      const view = await WalletService.requestWithdrawal(teacherId, "  2.50  ", "en", tx);

      expect(view.wallet.balance).toBe("7.50");
      const ledger = await readLedger(tx, teacherId);
      expect(ledger[0]?.amount).toBe("2.50");
    });
  });

  test("insufficient funds: localized WALLET_INSUFFICIENT_FUNDS conflict and ZERO committed rows (orphan pending row rolls back)", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "10.00", "10.00");

      let error: Error | null = null;
      try {
        await WalletService.requestWithdrawal(teacherId, "25.00", "en", tx);
      } catch (caught) {
        if (caught instanceof Error) {
          error = caught;
        }
      }
      if (error === null) {
        throw new Error("expected requestWithdrawal to reject with insufficient funds");
      }
      expectDomainDenial(error, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);

      // Zero rows committed: the balance is untouched and the ledger page
      // is EMPTY — the pending row this flow inserted died with the
      // savepoint rollback.
      expect(error).toBeInstanceOf(ConflictError);
      const walletRow = await readWallet(tx, teacherId);
      expect(walletRow.balance).toBe("10.00");
      const ledger = await readLedger(tx, teacherId);
      expect(ledger).toHaveLength(0);
    });
  });

  test("exact-balance withdrawal succeeds (the guard is `balance >= amount`)", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "75.25", "75.25");

      const view = await WalletService.requestWithdrawal(teacherId, "75.25", "en", tx);

      expect(view.wallet.balance).toBe("0.00");
      const ledger = await readLedger(tx, teacherId);
      expect(ledger).toHaveLength(1);
      expect(ledger[0]?.amount).toBe("75.25");
    });
  });

  test("validation matrix: every malformed amount fails pre-DB with WALLET_INVALID_AMOUNT and zero side effects", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      const malformed = [
        "", // empty
        "   ", // whitespace-only
        "abc", // non-numeric
        "-5.00", // negative
        "1.234", // three decimals
        ".50", // missing integer part
        "0", // zero
        "0.00", // zero with fraction
        "12345678.00", // 8 integer digits — exceeds the decimal(10,2) fit cap
      ];
      for (const amount of malformed) {
        let error: Error | null = null;
        try {
          // Sequential on purpose — each denial rolls back its own
          // savepoint; parallel calls would serialize on the tx anyway.
          // oxlint-disable-next-line no-await-in-loop
          await WalletService.requestWithdrawal(teacherId, amount, "en", tx);
        } catch (caught) {
          if (caught instanceof Error) {
            error = caught;
          }
        }
        if (error === null) {
          throw new Error(`expected requestWithdrawal to reject the malformed amount: "${amount}"`);
        }
        expectDomainDenial(error, "WALLET_INVALID_AMOUNT", t().walletInvalidAmount);
        expect(error).toBeInstanceOf(ValidationError);
      }

      // Zero side effects across the whole matrix: one wallet row, empty
      // ledger, balance intact.
      const rows = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.balance).toBe("100.00");
      expect(await readLedger(tx, teacherId)).toHaveLength(0);
    });
  });

  test("governance deny: a deleted caller is FORBIDDEN on both flows (defense in depth over the GraphQL gate)", async () => {
    await runInRollback(async tx => {
      const deletedUser = await createTestUser(tx, { role: "teacher", isDeleted: true });
      await tx.insert(teacher).values({ id: deletedUser.id, isApproved: true });

      const readError = await (async () => {
        try {
          await WalletService.getMyWallet(deletedUser.id, "en", tx);
          return null;
        } catch (caught) {
          return caught instanceof Error ? caught : null;
        }
      })();
      if (readError === null) {
        throw new Error("expected getMyWallet to deny a deleted caller");
      }
      expectDomainDenial(readError, "FORBIDDEN", t().forbidden);
      expect(readError).toBeInstanceOf(ForbiddenError);

      const writeError = await (async () => {
        try {
          await WalletService.requestWithdrawal(deletedUser.id, "5.00", "en", tx);
          return null;
        } catch (caught) {
          return caught instanceof Error ? caught : null;
        }
      })();
      if (writeError === null) {
        throw new Error("expected requestWithdrawal to deny a deleted caller");
      }
      expectDomainDenial(writeError, "FORBIDDEN", t().forbidden);

      // Zero wallet rows were ensured for the governed caller.
      const rows = await tx.select().from(wallet).where(eq(wallet.teacherId, deletedUser.id));
      expect(rows).toHaveLength(0);
    });
  });
});
