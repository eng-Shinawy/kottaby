"use client";

import { Alert, DialogContentText } from "@mui/material";
import type { ReactNode } from "react";
import {
  SubscriptionDialogActions,
  SubscriptionFormDialog,
} from "@/frontend/views/admin/students/subscriptions/dialogs/subscriptionDialogAtoms";
import type { SubscriptionRow } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { Common, SubscriptionAdmin, useAppTranslation } from "@/shared/locale";

/**
 * RenewSubscriptionDialog — renews an EXPIRED subscription into a fresh
 * active period.
 *
 * A confirm-only dialog (no input): the body states what a renewal opens
 * (a fresh period on the row's plan snapshot, the plan's full session
 * count credited to the student's lane). The server's localized denials
 * surface in the inline error alert; the dialog stays open on every
 * failure arm.
 *
 * Presentational: the mutation lives in `useSubscriptionAdminActions`
 * (wired by the section); the dialog forwards only the submit intent.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby`).
 */

interface RenewSubscriptionDialogProps {
  /** The subscription being renewed (drives the testid). */
  readonly subscription: SubscriptionRow;
  readonly open: boolean;
  /** Dismiss intent — ignored while the mutation is in flight. */
  readonly onClose: () => void;
  /** True while the section's renew mutation is in flight. */
  readonly loading: boolean;
  /** The server-localized denial (inline alert) — `null` hides the alert. */
  readonly error: string | null;
  /** Submit intent — the confirm arm. */
  readonly onSubmit: () => void;
}

export function RenewSubscriptionDialog({
  subscription,
  open,
  onClose,
  loading,
  error,
  onSubmit,
}: Readonly<RenewSubscriptionDialogProps>): ReactNode {
  const t = useAppTranslation(SubscriptionAdmin);
  const tc = useAppTranslation(Common);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) {
      return;
    }
    onSubmit();
  };

  return (
    <SubscriptionFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="renew-subscription-dialog-title"
      title={t.renew.title}
      actions={
        <SubscriptionDialogActions
          onClose={onClose}
          loading={loading}
          dismissLabel={tc.cancel}
          submitLabel={t.actions.renew}
          submitTestId={`renew-subscription-submit-${subscription.id}`}
        />
      }
    >
      {error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}
      <DialogContentText sx={theme => ({ color: theme.palette.text.secondary })}>{t.renew.message}</DialogContentText>
    </SubscriptionFormDialog>
  );
}
