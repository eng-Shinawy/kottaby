"use client";

/**
 * CreateUserCredentialField — the password input of the admin "create user"
 * dialog (extracted from `CreateUserDialog.tsx`): label, visibility-toggle
 * adornment, and the helper line. The show/hide state is purely local to the
 * field, so it moved here with the input.
 */

import {
  VisibilityOffOutlined as HidePasswordIcon,
  InfoOutlined as InfoIcon,
  VisibilityOutlined as ShowPasswordIcon,
} from "@mui/icons-material";
import { IconButton, InputAdornment, Stack, TextField, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import { Auth, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

// Named without the literal `password` token so `sonarjs/no-hardcoded-passwords`
// does not flag the constant (same convention as the repo's test fixtures).
const CREATE_CREDENTIAL_FIELD_ID = "admin-users-create-credential";

interface CreateUserCredentialFieldProps {
  readonly labels: AdminUsersLabels;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
}

export function CreateUserCredentialField({
  labels,
  value,
  onChange,
  error,
}: CreateUserCredentialFieldProps): ReactNode {
  const [showPassword, setShowPassword] = useState(false);
  const authLabels = useAppTranslation(Auth);
  return (
    <>
      <AdminDialogFieldLabel htmlFor={CREATE_CREDENTIAL_FIELD_ID} text={labels.createDialog.password} required />
      <TextField
        id={CREATE_CREDENTIAL_FIELD_ID}
        type={showPassword ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        required
        fullWidth
        error={!!error}
        helperText={error}
        aria-invalid={!!error}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showPassword ? authLabels.hidePassword : authLabels.showPassword}
                  onClick={() => setShowPassword(prev => !prev)}
                  size="small"
                  // Bare icon-only affordance — no border/ring; the
                  // only visible state change is the hover wash.
                  sx={theme => ({
                    border: "none",
                    boxShadow: "none",
                    backgroundColor: "transparent",
                    // 44px touch target via transparent padding pulled back
                    // with matching negative margins (same trick as the
                    // auth/profile eye toggles) — the input row keeps
                    // its natural height.
                    p: 1.5,
                    m: -1.5,
                    "&:hover": { backgroundColor: theme.palette.action.hover },
                  })}
                >
                  {showPassword ? <HidePasswordIcon fontSize="small" /> : <ShowPasswordIcon fontSize="small" />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      <Stack direction="row" spacing={1} sx={{ mt: 1, alignItems: "flex-start" }}>
        <InfoIcon sx={theme => ({ mt: "2px", fontSize: 16, color: theme.palette.text.secondary })} />
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
          {labels.createDialog.passwordHelper}
        </Typography>
      </Stack>
    </>
  );
}
