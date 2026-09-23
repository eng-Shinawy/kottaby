"use client";

/**
 * useWalletQuery — the Apollo bindings of the teacher wallet inspector
 * surface (the wallet tab of the admin financial auditing console,
 * `/admin/finances`): the wallet inspector read keyed to the picked
 * teacher plus the applied transaction filters.
 *
 * The query is SKIPPED while no teacher is picked (the picker seeds from
 * the `?teacherId=` deep link) via `skipToken`, which forces the `standby`
 * fetch policy — standby watchers are excluded from every refetch path
 * (`refetchQueries` skips them), so no network request can ever fire with
 * the `"0"` sentinel variables. The `previousData` fallback is scoped to
 * the CURRENT teacher (the document's embedded `adminTeacherWallet.teacherId`)
 * — a teacher switch never renders the other teacher's wallet while loading.
 */

import { skipToken, useQuery } from "@apollo/client/react";
import { useMemo, useState } from "react";
import type {
  AdminTeacherWalletQueryVariables,
  TransactionStatus,
  TransactionType,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminTeacherWalletQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { WALLET_PAGE_SIZE } from "@/frontend/views/admin/finances/adminFinancePageSizes";

/** Applied wallet-transaction filter record. */
export interface AppliedWalletFilters {
  readonly type: TransactionType | null;
  readonly status: TransactionStatus | null;
  readonly from: Date | null;
  readonly to: Date | null;
}

/** The unfiltered wallet-transaction state. */
const NO_WALLET_FILTERS: AppliedWalletFilters = {
  type: null,
  status: null,
  from: null,
  to: null,
};

/** Wallet-transaction filters variable — the only-non-empty posture. */
function buildWalletFiltersInput(applied: AppliedWalletFilters): AdminTeacherWalletQueryVariables["filters"] {
  const filters: NonNullable<AdminTeacherWalletQueryVariables["filters"]> = {
    type: undefined,
    status: undefined,
    from: undefined,
    to: undefined,
  };
  if (applied.type !== null) filters.type = applied.type;
  if (applied.status !== null) filters.status = applied.status;
  if (applied.from !== null) filters.from = applied.from.toISOString();
  if (applied.to !== null) filters.to = applied.to.toISOString();
  return filters;
}

/**
 * useAdminTeacherWallet — the wallet inspector read: the picked teacher id
 * (nullable — the picker seeds from the `?teacherId=` deep link), the
 * applied transaction filters, and the stateful query SKIPPED while no
 * teacher is picked (`skipToken` — no refetch can fire the sentinel
 * variables).
 */
export function useAdminTeacherWallet(
  initialTeacherId: number | null,
  initialFilters: AppliedWalletFilters = NO_WALLET_FILTERS
) {
  const [teacherId, setTeacherId] = useState<number | null>(initialTeacherId);
  const [appliedFilters, setAppliedFilters] = useState<AppliedWalletFilters>(initialFilters);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(WALLET_PAGE_SIZE);

  const variables: AdminTeacherWalletQueryVariables = useMemo(
    () => ({
      teacherId: teacherId === null ? "0" : String(teacherId),
      filters: buildWalletFiltersInput(appliedFilters),
      page: page + 1,
      pageSize,
    }),
    [teacherId, appliedFilters, page, pageSize]
  );

  const { data, previousData, loading, error, refetch } = useQuery(
    adminTeacherWalletQueryDocument,
    // `skipToken` (NOT `skip: boolean`) — the token form forces the
    // `standby` fetch policy, and standby watchers are excluded from every
    // refetch path (`refetchQueries` skips them), so the `"0"` sentinel
    // variables can never reach the network while no teacher is picked.
    teacherId === null ? skipToken : { fetchPolicy: "cache-and-network" as const, variables }
  );

  // The fallback is scoped to the current teacher (the embedded
  // `adminTeacherWallet.teacherId`): a teacher switch never renders the
  // other teacher's wallet while loading. The `"0"` sentinel cannot cross
  // the null boundary (skipToken → standby, no refetch), but the guard is
  // total. The null-pair `balance`/`totalEarning` means no wallet row yet —
  // forwarded VERBATIM (never fake zeros).
  const pageData =
    data ?? (previousData?.adminTeacherWallet.teacherId === String(variables.teacherId) ? previousData : undefined);
  const wallet = pageData?.adminTeacherWallet ?? null;
  const hasError = Boolean(error);

  const setPageSize = (nextPageSize: number): void => {
    setPageSizeState(nextPageSize);
    setPage(0);
  };

  const applyFilters = (next: AppliedWalletFilters): void => {
    setAppliedFilters(next);
    setPage(0);
  };

  const resetFilters = (): void => {
    setAppliedFilters(NO_WALLET_FILTERS);
    setPage(0);
  };

  return {
    teacherId,
    setTeacherId,
    wallet,
    page,
    pageSize,
    setPage,
    setPageSize,
    applyFilters,
    resetFilters,
    appliedFilters,
    loading: loading && teacherId !== null,
    hasError,
    error,
    refetch,
  };
}
