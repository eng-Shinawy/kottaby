"use client";

/**
 * useApplicantQueueFilters — the draft filter/search/pagination state of
 * the applicant queue (composed by `useAdminTeacherApplicants`): the status
 * select (draft union later mapped onto the backend's plain-string `status`
 * filter) over the shared `useDirectorySearchPageState` slice (search draft
 * debounced at 300ms + the page/pageSize pair whose setters reset the
 * page). Every filter setter resets the page to the first page so a new
 * result set is never opened on a stale page index; the URL seed (parsed by
 * the owner hook, active-tab-gated) plants the initial values.
 */

import { useState } from "react";
import type { ApplicantsUrlState } from "@/frontend/views/admin/directory-url-state";
import type { ApplicantStatusFilter } from "@/frontend/views/admin/teachers/adminApplicants.helpers";
import { useDirectorySearchPageState } from "@/frontend/views/admin/teachers/hooks/useDirectorySearchPageState";

export function useApplicantQueueFilters(urlSeed: ApplicantsUrlState | undefined) {
  const [statusFilter, setStatusFilterState] = useState<ApplicantStatusFilter | "">(urlSeed?.status ?? "");
  const { searchInput, setSearchInput, searchDebounced, page, setPage, pageSize, setPageSize } =
    useDirectorySearchPageState(urlSeed);

  // Every filter setter resets to the first page — a new result set starts
  // at page 1, never on a stale (possibly out-of-range) page index.
  const setStatusFilter = (value: ApplicantStatusFilter | "") => {
    setStatusFilterState(value);
    setPage(0);
  };

  return {
    statusFilter,
    setStatusFilter,
    searchInput,
    setSearchInput,
    searchDebounced,
    page,
    setPage,
    pageSize,
    setPageSize,
  };
}
