"use client";

/**
 * OnboardStudentProfileSection — the identity fields of the onboarding
 * dialog (full name, email, phone, initial credential, optional gender,
 * country), laid out as the two-column grid of the admin create-user
 * dialog (`CreateUserFormGrid` — the same field set on the same surface
 * family).
 *
 * Reuse discipline: the gender select is the shared `AdminUserGenderSelect`
 * (single source of the four option labels), the label rows are the shared
 * `AdminDialogFieldLabel`, and the initial credential is the extracted
 * `OnboardStudentCredentialField` (masked input + in-place reveal toggle);
 * the section's own copy comes from the `StudentOnboarding` namespace.
 */

import { PersonOutlined as PersonIcon } from "@mui/icons-material";
import { Box, TextField } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { OnboardStudentCredentialField } from "@/frontend/views/admin/students/onboarding/OnboardStudentCredentialField";
import { OnboardStudentSectionHeading } from "@/frontend/views/admin/students/onboarding/OnboardStudentSectionHeading";
import type {
  OnboardStudentFieldErrors,
  OnboardStudentFormState,
} from "@/frontend/views/admin/students/onboarding/onboardingDialog.types";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import { AdminUserGenderSelect } from "@/frontend/views/admin/users/ui";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminUsers } from "@/shared/locale/namespaces/adminUsers";
import { StudentOnboarding } from "@/shared/locale/namespaces/studentOnboarding";

const PROFILE_FULL_NAME_ID = "onboard-student-full-name";
const PROFILE_EMAIL_ID = "onboard-student-email";
const PROFILE_PHONE_ID = "onboard-student-phone";
const PROFILE_COUNTRY_ID = "onboard-student-country";
const PROFILE_GENDER_ID = "onboard-student-gender";

/** Section caption glyph — rides `primary.main` (shared across the four sections). */
const SECTION_CAPTION_ICON_SX: SxProps<Theme> = theme => ({
  fontSize: 18,
  color: theme.palette.primary.main,
});

export interface OnboardStudentProfileSectionProps {
  readonly form: OnboardStudentFormState;
  /** Draft setter owned by the dialog host (threaded through verbatim). */
  readonly setForm: Dispatch<SetStateAction<OnboardStudentFormState>>;
  readonly submitting: boolean;
  readonly fieldErrors: OnboardStudentFieldErrors;
}

/** One labeled simple identity field (the shared label+input pairing of the create-user grid). */
interface IdentityField {
  readonly id: string;
  readonly label: string;
  readonly errorKey: "fullName" | "email" | "phone" | "country";
  readonly value: string;
  readonly inputType?: "email";
  readonly ltr?: boolean;
}

export function OnboardStudentProfileSection({
  form,
  setForm,
  submitting,
  fieldErrors,
}: OnboardStudentProfileSectionProps): ReactNode {
  const t = useAppTranslation(StudentOnboarding);
  // Option labels for the shared gender select stay single-sourced in the
  // admin-users namespace (the create-dialog vocabulary this flow mirrors).
  const adminUsersLabels = useAppTranslation(AdminUsers);
  const identityFields: readonly IdentityField[] = [
    {
      id: PROFILE_FULL_NAME_ID,
      label: t.fields.fullName,
      errorKey: "fullName",
      value: form.fullName,
    },
    {
      id: PROFILE_EMAIL_ID,
      label: t.fields.email,
      errorKey: "email",
      value: form.email,
      inputType: "email",
    },
    {
      id: PROFILE_PHONE_ID,
      label: t.fields.phone,
      errorKey: "phone",
      value: form.phone,
      ltr: true,
    },
    {
      id: PROFILE_COUNTRY_ID,
      label: t.fields.country,
      errorKey: "country",
      value: form.country,
    },
  ];

  return (
    <Box sx={{ display: "grid", gap: { xs: 2, sm: 3 } }}>
      <OnboardStudentSectionHeading
        index={1}
        icon={<PersonIcon aria-hidden sx={SECTION_CAPTION_ICON_SX} />}
        title={t.sections.profile}
      />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: 2, sm: 3 } }}>
        {identityFields.map(field => (
          <Box key={field.id}>
            <AdminDialogFieldLabel htmlFor={field.id} text={field.label} required />
            <TextField
              id={field.id}
              type={field.inputType}
              fullWidth
              value={field.value}
              onChange={event => setForm(prev => ({ ...prev, [field.errorKey]: event.target.value }))}
              required
              disabled={submitting}
              error={Boolean(fieldErrors[field.errorKey])}
              helperText={fieldErrors[field.errorKey]}
              aria-invalid={Boolean(fieldErrors[field.errorKey])}
              slotProps={field.ltr ? { htmlInput: { dir: "ltr" } } : undefined}
            />
          </Box>
        ))}
        <AdminUserGenderSelect
          labels={adminUsersLabels}
          id={PROFILE_GENDER_ID}
          label={t.fields.gender}
          value={form.gender}
          onChange={gender => setForm(prev => ({ ...prev, gender }))}
          error={fieldErrors.gender}
          disabled={submitting}
        />
        <OnboardStudentCredentialField
          value={form.password}
          onChange={password => setForm(prev => ({ ...prev, password }))}
          submitting={submitting}
          error={fieldErrors.password}
          labels={t.fields}
          generateLabel={t.fields.generatePassword}
          strengthLabels={t.strength}
        />
      </Box>
    </Box>
  );
}
