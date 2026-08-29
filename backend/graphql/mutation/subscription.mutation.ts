/**
 * Subscription mutations — `requestPlanSubscription` (DEV1-006 Phase A:
 * the storefront's real subscribe action, offline-payment groundwork).
 *
 * Contract:
 *  - Role-gated to Student / Parent / Teacher via the EXPLICIT `$all`
 *    conjunction `authScopes: { $all: { authenticated: true, role:
 *    [UserRole.Student, UserRole.Parent, UserRole.Teacher] } }`. A plain
 *    scope map is WRONG in this engine: Pothos combines the keys of ONE
 *    scope map with ANY semantics under the default `any` strategy. The
 *    `$all` conjunction makes anonymous callers hit the `authenticated`
 *    scope's UnauthorizedError throw (extensions.code UNAUTHORIZED / 401,
 *    passed through VERBATIM by builder.ts's `unauthorizedError` mapping)
 *    while authenticated non-members (admins) fail the `role` scope into
 *    the canonical localized ForbiddenError (FORBIDDEN / 403). Pattern
 *    precedent: backend/graphql/mutation/plan-catalog.mutation.ts.
 *  - Thin resolver: the `if (!ctx.user)` guard exists purely for
 *    TypeScript narrowing (repo-wide no-non-null-assertion rule) — `$all {
 *    authenticated: true }` already guarantees a verified user row; the
 *    thrown message mirrors builder.ts's own `authenticated` scope
 *    verbatim and is unreachable in practice. Delegates to
 *    `SubscriptionService.requestPlanSubscription` with locale
 *    propagation — zero business logic, zero repository imports, no
 *    try/catch (DomainErrors propagate uncaught to the masking boundary;
 *    `docs/graphql/domain-error-extensions-code.md`).
 *  - `Subscription!` non-null return backed by the canonical
 *    `SubscriptionPothosObject`. The service returns the created row with
 *    the D2-locked plan EMBEDDED (`SubscriptionWithPlan`) — the wire
 *    payload is the canonical `Subscription` shape (status pending, plan
 *    populated) in ONE transaction, no resolver-side refetch; Apollo
 *    normalizes `Subscription:<id>` with `plan` immediately.
 *  - `planId` rides the GraphQL `ID` scalar and arrives as a string; the
 *    resolver converts with `Number(args.planId)` and hands the service a
 *    number (the service rejects non-positive integers with the localized
 *    plan-not-found validation error).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`; wired through the side-effect
 *    barrel `backend/graphql/mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SubscriptionService } from "@/backend/services";

/** The storefront's subscriber roles (admins manage the catalog, never subscribe). */
const SUBSCRIBER_ROLES = [UserRole.Student, UserRole.Parent, UserRole.Teacher];

// Side-effect: register the `requestPlanSubscription` mutation field.
gqlSchemaBuilder.mutationField("requestPlanSubscription", t =>
  t.field({
    type: SubscriptionPothosObject,
    args: {
      planId: t.arg.id({ required: true }),
    },
    // Explicit `$all` conjunction — see the file header for the ANY-vs-ALL
    // engine semantics (a plain scope map would admit any authenticated caller).
    authScopes: {
      $all: {
        authenticated: true,
        role: SUBSCRIBER_ROLES,
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string — the service validates positive-integer
      // semantics and rejects anything else with the localized not-found
      // validation error. userId comes from the VERIFIED session context —
      // a caller can never request on behalf of another user. The returned
      // projection embeds the D2-locked plan row (canonical wire shape).
      return SubscriptionService.requestPlanSubscription(ctx.user.id, Number(args.planId), ctx.locale);
    },
  })
);
