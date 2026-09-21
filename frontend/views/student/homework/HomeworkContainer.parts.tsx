"use client";

import { AutoStoriesOutlined, ReplayOutlined, SearchOffOutlined, TaskAltOutlined } from "@mui/icons-material";
import { Card, Chip, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { IconCircleEmptyState } from "@/frontend/components/ui/IconCircleEmptyState";
import type { MyHomeworkQuery_myHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { HomeworkTrackBlock } from "@/frontend/views/parent/monitoring/HomeworkTab.parts.helpers";
import type { HomeworkLabels } from "@/shared/locale/types/homework";

/**
 * One assignment card: the honest meta line (assignment date + owning
 * session + status chip), then the two parallel track blocks — the SAME
 * shared presentation the parent portal renders, primary-accented for
 * Jadid and secondary-accented for Madi.
 */
function HomeworkRow({
  row,
  labels: t,
  locale,
  graded,
}: Readonly<{
  row: MyHomeworkQuery_myHomework_items;
  labels: HomeworkLabels;
  locale: string;
  graded: boolean;
}>): ReactNode {
  return (
    <Card
      variant="outlined"
      data-testid="student-homework-row"
      sx={theme => ({
        display: "flex",
        flexDirection: "column",
        gap: 1.5,
        padding: 2,
        borderRadius: 2,
        borderColor: theme.palette.border.main,
        bgcolor: theme.palette.surfaceContainerLowest,
        transition: theme.transitions.create(["box-shadow", "border-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[1],
          borderColor: theme.palette.outline,
        },
      })}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap", rowGap: 0.5, minWidth: 0 }}>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
          {t.assignedPrefix} {formatApplicantDate(row.createdAt, locale)}
        </Typography>
        <Typography
          variant="caption"
          sx={theme => ({
            color: theme.palette.text.secondary,
            fontVariantNumeric: "tabular-nums",
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            borderRadius: 999,
            px: 1,
            py: 0.25,
          })}
        >
          {t.sessionLine(row.sessionId)}
        </Typography>
        <Chip
          size="small"
          label={graded ? t.statusGradedChip : t.statusPendingChip}
          sx={theme => ({
            ml: "auto",
            fontWeight: 700,
            borderRadius: 999,
            bgcolor: graded ? theme.palette.successContainer : theme.palette.action.hover,
            color: graded ? theme.palette.onSuccessContainer : theme.palette.text.secondary,
          })}
        />
      </Stack>
      <HomeworkTrackBlock
        track={row.jadid}
        trackLabel={t.trackJadid}
        noneLabel={t.trackNoneAssigned}
        columnGradeLabel={t.gradeLabel}
        icon={<AutoStoriesOutlined fontSize="small" />}
        accentColor="primary.main"
      />
      <HomeworkTrackBlock
        track={row.madi}
        trackLabel={t.trackMadi}
        noneLabel={t.trackNoneAssigned}
        columnGradeLabel={t.gradeLabel}
        icon={<ReplayOutlined fontSize="small" />}
        accentColor="secondary.main"
      />
    </Card>
  );
}

/**
 * The list body under the "all" history: two honest empty arms (a search
 * with no matches vs a filter bucket with nothing in it) over the row
 * cards, each graded flag computed from its own track grades.
 */
export function HomeworkListBody({
  visibleRows,
  labels: t,
  locale,
  searchQuery,
}: Readonly<{
  visibleRows: readonly MyHomeworkQuery_myHomework_items[];
  labels: HomeworkLabels;
  locale: string;
  searchQuery: string;
}>): ReactNode {
  if (visibleRows.length === 0) {
    if (searchQuery.trim() !== "") {
      return (
        <IconCircleEmptyState
          testId="student-homework-search-empty"
          icon={<SearchOffOutlined sx={{ fontSize: 36 }} />}
          title={t.searchNoResults}
          body={t.searchEmptyBody}
        />
      );
    }
    return (
      <IconCircleEmptyState
        testId="student-homework-filtered-empty"
        icon={<TaskAltOutlined sx={{ fontSize: 36 }} />}
        title={t.filterEmptyTitle}
        body={t.filterEmptyBody}
      />
    );
  }
  return (
    <>
      {visibleRows.map(row => (
        <HomeworkRow
          key={row.id}
          row={row}
          labels={t}
          locale={locale}
          graded={(row.jadid?.grade ?? null) !== null || (row.madi?.grade ?? null) !== null}
        />
      ))}
    </>
  );
}
