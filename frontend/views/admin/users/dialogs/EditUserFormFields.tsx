"use client";

/**
 * EditUserFormFields — the tinted-body field stack of `EditUserDialog`
 * (extracted from `AdminUserDialogs.tsx`). Renders the form-level Alert plus
 * the five labeled fields exactly as the dialog did; the form state and its
 * setter are owned by the dialog and threaded through verbatim.
 *
 * The country field is the shared `CountrySelector` (ISO 3166-1 alpha-2 —
 * the same picker the create dialog and the register form use), so every
 * admin-edited country arrives at the wire as a dataset code; the service
 * bridges it onto the stored `countryCode` + display-name pair. The host
 * draws the visible label (hideLabel) to keep this stack's label-above
 * grammar, and server field errors still project into the shared helper
 * slot.
 */

import { Alert, Box, Stack, TextField } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { CountrySelector } from "@/frontend/components/ui/CountrySelector";
import { PhoneInput } from "@/frontend/components/ui/PhoneInput";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import { AdminUserGenderSelect } from "@/frontend/views/admin/users/ui";
import type { CountryCode } from "@/shared/constants/countries";
import { isValidPhone } from "@/shared/lib/phone";
import { useAppLocale } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const EDIT_NAME_ID = "admin-users-edit-fullname";
const EDIT_PHONE_ID = "admin-users-edit-phone";
const EDIT_COUNTRY_ID = "admin-users-edit-country";
const EDIT_GENDER_ID = "admin-users-edit-gender";
const EDIT_DOB_ID = "admin-users-edit-dob";

/** Editable field state shared by `EditUserDialog` and this form stack. */
export interface EditUserFormState {
  fullName: string;
  phone: string;
  /** Canonical dataset code (or "" while unset) — never raw display text. */
  country: CountryCode | "";
  gender: "" | "Male" | "Female" | "Other";
  dateOfBirth: string;
}

interface EditUserFormFieldsProps {
  readonly labels: AdminUsersLabels;
  readonly form: EditUserFormState;
  readonly setForm: Dispatch<SetStateAction<EditUserFormState>>;
  readonly formError: string | null;
  readonly fieldErrors: Record<string, string>;
}

export function EditUserFormFields({
  labels,
  form,
  setForm,
  formError,
  fieldErrors,
}: EditUserFormFieldsProps): ReactNode {
  const locale = useAppLocale();
  // An empty phone is never sent to the server — `EditUserDialog` maps `""`
  // to `undefined` in its patch (`form.phone || undefined`), so the key is
  // omitted and the stored number is left untouched — hence only a
  // non-empty value must satisfy the shared phone rule. A server-projected
  // field error always wins over the local format hint.
  const phoneClientError = form.phone.length > 0 && !isValidPhone(form.phone);
  const phoneError = Boolean(fieldErrors.phone) || phoneClientError;
  const phoneErrorText = fieldErrors.phone ?? (phoneClientError ? labels.editDialog.phoneInvalid : " ");
  return (
    <Stack spacing={2}>
      {formError && <Alert severity="error">{formError}</Alert>}
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_NAME_ID} text={labels.editDialog.fullName} />
        <TextField
          id={EDIT_NAME_ID}
          fullWidth
          value={form.fullName}
          onChange={e => setForm({ ...form, fullName: e.target.value })}
          error={!!fieldErrors.fullName}
          helperText={fieldErrors.fullName ?? " "}
          aria-invalid={!!fieldErrors.fullName}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_PHONE_ID} text={labels.editDialog.phone} />
        <PhoneInput
          id={EDIT_PHONE_ID}
          value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
          error={phoneError}
          helperText={phoneErrorText}
          aria-invalid={phoneError}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_COUNTRY_ID} text={labels.editDialog.country} />
        <CountrySelector
          id={EDIT_COUNTRY_ID}
          name="country"
          label={labels.editDialog.country}
          hideLabel
          value={form.country}
          onChange={code => setForm({ ...form, country: code })}
          error={!!fieldErrors.country}
          // Server VALIDATION errors win the helper slot; the quiet helper
          // explains what the stored country drives (same grammar as the
          // create dialog) so the swap from free text stays self-explaining.
          helperText={fieldErrors.country ?? labels.editDialog.countryHelper}
          aria-invalid={!!fieldErrors.country}
        />
      </Box>
      <AdminUserGenderSelect
        labels={labels}
        id={EDIT_GENDER_ID}
        label={labels.editDialog.gender}
        value={form.gender}
        onChange={gender => setForm({ ...form, gender })}
        error={fieldErrors.gender}
      />
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_DOB_ID} text={labels.editDialog.dateOfBirth} />
        <TextField
          id={EDIT_DOB_ID}
          type="date"
          fullWidth
          value={form.dateOfBirth}
          onChange={e => setForm({ ...form, dateOfBirth: e.target.value })}
          // `lang` on the native date input localizes the browser's
          // built-in placeholder (the English `mm/dd/yyyy` mask) to the
          // active UI locale instead of always rendering English.
          slotProps={{ htmlInput: { lang: locale } }}
          error={!!fieldErrors.dateOfBirth}
          helperText={fieldErrors.dateOfBirth ?? " "}
          aria-invalid={!!fieldErrors.dateOfBirth}
        />
      </Box>
    </Stack>
  );
}
