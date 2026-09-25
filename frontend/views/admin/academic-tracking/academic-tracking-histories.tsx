"use client";

/**
 * Admin academic-tracking drill-down homework history — the newest-first
 * homework table for the student detail page: desktop table ≥md, stacked
 * cards below. Deep imports only; the detail body composes the sections.
 *
 * Honesty rules carried through every cell: the row date is the
 * session-start stamp with the row-creation fallback (the fallback is
 * silent but the wire order is untouched); an absent track block renders
 * the localized "none assigned" label; an ungraded track renders the
 * localized "not graded yet" label — the honest states never share a label.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors via callbacks,
 * tabular numerals on date/grade columns.
 */

import { Box, Stack, TableCell, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminDesktopTableProps } from "@/frontend/components/ui/AdminDesktopTable";
import type {
  AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage,
  AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items,
} from "@/frontend/graphql/generated/gql/graphql";
import { formatHomeworkTrackGradeText } from "@/frontend/views/admin/academic-tracking/academic-tracking-display";
import {
  AcademicHistoryDesktopTable,
  AcademicHistoryMobileCards,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-history-shared";
import { AcademicPositionValue } from "@/frontend/views/admin/academic-tracking/academic-tracking-position-value";
import type { AdminAcademicLabels } from "@/shared/locale/types/adminAcademic";

/**
 * Section header: the localized heading with the pluralized entry count —
 * the honest count rides the heading, never a fabricated subtitle.
 */
export function HistorySectionHeading({ title, count }: Readonly<{ title: string; count: string }>): ReactNode {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", flexWrap: "wrap", rowGap: 0.5 }}>
      <Typography variant="h6" component="h3">
        {title}
      </Typography>
      <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
        {count}
      </Typography>
    </Stack>
  );
}

export interface AcademicHomeworkHistoryProps {
  readonly history: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage;
  readonly labels: AdminAcademicLabels;
  readonly locale: string;
}

/** One homework entry's per-track grade pair (the homeworkColumnGrade cell). */
function HomeworkGradeLines({
  entry,
  labels,
  locale,
  compact,
}: Readonly<{
  entry: AdminStudentAcademicDetailQuery_adminStudentAcademicDetail_homeworkPage_items;
  labels: AdminAcademicLabels;
  locale: string;
  /**
   * Dense-table variant: the grade lines prefix with the SHORT track name
   * ("Jadid: 85") so the pair stays on two short lines under the Grade
   * column — the full parenthetical names remain on the card stack where
   * there is no column header to carry the context.
   */
  readonly compact?: boolean;
}>): ReactNode {
  const jadidLabel = compact ? labels.trackJadidShort : labels.trackJadid;
  const madiLabel = compact ? labels.trackMadiShort : labels.trackMadi;
  const jadidText = formatHomeworkTrackGradeText(
    entry.jadid,
    jadidLabel,
    labels.trackNoneAssigned,
    labels.gradeNotGraded,
    locale
  );
  const madiText = formatHomeworkTrackGradeText(
    entry.madi,
    madiLabel,
    labels.trackNoneAssigned,
    labels.gradeNotGraded,
    locale
  );
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {jadidText}
      </Typography>
      <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {madiText}
      </Typography>
    </Stack>
  );
}

/** The homework history section — newest-first rows over the settled page. */
export function AcademicHomeworkHistory({
  history,
  labels,
  locale,
}: Readonly<AcademicHomeworkHistoryProps>): ReactNode {
  const headers: AdminDesktopTableProps["headers"] = [
    { label: labels.homeworkColumnDate },
    { label: labels.homeworkColumnTeacher },
    { label: labels.homeworkColumnJadid },
    { label: labels.homeworkColumnMadi },
    { label: labels.homeworkColumnGrade },
  ];
  return (
    <Box data-testid="academic-tracking-homework-history">
      <AcademicHistoryDesktopTable
        ariaLabel={labels.homeworkSectionTitle}
        headers={headers}
        items={history.items}
        locale={locale}
        renderTrailingCells={entry => (
          <>
            <TableCell>
              <AcademicPositionValue
                position={entry.jadid}
                ayahRangeLabel={labels.ayahRangeLabel}
                locale={locale}
                noneLabel={labels.trackNoneAssigned}
              />
            </TableCell>
            <TableCell>
              <AcademicPositionValue
                position={entry.madi}
                ayahRangeLabel={labels.ayahRangeLabel}
                locale={locale}
                noneLabel={labels.trackNoneAssigned}
              />
            </TableCell>
            <TableCell>
              <HomeworkGradeLines compact entry={entry} labels={labels} locale={locale} />
            </TableCell>
          </>
        )}
      />
      <AcademicHistoryMobileCards
        items={history.items}
        locale={locale}
        renderDetailLines={entry => <HomeworkGradeLines entry={entry} labels={labels} locale={locale} />}
      />
    </Box>
  );
}
