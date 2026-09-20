/**
 * Admin subscription-management mutations — `adminExtendSubscription` +
 * `adminRenewSubscription` + `adminCancelSubscription` +
 * `adminChangeSubscriptionPlan`.
 *
 * Contract:
 *  - `adminExtendSubscription(input: ExtendSubscriptionInput!):
 *    StudentSubscription!` — admin-only; the acting admin's identity is
 *    server-bound from `ctx.user.id` (never from args — BOLA-safe by
 *    construction) and the new window end is computed server-side from
 *    the row's stored `endDate` (the payload cannot dictate a target
 *    date).
 *  - `adminRenewSubscription(input: RenewSubscriptionInput!):
 *    StudentSubscription!` — admin-only; the expired-source selector is
 *    the only client material. The renewal's plan snapshot, window
 *    arithmetic, lane credit, and the server-constructed
 *    `subscription-admin:renew:<sourceId>` idempotency claim (minted
 *    under the reserved server-owned namespace the purchase boundary
 *    refuses to carry) are all derived server-side. A
 *    duplicate renew REPLAYS the first result through the claim's
 *    subscription pointer (no error, no second period, no second
 *    credit); a claim that cannot resolve to a same-owner row surfaces
 *    the localized already-renewed conflict.
 *  - `adminCancelSubscription(input: CancelSubscriptionInput!):
 *    StudentSubscription!` — admin-only; flips an `active` row to
 *    `cancelled` through the guarded single UPDATE while touching NO lane
 *    balance (balance-preserving by design — the wire payload carries only
 *    the selector and an optional free-text reason that the service trims
 *    and bounds before the audit trail). An already-applied cancel
 *    surfaces the localized idempotent conflict instead of a second write.
 *  - `adminChangeSubscriptionPlan(input: ChangeSubscriptionPlanInput!):
 *    ChangeSubscriptionPlanPayload!` — admin-only; moves an `active` row
 *    onto a different ACTIVE plan crediting the SAME balance lane with
 *    prorated settlement: the direction is derived server-side from the
 *    two plans' unit values (a unit-value tie breaks on session count),
 *    the `subscription-admin:planChange:<sourceId>:<targetPlanId>` claim
 *    makes a duplicate REPLAY the first result, and the payload reports
 *    the NEW row plus the
 *    applied carry/forfeit (zeros on a replay — the replayed call moved
 *    nothing). Cross-lane targets, inactive targets, same-plan targets,
 *    and non-active sources all surface localized conflicts.
 *  - The subscription id arrives as a wire `ID` and is coerced to the
 *    numeric row key through the strict numeric parse
 *    (`coerceSubscriptionId`) before it reaches the service — a
 *    malformed id is the canonical subscription-not-found denial, never
 *    a silent mis-target. The wire input is copied FIELD-BY-FIELD into
 *    the service's closed submit whitelist — never a `{ ...input }`
 *    spread.
 *  - The audit row shares the service transaction's commit/rollback
 *    fate; DomainErrors (FORBIDDEN non-admin, VALIDATION day-count/
 *    ceiling, CONFLICT not-active/replay) propagate uncaught to the
 *    masking boundary — no try/catch here.
 *
 * authScopes (the MANDATORY `$all` conjunction, written INLINE on every
 * field — the static admin-mutation census scanner resolves literal gates
 * only, never a shared constant):
 *  - `{ $all: { authenticated: true, role: [UserRole.Admin] } }` — the same
 *    conjunction the shared admin prelude centralizes for surfaces outside
 *    the census corpus. Anonymous → `UNAUTHORIZED` (401); authenticated
 *    non-admin → `FORBIDDEN` (403) — both BEFORE the resolver body runs.
 *    `requireAdminUser(ctx)` is the TypeScript-narrowing belt only.
 *
 * Per `backend/graphql/mutation/AGENTS.md`:
 *  - NO named exports — the root field registers at import time via
 *    `gqlSchemaBuilder.mutationField(...)`.
 *  - Wired through side-effect barrels:
 *    `mutation/billing/index.ts` → `mutation/index.ts` → `gqlSchema.ts`.
 *  - Resolver delegates to the services layer with locale propagation;
 *    no business logic inline. Top-level static imports only.
 */

import { UserRole } from "@/backend/enum/users/user-role.enum";
import { SubscriptionPothosObject } from "@/backend/graphql/pothos/billing/subscription.pothos";
import {
  CancelSubscriptionInput,
  ChangeSubscriptionPlanInput,
  ChangeSubscriptionPlanPayload,
  ExtendSubscriptionInput,
  RenewSubscriptionInput,
} from "@/backend/graphql/pothos/billing/subscription-admin.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { requireAdminUser } from "@/backend/graphql/shared";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { coerceSubscriptionId } from "@/backend/services/billing/subscription-admin.helpers";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";

// Side-effect: register the `adminExtendSubscription` mutation field.
gqlSchemaBuilder.mutationField("adminExtendSubscription", t =>
  t.field({
    type: SubscriptionPothosObject,
    description:
      "Extends an active subscription's validity window by a whole number of days. Admin-only; the new window end is derived server-side from the row's current end date.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: ExtendSubscriptionInput,
        required: true,
        description: "The subscription selector and the day count to add.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const tErrors = await ctx.t("errorsTranslations");
      return SubscriptionAdminService.extendSubscription(
        {
          subscriptionId: coerceSubscriptionId(args.input.subscriptionId, tErrors),
          days: args.input.days,
        },
        user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminRenewSubscription` mutation field.
gqlSchemaBuilder.mutationField("adminRenewSubscription", t =>
  t.field({
    type: SubscriptionPothosObject,
    description:
      "Renews an expired subscription into a fresh active period: a new row (same owner, fresh plan snapshot), the owner's lane credited the plan's full session count, and the student junction row. Admin-only; a duplicate renew replays the first result.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: RenewSubscriptionInput,
        required: true,
        description: "The expired subscription selector.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const tErrors = await ctx.t("errorsTranslations");
      return SubscriptionAdminService.renewSubscription(
        { subscriptionId: coerceSubscriptionId(args.input.subscriptionId, tErrors) },
        user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminCancelSubscription` mutation field.
gqlSchemaBuilder.mutationField("adminCancelSubscription", t =>
  t.field({
    type: SubscriptionPothosObject,
    description:
      "Cancels an active subscription while preserving its balance lanes untouched. Admin-only; a replay of an already-applied cancel surfaces an idempotent conflict instead of a second write.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: CancelSubscriptionInput,
        required: true,
        description: "The active subscription selector and an optional bounded reason.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const tErrors = await ctx.t("errorsTranslations");
      return SubscriptionAdminService.cancelSubscription(
        {
          subscriptionId: coerceSubscriptionId(args.input.subscriptionId, tErrors),
          reason: args.input.reason ?? undefined,
        },
        user.id,
        ctx.locale
      );
    },
  })
);

// Side-effect: register the `adminChangeSubscriptionPlan` mutation field.
gqlSchemaBuilder.mutationField("adminChangeSubscriptionPlan", t =>
  t.field({
    type: ChangeSubscriptionPlanPayload,
    description:
      "Changes an active subscription onto a different active plan in the same balance lane with prorated settlement: the old row is cancelled, the owner's lane is settled to the prepared exact total (target plan's session count plus the computed carry on upgrades; the remainder forfeited on downgrades), and a fresh period opens on the target plan. Admin-only; a duplicate change replays the first result.",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: ChangeSubscriptionPlanInput,
        required: true,
        description: "The active subscription selector and the target plan id.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const user = await requireAdminUser(ctx);
      const tErrors = await ctx.t("errorsTranslations");
      return SubscriptionAdminService.changeSubscriptionPlan(
        {
          subscriptionId: coerceSubscriptionId(args.input.subscriptionId, tErrors),
          newPlanId: PlanCatalogService.coercePlanId(args.input.newPlanId, ctx.locale),
        },
        user.id,
        ctx.locale
      );
    },
  })
);
