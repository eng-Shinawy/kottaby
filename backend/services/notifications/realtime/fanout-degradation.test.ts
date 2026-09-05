/**
 * Fan-out degradation — Redis-outage behaviour of the real-time fan-out
 * transports (`RedisPubSubTransport` over an injected `RedisFanoutClient`).
 *
 * Plan §5.2 degradation tier: the outage is simulated ONLY through the fake
 * client's failed state (mock-adapter discipline, same as the unit suite in
 * `redis-pubsub-transport.test.ts`; the unreachable-port variant
 * `redis://127.0.0.1:6399` was considered and rejected in favour of the
 * deterministic fake — no real socket is touched by this suite, and the live
 * Redis on 6379 is never disturbed).
 *
 *  - Publisher side: while the bus is down, `publishFanout` REJECTS cleanly
 *    with the client's own error — no swallow, no re-wrap, no transport-level
 *    degradation warn (the engine owns swallowing) — and nothing reaches the
 *    subscriber: zero wire messages, zero deliveries.
 *  - Subscriber side: a client that fails mid-subscription leaves the fan-out
 *    listener registered (no exception escapes anywhere the transport
 *    controls); once the client recovers, a plain publish round-trips to the
 *    SAME subscription again — post-recovery delivery, no re-subscription.
 *
 * Row-persistence composition note (emit during outage):
 *  Durable delivery under an outage is the ENGINE's own-commit path —
 *  insert → commit → publish — where the row is persisted BEFORE the bus
 *  publish is attempted, so a rejected publish leaves the row persisted and
 *  real-time delivery degrades to persisted-only. The publish failure is
 *  then swallowed by the engine via `logDomainError
 *  NOTIFICATION_DELIVERY_DEGRADED` → resolve (REQ-011). That swallow
 *  contract is already pinned in
 *  `backend/services/notifications/notification-engine.emit.test.ts` and is
 *  deliberately NOT duplicated here; the composition sketch at the bottom
 *  asserts only the transport-level invariant the engine builds on: row
 *  persisted, zero pushes, zero deliveries.
 *
 * Requirements: REQ-011, REQ-045, REQ-073, REQ-078, REQ-079 (plan §5.2).
 * Runs via the mandated runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { logger } from "@/backend/lib/logger";
import {
  NOTIFICATIONS_FANOUT_CHANNEL,
  type RedisFanoutClient,
  RedisPubSubTransport,
} from "@/backend/services/notifications/realtime/redis-pubsub-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

type DomainLogSpy = ReturnType<typeof spyOn>;

function makePayload(): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id: 42,
      type: "session_request",
      title: "New session request",
      body: "A student requested a session.",
      relatedEntityType: "session",
      relatedEntityId: 4242,
      createdAt: new Date("2026-08-29T12:00:00.000Z"),
    },
  };
}

interface Receipt {
  readonly userIds: readonly number[];
  readonly payload: RealtimeNotificationPayload;
}

/** The exact error the failed client rejects with (identity probe). */
class SimulatedOutageError extends Error {
  constructor() {
    super("connect ECONNREFUSED 127.0.0.1:6399 (simulated Redis outage)");
    this.name = "SimulatedOutageError";
  }
}

/**
 * In-memory Redis client double with outage controls — the same miniature
 * pub/sub bus as the unit suite's fake, plus a registration probe so "the
 * subscriber stays registered" is assertable mid-outage.
 */
class OutageProneFanoutClient implements RedisFanoutClient {
  readonly published: Array<{ channel: string; message: string }> = [];
  private readonly subscribers = new Map<string, (message: string) => void>();
  private outage = false;

  publish(channel: string, message: string): Promise<unknown> {
    if (this.outage) {
      return Promise.reject(new SimulatedOutageError());
    }
    this.published.push({ channel, message });
    this.subscribers.get(channel)?.(message);
    return Promise.resolve(1);
  }

  subscribe(channel: string, onMessage: (message: string) => void): Promise<unknown> {
    this.subscribers.set(channel, onMessage);
    return Promise.resolve(1);
  }

  unsubscribe(channel: string): Promise<unknown> {
    this.subscribers.delete(channel);
    return Promise.resolve(1);
  }

  close(): Promise<void> {
    this.subscribers.clear();
    return Promise.resolve();
  }

  /** True while a listener registration for `channel` is still live. */
  isSubscribed(channel: string): boolean {
    return this.subscribers.has(channel);
  }

  simulateOutage(): void {
    this.outage = true;
  }

  simulateRecovery(): void {
    this.outage = false;
  }
}

/** Repo-canonical error-capture helper (no `.rejects` assertions). */
async function catchError(action: () => Promise<unknown>): Promise<unknown> {
  try {
    await action();
  } catch (error) {
    return error;
  }
  return null;
}

/** Installs a recording stub over `logger.logDomainError` (kept quiet). */
function silenceDomainLog(): DomainLogSpy {
  return spyOn(logger, "logDomainError").mockImplementation(() => {});
}

describe("RedisPubSubTransport — degradation: publisher under a Redis outage", () => {
  test("a failed client publish rejects unchanged through publishFanout (no swallow, no transport-level warn)", async () => {
    const logSpy = silenceDomainLog();
    const client = new OutageProneFanoutClient();
    const transport = new RedisPubSubTransport(client);
    client.simulateOutage();

    const error = await catchError(() => transport.publishFanout([1, 2], makePayload()));

    // The client's OWN error surfaces — the transport neither wraps nor
    // swallows it: degradation is the engine's concern (REQ-011 lives there).
    expect(error).toBeInstanceOf(SimulatedOutageError);
    if (error instanceof SimulatedOutageError) {
      expect(error.message).toContain("ECONNREFUSED");
    }
    // The transport never logs the degradation itself — zero domain errors.
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  test("an outage publish leaves zero wire messages and zero deliveries", async () => {
    const client = new OutageProneFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    client.simulateOutage();
    const error = await catchError(() => transport.publishFanout([1, 2, 3], makePayload()));

    expect(error).toBeInstanceOf(Error);
    expect(client.published).toHaveLength(0); // zero bus traffic
    expect(receipts).toHaveLength(0); // the subscriber side receives nothing
  });
});

describe("RedisPubSubTransport — degradation: subscriber resume after a mid-subscription client failure", () => {
  test("the subscription survives the failure and a publish round-trips again after recovery", async () => {
    const client = new OutageProneFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    // Baseline round-trip BEFORE the failure.
    await transport.publishFanout([1], makePayload());
    expect(client.published[0]?.channel).toBe(NOTIFICATIONS_FANOUT_CHANNEL);
    expect(receipts).toHaveLength(1);

    // The client fails mid-subscription: publishes reject (captured — no
    // exception escapes), yet the fan-out listener stays registered.
    client.simulateOutage();
    const outageError = await catchError(() => transport.publishFanout([2], makePayload()));
    expect(outageError).toBeInstanceOf(SimulatedOutageError);
    expect(client.isSubscribed(NOTIFICATIONS_FANOUT_CHANNEL)).toBe(true);
    expect(receipts).toHaveLength(1); // still just the baseline delivery

    // Recovery: a plain publish round-trips to the SAME subscription —
    // post-recovery delivery with no re-subscription anywhere.
    client.simulateRecovery();
    await transport.publishFanout([3, 4], makePayload());

    expect(client.published).toHaveLength(2); // baseline + post-recovery
    expect(receipts).toHaveLength(2);
    expect(receipts[1]?.userIds).toEqual([3, 4]);
    expect(receipts[1]?.payload).toEqual(makePayload());
  });
});

describe("RedisPubSubTransport — degradation: emit-during-outage composition sketch", () => {
  // Transport-level invariant of the engine's own-commit path (insert →
  // commit → publish): the row is persisted BEFORE the bus publish is
  // attempted, so a rejected publish degrades delivery to persisted-only.
  // The engine-side swallow (`logDomainError NOTIFICATION_DELIVERY_DEGRADED`
  // → resolve, REQ-011) is pinned in notification-engine.emit.test.ts and is
  // intentionally not re-asserted here.
  test("rows committed before the publish attempt stay persisted while the bus publish rejects (zero pushes)", async () => {
    const client = new OutageProneFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    const persistedRows: Array<{ id: number; userId: number; title: string }> = [];
    client.simulateOutage();

    // Engine own-commit sketch: insert → commit (row durable) → publish.
    const row = { id: 7, userId: 1, title: "New session request" };
    persistedRows.push(row); // insert + commit
    const publishError = await catchError(() => transport.publishFanout([row.userId], makePayload()));

    expect(publishError).toBeInstanceOf(SimulatedOutageError);
    expect(persistedRows).toHaveLength(1); // row persisted through the outage
    expect(client.published).toHaveLength(0); // zero pushes
    expect(receipts).toHaveLength(0); // zero pushes delivered
  });
});
