"use client";

/**
 * OnboardingHistoryDialog — the students directory's window into the
 * device-scoped cohort memory: every onboarding recorded by
 * `useOnboardStudentRecent` (newest first, capped), reachable from the
 * toolbar WITHOUT having to onboard someone first. Each row carries the
 * identity block (name + email + the shared bounded relative-or-absolute
 * stamp) and the mono handoff code with its own honest copy affordance
 * (the same clipboard seam + check feedback as the success screen's
 * history). A footer caption states the privacy contract plainly: the
 * list lives in this browser and never leaves the device.
 */

import {
  CheckOutlined as CheckIcon,
  ContentCopyOutlined as CopyIcon,
  HistoryOutlined as HistoryIcon,
} from "@mui/icons-material";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { formatBoundedStampOrAbsolute } from "@/frontend/lib/i18n/relative-time";
import { copyTextToClipboard } from "@/frontend/views/admin/students/onboarding/clipboardCopy";
import type { RecentOnboardingEntry } from "@/frontend/views/admin/students/onboarding/hooks";
import { useAppLocale } from "@/shared/locale";
import type { AdminStudentsLabels } from "@/shared/locale/types/adminStudents";

/** A history row — the quiet hover rhythm shared across the directory. */
const HISTORY_ROW_SX: SxProps<Theme> = theme => ({
  alignItems: "center",
  gap: 1.5,
  px: 1.25,
  py: 0.75,
  borderRadius: 1,
  transition: theme.transitions.create("background-color"),
  "&:hover": { bgcolor: theme.palette.action.hover },
});

export interface OnboardingHistoryDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The remembered onboardings, newest first (already capped). */
  readonly entries: readonly RecentOnboardingEntry[];
  /** The history vocabulary + the shared drawer close label. */
  readonly labels: Pick<AdminStudentsLabels, "history" | "drawer">;
}

export function OnboardingHistoryDialog({ open, onClose, entries, labels }: OnboardingHistoryDialogProps): ReactNode {
  const locale = useAppLocale();
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const handleCopy = (code: string): void => {
    void (async () => {
      const copied = await copyTextToClipboard(code);
      setCopiedCode(copied ? code : null);
    })();
  };
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 1 }}>
        <HistoryIcon aria-hidden sx={theme => ({ fontSize: 20, color: theme.palette.primary.main })} />
        {labels.history.title}
      </DialogTitle>
      <DialogContent sx={{ paddingInline: 3 }}>
        {entries.length === 0 ? (
          <Typography
            variant="body2"
            sx={theme => ({ color: theme.palette.text.secondary, py: 3, textAlign: "center" })}
          >
            {labels.history.empty}
          </Typography>
        ) : (
          <Stack sx={{ gap: 0.5, mt: 1 }}>
            {entries.map(entry => (
              <Stack key={entry.handshakeCode} direction="row" sx={HISTORY_ROW_SX}>
                <Stack sx={{ minWidth: 0 }}>
                  <Typography
                    variant="body2"
                    sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {entry.fullName}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={theme => ({
                      color: theme.palette.text.secondary,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    })}
                  >
                    {entry.email}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={theme => ({
                      color: theme.palette.text.disabled,
                      fontSize: 11,
                      fontVariantNumeric: "tabular-nums",
                    })}
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
                <Tooltip title={copiedCode === entry.handshakeCode ? labels.history.copied : labels.history.copyCode}>
                  <IconButton
                    size="small"
                    aria-label={`${labels.history.copyCode}: ${entry.fullName}`}
                    onClick={() => handleCopy(entry.handshakeCode)}
                    sx={theme => ({ color: theme.palette.primary.main })}
                  >
                    {copiedCode === entry.handshakeCode ? <CheckIcon /> : <CopyIcon />}
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        )}
        <Typography
          variant="caption"
          sx={theme => ({ display: "block", mt: 2, lineHeight: 1.6, color: theme.palette.text.disabled })}
        >
          {labels.history.deviceNote}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button variant="text" color="inherit" onClick={onClose}>
          {labels.drawer.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
