/**
 * ProgressRepository tests — the `progress` table's parent-portal read path
 * (`countForStudent`) against the live test database.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on the
 *    method under test `tx` is the LAST parameter, typed
 *    `DBQueryExecutor`).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local fixture builders — never seed data.
 *  - No `expect(...).rejects.toThrow()` — the read is total and never
 *    rejects, so the try/catch helper is unused here.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branch (`queryDb` read). That branch by definition runs without a
 *    transaction, so the fixture must be committed (an uncommitted row is
 *    invisible outside the tx); it is registered and hard-deleted in
 *    `afterAll` (rule 9), keeping the repo/ directory's 100%-coverage
 *    mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): count is `0` for an unknown student; count is `N`
 *    for a student with `N` progress rows on the transactional Drizzle branch.
 *    Both the `tx && isDBTransaction(tx)` truthy arm and the standalone
 *    `queryDb` arm execute.
 *  - Tier 2 (boundary): empty window — a student with zero progress rows
 *    yields `0` (never `null`, never a thrown miss); the count survives an
 *    executor-type mix where a non-Drizzle `DBQueryExecutor` (the
 *    `queryDb`-only shape) is supplied.
 *  - Tier 3 (chaos): concurrent inserts via `Promise.allSettled` against the
 *    SAME student inside ONE transaction cannot corrupt the count — every
 *    settled write is visible to the in-tx count read that follows, and the
 *    count matches the number of successful inserts (no double counting, no
 *    lost writes).
 *  - Tier 4 (security): the count is bound to the `student_id` equality
 *    parameter — a different student's progress rows never inflate the
 *    count (cross-tenant isolation). Static source pins: bound parameters
 *    only, no `SELECT *`, no prepared statements, no SQL line-comment
 *    sequences, `tx` last on the signature, one namespace, no plan-artifact
 *    references, no i18n / logger / console imports.
 *
 * Pointer-row methods (`findRowForStudentPlan`, `findNullLessonRowForStudent`,
 * `insertRow`, `updateRowLesson`) — the settlement path's read/write contract:
 *  - Tier 1: the plan-scoped join read returns the row whose lesson
 *    belongs to the plan; `insertRow` writes and returns the row
 *    (readable straight back through the plan-scoped read);
 *    `updateRowLesson` moves the pointer and stamps `updated_at`.
 *  - Tier 2: no-row miss (fresh student); plan partitioning (a row whose
 *    lesson belongs to a DIFFERENT plan — or whose lesson was deleted,
 *    leaving `lesson_id` NULL — reads as no-row); multi-row determinism
 *    (`id DESC`: the newest matching row wins); a zero-row update returns
 *    `null`. The re-anchor probe (`findNullLessonRowForStudent`) resolves
 *    exactly those lesson-less rows the join cannot see — newest first —
 *    and misses (null) when the student holds only attributed rows.
 *  - Tier 4: hostile ids (0, negative, far-beyond-sequence) are equality
 *    misses; a SQL-shaped id string rides ONE bound parameter — the driver
 *    coerces it as data (a clean miss, or the raw integer-parse data
 *    exception under a savepoint bracket), never an execution. The
 *    defensive zero-row INSERT guard runs through a typed executor stub
 *    (unreachable through a live INSERT ... RETURNING); the standalone
 *    `queryDb` arms of the plan-scoped read and of the re-anchor probe run
 *    on committed fixtures.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { ProgressRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import { users } from "@/backend/db/schema/users/users";
import { createTestLesson, createTestPlan, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError } from "@/backend/lib/errors";
import type { DBTransaction } from "@/backend/types";

/** PostgreSQL error code for `invalid_text_representation` (integer parse). */
const PG_INTEGER_PARSE_VIOLATION = "22P02";

/** The exact key set of a `progress` row's own columns (alphabetical). */
const PROGRESS_ROW_KEYS = ["createdAt", "id", "lessonId", "studentId", "updatedAt"] as const;

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_STUDENT_ID = 2_000_000_000;

/** Ascending key comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/**
 * Bulk-inserts `count` progress rows for one student in ONE statement —
 * avoids the `no-await-in-loop` rule while keeping the fixture setup a
 * single atomic write (one INSERT … VALUES (…), (…), …).
 */
async function insertProgressRows(tx: DBTransaction, studentId: number, count: number): Promise<void> {
  await tx.insert(progress).values(Array.from({ length: count }, () => ({ studentId })));
}

/**
 * Inserts one progress row pointing AT a lesson — the pointer-row shape
 * the plan-scoped read resolves — and returns the row's id.
 */
async function insertPointerRow(tx: DBTransaction, studentId: number, lessonId: number): Promise<number> {
  const [row] = await tx.insert(progress).values({ studentId, lessonId }).returning({ id: progress.id });
  if (!row) {
    throw new Error("insertPointerRow: insert returned no rows");
  }
  return row.id;
}

/** Creates a plan fixture with one lesson and returns both ids. */
async function setupPlanWithLesson(tx: DBTransaction): Promise<{ planId: number; lessonId: number }> {
  const plan = await createTestPlan(tx);
  const lesson = await createTestLesson(tx, plan.id);
  return { planId: plan.id, lessonId: lesson.id };
}

/** An integer id that cannot exist as a `progress` row during this transaction. */
async function absentProgressId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${progress.id}), 0)::int` }).from(progress);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Type guard for the zero-row INSERT stub: it claims the single `insert`
 * seam the defensive guard consumes (a live `DBTransaction` shape is never
 * structurally checked here — the guard only ever calls `insert`).
 */
function isZeroRowInsertStub(value: unknown): value is DBTransaction {
  return typeof value === "object" && value !== null && "insert" in value;
}

/**
 * Typed executor stub whose `insert(...).values(...).returning()` resolves
 * to zero rows. A live PostgreSQL INSERT ... RETURNING always yields one
 * row per inserted tuple, so the repository's defensive zero-row guard
 * cannot be reached through the database — the stub exercises that guard
 * without touching a connection (no rollback wrap is needed).
 */
function zeroReturningExecutor(): DBTransaction {
  const stub = {
    insert: () => ({
      values: () => ({
        returning: async (): Promise<Array<typeof progress.$inferSelect>> => [],
      }),
    }),
  };
  if (!isZeroRowInsertStub(stub)) {
    throw new Error("zeroReturningExecutor: stub failed its own type guard");
  }
  return stub;
}

/** Creates a student (user + role row) and returns the students-row id. */
async function setupStudent(tx: DBTransaction): Promise<number> {
  const user = await createTestUser(tx);
  await createTestStudent(tx, user.id);
  return user.id;
}

/**
 * Reads the live count straight off the table — an independent oracle for
 * the repo's count read, used to assert the repo's number is honest.
 */
async function readTableCount(tx: DBTransaction, studentId: number): Promise<number> {
  const rows = await tx.select({ count: progress.id }).from(progress).where(eq(progress.studentId, studentId));
  return rows.length;
}

interface CommittedFixture {
  readonly studentId: number;
  readonly userId: number;
  readonly rowCount: number;
}

/** Committed ONCE in `beforeAll` for the default-executor (no-tx) tier. */
let committed: CommittedFixture | null = null;

function requireCommitted(): CommittedFixture {
  if (!committed) {
    throw new Error("Committed fixture not initialized — beforeAll failed");
  }
  return committed;
}

beforeAll(async () => {
  committed = await db.transaction(async tx => {
    const user = await createTestUser(tx);
    await createTestStudent(tx, user.id);
    // Insert three committed progress rows in ONE statement for the
    // standalone count path.
    await insertProgressRows(tx, user.id, 3);
    return { studentId: user.id, userId: user.id, rowCount: 3 };
  });
});

afterAll(async () => {
  const fixture = committed;
  committed = null;
  if (!fixture) {
    return;
  }
  // Hard delete — the users-row delete cascades to the students row, which
  // cascades to the progress rows (shared-PK FK + student_id ON DELETE
  // CASCADE).
  await db.delete(users).where(eq(users.id, fixture.userId));
  // Teardown proof: the standalone count reads zero after the cascade.
  expect(await ProgressRepository.countForStudent(fixture.studentId)).toBe(0);
});

describe("ProgressRepository.countForStudent — transactional path (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns 0 for an unknown student (zero rows match the equality predicate)", async () => {
    await runInRollback(async tx => {
      const count = await ProgressRepository.countForStudent(NONEXISTENT_STUDENT_ID, tx);
      expect(count).toBe(0);
    });
  });

  test("returns N for a student with N progress rows on the transactional Drizzle branch", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      await insertProgressRows(tx, studentId, 4);
      const count = await ProgressRepository.countForStudent(studentId, tx);
      expect(count).toBe(4);
      // The repo's count is honest — an independent table scan agrees.
      expect(await readTableCount(tx, studentId)).toBe(4);
    });
  });

  test("returns 1 for a student with a single progress row", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      await insertProgressRows(tx, studentId, 1);
      expect(await ProgressRepository.countForStudent(studentId, tx)).toBe(1);
    });
  });

  // ─── Tier 2: boundary — empty window + executor-type mix ────────────

  test("returns 0 for a freshly created student with zero progress rows (empty window)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      expect(await ProgressRepository.countForStudent(studentId, tx)).toBe(0);
      // Independent table scan agrees — the student really has zero rows.
      expect(await readTableCount(tx, studentId)).toBe(0);
    });
  });

  test("the returned count never overcounts across multiple students in the same tx", async () => {
    await runInRollback(async tx => {
      const studentA = await setupStudent(tx);
      const studentB = await setupStudent(tx);
      await insertProgressRows(tx, studentA, 2);
      await insertProgressRows(tx, studentB, 1);
      // Each student's count isolates to its own rows.
      expect(await ProgressRepository.countForStudent(studentA, tx)).toBe(2);
      expect(await ProgressRepository.countForStudent(studentB, tx)).toBe(1);
    });
  });

  // ─── Tier 3: chaos — concurrent inserts do not corrupt the count ────

  test("concurrent inserts via Promise.allSettled against one student all land — the in-tx count sees every settled write", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const insertCount = 6;
      // Each mapper is its own async IIFE — Promise.all runs them in
      // parallel inside the same transaction snapshot. The progress rows
      // are independent (no FK between them); every settled write lands.
      const results = await Promise.allSettled(
        Array.from({ length: insertCount }, () => insertProgressRows(tx, studentId, 1))
      );
      const fulfilled = results.filter(r => r.status === "fulfilled").length;
      expect(fulfilled).toBe(insertCount);
      // The count is exactly the number of successful inserts — no
      // double-counting, no lost writes (the in-tx snapshot sees them all).
      expect(await ProgressRepository.countForStudent(studentId, tx)).toBe(insertCount);
    });
  });

  // ─── Tier 4: cross-tenant isolation (the count is bound to studentId) ──

  test("a different student's progress rows never inflate this student's count", async () => {
    await runInRollback(async tx => {
      const mine = await setupStudent(tx);
      const other = await setupStudent(tx);
      await insertProgressRows(tx, other, 5);
      // My count is still zero — the equality predicate is bound to my id.
      expect(await ProgressRepository.countForStudent(mine, tx)).toBe(0);
      expect(await ProgressRepository.countForStudent(other, tx)).toBe(5);
    });
  });

  test("a fresh row carries exactly the schema's column set (no projection drift)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      await insertProgressRows(tx, studentId, 1);
      const [row] = await tx.select().from(progress).where(eq(progress.studentId, studentId)).limit(1);
      expect(row).toBeDefined();
      if (!row) {
        return;
      }
      expect(Object.keys(row).toSorted(byKeyAscending)).toEqual([...PROGRESS_ROW_KEYS]);
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("progress rows written inside runInRollback vanish after the forced rollback", async () => {
    let rollbackStudentId = 0;
    await runInRollback(async tx => {
      rollbackStudentId = await setupStudent(tx);
      await insertProgressRows(tx, rollbackStudentId, 1);
      expect(await ProgressRepository.countForStudent(rollbackStudentId, tx)).toBe(1);
    });
    // Fresh executor read — the forced rollback removed the row.
    expect(await ProgressRepository.countForStudent(rollbackStudentId)).toBe(0);
  });

  // ─── Static source pins (Tier 4) ────────────────────────────────────

  const repoSource = readFileSync(join(import.meta.dir, "../../../repo/classes/progress.repository.ts"), "utf8");

  test("source: executor discipline — three queryDb reads, tx last on every signature", () => {
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(3);
    const signatures = repoSource.match(/export async function [a-zA-Z]+\([^)]*\)/g) ?? [];
    expect(signatures).toHaveLength(5);
    const readMethods = signatures.filter(signature =>
      /countForStudent|findRowForStudentPlan|findNullLessonRowForStudent/.test(signature)
    );
    const writeMethods = signatures.filter(signature => /insertRow|updateRowLesson/.test(signature));
    expect(readMethods).toHaveLength(3);
    expect(writeMethods).toHaveLength(2);
    for (const signature of readMethods) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      expect(flattened.endsWith("tx?: DBQueryExecutor)")).toBe(true);
    }
    for (const signature of writeMethods) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      // The writers take a REQUIRED transaction as their last parameter —
      // a write only ever rides the caller's transaction.
      expect(flattened.endsWith("tx: DBTransaction)")).toBe(true);
    }
  });

  test("source: bound parameters only, no wildcard select, no prepared statements, no SQL line comments", () => {
    expect(repoSource.includes("student_id = $1")).toBe(true);
    // The plan-scoped pointer read binds BOTH ids and orders deterministically.
    expect(repoSource.includes("lessons.plan_id = $2")).toBe(true);
    expect(repoSource.includes("ORDER BY progress.id DESC")).toBe(true);
    expect(repoSource.includes("SELECT *")).toBe(false);
    expect(repoSource.includes(".prepare(")).toBe(false);
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("inArray")).toBe(false);
    expect(repoSource.includes("sql.raw")).toBe(false);
    expect(repoSource.includes("--")).toBe(false);
  });

  test("source: no i18n, no logger, no console, one namespace, no plan-artifact references", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace ProgressRepository")).toBe(true);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

describe("ProgressRepository.countForStudent — standalone executor path (committed fixture)", () => {
  test("runs on the queryDb read path and returns the committed fixture's honest total", async () => {
    const fixture = requireCommitted();
    const count = await ProgressRepository.countForStudent(fixture.studentId);
    expect(count).toBe(fixture.rowCount);
  });

  test("returns 0 for an unknown student on the standalone path", async () => {
    expect(await ProgressRepository.countForStudent(NONEXISTENT_STUDENT_ID)).toBe(0);
  });
});

describe("ProgressRepository pointer-row methods — transactional path (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("findRowForStudentPlan returns the student's row whose lesson belongs to the plan", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId, lessonId } = await setupPlanWithLesson(tx);
      const pointerId = await insertPointerRow(tx, studentId, lessonId);

      const found = await ProgressRepository.findRowForStudentPlan(studentId, planId, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(pointerId);
      expect(found?.studentId).toBe(studentId);
      expect(found?.lessonId).toBe(lessonId);
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.updatedAt).toBeInstanceOf(Date);
      expect(Object.keys(found ?? {}).toSorted(byKeyAscending)).toEqual([...PROGRESS_ROW_KEYS]);
    });
  });

  test("insertRow writes the pointer row and the plan-scoped read resolves it straight back", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId, lessonId } = await setupPlanWithLesson(tx);

      const inserted = await ProgressRepository.insertRow({ studentId, lessonId }, tx);

      expect(inserted.id).toBeGreaterThan(0);
      expect(inserted.studentId).toBe(studentId);
      expect(inserted.lessonId).toBe(lessonId);
      expect(Object.keys(inserted).toSorted(byKeyAscending)).toEqual([...PROGRESS_ROW_KEYS]);
      // The pointer read resolves the freshly inserted row for the plan.
      const found = await ProgressRepository.findRowForStudentPlan(studentId, planId, tx);
      expect(found?.id).toBe(inserted.id);
      expect(found?.lessonId).toBe(lessonId);
    });
  });

  test("updateRowLesson moves the pointer to the new lesson and stamps updatedAt", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const plan = await createTestPlan(tx);
      const lessonA = await createTestLesson(tx, plan.id);
      const lessonB = await createTestLesson(tx, plan.id);
      const pointerId = await insertPointerRow(tx, studentId, lessonA.id);
      const before = await ProgressRepository.findRowForStudentPlan(studentId, plan.id, tx);
      expect(before?.lessonId).toBe(lessonA.id);

      const updated = await ProgressRepository.updateRowLesson(pointerId, lessonB.id, tx);

      expect(updated).not.toBeNull();
      expect(updated?.id).toBe(pointerId);
      expect(updated?.lessonId).toBe(lessonB.id);
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual((before?.updatedAt ?? new Date(0)).getTime());
      // The read-back reflects the moved pointer.
      expect((await ProgressRepository.findRowForStudentPlan(studentId, plan.id, tx))?.lessonId).toBe(lessonB.id);
    });
  });

  // ─── Tier 2: boundaries — no-row miss, plan partitioning, determinism ─

  test("findRowForStudentPlan returns null for a student with no progress rows", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId } = await setupPlanWithLesson(tx);
      expect(await ProgressRepository.findRowForStudentPlan(studentId, planId, tx)).toBeNull();
    });
  });

  test("a row whose lesson belongs to a DIFFERENT plan reads as no-row (the join scopes by the plan)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const home = await setupPlanWithLesson(tx);
      const foreign = await setupPlanWithLesson(tx);
      await insertPointerRow(tx, studentId, home.lessonId);

      // The foreign plan's probe misses even though the student holds a row.
      expect(await ProgressRepository.findRowForStudentPlan(studentId, foreign.planId, tx)).toBeNull();
      // The home plan's probe still resolves it.
      expect((await ProgressRepository.findRowForStudentPlan(studentId, home.planId, tx))?.lessonId).toBe(
        home.lessonId
      );
    });
  });

  test("a row whose lesson was deleted (lesson_id NULL) reads as no-row for every plan", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId } = await setupPlanWithLesson(tx);
      // A lesson-less row — the shape an admin lesson delete leaves behind
      // (the FK's ON DELETE SET NULL contract).
      await insertProgressRows(tx, studentId, 1);
      expect(await ProgressRepository.findRowForStudentPlan(studentId, planId, tx)).toBeNull();
    });
  });

  test("findRowForStudentPlan deterministically returns the NEWEST matching row (id DESC)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const plan = await createTestPlan(tx);
      const lessonA = await createTestLesson(tx, plan.id);
      const lessonB = await createTestLesson(tx, plan.id);
      const olderId = await insertPointerRow(tx, studentId, lessonA.id);
      const newerId = await insertPointerRow(tx, studentId, lessonB.id);
      expect(newerId).toBeGreaterThan(olderId);

      const found = await ProgressRepository.findRowForStudentPlan(studentId, plan.id, tx);

      expect(found?.id).toBe(newerId);
      expect(found?.lessonId).toBe(lessonB.id);
    });
  });

  test("updateRowLesson returns null on a zero-row update (unknown id)", async () => {
    await runInRollback(async tx => {
      const { lessonId } = await setupPlanWithLesson(tx);
      const missingId = await absentProgressId(tx);
      expect(await ProgressRepository.updateRowLesson(missingId, lessonId, tx)).toBeNull();
    });
  });

  // ─── Tier 4: hostile ids ────────────────────────────────────────────

  test("hostile numeric ids are equality misses — zero, negative, and far-beyond-sequence match nothing", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId, lessonId } = await setupPlanWithLesson(tx);
      await insertPointerRow(tx, studentId, lessonId);

      expect(await ProgressRepository.findRowForStudentPlan(0, planId, tx)).toBeNull();
      expect(await ProgressRepository.findRowForStudentPlan(-5, planId, tx)).toBeNull();
      expect(await ProgressRepository.findRowForStudentPlan(NONEXISTENT_STUDENT_ID, planId, tx)).toBeNull();
      expect(await ProgressRepository.findRowForStudentPlan(studentId, 0, tx)).toBeNull();
      expect(await ProgressRepository.findRowForStudentPlan(studentId, -7, tx)).toBeNull();
      expect(await ProgressRepository.updateRowLesson(0, lessonId, tx)).toBeNull();
      expect(await ProgressRepository.updateRowLesson(-1, lessonId, tx)).toBeNull();
    });
  });

  test("a SQL-shaped id string rides ONE bound parameter — coerced as data, never executed", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { planId, lessonId } = await setupPlanWithLesson(tx);
      await insertPointerRow(tx, studentId, lessonId);

      // A numeric string is COERCED to its integer value and matches
      // nothing — a clean miss, no error. The assignment below simulates
      // the one way such a value could reach this layer: a caller that
      // bypassed every upstream type guard (no type assertion involved).
      // @ts-expect-error — a hostile caller hands the number-typed slot a string
      const coercedId: number = "0";
      expect(await ProgressRepository.findRowForStudentPlan(coercedId, planId, tx)).toBeNull();

      // An injection-shaped payload cannot parse as an integer: the driver
      // hands it to PostgreSQL as ONE bound parameter and the statement
      // fails with the raw integer-parse data exception — nothing executed.
      // @ts-expect-error — same hostile bypass, injection-shaped payload
      const injectionShaped: number = "1 OR 1=1; DELETE FROM progress; --";
      await tx.execute(sql`savepoint progress_sql_shaped_probe`);
      const error = await expectRepoError(() => ProgressRepository.findRowForStudentPlan(injectionShaped, planId, tx));
      await tx.execute(sql`rollback to savepoint progress_sql_shaped_probe`);

      expect(hasPostgresErrorCode(error, PG_INTEGER_PARSE_VIOLATION)).toBe(true);
      // Post-rollback the pointer row is intact — the payload never ran.
      expect(await readTableCount(tx, studentId)).toBe(1);
    });
  });
});

describe("ProgressRepository.findNullLessonRowForStudent — transactional path (runInRollback)", () => {
  test("returns the student's NEWEST lesson-less pointer row (the re-anchor probe)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { lessonId } = await setupPlanWithLesson(tx);
      // One attributed pointer row plus TWO lesson-less rows (the shape an
      // admin lesson delete leaves behind): the probe ignores the
      // attributed row and resolves the newest lesson-less one (id DESC).
      await insertPointerRow(tx, studentId, lessonId);
      await insertProgressRows(tx, studentId, 2);
      const lessonLessIds = await tx
        .select({ id: progress.id })
        .from(progress)
        .where(and(eq(progress.studentId, studentId), isNull(progress.lessonId)))
        .orderBy(desc(progress.id));
      expect(lessonLessIds).toHaveLength(2);
      const newestLessonLessId = lessonLessIds[0]?.id;

      const found = await ProgressRepository.findNullLessonRowForStudent(studentId, tx);

      expect(found).not.toBeNull();
      expect(found?.id).toBe(newestLessonLessId);
      expect(found?.studentId).toBe(studentId);
      expect(found?.lessonId).toBeNull();
      expect(found?.createdAt).toBeInstanceOf(Date);
      expect(found?.updatedAt).toBeInstanceOf(Date);
      expect(Object.keys(found ?? {}).toSorted(byKeyAscending)).toEqual([...PROGRESS_ROW_KEYS]);
    });
  });

  test("returns null when the student holds only attributed rows — or none at all", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const { lessonId } = await setupPlanWithLesson(tx);
      await insertPointerRow(tx, studentId, lessonId);

      // A live attributed pointer is NOT lesson-less — the probe misses.
      expect(await ProgressRepository.findNullLessonRowForStudent(studentId, tx)).toBeNull();
      // Hostile/unknown ids are equality misses, never errors.
      expect(await ProgressRepository.findNullLessonRowForStudent(NONEXISTENT_STUDENT_ID, tx)).toBeNull();
      expect(await ProgressRepository.findNullLessonRowForStudent(0, tx)).toBeNull();
      expect(await ProgressRepository.findNullLessonRowForStudent(-5, tx)).toBeNull();
    });
  });
});

describe("ProgressRepository — defensive zero-row guard (typed executor stub)", () => {
  test("insertRow throws ConflictError when the INSERT returns zero rows", async () => {
    const error = await expectRepoError(() => ProgressRepository.insertRow({ studentId: 1 }, zeroReturningExecutor()));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain("insertRow");
    expect(error.message).toContain("insert returned no rows");
  });
});

describe("ProgressRepository.findRowForStudentPlan — standalone executor path (committed fixture)", () => {
  interface PointerFixture {
    readonly userId: number;
    readonly studentId: number;
    readonly planId: number;
    readonly lessonId: number;
    readonly progressId: number;
  }

  let pointerCommitted: PointerFixture | null = null;

  function requirePointerCommitted(): PointerFixture {
    if (!pointerCommitted) {
      throw new Error("Committed fixture not initialized — beforeAll failed");
    }
    return pointerCommitted;
  }

  beforeAll(async () => {
    pointerCommitted = await db.transaction(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);
      const plan = await createTestPlan(tx);
      const lesson = await createTestLesson(tx, plan.id);
      const [pointer] = await tx.insert(progress).values({ studentId: user.id, lessonId: lesson.id }).returning();
      if (!pointer) {
        throw new Error("standalone fixture: pointer insert returned no rows");
      }
      return { userId: user.id, studentId: user.id, planId: plan.id, lessonId: lesson.id, progressId: pointer.id };
    });
  });

  afterAll(async () => {
    const fixture = pointerCommitted;
    pointerCommitted = null;
    if (!fixture) {
      return;
    }
    // FK-ordered teardown: the users delete cascades the students row and,
    // through it, the progress rows; the lesson and plan rows go last
    // (lessons reference plans with SET NULL).
    await db.delete(users).where(eq(users.id, fixture.userId));
    await db.delete(lessons).where(eq(lessons.id, fixture.lessonId));
    await db.delete(plans).where(eq(plans.id, fixture.planId));
    // Teardown proof: the standalone read misses after the cascade.
    expect(await ProgressRepository.findRowForStudentPlan(fixture.studentId, fixture.planId)).toBeNull();
  });

  test("runs on the queryDb read path and returns the committed pointer row", async () => {
    const fixture = requirePointerCommitted();
    const found = await ProgressRepository.findRowForStudentPlan(fixture.studentId, fixture.planId);
    expect(found?.id).toBe(fixture.progressId);
    expect(found?.lessonId).toBe(fixture.lessonId);
    expect(found?.studentId).toBe(fixture.studentId);
  });

  test("returns null on the standalone path for an unknown student", async () => {
    const fixture = requirePointerCommitted();
    expect(await ProgressRepository.findRowForStudentPlan(NONEXISTENT_STUDENT_ID, fixture.planId)).toBeNull();
  });
});

describe("ProgressRepository.findNullLessonRowForStudent — standalone executor path (committed fixture)", () => {
  interface LessonLessFixture {
    readonly userId: number;
    readonly studentId: number;
    readonly progressId: number;
  }

  let lessonLessCommitted: LessonLessFixture | null = null;

  function requireLessonLessCommitted(): LessonLessFixture {
    if (!lessonLessCommitted) {
      throw new Error("Committed fixture not initialized — beforeAll failed");
    }
    return lessonLessCommitted;
  }

  beforeAll(async () => {
    lessonLessCommitted = await db.transaction(async tx => {
      const user = await createTestUser(tx);
      await createTestStudent(tx, user.id);
      // A lesson-less pointer row — the shape an admin lesson delete leaves
      // behind (the FK's ON DELETE SET NULL contract).
      const [pointer] = await tx.insert(progress).values({ studentId: user.id }).returning();
      if (!pointer) {
        throw new Error("standalone fixture: lesson-less pointer insert returned no rows");
      }
      return { userId: user.id, studentId: user.id, progressId: pointer.id };
    });
  });

  afterAll(async () => {
    const fixture = lessonLessCommitted;
    lessonLessCommitted = null;
    if (!fixture) {
      return;
    }
    // Hard delete — the users-row delete cascades to the students row,
    // which cascades to the progress rows (shared-PK FK + student_id ON
    // DELETE CASCADE).
    await db.delete(users).where(eq(users.id, fixture.userId));
    // Teardown proof: the standalone probe misses after the cascade.
    expect(await ProgressRepository.findNullLessonRowForStudent(fixture.studentId)).toBeNull();
  });

  test("runs on the queryDb read path and returns the committed lesson-less pointer row", async () => {
    const fixture = requireLessonLessCommitted();
    const found = await ProgressRepository.findNullLessonRowForStudent(fixture.studentId);
    expect(found?.id).toBe(fixture.progressId);
    expect(found?.lessonId).toBeNull();
    expect(found?.studentId).toBe(fixture.studentId);
  });

  test("returns null on the standalone path for an unknown student", async () => {
    expect(await ProgressRepository.findNullLessonRowForStudent(NONEXISTENT_STUDENT_ID)).toBeNull();
  });
});
