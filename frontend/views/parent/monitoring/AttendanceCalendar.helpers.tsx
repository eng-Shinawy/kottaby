"use client";

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { CalendarDay } from "@/frontend/views/parent/monitoring/AttendanceCalendar.logic";

function StatusDot({ status }: Readonly<{ status: string }>): ReactNode {
  const key = status.toLowerCase();
  return (
    <Box
      sx={theme => {
        let bgcolor: string = theme.palette.divider;
        if (key === "completed") {
          bgcolor = theme.palette.success.main;
        } else if (key === "started") {
          bgcolor = theme.palette.info.main;
        } else if (key === "scheduled") {
          bgcolor = theme.palette.warning.main;
        } else if (key === "cancelled" || key === "disputed") {
          bgcolor = theme.palette.error.main;
        }
        return { width: 8, height: 8, borderRadius: "50%", bgcolor };
      }}
    />
  );
}

export function CalendarDayCell({ day, index }: Readonly<{ day: CalendarDay; index: number }>): ReactNode {
  return (
    <Box
      key={day.day > 0 ? "cal-day-" + day.day : "cal-empty-" + index}
      sx={theme => ({
        minHeight: 64,
        border: 0.5,
        borderColor: theme.palette.divider,
        padding: 0.5,
        bgcolor: day.day > 0 ? theme.palette.background.default : theme.palette.action.hover,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0.5,
      })}
    >
      {day.day > 0 ? (
        <>
          <Typography variant="caption" sx={theme => ({ fontWeight: 600, color: theme.palette.text.secondary })}>
            {day.day}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", justifyContent: "center", maxWidth: "100%" }}>
            {day.sessions.slice(0, 3).map(s => (
              <StatusDot key={s.id} status={s.status} />
            ))}
            {day.sessions.length > 3 ? (
              <Typography variant="caption" sx={{ fontSize: "0.6rem", fontWeight: 700 }}>
                +{day.sessions.length - 3}
              </Typography>
            ) : null}
          </Stack>
        </>
      ) : null}
    </Box>
  );
}
