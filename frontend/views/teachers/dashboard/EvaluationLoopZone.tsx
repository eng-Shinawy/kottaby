"use client";

import { useQuery } from "@apollo/client/react";
import { EventAvailableOutlined as BookIcon } from "@mui/icons-material";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/applicant.documents";
import { myEvaluationLoopStatusQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import { EvaluationBookingDialog } from "@/frontend/views/teachers/dashboard/EvaluationBookingDialog";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants";
import { Applicant, Errors, useAppLocale, useAppTranslation } from "@/shared/locale";

/**
 * Zero-shape rendered while the loop status is absent on the wire
 * (`myEvaluationLoopStatus: null`): a fresh five-credit cycle with nothing
 * booked — the only truthful no-progress answer for an in-evaluation
 * applicant.
 */
const ZERO_LOOP_STATUS = {
  bookedCount: 0,
  completedCount: 0,
  remainingCredits: VERIFICATION_PLAN_SESSION_COUNT,
  cycleStartDate: null,
} as const;

/**
 * EvaluationLoopZone — the in-evaluation loop progress surface composed
 * into the applicant status card's `InEvaluation` branch (between the
 * attempts row and the reminder prompt).
 *
 * Self-contained client component: NO props and NO locally derived
 * lifecycle booleans — the zero-argument `myEvaluationLoopStatus` read
 * answers identity server-side, and the `myApplicantProfile` read is
 * remounted here only for its refetch handle (the card owns the same
 * document, so the cache is shared and refetches re-render both).
 *
 * Renders the localized progress line (`evaluationProgressLine` — the
 * compile-time interpolation function carrying `{booked, completed,
 * remaining, total}`; `total` derives as booked + remaining, the current
 * cycle's credit ceiling), a completed-sessions determinate bar, and the
 * single booking CTA that opens `EvaluationBookingDialog` (dialog open
 * state is local to this zone). A settled error with no data renders the
 * status card's inline error lane (`errors.internalServerError`) instead
 * of a fabricated zero-shape progress line — the null-wire zero-shape
 * (plan-mandated) is untouched.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through theme
 * palette callbacks, `*Outlined` icons, RTL-safe logical composition, and
 * every user-facing string resolved through the compile-time `Applicant`
 * namespace handle (property access only).
 */
export function EvaluationLoopZone(): ReactNode {
  const t = useAppTranslation(Applicant);
  const te = useAppTranslation(Errors);
  const locale = useAppLocale();
  const [bookingOpen, setBookingOpen] = useState(false);
  const {
    data: loopData,
    loading: loopLoading,
    error: loopError,
    refetch: refetchLoopStatus,
  } = useQuery(myEvaluationLoopStatusQueryDocument);
  const { refetch: refetchProfile } = useQuery(myApplicantProfileQueryDocument);

  const status = loopData?.myEvaluationLoopStatus ?? ZERO_LOOP_STATUS;
  const booked = status.bookedCount;
  const completed = status.completedCount;
  const remaining = status.remainingCredits;
  const total = booked + remaining;
  // The determinate bar lives in 0..100 — the wire's counts are clamped
  // server-side (the remaining-credit floor), and this belt keeps a
  // hypothetically over-ceiling completed count from ever painting an
  // out-of-range value (MUI dev-warns a console error on one).
  const progressPercent = total === 0 ? 0 : Math.min(100, Math.max(0, (completed / total) * 100));

  // Loading → indeterminate bar; settled error with no data → the status
  // card's inline error lane (never a fabricated zero-shape progress line);
  // otherwise → the localized progress line + determinate bar.
  let loopReadBlock: ReactNode;
  if (loopLoading) {
    loopReadBlock = <LinearProgress aria-label={t.evaluationZoneTitle} />;
  } else if (loopError && !loopData) {
    loopReadBlock = (
      <Alert severity="error" variant="outlined">
        {te.internalServerError}
      </Alert>
    );
  } else {
    // The cycle-start provenance caption — the wire's cycleStartDate (the
    // active subscription window's start) rendered once beside the shared
    // deterministic stamp formatter; absent on the zero-shape (no cycle).
    const cycleStartIso = status.cycleStartDate;
    loopReadBlock = (
      <>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.evaluationProgressLine(booked, completed, remaining, total)}
        </Typography>
        {cycleStartIso === null ? null : (
          <Typography
            variant="caption"
            component="span"
            data-testid="evaluation-cycle-start"
            sx={theme => ({
              display: "inline-flex",
              alignItems: "center",
              gap: 0.5,
              fontVariantNumeric: "tabular-nums",
              color: theme.palette.text.disabled,
            })}
          >
            {t.evaluationCycleStartCaption}
            <span aria-hidden>·</span>
            {formatApplicantDate(cycleStartIso, locale)}
          </Typography>
        )}
        <LinearProgress
          variant="determinate"
          value={progressPercent}
          aria-label={t.evaluationZoneTitle}
          sx={theme => ({
            height: 8,
            borderRadius: 4,
            backgroundColor: theme.palette.action.hover,
            // The finished leg tints success: an at-or-past-ceiling bar
            // reads as "cycle consumed", not as a neutral percentage.
            "& .MuiLinearProgress-bar1": {
              borderRadius: 4,
              backgroundColor:
                completed > 0 && completed >= total ? theme.palette.success.main : theme.palette.primary.main,
            },
          })}
        />
      </>
    );
  }

  return (
    <Stack spacing={1.5} sx={{ alignItems: "flex-start", width: "100%" }}>
      <Stack spacing={0.5} sx={{ width: "100%", minWidth: 200 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {t.evaluationZoneTitle}
        </Typography>
        {loopReadBlock}
      </Stack>
      <Button
        variant="contained"
        startIcon={<BookIcon />}
        onClick={() => {
          setBookingOpen(true);
        }}
        sx={{ minHeight: 44, px: 3 }}
      >
        {t.bookEvaluationCta}
      </Button>
      <EvaluationBookingDialog
        open={bookingOpen}
        onClose={() => {
          setBookingOpen(false);
        }}
        refetchLoopStatus={refetchLoopStatus}
        refetchProfile={refetchProfile}
      />
    </Stack>
  );
}
