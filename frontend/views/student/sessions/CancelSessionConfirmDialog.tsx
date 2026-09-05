"use client";

import { useApolloClient, useMutation } from "@apollo/client/react";
import { Dialog, DialogContent, DialogTitle } from "@mui/material";
import { type ReactNode, useState } from "react";
import { cancelSessionMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { SessionDialogActionButtons } from "@/frontend/views/student/sessions/SessionDialogActionButtons";
import { SessionDialogReasonField } from "@/frontend/views/student/sessions/SessionDialogReasonField";
import { SessionDialogWarningCallout } from "@/frontend/views/student/sessions/SessionDialogWarningCallout";
import { handleCancelSessionMutationError } from "@/frontend/views/student/sessions/sessionDialogErrorArms";
import { Errors, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * CancelSessionConfirmDialog — the confirm-and-reason seam for cancelling a
 * `Scheduled`/`Started` session (student or teacher side).
 *
 * Mutation behavior (plan §5 — cancel flow, NO refetch):
 *
 * | Outcome (extensions.code)                          | Behavior |
 * |----------------------------------------------------|----------|
 * | success                                            | cache NORMALIZE — `update` rewrites `status`/`feeHeld` on the normalized `Session:<id>` entity so the list row converges instantly (the returned `Session!` payload also auto-merges); `onCancelled` up to the container → the role container's cancelled-session snackbar |
 * | `SESSION_NOT_FOUND` (not-found family)             | evict the row — BOTH role list fields (`myStudentSessions` + `myTeacherSessions`) filtered by `__ref`/`id` (shared `sessionListCacheEviction.ts`), entity evicted, `gc()`; `onSessionMissing` up to the container → `errors.sessionNotFound` snackbar + row disappears |
 * | `SESSION_INVALID_TRANSITION` (no mapping row — local behavior per AGENTS "caller keeps pre-existing behavior") | `onInvalidTransition` up to the container → row-scoped inline alert with `errors.sessionInvalidTransition` |
 * | `DUPLICATE_REQUEST` (map row: success-equivalent)  | `onDuplicateReplay` → informational notice with `sessions.duplicateBookingInfo` (never an error treatment — docs/IDEMPOTENCY.md §3) |
 * | masked `INTERNAL_SERVER_ERROR` / `FORBIDDEN` / anything else | `onFailure(copy)` → error toast; `FORBIDDEN` carries `errors.forbidden`, everything else the sessions-generic `sessions.genericError` |
 *
 * The code → behavior classification itself lives in
 * `sessionDialogErrorArms.ts` (`handleCancelSessionMutationError`) so this
 * file stays the seam only. Reason field: optional, ≤
 * {@link MAX_CANCEL_REASON_LENGTH} chars at the UI seam (mirrors the backend
 * cap), live helper-text counter, `aria-invalid` raised when a submit
 * carries an over-cap value, empty reason sends `null` (the wire field is
 * optional).
 *
 * Form discipline: `React.SubmitEvent` (NEVER `FormEvent` — React 19 rules),
 * submit button disabled while the mutation is in flight.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, ≥44px touch targets on the action buttons.
 */

/** UI-seam cap for the optional cancel reason (mirrors the backend contract). */
export const MAX_CANCEL_REASON_LENGTH = 500;

interface CancelSessionConfirmDialogProps {
  /** Id of the session being cancelled. */
  readonly sessionId: string;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the cancel mutation is pending: the Dialog's `onClose` is gated
   * on the `loading` flag below and the cancel Button is separately
   * `disabled={loading}`.
   */
  readonly onClose: () => void;
  /** Success — the cache already carries the cancelled state. */
  readonly onCancelled: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` — the container should drop the row UI-side (cache is evicted here). */
  readonly onSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` — the container raises the row-scoped inline alert. */
  readonly onInvalidTransition: (sessionId: string) => void;
  /** `DUPLICATE_REQUEST` replay — informational, success-equivalent. */
  readonly onDuplicateReplay: () => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
}

/** Confirm-and-reason dialog owning the `cancelSession` mutation. */
export function CancelSessionConfirmDialog({
  sessionId,
  open,
  onClose,
  onCancelled,
  onSessionMissing,
  onInvalidTransition,
  onDuplicateReplay,
  onFailure,
}: Readonly<CancelSessionConfirmDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const te = useAppTranslation(Errors);
  const client = useApolloClient();

  const [reason, setReason] = useState("");
  const [reasonInvalid, setReasonInvalid] = useState(false);
  // Fresh-dialog discipline: the container mounts this dialog UNMOUNTED-KEYED
  // per session (`key={sessionId}` in the role containers), so every open
  // starts from the initial draft state — no reset effect needed.

  const [cancelSession, { loading }] = useMutation(cancelSessionMutationDocument, {
    // Cache NORMALIZE on success — rewrite the terminal lifecycle fields onto
    // the normalized `Session:<id>` entity (belt-and-braces over the automatic
    // normalized merge of the returned `Session!` payload). NO refetch.
    update(cache, { data }) {
      const cancelled = data?.cancelSession;
      if (!cancelled) return;
      cache.modify({
        id: cache.identify({ __typename: "Session", id: cancelled.id }),
        fields: {
          status: () => cancelled.status,
          feeHeld: () => cancelled.feeHeld,
        },
      });
    },
    onCompleted: data => {
      onCancelled(data.cancelSession.id);
    },
    onError: error => {
      handleCancelSessionMutationError(error, {
        cache: client.cache,
        sessionId,
        onSessionMissing,
        onInvalidTransition,
        onDuplicateReplay,
        onFailure,
        forbiddenCopy: te.forbidden,
        genericErrorCopy: t.genericError,
      });
    },
  });

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    const trimmed = reason.trim();
    if (trimmed.length > MAX_CANCEL_REASON_LENGTH) {
      setReasonInvalid(true);
      return;
    }
    setReasonInvalid(false);
    void cancelSession({ variables: { id: sessionId, reason: trimmed.length === 0 ? null : trimmed } });
  };

  // Dismissal gate — enforces the `onClose` prop contract at the dialog
  // itself: backdrop click and Escape are IGNORED while the mutation is
  // pending (the cancel Button is separately disabled while loading).
  const handleDialogClose = (): void => {
    if (!loading) {
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleDialogClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { component: "form", onSubmit: handleSubmit } }}
      aria-labelledby="cancel-session-dialog-title"
    >
      <DialogTitle id="cancel-session-dialog-title" sx={theme => ({ color: theme.palette.onSurface })}>
        {t.cancelConfirmTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>
        <SessionDialogWarningCallout message={t.cancelConfirmBody} />
        <SessionDialogReasonField
          value={reason}
          onValueChange={setReason}
          label={t.cancelReasonLabel}
          placeholder={t.cancelReasonPlaceholder}
          required={false}
          error={reasonInvalid}
          helperText={`${reason.length}/${MAX_CANCEL_REASON_LENGTH}`}
          maxLength={MAX_CANCEL_REASON_LENGTH}
        />
      </DialogContent>
      <SessionDialogActionButtons
        loading={loading}
        onClose={onClose}
        submitLabel={t.cancelSession}
        submitColor="error"
        submitDisabled={loading}
      />
    </Dialog>
  );
}
