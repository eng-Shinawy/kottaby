/**
 * IoredisFanoutClient — default `RedisFanoutClient` implementation over
 * ioredis (the documented local/self-hosted Redis client).
 *
 * Construction never dials (`lazyConnect`) and connection/command failures
 * surface as command rejections plus a structured warn — the host process
 * never crashes on an outage. Commands fail fast (`maxRetriesPerRequest: 1`)
 * so publishes reject promptly and callers degrade to persisted-only
 * delivery; the underlying connection keeps retrying with capped backoff, so
 * subscriptions resume automatically once Redis returns.
 *
 * Deliberately NOT re-exported through the realtime barrel: this module is
 * imported lazily (from the selection factory) so ioredis stays out of
 * in-process/test import graphs entirely.
 */
import { Redis, type RedisOptions } from "ioredis";
import { logger } from "@/backend/lib/logger";
import type { RedisFanoutClient } from "@/backend/services/notifications/realtime/redis-pubsub-transport";

export class IoredisFanoutClient implements RedisFanoutClient {
  private readonly redis: Redis;

  /** Per-channel message handlers (bounded by explicit subscriptions). */
  private readonly messageHandlers = new Map<string, (message: string) => void>();

  constructor(url: string, options?: RedisOptions) {
    this.redis = new Redis(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      ...options,
    });
    this.redis.on("message", (channel, message) => {
      this.messageHandlers.get(channel)?.(message);
    });
    // Kept attached so connection failures never become unhandled "error"
    // events; command failures already surface through their promises.
    this.redis.on("error", (error: Error) => {
      logger.logDomainError("Redis fan-out client connection error", {
        code: "NOTIFICATION_FANOUT_REDIS_UNAVAILABLE",
        entity: "notifications",
        errorName: error.name,
      });
    });
  }

  publish(channel: string, message: string): Promise<unknown> {
    return this.redis.publish(channel, message);
  }

  subscribe(channel: string, onMessage: (message: string) => void): Promise<unknown> {
    this.messageHandlers.set(channel, onMessage);
    return this.redis.subscribe(channel);
  }

  unsubscribe(channel: string): Promise<unknown> {
    this.messageHandlers.delete(channel);
    return this.redis.unsubscribe(channel);
  }

  async close(): Promise<void> {
    this.messageHandlers.clear();
    try {
      await this.redis.quit();
    } catch {
      // QUIT only fails when the connection is already gone (never
      // established, or dropped mid-outage) — force-close the socket so the
      // client can never keep the host process alive.
      this.redis.disconnect();
    }
  }
}
