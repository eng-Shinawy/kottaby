import type { CSSObject, Theme } from "@mui/material/styles";

/**
 * Dark-mode contrast lift for the notifications view's outlined primary
 * buttons (QA round 2, axe serious finding): the default outlined variant
 * paints `primary.main` (#3D6BA0 in the dark palette) text and border on the
 * dark feed canvas (`background.default` #0A1422) at ~3.3:1 — below the
 * 4.5:1 WCAG AA text threshold.
 *
 * `primary.light` (#5A8BC5) keeps the same midnight-blue hue family while
 * clearing AA on every dark surface the view paints on (5.2:1 on
 * `background.default`, 4.7:1 on `background.paper`, ≥4.5:1 over the
 * `action.selected` unread-row tint and the hover wash). Light mode is
 * untouched — its `primary.main` (#1E3A5F) already clears AA by a wide
 * margin, so the helper returns an empty object there.
 *
 * Direct `color`/`borderColor` declarations (not the `--variant-outlined*`
 * custom properties) so the lift holds in EVERY state — MUI's hover rule
 * only re-assigns the vars, which these declarations supersede.
 *
 * Kept in a standalone module (the `focusRing.ts` precedent) so component
 * files stay react-refresh/only-export-components clean. The values are
 * theme-palette token references (`var(--mui-palette-primary-light)` under
 * the cssVars theme), never hardcoded colors.
 *
 * @returns sx fragment — spread it AFTER `focusVisibleRingSx` in an
 * `sx={theme => …}` callback.
 */
export function darkOutlinedContrastSx(theme: Theme): CSSObject {
  if (theme.palette.mode !== "dark") {
    return {};
  }
  return {
    color: theme.palette.primary.light,
    borderColor: theme.palette.primary.light,
    // The sx lift would otherwise win over MUI's `.Mui-disabled` rule and a
    // disabled outlined button would look enabled in dark mode — restore the
    // theme's disabled tokens for that state.
    "&.Mui-disabled": {
      color: theme.palette.action.disabled,
      borderColor: theme.palette.action.disabledBackground,
    },
  };
}
