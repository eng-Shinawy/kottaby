"use client";

/**
 * DirectoryBodyRow — one body row of the admin directory desktop tables:
 * the 72px band, the faint zebra tint on even rows, the hover upgrade to
 * `action.selected`, and the pointer cursor when the row opens the detail
 * drawer. The row enforces the 72px body-row height on the CELLS (a row's
 * own height is a minimum; `py: 1.5` alone measured short once line-heights
 * settled); `verticalAlign: middle` keeps single-line cells centered within
 * the band.
 */

import { TableRow } from "@mui/material";
import type { ReactNode } from "react";

interface DirectoryBodyRowProps {
  readonly children: ReactNode;
  /** `true` paints the faint zebra tint on this row (odd body-row index). */
  readonly striped?: boolean;
  /** Row click (opens the detail drawer) — pointer convenience only. */
  readonly onClick?: () => void;
}

export function DirectoryBodyRow({ children, striped = false, onClick }: DirectoryBodyRowProps): ReactNode {
  const clickable = onClick !== undefined;
  return (
    <TableRow
      onClick={onClick}
      sx={theme => ({
        "&:hover": { bgcolor: theme.palette.action.selected },
        "&:last-child td": { borderBottom: 0 },
        "& td": {
          height: 72,
          py: 1.5,
          verticalAlign: "middle",
          borderBottom: `1px solid ${theme.palette.border.light}`,
        },
        bgcolor: striped ? theme.palette.action.hover : "transparent",
        height: 72,
        ...(clickable && { cursor: "pointer" }),
      })}
    >
      {children}
    </TableRow>
  );
}
