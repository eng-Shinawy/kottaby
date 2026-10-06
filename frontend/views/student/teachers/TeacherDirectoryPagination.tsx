"use client";

/**
 * TeacherDirectoryPagination — the student-local pagination footer of the
 * teacher directory, modeled on the admin users directory's pager sx
 * (≥44px hit areas, selected pill painted filled primary/onPrimary, 6px
 * radius, sibling/boundary count 1, a page list that NEVER wraps
 * internally so the arrows can't strand on their own lines) — WITHOUT the
 * rows-per-page select (the browse ships a fixed page size).
 *
 * The component is page-state-agnostic: the container owns `page` (1-based,
 * straight from the wire's honest echo) and passes controlled callbacks;
 * `pageCount` is the server-computed envelope value (never recomputed —
 * the service owns the bounds math). Out-of-range defenses stay in the
 * container (every filter apply/reset returns to page 1).
 *
 * Accessible labels arrive individually (localized by the container): the
 * nav region's name, the previous/next arrows, and the page-word composed
 * with each page number as DATA (`${pageWord} ${n}`) — no interpolation
 * into namespace copy.
 */

import { Box, Pagination } from "@mui/material";
import type { ReactNode } from "react";

interface TeacherDirectoryPaginationProps {
  /** Accessible name of the pagination nav region. */
  readonly ariaLabel: string;
  /** Accessible label of the previous-page arrow. */
  readonly previousPageLabel: string;
  /** Accessible label of the next-page arrow. */
  readonly nextPageLabel: string;
  /** "Page" word composed with each page number (as data) in the per-item labels. */
  readonly pageWordLabel: string;
  /** Current page — 1-based, the wire envelope's own echo. */
  readonly page: number;
  /** Server-computed page count of the current browse. */
  readonly pageCount: number;
  /** Page-change intent (receives the 1-based next page). */
  readonly onPageChange: (page: number) => void;
}

/** The student browse pagination footer. */
export function TeacherDirectoryPagination({
  ariaLabel,
  previousPageLabel,
  nextPageLabel,
  pageWordLabel,
  page,
  pageCount,
  onPageChange,
}: Readonly<TeacherDirectoryPaginationProps>): ReactNode {
  const boundedCount = Math.max(pageCount, 1);
  return (
    <Box
      component="nav"
      aria-label={ariaLabel}
      data-testid="student-teachers-pagination"
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        py: 1,
      }}
    >
      <Pagination
        count={boundedCount}
        page={Math.min(page, boundedCount)}
        onChange={(_, nextPage) => onPageChange(nextPage)}
        shape="rounded"
        size="small"
        siblingCount={1}
        boundaryCount={1}
        getItemAriaLabel={(type, itemPage) => {
          if (type === "previous") return previousPageLabel;
          if (type === "next") return nextPageLabel;
          return `${pageWordLabel} ${itemPage}`;
        }}
        sx={theme => ({
          // ≥44px pagination buttons (WCAG 2.5.5) without switching the
          // compact visual variant. The page list NEVER wraps internally:
          // a wrapped ul strands the prev/next arrows on their own lines
          // on narrow cards; nowrap keeps the pager one atomic centered
          // block that the outer flex wraps as a whole instead.
          "& .MuiPagination-ul": { flexWrap: "nowrap", justifyContent: "center" },
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
  );
}
