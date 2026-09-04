"use client";

/**
 * CertifyTeacherDialog — the admin COLD-START teacher certification
 * confirmation dialog (`adminCertifyTeacherColdStart`), modeled on the
 * sibling `DeleteConfirmDialog` and invoked from the user-detail hero.
 *
 * Composition (warning-toned throughout — the action bypasses the normal
 * evaluation pipeline):
 *  - a plain text-only title row (the warning glyph lives in the banner
 *    and error alert below — repeating it in the title was redundant);
 *  - an outlined warning banner naming the target user (interpolation copy)
 *    and stating that certification grants teacher access immediately;
 *  - a pre-checked "also grant evaluator privileges" checkbox
 *    (`makeEvaluator`, default `true` — the mutation's own default);
 *  - a muted footnote that the action is recorded in the audit log;
 *  - footer Cancel (outlined, neutral) + Confirm (contained `warning`).
 *
 * Error-propagation contract (deliberate — same as `DeleteConfirmDialog`):
 * the caller's `onResolve(makeEvaluator)` MUST let mutation rejections
 * PROPAGATE; this dialog catches them, maps the closed TEACHER_* conflict
 * codes (`TEACHER_ALREADY_CERTIFIED` / `TEACHER_ROLE_REQUIRED` /
 * `TEACHER_ACCOUNT_GOVERNED`) to their `Errors` transport copy, and renders
 * the message in an inline warning Alert — the dialog STAYS OPEN. Unknown
 * codes fall back to the generic `internalServerError` copy. Only success
 * lets the caller close the dialog (after awaiting the mutation).
 * `onResolve(null)` is the cancel path — no mutation is fired. While the
 * mutation is in flight (`loading`), Escape/backdrop close requests are
 * ignored so a slow rejection can still surface its inline alert — the
 * Cancel button is likewise disabled for the same window.
 */

import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Typography,
} from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { Errors, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";
import type { ErrorsLabels } from "@/shared/locale/types/errors";

/**
 * Minimal shape `CertifyTeacherDialog` needs from its target user — the
 * detail-page projection structurally satisfies this interface.
 */
export interface AdminUserCertifyTarget {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
}

/**
 * Confirm-button styling. The `&:disabled` block pins the muted action
 * tokens so a terminal denial (TEACHER_ALREADY_CERTIFIED) never keeps the
 * amber enabled look, even if a future theme override targets contained
 * warning buttons.
 */
const confirmButtonSx = (theme: Theme) => ({
  minHeight: 44,
  minWidth: 140,
  "&:disabled": {
    backgroundColor: theme.palette.action.disabledBackground,
    color: theme.palette.action.disabled,
  },
});

interface CertifyTeacherDialogProps {
  readonly labels: AdminUsersLabels;
  /** `null` renders nothing — the caller mounts the dialog only when armed. */
  readonly targetUser: AdminUserCertifyTarget | null;
  readonly loading: boolean;
  /**
   * `onResolve(makeEvaluator)` fires the mutation; `onResolve(null)` cancels.
   * Rejections MUST propagate — they land in this dialog's inline alert.
   */
  readonly onResolve: (makeEvaluator: boolean | null) => Promise<void> | void;
}

/** Maps the closed TEACHER_* conflict codes to their `Errors` transport copy. */
function certifyErrorCopy(code: string | null, t: ErrorsLabels): string {
  const copyByCode: Record<string, (labels: ErrorsLabels) => string> = {
    TEACHER_ACCOUNT_GOVERNED: labels => labels.teacherAccountGoverned,
    TEACHER_ALREADY_CERTIFIED: labels => labels.teacherAlreadyCertified,
    TEACHER_ROLE_REQUIRED: labels => labels.teacherRoleRequired,
  };
  return (code !== null ? copyByCode[code] : undefined)?.(t) ?? t.internalServerError;
}

export function CertifyTeacherDialog({ labels, targetUser, loading, onResolve }: CertifyTeacherDialogProps): ReactNode {
  const te = useAppTranslation(Errors);
  // Pre-checked: matches the mutation's `makeEvaluator = true` default.
  const [makeEvaluator, setMakeEvaluator] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (!targetUser) return null;

  const handleConfirm = async () => {
    setErrorMessage(null);
    setErrorCode(null);
    try {
      await onResolve(makeEvaluator);
    } catch (err) {
      const code = extractErrorCode(err);
      setErrorMessage(certifyErrorCopy(code, te));
      setErrorCode(code);
    }
  };

  // TEACHER_ALREADY_CERTIFIED is a terminal denial — resubmission can never
  // succeed, so the Confirm button is disabled while that code is showing.
  const confirmDisabled = loading || errorCode === "TEACHER_ALREADY_CERTIFIED";

  // Escape/backdrop requests are ignored while the mutation is in flight:
  // closing would unmount the dialog before a rejection surfaces inline.
  const handleClose = () => (loading ? undefined : onResolve(null));

  return (
    <Dialog open onClose={handleClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: "16px" } } }}>
      <DialogTitle sx={{ px: 3, pt: 3, pb: 1 }}>{labels.certifyDialog.title}</DialogTitle>
      <DialogContent sx={{ px: 3, pt: 1, pb: 1 }}>
        {errorMessage !== null && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {errorMessage}
          </Alert>
        )}
        <Alert severity="warning" variant="outlined" sx={{ wordBreak: "break-word" }}>
          {labels.certifyDialog.warningMessage(targetUser.fullName)}
        </Alert>
        <Typography
          variant="caption"
          sx={theme => ({
            display: "block",
            mt: 1,
            color: theme.palette.text.secondary,
            overflowWrap: "anywhere",
          })}
        >
          {targetUser.email}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={makeEvaluator}
              disabled={loading}
              onChange={(_event, checked) => setMakeEvaluator(checked)}
            />
          }
          label={labels.certifyDialog.evaluatorCheckbox}
          sx={theme => ({ mt: 1, color: theme.palette.text.primary })}
        />
        <Typography variant="caption" sx={theme => ({ display: "block", color: theme.palette.text.secondary })}>
          {labels.certifyDialog.auditNote}
        </Typography>
      </DialogContent>
      <DialogActions
        sx={theme => ({
          px: 3,
          pb: 3,
          pt: 2,
          gap: 1.5,
          justifyContent: "flex-end",
          alignItems: "center",
          // Same `border.main` hairline as `DeleteConfirmDialog` so all
          // admin dialogs share the banded footer rhythm.
          borderTop: `1px solid ${theme.palette.border.main}`,
        })}
      >
        <Button
          variant="outlined"
          onClick={() => onResolve(null)}
          disabled={loading}
          sx={theme => ({
            minHeight: 44,
            color: theme.palette.text.secondary,
            borderColor: theme.palette.border.main,
            "&:hover": { backgroundColor: theme.palette.action.hover },
          })}
        >
          {labels.certifyDialog.cancel}
        </Button>
        <Button
          onClick={handleConfirm}
          color="warning"
          variant="contained"
          disabled={confirmDisabled}
          sx={confirmButtonSx}
        >
          {labels.certifyDialog.confirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
