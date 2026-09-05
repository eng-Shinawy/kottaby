"use client";

import { TextField } from "@mui/material";
import type { ReactNode } from "react";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/**
 * ResolveDisputeNoteField — the optional arbitration note of the
 * `ResolveDisputeDialog`: a multiline field with a live raw-character
 * counter and the hard `maxLength` cap. Extracted verbatim from the dialog
 * for the `max-lines-per-function` budget; behavior is unchanged. The cap
 * value stays owned by the dialog (`MAX_RESOLVE_NOTE_LENGTH`, mirrored from
 * the backend contract) and arrives as the `maxLength` prop.
 */

interface ResolveDisputeNoteFieldProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** UI-seam cap for the optional note (mirrors the backend contract). */
  readonly maxLength: number;
  /** Localized sessions-namespace labels (field vocabulary). */
  readonly t: SessionsLabels;
}

/** Optional arbitration note — multiline, live counter, hard cap. */
export function ResolveDisputeNoteField({
  value,
  onChange,
  maxLength,
  t,
}: Readonly<ResolveDisputeNoteFieldProps>): ReactNode {
  return (
    <TextField
      value={value}
      onChange={event => {
        onChange(event.target.value);
      }}
      label={t.resolutionNoteLabel}
      placeholder={t.resolutionNotePlaceholder}
      multiline
      minRows={2}
      helperText={`${value.length}/${maxLength}`}
      slotProps={{ htmlInput: { maxLength } }}
      sx={theme => ({
        "& .MuiFormHelperText-root": { color: theme.palette.text.secondary },
      })}
    />
  );
}
