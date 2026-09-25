"use client";

/**
 * The latest-position value atom — the composed surah/juz + ayah run (or
 * its two-line stacked variant) consumed by the dashboard listing, the
 * student cards, and the drill-down homework history. Deep import (no
 * barrel); extracted from the cells module to keep both under the file
 * size ceiling.
 *
 * Every render is presentational: labels arrive already resolved by the
 * caller, values render exactly what the wire carries (localized digits
 * for display), and an absent slot renders the dedicated none label —
 * never a fabricated value. MUI v9 discipline: `sx`-only styling,
 * theme-palette colors through callbacks.
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import {
  type AcademicPositionFields,
  formatAcademicPositionParts,
  formatAcademicPositionText,
} from "@/frontend/views/admin/academic-tracking/academic-tracking-display";

interface AcademicPositionValueProps {
  /**
   * Latest-position slot (a dashboard row slot or a homework track block,
   * whose wire `grade` member is simply not displayed here) — `null` when
   * the track has no reference.
   */
  readonly position: AcademicPositionFields | null;
  readonly ayahRangeLabel: string;
  readonly locale: string;
  /** Localized copy for an absent slot ("None" / "None assigned"). */
  readonly noneLabel: string;
  /**
   * Dense-table variant: reference and ayah range stack on TWO lines
   * ("Juz 5" over "Ayahs 1–20") so the column stays narrow without
   * truncating any value. The single-run composition is the default.
   */
  readonly stacked?: boolean;
}

/** The honest fallback body — the none label in the secondary text tone. */
function NoneLabel({ noneLabel }: Readonly<{ noneLabel: string }>): ReactNode {
  return (
    <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
      {noneLabel}
    </Typography>
  );
}

/**
 * One latest-position value — the composed surah/juz + ayah run, or the
 * honest fallback label when the slot is empty.
 */
export function AcademicPositionValue({
  position,
  ayahRangeLabel,
  locale,
  noneLabel,
  stacked,
}: Readonly<AcademicPositionValueProps>): ReactNode {
  if (stacked) {
    const parts = formatAcademicPositionParts(position, ayahRangeLabel, locale);
    if (parts === null) {
      return <NoneLabel noneLabel={noneLabel} />;
    }
    return (
      <Stack spacing={0.25}>
        <Typography variant="body2" component="p" sx={{ whiteSpace: "nowrap" }}>
          {parts.reference}
        </Typography>
        {parts.range !== null ? (
          <Typography
            variant="caption"
            component="p"
            sx={theme => ({
              color: theme.palette.text.secondary,
              whiteSpace: "nowrap",
              fontVariantNumeric: "tabular-nums",
            })}
          >
            {parts.range}
          </Typography>
        ) : null}
      </Stack>
    );
  }
  const text = formatAcademicPositionText(position, ayahRangeLabel, locale);
  if (text === null) {
    return <NoneLabel noneLabel={noneLabel} />;
  }
  return (
    <Typography variant="body2" component="p" sx={{ fontVariantNumeric: "tabular-nums" }}>
      {text}
    </Typography>
  );
}
