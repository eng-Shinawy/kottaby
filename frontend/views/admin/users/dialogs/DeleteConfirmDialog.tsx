"use client";

/**
 * DeleteConfirmDialog — the admin soft-delete / reactivate confirmation
 * dialog (extracted from `AdminUserDialogs.tsx`), shared by the directory
 * container (row-level actions) and the detail container (inline header
 * actions) so the UX is identical on both surfaces.
 *
 * Error-propagation contract (deliberate):
 *  - The caller's `onConfirm` MUST let rejections PROPAGATE — the dialog's
 *    own confirm handler catches them and projects
 *    `USER_SELF_DEACTIVATION_FORBIDDEN` into the in-dialog warning alert (the
 *    dialog stays open so the alert is visible); any other rejection simply
 *    keeps the dialog open (the admin can retry or cancel).
 *  - The dialog closes ONLY when the caller resolves — i.e. on success the
 *    caller flips its open-target state AFTER awaiting the mutation.
 */

import { Alert, Button, Dialog, DialogActions, DialogContent } from "@mui/material";
import { type ReactNode, useState } from "react";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { DeleteConfirmDialogBody } from "@/frontend/views/admin/users/dialogs";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Minimal shape `DeleteConfirmDialog` needs from its target user. The
 * governance boolean decides whether the dialog presents soft-delete or
 * reactivate copy; `fullName` and `role` feed the personalized centered body
 * (bold name line + role pill inside the info callout). Both the directory
 * list item and the detail projection structurally satisfy this interface.
 */
export interface AdminUserDeleteTarget {
  readonly id: number;
  readonly fullName: string;
  readonly role: string;
  readonly isDeleted: boolean | null | undefined;
}

interface DeleteDialogProps {
  readonly labels: AdminUsersLabels;
  readonly user: AdminUserDeleteTarget;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
}

export function DeleteConfirmDialog({ labels, user, loading, onClose, onConfirm }: DeleteDialogProps): ReactNode {
  const isReactivate = user.isDeleted ?? false;
  const [selfDeactivationAlert, setSelfDeactivationAlert] = useState(false);

  const handleConfirm = async () => {
    setSelfDeactivationAlert(false);
    try {
      await onConfirm();
    } catch (err) {
      // `err` is `unknown` in a catch block (strict mode) — no `as unknown`
      // cast needed before passing to the error-code extractor.
      const code = extractErrorCode(err);
      if (code === "USER_SELF_DEACTIVATION_FORBIDDEN") {
        setSelfDeactivationAlert(true);
      }
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: "16px" } } }}>
      <DialogContent sx={{ px: 3, pt: 3, pb: 1 }}>
        {selfDeactivationAlert && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {labels.selfDeactivationAlert.message}
          </Alert>
        )}
        <DeleteConfirmDialogBody
          labels={labels}
          fullName={user.fullName}
          role={user.role}
          isReactivate={isReactivate}
        />
      </DialogContent>
      <DialogActions
        sx={theme => ({
          px: 3,
          pb: 3,
          pt: 2,
          gap: 1.5,
          justifyContent: "flex-end",
          alignItems: "center",
          // Same `border.main` hairline as `AdminDialogFooterBand` so all
          // three dialogs share the banded footer rhythm. One DialogActions
          // serves both deactivate and reactivate, so there is exactly one
          // hairline — no double border.
          borderTop: `1px solid ${theme.palette.border.main}`,
        })}
      >
        <Button
          onClick={onClose}
          disabled={loading}
          sx={theme => ({
            minHeight: 44,
            color: theme.palette.text.secondary,
            "&:hover": { backgroundColor: theme.palette.action.hover },
          })}
        >
          {isReactivate ? labels.reactivateConfirm.cancel : labels.deleteConfirm.cancel}
        </Button>
        <Button
          onClick={handleConfirm}
          color={isReactivate ? "success" : "error"}
          variant="contained"
          disabled={loading}
          sx={{ minHeight: 44, minWidth: 140 }}
        >
          {isReactivate ? labels.reactivateConfirm.confirm : labels.deleteConfirm.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
