/**
 * Journey — WS reconnect catch-up (notification lane).
 *
 * Cross-actor journey through the REAL notification sidecar, the REAL
 * notification engine, and the REAL test database:
 *
 *  1. System provisions a certified teacher recipient, a student (owner of
 *     the observed session row), a parent sibling recipient, and one real
 *     `session` row; then boots the real sidecar via `startNotificationWsServer`
 *     on an ephemeral port (`port: 0` + `127.0.0.1`) with a
 *     RECORDING-AND-FORWARDING transport wrapper around the real
 *     `InProcessTransport` — the wrapper records every engine publish for
 *     telemetry AND delivers in-process, so frames provably arrive on live
 *     sockets while dispatch evidence is captured (a pure spy would swallow
 *     the delivery).
 *  2. The teacher's real Bun `WebSocket` client connects (authenticated by a
 *     real minted access token through the sidecar's real verification path),
 *     then the socket is killed mid-flight.
 *  3. A notification emitted while the teacher is disconnected is PERSISTED
 *     with no frame delivered — the inbox row is the offline source of truth.
 *  4. The client reconnects on a NEW socket; the reconnect catch-up read —
 *     the same unfiltered inbox-page-1 + unread-count refetch the client
 *     session performs on reopen (`createCatchUpRefetch` in
 *     `use-notification-realtime.socket.ts`) — surfaces the missed row
 *     through the real inbox path with the correct unread count.
 *  5. A second emission delivers a live frame on the NEW socket; the
 *     emit→frame loopback latency is recorded (a recorded number, never a
 *     CI threshold).
 *  6. Oracle: the observed session row is byte-unchanged across the whole
 *     disconnect window — session state lives in Postgres and the sidecar is
 *     push-only (it holds no session state), so "session survives
 *     disconnect" is proven as DB persistence + notification-lane reconnect,
 *     never as a session socket.
 *  7. The sibling recipient's inbox rows and frames stay untouched (no
 *     fan-out leakage — sibling-silence + inbox row-count deltas) and a
 *     foreign mark-read probe fails oracle-safely with the translated
 *     NOTIFICATION_NOT_FOUND message while the owner's row stays
 *     byte-identical.
 *
 * Journey rules (test/workflows/AGENTS.md) honored:
 *  - fixtures COMMITTED in `beforeAll` inside one committing transaction and
 *    hard-deleted in `afterAll` via `TrackedFixtures` with post-teardown
 *    existence checks (zero residue); never `runInRollback`;
 *  - real actors via the actor-context factory (real `users` rows + real
 *    role-child rows) — every ownership/denial check resolves through the
 *    genuine path;
 *  - the dispatch boundary is intercepted in-process only: the wrapper
 *    records every publish AND forwards through the in-process transport —
 *    nothing reaches real email/SMS/push/Redis/FX and no real WS edge is
 *    involved (ephemeral loopback port, native Bun clients);
 *  - the sidecar is shut down in `afterAll` and the shutdown is verified
 *    (a fresh handshake is refused — no lingering listener; ports 3000 and
 *    5432 are never occupied).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/backend/db";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { createTestSession } from "@/backend/db/test/entity-setup";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { signAccessToken } from "@/backend/lib/auth/jwt";
import { NotFoundError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import {
  NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT,
  NotificationEngine,
} from "@/backend/services/notifications/notification-engine.service";
import { InProcessTransport } from "@/backend/services/notifications/realtime";
import type {
  FanoutListener,
  FanoutSubscription,
  NotificationFanoutSubscriptionSource,
  NotificationFanoutTransport,
} from "@/backend/services/notifications/realtime/fanout-transport";
import type {
  NotificationDeliveryReceipt,
  NotificationListFilterInput,
  NotificationReturnType,
  RealtimeNotificationPayload,
} from "@/backend/types";
import { type NotificationWsServerHandle, startNotificationWsServer } from "@/backend/ws";
import { getServerTranslations } from "@/shared/locale/server-graphql";
import {
  type FanoutPublishCall,
  type JourneyActor,
  provisionCertifiedTeacherActor,
  provisionParentActor,
  provisionStudentActor,
  TrackedFixtures,
} from "@/test/workflows/helpers";

/** Per-run unique prefix so repeated or parallel runs never collide. */
const runPrefix = `jrn_notifications_${randomUUID().slice(0, 8)}`;

/** First emission copy (carries the run prefix; title max 255 chars). */
const MISSED_TITLE = `${runPrefix}: New session request`;

/** Second emission copy — the live post-reconnect push. */
const LIVE_TITLE = `${runPrefix}: Second session request`;

/** Polymorphic entity pointer carried by both emitted notifications. */
const RELATED_ENTITY_TYPE = "session";

/**
 * The catch-up window the client session refetches on reconnect: the
 * unfiltered inbox page 1 (the engine's default page limit) — mirrors the
 * `filter: null` page-1 read in `createCatchUpRefetch`.
 */
const CATCH_UP_PAGE: NotificationListFilterInput = {
  limit: NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT,
  offset: 0,
};

/** Bounded silence window proving a connected sibling received no frame. */
const SILENCE_WINDOW_MS = 300;

/** English translated error copy — denial assertions pin translated substrings. */
const EN_ERRORS = getServerTranslations("en").errorsTranslations;

/** Handshake origin — must sit in the sidecar's allowlist (CSWSH defense). */
const ALLOWED_ORIGIN = "http://localhost:3000";

// ─── Recording-and-forwarding transport wrapper ──────────────────────────────

/**
 * Fan-out transport that RECORDS every publish for telemetry AND forwards it
 * to the real `InProcessTransport`, so the frame provably arrives on the
 * live socket while dispatch evidence is captured. Implements both sides of
 * the fan-out seam: the engine publishes through it, the sidecar subscribes
 * through it (subscription delegates to the inner in-process transport).
 */
class RecordingForwardingFanoutTransport implements NotificationFanoutTransport, NotificationFanoutSubscriptionSource {
  private log: FanoutPublishCall[] = [];

  constructor(private readonly inner: InProcessTransport) {}

  async publishFanout(userIds: readonly number[], payload: RealtimeNotificationPayload): Promise<void> {
    this.log.push(Object.freeze({ userIds: Object.freeze([...userIds]), payload }));
    await this.inner.publishFanout(userIds, payload);
  }

  subscribeFanout(listener: FanoutListener): Promise<FanoutSubscription> {
    return this.inner.subscribeFanout(listener);
  }

  get publishCount(): number {
    return this.log.length;
  }

  get lastCall(): FanoutPublishCall | null {
    return this.log.at(-1) ?? null;
  }

  get publishedUserIds(): readonly number[] {
    return this.log.flatMap(call => call.userIds);
  }
}

// ─── Native-client helpers (Bun WebSocket, loopback only) ─────────────────────

/**
 * Bun's extended WebSocket constructor — the runtime accepts an options
 * object (`{ headers }`) as the second argument, but with `lib.dom` loaded
 * the global's TYPE resolves to the DOM constructor, masking the Bun
 * overload. This type-guard bridge recovers the extended constructor at the
 * type level while the runtime check keeps it honest (no `as` assertions).
 */
type BunWebSocketConstructor = new (url: string | URL, options?: Bun.WebSocketOptions) => WebSocket;

function isBunWebSocketConstructor(value: unknown): value is BunWebSocketConstructor {
  return typeof value === "function";
}

function resolveBunWebSocketConstructor(): BunWebSocketConstructor {
  const candidate: unknown = WebSocket;
  if (isBunWebSocketConstructor(candidate)) {
    return candidate;
  }
  throw new Error("Bun WebSocket constructor unavailable");
}

const createSocket = resolveBunWebSocketConstructor();

/** Connects a real client with the recipient's access-token cookie. */
function connectRecipient(url: string, token: string): WebSocket {
  return new createSocket(url, { headers: { origin: ALLOWED_ORIGIN, cookie: `access_token=${token}` } });
}

function waitForOpen(ws: WebSocket, timeoutMs = 3_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client open")), timeoutMs);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("client errored before open"));
    });
    ws.addEventListener("close", () => {
      clearTimeout(timer);
      reject(new Error("client closed before open"));
    });
  });
}

function nextCloseCode(ws: WebSocket, timeoutMs = 3_000): Promise<{ code: number; reason: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client close")), timeoutMs);
    ws.addEventListener("close", event => {
      clearTimeout(timer);
      resolve({ code: event.code, reason: event.reason });
    });
  });
}

function nextMessage(ws: WebSocket, timeoutMs = 3_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout waiting for client message")), timeoutMs);
    ws.addEventListener("message", event => {
      clearTimeout(timer);
      resolve(String(event.data));
    });
  });
}

/** Collects every inbound client message (for provable-silence assertions). */
function collectMessages(ws: WebSocket): string[] {
  const messages: string[] = [];
  ws.addEventListener("message", event => {
    messages.push(String(event.data));
  });
  return messages;
}

async function waitForCondition(description: string, predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (): Promise<void> => {
    if (predicate()) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timeout waiting for: ${description}`);
    }
    await new Promise(resolve => setTimeout(resolve, 25));
    await poll();
  };
  await poll();
}

/** Closes a client cleanly (no-op when already gone) and awaits the close. */
async function closeClientQuietly(ws: WebSocket | null): Promise<void> {
  if (ws !== null && ws.readyState === WebSocket.OPEN) {
    ws.close(1000, "test done");
  }
  if (ws !== null) {
    await waitForCondition("client socket fully closed", () => ws.readyState === WebSocket.CLOSED);
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

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

/**
 * Narrows the emit result to the single persisted row: `emitForUser` may
 * return the created row directly (own-commit path) or a delivery receipt
 * (caller-transaction path) — both carry the same row.
 */
function singleEmittedRow(result: NotificationReturnType | NotificationDeliveryReceipt): NotificationReturnType {
  if ("notifications" in result) {
    const first = result.notifications.at(0);
    if (!first) {
      throw new Error("emitForUser returned a delivery receipt with zero notifications");
    }
    return first;
  }
  return result;
}

/** Direct repo-less inbox row count for one recipient. */
async function inboxRowCount(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

// ─── The journey ──────────────────────────────────────────────────────────────

describe("Journey — WS reconnect catch-up (teacher recipient, sidecar on an ephemeral port)", () => {
  const tracked = new TrackedFixtures();
  const innerTransport = new InProcessTransport();
  const fanout = new RecordingForwardingFanoutTransport(innerTransport);

  let teacher: JourneyActor;
  let student: JourneyActor;
  let sibling: JourneyActor;
  let teacherToken = "";
  let siblingToken = "";
  let observedSessionId = 0;
  let server: { handle: NotificationWsServerHandle; url: string } | null = null;

  let teacherSocket: WebSocket | null = null;
  let siblingSocket: WebSocket | null = null;
  let siblingFrames: string[] = [];

  let missedRow: NotificationReturnType;
  let liveRow: NotificationReturnType;
  let sessionBaseline: Array<typeof session.$inferSelect> = [];
  let emitToFrameLatencyMs = -1;

  /** Emits one teacher-targeted session notification through the wrapper. */
  const emitTeacherNotification = async (title: string, body: string | null): Promise<NotificationReturnType> => {
    const result = await NotificationEngine.emitForUser(
      {
        userId: teacher.userId,
        type: NotificationType.SessionRequest,
        title,
        body,
        relatedEntityType: RELATED_ENTITY_TYPE,
        relatedEntityId: observedSessionId,
      },
      teacher.locale,
      undefined,
      { transport: fanout }
    );
    const row = singleEmittedRow(result);
    tracked.register(notifications, row.id);
    return row;
  };

  beforeAll(async () => {
    // One COMMITTING transaction: provisioning is commit-or-nothing.
    await db.transaction(async tx => {
      teacher = await provisionCertifiedTeacherActor(tx, { tracked });
      student = await provisionStudentActor(tx, { tracked });
      sibling = await provisionParentActor(tx, { tracked });
      // The student exists as a real role-child row owner; the session row is
      // the byte-observation target across the disconnect window.
      const observedSession = await createTestSession(tx, teacher.userId, student.userId);
      observedSessionId = observedSession.id;
      tracked.register(session, observedSession.id);
    });
    // Real minted access tokens: the sidecar's handshake verifies them and
    // derives the recipient userId from the verified `sub` claim.
    teacherToken = await signAccessToken({ userId: teacher.userId, role: teacher.role });
    siblingToken = await signAccessToken({ userId: sibling.userId, role: sibling.role });
    // Boot the REAL sidecar on an ephemeral loopback port with the
    // recording-and-forwarding transport; generous handshake bucket so the
    // reconnect churn never trips the throttle implicitly.
    const handle = await startNotificationWsServer({
      subscriptionSource: fanout,
      config: {
        port: 0,
        host: "127.0.0.1",
        allowedOrigins: [ALLOWED_ORIGIN],
        handshakeBucketCapacity: 500,
        handshakeBucketRefillIntervalMs: 1,
        shutdownDrainTimeoutMs: 120,
      },
    });
    server = { handle, url: handle.url };
  });

  afterAll(async () => {
    // Close every client first (no-ops when already gone).
    await closeClientQuietly(teacherSocket);
    await closeClientQuietly(siblingSocket);
    teacherSocket = null;
    siblingSocket = null;
    // Mandatory sidecar shutdown — never leave a listener behind.
    if (server !== null) {
      await server.handle.shutdown();
      // Shutdown verified: a fresh handshake is refused (the native client
      // surfaces the refused connection as an abnormal close).
      const refused = connectRecipient(server.url, teacherToken);
      const close = await nextCloseCode(refused, 2_000);
      expect(close.code).toBe(1006);
    }
    // Reverse-registration-order hard delete + zero-residue existence checks.
    await tracked.cleanup();
  });

  test("step 1 — System: fixtures committed, sidecar live on an ephemeral port, inboxes empty, session baseline captured", async () => {
    // 3 actors × (users row + role-child row) + the observed session row.
    expect(tracked.size).toBe(7);

    if (server === null) {
      throw new Error("sidecar failed to boot in beforeAll");
    }
    expect(server.handle.port).toBeGreaterThan(0);
    expect(server.url.startsWith("ws://127.0.0.1:")).toBe(true);
    expect(server.handle.connectionCount).toBe(0);

    expect(await inboxRowCount(teacher.userId)).toBe(0);
    expect(await inboxRowCount(sibling.userId)).toBe(0);
    expect(fanout.publishCount).toBe(0);

    // Baseline snapshot of the observed session row — the byte-identity
    // oracle re-reads it after the whole disconnect window.
    sessionBaseline = await db.select().from(session).where(eq(session.id, observedSessionId)).limit(1);
    expect(sessionBaseline).toHaveLength(1);
  });

  test("step 2 — Teacher connects, then the socket is killed mid-flight", async () => {
    if (server === null) {
      throw new Error("sidecar unavailable");
    }
    teacherSocket = connectRecipient(server.url, teacherToken);
    await waitForOpen(teacherSocket);
    expect(server.handle.connectionCount).toBe(1);
    expect(server.handle.connectionCountForUser(teacher.userId)).toBe(1);

    // The sibling stays connected for the WHOLE window: its socket silence
    // and its inbox row-count deltas are the fan-out-leakage oracle.
    siblingSocket = connectRecipient(server.url, siblingToken);
    await waitForOpen(siblingSocket);
    siblingFrames = collectMessages(siblingSocket);
    expect(server.handle.connectionCount).toBe(2);

    // Kill the teacher's socket mid-flight; the registry must drain.
    await closeClientQuietly(teacherSocket);
    await waitForCondition(
      "registry drains after the teacher socket is killed",
      () => server?.handle.connectionCount === 1
    );
    expect(server.handle.connectionCountForUser(teacher.userId)).toBe(0);
    expect(server.handle.connectionCountForUser(sibling.userId)).toBe(1);
  });

  test("step 3 — System emits while the teacher is disconnected: row persisted, NO frame (offline source of truth)", async () => {
    if (server === null) {
      throw new Error("sidecar unavailable");
    }
    missedRow = await emitTeacherNotification(MISSED_TITLE, `${runPrefix}: emitted while offline`);

    // Persisted: exactly one unread row, addressed to the teacher only.
    expect(missedRow.userId).toBe(teacher.userId);
    expect(missedRow.type).toBe(NotificationType.SessionRequest);
    expect(missedRow.title).toBe(MISSED_TITLE);
    expect(missedRow.isRead).toBe(false);
    expect(missedRow.relatedEntityType).toBe(RELATED_ENTITY_TYPE);
    expect(missedRow.relatedEntityId).toBe(observedSessionId);
    expect(await inboxRowCount(teacher.userId)).toBe(1);

    // Dispatch evidence: ONE publish, teacher-only, recorded AND forwarded.
    expect(fanout.publishCount).toBe(1);
    const publish = fanout.lastCall;
    if (!publish) {
      throw new Error("expected the wrapper to have recorded the emit publish");
    }
    expect(publish.userIds).toEqual([teacher.userId]);
    expect(publish.payload.v).toBe(1);
    expect(publish.payload.kind).toBe("notification");
    expect(publish.payload.data.id).toBe(missedRow.id);
    expect(publish.payload.data.type).toBe(NotificationType.SessionRequest);
    // No account identifier rides the payload — the recipient is implied by
    // the authenticated socket the payload travels on.
    expect(Object.hasOwn(publish.payload.data, "userId")).toBe(false);

    // No frame possible: the teacher has no live socket.
    expect(server.handle.connectionCountForUser(teacher.userId)).toBe(0);

    // Sibling frame silence + inbox row-count delta (no fan-out leakage).
    await new Promise(resolve => setTimeout(resolve, SILENCE_WINDOW_MS));
    expect(siblingFrames).toHaveLength(0);
    expect(await inboxRowCount(sibling.userId)).toBe(0);
    expect(fanout.publishedUserIds).toEqual([teacher.userId]);
  });

  test("step 4 — Client reconnects on a NEW socket; catch-up read surfaces the missed row with the correct unread count", async () => {
    if (server === null) {
      throw new Error("sidecar unavailable");
    }
    teacherSocket = connectRecipient(server.url, teacherToken);
    await waitForOpen(teacherSocket);
    expect(server.handle.connectionCountForUser(teacher.userId)).toBe(1);

    // The catch-up read the client session performs on reopen: the
    // unfiltered inbox page 1 plus the unread count, through the real inbox
    // path those client documents resolve to.
    const catchUpPage = await NotificationEngine.listMyNotifications(teacher.userId, CATCH_UP_PAGE, teacher.locale);
    const unread = await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale);

    expect(catchUpPage.totalCount).toBe(1);
    expect(catchUpPage.hasMore).toBe(false);
    const row = catchUpPage.items.at(0);
    if (!row) {
      throw new Error("expected the catch-up page to surface the missed notification");
    }
    expect(row.id).toBe(missedRow.id);
    expect(row.title).toBe(MISSED_TITLE);
    expect(row.type).toBe(NotificationType.SessionRequest);
    expect(row.isRead).toBe(false);
    expect(unread).toBe(1);

    // No duplication, no loss: the catch-up page equals the direct DB
    // listing in the engine's documented ordering, field for field.
    const dbListing = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, teacher.userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id));
    expect(catchUpPage.items).toEqual(dbListing);
  });

  test("step 5 — Second emission: the frame arrives on the NEW socket; emit→frame loopback latency recorded", async () => {
    if (server === null || teacherSocket === null) {
      throw new Error("sidecar or teacher socket unavailable");
    }
    const emitStartedAt = Date.now();
    liveRow = await emitTeacherNotification(LIVE_TITLE, null);
    const frame = await nextMessage(teacherSocket);
    emitToFrameLatencyMs = Date.now() - emitStartedAt;

    // Recorded number, not a CI threshold: persisted + published + delivered
    // on loopback inside one bounded wall-clock window.
    expect(Number.isSafeInteger(emitToFrameLatencyMs)).toBe(true);
    expect(emitToFrameLatencyMs).toBeGreaterThanOrEqual(0);
    logger.info("reconnect-catchup journey: emit-to-frame loopback latency ms", {
      latencyMs: emitToFrameLatencyMs,
      prefix: runPrefix,
    });

    // The live frame on the NEW socket is the second row, wire-projected.
    const received = JSON.parse(frame);
    expect(received).toEqual({
      v: 1,
      kind: "notification",
      data: {
        id: liveRow.id,
        type: NotificationType.SessionRequest,
        title: LIVE_TITLE,
        body: null,
        relatedEntityType: RELATED_ENTITY_TYPE,
        relatedEntityId: observedSessionId,
        createdAt: liveRow.createdAt.toISOString(),
      },
    });
    // Egress discipline carries over: no recipient id crosses the socket.
    expect(Object.hasOwn(received.data, "userId")).toBe(false);

    // Second row also persisted (two inbox rows now).
    expect(await inboxRowCount(teacher.userId)).toBe(2);
    expect(await NotificationEngine.getMyUnreadCount(teacher.userId, teacher.locale)).toBe(2);

    // Dispatch evidence: two publishes, both teacher-only.
    expect(fanout.publishCount).toBe(2);
    expect(fanout.publishedUserIds).toEqual([teacher.userId, teacher.userId]);

    // Sibling frame silence + inbox row-count delta hold after the live push.
    await new Promise(resolve => setTimeout(resolve, SILENCE_WINDOW_MS));
    expect(siblingFrames).toHaveLength(0);
    expect(await inboxRowCount(sibling.userId)).toBe(0);
  });

  test("step 6 — Oracle: the observed session row is byte-unchanged across the whole disconnect window", async () => {
    // Session state lives in Postgres; the push-only sidecar holds no session
    // state, so the socket churn above must not have touched the row.
    const after = await db.select().from(session).where(eq(session.id, observedSessionId)).limit(1);
    expect(after).toHaveLength(1);
    expect(after).toEqual(sessionBaseline);
  });

  test("step 7 — Sibling denial probe: foreign mark-read fails oracle-safely; owner row byte-identical; sibling untouched", async () => {
    // Byte-snapshot before the probe.
    const before = await db.select().from(notifications).where(eq(notifications.id, missedRow.id)).limit(1);

    const error = await expectJourneyError(() =>
      NotificationEngine.markRead(sibling.userId, missedRow.id, sibling.locale)
    );
    if (!(error instanceof NotFoundError)) {
      throw new Error(`expected NotFoundError from the sibling mark probe (got ${error.name}: ${error.message})`);
    }
    expect(error.code).toBe("NOTIFICATION_NOT_FOUND");
    expect(error.message).toContain(EN_ERRORS.notificationNotFound);

    // Oracle-safe denial: the owner's row is byte-identical after the probe.
    const after = await db.select().from(notifications).where(eq(notifications.id, missedRow.id)).limit(1);
    expect(after).toEqual(before);

    // The sibling's own inbox and socket stay untouched end-to-end.
    expect(await inboxRowCount(sibling.userId)).toBe(0);
    expect(siblingFrames).toHaveLength(0);
  });
});
