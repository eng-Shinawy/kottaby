/**
 * Notification WebSocket sidecar configuration: the fully-resolved config
 * shape, the per-boot overrides type, and the env-seam resolver.
 */
import {
  getWebSocketAllowedOrigins,
  getWebSocketHost,
  getWebSocketMaxConnections,
  getWebSocketMaxConnectionsPerUser,
  getWebSocketPort,
} from "@/backend/lib/env";
import {
  WS_HANDSHAKE_BUCKET_CAPACITY,
  WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS,
  WS_MAX_INBOUND_FRAME_BYTES,
  WS_MISSED_PONG_LIMIT,
  WS_PING_INTERVAL_MS,
  WS_SHUTDOWN_DRAIN_TIMEOUT_MS,
  WS_THROTTLE_MAX_TRACKED_IPS,
} from "@/backend/ws/notification-ws-server-constants";

/** Fully-resolved sidecar configuration (env-seam defaults + overrides). */
export interface NotificationWsServerConfig {
  /** Listen port (0 = ephemeral; default from `WS_PORT`). */
  readonly port: number;
  /** Listen host (default from `WS_HOST`). */
  readonly host: string;
  /** Exact-match browser origins accepted at the handshake. */
  readonly allowedOrigins: readonly string[];
  /** Global connection cap (default from `WS_MAX_CONNECTIONS`). */
  readonly maxConnections: number;
  /** Per-user connection cap (default from `WS_MAX_CONNECTIONS_PER_USER`). */
  readonly maxConnectionsPerUser: number;
  /** Ping cadence in milliseconds (constant default; tests may shrink). */
  readonly pingIntervalMs: number;
  /** Missed-pong termination threshold (constant default; tests may shrink). */
  readonly missedPongLimit: number;
  /** Per-IP handshake burst capacity (constant default; tests may shrink). */
  readonly handshakeBucketCapacity: number;
  /** Bucket refill interval in milliseconds (constant default). */
  readonly handshakeBucketRefillIntervalMs: number;
  /** Tracked-IP bound for the throttle map (constant default). */
  readonly throttleMaxTrackedIps: number;
  /** Inbound frame cap in bytes (constant default). */
  readonly maxInboundFrameBytes: number;
  /** Shutdown drain timeout in milliseconds (close-frame flush grace). */
  readonly shutdownDrainTimeoutMs: number;
}

/** Optional per-boot overrides layered over the env-seam defaults. */
export type NotificationWsServerConfigOverrides = Partial<NotificationWsServerConfig>;

/**
 * Resolves the sidecar config: env-seam getters for the 1.5-registered keys
 * (`WS_PORT`/`WS_HOST`/`WS_ALLOWED_ORIGINS`/`WS_MAX_CONNECTIONS`/
 * `WS_MAX_CONNECTIONS_PER_USER`), module constants for the timing/cadence
 * knobs. Tests override via `overrides`; the entry script passes none so
 * `WS_HOST:WS_PORT` govern.
 */
export function resolveNotificationWsServerConfig(
  overrides?: NotificationWsServerConfigOverrides
): NotificationWsServerConfig {
  return {
    port: overrides?.port ?? getWebSocketPort(),
    host: overrides?.host ?? getWebSocketHost(),
    allowedOrigins: overrides?.allowedOrigins ?? getWebSocketAllowedOrigins(),
    maxConnections: overrides?.maxConnections ?? getWebSocketMaxConnections(),
    maxConnectionsPerUser: overrides?.maxConnectionsPerUser ?? getWebSocketMaxConnectionsPerUser(),
    pingIntervalMs: overrides?.pingIntervalMs ?? WS_PING_INTERVAL_MS,
    missedPongLimit: overrides?.missedPongLimit ?? WS_MISSED_PONG_LIMIT,
    handshakeBucketCapacity: overrides?.handshakeBucketCapacity ?? WS_HANDSHAKE_BUCKET_CAPACITY,
    handshakeBucketRefillIntervalMs:
      overrides?.handshakeBucketRefillIntervalMs ?? WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS,
    throttleMaxTrackedIps: overrides?.throttleMaxTrackedIps ?? WS_THROTTLE_MAX_TRACKED_IPS,
    maxInboundFrameBytes: overrides?.maxInboundFrameBytes ?? WS_MAX_INBOUND_FRAME_BYTES,
    shutdownDrainTimeoutMs: overrides?.shutdownDrainTimeoutMs ?? WS_SHUTDOWN_DRAIN_TIMEOUT_MS,
  };
}
