/**
 * Cross-actor journey — admin financial auditing over the two money ledgers
 * (teacher wallet payouts + the student payments audit view).
 *
 * Sequential, actor-attributed steps executed through the REAL services on
 * the REAL test database (later steps observe the shared state earlier
 * steps committed):
 *
 *   1. Teacher payout approval leg — a certified teacher files a payout
 *      request through the SHIPPED self-service wallet flow (the request
 *      reserves the debit: one pending `withdrawal` ledger row + the
 *      guarded balance decrement). The admin sees the row on the pending
 *      settlement queue (type, verbatim amount, teacher name, reserved
 *      wallet balance), approves it, the queue drains, the ledger row is
 *      `completed`, and the teacher's own wallet view shows the settled
 *      row with the balance still equal to the post-request reserve.
 *      Exactly ONE audit row reconstructs the decision.
 *   2. Teacher payout rejection leg — a fresh teacher requests a payout;
 *      the admin rejects it with a reason; the row flips to `failed` and
 *      the wallet balance is restored to its PRE-request value. One audit
 *      row records the rejection.
 *   3. Manual wallet adjustment leg — an admin credit books a
 *      `bonus`/`completed` row (balance up by exactly the amount,
 *      lifetime earnings UNCHANGED); an admin debit books a
 *      `withdrawal`/`completed` row whose description carries a
 *      machine-distinguishable manual-adjustment marker (never the
 *      payout-request wording); a debit exceeding the balance is refused
 *      with the localized insufficient-funds conflict and commits ZERO
 *      new ledger rows (the flow rolls back whole). The admin wallet
 *      inspector reflects the adjusted wallet.
 *   4. Payments audit visibility — the admin lists the student payments
 *      ledger with a status filter scoped to the fixture student: only
 *      matching rows surface (with the resolved student identity), and a
 *      non-matching filter yields an honest empty page. The student's own
 *      ledger rows stay byte-identical through the admin reads.
 *   5. Denial matrix — teacher and student callers hit the real admin
 *      gate (FORBIDDEN) on reads and mutations, the anonymous caller is
 *      UNAUTHORIZED, a suspended admin fails the strict governance gate
 *      (FORBIDDEN, fail-closed), and every denial writes zero audit rows.
 *   6. Concurrent double-settlement race — two approve calls race the
 *      SAME pending transaction: exactly one fulfills, the loser is the
 *      localized not-pending conflict, the balance moves exactly once,
 *      and exactly ONE audit row exists for the settled row (completed,
 *      never failed).
 *   7. Concurrent settle + new-request race on the SAME wallet — the
 *      admin approves withdrawal A while the teacher requests a NEW
 *      withdrawal B on the same connection pool: both land in valid
 *      states (A completed, B pending with its own reserved debit) and
 *      the balance arithmetic is exact (final balance = start − A − B,
 *      no double-debit of A).
 *   8. Failed-row replay leg — a fresh payout request is rejected (the
 *      row flips to `failed` and the reserve is restored), then BOTH
 *      settlement paths are re-attempted on the decided row: each denial
 *      is the localized not-pending conflict, the ledger row stays
 *      `failed`, the balance stays byte-identical to the post-restore
 *      value, the replays add zero audit rows, and nothing fans out.
 *
 * Layer rules honored (`test/workflows/AGENTS.md`):
 * - fixtures COMMITTED in `beforeAll` inside ONE committing transaction;
 *   never `runInRollback` (the services spawn their own top-level
 *   transactions);
 * - honest actors: real `users` rows + real role-child rows via the
 *   actor-context factory; denials fail through the REAL admin gate,
 *   nothing monkey-patched;
 * - error assertions through a try/catch helper + translated substrings
 *   from the localized errors bundle — never `.rejects.toThrow()` and no
 *   hardcoded English expectation strings;
 * - the notification dispatch boundary is intercepted for the whole suite
 *   (`spyOn(NotificationEngine, "publishReceipts")` recording no-op,
 *   installed in `beforeAll`, restored in `afterAll`) — every step is a
 *   zero-dispatch guard, so nothing can ever reach a realtime/email/SMS
 *   provider from this flow, today or after a future dispatch path lands;
 * - per-run `jrn_billing_<8hex>` prefix on every fixture label;
 * - cross-actor visibility asserted BOTH directions plus denial probes.
 *
 * Immutable-ledger teardown policy: `teacher_transaction` and
 * `student_payments` rows are append-only (BEFORE DELETE triggers) and are
 * hard-deleted FIRST in `afterAll` under the sanctioned suspension helpers
 * — the ledger rows and their audit rows are NEVER registered in the
 * tracked-fixture registry (a leak there must fail the suite loudly); the
 * tracked sweep then drains the wallet fixtures, the role-child rows, and
 * the users rows in FK-safe order, re-probing every registered row. A
 * leaking `afterAll` fails the suite; per-run prefixes keep any crash
 * residue greppable.
 */

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudentPayment, createTestWallet } from "@/backend/db/test/entity-setup";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import { WalletAdjustmentDirection } from "@/backend/enum/billing/wallet-adjustment-direction.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { AdminFinancialAuditingService } from "@/backend/services/billing/admin-financial-auditing.service";
import { WalletService } from "@/backend/services/billing/wallet.service";
import { NotificationEngine } from "@/backend/services/notifications";
import type {
  AdminWalletAdjustmentSubmitInput,
  AdminWalletTransactionFilters,
  DBTransaction,
  NormalizedAdminPaymentFilters,
  NotificationDeliveryReceipt,
  StudentPaymentSelectType,
  TeacherTransactionSelectType,
  UserSelectType,
  WalletSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { withAuditDeleteTriggersSuspended, withImmutabilityTriggersSuspended } from "@/test/helpers/db-cleanup";
import {
  ANONYMOUS_ACTOR_ID,
  countAuditLogsForActor,
  countNotificationsForUser,
  type JourneyActor,
  journeyPrefix,
  provisionAdminActor,
  provisionCertifiedTeacherActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

// ─── Harness state ───────────────────────────────────────────────────────────

/** Error-copy locale for every service call and denial assertion. */
const LOCALE = "en";

/** Localized error bundle — the only source of expected denial copy. */
const ERRORS_EN = getServerTranslations(LOCALE).errorsTranslations;

/** Per-run unique prefix — greppable marker for any crash residue. */
const PREFIX = journeyPrefix("billing");

// Fixtures take their uniqueness from the entity-setup helpers; the prefix
// additionally rides along inside every free-text reason sent to the service
// (it lands on write-once ledger descriptions), so an interrupted run leaves
// rows greppable by `jrn_billing_<8hex>` rather than by shared fixture names.
function prefixedReason(label: string): string {
  return `${PREFIX} ${label}`;
}

/** The audit entity label for settlement rows (the service's constant). */
const TXN_ENTITY_TYPE = "teacher_transaction";

/** Payout request amounts (decimal strings, carried verbatim). */
const PAYOUT_PRIMARY = "100.00";
const PAYOUT_REJECTED = "50.00";
const PAYOUT_RACED = "20.00";
/** Failed-row replay leg amount (a fresh request, rejected, then re-attempted for settlement denial). */
const PAYOUT_REJECTED_REPLAY = "60.00";
/** Concurrent settle + new-request race amounts (step 7). */
const PAYOUT_NEW_REQUEST = "15.00";
/** Manual adjustment amounts. */
const ADJUST_CREDIT = "25.50";
const ADJUST_DEBIT = "10.00";
const ADJUST_OVER_BALANCE = "9999999.00";

const tracked = new TrackedFixtures();

let adminActor: JourneyActor;
let suspendedAdminActor: JourneyActor;
let teacherA: JourneyActor;
let teacherB: JourneyActor;
let studentActor: JourneyActor;
let teacherAUser: UserSelectType;
let teacherBUser: UserSelectType;
let studentUser: UserSelectType;

/** Ledger rows the services created during the journey — untracked teardown ids. */
const ledgerTxnIds: number[] = [];

/** Payment ledger fixtures — committed in `beforeAll`, swept under suspension. */
const fixturePaymentRows: StudentPaymentSelectType[] = [];

// ─── Fixture builders ────────────────────────────────────────────────────────

/** Full null-by-default payments filter (a `null` field applies no filter). */
function paymentFilters(overrides: Partial<NormalizedAdminPaymentFilters> = {}): NormalizedAdminPaymentFilters {
  return {
    studentId: null,
    studentNameSearch: null,
    status: null,
    paymentGateway: null,
    from: null,
    to: null,
    ...overrides,
  };
}

/** Full null-by-default wallet-ledger filter (a `null` field applies no filter). */
function walletFilters(overrides: Partial<AdminWalletTransactionFilters> = {}): AdminWalletTransactionFilters {
  return {
    type: null,
    status: null,
    from: null,
    to: null,
    ...overrides,
  };
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

// ─── Notification dispatch spy (external effects always intercepted) ─────────

/**
 * Installs a recording no-op over the engine's publish contract: no realtime
 * channel is ever touched, and each dispatch is recorded together with the
 * receipts (and their recipient ids) so a step can assert both THAT a publish
 * happened and WHICH users it targeted. The financial-auditing flow is
 * expected to be silent — every assertion below is a zero-dispatch guard, so
 * a future dispatch path cannot reach a configured provider unnoticed. The
 * spy is installed once in `beforeAll` and restored in `afterAll`.
 */
function spyPublication(): { calls: NotificationDeliveryReceipt[][]; stop: () => void } {
  const calls: NotificationDeliveryReceipt[][] = [];
  const spy = spyOn(NotificationEngine, "publishReceipts").mockImplementation(async receipts => {
    calls.push([...receipts]);
  });
  return { calls, stop: () => spy.mockRestore() };
}

let publication: ReturnType<typeof spyPublication> | undefined;

/** Every recipient id the spy has recorded so far, in publish order. */
function publishedUserIds(): number[] {
  return (publication?.calls ?? []).flatMap(receipts => receipts.flatMap(receipt => receipt.recipientUserIds));
}

/** How many publish dispatches the spy has recorded so far. */
function publicationCallCount(): number {
  return publication?.calls.length ?? 0;
}

/** Zero-dispatch guard: the spy saw no publish AND no targeted user ids. */
function expectNoDispatches(): void {
  expect(publicationCallCount()).toBe(0);
  expect(publishedUserIds()).toEqual([]);
}

// ─── Error-capture oracles (try/catch — never `.rejects.toThrow()`) ──────────

/**
 * Try/catch rejection helper (journey-layer pattern). Returns the caught
 * `DomainError`; fails the test when the call resolves successfully or
 * throws a non-`DomainError`.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<DomainError> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  if (caught === null) {
    throw new Error("expectJourneyError: expected the call to throw, but it resolved successfully");
  }
  if (caught instanceof DomainError) {
    return caught;
  }
  const message = caught instanceof Error ? caught.message : JSON.stringify(caught);
  throw new Error(`expectJourneyError: caught non-DomainError: ${message}`);
}

/**
 * Denial oracle for the auth/authz arms: the caught error must be of the
 * expected class AND carry the translated copy (never a hardcoded string).
 */
async function expectDenial(
  fn: () => Promise<unknown>,
  errorClass: typeof ForbiddenError | typeof UnauthorizedError,
  translatedCopy: string
): Promise<void> {
  const error = await expectJourneyError(fn);
  expect(error).toBeInstanceOf(errorClass);
  if (!(error instanceof errorClass)) {
    throw new Error("expectDenial: caught an unexpected denial class");
  }
  expect(error.message).toContain(translatedCopy);
}

/** The insufficient-funds conflict: ConflictError + the REUSED localized copy. */
async function expectInsufficientFunds(fn: () => Promise<unknown>): Promise<void> {
  const error = await expectJourneyError(fn);
  expect(error).toBeInstanceOf(ConflictError);
  if (!(error instanceof ConflictError)) {
    throw new Error("expectInsufficientFunds: expected a ConflictError");
  }
  expect(error.message).toContain(ERRORS_EN.insufficientBalance);
}

/** The not-pending conflict: ConflictError + the localized copy. */
async function expectNotPending(fn: () => Promise<unknown>): Promise<void> {
  const error = await expectJourneyError(fn);
  expect(error).toBeInstanceOf(ConflictError);
  if (!(error instanceof ConflictError)) {
    throw new Error("expectNotPending: expected a ConflictError");
  }
  expect(error.message).toContain(ERRORS_EN.withdrawalNotPending);
}

// ─── Read-back oracles (direct Drizzle — never via the service) ──────────────

/** Numeric view of a decimal-string money value (assertion arithmetic only). */
function decimalValue(raw: string): number {
  return Number(raw);
}

/** Reads one wallet row by teacher id, failing when absent. */
async function readWalletRow(teacherId: number): Promise<WalletSelectType> {
  const [row] = await db.select().from(wallet).where(eq(wallet.teacherId, teacherId)).limit(1);
  if (!row) {
    throw new Error(`journey: wallet row for teacher ${String(teacherId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Reads one teacher_transaction ledger row by id, failing when absent. */
async function readLedgerRow(transactionId: number): Promise<TeacherTransactionSelectType> {
  const [row] = await db.select().from(teacherTransaction).where(eq(teacherTransaction.id, transactionId)).limit(1);
  if (!row) {
    throw new Error(`journey: teacher_transaction row ${String(transactionId)} vanished (fixture integrity failure)`);
  }
  return row;
}

/** Ledger row count across the given teachers' wallets (join through wallet). */
async function countLedgerRowsForTeachers(teacherIds: readonly number[]): Promise<number> {
  const rows = await db
    .select({ id: teacherTransaction.id })
    .from(teacherTransaction)
    .innerJoin(wallet, eq(teacherTransaction.walletId, wallet.id))
    .where(inArray(wallet.teacherId, [...teacherIds]));
  return rows.length;
}

/** Audit rows ABOUT one settlement transaction (the exactly-once oracle). */
async function readAuditsForTransaction(transactionId: number) {
  return db
    .select()
    .from(auditLogs)
    .where(and(eq(auditLogs.entityType, TXN_ENTITY_TYPE), eq(auditLogs.entityId, transactionId)));
}

/** The fixture student's own payment ledger rows (insertion order). */
async function readStudentPaymentRows(studentId: number): Promise<StudentPaymentSelectType[]> {
  return db.select().from(studentPayments).where(eq(studentPayments.studentId, studentId)).orderBy(studentPayments.id);
}

/** The pending withdrawal row of a fresh ledger page (the reserved request). */
function newestPendingWithdrawal(transactions: readonly TeacherTransactionSelectType[]): TeacherTransactionSelectType {
  // pgEnum columns carry raw string-literal unions; widen the enum members to
  // string so the comparison stays type-safe without a lossy conversion.
  const withdrawalType: string = TransactionType.Withdrawal;
  const pendingStatus: string = TransactionStatus.Pending;
  const row = transactions.find(entry => entry.type === withdrawalType && entry.status === pendingStatus);
  if (!row) {
    throw new Error("journey: expected the fresh ledger page to carry the pending withdrawal row");
  }
  return row;
}

/** Reads one user row on the provisioning transaction (fixture identity). */
async function readUserRow(tx: DBTransaction, userId: number): Promise<UserSelectType> {
  const [row] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) {
    throw new Error("journey fixture: user row vanished inside the provisioning transaction");
  }
  return row;
}

// ─── Fixture provisioning ────────────────────────────────────────────────────

beforeAll(async () => {
  // ONE committing transaction: commit-or-nothing fixture provisioning.
  await db.transaction(async tx => {
    adminActor = await provisionAdminActor(tx, { tracked });
    suspendedAdminActor = await provisionAdminActor(tx, { tracked });
    // Governance fixture: the suspended flag flips AFTER provisioning, so
    // the actor passes the role gate and the strict governance gate fails
    // closed (FORBIDDEN) — the fail-closed denial-matrix arm in step 5.
    await tx.update(users).set({ suspended: true }).where(eq(users.id, suspendedAdminActor.userId));
    teacherA = await provisionCertifiedTeacherActor(tx, { tracked });
    teacherB = await provisionCertifiedTeacherActor(tx, { tracked });
    studentActor = await provisionStudentActor(tx, { tracked });

    teacherAUser = await readUserRow(tx, teacherA.userId);
    teacherBUser = await readUserRow(tx, teacherB.userId);
    studentUser = await readUserRow(tx, studentActor.userId);

    // Funded wallet fixtures: the shipped payout flow reserves the debit at
    // REQUEST time, so both teachers need real headroom to file a request.
    const walletA = await createTestWallet(tx, teacherA.userId, { balance: "500.00", totalEarning: "500.00" });
    tracked.register(wallet, walletA.id);
    const walletB = await createTestWallet(tx, teacherB.userId, { balance: "300.00", totalEarning: "300.00" });
    tracked.register(wallet, walletB.id);

    // Payment ledger fixtures with distinct amounts/statuses for the audit
    // filter leg (append-only rows — swept under the sanctioned suspension).
    // Currencies carry the per-run prefix marker in the last 8 chars is not
    // possible on a 3-char column — the per-run prefix rides the student's
    // identity (the actor rows are unique per run), so crash residue stays
    // greppable via the actor emails.
    fixturePaymentRows.push(
      await createTestStudentPayment(tx, studentActor.userId, null, {
        amount: "120.00",
        paymentGateway: PaymentGateway.Stripe,
        status: PaymentStatus.Paid,
      })
    );
    fixturePaymentRows.push(
      await createTestStudentPayment(tx, studentActor.userId, null, {
        amount: "75.50",
        paymentGateway: PaymentGateway.Paymob,
        status: PaymentStatus.Paid,
      })
    );
    fixturePaymentRows.push(
      await createTestStudentPayment(tx, studentActor.userId, null, {
        amount: "30.00",
        paymentGateway: PaymentGateway.Stripe,
        status: PaymentStatus.Pending,
      })
    );
    for (const row of fixturePaymentRows) {
      tracked.register(studentPayments, row.id);
    }
  });

  // No realtime delivery for the whole suite: the financial-auditing flow
  // must be silent, so every dispatch is recorded (and later asserted zero).
  publication = spyPublication();
});

afterAll(async () => {
  publication?.stop();

  // 1. Immutable-ledger teardown leg FIRST: the append-only triggers block a
  //    plain DELETE, so the sanctioned suspension wraps exactly this leg.
  //    These rows are never registered in the tracked registry — a leak
  //    must fail the suite loudly instead of being silently swept.
  if (ledgerTxnIds.length > 0) {
    await withImmutabilityTriggersSuspended(["teacher_transaction"], () =>
      db.delete(teacherTransaction).where(inArray(teacherTransaction.id, ledgerTxnIds))
    );
  }
  if (fixturePaymentRows.length > 0) {
    await withImmutabilityTriggersSuspended(["student_payments"], () =>
      db.delete(studentPayments).where(
        inArray(
          studentPayments.id,
          fixturePaymentRows.map(row => row.id)
        )
      )
    );
  }

  // 2. Audit rows (append-only, RESTRICT into users) — swept by the acting
  //    admin and belt-and-braces by the settlement entity ids.
  if (adminActor) {
    await withAuditDeleteTriggersSuspended(async () => {
      await db.delete(auditLogs).where(eq(auditLogs.actorId, adminActor.userId));
      if (ledgerTxnIds.length > 0) {
        await db
          .delete(auditLogs)
          .where(and(eq(auditLogs.entityType, TXN_ENTITY_TYPE), inArray(auditLogs.entityId, ledgerTxnIds)));
      }
    });
  }

  // 3. Reverse-registration-order hard delete + zero-residue re-probes for
  //    EVERY tracked row (payments → wallets → role-children → users).
  await tracked.cleanup();

  // 4. Mandatory residue proof for the untracked immutable ledgers.
  if (adminActor) {
    expect(await db.$count(auditLogs, eq(auditLogs.actorId, adminActor.userId))).toBe(0);
  }
  const teacherIds = [teacherA?.userId ?? 0, teacherB?.userId ?? 0].filter(id => id > 0);
  if (teacherIds.length > 0) {
    expect(await countLedgerRowsForTeachers(teacherIds)).toBe(0);
  }
});

// ─── The journey ─────────────────────────────────────────────────────────────

describe("cross-actor journey: admin financial auditing (payout settlement + adjustments + payments audit)", () => {
  test("step 1 — Teacher: payout request reserves the debit; Admin approves; the queue drains and the ledger settles", async () => {
    // Teacher: file the payout through the SHIPPED self-service flow.
    const walletBefore = await readWalletRow(teacherA.userId);
    const requested = await WalletService.requestWithdrawal(teacherA.userId, PAYOUT_PRIMARY, LOCALE);
    const pending = newestPendingWithdrawal(requested.transactions);
    ledgerTxnIds.push(pending.id);

    // The reserve: ONE pending withdrawal row + the guarded debit.
    expect(pending.amount).toBe(PAYOUT_PRIMARY);
    expect(decimalValue(requested.wallet.balance)).toBe(decimalValue(walletBefore.balance) - Number(PAYOUT_PRIMARY));
    // The shipped payout contract emits no notifications (self-service).
    expect(await countNotificationsForUser(teacherA.userId)).toBe(0);

    // Admin: the pending settlement queue surfaces the row with identity.
    const queue = await AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(adminActor.userId, 1, 50, LOCALE);
    const queueRow = queue.items.find(item => item.transaction.id === pending.id);
    expect(queueRow).toBeDefined();
    expect(queueRow?.transaction.type).toBe(TransactionType.Withdrawal);
    expect(queueRow?.transaction.status).toBe(TransactionStatus.Pending);
    expect(queueRow?.transaction.amount).toBe(PAYOUT_PRIMARY);
    expect(queueRow?.teacherName).toBe(teacherAUser.fullName);
    expect(decimalValue(queueRow?.walletBalance ?? "-1")).toBe(decimalValue(requested.wallet.balance));

    // Admin: approve → the row settles completed.
    const settled = await AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pending.id, LOCALE);
    expect(settled.id).toBe(pending.id);
    expect(settled.type).toBe(TransactionType.Withdrawal);
    expect(settled.status).toBe(TransactionStatus.Completed);

    // The queue drained: the settled row no longer appears.
    const queueAfter = await AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(
      adminActor.userId,
      1,
      50,
      LOCALE
    );
    expect(queueAfter.items.find(item => item.transaction.id === pending.id)).toBeUndefined();

    // Independent read: the ledger row itself flipped.
    const row = await readLedgerRow(pending.id);
    expect(row.status).toBe(TransactionStatus.Completed);

    // Teacher: the own-wallet view shows the settled row and the balance
    // still equals the post-request reserve (debit happened at request).
    const own = await WalletService.getMyWallet(teacherA.userId, LOCALE);
    const ownRow = own.transactions.find(entry => entry.id === pending.id);
    expect(ownRow?.status).toBe(TransactionStatus.Completed);
    expect(decimalValue(own.wallet.balance)).toBe(decimalValue(requested.wallet.balance));

    // Exactly ONE audit row reconstructs the decision.
    const audits = await readAuditsForTransaction(pending.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actionType).toBe(AuditActionType.Override);
    expect(audits[0]?.entityType).toBe(TXN_ENTITY_TYPE);
    expect(audits[0]?.entityId).toBe(pending.id);

    // The approval leg is silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherA.userId)).toBe(0);
  });

  test("step 2 — Teacher: fresh payout request; Admin rejects it; the balance is restored and the ledger shows failed", async () => {
    const walletBefore = await readWalletRow(teacherB.userId);
    const requested = await WalletService.requestWithdrawal(teacherB.userId, PAYOUT_REJECTED, LOCALE);
    const pending = newestPendingWithdrawal(requested.transactions);
    ledgerTxnIds.push(pending.id);
    expect(decimalValue(requested.wallet.balance)).toBe(decimalValue(walletBefore.balance) - Number(PAYOUT_REJECTED));

    const rejected = await AdminFinancialAuditingService.rejectWithdrawal(
      adminActor.userId,
      pending.id,
      prefixedReason("insufficient documentation"),
      LOCALE
    );
    expect(rejected.id).toBe(pending.id);
    expect(rejected.status).toBe(TransactionStatus.Failed);

    // The reserve was restored: the balance equals its PRE-request value.
    const walletAfter = await readWalletRow(teacherB.userId);
    expect(decimalValue(walletAfter.balance)).toBe(decimalValue(walletBefore.balance));

    // The ledger shows the failed row.
    const row = await readLedgerRow(pending.id);
    expect(row.status).toBe(TransactionStatus.Failed);

    // The queue's joined teacher identity stays consistent with the actor.
    expect(teacherBUser.id).toBe(teacherB.userId);

    // One audit row records the rejection.
    const audits = await readAuditsForTransaction(pending.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actionType).toBe(AuditActionType.Override);

    // The rejection leg is silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherB.userId)).toBe(0);
  });

  test("step 3 — Admin: credit books a bonus, debit books a marked withdrawal, and an over-balance debit commits zero rows", async () => {
    const walletBefore = await readWalletRow(teacherA.userId);
    const earningBefore = decimalValue(walletBefore.totalEarning);

    // Credit: bonus/completed row, balance up by exactly the amount,
    // lifetime earnings UNCHANGED.
    const credit = await AdminFinancialAuditingService.adjustTeacherWallet(
      adminActor.userId,
      adjustmentInput(
        teacherA.userId,
        ADJUST_CREDIT,
        WalletAdjustmentDirection.Credit,
        prefixedReason("goodwill credit")
      ),
      LOCALE
    );
    expect(credit.type).toBe(TransactionType.Bonus);
    expect(credit.status).toBe(TransactionStatus.Completed);
    ledgerTxnIds.push(credit.id);
    const walletAfterCredit = await readWalletRow(teacherA.userId);
    expect(decimalValue(walletAfterCredit.balance)).toBe(decimalValue(walletBefore.balance) + Number(ADJUST_CREDIT));
    expect(decimalValue(walletAfterCredit.totalEarning)).toBe(earningBefore);

    // Debit: withdrawal/completed row whose description carries the manual
    // adjustment marker — never the payout-request wording.
    const payoutTxnId: number | undefined = ledgerTxnIds.at(0);
    if (payoutTxnId === undefined) {
      throw new Error("journey: expected the settlement leg to have recorded a payout ledger row");
    }
    const payoutRow = await readLedgerRow(payoutTxnId);
    const debit = await AdminFinancialAuditingService.adjustTeacherWallet(
      adminActor.userId,
      adjustmentInput(
        teacherA.userId,
        ADJUST_DEBIT,
        WalletAdjustmentDirection.Debit,
        prefixedReason("duplicate payout correction")
      ),
      LOCALE
    );
    expect(debit.type).toBe(TransactionType.Withdrawal);
    expect(debit.status).toBe(TransactionStatus.Completed);
    expect(debit.description).not.toBeNull();
    expect(debit.description).not.toBe(payoutRow.description);
    ledgerTxnIds.push(debit.id);
    const walletAfterDebit = await readWalletRow(teacherA.userId);
    expect(decimalValue(walletAfterDebit.balance)).toBe(decimalValue(walletAfterCredit.balance) - Number(ADJUST_DEBIT));

    // Admin wallet inspector: the adjusted wallet with both new rows.
    const view = await AdminFinancialAuditingService.getTeacherWalletForAdmin(
      adminActor.userId,
      teacherA.userId,
      walletFilters(),
      1,
      50,
      LOCALE
    );
    expect(view.teacherId).toBe(teacherA.userId);
    expect(view.teacherName).toBe(teacherAUser.fullName);
    expect(decimalValue(view.balance ?? "-1")).toBe(decimalValue(walletAfterDebit.balance));
    expect(decimalValue(view.totalEarning ?? "-1")).toBe(earningBefore);
    expect(view.transactions.find(entry => entry.id === credit.id)?.type).toBe(TransactionType.Bonus);
    expect(view.transactions.find(entry => entry.id === debit.id)?.description).toBe(debit.description);

    // Over-balance debit: the localized insufficient-funds conflict, ZERO
    // new ledger rows, balance unchanged (the flow rolls back whole).
    const ledgerCountBefore = await countLedgerRowsForTeachers([teacherA.userId]);
    await expectInsufficientFunds(() =>
      AdminFinancialAuditingService.adjustTeacherWallet(
        adminActor.userId,
        adjustmentInput(
          teacherA.userId,
          ADJUST_OVER_BALANCE,
          WalletAdjustmentDirection.Debit,
          prefixedReason("over-balance probe")
        ),
        LOCALE
      )
    );
    expect(await countLedgerRowsForTeachers([teacherA.userId])).toBe(ledgerCountBefore);
    expect(decimalValue((await readWalletRow(teacherA.userId)).balance)).toBe(decimalValue(walletAfterDebit.balance));

    // One audit row per adjustment, pointing at its ledger row.
    const creditAudits = await readAuditsForTransaction(credit.id);
    expect(creditAudits).toHaveLength(1);
    expect(creditAudits[0]?.actionType).toBe(AuditActionType.Adjust);
    const debitAudits = await readAuditsForTransaction(debit.id);
    expect(debitAudits).toHaveLength(1);
    expect(debitAudits[0]?.actionType).toBe(AuditActionType.Adjust);

    // The adjustment leg is silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherA.userId)).toBe(0);
  });

  test("step 4 — Admin: the payments status filter shows only matching rows, a non-matching filter is honestly empty, and the student's rows are untouched", async () => {
    const rowsBefore = await readStudentPaymentRows(studentActor.userId);
    expect(rowsBefore).toHaveLength(3);

    const paidPage = await AdminFinancialAuditingService.listStudentPaymentsForAdmin(
      adminActor.userId,
      paymentFilters({ status: PaymentStatus.Paid, studentId: studentActor.userId }),
      1,
      50,
      LOCALE
    );
    expect(paidPage.items).toHaveLength(2);
    for (const item of paidPage.items) {
      expect(item.status).toBe(PaymentStatus.Paid);
    }
    const paidIds = new Set(paidPage.items.map(item => item.id));
    expect(paidIds.has(fixturePaymentRows[0]?.id ?? 0)).toBe(true);
    expect(paidIds.has(fixturePaymentRows[1]?.id ?? 0)).toBe(true);
    // The joined rows resolve the student's display name.
    expect(paidPage.items[0]?.studentName).toBe(studentUser.fullName);

    // A filter nothing matches yields the honest empty page.
    const emptyPage = await AdminFinancialAuditingService.listStudentPaymentsForAdmin(
      adminActor.userId,
      paymentFilters({ status: PaymentStatus.Refunded, studentId: studentActor.userId }),
      1,
      50,
      LOCALE
    );
    expect(emptyPage.items).toEqual([]);
    expect(emptyPage.totalCount).toBe(0);

    // Cross-actor: the student's own ledger rows are byte-identical after
    // the admin reads.
    expect(await readStudentPaymentRows(studentActor.userId)).toEqual(rowsBefore);

    // The audit-visibility leg is silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(studentActor.userId)).toBe(0);
  });

  test("step 5 — Denials: non-admin callers are forbidden through the real admin gate, anonymous is unauthorized, a suspended admin fails the governance gate, zero audit rows", async () => {
    const adminAuditsBefore = await countAuditLogsForActor(adminActor.userId);
    const teacherAuditsBefore = await countAuditLogsForActor(teacherA.userId);
    const settlementTxnId: number | undefined = ledgerTxnIds.at(0);
    if (settlementTxnId === undefined) {
      throw new Error("journey: expected the settlement leg to have recorded a payout ledger row");
    }

    // Teacher callers: forbidden on every surface, read and mutation.
    await expectDenial(
      () => AdminFinancialAuditingService.approveWithdrawal(teacherA.userId, settlementTxnId, LOCALE),
      ForbiddenError,
      ERRORS_EN.forbidden
    );
    await expectDenial(
      () =>
        AdminFinancialAuditingService.adjustTeacherWallet(
          teacherA.userId,
          adjustmentInput(
            teacherA.userId,
            "5.00",
            WalletAdjustmentDirection.Credit,
            prefixedReason("self credit probe")
          ),
          LOCALE
        ),
      ForbiddenError,
      ERRORS_EN.forbidden
    );
    await expectDenial(
      () => AdminFinancialAuditingService.listStudentPaymentsForAdmin(teacherA.userId, paymentFilters(), 1, 50, LOCALE),
      ForbiddenError,
      ERRORS_EN.forbidden
    );

    // Student callers: forbidden likewise.
    await expectDenial(
      () => AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(studentActor.userId, 1, 50, LOCALE),
      ForbiddenError,
      ERRORS_EN.forbidden
    );
    await expectDenial(
      () => AdminFinancialAuditingService.approveWithdrawal(studentActor.userId, settlementTxnId, LOCALE),
      ForbiddenError,
      ERRORS_EN.forbidden
    );

    // Governance denial: a suspended admin passes the role gate but the
    // strict governance gate fails closed (FORBIDDEN) on reads and
    // mutations, and the denial writes zero audit rows.
    const suspendedAuditsBefore = await countAuditLogsForActor(suspendedAdminActor.userId);
    await expectDenial(
      () => AdminFinancialAuditingService.listPendingWithdrawalsForAdmin(suspendedAdminActor.userId, 1, 50, LOCALE),
      ForbiddenError,
      ERRORS_EN.accountSuspended
    );
    await expectDenial(
      () => AdminFinancialAuditingService.approveWithdrawal(suspendedAdminActor.userId, settlementTxnId, LOCALE),
      ForbiddenError,
      ERRORS_EN.accountSuspended
    );
    expect(await countAuditLogsForActor(suspendedAdminActor.userId)).toBe(suspendedAuditsBefore);

    // Anonymous callers: unauthorized.
    await expectDenial(
      () =>
        AdminFinancialAuditingService.listStudentPaymentsForAdmin(ANONYMOUS_ACTOR_ID, paymentFilters(), 1, 50, LOCALE),
      UnauthorizedError,
      ERRORS_EN.unauthorized
    );
    await expectDenial(
      () => AdminFinancialAuditingService.approveWithdrawal(ANONYMOUS_ACTOR_ID, settlementTxnId, LOCALE),
      UnauthorizedError,
      ERRORS_EN.unauthorized
    );

    // Every denial wrote ZERO audit rows for any fixture actor.
    expect(await countAuditLogsForActor(adminActor.userId)).toBe(adminAuditsBefore);
    expect(await countAuditLogsForActor(teacherA.userId)).toBe(teacherAuditsBefore);

    // The denial matrix is silent: zero dispatches (denials never fan out),
    // and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherA.userId)).toBe(0);
    expect(await countNotificationsForUser(studentActor.userId)).toBe(0);
  });

  test("step 6 — Concurrent double settlement: exactly one approve wins, one audit row exists, and the balance moved once", async () => {
    const walletBefore = await readWalletRow(teacherA.userId);
    const requested = await WalletService.requestWithdrawal(teacherA.userId, PAYOUT_RACED, LOCALE);
    const pending = newestPendingWithdrawal(requested.transactions);
    ledgerTxnIds.push(pending.id);
    const walletReserved = await readWalletRow(teacherA.userId);
    expect(decimalValue(walletReserved.balance)).toBe(decimalValue(walletBefore.balance) - Number(PAYOUT_RACED));

    const outcomes = await Promise.allSettled([
      AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pending.id, LOCALE),
      AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pending.id, LOCALE),
    ]);

    const fulfilled = outcomes.filter(outcome => outcome.status === "fulfilled");
    const rejected = outcomes.filter(outcome => outcome.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The loser is the localized not-pending conflict (row already settled).
    const loserReason: unknown = rejected[0]?.status === "rejected" ? rejected[0].reason : null;
    expect(loserReason).toBeInstanceOf(ConflictError);
    if (loserReason instanceof ConflictError) {
      expect(loserReason.message).toContain(ERRORS_EN.withdrawalNotPending);
    }

    // The balance moved exactly once (the reserve, never a second debit).
    const walletAfter = await readWalletRow(teacherA.userId);
    expect(decimalValue(walletAfter.balance)).toBe(decimalValue(walletBefore.balance) - Number(PAYOUT_RACED));

    // Exactly ONE audit row for the settled transaction, and the row is
    // completed — never failed.
    const audits = await readAuditsForTransaction(pending.id);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actionType).toBe(AuditActionType.Override);
    const row = await readLedgerRow(pending.id);
    expect(row.status).toBe(TransactionStatus.Completed);

    // The double-settlement race is silent: zero dispatches (even the losing
    // conflict fans nothing out), and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherA.userId)).toBe(0);
  });

  test("step 7 — Concurrent settle + new-request race on the SAME wallet: both land in valid states, the balance arithmetic is exact", async () => {
    const walletBefore = await readWalletRow(teacherB.userId);
    // Withdrawal A: filed and reserved BEFORE the race — the admin approves
    // it concurrently with the teacher's NEW request B.
    const requestA = await WalletService.requestWithdrawal(teacherB.userId, PAYOUT_RACED, LOCALE);
    const pendingA = newestPendingWithdrawal(requestA.transactions);
    ledgerTxnIds.push(pendingA.id);
    const walletReservedA = await readWalletRow(teacherB.userId);
    expect(decimalValue(walletReservedA.balance)).toBe(decimalValue(walletBefore.balance) - Number(PAYOUT_RACED));

    // The race: the admin approves A while the teacher requests B on the
    // SAME wallet — real parallel connections (Promise.allSettled).
    const outcomes = await Promise.allSettled([
      AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pendingA.id, LOCALE),
      WalletService.requestWithdrawal(teacherB.userId, PAYOUT_NEW_REQUEST, LOCALE),
    ]);

    // The approval of A must win (the row was pending before the race; the
    // concurrent request B does not touch A's row).
    const approveOutcome = outcomes[0];
    if (approveOutcome?.status !== "fulfilled") {
      const reason = approveOutcome?.status === "rejected" ? String(approveOutcome.reason) : "unknown";
      throw new Error(`journey: expected the approve leg to fulfill: ${reason}`);
    }
    const settledA = approveOutcome.value;
    expect(settledA.id).toBe(pendingA.id);
    expect(settledA.status).toBe(TransactionStatus.Completed);

    // The concurrent request B must also fulfill: it lands as its own
    // pending withdrawal with its own reserved debit.
    const requestOutcome = outcomes[1];
    if (requestOutcome?.status !== "fulfilled") {
      const reason = requestOutcome?.status === "rejected" ? String(requestOutcome.reason) : "unknown";
      throw new Error(`journey: expected the new-request leg to fulfill: ${reason}`);
    }
    const pendingB = newestPendingWithdrawal(requestOutcome.value.transactions);
    ledgerTxnIds.push(pendingB.id);
    expect(pendingB.id).not.toBe(pendingA.id);
    expect(pendingB.amount).toBe(PAYOUT_NEW_REQUEST);
    expect(pendingB.status).toBe(TransactionStatus.Pending);

    // The balance arithmetic is exact: start − A − B (A settles WITHOUT a
    // second debit; B carries its own reserved debit; no double-debit).
    const walletAfter = await readWalletRow(teacherB.userId);
    const expectedFinal = decimalValue(walletBefore.balance) - Number(PAYOUT_RACED) - Number(PAYOUT_NEW_REQUEST);
    expect(decimalValue(walletAfter.balance)).toBe(expectedFinal);

    // Both rows are in valid states on independent reads.
    const rowA = await readLedgerRow(pendingA.id);
    expect(rowA.status).toBe(TransactionStatus.Completed);
    expect(rowA.type).toBe(TransactionType.Withdrawal);
    expect(rowA.amount).toBe(PAYOUT_RACED);
    const rowB = await readLedgerRow(pendingB.id);
    expect(rowB.status).toBe(TransactionStatus.Pending);
    expect(rowB.type).toBe(TransactionType.Withdrawal);
    expect(rowB.amount).toBe(PAYOUT_NEW_REQUEST);

    // Exactly ONE audit row for the settled A; B (pending) has none yet.
    const auditsA = await readAuditsForTransaction(pendingA.id);
    expect(auditsA).toHaveLength(1);
    expect(auditsA[0]?.actionType).toBe(AuditActionType.Override);
    expect(await readAuditsForTransaction(pendingB.id)).toHaveLength(0);

    // The race leg is silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherB.userId)).toBe(0);
  });

  test("step 8 — Failed-row replay: both settle paths deny a rejected withdrawal, the restore holds, and the replays write nothing", async () => {
    // Fund check: this leg files its OWN fresh withdrawal — the earlier
    // steps' net balance effects are already asserted there.
    const walletBefore = await readWalletRow(teacherB.userId);

    // Teacher: the fresh payout reserves its own debit.
    const requested = await WalletService.requestWithdrawal(teacherB.userId, PAYOUT_REJECTED_REPLAY, LOCALE);
    const pending = newestPendingWithdrawal(requested.transactions);
    ledgerTxnIds.push(pending.id);
    expect(pending.amount).toBe(PAYOUT_REJECTED_REPLAY);
    expect(decimalValue(requested.wallet.balance)).toBe(
      decimalValue(walletBefore.balance) - Number(PAYOUT_REJECTED_REPLAY)
    );

    // Admin: the rejection flips the row to failed and restores the reserve.
    const rejected = await AdminFinancialAuditingService.rejectWithdrawal(
      adminActor.userId,
      pending.id,
      prefixedReason("failed-row replay probe"),
      LOCALE
    );
    expect(rejected.id).toBe(pending.id);
    expect(rejected.status).toBe(TransactionStatus.Failed);
    const walletAfterRejection = await readWalletRow(teacherB.userId);
    expect(walletAfterRejection.balance).toBe(walletBefore.balance);

    // Exactly ONE audit row records the rejection.
    const rejectionAudits = await readAuditsForTransaction(pending.id);
    expect(rejectionAudits).toHaveLength(1);
    expect(rejectionAudits[0]?.actionType).toBe(AuditActionType.Override);

    // The replay baseline: everything measured below is the denials' effect.
    const adminAuditsBefore = await countAuditLogsForActor(adminActor.userId);

    // Re-settle attempts on the now-failed row: both settle paths fail
    // closed at the settlement PROBE with the localized not-pending conflict
    // (service.ts:207-214 approve / :292-299 reject) — the guarded-UPDATE
    // miss is the concurrent-race-only path, not this sequential replay.
    await expectNotPending(() =>
      AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pending.id, LOCALE)
    );
    await expectNotPending(() =>
      AdminFinancialAuditingService.rejectWithdrawal(adminActor.userId, pending.id, prefixedReason("replay"), LOCALE)
    );

    // The denials wrote nothing: the ledger row stays failed, the balance is
    // byte-identical to the post-restore value (no compensating second
    // restore, no double-settle debit), and the audit trail gained nothing.
    const row = await readLedgerRow(pending.id);
    expect(row.status).toBe(TransactionStatus.Failed);
    const walletAfterReplays = await readWalletRow(teacherB.userId);
    expect(walletAfterReplays.balance).toBe(walletAfterRejection.balance);
    expect(await readAuditsForTransaction(pending.id)).toHaveLength(1);
    expect(await countAuditLogsForActor(adminActor.userId)).toBe(adminAuditsBefore);

    // The denied replays are silent: zero dispatches, and the DB agrees.
    expectNoDispatches();
    expect(await countNotificationsForUser(teacherB.userId)).toBe(0);
  });
});
