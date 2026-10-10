/**
 * Drizzle adapter for the performance-data cleanup tool — the one module
 * that touches the database. It implements the `CleanupDatabase` seam with
 * strictly prefix-scoped predicates: every DELETE and every residue count
 * is bound to the escaped LIKE pattern built from the seed manifest prefix,
 * so a cleanup pass can never touch a non-prefixed row.
 *
 * Import discipline: this module references the shared database client TYPE
 * only. The client module itself is imported dynamically by the cleanup
 * entry point AFTER the destructive-target guard has allowed the run, so no
 * pool or client object is ever constructed before the guard decides.
 *
 * Tables without a natural prefix column (teacher, wallet, session, admin)
 * are scoped through the owning prefixed `users` rows; the remaining tables
 * match their prefixed text column directly, and the join-armed predicates
 * additionally match their prefixed column where one exists.
 */

import { inArray, like, or, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import type { CleanupDatabase, CleanupTableName } from "@/scripts/perf/lib/cleanup-shapes";

/** The Drizzle client type, referenced without importing the client module at load time. */
type CleanupDbClient = typeof import("@/backend/db/client")["db"];

/** The ids of the users this run seeded (fresh subquery per use). */
function prefixedUserIds(db: CleanupDbClient, pattern: string) {
  return db.select({ id: users.id }).from(users).where(like(users.email, pattern));
}

type PredicateBuilder = (db: CleanupDbClient, pattern: string) => SQL | undefined;

/** Per-table "row belongs to this run" predicate. */
const PREDICATE_BY_NAME: Record<CleanupTableName, PredicateBuilder> = {
  notifications: (_db, pattern) => like(notifications.title, pattern),
  session: (db, pattern) =>
    or(
      inArray(session.teacherId, prefixedUserIds(db, pattern)),
      inArray(session.studentId, prefixedUserIds(db, pattern))
    ),
  subscriptions: (db, pattern) =>
    or(inArray(subscriptions.userId, prefixedUserIds(db, pattern)), like(subscriptions.paymentReference, pattern)),
  wallet: (db, pattern) => inArray(wallet.teacherId, prefixedUserIds(db, pattern)),
  plans: (_db, pattern) => like(plans.title, pattern),
  teacher: (db, pattern) => inArray(teacher.id, prefixedUserIds(db, pattern)),
  students: (db, pattern) =>
    or(inArray(students.id, prefixedUserIds(db, pattern)), like(students.handshakeCode, pattern)),
  admin: (db, pattern) => inArray(admin.id, prefixedUserIds(db, pattern)),
  users: (_db, pattern) => or(like(users.email, pattern), like(users.fullName, pattern)),
};

/** Drizzle table object per cleanup table name. */
const TABLE_BY_NAME: Record<CleanupTableName, PgTable> = {
  notifications,
  session,
  subscriptions,
  wallet,
  plans,
  teacher,
  students,
  admin,
  users,
};

/** Prefix-scoped delete/count adapter over the real Drizzle client. */
export class DrizzleCleanupDatabase implements CleanupDatabase {
  constructor(private readonly db: CleanupDbClient) {}

  async deleteRows(table: CleanupTableName, pattern: string): Promise<number> {
    const result = await this.db.delete(TABLE_BY_NAME[table]).where(PREDICATE_BY_NAME[table](this.db, pattern));
    return result.rowCount ?? 0;
  }

  async countResidue(table: CleanupTableName, pattern: string): Promise<number> {
    return this.db.$count(TABLE_BY_NAME[table], PREDICATE_BY_NAME[table](this.db, pattern));
  }
}
