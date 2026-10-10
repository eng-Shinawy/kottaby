/**
 * Financial-ledger immutability proof — trigger-tier probes for the two
 * append-only financial tables (`teacher_transaction`, `student_payments`)
 * plus the `audit_logs` trail, all governed by the same immutability trigger
 * migration.
 *
 *  1. Trigger-presence probe — `pg_trigger` is queried for ALL THREE tables
 *     and BOTH the BEFORE UPDATE and BEFORE DELETE triggers must be present
 *     with the wiring proven from `tgtype`: row-level, BEFORE timing, and
 *     bound to the expected event. They must also fire for
 *     application-origin DML (`tgenabled` 'O' or 'A') — a disabled ('D') or
 *     replica-only ('R') trigger, or one timed AFTER / bound to the wrong
 *     event, fails the probe instead of silently weakening the tamper proofs.
 *
 *  2. Adversarial tamper probes — inside `runInRollback`, each direct
 *     `tx.update(...)` / `tx.delete(...)` attempt is bracketed in its own
 *     SAVEPOINT (`savepoint` / `rollback to savepoint`), so a raised
 *     exception never aborts the outer transaction: the row can be read
 *     back and re-probed afterwards. Attempts MUST throw with the exact
 *     raised message, captured with a try/catch probe (NEVER
 *     `rejects.toThrow`, which deadlocks the rollback wrapper).
 *     Covered: teacher_transaction UPDATE (row compared unchanged) +
 *     DELETE (row still present) + the relabeling settlement probe (an
 *     earning row relabeled to withdrawal/completed RAISES); the four
 *     settlement-guard residual cells against the amended
 *     `prevent_teacher_transaction_update()` guard (a pending→pending
 *     no-op rewrite, re-opening a decided withdrawal, a description
 *     rewrite riding a valid settle, and a session_id NULL-swap riding a
 *     valid settle — each RAISES with the row byte-identical after);
 *     student_payments tamper UPDATE on a
 *     decided (paid) row (the full guarded-transition matrix lives in the
 *     StudentPaymentRepository suite); an idempotent re-probe (the same
 *     UPDATE fails identically on repeat, in a separate savepoint); and
 *     the compensating-row doctrine (a corrective INSERT succeeds while
 *     mutation of the original row fails — corrections flow through new
 *     rows, never in-place edits); plus direct UPDATE/DELETE probes against
 *     a fixture audit_logs row — the third immutable table gets the same
 *     behavioral proof, not just the presence probe.
 *
 * The teacher_transaction and student_payments tiers use the shared
 * savepoint/trigger-raise probe scaffold
 * (`@/backend/db/test/logic/invariants/invariant-probe.helpers`); the
 * audit_logs tier keeps the file-local savepoint/chain helpers.
 *
 * DB SAFETY: every database statement in this file runs inside
 * `runInRollback` with the `tx` passed through — no fixture row ever
 * commits, and no global trigger state is touched (probes only read
 * `pg_trigger` and tamper inside savepoints).
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { WalletRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import {
  createTestSession,
  createTestStudent,
  createTestStudentPayment,
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
import { expectTriggerRaise, probeInsideSavepoint } from "@/backend/db/test/logic/invariants/invariant-probe.helpers";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { TransactionStatus } from "@/backend/enum/billing/transaction-status.enum";
import { TransactionType } from "@/backend/enum/billing/transaction-type.enum";
import type { DBTransaction } from "@/backend/types";
import { isPgliteProvider } from "@/test/helpers/skip-when-pglite";

// ─── Contracts under pin ─────────────────────────────────────────────────────

/** The immutability triggers the canonical migration installs on each table. */
const IMMUTABLE_TABLES = ["teacher_transaction", "student_payments", "audit_logs"] as const;

const TEACHER_TX_UPDATE_TRIGGER = "prevent_teacher_transaction_update_trigger";
const TEACHER_TX_DELETE_TRIGGER = "prevent_teacher_transaction_delete_trigger";
const PAYMENTS_UPDATE_TRIGGER = "prevent_student_payments_update_trigger";
const PAYMENTS_DELETE_TRIGGER = "prevent_student_payments_delete_trigger";
const AUDIT_UPDATE_TRIGGER = "prevent_audit_logs_update_trigger";
const AUDIT_DELETE_TRIGGER = "prevent_audit_logs_delete_trigger";

/** Raised message substrings per table (canonical migration DDL). The
 * teacher_transaction UPDATE trigger carries the settlement exception: a
 * pending withdrawal may settle to completed/failed (all columns unchanged),
 * so its message differs from the plain immutable rows. */
const TEACHER_TX_IMMUTABLE = "teacher_transaction is immutable";
const TEACHER_TX_UPDATE_MSG = "UPDATE is permitted only to settle a pending withdrawal";
const TEACHER_TX_DELETE_MSG = "DELETE is not permitted";
const PAYMENTS_IMMUTABLE = "student_payments is immutable";
const AUDIT_IMMUTABLE = "audit_logs is immutable";
const AUDIT_UPDATE_MSG = "UPDATE is not permitted";
const AUDIT_DELETE_MSG = "DELETE is not permitted";

// ─── Trigger-presence probe helpers ──────────────────────────────────────────

/** One `pg_trigger` row's identity, firing state, and event wiring. */
interface TriggerState {
  readonly name: string;
  readonly enabled: string;
  readonly before: boolean;
  readonly rowLevel: boolean;
  readonly onUpdate: boolean;
  readonly onDelete: boolean;
}

/**
 * `pg_trigger.tgtype` bit values (PostgreSQL trigger type bitmask): bit 0 =
 * row-level, bit 1 = BEFORE, bit 3 = DELETE, bit 4 = UPDATE. A
 * statement-level, AFTER, or wrong-event trigger must fail the shape check
 * below even when it happens to be enabled.
 */
const TGTYPE_ROW = 1;
const TGTYPE_BEFORE = 2;
const TGTYPE_DELETE = 8;
const TGTYPE_UPDATE = 16;

/** Same probe shape as the audit-immutability suite, extended with the trigger's event wiring. */
async function probeTriggerStates(tx: DBTransaction, table: string): Promise<TriggerState[]> {
  const discovered = await tx.execute<{
    tgname: string;
    tgenabled: string;
    isBefore: boolean;
    isRowLevel: boolean;
    onUpdate: boolean;
    onDelete: boolean;
  }>(
    sql`SELECT
          tgname,
          tgenabled,
          (tgtype & ${TGTYPE_BEFORE}) > 0 AS "isBefore",
          (tgtype & ${TGTYPE_ROW}) > 0 AS "isRowLevel",
          (tgtype & ${TGTYPE_UPDATE}) > 0 AS "onUpdate",
          (tgtype & ${TGTYPE_DELETE}) > 0 AS "onDelete"
        FROM pg_trigger
        WHERE tgrelid = ${table}::regclass AND NOT tgisinternal`
  );
  return discovered.rows
    .map(row => ({
      name: row.tgname,
      enabled: row.tgenabled,
      before: row.isBefore,
      rowLevel: row.isRowLevel,
      onUpdate: row.onUpdate,
      onDelete: row.onDelete,
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * True only when the named trigger is installed, fires for
 * application-origin DML (`tgenabled` 'O' or 'A' — a replica-only 'R' or
 * disabled 'D' trigger never guards the tamper proofs), and is wired as a
 * row-level BEFORE trigger bound to the expected event.
 */
function isTriggerEnforcing(states: readonly TriggerState[], triggerName: string, event: "update" | "delete"): boolean {
  const state = states.find(candidate => candidate.name === triggerName);
  if (state === undefined) {
    return false;
  }
  const firesForApplicationDml = state.enabled === "O" || state.enabled === "A";
  const boundToEvent = event === "update" ? state.onUpdate : state.onDelete;
  return firesForApplicationDml && state.before && state.rowLevel && boundToEvent;
}

/** Asserts BOTH the BEFORE UPDATE and BEFORE DELETE triggers are present, firing for app DML, and event-wired. */
function expectTriggerPairEnforcing(
  states: readonly TriggerState[],
  updateTrigger: string,
  deleteTrigger: string
): void {
  expect(isTriggerEnforcing(states, updateTrigger, "update")).toBe(true);
  expect(isTriggerEnforcing(states, deleteTrigger, "delete")).toBe(true);
}

// ─── Savepoint + tamper helpers ──────────────────────────────────────────────

/**
 * Runs `probe` inside its own SAVEPOINT bracket (`savepoint` / `rollback to
 * savepoint`) on the caller's transaction. A failed statement inside the
 * bracket leaves the outer transaction fully queryable — the row can be
 * read back and re-probed after the raise.
 */
async function withinSavepoint(tx: DBTransaction, name: string, probe: () => Promise<void>): Promise<void> {
  await tx.execute(sql.raw(`savepoint ${name}`));
  await probe();
  await tx.execute(sql.raw(`rollback to savepoint ${name}`));
}

/** Captures the full ledger row state for unchanged comparisons. */
interface TeacherTxRowSnapshot {
  readonly id: number;
  readonly walletId: number;
  readonly amount: string;
  readonly type: string;
  readonly status: string;
  readonly description: string | null;
  readonly sessionId: number | null;
}

/** Reads back the teacher_transaction row by id (independent oracle on the same tx). */
async function readTeacherTransactionRow(tx: DBTransaction, id: number): Promise<TeacherTxRowSnapshot | undefined> {
  const [row] = await tx
    .select({
      id: teacherTransaction.id,
      walletId: teacherTransaction.walletId,
      amount: teacherTransaction.amount,
      type: teacherTransaction.type,
      status: teacherTransaction.status,
      description: teacherTransaction.description,
      sessionId: teacherTransaction.sessionId,
    })
    .from(teacherTransaction)
    .where(eq(teacherTransaction.id, id))
    .limit(1);
  return row;
}

/** Independent read-back oracle — proves the fixture row is really there. */
async function expectTeacherTransactionPresent(tx: DBTransaction, id: number): Promise<void> {
  const row = await readTeacherTransactionRow(tx, id);
  expect(row).toBeDefined();
  expect(row?.id).toBe(id);
}

/** Independent read-back oracle for the payments ledger. */
async function expectStudentPaymentPresent(tx: DBTransaction, id: number): Promise<void> {
  const [row] = await tx
    .select({ id: studentPayments.id })
    .from(studentPayments)
    .where(eq(studentPayments.id, id))
    .limit(1);
  expect(row).toBeDefined();
  expect(row?.id).toBe(id);
}

/**
 * Walks the Drizzle error cause chain (Drizzle masks driver errors behind a
 * generic message, so the raised trigger text is reachable only through the
 * chain) and joins every message so the DB-enforced text can be asserted
 * regardless of wrapping depth.
 */
function errorMessageChain(error: Error): string {
  const messages: string[] = [error.message];
  let current: Error = error;
  const seen = new Set<Error>([error]);
  while (current.cause instanceof Error && !seen.has(current.cause)) {
    current = current.cause;
    seen.add(current);
    messages.push(current.message);
  }
  return messages.join("\n");
}

/**
 * Extracts the deepest cause-chain message — the DB-raised exception text
 * itself, stripped of Drizzle's "Failed query" wrapper (whose embedded bind
 * parameters, e.g. the wall-clock `updated_at`, differ between otherwise
 * identical repeat attempts).
 */
function deepestCauseMessage(error: Error): string {
  let current: Error = error;
  const seen = new Set<Error>([error]);
  while (current.cause instanceof Error && !seen.has(current.cause)) {
    current = current.cause;
    seen.add(current);
  }
  return current.message;
}

/**
 * INSERTs one fixture teacher_transaction ledger row inside the caller's
 * transaction (user → teacher row → wallet → ledger row; the append path is
 * NEVER blocked) and returns the persisted row snapshot for tamper attempts.
 * The session link and description are overridable so the frozen-column
 * probes can stage the exact row shape the guard must compare against.
 */
async function insertTeacherLedgerFixture(
  tx: DBTransaction,
  overrides: Partial<{
    amount: string;
    type: TransactionType;
    status: TransactionStatus;
    description: string | null;
    sessionId: number | null;
  }> = {}
): Promise<TeacherTxRowSnapshot> {
  const user = await createTestUser(tx);
  await createTestTeacherRow(tx, user.id);
  const teacherWallet = await createTestWallet(tx, user.id);
  const row = await createTestTeacherTransaction(tx, teacherWallet.id, overrides.sessionId ?? null, {
    type: overrides.type ?? TransactionType.Earning,
    amount: overrides.amount ?? "50.00",
    status: overrides.status ?? TransactionStatus.Completed,
    description: overrides.description ?? null,
  });
  return {
    id: row.id,
    walletId: row.walletId,
    amount: row.amount,
    type: row.type,
    status: row.status,
    description: row.description,
    sessionId: row.sessionId,
  };
}

/** INSERTs one fixture student_payments row (user → student → ledger row). */
async function insertStudentPaymentFixture(tx: DBTransaction) {
  const user = await createTestUser(tx);
  const student = await createTestStudent(tx, user.id);
  return createTestStudentPayment(tx, student.id, null, { status: PaymentStatus.Paid });
}

/**
 * INSERTs one fixture audit_logs row inside the caller's transaction (user →
 * audit row; the append path is NEVER blocked) and returns it for tamper
 * attempts — the audit trail gets the same behavioral proof as the ledgers.
 */
async function insertAuditLogFixture(tx: DBTransaction) {
  const user = await createTestUser(tx);
  const [row] = await tx
    .insert(auditLogs)
    .values({
      actorId: user.id,
      actionType: AuditActionType.Create,
      entityType: "user",
      entityId: user.id,
      details: null,
    })
    .returning({ id: auditLogs.id, details: auditLogs.details });
  if (!row) {
    throw new Error("audit fixture insert returned no rows");
  }
  return row;
}

/** Independent read-back oracle for the audit trail. */
async function expectAuditLogPresent(tx: DBTransaction, id: number): Promise<void> {
  const [row] = await tx.select({ id: auditLogs.id }).from(auditLogs).where(eq(auditLogs.id, id)).limit(1);
  expect(row).toBeDefined();
  expect(row?.id).toBe(id);
}

const describeTriggerTier = isPgliteProvider() ? describe.skip : describe;

// ─── Tier 1: trigger presence on all three immutable tables ──────────────────

describeTriggerTier("financial ledger immutability — trigger presence tier", () => {
  test("both immutability triggers are present and enabled on teacher_transaction", async () => {
    await runInRollback(async tx => {
      const states = await probeTriggerStates(tx, "teacher_transaction");
      expectTriggerPairEnforcing(states, TEACHER_TX_UPDATE_TRIGGER, TEACHER_TX_DELETE_TRIGGER);
    });
  });

  test("both immutability triggers are present and enabled on student_payments", async () => {
    await runInRollback(async tx => {
      const states = await probeTriggerStates(tx, "student_payments");
      expectTriggerPairEnforcing(states, PAYMENTS_UPDATE_TRIGGER, PAYMENTS_DELETE_TRIGGER);
    });
  });

  test("both immutability triggers are present and enabled on audit_logs", async () => {
    await runInRollback(async tx => {
      const states = await probeTriggerStates(tx, "audit_logs");
      expectTriggerPairEnforcing(states, AUDIT_UPDATE_TRIGGER, AUDIT_DELETE_TRIGGER);
    });
  });

  test("every immutable table carries exactly the two migration-installed triggers", async () => {
    await runInRollback(async tx => {
      const expected = new Set([
        TEACHER_TX_UPDATE_TRIGGER,
        TEACHER_TX_DELETE_TRIGGER,
        PAYMENTS_UPDATE_TRIGGER,
        PAYMENTS_DELETE_TRIGGER,
        AUDIT_UPDATE_TRIGGER,
        AUDIT_DELETE_TRIGGER,
      ]);
      const statesByTable = await Promise.all(IMMUTABLE_TABLES.map(table => probeTriggerStates(tx, table)));
      for (const states of statesByTable) {
        expect(states).toHaveLength(2);
        for (const state of states) {
          expect([...expected].includes(state.name)).toBe(true);
        }
      }
    });
  });
});

// ─── Tier 2: adversarial tamper probes under savepoint ───────────────────────

describeTriggerTier("financial ledger immutability — teacher_transaction tamper tier", () => {
  test("direct UPDATE on a teacher_transaction row is rejected and the row stays unchanged", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      const error = await probeInsideSavepoint(tx, "teacher tx update probe", () =>
        tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("direct DELETE of a teacher_transaction row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      const error = await probeInsideSavepoint(tx, "teacher tx delete probe", () =>
        tx.delete(teacherTransaction).where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_DELETE_MSG);

      await expectTeacherTransactionPresent(tx, fixture.id);
    });
  });

  test("the same tamper UPDATE fails identically on repeat (idempotent re-probe)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      const first = await probeInsideSavepoint(tx, "teacher tx repeat probe 1", () =>
        tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
      );
      const firstMessage = deepestCauseMessage(first);
      expect(firstMessage).toContain(TEACHER_TX_IMMUTABLE);
      expect(firstMessage).toContain(TEACHER_TX_UPDATE_MSG);

      const second = await probeInsideSavepoint(tx, "teacher tx repeat probe 2", () =>
        tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
      );
      expect(deepestCauseMessage(second)).toBe(firstMessage);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("a relabeling settlement UPDATE on an earning row RAISES (type is frozen)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx, { status: TransactionStatus.Pending });
      await expectTeacherTransactionPresent(tx, fixture.id);
      // Precondition: a PENDING earning row — the settlement's own
      // status/type expectations would otherwise pass, so the ONLY guard the
      // relabel can trip is the type freeze (only withdrawals settle). The
      // shared fixture helper defaults earnings to `completed`, hence the
      // explicit pending override.
      expect(fixture.type).toBe(TransactionType.Earning);
      expect(fixture.status).toBe(TransactionStatus.Pending);

      const error = await probeInsideSavepoint(tx, "teacher tx relabel probe", () =>
        tx
          .update(teacherTransaction)
          .set({ type: TransactionType.Withdrawal, status: TransactionStatus.Completed })
          .where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("the compensating-row doctrine holds — a corrective INSERT succeeds while mutation of the original fails", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      const error = await probeInsideSavepoint(tx, "teacher tx compensating probe", () =>
        tx.update(teacherTransaction).set({ amount: "0.00" }).where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);

      const corrective = await createTestTeacherTransaction(tx, fixture.walletId, null, {
        type: TransactionType.Withdrawal,
        amount: "50.00",
        description: "correction for reversed earning",
      });
      expect(corrective.id).toBeGreaterThan(0);
      expect(corrective.id).not.toBe(fixture.id);
      await expectTeacherTransactionPresent(tx, corrective.id);
    });
  });

  test("INV-W5: a pending→pending no-op rewrite raises (settlement is the only permitted update)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });
      await expectTeacherTransactionPresent(tx, fixture.id);

      // Even a rewrite that changes nothing observable is rejected: the
      // guard permits ONLY the pending → completed/failed settlement shape,
      // so a pending → pending "no-op" can never slip through as a silent
      // in-place edit.
      const error = await probeInsideSavepoint(tx, "teacher tx pending noop probe", () =>
        tx
          .update(teacherTransaction)
          .set({ status: TransactionStatus.Pending })
          .where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("INV-W5: re-opening a decided withdrawal (completed→failed) raises", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
      });

      // The sanctioned settlement decides the row; the decided snapshot is
      // the comparison baseline for the re-open attempt.
      const settled = await WalletRepository.settleWithdrawalOnce(
        { transactionId: fixture.id, nextStatus: TransactionStatus.Completed },
        tx
      );
      expect(settled?.status).toBe(TransactionStatus.Completed);
      const decided = await readTeacherTransactionRow(tx, fixture.id);
      expect(decided?.status).toBe(TransactionStatus.Completed);

      const error = await probeInsideSavepoint(tx, "teacher tx decided reopen probe", () =>
        tx
          .update(teacherTransaction)
          .set({ status: TransactionStatus.Failed })
          .where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(decided);
    });
  });

  test("INV-W5: a description rewrite on a pending withdrawal raises (column freeze)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        description: "payout request",
      });
      await expectTeacherTransactionPresent(tx, fixture.id);

      // The rewrite is otherwise a VALID settlement (pending withdrawal →
      // completed, every other column untouched), so the raise isolates the
      // description freeze arm — a tampered note can never ride a settle.
      const error = await probeInsideSavepoint(tx, "teacher tx description freeze probe", () =>
        tx
          .update(teacherTransaction)
          .set({ status: TransactionStatus.Completed, description: "tampered payout note" })
          .where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("INV-W5: a session_id NULL-swap on a pending withdrawal raises (IS NOT DISTINCT FROM arm)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx, {
        type: TransactionType.Withdrawal,
        status: TransactionStatus.Pending,
        sessionId: null,
      });
      await expectTeacherTransactionPresent(tx, fixture.id);

      // A LIVE session row is the swap target — the FK is satisfied, so the
      // raise is attributable to the frozen-link arm alone. The rewrite is
      // otherwise a valid settlement; a plain `=` comparison would treat
      // NULL = <id> as unknown and let the swap ride the settle through.
      const swapTeacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestTeacherRow(tx, swapTeacherUser.id);
      const swapStudentUser = await createTestUser(tx, { role: "student" });
      const swapStudent = await createTestStudent(tx, swapStudentUser.id);
      const swapSession = await createTestSession(tx, swapTeacherUser.id, swapStudent.id);

      const error = await probeInsideSavepoint(tx, "teacher tx session link freeze probe", () =>
        tx
          .update(teacherTransaction)
          .set({ status: TransactionStatus.Completed, sessionId: swapSession.id })
          .where(eq(teacherTransaction.id, fixture.id))
      );
      expectTriggerRaise(error, TEACHER_TX_IMMUTABLE);
      expectTriggerRaise(error, TEACHER_TX_UPDATE_MSG);

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });
});

describeTriggerTier("financial ledger immutability — student_payments tamper tier", () => {
  test("direct UPDATE on a decided payment row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const payment = await insertStudentPaymentFixture(tx);
      expect(payment.status).toBe(PaymentStatus.Paid);
      await expectStudentPaymentPresent(tx, payment.id);

      const error = await probeInsideSavepoint(tx, "payments update probe", () =>
        tx.update(studentPayments).set({ amount: "999.99" }).where(eq(studentPayments.id, payment.id))
      );
      expectTriggerRaise(error, PAYMENTS_IMMUTABLE);
      expectTriggerRaise(error, "permitted only to transition a pending payment");

      await expectStudentPaymentPresent(tx, payment.id);
    });
  });

  test("direct DELETE of a decided payment row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const payment = await insertStudentPaymentFixture(tx);
      await expectStudentPaymentPresent(tx, payment.id);

      const error = await probeInsideSavepoint(tx, "payments delete probe", () =>
        tx.delete(studentPayments).where(eq(studentPayments.id, payment.id))
      );
      expectTriggerRaise(error, PAYMENTS_IMMUTABLE);
      expectTriggerRaise(error, "DELETE is not permitted");

      await expectStudentPaymentPresent(tx, payment.id);
    });
  });
});

describeTriggerTier("financial ledger immutability — audit_logs tamper tier", () => {
  test("direct UPDATE on an audit row is rejected and the row stays unchanged", async () => {
    await runInRollback(async tx => {
      const fixture = await insertAuditLogFixture(tx);
      await expectAuditLogPresent(tx, fixture.id);

      await withinSavepoint(tx, "audit_update_probe", async () => {
        const error = await expectRepoError(() =>
          tx.update(auditLogs).set({ details: "tamper attempt" }).where(eq(auditLogs.id, fixture.id))
        );
        const chain = errorMessageChain(error);
        expect(chain).toContain(AUDIT_IMMUTABLE);
        expect(chain).toContain(AUDIT_UPDATE_MSG);
      });

      await expectAuditLogPresent(tx, fixture.id);
    });
  });

  test("direct DELETE of an audit row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const fixture = await insertAuditLogFixture(tx);
      await expectAuditLogPresent(tx, fixture.id);

      await withinSavepoint(tx, "audit_delete_probe", async () => {
        const error = await expectRepoError(() => tx.delete(auditLogs).where(eq(auditLogs.id, fixture.id)));
        const chain = errorMessageChain(error);
        expect(chain).toContain(AUDIT_IMMUTABLE);
        expect(chain).toContain(AUDIT_DELETE_MSG);
      });

      await expectAuditLogPresent(tx, fixture.id);
    });
  });
});
