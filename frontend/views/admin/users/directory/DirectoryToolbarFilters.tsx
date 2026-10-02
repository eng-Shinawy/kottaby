"use client";

/**
 * DirectoryToolbarFilters — the filter controls of the admin user directory
 * toolbar, extracted from `DirectoryToolbar` (file-size cap): the three
 * lifecycle filter selects (governance, applicant status, cooldown state)
 * and the country `CountrySelector`. Pure wrappers around the shared
 * `DirectoryFilterSelect` — each maps a free-string select value back onto
 * its closed wire union, so the toolbar's filter state can never drift out
 * of the enum vocabulary (the country selector is already code-typed).
 * Label slices are passed down narrowed — nothing is hardcoded.
 */

import { Box } from "@mui/material";
import type { ReactNode } from "react";
import { CountrySelector } from "@/frontend/components/ui/CountrySelector";
import { DirectoryFilterSelect } from "@/frontend/views/admin/users/directory";
import type {
  DirectoryApplicantStatus,
  DirectoryCooldownState,
  DirectoryGovernance,
} from "@/frontend/views/admin/users/utils";
import type { CountryCode } from "@/shared/constants/countries";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Toolbar filter label slice (governance/applicant/cooldown option copy). */
export type ToolbarFilterLabels = Pick<AdminUsersLabels, "filters" | "genderOptions" | "statusBadges">;

function asGovernanceFilterValue(value: string): DirectoryGovernance | "" {
  if (value === "Active" || value === "Suspended" || value === "Blocked" || value === "Deleted") {
    return value;
  }
  return "";
}

/** Governance (account state) filter — Active/Suspended/Blocked/Deleted. */
export function DirectoryGovernanceFilter(props: {
  readonly id: string;
  readonly labels: ToolbarFilterLabels;
  readonly governanceFilter: DirectoryGovernance | "";
  readonly setGovernanceFilter: (value: DirectoryGovernance | "") => void;
}): ReactNode {
  const { labels } = props;
  return (
    <DirectoryFilterSelect
      id={props.id}
      label={labels.filters.governance}
      value={props.governanceFilter}
      onChange={value => props.setGovernanceFilter(asGovernanceFilterValue(value))}
      emptyOptionLabel={labels.genderOptions.unspecified}
      options={[
        { value: "Active", label: labels.statusBadges.active },
        { value: "Suspended", label: labels.statusBadges.suspended },
        { value: "Blocked", label: labels.statusBadges.blocked },
        { value: "Deleted", label: labels.statusBadges.deleted },
      ]}
    />
  );
}

function asApplicantStatusFilterValue(value: string): DirectoryApplicantStatus | "" {
  if (value === "Pending" || value === "InEvaluation" || value === "Failed" || value === "Passed") {
    return value;
  }
  return "";
}

/**
 * The applicant-lifecycle status select — narrows the directory to rows
 * whose `applicants` child currently carries the chosen stored status.
 * Option labels mirror the detail snapshot's status vocabulary verbatim
 * (`filters.applicantStatusOptions`), so one concept reads identically
 * across surfaces.
 */
export function DirectoryApplicantStatusFilterSelect(props: {
  readonly id: string;
  readonly labels: ToolbarFilterLabels;
  readonly applicantStatusFilter: DirectoryApplicantStatus | "";
  readonly setApplicantStatusFilter: (value: DirectoryApplicantStatus | "") => void;
}): ReactNode {
  const { labels } = props;
  return (
    <DirectoryFilterSelect
      id={props.id}
      label={labels.filters.applicantStatus}
      value={props.applicantStatusFilter}
      onChange={value => props.setApplicantStatusFilter(asApplicantStatusFilterValue(value))}
      emptyOptionLabel={labels.genderOptions.unspecified}
      // The longest toolbar label — without the extra room the notch clips it.
      minWidth={192}
      options={[
        { value: "Pending", label: labels.filters.applicantStatusOptions.pending },
        { value: "InEvaluation", label: labels.filters.applicantStatusOptions.inEvaluation },
        { value: "Passed", label: labels.filters.applicantStatusOptions.passed },
        { value: "Failed", label: labels.filters.applicantStatusOptions.failed },
      ]}
    />
  );
}

function asCooldownStateFilterValue(value: string): DirectoryCooldownState | "" {
  if (value === "None" || value === "Active" || value === "Expired") {
    return value;
  }
  return "";
}

/**
 * The applicant cooldown-state select — the filter mirror of the
 * directory's derived cooldown chip. The three arms reuse the wire enum's
 * closed whitelist; `None` matches applicants with NO cooldown stamped
 * (non-applicant rows carry a null wire state and never match).
 */
export function DirectoryCooldownStateFilterSelect(props: {
  readonly id: string;
  readonly labels: ToolbarFilterLabels;
  readonly cooldownStateFilter: DirectoryCooldownState | "";
  readonly setCooldownStateFilter: (value: DirectoryCooldownState | "") => void;
}): ReactNode {
  const { labels } = props;
  return (
    <DirectoryFilterSelect
      id={props.id}
      label={labels.filters.cooldownState}
      value={props.cooldownStateFilter}
      onChange={value => props.setCooldownStateFilter(asCooldownStateFilterValue(value))}
      emptyOptionLabel={labels.genderOptions.unspecified}
      options={[
        { value: "Active", label: labels.filters.cooldownStateOptions.active },
        { value: "Expired", label: labels.filters.cooldownStateOptions.expired },
        { value: "None", label: labels.filters.cooldownStateOptions.none },
      ]}
    />
  );
}

/**
 * Country filter — the shared `CountrySelector` (ISO 3166-1 alpha-2), the
 * same picker the create dialog uses, so the directory narrow speaks the
 * code vocabulary the create path persists. The label stays pinned to the
 * notch (`shrinkLabel`) so the empty selector reads like the selects beside
 * it — one label grammar across the toolbar (pass-2 QA finding). Grow on
 * the md–lg wrapped line (and fill the xl leftover band): a stretched
 * filter field absorbs the free space ahead of the right-aligned actions —
 * no mid-row dead band (pass-2 HIGH).
 */
export function DirectoryCountryFilter(props: {
  readonly id: string;
  readonly labels: ToolbarFilterLabels;
  readonly countryFilter: CountryCode | "";
  readonly setCountryFilter: (value: CountryCode | "") => void;
}): ReactNode {
  return (
    <Box
      sx={{
        minWidth: 150,
        flex: { xs: "1 1 100%", sm: "1 1 220px" },
        // Hold the toolbar's uniform 54px control height (the selects above
        // pin the same height), so the wrapped rows keep a level baseline.
        "& .MuiOutlinedInput-root": { height: 54 },
      }}
    >
      <CountrySelector
        id={props.id}
        label={props.labels.filters.country}
        value={props.countryFilter}
        onChange={props.setCountryFilter}
        shrinkLabel
        // Filter-voiced prompt — the shared picker's "Select your country"
        // is a first-person form grammar, wrong for a directory control.
        placeholder={props.labels.filters.countryPlaceholder}
      />
    </Box>
  );
}
