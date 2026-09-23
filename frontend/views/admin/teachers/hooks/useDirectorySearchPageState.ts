"use client";

/**
 * useDirectorySearchPageState — the shared search-draft/page/pageSize slice
 * of the teacher-surface directory drafts (the certified-teacher directory
 * and the applicant queue compose it into their filter hooks):
 *  - the search draft debounced at 300ms — a timeout is scheduled while the
 *    draft differs from the applied value, and the applied value settles
 *    once typing pauses;
 *  - the page/pageSize pair, whose every setter resets the page to the
 *    first page so a new result set is never opened on a stale page index.
 *
 * The URL seed (parsed by the owner hook, active-tab-gated) plants the
 * initial values; the structural seed slice keeps the hook independent of
 * any one surface's URL-state union.
 */

import { useState } from "react";

/** The URL-seed slice this hook consumes (both directory unions carry it). */
interface DirectorySearchPageSeed {
  readonly q?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

export function useDirectorySearchPageState(urlSeed: DirectorySearchPageSeed | undefined) {
  const [searchInput, setSearchInputState] = useState(urlSeed?.q ?? "");
  const [searchDebounced, setSearchDebounced] = useState(urlSeed?.q ?? "");
  const [page, setPage] = useState(urlSeed?.page ?? 0);
  const [pageSize, setPageSizeState] = useState<number>(urlSeed?.pageSize ?? 10);

  // Debounce search input (300ms) — the same render-time pattern the other
  // directory hooks use: a timeout is scheduled while the draft differs from
  // the applied value, and the applied value settles once typing pauses.
  if (searchInput !== searchDebounced) {
    setTimeout(() => setSearchDebounced(searchInput), 300);
  }

  // Every value setter resets to the first page — a new result set starts
  // at page 1, never on a stale (possibly out-of-range) page index.
  const setSearchInput = (value: string) => {
    setSearchInputState(value);
    setPage(0);
  };
  const setPageSize = (value: number) => {
    setPageSizeState(value);
    setPage(0);
  };

  return {
    searchInput,
    setSearchInput,
    searchDebounced,
    page,
    setPage,
    pageSize,
    setPageSize,
  };
}
