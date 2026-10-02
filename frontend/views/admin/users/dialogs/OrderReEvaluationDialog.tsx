"use client";

/**
 * OrderReEvaluationDialog — the admin-ordered PAID re-evaluation
 * confirmation dialog (`adminOrderTeacherReEvaluation`), modeled on the
 * sibling `CertifyTeacherDialog` and invoked from the user-detail hero for
 * a CERTIFIED teacher (the certify slot's mirror image: certify targets
 * the not-yet-approved applicant, this targets the approved teacher).
 *
 * Composition (info + warning toned):
 *  - a plain text-only title row;
 *  - an outlined info banner explaining the fee deduction TRUTHFULLY and
 * generically — the copy never hardcodes an amount (pricing is
 * server-owned; the server-returned receipt carries the real figures);
 *  - a MANDATORY multiline reason field (client-mirrored non-empty gate —
 *    an invalid value never crosses the wire; the server re-validates and
 *    also enforces its own length bound, whose denial maps to the same
 *    localized copy);
 *  - the target's name + email (the wallet being charged) as muted lines;
 *  - footer Cancel (outlined, neutral) + Confirm (contained `primary`).
 *
 * Error-propagation contract (deliberate — same as `CertifyTeacherDialog`):
 * the caller's `onResolve(reason)` MUST let mutation rejections PROPAGATE;
 * this dialog catches them, maps the closed denial codes
 * (`WALLET_INSUFFICIENT_FUNDS` / `TEACHER_NOT_CERTIFIED` /
 * `APPLICANT_NOT_AWAITING_RE_EVALUATION` / `VALIDATION` / the admin-gate
 * `FORBIDDEN` / `UNAUTHORIZED`) to their `Errors` transport copy via
 * {@link orderReEvaluationErrorCopy} — an `extensions.code` map, NEVER an
 * HTTP-status branch — and renders the message in an inline warning Alert;
 * the dialog STAYS OPEN. Unknown codes fall back to the generic
 * `internalServerError` copy. Only success lets the caller close the
 * dialog (after awaiting the mutation). A TERMINAL state denial
 * (`TEACHER_NOT_CERTIFIED` / `APPLICANT_NOT_AWAITING_RE_EVALUATION`) can
 * never succeed on resubmission — those preconditions are server-owned
 * state the resubmission itself cannot change — so Confirm is disabled
 * while one of those codes is displayed (the `CertifyTeacherDialog`
 * terminal-denial discipline); everything else stays retryable (the
 * wallet-funds conflict can succeed after a concurrent top-up; network,
 * admin-gate, and generic failures keep Confirm enabled).
 * `onResolve(null)` is the cancel path — no mutation is
 * fired. While the mutation is in flight
 * (`loading`), Escape/backdrop close requests are ignored so a slow
 * rejection can still surface its inline alert — the Cancel button is
 * likewise disabled for the same window (the footer lives in
 * `OrderReEvaluationDialogFooter`, the `DeleteConfirmDialogBody` parts-file
 * precedent).
 *
 * Accessibility: the title row is wired to the dialog via
 * `aria-labelledby`, and the enter/exit transition collapses to `timeout
 * = 0` under `prefers-reduced-motion: reduce` (the
 * `RateTeacherDialog` slotProps.transition precedent).
 */

import { Alert, Dialog, DialogContent, DialogTitle, TextField, Typography, useMediaQuery } from "@mui/material";
import { type ReactNode, useState } from "react";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { OrderReEvaluationFooter } from "@/frontend/views/admin/users/dialogs/OrderReEvaluationDialogFooter";
import {
  isOrderReEvaluationReasonValid,
  orderReEvaluationErrorCopy,
} from "@/frontend/views/admin/users/dialogs/order-re-evaluation-dialog.helpers";
import { Errors, useAppTranslation } from "@/shared/locale";
import type { AdminUsersLabels } from "@/shared/locale/types/adminUsers";

/**
 * Denial codes that can NEVER succeed on resubmission: the two state-
 * machine denials (a non-certified teacher, a non-`passed` applicant) are
 * server-owned state the resubmission itself cannot change, so once one
 * fires, resubmitting the identical order is pointless and Confirm is
 * disabled while its copy is showing. State-machine denials cannot succeed
 * on resubmission; conflicts stay retryable — notably the wallet-funds
 * denial, where a concurrent top-up makes the identical order succeed —
 * as do network, admin-gate, and generic failures.
 */
const TERMINAL_DENIAL_CODES: ReadonlySet<string> = new Set([
  "APPLICANT_NOT_AWAITING_RE_EVALUATION",
  "TEACHER_NOT_CERTIFIED",
]);

/**
 * Minimal shape `OrderReEvaluationDialog` needs from its target user — the
 * detail-page projection structurally satisfies this interface (the
 * `AdminUserCertifyTarget` sibling precedent).
 */
export interface AdminUserReEvaluationTarget {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
}

interface OrderReEvaluationDialogProps {
  readonly labels: Pick<AdminUsersLabels, "orderReEvaluation">;
  /** `null` renders nothing — the caller mounts the dialog only when armed. */
  readonly targetUser: AdminUserReEvaluationTarget | null;
  readonly loading: boolean;
  /**
   * `onResolve(reason)` fires the mutation; `onResolve(null)` cancels.
   * Rejections MUST propagate — they land in this dialog's inline alert.
   */
  readonly onResolve: (reason: string | null) => Promise<void> | void;
}

export function OrderReEvaluationDialog({
  labels,
  targetUser,
  loading,
  onResolve,
}: OrderReEvaluationDialogProps): ReactNode {
  const copy = labels.orderReEvaluation;
  const te = useAppTranslation(Errors);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)", { noSsr: true });
  const [reason, setReason] = useState("");
  const [reasonErr, setReasonErr] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  if (!targetUser) return null;

  const handleConfirm = async () => {
    setErrorMessage(null);
    setErrorCode(null);
    setReasonErr(null);
    if (!isOrderReEvaluationReasonValid(reason)) {
      setReasonErr(copy.reasonRequiredHint);
      return undefined;
    }
    try {
      await onResolve(reason);
    } catch (err) {
      const code = extractErrorCode(err);
      const serverMessage = err instanceof Error ? err.message : null;
      setErrorMessage(orderReEvaluationErrorCopy(code, te, serverMessage));
      setErrorCode(code);
    }
    return undefined;
  };

  // Escape/backdrop requests are ignored while the mutation is in flight:
  // closing would unmount the dialog before a rejection surfaces inline.
  const handleClose = () => (loading ? undefined : onResolve(null));

  // A terminal state denial can never succeed on resubmission — Confirm is
  // disabled while its copy is showing; a retryable failure (network,
  // generic internal) leaves the code lane empty and Confirm enabled.
  const confirmDisabled = loading || (errorCode !== null && TERMINAL_DENIAL_CODES.has(errorCode));

  return (
    <Dialog
      open
      onClose={handleClose}
      fullWidth
      maxWidth="xs"
      aria-labelledby="order-re-evaluation-dialog-title"
      slotProps={{
        transition: { timeout: reducedMotion ? 0 : undefined },
        paper: { sx: { borderRadius: "16px" } },
      }}
    >
      <DialogTitle id="order-re-evaluation-dialog-title" sx={{ px: 3, pt: 3, pb: 1 }}>
        {copy.dialogTitle}
      </DialogTitle>
      <DialogContent sx={{ px: 3, pt: 1, pb: 1 }}>
        {errorMessage !== null && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {errorMessage}
          </Alert>
        )}
        <Alert severity="info" variant="outlined" sx={{ wordBreak: "break-word" }}>
          {copy.feeExplanation}
        </Alert>
        <TextField
          value={reason}
          disabled={loading}
          onChange={event => {
            setReason(event.target.value);
            if (reasonErr !== null) setReasonErr(null);
          }}
          label={copy.reasonLabel}
          helperText={reasonErr ?? copy.reasonRequiredHint}
          error={reasonErr !== null}
          aria-invalid={reasonErr !== null}
          multiline
          rows={4}
          fullWidth
          sx={theme => ({ mt: 2, "& .MuiOutlinedInput-root": { backgroundColor: theme.palette.background.paper } })}
        />
        <Typography
          variant="caption"
          sx={theme => ({ display: "block", mt: 1, color: theme.palette.text.secondary, overflowWrap: "anywhere" })}
        >
          {targetUser.fullName}
        </Typography>
        <Typography
          variant="caption"
          sx={theme => ({ display: "block", color: theme.palette.text.secondary, overflowWrap: "anywhere" })}
        >
          {targetUser.email}
        </Typography>
      </DialogContent>
      <OrderReEvaluationFooter
        copy={copy}
        loading={loading}
        confirmDisabled={confirmDisabled}
        onCancel={() => onResolve(null)}
        onConfirm={() => void handleConfirm()}
      />
    </Dialog>
  );
}
