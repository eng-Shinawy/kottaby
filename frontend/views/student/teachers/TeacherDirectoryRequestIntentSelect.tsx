"use client";

/**
 * TeacherDirectoryRequestIntentSelect — the subject-intent select inside
 * the request-session dialog, extracted so the dialog file stays under
 * the 150-line convention. Unlike the browse bar's filter select (where
 * `null` = all subjects), this one feeds a write that REQUIRES a concrete
 * subject: the value is nullable only until the student picks — `null`
 * renders the FIRST, disabled placeholder option (its `""` wire token is
 * rejected by the fail-closed resolver, so the placeholder never
 * commits), and the dialog's Confirm affordance stays disabled upstream
 * until a subject is chosen. The real options are the canonical browse
 * vocabulary minus the `null` "all subjects" entry; the incoming MUI
 * wire value resolves through the fail-closed `resolveBrowseIntent`
 * lookup — never an `as` cast. RTL-safe; ≥44px input height; all copy
 * through the compile-time `TeacherDirectory` handle.
 */

import { MenuItem, TextField } from "@mui/material";
import type { ReactNode } from "react";
import {
  BROWSE_INTENT_OPTIONS,
  type BrowseIntent,
  INTENT_LABEL_KEY_BY_INTENT,
  intentTokenOf,
  resolveBrowseIntent,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { TeacherDirectory, useAppTranslation } from "@/shared/locale";

/**
 * The dialog's subject options — the canonical browse vocabulary WITHOUT
 * the `null` "all subjects" entry (`createSession` requires a concrete
 * subject, so the placeholder — not an "any" option — is the empty state).
 */
const REQUEST_INTENT_OPTIONS: readonly BrowseIntent[] = BROWSE_INTENT_OPTIONS.filter(
  (option): option is BrowseIntent => option !== null
);

interface TeacherDirectoryRequestIntentSelectProps {
  /**
   * The controlled intent (`null` = none chosen yet — an un-narrowed
   * applied filter; renders the disabled placeholder).
   */
  readonly value: BrowseIntent | null;
  /** Settled change intent (receives the narrowed enum member — the placeholder never commits). */
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
      value={value === null ? "" : intentTokenOf(value)}
      disabled={disabled}
      onChange={event => {
        const wireValue = event.target.value;
        const intent = resolveBrowseIntent(wireValue);
        // The disabled placeholder's "" token resolves `undefined` (and an
        // "any" token would resolve `null`) — neither ever commits.
        if (intent !== undefined && intent !== null) {
          onChange(intent);
        }
      }}
      slotProps={{
        // `displayEmpty` (a Select prop — reached through the select slot,
        // not the TextField root) renders the "" placeholder option's text
        // in the closed control; it needs the label pinned to the notch or
        // the floating label overlaps the placeholder (COMPONENT_PATTERNS
        // select gotcha).
        select: { displayEmpty: true },
        inputLabel: { shrink: true },
      }}
      sx={{ "& .MuiOutlinedInput-root": { minHeight: 44 } }}
    >
      <MenuItem value="" disabled>
        {t.requestDialogIntentPlaceholder}
      </MenuItem>
      {REQUEST_INTENT_OPTIONS.map(option => (
        <MenuItem key={intentTokenOf(option)} value={intentTokenOf(option)}>
          {t[INTENT_LABEL_KEY_BY_INTENT[option]]}
        </MenuItem>
      ))}
    </TextField>
  );
}
