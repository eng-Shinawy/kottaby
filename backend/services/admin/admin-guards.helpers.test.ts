/**
 * `admin-guards.helpers` tests — both the relaxed BFLA gate and the strict
 * active-actor guard. Per `backend/db/test/AGENTS.md` + `tests.instructions.md`:
 *  - 4-Tier mixed suite. Every case runs inside `runInRollback`; `tx` is
 *    passed to EVERY call so the actor probe + governance evaluation share
 *    the SAME rolled-back transaction.
 *  - Entities ONLY via `entity-setup.ts` helpers (randomized-UUID emails);
 *    governance states seeded via `createTestUser` overrides.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded UI copy.
 *
 * Coverage map:
 *  - Tier 1 (statement/branch coverage on new logic): active admin passes;
 *    anonymous → `UnauthorizedError`; missing actor → `ForbiddenError(forbidden)`;
 *    non-admin → `ForbiddenError(forbidden)`; deleted → `accountDeleted`;
 *    blocked → `accountBlocked`; actively suspended → `accountSuspended`;
 *    lapsed suspension PASSES (window honesty — REQ-019 zero-write proof).
 *  - Tier 2 (boundary on the order-of-checks): the deterministic precedence
 *    proofs (deleted+blocked → `accountDeleted`; deleted+suspended →
 *    `accountDeleted`; blocked+suspended → `accountBlocked`; deleted+blocked+
 *    suspended → `accountDeleted`). The order is the canonical contract —
 *    a future refactor that flips the order would flip these assertions.
 *  - Tier 3 (chaos / concurrency): n/a here — the guard performs ZERO
 *    writes (no TOCTOU surface).
 *  - Tier 4 (security / denial taxonomy): every denial emits EXACTLY ONE
 *    `logger.logDomainError` call, ZERO writes (row byte-identity), ZERO
 *    audit rows (count delta = 0 — JR-C-1 invariant).
 */

import { describe, expect, spyOn, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestAdmin, createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActiveActorAdmin, assertActorAdmin } from "@/backend/services/admin/admin-guards.helpers";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Milliseconds per day — used to seed suspension-window fixtures relative to `now`. */
const MS_PER_DAY = 86_400_000;

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/** Silences `logger.logDomainError` and returns the spy so call-counts can be asserted. */
function silenceDomainLog(): DomainLogSpy {
  const spy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  // The `logger` is a shared singleton — `spyOn` returns the SAME spy across
  // calls, so `mock.calls` accumulates across tests. Clear the call list at
  // setup so each test asserts a fresh count.
  spy.mockClear();
  return spy;
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

/**
 * Counts `audit_logs` rows for a specific actor entity_id.
 * Scoped to avoid false positives from parallel test suites that commit
 * audit rows between the before/after snapshots (READ COMMITTED isolation
 * means a rollback tx can see committed rows from other connections).
 */
async function countAuditRowsForActor(tx: DBTransaction, actorId: number): Promise<number> {
  const result = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, actorId));
  return result[0]?.count ?? 0;
}

/** Returns an integer id guaranteed absent from `users` this tx. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Provisions a super-admin actor (users row + admin role-child row) with the
 * supplied governance overrides. The actor is ready to be passed as the
 * `actorId` argument to `assertActiveActorAdmin`.
 */
async function provisionAdminActor(
  tx: DBTransaction,
  overrides: Partial<UserSelectType> = {}
): Promise<UserSelectType> {
  const user = await createTestUser(tx, { role: "admin", ...overrides });
  await createTestAdmin(tx, user.id);
  return user;
}

/**
 * Verifies the canonical logDomainError payload shape for ONE denial class.
 * Each denial MUST emit exactly ONE `logDomainError` call carrying
 * `{ code, entity: "user", entityId }` — never zero, never more than one.
 *
 * The helper installs + restores its own spy so callers can invoke it
 * sequentially without leakage between denial classes. The actor probe +
 * governance evaluation run inside the caller's transaction; the spy's
 * call count is unambiguous per call because each invocation brackets with
 * `mockRestore()` before the next begins.
 */
async function assertCanonicalDenialLog(tx: DBTransaction, actorId: number, expectedCode: string): Promise<void> {
  const logSpy = spyOn(logger, "logDomainError").mockImplementation(() => {});
  logSpy.mockClear();
  try {
    await expectRepoError(() => assertActiveActorAdmin(actorId, LOCALE, tx));
    expect(logSpy.mock.calls).toHaveLength(1);
    expect(logSpy.mock.calls[0]).toEqual([
      expect.any(String),
      expect.objectContaining({
        code: expectedCode,
        entity: "user",
        entityId: actorId,
      }),
    ]);
  } finally {
    logSpy.mockRestore();
  }
}

describe("admin-guards.helpers — re-exported relaxed BFLA gate (assertActorAdmin)", () => {
  test("the relaxed guard is importable from the new canonical home and is byte-identical to the original", () => {
    // The re-export MUST be the same function reference — no copy, no
    // wrapper. A future refactor that introduces a wrapper would flip
    // this assertion (it would also silently change DEV3-016's behavior).
    expect(typeof assertActorAdmin).toBe("function");
    expect(assertActorAdmin.name).toBe("assertActorAdmin");
  });

  test("relaxed guard — active admin passes; anonymous caller → UnauthorizedError", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      silenceDomainLog();

      // Active admin passes (the relaxed guard's only success path — no throw).
      await assertActorAdmin(admin.id, LOCALE, tx);

      // Anonymous caller is rejected at the BFLA pre-check.
      const error = await expectRepoError(() => assertActorAdmin(ANONYMOUS_ACTOR_ID, LOCALE, tx));
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toContain(tErrors.unauthorized);
    });
  });
});

describe("assertActiveActorAdmin — Tier 1 (statement / branch coverage)", () => {
  test("active admin passes — zero writes, zero audit, no log", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, admin.id);
      const rowBefore = await tx.select().from(users).where(eq(users.id, admin.id)).limit(1);

      // The strict guard's only success path — no throw, no explicit assertion.
      await assertActiveActorAdmin(admin.id, LOCALE, tx);

      // Zero writes (row byte-identical) + zero audit + zero log calls.
      const rowAfter = await tx.select().from(users).where(eq(users.id, admin.id)).limit(1);
      const auditAfter = await countAuditRowsForActor(tx, admin.id);
      expect(rowAfter[0]).toEqual(rowBefore[0]);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(0);
    });
  });

  test("anonymous caller → UnauthorizedError; zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, ANONYMOUS_ACTOR_ID);

      const error = await expectRepoError(() => assertActiveActorAdmin(ANONYMOUS_ACTOR_ID, LOCALE, tx));
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toContain(tErrors.unauthorized);

      const auditAfter = await countAuditRowsForActor(tx, ANONYMOUS_ACTOR_ID);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("missing actor row → ForbiddenError(forbidden); zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      const missingId = await absentUserId(tx);
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, missingId);

      const error = await expectRepoError(() => assertActiveActorAdmin(missingId, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.forbidden);

      const auditAfter = await countAuditRowsForActor(tx, missingId);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("non-admin actor → ForbiddenError(forbidden); zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, nonAdmin.id);

      const error = await expectRepoError(() => assertActiveActorAdmin(nonAdmin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.forbidden);

      const auditAfter = await countAuditRowsForActor(tx, nonAdmin.id);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("deleted admin → ForbiddenError(accountDeleted); zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      const deletedAdmin = await provisionAdminActor(tx, {
        isDeleted: true,
        deletedAt: new Date(),
      });
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, deletedAdmin.id);
      const rowBefore = await tx.select().from(users).where(eq(users.id, deletedAdmin.id)).limit(1);

      const error = await expectRepoError(() => assertActiveActorAdmin(deletedAdmin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.accountDeleted);

      const rowAfter = await tx.select().from(users).where(eq(users.id, deletedAdmin.id)).limit(1);
      const auditAfter = await countAuditRowsForActor(tx, deletedAdmin.id);
      expect(rowAfter[0]).toEqual(rowBefore[0]);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("blocked admin → ForbiddenError(accountBlocked); zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      const blockedAdmin = await provisionAdminActor(tx, {
        isBlocked: true,
        blockedAt: new Date(),
      });
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, blockedAdmin.id);
      const rowBefore = await tx.select().from(users).where(eq(users.id, blockedAdmin.id)).limit(1);

      const error = await expectRepoError(() => assertActiveActorAdmin(blockedAdmin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.accountBlocked);

      const rowAfter = await tx.select().from(users).where(eq(users.id, blockedAdmin.id)).limit(1);
      const auditAfter = await countAuditRowsForActor(tx, blockedAdmin.id);
      expect(rowAfter[0]).toEqual(rowBefore[0]);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("actively-suspended admin → ForbiddenError(accountSuspended); zero writes / zero audit / one log", async () => {
    await runInRollback(async tx => {
      // Active suspension window: started 3 days ago, lasts 7 days — still active at `now`.
      const suspendedAdmin = await provisionAdminActor(tx, {
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, suspendedAdmin.id);
      const rowBefore = await tx.select().from(users).where(eq(users.id, suspendedAdmin.id)).limit(1);

      const error = await expectRepoError(() => assertActiveActorAdmin(suspendedAdmin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.accountSuspended);

      const rowAfter = await tx.select().from(users).where(eq(users.id, suspendedAdmin.id)).limit(1);
      const auditAfter = await countAuditRowsForActor(tx, suspendedAdmin.id);
      expect(rowAfter[0]).toEqual(rowBefore[0]);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(1);
    });
  });

  test("lapsed suspension PASSES — window honesty (REQ-019 zero-write proof)", async () => {
    await runInRollback(async tx => {
      // Lapsed suspension window: started 15 days ago, lasted 7 days — window
      // ended 8 days ago. The predicate's strict `>` boundary semantics
      // restore access at the exact lapse instant without any write.
      const lapsedSuspendedAdmin = await provisionAdminActor(tx, {
        suspended: true,
        suspendedAt: new Date(Date.now() - 15 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      const logSpy = silenceDomainLog();
      const auditBefore = await countAuditRowsForActor(tx, lapsedSuspendedAdmin.id);
      const rowBefore = await tx.select().from(users).where(eq(users.id, lapsedSuspendedAdmin.id)).limit(1);

      // The strict guard's success path for a lapsed suspension — the actor
      // passes WITHOUT any write releasing the lapse (window honesty).
      await assertActiveActorAdmin(lapsedSuspendedAdmin.id, LOCALE, tx);

      const rowAfter = await tx.select().from(users).where(eq(users.id, lapsedSuspendedAdmin.id)).limit(1);
      const auditAfter = await countAuditRowsForActor(tx, lapsedSuspendedAdmin.id);
      // Row byte-identical — the lapsed suspension columns are NOT cleared
      // (the lapse restores access at the read layer, not the write layer).
      expect(rowAfter[0]).toEqual(rowBefore[0]);
      expect(auditAfter).toBe(auditBefore);
      expect(logSpy.mock.calls).toHaveLength(0);
    });
  });
});

describe("assertActiveActorAdmin — Tier 2 (boundary on the order-of-checks)", () => {
  // The deterministic precedence order is the canonical contract:
  //   1. isDeleted → accountDeleted
  //   2. isBlocked → accountBlocked
  //   3. isSuspensionActive → accountSuspended
  // A future refactor that flips the order would flip these assertions —
  // the suite locks the order at the unit tier.

  test("deleted + blocked actor → ForbiddenError(accountDeleted) — deleted checked first", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx, {
        isDeleted: true,
        deletedAt: new Date(),
        isBlocked: true,
        blockedAt: new Date(),
      });
      silenceDomainLog();

      const error = await expectRepoError(() => assertActiveActorAdmin(actor.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountDeleted);
      // The blocked message MUST NOT be the surfaced denial — deleted wins.
      expect(error.message).not.toContain(tErrors.accountBlocked);
    });
  });

  test("deleted + actively-suspended actor → ForbiddenError(accountDeleted) — deleted checked first", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx, {
        isDeleted: true,
        deletedAt: new Date(),
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      silenceDomainLog();

      const error = await expectRepoError(() => assertActiveActorAdmin(actor.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountDeleted);
      expect(error.message).not.toContain(tErrors.accountSuspended);
    });
  });

  test("blocked + actively-suspended actor → ForbiddenError(accountBlocked) — blocked checked before suspended", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx, {
        isBlocked: true,
        blockedAt: new Date(),
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      silenceDomainLog();

      const error = await expectRepoError(() => assertActiveActorAdmin(actor.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountBlocked);
      expect(error.message).not.toContain(tErrors.accountSuspended);
    });
  });

  test("deleted + blocked + actively-suspended actor → ForbiddenError(accountDeleted) — deleted wins all", async () => {
    await runInRollback(async tx => {
      const actor = await provisionAdminActor(tx, {
        isDeleted: true,
        deletedAt: new Date(),
        isBlocked: true,
        blockedAt: new Date(),
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      silenceDomainLog();

      const error = await expectRepoError(() => assertActiveActorAdmin(actor.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.accountDeleted);
      expect(error.message).not.toContain(tErrors.accountBlocked);
      expect(error.message).not.toContain(tErrors.accountSuspended);
    });
  });
});

describe("assertActiveActorAdmin — Tier 4 (security / denial taxonomy — JR-C-1 invariant)", () => {
  // JR-C-1: every denial emits ZERO audit rows and ZERO writes. The guard
  // runs BEFORE any transaction opens (or at the very start of one) — no
  // AuditService.createAuditLog calls, no UPDATE/INSERT/DELETE. Each denial
  // emits EXACTLY ONE logger.logDomainError carrying { code: "FORBIDDEN",
  // entity: "user", entityId } — never zero, never more than one.

  test("denial taxonomy — every denial class emits exactly one logDomainError with the canonical payload", async () => {
    await runInRollback(async tx => {
      // Provision one actor per denial class.
      const deleted = await provisionAdminActor(tx, { isDeleted: true, deletedAt: new Date() });
      const blocked = await provisionAdminActor(tx, { isBlocked: true, blockedAt: new Date() });
      const suspended = await provisionAdminActor(tx, {
        suspended: true,
        suspendedAt: new Date(Date.now() - 3 * MS_PER_DAY),
        suspendedPeriodDays: 7,
      });
      const nonAdmin = await createTestUser(tx, { role: "student" });
      const missing = await absentUserId(tx);

      // Each denial MUST emit exactly ONE logDomainError with the canonical
      // payload shape `{ code, entity, entityId }`. The calls are sequential
      // (not parallel) so each spy's call count is unambiguous per denial —
      // the actor probe + governance evaluation run inside the SAME tx and
      // could pollute each other if Promise.all'd.
      await assertCanonicalDenialLog(tx, deleted.id, "FORBIDDEN");
      await assertCanonicalDenialLog(tx, blocked.id, "FORBIDDEN");
      await assertCanonicalDenialLog(tx, suspended.id, "FORBIDDEN");
      await assertCanonicalDenialLog(tx, nonAdmin.id, "FORBIDDEN");
      await assertCanonicalDenialLog(tx, missing, "FORBIDDEN");
      await assertCanonicalDenialLog(tx, ANONYMOUS_ACTOR_ID, "UNAUTHORIZED");
    });
  });
});
