"use client";

import { useMutation } from "@apollo/client/react";
import { useRef } from "react";
import type { PurchaseSubscriptionPlanMutation_purchaseSubscription } from "@/frontend/graphql/generated/gql/graphql";
import { purchaseSubscriptionMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { randomUUID } from "@/frontend/views/student/plans/purchaseHelpers";

/**
 * usePurchaseSubscription — the checkout-initiation flow behind the
 * purchase confirm dialog, extracted from `PlansCatalogContainer` (the
 * flat view-file convention).
 *
 * Owns the `useMutation(purchaseSubscriptionMutationDocument)` wiring
 * carrying the purchase attempt's idempotency key via the Apollo context
 * header `x-idempotency-key` — the key is minted once per attempt into a
 * `useRef` and regenerated ONLY after a successful purchase (failed
 * submits and dialog cancels keep the same key so the server-side replay
 * dedupe stays effective), and it never rides the input DTO.
 *
 * The input whitelist carries exactly one client-owned field: the catalog
 * plan id (`input.planId`). Amount, currency, and billing data derive
 * server-side from the plan row — nothing else leaves the client.
 *
 * Outcome routing (`PlanPurchaseOutcome`):
 *  - `redirected` — the gateway returned a hosted `checkoutUrl`; the browser
 *    navigates via `globalThis.window.location.href` (the
 *    auth-recovery hard-redirect idiom — an external host, so the SPA
 *    router is not involved). The URL is validated `https:` before
 *    assignment — a compromised config or provider regression must never
 *    navigate the student off-protocol (violations resolve `failed`).
 *  - `completed` — the provider activated instantly with NO hosted
 *    checkout (`checkoutUrl: null`, the built-in mock among them); the
 *    caller shows the activated-state notice and keeps the dialog closed.
 *  - `failed` — a transport-shaped rejection; the caller surfaces the
 *    mapped copy and reopens the dialog for a retry (same key).
 */

/** The purchase attempt's terminal outcome, resolved for the container. */
type PlanPurchaseOutcome = "redirected" | "completed" | "failed";

/** The purchase flow's surface consumed by the catalog container. */
export interface PurchaseSubscription {
  readonly purchasing: boolean;
  readonly handleConfirmPurchase: (planId: string) => Promise<PlanPurchaseOutcome>;
}

export function usePurchaseSubscription(): PurchaseSubscription {
  const purchaseKeyRef = useRef(randomUUID());
  const [purchaseMutation, { loading: purchasing }] = useMutation(purchaseSubscriptionMutationDocument);

  const handleConfirmPurchase = async (planId: string): Promise<PlanPurchaseOutcome> => {
    if (purchasing) {
      return "failed";
    }
    try {
      const result = await purchaseMutation({
        variables: { input: { planId } },
        context: { headers: { "x-idempotency-key": purchaseKeyRef.current } },
      });
      const payload: PurchaseSubscriptionPlanMutation_purchaseSubscription | null | undefined =
        result.data?.purchaseSubscription;
      if (!payload) {
        return "failed";
      }
      // Rotation happens ONLY on success — failed submits keep the same
      // attempt key so the server-side replay dedupe stays effective.
      purchaseKeyRef.current = randomUUID();
      if (payload.checkout.checkoutUrl !== null) {
        // Defense-in-depth: the URL is server-derived, but a compromised
        // config or provider regression must never navigate the browser
        // off-protocol (an invalid URL throws here → the failed arm).
        const target = new URL(payload.checkout.checkoutUrl);
        if (target.protocol !== "https:") {
          return "failed";
        }
        globalThis.window.location.href = target.href;
        return "redirected";
      }
      return "completed";
    } catch {
      return "failed";
    }
  };

  return { purchasing, handleConfirmPurchase };
}
