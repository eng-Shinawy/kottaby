import { boolean, date, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";
import { appLocale, gender, userRole } from "@/backend/db/schema/enums";

/**
 * Central user table (`users`).
 *
 * Governance fields (is_deleted, suspended, is_blocked) apply to all roles.
 * Role-specific data lives in admin/teacher/students/parents child tables via
 * shared PK. Column names + types are the canonical contract across layers.
 */
export const users = pgTable(
  "users",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    fullName: varchar("full_name", { length: 255 }).notNull(),
    email: varchar("email", { length: 255 }).notNull(),
    phone: varchar("phone", { length: 20 }),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    role: userRole("role").notNull(),
    dateOfBirth: date("date_of_birth"),
    gender: gender("gender"),
    country: varchar("country", { length: 100 }),
    /**
     * Normalized ISO 3166-1 alpha-2 country code (e.g. "EG"). Nullable —
     * legacy rows carry only the free-text `country` display value until the
     * deferred normalization backfill runs; new writes populate both.
     */
    countryCode: varchar("country_code", { length: 2 }),
    /**
     * Per-user app locale (UI + copy preference). Nullable — unset until the
     * user explicitly chooses one (registration leaves it null by the D2
     * deferred decision); the notification emitters read it to localize
     * per-recipient copy (the D2 locale vertical).
     */
    locale: appLocale("locale"),
    isDeleted: boolean("is_deleted").default(false),
    deletedAt: timestamp("deleted_at"),
    suspended: boolean("suspended").default(false),
    suspendedAt: timestamp("suspended_at"),
    suspendedPeriodDays: integer("suspended_period_days"),
    isBlocked: boolean("is_blocked").default(false),
    blockedAt: timestamp("blocked_at"),
    lastActiveAt: timestamp("last_active_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  t => [unique("users_email_unique").on(t.email)]
);
