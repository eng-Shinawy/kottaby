/**
 * Per-server-instance bounded state for the notification WebSocket sidecar:
 * the socket-data/connection-state shapes, the connection registry (with its
 * derived per-user index), the runtime lifecycle state bag, and fan-out
 * delivery onto indexed sockets.
 */
import type { ServerWebSocket } from "bun";
import { logger } from "@/backend/lib/logger";
import { type FanoutSubscription, projectFanoutPayload } from "@/backend/services/notifications/realtime";
import type { RealtimeNotificationPayload } from "@/backend/types";
import { NOTIFICATION_WS_CLOSE_CODES } from "@/backend/ws/notification-ws-server-constants";

/** Per-socket handshake outcome carried through `server.upgrade`. */
export interface NotificationWsSocketData {
  readonly connId: string;
  readonly userId: number | null;
  readonly reject: { readonly code: number; readonly reason: string } | null;
}

/** Registered connection state (the bounded registry's value). */
export interface NotificationWsConnState {
  readonly userId: number;
  readonly ws: ServerWebSocket<NotificationWsSocketData>;
  missedPongs: number;
}

/** Mutable per-boot runtime bag (shutdown flag, subscription, ping timer). */
export interface NotificationWsRuntimeState {
  shuttingDown: boolean;
  subscription: FanoutSubscription | null;
  pingTimer: ReturnType<typeof setInterval> | null;
}

/**
 * The bounded connection registry plus its DERIVED per-user index
 * (userId → its connIds), maintained at every mutation site (register /
 * evict / terminate / close / shutdown clear). Bounded by the global +
 * per-user caps, so it adds no unbounded state — it only turns fan-out
 * delivery and per-user counts into O(1) lookups instead of a synchronous
 * O(recipients × registry) scan per envelope.
 */
export class NotificationWsConnectionRegistry {
  private readonly registry = new Map<string, NotificationWsConnState>();
  private readonly connectionsByUser = new Map<number, Set<string>>();

  constructor(private readonly maxConnectionsPerUser: number) {}

  /** Live connection count (bounded by the global cap). */
  get size(): number {
    return this.registry.size;
  }

  /** Live connection count for one user (bounded by the per-user cap). */
  countForUser(userId: number): number {
    return this.connectionsByUser.get(userId)?.size ?? 0;
  }

  /** Looks up one connection by id (undefined for stale/rejected sockets). */
  get(connId: string): NotificationWsConnState | undefined {
    return this.registry.get(connId);
  }

  /** Iterates every registered connection state. */
  values(): IterableIterator<NotificationWsConnState> {
    return this.registry.values();
  }

  /** Registers a freshly upgraded connection under `userId`. */
  register(userId: number, connId: string, ws: ServerWebSocket<NotificationWsSocketData>): void {
    this.evictOldestForUser(userId, connId);
    this.registry.set(connId, { userId, ws, missedPongs: 0 });
    this.indexRegister(userId, connId);
  }

  /**
   * Drops one connection from the registry + index; returns the removed
   * state so the caller logs only for connections that were live.
   */
  unregister(connId: string): NotificationWsConnState | undefined {
    const state = this.registry.get(connId);
    if (state === undefined) {
      return undefined;
    }
    this.registry.delete(connId);
    this.indexUnregister(state.userId, connId);
    return state;
  }

  /** Shutdown sweep: clears both structures. */
  clear(): void {
    this.registry.clear();
    this.connectionsByUser.clear();
  }

  /** Evicts the OLDEST connection for `userId` (per-user cap, `4009`). */
  private evictOldestForUser(userId: number, supersededByConnId: string): void {
    let oldest: NotificationWsConnState | null = null;
    let count = 0;
    for (const state of this.registry.values()) {
      if (state.userId !== userId) {
        continue;
      }
      count += 1;
      oldest ??= state;
    }
    if (count < this.maxConnectionsPerUser || oldest === null) {
      return;
    }
    this.registry.delete(oldest.ws.data.connId);
    this.indexUnregister(userId, oldest.ws.data.connId);
    logger.info("Notification WS connection evicted (per-user cap)", {
      connId: oldest.ws.data.connId,
      userId,
      supersededBy: supersededByConnId,
    });
    oldest.ws.close(NOTIFICATION_WS_CLOSE_CODES.superseded, "connection superseded");
  }

  /** Registers `connId` under `userId` in the per-user index. */
  private indexRegister(userId: number, connId: string): void {
    let connIds = this.connectionsByUser.get(userId);
    if (connIds === undefined) {
      connIds = new Set<string>();
      this.connectionsByUser.set(userId, connIds);
    }
    connIds.add(connId);
  }

  /** Unregisters `connId` from `userId`'s index set (empty sets are dropped). */
  private indexUnregister(userId: number, connId: string): void {
    const connIds = this.connectionsByUser.get(userId);
    if (connIds === undefined) {
      return;
    }
    connIds.delete(connId);
    if (connIds.size === 0) {
      this.connectionsByUser.delete(userId);
    }
  }

  /** Sends `frame` to every connection indexed for each of `userIds`. */
  deliverToUsers(userIds: readonly number[], frame: string): void {
    for (const userId of userIds) {
      const connIds = this.connectionsByUser.get(userId);
      if (connIds === undefined) {
        continue;
      }
      for (const connId of connIds) {
        this.sendFrameToConnection(connId, frame);
      }
    }
  }

  /**
   * Sends one frame to one indexed connection (no-op on a stale id); a send
   * failure degrades to ONE structured log — the socket's close event then
   * drains it from the registry + index.
   */
  sendFrameToConnection(connId: string, frame: string): void {
    const state = this.registry.get(connId);
    if (state === undefined) {
      return;
    }
    try {
      state.ws.send(frame);
    } catch (error) {
      logger.logDomainError("Notification realtime push failed for one connection", {
        code: "NOTIFICATION_WS_DELIVERY_DEGRADED",
        entity: "notifications",
        connId: state.ws.data.connId,
        userId: state.userId,
        errorName: error instanceof Error ? error.name : "unknown",
      });
    }
  }
}

/** Fan-out delivery: recipient ids → their indexed sockets; frame is the projected payload. */
export function deliverNotificationFanout(
  registry: NotificationWsConnectionRegistry,
  state: NotificationWsRuntimeState,
  userIds: readonly number[],
  payload: RealtimeNotificationPayload
): void {
  if (state.shuttingDown) {
    return;
  }
  registry.deliverToUsers(userIds, JSON.stringify(projectFanoutPayload(payload)));
}
