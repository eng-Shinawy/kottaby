import { integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "@/backend/db/schema/users/users";

/**
 * Failed teacher applicants table (`applicants`).
 *
 * Shared PK = FK to users.id with cascade delete (no auto-increment —
 * applicants is a shared-PK child, not a separate `user_id` column). A row
 * is moved here when a teacher applicant fails verification. A `teacher`
 * row is created only after passing.
 *
 * `status` is a varchar(50) string defaulting to "pending" — the values
 * (pending, in_evaluation, failed, passed) are semantic, but the column is a
 * plain varchar (no pgEnum) so the state machine is enforced at the service
 * layer.
 */
export const applicants = pgTable("applicants", {
  id: integer("id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  verificationAttempts: integer("verification_attempts").default(0),
  lastAttemptAt: timestamp("last_attempt_at"),
  cooldownUntil: timestamp("cooldown_until"),
  /** Re-evaluation cycle anchor — NULL means the applicant has never been ordered a paid re-evaluation. */
  reEvaluationStartedAt: timestamp("re_evaluation_started_at"),
  status: varchar("status", { length: 50 }).default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
