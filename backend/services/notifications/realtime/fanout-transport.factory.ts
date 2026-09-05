/**
 * Fan-out transport selection factory.
 *
 * Reads ONLY the registered env seam (`getNotificationFanoutTransport()` +
 * `getRedisUrl()` from `@/backend/lib/env`): the resolved transport
 * selection (explicit `NOTIFICATION_FANOUT_TRANSPORT` value or the
 * Redis-URL default ladder) picks the Redis bus; everything else gets the
 * in-process tap.
 *
 * The factory is stateless (no memoization, no module-level mutable state):
 * consumers that need a stable default instance resolve once at their own
 * seam. The default Redis client is built lazily — ioredis is only loaded
 * when the Redis bus is actually selected, keeping the adapter dependency
 * out of in-process/test processes entirely.
 */
import { getNotificationFanoutTransport, getRedisUrl } from "@/backend/lib/env";
import type {
  NotificationFanoutSubscriptionSource,
  NotificationFanoutTransport,
} from "@/backend/services/notifications/realtime/fanout-transport";
import { InProcessTransport } from "@/backend/services/notifications/realtime/in-process-transport";
import {
  type RedisFanoutClient,
  RedisPubSubTransport,
} from "@/backend/services/notifications/realtime/redis-pubsub-transport";

/** Injection options for transport resolution. */
export interface FanoutTransportOptions {
  /**
   * Pre-built Redis client for the Redis bus (tests inject an in-memory
   * double; callers that own the connection inject theirs). When omitted the
   * factory builds the default ioredis-backed client from `REDIS_URL`.
   */
  readonly redisClient?: RedisFanoutClient;
}

/**
 * Resolves the fan-out transport selected by the registered env keys.
 *
 * @throws Error when the Redis bus is selected but no `REDIS_URL` is
 *   configured — a static misconfiguration fails fast at resolution instead
 *   of degrading silently (outages degrade later, at publish time).
 */
export async function resolveFanoutTransport(options?: FanoutTransportOptions): Promise<NotificationFanoutTransport> {
  return resolveTransportInstance(options);
}

/**
 * Resolves the SUBSCRIBE side of the same env-driven selection — the
 * WebSocket sidecar's symmetric entry (both concrete adapters implement the
 * subscription source, but the publish-only port type deliberately does not
 * expose it).
 *
 * Callers that need to own the Redis connection's lifecycle (e.g. the
 * sidecar entry closing the client on shutdown) inject their client; the
 * same fail-fast misconfiguration guard as the publish side applies.
 */
export async function resolveFanoutSubscriptionSource(
  options?: FanoutTransportOptions
): Promise<NotificationFanoutSubscriptionSource> {
  return resolveTransportInstance(options);
}

/** Shared selection core — both adapters satisfy BOTH port interfaces. */
async function resolveTransportInstance(
  options?: FanoutTransportOptions
): Promise<InProcessTransport | RedisPubSubTransport> {
  if (getNotificationFanoutTransport() !== "redis") {
    return new InProcessTransport();
  }
  const client = options?.redisClient ?? (await createDefaultRedisFanoutClient());
  return new RedisPubSubTransport(client);
}

/** Builds the default Redis client from the registered `REDIS_URL` key. */
async function createDefaultRedisFanoutClient(): Promise<RedisFanoutClient> {
  const redisUrl = getRedisUrl();
  if (redisUrl === undefined) {
    throw new Error(
      'NOTIFICATION_FANOUT_TRANSPORT="redis" requires REDIS_URL to be set — add it to .env (see .env.example).'
    );
  }
  // Lazy adapter import (the backend's documented lazy-import exception):
  // ioredis loads only when the Redis bus is actually selected.
  const { IoredisFanoutClient } = await import("@/backend/services/notifications/realtime/ioredis-fanout-client");
  return new IoredisFanoutClient(redisUrl);
}
