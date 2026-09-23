"use client";

/**
 * DirectoryHeaderCell — the shared uppercase column header cell of the
 * admin directory tables (students / teachers / applicants / audit trail).
 *
 * Uppercase 12px / 600 / letter-spaced `text.secondary` text on a
 * `border.light` bottom hairline. The fixed column widths come from the
 * consumer's headers config (the tables use `tableLayout: "fixed"`).
 */

import { TableCell } from "@mui/material";
import type { ReactNode } from "react";

export interface DirectoryHeaderCellProps {
  readonly children: ReactNode;
  /** Fixed column width (e.g. `"29.5%"`) — the tables use `tableLayout: "fixed"`. */
  readonly width?: string;
  /** Column text alignment — `"end"` for money/numeric columns. Defaults to `"start"`. */
  readonly align?: "start" | "end";
}

export function DirectoryHeaderCell({ children, width, align = "start" }: DirectoryHeaderCellProps): ReactNode {
  return (
    <TableCell
      sx={theme => ({
        width,
        textTransform: "uppercase",
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: "0.06em",
        color: theme.palette.text.secondary,
        textAlign: align,
        borderBottom: `1px solid ${theme.palette.border.light}`,
      })}
    >
      {children}
    </TableCell>
  );
}
