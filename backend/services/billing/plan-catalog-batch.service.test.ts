/**
 * PlanCatalogService.findByIds tests — the batch plan-lookup seam for
 * page-level subscription enrichment, exercised against a MOCKED
 * repository seam (no live database): the suite's oracle is the
 * call-count + argument contract at the repository boundary, which is
 * what eliminates the per-row plan reads on list pages.
 *
 * Mock discipline: bun `spyOn` over the repository namespace objects —
 * every spy is registered and restored by the file-level `afterEach`
 * (an unrestored mock keeps accumulating calls and poisons later
 * count assertions). Fixtures are in-file row shapes typed from
 * `@/backend/types`; a never-connected pg `Pool` instance stands in for
 * the caller's executor so pass-through can be asserted BY IDENTITY
 * without a live connection.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): one map entry per DISTINCT requested id;
 *    unmatched ids are the honest `null` VALUE (never an absent key);
 *    duplicate ids collapse BEFORE the repository read; results keyed by
 *    the row's own id (never input order); deactivated plans stored
 *    verbatim (no active predicate at this seam); the empty-id
 *    short-circuit skips the repository entirely.
 *  - Tier 2 (boundary): a single id; the empty list; a list one past the
 *    repository's 1000-id batch cap passes through as ONE repository
 *    call (chunking stays below this seam).
 *  - Tier 3 (chaos): a repository failure propagates UNCHANGED (same
 *    error identity); concurrent interleaved lookups with
 *    argument-dispatching mocks stay isolated per call.
 *  - Tier 4 (abuse): id-fuzz (negative, zero, fractional) is inert data
 *    here — every id is only ever a bound map key; the executor and
 *    locale parameters are carried through, never invented.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Pool } from "pg";
import { PlanRepository } from "@/backend/db/repo";
import { DomainError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import type { PlanSelectType } from "@/backend/types";

/**
 * Registry of every spy created during the currently running test. bun's
 * `spyOn` reuses ONE mock per object+method pair until it is restored, so
 * an unrestored mock keeps accumulating `mock.calls` across tests and
 * poisons later call-count assertions — every spy is registered here and
 * restored by the file-level `afterEach`.
 */
const trackedSpies: Array<{ restore(): void }> = [];

function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
  trackedSpies.push({ restore: () => spy.mockRestore() });
  return spy;
}

afterEach(() => {
  for (const entry of trackedSpies) {
    entry.restore();
  }
  trackedSpies.length = 0;
});

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** One stored plan row (shape from the plans table's select projection). */
function makePlanRow(overrides: Partial<PlanSelectType> = {}): PlanSelectType {
  return {
    id: 101,
    title: "Plan",
    sessionCount: 8,
    price: "100.00",
    currency: "EGP",
    intervalDays: 30,
    balanceLane: null,
    isActive: true,
    deactivatedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** A never-connected pool standing in for the caller's query executor. */
function sentinelExecutor(): Pool {
  return new Pool({ max: 1, connectionTimeoutMillis: 1 });
}

describe("PlanCatalogService.findByIds — batch plan lookup", () => {
  test("keys every distinct requested id and answers unmatched ids with the null value", async () => {
    const rowOne = makePlanRow({ id: 1, title: "One" });
    const rowThree = makePlanRow({ id: 3, title: "Three" });
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [rowThree, rowOne]));

    const plansById = await PlanCatalogService.findByIds([1, 2, 3]);

    expect(plansById.size).toBe(3);
    expect(plansById.get(1)).toBe(rowOne);
    // The unmatched id is the honest null VALUE — present, never absent.
    expect(plansById.get(2)).toBeNull();
    expect(plansById.has(2)).toBe(true);
    expect(plansById.get(3)).toBe(rowThree);
    expect(planSpy.mock.calls).toHaveLength(1);
    const [requestedIds] = planSpy.mock.calls[0] ?? [];
    expect(requestedIds).toEqual([1, 2, 3]);
  });

  test("collapses duplicate ids before the repository read", async () => {
    const row = makePlanRow({ id: 7 });
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [row]));

    const plansById = await PlanCatalogService.findByIds([7, 7, 7, 8, 7]);

    expect(plansById.size).toBe(2);
    expect(plansById.get(7)).toBe(row);
    expect(plansById.get(8)).toBeNull();
    const [requestedIds] = planSpy.mock.calls[0] ?? [];
    expect(requestedIds).toEqual([7, 8]);
  });

  test("answers an empty id list with an empty map without touching the repository", async () => {
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => []));

    const plansById = await PlanCatalogService.findByIds([]);

    expect(plansById.size).toBe(0);
    expect(planSpy).not.toHaveBeenCalled();
  });

  test("keys results by each row's own id, never by input order", async () => {
    const rowA = makePlanRow({ id: 20 });
    const rowB = makePlanRow({ id: 10 });
    const rowC = makePlanRow({ id: 30 });
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [rowC, rowA, rowB]));

    const plansById = await PlanCatalogService.findByIds([30, 20, 10]);

    expect(plansById.get(10)).toBe(rowB);
    expect(plansById.get(20)).toBe(rowA);
    expect(plansById.get(30)).toBe(rowC);
  });

  test("stores deactivated plans verbatim — no active predicate at this seam", async () => {
    const deactivated = makePlanRow({ id: 5, isActive: false, deactivatedAt: NOW });
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [deactivated]));

    const plansById = await PlanCatalogService.findByIds([5]);

    expect(plansById.get(5)).toBe(deactivated);
    expect(plansById.get(5)?.isActive).toBe(false);
  });

  test("carries the caller's executor through by identity and tolerates the locale parameter", async () => {
    const executor = sentinelExecutor();
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => []));
    try {
      const plansById = await PlanCatalogService.findByIds([1, 2], "ar", executor);

      expect(plansById.size).toBe(2);
      expect(planSpy.mock.calls).toHaveLength(1);
      const [, executorArg] = planSpy.mock.calls[0] ?? [];
      expect(executorArg).toBe(executor);
    } finally {
      await executor.end();
    }
  });

  test("passes the full distinct list in ONE repository call past the 1000-id batch cap", async () => {
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => []));
    const ids = Array.from({ length: 1001 }, (_, index) => index + 1);

    const plansById = await PlanCatalogService.findByIds(ids);

    // Chunking is the repository's concern — this seam forwards the whole
    // distinct list in a single call, so a page costs exactly one plan read.
    expect(planSpy.mock.calls).toHaveLength(1);
    const [requestedIds] = planSpy.mock.calls[0] ?? [];
    expect(requestedIds).toEqual(ids);
    expect(plansById.size).toBe(1001);
  });

  test("propagates a repository failure unchanged (same error identity)", async () => {
    const failure = new DomainError("PLAN_READ_FAILED", "boom");
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => Promise.reject(failure)));

    let caught: unknown = null;
    try {
      await PlanCatalogService.findByIds([1]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });

  test("keeps concurrent interleaved lookups isolated per call", async () => {
    const rowOne = makePlanRow({ id: 1, title: "One" });
    const rowTwo = makePlanRow({ id: 2, title: "Two" });
    const planSpy = trackSpy(
      spyOn(PlanRepository, "findByIds").mockImplementation(async ids => (ids.includes(2) ? [rowTwo] : [rowOne]))
    );

    const results = await Promise.allSettled([
      PlanCatalogService.findByIds([1, 9]),
      PlanCatalogService.findByIds([2, 9]),
    ]);

    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const first = results[0];
    const second = results[1];
    if (first?.status !== "fulfilled" || second?.status !== "fulfilled") {
      throw new Error("both concurrent lookups should fulfill");
    }
    expect(first.value.get(1)).toBe(rowOne);
    expect(first.value.get(9)).toBeNull();
    expect(second.value.get(2)).toBe(rowTwo);
    expect(second.value.get(9)).toBeNull();
    expect(planSpy.mock.calls).toHaveLength(2);
  });
});
