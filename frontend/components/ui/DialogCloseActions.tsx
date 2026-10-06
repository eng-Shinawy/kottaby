"use client";

import { Button, DialogActions } from "@mui/material";
import type { ReactNode } from "react";

/**
 * DialogCloseActions — the standard bottom-bar Close affordance shared by
 * the app's read-only dialogs: one right-aligned dismiss button on the
 * shared action-bar chrome (48px-touch-safe on mobile, relaxed on sm+).
 *
 * The dialog supplies its own test-id namespacer (`tid("close")`), the
 * localized label, and the dismiss handler; this component owns ONLY the
 * chrome so the participant mirrors never fork the action-bar styling.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through
 * `theme.palette.*` tokens, and no user-facing copy of its own.
 */
export function DialogCloseActions({
  onClick,
  testId,
  label,
}: Readonly<{ onClick: () => void; testId: string; label: string }>): ReactNode {
  return (
    <DialogActions sx={{ px: 3, pb: 3 }}>
      <Button onClick={onClick} data-testid={testId} sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
        {label}
      </Button>
    </DialogActions>
  );
}
