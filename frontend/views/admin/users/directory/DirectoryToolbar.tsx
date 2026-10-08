"use client";

/**
 * DirectoryToolbar — the admin user directory's two-row filter + create
 * surface (DESKTOP ONLY — hidden below `md`; on mobile filtering happens
 * through `FilterChipsRow` and creation through the fixed `Fab`, matching
 * the prototype).
 *
 * White card (radius 12, `border.light` outline, `shadow.card`), 24px
 * padding. Contents laid out as two stacked rows so the actions never
 * compete for width with the filter controls:
 *  1. **Actions row** — the shareable-view **Copy link** action and the
 *     primary **Create User** button (54px tall, `flexShrink: 0`, never
 *     wraps its label), right-aligned via `DirectoryToolbarActions`.
 *  2. **Filters row** — the search field (~400px max width), the role
 *     select, the lifecycle filter selects, and the country field,
 *     followed by a "clear filters" text button (rendered only while at
 *     least one filter is set) — extracted to
 *     `DirectoryToolbarFiltersRow`.
 *
 * Replaces the old single wrapping row whose action group could clip the
 * Create button off the card edge on md–lg widths; the create button
 * moved here from the page title row. Label slices are passed down
 * narrowed — nothing is hardcoded. All colors resolve through
 * theme-callback sx; selects and inputs hold a uniform 44px height.
 */

import { Box, Card } from "@mui/material";
import type { ReactNode } from "react";
import {
  DirectoryToolbarActions,
  type DirectoryToolbarFilterStateProps,
  DirectoryToolbarFiltersRow,
} from "@/frontend/views/admin/users/directory";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type ToolbarLabels = Pick<
  AdminUsersLabels,
  "filters" | "roleLabels" | "statusBadges" | "genderOptions" | "createDialog" | "quickActions"
>;

interface DirectoryToolbarProps extends DirectoryToolbarFilterStateProps {
  readonly labels: ToolbarLabels;
  readonly onCreateUser: () => void;
  /** Reports the successful copy-link through the surface's shared snackbar. */
  readonly onCopyLink: () => void;
}

export function DirectoryToolbar(props: DirectoryToolbarProps): ReactNode {
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 3,
        // Desktop-only surface: mobile filters live in `FilterChipsRow` and
        // the create affordance is the fixed `Fab` (prototype parity). The
        // card stacks its two rows on md+ so each keeps owning the full
        // width.
        display: { xs: "none", md: "flex" },
      })}
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          // Vertical rhythm between the actions row and the filters row.
          rowGap: 2,
        }}
      >
        <DirectoryToolbarActions
          labels={props.labels}
          onCopyLink={props.onCopyLink}
          onCreateUser={props.onCreateUser}
        />
        <DirectoryToolbarFiltersRow
          labels={props.labels}
          roleFilter={props.roleFilter}
          setRoleFilter={props.setRoleFilter}
          governanceFilter={props.governanceFilter}
          setGovernanceFilter={props.setGovernanceFilter}
          applicantStatusFilter={props.applicantStatusFilter}
          setApplicantStatusFilter={props.setApplicantStatusFilter}
          cooldownStateFilter={props.cooldownStateFilter}
          setCooldownStateFilter={props.setCooldownStateFilter}
          countryFilter={props.countryFilter}
          setCountryFilter={props.setCountryFilter}
          searchInput={props.searchInput}
          setSearchInput={props.setSearchInput}
        />
      </Box>
    </Card>
  );
}
