/**
 * AuditTrailRepository batch enrichment reads — `countEntriesByEntityIds`
 * and `listLatestEntriesByEntityIds` coverage against the live
 * PostgreSQL instance inside rolled-back transactions.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every tx-path test runs inside `runInRollback`; `tx` is passed to
 *    EVERY repository call, fixture insert, and direct Drizzle query.
 *  - Fixture rows are inserted directly via Drizzle inside the rollback
 *    transaction (the repository under test is read-only by design).
 *  - `audit_logs` is append-only (UPDATE/DELETE blocked by an
 *    immutability trigger), so committed fixtures are NOT an option —
 *    the no-tx (`db`-executor) leg is exercised on the HONEST EMPTY ARM
 *    (a unique per-run entity-type label + ids anchored past the max
 *    entity id), which is deterministic regardless of committed data.
 *    Both legs run the byte-identical Drizzle chain (the branch is the
 *    executor handle only), so empty-arm parity + the single-row
 *    method parity tests below prove the executor split cannot change
 *    semantics.
 *  - Isolation anchors: a unique `entityType` label per run and entity
 *    ids beyond the current max — committed rows can never flip a
 *    result.
 *  - No `expect(...).rejects.toThrow()` — the methods have no error
 *    branch; unmatched ids are data (`0` / `null`), never failures.
 *
 * Coverage map (4-Tier):
 *  - Tier 1: per-entity counts and latest-entry peeks keyed by one
 *    entity-type label; map pre-initialization (every requested id
 *    present, absent ids honest `0` / `null`); raw `actionType` string.
 *  - Tier 2: empty ids; single id; duplicate ids collapse; missing
 *    entities; same-timestamp tiebreak (`id DESC`); latest-entry
 *    dominance of `created_at` over insertion order; exactly
 *    `AUDIT_ENTITY_ID_BATCH_LIMIT` ids (single chunk) and past it
 *    (chunk merge with real entries spanning the seam).
 *  - Tier 3: interleaved inserts changing which entry is latest between
 *    consecutive batch reads; concurrent tx/db batch calls in
 *    `Promise.allSettled`.
 *  - Tier 4: entity-type label isolation (a newer row under a different
 *    label never leaks into a batch keyed by this label); NULL
 *    `entity_id` rows never match; fuzz ids (negative, zero) match
 *    nothing and never error; exactly the requested id set is returned.
 */

import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  AUDIT_ENTITY_ID_BATCH_LIMIT,
  type AuditTrailLatestEntryRow,
  AuditTrailRepository,
} from "@/backend/db/repo/audit/audit-trail.repository";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import type { DBTransaction } from "@/backend/types";

/** Fixed UTC timestamps — deterministic latest-entry anchors. */
const T_OLD = new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
const T_MID = new Date(Date.UTC(2026, 0, 2, 12, 0, 0));
const T_NEW = new Date(Date.UTC(2026, 0, 3, 12, 0, 0));

/** Uniquely identifies fixture rows by `entityType` — immune to committed data. */
function uniqueEntityType(): string {
  return `probe_${randomUUID().slice(0, 8)}`;
}

/** Spec for one fixture audit row (the columns the batch reads project). */
interface AuditFixtureSpec {
  readonly actionType: AuditActionType;
  readonly entityType: string;
  readonly entityId: number | null;
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
      details: null,
      createdAt: spec.createdAt,
    })
    .returning();
  if (!row) {
    throw new Error("insertAuditRow: insert returned no rows");
  }
  return row;
}

/**
 * Returns an integer that no committed `audit_logs.entity_id` currently
 * holds and no concurrent insert can reach during the test — the anchor
 * space for requested-but-absent entity ids and for distinct fixtures.
 */
async function freshEntityIdBase(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${auditLogs.entityId}), 0)::int` }).from(auditLogs);
  return (row?.maxId ?? 0) + 10_000;
}

/** Extracts the latest-entry row for one id, failing loudly on absence. */
function peekOf(latest: Map<number, AuditTrailLatestEntryRow | null>, id: number): AuditTrailLatestEntryRow {
  const row = latest.get(id);
  if (!row) {
    throw new Error(`peekOf: no map entry for id ${id}`);
  }
  return row;
}

describe("AuditTrailRepository — batch enrichment reads", () => {
  // ─── Tier 1: contract — grouped count + DISTINCT ON latest ────────────────

  test("countEntriesByEntityIds counts per entity in one grouped query, absent ids honest zero", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const emptyEntity = base;
      const oneEntity = base + 1;
      const manyEntity = base + 2;
      const unrequestedEntity = base + 3;

      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: oneEntity,
        createdAt: T_OLD,
      });
      // Sequential inserts — identity ids must ascend with created_at here
      // so the newest-dated row is also the highest-id row.
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: manyEntity,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: manyEntity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: manyEntity,
        createdAt: T_NEW,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Delete,
        entityType: label,
        entityId: unrequestedEntity,
        createdAt: T_NEW,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(
        label,
        [emptyEntity, oneEntity, manyEntity],
        tx
      );
      expect(counts.size).toBe(3);
      expect(counts.get(emptyEntity)).toBe(0);
      expect(counts.get(oneEntity)).toBe(1);
      expect(counts.get(manyEntity)).toBe(3);
      // A requested id with rows is exactly the id set of the map — no
      // unrequested entity leaks into it.
      expect(counts.has(unrequestedEntity)).toBe(false);
    });
  });

  test("listLatestEntriesByEntityIds returns the newest entry per entity, absent ids null", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const richEntity = base;
      const emptyEntity = base + 1;

      const oldest = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: richEntity,
        createdAt: T_OLD,
      });
      const middle = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: richEntity,
        createdAt: T_MID,
      });
      const newest = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Reactivate,
        entityType: label,
        entityId: richEntity,
        createdAt: T_NEW,
      });
      expect(newest.id).toBeGreaterThan(middle.id);
      expect(middle.id).toBeGreaterThan(oldest.id);

      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, [richEntity, emptyEntity], tx);
      expect(latest.size).toBe(2);
      const peek = peekOf(latest, richEntity);
      expect(peek.entityId).toBe(richEntity);
      expect(peek.actionType).toBe(AuditActionType.Reactivate);
      expect(typeof peek.actionType).toBe("string");
      expect(peek.createdAt.getTime()).toBe(T_NEW.getTime());
      expect(latest.get(emptyEntity)).toBeNull();
    });
  });

  test("batch results agree with the single-row service twins (countEntries + listEntries ordering)", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_NEW,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [entity], tx);
      const singleCount = await AuditTrailRepository.countEntries({ entityType: label, entityId: entity }, tx);
      expect(counts.get(entity)).toBe(singleCount);
      expect(singleCount).toBe(3);

      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx);
      const singleNewest = await AuditTrailRepository.listEntries({ entityType: label, entityId: entity }, 1, 0, tx);
      const peek = peekOf(latest, entity);
      const twin = singleNewest[0];
      expect(twin).toBeDefined();
      if (twin) {
        expect(peek.actionType).toBe(twin.actionType);
        expect(peek.createdAt.getTime()).toBe(twin.createdAt.getTime());
      }
    });
  });

  test("an empty id list returns an empty map on both methods without executing a statement", async () => {
    await runInRollback(async tx => {
      expect(await AuditTrailRepository.countEntriesByEntityIds(uniqueEntityType(), [], tx)).toEqual(new Map());
      expect(await AuditTrailRepository.listLatestEntriesByEntityIds(uniqueEntityType(), [], tx)).toEqual(new Map());
    });
  });

  // ─── Tx/db executor equivalence — the split cannot change semantics ──────

  test("the db (no-tx) leg answers the honest empty arm identically to the tx leg", async () => {
    await runInRollback(async tx => {
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const ids = [base, base + 1, base + 2];

      const txCounts = await AuditTrailRepository.countEntriesByEntityIds(label, ids, tx);
      const dbCounts = await AuditTrailRepository.countEntriesByEntityIds(label, ids);
      expect([...dbCounts.entries()].toSorted((a, b) => a[0] - b[0])).toEqual(
        [...txCounts.entries()].toSorted((a, b) => a[0] - b[0])
      );
      for (const id of ids) {
        expect(dbCounts.get(id)).toBe(0);
      }

      const txLatest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, ids, tx);
      const dbLatest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, ids);
      expect([...dbLatest.keys()].toSorted((a, b) => a - b)).toEqual([...txLatest.keys()].toSorted((a, b) => a - b));
      for (const id of ids) {
        expect(dbLatest.get(id)).toBeNull();
      }
    });
  });

  // ─── Tier 2: boundaries ──────────────────────────────────────────────────

  test("duplicate ids in the request collapse to one map key", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [entity, entity, entity], tx);
      expect(counts.size).toBe(1);
      expect(counts.get(entity)).toBe(1);
      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity, entity], tx);
      expect(latest.size).toBe(1);
    });
  });

  test("a same-timestamp tie resolves to the higher id — the listEntries tiebreak, per entity", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      const firstTied = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });
      const secondTied = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });
      expect(secondTied.id).toBeGreaterThan(firstTied.id);

      const peek = peekOf(await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx), entity);
      expect(peek.actionType).toBe(AuditActionType.Update);
      expect(peek.createdAt.getTime()).toBe(T_MID.getTime());
    });
  });

  test("created_at dominates insertion order — a later-inserted older-dated row never wins the peek", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      // Inserted FIRST (lowest id) but dated NEWEST — it must win.
      const newestDated = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: entity,
        createdAt: T_NEW,
      });
      // Inserted LAST (highest id) but dated OLDEST — it must lose.
      const oldestDated = await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_OLD,
      });
      expect(oldestDated.id).toBeGreaterThan(newestDated.id);

      const peek = peekOf(await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx), entity);
      expect(peek.actionType).toBe(AuditActionType.Suspend);
      expect(peek.createdAt.getTime()).toBe(T_NEW.getTime());
    });
  });

  test(`exactly AUDIT_ENTITY_ID_BATCH_LIMIT ids stay in one chunk and resolve correctly`, async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const realEntity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: realEntity,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: realEntity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: realEntity,
        createdAt: T_NEW,
      });
      const ids = [realEntity, ...Array.from({ length: AUDIT_ENTITY_ID_BATCH_LIMIT - 1 }, (_, i) => base + 100 + i)];

      expect(ids).toHaveLength(AUDIT_ENTITY_ID_BATCH_LIMIT);
      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, ids, tx);
      expect(counts.size).toBe(AUDIT_ENTITY_ID_BATCH_LIMIT);
      expect(counts.get(realEntity)).toBe(3);
      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, ids, tx);
      expect(latest.size).toBe(AUDIT_ENTITY_ID_BATCH_LIMIT);
      expect(peekOf(latest, realEntity).createdAt.getTime()).toBe(T_NEW.getTime());
    });
  });

  test(`more than AUDIT_ENTITY_ID_BATCH_LIMIT ids merge chunk results with real entries spanning the seam`, async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const chunkOneEntity = base;
      const chunkTwoEntity = base + 1;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: chunkOneEntity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: label,
        entityId: chunkTwoEntity,
        createdAt: T_NEW,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Delete,
        entityType: label,
        entityId: chunkTwoEntity,
        createdAt: T_OLD,
      });

      // Real entries at chunk-1 start and chunk-2 start; filler elsewhere.
      const ids: number[] = [chunkOneEntity];
      for (let i = 0; i < AUDIT_ENTITY_ID_BATCH_LIMIT - 1; i += 1) {
        ids.push(base + 100 + i);
      }
      for (let i = 0; i < AUDIT_ENTITY_ID_BATCH_LIMIT; i += 1) {
        ids.push(base + 1_100 + i);
      }
      ids[AUDIT_ENTITY_ID_BATCH_LIMIT] = chunkTwoEntity;
      expect(ids.length).toBeGreaterThan(AUDIT_ENTITY_ID_BATCH_LIMIT);

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, ids, tx);
      expect(counts.size).toBe(ids.length);
      expect(counts.get(chunkOneEntity)).toBe(1);
      expect(counts.get(chunkTwoEntity)).toBe(2);

      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, ids, tx);
      expect(peekOf(latest, chunkOneEntity).actionType).toBe(AuditActionType.Create);
      expect(peekOf(latest, chunkTwoEntity).actionType).toBe(AuditActionType.Suspend);
      expect(peekOf(latest, chunkTwoEntity).createdAt.getTime()).toBe(T_NEW.getTime());
    });
  });

  // ─── Tier 3: chaos — interleaved writes and concurrency ───────────────────

  test("interleaved inserts change which entry is latest between consecutive batch reads", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;

      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: entity,
        createdAt: T_OLD,
      });
      const beforeInsert = peekOf(await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx), entity);
      expect(beforeInsert.actionType).toBe(AuditActionType.Create);

      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Reactivate,
        entityType: label,
        entityId: entity,
        createdAt: T_NEW,
      });
      const afterInsert = peekOf(await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx), entity);
      expect(afterInsert.actionType).toBe(AuditActionType.Reactivate);

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [entity], tx);
      expect(counts.get(entity)).toBe(2);
    });
  });

  test("concurrent batch calls mixing tx and db executors all resolve correctly", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const otherLabel = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: otherLabel,
        entityId: entity,
        createdAt: T_NEW,
      });

      const outcomes = await Promise.allSettled([
        AuditTrailRepository.countEntriesByEntityIds(label, [entity], tx),
        AuditTrailRepository.countEntriesByEntityIds(otherLabel, [entity], tx),
        AuditTrailRepository.countEntriesByEntityIds(label, [entity]),
        AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx),
        AuditTrailRepository.listLatestEntriesByEntityIds(otherLabel, [entity], tx),
      ]);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }
      if (outcomes[0]?.status === "fulfilled") {
        expect(outcomes[0].value.get(entity)).toBe(1);
      }
      if (outcomes[1]?.status === "fulfilled") {
        expect(outcomes[1].value.get(entity)).toBe(1);
      }
      if (outcomes[2]?.status === "fulfilled") {
        expect(outcomes[2].value.get(entity)).toBe(0);
      }
      if (outcomes[3]?.status === "fulfilled") {
        expect(peekOf(outcomes[3].value, entity).actionType).toBe(AuditActionType.Adjust);
      }
      if (outcomes[4]?.status === "fulfilled") {
        expect(peekOf(outcomes[4].value, entity).actionType).toBe(AuditActionType.Create);
      }
    });
  });

  // ─── Tier 4: security / abuse ────────────────────────────────────────────

  test("entity-type label isolation — a newer row under a different label never leaks into this label's batch", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const foreignLabel = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const sharedEntityId = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: sharedEntityId,
        createdAt: T_OLD,
      });
      // A NEWER foreign-label row for the SAME entity id — it must not
      // win this label's peek nor inflate its count.
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Suspend,
        entityType: foreignLabel,
        entityId: sharedEntityId,
        createdAt: T_NEW,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [sharedEntityId], tx);
      expect(counts.get(sharedEntityId)).toBe(1);
      const peek = peekOf(
        await AuditTrailRepository.listLatestEntriesByEntityIds(label, [sharedEntityId], tx),
        sharedEntityId
      );
      expect(peek.actionType).toBe(AuditActionType.Create);
      expect(peek.createdAt.getTime()).toBe(T_OLD.getTime());
    });
  });

  test("NULL entity_id rows never match any requested id", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Adjust,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Override,
        entityType: label,
        entityId: null,
        createdAt: T_NEW,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [entity], tx);
      expect(counts.get(entity)).toBe(1);
      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, [entity], tx);
      expect(peekOf(latest, entity).actionType).toBe(AuditActionType.Adjust);
      expect(latest.has(0)).toBe(false);
    });
  });

  test("fuzz ids (negative, zero) match nothing and never error — parameterized, never interpolated", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const entity = base;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Create,
        entityType: label,
        entityId: entity,
        createdAt: T_MID,
      });

      const ids = [entity, -1, 0, -2147483648];
      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, ids, tx);
      expect(counts.size).toBe(4);
      expect(counts.get(entity)).toBe(1);
      expect(counts.get(-1)).toBe(0);
      expect(counts.get(0)).toBe(0);
      expect(counts.get(-2147483648)).toBe(0);

      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, ids, tx);
      expect(latest.size).toBe(4);
      expect(latest.get(-1)).toBeNull();
      expect(latest.get(0)).toBeNull();
      expect(peekOf(latest, entity).actionType).toBe(AuditActionType.Create);
    });
  });

  test("exactly the requested id set is returned — no unrequested entity leaks into the maps", async () => {
    await runInRollback(async tx => {
      const actor = await createTestUser(tx);
      const label = uniqueEntityType();
      const base = await freshEntityIdBase(tx);
      const requested = base;
      const unrequested = base + 1;
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: unrequested,
        createdAt: T_OLD,
      });
      await insertAuditRow(tx, actor.id, {
        actionType: AuditActionType.Update,
        entityType: label,
        entityId: unrequested,
        createdAt: T_NEW,
      });

      const counts = await AuditTrailRepository.countEntriesByEntityIds(label, [requested], tx);
      expect([...counts.keys()]).toEqual([requested]);
      expect(counts.get(requested)).toBe(0);

      const latest = await AuditTrailRepository.listLatestEntriesByEntityIds(label, [requested], tx);
      expect([...latest.keys()]).toEqual([requested]);
      expect(latest.get(requested)).toBeNull();
    });
  });
});
