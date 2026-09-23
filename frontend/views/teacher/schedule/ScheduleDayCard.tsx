"use client";

import { Box, Chip, Divider, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { STATUS_ICON, STATUS_LABEL_KEY, STATUS_TONE } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { ScheduleSessionChip } from "@/frontend/views/teacher/schedule/ScheduleSessionChip";
import {
  clockStamp,
  dayMonthStamp,
  isSameUtcDay,
  isWeekendDay,
  type ScheduleDay,
  sessionAnchorIso,
  weekdayName,
} from "@/frontend/views/teacher/schedule/scheduleWeek.helpers";
import type { ScheduleLabels } from "@/shared/locale/types/schedule";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * One day column of the schedule grid: the weekday header + honest count
 * line, then the day's anchored session chips (chronological), or a quiet
 * dashed slot when the day is free.
 *
 * TODAY ring — the matching column gets a primary ring + soft primary wash
 * and the localized `todayChip`, so "where am I" survives a glance.
 *
 * WEEKEND wash — the LOCALE-OWNED weekend columns (Egyptian Fri+Sat under
 * `ar`, international Sat+Sun under `en` — `WEEKEND_DAYS` in the helpers)
 * carry a subtle neutral tint (a ~4% `text.primary` wash — theme tokens
 * only) distinguishing rest days without a hard border. NOTE: MUI's
 * `alpha()` REPLACES an existing alpha channel rather than multiplying
 * it, so translucent palette tokens (`action.hover` = rgba(0,0,0,0.04))
 * must never be fed back into `alpha()` — the wash is derived from the
 * OPAQUE `text.primary` token instead, which also adapts to dark mode.
 *
 * Session copy resolves through the SHARED session presentation tables
 * (`STATUS_LABEL_KEY` / `STATUS_TONE` / `STATUS_ICON`) — the grid's status
 * vocabulary is the LIST's vocabulary by construction.
 */

interface ScheduleDayCardProps {
  readonly day: ScheduleDay;
  readonly locale: "en" | "ar";
  /** The UTC-midnight instant considered "today". */
  readonly today: Date;
  readonly scheduleT: ScheduleLabels;
  readonly sessionsT: Pick<
    SessionsLabels,
    "statusScheduled" | "statusStarted" | "statusCompleted" | "statusCancelled" | "statusDisputed"
  >;
  /** Navigate to the sessions management list. */
  readonly onOpenSession: () => void;
}

export function ScheduleDayCard({
  day,
  locale,
  today,
  scheduleT,
  sessionsT,
  onOpenSession,
}: Readonly<ScheduleDayCardProps>): ReactNode {
  const isToday = isSameUtcDay(day.startsAt, today);
  const isWeekend = isWeekendDay(day.startsAt, locale);

  return (
    <Paper
      elevation={0}
      component="fieldset"
      aria-label={scheduleT.dayColumnAria(weekdayName(day.startsAt, locale), dayMonthStamp(day.startsAt, locale))}
      sx={theme => ({
        p: 1.5,
        margin: 0,
        borderRadius: 3,
        border: "1px solid",
        borderColor: isToday ? theme.palette.primary.main : theme.palette.outlineVariant,
        borderWidth: isToday ? 2 : 1,
        bgcolor: isToday ? alpha(theme.palette.primary.main, 0.04) : theme.palette.surfaceContainerLowest,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        minWidth: 0,
        transition: theme.transitions.create(["border-color", "box-shadow", "background-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[1],
        },
      })}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" sx={theme => ({ fontWeight: 700, color: theme.palette.text.primary })}>
            {weekdayName(day.startsAt, locale)}
          </Typography>
          <Typography
            variant="caption"
            sx={theme => ({ color: theme.palette.text.secondary, fontVariantNumeric: "tabular-nums" })}
          >
            {dayMonthStamp(day.startsAt, locale)} · {scheduleT.dayCountLine(day.sessions.length)}
          </Typography>
        </Box>
        {isToday ? (
          <Chip
            size="small"
            label={scheduleT.todayChip}
            sx={theme => ({
              height: 22,
              fontSize: 11,
              fontWeight: 700,
              bgcolor: theme.palette.primaryContainer,
              color: theme.palette.onPrimaryContainer,
            })}
          />
        ) : null}
      </Stack>
      <Divider
        sx={theme => ({
          borderColor: isToday ? alpha(theme.palette.primary.main, 0.4) : theme.palette.outlineVariant,
        })}
      />
      {day.sessions.length === 0 ? (
        <FreeDaySlot weekend={isWeekend} />
      ) : (
        <Stack spacing={1} sx={{ minWidth: 0 }}>
          {day.sessions.map(session => {
            const anchorIso = sessionAnchorIso(session);
            const statusLabel = sessionsT[STATUS_LABEL_KEY[session.status]];
            return (
              <ScheduleSessionChip
                key={session.id}
                session={{ id: session.id, status: session.status, fee: session.fee }}
                statusLabel={statusLabel}
                tone={STATUS_TONE[session.status]}
                StatusIcon={STATUS_ICON[session.status]}
                chipAria={scheduleT.sessionChipAria(statusLabel, clockStamp(anchorIso, locale))}
                timeLabel={clockStamp(anchorIso, locale)}
                onOpen={onOpenSession}
              />
            );
          })}
        </Stack>
      )}
    </Paper>
  );
}

/** The quiet dashed slot rendered on a day with zero sessions. */
function FreeDaySlot({ weekend }: { readonly weekend: boolean }): ReactNode {
  return (
    <Box
      sx={theme => ({
        borderRadius: 2,
        border: "1px dashed",
        borderColor: theme.palette.outlineVariant,
        px: 1,
        py: 1.5,
        textAlign: "center",
        bgcolor: weekend ? alpha(theme.palette.text.primary, 0.04) : theme.palette.surfaceContainerLow,
      })}
    >
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.disabled })}>
        {NO_SESSIONS_MARK}
      </Typography>
    </Box>
  );
}

const NO_SESSIONS_MARK = "—";
