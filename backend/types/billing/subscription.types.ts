import type { subscriptions } from "@/backend/db/schema/billing/subscriptions";

export type SubscriptionSelectType = typeof subscriptions.$inferSelect;
export type SubscriptionInsertType = typeof subscriptions.$inferInsert;

/**
 * Canonical API-facing subscription shape. Subscriptions carry no forbidden
 * fields at this phase (payment columns are part of the B.9 tracking
 * surface, not secrets), so the return type keeps the select shape
 * unchanged — deepened to read-only so a returned subscription can never
 * be mutated in place.
 */
export type SubscriptionReturnType = Readonly<SubscriptionSelectType>;

/**
 * Narrow purchaser summary embedded in the ADMIN verification-queue
 * projection (`SubscriptionWithPlanAndUser`). Deliberately limited to the
 * three fields the verification workflow needs to identify WHO paid —
 * never the full `users` row (no phone, no role internals, no governance
 * columns): the admin surface shows a payment queue, not a directory.
 */
export type SubscriptionUserSummary = {
  readonly id: number;
  readonly fullName: string;
  readonly email: string;
};
