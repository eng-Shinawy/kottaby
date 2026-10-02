"use client";

/**
 * Admin academic-tracking drill-down session-report history — the
 * newest-first reports table for the student detail page: desktop table
 * ≥md, stacked cards below. Deep imports only; the detail body composes
 * the sections.
 *
 * Honesty rules carried through every cell: the row date is the
 * session-start stamp with the row-creation fallback; null notes render
 * the localized "not submitted" label; a null rating renders the localized
 * "not rated yet" label — the honest states never share a label and no
 * cell ever fabricates a value.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * tabular numerals on numeric columns.
 */

import { Box, TableCell, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminDesktopTableProps } from "@/frontend/components/ui/AdminDesktopTable";
import type { AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage } from "@/frontend/graphql/generated/gql/graphql";
import {
  AcademicHistoryDesktopTable,
  AcademicHistoryMobileCards,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-history-shared";
import { formatCount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

export interface AcademicReportHistoryProps {
  readonly history: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_reportPage;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
}

/** The session-report history section — newest-first rows over the settled page. */
export function AcademicReportHistory({ history, labels, locale }: Readonly<AcademicReportHistoryProps>): ReactNode {
  const headers: AdminDesktopTableProps["headers"] = [
    { label: labels.reportsColumnDate },
    { label: labels.reportsColumnTeacher },
    { label: labels.reportsColumnNotes },
    { label: labels.reportsColumnRating, align: "right" },
  ];
  return (
    <Box data-testid="academic-tracking-report-history">
      <AcademicHistoryDesktopTable
        ariaLabel={labels.reportsSectionTitle}
        headers={headers}
        items={history.items}
        locale={locale}
        renderTrailingCells={entry => (
          <>
            <TableCell>
              {entry.teacherNotes ?? (
                <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                  {labels.reportNotesNotSubmitted}
                </Typography>
              )}
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {entry.studentRatingByTeacher === null
                ? labels.reportRatingNotRated
                : formatCount(entry.studentRatingByTeacher, locale)}
            </TableCell>
          </>
        )}
      />
      <AcademicHistoryMobileCards
        items={history.items}
        locale={locale}
        renderDetailLines={entry => (
          <>
            {entry.teacherNotes ?? (
              <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
                {labels.reportNotesNotSubmitted}
              </Typography>
            )}
            <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
              {labels.reportsColumnRating}:{" "}
              {entry.studentRatingByTeacher === null
                ? labels.reportRatingNotRated
                : formatCount(entry.studentRatingByTeacher, locale)}
            </Typography>
          </>
        )}
      />
    </Box>
  );
}
