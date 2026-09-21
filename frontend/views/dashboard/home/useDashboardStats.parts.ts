"use client";

import { useApolloClient } from "@apollo/client/react";
import { useEffect, useState } from "react";
import { parentChildReportsQueryDocument, parentChildSessionsQueryDocument } from "@/frontend/graphql/sharedDocuments";
import { COUNT_PAGE_SIZE } from "@/frontend/views/dashboard/home/useDashboardStats.queries";

/** Per-child aggregate outcome — `undefined` running, `null` failed, number resolved. */
export interface ParentAggregateState {
  readonly reportsTotal: number | null | undefined;
  readonly sessionsTotal: number | null | undefined;
}

const PARENT_AGGREGATE_FAILED: ParentAggregateState = { reportsTotal: null, sessionsTotal: null };
const PARENT_AGGREGATE_RUNNING: ParentAggregateState = { reportsTotal: undefined, sessionsTotal: undefined };

/**
 * Per-key aggregate resolution: an EMPTY family has honest zeros (no
 * per-child network round-trip is needed to know that), a settled family
 * key replays its outcome, and anything else reads as running.
 */
function resolveAggregateState(
  childKey: string | undefined,
  settled: Readonly<{ key: string; value: ParentAggregateState }> | null
): ParentAggregateState {
  if (childKey?.length === 0) {
    return { reportsTotal: 0, sessionsTotal: 0 };
  }
  if (settled !== null && settled.key === childKey) {
    return settled.value;
  }
  return PARENT_AGGREGATE_RUNNING;
}

/**
 * Parent per-child aggregate runner — one cancel-checked `client.query`
 * pair per linked child, summed once EVERY envelope has resolved.
 *
 * The effect keys on the STABLE joined id string (not the array identity)
 * so a fresh children array from a cache update does not re-trigger the
 * loop; a genuine membership change (new link granted, child severed)
 * produces a different key and re-runs it.
 *
 * The running/failed/reset transitions are DERIVED from the settled key,
 * not written synchronously inside the effect: an unknown family key reads
 * as running, so no setState ever fires before the first await (a
 * synchronous effect setState would cascade renders).
 */
export function useParentChildAggregates(childIds: readonly number[] | undefined): ParentAggregateState {
  const client = useApolloClient();
  const [settled, setSettled] = useState<Readonly<{ key: string; value: ParentAggregateState }> | null>(null);

  const childKey = childIds === undefined ? undefined : childIds.join(",");

  const aggregate = resolveAggregateState(childKey, settled);

  useEffect(() => {
    // Single exit: the only return is the cancel-cleanup, so the effect
    // keeps a consistent return shape. A family that is unknown, empty,
    // or already settled just skips the loop below — unknown/empty keys
    // are DERIVED in `aggregate` above, never re-run here.
    let cancelled = false;
    const needsRun = childKey !== undefined && childKey.length > 0 && settled?.key !== childKey;

    // One concurrent envelope pair per child (the reads are independent —
    // network-only, pageSize 1), settled once for the whole family: any
    // transport/GraphQL failure (errorPolicy "none" throws) degrades the
    // aggregate instead of summing a partial family.
    if (needsRun) {
      const ids = (childKey ?? "").split(",").map(Number);

      void (async () => {
        try {
          const perChild = await Promise.all(
            ids.map(async studentId => {
              // No manual generics — the shared TypedDocumentNode documents
              // carry the result/variables types (explicit generics on
              // client.query are deprecated in Apollo v4).
              const [reportsPage, sessionsPage] = await Promise.all([
                client.query({
                  query: parentChildReportsQueryDocument,
                  variables: { studentId, page: 1, pageSize: COUNT_PAGE_SIZE },
                  fetchPolicy: "network-only",
                }),
                client.query({
                  query: parentChildSessionsQueryDocument,
                  variables: { studentId, page: 1, pageSize: COUNT_PAGE_SIZE },
                  fetchPolicy: "network-only",
                }),
              ]);
              return {
                reportsCount: reportsPage.data?.parentChildReports?.totalCount,
                sessionsCount: sessionsPage.data?.parentChildSessions?.totalCount,
              };
            })
          );
          const complete = perChild.every(
            (row): row is { reportsCount: number; sessionsCount: number } =>
              row.reportsCount !== undefined && row.sessionsCount !== undefined
          );
          const value: ParentAggregateState = complete
            ? {
                reportsTotal: perChild.reduce((sum, row) => sum + row.reportsCount, 0),
                sessionsTotal: perChild.reduce((sum, row) => sum + row.sessionsCount, 0),
              }
            : PARENT_AGGREGATE_FAILED;
          if (!cancelled) setSettled({ key: childKey, value });
        } catch {
          if (!cancelled) setSettled({ key: childKey, value: PARENT_AGGREGATE_FAILED });
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [childKey, client, settled]);

  return aggregate;
}

/**
 * Optional-value resolver shared by every role branch — collapses the
 * Apollo result trio (loading / error / data) into the hook's
 * `undefined`-while-loading, `null`-on-error, value-when-ready contract.
 * Generic over the value type: numbers (counts) and strings (the wallet
 * balance, which passes through verbatim) resolve identically.
 */
export function resolveOptional<T>(loading: boolean, error: unknown, value: T | undefined): T | undefined | null {
  if (error) return null;
  if (loading || value === undefined) return undefined;
  return value;
}
