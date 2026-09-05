"use client";

import { type Dispatch, type SetStateAction, useState } from "react";
import type {
  MyNotificationsFilterInput,
  MyNotificationsQuery_myNotifications_items,
} from "@/frontend/graphql/generated/gql/graphql";
import { useNotificationMarkActions } from "@/frontend/hooks/notifications";
import { logger } from "@/frontend/lib/logger";

/** Removes one id from the pending mark-read set (state-updater helper). */
function withoutPendingId(ids: readonly string[], id: string): readonly string[] {
  return ids.filter(pendingId => pendingId !== id);
}

/** Mark/retry action slice returned by {@link useNotificationsFeedActions}. */
export interface NotificationsFeedActions {
  /** Ids whose mark-read mutation is in flight (row-level pending state). */
  readonly markReadPendingIds: readonly string[];
  /** Mark-all sweep in flight. */
  readonly markAllPending: boolean;
  /** Affected count of the last completed sweep (drives the snackbar). */
  readonly markAllAffectedCount: number | null;
  /** Retry-after-error refetch in flight. */
  readonly retryPending: boolean;
  /** Clears/sets the mark-all surface state. */
  readonly setMarkAllAffectedCount: Dispatch<SetStateAction<number | null>>;
  /** Mark-one handler — receives the notification id (STRING wire form). */
  readonly handleMarkRead: (id: string) => void;
  /** Mark-all sweep handler (narrows to the active filter). */
  readonly handleMarkAll: () => void;
  /** Error-branch retry handler (refetches the feed query). */
  readonly handleRetry: () => void;
}

/**
 * useNotificationsFeedActions — the feed's mark-one / mark-all / retry action
 * slice: row-level pending ids + sweep surface state. Mark-one / mark-all
 * cache maintenance is shared with the app-bar drawer through
 * `useNotificationMarkActions` (drawer-plan §3.1); pending state stays
 * local.
 */
export function useNotificationsFeedActions(
  filter: MyNotificationsFilterInput,
  items: readonly MyNotificationsQuery_myNotifications_items[],
  refetch: () => Promise<unknown>
): NotificationsFeedActions {
  const [markReadPendingIds, setMarkReadPendingIds] = useState<readonly string[]>([]);
  const [markAllPending, setMarkAllPending] = useState(false);
  const [markAllAffectedCount, setMarkAllAffectedCount] = useState<number | null>(null);
  const [retryPending, setRetryPending] = useState(false);

  const { markNotificationRead, markAllNotificationsRead } = useNotificationMarkActions("NotificationsFeedContainer");

  /**
   * Mark-one: delegates to the shared action (cache normalization + count
   * decrement + stale-window drop, spared at the ACTIVE filter); this slice
   * only owns the row pending bookkeeping.
   */
  const handleMarkRead = (id: string): void => {
    const wasUnread = items.some(item => item.id === id && !item.isRead);
    setMarkReadPendingIds(prev => [...prev, id]);
    void markNotificationRead({ id, wasUnread, activeFilter: filter }).finally(() => {
      setMarkReadPendingIds(prev => withoutPendingId(prev, id));
    });
  };

  /**
   * Mark-all: the shared sweep narrows to the ACTIVE type filter
   * (type-aware mark-all); on success the translated affected-count snackbar
   * surfaces (a `null` resolution = rejected mutation → no snackbar).
   */
  const handleMarkAll = (): void => {
    setMarkAllPending(true);
    void (async () => {
      const affectedCount = await markAllNotificationsRead(filter);
      if (affectedCount !== null) {
        setMarkAllAffectedCount(affectedCount);
      }
      setMarkAllPending(false);
    })();
  };

  const handleRetry = (): void => {
    setRetryPending(true);
    void (async () => {
      try {
        await refetch();
      } catch (error: unknown) {
        logger.debug({ caller: "NotificationsFeedContainer" }, "[NotificationsFeed] Retry refetch rejected", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      } finally {
        setRetryPending(false);
      }
    })();
  };

  return {
    markReadPendingIds,
    markAllPending,
    markAllAffectedCount,
    retryPending,
    setMarkAllAffectedCount,
    handleMarkRead,
    handleMarkAll,
    handleRetry,
  };
}
