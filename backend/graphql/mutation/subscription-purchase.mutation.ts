/**
 * `purchaseSubscription` mutation — the student's plan purchase through
 * the provider-agnostic payment-gateway port.
 *
 * Contract:
 *  - `purchaseSubscription(input: PurchaseSubscriptionInput!):
 *    PurchaseSubscriptionPayload!` — student-only; the purchaser identity
 *    is server-bound from `ctx.user.id` (the input carries ONLY the plan
 *    selector — no purchaser id exists on the wire, BOLA-proof by
 *    construction).
 *  - The plan id arrives as a GraphQL `ID` and is coerced through the
 *    STRICT numeric parse (`PlanCatalogService.coercePlanId`) before it
 *    reaches the service — a malformed id is the canonical plan-not-found
 *    denial, never a silent mis-target.
 *  - The idempotency key is consumed EXACTLY as captured at the gateway
 *    (`ctx.idempotencyKey`, propagation-only): an absent header arrives as
 *    `null` and the service's own guard rejects it with the localized
 *    VALIDATION error, pre-DB. The key is never re-derived, never trimmed,
 *    and never consultable by any authorization decision.
 *  - DomainErrors (governance FORBIDDEN, missing-key VALIDATION, replay
 *    DUPLICATE_REQUEST conflict, the oracle-safe payment-not-found for a
 *    foreign key, plan/lane denials) propagate uncaught to the masking
 *    boundary — no try/catch here.
 *
 * authScopes: the explicit `$all { authenticated, role: [Student] }`
 * conjunction (the 401/403 split documented in
 * `query/billing/wallet.query.ts` — a plain scope map combines its keys
 * with ANY semantics): anonymous callers hit the `authenticated` leg's
 * UnauthorizedError (401 channel), while authenticated non-students
 * (parent, teacher, admin) fail the `role` leg into the canonical
 * localized ForbiddenError (403 channel).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired via side-effect barrels: `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import {
  PurchaseSubscriptionInput,
  PurchaseSubscriptionPayloadPothosObject,
} from "@/backend/graphql/pothos/billing/purchase-checkout.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { PlanCatalogService, SubscriptionPurchaseService } from "@/backend/services";

// Side-effect: register the `purchaseSubscription` mutation field.
gqlSchemaBuilder.mutationField("purchaseSubscription", t =>
  t.field({
    type: PurchaseSubscriptionPayloadPothosObject,
    args: {
      input: t.arg({ type: PurchaseSubscriptionInput, required: true }),
    },
    description:
      "Purchase a subscription plan for the caller: opens the gateway checkout session and commits the pending subscription + payment pair atomically (a failed purchase never burns its idempotency key). Replaying the same X-Idempotency-Key surfaces DUPLICATE_REQUEST. Returns the pending pair plus the checkout descriptor. Student-only.",
    // Explicit `$all` conjunction per the 401/403 split documented above.
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Student],
      },
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `query/billing/wallet.query.ts`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // The plan selector is the ONLY client-owned field: the wire `ID` is
      // coerced through the strict numeric parse and the purchaser identity
      // stays server-bound — never read from input.
      return SubscriptionPurchaseService.purchase(
        ctx.user.id,
        { planId: PlanCatalogService.coercePlanId(args.input.planId, ctx.locale) },
        // Propagation-only key, verbatim from the context capture. The
        // `?? null` leg is a TYPE-level accommodation only (the context
        // field is optional in the type so pre-existing fixtures stay
        // compile-clean; the factory always materializes it at runtime).
        ctx.idempotencyKey ?? null,
        ctx.locale
      );
    },
  })
);
