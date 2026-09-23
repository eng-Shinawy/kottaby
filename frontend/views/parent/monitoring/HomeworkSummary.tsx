"use client";

import { AssignmentOutlined, AutoStoriesOutlined, GradeOutlined, ReplayOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildHomeworkQuery_parentChildHomework_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";
import { SharedStatCard } from "@/frontend/views/parent/monitoring/SharedStatCard";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

interface HomeworkStats {
  readonly count: number;
  readonly latestJadid: string | null;
  readonly latestMadi: string | null;
  readonly averageGrade: number | null;
}

function computeHomeworkStats(items: readonly ParentChildHomeworkQuery_parentChildHomework_items[]): HomeworkStats {
  const count = items.length;
  let latestJadid: string | null = null;
  let latestMadi: string | null = null;
  const grades: number[] = [];
  for (const item of items) {
    if (latestJadid === null && item.jadid !== null && item.jadid.surahJuz !== null) {
      latestJadid = formatSurahJuzRef(item.jadid.surahJuz);
    }
    if (latestMadi === null && item.madi !== null && item.madi.surahJuz !== null) {
      latestMadi = formatSurahJuzRef(item.madi.surahJuz);
    }
    if (item.jadid !== null && item.jadid.grade !== null) {
      grades.push(item.jadid.grade);
    }
    if (item.madi !== null && item.madi.grade !== null) {
      grades.push(item.madi.grade);
    }
  }
  const averageGrade =
    grades.length === 0 ? null : Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10;
  return { count, latestJadid, latestMadi, averageGrade };
}

export function HomeworkSummary({
  items,
  labels,
}: Readonly<{
  items: readonly ParentChildHomeworkQuery_parentChildHomework_items[];
  labels: ParentMonitoringLabels;
}>): ReactNode {
  const stats = computeHomeworkStats(items);
  return (
    <Box sx={theme => ({ p: 2, borderRadius: 2, bgcolor: theme.palette.action.hover })}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {labels.homeworkSummaryHeading}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <SharedStatCard
          icon={<AssignmentOutlined fontSize="small" />}
          value={String(stats.count)}
          label={labels.statHomeworkCount}
          color="primary"
        />
        <SharedStatCard
          icon={<AutoStoriesOutlined fontSize="small" />}
          value={stats.latestJadid ?? labels.trackNoneAssigned}
          label={labels.statLatestJadid}
          color="success"
        />
        <SharedStatCard
          icon={<ReplayOutlined fontSize="small" />}
          value={stats.latestMadi ?? labels.trackNoneAssigned}
          label={labels.statLatestMadi}
          color="warning"
        />
        <SharedStatCard
          icon={<GradeOutlined fontSize="small" />}
          value={stats.averageGrade === null ? labels.ratingNotRated : String(stats.averageGrade)}
          label={labels.statAverageGrade}
          color="info"
        />
      </Box>
    </Box>
  );
}
