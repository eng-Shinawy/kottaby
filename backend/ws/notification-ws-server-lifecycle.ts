/**
 * Lifecycle helpers for the notification WebSocket sidecar: the app-owned
 * ping loop and the memoized graceful shutdown.
 */
import { logger } from "@/backend/lib/logger";
import type { NotificationWsServerConfig } from "@/backend/ws/notification-ws-server-config";
import { NOTIFICATION_WS_CLOSE_CODES } from "@/backend/ws/notification-ws-server-constants";
import type {
  NotificationWsConnectionRegistry,
  NotificationWsConnState,
  NotificationWsRuntimeState,
  NotificationWsSocketData,
} from "@/backend/ws/notification-ws-server-state";

/**
 * App-owned liveness: ping every connection each cadence tick; a socket
 * whose pings have gone unanswered `missedPongLimit` times is terminated.
 */
export function startNotificationWsPingLoop(
  registry: NotificationWsConnectionRegistry,
  config: NotificationWsServerConfig
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const terminated: NotificationWsConnState[] = [];
    for (const state of registry.values()) {
      if (state.missedPongs >= config.missedPongLimit) {
        terminated.push(state);
      }
    }
    for (const state of terminated) {
      registry.unregister(state.ws.data.connId);
      logger.info("Notification WS connection terminated (missed pongs)", {
        connId: state.ws.data.connId,
        userId: state.userId,
      });
      state.ws.terminate();
    }
    for (const state of registry.values()) {
      state.ws.ping();
      state.missedPongs += 1;
    }
  }, config.pingIntervalMs);
}

/** Dependencies the shutdown sequence needs from the booting server. */
export interface NotificationWsShutdownContext {
  readonly server: Bun.Server<NotificationWsSocketData>;
  readonly config: NotificationWsServerConfig;
  readonly registry: NotificationWsConnectionRegistry;
  readonly state: NotificationWsRuntimeState;
  readonly host: string;
  readonly port: number;
}

/**
 * Graceful shutdown: unsubscribe, close every socket with `1001`, stop
 * listening. Idempotent — repeat calls return the first shutdown promise.
 */
export function createNotificationWsShutdown(context: NotificationWsShutdownContext): () => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;
  return async () => {
    if (shutdownPromise !== null) {
      return shutdownPromise;
    }
    context.state.shuttingDown = true;
    shutdownPromise = runNotificationWsShutdown(context);
    return shutdownPromise;
  };
}

/** The one-shot shutdown body (guarded by `createNotificationWsShutdown`). */
async function runNotificationWsShutdown(context: NotificationWsShutdownContext): Promise<void> {
  const { server, config, registry, state, host, port } = context;
  if (state.pingTimer !== null) {
    clearInterval(state.pingTimer);
    state.pingTimer = null;
  }
  if (state.subscription !== null) {
    await state.subscription.unsubscribe();
    state.subscription = null;
  }
  for (const connState of registry.values()) {
    try {
      connState.ws.close(NOTIFICATION_WS_CLOSE_CODES.shutdown, "server shutting down");
    } catch {
      // Already closing — the forced stop below reaps anything left.
    }
  }
  registry.clear();
  // Grace period for the 1001 close frames to flush, then a forced stop.
  // (Bun's stop() promise is unreliable while sockets existed — bounded
  // by the drain timeout either way, and the listener stops accepting
  // the moment stop() is invoked.)
  await new Promise(resolve => setTimeout(resolve, config.shutdownDrainTimeoutMs));
  await Promise.race([
    server.stop(true).catch(() => undefined),
    new Promise(resolve => setTimeout(resolve, config.shutdownDrainTimeoutMs)),
  ]);
  logger.info("Notification WS sidecar shut down", { host, port });
}
