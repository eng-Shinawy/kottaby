/**
 * NotificationEngine — INBOX surface tests (Task 2.7; the emit surface is
 * Task 2.6's `notification-engine.emit.test.ts`).
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - 4-Tier mixed suite. DB-bound cases run inside `runInRollback` with `tx`
 *    passed to EVERY engine call (the non-tx `queryDb` fast path cannot run
 *    inside a rolled-back transaction — the transactional branch is the one
 *    exercised here, same as the emit suite's caller-transaction tier).
 *  - Fixtures are created ONLY via `entity-setup.ts` (`createTestUser`) and
 *    direct multi-row inserts — never the engine's own emit surface (setup
 *    must not depend on the sibling surface under assertion).
 *  - All rejection assertions use try/catch helpers (`expectRepoError`) on
 *    translated substrings — `expect(...).rejects.toThrow()` appears nowhere.
 *  - Domain-rejection logs are captured via a `logger.logDomainError` spy
 *    (silenced + recorded), restored with `mockRestore`.
 *
 * Coverage map (tasks.md 2.7.TE):
 *  - Tier 1: list filters × pagination coherence — `items` / `totalCount` /
 *    `hasMore` in exact agreement with a direct-count oracle per REQ-026;
 *    mark-one and mark-all happy paths (content preserved, affected counts).
 *  - Tier 2: pagination bounds (limit 1/50 accepted; 0/51/fractional/NaN
 *    rejected pre-DB); the documented runtime defaults (limit 20, offset 0
 *    when the window is absent or null); empty-inbox page shape; empty-set
 *    mark-all reporting 0.
 *  - Tier 3: idempotent double mark (byte-identical row, zero drift);
 *    mark-all interleaved with an emit — the newly emitted row stays unread
 *    (user-favorable direction); 25-way `Promise.allSettled` mark storms
 *    all-fulfilled with a consistent final state (REQ-044).
 *  - Tier 4: a foreign id and a nonexistent id are INDISTINGUISHABLE —
 *    `NOTIFICATION_NOT_FOUND` with a byte-identical translated message, the
 *    owner's row byte-identical after every probe, one structured domain log
 *    per denial; invalid-format ids fail closed BEFORE the database
 *    (`VALIDATION`, never `NOTIFICATION_NOT_FOUND`).
 */
import { describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, count, desc, eq, type SQL, sql } from "drizzle-orm";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  DBTransaction,
  NotificationEmitInput,
  NotificationInsertType,
  NotificationListFilterInput,
  NotificationReturnType,
  NotificationSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/** English translated error copy — assertions pin translated substrings, never hardcoded English. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Translated generic validation copy (flat errors-namespace key). */
const EN_VALIDATION = EN_ERRORS.validation;

/** Translated notification not-found copy (flat errors-namespace key). */
const EN_NOTIFICATION_NOT_FOUND = EN_ERRORS.notificationNotFound;

/**
 * Standard five-row fixture for one recipient, seeded oldest-first (the LAST
 * spec is the newest row):
 *   Notice 1: SessionRequest       unread
 *   Notice 2: SessionRequest       read
 *   Notice 3: SystemBroadcast      unread
 *   Notice 4: SystemBroadcast      read
 *   Notice 5: PaymentConfirmation  unread  (newest)
 */
const FILTER_FIXTURE: readonly RowSpec[] = [
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: true },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: true },
  { type: NotificationType.PaymentConfirmation, isRead: false },
];

/**
 * Eight-row storm fixture — two kinds × mixed read states so the concurrent
 * mark storm mixes type-scoped sweeps, unscoped sweeps, and single marks.
 */
const STORM_FIXTURE: readonly RowSpec[] = [
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: true },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: true },
];

/** Requested shape of one seeded row — defaults keep every list deterministic. */
interface RowSpec {
  readonly type: NotificationType;
  readonly isRead?: boolean;
  /**
   * Minutes subtracted from "now". Defaults to descending-from-now by spec
   * index so specs read oldest-first — the LAST spec is the newest row.
   */
  readonly minutesAgo?: number;
}

/** Optional conjunctive filters for the oracle reads (null/undefined = no filter). */
interface OracleFilters {
  readonly type?: NotificationType | null;
  readonly isRead?: boolean | null;
}

/**
 * Builds a statically-typed filter whose page-window fields carry runtime
 * `undefined`/`null` values — the GraphQL nullable-Int shape plus the
 * field-omitted shape (for the engine's `??` defaults an explicit `undefined`
 * behaves exactly like an absent field). `Object.assign` keeps the base
 * typed as `NotificationListFilterInput` while overwriting the window — no
 * type casts (the BOPLA-probe pattern from the registration suite).
 */
function runtimeWindowFilter(window: {
  readonly limit?: unknown;
  readonly offset?: unknown;
}): NotificationListFilterInput {
  const filter: NotificationListFilterInput = { limit: 20, offset: 0 };
  Object.assign(filter, window);
  return filter;
}

/**
 * Builds a statically-typed filter carrying hostile RUNTIME field values —
 * `Object.assign` overwrites typed fields with values the type system would
 * never accept, so the engine's fail-closed guards are exercised against
 * transport-layer tampering without any type assertion.
 */
function hostileFilter(extras: Record<string, unknown>): NotificationListFilterInput {
  const filter: NotificationListFilterInput = { limit: 20, offset: 0 };
  Object.assign(filter, extras);
  return filter;
}

/** Builds insert payloads for one recipient from row specs — setup data only. */
function buildInserts(userId: number, specs: readonly RowSpec[]): NotificationInsertType[] {
  const now = Date.now();
  return specs.map((spec, i) => ({
    userId,
    type: spec.type,
    title: `Notice ${i + 1}`,
    body: `Body ${i + 1}`,
    isRead: spec.isRead ?? false,
    relatedEntityType: "session",
    relatedEntityId: 9000 + i,
    createdAt: new Date(now - (spec.minutesAgo ?? specs.length - 1 - i) * 60_000),
  }));
}

/**
 * Seeds rows with a direct multi-row insert (never the engine's emit surface)
 * and returns the persisted rows in input (oldest-first) order.
 */
async function seedRows(
  tx: DBTransaction,
  inserts: readonly NotificationInsertType[]
): Promise<NotificationSelectType[]> {
  return tx
    .insert(notifications)
    .values([...inserts])
    .returning();
}

/** Oracle WHERE conditions for one user's rows under optional conjunctive filters. */
function oracleConditions(userId: number, filters: OracleFilters): SQL[] {
  const conditions: SQL[] = [eq(notifications.userId, userId)];
  if (filters.type != null) {
    conditions.push(eq(notifications.type, filters.type));
  }
  if (filters.isRead != null) {
    conditions.push(eq(notifications.isRead, filters.isRead));
  }
  return conditions;
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx,
 * newest first (`created_at DESC, id DESC`), never routed through the engine.
 */
async function readUserRows(
  tx: DBTransaction,
  userId: number,
  filters: OracleFilters = {}
): Promise<NotificationSelectType[]> {
  return tx
    .select()
    .from(notifications)
    .where(and(...oracleConditions(userId, filters)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

/** Independent filtered count oracle — direct Drizzle count, never the engine. */
async function countUserRows(tx: DBTransaction, userId: number, filters: OracleFilters = {}): Promise<number> {
  const [row] = await tx
    .select({ value: count() })
    .from(notifications)
    .where(and(...oracleConditions(userId, filters)));
  return row?.value ?? 0;
}

/** The seeded row at `index` — throws when the fixture is unexpectedly short. */
function rowAt(rows: readonly NotificationSelectType[], index: number): NotificationSelectType {
  const row = rows.at(index);
  if (!row) {
    throw new Error(`expected a seeded row at index ${index}`);
  }
  return row;
}

/**
 * Returns an integer id that cannot exist as a `notifications` row during
 * this transaction: anything above the current identity maximum (plus a
 * large offset no sequence reaches during a rolled-back test) is guaranteed
 * absent.
 */
async function absentNotificationId(tx: DBTransaction): Promise<number> {
  const [row] = await tx.select({ maxId: sql<number>`coalesce(max(${notifications.id}), 0)::int` }).from(notifications);
  return (row?.maxId ?? 0) + 1_000_000;
}

/** Builds a valid single-recipient emit input for the interleave cases. */
function emitInputFor(userId: number, title: string): NotificationEmitInput {
  return {
    userId,
    type: NotificationType.SessionRequest,
    title,
    body: null,
    relatedEntityType: null,
    relatedEntityId: null,
  };
}

/**
 * Installs a recording stub over `logger.logDomainError`: domain logs never
 * reach test stdout AND every call's code/entity pair becomes assertable.
 * Callers MUST `spy.mockRestore()` (try/finally).
 */
function recordDomainLogs(): { spy: ReturnType<typeof spyOn>; entries: Array<{ code: string; entity: string }> } {
  const entries: Array<{ code: string; entity: string }> = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    entries.push({ code: ctx?.code ?? "MISSING_CODE", entity: ctx?.entity ?? "MISSING_ENTITY" });
  });
  return { spy, entries };
}

/**
 * Sequential index-recursive rejection sweep (one statement at a time on the
 * shared tx — the repo's no-await-in-loop pattern): asserts every probe call
 * rejects with the translated generic `ValidationError` (class, message, and
 * code pinned).
 */
async function expectValidationErrorSweep(probes: readonly (() => Promise<unknown>)[], index = 0): Promise<void> {
  const probe = probes.at(index);
  if (probe === undefined) {
    return;
  }
  const error = await expectRepoError(probe);
  expect(error).toBeInstanceOf(ValidationError);
  expect(error.message).toBe(EN_VALIDATION);
  if (error instanceof ValidationError) {
    expect(error.code).toBe("VALIDATION");
  }
  await expectValidationErrorSweep(probes, index + 1);
}

// ─── Tier 1: filters × pagination coherence (REQ-026) ────────────────────────

describe("NotificationEngine.listMyNotifications — filter × pagination coherence (REQ-026)", () => {
  test("every filter combination keeps items, totalCount, and hasMore in exact agreement with the direct-count oracle", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const outsider = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE));
      // A foreign row that must stay invisible to every owner-scoped read.
      await seedRows(tx, buildInserts(outsider.id, [{ type: NotificationType.SystemBroadcast }]));

      const filterMatrix: readonly NotificationListFilterInput[] = [
        { limit: 20, offset: 0 },
        { type: NotificationType.SessionRequest, limit: 20, offset: 0 },
        { isRead: false, limit: 20, offset: 0 },
        { isRead: true, limit: 20, offset: 0 },
        { type: NotificationType.SystemBroadcast, isRead: true, limit: 20, offset: 0 },
        { type: null, isRead: null, limit: 20, offset: 0 },
      ];

      // Index-recursive coherence sweep — one statement at a time on the
      // shared tx (the repo's no-await-in-loop pattern).
      async function assertFilterCoherence(index: number): Promise<void> {
        const filter = filterMatrix.at(index);
        if (filter === undefined) {
          return;
        }
        const page = await NotificationEngine.listMyNotifications(owner.id, filter, "en", tx);
        const oracleRows = await readUserRows(tx, owner.id, filter);
        const oracleCount = await countUserRows(tx, owner.id, filter);

        // REQ-026 coherence: the SAME predicate feeds the listing and the count.
        expect(page.totalCount).toBe(oracleCount);
        expect(page.totalCount).toBe(oracleRows.length);
        expect(page.items.map(row => row.id)).toEqual(oracleRows.map(row => row.id));
        // The default window covers every fixture — no further page exists.
        expect(page.hasMore).toBe(false);
        await assertFilterCoherence(index + 1);
      }

      await assertFilterCoherence(0);

      // Cross-user invisibility: the owner never sees the outsider's row.
      const ownerAll = await NotificationEngine.listMyNotifications(owner.id, { limit: 20, offset: 0 }, "en", tx);
      expect(ownerAll.totalCount).toBe(5);
      const outsiderPage = await NotificationEngine.listMyNotifications(
        outsider.id,
        { limit: 20, offset: 0 },
        "en",
        tx
      );
      expect(outsiderPage.totalCount).toBe(1);
    });
  });

  test("windows slide without duplication or loss; ordering is createdAt DESC, id DESC", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 2).concat(FILTER_FIXTURE.slice(0, 5))));
      const oracleIds = (await readUserRows(tx, owner.id)).map(row => row.id);
      expect(oracleIds).toHaveLength(7);

      const firstPage = await NotificationEngine.listMyNotifications(owner.id, { limit: 3, offset: 0 }, "en", tx);
      expect(firstPage.items.map(row => row.id)).toEqual(oracleIds.slice(0, 3));
      expect(firstPage.totalCount).toBe(7);
      expect(firstPage.hasMore).toBe(true);

      const middlePage = await NotificationEngine.listMyNotifications(owner.id, { limit: 3, offset: 3 }, "en", tx);
      expect(middlePage.items.map(row => row.id)).toEqual(oracleIds.slice(3, 6));
      expect(middlePage.hasMore).toBe(true);

      const lastPage = await NotificationEngine.listMyNotifications(owner.id, { limit: 3, offset: 6 }, "en", tx);
      expect(lastPage.items.map(row => row.id)).toEqual(oracleIds.slice(6));
      expect(lastPage.hasMore).toBe(false);

      // Sliding past the end yields an empty window with the totals intact.
      const pastEnd = await NotificationEngine.listMyNotifications(owner.id, { limit: 3, offset: 7 }, "en", tx);
      expect(pastEnd.items).toEqual([]);
      expect(pastEnd.totalCount).toBe(7);
      expect(pastEnd.hasMore).toBe(false);
      const farPastEnd = await NotificationEngine.listMyNotifications(owner.id, { limit: 3, offset: 20 }, "en", tx);
      expect(farPastEnd.items).toEqual([]);
      expect(farPastEnd.hasMore).toBe(false);

      // Concatenated windows reproduce the full oracle listing exactly.
      const slidIds = [...firstPage.items, ...middlePage.items, ...lastPage.items].map(row => row.id);
      expect(slidIds).toEqual(oracleIds);
    });
  });
});

// ─── Tier 2: pagination bounds, defaults, empty inbox ────────────────────────

describe("NotificationEngine.listMyNotifications — pagination bounds, defaults, empty inbox", () => {
  test("limit boundaries 1 and 50 are accepted; out-of-range and non-integer limits reject pre-DB", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 2)));

      const minPage = await NotificationEngine.listMyNotifications(owner.id, { limit: 1, offset: 0 }, "en", tx);
      expect(minPage.items).toHaveLength(1);
      expect(minPage.totalCount).toBe(2);
      expect(minPage.hasMore).toBe(true);

      const maxPage = await NotificationEngine.listMyNotifications(owner.id, { limit: 50, offset: 0 }, "en", tx);
      expect(maxPage.items).toHaveLength(2);
      expect(maxPage.hasMore).toBe(false);

      const invalidLimits = [0, 51, 1.5, Number.NaN, 2 ** 53];
      await expectValidationErrorSweep(
        invalidLimits.map(
          limit => () => NotificationEngine.listMyNotifications(owner.id, { limit, offset: 0 }, "en", tx)
        )
      );
    });
  });

  test("negative and non-integer offsets reject pre-DB with the translated ValidationError", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 1)));

      const invalidOffsets = [-1, -0.5, 2.5, Number.NaN, 2 ** 53];
      await expectValidationErrorSweep(
        invalidOffsets.map(
          offset => () => NotificationEngine.listMyNotifications(owner.id, { limit: 20, offset }, "en", tx)
        )
      );
    });
  });

  test("an absent or null window falls back to the documented defaults (limit 20, offset 0)", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const twentyFiveSpecs: readonly RowSpec[] = Array.from({ length: 25 }, () => ({
        type: NotificationType.SystemBroadcast,
      }));
      await seedRows(tx, buildInserts(owner.id, twentyFiveSpecs));

      // Absent-window probes overwrite the base fields with undefined/null —
      // for the engine's `??` defaults an explicit undefined behaves exactly
      // like an absent field, and null is the GraphQL nullable-Int shape.
      const noLimit = await NotificationEngine.listMyNotifications(
        owner.id,
        runtimeWindowFilter({ limit: undefined, offset: 0 }),
        "en",
        tx
      );
      expect(noLimit.items).toHaveLength(20);
      expect(noLimit.totalCount).toBe(25);
      expect(noLimit.hasMore).toBe(true);

      // Null window fields (the GraphQL nullable-Int shape) hit the same defaults.
      const nullWindow = await NotificationEngine.listMyNotifications(
        owner.id,
        runtimeWindowFilter({ limit: null, offset: null }),
        "en",
        tx
      );
      expect(nullWindow.items).toHaveLength(20);
      expect(nullWindow.totalCount).toBe(25);
      expect(nullWindow.hasMore).toBe(true);
      expect(nullWindow.items.map(row => row.id)).toEqual(noLimit.items.map(row => row.id));

      // An undefined offset defaults to 0 — identical first page.
      const noOffset = await NotificationEngine.listMyNotifications(
        owner.id,
        runtimeWindowFilter({ limit: 20, offset: undefined }),
        "en",
        tx
      );
      expect(noOffset.items.map(row => row.id)).toEqual(noLimit.items.map(row => row.id));

      // The default window participates in pagination math: page 2 holds the rest.
      const secondPage = await NotificationEngine.listMyNotifications(
        owner.id,
        runtimeWindowFilter({ limit: undefined, offset: 20 }),
        "en",
        tx
      );
      expect(secondPage.items).toHaveLength(5);
      expect(secondPage.totalCount).toBe(25);
      expect(secondPage.hasMore).toBe(false);
    });
  });

  test("an empty inbox returns a structurally empty page, a zero badge, and a zero-affected mark-all", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);

      const page = await NotificationEngine.listMyNotifications(owner.id, { limit: 20, offset: 0 }, "en", tx);
      expect(page.items).toEqual([]);
      expect(page.totalCount).toBe(0);
      expect(page.hasMore).toBe(false);

      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
      expect(await NotificationEngine.markAllRead(owner.id, null, "en", tx)).toBe(0);
      expect(await NotificationEngine.markAllRead(owner.id, NotificationType.SystemBroadcast, "en", tx)).toBe(0);
    });
  });
});

// ─── Tier 1: unread badge + mark happy paths ─────────────────────────────────

describe("NotificationEngine.getMyUnreadCount — badge read", () => {
  test("counts exactly the caller's unread rows and tracks the read latch", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE));

      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(3);

      await NotificationEngine.markRead(owner.id, rowAt(seeded, 0).id, "en", tx);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(2);

      const affected = await NotificationEngine.markAllRead(owner.id, null, "en", tx);
      expect(affected).toBe(2);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
    });
  });
});

describe("NotificationEngine.markRead — happy path and idempotence", () => {
  test("marks one own row read and returns the full updated row with content preserved", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, [{ type: NotificationType.SessionRequest }]));
      const seededRow = rowAt(seeded, 0);

      const marked = await NotificationEngine.markRead(owner.id, seededRow.id, "en", tx);

      expect(marked).toEqual({ ...seededRow, isRead: true });
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
      expect(await countUserRows(tx, owner.id)).toBe(1);
    });
  });

  test("a repeated mark is idempotent: the same row returns byte-identical with zero drift", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, [{ type: NotificationType.PaymentConfirmation }]));
      const seededRow = rowAt(seeded, 0);

      const first = await NotificationEngine.markRead(owner.id, seededRow.id, "en", tx);
      const repeat = await NotificationEngine.markRead(owner.id, seededRow.id, "en", tx);

      expect(repeat).toEqual(first);
      expect(repeat.isRead).toBe(true);
      expect(await countUserRows(tx, owner.id)).toBe(1);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
    });
  });
});

describe("NotificationEngine.markAllRead — sweep semantics", () => {
  test("sweeps only the caller's unread rows; the type filter narrows the sweep; empty sets report 0", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const outsider = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(owner.id, [
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SessionRequest, isRead: true },
          { type: NotificationType.SystemBroadcast, isRead: false },
          { type: NotificationType.SystemBroadcast, isRead: false },
        ])
      );
      await seedRows(
        tx,
        buildInserts(outsider.id, [
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SystemBroadcast, isRead: false },
        ])
      );

      // Type-scoped sweep: exactly the 3 unread session rows flip.
      const sessionSweep = await NotificationEngine.markAllRead(owner.id, NotificationType.SessionRequest, "en", tx);
      expect(sessionSweep).toBe(3);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(2);
      expect(await countUserRows(tx, owner.id, { type: NotificationType.SessionRequest, isRead: true })).toBe(4);
      expect(await countUserRows(tx, owner.id, { type: NotificationType.SystemBroadcast, isRead: false })).toBe(2);

      // The sweep mutated ONLY the owner's rows — the outsider is untouched.
      expect(await NotificationEngine.getMyUnreadCount(outsider.id, "en", tx)).toBe(2);

      // Broadcast sweep: the remaining 2 flip; a repeat sweep reports 0.
      const broadcastSweep = await NotificationEngine.markAllRead(owner.id, NotificationType.SystemBroadcast, "en", tx);
      expect(broadcastSweep).toBe(2);
      const emptySweep = await NotificationEngine.markAllRead(owner.id, null, "en", tx);
      expect(emptySweep).toBe(0);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
      expect(await NotificationEngine.getMyUnreadCount(outsider.id, "en", tx)).toBe(2);
    });
  });
});

// ─── Tier 3: mark/emit interleave + the concurrent mark storm (REQ-044) ──────

describe("NotificationEngine — mark/emit interleave and the concurrent mark storm (REQ-044)", () => {
  test("a mark-all sweep interleaved with an emit leaves the newly emitted row unread (user-favorable)", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(owner.id, [
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SystemBroadcast, isRead: false },
          { type: NotificationType.PaymentConfirmation, isRead: false },
        ])
      );
      const emitTitle = `interleaved-${randomUUID()}`;

      // Both calls are issued concurrently on the caller's transaction; the
      // driver serializes them in submission order (the sweep's set-based
      // UPDATE runs to completion first), so the row inserted after the
      // sweep stays unread — the documented user-favorable direction.
      const outcomes = await Promise.allSettled([
        NotificationEngine.markAllRead(owner.id, null, "en", tx),
        NotificationEngine.emitForUser(emitInputFor(owner.id, emitTitle), "en", tx),
      ]);
      expect(outcomes[0]?.status).toBe("fulfilled");
      expect(outcomes[1]?.status).toBe("fulfilled");

      const rows = await readUserRows(tx, owner.id);
      expect(rows).toHaveLength(4);
      // The freshly emitted row is the newest and is STILL unread.
      expect(rows.at(0)?.title).toBe(emitTitle);
      expect(rows.at(0)?.isRead).toBe(false);
      // Every pre-existing row was swept read — no partial flips.
      expect(rows.slice(1).every(row => row.isRead)).toBe(true);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
    });
  });

  test("a sweep issued after the emit flips the new row too — never a partial flip", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(
        tx,
        buildInserts(owner.id, [
          { type: NotificationType.SessionRequest, isRead: false },
          { type: NotificationType.SystemBroadcast, isRead: false },
        ])
      );

      await NotificationEngine.emitForUser(emitInputFor(owner.id, `sequential-${randomUUID()}`), "en", tx);
      const affected = await NotificationEngine.markAllRead(owner.id, null, "en", tx);

      expect(affected).toBe(3);
      const rows = await readUserRows(tx, owner.id);
      expect(rows).toHaveLength(3);
      expect(rows.every(row => row.isRead)).toBe(true);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
    });
  });

  test("a 25-way concurrent mark storm settles all-fulfilled with a consistent final state", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, STORM_FIXTURE));
      expect(seeded).toHaveLength(8);

      const MARK_ONE_CALLS = 10;
      const TYPE_SCOPED_SWEEPS = 8;
      const UNSCOPED_SWEEPS = 7;

      const operations: Promise<NotificationReturnType | number>[] = [];
      // 10 single marks: every seeded row once, then two repeats (two-tab race).
      for (let i = 0; i < MARK_ONE_CALLS; i++) {
        operations.push(NotificationEngine.markRead(owner.id, rowAt(seeded, i % seeded.length).id, "en", tx));
      }
      // 8 type-scoped sweeps, alternating kinds.
      for (let i = 0; i < TYPE_SCOPED_SWEEPS; i++) {
        operations.push(
          NotificationEngine.markAllRead(
            owner.id,
            i % 2 === 0 ? NotificationType.SessionRequest : NotificationType.SystemBroadcast,
            "en",
            tx
          )
        );
      }
      // 7 unscoped sweeps.
      for (let i = 0; i < UNSCOPED_SWEEPS; i++) {
        operations.push(NotificationEngine.markAllRead(owner.id, null, "en", tx));
      }
      expect(operations).toHaveLength(25);

      const outcomes = await Promise.allSettled(operations);
      expect(outcomes).toHaveLength(25);
      for (const [index, outcome] of outcomes.entries()) {
        expect(outcome.status).toBe("fulfilled");
        if (outcome.status !== "fulfilled") {
          continue;
        }
        if (index < MARK_ONE_CALLS) {
          // Every single mark resolved to its own row, read.
          expect(outcome.value).toMatchObject({
            id: rowAt(seeded, index % seeded.length).id,
            isRead: true,
          });
        } else if (typeof outcome.value === "number") {
          // Every sweep resolved to an affected count.
          expect(outcome.value).toBeGreaterThanOrEqual(0);
        }
      }

      // Consistent final state: everything read, zero new rows, badge empty.
      const rows = await readUserRows(tx, owner.id);
      expect(rows).toHaveLength(8);
      expect(rows.every(row => row.isRead)).toBe(true);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
    });
  });
});

// ─── Tier 4: denial class (oracle-safe) ──────────────────────────────────────

describe("NotificationEngine.markRead — denial class (oracle-safe)", () => {
  test("a foreign id and a nonexistent id are indistinguishable: NOTIFICATION_NOT_FOUND, byte-identical message, one structured domain log each", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const attacker = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, [{ type: NotificationType.SessionRequest }]));
      const ownerRowId = rowAt(seeded, 0).id;
      const ghostId = await absentNotificationId(tx);
      const before = await tx.select().from(notifications).where(eq(notifications.id, ownerRowId));

      const logs = recordDomainLogs();
      try {
        const foreignError = await expectRepoError(() =>
          NotificationEngine.markRead(attacker.id, ownerRowId, "en", tx)
        );
        expect(foreignError).toBeInstanceOf(NotFoundError);
        expect(foreignError.message).toContain(EN_NOTIFICATION_NOT_FOUND);
        if (foreignError instanceof NotFoundError) {
          expect(foreignError.code).toBe("NOTIFICATION_NOT_FOUND");
        }

        const nonexistentError = await expectRepoError(() => NotificationEngine.markRead(owner.id, ghostId, "en", tx));
        expect(nonexistentError).toBeInstanceOf(NotFoundError);
        expect(nonexistentError.message).toContain(EN_NOTIFICATION_NOT_FOUND);
        if (nonexistentError instanceof NotFoundError) {
          expect(nonexistentError.code).toBe("NOTIFICATION_NOT_FOUND");
        }

        // Denial-shape constancy: foreign ≡ nonexistent, message byte-identical.
        expect(nonexistentError.message).toBe(foreignError.message);

        // One structured domain log per denial — ids/codes only.
        expect(logs.entries).toEqual([
          { code: "NOTIFICATION_NOT_FOUND", entity: "notifications" },
          { code: "NOTIFICATION_NOT_FOUND", entity: "notifications" },
        ]);
      } finally {
        logs.spy.mockRestore();
      }

      // Oracle: the owner's row is byte-identical; the attacker owns nothing.
      const after = await tx.select().from(notifications).where(eq(notifications.id, ownerRowId));
      expect(after).toEqual(before);
      expect(await countUserRows(tx, attacker.id)).toBe(0);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
    });
  });

  test("invalid-format ids fail closed BEFORE the database (VALIDATION, never NOT_FOUND)", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedRows(tx, buildInserts(owner.id, [{ type: NotificationType.SessionRequest }]));
      const validId = rowAt(seeded, 0).id;

      const invalidIds = [0, -7, 1.5, Number.NaN, 2 ** 53];
      await expectValidationErrorSweep(
        invalidIds.map(invalidId => () => NotificationEngine.markRead(owner.id, invalidId, "en", tx))
      );

      // The rejected probes mutated nothing; the valid id still marks fine.
      expect(await countUserRows(tx, owner.id)).toBe(1);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
      expect((await NotificationEngine.markRead(owner.id, validId, "en", tx)).isRead).toBe(true);
    });
  });
});

// ─── Input validation matrix (fail-closed, pre-DB) ───────────────────────────

describe("NotificationEngine inbox — input validation matrix (fail-closed, pre-DB)", () => {
  test("every inbox method rejects invalid caller ids with the translated generic ValidationError", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 1)));

      const invalidUserIds = [0, -3, 1.5, Number.NaN];
      await expectValidationErrorSweep(
        invalidUserIds.flatMap(invalidUserId => [
          () => NotificationEngine.listMyNotifications(invalidUserId, { limit: 20, offset: 0 }, "en", tx),
          () => NotificationEngine.getMyUnreadCount(invalidUserId, "en", tx),
          () => NotificationEngine.markRead(invalidUserId, 1, "en", tx),
          () => NotificationEngine.markAllRead(invalidUserId, null, "en", tx),
        ])
      );

      // The rejected probes mutated nothing.
      expect(await countUserRows(tx, owner.id)).toBe(1);
    });
  });

  test("hostile runtime filter values (type, isRead, limit, offset) reject pre-DB", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 1)));

      const hostileFilters: readonly NotificationListFilterInput[] = [
        hostileFilter({ type: "Session_Request" }),
        hostileFilter({ type: "session_request " }),
        hostileFilter({ type: 42 }),
        hostileFilter({ type: true }),
        hostileFilter({ isRead: "yes" }),
        hostileFilter({ isRead: 1 }),
        hostileFilter({ limit: "20" }),
        hostileFilter({ offset: "-1" }),
        hostileFilter({ limit: true }),
      ];

      await expectValidationErrorSweep(
        hostileFilters.map(filter => () => NotificationEngine.listMyNotifications(owner.id, filter, "en", tx))
      );

      // The rejected reads never mutated the row set.
      expect(await countUserRows(tx, owner.id)).toBe(1);
    });
  });

  test("markAllRead rejects hostile type values pre-DB", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedRows(tx, buildInserts(owner.id, FILTER_FIXTURE.slice(0, 1)));

      // Hostile runtime type values ride a typed property slot — `Object.assign`
      // overwrites the statically-valid `NotificationType | null` field with a
      // value the type system would never accept (no type casts).
      const hostileValues: readonly unknown[] = ["DROP TABLE notifications;--", 7];
      const hostileSlot: { type: NotificationType | null } = { type: null };
      await expectValidationErrorSweep(
        hostileValues.map(hostileValue => () => {
          Object.assign(hostileSlot, { type: hostileValue });
          return NotificationEngine.markAllRead(owner.id, hostileSlot.type, "en", tx);
        })
      );

      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
    });
  });
});
