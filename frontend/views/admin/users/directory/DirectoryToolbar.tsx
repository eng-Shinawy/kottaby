"use client";

/**
 * DirectoryToolbar — the admin user directory's filter + create surface
 * (DESKTOP ONLY — hidden below `md`; on mobile filtering happens through
 * `FilterChipsRow` and creation through the fixed `Fab`, matching the
 * prototype).
 *
 * White card (radius 12, `border.light` outline, `shadow.card`), 24px
 * padding. Contents laid out as a single horizontal flex row (wrapping is
 * allowed only below `md`, so the Create button never drops onto its own
 * row on desktop):
 *  1. search field (magnifier leading adornment, ~400px max width),
 *  2. role select,
 *  3. status (governance) select,
 *  4. country field,
 *  5. flex spacer, then a "clear filters" text button (rendered only while
 *     at least one filter is set) and the primary **Create User** button
 *     (44px tall, `flexShrink: 0`, never wraps its label).
 *
 * Replaces the old `FilterBar` card; the create button moved here from the
 * page title row. Label slices are passed down narrowed — nothing is
 * hardcoded. All colors resolve through theme-callback sx; selects and
 * inputs hold a uniform 44px height.
 */

import { AddOutlined as AddIcon } from "@mui/icons-material";
import { Box, Button, Card, FormControl, InputLabel, MenuItem, Select, TextField } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryRoleFilter, DirectorySearchField } from "@/frontend/views/admin/users/directory";
import type { DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type ToolbarLabels = Pick<
  AdminUsersLabels,
  "filters" | "roleLabels" | "statusBadges" | "genderOptions" | "createDialog"
>;

interface DirectoryToolbarProps {
  readonly labels: ToolbarLabels;
  readonly roleFilter: DirectoryRole | "";
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly governanceFilter: DirectoryGovernance | "";
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
  readonly countryFilter: string;
  readonly setCountryFilter: (value: string) => void;
  readonly searchInput: string;
  readonly setSearchInput: (value: string) => void;
  readonly onCreateUser: () => void;
}

export function DirectoryToolbar(props: DirectoryToolbarProps): ReactNode {
  const { labels } = props;
  // Stable element ids — wire `InputLabel htmlFor` ↔ control `id` so screen
  // readers announce the label when focus lands on the control (axe-core
  // `aria-input-field-name` rule). Prefixed with the component name to avoid
  // collisions with other admin surfaces.
  const ROLE_ID = "admin-users-toolbar-role";
  const GOVERNANCE_ID = "admin-users-toolbar-governance";
  const COUNTRY_ID = "admin-users-toolbar-country";
  const SEARCH_ID = "admin-users-toolbar-search";
  const hasFilters =
    props.roleFilter !== "" || props.governanceFilter !== "" || props.countryFilter !== "" || props.searchInput !== "";
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
        sx={{ display: "flex", width: "100%", flexWrap: { xs: "wrap", md: "nowrap" }, gap: 2, alignItems: "center" }}
      >
        <DirectorySearchField
          id={SEARCH_ID}
          labels={labels}
          value={props.searchInput}
          onChange={props.setSearchInput}
        />
        <DirectoryRoleFilter
          id={ROLE_ID}
          roleFilter={props.roleFilter}
          setRoleFilter={props.setRoleFilter}
          labels={labels}
        />
        <FormControl sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" } }}>
          <InputLabel htmlFor={GOVERNANCE_ID}>{labels.filters.governance}</InputLabel>
          <Select
            id={GOVERNANCE_ID}
            value={props.governanceFilter}
            label={labels.filters.governance}
            onChange={event => props.setGovernanceFilter(event.target.value || "")}
            sx={{
              height: 44,
              // Vertically center the visible value inside the fixed 44px
              // control: the default block padding makes the inner select box
              // taller than the outlined root.
              "&& .MuiSelect-select": {
                minHeight: 44,
                boxSizing: "border-box",
                paddingBlock: 0,
                display: "flex",
                alignItems: "center",
              },
              "& .MuiSelect-nativeInput": { height: "100%" },
            }}
          >
            <MenuItem value="">{labels.genderOptions.unspecified}</MenuItem>
            <MenuItem value="Active">{labels.statusBadges.active}</MenuItem>
            <MenuItem value="Suspended">{labels.statusBadges.suspended}</MenuItem>
            <MenuItem value="Blocked">{labels.statusBadges.blocked}</MenuItem>
            <MenuItem value="Deleted">{labels.statusBadges.deleted}</MenuItem>
          </Select>
        </FormControl>
        <TextField
          id={COUNTRY_ID}
          label={labels.filters.country}
          value={props.countryFilter}
          onChange={event => props.setCountryFilter(event.target.value)}
          sx={{ minWidth: 150, flex: { xs: "1 1 100%", sm: "0 1 auto" }, "& .MuiInputBase-root": { height: 44 } }}
        />
        <Box sx={{ flex: 1 }} />
        {hasFilters && (
          <Button
            variant="text"
            onClick={() => {
              props.setRoleFilter("");
              props.setGovernanceFilter("");
              props.setCountryFilter("");
              props.setSearchInput("");
            }}
            sx={theme => ({ minHeight: 44, flexShrink: 0, color: theme.palette.text.secondary })}
          >
            {labels.filters.clear}
          </Button>
        )}
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={props.onCreateUser}
          sx={{ borderRadius: "8px", height: 44, flexShrink: 0, whiteSpace: "nowrap" }}
        >
          {labels.createDialog.title}
        </Button>
      </Box>
    </Card>
  );
}
