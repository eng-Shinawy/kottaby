import type { ApolloClient } from "@apollo/client";
import type { ModifierDetails } from "@apollo/client/cache";
import {
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import {
  CLOSE_CODE_NORMAL,
  CLOSE_CODE_SUPERSEDED,
  CLOSE_CODE_UNAUTHENTICATED,
  getNotificationReconnectDelay,
  isRealtimeNotificationFrame,
  mergeRealtimeNotificationIntoCache,
  PAYLOAD_TYPE_TO_CACHE_TYPE,
  PAYLOAD_TYPE_TO_LABEL,
  RECENT_ID_LIMIT,
  type RealtimeNotificationCacheRow,
  resolveNotificationWsUrl,
} from "@/frontend/hooks/notifications";
import { logger } from "@/frontend/lib/logger";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

/**
 * The realtime notification WebSocket session (REQ-025 / REQ-064 / REQ-067):
 * connect, frame handling, cache merge + toast, reconnect backoff, and the
 * deterministic teardown. See the hook module for the full contract.
 */

/** Mutable session state shared across the session's event handlers. */
interface RealtimeSocketSessionState {
  disposed: boolean;
  socket: WebSocket | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempt: number;
  hadConnectedOnce: boolean;
  warnedDuringDisconnection: boolean;
}

/** Everything the session borrows from the hook's React lifetime. */
interface RealtimeSocketSessionDeps {
  readonly client: ApolloClient;
  readonly readLabels: () => NotificationsLabels;
  readonly enqueueToast: (message: string) => void;
}

/** Bounded replay-dedupe store for recently delivered notification ids. */
interface RecentIdTracker {
  has(id: string): boolean;
  remember(id: string): void;
}

function createRecentIdTracker(): RecentIdTracker {
  /** Bounded FIFO of recently delivered notification ids (replay dedupe). */
  const recentIds = new Set<string>();
  const recentIdOrder: string[] = [];
  return {
    has: id => recentIds.has(id),
    remember: id => {
      if (recentIds.has(id)) {
        return;
      }
      recentIds.add(id);
      recentIdOrder.push(id);
      if (recentIdOrder.length > RECENT_ID_LIMIT) {
        const evicted = recentIdOrder.shift();
        if (evicted !== undefined) {
          recentIds.delete(evicted);
        }
      }
    },
  };
}

/** REQ-025 catch-up: refetch inbox page 1 + unread count (self-heal). */
function createCatchUpRefetch(client: ApolloClient, state: RealtimeSocketSessionState): () => Promise<void> {
  return async () => {
    // Hybrid self-heal: (a) the explicit unfiltered page-1 + count refetch
    // works even when NO watcher is mounted (non-inbox routes), and
    // (b) refetchQueries refreshes EVERY active variant of the inbox/count
    // documents — including the FILTERED view a mounted feed watches — so
    // a reconnect cannot leave a stale filtered list behind.
    const results = await Promise.allSettled([
      client.query({
        query: myNotificationsQueryDocument,
        variables: { filter: null },
        fetchPolicy: "network-only",
      }),
      client.query({ query: myUnreadNotificationCountQueryDocument, fetchPolicy: "network-only" }),
      client.refetchQueries({
        include: [myNotificationsQueryDocument, myUnreadNotificationCountQueryDocument],
      }),
    ]);
    if (state.disposed) {
      return;
    }
    for (const result of results) {
      if (result.status === "rejected") {
        logger.warn(
          { caller: "useNotificationRealtime" },
          "[RealtimeNotifications] Catch-up refetch rejected; polling remains the floor",
          { errorName: result.reason instanceof Error ? result.reason.name : typeof result.reason }
        );
      }
    }
  };
}

/**
 * Message handler: frame guard → replay dedupe → cache merge → unread-count
 * bump → localized toast. Fail-closed on any malformed or unknown frame.
 */
function createRealtimeMessageHandler(
  deps: RealtimeSocketSessionDeps & { tracker: RecentIdTracker }
): (data: unknown) => void {
  return data => {
    if (typeof data !== "string") {
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      logger.debug({ caller: "useNotificationRealtime" }, "[RealtimeNotifications] Malformed frame dropped");
      return;
    }
    if (!isRealtimeNotificationFrame(parsed)) {
      logger.debug({ caller: "useNotificationRealtime" }, "[RealtimeNotifications] Non-notification frame dropped");
      return;
    }
    const stringId = String(parsed.data.id);
    if (deps.tracker.has(stringId)) {
      return;
    }
    deps.tracker.remember(stringId);

    const cacheType = PAYLOAD_TYPE_TO_CACHE_TYPE[parsed.data.type];
    if (cacheType === undefined) {
      logger.warn(
        { caller: "useNotificationRealtime" },
        "[RealtimeNotifications] Frame carried an unknown notification type; dropped",
        { type: parsed.data.type }
      );
      return;
    }

    const row: RealtimeNotificationCacheRow = {
      __typename: "Notification",
      id: stringId,
      type: cacheType,
      title: parsed.data.title,
      body: parsed.data.body,
      isRead: false,
      relatedEntityType: parsed.data.relatedEntityType,
      relatedEntityId: parsed.data.relatedEntityId,
      createdAt: parsed.data.createdAt,
    };
    const held = mergeRealtimeNotificationIntoCache(deps.client.cache, row, parsed.data.type);
    if (held) {
      // REQ-025: the cache already holds this id — complete no-op.
      return;
    }
    // Badge without refetch spam: bump the cached unread count (the field
    // only exists once a count query has run; otherwise the next count
    // read fetches fresh).
    deps.client.cache.modify({
      id: "ROOT_QUERY",
      fields: {
        myUnreadNotificationCount: (count: unknown, _details: ModifierDetails) =>
          typeof count === "number" ? count + 1 : count,
      },
    });

    const labelAccessor = PAYLOAD_TYPE_TO_LABEL[parsed.data.type];
    const labels = deps.readLabels();
    const typeLabel = labelAccessor !== undefined ? labelAccessor(labels) : "";
    deps.enqueueToast(labels.realtimeToast(typeLabel, parsed.data.title));
  };
}

/**
 * Close handler: policy codes (4401/4009) abort retrying; every other close
 * backs off and reconnects (catch-up fires on the next open).
 */
function createSocketCloseHandler(state: RealtimeSocketSessionState, connect: () => void): (event: CloseEvent) => void {
  return event => {
    state.socket = null;
    if (state.disposed) {
      return;
    }
    if (event.code === CLOSE_CODE_UNAUTHENTICATED || event.code === CLOSE_CODE_SUPERSEDED) {
      // Policy aborts: 4401 hands re-authentication to the auth-recovery
      // surface; 4009 means a newer tab owns the socket. NO retry loop.
      logger.warn(
        { caller: "useNotificationRealtime" },
        "[RealtimeNotifications] Socket closed with a policy code; retrying aborted",
        { code: event.code }
      );
      return;
    }
    if (!state.warnedDuringDisconnection) {
      state.warnedDuringDisconnection = true;
      logger.warn(
        { caller: "useNotificationRealtime" },
        "[RealtimeNotifications] Realtime socket lost; degrading silently to the polling floor",
        { code: event.code }
      );
    }
    const delay = getNotificationReconnectDelay(state.reconnectAttempt);
    state.reconnectAttempt += 1;
    state.reconnectTimer = setTimeout(connect, delay);
  };
}

/** One listener reference per socket event (REQ-067 pairs attach/detach). */
interface SocketHandlers {
  readonly open: () => void;
  readonly message: (event: MessageEvent) => void;
  readonly error: () => void;
  readonly close: (event: CloseEvent) => void;
}

function attachSocketListeners(ws: WebSocket, handlers: SocketHandlers): void {
  ws.addEventListener("open", handlers.open);
  ws.addEventListener("message", handlers.message);
  ws.addEventListener("error", handlers.error);
  ws.addEventListener("close", handlers.close);
}

function detachSocketListeners(ws: WebSocket, handlers: SocketHandlers): void {
  ws.removeEventListener("open", handlers.open);
  ws.removeEventListener("message", handlers.message);
  ws.removeEventListener("error", handlers.error);
  ws.removeEventListener("close", handlers.close);
}

/**
 * Opens the realtime socket session and returns its deterministic teardown.
 * Exactly ONE listener per socket event (REQ-067): each `connect()` owns a
 * fresh socket and registers its four listeners; teardown removes them — a
 * remount constructs its OWN socket, so no listener can ever double-fire.
 */
export function startNotificationRealtimeSession(deps: RealtimeSocketSessionDeps): () => void {
  const state: RealtimeSocketSessionState = {
    disposed: false,
    socket: null,
    reconnectTimer: null,
    reconnectAttempt: 0,
    hadConnectedOnce: false,
    warnedDuringDisconnection: false,
  };
  const tracker = createRecentIdTracker();
  const catchUp = createCatchUpRefetch(deps.client, state);
  const handleMessage = createRealtimeMessageHandler({ ...deps, tracker });

  const connect = (): void => {
    const socket = new WebSocket(resolveNotificationWsUrl());
    state.socket = socket;
    attachSocketListeners(socket, handlers);
  };

  const handlers: SocketHandlers = {
    open: () => {
      state.reconnectAttempt = 0;
      state.warnedDuringDisconnection = false;
      if (state.hadConnectedOnce) {
        void catchUp();
      }
      state.hadConnectedOnce = true;
    },
    message: event => {
      handleMessage(event.data);
    },
    error: () => {
      // Silent degradation (REQ-064): a close always follows; the close
      // handler owns reconnect posture. No toast, no banner, no throw.
    },
    close: createSocketCloseHandler(state, connect),
  };

  connect();

  return () => {
    state.disposed = true;
    if (state.reconnectTimer !== null) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    const socket = state.socket;
    if (socket !== null) {
      // Deterministic close + full listener removal (REQ-067).
      detachSocketListeners(socket, handlers);
      socket.close(CLOSE_CODE_NORMAL);
      state.socket = null;
    }
  };
}
