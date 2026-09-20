"use client";

import { Alert, TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import {
  SubscriptionDialogActions,
  SubscriptionFormDialog,
} from "@/frontend/views/admin/students/subscriptions/dialogs/subscriptionDialogAtoms";
import {
  MAX_CANCEL_REASON_LENGTH,
  normalizeCancelReason,
  type SubscriptionRow,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { Common, SubscriptionAdmin, useAppTranslation } from "@/shared/locale";

/**
 * CancelSubscriptionDialog — cancels an ACTIVE subscription
 * balance-preserving.
 *
 * Reason field — OPTIONAL (the cancel contract's `reason?`), hard
 * `maxLength` clamp at the input seam plus a live raw-character counter
 * helper line; the reason rides the mutation input verbatim-trimmed via
 * `normalizeCancelReason` (empty resolves to `null`). The body states the
 * balance-preserving semantics up front; the server's localized denials
 * surface in the inline error alert.
 *
 * Presentational: the mutation lives in `useSubscriptionAdminActions`
 * (wired by the section); the dialog forwards only the normalized reason.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable field).
 */

interface CancelSubscriptionDialogProps {
  /** The subscription being cancelled (drives the testid). */
  readonly subscription: SubscriptionRow;
  readonly open: boolean;
  /** Dismiss intent — ignored while the mutation is in flight. */
  readonly onClose: () => void;
  /** True while the section's cancel mutation is in flight. */
  readonly loading: boolean;
  /** The server-localized denial (inline alert) — `null` hides the alert. */
  readonly error: string | null;
  /** Submit intent — the trimmed reason, or `null` when left blank. */
  readonly onSubmit: (reason: string | null) => void;
}

export function CancelSubscriptionDialog({
  subscription,
  open,
  onClose,
  loading,
  error,
  onSubmit,
}: Readonly<CancelSubscriptionDialogProps>): ReactNode {
  const t = useAppTranslation(SubscriptionAdmin);
  const tc = useAppTranslation(Common);

  const [reason, setReason] = useState("");

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) {
      return;
    }
    onSubmit(normalizeCancelReason(reason));
  };

  return (
    <SubscriptionFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="cancel-subscription-dialog-title"
      title={t.cancel.title}
      actions={
        <SubscriptionDialogActions
          onClose={onClose}
          loading={loading}
          dismissLabel={tc.cancel}
          submitLabel={t.actions.cancel}
          submitTestId={`cancel-subscription-submit-${subscription.id}`}
          submitColor="error"
        />
      }
    >
      {error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}
      <Alert severity="warning" sx={{ width: "100%" }}>
        {t.cancel.message}
      </Alert>
      <TextField
        label={t.cancel.reasonLabel}
        value={reason}
        onChange={event => {
          setReason(event.target.value);
        }}
        helperText={t.cancel.reasonCounter(reason.length, MAX_CANCEL_REASON_LENGTH)}
        fullWidth
        multiline
        minRows={2}
        disabled={loading}
        data-testid={`cancel-subscription-reason-${subscription.id}`}
        slotProps={{ htmlInput: { maxLength: MAX_CANCEL_REASON_LENGTH } }}
      />
    </SubscriptionFormDialog>
  );
}
