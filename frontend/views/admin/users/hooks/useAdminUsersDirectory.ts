"use client";

/**
 * useAdminUsersDirectory — state, query, and mutation wiring for
 * `AdminUsersDirectoryContainer` (the admin user directory surface).
 *
 * Composes `useDirectoryFilters` (the filter/search draft state, search
 * debounced at 300ms — the raw setters are shadowed by the page-resetting
 * wrappers from `createPageResettingFilterSetters`) and owns:
 *  - the `adminUsers` query (variables narrowed from the local filter unions
 *    to the GraphQL enums via `directoryConversions` — no `as` cast),
 *  - the create / update / soft-delete mutations, each refetching the
 *    current page via `refetchQueries` so the list stays honest without a
 *    manual reload,
 *  - the dialog targets (create / edit / delete) and the success snackbar.
 *
 * Presentation stays in `AdminUsersDirectoryContainer` and its siblings; this
 * module returns plain state — no JSX.
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useSearchParams } from "next/navigation";
import type { AdminUsersQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCreateUserMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminUpdateUserMutationDocument,
  adminUserCountryBreakdownQueryDocument,
  adminUsersQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { parseUsersUrlState, serializeUsersUrlState } from "@/frontend/views/admin/directory-url-state";
import {
  COUNTRY_BREAKDOWN_CHIP_LIMIT,
  useCountryBreakdown,
} from "@/frontend/views/admin/users/hooks/useCountryBreakdown";
import {
  createPageResettingFilterSetters,
  useDirectoryFilters,
} from "@/frontend/views/admin/users/hooks/useDirectoryFilters";
import { useDirectoryPageAndDialogs } from "@/frontend/views/admin/users/hooks/useDirectoryPageAndDialogs";
import { useUsersUrlSync } from "@/frontend/views/admin/users/hooks/useUsersUrlSync";
import { toApplicantStatus, toCooldownState, toGovernanceFilter, toUserRole } from "@/frontend/views/admin/users/utils";

/** The three directory write mutations, all refetching the current page after success. */
function useDirectoryMutations(variables: AdminUsersQueryVariables) {
  // Every completed write re-fetches the directory page (plus the country
  // breakdown facet — a create/delete can move a user between buckets) so
  // the list stays honest without a manual reload.
  const refetchAfterWrite = [
    { query: adminUsersQueryDocument, variables },
    { query: adminUserCountryBreakdownQueryDocument, variables: { limit: COUNTRY_BREAKDOWN_CHIP_LIMIT } },
  ];

  const [createUser, { loading: createLoading }] = useMutation(adminCreateUserMutationDocument, {
    refetchQueries: refetchAfterWrite,
    awaitRefetchQueries: true,
  });
  const [updateUser, { loading: updateLoading }] = useMutation(adminUpdateUserMutationDocument, {
    refetchQueries: refetchAfterWrite,
    awaitRefetchQueries: true,
  });
  const [setDeleted, { loading: deleteLoading }] = useMutation(adminSetUserDeletedMutationDocument, {
    refetchQueries: refetchAfterWrite,
    awaitRefetchQueries: true,
  });

  return { createUser, createLoading, updateUser, updateLoading, setDeleted, deleteLoading };
}

export function useAdminUsersDirectory() {
  const filters = useDirectoryFilters();
  const {
    roleFilter,
    governanceFilter,
    applicantStatusFilter,
    cooldownStateFilter,
    cooldownExpiringSoon,
    countryFilter,
    searchDebounced,
  } = filters;
  // The URL is read ONCE for pagination seeding (same params ref the filters
  // hook read — `parseUsersUrlState` is pure so re-parsing is free).
  const urlSeed = parseUsersUrlState(useSearchParams());
  const pageAndDialogs = useDirectoryPageAndDialogs(urlSeed.page, urlSeed.pageSize);
  const { page, pageSize } = pageAndDialogs;

  const variables: AdminUsersQueryVariables = {
    filters: {
      // Narrow the local draft unions to the GraphQL-codegen enums via the
      // runtime-validated converters (no `as unknown as ...` cast).
      role: roleFilter ? toUserRole(roleFilter) : null,
      governance: governanceFilter ? toGovernanceFilter(governanceFilter) : null,
      applicantStatus: applicantStatusFilter ? toApplicantStatus(applicantStatusFilter) : null,
      cooldownState: cooldownStateFilter ? toCooldownState(cooldownStateFilter) : null,
      cooldownExpiringSoon: cooldownExpiringSoon || null,
      country: countryFilter || null,
      search: searchDebounced || null,
    },
    page: page + 1,
    pageSize,
  };

  const { data, previousData, loading, error, refetch } = useQuery(adminUsersQueryDocument, {
    variables,
    fetchPolicy: "cache-and-network",
  });
  const countryFacet = useCountryBreakdown();
  const mutations = useDirectoryMutations(variables);

  // `errorPolicy: "none"` (the default) drops `data` to undefined when a
  // refetch fails; `previousData` keeps the last good page visible instead
  // of flashing the empty state next to the error alert.
  const pageData = data ?? previousData;
  const items = pageData?.adminUsers.items ?? [];
  const totalCount = pageData?.adminUsers.totalCount ?? 0;
  // The error alert must key on query failure itself, not on
  // `firstErrorCode`: a plain transport failure (raw `Error` with no
  // `extensions.code` / no `code`) extracts to `null`, which previously made
  // the error branch unreachable and let the empty state render instead.
  const hasError = Boolean(error);
  const firstErrorCode = error ? extractErrorCode(error) : null;
  const hasFilters =
    roleFilter !== "" ||
    governanceFilter !== "" ||
    applicantStatusFilter !== "" ||
    cooldownStateFilter !== "" ||
    cooldownExpiringSoon ||
    countryFilter !== "" ||
    searchDebounced !== "";

  // ── Shareable-URL write-back (the URL mirrors the APPLIED state) ──────
  // The applied (post-debounce) query string is written back through
  // `router.replace` by the sibling `useUsersUrlSync` hook — no history
  // entry per keystroke, `{ scroll: false }`, no replace churn when the
  // URL already mirrors the applied state.
  const appliedQuery = serializeUsersUrlState({
    q: searchDebounced,
    role: roleFilter,
    governance: governanceFilter,
    applicantStatus: applicantStatusFilter,
    cooldownState: cooldownStateFilter,
    cooldownExpiringSoon,
    country: countryFilter,
    page,
    pageSize,
  });
  useUsersUrlSync(appliedQuery);

  return {
    ...filters,
    // Page-resetting filter setters shadow the raw ones (the students
    // directory's invariant): picking a role/status/country or typing a
    // search always restarts the result set at page 1.
    ...createPageResettingFilterSetters(filters, pageAndDialogs.setPage),
    ...pageAndDialogs,
    ...mutations,
    items,
    totalCount,
    countryBuckets: countryFacet.countryBuckets,
    countryUnresolvedCount: countryFacet.countryUnresolvedCount,
    loading,
    hasError,
    firstErrorCode,
    refetch,
    hasFilters,
  };
}
