"use client";

/**
 * The rubric dialog's notice lanes — split out of `RubricEvaluationDialog.tsx`
 * (lint caps). Two self-contained render pieces:
 *
 * 1. {@link RubricDraftRestoredNotice} — the restored-draft provenance
 *    notice: one glance of "where did these values come from?" (sharpened
 *    by the saved-at caption when the envelope carries a stamp), retired by
 *    the first edit so it never outlives its purpose.
 * 2. {@link RubricVerdictImpactLane} — the verdict-impact callout: the band
 *    chip names the verdict, this names its CONSEQUENCE (the pipeline step
 *    vs the weakness-driven waiting period). A tinted M3 container lane so
 *    the consequence reads as a lane of its own rather than a flat box.
 *
 * Both resolve their copy through the Sessions namespace handles (never
 * hardcoded), style through theme-palette callbacks only, and gate their
 * motion behind `prefers-reduced-motion`.
 */

import {
  HistoryOutlined,
  RateReviewOutlined,
  SaveOutlined,
  ScheduleOutlined,
  TrendingUpOutlined,
} from "@mui/icons-material";
import { Alert, Button, DialogActions, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import type { rubricSavedAtStamps } from "@/frontend/views/teacher/sessions/rubricEvaluationDialog.helpers";
import { Sessions, useAppTranslation } from "@/shared/locale";

/** The saved-at stamp pair shape produced by {@link rubricSavedAtStamps}. */
type RubricSavedAtStamps = ReturnType<typeof rubricSavedAtStamps>;

/**
 * The restored-draft notice — the entrance is registered + referenced
 * under the motion gate; the resting composition is identical with or
 * without animation support. `stamps` is null when the parked envelope
 * predates the stamp (the caption lane simply hides).
 */
export function RubricDraftRestoredNotice({
  stamps,
  onDiscard,
}: Readonly<{
  stamps: RubricSavedAtStamps | null;
  onDiscard: () => void;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  return (
    <Alert
      severity="info"
      variant="outlined"
      icon={<HistoryOutlined fontSize="small" />}
      data-testid="rubric-draft-restored-notice"
      action={
        <Button
          type="button"
          size="small"
          onClick={onDiscard}
          data-testid="rubric-draft-discard"
          sx={{ minHeight: { xs: 44, sm: 32 }, px: 1.5 }}
        >
          {t.rubricDraftDiscardCta}
        </Button>
      }
      sx={theme => ({
        color: theme.palette.text.secondary,
        "& .MuiAlert-icon": { color: theme.palette.info.main },
        "@keyframes rubricDraftRestoredEnter": {
          from: { opacity: 0, transform: "translateY(-6px)" },
          to: { opacity: 1, transform: "translateY(0)" },
        },
        "@media (prefers-reduced-motion: no-preference)": {
          animation: "rubricDraftRestoredEnter 320ms ease-out both",
        },
      })}
    >
      <Stack sx={{ gap: 0.25 }}>
        <Typography variant="body2">{t.rubricDraftRestoredNotice}</Typography>
        {stamps === null ? null : (
          // The saved-at lane — the label + value glance riding above the
          // indented absolute precision line (aligned to the label's text
          // edge through the logical inline pad, so the glyph never mirrors
          // under RTL). The value slot carries the relative caption inside
          // the window and the absolute stamp beyond it; the precision line
          // only ever rides WITH a relative glance (out-of-window drafts
          // already read absolutely on the glance line).
          <Stack sx={{ gap: 0.25, paddingInlineStart: 2.25 }}>
            <Typography
              variant="caption"
              component="span"
              data-testid="rubric-draft-saved-at"
              sx={theme => ({
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                fontVariantNumeric: "tabular-nums",
                color: theme.palette.text.disabled,
              })}
            >
              <SaveOutlined aria-hidden sx={{ fontSize: 14 }} />
              {t.rubricDraftSavedAtLabel}
              <span aria-hidden>·</span>
              {stamps.relative ?? stamps.absolute}
            </Typography>
            {stamps.relative === null ? null : (
              <Typography
                variant="caption"
                component="span"
                data-testid="rubric-draft-saved-at-absolute"
                sx={theme => ({
                  fontVariantNumeric: "tabular-nums",
                  color: theme.palette.text.disabled,
                  fontSize: "0.6875rem",
                })}
              >
                {stamps.absolute}
              </Typography>
            )}
          </Stack>
        )}
      </Stack>
    </Alert>
  );
}

/**
 * The verdict-impact callout — rendered only while the draft carries a
 * legal score, so an empty draft never presumes an outcome. The lane is a
 * tinted M3 container (the ApplicantStatusShell recipe): container bg +
 * on-container copy + the severity tone kept for the icon and the border.
 */
export function RubricVerdictImpactLane({
  score,
  weaknessRequired,
}: Readonly<{
  score: number | null;
  weaknessRequired: boolean;
}>): ReactNode {
  const t = useAppTranslation(Sessions);
  if (score === null) return null;
  return (
    <Alert
      severity={weaknessRequired ? "warning" : "success"}
      variant="outlined"
      icon={weaknessRequired ? <ScheduleOutlined fontSize="small" /> : <TrendingUpOutlined fontSize="small" />}
      sx={theme => ({
        borderRadius: 2,
        bgcolor: weaknessRequired ? theme.palette.warningContainer : theme.palette.successContainer,
        color: weaknessRequired ? theme.palette.onWarningContainer : theme.palette.onSuccessContainer,
        borderColor: weaknessRequired ? theme.palette.warning.main : theme.palette.success.main,
        "& .MuiAlert-icon": {
          color: weaknessRequired ? theme.palette.warning.main : theme.palette.success.main,
        },
        "@media (prefers-reduced-motion: no-preference)": {
          transition: "background-color 240ms ease, border-color 240ms ease",
        },
      })}
    >
      {weaknessRequired ? t.rubricImpactFail : t.rubricImpactPass}
    </Alert>
  );
}

/**
 * The rubric submit affordance — the dialog's ONE contained action. Lives
 * here (beside the other dialog lanes) with the actions-row spacing so the
 * shell file stays inside the lint budgets.
 */
export function RubricSubmitButton({
  submitting,
  submitLabel,
}: Readonly<{
  submitting: boolean;
  submitLabel: string;
}>): ReactNode {
  return (
    <DialogActions sx={{ px: 3, pb: 3, pt: 2, gap: 1.5 }}>
      <Button
        type="submit"
        variant="contained"
        loading={submitting}
        autoFocus
        startIcon={<RateReviewOutlined />}
        sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
      >
        {submitLabel}
      </Button>
    </DialogActions>
  );
}
