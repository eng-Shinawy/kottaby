"use client";

/**
 * `useAllPortalPages` — fetch-all-pages composition for the parent
 * monitoring portal's paged reads.
 *
 * The portal tabs render SUMMARY surfaces (count + summary cards +
 * calendar + list) over a child's whole history, but the backend page
 * wrappers clamp to `pageSize <= 50` (default 25). A tab that consumes
 * only page 1 would silently truncate: counts, summaries, calendars,
 * filter results and the print/export bundle would all omit rows beyond
 * the first page.
 *
 * The fetch-more CHAIN itself is the shared `useAllPagedPages`
 * (`frontend/lib/apollo/useAllPagedPages.ts`) — this module owns the
 * per-document adapters: each adapter projects the typed query result
 * onto the shared envelope view and re-builds the typed result with the
 * two pages' items concatenated (each adapter owns its exact types — no
 * casts anywhere). Tab call sites stay one-liners.
 */
import type { useQuery } from "@apollo/client/react";
import type {
  ParentChildHomeworkQuery,
  ParentChildReportsQuery,
  ParentChildSessionsQuery,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  parentChildHomeworkQueryDocument,
  parentChildReportsQueryDocument,
  parentChildSessionsQueryDocument,
} from "@/frontend/graphql/sharedDocuments";
import { useAllPagedPages } from "@/frontend/lib/apollo/useAllPagedPages";

/** The `useQuery` result surface the portal tabs consume (pass-through). */
type PortalQueryResult<TResult extends object, TVariables extends object> = Pick<
  ReturnType<typeof useQuery<TResult, TVariables>>,
  "data" | "loading" | "error" | "refetch"
>;

/** The portal reads' variable shape (matches the generated `Exact<...>` binding). */
type PortalQueryVariables = { studentId: number; page: number | null; pageSize: number | null };

/** Builds the next page's variables from the portal read's natural ones. */
function buildPortalPageVariables(
  variables: PortalQueryVariables,
  page: number,
  pageSize: number
): PortalQueryVariables {
  return { ...variables, page, pageSize };
}

// ─── Per-document adapters ─────────────────────────────────────────────────
//
// Each adapter owns the typed projection + merge for ONE portal document
// (module scope = stable identity, so the fetch-more effect sees stable
// deps).

function selectSessionsPage(data: ParentChildSessionsQuery | undefined) {
  const page = data?.parentChildSessions;
  return page
    ? { page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, itemCount: page.items.length }
    : null;
}

function mergeSessionsPages(prev: ParentChildSessionsQuery, next: ParentChildSessionsQuery): ParentChildSessionsQuery {
  const prevPage = prev.parentChildSessions;
  const nextPage = next.parentChildSessions;
  if (!prevPage || !nextPage) {
    return next;
  }
  return { ...next, parentChildSessions: { ...nextPage, items: [...prevPage.items, ...nextPage.items] } };
}

/** Attendance tab — accumulates every `parentChildSessions` page. */
export function useAllAttendancePages(
  studentId: number
): PortalQueryResult<ParentChildSessionsQuery, PortalQueryVariables> {
  return useAllPagedPages(
    parentChildSessionsQueryDocument,
    { studentId, page: null, pageSize: null },
    buildPortalPageVariables,
    selectSessionsPage,
    mergeSessionsPages
  );
}

function selectReportsPage(data: ParentChildReportsQuery | undefined) {
  const page = data?.parentChildReports;
  return page
    ? { page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, itemCount: page.items.length }
    : null;
}

function mergeReportsPages(prev: ParentChildReportsQuery, next: ParentChildReportsQuery): ParentChildReportsQuery {
  const prevPage = prev.parentChildReports;
  const nextPage = next.parentChildReports;
  if (!prevPage || !nextPage) {
    return next;
  }
  return { ...next, parentChildReports: { ...nextPage, items: [...prevPage.items, ...nextPage.items] } };
}

/** Evaluations + Reports tabs — accumulates every `parentChildReports` page. */
export function useAllReportPages(studentId: number): PortalQueryResult<ParentChildReportsQuery, PortalQueryVariables> {
  return useAllPagedPages(
    parentChildReportsQueryDocument,
    { studentId, page: null, pageSize: null },
    buildPortalPageVariables,
    selectReportsPage,
    mergeReportsPages
  );
}

function selectHomeworkPage(data: ParentChildHomeworkQuery | undefined) {
  const page = data?.parentChildHomework;
  return page
    ? { page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, itemCount: page.items.length }
    : null;
}

function mergeHomeworkPages(prev: ParentChildHomeworkQuery, next: ParentChildHomeworkQuery): ParentChildHomeworkQuery {
  const prevPage = prev.parentChildHomework;
  const nextPage = next.parentChildHomework;
  if (!prevPage || !nextPage) {
    return next;
  }
  return { ...next, parentChildHomework: { ...nextPage, items: [...prevPage.items, ...nextPage.items] } };
}

/** Homework tab — accumulates every `parentChildHomework` page. */
export function useAllHomeworkPages(
  studentId: number
): PortalQueryResult<ParentChildHomeworkQuery, PortalQueryVariables> {
  return useAllPagedPages(
    parentChildHomeworkQueryDocument,
    { studentId, page: null, pageSize: null },
    buildPortalPageVariables,
    selectHomeworkPage,
    mergeHomeworkPages
  );
}
