"use client";

import { DoneAllOutlined } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from "@mui/material";
import { type ReactNode, useState } from "react";
// audit-R4: shared keyboard-focus ring (v9 ButtonBase ships none).
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { darkOutlinedContrastSx } from "@/frontend/views/notifications/utils";
import type { CommonLabels } from "@/shared/locale/types/common";
import type { NotificationsLabels } from "@/shared/locale/types/notifications";

interface MarkAllButtonProps {
  /** `notifications` namespace labels (property access only). */
  readonly labels: NotificationsLabels;
  /** `common` namespace labels (dialog cancel affordance). */
  readonly commonLabels: CommonLabels;
  /** Disables the sweep affordance (loading / empty inbox / zero unread). */
  readonly disabled?: boolean;
  /** Sweep in flight (dialog confirm button disables + button pending). */
  readonly pending?: boolean;
  /** Fires after the user CONFIRMS the sweep in the dialog. */
  readonly onConfirm: () => void;
}

/**
 * MarkAllButton — the feed's mark-all affordance (REQ-063b): an inline
 * secondary button on `sm+` that widens to a full-width secondary button on
 * `xs` (plan §5.5 mobile posture). Destructive-ish bulk actions get a
 * translated confirmation dialog (`markAllConfirmTitle` /
 * `markAllConfirmBody`) before the sweep fires — the confirm action reuses
 * the `markAllRead` label so the user confirms exactly the wording they
 * clicked.
 */
export function MarkAllButton({
  labels,
  commonLabels,
  disabled = false,
  pending = false,
  onConfirm,
}: Readonly<MarkAllButtonProps>): ReactNode {
  const [confirmOpen, setConfirmOpen] = useState(false);

  const handleConfirm = (): void => {
    setConfirmOpen(false);
    onConfirm();
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<DoneAllOutlined />}
        disabled={disabled || pending}
        onClick={() => setConfirmOpen(true)}
        // QA round 2 (axe serious): dark-mode outlined text/border lift —
        // same treatment as the pager / row mark-read outlined buttons.
        sx={theme => ({
          ...focusVisibleRingSx,
          ...darkOutlinedContrastSx(theme),
          flexShrink: 0,
          minHeight: 44,
          width: { xs: "100%", sm: "auto" },
        })}
      >
        {labels.markAllRead}
      </Button>
      <Dialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby="mark-all-confirm-title"
        aria-describedby="mark-all-confirm-body"
      >
        <DialogTitle id="mark-all-confirm-title">{labels.markAllConfirmTitle}</DialogTitle>
        <DialogContent>
          <DialogContentText id="mark-all-confirm-body">{labels.markAllConfirmBody}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)} disabled={pending} sx={focusVisibleRingSx}>
            {commonLabels.cancel}
          </Button>
          <Button variant="contained" onClick={handleConfirm} disabled={pending} autoFocus sx={focusVisibleRingSx}>
            {labels.markAllRead}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
