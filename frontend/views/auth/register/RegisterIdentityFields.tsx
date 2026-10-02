"use client";

import {
  EmailOutlined as EmailIcon,
  PersonOutlined as PersonIcon,
  PhoneOutlined as PhoneIcon,
} from "@mui/icons-material";
import { TextField } from "@mui/material";
import type { FieldErrors, UseControllerReturn, UseFormRegister } from "react-hook-form";
import { CountrySelector } from "@/frontend/components/ui/CountrySelector";
import { countryFromValue, isValidEmailShape, type RegisterFormValues } from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";

interface RegisterIdentityFieldsProps {
  readonly register: UseFormRegister<RegisterFormValues>;
  readonly errors: FieldErrors<RegisterFormValues>;
  readonly t: AuthLabels;
  readonly countryField: UseControllerReturn<RegisterFormValues, "country">;
}

/**
 * The identity grid of RegisterForm: fullName, email, and phone text fields
 * plus the country picker. Text fields keep pure RHF (`register` rules)
 * with the `auth`-namespace client-tier messages; the country picker is
 * bound to its own RHF controller and gated inline by the shared country
 * code schema (empty → required copy, non-member → invalid copy — the same
 * split the registration service emits on the `country` field path, whose
 * server pairs are projected into `errors` unchanged). Error text arrives
 * without moving focus, so each helper node is a polite live region for SR
 * announcement (the selector wires its own).
 */
export function RegisterIdentityFields({ register, errors, t, countryField }: RegisterIdentityFieldsProps) {
  // The country field degrades to `string` under the checker; pin the raw
  // value back to a dataset member (or "") before it reaches the controlled
  // selector instead of trusting the field value.
  const selectedCountry = countryFromValue(countryField.field.value);

  return (
    <>
      <TextField
        {...register("fullName", { required: t.nameRequired })}
        label={t.fullName}
        required
        fullWidth
        autoComplete="name"
        autoFocus
        error={Boolean(errors.fullName)}
        helperText={errors.fullName?.message ?? " "}
        aria-invalid={Boolean(errors.fullName)}
        slotProps={{
          input: {
            startAdornment: <PersonIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
          },
          // Error text arrives without moving focus (RHF's
          // ref lands on the wrapper), so the helper node itself must be
          // a polite live region for SR announcement.
          formHelperText: { "aria-live": "polite" },
        }}
      />
      <TextField
        {...register("email", {
          required: t.emailRequired,
          validate: value => (isValidEmailShape(value) ? true : t.emailInvalid),
        })}
        label={t.email}
        type="email"
        required
        fullWidth
        autoComplete="email"
        error={Boolean(errors.email)}
        helperText={errors.email?.message ?? " "}
        aria-invalid={Boolean(errors.email)}
        slotProps={{
          input: {
            startAdornment: <EmailIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
          },
          formHelperText: { "aria-live": "polite" },
        }}
      />
      <TextField
        {...register("phone", { required: t.phoneRequired })}
        label={t.phone}
        type="tel"
        required
        fullWidth
        autoComplete="tel"
        error={Boolean(errors.phone)}
        helperText={errors.phone?.message ?? " "}
        aria-invalid={Boolean(errors.phone)}
        slotProps={{
          input: {
            startAdornment: <PhoneIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
          },
          formHelperText: { "aria-live": "polite" },
        }}
      />
      <CountrySelector
        id="register-country"
        name={countryField.field.name}
        inputRef={countryField.field.ref}
        label={t.country}
        value={selectedCountry}
        onChange={countryField.field.onChange}
        onBlur={countryField.field.onBlur}
        error={Boolean(errors.country)}
        helperText={errors.country?.message ?? " "}
        required
      />
    </>
  );
}
