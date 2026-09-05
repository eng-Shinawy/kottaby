"use client";

/**
 * CreateUserFormGrid — the two-column field grid of the admin "create user"
 * dialog (extracted from `CreateUserDialog.tsx`): name/email/phone/country
 * text fields, the shared gender select, and the credential field. The form
 * state and its setter are owned by the dialog and threaded through
 * verbatim; per-field VALIDATION errors render as inline `helperText`.
 */

import { Box, TextField } from "@mui/material";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import {
  AdminDialogFieldLabel,
  CreateUserCredentialField,
  type CreateUserDialogRole,
} from "@/frontend/views/admin/users/dialogs";
import { AdminUserGenderSelect } from "@/frontend/views/admin/users/ui";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

const CREATE_NAME_ID = "admin-users-create-fullname";
const CREATE_EMAIL_ID = "admin-users-create-email";
const CREATE_PHONE_ID = "admin-users-create-phone";
const CREATE_COUNTRY_ID = "admin-users-create-country";
const CREATE_GENDER_ID = "admin-users-create-gender";

/** Form state owned by `CreateUserDialog` and edited through this grid. */
export interface CreateUserFormState {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  gender: "" | "Male" | "Female" | "Other";
  country: string;
  role: CreateUserDialogRole;
}

interface CreateUserFormGridProps {
  readonly labels: AdminUsersLabels;
  readonly form: CreateUserFormState;
  readonly setForm: Dispatch<SetStateAction<CreateUserFormState>>;
  readonly fieldErrors: Record<string, string>;
}

/** Field grid — two columns on ≥sm, single column below. */
export function CreateUserFormGrid({ labels, form, setForm, fieldErrors }: CreateUserFormGridProps): ReactNode {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: { xs: 2, sm: 3 } }}>
      <Box>
        <AdminDialogFieldLabel htmlFor={CREATE_NAME_ID} text={labels.createDialog.fullName} required />
        <TextField
          id={CREATE_NAME_ID}
          fullWidth
          placeholder={labels.createDialog.fullNamePlaceholder}
          value={form.fullName}
          onChange={e => setForm({ ...form, fullName: e.target.value })}
          required
          error={!!fieldErrors.fullName}
          helperText={fieldErrors.fullName}
          aria-invalid={!!fieldErrors.fullName}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={CREATE_EMAIL_ID} text={labels.createDialog.email} required />
        <TextField
          id={CREATE_EMAIL_ID}
          fullWidth
          type="email"
          value={form.email}
          onChange={e => setForm({ ...form, email: e.target.value })}
          required
          error={!!fieldErrors.email}
          helperText={fieldErrors.email}
          aria-invalid={!!fieldErrors.email}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={CREATE_PHONE_ID} text={labels.createDialog.phone} required />
        <TextField
          id={CREATE_PHONE_ID}
          fullWidth
          value={form.phone}
          onChange={e => setForm({ ...form, phone: e.target.value })}
          required
          error={!!fieldErrors.phone}
          helperText={fieldErrors.phone}
          aria-invalid={!!fieldErrors.phone}
          slotProps={{ htmlInput: { dir: "ltr" } }}
        />
      </Box>
      <Box>
        <AdminDialogFieldLabel htmlFor={CREATE_COUNTRY_ID} text={labels.createDialog.country} required />
        <TextField
          id={CREATE_COUNTRY_ID}
          fullWidth
          value={form.country}
          onChange={e => setForm({ ...form, country: e.target.value })}
          placeholder={labels.createDialog.country}
          required
          error={!!fieldErrors.country}
          helperText={fieldErrors.country}
          aria-invalid={!!fieldErrors.country}
        />
      </Box>
      <AdminUserGenderSelect
        labels={labels}
        id={CREATE_GENDER_ID}
        label={labels.createDialog.gender}
        value={form.gender}
        onChange={gender => setForm({ ...form, gender })}
        // The create dialog never projected a gender field error
        // before the restyle — `undefined` keeps that behavior.
        error={undefined}
      />
      <Box sx={{ gridColumn: "1 / -1" }}>
        <CreateUserCredentialField
          labels={labels}
          value={form.password}
          onChange={password => setForm({ ...form, password })}
          error={fieldErrors.password}
        />
      </Box>
    </Box>
  );
}
