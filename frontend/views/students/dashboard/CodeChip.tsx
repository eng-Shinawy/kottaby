"use client";

// cspell:ignore jetbrains

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * Fixed-pitch stack for the code atom. Deliberately a LITERAL stack — not
 * `var(--font-jetbrains-mono)` — because that variable is never mounted in the
 * app shell (`app/layout.tsx` loads only `--font-inter`/`--font-cairo`), so a
 * `var()` reference degrades to the INHERITED proportional font (verified via
 * browser devtools: the computed `font-family` on the chip resolves to Inter).
 * The stack prefers locally-installed JetBrains Mono and falls back through the
 * standard system monospace faces, so the code is always fixed-pitch.
 */
const MONO_FONT_FAMILY =
  '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace' as const;

interface CodeChipProps {
  /** The server-provided handshake code (canonical `KSB-XXXXXXXX` form). */
  readonly code: string;
}

/**
 * The code chip — a fixed-pitch, generously-spaced Latin atom.
 *
 * RTL note (the mechanism is load-bearing): the code MUST read left-to-right
 * inside RTL Arabic layouts. The LTR pin uses the HTML `dir="ltr"` ATTRIBUTE
 * plus `unicodeBidi: "isolate"` in `sx` — NOT a `direction: "ltr"` CSS
 * declaration — because the Arabic Emotion cache runs `stylis-plugin-rtl`
 * (cssjanus), which FLIPS author `direction: ltr` declarations to `rtl`,
 * silently inverting a CSS-side pin. The `dir` attribute is applied by the
 * user-agent stylesheet and cannot be touched by the flip; `unicode-bidi` is
 * not a directional property and passes through untouched. Same technique as
 * `frontend/providers/theme/LtrScope.tsx` ("the HTML `dir` attribute so
 * physical spacing is not flipped"), scoped to a single element.
 */
export function CodeChip({ code }: Readonly<CodeChipProps>): ReactNode {
  return (
    <Box
      dir="ltr"
      data-testid="handshake-code-chip"
      sx={theme => ({
        unicodeBidi: "isolate",
        display: "inline-flex",
        alignItems: "center",
        px: 2.5,
        py: 1.5,
        borderRadius: 2,
        border: "1px solid",
        borderColor: theme.palette.outlineVariant,
        bgcolor: theme.palette.primaryContainer,
        color: theme.palette.onPrimaryContainer,
        width: "fit-content",
        maxWidth: "100%",
        // One tap/click selects the whole code — the manual fallback path for
        // environments where the async clipboard API is unavailable.
        userSelect: "all",
      })}
    >
      <Typography
        sx={{
          fontFamily: MONO_FONT_FAMILY,
          fontSize: { xs: "1.125rem", sm: "1.375rem" },
          fontWeight: 600,
          letterSpacing: "0.12em",
        }}
      >
        {code}
      </Typography>
    </Box>
  );
}
