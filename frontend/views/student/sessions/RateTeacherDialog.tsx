"use client";

import { useApolloClient, useMutation } from "@apollo/client/react";
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, useMediaQuery, useTheme } from "@mui/material";
import type { Theme } from "@mui/material/styles";
import { type ReactNode, useState } from "react";
import { submitTeacherEvaluationMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { RateTeacherRatingField } from "@/frontend/views/student/sessions/RateTeacherRatingField";
import { handleRateTeacherMutationError } from "@/frontend/views/student/sessions/rateTeacherMutationError";
import { updateCacheOnSubmitted } from "@/frontend/views/student/sessions/useMyTeacherEvaluations";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * RateTeacherDialog — the student's one-shot teacher-rating seam for a
 * dual-confirmed session (opened by the row's Rate CTA, mounted
 * UNMOUNTED-KEYED per session so every open starts from the initial draft
 * state).
 *
 * Mutation behavior (NO refetch anywhere):
 *
 * | Outcome (extensions.code)                        | Behavior |
 * |--------------------------------------------------|----------|
 * | success                                          | cache APPEND — `update` prepends the returned `Evaluation!` row (already normalized by the mutation write) to the cached `myTeacherEvaluations` list, so the rated set converges in place; `onRated` up to the container → `sessions.rateTeacherSuccess` snackbar + dialog closes |
 * | `SESSION_NOT_FOUND` (not-found family)           | evict the row from the student session list (shared `sessionListCacheEviction.ts`) + `onSessionMissing` → `errors.sessionNotFound` snackbar + row disappears |
 * | `EVALUATION_ALREADY_SUBMITTED` (write-once arbiter) | `onAlreadySubmitted` — the rejection PROVES the rating exists, so the container marks the row rated (the Rate CTA yields to the rated chip); the localized notice renders app-scope through the mapped error surface |
 * | `EVALUATION_SESSION_NOT_COMPLETED` (gate reject) | `onSessionNotCompleted` — the localized notice renders app-scope through the mapped error surface; the dialog closes (a retry cannot succeed until the handshake completes) |
 * | `VALIDATION` + `fields[]` addressed at `rating`  | inline dialog error — the server-localized wire pair renders under the stars; the dialog stays open |
 * | `FORBIDDEN`                                      | `onFailure(errors.forbidden)` — error toast; the dialog stays open for a retry |
 * | masked `INTERNAL_SERVER_ERROR` / anything else   | `onFailure(sessions.genericError)` — error toast; the dialog stays open for a retry |
 *
 * The code → behavior classification lives in
 * {@link handleRateTeacherMutationError} (rateTeacherMutationError.ts) so the
 * component stays the seam only. The mapped-surface rows
 * (`EVALUATION_SESSION_NOT_COMPLETED` / `EVALUATION_ALREADY_SUBMITTED`) are
 * declared in the SINGLE error-mapping table
 * (`frontend/providers/apollo/error-link.map.ts`), which renders their
 * localized notices app-scope; the local arms above handle only what the
 * app-scope surface cannot see (dialog slot, rated marker, eviction).
 *
 * Control discipline: MUI `Rating` 1..5 whole stars (`*Outlined` icons
 * only, see {@link RateTeacherRatingField}), per-star accessible labels
 * resolved through the interpolated `sessions.ratingStarAriaLabel(position)`
 * template, the empty-value radio labeled by `sessions.ratingEmptyLabelText`
 * (no untranslated MUI copy),
 * the inline validation error tied to the control via a conditional
 * `aria-describedby` (present only while the error is raised), dialog
 * title/cancel/submit copy from the `sessions` namespace, submit disabled
 * until a star is chosen, `aria-busy` on the submit while in flight,
 * dismissal gated while the mutation is pending, full-screen under `sm`
 * with the rating control centered in the sheet's free space so the
 * viewport-sized composition stays deliberate,
 * transition collapse under `prefers-reduced-motion`.
 *
 * Form discipline: `React.SubmitEvent` (NEVER `FormEvent` — React 19 rules).
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, RTL-safe
 * logical composition (the star row inherits the document direction),
 * ≥44px touch targets on the action buttons.
 */

interface RateTeacherDialogProps {
  /** Id of the session being rated. */
  readonly sessionId: string;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the submit mutation is pending: the Dialog's `onClose` is gated
   * on the `loading` flag below and the cancel Button is separately
   * `disabled={loading}`.
   */
  readonly onClose: () => void;
  /** Success — the cache already carries the new rating row. */
  readonly onRated: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` — the row has been evicted; the container drops it UI-side. */
  readonly onSessionMissing: (sessionId: string) => void;
  /** Gate reject — the container closes the dialog slot; the notice renders app-scope. */
  readonly onSessionNotCompleted: (sessionId: string) => void;
  /** Write-once reject — the container marks the row rated; the notice renders app-scope. */
  readonly onAlreadySubmitted: (sessionId: string) => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
}

/** Title styling: theme on-surface color; compact sheets center the title. */
const dialogTitleSx = (compact: boolean) => (theme: Theme) => ({
  color: theme.palette.onSurface,
  ...(compact && { textAlign: "center" as const }),
});

/** Fullscreen-sheet composition: center the rating control in the free space. */
const ratingContentSx = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 2,
  py: 4,
} as const;

/** The teacher-rating dialog owning the `submitTeacherEvaluation` mutation. */
export function RateTeacherDialog({
  sessionId,
  open,
  onClose,
  onRated,
  onSessionMissing,
  onSessionNotCompleted,
  onAlreadySubmitted,
  onFailure,
}: Readonly<RateTeacherDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const client = useApolloClient();
  const theme = useTheme();
  const isCompactViewport = useMediaQuery(theme.breakpoints.down("sm"));
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });

  const [rating, setRating] = useState<number | null>(null);
  const [ratingFieldError, setRatingFieldError] = useState<string | null>(null);

  const [submitTeacherEvaluation, { loading }] = useMutation(submitTeacherEvaluationMutationDocument, {
    // Cache APPEND — the returned `Evaluation!` row (already normalized by
    // the mutation write) is prepended to the cached rated rows (newest
    // first). NO refetch — the row's rated state converges in place.
    update: updateCacheOnSubmitted,
    onCompleted: () => onRated(sessionId),
    onError: error => {
      handleRateTeacherMutationError(error, {
        cache: client.cache,
        sessionId,
        onSessionMissing,
        onSessionNotCompleted,
        onAlreadySubmitted,
        onRatingFieldError: setRatingFieldError,
        onFailure,
        validationCopy: te.validation,
        forbiddenCopy: te.forbidden,
        genericErrorCopy: t.genericError,
      });
    },
  });

  // Dismissal gate — backdrop click and Escape are IGNORED while the
  // mutation is pending (the cancel Button is separately disabled).
  const handleDialogClose = (): void => (loading ? undefined : onClose());

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading || rating === null) return;
    void submitTeacherEvaluation({ variables: { input: { rating }, sessionId } });
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth="xs"
      fullScreen={isCompactViewport}
      slotProps={{
        transition: { timeout: reducedMotion ? 0 : undefined },
        // Compact sheet: cluster title + rating + actions as one centered block.
        paper: { sx: isCompactViewport ? { justifyContent: "center" } : undefined },
      }}
      aria-labelledby="rate-teacher-dialog-title"
    >
      <DialogTitle id="rate-teacher-dialog-title" sx={dialogTitleSx(isCompactViewport)}>
        {t.rateTeacherDialogTitle}
      </DialogTitle>
      <form onSubmit={handleSubmit} noValidate style={{ display: "contents" }}>
        <DialogContent sx={{ ...ratingContentSx, ...(isCompactViewport && { flex: "0 0 auto" }) }}>
          <RateTeacherRatingField
            value={rating}
            compact={isCompactViewport}
            fieldError={ratingFieldError}
            onChange={value => {
              setRating(value);
              setRatingFieldError(null); // live validation relief — a new choice clears a raised flag
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, pt: 2, gap: 1.5 }}>
          <Button
            onClick={onClose}
            disabled={loading}
            variant="outlined"
            color="inherit"
            sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
          >
            {t.rateTeacherDialogCancel}
          </Button>
          <Button
            type="submit"
            variant="contained"
            disabled={loading || rating === null}
            aria-busy={loading}
            sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
          >
            {t.rateTeacherDialogSubmit}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
