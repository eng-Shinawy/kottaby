"use client";

import { Box, FormControl, InputLabel, MenuItem, Select } from "@mui/material";
import { useState } from "react";
import type { FieldErrors, UseControllerReturn, UseFormRegister } from "react-hook-form";
import { PasswordField } from "@/frontend/components/AuthFormShared";
import type { Gender } from "@/frontend/graphql/generated/gql/graphql";
import {
  genderFromSelectValue,
  MIN_PASSWORD_LENGTH,
  PasswordStrengthMeter,
  type RegisterFormValues,
  RegisterIdentityFields,
  SectionLabel,
} from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";

interface RegisterAccountSectionProps {
  readonly register: UseFormRegister<RegisterFormValues>;
  readonly errors: FieldErrors<RegisterFormValues>;
  readonly t: AuthLabels;
  readonly passwordValue: string;
  readonly genderField: UseControllerReturn<RegisterFormValues, "gender">;
  readonly selectedGender: Gender | "";
  readonly countryField: UseControllerReturn<RegisterFormValues, "country">;
}

/**
 * RegisterForm's "Account Information" section: the identity fields (text
 * inputs plus the country picker) in a 2-column grid, the full-width
 * password row (its strength meter rendered flush beneath it), and the
 * optional gender select.
 */
export function RegisterAccountSection({
  register,
  errors,
  t,
  passwordValue,
  genderField,
  selectedGender,
  countryField,
}: RegisterAccountSectionProps) {
  const [showPassword, setShowPassword] = useState(false);
  const { ref: passwordInputRef, ...passwordRegistration } = register("password", {
    required: t.passwordRequired,
    minLength: { value: MIN_PASSWORD_LENGTH, message: t.passwordTooShort },
  });

  // Show password helper only when the user has typed something too short.
  const passwordTooShort = passwordValue.length > 0 && passwordValue.length < MIN_PASSWORD_LENGTH;

  return (
    <>
      <SectionLabel>{t.accountInfoSection}</SectionLabel>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
          gap: 2,
        }}
      >
        <RegisterIdentityFields register={register} errors={errors} t={t} countryField={countryField} />
        {/* Password holds its own full-width grid row so the strength
            meter (remote visual, reconciled onto the register() contract)
            sits flush under the field instead of a squeezed half-cell. */}
        <Box sx={{ gridColumn: { xs: "1 / -1", sm: "1 / -1" } }}>
          <PasswordField
            {...passwordRegistration}
            inputRef={passwordInputRef}
            label={t.password}
            showPassword={showPassword}
            onToggleShow={() => setShowPassword(!showPassword)}
            autoComplete="new-password"
            helperText={errors.password?.message ?? (passwordTooShort ? t.passwordTooShort : " ")}
            error={Boolean(errors.password) || passwordTooShort}
            aria-invalid={Boolean(errors.password) || passwordTooShort}
          />
          <PasswordStrengthMeter pw={passwordValue} t={t} />
        </Box>
        {/* Gender is the section's only optional lone field — spanning the
            full row keeps the grid rhythm even (no dangling half cell). */}
        <FormControl fullWidth error={Boolean(errors.gender)} sx={{ gridColumn: { xs: "1 / -1", sm: "1 / -1" } }}>
          <InputLabel>{t.gender}</InputLabel>
          <Select<Gender | "">
            label={t.gender}
            name={genderField.field.name}
            inputRef={genderField.field.ref}
            onBlur={genderField.field.onBlur}
            value={selectedGender}
            onChange={event => genderField.field.onChange(genderFromSelectValue(event.target.value))}
          >
            <MenuItem value="Male">{t.genderMale}</MenuItem>
            <MenuItem value="Female">{t.genderFemale}</MenuItem>
            <MenuItem value="Other">{t.genderOther}</MenuItem>
          </Select>
        </FormControl>
      </Box>
    </>
  );
}
