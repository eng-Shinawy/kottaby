"use client";

/**
 * ApproveWithdrawalDialog — the settlement confirm dialog of the withdrawal
 * payout queue (`/admin/finances`): approve (settle → completed) for ONE
 * pending withdrawal. Confirm/cancel only — NO reason field (an approval is
 * not reason-bearing; the rejection dialog owns the mandatory reason).
 *
 * Structural sibling of the session-governance dialog family: the gated
 * `Dialog` shell (backdrop click and Escape are IGNORED while the mutation
 * is pending — the cancel Button is separately disabled), the form element
 * hosted on the paper, and `React.SubmitEvent` discipline — carried by the
 * shared {@link GovernanceFormDialog} / {@link GovernanceDialogActions}
 * atoms.
 *
 * The mutation lives in the parent panel's `useApproveWithdrawal` seam —
 * this dialog is presentational and receives the trigger + in-flight flag.
 *
 * MUI v9 discipline: `sx`-only styling, theme-palette colors, ≥44px touch
 * targets, keyboard-focusable dialog (`aria-labelledby`).
 */

import { Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { SettlementAmountRow } from "@/frontend/views/admin/finances/SettlementAmountRow";
import {
  GovernanceDialogActions,
  GovernanceFormDialog,
} from "@/frontend/views/admin/session-governance/dialogFormAtoms";
import { AdminFinance, Common, useAppTranslation } from "@/shared/locale";

interface ApproveWithdrawalDialogProps {
  /** The teacher whose withdrawal is being approved (the copy names them). */
  readonly teacherName: string;
  /** The pending amount (pre-formatted, the queue row's own display form). */
  readonly amount: string;
  readonly open: boolean;
  /** Dismiss intent — ignored while the mutation is pending. */
  readonly onClose: () => void;
  /** Validated submit intent (confirm/cancel, no reason field). */
  readonly onSubmit: () => void;
  /** True while the approve mutation is in flight. */
  readonly loading: boolean;
  /** The submit affordance's testid (the suites + e2e drive it). */
  readonly submitTestId: string;
}

/** Confirm-and-settle dialog for one pending withdrawal (no reason field). */
export function ApproveWithdrawalDialog({
  teacherName,
  amount,
  open,
  onClose,
  onSubmit,
  loading,
  submitTestId,
}: Readonly<ApproveWithdrawalDialogProps>): ReactNode {
  const t = useAppTranslation(AdminFinance);
  const tc = useAppTranslation(Common);

  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (loading) return;
    onSubmit();
  };

  return (
    <GovernanceFormDialog
      open={open}
      onClose={onClose}
      loading={loading}
      onSubmit={handleSubmit}
      titleId="approve-withdrawal-dialog-title"
      title={t.approveAction}
      actions={
        <GovernanceDialogActions
          onClose={onClose}
          loading={loading}
          cancelLabel={tc.cancel}
          submitLabel={t.approveAction}
          submitTestId={submitTestId}
        />
      }
    >
      {/* The settlement context: WHO (the teacher) and HOW MUCH — the amount
          is the confirm's whole point, so it renders as a labeled value row
          instead of being buried in a sentence. */}
      <Stack spacing={1} sx={{ mb: 0.5 }}>
        <Typography variant="body2" component="p" sx={theme => ({ color: theme.palette.text.secondary })}>
          {teacherName}
        </Typography>
        <SettlementAmountRow amount={amount} testId="approve-withdrawal-amount" />
      </Stack>
    </GovernanceFormDialog>
  );
}
