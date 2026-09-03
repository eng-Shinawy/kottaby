/**
 * AuditTrailService tests — the global admin audit-trail read surface
 * against the live `app_db` PostgreSQL instance.
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - Every case runs inside `runInRollback`; `tx` is passed to every
 *    service call and fixture insert so fixtures and reads share the
 *    SAME rolled-back transaction (the service joins the supplied tx as
 *    a nested block for its paired reads).
 *  - Fixture `audit_logs` rows are inserted directly via Drizzle inside
 *    the rollback transaction (the service under test is read-only).
 *  - All rejection assertions use `expectRepoError` (try/catch) —
 *    `expect(...).rejects.toThrow()` is prohibited.
 *  - Repository spies are call-through by default (they observe the
 *    service↔repository seam without changing behavior); only the
 *    corrupt-row and transaction-shape tests substitute canned returns.
 *
 * Coverage map:
 *  - Gate denials (BFLA): anonymous `actorId=0` → `UnauthorizedError`;
 *    resolvable non-admin → `ForbiddenError` — each with exactly ONE
 *    bounded domain log, ZERO repository reads beyond the actor probe,
 *    and a byte-unchanged `audit_logs` row count (zero writes).
 *  - Pre-DB filter validation (zero row contact): id-shaped filters must
 *    be positive safe integers (fractional / negative / zero / oversized
 *    all reject), `entityType` is trimmed + length-bounded, `actionType`
 *    is re-asserted against the canonical enum members, and the window
 *    bounds must be valid `Date`s with `from` strictly before `to`.
 *  - Pre-DB pagination validation: page must be a positive integer,
 *    pageSize an integer in `1..100` (defaults 1 / 25).
 *  - Happy path: raw rows map to typed entries (enum coercion, live
 *    actor-name join, verbatim null `entityId`/`details` pass-through),
 *    newest-first order, honest empty pages, out-of-range page honesty,
 *    gapless pageSize=1 tiling, and equal-input determinism.
 *  - Snapshot transaction: the paired count + listing receive the SAME
 *    transaction executor; without a caller transaction the service
 *    opens ONE top-level transaction at the `repeatable read` isolation
 *    level.
 *  - Corrupt stored enum: a raw row carrying an unknown `action_type`
 *    fails closed as a plain (masked-internal) error — never a domain
 *    error code, never an unsafe cast.
 */

import { afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { AuditTrailRepository, UserRepository } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { AuditTrailService } from "@/backend/services/admin/audit-trail.service";
import type { AdminAuditTrailFiltersSubmitInput, DBTransaction, UserSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const LOCALE = "en";
const tErrors = getServerTranslations(LOCALE).errorsTranslations;

/** Sentinel `actorId` value expressing an anonymous caller. */
const ANONYMOUS_ACTOR_ID = 0;

/** Fixed UTC timestamps spanning distinct days — deterministic order anchors. */
const T_OLD = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
const T_NEW = new Date(Date.UTC(2026, 0, 3, 12, 0, 0));

/** Entity label uniquely owned by one test's fixture rows. */
function trailLabel(): string {
  return `probe_${randomUUID().slice(0, 8)}`;
}

/**
 * Seeds one `audit_logs` fixture row inside the rollback transaction and
 * returns the stored row (with its identity id and stored columns).
 */
async function seedTrailRow(
  tx: DBTransaction,
  actorId: number,
  label: string,
  actionType: AuditActionType,
  createdAt: Date,
  entityId: number | null = null,
  details: string | null = null
) {
  const [row] = await tx
    .insert(auditLogs)
    .values({ actorId, actionType, entityType: label, entityId, details, createdAt })
    .returning();
  if (!row) {
    throw new Error("seedTrailRow: insert returned no rows");
  }
  return row;
}

/** Total `audit_logs` row count via a direct read-back (zero-write oracle). */
async function countAllAuditRows(tx: DBTransaction): Promise<number> {
  const rows = await tx.select({ count: sql<number>`count(*)::int`.as("count") }).from(auditLogs);
  return rows[0]?.count ?? 0;
}

/** Provisions an actor whose `users.role` satisfies the admin gate. */
async function provisionAdminActor(tx: DBTransaction): Promise<UserSelectType> {
  const user = await createTestUser(tx, { role: "admin" });
  return user;
}

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

/**
 * Restores every spy the finished test created (fresh mocks per test).
 * This also covers a mock INHERITED from another suite in this directory
 * when that suite left its own spy installed on the same object+method.
 */
afterEach(() => {
  while (trackedSpies.length > 0) {
    trackedSpies.pop()?.mockRestore();
  }
});

/** Silences `logger.logDomainError` so test stdout stays compact. */
function silenceDomainLog(): DomainLogSpy {
  // bun reuses ONE mock per object+method pair until it is restored — a
  // sibling suite in this directory keeps a long-lived domain-log spy
  // installed (its suite never restores it), so the mock returned by
  // `spyOn` here may be that same instance carrying its stale accumulated
  // `mock.calls`. Clearing it keeps the call-count assertions in this file
  // absolute from a zero baseline.
  return trackSpy(
    spyOn(logger, "logDomainError")
      .mockClear()
      .mockImplementation(() => {})
  );
}

/**
 * Call-through spies on both repository reads — they observe the
 * service↔repository seam (call counts, arguments, transaction identity)
 * without changing behavior.
 */
function spyTrailReads() {
  return {
    countSpy: trackSpy(spyOn(AuditTrailRepository, "countEntries")),
    listSpy: trackSpy(spyOn(AuditTrailRepository, "listEntries")),
  };
}

describe("AuditTrailService — actor gate (BFLA, pre-DB)", () => {
  test("anonymous caller (actorId=0) → UnauthorizedError; no repository read; one bounded log; zero writes", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const logSpy = silenceDomainLog();
      const reads = spyTrailReads();
      const auditBefore = await countAllAuditRows(tx);

      const error = await expectRepoError(() =>
        AuditTrailService.listAuditTrail({}, 1, 25, LOCALE, ANONYMOUS_ACTOR_ID, tx)
      );

      expect(error).toBeInstanceOf(UnauthorizedError);
      expect(error.message).toContain(tErrors.unauthorized);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = logSpy.mock.calls[0];
      expect(message).toContain("anonymous");
      expect(ctx).toEqual({ code: "UNAUTHORIZED", entity: "user", entityId: ANONYMOUS_ACTOR_ID });

      // Zero reads beyond the gate, zero writes to the trail.
      expect(reads.countSpy).not.toHaveBeenCalled();
      expect(reads.listSpy).not.toHaveBeenCalled();
      expect(await countAllAuditRows(tx)).toBe(auditBefore);
      expect(admin.id).toBeGreaterThan(0);
    });
  });

  test("resolvable non-admin actor → ForbiddenError; no repository read; one bounded log; zero writes", async () => {
    await runInRollback(async tx => {
      const nonAdmin = await createTestUser(tx, { role: "student" });
      const logSpy = silenceDomainLog();
      const reads = spyTrailReads();
      const auditBefore = await countAllAuditRows(tx);

      const error = await expectRepoError(() =>
        AuditTrailService.listAuditTrail({}, null, null, LOCALE, nonAdmin.id, tx)
      );

      expect(error).toBeInstanceOf(ForbiddenError);
      expect(error.message).toContain(tErrors.forbidden);

      expect(logSpy).toHaveBeenCalledTimes(1);
      const [message, ctx] = logSpy.mock.calls[0];
      expect(message).toContain("not admin");
      expect(ctx).toEqual({ code: "FORBIDDEN", entity: "user", entityId: nonAdmin.id });

      expect(reads.countSpy).not.toHaveBeenCalled();
      expect(reads.listSpy).not.toHaveBeenCalled();
      expect(await countAllAuditRows(tx)).toBe(auditBefore);
    });
  });
});

describe("AuditTrailService — pre-DB filter validation (zero row contact)", () => {
  test.each([
    ["fractional filter actorId", { actorId: 1.5 }],
    ["negative filter actorId", { actorId: -3 }],
    ["zero filter actorId", { actorId: 0 }],
    ["oversized filter actorId", { actorId: Number.MAX_SAFE_INTEGER + 1 }],
    ["fractional filter entityId", { entityId: 0.5 }],
    ["negative filter entityId", { entityId: -10 }],
    ["oversized filter entityId", { entityId: Number.MAX_SAFE_INTEGER + 1 }],
    ["oversized entityType (101 chars)", { entityType: "a".repeat(101) }],
    ["inverted window (from after to)", { from: T_NEW, to: T_OLD }],
    ["degenerate window (from equals to)", { from: T_OLD, to: T_OLD }],
    ["invalid from Date", { from: new Date("nope") }],
    ["invalid to Date", { to: new Date("nope") }],
  ] as ReadonlyArray<[string, AdminAuditTrailFiltersSubmitInput]>)(
    "%s → ValidationError before any read",
    async (_name, filters) => {
      await runInRollback(async tx => {
        const admin = await provisionAdminActor(tx);
        const reads = spyTrailReads();

        const error = await expectRepoError(() =>
          AuditTrailService.listAuditTrail(filters, 1, 25, LOCALE, admin.id, tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(tErrors.validation);
        // Pre-DB tier: the gate probed the actor, but the trail reads never ran.
        expect(reads.countSpy).not.toHaveBeenCalled();
        expect(reads.listSpy).not.toHaveBeenCalled();
      });
    }
  );

  test("smuggled non-enum actionType → ValidationError before any read", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const reads = spyTrailReads();

      // Transport-tamper simulation: the closed whitelist types `actionType`
      // as a canonical enum member, but a wire-level forgery carries a junk
      // literal. Constructed via Object.assign (no unsafe casts) — the
      // service's fail-closed membership re-assertion must reject it.
      const filters: AdminAuditTrailFiltersSubmitInput = { entityType: "user" };
      Object.assign(filters, { actionType: "smuggled_junk_action" });

      const error = await expectRepoError(() => AuditTrailService.listAuditTrail(filters, 1, 25, LOCALE, admin.id, tx));

      expect(error).toBeInstanceOf(ValidationError);
      expect(error.message).toContain(tErrors.validation);
      expect(reads.countSpy).not.toHaveBeenCalled();
      expect(reads.listSpy).not.toHaveBeenCalled();
    });
  });

  test("validation rejections log nothing (only the gate logs denials)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const logSpy = silenceDomainLog();

      await expectRepoError(() => AuditTrailService.listAuditTrail({ actorId: -1 }, 1, 25, LOCALE, admin.id, tx));

      expect(logSpy).not.toHaveBeenCalled();
    });
  });
});

describe("AuditTrailService — pre-DB pagination validation (zero row contact)", () => {
  test.each([
    ["page 0", 0, 25],
    ["negative page", -2, 25],
    ["fractional page", 2.5, 25],
    ["pageSize 0", 1, 0],
    ["pageSize 101", 1, 101],
    ["fractional pageSize", 1, 2.5],
    ["negative pageSize", 1, -5],
  ] as ReadonlyArray<[string, number, number]>)(
    "%s → ValidationError before any read",
    async (_name, page, pageSize) => {
      await runInRollback(async tx => {
        const admin = await provisionAdminActor(tx);
        const reads = spyTrailReads();

        const error = await expectRepoError(() =>
          AuditTrailService.listAuditTrail({}, page, pageSize, LOCALE, admin.id, tx)
        );

        expect(error).toBeInstanceOf(ValidationError);
        expect(error.message).toContain(tErrors.validation);
        expect(reads.countSpy).not.toHaveBeenCalled();
        expect(reads.listSpy).not.toHaveBeenCalled();
      });
    }
  );
});

describe("AuditTrailService — happy path (live read, filter normalization, mapping)", () => {
  test("filtered page maps raw rows to typed entries; count and list share one transaction", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      const entityId =
        (await tx.select({ maxId: sql<number>`coalesce(max(${auditLogs.entityId}), 0)::int` }).from(auditLogs))[0]
          .maxId + 10_000;
      const newer = await seedTrailRow(
        tx,
        admin.id,
        label,
        AuditActionType.Create,
        T_NEW,
        entityId,
        '{"role":"student"}'
      );
      await seedTrailRow(tx, admin.id, label, AuditActionType.Update, T_OLD, null, null);
      const logSpy = silenceDomainLog();
      const reads = spyTrailReads();

      const result = await AuditTrailService.listAuditTrail(
        { entityType: `  ${label}  ` },
        1,
        25,
        LOCALE,
        admin.id,
        tx
      );

      // Honest page envelope: the padded filter was TRIMMED and matched
      // exactly the two fixture rows, newest-first.
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(result.totalCount).toBe(2);
      expect(result.items).toHaveLength(2);

      const [first, second] = result.items;
      expect(first.id).toBe(newer.id);
      expect(first.actionType).toBe(AuditActionType.Create);
      expect(first.actorId).toBe(admin.id);
      expect(first.actorName).toBe(admin.fullName);
      expect(first.entityType).toBe(label);
      expect(first.entityId).toBe(entityId);
      expect(first.details).toBe('{"role":"student"}');
      expect(first.createdAt.toISOString()).toBe(T_NEW.toISOString());

      expect(second.id).not.toBe(newer.id);
      expect(second.actionType).toBe(AuditActionType.Update);
      expect(second.entityId).toBeNull();
      expect(second.details).toBeNull();

      // One consistent-snapshot transaction: both reads received the SAME
      // executor (a nested block joined to the caller's transaction), and
      // both received the same normalized filter object.
      expect(reads.countSpy).toHaveBeenCalledTimes(1);
      expect(reads.listSpy).toHaveBeenCalledTimes(1);
      const [countFilters, countTx] = reads.countSpy.mock.calls[0];
      const [listFilters, , , listTx] = reads.listSpy.mock.calls[0];
      expect(countTx).toBe(listTx);
      expect(countTx).not.toBe(db);
      expect(countFilters).toBe(listFilters);
      expect(countFilters.entityType).toBe(label);

      // Reads never audit and never log: the happy path is silent.
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  test("actionType filter re-assertion passes canonical members and filters exactly", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      await seedTrailRow(tx, admin.id, label, AuditActionType.Suspend, T_NEW);
      await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_OLD);

      const result = await AuditTrailService.listAuditTrail(
        { entityType: label, actionType: AuditActionType.Suspend },
        null,
        null,
        LOCALE,
        admin.id,
        tx
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].actionType).toBe(AuditActionType.Suspend);
      expect(result.totalCount).toBe(1);
    });
  });

  test("whitespace-only entityType is treated as absent (unfiltered fallback)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const reads = spyTrailReads();

      const result = await AuditTrailService.listAuditTrail({ entityType: "   " }, 1, 25, LOCALE, admin.id, tx);

      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(reads.countSpy).toHaveBeenCalledTimes(1);
      const [countFilters] = reads.countSpy.mock.calls[0];
      expect(countFilters.entityType).toBeUndefined();
      expect(countFilters.actorId).toBeUndefined();
      expect(countFilters.entityId).toBeUndefined();
      expect(countFilters.actionType).toBeUndefined();
      expect(countFilters.from).toBeUndefined();
      expect(countFilters.to).toBeUndefined();
    });
  });

  test("entityType at the 100-char ceiling is accepted; a one-sided window is honored", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const reads = spyTrailReads();

      const ceilingLabel = "x".repeat(100);
      const result = await AuditTrailService.listAuditTrail(
        { entityType: ceilingLabel, to: T_NEW },
        1,
        25,
        LOCALE,
        admin.id,
        tx
      );

      expect(result.items).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      const [countFilters] = reads.countSpy.mock.calls[0];
      expect(countFilters.entityType).toBe(ceilingLabel);
      expect(countFilters.to).toBe(T_NEW);
      expect(countFilters.from).toBeUndefined();
    });
  });

  test("honest empty result echoes resolved pagination defaults", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const reads = spyTrailReads();

      const result = await AuditTrailService.listAuditTrail(
        { entityType: trailLabel() },
        null,
        null,
        LOCALE,
        admin.id,
        tx
      );

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(25);
      expect(reads.countSpy).toHaveBeenCalledTimes(1);
      expect(reads.listSpy).toHaveBeenCalledTimes(1);
    });
  });

  test("pagination boundaries: pageSize 100 accepted with wired limit/offset arithmetic", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const reads = spyTrailReads();

      // The inclusive upper bound (100) is accepted and echoed honestly;
      // the offset derives from the resolved page window start.
      const pageThree = await AuditTrailService.listAuditTrail(
        { entityType: trailLabel() },
        3,
        100,
        LOCALE,
        admin.id,
        tx
      );

      expect(pageThree.page).toBe(3);
      expect(pageThree.pageSize).toBe(100);
      expect(pageThree.items).toEqual([]);
      expect(pageThree.totalCount).toBe(0);

      expect(reads.listSpy).toHaveBeenCalledTimes(1);
      const [listFilters, listLimit, listOffset, listTx] = reads.listSpy.mock.calls[0];
      expect(listFilters.entityType).toBeDefined();
      expect(listLimit).toBe(100);
      expect(listOffset).toBe(200);
      // The reads joined the caller's transaction as a NESTED block — the
      // executor they receive is that nested transaction, never the
      // global db handle (the outer rollback tx object itself stays with
      // the caller; see the snapshot-transaction suite for the identity
      // oracles).
      expect(listTx).toBeDefined();
      expect(listTx).not.toBe(db);
    });
  });

  test("out-of-range page returns empty items with the honest unchanged count", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_NEW);
      await seedTrailRow(tx, admin.id, label, AuditActionType.Adjust, T_OLD);

      const result = await AuditTrailService.listAuditTrail({ entityType: label }, 50, 25, LOCALE, admin.id, tx);

      expect(result.items).toEqual([]);
      expect(result.totalCount).toBe(2);
      expect(result.page).toBe(50);
      expect(result.pageSize).toBe(25);
    });
  });

  test("pageSize=1 tiles the filtered set gaplessly with an honest count", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      const first = await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_NEW);
      const second = await seedTrailRow(tx, admin.id, label, AuditActionType.Delete, T_OLD);

      const pageOne = await AuditTrailService.listAuditTrail({ entityType: label }, 1, 1, LOCALE, admin.id, tx);
      const pageTwo = await AuditTrailService.listAuditTrail({ entityType: label }, 2, 1, LOCALE, admin.id, tx);

      expect(pageOne.items).toHaveLength(1);
      expect(pageOne.items[0].id).toBe(first.id);
      expect(pageTwo.items).toHaveLength(1);
      expect(pageTwo.items[0].id).toBe(second.id);
      expect(pageOne.totalCount).toBe(2);
      expect(pageTwo.totalCount).toBe(2);
      expect(pageOne.items[0].id).not.toBe(pageTwo.items[0].id);
    });
  });

  test("equal inputs produce equal output on a stable fixture set (determinism)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_NEW, null, '{"changedFields":["role"]}');
      await seedTrailRow(tx, admin.id, label, AuditActionType.Override, T_OLD);

      const filters: AdminAuditTrailFiltersSubmitInput = { entityType: label };
      const resultOne = await AuditTrailService.listAuditTrail(filters, 1, 25, LOCALE, admin.id, tx);
      const resultTwo = await AuditTrailService.listAuditTrail(filters, 1, 25, LOCALE, admin.id, tx);

      expect(JSON.parse(JSON.stringify(resultOne))).toEqual(JSON.parse(JSON.stringify(resultTwo)));
      expect(resultOne.items).toHaveLength(2);
    });
  });
});

describe("AuditTrailService — consistent-snapshot transaction (single paired-read snapshot)", () => {
  let stubAdmin: UserSelectType;

  beforeAll(async () => {
    // A real `UserSelectType` row for the gate mock below; the row is
    // rolled back immediately — only the in-memory object survives.
    await runInRollback(async tx => {
      stubAdmin = await createTestUser(tx, { role: "admin" });
    });
  });

  test("no caller transaction → ONE top-level repeatable-read transaction carries both reads", async () => {
    const findByIdSpy = trackSpy(spyOn(UserRepository, "findById").mockResolvedValue(stubAdmin));
    const countSpy = trackSpy(spyOn(AuditTrailRepository, "countEntries").mockResolvedValue(0));
    const listSpy = trackSpy(spyOn(AuditTrailRepository, "listEntries").mockResolvedValue([]));
    const txSpy = trackSpy(spyOn(db, "transaction"));

    try {
      const result = await AuditTrailService.listAuditTrail({}, 1, 25, LOCALE, stubAdmin.id);

      expect(result).toEqual({ items: [], totalCount: 0, page: 1, pageSize: 25 });

      // Exactly ONE top-level transaction, opened at the repeatable-read
      // snapshot isolation level.
      expect(txSpy).toHaveBeenCalledTimes(1);
      const [, txConfig] = txSpy.mock.calls[0];
      expect(txConfig).toEqual({ isolationLevel: "repeatable read" });

      // Both reads ran inside that one transaction: the same executor was
      // handed to the count and the listing (and it is NOT the global db).
      expect(countSpy).toHaveBeenCalledTimes(1);
      expect(listSpy).toHaveBeenCalledTimes(1);
      const [, countTx] = countSpy.mock.calls[0];
      const [, , , listTx] = listSpy.mock.calls[0];
      expect(countTx).toBeDefined();
      expect(countTx).toBe(listTx);
      expect(countTx).not.toBe(db);

      // The gate probed the actor OUTSIDE the snapshot transaction.
      expect(findByIdSpy).toHaveBeenCalledTimes(1);
      const [probedActorId, probedTx] = findByIdSpy.mock.calls[0];
      expect(probedActorId).toBe(stubAdmin.id);
      expect(probedTx).toBeUndefined();
    } finally {
      findByIdSpy.mockRestore();
      countSpy.mockRestore();
      listSpy.mockRestore();
      txSpy.mockRestore();
    }
  });

  test("caller transaction supplied → the paired reads join it; NO new top-level transaction is opened", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_NEW);
      const reads = spyTrailReads();
      // Spied INSIDE the rollback transaction — after the rollback wrapper
      // itself opened its transaction — so the spy observes only calls
      // made during the service invocation below.
      const txSpy = trackSpy(spyOn(db, "transaction"));

      const result = await AuditTrailService.listAuditTrail({ entityType: label }, 1, 25, LOCALE, admin.id, tx);

      expect(result.items).toHaveLength(1);
      expect(result.totalCount).toBe(1);

      // The caller's transaction was joined for the reads — the service
      // opened NO fresh top-level transaction of its own.
      expect(txSpy).not.toHaveBeenCalled();

      // Both reads still received the SAME (nested) executor.
      expect(reads.countSpy).toHaveBeenCalledTimes(1);
      expect(reads.listSpy).toHaveBeenCalledTimes(1);
      const [, countTx] = reads.countSpy.mock.calls[0];
      const [, , , listTx] = reads.listSpy.mock.calls[0];
      expect(countTx).toBeDefined();
      expect(countTx).toBe(listTx);
    });
  });
});

describe("AuditTrailService — corrupt stored enum (fail-closed, masked-internal)", () => {
  test("unknown raw actionType → plain Error (never a domain code, never a cast)", async () => {
    await runInRollback(async tx => {
      const admin = await provisionAdminActor(tx);
      const label = trailLabel();
      await seedTrailRow(tx, admin.id, label, AuditActionType.Create, T_NEW);

      // A corrupt stored value cannot be inserted through the pgEnum, so
      // the raw row is substituted at the repository seam: the canned row
      // carries an `action_type` string outside the canonical member set.
      const corruptRow = {
        id: 987_654_321,
        actionType: "corrupt_enum_row",
        actorId: admin.id,
        actorName: admin.fullName,
        entityType: label,
        entityId: null,
        details: null,
        createdAt: T_NEW,
      };
      const countSpy = trackSpy(spyOn(AuditTrailRepository, "countEntries").mockResolvedValue(1));
      const listSpy = trackSpy(spyOn(AuditTrailRepository, "listEntries").mockResolvedValue([corruptRow]));

      try {
        const error = await expectRepoError(() =>
          AuditTrailService.listAuditTrail({ entityType: label }, 1, 25, LOCALE, admin.id, tx)
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(DomainError);
        expect(error.message).toContain("corrupt_enum_row");

        // The failure happens at map time — after the reads ran inside the
        // snapshot transaction (a read-only rollback is harmless).
        expect(countSpy).toHaveBeenCalledTimes(1);
        expect(listSpy).toHaveBeenCalledTimes(1);
      } finally {
        countSpy.mockRestore();
        listSpy.mockRestore();
      }
    });
  });
});
