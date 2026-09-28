"use client";

/**
 * FilterChipsRow — the mobile-only (< md) quick-filter chip strip rendered
 * above the directory results, on the shared `DirectoryQuickFilterChips`
 * strip (the applicant queue renders the same strip at ALL breakpoints).
 * Chips map onto the SAME role/governance/cooldown filter state the toolbar
 * drives (composing with it, not replacing it — the full toolbar remains
 * visible on desktop and the state is shared):
 *
 *  - `chipsAll`   → clears role, governance, and the cooldown quick filter;
 *  - `roleLabels.student` → toggles role = Student;
 *  - `statusBadges.active`  → toggles governance = Active;
 *  - `filters.cooldownStateOptions.active` → toggles the applicant
 *    cooldown-state filter to Active (the mobile mirror of the desktop
 *    cooldown select — "who is currently restricted");
 *  - `statusBadges.deleted` → toggles governance = Deleted.
 */

import type { ReactNode } from "react";
import {
  type DirectoryQuickChip,
  DirectoryQuickFilterChips,
} from "@/frontend/views/admin/directory-shared/DirectoryQuickFilterChips";
import type { DirectoryCooldownState, DirectoryGovernance, DirectoryRole } from "@/frontend/views/admin/users/utils";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface FilterChipsRowProps {
  readonly labels: Pick<AdminUsersLabels, "filters" | "roleLabels" | "statusBadges">;
  readonly roleFilter: DirectoryRole | "";
  readonly governanceFilter: DirectoryGovernance | "";
  readonly cooldownStateFilter: DirectoryCooldownState | "";
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
  readonly setCooldownStateFilter: (value: DirectoryCooldownState | "") => void;
}

export function FilterChipsRow(props: FilterChipsRowProps): ReactNode {
  const {
    labels,
    roleFilter,
    governanceFilter,
    cooldownStateFilter,
    setRoleFilter,
    setGovernanceFilter,
    setCooldownStateFilter,
  } = props;
  const chips: readonly DirectoryQuickChip[] = [
    {
      key: "chip-all",
      label: labels.filters.chipsAll,
      selected: roleFilter === "" && governanceFilter === "" && cooldownStateFilter === "",
      onSelect: () => {
        setRoleFilter("");
        setGovernanceFilter("");
        setCooldownStateFilter("");
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
      key: "chip-cooling",
      label: labels.filters.cooldownStateOptions.active,
      selected: cooldownStateFilter === "Active",
      onSelect: () => setCooldownStateFilter(cooldownStateFilter === "Active" ? "" : "Active"),
    },
    {
      key: "chip-deleted",
      label: labels.statusBadges.deleted,
      selected: governanceFilter === "Deleted",
      onSelect: () => setGovernanceFilter(governanceFilter === "Deleted" ? "" : "Deleted"),
    },
  ];
  return <DirectoryQuickFilterChips chips={chips} display="mobileOnly" />;
}
