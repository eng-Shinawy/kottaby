"use client";

/**
 * CooldownExtensionDialog — the confirm-dialog half of the
 * CooldownExtensionSection. Extracted into its own module so the parent
 * component stays under the oxlint `max-lines-per-function` (100) +
 * `max-lines` (150) caps for `frontend/views/**` files.
 *
 * Mirrors `GovernanceConfirmDialog`: the `additionalDays` TextField carries
 * the client-mirrored 1..3650 gate; conflict routing renders an in-dialog
 * info `Alert` for typed domain rejections (the server-localized message);
 * FORBIDDEN rides the caller's toast path (no inline Alert). Shared
 * scaffolding lives in `GovernanceDialogPrimitives`.
 */

import { Dialog, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import {
  GovernanceDialogActions,
  GovernanceDialogBody,
} from "@/frontend/views/admin/users/detail/GovernanceDialogPrimitives";
import type { CooldownExtensionApi } from "@/frontend/views/admin/users/hooks/useCooldownExtension";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface CooldownExtensionDialogProps {
  readonly copy: AdminUsersLabels["applicantCooldownExtension"];
  readonly api: CooldownExtensionApi;
}

export function CooldownExtensionDialog({ copy, api }: CooldownExtensionDialogProps): ReactNode {
  return (
    <Dialog
      open={api.open}
      onClose={api.closeDialog}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: "16px", overflow: "hidden" } } }}
    >
      <form onSubmit={api.handleSubmit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{copy.dialogTitle}</DialogTitle>
        <GovernanceDialogBody
          message={copy.dialogMessage}
          messageSpacing={2}
          daysLabel={copy.daysLabel}
          daysHelper={api.daysErr ?? copy.daysHelper}
          days={{ visible: true, value: api.days, onChange: api.onDaysChange, error: api.daysErr !== null }}
          alert={api.alert}
          onClearAlert={api.clearAlert}
        />
        <GovernanceDialogActions
          cancelLabel={copy.cancel}
          onCancel={api.closeDialog}
          cancelDisabled={api.inFlight}
          confirmLabel={copy.confirm}
          confirmColor="warning"
          confirmDisabled={api.confirmDisabled}
          inFlight={api.inFlight}
        />
      </form>
    </Dialog>
  );
}
