"use client";

/**
 * EditUserDialog — the admin "edit user" dialog (extracted from
 * `AdminUserDialogs.tsx`), shared by the directory container (row-level
 * actions) and the detail container (inline header actions) so the edit UX
 * is identical on both surfaces.
 *
 * Error-propagation contract (deliberate):
 *  - The caller's `onSubmit` MUST let rejections PROPAGATE — do NOT swallow
 *    them in a try/catch at the call site. The dialog's own submit handler
 *    catches the rejection via `useAdminUserFormFeedback` and projects
 *    VALIDATION field errors into inline `helperText` under the offending
 *    input (via `extractFieldErrors` on `extensions.fields`).
 *  - The dialog closes ONLY when the caller resolves — i.e. on success the
 *    caller flips its open-target state AFTER awaiting the mutation.
 */

import { Dialog, DialogContent } from "@mui/material";
import { type ReactNode, type SubmitEventHandler, useState } from "react";
import type { Gender } from "@/frontend/graphql/generated/gql/graphql";
import {
  AdminDialogFooterBand,
  AdminDialogHeaderBand,
  EditUserFormFields,
  type EditUserFormState,
} from "@/frontend/views/admin/users/dialogs";
import { useAdminUserFormFeedback } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Minimal shape `EditUserDialog` needs from its target user. Both the
 * directory list item (`AdminUserListItemFields` — gender + dateOfBirth were
 * added to the list fragment exactly for this purpose) and the detail
 * projection (`AdminUserDetailFields`) structurally satisfy this interface,
 * so the dialog is reusable from either surface without adapter objects.
 */
export interface AdminUserEditTarget {
  readonly id: number;
  readonly fullName: string;
  readonly phone: string | null;
  readonly country: string | null;
  readonly gender: Gender | null | undefined;
  readonly dateOfBirth: string | null | undefined;
}

/** Whitelist patch payload the edit dialog hands back to its caller. */
export interface AdminEditUserPatchInput {
  readonly fullName?: string;
  readonly phone?: string;
  readonly country?: string;
  readonly gender?: "Male" | "Female" | "Other";
  readonly dateOfBirth?: string;
}

interface EditDialogProps {
  readonly labels: AdminUsersLabels;
  readonly user: AdminUserEditTarget;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: AdminEditUserPatchInput) => Promise<void>;
}

export function EditUserDialog({ labels, user, loading, onClose, onSubmit }: EditDialogProps): ReactNode {
  const [form, setForm] = useState<EditUserFormState>({
    fullName: user.fullName,
    phone: user.phone ?? "",
    country: user.country ?? "",
    // Pre-fill gender + dateOfBirth from the target row so admins see the
    // current value when patching. The list fragment carries these two safe
    // `users` columns to avoid a second round-trip to the detail endpoint.
    // `null` / `undefined` map to the empty select value.
    gender: (user.gender ?? "") as "" | "Male" | "Female" | "Other",
    dateOfBirth: user.dateOfBirth ?? "",
  });
  const { fieldErrors, formError, runWithFeedback } = useAdminUserFormFeedback();

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async e => {
    e.preventDefault();
    await runWithFeedback(() =>
      onSubmit({
        fullName: form.fullName || undefined,
        phone: form.phone || undefined,
        country: form.country || undefined,
        gender: form.gender || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
      })
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { borderRadius: "16px", overflow: "hidden" } } }}
    >
      <form onSubmit={handleSubmit}>
        <AdminDialogHeaderBand
          title={labels.editDialog.title}
          subtitle={labels.editDialog.subtitle}
          closeLabel={labels.editDialog.cancel}
          loading={loading}
          onClose={onClose}
        />
        <DialogContent
          sx={theme => ({
            px: { xs: 2.5, sm: 3 },
            py: 3,
            // Dark drops to `surfaceContainerLowest`: `background.paper` and
            // the low ladder steps share the same hue family in the dark
            // palette, so the header/footer vs body banding needs the extra
            // ladder step to stay visible. Light uses `surfaceContainer` —
            // the `--Low` step was too close to `background.paper` for the
            // banding to read.
            backgroundColor:
              theme.palette.mode === "dark" ? theme.palette.surfaceContainerLowest : theme.palette.surfaceContainer,
          })}
        >
          <EditUserFormFields
            labels={labels}
            form={form}
            setForm={setForm}
            formError={formError}
            fieldErrors={fieldErrors}
          />
        </DialogContent>
        <AdminDialogFooterBand
          cancelLabel={labels.editDialog.cancel}
          submitLabel={labels.editDialog.submit}
          loading={loading}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}
