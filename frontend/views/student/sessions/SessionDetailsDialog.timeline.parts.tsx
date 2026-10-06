"use client";

import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { SessionDetailsTimelineEntry } from "@/frontend/views/student/sessions/SessionDetailsDialog.timeline.helpers";
import type { AppLocale } from "@/shared/locale/AppLocale";

/**
 * The details dialog's lifecycle timeline RENDERER (the entry assembly
 * lives in `SessionDetailsDialog.timeline.helpers.ts`, keeping this
 * component file's export surface react-refresh-clean): a vertical stamp
 * ledger — one icon bubble + localized label + locale-aware stamp per
 * entry. The connector line between bubbles positions through
 * `insetInlineStart` — a logical property, so the line MIRRORS under RTL
 * instead of snapping to a physical edge.
 */

/** Bubble diameter + connector geometry (kept in one place). */
const BUBBLE_SIZE = 32;
const CONNECTOR_WIDTH = 2;
/** Entries stack with `gap: 2` (16px) — the connector bridges that gap. */
const STACK_GAP_PX = 16;

/**
 * The vertical timeline: icon bubble + label/stamp per entry, a 2px
 * connector line bridging each entry's bubble toward the next one. The
 * line's `insetInlineStart` pins it to the bubble column's center in BOTH
 * document directions (cssjanus flips the logical inset, never a physical
 * left/right).
 */
export function SessionDetailsTimeline({
  entries,
  locale,
}: Readonly<{ entries: readonly SessionDetailsTimelineEntry[]; locale: AppLocale }>): ReactNode {
  return (
    <Stack data-testid="session-details-timeline" sx={{ gap: 2 }}>
      {entries.map((entry, index) => {
        const Icon = entry.icon;
        return (
          <Stack key={entry.key} sx={{ position: "relative", flexDirection: "row", alignItems: "flex-start", gap: 2 }}>
            {index < entries.length - 1 ? (
              <Box
                aria-hidden
                sx={theme => ({
                  position: "absolute",
                  insetInlineStart: (BUBBLE_SIZE - CONNECTOR_WIDTH) / 2,
                  top: BUBBLE_SIZE,
                  bottom: -STACK_GAP_PX,
                  width: CONNECTOR_WIDTH,
                  bgcolor: theme.palette.outlineVariant,
                })}
              />
            ) : null}
            <Box
              aria-hidden
              sx={theme => ({
                width: BUBBLE_SIZE,
                height: BUBBLE_SIZE,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                flexShrink: 0,
                bgcolor: theme.palette.surfaceContainerHigh,
                color: theme.palette.onSurfaceVariant,
              })}
            >
              <Icon fontSize="small" />
            </Box>
            <Stack sx={{ gap: 0.25, minWidth: 0 }}>
              <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
                {entry.label}
              </Typography>
              <Typography
                variant="body2"
                dir="ltr"
                sx={theme => ({
                  fontWeight: 600,
                  color: theme.palette.text.primary,
                  // Locale-aware ICU stamp in an isolated LTR box — the `ar`
                  // stamp's embedded RLM controls scramble the punctuation
                  // against an RTL base direction (the row stamps' finding).
                  unicodeBidi: "isolate",
                  whiteSpace: "nowrap",
                  fontVariantNumeric: "tabular-nums",
                })}
              >
                {formatApplicantDate(entry.iso, locale)}
              </Typography>
            </Stack>
          </Stack>
        );
      })}
    </Stack>
  );
}
