/**
 * StudentPaymentRepository tests — 4-Tier verification suite, including the
 * payment-ledger trigger matrix.
 *
 * Tier 1: Happy-path data access (insert, findBySubscriptionId — including
 *         the NULL-owner verification-style ledger row).
 * Tier 2: Boundary conditions (unknown subscription id → null).
 * Tier 3: Guarded decisions + allowed trigger matrix rows (pending→paid ✅,
 *         pending→failed ✅, replay zero-rows after a decision) — for
 *         student-owned AND NULL-owner rows alike.
 * Tier 4: Blocked trigger matrix rows (paid→anything ❌, amount tamper ❌,
 *         DELETE ❌) — each violated expectation raises the DB guard, proven
 *         through the `expectRepoError` try/catch helper inside an explicit
 *         SAVEPOINT bracket created AFTER the probe row insert (a failed
 *         statement aborts the surrounding transaction; the savepoint keeps
 *         it queryable). NEVER `expect(...).rejects` inside a rollback.
 *
 * Provider transaction reference matrix (the set-once ledger extension):
 * the guarded pending→paid|failed transition MAY record the gateway's
 * transaction id from NULL (Tier 3); overwriting or erasing a recorded
 * reference, writing one outside the guarded transition, and smuggling a
 * financial-column edit alongside the recording are all frozen (Tier 4).
 * The reconciliation read (`findStalePendingByGateway`) is covered for
 * gateway/status/recency filtering, oldest-first ordering, batch limit,
 * and the joined `payment_reference`.
 *
 * Probe gotchas encoded here: `now()` is transaction-stable (financial
 * columns are snapshotted before any write and compared after), and the
 * savepoint is opened after the ledger row exists so trigger probes match a
 * live row.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { StudentPaymentRepository } from "@/backend/db/repo/billing/student-payment.repository";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import {
  createTestPlan,
  createTestStudent,
  createTestSubscription,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type {
  DBTransaction,
  StudentPaymentInsertType,
  StudentPaymentSelectType,
  SubscriptionSelectType,
} from "@/backend/types";

/** Substring of the amended UPDATE guard's raised message. */
const UPDATE_GUARD_IMMUTABLE = "student_payments is immutable";
/** Substring of the amended UPDATE guard's permitted-exception clause. */
const UPDATE_GUARD_EXCEPTION = "permitted only to transition a pending payment";
/** Substring of the DELETE guard's raised message. */
const DELETE_GUARD_MESSAGE = "DELETE is not permitted";

/**
 * Walks the Drizzle error cause chain (cycle-safe) for a message substring —
 * Drizzle masks driver errors behind a generic message, so the raised
 * trigger text is reachable only through the chain.
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

/** One purchase pair: pending subscription + its pending payment row. */
interface PurchasePair {
  studentId: number;
  subscriptionId: number;
  payment: StudentPaymentSelectType;
}

/** Creates a user + student + plan + pending subscription + pending payment. */
async function createPurchasePair(
  tx: DBTransaction,
  paymentOverrides: Partial<StudentPaymentInsertType> = {},
  subscriptionOverrides: Partial<SubscriptionSelectType> = {}
): Promise<PurchasePair> {
  const user = await createTestUser(tx, { role: "student" });
  const student = await createTestStudent(tx, user.id);
  const plan = await createTestPlan(tx);
  const subscription = await createTestSubscription(tx, user.id, plan.id, {
    status: SubscriptionStatus.Pending,
    ...subscriptionOverrides,
  });

  const insert: StudentPaymentInsertType = {
    studentId: student.id,
    subscriptionId: subscription.id,
    amount: plan.price,
    currency: plan.currency,
    paymentGateway: PaymentGateway.Mock,
    status: PaymentStatus.Pending,
    ...paymentOverrides,
  };
  const payment = await StudentPaymentRepository.insertPayment(insert, tx);
  return { studentId: student.id, subscriptionId: subscription.id, payment };
}

describe("StudentPaymentRepository", () => {
  // ─── Tier 1: Happy Path Operations ──────────────────────────────────────

  test("insertPayment creates a pending ledger row echoing the financial columns verbatim", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "student" });
      const student = await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx);
      const subscription = await createTestSubscription(tx, user.id, plan.id, {
        status: SubscriptionStatus.Pending,
      });

      const inserted = await StudentPaymentRepository.insertPayment(
        {
          studentId: student.id,
          subscriptionId: subscription.id,
          amount: plan.price,
          currency: plan.currency,
          paymentGateway: PaymentGateway.Mock,
        },
        tx
      );

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.studentId).toBe(student.id);
      expect(inserted.subscriptionId).toBe(subscription.id);
      expect(inserted.amount).toBe(plan.price);
      expect(inserted.currency).toBe(plan.currency);
      expect(inserted.paymentGateway).toBe(PaymentGateway.Mock);
      expect(inserted.status).toBe(PaymentStatus.Pending);
      expect(inserted.createdAt).toBeInstanceOf(Date);
      expect(inserted.updatedAt).toBeInstanceOf(Date);
    });
  });

  test("findBySubscriptionId returns the attached payment, and null for an unknown subscription", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx);

      const found = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(found).not.toBeNull();
      if (found) {
        expect(found.id).toBe(payment.id);
        expect(found.studentId).toBe(payment.studentId);
        expect(found.subscriptionId).toBe(subscriptionId);
        expect(found.amount).toBe(payment.amount);
        expect(found.status).toBe(PaymentStatus.Pending);
      }

      expect(await StudentPaymentRepository.findBySubscriptionId(99999999, tx)).toBeNull();
    });
  });

  // ─── Tier 3: Guarded decisions — the ALLOWED trigger matrix rows ────────

  test("pending→paid: markPaidOnce flips only the status and freezes every financial column", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx);

      const paid = await StudentPaymentRepository.markPaidOnce(subscriptionId, tx);
      expect(paid).not.toBeNull();
      if (paid) {
        expect(paid.id).toBe(payment.id);
        expect(paid.status).toBe(PaymentStatus.Paid);
        // Column freeze: the decision redirects nothing.
        expect(paid.studentId).toBe(payment.studentId);
        expect(paid.subscriptionId).toBe(payment.subscriptionId);
        expect(paid.amount).toBe(payment.amount);
        expect(paid.currency).toBe(payment.currency);
        expect(paid.paymentGateway).toBe(payment.paymentGateway);
        expect(paid.createdAt).toEqual(payment.createdAt);
        expect(paid.updatedAt).toBeInstanceOf(Date);
      }

      // Replay delivery: the guarded UPDATE matches zero rows (no pending
      // payment left) — a no-op, not an error, and the transaction survives.
      expect(await StudentPaymentRepository.markPaidOnce(subscriptionId, tx)).toBeNull();

      // A failed decision can never reach a decided (paid) row.
      expect(await StudentPaymentRepository.markFailedOnce(subscriptionId, tx)).toBeNull();
    });
  });

  test("pending→failed: markFailedOnce flips only the status; the failed state is terminal", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx);

      const failed = await StudentPaymentRepository.markFailedOnce(subscriptionId, tx);
      expect(failed).not.toBeNull();
      if (failed) {
        expect(failed.id).toBe(payment.id);
        expect(failed.status).toBe(PaymentStatus.Failed);
        expect(failed.amount).toBe(payment.amount);
        expect(failed.paymentGateway).toBe(payment.paymentGateway);
        expect(failed.createdAt).toEqual(payment.createdAt);
      }

      // Replay of the same outcome: zero rows.
      expect(await StudentPaymentRepository.markFailedOnce(subscriptionId, tx)).toBeNull();

      // A late `confirmed` after a `failed` decision is rejected by the
      // repo guard before the trigger is even consulted: zero rows.
      expect(await StudentPaymentRepository.markPaidOnce(subscriptionId, tx)).toBeNull();

      // The ledger row still reads failed and untouched.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.status).toBe(PaymentStatus.Failed);
      expect(after?.amount).toBe(payment.amount);
    });
  });

  // ─── Tier 4: BLOCKED trigger matrix rows (DB guard raises) ──────────────

  test("paid→anything: the DB guard rejects re-opening and re-deciding a decided payment", async () => {
    await runInRollback(async tx => {
      const { subscriptionId } = await createPurchasePair(tx);
      const paid = await StudentPaymentRepository.markPaidOnce(subscriptionId, tx);
      if (!paid) {
        throw new Error("trigger matrix setup: expected the pending payment to flip to paid");
      }
      expect(paid.status).toBe(PaymentStatus.Paid);

      // Bracket 1 — paid → pending (re-open).
      await tx.execute(sql`savepoint pay_guard_reopen_probe`);
      const reopenError = await expectRepoError(() =>
        tx.update(studentPayments).set({ status: PaymentStatus.Pending }).where(eq(studentPayments.id, paid.id))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_reopen_probe`);
      expect(causeChainContainsMessage(reopenError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(reopenError, UPDATE_GUARD_EXCEPTION)).toBe(true);

      // Bracket 2 — paid → failed (re-decide).
      await tx.execute(sql`savepoint pay_guard_redecide_probe`);
      const redecideError = await expectRepoError(() =>
        tx.update(studentPayments).set({ status: PaymentStatus.Failed }).where(eq(studentPayments.id, paid.id))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_redecide_probe`);
      expect(causeChainContainsMessage(redecideError, UPDATE_GUARD_IMMUTABLE)).toBe(true);

      // Post-rollback the paid row is intact and the transaction is usable.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.status).toBe(PaymentStatus.Paid);
    });
  });

  test("amount tamper: the DB guard rejects a decision that touches the amount — and any amount edit at all", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx);
      const tamperedAmount = "999.99";
      expect(payment.amount).not.toBe(tamperedAmount);

      // Bracket 1 — amount tamper smuggled inside the permitted transition.
      await tx.execute(sql`savepoint pay_guard_tamper_transition_probe`);
      const transitionError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ status: PaymentStatus.Paid, amount: tamperedAmount })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_tamper_transition_probe`);
      expect(causeChainContainsMessage(transitionError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(transitionError, UPDATE_GUARD_EXCEPTION)).toBe(true);

      // Bracket 2 — amount tamper with the status untouched.
      await tx.execute(sql`savepoint pay_guard_tamper_only_probe`);
      const tamperOnlyError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ amount: tamperedAmount })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_tamper_only_probe`);
      expect(causeChainContainsMessage(tamperOnlyError, UPDATE_GUARD_IMMUTABLE)).toBe(true);

      // Post-rollback: still pending, amount never moved.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.status).toBe(PaymentStatus.Pending);
      expect(after?.amount).toBe(payment.amount);
    });
  });

  test("DELETE: the append-only ledger cannot be deleted — the delete guard raises", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx);

      await tx.execute(sql`savepoint pay_guard_delete_probe`);
      const deleteError = await expectRepoError(() =>
        tx.delete(studentPayments).where(eq(studentPayments.id, payment.id))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_delete_probe`);

      expect(causeChainContainsMessage(deleteError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(deleteError, DELETE_GUARD_MESSAGE)).toBe(true);

      // Post-rollback the ledger row survived the blocked delete.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.id).toBe(payment.id);
    });
  });

  // ─── Tier 3: findStalePendingByGateway — the reconciliation read ───────

  test("findStalePendingByGateway returns only stale pending rows of the gateway, joined with the payment reference", async () => {
    await runInRollback(async tx => {
      const staleCreatedAt = new Date(Date.now() - 90 * 60_000);
      const olderThan = new Date(Date.now() - 30 * 60_000);
      const paymobReference = `paymob-ref-${randomUUID()}`;

      // Baselines BEFORE seeding: the shared dev database carries stale
      // pending paymob rows from earlier live-testing sessions (the ledger
      // is append-only — they cannot be removed), so the assertions below
      // are baseline-relative: the read must return the baseline batch
      // EXACTLY plus this test's new stale row, and nothing else.
      const paymobBaseline = await StudentPaymentRepository.findStalePendingByGateway(
        PaymentGateway.Paymob,
        olderThan,
        100,
        tx
      );
      const stripeBaseline = await StudentPaymentRepository.findStalePendingByGateway(
        PaymentGateway.Stripe,
        olderThan,
        100,
        tx
      );

      // Recent paymob pair (default created_at — NOT stale yet) and a stale
      // pair on the mock gateway: both must be filtered out.
      const recentPaymob = await createPurchasePair(tx, { paymentGateway: PaymentGateway.Paymob });
      await createPurchasePair(tx, { createdAt: staleCreatedAt });
      const stalePaymob = await createPurchasePair(
        tx,
        { paymentGateway: PaymentGateway.Paymob, createdAt: staleCreatedAt },
        { paymentReference: paymobReference }
      );

      const rows = await StudentPaymentRepository.findStalePendingByGateway(PaymentGateway.Paymob, olderThan, 100, tx);

      // Exactly ONE new row vs the baseline — the stale paymob row. The
      // recent pair (freshness filter) and the mock-gateway pair (gateway
      // filter) never appear.
      const baselineIds = new Set(paymobBaseline.map(row => row.id));
      const fresh = rows.filter(row => !baselineIds.has(row.id));
      expect(fresh.map(row => row.id)).toEqual([stalePaymob.payment.id]);
      const row = fresh[0];
      if (!row) {
        throw new Error("reconciliation read: expected the stale paymob row to be returned");
      }
      expect(row.paymentGateway).toBe(PaymentGateway.Paymob);
      expect(row.status).toBe(PaymentStatus.Pending);
      expect(row.paymentReference).toBe(paymobReference);
      expect(row.providerTransactionId).toBeNull();
      expect(rows.some(candidate => candidate.id === recentPaymob.payment.id)).toBe(false);

      // A gateway with no stale pending rows yields the (empty) baseline batch.
      expect(
        await StudentPaymentRepository.findStalePendingByGateway(PaymentGateway.Stripe, olderThan, 100, tx)
      ).toEqual(stripeBaseline);
    });
  });

  test("findStalePendingByGateway excludes decided payments and honors the batch limit oldest-first", async () => {
    await runInRollback(async tx => {
      const olderThan = new Date(Date.now() - 30 * 60_000);
      const oldest = await createPurchasePair(tx, {
        paymentGateway: PaymentGateway.Paymob,
        createdAt: new Date(Date.now() - 120 * 60_000),
      });
      const middle = await createPurchasePair(tx, {
        paymentGateway: PaymentGateway.Paymob,
        createdAt: new Date(Date.now() - 90 * 60_000),
      });
      const newest = await createPurchasePair(tx, {
        paymentGateway: PaymentGateway.Paymob,
        createdAt: new Date(Date.now() - 60 * 60_000),
      });

      // A decided (paid) payment leaves the stale-pending population even
      // though its created_at is the oldest of the batch.
      expect(await StudentPaymentRepository.markPaidOnce(oldest.subscriptionId, tx)).not.toBeNull();

      const rows = await StudentPaymentRepository.findStalePendingByGateway(PaymentGateway.Paymob, olderThan, 100, tx);

      // The read is globally oldest-first (the sweep's drain order).
      const createdAtOrder = rows.map(row => row.createdAt.getTime());
      expect(createdAtOrder.toSorted((a, b) => a - b)).toEqual(createdAtOrder);

      // This test's own rows: the decided oldest is excluded; middle and
      // newest remain, seeded creation order echoed.
      const ownIds = new Set([oldest.payment.id, middle.payment.id, newest.payment.id]);
      const own = rows.filter(row => ownIds.has(row.id));
      expect(own.map(row => row.id)).toEqual([middle.payment.id, newest.payment.id]);
      expect(own.map(row => row.createdAt.getTime())).toEqual([
        middle.payment.createdAt.getTime(),
        newest.payment.createdAt.getTime(),
      ]);

      // The batch limit caps the sweep pass, keeping the oldest first: the
      // capped read is the prefix of the uncapped one.
      const limited = await StudentPaymentRepository.findStalePendingByGateway(PaymentGateway.Paymob, olderThan, 1, tx);
      expect(limited.map(row => row.id)).toEqual(rows.slice(0, 1).map(row => row.id));
    });
  });

  // ─── Tier 3: provider transaction reference — the ALLOWED matrix row ────

  test("the guarded transition may record the provider transaction reference exactly once, from null", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx, { paymentGateway: PaymentGateway.Paymob });
      expect(payment.providerTransactionId).toBeNull();

      const updated = await tx
        .update(studentPayments)
        .set({ status: PaymentStatus.Paid, providerTransactionId: "paymob-txn-7f3a9c" })
        .where(eq(studentPayments.subscriptionId, subscriptionId))
        .returning();

      expect(updated).toHaveLength(1);
      expect(updated[0]?.status).toBe(PaymentStatus.Paid);
      expect(updated[0]?.providerTransactionId).toBe("paymob-txn-7f3a9c");
      // The column freeze is untouched by the reference recording.
      expect(updated[0]?.amount).toBe(payment.amount);
      expect(updated[0]?.currency).toBe(payment.currency);
      expect(updated[0]?.studentId).toBe(payment.studentId);
      expect(updated[0]?.createdAt).toEqual(payment.createdAt);

      // The reference is OPTIONAL inside the transition: the repo's own
      // status-only writers keep working (replay stays a zero-row no-op).
      expect(await StudentPaymentRepository.markPaidOnce(subscriptionId, tx)).toBeNull();
    });
  });

  test("a pending payment can be decided without recording any provider transaction reference", async () => {
    await runInRollback(async tx => {
      const { subscriptionId } = await createPurchasePair(tx, { paymentGateway: PaymentGateway.Paymob });

      const failed = await StudentPaymentRepository.markFailedOnce(subscriptionId, tx);
      expect(failed).not.toBeNull();
      expect(failed?.providerTransactionId).toBeNull();
      expect(failed?.status).toBe(PaymentStatus.Failed);
    });
  });

  // ─── Tier 4: provider transaction reference — BLOCKED matrix rows ───────

  test("a recorded provider transaction reference can never be overwritten or erased", async () => {
    await runInRollback(async tx => {
      const seededReference = "paymob-txn-seeded";
      const { subscriptionId, payment } = await createPurchasePair(tx, {
        paymentGateway: PaymentGateway.Paymob,
      });
      expect(payment.providerTransactionId).toBeNull();

      // The reference is recorded exactly once, from NULL, inside the
      // guarded decision — the only path the pending-insert CHECK admits
      // (`student_payments_pending_provider_transaction_check`).
      const decided = await StudentPaymentRepository.markPaidOnce(subscriptionId, tx, seededReference);
      expect(decided?.status).toBe(PaymentStatus.Paid);
      expect(decided?.providerTransactionId).toBe(seededReference);

      // Bracket 1 — overwrite: the decided row sits outside the guarded
      // transition, so every further write to the reference is frozen.
      await tx.execute(sql`savepoint pay_ref_overwrite_probe`);
      const overwriteError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ status: PaymentStatus.Paid, providerTransactionId: "paymob-txn-other" })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_overwrite_probe`);
      expect(causeChainContainsMessage(overwriteError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(overwriteError, UPDATE_GUARD_EXCEPTION)).toBe(true);

      // Bracket 2 — erasure: the same freeze, the recorded link never drops.
      await tx.execute(sql`savepoint pay_ref_erase_probe`);
      const eraseError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ status: PaymentStatus.Failed, providerTransactionId: null })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_erase_probe`);
      expect(causeChainContainsMessage(eraseError, UPDATE_GUARD_IMMUTABLE)).toBe(true);

      // The recorded reference still rides with the decided row — the
      // audit link to the provider's ledger is as frozen as the money.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.status).toBe(PaymentStatus.Paid);
      expect(after?.providerTransactionId).toBe(seededReference);
    });
  });

  test("the provider transaction reference cannot be written outside the guarded transition", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx, { paymentGateway: PaymentGateway.Paymob });

      // Bracket 1 — a still-pending row: no transition, so no reference.
      await tx.execute(sql`savepoint pay_ref_pending_write_probe`);
      const pendingWriteError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ providerTransactionId: "paymob-txn-early" })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_pending_write_probe`);
      expect(causeChainContainsMessage(pendingWriteError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(pendingWriteError, UPDATE_GUARD_EXCEPTION)).toBe(true);

      // Bracket 2 — a decided row: even a fresh reference write is frozen.
      expect(await StudentPaymentRepository.markPaidOnce(subscriptionId, tx)).not.toBeNull();
      await tx.execute(sql`savepoint pay_ref_decided_write_probe`);
      const decidedWriteError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ providerTransactionId: "paymob-txn-late" })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_decided_write_probe`);
      expect(causeChainContainsMessage(decidedWriteError, UPDATE_GUARD_IMMUTABLE)).toBe(true);

      // Post-rollback the row is paid and the reference was never recorded.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.id).toBe(payment.id);
      expect(after?.providerTransactionId).toBeNull();
    });
  });

  test("the financial-column freeze holds while the reference is recorded: amount and currency edits are rejected", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createPurchasePair(tx, { paymentGateway: PaymentGateway.Paymob });
      const tamperedAmount = "999.99";
      expect(payment.amount).not.toBe(tamperedAmount);

      // Bracket 1 — amount edit smuggled alongside status + reference.
      await tx.execute(sql`savepoint pay_ref_amount_probe`);
      const amountError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ status: PaymentStatus.Paid, providerTransactionId: "paymob-txn-ok", amount: tamperedAmount })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_amount_probe`);
      expect(causeChainContainsMessage(amountError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(amountError, UPDATE_GUARD_EXCEPTION)).toBe(true);

      // Bracket 2 — currency edit smuggled alongside status + reference.
      await tx.execute(sql`savepoint pay_ref_currency_probe`);
      const currencyError = await expectRepoError(() =>
        tx
          .update(studentPayments)
          .set({ status: PaymentStatus.Paid, providerTransactionId: "paymob-txn-ok", currency: "USD" })
          .where(eq(studentPayments.subscriptionId, subscriptionId))
      );
      await tx.execute(sql`rollback to savepoint pay_ref_currency_probe`);
      expect(causeChainContainsMessage(currencyError, UPDATE_GUARD_IMMUTABLE)).toBe(true);

      // The clean decision still lands: status moves, money never does.
      const paid = await StudentPaymentRepository.markPaidOnce(subscriptionId, tx);
      expect(paid?.status).toBe(PaymentStatus.Paid);
      expect(paid?.amount).toBe(payment.amount);
      expect(paid?.currency).toBe(payment.currency);
      expect(paid?.providerTransactionId).toBeNull();
    });
  });
});

// ─── NULL student owner: verification-style ledger rows ───────────────────

/** One verification-style pair: pending subscription + its NULL-owner pending payment row. */
interface NullOwnerPaymentPair {
  subscriptionId: number;
  payment: StudentPaymentSelectType;
}

/**
 * Creates a purchaser WITHOUT a `students` row + plan + pending subscription
 * + pending payment with a NULL student owner — the ledger shape of a
 * purchase whose owner of record is the subscription's generic `user_id`.
 */
async function createNullOwnerPaymentPair(tx: DBTransaction): Promise<NullOwnerPaymentPair> {
  const user = await createTestUser(tx, { role: "teacher" });
  const plan = await createTestPlan(tx);
  const subscription = await createTestSubscription(tx, user.id, plan.id, {
    status: SubscriptionStatus.Pending,
  });

  const insert: StudentPaymentInsertType = {
    studentId: null,
    subscriptionId: subscription.id,
    amount: plan.price,
    currency: plan.currency,
    paymentGateway: PaymentGateway.Mock,
    status: PaymentStatus.Pending,
  };
  const payment = await StudentPaymentRepository.insertPayment(insert, tx);
  return { subscriptionId: subscription.id, payment };
}

describe("StudentPaymentRepository — NULL student owner (verification-style rows)", () => {
  test("insertPayment accepts studentId = NULL and the owner-less row round-trips", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createNullOwnerPaymentPair(tx);

      expect(payment.id).toBeGreaterThan(0);
      expect(payment.studentId).toBeNull();
      expect(payment.subscriptionId).toBe(subscriptionId);
      expect(payment.amount).toBe("200.00");
      expect(payment.currency).toBe("EGP");
      expect(payment.paymentGateway).toBe(PaymentGateway.Mock);
      expect(payment.status).toBe(PaymentStatus.Pending);
      expect(payment.createdAt).toBeInstanceOf(Date);

      // The NULL owner survives the read path untouched.
      const found = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(found?.id).toBe(payment.id);
      expect(found?.studentId).toBeNull();
    });
  });

  test("pending→paid: the status decision is permitted for a NULL-owner row and the owner stays frozen", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createNullOwnerPaymentPair(tx);

      const paid = await StudentPaymentRepository.markPaidOnce(subscriptionId, tx);
      expect(paid).not.toBeNull();
      if (paid) {
        expect(paid.id).toBe(payment.id);
        expect(paid.status).toBe(PaymentStatus.Paid);
        // Column freeze: the decision neither adopts an owner nor moves one.
        expect(paid.studentId).toBeNull();
        expect(paid.subscriptionId).toBe(payment.subscriptionId);
        expect(paid.amount).toBe(payment.amount);
        expect(paid.createdAt).toEqual(payment.createdAt);
      }

      // Replay / opposite decision: zero rows, exactly as for student rows.
      expect(await StudentPaymentRepository.markPaidOnce(subscriptionId, tx)).toBeNull();
      expect(await StudentPaymentRepository.markFailedOnce(subscriptionId, tx)).toBeNull();
    });
  });

  test("DELETE: a NULL-owner ledger row is equally append-only — the delete guard raises", async () => {
    await runInRollback(async tx => {
      const { subscriptionId, payment } = await createNullOwnerPaymentPair(tx);

      await tx.execute(sql`savepoint pay_guard_null_owner_delete_probe`);
      const deleteError = await expectRepoError(() =>
        tx.delete(studentPayments).where(eq(studentPayments.id, payment.id))
      );
      await tx.execute(sql`rollback to savepoint pay_guard_null_owner_delete_probe`);

      expect(causeChainContainsMessage(deleteError, UPDATE_GUARD_IMMUTABLE)).toBe(true);
      expect(causeChainContainsMessage(deleteError, DELETE_GUARD_MESSAGE)).toBe(true);

      // Post-rollback the owner-less ledger row survived the blocked delete.
      const after = await StudentPaymentRepository.findBySubscriptionId(subscriptionId, tx);
      expect(after?.id).toBe(payment.id);
      expect(after?.studentId).toBeNull();
    });
  });
});
