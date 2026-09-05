/**
 * useTeacherWalletWithdraw — the withdrawal-request write path, extracted
 * verbatim from `TeacherWalletContainer` (the max-lines split).
 *
 * Owns the dialog open slot, the single in-flight submit marker, and the
 * `requestWithdrawal` mutation. Cache convergence is NORMALIZATION ONLY
 * (NO refetch): the returned `Wallet!` payload carries `id` FIRST, so
 * Apollo normalizes the post-debit balance + refreshed ledger onto
 * `Wallet:<id>`; the `update` callback is the belt-and-braces
 * `cache.modify` that keeps the normalized fields converged even if the
 * automatic merge were bypassed. Error arms: `WALLET_INSUFFICIENT_FUNDS`
 * keeps the dialog OPEN for a retry (the localized funds denial rides the
 * snackbar); everything else falls through to the generic snackbar.
 */

import { useMutation } from "@apollo/client/react";
import { useCallback, useState } from "react";
import { requestWithdrawalMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import { type ContainerNotice, isClientValidAmount } from "@/frontend/views/teacher/wallet/teacherWalletShared";
import { Errors, useAppTranslation, Wallet } from "@/shared/locale";

/** Wiring the withdrawal mutation needs from the container. */
export interface TeacherWalletWithdrawWiring {
  readonly setNotice: (notice: ContainerNotice) => void;
}

export interface TeacherWalletWithdraw {
  readonly withdrawDialogOpen: boolean;
  readonly openDialog: () => void;
  readonly closeDialog: () => void;
  readonly inFlight: boolean;
  /** Validates the client mirror, then fires the payout write. */
  readonly handleWithdraw: (rawAmount: string) => void;
}

/** The withdrawal write path — see the module docblock. */
export function useTeacherWalletWithdraw(wiring: TeacherWalletWithdrawWiring): TeacherWalletWithdraw {
  const t = useAppTranslation(Wallet);
  const te = useAppTranslation(Errors);
  const { setNotice } = wiring;

  // Withdrawal-dialog open slot + the in-flight submit marker.
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [inFlight, setInFlight] = useState(false);

  const openDialog = useCallback((): void => {
    setWithdrawDialogOpen(true);
  }, []);

  const closeDialog = useCallback((): void => {
    setWithdrawDialogOpen(false);
  }, []);

  const [requestWithdrawal] = useMutation(requestWithdrawalMutationDocument);

  const handleWithdraw = useCallback(
    (rawAmount: string): void => {
      const trimmed = rawAmount.trim();
      // Client mirror first (UX); the server re-validates authoritatively.
      if (!isClientValidAmount(trimmed)) {
        setNotice({ message: te.walletInvalidAmount, severity: "error" });
        return;
      }
      setInFlight(true);
      void requestWithdrawal({
        variables: { input: { amount: trimmed } },
        // Cache convergence is Apollo-normal, NO refetch and NO manual
        // cache.modify: the payload selects `id` first on `Wallet`, so the
        // mutation result deep-merges onto `Wallet:<id>` (balance +
        // totalEarning + the refreshed ledger) and Apollo normalizes the
        // returned `TeacherTransaction` rows into references. Writing raw
        // objects over the normalized `transactions` field here would freeze
        // embedded copies into the wallet and desynchronize later
        // `TeacherTransaction:<id>` updates.
        onCompleted: () => {
          setInFlight(false);
          setWithdrawDialogOpen(false);
          setNotice({ message: t.withdrawSuccessNotice, severity: "success" });
        },
        onError: mutationError => {
          setInFlight(false);
          const rawCode = extractErrorCode(mutationError);
          const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
          if (code === "WALLET_INSUFFICIENT_FUNDS") {
            // The dialog STAYS OPEN for a retry; the localized funds denial
            // rides the snackbar (the shared error surface).
            setNotice({ message: te.insufficientBalance, severity: "error" });
            return;
          }
          setNotice({ message: t.genericError, severity: "error" });
        },
      });
    },
    [requestWithdrawal, te, t, setNotice]
  );

  return { withdrawDialogOpen, openDialog, closeDialog, inFlight, handleWithdraw };
}
