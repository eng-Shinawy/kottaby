"use client";

/**
 * ActiveFiltersRow — the applied-filters chip strip rendered directly above
 * the directory results (ALL viewports — it complements, never replaces:
 * the mobile quick-filter `FilterChipsRow` toggles role/governance, the
 * desktop toolbar owns the inputs, and THIS row shows what is actually
 * applied with one-click per-filter removal for the predicates the quick
 * chips don't cover — the applied search substring and the country).
 *
 * One deletable chip per applied filter, labeled `filter: value` in the
 * active locale (a single logical string — RTL-safe by construction, no
 * directional markup needed). Chips paint from the neutral tokens:
 * outlined with `outlineVariant`, `text.primary` ink, and a delete icon
 * that steps from `text.secondary` to `error` on hover — the destructive
 * affordance is discoverable but never shouts. The row disappears
 * entirely once nothing is applied (an empty strip never renders).
 *
 * Removal routes through the SAME page-resetting setters the toolbar uses
 * (a new result set starts at page 1 — the directory hook's invariant),
 * and the mirror effect rewrites the URL, so a chip deletion stays
 * shareable exactly like a toolbar edit.
 */

import { Chip, Stack } from "@mui/material";
import type { ReactNode } from "react";
import type {
  DirectoryApplicantStatus,
  DirectoryCooldownState,
  DirectoryGovernance,
  DirectoryRole,
} from "@/frontend/views/admin/users/utils";
import { COUNTRIES, type CountryCode } from "@/shared/constants/countries";
import type { AppLocale } from "@/shared/locale/AppLocale";
import { useAppLocale } from "@/shared/locale/localeContext";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface ActiveFilterChip {
  /** Stable React key. */
  readonly key: string;
  /** Rendered chip text — `filterLabel: value` in the active locale. */
  readonly label: string;
  /** The accessible name for the chip's remove action target. */
  readonly onDelete: () => void;
}

interface ActiveFiltersRowProps {
  readonly labels: Pick<AdminUsersLabels, "filters" | "roleLabels" | "statusBadges">;
  readonly roleFilter: DirectoryRole | "";
  readonly governanceFilter: DirectoryGovernance | "";
  readonly applicantStatusFilter: DirectoryApplicantStatus | "";
  readonly cooldownStateFilter: DirectoryCooldownState | "";
  readonly countryFilter: CountryCode | "";
  /** The APPLIED (debounced) search — mirrors what the URL and results show. */
  readonly searchApplied: string;
  readonly setRoleFilter: (value: DirectoryRole | "") => void;
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
  readonly setApplicantStatusFilter: (value: DirectoryApplicantStatus | "") => void;
  readonly setCooldownStateFilter: (value: DirectoryCooldownState | "") => void;
  readonly cooldownExpiringSoon: boolean;
  readonly setCooldownExpiringSoon: (value: boolean) => void;
  readonly setCountryFilter: (value: CountryCode | "") => void;
  readonly setSearchInput: (value: string) => void;
}

/**
 * One chip per applied filter, in stable display order (search, role,
 * governance, applicant status, cooldown state, expiring-soon flag,
 * country), labeled `filterLabel: value` in the active locale. Each
 * `onDelete` closes over the row's setter props, so removal routes through
 * the same page-resetting setters the toolbar uses.
 *
 * The country chip renders the selected dataset entry (flag + localized
 * name) instead of the bare ISO code the filter carries — the chip is a
 * display surface, so it speaks the same vocabulary the option rows do.
 */
function buildActiveFilterChips(props: ActiveFiltersRowProps, locale: AppLocale): ActiveFilterChip[] {
  const { labels } = props;
  const roleValueLabels: Record<DirectoryRole, string> = {
    Admin: labels.roleLabels.admin,
    Teacher: labels.roleLabels.teacher,
    Student: labels.roleLabels.student,
    Parent: labels.roleLabels.parent,
  };
  const governanceValueLabels: Record<DirectoryGovernance, string> = {
    Active: labels.statusBadges.active,
    Suspended: labels.statusBadges.suspended,
    Blocked: labels.statusBadges.blocked,
    Deleted: labels.statusBadges.deleted,
  };
  const applicantStatusValueLabels: Record<DirectoryApplicantStatus, string> = {
    Pending: labels.filters.applicantStatusOptions.pending,
    InEvaluation: labels.filters.applicantStatusOptions.inEvaluation,
    Failed: labels.filters.applicantStatusOptions.failed,
    Passed: labels.filters.applicantStatusOptions.passed,
  };
  const cooldownStateValueLabels: Record<DirectoryCooldownState, string> = {
    None: labels.filters.cooldownStateOptions.none,
    Active: labels.filters.cooldownStateOptions.active,
    Expired: labels.filters.cooldownStateOptions.expired,
  };

  const chips: ActiveFilterChip[] = [];
  if (props.searchApplied !== "") {
    chips.push({
      key: "active-search",
      label: `${labels.filters.search}: ${props.searchApplied}`,
      onDelete: () => props.setSearchInput(""),
    });
  }
  if (props.roleFilter !== "") {
    chips.push({
      key: "active-role",
      label: `${labels.filters.role}: ${roleValueLabels[props.roleFilter]}`,
      onDelete: () => props.setRoleFilter(""),
    });
  }
  if (props.governanceFilter !== "") {
    chips.push({
      key: "active-governance",
      label: `${labels.filters.governance}: ${governanceValueLabels[props.governanceFilter]}`,
      onDelete: () => props.setGovernanceFilter(""),
    });
  }
  if (props.applicantStatusFilter !== "") {
    chips.push({
      key: "active-applicant-status",
      label: `${labels.filters.applicantStatus}: ${applicantStatusValueLabels[props.applicantStatusFilter]}`,
      onDelete: () => props.setApplicantStatusFilter(""),
    });
  }
  if (props.cooldownStateFilter !== "") {
    chips.push({
      key: "active-cooldown-state",
      label: `${labels.filters.cooldownState}: ${cooldownStateValueLabels[props.cooldownStateFilter]}`,
      onDelete: () => props.setCooldownStateFilter(""),
    });
  }
  if (props.cooldownExpiringSoon) {
    chips.push({
      key: "active-cooldown-expiring-soon",
      label: labels.filters.cooldownExpiringSoon,
      onDelete: () => props.setCooldownExpiringSoon(false),
    });
  }
  if (props.countryFilter !== "") {
    const country = COUNTRIES[props.countryFilter];
    chips.push({
      key: "active-country",
      label: `${labels.filters.country}: ${country.flag} ${country[locale]}`,
      onDelete: () => props.setCountryFilter(""),
    });
  }

  return chips;
}

export function ActiveFiltersRow(props: ActiveFiltersRowProps): ReactNode {
  const locale = useAppLocale();
  const chips = buildActiveFilterChips(props, locale);

  if (chips.length === 0) {
    return null;
  }

  return (
    <Stack direction="row" useFlexGap spacing={1} sx={{ flexWrap: "wrap", alignItems: "center", rowGap: 1 }}>
      {chips.map(chip => (
        <Chip
          key={chip.key}
          label={chip.label}
          size="small"
          onDelete={chip.onDelete}
          variant="outlined"
          sx={theme => ({
            borderColor: theme.palette.outlineVariant,
            color: theme.palette.text.primary,
            bgcolor: "transparent",
            transition: theme.transitions.create(["background-color", "border-color"], {
              duration: theme.transitions.duration.short,
            }),
            "& .MuiChip-deleteIcon": {
              color: theme.palette.text.secondary,
              "&:hover": { color: theme.palette.error.main },
            },
          })}
        />
      ))}
    </Stack>
  );
}
