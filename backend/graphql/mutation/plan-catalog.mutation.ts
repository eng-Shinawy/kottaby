/**
 * Plan catalog mutations — `createPlan`, `updatePlan`, `setPlanActiveStatus`.
 *
 * Implements REQ-011, REQ-013, REQ-014, REQ-015, REQ-020, REQ-030, REQ-031, REQ-050, REQ-060.
 *
 * Security:
 *  - All plan management mutations require `{ authenticated: true, role: [UserRole.Admin] }`.
 *  - Forward-only lifecycle guarantee (INV-PC3): NO deletePlan/removePlan mutation exists.
 */

import { UserRole } from "@/backend/enum";
import { CreatePlanInput, PlanPothosObject, UpdatePlanInput } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

// Register `createPlan` mutation field
gqlSchemaBuilder.mutationField("createPlan", t =>
  t.field({
    type: PlanPothosObject,
    description: "Creates a new subscription plan in the catalog (Admin only).",
    authScopes: {
      role: [UserRole.Admin],
    },
    args: {
      input: t.arg({
        type: CreatePlanInput,
        required: true,
        description: "Input fields for the new subscription plan.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      return PlanCatalogService.createPlan(args.input, ctx.locale);
    },
  })
);

// Register `updatePlan` mutation field
gqlSchemaBuilder.mutationField("updatePlan", t =>
  t.field({
    type: PlanPothosObject,
    description: "Updates mutable fields on an existing subscription plan (Admin only).",
    authScopes: {
      role: [UserRole.Admin],
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
        },
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
      role: [UserRole.Admin],
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
      const planId = PlanCatalogService.coercePlanId(args.id, ctx.locale);
      return PlanCatalogService.setPlanActiveStatus(planId, args.isActive, ctx.locale);
    },
  })
);
