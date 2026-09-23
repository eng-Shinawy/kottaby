/**
 * useVerificationPurchase — the verification-plan purchase write path,
 * extracted verbatim from `VerificationPurchaseDialog` (the max-lines split,
 * mirroring the `useTeacherWalletWithdraw` precedent).
 *
 * Owns the plan-descriptor resolution, the per-attempt idempotency-key
 * lifecycle, and the outcome lanes of the purchase confirm gate:
 *
 * - The plan descriptor comes from the `planCatalog` query, title-matched on
 *   the shared `VERIFICATION_PLAN_TITLE` resolution constant (the SAME key
 *   the server resolves purchases by).
 * - Confirm executes the inputless `purchaseVerificationPlan` mutation
 *   carrying the per-attempt `x-idempotency-key` context header: the key is
 *   minted per dialog mount, KEPT across domain rejections so the
 *   server-side replay dedupe stays effective, and rotated after a
 *   successful purchase OR a duplicate-replay settle (a spent key must
 *   never ride a later attempt).
 * - Outcome lanes (`extensions.code` branch, localized copy only):
 *   success → profile refetch + success notice + close request;
 *   `APPLICANT_COOLDOWN_ACTIVE` → the server-localized cooldown copy (the
 *   ONE code whose server message may surface — it is built from the same
 *   shared locale catalog) + profile refetch + close request;
 *   `DUPLICATE_REQUEST` → the calm info lane (the request already landed
 *   server-side) + key rotation + profile refetch + close request — the
 *   spent key never rides a reopen, and the card re-renders the truthful
 *   lifecycle state;
 *   everything else → the generic localized failure notice and NO close
 *   request, so the retry replays the SAME kept idempotency key in place.
 * - The mock gateway settles with `checkout.checkoutUrl === null`, so no
 *   redirect is ever attempted (hosted-checkout redirects land with the
 *   real gateway integration).
 *
 * Apollo hooks come from `@apollo/client/react` (stateful `useQuery`,
 * never `useLazyQuery`); every user-facing string resolves through the
 * compile-time `Applicant` namespace handle (property access only).
 */

import { useMutation, useQuery } from "@apollo/client/react";
import { useRef, useState } from "react";
import type { PlanCatalogQuery_planCatalog } from "@/frontend/graphql/generated/gql/graphql";
import { planCatalogQueryDocument, purchaseVerificationPlanMutationDocument } from "@/frontend/graphql/sharedDocuments";
import { extractErrorCode, extractErrorMessage } from "@/frontend/lib/graphql-error-utils";
import { VERIFICATION_PLAN_TITLE } from "@/shared/constants";
import { Applicant, useAppTranslation } from "@/shared/locale";

/** The snackbar notice record rendered through the shared transient notice slot. */
type PurchaseNotice = { readonly message: string; readonly severity: "success" | "info" | "error" };

/** ICU placeholder tokens of `purchasePlanLine`, in the parity-pinned expansion order. */
const PLAN_LINE_TITLE = "{title}";
const PLAN_LINE_PRICE = "{price}";
const PLAN_LINE_CURRENCY = "{currency}";
const PLAN_LINE_SESSIONS = "{sessions}";
const PLAN_LINE_DAYS = "{days}";

/**
 * Expands the localized `purchasePlanLine` template with the title-matched
 * planCatalog row. Placeholders are pinned to occur exactly once per locale
 * (`applicant-namespace.parity.test.ts`), so first-occurrence replacement
 * is total.
 */
export function expandPurchasePlanLine(template: string, plan: PlanCatalogQuery_planCatalog): string {
  return template
    .replace(PLAN_LINE_TITLE, plan.title)
    .replace(PLAN_LINE_PRICE, plan.price)
    .replace(PLAN_LINE_CURRENCY, plan.currency)
    .replace(PLAN_LINE_SESSIONS, String(plan.sessionCount))
    .replace(PLAN_LINE_DAYS, String(plan.intervalDays));
}

/** Resolves the canonical verification plan from the ACTIVE catalog snapshot. */
function findVerificationPlan(
  plans: readonly PlanCatalogQuery_planCatalog[] | undefined
): PlanCatalogQuery_planCatalog | null {
  return plans?.find(plan => plan.title === VERIFICATION_PLAN_TITLE) ?? null;
}

/** Wiring the purchase write path needs from the dialog. */
export interface VerificationPurchaseWiring {
  /** Whether the confirmation dialog is open (gates the catalog fetch). */
  readonly open: boolean;
  /** Dismisses the dialog (settled outcomes + the dialog's close affordances). */
  readonly onClose: () => void;
  /**
   * Refetches the applicant profile query handle after the outcomes that
   * change the lifecycle row server-side (success + the cooldown rejection).
   */
  readonly refetchProfile: () => Promise<unknown>;
}

/** The dialog-facing purchase state + confirm intent. */
export interface VerificationPurchase {
  /** `true` while the ACTIVE catalog snapshot is in flight. */
  readonly catalogLoading: boolean;
  /** The title-matched verification plan row, or `null` when absent. */
  readonly verificationPlan: PlanCatalogQuery_planCatalog | null;
  /** `true` while the purchase mutation is in flight. */
  readonly purchasing: boolean;
  /** The transient purchase notice (null = idle; survives the dialog close). */
  readonly notice: PurchaseNotice | null;
  /** Confirms the purchase — the outcome lanes run inside. */
  readonly confirmPurchase: () => Promise<void>;
  /** Dismisses the transient notice. */
  readonly dismissNotice: () => void;
}

/** The purchase write path — see the module docblock. */
export function useVerificationPurchase(wiring: VerificationPurchaseWiring): VerificationPurchase {
  const t = useAppTranslation(Applicant);
  const { open, onClose, refetchProfile } = wiring;
  const [notice, setNotice] = useState<PurchaseNotice | null>(null);
  // Per-attempt idempotency key — minted once per dialog mount; rotated ONLY
  // on success so failed attempts keep replaying the same claim server-side.
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());

  // The ACTIVE plan catalog feeds the plan descriptor; fetched when the
  // dialog opens (the surface is reachable only from the dashboard CTA).
  const { data: catalogData, loading: catalogLoading } = useQuery(planCatalogQueryDocument, { skip: !open });
  const [purchaseVerificationPlan, { loading: purchasing }] = useMutation(purchaseVerificationPlanMutationDocument);

  const verificationPlan = findVerificationPlan(catalogData?.planCatalog);

  const confirmPurchase = async (): Promise<void> => {
    if (verificationPlan === null || purchasing) {
      return;
    }
    try {
      const result = await purchaseVerificationPlan({
        context: { headers: { "x-idempotency-key": idempotencyKeyRef.current } },
      });
      const payload = result.data?.purchaseVerificationPlan;
      if (!payload) {
        // Transport-masked settle without data — the same retryable generic
        // lane as the catch arm below (DomainError denials throw and never
        // reach this point). The dialog stays open.
        setNotice({ message: t.purchaseGenericError, severity: "error" });
        return;
      }
      // Success — rotate the key so the NEXT attempt mints a fresh claim.
      idempotencyKeyRef.current = crypto.randomUUID();
      // The lifecycle flip already committed server-side; the profile
      // refetch re-renders the status card into its new branch. A refetch
      // failure folds silently — it must not mask the success notice.
      await refetchProfile().catch(() => undefined);
      setNotice({ message: t.purchaseSuccess, severity: "success" });
      onClose();
      // The mock gateway settles without a hosted checkout
      // (`checkout.checkoutUrl === null`) — no redirect is attempted here;
      // hosted-checkout redirects land with the real gateway integration.
    } catch (mutationError: unknown) {
      const code = extractErrorCode(mutationError);
      if (code === "APPLICANT_COOLDOWN_ACTIVE") {
        // The cooldown copy is server-localized (the one code whose raw
        // message may surface) and the server just (re)armed the cooldown —
        // refetch so the status card renders the truthful waiting state.
        await refetchProfile().catch(() => undefined);
        setNotice({ message: extractErrorMessage(mutationError) ?? t.purchaseGenericError, severity: "error" });
        onClose();
        return;
      }
      if (code === "DUPLICATE_REQUEST") {
        // Same-key replay: the first request already landed server-side —
        // surface it as already-received (calm info lane). The spent key is
        // ROTATED so a reopen can never ride it again, and the profile
        // refetch re-renders the card's truthful lifecycle state (a
        // refetch failure folds silently — it must not mask the notice).
        idempotencyKeyRef.current = crypto.randomUUID();
        await refetchProfile().catch(() => undefined);
        setNotice({ message: t.purchaseSuccess, severity: "info" });
        onClose();
        return;
      }
      // Every other code (transport, PLAN_NOT_FOUND, UNAUTHORIZED, …) lands
      // on the generic lane. The dialog STAYS OPEN — the retryable-in-place
      // posture — so a second confirm replays the SAME kept key (the failed
      // attempt committed no claim server-side; the tx rolled back).
      setNotice({ message: t.purchaseGenericError, severity: "error" });
    }
  };

  const dismissNotice = (): void => {
    setNotice(null);
  };

  return { catalogLoading, verificationPlan, purchasing, notice, confirmPurchase, dismissNotice };
}
