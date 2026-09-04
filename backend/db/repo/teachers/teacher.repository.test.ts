/**
 * TeacherRepository tests — `findById` (read), `insertColdStartCertified`
 * (field-by-field insert), and `elevateToCertified` (single guarded UPDATE)
 * against the live test PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every DB-touching test runs inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers (`createTestUser`
 *    with `role: "teacher"`) — never seed data. The one custom setup helper
 *    (`createUncertifiedTeacher`) inserts the pre-certification precondition
 *    row directly because entity-setup has no teacher helper.
 *  - Error assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited inside `runInRollback`.
 *    Both write methods under test signal "guard failed" by returning `null`,
 *    not by throwing; the only exercised throwing path is the duplicate-PK
 *    `23505` driver error, asserted via the cause-chain walk.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): findById hit + null miss; insert honors schema
 *    defaults (`averageRating`/`subjects` NULL, `isOnline` false,
 *    `requestPreference` 'queue') for both `makeEvaluator` values; elevate
 *    happy path returns the approved row; elevate on a missing id returns
 *    null.
 *  - Tier 2 (boundary): elevate on an already-approved row returns null and
 *    leaves the row byte-identical (guard evaluated inside the single
 *    statement); duplicate-PK insert surfaces the raw `23505` via the
 *    Drizzle cause chain (savepoint-bracketed so the outer tx stays usable).
 *  - Tier 3 (chaos): concurrent double-insert on the same session admits
 *    exactly one arm and rejects the other with `23505` (FIFO-serialized
 *    statements make the race deterministic); concurrent double-elevate
 *    yields exactly one RETURNING row — the guarded predicate makes the
 *    second statement match zero rows.
 *  - Tier 4 (security/tenancy): write methods declare a mandatory `tx`
 *    parameter (arity check — no `?? db` fallback exists on the write
 *    paths); elevating one teacher never touches another id's row.
 */

import { describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { TeacherRepository } from "@/backend/db/repo";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, TeacherSelectType } from "@/backend/types";

/** PostgreSQL error code for `unique_violation`. */
const PG_UNIQUE_VIOLATION = "23505";

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
 * Returns an integer id that cannot exist as a `teacher` row during this
 * transaction: teacher shares its PK with `users.id`, so anything above the
 * current max (plus a large offset that no sequence reaches during a
 * rolled-back test) is guaranteed absent.
 */
async function absentTeacherId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${teacher.id}), 0)::int` }).from(teacher);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Custom setup helper: inserts a teacher row carrying ONLY the shared PK so
 * schema defaults produce the pre-certification state (`isApproved` false,
 * `isEvaluator` false). A `users` row with `role "teacher"` must already
 * exist for `userId`.
 */
async function createUncertifiedTeacher(tx: DBTransaction, userId: number): Promise<TeacherSelectType> {
  const [row] = await tx.insert(teacher).values({ id: userId }).returning();
  if (!row) {
    throw new Error("createUncertifiedTeacher: insert returned no rows");
  }
  return row;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx, NOT
 * routed through the repository method under test.
 */
async function readTeacherRow(tx: DBTransaction, id: number): Promise<TeacherSelectType | null> {
  const rows = await tx.select().from(teacher).where(eq(teacher.id, id));
  return rows[0] ?? null;
}

describe("TeacherRepository cold-start certification", () => {
  // ─── Tier 1: branch/statement ─────────────────────────────────────────

  test("findById returns the inserted row on hit and null on miss", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const inserted = await TeacherRepository.insertColdStartCertified(user.id, false, tx);

      const found = await TeacherRepository.findById(user.id, tx);
      expect(found).not.toBeNull();
      expect(found?.id).toBe(inserted.id);
      expect(found?.isApproved).toBe(true);
      expect(found?.isEvaluator).toBe(false);

      const missingId = await absentTeacherId(tx);
      const missed = await TeacherRepository.findById(missingId, tx);
      expect(missed).toBeNull();
    });
  });

  test("insertColdStartCertified writes only the certification fields; schema defaults carry the rest", async () => {
    await runInRollback(async tx => {
      const evaluatorUser = await createTestUser(tx, { role: "teacher" });
      const plainUser = await createTestUser(tx, { role: "teacher" });

      const evaluator = await TeacherRepository.insertColdStartCertified(evaluatorUser.id, true, tx);
      const plain = await TeacherRepository.insertColdStartCertified(plainUser.id, false, tx);

      for (const row of [evaluator, plain]) {
        expect(row.isApproved).toBe(true);
        expect(row.averageRating).toBeNull();
        expect(row.isOnline).toBe(false);
        expect(row.subjects).toBeNull();
        expect(row.requestPreference).toBe("queue");
        expect(row.createdAt).toBeInstanceOf(Date);
        expect(row.updatedAt).toBeInstanceOf(Date);
      }
      expect(evaluator.isEvaluator).toBe(true);
      expect(plain.isEvaluator).toBe(false);
    });
  });

  test("elevateToCertified approves an unapproved row in one guarded UPDATE and returns it", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const setup = await createUncertifiedTeacher(tx, user.id);
      expect(setup.isApproved).toBe(false);

      const elevated = await TeacherRepository.elevateToCertified(user.id, true, tx);
      expect(elevated).not.toBeNull();
      expect(elevated?.id).toBe(user.id);
      expect(elevated?.isApproved).toBe(true);
      expect(elevated?.isEvaluator).toBe(true);
      // `updatedAt` is re-stamped by the UPDATE (>= setup value; a same-tx
      // `now()` may equal the setup timestamp, so the bound is inclusive).
      expect(elevated?.updatedAt.getTime()).toBeGreaterThanOrEqual(setup.updatedAt.getTime());

      const persisted = await readTeacherRow(tx, user.id);
      expect(persisted?.isApproved).toBe(true);
      expect(persisted?.isEvaluator).toBe(true);
    });
  });

  test("elevateToCertified returns null when the id does not exist", async () => {
    await runInRollback(async tx => {
      const missingId = await absentTeacherId(tx);

      const elevated = await TeacherRepository.elevateToCertified(missingId, true, tx);
      expect(elevated).toBeNull();

      expect(await readTeacherRow(tx, missingId)).toBeNull();
    });
  });

  // ─── Tier 2: boundary ─────────────────────────────────────────────────

  test("elevateToCertified on an already-approved row returns null and leaves the row byte-identical", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      const approved = await TeacherRepository.insertColdStartCertified(user.id, false, tx);

      const elevated = await TeacherRepository.elevateToCertified(user.id, true, tx);
      expect(elevated).toBeNull();

      // The guard (`is_approved = false` in the WHERE clause) matched zero
      // rows, so nothing about the existing row changed — not even
      // `updatedAt` and not the requested `isEvaluator` flip.
      const persisted = await readTeacherRow(tx, user.id);
      expect(persisted?.isApproved).toBe(true);
      expect(persisted?.isEvaluator).toBe(approved.isEvaluator);
      expect(persisted?.updatedAt.getTime()).toBe(approved.updatedAt.getTime());
    });
  });

  test("insertColdStartCertified on an existing row surfaces the raw 23505 unique violation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await TeacherRepository.insertColdStartCertified(user.id, false, tx);

      // Bracket the rejected insert in a named savepoint so the 23505 rolls
      // back ONLY the failed statement — the outer transaction stays usable
      // for the read-back assertion (an unrescued statement error would
      // leave the tx in the aborted 25P02 state).
      await tx.execute(sql`savepoint teacher_repo_duplicate_pk`);
      const error = await expectRepoError(() => TeacherRepository.insertColdStartCertified(user.id, true, tx));
      await tx.execute(sql`rollback to savepoint teacher_repo_duplicate_pk`);

      // The repository does NOT translate driver errors — the raw pg code
      // surfaces through Drizzle's cause chain for the service layer to map.
      expect(hasPostgresErrorCode(error, PG_UNIQUE_VIOLATION)).toBe(true);

      // The rejected insert did not overwrite the original row.
      const persisted = await readTeacherRow(tx, user.id);
      expect(persisted?.isEvaluator).toBe(false);
    });
  });

  // ─── Tier 3: chaos / concurrency ──────────────────────────────────────

  test("concurrent double-insert admits exactly one arm and rejects the other with 23505", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });

      // Both inserts race on the same session; statements serialize FIFO on
      // the single connection, so exactly one arm is admitted. The race is
      // bracketed by ONE named savepoint and rescued by rolling back to it
      // as the very next statement after settlement — this lifts the aborted
      // state off the outer tx (no per-statement implicit savepoint exists,
      // and Drizzle's nested-transaction savepoint naming collides under
      // concurrency).
      await tx.execute(sql`savepoint teacher_repo_insert_race`);

      const settledArms = await Promise.allSettled([
        TeacherRepository.insertColdStartCertified(user.id, true, tx),
        TeacherRepository.insertColdStartCertified(user.id, false, tx),
      ]);

      const fulfilledArms = settledArms.filter(arm => arm.status === "fulfilled");
      const rejectedArms = settledArms.filter(arm => arm.status === "rejected");
      expect(fulfilledArms).toHaveLength(1);
      expect(rejectedArms).toHaveLength(1);

      const rejectedArm = rejectedArms[0];
      if (rejectedArm?.status !== "rejected") {
        throw new Error("expected exactly one rejected race arm");
      }
      expect(hasPostgresErrorCode(rejectedArm.reason, PG_UNIQUE_VIOLATION)).toBe(true);

      await tx.execute(sql`rollback to savepoint teacher_repo_insert_race`);

      // The race window left zero residual rows; the deterministic single
      // insert that follows proves the repository admits exactly one row for
      // the id carrying the certification flags.
      const winner = await TeacherRepository.insertColdStartCertified(user.id, true, tx);
      const rows = await tx.select().from(teacher).where(eq(teacher.id, user.id));
      expect(rows).toHaveLength(1);
      expect(winner.isApproved).toBe(true);
      expect(winner.isEvaluator).toBe(true);
    });
  });

  test("concurrent double-elevate returns exactly one RETURNING row", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createUncertifiedTeacher(tx, user.id);

      // Two UPDATE statements serialize FIFO on the same session: the first
      // matches the `is_approved = false` guard and returns the row; the
      // second sees the flipped flag and matches zero rows (null). Both
      // arms settle fulfilled — a guarded UPDATE never throws on zero-match.
      const settledArms = await Promise.allSettled([
        TeacherRepository.elevateToCertified(user.id, true, tx),
        TeacherRepository.elevateToCertified(user.id, false, tx),
      ]);

      const returnedRows = settledArms.map(arm => (arm.status === "fulfilled" ? arm.value : null));
      const winners = returnedRows.filter(row => row !== null);
      expect(winners).toHaveLength(1);

      // The persisted row carries exactly one certification — the winning
      // arm's `makeEvaluator` flag (arm 0 passed `true`, arm 1 `false`).
      const persisted = await readTeacherRow(tx, user.id);
      expect(persisted?.isApproved).toBe(true);
      expect(persisted?.isEvaluator).toBe(returnedRows[0] !== null);
    });
  });

  // ─── Tier 4: security / tenancy ───────────────────────────────────────

  test("write methods declare a mandatory tx parameter (no global-db write path exists)", () => {
    // Function arity counts parameters up to the first one carrying a
    // default value: `tx: DBTransaction` is REQUIRED on both writes, so a
    // caller omitting it fails at compile time — there is no `?? db`
    // fallback path to assert against at runtime.
    expect(TeacherRepository.insertColdStartCertified).toHaveLength(3);
    expect(TeacherRepository.elevateToCertified).toHaveLength(3);
  });

  test("elevate affects only the targeted id (no cross-id bleed)", async () => {
    await runInRollback(async tx => {
      const firstUser = await createTestUser(tx, { role: "teacher" });
      const secondUser = await createTestUser(tx, { role: "teacher" });
      const approvedFirst = await TeacherRepository.insertColdStartCertified(firstUser.id, false, tx);
      await createUncertifiedTeacher(tx, secondUser.id);

      const elevated = await TeacherRepository.elevateToCertified(secondUser.id, true, tx);
      expect(elevated?.id).toBe(secondUser.id);

      // The untouched row is byte-identical to its pre-update state.
      const persistedFirst = await readTeacherRow(tx, firstUser.id);
      expect(persistedFirst?.isApproved).toBe(true);
      expect(persistedFirst?.isEvaluator).toBe(approvedFirst.isEvaluator);
      expect(persistedFirst?.updatedAt.getTime()).toBe(approvedFirst.updatedAt.getTime());

      const persistedSecond = await readTeacherRow(tx, secondUser.id);
      expect(persistedSecond?.isApproved).toBe(true);
      expect(persistedSecond?.isEvaluator).toBe(true);
    });
  });
});
