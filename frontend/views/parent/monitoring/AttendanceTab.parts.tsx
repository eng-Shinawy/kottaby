"use client";

import {
  CancelOutlined,
  CheckCircleOutlined,
  PlayCircleOutlined,
  ScheduleOutlined,
  WarningAmberOutlined,
} from "@mui/icons-material";
import { Box, Card, Chip, Skeleton, Stack, Typography } from "@mui/material";
import type { ReactElement, ReactNode } from "react";
import type { ParentChildSessionsQuery_parentChildSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import {
  attendanceStatusColor,
  attendanceStatusLabel,
} from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";
import type { ParentMonitoringLabels } from "@/shared/locale/types/parentMonitoring";

const ATTENDANCE_SKELETON_KEYS: readonly string[] = [
  "attendance-skeleton-1",
  "attendance-skeleton-2",
  "attendance-skeleton-3",
];

const STATUS_ICONS: Readonly<Record<string, ReactElement>> = {
  completed: <CheckCircleOutlined fontSize="small" />,
  started: <PlayCircleOutlined fontSize="small" />,
  scheduled: <ScheduleOutlined fontSize="small" />,
  cancelled: <CancelOutlined fontSize="small" />,
  disputed: <WarningAmberOutlined fontSize="small" />,
};

export function AttendanceSkeleton(): ReactNode {
  return (
    <Stack aria-busy="true" data-testid="parent-attendance-loading" sx={{ gap: 2 }}>
      {ATTENDANCE_SKELETON_KEYS.map(key => (
        <Card
          key={key}
          variant="outlined"
          sx={theme => ({
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: 2,
            padding: { xs: 2, sm: 2.5 },
            borderRadius: 2,
            borderColor: theme.palette.border.main,
            borderInlineStart: 4,
            borderInlineStartColor: theme.palette.divider,
          })}
        >
          <Skeleton variant="circular" sx={{ width: 32, height: 32 }} />
          <Stack sx={{ gap: 0.5, flex: 1 }}>
            <Skeleton variant="text" sx={{ fontSize: "1rem", maxWidth: 180 }} />
            <Skeleton variant="rounded" sx={{ height: 24, width: 120, borderRadius: 999 }} />
          </Stack>
        </Card>
      ))}
    </Stack>
  );
}

export function AttendanceRow({
  row,
  labels,
  locale,
}: Readonly<{
  row: ParentChildSessionsQuery_parentChildSessions_items;
  labels: ParentMonitoringLabels;
  locale: string;
}>): ReactNode {
  const dateIso = row.startedAt ?? row.createdAt;
  const colors = attendanceStatusColor(row.status);
  const statusKey = row.status.toLowerCase();
  const icon = STATUS_ICONS[statusKey] ?? <ScheduleOutlined fontSize="small" />;
  // SAME rule as formatApplicantDate's resolveLocaleTag: only exact "en"
  // selects English; UTC components + 24h clock keep digit/clock conventions
  // consistent with the row's date stamp in BOTH locales.
  const timeFormatter = new Intl.DateTimeFormat(locale === "en" ? "en" : "ar", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // The canonical date stamp already carries the start time, so the range
  // line renders ONLY when an end time exists and adds real information
  // (completed rows); start-only rows skip it instead of stuttering "15:00 15:00".
  let timeRange: string | null = null;
  if (row.startedAt !== null && row.endedAt !== null) {
    timeRange = `${timeFormatter.format(new Date(row.startedAt))} – ${timeFormatter.format(new Date(row.endedAt))}`;
  }
  return (
    <Card
      variant="outlined"
      data-testid="parent-attendance-row"
      sx={theme => ({
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 2,
        padding: { xs: 2, sm: 2.5 },
        borderRadius: 2,
        borderColor: theme.palette.border.main,
        borderInlineStart: 4,
        borderInlineStartColor: colors.border,
        transition: theme.transitions.create(["box-shadow", "border-color"], {
          duration: theme.transitions.duration.shorter,
        }),
        "&:hover": { boxShadow: theme.shadows[2], borderColor: colors.border },
      })}
    >
      <Box
        sx={theme => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 36,
          height: 36,
          borderRadius: "50%",
          bgcolor: theme.palette.action.hover,
          color: colors.icon,
          flexShrink: 0,
        })}
      >
        {icon}
      </Box>
      <Stack sx={{ gap: 0.5, flex: 1, minWidth: 0 }}>
        <Typography variant="body2" dir="auto" sx={theme => ({ color: theme.palette.text.secondary })}>
          {formatApplicantDate(dateIso, locale)}
        </Typography>
        {timeRange === null ? null : (
          <Typography variant="caption" dir="ltr" sx={theme => ({ color: theme.palette.text.secondary })}>
            {timeRange}
          </Typography>
        )}
      </Stack>
      <Chip
        size="small"
        label={attendanceStatusLabel(row.status, labels)}
        icon={icon}
        sx={theme => ({
          flexShrink: 0,
          bgcolor: theme.palette.action.selected,
          color: colors.icon,
          "& .MuiChip-icon": { color: colors.icon },
        })}
      />
    </Card>
  );
}
