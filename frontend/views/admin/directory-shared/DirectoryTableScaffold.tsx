"use client";

/**
 * DirectoryTableScaffold — the shared desktop (≥`md`) directory-table
 * scaffolding of the admin directory surfaces (students / teachers /
 * applicants): card container, fixed-layout `Table`, header row built from
 * the consumer's column config, and the `TableBody` loading/empty/data
 * orchestration (stable-key skeleton rows announcing the localized loading
 * label; the empty state spanned across all columns; the domain's mapped
 * body rows).
 *
 * The card chrome is hidden below `md` (the mobile card list renders
 * there), radius 12, `border.light` outline, `shadow.card`. The pagination
 * footer is injected as a `pagination` slot rendered inside the same card
 * (top hairline from `DirectoryPagination`).
 *
 * Domain specifics (columns config, row renderers, empty-state component,
 * label sources) stay in the domain files and flow in through props.
 */

import { Card, Skeleton, Table, TableBody, TableCell, TableHead, TableRow } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import { DirectoryHeaderCell } from "@/frontend/views/admin/directory-shared/DirectoryHeaderCell";
import { directoryTableCardSx } from "@/frontend/views/admin/directory-shared/directory-skins";

/** One header column of the directory table (label source + fixed width). */
export interface DirectoryTableHeader {
  /** Stable React key for the header cell. */
  readonly id: string;
  /** Uppercase column label — from the domain's locale block. */
  readonly label: ReactNode;
  /** Fixed column width (the tables use `tableLayout: "fixed"`). */
  readonly width: string;
  /** Column text alignment — `"end"` for money/numeric columns. Defaults to `"start"`. */
  readonly align?: "start" | "end";
}

interface DirectoryTableScaffoldProps {
  /** Header columns, start → end (they mirror visually under RTL automatically). */
  readonly headers: readonly DirectoryTableHeader[];
  readonly loading: boolean;
  /** Rowgroup announcement while the first page is in flight (skeleton). */
  readonly loadingLabel: string;
  /** Stable skeleton row keys (the domain's `*_SKELETON_KEYS`). */
  readonly skeletonKeys: readonly string[];
  /** Empty-state node rendered spanned across all columns. */
  readonly empty: ReactNode;
  /** Body rows — the domain's mapped row components. */
  readonly rows: readonly ReactElement[];
  /** Footer slot rendered inside the card (the shared `DirectoryPagination` bar). */
  readonly pagination?: ReactNode;
}

export function DirectoryTableScaffold(props: DirectoryTableScaffoldProps): ReactNode {
  const { headers, loading, loadingLabel, skeletonKeys, empty, rows, pagination } = props;
  return (
    <Card sx={directoryTableCardSx()}>
      <Table sx={{ tableLayout: "fixed" }}>
        <TableHead>
          <TableRow sx={theme => ({ bgcolor: theme.palette.surfaceContainerHigh })}>
            {headers.map(header => (
              <DirectoryHeaderCell key={header.id} width={header.width} align={header.align}>
                {header.label}
              </DirectoryHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody aria-label={loading && rows.length === 0 ? loadingLabel : undefined}>
          {loading && rows.length === 0
            ? skeletonKeys.map(rowKey => (
                <TableRow key={rowKey}>
                  <DirectorySkeletonCell columnCount={headers.length} />
                </TableRow>
              ))
            : null}
          {!loading && rows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={headers.length} sx={{ borderBottom: 0 }}>
                {empty}
              </TableCell>
            </TableRow>
          ) : null}
          {rows}
        </TableBody>
      </Table>
      {pagination}
    </Card>
  );
}

interface DirectorySkeletonCellProps {
  readonly columnCount: number;
}

/** Loading cell — one `Skeleton` text line spanned across all columns. */
function DirectorySkeletonCell({ columnCount }: DirectorySkeletonCellProps): ReactNode {
  return (
    <TableCell colSpan={columnCount} sx={theme => ({ borderBottom: `1px solid ${theme.palette.border.light}` })}>
      <Skeleton variant="text" />
    </TableCell>
  );
}
