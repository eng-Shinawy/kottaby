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
 * FORBIDDEN rides the caller's toast path (no inline Alert). Shared
 * scaffolding lives in `GovernanceDialogPrimitives`.
 */

import { Dialog, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import {
  GovernanceDialogActions,
  GovernanceDialogBody,
} from "@/frontend/views/admin/users/detail/GovernanceDialogPrimitives";
import type { GovernanceActionsApi } from "@/frontend/views/admin/users/hooks/useGovernanceActions";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

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
        <GovernanceDialogBody
          message={api.meta?.message ?? ""}
          messageSpacing={api.openAction === "suspend" ? 2 : 0}
          daysLabel={copy.suspendPeriodLabel}
          daysHelper={api.daysErr ?? copy.suspendPeriodHelper}
          days={{
            visible: api.openAction === "suspend",
            value: api.days,
            onChange: api.onDaysChange,
            error: api.daysErr !== null,
          }}
          alert={api.alert}
          onClearAlert={api.clearAlert}
        />
        <GovernanceDialogActions
          cancelLabel={copy.cancel}
          onCancel={api.closeDialog}
          cancelDisabled={api.inFlight}
          confirmLabel={copy.confirm}
          confirmColor={api.meta?.confirmColor ?? "primary"}
          confirmDisabled={api.confirmDisabled}
          inFlight={api.inFlight}
        />
      </form>
    </Dialog>
  );
}
