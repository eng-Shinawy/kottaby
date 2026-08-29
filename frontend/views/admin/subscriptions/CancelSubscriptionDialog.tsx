"use client";

import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import type { ReactNode } from "react";
import type { AdminSubscriptionsQuery_adminSubscriptions_items } from "@/frontend/graphql/generated/gql/graphql";
import type { SubscriptionManagementLabels } from "@/shared/locale/types/subscriptionManagement";

/**
 * `CancelSubscriptionDialog` — the cancel-confirmation dialog of the admin
 * subscription lifecycle manager (DEV1-009).
 *
 * Presentational ONLY: the container owns the mutation, the toasts, and the
 * refetch. Props in → callbacks out.
 *
 * Layout:
 *  - title + the interpolated body (subscriber name + plan title — the two
 *    sentinels of `cancelDialogBody`, parity-locked) rendered inside a
 *    warning-token Alert so the IRREVERSIBILITY of the transition is the
 *    first thing the admin reads;
 *  - confirm rides the `error` family (a destructive administrative act),
 *    dismiss keeps the subscription;
 *  - NO summary rows — the subscriber name and plan title ride the body
 *    verbatim and the underlying DATA lives on the card behind the dialog
 *    (names/emails are data, never re-rendered as prose here).
 *
 * Submit lock: `submitting` disables every action — the dialog stays OPEN
 * on failure (the container keeps it mounted and toasts the failure), so
 * the admin can retry in place.
 *
 * Remount discipline: the container keys this dialog by the subscription id
 * (`key={cancel-${id}}`), so state resets between different subscriptions
 * without effect plumbing (audit-CR2 lesson, mirrored from the storefront).
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * RTL-safe logical composition, zero hardcoded strings.
 */

export interface CancelSubscriptionDialogProps {
  /** The subscription being cancelled (never null while open). */
  readonly subscription: AdminSubscriptionsQuery_adminSubscriptions_items;
  /** Full subscriptionManagement-namespace labels (property access ONLY). */
  readonly labels: SubscriptionManagementLabels;
  /** Mutation in flight — locks every action. */
  readonly submitting: boolean;
  /** Confirm intent — the container fires the cancel mutation. */
  readonly onConfirm: () => void;
  /** Dismiss intent — ignored by the container while submitting. */
  readonly onClose: () => void;
}

export function CancelSubscriptionDialog({
  subscription,
  labels,
  submitting,
  onConfirm,
  onClose,
}: Readonly<CancelSubscriptionDialogProps>): ReactNode {
  const busy = submitting;

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      aria-labelledby="admin-cancel-title"
      aria-describedby="admin-cancel-body"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="admin-cancel-title" sx={{ fontWeight: 700 }}>
        {labels.cancelDialogTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2 }}>
        {/* The interpolated body inside a warning-token Alert — the
            irreversibility emphasis (member loses access immediately). */}
        <Alert
          severity="warning"
          variant="outlined"
          id="admin-cancel-body"
          data-testid="admin-cancel-body"
          sx={{ borderRadius: 2 }}
        >
          {labels.cancelDialogBody(subscription.user.fullName, subscription.plan.title)}
        </Alert>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          disabled={busy}
          variant="text"
          sx={{ borderRadius: 2 }}
          data-testid="admin-cancel-dismiss"
        >
          {labels.cancelDialogDismiss}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={busy}
          variant="contained"
          color="error"
          data-testid="admin-cancel-confirm"
          sx={{ borderRadius: 2 }}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {labels.cancelDialogConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
