/**
 * AdminUserRepository governance-axis tests — 4-Tier coverage for the three
 * new methods added alongside `setDeletedOnce`:
 *  - `setSuspendedOnce(id, target, periodDays, tx)` — guarded suspend/unsuspend
 *  - `setBlockedOnce(id, target, tx)` — guarded block/unblock
 *  - `findGovernanceState(id, tx?)` — five-column classifier probe
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY repo
 *    call, entity-setup helper, and direct Drizzle query.
 *  - Entities are created ONLY via `entity-setup.ts` helpers
 *    (`createTestUser` / `createTestAdmin`) — never seed data.
 *  - The repo methods under test signal "missing row" / "wrong state"
 *    by returning `null` (NOT by throwing) — `expectRepoError` is used
 *    only where a Drizzle-level error is expected (FK violation, etc.).
 *  - Tests are organized per the 4-Tier framework: branch/stmt coverage
 *    (Tier 1), boundary (Tier 2), chaos/concurrency + wildcard fuzz
 *    (Tier 3 — DEFERRED to 2.4.TE per the task description), security
 *    column-hygiene (Tier 4).
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): both directions of BOTH transitions happy paths
 *    (suspend / unsuspend / block / unblock); SAFE-user RETURNING carries
 *    no PII column beyond the approved select.
 *  - Tier 2 (boundary): legacy-NULL axis columns (`suspended = NULL` /
 *    `is_blocked = NULL` rows accept the ON direction); not-deleted guard
 *    rejects mutations on a soft-deleted row; zero-row outcomes
 *    disambiguated by `findGovernanceState` (missing row / deleted row /
 *    already-on row / already-off row) per axis; `periodDays` persisted
 *    only in the ON direction; `periodDays` boundary values (1, 3650,
 *    null); missing-id returns null.
 *  - Tier 3 (chaos): DEFERRED to 2.4.TE per tasks.md — concurrent
 *    `setSuspendedOnce` / `setBlockedOnce` on the same row (suspend×2,
 *    block×2, suspend⚡unsuspend, block⚡unblock) proven via `Promise.allSettled`
 *    under `isPgliteProvider()` skip guard. The repo-level single-statement
 *    guard is the same idiom as `setDeletedOnce` (whose chaos tier is
 *    already covered in `admin-user.repository.test.ts`); the chaos
 *    semantics are identical (predicate serialization, exactly one
 *    winner), so the deferred tier is a faithful re-run of the same
 *    pattern.
 *  - Tier 4 (security): static source-file scan — zero `--` inside
 *    `sql\`...\`` template literals; zero raw string-concatenated SQL;
 *    `passwordHash` structurally absent from every projection (verified
 *    by reading the source); `findGovernanceState` selects exactly five
 *    columns (no `*`, no extra fields); signatures end with the correct
 *    executor type (`tx: DBTransaction` required on writes, `tx?:
 *    DBQueryExecutor` optional on the probe read).
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { AdminUserRepository } from "@/backend/db/repo";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
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
 * Independent read-back oracle — direct Drizzle select on the same tx,
 * NOT routed through the repository method under test.
 */
async function readUserRow(tx: DBTransaction, id: number) {
  const rows = await tx.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
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

describe("AdminUserRepository governance axes — Tier 1: both directions × both transitions", () => {
  test("setSuspendedOnce (suspend=true) flips suspended to true, stamps suspendedAt, persists periodDays", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 7, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspended).toBe(true);
      expect(updated.suspendedAt).toBeInstanceOf(Date);
      expect(updated.suspendedPeriodDays).toBe(7);
      expect(updated.isDeleted).toBe(false);
      // passwordHash structurally absent from SAFE_USER_SELECT returning.
      expect("passwordHash" in updated).toBe(false);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(true);
      expect(persisted?.suspendedAt).toBeInstanceOf(Date);
      expect(persisted?.suspendedPeriodDays).toBe(7);
    });
  });

  test("setSuspendedOnce (unsuspend=false) clears all three columns to false/NULL/NULL", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        suspended: true,
        suspendedAt: new Date(),
        suspendedPeriodDays: 14,
      });

      // periodDays is IGNORED on the unsuspend direction — caller can pass
      // any value; the repo clears suspendedPeriodDays to NULL unconditionally.
      const updated = await AdminUserRepository.setSuspendedOnce(user.id, false, 14, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspended).toBe(false);
      expect(updated.suspendedAt).toBeNull();
      expect(updated.suspendedPeriodDays).toBeNull();
      expect("passwordHash" in updated).toBe(false);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(false);
      expect(persisted?.suspendedAt).toBeNull();
      expect(persisted?.suspendedPeriodDays).toBeNull();
    });
  });

  test("setBlockedOnce (block=true) flips isBlocked to true and stamps blockedAt", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isBlocked: false });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, true, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isBlocked).toBe(true);
      expect(updated.blockedAt).toBeInstanceOf(Date);
      expect(updated.isDeleted).toBe(false);
      expect("passwordHash" in updated).toBe(false);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isBlocked).toBe(true);
      expect(persisted?.blockedAt).toBeInstanceOf(Date);
    });
  });

  test("setBlockedOnce (unblock=false) clears both columns to false/NULL", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isBlocked: true,
        blockedAt: new Date(),
      });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, false, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isBlocked).toBe(false);
      expect(updated.blockedAt).toBeNull();
      expect("passwordHash" in updated).toBe(false);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isBlocked).toBe(false);
      expect(persisted?.blockedAt).toBeNull();
    });
  });
});

describe("AdminUserRepository governance axes — Tier 2: boundary (legacy-NULL, deleted guard, zero-row, periodDays)", () => {
  test("legacy-NULL `suspended` column accepts the ON direction (null-safe guard)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: null });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 7, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspended).toBe(true);
      expect(updated.suspendedPeriodDays).toBe(7);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(true);
    });
  });

  test("legacy-NULL `isBlocked` column accepts the ON direction (null-safe guard)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isBlocked: null });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, true, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.isBlocked).toBe(true);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isBlocked).toBe(true);
    });
  });

  test("setSuspendedOnce (suspend=true) on a soft-deleted row returns null — not-deleted guard rejects mutation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true, deletedAt: new Date(), suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 7, tx);
      expect(updated).toBeNull();

      // No column change — the guard rejected the mutation.
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(false);
      expect(persisted?.suspendedAt).toBeNull();
      expect(persisted?.suspendedPeriodDays).toBeNull();
      expect(persisted?.isDeleted).toBe(true);
    });
  });

  test("setSuspendedOnce (unsuspend=false) on a soft-deleted row returns null — not-deleted guard rejects mutation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isDeleted: true,
        deletedAt: new Date(),
        suspended: true,
        suspendedAt: new Date(),
        suspendedPeriodDays: 5,
      });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, false, null, tx);
      expect(updated).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(true);
      expect(persisted?.suspendedPeriodDays).toBe(5);
    });
  });

  test("setBlockedOnce (block=true) on a soft-deleted row returns null — not-deleted guard rejects mutation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true, deletedAt: new Date(), isBlocked: false });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, true, tx);
      expect(updated).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isBlocked).toBe(false);
      expect(persisted?.blockedAt).toBeNull();
      expect(persisted?.isDeleted).toBe(true);
    });
  });

  test("setBlockedOnce (unblock=false) on a soft-deleted row returns null — not-deleted guard rejects mutation", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isDeleted: true,
        deletedAt: new Date(),
        isBlocked: true,
        blockedAt: new Date(),
      });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, false, tx);
      expect(updated).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.isBlocked).toBe(true);
    });
  });

  test("setSuspendedOnce (suspend=true) on an already-suspended row returns null (already-on)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        suspended: true,
        suspendedAt: new Date(),
        suspendedPeriodDays: 5,
      });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 7, tx);
      expect(updated).toBeNull();

      // No column change — the existing periodDays (5) is preserved, not
      // overwritten by the rejected call's argument (7).
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspendedPeriodDays).toBe(5);
    });
  });

  test("setSuspendedOnce (unsuspend=false) on a not-suspended row returns null (already-off)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, false, null, tx);
      expect(updated).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspended).toBe(false);
    });
  });

  test("setBlockedOnce (block=true) on an already-blocked row returns null (already-on)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isBlocked: true,
        blockedAt: new Date(),
      });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, true, tx);
      expect(updated).toBeNull();
    });
  });

  test("setBlockedOnce (unblock=false) on a not-blocked row returns null (already-off)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isBlocked: false });

      const updated = await AdminUserRepository.setBlockedOnce(user.id, false, tx);
      expect(updated).toBeNull();
    });
  });

  test("setSuspendedOnce / setBlockedOnce on a missing-id return null (no row matches the predicate)", async () => {
    await runInRollback(async tx => {
      const missingId = await absentUserId(tx);

      const suspendedResult = await AdminUserRepository.setSuspendedOnce(missingId, true, 7, tx);
      expect(suspendedResult).toBeNull();

      const blockedResult = await AdminUserRepository.setBlockedOnce(missingId, true, tx);
      expect(blockedResult).toBeNull();
    });
  });

  test("periodDays boundary: 1 (min) is persisted on the suspend direction", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 1, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspendedPeriodDays).toBe(1);

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspendedPeriodDays).toBe(1);
    });
  });

  test("periodDays boundary: 3650 (max) is persisted on the suspend direction", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 3650, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspendedPeriodDays).toBe(3650);
    });
  });

  test("periodDays boundary: null is persisted on the suspend direction (repo accepts null — service validates 1..3650)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, null, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspendedPeriodDays).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.suspendedPeriodDays).toBeNull();
    });
  });

  test("periodDays IGNORED on the unsuspend direction — caller passes 7 but repo clears to NULL", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        suspended: true,
        suspendedAt: new Date(),
        suspendedPeriodDays: 14,
      });

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, false, 7, tx);
      expect(updated).not.toBeNull();
      if (!updated) throw new Error("expected updated row");
      expect(updated.suspendedPeriodDays).toBeNull();

      const persisted = await readUserRow(tx, user.id);
      // The persisted periodDays is NULL — NOT 7. The unsuspend direction
      // ignores the caller-supplied periodDays argument unconditionally.
      expect(persisted?.suspendedPeriodDays).toBeNull();
    });
  });
});

describe("AdminUserRepository governance axes — Tier 2: zero-row disambiguation via findGovernanceState", () => {
  test("findGovernanceState(missing-id) returns null — classifier yields USER_NOT_FOUND upstream", async () => {
    await runInRollback(async tx => {
      const missingId = await absentUserId(tx);

      const probe = await AdminUserRepository.findGovernanceState(missingId, tx);
      expect(probe).toBeNull();
    });
  });

  test("findGovernanceState(deleted row) returns { isDeleted: true, ... } — classifier yields USER_ALREADY_DELETED upstream", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { isDeleted: true, deletedAt: new Date() });

      const probe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      expect(probe.isDeleted).toBe(true);
      // Other axes are not touched by the delete transition.
      expect(probe.suspended).toBe(false);
      expect(probe.isBlocked).toBe(false);
    });
  });

  test("findGovernanceState(already-suspended row) returns { suspended: true, ... } — classifier yields USER_ALREADY_SUSPENDED upstream", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        suspended: true,
        suspendedAt: new Date(),
        suspendedPeriodDays: 7,
      });

      const probe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      expect(probe.suspended).toBe(true);
      expect(probe.suspendedAt).toBeInstanceOf(Date);
      expect(probe.suspendedPeriodDays).toBe(7);
    });
  });

  test("findGovernanceState(already-off row) returns { suspended: false, ... } — classifier yields USER_NOT_SUSPENDED upstream", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const probe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      expect(probe.suspended).toBe(false);
      expect(probe.suspendedAt).toBeNull();
      expect(probe.suspendedPeriodDays).toBeNull();
    });
  });

  test("findGovernanceState(already-blocked row) returns { isBlocked: true, ... } — classifier yields USER_ALREADY_BLOCKED upstream", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isBlocked: true,
        blockedAt: new Date(),
      });

      const probe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      expect(probe.isBlocked).toBe(true);
      // The probe deliberately omits `blockedAt` — block has no lapse
      // concept (REQ-018), so the classifier needs only the boolean flag,
      // not the timestamp. The timestamp IS persisted on the row (verified
      // by the readUserRow oracle below) but is NOT part of the probe
      // shape — keeping the probe minimal-read.
      const persisted = await readUserRow(tx, user.id);
      expect(persisted?.blockedAt).toBeInstanceOf(Date);
    });
  });

  test("findGovernanceState(legacy-NULL row) returns nullable-with-default shape (no null-coalescing)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, {
        isDeleted: null,
        suspended: null,
        isBlocked: null,
      });

      const probe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(probe).not.toBeNull();
      if (!probe) throw new Error("expected probe row");
      // The probe preserves nullable-with-default shape; the classifier
      // (suspension-window predicate) distinguishes "explicitly false"
      // from "legacy NULL state" for fail-closed behavior.
      expect(probe.isDeleted).toBeNull();
      expect(probe.suspended).toBeNull();
      expect(probe.suspendedAt).toBeNull();
      expect(probe.suspendedPeriodDays).toBeNull();
      expect(probe.isBlocked).toBeNull();
    });
  });

  test("findGovernanceState returns the SAME row shape after a guarded suspend transition (classifier snapshot)", async () => {
    await runInRollback(async tx => {
      const user = await createTestUser(tx, { suspended: false });

      const beforeProbe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(beforeProbe?.suspended).toBe(false);

      const updated = await AdminUserRepository.setSuspendedOnce(user.id, true, 7, tx);
      expect(updated).not.toBeNull();

      const afterProbe = await AdminUserRepository.findGovernanceState(user.id, tx);
      expect(afterProbe?.suspended).toBe(true);
      expect(afterProbe?.suspendedPeriodDays).toBe(7);
      // isDeleted and isBlocked are unaffected by the suspend transition.
      expect(afterProbe?.isDeleted).toBe(false);
      expect(afterProbe?.isBlocked).toBe(false);
    });
  });
});

describe("AdminUserRepository governance axes — Tier 4: security / column-hygiene", () => {
  test("static source scan: zero `--` inside any `sql\\`...\\`` template literal", () => {
    const source = readRepoSource();
    const sqlTemplatePattern = /sql<[a-zA-Z]+>`([^`]*)`/g;
    let match: RegExpExecArray | null = sqlTemplatePattern.exec(source);
    while (match !== null) {
      const templateBody = match[1] ?? "";
      expect(templateBody.includes("--")).toBe(false);
      match = sqlTemplatePattern.exec(source);
    }
  });

  test(`static source scan: zero raw string-concatenated SQL (no \${userInput} interpolation into raw SQL text)`, () => {
    const source = readRepoSource();
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
    expect(source.includes("users.passwordHash")).toBe(false);
    expect(source.includes("passwordHash:")).toBe(false);
    expect(source.includes("passwordHash,")).toBe(false);
    // The raw-SQL probe string MUST NOT include `password_hash` either —
    // the five-column probe is explicit at both code paths.
    expect(source.includes("password_hash")).toBe(false);
  });

  test("static source scan: findGovernanceState selects EXACTLY five probe columns (no *, no extra fields)", () => {
    const source = readRepoSource();
    // The Drizzle-path select shape MUST list exactly the five probe columns.
    // Allow whitespace/newline between `})` and `.from` (the source formats
    // the chain across multiple lines).
    const drizzleSelectBlockPattern = /findGovernanceState\([\s\S]*?\.select\(\{([\s\S]*?)\}\)\s*\.from\(users\)/;
    const drizzleSelectBlockMatch = drizzleSelectBlockPattern.exec(source);
    expect(drizzleSelectBlockMatch).not.toBeNull();
    const drizzleSelectBlock = drizzleSelectBlockMatch?.[1] ?? "";
    expect(drizzleSelectBlock).toContain("isDeleted: users.isDeleted");
    expect(drizzleSelectBlock).toContain("suspended: users.suspended");
    expect(drizzleSelectBlock).toContain("suspendedAt: users.suspendedAt");
    expect(drizzleSelectBlock).toContain("suspendedPeriodDays: users.suspendedPeriodDays");
    expect(drizzleSelectBlock).toContain("isBlocked: users.isBlocked");
    // No passwordHash, no email, no fullName, no phone, no role, no locale.
    expect(drizzleSelectBlock).not.toContain("passwordHash");
    expect(drizzleSelectBlock).not.toContain("email");
    expect(drizzleSelectBlock).not.toContain("fullName");
    expect(drizzleSelectBlock).not.toContain("phone");
    expect(drizzleSelectBlock).not.toContain("role");
    expect(drizzleSelectBlock).not.toContain("locale");

    // The raw-SQL probe string MUST list exactly the five probe columns
    // and MUST NOT use `SELECT *`.
    const rawSqlProbePattern = /queryDb<GovernanceProbeRowType>\(\s*`([^`]+)`/;
    const rawSqlMatch = rawSqlProbePattern.exec(source);
    expect(rawSqlMatch).not.toBeNull();
    const rawSqlBody = rawSqlMatch?.[1] ?? "";
    expect(rawSqlBody).not.toContain("*");
    expect(rawSqlBody).toContain("is_deleted");
    expect(rawSqlBody).toContain("suspended");
    expect(rawSqlBody).toContain("suspended_at");
    expect(rawSqlBody).toContain("suspended_period_days");
    expect(rawSqlBody).toContain("is_blocked");
    // No password_hash, no email, no full_name, no phone, no role, no locale.
    expect(rawSqlBody).not.toContain("password_hash");
    expect(rawSqlBody).not.toContain("email");
    expect(rawSqlBody).not.toContain("full_name");
    expect(rawSqlBody).not.toContain("phone");
  });

  test("static source scan: zero `console.*` calls", () => {
    const source = readRepoSource();
    expect(source.includes("console.")).toBe(false);
  });

  test("static source scan: zero `{ ...input }` spreads (BOPLA whitelist discipline)", () => {
    const source = readRepoSource();
    expect(source.includes("...input")).toBe(false);
  });

  test("static source scan: write methods accept `tx: DBTransaction` as REQUIRED final parameter (no `?`)", () => {
    const source = readRepoSource();
    // The two new write methods declare tx as REQUIRED (no `?`) — the
    // service layer MUST always supply a transaction; no implicit global
    // db use on writes.
    expect(/setSuspendedOnce\([\s\S]*?tx:\s*DBTransaction\s*\)/.test(source)).toBe(true);
    expect(/setBlockedOnce\([\s\S]*?tx:\s*DBTransaction\s*\)/.test(source)).toBe(true);
    // They MUST NOT declare `tx?: DBTransaction` (optional).
    expect(/setSuspendedOnce\([\s\S]*?tx\?:\s*DBTransaction\s*\)/.test(source)).toBe(false);
    expect(/setBlockedOnce\([\s\S]*?tx\?:\s*DBTransaction\s*\)/.test(source)).toBe(false);
  });

  test("static source scan: findGovernanceState accepts `tx?: DBQueryExecutor` as optional final parameter", () => {
    const source = readRepoSource();
    expect(/findGovernanceState\([\s\S]*?tx\?:\s*DBQueryExecutor\s*\)/.test(source)).toBe(true);
  });

  test("static source scan: zero `--` inside the raw-SQL probe string (no inline SQL comments)", () => {
    const source = readRepoSource();
    const rawSqlCommentPattern = /queryDb<GovernanceProbeRowType>\(\s*`([^`]+)`/;
    const rawSqlMatch = rawSqlCommentPattern.exec(source);
    expect(rawSqlMatch).not.toBeNull();
    const rawSqlBody = rawSqlMatch?.[1] ?? "";
    expect(rawSqlBody.includes("--")).toBe(false);
  });

  test("SAFE-user RETURNING carries no PII column beyond the approved select (verified against SAFE_USER_SELECT)", () => {
    const source = readRepoSource();
    // Both new write methods use `.returning(SAFE_USER_SELECT)` — the
    // shared constant from admin-user-query-helpers.ts that omits
    // passwordHash by column-pick. Verify both call sites.
    const suspendedReturningPattern = /setSuspendedOnce\([\s\S]*?\.returning\((SAFE_USER_SELECT)\)/;
    const suspendedReturningMatch = suspendedReturningPattern.exec(source);
    expect(suspendedReturningMatch?.[1]).toBe("SAFE_USER_SELECT");
    const blockedReturningPattern = /setBlockedOnce\([\s\S]*?\.returning\((SAFE_USER_SELECT)\)/;
    const blockedReturningMatch = blockedReturningPattern.exec(source);
    expect(blockedReturningMatch?.[1]).toBe("SAFE_USER_SELECT");
  });
});
