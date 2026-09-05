"use client";

/**
 * FilterChipsRow — the mobile-only (< md) quick-filter chip strip rendered
 * above the directory results. Horizontally scrollable; chips map onto the
 * SAME role/governance filter state the toolbar drives (composing with it,
 * not replacing it — the full toolbar remains visible on desktop and the
 * state is shared):
 *
 *  - `chipsAll`   → clears both role and governance;
 *  - `roleLabels.student` → toggles role = Student;
 *  - `statusBadges.active`  → toggles governance = Active;
 *  - `statusBadges.deleted` → toggles governance = Deleted.
 *
 * Selected chips render filled `primary`/`onPrimary`; unselected chips are
 * outlined with the `outlineVariant` border. Every chip is a ≥44px touch
 * target.
 */

import { Box, Chip } from "@mui/material";
import type { ReactNode } from "react";
import type { DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface FilterChipsRowProps {
  readonly labels: Pick<AdminUsersLabels, "filters" | "roleLabels" | "statusBadges">;
  readonly roleFilter: DirectoryRole | "";
  readonly governanceFilter: DirectoryGovernance | "";
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
}

interface QuickChip {
  readonly key: string;
  readonly label: string;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

export function FilterChipsRow(props: FilterChipsRowProps): ReactNode {
  const { labels, roleFilter, governanceFilter, setRoleFilter, setGovernanceFilter } = props;
  const chips: readonly QuickChip[] = [
    {
      key: "chip-all",
      label: labels.filters.chipsAll,
      selected: roleFilter === "" && governanceFilter === "",
      onSelect: () => {
        setRoleFilter("");
        setGovernanceFilter("");
      },
    },
    {
      key: "chip-students",
      label: labels.roleLabels.student,
      selected: roleFilter === "Student",
      onSelect: () => setRoleFilter(roleFilter === "Student" ? "" : "Student"),
    },
    {
      key: "chip-active",
      label: labels.statusBadges.active,
      selected: governanceFilter === "Active",
      onSelect: () => setGovernanceFilter(governanceFilter === "Active" ? "" : "Active"),
    },
    {
      key: "chip-deleted",
      label: labels.statusBadges.deleted,
      selected: governanceFilter === "Deleted",
      onSelect: () => setGovernanceFilter(governanceFilter === "Deleted" ? "" : "Deleted"),
    },
  ];
  return (
    <Box
      sx={{
        display: { xs: "flex", md: "none" },
        gap: 1,
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
        py: 0.5,
      }}
    >
      {chips.map(chip => (
        <Chip
          key={chip.key}
          label={chip.label}
          clickable
          onClick={chip.onSelect}
          variant={chip.selected ? "filled" : "outlined"}
          aria-pressed={chip.selected}
          sx={theme =>
            chip.selected
              ? {
                  flexShrink: 0,
                  minHeight: 44,
                  fontWeight: 600,
                  bgcolor: theme.palette.primary.main,
                  color: theme.palette.onPrimary,
                  "&:hover": { bgcolor: theme.palette.primary.main },
                }
              : {
                  flexShrink: 0,
                  minHeight: 44,
                  borderColor: theme.palette.outlineVariant,
                  color: theme.palette.text.primary,
                }
          }
        />
      ))}
    </Box>
  );
}
