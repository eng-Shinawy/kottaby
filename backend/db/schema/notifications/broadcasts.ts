import { index, integer, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { broadcastAudienceType, broadcastStatus, userRole } from "@/backend/db/schema/enums";
import { users } from "@/backend/db/schema/users/users";

/**
 * Broadcasts header table (`broadcasts`) — one row per accepted admin
 * broadcast send, carrying the verbatim message copy, the audience
 * snapshot, the sender, the recipient count, and the one-way
 * `active → stopped` lifecycle state (`stopped` is terminal).
 *
 * The audience snapshot columns (`audience_type`, `audience_role`,
 * `audience_country`, `audience_plan_id`) record the targeted cohort at
 * send time. They are nullable: historical rows whose audit snapshot is
 * missing or unrecognized stay valid instead of being rejected.
 * `audience_plan_id` deliberately carries NO foreign key — the referenced
 * plan may be deleted later without invalidating history.
 *
 * `sent_by_id` restricts on user deletion so send provenance always
 * attributes to a real user; `stopped_by_id` is nullable and set-nulls on
 * user deletion (a stopper's identity is optional provenance).
 *
 * `idempotency_key` is nullable and unique — Postgres permits multiple
 * NULLs in a unique index, so only sends that declare a key participate in
 * dedupe, and the unique violation is the send-path replay arbiter (never
 * a pre-check SELECT).
 *
 * Indexes:
 *  - `broadcasts_idempotency_key_uidx` on `idempotency_key`
 *    (send-path replay arbitration)
 *  - `broadcasts_sent_at_idx` on `sent_at` (newest-first history listing)
 *  - `broadcasts_status_idx` on `status` (status-filtered history queries)
 */
export const broadcasts = pgTable(
  "broadcasts",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body").notNull(),
    audienceType: broadcastAudienceType("audience_type"),
    audienceRole: userRole("audience_role"),
    audienceCountry: varchar("audience_country", { length: 100 }),
    audiencePlanId: integer("audience_plan_id"),
    status: broadcastStatus("status").notNull().default("active"),
    recipientCount: integer("recipient_count").notNull(),
    sentById: integer("sent_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sentAt: timestamp("sent_at").defaultNow().notNull(),
    stoppedById: integer("stopped_by_id").references(() => users.id, {
      onDelete: "set null",
    }),
    stoppedAt: timestamp("stopped_at"),
    idempotencyKey: varchar("idempotency_key"),
  },
  t => [
    uniqueIndex("broadcasts_idempotency_key_uidx").on(t.idempotencyKey),
    index("broadcasts_sent_at_idx").on(t.sentAt),
    index("broadcasts_status_idx").on(t.status),
  ]
);
