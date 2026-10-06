"use client";

/**
 * TeacherDirectoryCardChipSection — one labeled outlined-chip section of
 * the student teacher card (a muted caption over a wrapped chip row),
 * extracted so the card file stays under the 150-line convention.
 * Rendered only when the label list is non-empty; the chips are the
 * refined tight-padding outlined variant (outlineVariant border,
 * onSurfaceVariant text) shared by the recitation + fluency sections.
 * RTL-safe: the row wraps via flex-wrap + logical gap only.
 */

import { Chip, Stack, Typography } from "@mui/material";
import type { ReactElement } from "react";

interface CardChipSectionProps {
  /** The muted section caption. */
  readonly caption: string;
  /** The pre-resolved chip labels (already localized by the caller). */
  readonly labels: readonly string[];
}

/** One labeled outlined-chip section (renders nothing when the list is empty). */
export function CardChipSection(props: Readonly<CardChipSectionProps>): ReactElement | null {
  if (props.labels.length === 0) {
    return null;
  }
  return (
    <Stack sx={{ gap: 0.75 }}>
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
        {props.caption}
      </Typography>
      <Stack sx={{ flexDirection: "row", flexWrap: "wrap", gap: 0.75 }}>
        {props.labels.map(label => (
          <Chip
            key={label}
            label={label}
            size="small"
            variant="outlined"
            sx={theme => ({
              bgcolor: "transparent",
              borderColor: theme.palette.outlineVariant,
              color: theme.palette.onSurfaceVariant,
              borderRadius: 2,
              // Tighter chip padding — profile chips are scan targets, not
              // interactive targets, so the compact rhythm reads cleaner.
              "& .MuiChip-label": { px: 1 },
            })}
          />
        ))}
      </Stack>
    </Stack>
  );
}
