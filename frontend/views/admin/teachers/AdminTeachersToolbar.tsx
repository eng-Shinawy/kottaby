"use client";

/**
 * AdminTeachersToolbar — the teacher directory's filter + refresh surface.
 *
 * White card (radius 12, `border.light` outline, `shadow.card`), 24px
 * padding. Contents laid out as a wrapping flex row (wraps at ALL
 * breakpoints so narrow content widths stack instead of overflowing the
 * card — this directory has no mobile chip alternative):
 *  1. search field (magnifier leading adornment, ~400px max width),
 *  2. approval select (all / approved / pending),
 *  3. presence select (all / online / offline),
 *  4. evaluator select (all / evaluator / non-evaluator),
 *  5. flex spacer, then a "clear filters" text button (rendered only while
 *     at least one filter is set) and a refresh text button re-fetching the
 *     current page.
 *
 * The card chrome is the SHARED `DirectoryToolbarCard`; the select chrome is
 * the SHARED `DirectoryFilterSelect` imported from the users directory
 * (identical 44px outlined control); the reported string is narrowed back to
 * the local filter unions by the validated lookup helpers in
 * `adminTeachersDirectory.helpers`. The action buttons and the search field
 * are the SHARED `AdminTeachersToolbarControls` (label-mapping adapters over
 * the directory-shared toolbar primitives, identical recipe in the
 * applicants toolbar). Label slices are passed down narrowed — nothing is
 * hardcoded. All colors resolve through theme-callback sx.
 */

import { Box, Button } from "@mui/material";
import type { ReactNode } from "react";
import { DirectoryToolbarCard } from "@/frontend/views/admin/directory-shared/DirectoryToolbarCard";
import {
  ToolbarCopyLinkButton,
  ToolbarExportCsvButton,
  ToolbarRefreshButton,
  ToolbarSearchField,
} from "@/frontend/views/admin/teachers/AdminTeachersToolbarControls";
import {
  asApprovalFilter,
  asEvaluatorFilter,
  asOnlineFilter,
} from "@/frontend/views/admin/teachers/adminTeachersDirectory.helpers";
import type { useAdminTeachersDirectory } from "@/frontend/views/admin/teachers/hooks";
import { DirectoryFilterSelect } from "@/frontend/views/admin/users/directory";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

type ToolbarLabels = Pick<AdminTeachersLabels, "filters" | "filterOptions" | "statusPills" | "export" | "quickActions">;

/** Directory state slice consumed by the toolbar (from `useAdminTeachersDirectory`). */
type ToolbarDirectory = Pick<
  ReturnType<typeof useAdminTeachersDirectory>,
  | "approvalFilter"
  | "setApprovalFilter"
  | "onlineFilter"
  | "setOnlineFilter"
  | "evaluatorFilter"
  | "setEvaluatorFilter"
  | "searchInput"
  | "setSearchInput"
  | "refetch"
>;

interface AdminTeachersToolbarProps {
  readonly labels: ToolbarLabels;
  readonly directory: ToolbarDirectory;
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

export function AdminTeachersToolbar({
  labels,
  directory,
  loading,
  hasFilters,
  onExportCsv,
  exportLoading,
  exportDisabled,
  onCopyLink,
}: AdminTeachersToolbarProps): ReactNode {
  // Stable element ids — wire `InputLabel htmlFor` ↔ control `id` so screen
  // readers announce the label when focus lands on the control (axe-core
  // `aria-input-field-name` rule). Prefixed with the component name to avoid
  // collisions with other admin surfaces.
  const APPROVAL_ID = "admin-teachers-toolbar-approval";
  const ONLINE_ID = "admin-teachers-toolbar-online";
  const EVALUATOR_ID = "admin-teachers-toolbar-evaluator";
  const SEARCH_ID = "admin-teachers-toolbar-search";
  return (
    <DirectoryToolbarCard>
      <ToolbarSearchField
        id={SEARCH_ID}
        labels={labels}
        value={directory.searchInput}
        onChange={directory.setSearchInput}
      />
      <DirectoryFilterSelect
        id={APPROVAL_ID}
        label={labels.filters.approval}
        value={directory.approvalFilter}
        onChange={value => directory.setApprovalFilter(asApprovalFilter(value))}
        emptyOptionLabel={labels.filterOptions.all}
        options={[
          { value: "Approved", label: labels.statusPills.approved },
          { value: "Pending", label: labels.statusPills.pending },
        ]}
      />
      <DirectoryFilterSelect
        id={ONLINE_ID}
        label={labels.filters.online}
        value={directory.onlineFilter}
        onChange={value => directory.setOnlineFilter(asOnlineFilter(value))}
        emptyOptionLabel={labels.filterOptions.all}
        options={[
          { value: "Online", label: labels.statusPills.online },
          { value: "Offline", label: labels.statusPills.offline },
        ]}
      />
      <DirectoryFilterSelect
        id={EVALUATOR_ID}
        label={labels.filters.evaluator}
        value={directory.evaluatorFilter}
        onChange={value => directory.setEvaluatorFilter(asEvaluatorFilter(value))}
        emptyOptionLabel={labels.filterOptions.all}
        options={[
          { value: "Evaluator", label: labels.statusPills.evaluator },
          { value: "NonEvaluator", label: labels.filterOptions.nonEvaluator },
        ]}
      />
      <Box sx={{ flex: 1 }} />
      {hasFilters && (
        <Button
          variant="text"
          onClick={() => {
            directory.setApprovalFilter("");
            directory.setOnlineFilter("");
            directory.setEvaluatorFilter("");
            directory.setSearchInput("");
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
          void directory.refetch();
        }}
      />
    </DirectoryToolbarCard>
  );
}
