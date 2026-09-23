"use client";

import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import {
  type BroadcastHistoryRow,
  broadcastNumericId,
} from "@/frontend/views/admin/broadcasts/broadcast-history.helpers";
import { useAppTranslation } from "@/shared/locale/client";
import { AdminBroadcasts } from "@/shared/locale/namespaces/adminBroadcasts";

/**
 * StopBroadcastDialog — the one-way stop confirmation for one active
 * broadcast (`/admin/broadcasts`, History tab). The body interpolates the
 * row's honest recipient count into the localized confirmation copy; the
 * confirm affordance carries the destructive error identity (dimmed
 * error-container pair while disabled, so the intent reads before and
 * during the round-trip).
 *
 * Mount contract — the caller gates mounting on a single nullable key
 * state and passes that key as the React `key`: the dialog unmounts on
 * dismissal and remounts FRESH for every open (no residual state ever
 * survives an open; this dialog holds none, but the idiom keeps it that
 * way as the surface grows). Confirming closes the dialog immediately and
 * the mutation's outcome arrives through the surface's shared snackbar —
 * the one-way stop has nothing to correct in-dialog, so no failure arm
 * needs the dialog held open.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px
 * targets, keyboard-focusable dialog (`aria-labelledby`).
 */

interface StopBroadcastDialogProps {
  /** The active row being stopped (drives the title + interpolated count). */
  readonly entry: BroadcastHistoryRow;
  /** True while the stop mutation is in flight. */
  readonly loading: boolean;
  /** Dismiss intent (cancel Button / backdrop / Escape). */
  readonly onClose: () => void;
  /** Confirm intent — receives the row's `Int!` wire id. */
  readonly onConfirm: (broadcastId: number) => void;
}

/** Confirm-and-stop dialog (broadcast title + interpolated recipient count). */
export function StopBroadcastDialog({
  entry,
  loading,
  onClose,
  onConfirm,
}: Readonly<StopBroadcastDialogProps>): ReactNode {
  const t = useAppTranslation(AdminBroadcasts);

  const handleConfirm = (): void => {
    if (loading) {
      return;
    }
    const broadcastId = broadcastNumericId(entry.id);
    if (broadcastId === null) {
      // A malformed row id can never address a broadcast — nothing to fire.
      onClose();
      return;
    }
    onConfirm(broadcastId);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" aria-labelledby="stop-broadcast-dialog-title">
      <DialogTitle id="stop-broadcast-dialog-title">{t.stopConfirmTitle}</DialogTitle>
      <DialogContent>
        <Stack sx={{ gap: 1.5 }}>
          <Typography dir="auto" variant="subtitle1" sx={{ fontWeight: 600 }}>
            {entry.title}
          </Typography>
          <Typography variant="body1" sx={theme => ({ color: theme.palette.text.secondary })}>
            {t.stopConfirmBody(entry.recipientCount)}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
        <Button
          onClick={onClose}
          disabled={loading}
          variant="outlined"
          color="inherit"
          sx={{ minHeight: { xs: 44, sm: 40 }, px: 3, whiteSpace: "nowrap" }}
        >
          {t.stopConfirmCancel}
        </Button>
        <Button
          onClick={handleConfirm}
          disabled={loading}
          variant="contained"
          color="error"
          data-testid={`broadcast-stop-confirm-${entry.id}`}
          sx={theme => ({
            minHeight: { xs: 44, sm: 40 },
            px: 3,
            whiteSpace: "nowrap",
            "&.Mui-disabled": {
              bgcolor: theme.palette.errorContainer,
              color: theme.palette.onErrorContainer,
              opacity: 0.6,
            },
          })}
        >
          {t.stopConfirmAction}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
