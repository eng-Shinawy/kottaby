"use client";

import { GradeOutlined, RateReviewOutlined, StarOutlined, TrendingUpOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildReportsQuery_parentChildReports_items } from "@/frontend/graphql/generated/gql/graphql";
import { SharedStatCard } from "@/frontend/views/parent/monitoring/SharedStatCard";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

function computeEvaluationStats(items: readonly ParentChildReportsQuery_parentChildReports_items[]): {
  readonly total: number;
  readonly ratedCount: number;
  readonly averageScore: string;
  readonly highestScore: string;
} {
  const total = items.length;
  const ratings: number[] = [];
  for (const item of items) {
    if (item.studentRatingByTeacher !== null) {
      ratings.push(item.studentRatingByTeacher);
    }
  }
  const ratedCount = ratings.length;
  const averageScore =
    ratings.length === 0 ? "—" : String(Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10);
  const highestScore = ratings.length === 0 ? "—" : String(Math.max(...ratings));
  return { total, ratedCount, averageScore, highestScore };
}

export function EvaluationsSummary({
  items,
  labels,
}: Readonly<{
  items: readonly ParentChildReportsQuery_parentChildReports_items[];
  labels: ParentMonitoringLabels;
}>): ReactNode {
  const stats = computeEvaluationStats(items);
  return (
    <Box sx={theme => ({ p: 2, borderRadius: 2, bgcolor: theme.palette.action.hover })}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {labels.evaluationsSummaryHeading}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <SharedStatCard
          icon={<RateReviewOutlined fontSize="small" />}
          value={String(stats.total)}
          label={labels.statTotalEvaluations}
          color="primary"
        />
        <SharedStatCard
          icon={<GradeOutlined fontSize="small" />}
          value={stats.averageScore}
          label={labels.statAverageScore}
          color="success"
        />
        <SharedStatCard
          icon={<StarOutlined fontSize="small" />}
          value={stats.highestScore}
          label={labels.statHighestScore}
          color="warning"
        />
        <SharedStatCard
          icon={<TrendingUpOutlined fontSize="small" />}
          value={String(stats.ratedCount)}
          label={labels.statRatedSessions}
          color="info"
        />
      </Box>
    </Box>
  );
}
