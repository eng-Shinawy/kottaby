import { sql } from "drizzle-orm";
import { boolean, char, check, decimal, integer, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * Subscription plans table (`plans`).
 *
 * Defines the catalog of subscription plans a user can purchase. Each plan
 * grants a fixed number of sessions (`session_count`, must be > 0) for a
 * fixed price (`price`, must be >= 0) in a given `currency` (default "EGP"),
 * valid for `interval_days` (must be > 0).
 *
 * CHECK constraints mirror the intended validation rules.
 *
 * Lifecycle: `is_active` (soft-disable flag, default true) and
 * `deactivated_at` are server-controlled catalog state.
 */
export const plans = pgTable(
  "plans",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    title: varchar("title", { length: 255 }).notNull(),
    sessionCount: integer("session_count").notNull(),
    price: decimal("price", { precision: 10, scale: 2 }).notNull(),
    currency: char("currency", { length: 3 }).notNull().default("EGP"),
    intervalDays: integer("interval_days").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: timestamp("deactivated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [
    check("plans_session_count_check", sql`${t.sessionCount} > 0`),
    check("plans_price_check", sql`${t.price} >= 0`),
    check("plans_interval_days_check", sql`${t.intervalDays} > 0`),
  ]
);
