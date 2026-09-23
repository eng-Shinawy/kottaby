"use client";

/**
 * WithdrawalQueuePanel — the withdrawal payout queue tab of the admin
 * financial auditing console (`/admin/finances`): the oldest-first queue of
 * pending withdrawal requests over the settle (approve / reject) and
 * wallet-inspection actions.
 *
 * The panel composes its extracted focused siblings — the desktop table
 * card ({@link WithdrawalQueueTableCard}), the mobile card stack
 * ({@link WithdrawalQueueCards}), the row / settle-button pieces
 * ({@link WithdrawalQueueRows}), and the status body
 * ({@link WithdrawalQueueStatusBody}) — and owns the dialog wiring: the
 * Approve confirm dialog (no reason field) and the Reject dialog
 * (mandatory reason), keyed per transaction id so a stale dialog never
 * survives a row change. The mutations live in the panel's own
 * `useApproveWithdrawal` / `useRejectWithdrawal` seams, and EVERY outcome
 * surfaces a container-level snackbar (success / error lanes — the raw
 * server `message` is NEVER echoed). On success the affected admin reads
 * refetch (the settlement moves wallet balance and queue membership on the
 * server).
 *
 * All copy comes from the `AdminFinance` namespace; MUI v9 `sx`-only
 * discipline, theme-palette colors, `*Outlined` icons.
 */

import { Stack } from "@mui/material";
import { type ReactNode, useState } from "react";
import { NoticeSnackbar } from "@/frontend/components/ui/NoticeSnackbar";
import type { AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items } from "@/frontend/graphql/generated/gql/graphql";
import { formatMoneyAmount } from "@/frontend/views/admin/analytics/platform-analytics-display";
import { ApproveWithdrawalDialog } from "@/frontend/views/admin/finances/ApproveWithdrawalDialog";
import { RejectWithdrawalDialog } from "@/frontend/views/admin/finances/RejectWithdrawalDialog";
import {
  ADMIN_FINANCE_NOTICE_AUTOHIDE_MS,
  useAdminFinanceNotice,
} from "@/frontend/views/admin/finances/useAdminFinanceNotice";
import {
  useAdminPendingWithdrawals,
  useApproveWithdrawal,
  useRejectWithdrawal,
} from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { WithdrawalQueueStatusBody } from "@/frontend/views/admin/finances/WithdrawalQueueStatusBody";
import { Errors, useAppLocale, useAppTranslation } from "@/shared/locale";
import { AdminFinance as AdminFinanceNs } from "@/shared/locale/namespaces/adminFinance";

/**
 * The settle dialogs slot of the panel: the Approve confirm dialog and the
 * Reject reason dialog, each keyed per transaction id so a stale dialog
 * never survives a row change.
 */
function WithdrawalSettleDialogs({
  approveTarget,
  rejectTarget,
  approve,
  reject,
  onCloseApprove,
  onCloseReject,
}: Readonly<{
  approveTarget: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items | null;
  rejectTarget: AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items | null;
  approve: { approve: (id: string) => void; loading: boolean };
  reject: { reject: (id: string, reason: string) => void; loading: boolean };
  onCloseApprove: () => void;
  onCloseReject: () => void;
}>): ReactNode {
  return (
    <>
      {approveTarget !== null ? (
        <ApproveWithdrawalDialog
          key={`approve-${approveTarget.transaction.id}`}
          teacherName={approveTarget.teacherName}
          amount={formatMoneyAmount(approveTarget.transaction.amount)}
          open
          onClose={onCloseApprove}
          onSubmit={() => {
            approve.approve(approveTarget.transaction.id);
          }}
          loading={approve.loading}
          submitTestId={`approve-withdrawal-submit-${approveTarget.transaction.id}`}
        />
      ) : null}

      {rejectTarget !== null ? (
        <RejectWithdrawalDialog
          key={`reject-${rejectTarget.transaction.id}`}
          transactionId={rejectTarget.transaction.id}
          amount={formatMoneyAmount(rejectTarget.transaction.amount)}
          open
          onClose={onCloseReject}
          onSubmit={reason => {
            reject.reject(rejectTarget.transaction.id, reason);
          }}
          loading={reject.loading}
          submitTestId={`reject-withdrawal-submit-${rejectTarget.transaction.id}`}
        />
      ) : null}
    </>
  );
}

/** The withdrawal payout queue panel: rows + settle dialogs + snackbar. */
export function WithdrawalQueuePanel(): ReactNode {
  const t = useAppTranslation(AdminFinanceNs);
  const te = useAppTranslation(Errors);
  const locale = useAppLocale();
  const queue = useAdminPendingWithdrawals();

  // Single dialog slot — re-keyed per transaction id (a stale dialog never
  // survives a row change).
  const [approveTarget, setApproveTarget] = useState<AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items | null>(
    null
  );
  const [rejectTarget, setRejectTarget] = useState<AdminPendingWithdrawalsQuery_adminPendingWithdrawals_items | null>(
    null
  );

  // Shared container-notice slot + the outcome callbacks: the terminal arms
  // (success / not-found / not-pending) also dismiss the settle dialogs.
  const dismissDialogs = (): void => {
    setApproveTarget(null);
    setRejectTarget(null);
  };
  const {
    notice,
    dismissNotice,
    callbacks: outcomeCallbacks,
  } = useAdminFinanceNotice({
    successMessage: t.settlementSuccessMessage,
    requestNotFoundMessage: te.withdrawalRequestNotFound,
    onDialogsDismissed: dismissDialogs,
    dismissOnConflicts: true,
  });

  const approve = useApproveWithdrawal(outcomeCallbacks);
  const reject = useRejectWithdrawal(outcomeCallbacks);

  return (
    <Stack spacing={3} data-testid="admin-finances-withdrawals-panel">
      <WithdrawalQueueStatusBody
        queue={queue}
        locale={locale}
        onApprove={setApproveTarget}
        onReject={setRejectTarget}
      />

      <WithdrawalSettleDialogs
        approveTarget={approveTarget}
        rejectTarget={rejectTarget}
        approve={approve}
        reject={reject}
        onCloseApprove={() => {
          setApproveTarget(null);
        }}
        onCloseReject={() => {
          setRejectTarget(null);
        }}
      />

      <NoticeSnackbar notice={notice} autoHideDuration={ADMIN_FINANCE_NOTICE_AUTOHIDE_MS} onClose={dismissNotice} />
    </Stack>
  );
}
