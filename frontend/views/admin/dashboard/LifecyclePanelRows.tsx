"use client";

/**
 * LifecyclePanelRows — the row presentation of the admin cooldown lifecycle
 * rail, extracted from `AdminCooldownLifecyclePanel` (file-size cap):
 * `BucketRow`, one tappable lifecycle bucket. Pure presentation — the tone
 * mapping, palette resolution, and the sx style factories live at module
 * scope so the component itself stays small; copy and destination arrive on
 * the `BucketView` prop, navigation stays an `onOpen` callback.
 *
 * Row discipline (unchanged from the panel): the leading status dot rides
 * ON the rail (lifted above the rail line via a solid card-colored ring),
 * the label carries the count, and the trailing chevron nudges toward the
 * navigation direction on hover. Zero-count rows dim without disabling —
 * the filtered directory's empty state IS the honest destination.
 */

import { BlockOutlined, HourglassTopOutlined, RestartAltOutlined } from "@mui/icons-material";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";
import Typography from "@mui/material/Typography";
import type { ReactNode } from "react";
import type { BucketView, LifecycleBucket } from "@/frontend/views/admin/dashboard/lifecycleBucketViews";

type LifecycleTone = "warning" | "error" | "success";

/** Shared shell for every lifecycle row — one source for the identical
    centering and padding across dot / icon / label / count / chevron. */
const ROW_SHELL = { alignItems: "center", px: 1.5, py: 1.25 } as const;

/** Tone semantics: `warning` for active (directory-chip parity), `error`
    for the urgent expiring-soon slice, `success` for expired (cooled off). */
const TONE_OF = { active: "warning", expiringSoon: "error", expired: "success" } as const;

/** The tone's `main` + soft container tint (icon well) palette colors,
    keyed exhaustively by tone (exhaustive switch — no nested ternaries). */
const TONE_COLORS: Record<LifecycleTone, (theme: Theme) => { readonly main: string; readonly container: string }> = {
  warning: theme => ({ main: theme.palette.warning.main, container: theme.palette.warningContainer }),
  error: theme => ({ main: theme.palette.error.main, container: theme.palette.errorContainer }),
  success: theme => ({ main: theme.palette.success.main, container: theme.palette.successContainer }),
};

/** The bucket's glyph, keyed exhaustively by bucket (no switch to maintain). */
const BUCKET_ICON: Record<LifecycleBucket, ReactNode> = {
  active: <BlockOutlined fontSize="small" />,
  expiringSoon: <HourglassTopOutlined fontSize="small" />,
  expired: <RestartAltOutlined fontSize="small" />,
};

/** Root row surface — full-width tappable button with hover lift (bg tint +
    primary border + chevron nudge), dimmed (but navigable) when empty. */
const rowSxOf =
  (isZero: boolean): SxProps<Theme> =>
  theme => ({
    all: "unset",
    display: "flex",
    width: "100%",
    boxSizing: "border-box",
    gap: 1.5,
    ...ROW_SHELL,
    position: "relative",
    cursor: "pointer",
    borderRadius: 2.5,
    border: "1px solid transparent",
    bgcolor: theme.palette.surfaceContainerLowest,
    opacity: isZero ? 0.62 : 1,
    transition: theme.transitions.create(["background-color", "border-color", "transform", "opacity"], {
      duration: theme.transitions.duration.short,
      easing: theme.transitions.easing.easeOut,
    }),
    "&:hover": {
      bgcolor: theme.palette.surfaceContainerHigh,
      borderColor: theme.palette.primary.main,
      transform: "translateY(-1px)",
      "& .lifecycle-chevron": { transform: "translateX(3px)", color: theme.palette.primary.main },
    },
    "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
  });

/** The status dot — centered ON the rail (insetInlineStart aligns it with
    the rail's line; the ring masks the rail behind the dot). The
    expiring-soon dot PULSES (reduced-motion gated), echoing the
    live-restriction pulse of the directory's active chip. */
const dotSxOf =
  (bucket: LifecycleBucket): SxProps<Theme> =>
  theme => ({
    position: "relative",
    zIndex: 1,
    flexShrink: 0,
    width: 10,
    height: 10,
    borderRadius: "50%",
    bgcolor: TONE_COLORS[TONE_OF[bucket]](theme).main,
    boxShadow: `0 0 0 4px ${theme.palette.surfaceContainerLow}`,
    ...(bucket === "expiringSoon"
      ? {
          "@media (prefers-reduced-motion: no-preference)": {
            animation: "cooldown-expiring-pulse 2.4s ease-in-out infinite",
            "@keyframes cooldown-expiring-pulse": {
              "0%, 100%": { opacity: 1 },
              "50%": { opacity: 0.35 },
            },
          },
        }
      : {}),
  });

/** Tone-tinted icon chip — the bucket's glyph in a soft tinted well. */
const iconChipSxOf =
  (bucket: LifecycleBucket): SxProps<Theme> =>
  theme => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 2,
    flexShrink: 0,
    color: TONE_COLORS[TONE_OF[bucket]](theme).main,
    bgcolor: TONE_COLORS[TONE_OF[bucket]](theme).container,
  });

/** The bucket label — one ellipsized 600-weight line. */
const labelSx: SxProps<Theme> = theme => ({
  display: "block",
  fontWeight: 600,
  color: theme.palette.text.primary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/** The count numeral — tabular (never jitters), dimmed when the bucket is empty. */
const countSxOf =
  (isZero: boolean): SxProps<Theme> =>
  theme => ({
    fontWeight: 700,
    fontSize: "1.05rem",
    color: isZero ? theme.palette.text.disabled : theme.palette.text.primary,
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  });

/** The chevron — RTL-aware: it always points toward "forward". */
const chevronSx: SxProps<Theme> = theme => ({
  flexShrink: 0,
  color: theme.palette.text.secondary,
  fontSize: 18,
  display: "flex",
  alignItems: "center",
  transition: theme.transitions.create(["transform", "color"], {
    duration: theme.transitions.duration.short,
  }),
  transform: theme.direction === "rtl" ? "scaleX(-1)" : "none",
});

/**
 * One tappable lifecycle bucket row — see the module doc for the dot / chip /
 * chevron discipline. Renders as a real `button` (keyboard operable) with
 * the row's aria label; the count is announced via the label copy.
 */
export function BucketRow({
  view,
  onOpen,
}: Readonly<{ readonly view: BucketView; readonly onOpen: (href: string) => void }>): ReactNode {
  const isZero = view.count === 0;

  return (
    <Box
      component="button"
      type="button"
      onClick={() => onOpen(view.href)}
      aria-label={view.ariaLabel}
      sx={rowSxOf(isZero)}
    >
      <Box aria-hidden="true" sx={dotSxOf(view.bucket)} />
      <Box aria-hidden="true" sx={iconChipSxOf(view.bucket)}>
        {BUCKET_ICON[view.bucket]}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center" }}>
        <Typography variant="body2" component="span" sx={labelSx}>
          {view.label}
        </Typography>
      </Box>
      <Typography component="span" sx={countSxOf(isZero)}>
        {view.count}
      </Typography>
      <Box aria-hidden="true" className="lifecycle-chevron" sx={chevronSx}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Box>
    </Box>
  );
}
