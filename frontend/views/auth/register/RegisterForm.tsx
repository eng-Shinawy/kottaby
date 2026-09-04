"use client";

import { PersonAddOutlined as PersonAddIcon } from "@mui/icons-material";
import { Box, Divider, Link as MuiLink, Stack, Typography } from "@mui/material";
import Link from "next/link";
import {
  getRoleHelperText,
  RegisterAccountSection,
  RegisterPreferencesSection,
  RegisterSubmitButton,
  useRegisterFormState,
  useRegisterSubmit,
} from "@/frontend/views/auth/register";
import { Auth, Recitation, useAppTranslation } from "@/shared/locale";

/**
 * RegisterForm — client component for the `/register` route.
 *
 * Layout: wide 2-column grid sitting directly on the auth layout's form
 * panel (NO Card wrapper). Fields are arranged in a 2-column grid
 * (`xs: 1fr`, `sm: 1fr 1fr`): fullName + email row 1, phone + country
 * row 2, password full-width row 3 (its strength meter renders
 * beneath it), then gender, then role full-width, recitation selector
 * full-width. Section dividers group the fields into "Account
 * Information" and "Preferences".
 *
 * Composition: this file is a thin composer — form state lives in
 * {@link useRegisterFormState}, the submit pipeline in
 * {@link useRegisterSubmit}, pure helpers/constants in `registerFormUtils`,
 * and the sections in `RegisterAccountSection` / `RegisterPreferencesSection`
 * (+ `RegisterIdentityFields`, `RegisterSubmitButton`, `SectionLabel`,
 * `PasswordStrengthMeter`).
 *
 * State: React Hook Form owns the inputs (`register` + `Controller`) so a
 * single `setError(field, { message })` sink serves BOTH validation tiers:
 *  - Client tier: `auth`-namespace rules on every field (existing keys
 *    only), revalidated on change after submit ⇒ errors clear-on-fix.
 *  - Server tier: on mutation failure the raw Apollo error runs through
 *    `projectMutationFieldErrors` (the client mapping table re-entered with
 *    `hasForm:true`); returned `extensions.fields[]` pairs are whitelisted
 *    and applied via `applyProjectedFieldErrors`.
 *
 * Fields: fullName, email, phone, password, gender (optional), country,
 * role (Student / Teacher / Parent — NO Admin, enforced by the
 * `RegisterPublicRole` GraphQL enum at the schema layer; BFLA defense).
 *
 * On success: redirect to `/login` (registration does NOT issue a token —
 * the user must sign in to authenticate).
 *
 * MUI v9 patterns: `sx` only, `*Outlined` icons, `React.SubmitEvent`
 * compatible handler, theme palette colors (no hardcoded hex).
 */
export function RegisterForm() {
  const t = useAppTranslation(Auth);
  const tRecitation = useAppTranslation(Recitation);

  const {
    errors,
    isSubmitting,
    handleSubmit,
    register,
    setError,
    passwordValue,
    roleValue,
    genderField,
    roleField,
    preferredRecitationField,
    selectedGender,
    selectedRole,
    selectedRecitation,
    recitationOptions,
    recitationLoading,
  } = useRegisterFormState(t);
  const { onSubmit, loading, errorMessage, successMessage } = useRegisterSubmit(setError, t);

  // Render the role helper text for the currently-selected role.
  const roleHelperText = getRoleHelperText(roleValue, t);

  return (
    <Box sx={{ width: "100%", maxWidth: { xs: 560, md: 640 } }}>
      {/* === Header === */}
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 2,
              bgcolor: "var(--mui-palette-secondary-main)",
              color: "var(--mui-palette-onSecondary)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: theme => `0 6px 16px ${theme.palette.secondary.main}33`,
              flexShrink: 0,
            }}
          >
            <PersonAddIcon sx={{ fontSize: 22 }} />
          </Box>
          <Stack spacing={0.25}>
            <Typography variant="h5" component="h1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              {t.registerTitle}
            </Typography>
            <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)" }}>
              {t.registerSubtitle}
            </Typography>
          </Stack>
        </Stack>
      </Stack>

      <Box component="form" onSubmit={handleSubmit(onSubmit)} noValidate>
        {/* === Section 1: Account Information === */}
        <RegisterAccountSection
          register={register}
          errors={errors}
          t={t}
          passwordValue={passwordValue}
          genderField={genderField}
          selectedGender={selectedGender}
        />

        <Divider sx={{ my: 3 }} />

        {/* === Section 2: Preferences === */}
        <Stack spacing={2}>
          <RegisterPreferencesSection
            t={t}
            tRecitation={tRecitation}
            errors={errors}
            roleField={roleField}
            selectedRole={selectedRole}
            roleHelperText={roleHelperText}
            selectedRecitation={selectedRecitation}
            preferredRecitationField={preferredRecitationField}
            recitationOptions={recitationOptions}
            recitationLoading={recitationLoading}
            errorMessage={errorMessage}
            successMessage={successMessage}
          />

          <RegisterSubmitButton busy={loading || isSubmitting} succeeded={successMessage !== null} label={t.submit} />
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} sx={{ justifyContent: "center", mt: 3 }}>
        <Typography variant="body2" sx={{ color: "var(--mui-palette-text-secondary)" }}>
          {t.haveAccount}
        </Typography>
        {/* 44px tap target via transparent padding — visible text size unchanged. */}
        <MuiLink
          component={Link}
          href="/login"
          underline="hover"
          sx={{ fontWeight: 600, display: "inline-flex", alignItems: "center", minHeight: 44, px: 1 }}
        >
          {t.loginLink}
        </MuiLink>
      </Stack>
    </Box>
  );
}
