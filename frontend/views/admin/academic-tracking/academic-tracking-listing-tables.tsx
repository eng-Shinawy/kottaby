"use client";

/**
 * Admin academic-tracking listing tables — the desktop table body and the
 * stacked mobile card for the all-students dashboard listing. Deep imports
 * only; the listing dispatcher composes them behind the responsive switch.
 *
 * Honesty rules carried through every cell: an absent latest-position slot
 * renders the localized "none" label, an ungraded track renders the
 * localized "not graded yet" label, a null last-graded stamp renders the
 * em-dash placeholder, the progress count is the bare honest number — no
 * cell ever fabricates a value.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * tabular numerals on all numeric columns.
 */

import { Box, Stack, TableBody, TableCell, TableRow, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AdminDesktopTable, type AdminDesktopTableProps } from "@/frontend/components/ui/AdminDesktopTable";
import type { AdminAcademicDashboardQuery_adminAcademicDashboard_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  AcademicAttentionChips,
  AcademicGradeSummaryValue,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-cells";
import { NULL_VALUE_PLACEHOLDER } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import { AcademicPositionValue } from "@/frontend/views/admin/academic-tracking/academic-tracking-position-value";
import { formatCount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

type AcademicStudentRow = AdminAcademicDashboardQuery_adminAcademicDashboard_items;

/** The detail-link renderer is owned by the listing dispatcher (fail-closed). */
type RenderDetailLink = (props: {
  readonly rowId: string;
  readonly fullName: string;
  readonly withChevron?: boolean;
}) => ReactNode;

/** The desktop student cell: the bold full name over the secondary email. */
function AcademicNameCell({ row }: Readonly<{ row: AcademicStudentRow }>): ReactNode {
  return (
    <Stack spacing={0.25}>
      <Typography variant="body2" component="p" sx={{ fontWeight: 600 }}>
        {row.fullName}
      </Typography>
      <Typography
        variant="caption"
        component="p"
        title={row.email}
        noWrap
        sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 150 })}
      >
        {row.email}
      </Typography>
    </Stack>
  );
}

/** The desktop listing table — one row per student, nine pinned columns. */
export function AcademicStudentsDesktopTable({
  rows,
  labels,
  locale,
  renderDetailLink,
}: Readonly<{
  rows: readonly AcademicStudentRow[];
  labels: AdminAcademicLabels;
  locale: string;
  renderDetailLink: RenderDetailLink;
}>): ReactNode {
  const headers: AdminDesktopTableProps["headers"] = [
    { label: labels.columnName },
    { label: labels.columnLatestJadidPosition },
    { label: labels.columnLatestMadiPosition },
    { label: labels.columnJadidAverage },
    { label: labels.columnMadiAverage },
    { label: labels.columnProgressRows, align: "right" },
    { label: labels.columnLastGradedAt },
    { label: labels.columnAttention },
    { label: "" },
  ];

  const renderLastGraded = (row: AcademicStudentRow): string =>
    row.lastGradedHomeworkAt === null ? NULL_VALUE_PLACEHOLDER : formatApplicantDate(row.lastGradedHomeworkAt, locale);

  return (
    <AdminDesktopTable
      ariaLabel={labels.dashboardPageTitle}
      headers={headers}
      /* Nine honest columns cannot fit a 1126px content lane at default MUI
         cell padding — the density trim (8px gutters, 13px header cells)
         keeps every column on screen at the common 1440 desktop instead of
         scrolling the tail columns out of view. Vertical rhythm stays at
         the comfortable 1.5 step. */
      sx={{
        "& .MuiTableCell-root": { paddingInline: 1, paddingBlock: 1.5 },
        "& .MuiTableHead-root .MuiTableCell-root": { fontSize: "0.8125rem" },
      }}
    >
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.id} hover>
            <TableCell>{<AcademicNameCell row={row} />}</TableCell>
            <TableCell>
              <AcademicPositionValue
                stacked
                position={row.latestJadidPosition}
                ayahRangeLabel={labels.ayahRangeLabel}
                locale={locale}
                noneLabel={labels.positionNone}
              />
            </TableCell>
            <TableCell>
              <AcademicPositionValue
                stacked
                position={row.latestMadiPosition}
                ayahRangeLabel={labels.ayahRangeLabel}
                locale={locale}
                noneLabel={labels.positionNone}
              />
            </TableCell>
            <TableCell>
              <AcademicGradeSummaryValue compact summary={row.jadidGradeSummary} labels={labels} locale={locale} />
            </TableCell>
            <TableCell>
              <AcademicGradeSummaryValue compact summary={row.madiGradeSummary} labels={labels} locale={locale} />
            </TableCell>
            <TableCell align="right" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatCount(row.progressRowCount, locale)}
            </TableCell>
            <TableCell sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              <Box component="span" title={row.lastGradedHomeworkAt ?? undefined}>
                {renderLastGraded(row)}
              </Box>
            </TableCell>
            <TableCell>
              <AcademicAttentionChips
                flag={row.needsAttention}
                labels={labels}
                badgeLabel={labels.attentionBadgeLabel}
              />
            </TableCell>
            <TableCell>{renderDetailLink({ rowId: row.id, fullName: row.fullName })}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </AdminDesktopTable>
  );
}
