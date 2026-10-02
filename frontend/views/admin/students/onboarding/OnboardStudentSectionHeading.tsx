"use client";

/**
 * OnboardStudentSectionHeading — the onboarding dialog's shared section
 * caption row: the section's step index (a quiet primary-tinted disc,
 * decorative), the section glyph, the caption text, and a hairline
 * divider filling the remaining row — the four sections read as one
 * continuous flow instead of four loose captions. The index never
 * reaches the accessibility tree (the heading text is the name).
 */

import { Box, Divider, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";

/** The step-index disc — quiet, tabular, decorative. */
const STEP_BADGE_SX: SxProps<Theme> = theme => ({
  width: 20,
  height: 20,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  bgcolor: `color-mix(in srgb, ${theme.palette.primary.main} 12%, transparent)`,
  color: theme.palette.primary.main,
  fontSize: "0.6875rem",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
});

export interface OnboardStudentSectionHeadingProps {
  /** The section's one-based step index (decorative). */
  readonly index: number;
  /** The section glyph (pre-styled by the caller — it keeps its icon single-sourced). */
  readonly icon: ReactNode;
  /** The caption text. */
  readonly title: string;
}

export function OnboardStudentSectionHeading({ index, icon, title }: OnboardStudentSectionHeadingProps): ReactNode {
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
      <Box component="span" aria-hidden sx={STEP_BADGE_SX}>
        {index}
      </Box>
      {icon}
      <Typography variant="subtitle2" component="h3" sx={{ fontWeight: 600 }}>
        {title}
      </Typography>
      <Divider sx={{ flex: 1, marginInlineStart: 1 }} />
    </Stack>
  );
}
