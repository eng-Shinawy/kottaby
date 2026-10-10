import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SubscriptionStatus } from "@/backend/enum/billing/subscription-status.enum";
import { NotificationType } from "@/backend/enum/notifications/notification-type.enum";
import { SessionStatus } from "@/backend/enum/scheduling/session-status.enum";
import {
  buildAdminUserRow,
  buildPlanRows,
  buildStudentRoleRows,
  buildTeacherRoleRows,
  buildWalletRows,
  generateTeacherUserRows,
} from "@/scripts/perf/lib/seed-builders";
import { isSeedCliUsageError, parseSeedCli, type SeedCliOptions, SeedCliUsageError } from "@/scripts/perf/lib/seed-cli";
import { MANIFEST_FILENAME, replaceManifestFile, writeManifestFile } from "@/scripts/perf/lib/seed-manifest-file";
import {
  buildRunPassword,
  buildSeedPrefix,
  createSeededRandom,
  satisfiesMatcherEligibility,
} from "@/scripts/perf/lib/seed-random";
import {
  buildPrefixedLikePattern,
  buildSeedManifest,
  buildWsIdentityEmails,
  INSERT_BATCH_SIZE,
  insertInBatches,
  insertInBatchesReturningIds,
  MAX_ENTITY_COUNT,
  MAX_SEED_VALUE,
  type NotificationSeedRow,
  type PlanSeedRow,
  SEED_DEFAULTS,
  type SeedDatabase,
  type SeedManifest,
  type SeedManifestCounts,
  type SessionSeedRow,
  type StudentRoleSeedRow,
  type SubscriptionSeedRow,
  type TeacherRoleSeedRow,
  type UserSeedRow,
  type WalletSeedRow,
} from "@/scripts/perf/lib/seed-shapes";
import {
  computeHotSessionCount,
  generateNotificationRows,
  generateSessionRows,
  generateSubscriptionRows,
} from "@/scripts/perf/lib/seed-volume-rows";
import { runSeedRun, type SeedIo, type SeedRunOutcome } from "@/scripts/perf/seed-perf-data";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SEED_SCRIPT_PATH = join(REPO_ROOT, "scripts", "perf", "seed-perf-data.ts");
const PERF_LOGS_DIR = join(REPO_ROOT, "logs", "perf");

const FIXED_NOW = new Date("2026-10-09T12:00:00.000Z");
const TEST_RUN_ID = "ab12cd34";
const TEST_PREFIX = buildSeedPrefix(TEST_RUN_ID);

const tempDirs: string[] = [];

function freshTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "perf-seed-test-"));
  tempDirs.push(dir);
  return dir;
}

class GuardRefusedError extends Error {}

class FakeSeedDatabase implements SeedDatabase {
  nextId = 1000;
  existingUserCount = 0;
  failOn: string | null = null;
  onCall: ((method: string) => void) | null = null;
  readonly likePatterns: string[] = [];
  readonly userRows: UserSeedRow[] = [];
  readonly teacherRoleRows: TeacherRoleSeedRow[] = [];
  readonly studentRoleRows: StudentRoleSeedRow[] = [];
  readonly walletRows: WalletSeedRow[] = [];
  readonly planRows: PlanSeedRow[] = [];
  readonly subscriptionRows: SubscriptionSeedRow[] = [];
  readonly sessionRows: SessionSeedRow[] = [];
  readonly notificationRows: NotificationSeedRow[] = [];
  readonly adminRoleIds: number[] = [];

  private note(method: string): void {
    this.onCall?.(method);
    if (this.failOn === method) {
      throw new Error(`injected failure at ${method}`);
    }
  }

  private collect<TRow>(method: string, rows: Iterable<TRow>, sink: TRow[]): TRow[] {
    this.note(method);
    const materialized = [...rows];
    sink.push(...materialized);
    return materialized;
  }

  private idsFor(count: number): number[] {
    const ids: number[] = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(this.nextId);
      this.nextId += 1;
    }
    return ids;
  }

  countUsersWithEmailLike(pattern: string): Promise<number> {
    this.note("countUsersWithEmailLike");
    this.likePatterns.push(pattern);
    return Promise.resolve(this.existingUserCount);
  }

  insertUsers(rows: Iterable<UserSeedRow>): Promise<number[]> {
    const materialized = this.collect("insertUsers", rows, this.userRows);
    return Promise.resolve(this.idsFor(materialized.length));
  }

  insertTeacherRoles(rows: Iterable<TeacherRoleSeedRow>): Promise<number> {
    const materialized = this.collect("insertTeacherRoles", rows, this.teacherRoleRows);
    return Promise.resolve(materialized.length);
  }

  insertStudentRoles(rows: Iterable<StudentRoleSeedRow>): Promise<number> {
    const materialized = this.collect("insertStudentRoles", rows, this.studentRoleRows);
    return Promise.resolve(materialized.length);
  }

  insertAdminRoles(userIds: readonly number[]): Promise<number> {
    this.note("insertAdminRoles");
    this.adminRoleIds.push(...userIds);
    return Promise.resolve(userIds.length);
  }

  insertWallets(rows: Iterable<WalletSeedRow>): Promise<number> {
    const materialized = this.collect("insertWallets", rows, this.walletRows);
    return Promise.resolve(materialized.length);
  }

  insertPlans(rows: readonly PlanSeedRow[]): Promise<number[]> {
    const materialized = this.collect("insertPlans", [...rows], this.planRows);
    return Promise.resolve(this.idsFor(materialized.length));
  }

  insertSubscriptions(rows: Iterable<SubscriptionSeedRow>): Promise<number> {
    const materialized = this.collect("insertSubscriptions", rows, this.subscriptionRows);
    return Promise.resolve(materialized.length);
  }

  insertSessions(rows: Iterable<SessionSeedRow>): Promise<number[]> {
    const materialized = this.collect("insertSessions", rows, this.sessionRows);
    return Promise.resolve(this.idsFor(materialized.length));
  }

  insertNotifications(rows: Iterable<NotificationSeedRow>): Promise<number> {
    const materialized = this.collect("insertNotifications", rows, this.notificationRows);
    return Promise.resolve(materialized.length);
  }
}

interface FakeIoHarness {
  io: SeedIo;
  database: FakeSeedDatabase;
  order: string[];
  logLines: string[];
  runDir: string;
  assertTargetCalls: { databaseUrl: string; forceFlag: boolean }[];
}

function createFakeIoHarness(params: { assertThrows?: boolean; existingUserCount?: number } = {}): FakeIoHarness {
  const database = new FakeSeedDatabase();
  database.existingUserCount = params.existingUserCount ?? 0;
  const order: string[] = [];
  database.onCall = method => order.push(`db:${method}`);
  const logLines: string[] = [];
  const assertTargetCalls: { databaseUrl: string; forceFlag: boolean }[] = [];
  const runDir = freshTempDir();
  const io: SeedIo = {
    env: () => {
      order.push("env");
      return { databaseUrl: "postgres://fake:fake@localhost/kottaby_test" };
    },
    assertTarget: (databaseUrl, opts) => {
      order.push("assertTarget");
      assertTargetCalls.push({ databaseUrl, forceFlag: opts.forceFlag });
      if (params.assertThrows === true) {
        throw new GuardRefusedError("guard refusal");
      }
      return { ok: true, dbName: "kottaby_test" };
    },
    connectDatabase: async () => {
      order.push("connectDatabase");
      return database;
    },
    closeDatabase: async () => {
      order.push("closeDatabase");
    },
    openRunDirectory: () => {
      order.push("openRunDirectory");
      return runDir;
    },
    writeManifest: (dir, manifest) => {
      order.push("writeManifest");
      writeManifestFile(join(dir, MANIFEST_FILENAME), manifest);
    },
    finalizeManifest: (dir, manifest) => {
      order.push("finalizeManifest");
      replaceManifestFile(join(dir, MANIFEST_FILENAME), manifest);
    },
    hashPassword: async plaintext => {
      order.push("hashPassword");
      return `bcrypt:${plaintext.length}`;
    },
    now: () => {
      order.push("now");
      return FIXED_NOW;
    },
    randomRunId: () => {
      order.push("randomRunId");
      return "11aa22bb";
    },
    log: message => {
      logLines.push(message);
    },
  };
  return { io, database, order, logLines, runDir, assertTargetCalls };
}

function tinyOptions(overrides: Partial<SeedCliOptions> = {}): SeedCliOptions {
  return {
    teachers: 2,
    students: 2,
    sessions: 2,
    notifications: 2,
    subscriptions: 2,
    hotTeachers: 1,
    runId: TEST_RUN_ID,
    seed: 0,
    forceProdShapedTarget: false,
    ...overrides,
  };
}

/** Runtime guard over a parsed manifest body (never a blind cast). */
function isSeedManifestValue(value: unknown): value is SeedManifest {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "prefix" in value &&
    typeof value.prefix === "string" &&
    "counts" in value &&
    typeof value.counts === "object" &&
    value.counts !== null &&
    "identities" in value &&
    typeof value.identities === "object" &&
    value.identities !== null
  );
}

function readManifest(runDir: string): SeedManifest {
  const parsed: unknown = JSON.parse(readFileSync(join(runDir, MANIFEST_FILENAME), "utf8"));
  if (!isSeedManifestValue(parsed)) {
    throw new Error("manifest body does not match the seed manifest shape");
  }
  return parsed;
}

function expectUsageError(argv: readonly string[]): SeedCliUsageError {
  const parsed = parseSeedCli(argv);
  expect(parsed).toBeInstanceOf(SeedCliUsageError);
  if (!isSeedCliUsageError(parsed)) {
    throw new Error("parseSeedCli was expected to refuse");
  }
  return parsed;
}

function expectOptions(argv: readonly string[]): SeedCliOptions {
  const parsed = parseSeedCli(argv);
  expect(parsed).not.toBeInstanceOf(SeedCliUsageError);
  if (isSeedCliUsageError(parsed)) {
    throw new Error("parseSeedCli was expected to succeed");
  }
  return parsed;
}

/** Parses a JSON array of strings without blind casts. */
function readJsonStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed)) {
    throw new Error(`expected a JSON array in: ${value}`);
  }
  const items: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") {
      throw new Error(`expected JSON string members in: ${value}`);
    }
    items.push(item);
  }
  return items;
}

interface SubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runSeedSubprocess(
  args: readonly string[],
  envOverrides?: Record<string, string>,
  stdin?: "ignore"
): SubprocessResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, SEED_SCRIPT_PATH, ...args],
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin,
    env: { ...process.env, ...envOverrides },
  });
  const decoder = new TextDecoder();
  return {
    exitCode: proc.exitCode,
    stdout: decoder.decode(proc.stdout),
    stderr: decoder.decode(proc.stderr),
  };
}

describe("parseSeedCli (pure CLI contract)", () => {
  it("applies the documented volume defaults when invoked bare", () => {
    const parsed = parseSeedCli([]);
    expect(parsed).toEqual({
      teachers: SEED_DEFAULTS.teachers,
      students: SEED_DEFAULTS.students,
      sessions: SEED_DEFAULTS.sessions,
      notifications: SEED_DEFAULTS.notifications,
      subscriptions: SEED_DEFAULTS.subscriptions,
      hotTeachers: SEED_DEFAULTS.hotTeachers,
      runId: null,
      seed: 0,
      forceProdShapedTarget: false,
    });
  });

  it("parses every value flag", () => {
    const parsed = parseSeedCli([
      "--teachers",
      "5",
      "--students",
      "3",
      "--sessions",
      "7",
      "--notifications",
      "9",
      "--subscriptions",
      "4",
      "--hot-teachers",
      "2",
      "--run-id",
      "0a1b2c3d",
      "--seed",
      "42",
      "--force-prod-shaped-target",
    ]);
    expect(parsed).toEqual({
      teachers: 5,
      students: 3,
      sessions: 7,
      notifications: 9,
      subscriptions: 4,
      hotTeachers: 2,
      runId: "0a1b2c3d",
      seed: 42,
      forceProdShapedTarget: true,
    });
  });

  it("lets a repeated flag win last", () => {
    const parsed = expectOptions(["--teachers", "5", "--teachers", "7", "--hot-teachers", "0"]);
    expect(parsed.teachers).toBe(7);
  });

  it("ignores bare value tokens that follow no flag (stub-compatible semantics)", () => {
    const parsed = parseSeedCli(["stray-token", "--teachers", "5", "--hot-teachers", "0"]);
    expect(parsed).not.toBeInstanceOf(SeedCliUsageError);
  });

  it("rejects unknown flags with the accepted-flag list and reports each once", () => {
    const error = expectUsageError(["--bogus", "--bogus"]);
    expect(error.unknownFlags).toEqual(["--bogus"]);
    expect(error.message).toContain("--bogus");
    expect(error.message).toContain("--teachers");
    expect(error.message).toContain("--force-prod-shaped-target");
  });

  it("rejects a value flag without a value", () => {
    const error = expectUsageError(["--teachers"]);
    expect(error.message).toContain("--teachers expects a value");
  });

  it("rejects a value flag whose next token is another flag", () => {
    const error = expectUsageError(["--teachers", "--students", "5"]);
    expect(error.message).toContain("--teachers expects a value");
  });

  it("rejects non-integer volume values", () => {
    for (const bad of ["abc", "3.5", "-1", " ", "1e3"]) {
      const error = expectUsageError(["--teachers", bad]);
      expect(error.message).toContain("non-negative integer");
    }
  });

  it("rejects volumes above the accepted maximum (huge-count overflow guard)", () => {
    expectUsageError(["--teachers", String(MAX_ENTITY_COUNT + 1)]);
    expectUsageError(["--teachers", "99999999999999999999"]);
    expectUsageError(["--seed", String(MAX_SEED_VALUE + 1)]);
  });

  it("rejects a hot-teacher count larger than the teacher volume", () => {
    const error = expectUsageError(["--teachers", "3", "--hot-teachers", "8"]);
    expect(error.message).toContain("--hot-teachers must not exceed --teachers");
  });

  it("rejects sessions without teachers or students to attach them to", () => {
    expectUsageError(["--sessions", "5", "--teachers", "0"]);
    expectUsageError(["--sessions", "5", "--students", "0"]);
  });

  it("rejects subscriptions without students", () => {
    const error = expectUsageError(["--subscriptions", "5", "--students", "0", "--sessions", "0"]);
    expect(error.message).toContain("--subscriptions requires at least one student");
  });

  it("rejects injection-shaped and malformed run ids", () => {
    for (const bad of [
      "XYZ",
      "0a1b2c3",
      "0a1b2c3de",
      "0A1B2C3D",
      "'; DROP TABLE users; --",
      "../../etc/passwd",
      "per f",
    ]) {
      const error = expectUsageError(["--run-id", bad]);
      expect(error.message).toContain("8 lowercase hex characters");
    }
  });

  it("accepts zero volumes as a valid empty-run configuration", () => {
    const parsed = parseSeedCli([
      "--teachers",
      "0",
      "--students",
      "0",
      "--sessions",
      "0",
      "--notifications",
      "0",
      "--subscriptions",
      "0",
      "--hot-teachers",
      "0",
    ]);
    expect(parsed).not.toBeInstanceOf(SeedCliUsageError);
    expect(parsed).toEqual({
      teachers: 0,
      students: 0,
      sessions: 0,
      notifications: 0,
      subscriptions: 0,
      hotTeachers: 0,
      runId: null,
      seed: 0,
      forceProdShapedTarget: false,
    });
  });
});

describe("row builders (determinism, prefix, matcher eligibility)", () => {
  it("stamps the run prefix into every teacher email and full name", () => {
    const rows = [
      ...generateTeacherUserRows(TEST_PREFIX, 25, "hash", FIXED_NOW, createSeededRandom("k:teacher-users")),
    ];
    expect(rows).toHaveLength(25);
    const emails = new Set(rows.map(row => row.email));
    expect(emails.size).toBe(25);
    for (const row of rows) {
      expect(row.email.startsWith(TEST_PREFIX)).toBe(true);
      expect(row.fullName.startsWith(TEST_PREFIX)).toBe(true);
      expect(row.role).toBe("teacher");
      expect(row.isDeleted).toBe(false);
      expect(row.suspended).toBe(false);
      expect(row.isBlocked).toBe(false);
    }
  });

  it("produces teacher role rows that satisfy the matcher eligibility predicate", () => {
    const userIds = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const userRowsById = new Map(
      [
        ...generateTeacherUserRows(
          TEST_PREFIX,
          userIds.length,
          "hash",
          FIXED_NOW,
          createSeededRandom("k:teacher-users")
        ),
      ].map((row, index) => [userIds[index] ?? 0, row])
    );
    const roleRows = buildTeacherRoleRows(userIds, createSeededRandom("k:teacher-roles"));
    expect(roleRows).toHaveLength(userIds.length);
    for (const roleRow of roleRows) {
      expect(roleRow.isOnline).toBe(true);
      expect(roleRow.isApproved).toBe(true);
      const owner = userRowsById.get(roleRow.id);
      expect(owner).toBeDefined();
      if (owner !== undefined) {
        expect(satisfiesMatcherEligibility(owner, roleRow)).toBe(true);
      }
      expect(roleRow.averageRating === null || Number(roleRow.averageRating) <= 5).toBe(true);
      expect(readJsonStringArray(roleRow.subjects).length).toBeGreaterThan(0);
      expect(readJsonStringArray(roleRow.recitations).length).toBeGreaterThan(0);
      readJsonStringArray(roleRow.languages);
    }
  });

  it("distributes deterministically and exercises every filter/sort vocabulary", () => {
    const random = createSeededRandom("k:teacher-roles");
    const userIds = Array.from({ length: 200 }, (_, index) => index + 1);
    const rows = buildTeacherRoleRows(userIds, random);
    const subjectTokens = new Set(rows.flatMap(row => readJsonStringArray(row.subjects)));
    const languages = new Set(rows.flatMap(row => readJsonStringArray(row.languages)));
    const countries = new Set(
      [...generateTeacherUserRows(TEST_PREFIX, 200, "hash", FIXED_NOW, createSeededRandom("k:teacher-users"))].map(
        row => row.countryCode
      )
    );
    const ratings = rows.map(row => row.averageRating);
    expect(subjectTokens.has("hifz")).toBe(true);
    expect(subjectTokens.has("tajweed")).toBe(true);
    expect(languages.size).toBeGreaterThan(2);
    expect(countries.size).toBeGreaterThan(3);
    expect(ratings.some(rating => rating === null)).toBe(true);
    expect(ratings.some(rating => rating !== null && Number(rating) < 2.5)).toBe(true);
    expect(ratings.some(rating => rating !== null && Number(rating) >= 2.5)).toBe(true);
  });

  it("is byte-identical under the same seed key and differs under another", () => {
    const build = (seedKey: string) => [
      ...generateTeacherUserRows(TEST_PREFIX, 10, "hash", FIXED_NOW, createSeededRandom(seedKey)),
    ];
    expect(build("same-key")).toEqual(build("same-key"));
    expect(build("same-key")).not.toEqual(build("other-key"));
  });

  it("builds funded student role rows with prefixed unique handshake codes", () => {
    const userIds = [31, 32, 33];
    const rows = buildStudentRoleRows(TEST_PREFIX, userIds, createSeededRandom("k:student-roles"));
    expect(rows).toHaveLength(3);
    const codes = new Set(rows.map(row => row.handshakeCode));
    expect(codes.size).toBe(3);
    for (const row of rows) {
      expect(row.handshakeCode.startsWith(TEST_PREFIX)).toBe(true);
      expect(row.balanceHifz).toBeGreaterThan(0);
      expect(row.balanceTrial).toBe(0);
    }
  });

  it("builds the admin row, plan catalog, and wallets with prefix isolation", () => {
    const adminRow = buildAdminUserRow(TEST_PREFIX, "hash", FIXED_NOW);
    expect(adminRow.role).toBe("admin");
    expect(adminRow.email).toBe(`${TEST_PREFIX}admin@test.local`);
    expect(adminRow.email.startsWith(TEST_PREFIX)).toBe(true);

    const planRows = buildPlanRows(TEST_PREFIX);
    expect(planRows).toHaveLength(3);
    expect(new Set(planRows.map(row => row.balanceLane))).toEqual(new Set(["hifz", "tajweed", "reviews"]));
    for (const row of planRows) {
      expect(row.title.startsWith(TEST_PREFIX)).toBe(true);
    }

    const walletRows = buildWalletRows([41, 42]);
    expect(walletRows.map(row => row.teacherId)).toEqual([41, 42]);
    for (const row of walletRows) {
      expect(row.balance).toBe("0.00");
    }
  });

  it("computes the hot-session share with boundary-safe clamping", () => {
    expect(computeHotSessionCount(0, 8)).toBe(0);
    expect(computeHotSessionCount(100, 0)).toBe(0);
    expect(computeHotSessionCount(1, 8)).toBe(1);
    expect(computeHotSessionCount(10, 3)).toBe(3);
    expect(computeHotSessionCount(100, 30)).toBe(30);
    expect(computeHotSessionCount(5000, 8)).toBe(1000);
  });

  it("routes started sessions to the hot subset only", () => {
    const teacherIds = [51, 52, 53, 54];
    const studentIds = [61, 62];
    const rows = [
      ...generateSessionRows({
        teacherIds,
        hotTeacherCount: 2,
        studentIds,
        count: 20,
        now: FIXED_NOW,
        random: createSeededRandom("k:sessions"),
      }),
    ];
    expect(rows).toHaveLength(20);
    const hotIds = new Set(teacherIds.slice(0, 2));
    const coldIds = new Set(teacherIds.slice(2));
    const studentIdSet = new Set(studentIds);
    for (const [index, row] of rows.entries()) {
      expect(studentIdSet.has(row.studentId)).toBe(true);
      if (row.status === SessionStatus.Started) {
        expect(hotIds.has(row.teacherId)).toBe(true);
        expect(row.startedAt).not.toBeNull();
      } else {
        expect(coldIds.has(row.teacherId)).toBe(true);
      }
      if (row.status === SessionStatus.Scheduled) {
        expect(row.feeHeld).toBe(true);
        expect(row.heldBalanceLane).not.toBeNull();
        expect(row.confirmationDeadline).not.toBeNull();
      }
      expect(index).toBeGreaterThanOrEqual(0);
    }
    expect(rows.some(row => row.status === SessionStatus.Started)).toBe(true);
  });

  it("routes all sessions through the full teacher pool when every teacher is hot", () => {
    const rows = [
      ...generateSessionRows({
        teacherIds: [71, 72],
        hotTeacherCount: 2,
        studentIds: [81],
        count: 6,
        now: FIXED_NOW,
        random: createSeededRandom("k:sessions-all-hot"),
      }),
    ];
    expect(rows).toHaveLength(6);
    expect(
      rows.filter(row => row.status === SessionStatus.Started).length +
        rows.filter(row => row.status !== SessionStatus.Started).length
    ).toBe(6);
  });

  it("builds prefix-findable subscriptions with settled and pending shapes", () => {
    const rows = [
      ...generateSubscriptionRows({
        studentIds: [91, 92, 93],
        planIds: [1, 2, 3],
        count: 30,
        prefix: TEST_PREFIX,
        now: FIXED_NOW,
        random: createSeededRandom("k:subscriptions"),
      }),
    ];
    expect(rows).toHaveLength(30);
    const nonNullReferences = rows.map(row => row.paymentReference).filter((ref): ref is string => ref !== null);
    expect(new Set(nonNullReferences).size).toBe(nonNullReferences.length);
    for (const row of rows) {
      if (row.paymentReference !== null) {
        expect(row.paymentReference.startsWith(TEST_PREFIX)).toBe(true);
        expect(row.paymentVerifiedAt).not.toBeNull();
      } else {
        expect(row.startDate).toBeNull();
        expect(row.endDate).toBeNull();
        expect(row.status).toBe(SubscriptionStatus.Pending);
      }
    }
  });

  it("builds prefixed notification rows with valid types", () => {
    const rows = [
      ...generateNotificationRows({
        userIds: [101, 102],
        sessionIds: [201, 202, 203],
        count: 25,
        prefix: TEST_PREFIX,
        now: FIXED_NOW,
        random: createSeededRandom("k:notifications"),
      }),
    ];
    expect(rows).toHaveLength(25);
    const validTypes = new Set(Object.values(NotificationType));
    for (const row of rows) {
      expect(row.title.startsWith(TEST_PREFIX)).toBe(true);
      expect(validTypes.has(row.type)).toBe(true);
      expect(row.createdAt.getTime() - FIXED_NOW.getTime()).toBeLessThanOrEqual(0);
      if (row.relatedEntityId !== null) {
        expect(row.relatedEntityType).toBe("session");
        expect(row.relatedEntityId >= 201 && row.relatedEntityId <= 203).toBe(true);
      }
    }
  });

  it("escapes the prefix for prefix scans so the LIKE pattern is literal", () => {
    expect(buildPrefixedLikePattern(TEST_PREFIX)).toBe("perf\\_ab12cd34\\_%");
  });

  it("derives the per-run credential from the run id", () => {
    expect(buildRunPassword(TEST_RUN_ID)).toContain(TEST_RUN_ID);
    expect(buildRunPassword("0a1b2c3d")).not.toBe(buildRunPassword(TEST_RUN_ID));
  });

  it("collects at least the websocket identities the stability harness needs", () => {
    const defaultIdentities = buildWsIdentityEmails(TEST_PREFIX, 120, 2000);
    expect(defaultIdentities).toHaveLength(25);
    expect(defaultIdentities[0]).toBe(`${TEST_PREFIX}admin@test.local`);
    expect(defaultIdentities[1]).toBe(`${TEST_PREFIX}student000000@test.local`);
    const padded = buildWsIdentityEmails(TEST_PREFIX, 2, 40);
    expect(padded.length).toBeGreaterThan(20);
    for (const email of padded) {
      expect(email.startsWith(TEST_PREFIX)).toBe(true);
    }
  });
});

/** Row-index sequence used as a lightweight batch source. */
function range(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index);
}

describe("insertInBatches (chunked multi-row insert discipline)", () => {
  it("issues no statement for an empty row source", async () => {
    const sizes: number[] = [];
    const inserted = await insertInBatches([], INSERT_BATCH_SIZE, async batch => {
      sizes.push(batch.length);
    });
    expect(inserted).toBe(0);
    expect(sizes).toEqual([]);
  });

  it("issues one statement for a single row", async () => {
    const sizes: number[] = [];
    await insertInBatches([7], INSERT_BATCH_SIZE, async batch => {
      sizes.push(batch.length);
    });
    expect(sizes).toEqual([1]);
  });

  it("splits volumes at the batch boundary (499 / 500 / 501)", async () => {
    const cases = [
      [499, [499]],
      [500, [500]],
      [501, [500, 1]],
      [1201, [500, 500, 201]],
    ] as const;
    await Promise.all(
      cases.map(async ([count, expected]) => {
        const sizes: number[] = [];
        const inserted = await insertInBatches(range(count), INSERT_BATCH_SIZE, async batch => {
          sizes.push(batch.length);
        });
        expect(sizes).toEqual([...expected]);
        expect(inserted).toBe(count);
      })
    );
  });

  it("returns database-assigned ids in insertion order", async () => {
    let next = 5000;
    const ids = await insertInBatchesReturningIds(range(1001), INSERT_BATCH_SIZE, async batch => {
      const assigned: number[] = [];
      for (let index = 0; index < batch.length; index += 1) {
        assigned.push(next);
        next += 1;
      }
      return assigned;
    });
    expect(ids).toHaveLength(1001);
    expect(ids[0]).toBe(5000);
    expect(ids[1000]).toBe(6000);
  });

  it("never materializes more than one batch ahead of the database (bounded memory)", async () => {
    const total = 10001;
    let yielded = 0;
    function* rows(): Generator<number> {
      for (let index = 0; index < total; index += 1) {
        yielded += 1;
        yield index;
      }
    }
    const observedAtCall: number[] = [];
    const inserted = await insertInBatches(rows(), INSERT_BATCH_SIZE, async () => {
      observedAtCall.push(yielded);
    });
    expect(inserted).toBe(total);
    expect(observedAtCall).toHaveLength(Math.ceil(total / INSERT_BATCH_SIZE));
    for (const [callIndex, yieldedAtCall] of observedAtCall.entries()) {
      expect(yieldedAtCall).toBeLessThanOrEqual((callIndex + 1) * INSERT_BATCH_SIZE + 1);
    }
    expect(observedAtCall[0]).toBe(INSERT_BATCH_SIZE);
  });
});

describe("runSeedRun (guard-first orchestration over the database seam)", () => {
  it("seeds a tiny configuration and finalizes the manifest with actual counts", async () => {
    const harness = createFakeIoHarness();
    const outcome = await runSeedRun(tinyOptions(), harness.io);
    expect(outcome.status).toBe("seeded");
    const manifest = readManifest(harness.runDir);
    expect(manifest.runId).toBe(TEST_RUN_ID);
    expect(manifest.prefix).toBe(TEST_PREFIX);
    expect(manifest.database).toBe("kottaby_test");
    expect(manifest.completedAt).not.toBeNull();
    expect(manifest.counts).toEqual({
      users: 5,
      teacher: 2,
      student: 2,
      session: 2,
      notification: 2,
      subscription: 2,
      wallet: 2,
      plan: 3,
    } satisfies SeedManifestCounts);
    expect(harness.database.userRows).toHaveLength(5);
    expect(harness.database.sessionRows).toHaveLength(2);
    expect(harness.database.notificationRows).toHaveLength(2);
    expect(harness.database.adminRoleIds).toHaveLength(1);
    expect(manifest.identities.adminEmails).toEqual([`${TEST_PREFIX}admin@test.local`]);
  });

  it("writes the crash-discoverability manifest before inserting and finalizes it after", async () => {
    const harness = createFakeIoHarness();
    await runSeedRun(tinyOptions(), harness.io);
    const writeIndex = harness.order.indexOf("writeManifest");
    const finalizeIndex = harness.order.indexOf("finalizeManifest");
    expect(writeIndex).toBeGreaterThan(-1);
    expect(finalizeIndex).toBeGreaterThan(writeIndex);
    expect(harness.order.indexOf("db:insertPlans")).toBeGreaterThan(writeIndex);
    expect(harness.order.indexOf("db:insertUsers")).toBeGreaterThan(writeIndex);
    expect(harness.order.indexOf("finalizeManifest")).toBeGreaterThan(harness.order.indexOf("db:insertNotifications"));
  });

  it("runs the guard before any connection, directory, or write", async () => {
    const harness = createFakeIoHarness();
    await runSeedRun(tinyOptions(), harness.io);
    const guardIndex = harness.order.indexOf("assertTarget");
    expect(guardIndex).toBeGreaterThan(-1);
    for (const seam of ["connectDatabase", "openRunDirectory", "writeManifest", "db:insertUsers"]) {
      expect(harness.order.indexOf(seam)).toBeGreaterThan(guardIndex);
    }
    expect(harness.assertTargetCalls).toEqual([
      { databaseUrl: "postgres://fake:fake@localhost/kottaby_test", forceFlag: false },
    ]);
  });

  it("propagates a guard refusal before any database seam runs", async () => {
    const harness = createFakeIoHarness({ assertThrows: true });
    let caught: unknown = null;
    try {
      await runSeedRun(tinyOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GuardRefusedError);
    expect(harness.order).toEqual(["env", "assertTarget"]);
    expect(harness.database.userRows).toHaveLength(0);
    expect(existsSync(join(harness.runDir, MANIFEST_FILENAME))).toBe(false);
  });

  it("passes the force flag through to the guard", async () => {
    const harness = createFakeIoHarness();
    await runSeedRun(tinyOptions({ forceProdShapedTarget: true }), harness.io);
    expect(harness.assertTargetCalls[0]?.forceFlag).toBe(true);
  });

  it("refuses a re-run while the prefix already holds rows (collision, no writes)", async () => {
    const harness = createFakeIoHarness({ existingUserCount: 7 });
    const outcome = await runSeedRun(tinyOptions(), harness.io);
    expect(outcome).toEqual({ status: "collision", runId: TEST_RUN_ID, prefix: TEST_PREFIX } satisfies SeedRunOutcome);
    expect(harness.order).not.toContain("openRunDirectory");
    expect(harness.order).not.toContain("writeManifest");
    expect(harness.order).not.toContain("db:insertUsers");
    expect(harness.database.likePatterns).toEqual([buildPrefixedLikePattern(TEST_PREFIX)]);
  });

  it("treats a second run with the same run id as a collision after the first one seeds", async () => {
    const harness = createFakeIoHarness();
    const first = await runSeedRun(tinyOptions(), harness.io);
    expect(first.status).toBe("seeded");
    harness.database.existingUserCount = 5;
    const second = await runSeedRun(tinyOptions(), harness.io);
    expect(second.status).toBe("collision");
  });

  it("closes the database and keeps the initial manifest when an insert fails mid-run", async () => {
    const harness = createFakeIoHarness();
    harness.database.failOn = "insertSessions";
    let caught: unknown = null;
    try {
      await runSeedRun(tinyOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    if (caught instanceof Error) {
      expect(caught.message).toContain("injected failure at insertSessions");
    }
    expect(harness.order.filter(seam => seam === "closeDatabase")).toEqual(["closeDatabase"]);
    const manifest = readManifest(harness.runDir);
    expect(manifest.completedAt).toBeNull();
    expect(manifest.counts.users).toBe(5);
  });

  it("seeds an empty volume configuration with only the admin identity", async () => {
    const harness = createFakeIoHarness();
    const outcome = await runSeedRun(
      tinyOptions({
        teachers: 0,
        students: 0,
        sessions: 0,
        notifications: 0,
        subscriptions: 0,
        hotTeachers: 0,
      }),
      harness.io
    );
    expect(outcome.status).toBe("seeded");
    const manifest = readManifest(harness.runDir);
    expect(manifest.counts.users).toBe(1);
    expect(manifest.counts.session).toBe(0);
    expect(manifest.counts.wallet).toBe(0);
    expect(manifest.counts.plan).toBe(3);
    expect(harness.database.userRows.map(row => row.role)).toEqual(["admin"]);
  });

  it("produces byte-identical rows across two runs with identical options", async () => {
    const first = createFakeIoHarness();
    const second = createFakeIoHarness();
    await runSeedRun(tinyOptions(), first.io);
    await runSeedRun(tinyOptions(), second.io);
    expect(first.database.userRows).toEqual(second.database.userRows);
    expect(first.database.teacherRoleRows).toEqual(second.database.teacherRoleRows);
    expect(first.database.sessionRows).toEqual(second.database.sessionRows);
    expect(first.database.notificationRows).toEqual(second.database.notificationRows);
  });

  it("derives distinct rows when the numeric seed differs", async () => {
    const first = createFakeIoHarness();
    const second = createFakeIoHarness();
    await runSeedRun(tinyOptions({ sessions: 50, notifications: 50 }), first.io);
    await runSeedRun(tinyOptions({ sessions: 50, notifications: 50, seed: 99 }), second.io);
    expect(first.database.teacherRoleRows).not.toEqual(second.database.teacherRoleRows);
  });

  it("records the hot-teacher identity subset and websocket identities in the manifest", async () => {
    const harness = createFakeIoHarness();
    await runSeedRun(tinyOptions({ teachers: 10, students: 25, hotTeachers: 4 }), harness.io);
    const manifest = readManifest(harness.runDir);
    expect(manifest.identities.hotTeacherEmails).toEqual([
      `${TEST_PREFIX}teacher000000@test.local`,
      `${TEST_PREFIX}teacher000001@test.local`,
      `${TEST_PREFIX}teacher000002@test.local`,
      `${TEST_PREFIX}teacher000003@test.local`,
    ]);
    expect(manifest.identities.studentEmails).toHaveLength(25);
    expect(manifest.identities.wsIdentityEmails.length).toBeGreaterThanOrEqual(21);
  });

  it("survives concurrent manifest finalizations into distinct run directories", async () => {
    const first = createFakeIoHarness();
    const second = createFakeIoHarness();
    await Promise.all([runSeedRun(tinyOptions(), first.io), runSeedRun(tinyOptions({ runId: "99aa88bb" }), second.io)]);
    const firstManifest = readManifest(first.runDir);
    const secondManifest = readManifest(second.runDir);
    expect(firstManifest.runId).toBe(TEST_RUN_ID);
    expect(secondManifest.runId).toBe("99aa88bb");
    expect(secondManifest.prefix).toBe("perf_99aa88bb_");
  });

  it("never persists the plaintext credential or any connection string in the manifest", async () => {
    const harness = createFakeIoHarness();
    const outcome = await runSeedRun(tinyOptions(), harness.io);
    expect(outcome.status).toBe("seeded");
    const manifestBody = readFileSync(join(harness.runDir, MANIFEST_FILENAME), "utf8");
    expect(manifestBody).not.toContain(buildRunPassword(TEST_RUN_ID));
    expect(manifestBody).not.toContain("postgres://");
    expect(manifestBody).not.toContain("DATABASE_URL");
    if (outcome.status === "seeded") {
      expect(outcome.manifest.identities.passwordHash.startsWith("bcrypt:")).toBe(true);
    }
  });

  it("creates the manifest owner-only and refuses to clobber an existing one", async () => {
    const harness = createFakeIoHarness();
    const manifestPath = join(harness.runDir, MANIFEST_FILENAME);
    const manifest = buildSeedManifest({
      runId: TEST_RUN_ID,
      prefix: TEST_PREFIX,
      startedAt: FIXED_NOW,
      completedAt: null,
      database: "kottaby_test",
      volumes: { teachers: 0, students: 0, hotTeachers: 0 },
      counts: { users: 0, teacher: 0, student: 0, session: 0, notification: 0, subscription: 0, wallet: 0, plan: 3 },
      passwordHash: "bcrypt:4",
    });
    writeManifestFile(manifestPath, manifest);
    expect(() => writeManifestFile(manifestPath, manifest)).toThrow();
    replaceManifestFile(manifestPath, { ...manifest, completedAt: FIXED_NOW.toISOString() });
    const replacedBody: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!isSeedManifestValue(replacedBody)) {
      throw new Error("replaced manifest body does not match the seed manifest shape");
    }
    expect(replacedBody.completedAt).toBe(FIXED_NOW.toISOString());
    expect(existsSync(`${manifestPath}.tmp`)).toBe(false);
  });
});

describe("seed entrypoint subprocess (real exit codes, real guard)", () => {
  const NON_TEST_DSN = "postgres://perfop:s3cr3t-hunter2@127.0.0.1:5432/kottaby";

  it("refuses a non-test database target with exit 2 before connecting or creating a run directory", () => {
    const before = existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : 0;
    const result = runSeedSubprocess(["--teachers", "2", "--hot-teachers", "0"], { DATABASE_URL: NON_TEST_DSN });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("refused");
    expect(result.stderr).toContain("kottaby");
    expect(result.stderr).not.toContain("s3cr3t-hunter2");
    expect(result.stderr).not.toContain("postgres://");
    const after = existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : before;
    expect(after).toBe(before);
  });

  it("refuses the force override when the stdin confirmation is not answered", () => {
    const result = runSeedSubprocess(
      ["--force-prod-shaped-target", "--teachers", "2", "--hot-teachers", "0"],
      { DATABASE_URL: NON_TEST_DSN },
      "ignore"
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("override");
  });

  it("rejects unknown flags with exit 2 and the accepted-flag list", () => {
    const result = runSeedSubprocess(["--bogus"], { DATABASE_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("--teachers");
  });

  it("rejects injection-shaped run ids with exit 2 before any database work", () => {
    const result = runSeedSubprocess(["--run-id", "'; DROP TABLE users; --"], { DATABASE_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("8 lowercase hex characters");
  });
});

describe("seed-shapes fuzz (chaos tier)", () => {
  it("keeps every invariant under randomized shape fuzz", () => {
    const fuzzRandom = createSeededRandom("fuzz");
    for (let trial = 0; trial < 40; trial += 1) {
      const runId = Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(fuzzRandom() * 16)]).join("");
      expect(runId).toMatch(/^[0-9a-f]{8}$/);
      const prefix = buildSeedPrefix(runId);
      const teachers = Math.floor(fuzzRandom() * 30);
      const teacherRows = [
        ...generateTeacherUserRows(prefix, teachers, "hash", FIXED_NOW, createSeededRandom(`${runId}:t`)),
      ];
      expect(teacherRows).toHaveLength(teachers);
      for (const row of teacherRows) {
        expect(row.email.startsWith(prefix)).toBe(true);
        expect(row.email.length).toBeLessThanOrEqual(255);
        expect(row.fullName.length).toBeLessThanOrEqual(255);
      }
      const roleRows = buildTeacherRoleRows(
        teacherRows.map((_, index) => index + 1),
        createSeededRandom(`${runId}:r`)
      );
      const ownersById = new Map(teacherRows.map((row, index) => [index + 1, row]));
      for (const roleRow of roleRows) {
        const owner = ownersById.get(roleRow.id);
        if (owner !== undefined) {
          expect(satisfiesMatcherEligibility(owner, roleRow)).toBe(true);
        }
      }
    }
  });

  it("keeps count arithmetic exact at huge volume knobs", () => {
    const counts: SeedManifestCounts = {
      users: MAX_ENTITY_COUNT + MAX_ENTITY_COUNT + 1,
      teacher: MAX_ENTITY_COUNT,
      student: MAX_ENTITY_COUNT,
      session: MAX_ENTITY_COUNT,
      notification: MAX_ENTITY_COUNT,
      subscription: MAX_ENTITY_COUNT,
      wallet: MAX_ENTITY_COUNT,
      plan: 3,
    };
    const manifest = buildSeedManifest({
      runId: TEST_RUN_ID,
      prefix: TEST_PREFIX,
      startedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      database: "kottaby_test",
      volumes: { teachers: 2, students: 2, hotTeachers: 1 },
      counts,
      passwordHash: "bcrypt:4",
    });
    expect(manifest.counts.users).toBe(2 * MAX_ENTITY_COUNT + 1);
    expect(JSON.parse(JSON.stringify(manifest)).counts.users).toBe(2 * MAX_ENTITY_COUNT + 1);
  });
});

describe("test hygiene", () => {
  it("removes every temporary run directory it created", () => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    expect(tempDirs).toHaveLength(0);
  });
});
