"use client";

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useCallback, useMemo, useState } from "react";
import {
  type AdminSessionListFilterInput,
  type AdminSessionsQuery_adminSessions_items,
  SessionStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import type {
  DirectoryFilterDraft,
  StatusSummaryCounts,
} from "@/frontend/views/admin/session-governance/AdminSessionGovernanceContainer";
import { WHOLE_NUMBER_PATTERN } from "@/frontend/views/admin/session-governance/ReassignTeacherDialog";

/**
 * useAdminSessionGovernanceData — the read tier of the admin
 * session-governance container: the stateful directory query
 * (`adminSessions`, filter + honest-total paging), the filter draft →
 * applied orchestration, the pager clamping, and the per-status summary
 * over the LOADED page. The detail read for the drawer stays in the
 * container (its `skip` gating is keyed to the drawer state that lives
 * there); the governance mutations live in
 * `useAdminSessionGovernanceActions` / `useAdminSessionGovernanceJoin`.
 *
 * Filter orchestration — the chrome edits a DRAFT (raw strings for the
 * participant-id fields, `yyyy-MM-dd` tokens for the creation window);
 * APPLY validates (ids must be whole numbers; a zero-width window is a
 * legitimate empty result) and commits the wire-shaped filter into state,
 * re-keying the query variables and resetting the 1-based page. RESET
 * restores the unfiltered directory. Filter id members are `Int` on the
 * wire (numbers, never strings) and the window bounds are ISO-8601 UTC
 * instants (inclusive from-midnight, EXCLUSIVE to-midnight — the repo's
 * half-open `created_at >= from AND < to` contract).
 *
 * `notifyOnNetworkStatusChange` keeps the mid-flight page transition
 * observable: the pager busy affordance (aria-busy + disabled chevrons)
 * derives from `networkStatus`, mirroring the platform-analytics
 * container's refresh posture. The honest `totalCount` is the only
 * server-truth number surfaced — nothing is extrapolated across pages.
 */

/** Page size — the backend's own default/clamp midpoint (1..50, default 25). */
const ADMIN_SESSIONS_PAGE_SIZE = 25;

const EMPTY_FILTER_DRAFT: DirectoryFilterDraft = {
  teacherUserId: "",
  studentUserId: "",
  type: null,
  status: null,
  dateFrom: null,
  dateTo: null,
};

/** Wire-shaped unfiltered state — every member explicitly null (input members are required-nullable). */
const EMPTY_APPLIED_FILTER: AdminSessionListFilterInput = {
  teacherUserId: null,
  studentUserId: null,
  type: null,
  status: null,
  dateFrom: null,
  dateTo: null,
};

/** `yyyy-MM-dd` date token → inclusive-midnight UTC ISO instant. */
function dateTokenToInclusiveIso(token: string): string {
  return new Date(`${token}T00:00:00.000Z`).toISOString();
}

/** Status summary — counts over the LOADED page only (honest, real data). */
function summarizeStatusCounts(
  rows: readonly AdminSessionsQuery_adminSessions_items[] | undefined
): StatusSummaryCounts {
  const effectiveRows = rows ?? [];
  const counts = new Map<SessionStatus, number>();
  for (const row of effectiveRows) {
    counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  }
  return {
    scheduled: counts.get(SessionStatus.Scheduled) ?? 0,
    started: counts.get(SessionStatus.Started) ?? 0,
    completed: counts.get(SessionStatus.Completed) ?? 0,
    cancelled: counts.get(SessionStatus.Cancelled) ?? 0,
    disputed: counts.get(SessionStatus.Disputed) ?? 0,
    needsAttention: effectiveRows.filter(row => row.needsAttention).length,
  };
}

/**
 * Owns the directory read + filter/paging state of the admin
 * session-governance container. Returns plain state + callbacks — no JSX.
 */
export function useAdminSessionGovernanceData() {
  // ---- filter state (draft → applied) -------------------------------------
  const [filterDraft, setFilterDraft] = useState<DirectoryFilterDraft>(EMPTY_FILTER_DRAFT);
  // Per-field invalid-id flags — the error binds to the OFFENDING field
  // (teacher vs student), not one shared flag for both inputs.
  const [filterInvalidIds, setFilterInvalidIds] = useState<{
    teacher: boolean;
    student: boolean;
  }>({ teacher: false, student: false });
  const [appliedFilter, setAppliedFilter] = useState<AdminSessionListFilterInput>(EMPTY_APPLIED_FILTER);
  const [page, setPage] = useState(1);

  // ---- directory read ------------------------------------------------------
  const { data, loading, error, refetch, networkStatus } = useQuery(adminSessionsQueryDocument, {
    variables: { filter: appliedFilter, page, pageSize: ADMIN_SESSIONS_PAGE_SIZE },
    notifyOnNetworkStatusChange: true,
  });

  // The loaded page's rows, `undefined` until the directory settles — the
  // fallback to the empty list stays INSIDE the memo (a `?? []` dependency
  // initializer re-arms the memo every render).
  const rows = data?.adminSessions.items;
  const totalCount = data?.adminSessions.totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / ADMIN_SESSIONS_PAGE_SIZE));

  // Pager busy affordance: a round-trip in flight OVER a settled payload
  // (page transition / refetch) — the body announces aria-busy and keeps
  // the pager chevrons disabled until the next page settles. The very
  // first fetch (no settled payload) swaps to the skeleton instead.
  const listBusy = data !== undefined && networkStatus !== NetworkStatus.ready;

  // A filter is "active" when any committed member is set — the body swaps
  // the empty-state copy ("no results match the filters" vs "no sessions").
  const filtersActive = Object.values(appliedFilter).some(value => value !== null);

  const statusCounts = useMemo(() => summarizeStatusCounts(rows), [rows]);

  // Pager commits clamp against the honest total BEFORE re-keying the
  // query: below 1 resolves to 1, an empty directory resolves to the
  // single page, and anything past the last page clamps back into range
  // (a filtered shrink under a stale pager must not send an off-window
  // page the backend would reject).
  const changePage = useCallback(
    (nextPage: number): void => {
      const lastPage = Math.max(1, Math.ceil(totalCount / ADMIN_SESSIONS_PAGE_SIZE));
      setPage(Math.min(Math.max(nextPage, 1), lastPage));
    },
    [totalCount]
  );

  // ---- filter callbacks ----------------------------------------------------
  const updateFilterDraft = useCallback((patch: Partial<DirectoryFilterDraft>): void => {
    setFilterInvalidIds({ teacher: false, student: false });
    setFilterDraft(prev => ({ ...prev, ...patch }));
  }, []);

  const applyFilters = useCallback((): void => {
    const teacherToken = filterDraft.teacherUserId.trim();
    const studentToken = filterDraft.studentUserId.trim();
    const teacherInvalid = teacherToken !== "" && !WHOLE_NUMBER_PATTERN.test(teacherToken);
    const studentInvalid = studentToken !== "" && !WHOLE_NUMBER_PATTERN.test(studentToken);
    if (teacherInvalid || studentInvalid) {
      setFilterInvalidIds({ teacher: teacherInvalid, student: studentInvalid });
      return;
    }
    setAppliedFilter({
      teacherUserId: teacherToken === "" ? null : Number(teacherToken),
      studentUserId: studentToken === "" ? null : Number(studentToken),
      type: filterDraft.type,
      status: filterDraft.status,
      dateFrom: filterDraft.dateFrom === null ? null : dateTokenToInclusiveIso(filterDraft.dateFrom),
      dateTo: filterDraft.dateTo === null ? null : dateTokenToInclusiveIso(filterDraft.dateTo),
    });
    setPage(1);
  }, [filterDraft]);

  const resetFilters = useCallback((): void => {
    setFilterDraft(EMPTY_FILTER_DRAFT);
    setFilterInvalidIds({ teacher: false, student: false });
    setAppliedFilter(EMPTY_APPLIED_FILTER);
    setPage(1);
  }, []);

  return {
    data,
    loading,
    error,
    refetch,
    listBusy,
    filtersActive,
    statusCounts,
    totalCount,
    totalPages,
    filterDraft,
    filterInvalidIds,
    updateFilterDraft,
    applyFilters,
    resetFilters,
    page,
    changePage,
  };
}
