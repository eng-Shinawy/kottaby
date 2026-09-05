/**
 * Shared MUI `sx` skins for the audit-trail surfaces.
 *
 * Theme-token discipline: every color/shadow resolves through
 * `theme.palette.*` (no hex, no rgb, no string palette access). The card skin
 * is shared by the skeleton, empty-state and results cards; the body-cell
 * skin keeps the trail's hairline separators start-aligned and top-anchored
 * (RTL-safe — no physical margin/padding direction anywhere).
 */

import type { CSSObject, Theme } from "@mui/material/styles";

/** Shared card skin for the results/empty/skeleton surfaces. */
export function surfaceCardSx(theme: Theme): CSSObject {
  return {
    borderRadius: "12px",
    border: `1px solid ${theme.palette.border.light}`,
    boxShadow: theme.palette.shadow.card,
    overflow: "hidden",
    width: "100%",
  };
}

/** Shared body-cell skin: hairline separators, start-aligned, top-anchored. */
export function bodyCellSx(theme: Theme): CSSObject {
  return {
    borderBottom: `1px solid ${theme.palette.border.light}`,
    padding: theme.spacing(1.5, 1),
    textAlign: "start",
    verticalAlign: "top",
  };
}
