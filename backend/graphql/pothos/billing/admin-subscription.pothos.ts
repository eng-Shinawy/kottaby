/**
 * AdminSubscriptionPothosObject — the ADMIN subscription-lifecycle wire
 * contract (DEV1-009).
 *
 * Two objects, one file — both back service-layer projections exclusively
 * (Single Canonical Object Type Pattern, `backend/graphql/AGENTS.md`):
 *  - `AdminSubscription` ← `SubscriptionWithPlanAndUser` (the repository's
 *    INNER-JOIN projection: subscription + plan + purchaser — the SAME
 *    service projection the verification queue rides, widened to ALL
 *    statuses).
 *  - `AdminSubscriptionConnection` ← `AdminSubscriptionsPage` (the page
 *    envelope: items + total + the limit/offset that shaped the page, so
 *    the client can render a truthful pagination footer without
 *    re-deriving it — mirror of `AdminAuditLogConnection`).
 *
 * Least-privilege posture vs the pending-only queue object
 * (`AdminSubscriptionRequest`): the lifecycle list exposes the stamped
 * payment columns + lifecycle dates (`startDate` / `endDate` /
 * `paymentVerifiedAt` / `paymentMethod` / `paymentReference`) because an
 * admin AUDITS MONEY — verifying what was paid, when a subscription ran,
 * and what a cancellation terminated requires those columns on the read
 * surface (they are guaranteed NULL only on a never-verified row). Still
 * NO raw user identity beyond the narrow summary: `user` remains the
 * `AdminSubscriptionUser` projection (id / fullName / email — imported
 * from `admin-subscription-request.pothos`, never redefined, never the
 * full `users` row).
 *
 * Field map (`AdminSubscription`):
 *      id                  → `ID!` (numeric PK behind the ID scalar)
 *      status              → `String!` (subscription_status pgEnum literal)
 *      plan                → `Plan!` (the canonical `PlanPothosObject`)
 *      user                → `AdminSubscriptionUser!`
 *      startDate / endDate / paymentVerifiedAt → nullable `DateTime`
 *      paymentMethod / paymentReference → nullable `String`
 *      createdAt / updatedAt → non-nullable `DateTime`
 */

import { AdminSubscriptionUserPothosObject } from "@/backend/graphql/pothos/billing/admin-subscription-request.pothos";
import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import type {
  AdminSubscriptionsPage,
  SubscriptionWithPlanAndUser,
} from "@/backend/services/billing/subscription.service";

/** One admin-lifecycle row: subscription + plan + narrow purchaser summary. */
export const AdminSubscriptionPothosObject = gqlSchemaBuilder
  .objectRef<SubscriptionWithPlanAndUser>("AdminSubscription")
  .implement({
    fields: t => ({
      // ID! — Apollo cache normalization (`AdminSubscription:<id>`).
      id: t.exposeID("id"),
      // Literal pgEnum text ('active' | 'pending' | …) — no enum scalars on
      // the wire at this phase; consumers match on the literal strings.
      status: t.exposeString("status"),
      plan: t.field({
        type: PlanPothosObject,
        resolve: parent => parent.plan,
      }),
      user: t.field({
        type: AdminSubscriptionUserPothosObject,
        resolve: parent => parent.user,
      }),
      // Lifecycle + payment stamps — NULL until the verification stage
      // records them (the queue object omits these entirely; the lifecycle
      // list surfaces them because admins audit money).
      startDate: t.field({
        type: DateTimePothosScalar,
        nullable: true,
        resolve: parent => parent.startDate,
      }),
      endDate: t.field({
        type: DateTimePothosScalar,
        nullable: true,
        resolve: parent => parent.endDate,
      }),
      paymentVerifiedAt: t.field({
        type: DateTimePothosScalar,
        nullable: true,
        resolve: parent => parent.paymentVerifiedAt,
      }),
      paymentMethod: t.exposeString("paymentMethod", { nullable: true }),
      paymentReference: t.exposeString("paymentReference", { nullable: true }),
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

/** The page envelope behind the admin lifecycle list. */
export const AdminSubscriptionConnectionPothosObject = gqlSchemaBuilder
  .objectRef<AdminSubscriptionsPage>("AdminSubscriptionConnection")
  .implement({
    fields: t => ({
      items: t.field({
        type: [AdminSubscriptionPothosObject],
        nullable: false,
        resolve: parent => parent.items,
      }),
      total: t.exposeInt("total"),
      limit: t.exposeInt("limit"),
      offset: t.exposeInt("offset"),
    }),
  });
