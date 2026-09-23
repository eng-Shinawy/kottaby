"use client";

import { ChevronLeftOutlined, ChevronRightOutlined } from "@mui/icons-material";
import { Box, IconButton, Tooltip, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { ParentChildSessionsQuery_parentChildSessions_items } from "@/frontend/graphql/generated/gql/graphql";
import { CalendarDayCell } from "@/frontend/views/parent/monitoring/AttendanceCalendar.helpers";
import {
  buildCalendarGrid,
  type CalendarMonth,
  formatMonthLabel,
  isCurrentMonth,
  shiftMonth,
} from "@/frontend/views/parent/monitoring/AttendanceCalendar.logic";
import { Common, useAppTranslation } from "@/shared/locale";

const WEEKDAY_LABELS_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LABELS_AR = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];
function currentMonth(): CalendarMonth {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() };
}

export function AttendanceCalendar({
  sessions,
  locale,
}: Readonly<{ sessions: readonly ParentChildSessionsQuery_parentChildSessions_items[]; locale: string }>): ReactNode {
  const commonT = useAppTranslation(Common);
  const weekdays = locale === "ar" ? WEEKDAY_LABELS_AR : WEEKDAY_LABELS_EN;
  const [viewMonth, setViewMonth] = useState<CalendarMonth>(currentMonth);
  const days = buildCalendarGrid(sessions, viewMonth);
  const monthLabel = formatMonthLabel(viewMonth, locale);
  const canGoForward = !isCurrentMonth(viewMonth);
  return (
    <Box sx={theme => ({ border: 1, borderColor: theme.palette.divider, borderRadius: 2, overflow: "hidden" })}>
      <Box
        sx={theme => ({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          bgcolor: theme.palette.primary.main,
          color: theme.palette.primary.contrastText,
          py: 0.5,
          px: 1,
        })}
      >
        <Tooltip title={commonT.previousPage}>
          <span>
            <IconButton
              size="small"
              aria-label={commonT.previousPage}
              onClick={() => {
                setViewMonth(prev => shiftMonth(prev, -1));
              }}
              sx={theme => ({
                color: theme.palette.primary.contrastText,
                ...focusVisibleRingSx,
              })}
            >
              <ChevronLeftOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {monthLabel}
        </Typography>
        <Tooltip title={commonT.nextPage}>
          <span>
            <IconButton
              size="small"
              aria-label={commonT.nextPage}
              onClick={() => {
                if (canGoForward) {
                  setViewMonth(prev => shiftMonth(prev, 1));
                }
              }}
              disabled={!canGoForward}
              sx={theme => ({
                color: theme.palette.primary.contrastText,
                "&.Mui-disabled": { color: theme.palette.primary.contrastText, opacity: 0.3 },
                ...focusVisibleRingSx,
              })}
            >
              <ChevronRightOutlined fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
      <Box
        sx={theme => ({
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: 1,
          borderColor: theme.palette.divider,
        })}
      >
        {weekdays.map(day => (
          <Box key={day} sx={theme => ({ py: 1, textAlign: "center", bgcolor: theme.palette.action.hover })}>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {day}
            </Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {days.map((day, index) => (
          <CalendarDayCell key={day.day > 0 ? "cal-day-" + day.day : "cal-empty-" + index} day={day} index={index} />
        ))}
      </Box>
    </Box>
  );
}
