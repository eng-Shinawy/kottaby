/**
 * LessonFormContent — Dialog body (title, fields, actions) for lesson
 * create/edit.
 *
 * Clone of the plans-admin `PlanFormContent`/`usePlanForm` lineage, translated
 * to lessons.
 *  - Unified create/edit flow (state initialized from `lesson` via the `key`
 *    prop on the parent dialog)
 *  - Programmatic client-side validation (`noValidate` form): trimmed-empty
 *    and over-cap titles are rejected locally with a localized field error
 *    before the first submit rides the wire
 *  - Submission driven by `useLessonFormDialog`'s submit handler
 *  - Server field errors surfaced on the title field's helper text
 *  - In-flight double-submit mitigation via the `loading` prop
 */

"use client";

import { useState } from "react";
import type { PlanLessonsQuery } from "@/frontend/graphql/generated/gql/graphql";
import { FormDialogShell } from "@/frontend/views/admin/forms/FormDialogShell";
import { LessonFormFields, type LessonFormState } from "@/frontend/views/admin/lessons/forms/LessonFormFields";
import type { LessonFormSubmitInput } from "@/frontend/views/admin/lessons/hooks/useLessonFormDialog";
import { useAppTranslation } from "@/shared/locale/client";
import { Lessons } from "@/shared/locale/namespaces/lessons";

type LessonItem = PlanLessonsQuery["planLessons"][number];

/**
 * Upper bound on a lesson title (255 chars) — mirrors the server-side
 * ceiling (`lesson.helpers.ts`'s trimmed-length check behind
 * LESSON_TITLE_TOO_LONG) so an over-cap value is rejected client-side by
 * `validate()` with the field's own localized message instead of
 * round-tripping into the generic server validation error. The literal is
 * deliberately DUPLICATED, never imported: the server helper is backend
 * runtime machinery that must not ride into the client bundle. The server
 * ceiling stays the authority — a drift here degrades to the server's
 * localized field error, never to a persisted over-cap title.
 */
const LESSON_TITLE_MAX_LENGTH = 255;

type LessonFormClientErrors = {
  -readonly [K in keyof LessonFormState]?: string;
};

export interface LessonFormContentProps {
  readonly lesson: LessonItem | null;
  readonly loading: boolean;
  readonly globalError?: string | null;
  readonly serverFieldErrors?: Record<string, string>;
  readonly onClose: () => void;
  readonly onSubmit: (input: LessonFormSubmitInput) => Promise<void>;
}

export function LessonFormContent({
  lesson,
  loading,
  globalError,
  serverFieldErrors,
  onClose,
  onSubmit,
}: LessonFormContentProps): React.ReactElement {
  const t = useAppTranslation(Lessons);

  const [form, setForm] = useState<LessonFormState>(() => ({
    title: lesson?.title ?? "",
  }));

  const [clientErrors, setClientErrors] = useState<LessonFormClientErrors>({});

  const dialogTitle = lesson ? t.editLessonDialogTitle : t.createLessonDialogTitle;
  const titleError = clientErrors.title ?? serverFieldErrors?.title;

  const handleTitleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setForm(prev => ({ ...prev, title: event.target.value }));
    if (clientErrors.title) {
      setClientErrors(prev => ({ ...prev, title: undefined }));
    }
  };

  const validate = (): boolean => {
    const errors: LessonFormClientErrors = {};
    const trimmedTitle = form.title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > LESSON_TITLE_MAX_LENGTH) {
      errors.title = t.validationTitleMessage;
    }
    setClientErrors(errors);
    return errors.title === undefined;
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!validate()) {
      return;
    }
    await onSubmit({ title: form.title.trim() });
  };

  return (
    <FormDialogShell
      titleId="lesson-form-dialog-title"
      dialogTitle={dialogTitle}
      labels={{ cancel: t.cancelButton, save: t.saveButton, saving: t.savingButton }}
      loading={loading}
      globalError={globalError}
      onClose={onClose}
      onSubmit={handleSubmit}
    >
      <LessonFormFields form={form} loading={loading} onTitleChange={handleTitleChange} titleError={titleError} />
    </FormDialogShell>
  );
}
