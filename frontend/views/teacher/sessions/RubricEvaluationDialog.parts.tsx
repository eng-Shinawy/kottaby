"use client";

/**
 * Presentational fields for the evaluator's rubric dialog — the identical
 * score / notes / weakness trio the dialog composes. Each field owns its
 * compile-time copy (label, the localized inline error, the helper line),
 * mirrors its error flag onto `aria-invalid`, and keeps helper text in the
 * secondary text tone (error helpers keep the error tone).
 *
 * The weakness field is rendered BY THE DIALOG only while the entered
 * score sits below the pass threshold — the iff rule lives with the draft
 * state, not with the control.
 */

import { Box, Chip, FormControl, FormHelperText, InputLabel, MenuItem, Select, TextField } from "@mui/material";
import { type ReactNode, useId } from "react";
import { RubricWeaknessArea } from "@/frontend/graphql/generated/gql/graphql";
import { parseRubricScore } from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";
import { RUBRIC_NOTES_MAX_LENGTH, RUBRIC_PASS_THRESHOLD } from "@/shared/constants";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/** The weakness options in their stable wire order. */
const WEAKNESS_OPTIONS: readonly RubricWeaknessArea[] = [RubricWeaknessArea.Tajweed, RubricWeaknessArea.Hifz];

interface RubricFieldProps {
  /** The raw draft (controlled by the dialog). */
  readonly value: string;
  /** Raw-value change intent — the dialog owns validation-flag relief. */
  readonly onChange: (value: string) => void;
  /** Raised when a submit carried an invalid value. */
  readonly error: boolean;
  readonly disabled: boolean;
}

/** The 0..100 whole-number score field (`type="number"` band hints). */
export function RubricScoreField({ value, onChange, error, disabled }: Readonly<RubricFieldProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  // Live band preview — mirrors the server's derived verdict so the
  // evaluator sees the threshold consequence before submitting. The strict
  // decimal parse keeps the preview and the wire value identical.
  const parsedScore = parseRubricScore(value);
  const isPassing = parsedScore !== null && parsedScore >= RUBRIC_PASS_THRESHOLD;
  let bandCopy: string | null = null;
  if (parsedScore !== null) {
    bandCopy = isPassing ? t.rubricScoreBandPassing : t.rubricScoreBandFailing;
  }
  return (
    <TextField
      label={t.rubricScoreLabel}
      type="number"
      value={value}
      onChange={event => onChange(event.target.value)}
      error={error}
      aria-invalid={error}
      helperText={
        error ? (
          te.rubricScoreInvalid
        ) : (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center" }}>
            {bandCopy === null ? null : (
              <Chip
                component="span"
                size="small"
                variant="outlined"
                color={isPassing ? "success" : "warning"}
                label={bandCopy}
                sx={theme => ({
                  height: 20,
                  borderColor: isPassing ? theme.palette.success.main : theme.palette.warning.main,
                  "& .MuiChip-label": { px: 1, typography: "caption" },
                })}
              />
            )}
          </Box>
        )
      }
      disabled={disabled}
      slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
      sx={theme => ({
        "& .MuiFormHelperText-root:not(.Mui-error)": { color: theme.palette.text.secondary },
      })}
    />
  );
}

/** The multiline observations field with the shared notes cap + live counter. */
export function RubricNotesField({ value, onChange, error, disabled }: Readonly<RubricFieldProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  // The counter escalates as the draft approaches the cap — secondary at
  // rest, warning inside the last 10%, error tone pinned at the cap.
  const notesRatio = value.length / RUBRIC_NOTES_MAX_LENGTH;
  // Severity ladder as sequential guards (the nested ternary reads worse
  // and the lint forbids it): error at the cap, warning near it, muted rest.
  let counterColor: string = "text.secondary";
  if (notesRatio >= 0.9) counterColor = "warning.main";
  if (notesRatio >= 1) counterColor = "error.main";
  return (
    <TextField
      label={t.rubricNotesLabel}
      value={value}
      onChange={event => onChange(event.target.value)}
      multiline
      minRows={3}
      error={error}
      aria-invalid={error}
      helperText={
        error ? (
          te.rubricNotesRequired
        ) : (
          <Box component="span" sx={{ color: counterColor }}>
            {value.length} / {RUBRIC_NOTES_MAX_LENGTH}
          </Box>
        )
      }
      disabled={disabled}
      slotProps={{ htmlInput: { maxLength: RUBRIC_NOTES_MAX_LENGTH } }}
      sx={theme => ({
        "& .MuiFormHelperText-root:not(.Mui-error)": { color: theme.palette.text.secondary },
      })}
    />
  );
}

interface RubricWeaknessFieldProps {
  /** The picked weakness area, or null while nothing is chosen. */
  readonly value: RubricWeaknessArea | null;
  /** Pick intent — the dialog owns validation-flag relief. */
  readonly onChange: (value: RubricWeaknessArea | null) => void;
  /** Raised when a below-threshold submit carried no weakness area. */
  readonly error: boolean;
  readonly disabled: boolean;
}

/** The Tajweed/Hifz weakness pick — the dialog renders it only below the threshold. */
export function RubricWeaknessField({
  value,
  onChange,
  error,
  disabled,
}: Readonly<RubricWeaknessFieldProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const weaknessLabelId = useId();
  const weaknessLabels: Readonly<Record<RubricWeaknessArea, string>> = {
    [RubricWeaknessArea.Tajweed]: t.rubricWeaknessTajweed,
    [RubricWeaknessArea.Hifz]: t.rubricWeaknessHifz,
  };
  const handlePick = (picked: RubricWeaknessArea | ""): void => onChange(picked === "" ? null : picked);
  return (
    <FormControl fullWidth required error={error} disabled={disabled}>
      <InputLabel id={weaknessLabelId}>{t.rubricWeaknessLabel}</InputLabel>
      <Select
        labelId={weaknessLabelId}
        label={t.rubricWeaknessLabel}
        value={value ?? ""}
        onChange={event => handlePick(event.target.value)}
      >
        {WEAKNESS_OPTIONS.map(option => (
          <MenuItem key={option} value={option}>
            {weaknessLabels[option]}
          </MenuItem>
        ))}
      </Select>
      <FormHelperText>{error ? te.rubricWeaknessRequired : t.rubricWeaknessHelper}</FormHelperText>
    </FormControl>
  );
}
