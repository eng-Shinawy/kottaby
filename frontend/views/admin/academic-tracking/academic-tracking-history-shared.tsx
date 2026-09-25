"use client";

/**
 * Shared history-shell primitives for the admin academic-tracking
 * drill-down — the desktop table frame (hidden below `md`) and the
 * stacked mobile card list (hidden at `md`+) that the homework history
 * and the session-report history compose with their own columns and
 * detail lines.
 *
 * The two sections share ONE honest shell: identical date cell (the
 * session-start stamp with the row-creation fallback), identical teacher
 * cell, identical card header — only the trailing columns / detail lines
 * differ, and those arrive through render props so each section keeps its
 * own typed entries. Extracting the shell keeps the two sections from
 * drifting apart visually or semantically while jscpd holds the repo at
 * zero clones.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via
 * callbacks, tabular numerals on the date column.
 */

import { Box, Card, Stack, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AdminDesktopTable, type AdminDesktopTableProps } from "@/frontend/components/ui/AdminDesktopTable";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { academicHistoryDateIso } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";

/** The structural slice every history entry shares (id + date + teacher). */
export interface AcademicHistoryEntryLike {
  readonly id: string;
  readonly teacherName: string;
  readonly sessionStartedAt: string | null;
  readonly createdAt: string;
}

export interface AcademicHistoryDesktopTableProps<T extends AcademicHistoryEntryLike> {
  /** The localized section title — the table's accessible name. */
  readonly ariaLabel: string;
  /** The section's column set (label + optional alignment). */
  readonly headers: AdminDesktopTableProps["headers"];
  /** The settled, newest-first page items. */
  readonly items: readonly T[];
  /** The active app locale (date formatting). */
  readonly locale: string;
  /** The section's trailing cells — everything after date + teacher. */
  readonly renderTrailingCells: (entry: T) => ReactNode;
}

/**
 * The desktop history table (≥md) — one hover row per entry: the shared
 * date + teacher cells then the section's trailing cells.
 */
export function AcademicHistoryDesktopTable<T extends AcademicHistoryEntryLike>({
  ariaLabel,
  headers,
  items,
  locale,
  renderTrailingCells,
}: Readonly<AcademicHistoryDesktopTableProps<T>>): ReactNode {
  return (
    <Box sx={{ display: { xs: "none", md: "block" } }}>
      <AdminDesktopTable ariaLabel={ariaLabel} headers={headers}>
        <TableBody>
          {items.map(entry => (
            <TableRow key={entry.id} hover>
              <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {formatApplicantDate(academicHistoryDateIso(entry), locale)}
              </TableCell>
              <TableCell>{entry.teacherName}</TableCell>
              {renderTrailingCells(entry)}
            </TableRow>
          ))}
        </TableBody>
      </AdminDesktopTable>
    </Box>
  );
}

export interface AcademicHistoryMobileCardsProps<T extends AcademicHistoryEntryLike> {
  /** The settled, newest-first page items. */
  readonly items: readonly T[];
  /** The active app locale (date formatting). */
  readonly locale: string;
  /** The section's detail lines — rendered under the shared card header. */
  readonly renderDetailLines: (entry: T) => ReactNode;
}

/**
 * The stacked mobile history cards (<md) — one outlined card per entry:
 * the shared date + teacher header row then the section's detail lines.
 */
export function AcademicHistoryMobileCards<T extends AcademicHistoryEntryLike>({
  items,
  locale,
  renderDetailLines,
}: Readonly<AcademicHistoryMobileCardsProps<T>>): ReactNode {
  return (
    <Stack spacing={2} sx={{ display: { xs: "flex", md: "none" } }}>
      {items.map(entry => (
        <Card
          key={entry.id}
          variant="outlined"
          sx={theme => ({ borderRadius: "12px", borderColor: theme.palette.border.light })}
        >
          <Stack spacing={1} sx={{ padding: 2 }}>
            <Stack direction="row" spacing={2} sx={{ justifyContent: "space-between", flexWrap: "wrap", rowGap: 0.5 }}>
              <Typography variant="body2" component="p" sx={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                {formatApplicantDate(academicHistoryDateIso(entry), locale)}
              </Typography>
              <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                {entry.teacherName}
              </Typography>
            </Stack>
            {renderDetailLines(entry)}
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}
