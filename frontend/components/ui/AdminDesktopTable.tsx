/**
 * AdminDesktopTable — shared desktop-only table scaffold (visible md and up)
 * for admin catalog tables: bordered Paper container, hover-tinted header row
 * with nowrap header cells, and a body rendered by the consumer.
 */

"use client";

import { Paper, Table, TableCell, TableContainer, TableHead, TableRow } from "@mui/material";

interface AdminDesktopTableHeader {
  readonly label: string;
  readonly align?: "left" | "right" | "center";
}

export interface AdminDesktopTableProps {
  readonly ariaLabel: string;
  readonly headers: readonly AdminDesktopTableHeader[];
  readonly children: React.ReactNode;
}

export function AdminDesktopTable({ ariaLabel, headers, children }: AdminDesktopTableProps): React.ReactElement {
  return (
    <TableContainer
      component={Paper}
      elevation={0}
      sx={theme => ({
        display: { xs: "none", md: "block" },
        border: 1,
        borderColor: theme.palette.divider,
        borderRadius: 2,
      })}
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
