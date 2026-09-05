/**
 * Plan catalog queries — `planCatalog` and `adminPlans`.
 *
 * Implements REQ-016, REQ-030, REQ-033, REQ-034, REQ-060.
 *
 * Scopes:
 *  - `planCatalog`: authenticated callers (students/teachers/parents/admins)
 *    receive active plans catalog.
 *  - `adminPlans`: admin-only query with `includeInactive` option.
 */

import { UserRole } from "@/backend/enum";
import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";

// Register `planCatalog` query field
gqlSchemaBuilder.queryField("planCatalog", t =>
  t.field({
    type: [PlanPothosObject],
    description: "Returns the active subscription plans catalog for authenticated users.",
    authScopes: {
      authenticated: true,
    },
    resolve: async (_root, _args, ctx) => {
      return PlanCatalogService.listActiveCatalog(ctx.locale);
    },
  })
);

// Register `adminPlans` query field
gqlSchemaBuilder.queryField("adminPlans", t =>
  t.field({
    type: [PlanPothosObject],
    description: "Admin-only query to list plans, optionally including inactive plans.",
    authScopes: {
      role: [UserRole.Admin],
    },
    args: {
      includeInactive: t.arg.boolean({
        required: false,
        defaultValue: true,
        description: "Whether to include deactivated plans in the returned list.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      return PlanCatalogService.listForAdmin({ includeInactive: args.includeInactive ?? true }, ctx.locale);
    },
  })
);
