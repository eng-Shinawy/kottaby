/**
 * PlanStatusConfirmDialog — Modal dialog for confirming plan activation / deactivation.
 *
 * Implements REQ-050, REQ-063 (Task 4.4).
 * Handles:
 *  - Dynamic copy for activate vs deactivate flow
 *  - In-flight pending state (disabling actions)
 *  - Inline error alert for concurrency conflicts (PLAN_ALREADY_INACTIVE, etc.)
 */

"use client";

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
} from "@mui/material";
import type { AdminPlansQuery } from "@/frontend/graphql/generated/gql/graphql";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

type PlanItem = AdminPlansQuery["adminPlans"][number];

export interface PlanStatusConfirmDialogProps {
  readonly open: boolean;
  readonly plan: PlanItem | null;
  readonly targetActive: boolean;
  readonly loading: boolean;
  readonly error?: string | null;
  readonly onClose: () => void;
  readonly onConfirm: (plan: PlanItem, targetActive: boolean) => Promise<void>;
}

export function PlanStatusConfirmDialog({
  open,
  plan,
  targetActive,
  loading,
  error,
  onClose,
  onConfirm,
}: PlanStatusConfirmDialogProps): React.ReactElement | null {
  const t = useAppTranslation(Plans);

  if (!plan) {
    return null;
  }

  const title = targetActive ? t.confirmReactivateTitle : t.confirmDeactivateTitle;
  const message = targetActive ? t.confirmReactivateMessage : t.confirmDeactivateMessage;

  const handleConfirm = async () => {
    await onConfirm(plan, targetActive);
  };

  return (
    <Dialog
      open={open}
      onClose={loading ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="plan-status-confirm-title"
    >
      <DialogTitle id="plan-status-confirm-title" sx={{ fontWeight: 600 }}>
        {title}
      </DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 2, mt: 1 }}>
          {error && (
            <Alert severity="error" sx={{ width: "100%" }}>
              {error}
            </Alert>
          )}
          <DialogContentText sx={theme => ({ color: theme.palette.text.secondary })}>{message}</DialogContentText>
          <DialogContentText sx={{ fontWeight: 600 }}>{plan.title}</DialogContentText>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading} color="inherit">
          {t.cancelButton}
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={loading}
          variant="contained"
          color={targetActive ? "primary" : "error"}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
        >
          {loading ? t.savingButton : t.confirmButton}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
