"use client";

/**
 * TeacherDirectoryRequestDialog — the confirm gate behind the directory
 * card's "Request Session" CTA: ONE dialog instance mounted at the grid
 * level (never per card), keyed by the selected teacher.
 *
 * Anatomy: the teacher's display name over a summary chip row (the
 * Qira'ah certifications resolved through the `recitation` namespace's
 * per-reading names + the fluency tokens through the presentation
 * vocabulary's honest known/unknown resolution); the subject-intent
 * select (preselected from the APPLIED browse filter on every open); the
 * prepaid-credits strip (the caller's own `mySessionBalance` lanes,
 * rendered ONLY when that read resolves — the selected intent's chip is
 * emphasized, an empty effective prepaid surface earns the honest
 * MAY-decline caption); the localized note stating the server validates
 * the balance/trial lane and holds the fee; and the Cancel/Confirm
 * action pair (≥44px, the confirm rides the mutation's loading state and
 * is disabled while submitting).
 *
 * The write path — mutation, per-open idempotency key, typed outcome
 * lanes — lives in {@link useSessionRequest}; the transient notices render
 * through the shared `NoticeSnackbar` slot and survive the close (the
 * success lane navigates to the student's sessions page). Unmount-on-close
 * is the repo's dialog convention.
 *
 * MUI v9 `sx`-only styling, theme-palette colors, RTL-safe flex/gap
 * composition; every string through the compile-time handles.
 */

import { EventAvailableOutlined as RequestIcon } from "@mui/icons-material";
import { Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { focusVisibleRingSx } from "@/frontend/components/ui/focusRing";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import type { BrowseAvailableTeachersQuery_browseAvailableTeachers_items } from "@/frontend/graphql/generated/gql/graphql";
import { RequestCreditsStrip } from "@/frontend/views/student/teachers/TeacherDirectoryRequestDialog.credits.parts";
import {
  RequestDialogTitleRow,
  RequestSummaryChips,
} from "@/frontend/views/student/teachers/TeacherDirectoryRequestDialog.parts";
import { TeacherDirectoryRequestIntentSelect } from "@/frontend/views/student/teachers/TeacherDirectoryRequestIntentSelect";
import {
  type BrowseIntent,
  RECITATION_LABEL_KEY_BY_ENUM,
  resolveLanguageLabel,
} from "@/frontend/views/student/teachers/teacherDirectoryPresentation";
import { useSessionRequest } from "@/frontend/views/student/teachers/useSessionRequest";
import { Common, Recitation, TeacherDirectory, useAppTranslation } from "@/shared/locale";

/** Snackbar auto-hide cadence shared by the request notice lanes. */
const REQUEST_NOTICE_AUTOHIDE_MS = 6000;

/** A11y + test wiring ids for the single request dialog instance. */
const DIALOG_TITLE_ID = "teacher-directory-request-dialog-title";
const DIALOG_TEST_ID = "teacher-directory-request-dialog";

interface TeacherDirectoryRequestDialogProps {
  /** Whether the request dialog is open. */
  readonly open: boolean;
  /** The selected teacher (`null` while closed — one instance, keyed per open). */
  readonly teacher: BrowseAvailableTeachersQuery_browseAvailableTeachers_items | null;
  /** The intent preselected on open — the applied browse filter's intent. */
  readonly appliedIntent: BrowseIntent;
  /** Dismisses the dialog (backdrop, close icon, cancel affordance). */
  readonly onClose: () => void;
  /** Refetches the directory browse after outcomes that change it. */
  readonly refetchDirectory: () => Promise<unknown>;
}

/** The request-session confirm dialog (mounted once at the grid level). */
export function TeacherDirectoryRequestDialog({
  open,
  teacher,
  appliedIntent,
  onClose,
  refetchDirectory,
}: Readonly<TeacherDirectoryRequestDialogProps>): ReactNode {
  const t = useAppTranslation(TeacherDirectory);
  const recitationT = useAppTranslation(Recitation);
  const commonT = useAppTranslation(Common);
  const { intent, selectIntent, submitting, closeRequest, notice, confirmRequest, dismissNotice, sessionBalance } =
    useSessionRequest({
      open,
      teacherId: teacher?.id ?? null,
      initialIntent: appliedIntent,
      onClose,
      refetchDirectory,
    });

  const handleConfirm = (): void => {
    void confirmRequest();
  };

  // Unmount-on-close (the repo's dialog convention): the closed dialog
  // leaves the tree entirely while the transient notice stays visible.
  if (!open) {
    return <NoticeSnackbar notice={notice} autoHideDuration={REQUEST_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />;
  }
  if (teacher === null) {
    // Fail-closed: `open` is keyed to the selected teacher upstream, so
    // this arm is unreachable — render nothing rather than a guess.
    return null;
  }
  const summaryLabels = [
    ...teacher.recitations.map(reading => recitationT[RECITATION_LABEL_KEY_BY_ENUM[reading]]),
    ...teacher.languages.map(token => resolveLanguageLabel(token, t)),
  ];

  return (
    <>
      <Dialog
        open={open}
        onClose={(_event, _reason) => {
          if (!submitting) {
            closeRequest();
          }
        }}
        fullWidth
        maxWidth="sm"
        aria-labelledby={DIALOG_TITLE_ID}
        data-testid={DIALOG_TEST_ID}
      >
        <RequestDialogTitleRow
          titleId={DIALOG_TITLE_ID}
          title={t.requestDialogTitle}
          closeLabel={commonT.close}
          closeRequested={closeRequest}
          disabled={submitting}
        />
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Typography variant="subtitle1" component="p" sx={{ fontWeight: 700, overflowWrap: "anywhere" }}>
            {teacher.fullName}
          </Typography>
          <RequestSummaryChips labels={summaryLabels} />
          <TeacherDirectoryRequestIntentSelect value={intent} onChange={selectIntent} disabled={submitting} />
          <RequestCreditsStrip balance={sessionBalance} selectedIntent={intent} labels={t} />
          <Typography variant="body2" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.requestDialogNote}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={closeRequest}
            disabled={submitting}
            variant="outlined"
            color="inherit"
            sx={theme => ({ ...focusVisibleRingSx, minHeight: 44, color: theme.palette.text.secondary })}
          >
            {t.requestCancel}
          </Button>
          <Button
            onClick={handleConfirm}
            variant="contained"
            disabled={submitting}
            loading={submitting}
            autoFocus
            startIcon={<RequestIcon />}
            sx={{ ...focusVisibleRingSx, minHeight: 44 }}
          >
            {t.requestConfirm}
          </Button>
        </DialogActions>
      </Dialog>
      <NoticeSnackbar notice={notice} autoHideDuration={REQUEST_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </>
  );
}
