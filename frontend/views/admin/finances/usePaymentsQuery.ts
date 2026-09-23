"use client";

/**
 * usePaymentsQuery — the Apollo bindings of the payments audit surface
 * (the payments tab of the admin financial auditing console,
 * `/admin/finances`): the filterable/paginated payments audit read over
 * `adminStudentPaymentsQueryDocument` (`cache-and-network` so refetches
 * keep the current rows visible while the fresh page streams in).
 *
 * Filters are a normalized wire shape (`AdminStudentPaymentsFilterInput`)
 * built from the applied filter state — unset members ride as `null` (the
 * absent field), dates serialize to ISO-8601 UTC instants. The
 * `previousData` fallback is scoped to the current variables (the
 * envelope's echoed `page`/`pageSize` pair) — a filter/page change never
 * renders the stale page's rows while loading. The filter setters reset
 * the page so a new result set never opens on a stale page index.
 *
 * Amounts arrive as exact decimal STRINGS — never parsed to float here.
 * Enum members (`PaymentStatus`, `PaymentGateway`) are VALUE imports in
 * runtime expressions.
 */

import { useQuery } from "@apollo/client/react";
import { useMemo, useState } from "react";
import type {
  AdminStudentPaymentsFilterInput,
  AdminStudentPaymentsQueryVariables,
  PaymentGateway,
  PaymentStatus,
} from "@/frontend/graphql/generated/gql/graphql";
import { adminStudentPaymentsQueryDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { PAYMENTS_PAGE_SIZE } from "@/frontend/views/admin/finances/adminFinancePageSizes";

/** Applied payments-filter record the query variables are built from. */
export interface AppliedPaymentFilters {
  /** Escaped-server-side student-name substring search. */
  readonly studentName: string | null;
  readonly status: PaymentStatus | null;
  readonly paymentGateway: PaymentGateway | null;
  /** Inclusive range start at UTC midnight. */
  readonly from: Date | null;
  /** Exclusive range end (the midnight AFTER the selected calendar day). */
  readonly to: Date | null;
}

/** The unfiltered payments state — every member explicitly `null`. */
const NO_PAYMENT_FILTERS: AppliedPaymentFilters = {
  studentName: null,
  status: null,
  paymentGateway: null,
  from: null,
  to: null,
};

/**
 * Builds the GraphQL `filters` variable carrying ONLY the non-empty values
 * (the wire filters object never carries nulls as JSON members — MockLink
 * and the backend treat undefined-valued keys as absent).
 */
function buildPaymentFiltersInput(applied: AppliedPaymentFilters): AdminStudentPaymentsFilterInput {
  const filters: AdminStudentPaymentsFilterInput = {
    studentId: null,
    studentName: undefined,
    status: undefined,
    paymentGateway: undefined,
    from: undefined,
    to: undefined,
  };
  if (applied.studentName !== null && applied.studentName !== "") filters.studentName = applied.studentName;
  if (applied.status !== null) filters.status = applied.status;
  if (applied.paymentGateway !== null) filters.paymentGateway = applied.paymentGateway;
  if (applied.from !== null) filters.from = applied.from.toISOString();
  if (applied.to !== null) filters.to = applied.to.toISOString();
  return filters;
}

/**
 * useAdminStudentPayments — the payments audit read: applied-filter +
 * pagination state, the stateful query, and the honest envelope slicing.
 * The filter setters reset the page so a new result set never opens on a
 * stale page index.
 */
export function useAdminStudentPayments(initialFilters: AppliedPaymentFilters = NO_PAYMENT_FILTERS) {
  const [appliedFilters, setAppliedFilters] = useState<AppliedPaymentFilters>(initialFilters);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(PAYMENTS_PAGE_SIZE);

  const variables: AdminStudentPaymentsQueryVariables = useMemo(
    () => ({
      filters: buildPaymentFiltersInput(appliedFilters),
      page: page + 1,
      pageSize,
    }),
    [appliedFilters, page, pageSize]
  );

  const { data, previousData, loading, error, refetch } = useQuery(adminStudentPaymentsQueryDocument, {
    variables,
    fetchPolicy: "cache-and-network",
  });

  // The fallback is scoped to the current variables (echoed
  // `page`/`pageSize`): a filter/page change never renders stale rows.
  const prevPayments = previousData?.adminStudentPayments;
  const pageData =
    data ??
    (prevPayments?.page === variables.page && prevPayments?.pageSize === variables.pageSize ? previousData : undefined);
  const items = pageData?.adminStudentPayments.items ?? [];
  const totalCount = pageData?.adminStudentPayments.totalCount ?? 0;
  const hasError = Boolean(error);

  const setPageSize = (nextPageSize: number): void => {
    setPageSizeState(nextPageSize);
    setPage(0);
  };

  const applyFilters = (next: AppliedPaymentFilters): void => {
    setAppliedFilters(next);
    setPage(0);
  };

  const resetFilters = (): void => {
    setAppliedFilters(NO_PAYMENT_FILTERS);
    setPage(0);
  };

  return {
    items,
    totalCount,
    page,
    pageSize,
    setPage,
    setPageSize,
    applyFilters,
    resetFilters,
    appliedFilters,
    loading,
    hasError,
    error,
    refetch,
  };
}
