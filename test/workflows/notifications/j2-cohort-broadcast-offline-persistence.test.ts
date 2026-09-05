/**
 * Journey J2 — Cohort Broadcast Fan-Out + Offline Persistence
 * (`system_broadcast` to a parent cohort).
 *
 * Cross-actor journey through the real notification engine against the real
 * test database: a test-invoked emitter fans one broadcast out to parents A/B
 * in a single batch (one multi-row insert, ONE realtime publish carrying both
 * recipient ids, one batch timestamp), parent B is offline when the publish
 * fires yet still finds the persisted row on first read, and only each owner
 * can observe or flip their own copy. Authored TEST-FIRST against the
 * engine's API surface (Tasks 2.6/2.7), which now ships; the
 * contract assumptions it encodes EXTEND Journey J1's (same journey layer,
 * same per-call options seam `{ transport, cache }` on the emit paths —
 * 2.2-outcome §3c — see the Task 2.3 outcome document) and are binding for
 * the engine's implementers.
 *
 * Step map (plan.md §4.5 J2 table — binding order):
 *   1. System: fixtures committed (parents A/B + teacher) → empty inboxes
 *   2. Emitter: `emitForUsers([A, B], system_broadcast, key)` → exactly 2 rows,
 *      identical batch `createdAt`, ONE spied publish carrying BOTH ids
 *   3. Parent A (online path): realtime payload shape valid; only A's copy addressable
 *   4. Parent B (offline): no per-user push beyond the single batch publish;
 *      row persisted `is_read=false`
 *   5. Parent B later: unread=1 → `markAllRead(system_broadcast)` → affected 1; badge 0
 *   6. Teacher (denial): inbox stays empty; foreign mark probes fail oracle-safely
 *   7. Emitter replays the SAME idempotency key → ZERO new rows, ZERO new publishes
 *   8. Emitter emits with a DIFFERENT key → fresh 2 rows, exactly one new publish
 *   9. Denial-class probes: nonexistent-id `markRead` is indistinguishable from
 *      the foreign-id probe (oracle safety); an invalid-format id fails closed pre-DB
 *
 * Anonymous-caller scope note (plan §4.5 J2 step 8 / REQ-032): "anonymous →
 * UNAUTHORIZED on every inbox op" is a GRAPHQL authScopes contract owned by
 * the resolver layer (Tasks 3.x + 5.1). At the service layer every inbox
 * method derives identity from its numeric `callerUserId` parameter — an
 * anonymous caller has no id to present, so there is no service-level
 * anonymous call to make. The service-scope denial probes below therefore pin
 * the oracle-safe NOT_FOUND class instead.
 *
 * Journey rules (test/workflows/AGENTS.md) honored:
 * - fixtures COMMITTED in `beforeAll` inside one committing transaction
 *   (commit-or-nothing) and hard-deleted in `afterAll` via `TrackedFixtures`
 *   with post-teardown existence checks (zero residue); never `runInRollback`;
 * - actors provisioned by the actor-context factory — REAL `users` rows plus
 *   REAL role-child rows, so every ownership/denial check resolves through the
 *   genuine path (never monkey-patched permissions);
 * - the fan-out transport is SPIED at the engine's per-call injection seam
 *   (`SpiedFanoutTransport`, the same seam J1 uses) and the idempotency claim
 *   cache is an in-memory stand-in injected the same way — no Redis, no
 *   WebSocket frames, ever;
 * - sequential actor-attributed steps in declaration order; every service call
 *   carries the acting user's real id;
 * - cross-actor visibility asserted both ways: each intended recipient sees
 *   their own copy, every other cast member observes no accidental fan-out,
 *   and denial probes fail oracle-safely while the owner's row stays
 *   byte-identical.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { notifications } from "@/backend/db/schema/notifications";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { NotFoundError, ValidationError } from "@/backend/lib/errors";
// RED until the engine service lands (Tasks 2.6/2.7 — emit + inbox surfaces):
import { NotificationEngine } from "@/backend/services/notifications/notification-engine.service";
import type {
  NotificationDeliveryReceipt,
  NotificationEmitBatchInput,
  NotificationListFilterInput,
  NotificationReturnType,
} from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  SpiedFanoutTransport,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix so repeated or parallel runs never collide. */
const runPrefix = `jrn_notifications_${randomUUID().slice(0, 8)}`;

/** First broadcast copy (carries the run prefix; title max 255 chars). */
const FIRST_BROADCAST_TITLE = `${runPrefix}: Ramadan evening schedule update`;
const FIRST_BROADCAST_BODY = `${runPrefix}: Evening class timings shift by 30 minutes next week.`;

/** Second broadcast copy (null body — pins the nullable-body projection). */
const SECOND_BROADCAST_TITLE = `${runPrefix}: Makeup classes posted`;

/** Idempotency keys — same-key replay (step 7) vs fresh-key emit (step 8). */
const FIRST_IDEMPOTENCY_KEY = `${runPrefix}-K`;
const SECOND_IDEMPOTENCY_KEY = `${runPrefix}-K-2`;

/** A notification id that cannot exist in the test database (positive safe int, far beyond any sequence). */
const NONEXISTENT_NOTIFICATION_ID = 2_000_000_000;

/** Shared inbox window — every unfiltered list read uses the same first page. */
const INBOX_PAGE: NotificationListFilterInput = { limit: 20, offset: 0 };

/** English translated error copy — denial assertions pin translated substrings, never hardcoded English. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Locale the test-invoked emitter resolves copy in (all cast actors default to "en"). */
const EMIT_LOCALE = "en";

/** One claim-cache entry: the claimed value plus its wall-clock expiry. */
interface ClaimEntry {
  readonly expiresAt: number;
  readonly value: string;
}

/**
 * In-memory SET-NX-EX claim cache — the journey's stand-in for the engine's
 * injected idempotency-claim port (Task 2.6), passed on every emit-path call
 * through the options seam's `cache` slot (2.2-outcome §3c):
 *  - `claim(key, ttlSeconds)` mirrors atomic SET NX EX — `true` when this
 *    caller won the claim (proceed with the write), `false` when the key is
 *    already held (duplicate emission);
 *  - `store(key, value, ttlSeconds)` mirrors a plain SET-with-TTL overwrite —
 *    the engine attaches the completed delivery receipt after its insert
 *    commits;
 *  - `get(key)` mirrors GET — the prior receipt for an already-claimed key.
 * TTL is honored via wall-clock expiry timestamps; no Redis is ever touched.
 */
class InMemoryClaimCache {
  private readonly entries = new Map<string, ClaimEntry>();

  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt > Date.now()) {
      return false; // already claimed — duplicate emission
    }
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value: "" });
    return true; // claim won — proceed with the write
  }

  async store(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { expiresAt: Date.now() + ttlSeconds * 1000, value });
  }

  async get(key: string): Promise<string | null> {
    const entry = this.entries.get(key);
    if (entry === undefined || entry.expiresAt <= Date.now()) {
      return null;
    }
    return entry.value;
  }
}

/**
 * Try/catch rejection helper (journey-layer pattern —
 * `expect(...).rejects.toThrow()` is prohibited). Returns the caught error;
 * fails the test when the call resolves successfully.
 */
async function expectJourneyError(fn: () => Promise<unknown>): Promise<Error> {
  let errorCaught: unknown = null;
  try {
    await fn();
  } catch (error) {
    errorCaught = error;
  }
  if (errorCaught === null) {
    throw new Error("expected the call to throw, but it resolved successfully");
  }
  if (errorCaught instanceof Error) {
    return errorCaught;
  }
  return new Error(`[non-Error throw: ${typeof errorCaught}]`);
}

/** Direct repo-less inbox row count for one recipient. */
async function inboxRowCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** The receipt row belonging to `userId` (throws when the batch skipped a recipient). */
function rowForRecipient(receipt: NotificationDeliveryReceipt, userId: number): NotificationReturnType {
  const row = receipt.notifications.find(candidate => candidate.userId === userId);
  if (!row) {
    throw new Error(`expected the batch receipt to carry a row for user ${userId}`);
  }
  return row;
}

/** Builds a cohort broadcast input for the parent cohort (idempotency key varies per step). */
function broadcastInput(
  recipientIds: readonly number[],
  title: string,
  body: string | null,
  idempotencyKey: string
): NotificationEmitBatchInput {
  return {
    userIds: recipientIds,
    type: NotificationType.SystemBroadcast,
    title,
    body,
    relatedEntityType: null,
    relatedEntityId: null,
    idempotencyKey,
  };
}

describe("J2 — Cohort broadcast fan-out + offline persistence (system_broadcast to parents)", () => {
  const tracked = new TrackedFixtures();
  const transportSpy = new SpiedFanoutTransport();
  const claimCache = new InMemoryClaimCache();

  let parentA: JourneyActor;
  let parentB: JourneyActor;
  let teacher: JourneyActor;
  let firstReceipt: NotificationDeliveryReceipt;
  let firstRowA: NotificationReturnType;
  let firstRowB: NotificationReturnType;
  let foreignProbeMessage: string;

  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing, so a
    // throwing setup rolls back and leaves nothing behind.
    await db.transaction(async tx => {
      parentA = await provisionParentActor(tx, { tracked });
      parentB = await provisionParentActor(tx, { tracked });
      teacher = await provisionCertifiedTeacherActor(tx, { tracked });
    });
  });

  afterAll(async () => {
    // Reverse-registration-order hard delete + the registry's own zero-residue
    // existence checks (a leaking afterAll fails the suite) — then an explicit
    // per-record absence sweep so zero residue is a first-class assertion.
    const registered = [...tracked.records];
    const report = await tracked.cleanup();
    expect(report.deletedCount).toBe(registered.length);
    expect(report.verifiedAbsentCount).toBe(registered.length);
    const stillPresent = await Promise.all(registered.map(record => tracked.exists(record)));
    expect(stillPresent.every(present => !present)).toBe(true);
  });

  test("step 1 — System: fixtures committed; parents A/B and teacher inboxes are empty", async () => {
    // 3 actors × (users row + role-child row), all registered for teardown.
    expect(tracked.size).toBe(6);

    expect(await inboxRowCount(parentA.userId)).toBe(0);
    expect(await inboxRowCount(parentB.userId)).toBe(0);
    expect(await inboxRowCount(teacher.userId)).toBe(0);

    const unreadA = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unreadA).toBe(0);
    const unreadB = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unreadB).toBe(0);
    const unreadTeacher = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(unreadTeacher).toBe(0);

    expect(transportSpy.publishCount).toBe(0);
  });

  test("step 2 — Emitter: batch emit persists exactly 2 rows with one batch timestamp; transport publishes once, carrying both ids", async () => {
    firstReceipt = await NotificationEngine.emitForUsers(
      broadcastInput(
        [parentA.userId, parentB.userId],
        FIRST_BROADCAST_TITLE,
        FIRST_BROADCAST_BODY,
        FIRST_IDEMPOTENCY_KEY
      ),
      EMIT_LOCALE,
      undefined,
      { transport: transportSpy, cache: claimCache }
    );

    firstRowA = rowForRecipient(firstReceipt, parentA.userId);
    firstRowB = rowForRecipient(firstReceipt, parentB.userId);
    // Side-effect rows join the tracked teardown set as soon as they are observed.
    tracked.register(notifications, firstRowA.id);
    tracked.register(notifications, firstRowB.id);

    // Shared state: EXACTLY one row per parent, unread, identical batch copy.
    expect(firstReceipt.notifications).toHaveLength(2);
    expect(firstReceipt.recipientUserIds).toHaveLength(2);
    expect(firstReceipt.recipientUserIds).toContain(parentA.userId);
    expect(firstReceipt.recipientUserIds).toContain(parentB.userId);
    expect(firstRowA.userId).toBe(parentA.userId);
    expect(firstRowB.userId).toBe(parentB.userId);
    expect(firstRowA.type).toBe(NotificationType.SystemBroadcast);
    expect(firstRowA.title).toBe(FIRST_BROADCAST_TITLE);
    expect(firstRowA.body).toBe(FIRST_BROADCAST_BODY);
    expect(firstRowA.relatedEntityType).toBeNull();
    expect(firstRowA.relatedEntityId).toBeNull();
    expect(firstRowA.isRead).toBe(false);
    expect(firstRowB.isRead).toBe(false);
    // ONE timestamp per batch (REQ-047): sibling rows share createdAt exactly.
    expect(firstRowB.createdAt.getTime()).toBe(firstRowA.createdAt.getTime());
    expect(await inboxRowCount(parentA.userId)).toBe(1);
    expect(await inboxRowCount(parentB.userId)).toBe(1);

    // Side effect: ONE publish for the whole cohort (REQ-013) — both ids, no
    // per-recipient publishes.
    expect(transportSpy.publishCount).toBe(1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to have recorded the batch publish");
    }
    expect(publish.userIds).toHaveLength(2);
    expect(publish.userIds).toContain(parentA.userId);
    expect(publish.userIds).toContain(parentB.userId);
    expect(transportSpy.publishedUserIds).toHaveLength(2);

    // Visibility matrix: the teacher observes NO row from a parent-targeted emit.
    expect(await inboxRowCount(teacher.userId)).toBe(0);
  });

  test("step 3 — Parent A (online path): realtime payload shape valid; only A's own copy is addressable", async () => {
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to have recorded the batch publish");
    }
    const payload = publish.payload;

    // RealtimeNotificationPayload contract (REQ-021): version, discriminator,
    // allowlisted row projection — and NO account identifier on the wire.
    expect(payload.v).toBe(1);
    expect(payload.kind).toBe("notification");
    expect([firstRowA.id, firstRowB.id]).toContain(payload.data.id);
    expect(payload.data.type).toBe(NotificationType.SystemBroadcast);
    expect(payload.data.title).toBe(FIRST_BROADCAST_TITLE);
    expect(payload.data.body).toBe(FIRST_BROADCAST_BODY);
    expect(payload.data.relatedEntityType).toBeNull();
    expect(payload.data.relatedEntityId).toBeNull();
    expect(payload.data.createdAt).toEqual(firstRowA.createdAt);
    expect(Object.hasOwn(payload.data, "userId")).toBe(false);

    // Only A's copy is addressable by A: exactly one row, and it is A's own.
    const page = await NotificationEngine.listMyNotifications(parentA.userId, INBOX_PAGE, parentA.locale);
    expect(page.items).toHaveLength(1);
    expect(page.totalCount).toBe(1);
    expect(page.hasMore).toBe(false);
    const ownRow = page.items.at(0);
    if (!ownRow) {
      throw new Error("expected parent A's inbox page to contain the broadcast copy");
    }
    expect(ownRow.id).toBe(firstRowA.id);
    expect(ownRow.isRead).toBe(false);

    const unread = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unread).toBe(1);
  });

  test("step 4 — Parent B (offline): no per-user push beyond the single batch publish; row persisted unread", async () => {
    // "Offline" at this layer: B rode the ONE batch publish and nothing else —
    // no separate per-user push exists for either recipient (REQ-013), and the
    // emit succeeded regardless of connectivity (REQ-011: durable inbox is
    // truth — persistence never depends on delivery).
    expect(transportSpy.publishCount).toBe(1);
    expect(transportSpy.publishedUserIds).toHaveLength(2);

    // B's copy is persisted and readable on first read, still unread.
    const page = await NotificationEngine.listMyNotifications(parentB.userId, INBOX_PAGE, parentB.locale);
    expect(page.items).toHaveLength(1);
    expect(page.totalCount).toBe(1);
    const ownRow = page.items.at(0);
    if (!ownRow) {
      throw new Error("expected parent B's inbox page to contain the persisted broadcast copy");
    }
    expect(ownRow.id).toBe(firstRowB.id);
    expect(ownRow.isRead).toBe(false);

    const unread = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unread).toBe(1);
  });

  test("step 5 — Parent B later: markAllRead(system_broadcast) flips exactly B's unread row; badge drops to 0", async () => {
    // Pre-state: one unread broadcast row, coherent through the type+unread filter too.
    const unreadBefore = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unreadBefore).toBe(1);
    const filteredPage = await NotificationEngine.listMyNotifications(
      parentB.userId,
      { type: NotificationType.SystemBroadcast, isRead: false, limit: 20, offset: 0 },
      parentB.locale
    );
    expect(filteredPage.totalCount).toBe(1);
    expect(filteredPage.items).toHaveLength(1);

    const affected = await NotificationEngine.markAllRead(
      parentB.userId,
      NotificationType.SystemBroadcast,
      parentB.locale
    );
    expect(affected).toBe(1);

    const unreadAfter = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unreadAfter).toBe(0);

    const page = await NotificationEngine.listMyNotifications(parentB.userId, INBOX_PAGE, parentB.locale);
    const ownRow = page.items.at(0);
    if (!ownRow) {
      throw new Error("expected parent B's inbox page to still contain the broadcast copy");
    }
    expect(ownRow.id).toBe(firstRowB.id);
    expect(ownRow.isRead).toBe(true);

    // Marking mutates ONLY B's rows (REQ-J2): A keeps the unread badge and the
    // teacher's inbox stays empty.
    const unreadA = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unreadA).toBe(1);
    expect(await inboxRowCount(teacher.userId)).toBe(0);
  });

  test("step 6 — Teacher (denial): inbox stays empty; foreign mark probe fails oracle-safely; owner row byte-identical", async () => {
    const teacherPage = await NotificationEngine.listMyNotifications(teacher.userId, INBOX_PAGE, teacher.locale);
    expect(teacherPage.items).toEqual([]);
    expect(teacherPage.totalCount).toBe(0);
    expect(teacherPage.hasMore).toBe(false);
    const teacherUnread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);
    expect(teacherUnread).toBe(0);

    // Oracle snapshot of A's row before the foreign probe.
    const before = await db.select().from(notifications).where(eq(notifications.id, firstRowA.id)).limit(1);

    const error = await expectJourneyError(() =>
      NotificationEngine.markRead(teacher.userId, firstRowA.id, teacher.locale)
    );
    if (!(error instanceof NotFoundError)) {
      throw new Error(
        `expected NotFoundError from the teacher's foreign mark probe (got ${error.name}: ${error.message})`
      );
    }
    expect(error.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(error.message).toContain(EN_ERRORS.notificationNotFound);
    foreignProbeMessage = error.message;

    // Oracle-safe denial: A's row is byte-identical after the probe.
    const after = await db.select().from(notifications).where(eq(notifications.id, firstRowA.id)).limit(1);
    expect(after).toEqual(before);

    // Empty-set bulk mark is safe (REQ-020) and mutates nobody else's rows.
    const teacherAffected = await NotificationEngine.markAllRead(
      teacher.userId,
      NotificationType.SystemBroadcast,
      teacher.locale
    );
    expect(teacherAffected).toBe(0);
    const unreadA = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unreadA).toBe(1);
    const unreadB = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unreadB).toBe(0);
    expect(await inboxRowCount(teacher.userId)).toBe(0);
  });

  test("step 7 — Emitter replays the SAME idempotency key: ZERO new rows, ZERO new publishes (REQ-J3)", async () => {
    const publishCountBefore = transportSpy.publishCount;
    const rowCountA = await inboxRowCount(parentA.userId);
    const rowCountB = await inboxRowCount(parentB.userId);

    const replayReceipt = await NotificationEngine.emitForUsers(
      broadcastInput(
        [parentA.userId, parentB.userId],
        FIRST_BROADCAST_TITLE,
        FIRST_BROADCAST_BODY,
        FIRST_IDEMPOTENCY_KEY
      ),
      EMIT_LOCALE,
      undefined,
      { transport: transportSpy, cache: claimCache }
    );

    // The prior receipt comes back — same rows, no new ids (REQ-016).
    expect(replayReceipt.notifications).toHaveLength(2);
    const replayIds = replayReceipt.notifications.map((row: NotificationReturnType) => row.id);
    expect(replayIds).toContain(firstRowA.id);
    expect(replayIds).toContain(firstRowB.id);
    expect(replayReceipt.recipientUserIds).toContain(parentA.userId);
    expect(replayReceipt.recipientUserIds).toContain(parentB.userId);

    // ZERO new publishes.
    expect(transportSpy.publishCount).toBe(publishCountBefore);
    expect(transportSpy.publishedUserIds).toHaveLength(2);

    // ZERO new rows — service-level page totals and direct oracle counts.
    const pageA = await NotificationEngine.listMyNotifications(parentA.userId, INBOX_PAGE, parentA.locale);
    expect(pageA.totalCount).toBe(1);
    const pageB = await NotificationEngine.listMyNotifications(parentB.userId, INBOX_PAGE, parentB.locale);
    expect(pageB.totalCount).toBe(1);
    expect(await inboxRowCount(parentA.userId)).toBe(rowCountA);
    expect(await inboxRowCount(parentB.userId)).toBe(rowCountB);
    expect(await inboxRowCount(teacher.userId)).toBe(0);
  });

  test("step 8 — Emitter uses a DIFFERENT idempotency key: fresh 2 rows, exactly one new publish", async () => {
    const publishCountBefore = transportSpy.publishCount;

    const secondReceipt = await NotificationEngine.emitForUsers(
      broadcastInput([parentA.userId, parentB.userId], SECOND_BROADCAST_TITLE, null, SECOND_IDEMPOTENCY_KEY),
      EMIT_LOCALE,
      undefined,
      { transport: transportSpy, cache: claimCache }
    );

    expect(secondReceipt.notifications).toHaveLength(2);
    const secondRowA = rowForRecipient(secondReceipt, parentA.userId);
    const secondRowB = rowForRecipient(secondReceipt, parentB.userId);
    // Side-effect rows join the tracked teardown set.
    tracked.register(notifications, secondRowA.id);
    tracked.register(notifications, secondRowB.id);
    // Full teardown inventory now: 6 actor rows + 4 notification rows.
    expect(tracked.size).toBe(10);

    // Fresh rows — ids disjoint from the first batch, unread, own batch timestamp.
    const secondIds = secondReceipt.notifications.map((row: NotificationReturnType) => row.id);
    expect(secondIds).not.toContain(firstRowA.id);
    expect(secondIds).not.toContain(firstRowB.id);
    expect(secondRowA.isRead).toBe(false);
    expect(secondRowB.isRead).toBe(false);
    expect(secondRowB.createdAt.getTime()).toBe(secondRowA.createdAt.getTime());
    expect(secondRowA.title).toBe(SECOND_BROADCAST_TITLE);
    expect(secondRowA.body).toBeNull();

    // Exactly ONE new publish, again carrying the full cohort.
    expect(transportSpy.publishCount).toBe(publishCountBefore + 1);
    const publish = transportSpy.lastCall;
    if (!publish) {
      throw new Error("expected the spied transport to have recorded the second batch publish");
    }
    expect(publish.userIds).toHaveLength(2);
    expect(publish.userIds).toContain(parentA.userId);
    expect(publish.userIds).toContain(parentB.userId);
    expect(publish.payload.data.title).toBe(SECOND_BROADCAST_TITLE);
    expect(publish.payload.data.body).toBeNull();
    expect([secondRowA.id, secondRowB.id]).toContain(publish.payload.data.id);

    // Inbox totals settle at 2 per parent; A never marked anything (2 unread),
    // B marked the first batch only (1 unread); teacher still empty.
    const pageA = await NotificationEngine.listMyNotifications(parentA.userId, INBOX_PAGE, parentA.locale);
    expect(pageA.totalCount).toBe(2);
    const pageB = await NotificationEngine.listMyNotifications(parentB.userId, INBOX_PAGE, parentB.locale);
    expect(pageB.totalCount).toBe(2);
    const unreadA = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unreadA).toBe(2);
    const unreadB = await NotificationEngine.getMyUnreadCount(parentB.userId, parentB.locale);
    expect(unreadB).toBe(1);
    expect(await inboxRowCount(teacher.userId)).toBe(0);
  });

  test("step 9 — Denial-class probes: nonexistent id is indistinguishable from a foreign id; invalid id fails closed pre-DB", async () => {
    // Anonymous → UNAUTHORIZED is the GraphQL authScopes contract (REQ-032,
    // Tasks 3.x/5.1) — out of scope for this service-layer journey (see the
    // header note). Service-scope oracle safety: a nonexistent id produces the
    // SAME denial shape the teacher's foreign-id probe produced in step 6.
    const nonexistentError = await expectJourneyError(() =>
      NotificationEngine.markRead(parentA.userId, NONEXISTENT_NOTIFICATION_ID, parentA.locale)
    );
    if (!(nonexistentError instanceof NotFoundError)) {
      throw new Error(
        `expected NotFoundError from the nonexistent-id mark probe (got ${nonexistentError.name}: ${nonexistentError.message})`
      );
    }
    expect(nonexistentError.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(nonexistentError.message).toContain(EN_ERRORS.notificationNotFound);
    expect(nonexistentError.message).toBe(foreignProbeMessage);

    // An invalid-format id never reaches the database: the positive-safe-int
    // guard rejects it with a VALIDATION-class error before any query.
    const invalidError = await expectJourneyError(() => NotificationEngine.markRead(parentA.userId, 0, parentA.locale));
    if (!(invalidError instanceof ValidationError)) {
      throw new Error(
        `expected ValidationError from the invalid-id mark probe (got ${invalidError.name}: ${invalidError.message})`
      );
    }
    expect(invalidError.code).toBe("VALIDATION");

    // Every probe was read-only: A's inbox state is unchanged.
    const unreadA = await NotificationEngine.getMyUnreadCount(parentA.userId, parentA.locale);
    expect(unreadA).toBe(2);
    expect(await inboxRowCount(parentA.userId)).toBe(2);
  });
});
