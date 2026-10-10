import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CleanupDeleteError, type CleanupIo, runCleanupRun } from "@/scripts/perf/cleanup-perf-data";
import {
  type CleanupCliOptions,
  CleanupCliUsageError,
  isCleanupCliUsageError,
  parseCleanupCli,
} from "@/scripts/perf/lib/cleanup-cli";
import {
  CleanupManifestError,
  listSeedManifestEntries,
  type RawCleanupManifestEntry,
  selectCleanupManifestEntry,
  validateCleanupManifest,
} from "@/scripts/perf/lib/cleanup-manifest";
import type { CleanupDatabase, CleanupTableName, CleanupTableResult } from "@/scripts/perf/lib/cleanup-shapes";
import { MANIFEST_FILENAME, writeManifestFile } from "@/scripts/perf/lib/seed-manifest-file";
import { buildSeedPrefix, createSeededRandom } from "@/scripts/perf/lib/seed-random";
import {
  buildPrefixedLikePattern,
  buildSeedManifest,
  SEED_MANIFEST_TABLES,
  type SeedManifest,
} from "@/scripts/perf/lib/seed-shapes";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLEANUP_SCRIPT_PATH = join(REPO_ROOT, "scripts", "perf", "cleanup-perf-data.ts");
const PERF_LOGS_DIR = join(REPO_ROOT, "logs", "perf");

const FIXED_NOW = new Date("2026-10-09T12:00:00.000Z");
const TEST_RUN_ID = "ab12cd34";
const TEST_PREFIX = buildSeedPrefix(TEST_RUN_ID);
const TEST_PATTERN = buildPrefixedLikePattern(TEST_PREFIX);
const TEST_PASSWORD_HASH = "$2b$12$faketesthashvalue";

const tempDirs: string[] = [];

function freshTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "perf-cleanup-test-"));
  tempDirs.push(dir);
  return dir;
}

class GuardRefusedError extends Error {}

/** Builds a real-shaped seed manifest for a run (the cleanup contract's producer). */
function buildTestManifest(runId: string, overrides: Partial<SeedManifest> = {}): SeedManifest {
  return {
    ...buildSeedManifest({
      runId,
      prefix: buildSeedPrefix(runId),
      startedAt: FIXED_NOW,
      completedAt: FIXED_NOW,
      database: "kottaby_test",
      volumes: { teachers: 2, students: 2, hotTeachers: 1 },
      counts: { users: 5, teacher: 2, student: 2, session: 2, notification: 2, subscription: 2, wallet: 2, plan: 3 },
      passwordHash: TEST_PASSWORD_HASH,
    }),
    ...overrides,
  };
}

/** A discovered-manifest entry as the io seam would report it. */
function manifestEntry(
  manifest: SeedManifest,
  params: { dirName?: string; body?: unknown; readError?: string | null } = {}
): RawCleanupManifestEntry {
  const dirName = params.dirName ?? "2026-10-09T10-00-00_seed";
  return {
    runDirName: dirName,
    manifestPath: join("logs", "perf", dirName, MANIFEST_FILENAME),
    body: params.body ?? manifest,
    readError: params.readError ?? null,
  };
}

function cleanupOptions(overrides: Partial<CleanupCliOptions> = {}): CleanupCliOptions {
  return { runId: TEST_RUN_ID, last: false, forceProdShapedTarget: false, ...overrides };
}

/**
 * In-memory database fake: rows are tracked per (table, pattern) so the
 * prefix scoping, idempotency, and concurrency stories are all observable.
 */
class FakeCleanupDatabase implements CleanupDatabase {
  readonly calls: { kind: "delete" | "count"; table: CleanupTableName; pattern: string }[] = [];
  failOn: CleanupTableName | null = null;
  failCountOn: CleanupTableName | null = null;
  countOverrides: Partial<Record<CleanupTableName, number>> = {};
  private readonly rowsByTablePattern = new Map<string, number>();

  seedRows(table: CleanupTableName, pattern: string, count: number): void {
    this.rowsByTablePattern.set(`${table}:${pattern}`, count);
  }

  /** Rows still present for a (table, pattern) pair — the fake's ground truth. */
  remainingRows(table: CleanupTableName, pattern: string): number {
    return this.rowsByTablePattern.get(`${table}:${pattern}`) ?? 0;
  }

  private rows(table: CleanupTableName, pattern: string): number {
    return this.rowsByTablePattern.get(`${table}:${pattern}`) ?? 0;
  }

  deleteRows(table: CleanupTableName, pattern: string): Promise<number> {
    this.calls.push({ kind: "delete", table, pattern });
    if (this.failOn === table) {
      throw new Error(`injected failure deleting ${table}`);
    }
    const present = this.rows(table, pattern);
    this.rowsByTablePattern.set(`${table}:${pattern}`, 0);
    return Promise.resolve(present);
  }

  countResidue(table: CleanupTableName, pattern: string): Promise<number> {
    this.calls.push({ kind: "count", table, pattern });
    if (this.failCountOn === table) {
      throw new Error(`injected failure probing ${table}`);
    }
    const override = this.countOverrides[table];
    return Promise.resolve(override ?? this.rows(table, pattern));
  }
}

/** Seeds the fake with a tiny full-run row set under a prefix pattern. */
function seedTinyRunRows(database: FakeCleanupDatabase, pattern: string): void {
  const counts: Record<CleanupTableName, number> = {
    notifications: 2,
    session: 2,
    subscriptions: 2,
    wallet: 2,
    plans: 3,
    teacher: 2,
    students: 2,
    admin: 1,
    users: 5,
  };
  for (const table of SEED_MANIFEST_TABLES) {
    database.seedRows(table, pattern, counts[table]);
  }
}

interface FakeCleanupIoHarness {
  io: CleanupIo;
  database: FakeCleanupDatabase;
  logLines: string[];
  order: string[];
  assertTargetCalls: { databaseUrl: string; forceFlag: boolean }[];
}

function createFakeCleanupIoHarness(
  params: { entries?: RawCleanupManifestEntry[]; assertThrows?: boolean } = {}
): FakeCleanupIoHarness {
  const database = new FakeCleanupDatabase();
  const order: string[] = [];
  const logLines: string[] = [];
  const assertTargetCalls: { databaseUrl: string; forceFlag: boolean }[] = [];
  const entries = params.entries ?? [];
  const io: CleanupIo = {
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
    listManifests: () => {
      order.push("listManifests");
      return entries;
    },
    log: message => {
      logLines.push(message);
    },
  };
  return { io, database, logLines, order, assertTargetCalls };
}

function expectUsageError(argv: readonly string[]): CleanupCliUsageError {
  const parsed = parseCleanupCli(argv);
  expect(parsed).toBeInstanceOf(CleanupCliUsageError);
  if (!isCleanupCliUsageError(parsed)) {
    throw new Error("parseCleanupCli was expected to refuse");
  }
  return parsed;
}

function expectOptions(argv: readonly string[]): CleanupCliOptions {
  const parsed = parseCleanupCli(argv);
  expect(parsed).not.toBeInstanceOf(CleanupCliUsageError);
  if (isCleanupCliUsageError(parsed)) {
    throw new Error("parseCleanupCli was expected to succeed");
  }
  return parsed;
}

/** Runs a callback expecting a CleanupManifestError and returns it. */
function expectManifestError(action: () => unknown): CleanupManifestError {
  let caught: unknown = null;
  try {
    const result: unknown = action();
    if (result instanceof Promise) {
      throw new Error("expectManifestError received an async action; await it first");
    }
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CleanupManifestError);
  if (!(caught instanceof CleanupManifestError)) {
    throw new Error("expected a CleanupManifestError");
  }
  return caught;
}

function writeSeedRunDir(logsRoot: string, dirName: string, manifest: SeedManifest): string {
  const runDir = join(logsRoot, dirName);
  mkdirSync(runDir, { recursive: true });
  writeManifestFile(join(runDir, MANIFEST_FILENAME), manifest);
  return runDir;
}

interface SubprocessResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCleanupSubprocess(
  args: readonly string[],
  envOverrides?: Record<string, string>,
  stdin?: "ignore"
): SubprocessResult {
  const proc = Bun.spawnSync({
    cmd: [process.execPath, CLEANUP_SCRIPT_PATH, ...args],
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

describe("parseCleanupCli (pure CLI contract)", () => {
  it("parses --run with a valid run id", () => {
    expect(parseCleanupCli(["--run", TEST_RUN_ID])).toEqual({
      runId: TEST_RUN_ID,
      last: false,
      forceProdShapedTarget: false,
    });
  });

  it("parses --last", () => {
    expect(parseCleanupCli(["--last"])).toEqual({ runId: null, last: true, forceProdShapedTarget: false });
  });

  it("parses the guard force override", () => {
    const parsed = expectOptions(["--run", TEST_RUN_ID, "--force-prod-shaped-target"]);
    expect(parsed.forceProdShapedTarget).toBe(true);
    const lastParsed = expectOptions(["--last", "--force-prod-shaped-target"]);
    expect(lastParsed.forceProdShapedTarget).toBe(true);
  });

  it("lets a repeated --run flag win last", () => {
    const parsed = expectOptions(["--run", "11111111", "--run", TEST_RUN_ID]);
    expect(parsed.runId).toBe(TEST_RUN_ID);
  });

  it("ignores bare value tokens that follow no flag (stub-compatible semantics)", () => {
    const parsed = parseCleanupCli(["stray-token", "--run", TEST_RUN_ID, "trailing-token"]);
    expect(parsed).not.toBeInstanceOf(CleanupCliUsageError);
  });

  it("rejects unknown flags with the accepted-flag list and reports each once", () => {
    const error = expectUsageError(["--bogus", "--bogus"]);
    expect(error.unknownFlags).toEqual(["--bogus"]);
    expect(error.message).toContain("--bogus");
    expect(error.message).toContain("--run");
    expect(error.message).toContain("--last");
    expect(error.message).toContain("--force-prod-shaped-target");
  });

  it("rejects --run without a value", () => {
    const error = expectUsageError(["--run"]);
    expect(error.message).toContain("--run expects a value");
  });

  it("rejects --run whose next token is another flag", () => {
    const error = expectUsageError(["--run", "--last"]);
    expect(error.message).toContain("--run expects a value");
  });

  it("rejects combining --run and --last", () => {
    const error = expectUsageError(["--run", TEST_RUN_ID, "--last"]);
    expect(error.message).toContain("not both");
  });

  it("requires exactly one selector", () => {
    const error = expectUsageError([]);
    expect(error.message).toContain("--run <id>");
    expect(error.message).toContain("--last");
  });

  it("rejects injection-shaped and malformed run ids before any work", () => {
    for (const bad of [
      "XYZ12345",
      "0a1b2c3",
      "0a1b2c3de",
      "0A1B2C3D",
      "'; DROP TABLE users; --",
      "../../etc/passwd",
      "per f",
      "users; --",
    ]) {
      const error = expectUsageError(["--run", bad]);
      expect(error.message).toContain("8 lowercase hex characters");
    }
  });
});

function manifestTableOrder(table: CleanupTableName): number {
  return SEED_MANIFEST_TABLES.indexOf(table);
}

describe("SEED_MANIFEST_TABLES (deletion plan vs the FK graph)", () => {
  it("deletes children before the rows they reference (RESTRICT-safe)", () => {
    const order = manifestTableOrder;
    expect(order("notifications")).toBeLessThan(order("users"));
    expect(order("session")).toBeLessThan(order("teacher"));
    expect(order("session")).toBeLessThan(order("students"));
    expect(order("session")).toBeLessThan(order("users"));
    expect(order("subscriptions")).toBeLessThan(order("plans"));
    expect(order("subscriptions")).toBeLessThan(order("users"));
    expect(order("wallet")).toBeLessThan(order("teacher"));
    expect(order("teacher")).toBeLessThan(order("users"));
    expect(order("students")).toBeLessThan(order("users"));
    expect(order("admin")).toBeLessThan(order("users"));
  });

  it("covers exactly the nine seeded tables with users last", () => {
    expect(SEED_MANIFEST_TABLES).toHaveLength(9);
    expect(new Set(SEED_MANIFEST_TABLES)).toEqual(
      new Set(["notifications", "session", "subscriptions", "wallet", "plans", "teacher", "students", "admin", "users"])
    );
    expect(SEED_MANIFEST_TABLES[8]).toBe("users");
  });
});

describe("listSeedManifestEntries (manifest discovery over a real directory)", () => {
  it("returns entries newest first, including same-second collision suffixes", () => {
    const logsRoot = freshTempDir();
    writeSeedRunDir(logsRoot, "2026-10-09T10-00-00_seed", buildTestManifest("11111111"));
    writeSeedRunDir(logsRoot, "2026-10-09T10-00-00-2_seed", buildTestManifest("22222222"));
    writeSeedRunDir(logsRoot, "2026-10-09T09-00-00_seed", buildTestManifest(TEST_RUN_ID));
    const entries = listSeedManifestEntries(logsRoot);
    expect(entries.map(entry => entry.runDirName)).toEqual([
      "2026-10-09T10-00-00-2_seed",
      "2026-10-09T10-00-00_seed",
      "2026-10-09T09-00-00_seed",
    ]);
    expect(entries.every(entry => entry.readError === null)).toBe(true);
  });

  it("skips non-run-dir names, files, and run dirs without a manifest", () => {
    const logsRoot = freshTempDir();
    writeSeedRunDir(logsRoot, "2026-10-09T10-00-00_seed", buildTestManifest(TEST_RUN_ID));
    mkdirSync(join(logsRoot, "2026-10-09T09-00-00_seed"));
    writeFileSync(join(logsRoot, "junk-name"), "not a directory");
    mkdirSync(join(logsRoot, "...evil"));
    const entries = listSeedManifestEntries(logsRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.runDirName).toBe("2026-10-09T10-00-00_seed");
  });

  it("reports corrupt manifest JSON with the read failure instead of a body", () => {
    const logsRoot = freshTempDir();
    const runDir = join(logsRoot, "2026-10-09T10-00-00_seed");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(join(runDir, MANIFEST_FILENAME), "{ not valid json !!");
    const entries = listSeedManifestEntries(logsRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.body).toBeNull();
    expect(entries[0]?.readError).not.toBeNull();
  });

  it("returns an empty list when the manifests root does not exist", () => {
    expect(listSeedManifestEntries(join(freshTempDir(), "missing-root"))).toEqual([]);
  });

  it("never resolves a manifest path outside the scanned root", () => {
    const logsRoot = freshTempDir();
    writeSeedRunDir(logsRoot, "2026-10-09T10-00-00_seed", buildTestManifest(TEST_RUN_ID));
    mkdirSync(join(logsRoot, "2026-10-09T10-00-05-9999_zzz"));
    writeFileSync(join(logsRoot, "2026-10-09T10-00-09_a"), "junk");
    const entries = listSeedManifestEntries(logsRoot);
    for (const entry of entries) {
      expect(entry.manifestPath.startsWith(logsRoot)).toBe(true);
      expect(entry.manifestPath.includes("..")).toBe(false);
      expect(statSync(entry.manifestPath).isFile()).toBe(true);
    }
  });
});

describe("selectCleanupManifestEntry (run selection)", () => {
  it("--last picks the newest manifest among several", () => {
    const entries = [
      manifestEntry(buildTestManifest("22222222"), { dirName: "2026-10-09T10-00-00_seed" }),
      manifestEntry(buildTestManifest(TEST_RUN_ID), { dirName: "2026-10-09T09-00-00_seed" }),
    ];
    const selected = selectCleanupManifestEntry(entries, { runId: null, last: true });
    expect(selected.runDirName).toBe("2026-10-09T10-00-00_seed");
  });

  it("--last with zero manifests refuses with an actionable message", () => {
    const error = expectManifestError(() => selectCleanupManifestEntry([], { runId: null, last: true }));
    expect(error.message).toContain("no seed manifests found");
  });

  it("--last with a corrupt newest manifest refuses naming the file and the escape hatch", () => {
    const entries = [
      manifestEntry(buildTestManifest(TEST_RUN_ID), {
        dirName: "2026-10-09T10-00-00_seed",
        body: null,
        readError: "Unexpected token",
      }),
      manifestEntry(buildTestManifest("22222222"), { dirName: "2026-10-09T09-00-00_seed" }),
    ];
    const error = expectManifestError(() => selectCleanupManifestEntry(entries, { runId: null, last: true }));
    expect(error.message).toContain("2026-10-09T10-00-00_seed");
    expect(error.message).toContain("Unexpected token");
    expect(error.message).toContain("--run");
  });

  it("--run resolves the newest manifest for that run id", () => {
    const entries = [
      manifestEntry(buildTestManifest(TEST_RUN_ID), { dirName: "2026-10-09T10-00-00_seed" }),
      manifestEntry(buildTestManifest(TEST_RUN_ID), { dirName: "2026-10-09T09-00-00_seed" }),
      manifestEntry(buildTestManifest("22222222"), { dirName: "2026-10-09T08-00-00_seed" }),
    ];
    const selected = selectCleanupManifestEntry(entries, { runId: TEST_RUN_ID, last: false });
    expect(selected.runDirName).toBe("2026-10-09T10-00-00_seed");
  });

  it("--run with no matching manifest lists the available runs", () => {
    const entries = [
      manifestEntry(buildTestManifest("11111111"), { dirName: "2026-10-09T10-00-00_seed" }),
      manifestEntry(buildTestManifest("22222222"), { dirName: "2026-10-09T09-00-00_seed" }),
    ];
    const error = expectManifestError(() => selectCleanupManifestEntry(entries, { runId: TEST_RUN_ID, last: false }));
    expect(error.message).toContain(`run "${TEST_RUN_ID}"`);
    expect(error.message).toContain("11111111");
    expect(error.message).toContain("22222222");
  });

  it("--run with zero manifests reports no available runs", () => {
    const error = expectManifestError(() => selectCleanupManifestEntry([], { runId: TEST_RUN_ID, last: false }));
    expect(error.message).toContain("(none)");
  });

  it("--run skips corrupt manifests and notes them when nothing matches", () => {
    const entries = [
      manifestEntry(buildTestManifest(TEST_RUN_ID), {
        dirName: "2026-10-09T10-00-00_seed",
        body: null,
        readError: "bad json",
      }),
      manifestEntry(buildTestManifest("22222222"), { dirName: "2026-10-09T09-00-00_seed" }),
    ];
    const selected = selectCleanupManifestEntry(entries, { runId: "22222222", last: false });
    expect(selected.runDirName).toBe("2026-10-09T09-00-00_seed");
    const error = expectManifestError(() => selectCleanupManifestEntry(entries, { runId: "33333333", last: false }));
    expect(error.message).toContain("1 seed manifest(s) could not be read");
  });

  it("refuses a selector that names no run (defensive branch)", () => {
    const error = expectManifestError(() => selectCleanupManifestEntry([], { runId: null, last: false }));
    expect(error.message).toContain("--run <id> or --last");
  });
});

describe("validateCleanupManifest (write-scope validation)", () => {
  it("accepts a real-shaped manifest and reduces it to a plan", () => {
    const plan = validateCleanupManifest(buildTestManifest(TEST_RUN_ID), "logs/perf/x/seed-manifest.json");
    expect(plan.runId).toBe(TEST_RUN_ID);
    expect(plan.prefix).toBe(TEST_PREFIX);
    expect(plan.tables).toEqual(SEED_MANIFEST_TABLES);
  });

  it("accepts a crashed run's manifest (null completion timestamp)", () => {
    const manifest = buildTestManifest(TEST_RUN_ID, { completedAt: null });
    const plan = validateCleanupManifest(manifest, "logs/perf/x/seed-manifest.json");
    expect(plan.runId).toBe(TEST_RUN_ID);
  });

  it("refuses malformed bodies naming the manifest path", () => {
    for (const bad of [null, "text", 7, {}, { runId: TEST_RUN_ID }, { runId: TEST_RUN_ID, prefix: TEST_PREFIX }]) {
      const error = expectManifestError(() => validateCleanupManifest(bad, "logs/perf/x/seed-manifest.json"));
      expect(error.message).toContain("logs/perf/x/seed-manifest.json");
      expect(error.message).toContain("malformed");
    }
  });

  it("refuses a manifest whose run id is not 8 lowercase hex characters", () => {
    const manifest = buildTestManifest(TEST_RUN_ID, { runId: "NOTHEX8" });
    const error = expectManifestError(() => validateCleanupManifest(manifest, "logs/perf/x/seed-manifest.json"));
    expect(error.message).toContain("invalid run id");
  });

  it("refuses a tampered prefix so the delete scope can never broaden", () => {
    for (const prefix of ["", "a", "perf_", `perf_${TEST_RUN_ID}`, `${TEST_PREFIX}x`, "users"]) {
      const manifest = buildTestManifest(TEST_RUN_ID, { prefix });
      const error = expectManifestError(() => validateCleanupManifest(manifest, "logs/perf/x/seed-manifest.json"));
      expect(error.message).toContain("refusing to clean an untrusted write scope");
    }
  });

  it("refuses any deviation from the FK-safe table order", () => {
    const tampered: string[][] = [
      [],
      SEED_MANIFEST_TABLES.toReversed(),
      SEED_MANIFEST_TABLES.slice(0, 8),
      [...SEED_MANIFEST_TABLES.slice(0, 8), "users", "users; DROP TABLE students"],
      ["notifications", "session", "subscriptions", "wallet", "plans", "teacher", "students", "admin", "USERS"],
    ];
    for (const tables of tampered) {
      const manifest = buildTestManifest(TEST_RUN_ID, { tables });
      const error = expectManifestError(() => validateCleanupManifest(manifest, "logs/perf/x/seed-manifest.json"));
      expect(error.message).toContain("FK-safe deletion order");
    }
  });
});

describe("runCleanupRun (guard-first orchestration over the database seam)", () => {
  function seededHarness(
    params: { entries?: RawCleanupManifestEntry[]; assertThrows?: boolean } = {}
  ): FakeCleanupIoHarness {
    const harness = createFakeCleanupIoHarness(params);
    seedTinyRunRows(harness.database, TEST_PATTERN);
    return harness;
  }

  it("deletes every table in the manifest's FK-safe order and re-probes all nine", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    const outcome = await runCleanupRun(cleanupOptions(), harness.io);
    expect(outcome.status).toBe("clean");
    const deletes = harness.database.calls.filter(call => call.kind === "delete");
    expect(deletes.map(call => call.table)).toEqual([...SEED_MANIFEST_TABLES]);
    const counts = harness.database.calls.filter(call => call.kind === "count");
    expect(counts.map(call => call.table)).toEqual([...SEED_MANIFEST_TABLES]);
    expect(harness.database.calls.every(call => call.pattern === TEST_PATTERN)).toBe(true);
    expect(outcome.deleted).toEqual([
      { table: "notifications", count: 2 },
      { table: "session", count: 2 },
      { table: "subscriptions", count: 2 },
      { table: "wallet", count: 2 },
      { table: "plans", count: 3 },
      { table: "teacher", count: 2 },
      { table: "students", count: 2 },
      { table: "admin", count: 1 },
      { table: "users", count: 5 },
    ] satisfies CleanupTableResult[]);
    expect(outcome.residue.every(result => result.count === 0)).toBe(true);
  });

  it("scans with the escaped prefix pattern exactly", () => {
    expect(TEST_PATTERN).toBe("perf\\_ab12cd34\\_%");
  });

  it("runs the guard before any manifest scan, connection, or delete", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    await runCleanupRun(cleanupOptions(), harness.io);
    const guardIndex = harness.order.indexOf("assertTarget");
    expect(guardIndex).toBeGreaterThan(-1);
    for (const seam of ["listManifests", "connectDatabase", "closeDatabase"]) {
      expect(harness.order.indexOf(seam)).toBeGreaterThan(guardIndex);
    }
    expect(harness.assertTargetCalls).toEqual([
      { databaseUrl: "postgres://fake:fake@localhost/kottaby_test", forceFlag: false },
    ]);
  });

  it("passes the force flag through to the guard", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    await runCleanupRun(cleanupOptions({ forceProdShapedTarget: true }), harness.io);
    expect(harness.assertTargetCalls[0]?.forceFlag).toBe(true);
  });

  it("propagates a guard refusal before any other seam runs", async () => {
    const harness = createFakeCleanupIoHarness({ assertThrows: true });
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GuardRefusedError);
    expect(harness.order).toEqual(["env", "assertTarget"]);
    expect(harness.database.calls).toHaveLength(0);
  });

  it("refuses a missing manifest without connecting to the database", async () => {
    const harness = createFakeCleanupIoHarness({ entries: [] });
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CleanupManifestError);
    expect(harness.order).toEqual(["env", "assertTarget", "listManifests"]);
    expect(harness.order).not.toContain("connectDatabase");
    expect(harness.database.calls).toHaveLength(0);
  });

  it("refuses a tampered manifest before any database seam runs", async () => {
    const tampered = manifestEntry(buildTestManifest(TEST_RUN_ID, { prefix: "evil_" }));
    const harness = createFakeCleanupIoHarness({ entries: [tampered] });
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CleanupManifestError);
    expect(harness.order).not.toContain("connectDatabase");
    expect(harness.database.calls).toHaveLength(0);
  });

  it("is idempotent: a second run finds nothing, probes zero, and still succeeds", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    const first = await runCleanupRun(cleanupOptions(), harness.io);
    expect(first.status).toBe("clean");
    const second = await runCleanupRun(cleanupOptions(), harness.io);
    expect(second.status).toBe("clean");
    expect(second.deleted.every(result => result.count === 0)).toBe(true);
    expect(second.residue.every(result => result.count === 0)).toBe(true);
  });

  it("completes a run whose first pass was interrupted mid-order (partial-failure retry)", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    harness.database.failOn = "subscriptions";
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CleanupDeleteError);
    if (caught instanceof CleanupDeleteError) {
      expect(caught.message).toContain('"subscriptions"');
      expect(caught.message).toContain("notifications, session");
      expect(caught.message).toContain("wallet, plans, teacher, students, admin, users");
      expect(caught.message).toContain("re-run the same cleanup command");
    }
    expect(harness.order).toEqual(["env", "assertTarget", "listManifests", "connectDatabase", "closeDatabase"]);
    harness.database.failOn = null;
    const outcome = await runCleanupRun(cleanupOptions(), harness.io);
    expect(outcome.status).toBe("clean");
    const secondPassDeleted = outcome.deleted.filter(result => result.count > 0);
    expect(secondPassDeleted.map(result => result.table)).toEqual([
      "subscriptions",
      "wallet",
      "plans",
      "teacher",
      "students",
      "admin",
      "users",
    ]);
  });

  it("never continues silently past a mid-order failure: no probe runs", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    harness.database.failOn = "plans";
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(CleanupDeleteError);
    expect(harness.database.calls.some(call => call.kind === "count")).toBe(false);
  });

  it("closes the database when the residue probe itself fails", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    harness.database.failCountOn = "teacher";
    let caught: unknown = null;
    try {
      await runCleanupRun(cleanupOptions(), harness.io);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(harness.order.filter(seam => seam === "closeDatabase")).toEqual(["closeDatabase"]);
  });

  it("reports residue with the offending table instead of accepting it", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    harness.database.countOverrides = { session: 3, users: 1 };
    const outcome = await runCleanupRun(cleanupOptions(), harness.io);
    expect(outcome.status).toBe("residue");
    const offending = outcome.residue.filter(result => result.count > 0);
    expect(offending).toEqual([
      { table: "session", count: 3 },
      { table: "users", count: 1 },
    ] satisfies CleanupTableResult[]);
    const summary = harness.logLines.join("\n");
    expect(summary).toContain("session: 3 row(s)");
    expect(summary).toContain("users: 1 row(s)");
  });

  it("logs the operator summary without ever echoing manifest secrets", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    const outcome = await runCleanupRun(cleanupOptions(), harness.io);
    expect(outcome.status).toBe("clean");
    const summary = harness.logLines.join("\n");
    expect(summary).toContain(`run ${TEST_RUN_ID}`);
    expect(summary).toContain(TEST_PREFIX);
    expect(summary).toContain("zero residue");
    expect(summary).not.toContain(TEST_PASSWORD_HASH);
    expect(summary).not.toContain("student000000@test.local");
    expect(summary).not.toContain("admin@test.local");
  });

  it("cleans a crashed run's manifest (crash discoverability contract)", async () => {
    const harness = seededHarness({
      entries: [manifestEntry(buildTestManifest(TEST_RUN_ID, { completedAt: null }))],
    });
    const outcome = await runCleanupRun(cleanupOptions(), harness.io);
    expect(outcome.status).toBe("clean");
  });

  it("concurrent cleanups of the same run converge with zero residue", async () => {
    const harness = seededHarness({ entries: [manifestEntry(buildTestManifest(TEST_RUN_ID))] });
    const [first, second] = await Promise.all([
      runCleanupRun(cleanupOptions(), harness.io),
      runCleanupRun(cleanupOptions(), harness.io),
    ]);
    const totalDeleted = [...first.deleted, ...second.deleted].reduce((sum, result) => sum + result.count, 0);
    expect(totalDeleted).toBe(21);
    expect(first.status).toBe("clean");
    expect(second.status).toBe("clean");
  });

  it("concurrent cleanups of different runs never touch each other's prefix", async () => {
    const otherRunId = "22222222";
    const otherPattern = buildPrefixedLikePattern(buildSeedPrefix(otherRunId));
    const database = new FakeCleanupDatabase();
    seedTinyRunRows(database, TEST_PATTERN);
    seedTinyRunRows(database, otherPattern);
    const makeIo = (): CleanupIo => {
      const io: CleanupIo = {
        env: () => ({ databaseUrl: "postgres://fake:fake@localhost/kottaby_test" }),
        assertTarget: () => ({ ok: true, dbName: "kottaby_test" }),
        connectDatabase: async () => database,
        closeDatabase: async () => {},
        listManifests: () => [
          manifestEntry(buildTestManifest(TEST_RUN_ID), { dirName: "2026-10-09T10-00-00_seed" }),
          manifestEntry(buildTestManifest(otherRunId), { dirName: "2026-10-09T09-00-00_seed" }),
        ],
        log: () => {},
      };
      return io;
    };
    const [first, second] = await Promise.all([
      runCleanupRun(cleanupOptions(), makeIo()),
      runCleanupRun(cleanupOptions({ runId: otherRunId }), makeIo()),
    ]);
    expect(first.status).toBe("clean");
    expect(second.status).toBe("clean");
    for (const call of database.calls) {
      const expectedPattern = call.pattern === TEST_PATTERN || call.pattern === otherPattern;
      expect(expectedPattern).toBe(true);
    }
    const totalRemaining = [...SEED_MANIFEST_TABLES].reduce(
      (sum, table) => sum + database.remainingRows(table, TEST_PATTERN) + database.remainingRows(table, otherPattern),
      0
    );
    expect(totalRemaining).toBe(0);
  });
});

describe("cleanup entrypoint subprocess (real exit codes, real guard)", () => {
  const NON_TEST_DSN = "postgres://perfop:s3cr3t-hunter2@127.0.0.1:5432/kottaby";

  it("refuses a non-test database target with exit 2 before any database work", () => {
    const before = existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : 0;
    const result = runCleanupSubprocess(["--last"], { DATABASE_URL: NON_TEST_DSN });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("refused");
    expect(result.stderr).toContain("kottaby");
    expect(result.stderr).not.toContain("s3cr3t-hunter2");
    expect(result.stderr).not.toContain("postgres://");
    const after = existsSync(PERF_LOGS_DIR) ? readdirSync(PERF_LOGS_DIR).length : before;
    expect(after).toBe(before);
  });

  it("refuses the force override when the stdin confirmation is not answered", () => {
    const result = runCleanupSubprocess(
      ["--last", "--force-prod-shaped-target"],
      { DATABASE_URL: NON_TEST_DSN },
      "ignore"
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("override");
  });

  it("rejects unknown flags with exit 2 and the accepted-flag list", () => {
    const result = runCleanupSubprocess(["--bogus"], { DATABASE_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--bogus");
    expect(result.stderr).toContain("--run");
    expect(result.stderr).toContain("--last");
  });

  it("rejects injection-shaped run ids with exit 2 before any work", () => {
    const result = runCleanupSubprocess(["--run", "'; DROP TABLE users; --"], { DATABASE_URL: "" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("8 lowercase hex characters");
  });

  it("rejects a missing selector and a conflicting selector with exit 2", () => {
    expect(runCleanupSubprocess([], { DATABASE_URL: "" }).exitCode).toBe(2);
    expect(runCleanupSubprocess(["--run", TEST_RUN_ID, "--last"], { DATABASE_URL: "" }).exitCode).toBe(2);
  });
});

describe("cleanup manifest fuzz (chaos tier)", () => {
  it("accepts every well-formed manifest and refuses every tampering of it", () => {
    const fuzzRandom = createSeededRandom("cleanup-fuzz");
    const junkTables = ["users; DROP TABLE students", "pg_catalog", "__dta_a", "USERS", "notifications "];
    for (let trial = 0; trial < 40; trial += 1) {
      const runId = Array.from({ length: 8 }, () => "0123456789abcdef"[Math.floor(fuzzRandom() * 16)]).join("");
      const manifest = buildTestManifest(runId);
      const plan = validateCleanupManifest(manifest, "logs/perf/fuzz/seed-manifest.json");
      expect(plan.prefix).toBe(`perf_${runId}_`);
      const tamperedPrefix = buildTestManifest(runId, { prefix: `perf_${runId}${trial}` });
      expectManifestError(() => validateCleanupManifest(tamperedPrefix, "logs/perf/fuzz/seed-manifest.json"));
      const rotation = 1 + (trial % 8);
      const rotated = [...SEED_MANIFEST_TABLES.slice(rotation), ...SEED_MANIFEST_TABLES.slice(0, rotation)];
      const tamperedOrder = buildTestManifest(runId, { tables: rotated });
      expectManifestError(() => validateCleanupManifest(tamperedOrder, "logs/perf/fuzz/seed-manifest.json"));
      const junk = junkTables[Math.floor(fuzzRandom() * junkTables.length)] ?? "pg_catalog";
      const tamperedTable = buildTestManifest(runId, { tables: [...SEED_MANIFEST_TABLES.slice(0, 8), junk] });
      expectManifestError(() => validateCleanupManifest(tamperedTable, "logs/perf/fuzz/seed-manifest.json"));
    }
  });

  it("keeps huge counts and long identity lists out of the cleanup's scope (plan only)", () => {
    const manifest = buildTestManifest(TEST_RUN_ID, {
      counts: {
        users: 2_000_001,
        teacher: 1_000_000,
        student: 1_000_000,
        session: 1_000_000,
        notification: 1_000_000,
        subscription: 1_000_000,
        wallet: 1_000_000,
        plan: 3,
      },
    });
    const plan = validateCleanupManifest(manifest, "logs/perf/fuzz/seed-manifest.json");
    expect(plan.runId).toBe(TEST_RUN_ID);
    expect(Object.keys(plan).toSorted((left, right) => left.localeCompare(right))).toEqual([
      "prefix",
      "runId",
      "tables",
    ]);
  });
});

describe("test hygiene", () => {
  it("removes every temporary directory it created", () => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
    expect(tempDirs).toHaveLength(0);
  });
});
