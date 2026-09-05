"use client";

/**
 * AdminUserGenderSelect — gender select shared by `EditUserDialog` and the
 * directory's `CreateUserDialog` (extracted from `AdminUserDialogs.tsx`).
 */

import { Box, FormControl, FormHelperText, MenuItem, Select } from "@mui/material";
import type { ReactNode } from "react";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/** Gender option values shared by the create- and edit-user dialogs. */
type AdminUserGenderValue = "" | "Male" | "Female" | "Other";

interface AdminUserGenderSelectProps {
  readonly labels: AdminUsersLabels;
  /** Stable element id wiring `labelId` on the Select ↔ label row (a11y). */
  readonly id: string;
  /** Visible label — the caller picks its own namespace block
   *  (`editDialog.gender` vs `createDialog.gender`). */
  readonly label: string;
  readonly value: AdminUserGenderValue;
  readonly onChange: (value: AdminUserGenderValue) => void;
  /**
   * Field-error string, `undefined` when the field has no VALIDATION error.
   * The create dialog always passes `undefined` (its gender select renders
   * without the error affordance); the edit dialog projects
   * `fieldErrors.gender` (red select + message below it), so the two
   * dialogs' pre-extraction behavior is preserved exactly.
   */
  readonly error: string | undefined;
}

/**
 * Gender select shared by `EditUserDialog` and the directory's
 * `CreateUserDialog` — identical option set, option copy, and label wiring
 * on both surfaces (single source for the four `genderOptions` MenuItems).
 * The label renders above the field via `AdminDialogFieldLabel` (prototype
 * label pattern) and is wired to the Select through `labelId`.
 * `Select`'s generic is pinned by the `value` prop type, so
 * `e.target.value` arrives already typed as `AdminUserGenderValue` — no
 * `as` cast at the caller. `displayEmpty` + `renderValue` give the empty
 * state a placeholder (the field label text in `text.secondary`) instead
 * of a blank box; the required asterisk stays on the label above.
 */
export function AdminUserGenderSelect({
  labels,
  id,
  label,
  value,
  onChange,
  error,
}: AdminUserGenderSelectProps): ReactNode {
  // Value → option-text lookup for `renderValue`; keeps the rendered text in
  // sync with the MenuItems below without re-reading the DOM.
  const optionLabels: Record<AdminUserGenderValue, string> = {
    "": labels.genderOptions.unspecified,
    Male: labels.genderOptions.male,
    Female: labels.genderOptions.female,
    Other: labels.genderOptions.other,
  };
  return (
    <FormControl fullWidth error={!!error}>
      <AdminDialogFieldLabel id={`${id}-label`} text={label} />
      <Select
        id={id}
        labelId={`${id}-label`}
        value={value}
        onChange={e => onChange(e.target.value)}
        // `displayEmpty` + `renderValue`: an empty selection renders the field
        // label text in `text.secondary` as the placeholder instead of a bare
        // empty box; the required-marker semantics stay on the label above.
        displayEmpty
        // `selected`'s inferred type excludes the empty string (MUI infers
        // the non-empty option union), so pin it to `AdminUserGenderValue`
        // to keep the legit runtime `""` comparison typeable.
        renderValue={(selected: AdminUserGenderValue) =>
          selected === "" ? (
            <Box component="span" sx={theme => ({ color: theme.palette.text.secondary })}>
              {label}
            </Box>
          ) : (
            optionLabels[selected]
          )
        }
      >
        <MenuItem value="">{labels.genderOptions.unspecified}</MenuItem>
        <MenuItem value="Male">{labels.genderOptions.male}</MenuItem>
        <MenuItem value="Female">{labels.genderOptions.female}</MenuItem>
        <MenuItem value="Other">{labels.genderOptions.other}</MenuItem>
      </Select>
      {error && <FormHelperText>{error}</FormHelperText>}
    </FormControl>
  );
}
