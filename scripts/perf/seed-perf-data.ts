/**
 * Bulk performance-data seeder for the test database.
 *
 * One invocation builds a production-shaped, prefix-isolated dataset —
 * certified online teachers (browsable by the real matching pipeline, with
 * a hot subset carrying started sessions), funded students, an admin,
 * wallet/plan/subscription rows, and session/notification volumes — and
 * writes the run manifest that the cleanup tool consumes exclusively.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST: the resolved DATABASE_URL
 *     must name the test database or the process refuses (exit 2) before any
 *     database client is constructed. The database client module is imported
 *     dynamically only after the guard has allowed the run.
 *  2. A preflight prefix probe refuses (exit 2) when the run id already has
 *     rows in the database, so a re-run can never double-seed a prefix and a
 *     concurrent second seeder holding the same prefix cannot interleave.
 *  3. The manifest is written BEFORE the first insert (with a null
 *     completion timestamp) and finalized after the last one, so a crashed
 *     run stays discoverable and removable.
 *
 * Volume tables are seeded through chunked multi-row inserts — never
 * row-by-row helpers — while row shapes follow the repo's entity-setup
 * conventions. Every synthetic identifier carries the run prefix
 * (`perf_<runId>_`).
 *
 * Exit codes: 0 = seeded, 2 = usage refusal / guard refusal / prefix
 * collision, 1 = runtime failure.
 */

import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { hashPassword } from "@/backend/lib/auth/password";
import { assertTestDatabaseTarget, type DatabaseTargetOk } from "@/scripts/perf/lib/db-target-guard";
import { openRunDirectory } from "@/scripts/perf/lib/report";
import {
  buildAdminUserRow,
  buildPlanRows,
  buildStudentRoleRows,
  buildTeacherRoleRows,
  buildWalletRows,
  generateStudentUserRows,
  generateTeacherUserRows,
} from "@/scripts/perf/lib/seed-builders";
import { isSeedCliUsageError, parseSeedCli, type SeedCliOptions } from "@/scripts/perf/lib/seed-cli";
import { DrizzleSeedDatabase } from "@/scripts/perf/lib/seed-drizzle";
import { MANIFEST_FILENAME, replaceManifestFile, writeManifestFile } from "@/scripts/perf/lib/seed-manifest-file";
import { buildRunPassword, buildSeedPrefix, createSeededRandom } from "@/scripts/perf/lib/seed-random";
import {
  buildPrefixedLikePattern,
  buildSeedManifest,
  SEED_PLAN_COUNT,
  type SeedDatabase,
  type SeedManifest,
  type SeedManifestCounts,
} from "@/scripts/perf/lib/seed-shapes";
import {
  computeHotSessionCount,
  generateNotificationRows,
  generateSessionRows,
  generateSubscriptionRows,
} from "@/scripts/perf/lib/seed-volume-rows";

const SCRIPT_LABEL = "perf:seed";
const EXIT_USAGE = 2;

export type { SeedCliOptions } from "@/scripts/perf/lib/seed-cli";
export { parseSeedCli } from "@/scripts/perf/lib/seed-cli";
export { MANIFEST_FILENAME, replaceManifestFile, writeManifestFile } from "@/scripts/perf/lib/seed-manifest-file";

/** Environment + effectful seams the seed run orchestrates over. */
export interface SeedIo {
  env(): { databaseUrl: string };
  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): DatabaseTargetOk;
  connectDatabase(): Promise<SeedDatabase>;
  closeDatabase(): Promise<void>;
  openRunDirectory(): string;
  writeManifest(runDir: string, manifest: SeedManifest): void;
  finalizeManifest(runDir: string, manifest: SeedManifest): void;
  hashPassword(plaintext: string): Promise<string>;
  now(): Date;
  randomRunId(): string;
  log(message: string): void;
}

/** Terminal outcome of a seed run: either a completed manifest or a prefix collision refusal. */
export type SeedRunOutcome =
  | { status: "seeded"; manifest: SeedManifest; runDir: string }
  | { status: "collision"; runId: string; prefix: string };

/** Everything the people-and-catalog insert step produces. */
interface SeededPeople {
  readonly teacherUserIds: number[];
  readonly studentUserIds: number[];
  readonly adminUserIds: number[];
  readonly planIds: number[];
  readonly counts: Pick<SeedManifestCounts, "users" | "teacher" | "student" | "wallet" | "plan">;
}

/** Inserts the teacher/student/admin accounts, their role-child rows, wallets, and the plan catalog. */
async function insertPeopleAndPlans(
  database: SeedDatabase,
  options: SeedCliOptions,
  prefix: string,
  passwordHash: string,
  startedAt: Date,
  seedKey: string
): Promise<SeededPeople> {
  const teacherUserIds = await database.insertUsers(
    generateTeacherUserRows(
      prefix,
      options.teachers,
      passwordHash,
      startedAt,
      createSeededRandom(`${seedKey}:teacher-users`)
    )
  );
  const teacherCount = await database.insertTeacherRoles(
    buildTeacherRoleRows(teacherUserIds, createSeededRandom(`${seedKey}:teacher-roles`))
  );
  const walletCount = await database.insertWallets(buildWalletRows(teacherUserIds));
  const studentUserIds = await database.insertUsers(
    generateStudentUserRows(
      prefix,
      options.students,
      passwordHash,
      startedAt,
      createSeededRandom(`${seedKey}:student-users`)
    )
  );
  const studentCount = await database.insertStudentRoles(
    buildStudentRoleRows(prefix, studentUserIds, createSeededRandom(`${seedKey}:student-roles`))
  );
  const adminUserIds = await database.insertUsers([buildAdminUserRow(prefix, passwordHash, startedAt)]);
  await database.insertAdminRoles(adminUserIds);
  const planIds = await database.insertPlans(buildPlanRows(prefix));
  return {
    teacherUserIds,
    studentUserIds,
    adminUserIds,
    planIds,
    counts: {
      users: teacherUserIds.length + studentUserIds.length + adminUserIds.length,
      teacher: teacherCount,
      student: studentCount,
      wallet: walletCount,
      plan: planIds.length,
    },
  };
}

/** Inserts the subscription, session, and notification volumes; returns their actual counts. */
async function insertVolumeRows(
  database: SeedDatabase,
  options: SeedCliOptions,
  people: SeededPeople,
  prefix: string,
  startedAt: Date,
  seedKey: string
): Promise<Pick<SeedManifestCounts, "session" | "notification" | "subscription">> {
  const subscriptionCount = await database.insertSubscriptions(
    generateSubscriptionRows({
      studentIds: people.studentUserIds,
      planIds: people.planIds,
      count: options.subscriptions,
      prefix,
      now: startedAt,
      random: createSeededRandom(`${seedKey}:subscriptions`),
    })
  );
  const sessionIds = await database.insertSessions(
    generateSessionRows({
      teacherIds: people.teacherUserIds,
      hotTeacherCount: options.hotTeachers,
      studentIds: people.studentUserIds,
      count: options.sessions,
      now: startedAt,
      random: createSeededRandom(`${seedKey}:sessions`),
    })
  );
  const notificationCount = await database.insertNotifications(
    generateNotificationRows({
      userIds: [...people.teacherUserIds, ...people.studentUserIds, ...people.adminUserIds],
      sessionIds,
      count: options.notifications,
      prefix,
      now: startedAt,
      random: createSeededRandom(`${seedKey}:notifications`),
    })
  );
  return { session: sessionIds.length, notification: notificationCount, subscription: subscriptionCount };
}

/** Counts the run intends to create before any insert runs (crash-discoverability manifest). */
function plannedCounts(options: SeedCliOptions): SeedManifestCounts {
  return {
    users: options.teachers + options.students + 1,
    teacher: options.teachers,
    student: options.students,
    session: options.sessions,
    notification: options.notifications,
    subscription: options.subscriptions,
    wallet: options.teachers,
    plan: SEED_PLAN_COUNT,
  };
}

/** Writes the pre-insert manifest (crash discoverability) and opens the run directory. */
function beginRunRecord(
  io: SeedIo,
  options: SeedCliOptions,
  target: { dbName: string },
  runId: string,
  prefix: string,
  passwordHash: string,
  startedAt: Date
): string {
  const runDir = io.openRunDirectory();
  io.writeManifest(
    runDir,
    buildSeedManifest({
      runId,
      prefix,
      startedAt,
      completedAt: null,
      database: target.dbName,
      volumes: { teachers: options.teachers, students: options.students, hotTeachers: options.hotTeachers },
      counts: plannedCounts(options),
      passwordHash,
    })
  );
  return runDir;
}

/**
 * Drives one complete seed run. The guard is the first effectful call and
 * the database connection the second; a guard refusal (thrown by the wired
 * guard implementation) propagates before any of the remaining seams run.
 */
export async function runSeedRun(options: SeedCliOptions, io: SeedIo): Promise<SeedRunOutcome> {
  const target = io.assertTarget(io.env().databaseUrl, { forceFlag: options.forceProdShapedTarget });
  const runId = options.runId ?? io.randomRunId();
  const prefix = buildSeedPrefix(runId);
  const database = await io.connectDatabase();
  try {
    const existingUsers = await database.countUsersWithEmailLike(buildPrefixedLikePattern(prefix));
    if (existingUsers > 0) {
      return { status: "collision", runId, prefix };
    }
    const startedAt = io.now();
    const passwordHash = await io.hashPassword(buildRunPassword(runId));
    const runDir = beginRunRecord(io, options, target, runId, prefix, passwordHash, startedAt);
    const seedKey = `${runId}:${options.seed}`;
    const people = await insertPeopleAndPlans(database, options, prefix, passwordHash, startedAt, seedKey);
    const volumeCounts = await insertVolumeRows(database, options, people, prefix, startedAt, seedKey);
    const counts: SeedManifestCounts = { ...people.counts, ...volumeCounts };
    const manifest = buildSeedManifest({
      runId,
      prefix,
      startedAt,
      completedAt: io.now(),
      database: target.dbName,
      volumes: { teachers: options.teachers, students: options.students, hotTeachers: options.hotTeachers },
      counts,
      passwordHash,
    });
    io.finalizeManifest(runDir, manifest);
    logSeedSummary(io, target.dbName, runId, prefix, counts, options);
    return { status: "seeded", manifest, runDir };
  } finally {
    await io.closeDatabase();
  }
}

/** Prints the operator-facing run summary. */
function logSeedSummary(
  io: SeedIo,
  dbName: string,
  runId: string,
  prefix: string,
  counts: SeedManifestCounts,
  options: SeedCliOptions
): void {
  io.log(`${SCRIPT_LABEL}: run ${runId} seeded against ${dbName}`);
  io.log(`${SCRIPT_LABEL}: prefix ${prefix}`);
  io.log(
    `${SCRIPT_LABEL}: users ${counts.users} (teachers ${counts.teacher}, students ${counts.student}), ` +
      `sessions ${counts.session}, notifications ${counts.notification}, subscriptions ${counts.subscription}, ` +
      `wallets ${counts.wallet}, plans ${counts.plan}, hot sessions ${computeHotSessionCount(options.sessions, options.hotTeachers)}`
  );
}

/** Wires the real seams: the destructive-target guard, the lazily imported database client, and the run-directory conventions. */
function createRealIo(): SeedIo {
  return {
    env: () => ({ databaseUrl: process.env.DATABASE_URL ?? "" }),
    assertTarget: (databaseUrl, opts) => assertTestDatabaseTarget(databaseUrl, opts),
    connectDatabase: async () => {
      const { db } = await import("@/backend/db/client");
      return new DrizzleSeedDatabase(db);
    },
    closeDatabase: async () => {
      const { closePool } = await import("@/backend/db/client");
      await closePool();
    },
    openRunDirectory: () => openRunDirectory("seed").runDir,
    writeManifest: (runDir, manifest) => writeManifestFile(join(runDir, MANIFEST_FILENAME), manifest),
    finalizeManifest: (runDir, manifest) => replaceManifestFile(join(runDir, MANIFEST_FILENAME), manifest),
    hashPassword,
    now: () => new Date(),
    randomRunId: () => randomBytes(4).toString("hex"),
    log: message => console.log(message),
  };
}

async function main(): Promise<void> {
  const parsed = parseSeedCli(process.argv.slice(2));
  if (isSeedCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  try {
    const outcome = await runSeedRun(parsed, createRealIo());
    if (outcome.status === "collision") {
      console.error(
        `${SCRIPT_LABEL}: run "${outcome.runId}" already has seeded rows under prefix "${outcome.prefix}".`
      );
      console.error(`${SCRIPT_LABEL}: run perf:cleanup --run ${outcome.runId} first, or pass a fresh --run-id.`);
      process.exit(EXIT_USAGE);
    }
  } catch (error) {
    console.error(`${SCRIPT_LABEL}: seeding failed: ${error instanceof Error ? error.message : String(error)}`);
    console.error(`${SCRIPT_LABEL}: partial rows (if any) stay discoverable by the run prefix and the run manifest.`);
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
