"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { type ReactNode, useState } from "react";
import type { DisputeResolution } from "@/frontend/graphql/generated/gql/graphql";
import { ResolveDisputeIntroBanner } from "@/frontend/views/admin/disputes/ResolveDisputeIntroBanner";
import { ResolveDisputeNoteField } from "@/frontend/views/admin/disputes/ResolveDisputeNoteField";
import { ResolveDisputeOptionGroup } from "@/frontend/views/admin/disputes/ResolveDisputeOptionGroup";
import { useResolveSessionDispute } from "@/frontend/views/admin/disputes/useResolveSessionDispute";
import { Common, Sessions, useAppTranslation } from "@/shared/locale";

/**
 * ResolveDisputeDialog — the ADMIN arbitration seam for one disputed session
 * (`/disputes`, DEV3-005 R-111 / backend R-104). Structural sibling of the
 * participant `CancelSessionConfirmDialog` family: same portal/dialog/form
 * discipline, but the decision space is EXACTLY ONE terminal outcome
 * (the localized radios live in {@link ResolveDisputeOptionGroup}).
 *
 * Note field: OPTIONAL, ≤ {@link MAX_RESOLVE_NOTE_LENGTH} chars at the UI
 * seam (mirrors the backend contract), live raw-character counter. The
 * submit stays disabled until a resolution is chosen — an arbitration
 * outcome is never implied by a default.
 *
 * Mutation behavior (plan §3.2 — arbitration flow, NO refetch) — the
 * `resolveSessionDispute` mutation, its cache-convergence `update` arm and
 * the extensions-code classification live in
 * {@link useResolveSessionDispute}; EVERY outcome surfaces a snackbar up to
 * the container (`onResolved` / `onSessionMissing` /
 * `onInvalidTransition` / `onFailure`), and the dialog stays open for a
 * corrected choice on every failure arm.
 *
 * Form discipline: `React.SubmitEvent` (NEVER `FormEvent` — React 19 rules),
 * submit disabled while the mutation is in flight or no resolution chosen.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, `*Outlined`
 * icons only, ≥44px touch targets on the action buttons.
 */

/** UI-seam cap for the optional arbitration note (mirrors the backend contract). */
export const MAX_RESOLVE_NOTE_LENGTH = 500;

interface ResolveDisputeDialogProps {
  /** Id of the disputed session being arbitrated. */
  readonly sessionId: string;
  readonly open: boolean;
  /**
   * Dismiss intent (cancel Button / backdrop click / Escape) — ignored
   * while the resolve mutation is pending: the Dialog's `onClose` is gated
   * on the `loading` flag below and the cancel Button is separately
   * `disabled={loading}`.
   */
  readonly onClose: () => void;
  /** Success — the queue cache already dropped the row. */
  readonly onResolved: (sessionId: string) => void;
  /** `SESSION_NOT_FOUND` — error snackbar; the row stays (see the docblock). */
  readonly onSessionMissing: (sessionId: string) => void;
  /** `SESSION_INVALID_TRANSITION` — error snackbar; the row stays. */
  readonly onInvalidTransition: (sessionId: string) => void;
  /** Everything else — error toast; the dialog stays open for a retry. */
  readonly onFailure: (message: string) => void;
}

/** Confirm-and-resolve arbitration dialog owning the `resolveSessionDispute` mutation. */
export function ResolveDisputeDialog({
  sessionId,
  open,
  onClose,
  onResolved,
  onSessionMissing,
  onInvalidTransition,
  onFailure,
}: Readonly<ResolveDisputeDialogProps>): ReactNode {
  const t = useAppTranslation(Sessions);
  const tc = useAppTranslation(Common);

  // No default resolution — arbitration requires an EXPLICIT outcome choice.
  const [resolution, setResolution] = useState<DisputeResolution | null>(null);
  const [note, setNote] = useState("");

  const { resolveDispute, loading } = useResolveSessionDispute({
    sessionId,
    onResolved,
    onSessionMissing,
    onInvalidTransition,
    onFailure,
  });

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading || resolution === null) return;
    const trimmed = note.trim();
    void resolveDispute({
      variables: {
        id: sessionId,
        resolution,
        note: trimmed.length === 0 ? null : trimmed,
      },
    });
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
      aria-labelledby="resolve-dispute-dialog-title"
    >
      <DialogTitle id="resolve-dispute-dialog-title" sx={theme => ({ color: theme.palette.onSurface })}>
        {t.resolveDisputeTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>
        <ResolveDisputeIntroBanner body={t.resolveDisputeBody} />
        <ResolveDisputeOptionGroup
          value={resolution}
          onChange={next => {
            setResolution(next);
          }}
          t={t}
        />
        <ResolveDisputeNoteField
          value={note}
          onChange={next => {
            setNote(next);
          }}
          maxLength={MAX_RESOLVE_NOTE_LENGTH}
          t={t}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button onClick={onClose} disabled={loading} sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}>
          {tc.cancel}
        </Button>
        <Button
          type="submit"
          variant="contained"
          color="primary"
          disabled={loading || resolution === null}
          data-testid="resolve-dispute-submit"
          sx={{ minHeight: { xs: 44, sm: 40 }, px: 3 }}
        >
          {t.resolveDisputeSubmit}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
