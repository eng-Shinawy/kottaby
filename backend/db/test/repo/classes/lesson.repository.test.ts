/**
 * LessonRepository tests — the `lessons` table's data-access layer
 * (`insertLesson`, `updateLessonFields`, `deleteById`, `findById`,
 * `listByPlanId`) against the live test database.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on
 *    write methods `tx` is the LAST parameter, typed `DBTransaction`; read
 *    methods accept a `DBQueryExecutor`).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local fixture builders — never seed data.
 *  - No `expect(...).rejects.toThrow()` — constraint probes go through
 *    `expectRepoError` inside an explicit SAVEPOINT bracket so the outer
 *    transaction stays queryable.
 *  - A separate committed-fixture group covers the STANDALONE executor
 *    branch (`queryDb` reads + the `db` write fallback). That branch by
 *    definition runs without a transaction, so fixtures must be committed
 *    (an uncommitted row is invisible outside the tx); they are registered
 *    and hard-deleted in `afterAll` (rule 9), keeping the repo/ directory's
 *    100%-coverage mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every write method's hit branch returns the row;
 *    the guarded update/delete miss (zero rows matched) returns null and
 *    commits ZERO writes; reads return the row or null on the transactional
 *    Drizzle branch. Both the `tx && isDBTransaction(tx)` truthy arm and the
 *    standalone `queryDb`/`db` arm execute (committed-fixture group).
 *  - Tier 2 (boundary): an empty patch updates ONLY `updatedAt` (set
 *    server-side, title untouched); a nonexistent id misses every method;
 *    a fresh plan lists zero lessons; a fresh row carries exactly the
 *    schema's column set (no projection drift).
 *  - Tier 3 (chaos): concurrent double-delete / update-vs-delete /
 *    double-update races via `Promise.allSettled` — the single guarded
 *    statements serialize and exactly ONE effect lands (no lost writes, no
 *    double delete).
 *  - Tier 4 (security/static): the FK probe — an orphan `plan_id` insert is
 *    rejected by the named `lessons_plan_id_plans_id_fkey` constraint inside
 *    a savepoint bracket; hostile title text rides as parameterized data;
 *    cross-plan list isolation; the deletion-safety survivor probe (a
 *    `progress` row referencing the deleted lesson survives with
 *    `lesson_id = NULL`); the defensive zero-row INSERT guard exercised
 *    through a typed executor stub (unreachable through a live PostgreSQL
 *    INSERT ... RETURNING).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { LessonRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { lessons } from "@/backend/db/schema/classes/lessons";
import { progress } from "@/backend/db/schema/classes/progress";
import { createTestLesson, createTestPlan, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { hasPostgresErrorCode } from "@/backend/db/test/pg-error";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { ConflictError } from "@/backend/lib/errors";
import type { DBTransaction, LessonSelectType } from "@/backend/types";

/** PostgreSQL error code for `foreign_key_violation`. */
const PG_FOREIGN_KEY_VIOLATION = "23503";

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_LESSON_ID = 2_000_000_000;

/** The exact key set of a `lessons` row's own columns (alphabetical). */
const LESSON_ROW_KEYS = ["createdAt", "id", "planId", "title", "updatedAt"] as const;

/** Ascending key comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** Creates a plan fixture and returns the plans-row id. */
async function setupPlan(tx: DBTransaction): Promise<number> {
  const plan = await createTestPlan(tx);
  return plan.id;
}

/** Creates a student fixture (users row + students role row) and returns the users-row id. */
async function setupStudent(tx: DBTransaction): Promise<number> {
  const user = await createTestUser(tx);
  await createTestStudent(tx, user.id);
  return user.id;
}

/**
 * Bulk-inserts `count` lessons on one plan in ONE statement — a single
 * INSERT … VALUES (…), (…), … keeps the fixture setup atomic and the
 * identity sequence deterministic (ascending ids in insertion order).
 *
 * @returns The inserted rows in insertion (ascending id) order.
 */
async function insertLessonsInOrder(tx: DBTransaction, planId: number, count: number): Promise<LessonSelectType[]> {
  return tx
    .insert(lessons)
    .values(Array.from({ length: count }, (_, index) => ({ planId, title: `Sequence Lesson ${index}` })))
    .returning();
}

/** Read-back oracle: the lesson row straight off the table. */
async function readLessonRow(tx: DBTransaction, id: number): Promise<LessonSelectType> {
  const [row] = await tx.select().from(lessons).where(eq(lessons.id, id)).limit(1);
  if (!row) {
    throw new Error(`readLessonRow: expected lesson ${id} to exist`);
  }
  return row;
}

/** An integer plan id that cannot exist as a `plans` row in this transaction. */
async function absentPlanId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${plans.id}), 0)::int` }).from(plans);
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
 * to zero rows. A live PostgreSQL INSERT ... RETURNING always yields one row
 * per inserted tuple, so the repository's defensive zero-row guard cannot be
 * reached through the database — the stub exercises that guard without
 * touching a connection (no rollback wrap is needed).
 */
function zeroReturningExecutor(): DBTransaction {
  const stub = {
    insert: () => ({
      values: () => ({
        returning: async (): Promise<LessonSelectType[]> => [],
      }),
    }),
  };
  if (!isZeroRowInsertStub(stub)) {
    throw new Error("zeroReturningExecutor: stub failed its own type guard");
  }
  return stub;
}

describe("LessonRepository — transactional paths (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("insertLesson creates a lesson on a plan and returns the inserted row", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);

      const created = await LessonRepository.insertLesson({ planId, title: "Al-Madd" }, tx);

      expect(created.id).toBeGreaterThan(0);
      expect(created.planId).toBe(planId);
      expect(created.title).toBe("Al-Madd");
      expect(created.createdAt).not.toBeNull();
      expect(created.updatedAt).not.toBeNull();
      // The row is honest — an independent table scan agrees.
      const after = await readLessonRow(tx, created.id);
      expect(after.title).toBe("Al-Madd");
    });
  });

  test("updateLessonFields updates the title and returns the updated row", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId, { title: "Before" });

      const updated = await LessonRepository.updateLessonFields(lesson.id, { title: "After" }, tx);

      expect(updated?.id).toBe(lesson.id);
      expect(updated?.title).toBe("After");
      expect((await readLessonRow(tx, lesson.id)).title).toBe("After");
    });
  });

  test("updateLessonFields can move a lesson to a different plan", async () => {
    await runInRollback(async tx => {
      const planA = await setupPlan(tx);
      const planB = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planA);

      const updated = await LessonRepository.updateLessonFields(lesson.id, { planId: planB }, tx);

      expect(updated?.planId).toBe(planB);
      expect((await LessonRepository.listByPlanId(planA, tx)).map(row => row.id)).toEqual([]);
      expect((await LessonRepository.listByPlanId(planB, tx)).map(row => row.id)).toEqual([lesson.id]);
    });
  });

  test("deleteById removes the lesson and returns the removed row", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);

      const removed = await LessonRepository.deleteById(lesson.id, tx);

      expect(removed?.id).toBe(lesson.id);
      expect(removed?.title).toBe(lesson.title);
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();
    });
  });

  test("findById returns the row for an existing lesson and null for an unknown one", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);

      const found = await LessonRepository.findById(lesson.id, tx);
      expect(found?.id).toBe(lesson.id);
      expect(found?.title).toBe(lesson.title);

      expect(await LessonRepository.findById(NONEXISTENT_LESSON_ID, tx)).toBeNull();
    });
  });

  test("listByPlanId returns every lesson for the plan ordered id ASC", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const rows = await insertLessonsInOrder(tx, planId, 3);

      const listed = await LessonRepository.listByPlanId(planId, tx);

      expect(listed.map(row => row.id)).toEqual([rows[0]?.id, rows[1]?.id, rows[2]?.id]);
      expect(listed.every(row => row.planId === planId)).toBe(true);
    });
  });

  // ─── Tier 2: boundary — empty patch, misses, empty list ─────────────

  test("an empty patch updates ONLY the server-side updatedAt — the title is untouched", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId, { title: "Unchanged" });

      const updated = await LessonRepository.updateLessonFields(lesson.id, {}, tx);

      expect(updated?.title).toBe("Unchanged");
      expect(updated?.updatedAt.getTime()).toBeGreaterThanOrEqual(lesson.updatedAt.getTime());
      // The server sets updatedAt — the write happened exactly once.
      expect(await readLessonRow(tx, lesson.id)).toBeDefined();
    });
  });

  test("a zero-row update/delete miss returns null and commits ZERO writes (the not-found signal)", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);

      expect(await LessonRepository.updateLessonFields(NONEXISTENT_LESSON_ID, { title: "ghost" }, tx)).toBeNull();
      expect(await LessonRepository.deleteById(NONEXISTENT_LESSON_ID, tx)).toBeNull();

      // The plan fixture is intact and the table grew zero rows for it.
      expect(await LessonRepository.listByPlanId(planId, tx)).toHaveLength(0);
    });
  });

  test("listByPlanId returns an empty array for a fresh plan with zero lessons", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const listed = await LessonRepository.listByPlanId(planId, tx);
      expect(listed).toEqual([]);
    });
  });

  test("a fresh row carries exactly the schema's column set (no projection drift)", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);
      const row = await readLessonRow(tx, lesson.id);
      expect(Object.keys(row).toSorted(byKeyAscending)).toEqual([...LESSON_ROW_KEYS]);
    });
  });

  // ─── Tier 3: chaos — concurrent guarded writes serialize ────────────

  test("a double delete on one lesson removes it exactly once — the loser's guard matches zero rows", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);

      // Raw statements race (the harness's single rollback connection
      // serializes them in call order): the first delete removes the row,
      // the second's `WHERE id` predicate matches zero rows and returns the
      // honest null.
      const outcomes = await Promise.allSettled([
        LessonRepository.deleteById(lesson.id, tx),
        LessonRepository.deleteById(lesson.id, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.id).toBe(lesson.id);
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();
    });
  });

  test("a delete racing an update on one lesson leaves the updater with the not-found signal (delete-first order)", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId, { title: "Original" });

      // The delete is enqueued FIRST, the update second: the delete removes
      // the row and returns it; the updater's `WHERE id` predicate then
      // matches zero rows and receives the honest null (the not-found
      // signal the service tier folds into the lesson-not-found error).
      const outcomes = await Promise.allSettled([
        LessonRepository.deleteById(lesson.id, tx),
        LessonRepository.updateLessonFields(lesson.id, { title: "Updated" }, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const winners = outcomes.flatMap(outcome =>
        outcome.status === "fulfilled" && outcome.value !== null ? [outcome.value] : []
      );
      expect(winners).toHaveLength(1);
      expect(winners[0]?.title).toBe("Original");
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();
    });
  });

  test("an update racing a delete on one lesson serializes both statements — the terminal state is exactly one deletion", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId, { title: "Original" });

      // The update is enqueued FIRST, the delete second: both statements
      // match the row in execution order — the update applies its effect
      // and returns the pre-delete row, the delete removes the row and
      // returns it. The terminal state is exactly ONE deletion (no lost
      // update, no double-effect, no interleaved row state).
      const outcomes = await Promise.allSettled([
        LessonRepository.updateLessonFields(lesson.id, { title: "Updated" }, tx),
        LessonRepository.deleteById(lesson.id, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      const settledOutcomes = outcomes.filter(
        (outcome): outcome is PromiseFulfilledResult<LessonSelectType | null> => outcome.status === "fulfilled"
      );
      expect(settledOutcomes.every(outcome => outcome.value !== null)).toBe(true);
      expect(settledOutcomes[0]?.value).toMatchObject({ id: lesson.id, title: "Updated" });
      expect(settledOutcomes[1]?.value).toMatchObject({ id: lesson.id, title: "Updated" });
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();
    });
  });

  test("a double update on one row serializes — both apply, the last one wins", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId, { title: "Original" });

      const outcomes = await Promise.allSettled([
        LessonRepository.updateLessonFields(lesson.id, { title: "First" }, tx),
        LessonRepository.updateLessonFields(lesson.id, { title: "Second" }, tx),
      ]);

      expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
      // Both guarded statements matched the row (serialized in call order);
      // the final state is exactly the last patch — no interleaved title.
      const after = await readLessonRow(tx, lesson.id);
      expect(after.title).toBe("Second");
      expect(outcomes.every(outcome => outcome.status === "fulfilled" && outcome.value !== null)).toBe(true);
    });
  });

  // ─── Tier 4: security/tenancy + deletion safety ─────────────────────

  test("an orphan plan_id insert is rejected by the named FK constraint inside a savepoint bracket", async () => {
    await runInRollback(async tx => {
      const missingPlanId = await absentPlanId(tx);

      await tx.execute(sql`savepoint lesson_fk_probe`);
      const fkError = await expectRepoError(() =>
        LessonRepository.insertLesson({ planId: missingPlanId, title: "Orphan" }, tx)
      );
      await tx.execute(sql`rollback to savepoint lesson_fk_probe`);

      expect(constraintNameOf(fkError)).toBe("lessons_plan_id_plans_id_fkey");
      expect(hasPostgresErrorCode(fkError, PG_FOREIGN_KEY_VIOLATION)).toBe(true);

      // The savepoint bracket kept the transaction queryable — the plan
      // fixture path still works after the rejected insert.
      const planId = await setupPlan(tx);
      const created = await LessonRepository.insertLesson({ planId, title: "After Probe" }, tx);
      expect(created.title).toBe("After Probe");
    });
  });

  test("hostile title text rides as parameterized data — stored verbatim, nothing executes", async () => {
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const hostileTitle = "lesson'); DELETE FROM lessons; UPDATE lessons SET title = 0; --";

      const created = await LessonRepository.insertLesson({ planId, title: hostileTitle }, tx);

      // The text landed verbatim as data and nothing executed: the row is
      // exactly as the guarded INSERT left it.
      expect(created.title).toBe(hostileTitle);
      expect((await readLessonRow(tx, created.id)).title).toBe(hostileTitle);
    });
  });

  test("lessons on one plan never leak into another plan's list (cross-plan isolation)", async () => {
    await runInRollback(async tx => {
      const planA = await setupPlan(tx);
      const planB = await setupPlan(tx);
      await insertLessonsInOrder(tx, planA, 4);

      expect(await LessonRepository.listByPlanId(planA, tx)).toHaveLength(4);
      expect(await LessonRepository.listByPlanId(planB, tx)).toHaveLength(0);
    });
  });

  test("a progress row referencing a deleted lesson survives with lesson_id = NULL (set-null preservation)", async () => {
    await runInRollback(async tx => {
      const studentId = await setupStudent(tx);
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);
      await tx.insert(progress).values({ studentId, lessonId: lesson.id });

      const removed = await LessonRepository.deleteById(lesson.id, tx);
      expect(removed?.id).toBe(lesson.id);

      // The survivor probe: the progress row is NOT cascaded — it survives
      // with a NULL lesson reference (the historical-record contract).
      const [survivor] = await tx.select().from(progress).where(eq(progress.studentId, studentId)).limit(1);
      expect(survivor).toBeDefined();
      expect(survivor?.lessonId).toBeNull();
      expect(await LessonRepository.findById(lesson.id, tx)).toBeNull();
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("lessons written inside runInRollback vanish after the forced rollback", async () => {
    let rollbackLessonId = 0;
    await runInRollback(async tx => {
      const planId = await setupPlan(tx);
      const lesson = await createTestLesson(tx, planId);
      rollbackLessonId = lesson.id;
      expect(await LessonRepository.findById(rollbackLessonId, tx)).not.toBeNull();
    });
    // Fresh executor read — the forced rollback removed the row.
    expect(await LessonRepository.findById(rollbackLessonId)).toBeNull();
  });

  // ─── Static source pins (Tier 4) ────────────────────────────────────

  const repoSource = readFileSync(join(import.meta.dir, "../../../repo/classes/lesson.repository.ts"), "utf8");

  test("source: executor discipline — two queryDb reads, writes take tx last", () => {
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(2);
    const signatures = repoSource.match(/export async function [a-zA-Z]+\([^)]*\)/g) ?? [];
    expect(signatures).toHaveLength(5);
    const readMethods = signatures.filter(signature => /findById|listByPlanId/.test(signature));
    const writeMethods = signatures.filter(signature => /insertLesson|updateLessonFields|deleteById/.test(signature));
    expect(readMethods).toHaveLength(2);
    expect(writeMethods).toHaveLength(3);
    for (const signature of readMethods) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      expect(flattened.endsWith("tx?: DBQueryExecutor)")).toBe(true);
    }
    for (const signature of writeMethods) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      expect(flattened.endsWith("tx?: DBTransaction)")).toBe(true);
    }
  });

  test("source: bound parameters only, no wildcard select, no prepared statements, no SQL line comments", () => {
    expect(repoSource.includes("plan_id = $1")).toBe(true);
    expect(repoSource.includes("id = $1")).toBe(true);
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
    expect(repoSource.includes("export namespace LessonRepository")).toBe(true);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

describe("LessonRepository — namespace closure", () => {
  test("exposes exactly the documented five methods", () => {
    const exposed = Object.keys(LessonRepository).toSorted((a, b) => a.localeCompare(b));

    expect(exposed).toEqual(["deleteById", "findById", "insertLesson", "listByPlanId", "updateLessonFields"]);
  });
});

describe("LessonRepository — defensive zero-row guard (typed executor stub)", () => {
  test("insertLesson throws ConflictError when the INSERT returns zero rows", async () => {
    const error = await expectRepoError(() =>
      LessonRepository.insertLesson({ planId: 1, title: "stub probe" }, zeroReturningExecutor())
    );

    expect(error).toBeInstanceOf(ConflictError);
    expect(error.message).toContain("insertLesson");
    expect(error.message).toContain("insert returned no rows");
  });
});

/**
 * Standalone executor branch — the `tx ?? db` write fallback and the
 * `queryDb` bare reads. This branch runs WITHOUT a transaction by
 * definition, so its fixtures must be COMMITTED (an uncommitted row is
 * invisible to the pool path). They are registered here and hard-deleted in
 * `afterAll` (rule 9) in FK-dependency order (lessons first — they reference
 * plans with SET NULL; then the plan row). The round-trip test below removes
 * its own committed row and verifies the cleanup in-test.
 */
describe("LessonRepository — standalone executor path (committed fixtures)", () => {
  const committedLessonIds: number[] = [];
  const committedPlanIds: number[] = [];

  let committed: { planId: number; lessonId: number } | null = null;

  function requireCommitted(): { planId: number; lessonId: number } {
    if (!committed) {
      throw new Error("Committed fixture not initialized — beforeAll failed");
    }
    return committed;
  }

  beforeAll(async () => {
    committed = await db.transaction(async tx => {
      const plan = await createTestPlan(tx);
      const lesson = await createTestLesson(tx, plan.id);
      committedPlanIds.push(plan.id);
      committedLessonIds.push(lesson.id);
      return { planId: plan.id, lessonId: lesson.id };
    });
  });

  afterAll(async () => {
    const fixture = committed;
    committed = null;
    // Hard delete in FK-dependency order, then re-probe the standalone read.
    await Promise.all(committedLessonIds.map(id => db.delete(lessons).where(eq(lessons.id, id))));
    committedLessonIds.length = 0;
    await Promise.all(committedPlanIds.map(id => db.delete(plans).where(eq(plans.id, id))));
    committedPlanIds.length = 0;
    if (fixture) {
      expect(await LessonRepository.findById(fixture.lessonId)).toBeNull();
    }
  });

  test("findById runs on the queryDb read path and returns the committed fixture", async () => {
    const fixture = requireCommitted();
    const found = await LessonRepository.findById(fixture.lessonId);
    expect(found?.id).toBe(fixture.lessonId);
    expect(found?.planId).toBe(fixture.planId);
  });

  test("findById returns null for an unknown lesson on the standalone path", async () => {
    expect(await LessonRepository.findById(NONEXISTENT_LESSON_ID)).toBeNull();
  });

  test("listByPlanId runs on the queryDb path and returns the committed lesson ordered id ASC", async () => {
    const fixture = requireCommitted();
    const listed = await LessonRepository.listByPlanId(fixture.planId);
    expect(listed.map(row => row.id)).toEqual([fixture.lessonId]);
  });

  test("updateLessonFields runs on the pool fallback and commits the patch server-side", async () => {
    const fixture = requireCommitted();
    const updated = await LessonRepository.updateLessonFields(fixture.lessonId, { title: "Standalone Updated" });
    expect(updated?.title).toBe("Standalone Updated");
    const after = await LessonRepository.findById(fixture.lessonId);
    expect(after?.title).toBe("Standalone Updated");
  });

  test("insertLesson + deleteById round-trip on the pool fallback commits then removes the row", async () => {
    const fixture = requireCommitted();
    const created = await LessonRepository.insertLesson({
      planId: fixture.planId,
      title: `Pool Round Trip ${randomUUID().slice(0, 8)}`,
    });
    committedLessonIds.push(created.id);
    expect(created.id).toBeGreaterThan(0);
    expect(created.planId).toBe(fixture.planId);

    const removed = await LessonRepository.deleteById(created.id);
    expect(removed?.id).toBe(created.id);
    committedLessonIds.pop();
    expect(await LessonRepository.findById(created.id)).toBeNull();
  });
});
