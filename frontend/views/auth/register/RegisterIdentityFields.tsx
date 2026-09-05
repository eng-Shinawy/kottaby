"use client";

import {
  EmailOutlined as EmailIcon,
  PersonOutlined as PersonIcon,
  PhoneOutlined as PhoneIcon,
  PublicOutlined as PublicIcon,
} from "@mui/icons-material";
import { TextField } from "@mui/material";
import type { FieldErrors, UseFormRegister } from "react-hook-form";
import { isValidEmailShape, type RegisterFormValues } from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";

interface RegisterIdentityFieldsProps {
  readonly register: UseFormRegister<RegisterFormValues>;
  readonly errors: FieldErrors<RegisterFormValues>;
  readonly t: AuthLabels;
}

/**
 * The identity grid of RegisterForm: fullName, email, phone, and country
 * text fields. Validation is pure RHF (`register` rules) with the
 * `auth`-namespace client-tier messages; error text arrives without moving
 * focus, so each helper node is a polite live region for SR announcement.
 */
export function RegisterIdentityFields({ register, errors, t }: RegisterIdentityFieldsProps) {
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
      <TextField
        {...register("country", { required: t.countryRequired })}
        label={t.country}
        required
        fullWidth
        autoComplete="country-name"
        error={Boolean(errors.country)}
        helperText={errors.country?.message ?? " "}
        aria-invalid={Boolean(errors.country)}
        slotProps={{
          input: {
            startAdornment: <PublicIcon fontSize="small" sx={{ mr: 1, color: "var(--mui-palette-action-active)" }} />,
          },
          formHelperText: { "aria-live": "polite" },
        }}
      />
    </>
  );
}
