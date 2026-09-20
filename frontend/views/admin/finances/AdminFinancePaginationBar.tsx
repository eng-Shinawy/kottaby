"use client";

/**
 * AdminFinancePaginationBar — the shared prev/next pagination control of
 * the admin finances panels: one component consumed by the payments audit
 * table, the withdrawal payout queue, and the wallet transaction ledger so
 * the admin can page past the first window.
 *
 * Props carry the current page (0-based, the hooks' own state), the
 * page-window size, the total row count, and the page setter — the caption
 * and both controls reflect the live query data. The caption and the
 * controls come from the `AdminFinance` namespace; the controls disable at
 * the bounds (the first / the last page).
 *
 * MUI v9 `sx`-only discipline, theme-palette colors.
 */

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

interface AdminFinancePaginationBarProps {
  /** The current 0-based page index (the hook's own `page` state). */
  readonly page: number;
  /** The page-window size (the hook's own `pageSize`). */
  readonly pageSize: number;
  /** The total row count from the query data. */
  readonly totalCount: number;
  /** The 0-based page setter (the hook's own `setPage`). */
  readonly onPageChange: (page: number) => void;
}

/** The shared prev/next pagination bar of the admin finances panels. */
export function AdminFinancePaginationBar({
  page,
  pageSize,
  totalCount,
  onPageChange,
}: Readonly<AdminFinancePaginationBarProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  // An empty dataset has nothing to page — the bar (caption + dead disabled
  // controls) reads as UI noise over an empty state, so it renders nothing.
  // The count caption (a separate element) still explains the emptiness.
  if (totalCount === 0) {
    return null;
  }
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(page + 1, totalPages);

  return (
    <Stack
      direction="row"
      sx={{
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 2,
        flexWrap: "wrap",
      }}
      data-testid="admin-finances-pagination"
    >
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {t.pageCountLabel(currentPage, totalPages)}
      </Typography>
      <Stack direction="row" spacing={1}>
        <Box
          component="button"
          type="button"
          disabled={currentPage <= 1}
          onClick={() => {
            onPageChange(currentPage - 2);
          }}
          data-testid="admin-finances-pagination-prev"
          sx={theme => ({
            minHeight: 44,
            px: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: theme.palette.outline,
            bgcolor: "transparent",
            color: theme.palette.text.primary,
            cursor: currentPage <= 1 ? "default" : "pointer",
            "&:hover": currentPage <= 1 ? undefined : { borderColor: theme.palette.primary.main },
            "&:disabled": { opacity: theme.palette.action.disabledOpacity },
          })}
        >
          {t.previousPageLabel}
        </Box>
        <Box
          component="button"
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => {
            onPageChange(currentPage);
          }}
          data-testid="admin-finances-pagination-next"
          sx={theme => ({
            minHeight: 44,
            px: 2,
            borderRadius: 2,
            border: "1px solid",
            borderColor: theme.palette.outline,
            bgcolor: "transparent",
            color: theme.palette.text.primary,
            cursor: currentPage >= totalPages ? "default" : "pointer",
            "&:hover": currentPage >= totalPages ? undefined : { borderColor: theme.palette.primary.main },
            "&:disabled": { opacity: theme.palette.action.disabledOpacity },
          })}
        >
          {t.nextPageLabel}
        </Box>
      </Stack>
    </Stack>
  );
}
