"use client";

/**
 * useAdminUsersDirectory — state, query, and mutation wiring for
 * `AdminUsersDirectoryContainer` (the admin user directory surface).
 *
 * Owns:
 *  - the filter/search/pagination draft state (search debounced at 300ms),
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
import { useState } from "react";
import type { AdminUsersQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminCreateUserMutationDocument,
  adminSetUserDeletedMutationDocument,
  adminUpdateUserMutationDocument,
  adminUsersQueryDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import type { DirectoryUserItem } from "@/frontend/views/admin/users/directory";
import {
  type DirectoryGovernance,
  type DirectoryRole,
  toGovernanceFilter,
  toUserRole,
} from "@/frontend/views/admin/users/utils";

type Role = DirectoryRole;
type Governance = DirectoryGovernance;
export type DirectoryUserListItem = DirectoryUserItem;

const DEFAULT_PAGE_SIZE = 10;

/** Role / governance / country / search filter draft state (search debounced at 300ms). */
function useDirectoryFilters() {
  const [roleFilter, setRoleFilter] = useState<Role | "">("");
  const [governanceFilter, setGovernanceFilter] = useState<Governance | "">("");
  const [countryFilter, setCountryFilter] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  // Debounce search input (300ms).
  if (searchInput !== searchDebounced) {
    setTimeout(() => setSearchDebounced(searchInput), 300);
  }

  return {
    roleFilter,
    setRoleFilter,
    governanceFilter,
    setGovernanceFilter,
    countryFilter,
    setCountryFilter,
    searchInput,
    setSearchInput,
    searchDebounced,
  };
}

/** Pagination draft state + the create/edit/delete dialog targets + success snackbar. */
function useDirectoryPageAndDialogs() {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSizeState] = useState(DEFAULT_PAGE_SIZE);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DirectoryUserListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DirectoryUserListItem | null>(null);
  const [snackbarMessage, setSnackbarMessage] = useState<string | null>(null);

  const setPageSize = (value: number) => {
    setPageSizeState(value);
    setPage(0);
  };

  return {
    page,
    pageSize,
    setPage,
    setPageSize,
    createOpen,
    setCreateOpen,
    editTarget,
    setEditTarget,
    deleteTarget,
    setDeleteTarget,
    snackbarMessage,
    setSnackbarMessage,
  };
}

/** The three directory write mutations, all refetching the current page after success. */
function useDirectoryMutations(variables: AdminUsersQueryVariables) {
  // Every completed write re-fetches the directory page so the list stays
  // honest without a manual reload.
  const refetchAfterWrite = [{ query: adminUsersQueryDocument, variables }];

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
  const { roleFilter, governanceFilter, countryFilter, searchDebounced } = filters;
  const pageAndDialogs = useDirectoryPageAndDialogs();
  const { page, pageSize } = pageAndDialogs;

  const variables: AdminUsersQueryVariables = {
    filters: {
      // Narrow the local `Role` / `Governance` string-literal unions to the
      // GraphQL-codegen `UserRole` / `AdminUserGovernanceFilter` enums via
      // the runtime-validated `toUserRole` / `toGovernanceFilter` helpers
      // (no `as unknown as ...` cast).
      role: roleFilter ? toUserRole(roleFilter) : null,
      governance: governanceFilter ? toGovernanceFilter(governanceFilter) : null,
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
  const hasFilters = roleFilter !== "" || governanceFilter !== "" || countryFilter !== "" || searchDebounced !== "";

  return {
    ...filters,
    ...pageAndDialogs,
    ...mutations,
    items,
    totalCount,
    loading,
    hasError,
    firstErrorCode,
    refetch,
    hasFilters,
  };
}
