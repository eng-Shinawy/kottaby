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
 * backend row type remains `SubscriptionReturnType` from `@/backend/types`.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed by `EnrichedSubscriptionReturnType` from `@/backend/types` —
 *    the canonical `SubscriptionReturnType` row (the table's
 *    `$inferSelect` projection with the status/payment-method columns
 *    re-typed to their canonical TS enums) plus the optional
 *    page-level enrichment fields (`plan` / `auditEntriesCount` /
 *    `auditTrailPeek`) the two list producers attach in one batch pass.
 *    Zero local type definitions here, and no business logic: every field
 *    is a passthrough or a serialization of the canonical row.
 *  - `plan` / `auditEntriesCount` / `auditTrailPeek` prefer the value
 *    CARRIED on the parent when the producer attached the key (key
 *    presence decides — a carried `null`/`0` is the honest answer, never
 *    a fallback trigger); only rows that arrive WITHOUT the key (mutation
 *    payloads and other non-list producers) fall back to the single-row
 *    service reads.
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
 *    exists. The resolver prefers the plan carried on the parent (the list
 *    producers' one-pass page batch) and falls back to the single-row
 *    service read only when the producer did not attach the field (no
 *    repository call, no business logic here).
 *
 * Registered ahead of its resolvers through the billing Pothos barrel
 * (`gqlSchema.ts` side-effect chain); the purchase payload wrapper and the
 * owner listing reference this ref.
 */

import type { Context } from "@/backend/graphql/gqlContextFactory";
import { PlanPothosObject } from "@/backend/graphql/pothos/billing/plan.pothos";
import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import {
  AuditActionTypePothosEnum,
  PaymentGatewayPothosEnum,
  SubscriptionStatusPothosEnum,
} from "@/backend/graphql/pothos/shared/enum.pothos";
import { NotFoundError } from "@/backend/lib/errors";
import { PlanCatalogService } from "@/backend/services/billing/plan-catalog.service";
import { SubscriptionAdminService } from "@/backend/services/billing/subscription-admin.service";
import type { EnrichedSubscriptionReturnType, PlanReturnType, SubscriptionAuditTrailPeek } from "@/backend/types";

/**
 * The carried-value arm of the `plan` resolver: a null the page batch
 * carried is its "plan id did not resolve" answer, surfaced as the same
 * localized not-found denial the single-row read gives for an
 * unresolvable plan (the restrict FK keeps real rows from ever landing
 * here) — never masked by a silent re-read.
 */
async function carriedPlanOrPlanNotFound(plan: PlanReturnType | null, ctx: Context): Promise<PlanReturnType> {
  if (plan !== null) {
    return plan;
  }
  const tErrors = await ctx.t("errorsTranslations");
  throw new NotFoundError("PLAN", tErrors.planCatalog.planNotFound);
}

/**
 * The canonical `StudentSubscription` GraphQL object type (the
 * `subscriptions` row).
 */
export const SubscriptionPothosObject = gqlSchemaBuilder
  .objectRef<EnrichedSubscriptionReturnType>("StudentSubscription")
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
        resolve: async (parent, _args, ctx) => {
          // Key presence decides: a value the page batch carried IS this
          // row's answer (never a re-read trigger); only a producer that
          // attached no key at all takes the single-row read.
          if (parent.plan === undefined) {
            return PlanCatalogService.findById(parent.planId, ctx.locale);
          }
          return carriedPlanOrPlanNotFound(parent.plan, ctx);
        },
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
        // Key presence decides: the page batch's carried count IS the row's
        // answer; only a producer that attached no key takes the single-row read.
        resolve: parent => parent.auditEntriesCount ?? SubscriptionAdminService.auditEntriesCount(parent.id),
      }),
      auditTrailPeek: t.field({
        type: SubscriptionAuditTrailPeekPothosObject,
        nullable: true,
        description:
          "The most recent audit-trail entry for this subscription (the drawer's trail teaser), or null when the trail holds no entries for the row.",
        resolve: parent => {
          // Key presence decides — including for a carried null: a trail the
          // batch resolved to "no latest entry" answers null here without a
          // re-read; only a producer that attached no key takes the
          // single-row read.
          if (parent.auditTrailPeek === undefined) {
            return SubscriptionAdminService.auditTrailPeek(parent.id);
          }
          return parent.auditTrailPeek;
        },
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
