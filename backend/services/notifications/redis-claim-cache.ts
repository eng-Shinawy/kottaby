/**
 * RedisClaimCache — ioredis-backed `NotificationIdempotencyClaimCache` (the
 * emit-idempotency claim port) plus the `resolveBroadcastClaimCache()` factory.
 *
 * The adapter is a THIN command mapper — it owns no policy:
 *  - `claim`  → `SET key "1" NX EX ttl` — `"OK"` = this caller WON the claim
 *    (proceed with the write), `null` = the key is already held (duplicate).
 *  - `store`  → `SET key value EX ttl` — plain SET-with-TTL overwrite; the
 *    engine attaches the serialized delivery receipt AFTER its insert commits.
 *  - `get`    → `GET` — the stored value for an already-claimed key, or `null`.
 *
 * Failure posture: command rejections surface UNCHANGED to the caller — the
 * cache never swallows and never substitutes a synthetic claim/store/get
 * result. Fail-open degradation (one structured warn, proceed with the emit)
 * is the ENGINE's documented concern (`attemptEmitClaim` /
 * `storeEmitReceiptQuietly`); this layer throwing honestly is what makes that
 * posture correct. Nothing here logs on the hot path — keys are the engine's
 * SHA-256 digests and values are engine receipts, and neither is ever logged.
 *
 * The only log site is the shared client's `error` event listener (connection
 * outages): one structured entry with the error NAME only — never the URL
 * (it can carry credentials) and never a key or value.
 */
import { Redis } from "ioredis";
import { getRedisUrl } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import type { NotificationIdempotencyClaimCache } from "@/backend/services/notifications/emit-idempotency";

/** Sentinel stored under a claimed key until the engine attaches its receipt. */
const CLAIM_SENTINEL_VALUE = "1";

/**
 * Minimal Redis command surface the claim cache drives — the SET command in
 * exactly the shape this adapter issues it (`SET key value EX seconds [NX]`).
 *
 * The ioredis `Redis` client satisfies this structurally; tests inject an
 * in-memory double instead — no test ever dials a real server.
 */
export interface RedisClaimCommands {
  /**
   * Resolves `"OK"` when the command landed; resolves `null` only when the
   * `NX` guard found the key already held.
   */
  set(key: string, value: string, secondsToken: "EX", seconds: number, nx?: "NX"): Promise<string | null>;
  get(key: string): Promise<string | null>;
}

/**
 * Maps the engine's claim port onto Redis string commands. Stateless per
 * instance — all state lives in Redis; the client is injected, never
 * constructed here (mirrors the realtime adapter conventions).
 */
export class RedisClaimCache implements NotificationIdempotencyClaimCache {
  private readonly redis: RedisClaimCommands;

  constructor(redis: RedisClaimCommands) {
    this.redis = redis;
  }

  /**
   * Atomic SET-NX-EX claim. `true` = won (proceed with the write); `false` =
   * the key is already held (duplicate emission attempt). Client failures
   * reject unchanged — the engine's fail-open handlers own the degradation.
   */
  async claim(key: string, ttlSeconds: number): Promise<boolean> {
    const outcome = await this.redis.set(key, CLAIM_SENTINEL_VALUE, "EX", ttlSeconds, "NX");
    return outcome === "OK";
  }

  /**
   * SET-with-TTL overwrite. Attaching a receipt over a held claim is a plain
   * SET (no NX) so a post-commit store always lands, resetting the window.
   */
  async store(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, "EX", ttlSeconds);
  }

  /** Reads the stored receipt payload for an already-claimed key, or `null`. */
  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }
}

/**
 * Process-lifetime shared client + cache, built on FIRST configured resolve —
 * never at import time (importing this module constructs nothing and dials
 * nothing). The client is `lazyConnect`, so even construction only opens a
 * socket when the first command is issued; one connection is shared by every
 * consumer for the process's lifetime (env is process-lifetime configuration:
 * the shared client binds to the URL observed at first configured resolve).
 */
let sharedClaimCache: RedisClaimCache | undefined;

/**
 * Resolves the production claim cache from the registered env seam.
 *
 * Stateless decision, re-read from `getRedisUrl()` on EVERY call: no
 * `REDIS_URL` → `undefined` (the hermetic default — the engine then proceeds
 * fail-open with its single documented degrade warn and emits anyway). With a
 * configured URL, the lazily-constructed shared client is returned behind the
 * port, memoized so repeated resolutions never dial additional connections.
 */
export function resolveBroadcastClaimCache(): NotificationIdempotencyClaimCache | undefined {
  const redisUrl = getRedisUrl();
  if (redisUrl === undefined) {
    return undefined;
  }
  if (sharedClaimCache === undefined) {
    const redis = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      // Bounds each claim round-trip and dial attempt so a silently dropping
      // Redis cannot hold the caller's open transaction on ioredis' default
      // (unbounded) wait; a timed-out command rejects into the engine's
      // documented fail-open path.
      commandTimeout: 2_000,
      connectTimeout: 2_000,
    });
    // Kept attached so connection failures never become unhandled "error"
    // events; command failures already surface through their promises, where
    // the engine owns the fail-open warn. errorName only — never the URL.
    // Throttled: ioredis emits "error" on EVERY failed reconnect attempt, so
    // during an outage only the FIRST failure logs; the flag re-arms on
    // "ready" so a recovered-then-rebroken client logs its next failure too.
    let logNextConnectionError = true;
    redis.on("error", (error: Error) => {
      if (!logNextConnectionError) {
        return;
      }
      logNextConnectionError = false;
      logger.logDomainError("Redis claim cache connection error", {
        code: "NOTIFICATION_CLAIM_REDIS_UNAVAILABLE",
        entity: "notifications",
        errorName: error.name,
      });
    });
    redis.on("ready", () => {
      logNextConnectionError = true;
    });
    sharedClaimCache = new RedisClaimCache(redis);
  }
  return sharedClaimCache;
}
