"use client";

/**
 * useDirectoryFilters — the admin users directory's filter draft state plus
 * the page-resetting setter wrapper its composing hook spreads over it.
 *
 * Extracted from `useAdminUsersDirectory`, which composes it with the URL
 * read for pagination seeding, the query, the mutations, and the URL-sync
 * effect.
 */

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import type { AdminUsersQueryVariables } from "@/frontend/graphql/generated/gql/graphql";
import { parseUsersUrlState } from "@/frontend/views/admin/directory-url-state";
import {
  type DirectoryApplicantStatus,
  type DirectoryCooldownState,
  type DirectoryGovernance,
  type DirectoryRole,
  toApplicantStatus,
  toCooldownState,
  toGovernanceFilter,
  toUserRole,
} from "@/frontend/views/admin/users/utils";
import type { CountryCode } from "@/shared/constants/countries";
import { countrySeedToCode } from "@/shared/lib/country-code";

type Role = DirectoryRole;
type Governance = DirectoryGovernance;
type ApplicantStatusFilter = DirectoryApplicantStatus;
type CooldownStateFilter = DirectoryCooldownState;

/**
 * Role / governance / applicant-lifecycle / country / search filter draft
 * state (search debounced at 300ms). Every value seeds from the URL contract
 * (`/users` shareable link); the applied search seeds BOTH the draft and the
 * debounced value so the FIRST query is already filtered — no unfiltered
 * first fetch.
 *
 * The country draft is a `CountryCode | ""` (the toolbar renders the shared
 * selector), so the URL seed resolves through `countrySeedToCode`: canonical
 * codes, padded/lowercase variants, AND legacy display-text links
 * (`country=Egypt`) all seed the picker, while unresolvable values fail
 * closed to the no-filter default.
 */
export function useDirectoryFilters() {
  const urlSeed = parseUsersUrlState(useSearchParams());
  const [roleFilter, setRoleFilter] = useState<Role | "">(urlSeed.role);
  const [governanceFilter, setGovernanceFilter] = useState<Governance | "">(urlSeed.governance);
  const [applicantStatusFilter, setApplicantStatusFilter] = useState<ApplicantStatusFilter | "">(
    urlSeed.applicantStatus
  );
  const [cooldownStateFilter, setCooldownStateFilter] = useState<CooldownStateFilter | "">(urlSeed.cooldownState);
  const [cooldownExpiringSoon, setCooldownExpiringSoon] = useState(urlSeed.cooldownExpiringSoon);
  const [countryFilter, setCountryFilter] = useState<CountryCode | "">(countrySeedToCode(urlSeed.country));
  const [searchInput, setSearchInput] = useState(urlSeed.q);
  const [searchDebounced, setSearchDebounced] = useState(urlSeed.q);

  // Debounce search input (300ms).
  if (searchInput !== searchDebounced) {
    setTimeout(() => setSearchDebounced(searchInput), 300);
  }

  return {
    roleFilter,
    setRoleFilter,
    governanceFilter,
    setGovernanceFilter,
    applicantStatusFilter,
    setApplicantStatusFilter,
    cooldownStateFilter,
    setCooldownStateFilter,
    cooldownExpiringSoon,
    setCooldownExpiringSoon,
    countryFilter,
    setCountryFilter,
    searchInput,
    setSearchInput,
    searchDebounced,
  };
}

/**
 * Page-resetting filter setters that shadow the raw `useDirectoryFilters`
 * setters (the students directory's invariant): picking a role/status/
 * country or typing a search always restarts the result set at page 1,
 * never on a stale (possibly out-of-range) page index. The raw setters stay
 * available for the URL-seeded initial state, which must NOT reset.
 */
export function createPageResettingFilterSetters(
  filters: ReturnType<typeof useDirectoryFilters>,
  setPage: (page: number) => void
) {
  return {
    setRoleFilter: (value: Role | "") => {
      filters.setRoleFilter(value);
      setPage(0);
    },
    setGovernanceFilter: (value: Governance | "") => {
      filters.setGovernanceFilter(value);
      setPage(0);
    },
    setApplicantStatusFilter: (value: ApplicantStatusFilter | "") => {
      filters.setApplicantStatusFilter(value);
      setPage(0);
    },
    setCooldownStateFilter: (value: CooldownStateFilter | "") => {
      filters.setCooldownStateFilter(value);
      setPage(0);
    },
    setCooldownExpiringSoon: (value: boolean) => {
      filters.setCooldownExpiringSoon(value);
      setPage(0);
    },
    setCountryFilter: (value: CountryCode | "") => {
      filters.setCountryFilter(value);
      setPage(0);
    },
    setSearchInput: (value: string) => {
      filters.setSearchInput(value);
      setPage(0);
    },
  };
}

/** The raw filter draft fields the query-variables builder consumes. */
type DirectoryFilterFields = Pick<
  ReturnType<typeof useDirectoryFilters>,
  | "roleFilter"
  | "governanceFilter"
  | "applicantStatusFilter"
  | "cooldownStateFilter"
  | "cooldownExpiringSoon"
  | "countryFilter"
  | "searchDebounced"
>;

/**
 * Builds the `adminUsers` query variables from the raw filter unions + page
 * state: the local draft unions narrow to the GraphQL enums via the
 * runtime-validated converters (no `as` cast), the 0-based page offsets to
 * the 1-based wire page, and every empty string collapses to `null` (the
 * forgiving read rule at the query boundary).
 */
export function buildDirectoryQueryVariables(
  filters: DirectoryFilterFields,
  page: number,
  pageSize: number
): AdminUsersQueryVariables {
  const {
    roleFilter,
    governanceFilter,
    applicantStatusFilter,
    cooldownStateFilter,
    cooldownExpiringSoon,
    countryFilter,
    searchDebounced,
  } = filters;
  return {
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
}
