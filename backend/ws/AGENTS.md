# Backend WS Sidecar Layer Rules

The `backend/ws/` namespace hosts the **notification WebSocket sidecar** — a standalone Bun process (`bun run ws`, entry `scripts/start-notification-ws.ts`), NOT a Next.js route. Route handlers cannot hold upgraded connections in Next.js 16; the sidecar never enters `ROUTE_INVENTORY` and its ingress surface is governed by the notification plan (`ai/plans/sprint_2/dev3-010-real-time-notification-engine-websocket/`), not by `docs/graphql/api-gateway-and-routing.md`.

## Process & Wiring

- Entry: `scripts/start-notification-ws.ts` — reads config ONLY through the registered env seam (`@/backend/lib/env` typed getters), resolves the fan-out subscription source via the 2.5 selection factory, and starts the server on `WS_HOST:WS_PORT`. It owns the Redis client lifecycle when the Redis bus is selected (close on shutdown).
- The sidecar subscribes via `NotificationFanoutSubscriptionSource.subscribeFanout(listener)` — envelopes arrive ALREADY guard-validated by the transport (runtime shape guard). Shutdown = `subscription.unsubscribe()` (+ client close, owned by the entry) + close all sockets `1001`.

## Handshake Pipeline (FIXED order — never reorder)

1. Origin allowlist (`WS_ALLOWED_ORIGINS`) — missing/mismatched → HTTP 403, never upgraded (CSWSH defense, fail-closed).
2. Per-IP handshake token bucket → exhausted → close `4429`.
3. `access_token` httpOnly cookie read — the ONLY identity source. Query strings and every other header are NEVER read (grep-verifiable: no `searchParams` in this namespace).
4. `verifyAccessToken` → null → close `4401`.
5. `userId` from the verified `sub` claim (positive-int coerce).
6. Register: global cap → close `1013`; per-user cap → evict OLDEST with `4009`.

## Close-Code Vocabulary (exact — do not extend)

`4401` unauthenticated · `4429` throttled · `4009` superseded (eviction) · `1013` overloaded · `1001` shutdown. Standard RFC codes (`1000`/`1006`/`1009`) may surface from the runtime itself, but the sidecar's policy closes use ONLY the five above.

## Bounded State (sanctioned exception — REQ-023/046)

Module-level mutable state is permitted ONLY here, and ONLY bounded. Prefer per-server-instance state (each `startNotificationWsServer` boot owns its registry/bucket/timer — tests boot isolated instances). Every cap is an exported constant asserted in tests: registry (`WS_MAX_CONNECTIONS` global cap + `WS_MAX_CONNECTIONS_PER_USER` per-user eviction), throttle map (`WS_THROTTLE_MAX_TRACKED_IPS` drop-oldest), ping cadence (`WS_PING_INTERVAL_MS` / `WS_MISSED_PONG_LIMIT`).

## Protocol Discipline

- **Push-only**: outbound frames are `RealtimeNotificationPayload` JSON ONLY (egress-projected onto the allowlisted field set — no recipient ids/PII cross the socket). Client application frames are ignored (REQ-034); pong/close protocol frames are handled by the runtime/handlers.
- **Logging**: `logger` from `@/backend/lib/logger` exclusively (never `console.*`). Connection lifecycle logs carry `connId` + `userId` ONLY — no tokens, no IPs, no payloads (REQ-037).

## Testing

- Co-located `*.test.ts` suites via the canonical runner (`bun run test/scripts/run-test.ts backend/ws/...`).
- Tests boot their own server on an ephemeral port (`port: 0` + `127.0.0.1`) with config overrides (shrunk ping cadence, raised bucket caps) and MUST shut it down in cleanup — never leave a listener behind, never occupy ports 3000 (dev server) or 5432 (PostgreSQL).
- Native `WebSocket` clients (Bun global) send handshake headers via the constructor options (`new WebSocket(url, { headers: { origin, cookie } })`). A dead-peer simulation (never pongs) uses a minimal raw-TCP client — protocol-level auto-pong cannot be disabled on spec-compliant clients.
