"use client";

/**
 * EditUserFormFields — the tinted-body field stack of `EditUserDialog`
 * (extracted from `AdminUserDialogs.tsx`). Renders the form-level Alert plus
 * the five labeled fields exactly as the dialog did; the form state and its
 * setter are owned by the dialog and threaded through verbatim.
 */

import { Alert, Box, Stack, TextField } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import { AdminDialogFieldLabel } from "@/frontend/views/admin/users/dialogs";
import { AdminUserGenderSelect } from "@/frontend/views/admin/users/ui";
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
  country: string;
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
          helperText={fieldErrors.fullName}
          aria-invalid={!!fieldErrors.fullName}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_PHONE_ID} text={labels.editDialog.phone} />
        <TextField
          id={EDIT_PHONE_ID}
          fullWidth
          value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
          error={!!fieldErrors.phone}
          helperText={fieldErrors.phone}
          aria-invalid={!!fieldErrors.phone}
          slotProps={{ htmlInput: { dir: "ltr" } }}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={EDIT_COUNTRY_ID} text={labels.editDialog.country} />
        <TextField
          id={EDIT_COUNTRY_ID}
          fullWidth
          value={form.country}
          onChange={e => setForm({ ...form, country: e.target.value })}
          error={!!fieldErrors.country}
          helperText={fieldErrors.country}
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
          helperText={fieldErrors.dateOfBirth}
          aria-invalid={!!fieldErrors.dateOfBirth}
        />
      </Box>
    </Stack>
  );
}
