"use client";

/**
 * DirectoryToolbarFiltersRow — the admin user directory toolbar's dedicated
 * filters row (the toolbar's second row): the search field, the role select,
 * the lifecycle filter selects, and the country field, followed by a
 * "clear filters" text button (rendered only while at least one filter is
 * set, right-aligned at the row's trailing edge).
 *
 * The row wraps onto further lines only on the narrowest md widths — the
 * actions live on their own row above (see `DirectoryToolbarActions`), so
 * nothing here can clip the Create button off the card edge. Clearing
 * resets every filter draft (each hook setter also restarts the result
 * set at page 1 — the same invariant as picking a single filter). Label
 * slices are passed down narrowed — nothing is hardcoded.
 */

import { Box, Button } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryRoleFilter, DirectorySearchField } from "@/frontend/views/admin/users/directory";
import {
  DirectoryApplicantStatusFilterSelect,
  DirectoryCooldownStateFilterSelect,
  DirectoryCountryFilter,
  DirectoryGovernanceFilter,
} from "@/frontend/views/admin/users/directory/DirectoryToolbarFilters";
import type {
  DirectoryApplicantStatus,
  DirectoryCooldownState,
  DirectoryGovernance,
  DirectoryRole,
} from "@/frontend/views/admin/users/utils";
import type { CountryCode } from "@/shared/constants/countries";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type FiltersRowLabels = Pick<AdminUsersLabels, "filters" | "roleLabels" | "statusBadges" | "genderOptions">;

/**
 * The toolbar's live filter state — the six filter values and their
 * setters. `DirectoryToolbar` owns this state and extends the same shape,
 * so the two prop interfaces can never drift apart.
 */
export interface DirectoryToolbarFilterStateProps {
  readonly roleFilter: DirectoryRole | "";
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly governanceFilter: DirectoryGovernance | "";
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
  readonly applicantStatusFilter: DirectoryApplicantStatus | "";
  readonly setApplicantStatusFilter: (value: DirectoryApplicantStatus | "") => void;
  readonly cooldownStateFilter: DirectoryCooldownState | "";
  readonly setCooldownStateFilter: (value: DirectoryCooldownState | "") => void;
  readonly countryFilter: CountryCode | "";
  readonly setCountryFilter: (value: CountryCode | "") => void;
  readonly searchInput: string;
  readonly setSearchInput: (value: string) => void;
}

interface DirectoryToolbarFiltersRowProps extends DirectoryToolbarFilterStateProps {
  readonly labels: FiltersRowLabels;
}

export function DirectoryToolbarFiltersRow(props: DirectoryToolbarFiltersRowProps): ReactNode {
  // Stable element ids — wire `InputLabel htmlFor` ↔ control `id` so screen
  // readers announce the label when focus lands on the control (axe-core
  // `aria-input-field-name` rule). Prefixed with the component name to avoid
  // collisions with other admin surfaces.
  const ROLE_ID = "admin-users-toolbar-role";
  const GOVERNANCE_ID = "admin-users-toolbar-governance";
  const APPLICANT_STATUS_ID = "admin-users-toolbar-applicant-status";
  const COOLDOWN_STATE_ID = "admin-users-toolbar-cooldown-state";
  const COUNTRY_ID = "admin-users-toolbar-country";
  const SEARCH_ID = "admin-users-toolbar-search";
  const hasFilters =
    props.roleFilter !== "" ||
    props.governanceFilter !== "" ||
    props.applicantStatusFilter !== "" ||
    props.cooldownStateFilter !== "" ||
    props.countryFilter !== "" ||
    props.searchInput !== "";
  const handleClearFilters = () => {
    props.setRoleFilter("");
    props.setGovernanceFilter("");
    props.setApplicantStatusFilter("");
    props.setCooldownStateFilter("");
    props.setCountryFilter("");
    props.setSearchInput("");
  };
  return (
    <Box
      sx={{
        display: "flex",
        width: "100%",
        flexWrap: "wrap",
        rowGap: 2,
        // 16px column rhythm between the fields: without it the 150px
        // selects sit butt-joined (shared 1px seams) and fuse with the
        // search field — pass-2 inspector MEDIUM.
        columnGap: 2,
        alignItems: "center",
      }}
    >
      <DirectorySearchField
        id={SEARCH_ID}
        labels={props.labels}
        value={props.searchInput}
        onChange={props.setSearchInput}
      />
      <DirectoryRoleFilter
        id={ROLE_ID}
        roleFilter={props.roleFilter}
        setRoleFilter={props.setRoleFilter}
        labels={props.labels}
      />
      <DirectoryGovernanceFilter
        id={GOVERNANCE_ID}
        labels={props.labels}
        governanceFilter={props.governanceFilter}
        setGovernanceFilter={props.setGovernanceFilter}
      />
      <DirectoryApplicantStatusFilterSelect
        id={APPLICANT_STATUS_ID}
        labels={props.labels}
        applicantStatusFilter={props.applicantStatusFilter}
        setApplicantStatusFilter={props.setApplicantStatusFilter}
      />
      <DirectoryCooldownStateFilterSelect
        id={COOLDOWN_STATE_ID}
        labels={props.labels}
        cooldownStateFilter={props.cooldownStateFilter}
        setCooldownStateFilter={props.setCooldownStateFilter}
      />
      <DirectoryCountryFilter
        id={COUNTRY_ID}
        labels={props.labels}
        countryFilter={props.countryFilter}
        setCountryFilter={props.setCountryFilter}
      />
      {hasFilters && (
        <Button
          variant="text"
          onClick={handleClearFilters}
          sx={theme => ({
            minHeight: 44,
            flexShrink: 0,
            // Auto margin pins the clear action to the filters row's
            // trailing edge, visually pairing it with the filters it
            // resets.
            marginInlineStart: "auto",
            color: theme.palette.text.secondary,
          })}
        >
          {props.labels.filters.clear}
        </Button>
      )}
    </Box>
  );
}
