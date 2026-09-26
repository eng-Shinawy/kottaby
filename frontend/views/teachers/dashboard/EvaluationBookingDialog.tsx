"use client";

import { EventAvailableOutlined as BookIcon, CloseRounded as CloseIcon } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import { EvaluatorPickerList } from "@/frontend/views/teachers/dashboard/EvaluationBookingPicker";
import { useEvaluationBooking } from "@/frontend/views/teachers/dashboard/useEvaluationBooking";
import { Applicant, Common, useAppTranslation } from "@/shared/locale";

/** Snackbar auto-hide cadence shared by the booking notice lanes. */
const BOOKING_NOTICE_AUTOHIDE_MS = 6000;

/** A11y + test wiring ids for the single booking dialog instance. */
const DIALOG_TITLE_ID = "evaluation-booking-dialog-title";
const DIALOG_TEST_ID = "evaluation-booking-dialog";

interface EvaluationBookingDialogProps {
  /** Whether the booking dialog is open. */
  readonly open: boolean;
  /** Dismisses the dialog (backdrop, close icon, cancel affordance, settled outcomes). */
  readonly onClose: () => void;
  /** Refetches the caller's evaluation-loop status after outcomes that change it. */
  readonly refetchLoopStatus: () => Promise<unknown>;
  /** Refetches the applicant profile after outcomes that change it. */
  readonly refetchProfile: () => Promise<unknown>;
}

/**
 * EvaluationBookingDialog — the evaluator picker + confirm gate for booking
 * ONE evaluation session inside the caller's current loop, mounted by the
 * evaluation zone and opened from its CTA.
 *
 * Renders the localized dialog chrome (title, dismiss affordances,
 * confirm/cancel actions) plus the shared `NoticeSnackbar` notice slot; the
 * picker list itself lives in {@link EvaluationBookingPicker}, and the
 * booking write path — mutation, per-open idempotency key, typed outcome
 * lanes — lives in {@link useEvaluationBooking}.
 *
 * MUI v9 discipline: `sx`-only styling, colors exclusively through theme
 * palette callbacks, `CloseRounded`/`*Outlined` icons, RTL-safe logical
 * composition, and every user-facing string resolved through the
 * compile-time `Applicant` namespace handle (property access only).
 */
export function EvaluationBookingDialog({
  open,
  onClose,
  refetchLoopStatus,
  refetchProfile,
}: Readonly<EvaluationBookingDialogProps>): ReactNode {
  const t = useAppTranslation(Applicant);
  const commonT = useAppTranslation(Common);
  const {
    evaluators,
    evaluatorsLoading,
    selectedEvaluatorId,
    selectEvaluator,
    booking,
    closeBooking,
    notice,
    confirmBooking,
    dismissNotice,
  } = useEvaluationBooking({ open, onClose, refetchLoopStatus, refetchProfile });
  const confirmDisabled = evaluatorsLoading || selectedEvaluatorId === null;

  const handleConfirm = (): void => {
    void confirmBooking();
  };

  // Unmount-on-close (the repo's dialog convention): the closed dialog
  // leaves the tree entirely — no exit transition — while the transient
  // booking notice stays visible through the shared snackbar slot.
  if (!open) {
    return <NoticeSnackbar notice={notice} autoHideDuration={BOOKING_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />;
  }

  return (
    <>
      <Dialog
        open={open}
        onClose={(_event, _reason) => {
          if (!booking) {
            closeBooking();
          }
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby={DIALOG_TITLE_ID}
        data-testid={DIALOG_TEST_ID}
      >
        <DialogTitle
          id={DIALOG_TITLE_ID}
          sx={theme => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
            fontWeight: 700,
            color: theme.palette.text.primary,
          })}
        >
          {t.evaluationBookingDialogTitle}
          <IconButton
            aria-label={commonT.close}
            onClick={closeBooking}
            disabled={booking}
            sx={theme => ({ ...focusVisibleRingSx, color: theme.palette.text.secondary })}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <EvaluatorPickerList
            evaluators={evaluators}
            evaluatorsLoading={evaluatorsLoading}
            selectedEvaluatorId={selectedEvaluatorId}
            selectEvaluator={selectEvaluator}
            emptyLabel={t.availableEvaluatorsEmpty}
            loadingLabel={t.evaluationBookingDialogTitle}
            disabled={booking}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={closeBooking}
            disabled={booking}
            variant="outlined"
            color="inherit"
            sx={theme => ({ ...focusVisibleRingSx, minHeight: 54, color: theme.palette.text.secondary })}
          >
            {t.evaluationBookingCancelCta}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={confirmDisabled}
            loading={booking}
            autoFocus
            startIcon={<BookIcon />}
            sx={{ ...focusVisibleRingSx, minHeight: 54 }}
          >
            {t.evaluationBookingConfirmCta}
          </Button>
        </DialogActions>
      </Dialog>
      <NoticeSnackbar notice={notice} autoHideDuration={BOOKING_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </>
  );
}
