"use client";

import { CheckCircleOutlined as CheckCircleIcon } from "@mui/icons-material";
import { Alert, Box, FormControl, FormHelperText, InputLabel, MenuItem, Select, Typography } from "@mui/material";
import type { FieldErrors, UseControllerReturn } from "react-hook-form";
import type { RecitationReading, RegisterPublicRole } from "@/frontend/graphql/generated/gql/graphql";
import {
  getRoleSelectDescribedBy,
  helperTextSx,
  RecitationSelector,
  type RegisterFormValues,
  roleFromSelectValue,
  SectionLabel,
} from "@/frontend/views/auth/register";
import type { AuthLabels } from "@/shared/locale/types/auth";
import type { RecitationLabels } from "@/shared/locale/types/recitation";

interface RegisterPreferencesSectionProps {
  readonly t: AuthLabels;
  readonly tRecitation: RecitationLabels;
  readonly errors: FieldErrors<RegisterFormValues>;
  readonly roleField: UseControllerReturn<RegisterFormValues, "role">;
  readonly selectedRole: RegisterPublicRole | "";
  readonly roleHelperText: string;
  readonly selectedRecitation: RecitationReading | "";
  readonly preferredRecitationField: UseControllerReturn<RegisterFormValues, "preferredRecitation">;
  readonly recitationOptions: readonly RecitationReading[];
  readonly recitationLoading: boolean;
  readonly errorMessage: string | null;
  readonly successMessage: string | null;
}

/**
 * RegisterForm's "Preferences" section: the required role select (with its
 * explicit aria-describedby helper-id wiring), the recitation-reading
 * (Qira'ah) selector, and the submit banner alerts.
 */
export function RegisterPreferencesSection({
  t,
  tRecitation,
  errors,
  roleField,
  selectedRole,
  roleHelperText,
  selectedRecitation,
  preferredRecitationField,
  recitationOptions,
  recitationLoading,
  errorMessage,
  successMessage,
}: RegisterPreferencesSectionProps) {
  return (
    <>
      <SectionLabel>{t.preferencesSection}</SectionLabel>
      <FormControl fullWidth required error={Boolean(errors.role)}>
        <InputLabel>{t.role}</InputLabel>
        <Select<RegisterPublicRole | "">
          label={t.role}
          name={roleField.field.name}
          inputRef={roleField.field.ref}
          onBlur={roleField.field.onBlur}
          value={selectedRole}
          onChange={event => roleField.field.onChange(roleFromSelectValue(event.target.value))}
          // Wire the error-helper id explicitly so SR users get
          // the message when the select is focused (see helper below).
          aria-describedby={getRoleSelectDescribedBy(Boolean(errors.role))}
        >
          <MenuItem value="Student">{t.roleStudent}</MenuItem>
          <MenuItem value="Teacher">{t.roleTeacher}</MenuItem>
          <MenuItem value="Parent">{t.roleParent}</MenuItem>
        </Select>
        {/* Explicit taller line-height so two-line helper
            copy (Arabic role descriptions) keeps legible line boxes. */}
        {errors.role ? (
          <FormHelperText error id="register-role-error-helper" aria-live="polite" sx={helperTextSx}>
            {errors.role.message}
          </FormHelperText>
        ) : null}
        {!errors.role && roleHelperText ? (
          <FormHelperText id="register-role-help" aria-live="polite" sx={helperTextSx}>
            {roleHelperText}
          </FormHelperText>
        ) : null}
      </FormControl>

      {/* Recitation reading (Qira'ah) selector — premium card grid.
          Guardrail: NOT persisted to `recitation` table (session-linked). */}
      <Box>
        {/* variant=subtitle2 defaulted to an <h6> element — a
            level-6 heading stranded mid-form (1→6 jump). Same look, no
            false outline entry. */}
        <Typography
          component="p"
          variant="subtitle2"
          sx={{ mb: 1, fontWeight: 600, color: "var(--mui-palette-text-primary)" }}
        >
          {tRecitation.selectTitle}
        </Typography>
        <RecitationSelector
          value={selectedRecitation}
          onChange={reading => preferredRecitationField.field.onChange(reading)}
          labels={tRecitation}
          options={recitationOptions}
          loading={recitationLoading}
        />
        <FormHelperText sx={[{ mt: 1 }, helperTextSx]}>{tRecitation.selectHelper}</FormHelperText>
      </Box>

      {errorMessage ? (
        // Same radius token as the floating host toast that
        // accompanies this surface on masked failures.
        <Alert severity="error" variant="filled" sx={{ borderRadius: 2 }}>
          {errorMessage}
        </Alert>
      ) : null}

      {successMessage ? (
        <Alert severity="success" variant="filled" icon={<CheckCircleIcon />} sx={{ borderRadius: 2 }}>
          {successMessage}
        </Alert>
      ) : null}
    </>
  );
}
