"use client";

/**
 * GovernanceConfirmDialog — the confirm-dialog half of the
 * GovernanceActionsSection. Extracted into its own module so the parent
 * component stays under the oxlint `max-lines-per-function` (100) +
 * `max-lines` (150) caps for `frontend/views/**` files.
 *
 * Behavior: opens when `api.openAction !== null`. The Suspend direction
 * additionally renders a `periodDays` TextField (client-mirrored 1..3650
 * gate). Conflict routing: VALIDATION → field helperText;
 * USER_ALREADY_DELETED → warning Alert; state conflicts → info Alert;
 * FORBIDDEN rides the caller's toast path (no inline Alert).
 */

import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import type { GovernanceActionsApi } from "@/frontend/views/admin/users/hooks/useGovernanceActions";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const TOUCH = 44;
const SPINNER = 20;

interface GovernanceConfirmDialogProps {
  readonly copy: AdminUsersLabels["governanceActions"];
  readonly api: GovernanceActionsApi;
}

export function GovernanceConfirmDialog({ copy, api }: GovernanceConfirmDialogProps): ReactNode {
  return (
    <Dialog
      open={api.openAction !== null}
      onClose={api.closeDialog}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: "16px", overflow: "hidden" } } }}
    >
      <form onSubmit={api.handleSubmit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{api.meta?.title ?? ""}</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: api.openAction === "suspend" ? 2 : 0 }}>{api.meta?.message ?? ""}</Typography>
          {api.openAction === "suspend" && (
            <TextField
              label={copy.suspendPeriodLabel}
              helperText={api.daysErr ?? copy.suspendPeriodHelper}
              value={api.days}
              onChange={e => api.onDaysChange(e.target.value)}
              error={api.daysErr !== null}
              aria-invalid={api.daysErr !== null}
              fullWidth
              slotProps={{
                htmlInput: { inputMode: "numeric", pattern: "[0-9]*", "aria-label": copy.suspendPeriodLabel },
              }}
              sx={{ mt: 1 }}
            />
          )}
          {api.alert && (
            <Alert severity={api.alert.severity} sx={{ mt: 2, alignItems: "center" }} onClose={api.clearAlert}>
              {api.alert.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions
          sx={theme => ({
            px: 3,
            pb: 2.5,
            pt: 1,
            gap: 1.5,
            justifyContent: "flex-end",
            alignItems: "center",
            borderTop: `1px solid ${theme.palette.divider}`,
          })}
        >
          <Button
            onClick={api.closeDialog}
            disabled={api.inFlight}
            sx={{ ...focusVisibleRingSx, minHeight: TOUCH, minWidth: TOUCH }}
          >
            {copy.cancel}
          </Button>
          <Button
            type="submit"
            color={api.meta?.confirmColor ?? "primary"}
            variant="contained"
            disabled={api.confirmDisabled}
            aria-busy={api.inFlight || undefined}
            sx={{ ...focusVisibleRingSx, minHeight: TOUCH, minWidth: TOUCH }}
          >
            {api.inFlight ? <CircularProgress size={SPINNER} sx={{ color: "inherit" }} /> : copy.confirm}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
