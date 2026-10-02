/**
 * Colocated bun:test suite for the restore-verify tool family.
 *
 * 4-Tier unit strategy — NO real database, NO pg_restore/psql binaries:
 * every child-process interaction is driven through the implementation's
 * injectable SpawnRunner seam and the DSN never leaves the process.
 *
 *   Tier 1 — arg branches incl. every refusal, manifest load/validate,
 *            verdict aggregation, report contract shape.
 *   Tier 2 — boundaries: zero-row critical tables, missing run-dir fields,
 *            oracle exactly-0 vs errored (-1) distinction.
 *   Tier 3 — chaos: truncated dump, randomized missing manifest keys,
 *            oracle SQL error injection, artifact-hash nibble flip.
 *   Tier 4 — security: guard refusal matrix with spawn-spy, CLI exit codes,
 *            credential-leak greps over success + failure streams, report 0600.
 *
 * FIXTURE_PASSWORD below is the canary credential: no test may observe it in
 * any captured stdout/stderr stream or persisted report body.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { clearSelectedEnvFileForTests } from "@/scripts/dbActions/envFile";
import { DESTRUCTIVE_GUARD_ENV_KEYS, restoreProcessEnv, unsetProcessEnvVars } from "@/scripts/lib";
import { computeJournalHash } from "@/scripts/ops/backup-artifacts";
import {
  parseRestoreArgs,
  RESTORE_USAGE_TEXT,
  type RestoreCliArgs,
  RestoreUsageError,
} from "@/scripts/ops/restore-cli";
import {
  ORACLE_ERROR_OFFENDING_COUNT,
  ORACLES,
  type OracleDefinition,
  runOracles,
} from "@/scripts/ops/restore-oracles";
import {
  type BackupManifest,
  buildRestoreChildEnv,
  type Clock,
  MIGRATIONS_ABSENT_HASH,
  type PsqlOutcome,
  parseBackupManifest,
  RESTORE_TOOL_ID,
  RestoreArtifactError,
  redactTargetDatabaseName,
  resolveRunArtifact,
  restoreReportFileName,
  type SpawnRequest,
  type SpawnRunner,
} from "@/scripts/ops/restore-shared";
import {
  defaultReportFileWriter,
  evaluateVerdict,
  type RestoreReport,
  RestoreVerificationError,
  type StructuralCheckRow,
} from "@/scripts/ops/restore-structure";
import { type RestoreVerifyDeps, runRestoreVerify } from "@/scripts/ops/restore-verify";

// ─── Fixture constants ──────────────────────────────────────────────────────

const FIXTURE_PASSWORD = "supersecret-pw";
const SOURCE_PASSWORD = "source-pw-never-print";
const TARGET_DSN = `postgresql://restore_user:${FIXTURE_PASSWORD}@127.0.0.1:5432/scratch_restore`;
const NEON_TARGET_DSN = `postgresql://dr_user:${FIXTURE_PASSWORD}@ep-frosty-block-a1b2c3.us-east-2.aws.neon.tech/neondb?sslmode=require`;
const RDS_TARGET_DSN = `postgresql://dr_user:${FIXTURE_PASSWORD}@kottaby-verify.c9x8e2z7.us-east-1.rds.amazonaws.com/kottaby`;
const SOURCE_DSN = `postgresql://source_user:${SOURCE_PASSWORD}@127.0.0.1:5432/kottaby_source`;
const JOURNAL_HASH = "abcdef0123456789".repeat(4);
const ARTIFACT_BYTES = Buffer.from("PGDMP\tKOTTABY FAKE CUSTOM DUMP FIXTURE\n");
const ARTIFACT_SHA256 = createHash("sha256").update(ARTIFACT_BYTES).digest("hex");
const DERIVED_TABLES = ["app_settings", "audit_logs", "users", "wallet"];
const REPORT_FIELD_NAMES = [
  "artifactFile",
  "artifactSha256",
  "durationMs",
  "oracles",
  "startedAtUtc",
  "structural",
  "target",
  "tool",
  "verdict",
].toSorted((a, b) => a.localeCompare(b));
const CLOCK_BASE_MS = 1_770_000_000_000;
const CLI_SCRIPT_PATH = resolve(import.meta.dir, "restore-verify.ts");

const SCHEMA_SOURCE = [
  'import { pgTable, text } from "drizzle-orm/pg-core";',
  "",
  'export const users = pgTable("users", { id: text("id") });',
  'export const wallet = pgTable("wallet", { id: text("id") });',
  'export const auditLogs = pgTable("audit_logs", { id: text("id") });',
  'export const appSettings = pgTable("app_settings", { id: text("id") });',
  "",
].join("\n");

const ORACLE_SQL_TO_ID = new Map(ORACLES.map(oracle => [oracle.sql, oracle.id]));

// ─── Reusable fixture builders ──────────────────────────────────────────────

function validManifest(overrides: Partial<BackupManifest> = {}): BackupManifest {
  return {
    tool: "ops:db-backup",
    toolVersion: "1.0.0-test",
    postgresServerVersion: "16.4",
    pgDumpVersion: "16.4",
    database: "kottaby_source",
    startedAtUtc: "2026-02-14T12:00:00.000Z",
    finishedAtUtc: "2026-02-14T12:00:42.000Z",
    artifactFile: "dump.pgc",
    artifactBytes: ARTIFACT_BYTES.length,
    sha256: ARTIFACT_SHA256,
    journalHash: JOURNAL_HASH,
    ...overrides,
  };
}

function localEnvFixture(nodeEnv = "development", extraLines: string[] = []): string {
  return [
    `DATABASE_URL=${SOURCE_DSN}`,
    "DB_PROVIDER=postgres",
    "STORAGE_PROVIDER=local",
    "REDIS_PROVIDER=local",
    `NODE_ENV=${nodeEnv}`,
    ...extraLines,
    "",
  ].join("\n");
}

/** Run-dir collision counter — mirrors the backup family's "-2", "-3" suffixing convention. */
let backupRunCounter = 0;

function makeBackupRun(
  root: string,
  overrides: Partial<BackupManifest> = {}
): {
  runDir: string;
  artifactPath: string;
} {
  backupRunCounter += 1;
  const stamp = backupRunCounter === 1 ? "20260214T120000Z" : `20260214T120000Z-${backupRunCounter}`;
  const runDir = join(root, "backups", stamp);
  mkdirSync(runDir, { recursive: true });
  const artifactPath = join(runDir, "dump.pgc");
  writeFileSync(artifactPath, ARTIFACT_BYTES);
  writeFileSync(join(runDir, "manifest.json"), JSON.stringify(validManifest(overrides), null, 2));
  return { runDir, artifactPath };
}

function makeSchemaFixture(root: string): void {
  const schemaDir = join(root, "repo", "backend", "db", "schema");
  mkdirSync(schemaDir, { recursive: true });
  writeFileSync(join(schemaDir, "tables.ts"), SCHEMA_SOURCE);
}

// ─── Fake SpawnRunner (the implementation's DI seam) ────────────────────────

interface ScriptedProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

interface FakeDbScript {
  /** Table names returned for the structural presence query. */
  tables: string[];
  /** Restored (target) row counts per table for `SELECT COUNT(*) FROM "<t>"`. */
  targetCounts: Record<string, number>;
  /** Source row counts per table; present keys enable the source psql runner. */
  sourceCounts?: Record<string, number>;
  /** Value returned for the migrations-hash oracle (defaults to JOURNAL_HASH). */
  migrationsHash?: string;
  /** Per-table scripted outcome for structural `SELECT COUNT(*) FROM "<t>"` queries. */
  countOutcomes?: Record<string, ScriptedProcessResult>;
  /** Per-oracle-id scripted process outcome (default: exit 0, count "0"). */
  oracleOutcomes?: Record<string, ScriptedProcessResult>;
  /** Fail the structural presence query. */
  failPresenceQuery?: boolean;
  /** Make the fake runner REJECT when the psql SQL contains this substring. */
  throwOnSqlSubstring?: string;
  /** Scripted pg_restore outcome (default: exit 0). */
  pgRestore?: ScriptedProcessResult;
}

const okCount = (count: number): ScriptedProcessResult => ({ exitCode: 0, stdout: `${count}\n`, stderr: "" });

/** A scripted psql failure carrying the given stderr (e.g. a SQLSTATE-tagged error). */
const failedOutcome = (stderr: string): PsqlOutcome => ({ ok: false, value: "", stderr });

function makeFakeSpawn(script: FakeDbScript): { runner: SpawnRunner; requests: SpawnRequest[] } {
  const requests: SpawnRequest[] = [];
  const runner: SpawnRunner = async request => {
    requests.push({ cmd: request.cmd, args: [...request.args] });
    if (request.cmd === "pg_restore") {
      return script.pgRestore ?? { exitCode: 0, stdout: "", stderr: "" };
    }
    if (request.cmd === "psql") {
      const dsn = request.args[request.args.indexOf("--dbname") + 1] ?? "";
      const sql = request.args[request.args.indexOf("--command") + 1] ?? "";
      if (script.throwOnSqlSubstring !== undefined && sql.includes(script.throwOnSqlSubstring)) {
        throw new Error("fake psql chaos failure");
      }
      const oracleId = ORACLE_SQL_TO_ID.get(sql);
      if (oracleId !== undefined) {
        const scripted = script.oracleOutcomes?.[oracleId];
        if (scripted !== undefined) return scripted;
        if (oracleId === "OR-MIG") {
          return { exitCode: 0, stdout: `${script.migrationsHash ?? JOURNAL_HASH}\n`, stderr: "" };
        }
        return okCount(0);
      }
      if (sql.startsWith("SELECT tablename FROM pg_tables")) {
        if (script.failPresenceQuery === true) {
          return { exitCode: 1, stdout: "", stderr: "chaos: catalog unavailable" };
        }
        return { exitCode: 0, stdout: `${script.tables.join("\n")}\n`, stderr: "" };
      }
      const structuralCount = /^SELECT COUNT\(\*\) FROM "([A-Za-z_]\w*)"$/u.exec(sql);
      if (structuralCount !== null) {
        const table = structuralCount[1] ?? "";
        const scripted = script.countOutcomes?.[table];
        if (scripted !== undefined && dsn !== SOURCE_DSN) {
          return scripted;
        }
        const counts = dsn === SOURCE_DSN ? script.sourceCounts : script.targetCounts;
        return okCount(counts?.[table] ?? 0);
      }
      // Source-side bounded existence probe (see checkTable): route it to the
      // same sourceCounts fixture — the probe returns 0/1, and the pipeline
      // only consumes "any rows?" (sourceNonEmpty), so the exact fixture
      // counts stay meaningful (nonzero → probe 1).
      const sourceProbe = /^SELECT COUNT\(\*\) FROM \(SELECT 1 FROM "([A-Za-z_]\w*)" LIMIT 1\) probe$/u.exec(sql);
      if (sourceProbe !== null && dsn === SOURCE_DSN) {
        const table = sourceProbe[1] ?? "";
        const count = script.sourceCounts?.[table] ?? 0;
        return okCount(count > 0 ? 1 : 0);
      }
      return { exitCode: 1, stdout: "", stderr: "fake psql: unscripted query" };
    }
    throw new Error(`unexpected spawn request: ${request.cmd}`);
  };
  return { runner, requests };
}

function emptyScript(): FakeDbScript {
  return { tables: [], targetCounts: {} };
}

function healthyScript(): FakeDbScript {
  return {
    tables: DERIVED_TABLES,
    targetCounts: { users: 12, wallet: 7, audit_logs: 3, app_settings: 5 },
    sourceCounts: { users: 12, wallet: 7, audit_logs: 3, app_settings: 5 },
  };
}

function psqlTargetDsn(request: SpawnRequest): string | null {
  if (request.cmd !== "psql") return null;
  const index = request.args.indexOf("--dbname");
  return index >= 0 ? (request.args[index + 1] ?? null) : null;
}

// ─── Pipeline runner (DI orchestrator invocation) ───────────────────────────

interface PipelineRun {
  exitCode: number | null;
  thrown: unknown;
  stdout: string;
  stderr: string;
  reportPath: string | null;
  reportBody: string | null;
  report: RestoreReport | null;
  requests: SpawnRequest[];
}

interface PipelineOptions {
  from: string;
  script: FakeDbScript;
  /** null → omit `--target` entirely (exercises the no-default refusal). */
  targetDsn?: string | null;
  /** undefined → default local env fixture; null → omit `--env` entirely. */
  envFixture?: string | null;
  confirmed?: boolean;
  repoRoot?: string;
  clock?: Clock;
}

/** Oxlint-safe message extraction for caught unknowns (type-guard based). */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRestoreReport(value: unknown): value is RestoreReport {
  return (
    typeof value === "object" &&
    value !== null &&
    "tool" in value &&
    "artifactFile" in value &&
    "artifactSha256" in value &&
    "target" in value &&
    "startedAtUtc" in value &&
    "durationMs" in value &&
    "structural" in value &&
    "oracles" in value &&
    "verdict" in value
  );
}

function structuralRow(overrides: Partial<StructuralCheckRow> = {}): StructuralCheckRow {
  return { table: "users", present: true, rowCount: 3, sourceNonEmpty: true, ok: true, ...overrides };
}

/** Returns the rejection of `invocation` as a value (no expect().rejects). */
async function catchError(invocation: Promise<number>): Promise<unknown> {
  try {
    return await invocation;
  } catch (error) {
    return error;
  }
}

/** `--env` is resolved relative to the process cwd by the env bootstrap. */
function envArgFor(envFilePath: string): string {
  return relative(process.cwd(), envFilePath);
}

async function runPipeline(root: string, options: PipelineOptions): Promise<PipelineRun> {
  let envFilePath: string | null = null;
  if (options.envFixture !== null) {
    envFilePath = join(root, ".env.fixture");
    writeFileSync(envFilePath, options.envFixture ?? localEnvFixture());
  }

  const fake = makeFakeSpawn(options.script);
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  let reportPath: string | null = null;
  let reportBody: string | null = null;
  const captureReportFile = (path: string, contents: string): void => {
    reportPath = path;
    reportBody = contents;
    defaultReportFileWriter(path, contents);
  };

  const argv: string[] = ["--from", options.from];
  if (options.targetDsn !== null) argv.push("--target", options.targetDsn ?? TARGET_DSN);
  if (options.confirmed !== false) argv.push("--yes-i-understand");
  if (envFilePath !== null) argv.push("--env", envArgFor(envFilePath));
  const args: RestoreCliArgs = parseRestoreArgs(argv);

  const deps: RestoreVerifyDeps = {
    spawnRunner: fake.runner,
    repoRoot: options.repoRoot ?? join(root, "repo"),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    stdout: line => stdoutLines.push(line),
    stderr: line => stderrLines.push(line),
    writeReportFile: captureReportFile,
  };

  let exitCode: number | null = null;
  let thrown: unknown = null;
  try {
    exitCode = await runRestoreVerify(args, deps);
  } catch (error) {
    thrown = error;
  }

  const parsed: unknown = reportBody !== null ? JSON.parse(reportBody) : null;
  const report = isRestoreReport(parsed) ? parsed : null;
  return {
    exitCode,
    thrown,
    stdout: stdoutLines.join("\n"),
    stderr: stderrLines.join("\n"),
    reportPath,
    reportBody,
    report,
    requests: fake.requests,
  };
}

function runCliSubprocess(argv: string[]): { exitCode: number; stdout: string; stderr: string } {
  const proc = Bun.spawnSync([process.execPath, CLI_SCRIPT_PATH, ...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode ?? -1,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

function assertArgvArrayRequests(requests: SpawnRequest[]): void {
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(["pg_restore", "psql"]).toContain(request.cmd);
    expect(Array.isArray(request.args)).toBe(true);
    for (const arg of request.args) expect(typeof arg).toBe("string");
  }
}

// ─── Suite ──────────────────────────────────────────────────────────────────

describe("restore-verify tool family (4-tier)", () => {
  let tempRoot = "";
  let caseCounter = 0;
  let envSnapshot: Record<string, string | undefined> = {};

  const newCaseRoot = (): string => {
    caseCounter += 1;
    const root = join(tempRoot, `case-${String(caseCounter).padStart(3, "0")}`);
    mkdirSync(root, { recursive: true });
    return root;
  };

  const restoreEnvironment = (): void => {
    for (const key of Object.keys(process.env)) {
      if (!Object.hasOwn(envSnapshot, key)) delete process.env[key];
    }
    restoreProcessEnv(envSnapshot);
    clearSelectedEnvFileForTests();
  };

  beforeAll(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "kottaby-restore-verify-"));
  });

  afterAll(() => {
    restoreEnvironment();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  beforeEach(() => {
    envSnapshot = { ...process.env };
    unsetProcessEnvVars(DESTRUCTIVE_GUARD_ENV_KEYS);
  });

  afterEach(() => {
    restoreEnvironment();
  });

  describe("tier 1: argument contract, manifest validation, verdict, report shape", () => {
    test("parseRestoreArgs accepts documented flags in both value forms", () => {
      const spaced = parseRestoreArgs(["--from", "run-dir", "--target", "postgresql://u:p@h/db", "--yes-i-understand"]);
      expect(spaced).toEqual({
        showHelp: false,
        envFile: null,
        from: "run-dir",
        targetDsn: "postgresql://u:p@h/db",
        confirmed: true,
      });

      const fixtureEnvPath = join(import.meta.dir, "fixtures", "restore-env.file");
      const inline = parseRestoreArgs(["--from=run-dir", `--env=${fixtureEnvPath}`, "-h"]);
      expect(inline.from).toBe("run-dir");
      expect(inline.envFile).toBe(fixtureEnvPath);
      expect(inline.showHelp).toBe(true);
      expect(inline.confirmed).toBe(false);
    });

    test("usage refusals exit 2 through the real CLI (no default target, no default source)", () => {
      const caseRoot = newCaseRoot();
      const missingTarget = runCliSubprocess(["--from", join(caseRoot, "run"), "--yes-i-understand"]);
      expect(missingTarget.exitCode).toBe(2);
      expect(missingTarget.stderr).toContain("--target is REQUIRED");
      expect(missingTarget.stderr).toContain("no default");

      const missingFrom = runCliSubprocess(["--target", TARGET_DSN, "--yes-i-understand"]);
      expect(missingFrom.exitCode).toBe(2);
      expect(missingFrom.stderr).toContain("--from is REQUIRED");

      const unknownFlag = runCliSubprocess([
        "--from",
        "run",
        "--target",
        TARGET_DSN,
        "--yes-i-understand",
        "--restore-anyway",
      ]);
      expect(unknownFlag.exitCode).toBe(2);
      expect(unknownFlag.stderr).toContain('unknown argument "--restore-anyway"');

      const envFile = join(caseRoot, ".env.fixture");
      writeFileSync(envFile, localEnvFixture());
      const unconfirmed = runCliSubprocess([
        "--from",
        join(caseRoot, "run"),
        "--target",
        TARGET_DSN,
        "--env",
        envArgFor(envFile),
      ]);
      expect(unconfirmed.exitCode).toBe(2);
      expect(unconfirmed.stderr).toContain("--yes-i-understand");
      expect(unconfirmed.stderr).toContain("refusing to restore without explicit confirmation");
    });

    test("--help exits 0 and prints the usage text", () => {
      const run = runCliSubprocess(["--help"]);
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("Usage:");
      expect(run.stdout).toContain(RESTORE_USAGE_TEXT);
    });

    test("orchestrator refuses missing target/from with typed usage errors", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const missingTarget = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: emptyScript(),
        targetDsn: null,
      });
      expect(missingTarget.thrown).toBeInstanceOf(RestoreUsageError);
      expect(messageOf(missingTarget.thrown)).toContain("--target is REQUIRED");
      expect(messageOf(missingTarget.thrown)).toContain("no default");
      expect(missingTarget.requests).toHaveLength(0);

      const emptyParse = parseRestoreArgs([]);
      expect(emptyParse.targetDsn).toBeNull();
      expect(emptyParse.from).toBeNull();

      const missingFrom = parseRestoreArgs(["--target", TARGET_DSN, "--yes-i-understand"]);
      const caught = await catchError(
        runRestoreVerify(missingFrom, {
          spawnRunner: makeFakeSpawn(emptyScript()).runner,
          repoRoot: join(caseRoot, "repo"),
          stdout: () => undefined,
          stderr: () => undefined,
        })
      );
      expect(caught).toBeInstanceOf(RestoreUsageError);
      expect(messageOf(caught)).toContain("--from is REQUIRED");
    });

    test("value-flag edge cases: missing, empty, flag-like values, and duplicates", () => {
      expect(() => parseRestoreArgs(["--target"])).toThrow(/--target requires a value/);
      expect(() => parseRestoreArgs(["--target", ""])).toThrow(/--target requires a value/);
      expect(() => parseRestoreArgs(["--target", "--yes-i-understand"])).toThrow(/--target requires a value/);
      expect(() => parseRestoreArgs(["--target", "--yes-i-understand"])).toThrow(
        /got the flag-like value "--yes-i-understand"/
      );
      expect(() => parseRestoreArgs(["--target"])).toThrow(/got none/);
      expect(() => parseRestoreArgs(["--from", "a", "--from", "b"])).toThrow(/--from was given more than once/);
      expect(() => parseRestoreArgs(["--target=x", "--target=y"])).toThrow(/--target was given more than once/);
      expect(() => parseRestoreArgs(["--env=a", "--env=b"])).toThrow(/--env was given more than once/);
      expect(() => parseRestoreArgs(["--yes-i-understand", "--yes-i-understand"])).toThrow(
        /--yes-i-understand was given more than once/
      );
    });

    test("explicit --env bootstrap failure is fatal (exit-2-class usage error)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const args = parseRestoreArgs([
        "--from",
        fixture.runDir,
        "--target",
        TARGET_DSN,
        "--yes-i-understand",
        "--env",
        envArgFor(join(caseRoot, ".env.does-not-exist")),
      ]);

      const caught = await catchError(
        runRestoreVerify(args, {
          spawnRunner: makeFakeSpawn(emptyScript()).runner,
          repoRoot: join(caseRoot, "repo"),
          stdout: () => undefined,
          stderr: () => undefined,
        })
      );
      expect(caught).toBeInstanceOf(RestoreUsageError);
      expect(messageOf(caught)).toContain("env bootstrap failed");
    });

    test("an ABSOLUTE --env path bootstraps (cwd-independent)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const envFile = join(caseRoot, "abs.env.fixture");
      writeFileSync(envFile, localEnvFixture());

      const args = parseRestoreArgs([
        "--from",
        fixture.runDir,
        "--target",
        TARGET_DSN,
        "--yes-i-understand",
        "--env",
        envFile,
      ]);
      const fake = makeFakeSpawn(healthyScript());
      const stdoutLines: string[] = [];
      const exitCode = await runRestoreVerify(args, {
        spawnRunner: fake.runner,
        repoRoot: join(caseRoot, "repo"),
        stdout: line => stdoutLines.push(line),
        stderr: () => undefined,
      });
      expect(exitCode).toBe(0);
      expect(stdoutLines.join("\n")).toContain("VERDICT: PASS");
      expect(fake.requests.some(request => request.cmd === "pg_restore")).toBe(true);
    });

    test("missing default .env is non-fatal and skips source row-count comparisons", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const originalCwd = process.cwd();
      process.chdir(caseRoot);
      try {
        const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript(), envFixture: null });
        expect(run.thrown).toBeNull();
        expect(run.exitCode).toBe(0);
        expect(run.stderr).toContain("[env] proceeding without source-database context");
        for (const request of run.requests) {
          const dsn = psqlTargetDsn(request);
          expect(dsn === null || dsn === TARGET_DSN).toBe(true);
        }
        for (const row of run.report?.structural ?? []) expect(row.sourceNonEmpty).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    test("manifest validation accepts a well-formed manifest and the migrations-absent sentinel", () => {
      const parsed = parseBackupManifest(JSON.stringify(validManifest()));
      expect(parsed).toEqual(validManifest());

      const absent = parseBackupManifest(JSON.stringify(validManifest({ journalHash: MIGRATIONS_ABSENT_HASH })));
      expect(absent.journalHash).toBe(MIGRATIONS_ABSENT_HASH);
    });

    test("manifest validation fails closed on each missing field", () => {
      const base = validManifest();
      for (const field of Object.keys(base)) {
        const clone: Record<string, unknown> = { ...base };
        delete clone[field];
        expect(() => parseBackupManifest(JSON.stringify(clone))).toThrow(RestoreArtifactError);
        expect(() => parseBackupManifest(JSON.stringify(clone))).toThrow(new RegExp(`"${field}"`));
      }
    });

    test("manifest validation rejects malformed values", () => {
      const base = validManifest();
      expect(() => parseBackupManifest(JSON.stringify({ ...base, tool: "ops:db-restore-verify" }))).toThrow(
        /not a database backup manifest/
      );
      expect(() => parseBackupManifest(JSON.stringify({ ...base, sha256: ARTIFACT_SHA256.toUpperCase() }))).toThrow(
        /64-hex/
      );
      expect(() => parseBackupManifest(JSON.stringify({ ...base, sha256: "abc123" }))).toThrow(/64-hex/);
      expect(() => parseBackupManifest(JSON.stringify({ ...base, journalHash: "not-a-hash" }))).toThrow(/journalHash/);
      expect(() => parseBackupManifest(JSON.stringify({ ...base, artifactBytes: 0 }))).toThrow(/positive integer/);
      expect(() => parseBackupManifest(JSON.stringify({ ...base, artifactBytes: 1.5 }))).toThrow(/positive integer/);
      expect(() => parseBackupManifest(JSON.stringify({ ...base, artifactBytes: "9" }))).toThrow(/positive integer/);
      expect(() => parseBackupManifest("not-json{")).toThrow(/not valid JSON/);
      expect(() => parseBackupManifest("[1, 2]")).toThrow(/not a JSON object/);
    });

    test("manifest artifactFile must be a bare file name (traversal is the tamper-fail class)", () => {
      const base = validManifest();
      for (const artifactFile of ["../../etc/hostname", "sub/dir/dump.pgc", "dir\\dump.pgc", "..", "dump..pgc"]) {
        expect(() => parseBackupManifest(JSON.stringify({ ...base, artifactFile }))).toThrow(RestoreArtifactError);
        expect(() => parseBackupManifest(JSON.stringify({ ...base, artifactFile }))).toThrow(/bare file name/);
      }
      // A benign bare name still parses.
      expect(parseBackupManifest(JSON.stringify(base)).artifactFile).toBe("dump.pgc");
    });

    test("verdict aggregation: FAIL on any structural, oracle, or hash failure", () => {
      const goodOracle = { passed: true };

      expect(evaluateVerdict([structuralRow()], [goodOracle], true)).toBe("PASS");
      expect(evaluateVerdict([], [], true)).toBe("PASS");
      expect(evaluateVerdict([structuralRow({ ok: false })], [goodOracle], true)).toBe("FAIL");
      expect(evaluateVerdict([structuralRow({ present: false, ok: false })], [], true)).toBe("FAIL");
      expect(evaluateVerdict([structuralRow()], [{ passed: false }], true)).toBe("FAIL");
      expect(evaluateVerdict([structuralRow()], [goodOracle], false)).toBe("FAIL");
    });

    test("structural failure (missing critical table) fails the verdict", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const script: FakeDbScript = { ...healthyScript(), tables: ["app_settings", "users", "wallet"] };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.report?.verdict).toBe("FAIL");
      expect(run.stdout).toContain("VERDICT: FAIL");
      expect(run.stderr).toContain('missing table "audit_logs"');
      const auditRow = run.report?.structural.find(candidate => candidate.table === "audit_logs");
      expect(auditRow?.present).toBe(false);
      expect(auditRow?.ok).toBe(false);
    });

    test("oracle failure (5 offending rows) fails the verdict with tagged stderr", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const script: FakeDbScript = { ...healthyScript(), oracleOutcomes: { "OR-W1": okCount(5) } };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      const walletOracle = run.report?.oracles.find(oracle => oracle.id === "OR-W1");
      expect(walletOracle?.passed).toBe(false);
      expect(walletOracle?.offendingCount).toBe(5);
      expect(run.stderr).toContain("[verify:OR-W1] 5 offending row(s)");
      expect(run.stdout).toContain("oracles 6/7 passed");
      expect(run.stdout).toContain("VERDICT: FAIL");
    });

    test("hash mismatch refuses restore before verification: no spawn, no report", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot, { sha256: "0".repeat(64) });

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript() });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("[verify] artifact sha256 mismatch");
      expect(run.stderr).toContain("refusing restore");
      expect(run.requests).toHaveLength(0);
      expect(run.reportPath).toBeNull();
      expect(run.stdout).not.toContain("VERDICT:");
    });

    test("PASS run: exact report contract, redaction, argv contract, durationMs, mode 0600", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      let ticks = 0;
      const clock: Clock = () => {
        ticks += 1;
        return new Date(CLOCK_BASE_MS + (ticks - 1) * 5_000);
      };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript(), clock });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(ticks).toBe(2);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.stdout).not.toContain("VERDICT: FAIL");
      expect(run.stdout).toContain('target database "scratch_restore"');
      expect(run.stdout).toContain('backed-up database: "kottaby_source"');
      expect(run.stdout).toContain("restore-verify: artifact sha256 verified");
      expect(run.stdout).toContain("structural checks 4/4 ok");
      expect(run.stdout).toContain("audit_logs=3");
      expect(run.stdout).toContain("users=12");
      expect(run.stdout).toContain("oracles 7/7 passed");

      const report = run.report;
      expect(report).not.toBeNull();
      expect(Object.keys(report ?? {}).toSorted((a, b) => a.localeCompare(b))).toEqual(REPORT_FIELD_NAMES);
      expect(report?.tool).toBe(RESTORE_TOOL_ID);
      expect(report?.artifactFile).toBe("dump.pgc");
      expect(report?.artifactSha256).toBe(ARTIFACT_SHA256);
      expect(report?.target).toEqual({ database: "scratch_restore" });
      expect(report?.verdict).toBe("PASS");
      expect(typeof report?.durationMs).toBe("number");
      expect(report?.durationMs).toBe(5_000);
      const startedAtUtc = report?.startedAtUtc ?? "";
      expect(new Date(startedAtUtc).toISOString()).toBe(startedAtUtc);

      expect(report?.structural.map(row => row.table)).toEqual(DERIVED_TABLES);
      const appSettings = report?.structural.find(row => row.table === "app_settings");
      expect(appSettings?.rowCount).toBe(-1);
      expect(appSettings?.sourceNonEmpty).toBe(false);
      expect(appSettings?.ok).toBe(true);
      const users = report?.structural.find(row => row.table === "users");
      expect(users?.rowCount).toBe(12);
      expect(users?.sourceNonEmpty).toBe(true);
      expect(users?.ok).toBe(true);
      expect(report?.oracles.map(oracle => oracle.id)).toEqual(ORACLES.map(oracle => oracle.id));
      for (const oracle of report?.oracles ?? []) {
        expect(oracle.passed).toBe(true);
        expect(oracle.offendingCount).toBe(0);
      }

      // Per-run report name derived from the run's injected start tick —
      // the run directory is retained, so a fixed name would collide on a
      // repeat drill against the same artifact (writer fails closed).
      expect(run.reportPath).toBe(join(fixture.runDir, restoreReportFileName(new Date(CLOCK_BASE_MS))));
      expect(statSync(run.reportPath ?? "").mode & 0o777).toBe(0o600);

      expect(run.reportBody).not.toContain("127.0.0.1");
      expect(run.reportBody).not.toContain("restore_user");
      expect(run.reportBody).not.toContain(FIXTURE_PASSWORD);

      assertArgvArrayRequests(run.requests);
      const restoreRequest = run.requests.find(request => request.cmd === "pg_restore");
      expect(restoreRequest?.args).toEqual([
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        TARGET_DSN,
        fixture.artifactPath,
      ]);
    });
  });

  describe("tier 2: boundaries", () => {
    test("zero-row critical table fails only when the source held data", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const emptySource = { users: 0, wallet: 7, audit_logs: 3, app_settings: 5 };
      const failedRun = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: { ...healthyScript(), targetCounts: emptySource },
      });
      expect(failedRun.thrown).toBeNull();
      expect(failedRun.exitCode).toBe(1);
      const usersRow = failedRun.report?.structural.find(row => row.table === "users");
      expect(usersRow?.present).toBe(true);
      expect(usersRow?.rowCount).toBe(0);
      expect(usersRow?.sourceNonEmpty).toBe(true);
      expect(usersRow?.ok).toBe(false);
      expect(failedRun.stderr).toContain('critical table "users" restored to 0 rows');
      expect(failedRun.stdout).toContain("VERDICT: FAIL");

      // Fresh run dir per pipeline run: the report writer refuses to
      // overwrite a pre-existing restore-report.json (clobber guard).
      const passedFixture = makeBackupRun(caseRoot);
      const zeroEverywhere = { users: 0, wallet: 0, audit_logs: 0, app_settings: 0 };
      const passedRun = await runPipeline(caseRoot, {
        from: passedFixture.runDir,
        script: {
          ...healthyScript(),
          targetCounts: zeroEverywhere,
          sourceCounts: zeroEverywhere,
        },
      });
      expect(passedRun.thrown).toBeNull();
      expect(passedRun.exitCode).toBe(0);
      const passedUsersRow = passedRun.report?.structural.find(row => row.table === "users");
      expect(passedUsersRow?.rowCount).toBe(0);
      expect(passedUsersRow?.sourceNonEmpty).toBe(false);
      expect(passedUsersRow?.ok).toBe(true);
      expect(passedRun.stdout).toContain("VERDICT: PASS");
    });

    test("run-dir resolution refuses missing manifest, missing dump, and non-file artifacts", () => {
      const caseRoot = newCaseRoot();

      expect(() => resolveRunArtifact(join(caseRoot, "absent"))).toThrow(RestoreArtifactError);
      expect(() => resolveRunArtifact(join(caseRoot, "absent"))).toThrow(/does not exist or is unreadable/);

      const bareDir = join(caseRoot, "bare-run");
      mkdirSync(bareDir);
      writeFileSync(join(bareDir, "dump.pgc"), ARTIFACT_BYTES);
      expect(() => resolveRunArtifact(bareDir)).toThrow(/manifest not found/);

      const lonelyArtifact = join(caseRoot, "lonely.pgc");
      writeFileSync(lonelyArtifact, ARTIFACT_BYTES);
      expect(() => resolveRunArtifact(lonelyArtifact)).toThrow(/manifest not found/);

      const noDumpDir = join(caseRoot, "no-dump-run");
      mkdirSync(noDumpDir);
      writeFileSync(join(noDumpDir, "manifest.json"), JSON.stringify(validManifest({ artifactFile: "missing.pgc" })));
      expect(() => resolveRunArtifact(noDumpDir)).toThrow(/artifact does not exist or is unreadable/);

      const dirArtifactRun = join(caseRoot, "dir-artifact-run");
      mkdirSync(dirArtifactRun);
      mkdirSync(join(dirArtifactRun, "dump.pgc"));
      writeFileSync(join(dirArtifactRun, "manifest.json"), JSON.stringify(validManifest()));
      expect(() => resolveRunArtifact(dirArtifactRun)).toThrow(/artifact is not a regular file/);
    });

    test("run-dir resolution refuses a symlinked artifact escaping the --from directory (realpath)", () => {
      const caseRoot = newCaseRoot();
      const fixture = makeBackupRun(caseRoot);

      // A tampered run directory whose `dump.pgc` is a symlink pointing at an
      // artifact OUTSIDE the directory: bare-name validation cannot see it,
      // so the realpath containment check must refuse it.
      const evilDir = join(caseRoot, "evil-run");
      mkdirSync(evilDir);
      copyFileSync(join(fixture.runDir, "manifest.json"), join(evilDir, "manifest.json"));
      symlinkSync(fixture.artifactPath, join(evilDir, "dump.pgc"));
      expect(() => resolveRunArtifact(evilDir)).toThrow(RestoreArtifactError);
      expect(() => resolveRunArtifact(evilDir)).toThrow(/outside the --from directory/);

      // The honest layout still resolves, and the actual byte size is exposed
      // for the caller's manifest cross-check.
      const resolved = resolveRunArtifact(fixture.runDir);
      expect(resolved.artifactSize).toBe(ARTIFACT_BYTES.length);
    });

    test("oracle results distinguish a clean zero from an errored evaluation (-1)", async () => {
      const registry: OracleDefinition[] = [
        { id: "T-COUNT-ZERO", description: "count is zero", invariantAnchor: "test", sql: "SELECT 1" },
        { id: "T-PSQL-ERROR", description: "psql errored", invariantAnchor: "test", sql: "SELECT 2" },
        { id: "T-RUNNER-THREW", description: "runner threw", invariantAnchor: "test", sql: "SELECT 3" },
        {
          id: "T-VALUE-MATCH",
          description: "value matches",
          invariantAnchor: "test",
          sql: "SELECT 4",
          expected: { kind: "migrationJournalHash" },
        },
        {
          id: "T-VALUE-DRIFT",
          description: "value drifts",
          invariantAnchor: "test",
          sql: "SELECT 5",
          expected: { kind: "migrationJournalHash" },
        },
      ];
      const results = await runOracles(
        async sql => {
          if (sql === "SELECT 3") throw new Error("chaos: runner exploded");
          const outcome: PsqlOutcome = { ok: true, value: "0", stderr: "" };
          if (sql === "SELECT 2") return { ok: false, value: "", stderr: "psql: server closed the connection" };
          if (sql === "SELECT 4") return { ok: true, value: JOURNAL_HASH, stderr: "" };
          if (sql === "SELECT 5") return { ok: true, value: JOURNAL_HASH.slice(0, 16), stderr: "" };
          return outcome;
        },
        { journalHash: JOURNAL_HASH },
        registry
      );

      const byId = new Map(results.map(result => [result.id, result]));
      expect(byId.get("T-COUNT-ZERO")).toEqual({
        id: "T-COUNT-ZERO",
        description: "count is zero",
        passed: true,
        offendingCount: 0,
      });
      expect(byId.get("T-PSQL-ERROR")?.passed).toBe(false);
      expect(byId.get("T-PSQL-ERROR")?.offendingCount).toBe(ORACLE_ERROR_OFFENDING_COUNT);
      expect(byId.get("T-RUNNER-THREW")?.passed).toBe(false);
      expect(byId.get("T-RUNNER-THREW")?.offendingCount).toBe(ORACLE_ERROR_OFFENDING_COUNT);
      expect(byId.get("T-VALUE-MATCH")?.passed).toBe(true);
      expect(byId.get("T-VALUE-MATCH")?.offendingCount).toBe(0);
      expect(byId.get("T-VALUE-DRIFT")?.passed).toBe(false);
      expect(byId.get("T-VALUE-DRIFT")?.offendingCount).toBe(1);
    });

    test("OR-MIG compares a fixture-derived trailing migration hash (drizzle derivation, not an echo)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // A fixture journal in the drizzle-orm layout: the manifest hash is
      // derived from the folder exactly as the backup derives it, while the
      // fake scratch DB returns the hash of the SAME trailing file content
      // computed independently — the two derivations must agree.
      const journal = join(caseRoot, "backend", "drizzle");
      mkdirSync(join(journal, "20260101000000_first"), { recursive: true });
      const firstSql = "CREATE TABLE journal_probe_a (id integer);\n";
      writeFileSync(join(journal, "20260101000000_first", "migration.sql"), firstSql);
      mkdirSync(join(journal, "20260102000000_second"), { recursive: true });
      const trailingSql = "ALTER TABLE journal_probe_a ADD COLUMN note text;\n";
      writeFileSync(join(journal, "20260102000000_second", "migration.sql"), trailingSql);

      const manifestHash = computeJournalHash(journal);
      expect(manifestHash).toBe(createHash("sha256").update(trailingSql).digest("hex"));
      const fixture = makeBackupRun(caseRoot, { journalHash: manifestHash });

      const trailingHashFromDb = createHash("sha256")
        .update(readFileSync(join(journal, "20260102000000_second", "migration.sql"), "utf8"))
        .digest("hex");
      const passRun = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: { ...healthyScript(), migrationsHash: trailingHashFromDb },
      });
      expect(passRun.thrown).toBeNull();
      expect(passRun.exitCode).toBe(0);
      expect(passRun.stdout).toContain("oracles 7/7 passed");

      // A restored DB whose trailing hash matches an OLDER journal migration
      // (content drift) fails OR-MIG and the verdict.
      const staleHash = createHash("sha256").update(firstSql).digest("hex");
      const driftFixture = makeBackupRun(caseRoot, { journalHash: manifestHash });
      const driftRun = await runPipeline(caseRoot, {
        from: driftFixture.runDir,
        script: { ...healthyScript(), migrationsHash: staleHash },
      });
      expect(driftRun.thrown).toBeNull();
      expect(driftRun.exitCode).toBe(1);
      const migOracle = driftRun.report?.oracles.find(oracle => oracle.id === "OR-MIG");
      expect(migOracle?.passed).toBe(false);
      expect(migOracle?.offendingCount).toBe(1);
      expect(driftRun.stderr).toContain("[verify:OR-MIG] 1 offending");
      expect(driftRun.stdout).toContain("VERDICT: FAIL");
    });

    test("OR-MIG: journal-less manifest matches absent tracking; real hash + absent tracking FAILS", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // Journal-less source: the backup itself recorded MIGRATIONS_ABSENT_HASH
      // and the restored scratch DB tracks no migrations either — strict
      // equality matches (sentinel === sentinel), the oracle passes.
      const pushFixture = makeBackupRun(caseRoot, { journalHash: MIGRATIONS_ABSENT_HASH });
      const absentRun = await runPipeline(caseRoot, {
        from: pushFixture.runDir,
        script: { ...healthyScript(), migrationsHash: MIGRATIONS_ABSENT_HASH },
      });
      expect(absentRun.thrown).toBeNull();
      expect(absentRun.exitCode).toBe(0);
      const absentOracle = absentRun.report?.oracles.find(oracle => oracle.id === "OR-MIG");
      expect(absentOracle?.passed).toBe(true);
      expect(absentOracle?.offendingCount).toBe(0);

      // The inverse is a genuine inconsistency: the journal claims no
      // migrations, yet the restored database carries applied migration rows.
      const rowsFixture = makeBackupRun(caseRoot, { journalHash: MIGRATIONS_ABSENT_HASH });
      const rowsRun = await runPipeline(caseRoot, {
        from: rowsFixture.runDir,
        script: { ...healthyScript(), migrationsHash: JOURNAL_HASH },
      });
      expect(rowsRun.exitCode).toBe(1);
      const rowsOracle = rowsRun.report?.oracles.find(oracle => oracle.id === "OR-MIG");
      expect(rowsOracle?.passed).toBe(false);
      expect(rowsRun.stdout).toContain("VERDICT: FAIL");

      // Zero-tolerance regression pin: a MIGRATE-managed source (real journal
      // fingerprint) whose restored database LOST its tracking table/rows
      // must FAIL — an unverifiable identity is a divergence, never a pass
      // (the old unconditional sentinel tolerance swallowed exactly this).
      const lostTrackingFixture = makeBackupRun(caseRoot);
      const lostTrackingRun = await runPipeline(caseRoot, {
        from: lostTrackingFixture.runDir,
        script: { ...healthyScript(), migrationsHash: MIGRATIONS_ABSENT_HASH },
      });
      expect(lostTrackingRun.thrown).toBeNull();
      expect(lostTrackingRun.exitCode).toBe(1);
      const lostTrackingOracle = lostTrackingRun.report?.oracles.find(oracle => oracle.id === "OR-MIG");
      expect(lostTrackingOracle?.passed).toBe(false);
      expect(lostTrackingOracle?.offendingCount).toBe(1);
      expect(lostTrackingRun.stderr).toContain("[verify:OR-MIG] 1 offending");
      expect(lostTrackingRun.stdout).toContain("VERDICT: FAIL");
    });

    test("an unverifiable critical row count fails closed (ok=false, verdict FAIL)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: {
          ...healthyScript(),
          countOutcomes: { users: { exitCode: 1, stdout: "", stderr: "psql: server closed the connection" } },
        },
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      const usersRow = run.report?.structural.find(row => row.table === "users");
      expect(usersRow?.present).toBe(true);
      expect(usersRow?.rowCount).toBe(-1);
      expect(usersRow?.ok).toBe(false);
      expect(run.stderr).toContain('row count query failed for "users"');
      expect(run.stdout).toContain("VERDICT: FAIL");
    });

    test("errored oracle is recorded as -1 while clean zeros stay 0 (not conflated)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const script: FakeDbScript = {
        ...healthyScript(),
        oracleOutcomes: { "OR-B1": { exitCode: 1, stdout: "", stderr: "psql: FATAL: terminating connection" } },
      };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      const holdsOracle = run.report?.oracles.find(oracle => oracle.id === "OR-B1");
      expect(holdsOracle?.passed).toBe(false);
      expect(holdsOracle?.offendingCount).toBe(-1);
      const walletOracle = run.report?.oracles.find(oracle => oracle.id === "OR-W1");
      expect(walletOracle?.passed).toBe(true);
      expect(walletOracle?.offendingCount).toBe(0);
      expect(run.stderr).toContain("[verify:OR-B1] oracle errored");
      expect(run.stdout).toContain("VERDICT: FAIL");
    });
  });

  describe("tier 3: chaos", () => {
    test("chaos: truncated dump file trips the sha256 mismatch path", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      writeFileSync(fixture.artifactPath, ARTIFACT_BYTES.subarray(0, 9));

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript() });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("[verify] artifact sha256 mismatch");
      expect(run.requests).toHaveLength(0);
      expect(run.reportPath).toBeNull();
    });

    test("chaos: manifests missing randomized key subsets always fail closed", () => {
      const caseRoot = newCaseRoot();
      const runDir = join(caseRoot, "randomized-run");
      mkdirSync(runDir);
      writeFileSync(join(runDir, "dump.pgc"), ARTIFACT_BYTES);
      const manifestPath = join(runDir, "manifest.json");

      const base = validManifest();
      const keys = Object.keys(base);
      const hitCounts = new Map(keys.map(key => [key, 0]));
      let seed = 0x5f3759df;
      const nextRandom = (bound: number): number => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed % bound;
      };

      for (let trial = 0; trial < 40; trial++) {
        const clone: Record<string, unknown> = { ...base };
        const drops = 1 + nextRandom(keys.length);
        for (let dropped = 0; dropped < drops; dropped++) {
          const key = keys.at(nextRandom(keys.length));
          if (key !== undefined) {
            delete clone[key];
            hitCounts.set(key, (hitCounts.get(key) ?? 0) + 1);
          }
        }
        writeFileSync(manifestPath, JSON.stringify(clone));
        expect(() => resolveRunArtifact(runDir)).toThrow(RestoreArtifactError);
      }

      for (const hits of hitCounts.values()) expect(hits).toBeGreaterThan(0);
    });

    test("chaos: oracle SQL error injection fails the verdict without crashing", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const garbageRun = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: {
          ...healthyScript(),
          oracleOutcomes: { "OR-U2": { exitCode: 1, stdout: "PSQL-CHAOS-GARBAGE", stderr: "psql: syntax chaos" } },
        },
      });
      expect(garbageRun.thrown).toBeNull();
      expect(garbageRun.exitCode).toBe(1);
      const historyOracle = garbageRun.report?.oracles.find(oracle => oracle.id === "OR-U2");
      expect(historyOracle?.passed).toBe(false);
      expect(historyOracle?.offendingCount).toBe(-1);
      expect(garbageRun.reportPath).not.toBeNull();
      expect(garbageRun.stdout).toContain("VERDICT: FAIL");

      const throwFixture = makeBackupRun(caseRoot);
      const throwRun = await runPipeline(caseRoot, {
        from: throwFixture.runDir,
        script: { ...healthyScript(), throwOnSqlSubstring: "FROM audit_logs a LEFT JOIN users u" },
      });
      expect(throwRun.thrown).toBeNull();
      expect(throwRun.exitCode).toBe(1);
      const actorOracle = throwRun.report?.oracles.find(oracle => oracle.id === "OR-U1");
      expect(actorOracle?.passed).toBe(false);
      expect(actorOracle?.offendingCount).toBe(-1);
      expect(throwRun.stdout).toContain("VERDICT: FAIL");
    });

    test("chaos: unreadable restored catalog surfaces a typed verification error", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: { ...healthyScript(), failPresenceQuery: true },
      });
      expect(run.thrown).toBeInstanceOf(RestoreVerificationError);
      expect(messageOf(run.thrown)).toContain("could not list restored tables");
      expect(run.requests[0]?.cmd).toBe("pg_restore");
      expect(run.reportPath).toBeNull();
    });

    test("chaos: flipping one manifest-hash nibble exits 1 with zero restore spawns", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const tampered = ARTIFACT_SHA256.startsWith("a")
        ? `b${ARTIFACT_SHA256.slice(1)}`
        : `a${ARTIFACT_SHA256.slice(1)}`;
      const fixture = makeBackupRun(caseRoot, { sha256: tampered });

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript() });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("[verify] artifact sha256 mismatch");
      expect(run.stderr).toContain(ARTIFACT_SHA256);
      expect(run.requests).toHaveLength(0);
      expect(run.reportPath).toBeNull();
    });

    test("chaos: manifest artifactBytes disagreeing with the artifact size refuses before any spawn", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // The recorded sha256 still matches the actual artifact; only the byte
      // size is wrong (tampered / mispaired manifest) — the size cross-check
      // refuses it in the tamper-fail class.
      const wrongBytes = ARTIFACT_BYTES.length + 7;
      const fixture = makeBackupRun(caseRoot, { artifactBytes: wrongBytes });

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript() });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("[verify] artifact byte size mismatch");
      expect(run.stderr).toContain(String(wrongBytes));
      expect(run.requests).toHaveLength(0);
      expect(run.reportPath).toBeNull();
    });
  });

  describe("tier 4: security", () => {
    const refusalCases: Array<{ name: string; env: string; targetDsn: string; reason: string }> = [
      {
        name: "NODE_ENV=production env shape",
        env: localEnvFixture("production"),
        targetDsn: TARGET_DSN,
        reason: 'NODE_ENV is "production"',
      },
      {
        name: "managed neon.tech host",
        env: localEnvFixture(),
        targetDsn: NEON_TARGET_DSN,
        reason: "neon.tech",
      },
      {
        name: "Upstash marker in env",
        env: localEnvFixture("development", ["UPSTASH_REDIS_REST_URL=https://alive-mammal-12345.upstash.io"]),
        targetDsn: TARGET_DSN,
        reason: "UPSTASH_REDIS_REST_URL is set",
      },
      {
        name: "RDS host",
        env: localEnvFixture(),
        targetDsn: RDS_TARGET_DSN,
        reason: "rds.amazonaws.com",
      },
      {
        name: "conninfo-form RDS host",
        env: localEnvFixture(),
        targetDsn: "host=kottaby-verify.c9x8e2z7.us-east-1.rds.amazonaws.com dbname=kottaby user=dr_user",
        reason: "rds.amazonaws.com",
      },
      {
        name: "percent-encoded RDS host (libpq percent-decodes the URI host)",
        env: localEnvFixture(),
        targetDsn: "postgresql://prod.rds.amazonaws.co%6d/db",
        reason: "rds.amazonaws.com",
      },
      {
        name: "trailing-dot RDS host (URL form)",
        env: localEnvFixture(),
        targetDsn: "postgresql://prod.rds.amazonaws.com./db",
        reason: "rds.amazonaws.com",
      },
      {
        name: "trailing-dot RDS host (conninfo form)",
        env: localEnvFixture(),
        targetDsn: "host=prod.rds.amazonaws.com. dbname=x",
        reason: "rds.amazonaws.com",
      },
      {
        name: "hostaddr-only conninfo (bare-IP target, no host signal)",
        env: localEnvFixture(),
        targetDsn: "hostaddr=192.0.2.1 dbname=x",
        reason: "hostaddr",
      },
      {
        name: "a URL target with an empty path database (ambient PGDATABASE would complete the endpoint)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1/",
        reason: "target database is unspecified",
      },
      {
        name: "a URL target with no path segment at all",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432",
        reason: "target database is unspecified",
      },
      {
        name: "a conninfo without any dbname= keyword",
        env: localEnvFixture(),
        targetDsn: "host=127.0.0.1 user=postgres",
        reason: "target database is unspecified",
      },
      {
        name: "a URI whose path and query dbname= name DIFFERENT databases (libpq URI families disagree on precedence)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?dbname=other_db",
        reason: "target database ambiguity between path and query",
      },
      {
        name: "an EMPTY query dbname= over a named path database (the override names nothing)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?dbname=",
        reason: "target database ambiguity between path and query",
      },
      {
        name: "an EMPTY query dbname= over an empty path (still under-specified)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/?dbname=",
        reason: "target database is unspecified",
      },
      {
        name: "a malformed percent-escape in the path database compared against a query dbname",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_%ZZrestore?dbname=scratch_restore",
        reason: "malformed percent-escape",
      },
      {
        name: "a URI whose raw path carries dot-segments (the URL parser would normalize them, libpq restores literally)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/pt7_a/../pt7_b",
        reason: "dot-segment path is unassessable",
      },
      {
        name: "a URI whose path percent-decodes into dot-segments (encoded traversal)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/pt7_a/%2e%2e/pt7_b",
        reason: "dot-segment path is unassessable",
      },
      {
        name: "a URI whose raw path carries a fragment character (libpq reads through # and restores into the literal db#x)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/pt8_dst#x",
        reason: "fragment character in path is unassessable",
      },
      {
        name: "a URI whose raw path is a fragment-introducer over punctuation (libpq names the db #x)",
        env: localEnvFixture(),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/&#x",
        reason: "fragment character in path is unassessable",
      },
    ];

    for (const refusalCase of refusalCases) {
      test(`guard refuses ${refusalCase.name} before any spawn (exit 2)`, async () => {
        const caseRoot = newCaseRoot();
        makeSchemaFixture(caseRoot);
        // `--from` is deliberately unresolvable: the guard must fire first.
        const run = await runPipeline(caseRoot, {
          from: join(caseRoot, "never-resolved"),
          targetDsn: refusalCase.targetDsn,
          script: emptyScript(),
          envFixture: refusalCase.env,
        });
        expect(run.thrown).toBeNull();
        expect(run.exitCode).toBe(2);
        expect(run.stderr).toContain("[guard]");
        expect(run.stderr).toContain(refusalCase.reason);
        expect(run.requests).toHaveLength(0);
        expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
      });
    }

    test("guard allows a plain multi-segment raw path and the report label equals the literal libpq database", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // No dot-segments: libpq treats the raw path LITERALLY as the database
      // name, so the report label must be that literal name — never a
      // WHATWG-normalized (or otherwise re-derived) variant of it.
      const rawPathTarget = `postgresql://restore_user:${FIXTURE_PASSWORD}@127.0.0.1:5432/r7_plain/scratch_restore`;
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: healthyScript(),
        targetDsn: rawPathTarget,
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('target database "r7_plain/scratch_restore"');
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.report?.target).toEqual({ database: "r7_plain/scratch_restore" });
      const restoreRequest = run.requests.find(request => request.cmd === "pg_restore");
      expect(restoreRequest?.args).toContain(rawPathTarget);
    });

    test("guard allows a percent-encoded fragment (%23) path database and the report label equals the literal libpq database", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // libpq percent-decodes the path database: %23 IS a literal `#` in the
      // name it restores into — and the label decodes the same way, so the
      // report matches libpq exactly (no raw-fragment divergence; a RAW `#`
      // is refused upstream, an ENCODED one is assessed by its decoded value).
      const encodedFragmentTarget = `postgresql://restore_user:${FIXTURE_PASSWORD}@127.0.0.1:5432/pt8x%23y`;
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        script: healthyScript(),
        targetDsn: encodedFragmentTarget,
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain('target database "pt8x#y"');
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.report?.target).toEqual({ database: "pt8x#y" });
      const restoreRequest = run.requests.find(request => request.cmd === "pg_restore");
      expect(restoreRequest?.args).toContain(encodedFragmentTarget);
    });

    test("guard assesses conninfo-form targets: local accepted, original string spawned", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const conninfoTarget = "host=127.0.0.1 port=5432 dbname=scratch_restore user=restore_user";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: conninfoTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.stdout).toContain('target database "scratch_restore"');
      // Single-variable threading: pg_restore receives EXACTLY the operator's
      // conninfo string — the URL synthesis exists only inside the guard.
      const restoreRequest = run.requests.find(request => request.cmd === "pg_restore");
      expect(restoreRequest?.args).toContain(conninfoTarget);
      expect(run.requests[0]?.cmd).toBe("pg_restore");
    });

    test("guard refuses a duplicate-host conninfo whose libpq-effective host is managed (zero spawns)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // libpq applies repeated keywords LAST-WINS, so the effective target of
      // `host=127.0.0.1 host=prod.rds...` is the RDS host. First-occurrence
      // extraction (the pre-fix bug) assessed 127.0.0.1 and would have ALLOWED
      // this restore; last-wins assessment refuses it before any spawn.
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "host=127.0.0.1 host=prod.rds.amazonaws.com dbname=x",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("rds.amazonaws.com");
      expect(run.requests).toHaveLength(0);
    });

    test("guard assesses conninfo targets with libpq last-wins semantics and spawns the original string", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // The FIRST host value is a managed RDS host; libpq connects to the
      // LAST one (127.0.0.1). First-occurrence assessment would refuse, so a
      // PASS proves the guard assessed the libpq-effective host.
      const lastWinsTarget = "host=prod.rds.amazonaws.com host=127.0.0.1 dbname=x";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: lastWinsTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.stdout).toContain('target database "x"');
      // Spawn attempted with THAT DSN: pg_restore receives the operator's
      // conninfo string unchanged.
      const restoreRequest = run.requests.find(request => request.cmd === "pg_restore");
      expect(restoreRequest?.args).toContain(lastWinsTarget);
      expect(run.requests[0]?.cmd).toBe("pg_restore");
    });

    for (const dualSignalTarget of [
      "hostaddr=127.0.0.1 host=prod.rds.amazonaws.com dbname=x",
      "host=prod.rds.amazonaws.com hostaddr=127.0.0.1 dbname=x",
    ]) {
      test(`guard assesses BOTH host and hostaddr values regardless of token order (${dualSignalTarget})`, async () => {
        const caseRoot = newCaseRoot();
        makeSchemaFixture(caseRoot);
        // libpq connects to hostaddr and uses host for verification, so a
        // hostaddr-only or host-only extraction would miss one of the two
        // host signals depending on token order; BOTH are assessed and the
        // managed host must refuse.
        const run = await runPipeline(caseRoot, {
          from: join(caseRoot, "never-resolved"),
          targetDsn: dualSignalTarget,
          script: emptyScript(),
        });
        expect(run.thrown).toBeNull();
        expect(run.exitCode).toBe(2);
        expect(run.stderr).toContain("[guard]");
        expect(run.stderr).toContain("rds.amazonaws.com");
        expect(run.requests).toHaveLength(0);
      });
    }

    test("guard refuses a conninfo host that cannot round-trip through new URL (malformed host chars)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // `a]b` passes the host charset pattern but cannot form a URL; without
      // the round-trip gate the guard's own URL parse would fail silently and
      // SKIP the host analysis (allowing an unassessable target).
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "host=a]b dbname=x",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("malformed host value");
      expect(run.stderr).toContain("cannot assess target safety");
      expect(run.requests).toHaveLength(0);
    });

    test("guard refuses a percent-encoded host with a malformed escape (unassessable)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // decodeURIComponent("co%ZZ") throws — the libpq-effective host cannot
      // be derived, so the target is unassessable and refuses (fail closed).
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "postgresql://u@prod.rds.amazonaws.co%ZZ/db",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("malformed percent-escape");
      expect(run.requests).toHaveLength(0);
    });

    test("guard decodes an encoded LOCAL host and still allows the drill target (original string spawned)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // %31%32%37.0.0.1 percent-decodes to 127.0.0.1 — a local host. The
      // encoded form must remain ALLOWED (decoding reveals no managed
      // marker), and pg_restore must receive the operator's EXACT string.
      const encodedLocalTarget = "postgresql://postgres@%31%32%37.0.0.1:5432/scratch_restore";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: encodedLocalTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(encodedLocalTarget);
    });

    test("URL-form IP targets remain the supported drill path (hostaddr rule is conninfo-only)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const ipv4Url = "postgresql://postgres@127.0.0.1:5432/scratch_restore";
      const ipv4Run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: ipv4Url,
        script: healthyScript(),
      });
      expect(ipv4Run.thrown).toBeNull();
      expect(ipv4Run.exitCode).toBe(0);
      expect(ipv4Run.stdout).toContain("VERDICT: PASS");
      expect(ipv4Run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(ipv4Url);

      // Fresh run dir per pipeline run: the report writer refuses to
      // overwrite a pre-existing restore-report.json (clobber guard).
      const ipv6Fixture = makeBackupRun(caseRoot);
      const ipv6Url = "postgresql://postgres@[::1]:5432/scratch_restore";
      const ipv6Run = await runPipeline(caseRoot, {
        from: ipv6Fixture.runDir,
        targetDsn: ipv6Url,
        script: healthyScript(),
      });
      expect(ipv6Run.thrown).toBeNull();
      expect(ipv6Run.exitCode).toBe(0);
      expect(ipv6Run.stdout).toContain("VERDICT: PASS");
      expect(ipv6Run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(ipv6Url);
    });

    // ── URI query-string host channels: libpq applies `?host=`/`?hostaddr=`
    // on top of the parsed authority (overriding the connection target), so
    // each query channel is assessed through the same pipeline as the
    // authority host — an unassessed second channel must never reach
    // pg_restore. ──
    const queryRefusalCases: Array<{ name: string; targetDsn: string; reason: string }> = [
      {
        name: "a managed RDS host smuggled into the query string (authority is a local decoy)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?host=prod.rds.amazonaws.com",
        reason: "rds.amazonaws.com",
      },
      {
        name: "a percent-encoded managed host in the query (libpq percent-decodes query values)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?host=%70rod.rds.amazonaws.com",
        reason: "rds.amazonaws.com",
      },
      {
        name: "a query hostaddr naming a non-loopback endpoint (host is verification-only)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?hostaddr=192.0.2.1&host=127.0.0.1",
        reason: "non-loopback",
      },
      {
        name: "an empty query host (libpq default-socket fallback is unassessable)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?host=",
        reason: "query host is empty",
      },
      {
        name: "an empty query hostaddr (channel present but unassessable)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?hostaddr=&host=127.0.0.1",
        reason: "query hostaddr is empty",
      },
      {
        name: "a malformed percent-escape in the query host (libpq rejects the URI)",
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?host=%ZZ.rds.amazonaws.com",
        reason: "malformed percent-escape",
      },
      {
        name: "a raw tab inside the URL host (WHATWG strips it, libpq does not)",
        targetDsn: "postgresql://postgres@127.0.0.1\t/db",
        reason: "control character",
      },
    ];

    for (const queryRefusalCase of queryRefusalCases) {
      test(`guard refuses a URI target carrying ${queryRefusalCase.name} before any spawn (exit 2)`, async () => {
        const caseRoot = newCaseRoot();
        makeSchemaFixture(caseRoot);
        // `--from` is deliberately unresolvable: the guard must fire first.
        const run = await runPipeline(caseRoot, {
          from: join(caseRoot, "never-resolved"),
          targetDsn: queryRefusalCase.targetDsn,
          script: emptyScript(),
        });
        expect(run.thrown).toBeNull();
        expect(run.exitCode).toBe(2);
        expect(run.stderr).toContain("[guard]");
        expect(run.stderr).toContain(queryRefusalCase.reason);
        expect(run.requests).toHaveLength(0);
        expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
      });
    }

    test("guard assesses the QUERY host on an authority decoy: local query host passes, original string spawned", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // The authority is a decoy name; libpq connects to the query host. The
      // guard assesses the query host itself: 127.0.0.1 is local → allowed,
      // and pg_restore receives the operator's EXACT string.
      const decoyTarget = "postgresql://postgres@authority-decoy.invalid:5432/scratch_restore?host=127.0.0.1";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: decoyTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(decoyTarget);
      expect(run.requests[0]?.cmd).toBe("pg_restore");
    });

    test("guard applies last-occurrence-wins to repeated query host params (original string spawned)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // libpq applies repeated URI query parameters in order, so the
      // effective query host is the LAST one (127.0.0.1); first-occurrence
      // extraction would refuse this local drill.
      const lastWinsQuery =
        "postgresql://postgres@127.0.0.1:5432/scratch_restore?host=prod.rds.amazonaws.com&host=127.0.0.1";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: lastWinsQuery,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(lastWinsQuery);
    });

    test("benign query parameters leave assessment untouched (original string spawned)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const benignTarget = "postgresql://postgres@127.0.0.1:5432/scratch_restore?sslmode=require";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: benignTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(benignTarget);
    });

    test("guard honors a query dbname= over an EMPTY path as the explicit target database (report records it)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // libpq applies query parameters ON TOP of the parsed URI, so a
      // `?dbname=` on a database-less path IS the explicit target database —
      // refusing it as "unspecified" would false-positive on this
      // libpq-legal drill form. The report must record the EFFECTIVE
      // database (the query value), never the empty path component.
      const queryDbTarget = "postgresql://postgres@127.0.0.1:5432/?dbname=scratch_restore";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: queryDbTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.stdout).toContain('target database "scratch_restore"');
      expect(run.report?.target.database).toBe("scratch_restore");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(queryDbTarget);
    });

    test("guard allows a URI whose path and query dbname= AGREE (equal values; original string spawned)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      // Equal path/query database values are unambiguous — the ambiguity
      // refusal fires only on a DISAGREEMENT — and the effective database is
      // recorded.
      const agreeingTarget = "postgresql://postgres@127.0.0.1:5432/scratch_restore?dbname=scratch_restore";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: agreeingTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.report?.target.database).toBe("scratch_restore");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(agreeingTarget);
    });

    // ── Raw authority-span gate: libpq scans the URI authority to the FIRST
    // `/` of the raw string and splits userinfo at the LAST `@` inside that
    // span, while WHATWG ends the authority at the first `?`/`#` — a raw
    // `?`/`#`/control character in the span (or a userinfo percent-decoding
    // into an `@`/`/`) makes the two parsers disagree about the host libpq
    // connects to, so such targets refuse before any URL parsing. ──
    const authorityRefusalCases: Array<{ name: string; targetDsn: string; reason: string }> = [
      {
        name: "a raw ? in the authority span (WHATWG ends the authority at it; libpq scans to the first /)",
        targetDsn: "postgresql://postgres:?@prod.rds.amazonaws.com/db",
        reason: "unassessable authority",
      },
      {
        name: "a raw # in the authority span (WHATWG starts a fragment at it; libpq scans to the first /)",
        targetDsn: "postgresql://postgres#?@prod.rds.amazonaws.com/db",
        reason: "unassessable authority",
      },
      {
        name: "a raw tab inside the authority span (before the first /)",
        targetDsn: "postgresql://postgres@\tprod.rds.amazonaws.com/db",
        reason: "unassessable authority",
      },
      {
        name: "a raw ? in a PATHLESS authority followed by an @ (libpq folds it into the userinfo)",
        targetDsn: "postgresql://postgres:?@127.0.0.1:5432",
        reason: "unassessable authority",
      },
      {
        name: "a userinfo percent-decoding to an @ (encoded authority delimiter)",
        targetDsn: "postgresql://postgres%3F%40prod.rds.amazonaws.com@127.0.0.1:5432/db",
        reason: "authority delimiter",
      },
      {
        name: "a userinfo percent-decoding to a / (encoded path delimiter)",
        targetDsn: "postgresql://postgres%2F%40prod.rds.amazonaws.com@127.0.0.1:5432/db",
        reason: "authority delimiter",
      },
      {
        name: "a userinfo carrying a malformed percent-escape",
        targetDsn: "postgresql://postgres%ZZ@127.0.0.1:5432/db",
        reason: "malformed percent-escape",
      },
    ];

    for (const authorityRefusalCase of authorityRefusalCases) {
      test(`guard refuses a URI target carrying ${authorityRefusalCase.name} before any spawn (exit 2)`, async () => {
        const caseRoot = newCaseRoot();
        makeSchemaFixture(caseRoot);
        // `--from` is deliberately unresolvable: the guard must fire first.
        const run = await runPipeline(caseRoot, {
          from: join(caseRoot, "never-resolved"),
          targetDsn: authorityRefusalCase.targetDsn,
          script: emptyScript(),
        });
        expect(run.thrown).toBeNull();
        expect(run.exitCode).toBe(2);
        expect(run.stderr).toContain("[guard]");
        expect(run.stderr).toContain(authorityRefusalCase.reason);
        expect(run.requests).toHaveLength(0);
        expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
      });
    }

    // ── Pathless-query URIs: with no path segment the first `?` IS the query
    // delimiter in both libpq and WHATWG (`pg_isready` on
    // `postgresql://localhost:5432?sslmode=disable` connects to
    // localhost:5432), so the raw authority-span gate must let them through
    // to the later channel/DB-component gates — refusing them at the SPAN
    // gate would misreport ordinary, libpq-legal URIs. ──
    test("guard passes a pathless-query target through the span gate but refuses its unspecified database (exit 2)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // The pathless form is libpq-legal and PASSES the raw authority-span
      // gate (the refusal below is the DB-component rule, NOT the span rule),
      // but it names no database — ambient PGDATABASE would complete the
      // endpoint — so the DB-component rule refuses before any spawn.
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "postgresql://postgres@127.0.0.1:5432?sslmode=disable",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("target database is unspecified");
      expect(run.stderr).not.toContain("unassessable authority");
      expect(run.requests).toHaveLength(0);
    });

    test("guard refuses a managed host smuggled into a PATHLESS query (query channel still assessed)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // `--from` is deliberately unresolvable: the guard must fire first.
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "postgresql://postgres@127.0.0.1:5432?host=prod.rds.amazonaws.com",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("rds.amazonaws.com");
      expect(run.requests).toHaveLength(0);
      expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
    });

    // ── libpq service indirection: a `service=` parameter (URI query or
    // conninfo keyword) makes the SERVICE FILE — forwarded to the restore
    // children via PGSERVICEFILE — decide the endpoint, so a target naming a
    // service is unassessable and refuses. ──
    test("guard refuses a URI query service= parameter (service indirection is unassessable)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "postgresql://postgres@127.0.0.1:5432/scratch_restore?service=prodsvc",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("service indirection");
      expect(run.requests).toHaveLength(0);
    });

    test("guard refuses a conninfo service= keyword (service indirection is unassessable)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "host=127.0.0.1 service=prodsvc dbname=x",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("service indirection");
      expect(run.requests).toHaveLength(0);
    });

    test("guard refuses a conninfo hostaddr naming a non-loopback endpoint (libpq connects to hostaddr)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      // `host=127.0.0.99` is a loopback-family decoy; libpq CONNECTS to the
      // hostaddr — a remote numeric endpoint has no assessable host signal,
      // mirroring the query-channel hostaddr rule.
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "host=127.0.0.99 hostaddr=198.51.100.9 dbname=x",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("non-loopback");
      expect(run.requests).toHaveLength(0);
    });

    test("guard allows a conninfo whose hostaddr is loopback (drill path; original string spawned)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const loopbackHostaddrTarget = "host=127.0.0.99 hostaddr=127.0.0.1 dbname=scratch_restore";
      const run = await runPipeline(caseRoot, {
        from: fixture.runDir,
        targetDsn: loopbackHostaddrTarget,
        script: healthyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(0);
      expect(run.stdout).toContain("VERDICT: PASS");
      expect(run.requests.find(request => request.cmd === "pg_restore")?.args).toContain(loopbackHostaddrTarget);
      expect(run.requests[0]?.cmd).toBe("pg_restore");
    });

    test("value-oracle absence ladder descends ONLY on SQLSTATE 42P01 and fails closed otherwise", async () => {
      const registry: OracleDefinition[] = [
        {
          id: "T-LADDER",
          description: "ladder gating",
          invariantAnchor: "test",
          sql: "SELECT 1",
          expected: { kind: "migrationJournalHash" },
          fallbackSql: "SELECT 2",
          absentValue: MIGRATIONS_ABSENT_HASH,
        },
      ];
      const calls: string[] = [];
      const runLadder = async (scripted: Record<string, PsqlOutcome | undefined>) =>
        runOracles(
          async sql => {
            calls.push(sql);
            const outcome = scripted[sql];
            if (outcome === undefined) throw new Error(`unscripted query: ${sql}`);
            return outcome;
          },
          { journalHash: JOURNAL_HASH },
          registry
        );

      // 42P01 on the primary rung → the fallback IS consulted → value compared.
      calls.length = 0;
      const descended = (
        await runLadder({
          "SELECT 1": failedOutcome('ERROR:  42P01: relation "drizzle.__drizzle_migrations" does not exist'),
          "SELECT 2": { ok: true, value: JOURNAL_HASH, stderr: "" },
        })
      )[0];
      expect(calls).toEqual(["SELECT 1", "SELECT 2"]);
      expect(descended.passed).toBe(true);
      expect(descended.offendingCount).toBe(0);

      // 42P01 on BOTH rungs → absentValue assumed (ladder mechanics), then
      // compared STRICTLY: the sentinel ≠ the real expected hash → the
      // oracle fails (an absent tracking table is a divergence against a
      // journal-bearing expectation, never a silent pass).
      calls.length = 0;
      const absent = (
        await runLadder({
          "SELECT 1": failedOutcome('ERROR:  42P01: relation "drizzle.__drizzle_migrations" does not exist'),
          "SELECT 2": failedOutcome('ERROR:  42P01: relation "public.__drizzle_migrations" does not exist'),
        })
      )[0];
      expect(calls).toEqual(["SELECT 1", "SELECT 2"]);
      expect(absent.passed).toBe(false);
      expect(absent.offendingCount).toBe(1);

      // Auth error on the primary rung → FAILS CLOSED, fallback never reached.
      calls.length = 0;
      const authFailed = (
        await runLadder({
          "SELECT 1": failedOutcome('psql: error: FATAL: password authentication failed for user "restore_user"'),
        })
      )[0];
      expect(calls).toEqual(["SELECT 1"]);
      expect(authFailed.passed).toBe(false);
      expect(authFailed.offendingCount).toBe(ORACLE_ERROR_OFFENDING_COUNT);

      // Non-42P01 on the fallback rung → FAILS CLOSED (no absentValue shortcut).
      calls.length = 0;
      const fallbackFailed = (
        await runLadder({
          "SELECT 1": failedOutcome('ERROR:  42P01: relation "drizzle.__drizzle_migrations" does not exist'),
          "SELECT 2": failedOutcome("psql: error: could not connect to server: Connection refused"),
        })
      )[0];
      expect(calls).toEqual(["SELECT 1", "SELECT 2"]);
      expect(fallbackFailed.passed).toBe(false);
      expect(fallbackFailed.offendingCount).toBe(ORACLE_ERROR_OFFENDING_COUNT);
    });

    test("OR-MIG fails closed when the psql error is not relation-absence (auth error)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const script: FakeDbScript = {
        ...healthyScript(),
        oracleOutcomes: {
          "OR-MIG": {
            exitCode: 1,
            stdout: "",
            stderr: 'psql: error: FATAL: password authentication failed for user "restore_user"',
          },
        },
      };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      const migOracle = run.report?.oracles.find(oracle => oracle.id === "OR-MIG");
      expect(migOracle?.passed).toBe(false);
      expect(migOracle?.offendingCount).toBe(ORACLE_ERROR_OFFENDING_COUNT);
      expect(run.stderr).toContain("[verify:OR-MIG] oracle errored");
      expect(run.stdout).toContain("oracles 6/7 passed");
      expect(run.stdout).toContain("VERDICT: FAIL");
      // Fail-closed proof: the ladder never reached the fallback query.
      const psqlCommands = run.requests
        .filter(request => request.cmd === "psql")
        .map(request => request.args[request.args.indexOf("--command") + 1] ?? "");
      expect(psqlCommands.some(sql => sql.includes("public.__drizzle_migrations"))).toBe(false);
    });

    test("guard refuses an unassessable (garbage) target with zero spawns", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const run = await runPipeline(caseRoot, {
        from: join(caseRoot, "never-resolved"),
        targetDsn: "not-a-dsn-at-all",
        script: emptyScript(),
      });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("cannot assess target safety");
      expect(run.requests).toHaveLength(0);
    });

    test("CLI guard refusal exits 2 without leaking the connection string", () => {
      const caseRoot = newCaseRoot();
      const envFile = join(caseRoot, ".env.fixture");
      writeFileSync(envFile, localEnvFixture());

      const run = runCliSubprocess([
        "--from",
        join(caseRoot, "run"),
        "--target",
        NEON_TARGET_DSN,
        "--yes-i-understand",
        "--env",
        envArgFor(envFile),
      ]);
      expect(run.exitCode).toBe(2);
      expect(run.stderr).toContain("[guard]");
      expect(run.stderr).toContain("neon.tech");
      expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
    });

    test("pg_restore failure exits 1 and scrubs the connection string from stderr", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);
      const script: FakeDbScript = {
        ...healthyScript(),
        pgRestore: {
          exitCode: 1,
          stdout: "",
          stderr: `pg_restore: error: could not connect to postgresql://restore_user:${FIXTURE_PASSWORD}@127.0.0.1:5432/scratch_restore`,
        },
      };

      const run = await runPipeline(caseRoot, { from: fixture.runDir, script });
      expect(run.thrown).toBeNull();
      expect(run.exitCode).toBe(1);
      expect(run.stderr).toContain("[pg_restore]");
      expect(run.stderr).toContain("(redacted-user)");
      expect(run.stderr).not.toContain(FIXTURE_PASSWORD);
      expect(run.stderr).not.toContain("postgresql://");
      expect(run.stderr).not.toContain("restore_user");
      expect(run.reportPath).toBeNull();
    });

    test("fixture credentials never appear in any captured stream (success + failure)", async () => {
      const caseRoot = newCaseRoot();
      makeSchemaFixture(caseRoot);
      const fixture = makeBackupRun(caseRoot);

      const passRun = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript() });
      const failFixture = makeBackupRun(caseRoot);
      const failRun = await runPipeline(caseRoot, {
        from: failFixture.runDir,
        script: { ...healthyScript(), oracleOutcomes: { "OR-W1": okCount(5) } },
      });

      const combined = [
        passRun.stdout,
        passRun.stderr,
        passRun.reportBody,
        failRun.stdout,
        failRun.stderr,
        failRun.reportBody,
      ]
        .filter((stream): stream is string => stream !== null)
        .join("\n");
      expect(combined).toContain("VERDICT: PASS");
      expect(combined).toContain("VERDICT: FAIL");
      expect(combined).not.toContain(FIXTURE_PASSWORD);
      expect(combined).not.toContain(SOURCE_PASSWORD);
      expect(combined).not.toContain(TARGET_DSN);
      expect(combined).not.toContain(SOURCE_DSN);
    });

    // ── Report clobber guard: the report path lives in the run directory the
    // restore owns, so absence is the expected state. ANY pre-placed entry
    // there — live symlink, dangling symlink, hard link, plain file — refuses
    // the run (RestoreVerificationError → exit 1 in main()) instead of being
    // written through, which would clobber the link's target OUTSIDE the run
    // directory. ──
    for (const prePlacement of [
      { kind: "symlink", label: "a pre-placed live symlink" },
      { kind: "dangling", label: "a pre-placed dangling symlink" },
      { kind: "hardlink", label: "a pre-placed hard link" },
      { kind: "file", label: "a pre-placed regular file" },
    ] as const) {
      test(`report writer refuses ${prePlacement.label} at the report path and leaves the canary untouched`, async () => {
        const caseRoot = newCaseRoot();
        makeSchemaFixture(caseRoot);
        const fixture = makeBackupRun(caseRoot);
        // Pin the run's clock so the per-run report path is predictable, and
        // pre-place the entry at THAT path (the pipeline will target it).
        const guardClock: Clock = () => new Date(CLOCK_BASE_MS);
        const reportPath = join(fixture.runDir, restoreReportFileName(guardClock()));
        const canaryPath = join(tempRoot, `canary-${caseCounter}-${prePlacement.kind}.txt`);
        const canaryContent = "CANARY-MUST-NOT-BE-CLOBBERED";
        writeFileSync(canaryPath, canaryContent);
        if (prePlacement.kind === "symlink") {
          symlinkSync(canaryPath, reportPath);
        } else if (prePlacement.kind === "dangling") {
          symlinkSync(join(tempRoot, "no-such-clobber-target"), reportPath);
        } else if (prePlacement.kind === "hardlink") {
          linkSync(canaryPath, reportPath);
        } else {
          writeFileSync(reportPath, "pre-placed-bytes");
        }

        const run = await runPipeline(caseRoot, { from: fixture.runDir, script: healthyScript(), clock: guardClock });

        // RestoreVerificationError is the error class main() maps to exit 1
        // with the [verify] tag on stderr.
        expect(run.thrown).toBeInstanceOf(RestoreVerificationError);
        expect(messageOf(run.thrown)).toContain("already exists");
        expect(messageOf(run.thrown)).toContain("refusing to overwrite");
        // The restore itself ran; only the report write refused.
        expect(run.requests.some(request => request.cmd === "pg_restore")).toBe(true);
        // The linked/placed entry is intact and its target was NOT clobbered.
        if (prePlacement.kind !== "dangling") {
          const expected = prePlacement.kind === "file" ? "pre-placed-bytes" : canaryContent;
          expect(readFileSync(reportPath, "utf8")).toBe(expected);
        }
      });
    }
  });
});

describe("buildRestoreChildEnv (restore child env allowlist)", () => {
  const ENDPOINT_KEYS = [
    "PGDATABASE",
    "PGHOST",
    "PGPORT",
    "PGUSER",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGHOSTADDR",
  ] as const;

  test("endpoint-deciding libpq variables are never forwarded to restore children", () => {
    const source: Record<string, string> = {
      PATH: "/usr/local/bin:/usr/bin",
      HOME: "/root",
      TMPDIR: "/tmp",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PGDATABASE: "ambient_pgdatabase",
      PGHOST: "ambient-host.example",
      PGPORT: "6543",
      PGUSER: "ambient_user",
      PGSERVICE: "ambient_service",
      PGSERVICEFILE: "/ambient/pgservice.conf",
      PGHOSTADDR: "192.0.2.10",
    };
    const env = buildRestoreChildEnv(source);
    expect(env.PATH).toBe("/usr/local/bin:/usr/bin");
    expect(env.HOME).toBe("/root");
    expect(env.TMPDIR).toBe("/tmp");
    expect(env.LANG).toBe("C.UTF-8");
    expect(env.LC_ALL).toBe("C.UTF-8");
    for (const key of ENDPOINT_KEYS) {
      expect(Object.hasOwn(env, key)).toBe(false);
    }
  });

  test("credential, transport, and app-identity variables are still forwarded", () => {
    const source: Record<string, string> = {
      PGPASSWORD: "child-password-not-a-fixture",
      PGPASSFILE: "/run/restore/.pgpass",
      PGSSLMODE: "require",
      PGSSLROOTCERT: "/run/restore/ca.pem",
      PGCONNECT_TIMEOUT: "5",
      PGAPPNAME: "ops:db-restore-verify",
    };
    expect(buildRestoreChildEnv(source)).toEqual({
      PGPASSWORD: "child-password-not-a-fixture",
      PGPASSFILE: "/run/restore/.pgpass",
      PGSSLMODE: "require",
      PGSSLROOTCERT: "/run/restore/ca.pem",
      PGCONNECT_TIMEOUT: "5",
      PGAPPNAME: "ops:db-restore-verify",
    });
  });

  test("the per-request passthrough is allowlist-filtered: PGDATABASE/PGSERVICE never pass even via request.env", () => {
    const env = buildRestoreChildEnv(
      { PATH: "/usr/bin:/bin" },
      {
        PGDATABASE: "ambient_pgdatabase",
        PGHOST: "ambient-host.example",
        PGPORT: "6543",
        PGUSER: "ambient_user",
        PGSERVICE: "ambient_service",
        PGSERVICEFILE: "/ambient/pgservice.conf",
        PGHOSTADDR: "192.0.2.10",
        PGPASSWORD: "child-password",
      }
    );
    // The allowlist WINS over the per-request passthrough: the allowlisted
    // credential key passes, every endpoint-deciding key is dropped.
    expect(env.PGPASSWORD).toBe("child-password");
    for (const key of ENDPOINT_KEYS) {
      expect(Object.hasOwn(env, key)).toBe(false);
    }
  });
});

describe("redactTargetDatabaseName (conninfo libpq semantics)", () => {
  test("URL form reports the path database", () => {
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/appdb")).toBe("appdb");
  });

  test("URL form reports the query dbname= as the EFFECTIVE database (override channel)", () => {
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/pathdb?dbname=querydb")).toBe("querydb");
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/?dbname=querydb")).toBe("querydb");
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/same?dbname=same")).toBe("same");
  });

  test("URL form ignores an absent or empty query dbname= and reports the path database", () => {
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/pathdb?sslmode=require")).toBe("pathdb");
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/pathdb?dbname=")).toBe("pathdb");
  });

  test("URL form derives the path label from the RAW path (libpq literal view, no dot-segment normalization)", () => {
    // The WHATWG pathname of this URI is "/pt7_b" — libpq would restore into
    // the literal "pt7_a/../pt7_b", so the report must say exactly that.
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/pt7_a/../pt7_b")).toBe("pt7_a/../pt7_b");
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/./scratch_db")).toBe("./scratch_db");
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/db%20one")).toBe("db one");
  });

  test("URL form labels a percent-encoded fragment as the literal libpq database name", () => {
    // libpq percent-decodes the path database: %23 IS a literal `#` in the
    // name it restores into — the label decodes the same way, so report and
    // libpq agree exactly.
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/pt8x%23y")).toBe("pt8x#y");
  });

  test("URL form keeps the WHATWG truncated label for a raw-fragment path (guard refuses such targets upstream)", () => {
    // libpq reads THROUGH a raw `#` (database `db#x`) — unassessable, so the
    // restore guard refuses the target before any run; the label keeps the
    // WHATWG view for non-guard uses (doc contract in _shared/restore-shared).
    expect(redactTargetDatabaseName("postgresql://u:p@h:5432/db#x")).toBe("db");
  });

  test("conninfo form reports the LAST dbname= (libpq last-wins)", () => {
    expect(redactTargetDatabaseName("dbname=a dbname=b")).toBe("b");
    expect(redactTargetDatabaseName("host=127.0.0.1 port=5432 dbname=first dbname=second")).toBe("second");
  });

  test("conninfo form strips one layer of surrounding quotes (inner spaces kept)", () => {
    expect(redactTargetDatabaseName("dbname='a b'")).toBe("a b");
    expect(redactTargetDatabaseName('dbname="c d"')).toBe("c d");
  });

  test("conninfo single-quoted form folds libpq '' escapes", () => {
    expect(redactTargetDatabaseName("dbname='my''db'")).toBe("my'db");
    expect(redactTargetDatabaseName("host=127.0.0.1 port=5432 dbname='it''s here'")).toBe("it's here");
  });

  test("conninfo quoted forms fold libpq backslash escapes to the effective name", () => {
    // Live-proven R13 shapes: libpq folds every `\<char>` inside a quoted
    // value to `<char>` (so `a\b` connects as `ab`), while the label used
    // to keep the backslashes literal.
    expect(redactTargetDatabaseName("dbname='a\\b'")).toBe("ab");
    expect(redactTargetDatabaseName("dbname='a\\\\b'")).toBe("a\\b");
    expect(redactTargetDatabaseName('dbname="a\\b"')).toBe("ab");
    expect(redactTargetDatabaseName("host=127.0.0.1 port=5432 dbname='a\\b'")).toBe("ab");
  });

  test("conninfo quoted spans keep a backslash-escaped quote inside the value", () => {
    // libpq's documented `\'` form: the escaped quote does NOT end the
    // value, so the span scan carries it and the fold reports `a'b`
    // (double-quoted `\"` behaves the same way).
    expect(redactTargetDatabaseName("dbname='a\\'b'")).toBe("a'b");
    expect(redactTargetDatabaseName('dbname="a\\"b"')).toBe('a"b');
  });

  test("conninfo unquoted values fold libpq backslash escapes (live-proven R14)", () => {
    // Live-proven R14 shapes: libpq folds `\<char>` → `<char>` in an
    // UNQUOTED value too (`dbname=r14\db` connects as `r14db`), a
    // backslash-whitespace escape both folds to that whitespace and EXTENDS
    // the value across it (`dbname=r14\ db` connects as `r14 db`), and a
    // backslash at end-of-input has nothing to escape and is dropped
    // (`dbname=r14\` connects as `r14`). The label follows the same scan
    // rules, so it can never diverge from the database libpq restores into.
    expect(redactTargetDatabaseName("dbname=r14\\db")).toBe("r14db");
    expect(redactTargetDatabaseName("dbname=r14\\\\db")).toBe("r14\\db");
    expect(redactTargetDatabaseName("dbname=r14\\ db")).toBe("r14 db");
    expect(redactTargetDatabaseName("dbname=r14\\")).toBe("r14");
    // The escaped-whitespace extension keeps the libpq scan going into what
    // follows: everything up to the next UNESCAPED whitespace is the value.
    expect(redactTargetDatabaseName("host=127.0.0.1 port=5432 dbname=r14\\ db")).toBe("r14 db");
  });

  test("input without an assessable database name reports unknown", () => {
    expect(redactTargetDatabaseName("nonsense")).toBe("unknown");
  });
});
