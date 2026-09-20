/**
 * Lesson curriculum queries — `planLessons`.
 *
 * Implements REQ-016, REQ-033, REQ-050, REQ-051.
 *
 * Scopes:
 *  - `planLessons`: authenticated callers (students/teachers/parents/admins)
 *    receive the curriculum lessons of a plan, ordered `id ASC` in the
 *    repository layer.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { LessonPothosObject } from "@/backend/graphql/pothos/classes/lesson.pothos";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { LessonService } from "@/backend/services/classes/lesson.service";

// Register `planLessons` query field
gqlSchemaBuilder.queryField("planLessons", t =>
  t.field({
    type: [LessonPothosObject],
    description: "Returns the curriculum lessons of a plan for authenticated users.",
    authScopes: {
      authenticated: true,
    },
    args: {
      planId: t.arg.id({
        required: true,
        description: "The id of the plan whose lessons are listed.",
      }),
    },
    resolve: async (_root, args, ctx) => {
      const coercedPlanId = PlanCatalogService.coercePlanId(args.planId, ctx.locale);
      return LessonService.listForPlan(coercedPlanId, ctx.locale);
    },
  })
);
