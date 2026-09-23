"use client";

/**
 * AdminDisputeAnalyticsCard parts — the analytics card's headline stat
 * block, carved out of `AdminDisputeAnalyticsCard` for the function-size
 * tier. The outcome chip breakdown and the loading skeleton live in the
 * sibling `AdminDisputeAnalyticsCard.outcome.tsx`.
 */

import type { SvgIconComponent } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { type StatusTone, TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";

/** One headline stat: a tone-painted value block (count over its label). */
export function StatBlock({
  value,
  label,
  tone,
  icon: Icon,
  testid,
}: Readonly<{
  value: number;
  label: string;
  tone: StatusTone;
  icon: SvgIconComponent;
  testid: string;
}>): ReactNode {
  const toneColors = TONE_COLORS[tone] ?? TONE_COLORS.info;
  return (
    <Stack
      direction="row"
      data-testid={testid}
      sx={theme => ({
        gap: 1.5,
        alignItems: "center",
        px: 2,
        py: 1.5,
        borderRadius: 2,
        bgcolor: toneColors.bg(theme.palette),
        color: toneColors.fg(theme.palette),
        minWidth: 160,
      })}
    >
      <Icon fontSize="small" />
      <Stack sx={{ minWidth: 0 }}>
        <Typography variant="h6" component="p" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
          {value}
        </Typography>
        <Typography variant="caption" sx={{ lineHeight: 1.3 }}>
          {label}
        </Typography>
      </Stack>
    </Stack>
  );
}
