"use client";

/**
 * AdminApplicantsToolbar — the applicant queue's filter + refresh + export
 * surface.
 *
 * White card (radius 12, `border.light` outline, `shadow.card`), 24px
 * padding. Contents laid out as a COLUMN of two rows:
 *  1. the controls row — a wrapping flex row (wraps at ALL breakpoints so
 *     narrow content widths stack instead of overflowing the card):
 *     a. search field (magnifier leading adornment, ~400px max width),
 *     b. status select (all / pending / in-evaluation / failed / passed),
 *     c. flex spacer, then a "clear filters" text button (rendered only
 *        while at least one filter is set), the EXPORT CSV text button
 *        (server-side export-all — the same recipe as the directory tab's
 *        export, sharing its labels), and a refresh text button
 *        re-fetching the current page,
 *  2. the `ApplicantStatusQuickFilters` chip strip — five count-bearing
 *     quick-filter chips composing with the SAME status-filter state the
 *     select drives.
 *
 * The select chrome is the SHARED `DirectoryFilterSelect` imported from the
 * users directory (identical 44px outlined control); the reported string is
 * narrowed back to the status filter union by the validated lookup helper
 * in `adminApplicants.helpers`. The action buttons and the search field are
 * the SHARED `AdminTeachersToolbarControls` (identical recipe in the
 * directory toolbar). Label slices are passed down narrowed — nothing is
 * hardcoded. All colors resolve through theme-callback sx.
 */

import { Box, Button, Card } from "@mui/material";
import type { ReactNode } from "react";
import {
  ToolbarCopyLinkButton,
  ToolbarExportCsvButton,
  ToolbarRefreshButton,
  ToolbarSearchField,
} from "@/frontend/views/admin/teachers/AdminTeachersToolbarControls";
import { ApplicantStatusQuickFilters } from "@/frontend/views/admin/teachers/ApplicantStatusQuickFilters";
import {
  ADMIN_APPLICANT_STATUSES,
  applicantStatusLabel,
  asApplicantStatusFilter,
} from "@/frontend/views/admin/teachers/adminApplicants.helpers";
import type { useAdminTeacherApplicants } from "@/frontend/views/admin/teachers/hooks";
import { DirectoryFilterSelect } from "@/frontend/views/admin/users/directory";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

type ToolbarLabels = Pick<
  AdminTeachersLabels,
  "filters" | "filterOptions" | "headers" | "applicantStatus" | "export" | "quickActions"
>;

/** Queue state slice consumed by the toolbar (from `useAdminTeacherApplicants`). */
type ToolbarApplicants = Pick<
  ReturnType<typeof useAdminTeacherApplicants>,
  "statusFilter" | "setStatusFilter" | "searchInput" | "setSearchInput" | "refetch" | "statusCounts"
>;

interface AdminApplicantsToolbarProps {
  readonly labels: ToolbarLabels;
  readonly applicants: ToolbarApplicants;
  /** `true` while the query is in flight (the refresh button shows a busy state). */
  readonly loading: boolean;
  /** `true` when at least one filter is set (renders the clear action). */
  readonly hasFilters: boolean;
  /** Runs the server-side export-all query and downloads the CSV file. */
  readonly onExportCsv: () => void;
  /** `true` while the export query is in flight (the export button shows a busy state). */
  readonly exportLoading: boolean;
  /** `true` while loading or the filtered total is zero — nothing to export. */
  readonly exportDisabled: boolean;
  /** Invoked after the view URL copies successfully (drives the snackbar). */
  readonly onCopyLink?: () => void;
}

export function AdminApplicantsToolbar({
  labels,
  applicants,
  loading,
  hasFilters,
  onExportCsv,
  exportLoading,
  exportDisabled,
  onCopyLink,
}: AdminApplicantsToolbarProps): ReactNode {
  // Stable element ids — wire `InputLabel htmlFor` ↔ control `id` so screen
  // readers announce the label when focus lands on the control (axe-core
  // `aria-input-field-name` rule). Prefixed with the component name to avoid
  // collisions with other admin surfaces.
  const STATUS_ID = "admin-applicants-toolbar-status";
  const SEARCH_ID = "admin-applicants-toolbar-search";
  return (
    <Card
      sx={theme => ({
        borderRadius: "12px",
        border: `1px solid ${theme.palette.border.light}`,
        boxShadow: theme.palette.shadow.card,
        p: 3,
        display: "flex",
      })}
    >
      <Box sx={{ display: "flex", flexDirection: "column", width: "100%", gap: 2 }}>
        <Box sx={{ display: "flex", width: "100%", flexWrap: "wrap", gap: 2, alignItems: "center" }}>
          <ToolbarSearchField
            id={SEARCH_ID}
            labels={labels}
            value={applicants.searchInput}
            onChange={applicants.setSearchInput}
          />
          <DirectoryFilterSelect
            id={STATUS_ID}
            label={labels.headers.status}
            value={applicants.statusFilter}
            onChange={value => applicants.setStatusFilter(asApplicantStatusFilter(value))}
            emptyOptionLabel={labels.filterOptions.all}
            options={ADMIN_APPLICANT_STATUSES.map(status => ({
              value: status,
              label: applicantStatusLabel(status, labels.applicantStatus),
            }))}
          />
          <Box sx={{ flex: 1 }} />
          {hasFilters && (
            <Button
              variant="text"
              onClick={() => {
                applicants.setStatusFilter("");
                applicants.setSearchInput("");
              }}
              sx={theme => ({ minHeight: 54, flexShrink: 0, color: theme.palette.text.secondary })}
            >
              {labels.filters.clear}
            </Button>
          )}
          <ToolbarCopyLinkButton labels={labels} onCopyLink={onCopyLink} />
          <ToolbarExportCsvButton
            labels={labels}
            onExportCsv={onExportCsv}
            exportLoading={exportLoading}
            exportDisabled={exportDisabled}
          />
          <ToolbarRefreshButton
            labels={labels}
            loading={loading}
            onClick={() => {
              void applicants.refetch();
            }}
          />
        </Box>
        <ApplicantStatusQuickFilters
          labels={labels}
          statusFilter={applicants.statusFilter}
          setStatusFilter={applicants.setStatusFilter}
          statusCounts={applicants.statusCounts}
        />
      </Box>
    </Card>
  );
}
