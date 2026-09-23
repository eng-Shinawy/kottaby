"use client";

/**
 * useAdjustWalletMutation — the manual credit/debit wallet-adjustment
 * mutation of the admin wallet inspector (`/admin/finances`, wallet tab).
 * On success the wallet inspector + withdrawal queue reads refetch (the
 * adjustment moves wallet balance on the server) and the returned
 * `TeacherTransaction` payload auto-merges onto the cached ledger entities
 * by id on top; every error code surfaces through the shared outcome arms
 * up to the container — never the raw server `message`.
 *
 * CONFLICT on this arm is the over-balance debit (the insufficient-balance
 * lane), NOT a settlement race — the arm mapping differs from the settle
 * hooks by design. The amount stays an exact decimal STRING — never parsed
 * to float; `WalletAdjustmentDirection` is a VALUE import in runtime
 * expressions.
 */

import { useMutation } from "@apollo/client/react";
import type {
  AdjustTeacherWalletMutationVariables,
  WalletAdjustmentDirection,
} from "@/frontend/graphql/generated/gql/graphql";
import { adjustTeacherWalletMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorCode } from "@/frontend/lib/graphql-error-utils";
import { normalizeGraphQLErrorCode } from "@/frontend/providers/apollo/error-link.map";
import {
  type MutationOutcomeCallbacks,
  routeMutationError,
} from "@/frontend/views/admin/finances/mutationErrorRouting";

/**
 * useAdjustTeacherWallet — the manual credit/debit adjustment mutation.
 * CONFLICT on this arm is the over-balance debit (the insufficient-balance
 * lane), NOT a settlement race — the arm mapping differs from the settle
 * hooks by design.
 */
export function useAdjustTeacherWallet(callbacks: MutationOutcomeCallbacks) {
  const [adjustTeacherWallet, { loading }] = useMutation(adjustTeacherWalletMutationDocument, {
    refetchQueries: ["AdminTeacherWallet", "AdminPendingWithdrawals"],
    awaitRefetchQueries: false,
    onCompleted: () => {
      callbacks.onSettled();
    },
    onError: error => {
      const rawCode = extractErrorCode(error);
      const code = rawCode === null ? "" : normalizeGraphQLErrorCode(rawCode);
      if (code === "CONFLICT") {
        callbacks.onInsufficientBalance();
        return;
      }
      routeMutationError(error, callbacks);
    },
  });

  const adjust = (input: {
    teacherId: number;
    amount: string;
    direction: WalletAdjustmentDirection;
    reason: string;
  }): void => {
    const variables: AdjustTeacherWalletMutationVariables = {
      input: {
        teacherId: String(input.teacherId),
        amount: input.amount,
        direction: input.direction,
        reason: input.reason,
      },
    };
    void adjustTeacherWallet({ variables });
  };

  return { adjust, loading };
}
