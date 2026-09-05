"use client";

import { TextField } from "@mui/material";
import type { ReactNode } from "react";

interface SessionDialogReasonFieldProps {
  /** Current draft reason (controlled by the dialog). */
  readonly value: string;
  /** Raw-value change intent — the dialog owns validation-flag relief. */
  readonly onValueChange: (value: string) => void;
  /** Localized field label. */
  readonly label: string;
  /** Localized placeholder. */
  readonly placeholder: string;
  /** Required fields block empty submits at the native form seam. */
  readonly required: boolean;
  /** Raised when a submit carried an invalid value (over-cap / empty). */
  readonly error: boolean;
  /** Live helper line (counter, or the required-reason message when invalid). */
  readonly helperText: string;
  /** UI-seam cap (mirrors the backend contract per dialog). */
  readonly maxLength: number;
}

/**
 * Shared reason field for the confirm-and-reason session dialogs — the
 * identical multiline TextField both twins render: live helper-text
 * counter, `aria-invalid` mirroring the error flag, `maxLength` clamped at
 * the input seam, helper text kept in the secondary text tone.
 */
export function SessionDialogReasonField({
  value,
  onValueChange,
  label,
  placeholder,
  required,
  error,
  helperText,
  maxLength,
}: Readonly<SessionDialogReasonFieldProps>): ReactNode {
  return (
    <TextField
      value={value}
      onChange={event => onValueChange(event.target.value)}
      label={label}
      placeholder={placeholder}
      multiline
      minRows={3}
      required={required}
      error={error}
      aria-invalid={error}
      helperText={helperText}
      slotProps={{ htmlInput: { maxLength } }}
      sx={theme => ({
        "& .MuiFormHelperText-root": { color: theme.palette.text.secondary },
      })}
    />
  );
}
