/**
 * Notification WebSocket sidecar — process entry (`bun run ws`).
 *
 * Boots the Bun-native WS sidecar: config comes ONLY from the registered env
 * seam (`WS_HOST`/`WS_PORT`/`WS_ALLOWED_ORIGINS`/caps via `@/backend/lib/env`
 * typed getters — never raw `process.env` reads), the fan-out subscription
 * source is resolved via the 2.5 selection factory, and the server listens on
 * `WS_HOST:WS_PORT`.
 *
 * Redis-client ownership: when the Redis bus is selected AND `REDIS_URL` is
 * configured, this entry constructs the default ioredis-backed client itself
 * (deep import per the realtime barrel's documented exception) so it can
 * close it on shutdown. Selection without a `REDIS_URL` falls through to the
 * factory's fail-fast configuration error.
 *
 * Shutdown (SIGTERM/SIGINT): graceful — the server unsubscribes the fan-out
 * tap, closes every socket with `1001`, stops the listener, then the Redis
 * client (when owned) is closed.
 */
import { getNotificationFanoutTransport, getRedisUrl, type NotificationFanoutTransport } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import { resolveFanoutSubscriptionSource } from "@/backend/services/notifications/realtime/fanout-transport.factory";
import { IoredisFanoutClient } from "@/backend/services/notifications/realtime/ioredis-fanout-client";
import { startNotificationWsServer } from "@/backend/ws";

async function main(): Promise<void> {
  const transportSelection: NotificationFanoutTransport = getNotificationFanoutTransport();
  // Cross-process invariant: this entry is a SEPARATE process from Next.js,
  // so an in-process tap can never receive publishes from the app process
  // (each process builds its own InProcessTransport). Fail fast with an
  // actionable message instead of silently never delivering anything.
  if (transportSelection === "in-process") {
    logger.error(
      'Notification WS sidecar requires the Redis bus: NOTIFICATION_FANOUT_TRANSPORT resolved to "in-process", but a standalone sidecar process cannot receive in-process fan-out from the Next.js process. Set REDIS_URL (or NOTIFICATION_FANOUT_TRANSPORT=redis) — see docs/notifications/realtime-engine.md.'
    );
    process.exit(1);
  }
  const redisUrl = getRedisUrl();
  const redisClient =
    transportSelection === "redis" && redisUrl !== undefined ? new IoredisFanoutClient(redisUrl) : undefined;
  const subscriptionSource = await resolveFanoutSubscriptionSource(
    redisClient !== undefined ? { redisClient } : undefined
  );

  const server = await startNotificationWsServer({ subscriptionSource });
  logger.info("Notification WS sidecar started", {
    host: server.host,
    port: server.port,
    transport: transportSelection,
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info("Notification WS sidecar shutting down", { signal });
    await server.shutdown();
    if (redisClient !== undefined) {
      await redisClient.close();
    }
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM")
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error("Notification WS sidecar shutdown failed", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        process.exit(1);
      });
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT")
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        logger.error("Notification WS sidecar shutdown failed", {
          errorName: error instanceof Error ? error.name : "unknown",
        });
        process.exit(1);
      });
  });
}

main().catch((error: unknown) => {
  logger.error("Notification WS sidecar failed to start", {
    errorName: error instanceof Error ? error.name : "unknown",
    message: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
