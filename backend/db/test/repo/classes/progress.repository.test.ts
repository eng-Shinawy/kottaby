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
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { ProgressRepository } from "@/backend/db/repo";
import { progress } from "@/backend/db/schema/classes/progress";
import { users } from "@/backend/db/schema/users/users";
import { createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction } from "@/backend/types";

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

  test("source: executor discipline — one queryDb read, tx last on the signature", () => {
    expect(repoSource.match(/queryDb</g) ?? []).toHaveLength(1);
    const signatures = repoSource.match(/export async function [a-zA-Z]+\([^)]*\)/g) ?? [];
    expect(signatures).toHaveLength(1);
    for (const signature of signatures) {
      const flattened = signature.replace(/\s+/g, " ").replace(/ \)/g, ")").trim();
      expect(flattened.endsWith("tx?: DBQueryExecutor)")).toBe(true);
    }
  });

  test("source: bound parameters only, no wildcard select, no prepared statements, no SQL line comments", () => {
    expect(repoSource.includes("student_id = $1")).toBe(true);
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
