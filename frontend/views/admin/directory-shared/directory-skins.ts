/**
 * Shared MUI `sx` skins for the admin directory scaffolding primitives.
 *
 * Theme-token discipline: every color/shadow resolves through
 * `theme.palette.*` (no hex, no rgb, no string palette access). Each skin is
 * the extracted chrome recipe of the old inline `sx` objects — the objects
 * moved VERBATIM, only the wrapping changed, so the rendered output of every
 * consumer is unchanged. Returning the MUI callback form keeps breakpoint /
 * shorthand keys fully typed.
 */

import type { Theme } from "@mui/material/styles";
import type { SystemStyleObject } from "@mui/system";

/** A theme-callback skin — usable directly as `sx` or spread into a larger object. */
type DirectorySkin = (theme: Theme) => SystemStyleObject<Theme>;

/** Desktop (≥`md`) directory-table card: hairline border, card shadow, hidden below `md`. */
export function directoryTableCardSx(): DirectorySkin {
  return theme => ({
    display: { xs: "none", md: "block" },
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
    overflow: "hidden",
  });
}

/** Standard directory panel card: radius 12, hairline border, card shadow. */
export function directoryPanelCardSx(): DirectorySkin {
  return theme => ({
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
  });
}

/** Mobile skeleton-card chrome — the panel card skin at a fixed 132px height with 16px padding. */
export function directorySkeletonCardSx(): DirectorySkin {
  return theme => ({
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
    p: 2,
    height: 132,
  });
}
