"use client";

import { type Dispatch, type SetStateAction, useMemo, useState } from "react";
import type { MyNotificationsFilterInput, NotificationType } from "@/frontend/graphql/generated/gql/graphql";
import type { NotificationReadFilter } from "@/frontend/views/notifications/ui";

/**
 * Feed page size — mirrors the engine's default inbox window
 * (`NOTIFICATION_INBOX_DEFAULT_PAGE_LIMIT = 20`; cap 50). The frontend keeps
 * its own constant: view layers never import backend service modules.
 */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** Filter + pagination slice returned by {@link useNotificationsFeedFilters}. */
export interface NotificationsFeedFilters {
  /** Active read-state filter. */
  readonly readFilter: NotificationReadFilter;
  /** Active category filter (`null` = all types). */
  readonly typeFilter: NotificationType | null;
  /** Zero-based page index. */
  readonly page: number;
  /** Memoized wire filter (stable identity while the filters are unchanged). */
  readonly filter: MyNotificationsFilterInput;
  /** Raw page setter (pager window movement). */
  readonly setPage: Dispatch<SetStateAction<number>>;
  /** Read-state filter change (resets pagination). */
  readonly handleReadFilterChange: (next: NotificationReadFilter) => void;
  /** Category filter change (resets pagination). */
  readonly handleTypeFilterChange: (next: NotificationType | null) => void;
}

/**
 * useNotificationsFeedFilters — the feed's filter + pagination state slice
 * (plan §5.4): local React state (there is no Zustand store). The filter
 * object is memoized so `useQuery` sees a stable variables identity while the
 * filters are unchanged (re-renders never re-key the observable).
 */
export function useNotificationsFeedFilters(): NotificationsFeedFilters {
  const [readFilter, setReadFilter] = useState<NotificationReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<NotificationType | null>(null);
  const [page, setPage] = useState(0);

  const filter = useMemo<MyNotificationsFilterInput>(
    () => ({
      isRead: readFilter === "unread" ? false : null,
      type: typeFilter,
      limit: NOTIFICATIONS_PAGE_SIZE,
      offset: page * NOTIFICATIONS_PAGE_SIZE,
    }),
    [readFilter, typeFilter, page]
  );

  // Filter changes reset pagination — a new window starts at offset 0.
  // Single-selection semantics (QA round 2): "All" IS the unfiltered reset —
  // selecting it also drops an active category filter, so the rail can never
  // show "All" and a type chip pressed at the same time (clicking "All"
  // while a category is active was a dead button that left the list
  // narrowed). "Unread" keeps its orthogonal read-state interplay.
  const handleReadFilterChange = (next: NotificationReadFilter): void => {
    setReadFilter(next);
    if (next === "all") {
      setTypeFilter(null);
    }
    setPage(0);
  };
  const handleTypeFilterChange = (next: NotificationType | null): void => {
    setTypeFilter(next);
    setPage(0);
  };

  return { readFilter, typeFilter, page, filter, setPage, handleReadFilterChange, handleTypeFilterChange };
}
