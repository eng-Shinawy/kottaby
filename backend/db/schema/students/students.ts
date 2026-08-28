import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { users } from "@/backend/db/schema/users/users";

/**
 * Student role-child table (`students`).
 *
 * Shared PK = FK to users.id with cascade delete (no auto-increment; the row
 * is created only after a users row with role 'student' is inserted).
 * Governance fields (is_deleted, suspended, is_blocked) live on users.
 * One parent per student via parent_id → users.id (set null on delete).
 * Handshake code is unique and required for parent linking.
 *
 * Balance CHECK constraints (balance_* >= 0) are an additional safeguard
 * beyond the base schema, enforcing non-negative balances
 * at the DB layer.
 */
export const students = pgTable(
  "students",
  {
    id: integer("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    balanceHifz: integer("balance_hifz").default(0),
    balanceReviews: integer("balance_reviews").default(0),
    balanceTajweed: integer("balance_tajweed").default(0),
    balanceTrial: integer("balance_trial").notNull().default(0),
    trialGrantedAt: timestamp("trial_granted_at"),
    primaryLanguage: varchar("primary_language", { length: 100 }),
    anotherLanguage: varchar("another_language", { length: 100 }),
    handshakeCode: varchar("handshake_code", { length: 50 }).notNull(),
    parentId: integer("parent_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    unique("students_handshake_code_unique").on(t.handshakeCode),
    index("students_parent_id_idx").on(t.parentId),
    check("students_balance_hifz_check", sql`${t.balanceHifz} >= 0`),
    check("students_balance_reviews_check", sql`${t.balanceReviews} >= 0`),
    check("students_balance_tajweed_check", sql`${t.balanceTajweed} >= 0`),
    check("students_balance_trial_check", sql`${t.balanceTrial} >= 0`),
  ]
);
