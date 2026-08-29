/**
 * Subscription mutations — DEV1-006:
 *  - `requestPlanSubscription` (Phase A): the storefront's real subscribe
 *    action, offline-payment groundwork.
 *  - `verifySubscriptionPayment` (Phase B): the admin payment-verification
 *    transition (`pending → active` + offline-payment columns stamped).
 * DEV1-009:
 *  - `adminCancelSubscription`: the admin cancel transition
 *    (`active|pending → cancelled`, terminal states fence, in-transaction
 *    audit row) — returns the `AdminSubscription` lifecycle object.
 *
 * Contract (both fields):
 *  - Role-gated via the EXPLICIT `$all` conjunction `authScopes: { $all:
 *    { authenticated: true, role: [...] } }`. A plain scope map is WRONG in
 *    this engine: Pothos combines the keys of ONE scope map with ANY
 *    semantics under the default `any` strategy. The `$all` conjunction
 *    makes anonymous callers hit the `authenticated` scope's
 *    UnauthorizedError throw (extensions.code UNAUTHORIZED / 401, passed
 *    through VERBATIM by builder.ts's `unauthorizedError` mapping) while
 *    authenticated non-members fail the `role` scope into the canonical
 *    localized ForbiddenError (FORBIDDEN / 403). Pattern precedent:
 *    backend/graphql/mutation/plan-catalog.mutation.ts.
 *  - Thin resolvers: the `if (!ctx.user)` guard exists purely for
 *    TypeScript narrowing (repo-wide no-non-null-assertion rule) — `$all {
 *    authenticated: true }` already guarantees a verified user row; the
 *    thrown message mirrors builder.ts's own `authenticated` scope
 *    verbatim and is unreachable in practice. Delegates to
 *    `SubscriptionService` with locale propagation — zero business logic,
 *    zero repository imports, no try/catch (DomainErrors propagate
 *    uncaught to the masking boundary;
 *    `docs/graphql/domain-error-extensions-code.md`).
 *  - `requestPlanSubscription` returns `Subscription!` non-null backed by
 *    the canonical `SubscriptionPothosObject`. The service returns the
 *    created row with the D2-locked plan EMBEDDED (`SubscriptionWithPlan`)
 *    — the wire payload is the canonical `Subscription` shape (status
 *    pending, plan populated) in ONE transaction, no resolver-side refetch;
 *    Apollo normalizes `Subscription:<id>` with `plan` immediately.
 *  - `verifySubscriptionPayment` returns the SAME canonical
 *    `SubscriptionPothosObject` — the ACTIVATED row with its plan embedded,
 *    so Apollo overwrites `Subscription:<id>` with status active + stamped
 *    payment columns the moment the mutation settles. `paymentMethod`
 *    arrives as a plain `String` and is narrowed service-side to the
 *    offline set (localized validation error on anything else);
 *    `paymentReference` is trimmed and length-checked service-side.
 *  - `adminCancelSubscription` (DEV1-009) returns the
 *    `AdminSubscriptionPothosObject` — the cancelled row with its plan AND
 *    the narrow purchaser summary embedded. Only `active`/`pending` rows
 *    are cancellable: expired/cancelled/suspended are terminal and reject
 *    with the localized already-resolved conflict; a lost guarded-write
 *    race resolves to the same conflict (exactly one transition wins).
 *    Cancelling refunds/credits NOTHING (DEV1-007 owns balances).
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root fields register at import time via
 *    `gqlSchemaBuilder.mutationField(...)`; wired through the side-effect
 *    barrel `backend/graphql/mutation/index.ts` → `gqlSchema.ts`.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { AdminSubscriptionPothosObject } from "@/backend/graphql/pothos/billing/admin-subscription.pothos";
import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { SubscriptionService } from "@/backend/services";

/** The storefront's subscriber roles (admins manage the catalog, never subscribe). */
const SUBSCRIBER_ROLES = [UserRole.Student, UserRole.Parent, UserRole.Teacher];

/** The verification transition's gate: admins only. */
const ADMIN_ROLE = [UserRole.Admin];

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

// Side-effect: register the `verifySubscriptionPayment` mutation field
// (DEV1-006 Phase B — the admin payment-verification transition).
gqlSchemaBuilder.mutationField("verifySubscriptionPayment", t =>
  t.field({
    type: SubscriptionPothosObject,
    args: {
      subscriptionId: t.arg.id({ required: true }),
      paymentMethod: t.arg.string({ required: true }),
      paymentReference: t.arg.string({ required: true }),
    },
    // Explicit `$all` conjunction — admins only (see the file header).
    authScopes: {
      $all: {
        authenticated: true,
        role: ADMIN_ROLE,
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string — the service validates positive-integer
      // semantics (localized not-found validation error otherwise). The
      // payment method + reference are narrowed/trimmed service-side; the
      // verifier's identity is the VERIFIED session context (audit seam
      // only — it can never ride a caller-supplied argument).
      return SubscriptionService.verifySubscriptionPayment(
        {
          subscriptionId: Number(args.subscriptionId),
          paymentMethod: args.paymentMethod,
          paymentReference: args.paymentReference,
          verifiedBy: ctx.user.id,
        },
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminCancelSubscription` mutation field
// (DEV1-009 — the admin cancel transition: active|pending → cancelled).
gqlSchemaBuilder.mutationField("adminCancelSubscription", t =>
  t.field({
    type: AdminSubscriptionPothosObject,
    args: {
      subscriptionId: t.arg.id({ required: true }),
    },
    // Explicit `$all` conjunction — admins only (see the file header).
    authScopes: {
      $all: {
        authenticated: true,
        role: ADMIN_ROLE,
      },
    },
    resolve: async (_root, args, ctx) => {
      // TS narrowing only — unreachable behind `$all { authenticated: true }`.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      // `ID` arrives as a string — the service validates positive-integer
      // semantics and fences terminal states + lost races with the
      // localized already-resolved conflict. The canceller's identity is
      // the VERIFIED session context (audit seam only — it can never ride
      // a caller-supplied argument).
      return SubscriptionService.cancelSubscription(
        { subscriptionId: Number(args.subscriptionId), cancelledBy: ctx.user.id },
        ctx.locale
      );
    },
  })
);
