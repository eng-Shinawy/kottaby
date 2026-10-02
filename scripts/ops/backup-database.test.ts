import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { DEFAULT_ENV_FILE } from "@/scripts/dbActions/envFile";
import { redactDsn, scrubDsnSecrets } from "@/scripts/ops/_shared";
import {
  ARTIFACT_FILE_NAME,
  type BackupManifest,
  buildBackupManifest,
  computeJournalHash,
  createStagingDir,
  isLikelyNonDisposable,
  isSystemOutDir,
  listLeftoverStagingDirs,
  MANIFEST_FILE_NAME,
  MIGRATIONS_ABSENT_HASH,
  manifestProblems,
  nextAvailableRunDirName,
  STAGING_DIR_PREFIX,
  sha256File,
  utcStamp,
  writeManifestFile,
} from "@/scripts/ops/backup-artifacts";
import { buildUsageText, parseBackupArgs } from "@/scripts/ops/backup-cli";
import { databaseNameFromDsn, parsePostgresDatabaseUrl, runBackup } from "@/scripts/ops/backup-database";
import { acquireRunLock, isPidAlive, lockFilePath, releaseRunLock, scanRunLocks } from "@/scripts/ops/backup-lock";
import {
  buildChildEnv,
  probeToolchain,
  runPgDump,
  type SpawnResult,
  type SpawnRunner,
  stderrTail,
} from "@/scripts/ops/backup-toolchain";

/**
 * Unit tests for the database backup script. No real database and no real
 * pg_dump: external processes are driven through the injected SpawnRunner
 * seam, the clock/pid/liveness collaborators are faked, and all filesystem
 * side effects are confined to a per-run temporary workspace inside the
 * current working directory (env-file paths must resolve relative to it).
 */

const FIXTURE_DSN = "postgresql://ops_owner:supersecret-pw@db.internal.example:5432/ops_db?sslmode=require";
const FIXTURE_PASSWORD = "supersecret-pw";
const FIXTURE_USER = "ops_owner";
const REDACTED_FIXTURE = "ops_db@db.internal.example:5432(redacted-user)";
const FIXED_NOW = new Date("2024-03-05T06:17:08.000Z");
const STAMP = "20240305T061708Z";
const FAKE_PID = 424242;
const PG_DUMP_VERSION = "pg_dump (PostgreSQL) 16.4";
const SERVER_VERSION_OUT = "16.4\n";
const DUMP_CONTENT = "kottaby-pgdump-fixture-".repeat(40);

interface SpawnCall {
  argv: string[];
  env: Record<string, string>;
}

type SpawnBehavior = (argv: readonly string[]) => SpawnResult | Promise<SpawnResult>;

interface RunOutcome {
  code: number;
  logs: string[];
  errors: string[];
  calls: SpawnCall[];
  all: string;
}

interface BackupRunScenario {
  envFile: string;
  outDir: string;
  repoRoot?: string;
  now?: () => Date;
  isAlive?: (pid: number) => boolean;
  pid?: number;
}

let workspace = "";
let goodEnvFile = "";
let queryDbnameEnvFile = "";
let sqliteEnvFile = "";
let placeholderEnvFile = "";
let rawFragmentEnvFile = "";
let encodedFragmentEnvFile = "";
let rawFragmentQueryEnvFile = "";
let rawFragmentAuthorityEnvFile = "";
let encodedFragmentQueryEnvFile = "";
let rawQuestionAuthorityEnvFile = "";
let dblessEnvFile = "";
let rawControlAuthorityEnvFile = "";
let rawControlPathEnvFile = "";
let dotSegmentPathEnvFile = "";
let encodedDotSegmentPathEnvFile = "";
let emptyQueryDbnameEnvFile = "";
let hostOverrideEnvFile = "";
let hostaddrOverrideEnvFile = "";
let serviceOverrideEnvFile = "";
let commaAuthorityEnvFile = "";
let encodedCommaAuthorityEnvFile = "";
let commaQueryHostEnvFile = "";
let bracketedIpv6EnvFile = "";
let benignQueryParamsEnvFile = "";
const missingEnvFile = (): string => relative(process.cwd(), join(workspace, ".env-backup-missing"));
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

function writeEnvFile(name: string, body: string): string {
  const absolutePath = join(workspace, name);
  writeFileSync(absolutePath, body);
  return relative(process.cwd(), absolutePath);
}

function fakeSpawn(behavior: SpawnBehavior, calls: SpawnCall[]): SpawnRunner {
  return async (argv, opts) => {
    calls.push({ argv: [...argv], env: { ...opts.env } });
    return await behavior(argv);
  };
}

/** Probe responses for pg_dump --version / psql, then the caller's dump behavior. */
function probeAndDumpBehavior(dump: (artifactPath: string) => SpawnResult | Promise<SpawnResult>): SpawnBehavior {
  return argv => {
    if (argv[0] === "pg_dump" && argv[1] === "--version") {
      return { exitCode: 0, stdout: PG_DUMP_VERSION, stderr: "" };
    }
    if (argv[0] === "psql") {
      return { exitCode: 0, stdout: SERVER_VERSION_OUT, stderr: "" };
    }
    return dump(argv[4]);
  };
}

function dumpWritesArtifact(artifactPath: string): SpawnResult {
  writeFileSync(artifactPath, DUMP_CONTENT);
  return { exitCode: 0, stdout: "", stderr: "" };
}

async function runBackupWith(behavior: SpawnBehavior, scenario: BackupRunScenario): Promise<RunOutcome> {
  const logs: string[] = [];
  const errors: string[] = [];
  const calls: SpawnCall[] = [];
  const code = await runBackup({
    envFile: scenario.envFile,
    outDir: scenario.outDir,
    deps: {
      spawn: fakeSpawn(behavior, calls),
      now: scenario.now ?? (() => FIXED_NOW),
      pid: scenario.pid ?? FAKE_PID,
      repoRoot: scenario.repoRoot ?? workspace,
      emit: { log: line => logs.push(line), error: line => errors.push(line) },
      isAlive: scenario.isAlive ?? (() => false),
    },
  });
  return { code, logs, errors, calls, all: [...logs, ...errors].join("\n") };
}

function lockFileNames(outDir: string): string[] {
  return readdirSync(outDir).filter(name => name.startsWith(".lock-"));
}

function expectNoCredentials(text: string): void {
  expect(text).not.toContain(FIXTURE_PASSWORD);
  expect(text).not.toContain(FIXTURE_USER);
  expect(text).not.toContain("postgresql://");
}

function validManifestInput(): Omit<BackupManifest, "tool"> {
  return {
    toolVersion: "1.0.0",
    postgresServerVersion: "16.4",
    pgDumpVersion: PG_DUMP_VERSION,
    database: "ops_db",
    startedAtUtc: "2024-03-05T06:17:08.000Z",
    finishedAtUtc: "2024-03-05T06:27:08.000Z",
    artifactFile: ARTIFACT_FILE_NAME,
    artifactBytes: 1024,
    sha256: "a".repeat(64),
    journalHash: "b".repeat(64),
  };
}

/**
 * Builds a Drizzle journal folder in the layout the installed drizzle-orm
 * migrator reads: one `<timestamp>_<name>/migration.sql` per migration (the
 * migrator derives each stored hash from that file's full content; there is
 * no `meta/_journal.json` in this layout).
 */
function buildJournalTree(dir: string, initSql: string): void {
  mkdirSync(join(dir, "00000000000000_init"), { recursive: true });
  writeFileSync(join(dir, "00000000000000_init", "migration.sql"), initSql);
}

beforeAll(() => {
  workspace = mkdtempSync(join(process.cwd(), ".tmp-backup-test-"));
  buildJournalTree(join(workspace, "backend", "drizzle"), "CREATE TABLE probe (id integer);\n");
  goodEnvFile = writeEnvFile(".env-backup-good", `DATABASE_URL=${FIXTURE_DSN}\n`);
  queryDbnameEnvFile = writeEnvFile(
    ".env-backup-query-dbname",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/?dbname=app_db\n"
  );
  sqliteEnvFile = writeEnvFile(".env-backup-sqlite", "DATABASE_URL=file:./dev.db\n");
  placeholderEnvFile = writeEnvFile(
    ".env-backup-placeholder",
    "DATABASE_URL=postgresql://<user>:<password>@localhost/kottaby\n"
  );
  // A raw `#` in the DSN path (quoted so dotenv keeps the literal character —
  // unquoted it would start an env-file comment) and its percent-encoded
  // twin: the refusal/decoded-label pair for the raw-fragment gate.
  rawFragmentEnvFile = writeEnvFile(
    ".env-backup-raw-fragment",
    'DATABASE_URL="postgresql://ops_owner:supersecret-pw@db.internal.example:5432/pt9b#k"\n'
  );
  encodedFragmentEnvFile = writeEnvFile(
    ".env-backup-encoded-fragment",
    'DATABASE_URL="postgresql://ops_owner:supersecret-pw@db.internal.example:5432/pt9b%23k"\n'
  );
  // The sibling raw-`#` channels (same quoted-env-file rule) and their
  // percent-encoded query twin: the query value WHATWG truncates but libpq
  // folds into the dbname value, and the authority span libpq reads as
  // role/host while WHATWG ends the authority at the `#`.
  rawFragmentQueryEnvFile = writeEnvFile(
    ".env-backup-raw-fragment-query",
    'DATABASE_URL="postgresql://ops_owner:supersecret-pw@db.internal.example:5432/?dbname=app_db#k"\n'
  );
  rawFragmentAuthorityEnvFile = writeEnvFile(
    ".env-backup-raw-fragment-authority",
    'DATABASE_URL="postgresql://ops_owner#k:supersecret-pw@db.internal.example:5432/app_db"\n'
  );
  encodedFragmentQueryEnvFile = writeEnvFile(
    ".env-backup-encoded-fragment-query",
    'DATABASE_URL="postgresql://ops_owner:supersecret-pw@db.internal.example:5432/?dbname=app%23db"\n'
  );
  // The R11 live-proven authority-`?` shape (WHATWG ends the authority at
  // the `?`, libpq scans to the `/`) and the db-less DSN the unnamed-source
  // gate refuses.
  rawQuestionAuthorityEnvFile = writeEnvFile(
    ".env-backup-raw-question-authority",
    "DATABASE_URL=postgresql://ops_owner?k:supersecret-pw@db.internal.example:5432/app_db\n"
  );
  dblessEnvFile = writeEnvFile(
    ".env-backup-dbless",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432\n"
  );
  // The R12 control-character shapes (quoted so dotenv keeps the literal
  // bytes): a tab inside the raw authority span, and the live-proven path
  // shape — a database literally named `r12ptab<TAB>k` (WHATWG strips the
  // tab and would label `r12ptabk` while the dump contains the tab byte).
  rawControlAuthorityEnvFile = writeEnvFile(
    ".env-backup-raw-control-authority",
    'DATABASE_URL="postgresql://ops\towner:supersecret-pw@db.internal.example:5432/app_db"\n'
  );
  rawControlPathEnvFile = writeEnvFile(
    ".env-backup-raw-control-path",
    'DATABASE_URL="postgresql://ops_owner:supersecret-pw@db.internal.example:5432/r12ptab\tk"\n'
  );
  // The R13 dot-segment shapes: libpq dumps the literal `a/../db` database
  // while the WHATWG pathname records the normalized `db` — and the
  // percent-encoded twin WHATWG normalizes exactly the same way.
  dotSegmentPathEnvFile = writeEnvFile(
    ".env-backup-dot-segment-path",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/a/../app_db\n"
  );
  encodedDotSegmentPathEnvFile = writeEnvFile(
    ".env-backup-encoded-dot-segment-path",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/a/%2e%2e/app_db\n"
  );
  // The explicitly empty `?dbname=` query value: libpq completes an empty
  // dbname from the USER name (never the path db), so the name is
  // under-specified — the same refusal class as the db-less DSN.
  emptyQueryDbnameEnvFile = writeEnvFile(
    ".env-backup-empty-query-dbname",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/pathdb?dbname=\n"
  );
  // The R14 endpoint-override query shapes: libpq applies `?host=` /
  // `?hostaddr=` / `?port=` ON TOP of the authority, so the redacted
  // authority label can name a different endpoint than the one pg_dump
  // actually connects to (`?hostaddr=8.8.8.8` would ship the dump
  // off-box). The benign twin carries only plain parameters.
  hostOverrideEnvFile = writeEnvFile(
    ".env-backup-host-override",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?host=127.0.0.1&port=5432\n"
  );
  hostaddrOverrideEnvFile = writeEnvFile(
    ".env-backup-hostaddr-override",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?hostaddr=8.8.8.8\n"
  );
  // The service-indirection shape: libpq resolves `?service=` through the
  // connection-service file (~/.pg_service.conf / PGSERVICEFILE), whose
  // host/port decide the endpoint nothing in the URL view sees.
  serviceOverrideEnvFile = writeEnvFile(
    ".env-backup-service-override",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?service=appdb\n"
  );
  // The R16 multi-host shapes: libpq accepts comma-separated host LISTS in
  // the authority and in query host=/hostaddr= values and percent-decodes
  // the host BEFORE the list is split, so the dump can fail over to a second
  // endpoint no URL-derived label names (live-proven:
  // `…@127.0.0.1,8.8.8.8:5432/app_db` completed a real backup while the
  // manifest labeled only `127.0.0.1`). The bracketed IPv6 twin names ONE
  // host and stays allowed.
  commaAuthorityEnvFile = writeEnvFile(
    ".env-backup-comma-authority",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@127.0.0.1,8.8.8.8:5432/app_db\n"
  );
  encodedCommaAuthorityEnvFile = writeEnvFile(
    ".env-backup-encoded-comma-authority",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@127.0.0.1%2C8.8.8.8:5432/app_db\n"
  );
  commaQueryHostEnvFile = writeEnvFile(
    ".env-backup-comma-query-host",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?host=127.0.0.1,8.8.8.8\n"
  );
  bracketedIpv6EnvFile = writeEnvFile(
    ".env-backup-bracketed-ipv6",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@[::1]:5432/app_db\n"
  );
  benignQueryParamsEnvFile = writeEnvFile(
    ".env-backup-benign-query-params",
    "DATABASE_URL=postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?sslmode=disable&application_name=dr-drill\n"
  );
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
  if (ORIGINAL_DATABASE_URL === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
  }
});

describe("parseBackupArgs", () => {
  it("defaults to the standard env file and no out-dir on empty argv", () => {
    expect(parseBackupArgs([])).toEqual({ kind: "ok", envFile: DEFAULT_ENV_FILE });
  });

  it("parses --env and --out-dir in any order", () => {
    expect(parseBackupArgs(["--env", "a.env", "--out-dir", "dumps"])).toEqual({
      kind: "ok",
      envFile: "a.env",
      outDir: "dumps",
    });
    expect(parseBackupArgs(["--out-dir", "dumps", "--env", "a.env"])).toEqual({
      kind: "ok",
      envFile: "a.env",
      outDir: "dumps",
    });
    expect(parseBackupArgs(["--out-dir", "dumps"])).toEqual({
      kind: "ok",
      envFile: DEFAULT_ENV_FILE,
      outDir: "dumps",
    });
  });

  it("treats --help and -h as help requests even among other flags", () => {
    expect(parseBackupArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseBackupArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseBackupArgs(["--env", "a.env", "--help"])).toEqual({ kind: "help" });
  });

  it("rejects unknown flags with a usage-class error", () => {
    expect(parseBackupArgs(["--bogus"])).toEqual({ kind: "error", message: 'unknown argument "--bogus"' });
    expect(parseBackupArgs(["--env", "a.env", "stray"])).toEqual({
      kind: "error",
      message: 'unknown argument "stray"',
    });
  });

  it("rejects missing, flag-like, and empty values", () => {
    expect(parseBackupArgs(["--env"])).toEqual({
      kind: "error",
      message: "--env requires a value argument (got none)",
    });
    expect(parseBackupArgs(["--out-dir"])).toEqual({
      kind: "error",
      message: "--out-dir requires a value argument (got none)",
    });
    expect(parseBackupArgs(["--env", "--out-dir"])).toEqual({
      kind: "error",
      message: '--env requires a value argument (got "--out-dir")',
    });
    expect(parseBackupArgs(["--env", ""])).toEqual({
      kind: "error",
      message: '--env requires a value argument (got "")',
    });
  });

  it("rejects repeated flags", () => {
    expect(parseBackupArgs(["--env", "a.env", "--env", "b.env"])).toEqual({
      kind: "error",
      message: "--env was given more than once",
    });
    expect(parseBackupArgs(["--out-dir", "/a", "--out-dir", "/b"])).toEqual({
      kind: "error",
      message: "--out-dir was given more than once",
    });
  });

  it("documents the flags and the exit-code contract in the usage text", () => {
    const usage = buildUsageText();
    expect(usage).toContain("--env");
    expect(usage).toContain("--out-dir");
    expect(usage).toContain("--help");
    expect(usage).toContain("0  backup published");
    expect(usage).toContain("1  operational failure");
    expect(usage).toContain("2  usage, environment, toolchain, lock-contention");
  });
});

describe("parsePostgresDatabaseUrl", () => {
  it("accepts postgres DSNs with a hostname", () => {
    const parsed = parsePostgresDatabaseUrl(FIXTURE_DSN);
    expect(parsed?.protocol).toBe("postgresql:");
    expect(parsed?.hostname).toBe("db.internal.example");
    expect(parsed?.port).toBe("5432");
    expect(parsed?.username).toBe("ops_owner");
    expect(parsed?.password).toBe(FIXTURE_PASSWORD);
    expect(parsePostgresDatabaseUrl("postgres://u:p@h.example/db")).not.toBeNull();
    expect(parsePostgresDatabaseUrl("  postgresql://h.example/db  ")?.hostname).toBe("h.example");
  });

  it("rejects empty, placeholder, non-Postgres, hostless, and SQLite values", () => {
    for (const bad of [
      undefined,
      "",
      "   ",
      "postgresql://<user>:<password>@localhost/kottaby",
      "mysql://u:p@h.example/db",
      "file:./dev.db",
      "postgresql:///db",
      "totally-not-a-url",
    ]) {
      expect(parsePostgresDatabaseUrl(bad)).toBeNull();
    }
  });
});

describe("databaseNameFromDsn", () => {
  it("uses the path, else the fixed (default) fallback — never the username", () => {
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/db"))).toBe("db");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/my%20db"))).toBe("my db");
    // The db-less fallback is the fixed marker: the URL username (or any
    // userinfo) must never leak into the manifest's `database` field.
    expect(databaseNameFromDsn(new URL("postgresql://fallback@h.example"))).toBe("(default)");
    expect(databaseNameFromDsn(new URL("postgresql://fallback:p@h.example"))).toBe("(default)");
    for (const dsn of [
      "postgresql://leaky@h.example",
      "postgresql://leaky:pw@h.example",
      "postgresql://leaky:pw@h.example/",
      "postgresql://h.example",
    ]) {
      const name = databaseNameFromDsn(new URL(dsn));
      expect(name).toBe("(default)");
      expect(name).not.toContain("leaky");
    }
  });

  it("honors a query dbname= over the path database (libpq applies query parameters on top)", () => {
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/pathdb?dbname=querydb"))).toBe("querydb");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/?dbname=querydb"))).toBe("querydb");
    // Absent and other-key query values keep the path db. An explicitly
    // EMPTY dbname= names NOTHING: libpq completes an empty dbname from the
    // USER name (never the path), so the label degrades to the `(default)`
    // marker and the bootstrap refuses the under-specified DSN. A
    // percent-encoded tab decodes to its literal byte.
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/pathdb?sslmode=require"))).toBe("pathdb");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/pathdb?dbname="))).toBe("(default)");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/pathdb?dbname"))).toBe("(default)");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/r12ptab%09k"))).toBe("r12ptab\tk");
  });

  it("uses the LAST query dbname= occurrence, percent-decoded, with + literal (libpq keyword semantics)", () => {
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/a?dbname=first&dbname=my%20db"))).toBe("my db");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/a?DBNAME=CaseInsensitive"))).toBe("CaseInsensitive");
    expect(databaseNameFromDsn(new URL("postgresql://u:p@h.example/a?dbname=keep+plus"))).toBe("keep+plus");
  });
});

describe("utcStamp", () => {
  it("formats UTC calendar fields with zero padding", () => {
    expect(utcStamp(FIXED_NOW)).toBe(STAMP);
    expect(utcStamp(new Date(Date.UTC(2024, 0, 1, 0, 0, 0)))).toBe("20240101T000000Z");
    expect(utcStamp(new Date("2024-11-09T09:05:03.000Z"))).toBe("20241109T090503Z");
  });

  it("handles year, leap-day, and offset boundaries", () => {
    expect(utcStamp(new Date("1999-12-31T23:59:59.000Z"))).toBe("19991231T235959Z");
    expect(utcStamp(new Date("2024-02-29T23:59:59.000Z"))).toBe("20240229T235959Z");
    expect(utcStamp(new Date("2024-03-05T06:17:08+05:30"))).toBe("20240305T004708Z");
  });
});

describe("run lock lifecycle", () => {
  it("acquires a fresh lock, writes an ISO stamp at 0600, and releases it", () => {
    const outDir = join(workspace, "lock-empty");
    mkdirSync(outDir, { recursive: true });
    expect(scanRunLocks(outDir, FAKE_PID, () => true)).toEqual({
      reclaimedPids: [],
      reclaimedPaths: [],
      liveHolderPids: [],
    });
    const acquired = acquireRunLock(outDir, FAKE_PID, () => true);
    expect(acquired).toEqual({
      ok: true,
      lockPath: lockFilePath(outDir, FAKE_PID),
      reclaimedPids: [],
      reclaimedPaths: [],
    });
    const raw = readFileSync(lockFilePath(outDir, FAKE_PID), "utf8").trim();
    expect(new Date(raw).toISOString()).toBe(raw);
    expect(statSync(lockFilePath(outDir, FAKE_PID)).mode & 0o777).toBe(0o600);
    releaseRunLock(outDir, FAKE_PID);
    expect(existsSync(lockFilePath(outDir, FAKE_PID))).toBe(false);
  });

  it("refuses a live lock and never steals it", () => {
    const outDir = join(workspace, "lock-live");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(lockFilePath(outDir, 777), "held\n");
    expect(acquireRunLock(outDir, FAKE_PID, pid => pid === 777)).toEqual({ ok: false, holderPid: 777 });
    expect(existsSync(lockFilePath(outDir, 777))).toBe(true);
  });

  it("reclaims a stale lock from a dead pid", () => {
    const outDir = join(workspace, "lock-stale");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(lockFilePath(outDir, 999), "dead\n");
    const acquired = acquireRunLock(outDir, FAKE_PID, () => false);
    expect(acquired.ok).toBe(true);
    expect(acquired.ok ? acquired.reclaimedPids : []).toEqual([999]);
    expect(existsSync(lockFilePath(outDir, 999))).toBe(false);
    expect(existsSync(lockFilePath(outDir, FAKE_PID))).toBe(true);
  });

  it("reclaims malformed lock file names", () => {
    const outDir = join(workspace, "lock-malformed");
    mkdirSync(outDir, { recursive: true });
    const malformed = [".lock-", ".lock-0", ".lock-007", ".lock-abc"];
    for (const name of malformed) {
      writeFileSync(join(outDir, name), "junk\n");
    }
    const acquired = acquireRunLock(outDir, FAKE_PID, () => true);
    expect(acquired.ok).toBe(true);
    expect(acquired.ok ? acquired.reclaimedPaths.toSorted((a, b) => a.localeCompare(b)) : []).toEqual(
      malformed.toSorted((a, b) => a.localeCompare(b))
    );
    for (const name of malformed) {
      expect(existsSync(join(outDir, name))).toBe(false);
    }
  });

  it("treats a fresh self-pid lock as live and an aged one as stale", () => {
    const outDir = join(workspace, "lock-self");
    mkdirSync(outDir, { recursive: true });
    const selfLock = lockFilePath(outDir, FAKE_PID);
    writeFileSync(selfLock, "self\n");
    expect(scanRunLocks(outDir, FAKE_PID, () => true)).toEqual({
      reclaimedPids: [],
      reclaimedPaths: [],
      liveHolderPids: [FAKE_PID],
    });
    expect(acquireRunLock(outDir, FAKE_PID, () => true)).toEqual({ ok: false, holderPid: null });
    const aged = new Date(Date.now() - 120_000);
    utimesSync(selfLock, aged, aged);
    expect(scanRunLocks(outDir, FAKE_PID, () => true)).toEqual({
      reclaimedPids: [FAKE_PID],
      reclaimedPaths: [],
      liveHolderPids: [],
    });
    expect(acquireRunLock(outDir, FAKE_PID, () => true).ok).toBe(true);
  });

  it("treats a self-pid lock that vanished mid-scan as absent instead of aborting", () => {
    const outDir = join(workspace, "lock-vanished");
    mkdirSync(outDir, { recursive: true });
    // A broken symlink named `.lock-<selfPid>` makes readdir list the entry
    // while statSync on it throws ENOENT — the exact vanish-mid-scan window.
    symlinkSync(join(outDir, "gone-target"), lockFilePath(outDir, FAKE_PID));
    try {
      expect(scanRunLocks(outDir, FAKE_PID, () => true)).toEqual({
        reclaimedPids: [],
        reclaimedPaths: [],
        liveHolderPids: [],
      });
      // Acquisition must not THROW on the vanishing lock. The broken symlink
      // still occupies the lock name, so the exclusive create reports its
      // EEXIST race path (holder unknown) instead of aborting with an error.
      const acquired = acquireRunLock(outDir, FAKE_PID, () => true);
      expect(acquired.ok).toBe(false);
      expect(acquired.ok ? null : acquired.holderPid).toBeNull();
    } finally {
      rmSync(lockFilePath(outDir, FAKE_PID), { force: true });
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("reports an EEXIST race holder as unknown, never selfPid", () => {
    const outDir = join(workspace, "lock-eexist-race");
    mkdirSync(outDir, { recursive: true });
    // A stale self-pid "lock" that cannot be reclaimed (a directory
    // masquerading as the lock file) drives the exclusive create into EEXIST;
    // the reported holder must never be selfPid.
    mkdirSync(lockFilePath(outDir, FAKE_PID));
    const aged = new Date(Date.now() - 120_000);
    utimesSync(lockFilePath(outDir, FAKE_PID), aged, aged);
    const acquired = acquireRunLock(outDir, FAKE_PID, () => false);
    expect(acquired.ok).toBe(false);
    expect(acquired.ok ? null : acquired.holderPid).toBeNull();
  });

  it("classifies live vs dead holder pids in a mixed directory", () => {
    const outDir = join(workspace, "lock-mixed");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(lockFilePath(outDir, 111), "live\n");
    writeFileSync(lockFilePath(outDir, 222), "dead\n");
    expect(scanRunLocks(outDir, FAKE_PID, pid => pid === 111)).toEqual({
      reclaimedPids: [222],
      reclaimedPaths: [],
      liveHolderPids: [111],
    });
  });

  it("reports pid liveness fail-closed and tolerates releasing a missing lock", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(Number.NaN)).toBe(false);
    expect(isPidAlive(999_999_999)).toBe(false);
    expect(() => releaseRunLock(join(workspace, "never-created"), FAKE_PID)).not.toThrow();
  });
});

describe("backup manifest contract", () => {
  it("builds a manifest stamped with the backup tool identity", () => {
    expect(buildBackupManifest(validManifestInput())).toEqual({ tool: "ops:db-backup", ...validManifestInput() });
    expect(manifestProblems(buildBackupManifest(validManifestInput()))).toEqual([]);
  });

  it("rejects non-object manifests", () => {
    expect(manifestProblems(null)).toEqual(["manifest is not an object"]);
    expect(manifestProblems(42)).toEqual(["manifest is not an object"]);
    expect(manifestProblems("nope")).toEqual(["manifest is not an object"]);
    expect(manifestProblems([])).toContain("field tool must be a non-empty string");
  });

  it("requires every string field to be a non-empty string", () => {
    const stringFields = [
      "toolVersion",
      "postgresServerVersion",
      "pgDumpVersion",
      "database",
      "startedAtUtc",
      "finishedAtUtc",
      "artifactFile",
      "sha256",
      "journalHash",
    ] as const;
    for (const field of stringFields) {
      for (const bad of [undefined, "", 42, null]) {
        const problems = manifestProblems({ ...validManifestInput(), [field]: bad });
        expect(problems).toContain(`field ${field} must be a non-empty string`);
      }
    }
  });

  it("pins the tool discriminator value", () => {
    expect(manifestProblems({ ...validManifestInput(), tool: "ops:db-restore" })).toContain(
      'field tool must be "ops:db-backup"'
    );
    const missingTool = manifestProblems({ ...validManifestInput(), tool: undefined });
    expect(missingTool).toContain("field tool must be a non-empty string");
    expect(missingTool).not.toContain('field tool must be "ops:db-backup"');
  });

  it("requires a positive integer artifactBytes", () => {
    for (const bad of [0, -1, 1.5, "1024", null, undefined, Number.NaN]) {
      expect(manifestProblems({ ...validManifestInput(), artifactBytes: bad })).toContain(
        "field artifactBytes must be a positive integer"
      );
    }
  });

  it("requires 64 lowercase hex hashes and parseable timestamps", () => {
    for (const field of ["sha256", "journalHash"] as const) {
      for (const bad of ["A".repeat(64), "a".repeat(63), "g".repeat(64)]) {
        expect(manifestProblems({ ...validManifestInput(), [field]: bad })).toContain(
          `field ${field} must be 64 lowercase hex characters`
        );
      }
    }
    expect(manifestProblems({ ...validManifestInput(), startedAtUtc: "not-a-date" })).toContain(
      "field startedAtUtc must be a parseable timestamp"
    );
    expect(manifestProblems({ ...validManifestInput(), finishedAtUtc: "absolutely-not-a-timestamp" })).toContain(
      "field finishedAtUtc must be a parseable timestamp"
    );
    expect(manifestProblems({ ...validManifestInput(), startedAtUtc: "2024-03-05T06:17:08Z" })).not.toContain(
      "field startedAtUtc must be a parseable timestamp"
    );
  });
});

describe("hashing and artifact helpers", () => {
  it("hashes file contents identically to node crypto", async () => {
    const filePath = join(workspace, "sha-fixture.bin");
    writeFileSync(filePath, DUMP_CONTENT);
    expect(await sha256File(filePath)).toBe(createHash("sha256").update(DUMP_CONTENT).digest("hex"));
    writeFileSync(filePath, "");
    expect(await sha256File(filePath)).toBe(createHash("sha256").update("").digest("hex"));
  });

  it("derives the trailing migration hash exactly as drizzle-orm readMigrationFiles does", () => {
    const dirA = join(workspace, "journal-a");
    const dirB = join(workspace, "journal-b");
    buildJournalTree(dirA, "CREATE TABLE a (id integer);");
    buildJournalTree(dirB, "CREATE TABLE a (id integer);");
    const hashA = computeJournalHash(dirA);
    expect(hashA).toBe(computeJournalHash(dirA));
    expect(hashA).toBe(computeJournalHash(dirB));
    // The stored __drizzle_migrations.hash of a migration IS the SHA-256 of
    // its full migration.sql content — the manifest must carry that value.
    expect(hashA).toBe(createHash("sha256").update("CREATE TABLE a (id integer);").digest("hex"));
    // A later journal folder becomes the trailing migration and moves the hash.
    mkdirSync(join(dirB, "20260102000000_next"), { recursive: true });
    writeFileSync(join(dirB, "20260102000000_next", "migration.sql"), "ALTER TABLE a ADD COLUMN c text;");
    const hashB = computeJournalHash(dirB);
    expect(hashB).not.toBe(hashA);
    expect(hashB).toBe(createHash("sha256").update("ALTER TABLE a ADD COLUMN c text;").digest("hex"));
    // A folder without migration.sql is not a migration (readMigrationFiles
    // skips it), so the trailing hash is unchanged.
    mkdirSync(join(dirB, "20260103000000_empty"), { recursive: true });
    expect(computeJournalHash(dirB)).toBe(hashB);
  });

  it("returns the migrations-absent sentinel for a journal with no migrations", () => {
    const emptyDir = join(workspace, "journal-empty");
    mkdirSync(emptyDir, { recursive: true });
    expect(computeJournalHash(emptyDir)).toBe(MIGRATIONS_ABSENT_HASH);
    expect(computeJournalHash(emptyDir)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("throws when the journal directory is missing", () => {
    expect(() => computeJournalHash(join(workspace, "journal-missing"))).toThrow(
      "migration journal directory not found"
    );
  });

  it("suffixes run-directory collisions deterministically", () => {
    const outDir = join(workspace, "suffixes");
    mkdirSync(outDir, { recursive: true });
    expect(nextAvailableRunDirName(outDir, "run")).toBe("run");
    mkdirSync(join(outDir, "run"));
    expect(nextAvailableRunDirName(outDir, "run")).toBe("run-2");
    mkdirSync(join(outDir, "run-2"));
    expect(nextAvailableRunDirName(outDir, "run")).toBe("run-3");
  });

  it("lists leftover staging directories in sorted order", () => {
    const outDir = join(workspace, "leftovers");
    mkdirSync(join(outDir, `${STAGING_DIR_PREFIX}2-a`), { recursive: true });
    mkdirSync(join(outDir, `${STAGING_DIR_PREFIX}1-b`), { recursive: true });
    mkdirSync(join(outDir, "20240101T000000Z_FAILED"), { recursive: true });
    mkdirSync(join(outDir, "unrelated"), { recursive: true });
    expect(listLeftoverStagingDirs(outDir)).toEqual([`${STAGING_DIR_PREFIX}1-b`, `${STAGING_DIR_PREFIX}2-a`]);
  });

  it("creates a 0700 staging directory with a pre-created empty 0600 artifact", () => {
    const outDir = join(workspace, "staging");
    mkdirSync(outDir, { recursive: true });
    const stagingDir = createStagingDir(outDir, FAKE_PID, STAMP);
    expect(stagingDir).toBe(join(outDir, `${STAGING_DIR_PREFIX}${FAKE_PID}-${STAMP}`));
    expect(statSync(stagingDir).mode & 0o777).toBe(0o700);
    const artifactPath = join(stagingDir, ARTIFACT_FILE_NAME);
    expect(statSync(artifactPath).size).toBe(0);
    expect(statSync(artifactPath).mode & 0o777).toBe(0o600);
    expect(createStagingDir(outDir, FAKE_PID, STAMP).endsWith(`-${STAMP}-2`)).toBe(true);
  });

  it("skips a pre-existing symlink at the staging name and never writes through it", () => {
    const outDir = join(workspace, "staging-symlink");
    mkdirSync(outDir, { recursive: true });
    const outsideTarget = join(workspace, "staging-symlink-outside");
    mkdirSync(outsideTarget, { recursive: true });
    symlinkSync(outsideTarget, join(outDir, `${STAGING_DIR_PREFIX}${FAKE_PID}-${STAMP}`));
    const stagingDir = createStagingDir(outDir, FAKE_PID, STAMP);
    expect(stagingDir).toBe(join(outDir, `${STAGING_DIR_PREFIX}${FAKE_PID}-${STAMP}-2`));
    // The pre-created artifact lives in the real staging directory; nothing
    // may have been written through the link into the outside target.
    expect(existsSync(join(stagingDir, ARTIFACT_FILE_NAME))).toBe(true);
    expect(readdirSync(outsideTarget)).toEqual([]);
  });

  it("writes the manifest at 0600 as parseable JSON with a trailing newline", () => {
    const stagingDir = join(workspace, "manifest-write");
    mkdirSync(stagingDir, { recursive: true });
    const manifest = buildBackupManifest(validManifestInput());
    const manifestPath = writeManifestFile(stagingDir, manifest);
    expect(manifestPath).toBe(join(stagingDir, MANIFEST_FILE_NAME));
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    const raw = readFileSync(manifestPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual(manifest);
    expect(manifestProblems(JSON.parse(raw))).toEqual([]);
  });

  it("flags output directories outside the repo or at the repo root", () => {
    expect(isLikelyNonDisposable(workspace, workspace)).toBe(true);
    expect(isLikelyNonDisposable(join(workspace, "backups"), workspace)).toBe(false);
    expect(isLikelyNonDisposable(join(workspace, "..", "elsewhere"), workspace)).toBe(true);
  });

  it("classifies system paths for the out-dir refusal", () => {
    expect(isSystemOutDir("/")).toBe(true);
    for (const systemDir of ["/etc", "/usr", "/boot", "/proc", "/sys", "/dev", "/var/run"]) {
      expect(isSystemOutDir(systemDir)).toBe(true);
      expect(isSystemOutDir(`${systemDir}/kottaby-backups`)).toBe(true);
    }
    // Merely-unusual paths are NOT refused (they only draw the warning).
    // /tmp is deliberately absent from the refusal list; built via join() so
    // this stays an assertion about the classifier, not a tmpfs write target.
    expect(isSystemOutDir(join("/", "tmp", "xyz"))).toBe(false);
    expect(isSystemOutDir("/etcx")).toBe(false);
    expect(isSystemOutDir("/var/runx")).toBe(false);
    expect(isSystemOutDir(join(workspace, "backups"))).toBe(false);
  });
});

describe("credential redaction for backup flows", () => {
  it("renders the fixture DSN in the operator-facing summary shape", () => {
    expect(redactDsn(FIXTURE_DSN)).toBe(REDACTED_FIXTURE);
    expect(redactDsn("")).toBe("redacted-dsn");
    expect(redactDsn("   ")).toBe("redacted-dsn");
  });

  it("scrubs a credential-bearing pg_dump failure tail", () => {
    const tail = `pg_dump: error: connection to server failed: ${FIXTURE_DSN}\nFATAL: password authentication failed for user "${FIXTURE_USER}"`;
    const scrubbed = scrubDsnSecrets(tail, FIXTURE_DSN);
    expect(scrubbed).toContain(REDACTED_FIXTURE);
    expect(scrubbed).toContain("***");
    expect(scrubbed).not.toContain(FIXTURE_PASSWORD);
    expect(scrubbed).not.toContain(FIXTURE_USER);
    expect(scrubbed).not.toContain("postgresql://");
  });

  it("sweeps foreign-DSN userinfo from tool output even without a known DSN", () => {
    expect(scrubDsnSecrets("echo: postgresql://stranger:hunter2@elsewhere.example/db")).toBe(
      "echo: postgresql://***:***@elsewhere.example/db"
    );
  });
});

describe("buildChildEnv and stderrTail", () => {
  it("forwards only the libpq allowlist — never the parent env or service/database indirection", () => {
    const env = buildChildEnv({
      PATH: "/usr/bin:/bin",
      HOME: "/home/op",
      LANG: "C.UTF-8",
      PGPASSWORD: "pw",
      PGPASSFILE: "/pgpass",
      PGSSLMODE: "require",
      PGSSLROOTCERT: "/ca.pem",
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: "ambient_db",
      PGSERVICE: "svc",
      PGSERVICEFILE: "/pgsvc",
      PGAPPNAME: "ops-backup",
      DATABASE_URL: FIXTURE_DSN,
      AWS_SECRET_ACCESS_KEY: "nope",
      SHELL: "/bin/sh",
    });
    expect(env).toEqual({
      PATH: "/usr/bin:/bin",
      HOME: "/home/op",
      LANG: "C.UTF-8",
      PGPASSWORD: "pw",
      PGPASSFILE: "/pgpass",
      PGSSLMODE: "require",
      PGSSLROOTCERT: "/ca.pem",
      PGCONNECT_TIMEOUT: "10",
      PGAPPNAME: "ops-backup",
    });
    expect("DATABASE_URL" in buildChildEnv({ DATABASE_URL: FIXTURE_DSN })).toBe(false);
    // Endpoint-deciding parity with the restore family: the connection is
    // decided by the DSN argv value alone, never the ambient environment.
    expect("PGDATABASE" in env).toBe(false);
    expect("PGSERVICE" in env).toBe(false);
    expect("PGSERVICEFILE" in env).toBe(false);
    expect(buildChildEnv({ PATH: "/bin", PGPASSWORD: undefined })).toEqual({ PATH: "/bin" });
  });

  it("keeps the last non-empty lines and reports when nothing was captured", () => {
    expect(stderrTail("a\nb\n\nc  \n")).toBe("a\nb\nc");
    expect(stderrTail("l1\nl2\nl3", 2)).toBe("l2\nl3");
    expect(stderrTail("a\nb", 2)).toBe("a\nb");
    expect(stderrTail("")).toBe("(no stderr captured)");
    expect(stderrTail("\n\n   \n")).toBe("(no stderr captured)");
  });
});

/** Version-probe behavior: fixed pg_dump version output, then a fixed psql outcome. */
function versionBehavior(dumpVersion: string, serverOut: string | Error): SpawnBehavior {
  return argv => {
    if (argv[0] === "pg_dump" && argv[1] === "--version") {
      return { exitCode: 0, stdout: dumpVersion, stderr: "" };
    }
    if (typeof serverOut === "string") {
      return { exitCode: 0, stdout: serverOut, stderr: "" };
    }
    throw serverOut;
  };
}

describe("probeToolchain", () => {
  async function probeWith(behavior: SpawnBehavior) {
    return probeToolchain(fakeSpawn(behavior, []), FIXTURE_DSN, { PATH: "/usr/bin" });
  }

  it("passes when the client major is not older than the server major", async () => {
    expect(await probeWith(probeAndDumpBehavior(() => ({ exitCode: 0, stdout: "", stderr: "" })))).toEqual({
      ok: true,
      pgDumpVersion: PG_DUMP_VERSION,
      postgresServerVersion: "16.4",
    });
  });

  it("fails closed when pg_dump cannot be spawned", async () => {
    const probe = await probeWith(() => {
      throw new Error("spawn pg_dump ENOENT");
    });
    expect(probe.ok).toBe(false);
    expect(probe.ok ? "" : probe.message).toContain("pg_dump was not found on PATH.");
  });

  it("fails when pg_dump or psql exit non-zero and scrubs psql stderr", async () => {
    const dumpFailure = await probeWith(argv =>
      argv[0] === "pg_dump"
        ? { exitCode: 3, stdout: "", stderr: "boom" }
        : { exitCode: 0, stdout: SERVER_VERSION_OUT, stderr: "" }
    );
    expect(dumpFailure.ok ? "" : dumpFailure.message).toContain(
      "pg_dump is not usable (pg_dump --version exited with code 3)."
    );

    const serverFailure = await probeWith(probeAndDumpBehavior(() => ({ exitCode: 0, stdout: "", stderr: "" })));
    expect(serverFailure.ok).toBe(true);

    const psqlFailure = await probeWith(argv =>
      argv[0] === "psql"
        ? { exitCode: 1, stdout: "", stderr: `connection failed: ${FIXTURE_DSN} password ${FIXTURE_PASSWORD}` }
        : { exitCode: 0, stdout: PG_DUMP_VERSION, stderr: "" }
    );
    const psqlMessage = psqlFailure.ok ? "" : psqlFailure.message;
    expect(psqlMessage).toContain("could not query the server version (psql exited with code 1)");
    expect(psqlMessage).toContain(REDACTED_FIXTURE);
    expect(psqlMessage).not.toContain(FIXTURE_PASSWORD);
  });

  it("fails on missing output, unparseable versions, and an older client major", async () => {
    const noDumpVersion = await probeWith(versionBehavior("", SERVER_VERSION_OUT));
    expect(noDumpVersion.ok ? "" : noDumpVersion.message).toContain("pg_dump --version produced no output.");

    const garbageClient = await probeWith(versionBehavior("??", SERVER_VERSION_OUT));
    expect(garbageClient.ok ? "" : garbageClient.message).toContain('could not parse the pg_dump version from "??"');

    const missingPsql = await probeWith(versionBehavior(PG_DUMP_VERSION, new Error("spawn psql ENOENT")));
    expect(missingPsql.ok ? "" : missingPsql.message).toContain("psql was not found on PATH.");

    const garbageServer = await probeWith(versionBehavior(PG_DUMP_VERSION, "??\n"));
    expect(garbageServer.ok ? "" : garbageServer.message).toContain('could not parse the server version from "??"');

    const oldClient = await probeWith(versionBehavior("pg_dump (PostgreSQL) 14.11\n", SERVER_VERSION_OUT));
    expect(oldClient.ok ? "" : oldClient.message).toContain("pg_dump major 14 is older than the server major 16");
  });

  it("points operators at the recovery runbook in every failure message", async () => {
    const probe = await probeWith(() => {
      throw new Error("spawn pg_dump ENOENT");
    });
    expect(probe.ok ? "" : probe.message).toContain("docs/ops/disaster-recovery.md");
  });
});

describe("runPgDump", () => {
  const dumpDir = () => join(workspace, "dump-tests");
  const artifactPath = () => join(dumpDir(), ARTIFACT_FILE_NAME);

  it("succeeds for a non-empty artifact and enforces 0600", async () => {
    mkdirSync(dumpDir(), { recursive: true });
    writeFileSync(artifactPath(), DUMP_CONTENT);
    chmodSync(artifactPath(), 0o644);
    const runner = fakeSpawn(() => ({ exitCode: 0, stdout: "", stderr: "" }), []);
    const result = await runPgDump(runner, { PATH: "/bin" }, artifactPath(), FIXTURE_DSN);
    expect(result).toEqual({ ok: true, artifactBytes: Buffer.byteLength(DUMP_CONTENT) });
    expect(statSync(artifactPath()).mode & 0o777).toBe(0o600);
  });

  it("fails for a zero-byte artifact even when pg_dump exits 0", async () => {
    writeFileSync(artifactPath(), "");
    const runner = fakeSpawn(() => ({ exitCode: 0, stdout: "", stderr: "" }), []);
    const result = await runPgDump(runner, { PATH: "/bin" }, artifactPath(), FIXTURE_DSN);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("the artifact is 0 bytes");
  });

  it("fails when the artifact file is missing", async () => {
    const result = await runPgDump(
      fakeSpawn(() => ({ exitCode: 0, stdout: "", stderr: "" }), []),
      { PATH: "/bin" },
      join(dumpDir(), "gone.pgc"),
      FIXTURE_DSN
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("the artifact file is missing");
  });

  it("reports non-zero exits with a credential-scrubbed stderr tail", async () => {
    const stderr = `pg_dump: error: connection failed\nretry hint: ${FIXTURE_DSN}\npassword ${FIXTURE_PASSWORD} rejected`;
    const result = await runPgDump(
      fakeSpawn(() => ({ exitCode: 2, stdout: "", stderr }), []),
      { PATH: "/bin" },
      artifactPath(),
      FIXTURE_DSN
    );
    expect(result.ok).toBe(false);
    const message = result.ok ? "" : result.message;
    expect(message).toContain("pg_dump exited with code 2");
    expect(message).toContain(REDACTED_FIXTURE);
    expect(message).not.toContain(FIXTURE_PASSWORD);
  });

  it("reports spawn failures without leaking the DSN", async () => {
    const result = await runPgDump(
      fakeSpawn(() => {
        throw new Error("spawn pg_dump ENOENT");
      }, []),
      { PATH: "/bin" },
      artifactPath(),
      FIXTURE_DSN
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.message).toContain("could not run pg_dump");
  });
});

describe("runBackup — success boundary", () => {
  it("publishes the run directory with a verifiable manifest and releases the lock", async () => {
    const outDir = join(workspace, "run-success");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(0);

    const runDir = join(outDir, STAMP);
    expect(existsSync(runDir)).toBe(true);
    const artifactPath = join(runDir, ARTIFACT_FILE_NAME);
    const manifestPath = join(runDir, MANIFEST_FILE_NAME);
    expect(statSync(artifactPath).size).toBe(Buffer.byteLength(DUMP_CONTENT));
    expect(statSync(artifactPath).mode & 0o777).toBe(0o600);
    expect(statSync(manifestPath).mode & 0o777).toBe(0o600);
    expect(statSync(runDir).mode & 0o777).toBe(0o700);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toEqual({
      tool: "ops:db-backup",
      toolVersion: "1.0.0",
      postgresServerVersion: "16.4",
      pgDumpVersion: PG_DUMP_VERSION,
      database: "ops_db",
      startedAtUtc: FIXED_NOW.toISOString(),
      finishedAtUtc: FIXED_NOW.toISOString(),
      artifactFile: ARTIFACT_FILE_NAME,
      artifactBytes: Buffer.byteLength(DUMP_CONTENT),
      sha256: createHash("sha256").update(DUMP_CONTENT).digest("hex"),
      journalHash: computeJournalHash(join(workspace, "backend", "drizzle")),
    });
    expect(lockFileNames(outDir)).toEqual([]);
    expect(run.logs.some(line => line.includes("toolchain ok"))).toBe(true);
    expect(run.logs.some(line => line.includes(`backup complete: ${runDir}`))).toBe(true);
    expect(run.logs.some(line => line.includes(`backing up ${REDACTED_FIXTURE}`))).toBe(true);
  });

  it("records the query dbname= as the manifest database when the DSN path is empty (libpq override channel)", async () => {
    const outDir = join(workspace, "run-query-dbname");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: queryDbnameEnvFile,
      outDir,
    });
    expect(run.code).toBe(0);

    // libpq applies query parameters on top of the URI: with an empty path
    // the query dbname IS the database pg_dump dumps, so the manifest (and
    // the redacted log line) must record it — never the "(default)" marker.
    const manifest = JSON.parse(readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toMatchObject({ database: "app_db" });
    expect(run.logs.some(line => line.includes("backing up app_db@db.internal.example:5432(redacted-user)"))).toBe(
      true
    );
    // The child still receives the ORIGINAL DSN libpq resolves.
    const dumpCall = run.calls.find(call => call.argv[0] === "pg_dump" && call.argv[1] !== "--version");
    expect(dumpCall?.argv.at(-1)).toBe("postgresql://ops_owner:supersecret-pw@db.internal.example:5432/?dbname=app_db");
  });

  it("records the decoded literal database for a percent-encoded fragment path in the manifest", async () => {
    const outDir = join(workspace, "run-encoded-fragment");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: encodedFragmentEnvFile,
      outDir,
    });
    expect(run.code).toBe(0);

    // libpq percent-decodes the path database — `pt9b%23k` IS the literal
    // `pt9b#k` database — and the WHATWG label decodes to the same value,
    // so the manifest records exactly the database pg_dump dumps.
    const manifest = JSON.parse(readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toMatchObject({ database: "pt9b#k" });
    expect(run.logs.some(line => line.includes("backing up pt9b#k@db.internal.example:5432(redacted-user)"))).toBe(
      true
    );
    // The child still receives the ORIGINAL DSN libpq resolves.
    const dumpCall = run.calls.find(call => call.argv[0] === "pg_dump" && call.argv[1] !== "--version");
    expect(dumpCall?.argv.at(-1)).toBe("postgresql://ops_owner:supersecret-pw@db.internal.example:5432/pt9b%23k");
    expectNoCredentials(run.all);
  });

  it("records the decoded literal database for a percent-encoded query dbname= in the manifest", async () => {
    const outDir = join(workspace, "run-encoded-fragment-query");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: encodedFragmentQueryEnvFile,
      outDir,
    });
    expect(run.code).toBe(0);

    // libpq percent-decodes the query dbname — `app%23db` IS the literal
    // `app#db` database — and the WHATWG query value decodes to the same
    // value, so the manifest records exactly the database pg_dump dumps.
    const manifest = JSON.parse(readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toMatchObject({ database: "app#db" });
    expect(run.logs.some(line => line.includes("backing up app#db@db.internal.example:5432(redacted-user)"))).toBe(
      true
    );
    // The child still receives the ORIGINAL DSN libpq resolves.
    const dumpCall = run.calls.find(call => call.argv[0] === "pg_dump" && call.argv[1] !== "--version");
    expect(dumpCall?.argv.at(-1)).toBe(
      "postgresql://ops_owner:supersecret-pw@db.internal.example:5432/?dbname=app%23db"
    );
    expectNoCredentials(run.all);
  });

  it("spawns exactly the probe and dump processes as argv arrays with an allowlisted env", async () => {
    const outDir = join(workspace, "run-spawn-contract");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(0);
    expect(run.calls).toHaveLength(3);
    expect(run.calls[0]?.argv).toEqual(["pg_dump", "--version"]);
    expect(run.calls[1]?.argv.at(-1)).toBe(FIXTURE_DSN);
    expect(run.calls[1]?.argv).toContain("--no-password");
    expect(run.calls[2]?.argv[0]).toBe("pg_dump");
    expect(run.calls[2]?.argv).toContain("--format=custom");
    expect(run.calls[2]?.argv).toContain("--no-password");
    expect(run.calls[2]?.argv.at(-1)).toBe(FIXTURE_DSN);
    for (const call of run.calls) {
      expect(Array.isArray(call.argv)).toBe(true);
      for (const arg of call.argv) {
        expect(typeof arg).toBe("string");
        expect(arg).not.toContain(" && ");
      }
      expect(typeof call.env).toBe("object");
      expect("DATABASE_URL" in call.env).toBe(false);
      expect(Object.keys(call.env)).toContain("PATH");
      for (const value of Object.values(call.env)) {
        expect(value).not.toContain(FIXTURE_PASSWORD);
      }
    }
  });

  it("suffixes same-second publish collisions deterministically", async () => {
    const outDir = join(workspace, "run-collision");
    mkdirSync(join(outDir, STAMP), { recursive: true });
    const first = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(first.code).toBe(0);
    expect(existsSync(join(outDir, `${STAMP}-2`))).toBe(true);
    const second = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(second.code).toBe(0);
    expect(existsSync(join(outDir, `${STAMP}-3`))).toBe(true);
    expect(manifestProblems(JSON.parse(readFileSync(join(outDir, `${STAMP}-3`, MANIFEST_FILE_NAME), "utf8")))).toEqual(
      []
    );
  });

  it("warns about a non-disposable out-dir yet still succeeds", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "kottaby-backup-outside-"));
    try {
      const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
      expect(run.code).toBe(0);
      expect(run.errors.some(line => line.includes("outside the repository"))).toBe(true);
      expect(run.errors.some(line => line.includes("refusing to write backups into the system path"))).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  it("accepts an absolute --env path (cwd-independent bootstrap)", async () => {
    const absoluteEnvFile = join(workspace, "env-abs", ".env-absolute");
    mkdirSync(dirname(absoluteEnvFile), { recursive: true });
    writeFileSync(absoluteEnvFile, `DATABASE_URL=${FIXTURE_DSN}\n`);
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: absoluteEnvFile,
      outDir: join(workspace, "run-abs-env"),
    });
    expect(run.code).toBe(0);
    expect(run.logs.some(line => line.includes(`backup complete:`))).toBe(true);
  });

  it("warns about leftover staging directories from crashed runs", async () => {
    const outDir = join(workspace, "run-leftover");
    mkdirSync(join(outDir, `${STAGING_DIR_PREFIX}999-old`), { recursive: true });
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(0);
    expect(
      run.errors.some(
        line => line.includes("leftover staging directory") && line.includes(`${STAGING_DIR_PREFIX}999-old`)
      )
    ).toBe(true);
  });

  it("routes a run around a pre-existing symlink at the staging name (never writes through it)", async () => {
    const outDir = join(workspace, "run-staging-symlink");
    mkdirSync(outDir, { recursive: true });
    const outsideTarget = join(workspace, "run-staging-symlink-outside");
    mkdirSync(outsideTarget, { recursive: true });
    symlinkSync(outsideTarget, join(outDir, `${STAGING_DIR_PREFIX}${FAKE_PID}-${STAMP}`));
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(0);
    // The run published normally from the -2 staging directory; the symlink
    // and its target are untouched.
    expect(existsSync(join(outDir, STAMP, MANIFEST_FILE_NAME))).toBe(true);
    expect(existsSync(join(outDir, STAMP, ARTIFACT_FILE_NAME))).toBe(true);
    expect(readdirSync(outsideTarget)).toEqual([]);
  });
});

describe("runBackup — failure boundaries", () => {
  it("fails a zero-byte artifact with exit 1 and retains a _FAILED staging directory", async () => {
    const outDir = join(workspace, "run-zero-byte");
    const run = await runBackupWith(
      probeAndDumpBehavior(() => ({ exitCode: 0, stdout: "", stderr: "" })),
      { envFile: goodEnvFile, outDir }
    );
    expect(run.code).toBe(1);
    expect(run.errors.some(line => line.startsWith("[pg_dump]") && line.includes("0 bytes"))).toBe(true);
    const failedDir = join(outDir, `${STAMP}_FAILED`);
    expect(existsSync(failedDir)).toBe(true);
    expect(statSync(join(failedDir, ARTIFACT_FILE_NAME)).size).toBe(0);
    expect(existsSync(join(failedDir, MANIFEST_FILE_NAME))).toBe(false);
    expect(existsSync(join(outDir, STAMP))).toBe(false);
    expect(lockFileNames(outDir)).toEqual([]);
    expectNoCredentials(run.all);
  });

  it("exits 2 when the env file is missing", async () => {
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: missingEnvFile(),
      outDir: join(workspace, "run-no-env"),
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.startsWith("[env]") && line.includes("env bootstrap failed"))).toBe(true);
  });

  it("exits 2 when the env file carries a placeholder DATABASE_URL", async () => {
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: placeholderEnvFile,
      outDir: join(workspace, "run-placeholder"),
    });
    expect(run.code).toBe(2);
    expect(
      run.errors.some(line => line.startsWith("[env]") && line.includes("does not contain a valid DATABASE_URL"))
    ).toBe(true);
  });

  it("exits 2 when no DATABASE_URL survives env bootstrap", async () => {
    const sqliteOnlyEnvFile = writeEnvFile(".env-backup-no-dsn", "DB_PROVIDER=sqlite\nDB_FILE_NAME=file:./dev.db\n");
    delete process.env.DATABASE_URL;
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: sqliteOnlyEnvFile,
      outDir: join(workspace, "run-no-dsn"),
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("DATABASE_URL is missing or invalid after loading"))).toBe(true);
  });

  it("exits 2 for a SQLite target with the dialect guidance", async () => {
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: sqliteEnvFile,
      outDir: join(workspace, "run-sqlite"),
    });
    expect(run.code).toBe(2);
    expect(
      run.errors.some(line => line.includes("must be a postgresql:// connection string") && line.includes("SQLite"))
    ).toBe(true);
  });

  it("refuses a raw fragment character in the source DSN path with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-fragment");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawFragmentEnvFile,
      outDir,
    });
    // libpq reads THROUGH a raw `#` (it would dump the literal `pt9b#k`
    // database) while the WHATWG manifest label ends the path at the `#` —
    // the bootstrap refuses the DSN before anything runs (fail closed).
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    // Refused in the bootstrap path: the out-dir is never created — no
    // staging, no dump artifact, no manifest, no lock file.
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a raw fragment character in the query dbname= with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-fragment-query");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawFragmentQueryEnvFile,
      outDir,
    });
    // libpq folds a raw `#` into the query parameter value (it would dump
    // the literal `app_db#k` database) while the WHATWG query value — the
    // manifest's override channel — ends at the `#` and records `app_db`.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a raw fragment character in the authority span with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-fragment-authority");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawFragmentAuthorityEnvFile,
      outDir,
    });
    // libpq scans the authority to the first `/` and splits userinfo at the
    // last `@` inside it (role `ops_owner#k` dumping `app_db`), while the
    // WHATWG parser ends the authority at the `#` — the empty path label
    // would render the `(default)` marker in the manifest.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a raw ? in the authority span with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-question-authority");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawQuestionAuthorityEnvFile,
      outDir,
    });
    // The live-proven R11 shape: WHATWG ends the authority at the `?`
    // (host `ops_owner`, empty path — the `(default)` manifest label)
    // while libpq scans the authority to the `/` and dumps the named
    // database as role `ops_owner?k` — unassessable, refused fail-closed.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a raw control character in the authority span with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-control-authority");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawControlAuthorityEnvFile,
      outDir,
    });
    // WHATWG strips a raw tab from the URL it parses while libpq keeps the
    // literal byte in the userinfo it splits — the assessed view and the
    // connection diverge, so the bootstrap refuses before anything runs.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a raw control character in the raw path span with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-raw-control-path");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: rawControlPathEnvFile,
      outDir,
    });
    // Live-proven R12 shape: the database is literally named
    // `r12ptab<TAB>k`; WHATWG strips the tab and the manifest would label
    // `r12ptabk` while the dump contains the tab byte — refused fail-closed
    // in the bootstrap.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN contains an unassessable character sequence — percent-encode special characters"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a dot-segment source DSN path with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-dot-segment-path");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: dotSegmentPathEnvFile,
      outDir,
    });
    // Live-proven R13 shape: libpq dumps the literal `a/../app_db` database
    // while the WHATWG pathname — the manifest label's source — records the
    // normalized `app_db`: the manifest would rename the dumped database.
    expect(run.code).toBe(2);
    expect(run.errors).toContain("[env] source DSN path contains dot-segments — use the literal database name");
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a percent-encoded dot-segment source DSN path with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-encoded-dot-segment-path");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: encodedDotSegmentPathEnvFile,
      outDir,
    });
    // %2e is normalized by WHATWG exactly like a literal dot, so the
    // decoded span is refused with the same single message.
    expect(run.code).toBe(2);
    expect(run.errors).toContain("[env] source DSN path contains dot-segments — use the literal database name");
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses an explicitly empty ?dbname= query value with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-empty-query-dbname");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: emptyQueryDbnameEnvFile,
      outDir,
    });
    // libpq completes an EMPTY dbname= from the USER name (live-proven: the
    // dump header said `dbname: postgres` while the path-fallback manifest
    // label said the path database) — the same under-specified shape as the
    // db-less DSN, refused with the same message.
    expect(run.code).toBe(2);
    expect(run.errors).toContain("[env] source database name is unspecified — name the database explicitly");
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a db-less source DSN with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-dbless-source");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: dblessEnvFile,
      outDir,
    });
    // No path database and no `?dbname=` query: the ambient libpq
    // environment (PGDATABASE) would complete the endpoint, so the dump's
    // provenance is unverifiable and the manifest would carry the
    // `(default)` marker — the backup-side mirror of the restore-side
    // unnamed-target rule.
    expect(run.code).toBe(2);
    expect(run.errors).toContain("[env] source database name is unspecified — name the database explicitly");
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a ?host=/?port= source-DSN query override with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-host-override-query");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: hostOverrideEnvFile,
      outDir,
    });
    // Live-proven R14 shape: libpq applies `?host=`/`?port=` ON TOP of the
    // authority, so a backup proceeded while the redacted label named the
    // (dead) authority endpoint — the query channel is not an assessable
    // endpoint source; the DSN authority names the endpoint.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN endpoint override in query string is not supported — put host/port in the DSN authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a ?hostaddr= source-DSN query override with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-hostaddr-override-query");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: hostaddrOverrideEnvFile,
      outDir,
    });
    // hostaddr is the address libpq CONNECTS to directly — a numeric remote
    // endpoint would ship the dump off-box while every label keeps
    // rendering the authority host.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN endpoint override in query string is not supported — put host/port in the DSN authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a ?service= source-DSN query override with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-service-override-query");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: serviceOverrideEnvFile,
      outDir,
    });
    // libpq resolves `?service=` through the connection-service file
    // (~/.pg_service.conf / PGSERVICEFILE) — a redirected service file made
    // `…@127.0.0.1/db?service=x` connect on port 5999 — so the query
    // channel can name an endpoint no URL-derived label sees. Its own
    // message: the remediation is the endpoint in the DSN authority.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN service indirection is not supported — name the endpoint in the DSN authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a comma-separated authority host list with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-comma-authority");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: commaAuthorityEnvFile,
      outDir,
    });
    // Live-proven R16 shape: libpq failover connects to the SECOND host in
    // the comma list while the manifest labels only the first authority
    // host — refused before anything runs (fail closed).
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN multi-host endpoints are not supported — name a single host in the authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a percent-encoded comma in the authority host span with exit 2 and zero side effects", async () => {
    const outDir = join(workspace, "run-encoded-comma-authority");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: encodedCommaAuthorityEnvFile,
      outDir,
    });
    // libpq percent-decodes the host BEFORE the multi-host list is split,
    // so %2C hides the second endpoint from the raw view exactly like a
    // literal comma — the decoded span is refused with the same message.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN multi-host endpoints are not supported — name a single host in the authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("refuses a comma-separated query host= value with the multi-host message and zero side effects", async () => {
    const outDir = join(workspace, "run-comma-query-host");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: commaQueryHostEnvFile,
      outDir,
    });
    // Query host=/hostaddr= values are comma-split into host lists too; the
    // multi-host gate runs BEFORE the endpoint-override gate, so this shape
    // gets the multi-host message rather than the generic override one.
    expect(run.code).toBe(2);
    expect(run.errors).toContain(
      "[env] source DSN multi-host endpoints are not supported — name a single host in the authority"
    );
    expect(run.calls).toEqual([]);
    expect(existsSync(outDir)).toBe(false);
  });

  it("allows a bracketed IPv6 authority host and dumps the named database", async () => {
    const outDir = join(workspace, "run-bracketed-ipv6");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: bracketedIpv6EnvFile,
      outDir,
    });
    // Brackets carry ONE host — commas cannot appear inside them — so the
    // multi-host gate never trips and the run completes normally.
    expect(run.code).toBe(0);
    expect(run.all).not.toContain("multi-host");
    const manifest = JSON.parse(readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toMatchObject({ database: "app_db" });
    // The child still receives the ORIGINAL DSN libpq resolves.
    const dumpCall = run.calls.find(call => call.argv[0] === "pg_dump" && call.argv[1] !== "--version");
    expect(dumpCall?.argv.at(-1)).toBe("postgresql://ops_owner:supersecret-pw@[::1]:5432/app_db");
  });

  it("allows plain query parameters and dumps the authority-named database", async () => {
    const outDir = join(workspace, "run-benign-query-params");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: benignQueryParamsEnvFile,
      outDir,
    });
    expect(run.code).toBe(0);
    // Only the endpoint keys (`host`/`hostaddr`/`port`/`service`) refuse:
    // `sslmode`/`application_name`
    // reshape neither the endpoint nor the database, so the run succeeds
    // and the manifest names the path database.
    const manifest = JSON.parse(readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8")) as unknown;
    expect(manifestProblems(manifest)).toEqual([]);
    expect(manifest).toMatchObject({ database: "app_db" });
    // The child still receives the ORIGINAL DSN libpq resolves.
    const dumpCall = run.calls.find(call => call.argv[0] === "pg_dump" && call.argv[1] !== "--version");
    expect(dumpCall?.argv.at(-1)).toBe(
      "postgresql://ops_owner:supersecret-pw@db.internal.example:5432/app_db?sslmode=disable&application_name=dr-drill"
    );
  });

  it("exits 2 when a live lock is held and never steals it", async () => {
    const outDir = join(workspace, "run-lock-refused");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(lockFilePath(outDir, 777), "held\n");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: goodEnvFile,
      outDir,
      isAlive: pid => pid === 777,
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("another backup holds the run lock (pid 777)"))).toBe(true);
    expect(existsSync(lockFilePath(outDir, 777))).toBe(true);
    expect(readdirSync(outDir).filter(name => name.startsWith(STAMP))).toEqual([]);
  });

  it("exits 2 with an unknown-holder message when the holder pid is undiscoverable", async () => {
    const outDir = join(workspace, "run-lock-unknown-holder");
    mkdirSync(outDir, { recursive: true });
    // A fresh self-pid lock (reused pid / in-process concurrency) is refused,
    // but selfPid is never reported as the "other" holder.
    writeFileSync(lockFilePath(outDir, FAKE_PID), "self-fresh\n");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("another backup holds the run lock (unknown holder)"))).toBe(true);
    expect(run.all).not.toContain(`pid ${FAKE_PID}`);
  });

  it("exits 2 when the output directory cannot be created", async () => {
    const blocker = join(workspace, "blocker-file");
    writeFileSync(blocker, "in the way\n");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: goodEnvFile,
      outDir: join(blocker, "backups"),
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("cannot create the output directory"))).toBe(true);
  });

  it("refuses the filesystem root as out-dir with exit 2 and zero side effects", async () => {
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: goodEnvFile,
      outDir: "/",
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("refusing to write backups into the system path /"))).toBe(true);
    // Zero side effects: nothing spawned, no run/staging/lock files written.
    expect(run.calls).toHaveLength(0);
    expect(readdirSync("/").filter(name => name.startsWith(STAGING_DIR_PREFIX) || name.startsWith(".lock-"))).toEqual(
      []
    );
  });

  it("refuses system paths and their descendants as out-dir with exit 2 and zero side effects", async () => {
    const systemOutDirs = ["/etc/kottaby-s5-probe", "/var/run/kottaby-s5-probe"];
    const runs = await Promise.all(
      systemOutDirs.map(systemOutDir =>
        runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
          envFile: goodEnvFile,
          outDir: systemOutDir,
        })
      )
    );
    for (const [index, run] of runs.entries()) {
      const systemOutDir = systemOutDirs[index];
      expect(run.code).toBe(2);
      expect(run.errors.some(line => line.includes("refusing to write backups into the system path"))).toBe(true);
      expect(run.calls).toHaveLength(0);
      expect(existsSync(systemOutDir)).toBe(false);
    }
  });

  it("refuses an out-dir symlinked into a system path after the lexical check passes (exit 2, zero spawns)", async () => {
    const linkPath = join(workspace, "link-to-etc");
    symlinkSync("/etc", linkPath);
    try {
      // `link-to-etc` is lexically innocent; the prepared out-dir only
      // resolves to /etc after mkdir — the REAL path must be what refuses.
      const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
        envFile: goodEnvFile,
        outDir: linkPath,
      });
      expect(run.code).toBe(2);
      expect(run.errors.some(line => line.includes("refusing to write backups into the system path /etc"))).toBe(true);
      expect(run.errors.some(line => line.includes("resolves through a symlink"))).toBe(true);
      expect(run.calls).toHaveLength(0);
      expect(existsSync(join("/etc", `${STAMP}_FAILED`))).toBe(false);
    } finally {
      rmSync(linkPath, { force: true });
    }
  });

  it("accepts an out-dir symlinked to a normal disposable directory (real path is not a system path)", async () => {
    const realDir = join(workspace, "real-out-dir");
    mkdirSync(realDir, { recursive: true });
    const linkPath = join(workspace, "link-to-real-out");
    symlinkSync(realDir, linkPath);
    try {
      const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
        envFile: goodEnvFile,
        outDir: linkPath,
      });
      expect(run.code).toBe(0);
      expect(run.errors.some(line => line.includes("refusing to write backups into the system path"))).toBe(false);
    } finally {
      rmSync(linkPath, { force: true });
    }
  });

  it("exits 2 when the migration journal cannot be fingerprinted", async () => {
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: goodEnvFile,
      outDir: join(workspace, "run-no-journal"),
      repoRoot: join(workspace, "root-without-journal"),
    });
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("cannot fingerprint the migration journal"))).toBe(true);
    expect(existsSync(join(workspace, "run-no-journal", `${STAMP}_FAILED`))).toBe(true);
    expect(lockFileNames(join(workspace, "run-no-journal"))).toEqual([]);
  });

  it("exits 2 when pg_dump is missing from the toolchain", async () => {
    const run = await runBackupWith(
      () => {
        throw new Error("spawn pg_dump ENOENT");
      },
      { envFile: goodEnvFile, outDir: join(workspace, "run-no-toolchain") }
    );
    expect(run.code).toBe(2);
    expect(run.errors.some(line => line.includes("pg_dump was not found on PATH."))).toBe(true);
    expect(run.calls).toHaveLength(1);
  });

  it("exits 1 with an unexpected-failure report when the clock breaks mid-run", async () => {
    const outDir = join(workspace, "run-clock-chaos");
    let ticks = 0;
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), {
      envFile: goodEnvFile,
      outDir,
      now: () => {
        ticks += 1;
        if (ticks === 2) {
          throw new Error("clock exploded");
        }
        return FIXED_NOW;
      },
    });
    expect(run.code).toBe(1);
    expect(
      run.errors.some(line => line.startsWith("[backup] unexpected failure") && line.includes("clock exploded"))
    ).toBe(true);
    expect(existsSync(join(outDir, `${STAMP}_FAILED`))).toBe(true);
    expect(lockFileNames(outDir)).toEqual([]);
  });
});

describe("runBackup — chaos", () => {
  it("retains a _FAILED directory and scrubs stderr when pg_dump dies with 137", async () => {
    const outDir = join(workspace, "run-crash-137");
    const garbageLines = Array.from(
      { length: 35 },
      (_, index) => `pg_dump: garbage line ${String(index + 1).padStart(2, "0")}`
    );
    garbageLines[29] = `pg_dump: error: connection to server failed: ${FIXTURE_DSN}`;
    garbageLines[30] = `FATAL: password authentication failed for user "${FIXTURE_USER}"`;
    garbageLines[31] = `hint: the password ${FIXTURE_PASSWORD} was rejected`;
    const run = await runBackupWith(
      probeAndDumpBehavior(() => ({ exitCode: 137, stdout: "", stderr: garbageLines.join("\n") })),
      {
        envFile: goodEnvFile,
        outDir,
      }
    );
    expect(run.code).toBe(1);
    expect(run.errors.some(line => line.startsWith("[pg_dump]") && line.includes("exited with code 137"))).toBe(true);
    expect(run.all).toContain(REDACTED_FIXTURE);
    expect(run.all).toContain("garbage line 35");
    expect(run.all).not.toContain("garbage line 15");
    expectNoCredentials(run.all);
    const failedDir = join(outDir, `${STAMP}_FAILED`);
    expect(existsSync(failedDir)).toBe(true);
    expect(existsSync(join(failedDir, MANIFEST_FILE_NAME))).toBe(false);
    expect(lockFileNames(outDir)).toEqual([]);
  });

  it("lets exactly one concurrent invocation win and refuses the rest via the lock", async () => {
    const outDir = join(workspace, "run-concurrent");
    const settled = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir })
      )
    );
    for (const result of settled) {
      expect(result.status).toBe("fulfilled");
    }
    const codes = settled
      .map(result => (result.status === "fulfilled" ? result.value.code : -1))
      .toSorted((a, b) => a - b);
    expect(codes).toEqual([0, 2, 2, 2]);
    const losers = settled.flatMap(result =>
      result.status === "fulfilled" && result.value.code === 2 ? [result.value] : []
    );
    expect(losers).toHaveLength(3);
    for (const loser of losers) {
      expect(loser.all).toContain("another backup holds the run lock");
      expectNoCredentials(loser.all);
    }
    expect(readdirSync(outDir).filter(name => name.startsWith(STAMP))).toEqual([STAMP]);
    expect(lockFileNames(outDir)).toEqual([]);
  });

  it("fails in a controlled way when the out-dir is replaced by a file mid-run", async () => {
    const outDir = join(workspace, "run-vaporized");
    const salvagedStaging = join(workspace, "salvaged-staging");
    const behavior: SpawnBehavior = argv => {
      if (argv[0] === "pg_dump" && argv[1] === "--version") {
        return { exitCode: 0, stdout: PG_DUMP_VERSION, stderr: "" };
      }
      if (argv[0] === "psql") {
        return { exitCode: 0, stdout: SERVER_VERSION_OUT, stderr: "" };
      }
      writeFileSync(argv[4], DUMP_CONTENT);
      renameSync(dirname(argv[4]), salvagedStaging);
      rmSync(outDir, { recursive: true, force: true });
      writeFileSync(outDir, "not a directory anymore\n");
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const run = await runBackupWith(behavior, { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(1);
    expect(run.errors.some(line => line.startsWith("[backup]"))).toBe(true);
    expectNoCredentials(run.all);
  });
});

describe("runBackup — security", () => {
  it("leaks no credentials anywhere on the success path", async () => {
    const outDir = join(workspace, "sec-success");
    const run = await runBackupWith(probeAndDumpBehavior(dumpWritesArtifact), { envFile: goodEnvFile, outDir });
    expect(run.code).toBe(0);
    expectNoCredentials(run.all);
    const manifestRaw = readFileSync(join(outDir, STAMP, MANIFEST_FILE_NAME), "utf8");
    expect(manifestRaw).not.toContain(FIXTURE_PASSWORD);
    expect(manifestRaw).not.toContain(FIXTURE_USER);
    expect(manifestRaw).not.toContain(FIXTURE_DSN);
    expect(statSync(join(outDir, STAMP, ARTIFACT_FILE_NAME)).mode & 0o777).toBe(0o600);
    expect(statSync(join(outDir, STAMP, MANIFEST_FILE_NAME)).mode & 0o777).toBe(0o600);
    expect(lockFileNames(outDir)).toEqual([]);
  });

  it("leaks no credentials on the failure path and releases the _FAILED run lock", async () => {
    const outDir = join(workspace, "sec-failure");
    const stderr = `pg_dump: last words: ${FIXTURE_DSN}\npg_dump: password was ${FIXTURE_PASSWORD}\npg_dump: role ${FIXTURE_USER} denied`;
    const run = await runBackupWith(
      probeAndDumpBehavior(() => ({ exitCode: 1, stdout: "", stderr })),
      {
        envFile: goodEnvFile,
        outDir,
      }
    );
    expect(run.code).toBe(1);
    expectNoCredentials(run.all);
    expect(run.all).toContain(REDACTED_FIXTURE);
    expect(run.all).toContain("***");
    expect(existsSync(join(outDir, `${STAMP}_FAILED`))).toBe(true);
    expect(lockFileNames(outDir)).toEqual([]);
  });
});
