/**
 * StudentRepository.grantFreeTrialOnce tests — single guarded conditional
 * UPDATE for one-time free trial session credit provisioning.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers
 *    (`createTestUser` + `createTestStudent`) — never seed data.
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited inside `runInRollback`.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): happy-path grant on a fresh student → returns true,
 *    `balanceTrial = trialCount`, `trialGrantedAt IS NOT NULL`; second call on
 *    the same student → returns false, balance + marker unchanged (grant-once
 *    invariant at SQL level — predicate and mutation share one statement, so
 *    the TOCTOU window is zero).
 *  - Tier 2 (boundary): `trialCount = 0` still matches the row (marker was
 *    NULL) and produces `0 + 0 = 0` with the marker set — documents that the
 *    repository does not validate the input; the production constant
 *    guarantees 1.
 *  - Tier 3 (chaos): nonexistent `studentId` → returns false, no row created,
 *    no side effects (grant is a pure UPDATE — it cannot create rows).
 *  - Tier 4 (security/constraint): direct raw UPDATE with `balance_trial = -1`
 *    is rejected by the `students_balance_trial_check` CHECK constraint at the
 *    DB layer regardless of application validation.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { StudentRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL error code for `check_violation`. */
const PG_CHECK_VIOLATION = "23514";

/**
 * Walks the Drizzle `DrizzleQueryError.cause` chain to find whether the
 * original PostgreSQL error carries the given SQLSTATE code — Drizzle wraps
 * driver errors behind its own generic "failed query" message, so the code
 * only surfaces on the underlying `pg` error instance.
 */
function hasPostgresErrorCode(error: unknown, pgCode: string): boolean {
  let current: unknown = error;
  const seen = new Set<unknown>();
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === pgCode) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Walks the same cause chain searching for an `Error.message` containing the
 * given substring — used to confirm the underlying PostgreSQL diagnostic
 * (which names the rejecting CHECK constraint) is reachable through the
 * Drizzle wrapper.
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
 * Returns an integer id that cannot exist as a `students` row during this
 * transaction: students share their PK with `users.id`, so anything above
 * the current max (plus a large offset that no sequence reaches during a
 * rolled-back test) is guaranteed absent.
 */
async function absentStudentId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${students.id}), 0)::int` }).from(students);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Counts rows in the `students` table within the supplied transaction. */
async function countStudentRows(tx: DBTransaction): Promise<number> {
  const result = await tx.select({ count: sql<number>`count(*)::int` }).from(students);
  return result[0]?.count ?? 0;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx, NOT
 * routed through the repository method under test. Returns the live student
 * row so the test can assert on DB-side state after the grant.
 */
async function readStudentRow(tx: DBTransaction, studentId: number) {
  const rows = await tx.select().from(students).where(eq(students.id, studentId));
  return rows[0] ?? null;
}

describe("StudentRepository.grantFreeTrialOnce", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("grants trial credits to a fresh student and returns true", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      const granted = await StudentRepository.grantFreeTrialOnce(user.id, 1, tx);

      expect(granted).toBe(true);

      const persisted = await readStudentRow(tx, user.id);
      expect(persisted).not.toBeNull();
      expect(persisted?.balanceTrial).toBe(1);
      expect(persisted?.trialGrantedAt).toBeInstanceOf(Date);
    });
  });

  test("second call on the same student returns false and leaves balance + marker unchanged", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      const firstGranted = await StudentRepository.grantFreeTrialOnce(user.id, 1, tx);
      expect(firstGranted).toBe(true);

      const afterFirst = await readStudentRow(tx, user.id);
      const firstMarker = afterFirst?.trialGrantedAt;
      if (!(firstMarker instanceof Date)) {
        throw new Error("expected trialGrantedAt to be set after the first grant");
      }
      expect(afterFirst?.balanceTrial).toBe(1);

      const secondGranted = await StudentRepository.grantFreeTrialOnce(user.id, 1, tx);
      expect(secondGranted).toBe(false);

      const afterSecond = await readStudentRow(tx, user.id);
      expect(afterSecond?.balanceTrial).toBe(1);
      // Marker is byte-identical to the first-grant value — the second UPDATE
      // matched zero rows because the predicate `trial_granted_at IS NULL`
      // evaluated false under the now-set marker.
      expect(afterSecond?.trialGrantedAt).toEqual(firstMarker);
    });
  });

  // ─── Tier 2: boundary ───────────────────────────────────────────────

  test("trialCount = 0 still matches the row and produces 0 + 0 = 0 with marker set", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);

      const granted = await StudentRepository.grantFreeTrialOnce(user.id, 0, tx);

      // The row matched because `trial_granted_at` was NULL at call time — the
      // repo does not validate the count; the production constant guarantees
      // the value is 1. This test documents the arithmetic path: the SQL
      // expression `${students.balanceTrial} + ${trialCount}` evaluates to
      // `0 + 0 = 0` and the marker is set regardless of the credit amount.
      expect(granted).toBe(true);

      const persisted = await readStudentRow(tx, user.id);
      expect(persisted?.balanceTrial).toBe(0);
      expect(persisted?.trialGrantedAt).toBeInstanceOf(Date);
    });
  });

  // ─── Tier 3: chaos ──────────────────────────────────────────────────

  test("nonexistent studentId returns false with no row created and no side effects", async () => {
    await runInRollback(async tx => {
      const missingId = await absentStudentId(tx);
      const beforeCount = await countStudentRows(tx);

      const granted = await StudentRepository.grantFreeTrialOnce(missingId, 1, tx);

      // The conditional UPDATE matched zero rows because no `students` row
      // carries `id = missingId`, so the predicate `id = $1 AND
      // trial_granted_at IS NULL` evaluated false on every row in the table.
      expect(granted).toBe(false);

      // The grant is a pure UPDATE — it cannot create rows. The count check
      // is a regression guard against any future refactor that might
      // accidentally swap in an upsert.
      const afterCount = await countStudentRows(tx);
      expect(afterCount).toBe(beforeCount);

      // No row was created with the missing id.
      const row = await readStudentRow(tx, missingId);
      expect(row).toBeNull();
    });
  });

  // ─── Tier 4: security/constraint ────────────────────────────────────

  test("direct raw UPDATE with balance_trial = -1 is rejected by the students_balance_trial_check CHECK constraint", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx);
      const student = await createTestStudent(tx, user.id);

      // Bracket the adversarial UPDATE in an explicit SAVEPOINT so the
      // CHECK-constraint violation rolls back ONLY the savepoint — leaving
      // the outer transaction usable for the read-back assertion. Without
      // this guard, PostgreSQL enters the "aborted" state (SQLSTATE 25P02)
      // after the constraint rejection and every subsequent query on the
      // outer tx would fail.
      await tx.execute(sql`savepoint dev1_004_check_violation`);

      const error = await expectRepoError(() =>
        tx.update(students).set({ balanceTrial: -1 }).where(eq(students.id, student.id)).returning()
      );

      await tx.execute(sql`rollback to savepoint dev1_004_check_violation`);

      // SQLSTATE 23514 = check_violation — the DB-layer CHECK constraint
      // rejected the negative balance regardless of any application guard.
      expect(hasPostgresErrorCode(error, PG_CHECK_VIOLATION)).toBe(true);
      // The underlying PostgreSQL diagnostic message names the rejecting
      // CHECK constraint explicitly — surfaced via Drizzle's cause chain.
      expect(causeChainContainsMessage(error, "students_balance_trial_check")).toBe(true);

      // The rejected UPDATE did not mutate the row — the original balance
      // (0 from setup) is intact, now provable because the savepoint
      // rollback restored the outer transaction to a queryable state.
      const persisted = await readStudentRow(tx, user.id);
      expect(persisted?.balanceTrial).toBe(0);
    });
  });
});
