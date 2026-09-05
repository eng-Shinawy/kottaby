/**
 * Admin actor-gate helpers tests — the shared BFLA actor gate suite.
 *
 * `admin-gate.helpers.ts` is the ONE canonical admin-actor gate module:
 * `assertActorAdmin` (role gate) is consumed by `AdminUserManagementService`
 * (7 call sites), `AuditTrailService`, and `AdminBroadcastService` via the
 * same import; `assertActorAdminActive` (role gate + governance clause)
 * layers the deleted → blocked → suspended governance ordering on top of it.
 * The DEV3-016 service/chaos suites pin the gate's behavior THROUGH the
 * calling services (anonymous + non-admin denials with zero writes/audit),
 * but no existing suite pins the gate's "actor row missing" branch directly —
 * the journey fixtures deliberately avoid it (see the file-scope cast comment
 * in `test/workflows/admin/admin-user-denials.journey.test.ts`). This suite
 * pins BOTH shared helpers directly:
 *
 *  `assertActorAdmin`:
 *   - barrel surface — `@/backend/services/admin` re-exports the SAME gate
 *     function identity (no forked copy);
 *   - anonymous `actorId = 0` → `UnauthorizedError` BEFORE any repository
 *     read (pre-DB), one bounded `logDomainError`, zero writes;
 *   - unresolvable actor (row missing) → `ForbiddenError` after exactly ONE
 *     tx-scoped `UserRepository.findById` read, one bounded log, zero writes;
 *   - resolvable non-admin → `ForbiddenError` after exactly ONE read, one
 *     bounded log, zero writes;
 *   - real admin → passes with ZERO logs and zero writes;
 *   - LIVE-row semantics — the verdict is re-derived from the `users` row on
 *     EVERY call (promote/demote inside the same tx flips the verdict),
 *     proving the gate re-checks the live row rather than a cached claim.
 *
 *  `assertActorAdminActive`:
 *   - Tier 1 (role branches): clean admin → silent pass (zero domain logs);
 *     non-admin → `ForbiddenError` carrying the { code, entity, entityId }
 *     log context; missing actor → `ForbiddenError`; actor deleted between
 *     the role-gate read and the governance re-read → fail-closed
 *     `ForbiddenError` (never sails through on optional chains).
 *   - Tier 2 (governance ordering): multi-flagged admin fixtures prove the
 *     deterministic deleted → blocked → suspended precedence.
 *   - Tier 4 (BFLA / pre-DB): anonymous denial fires with ZERO
 *     `UserRepository.findById` calls; governed denials carry the `locale`
 *     in the domain-log context.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - Every DB case runs inside `runInRollback`; the caller `tx` is passed to
 *    the gate and to every entity-setup call so fixtures and reads share the
 *    SAME rolled-back transaction.
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited and appears nowhere.
 *  - Translated-message assertions resolve via `getServerTranslations`
 *    property access — never raw keys, never hardcoded UI copy.
 *  - Log spies are silences with per-test restoration (bun reuses ONE mock
 *    per object+method pair — see the tracked-spies registry below).
 *  - Zero-write oracles are identity-scoped (never table-wide counts) so they
 *    stay exact under parallel runners (AGENTS.md Rule 2 / Rule 9).
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { UserRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { DomainError, ForbiddenError, UnauthorizedError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { assertActorAdmin as barrelAssertActorAdmin } from "@/backend/services/admin";
import { assertActorAdmin, assertActorAdminActive } from "@/backend/services/admin/admin-gate.helpers";
import type { DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Returns an integer id guaranteed absent from `users` in this tx. */
async function absentUserId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Provisions an actor whose `users.role` satisfies the admin gate. */
async function provisionAdminActor(tx: DBTransaction): Promise<UserSelectType> {
  return createTestUser(tx, { role: "admin" });
}

/**
 * Zero-write oracle — identity-scoped, NOT table-wide counts.
 *
 * Global `count(*)` before/after windows race with parallel runners: the CI
 * services pool observed `users` 6 → 7 mid-window when another test file
 * committed a fixture user between the two snapshots (and per AGENTS.md
 * Rule 9 files also hard-delete committed fixture users in afterAll, so
 * downward races are equally real). Per the de-flake doctrine established
 * in ac9b7e4 (registration residual assertions), the oracle is scoped to
 * the fixture's own identity:
 *
 *  - `actorRowSnapshot` — the actor's FULL row, field-by-field: catches any
 *    UPDATE/DELETE the gate could perform on the actor row it is handed;
 *  - `actorAuditCount` — audit rows whose `entityId` is the actor's PK: ids
 *    minted inside this tx's sequence window are invisible to (uncommitted)
 *    and unreferenceable by parallel files, so the count is exact under
 *    concurrency (AGENTS.md Rule 2 unique-identity namespace).
 */
async function actorRowSnapshot(tx: DBTransaction, id: number): Promise<UserSelectType | null> {
  const [row] = await tx.select().from(users).where(eq(users.id, id));
  return row ?? null;
}

/** Audit rows attributable to one actor identity, inside the tx. */
async function actorAuditCount(tx: DBTransaction, entityId: number): Promise<number> {
  const [row] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogs)
    .where(eq(auditLogs.entityId, entityId));
  return row?.count ?? 0;
}

/** Domain log spy family share this stubbed signature. */
type DomainLogSpy = ReturnType<typeof spyOn>;

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy created anywhere in
 * this file is registered here and restored by the file-level
 * `afterEach` below.
 */
const trackedSpies: DomainLogSpy[] = [];

/** Registers a spy for automatic restoration after the current test. */
function trackSpy<T extends DomainLogSpy>(spy: T): T {
  trackedSpies.push(spy);
  return spy;
}

/** Restores every spy the finished test created (fresh mocks per test). */
afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  return trackSpy(
    spyOn(logger, "logDomainError")
      .mockClear()
      .mockImplementation(() => {})
  );
}

/** Call-through spy on the gate's single repository read seam. */
function spyActorRead(): DomainLogSpy {
  return trackSpy(spyOn(UserRepository, "findById"));
}

/** Asserts a caught error is a `DomainError` carrying the expected `code`. */
function assertErrorCode(error: Error, expectedCode: string): void {
  expect(error).toBeInstanceOf(DomainError);
  if (!(error instanceof DomainError)) throw new Error("expected a DomainError instance");
  expect(error.code).toBe(expectedCode);
}

/**
 * Registers a governance-denial case: an admin-role actor pre-flagged with
 * the supplied governance overrides must be rejected with a localized
 * `ForbiddenError` and exactly one domain log entry.
 */
function testGovernanceDenial(title: string, overrides: Partial<UserSelectType>, expectedMessage: string): void {
  test(title, async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin", ...overrides });
      const spy = silenceDomainLog();

      const error = await expectRepoError(() => assertActorAdminActive(admin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(expectedMessage);
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });
}

describe("assertActorAdmin — shared admin gate (BFLA, pre-DB)", () => {
  test("barrel surface — @/backend/services/admin re-exports the SAME gate function", () => {
    expect(barrelAssertActorAdmin).toBe(assertActorAdmin);
  });

  test("anonymous actor (id=0) → UnauthorizedError BEFORE any repository read; one bounded log; zero writes", async () => {
    await runInRollback(async tx => {
      // Rows exist — the anonymous denial must still fire pre-DB.
      const admin = await provisionAdminActor(tx);
      const logSpy = silenceDomainLog();
      const readSpy = spyActorRead();
      const rowBefore = await actorRowSnapshot(tx, admin.id);
      const auditBefore = await actorAuditCount(tx, admin.id);

      const error = await expectRepoError(() => assertActorAdmin(ANONYMOUS_ACTOR_ID, LOCALE, tx));

      expect(error).toBeInstanceOf(UnauthorizedError);
      assertErrorCode(error, "UNAUTHORIZED");
      expect(error.message).toContain(tErrors.unauthorized);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = logSpy.mock.calls[0];
      expect(message).toContain("anonymous");
      expect(ctx).toEqual({ code: "UNAUTHORIZED", entity: "user", entityId: ANONYMOUS_ACTOR_ID });

      // The anonymous branch fires before the actor lookup.
      expect(readSpy).not.toHaveBeenCalled();

      // Zero writes, identity-scoped (global counts race with parallel
      // committed-fixture churn — AGENTS.md Rule 9).
      expect(await actorRowSnapshot(tx, admin.id)).toEqual(rowBefore);
      expect(await actorAuditCount(tx, admin.id)).toBe(auditBefore);
    });
  });

  test("actor row missing (unresolvable actorId) → ForbiddenError after exactly ONE tx-scoped read; one bounded log; zero writes", async () => {
    await runInRollback(async tx => {
      const logSpy = silenceDomainLog();
      const readSpy = spyActorRead();
      const absent = await absentUserId(tx);
      const rowBefore = await actorRowSnapshot(tx, absent);
      const auditBefore = await actorAuditCount(tx, absent);

      const error = await expectRepoError(() => assertActorAdmin(absent, LOCALE, tx));

      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.forbidden);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = logSpy.mock.calls[0];
      expect(message).toContain("row missing");
      expect(ctx).toEqual({ code: "FORBIDDEN", entity: "user", entityId: absent });

      // Exactly ONE actor read, carrying the CALLER's tx (tx propagation).
      expect(readSpy).toHaveBeenCalledTimes(1);
      const [readActorId, readTx] = readSpy.mock.calls[0];
      expect(readActorId).toBe(absent);
      expect(readTx).toBe(tx);

      // Zero writes, identity-scoped (parallel-runner race — Rule 9).
      expect(await actorRowSnapshot(tx, absent)).toEqual(rowBefore);
      expect(await actorAuditCount(tx, absent)).toBe(auditBefore);
    });
  });

  test("resolvable non-admin actor → ForbiddenError after exactly ONE read; one bounded log; zero writes", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      const logSpy = silenceDomainLog();
      const readSpy = spyActorRead();
      const rowBefore = await actorRowSnapshot(tx, nonAdmin.id);
      const auditBefore = await actorAuditCount(tx, nonAdmin.id);

      const error = await expectRepoError(() => assertActorAdmin(nonAdmin.id, LOCALE, tx));

      expect(error).toBeInstanceOf(ForbiddenError);
      assertErrorCode(error, "FORBIDDEN");
      expect(error.message).toContain(tErrors.forbidden);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = logSpy.mock.calls[0];
      expect(message).toContain("not admin");
      expect(ctx).toEqual({ code: "FORBIDDEN", entity: "user", entityId: nonAdmin.id });

      expect(readSpy).toHaveBeenCalledTimes(1);

      // Zero writes, identity-scoped (parallel-runner race — Rule 9).
      expect(await actorRowSnapshot(tx, nonAdmin.id)).toEqual(rowBefore);
      expect(await actorAuditCount(tx, nonAdmin.id)).toBe(auditBefore);
    });
  });

  test("real admin actor passes — resolves; zero logs; zero writes", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const logSpy = silenceDomainLog();
      const rowBefore = await actorRowSnapshot(tx, admin.id);
      const auditBefore = await actorAuditCount(tx, admin.id);

      await assertActorAdmin(admin.id, LOCALE, tx);

      expect(logSpy).not.toHaveBeenCalled();

      // Zero writes, identity-scoped (parallel-runner race — Rule 9).
      expect(await actorRowSnapshot(tx, admin.id)).toEqual(rowBefore);
      expect(await actorAuditCount(tx, admin.id)).toBe(auditBefore);
    });
  });

  test("LIVE-row semantics — verdict re-derived from the users row on every call (no cached claim)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { role: "student" });
      silenceDomainLog();

      // Denies while the row is non-admin.
      const deniedBefore = await expectRepoError(() => assertActorAdmin(actor.id, LOCALE, tx));
      expect(deniedBefore).toBeInstanceOf(ForbiddenError);

      // Promote the SAME row inside the tx — a cached claim would keep denying.
      await tx.update(users).set({ role: "admin" }).where(eq(users.id, actor.id));
      await assertActorAdmin(actor.id, LOCALE, tx);

      // Demote again — denies again on the next call (read-through, no cache).
      await tx.update(users).set({ role: "student" }).where(eq(users.id, actor.id));
      const deniedAfter = await expectRepoError(() => assertActorAdmin(actor.id, LOCALE, tx));
      expect(deniedAfter).toBeInstanceOf(ForbiddenError);
    });
  });
});

describe("assertActorAdminActive — Tier 1: role branches", () => {
  test("clean admin actor passes silently (no throw, zero domain logs)", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin" });
      const spy = silenceDomainLog();

      await assertActorAdminActive(admin.id, LOCALE, tx);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  test("non-admin actor → ForbiddenError with exactly one FORBIDDEN domain log", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      const spy = silenceDomainLog();

      const error = await expectRepoError(() => assertActorAdminActive(nonAdmin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.forbidden);
      expect(spy).toHaveBeenCalledTimes(1);
      const context = spy.mock.calls[0][1];
      expect(context?.code).toBe("FORBIDDEN");
      expect(context?.entity).toBe("user");
      expect(context?.entityId).toBe(nonAdmin.id);
    });
  });

  test("missing actor row → ForbiddenError", async () => {
    await runInRollback(async tx => {
      const ghostId = await absentUserId(tx);
      silenceDomainLog();

      const error = await expectRepoError(() => assertActorAdminActive(ghostId, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.forbidden);
    });
  });

  test("actor deleted between the role-gate read and the governance re-read → fail-closed ForbiddenError, one bounded log", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const spy = silenceDomainLog();
      // First read (inside `assertActorAdmin`) resolves the real admin row;
      // the governance re-read resolves null — the vanished-row lane must
      // fail closed rather than sail through on optional chains.
      const readSpy = trackSpy(
        spyOn(UserRepository, "findById").mockResolvedValueOnce(admin).mockResolvedValueOnce(null)
      );

      const error = await expectRepoError(() => assertActorAdminActive(admin.id, LOCALE, tx));

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.forbidden);
      expect(readSpy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledTimes(1);
      const [message, ctx] = spy.mock.calls[0];
      expect(message).toContain("vanished");
      expect(ctx).toEqual({ code: "FORBIDDEN", entity: "user", entityId: admin.id, locale: LOCALE });
    });
  });
});

describe("assertActorAdminActive — Tier 2: governance ordering", () => {
  testGovernanceDenial(
    "deleted + blocked + suspended → deleted denial wins (first in order)",
    { isDeleted: true, isBlocked: true, suspended: true },
    tErrors.accountDeleted
  );
  testGovernanceDenial(
    "blocked + suspended → blocked denial wins over suspended",
    { isBlocked: true, suspended: true },
    tErrors.accountBlocked
  );
  testGovernanceDenial("deleted only → accountDeleted", { isDeleted: true }, tErrors.accountDeleted);
  testGovernanceDenial("blocked only → accountBlocked", { isBlocked: true }, tErrors.accountBlocked);
  testGovernanceDenial("suspended only → accountSuspended", { suspended: true }, tErrors.accountSuspended);
});

describe("assertActorAdminActive — Tier 4: BFLA pre-DB denials", () => {
  test("anonymous actor (id=0) → UnauthorizedError with ZERO repository reads", async () => {
    await runInRollback(async tx => {
      const findSpy = spyActorRead();
      silenceDomainLog();

      const error = await expectRepoError(() => assertActorAdminActive(ANONYMOUS_ACTOR_ID, LOCALE, tx));
      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toContain(tErrors.unauthorized);
      expect(findSpy).not.toHaveBeenCalled();
    });
  });

  test("governed admin denial carries the locale in the domain-log context", async () => {
    await runInRollback(async tx => {
      const admin = await createTestUser(tx, { role: "admin", suspended: true });
      const spy = silenceDomainLog();

      const error = await expectRepoError(() => assertActorAdminActive(admin.id, LOCALE, tx));
      expect(error).toBeInstanceOf(ForbiddenError);
      expect(spy).toHaveBeenCalledTimes(1);
      const context = spy.mock.calls[0][1];
      expect(context?.code).toBe("FORBIDDEN");
      expect(context?.entity).toBe("user");
      expect(context?.entityId).toBe(admin.id);
      expect(context?.locale).toBe(LOCALE);
    });
  });
});
