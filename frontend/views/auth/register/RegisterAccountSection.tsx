"use client";

import {
  LockOutlined as LockIcon,
  VisibilityOutlined as VisibilityIcon,
  VisibilityOffOutlined as VisibilityOffIcon,
} from "@mui/icons-material";
import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  IconButton as MuiIconButton,
  Select,
  TextField,
} from "@mui/material";
import { useState } from "react";
import type { FieldErrors, UseControllerReturn, UseFormRegister } from "react-hook-form";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
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
}

/**
 * RegisterForm's "Account Information" section: the identity text fields in
 * a 2-column grid, the full-width password row (its strength meter rendered
 * flush beneath it), and the optional gender select.
 */
export function RegisterAccountSection({
  register,
  errors,
  t,
  passwordValue,
  genderField,
  selectedGender,
}: RegisterAccountSectionProps) {
  const [showPassword, setShowPassword] = useState(false);

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
        <RegisterIdentityFields register={register} errors={errors} t={t} />
        {/* Password holds its own full-width grid row so the strength
            meter (remote visual, reconciled onto the register() contract)
            sits flush under the field instead of a squeezed half-cell. */}
        <Box sx={{ gridColumn: { xs: "1 / -1", sm: "1 / -1" } }}>
          <TextField
            {...register("password", {
              required: t.passwordRequired,
              minLength: { value: MIN_PASSWORD_LENGTH, message: t.passwordTooShort },
            })}
            label={t.password}
            type={showPassword ? "text" : "password"}
            required
            fullWidth
            autoComplete="new-password"
            helperText={errors.password?.message ?? (passwordTooShort ? t.passwordTooShort : " ")}
            error={Boolean(errors.password) || passwordTooShort}
            aria-invalid={Boolean(errors.password) || passwordTooShort}
            slotProps={{
              input: {
                startAdornment: <LockIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
                endAdornment: (
                  <InputAdornment position="end">
                    <MuiIconButton
                      aria-label={showPassword ? t.hidePassword : t.showPassword}
                      onClick={() => setShowPassword(!showPassword)}
                      size="small"
                      // v9 ButtonBase has no focus ring — this toggle
                      // was invisible to keyboard users when focused.
                      sx={{
                        ...focusVisibleRingSx,
                        // 44px touch target: 12px padding around the 20px
                        // glyph, pulled back with matching negative margins so
                        // the input row keeps its natural height (the same
                        // invisible-padding trick as the auth/profile fields).
                        p: 1.5,
                        m: -1.5,
                      }}
                    >
                      {showPassword ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </MuiIconButton>
                  </InputAdornment>
                ),
              },
              formHelperText: { "aria-live": "polite" },
            }}
          />
          <PasswordStrengthMeter pw={passwordValue} t={t} />
        </Box>
        <FormControl fullWidth error={Boolean(errors.gender)}>
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
