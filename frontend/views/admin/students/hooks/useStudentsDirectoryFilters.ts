"use client";

/**
 * useStudentsDirectoryFilters — the student directory's filter/search/
 * pagination draft state.
 *
 * Owns every draft value and every setter (each resetting the page to the
 * first page so a new result set is never opened on a stale page index):
 * the search input is debounced at 300ms, the has-parent select maps its
 * string-literal union onto the backend's nullable Boolean filter, and the
 * language input is an EXACT-MATCH filter committed on Enter or through
 * the Apply button so intermediate keystrokes never fire wasted queries.
 *
 * Extracted from `useAdminStudentsDirectory`, which composes it with the
 * URL-sync effect, the query, and the export/feedback flows.
 */

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { parseStudentsUrlState } from "@/frontend/views/admin/directory-url-state";
import type { StudentHasParentFilter } from "@/frontend/views/admin/students/adminStudentsDirectory.helpers";

export function useStudentsDirectoryFilters() {
  // ── Shareable-URL seeding (mount-once) ────────────────────────────────
  // The URL is the initial-state SOURCE for a shared/bookmarked link:
  // `?q=ali&parent=with&lang=Quran&page=2&size=25` opens the surface with
  // that exact view (the applied search seeds BOTH the draft and the
  // debounced value so the FIRST query is already filtered — no unfiltered
  // first fetch). Parsing is fail-closed (directory-url-state.ts); every
  // omitted key falls back to the same default the bare path renders. The
  // params object is read ONCE here — later URL changes do not re-seed
  // (the surface owns state; the URL is its mirror, not its driver).
  const urlSeed = parseStudentsUrlState(useSearchParams());

  const [hasParentFilter, setHasParentFilterState] = useState<StudentHasParentFilter | "">(urlSeed.parent);
  const [searchInput, setSearchInputState] = useState(urlSeed.q);
  const [searchDebounced, setSearchDebounced] = useState(urlSeed.q);
  // The language filter is an exact-match backend predicate, so the draft is
  // held locally and committed on Enter / Apply — never per keystroke.
  const [languageDraft, setLanguageDraft] = useState(urlSeed.lang);
  const [languageFilter, setLanguageFilterState] = useState(urlSeed.lang);
  const [page, setPage] = useState(urlSeed.page);
  const [pageSize, setPageSizeState] = useState<number>(urlSeed.pageSize);

  // Debounce search input (300ms) — the same render-time pattern the users
  // directory hook uses: a timeout is scheduled while the draft differs from
  // the applied value, and the applied value settles once typing pauses.
  if (searchInput !== searchDebounced) {
    setTimeout(() => setSearchDebounced(searchInput), 300);
  }

  // Every filter setter resets to the first page — a new result set starts
  // at page 1, never on a stale (possibly out-of-range) page index.
  const setHasParentFilter = (value: StudentHasParentFilter | "") => {
    setHasParentFilterState(value);
    setPage(0);
  };
  const setSearchInput = (value: string) => {
    setSearchInputState(value);
    setPage(0);
  };
  const setPageSize = (value: number) => {
    setPageSizeState(value);
    setPage(0);
  };

  const applyLanguageFilter = () => {
    const trimmed = languageDraft.trim();
    if (trimmed === languageFilter) {
      return;
    }
    setLanguageFilterState(trimmed);
    setPage(0);
  };

  // Reset both halves of the language filter atomically (the clear action
  // must not depend on the render-closure's stale draft value).
  const clearLanguageFilter = () => {
    setLanguageDraft("");
    setLanguageFilterState("");
    setPage(0);
  };

  // The language draft differs from the applied value (shows the Apply action).
  const languageDirty = languageDraft.trim() !== languageFilter;

  return {
    hasParentFilter,
    setHasParentFilter,
    searchInput,
    setSearchInput,
    searchDebounced,
    languageDraft,
    setLanguageDraft,
    // The APPLIED language half (the URL mirror and the query variables read
    // it; `useAdminStudentsDirectory` strips it again so its public return
    // keeps the original shape — the draft/apply pair below is the public
    // surface of this filter).
    languageFilter,
    applyLanguageFilter,
    clearLanguageFilter,
    languageDirty,
    page,
    setPage,
    pageSize,
    setPageSize,
    hasFilters: hasParentFilter !== "" || searchDebounced !== "" || languageFilter !== "",
  };
}
