import type { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import type { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import type { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { PaymentCheckoutSession } from "@/backend/types/billing/payment-gateway.types";
import type { PlanReturnType } from "@/backend/types/billing/plan.types";
import type { StudentPaymentReturnType } from "@/backend/types/billing/student-payment.types";
import type { SubscriptionAuditTrailPeek } from "@/backend/types/billing/subscription-admin.types";

export type SubscriptionSelectType = typeof subscriptions.$inferSelect;
export type SubscriptionInsertType = typeof subscriptions.$inferInsert;

/**
 * Canonical GraphQL/API read shape for a subscription row.
 *
 * Derived from the table's select row with the two enum columns re-typed
 * to their canonical TypeScript enums (`backend/enum/billing/`): the raw
 * `$inferSelect` projection carries the pgEnum string-literal unions,
 * while consumers of this shape work with the enum objects, forcing
 * enum-member usage and turning accidental raw literals into compile
 * errors. `paymentMethod` stays nullable — a subscription exists before
 * any gateway is involved, and admin-recorded offline payments may never
 * set it.
 */
export type SubscriptionReturnType = Omit<SubscriptionSelectType, "status" | "paymentMethod"> & {
  status: SubscriptionStatus;
  paymentMethod: PaymentGateway | null;
};

/**
 * A canonical subscription row plus its page-level enrichment — the read
 * shape the two list producers return.
 *
 * A FLAT structural supertype of `SubscriptionReturnType` (the plain
 * intersection keeps every enriched row assignable anywhere the bare row
 * type is expected, so the GraphQL object ref keeps its backing type):
 * the enrichment members are OPTIONAL because a producer that has not
 * enriched still yields a valid value, and each member is nullable where
 * "absent" is an honest answer — a plan row that no longer exists
 * enriches `plan: null` (a value, never a thrown miss), a subscription
 * with no recorded history carries `auditTrailPeek: null`, and
 * `auditEntriesCount` is the honest `0`. Producers merge the members into
 * row COPIES (the `Object.assign` idiom) — the source rows are never
 * mutated.
 */
export type EnrichedSubscriptionReturnType = SubscriptionReturnType & {
  readonly plan?: PlanReturnType | null;
  readonly auditEntriesCount?: number;
  readonly auditTrailPeek?: SubscriptionAuditTrailPeek | null;
};

/**
 * Purchase submit input: the client-controlled whitelist ONLY (BOPLA).
 *
 * `planId` is the sole client-supplied field. The purchaser identity is
 * resolved from the authenticated caller's context, and every financial
 * column (amount, currency, gateway, reference) is derived server-side
 * from the freshly-read plan row — a client payload structurally cannot
 * carry, spoof, or influence any of them.
 *
 * Named `...SubmitInput` after the `PlanSubmitInput` convention: the
 * GraphQL wire input of the purchase mutation is a separate Pothos type
 * (`PurchaseSubscriptionInput` on the checkout leaf) — the two share a
 * name only on the wire, never a shape.
 */
export interface PurchaseSubscriptionSubmitInput {
  readonly planId: number;
}

/**
 * Purchase mutation return: the newly created pending subscription +
 * payment pair plus the gateway checkout descriptor. Composed by field —
 * never spread — so each member keeps its own canonical read shape and
 * the checkout session stays provider-agnostic.
 */
export type PurchaseSubscriptionReturnType = {
  readonly subscription: SubscriptionReturnType;
  readonly payment: StudentPaymentReturnType;
  readonly checkout: PaymentCheckoutSession;
};

/**
 * Identity projection of a subscription row flipped to the expired
 * status by the batch expiry statement. Each expiring subscription is
 * reported only by the fields its aftermath needs — which subscription
 * expired, for whom, and under which plan — so the follow-up step can
 * resolve the plan's credit lane and settle the owning student's
 * balances within the same transaction. No other columns participate
 * in that settlement.
 */
export type ExpiredDueSubscriptionRow = {
  readonly id: number;
  readonly userId: number;
  readonly planId: number;
};

/**
 * Counts-only result of an expiry sweep run: how many subscriptions
 * were flipped to expired and how many balance lanes were zeroed as a
 * consequence. The shape carries no row identifiers, so the scheduled
 * job envelope can return it verbatim, and re-running an already
 * applied sweep honestly reports zeroes instead of replaying effects.
 */
export type SubscriptionExpirySweepReturnType = {
  readonly expired: number;
  readonly lanesZeroed: number;
};
