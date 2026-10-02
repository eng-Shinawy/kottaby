"use client";

/**
 * CountryDistributionRows — the row presentation of the admin dashboard's
 * country distribution panel, extracted from `AdminCountryDistributionPanel`
 * (file-size cap): `CountryDistributionRow`, one tappable country row. Pure
 * presentation — copy, flag, share, and destination arrive on the
 * `CountryRowView` prop; navigation stays an `onOpen` callback.
 *
 * Row anatomy (the panel-family language, extended with the SHARE BAR):
 *  - leading flag avatar (the facet-chip family's 30px flag well);
 *  - a two-line column: the country label over a PROPORTIONAL SHARE BAR
 *    (width = the bucket's share of the whole accounted active population —
 *    the at-a-glance distribution read the directory's chip row does not
 *    give), with the whole-percent figure pinned to the bar's inline end;
 *  - a trailing tabular-nums count pill (the facet chip's pill anatomy);
 *  - a chevron that nudges toward "forward" on hover — and stays mirrored
 *    under RTL while doing so (the nudge composes with the mirror instead
 *    of replacing it).
 *
 * Hover discipline mirrors the lifecycle rows: bg tint + primary border +
 * translateY(-1px) lift, pure `sx` transitions, focus-visible ring. The
 * percent column is a FIXED 3ch box so every row's bar track is the same
 * width — cross-row bar comparison stays honest.
 */

import { Avatar, Box, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { CountryRowView } from "@/frontend/views/admin/dashboard/countryDistributionViews";

/** Shared row shell — one source for the identical padding across rows. */
const ROW_SHELL = { alignItems: "center", px: 1.5, py: 1.25, gap: 1.5 } as const;

/** Root row surface — full-width tappable button with the hover lift. */
const rowSx: SxProps<Theme> = theme => ({
  all: "unset",
  display: "flex",
  width: "100%",
  boxSizing: "border-box",
  ...ROW_SHELL,
  cursor: "pointer",
  borderRadius: 2.5,
  border: "1px solid transparent",
  bgcolor: theme.palette.surfaceContainerLowest,
  transition: theme.transitions.create(["background-color", "border-color", "transform"], {
    duration: theme.transitions.duration.short,
    easing: theme.transitions.easing.easeOut,
  }),
  "&:hover": {
    bgcolor: theme.palette.surfaceContainerHigh,
    borderColor: theme.palette.primary.main,
    transform: "translateY(-1px)",
    "& .country-chevron": { color: theme.palette.primary.main },
    "& .country-chevron-box": {
      transform: theme.direction === "rtl" ? "scaleX(-1) translateX(3px)" : "translateX(3px)",
    },
  },
  "&:focus-visible": { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
});

/** The flag well — transparent + outlined so it sits on both rest and hover tints. */
const flagSx: SxProps<Theme> = theme => ({
  width: 30,
  height: 30,
  fontSize: "1.05rem",
  lineHeight: 1,
  flexShrink: 0,
  bgcolor: "transparent",
  border: `1px solid ${theme.palette.outlineVariant}`,
});

/** The label — one ellipsized 600-weight line that owns the row's free
    width (flex: 1 + minWidth: 0 — long locale names never wrap the row). */
const labelSx: SxProps<Theme> = theme => ({
  display: "block",
  fontWeight: 600,
  color: theme.palette.text.primary,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  flex: 1,
  minWidth: 0,
});

/** The count pill — the facet chip's pill anatomy, restyled for the row surface. */
const countPillSx: SxProps<Theme> = theme => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 22,
  px: 0.75,
  height: 20,
  borderRadius: 10,
  flexShrink: 0,
  fontSize: "0.75rem",
  fontWeight: 700,
  fontVariantNumeric: "tabular-nums",
  bgcolor: theme.palette.surfaceContainerHighest,
  color: theme.palette.text.secondary,
});

/** The share bar — a 4px rounded track (outlineVariant) with a primary fill
    whose width is the bucket's share. A plain div fills from the inline
    start edge, so the fill MIRRORS under RTL with zero extra code. */
const barTrackSx: SxProps<Theme> = theme => ({
  flex: 1,
  height: 4,
  borderRadius: 999,
  overflow: "hidden",
  bgcolor: theme.palette.outlineVariant,
  opacity: 0.55,
});

const barFillSx =
  (percent: number): SxProps<Theme> =>
  theme => ({
    width: `${percent}%`,
    height: "100%",
    borderRadius: 999,
    bgcolor: theme.palette.primary.main,
    transition: theme.transitions.create(["width"], { duration: theme.transitions.duration.standard }),
  });

/** The percent column — FIXED 3ch so every row's bar track is equally wide
    (cross-row bar comparison stays honest); tabular-nums, no jitter. */
const percentSx: SxProps<Theme> = theme => ({
  width: "3ch",
  textAlign: "end",
  flexShrink: 0,
  fontSize: 11,
  fontWeight: 600,
  fontVariantNumeric: "tabular-nums",
  color: theme.palette.text.secondary,
});

/** The chevron — mirrored under RTL; the hover nudge COMPOSES with the
    mirror (scaleX(-1) translateX(3px) nudges visually left = forward). */
const chevronSx: SxProps<Theme> = theme => ({
  flexShrink: 0,
  color: theme.palette.text.secondary,
  display: "flex",
  alignItems: "center",
  transform: theme.direction === "rtl" ? "scaleX(-1)" : "none",
  transition: theme.transitions.create(["transform", "color"], {
    duration: theme.transitions.duration.short,
  }),
});

/**
 * One tappable country row — renders as a real `button` (keyboard operable)
 * with the row's aria label; the bar line is decorative (`aria-hidden` — the
 * percent is visual sugar, the announced facts are the label and the count).
 */
export function CountryDistributionRow({
  view,
  onOpen,
}: Readonly<{ readonly view: CountryRowView; readonly onOpen: (href: string) => void }>): ReactNode {
  return (
    <Box component="button" type="button" onClick={() => onOpen(view.href)} aria-label={view.ariaLabel} sx={rowSx}>
      <Avatar aria-hidden="true" sx={flagSx}>
        {view.flag}
      </Avatar>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" component="span" sx={labelSx}>
            {view.label}
          </Typography>
          <Box component="span" sx={countPillSx}>
            {view.count}
          </Box>
        </Box>
        <Box aria-hidden="true" sx={{ display: "flex", alignItems: "center", gap: 1, mt: 0.75 }}>
          <Box sx={barTrackSx}>
            <Box sx={barFillSx(view.percent)} />
          </Box>
          <Box component="span" sx={percentSx}>
            {view.percent}%
          </Box>
        </Box>
      </Box>
      <Box aria-hidden="true" className="country-chevron-box" sx={chevronSx}>
        <Box className="country-chevron" component="span" sx={{ display: "flex" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M4 2l4 4-4 4"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Box>
      </Box>
    </Box>
  );
}
