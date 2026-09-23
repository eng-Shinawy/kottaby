"use client";

/**
 * AdminTeachersToolbarControls — the toolbar control adapters shared by the
 * two /teachers toolbars (the certified-teacher directory's
 * `AdminTeachersToolbar` and the applicant queue's `AdminApplicantsToolbar`):
 * thin label-mapping wrappers over the directory-shared toolbar primitives
 * (`DirectoryToolbarSearchField`, `DirectoryCopyLinkButton`,
 * `DirectoryExportCsvButton`, `DirectoryToolbarRefreshButton`), preserving
 * the `labels`-slice prop contract both toolbars already speak. All follow
 * the same recipe — text buttons, 44px touch floor, `text.secondary` ink,
 * `flexShrink: 0` so the wrapping control row never squeezes them.
 */

import type { ReactNode } from "react";
import { DirectoryCopyLinkButton } from "@/frontend/views/admin/directory-shared/DirectoryCopyLinkButton";
import { DirectoryExportCsvButton } from "@/frontend/views/admin/directory-shared/DirectoryExportCsvButton";
import { DirectoryToolbarRefreshButton } from "@/frontend/views/admin/directory-shared/DirectoryToolbarRefreshButton";
import { DirectoryToolbarSearchField } from "@/frontend/views/admin/directory-shared/DirectoryToolbarSearchField";
import type { AdminTeachersLabels } from "@/shared/locale/types/adminTeachers";

interface ToolbarSearchFieldProps {
  readonly id: string;
  readonly labels: Pick<AdminTeachersLabels, "filters">;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

/** The toolbar's search input: magnifier leading adornment, fixed 44px height. */
export function ToolbarSearchField({ id, labels, value, onChange }: ToolbarSearchFieldProps): ReactNode {
  return (
    <DirectoryToolbarSearchField
      id={id}
      placeholder={labels.filters.searchPlaceholder}
      ariaLabel={labels.filters.search}
      clearLabel={labels.filters.searchClearLabel}
      value={value}
      onChange={onChange}
    />
  );
}

interface ToolbarRefreshButtonProps {
  readonly labels: Pick<AdminTeachersLabels, "filters">;
  /** `true` while the query is in flight (the button shows a disabled state). */
  readonly loading: boolean;
  /** Re-fetches the current page (the promise is handed to Apollo). */
  readonly onClick: () => void;
}

/** The refresh action — re-fetches the current page (same recipe as its siblings). */
export function ToolbarRefreshButton({ labels, loading, onClick }: ToolbarRefreshButtonProps): ReactNode {
  return <DirectoryToolbarRefreshButton refreshLabel={labels.filters.refresh} loading={loading} onClick={onClick} />;
}

interface ToolbarCopyLinkButtonProps {
  readonly labels: Pick<AdminTeachersLabels, "quickActions">;
  /** Invoked after the view URL copies successfully (drives the snackbar). */
  readonly onCopyLink?: () => void;
}

/**
 * The shareable-view action — copies the CURRENT URL (the surface's
 * URL-mirror effect keeps the query string in sync with the applied
 * filters, so what the admin pastes is exactly what they see). The icon
 * tints to the success color while the copy has resolved, and failures
 * stay silent (the snackbar never lies about a copy that did not happen).
 */
export function ToolbarCopyLinkButton({ labels, onCopyLink }: ToolbarCopyLinkButtonProps): ReactNode {
  return <DirectoryCopyLinkButton copyLinkLabel={labels.quickActions.copyLink} onCopyLink={onCopyLink} />;
}

interface ToolbarExportCsvButtonProps {
  readonly labels: Pick<AdminTeachersLabels, "export">;
  readonly onExportCsv: () => void;
  /** `true` while the export query is in flight (the button shows a busy state). */
  readonly exportLoading: boolean;
  /** `true` while loading or the filtered total is zero — nothing to export. */
  readonly exportDisabled: boolean;
}

/**
 * The export action — same text-button recipe as the refresh action next to
 * it. While the export-all query is in flight the button shows MUI's
 * leading spinner busy state; the tooltip switches to the honest "nothing
 * to export" copy while disabled.
 */
export function ToolbarExportCsvButton({
  labels,
  onExportCsv,
  exportLoading,
  exportDisabled,
}: ToolbarExportCsvButtonProps): ReactNode {
  return (
    <DirectoryExportCsvButton
      exportLabel={labels.export.exportCsv}
      exportCsvEmptyLabel={labels.export.exportCsvEmpty}
      onExportCsv={onExportCsv}
      exportLoading={exportLoading}
      exportDisabled={exportDisabled}
    />
  );
}
