/**
 * Notification WebSocket sidecar namespace barrel.
 *
 * The sidecar is a standalone Bun process (`bun run ws`), NOT an `app/api/**`
 * route — see `notification-ws-server.ts` for the process-topology ruling and
 * the bounded-state contract. The throttle/state/handshake/lifecycle modules
 * are boot internals imported directly via `@/backend/ws/...` paths.
 */
export * from "./notification-ws-server";
export * from "./notification-ws-server-config";
export * from "./notification-ws-server-constants";
