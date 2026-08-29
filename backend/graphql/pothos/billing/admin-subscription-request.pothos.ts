/**
 * AdminSubscriptionRequestPothosObject — the ADMIN verification-queue wire
 * contract (DEV1-006 Phase B).
 *
 * Two objects, one file — both back service-layer projections exclusively
 * (Single Canonical Object Type Pattern, `backend/graphql/AGENTS.md`):
 *  - `AdminSubscriptionUser` ← `SubscriptionUserSummary` (the narrow
 *    purchaser summary: id / fullName / email — NEVER the full `users`
 *    row; the queue identifies WHO paid, it is not a user directory).
 *  - `AdminSubscriptionRequest` ← `SubscriptionWithPlanAndUser` (the
 *    repository's INNER-JOIN projection: subscription + plan + purchaser).
 *
 * Least-privilege posture vs the canonical `Subscription` object: the admin
 * queue exposes NO payment columns (they are guaranteed NULL on a pending
 * row — the verification dialog COLLECTS them, it does not display them)
 * and NO lifecycle dates (same guarantee). It ADDS the purchaser summary
 * the owner-scoped `Subscription` shape deliberately omits — the admin
 * needs to know who to contact; the storefront does not.
 *
 * Field map (`AdminSubscriptionRequest`):
 *      id        → `ID!` (numeric PK behind the ID scalar)
 *      status    → `String!` (always 'pending' in practice — the read
 *        filters on it; exposed for belt-and-suspenders client hygiene)
 *      plan      → `Plan!` (the canonical `PlanPothosObject`)
 *      user      → `AdminSubscriptionUser!`
 *      createdAt / updatedAt → non-nullable `DateTime`
 */

import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import type { SubscriptionWithPlanAndUser } from "@/backend/services/billing/subscription.service";

/** The narrow purchaser summary embedded in the verification queue. */
export const AdminSubscriptionUserPothosObject = gqlSchemaBuilder
  .objectRef<SubscriptionWithPlanAndUser["user"]>("AdminSubscriptionUser")
  .implement({
    fields: t => ({
      // ID! — Apollo cache normalization (`AdminSubscriptionUser:<id>`).
      id: t.exposeID("id"),
      fullName: t.exposeString("fullName"),
      email: t.exposeString("email"),
    }),
  });

/** The admin verification-queue row: subscription + plan + purchaser. */
export const AdminSubscriptionRequestPothosObject = gqlSchemaBuilder
  .objectRef<SubscriptionWithPlanAndUser>("AdminSubscriptionRequest")
  .implement({
    fields: t => ({
      id: t.exposeID("id"),
      status: t.exposeString("status"),
      plan: t.field({
        type: PlanPothosObject,
        resolve: parent => parent.plan,
      }),
      user: t.field({
        type: AdminSubscriptionUserPothosObject,
        resolve: parent => parent.user,
      }),
      createdAt: t.field({
        type: DateTimePothosScalar,
        resolve: parent => parent.createdAt,
      }),
      updatedAt: t.field({
        type: DateTimePothosScalar,
        resolve: parent => parent.updatedAt,
      }),
    }),
  });
