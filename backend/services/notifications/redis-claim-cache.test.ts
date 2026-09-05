/**
 * `RedisClaimCache` + `resolveBroadcastClaimCache` — unit suite.
 *
 * Coverage map:
 *  - Tier 1 (branch/stmt): SET-NX-EX outcome mapping (won `"OK"` → `true`,
 *    held `null` → `false`), the `"1"` claim sentinel, store/get round-trip
 *    shapes (stored value verbatim, unknown key → `null`, overwrite without
 *    NX).
 *  - Tier 2 (boundary): TTL propagation (the engine's 24h emit-claim constant
 *    and a custom TTL) and byte-for-byte key pass-through for claim/store/get.
 *  - Tier 3 (chaos): a failing client command rejects the cache promise with
 *    the SAME error object — the cache never swallows, never maps a failure
 *    onto a synthetic won/held answer (the engine's fail-open handlers own
 *    degradation and can only do so from an honest rejection).
 *  - Tier 4 (security/hostile + factory env matrix): zero logger calls across
 *    every cache operation (keys are the engine's SHA-256 digests and values
 *    are engine receipts — neither is ever logged), `REDIS_URL` never logged
 *    during factory resolution, no `console.*` in the module source, and the
 *    factory's env matrix (undefined when unset/whitespace, defined + shared
 *    instance when configured, per-call re-gating; env restored in `finally`).
 *
 * The Redis client is an in-memory double (`InMemoryRedisClient`) — no test
 * ever contacts a real server. The factory tests DO construct the default
 * ioredis client against an unreachable loopback port: `lazyConnect` means
 * construction never dials, so the suite completing without hanging is itself
 * the no-dial proof (same technique as the fanout-transport factory suite).
 *
 * Runs via the mandated runner: `bun run test/scripts/run-test.ts <path>`.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { type DomainErrorContext, logger } from "@/backend/lib/logger";
import {
  NOTIFICATION_EMIT_CLAIM_TTL_SECONDS,
  type NotificationIdempotencyClaimCache,
} from "@/backend/services/notifications/emit-idempotency";
import {
  RedisClaimCache,
  type RedisClaimCommands,
  resolveBroadcastClaimCache,
} from "@/backend/services/notifications/redis-claim-cache";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A key shaped exactly like the engine's claim keys (never a raw identity). */
const CLAIM_KEY = "notif:emit:9f2b0c4d5e6a7182b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a";

/** A second digest-shaped key (overwrite/second-identity cases). */
const OTHER_CLAIM_KEY = "notif:emit:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** Loopback endpoint with nothing listening — construction never dials it. */
const UNREACHABLE_REDIS_URL = "redis://127.0.0.1:6399";

/** Credential-bearing URL proving the secret never reaches the logger. */
const SECRET_REDIS_URL = "redis://claim-user:claim-secret@127.0.0.1:6399/9";

/** Serialized receipt-shaped payload (opaque bytes to the cache). */
const RECEIPT_PAYLOAD = JSON.stringify({
  notifications: [
    {
      id: 1,
      userId: 7,
      type: "system_broadcast",
      title: "t",
      body: null,
      isRead: false,
      relatedEntityType: null,
      relatedEntityId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  recipientUserIds: [7],
});

/**
 * In-memory Redis string-command double. Faithful to the two commands the
 * cache issues: `SET key value EX seconds [NX]` (NX fails on a held key with
 * `null`) and `GET`. Records every call for the Tier 2 shape assertions and
 * can be armed to throw (Tier 3).
 */
class InMemoryRedisClient implements RedisClaimCommands {
  readonly recordedSets: Array<{
    readonly key: string;
    readonly value: string;
    readonly secondsToken: "EX";
    readonly seconds: number;
    readonly nx: "NX" | undefined;
  }> = [];

  readonly recordedGets: string[] = [];

  /** Key → value, exactly what a real server would hold. */
  readonly values = new Map<string, string>();

  setFailure: Error | undefined;
  getFailure: Error | undefined;

  async set(key: string, value: string, secondsToken: "EX", seconds: number, nx?: "NX"): Promise<string | null> {
    this.recordedSets.push({ key, value, secondsToken, seconds, nx });
    if (this.setFailure !== undefined) {
      throw this.setFailure;
    }
    if (nx === "NX" && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return "OK";
  }

  async get(key: string): Promise<string | null> {
    this.recordedGets.push(key);
    if (this.getFailure !== undefined) {
      throw this.getFailure;
    }
    return this.values.get(key) ?? null;
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

/** Installs a recording stub over `logger.logDomainError` (silenced + counted). */
function recordDomainLogs(): { spy: ReturnType<typeof spyOn>; entries: Array<{ code: string; entity: string }> } {
  const entries: Array<{ code: string; entity: string }> = [];
  const spy = spyOn(logger, "logDomainError").mockImplementation((_message: string, ctx?: DomainErrorContext) => {
    entries.push({ code: ctx?.code ?? "MISSING_CODE", entity: ctx?.entity ?? "MISSING_ENTITY" });
  });
  return { spy, entries };
}

// ─── Env-manipulation fixture (restored in finally AND afterEach) ────────────

const FACTORY_ENV_KEYS = ["REDIS_URL"] as const;
const originalEnv: Record<string, string | undefined> = {};
for (const key of FACTORY_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

/** Applies a REDIS_URL fixture and re-reads it (the env seam caches by design). */
function setRedisUrl(value: string | undefined): void {
  if (value === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = value;
  }
  resetEnvironmentCache();
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

// ─── Tier 1: outcome mapping + round-trip shapes ─────────────────────────────

describe("RedisClaimCache — claim outcome mapping (SET NX EX)", () => {
  test("a fresh key WINS the claim (SET NX EX resolves OK → true)", async () => {
    const cache = new RedisClaimCache(new InMemoryRedisClient());

    const won = await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(won).toBe(true);
  });

  test("a held key LOSES the claim (SET NX EX resolves null → false)", async () => {
    const client = new InMemoryRedisClient();
    client.values.set(CLAIM_KEY, "held-by-another-emitter");
    const cache = new RedisClaimCache(client);

    const won = await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(won).toBe(false);
  });

  test("a won claim stores the '1' sentinel under the key (pre-receipt state)", async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(client.values.get(CLAIM_KEY)).toBe("1");
  });

  test("a lost claim never overwrites the held value", async () => {
    const client = new InMemoryRedisClient();
    client.values.set(CLAIM_KEY, "held-by-another-emitter");
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(client.values.get(CLAIM_KEY)).toBe("held-by-another-emitter");
  });
});

describe("RedisClaimCache — store/get round-trip shapes", () => {
  test("store then get returns the value verbatim; an unknown key returns null", async () => {
    const cache = new RedisClaimCache(new InMemoryRedisClient());

    await cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    const stored = await cache.get(CLAIM_KEY);
    const unknown = await cache.get(OTHER_CLAIM_KEY);

    expect(stored).toBe(RECEIPT_PAYLOAD);
    expect(unknown).toBeNull();
  });

  test("store overwrites a prior value (plain SET — the post-commit receipt lands)", async () => {
    const cache = new RedisClaimCache(new InMemoryRedisClient());

    await cache.store(CLAIM_KEY, "pre-commit-sentinel", 60);
    await cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(await cache.get(CLAIM_KEY)).toBe(RECEIPT_PAYLOAD);
  });

  test("store resolves void (the engine's receipt store treats it as fire-and-forget)", async () => {
    const cache = new RedisClaimCache(new InMemoryRedisClient());

    const outcome = await cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    expect(outcome).toBeUndefined();
  });
});

// ─── Tier 2: TTL propagation + key pass-through ──────────────────────────────

describe("RedisClaimCache — TTL propagation and key pass-through", () => {
  test("claim propagates the engine's 24h TTL as EX seconds with the NX guard", async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    const recorded = client.recordedSets.at(0);
    expect(recorded?.key).toBe(CLAIM_KEY);
    expect(recorded?.value).toBe("1");
    expect(recorded?.secondsToken).toBe("EX");
    expect(recorded?.seconds).toBe(NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    expect(recorded?.nx).toBe("NX");
  });

  test("claim propagates a custom TTL unchanged (the cache owns no TTL policy)", async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, 60);

    const recorded = client.recordedSets.at(0);
    expect(recorded?.seconds).toBe(60);
    expect(recorded?.nx).toBe("NX");
  });

  test("store carries EX + TTL and NO NX token (an overwrite must never fail on a held key)", async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);

    const recorded = client.recordedSets.at(0);
    expect(recorded?.key).toBe(CLAIM_KEY);
    expect(recorded?.value).toBe(RECEIPT_PAYLOAD);
    expect(recorded?.secondsToken).toBe("EX");
    expect(recorded?.seconds).toBe(NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    expect(recorded?.nx).toBeUndefined();
  });

  test("keys pass through byte-for-byte for claim, store and get (digests are never transformed)", async () => {
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, 60);
    await cache.store(OTHER_CLAIM_KEY, RECEIPT_PAYLOAD, 60);
    await cache.get(CLAIM_KEY);

    expect(client.recordedSets.map(entry => entry.key)).toEqual([CLAIM_KEY, OTHER_CLAIM_KEY]);
    expect([...client.recordedGets]).toEqual([CLAIM_KEY]);
  });
});

// ─── Tier 3: honest failures (the engine owns fail-open) ─────────────────────

describe("RedisClaimCache — client failures reject honestly (never swallowed)", () => {
  test("claim rejects with the client's exact error — never mapped to a synthetic won/held", async () => {
    const failure = new Error("connection refused");
    const client = new InMemoryRedisClient();
    client.setFailure = failure;
    const cache = new RedisClaimCache(client);

    const error = await catchError(() => cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS));

    expect(error).toBe(failure);
  });

  test("store rejects with the client's exact error (a silent void would fake a stored receipt)", async () => {
    const failure = new Error("write timeout");
    const client = new InMemoryRedisClient();
    client.setFailure = failure;
    const cache = new RedisClaimCache(client);

    const error = await catchError(() => cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS));

    expect(error).toBe(failure);
  });

  test("get rejects with the client's exact error (a null would fake a non-replayable claim)", async () => {
    const failure = new Error("read timeout");
    const client = new InMemoryRedisClient();
    client.getFailure = failure;
    const cache = new RedisClaimCache(client);

    const error = await catchError(() => cache.get(CLAIM_KEY));

    expect(error).toBe(failure);
  });

  test("a failed claim stores nothing and leaves the value map untouched", async () => {
    const client = new InMemoryRedisClient();
    client.setFailure = new Error("connection refused");
    const cache = new RedisClaimCache(client);

    await catchError(() => cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS));

    expect(client.values.has(CLAIM_KEY)).toBe(false);
  });
});

// ─── Tier 4: log hygiene + factory env matrix ────────────────────────────────

describe("RedisClaimCache — log hygiene (keys and receipts are never logged)", () => {
  let logs: ReturnType<typeof recordDomainLogs>;

  afterEach(() => {
    logs.spy.mockRestore();
  });

  test("no logger call is made across claim won/lost, store and get — the cache never logs", async () => {
    logs = recordDomainLogs();
    const client = new InMemoryRedisClient();
    const cache = new RedisClaimCache(client);

    await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    await cache.claim(OTHER_CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    await cache.claim(CLAIM_KEY, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    await cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, NOTIFICATION_EMIT_CLAIM_TTL_SECONDS);
    await cache.get(CLAIM_KEY);

    expect(logs.entries).toHaveLength(0);
    expect(logs.spy).not.toHaveBeenCalled();
  });

  test("even client failures produce zero logger calls at the cache layer (engine-owned warn)", async () => {
    logs = recordDomainLogs();
    const client = new InMemoryRedisClient();
    client.setFailure = new Error("connection refused");
    client.getFailure = new Error("read timeout");
    const cache = new RedisClaimCache(client);

    await catchError(() => cache.claim(CLAIM_KEY, 60));
    await catchError(() => cache.store(CLAIM_KEY, RECEIPT_PAYLOAD, 60));
    await catchError(() => cache.get(CLAIM_KEY));

    expect(logs.entries).toHaveLength(0);
    expect(logs.spy).not.toHaveBeenCalled();
  });

  test("the module source contains no console.* (static scan)", () => {
    const source = readFileSync(join(import.meta.dir, "redis-claim-cache.ts"), "utf8");
    expect(source.includes("console.")).toBe(false);
  });
});

describe("resolveBroadcastClaimCache — factory env matrix", () => {
  afterEach(restoreEnv);

  test("undefined when REDIS_URL is absent (hermetic default → engine fail-open warn)", () => {
    setRedisUrl(undefined);

    let resolved: NotificationIdempotencyClaimCache | undefined;
    try {
      resolved = resolveBroadcastClaimCache();
    } finally {
      restoreEnv();
    }

    expect(resolved).toBeUndefined();
  });

  test("undefined when REDIS_URL is whitespace-only (the env seam trims emptiness away)", () => {
    setRedisUrl("   ");

    let resolved: NotificationIdempotencyClaimCache | undefined;
    try {
      resolved = resolveBroadcastClaimCache();
    } finally {
      restoreEnv();
    }

    expect(resolved).toBeUndefined();
  });

  test("defined when REDIS_URL is set — assignable to the engine's port, no dial (lazyConnect)", () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);

    let resolved: NotificationIdempotencyClaimCache | undefined;
    try {
      resolved = resolveBroadcastClaimCache();
    } finally {
      restoreEnv();
    }

    expect(resolved).toBeInstanceOf(RedisClaimCache);
    expect(typeof resolved?.claim).toBe("function");
    expect(typeof resolved?.store).toBe("function");
    expect(typeof resolved?.get).toBe("function");
  });

  test("repeated resolution returns the SAME shared instance (one process-lifetime client)", () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);

    let first: NotificationIdempotencyClaimCache | undefined;
    let second: NotificationIdempotencyClaimCache | undefined;
    try {
      first = resolveBroadcastClaimCache();
      second = resolveBroadcastClaimCache();
    } finally {
      restoreEnv();
    }

    expect(first).not.toBeUndefined();
    expect(second).toBe(first);
  });

  test("unsetting after a configured resolve yields undefined again (the env gate is per-call)", () => {
    setRedisUrl(UNREACHABLE_REDIS_URL);
    try {
      expect(resolveBroadcastClaimCache()).not.toBeUndefined();
      setRedisUrl(undefined);
      expect(resolveBroadcastClaimCache()).toBeUndefined();
    } finally {
      restoreEnv();
    }
  });

  test("REDIS_URL (including embedded credentials) is never logged during resolution", () => {
    const logs = recordDomainLogs();
    try {
      setRedisUrl(SECRET_REDIS_URL);
      resolveBroadcastClaimCache();
      setRedisUrl(undefined);
      expect(resolveBroadcastClaimCache()).toBeUndefined();
    } finally {
      restoreEnv();
      logs.spy.mockRestore();
    }

    expect(logs.entries).toHaveLength(0);
    expect(logs.spy).not.toHaveBeenCalled();
  });
});
