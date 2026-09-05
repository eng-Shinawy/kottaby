/**
 * Journey fixture infrastructure — tracked-ID registry + FK-order-aware
 * hard-delete cleanup + side-effect row-count oracles.
 *
 * Layer contract (test/workflows/AGENTS.md, docs/testing/workflow-journey-tests.md):
 *  - NO `runInRollback` in this layer. Fixtures are committed by the consumer
 *    in `beforeAll` (a short `db.transaction(...)` that commits); this module
 *    only records the row ids produced there and hard-deletes them in
 *    `afterAll` via {@link SessionFixtureRegistry.cleanup}.
 *  - Zero business logic: this module records ids, deletes tracked rows in FK
 *    dependency order, and counts side-effect rows. WHAT to create belongs to
 *    the cast builders (`./session-cast`) and the journeys themselves.
 *  - External side effects are asserted by ROW-COUNT DELTAS through the
 *    exported counters (notifications, audit logs, wallets, teacher
 *    transactions) — never by mocking schema behavior.
 *
 * Cleanup design (idempotent teardown):
 *  - `cleanup` opens ONE committed transaction and deletes every tracked id
 *    child-table-first (`JOURNEY_TRACKED_TABLE_DELETE_ORDER`), so restrict-FK
 *    parents (`session` → `teacher`/`students`) are removed before the rows
 *    they reference and `users` is deleted last.
 *  - Empty tables are skipped; on success the registry is cleared, so a
 *    repeated `cleanup` is a no-op. On failure the ids stay tracked, so a
 *    retry still deletes everything. Two consecutive suite runs therefore
 *    prove teardown totality (harness honest-cleanup proof): run 2 recreates
 *    a fresh cast (unique per-run emails/labels) and observes none of run 1's
 *    rows.
 *
 * Immutable-table caveat: `audit_logs` and `teacher_transaction` rows are
 * DELETE-blocked by repo immutability triggers, and both restrict-delete
 * their way into `users`/`wallet`. They are therefore NOT part of the
 * tracked vocabulary — journeys must assert ZERO rows there (the counters
 * below); if a buggy service leaked such a row the count assertion fails
 * the suite AND teardown would fail loudly. That is by design: the leak is
 * surfaced, never silently cleaned.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@/backend/db";
import { auditLogs } from "@/backend/db/schema/audit/audit-logs";
import { teacherTransaction } from "@/backend/db/schema/billing/teacher-transaction";
import { wallet } from "@/backend/db/schema/billing/wallet";
import { session } from "@/backend/db/schema/classes/session";
import { sessionRequestIdempotency } from "@/backend/db/schema/classes/session-request-idempotency";
import { notifications } from "@/backend/db/schema/notifications/notifications";
import { parents } from "@/backend/db/schema/parents/parents";
import { students } from "@/backend/db/schema/students/students";
import { applicants } from "@/backend/db/schema/teachers/applicants";
import { teacher } from "@/backend/db/schema/teachers/teacher";
import { admin } from "@/backend/db/schema/users/admin";
import { users } from "@/backend/db/schema/users/users";
import type { DBTransaction } from "@/backend/types";

/**
 * FK-safe hard-delete order for every table a journey fixture or a service
 * under test may create rows in — children first, `users` last.
 *
 * 1. `session_request_idempotency` — references `users` (cascade) and
 *    `session` (set null); nothing references it.
 * 2. `session` — restrict-FKs into `teacher`/`students`, so it must be gone
 *    before those rows.
 * 3. Role-child rows (`students`, `teacher`, `applicants`, `parents`,
 *    `admin`) — shared-PK FKs into `users`; `students.parent_id` set-nulls
 *    on parent-user deletion but is deleted explicitly here first.
 * 4. `users` — deleted last; any still-attached cascade children
 *    (e.g. notifications) disappear with their owner.
 */
export const JOURNEY_TRACKED_TABLE_DELETE_ORDER = [
  "session_request_idempotency",
  "session",
  "students",
  "teacher",
  "applicants",
  "parents",
  "admin",
  "users",
] as const;

/** A table whose row ids a journey suite may register for hard-delete cleanup. */
export type JourneyTrackedTable = (typeof JOURNEY_TRACKED_TABLE_DELETE_ORDER)[number];

/**
 * Per-table hard-delete closures — a `Record` over the finite tracked-table
 * union keeps every `inArray` predicate fully typed AND the mapping
 * exhaustive (no generic-table column access, no fall-through switch).
 */
const TRACKED_ROW_DELETERS: Record<JourneyTrackedTable, (tx: DBTransaction, ids: number[]) => Promise<unknown>> = {
  session_request_idempotency: (tx, ids) =>
    tx.delete(sessionRequestIdempotency).where(inArray(sessionRequestIdempotency.id, ids)),
  session: (tx, ids) => tx.delete(session).where(inArray(session.id, ids)),
  students: (tx, ids) => tx.delete(students).where(inArray(students.id, ids)),
  teacher: (tx, ids) => tx.delete(teacher).where(inArray(teacher.id, ids)),
  applicants: (tx, ids) => tx.delete(applicants).where(inArray(applicants.id, ids)),
  parents: (tx, ids) => tx.delete(parents).where(inArray(parents.id, ids)),
  admin: (tx, ids) => tx.delete(admin).where(inArray(admin.id, ids)),
  users: (tx, ids) => tx.delete(users).where(inArray(users.id, ids)),
};

/** Deletes the given tracked ids from one tracked table. */
function deleteTrackedRows(tx: DBTransaction, table: JourneyTrackedTable, ids: ReadonlySet<number>): Promise<unknown> {
  return TRACKED_ROW_DELETERS[table](tx, [...ids]);
}

/** Registry of every row id a journey created — the hard-delete worklist. */
export interface SessionFixtureRegistry {
  /** Registers one created row id for hard-delete cleanup (deduplicated). */
  track(table: JourneyTrackedTable, id: number): void;
  /** Registers several created row ids for one table. */
  trackAll(table: JourneyTrackedTable, ids: readonly number[]): void;
  /** Read-only snapshot of the tracked ids for one table (assertions/debug). */
  ids(table: JourneyTrackedTable): readonly number[];
  /** Total number of tracked row ids across all tables. */
  trackedCount(): number;
  /**
   * Hard-deletes every tracked row in {@link JOURNEY_TRACKED_TABLE_DELETE_ORDER}
   * inside ONE committed transaction, then clears the registry. Idempotent:
   * repeated calls (or already-deleted ids) match no rows and succeed.
   */
  cleanup(): Promise<void>;
}

/** Creates an empty fixture registry — one per journey suite. */
export function createSessionFixtureRegistry(): SessionFixtureRegistry {
  const trackedById = new Map<JourneyTrackedTable, Set<number>>(
    JOURNEY_TRACKED_TABLE_DELETE_ORDER.map(table => [table, new Set<number>()])
  );

  const track = (table: JourneyTrackedTable, id: number): void => {
    const bucket = trackedById.get(table);
    if (!bucket) {
      throw new Error(`journey fixture registry: unknown tracked table "${table}"`);
    }
    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error(
        `journey fixture registry: "${table}" row id must be a positive safe integer, received ${String(id)}`
      );
    }
    bucket.add(id);
  };

  const ids = (table: JourneyTrackedTable): readonly number[] => {
    const bucket = trackedById.get(table);
    if (!bucket) {
      throw new Error(`journey fixture registry: unknown tracked table "${table}"`);
    }
    return [...bucket];
  };

  const cleanup = async (): Promise<void> => {
    await db.transaction(async tx => {
      // Recursive helper — avoids `no-await-in-loop` (deletes are sequential
      // by design: FK-safe order). Depth is bounded by the fixed table list.
      const deleteNext = async (index: number): Promise<void> => {
        if (index >= JOURNEY_TRACKED_TABLE_DELETE_ORDER.length) {
          return;
        }
        const table = JOURNEY_TRACKED_TABLE_DELETE_ORDER[index];
        const bucket = trackedById.get(table);
        if (bucket && bucket.size > 0) {
          await deleteTrackedRows(tx, table, bucket);
        }
        await deleteNext(index + 1);
      };
      await deleteNext(0);
    });
    // Clear only after the deleting transaction committed — a failed cleanup
    // keeps its worklist so a retry still removes everything.
    for (const bucket of trackedById.values()) {
      bucket.clear();
    }
  };

  return {
    track,
    trackAll(table, idsToTrack) {
      for (const id of idsToTrack) {
        track(table, id);
      }
    },
    ids,
    trackedCount() {
      let total = 0;
      for (const bucket of trackedById.values()) {
        total += bucket.size;
      }
      return total;
    },
    cleanup,
  };
}

/**
 * Row-count oracles for the side-effect-absence assertions (row-count deltas).
 * Each counter is scoped to one fixture user's rows, so pre-existing data in
 * the shared test database can never satisfy or break a delta assertion.
 */

/** Number of persisted `notifications` rows targeting one user. */
export async function countNotificationsForUser(userId: number): Promise<number> {
  return db.$count(notifications, eq(notifications.userId, userId));
}

/** Number of `audit_logs` rows acted by one admin user (immutable table). */
export async function countAuditLogsForActor(actorUserId: number): Promise<number> {
  return db.$count(auditLogs, eq(auditLogs.actorId, actorUserId));
}

/** Number of `wallet` rows owned by one teacher (shared PK: teacher.id = users.id). */
export async function countWalletsForTeacher(teacherUserId: number): Promise<number> {
  return db.$count(wallet, eq(wallet.teacherId, teacherUserId));
}

/**
 * Number of `teacher_transaction` ledger rows belonging to one teacher
 * (joined through the teacher's wallet — the ledger itself is keyed by
 * wallet, not user). Immutable table: assert ZERO, never clean.
 */
export async function countTeacherTransactionsForTeacher(teacherUserId: number): Promise<number> {
  const rows = await db
    .select({ id: teacherTransaction.id })
    .from(teacherTransaction)
    .innerJoin(wallet, eq(teacherTransaction.walletId, wallet.id))
    .where(eq(wallet.teacherId, teacherUserId));
  return rows.length;
}
