"use client";

import { useState } from "react";
import type {
  MyNotificationsFilterInput,
  MyNotificationsQuery_myNotifications_items,
} from "@/frontend/graphql/generated/gql/graphql";
import { useNotificationMarkActions } from "@/frontend/hooks/notifications";
import { logger } from "@/frontend/lib/logger";

/** Stable identity for the "no rows pending" initial state. */
const NO_PENDING_IDS: readonly string[] = [];

/** Removes one id from the pending mark-read set (state-updater helper). */
function withoutPendingId(ids: readonly string[], id: string): readonly string[] {
  return ids.filter(pendingId => pendingId !== id);
}

interface UseNotificationDrawerActionsParams {
  /** The drawer's active window filter (spared by the stale-window sweep). */
  readonly filter: MyNotificationsFilterInput;
  /** Refetches the drawer list query (retry branch only). */
  readonly refetch: () => Promise<unknown>;
  /** Close callback (row activation closes the drawer). */
  readonly onClose: () => void;
}

interface NotificationDrawerActions {
  /** Whether the header mark-all sweep is in flight. */
  readonly markAllPending: boolean;
  /** Row ids with a mark-one mutation in flight. */
  readonly markReadPendingIds: readonly string[];
  /** Whether a retry refetch is in flight. */
  readonly retryPending: boolean;
  /** Row activation: mark read when unread, then close. */
  readonly handleOpenNotification: (item: MyNotificationsQuery_myNotifications_items) => void;
  /** Header sweep: mark every unread row read. */
  readonly handleMarkAll: () => void;
  /** Error-branch retry: refetch the drawer list query. */
  readonly handleRetry: () => void;
}

/**
 * Drawer interaction handlers + their pending state (NotificationDrawer).
 *
 * Row activation: mark read when unread (fire-and-forget — the cache
 * restyles the row) and close; the row IS a real anchor to `/notifications`
 * (Link), so navigation is native — no router call. Mark-one / mark-all run
 * through the shared `useNotificationMarkActions` hook (drawer-plan §3.1) so
 * the count decrement and the stale-window sweep behave IDENTICALLY to the
 * feed page.
 */
export function useNotificationDrawerActions({
  filter,
  refetch,
  onClose,
}: Readonly<UseNotificationDrawerActionsParams>): NotificationDrawerActions {
  const { markNotificationRead, markAllNotificationsRead } = useNotificationMarkActions("NotificationDrawer");
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markReadPendingIds, setMarkReadPendingIds] = useState<readonly string[]>(NO_PENDING_IDS);
  const [retryPending, setRetryPending] = useState(false);

  const handleOpenNotification = (item: MyNotificationsQuery_myNotifications_items): void => {
    if (!item.isRead) {
      setMarkReadPendingIds(prev => [...prev, item.id]);
      void markNotificationRead({ id: item.id, wasUnread: true, activeFilter: filter }).finally(() => {
        setMarkReadPendingIds(prev => withoutPendingId(prev, item.id));
      });
    }
    onClose();
  };

  /** Header sweep: shared action; the drawer surfaces no count snackbar. */
  const handleMarkAll = (): void => {
    setMarkAllPending(true);
    void (async () => {
      await markAllNotificationsRead(filter);
      setMarkAllPending(false);
    })();
  };

  const handleRetry = (): void => {
    setRetryPending(true);
    void (async () => {
      try {
        await refetch();
      } catch (error: unknown) {
        logger.debug({ caller: "NotificationDrawer" }, "[NotificationDrawer] Retry refetch rejected", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        setRetryPending(false);
      }
    })();
  };

  return { markAllPending, markReadPendingIds, retryPending, handleOpenNotification, handleMarkAll, handleRetry };
}
