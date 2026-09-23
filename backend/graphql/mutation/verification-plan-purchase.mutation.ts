/**
 * `purchaseVerificationPlan` mutation — the teacher applicant's purchase of
 * the verification plan through the shared payment spine (the same
 * subscription/payment/idempotency pipeline the student purchase runs).
 *
 * Contract:
 *  - `purchaseVerificationPlan: PurchaseSubscriptionPayload!` — INPUTLESS:
 *    the wire carries zero client-owned fields (no plan selector, no
 *    purchaser id, no money value — BOLA/BOPLA-proof by construction). The
 *    purchaser identity is server-bound from `ctx.user.id` and the plan is
 *    resolved server-side from the ACTIVE catalog, so a payload structurally
 *    cannot carry a target or an amount.
 *  - The idempotency key is consumed EXACTLY as captured at the gateway
 *    (`ctx.idempotencyKey`, propagation-only): an absent header arrives as
 *    `null` and the service's own guard rejects it with the localized
 *    VALIDATION error, pre-DB. The key is never re-derived, never trimmed,
 *    and never consultable by any authorization decision.
 *  - DomainErrors (anonymous UNAUTHORIZED, the service-level applicant gate
 *    APPLICANT_NOT_FOUND / APPLICANT_COOLDOWN_ACTIVE /
 *    APPLICANT_ALREADY_CERTIFIED, missing-key VALIDATION, replay
 *    DUPLICATE_REQUEST conflict, the oracle-safe payment-not-found for a
 *    foreign key, plan denials) propagate uncaught to the masking boundary —
 *    no try/catch here.
 *
 * authScopes: `authenticated` only. The applicant eligibility predicate
 * (an `applicants` row in a purchasable state, cooldown rules included)
 * lives at the SERVICE level inside the purchase transaction — declaring a
 * role scope here would split one gate across two layers and lock out the
 * surface for legitimate applicant roles that carry no dedicated role check
 * (scope-composition rule in `backend/graphql/AGENTS.md`).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { PurchaseSubscriptionPayloadPothosObject } from "@/backend/graphql/pothos/billing/purchase-checkout.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { VerificationPurchaseService } from "@/backend/services";

// Side-effect: register the `purchaseVerificationPlan` mutation field.
gqlSchemaBuilder.mutationField("purchaseVerificationPlan", t =>
  t.field({
    type: PurchaseSubscriptionPayloadPothosObject,
    description: "Purchase the teacher verification plan; identity from the session, plan resolved server-side.",
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, _args, ctx) => {
      // TypeScript narrowing only — see `query/billing/wallet.query.ts`.
      // The `authenticated` scope rejects this state first; the fallback
      // still carries the canonical LOCALIZED unauthorized copy (the
      // resolver localization contract — never a hardcoded string).
      if (!ctx.user) {
        const tErrors = await ctx.t("errorsTranslations");
        throw new UnauthorizedError(tErrors.unauthorized);
      }
      // No input argument exists: the identity is `ctx.user.id`, the plan is
      // resolved server-side, and the idempotency key rides the
      // propagation-only context capture verbatim. The `?? null` leg is a
      // TYPE-level accommodation only (the context field is optional in the
      // type so pre-existing fixtures stay compile-clean; the factory always
      // materializes it at runtime).
      return VerificationPurchaseService.purchase(ctx.user.id, ctx.idempotencyKey ?? null, ctx.locale);
    },
  })
);
