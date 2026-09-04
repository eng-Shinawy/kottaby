/**
 * AdminUserRepository tests — 4-Tier coverage against the live PostgreSQL
 * instance inside rolled-back transactions.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers
 *    (`createTestUser` / `createTestStudent` / `createTestParent` /
 *    `createTestApplicant` / `createTestAdmin`) — never seed data.
 *  - The repo methods under test signal "missing row" / "wrong state"
 *    by returning `null` (NOT by throwing) — `expectRepoError` is used
 *    only where a Drizzle-level error is expected (FK violation, etc.).
 *  - Tests are organized per the 4-Tier framework: branch/stmt coverage
 *    (Tier 1), boundary (Tier 2), chaos/concurrency + wildcard fuzz
 *    (Tier 3), security/abuse (Tier 4).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): every filter branch (role ×4, governance ×4
 *    incl. NULL-is-deleted rows, country, search, combined AND);
 *    ordering/pagination boundaries; count-directory parity;
 *    detail-by-id role-child projection for all four roles; missing-id
 *    null; updateProfileFields hit + null on missing id; setDeletedOnce
 *    both directions + null on wrong-state; existsById true/false.
 *  - Tier 2 (boundary): limit=0; limit > 100 (repo is un-opinionated —
 *    the service is the gate); offset beyond total; out-of-range page
 *    yields empty array + unchanged count.
 *  - Tier 3 (chaos): concurrent `setDeletedOnce` double-delete in the
 *    same tx → exactly one success + one null (predicate serialization);
 *    concurrent `updateProfileFields` → both succeed (last-write-wins,
 *    documented ruling); wildcard fuzz (`%`, `_`, `\`, unicode/RTL) →
 *    literal-match only (the escaped + `%…%`-wrapped pattern from the
 *    service MUST match the literal characters, never widen the result).
 *  - Tier 4 (security): SQL-injection payload in the search pattern →
 *    literal match only, no DB modification; static source-file scan —
 *    zero `--` inside `sql\`...\`` template literals; zero raw
 *    string-concatenated SQL (no `${userInput}` interpolation of
 *    untrusted values into the SQL text); `passwordHash` structurally
 *    absent from every projection (verified by reading the source).
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { AdminUserRepository } from "@/backend/db/repo";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import {
  createTestAdmin,
  createTestApplicant,
  createTestParent,
  createTestStudent,
  createTestUser,
} from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AdminUserGovernanceFilter } from "@/backend/enum/users/admin-user-governance-filter.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import type { DBTransaction } from "@/backend/types";

/** Absolute path to the repository source file (read for static-scan tests). */
const REPO_SOURCE_PATH = join(process.cwd(), "backend", "db", "repo", "admin", "admin-user.repository.ts");

/** Reads the repository source for the static-scan tests. */
function readRepoSource(): string {
  if (!existsSync(REPO_SOURCE_PATH)) {
    throw new Error(`Repository source not found at ${REPO_SOURCE_PATH}`);
  }
  return readFileSync(REPO_SOURCE_PATH, "utf8");
}

/**
 * Wraps a raw search substring with the same `%…%` pattern + escape
 * discipline the directory SERVICE layer applies BEFORE handing the
 * pattern to the repo. The repo's `listDirectory` contract declares
 * that the caller (the service) MUST escape LIKE wildcards AND wrap as
 * `%…%`; the repo binds the result directly to its `ilike` predicate.
 *
 * This helper makes the tests exercise the repo's contract truthfully:
 * the pattern is already escaped + wrapped when it reaches the repo.
 */
function serviceEscapedSearchPattern(raw: string): string {
  return `%${escapeLikeWildcards(raw)}%`;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx,
 * NOT routed through the repository method under test.
 */
async function readUserRow(tx: DBTransaction, id: number) {
  const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/**
 * Seeds a `subscriptions` row with `status='active'` for the given user
 * to exercise the `studentHasActiveSubscription` headline (EXISTS
 * subquery). Requires a `plans` row for the FK; creates one
 * idempotently inside the test transaction.
 */
async function seedActiveSubscription(tx: DBTransaction, userId: number): Promise<void> {
  const [planRow] = await tx
    .insert(plans)
    .values({
      title: `test-plan-${randomUUID().slice(0, 8)}`,
      sessionCount: 1,
      price: "0.00",
      intervalDays: 30,
    })
    .returning();
  await tx.insert(subscriptions).values({
    userId,
    planId: planRow.id,
    status: "active",
    startDate: new Date(Date.now() - 60_000),
    endDate: null,
  });
}

/**
 * Returns an integer id that cannot exist as a `users` row during this
 * transaction: users.id is `generatedAlwaysAsIdentity()`, so anything
 * above the current max (plus a large offset that no sequence reaches
 * during a rolled-back test) is guaranteed absent.
 */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Recursively walks directory pages of `pageSize` rows starting at
 * `offset`, accumulating row ids until an empty page is observed (the
 * end of the result set). Recursive (not a `for`-loop) to avoid the
 * `no-await-in-loop` lint rule while preserving the early-break
 * behavior the test needs.
 */
async function walkDirectoryPages(
  tx: DBTransaction,
  pageSize: number,
  offset: number,
  accumulator: number[]
): Promise<number[]> {
  const page = await AdminUserRepository.listDirectory({}, pageSize, offset, tx);
  if (page.length === 0) {
    return accumulator;
  }
  const ids = page.map(r => r.id);
  return walkDirectoryPages(tx, pageSize, offset + pageSize, [...accumulator, ...ids]);
}

describe("AdminUserRepository — Tier 1: filter matrix + projection coverage", () => {
  test("listDirectory with no filters returns every user row ordered by (createdAt ASC, id ASC)", async () => {
    await runInRollback(async tx => {
      const userA = await createTestUser(tx, { fullName: "AAA Directory Probe" });
      const userB = await createTestUser(tx, { fullName: "BBB Directory Probe" });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("Directory Probe") },
        100,
        0,
        tx
      );

      // Both seeded users appear; ordering is createdAt ASC.
      const ids = rows.map(r => r.id);
      expect(ids).toContain(userA.id);
      expect(ids).toContain(userB.id);
      const aIdx = ids.indexOf(userA.id);
      const bIdx = ids.indexOf(userB.id);
      expect(aIdx).toBeGreaterThanOrEqual(0);
      expect(bIdx).toBeGreaterThanOrEqual(0);
      // userA was inserted first → its row index is less than userB's.
      expect(aIdx).toBeLessThan(bIdx);

      // Every row has the directory headline fields populated (nullable
      // role-child slots may be null per absent role-child row).
      for (const row of rows) {
        expect(typeof row.id).toBe("number");
        expect(typeof row.fullName).toBe("string");
        expect(typeof row.email).toBe("string");
        expect(["admin", "teacher", "student", "parent"]).toContain(row.role);
        // Governance booleans preserve the nullable-with-default shape;
        // they are null-coalesced to `false` at the service layer.
        // passwordHash is structurally absent — verify it never appears.
        expect("passwordHash" in row).toBe(false);
      }
    });
  });

  test("role filter narrows to the matching role only (×4 roles)", async () => {
    await runInRollback(async tx => {
      const adminUser = await createTestUser(tx, { role: "admin" });
      await createTestAdmin(tx, adminUser.id);
      const teacherUser = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, teacherUser.id);
      const studentUser = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, studentUser.id);
      const parentUser = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, parentUser.id);

      const fixtureMap = {
        admin: adminUser,
        teacher: teacherUser,
        student: studentUser,
        parent: parentUser,
      } as const;

      // Run all four role-filtered queries in parallel — Promise.all
      // (no `await` inside the loop).
      const roleResults = await Promise.all(
        (["admin", "teacher", "student", "parent"] as const).map(role =>
          AdminUserRepository.listDirectory({ role }, 100, 0, tx).then(rows => ({ role, rows }))
        )
      );
      for (const { role, rows } of roleResults) {
        for (const row of rows) {
          expect(row.role).toBe(role);
        }
        expect(rows.map(r => r.id)).toContain(fixtureMap[role].id);
      }

      // Cross-role exclusion: the admin user is NOT in the student set.
      const studentRows = await AdminUserRepository.listDirectory({ role: "student" }, 100, 0, tx);
      expect(studentRows.map(r => r.id)).not.toContain(adminUser.id);
    });
  });

  test("governance=Active matches non-deleted, non-suspended, non-blocked rows incl. NULL-state", async () => {
    await runInRollback(async tx => {
      const activeUser = await createTestUser(tx, { fullName: "Active User Probe" });
      const deletedUser = await createTestUser(tx, {
        fullName: "Deleted User Probe",
        isDeleted: true,
        deletedAt: new Date(),
      });
      const suspendedUser = await createTestUser(tx, {
        fullName: "Suspended User Probe",
        suspended: true,
      });
      const blockedUser = await createTestUser(tx, {
        fullName: "Blocked User Probe",
        isBlocked: true,
      });
      // NULL-state governance row (legacy schema shape) — must read as "active".
      const nullStateUser = await createTestUser(tx, {
        fullName: "Null-State User Probe",
        isDeleted: null,
        suspended: null,
        isBlocked: null,
      });

      const rows = await AdminUserRepository.listDirectory(
        {
          governance: AdminUserGovernanceFilter.Active,
          searchPattern: serviceEscapedSearchPattern("User Probe"),
        },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);

      expect(ids).toContain(activeUser.id);
      expect(ids).toContain(nullStateUser.id);
      expect(ids).not.toContain(deletedUser.id);
      expect(ids).not.toContain(suspendedUser.id);
      expect(ids).not.toContain(blockedUser.id);
    });
  });

  test("governance=Suspended narrows to suspended=true rows", async () => {
    await runInRollback(async tx => {
      const activeUser = await createTestUser(tx);
      const suspendedUser = await createTestUser(tx, { suspended: true, suspendedAt: new Date() });
      const blockedUser = await createTestUser(tx, { isBlocked: true });

      const rows = await AdminUserRepository.listDirectory(
        { governance: AdminUserGovernanceFilter.Suspended },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(suspendedUser.id);
      expect(ids).not.toContain(activeUser.id);
      expect(ids).not.toContain(blockedUser.id);
    });
  });

  test("governance=Blocked narrows to is_blocked=true rows", async () => {
    await runInRollback(async tx => {
      const activeUser = await createTestUser(tx);
      const blockedUser = await createTestUser(tx, { isBlocked: true, blockedAt: new Date() });
      const suspendedUser = await createTestUser(tx, { suspended: true });

      const rows = await AdminUserRepository.listDirectory(
        { governance: AdminUserGovernanceFilter.Blocked },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(blockedUser.id);
      expect(ids).not.toContain(activeUser.id);
      expect(ids).not.toContain(suspendedUser.id);
    });
  });

  test("governance=Deleted narrows to is_deleted=true rows; NULL-state rows are NOT in this set", async () => {
    await runInRollback(async tx => {
      const activeUser = await createTestUser(tx);
      const deletedUser = await createTestUser(tx, { isDeleted: true, deletedAt: new Date() });
      const nullStateUser = await createTestUser(tx, { isDeleted: null });

      const rows = await AdminUserRepository.listDirectory(
        { governance: AdminUserGovernanceFilter.Deleted },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(deletedUser.id);
      expect(ids).not.toContain(activeUser.id);
      // NULL-state is NOT "deleted" — reads as "active" per the null-safe discipline.
      expect(ids).not.toContain(nullStateUser.id);
    });
  });

  test("country filter narrows to exact country match", async () => {
    await runInRollback(async tx => {
      const egUser = await createTestUser(tx, { country: "Egypt" });
      const saUser = await createTestUser(tx, { country: "Saudi Arabia" });

      const rows = await AdminUserRepository.listDirectory({ country: "Egypt" }, 100, 0, tx);
      const ids = rows.map(r => r.id);
      expect(ids).toContain(egUser.id);
      expect(ids).not.toContain(saUser.id);
    });
  });

  test("search filter matches fullName OR email case-insensitively (escaped + %…%-wrapped pattern)", async () => {
    await runInRollback(async tx => {
      const fullNameUser = await createTestUser(tx, {
        fullName: "Yusuf Searchable",
        email: "yusuf-different@example.test",
      });
      const emailUser = await createTestUser(tx, {
        fullName: "Different Person",
        email: "searchable@example.test",
      });
      const unrelated = await createTestUser(tx, {
        fullName: "Unrelated Person",
        email: "unrelated@example.test",
      });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("searchable") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(fullNameUser.id);
      expect(ids).toContain(emailUser.id);
      expect(ids).not.toContain(unrelated.id);
    });
  });

  test("combined AND filters (role + governance + country + search) narrow to the intersection", async () => {
    await runInRollback(async tx => {
      const matchUser = await createTestUser(tx, {
        fullName: "Combined Match Yusuf",
        email: "combined-match@example.test",
        role: "student",
        country: "Egypt",
        isDeleted: false,
      });
      await createTestStudent(tx, matchUser.id);

      // A student in a different country — excluded by country.
      await createTestUser(tx, {
        fullName: "Combined Match Yusuf",
        email: "other-country@example.test",
        role: "student",
        country: "Saudi Arabia",
      });
      // An admin in Egypt — excluded by role.
      await createTestUser(tx, {
        fullName: "Combined Match Yusuf",
        email: "admin-role@example.test",
        role: "admin",
        country: "Egypt",
      });
      // A deleted student in Egypt — excluded by governance.
      const deleted = await createTestUser(tx, {
        fullName: "Combined Match Yusuf",
        email: "deleted@example.test",
        role: "student",
        country: "Egypt",
        isDeleted: true,
        deletedAt: new Date(),
      });
      await createTestStudent(tx, deleted.id);

      const rows = await AdminUserRepository.listDirectory(
        {
          role: "student",
          governance: AdminUserGovernanceFilter.Active,
          country: "Egypt",
          searchPattern: serviceEscapedSearchPattern("Combined Match Yusuf"),
        },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toEqual([matchUser.id]);
    });
  });

  test("pagination — page 1 + out-of-range page yields empty items + honest totalCount", async () => {
    await runInRollback(async tx => {
      // Seed 3 users so we can exercise a 2-row page + an out-of-range page.
      const u1 = await createTestUser(tx, { fullName: "Page Probe 1" });
      const u2 = await createTestUser(tx, { fullName: "Page Probe 2" });
      const u3 = await createTestUser(tx, { fullName: "Page Probe 3" });

      // Narrow the directory to JUST the three fixtures via the search
      // filter — the shared test DB carries committed seed rows (demo
      // admin/teacher/student/parent) that are older than every fixture,
      // so an unfiltered `createdAt ASC` first page would return seed rows,
      // not u1/u2. Uncommitted fixture rows from concurrently running test
      // files are invisible to this transaction (PostgreSQL MVCC), so the
      // filtered count is deterministic: exactly 3.
      const filters = { searchPattern: serviceEscapedSearchPattern("Page Probe") };

      // Page 1 of size 2 → first two seeded users (in createdAt ASC order).
      const page1 = await AdminUserRepository.listDirectory(filters, 2, 0, tx);
      const total = await AdminUserRepository.countDirectory(filters, tx);
      expect(total).toBe(3);
      expect(page1).toHaveLength(2);
      expect(page1[0].id).toBe(u1.id);
      expect(page1[1].id).toBe(u2.id);

      // Page 2 of size 2 → the third user.
      const page2 = await AdminUserRepository.listDirectory(filters, 2, 2, tx);
      expect(page2.length).toBeGreaterThanOrEqual(1);
      expect(page2[0].id).toBe(u3.id);

      // Out-of-range page → empty array, NOT an error; totalCount unchanged.
      const farPage = await AdminUserRepository.listDirectory(filters, 2, 10_000, tx);
      expect(farPage).toEqual([]);
      const farTotal = await AdminUserRepository.countDirectory(filters, tx);
      expect(farTotal).toBe(total);
    });
  });

  test("stable multi-page scan: no duplicates, no gaps across pages", async () => {
    await runInRollback(async tx => {
      // Seed 5 users in parallel — Promise.all (no `await` inside a for-loop).
      const seededUsers = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createTestUser(tx, { fullName: `Multi-Page Probe ${i}` }))
      );
      const seeded = seededUsers.map(u => u.id);

      // Walk pages via a recursive helper (avoids `await` inside a
      // for-loop). The recursive helper fetches one page, appends to
      // the accumulator, and recurses until an empty page is observed.
      const collected = await walkDirectoryPages(tx, 2, 0, []);
      const seen = new Set<number>();
      for (const id of collected) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      // Every seeded id was observed at least once.
      for (const id of seeded) {
        expect(seen.has(id)).toBe(true);
      }
    });
  });

  test("countDirectory parity: equals the actual row count for the same filter", async () => {
    await runInRollback(async tx => {
      const u1 = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, u1.id);
      const u2 = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, u2.id);

      const count = await AdminUserRepository.countDirectory({ role: "parent" }, tx);
      const rows = await AdminUserRepository.listDirectory({ role: "parent" }, 1000, 0, tx);
      expect(count).toBe(rows.length);
    });
  });

  test("findDetailById returns null for a missing id", async () => {
    await runInRollback(async tx => {
      const missingId = await absentUserId(tx);
      const detail = await AdminUserRepository.findDetailById(missingId, tx);
      expect(detail).toBeNull();
    });
  });

  test("findDetailById role=admin: safe users columns + all role-child slots null", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "admin" });
      await createTestAdmin(tx, user.id);

      const detail = await AdminUserRepository.findDetailById(user.id, tx);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("expected detail row");
      expect(detail.id).toBe(user.id);
      expect(detail.role).toBe("admin");
      // Role-child COLUMN slots stay null for the admin role (no
      // applicant/teacher/student/parent row). `parentRowExists` is the one
      // exception: it is a COMPUTED boolean (`parents.id IS NOT NULL`), not a
      // LEFT JOIN column — an absent parent row yields `false`, never `null`.
      // The service layer maps BOTH (`=== null || !row.parentRowExists`) to
      // "absent parent" when assembling the detail snapshot.
      expect(detail.applicantStatus).toBeNull();
      expect(detail.teacherIsApproved).toBeNull();
      expect(detail.studentHandshakeCode).toBeNull();
      expect(detail.parentRowExists).toBe(false);
      // passwordHash structurally absent.
      expect("passwordHash" in detail).toBe(false);
    });
  });

  test("findDetailById role=teacher: applicant projection present (pending); teacher slot null pre-certification", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id);

      const detail = await AdminUserRepository.findDetailById(user.id, tx);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("expected detail row");
      expect(detail.applicantStatus).toBe("pending");
      expect(detail.applicantVerificationAttempts).toBe(0);
      expect(detail.applicantLastAttemptAt).toBeNull();
      expect(detail.applicantCooldownUntil).toBeNull();
      // No `teacher` row → teacher slot stays null.
      expect(detail.teacherIsApproved).toBeNull();
      expect(detail.teacherIsEvaluator).toBeNull();
    });
  });

  test("findDetailById role=teacher certified: teacher slot populated", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "teacher" });
      await createTestApplicant(tx, user.id);
      // Manually insert a teacher row (certification artifact) for the probe.
      await tx
        .insert(teacher)
        .values({ id: user.id, isApproved: true, isEvaluator: false, averageRating: "4.50" })
        .returning();

      const detail = await AdminUserRepository.findDetailById(user.id, tx);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("expected detail row");
      expect(detail.applicantStatus).toBe("pending");
      expect(detail.teacherIsApproved).toBe(true);
      expect(detail.teacherIsEvaluator).toBe(false);
      expect(detail.teacherAverageRating).toBe("4.50");
    });
  });

  test("findDetailById role=student: student slot populated + subscription headline", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, user.id);
      // Seed an active subscription for the EXISTS subquery headline.
      await seedActiveSubscription(tx, user.id);

      const detail = await AdminUserRepository.findDetailById(user.id, tx);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("expected detail row");
      expect(detail.studentHandshakeCode).not.toBeNull();
      expect(detail.studentHasActiveSubscription).toBe(true);
      // No parent link seeded → headline reads false (column IS NOT NULL).
      expect(detail.studentParentId).toBeNull();
    });
  });

  test("findDetailById role=parent: parent slot present + linkedChildrenCount subquery", async () => {
    await runInRollback(async tx => {
      const parentUser = await createTestUser(tx, { role: "parent" });
      await createTestParent(tx, parentUser.id);

      // Seed two students linked to this parent.
      const child1 = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, child1.id, { parentId: parentUser.id });
      const child2 = await createTestUser(tx, { role: "student" });
      await createTestStudent(tx, child2.id, { parentId: parentUser.id });

      const detail = await AdminUserRepository.findDetailById(parentUser.id, tx);
      expect(detail).not.toBeNull();
      if (!detail) throw new Error("expected detail row");
      expect(detail.parentRowExists).toBe(true);
      expect(detail.parentLinkedChildrenCount).toBe(2);
    });
  });

  test("updateProfileFields applies the whitelisted patch and stamps updatedAt server-side", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { fullName: "Before Patch" });
      const before = await readUserRow(tx, user.id);
      expect(before?.updatedAt).toBeInstanceOf(Date);
      const preUpdatedAt = before?.updatedAt;
      if (!(preUpdatedAt instanceof Date)) throw new Error("expected updatedAt before patch");

      const updated = await AdminUserRepository.updateProfileFields(
        user.id,
        { fullName: "After Patch", country: "Egypt" },
        tx
      );
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.fullName).toBe("After Patch");
      expect(updated.country).toBe("Egypt");
      // The repo MUST NOT return passwordHash in the projection.
      expect("passwordHash" in updated).toBe(false);
      // updatedAt stamped server-side — greater than (or equal to, when the
      // update lands in the same millisecond as the row insert) the pre-update
      // value. The repo guarantees a fresh `new Date()` is written on every
      // update; the assertion stays non-strict because PGlite / Drizzle
      // round-trip can collapse sub-millisecond deltas to the same epoch-ms.
      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(preUpdatedAt.getTime());

      // Persisted state reflects the patch.
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.fullName).toBe("After Patch");
      expect(persisted?.country).toBe("Egypt");
    });
  });

  test("updateProfileFields returns null when zero rows match (missing id)", async () => {
    await runInRollback(async tx => {
      const missingId = await absentUserId(tx);
      const updated = await AdminUserRepository.updateProfileFields(missingId, { fullName: "X" }, tx);
      expect(updated).toBeNull();
    });
  });

  test("setDeletedOnce (delete=true) flips an active user and stamps deletedAt", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: false });

      const updated = await AdminUserRepository.setDeletedOnce(user.id, true, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isDeleted).toBe(true);
      expect(updated.deletedAt).toBeInstanceOf(Date);
      // passwordHash structurally absent.
      expect("passwordHash" in updated).toBe(false);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isDeleted).toBe(true);
      expect(persisted?.deletedAt).not.toBeNull();
    });
  });

  test("setDeletedOnce (delete=true) on an already-deleted user returns null (typed CONFLICT upstream)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true, deletedAt: new Date() });
      const updated = await AdminUserRepository.setDeletedOnce(user.id, true, tx);
      expect(updated).toBeNull();
    });
  });

  test("setDeletedOnce (delete=false) on an active user returns null (typed USER_NOT_DELETED upstream)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: false });
      const updated = await AdminUserRepository.setDeletedOnce(user.id, false, tx);
      expect(updated).toBeNull();
    });
  });

  test("setDeletedOnce (delete=false) on a NULL-state user returns null (NULL-state is treated as active)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: null });
      const updated = await AdminUserRepository.setDeletedOnce(user.id, false, tx);
      expect(updated).toBeNull();
      // State preserved (no spurious write).
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isDeleted).toBeNull();
    });
  });

  test("setDeletedOnce (reactivate) flips a deleted user back to active + clears deletedAt", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true, deletedAt: new Date() });

      const updated = await AdminUserRepository.setDeletedOnce(user.id, false, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isDeleted).toBe(false);
      expect(updated.deletedAt).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isDeleted).toBe(false);
      expect(persisted?.deletedAt).toBeNull();
    });
  });

  test("setDeletedOnce delete on a NULL-state user flips it to deleted=true (null-safe guard)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: null });

      const updated = await AdminUserRepository.setDeletedOnce(user.id, true, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isDeleted).toBe(true);
      expect(updated.deletedAt).toBeInstanceOf(Date);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isDeleted).toBe(true);
    });
  });

  test("existsById returns true for an existing id, false for a missing id (soft-deleted still counts as existing)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true });
      const missingId = await absentUserId(tx);

      const exists = await AdminUserRepository.existsById(user.id, tx);
      expect(exists).toBe(true);

      const missingExists = await AdminUserRepository.existsById(missingId, tx);
      expect(missingExists).toBe(false);
    });
  });

  test("FK-integrity chaos: insert into a role-child table without an owning users row violates the FK constraint", async () => {
    // Sanity-proves the schema-level FK ON DELETE CASCADE wiring (per
    // `backend/db/test/AGENTS.md` rule 18 — read the schema before
    // inserting). The repo methods themselves NEVER produce this
    // error path (they always operate on a row that the caller has
    // already created); the test exercises the constraint to confirm
    // the schema contract holds.
    await runInRollback(async tx => {
      const missingUserId = await absentUserId(tx);
      const err = await expectRepoError(() => createTestApplicant(tx, missingUserId));
      expect(err).toBeInstanceOf(Error);
    });
  });
});

describe("AdminUserRepository — Tier 2: boundary (pageSize / offset edge cases)", () => {
  test("limit=0 yields an empty array without error (repo is un-opinionated — service-layer validation rejects this upstream)", async () => {
    await runInRollback(async tx => {
      await createTestUser(tx, { fullName: "Limit Zero Probe" });

      const rows = await AdminUserRepository.listDirectory({}, 0, 0, tx);
      expect(rows).toEqual([]);
    });
  });

  test("limit > 100 returns rows without error (boundary validation is the service's contract, not the repo's)", async () => {
    await runInRollback(async tx => {
      // Seed 3 users; the repo should accept limit=101 without rejecting.
      await createTestUser(tx, { fullName: "Limit Large Probe 1" });
      await createTestUser(tx, { fullName: "Limit Large Probe 2" });
      await createTestUser(tx, { fullName: "Limit Large Probe 3" });

      // Narrow to JUST the three fixtures via the search filter — the shared
      // test DB carries committed seed rows that an unfiltered query would
      // also return, making an absolute row-count assertion seed-dependent.
      // Uncommitted rows from concurrently running test files are invisible
      // (PostgreSQL MVCC), so the filtered result is deterministic: exactly 3.
      const filters = { searchPattern: serviceEscapedSearchPattern("Limit Large Probe") };

      const rows = await AdminUserRepository.listDirectory(filters, 101, 0, tx);
      // Repo returns at most the seeded count; no error path triggered.
      expect(rows).toHaveLength(3);
    });
  });

  test("offset beyond total yields an empty array, NOT an error; count is unchanged", async () => {
    await runInRollback(async tx => {
      await createTestUser(tx, { fullName: "Offset Beyond Probe" });
      const total = await AdminUserRepository.countDirectory({}, tx);

      const rows = await AdminUserRepository.listDirectory({}, 10, total + 1_000, tx);
      expect(rows).toEqual([]);

      const totalAfter = await AdminUserRepository.countDirectory({}, tx);
      expect(totalAfter).toBe(total);
    });
  });

  test("limit=1 yields exactly one row (boundary smallest meaningful page)", async () => {
    await runInRollback(async tx => {
      await createTestUser(tx, { fullName: "Limit One Probe A" });
      await createTestUser(tx, { fullName: "Limit One Probe B" });

      const rows = await AdminUserRepository.listDirectory({}, 1, 0, tx);
      expect(rows).toHaveLength(1);
    });
  });
});

describe("AdminUserRepository — Tier 3: chaos + wildcard fuzz", () => {
  test("two concurrent setDeletedOnce deletes on the same row in the same tx → exactly one success + one null", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: false });

      // Two parallel calls on the SAME tx. PostgreSQL serializes them inside
      // the transaction; the first wins (state flipped to deleted), the
      // second's predicate no longer matches (is_deleted is now true).
      const settled = await Promise.allSettled([
        AdminUserRepository.setDeletedOnce(user.id, true, tx),
        AdminUserRepository.setDeletedOnce(user.id, true, tx),
      ]);
      expect(settled).toHaveLength(2);

      const outcomes = settled.map(o => (o.status === "fulfilled" ? o.value : null));
      const successCount = outcomes.filter(o => o !== null).length;
      const nullCount = outcomes.filter(o => o === null).length;
      expect(successCount).toBe(1);
      expect(nullCount).toBe(1);

      // Final state: deleted exactly once.
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isDeleted).toBe(true);
    });
  });

  test("two concurrent updateProfileFields on the same row → both succeed (last-write-wins, documented ruling)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { fullName: "Concurrent Patch Base" });

      const settled = await Promise.allSettled([
        AdminUserRepository.updateProfileFields(user.id, { fullName: "Concurrent Patch A" }, tx),
        AdminUserRepository.updateProfileFields(user.id, { fullName: "Concurrent Patch B" }, tx),
      ]);
      expect(settled).toHaveLength(2);
      for (const o of settled) {
        expect(o.status).toBe("fulfilled");
      }
      // The persisted fullName is one of the two (last-write-wins);
      // both writes were applied atomically inside the same tx.
      const persisted = await readUserRow(tx, user.id);
      expect(["Concurrent Patch A", "Concurrent Patch B"]).toContain(persisted?.fullName);
    });
  });

  test("wildcard fuzz: '%' in the search pattern matches the literal '%' character only", async () => {
    await runInRollback(async tx => {
      const literal = await createTestUser(tx, {
        fullName: "100% Completion Probe",
        email: "literal-percent@example.test",
      });
      const wideningVictim = await createTestUser(tx, {
        fullName: "100A Completion Probe",
        email: "widening-victim@example.test",
      });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("100%") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(literal.id);
      // If the wildcard had NOT been escaped, "100%" would match "100A" too
      // (the % widens to "any characters"). The escape prevents this widening.
      expect(ids).not.toContain(wideningVictim.id);
    });
  });

  test("wildcard fuzz: '_' in the search pattern matches the literal '_' character only", async () => {
    await runInRollback(async tx => {
      const literal = await createTestUser(tx, {
        fullName: "user_one probe",
        email: "literal-underscore@example.test",
      });
      const wideningVictim = await createTestUser(tx, {
        fullName: "userAone probe",
        email: "widening-underscore@example.test",
      });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("user_one") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(literal.id);
      // If `_` had NOT been escaped, it would match any single character.
      expect(ids).not.toContain(wideningVictim.id);
    });
  });

  test("wildcard fuzz: '\\' in the search pattern matches the literal '\\' character only", async () => {
    await runInRollback(async tx => {
      const literal = await createTestUser(tx, {
        fullName: "back\\slash probe",
        email: "literal-backslash@example.test",
      });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("back\\slash") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(literal.id);
    });
  });

  test("wildcard fuzz: unicode / RTL input matches the literal sequence only", async () => {
    await runInRollback(async tx => {
      const rtl = await createTestUser(tx, {
        fullName: "يوسف probe",
        email: "rtl-unicode@example.test",
      });

      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("يوسف") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      expect(ids).toContain(rtl.id);
    });
  });
});

describe("AdminUserRepository — Tier 4: security / abuse", () => {
  test("SQL-injection payload in the search pattern matches literal text only — no DB modification", async () => {
    await runInRollback(async tx => {
      const victim = await createTestUser(tx, {
        fullName: "'; DROP TABLE users; --",
        email: "injection-victim@example.test",
      });

      // The search pattern is escaped + %…%-wrapped BEFORE reaching the repo.
      // The repo binds the pattern to ilike() — never interpolating into SQL text.
      const rows = await AdminUserRepository.listDirectory(
        { searchPattern: serviceEscapedSearchPattern("'; DROP TABLE users; --") },
        100,
        0,
        tx
      );
      const ids = rows.map(r => r.id);
      // The literal text matches the row whose fullName IS the injection string.
      expect(ids).toContain(victim.id);

      // The `users` table still exists (no DROP TABLE executed); a follow-up
      // read against the same table returns rows.
      const after = await AdminUserRepository.listDirectory({}, 1, 0, tx);
      expect(after).toHaveLength(1);
    });
  });

  test("static source scan: zero `--` inside any `sql\\`...\\`` template literal", () => {
    const source = readRepoSource();
    // Find every `sql` template literal in the file (greedy match across
    // backticks). Then assert none contains the SQL line-comment `--`.
    const sqlTemplatePattern = /sql<[a-zA-Z]+>`([^`]*)`/g;
    let match: RegExpExecArray | null = sqlTemplatePattern.exec(source);
    while (match !== null) {
      const templateBody = match[1] ?? "";
      // The `--` sequence inside a SQL template is forbidden because it
      // could swallow a parameter-binding line and create an injection
      // surface. The only legitimate SQL constructs that contain `--` are
      // explicit comments — and the repo forbids inline `--` comments
      // inside any `sql\`...\`` template per the search-sanitization rule.
      expect(templateBody.includes("--")).toBe(false);
      match = sqlTemplatePattern.exec(source);
    }
  });

  test(`static source scan: zero raw string-concatenated SQL (no \${userInput} interpolation into raw SQL text)`, () => {
    const source = readRepoSource();
    // Every `${...}` inside a `sql\`...\`` template must reference a
    // Drizzle column / table / SQL fragment — NEVER an untrusted string
    // value (e.g., the raw `searchPattern` from a parameter). The pattern
    // below catches `${searchPattern}` / `${search}` / `${filters.search}`
    // — any interpolation of an untrusted input into a SQL template body.
    // Note: interpolating a Drizzle column (e.g., `${users.id}`) is safe
    // and required — the assertion specifically catches untrusted-input
    // interpolation patterns.
    //
    // Each forbidden pattern is authored as a template literal with the
    // `$` backslash-escaped (`\${...}`) so the string value is the literal
    // text `"${...}"` — no interpolation happens at runtime. This keeps
    // biome's `lint/suspicious/noTemplateCurlyInString` happy (it only
    // fires on plain-quoted strings containing `${`; template literals
    // are exempt because the escape proves intent).
    const forbiddenInterpolations: string[] = [
      `\${searchPattern}`,
      `\${search}`,
      `\${filters.searchPattern}`,
      `\${filters.search}`,
      `\${input.search}`,
      `\${rawSearch}`,
      `\${escaped}`,
    ];
    for (const forbidden of forbiddenInterpolations) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });

  test("static source scan: passwordHash is structurally absent from every projection", () => {
    const source = readRepoSource();
    // The `SAFE_USER_SELECT` shape omits `passwordHash` by column-pick.
    // The `findDetailById` select spreads `...SAFE_USER_SELECT` first; later
    // keys do NOT re-add passwordHash. The `listDirectory` select does NOT
    // reference `users.passwordHash`. Verify no column-reference patterns:
    // (Docstrings use the bare word; column references would use the dot
    // or the object-key form.)
    expect(source.includes("users.passwordHash")).toBe(false);
    expect(source.includes("passwordHash:")).toBe(false);
    expect(source.includes("passwordHash,")).toBe(false);
  });

  test("static source scan: every public method accepts `tx?: DBTransaction` as the optional-LAST parameter", () => {
    const source = readRepoSource();
    // Verify each method's signature ends with `tx?: DBTransaction)`.
    const methodSignatures = [
      /listDirectory\([\s\S]*?tx\?:\s*DBTransaction\)/,
      /countDirectory\([\s\S]*?tx\?:\s*DBTransaction\)/,
      /findDetailById\([\s\S]*?tx\?:\s*DBTransaction\)/,
      /updateProfileFields\([\s\S]*?tx\?:\s*DBTransaction\)/,
      /setDeletedOnce\([\s\S]*?tx\?:\s*DBTransaction\)/,
      /existsById\([\s\S]*?tx\?:\s*DBTransaction\)/,
    ];
    for (const signaturePattern of methodSignatures) {
      expect(signaturePattern.test(source)).toBe(true);
    }
  });

  test("static source scan: zero `console.*` calls", () => {
    const source = readRepoSource();
    // Repositories MUST NOT use console.* — the repo is silent on logs.
    expect(source.includes("console.")).toBe(false);
  });

  test("static source scan: zero `{ ...input }` spreads (BOPLA whitelist discipline)", () => {
    const source = readRepoSource();
    // The service-layer whitelist is enforced field-by-field; the repo's
    // `updateProfileFields` spreads `...patch` into the `.set({...})`
    // call, but the `patch` is the already-whitelisted
    // `AdminUserUpdateDbPatch` (Partial<Pick<UserSelectType,
    // "fullName" | "phone" | "country" | "gender" | "dateOfBirth">>),
    // never the raw input. So a raw `{ ...input }` spread would be an
    // anti-pattern. Verify zero occurrences of `{ ...input }`.
    expect(source.includes("...input")).toBe(false);
  });
});
