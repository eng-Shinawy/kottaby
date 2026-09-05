/**
 * `resolveFanoutTransport` selection factory — unit suite.
 *
 * Coverage map:
 *  - Selection matrix (through the registered env seam, cache-reset per
 *    case): explicit "in-process" wins over a configured Redis URL; the
 *    hermetic default (both keys absent) is the in-process tap; a configured
 *    `REDIS_URL` with no explicit selection picks the Redis bus (the default
 *    ladder); an explicit "redis" with an injected client returns the Redis
 *    adapter wired to THAT client.
 *  - Default client path: "redis" with no injected client builds the default
 *    ioredis-backed client (lazyConnect — construction never dials, so the
 *    suite completing without hanging is itself the no-dial proof).
 *  - Fail-fast configuration guard: "redis" without any `REDIS_URL` rejects
 *    with a descriptive configuration error instead of degrading silently.
 *
 * Pure unit tier — NO network, NO Redis, NO DB (the Redis adapter is driven
 * through an in-memory client double). Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts <path>`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { resolveFanoutTransport } from "@/backend/services/notifications/realtime/fanout-transport.factory";
import { InProcessTransport } from "@/backend/services/notifications/realtime/in-process-transport";
import {
  NOTIFICATIONS_FANOUT_CHANNEL,
  type RedisFanoutClient,
  RedisPubSubTransport,
} from "@/backend/services/notifications/realtime/redis-pubsub-transport";
import type { RealtimeNotificationPayload } from "@/backend/types";

// ─── Env-manipulation fixture (restored after every case) ───────────────────

const FACTORY_ENV_KEYS = ["NOTIFICATION_FANOUT_TRANSPORT", "REDIS_URL"] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of FACTORY_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of FACTORY_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

/** Applies an env fixture and re-reads it (the seam caches by design). */
function setEnv(transport: string | undefined, redisUrl: string | undefined): void {
  if (transport === undefined) {
    delete process.env.NOTIFICATION_FANOUT_TRANSPORT;
  } else {
    process.env.NOTIFICATION_FANOUT_TRANSPORT = transport;
  }
  if (redisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = redisUrl;
  }
  resetEnvironmentCache();
}

// ─── In-memory Redis client double (records what crosses the bus) ───────────

class RecordingRedisClient implements RedisFanoutClient {
  readonly published: Array<{ channel: string; message: string }> = [];

  publish(channel: string, message: string): Promise<unknown> {
    this.published.push({ channel, message });
    return Promise.resolve(1);
  }

  subscribe(): Promise<unknown> {
    return Promise.resolve(1);
  }

  unsubscribe(): Promise<unknown> {
    return Promise.resolve(1);
  }

  close(): Promise<void> {
    return Promise.resolve();
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

function makePayload(): RealtimeNotificationPayload {
  return {
    v: 1,
    kind: "notification",
    data: {
      id: 1,
      type: "payment_confirmation",
      title: "Payment received",
      body: null,
      relatedEntityType: "invoice",
      relatedEntityId: 77,
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
    },
  };
}

describe("resolveFanoutTransport — selection matrix", () => {
  afterEach(restoreEnv);

  test("explicit in-process wins even when a Redis URL is configured", async () => {
    setEnv("in-process", "redis://localhost:6379");

    const transport = await resolveFanoutTransport();

    expect(transport).toBeInstanceOf(InProcessTransport);
  });

  test("hermetic default (both keys absent) is the in-process tap", async () => {
    setEnv(undefined, undefined);

    const transport = await resolveFanoutTransport();

    expect(transport).toBeInstanceOf(InProcessTransport);
  });

  test("a configured Redis URL with no explicit selection picks the Redis bus (default ladder)", async () => {
    setEnv(undefined, "redis://localhost:6379");
    const redisClient = new RecordingRedisClient();

    const transport = await resolveFanoutTransport({ redisClient });

    expect(transport).toBeInstanceOf(RedisPubSubTransport);
  });

  test("explicit redis with an injected client returns the adapter wired to THAT client", async () => {
    setEnv("redis", undefined);
    const redisClient = new RecordingRedisClient();

    const transport = await resolveFanoutTransport({ redisClient });
    await transport.publishFanout([21], makePayload());

    expect(transport).toBeInstanceOf(RedisPubSubTransport);
    expect(redisClient.published).toHaveLength(1);
    expect(redisClient.published[0]?.channel).toBe(NOTIFICATIONS_FANOUT_CHANNEL);
  });

  test("explicit in-process ignores any injected Redis client", async () => {
    setEnv("in-process", undefined);
    const redisClient = new RecordingRedisClient();

    const transport = await resolveFanoutTransport({ redisClient });
    await transport.publishFanout([21], makePayload());

    expect(transport).toBeInstanceOf(InProcessTransport);
    expect(redisClient.published).toHaveLength(0);
  });
});

describe("resolveFanoutTransport — default Redis client path", () => {
  afterEach(restoreEnv);

  test("redis without an injected client builds the default lazy client (never dials)", async () => {
    // REDIS_URL points at a host with no server in this environment: the
    // default client is lazyConnect, so construction alone never connects —
    // the suite completing without hanging IS the no-dial proof.
    setEnv("redis", "redis://127.0.0.1:6399");

    const transport = await resolveFanoutTransport();

    expect(transport).toBeInstanceOf(RedisPubSubTransport);
  });
});

describe("resolveFanoutTransport — fail-fast configuration guard", () => {
  afterEach(restoreEnv);

  test("redis without any REDIS_URL rejects with a descriptive configuration error", async () => {
    setEnv("redis", undefined);

    const error = await catchError(() => resolveFanoutTransport());

    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toContain("REDIS_URL");
      expect(error.message).toContain("NOTIFICATION_FANOUT_TRANSPORT");
    }
  });
});
