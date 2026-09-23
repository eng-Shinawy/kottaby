"use client";

/**
 * useAdminStudentsDirectory — state and query wiring for
 * `AdminStudentsDirectoryContainer` (the admin student directory surface).
 *
 * Owns the `adminStudents` query (cache-and-network so refetches keep the
 * current rows visible while the fresh page streams in) and the feedback
 * snackbar shared by the copy-email quick action and the export flow
 * (success / warning / error lanes), composing the extracted cohesive
 * blocks that live beside it in this folder:
 *  - `useStudentsDirectoryFilters` — the filter/search/pagination draft
 *    state (each setter resetting the page to the first page),
 *  - `useStudentsUrlSync` — the SHAREABLE-URL mirror of the APPLIED state
 *    (the query string seeds the initial state on mount via the filters
 *    hook's fail-closed parse and is written back through `router.replace`
 *    whenever the applied state settles, so a filtered view can be copied,
 *    bookmarked, or reloaded — directory-url-state.ts owns the pure
 *    contract),
 *  - `useStudentsExportAll` — the server-side EXPORT-ALL flow (the
 *    dedicated export document executed with the SAME normalized filter
 *    state the listing uses; the backend caps the dump and reports
 *    `truncated` honestly).
 *
 * This directory is READ-ONLY — no mutations exist on this surface. The
 * hook returns plain state — no JSX. Errors surface through the same
 * `hasError` / `firstErrorCode` pair the users directory renders as an
 * alert with a retry action.
 */

import { useQuery } from "@apollo/client/react";
import { useState } from "react";
import type { AdminStudentFiltersInput, AdminStudentsQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import { adminStudentsQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { hasParentFilterToBoolean } from "@/frontend/views/admin/students/adminStudentsDirectory.helpers";
import { useStudentsDirectoryFilters } from "@/frontend/views/admin/students/hooks/useStudentsDirectoryFilters";
import { useStudentsExportAll } from "@/frontend/views/admin/students/hooks/useStudentsExportAll";
import { useStudentsUrlSync } from "@/frontend/views/admin/students/hooks/useStudentsUrlSync";
import type { DirectorySnackbar, DirectorySnackbarSeverity } from "@/frontend/views/admin/users/directory";

export function useAdminStudentsDirectory() {
  // `languageFilter` (the APPLIED language) feeds the URL mirror and the
  // query variables below but is NOT part of the hook's public return —
  // it is stripped here so the spread keeps the original shape.
  const { languageFilter, ...filterState } = useStudentsDirectoryFilters();
  // The URL mirrors the APPLIED (post-debounce) state — never the raw draft.
  useStudentsUrlSync({
    q: filterState.searchDebounced,
    parent: filterState.hasParentFilter,
    lang: languageFilter,
    page: filterState.page,
    pageSize: filterState.pageSize,
  });
  const [snackbar, setSnackbar] = useState<DirectorySnackbar | null>(null);

  // The SAME normalized shape feeds the listing AND the export-all query —
  // one filter-to-variables mapping, no drift between screen and file.
  const filterInput: AdminStudentFiltersInput = {
    search: filterState.searchDebounced || null,
    hasParent: filterState.hasParentFilter === "" ? null : hasParentFilterToBoolean(filterState.hasParentFilter),
    language: languageFilter || null,
  };
  const variables: AdminStudentsQueryVariables = {
    filters: filterInput,
    page: filterState.page + 1,
    pageSize: filterState.pageSize,
  };
  const { exportLoading, exportAll } = useStudentsExportAll(filterInput);

  const { data, previousData, loading, error, refetch } = useQuery(adminStudentsQueryDocument, {
    variables,
    fetchPolicy: "cache-and-network",
  });

  // `errorPolicy: "none"` (the default) drops `data` to undefined when a
  // refetch fails; `previousData` keeps the last good page visible instead
  // of flashing the empty state next to the error alert.
  const pageData = data ?? previousData;
  const items = pageData?.adminStudents.items ?? [];
  const total = pageData?.adminStudents.total ?? 0;

  // The error alert must key on query failure itself, not on
  // `firstErrorCode`: a plain transport failure (raw `Error` with no
  // `extensions.code`) extracts to `null`, which would otherwise make the
  // error branch unreachable and let the empty state render instead.
  const hasError = Boolean(error);
  const firstErrorCode = error ? extractErrorCode(error) : null;

  // The shared feedback channel — copy-email reports on the success lane;
  // export feedback may report on the warning (truncated) / error lanes.
  const showSnackbar = (message: string, severity: DirectorySnackbarSeverity = "success") => {
    setSnackbar({ message, severity });
  };
  const clearSnackbar = () => {
    setSnackbar(null);
  };

  return {
    ...filterState,
    exportLoading,
    exportAll,
    snackbar,
    showSnackbar,
    clearSnackbar,
    items,
    total,
    loading,
    hasError,
    firstErrorCode,
    refetch,
    // The live query variables — the direct-onboarding refetch contract:
    // a completed onboarding re-fetches THIS query with them so the fresh
    // row lands on the page/filter view the admin is looking at.
    variables,
  };
}
