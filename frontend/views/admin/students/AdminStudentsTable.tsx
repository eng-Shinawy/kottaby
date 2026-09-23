"use client";

/**
 * AdminStudentsTable — the desktop (≥`md`) admin student directory table,
 * rendered on the shared `DirectoryTableScaffold` (card chrome, header row
 * from the columns config below, skeleton/empty orchestration, pagination
 * slot).
 *
 * Columns (start → end; they mirror visually under RTL automatically):
 * NAME (avatar + name + ellipsized email + copy-email quick action),
 * BALANCES (four compact lane-tinted badges), PARENT (parent identity or
 * the independent chip), LANGUAGES (primary + another chips), TRIAL
 * (granted badge + timestamp, or em-dash), JOINED (localized timestamp).
 * Each body row is rendered by `AdminStudentRow` (≥72px tall, `border.light`
 * hairlines, odd rows carry a faint `action.hover` zebra tint and pointer
 * hover upgrades the row to `action.selected`).
 *
 * Loading renders stable-key skeleton rows (the rowgroup announces the
 * localized loading label); the empty state reuses the
 * `labels.emptyState` copy via `AdminStudentsEmptyState`. The pagination
 * footer is injected as a `pagination` slot rendered inside the same card
 * (top hairline from `DirectoryPagination`).
 */

import type { ReactNode } from "react";
import {
  type DirectoryTableHeader,
  DirectoryTableScaffold,
} from "@/frontend/views/admin/directory-shared/DirectoryTableScaffold";
import { AdminStudentRow } from "@/frontend/views/admin/students/AdminStudentRow";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { AdminStudentsEmptyState } from "@/frontend/views/admin/students/AdminStudentsEmptyState";
import { ADMIN_STUDENTS_SKELETON_KEYS } from "@/frontend/views/admin/students/adminStudentsDirectory.helpers";
import { useAppLocale } from "@/shared/locale";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

interface AdminStudentsTableProps {
  readonly labels: AdminStudentsLabels;
  readonly items: readonly StudentDirectoryItem[];
  readonly loading: boolean;
  readonly hasFilters: boolean;
  /** Invoked after any row's copy-email action resolves (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer for a row (the directory owns the drawer). */
  readonly onViewDetails?: (student: StudentDirectoryItem) => void;
  /** Lowercased emails of the admin's recent onboardings (the chip match). */
  readonly recentEmails?: ReadonlySet<string>;
  /** Highlight mode — rows outside the recent set render in the quiet lane. */
  readonly highlightRecent?: boolean;
  /** Footer slot rendered inside the card (the shared `DirectoryPagination` bar). */
  readonly pagination?: ReactNode;
}

export function AdminStudentsTable(props: AdminStudentsTableProps): ReactNode {
  const { labels, items, loading, hasFilters, onCopyEmail, onViewDetails, recentEmails, highlightRecent } = props;
  const locale = useAppLocale();
  /*
   * Column widths (R5 rebalance): BALANCES 21% restores the 2×2
   * balance-chip grid in AR once the chips stopped flex-shrinking
   * (see `TonalChip`); TRIAL stays 14% because the EN "Trial granted"
   * chip needs ~128px (96px pill + cell padding) — 13% would re-clip
   * it; the donor is JOINED (11%), whose timestamp already wraps to
   * two lines at 12%.
   */
  const headers: readonly DirectoryTableHeader[] = [
    { id: "name", width: "29.5%", label: labels.headers.name },
    { id: "balances", width: "21%", label: labels.headers.balances },
    { id: "parent", width: "14%", label: labels.headers.parent },
    { id: "languages", width: "10.5%", label: labels.headers.languages },
    { id: "trial", width: "14%", label: labels.headers.trial },
    { id: "joined", width: "11%", label: labels.headers.joined },
  ];
  return (
    <DirectoryTableScaffold
      headers={headers}
      loading={loading}
      loadingLabel={labels.loading}
      skeletonKeys={ADMIN_STUDENTS_SKELETON_KEYS}
      empty={<AdminStudentsEmptyState labels={labels} hasFilters={hasFilters} />}
      rows={items.map((student, index) => (
        <AdminStudentRow
          key={student.id}
          student={student}
          labels={labels}
          locale={locale}
          striped={index % 2 === 1}
          onCopyEmail={onCopyEmail}
          onViewDetails={onViewDetails}
          recentEmails={recentEmails}
          highlight={highlightRecent === true}
        />
      ))}
      pagination={props.pagination}
    />
  );
}
