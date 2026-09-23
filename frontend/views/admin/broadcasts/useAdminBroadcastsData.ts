"use client";

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useCallback, useState } from "react";
import type { AdminBroadcastFiltersInput, AdminBroadcastsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { adminBroadcastsQueryDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";
import {
  BROADCAST_HISTORY_PAGE_SIZE,
  type BroadcastHistoryFilterDraft,
  buildAppliedHistoryFilter,
  clampPage,
  EMPTY_HISTORY_FILTER_DRAFT,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";

/**
 * useAdminBroadcastsData — the read tier of the broadcast history surface:
 * the stateful directory query (`adminBroadcasts`, filter + honest-total
 * paging) plus the filter draft → applied orchestration and the 1-based
 * pager clamping. The detail read for the drawer lives in
 * `useAdminBroadcastDetail`; the stop mutation lives in `useStopBroadcast`.
 *
 * Filter orchestration — the search field edits a DRAFT (raw typing token);
 * submitting the bar commits the wire-shaped filter, re-keys the query
 * variables and resets the page. The status / audience selects commit
 * INSTANTLY (`applyFilters` accepts the patch so a select change and its
 * commit share one render — never a stale-draft race). A filter is applied
 * through the SAME single query re-key every time; the backend composes the
 * members AND-wise.
 *
 * `notifyOnNetworkStatusChange` keeps the mid-flight page transition
 * observable: the pager busy affordance (aria-busy + disabled chevrons)
 * derives from `networkStatus`, mirroring the session-governance data hook.
 * The honest `totalCount` is the only server-truth number surfaced —
 * nothing is extrapolated across pages.
 */

/** Wire-shaped unfiltered state — every member explicitly null. */
const EMPTY_APPLIED_FILTER: AdminBroadcastFiltersInput = {
  audienceType: null,
  status: null,
  titleSearch: null,
};

/** The history directory's read + filter/paging state contract. */
export interface AdminBroadcastsData {
  /** Settled directory payload, `undefined` until the first fetch resolves. */
  readonly data: AdminBroadcastsQuery | undefined;
  readonly loading: boolean;
  readonly error: unknown;
  /** Directory-refetch entry point (the error state's retry affordance). */
  readonly refetch: () => void;
  /**
   * True while a directory round-trip is in flight over the SETTLED payload
   * (page transition / refetch) — the pager chevrons disable; the very
   * first fetch (no settled payload) swaps to the skeleton instead.
   */
  readonly listBusy: boolean;
  /** Honest server total — the only count the pager clamps against. */
  readonly totalCount: number;
  /** Honest page count (never below 1). */
  readonly totalPages: number;
  /** Current 1-based page. */
  readonly page: number;
  /** Page-change intent — clamped against the honest total before committing. */
  readonly changePage: (nextPage: number) => void;
  readonly filterDraft: BroadcastHistoryFilterDraft;
  /** Search-draft edit intent (search typing; selects use `applyFilters`). */
  readonly updateFilterDraft: (patch: Partial<BroadcastHistoryFilterDraft>) => void;
  /**
   * Commits the draft into the applied filter and resets the page. The
   * optional patch selects carry (their change + commit share one render);
   * without it the CURRENT draft commits (the search bar's submit path).
   */
  readonly applyFilters: (patch?: Partial<BroadcastHistoryFilterDraft>) => void;
}

/** Owns the directory read + filter/paging state of the history surface. */
export function useAdminBroadcastsData(): AdminBroadcastsData {
  // ---- filter state (draft → applied) -------------------------------------
  const [filterDraft, setFilterDraft] = useState<BroadcastHistoryFilterDraft>(EMPTY_HISTORY_FILTER_DRAFT);
  const [appliedFilter, setAppliedFilter] = useState<AdminBroadcastFiltersInput>(EMPTY_APPLIED_FILTER);
  const [page, setPage] = useState(1);

  // ---- directory read ------------------------------------------------------
  const { data, loading, error, refetch, networkStatus } = useQuery(adminBroadcastsQueryDocument, {
    variables: { filters: appliedFilter, page, pageSize: BROADCAST_HISTORY_PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });

  const totalCount = data?.adminBroadcasts.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / BROADCAST_HISTORY_PAGE_SIZE));

  // Pager busy affordance: a round-trip in flight OVER a settled payload;
  // the very first fetch (no settled payload) is the skeleton arm instead.
  const listBusy = data !== undefined && networkStatus !== NetworkStatus.ready;

  // Pager commits clamp against the honest total BEFORE re-keying the
  // query: below 1 resolves to 1, an empty directory resolves to the
  // single page, and anything past the last page clamps back into range
  // (a filtered shrink under a stale pager must not send an off-window
  // page the backend would reject).
  const changePage = useCallback(
    (nextPage: number): void => {
      setPage(clampPage(nextPage, Math.ceil(totalCount / BROADCAST_HISTORY_PAGE_SIZE)));
    },
    [totalCount]
  );

  const updateFilterDraft = useCallback((patch: Partial<BroadcastHistoryFilterDraft>): void => {
    setFilterDraft(prev => ({ ...prev, ...patch }));
  }, []);

  const applyFilters = useCallback(
    (patch?: Partial<BroadcastHistoryFilterDraft>): void => {
      const nextDraft = patch === undefined ? filterDraft : { ...filterDraft, ...patch };
      setFilterDraft(nextDraft);
      setAppliedFilter(buildAppliedHistoryFilter(nextDraft));
      setPage(1);
    },
    [filterDraft]
  );

  return {
    data,
    loading,
    error,
    refetch,
    listBusy,
    totalCount,
    totalPages,
    page,
    changePage,
    filterDraft,
    updateFilterDraft,
    applyFilters,
  };
}
