"use client";

/**
 * OnboardStudentCredentialField — the onboarding dialog's initial-
 * credential input: rendered masked (`type="password"`,
 * `autoComplete="new-password"`, exact-value input) with an in-place
 * visibility toggle, a strong-credential quick-generator (a data-entry
 * accelerator in the payment-reference generator's mold), and the quiet
 * strength row under the field. The value never leaves the form state
 * and never renders anywhere else — the toggle is an input echo, not a
 * copy.
 */

import {
  AutoFixHighOutlined as GenerateIcon,
  VisibilityOffOutlined as HideIcon,
  VisibilityOutlined as ShowIcon,
} from "@mui/icons-material";
import { Box, IconButton, InputAdornment, TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import { generateStrongCredential } from "@/frontend/views/admin/students/onboarding/credentialStrength";
import { OnboardStudentCredentialStrength } from "@/frontend/views/admin/students/onboarding/OnboardStudentCredentialStrength";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import type { StudentOnboardingLabels } from "@/shared/locale/types/studentOnboarding";

const PROFILE_CREDENTIAL_ID = "onboard-student-initial-credential";

export interface OnboardStudentCredentialFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly submitting: boolean;
  readonly error?: string;
  readonly labels: StudentOnboardingLabels["fields"];
  /** Accessible label of the strong-credential quick-generator. */
  readonly generateLabel: string;
  /** The strength row's localized vocabulary. */
  readonly strengthLabels: StudentOnboardingLabels["strength"];
}

export function OnboardStudentCredentialField({
  value,
  onChange,
  submitting,
  error,
  labels,
  generateLabel,
  strengthLabels,
}: OnboardStudentCredentialFieldProps): ReactNode {
  const [visible, setVisible] = useState(false);
  return (
    <Box>
      <AdminDialogFieldLabel htmlFor={PROFILE_CREDENTIAL_ID} text={labels.password} required />
      <TextField
        id={PROFILE_CREDENTIAL_ID}
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        fullWidth
        value={value}
        onChange={event => onChange(event.target.value)}
        required
        disabled={submitting}
        error={Boolean(error)}
        helperText={error}
        aria-invalid={Boolean(error)}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  size="small"
                  aria-label={generateLabel}
                  title={generateLabel}
                  disabled={submitting}
                  onClick={() => onChange(generateStrongCredential())}
                  sx={theme => ({ color: theme.palette.primary.main })}
                >
                  <GenerateIcon sx={{ fontSize: 20 }} />
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={visible ? labels.hidePassword : labels.showPassword}
                  onClick={() => setVisible(prev => !prev)}
                  sx={theme => ({ color: theme.palette.action.active })}
                >
                  {visible ? <HideIcon sx={{ fontSize: 20 }} /> : <ShowIcon sx={{ fontSize: 20 }} />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
      />
      {value.length > 0 ? <OnboardStudentCredentialStrength value={value} labels={strengthLabels} /> : null}
    </Box>
  );
}
