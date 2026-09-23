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
 *     raised message, asserted via the `expectRepoError` try/catch helper
 *     (NEVER `rejects.toThrow`, which deadlocks the rollback wrapper).
 *     Covered: teacher_transaction UPDATE (row compared unchanged) +
 *     DELETE (row still present) + the relabeling settlement probe (an
 *     earning row relabeled to withdrawal/completed RAISES); student_payments tamper UPDATE on a
 *     decided (paid) row (the full guarded-transition matrix lives in the
 *     StudentPaymentRepository suite); an idempotent re-probe (the same
 *     UPDATE fails identically on repeat, in a separate savepoint); and
 *     the compensating-row doctrine (a corrective INSERT succeeds while
 *     mutation of the original row fails — corrections flow through new
 *     rows, never in-place edits); plus direct UPDATE/DELETE probes against
 *     a fixture audit_logs row — the third immutable table gets the same
 *     behavioral proof, not just the presence probe.
 *
 * DB SAFETY: every database statement in this file runs inside
 * `runInRollback` with the `tx` passed through — no fixture row ever
 * commits, and no global trigger state is touched (probes only read
 * `pg_trigger` and tamper inside savepoints).
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { studentPayments } from "@/backend/db/schema/billing/student-payments";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import {
  createTestStudent,
  createTestStudentPayment,
  createTestTeacherRow,
  createTestTeacherTransaction,
  createTestUser,
  createTestWallet,
} from "@/backend/db/test/entity-setup";
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
 */
async function insertTeacherLedgerFixture(
  tx: DBTransaction,
  overrides: Partial<{ amount: string; type: TransactionType; status: TransactionStatus }> = {}
): Promise<TeacherTxRowSnapshot> {
  const user = await createTestUser(tx);
  await createTestTeacherRow(tx, user.id);
  const teacherWallet = await createTestWallet(tx, user.id);
  const row = await createTestTeacherTransaction(tx, teacherWallet.id, null, {
    type: overrides.type ?? TransactionType.Earning,
    amount: overrides.amount ?? "50.00",
    status: overrides.status ?? TransactionStatus.Completed,
  });
  return { id: row.id, walletId: row.walletId, amount: row.amount, type: row.type, status: row.status };
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

      await withinSavepoint(tx, "teacher_tx_update_probe", async () => {
        const error = await expectRepoError(() =>
          tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
        );
        const chain = errorMessageChain(error);
        expect(chain).toContain(TEACHER_TX_IMMUTABLE);
        expect(chain).toContain(TEACHER_TX_UPDATE_MSG);
      });

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("direct DELETE of a teacher_transaction row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      await withinSavepoint(tx, "teacher_tx_delete_probe", async () => {
        const error = await expectRepoError(() =>
          tx.delete(teacherTransaction).where(eq(teacherTransaction.id, fixture.id))
        );
        const chain = errorMessageChain(error);
        expect(chain).toContain(TEACHER_TX_IMMUTABLE);
        expect(chain).toContain(TEACHER_TX_DELETE_MSG);
      });

      await expectTeacherTransactionPresent(tx, fixture.id);
    });
  });

  test("the same tamper UPDATE fails identically on repeat (idempotent re-probe)", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      let firstMessage = "";
      await withinSavepoint(tx, "teacher_tx_repeat_probe_1", async () => {
        const error = await expectRepoError(() =>
          tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
        );
        firstMessage = deepestCauseMessage(error);
        expect(firstMessage).toContain(TEACHER_TX_IMMUTABLE);
        expect(firstMessage).toContain(TEACHER_TX_UPDATE_MSG);
      });

      await withinSavepoint(tx, "teacher_tx_repeat_probe_2", async () => {
        const error = await expectRepoError(() =>
          tx.update(teacherTransaction).set({ amount: "999.99" }).where(eq(teacherTransaction.id, fixture.id))
        );
        expect(deepestCauseMessage(error)).toBe(firstMessage);
      });

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

      await withinSavepoint(tx, "teacher_tx_relabel_probe", async () => {
        const error = await expectRepoError(() =>
          tx
            .update(teacherTransaction)
            .set({ type: TransactionType.Withdrawal, status: TransactionStatus.Completed })
            .where(eq(teacherTransaction.id, fixture.id))
        );
        const chain = errorMessageChain(error);
        expect(chain).toContain(TEACHER_TX_IMMUTABLE);
        expect(chain).toContain(TEACHER_TX_UPDATE_MSG);
      });

      const after = await readTeacherTransactionRow(tx, fixture.id);
      expect(after).toEqual(fixture);
    });
  });

  test("the compensating-row doctrine holds — a corrective INSERT succeeds while mutation of the original fails", async () => {
    await runInRollback(async tx => {
      const fixture = await insertTeacherLedgerFixture(tx);
      await expectTeacherTransactionPresent(tx, fixture.id);

      await withinSavepoint(tx, "teacher_tx_compensating_probe", async () => {
        const error = await expectRepoError(() =>
          tx.update(teacherTransaction).set({ amount: "0.00" }).where(eq(teacherTransaction.id, fixture.id))
        );
        expect(errorMessageChain(error)).toContain(TEACHER_TX_IMMUTABLE);
      });

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
});

describeTriggerTier("financial ledger immutability — student_payments tamper tier", () => {
  test("direct UPDATE on a decided payment row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const payment = await insertStudentPaymentFixture(tx);
      expect(payment.status).toBe(PaymentStatus.Paid);
      await expectStudentPaymentPresent(tx, payment.id);

      await withinSavepoint(tx, "payments_update_probe", async () => {
        const error = await expectRepoError(() =>
          tx.update(studentPayments).set({ amount: "999.99" }).where(eq(studentPayments.id, payment.id))
        );
        const chain = errorMessageChain(error);
        expect(chain).toContain(PAYMENTS_IMMUTABLE);
        expect(chain).toContain("permitted only to transition a pending payment");
      });

      await expectStudentPaymentPresent(tx, payment.id);
    });
  });

  test("direct DELETE of a decided payment row is rejected and the row stays present", async () => {
    await runInRollback(async tx => {
      const payment = await insertStudentPaymentFixture(tx);
      await expectStudentPaymentPresent(tx, payment.id);

      await withinSavepoint(tx, "payments_delete_probe", async () => {
        const error = await expectRepoError(() => tx.delete(studentPayments).where(eq(studentPayments.id, payment.id)));
        const chain = errorMessageChain(error);
        expect(chain).toContain(PAYMENTS_IMMUTABLE);
        expect(chain).toContain("DELETE is not permitted");
      });

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
