/**
 * SubscriptionPothosObject — the single canonical GraphQL object type for
 * a `subscriptions` row, on the wire as `StudentSubscription`.
 *
 * The GraphQL type name is deliberately NOT `Subscription`: GraphQL
 * default-root naming reserves that name for the schema's subscription
 * root, and a bare object carrying it is silently auto-adopted as the
 * root when the builder declares none — realtime delivery is the
 * WebSocket sidecar's contract, never a GraphQL subscription (pinned by
 * `backend/graphql/test/sdl-static-assertions.test.ts`). The canonical
 * backend type remains `SubscriptionReturnType` from `@/backend/types`.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by `SubscriptionReturnType` from `@/backend/types`
 *    (the table's `$inferSelect` projection with the status/payment-method
 *    columns re-typed to their canonical TS enums) — zero local type
 *    definitions here, and no business logic: every field is a
 *    passthrough or a serialization of the canonical row.
 *  - `id` first (Apollo cache normalization identity).
 *  - Timestamps are serialized to ISO-8601 UTC strings exactly like the
 *    plan-catalog object (date→String mapping, no scalar indirection).
 *  - The columns that may legitimately be unset (`startDate`, `endDate`,
 *    `paymentVerifiedAt` until the payment decision, plus the
 *    offline-payment pair `paymentMethod`/`paymentReference`) stay
 *    nullable — a pending subscription carries NULL honestly.
 *  - The `plan` relation resolves the catalog row the subscription grants
 *    (the human-readable title for the student surfaces). It is NON-NULL
 *    honestly: `plan_id` carries `restrict` delete semantics, so a plan
 *    with subscriptions can never be hard-deleted — the resolved row always
 *    exists. The resolver delegates to the services layer (no repository
 *    call, no business logic here).
 *
 * Registered ahead of its resolvers through the billing Pothos barrel
 * (`gqlSchema.ts` side-effect chain); the purchase payload wrapper and the
 * owner listing reference this ref.
 */

import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AuditActionTypePothosEnum,
  PaymentGatewayPothosEnum,
  SubscriptionStatusPothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import type { SubscriptionAuditTrailPeek, SubscriptionReturnType } from "@/backend/types";

/**
 * The canonical `StudentSubscription` GraphQL object type (the
 * `subscriptions` row).
 */
export const SubscriptionPothosObject = gqlSchemaBuilder
  .objectRef<SubscriptionReturnType>("StudentSubscription")
  .implement({
    description: "A student subscription linking a purchaser to a catalog plan.",
    fields: t => ({
      // ID FIRST — Apollo cache normalization identity.
      id: t.exposeID("id", {
        description: "Unique subscription identifier (Apollo cache normalization key).",
      }),
      planId: t.exposeInt("planId", {
        description: "ID of the catalog plan this subscription grants.",
      }),
      plan: t.field({
        type: PlanPothosObject,
        description: "The catalog plan this subscription grants (the resolved row always exists — restrict FK).",
        resolve: (parent, _args, ctx) => PlanCatalogService.findById(parent.planId, ctx.locale),
      }),
      status: t.expose("status", {
        type: SubscriptionStatusPothosEnum,
        description: "Lifecycle state — purchases start pending; activation moves them to active.",
      }),
      startDate: t.string({
        nullable: true,
        description: "Timestamp the subscription period began, or null while pending.",
        resolve: parent => parent.startDate?.toISOString() ?? null,
      }),
      endDate: t.string({
        nullable: true,
        description: "Timestamp the subscription period ends, or null while pending.",
        resolve: parent => parent.endDate?.toISOString() ?? null,
      }),
      paymentMethod: t.expose("paymentMethod", {
        type: PaymentGatewayPothosEnum,
        nullable: true,
        description: "Gateway the payment traveled, or null when no gateway is involved yet.",
      }),
      paymentReference: t.exposeString("paymentReference", {
        nullable: true,
        description: "Gateway-issued payment reference, or null for offline payments without one.",
      }),
      paymentVerifiedAt: t.string({
        nullable: true,
        description: "Timestamp the payment was verified, or null while unverified.",
        resolve: parent => parent.paymentVerifiedAt?.toISOString() ?? null,
      }),
      createdAt: t.string({
        description: "Timestamp when the subscription record was created.",
        resolve: parent => parent.createdAt.toISOString(),
      }),
      updatedAt: t.string({
        description: "Timestamp when the subscription record was last modified.",
        resolve: parent => parent.updatedAt.toISOString(),
      }),
      auditEntriesCount: t.int({
        description:
          "How many audit-trail entries the trail holds for this subscription (the admin drawer's per-row trail-depth badge). Read-only; a row with no history answers 0.",
        resolve: parent => SubscriptionAdminService.auditEntriesCount(parent.id),
      }),
      auditTrailPeek: t.field({
        type: SubscriptionAuditTrailPeekPothosObject,
        nullable: true,
        description:
          "The most recent audit-trail entry for this subscription (the drawer's trail teaser), or null when the trail holds no entries for the row.",
        resolve: parent => SubscriptionAdminService.auditTrailPeek(parent.id),
      }),
    }),
  });

/**
 * `StudentSubscriptionAuditPeek` — the embedded value object carrying the
 * subscription's most recent trail entry (action type + instant). No `id`
 * of its own (not a normalizable entity — exactly one peek per row); the
 * canonical action enum rides the shared audit enum, and the instant is
 * serialized ISO-8601 UTC like every timestamp on the row.
 */
export const SubscriptionAuditTrailPeekPothosObject = gqlSchemaBuilder
  .objectRef<SubscriptionAuditTrailPeek>("StudentSubscriptionAuditPeek")
  .implement({
    description: "The most recent audit-trail entry for one subscription (the drawer's trail teaser).",
    fields: t => ({
      actionType: t.expose("actionType", {
        type: AuditActionTypePothosEnum,
        description: "Canonical action type of the most recent trail entry (fail-closed certified server-side).",
      }),
      at: t.string({
        description: "Timestamp of the most recent trail entry (ISO-8601 UTC).",
        resolve: parent => parent.at.toISOString(),
      }),
    }),
  });
