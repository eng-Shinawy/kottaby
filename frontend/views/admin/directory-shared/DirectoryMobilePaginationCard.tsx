"use client";

/**
 * DirectoryMobilePaginationCard — the shared mobile (<md) pagination bar
 * of the admin directory surfaces. The mobile pagination sits in its own
 * card (same 12px radius / `border.light` outline as the item cards) so it
 * doesn't float bare on the page background; the desktop pagination lives
 * inside the table card via the table's `pagination` slot.
 *
 * The pagination control itself is the SHARED `DirectoryPagination` from
 * the users directory (structurally compatible `pagination` label block).
 */

import { Box, Card } from "@mui/material";
import type { ReactNode } from "react";
import { directoryPanelCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";
import { DirectoryPagination } from "@/frontend/views/admin/users/directory";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryMobilePaginationCardProps {
  /** The `pagination` label block of the surface's locale namespace. */
  readonly labels: Pick<AdminUsersLabels, "pagination">;
  /** Zero-based current page. */
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
}

export function DirectoryMobilePaginationCard(props: DirectoryMobilePaginationCardProps): ReactNode {
  const { labels, page, pageSize, totalCount, onPageChange, onPageSizeChange } = props;
  return (
    <Box sx={{ display: { xs: "block", md: "none" } }}>
      <Card sx={directoryPanelCardSx()}>
        <DirectoryPagination
          labels={labels}
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          borderedTop={false}
        />
      </Card>
    </Box>
  );
}
