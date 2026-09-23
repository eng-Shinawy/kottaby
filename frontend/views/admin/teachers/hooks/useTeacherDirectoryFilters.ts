"use client";

/**
 * useTeacherDirectoryFilters — the draft filter/search/pagination state of
 * the certified-teacher directory (composed by `useAdminTeachersDirectory`):
 * the approval/online/evaluator selects (string-literal unions later mapped
 * onto the backend's nullable Boolean filters) over the shared
 * `useDirectorySearchPageState` slice (search draft debounced at 300ms + the
 * page/pageSize pair whose setters reset the page). Every filter setter
 * resets the page to the first page so a new result set is never opened on a
 * stale page index; the URL seed (parsed by the owner hook, active-tab-gated)
 * plants the initial values.
 */

import { useState } from "react";
import type { TeachersDirectoryUrlState } from "@/frontend/views/admin/directory-url-state";
import type {
  TeacherApprovalFilter,
  TeacherEvaluatorFilter,
  TeacherOnlineFilter,
} from "@/frontend/views/admin/teachers/adminTeachersDirectory.helpers";
import { useDirectorySearchPageState } from "@/frontend/views/admin/teachers/hooks/useDirectorySearchPageState";

export function useTeacherDirectoryFilters(urlSeed: TeachersDirectoryUrlState | undefined) {
  const [approvalFilter, setApprovalFilterState] = useState<TeacherApprovalFilter | "">(urlSeed?.approval ?? "");
  const [onlineFilter, setOnlineFilterState] = useState<TeacherOnlineFilter | "">(urlSeed?.online ?? "");
  const [evaluatorFilter, setEvaluatorFilterState] = useState<TeacherEvaluatorFilter | "">(urlSeed?.evaluator ?? "");
  const { searchInput, setSearchInput, searchDebounced, page, setPage, pageSize, setPageSize } =
    useDirectorySearchPageState(urlSeed);

  // Every filter setter resets to the first page — a new result set starts
  // at page 1, never on a stale (possibly out-of-range) page index.
  const setApprovalFilter = (value: TeacherApprovalFilter | "") => {
    setApprovalFilterState(value);
    setPage(0);
  };
  const setOnlineFilter = (value: TeacherOnlineFilter | "") => {
    setOnlineFilterState(value);
    setPage(0);
  };
  const setEvaluatorFilter = (value: TeacherEvaluatorFilter | "") => {
    setEvaluatorFilterState(value);
    setPage(0);
  };

  return {
    approvalFilter,
    setApprovalFilter,
    onlineFilter,
    setOnlineFilter,
    evaluatorFilter,
    setEvaluatorFilter,
    searchInput,
    setSearchInput,
    searchDebounced,
    page,
    setPage,
    pageSize,
    setPageSize,
  };
}
