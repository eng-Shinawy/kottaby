"use client";

import {
  PaymentsOutlined as CashIcon,
  BadgeOutlined as ReferenceIcon,
  AccountBalanceOutlined as TransferIcon,
} from "@mui/icons-material";
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import type { ReactNode } from "react";
import { useState } from "react";
import type { AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests } from "@/frontend/graphql/generated/gql/graphql";
import { formatApplicantDate } from "@/frontend/lib/i18n/format-date";
import type { PaymentVerificationLabels } from "@/shared/locale/types/paymentVerification";

/**
 * `VerifyPaymentDialog` — the verify-payment dialog of the admin
 * verification queue (DEV1-006 Phase B).
 *
 * Presentational + input-collection ONLY: the container owns the mutation,
 * the toasts, and the refetch. Props in → callbacks out.
 *
 * Layout:
 *  - title + interpolated body (plan title — single sentinel, parity-locked);
 *  - the purchaser/plan summary as labeled rows (NOT interpolated prose —
 *    names and emails must never ride translation strings);
 *  - the offline payment-method choice as a full-width exclusive
 *    ToggleButtonGroup (two options — the service's sanctioned set: the
 *    raw enum values travel to the mutation, the localized labels render);
 *  - the payment-reference input (required, trimmed container-side before
 *    submit; confirm stays disabled while trimmed-empty so a blank receipt
 *    can never fire the mutation).
 *
 * Submit lock: `submitting` disables every action — the dialog stays OPEN
 * on failure (the container keeps it mounted and toasts the failure), so
 * the admin can retry in place.
 *
 * Remount discipline: the container keys this dialog by the request id
 * (`key={verify-${id}}`), so state resets between different requests
 * without effect plumbing (audit-CR2 lesson, mirrored from the storefront).
 *
 * MUI v9 discipline: `sx`-only styling through theme-palette tokens,
 * `*Outlined` icons, RTL-safe logical composition, zero hardcoded strings.
 */

/** The two sanctioned offline methods — the wire values the mutation takes. */
const OFFLINE_METHODS = ["offline_cash", "bank_transfer"] as const;
type OfflineMethod = (typeof OFFLINE_METHODS)[number];

export interface VerifyPaymentDialogProps {
  /** The pending request being verified (never null while open). */
  readonly request: AdminPendingSubscriptionRequestsQuery_adminPendingSubscriptionRequests;
  /** Full paymentVerification-namespace labels (property access ONLY). */
  readonly labels: PaymentVerificationLabels;
  /** App locale tag for the requested-at timestamp rendering. */
  readonly locale: string;
  /** Mutation in flight — locks every action. */
  readonly submitting: boolean;
  /** Confirm intent — the container trims + fires the mutation. */
  readonly onSubmit: (input: { paymentMethod: OfflineMethod; paymentReference: string }) => void;
  /** Dismiss intent — ignored by the container while submitting. */
  readonly onClose: () => void;
}

/** Labeled summary row inside the dialog (icon + label + value). */
function SummaryRow({
  label,
  value,
  secondary,
}: Readonly<{ label: string; value: string; secondary?: string }>): ReactNode {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {value}
      </Typography>
      {secondary ? (
        <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary })}>
          {secondary}
        </Typography>
      ) : null}
    </Stack>
  );
}

export function VerifyPaymentDialog({
  request,
  labels,
  locale,
  submitting,
  onSubmit,
  onClose,
}: Readonly<VerifyPaymentDialogProps>): ReactNode {
  const [paymentMethod, setPaymentMethod] = useState<OfflineMethod>("offline_cash");
  const [paymentReference, setPaymentReference] = useState("");

  // Confirm stays disabled until the reference has non-whitespace content —
  // the service re-validates authoritatively (trim + 1..255), this is the
  // UX fence that keeps a blank receipt unsubmittable.
  const referenceReady = paymentReference.trim().length > 0;
  const busy = submitting;

  return (
    <Dialog
      open
      onClose={() => {
        if (!busy) {
          onClose();
        }
      }}
      aria-labelledby="admin-verify-title"
      aria-describedby="admin-verify-body"
      maxWidth="xs"
      fullWidth
    >
      <DialogTitle id="admin-verify-title" sx={{ fontWeight: 700 }}>
        {labels.verifyDialogTitle}
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2.5 }}>
        <DialogContentText id="admin-verify-body">{labels.verifyDialogBody(request.plan.title)}</DialogContentText>

        {/* Purchaser + plan summary — labeled rows, never interpolated into
            copy (names/emails are data, not translation vocabulary). */}
        <Stack
          spacing={1.5}
          sx={theme => ({
            borderRadius: 2,
            border: "1px solid",
            borderColor: theme.palette.outlineVariant,
            bgcolor: theme.palette.surfaceContainerLow,
            p: 2,
          })}
        >
          <SummaryRow label={labels.labelRequestedBy} value={request.user.fullName} secondary={request.user.email} />
          <Divider />
          <SummaryRow label={labels.labelPlan} value={request.plan.title} />
          <Divider />
          <SummaryRow label={labels.labelPrice} value={`${request.plan.price} ${request.plan.currency}`} />
          <Divider />
          <SummaryRow label={labels.labelRequestedAt} value={formatApplicantDate(request.createdAt, locale)} />
        </Stack>

        {/* Offline method choice — exclusive, full width; the ToggleButton
            group carries the field label via its own aria-label + a visible
            caption above (screen readers get both). */}
        <Stack spacing={1}>
          <Typography variant="caption" sx={theme => ({ color: theme.palette.text.secondary, fontWeight: 600 })}>
            {labels.labelPaymentMethod}
          </Typography>
          <ToggleButtonGroup
            exclusive
            value={paymentMethod}
            onChange={(_event, value: OfflineMethod | null) => {
              if (value !== null) {
                setPaymentMethod(value);
              }
            }}
            fullWidth
            aria-label={labels.labelPaymentMethod}
            sx={{ borderRadius: 2 }}
          >
            <ToggleButton value="offline_cash" aria-label={labels.methodOfflineCash} disabled={busy}>
              <CashIcon fontSize="small" sx={{ marginInlineEnd: 1 }} aria-hidden />
              {labels.methodOfflineCash}
            </ToggleButton>
            <ToggleButton value="bank_transfer" aria-label={labels.methodBankTransfer} disabled={busy}>
              <TransferIcon fontSize="small" sx={{ marginInlineEnd: 1 }} aria-hidden />
              {labels.methodBankTransfer}
            </ToggleButton>
          </ToggleButtonGroup>
        </Stack>

        {/* Reference input — the auditable artifact of the offline payment. */}
        <TextField
          label={labels.labelPaymentReference}
          placeholder={labels.paymentReferencePlaceholder}
          value={paymentReference}
          onChange={event => setPaymentReference(event.target.value)}
          disabled={busy}
          required
          size="small"
          slotProps={{
            input: {
              startAdornment: (
                <ReferenceIcon
                  fontSize="small"
                  sx={theme => ({ marginInlineEnd: 1, color: theme.palette.text.secondary })}
                  aria-hidden
                />
              ),
            },
          }}
          data-testid="admin-verify-reference"
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onClose}
          disabled={busy}
          variant="text"
          sx={{ borderRadius: 2 }}
          data-testid="admin-verify-cancel"
        >
          {labels.verifyDialogCancel}
        </Button>
        <Button
          // The raw enum value — the service narrows authoritatively; the
          // toggle can only ever produce the two sanctioned values anyway.
          onClick={() => onSubmit({ paymentMethod, paymentReference: paymentReference.trim() })}
          disabled={busy || !referenceReady}
          variant="contained"
          data-testid="admin-verify-submit"
          sx={{ borderRadius: 2 }}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          {labels.verifyDialogConfirm}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
