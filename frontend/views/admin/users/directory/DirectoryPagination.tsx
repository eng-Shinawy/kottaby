"use client";

/**
 * DirectoryPagination — the footer bar of the directory table card (top
 * `border.light` hairline, 16–20px padding).
 *
 * Leading side: the localized range caption, composed as
 * `${showingPrefix} ${from}–${to} ${of} ${total}` with the range bolded.
 * Trailing side: the rows-per-page select plus a rounded MUI `Pagination`
 * (selected page painted filled `primary`/`onPrimary`, 6px radius,
 * sibling/boundary count 1).
 *
 * The component is page-state-agnostic: the container owns `page` /
 * `pageSize` and passes controlled callbacks, so the same component sits
 * inside the desktop table card and (optionally) below the mobile list.
 */

import { Box, MenuItem, Pagination, Select, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface DirectoryPaginationProps {
  readonly labels: Pick<AdminUsersLabels, "pagination">;
  /** Zero-based current page. */
  readonly page: number;
  readonly pageSize: number;
  readonly totalCount: number;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange: (pageSize: number) => void;
  /** Set false when rendered outside the table card (drops the top hairline). */
  readonly borderedTop?: boolean;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export function DirectoryPagination(props: DirectoryPaginationProps): ReactNode {
  const { labels, page, pageSize, totalCount, onPageChange, onPageSizeChange, borderedTop = true } = props;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const from = totalCount === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, totalCount);
  return (
    <Box
      sx={theme => ({
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 2,
        py: 2,
        px: 2.5,
        ...(borderedTop && { borderTop: `1px solid ${theme.palette.border.light}` }),
      })}
    >
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {`${labels.pagination.showingPrefix} `}
        <Box component="span" sx={{ fontWeight: 700 }}>
          {from}–{to}
        </Box>
        {` ${labels.pagination.of} ${totalCount}`}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Select<number>
          size="small"
          value={pageSize}
          onChange={event => onPageSizeChange(event.target.value)}
          inputProps={{ "aria-label": labels.pagination.pageSize }}
          sx={{
            height: 44,
            // Vertically center the visible value inside the fixed 44px
            // control: the default block padding makes the inner select box
            // taller than the outlined root (or shrink it below the target).
            "&& .MuiSelect-select": {
              minHeight: 44,
              boxSizing: "border-box",
              paddingBlock: 0,
              display: "flex",
              alignItems: "center",
            },
            "& .MuiSelect-nativeInput": { height: "100%" },
          }}
        >
          {PAGE_SIZE_OPTIONS.map(option => (
            <MenuItem key={`page-size-${option}`} value={option}>
              {option}
            </MenuItem>
          ))}
        </Select>
        <Pagination
          count={pageCount}
          page={Math.min(page + 1, pageCount)}
          onChange={(_event, value) => onPageChange(value - 1)}
          shape="rounded"
          size="small"
          siblingCount={1}
          boundaryCount={1}
          aria-label={labels.pagination.page}
          sx={theme => ({
            // ≥44px pagination buttons (WCAG 2.5.5) without switching the
            // compact visual variant.
            "& .MuiPaginationItem-root": { minWidth: 44, minHeight: 44 },
            "& .MuiPaginationItem-root.Mui-selected": {
              bgcolor: theme.palette.primary.main,
              color: theme.palette.onPrimary,
              borderRadius: "6px",
            },
            "& .MuiPaginationItem-root.Mui-selected:hover": {
              bgcolor: theme.palette.primary.main,
            },
          })}
        />
      </Box>
    </Box>
  );
}
