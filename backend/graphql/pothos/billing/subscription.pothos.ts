/**
 * SubscriptionPothosObject — the canonical GraphQL object type for a
 * subscription row (DEV1-006 Phase A wire contract).
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by `SubscriptionWithPlan` (the service-layer
 *    projection: the drizzle `subscriptions` select shape + its embedded
 *    `plan` row) — zero resolver-local type definitions here.
 *  - Field map:
 *      id                                   → `ID!` (numeric PK behind the
 *        ID scalar — Apollo cache normalization, `Subscription:<id>`)
 *      status                               → `String!` (subscription_status
 *        pgEnum value; exposed as its literal text — 'pending' at creation)
 *      plan                                 → `Plan!` (the canonical
 *        `PlanPothosObject` — the storefront renders request states from
 *        the embedded catalog row)
 *      startDate / endDate                  → nullable `DateTime` (NULL
 *        until the payment-confirmation phase stamps them)
 *      paymentMethod                        → nullable `String` (pgEnum
 *        payment_gateway value; NULL at request time)
 *      paymentReference                     → nullable `String`
 *      paymentVerifiedAt                    → nullable `DateTime`
 *      createdAt / updatedAt                → non-nullable `DateTime`
 *
 * Least-privilege posture: the shape carries NO user identity fields — the
 * read surfaces are owner-scoped (`mySubscriptions` = `ctx.user.id`), so a
 * userId exposure would be redundant context leakage. `plan` is embedded
 * server-side; no resolver joins, no N+1 on the wire.
 */

import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { DateTimePothosScalar } from "@/backend/graphql/pothos/shared/datetime.pothos";
import type { SubscriptionWithPlan } from "@/backend/services/billing/subscription.service";

export const SubscriptionPothosObject = gqlSchemaBuilder.objectRef<SubscriptionWithPlan>("Subscription").implement({
  fields: t => ({
    // ID! (numeric PK behind the ID scalar) — Apollo cache normalization.
    id: t.exposeID("id"),
    // Literal pgEnum text ('pending' | 'active' | …) — no enum scalars on
    // the wire at this phase; consumers match on the literal strings.
    status: t.exposeString("status"),
    plan: t.field({
      type: PlanPothosObject,
      resolve: parent => parent.plan,
    }),
    // Nullable lifecycle dates — stamped by the payment-confirmation
    // phase, never at request time.
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
    // Offline-payment tracking columns (decision B.9) — all NULL until
    // the admin verification stage records the method.
    paymentMethod: t.exposeString("paymentMethod", { nullable: true }),
    paymentReference: t.exposeString("paymentReference", { nullable: true }),
    paymentVerifiedAt: t.field({
      type: DateTimePothosScalar,
      nullable: true,
      resolve: parent => parent.paymentVerifiedAt,
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
