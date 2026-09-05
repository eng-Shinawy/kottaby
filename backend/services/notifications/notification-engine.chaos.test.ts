/**
 * NotificationEngine — CHAOS / CONCURRENCY + FUZZ tier (Task 5.3; the emit
 * surface is Task 2.6's `notification-engine.emit.test.ts`, the inbox surface
 * Task 2.7's `notification-engine.inbox.test.ts`).
 *
 * Per `backend/db/test/AGENTS.md` + `backend/services/AGENTS.md`:
 *  - DB-bound cases run inside `runInRollback` with `tx` passed to EVERY
 *    engine call (the transactional branch is the exercised one). Concurrent
 *    waves on one tx are driver-serialized — the same concurrency model the
 *    inbox suite's 25-way mark storm established.
 *  - Storm fixtures are created ONLY via `entity-setup.ts` (`createTestUser`)
 *    and direct multi-row inserts — never the engine's own emit surface (the
 *    parallel-emit tests ARE the emit surface, so their fixtures are the
 *    users alone).
 *  - All rejection assertions use try/catch helpers (`expectRepoError`) —
 *    `expect(...).rejects.toThrow()` appears nowhere. Pre-DB validation
 *    probes reject BEFORE any tx access, so they sweep via `Promise.all`
 *    (the emit suite's validation-matrix pattern).
 *  - Every fixture title carries the `chaos-` marker prefix (this tier's
 *    convention — never `matrix-`).
 *
 * Coverage map (tasks.md 5.3, REQ-044/REQ-076):
 *  - CHAOS: a 25-way concurrent mark-one/mark-all storm (`Promise.allSettled`,
 *    same user) all-fulfilled with a consistent final state; observer list
 *    reads interleaved into the storm never observe row-set incoherence;
 *    parallel emit batches land the FULL row-set with per-batch createdAt
 *    batch-equality (ONE `now` per batch, REQ-047) and `createdAt DESC,
 *    id DESC` ordering — the id tiebreak deterministically orders a
 *    batch-equal timestamp group.
 *  - FUZZ: hostile ids (NaN/0/-1/2^53/floats/strings/infinities), hostile
 *    types (wrong enum shapes), hostile pagination windows (limit 51/0/-1,
 *    offset -5/…) → clean translated VALIDATION rejections, pre-DB, zero
 *    residue on the anchor row.
 *  - FUZZ (text): unicode/RTL/bidi/control-char and injection-shaped
 *    title/body payloads store as literal text — byte-exact round-trip
 *    through the list surface (REQ-015/028). The rendering half of the
 *    hostile-text contract is asserted by this tier's client counterpart,
 *    `test/ui/components/notification-realtime.test.tsx` (chaos describe).
 */
import { describe, expect, test } from "bun:test";
import { count, desc, eq } from "drizzle-orm";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { createTestUser } from "@/backend/db/test/entity-setup";
import { expectRepoError, runInRollback } from "@/backend/db/test/test-utils";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { ValidationError } from "@/backend/lib/errors";
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  DBTransaction,
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationEmitInput,
  NotificationInsertType,
  NotificationListFilterInput,
  NotificationListPageReturnType,
  NotificationReturnType,
  NotificationSelectType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import { SpiedFanoutTransport } from "@/test/workflows/helpers";

/** English translated generic validation copy — assertions pin translated copy, never hardcoded English. */
const EN_VALIDATION = getServerTranslations("en").errorsTranslations.validation;

/** Marker prefix every chaos-tier fixture carries (tier convention — never `matrix-`). */
const CHAOS_PREFIX = "chaos-";

/** A user id that cannot exist (positive safe int far beyond any sequence). */
const NONEXISTENT_RECIPIENT_ID = 2_000_000_000;

/** Union of every concurrent-wave outcome the chaos tier settles. */
type StormOutcome = NotificationReturnType | number | NotificationListPageReturnType;

/**
 * Twelve-row storm fixture — four kinds × mixed read states so the concurrent
 * mark storm mixes type-scoped sweeps, unscoped sweeps, and single marks over
 * a read-state-mixed inbox.
 */
const CHAOS_STORM_FIXTURE: readonly ChaosRowSpec[] = [
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: false },
  { type: NotificationType.SessionRequest, isRead: true },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: false },
  { type: NotificationType.SystemBroadcast, isRead: true },
  { type: NotificationType.PaymentConfirmation, isRead: false },
  { type: NotificationType.PaymentConfirmation, isRead: false },
  { type: NotificationType.PaymentConfirmation, isRead: true },
  { type: NotificationType.EvaluationResult, isRead: false },
];

/** Requested shape of one seeded row — defaults keep every storm deterministic. */
interface ChaosRowSpec {
  readonly type: NotificationType;
  readonly isRead?: boolean;
  /**
   * Minutes subtracted from "now". Defaults to descending-from-now by spec
   * index so specs read oldest-first — the LAST spec is the newest row.
   */
  readonly minutesAgo?: number;
}

/** Builds insert payloads for one recipient from row specs — setup data only. */
function buildChaosInserts(userId: number, specs: readonly ChaosRowSpec[]): NotificationInsertType[] {
  const now = Date.now();
  return specs.map((spec, i) => ({
    userId,
    type: spec.type,
    title: `${CHAOS_PREFIX}storm-${i + 1}`,
    body: `${CHAOS_PREFIX}storm-body-${i + 1}`,
    isRead: spec.isRead ?? false,
    relatedEntityType: "session",
    relatedEntityId: 7000 + i,
    createdAt: new Date(now - (spec.minutesAgo ?? specs.length - 1 - i) * 60_000),
  }));
}

/** Seeds rows with a direct multi-row insert (never the engine's emit surface). */
async function seedChaosRows(
  tx: DBTransaction,
  inserts: readonly NotificationInsertType[]
): Promise<NotificationSelectType[]> {
  return tx
    .insert(notifications)
    .values([...inserts])
    .returning();
}

/**
 * Independent read-back oracle — direct Drizzle select on the same tx,
 * newest first (`created_at DESC, id DESC`), never routed through the engine.
 */
async function readUserRows(tx: DBTransaction, userId: number): Promise<NotificationSelectType[]> {
  return tx
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

/** Independent count oracle — direct Drizzle count, never via the engine. */
async function countUserRows(tx: DBTransaction, userId: number): Promise<number> {
  const [row] = await tx.select({ value: count() }).from(notifications).where(eq(notifications.userId, userId));
  return row?.value ?? 0;
}

/** The receipt's representative first row — throws when the receipt is unexpectedly empty. */
function receiptRow(receipt: NotificationDeliveryReceipt): NotificationReturnType {
  const row = receipt.notifications.at(0);
  if (row === undefined) {
    throw new Error("expected the receipt to carry at least one row");
  }
  return row;
}

/**
 * Narrows the union emit result to a delivery receipt — every chaos-tier emit
 * runs on the caller-transaction path, which ALWAYS returns a receipt.
 */
function asReceipt(result: NotificationReturnType | NotificationDeliveryReceipt): NotificationDeliveryReceipt {
  if ("notifications" in result) {
    return result;
  }
  throw new Error("expected a delivery receipt from the caller-transaction emit path");
}

/** Builds a valid single-recipient emit input (chaos-marked title per index). */
function chaosSingleInput(userId: number, index: number): NotificationEmitInput {
  return {
    userId,
    type: NotificationType.SessionRequest,
    title: `${CHAOS_PREFIX}single-${index}`,
    body: `${CHAOS_PREFIX}single-body-${index}`,
    relatedEntityType: "session",
    relatedEntityId: 8100 + index,
  };
}

/** Builds a valid batch emit input (chaos-marked title per index). */
function chaosBatchInput(userIds: readonly number[], index: number): NotificationEmitBatchInput {
  return {
    userIds: [...userIds],
    type: NotificationType.SystemBroadcast,
    title: `${CHAOS_PREFIX}batch-${index}`,
    body: null,
    relatedEntityType: null,
    relatedEntityId: null,
  };
}

/**
 * Sweeps hostile probes through `expectRepoError` and pins EVERY rejection to
 * the translated generic `ValidationError` (class, message, code). The probes
 * are pre-DB fail-closed guards, so the fan-out never touches the shared tx —
 * the Promise.all sweep is safe (the emit suite's matrix pattern).
 */
async function expectValidationErrors(probes: readonly (() => Promise<unknown>)[]): Promise<void> {
  const errors = await Promise.all(probes.map(probe => expectRepoError(probe)));
  expect(errors).toHaveLength(probes.length);
  for (const error of errors) {
    expect(error).toBeInstanceOf(ValidationError);
    expect(error.message).toBe(EN_VALIDATION);
    if (error instanceof ValidationError) {
      expect(error.code).toBe("VALIDATION");
    }
  }
}

/**
 * Carries a hostile RUNTIME value through a statically-typed `number` slot —
 * `Object.assign` overwrites the typed field with a value the type system
 * would never accept (transport-layer tampering, no type casts).
 */
function tamperedId(hostileValue: unknown): number {
  const slot: { id: number } = { id: 1 };
  Object.assign(slot, { id: hostileValue });
  return slot.id;
}

/**
 * Carries a hostile RUNTIME value through a statically-typed optional
 * `NotificationType | null` slot (the markAllRead / emit type field).
 */
function tamperedType(hostileValue: unknown): NotificationType | null {
  const slot: { type: NotificationType | null } = { type: null };
  Object.assign(slot, { type: hostileValue });
  return slot.type;
}

/**
 * A list filter whose fields carry hostile RUNTIME values — built by
 * overwriting a statically-typed base one tampered field at a time (no type
 * casts; the transport-tampering shape the fail-closed guards must survive).
 */
function tamperedFilter(tamper: Readonly<Record<string, unknown>>): NotificationListFilterInput {
  const filter: NotificationListFilterInput = { limit: 20, offset: 0 };
  for (const [field, value] of Object.entries(tamper)) {
    Object.assign(filter, { [field]: value });
  }
  return filter;
}

/** A single-emit input overwritten with hostile RUNTIME field values (no type casts). */
function tamperedEmitInput(tamper: Readonly<Record<string, unknown>>): NotificationEmitInput {
  const input: NotificationEmitInput = {
    userId: NONEXISTENT_RECIPIENT_ID,
    type: NotificationType.SystemBroadcast,
    title: `${CHAOS_PREFIX}fuzz-title`,
    body: null,
    relatedEntityType: null,
    relatedEntityId: null,
  };
  Object.assign(input, tamper);
  return input;
}

/**
 * Index-recursive pairwise ordering check: `createdAt DESC` throughout, and
 * inside a byte-equal timestamp group the tiebreak is `id DESC` (the
 * deterministic orderer for batch-equal siblings).
 */
function assertNewestFirstPairwise(rows: readonly NotificationReturnType[], index = 0): void {
  const current = rows.at(index);
  const next = rows.at(index + 1);
  if (current === undefined || next === undefined) {
    return;
  }
  expect(current.createdAt.getTime()).toBeGreaterThanOrEqual(next.createdAt.getTime());
  if (current.createdAt.getTime() === next.createdAt.getTime()) {
    expect(current.id).toBeGreaterThan(next.id);
  }
  assertNewestFirstPairwise(rows, index + 1);
}

/**
 * Index-recursive per-recipient sweep (the repo's no-await-in-loop pattern):
 * every recipient's engine listing byte-matches the independent newest-first
 * oracle and satisfies the pairwise ordering invariant.
 */
async function assertListingMatchesOracle(tx: DBTransaction, userIds: readonly number[], index = 0): Promise<void> {
  const userId = userIds.at(index);
  if (userId === undefined) {
    return;
  }
  const page = await NotificationEngine.listMyNotifications(userId, { limit: 50, offset: 0 }, "en", tx);
  const oracleRows = await readUserRows(tx, userId);
  expect(page.totalCount).toBe(oracleRows.length);
  expect(page.hasMore).toBe(false);
  expect(page.items.map(row => row.id)).toEqual(oracleRows.map(row => row.id));
  assertNewestFirstPairwise(page.items, 0);
  await assertListingMatchesOracle(tx, userIds, index + 1);
}

/**
 * Exactly `length` code units of hostile title copy — BMP-only filler, so
 * code-unit slicing can never split a surrogate pair (a lone surrogate cannot
 * round-trip UTF-8 storage).
 */
function exactLengthTitle(prefix: string, length: number, filler: string): string {
  if (prefix.length >= length) {
    throw new Error("the bounded-title prefix must be shorter than the target length");
  }
  return (prefix + filler.repeat(length - prefix.length)).slice(0, length);
}

// ─── CHAOS: the concurrent mark storm (REQ-044) ──────────────────────────────

describe("NotificationEngine — concurrent mark storm (REQ-044)", () => {
  test("a 25-way concurrent mark-one/mark-all storm settles all-fulfilled with a consistent final state", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const seeded = await seedChaosRows(tx, buildChaosInserts(owner.id, CHAOS_STORM_FIXTURE));
      expect(seeded).toHaveLength(12);
      const seededTitles = seeded.map(row => row.title).toSorted((a, b) => a.localeCompare(b));

      // 12 single marks + 5 type-scoped sweeps + 8 unscoped sweeps = 25 mark
      // operations in one allSettled wave (the classified outcome counts
      // below pin the split at runtime).
      const SINGLE_MARKS = 12; // every seeded row exactly once (two-tab races add sweeps below)
      const TYPE_SCOPED_SWEEPS = 5; // rotating across five kinds
      const UNSCOPED_SWEEPS = 8;

      const STORM_SWEEP_TYPES: readonly NotificationType[] = [
        NotificationType.SessionRequest,
        NotificationType.SystemBroadcast,
        NotificationType.PaymentConfirmation,
        NotificationType.EvaluationResult,
        NotificationType.SessionCompletion,
      ];

      // One `Promise.allSettled` wave carries the 25 mark operations with
      // observer reads interleaved every fourth mark — the observers are NOT
      // part of the 25-way count; they prove readers serialized mid-storm
      // never observe an incoherent row set (marks never change cardinality).
      const storm: Promise<StormOutcome>[] = [];
      for (const [markIndex, seededRow] of seeded.entries()) {
        storm.push(NotificationEngine.markRead(owner.id, seededRow.id, "en", tx));
        if ((markIndex + 1) % 4 === 0) {
          storm.push(NotificationEngine.listMyNotifications(owner.id, { limit: 50, offset: 0 }, "en", tx));
        }
      }
      for (let sweepIndex = 0; sweepIndex < TYPE_SCOPED_SWEEPS; sweepIndex++) {
        const scopedType = STORM_SWEEP_TYPES.at(sweepIndex % STORM_SWEEP_TYPES.length);
        if (scopedType === undefined) {
          throw new Error("the storm type rotation is unexpectedly short");
        }
        storm.push(NotificationEngine.markAllRead(owner.id, scopedType, "en", tx));
      }
      for (let sweepIndex = 0; sweepIndex < UNSCOPED_SWEEPS; sweepIndex++) {
        storm.push(NotificationEngine.markAllRead(owner.id, null, "en", tx));
      }
      expect(storm).toHaveLength(SINGLE_MARKS + 3 + TYPE_SCOPED_SWEEPS + UNSCOPED_SWEEPS);

      const outcomes = await Promise.allSettled(storm);
      expect(outcomes).toHaveLength(storm.length);

      let singleMarkResults = 0;
      let sweepResults = 0;
      let observerResults = 0;
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
        if (outcome.status !== "fulfilled") {
          continue;
        }
        const value = outcome.value;
        if (typeof value === "number") {
          sweepResults += 1;
          expect(value).toBeGreaterThanOrEqual(0);
        } else if ("items" in value) {
          observerResults += 1;
          // Coherent page shape at EVERY serialization point: the full
          // 12-row set, counted exactly, no phantom next page.
          expect(value.totalCount).toBe(12);
          expect(value.items).toHaveLength(12);
          expect(value.hasMore).toBe(false);
        } else {
          singleMarkResults += 1;
          expect(value.isRead).toBe(true);
          expect(seededTitles).toContain(value.title);
        }
      }
      expect(singleMarkResults).toBe(SINGLE_MARKS);
      expect(sweepResults).toBe(TYPE_SCOPED_SWEEPS + UNSCOPED_SWEEPS);
      expect(observerResults).toBe(3);

      // Consistent final state: every row read, zero new rows, badge empty,
      // and the seeded content byte-preserved through the storm.
      const rows = await readUserRows(tx, owner.id);
      expect(rows).toHaveLength(12);
      expect(rows.every(row => row.isRead)).toBe(true);
      expect(rows.map(row => row.title).toSorted((a, b) => a.localeCompare(b))).toEqual(seededTitles);
      expect(await countUserRows(tx, owner.id)).toBe(12);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(0);
    });
  });
});

// ─── CHAOS: parallel emit batches ────────────────────────────────────────────

describe("NotificationEngine — parallel emit batches", () => {
  test("concurrent batch + single emits land the FULL row-set with per-batch createdAt batch-equality", async () => {
    await runInRollback(async tx => {
      const alpha = await createTestUser(tx);
      const beta = await createTestUser(tx);
      const gamma = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();
      const cohort: readonly number[] = [alpha.id, beta.id, gamma.id];

      const BATCH_EMITS = 4;
      const SINGLE_EMITS = 3;

      const wave: Promise<NotificationReturnType | NotificationDeliveryReceipt>[] = [];
      for (let batchIndex = 0; batchIndex < BATCH_EMITS; batchIndex++) {
        wave.push(
          NotificationEngine.emitForUsers(chaosBatchInput(cohort, batchIndex), "en", tx, { transport: transportSpy })
        );
      }
      for (let singleIndex = 0; singleIndex < SINGLE_EMITS; singleIndex++) {
        wave.push(
          NotificationEngine.emitForUser(chaosSingleInput(alpha.id, singleIndex), "en", tx, { transport: transportSpy })
        );
      }
      expect(wave).toHaveLength(BATCH_EMITS + SINGLE_EMITS);

      const outcomes = await Promise.allSettled(wave);
      for (const [index, outcome] of outcomes.entries()) {
        expect(outcome.status).toBe("fulfilled");
        if (outcome.status !== "fulfilled") {
          continue;
        }
        const receipt = asReceipt(outcome.value);
        if (index < BATCH_EMITS) {
          // Every batch receipt carries the FULL cohort, one row each.
          expect(receipt.recipientUserIds).toEqual([...cohort]);
          expect(receipt.notifications).toHaveLength(cohort.length);
          const recipientIds = receipt.notifications.map(row => row.userId).toSorted((a, b) => a - b);
          expect(recipientIds).toEqual([...cohort].toSorted((a, b) => a - b));
          // ONE `now` per batch (REQ-047): sibling rows share a byte-equal
          // createdAt and the identical verbatim copy.
          const batchTime = receiptRow(receipt).createdAt.getTime();
          for (const row of receipt.notifications) {
            expect(row.title).toBe(`${CHAOS_PREFIX}batch-${index}`);
            expect(row.body).toBeNull();
            expect(row.createdAt.getTime()).toBe(batchTime);
            expect(row.isRead).toBe(false);
          }
        } else {
          expect(receipt.recipientUserIds).toEqual([alpha.id]);
          expect(receipt.notifications).toHaveLength(1);
          expect(receiptRow(receipt).title).toBe(`${CHAOS_PREFIX}single-${index - BATCH_EMITS}`);
        }
      }

      // REQ-042: uncommitted rows are NEVER published — not even mid-storm.
      expect(transportSpy.publishCount).toBe(0);

      // Full row-set — nothing lost, nothing duplicated, nothing leaked
      // across recipients.
      expect(await countUserRows(tx, alpha.id)).toBe(BATCH_EMITS + SINGLE_EMITS);
      expect(await countUserRows(tx, beta.id)).toBe(BATCH_EMITS);
      expect(await countUserRows(tx, gamma.id)).toBe(BATCH_EMITS);
      const betaTitles = (await readUserRows(tx, beta.id)).map(row => row.title);
      expect(new Set(betaTitles).size).toBe(BATCH_EMITS);
      expect(betaTitles.every(title => title.startsWith(`${CHAOS_PREFIX}batch-`))).toBe(true);
    });
  });

  test("the settled inboxes list the parallel-emit rows newest-first with the id DESC tiebreak for batch-equal timestamps", async () => {
    await runInRollback(async tx => {
      const alpha = await createTestUser(tx);
      const beta = await createTestUser(tx);
      const BATCH_EMITS = 5;

      // Five concurrent batches over the same cohort — driver-serialized on
      // one tx, their `new` captures land within the same millisecond more
      // often than not, so the id DESC tiebreak is the live orderer.
      const wave: Promise<NotificationDeliveryReceipt>[] = [];
      for (let batchIndex = 0; batchIndex < BATCH_EMITS; batchIndex++) {
        wave.push(
          NotificationEngine.emitForUsers(chaosBatchInput([alpha.id, beta.id], batchIndex), "en", tx, {
            transport: new SpiedFanoutTransport(),
          })
        );
      }
      const outcomes = await Promise.allSettled(wave);
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }

      // Every recipient's engine listing byte-matches the newest-first oracle
      // (createdAt DESC, id DESC) and satisfies the pairwise invariant.
      await assertListingMatchesOracle(tx, [alpha.id, beta.id]);

      // Cross-recipient batch-equality: each batch's sibling rows (one per
      // recipient) share a byte-identical createdAt — ONE `now` per batch.
      const alphaTimesByTitle = new Map(
        (await readUserRows(tx, alpha.id)).map(row => [row.title, row.createdAt.getTime()])
      );
      expect(alphaTimesByTitle.size).toBe(BATCH_EMITS);
      for (const betaRow of await readUserRows(tx, beta.id)) {
        const alphaTime = alphaTimesByTitle.get(betaRow.title);
        if (alphaTime === undefined) {
          throw new Error("expected every batch sibling title to exist for both recipients");
        }
        expect(betaRow.createdAt.getTime()).toBe(alphaTime);
      }
    });
  });
});

// ─── FUZZ: hostile ids / types / pagination (fail-closed, pre-DB) ────────────

describe("NotificationEngine — hostile-input fuzz (fail-closed, pre-DB)", () => {
  test("hostile notification and caller ids (NaN/0/-1/2^53/floats/strings/infinities) reject as the translated ValidationError", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedChaosRows(tx, buildChaosInserts(owner.id, [{ type: NotificationType.SessionRequest }]));

      const HOSTILE_IDS: readonly unknown[] = [
        Number.NaN,
        0,
        -1,
        -0,
        1.5,
        2 ** 53,
        "7",
        "",
        Number.POSITIVE_INFINITY,
        Number.NEGATIVE_INFINITY,
      ];

      // Hostile NOTIFICATION ids against the mark-one surface.
      await expectValidationErrors(
        HOSTILE_IDS.map(hostileId => () => NotificationEngine.markRead(owner.id, tamperedId(hostileId), "en", tx))
      );

      // Hostile CALLER ids against every inbox entry point.
      await expectValidationErrors(
        HOSTILE_IDS.flatMap(hostileUserId => [
          () => NotificationEngine.listMyNotifications(tamperedId(hostileUserId), { limit: 20, offset: 0 }, "en", tx),
          () => NotificationEngine.getMyUnreadCount(tamperedId(hostileUserId), "en", tx),
          () => NotificationEngine.markAllRead(tamperedId(hostileUserId), null, "en", tx),
        ])
      );

      // Zero residue: the anchor row is untouched and still unread.
      expect(await countUserRows(tx, owner.id)).toBe(1);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
    });
  });

  test("hostile type values (wrong enum shapes) reject pre-DB across markAllRead, list filters, and emit inputs", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedChaosRows(tx, buildChaosInserts(owner.id, [{ type: NotificationType.SystemBroadcast }]));
      const transportSpy = new SpiedFanoutTransport();

      const HOSTILE_TYPES: readonly unknown[] = [
        "SessionRequest",
        "session_request ",
        "SESSION_REQUEST",
        "not_a_real_type",
        "DROP TABLE notifications;--",
        42,
        true,
        [],
        {},
      ];

      await expectValidationErrors(
        HOSTILE_TYPES.map(
          hostileType => () => NotificationEngine.markAllRead(owner.id, tamperedType(hostileType), "en", tx)
        )
      );
      await expectValidationErrors(
        HOSTILE_TYPES.map(
          hostileType => () =>
            NotificationEngine.listMyNotifications(owner.id, tamperedFilter({ type: hostileType }), "en", tx)
        )
      );
      await expectValidationErrors(
        HOSTILE_TYPES.map(
          hostileType => () =>
            NotificationEngine.emitForUser(tamperedEmitInput({ type: hostileType }), "en", tx, {
              transport: transportSpy,
            })
        )
      );

      // Zero residue: no rows, no publishes from any rejected probe.
      expect(await countUserRows(tx, owner.id)).toBe(1);
      expect(await NotificationEngine.getMyUnreadCount(owner.id, "en", tx)).toBe(1);
      expect(transportSpy.publishCount).toBe(0);
    });
  });

  test("hostile pagination windows (limit 51/0/-1, offset -5/…) reject pre-DB while the accepted bounds still read", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      await seedChaosRows(tx, buildChaosInserts(owner.id, [{ type: NotificationType.PaymentConfirmation }]));

      const HOSTILE_LIMITS: readonly unknown[] = [51, 0, -1, Number.NaN, 1.5, 2 ** 53, "50", Number.POSITIVE_INFINITY];
      const HOSTILE_OFFSETS: readonly unknown[] = [-5, -1, 2.5, Number.NaN, "0", Number.POSITIVE_INFINITY, 2 ** 53];

      await expectValidationErrors(
        HOSTILE_LIMITS.map(
          hostileLimit => () =>
            NotificationEngine.listMyNotifications(owner.id, tamperedFilter({ limit: hostileLimit }), "en", tx)
        )
      );
      await expectValidationErrors(
        HOSTILE_OFFSETS.map(
          hostileOffset => () =>
            NotificationEngine.listMyNotifications(owner.id, tamperedFilter({ offset: hostileOffset }), "en", tx)
        )
      );

      // Positive control: the accepted window bounds still read the anchor
      // row — the rejections above are window-specific, never a blanket ban.
      const boundedPage = await NotificationEngine.listMyNotifications(owner.id, { limit: 50, offset: 0 }, "en", tx);
      expect(boundedPage.totalCount).toBe(1);
      expect(boundedPage.items).toHaveLength(1);
      expect(boundedPage.hasMore).toBe(false);
      expect(await countUserRows(tx, owner.id)).toBe(1);
    });
  });
});

// ─── FUZZ: hostile-text storage (literal-text round-trip, REQ-015/028) ───────

describe("NotificationEngine — hostile-text storage fuzz (literal-text round-trip)", () => {
  test("unicode/RTL/bidi/control-char and injection-shaped payloads store verbatim — byte-exact round-trip via list", async () => {
    await runInRollback(async tx => {
      const owner = await createTestUser(tx);
      const transportSpy = new SpiedFanoutTransport();

      // Exactly 255 code units — the varchar(255) title bound, hostile-filled.
      const BOUNDED_HOSTILE_TITLE = exactLengthTitle(`${CHAOS_PREFIX}text-5-`, 255, "\u0645\u200B\u202E");
      expect(BOUNDED_HOSTILE_TITLE).toHaveLength(255);

      const HOSTILE_TEXTS: readonly {
        readonly type: NotificationType;
        readonly title: string;
        readonly body: string | null;
      }[] = [
        // Natural RTL text (Arabic) — direction is data, never mutation.
        {
          type: NotificationType.SessionRequest,
          title: `${CHAOS_PREFIX}text-0-rtl-طلب جلسة جديد`,
          body: "نص عربي داخل المتن",
        },
        // Bidi control marks + zero-width characters.
        {
          type: NotificationType.SystemBroadcast,
          title: `${CHAOS_PREFIX}text-1-bidi-\u202E\u200F\u200E\u200B\u202C`,
          body: "\u200B\uFEFF\u2060",
        },
        // Control characters — everything Postgres text accepts (U+0000 is a
        // documented engine-level storage impossibility, excluded by design).
        {
          type: NotificationType.PaymentConfirmation,
          title: `${CHAOS_PREFIX}text-2-ctrl-\u0001\u0007\u0008\u001B\u001F`,
          body: "line\ttab\u000B\u000Cend",
        },
        // Injection-shaped copy — stored verbatim, NEVER sanitized (REQ-028:
        // the defense is structural text-node rendering, asserted at the
        // component tier).
        {
          type: NotificationType.EvaluationResult,
          title: `${CHAOS_PREFIX}text-3-<script>alert('xss')</script>`,
          body: "'; DROP TABLE notifications;--",
        },
        // Astral-plane emoji + combining marks (surrogate pairs round-trip).
        {
          type: NotificationType.ParentLinkRequest,
          title: `${CHAOS_PREFIX}text-4-astral-\u{1F680}\u{1D11E}`,
          body: "e\u0301\u{1F926}\u200D\u2642",
        },
        // The full title bound, bidi-mixed.
        {
          type: NotificationType.SessionCompletion,
          title: BOUNDED_HOSTILE_TITLE,
          body: null,
        },
      ];

      // Concurrent emissions — the write path under load still copies every
      // payload verbatim (REQ-015).
      const outcomes = await Promise.allSettled(
        HOSTILE_TEXTS.map(payload =>
          NotificationEngine.emitForUser(
            {
              userId: owner.id,
              type: payload.type,
              title: payload.title,
              body: payload.body,
              relatedEntityType: null,
              relatedEntityId: null,
            },
            "en",
            tx,
            { transport: transportSpy }
          )
        )
      );
      for (const outcome of outcomes) {
        expect(outcome.status).toBe("fulfilled");
      }
      expect(transportSpy.publishCount).toBe(0);

      // Byte-exact round-trip THROUGH THE LIST SURFACE — the reader-facing
      // oracle the hostile-text contract pins.
      const page = await NotificationEngine.listMyNotifications(owner.id, { limit: 50, offset: 0 }, "en", tx);
      expect(page.totalCount).toBe(HOSTILE_TEXTS.length);
      const rowsByTitle = new Map(page.items.map(row => [row.title, row]));
      for (const payload of HOSTILE_TEXTS) {
        const row = rowsByTitle.get(payload.title);
        if (row === undefined) {
          throw new Error("expected the hostile payload to round-trip through the list surface");
        }
        expect(row.title).toBe(payload.title);
        expect(row.body).toBe(payload.body);
        expect(row.isRead).toBe(false);
      }

      // Oracle cross-check: the direct select carries the same literal bytes,
      // newest-first — no sanitized or reordered shadow copy.
      const oracleRows = await readUserRows(tx, owner.id);
      expect(oracleRows).toHaveLength(HOSTILE_TEXTS.length);
      expect(oracleRows.map(row => row.title).toSorted((a, b) => a.localeCompare(b))).toEqual(
        page.items.map(row => row.title).toSorted((a, b) => a.localeCompare(b))
      );
      expect(await countUserRows(tx, owner.id)).toBe(HOSTILE_TEXTS.length);
    });
  });
});
