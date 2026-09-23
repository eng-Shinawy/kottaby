"use client";

/**
 * useSubscriptionAdminActions — mutation wiring for the admin student
 * drawer's subscription-management section (the four lifecycle writers).
 *
 * Mirrors the admin plan-catalog dialog hook discipline
 * (`usePlanStatusDialog`): typed `useMutation` wrappers, error
 * propagation as a server-localized string the calling dialog renders
 * inline (`null` on success), and post-success side effects — the drawer
 * query refetch plus the section's success toast hand-off.
 *
 * Success copy for the plan-change mutation is derived from the wire
 * payload's proration summary (direction + carried/forfeited session
 * counts) through the pure `prorationCopyKind` helper — never invented
 * client-side. A zero count on the chosen arm (the idempotent replay
 * moved nothing) suppresses the counted clause entirely — the plain
 * `success.planChange` line renders instead of a "0 sessions" form.
 * Server denials arrive already localized by the backend;
 * `extractErrorMessage` surfaces them verbatim and only a message-less
 * failure degrades to the namespace's generic fallback.
 */
import { useMutation } from "@apollo/client/react";
import { useCallback } from "react";
import type { AdminSubscriptionPlanChangeMutation } from "@/frontend/graphql/generated/gql/graphql";
import {
  adminSubscriptionCancelMutationDocument,
  adminSubscriptionExtendMutationDocument,
  adminSubscriptionPlanChangeMutationDocument,
  adminSubscriptionRenewMutationDocument,
} from "@/frontend/graphql/sharedDocuments/admin";
import { extractErrorMessage } from "@/frontend/lib/graphql-error-utils";
import { prorationCopyKind } from "@/frontend/views/admin/students/subscriptions/subscriptionAdmin.helpers";
import type { SubscriptionAdminLabels } from "@/shared/locale/types/subscriptionAdmin";

export interface UseSubscriptionAdminActionsOptions {
  /** Re-fetches the drawer's subscription query after a successful write. */
  readonly refetch: () => void;
  /** Success-toast hand-off (the section's feedback snackbar). */
  readonly onSuccess: (message: string) => void;
  /** The resolved namespace labels (success + fallback copy). */
  readonly labels: SubscriptionAdminLabels;
}

export interface UseSubscriptionAdminActionsResult {
  /** Extends an active row by whole days. Resolves `null` on success, else the server-localized error. */
  readonly extend: (subscriptionId: string, days: number) => Promise<string | null>;
  /** Renews an expired row. Resolves `null` on success, else the server-localized error. */
  readonly renew: (subscriptionId: string) => Promise<string | null>;
  /** Cancels an active row (optional bounded reason). Resolves `null` on success, else the error. */
  readonly cancel: (subscriptionId: string, reason: string | null) => Promise<string | null>;
  /** Re-plans an active row within its lane. Resolves `null` on success, else the error. */
  readonly changePlan: (subscriptionId: string, newPlanId: string) => Promise<string | null>;
  /** Per-action in-flight flags (drives the dialogs' gated dismissal + spinners). */
  readonly loading: {
    readonly extend: boolean;
    readonly renew: boolean;
    readonly cancel: boolean;
    readonly changePlan: boolean;
  };
}

/** The plan-change mutation's wire payload (proration summary + subscription). */
type AdminChangeSubscriptionPlanPayload = AdminSubscriptionPlanChangeMutation["adminChangeSubscriptionPlan"];

/**
 * Shared lifecycle-mutation runner: executes the mutation, then the
 * post-success side effects (drawer refetch + success toast), resolving
 * `null`; a failure resolves the server-localized denial verbatim, only
 * degrading to the namespace's generic fallback when no message can be
 * extracted.
 */
async function runLifecycleMutation(
  run: () => Promise<unknown>,
  refetch: () => void,
  onSuccess: (message: string) => void,
  successMessage: string,
  fallbackError: string
): Promise<string | null> {
  try {
    await run();
    refetch();
    onSuccess(successMessage);
    return null;
  } catch (error: unknown) {
    return extractErrorMessage(error) ?? fallbackError;
  }
}

/**
 * Resolves the plan-change success toast from the payload's proration
 * summary. A zero count on the chosen arm suppresses the carried/
 * forfeited clause — the plain success line renders instead of a
 * "0 sessions" counted form.
 */
function planChangeToast(payload: AdminChangeSubscriptionPlanPayload, labels: SubscriptionAdminLabels): string {
  if (prorationCopyKind(payload.direction) === "carried") {
    return payload.carrySessions === 0
      ? labels.success.planChange
      : labels.success.planChangeCarried(payload.carrySessions);
  }
  return payload.forfeitedSessions === 0
    ? labels.success.planChange
    : labels.success.planChangeForfeited(payload.forfeitedSessions);
}

export function useSubscriptionAdminActions({
  refetch,
  onSuccess,
  labels,
}: UseSubscriptionAdminActionsOptions): UseSubscriptionAdminActionsResult {
  const [extendMutation, { loading: extendLoading }] = useMutation(adminSubscriptionExtendMutationDocument);
  const [renewMutation, { loading: renewLoading }] = useMutation(adminSubscriptionRenewMutationDocument);
  const [cancelMutation, { loading: cancelLoading }] = useMutation(adminSubscriptionCancelMutationDocument);
  const [planChangeMutation, { loading: planChangeLoading }] = useMutation(adminSubscriptionPlanChangeMutationDocument);

  const extend = useCallback(
    (subscriptionId: string, days: number): Promise<string | null> =>
      runLifecycleMutation(
        () => extendMutation({ variables: { input: { subscriptionId, days } } }),
        refetch,
        onSuccess,
        labels.success.extend(days),
        labels.genericError
      ),
    [extendMutation, refetch, onSuccess, labels]
  );

  const renew = useCallback(
    (subscriptionId: string): Promise<string | null> =>
      runLifecycleMutation(
        () => renewMutation({ variables: { input: { subscriptionId } } }),
        refetch,
        onSuccess,
        labels.success.renew,
        labels.genericError
      ),
    [renewMutation, refetch, onSuccess, labels]
  );

  const cancel = useCallback(
    (subscriptionId: string, reason: string | null): Promise<string | null> =>
      runLifecycleMutation(
        () => cancelMutation({ variables: { input: { subscriptionId, reason } } }),
        refetch,
        onSuccess,
        labels.success.cancel,
        labels.genericError
      ),
    [cancelMutation, refetch, onSuccess, labels]
  );

  const changePlan = useCallback(
    async (subscriptionId: string, newPlanId: string): Promise<string | null> => {
      try {
        const result = await planChangeMutation({ variables: { input: { subscriptionId, newPlanId } } });
        refetch();
        const payload = result.data?.adminChangeSubscriptionPlan;
        if (payload) {
          onSuccess(planChangeToast(payload, labels));
        }
        return null;
      } catch (error: unknown) {
        return extractErrorMessage(error) ?? labels.genericError;
      }
    },
    [planChangeMutation, refetch, onSuccess, labels]
  );

  return {
    extend,
    renew,
    cancel,
    changePlan,
    loading: { extend: extendLoading, renew: renewLoading, cancel: cancelLoading, changePlan: planChangeLoading },
  };
}
