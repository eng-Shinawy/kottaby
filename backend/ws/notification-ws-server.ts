/**
 * Notification WebSocket sidecar — the Bun-native realtime push process.
 *
 * Process topology (binding, plan §1.1): Next.js 16 App Router route handlers
 * cannot hold upgraded connections, so the realtime lane lives in this
 * standalone `Bun.serve` process (`bun run ws`), NOT under `app/api/**` — it
 * never enters `ROUTE_INVENTORY`; its ingress surface is governed by the
 * notification plan alone.
 *
 * Handshake pipeline (FIXED order — Origin first as the CSWSH defense):
 * lives in `notification-ws-server-handshake.ts`: origin allowlist → per-IP
 * token bucket → `access_token` cookie → `verifyAccessToken` → `userId`
 * coerce → upgrade (registration/caps land atomically in `open()`).
 *
 * Close-code vocabulary (exact contract, `NOTIFICATION_WS_CLOSE_CODES` in
 * `notification-ws-server-constants.ts`): `4401` unauthenticated · `4429`
 * handshake throttled · `4009` superseded (per-user eviction) · `1013`
 * overloaded (global cap) · `1001` server shutting down.
 *
 * Bounded state (the sanctioned exception, REQ-023/046): every mutable
 * structure here is per-server-instance and explicitly capped — the
 * connection registry plus its derived per-user index
 * (`NotificationWsConnectionRegistry` in `notification-ws-server-state.ts`,
 * bounded by the global cap and evicting beyond the per-user cap), the
 * per-IP token-bucket map (`NotificationWsHandshakeThrottle`, bounded by a
 * tracked-IP cap with drop-oldest), and one ping interval timer (the loop
 * lives in `notification-ws-server-lifecycle.ts`). All caps are exported
 * constants asserted in tests.
 *
 * Push routing: the sidecar subscribes through the 2.5 transport port
 * (`subscribeFanout`) — envelopes arrive already guard-validated; the
 * outbound frame is the `RealtimeNotificationPayload` JSON projected onto the
 * allowlisted field set (no recipient ids/PII ever cross the socket).
 * Client application frames are ignored (push-only protocol, REQ-034).
 */

import { logger } from "@/backend/lib/logger";
import type { NotificationFanoutSubscriptionSource } from "@/backend/services/notifications/realtime";
import {
  type NotificationWsServerConfigOverrides,
  resolveNotificationWsServerConfig,
} from "@/backend/ws/notification-ws-server-config";
import { buildNotificationWsWebSocketHandlers } from "@/backend/ws/notification-ws-server-handlers";
import { handleNotificationWsHandshake } from "@/backend/ws/notification-ws-server-handshake";
import {
  createNotificationWsShutdown,
  startNotificationWsPingLoop,
} from "@/backend/ws/notification-ws-server-lifecycle";
import {
  deliverNotificationFanout,
  NotificationWsConnectionRegistry,
  type NotificationWsRuntimeState,
  type NotificationWsSocketData,
} from "@/backend/ws/notification-ws-server-state";
import { NotificationWsHandshakeThrottle } from "@/backend/ws/notification-ws-server-throttle";

// ─── Server options + handle ─────────────────────────────────────────────────

/** Injection seam for the sidecar (tests inject an in-process transport). */
export interface NotificationWsServerOptions {
  /** Fan-out subscription source (2.5 transport; the entry resolves it via the factory). */
  readonly subscriptionSource: NotificationFanoutSubscriptionSource;
  /** Config overrides over the env-seam defaults. */
  readonly config?: NotificationWsServerConfigOverrides;
}

/** Handle for one running sidecar instance. */
export interface NotificationWsServerHandle {
  /** Actual listen host. */
  readonly host: string;
  /** Actual listen port (the OS-assigned port when configured with 0). */
  readonly port: number;
  /** `ws://host:port` base URL for client connections. */
  readonly url: string;
  /** Live connection count (bounded by the global cap). */
  readonly connectionCount: number;
  /** Live connection count for one user (bounded by the per-user cap). */
  connectionCountForUser(userId: number): number;
  /** Graceful shutdown: unsubscribe, close every socket with `1001`, stop listening. */
  shutdown(): Promise<void>;
}

// ─── Server bootstrap ────────────────────────────────────────────────────────

/**
 * Starts the notification WebSocket sidecar.
 *
 * Resolves once the listener is up AND the fan-out subscription is live; a
 * subscription failure stops the listener again and rejects (a sidecar
 * without a backplane serves nothing — boot fails fast, mid-run outages
 * degrade per REQ-045 inside the transport).
 */
export async function startNotificationWsServer(
  options: NotificationWsServerOptions
): Promise<NotificationWsServerHandle> {
  const config = resolveNotificationWsServerConfig(options.config);
  const registry = new NotificationWsConnectionRegistry(config.maxConnectionsPerUser);
  const throttle = new NotificationWsHandshakeThrottle(
    config.handshakeBucketCapacity,
    config.handshakeBucketRefillIntervalMs,
    config.throttleMaxTrackedIps
  );
  const allowedOrigins = new Set(config.allowedOrigins.map(origin => origin.trim().toLowerCase()));
  const state: NotificationWsRuntimeState = {
    shuttingDown: false,
    subscription: null,
    pingTimer: null,
  };

  const bunServer = Bun.serve<NotificationWsSocketData>({
    hostname: config.host,
    port: config.port,
    websocket: {
      // The app owns the ping cadence (WS_PING_INTERVAL_MS); Bun's internal
      // auto-ping cadence is disabled so the 30s contract is ours alone.
      sendPings: false,
      maxPayloadLength: config.maxInboundFrameBytes,
      // Read-idle bound derived from the liveness window so the app-owned
      // missed-pong termination always fires first. Inbound pongs (which
      // every spec-compliant client auto-sends) count as activity, so a
      // healthy-but-quiet socket survives; a silent peer is reaped by the
      // ping loop.
      idleTimeout: Math.max(1, Math.ceil(((config.missedPongLimit + 1) * config.pingIntervalMs + 5_000) / 1000)),
      ...buildNotificationWsWebSocketHandlers({ config, registry, state }),
    },
    fetch: (request, server) => handleNotificationWsHandshake(request, server, { allowedOrigins, throttle, state }),
  });

  // Subscribe AFTER the listener is up; a failed subscription unwinds it.
  try {
    state.subscription = await options.subscriptionSource.subscribeFanout((userIds, payload) =>
      deliverNotificationFanout(registry, state, userIds, payload)
    );
  } catch (error) {
    void bunServer.stop(true);
    throw error;
  }

  state.pingTimer = startNotificationWsPingLoop(registry, config);

  const actualPort = bunServer.port;
  if (actualPort === undefined) {
    clearInterval(state.pingTimer);
    void bunServer.stop(true);
    throw new Error("Notification WS sidecar started without a TCP port (unix-socket mode is not supported).");
  }
  const actualHost = bunServer.hostname ?? config.host;

  logger.info("Notification WS sidecar listening", { host: actualHost, port: actualPort });

  const shutdown = createNotificationWsShutdown({
    server: bunServer,
    config,
    registry,
    state,
    host: actualHost,
    port: actualPort,
  });

  return {
    host: actualHost,
    port: actualPort,
    url: `ws://${actualHost}:${actualPort}`,
    get connectionCount() {
      return registry.size;
    },
    connectionCountForUser(userId: number): number {
      return registry.countForUser(userId);
    },
    shutdown,
  };
}
