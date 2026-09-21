"use client";

import { CalendarMonthOutlined as CalendarIcon } from "@mui/icons-material";
import { Alert, AlertTitle, Box, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { DashboardStatCard } from "@/frontend/views/dashboard/home/DashboardStatCard";
import { ScheduleDayCard } from "@/frontend/views/teacher/schedule/ScheduleDayCard";
import { ScheduleLoadingSkeleton } from "@/frontend/views/teacher/schedule/ScheduleLoadingSkeleton";
import { type ScheduleDay, utcMidnight } from "@/frontend/views/teacher/schedule/scheduleWeek.helpers";
import type { ScheduleLabels } from "@/shared/locale/types/schedule";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

interface ScheduleBodyProps {
  readonly loading: boolean;
  readonly error: unknown;
  /** True when the fetched feed carries zero sessions AT ALL (the generic empty state; a merely empty WEEK still renders the grid). */
  readonly empty: boolean;
  readonly statCards: readonly {
    readonly label: string;
    readonly value: string;
    readonly Icon: typeof CalendarIcon;
  }[];
  readonly days: readonly ScheduleDay[];
  readonly locale: "en" | "ar";
  readonly scheduleT: ScheduleLabels;
  readonly sessionsT: SessionsLabels;
  readonly onOpenSession: () => void;
}

/**
 * The swapping body below the always-on chrome — the branch matrix as
 * straight-line returns (skeleton / error alert / generic empty / summary
 * strip + seven day cards), extracted from the container's JSX so the
 * dispatch stays a flat statement chain.
 */
export function ScheduleBody({
  loading,
  error,
  empty,
  statCards,
  days,
  locale,
  scheduleT,
  sessionsT,
  onOpenSession,
}: Readonly<ScheduleBodyProps>): ReactNode {
  if (loading) {
    return <ScheduleLoadingSkeleton loadingLabel={scheduleT.loadingLabel} />;
  }
  if (error) {
    return (
      <Alert severity="error" sx={{ borderRadius: 3 }}>
        <AlertTitle sx={{ fontWeight: 700 }}>{scheduleT.errorTitle}</AlertTitle>
        {scheduleT.errorBody}
      </Alert>
    );
  }
  if (empty) {
    return (
      <EmptyState
        title={scheduleT.emptyWeekTitle}
        body={scheduleT.emptyWeekBody}
        onManage={onOpenSession}
        manageLabel={scheduleT.manageSessionsCta}
      />
    );
  }
  return (
    <>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)" },
        }}
      >
        {statCards.map(card => (
          <DashboardStatCard key={card.label} stat={{ label: card.label, value: card.value, Icon: card.Icon }} />
        ))}
      </Box>
      <Box
        sx={{
          display: "grid",
          gap: 1.5,
          gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(4, 1fr)", lg: "repeat(7, 1fr)" },
          alignItems: "start",
        }}
      >
        {days.map(day => (
          <ScheduleDayCard
            key={day.startsAt.toISOString()}
            day={day}
            locale={locale}
            today={utcMidnight(new Date())}
            scheduleT={scheduleT}
            sessionsT={sessionsT}
            onOpenSession={onOpenSession}
          />
        ))}
      </Box>
    </>
  );
}

/** Empty state — a free week (or an empty teaching account) rendered kindly. */
function EmptyState({
  title,
  body,
  onManage,
  manageLabel,
}: Readonly<{ title: string; body: string; onManage: () => void; manageLabel: string }>): ReactNode {
  return (
    <Stack
      sx={theme => ({
        alignItems: "center",
        gap: 1.5,
        py: 8,
        px: 2,
        borderRadius: 3,
        border: "1px dashed",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        textAlign: "center",
      })}
    >
      <CalendarIcon sx={theme => ({ fontSize: 48, color: theme.palette.onSurfaceVariant })} />
      <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        {title}
      </Typography>
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary, maxWidth: 480 })}>
        {body}
      </Typography>
      <Button variant="contained" onClick={onManage}>
        {manageLabel}
      </Button>
    </Stack>
  );
}
