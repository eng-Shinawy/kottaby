"use client";

import { AutoStoriesOutlined, BookmarkBorderOutlined, ReplayOutlined, TrendingUpOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildProgressQuery_parentChildProgress } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";
import { SharedStatCard } from "@/frontend/views/parent/monitoring/SharedStatCard";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

function computeProgressStats(
  progress: ParentChildProgressQuery_parentChildProgress,
  locale: string
): {
  readonly rowCount: number;
  readonly jadidValue: string;
  readonly madiValue: string;
  readonly enrolledSince: string;
} {
  const rowCount = progress.progressRowCount;
  const jadidValue =
    progress.latestJadidPosition !== null ? formatSurahJuzRef(progress.latestJadidPosition.surahJuz) : "—";
  const madiValue =
    progress.latestMadiPosition !== null ? formatSurahJuzRef(progress.latestMadiPosition.surahJuz) : "—";
  const enrolledSince = formatApplicantDate(progress.child.createdAt, locale);
  return { rowCount, jadidValue, madiValue, enrolledSince };
}

export function ProgressSummary({
  progress,
  labels,
  locale,
}: Readonly<{
  progress: ParentChildProgressQuery_parentChildProgress;
  labels: ParentMonitoringLabels;
  locale: string;
}>): ReactNode {
  const stats = computeProgressStats(progress, locale);
  return (
    <Box sx={theme => ({ p: 2, borderRadius: 2, bgcolor: theme.palette.action.hover })}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {labels.progressSummaryHeading}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <SharedStatCard
          icon={<TrendingUpOutlined fontSize="small" />}
          value={String(stats.rowCount)}
          label={labels.statProgressRows}
          color="primary"
        />
        <SharedStatCard
          icon={<AutoStoriesOutlined fontSize="small" />}
          value={stats.jadidValue}
          label={labels.statLatestJadid}
          color="success"
        />
        <SharedStatCard
          icon={<ReplayOutlined fontSize="small" />}
          value={stats.madiValue}
          label={labels.statLatestMadi}
          color="warning"
        />
        <SharedStatCard
          icon={<BookmarkBorderOutlined fontSize="small" />}
          value={stats.enrolledSince}
          label={labels.statEnrolledSince}
          color="info"
        />
      </Box>
    </Box>
  );
}
