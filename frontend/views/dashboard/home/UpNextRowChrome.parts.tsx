"use client";

import { CalendarMonthOutlined as CalendarIcon, ChevronRightOutlined as ChevronIcon } from "@mui/icons-material";
import { Box, ButtonBase, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { upNextRowShellSx } from "@/frontend/views/dashboard/home/upNextRowShell";

/**
 * Row-level chrome primitives of the Up Next glance-card family — the
 * tinted leading icon chip, the directional chevron, and the full
 * upcoming-session mini-row that composes them — split from
 * `UpNextRowChrome.tsx` (150-line view budget). Presentational only; the
 * names flow back through the `UpNextRowChrome` re-export so the role-card
 * import paths stay unchanged.
 */

/**
 * The row-leading icon chip — a small tinted circle keyed by a tone
 * vocabulary (`info` = upcoming session, `primary` = pending work,
 * `success` = all caught up). Theme-palette container tokens only.
 */
export function UpNextRowIcon({
  tone,
  icon,
}: Readonly<{ tone: "info" | "primary" | "success"; icon: ReactNode }>): ReactNode {
  return (
    <Box
      aria-hidden
      sx={theme => ({
        width: 36,
        height: 36,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "50%",
        flexShrink: 0,
        ...(tone === "info" && {
          bgcolor: theme.palette.action.hover,
          color: theme.palette.text.secondary,
        }),
        ...(tone === "primary" && {
          bgcolor: theme.palette.primaryContainer,
          color: theme.palette.onPrimaryContainer,
        }),
        ...(tone === "success" && {
          bgcolor: theme.palette.successContainer,
          color: theme.palette.onSuccessContainer,
        }),
      })}
    >
      {icon}
    </Box>
  );
}

/** Directional affordance at the row's end — flips for RTL locales. */
export function UpNextChevron(): ReactNode {
  return (
    <ChevronIcon
      fontSize="small"
      sx={theme => ({
        color: theme.palette.text.secondary,
        flexShrink: 0,
        transform: theme.direction === "rtl" ? "scaleX(-1)" : "none",
      })}
    />
  );
}

/**
 * One upcoming-session mini-row — session reference + booking meta + fee on
 * a single hover-washed line, shared by both role cards. The caller renders
 * the strings (labels, date formatting, verbatim fee + currency) and owns
 * the hop target; this component owns only the row chrome. Fee/meta text is
 * pre-rendered by the caller so the money discipline (no client-side
 * arithmetic, no formatting drift) stays at the call site.
 */
export function UpNextMiniRow({
  sessionRef,
  bookedLabel,
  feeText,
  ariaLabel,
  onOpen,
}: Readonly<{
  sessionRef: string;
  bookedLabel: string;
  feeText: string;
  ariaLabel: string;
  onOpen: () => void;
}>): ReactNode {
  return (
    <ButtonBase
      component="button"
      type="button"
      aria-label={ariaLabel}
      onClick={onOpen}
      sx={upNextRowShellSx("primary")}
    >
      <UpNextRowIcon tone="info" icon={<CalendarIcon fontSize="small" />} />
      <Box sx={{ minWidth: 0, flex: 1, textAlign: "start" }}>
        <Typography
          variant="body2"
          component="p"
          sx={theme => ({ fontWeight: 700, color: theme.palette.text.primary })}
        >
          {sessionRef}
        </Typography>
        <Typography variant="caption" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {bookedLabel}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        sx={theme => ({
          color: theme.palette.text.secondary,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          whiteSpace: "nowrap",
        })}
      >
        {feeText}
      </Typography>
      <UpNextChevron />
    </ButtonBase>
  );
}
