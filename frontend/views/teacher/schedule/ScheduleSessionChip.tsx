"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import { ButtonBase, Stack, Typography } from "@mui/material";
import type { Palette } from "@mui/material/styles";
import type { ReactNode } from "react";
import { TONE_COLORS } from "@/frontend/views/student/sessions/sessionRowPresentation";
import { SESSION_FEE_CURRENCY } from "@/shared/constants/session-fees.constants";

/**
 * One session card on a schedule day column — a compact, CLICKABLE summary
 * of a session's lifecycle + clock + fee.
 *
 * Visual language — the SHARED session presentation tables
 * (`STATUS_ICON` / `STATUS_TONE` / `TONE_COLORS` from the student sessions
 * folder, consumed cross-role by the teacher sessions view already): the
 * status chip's icon and its hover border tone come from those tables so
 * the grid can never fork from the list surfaces.
 *
 * Interaction — the chip is a `ButtonBase` (keyboard-focusable, ripple)
 * navigating to `/teacher/sessions`: the schedule is a REVIEW surface; the
 * lifecycle CTAs stay owned by the list (single-action ownership, no
 * duplicated mutation wiring).
 *
 * Money discipline — the fee renders VERBATIM (decimal string, never
 * parsed) followed by the platform currency label, byte-consistent with
 * `SessionRowMeta`.
 *
 * RTL-safe: logical flex/spacing only; the icon-text row mirrors naturally.
 */

interface ScheduleSessionChipProps {
  /** The session payload (status/fee read directly). */
  readonly session: {
    readonly id: string;
    readonly status: string;
    readonly fee: string | null;
  };
  /** Resolved status copy (from the shared `STATUS_LABEL_KEY` table). */
  readonly statusLabel: string;
  /** Resolved status visual tone (the shared `STATUS_TONE` cell). */
  readonly tone: string;
  /** The outlined status icon (the shared `STATUS_ICON` cell). */
  readonly StatusIcon: SvgIconComponent;
  /** Fully-composed accessible name (`sessionChipAria(status, time)`). */
  readonly chipAria: string;
  /** Formatted 24h clock stamp (locale digits, UTC). */
  readonly timeLabel: string;
  /** Click — navigate to the sessions management list. */
  readonly onOpen: () => void;
}

/** Compact column width — the chip must stay legible inside a 1/7 week grid. */
const CHIP_FONT_SIZE = 11;

export function ScheduleSessionChip({
  session,
  statusLabel,
  tone,
  StatusIcon,
  chipAria,
  timeLabel,
  onOpen,
}: Readonly<ScheduleSessionChipProps>): ReactNode {
  const tonePair: { readonly bg: (palette: Palette) => string; readonly fg: (palette: Palette) => string } | undefined =
    TONE_COLORS[tone];
  const hoverBorder = tonePair?.bg ?? (palette => palette.outline);
  const iconColor = tonePair?.fg ?? (palette => palette.onSurfaceVariant);

  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={chipAria}
      focusRipple
      sx={theme => ({
        display: "block",
        width: "100%",
        textAlign: "start",
        borderRadius: 2,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.surfaceContainerLow,
        px: 1,
        py: 1,
        transition: theme.transitions.create(["box-shadow", "transform", "border-color"], {
          duration: theme.transitions.duration.short,
          easing: theme.transitions.easing.easeOut,
        }),
        "&:hover": {
          boxShadow: theme.shadows[3],
          transform: "translateY(-1px)",
          borderColor: hoverBorder(theme.palette),
        },
        "&:focus-visible": {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: 2,
        },
      })}
    >
      {/*
       * Column layout — a 1/7 week column leaves ~100px of chip width, so
       * every line must fit on its own: the status word gets the FULL top
       * line (the icon would cost it a third of the width and force an
       * ellipsis), the tone-colored status icon anchors the clock line, and
       * the fee (optional) closes on its own line. Nothing truncates.
       */}
      <Stack spacing={0.5} sx={{ minWidth: 0, width: "100%" }}>
        <Typography
          variant="caption"
          noWrap
          component="span"
          title={statusLabel}
          sx={theme => ({
            display: "block",
            fontWeight: 700,
            color: theme.palette.text.primary,
            lineHeight: 1.3,
            fontSize: CHIP_FONT_SIZE,
          })}
        >
          {statusLabel}
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
          <StatusIcon sx={theme => ({ color: iconColor(theme.palette), flexShrink: 0, fontSize: 14 })} />
          <Typography
            variant="caption"
            noWrap
            component="span"
            sx={theme => ({
              color: theme.palette.text.secondary,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.3,
              fontSize: CHIP_FONT_SIZE,
              minWidth: 0,
            })}
          >
            {timeLabel}
          </Typography>
        </Stack>
        {session.fee !== null ? (
          <Typography
            variant="caption"
            noWrap
            component="span"
            sx={theme => ({
              display: "block",
              color: theme.palette.text.secondary,
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1.3,
              fontSize: CHIP_FONT_SIZE,
            })}
          >
            {session.fee} {SESSION_FEE_CURRENCY}
          </Typography>
        ) : null}
      </Stack>
    </ButtonBase>
  );
}
