import { boolean, index, integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { notificationType } from "@/backend/db/schema/enums";
import { users } from "@/backend/db/schema/users/users";

/**
 * Persisted notifications table (`notifications`).
 *
 * Stores per-user notifications for session requests, completions,
 * cancellations, parent-link requests, system broadcasts, payment
 * confirmations, and evaluation results. `type` discriminates the
 * notification kind; `related_entity_type` + `related_entity_id` form a
 * polymorphic pointer to the related row (session, subscription,
 * parent_link, etc.).
 *
 * `is_read` is a soft flag toggled when the user acknowledges the
 * notification. `user_id` cascades on user deletion (a user's
 * notifications disappear with them).
 *
 * There is NO `updated_at` column — notifications are write-once
 * except for the `is_read` flip, which is permitted in place.
 *
 * Indexes:
 *  - `notifications_user_id_idx` on `user_id` (lookup a user's feed)
 *  - `notifications_user_id_is_read_idx` composite on
 *    `(user_id, is_read)` (unread-count queries per user)
 *  - `notifications_related_entity_type_entity_id_idx` composite on
 *    `(related_entity_type, related_entity_id)` (linkage lookups and
 *    retraction deletes by related entity)
 */
export const notifications = pgTable(
  "notifications",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationType("type").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    body: text("body"),
    isRead: boolean("is_read").default(false),
    relatedEntityType: varchar("related_entity_type", { length: 100 }),
    relatedEntityId: integer("related_entity_id"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => [
    index("notifications_user_id_idx").on(t.userId),
    index("notifications_user_id_is_read_idx").on(t.userId, t.isRead),
    index("notifications_related_entity_type_entity_id_idx").on(t.relatedEntityType, t.relatedEntityId),
  ]
);
