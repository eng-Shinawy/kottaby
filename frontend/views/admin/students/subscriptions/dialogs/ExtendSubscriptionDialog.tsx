"use client";

import { Alert, TextField } from "@mui/material";
import { type ReactNode, useState } from "react";
import {
  SubscriptionDialogActions,
  SubscriptionFormDialog,
} from "@/frontend/views/admin/students/subscriptions/dialogs/subscriptionDialogAtoms";
import {
  parseExtendDays,
  type SubscriptionRow,
} from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import { Common, SubscriptionAdmin, useAppTranslation } from "@/shared/locale";

/**
 * ExtendSubscriptionDialog — extends an ACTIVE subscription's validity
 * window by a whole number of days.
 *
 * Client-side validation: the days input must parse to a whole
 * count > 0 (`parseExtendDays`) before the submit intent fires — the
 * invalid arm pins the field's own localized message and never rounds
 * through the server. The server keeps the window-ceiling authority;
 * its localized denials surface in the inline error alert.
 *
 * Presentational: the mutation lives in `useSubscriptionAdminActions`
 * (wired by the section); the dialog forwards the validated days count
 * and stays open on every failure arm for a corrected submit.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby` + focusable field).
 */

interface ExtendSubscriptionDialogProps {
  /** The subscription being extended (drives the testid). */
  readonly subscription: SubscriptionRow;
  readonly open: boolean;
  /** Dismiss intent — ignored while the mutation is in flight. */
  readonly onClose: () => void;
  /** True while the section's extend mutation is in flight. */
  readonly loading: boolean;
  /** The server-localized denial (inline alert) — `null` hides the alert. */
  readonly error: string | null;
  /** Submit intent — the validated whole-days count (days > 0 gate passed). */
  readonly onSubmit: (days: number) => void;
}

export function ExtendSubscriptionDialog({
  subscription,
  open,
  onClose,
  loading,
  error,
  onSubmit,
}: Readonly<ExtendSubscriptionDialogProps>): ReactNode {
  const t = useAppTranslation(SubscriptionAdmin);
  const tc = useAppTranslation(Common);

  const [days, setDays] = useState("");
  const [daysInvalid, setDaysInvalid] = useState(false);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) {
      return;
    }
    const parsedDays = parseExtendDays(days);
    if (parsedDays === null) {
      setDaysInvalid(true);
      return;
    }
    onSubmit(parsedDays);
  };

  return (
    <SubscriptionFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="extend-subscription-dialog-title"
      title={t.extend.title}
      actions={
        <SubscriptionDialogActions
          onClose={onClose}
          loading={loading}
          dismissLabel={tc.cancel}
          submitLabel={t.actions.extend}
          submitTestId={`extend-subscription-submit-${subscription.id}`}
          submitDisabled={daysInvalid && parseExtendDays(days) === null}
        />
      }
    >
      {error && (
        <Alert severity="error" sx={{ width: "100%" }}>
          {error}
        </Alert>
      )}
      <TextField
        label={t.extend.daysLabel}
        type="number"
        value={days}
        onChange={event => {
          setDays(event.target.value);
          setDaysInvalid(false);
        }}
        error={daysInvalid}
        helperText={daysInvalid ? t.extend.daysInvalid : t.extend.daysHelper}
        aria-invalid={daysInvalid}
        fullWidth
        required
        disabled={loading}
        data-testid={`extend-subscription-days-${subscription.id}`}
        slotProps={{ htmlInput: { min: 1, step: 1 } }}
      />
    </SubscriptionFormDialog>
  );
}
