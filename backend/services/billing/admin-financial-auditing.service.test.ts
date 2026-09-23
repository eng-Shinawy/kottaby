/**
 * AdminFinancialAuditingService tests — the admin control room over the
 * teacher wallet ledger: the settlement queue mutations (approve / reject),
 * the manual wallet adjustments (credit / debit), and the adversarial
 * probes (denials, validation, wrong-state, races, rollback integrity).
 *
 * Tier: transactional service flows on `runInRollback` (the same isolation
 * discipline `wallet.service.test.ts` uses): every case seeds its own
 * actors inside the rolled-back transaction, so the suite is
 * order-independent and leaves zero committed rows. The service's
 * `outerTx` seam joins the rolled-back transaction as a SAVEPOINT block —
 * a denied or failed flow rolls back only its savepoint, so the outer
 * transaction stays usable for the zero-residue re-probes.
 *
 * Covered contract:
 *  - Admin gate matrix — anonymous (`actorId = 0`) callers are
 *    UNAUTHORIZED, non-admin actors FORBIDDEN, governed admins (e.g. a
 *    suspended admin) fail closed with FORBIDDEN through the strict
 *    governance gate, and every denial writes ZERO audit rows (probed by
 *    querying `audit_logs` inside the tx).
 *  - Approve / reject success — the settled ledger row, the exactly-one
 *    audit row with the `Override` action on the `teacher_transaction`
 *    entity and the details vocabulary (`action` marker, verbatim
 *    amount, wallet and teacher ids, `reasonPresent` BOOLEAN — the raw
 *    reason text is NEVER persisted).
 *  - Adjust success — the credit (bonus/completed, balance up,
 *    `total_earning` untouched) and the debit (withdrawal/completed,
 *    balance down) directions with their audit vocabulary.
 *  - Validation matrix — malformed amounts / reasons fail pre-DB with
 *    the typed VALIDATION denial and zero side effects.
 *  - Unicode reason fuzz — Arabic/CJK reasons are accepted and stored
 *    safely (the ledger description is the sanctioned store; audit
 *    details carry only the `reasonPresent` BOOLEAN, never raw text).
 *  - Not-found / wrong-state / rollback-integrity / concurrency /
 *    insufficient-funds adversarial probes.
 *
 * Money discipline mirrors the production code: amounts are decimal
 * STRINGS end-to-end; the suite performs NO numeric arithmetic on money
 * values — every balance oracle is an exact string read-back.
 */

import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import {
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { type DBTransaction, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { AdminFinancialAuditingService } from "@/backend/services/billing/admin-financial-auditing.service";
import type { AdminWalletAdjustmentSubmitInput } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** The errors-namespace translations for the default test locale. */
function t() {
  return getServerTranslations("en").errorsTranslations;
}

/** The audit entity label for settlement/adjustment rows. */
const TXN_ENTITY_TYPE = "teacher_transaction";

/** Localized copy for the settled-withdrawal audit details marker. */
const DETAIL_ACTION_APPROVED = "withdrawal_approved";
const DETAIL_ACTION_REJECTED = "withdrawal_rejected";
const DETAIL_ACTION_ADJUSTMENT = "wallet_adjustment";

/** Localized detail direction vocabulary (the service-layer enum values). */
const DETAIL_DIRECTION_CREDIT = WalletAdjustmentDirection.Credit;
const DETAIL_DIRECTION_DEBIT = WalletAdjustmentDirection.Debit;

/** Sentinel actorId expressing an anonymous caller (the admin gate ladder). */
const ANONYMOUS_ACTOR_ID = 0;

/**
 * Type-guard read of a caught rejection's `extensions.code` (the typed
 * DomainError contract check).
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

/**
 * Try/catch rejection helper (never `.rejects.toThrow()` inside
 * `runInRollback` — deadlocks). Returns the caught `Error`; fails the
 * test when the call resolves successfully.
 */
async function expectServiceError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expectServiceError: expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  throw new Error(`expectServiceError: caught non-Error throw: ${JSON.stringify(errorCaught)}`);
}

/** Creates one certified teacher (user row + shared-PK teacher child row). */
async function createTeacher(tx: DBTransaction): Promise<number> {
  const teacherUser = await createTestUser(tx, { role: "teacher" });
  await createTestTeacherRow(tx, teacherUser.id);
  return teacherUser.id;
}

/** Creates one admin actor (user row with the admin role). */
async function createAdmin(tx: DBTransaction): Promise<number> {
  const adminUser = await createTestUser(tx, { role: "admin" });
  return adminUser.id;
}

/** Seeds the teacher's wallet to an exact balance + lifetime-earning pair. */
async function seedWalletBalance(
  tx: DBTransaction,
  teacherId: number,
  balance: string,
  totalEarning: string
): Promise<number> {
  const teacherWallet = await createTestWallet(tx, teacherId, { balance, totalEarning });
  return teacherWallet.id;
}

/** Manual wallet-adjustment submit payload (one builder — no ad-hoc objects). */
function adjustmentInput(
  teacherId: number,
  amount: string,
  direction: WalletAdjustmentDirection,
  reason: string
): AdminWalletAdjustmentSubmitInput {
  return { teacherId, amount, direction, reason };
}

/**
 * Type guard over a raw (non-GraphQL) adjustment payload — the compile-time
 * enum cannot express a runtime-garbage direction, so a JSON round-trip
 * payload is laundered through this deliberately loose guard (the
 * linting-rules endorsed escape hatch instead of an unsafe `as` assertion).
 */
function isRawAdjustmentPayload(value: unknown): value is AdminWalletAdjustmentSubmitInput {
  return typeof value === "object" && value !== null;
}

/**
 * Seeds one pending withdrawal ledger row against the wallet (the
 * settlement flow's fixture — the reserve already happened at request
 * time in the shipped flow, so the wallet was funded BEFORE seeding).
 */
async function seedPendingWithdrawal(tx: DBTransaction, walletId: number, amount: string): Promise<number> {
  const pending = await createTestTeacherTransaction(tx, walletId, null, {
    amount,
    type: TransactionType.Withdrawal,
    status: TransactionStatus.Pending,
  });
  return pending.id;
}

/** Independent read-back oracle: the wallet row for one teacher. */
async function readWallet(tx: DBTransaction, teacherId: number) {
  const [row] = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId)).limit(1);
  if (!row) {
    throw new Error(`readWallet: no wallet row for teacher ${teacherId}`);
  }
  return row;
}

/** Independent read-back oracle: ALL ledger rows for one teacher's wallet (insertion order). */
async function readLedger(tx: DBTransaction, teacherId: number) {
  const walletRow = await readWallet(tx, teacherId);
  return tx
    .select()
    .from(teacherTransaction)
    .where(eq(teacherTransaction.walletId, walletRow.id))
    .orderBy(teacherTransaction.id);
}

/** Audit rows ABOUT one settlement/adjustment transaction (the exactly-once oracle). */
async function readAuditsForTransaction(tx: DBTransaction, transactionId: number) {
  return tx
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, TXN_ENTITY_TYPE), eq(auditLogs.entityId, transactionId)));
}

/** Audit rows WRITTEN BY one actor (the denial-zero-writes oracle). */
async function countAuditsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  return tx.$count(auditLogs, eq(auditLogs.actorId, actorId));
}

// ─── Admin gate matrix ───────────────────────────────────────────────────

describe("AdminFinancialAuditingService admin gate (runInRollback)", () => {
  test("anonymous caller (actorId 0) is UNAUTHORIZED on reads and mutations; zero audit rows", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);

      const readError = await expectServiceError(() =>
        AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(ANONYMOUS_ACTOR_ID, 1, 50, "en", tx)
      );
      expect(readError).toBeInstanceOf(UnauthorizedError);
      expectDomainDenial(readError, "UNAUTHORIZED", t().unauthorized);

      const writeError = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(ANONYMOUS_ACTOR_ID, 1, "en", tx)
      );
      expect(writeError).toBeInstanceOf(UnauthorizedError);
      expectDomainDenial(writeError, "UNAUTHORIZED", t().unauthorized);

      const adjustError = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          ANONYMOUS_ACTOR_ID,
          adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, "gate probe"),
          "en",
          tx
        )
      );
      expect(adjustError).toBeInstanceOf(UnauthorizedError);
      expectDomainDenial(adjustError, "UNAUTHORIZED", t().unauthorized);

      // Every denial wrote ZERO audit rows attributed to the anonymous
      // caller (the actor-scoped oracle — a whole-table count drifts under
      // the parallel runner's shared database).
      expect(await countAuditsForActor(tx, ANONYMOUS_ACTOR_ID)).toBe(0);
    });
  });

  test("non-admin actor is FORBIDDEN on reads and mutations; zero audit rows; zero ledger writes", async () => {
    await runInRollback(async tx => {
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const ledgerBefore = await readLedger(tx, teacherId);

      const readError = await expectServiceError(() =>
        AdminFinancialAuditingService.listStudentPaymentsForAdmin(
          teacherId,
          { studentId: null, studentNameSearch: null, status: null, paymentGateway: null, from: null, to: null },
          1,
          50,
          "en",
          tx
        )
      );
      expect(readError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(readError, "FORBIDDEN", t().forbidden);

      const approveError = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(teacherId, 1, "en", tx)
      );
      expect(approveError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(approveError, "FORBIDDEN", t().forbidden);

      const rejectError = await expectServiceError(() =>
        AdminFinancialAuditingService.rejectWithdrawal(teacherId, 1, "gate probe", "en", tx)
      );
      expect(rejectError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(rejectError, "FORBIDDEN", t().forbidden);

      const adjustError = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          teacherId,
          adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, "gate probe"),
          "en",
          tx
        )
      );
      expect(adjustError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(adjustError, "FORBIDDEN", t().forbidden);

      // Every denial wrote ZERO audit rows attributed to the non-admin
      // actor (the actor-scoped oracle — a whole-table count drifts under
      // the parallel runner's shared database).
      expect(await countAuditsForActor(tx, teacherId)).toBe(0);
      // ...and ZERO ledger writes: the seeded fixture rows are untouched.
      expect(await readLedger(tx, teacherId)).toEqual(ledgerBefore);
    });
  });

  test("suspended admin actor is FORBIDDEN on reads and mutations (governance gate fails closed); zero audit rows", async () => {
    await runInRollback(async tx => {
      const suspendedAdmin = await createTestUser(tx, { role: "admin", suspended: true });

      const readError = await expectServiceError(() =>
        AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(suspendedAdmin.id, 1, 50, "en", tx)
      );
      expect(readError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(readError, "FORBIDDEN", t().accountSuspended);

      const approveError = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(suspendedAdmin.id, 1, "en", tx)
      );
      expect(approveError).toBeInstanceOf(ForbiddenError);
      expectDomainDenial(approveError, "FORBIDDEN", t().accountSuspended);

      // The governance denial wrote ZERO audit rows attributed to the
      // suspended actor.
      expect(await countAuditsForActor(tx, suspendedAdmin.id)).toBe(0);
    });
  });
});

// ─── Approve success ─────────────────────────────────────────────────────

describe("AdminFinancialAuditingService.approveWithdrawal (runInRollback)", () => {
  test("happy path: settles the pending row completed + ONE Override audit row with the details vocabulary", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "40.00");

      const settled = await AdminFinancialAuditingService.approveWithdrawal(adminId, pendingId, "en", tx);

      expect(settled.id).toBe(pendingId);
      expect(settled.type).toBe(TransactionType.Withdrawal);
      expect(settled.status).toBe(TransactionStatus.Completed);
      expect(settled.amount).toBe("40.00");

      // The balance NEVER moves again (the debit happened at request time).
      const walletRow = await readWallet(tx, teacherId);
      expect(walletRow.balance).toBe("100.00");

      // Exactly ONE audit row: Override on teacher_transaction, ledger id.
      const audits = await readAuditsForTransaction(tx, pendingId);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actionType).toBe(AuditActionType.Override);
      expect(audits[0]?.entityType).toBe(TXN_ENTITY_TYPE);
      expect(audits[0]?.entityId).toBe(pendingId);
      expect(audits[0]?.actorId).toBe(adminId);

      // The details vocabulary: action marker + verbatim amount + ids.
      const metadata: unknown = JSON.parse(audits[0]?.details ?? "{}");
      expect(metadata).toEqual({
        action: DETAIL_ACTION_APPROVED,
        amount: "40.00",
        walletId,
        teacherId,
      });
    });
  });

  test("not-found: unknown transactionId is the localized withdrawal not-found, zero audit rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      await createTeacher(tx);

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(adminId, 987_654_321, "en", tx)
      );
      expectDomainDenial(error, "WITHDRAWAL_REQUEST_NOT_FOUND", t().withdrawalRequestNotFound);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });
});

// ─── Reject success ──────────────────────────────────────────────────────

describe("AdminFinancialAuditingService.rejectWithdrawal (runInRollback)", () => {
  test("happy path: settles failed + restores the reserved debit + ONE audit row with reasonPresent boolean", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      // Fixture mirrors the real request-debit state: the wallet held 100.00
      // pre-request; the request debited the 50.00 reserve, so the wallet now
      // holds 50.00 available with the pending 50.00 ledger row outstanding.
      const walletId = await seedWalletBalance(tx, teacherId, "50.00", "100.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "50.00");

      const rejected = await AdminFinancialAuditingService.rejectWithdrawal(
        adminId,
        pendingId,
        "  Insufficient documentation  ",
        "en",
        tx
      );

      expect(rejected.id).toBe(pendingId);
      expect(rejected.status).toBe(TransactionStatus.Failed);

      // The reserve was restored: the pre-request balance (100.00) is back.
      const walletRow = await readWallet(tx, teacherId);
      expect(walletRow.balance).toBe("100.00");

      // One audit row with the rejection vocabulary: reasonPresent BOOLEAN,
      // never the raw reason text anywhere in the details JSON.
      const audits = await readAuditsForTransaction(tx, pendingId);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actionType).toBe(AuditActionType.Override);
      expect(audits[0]?.entityType).toBe(TXN_ENTITY_TYPE);
      expect(audits[0]?.entityId).toBe(pendingId);
      const rawDetails = audits[0]?.details ?? "";
      const metadata: unknown = JSON.parse(rawDetails);
      expect(metadata).toEqual({
        action: DETAIL_ACTION_REJECTED,
        amount: "50.00",
        walletId,
        teacherId,
        reasonPresent: true,
      });
      expect(rawDetails).not.toContain("Insufficient documentation");
      expect(rawDetails).not.toContain("documentation");
    });
  });

  test("reason validation: empty / whitespace-only / oversize reasons are the pre-DB VALIDATION denial", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "50.00");

      const malformedReasons = ["", "    ", `x`.repeat(230)];
      const rejectAt = async (reason: string): Promise<void> => {
        const caught = await expectServiceError(() =>
          AdminFinancialAuditingService.rejectWithdrawal(adminId, pendingId, reason, "en", tx)
        );
        expectDomainDenial(caught, "VALIDATION", t().adjustmentReasonRequired);
        expect(caught).toBeInstanceOf(ValidationError);
      };
      await rejectAt(malformedReasons[0] ?? "");
      await rejectAt(malformedReasons[1] ?? "");
      await rejectAt(malformedReasons[2] ?? "x");

      // Zero side effects across the whole matrix: row still pending, no
      // balance movement, no audit rows.
      const [row] = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.id, pendingId)).limit(1);
      expect(row?.status).toBe(TransactionStatus.Pending);
      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });
});

// ─── Unicode reason fuzz ─────────────────────────────────────────────────

describe("AdminFinancialAuditingService unicode reason fuzz (runInRollback)", () => {
  test("Arabic/CJK reasons are accepted and stored safely: the audit trail carries only reasonPresent, never the raw text", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      // Fixture mirrors the real request-debit state: 100.00 pre-request,
      // the 30.00 reserve debited, so the wallet holds 70.00 available.
      const walletId = await seedWalletBalance(tx, teacherId, "70.00", "100.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "30.00");

      // Reject with an Arabic reason (leading/trailing whitespace exercises
      // the normalizer's trim alongside the non-Latin code points).
      const arabicReason = "  مبلغ السحب غير مطابق للسجلات  ";
      const rejected = await AdminFinancialAuditingService.rejectWithdrawal(adminId, pendingId, arabicReason, "en", tx);
      expect(rejected.status).toBe(TransactionStatus.Failed);
      // The reserve was restored: the pre-request balance (100.00) is back.
      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");

      // One audit row; the details vocabulary carries the reasonPresent
      // BOOLEAN — no Arabic code point survives into the audit trail.
      const rejectAudits = await readAuditsForTransaction(tx, pendingId);
      expect(rejectAudits).toHaveLength(1);
      const rejectDetails = rejectAudits[0]?.details ?? "";
      const rejectMetadata: unknown = JSON.parse(rejectDetails);
      expect(rejectMetadata).toEqual({
        action: DETAIL_ACTION_REJECTED,
        amount: "30.00",
        walletId,
        teacherId,
        reasonPresent: true,
      });
      expect(rejectDetails).not.toContain("مبلغ");
      expect(rejectDetails).not.toContain("للسجلات");

      // Adjust with a CJK reason: accepted; the LEDGER description is the
      // sanctioned store for the reason text, the audit details still carry
      // only the reasonPresent boolean.
      const cjkReason = "  調整の理由：善意のクレジット  ";
      const adjusted = await AdminFinancialAuditingService.adjustTeacherWallet(
        adminId,
        adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, cjkReason),
        "en",
        tx
      );
      expect(adjusted.type).toBe(TransactionType.Bonus);
      expect(adjusted.status).toBe(TransactionStatus.Completed);
      expect(adjusted.description).toBe("Manual bonus adjustment: 調整の理由：善意のクレジット");
      expect((await readWallet(tx, teacherId)).balance).toBe("105.00");

      const adjustAudits = await readAuditsForTransaction(tx, adjusted.id);
      expect(adjustAudits).toHaveLength(1);
      const adjustDetails = adjustAudits[0]?.details ?? "";
      const adjustMetadata: unknown = JSON.parse(adjustDetails);
      expect(adjustMetadata).toEqual({
        action: DETAIL_ACTION_ADJUSTMENT,
        direction: DETAIL_DIRECTION_CREDIT,
        amount: "5.00",
        teacherId,
        walletId,
        reasonPresent: true,
        balanceAfter: "105.00",
      });
      expect(adjustDetails).not.toContain("調整");
      expect(adjustDetails).not.toContain("善意");
    });
  });
});

// ─── Adjust success ──────────────────────────────────────────────────────

describe("AdminFinancialAuditingService.adjustTeacherWallet (runInRollback)", () => {
  test("credit direction: bonus/completed row, balance up, total_earning untouched, Adjust audit vocabulary", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "300.00");

      const ledger = await AdminFinancialAuditingService.adjustTeacherWallet(
        adminId,
        adjustmentInput(teacherId, "25.50", WalletAdjustmentDirection.Credit, "Goodwill credit"),
        "en",
        tx
      );

      expect(ledger.type).toBe(TransactionType.Bonus);
      expect(ledger.status).toBe(TransactionStatus.Completed);
      expect(ledger.amount).toBe("25.50");

      const walletRow = await readWallet(tx, teacherId);
      expect(walletRow.balance).toBe("125.50");
      expect(walletRow.totalEarning).toBe("300.00");

      const audits = await readAuditsForTransaction(tx, ledger.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actionType).toBe(AuditActionType.Adjust);
      expect(audits[0]?.entityType).toBe(TXN_ENTITY_TYPE);
      expect(audits[0]?.entityId).toBe(ledger.id);
      const metadata: unknown = JSON.parse(audits[0]?.details ?? "{}");
      expect(metadata).toEqual({
        action: DETAIL_ACTION_ADJUSTMENT,
        direction: DETAIL_DIRECTION_CREDIT,
        amount: "25.50",
        teacherId,
        walletId,
        reasonPresent: true,
        balanceAfter: "125.50",
      });
    });
  });

  test("debit direction: withdrawal/completed row, balance down, Adjust audit vocabulary", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "300.00");

      const ledger = await AdminFinancialAuditingService.adjustTeacherWallet(
        adminId,
        adjustmentInput(teacherId, "10.00", WalletAdjustmentDirection.Debit, "Duplicate payout correction"),
        "en",
        tx
      );

      expect(ledger.type).toBe(TransactionType.Withdrawal);
      expect(ledger.status).toBe(TransactionStatus.Completed);
      expect(ledger.amount).toBe("10.00");

      const walletRow = await readWallet(tx, teacherId);
      expect(walletRow.balance).toBe("90.00");
      expect(walletRow.totalEarning).toBe("300.00");

      const audits = await readAuditsForTransaction(tx, ledger.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actionType).toBe(AuditActionType.Adjust);
      const metadata: unknown = JSON.parse(audits[0]?.details ?? "{}");
      expect(metadata).toEqual({
        action: DETAIL_ACTION_ADJUSTMENT,
        direction: DETAIL_DIRECTION_DEBIT,
        amount: "10.00",
        teacherId,
        walletId,
        reasonPresent: true,
        balanceAfter: "90.00",
      });
    });
  });

  test("wallet-less teacher CAN receive a credit (the lazy ensure)", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);

      const ledger = await AdminFinancialAuditingService.adjustTeacherWallet(
        adminId,
        adjustmentInput(teacherId, "15.00", WalletAdjustmentDirection.Credit, "Bonus for a wallet-less teacher"),
        "en",
        tx
      );

      expect(ledger.type).toBe(TransactionType.Bonus);
      expect((await readWallet(tx, teacherId)).balance).toBe("15.00");
      expect(await readAuditsForTransaction(tx, ledger.id)).toHaveLength(1);
    });
  });

  test("validation matrix: malformed amounts are the pre-DB VALIDATION denial with zero side effects", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      const malformed = ["0", "0.00", "-5.00", "1.234", "12345678.00", "abc", "", "   "];
      const denyAt = async (amount: string): Promise<void> => {
        const caught = await expectServiceError(() =>
          AdminFinancialAuditingService.adjustTeacherWallet(
            adminId,
            adjustmentInput(teacherId, amount, WalletAdjustmentDirection.Credit, "validation probe"),
            "en",
            tx
          )
        );
        expectDomainDenial(caught, "VALIDATION", t().invalidAdjustmentAmount);
        expect(caught).toBeInstanceOf(ValidationError);
      };
      await denyAt(malformed[0] ?? "");
      await denyAt(malformed[1] ?? "");
      await denyAt(malformed[2] ?? "");
      await denyAt(malformed[3] ?? "");
      await denyAt(malformed[4] ?? "");
      await denyAt(malformed[5] ?? "");
      await denyAt(malformed[6] ?? "");
      await denyAt(malformed[7] ?? "");

      // Zero side effects across the whole matrix: one wallet row (no lazy
      // ensure fired), balance intact, empty ledger, no audit rows.
      const rows = await tx.select().from(wallet).where(eq(wallet.teacherId, teacherId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.balance).toBe("100.00");
      expect(await readLedger(tx, teacherId)).toHaveLength(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("reason validation: empty / whitespace-only / oversize are the pre-DB VALIDATION denial", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      const denyAt = async (reason: string): Promise<void> => {
        const caught = await expectServiceError(() =>
          AdminFinancialAuditingService.adjustTeacherWallet(
            adminId,
            adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, reason),
            "en",
            tx
          )
        );
        expectDomainDenial(caught, "VALIDATION", t().adjustmentReasonRequired);
        expect(caught).toBeInstanceOf(ValidationError);
      };
      await denyAt("");
      await denyAt("   ");
      await denyAt("r".repeat(230));

      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");
      expect(await readLedger(tx, teacherId)).toHaveLength(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("reason cap matches the ledger description column: 230-char reason rejected pre-DB (never reaches SQL), 229 boundary accepted", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      // One char over the 229 cap (the varchar(255) description capacity
      // minus the 26-char composed-prefix headroom): the pre-DB VALIDATION
      // denial fires BEFORE any database work — a Postgres 22001 overflow
      // inside the mutation is impossible.
      const caught = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          adminId,
          adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, "r".repeat(230)),
          "en",
          tx
        )
      );
      expectDomainDenial(caught, "VALIDATION", t().adjustmentReasonRequired);
      expect(caught).toBeInstanceOf(ValidationError);

      // Zero side effects: nothing reached the database.
      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");
      expect(await readLedger(tx, teacherId)).toHaveLength(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);

      // The 229 boundary reason is accepted: the composed 25-char marker +
      // reason stays within the varchar(255) description capacity.
      const boundaryReason = "r".repeat(229);
      const accepted = await AdminFinancialAuditingService.adjustTeacherWallet(
        adminId,
        adjustmentInput(teacherId, "5.00", WalletAdjustmentDirection.Credit, boundaryReason),
        "en",
        tx
      );
      expect(accepted.description).toBe(`Manual bonus adjustment: ${boundaryReason}`);
    });
  });

  test("garbage direction: fail-closed VALIDATION denial (never the debit branch), zero rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");

      // A non-GraphQL caller is not bound by the TypeScript enum — the JSON
      // round-trip erases the compile-time direction typing, so the runtime
      // garbage reaches the service exactly as a raw caller's payload would.
      const rawJson: unknown = JSON.parse(
        JSON.stringify({ teacherId, amount: "10.00", direction: "increase", reason: "direction probe" })
      );
      if (!isRawAdjustmentPayload(rawJson)) {
        throw new Error("test fixture: the raw adjustment payload guard failed");
      }
      const caught = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(adminId, rawJson, "en", tx)
      );
      expectDomainDenial(caught, "VALIDATION", t().invalidAdjustmentDirection);
      expect(caught).toBeInstanceOf(ValidationError);

      // Zero money movement: balance intact, empty ledger, no audit rows.
      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");
      expect(await readLedger(tx, teacherId)).toHaveLength(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("not-found: unknown teacherId is the localized teacher not-found, zero rows written", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      await createTeacher(tx);

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          adminId,
          adjustmentInput(987_654_321, "5.00", WalletAdjustmentDirection.Credit, "not-found probe"),
          "en",
          tx
        )
      );
      expectDomainDenial(error, "TEACHER_NOT_FOUND", t().teacherNotFound);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("insufficient funds: over-balance debit is the localized conflict, balance unchanged, zero rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "10.00", "10.00");

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          adminId,
          adjustmentInput(teacherId, "25.00", WalletAdjustmentDirection.Debit, "Over-balance probe"),
          "en",
          tx
        )
      );
      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "WALLET_INSUFFICIENT_FUNDS", t().insufficientBalance);

      // The orphan ledger row died with the savepoint rollback: balance
      // unchanged, ledger empty, no audit rows.
      expect((await readWallet(tx, teacherId)).balance).toBe("10.00");
      const ledger = await readLedger(tx, teacherId);
      expect(ledger).toHaveLength(0);
      expect(ledger.map(row => row.walletId)).toEqual([]);
      expect(await readAuditsForTransaction(tx, walletId)).toHaveLength(0);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });
});

// ─── Wrong state ─────────────────────────────────────────────────────────

describe("AdminFinancialAuditingService settlement wrong-state (runInRollback)", () => {
  test("settling an already-completed withdrawal is the localized not-pending conflict, zero audit rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const completedId = await seedPendingWithdrawal(tx, walletId, "40.00");
      await tx
        .update(teacherTransaction)
        .set({ status: TransactionStatus.Completed })
        .where(eq(teacherTransaction.id, completedId));

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(adminId, completedId, "en", tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "WITHDRAWAL_NOT_PENDING", t().withdrawalNotPending);

      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("settling an earning row is the localized not-pending conflict (type guard fails closed)", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const earning = await createTestTeacherTransaction(tx, walletId, null, {
        type: TransactionType.Earning,
        status: TransactionStatus.Completed,
      });

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(adminId, earning.id, "en", tx)
      );
      expect(error).toBeInstanceOf(ConflictError);
      expectDomainDenial(error, "WITHDRAWAL_NOT_PENDING", t().withdrawalNotPending);
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });
});

// ─── Rollback integrity ──────────────────────────────────────────────────

describe("AdminFinancialAuditingService rollback integrity (runInRollback)", () => {
  test("a mid-flight failure leaves NO ledger row and NO audit row (the shared commit/rollback fate)", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "10.00", "10.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "5.00");

      // Force the failure INSIDE the flow after the settle: an over-balance
      // adjustment compose rolls back the whole outer savepoint block.
      const forced = await expectServiceError(() =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          adminId,
          adjustmentInput(teacherId, "25.00", WalletAdjustmentDirection.Debit, "forced rollback probe"),
          "en",
          tx
        )
      );
      expect(forced).toBeInstanceOf(ConflictError);

      // The earlier state (pending row) survives untouched INSIDE the tx —
      // the savepoint rollback only removed the failed flow's writes.
      const [row] = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.id, pendingId)).limit(1);
      expect(row?.status).toBe(TransactionStatus.Pending);

      // NO audit row survived the forced failure.
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });

  test("a rejected reject-withdrawal (not-found) persists nothing: zero ledger churn, zero audit rows", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      const walletId = await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const pendingId = await seedPendingWithdrawal(tx, walletId, "30.00");

      const error = await expectServiceError(() =>
        AdminFinancialAuditingService.rejectWithdrawal(adminId, 987_654_321, "reason probe", "en", tx)
      );
      expectDomainDenial(error, "WITHDRAWAL_REQUEST_NOT_FOUND", t().withdrawalRequestNotFound);

      // The fixture row is byte-identical; no audit rows anywhere.
      const [row] = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.id, pendingId)).limit(1);
      expect(row?.status).toBe(TransactionStatus.Pending);
      expect((await readWallet(tx, teacherId)).balance).toBe("100.00");
      expect(await countAuditsForActor(tx, adminId)).toBe(0);
    });
  });
});

// ─── Concurrency ─────────────────────────────────────────────────────────

describe("AdminFinancialAuditingService double-approve race (runInRollback)", () => {
  test("exactly one approve wins, the replay is the not-pending conflict, the balance moved exactly once", async () => {
    await runInRollback(async tx => {
      const adminId = await createAdmin(tx);
      const teacherId = await createTeacher(tx);
      await seedWalletBalance(tx, teacherId, "100.00", "100.00");
      const walletRow = await readWallet(tx, teacherId);
      const pendingId = await seedPendingWithdrawal(tx, walletRow.id, "20.00");
      const reservedBalance = (await readWallet(tx, teacherId)).balance;

      // The services join the caller's transaction as SAVEPOINT blocks, so
      // the settle decisions run on one connection: the FIRST approve wins
      // the guarded single UPDATE, the replayed approve loses — its
      // re-asserted `status = pending` WHERE predicate matches zero rows and
      // the caller classifies the miss. (The true cross-connection
      // Promise.allSettled race is the journey harness's step-6 probe —
      // nested savepoints on one shared transaction cannot model two
      // independent claims without a name collision.)
      const winner = await AdminFinancialAuditingService.approveWithdrawal(adminId, pendingId, "en", tx);
      expect(winner.id).toBe(pendingId);
      expect(winner.status).toBe(TransactionStatus.Completed);

      const loser = await expectServiceError(() =>
        AdminFinancialAuditingService.approveWithdrawal(adminId, pendingId, "en", tx)
      );
      expect(loser).toBeInstanceOf(ConflictError);
      expectDomainDenial(loser, "WITHDRAWAL_NOT_PENDING", t().withdrawalNotPending);

      // Exactly one settled state: completed (never failed), the balance
      // moved exactly once (the reserve, never a second debit).
      const [row] = await tx.select().from(teacherTransaction).where(eq(teacherTransaction.id, pendingId)).limit(1);
      expect(row?.status).toBe(TransactionStatus.Completed);
      expect((await readWallet(tx, teacherId)).balance).toBe(reservedBalance);

      // Exactly ONE audit row for the settled row.
      const audits = await readAuditsForTransaction(tx, pendingId);
      expect(audits).toHaveLength(1);
      expect(audits[0]?.actionType).toBe(AuditActionType.Override);
    });
  });
});
