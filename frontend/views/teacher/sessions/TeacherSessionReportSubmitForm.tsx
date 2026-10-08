"use client";

/**
 * TeacherSessionReportSubmitForm — the form-state + handlers + the
 * `submit`/`prepare` mode body. Extracted from the main dialog file to
 * keep both files under the oxlint `max-lines` ceiling.
 */

import { Alert, Rating, Stack, TextField, Typography } from "@mui/material";
import { type ReactNode, useCallback } from "react";
import { TeacherSessionReportActions } from "@/frontend/views/teacher/sessions/TeacherSessionReportActions";
import { AssignmentBlock } from "@/frontend/views/teacher/sessions/TeacherSessionReportDialog.parts";
import type {
  FormGradeFields,
  resolveNewestRow,
  SessionReportFormState,
} from "@/frontend/views/teacher/sessions/teacherSessionReportDialog.helpers";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

interface PreviousGradesSectionProps {
  readonly form: SessionReportFormState;
  readonly handleGrade: (track: "currentGrade" | "revisionGrade", grade: number | null) => void;
  readonly t: SessionsLabels;
}

function PreviousGradesSection({ form, handleGrade, t }: Readonly<PreviousGradesSectionProps>): ReactNode {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="subtitle2">{t.gradePreviousSectionTitle}</Typography>
      <TextField
        label={t.reportGradeJadidLabel}
        type="number"
        value={form.previousGrades?.currentGrade ?? ""}
        onChange={event => handleGrade("currentGrade", event.target.value === "" ? null : Number(event.target.value))}
      />
      <TextField
        label={t.reportGradeMadiLabel}
        type="number"
        value={form.previousGrades?.revisionGrade ?? ""}
        onChange={event => handleGrade("revisionGrade", event.target.value === "" ? null : Number(event.target.value))}
      />
    </Stack>
  );
}

interface SubmitFormProps {
  readonly mode: "prepare" | "submit";
  readonly form: SessionReportFormState;
  readonly setForm: React.Dispatch<React.SetStateAction<SessionReportFormState>>;
  readonly t: SessionsLabels;
  readonly newestRow: ReturnType<typeof resolveNewestRow>;
  readonly isNewestUngraded: boolean;
  readonly submitLoading: boolean;
  readonly onClose: () => void;
}

export function SubmitForm({
  mode,
  form,
  setForm,
  t,
  newestRow,
  isNewestUngraded,
  submitLoading,
  onClose,
}: Readonly<SubmitFormProps>): ReactNode {
  const handleNotes = useCallback((notes: string) => setForm(prev => ({ ...prev, teacherNotes: notes })), [setForm]);
  const handleRating = useCallback(
    (rating: number | null) => setForm(prev => ({ ...prev, studentRatingByTeacher: rating })),
    [setForm]
  );
  const handleJadidBlock = useCallback(
    (block: SessionReportFormState["jadid"]) => setForm(prev => ({ ...prev, jadid: block })),
    [setForm]
  );
  const handleMadiBlock = useCallback(
    (block: SessionReportFormState["madi"]) => setForm(prev => ({ ...prev, madi: block })),
    [setForm]
  );
  const handleGrade = useCallback(
    (track: "currentGrade" | "revisionGrade", grade: number | null) =>
      setForm(prev => {
        const previous: FormGradeFields = prev.previousGrades ?? { currentGrade: null, revisionGrade: null };
        return { ...prev, previousGrades: { ...previous, [track]: grade } };
      }),
    [setForm]
  );
  return (
    <Stack sx={{ gap: 2 }}>
      <AssignmentBlock
        title={t.jadidSectionTitle}
        fromAyahLabel={t.fromAyahLabel}
        toAyahLabel={t.toAyahLabel}
        surahJuzPickerLabel={t.surahJuzPickerLabel}
        surahJuzSurahGroupLabel={t.surahJuzSurahGroupLabel}
        surahJuzJuzGroupLabel={t.surahJuzJuzGroupLabel}
        block={form.jadid ?? null}
        onChange={handleJadidBlock}
        t={t}
      />
      <AssignmentBlock
        title={t.madiSectionTitle}
        fromAyahLabel={t.fromAyahLabel}
        toAyahLabel={t.toAyahLabel}
        surahJuzPickerLabel={t.surahJuzPickerLabel}
        surahJuzSurahGroupLabel={t.surahJuzSurahGroupLabel}
        surahJuzJuzGroupLabel={t.surahJuzJuzGroupLabel}
        block={form.madi ?? null}
        onChange={handleMadiBlock}
        t={t}
      />
      {mode === "submit" ? (
        <Stack sx={{ gap: 1 }}>
          <TextField
            label={t.reportNotesLabel}
            placeholder={t.reportNotesPlaceholder}
            value={form.teacherNotes}
            onChange={event => handleNotes(event.target.value)}
            multiline
            rows={4}
          />
          <Typography variant="body2">{t.reportRatingLabel}</Typography>
          <Rating value={form.studentRatingByTeacher ?? 0} onChange={(_event, value) => handleRating(value)} />
        </Stack>
      ) : null}
      {mode === "submit" && newestRow && isNewestUngraded ? (
        <PreviousGradesSection form={form} handleGrade={handleGrade} t={t} />
      ) : null}
      {mode === "submit" && !newestRow ? <Alert severity="info">{t.reportFirstSessionHint}</Alert> : null}
      {mode === "submit" ? <TeacherSessionReportActions t={t} submitLoading={submitLoading} onClose={onClose} /> : null}
    </Stack>
  );
}
