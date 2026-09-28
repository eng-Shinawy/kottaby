"use client";

/**
 * DirectoryToneChip — the small tonal pill the directory row cells share
 * (role pill, per-role status/details chips). Painted from a M3
 * container/`on<Color>Container` pair via `directoryToneColors`.
 *
 * The chip NEVER flex-shrinks: width-capped wrapping flex rows (students
 * balances cell, mobile-card status rows) would otherwise squeeze the pill
 * below its content size while the MUI label keeps `overflow: hidden` —
 * clipping the trailing digit ("الحفظ 0" → "الحفظ"). Shrinking is replaced
 * by wrapping, so every pill always renders its full label.
 *
 * The optional leading STATUS DOT reuses the governance headline's dot
 * language (8px `tone.main` circle, drawn as a `::before` pseudo-element so
 * no layout-affecting markup is added) inside the pill, and the `pulse`
 * variant breathes its opacity so a LIVE restriction reads at a glance.
 * The pulse is a `prefers-reduced-motion`-gated keyframe animation —
 * reduced-motion users get the same static dot the others fall back to.
 */

import { Chip } from "@mui/material";
import type { ReactNode } from "react";
import { type DirectoryTone, toneColors } from "@/frontend/views/admin/users/utils";

interface TonalChipProps {
  readonly tone: DirectoryTone;
  readonly label: string;
  /**
   * Optional native `title` tooltip (forwarded to the root element) — the
   * cooldown chip uses it to reveal the FULL absolute cooldown instant on
   * hover without widening the fixed-layout column (same affordance the
   * relative-time cell uses).
   */
  readonly title?: string;
  /**
   * Leading 8px status dot in `tone.main` (the governance headline's dot
   * language, pulled inside the pill) — used when the pill's STATE is the
   * scannable signal (the active/expired cooldown pair).
   */
  readonly dot?: boolean;
  /**
   * Breathes the leading dot's opacity (2.4s ease-in-out loop) so a LIVE
   * restriction reads as alive at a glance. Requires `dot`; gated behind
   * `prefers-reduced-motion: reduce` → renders the static dot instead.
   */
  readonly pulse?: boolean;
  /**
   * Outlined lane — transparent fill with a `tone.main` border/text instead
   * of the container pair. Lets one surface run TWO chip families (e.g. the
   * wallet ledger's outlined type chips over filled status chips) without
   * hue collisions between the dark container pairs.
   */
  readonly outlined?: boolean;
}

/** Small pill chip painted from a M3 container/`on<Color>Container` pair. */
export function TonalChip({
  tone,
  label,
  title,
  dot = false,
  pulse = false,
  outlined = false,
}: TonalChipProps): ReactNode {
  return (
    <Chip
      size="small"
      label={
        dot ? (
          <span className="tonal-chip-label">
            <span className="tonal-chip-dot" aria-hidden />
            {label}
          </span>
        ) : (
          label
        )
      }
      {...(title ? { title } : {})}
      sx={theme => {
        const colors = toneColors(theme, tone);
        return {
          height: 26,
          borderRadius: "999px",
          fontWeight: 600,
          ...(outlined
            ? { bgcolor: "transparent", border: `1px solid ${colors.dot}`, color: colors.dot }
            : { bgcolor: colors.bg, color: colors.fg }),
          flexShrink: 0,
          ...(dot
            ? {
                "& .tonal-chip-label": {
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                },
                "& .tonal-chip-dot": {
                  display: "block",
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: colors.dot,
                  flexShrink: 0,
                  ...(pulse
                    ? {
                        animation: "tonal-chip-pulse 2.4s ease-in-out infinite",
                        "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                      }
                    : {}),
                },
                "@keyframes tonal-chip-pulse": {
                  "0%, 100%": { opacity: 1 },
                  "50%": { opacity: 0.35 },
                },
              }
            : {}),
        };
      }}
    />
  );
}
