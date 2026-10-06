"use client";

/**
 * TeacherDirectoryRequestIntentSelect — the subject-intent select inside
 * the request-session dialog, extracted so the dialog file stays under
 * the 150-line convention. The two options are the canonical browse
 * vocabulary (`BROWSE_INTENT_OPTIONS`); the incoming MUI wire value
 * resolves through the fail-closed `resolveBrowseIntent` lookup — never an
 * `as` cast. RTL-safe; ≥44px input height; all copy through the
 * compile-time `TeacherDirectory` handle.
 */

import { MenuItem, TextField } from "@mui/material";
import type { ReactNode } from "react";
import {
  BROWSE_INTENT_OPTIONS,
  type BrowseIntent,
  INTENT_LABEL_KEY_BY_INTENT,
  resolveBrowseIntent,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { TeacherDirectory, useAppTranslation } from "@/shared/locale";

interface TeacherDirectoryRequestIntentSelectProps {
  /** The controlled intent (preselected from the applied browse filter). */
  readonly value: BrowseIntent;
  /** Settled change intent (receives the narrowed enum member). */
  readonly onChange: (intent: BrowseIntent) => void;
  /** Disabled while the mutation is in flight. */
  readonly disabled: boolean;
}

/** The request dialog's subject-intent select. */
export function TeacherDirectoryRequestIntentSelect({
  value,
  onChange,
  disabled,
}: Readonly<TeacherDirectoryRequestIntentSelectProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  return (
    <TextField
      select
      fullWidth
      label={t.requestDialogIntentLabel}
      value={value}
      disabled={disabled}
      onChange={event => {
        const wireValue = event.target.value;
        const intent = resolveBrowseIntent(wireValue);
        if (intent !== undefined) {
          onChange(intent);
        }
      }}
      sx={{ "& .MuiOutlinedInput-root": { minHeight: 44 } }}
    >
      {BROWSE_INTENT_OPTIONS.map(option => (
        <MenuItem key={option} value={option}>
          {t[INTENT_LABEL_KEY_BY_INTENT[option]]}
        </MenuItem>
      ))}
    </TextField>
  );
}
