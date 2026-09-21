"use client";

import type { TypedDocumentNode } from "@apollo/client";
/**
 * `useAllPagedPages` — the canonical fetch-all-pages composition for paged
 * GraphQL reads whose consumers render SUMMARY surfaces (count lines,
 * summary strips, filterable lists, print/export bundles) over a WHOLE
 * history.
 *
 * The backend page wrappers clamp to `pageSize <= 50` (default 25). A
 * consumer that reads only page 1 would silently truncate: counts,
 * summaries and filter results would all omit rows beyond the first page.
 * This hook keeps the SAME `useQuery` surface the consumers already use
 * and transparently chains `fetchMore` (one request per page, driven by
 * the envelope's own `page` / `pageSize` / `totalCount`) until every page
 * is in the cache, merging items through the caller's `mergePages`
 * adapter.
 *
 * Convergence + duplicate safety: the `updateQuery` refuses a fetched
 * envelope whose `page` is not strictly newer than the cached one, so a
 * double-fired `fetchMore` for the same page cannot duplicate rows (React
 * strict-mode double-effects included). A pending-page ref additionally
 * guards duplicate SCHEDULING: `notifyOnNetworkStatusChange` re-renders
 * the consumer while a fetch-more round runs and the adapter-owned
 * `variables` get a fresh identity per render, so the effect can re-fire
 * for the same page before the request settles — the ref ignores that
 * page until the request settles. A FAILED round is retained (never
 * auto-retried): the effect re-fires on every network-status re-render,
 * so releasing the guard on rejection alone would reschedule the same
 * failing page forever — instead the failed page + variables snapshot is
 * kept in `failedPageRef`, chaining stops, and the failure is surfaced
 * through the returned `fetchMoreError` so the caller can render retry
 * UI. The failed state clears on an explicit `refetch` (the wrapped one
 * returned here) or when the caller's variables change; the rejection is
 * otherwise swallowed (fetchMore rejections never surface in the query
 * result's own `error`). The effect re-fires per cache update and stops
 * as soon as the accumulated item count reaches `totalCount`. A fixture
 * whose `totalCount === items.length` never fires a single extra request.
 *
 * Variables are adapter-owned: the caller passes its natural variables
 * object plus a `buildPageVariables` builder that derives the NEXT page's
 * variables from them. The chain itself never assumes a variable shape —
 * a `{ studentId }` read and a zero-identity `myHomework` read share this
 * one implementation verbatim (the duplication-elimination discipline:
 * jscpd threshold 0).
 *
 * Per repo convention the Apollo surface is NOT re-wrapped: the hook
 * returns the `useQuery` result object as-is, so consumers keep
 * destructuring `{ data, loading, error, refetch }` (with
 * `notifyOnNetworkStatusChange` folding the fetch-more rounds into
 * `loading`).
 */
import { useQuery } from "@apollo/client/react";
import { useCallback, useEffect, useRef, useState } from "react";

/** The paged-envelope subset the chain navigates by. */
interface PagedEnvelopeView {
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly itemCount: number;
}

/** A fetch-more round that failed and must NOT be auto-rescheduled. */
interface FailedRound {
  readonly page: number;
  /** JSON snapshot of the variables the failure belongs to — a variables change re-arms the chain. */
  readonly variablesKey: string;
}

/** The `useQuery` result surface the consumers receive (pass-through + chain failure). */
type PagedQueryResult<TResult extends object, TVariables extends object> = Pick<
  ReturnType<typeof useQuery<TResult, TVariables>>,
  "data" | "loading" | "error" | "refetch"
> & {
  /** Rejection of the last failed fetch-more round (`null` while the chain is healthy). Narrow as needed. */
  readonly fetchMoreError: unknown;
};

export function useAllPagedPages<TResult extends object, TVariables extends object>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  /** Derives the NEXT page's variables from the caller's natural ones. */
  buildPageVariables: (variables: TVariables, page: number, pageSize: number) => TVariables,
  selectPage: (data: TResult | undefined) => PagedEnvelopeView | null | undefined,
  mergePages: (prev: TResult, next: TResult) => TResult
): PagedQueryResult<TResult, TVariables> {
  const { data, loading, error, refetch, fetchMore } = useQuery(document, {
    variables,
    notifyOnNetworkStatusChange: true,
  });

  /** The page number whose `fetchMore` request is currently in flight. */
  const pendingPageRef = useRef<number | null>(null);
  /** The failed round chaining stopped on — never auto-rescheduled. */
  const failedPageRef = useRef<FailedRound | null>(null);
  const [fetchMoreError, setFetchMoreError] = useState<unknown>(null);

  const clearFailedRound = useCallback(() => {
    failedPageRef.current = null;
    setFetchMoreError(null);
  }, []);

  /** Caller-triggered refetch — also re-arms a chain a failed round stopped. */
  const refetchAndReset = useCallback(
    (...args: Parameters<typeof refetch>) => {
      clearFailedRound();
      return refetch(...args);
    },
    [refetch, clearFailedRound]
  );

  useEffect(() => {
    const variablesKey = JSON.stringify(variables);
    // A failure recorded for a PREVIOUS variables snapshot is stale: clear
    // it BEFORE the early returns below, so the consumer never reads the
    // previous chain's error while the new one runs — a still-loading
    // (`selectPage(data)` null) or already-complete snapshot both return
    // early and would otherwise keep the old error surfaced forever. The
    // same-snapshot guard further down is preserved: a failed request is
    // still never retried automatically.
    if (failedPageRef.current && failedPageRef.current.variablesKey !== variablesKey) {
      clearFailedRound();
    }
    const page = selectPage(data);
    if (!page) {
      return;
    }
    if (page.itemCount >= page.totalCount) {
      return;
    }
    const nextPageNumber = page.page + 1;
    if (pendingPageRef.current === nextPageNumber) {
      // A fetch-more round for this page is already scheduled; ignore the
      // re-fired effect until that request settles.
      return;
    }
    const failed = failedPageRef.current;
    if (failed?.page === nextPageNumber && failed?.variablesKey === variablesKey) {
      // The chain stopped on this page: rescheduling it on every
      // network-status re-render would retry the failing request forever.
      // It re-arms via refetchAndReset (explicit retry) or when the
      // caller's variables change (the stale snapshot no longer matches).
      return;
    }
    if (failed) {
      // Stale failure — the inputs moved on, so re-arm the chain: clear
      // BOTH the ref and the surfaced `fetchMoreError`, so the consumer
      // never reads the previous chain's error while the new one runs.
      clearFailedRound();
    }
    pendingPageRef.current = nextPageNumber;
    fetchMore({
      variables: buildPageVariables(variables, nextPageNumber, page.pageSize),
      updateQuery: (prev, { fetchMoreResult }) => {
        if (fetchMoreResult === undefined) {
          return prev;
        }
        const prevPage = selectPage(prev);
        const nextPage = selectPage(fetchMoreResult);
        if (!prevPage || !nextPage || nextPage.page <= prevPage.page) {
          return prev;
        }
        return mergePages(prev, fetchMoreResult);
      },
    })
      .catch(err => {
        // Record the failure instead of releasing into an auto-retry loop:
        // fetchMore rejections never surface through the query result's
        // own `error`, so the hook exposes it as `fetchMoreError` and the
        // wrapped refetch gives the caller the explicit retry path.
        failedPageRef.current = { page: nextPageNumber, variablesKey };
        setFetchMoreError(err);
      })
      .finally(() => {
        // Release the in-flight guard on BOTH paths; the failed-round
        // record (if any) is what decides whether the chain re-arms.
        if (pendingPageRef.current === nextPageNumber) {
          pendingPageRef.current = null;
        }
      });
  }, [data, selectPage, mergePages, fetchMore, buildPageVariables, variables, clearFailedRound]);

  return { data, loading, error, refetch: refetchAndReset, fetchMoreError };
}
