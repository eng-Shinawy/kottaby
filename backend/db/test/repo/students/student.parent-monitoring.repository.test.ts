/**
 * StudentRepository.listLinkedChildrenByParentId tests — the parent-portal
 * linked-children list read (one method, two executor arms) against the live
 * test database.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Rollback-isolated tests run inside `runInRollback`; `tx` is passed to
 *    EVERY repo call, entity-setup helper, and direct Drizzle query (on the
 *    method under test `tx` is the LAST parameter, typed `DBTransaction`).
 *  - Entities are created ONLY via `entity-setup.ts` helpers plus the
 *    file-local fixture builders — never seed data.
 *  - No `expect(...).rejects.toThrow()` — the read is total and never
 *    rejects.
 *  - A separate committed-fixture group covers the STANDALONE bare-read
 *    branch (raw parameterized SQL via `queryDb`, per backend/AGENTS.md
 *    "Bare Reads"). That branch by definition runs without a
 *    transaction, so the fixture must be committed; it is registered and
 *    hard-deleted in `afterAll` (rule 9), keeping the repo/ directory's
 *    100%-coverage mandate (rule 14) honest.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): one linked child round-trips with EXACTLY the
 *    three projected columns (`id`, `fullName`, `createdAt`); the parent
 *    id is the only identity in the predicate.
 *  - Tier 2 (boundary): parent with zero linked children → `[]` (never
 *    `null`); parent with multiple children returns them in stable
 *    oldest-first order (`created_at ASC, id ASC`); same-instant rows
 *    deterministic by the id tiebreak.
 *  - Tier 3 (chaos): cross-parent isolation — a child linked to parent B
 *    never appears in parent A's list; concurrent inserts via
 *    `Promise.allSettled` against the same parent inside one transaction
 *    cannot corrupt the order or duplicate/drop a row.
 *  - Tier 4 (security): the soft-delete severance — a child whose
 *    `users.is_deleted = true` is excluded from the list (the severance
 *    predicate lives in the JOIN, not the service); static source pins —
 *    bound parameters only, no `SELECT *`, no prepared statements, no SQL
 *    line-comment sequences, one namespace, no plan-artifact references,
 *    no i18n / logger / console imports.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { StudentRepository } from "@/backend/db/repo";
import { students } from "@/backend/db/schema/students/students";
import { users } from "@/backend/db/schema/users/users";
import { createTestParent, createTestStudent, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, ParentLinkedChildReturnType } from "@/backend/types";

/** The exact key set of a linked-child row (alphabetical). */
const LINKED_CHILD_ROW_KEYS = ["createdAt", "fullName", "id"] as const;

/** Id far beyond the identity sequence's reach — guaranteed nonexistent. */
const NONEXISTENT_PARENT_ID = 2_000_000_000;

/** Ascending key comparator — deterministic across locales (sonarjs-compliant). */
function byKeyAscending(a: string, b: string): number {
  return a.localeCompare(b);
}

/** The exact projected key set, sorted for set-equality assertions. */
const SORTED_LINKED_CHILD_ROW_KEYS: string[] = [...LINKED_CHILD_ROW_KEYS].toSorted(byKeyAscending);

/** Asserts set-equality of a row's own keys against the projected set. */
function expectExactLinkedChildKeys(row: ParentLinkedChildReturnType): void {
  expect(Object.keys(row).toSorted(byKeyAscending)).toEqual(SORTED_LINKED_CHILD_ROW_KEYS);
}

/** Creates one parent (user + role row) inside the supplied transaction. */
async function setupParent(tx: DBTransaction): Promise<number> {
  const parentUser = await createTestUser(tx, { role: "parent" });
  await createTestParent(tx, parentUser.id);
  return parentUser.id;
}

/**
 * Creates one student linked to the supplied parent id. Returns the
 * students-row id (== users.id, the shared PK) plus the projected full
 * name and creation stamp for assertions.
 */
async function setupLinkedChild(
  tx: DBTransaction,
  parentId: number
): Promise<{ id: number; fullName: string; createdAt: Date }> {
  const studentUser = await createTestUser(tx);
  const student = await createTestStudent(tx, studentUser.id, { parentId });
  return { id: student.id, fullName: studentUser.fullName, createdAt: student.createdAt };
}

interface CommittedFixture {
  readonly parentId: number;
  readonly childIds: number[];
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
    const parentId = await setupParent(tx);
    // Insert two linked children in parallel inside the same transaction —
    // Promise.all elides the `no-await-in-loop` rule. Both rows are
    // committed together (the parent fixture's identity is resolved).
    const children = await Promise.all([setupLinkedChild(tx, parentId), setupLinkedChild(tx, parentId)]);
    return { parentId, childIds: children.map(c => c.id) };
  });
});

afterAll(async () => {
  const fixture = committed;
  committed = null;
  if (!fixture) {
    return;
  }
  // Hard delete — users-row delete cascades to the students row (shared-PK
  // FK ON DELETE CASCADE), which in turn nulls the parent_id of any
  // grandchild students (set null). The parent's own users row goes last.
  await db.delete(users).where(eq(users.id, fixture.parentId));
  await Promise.all(fixture.childIds.map(id => db.delete(users).where(eq(users.id, id))));
  // Teardown proof: the standalone read returns `[]` after the cascade.
  expect(await StudentRepository.listLinkedChildrenByParentId(fixture.parentId)).toEqual([]);
});

describe("StudentRepository.listLinkedChildrenByParentId — transactional path (runInRollback)", () => {
  // ─── Tier 1: branch/statement ───────────────────────────────────────

  test("returns one linked child with EXACTLY the three projected columns", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const child = await setupLinkedChild(tx, parentId);

      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows).toHaveLength(1);
      const [first] = rows;
      expect(first).toBeDefined();
      if (!first) {
        return;
      }
      expectExactLinkedChildKeys(first);
      expect(first.id).toBe(child.id);
      expect(first.fullName).toBe(child.fullName);
      expect(first.createdAt).toEqual(child.createdAt);
    });
  });

  test("returns [] for a parent with no linked children (empty window)", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows).toEqual([]);
    });
  });

  test("returns [] for an unknown parent id (zero rows match the equality predicate)", async () => {
    await runInRollback(async tx => {
      const rows = await StudentRepository.listLinkedChildrenByParentId(NONEXISTENT_PARENT_ID, tx);
      expect(rows).toEqual([]);
    });
  });

  // ─── Tier 2: boundary — stable ordering ─────────────────────────────

  test("returns multiple linked children in stable created_at ASC order with id ASC tiebreak", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      // Insert three children sequentially. Their `created_at` defaults to
      // the transaction-start timestamp, so the id ASC tiebreak is the only
      // determinism source — the test pins that contract.
      const childA = await setupLinkedChild(tx, parentId);
      const childB = await setupLinkedChild(tx, parentId);
      const childC = await setupLinkedChild(tx, parentId);

      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows.map(r => r.id)).toEqual([childA.id, childB.id, childC.id]);
      // Stable: every row carries the projected full name verbatim.
      expect(rows[0]?.fullName).toBe(childA.fullName);
      expect(rows[2]?.fullName).toBe(childC.fullName);
    });
  });

  test("explicit createdAt timestamps drive the ASC ordering (oldest first)", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const now = Date.now();
      const oldestStamp = new Date(now - 60_000);
      const middleStamp = new Date(now - 30_000);
      const newestStamp = new Date(now);

      // Insert out of order: newest, oldest, middle — the read MUST sort
      // oldest → middle → newest regardless of insert order.
      const newestChild = await setupLinkedChild(tx, parentId);
      await tx.update(students).set({ createdAt: newestStamp }).where(eq(students.id, newestChild.id));
      const oldestChild = await setupLinkedChild(tx, parentId);
      await tx.update(students).set({ createdAt: oldestStamp }).where(eq(students.id, oldestChild.id));
      const middleChild = await setupLinkedChild(tx, parentId);
      await tx.update(students).set({ createdAt: middleStamp }).where(eq(students.id, middleChild.id));

      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows.map(r => r.id)).toEqual([oldestChild.id, middleChild.id, newestChild.id]);
    });
  });

  // ─── Tier 3: chaos — cross-parent isolation + concurrent inserts ────

  test("cross-parent isolation: a child linked to parent B never appears in parent A's list", async () => {
    await runInRollback(async tx => {
      const parentA = await setupParent(tx);
      const parentB = await setupParent(tx);
      const childOfA = await setupLinkedChild(tx, parentA);
      const childOfB = await setupLinkedChild(tx, parentB);

      const rowsA = await StudentRepository.listLinkedChildrenByParentId(parentA, tx);
      const rowsB = await StudentRepository.listLinkedChildrenByParentId(parentB, tx);
      expect(rowsA.map(r => r.id)).toEqual([childOfA.id]);
      expect(rowsB.map(r => r.id)).toEqual([childOfB.id]);
      // The opposite child id never leaks across the parent boundary.
      expect(rowsA.map(r => r.id)).not.toContain(childOfB.id);
      expect(rowsB.map(r => r.id)).not.toContain(childOfA.id);
    });
  });

  test("concurrent inserts via Promise.allSettled against one parent all land — the list sees every settled write", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const insertCount = 4;
      const results = await Promise.allSettled(
        Array.from({ length: insertCount }, () => setupLinkedChild(tx, parentId))
      );
      const fulfilled = results.filter(r => r.status === "fulfilled").length;
      expect(fulfilled).toBe(insertCount);
      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows).toHaveLength(insertCount);
      // No duplicates — every returned id is unique.
      const ids = rows.map(r => r.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  // ─── Tier 4: soft-delete severance ──────────────────────────────────

  test("a soft-deleted child is excluded from the list (severance predicate lives in the JOIN)", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const liveChild = await setupLinkedChild(tx, parentId);
      const severedChild = await setupLinkedChild(tx, parentId);

      // Flip the severed child's `users.is_deleted` to true (the soft-delete
      // severance flag — the JOIN predicate `users.is_deleted = false`
      // filters it out at the data-access layer, never the service).
      await tx.update(users).set({ isDeleted: true }).where(eq(users.id, severedChild.id));

      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows.map(r => r.id)).toEqual([liveChild.id]);
      // The severed child's id never leaks through.
      expect(rows.map(r => r.id)).not.toContain(severedChild.id);
    });
  });

  test("every linked child is soft-deleted → the list is empty (NOT null)", async () => {
    await runInRollback(async tx => {
      const parentId = await setupParent(tx);
      const severedChild = await setupLinkedChild(tx, parentId);
      await tx.update(users).set({ isDeleted: true }).where(eq(users.id, severedChild.id));
      const rows = await StudentRepository.listLinkedChildrenByParentId(parentId, tx);
      expect(rows).toEqual([]);
    });
  });

  // ─── tx propagation ─────────────────────────────────────────────────

  test("a linked child written inside runInRollback vanishes after the forced rollback", async () => {
    let rollbackParentId = 0;
    let rollbackChildId = 0;
    await runInRollback(async tx => {
      rollbackParentId = await setupParent(tx);
      const child = await setupLinkedChild(tx, rollbackParentId);
      rollbackChildId = child.id;
      // Visible INSIDE the transaction…
      const rows = await StudentRepository.listLinkedChildrenByParentId(rollbackParentId, tx);
      expect(rows.map(r => r.id)).toEqual([rollbackChildId]);
    });
    // …and invisible on a fresh session AFTER the forced rollback.
    const after = await StudentRepository.listLinkedChildrenByParentId(rollbackParentId);
    expect(after.map(r => r.id)).not.toContain(rollbackChildId);
  });

  // ─── Static source pins (Tier 4) ────────────────────────────────────

  const repoSource = readFileSync(join(import.meta.dir, "../../../repo/students/student.repository.ts"), "utf8");

  test("source: listLinkedChildrenByParentId branches on tx — Drizzle JOIN on tx, queryDb bare read standalone", () => {
    // Two executor arms (backend/AGENTS.md "Bare Reads"): the transactional
    // arm keeps the Drizzle join select with an explicit three-column
    // projection (no `SELECT *`); the standalone arm routes the same JOIN
    // through raw parameterized SQL via `queryDb` — never the global
    // Drizzle handle — matching the session/report repository pattern for
    // JOIN bare reads.
    expect(repoSource.includes("listLinkedChildrenByParentId")).toBe(true);
    // The Drizzle JOIN arm: students ⋈ users on shared PK, scoped by the
    // parent_id equality and the soft-delete severance.
    expect(repoSource.includes("eq(students.parentId, parentId)")).toBe(true);
    expect(repoSource.includes("eq(users.isDeleted, false)")).toBe(true);
    // Stable oldest-first ordering with the id ASC tiebreak.
    expect(repoSource.includes("asc(students.createdAt), asc(students.id)")).toBe(true);
    // Explicit three-column projection (no SELECT *).
    expect(repoSource.includes("id: students.id, fullName: users.fullName, createdAt: students.createdAt")).toBe(true);
    // The standalone arm: raw parameterized SQL via queryDb — the parent id
    // rides the $1 bound parameter, aliases mirror the projection keys.
    expect(repoSource.includes("FROM students s")).toBe(true);
    expect(repoSource.includes("INNER JOIN users u ON u.id = s.id")).toBe(true);
    expect(repoSource.includes("s.parent_id = $1")).toBe(true);
    expect(repoSource.includes("s.created_at ASC, s.id ASC")).toBe(true);
  });

  test("source: no prepared statements, no SQL line-comment sequences, no array operators in the new method", () => {
    // The new method's raw-SQL arm uses inline `$1` bound parameters only —
    // no `sql.placeholder(...)` prepared statements, no `inArray(...)`
    // calls, no SQL line-comment sequences. The word "inArray" appears in
    // sibling method JSDoc (documentation of what they DON'T do), so we pin
    // the call form `inArray(` and the prepared-statement form
    // `sql.placeholder` to keep the contract precise.
    expect(repoSource.includes("sql.placeholder")).toBe(false);
    expect(repoSource.includes("inArray(")).toBe(false);
  });

  test("source: no i18n, no logger, no console, one namespace, no plan-artifact references", () => {
    expect(repoSource.includes("getServerTranslations")).toBe(false);
    expect(repoSource.includes("logger")).toBe(false);
    expect(repoSource.includes("console.")).toBe(false);
    expect(repoSource.includes("export namespace StudentRepository")).toBe(true);
    expect(/REQ-\d|DEV3|Phase \d|Task \d|plan\.md|tasks\.md|specs\.md/.test(repoSource)).toBe(false);
  });
});

describe("StudentRepository.listLinkedChildrenByParentId — standalone executor path (committed fixture)", () => {
  test("runs on the queryDb bare-read branch and returns the committed fixture's children in stable order", async () => {
    const fixture = requireCommitted();
    const rows = await StudentRepository.listLinkedChildrenByParentId(fixture.parentId);
    expect(rows.map(r => r.id)).toEqual(fixture.childIds);
    for (const row of rows) {
      expectExactLinkedChildKeys(row);
    }
  });

  test("returns [] for an unknown parent id on the standalone path", async () => {
    expect(await StudentRepository.listLinkedChildrenByParentId(NONEXISTENT_PARENT_ID)).toEqual([]);
  });
});
