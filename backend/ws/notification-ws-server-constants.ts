/**
 * Bounded-state cap constants for the notification WebSocket sidecar —
 * every one is asserted in tests (see `notification-ws-server.ts` for the
 * process-topology ruling and the full handshake pipeline).
 */

/** Server ping cadence (REQ-023: 30s). */
export const WS_PING_INTERVAL_MS = 30_000;

/** Consecutive unanswered pings before termination (REQ-023: 2 misses). */
export const WS_MISSED_PONG_LIMIT = 2;

/** Per-IP handshake token bucket capacity (burst allowance, REQ-033). */
export const WS_HANDSHAKE_BUCKET_CAPACITY = 5;

/** One bucket token refills per this many milliseconds (sustained rate). */
export const WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS = 2_000;

/** Bound on tracked throttle buckets (distinct IPs) — drop-oldest beyond it. */
export const WS_THROTTLE_MAX_TRACKED_IPS = 10_000;

/**
 * Inbound frame cap (REQ-034 push-only protocol): the client's only inbound
 * traffic is WebSocket CONTROL frames (the auto-sent pong acknowledgements
 * of the server's pings) — a few bytes each — so application-frame budget is
 * capped tight at 4 KiB. An oversized inbound message is dropped by the
 * runtime (`maxPayloadLength`), which closes that one socket; the per-socket
 * failure never touches the push loop or its siblings.
 */
export const WS_MAX_INBOUND_FRAME_BYTES = 4096;

/** Grace period for close-frame flush + forced stop during shutdown. */
export const WS_SHUTDOWN_DRAIN_TIMEOUT_MS = 500;

/** Close-code vocabulary — the exact doc contract (plan §4.3 / REQ-021..046). */
export const NOTIFICATION_WS_CLOSE_CODES = {
  /** Cookie missing/invalid/expired (fail-closed auth). */
  unauthenticated: 4401,
  /** Handshake burst exhausted the per-IP token bucket. */
  throttled: 4429,
  /** Per-user cap eviction: the OLDEST connection was superseded. */
  superseded: 4009,
  /** Global connection cap reached (try again later). */
  overloaded: 1013,
  /** Graceful server shutdown. */
  shutdown: 1001,
} as const;
