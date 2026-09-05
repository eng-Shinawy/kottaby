/**
 * AuditTrailRepository tests — read-path coverage against the live
 * PostgreSQL instance inside rolled-back transactions.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every test runs inside `runInRollback`; `tx` is passed to EVERY
 *    repository call, fixture insert, and direct Drizzle query.
 *  - Fixture rows are inserted directly via Drizzle inside the rollback
 *    transaction (the repository under test is read-only by design, so
 *    the fixtures exercise the same table the repository reads).
 *  - Isolation: pre-existing audit rows are never assumed absent — every
 *    assertion is anchored to fixture rows identified by a fresh actor
 *    id, a fresh entity id, or a unique `entityType` label, so committed
 *    data can never flip a result.
 *  - No `expect(...).rejects.toThrow()` — the single error-path probe
 *    uses the `expectRepoError` try/catch helper as the LAST operation
 *    of its own rollback transaction (an aborted transaction cannot run
 *    further statements).
 *
 * Coverage map:
 *  - Filter matrix: each dimension alone (actorId, actionType,
 *    entityType, entityId) plus the full combined chain.
 *  - Time window: half-open boundary semantics — `createdAt >= from`
 *    (boundary included) and `createdAt < to` (boundary excluded).
 *  - Ordering: `createdAt DESC` with the `id DESC` tiebreak for rows
 *    sharing a timestamp.
 *  - Pagination: page windows tile the filtered set with no gaps and no
 *    overlap; an out-of-range offset yields empty items with the honest,
 *    unchanged count; an empty filtered set is honest (`[]` + `0`).
 *  - Projection: the `users` inner join resolves `actorName` from the
 *    actor's live `fullName`; nullable `entityId` / `details` pass
 *    through verbatim; the raw `actionType` string is carried unmapped.
 *  - Zero-write oracle: `audit_logs` row counts are unchanged after a
 *    full list/count sweep (the repository is structurally read-only).
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { type AuditTrailEntryRow, AuditTrailRepository, type NormalizedAuditTrailFilters } from "@/backend/db/repo";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { users } from "@/backend/db/schema/users/users";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { constraintNameOf, expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { DBTransaction } from "@/backend/types";

/** Fixed UTC timestamps spanning distinct days — deterministic window/order anchors. */
const T_OLD = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
const T_MID = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
const T_NEW = new Date(Date.UTC(2026, 0, 3, 12, 0, 0));

/** Uniquely identifies fixture rows by `entityType` — immune to pre-existing data. */
function uniqueEntityType(): string {
  return `probe_${randomUUID().slice(0, 8)}`;
}

/** Spec for one fixture audit row (every column the repository projects). */
interface AuditFixtureSpec {
  readonly actionType: AuditActionType;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
}

/**
 * Inserts one `audit_logs` fixture row directly via Drizzle inside the
 * rollback transaction and returns the stored row (with its identity id).
 */
async function insertAuditRow(tx: DBTransaction, actorId: number, spec: AuditFixtureSpec) {
  const [row] = await tx
    .insert(auditLogs)
    .values({
      actorId,
      actionType: spec.actionType,
      entityType: spec.entityType,
      entityId: spec.entityId,
      details: spec.details,
      createdAt: spec.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertAuditRow: insert returned no rows");
  }
  return row;
}

/**
 * Returns an integer id that cannot exist as a `users` row during this
 * transaction: `users.id` is `generatedAlwaysAsIdentity()`, so anything
 * above the current max (plus an offset no sequence reaches during a
 * rolled-back test) is guaranteed absent.
 */
async function absentActorId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${users.id}), 0)::int` }).from(users);
  return (row?.maxId ?? 0) + 1_000_000;
}

/**
 * Returns an integer that no committed `audit_logs.entity_id` currently
 * holds and no concurrent insert can reach during the test — an exact
 * anchor for the entityId filter dimension.
 */
async function freshEntityId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${auditLogs.entityId}), 0)::int` }).from(auditLogs);
  return (row?.maxId ?? 0) + 10_000;
}

/** Total `audit_logs` row count via a direct query (independent read-back oracle). */
async function countAllAuditRows(tx: DBTransaction): Promise<number> {
  const rows = await tx.select({ count: sql<number>`count(*)::int`.as("count") }).from(auditLogs);
  return rows[0]?.count ?? 0;
}

/** Extracts the id list from rows for order/overlap assertions. */
function idsOf(rows: readonly AuditTrailEntryRow[]): number[] {
  return rows.map(row => row.id);
}

/**
 * Recursively walks `listEntries` pages of `pageSize` rows starting at
 * `offset`, accumulating rows until an empty page is observed (end of
 * the filtered set). Recursive (not a `for`-loop) to avoid the
 * `no-await-in-loop` lint rule while preserving the walk behavior.
 */
async function collectAllPages(
  tx: DBTransaction,
  filters: NormalizedAuditTrailFilters,
  pageSize: number,
  offset: number,
  accumulator: AuditTrailEntryRow[]
): Promise<AuditTrailEntryRow[]> {
  const page = await AuditTrailRepository.listEntries(filters, pageSize, offset, tx);
  if (page.length === 0) {
    return accumulator;
  }
  return collectAllPages(tx, filters, pageSize, offset + pageSize, [...accumulator, ...page]);
}

describe("AuditTrailRepository — single-dimension filters", () => {
  test("actorId filter alone narrows to the actor's own rows (exact list + count parity)", async () => {
    await runInRollback(async tx => {
      const actorA = await createTestUser(tx);
      const actorB = await createTestUser(tx);
      const rowA = await insertAuditRow(tx, actorA.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 11,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actorB.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 12,
        details: null,
        createdAt: T_MID,
      });

      const filters = { actorId: actorA.id };
      const rows = await AuditTrailRepository.listEntries(filters, 50, 0, tx);
      expect(idsOf(rows)).toEqual([rowA.id]);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(1);
    });
  });

  test("actionType filter alone matches only that action type (inclusion + exclusion)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const sharedLabel = uniqueEntityType();
      const updateRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: sharedLabel,
        entityId: 21,
        details: null,
        createdAt: T_MID,
      });
      const createRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: sharedLabel,
        entityId: 22,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Delete,
        entityType: sharedLabel,
        entityId: 23,
        details: null,
        createdAt: T_MID,
      });

      const filters = { actionType: AuditActionType.Update };
      const rows = await AuditTrailRepository.listEntries(filters, 1000, 0, tx);
      // Every returned row satisfies the filter, the matching fixture row
      // is included, and the non-matching fixture rows are excluded —
      // regardless of any pre-existing committed rows.
      for (const row of rows) {
        expect(row.actionType).toBe(AuditActionType.Update);
      }
      expect(idsOf(rows)).toContain(updateRow.id);
      expect(idsOf(rows)).not.toContain(createRow.id);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBeGreaterThanOrEqual(1);
    });
  });

  test("entityType filter alone narrows to the matching entity type (exact count)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const rowA = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: 31,
        details: null,
        createdAt: T_MID,
      });
      const rowB = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: 32,
        details: null,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: uniqueEntityType(),
        entityId: 33,
        details: null,
        createdAt: T_MID,
      });

      const filters = { entityType: label };
      const rows = await AuditTrailRepository.listEntries(filters, 50, 0, tx);
      // Newest-first: the T_MID row precedes the T_OLD row.
      expect(idsOf(rows)).toEqual([rowA.id, rowB.id]);
      for (const row of rows) {
        expect(row.entityType).toBe(label);
      }
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(2);
    });
  });

  test("entityId filter alone narrows to the matching entity rows (exact count)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const anchorId = await freshEntityId(tx);
      const rowA = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Override,
        entityType: uniqueEntityType(),
        entityId: anchorId,
        details: null,
        createdAt: T_MID,
      });
      const rowB = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: uniqueEntityType(),
        entityId: anchorId,
        details: null,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: anchorId + 1,
        details: null,
        createdAt: T_MID,
      });

      const filters = { entityId: anchorId };
      const rows = await AuditTrailRepository.listEntries(filters, 50, 0, tx);
      expect(idsOf(rows)).toEqual([rowA.id, rowB.id]);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(2);
    });
  });
});

describe("AuditTrailRepository — half-open time-window boundaries", () => {
  test("from boundary: a row exactly at `from` is included (createdAt >= from), older rows excluded", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const olderRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 41,
        details: null,
        createdAt: T_OLD,
      });
      const boundaryRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 42,
        details: null,
        createdAt: T_MID,
      });

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id, from: T_MID }, 50, 0, tx);
      expect(idsOf(rows)).toEqual([boundaryRow.id]);
      expect(idsOf(rows)).not.toContain(olderRow.id);
      expect(await AuditTrailRepository.countEntries({ actorId: actor.id, from: T_MID }, tx)).toBe(1);

      // A window starting after the newest fixture row selects nothing.
      const past = await AuditTrailRepository.listEntries({ actorId: actor.id, from: T_NEW }, 50, 0, tx);
      expect(past).toEqual([]);
    });
  });

  test("to boundary: a row exactly at `to` is excluded (createdAt < to), older rows included", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const boundaryRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 51,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 52,
        details: null,
        createdAt: T_NEW,
      });

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id, to: T_NEW }, 50, 0, tx);
      expect(idsOf(rows)).toEqual([boundaryRow.id]);
      expect(await AuditTrailRepository.countEntries({ actorId: actor.id, to: T_NEW }, tx)).toBe(1);
    });
  });
});

describe("AuditTrailRepository — combined filter chain", () => {
  test("all dimensions together resolve exactly the one conjunctively-matching row", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const otherActor = await createTestUser(tx);
      const anchorId = await freshEntityId(tx);
      const label = uniqueEntityType();
      const matchRow = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId,
        details: '{"note":"match"}',
        createdAt: T_MID,
      });
      // Near-misses that each break exactly one conjunct.
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: anchorId,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: uniqueEntityType(),
        entityId: anchorId,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId + 1,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId,
        details: null,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId,
        details: null,
        createdAt: T_NEW,
      });
      await insertAuditRow(tx, otherActor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId,
        details: null,
        createdAt: T_MID,
      });

      const filters = {
        actorId: actor.id,
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: anchorId,
        from: T_MID,
        to: T_NEW,
      };
      const rows = await AuditTrailRepository.listEntries(filters, 50, 0, tx);
      expect(idsOf(rows)).toEqual([matchRow.id]);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(1);
    });
  });
});

describe("AuditTrailRepository — ordering", () => {
  test("createdAt DESC newest-first, with id DESC as the tiebreak for equal timestamps", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const oldest = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 61,
        details: null,
        createdAt: T_OLD,
      });
      const tiedFirst = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 62,
        details: null,
        createdAt: T_NEW,
      });
      const tiedSecond = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Delete,
        entityType: uniqueEntityType(),
        entityId: 63,
        details: null,
        createdAt: T_NEW,
      });
      // Identity ids ascend with insert order, so the later tied insert
      // carries the higher id and must surface FIRST.
      expect(tiedSecond.id).toBeGreaterThan(tiedFirst.id);

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id }, 50, 0, tx);
      expect(idsOf(rows)).toEqual([tiedSecond.id, tiedFirst.id, oldest.id]);
      for (let i = 1; i < rows.length; i += 1) {
        const previous = rows[i - 1]?.createdAt.getTime() ?? 0;
        const current = rows[i]?.createdAt.getTime() ?? 0;
        expect(previous).toBeGreaterThanOrEqual(current);
      }
    });
  });
});

describe("AuditTrailRepository — pagination", () => {
  test("page windows tile the filtered set with no gaps and no overlap", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const first = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 71,
        details: null,
        createdAt: T_OLD,
      });
      const second = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 72,
        details: null,
        createdAt: T_OLD,
      });
      const third = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Delete,
        entityType: uniqueEntityType(),
        entityId: 73,
        details: null,
        createdAt: T_MID,
      });
      const fourth = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Override,
        entityType: uniqueEntityType(),
        entityId: 74,
        details: null,
        createdAt: T_MID,
      });
      const fifth = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: uniqueEntityType(),
        entityId: 75,
        details: null,
        createdAt: T_NEW,
      });
      const expectedOrder = [fifth.id, fourth.id, third.id, second.id, first.id];

      const filters = { actorId: actor.id };
      const pageOne = await AuditTrailRepository.listEntries(filters, 2, 0, tx);
      const pageTwo = await AuditTrailRepository.listEntries(filters, 2, 2, tx);
      const pageThree = await AuditTrailRepository.listEntries(filters, 2, 4, tx);
      const pageFour = await AuditTrailRepository.listEntries(filters, 2, 6, tx);

      expect(idsOf(pageOne)).toEqual([fifth.id, fourth.id]);
      expect(idsOf(pageTwo)).toEqual([third.id, second.id]);
      expect(idsOf(pageThree)).toEqual([first.id]);
      expect(pageFour).toEqual([]);

      const walked = await collectAllPages(tx, filters, 2, 0, []);
      expect(idsOf(walked)).toEqual(expectedOrder);
      expect(new Set(idsOf(walked)).size).toBe(expectedOrder.length);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(5);
    });
  });

  test("an out-of-range page yields empty items with the honest, unchanged count", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 81,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: uniqueEntityType(),
        entityId: 82,
        details: null,
        createdAt: T_MID,
      });

      const filters = { actorId: actor.id };
      const rows = await AuditTrailRepository.listEntries(filters, 2, 50, tx);
      expect(rows).toEqual([]);
      expect(await AuditTrailRepository.countEntries(filters, tx)).toBe(2);
    });
  });

  test("an empty filtered set is honest: empty items and a zero count", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id }, 25, 0, tx);
      expect(rows).toEqual([]);
      expect(await AuditTrailRepository.countEntries({ actorId: actor.id }, tx)).toBe(0);
    });
  });
});

describe("AuditTrailRepository — projection integrity", () => {
  test("the users inner join projects the actor's live fullName on every row", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx, { fullName: "Amina Audit Probe" });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 91,
        details: '{"role":"student"}',
        createdAt: T_MID,
      });

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id }, 10, 0, tx);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.actorName).toBe("Amina Audit Probe");
      expect(row?.actorId).toBe(actor.id);
      // The raw stored action type is carried unmapped (string, not the
      // TS enum class) — coercion is the service layer's concern.
      expect(row?.actionType).toBe(AuditActionType.Create);
      expect(typeof row?.actionType).toBe("string");
    });
  });

  test("null entityId and null details pass through verbatim", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: uniqueEntityType(),
        entityId: null,
        details: null,
        createdAt: T_MID,
      });

      const rows = await AuditTrailRepository.listEntries({ actorId: actor.id }, 10, 0, tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.entityId).toBeNull();
      expect(rows[0]?.details).toBeNull();
    });
  });

  test("audit_logs row counts are unchanged after a full list/count sweep (zero-write oracle)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: uniqueEntityType(),
        entityId: 101,
        details: null,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Reactivate,
        entityType: uniqueEntityType(),
        entityId: null,
        details: null,
        createdAt: T_OLD,
      });

      const before = await countAllAuditRows(tx);
      await AuditTrailRepository.listEntries({}, 1000, 0, tx);
      await AuditTrailRepository.listEntries({ actorId: actor.id }, 1000, 0, tx);
      await AuditTrailRepository.countEntries({}, tx);
      await AuditTrailRepository.countEntries({ actorId: actor.id }, tx);
      const after = await countAllAuditRows(tx);

      expect(after).toBe(before);
    });
  });
});

describe("AuditTrailRepository — join integrity precondition", () => {
  test("an audit row can never orphan its actor: the actor_id FK rejects an unknown actor", async () => {
    await runInRollback(async tx => {
      const missingActorId = await absentActorId(tx);
      const error = await expectRepoError(() =>
        insertAuditRow(tx, missingActorId, {
          actionType: AuditActionType.Create,
          entityType: uniqueEntityType(),
          entityId: null,
          details: null,
          createdAt: T_MID,
        })
      );
      expect(error).toBeInstanceOf(Error);
      expect(constraintNameOf(error)).toContain("actor_id");
    });
  });
});
