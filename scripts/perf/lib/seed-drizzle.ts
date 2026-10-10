/**
 * Drizzle adapter for the performance-data seeder — the one module that
 * touches the database. It implements the `SeedDatabase` seam with chunked
 * multi-row INSERT statements (never row-by-row): every volume table flows
 * through the shared batch pump at the documented batch size, and id
 * columns are read back only where the run needs the database-assigned ids.
 *
 * Import discipline: this module references the shared database client TYPE
 * only. The client module itself is imported dynamically by the seeder
 * entry point AFTER the destructive-target guard has allowed the run, so
 * no pool or client object is ever constructed before the guard decides.
 */

import { like } from "drizzle-orm";
import { plans } from "@/backend/db/schema/billing/plans";
import { subscriptions } from "@/backend/db/schema/billing/subscriptions";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { students } from "@/backend/db/schema/students/students";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import {
  INSERT_BATCH_SIZE,
  insertInBatches,
  insertInBatchesReturningIds,
  type NotificationSeedRow,
  type PlanSeedRow,
  type SeedDatabase,
  type SessionSeedRow,
  type StudentRoleSeedRow,
  type SubscriptionSeedRow,
  type TeacherRoleSeedRow,
  type UserSeedRow,
  type WalletSeedRow,
} from "@/scripts/perf/lib/seed-shapes";

/** The Drizzle client type, referenced without importing the client module at load time. */
type SeedDbClient = typeof import("@/backend/db/client")["db"];

/** Chunked multi-row INSERT adapter over the real Drizzle client. */
export class DrizzleSeedDatabase implements SeedDatabase {
  constructor(private readonly db: SeedDbClient) {}

  async countUsersWithEmailLike(pattern: string): Promise<number> {
    return this.db.$count(users, like(users.email, pattern));
  }

  async insertUsers(rows: Iterable<UserSeedRow>): Promise<number[]> {
    return insertInBatchesReturningIds(rows, INSERT_BATCH_SIZE, async batch => {
      const inserted = await this.db
        .insert(users)
        .values([...batch])
        .returning({ id: users.id });
      return inserted.map(row => row.id);
    });
  }

  async insertTeacherRoles(rows: Iterable<TeacherRoleSeedRow>): Promise<number> {
    return insertInBatches(rows, INSERT_BATCH_SIZE, async batch => {
      await this.db.insert(teacher).values([...batch]);
    });
  }

  async insertStudentRoles(rows: Iterable<StudentRoleSeedRow>): Promise<number> {
    return insertInBatches(rows, INSERT_BATCH_SIZE, async batch => {
      await this.db.insert(students).values([...batch]);
    });
  }

  async insertAdminRoles(userIds: readonly number[]): Promise<number> {
    if (userIds.length === 0) {
      return 0;
    }
    await this.db.insert(admin).values(userIds.map(id => ({ id })));
    return userIds.length;
  }

  async insertWallets(rows: Iterable<WalletSeedRow>): Promise<number> {
    return insertInBatches(rows, INSERT_BATCH_SIZE, async batch => {
      await this.db.insert(wallet).values([...batch]);
    });
  }

  async insertPlans(rows: readonly PlanSeedRow[]): Promise<number[]> {
    if (rows.length === 0) {
      return [];
    }
    const inserted = await this.db
      .insert(plans)
      .values([...rows])
      .returning({ id: plans.id });
    return inserted.map(row => row.id);
  }

  async insertSubscriptions(rows: Iterable<SubscriptionSeedRow>): Promise<number> {
    return insertInBatches(rows, INSERT_BATCH_SIZE, async batch => {
      await this.db.insert(subscriptions).values([...batch]);
    });
  }

  async insertSessions(rows: Iterable<SessionSeedRow>): Promise<number[]> {
    return insertInBatchesReturningIds(rows, INSERT_BATCH_SIZE, async batch => {
      const inserted = await this.db
        .insert(session)
        .values([...batch])
        .returning({ id: session.id });
      return inserted.map(row => row.id);
    });
  }

  async insertNotifications(rows: Iterable<NotificationSeedRow>): Promise<number> {
    return insertInBatches(rows, INSERT_BATCH_SIZE, async batch => {
      await this.db.insert(notifications).values([...batch]);
    });
  }
}
