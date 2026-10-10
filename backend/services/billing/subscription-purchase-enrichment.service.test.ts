/**
 * SubscriptionPurchaseService.listOwn enrichment tests — the
 * owner-scoped student producer with its page-level enrichment pass,
 * exercised against a MOCKED repository seam (no live database). The
 * suite's oracles: the CALL-COUNT LOCK (the three batch reads fire
 * EXACTLY ONCE per page regardless of size) and the ownership boundary
 * (only the caller's own already-authorized rows feed the batches — no
 * client-supplied id ever enters a batch).
 *
 * Mock discipline: bun `spyOn` over the repository namespace objects —
 * every spy is registered and restored by the file-level `afterEach`.
 * The enrichment delegates to `SubscriptionAdminService
 * .enrichSubscriptionRows`, so these stubs exercise the full producer
 * chain. Fixtures are in-file row shapes typed from `@/backend/types`;
 * a never-connected pg `Pool` stands in for the caller's executor so
 * pass-through is asserted BY IDENTITY without a live connection.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): rows mapped onto the strongly-typed
 *    ReturnType then enriched with plan, count, and peek onto row
 *    copies; certified status/gateway members survive the pass.
 *  - Tier 2 (boundary): empty state (zero batch reads); single row and a
 *    100-row page with the call count constant; duplicate plan ids
 *    across the caller's rows collapse into one distinct plan batch.
 *  - Tier 3 (chaos): concurrent interleaved `listOwn` calls for two
 *    callers via `Promise.allSettled` stay isolated with per-page batch
 *    counts; a repository failure propagates unchanged.
 *  - Tier 4 (security/abuse): the owner predicate is the only read scope
 *    — the batches receive EXACTLY the page rows' ids and every enriched
 *    row belongs to the caller; the enriched row surface is exactly the
 *    canonical row plus the three enrichment fields (nothing else
 *    leaks onto it); malformed caller ids are the localized VALIDATION
 *    denial with zero reads of any kind.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Pool } from "pg";
import { AuditTrailRepository, PlanRepository, SubscriptionRepository } from "@/backend/db/repo";
import type { AuditTrailLatestEntryRow } from "@/backend/db/repo/audit/audit-trail.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import { SubscriptionPurchaseService } from "@/backend/services/billing/subscription-purchase.service";
import type { PlanSelectType, SubscriptionSelectType } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

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

/** The errors-namespace translations for a locale (computed per call). */
function t(locale: "ar" | "en") {
  return getServerTranslations(locale).errorsTranslations;
}

/** Instanceof-guarded rejection message read (never a narrowing cast). */
function rejectionMessage(error: unknown): string {
  return error instanceof Error ? error.message : "";
}

/** One stored subscription row owned by the caller (raw pg-enum strings). */
function makeSubscriptionRow(overrides: Partial<SubscriptionSelectType> = {}): SubscriptionSelectType {
  return {
    id: 11,
    userId: 5001,
    planId: 101,
    status: "active",
    startDate: null,
    endDate: NOW,
    paymentMethod: null,
    paymentReference: null,
    paymentVerifiedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** One stored plan row (select projection). */
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

/**
 * Stubs the owner listing plus the three enrichment batch reads. The
 * count batch answers every requested id with `countOf`, and the peek
 * batch answers every requested id with the `create` teaser. Returns the
 * spies for call-count and argument assertions.
 */
function stubListOwn(
  rows: readonly SubscriptionSelectType[],
  plans: readonly PlanSelectType[],
  countOf: (id: number) => number
) {
  const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async () => [...rows]));
  const planSpy = trackSpy(
    spyOn(PlanRepository, "findByIds").mockImplementation(async ids => plans.filter(plan => ids.includes(plan.id)))
  );
  const countSpy = trackSpy(
    spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(
      async (_entityType, ids) => new Map<number, number>(ids.map((id): [number, number] => [id, countOf(id)]))
    )
  );
  const peekSpy = trackSpy(
    spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
      async (_entityType, ids) =>
        new Map<number, AuditTrailLatestEntryRow | null>(
          ids.map((id): [number, AuditTrailLatestEntryRow | null] => [
            id,
            { entityId: id, actionType: "create", createdAt: NOW },
          ])
        )
    )
  );
  return { listSpy, planSpy, countSpy, peekSpy };
}

describe("SubscriptionPurchaseService.listOwn — enriched owner-scoped read", () => {
  test("enriches the caller's rows with plan, count, and peek in the locked batch counts", async () => {
    const planRow = makePlanRow({ id: 101 });
    const rows = [
      makeSubscriptionRow({ id: 11, planId: 101 }),
      makeSubscriptionRow({ id: 12, planId: 102, status: "pending" }),
    ];
    const { listSpy, planSpy, countSpy, peekSpy } = stubListOwn(rows, [planRow], () => 2);

    const listing = await SubscriptionPurchaseService.listOwn(5001, "en");

    expect(listSpy.mock.calls).toHaveLength(1);
    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    // The owner predicate is the only read scope: the batches carry
    // exactly the caller's own page-row ids.
    const [, countIds] = countSpy.mock.calls[0] ?? [];
    expect(countIds).toEqual([11, 12]);
    expect(listing).toHaveLength(2);
    expect(listing[0]?.status).toBe(SubscriptionStatus.Active);
    expect(listing[0]?.plan).toBe(planRow);
    expect(listing[0]?.auditEntriesCount).toBe(2);
    expect(listing[0]?.auditTrailPeek).toEqual({ actionType: AuditActionType.Create, at: NOW });
    // The unmatched plan id enriches the honest null value.
    expect(listing[1]?.plan).toBeNull();
    expect(listing[1]?.status).toBe(SubscriptionStatus.Pending);
  });

  test("answers the empty state with an empty list and ZERO batch reads", async () => {
    const { planSpy, countSpy, peekSpy } = stubListOwn([], [], () => 0);

    const listing = await SubscriptionPurchaseService.listOwn(5001, "en");

    expect(listing).toEqual([]);
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("issues EXACTLY ONE batch per read for a single-row page", async () => {
    const single = [makeSubscriptionRow({ id: 11, planId: 101 })];
    const { planSpy, countSpy, peekSpy } = stubListOwn(single, [makePlanRow({ id: 101 })], () => 1);

    const listing = await SubscriptionPurchaseService.listOwn(5001, "en");

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    expect(listing).toHaveLength(1);
  });

  test("issues EXACTLY ONE batch per read for a 100-row page (count stays page-size-independent)", async () => {
    const hundred = Array.from({ length: 100 }, (_, index) =>
      makeSubscriptionRow({ id: index + 1, userId: 5001, planId: 101 + (index % 7) })
    );
    const plans = Array.from({ length: 7 }, (_, index) => makePlanRow({ id: 101 + index }));
    const { planSpy, countSpy, peekSpy } = stubListOwn(hundred, plans, id => id);

    const listing = await SubscriptionPurchaseService.listOwn(5001, "en");

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    expect(listing).toHaveLength(100);
    expect(listing.every(row => row.userId === 5001)).toBe(true);
    expect(listing[42]?.auditEntriesCount).toBe(43);
  });

  test("attaches exactly the three enrichment fields — nothing else leaks onto the row", async () => {
    const rows = [makeSubscriptionRow({ id: 11, planId: 101 })];
    const sourceKeys = Object.keys(rows[0] ?? {});
    stubListOwn(rows, [makePlanRow({ id: 101 })], () => 1);

    const listing = await SubscriptionPurchaseService.listOwn(5001, "en");

    const enrichedKeys = Object.keys(listing[0] ?? {});
    const expectedKeys = [...new Set([...sourceKeys, "plan", "auditEntriesCount", "auditTrailPeek"])].toSorted((a, b) =>
      a.localeCompare(b)
    );
    expect(expectedKeys).toEqual(enrichedKeys.toSorted((a, b) => a.localeCompare(b)));
  });

  test("keeps concurrent interleaved callers isolated with per-page batch counts", async () => {
    const planA = makePlanRow({ id: 101, title: "A" });
    const planB = makePlanRow({ id: 201, title: "B" });
    const rowsA = [
      makeSubscriptionRow({ id: 11, userId: 5001, planId: 101 }),
      makeSubscriptionRow({ id: 12, userId: 5001, planId: 101 }),
    ];
    const rowsB = [
      makeSubscriptionRow({ id: 21, userId: 6001, planId: 201 }),
      makeSubscriptionRow({ id: 22, userId: 6001, planId: 201 }),
    ];
    const listSpy = trackSpy(
      spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async (userId: number) =>
        userId === 5001 ? [...rowsA] : [...rowsB]
      )
    );
    const planSpy = trackSpy(
      spyOn(PlanRepository, "findByIds").mockImplementation(async ids => (ids.includes(201) ? [planB] : [planA]))
    );
    const countSpy = trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(
        async (_type, ids) => new Map<number, number>(ids.map((id): [number, number] => [id, id < 20 ? 3 : 5]))
      )
    );
    const peekSpy = trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async (_type, ids) =>
          new Map<number, AuditTrailLatestEntryRow | null>(
            ids.map((id): [number, AuditTrailLatestEntryRow | null] => [
              id,
              { entityId: id, actionType: id < 20 ? "create" : "adjust", createdAt: NOW },
            ])
          )
      )
    );

    const results = await Promise.allSettled([
      SubscriptionPurchaseService.listOwn(5001, "en"),
      SubscriptionPurchaseService.listOwn(6001, "en"),
    ]);

    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const pageA = results[0];
    const pageB = results[1];
    if (pageA?.status !== "fulfilled" || pageB?.status !== "fulfilled") {
      throw new Error("both concurrent pages should fulfill");
    }
    // Caller A sees only own rows enriched with own plan/count/peek.
    expect(pageA.value.map(row => row.id)).toEqual([11, 12]);
    expect(pageA.value.every(row => row.userId === 5001)).toBe(true);
    expect(pageA.value.every(row => row.plan === planA)).toBe(true);
    expect(pageA.value.every(row => row.auditEntriesCount === 3)).toBe(true);
    expect(pageA.value.every(row => row.auditTrailPeek?.actionType === AuditActionType.Create)).toBe(true);
    // Caller B likewise — no cross-caller id ever enters a batch.
    expect(pageB.value.map(row => row.id)).toEqual([21, 22]);
    expect(pageB.value.every(row => row.userId === 6001)).toBe(true);
    expect(pageB.value.every(row => row.plan === planB)).toBe(true);
    expect(pageB.value.every(row => row.auditEntriesCount === 5)).toBe(true);
    expect(pageB.value.every(row => row.auditTrailPeek?.actionType === AuditActionType.Adjust)).toBe(true);
    // Two pages, two of each read — never per-row.
    expect(listSpy.mock.calls).toHaveLength(2);
    expect(planSpy.mock.calls).toHaveLength(2);
    expect(countSpy.mock.calls).toHaveLength(2);
    expect(peekSpy.mock.calls).toHaveLength(2);
  });

  test("carries the caller's executor to the plan batch by identity", async () => {
    const executor = new Pool({ max: 1, connectionTimeoutMillis: 1 });
    const { planSpy } = stubListOwn(
      [makeSubscriptionRow({ id: 11, planId: 101 })],
      [makePlanRow({ id: 101 })],
      () => 1
    );
    try {
      await SubscriptionPurchaseService.listOwn(5001, "en", executor);

      const [, executorArg] = planSpy.mock.calls[0] ?? [];
      expect(executorArg).toBe(executor);
    } finally {
      await executor.end();
    }
  });

  test("propagates a repository failure unchanged (same error identity)", async () => {
    const failure = new DomainError("LIST_READ_FAILED", "boom");
    trackSpy(spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async () => Promise.reject(failure)));

    let caught: unknown = null;
    try {
      await SubscriptionPurchaseService.listOwn(5001, "en");
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });

  test("denies malformed caller ids with the localized VALIDATION denial and zero reads of any kind", async () => {
    const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId"));
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds"));
    const countSpy = trackSpy(spyOn(AuditTrailRepository, "countEntriesByEntityIds"));
    const peekSpy = trackSpy(spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds"));

    const caughtPerPage = await Promise.all(
      [0, -1, Number.NaN, 2.5].map(async malformed => {
        try {
          await SubscriptionPurchaseService.listOwn(malformed, "ar");
          return null;
        } catch (error: unknown) {
          return error;
        }
      })
    );
    for (const caught of caughtPerPage) {
      expect(caught).toBeInstanceOf(ValidationError);
      expect(rejectionMessage(caught)).toBe(t("ar").validation);
    }

    expect(t("ar").validation).not.toBe(t("en").validation);
    expect(listSpy).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });
});
