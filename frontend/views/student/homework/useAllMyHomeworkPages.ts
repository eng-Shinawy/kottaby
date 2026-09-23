"use client";

/**
 * Student homework read — accumulates EVERY `myHomework` page into the
 * cache through the shared `useAllPagedPages` chain (the page wrapper
 * clamps to `pageSize <= 50`, so a single page would silently truncate a
 * longer history — the summary strip must describe the WHOLE history).
 *
 * The student read is zero-identity (the student id is server-derived),
 * so the adapter's variables carry only the pagination window; the
 * builder re-derives each next page's window verbatim.
 */
import type { useQuery } from "@apollo/client/react";
import type { MyHomeworkQuery } from "@/frontend/graphql/generated/gql/graphql";
import { myHomeworkQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { useAllPagedPages } from "@/frontend/lib/apollo/useAllPagedPages";

/** Matches the generated `Exact<...>` variable binding of the document. */
type MyHomeworkVariables = { page: number | null; pageSize: number | null };

function selectMyHomeworkPage(data: MyHomeworkQuery | undefined) {
  const page = data?.myHomework;
  return page
    ? { page: page.page, pageSize: page.pageSize, totalCount: page.totalCount, itemCount: page.items.length }
    : null;
}

function mergeMyHomeworkPages(prev: MyHomeworkQuery, next: MyHomeworkQuery): MyHomeworkQuery {
  const prevPage = prev.myHomework;
  const nextPage = next.myHomework;
  if (!prevPage || !nextPage) {
    return next;
  }
  return { ...next, myHomework: { ...nextPage, items: [...prevPage.items, ...nextPage.items] } };
}

function buildMyHomeworkPageVariables(
  variables: MyHomeworkVariables,
  page: number,
  pageSize: number
): MyHomeworkVariables {
  return { ...variables, page, pageSize };
}

/** `/homework` — the caller's whole homework history, all pages cached. */
export function useAllMyHomeworkPages(): Pick<
  ReturnType<typeof useQuery<MyHomeworkQuery, MyHomeworkVariables>>,
  "data" | "loading" | "error" | "refetch"
> {
  return useAllPagedPages(
    myHomeworkQueryDocument,
    { page: null, pageSize: null },
    buildMyHomeworkPageVariables,
    selectMyHomeworkPage,
    mergeMyHomeworkPages
  );
}
