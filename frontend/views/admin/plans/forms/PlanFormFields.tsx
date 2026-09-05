/**
 * PlanFormFields — Editable field set for the plan create/edit dialog.
 *
 * Extracted from PlanFormDialog (Task 4.4).
 *  - Client & server validation with field-level error messages
 *  - Accessible form fields with `aria-invalid`
 */

"use client";

import { Stack, TextField } from "@mui/material";
import type { PlanFormState } from "@/frontend/views/admin/plans/hooks/usePlanForm";
import { useAppTranslation } from "@/shared/locale/client";
import { Plans } from "@/shared/locale/namespaces/plans";

export interface PlanFormFieldsProps {
  readonly form: PlanFormState;
  readonly loading: boolean;
  readonly onFieldChange: (field: keyof PlanFormState) => (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly fieldError: (field: keyof PlanFormState) => string | undefined;
}

export function PlanFormFields({ form, loading, onFieldChange, fieldError }: PlanFormFieldsProps): React.ReactElement {
  const t = useAppTranslation(Plans);

  return (
    <>
      <TextField
        label={t.titleFieldLabel}
        placeholder={t.titleFieldPlaceholder}
        value={form.title}
        onChange={onFieldChange("title")}
        error={Boolean(fieldError("title"))}
        helperText={fieldError("title")}
        aria-invalid={Boolean(fieldError("title"))}
        fullWidth
        required
        disabled={loading}
      />

      <Stack sx={{ flexDirection: { xs: "column", sm: "row" }, gap: 2 }}>
        <TextField
          label={t.sessionCountFieldLabel}
          type="number"
          value={form.sessionCount}
          onChange={onFieldChange("sessionCount")}
          error={Boolean(fieldError("sessionCount"))}
          helperText={fieldError("sessionCount")}
          aria-invalid={Boolean(fieldError("sessionCount"))}
          fullWidth
          required
          disabled={loading}
        />

        <TextField
          label={t.intervalDaysFieldLabel}
          type="number"
          value={form.intervalDays}
          onChange={onFieldChange("intervalDays")}
          error={Boolean(fieldError("intervalDays"))}
          helperText={fieldError("intervalDays")}
          aria-invalid={Boolean(fieldError("intervalDays"))}
          fullWidth
          required
          disabled={loading}
        />
      </Stack>

      <Stack sx={{ flexDirection: { xs: "column", sm: "row" }, gap: 2 }}>
        <TextField
          label={t.priceFieldLabel}
          value={form.price}
          onChange={onFieldChange("price")}
          error={Boolean(fieldError("price"))}
          helperText={fieldError("price")}
          aria-invalid={Boolean(fieldError("price"))}
          fullWidth
          required
          disabled={loading}
        />

        <TextField
          label={t.currencyFieldLabel}
          value={form.currency}
          onChange={onFieldChange("currency")}
          error={Boolean(fieldError("currency"))}
          helperText={fieldError("currency")}
          aria-invalid={Boolean(fieldError("currency"))}
          fullWidth
          required
          disabled={loading}
        />
      </Stack>
    </>
  );
}
