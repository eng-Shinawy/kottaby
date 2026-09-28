"use client";

/**
 * ApplicantOverrideDialog — the confirm-dialog half of the
 * ApplicantOverrideSection. Extracted into its own module so the parent
 * component stays under the oxlint `max-lines-per-function` (100) +
 * `max-lines` (150) caps for `frontend/views/**` files.
 *
 * Mirrors `CooldownExtensionDialog`: radius-16 paper, spinner-in-confirm,
 * focus ring, RTL-safe logical spacing (the shared scaffolding lives in
 * `GovernanceDialogPrimitives`). Per-direction chrome (title / body /
 * confirm label / confirm tone) comes from the hook-resolved `meta`; only
 * the reject direction renders the cooldown-days TextField with the
 * client-mirrored 1..3650 helper + `helperText` error slot. Conflict routing
 * renders an in-dialog info `Alert` for typed domain rejections (the
 * server-localized message); FORBIDDEN rides the caller's toast path (no
 * inline Alert).
 */

import { Dialog, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import {
  GovernanceDialogActions,
  GovernanceDialogBody,
} from "@/frontend/views/admin/users/detail/GovernanceDialogPrimitives";
import type { ApplicantOverrideApi } from "@/frontend/views/admin/users/hooks/useApplicantOverride";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

interface ApplicantOverrideDialogProps {
  readonly copy: AdminUsersLabels["applicantOverride"];
  readonly api: ApplicantOverrideApi;
}

export function ApplicantOverrideDialog({ copy, api }: ApplicantOverrideDialogProps): ReactNode {
  const meta = api.meta;
  if (meta === null) {
    return null;
  }
  return (
    <Dialog
      open={api.action !== null}
      onClose={api.closeDialog}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: "16px", overflow: "hidden" } } }}
    >
      <form onSubmit={api.handleSubmit}>
        <DialogTitle sx={{ fontWeight: 700 }}>{meta.title}</DialogTitle>
        <GovernanceDialogBody
          message={meta.message}
          messageSpacing={2}
          daysLabel={copy.daysLabel}
          daysHelper={api.daysErr ?? copy.daysHelper}
          days={{ visible: api.daysVisible, value: api.days, onChange: api.onDaysChange, error: api.daysErr !== null }}
          alert={api.alert}
          onClearAlert={api.clearAlert}
        />
        <GovernanceDialogActions
          cancelLabel={copy.cancel}
          onCancel={api.closeDialog}
          cancelDisabled={api.inFlight}
          confirmLabel={meta.confirm}
          confirmColor={meta.confirmColor}
          confirmDisabled={api.confirmDisabled}
          inFlight={api.inFlight}
        />
      </form>
    </Dialog>
  );
}
