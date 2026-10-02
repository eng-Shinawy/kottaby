#!/usr/bin/env bun
/**
 * End-to-end disaster-recovery drill chain for the database backup pair:
 * `ops:db-backup` (pg_dump artifact + verifiable manifest) and
 * `ops:db-restore-verify` (guarded pg_restore + structural checks +
 * read-only invariant oracles).
 *
 * DEVIATION — no `runInRollback`: the drill shells out to OS-level tools
 * (createdb, pg_dump, pg_restore, psql) that cannot participate in an
 * application-level transaction, so the repo's rollback-wrapper test pattern
 * is not applicable. Isolation is achieved at the only boundary available to
 * OS tools: every run creates uniquely-named scratch databases — the source
 * is template-copied from the dev database so the schema plus seed fixtures
 * cover every critical table — runs the real PASS chain, the guard probe,
 * and the tamper-FAIL chain against them, and drops them all in `afterAll`.
 * The dev database serves strictly as a read-only template source and is
 * never written. Run exclusively via test/scripts/run-test.ts.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { ARTIFACT_FILE_NAME, MANIFEST_FILE_NAME } from "@/scripts/ops/backup-artifacts";
import { CONFIRMATION_FLAG } from "@/scripts/ops/restore-guard";
import { ORACLES } from "@/scripts/ops/restore-oracles";
import { CRITICAL_TABLES } from "@/scripts/ops/restore-structure";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const PG_HOST = "127.0.0.1";
const PG_USER = "postgres";
const PG_BASE_ARGS = ["-h", PG_HOST, "-U", PG_USER] as const;
const DEV_DATABASE = "app_db";
/** Quote-safe: the name is interpolated into identifiers and shell argv positions. */
const SCRATCH_NAME_PATTERN = /^[a-z_][a-z0-9_]*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const USER_TABLE_COUNT_SQL = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'";

/**
 * Ordered minimal drill fixtures, applied in one psql batch: a drill student
 * user + students row carrying explicit (sanitary) balance lanes, a support
 * teacher row, and one valid row per critical table the template copy leaves
 * empty. Guards make every statement idempotent on any template copy.
 */
const FIXTURE_SQL =
  [
    "INSERT INTO users (id, full_name, email, password_hash, role) OVERRIDING SYSTEM VALUE SELECT 990100, 'DR Drill Student', 'dr-drill-student@kottaby.local', 'drill-noop-hash', 'student' WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = 990100)",
    "INSERT INTO students (id, balance_trial, balance_hifz, balance_reviews, balance_tajweed, handshake_code) OVERRIDING SYSTEM VALUE SELECT 990100, 1, 0, 0, 0, 'dr-drill-handshake' WHERE EXISTS (SELECT 1 FROM users WHERE id = 990100) AND NOT EXISTS (SELECT 1 FROM students WHERE id = 990100)",
    // Every remaining statement is guarded exactly like the two above: the
    // batch fires when ANY critical table is empty, so a template copy that
    // already carries some rows must not collide on a primary key here
    // (ON_ERROR_STOP=1 would abort the whole batch and fail the drill).
    "INSERT INTO teacher (id) OVERRIDING SYSTEM VALUE SELECT id FROM users WHERE role = 'teacher' AND NOT EXISTS (SELECT 1 FROM teacher) LIMIT 1",
    "INSERT INTO wallet (id, teacher_id, balance, total_earning) OVERRIDING SYSTEM VALUE SELECT 990001, id, 0, 0 FROM teacher WHERE NOT EXISTS (SELECT 1 FROM wallet WHERE id = 990001) LIMIT 1",
    [
      "INSERT INTO session (id, teacher_id, student_id, intent, fee, fee_held) OVERRIDING SYSTEM VALUE",
      "SELECT 990002, (SELECT id FROM teacher LIMIT 1), (SELECT id FROM students LIMIT 1), 'hifz', 10.00, FALSE",
      "WHERE NOT EXISTS (SELECT 1 FROM session WHERE id = 990002)",
    ].join(" "),
    "INSERT INTO teacher_transaction (id, wallet_id, amount, type) OVERRIDING SYSTEM VALUE SELECT 990003, id, 5.00, 'earning' FROM wallet WHERE NOT EXISTS (SELECT 1 FROM teacher_transaction WHERE id = 990003) LIMIT 1",
    [
      "INSERT INTO session_request_idempotency (id, idempotency_key, user_id) OVERRIDING SYSTEM VALUE",
      "SELECT 990007, 'kottaby-dr-it-fixture', id FROM users WHERE role = 'student' AND NOT EXISTS (SELECT 1 FROM session_request_idempotency WHERE id = 990007) LIMIT 1",
    ].join(" "),
    [
      "INSERT INTO audit_logs (id, actor_id, action_type, entity_type, entity_id) OVERRIDING SYSTEM VALUE",
      "SELECT 990004, id, 'create', 'user', id FROM users WHERE role = 'teacher' AND NOT EXISTS (SELECT 1 FROM audit_logs WHERE id = 990004) LIMIT 1",
    ].join(" "),
    [
      "INSERT INTO notifications (id, user_id, type, title) OVERRIDING SYSTEM VALUE",
      "SELECT 990005, id, 'system_broadcast', 'disaster-recovery drill fixture' FROM users WHERE role = 'parent' AND NOT EXISTS (SELECT 1 FROM notifications WHERE id = 990005) LIMIT 1",
    ].join(" "),
    [
      "INSERT INTO parent_link_requests (id, parent_id, student_id, status, expires_at) OVERRIDING SYSTEM VALUE",
      "SELECT 990006, (SELECT id FROM users WHERE role = 'parent' LIMIT 1), id, 'pending', now() + interval '7 days'",
      "FROM students WHERE NOT EXISTS (SELECT 1 FROM parent_link_requests WHERE id = 990006) LIMIT 1",
    ].join(" "),
  ].join(";\n") + ";";

interface SpawnOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Persisted restore-report contract (subset the drill asserts on). */
interface RestoredReport {
  verdict: string;
  target: { database: string };
  durationMs: number;
  structural: { table: string; present: boolean; rowCount: number; ok: boolean }[];
  oracles: { id: string; passed: boolean }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) {
    throw new Error(`${label} is not a JSON object`);
  }
  return parsed;
}

function requireString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string") {
    throw new Error(`${field} is not a string`);
  }
  return value;
}

/** Type guard over the persisted restore-report contract (subset the drill asserts on). */
function isRestoredReport(value: unknown): value is RestoredReport {
  if (!isRecord(value) || typeof value.verdict !== "string" || typeof value.durationMs !== "number") {
    return false;
  }
  const target = value.target;
  if (!isRecord(target) || typeof target.database !== "string") {
    return false;
  }
  if (!Array.isArray(value.structural) || !Array.isArray(value.oracles)) {
    return false;
  }
  const structuralValid = value.structural.every(
    row =>
      isRecord(row) &&
      typeof row.table === "string" &&
      typeof row.present === "boolean" &&
      typeof row.rowCount === "number" &&
      typeof row.ok === "boolean"
  );
  const oraclesValid = value.oracles.every(
    oracle => isRecord(oracle) && typeof oracle.id === "string" && typeof oracle.passed === "boolean"
  );
  return structuralValid && oraclesValid;
}

function spawnCapture(cmd: readonly string[]): Promise<SpawnOutcome> {
  const proc = Bun.spawn([...cmd], { cwd: REPO_ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  return Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]).then(
    ([stdout, stderr, exitCode]) => ({ exitCode, stdout, stderr })
  );
}

function psqlArgs(database: string, sql: string): string[] {
  return [
    "psql",
    ...PG_BASE_ARGS,
    "--dbname",
    database,
    "--tuples-only",
    "--no-align",
    "--set=ON_ERROR_STOP=1",
    "--command",
    sql,
  ];
}

async function psqlScalar(database: string, sql: string): Promise<string> {
  const outcome = await spawnCapture(psqlArgs(database, sql));
  if (outcome.exitCode !== 0) {
    throw new Error(`psql failed against ${database}: ${outcome.stderr.trim()}`);
  }
  return outcome.stdout.trim();
}

async function countRows(database: string, table: string): Promise<number> {
  const value = await psqlScalar(database, `SELECT COUNT(*) FROM "${table}"`);
  return Number.parseInt(value, 10);
}

function scratchDsn(database: string): string {
  return `postgresql://${PG_USER}@${PG_HOST}:5432/${database}`;
}

function assertQuoteSafeName(name: string): void {
  if (!SCRATCH_NAME_PATTERN.test(name)) {
    throw new Error(`scratch database name is not quote-safe: ${name}`);
  }
}

async function createEmptyDatabase(database: string): Promise<void> {
  const outcome = await spawnCapture(["createdb", ...PG_BASE_ARGS, database]);
  if (outcome.exitCode !== 0) {
    throw new Error(`createdb ${database} failed: ${outcome.stderr.trim()}`);
  }
}

/** Template-copies the dev database; falls back to dump|psql when the template is connection-locked. */
async function createSourceCopy(database: string, workspace: string): Promise<void> {
  const templateOutcome = await spawnCapture(["createdb", ...PG_BASE_ARGS, "-T", DEV_DATABASE, database]);
  if (templateOutcome.exitCode === 0) {
    return;
  }
  const dumpOutcome = await spawnCapture([
    "pg_dump",
    ...PG_BASE_ARGS,
    "--format=plain",
    "--no-owner",
    "--no-privileges",
    DEV_DATABASE,
  ]);
  if (dumpOutcome.exitCode !== 0) {
    throw new Error(`pg_dump ${DEV_DATABASE} failed: ${dumpOutcome.stderr.trim()}`);
  }
  await createEmptyDatabase(database);
  const dumpPath = join(workspace, "dev-template.sql");
  writeFileSync(dumpPath, dumpOutcome.stdout);
  const loadOutcome = await spawnCapture([
    "psql",
    ...PG_BASE_ARGS,
    "--dbname",
    database,
    "--set=ON_ERROR_STOP=1",
    "--file",
    dumpPath,
  ]);
  if (loadOutcome.exitCode !== 0) {
    throw new Error(`loading dev template into ${database} failed: ${loadOutcome.stderr.trim()}`);
  }
}

async function seedCriticalFixtures(database: string): Promise<void> {
  const before = await Promise.all(CRITICAL_TABLES.map(table => countRows(database, table)));
  const countByTable = new Map<string, number>();
  for (const [index, table] of CRITICAL_TABLES.entries()) {
    countByTable.set(table, before[index] ?? 0);
  }
  if ((countByTable.get("users") ?? 0) === 0) {
    throw new Error(`scratch source ${database} has no users row to anchor fixtures`);
  }
  if (CRITICAL_TABLES.some(table => (countByTable.get(table) ?? 0) === 0)) {
    await psqlScalar(database, FIXTURE_SQL);
  }
  const after = await Promise.all(CRITICAL_TABLES.map(table => countRows(database, table)));
  for (const [index, table] of CRITICAL_TABLES.entries()) {
    if ((after[index] ?? 0) === 0) {
      throw new Error(`critical table ${table} still empty after fixture seeding in ${database}`);
    }
  }
}

function parseRunDir(backupStdout: string): string {
  const match = /^backup complete: (\S+) — artifact/m.exec(backupStdout);
  if (match === null) {
    throw new Error(`backup stdout did not name a run directory:\n${backupStdout}`);
  }
  return match[1];
}

async function spawnRestoreVerify(fromPath: string, targetDsn: string, envFileArg: string): Promise<SpawnOutcome> {
  return spawnCapture([
    process.execPath,
    "run",
    "ops:db-restore-verify",
    "--",
    "--from",
    fromPath,
    "--target",
    targetDsn,
    CONFIRMATION_FLAG,
    "--env",
    envFileArg,
  ]);
}

const scratchDatabases: string[] = [];
let tmpWorkspace = "";
let envFilePath = "";
/** The ops tools resolve `--env` against their cwd (repo root), so the file is passed as a repo-relative path. */
let envFileArg = "";
let backupsDir = "";
let sourceDb = "";
let targetDb = "";
let tamperDb = "";
let backupRunDir = "";

async function cleanup(): Promise<void> {
  const drops = scratchDatabases
    .splice(0)
    .map(database => spawnCapture(["dropdb", ...PG_BASE_ARGS, "--if-exists", database]));
  await Promise.all(drops);
  if (tmpWorkspace !== "") {
    rmSync(tmpWorkspace, { recursive: true, force: true });
    tmpWorkspace = "";
  }
}

describe("backup → restore-verify drill chain (real binaries, scratch databases)", () => {
  beforeAll(async () => {
    const stamp = Date.now().toString();
    sourceDb = `kottaby_dr_it_${stamp}_src`;
    targetDb = `kottaby_dr_it_${stamp}_dst`;
    tamperDb = `kottaby_dr_it_${stamp}_tamper`;
    for (const name of [sourceDb, targetDb, tamperDb]) {
      assertQuoteSafeName(name);
    }
    tmpWorkspace = mkdtempSync(join(tmpdir(), "kottaby-dr-it-"));
    backupsDir = join(tmpWorkspace, "backups");
    mkdirSync(backupsDir);
    envFilePath = join(tmpWorkspace, "scratch.env");
    writeFileSync(envFilePath, `DATABASE_URL=${scratchDsn(sourceDb)}\nDB_PROVIDER=postgres\n`);
    envFileArg = relative(REPO_ROOT, envFilePath);
    try {
      await createSourceCopy(sourceDb, tmpWorkspace);
      scratchDatabases.push(sourceDb);
      await createEmptyDatabase(targetDb);
      scratchDatabases.push(targetDb);
      await createEmptyDatabase(tamperDb);
      scratchDatabases.push(tamperDb);
      await seedCriticalFixtures(sourceDb);
    } catch (error) {
      await cleanup();
      throw error;
    }
  }, 180_000);

  afterAll(async () => {
    await cleanup();
  });

  test("real ops:db-backup publishes a verifiable artifact + manifest for the scratch source", async () => {
    expect(sourceDb).toMatch(SCRATCH_NAME_PATTERN);
    const outcome = await spawnCapture([
      process.execPath,
      "run",
      "ops:db-backup",
      "--env",
      envFileArg,
      "--out-dir",
      backupsDir,
    ]);
    if (outcome.exitCode !== 0) {
      throw new Error(`ops:db-backup exit ${outcome.exitCode}:\n${outcome.stdout}\n${outcome.stderr}`);
    }
    expect(outcome.exitCode).toBe(0);

    backupRunDir = parseRunDir(outcome.stdout);
    expect(existsSync(backupRunDir)).toBe(true);
    const artifactPath = join(backupRunDir, ARTIFACT_FILE_NAME);
    const manifestPath = join(backupRunDir, MANIFEST_FILE_NAME);
    expect(existsSync(artifactPath)).toBe(true);
    expect(existsSync(manifestPath)).toBe(true);
    expect(statSync(artifactPath).size).toBeGreaterThan(0);
    expect(statSync(artifactPath).mode & 0o777).toBe(0o600);
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);

    const manifest = parseJsonObject(readFileSync(manifestPath, "utf8"), MANIFEST_FILE_NAME);
    expect(requireString(manifest, "tool")).toBe("ops:db-backup");
    expect(requireString(manifest, "database")).toBe(sourceDb);
    const manifestSha256 = requireString(manifest, "sha256");
    expect(manifestSha256).toMatch(HEX64);
    expect(requireString(manifest, "journalHash")).toMatch(HEX64);
    expect(manifest.artifactBytes).toBe(statSync(artifactPath).size);
    const recomputedSha256 = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");
    expect(manifestSha256).toBe(recomputedSha256);
  }, 120_000);

  test("real ops:db-restore-verify restores into the scratch target with VERDICT: PASS", async () => {
    expect(backupRunDir).not.toBe("");
    const outcome = await spawnRestoreVerify(backupRunDir, scratchDsn(targetDb), envFileArg);
    if (outcome.exitCode !== 0) {
      throw new Error(`ops:db-restore-verify exit ${outcome.exitCode}:\n${outcome.stdout}\n${outcome.stderr}`);
    }
    expect(outcome.exitCode).toBe(0);
    expect(outcome.stdout).toContain("VERDICT: PASS");
    expect(outcome.stdout).not.toContain("VERDICT: FAIL");

    // The report file name is per-run (`restore-report-<UTC start stamp>.json`)
    // so repeat drills against the same retained artifact never collide with
    // a previous run's report. The drill ran once here — expect exactly one.
    const reportFiles = readdirSync(backupRunDir).filter(name => /^restore-report-\d{8}T\d{6}Z\.json$/u.test(name));
    expect(reportFiles).toHaveLength(1);
    const reportPath = join(backupRunDir, reportFiles[0] ?? "");
    expect(existsSync(reportPath)).toBe(true);
    expect(statSync(reportPath).mode & 0o777).toBe(0o600);
    const report: unknown = JSON.parse(readFileSync(reportPath, "utf8"));
    if (!isRestoredReport(report)) {
      throw new Error("restore report does not match the report contract");
    }
    expect(report.verdict).toBe("PASS");
    expect(report.target.database).toBe(targetDb);
    expect(typeof report.durationMs).toBe("number");
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.structural.length).toBeGreaterThan(0);
    for (const row of report.structural) {
      expect(row.ok).toBe(true);
      expect(row.present).toBe(true);
    }
    for (const table of CRITICAL_TABLES) {
      const row = report.structural.find(entry => entry.table === table);
      expect(row).toBeDefined();
      expect(row?.rowCount).toBeGreaterThan(0);
    }
    expect(report.oracles).toHaveLength(ORACLES.length);
    for (const oracle of report.oracles) {
      expect(oracle.passed).toBe(true);
    }
  }, 120_000);

  test("safety guard refuses a prod-shaped conninfo target before any restore process starts", async () => {
    expect(backupRunDir).not.toBe("");
    const outcome = await spawnRestoreVerify(
      backupRunDir,
      "host=prod-db.rds.amazonaws.com dbname=kottaby_dr_it_x",
      envFileArg
    );
    expect(outcome.exitCode).toBe(2);
    const combined = `${outcome.stdout}\n${outcome.stderr}`;
    expect(combined).toContain("[guard]");
    expect(combined).toContain("prod-db.rds.amazonaws.com");
    // Zero-spawn proxy: the guard fires before any pg_restore output exists.
    expect(combined).not.toContain("pg_restore completed");
  }, 120_000);

  test("tampered artifact refuses the restore and leaves the scratch target untouched", async () => {
    expect(backupRunDir).not.toBe("");
    const tamperedDir = join(tmpWorkspace, "tampered");
    mkdirSync(tamperedDir);
    const tamperedArtifact = join(tamperedDir, ARTIFACT_FILE_NAME);
    copyFileSync(join(backupRunDir, ARTIFACT_FILE_NAME), tamperedArtifact);
    copyFileSync(join(backupRunDir, MANIFEST_FILE_NAME), join(tamperedDir, MANIFEST_FILE_NAME));
    const bytes = readFileSync(tamperedArtifact);
    const flipIndex = Math.min(100, bytes.length - 1);
    bytes[flipIndex] = (bytes[flipIndex] ?? 0) ^ 0xff;
    writeFileSync(tamperedArtifact, bytes);
    chmodSync(tamperedArtifact, 0o600);

    const tablesBefore = await psqlScalar(tamperDb, USER_TABLE_COUNT_SQL);
    const outcome = await spawnRestoreVerify(tamperedDir, scratchDsn(tamperDb), envFileArg);
    expect(outcome.exitCode).toBe(1);
    const combined = `${outcome.stdout}\n${outcome.stderr}`;
    expect(combined).toContain("sha256 mismatch");
    expect(combined).toContain("refusing restore");
    expect(combined).not.toContain("pg_restore completed");

    const tablesAfter = await psqlScalar(tamperDb, USER_TABLE_COUNT_SQL);
    expect(Number.parseInt(tablesBefore, 10)).toBe(0);
    expect(Number.parseInt(tablesAfter, 10)).toBe(0);
  }, 120_000);
});
