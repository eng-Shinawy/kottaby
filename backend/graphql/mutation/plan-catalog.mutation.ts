/**
 * Plan catalog mutations — `createPlan`, `updatePlan`, `setPlanActiveStatus`.
 *
 * Security:
 *  - All plan management mutations declare the EXPLICIT `$all` conjunction
 *    `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
 *    The `$all` key is load-bearing: a plain `{ authenticated, role }` map
 *    combines its keys with ANY semantics, and a bare role map answers
 *    anonymous callers with FORBIDDEN. The conjunction makes the combine
 *    AND — the `authenticated` leg denies anonymous callers with
 *    UNAUTHORIZED (401) before the role leg is ever consulted, and the
 *    role leg denies authenticated non-admins with FORBIDDEN (403).
 *  - Forward-only lifecycle guarantee (INV-PC3): NO deletePlan/removePlan mutation exists.
 *  - `actorId` is sourced EXCLUSIVELY from `ctx.user.id` (never from args —
 *    BOLA-safe by construction) and threaded into the service, which
 *    re-asserts the admin role from the user row (defense in depth) and
 *    appends the audit row inside the mutation's transaction.
 */

import { UserRole } from "@/backend/enum";
import { CreatePlanInput, PlanPothosObject, UpdatePlanInput } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { UnauthorizedError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

// Register `createPlan` mutation field
gqlSchemaBuilder.mutationField("createPlan", t =>
  t.field({
    type: PlanPothosObject,
    description: "Creates a new subscription plan in the catalog (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      input: t.arg({
        type: CreatePlanInput,
        required: true,
        description: "Input fields for the new subscription plan.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — the `$all` conjunction's `authenticated`
      // leg guarantees a verified user row at resolution time (anonymous
      // callers are denied with UNAUTHORIZED at the scope step). This
      // branch exists purely for TypeScript narrowing — the repo-wide
      // no-non-null-assertion rule forbids dereferencing the nullable
      // context directly; the thrown error mirrors the `authenticated`
      // scope's UnauthorizedError family and is unreachable in practice.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      return PlanCatalogService.createPlan(args.input, ctx.user.id, ctx.locale);
    },
  })
);

// Register `updatePlan` mutation field
gqlSchemaBuilder.mutationField("updatePlan", t =>
  t.field({
    type: PlanPothosObject,
    description: "Updates mutable fields on an existing subscription plan (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      id: t.arg.id({
        required: true,
        description: "ID of the subscription plan to update.",
      }),
      input: t.arg({
        type: UpdatePlanInput,
        required: true,
        description: "Updated fields for the subscription plan.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createPlan` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const planId = PlanCatalogService.coercePlanId(args.id, ctx.locale);
      return PlanCatalogService.updatePlan(
        planId,
        {
          ...(args.input.title !== null && args.input.title !== undefined && { title: args.input.title }),
          ...(args.input.sessionCount !== null &&
            args.input.sessionCount !== undefined && { sessionCount: args.input.sessionCount }),
          ...(args.input.price !== null && args.input.price !== undefined && { price: args.input.price }),
          ...(args.input.currency !== null && args.input.currency !== undefined && { currency: args.input.currency }),
          ...(args.input.intervalDays !== null &&
            args.input.intervalDays !== undefined && { intervalDays: args.input.intervalDays }),
          // null (explicit clear) is meaningful for the lane, so only an
          // absent field is dropped; the service validates the member itself.
          ...(args.input.balanceLane !== undefined && { balanceLane: args.input.balanceLane }),
        },
        ctx.user.id,
        ctx.locale
      );
    },
  })
);

// Register `setPlanActiveStatus` mutation field
gqlSchemaBuilder.mutationField("setPlanActiveStatus", t =>
  t.field({
    type: PlanPothosObject,
    description: "Activates or deactivates an existing subscription plan (Admin only).",
    authScopes: {
      $all: {
        authenticated: true,
        role: [UserRole.Admin],
      },
    },
    args: {
      id: t.arg.id({
        required: true,
        description: "ID of the subscription plan.",
      }),
      isActive: t.arg.boolean({
        required: true,
        description: "Target active state for the plan.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      // TypeScript narrowing only — see `createPlan` above.
      if (!ctx.user) {
        throw new UnauthorizedError("Authentication required.");
      }
      const planId = PlanCatalogService.coercePlanId(args.id, ctx.locale);
      return PlanCatalogService.setPlanActiveStatus(planId, args.isActive, ctx.user.id, ctx.locale);
    },
  })
);
