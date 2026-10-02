"use client";

/**
 * OnboardStudentRecentOnboardings — the success screen's batch-history
 * section: the last few onboarded students recorded by
 * `useOnboardStudentRecent`, so an admin onboarding a whole cohort can
 * re-copy ANY recent parent handoff code without leaving the dialog.
 *
 * The live onboarding (whose code already renders in the handoff box
 * above) is excluded via `excludeCode` — the section only ever lists the
 * PREVIOUS onboardings. Each row carries its own copy affordance riding
 * the same clipboard seam (`copyTextToClipboard`) with honest feedback:
 * the glyph flips to a check on success, and a failed copy (permission
 * denials) surfaces the manual-select hint on the row instead.
 */

import {
  CheckOutlined as CheckIcon,
  ContentCopyOutlined as CopyIcon,
  HistoryOutlined as HistoryIcon,
} from "@mui/icons-material";
import { Box, IconButton, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { formatBoundedStampOrAbsolute } from "@/frontend/lib/i18n/relative-time";
import { copyTextToClipboard } from "@/frontend/views/admin/students/onboarding/clipboardCopy";
import type { RecentOnboardingEntry } from "@/frontend/views/admin/students/onboarding/hooks";
import { useAppLocale } from "@/shared/locale";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

/** A history row — quiet hover tint, identity block, mono code, copy. */
const RECENT_ROW_SX: SxProps<Theme> = theme => ({
  alignItems: "center",
  gap: 1.5,
  px: 1.25,
  py: 0.75,
  borderRadius: 1,
  transition: theme.transitions.create("background-color"),
  "&:hover": { bgcolor: theme.palette.action.hover },
});

export interface OnboardStudentRecentOnboardingsProps {
  /** The remembered onboardings, newest first (previous ones only). */
  readonly entries: readonly RecentOnboardingEntry[];
  /** The live success's handoff code — excluded from the list. */
  readonly excludeCode: string;
  /** The success labels block (title + copy feedback vocabulary). */
  readonly labels: StudentOnboardingLabels["success"];
}

export function OnboardStudentRecentOnboardings({
  entries,
  excludeCode,
  labels,
}: OnboardStudentRecentOnboardingsProps): ReactNode {
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const locale = useAppLocale();
  const previous = entries.filter(entry => entry.handshakeCode !== excludeCode);
  if (previous.length === 0) return null;
  const handleRowCopy = (code: string): void => {
    void (async () => {
      const copied = await copyTextToClipboard(code);
      setCopiedCode(copied ? code : null);
    })();
  };
  return (
    <Stack sx={{ width: "100%", gap: 0.5 }}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 0.75 }}>
        <HistoryIcon sx={theme => ({ fontSize: 18, color: theme.palette.text.secondary })} />
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
          {labels.recentTitle}
        </Typography>
      </Stack>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 0.25 }}>
        {previous.map(entry => (
          <Stack key={entry.handshakeCode} direction="row" sx={RECENT_ROW_SX}>
            <Stack sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                {entry.fullName}
              </Typography>
              <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
                {entry.email}
              </Typography>
              <Typography
                variant="caption"
                sx={theme => ({ color: theme.palette.text.disabled, fontSize: 11, fontVariantNumeric: "tabular-nums" })}
              >
                {formatBoundedStampOrAbsolute(entry.savedAt, locale)}
              </Typography>
            </Stack>
            <Typography
              variant="caption"
              sx={theme => ({
                marginInlineStart: "auto",
                fontFamily: "monospace",
                letterSpacing: 0.5,
                color: theme.palette.text.primary,
                userSelect: "all",
              })}
            >
              {entry.handshakeCode}
            </Typography>
            <IconButton
              size="small"
              aria-label={`${labels.copyCode}: ${entry.fullName}`}
              onClick={() => handleRowCopy(entry.handshakeCode)}
              sx={theme => ({ color: theme.palette.primary.main })}
            >
              {copiedCode === entry.handshakeCode ? <CheckIcon /> : <CopyIcon />}
            </IconButton>
          </Stack>
        ))}
      </Box>
    </Stack>
  );
}
