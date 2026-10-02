"use client";

/**
 * useOrderTeacherReEvaluation — the admin-ordered paid re-evaluation
 * mutation hook (`adminOrderTeacherReEvaluation`).
 *
 * Consumed by the admin user DETAIL page's `OrderReEvaluationDialog`
 * wiring: the caller awaits {@link useOrderTeacherReEvaluation.orderReEvaluation}
 * so rejections PROPAGATE into the dialog's confirm handler — the dialog
 * maps the failure's `extensions.code` to its localized copy (never an
 * HTTP-status branch) and stays open; only a fulfilled receipt closes it.
 *
 * Success path: the receipt is read back inline under the mutation field
 * (the id-less `TeacherReEvaluationOrder` payload is `keyFields: false` in
 * the Apollo cache — nothing auto-merges), so the hook refetches the two
 * affected caches by operation name — the admin user detail
 * (`AdminUserDetail`, whose teacher/applicant snapshots go stale:
 * de-certified + re-opened) and the teacher's admin wallet view
 * (`AdminTeacherWallet`, whose balance dropped). `awaitRefetchQueries`
 * stays `false` so the dialog closes immediately (the
 * `useAdjustTeacherWallet` precedent).
 *
 * Security notes: the wire carries ONLY `teacherId` + `reason` — the
 * actor is derived server-side and the fee is server-owned pricing (no
 * caller price surface exists); no token is ever logged. Error handling
 * reads
 * `extensions.code` via the caller's `extractErrorCode` mapping — never
 * an HTTP status.
 */

import { useMutation } from "@apollo/client/react";
import type { AdminOrderTeacherReEvaluationMutationVariables } from "@/frontend/graphql/generated/gql/graphql";
import { adminOrderTeacherReEvaluationMutationDocument } from "@/frontend/graphql/sharedDocuments/admin";

/**
 * Operation names refetched after a successful order — the two caches the
 * order invalidates server-side (the detail page's teacher/applicant
 * snapshots and the teacher's wallet balance). Exported as the single
 * source of truth the hook consumes, so the contract is test-locked at the
 * pure logic tier.
 */
export const ORDER_RE_EVALUATION_REFETCH_QUERIES = ["AdminUserDetail", "AdminTeacherWallet"] as const;

/** Caller-facing order input (numeric user key + mandatory reason). */
export interface OrderReEvaluationInput {
  /** The subject teacher's user id (the wallet the fee is charged from). */
  readonly teacherId: number;
  /** Mandatory free-text reason recorded in the ledger + audit trail. */
  readonly reason: string;
}

/**
 * Builds the wire variables — the numeric user key rides the
 * admin-finance `String(id)` two-step (GraphQL `ID` is a string on the
 * wire). Exported as the single source of truth the hook consumes so the
 * variable contract (`teacherId` + `reason` ONLY — no actor id, no fee)
 * is test-locked at the pure logic tier.
 */
export function buildOrderReEvaluationVariables(
  input: OrderReEvaluationInput
): AdminOrderTeacherReEvaluationMutationVariables {
  return {
    teacherId: String(input.teacherId),
    reason: input.reason,
  };
}

/**
 * useOrderTeacherReEvaluation — returns the awaited mutation runner (its
 * promise REJECTS on GraphQL errors so the caller's dialog can map the
 * `extensions.code`) plus the in-flight flag for the dialog's busy state.
 */
export function useOrderTeacherReEvaluation() {
  const [orderTeacherReEvaluation, { loading }] = useMutation(adminOrderTeacherReEvaluationMutationDocument, {
    refetchQueries: [...ORDER_RE_EVALUATION_REFETCH_QUERIES],
    awaitRefetchQueries: false,
  });

  const orderReEvaluation = (input: OrderReEvaluationInput) =>
    orderTeacherReEvaluation({ variables: buildOrderReEvaluationVariables(input) });

  return { orderReEvaluation, loading };
}
