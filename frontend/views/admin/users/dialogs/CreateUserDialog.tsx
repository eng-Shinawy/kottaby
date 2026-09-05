"use client";

/**
 * CreateUserDialog — the admin "create user" dialog, moved out of
 * `AdminUsersDirectoryContainer` and restyled to the prototype's three-band
 * layout (paper header / tinted body / paper footer). The body composes
 * three extracted siblings: `CreateUserRoleSegments` (segmented role
 * control), `CreateUserFormGrid` (the two-column field grid incl. the shared
 * gender select and `CreateUserCredentialField`), and `CreateUserInfoCallout`.
 *
 * The error-propagation contract is IDENTICAL to the edit dialog (see
 * `EditUserDialog.tsx`): the caller's `onSubmit` MUST let rejections
 * propagate — the dialog's own submit handler catches them via
 * `useAdminUserFormFeedback` and projects VALIDATION field errors inline
 * (`helperText`) and field-less rejections into the top-level alert. The
 * dialog closes only when the caller resolves.
 *
 * Presentation notes:
 *  - The role select became a segmented control (student / parent /
 *    teacher-applicant — admin stays excluded, as before). The submitted
 *    `role` value and validation behavior are unchanged; only the control
 *    surface changed.
 *  - There is NO country → dial-code mapping anywhere in the codebase
 *    (country is a free-text field and stored phone numbers already carry
 *    the full international prefix), so the prototype's dial-prefix chip has
 *    no honest data source and is omitted; the phone input keeps its current
 *    behavior and is pinned `direction: ltr` for bidi-safe entry.
 *  - All colors resolve through `theme.palette` callbacks; spacing uses
 *    theme spacing, radii use the documented px scale, and every control
 *    keeps a ≥44px touch target.
 */

import { Alert, Dialog, DialogContent, Stack } from "@mui/material";
import { type ReactNode, type SubmitEventHandler, useState } from "react";
import {
  AdminDialogFooterBand,
  AdminDialogHeaderBand,
  CreateUserFormGrid,
  type CreateUserFormState,
  CreateUserInfoCallout,
  CreateUserRoleSegments,
} from "@/frontend/views/admin/users/dialogs";
import { useAdminUserFormFeedback } from "@/frontend/views/admin/users/hooks";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Whitelist create payload the dialog hands back to its caller. */
export interface CreateUserDialogInput {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly gender?: "Male" | "Female" | "Other";
  readonly country: string;
  readonly role: CreateUserDialogRole;
}

/**
 * Role options the create-user surface can submit. Excludes `admin` —
 * the runtime role-pre-guard rejects any admin-role tamper before the
 * DB write (defense-in-depth on top of the structural `RegisterPublicRole`
 * enum that already omits `admin`).
 *
 * Named alias per `sonarjs/use-type-alias`.
 */
export type CreateUserDialogRole = "Student" | "Teacher" | "Parent";

interface CreateUserDialogProps {
  readonly labels: AdminUsersLabels;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: CreateUserDialogInput) => Promise<void>;
}

export function CreateUserDialog({ labels, loading, onClose, onSubmit }: CreateUserDialogProps): ReactNode {
  const [form, setForm] = useState<CreateUserFormState>({
    fullName: "",
    email: "",
    phone: "",
    password: "",
    gender: "",
    country: "",
    role: "Student",
  });
  const { fieldErrors, formError, runWithFeedback } = useAdminUserFormFeedback();

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async e => {
    e.preventDefault();
    await runWithFeedback(() =>
      onSubmit({
        fullName: form.fullName,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender: form.gender || undefined,
        country: form.country,
        role: form.role,
      })
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { maxWidth: 640, borderRadius: "16px", overflow: "hidden" } } }}
    >
      <form onSubmit={handleSubmit}>
        <AdminDialogHeaderBand
          title={labels.createDialog.title}
          subtitle={labels.createDialog.subtitle}
          closeLabel={labels.createDialog.cancel}
          loading={loading}
          onClose={onClose}
        />

        {/* Body band — tinted surface with the form fields. */}
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
          <Stack spacing={3}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <CreateUserRoleSegments labels={labels} value={form.role} onChange={role => setForm({ ...form, role })} />
            <CreateUserFormGrid labels={labels} form={form} setForm={setForm} fieldErrors={fieldErrors} />
            <CreateUserInfoCallout text={labels.createDialog.callout} />
          </Stack>
        </DialogContent>

        <AdminDialogFooterBand
          cancelLabel={labels.createDialog.cancel}
          submitLabel={labels.createDialog.submit}
          loading={loading}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}
