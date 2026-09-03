"use client";

import { Button, DialogActions } from "@mui/material";
import type { ReactNode } from "react";
import { Common, useAppTranslation } from "@/shared/locale";

interface SessionDialogActionButtonsProps {
  /** Both buttons disable while the dialog's mutation is in flight. */
  readonly loading: boolean;
  /** Dismiss intent (the dialog's `onClose` prop contract). */
  readonly onClose: () => void;
  /** Localized submit label (cancel/dispute CTA copy). */
  readonly submitLabel: string;
  /** Submit accent — the cancel flow is `error`, the dispute flow `warning`. */
  readonly submitColor: "error" | "warning";
  /** Submit disabled state (separate from the dismissal gate). */
  readonly submitDisabled: boolean;
}

/**
 * Shared action row for the confirm-and-reason session dialogs: the
 * `Common.cancel` dismiss button plus the form-submit CTA, both ≥44px on
 * mobile (`minHeight` collapses on `sm+`).
 */
export function SessionDialogActionButtons({
  loading,
  onClose,
  submitLabel,
  submitColor,
  submitDisabled,
}: Readonly<SessionDialogActionButtonsProps>): ReactNode {
  const tc = useAppTranslation(Common);

  return (
    <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
      <Button onClick={onClose} disabled={loading} sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
        {tc.cancel}
      </Button>
      <Button
        type="submit"
        variant="contained"
        color={submitColor}
        disabled={submitDisabled}
        sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
      >
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
