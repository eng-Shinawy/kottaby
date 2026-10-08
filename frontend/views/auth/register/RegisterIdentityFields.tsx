"use client";

import { EmailOutlined as EmailIcon, PersonOutlined as PersonIcon } from "@mui/icons-material";
import { TextField } from "@mui/material";
import type { Control, FieldErrors, UseControllerReturn, UseFormRegister } from "react-hook-form";
import { CountrySelector } from "@/frontend/components/ui/CountrySelector";
import { PhoneFormField } from "@/frontend/components/ui/PhoneFormField";
import { countryFromValue, isValidEmailShape, type RegisterFormValues } from "@/frontend/views/auth/register";
import { isValidPhone } from "@/shared/lib/phone";
import type { AuthLabels } from "@/shared/locale/types/auth";

interface RegisterIdentityFieldsProps {
  readonly register: UseFormRegister<RegisterFormValues>;
  readonly control: Control<RegisterFormValues>;
  readonly errors: FieldErrors<RegisterFormValues>;
  readonly t: AuthLabels;
  readonly countryField: UseControllerReturn<RegisterFormValues, "country">;
}

/**
 * The identity grid of RegisterForm: fullName, email, the shared
 * `PhoneFormField` phone field, and the country picker. Text fields keep
 * pure RHF (`register` rules); the phone field binds its controller with
 * the same inline rules (required + `isValidPhone` validate) so the
 * client-tier messages and the server-pair `setError` projection behave
 * exactly as they did under `register`. The country picker is bound to
 * its own RHF controller and gated inline by the shared country
 * code schema (empty → required copy, non-member → invalid copy — the same
 * split the registration service emits on the `country` field path, whose
 * server pairs are projected into `errors` unchanged). Error text arrives
 * without moving focus, so each helper node is a polite live region for SR
 * announcement (the selector wires its own).
 */
export function RegisterIdentityFields({ register, control, errors, t, countryField }: RegisterIdentityFieldsProps) {
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
      <PhoneFormField
        name="phone"
        control={control}
        rules={{
          required: t.phoneRequired,
          validate: value => (isValidPhone(value) ? true : t.phoneInvalid),
        }}
        label={t.phone}
        required
        error={Boolean(errors.phone)}
        helperText={errors.phone?.message ?? " "}
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
