"use client";

/**
 * useWalletOutcomeCallbacks — the mutation outcome wiring of the admin
 * wallet inspector (`/admin/finances`, wallet tab): maps every
 * {@link MutationOutcomeCallbacks} arm onto the container-level snackbar
 * notice (localized copy only — the raw server `message` is NEVER echoed).
 *
 * The manual wallet-adjustment hook consumes these callbacks; success
 * closes the adjust dialog and every rejection lane carries its own
 * namespace copy.
 */

import { useCallback } from "react";
import type { MutationOutcomeCallbacks } from "@/frontend/views/admin/finances/useAdminFinanceQueries";
import { Errors, useAppTranslation } from "@/shared/locale";
import { AdminFinance } from "@/shared/locale/namespaces/adminFinance";

/** The snackbar notice record the panel renders through `NoticeSnackbar`. */
export type WalletNotice = { message: string; severity: "success" | "info" | "error" };

/**
 * Builds the adjust-mutation outcome callbacks: every arm surfaces a
 * localized snackbar lane, success closes the dialog first.
 */
export function useWalletOutcomeCallbacks(
  setNotice: (notice: WalletNotice | null) => void,
  closeDialog: () => void
): MutationOutcomeCallbacks {
  const t = useAppTranslation(AdminFinance);
  const te = useAppTranslation(Errors);

  return {
    onSettled: useCallback(() => {
      closeDialog();
      setNotice({ message: t.adjustSuccessMessage, severity: "success" });
    }, [closeDialog, setNotice, t.adjustSuccessMessage]),
    onRequestNotFound: useCallback(() => {
      setNotice({ message: te.teacherNotFound, severity: "error" });
    }, [setNotice, te.teacherNotFound]),
    onNotPending: useCallback(() => {
      setNotice({ message: te.withdrawalNotPending, severity: "error" });
    }, [setNotice, te.withdrawalNotPending]),
    onInsufficientBalance: useCallback(() => {
      setNotice({ message: te.insufficientBalance, severity: "error" });
    }, [setNotice, te.insufficientBalance]),
    onInvalidAmount: useCallback(() => {
      setNotice({ message: te.invalidAdjustmentAmount, severity: "error" });
    }, [setNotice, te.invalidAdjustmentAmount]),
    onReasonRequired: useCallback(() => {
      setNotice({ message: te.adjustmentReasonRequired, severity: "error" });
    }, [setNotice, te.adjustmentReasonRequired]),
    onForbidden: useCallback(() => {
      setNotice({ message: te.forbidden, severity: "error" });
    }, [setNotice, te.forbidden]),
    onFailure: useCallback(() => {
      setNotice({ message: t.errorTitle, severity: "error" });
    }, [setNotice, t.errorTitle]),
  };
}
