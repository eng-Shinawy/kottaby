/**
 * `RedisPubSubTransport` — unit suite over an injected in-memory Redis client
 * double (never a real socket, never a real channel).
 *
 * Coverage map:
 *  - Tier 1 (round-trip): publish → channel routing → subscribed listener
 *    receives the typed envelope (createdAt revived to a Date); unsubscribe
 *    stops delivery; the on-the-wire envelope is pinned to the allowlisted
 *    key sets (top level / payload / data projection) and carries no
 *    recipient identifier inside the payload.
 *  - Tier 2 (empty fan-out): an empty recipient list publishes nothing at
 *    all — zero bus traffic, zero deliveries.
 *  - Tier 3 (outage + reconnect): a simulated Redis outage rejects
 *    `publishFanout` cleanly (the error propagates — degradation is the
 *    engine's concern); after recovery the SAME subscription keeps
 *    delivering without any re-subscription.
 *  - Tier 4 (payload integrity): the runtime shape guard drops every
 *    malformed envelope — non-JSON, wrong shapes, extra/missing keys,
 *    non-positive ids, foreign notification types, unparseable timestamps —
 *    with one structured warn per message and no exception escaping the
 *    message handler (any escape fails the test itself); a throwing listener
 *    is logged and the loop survives.
 *
 * Pure unit tier — the Redis client is a fake (mock-adapter discipline). The
 * live-server smoke lives in `test/integration/redis/` behind a reachability
 * gate. Runs via the mandated runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { describe, expect, spyOn, test } from "bun:test";
import { logger } from "@/backend/lib/logger";
import {
  type FanoutEnvelope,
  NOTIFICATIONS_FANOUT_CHANNEL,
  parseFanoutEnvelope,
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

/**
 * In-memory Redis client double — a miniature pub/sub bus with channel
 * routing, plus outage controls for the reconnect tier.
 */
class FakeRedisFanoutClient implements RedisFanoutClient {
  readonly published: Array<{ channel: string; message: string }> = [];
  private readonly subscribers = new Map<string, (message: string) => void>();
  private outage = false;

  publish(channel: string, message: string): Promise<unknown> {
    if (this.outage) {
      return Promise.reject(new Error("connect ECONNREFUSED (simulated Redis outage)"));
    }
    this.published.push({ channel, message });
    const subscriber = this.subscribers.get(channel);
    subscriber?.(message);
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

  /** Bus-side delivery without publishing (subscriber-path injection). */
  deliver(channel: string, message: string): void {
    const subscriber = this.subscribers.get(channel);
    subscriber?.(message);
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

/** A mutable view of the valid envelope, for building malformed variants. */
interface MutableData {
  [key: string]: unknown;
}

interface MutablePayload {
  [key: string]: unknown;
  data: MutableData;
}

interface MutableEnvelope {
  [key: string]: unknown;
  userIds: unknown;
  payload: MutablePayload;
}

/** The valid envelope as a fully mutable fixture. */
function mutableEnvelope(): MutableEnvelope {
  const payload = makePayload();
  return {
    userIds: [5, 6],
    payload: {
      v: 1,
      kind: "notification",
      data: {
        id: payload.data.id,
        type: payload.data.type,
        title: payload.data.title,
        body: payload.data.body,
        relatedEntityType: payload.data.relatedEntityType,
        relatedEntityId: payload.data.relatedEntityId,
        createdAt: payload.data.createdAt.toISOString(),
      },
    },
  };
}

/** Rebuilds the valid envelope with one mutation applied. */
function withMutation(mutate: (envelope: MutableEnvelope) => void): string {
  const envelope = mutableEnvelope();
  mutate(envelope);
  return JSON.stringify(envelope);
}

/** A well-formed envelope message, as the publish side emits it. */
function validEnvelopeMessage(): string {
  return JSON.stringify(mutableEnvelope());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

describe("RedisPubSubTransport — Tier 1: publish/subscribe round-trip", () => {
  test("a subscribed listener receives the envelope through the channel routing", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    const payload = makePayload();
    await transport.publishFanout([1, 2], payload);

    expect(client.published).toHaveLength(1);
    expect(client.published[0]?.channel).toBe(NOTIFICATIONS_FANOUT_CHANNEL);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.userIds).toEqual([1, 2]);
    expect(receipts[0]?.payload).toEqual(payload);
  });

  test("the revived payload carries a real Date for createdAt (type-true round-trip)", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    await transport.publishFanout([9], makePayload());

    const revived = receipts[0]?.payload.data.createdAt;
    expect(revived).toBeInstanceOf(Date);
    expect(revived?.toISOString()).toBe("2026-08-29T12:00:00.000Z");
  });

  test("unsubscribe stops delivery on the fixed channel", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    const subscription = await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    await subscription.unsubscribe();
    await transport.publishFanout([1], makePayload());

    expect(receipts).toHaveLength(0);
  });

  test("the wire envelope carries EXACTLY the allowlisted keys and no recipient id inside the payload", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    await transport.subscribeFanout(() => {});

    await transport.publishFanout([12, 13], makePayload());

    const onWire: unknown = JSON.parse(client.published[0]?.message ?? "null");
    expect(isPlainRecord(onWire)).toBe(true);
    if (isPlainRecord(onWire)) {
      expect(Object.keys(onWire).toSorted((a, b) => a.localeCompare(b))).toEqual(["payload", "userIds"]);
      const payload = onWire.payload;
      if (isPlainRecord(payload)) {
        expect(Object.keys(payload).toSorted((a, b) => a.localeCompare(b))).toEqual(["data", "kind", "v"]);
        const data = payload.data;
        if (isPlainRecord(data)) {
          expect(Object.keys(data).toSorted((a, b) => a.localeCompare(b))).toEqual([
            "body",
            "createdAt",
            "id",
            "relatedEntityId",
            "relatedEntityType",
            "title",
            "type",
          ]);
          // No account identifier rides inside the payload — the recipient is
          // implied by the socket the envelope is routed to.
          expect(Object.hasOwn(data, "userId")).toBe(false);
        }
      }
    }
  });

  test("extra properties smuggled past the compile-time type never reach the bus", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    await transport.subscribeFanout(() => {});

    const widened: RealtimeNotificationPayload & { smuggled: string } = { ...makePayload(), smuggled: "secret" };
    await transport.publishFanout([1], widened);

    const onWire = client.published[0]?.message ?? "";
    expect(onWire.includes("smuggled")).toBe(false);
    expect(onWire.includes("secret")).toBe(false);
  });
});

describe("RedisPubSubTransport — Tier 2: empty fan-out", () => {
  test("an empty recipient list publishes nothing at all", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    await transport.publishFanout([], makePayload());

    expect(client.published).toHaveLength(0);
    expect(receipts).toHaveLength(0);
  });
});

describe("RedisPubSubTransport — Tier 3: outage and reconnect", () => {
  test("publish during an outage rejects cleanly (degradation is the engine's concern)", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    client.simulateOutage();

    const error = await catchError(() => transport.publishFanout([1], makePayload()));

    expect(error).toBeInstanceOf(Error);
  });

  test("the subscription survives an outage and resumes without re-subscription", async () => {
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    client.simulateOutage();
    const outageError = await catchError(() => transport.publishFanout([1], makePayload()));
    expect(outageError).toBeInstanceOf(Error);
    expect(receipts).toHaveLength(0);

    client.simulateRecovery();
    await transport.publishFanout([2, 3], makePayload());

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.userIds).toEqual([2, 3]);
  });
});

describe("RedisPubSubTransport — Tier 4: malformed envelopes never crash the loop", () => {
  test("every malformed message is dropped with one structured warn and zero deliveries", async () => {
    const logSpy = silenceDomainLog();
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    const malformed: Array<[string, string]> = [
      ["not JSON", "oops {"],
      ["empty string", ""],
      ["null literal", "null"],
      ["array root", "[1,2,3]"],
      ["number root", "42"],
      ["string root", '"envelope"'],
      ["missing payload", JSON.stringify({ userIds: [5] })],
      ["missing userIds", JSON.stringify({ payload: { v: 1, kind: "notification", data: {} } })],
      ["extra top-level key", withMutation(envelope => (envelope.traceId = "x"))],
      ["userIds not an array", withMutation(envelope => (envelope.userIds = "5,6"))],
      ["userIds empty", withMutation(envelope => (envelope.userIds = []))],
      ["userIds zero", withMutation(envelope => (envelope.userIds = [0]))],
      ["userIds negative", withMutation(envelope => (envelope.userIds = [-6]))],
      ["userIds fractional", withMutation(envelope => (envelope.userIds = [5.5]))],
      ["userIds string member", withMutation(envelope => (envelope.userIds = ["5"]))],
      ["userIds mixed validity", withMutation(envelope => (envelope.userIds = [5, "6"]))],
      ["payload missing data", JSON.stringify({ userIds: [5, 6], payload: { v: 1, kind: "notification" } })],
      [
        "payload extra key",
        JSON.stringify({ userIds: [5, 6], payload: { v: 1, kind: "notification", data: {}, extra: 1 } }),
      ],
      ["payload wrong version", withMutation(envelope => (envelope.payload.v = 2))],
      ["payload wrong kind", withMutation(envelope => (envelope.payload.kind = "other"))],
      ["data extra key", withMutation(envelope => (envelope.payload.data.smuggled = "x"))],
      ["data missing key", withMutation(envelope => delete envelope.payload.data.body)],
      ["data id not positive", withMutation(envelope => (envelope.payload.data.id = -1))],
      ["data id fractional", withMutation(envelope => (envelope.payload.data.id = 1.5))],
      ["data type foreign", withMutation(envelope => (envelope.payload.data.type = "mega_broadcast"))],
      ["data type wrong primitive", withMutation(envelope => (envelope.payload.data.type = 7))],
      ["data title not a string", withMutation(envelope => (envelope.payload.data.title = 99))],
      ["data body not string/null", withMutation(envelope => (envelope.payload.data.body = 15))],
      [
        "data relatedEntityType not string/null",
        withMutation(envelope => (envelope.payload.data.relatedEntityType = 3)),
      ],
      [
        "data relatedEntityId not integer/null",
        withMutation(envelope => (envelope.payload.data.relatedEntityId = "session")),
      ],
      ["data createdAt not a string", withMutation(envelope => (envelope.payload.data.createdAt = 12345))],
      ["data createdAt unparseable", withMutation(envelope => (envelope.payload.data.createdAt = "not-a-date"))],
    ];

    // Any exception escaping the message handler fails the test itself —
    // the loop must survive every malformed input.
    for (const [, message] of malformed) {
      client.deliver(NOTIFICATIONS_FANOUT_CHANNEL, message);
      expect(receipts).toHaveLength(0);
    }

    expect(logSpy).toHaveBeenCalledTimes(malformed.length);
    const firstCall = logSpy.mock.calls[0];
    expect(firstCall?.[1]?.code).toBe("NOTIFICATION_FANOUT_ENVELOPE_INVALID");
    expect(firstCall?.[1]?.entity).toBe("notifications");
    logSpy.mockRestore();
  });

  test("a valid message delivered AFTER malformed ones still reaches the listener", async () => {
    const logSpy = silenceDomainLog();
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      receipts.push({ userIds, payload });
    });

    client.deliver(NOTIFICATIONS_FANOUT_CHANNEL, "garbage {");
    client.deliver(NOTIFICATIONS_FANOUT_CHANNEL, validEnvelopeMessage());

    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.userIds).toEqual([5, 6]);
    expect(receipts[0]?.payload).toEqual(makePayload());
    logSpy.mockRestore();
  });

  test("a throwing listener is logged and dropped — the loop survives", async () => {
    const logSpy = silenceDomainLog();
    const client = new FakeRedisFanoutClient();
    const transport = new RedisPubSubTransport(client);
    let throwOnce = true;
    const receipts: Receipt[] = [];
    await transport.subscribeFanout((userIds, payload) => {
      if (throwOnce) {
        throwOnce = false;
        throw new Error("listener exploded");
      }
      receipts.push({ userIds, payload });
    });

    client.deliver(NOTIFICATIONS_FANOUT_CHANNEL, validEnvelopeMessage());
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]?.[1]?.code).toBe("NOTIFICATION_FANOUT_LISTENER_ERROR");
    expect(receipts).toHaveLength(0);

    client.deliver(NOTIFICATIONS_FANOUT_CHANNEL, validEnvelopeMessage());
    expect(receipts).toHaveLength(1);
    logSpy.mockRestore();
  });
});

describe("parseFanoutEnvelope — runtime shape guard", () => {
  test("a valid envelope parses with createdAt revived to a Date", () => {
    const envelope: FanoutEnvelope | null = parseFanoutEnvelope(validEnvelopeMessage());

    expect(envelope).not.toBeNull();
    if (envelope !== null) {
      expect(envelope.userIds).toEqual([5, 6]);
      expect(envelope.payload).toEqual(makePayload());
      expect(envelope.payload.data.createdAt).toBeInstanceOf(Date);
    }
  });

  test("unparseable or truncated JSON never throws — the guard is total", () => {
    expect(parseFanoutEnvelope("")).toBeNull();
    expect(parseFanoutEnvelope("   ")).toBeNull();
    expect(parseFanoutEnvelope('{"userIds": [1], "payload": ')).toBeNull();
  });
});
