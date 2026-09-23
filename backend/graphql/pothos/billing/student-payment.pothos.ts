/**
 * StudentPaymentPothosObject — the single canonical GraphQL object type
 * for a `student_payments` ledger row.
 *
 * Single Canonical Object Type Pattern (`backend/graphql/AGENTS.md`):
 *  - Backed EXCLUSIVELY by `StudentPaymentReturnType` from
 *    `@/backend/types` (the table's `$inferSelect` projection with the
 *    status/gateway columns re-typed to their canonical TS enums) — zero
 *    local type definitions here.
 *  - `id` first (Apollo cache normalization identity).
 *  - `amount`/`currency` are decimal STRINGS exposed verbatim (money
 *    discipline: never numbers, never floats) — copied server-side from
 *    the plan row at purchase time.
 *  - `subscriptionId` is nullable: the link is severed (set null) if the
 *    owning subscription is ever removed, while the payment history
 *    survives — the immutable ledger outlives the link.
 *
 * Registered ahead of its resolvers through the billing Pothos barrel
 * (`gqlSchema.ts` side-effect chain); the purchase payload wrapper
 * references this ref.
 */

import { gqlSchemaBuilder } from "@/backend/graphql/pothos/builder";
import { PaymentGatewayPothosEnum, PaymentStatusPothosEnum } from "@/backend/graphql/pothos/shared/enum.pothos";
import type { StudentPaymentReturnType } from "@/backend/types";

/**
 * The canonical `StudentPayment` GraphQL object type.
 */
export const StudentPaymentPothosObject = gqlSchemaBuilder
  .objectRef<StudentPaymentReturnType>("StudentPayment")
  .implement({
    description: "A recorded payment a student made for a subscription.",
    fields: t => ({
      // ID FIRST — Apollo cache normalization identity.
      id: t.exposeID("id", {
        description: "Unique payment identifier (Apollo cache normalization key).",
      }),
      subscriptionId: t.exposeInt("subscriptionId", {
        nullable: true,
        description: "ID of the subscription the payment was made for, or null if the link was severed.",
      }),
      amount: t.exposeString("amount", {
        description: "Exact paid amount as a decimal string (money is never a number).",
      }),
      currency: t.exposeString("currency", {
        description: "Three-letter ISO currency code the payment was collected in.",
      }),
      paymentGateway: t.expose("paymentGateway", {
        type: PaymentGatewayPothosEnum,
        description: "Gateway the payment traveled.",
      }),
      status: t.expose("status", {
        type: PaymentStatusPothosEnum,
        description: "Settlement state — pending until the gateway decision marks it paid or failed.",
      }),
      createdAt: t.string({
        description: "Timestamp when the payment record was created.",
        resolve: parent => parent.createdAt.toISOString(),
      }),
      updatedAt: t.string({
        description: "Timestamp when the payment record was last modified.",
        resolve: parent => parent.updatedAt.toISOString(),
      }),
    }),
  });
