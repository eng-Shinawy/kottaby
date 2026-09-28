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
import { parseUsersUrlState } from "@/frontend/views/admin/directory-url-state";
import type {
  DirectoryApplicantStatus,
  DirectoryCooldownState,
  DirectoryGovernance,
  DirectoryRole,
} from "@/frontend/views/admin/users/utils";

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
  const [countryFilter, setCountryFilter] = useState(urlSeed.country);
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
    setCountryFilter: (value: string) => {
      filters.setCountryFilter(value);
      setPage(0);
    },
    setSearchInput: (value: string) => {
      filters.setSearchInput(value);
      setPage(0);
    },
  };
}
