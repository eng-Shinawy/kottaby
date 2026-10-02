"use client";

/**
 * OrderReEvaluationDialogFooter — the banded footer actions of
 * `OrderReEvaluationDialog` (extracted so the dialog file stays under the
 * 150-line view-file convention — the `DeleteConfirmDialogBody` parts-file
 * precedent): Cancel (outlined, neutral) + Confirm (contained `primary`)
 * with the SAME `border.main` hairline as `CertifyTeacherDialog` /
 * `DeleteConfirmDialog` so all admin dialogs share the banded footer
 * rhythm. Both buttons disable while the mutation is in flight so a slow
 * rejection can still surface the dialog's inline alert, and Confirm
 * additionally takes the caller's terminal-denial gate — a denial that can
 * never succeed on resubmission keeps the button disabled while its copy
 * is showing (the `CertifyTeacherDialog` discipline).
 */

import { Button, DialogActions } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Confirm-button styling. The `&:disabled` block pins the muted action
 * tokens so a denial never keeps the enabled look, even if a future theme
 * override targets contained primary buttons (the
 * `CertifyTeacherDialog.confirmButtonSx` precedent).
 */
const confirmButtonSx = (theme: Theme) => ({
  minHeight: 54,
  minWidth: 140,
  "&:disabled": {
    backgroundColor: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
  },
});

interface OrderReEvaluationFooterProps {
  readonly copy: AdminUsersLabels["orderReEvaluation"];
  readonly loading: boolean;
  /**
   * Confirm's combined gate: in-flight OR a displayed terminal (non-
   * retryable) denial. Cancel stays governed by `loading` only.
   */
  readonly confirmDisabled: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

export function OrderReEvaluationFooter({
  copy,
  loading,
  confirmDisabled,
  onCancel,
  onConfirm,
}: OrderReEvaluationFooterProps): ReactNode {
  return (
    <DialogActions
      sx={theme => ({
        px: 3,
        pb: 3,
        pt: 2,
        gap: 1.5,
        justifyContent: "flex-end",
        alignItems: "center",
        // Compact viewports stack the actions full-width (primary on top via
        // column-reverse) so a long localized label never folds mid-word —
        // sm+ keeps the inline row composition untouched.
        flexDirection: { xs: "column-reverse", sm: "row" },
        "& .MuiButton-root": {
          whiteSpace: "nowrap",
          width: { xs: "100%", sm: "auto" },
          // MUI's DialogActions sibling margin (8px inline-start) skews the
          // stacked full-width arms — `gap` alone spaces the xs column.
          marginInlineStart: { xs: 0 },
        },
        borderTop: `1px solid ${theme.palette.border.main}`,
      })}
    >
      <Button
        variant="outlined"
        onClick={onCancel}
        disabled={loading}
        sx={theme => ({
          minHeight: 54,
          color: theme.palette.text.secondary,
          borderColor: theme.palette.border.main,
          "&:hover": { backgroundColor: theme.palette.action.hover },
        })}
      >
        {copy.cancel}
      </Button>
      <Button onClick={onConfirm} color="primary" variant="contained" disabled={confirmDisabled} sx={confirmButtonSx}>
        {copy.confirm}
      </Button>
    </DialogActions>
  );
}
