"use client";

/**
 * useAuditTrailPageState — the audit-trail view's state machine: the
 * applied-filter record, the pagination window, the expanded-details seam,
 * and the stateful trail query that everything keys off. Split from
 * `AuditTrailView` (the 150-line view-file convention) so the view stays a
 * pure composition of the heading, the filter bar, the body switch, and
 * the feedback snackbar.
 *
 * Filter state is two-layered: the bar's draft inputs (what the user types)
 * and the applied-filter record (what the query carries). Applying rebuilds
 * the applied record so the GraphQL `filters` variable carries ONLY
 * non-empty values, and pagination resets to the first page. The deep-link
 * `initialFilters` seed (already sanitized by the server route) pre-fills
 * the applied record; malformed values normalize to "unfiltered" instead
 * of erroring.
 *
 * Query: stateful `useQuery` over the shared `adminAuditLogsQueryDocument`
 * (hooks from `@apollo/client/react`; no `useLazyQuery`). Error seams
 * (branch on `extensions.code` ONLY, via `extractErrorCode`) are classified
 * here: `UNAUTHORIZED`/`FORBIDDEN` → the view swaps in
 * `PermissionDeniedFallback`; `RATE_LIMITED` (incl. the legacy alias) /
 * `SERVICE_UNAVAILABLE` → the retryable notice; anything else → the
 * localized generic notice with a retry affordance wired to `refetch`.
 */

import { useQuery } from "@apollo/client/react";
import { useState } from "react";
import { adminAuditLogsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import {
  type AppliedAuditTrailFilters,
  type AuditTrailFiltersSeed,
  appliedFiltersFromSubmitInput,
  buildFiltersInput,
  retryableKindOf,
} from "@/frontend/views/admin/audit/audit-trail-filters";

const DEFAULT_PAGE_SIZE = 10;

export function useAuditTrailPageState(initialFilters: AuditTrailFiltersSeed | undefined) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [appliedFilters, setAppliedFilters] = useState<AppliedAuditTrailFilters>(() =>
    appliedFiltersFromSubmitInput(initialFilters)
  );
  const [expandedDetailsId, setExpandedDetailsId] = useState<string | null>(null);

  const { data, loading, error, refetch } = useQuery(adminAuditLogsQueryDocument, {
    variables: {
      filters: buildFiltersInput(appliedFilters),
      page: page + 1,
      pageSize,
    },
  });

  const errorCode = error ? extractErrorCode(error) : null;
  const retryableKind = retryableKindOf(errorCode);

  const items = data?.adminAuditLogs.items ?? [];
  const totalCount = data?.adminAuditLogs.totalCount ?? 0;
  // Honest echo: the pagination display is fed from the server's resolved
  // envelope, falling back to the requested window while it is in flight.
  const resolvedPage = data?.adminAuditLogs.page ?? page + 1;
  const resolvedPageSize = data?.adminAuditLogs.pageSize ?? pageSize;
  const hasNoDataYet = loading && data === undefined;

  const applyFilters = (applied: AppliedAuditTrailFilters): void => {
    setAppliedFilters(applied);
    setPage(0);
    setExpandedDetailsId(null);
  };

  const clearFilters = (): void => {
    setAppliedFilters(appliedFiltersFromSubmitInput(undefined));
    setPage(0);
    setExpandedDetailsId(null);
  };

  const retry = (): void => {
    void refetch();
  };

  const changePage = (nextPage: number): void => {
    setPage(nextPage);
    setExpandedDetailsId(null);
  };

  const changePageSize = (nextPageSize: number): void => {
    setPageSize(nextPageSize);
    setPage(0);
  };

  const toggleDetails = (entryId: string): void => {
    setExpandedDetailsId(current => (current === entryId ? null : entryId));
  };

  return {
    appliedFilters,
    items,
    totalCount,
    resolvedPage,
    resolvedPageSize,
    loading,
    hasNoDataYet,
    errorCode,
    retryableKind,
    applyFilters,
    clearFilters,
    retry,
    changePage,
    changePageSize,
    expandedDetailsId,
    toggleDetails,
  };
}
