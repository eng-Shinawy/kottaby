"use client";

import { Box, Chip, Stack, Typography } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { ParentChildHomeworkQuery_parentChildHomework_items_jadid } from "@/frontend/graphql/generated/gql/graphql";
import { formatSurahJuzRef } from "@/frontend/views/parent/monitoring/parentMonitoringDisplay";

function resolveGradeChipColors(grade: number | null, theme: Theme): { bgcolor: string; fg: string } {
  if (grade === null) {
    return { bgcolor: theme.palette.action.hover, fg: theme.palette.text.secondary };
  }
  if (grade >= 85) {
    return { bgcolor: theme.palette.success.main, fg: theme.palette.success.contrastText };
  }
  if (grade >= 70) {
    return { bgcolor: theme.palette.warning.main, fg: theme.palette.warning.contrastText };
  }
  return { bgcolor: theme.palette.error.main, fg: theme.palette.error.contrastText };
}

export function HomeworkTrackBlock({
  track,
  trackLabel,
  noneLabel,
  columnGradeLabel,
  icon,
  accentColor,
}: Readonly<{
  track: ParentChildHomeworkQuery_parentChildHomework_items_jadid | null;
  trackLabel: string;
  noneLabel: string;
  columnGradeLabel: string;
  icon: ReactNode;
  accentColor: string;
}>): ReactNode {
  if (track?.surahJuz == null) {
    return (
      <Stack
        spacing={1}
        sx={theme => ({
          padding: 1.5,
          borderRadius: 1.5,
          bgcolor: theme.palette.action.hover,
          borderInlineStart: 3,
          borderColor: theme.palette.divider,
        })}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {icon}
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {trackLabel}
          </Typography>
        </Box>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {noneLabel}
        </Typography>
      </Stack>
    );
  }
  const surahJuz = formatSurahJuzRef(track.surahJuz);
  const fromAyah = track.fromAyah ?? "—";
  const toAyah = track.toAyah ?? "—";
  const gradeLabel = track.grade === null ? "—" : String(track.grade);
  return (
    <Stack
      spacing={1}
      sx={theme => ({
        padding: 1.5,
        borderRadius: 1.5,
        bgcolor: theme.palette.action.hover,
        borderInlineStart: 3,
        borderColor: accentColor,
      })}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {icon}
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          {trackLabel}
        </Typography>
      </Box>
      <Typography variant="body2" dir="auto">
        {surahJuz} · {fromAyah}–{toAyah}
      </Typography>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {columnGradeLabel}
        </Typography>
        <Chip
          size="small"
          label={gradeLabel}
          sx={theme => {
            const chipColors = resolveGradeChipColors(track.grade, theme);
            return {
              fontWeight: 700,
              border: "1px solid transparent",
              bgcolor: chipColors.bgcolor,
              color: chipColors.fg,
            };
          }}
        />
      </Box>
    </Stack>
  );
}
