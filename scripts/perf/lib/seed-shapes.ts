/**
 * Shape contracts for the performance-data seeder.
 *
 * This module owns the seeder's data contracts and nothing else: the row
 * types (structurally identical to the Drizzle insert models they feed),
 * the volume/batch constants, the manifest document shape, the database
 * seam interface the orchestrator drives, and the streaming batch-insert
 * helpers that enforce the bulk-write discipline.
 *
 * Everything here is pure — no filesystem, no database, no clock. The row
 * builders live in sibling modules (`seed-random`, `seed-builders`,
 * `seed-volume-rows`); the real database adapter lives in `seed-drizzle`.
 */

import type { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import type { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import type { HeldBalanceLane } from "@/backend/enum/scheduling/held-balance-lane.enum";
import type { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import { escapeLikeWildcards } from "@/backend/lib/db/escape-like-wildcards";
import { adminEmail, studentEmail, teacherEmail } from "@/scripts/perf/lib/seed-random";

/** CLI defaults for the seed volumes (operators can override each knob). */
export const SEED_DEFAULTS = {
  teachers: 2000,
  students: 120,
  sessions: 5000,
  notifications: 20000,
  subscriptions: 500,
  hotTeachers: 8,
} as const;

/** Upper bound accepted for any volume knob (usage errors above this). */
export const MAX_ENTITY_COUNT = 1_000_000;

/** Upper bound accepted for the numeric determinism seed. */
export const MAX_SEED_VALUE = 2_000_000_000;

/** Maximum rows per multi-row INSERT statement (volume tables are chunked). */
export const INSERT_BATCH_SIZE = 500;

/** Run ids are exactly eight lowercase hex characters. */
export const RUN_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Number of catalog plans every run seeds (one per balance lane). */
export const SEED_PLAN_COUNT = 3;

/** Role colors accepted by the `users.role` column. */
export type SeedUserRole = "admin" | "teacher" | "student" | "parent";
/** Locale colors accepted by the `users.locale` column. */
export type SeedLocale = "ar" | "en";
/** Gender colors accepted by the `users.gender` column. */
export type SeedGender = "male" | "female";
/** Session status colors the seeder produces. */
export type SeedSessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];
/** Subscription status colors the seeder produces. */
export type SeedSubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];
/** Notification type colors accepted by the `notifications.type` column. */
export type SeedNotificationType = (typeof NotificationType)[keyof typeof NotificationType];
/** Plan balance-lane colors. */
export type SeedBalanceLane = "hifz" | "tajweed" | "reviews";

/** One `users` row (any role) as the seeder produces it. */
export interface UserSeedRow {
  readonly fullName: string;
  readonly email: string;
  readonly phone: string;
  readonly passwordHash: string;
  readonly mustChangePassword: boolean;
  readonly role: SeedUserRole;
  readonly dateOfBirth: string;
  readonly gender: SeedGender;
  readonly country: string;
  readonly countryCode: string;
  readonly locale: SeedLocale;
  readonly isDeleted: boolean;
  readonly suspended: boolean;
  readonly isBlocked: boolean;
  readonly lastActiveAt: Date;
}

/** One `teacher` role-child row. */
export interface TeacherRoleSeedRow {
  readonly id: number;
  readonly isApproved: boolean;
  readonly isEvaluator: boolean;
  readonly isOnline: boolean;
  readonly averageRating: string | null;
  readonly subjects: string;
  readonly recitations: string;
  readonly languages: string;
}

/** One `students` role-child row. */
export interface StudentRoleSeedRow {
  readonly id: number;
  readonly balanceHifz: number;
  readonly balanceReviews: number;
  readonly balanceTajweed: number;
  readonly balanceTrial: number;
  readonly handshakeCode: string;
  readonly primaryLanguage: string;
}

/** One `wallet` row (teacher-owned escrow balance). */
export interface WalletSeedRow {
  readonly teacherId: number;
  readonly balance: string;
  readonly totalEarning: string;
}

/** One `plans` catalog row. */
export interface PlanSeedRow {
  readonly title: string;
  readonly sessionCount: number;
  readonly price: string;
  readonly currency: string;
  readonly intervalDays: number;
  readonly balanceLane: SeedBalanceLane;
  readonly isActive: boolean;
}

/** One `subscriptions` row. */
export interface SubscriptionSeedRow {
  readonly userId: number;
  readonly planId: number;
  readonly status: SeedSubscriptionStatus;
  readonly startDate: Date | null;
  readonly endDate: Date | null;
  readonly paymentMethod: "offline_cash" | null;
  readonly paymentReference: string | null;
  readonly paymentVerifiedAt: Date | null;
}

/** One `session` row. */
export interface SessionSeedRow {
  readonly teacherId: number;
  readonly studentId: number;
  readonly status: SeedSessionStatus;
  readonly sessionType: "student_session";
  readonly intent: "hifz" | "tajweed";
  readonly fee: string;
  readonly feeHeld: boolean;
  readonly heldBalanceLane: HeldBalanceLane | null;
  readonly startedAt: Date | null;
  readonly endedAt: Date | null;
  readonly confirmationDeadline: Date | null;
}

/** One `notifications` row. */
export interface NotificationSeedRow {
  readonly userId: number;
  readonly type: SeedNotificationType;
  readonly title: string;
  readonly body: string;
  readonly isRead: boolean;
  readonly relatedEntityType: string | null;
  readonly relatedEntityId: number | null;
  readonly createdAt: Date;
}

/** Per-table created counts recorded in the seed manifest. */
export interface SeedManifestCounts {
  readonly users: number;
  readonly teacher: number;
  readonly student: number;
  readonly session: number;
  readonly notification: number;
  readonly subscription: number;
  readonly wallet: number;
  readonly plan: number;
}

/** Identity inventory cleanup and downstream load tools consume. */
export interface SeedManifestIdentities {
  readonly studentEmails: readonly string[];
  readonly adminEmails: readonly string[];
  readonly wsIdentityEmails: readonly string[];
  readonly hotTeacherEmails: readonly string[];
  readonly passwordHash: string;
  readonly passwordNote: string;
}

/** The `seed-manifest.json` document — the run's exclusive write-scope contract. */
export interface SeedManifest {
  readonly runId: string;
  readonly prefix: string;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly database: string;
  readonly tables: readonly string[];
  readonly counts: SeedManifestCounts;
  readonly identities: SeedManifestIdentities;
}

/** Tables the seeder writes, in FK-safe deletion order (children first, users last). */
export const SEED_MANIFEST_TABLES = [
  "notifications",
  "session",
  "subscriptions",
  "wallet",
  "plans",
  "teacher",
  "students",
  "admin",
  "users",
] as const;

/**
 * The database seam the seeder orchestrates over. The real implementation
 * chunks every volume insert through multi-row statements; tests provide an
 * in-memory fake that records every call.
 */
export interface SeedDatabase {
  countUsersWithEmailLike(pattern: string): Promise<number>;
  insertUsers(rows: Iterable<UserSeedRow>): Promise<number[]>;
  insertTeacherRoles(rows: Iterable<TeacherRoleSeedRow>): Promise<number>;
  insertStudentRoles(rows: Iterable<StudentRoleSeedRow>): Promise<number>;
  insertAdminRoles(userIds: readonly number[]): Promise<number>;
  insertWallets(rows: Iterable<WalletSeedRow>): Promise<number>;
  insertPlans(rows: readonly PlanSeedRow[]): Promise<number[]>;
  insertSubscriptions(rows: Iterable<SubscriptionSeedRow>): Promise<number>;
  insertSessions(rows: Iterable<SessionSeedRow>): Promise<number[]>;
  insertNotifications(rows: Iterable<NotificationSeedRow>): Promise<number>;
}

/**
 * Assembles the seed manifest document from the run's facts. The identities
 * lists are derived from the run volumes (emails are a pure function of the
 * prefix and row index), so the manifest is reconstructible without holding
 * every generated row in memory.
 */
export function buildSeedManifest(params: {
  readonly runId: string;
  readonly prefix: string;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly database: string;
  readonly volumes: { readonly teachers: number; readonly students: number; readonly hotTeachers: number };
  readonly counts: SeedManifestCounts;
  readonly passwordHash: string;
}): SeedManifest {
  const { runId, prefix, startedAt, completedAt, database, volumes, counts, passwordHash } = params;
  const studentEmails: string[] = [];
  for (let index = 0; index < volumes.students; index += 1) {
    studentEmails.push(studentEmail(prefix, index));
  }
  const hotTeacherEmails: string[] = [];
  for (let index = 0; index < volumes.hotTeachers; index += 1) {
    hotTeacherEmails.push(teacherEmail(prefix, index));
  }
  return {
    runId,
    prefix,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt === null ? null : completedAt.toISOString(),
    database,
    tables: SEED_MANIFEST_TABLES,
    counts,
    identities: {
      studentEmails,
      adminEmails: [adminEmail(prefix)],
      wsIdentityEmails: buildWsIdentityEmails(prefix, volumes.students, volumes.teachers),
      hotTeacherEmails,
      passwordHash,
      passwordNote:
        "deterministically derived from the persisted run id (derivable by design); manifest stores the bcrypt hash only — acceptable because the guard confines perf identities to the kottaby_test database and the manifest is owner-only (0600)",
    },
  };
}

/**
 * Identity list for the websocket stability harness: the admin plus as many
 * students as possible, topped up with teacher emails, capped at 25 — enough
 * for the connection cap math at every supported volume.
 */
export function buildWsIdentityEmails(prefix: string, studentCount: number, teacherCount: number): string[] {
  const emails = [adminEmail(prefix)];
  for (let index = 0; index < studentCount && emails.length < 25; index += 1) {
    emails.push(studentEmail(prefix, index));
  }
  for (let index = 0; index < teacherCount && emails.length < 25; index += 1) {
    emails.push(teacherEmail(prefix, index));
  }
  return emails;
}

/**
 * Streams a row source into fixed-size multi-row batches: at most
 * `batchSize` rows are materialized at any moment, and one `insertBatch`
 * call is issued per full batch (plus a final partial batch). This is the
 * seeder's bulk-insert discipline — volume tables are never written
 * row-by-row and never fully materialized.
 */
export async function insertInBatches<TRow>(
  rows: Iterable<TRow>,
  batchSize: number,
  insertBatch: (batch: readonly TRow[]) => Promise<void>
): Promise<number> {
  const iterator = rows[Symbol.iterator]();
  const drainNext = async (): Promise<number> => {
    const batch = takeBatch(iterator, batchSize);
    if (batch.length === 0) {
      return 0;
    }
    await insertBatch(batch);
    return batch.length + (await drainNext());
  };
  return drainNext();
}

/** Streaming batch insert that also collects the database-assigned ids row by row. */
export async function insertInBatchesReturningIds<TRow>(
  rows: Iterable<TRow>,
  batchSize: number,
  insertBatch: (batch: readonly TRow[]) => Promise<number[]>
): Promise<number[]> {
  const iterator = rows[Symbol.iterator]();
  const drainNext = async (): Promise<number[]> => {
    const batch = takeBatch(iterator, batchSize);
    if (batch.length === 0) {
      return [];
    }
    const ids = await insertBatch(batch);
    return [...ids, ...(await drainNext())];
  };
  return drainNext();
}

/** Pulls at most `batchSize` rows from the iterator without materializing more. */
function takeBatch<TRow>(iterator: Iterator<TRow>, batchSize: number): TRow[] {
  const batch: TRow[] = [];
  while (batch.length < batchSize) {
    const next = iterator.next();
    if (next.done) {
      break;
    }
    batch.push(next.value);
  }
  return batch;
}

/** LIKE pattern that matches every identifier carrying the run prefix (wildcards escaped). */
export function buildPrefixedLikePattern(prefix: string): string {
  return `${escapeLikeWildcards(prefix)}%`;
}
