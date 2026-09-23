"use client";

/**
 * useAdminFinanceNotice — the container-notice slot + the shared
 * mutation-outcome callbacks of the admin financial auditing console
 * (`/admin/finances`). Both settlement panels (the withdrawal payout queue
 * and the wallet inspector) surface EVERY mutation outcome as a
 * container-level snackbar (the raw server `message` is NEVER echoed) and
 * route each code to its localized lane:
 *
 * | Arm (extensions.code family)   | Notice lane |
 * |-------------------------------|-------------|
 * | success (`onSettled`)          | the panel's own localized success copy |
 * | `*_NOT_FOUND`                  | the panel's own not-found lane (teacher vs withdrawal request) |
 * | `withdrawalNotPending`         | `errors.withdrawalNotPending` |
 * | `insufficientBalance`          | `errors.insufficientBalance` |
 * | `invalidAdjustmentAmount`      | `errors.invalidAdjustmentAmount` |
 * | `adjustmentReasonRequired`     | `errors.adjustmentReasonRequired` |
 * | `FORBIDDEN`                    | `errors.forbidden` |
 * | everything else (masked)       | the panel's generic error title |
 *
 * Dialog dismissal is panel-specific: the queue panel closes its settle
 * dialogs on the terminal arms (success / not-found / not-pending), the
 * wallet inspector closes its adjustment dialog on success only — the
 * `onDialogsDismissed` + `dismissOnConflicts` args carry that split.
 */

import { useCallback, useState } from "react";
import type { MutationOutcomeCallbacks } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { Errors, useAppTranslation } from "@/shared/locale";
import { AdminFinance as AdminFinanceNs } from "@/shared/locale/namespaces/adminFinance";

/** Snackbar autohide — the shared container-notice cadence. */
export const ADMIN_FINANCE_NOTICE_AUTOHIDE_MS = 4000;

/** One transient container-level notice rendered in the MUI Snackbar slot. */
export interface AdminFinanceNotice {
  readonly message: string;
  readonly severity: "success" | "info" | "error";
}

interface UseAdminFinanceNoticeArgs {
  /** Success copy — the panel's own localized lane. */
  readonly successMessage: string;
  /** `*_NOT_FOUND` copy — the teacher vs the withdrawal-request lane. */
  readonly requestNotFoundMessage: string;
  /** Terminal-arm dialog dismissal (the panel's dialog-slot reset). */
  readonly onDialogsDismissed: () => void;
  /** The conflict/not-found arms also dismiss the dialogs (the queue panel). */
  readonly dismissOnConflicts?: boolean;
}

/**
 * Owns the transient notice slot and the shared outcome callbacks. The
 * arms close dialogs exactly where the panels did before: `onSettled`
 * always, the conflict/not-found arms only when `dismissOnConflicts` is
 * set (the queue panel's settle-dialog reset).
 */
export function useAdminFinanceNotice({
  successMessage,
  requestNotFoundMessage,
  onDialogsDismissed,
  dismissOnConflicts = false,
}: Readonly<UseAdminFinanceNoticeArgs>): {
  notice: AdminFinanceNotice | null;
  dismissNotice: () => void;
  callbacks: MutationOutcomeCallbacks;
} {
  const t = useAppTranslation(AdminFinanceNs);
  const te = useAppTranslation(Errors);
  const [notice, setNotice] = useState<AdminFinanceNotice | null>(null);

  const dismissNotice = useCallback((): void => {
    setNotice(null);
  }, []);

  const callbacks: MutationOutcomeCallbacks = {
    onSettled: () => {
      onDialogsDismissed();
      setNotice({ message: successMessage, severity: "success" });
    },
    onRequestNotFound: () => {
      if (dismissOnConflicts) {
        onDialogsDismissed();
      }
      setNotice({ message: requestNotFoundMessage, severity: "error" });
    },
    onNotPending: () => {
      if (dismissOnConflicts) {
        onDialogsDismissed();
      }
      setNotice({ message: te.withdrawalNotPending, severity: "error" });
    },
    onInsufficientBalance: () => {
      setNotice({ message: te.insufficientBalance, severity: "error" });
    },
    onInvalidAmount: () => {
      setNotice({ message: te.invalidAdjustmentAmount, severity: "error" });
    },
    onReasonRequired: () => {
      setNotice({ message: te.adjustmentReasonRequired, severity: "error" });
    },
    onForbidden: () => {
      setNotice({ message: te.forbidden, severity: "error" });
    },
    onFailure: () => {
      setNotice({ message: t.errorTitle, severity: "error" });
    },
  };

  return { notice, dismissNotice, callbacks };
}
