"use client";

/**
 * DirectoryToneChip — the small tonal pill the directory row cells share
 * (role pill, per-role status/details chips). Painted from a M3
 * container/`on<Color>Container` pair via `directoryToneColors`.
 */

import { Chip } from "@mui/material";
import type { ReactNode } from "react";
import { type DirectoryTone, toneColors } from "@/frontend/views/admin/users/utils";

interface TonalChipProps {
  readonly tone: DirectoryTone;
  readonly label: string;
}

/** Small pill chip painted from a M3 container/`on<Color>Container` pair. */
export function TonalChip({ tone, label }: TonalChipProps): ReactNode {
  return (
    <Chip
      size="small"
      label={label}
      sx={theme => {
        const colors = toneColors(theme, tone);
        return {
          height: 26,
          borderRadius: "999px",
          fontWeight: 600,
          bgcolor: colors.bg,
          color: colors.fg,
        };
      }}
    />
  );
}
