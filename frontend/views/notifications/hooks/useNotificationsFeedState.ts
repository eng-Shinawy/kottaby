"use client";

import { useQuery } from "@apollo/client/react";
import type { MyNotificationsQuery_myNotifications_items } from "@/frontend/graphql/generated/gql/graphql";
import {
  myNotificationsQueryDocument,
  myUnreadNotificationCountQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationsFeedActions,
  type NotificationsFeedFilters,
  useNotificationsFeedActions,
  useNotificationsFeedFilters,
} from "@/frontend/views/notifications/hooks";

/**
 * Unread-count polling cadence — the conventional notification-count posture
 * (`NOTIFICATION_COUNT_POLL_INTERVAL_MS`, `frontend/AGENTS.md`: 120s). The
 * realtime socket merges arrivals into the cache without refetches; this
 * poll is the silent-degradation floor (REQ-064).
 */
const NOTIFICATION_COUNT_POLL_INTERVAL_MS = 120_000;

/** Composed feed state consumed by `NotificationsFeedContainer`. */
export interface NotificationsFeedState extends NotificationsFeedFilters, NotificationsFeedActions {
  /** Current page's rows (one offset window of the filtered feed). */
  readonly items: readonly MyNotificationsQuery_myNotifications_items[];
  /** Live unread count (undefined until the count query first resolves). */
  readonly unreadCount: number | undefined;
  /** `extensions.code` of the list-query failure, when failed. */
  readonly errorCode: string | null;
  /** List query loading flag (disables affordances). */
  readonly loading: boolean;
  /** Cold first render (no cached data yet — drives the skeleton branch). */
  readonly initialLoading: boolean;
  /** Whether the mark-all sweep affordance is disabled. */
  readonly markAllDisabled: boolean;
  /** Total pages for the pager indicator (at least 1). */
  readonly totalPages: number;
  /** Whether the pager row renders (past page 0 or another page exists). */
  readonly pagerVisible: boolean;
  /** Whether a further page exists (drives the next-button disabled state). */
  readonly hasMore: boolean;
}

/**
 * useNotificationsFeedState — composes the filter, mark-action, and query
 * slices into the container's full feed surface.
 *
 * Feed truth is the Apollo cache (plan D11): the shell-mounted
 * `useNotificationRealtime` socket (DashboardLayout) merges arrivals into
 * the same `myNotifications` variants this hook queries — the container
 * NEVER mounts its own socket (REQ-067).
 *
 * Polling posture: only the unread count polls (120s); the list converges
 * through pagination, sweeps, and the realtime merge.
 */
export function useNotificationsFeedState(): NotificationsFeedState {
  const filters = useNotificationsFeedFilters();
  const listQuery = useQuery(myNotificationsQueryDocument, { variables: { filter: filters.filter } });
  const countQuery = useQuery(myUnreadNotificationCountQueryDocument, {
    pollInterval: NOTIFICATION_COUNT_POLL_INTERVAL_MS,
  });

  const pageData = listQuery.data?.myNotifications;
  const items = pageData?.items ?? [];
  const actions = useNotificationsFeedActions(filters.filter, items, listQuery.refetch);

  const totalCount = pageData?.totalCount ?? 0;
  const unreadCount = countQuery.data?.myUnreadNotificationCount;
  const errorCode = listQuery.error === undefined ? null : extractErrorCode(listQuery.error);
  const totalPages = Math.max(1, Math.ceil(totalCount / NOTIFICATIONS_PAGE_SIZE));
  const initialLoading = listQuery.loading && listQuery.data === undefined;
  const markAllDisabled = listQuery.loading || actions.markAllPending || items.length === 0 || unreadCount === 0;
  const hasMore = pageData?.hasMore ?? false;
  const pagerVisible = filters.page > 0 || hasMore;

  return {
    ...filters,
    ...actions,
    items,
    unreadCount,
    errorCode,
    loading: listQuery.loading,
    initialLoading,
    markAllDisabled,
    totalPages,
    pagerVisible,
    hasMore,
  };
}
