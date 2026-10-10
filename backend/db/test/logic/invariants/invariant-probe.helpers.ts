/**
 * Shared savepoint/constraint/trigger probe scaffold for invariant
 * verification tests.
 *
 * Every DB-enforced invariant probe follows the same shape: bracket the
 * adversarial statement in its own SAVEPOINT on the caller's rolled-back
 * transaction, catch the rejection with a try/catch helper (NEVER
 * `expect(...).rejects.toThrow()`, which deadlocks the rollback wrapper),
 * then ROLLBACK TO SAVEPOINT so the failed statement never poisons the
 * outer transaction — the surrounding test keeps running and can re-read
 * the row to prove it is unchanged.
 *
 * The expectors classify the caught error by its PostgreSQL SQLSTATE (the
 * code only surfaces on the `pg` error at the bottom of the Drizzle cause
 * chain) plus the constraint / column / enum / trigger-RAISE fragment the
 * driver reports, so an aborted-transaction `25P02` error can never be
 * mistaken for the intended violation.
 *
 * TEST-ONLY module: must never be imported from production code. The db
 * test runner discovers files ending in `.test.ts` only, so this helper
 * module is never executed as a test by itself.
 */

import { expect } from "bun:test";
import { sql } from "drizzle-orm";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { constraintNameOf } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL SQLSTATE for `check_violation`. */
const PG_CHECK_VIOLATION = "23514";
/** PostgreSQL SQLSTATE for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";
/** PostgreSQL SQLSTATE for `foreign_key_violation`. */
const PG_FK_VIOLATION = "23503";
/** PostgreSQL SQLSTATE for `not_null_violation`. */
const PG_NOT_NULL_VIOLATION = "23502";
/** PostgreSQL SQLSTATE for `invalid_text_representation` (bad enum input). */
const PG_INVALID_TEXT_REPRESENTATION = "22P02";

/**
 * Restricts a caller-supplied savepoint label to a safe SQL identifier
 * (the label is interpolated into raw `savepoint` / `rollback to savepoint`
 * statements, which take an identifier, not a bind parameter).
 */
function toSavepointIdentifier(label: string): string {
  const safe = label.replace(/\W/g, "_").toLowerCase();
  return safe.length > 0 ? safe : "probe";
}

/**
 * Joins the message of every error in the Drizzle cause chain — Drizzle
 * masks driver errors behind a generic "failed query" message, so the
 * PostgreSQL-reported text (constraint name, column, enum value, trigger
 * RAISE text) is reachable only by walking the chain.
 */
function causeChainText(error: Error): string {
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
 * Asserts the error carries the given SQLSTATE and that the PostgreSQL
 * constraint name is reported both on the error object and somewhere in
 * the cause-chain text (an unrelated failure must never satisfy the probe).
 */
function expectNamedConstraintViolation(error: Error, pgCode: string, constraintName: string): void {
  expect(hasPostgresErrorCode(error, pgCode)).toBe(true);
  expect(constraintNameOf(error)).toBe(constraintName);
  expect(causeChainText(error)).toContain(constraintName);
}

/**
 * Runs `probe` inside its own SAVEPOINT bracket on the caller's
 * transaction and returns the error it threw. The savepoint is ALWAYS
 * rolled back — also on success — so the probe's writes never leak into
 * the outer transaction and a failed statement leaves it fully queryable
 * for follow-up read-back assertions.
 *
 * Throws when the probe resolves without failing: a probe that does not
 * violate anything is a broken probe, not a green test.
 *
 * The caller is responsible for the surrounding `runInRollback` wrapper;
 * every statement inside the probe body must use this same `tx`.
 */
export async function probeInsideSavepoint(
  tx: DBTransaction,
  label: string,
  probe: () => Promise<unknown>
): Promise<Error> {
  const savepointName = `inv_${toSavepointIdentifier(label)}`;
  await tx.execute(sql.raw(`savepoint ${savepointName}`));
  let caught: unknown = null;
  try {
    await probe();
  } catch (error) {
    caught = error;
  } finally {
    await tx.execute(sql.raw(`rollback to savepoint ${savepointName}`));
  }
  if (caught === null) {
    throw new Error(`probeInsideSavepoint(${label}): expected the probe to fail, but it resolved successfully`);
  }
  if (caught instanceof Error) {
    return caught;
  }
  const message = typeof caught === "string" ? caught : `[non-Error throw: ${typeof caught}]`;
  return new Error(message);
}

/**
 * Asserts the error is a CHECK constraint violation (SQLSTATE 23514) fired
 * by the named constraint — e.g. `wallet_balance_check`,
 * `student_payments_amount_check`.
 */
export function expectCheckViolation(error: Error, constraintName: string): void {
  expectNamedConstraintViolation(error, PG_CHECK_VIOLATION, constraintName);
}

/**
 * Asserts the error is a unique constraint violation (SQLSTATE 23505) fired
 * by the named constraint — e.g. `wallet_teacher_id_unique`.
 */
export function expectUniqueViolation(error: Error, constraintName: string): void {
  expectNamedConstraintViolation(error, PG_UNIQUE_VIOLATION, constraintName);
}

/**
 * Asserts the error is a foreign key violation (SQLSTATE 23503) fired by
 * the named constraint — e.g. `subscriptions_plan_id_fkey`.
 */
export function expectFkViolation(error: Error, constraintName: string): void {
  expectNamedConstraintViolation(error, PG_FK_VIOLATION, constraintName);
}

/**
 * Asserts the error is a NOT NULL violation (SQLSTATE 23502) for a column
 * whose name appears in the cause-chain text — e.g. `"session_id"`.
 */
export function expectNotNullViolation(error: Error, columnFragment: string): void {
  expect(hasPostgresErrorCode(error, PG_NOT_NULL_VIOLATION)).toBe(true);
  expect(causeChainText(error)).toContain(columnFragment);
}

/**
 * Asserts the error is an invalid-text-representation failure (SQLSTATE
 * 22P02) — an out-of-vocabulary enum input — whose driver text contains
 * `enumFragment`, e.g. `"invalid input value for enum"`.
 */
export function expectEnumViolation(error: Error, enumFragment: string): void {
  expect(hasPostgresErrorCode(error, PG_INVALID_TEXT_REPRESENTATION)).toBe(true);
  expect(causeChainText(error)).toContain(enumFragment);
}

/**
 * Asserts a trigger's RAISE text is present verbatim in the cause chain —
 * immutability guards report their rejection only through the raised
 * message (e.g. `"teacher_transaction is immutable"`), which Drizzle wraps
 * but never rewrites.
 */
export function expectTriggerRaise(error: Error, raiseText: string): void {
  expect(causeChainText(error)).toContain(raiseText);
}
