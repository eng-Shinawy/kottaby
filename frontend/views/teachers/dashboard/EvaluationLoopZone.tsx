"use client";

import { useQuery } from "@apollo/client/react";
import { EventAvailableOutlined as BookIcon } from "@mui/icons-material";
import { Alert, Button, LinearProgress, Stack, Typography } from "@mui/material";
import { type ReactNode, useState } from "react";
import { myApplicantProfileQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/applicant.documents";
import { myEvaluationLoopStatusQueryDocument } from "@/frontend/graphql/sharedDocuments/teachers/evaluation-booking.documents";
import { EvaluationBookingDialog } from "@/frontend/views/teachers/dashboard/EvaluationBookingDialog";
import { VERIFICATION_PLAN_SESSION_COUNT } from "@/shared/constants";
import { Applicant, Errors, useAppTranslation } from "@/shared/locale";

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
    loopReadBlock = (
      <>
        <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
          {t.evaluationProgressLine(booked, completed, remaining, total)}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={total === 0 ? 0 : (completed / total) * 100}
          aria-label={t.evaluationZoneTitle}
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
