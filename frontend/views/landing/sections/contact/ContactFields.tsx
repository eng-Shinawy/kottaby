import { TextField as MuiTextField } from "@mui/material";
import type { ReactNode } from "react";
import { Landing, useAppTranslation } from "@/shared/locale";

/** Contact form email field with error-aware palette wiring. */
export function ContactEmailField({
  email,
  emailError,
  onChange,
}: Readonly<{ email: string; emailError: boolean; onChange: (value: string) => void }>): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <MuiTextField
      fullWidth
      label={t.contactEmailLabel}
      placeholder={t.contactEmailPlaceholder}
      value={email}
      onChange={e => onChange(e.target.value)}
      variant="outlined"
      type="email"
      required
      error={emailError}
      helperText={emailError ? t.contactEmailError : undefined}
      sx={{
        bgcolor: "var(--mui-palette-background-paper)",
        borderRadius: 2,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          "& fieldset": {
            borderColor: emailError ? "var(--mui-palette-error-main)" : "var(--mui-palette-divider)",
          },
          "&:hover fieldset": {
            borderColor: emailError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
          },
          "&.Mui-focused fieldset": {
            borderColor: emailError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
          },
        },
        "& .MuiInputLabel-root.Mui-focused": {
          color: emailError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
        },
      }}
    />
  );
}

/** Contact form message textarea (500-char cap) with error-aware palette wiring. */
export function ContactMessageField({
  message,
  messageError,
  onChange,
}: Readonly<{ message: string; messageError: boolean; onChange: (value: string) => void }>): ReactNode {
  const t = useAppTranslation(Landing);
  return (
    <MuiTextField
      fullWidth
      label={t.contactMessageLabel}
      placeholder={t.contactMessagePlaceholder}
      value={message}
      onChange={e => onChange(e.target.value)}
      variant="outlined"
      multiline
      rows={4}
      required
      slotProps={{ htmlInput: { maxLength: 500 } }}
      error={messageError}
      helperText={messageError ? t.contactMessageError : undefined}
      sx={{
        bgcolor: "var(--mui-palette-background-paper)",
        borderRadius: 2,
        "& .MuiOutlinedInput-root": {
          borderRadius: 2,
          "& fieldset": {
            borderColor: messageError ? "var(--mui-palette-error-main)" : "var(--mui-palette-divider)",
          },
          "&:hover fieldset": {
            borderColor: messageError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
          },
          "&.Mui-focused fieldset": {
            borderColor: messageError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
          },
        },
        "& .MuiInputLabel-root.Mui-focused": {
          color: messageError ? "var(--mui-palette-error-main)" : "var(--mui-palette-secondary-main)",
        },
      }}
    />
  );
}
