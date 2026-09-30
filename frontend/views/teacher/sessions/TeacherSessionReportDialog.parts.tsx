"use client";

/**
 * Presentational parts for the teacher session-report submission dialog.
 * Mode-resolved sections rendered by `TeacherSessionReportDialog`:
 *  - `AssignmentBlock` — Jadid/Madi sub-forms (ayah span + SurahJuz picker)
 *  - `ReviewState` — read-only report display
 * The grade-previous block and history list are kept inline in the dialog
 * because they share the form-state setters the dialog owns.
 */

import { FormControl, InputLabel, MenuItem, Rating, Select, Stack, TextField, Typography } from "@mui/material";
import { memo, type ReactNode, useId } from "react";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { HomeWorkBlockInput } from "@/backend/types";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** The 35-member Surah/Juz vocabulary for the dialog's `Select`. */
const SURAH_JUZ_OPTIONS: readonly SurahJuzRef[] = Object.values(SurahJuzRef);

interface AssignmentBlockProps {
  readonly title: string;
  readonly fromAyahLabel: string;
  readonly toAyahLabel: string;
  readonly surahJuzPickerLabel: string;
  readonly block: HomeWorkBlockInput | null;
  readonly onChange: (block: HomeWorkBlockInput | null) => void;
  readonly t: SessionsLabels;
}

/**
 * Bolt Performance Optimization:
 * Wrapped AssignmentBlock with React.memo to prevent unnecessary re-renders of sub-forms
 * (such as Jadid when Madi/teacher notes/ratings change, or vice versa).
 */
export const AssignmentBlock = memo(function AssignmentBlock({
  title,
  fromAyahLabel,
  toAyahLabel,
  surahJuzPickerLabel,
  block,
  onChange,
  t,
}: Readonly<AssignmentBlockProps>): ReactNode {
  const defaultSurah = SurahJuzRef.SurahAlFatihah;
  // Per-instance label id: the block renders twice (Jadid + Madi), so a
  // static id would duplicate across the dialog and break the association.
  const surahJuzLabelId = useId();
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="subtitle2">{title}</Typography>
      <Stack sx={{ flexDirection: "row", gap: 1 }}>
        <TextField
          label={fromAyahLabel}
          type="number"
          value={block?.fromAyah ?? ""}
          onChange={event => handleAyahChange(event.target.value, "fromAyah", block, onChange, defaultSurah)}
        />
        <TextField
          label={toAyahLabel}
          type="number"
          value={block?.toAyah ?? ""}
          onChange={event => handleAyahChange(event.target.value, "toAyah", block, onChange, defaultSurah)}
        />
      </Stack>
      {/* A bare `Select` ignores its `label` prop — the FormControl +
          InputLabel pairing is what actually renders the floating label
          (previously the pickers rendered as unlabeled empty boxes). The
          labelId wires the visible label to the control for screen readers. */}
      <FormControl fullWidth size="small">
        <InputLabel id={surahJuzLabelId}>{surahJuzPickerLabel}</InputLabel>
        <Select
          labelId={surahJuzLabelId}
          label={surahJuzPickerLabel}
          value={block?.surahJuz ?? ""}
          onChange={event => handleSurahChange(event.target.value, block, onChange)}
        >
          {SURAH_JUZ_OPTIONS.map(option => (
            <MenuItem key={option} value={option}>
              {t.surahJuzLabel(option)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    </Stack>
  );
});

function handleAyahChange(
  value: string,
  field: "fromAyah" | "toAyah",
  block: HomeWorkBlockInput | null,
  onChange: (block: HomeWorkBlockInput | null) => void,
  defaultSurah: SurahJuzRef
): void {
  if (value === "") {
    onChange(null);
    return;
  }
  const num = Number(value);
  if (!Number.isSafeInteger(num)) return;
  const base = block ?? { fromAyah: 0, toAyah: 0, surahJuz: defaultSurah };
  onChange({ ...base, [field]: num });
}

function handleSurahChange(
  value: SurahJuzRef | "",
  block: HomeWorkBlockInput | null,
  onChange: (block: HomeWorkBlockInput | null) => void
): void {
  if (value === "") {
    onChange(null);
    return;
  }
  const base = block ?? { fromAyah: 0, toAyah: 0, surahJuz: SurahJuzRef.SurahAlFatihah };
  onChange({ ...base, surahJuz: value });
}

interface ReviewStateProps {
  readonly report: { readonly teacherNotes: string; readonly studentRatingByTeacher: number };
  readonly t: SessionsLabels;
}

export function ReviewState({ report, t }: Readonly<ReviewStateProps>): ReactNode {
  return (
    <Stack sx={{ gap: 1 }}>
      <Typography variant="subtitle2">{t.reportReviewedNotesLabel}</Typography>
      <Typography variant="body2">{report.teacherNotes}</Typography>
      <Typography variant="subtitle2">{t.reportReviewedRatingLabel}</Typography>
      <Rating value={report.studentRatingByTeacher} readOnly />
    </Stack>
  );
}
