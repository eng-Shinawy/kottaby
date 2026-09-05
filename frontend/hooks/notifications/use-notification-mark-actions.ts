"use client";

import type { ApolloCache } from "@apollo/client";
import type { ModifierDetails } from "@apollo/client/cache";
import { useApolloClient, useMutation } from "@apollo/client/react";
import type { MyNotificationsFilterInput } from "@/frontend/graphql/generated/gql/graphql";
import {
  markAllNotificationsReadMutationDocument,
  markNotificationReadMutationDocument,
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { logger } from "@/frontend/lib/logger";

/**
 * Runtime guard for parsed store-field argument objects.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Whether the `myNotifications` cache window named by `storeFieldName` was
 * queried with exactly `filter` (the caller's active window).
 *
 * Store field names look like `myNotifications({"filter":{...}})`; the
 * arguments segment is JSON (Apollo's canonical key serialization), parsed
 * defensively — an unparseable or foreign-shaped name never matches.
 */
function isInboxWindowForFilter(storeFieldName: string, filter: MyNotificationsFilterInput): boolean {
  const argsStart = storeFieldName.indexOf("(");
  if (argsStart < 0) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(storeFieldName.slice(argsStart + 1, storeFieldName.lastIndexOf(")")));
    if (!isRecord(parsed) || !isRecord(parsed.filter)) {
      return false;
    }
    const candidate = parsed.filter;
    return (
      candidate.isRead === filter.isRead &&
      candidate.type === filter.type &&
      candidate.limit === filter.limit &&
      candidate.offset === filter.offset
    );
  } catch {
    return false;
  }
}

/**
 * Post-sweep cache hygiene (4.3b BF defect fix): the mark-all mutation
 * returns a bare `Int`, so NOTHING restyles the normalized rows of the
 * sweep — only the refetched ACTIVE window converges. Every OTHER cached
 * `myNotifications` window (other filter combinations, other pages, the
 * realtime hook's `filter: null` page) still holds its pre-sweep snapshot,
 * and a later switch back to such a window (or an SPA revisit of the feed)
 * would re-render already-swept rows as unread — contradicting the refetched
 * unread-count summary in the header.
 *
 * Dropping those stale windows (returning `undefined` from the modifier
 * deletes the field) makes the next observation of each window refetch from
 * the network instead of serving the pre-sweep snapshot. The ACTIVE window
 * is spared — it was just refetched by the sweep's `refetchQueries`.
 */
function dropStaleInboxWindows(cache: ApolloCache, activeFilter: MyNotificationsFilterInput): void {
  cache.modify({
    id: "ROOT_QUERY",
    fields: {
      myNotifications: (existing: unknown, details: ModifierDetails) =>
        isInboxWindowForFilter(details.storeFieldName, activeFilter) ? existing : undefined,
    },
  });
}

/**
 * Inputs for one mark-one sweep: the row id, whether the row was unread at
 * click time (drives the count decrement), and the caller's ACTIVE inbox
 * window (spared by the stale-window drop so the caller's own list restyles
 * in place without a refetch).
 */
export interface MarkNotificationReadInput {
  readonly id: string;
  readonly wasUnread: boolean;
  readonly activeFilter: MyNotificationsFilterInput;
}

/**
 * Shared mark-one / mark-all notification actions (drawer-plan §3.1).
 *
 * Extracted from `NotificationsFeedContainer` so the feed page and the
 * app-bar notification drawer run the SAME cache-maintenance contract
 * without copy-paste (jscpd discipline):
 *
 *  - Mark-one: the mutation result writes the flipped row back into the same
 *    normalized cache entry the list query produced (row restyles without a
 *    refetch); the cached unread count decrements in lockstep — the same
 *    `ROOT_QUERY.myUnreadNotificationCount` modifier the realtime hook bumps;
 *    every OTHER cached `myNotifications` window (most visibly the unread
 *    window) is dropped so its next observation refetches instead of
 *    rendering the already-read row.
 *  - Mark-all: bare `Int` return — the sweep refetches the caller's active
 *    window + the unread count (nothing to normalize), narrows to the
 *    caller's active TYPE filter (type-aware mark-all), then drops every
 *    other stale window.
 *
 * Rejection contract: both actions log at debug (the global error surface
 * owns the UX via `extensions.code` mapping) and resolve without throwing —
 * mark-all resolves `null` on rejection so callers can skip their success
 * affordance. Pending-state bookkeeping stays with the caller.
 */
export interface NotificationMarkActions {
  /** Marks one row read; resolves after the cache maintenance settles. */
  readonly markNotificationRead: (input: MarkNotificationReadInput) => Promise<void>;
  /**
   * Marks every unread row read (narrowed to `activeFilter.type` when set);
   * resolves the affected count, or `null` when the mutation was rejected.
   */
  readonly markAllNotificationsRead: (activeFilter: MyNotificationsFilterInput) => Promise<number | null>;
}

/**
 * Wires the shared mark-one / mark-all actions for a notification surface.
 *
 * @param caller - log caller tag (the consuming component's name).
 */
export function useNotificationMarkActions(caller: string): NotificationMarkActions {
  const client = useApolloClient();
  const [markRead] = useMutation(markNotificationReadMutationDocument);
  const [markAll] = useMutation(markAllNotificationsReadMutationDocument);

  const markNotificationRead = async (input: MarkNotificationReadInput): Promise<void> => {
    try {
      await markRead({ variables: { id: input.id } });
      if (input.wasUnread) {
        client.cache.modify({
          id: "ROOT_QUERY",
          fields: {
            myUnreadNotificationCount: (count: unknown) => (typeof count === "number" ? Math.max(0, count - 1) : count),
          },
        });
        dropStaleInboxWindows(client.cache, input.activeFilter);
      }
    } catch (error: unknown) {
      // The global error surface owns the UX (extensions.code mapping);
      // record the rejection for observability without a local banner.
      logger.debug({ caller }, "[Notifications] Mark-one mutation rejected", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  };

  const markAllNotificationsRead = async (activeFilter: MyNotificationsFilterInput): Promise<number | null> => {
    try {
      const result = await markAll({
        variables: { type: activeFilter.type },
        refetchQueries: [
          { query: myNotificationsQueryDocument, variables: { filter: activeFilter } },
          { query: myUnreadNotificationCountQueryDocument },
        ],
        awaitRefetchQueries: true,
      });
      dropStaleInboxWindows(client.cache, activeFilter);
      return result.data?.markAllNotificationsRead ?? 0;
    } catch (error: unknown) {
      logger.debug({ caller }, "[Notifications] Mark-all mutation rejected", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  };

  return { markNotificationRead, markAllNotificationsRead };
}
