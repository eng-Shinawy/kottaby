/**
 * SubscriptionAdminService enrichment tests — the audit batch twins
 * (`auditEntriesCountBatch`, `auditTrailPeekBatch`), the page-level
 * enrichment pass (`enrichSubscriptionRows`), and the enriched
 * `listForAdmin` producer, exercised against a MOCKED repository seam
 * (no live database). The suite's primary oracle is the CALL-COUNT LOCK:
 * the three batch reads fire EXACTLY ONCE per page regardless of page
 * size — the service-level proof that list pages cost a constant number
 * of queries instead of one read per row.
 *
 * Mock discipline: bun `spyOn` over the repository namespace objects —
 * every spy is registered and restored by the file-level `afterEach`.
 * The admin gate is stubbed at ITS repository seam (`UserRepository`
 * .findById), so the full service chain runs; fixtures are in-file row
 * shapes typed from `@/backend/types`; a never-connected pg `Pool`
 * stands in for the caller's executor so pass-through is asserted BY
 * IDENTITY without a live connection.
 *
 * Coverage map:
 *  - Tier 1 (branch/statement): count/peek delegation carries the
 *    canonical subscription audit label and the ids verbatim; the peek
 *    batch certifies RAW action strings onto canonical members and
 *    renames `createdAt` → `at`; absent rows pass the honest `null`;
 *    uncertifiable literals are withheld as `null` with exactly one
 *    bounded domain log; enrichment map assembly attaches plan, count,
 *    and peek to row COPIES (source rows never mutated).
 *  - Tier 2 (boundary): empty page (zero batch reads), single row, 25
 *    and 100 rows — call count constant; duplicate plan ids across rows
 *    collapse to one distinct plan batch; ALL plans missing → `null`
 *    value per row; a 1001-row page still batches exactly once per read.
 *  - Tier 3 (chaos): repository failure mid-batch propagates unchanged
 *    (same error identity, later batches never run); map-order
 *    randomization leaves per-id assembly stable; hostile seam mutation
 *    of a row mid-pass degrades to `plan: null` instead of crashing;
 *    adversarial truncated maps degrade to the honest `0` / `null`;
 *    concurrent interleaved pages via `Promise.allSettled` stay
 *    isolated with per-page call counts.
 *  - Tier 4 (security/abuse): the batches read ONLY ids already present
 *    on caller-authorized page rows; the admin gate still runs BEFORE
 *    any read (non-admin/anonymous actors cost zero reads —
 *    permission-before-enrichment); malformed owner ids are the
 *    localized VALIDATION denial (asserted distinctly in "ar" and "en")
 *    with zero batch reads.
 */

import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { Pool } from "pg";
import { AuditTrailRepository, PlanRepository, SubscriptionRepository, UserRepository } from "@/backend/db/repo";
import type { AuditTrailLatestEntryRow } from "@/backend/db/repo/audit/audit-trail.repository";
import { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { ConflictError, DomainError, ForbiddenError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { SUBSCRIPTION_AUDIT_ENTITY_TYPE } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import type { PlanSelectType, SubscriptionReturnType, SubscriptionSelectType, UserSelectType } from "@/backend/types";
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

/** One stored subscription row (raw select projection, raw pg-enum strings). */
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

/** One already-mapped canonical subscription row (strongly-typed enums). */
function makeReturnRow(overrides: Partial<SubscriptionReturnType> = {}): SubscriptionReturnType {
  return {
    id: 11,
    userId: 5001,
    planId: 101,
    status: SubscriptionStatus.Active,
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

/** One users row (select projection). */
function makeUserRow(overrides: Partial<UserSelectType> = {}): UserSelectType {
  return {
    id: 42,
    fullName: "Actor",
    email: "actor@example.com",
    phone: null,
    passwordHash: "hash",
    mustChangePassword: false,
    role: "admin",
    dateOfBirth: null,
    gender: null,
    country: null,
    countryCode: null,
    locale: null,
    isDeleted: false,
    deletedAt: null,
    suspended: false,
    suspendedAt: null,
    suspendedPeriodDays: null,
    isBlocked: false,
    blockedAt: null,
    lastActiveAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** One raw latest-audit row as the batch repository read returns it. */
function makeLatestRow(overrides: Partial<AuditTrailLatestEntryRow> = {}): AuditTrailLatestEntryRow {
  return {
    entityId: 11,
    actionType: "create",
    createdAt: NOW,
    ...overrides,
  };
}

/** A never-connected pool standing in for the caller's query executor. */
function sentinelExecutor(): Pool {
  return new Pool({ max: 1, connectionTimeoutMillis: 1 });
}

/**
 * Stubs the three enrichment batch reads over a page whose rows are
 * `rows`: the plan batch answers `plans` (keyed set), the count batch
 * answers every requested id with `countOf`, and the peek batch answers
 * every requested id with the `create` teaser. Returns the spies for
 * call-count assertions.
 */
function stubEnrichmentBatches(plans: readonly PlanSelectType[], countOf: (id: number) => number) {
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
            makeLatestRow({ entityId: id, actionType: "create" }),
          ])
        )
    )
  );
  return { planSpy, countSpy, peekSpy };
}

/** Builds `count` distinct mapped rows cycling over `planCount` plan ids. */
function buildPage(count: number, planCount: number): SubscriptionReturnType[] {
  return Array.from({ length: count }, (_, index) =>
    makeReturnRow({ id: index + 1, userId: 5001, planId: 101 + (index % planCount) })
  );
}

// ─── auditEntriesCountBatch ────────────────────────────────────────────────

describe("SubscriptionAdminService.auditEntriesCountBatch", () => {
  test("delegates with the canonical subscription label, the ids verbatim, and passes the map through", async () => {
    const counts = new Map<number, number>([
      [11, 2],
      [12, 0],
    ]);
    const countSpy = trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(async () => counts)
    );

    const result = await SubscriptionAdminService.auditEntriesCountBatch([11, 12]);

    expect(countSpy.mock.calls).toHaveLength(1);
    const [entityType, entityIds] = countSpy.mock.calls[0] ?? [];
    expect(entityType).toBe(SUBSCRIPTION_AUDIT_ENTITY_TYPE);
    expect(entityType).toBe("subscription");
    expect(entityIds).toEqual([11, 12]);
    expect(result).toBe(counts);
  });
});

// ─── auditTrailPeekBatch ────────────────────────────────────────────────────

describe("SubscriptionAdminService.auditTrailPeekBatch", () => {
  test("certifies raw action strings onto canonical members and renames createdAt to at", async () => {
    const at = new Date("2026-02-02T00:00:00.000Z");
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async () =>
          new Map<number, AuditTrailLatestEntryRow | null>([
            [11, makeLatestRow({ entityId: 11, actionType: "override", createdAt: at })],
          ])
      )
    );

    const peekById = await SubscriptionAdminService.auditTrailPeekBatch([11]);

    expect(peekById.get(11)).toEqual({ actionType: AuditActionType.Override, at });
  });

  test("passes the honest null through for rows with no history", async () => {
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async () =>
          new Map<number, AuditTrailLatestEntryRow | null>([
            [11, makeLatestRow()],
            [12, null],
          ])
      )
    );

    const peekById = await SubscriptionAdminService.auditTrailPeekBatch([11, 12]);

    expect(peekById.get(11)).not.toBeNull();
    expect(peekById.get(12)).toBeNull();
  });

  test("withholds an uncertifiable action string as null with exactly one bounded domain log", async () => {
    const logSpy = trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async () =>
          new Map<number, AuditTrailLatestEntryRow | null>([
            [11, makeLatestRow({ entityId: 11, actionType: "create" })],
            [12, makeLatestRow({ entityId: 12, actionType: "hacked" })],
            [13, makeLatestRow({ entityId: 13, actionType: "suspend" })],
          ])
      )
    );

    const peekById = await SubscriptionAdminService.auditTrailPeekBatch([11, 12, 13]);

    expect(peekById.get(11)).toEqual({ actionType: AuditActionType.Create, at: NOW });
    // The uncertifiable literal surfaces as the honest null — never a junk
    // value — and the certified siblings are unaffected.
    expect(peekById.get(12)).toBeNull();
    expect(peekById.get(13)).toEqual({ actionType: AuditActionType.Suspend, at: NOW });
    expect(logSpy.mock.calls).toHaveLength(1);
    const [message, ctxArg] = logSpy.mock.calls[0] ?? [];
    expect(message).toBe("Subscription audit peek withheld: uncertifiable action type in the trail");
    expect(ctxArg).toMatchObject({ code: "VALIDATION", subscriptionId: 12 });
  });

  test("assembly stays stable under repository map-order randomization", async () => {
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async () =>
          new Map<number, AuditTrailLatestEntryRow | null>([
            [31, makeLatestRow({ entityId: 31, actionType: "reactivate" })],
            [11, makeLatestRow({ entityId: 11, actionType: "adjust" })],
            [21, makeLatestRow({ entityId: 21, actionType: "delete" })],
          ])
      )
    );

    const peekById = await SubscriptionAdminService.auditTrailPeekBatch([11, 21, 31]);

    expect(peekById.get(11)).toEqual({ actionType: AuditActionType.Adjust, at: NOW });
    expect(peekById.get(21)).toEqual({ actionType: AuditActionType.Delete, at: NOW });
    expect(peekById.get(31)).toEqual({ actionType: AuditActionType.Reactivate, at: NOW });
  });

  test("propagates a repository failure unchanged (same error identity)", async () => {
    const failure = new DomainError("AUDIT_READ_FAILED", "boom");
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(async () =>
        Promise.reject(failure)
      )
    );

    let caught: unknown = null;
    try {
      await SubscriptionAdminService.auditTrailPeekBatch([11]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });
});

// ─── enrichSubscriptionRows (the page-level enrichment pass) ────────────────

describe("SubscriptionAdminService.enrichSubscriptionRows — call-count lock", () => {
  test("issues EXACTLY ONE plan, count, and peek batch per page at size 1", async () => {
    const row = makeReturnRow({ id: 11, planId: 101 });
    const planRow = makePlanRow({ id: 101 });
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([planRow], () => 2);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows([row]);

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    expect(enriched[0]?.plan).toBe(planRow);
    expect(enriched[0]?.auditEntriesCount).toBe(2);
    expect(enriched[0]?.auditTrailPeek).toEqual({ actionType: AuditActionType.Create, at: NOW });
  });

  test("issues EXACTLY ONE batch per read at size 25 with duplicate plan ids collapsed", async () => {
    const rows = buildPage(25, 7);
    const plans = Array.from({ length: 7 }, (_, index) => makePlanRow({ id: 101 + index }));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches(plans, () => 1);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows(rows);

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    // 25 rows over 7 distinct plans → the plan batch carries the DISTINCT 7.
    const [planIds] = planSpy.mock.calls[0] ?? [];
    expect(planIds).toEqual([101, 102, 103, 104, 105, 106, 107]);
    expect(enriched).toHaveLength(25);
  });

  test("issues EXACTLY ONE batch per read at size 100 — the count stays page-size-independent", async () => {
    const rows = buildPage(100, 7);
    const plans = Array.from({ length: 7 }, (_, index) => makePlanRow({ id: 101 + index }));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches(plans, id => id);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows(rows);

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    const [, subscriptionIds] = countSpy.mock.calls[0] ?? [];
    expect(subscriptionIds).toHaveLength(100);
    expect(enriched).toHaveLength(100);
    expect(enriched[42]?.auditEntriesCount).toBe(43);
  });

  test("a 1001-row page still batches EXACTLY ONCE per read (chunking stays below the seam)", async () => {
    const rows = buildPage(1001, 40);
    const plans = Array.from({ length: 40 }, (_, index) => makePlanRow({ id: 101 + index }));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches(plans, () => 0);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows(rows);

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    expect(enriched).toHaveLength(1001);
  });
});

describe("SubscriptionAdminService.enrichSubscriptionRows — assembly", () => {
  test("enriches onto row COPIES — source rows untouched, exactly three fields attached", async () => {
    const row = makeReturnRow({ id: 11, planId: 101 });
    const planRow = makePlanRow({ id: 101 });
    stubEnrichmentBatches([planRow], () => 4);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows([row]);

    const sourceKeys = Object.keys(row);
    const enrichedKeys = Object.keys(enriched[0] ?? {});
    const expectedKeys = [...new Set([...sourceKeys, "plan", "auditEntriesCount", "auditTrailPeek"])].toSorted((a, b) =>
      a.localeCompare(b)
    );
    expect(expectedKeys).toEqual(enrichedKeys.toSorted((a, b) => a.localeCompare(b)));
    // The source row object is never mutated.
    expect(Object.hasOwn(row, "plan")).toBe(false);
    expect(Object.hasOwn(row, "auditEntriesCount")).toBe(false);
    expect(Object.hasOwn(row, "auditTrailPeek")).toBe(false);
    // Row fields survive the copy verbatim.
    expect(enriched[0]?.id).toBe(11);
    expect(enriched[0]?.status).toBe(SubscriptionStatus.Active);
  });

  test("answers missing plans with the null value on every row (never an absent key)", async () => {
    const rows = [makeReturnRow({ id: 11, planId: 101 }), makeReturnRow({ id: 12, planId: 999 })];
    const planRow = makePlanRow({ id: 101 });
    stubEnrichmentBatches([planRow], () => 1);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows(rows);

    expect(enriched[0]?.plan).toBe(planRow);
    expect(enriched[1]?.plan).toBeNull();
    expect(enriched[1]?.auditEntriesCount).toBe(1);
    expect(enriched[1]?.auditTrailPeek).toEqual({ actionType: AuditActionType.Create, at: NOW });
  });

  test("an empty page enriches nothing — zero batch reads", async () => {
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([], () => 0);

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows([]);

    expect(enriched).toEqual([]);
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("carries the caller's executor to the plan batch by identity (audit batches stay bare)", async () => {
    const row = makeReturnRow({ id: 11, planId: 101 });
    const executor = sentinelExecutor();
    const { planSpy, countSpy } = stubEnrichmentBatches([], () => 0);
    try {
      await SubscriptionAdminService.enrichSubscriptionRows([row], "en", executor);

      const [, executorArg] = planSpy.mock.calls[0] ?? [];
      expect(executorArg).toBe(executor);
      // The audit twins read bare (no executor argument), exactly like
      // their single-row counterparts.
      const countArgs = countSpy.mock.calls[0] ?? [];
      expect(countArgs).toHaveLength(2);
    } finally {
      await executor.end();
    }
  });

  test("adversarial truncated maps degrade to the honest 0 and null", async () => {
    const rows = [makeReturnRow({ id: 11, planId: 101 }), makeReturnRow({ id: 12, planId: 101 })];
    const planRow = makePlanRow({ id: 101 });
    const planSpy = trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [planRow]));
    // A contract-violating seam: the maps omit some requested ids.
    trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(
        async () => new Map<number, number>([[11, 5]])
      )
    );
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(
        async () => new Map<number, AuditTrailLatestEntryRow | null>([[12, null]])
      )
    );

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows(rows);

    expect(planSpy.mock.calls).toHaveLength(1);
    expect(enriched[0]?.auditEntriesCount).toBe(5);
    expect(enriched[1]?.auditEntriesCount).toBe(0);
    expect(enriched[0]?.auditTrailPeek).toBeNull();
    expect(enriched[1]?.auditTrailPeek).toBeNull();
  });

  test("a hostile seam mutating a row mid-pass degrades that row's plan to null instead of crashing", async () => {
    const row = makeReturnRow({ id: 11, planId: 101 });
    const planRow = makePlanRow({ id: 101 });
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [planRow]));
    trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(
        async () => new Map<number, number>([[11, 1]])
      )
    );
    // The peek read mutates the row's planId between the plan-batch id
    // snapshot and the assembly — the foreign id misses the plan map and
    // the row must degrade to the honest null, never crash.
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(async () => {
        row.planId = 999;
        return new Map<number, AuditTrailLatestEntryRow | null>([[11, makeLatestRow()]]);
      })
    );

    const enriched = await SubscriptionAdminService.enrichSubscriptionRows([row]);

    expect(enriched[0]?.plan).toBeNull();
    expect(enriched[0]?.auditEntriesCount).toBe(1);
    expect(enriched[0]?.auditTrailPeek).toEqual({ actionType: AuditActionType.Create, at: NOW });
  });

  test("a mid-batch repository failure propagates unchanged and skips the later batches", async () => {
    const row = makeReturnRow({ id: 11, planId: 101 });
    const failure = new ConflictError("AUDIT_COUNT_FAILED");
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [makePlanRow({ id: 101 })]));
    trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(async () => Promise.reject(failure))
    );
    const peekSpy = trackSpy(spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds"));

    let caught: unknown = null;
    try {
      await SubscriptionAdminService.enrichSubscriptionRows([row]);
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(failure);
    expect(peekSpy).not.toHaveBeenCalled();
  });
});

// ─── listForAdmin (the enriched admin producer) ─────────────────────────────

describe("SubscriptionAdminService.listForAdmin — enriched admin read surface", () => {
  const ADMIN_ID = 42;

  /** Stubs the gate to pass for the fixture admin actor. */
  function stubAdminGate() {
    return trackSpy(
      spyOn(UserRepository, "findById").mockImplementation(async () => makeUserRow({ id: ADMIN_ID, role: "admin" }))
    );
  }

  test("enriches the owner's page with plan, count, and peek in the locked batch counts", async () => {
    const gateSpy = stubAdminGate();
    const rawRows = [
      makeSubscriptionRow({ id: 11, planId: 101, paymentMethod: "paymob" }),
      makeSubscriptionRow({ id: 12, planId: 102, status: "pending", paymentMethod: null }),
    ];
    const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async () => rawRows));
    const planOne = makePlanRow({ id: 101 });
    const planTwo = makePlanRow({ id: 102, isActive: false });
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([planOne, planTwo], id => id * 2);

    const rows = await SubscriptionAdminService.listForAdmin(5001, ADMIN_ID, "en");

    // ONE of each read per page: gate, owner listing, plan batch, audit
    // count batch, audit peek batch.
    expect(gateSpy.mock.calls).toHaveLength(1);
    expect(listSpy.mock.calls).toHaveLength(1);
    expect(planSpy.mock.calls).toHaveLength(1);
    expect(countSpy.mock.calls).toHaveLength(1);
    expect(peekSpy.mock.calls).toHaveLength(1);
    // BOPLA: the batches carry ONLY ids already present on the authorized
    // page rows.
    const [, countIds] = countSpy.mock.calls[0] ?? [];
    expect(countIds).toEqual([11, 12]);
    const [planIds] = planSpy.mock.calls[0] ?? [];
    expect(planIds).toEqual([101, 102]);

    // Row mapping + enrichment: certified enums, attached plan (the
    // deactivated plan enriches historical rows too), per-row count/peek.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.status).toBe(SubscriptionStatus.Active);
    expect(rows[0]?.paymentMethod).toBe(PaymentGateway.Paymob);
    expect(rows[0]?.plan).toBe(planOne);
    expect(rows[0]?.auditEntriesCount).toBe(22);
    expect(rows[1]?.status).toBe(SubscriptionStatus.Pending);
    expect(rows[1]?.plan).toBe(planTwo);
    expect(rows[1]?.auditEntriesCount).toBe(24);
    expect(rows[1]?.auditTrailPeek).toEqual({ actionType: AuditActionType.Create, at: NOW });
  });

  test("answers a well-formed unknown owner with the indistinguishable empty list and ZERO batch reads", async () => {
    stubAdminGate();
    trackSpy(spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async () => []));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([], () => 0);

    const rows = await SubscriptionAdminService.listForAdmin(99999999, ADMIN_ID, "en");

    expect(rows).toEqual([]);
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("denies a non-admin actor BEFORE any read or enrichment (zero-touch)", async () => {
    trackSpy(spyOn(UserRepository, "findById").mockImplementation(async () => makeUserRow({ id: 7, role: "student" })));
    const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId"));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([], () => 0);

    let caught: unknown = null;
    try {
      await SubscriptionAdminService.listForAdmin(5001, 7, "en");
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ForbiddenError);
    expect(rejectionMessage(caught)).toBe(t("en").forbidden);
    expect(listSpy).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("denies an anonymous actor with UNAUTHORIZED and zero reads", async () => {
    const gateSpy = trackSpy(spyOn(UserRepository, "findById"));
    const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId"));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([], () => 0);

    let caught: unknown = null;
    try {
      await SubscriptionAdminService.listForAdmin(5001, 0, "en");
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(UnauthorizedError);
    expect(rejectionMessage(caught)).toBe(t("en").unauthorized);
    expect(gateSpy).not.toHaveBeenCalled();
    expect(listSpy).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("denies malformed owner ids with the localized VALIDATION denial and zero batch reads", async () => {
    trackSpy(spyOn(logger, "logDomainError").mockImplementation(() => {}));
    stubAdminGate();
    const listSpy = trackSpy(spyOn(SubscriptionRepository, "listByUserId"));
    const { planSpy, countSpy, peekSpy } = stubEnrichmentBatches([], () => 0);

    const caughtPerPage = await Promise.all(
      [Number.NaN, 0, 2.5, -3].map(async malformed => {
        try {
          await SubscriptionAdminService.listForAdmin(malformed, ADMIN_ID, "ar");
          return null;
        } catch (error: unknown) {
          return error;
        }
      })
    );
    for (const caught of caughtPerPage) {
      expect(caught).toBeInstanceOf(ValidationError);
      expect(rejectionMessage(caught)).toBe(t("ar").badRequest);
    }

    // The localized denial resolves distinctly per locale — the message is
    // never a raw key.
    expect(t("ar").badRequest).not.toBe(t("en").badRequest);
    expect(listSpy).not.toHaveBeenCalled();
    expect(planSpy).not.toHaveBeenCalled();
    expect(countSpy).not.toHaveBeenCalled();
    expect(peekSpy).not.toHaveBeenCalled();
  });

  test("keeps concurrent interleaved pages isolated with per-page batch counts", async () => {
    stubAdminGate();
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
        userId === 5001 ? rowsA : rowsB
      )
    );
    const planA = makePlanRow({ id: 101, title: "A" });
    const planB = makePlanRow({ id: 201, title: "B" });
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
              makeLatestRow({ entityId: id, actionType: id < 20 ? "create" : "suspend" }),
            ])
          )
      )
    );

    const results = await Promise.allSettled([
      SubscriptionAdminService.listForAdmin(5001, ADMIN_ID, "en"),
      SubscriptionAdminService.listForAdmin(6001, ADMIN_ID, "en"),
    ]);

    expect(results.every(result => result.status === "fulfilled")).toBe(true);
    const pageA = results[0];
    const pageB = results[1];
    if (pageA?.status !== "fulfilled" || pageB?.status !== "fulfilled") {
      throw new Error("both concurrent pages should fulfill");
    }
    // Page A: only owner 5001's rows, plan A, count 3, create teaser.
    expect(pageA.value.map(row => row.id)).toEqual([11, 12]);
    expect(pageA.value.every(row => row.plan === planA)).toBe(true);
    expect(pageA.value.every(row => row.auditEntriesCount === 3)).toBe(true);
    expect(pageA.value.every(row => row.auditTrailPeek?.actionType === AuditActionType.Create)).toBe(true);
    // Page B: only owner 6001's rows, plan B, count 5, suspend teaser.
    expect(pageB.value.map(row => row.id)).toEqual([21, 22]);
    expect(pageB.value.every(row => row.plan === planB)).toBe(true);
    expect(pageB.value.every(row => row.auditEntriesCount === 5)).toBe(true);
    expect(pageB.value.every(row => row.auditTrailPeek?.actionType === AuditActionType.Suspend)).toBe(true);
    // Two pages, two of each read — never per-row.
    expect(listSpy.mock.calls).toHaveLength(2);
    expect(planSpy.mock.calls).toHaveLength(2);
    expect(countSpy.mock.calls).toHaveLength(2);
    expect(peekSpy.mock.calls).toHaveLength(2);
  });

  test("propagates an enrichment failure to the caller unchanged", async () => {
    stubAdminGate();
    trackSpy(
      spyOn(SubscriptionRepository, "listByUserId").mockImplementation(async () => [
        makeSubscriptionRow({ id: 11, planId: 101 }),
      ])
    );
    const failure = new DomainError("AUDIT_PEEK_FAILED", "boom");
    trackSpy(spyOn(PlanRepository, "findByIds").mockImplementation(async () => [makePlanRow({ id: 101 })]));
    trackSpy(
      spyOn(AuditTrailRepository, "countEntriesByEntityIds").mockImplementation(
        async () => new Map<number, number>([[11, 1]])
      )
    );
    trackSpy(
      spyOn(AuditTrailRepository, "listLatestEntriesByEntityIds").mockImplementation(async () =>
        Promise.reject(failure)
      )
    );

    let caught: unknown = null;
    try {
      await SubscriptionAdminService.listForAdmin(5001, ADMIN_ID, "en");
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBe(failure);
  });
});
