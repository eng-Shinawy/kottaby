import { index, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { session } from "@/backend/db/schema/classes/session";
import { users } from "@/backend/db/schema/users/users";

/**
 * Session request idempotency claim table (`session_request_idempotency`).
 *
 * Durable claim that a given idempotency key has already been used to book a
 * session: the producing service inserts a claim in-phase with the session
 * insert, so transactional fate-sharing makes a replay join the existing
 * claim instead of double-booking. A replay reads the claim by key and
 * returns the already-created session via `session_id`.
 *
 * `idempotency_key` carries the raw `x-idempotency-key` header value
 * (opaque, at most 128 chars) and is UNIQUE — a second insert with the same
 * key fails with the PostgreSQL unique-violation code, which the caller
 * translates into a duplicate-request conflict. The key is never logged.
 *
 * `user_id` → users.id (cascade: claims are meaningless without their
 * owner). `session_id` → session.id is nullable and set-null on session
 * delete: the claim outlives its session so a replay still surfaces the
 * duplicate-conflict semantics instead of silently re-booking.
 */
export const sessionRequestIdempotency = pgTable(
  "session_request_idempotency",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sessionId: integer("session_id").references(() => session.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    unique("session_request_idempotency_key_unique").on(t.idempotencyKey),
    index("session_request_idempotency_user_id_idx").on(t.userId),
  ]
);
