"use client";

/**
 * FinanceTableFooter — the shared footer bar of the admin finances table
 * cards: the result-count caption over the shared
 * {@link AdminFinancePaginationBar}, on a `border.light` top hairline.
 * Consumed by the payments audit table and the withdrawal payout queue
 * table so the two cards share one footer recipe.
 *
 * MUI v9 `sx`-only discipline, theme-palette colors.
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AdminFinancePaginationBar } from "@/frontend/views/admin/finances/AdminFinancePaginationBar";

interface FinanceTableFooterProps {
  /** Localized result-count caption (the namespace's count function). */
  readonly countLine: string;
  /** The current 0-based page index (the hook's own `page` state). */
  readonly page: number;
  /** The page-window size (the hook's own `pageSize`). */
  readonly pageSize: number;
  /** The total row count from the query data. */
  readonly totalCount: number;
  /** The 0-based page setter (the hook's own `setPage`). */
  readonly onPageChange: (page: number) => void;
}

/** The shared caption + pagination footer of the finances table cards. */
export function FinanceTableFooter({
  countLine,
  page,
  pageSize,
  totalCount,
  onPageChange,
}: Readonly<FinanceTableFooterProps>): ReactNode {
  return (
    <Stack
      direction="row"
      sx={theme => ({
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        flexWrap: "wrap",
        py: 2,
        px: 2.5,
        borderTop: `1px solid ${theme.palette.border.light}`,
      })}
    >
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {countLine}
      </Typography>
      <AdminFinancePaginationBar page={page} pageSize={pageSize} totalCount={totalCount} onPageChange={onPageChange} />
    </Stack>
  );
}
