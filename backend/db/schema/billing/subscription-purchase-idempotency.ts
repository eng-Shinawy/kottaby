import { index, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { users } from "@/backend/db/schema/users/users";

/**
 * Subscription purchase idempotency claim table (`subscription_purchase_idempotency`).
 *
 * Durable claim that a given idempotency key has already been used to start a
 * subscription purchase: the producing service inserts the claim in-phase with
 * the subscription insert, so transactional fate-sharing makes a replay join
 * the existing claim instead of double-purchasing. A replay reads the claim by
 * key and surfaces the already-created purchase via `subscription_id`.
 *
 * `idempotency_key` carries the raw `x-idempotency-key` header value
 * (opaque, at most 128 chars) and is UNIQUE — a second insert with the same
 * key fails with the PostgreSQL unique-violation code, which the caller
 * translates into a duplicate-request conflict. The key is never logged.
 *
 * `user_id` → users.id (cascade: claims are meaningless without their
 * owner). `subscription_id` → subscriptions.id is nullable and set-null on
 * subscription delete: the claim outlives its subscription so a replay still
 * surfaces the duplicate-conflict semantics instead of silently re-purchasing.
 */
export const subscriptionPurchaseIdempotency = pgTable(
  "subscription_purchase_idempotency",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: integer("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    unique("subscription_purchase_idempotency_key_unique").on(t.idempotencyKey),
    index("subscription_purchase_idempotency_user_id_idx").on(t.userId),
  ]
);
