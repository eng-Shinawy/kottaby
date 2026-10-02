"use client";

/**
 * ChangeUserPasswordDialog — the admin "change password" dialog
 * (`adminSetUserPassword`), shared by the directory container (row-level
 * kebab action) and the detail container (hero action) so the credential UX
 * is identical on both surfaces.
 *
 * Composition (the `EditUserDialog` three-band layout): paper header band
 * (title + subtitle + close), tinted body band (the extracted
 * `ChangeUserPasswordFormFields` stack), and the paper footer band
 * (Cancel + submit).
 *
 * Error-propagation contract (deliberate — identical to `EditUserDialog`):
 *  - The caller's `onSubmit` MUST let rejections PROPAGATE — do NOT swallow
 *    them in a try/catch at the call site. The dialog's own submit handler
 *    catches the rejection via `useAdminUserFormFeedback` and projects
 *    VALIDATION field errors into inline `helperText` under the offending
 *    input (via `extractFieldErrors` on `extensions.fields`); field-less
 *    rejections land in the stack's top-level Alert.
 *  - Client-side checks (required, minimum length, confirm match) run BEFORE
 *    the mutation and surface through the same inline channels — a typo
 *    never costs a round-trip.
 *  - The dialog closes ONLY when the caller resolves — on success the caller
 *    flips its target state AFTER awaiting the mutation; on failure (or on a
 *    plain close) nothing is written and no navigation occurs.
 */

import { Dialog, DialogContent } from "@mui/material";
import { type ReactNode, type SubmitEventHandler, useState } from "react";
import {
  AdminDialogFooterBand,
  AdminDialogHeaderBand,
  ChangeUserPasswordFormFields,
  type ChangeUserPasswordFormState,
} from "@/frontend/views/admin/users/dialogs";
import { useAdminUserFormFeedback } from "@/frontend/views/admin/users/hooks";
import { Auth, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Client-side credential floor — mirrors the server policy
 * (`MIN_PASSWORD_LENGTH = 8` in the user-management validation helpers), so
 * the inline message fires before a doomed request is sent.
 */
const MIN_CREDENTIAL_LENGTH = 8;

/**
 * Minimal shape `ChangeUserPasswordDialog` needs from its target user. Both
 * the directory list item (`AdminUserListItemFields`) and the detail
 * projection (`AdminUserDetailFields`) structurally satisfy this interface,
 * so the dialog is reusable from either surface without adapter objects.
 */
export interface AdminUserChangePasswordTarget {
  readonly id: number;
  readonly fullName: string;
}

/**
 * Whitelist credential payload the dialog hands back to its caller. Named
 * distinctly from the codegen `AdminSetUserPasswordInput` wire type — this
 * is the dialog-side submit payload the caller forwards into
 * `adminSetUserPassword({ variables: { id, input } })`.
 */
interface AdminSetUserPasswordSubmitInput {
  readonly password: string;
  readonly mustChangePassword: boolean;
}

interface ChangeUserPasswordDialogProps {
  readonly labels: AdminUsersLabels;
  readonly user: AdminUserChangePasswordTarget;
  readonly loading: boolean;
  readonly onClose: () => void;
  readonly onSubmit: (input: AdminSetUserPasswordSubmitInput) => Promise<void>;
}

export function ChangeUserPasswordDialog({
  labels,
  user,
  loading,
  onClose,
  onSubmit,
}: ChangeUserPasswordDialogProps): ReactNode {
  const [form, setForm] = useState<ChangeUserPasswordFormState>({
    password: "",
    confirmPassword: "",
    // Off by default — the admin opts INTO forcing a reset on next login.
    mustChangePassword: false,
  });
  const { fieldErrors, formError, runWithFeedback } = useAdminUserFormFeedback();
  // Client-side pre-validation messages (same inline channels as the server
  // `fieldErrors`; the two stores merge per field at render time).
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const authLabels = useAppTranslation(Auth);

  const passwordError = validationErrors.password ?? fieldErrors.password;
  const confirmError = validationErrors.confirmPassword;

  const handleSubmit: SubmitEventHandler<HTMLFormElement> = async e => {
    e.preventDefault();
    // Client-side checks first — the same policy the server enforces
    // (required / < 8 chars) plus the confirm-match guard.
    const clientErrors: Record<string, string> = {};
    if (form.password.trim().length === 0) {
      clientErrors.password = authLabels.passwordRequired;
    } else if (form.password.length < MIN_CREDENTIAL_LENGTH) {
      clientErrors.password = authLabels.passwordTooShort;
    }
    if (form.confirmPassword !== form.password) {
      clientErrors.confirmPassword = authLabels.changePassword.mismatch;
    }
    if (Object.keys(clientErrors).length > 0) {
      setValidationErrors(clientErrors);
      return;
    }
    setValidationErrors({});
    await runWithFeedback(() => onSubmit({ password: form.password, mustChangePassword: form.mustChangePassword }));
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
          title={labels.changePasswordDialog.title}
          subtitle={labels.changePasswordDialog.subtitle}
          closeLabel={labels.changePasswordDialog.cancel}
          loading={loading}
          onClose={onClose}
        />
        <DialogContent
          sx={theme => ({
            px: { xs: 2.5, sm: 3 },
            py: 3,
            // Same banding recipe as the sibling dialogs: dark drops to
            // `surfaceContainerLowest` so the header/footer bands stay
            // visible against the tinted body.
            backgroundColor:
              theme.palette.mode === "dark" ? theme.palette.surfaceContainerLowest : theme.palette.surfaceContainer,
          })}
        >
          <ChangeUserPasswordFormFields
            labels={labels}
            targetName={user.fullName}
            form={form}
            setForm={setForm}
            formError={formError}
            passwordError={passwordError}
            confirmError={confirmError}
          />
        </DialogContent>
        <AdminDialogFooterBand
          cancelLabel={labels.changePasswordDialog.cancel}
          submitLabel={labels.changePasswordDialog.submit}
          loading={loading}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}
