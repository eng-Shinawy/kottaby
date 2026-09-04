import type { SxProps, Theme } from "@mui/material/styles";
import type { ApiStatusKind } from "@/frontend/components/useApiStatusPolling";

/**
 * ApiStatusIndicator styles — palette vars / `color-mix()` over theme tokens
 * only (hairline white borders follow the SiteFooter social-icon precedent),
 * full pill radius, letter-spaced micro-label, RTL-safe (gap/flex, no
 * directional margins).
 *
 * Accessibility: all motion is gated behind `prefers-reduced-motion:
 * no-preference`. Invisible ::after padding lifts the pointer target to ≥44px
 * without inflating the visual pill.
 */

/** Static success/degraded glow radius on the status dot. */
const DOT_GLOW_PX = 6;
/** Soft ring spread used by the "checking" pulse keyframes. */
const PULSE_SPREAD_PX = 7;

/** Dot fill per state — success/warning tokens for live states, neutral while checking. */
const DOT_COLOR_VARS: Record<ApiStatusKind, string> = {
  checking: "var(--mui-palette-onPrimary)",
  operational: "var(--mui-palette-success-main)",
  offline: "var(--mui-palette-warning-main)",
};

/** Glow tint for the LIVE states only (checking stays shadow-free/neutral). */
const DOT_GLOW_TINT_VARS: Record<Exclude<ApiStatusKind, "checking">, string> = {
  operational: "var(--mui-palette-success-main)",
  offline: "var(--mui-palette-warning-main)",
};

export function statusChipSx(kind: ApiStatusKind): SxProps<Theme> {
  return theme => ({
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    gap: 1,
    // Fit-content pill even when a parent Stack stretches its items.
    alignSelf: "flex-start",
    minHeight: 28,
    px: 1.5,
    borderRadius: 999,
    cursor: "default",
    // Glassy over-gradient base: translucent navy + blur.
    bgcolor: `color-mix(in srgb, ${theme.palette.primary.light} 16%, transparent)`,
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    border: `1px solid color-mix(in srgb, ${theme.palette.common.white} 14%, transparent)`,
    transition: theme.transitions.create(["background-color", "border-color", "box-shadow"], {
      duration: 250,
      easing: theme.transitions.easing.easeInOut,
    }),
    // Invisible symmetric hit-area expansion: 28px pill + 2×8px ⇒ ≥44px
    // touch target for the tooltip trigger (RTL-safe — inset, not margins).
    "&::after": {
      content: '""',
      position: "absolute",
      inset: -8,
    },
    "&:focus-visible": {
      outline: "2px solid var(--mui-palette-secondary-main)",
      outlineOffset: 2,
    },
    ...(kind === "offline"
      ? { borderColor: `color-mix(in srgb, ${theme.palette.warning.main} 45%, transparent)` }
      : {}),
    // Neutral pulse ring for the checking state only. Declared once here;
    // consumed by the dot under the reduced-motion media gate below.
    "@keyframes apiStatusPulse": {
      "0%": { boxShadow: `0 0 0 0 color-mix(in srgb, var(--mui-palette-onPrimary) 35%, transparent)` },
      "75%": { boxShadow: `0 0 0 ${PULSE_SPREAD_PX}px transparent` },
      "100%": { boxShadow: "0 0 0 0 transparent" },
    },
  });
}

export function statusDotSx(kind: ApiStatusKind): SxProps<Theme> {
  return theme => ({
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: "50%",
    backgroundColor: DOT_COLOR_VARS[kind],
    boxShadow:
      kind === "checking"
        ? "none"
        : `0 0 ${DOT_GLOW_PX}px color-mix(in srgb, ${DOT_GLOW_TINT_VARS[kind]} 60%, transparent)`,
    opacity: kind === "checking" ? 0.85 : 1,
    transition: theme.transitions.create(["background-color", "box-shadow", "opacity"], {
      duration: 250,
      easing: theme.transitions.easing.easeInOut,
    }),
    "@media (prefers-reduced-motion: no-preference)":
      kind === "checking" ? { animation: "apiStatusPulse 1.6s ease-out infinite" } : {},
  });
}

export const statusLabelSx: SxProps<Theme> = {
  // 12px floor — sub-12px micro-type fails contrast/readability checks.
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.14em",
  lineHeight: 1,
  opacity: 0.95,
};

export const versionLabelSx: SxProps<Theme> = {
  fontFamily: "var(--font-inter), monospace",
  fontSize: 12,
  lineHeight: 1,
  opacity: 0.6,
  direction: "ltr",
};
