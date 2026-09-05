"use client";

import { Box, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { CopyOutcome } from "@/frontend/views/students/dashboard/useCopyOutcome";

interface CopyOutcomeNoticeProps {
  readonly outcome: CopyOutcome;
  /** Localized success confirmation (`handshakeCode.codeCopied`). */
  readonly copiedText: string;
  /** Localized failure notice (`handshakeCode.copyFailed`). */
  readonly failedText: string;
}

/**
 * Polite live region for the copy outcome. Rendered as `<output>` (implicit
 * `role="status"` → `aria-live="polite"`, the sanctioned MUI v9 pattern) and
 * kept MOUNTED in every state so assistive tech announces the content
 * insertion; the reserved min-height prevents layout shift when copy feedback
 * appears.
 */
export function CopyOutcomeNotice({ outcome, copiedText, failedText }: Readonly<CopyOutcomeNoticeProps>): ReactNode {
  const notice = resolveCopyNotice(outcome, copiedText, failedText);
  return (
    <Box component="output" sx={{ display: "block", minHeight: 20 }}>
      {notice ? (
        <Typography variant="body2" sx={theme => ({ color: notice.color(theme.palette) })}>
          {notice.text}
        </Typography>
      ) : null}
    </Box>
  );
}

/** Resolves the copy outcome into notice copy + tone color (no nested conditionals). */
function resolveCopyNotice(
  outcome: CopyOutcome,
  copiedText: string,
  failedText: string
): { readonly text: string; readonly color: (palette: import("@mui/material/styles").Palette) => string } | null {
  switch (outcome) {
    case "copied":
      return { text: copiedText, color: palette => palette.success.main };
    case "failed":
      return { text: failedText, color: palette => palette.error.main };
    default:
      return null;
  }
}
