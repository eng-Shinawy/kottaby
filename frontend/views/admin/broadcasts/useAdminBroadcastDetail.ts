"use client";

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useCallback } from "react";
import type { AdminBroadcastDetailQuery } from "@/frontend/graphql/generated/gql/graphql";
import { adminBroadcastDetailQueryDocument } from "@/frontend/graphql/sharedDocuments/notifications/broadcast.documents";

/**
 * useAdminBroadcastDetail — the stateful detail read behind the broadcast
 * history drawer: the full entry snapshot plus the live delivered/read
 * counters, keyed to the drawer's selected broadcast. `skip` gates the
 * query while the drawer is closed (`broadcastId === null`) — a stateful
 * `useQuery` with a skip gate, never `useLazyQuery`; opening the drawer
 * flips the skip and the query fires, re-using the cache when the entry
 * was already loaded.
 *
 * A stop-triggered refetch lands in the identical cache shape (the shared
 * entry fragment), so the drawer's counters converge together with the list
 * after the stop mutation's `refetchQueries` pass.
 */

/** The drawer's detail-read contract. */
export interface AdminBroadcastDetailState {
  /** Settled detail payload, `undefined` until the drawer's fetch resolves. */
  readonly detail: AdminBroadcastDetailQuery | undefined;
  /** True only while THIS broadcast's read is in flight (idle while skipped). */
  readonly detailLoading: boolean;
  readonly detailError: unknown;
  /** Detail-refetch entry point (the drawer error state's retry affordance). */
  readonly refetchDetail: () => void;
}

/**
 * Owns the detail read for one broadcast. `broadcastId === null` (drawer
 * closed) skips the query entirely; a numeric id keys the `Int!` wire
 * argument.
 */
export function useAdminBroadcastDetail(broadcastId: number | null): AdminBroadcastDetailState {
  const { data, loading, error, refetch, networkStatus } = useQuery(adminBroadcastDetailQueryDocument, {
    // The variables object must stay wire-valid while skipped; the sentinel
    // never reaches the server (the skip gate short-circuits the request).
    variables: { broadcastId: broadcastId ?? 0 },
    skip: broadcastId === null,
    notifyOnNetworkStatusChange: true,
  });

  const refetchDetail = useCallback((): void => {
    void refetch();
  }, [refetch]);

  return {
    detail: data,
    detailLoading:
      broadcastId !== null &&
      (loading || networkStatus === NetworkStatus.loading || networkStatus === NetworkStatus.refetch),
    detailError: error,
    refetchDetail,
  };
}
