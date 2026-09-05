/**
 * directoryToneColors — the tone lane → M3 token triple lookup shared by the
 * directory cell components (`DirectoryToneChip`, `DirectoryGovernanceLabel`).
 *
 * Every lane maps to a `*Container`/`on<Color>Container` pair defined in BOTH
 * `lightPalette.ts` and `darkPalette.ts`; the neutral lane uses the
 * documented surface pair; the dot tracks the matching `.main` family.
 *
 * This is a non-component module on purpose: the component files stay
 * within `react-refresh/only-export-components` by sourcing the lookup
 * from here.
 */

import type { Theme } from "@mui/material/styles";
import type { DirectoryTone } from "@/frontend/views/admin/users/utils";

export interface ToneColors {
  readonly bg: string;
  readonly fg: string;
  readonly dot: string;
}

/** Tone lane → M3 token triple. */
export function toneColors(theme: Theme, tone: DirectoryTone): ToneColors {
  switch (tone) {
    case "error":
      return { bg: theme.palette.errorContainer, fg: theme.palette.onErrorContainer, dot: theme.palette.error.main };
    case "warning":
      return {
        bg: theme.palette.warningContainer,
        fg: theme.palette.onWarningContainer,
        dot: theme.palette.warning.main,
      };
    case "success":
      return {
        bg: theme.palette.successContainer,
        fg: theme.palette.onSuccessContainer,
        dot: theme.palette.success.main,
      };
    case "primary":
      return {
        bg: theme.palette.primaryContainer,
        fg: theme.palette.onPrimaryContainer,
        dot: theme.palette.primary.main,
      };
    case "secondary":
      return {
        bg: theme.palette.secondaryContainer,
        fg: theme.palette.onSecondaryContainer,
        dot: theme.palette.secondary.main,
      };
    default:
      return {
        bg: theme.palette.surfaceContainerHighest,
        fg: theme.palette.onSurfaceVariant,
        dot: theme.palette.onSurfaceVariant,
      };
  }
}
