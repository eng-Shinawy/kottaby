"use client";

/**
 * ChangeUserPasswordFormFields — the tinted-body field stack of
 * `ChangeUserPasswordDialog` (the `EditUserFormFields` extraction pattern).
 * Renders the form-level Alert, the target-identity caption, the
 * new-password field with the `CreateUserCredentialField` show/hide recipe,
 * the confirm-password field, and the force-reset checkbox + helper. The
 * form state and its setter are owned by the dialog and threaded through
 * verbatim; the show/hide visibility state is purely local to the field.
 */

import { VisibilityOffOutlined as HidePasswordIcon, VisibilityOutlined as ShowPasswordIcon } from "@mui/icons-material";
import {
  Alert,
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { type Dispatch, type ReactNode, type SetStateAction, useState } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import { Auth, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constants (same convention as `CreateUserCredentialField`).
const NEW_CREDENTIAL_FIELD_ID = "admin-users-change-credential";
const CONFIRM_CREDENTIAL_FIELD_ID = "admin-users-change-confirm";

/** Editable field state shared by `ChangeUserPasswordDialog` and this stack. */
export interface ChangeUserPasswordFormState {
  password: string;
  confirmPassword: string;
  mustChangePassword: boolean;
}

interface ChangeUserPasswordFormFieldsProps {
  readonly labels: AdminUsersLabels;
  readonly targetName: string;
  readonly form: ChangeUserPasswordFormState;
  readonly setForm: Dispatch<SetStateAction<ChangeUserPasswordFormState>>;
  readonly formError: string | null;
  /** Resolved new-password error (client validation or server field error). */
  readonly passwordError: string | undefined;
  /** Confirm-match error — client-side only (the input has no server twin). */
  readonly confirmError: string | undefined;
}

export function ChangeUserPasswordFormFields({
  labels,
  targetName,
  form,
  setForm,
  formError,
  passwordError,
  confirmError,
}: ChangeUserPasswordFormFieldsProps): ReactNode {
  const [showCredential, setShowCredential] = useState(false);
  const authLabels = useAppTranslation(Auth);
  return (
    <Stack spacing={2.5}>
      {formError && <Alert severity="error">{formError}</Alert>}
      {/* Target identity caption — a credential write should always name
          WHOSE credential it replaces (no interpolation needed; the labels
          stay flat strings). */}
      <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
        {targetName}
      </Typography>
      <Box>
        <AdminDialogFieldLabel
          htmlFor={NEW_CREDENTIAL_FIELD_ID}
          text={labels.changePasswordDialog.newPasswordLabel}
          required
        />
        <TextField
          id={NEW_CREDENTIAL_FIELD_ID}
          type={showCredential ? "text" : "password"}
          value={form.password}
          onChange={e => setForm({ ...form, password: e.target.value })}
          required
          fullWidth
          error={!!passwordError}
          helperText={passwordError}
          aria-invalid={!!passwordError}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <Tooltip title={showCredential ? authLabels.hidePassword : authLabels.showPassword}>
                    <IconButton
                      aria-label={showCredential ? authLabels.hidePassword : authLabels.showPassword}
                      onClick={() => setShowCredential(prev => !prev)}
                      size="small"
                      // Borderless icon-only affordance — the hover wash plus
                      // the shared copper focus-visible ring are the state
                      // changes (`CreateUserCredentialField` recipe).
                      sx={theme => ({
                        ...focusVisibleRingSx,
                        border: "none",
                        boxShadow: "none",
                        backgroundColor: "transparent",
                        // 44px touch target via transparent padding pulled
                        // back with matching negative margins — the input
                        // row keeps its natural height.
                        p: 1.5,
                        m: -1.5,
                        "&:hover": { backgroundColor: theme.palette.action.hover },
                      })}
                    >
                      {showCredential ? <HidePasswordIcon fontSize="small" /> : <ShowPasswordIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel
          htmlFor={CONFIRM_CREDENTIAL_FIELD_ID}
          text={labels.changePasswordDialog.confirmPasswordLabel}
          required
        />
        <TextField
          id={CONFIRM_CREDENTIAL_FIELD_ID}
          type="password"
          value={form.confirmPassword}
          onChange={e => setForm({ ...form, confirmPassword: e.target.value })}
          required
          fullWidth
          error={!!confirmError}
          helperText={confirmError}
          aria-invalid={!!confirmError}
        />
      </Box>
      <Box>
        <FormControlLabel
          control={
            <Checkbox
              checked={form.mustChangePassword}
              onChange={(_event, checked) => setForm({ ...form, mustChangePassword: checked })}
            />
          }
          label={labels.changePasswordDialog.mustChangePasswordLabel}
          sx={theme => ({ color: theme.palette.text.primary })}
        />
        <Typography variant="caption" sx={theme => ({ display: "block", color: theme.palette.text.secondary })}>
          {labels.changePasswordDialog.mustChangePasswordHelper}
        </Typography>
      </Box>
    </Stack>
  );
}
