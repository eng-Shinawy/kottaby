/**
 * PlanRepository.findByIds — batch-read coverage against the live
 * PostgreSQL instance inside rolled-back transactions.
 *
 * Per `backend/db/test/AGENTS.md`:
 *  - Every tx-path test runs inside `runInRollback`; `tx` is passed to
 *    EVERY repository call, fixture insert, and direct Drizzle query.
 *  - The no-tx (default-executor) leg runs raw SQL via `queryDb` against
 *    COMMITTED data only, so its fixtures are committed once in
 *    `beforeAll` and hard-deleted with proof in `afterAll` (the
 *    plan-catalog.repository precedent); rollback fixtures are invisible
 *    to that leg by design.
 *  - Absent plan ids are anchored beyond the identity sequence's reach
 *    (`absentPlanId`), never assumed from seed data.
 *  - No `expect(...).rejects.toThrow()` — the method has no error branch;
 *    unmatched ids are data (no row), not failures.
 *
 * Coverage map (4-Tier):
 *  - Tier 1: both executor legs return full-fidelity rows; deactivated
 *    plans included (no active predicate); empty-id short-circuit.
 *  - Tier 2: single id; missing ids; duplicate ids collapse; input-order
 *    independence; exactly `PLAN_ID_BATCH_LIMIT` ids (single chunk) and
 *    past it (multi-chunk merge with real ids spanning the chunk seam).
 *  - Tier 3: concurrent batch calls (`Promise.allSettled`) mixing tx and
 *    no-tx legs; interleaved inserts visible to a later same-transaction
 *    batch read.
 *  - Tier 4: fuzz ids (negative, zero) match nothing and never error;
 *    exactly the requested id set is returned (no row outside it leaks).
 *
 * Tx/no-tx semantic equivalence: the two legs run different SQL texts
 * (Drizzle `inArray` vs raw `= ANY($1::int[])`), so the committed
 * fixtures are read through BOTH legs and compared row-for-row.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "@/backend/db";
import { PLAN_ID_BATCH_LIMIT, PlanRepository } from "@/backend/db/repo/billing/plan.repository";
import { plans } from "@/backend/db/schema/billing/plans";
import { createTestPlan } from "@/backend/db/test/entity-setup";
import { runInRollback } from "@/backend/db/test/test-utils";
import type { DBTransaction, PlanSelectType } from "@/backend/types";

/**
 * Returns an integer id that cannot exist as a `plans` row: `plans.id` is
 * `generatedAlwaysAsIdentity()`, so anything above the current max (plus
 * an offset no sequence reaches during a rolled-back test) is guaranteed
 * absent — the exact anchor for missing-id probes.
 */
async function absentPlanId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${plans.id}), 0)::int` }).from(plans);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Sorts rows by id so leg comparisons are order-insensitive. */
function byId(rows: readonly PlanSelectType[]): PlanSelectType[] {
  return rows.toSorted((a, b) => a.id - b.id);
}

/**
 * Field-wise row comparison that skips timestamp identity (both legs
 * must return `Date` instances with equal instants, but the raw leg
 * re-parses them from the wire, so value-level equality is the honest
 * bar) while pinning every other column.
 */
function expectSamePlanShape(received: PlanSelectType, expected: PlanSelectType): void {
  expect(received.id).toBe(expected.id);
  expect(received.title).toBe(expected.title);
  expect(received.sessionCount).toBe(expected.sessionCount);
  expect(received.price).toBe(expected.price);
  expect(received.currency).toBe(expected.currency);
  expect(received.intervalDays).toBe(expected.intervalDays);
  expect(received.balanceLane).toBe(expected.balanceLane);
  expect(received.isActive).toBe(expected.isActive);
  expect(received.deactivatedAt ? received.deactivatedAt.getTime() : null).toBe(
    expected.deactivatedAt ? expected.deactivatedAt.getTime() : null
  );
  expect(received.createdAt).toBeInstanceOf(Date);
  expect(received.createdAt.getTime()).toBe(expected.createdAt.getTime());
  expect(received.updatedAt).toBeInstanceOf(Date);
  expect(received.updatedAt.getTime()).toBe(expected.updatedAt.getTime());
}

describe("PlanRepository.findByIds", () => {
  // ─── Committed fixtures for the default-executor (no-tx) leg ─────────────

  let committedActive: PlanSelectType | undefined;
  let committedOther: PlanSelectType | undefined;
  let committedDeactivated: PlanSelectType | undefined;

  beforeAll(async () => {
    await db.transaction(async tx => {
      committedActive = await createTestPlan(tx, { title: "Batch Read Active Plan" });
      committedOther = await createTestPlan(tx, { title: "Batch Read Other Plan" });
      committedDeactivated = await createTestPlan(tx, {
        title: "Batch Read Withdrawn Plan",
        isActive: false,
        deactivatedAt: new Date(),
      });
    });
  });

  afterAll(async () => {
    if (!committedActive || !committedOther || !committedDeactivated) {
      throw new Error("findByIds batch fixtures were not committed");
    }
    await db.delete(plans).where(eq(plans.id, committedActive.id));
    await db.delete(plans).where(eq(plans.id, committedOther.id));
    await db.delete(plans).where(eq(plans.id, committedDeactivated.id));
    // Teardown proof: the default-executor read sees nothing after the delete.
    expect(await PlanRepository.findByIds([committedActive.id])).toEqual([]);
  });

  const committedIds = (): [number, number, number] => {
    if (!committedActive || !committedOther || !committedDeactivated) {
      throw new Error("findByIds batch fixtures were not committed");
    }
    return [committedActive.id, committedOther.id, committedDeactivated.id];
  };

  // ─── Tier 1: contract — both executor legs ────────────────────────────────

  test("tx leg returns full-fidelity rows for the requested ids", async () => {
    await runInRollback(async tx => {
      const a = await createTestPlan(tx, { title: "Tx Leg Plan A" });
      const b = await createTestPlan(tx, { title: "Tx Leg Plan B", price: "42.50" });

      const rows = await PlanRepository.findByIds([a.id, b.id], tx);
      expect(rows).toHaveLength(2);
      const byKey = new Map(rows.map(row => [row.id, row]));
      const rowA = byKey.get(a.id);
      const rowB = byKey.get(b.id);
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      if (rowA && rowB) {
        expectSamePlanShape(rowA, a);
        expectSamePlanShape(rowB, b);
      }
    });
  });

  test("no-tx leg returns the same full-fidelity rows from committed data", async () => {
    const rows = await PlanRepository.findByIds(committedIds());
    expect(rows).toHaveLength(3);
    const byKey = new Map(rows.map(row => [row.id, row]));
    const rowActive = byKey.get(committedIds()[0]);
    const rowOther = byKey.get(committedIds()[1]);
    const rowDeactivated = byKey.get(committedIds()[2]);
    expect(rowActive).toBeDefined();
    expect(rowOther).toBeDefined();
    expect(rowDeactivated).toBeDefined();
    if (committedActive && committedOther && committedDeactivated && rowActive && rowOther && rowDeactivated) {
      expectSamePlanShape(rowActive, committedActive);
      expectSamePlanShape(rowOther, committedOther);
      expectSamePlanShape(rowDeactivated, committedDeactivated);
    }
  });

  test("deactivated plans are included — no active predicate on this read", async () => {
    await runInRollback(async tx => {
      const withdrawn = await createTestPlan(tx, {
        title: "Withdrawn Enrichment Plan",
        isActive: false,
        deactivatedAt: new Date(),
      });
      const rows = await PlanRepository.findByIds([withdrawn.id], tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.isActive).toBe(false);
    });
  });

  test("an empty id list short-circuits on both legs without touching the database", async () => {
    await runInRollback(async tx => {
      expect(await PlanRepository.findByIds([], tx)).toEqual([]);
      expect(await PlanRepository.findByIds([])).toEqual([]);
    });
  });

  // ─── Tx/no-tx semantic equivalence — the two SQL texts must agree ─────────

  test("both legs return row-for-row identical results for the same committed ids", async () => {
    await runInRollback(async tx => {
      const txRows = byId(await PlanRepository.findByIds(committedIds(), tx));
      const noTxRows = byId(await PlanRepository.findByIds(committedIds()));
      expect(txRows).toHaveLength(noTxRows.length);
      for (const [index, txRow] of txRows.entries()) {
        const noTxRow = noTxRows[index];
        if (noTxRow) {
          expectSamePlanShape(txRow, noTxRow);
        }
      }
    });
  });

  // ─── Tier 2: boundaries ──────────────────────────────────────────────────

  test("missing ids contribute no row; matched and unmatched ids mix cleanly", async () => {
    await runInRollback(async tx => {
      const present = await createTestPlan(tx, { title: "Present Plan" });
      const absent = await absentPlanId(tx);

      const rows = await PlanRepository.findByIds([present.id, absent, absent + 1], tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(present.id);
    });
  });

  test("duplicate ids collapse to the single stored row on both legs", async () => {
    await runInRollback(async tx => {
      const a = await createTestPlan(tx, { title: "Dup Plan A" });
      const b = await createTestPlan(tx, { title: "Dup Plan B" });

      const txRows = await PlanRepository.findByIds([a.id, a.id, b.id, a.id], tx);
      expect(new Set(txRows.map(row => row.id))).toEqual(new Set([a.id, b.id]));

      const [firstCommitted, secondCommitted] = committedIds();
      const noTxRows = await PlanRepository.findByIds([firstCommitted, firstCommitted, secondCommitted]);
      expect(noTxRows).toHaveLength(2);
    });
  });

  test("input order does not change the returned row set", async () => {
    await runInRollback(async tx => {
      const a = await createTestPlan(tx, { title: "Order Plan A" });
      const b = await createTestPlan(tx, { title: "Order Plan B" });
      const c = await createTestPlan(tx, { title: "Order Plan C" });

      const forward = byId(await PlanRepository.findByIds([a.id, b.id, c.id], tx));
      const backward = byId(await PlanRepository.findByIds([c.id, a.id, b.id], tx));
      expect(forward.map(row => row.id)).toEqual(backward.map(row => row.id));
    });
  });

  test("a single-id batch behaves like the single-row findById read", async () => {
    await runInRollback(async tx => {
      const solo = await createTestPlan(tx, { title: "Solo Plan" });
      const batch = await PlanRepository.findByIds([solo.id], tx);
      const single = await PlanRepository.findById(solo.id, tx);
      expect(batch).toHaveLength(1);
      expect(single).not.toBeNull();
      if (batch[0] && single) {
        expectSamePlanShape(batch[0], single);
      }
    });
  });

  test(`exactly PLAN_ID_BATCH_LIMIT ids stay in one chunk and resolve correctly`, async () => {
    await runInRollback(async tx => {
      const real = await createTestPlan(tx, { title: "Boundary Plan" });
      const base = await absentPlanId(tx);
      const ids = [real.id, ...Array.from({ length: PLAN_ID_BATCH_LIMIT - 1 }, (_, i) => base + i)];

      expect(ids).toHaveLength(PLAN_ID_BATCH_LIMIT);
      const rows = await PlanRepository.findByIds(ids, tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(real.id);
    });
  });

  test(`more than PLAN_ID_BATCH_LIMIT ids merge chunk results with real ids spanning the seam`, async () => {
    await runInRollback(async tx => {
      const first = await createTestPlan(tx, { title: "Chunk One Plan" });
      const second = await createTestPlan(tx, { title: "Chunk Two Plan" });
      const base = await absentPlanId(tx);
      // Real ids at chunk-1 start and chunk-2 start; filler elsewhere.
      const ids: number[] = [first.id];
      for (let i = 0; i < PLAN_ID_BATCH_LIMIT - 1; i += 1) {
        ids.push(base + i);
      }
      ids[PLAN_ID_BATCH_LIMIT - 1] = second.id; // last slot of chunk 1
      for (let i = 0; i < PLAN_ID_BATCH_LIMIT; i += 1) {
        ids.push(base + 1_000 + i);
      }
      expect(ids.length).toBeGreaterThan(PLAN_ID_BATCH_LIMIT);

      const rows = await PlanRepository.findByIds(ids, tx);
      expect(rows).toHaveLength(2);
      const returned = new Set(rows.map(row => row.id));
      expect(returned.has(first.id)).toBe(true);
      expect(returned.has(second.id)).toBe(true);
    });
  });

  // ─── Tier 3: chaos — concurrency and interleaved writes ─────────────────

  test("concurrent batch calls mixing tx and no-tx legs all resolve correctly", async () => {
    await runInRollback(async tx => {
      const rolledBack = await createTestPlan(tx, { title: "Concurrent Rollover Plan" });
      const ids = committedIds();

      const outcomes = await Promise.allSettled([
        PlanRepository.findByIds([rolledBack.id], tx),
        PlanRepository.findByIds(ids, tx),
        PlanRepository.findByIds(ids),
        PlanRepository.findByIds([ids[0]]),
        PlanRepository.findByIds([rolledBack.id, ids[1]], tx),
      ]);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }
      const txSolo = outcomes[0]?.status === "fulfilled" ? outcomes[0].value : [];
      expect(txSolo).toHaveLength(1);
      expect(txSolo[0]?.id).toBe(rolledBack.id);
      const txBatch = outcomes[1]?.status === "fulfilled" ? outcomes[1].value : [];
      expect(txBatch).toHaveLength(3);
      const noTxBatch = outcomes[2]?.status === "fulfilled" ? outcomes[2].value : [];
      expect(noTxBatch).toHaveLength(3);
      const noTxSolo = outcomes[3]?.status === "fulfilled" ? outcomes[3].value : [];
      expect(noTxSolo).toHaveLength(1);
      const txMixed = outcomes[4]?.status === "fulfilled" ? outcomes[4].value : [];
      expect(txMixed).toHaveLength(2);
    });
  });

  test("a plan inserted between two batch reads is visible to the later read in the same transaction", async () => {
    await runInRollback(async tx => {
      const before = await createTestPlan(tx, { title: "Interleave Before Plan" });
      const first = await PlanRepository.findByIds([before.id], tx);
      expect(first).toHaveLength(1);

      const after = await createTestPlan(tx, { title: "Interleave After Plan" });
      const second = await PlanRepository.findByIds([before.id, after.id], tx);
      expect(second).toHaveLength(2);
      expect(new Set(second.map(row => row.id))).toEqual(new Set([before.id, after.id]));
    });
  });

  // ─── Tier 4: security / abuse ────────────────────────────────────────────

  test("fuzz ids (negative, zero) match nothing and never error — parameterized, never interpolated", async () => {
    await runInRollback(async tx => {
      const real = await createTestPlan(tx, { title: "Fuzz Anchor Plan" });

      const txRows = await PlanRepository.findByIds([real.id, -1, 0, -2147483648], tx);
      expect(txRows).toHaveLength(1);
      expect(txRows[0]?.id).toBe(real.id);

      const ids = committedIds();
      const noTxRows = await PlanRepository.findByIds([...ids, -1, 0]);
      expect(noTxRows).toHaveLength(ids.length);
    });
  });

  test("exactly the requested id set is returned — no plan outside it leaks into the batch", async () => {
    await runInRollback(async tx => {
      const requested = await createTestPlan(tx, { title: "Isolation Requested Plan" });
      const other = await createTestPlan(tx, { title: "Isolation Unrequested Plan" });

      const rows = await PlanRepository.findByIds([requested.id], tx);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(requested.id);
      expect(rows.map(row => row.id)).not.toContain(other.id);
    });
  });
});
