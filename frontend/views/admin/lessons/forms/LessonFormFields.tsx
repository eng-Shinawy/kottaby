/**
 * LessonFormFields — Editable field set for the lesson create/edit dialog.
 *
 * Clone of the plans-admin `PlanFormFields` lineage, translated to lessons.
 * The lesson form's only editable field is `title` — the parent plan rides
 * the catalog's plan selector, never this form.
 *  - Field-level client & server errors via `titleError` helper text
 *  - Accessible field with `aria-invalid`
 *  - `required` renders the visual marker only — the wrapping form is
 *    `noValidate`, so enforcement is programmatic in `LessonFormContent`
 *    (trim + empty check + the mirrored 255-char ceiling)
 */

"use client";

import { Stack, TextField } from "@mui/material";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

export interface LessonFormState {
  readonly title: string;
}

export interface LessonFormFieldsProps {
  readonly form: LessonFormState;
  readonly loading: boolean;
  readonly onTitleChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  readonly titleError: string | undefined;
}

export function LessonFormFields({
  form,
  loading,
  onTitleChange,
  titleError,
}: LessonFormFieldsProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  return (
    <Stack sx={{ gap: 2.5 }}>
      <TextField
        label={t.titleFieldLabel}
        placeholder={t.titleFieldPlaceholder}
        value={form.title}
        onChange={onTitleChange}
        error={Boolean(titleError)}
        helperText={titleError}
        aria-invalid={Boolean(titleError)}
        fullWidth
        required
        disabled={loading}
      />
    </Stack>
  );
}
