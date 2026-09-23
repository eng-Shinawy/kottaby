"use client";

/**
 * AdminStudentsResults — the results section of the admin student
 * directory, mirroring the users directory's `DirectoryResults`.
 *
 * Composes:
 *  - `AdminStudentsTable` (desktop, ≥md) with the shared `DirectoryPagination`
 *    footer bar injected as the card's pagination slot,
 *  - `AdminStudentsMobileCardList` (mobile, <md),
 *  - `AdminStudentsMobilePaginationCard` — the mobile-only pagination card
 *    below the list.
 *
 * Pure presentation: all state and handlers come from
 * `useAdminStudentsDirectory`.
 */

import type { ReactNode } from "react";
import type { StudentDirectoryItem } from "@/frontend/views/admin/students/AdminStudentRowCells";
import { AdminStudentsMobileCardList } from "@/frontend/views/admin/students/AdminStudentsMobileCardList";
import { AdminStudentsMobilePaginationCard } from "@/frontend/views/admin/students/AdminStudentsMobilePaginationCard";
import { AdminStudentsTable } from "@/frontend/views/admin/students/AdminStudentsTable";
import type { useAdminStudentsDirectory } from "@/frontend/views/admin/students/hooks";
import { DirectoryPagination } from "@/frontend/views/admin/users/directory";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

type DirectoryState = ReturnType<typeof useAdminStudentsDirectory>;

interface AdminStudentsResultsProps {
  readonly labels: AdminStudentsLabels;
  readonly directory: DirectoryState;
  /** Invoked after any row's copy-email action resolves (drives the snackbar). */
  readonly onCopyEmail?: () => void;
  /** Opens the detail drawer for a row/card (the directory owns the drawer). */
  readonly onViewDetails?: (student: StudentDirectoryItem) => void;
  /** Lowercased emails of the admin's recent onboardings (the chip match). */
  readonly recentEmails?: ReadonlySet<string>;
  /** Highlight mode — rows/cards outside the recent set render in the quiet lane. */
  readonly highlightRecent?: boolean;
}

export function AdminStudentsResults({
  labels,
  directory,
  onCopyEmail,
  onViewDetails,
  recentEmails,
  highlightRecent,
}: AdminStudentsResultsProps): ReactNode {
  // When the query (or a refetch with no cached rows) failed, the error
  // alert in `AdminStudentsDirectoryContainer` is the sole surface — rendering
  // the skeleton/empty state and pagination beside it reads as a second,
  // contradictory failure message.
  if (directory.hasError && directory.items.length === 0) return null;
  return (
    <>
      <AdminStudentsTable
        labels={labels}
        items={directory.items}
        loading={directory.loading}
        hasFilters={directory.hasFilters}
        onCopyEmail={onCopyEmail}
        onViewDetails={onViewDetails}
        recentEmails={recentEmails}
        highlightRecent={highlightRecent}
        pagination={
          <DirectoryPagination
            labels={labels}
            page={directory.page}
            pageSize={directory.pageSize}
            totalCount={directory.total}
            onPageChange={directory.setPage}
            onPageSizeChange={directory.setPageSize}
          />
        }
      />

      <AdminStudentsMobileCardList
        labels={labels}
        items={directory.items}
        loading={directory.loading}
        hasFilters={directory.hasFilters}
        onCopyEmail={onCopyEmail}
        onViewDetails={onViewDetails}
        recentEmails={recentEmails}
        highlightRecent={highlightRecent}
      />

      <AdminStudentsMobilePaginationCard
        labels={labels}
        page={directory.page}
        pageSize={directory.pageSize}
        totalCount={directory.total}
        onPageChange={directory.setPage}
        onPageSizeChange={directory.setPageSize}
      />
    </>
  );
}
