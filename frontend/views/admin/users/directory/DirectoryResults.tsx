"use client";

/**
 * DirectoryResults — the results section of the admin user directory,
 * extracted from `AdminUsersDirectoryContainer`.
 *
 * Composes:
 *  - `DirectoryTable` (desktop, ≥md) with the `DirectoryPagination` footer
 *    bar injected as the card's pagination slot,
 *  - `MobileUserCardList` (mobile, <md),
 *  - `MobilePaginationCard` — the mobile-only pagination card below the list.
 *
 * Pure presentation: all state and handlers come from
 * `useAdminUsersDirectory`.
 */

import type { ReactNode } from "react";
import {
  DirectoryPagination,
  DirectoryTable,
  MobilePaginationCard,
  MobileUserCardList,
} from "@/frontend/views/admin/users/directory";
import type { useAdminUsersDirectory } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

type DirectoryState = ReturnType<typeof useAdminUsersDirectory>;

interface DirectoryResultsProps {
  readonly labels: AdminUsersLabels;
  readonly directory: DirectoryState;
}

export function DirectoryResults({ labels, directory }: DirectoryResultsProps): ReactNode {
  // When the query (or a refetch with no cached rows) failed, the error
  // alert in `AdminUsersDirectoryContainer` is the sole surface — rendering
  // the skeleton/empty state and pagination beside it reads as a second,
  // contradictory failure message.
  if (directory.hasError && directory.items.length === 0) return null;
  return (
    <>
      <DirectoryTable
        labels={labels}
        items={directory.items}
        loading={directory.loading}
        hasFilters={directory.hasFilters}
        onEdit={directory.setEditTarget}
        onDelete={directory.setDeleteTarget}
        pagination={
          <DirectoryPagination
            labels={labels}
            page={directory.page}
            pageSize={directory.pageSize}
            totalCount={directory.totalCount}
            onPageChange={directory.setPage}
            onPageSizeChange={directory.setPageSize}
          />
        }
      />

      <MobileUserCardList
        labels={labels}
        items={directory.items}
        loading={directory.loading}
        hasFilters={directory.hasFilters}
        onEdit={directory.setEditTarget}
        onDelete={directory.setDeleteTarget}
      />

      <MobilePaginationCard
        labels={labels}
        page={directory.page}
        pageSize={directory.pageSize}
        totalCount={directory.totalCount}
        onPageChange={directory.setPage}
        onPageSizeChange={directory.setPageSize}
      />
    </>
  );
}
