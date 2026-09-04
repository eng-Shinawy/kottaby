import type { Components, Theme } from "@mui/material/styles";

/**
 * Disabled affordance for every ButtonBase-derived control (Button,
 * IconButton, ToggleButton, …): MUI already greys the disabled state via
 * `palette.action.disabled`, but ButtonBase pins `pointer-events: none`
 * there, so the browser never shows an "inert" cursor — a disabled control
 * reads as momentarily active. Re-enabling pointer events (native `<button
 * disabled>` still swallows clicks/actives, so behaviour is unchanged) lets
 * `cursor: not-allowed` render, making the disabled state unmistakable.
 */
export const getMuiButtonBase = (): Components<Omit<Theme, "components">>["MuiButtonBase"] => ({
  styleOverrides: {
    root: {
      "&.Mui-disabled": {
        pointerEvents: "auto",
        cursor: "not-allowed",
      },
      // Hover feedback stays dead on inert controls: restoring pointer events
      // (above) would otherwise let any `&:hover` background repaint a disabled
      // control as interactive. This (0,3,0)-specificity rule out-ranks every
      // plain `&:hover` (0,2,0) from component styles; per-component rules with
      // equal-or-higher specificity (e.g. Switch's `&.Mui-checked:hover`) get
      // their own suppression in their override files.
      "&.Mui-disabled:hover": {
        backgroundColor: "transparent",
      },
    },
  },
});

/**
 * IconButton sizing + disabled affordance:
 * - Non-small IconButtons get a 44px box floor (WCAG 2.5.5 touch target —
 *   MUI's default medium box is 40px; `size="large"` at 48px already clears
 *   the floor). `size="small"` stays compact for tight slots (input
 *   adornments pair it with the padding/negative-margin trick per call-site
 *   to reach ≥44px without inflating the row).
 * - Disabled hover feedback is suppressed: restoring pointer events (above)
 *   would otherwise re-paint MUI's `--IconButton-hoverBg` tint on an inert
 *   control.
 */
export const getMuiIconButton = (): Components<Omit<Theme, "components">>["MuiIconButton"] => ({
  styleOverrides: {
    root: ({ ownerState }) => ({
      ...(ownerState.size !== "small" && { minWidth: 44, minHeight: 44 }),
      "&.Mui-disabled:hover": {
        backgroundColor: "transparent",
      },
    }),
  },
});
