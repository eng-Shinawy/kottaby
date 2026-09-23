"use client";

/**
 * useWithdrawalQueries — the Apollo bindings of the pending-withdrawal
 * queue surface (the withdrawals tab of the admin financial auditing
 * console, `/admin/finances`): the oldest-first payout queue read and the
 * two settlement mutation hooks (approve / reject).
 *
 * The queue read is the backend's own ordering (`id ASC`); its
 * `previousData` fallback is scoped to the current variables (the echoed
 * `page`/`pageSize` pair) — a page change never renders the stale page's
 * rows while loading.
 *
 * The settlement mutations own the cache-refresh arm AND the error
 * classification: success refreshes the affected admin reads (the
 * withdrawal queue + the wallet inspector + the payments audit — the
 * settlement moves wallet balance and queue membership on the server);
 * every error code surfaces through the shared outcome arms up to the
 * container — never the raw server `message`.
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useMemo, useState } from "react";
import type {
  AdminPendingWithdrawalsQueryVariables,
  ApproveWithdrawalMutationVariables,
  RejectWithdrawalMutationVariables,
} from "@/frontend/graphql/generated/gql/graphql";
import {
  adminPendingWithdrawalsQueryDocument,
  approveWithdrawalMutationDocument,
  rejectWithdrawalMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { WITHDRAWALS_PAGE_SIZE } from "@/frontend/views/admin/finances/adminFinancePageSizes";
import {
  type MutationOutcomeCallbacks,
  routeMutationError,
} from "@/frontend/views/admin/finances/mutationErrorRouting";

/**
 * useAdminPendingWithdrawals — the oldest-first payout queue read (the
 * backend orders `id ASC`; the page/pageSize pair is the only control).
 */
export function useAdminPendingWithdrawals() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(WITHDRAWALS_PAGE_SIZE);

  const variables: AdminPendingWithdrawalsQueryVariables = useMemo(
    () => ({ page: page + 1, pageSize }),
    [page, pageSize]
  );

  const { data, previousData, loading, error, refetch } = useQuery(adminPendingWithdrawalsQueryDocument, {
    variables,
    fetchPolicy: "cache-and-network",
  });

  // The fallback is scoped to the current variables (echoed
  // `page`/`pageSize`): a page change never renders stale rows.
  const prevWithdrawals = previousData?.adminPendingWithdrawals;
  const pageData =
    data ??
    (prevWithdrawals?.page === variables.page && prevWithdrawals?.pageSize === variables.pageSize
      ? previousData
      : undefined);
  const items = pageData?.adminPendingWithdrawals.items ?? [];
  const totalCount = pageData?.adminPendingWithdrawals.totalCount ?? 0;
  // The WHOLE queue's pending payout sum — aggregated server-side over the
  // same predicate as `items` (page-size independent), so the queue header
  // renders an honest total for multi-page queues too.
  const totalAmount = pageData?.adminPendingWithdrawals.totalAmount ?? "0";
  const hasError = Boolean(error);

  const setPageSize = (nextPageSize: number): void => {
    setPageSizeState(nextPageSize);
    setPage(0);
  };

  return {
    items,
    totalCount,
    totalAmount,
    page,
    pageSize,
    setPage,
    setPageSize,
    loading,
    hasError,
    error,
    refetch,
  };
}

/**
 * useApproveWithdrawal — the settlement-to-completed mutation. On success
 * the queue + wallet inspector + payments reads refetch (the settlement
 * moves wallet balance and queue membership on the server). Errors surface
 * through the outcome arms — never the raw message.
 */
export function useApproveWithdrawal(callbacks: MutationOutcomeCallbacks) {
  const [approveWithdrawal, { loading }] = useMutation(approveWithdrawalMutationDocument, {
    refetchQueries: [
      "AdminPendingWithdrawals",
      // The tab badge runs the SAME document at its own window ({page:1,
      // pageSize:1}) — the by-NAME entry above does not guarantee that
      // instance refetches, so the badge descriptor is listed explicitly
      // (the badge must clear the instant the queue drains).
      { query: adminPendingWithdrawalsQueryDocument, variables: { page: 1, pageSize: 1 } },
      "AdminTeacherWallet",
      "AdminStudentPayments",
    ],
    awaitRefetchQueries: false,
    onCompleted: () => {
      callbacks.onSettled();
    },
    onError: error => routeMutationError(error, callbacks),
  });

  const approve = (transactionId: string): void => {
    const variables: ApproveWithdrawalMutationVariables = { transactionId };
    void approveWithdrawal({ variables });
  };

  return { approve, loading };
}

/**
 * useRejectWithdrawal — the settlement-to-failed mutation (balance restored
 * server-side). Same refetch + classification posture as the approve arm.
 */
export function useRejectWithdrawal(callbacks: MutationOutcomeCallbacks) {
  const [rejectWithdrawal, { loading }] = useMutation(rejectWithdrawalMutationDocument, {
    refetchQueries: [
      "AdminPendingWithdrawals",
      // Same badge-instance refetch as the approve arm (see the comment there).
      { query: adminPendingWithdrawalsQueryDocument, variables: { page: 1, pageSize: 1 } },
      "AdminTeacherWallet",
      "AdminStudentPayments",
    ],
    awaitRefetchQueries: false,
    onCompleted: () => {
      callbacks.onSettled();
    },
    onError: error => routeMutationError(error, callbacks),
  });

  const reject = (transactionId: string, reason: string): void => {
    const variables: RejectWithdrawalMutationVariables = { transactionId, reason };
    void rejectWithdrawal({ variables });
  };

  return { reject, loading };
}

/**
 * usePendingWithdrawalCount — the withdrawals TAB BADGE read: the same
 * `AdminPendingWithdrawals` document at the narrowest window
 * (`pageSize: 1`) so `totalCount` is the only payload that matters. Lives
 * beside the settlement mutations it depends on: those list this query
 * instance as an EXPLICIT refetch descriptor ({query, variables}) — the
 * by-NAME refetch does not reliably hit this instance — so the badge
 * clears the instant the queue drains; the light poll keeps it honest
 * when another admin (or a new teacher request) changes the queue behind
 * this tab.
 */
export function usePendingWithdrawalCount(): number {
  const { data } = useQuery(adminPendingWithdrawalsQueryDocument, {
    variables: { page: 1, pageSize: 1 },
    fetchPolicy: "cache-and-network",
    pollInterval: 30_000,
  });
  return data?.adminPendingWithdrawals.totalCount ?? 0;
}
