"use client";

import { CalendarMonthOutlined, CheckCircleOutlined, ScheduleOutlined, TrendingUpOutlined } from "@mui/icons-material";
import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { ParentChildSessionsQuery_parentChildSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { SharedStatCard } from "@/frontend/views/parent/monitoring/SharedStatCard";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

interface SummaryStats {
  readonly total: number;
  readonly completed: number;
  readonly scheduled: number;
  readonly completionRate: number;
}

function computeStats(sessions: readonly ParentChildSessionsQuery_parentChildSessions_items[]): SummaryStats {
  let completed = 0;
  let scheduled = 0;
  for (const s of sessions) {
    const key = s.status.toLowerCase();
    if (key === "completed") {
      completed++;
    } else if (key === "scheduled") {
      scheduled++;
    }
  }
  const total = sessions.length;
  const completionRate = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, scheduled, completionRate };
}

export function AttendanceSummary({
  sessions,
  labels,
}: Readonly<{
  sessions: readonly ParentChildSessionsQuery_parentChildSessions_items[];
  labels: ParentMonitoringLabels;
}>): ReactNode {
  const stats = computeStats(sessions);
  return (
    <Box sx={theme => ({ p: 2, borderRadius: 2, bgcolor: theme.palette.action.hover })}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
        {labels.summaryHeading}
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 1.5 }}>
        <SharedStatCard
          icon={<CalendarMonthOutlined fontSize="small" />}
          value={String(stats.total)}
          label={labels.statTotalSessions}
          color="primary"
        />
        <SharedStatCard
          icon={<CheckCircleOutlined fontSize="small" />}
          value={String(stats.completed)}
          label={labels.statCompletedSessions}
          color="success"
        />
        <SharedStatCard
          icon={<ScheduleOutlined fontSize="small" />}
          value={String(stats.scheduled)}
          label={labels.statUpcomingSessions}
          color="warning"
        />
        <SharedStatCard
          icon={<TrendingUpOutlined fontSize="small" />}
          value={stats.completionRate + "%"}
          label={labels.statCompletionRate}
          color="info"
        />
      </Box>
    </Box>
  );
}
