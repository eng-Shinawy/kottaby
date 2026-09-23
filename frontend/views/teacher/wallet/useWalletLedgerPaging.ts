"use client";

/**
 * useWalletLedgerPaging — the ledger source of truth behind the teacher
 * wallet's paginated read (the F10 forward item, now delivered).
 *
 * The ledger is its OWN query (`myWalletLedger`, the paginated companion
 * of `myWallet`) fetched with Apollo's canonical offset-pagination
 * pattern: the query owns the first page (offset 0) and `fetchMore` +
 * `updateQuery` append each older window IN THE QUERY RESULT ITSELF —
 * no local page copies, no setState-in-effect (the CI type-aware oxlint
 * gate forbids the pattern). Overlapping windows (a settlement landing
 * between two page fetches shifts the offset window) are deduped by row
 * id at merge time — first occurrence wins, newest-first order preserved.
 *
 * A settlement re-bases the ledger through `reset()` — a plain refetch of
 * page one, wired from the withdrawal success path (the mutation's cache
 * convergence still owns the BALANCE; the ledger query is a separate read
 * that must re-run to see the shuffling honestly).
 *
 * The `WalletLedgerPage` wire type carries no `id` by design (a read
 * window, not a cacheable entity), so these cache entries can never
 * collide with the normalized `Wallet:<id>` convergence the mutation
 * rides.
 *
 * Money discipline: rows are rendered verbatim; this module performs no
 * arithmetic on amounts (ids are the only dedupe key).
 */

import { NetworkStatus } from "@apollo/client";
import { useQuery } from "@apollo/client/react";
import { useCallback } from "react";
import type { MyWalletLedgerQuery } from "@/frontend/graphql/generated/gql/graphql";
import { myWalletLedgerQueryDocument } from "@/frontend/graphql/sharedDocuments";

/** One canonical ledger row (the same wire row shape both surfaces expose). */
type LedgerRow = MyWalletLedgerQuery["myWalletLedger"]["rows"][number];

/**
 * The page size for every window — the documented v1 ledger surface cap
 * (the server clamps to the same envelope).
 */
const PAGE_SIZE = 50;

/** The pagination truth the ledger footer + button render. */
export interface WalletLedgerPagingState {
  /** The merged newest-first rows (page one + loaded older windows). */
  readonly rows: readonly LedgerRow[];
  /** The server-side ledger total once the query has landed; null before. */
  readonly totalCount: number | null;
  /** Whether a further page exists. */
  readonly hasMore: boolean;
  /** True while the first page is in flight with nothing to show yet. */
  readonly loading: boolean;
  /** The first page failed with nothing to show — an honest error arm. */
  readonly errored: boolean;
  /** True while a "load more" window is in flight. */
  readonly loadingMore: boolean;
  /** Requests the next older window (no-op while one is already in flight). */
  readonly loadMore: () => void;
  /** Re-bases the ledger on a fresh first page (a settlement reshuffles it). */
  readonly reset: () => void;
}

/** The ledger "load more" state machine — see the module docblock. */
export function useWalletLedgerPaging(onLoadMoreError?: () => void): WalletLedgerPagingState {
  const { data, loading, error, networkStatus, refetch, fetchMore } = useQuery(myWalletLedgerQueryDocument, {
    variables: { limit: PAGE_SIZE, offset: 0 },
    notifyOnNetworkStatusChange: true,
  });

  const page = data?.myWalletLedger;
  const rows = page?.rows ?? [];

  const loadMore = useCallback((): void => {
    if (networkStatus === NetworkStatus.fetchMore || page?.hasMore !== true) return;
    void fetchMore({
      variables: { limit: PAGE_SIZE, offset: rows.length },
      updateQuery: (prev, { fetchMoreResult }) => {
        if (!fetchMoreResult) return prev;
        const seen = new Set(prev.myWalletLedger.rows.map(row => row.id));
        const fresh = fetchMoreResult.myWalletLedger.rows.filter(row => !seen.has(row.id));
        return {
          myWalletLedger: {
            ...fetchMoreResult.myWalletLedger,
            rows: [...prev.myWalletLedger.rows, ...fresh],
          },
        };
      },
    }).catch(() => {
      // The window failed — the ledger stays as-is; the container owns
      // the user-facing notice.
      onLoadMoreError?.();
    });
  }, [fetchMore, networkStatus, onLoadMoreError, page?.hasMore, rows.length]);

  const reset = useCallback((): void => {
    void refetch().catch(() => {
      // The re-base failed — the current rows stay on screen (honest,
      // possibly stale); the next visit refetches page one anyway.
    });
  }, [refetch]);

  return {
    rows,
    totalCount: page?.totalCount ?? null,
    hasMore: page?.hasMore ?? false,
    loading: rows.length === 0 && (loading || networkStatus === NetworkStatus.refetch),
    errored: rows.length === 0 && error !== undefined,
    loadingMore: networkStatus === NetworkStatus.fetchMore,
    loadMore,
    reset,
  };
}
