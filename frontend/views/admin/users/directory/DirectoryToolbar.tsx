"use client";

/**
 * DirectoryToolbar — the admin user directory's filter + create surface
 * (DESKTOP ONLY — hidden below `md`; on mobile filtering happens through
 * `FilterChipsRow` and creation through the fixed `Fab`, matching the
 * prototype).
 *
 * White card (radius 12, `border.light` outline, `shadow.card`), 24px
 * padding. Contents laid out as a horizontal flex row that WRAPS when the
 * viewport is too tight (only extra-wide `xl` screens hold the single
 * line — the three action buttons plus four filter controls exceed the
 * md–lg band once the shareable-view Copy link joined the row):
 *  1. search field (magnifier leading adornment, ~400px max width),
 *  2. role select + the lifecycle filter selects and the country field
 *     (extracted to `DirectoryToolbarFilters`),
 *  3. flex spacer, then a "clear filters" text button (rendered only while
 *     at least one filter is set), the shareable-view **Copy link** action,
 *     and the primary **Create User** button (44px tall, `flexShrink: 0`,
 *     never wraps its label).
 *
 * Replaces the old `FilterBar` card; the create button moved here from the
 * page title row. Label slices are passed down narrowed — nothing is
 * hardcoded. All colors resolve through theme-callback sx; selects and
 * inputs hold a uniform 44px height.
 */

import { Box, Card } from "@mui/material";
import type { ReactNode } from "react";
import {
  DirectoryRoleFilter,
  DirectorySearchField,
  DirectoryToolbarActions,
} from "@/frontend/views/admin/users/directory";
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

type ToolbarLabels = Pick<
  AdminUsersLabels,
  "filters" | "roleLabels" | "statusBadges" | "genderOptions" | "createDialog" | "quickActions"
>;

interface DirectoryToolbarProps {
  readonly labels: ToolbarLabels;
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
  readonly onCreateUser: () => void;
  /** Reports the successful copy-link through the surface's shared snackbar. */
  readonly onCopyLink: () => void;
}

export function DirectoryToolbar(props: DirectoryToolbarProps): ReactNode {
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
  // Clearing resets every filter draft (each hook setter also restarts the
  // result set at page 1 — the same invariant as picking a single filter).
  const handleClearFilters = () => {
    props.setRoleFilter("");
    props.setGovernanceFilter("");
    props.setApplicantStatusFilter("");
    props.setCooldownStateFilter("");
    props.setCountryFilter("");
    props.setSearchInput("");
  };
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 3,
        // Desktop-only surface: mobile filters live in `FilterChipsRow` and
        // the create affordance is the fixed `Fab` (prototype parity). The
        // card turns into a flex line on md+ so the inner row keeps owning
        // the full width.
        display: { xs: "none", md: "flex" },
      })}
    >
      <Box
        sx={{
          display: "flex",
          width: "100%",
          // The single-line layout only holds from `xl` up — below that the
          // actions (all `flexShrink: 0`) wrap onto their own row instead of
          // clipping the Create button off the card edge.
          flexWrap: { xs: "wrap", xl: "nowrap" },
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
        <DirectoryToolbarActions
          labels={props.labels}
          hasFilters={hasFilters}
          onClearFilters={handleClearFilters}
          onCopyLink={props.onCopyLink}
          onCreateUser={props.onCreateUser}
        />
      </Box>
    </Card>
  );
}
