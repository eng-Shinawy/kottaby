/**
 * AdminTeacherDirectoryService tests — the `adminTeachers` directory listing
 * against the live `app_db` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to EVERY
 *    service / entity-setup call so the actor-check + the operation share
 *    the SAME rolled-back transaction.
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized-UUID emails).
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded UI copy.
 *
 * Coverage map:
 *  - Happy-path list mapping (subjects JSON parse, rating decimal → float,
 *    governance null-coalescing, page-envelope echo).
 *  - Filter normalization (search trim, literal `%` escape, boolean
 *    filters, absent-filter fallback to the unfiltered listing).
 *  - `pageCount` ceiling math (3 rows ÷ pageSize 2 → 2; empty → 0).
 *  - Subjects JSON parse fallback (corrupt payload degrades to empty list).
 *  - Pagination validation errors (page 0 / negative, pageSize 101).
 *  - `exportAll` envelope (rows + honest full filtered total + truncated
 *    flag, filter composition respected, honest empty envelope) — the
 *    truncated-TRUE honesty path is pinned against the pure
 *    `buildExportEnvelope` helper in `directory-export.helpers.test.ts`
 *    (seeding >1000 rows is impractical here).
 *  - Defense-in-depth BFLA denials (anonymous → 401, non-admin → 403) on
 *    BOTH operations.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { teacher as teacherTable } from "@/backend/db/schema/teachers/teacher";
import { users } from "@/backend/db/schema/users/users";
import { createTestTeacherRow, createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import {
  expectExportEnvelope,
  expectExportRowIds,
  expectListedItem,
  expectPageEnvelopeEcho,
  DIRECTORY_TEST_LOCALE as LOCALE,
  provisionAdminActor,
  registerBflaDenials,
  registerPaginationCountingContract,
  registerPaginationValidationContract,
} from "@/backend/services/admin/shared/directory-test.helpers";
import { AdminTeacherDirectoryService } from "@/backend/services/admin/teacher-directory.service";
import { HOSTILE_SEARCH_PAYLOADS } from "@/backend/services/shared/hostile-search-payloads";
import type { DBTransaction, UserSelectType } from "@/backend/types";

/**
 * Creates a teacher user + `teacher` role-child row with a unique full name
 * carrying the supplied prefix (for search isolation). Returns the pair.
 */
async function createDirectoryTeacher(
  tx: DBTransaction,
  options: {
    namePrefix: string;
    isApproved?: boolean;
    isEvaluator?: boolean;
    isOnline?: boolean;
    averageRating?: string | null;
    subjects?: string | null;
  }
): Promise<UserSelectType> {
  const user = await createTestUser(tx, {
    role: "teacher",
    fullName: `${options.namePrefix} ${randomUUID().slice(0, 8)}`,
  });
  await createTestTeacherRow(tx, user.id, {
    isApproved: options.isApproved ?? true,
    isEvaluator: options.isEvaluator ?? false,
    isOnline: options.isOnline ?? false,
    averageRating: options.averageRating ?? null,
    subjects: options.subjects ?? null,
  });
  return user;
}

describe("AdminTeacherDirectoryService.list — happy path + mapping", () => {
  test("admin lists the directory; certification headline + subjects JSON + rating float map correctly", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, {
        namePrefix: "DirTeacherHappy",
        isApproved: true,
        isEvaluator: true,
        isOnline: true,
        averageRating: "4.50",
        subjects: JSON.stringify(["quran", "tajweed"]),
      });

      const page = await AdminTeacherDirectoryService.list({ search: "DirTeacherHappy" }, 1, 25, LOCALE, admin.id, tx);

      expectPageEnvelopeEcho(page, { page: 1, pageSize: 25 });

      const found = expectListedItem(page, teacher.id);
      expect(found?.name).toContain("DirTeacherHappy");
      expect(found?.email).toBe(teacher.email);
      expect(found?.phone).toBe(teacher.phone);
      expect(found?.isApproved).toBe(true);
      expect(found?.isEvaluator).toBe(true);
      expect(found?.isOnline).toBe(true);
      expect(found?.averageRating).toBe(4.5);
      expect(found?.subjects).toEqual(["quran", "tajweed"]);
      expect(found?.isDeleted).toBe(false);
      expect(found?.suspended).toBe(false);
      expect(found?.isBlocked).toBe(false);
      expect(found?.createdAt).toBeInstanceOf(Date);
    });
  });

  test("unrated teacher → averageRating null; absent subjects → empty array", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, {
        namePrefix: "DirTeacherBare",
        averageRating: null,
        subjects: null,
      });

      const page = await AdminTeacherDirectoryService.list({ search: "DirTeacherBare" }, 1, 25, LOCALE, admin.id, tx);
      const found = expectListedItem(page, teacher.id);
      expect(found?.averageRating).toBeNull();
      expect(found?.subjects).toEqual([]);
    });
  });

  test("corrupt subjects payload degrades to an empty array (never a resolver error)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, {
        namePrefix: "DirTeacherCorrupt",
        subjects: "not-valid-json",
      });

      const page = await AdminTeacherDirectoryService.list(
        { search: "DirTeacherCorrupt" },
        1,
        25,
        LOCALE,
        admin.id,
        tx
      );
      const found = expectListedItem(page, teacher.id);
      expect(found?.subjects).toEqual([]);
    });
  });
});

describe("AdminTeacherDirectoryService.list — filter normalization", () => {
  test("search is trimmed before matching (leading/trailing whitespace ignored)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherTrim" });

      const page = await AdminTeacherDirectoryService.list(
        { search: "  DirTeacherTrim  " },
        1,
        25,
        LOCALE,
        admin.id,
        tx
      );
      expect(expectListedItem(page, teacher.id)).not.toBeUndefined();
    });
  });

  test("search `%` is escaped and matched literally (no wildcard widening)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createTestUser(tx, {
        role: "teacher",
        fullName: `DirTeacher%${randomUUID().slice(0, 8)}`,
      });
      await createTestTeacherRow(tx, teacher.id, { isApproved: true });

      const page = await AdminTeacherDirectoryService.list({ search: "%" }, 1, 100, LOCALE, admin.id, tx);
      const found = expectListedItem(page, teacher.id);
      expect(found?.name).toContain("%");
    });
  });

  test("absent filters fall back to the unfiltered listing (null filters dropped)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherAny" });

      const page = await AdminTeacherDirectoryService.list({}, 1, 100, LOCALE, admin.id, tx);
      expect(page.total).toBeGreaterThanOrEqual(1);
      expect(page.items.find(item => item.id === teacher.id)).not.toBeUndefined();
    });
  });

  test("approval filter partitions the directory (approved vs pending)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const approved = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherApproved", isApproved: true });
      const pending = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherPending", isApproved: false });

      const approvedPage = await AdminTeacherDirectoryService.list({ approval: true }, 1, 100, LOCALE, admin.id, tx);
      expect(approvedPage.items.find(item => item.id === approved.id)).not.toBeUndefined();
      expect(approvedPage.items.find(item => item.id === pending.id)).toBeUndefined();

      const pendingPage = await AdminTeacherDirectoryService.list({ approval: false }, 1, 100, LOCALE, admin.id, tx);
      expect(pendingPage.items.find(item => item.id === pending.id)).not.toBeUndefined();
      expect(pendingPage.items.find(item => item.id === approved.id)).toBeUndefined();
    });
  });

  test("evaluator filter matches only is_evaluator rows", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const evaluator = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherEval", isEvaluator: true });
      const plain = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherPlain", isEvaluator: false });

      const page = await AdminTeacherDirectoryService.list({ evaluator: true }, 1, 100, LOCALE, admin.id, tx);
      expect(page.items.find(item => item.id === evaluator.id)).not.toBeUndefined();
      expect(page.items.find(item => item.id === plain.id)).toBeUndefined();
    });
  });
});

describe("AdminTeacherDirectoryService.list — pagination", () => {
  registerPaginationCountingContract({
    seedThree: async (tx, prefix) => {
      await Promise.all([
        createDirectoryTeacher(tx, { namePrefix: prefix }),
        createDirectoryTeacher(tx, { namePrefix: prefix }),
        createDirectoryTeacher(tx, { namePrefix: prefix }),
      ]);
    },
    list: (tx, actorId, filters, page, pageSize) =>
      AdminTeacherDirectoryService.list(filters, page, pageSize, LOCALE, actorId, tx),
  });

  test("out-of-range page → empty items + honest total (never clamped)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const prefix = `DirTeacherRange${randomUUID().slice(0, 8)}`;
      await createDirectoryTeacher(tx, { namePrefix: prefix });

      const page = await AdminTeacherDirectoryService.list({ search: prefix }, 999, 25, LOCALE, admin.id, tx);
      expect(page.items).toEqual([]);
      expect(page.total).toBe(1);
      expect(page.page).toBe(999);
      expect(page.pageCount).toBe(1);
    });
  });

  // ── Pagination bounds reject BEFORE any DB read ────────────────────────

  registerPaginationValidationContract({
    list: (tx, actorId, page, pageSize) => AdminTeacherDirectoryService.list({}, page, pageSize, LOCALE, actorId, tx),
  });
});

describe("AdminTeacherDirectoryService.exportAll — export-all envelope", () => {
  test("admin exports the filtered directory; rows + honest full total + truncated=false", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const approved = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherExport", isApproved: true });
      const pending = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherExport", isApproved: false });

      const envelope = await AdminTeacherDirectoryService.exportAll(
        { search: "DirTeacherExport" },
        LOCALE,
        admin.id,
        tx
      );

      // The export envelope reports the FULL filtered count — exactly the
      // count the listing query would report across all pages.
      expectExportEnvelope(envelope, { total: 2, rows: 2 });
      expect(envelope.truncated).toBe(false);
      expectExportRowIds(envelope, [approved.id, pending.id]);
      const found = envelope.rows.find(row => row.id === approved.id);
      expect(found?.name).toContain("DirTeacherExport");
      expect(found?.email).toBe(approved.email);
      expect(found?.isApproved).toBe(true);
    });
  });

  test("filter composition is respected (approval filter partitions the export)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const approved = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherExportFilter", isApproved: true });
      await createDirectoryTeacher(tx, { namePrefix: "DirTeacherExportFilter", isApproved: false });

      const envelope = await AdminTeacherDirectoryService.exportAll(
        { search: "DirTeacherExportFilter", approval: true },
        LOCALE,
        admin.id,
        tx
      );
      expectExportEnvelope(envelope, { total: 1, rows: 1 });
      expect(envelope.truncated).toBe(false);
      expect(envelope.rows[0]?.id).toBe(approved.id);
    });
  });

  test("no-match search → honest empty envelope (rows [], total 0, truncated false)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const envelope = await AdminTeacherDirectoryService.exportAll(
        { search: `no-match-${randomUUID()}` },
        LOCALE,
        admin.id,
        tx
      );
      expectExportEnvelope(envelope, { total: 0, rows: 0 });
      expect(envelope.truncated).toBe(false);
    });
  });
});

describe("AdminTeacherDirectoryService.exportAll — defense-in-depth (BFLA)", () => {
  registerBflaDenials({
    call: (tx, actorId) => AdminTeacherDirectoryService.exportAll({}, LOCALE, actorId, tx),
  });
});

describe("AdminTeacherDirectoryService.list — defense-in-depth (BFLA)", () => {
  registerBflaDenials({
    call: (tx, actorId) => AdminTeacherDirectoryService.list({}, 1, 25, LOCALE, actorId, tx),
  });
});

// ─── Hostile search payload matrix (injection + wildcard) ─────────────────

/**
 * Creates a teacher user + `teacher` role-child row with the EXACT supplied
 * full name (no prefixing) — the carrier/decoy factory of the hostile
 * payload matrix below.
 */
async function createTeacherNamed(tx: DBTransaction, fullName: string): Promise<number> {
  const user = await createTestUser(tx, { role: "teacher", fullName });
  await createTestTeacherRow(tx, user.id, { isApproved: true });
  return user.id;
}

/**
 * Independent literal-substring oracle: the teacher ids (role-child rows)
 * whose full name OR email contains the needle literally, case-insensitively —
 * computed through `position()`, not LIKE, so it shares zero semantics with
 * the search path under test. This is the literal match set the directory
 * search MUST reproduce exactly.
 */
async function teacherIdsMatchingLiteral(tx: DBTransaction, needle: string): Promise<number[]> {
  const lowered = needle.toLowerCase();
  const rows = await tx
    .select({ id: users.id })
    .from(teacherTable)
    .innerJoin(users, eq(users.id, teacherTable.id))
    .where(
      sql`(position(${lowered} in lower(${users.fullName})) > 0 or position(${lowered} in lower(${users.email})) > 0)`
    );
  return rows.map(row => row.id);
}

describe("AdminTeacherDirectoryService.list — hostile search payload matrix", () => {
  test.each(HOSTILE_SEARCH_PAYLOADS)(
    "hostile search ($label): the result equals the literal-substring match set; nothing is modified",
    async ({ payload, decoys }) => {
      await runInRollback(async tx => {
        const admin = await provisionAdminActor(tx);
        const runTag = randomUUID().slice(0, 8);

        // The carrier embeds the payload VERBATIM in its full name; each
        // decoy teacher's name would surface if the payload's
        // metacharacters kept their wildcard meaning.
        const carrierId = await createTeacherNamed(tx, `${payload}${runTag}`);
        const decoyIds = await Promise.all(decoys.map(decoy => createTeacherNamed(tx, `${decoy}${runTag}`)));

        const usersBefore = await tx.$count(users);
        // The service trims the search term before escaping — the literal
        // needle is the trimmed payload.
        const needle = payload.trim().toLowerCase();
        const expected = await teacherIdsMatchingLiteral(tx, needle);

        const page = await AdminTeacherDirectoryService.list({ search: payload }, 1, 100, LOCALE, admin.id, tx);

        // Zero rows modified: the listing (and any injection the payload
        // could have smuggled past a parameterized read) wrote nothing.
        expect(await tx.$count(users)).toBe(usersBefore);

        // The result equals the literal-substring match set — never wider.
        expect(page.total).toBe(expected.length);
        const surfacedIds = page.items.map(item => item.id);
        expect(surfacedIds).toContain(carrierId);
        for (const decoyId of decoyIds) {
          expect(surfacedIds).not.toContain(decoyId);
        }
        if (expected.length <= 100) {
          expect(surfacedIds.toSorted((a, b) => a - b)).toEqual(expected.toSorted((a, b) => a - b));
        }
        // Every surfaced row carries the needle literally (in the name or
        // the email) — no non-literal row can leak into the page.
        for (const item of page.items) {
          expect(item.name.toLowerCase().includes(needle) || item.email.toLowerCase().includes(needle)).toBe(true);
        }
      });
    }
  );

  test("empty and whitespace-only search strings mean no filter (the unfiltered listing)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const teacher = await createDirectoryTeacher(tx, { namePrefix: "DirTeacherEmptySearch" });

      const emptyPage = await AdminTeacherDirectoryService.list({ search: "" }, 1, 100, LOCALE, admin.id, tx);
      expect(emptyPage.items.find(item => item.id === teacher.id)).not.toBeUndefined();

      const whitespacePage = await AdminTeacherDirectoryService.list({ search: "   " }, 1, 100, LOCALE, admin.id, tx);
      expect(whitespacePage.items.find(item => item.id === teacher.id)).not.toBeUndefined();
    });
  });

  test("a search longer than the 100-character ceiling clamps to the first 100 characters (never rejects)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const base = `DirTeacherClamp${randomUUID().slice(0, 8)}`;
      const hundred = `${base}${"x".repeat(100 - base.length)}`;
      const teacherId = await createTeacherNamed(tx, hundred);

      // Exactly at the ceiling: the full 100-character string is the search.
      const exactPage = await AdminTeacherDirectoryService.list({ search: hundred }, 1, 25, LOCALE, admin.id, tx);
      expect(exactPage.total).toBe(1);
      expect(exactPage.items.map(item => item.id)).toEqual([teacherId]);

      // 40 characters past the ceiling: the search clamps to the first
      // 100 characters, so the same teacher still matches.
      const oversize = `${hundred}${"y".repeat(40)}`;
      const clampedPage = await AdminTeacherDirectoryService.list({ search: oversize }, 1, 25, LOCALE, admin.id, tx);
      expect(clampedPage.total).toBe(1);
      expect(clampedPage.items.map(item => item.id)).toEqual([teacherId]);
    });
  });

  test("an Arabic (RTL) search matches the literal Arabic substring", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const runTag = randomUUID().slice(0, 8);
      const carrierId = await createTeacherNamed(tx, `مدرس القرآن ${runTag}`);
      const decoyId = await createTeacherNamed(tx, `مدرس التجويد ${runTag}`);

      const needle = "القرآن";
      const expected = await teacherIdsMatchingLiteral(tx, needle);
      const page = await AdminTeacherDirectoryService.list({ search: needle }, 1, 100, LOCALE, admin.id, tx);

      expect(page.total).toBe(expected.length);
      const surfacedIds = page.items.map(item => item.id);
      expect(surfacedIds).toContain(carrierId);
      expect(surfacedIds).not.toContain(decoyId);
    });
  });
});
