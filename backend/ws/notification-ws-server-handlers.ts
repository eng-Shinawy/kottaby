/**
 * WebSocket event handlers for the notification WebSocket sidecar: the
 * policy-close registration gate in `open`, pong bookkeeping, connection
 * close cleanup, and the push-only (REQ-034) message sink.
 */
import { logger } from "@/backend/lib/logger";
import type { NotificationWsServerConfig } from "@/backend/ws/notification-ws-server-config";
import { NOTIFICATION_WS_CLOSE_CODES } from "@/backend/ws/notification-ws-server-constants";
import type {
  NotificationWsConnectionRegistry,
  NotificationWsRuntimeState,
  NotificationWsSocketData,
} from "@/backend/ws/notification-ws-server-state";

/** The four socket hooks the sidecar implements (Bun `WebSocketHandler` subset). */
type NotificationWsHandlers = Pick<
  Bun.WebSocketHandler<NotificationWsSocketData>,
  "open" | "message" | "pong" | "close"
>;

/** Dependencies the socket handlers need from the booting server. */
export interface NotificationWsHandlerContext {
  readonly config: NotificationWsServerConfig;
  readonly registry: NotificationWsConnectionRegistry;
  readonly state: NotificationWsRuntimeState;
}

/** Builds the open/message/pong/close handlers for one server boot. */
export function buildNotificationWsWebSocketHandlers(context: NotificationWsHandlerContext): NotificationWsHandlers {
  const { config, registry, state } = context;
  return {
    open(ws) {
      const { connId, userId, reject } = ws.data;
      if (reject !== null) {
        logger.logDomainError("Notification WS handshake rejected", {
          code: "NOTIFICATION_WS_HANDSHAKE_REJECTED",
          entity: "notifications",
          reason: reject.reason,
          connId,
          userId,
        });
        ws.close(reject.code, reject.reason);
        return;
      }
      if (userId === null) {
        // Unreachable by construction (fetch only upgrades verified
        // identities) — fail-closed defense in depth.
        ws.close(NOTIFICATION_WS_CLOSE_CODES.unauthenticated, "unauthenticated");
        return;
      }
      if (registry.size >= config.maxConnections) {
        logger.logDomainError("Notification WS handshake rejected", {
          code: "NOTIFICATION_WS_HANDSHAKE_REJECTED",
          entity: "notifications",
          reason: "overloaded",
          connId,
          userId,
        });
        ws.close(NOTIFICATION_WS_CLOSE_CODES.overloaded, "server overloaded");
        return;
      }
      if (state.shuttingDown) {
        // Drain-window race backstop (Wave D R3 F1r3): shutdown began while
        // this handshake was in flight — the registry was already swept +
        // cleared, so a registration landing now would strand this socket
        // past the `1001` sweep (it would only ever see the forced stop's
        // abrupt teardown). Close it gracefully instead.
        ws.close(NOTIFICATION_WS_CLOSE_CODES.shutdown, "server shutting down");
        return;
      }
      registry.register(userId, connId, ws);
      logger.info("Notification WS connection registered", { connId, userId });
    },
    message() {
      // Push-only protocol (REQ-034): every client application frame is
      // ignored — pong/close protocol frames are handled below/by the runtime.
    },
    pong(ws) {
      const state2 = registry.get(ws.data.connId);
      if (state2 !== undefined) {
        state2.missedPongs = 0;
      }
    },
    close(ws, code) {
      const { connId, userId } = ws.data;
      if (registry.unregister(connId) !== undefined) {
        logger.info("Notification WS connection closed", { connId, userId, code });
      }
    },
  };
}
