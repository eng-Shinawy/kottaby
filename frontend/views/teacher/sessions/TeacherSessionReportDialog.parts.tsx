"use client";

/**
 * Presentational parts for the teacher session-report submission dialog.
 * Mode-resolved sections rendered by `TeacherSessionReportDialog`:
 *  - `AssignmentBlock` — Jadid/Madi sub-forms (ayah span + SurahJuz picker)
 *  - `ReviewState` — read-only report display
 * The grade-previous block and history list are kept inline in the dialog
 * because they share the form-state setters the dialog owns.
 */

import { Autocomplete, Rating, Stack, TextField, Typography } from "@mui/material";
import { memo, type ReactNode } from "react";
import { SurahJuzRef } from "@/backend/enum/shared/surah-juz-ref.enum";
import type { HomeWorkBlockInput } from "@/backend/types";
import type { SessionsLabels } from "@/shared/locale/types/sessions";

/** The full 144-member Surah/Juz vocabulary for the dialog's picker. */
const SURAH_JUZ_OPTIONS: SurahJuzRef[] = Object.values(SurahJuzRef);

interface AssignmentBlockProps {
  readonly title: string;
  readonly fromAyahLabel: string;
  readonly toAyahLabel: string;
  readonly surahJuzPickerLabel: string;
  readonly surahJuzSurahGroupLabel: string;
  readonly surahJuzJuzGroupLabel: string;
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
  surahJuzSurahGroupLabel,
  surahJuzJuzGroupLabel,
  block,
  onChange,
  t,
}: Readonly<AssignmentBlockProps>): ReactNode {
  const defaultSurah = SurahJuzRef.SurahAlFatihah;
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
      {/* A searchable picker over the 144-option vocabulary: a flat
          Select menu does not scale to 144 rows, so the Autocomplete's
          type-to-filter + grouped listbox takes over. The TextField from
          renderInput carries the floating label directly (and MUI wires
          its id association per instance — Jadid + Madi never collide). */}
      <Autocomplete
        fullWidth
        size="small"
        options={SURAH_JUZ_OPTIONS}
        groupBy={option => (option.startsWith("juz_") ? surahJuzJuzGroupLabel : surahJuzSurahGroupLabel)}
        getOptionLabel={option => t.surahJuzLabel(option)}
        value={block?.surahJuz ?? null}
        onChange={(_event, value) => handleSurahChange(value, block, onChange)}
        slotProps={{
          listbox: {
            sx: {
              // The Surahs/Ajzaa categorical boundary: a hairline above every
              // group label but the first keeps the 114/30 sections scannable
              // in a 144-option list (block-start border = RTL-safe).
              "& li:not(:first-child) .MuiAutocomplete-groupLabel": {
                borderBlockStart: "1px solid",
                borderColor: "var(--mui-palette-divider)",
              },
            },
          },
        }}
        renderInput={params => <TextField {...params} label={surahJuzPickerLabel} />}
      />
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
  value: SurahJuzRef | null,
  block: HomeWorkBlockInput | null,
  onChange: (block: HomeWorkBlockInput | null) => void
): void {
  if (value === null) {
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
