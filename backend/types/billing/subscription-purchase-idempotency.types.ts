import type { subscriptionPurchaseIdempotency } from "@/backend/db/schema/billing/subscription-purchase-idempotency";

export type SubscriptionPurchaseIdempotencySelectType = typeof subscriptionPurchaseIdempotency.$inferSelect;
export type SubscriptionPurchaseIdempotencyInsertType = typeof subscriptionPurchaseIdempotency.$inferInsert;
