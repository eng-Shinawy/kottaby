/**
 * AdminDesktopTable — shared desktop-only table scaffold (visible md and up)
 * for admin catalog tables: bordered Paper container, hover-tinted header row
 * with nowrap header cells, and a body rendered by the consumer.
 */

"use client";

import { Paper, Table, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { mergeSx } from "@/frontend/utils/mergeSx";

interface AdminDesktopTableHeader {
  readonly label: string;
  readonly align?: "left" | "right" | "center";
}

export interface AdminDesktopTableProps {
  readonly ariaLabel: string;
  readonly headers: readonly AdminDesktopTableHeader[];
  readonly children: React.ReactNode;
  /**
   * Optional extra `sx` on the outer TableContainer — lets a wide listing
   * tune its density (e.g. cell padding) without forking the scaffold.
   * Composed AFTER the shell styles via `mergeSx` so per-table overrides
   * win; consumers that omit it keep the default scaffold untouched.
   */
  readonly sx?: SxProps<Theme>;
}

export function AdminDesktopTable({ ariaLabel, headers, children, sx }: AdminDesktopTableProps): React.ReactElement {
  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={mergeSx(
        theme => ({
          display: { xs: "none", md: "block" },
          border: 1,
          borderColor: theme.palette.divider,
          borderRadius: 2,
        }),
        sx
      )}
    >
      <Table aria-label={ariaLabel}>
        <TableHead>
          <TableRow sx={theme => ({ backgroundColor: theme.palette.action.hover })}>
            {/* `whiteSpace: nowrap` — narrow lanes were wrapping Arabic headers
                mid-word; headers keep one line and the table scrolls instead. */}
            {headers.map(header => (
              <TableCell key={header.label} align={header.align} sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                {header.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        {children}
      </Table>
    </TableContainer>
  );
}
