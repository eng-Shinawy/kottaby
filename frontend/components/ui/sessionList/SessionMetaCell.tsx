"use client";

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * SessionMetaCell — one label/value meta pair inside a session row's header
 * or meta strip: an overline label over a semibold body value, wrap-friendly
 * (`minWidth: 0` keeps truncation RTL-safe inside the flex-wrap row). Shared
 * by the participant sessions rows and the admin arbitration queue rows.
 *
 * `stampTitle` opts the value into the timestamp treatment: the displayed
 * text is the pure-ASCII `dd/MM/yyyy HH:mm` stamp (`formatLedgerStamp`) and
 * the locale-aware ICU stamp rides the native `title` tooltip. An ICU `ar`
 * stamp embeds RLM controls that scramble the visible punctuation when the
 * glyphs reflow against the row's base direction (the round-1 wallet/finances
 * QA finding) — the ASCII stamp is byte-stable in both document directions,
 * and the `dir="ltr"` + `unicode-bidi: isolate` box detaches it from the row
 * entirely. Callers that don't pass `stampTitle` render their value
 * verbatim in an AUTO-DIR isolate box: free-text values (cancel reasons,
 * dispute reasons, arbitration notes — the round-4 bidi sweep) pick their
 * own first-strong-character direction and stay detached from the row's
 * base direction, while plain values (fee amounts, enum strings) are
 * visually unchanged.
 */

interface SessionMetaCellProps {
  readonly label: string;
  readonly value: string;
  /**
   * The locale-aware full stamp for the native tooltip — its presence is the
   * opt-in to the timestamp treatment (pass `undefined` for plain values).
   */
  readonly stampTitle?: string;
}

/** Value styles for the timestamp treatment (the ASCII-stamp isolate box). */
const STAMP_VALUE_SX = {
  unicodeBidi: "isolate",
  whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums",
} as const;

/**
 * Value styles for plain values — the auto-dir isolate. The HTML `dir`
 * attribute (NOT a CSS `direction`, which the Arabic cache's cssjanus flip
 * would invert) + `unicode-bidi: isolate` detach the run from the row's
 * base direction without forcing an absolute direction on it.
 */
const PLAIN_VALUE_SX = {
  unicodeBidi: "isolate",
} as const;

/** One label/value meta pair (overline label + body value), wrap-friendly. */
export function SessionMetaCell({ label, value, stampTitle }: Readonly<SessionMetaCellProps>): ReactNode {
  const isStamp = stampTitle !== undefined;
  return (
    <Stack sx={{ gap: 0.25, minWidth: 0 }}>
      <Typography variant="overline" sx={theme => ({ color: theme.palette.text.secondary })}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        dir={isStamp ? "ltr" : "auto"}
        title={stampTitle}
        sx={{ fontWeight: 600, ...(isStamp ? STAMP_VALUE_SX : PLAIN_VALUE_SX) }}
      >
        {value}
      </Typography>
    </Stack>
  );
}
