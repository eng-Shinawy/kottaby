/**
 * Shared seams, data contracts, and artifact helpers for the restore-verify
 * tool family.
 *
 * Everything here is deliberately infrastructure-only: spawn/psql seams and
 * the clock are injectable so tests can drive the orchestrator without real
 * processes or wall time; DSN redaction keeps credentials out of stdout and
 * persisted artifacts (imported from `_shared`, ONE definition for both the
 * backup and restore families); manifest parsing fails closed on any missing
 * or malformed field so a tampered backup can never reach pg_restore.
 *
 * The manifest data contract, its file name, the artifact hasher, and the
 * migrations-absent sentinel are imported from `backup-artifacts` — the
 * backup family is their single definition owner.
 */

import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { rawUriPathSubstring } from "@/scripts/ops/_shared";
import {
  type BackupManifest,
  MANIFEST_FILE_NAME,
  MIGRATIONS_ABSENT_HASH,
  utcStamp,
} from "@/scripts/ops/backup-artifacts";

export type { BackupManifest };
export { MIGRATIONS_ABSENT_HASH };

/** Restore report file name written into the run directory (0600). */
export const RESTORE_REPORT_FILE = "restore-report.json";

/**
 * Per-run report file name: `restore-report-<UTC start stamp>.json`.
 *
 * The report lives in the RETAINED backup run directory, so a fixed name
 * would collide with the previous run's report on a repeat drill (the
 * writer fails closed, never clobbers). Second resolution keeps the name
 * deterministic; same-second concurrent runs still fail closed via the
 * exclusive create (an operator error the writer must not paper over).
 */
export function restoreReportFileName(startedAt: Date): string {
  return `restore-report-${utcStamp(startedAt)}.json`;
}

/** Tool identifier persisted in restore-report.json. */
export const RESTORE_TOOL_ID = "ops:db-restore-verify";

// ---------------------------------------------------------------------------
// Injectable clock
// ---------------------------------------------------------------------------

/** Monotonic-enough clock seam (`Date.now`-compatible). */
export type Clock = () => Date;

/** Default wall-clock implementation. */
export const systemClock: Clock = () => new Date();

// ---------------------------------------------------------------------------
// Injectable spawn seam
// ---------------------------------------------------------------------------

/** A single child-process request. All spawns use argv arrays — never shell strings. */
export interface SpawnRequest {
  cmd: string;
  args: string[];
  /** Extra env merged over the allowlisted parent environment (explicit passthrough). */
  env?: Record<string, string | undefined>;
}

/** Captured result of one child process. */
export interface SpawnOutcome {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Injectable child-process seam. Deliberately a request-OBJECT seam (not the
 * backup family's `(argv, { env })` shape): every restore call site and test
 * double is built around `SpawnRequest`, and the request carries the merged
 * env per call. Both families share the same INVARIANTS (argv arrays only,
 * piped output, allowlisted child env) rather than the same signature.
 */
export type SpawnRunner = (request: SpawnRequest) => Promise<SpawnOutcome>;

/**
 * Process environment keys forwarded to restore children (psql/pg_restore):
 * PATH/locale plus libpq CREDENTIAL and TRANSPORT variables only.
 *
 * The ENDPOINT-DECIDING libpq variables — PGHOST, PGPORT, PGDATABASE, PGUSER,
 * PGSERVICE, PGSERVICEFILE, PGHOSTADDR — are deliberately NOT forwarded:
 * with an under-specified `--target` DSN the ambient environment would
 * complete the connection endpoint and pg_restore would silently land in an
 * operator-unintended database (live-proven). The restore endpoint is decided
 * by the guard-assessed `--dbname` argv value ALONE. `DATABASE_URL` is also
 * deliberately NOT forwarded — connection config travels in the `--dbname`
 * argv value, and the parent's DATABASE_URL names the SOURCE database, which
 * must never leak into a child that might otherwise connect to the wrong
 * database. (PGAPPNAME stays: it only labels the connection in
 * pg_stat_activity and cannot change the endpoint.)
 */
const RESTORE_CHILD_ENV_KEYS = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "PGPASSWORD",
  "PGPASSFILE",
  "PGSSLMODE",
  "PGSSLROOTCERT",
  "PGCONNECT_TIMEOUT",
  "PGAPPNAME",
] as const;

/**
 * Explicit child environment: an allowlist from `source`, with `extra` (the
 * per-request passthrough) FILTERED THROUGH THE SAME ALLOWLIST — a request
 * cannot smuggle an endpoint-deciding variable (PGDATABASE, PGSERVICE, …)
 * into a restore child; the allowlist wins. Never hands the full parent
 * environment — and with it unrelated secrets — to a child process.
 */
export function buildRestoreChildEnv(
  source: Record<string, string | undefined> = process.env,
  extra: Record<string, string | undefined> = {}
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of RESTORE_CHILD_ENV_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }
  const allowlist: readonly string[] = RESTORE_CHILD_ENV_KEYS;
  for (const [key, value] of Object.entries(extra)) {
    if (value === undefined || !allowlist.includes(key)) {
      continue;
    }
    env[key] = value;
  }
  return env;
}

/** Default spawn implementation: argv-array `Bun.spawn`, piped stdio, allowlisted env. */
export const defaultSpawnRunner: SpawnRunner = async request => {
  const child = Bun.spawn([request.cmd, ...request.args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: buildRestoreChildEnv(process.env, request.env),
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return { exitCode: exitCode ?? -1, stdout, stderr };
};

// ---------------------------------------------------------------------------
// psql seam
// ---------------------------------------------------------------------------

/** Result of one read-only `psql -Atc` query. `ok === false` means the query errored. */
export interface PsqlOutcome {
  ok: boolean;
  /** Trimmed stdout (single value for our queries). */
  value: string;
  stderr: string;
}

/** Injectable read-only psql runner bound to one connection string. */
export type PsqlRunner = (sql: string) => Promise<PsqlOutcome>;

/**
 * psql argv prefix shared by every read-only query (tuples-only, unaligned,
 * fail on error). `VERBOSITY=verbose` puts the SQLSTATE (e.g. `42P01`) into
 * stderr — the restore oracle evaluator gates the migrations-absence ladder
 * on that exact code, so it must be observable on real psql errors.
 */
const PSQL_ARGS = ["--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", "--set=VERBOSITY=verbose"];

/**
 * Builds a psql runner bound to the given connection string. The DSN is
 * forwarded to psql via argv only — never interpolated into SQL text and
 * never printed.
 */
export function makePsqlRunner(spawn: SpawnRunner, dsn: string): PsqlRunner {
  return async sql => {
    const outcome = await spawn({
      cmd: "psql",
      args: [...PSQL_ARGS, "--dbname", dsn, "--command", sql],
    });
    return { ok: outcome.exitCode === 0, value: outcome.stdout.trim(), stderr: outcome.stderr };
  };
}

// ---------------------------------------------------------------------------
// Credential redaction
// ---------------------------------------------------------------------------

/**
 * Last-occurrence, percent-decoded value of one query parameter in a RAW
 * URI query string (libpq semantics: `+` stays literal, last occurrence
 * wins). A malformed percent-escape yields undefined — the restore guard
 * refuses such targets outright, so there is no meaningful value to report.
 */
function lastUriQueryValue(rawSearch: string, name: string): string | undefined {
  let value: string | undefined;
  for (const pair of rawSearch.replace(/^\?/, "").split("&")) {
    // An empty pair has no "=" either, so one guard covers both skips.
    const equals = pair.indexOf("=");
    if (equals < 0) {
      continue;
    }
    try {
      if (decodeURIComponent(pair.slice(0, equals)).toLowerCase() === name) {
        value = decodeURIComponent(pair.slice(equals + 1));
      }
    } catch {
      return undefined;
    }
  }
  return value;
}

/**
 * Redacted target identifier for reports: the database name ONLY — host,
 * user, and password never leave the process. URI-form targets report the
 * EFFECTIVE database: a query `dbname=` parameter is libpq's override
 * channel (it names the database the connection actually uses — the restore
 * guard refuses a path/query disagreement before any run), so it wins over
 * the path component. The path component is derived from the RAW path
 * substring (libpq's literal view) — the WHATWG pathname would have
 * normalized `.`/`..` dot-segments away and mislabeled the database libpq
 * restores into (the guard refuses such paths before any run, and the label
 * stays literal here so a raw-path report can never diverge from libpq).
 * The raw substring's one truncation short of libpq is a raw `#`: libpq has
 * no fragment delimiter and reads THROUGH it (part of the literal database
 * name) while this label — like every WHATWG-derived view — ends at the
 * `#`; the restore guard refuses raw-fragment paths upstream before any
 * run (fail closed), so a report label can never diverge from the database
 * libpq actually restored into. Conninfo-form targets follow libpq
 * semantics: the LAST `dbname=` occurrence wins, one layer of surrounding
 * single/double quotes is stripped (inner spaces are part of the name libpq
 * connects to), and libpq's escape folding inside QUOTED values is applied
 * so the label is the libpq-effective name: single-quoted values fold `''`
 * → `'` first and then every `\<char>` → `<char>` (`dbname='a\b'` reports
 * `ab`, `dbname='a\\b'` reports `a\b`, and the backslash-quote form
 * `dbname='a\'b'` keeps the quote in the scanned span and reports `a'b`);
 * double-quoted values fold `\<char>` → `<char>` only (`dbname="a\b"`
 * reports `ab`, `dbname="a\"b"` reports `a"b`). Unquoted values fold
 * `\<char>` → `<char>` as well — libpq's unquoted scan consumes the
 * backslash together with the character it escapes (live-proven:
 * `dbname=r14\db` connects as `r14db`), and an escaped WHITESPACE both
 * folds to that whitespace and extends the value across it instead of
 * ending it (live-proven: `dbname=r14\ db` connects as `r14 db`), so the
 * span keeps scanning into what follows up to the next UNESCAPED
 * whitespace. A backslash at end-of-input has nothing to escape and
 * libpq's scan drops it (`dbname=r14\` connects as `r14`), so the
 * captured span never ends in a bare backslash.
 */
export function redactTargetDatabaseName(dsn: string): string {
  try {
    const parsed = new URL(dsn);
    const queryDatabase = lastUriQueryValue(parsed.search, "dbname");
    if (queryDatabase !== undefined && queryDatabase.length > 0) {
      return queryDatabase;
    }
    const database = decodeURIComponent(rawUriPathSubstring(dsn).replace(/^\//, ""));
    if (database.length > 0) {
      return database;
    }
  } catch {
    // Not a URL — fall through to keyword/value conninfo form.
  }

  let reported: string | null = null;
  // The quoted-value spans tolerate a backslash-escaped quote (`\'` / `\"`)
  // the way libpq scans them — such a quote does NOT end the value — and the
  // alternatives are disjoint on their first character, so each span scan
  // stays linear (no backtracking blow-up on hostile input). The unquoted
  // span is linear the same way: a backslash enters it only through the
  // two-character escape alternative (`\` + any non-newline character,
  // whitespace included — the escaped-whitespace extension rule), plain
  // characters exclude backslash and whitespace, so a bare trailing
  // backslash matches neither alternative (libpq's scan drops it) and every
  // backslash inside the span is the head of an escape pair. The two scans
  // are merged into libpq's single leftmost, non-overlapping keyword walk:
  // candidates are consumed in offset order, a candidate starting inside the
  // previously consumed span is dropped, and at a shared offset the quoted
  // form wins — a quote also starts an unquoted span, so every quoted match
  // has an unquoted twin at the same offset, and the stable sort keeps the
  // quoted candidate first.
  const dbnameMatches = [
    ...dsn.matchAll(/\bdbname=(?:"(?<double>(?:\\.|[^"\\])*)"|'(?<single>(?:\\.|[^'\\]|'')*)')/gi),
    ...dsn.matchAll(/\bdbname=(?<unquoted>(?:\\.|[^\s\\])+)/gi),
  ].toSorted((a, b) => (a.index ?? 0) - (b.index ?? 0));
  let scannedTo = 0;
  for (const match of dbnameMatches) {
    const start = match.index ?? 0;
    if (start < scannedTo) {
      continue;
    }
    scannedTo = start + match[0].length;
    const singleQuoted = match.groups?.single;
    // Runtime group values are undefined when the group did not participate,
    // so the guard is a typeof check, not a `!==` comparison.
    if (typeof singleQuoted === "string") {
      // libpq folds `''` → `'` first, then every `\<char>` → `<char>`
      // (order-insensitive on every input the span scan can produce).
      reported = singleQuoted.replace(/''/g, "'").replace(/\\(.)/g, "$1");
    } else {
      const doubleQuoted = match.groups?.double;
      // Double-quoted folds backslash escapes only. The unquoted span folds
      // them too — every backslash inside it is the head of the escape pair
      // libpq's scan consumed, escaped whitespace included, so the fold is
      // the exact inverse of the span rule and a bare trailing backslash
      // cannot occur inside the span.
      reported =
        typeof doubleQuoted === "string"
          ? doubleQuoted.replace(/\\(.)/g, "$1")
          : (match.groups?.unquoted ?? "").replace(/\\(.)/g, "$1");
    }
  }
  if (reported !== null && reported.length > 0) {
    return reported;
  }

  return "unknown";
}

// ---------------------------------------------------------------------------
// Manifest parsing (fail closed)
// ---------------------------------------------------------------------------

/** Thrown when the backup artifact or its manifest cannot be trusted (exit 1). */
export class RestoreArtifactError extends Error {}

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

function requireNonEmptyString(record: Map<string, unknown>, field: string): string {
  const value = record.get(field);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RestoreArtifactError(`manifest field "${field}" is missing or empty`);
  }
  return value;
}

/**
 * Parses and validates a manifest JSON document. Every field must be
 * present and well-formed (all fields non-empty, `artifactBytes > 0`,
 * `sha256`/`journalHash` 64-hex lower-case — the journalHash sentinel
 * {@link MIGRATIONS_ABSENT_HASH} satisfies that shape) — a manifest missing
 * any key fails closed.
 *
 * `artifactFile` must additionally be a BARE file name: the manifest is
 * attacker-movable data, so a value carrying `/`, `\`, or `..` (any path
 * traversal out of the run directory) is a tamper signal and fails closed.
 */
export function parseBackupManifest(raw: string): BackupManifest {
  let source: unknown;
  try {
    source = JSON.parse(raw);
  } catch {
    throw new RestoreArtifactError("manifest.json is not valid JSON");
  }

  if (typeof source !== "object" || source === null || Array.isArray(source)) {
    throw new RestoreArtifactError("manifest.json is not a JSON object");
  }

  const record = new Map<string, unknown>(Object.entries(source));
  const tool = requireNonEmptyString(record, "tool");
  if (tool !== "ops:db-backup") {
    throw new RestoreArtifactError(`manifest tool "${tool}" is not a database backup manifest`);
  }

  const sha256 = requireNonEmptyString(record, "sha256");
  if (!HEX_64_PATTERN.test(sha256)) {
    throw new RestoreArtifactError('manifest field "sha256" is not lower-case 64-hex');
  }

  const journalHash = requireNonEmptyString(record, "journalHash");
  if (!HEX_64_PATTERN.test(journalHash)) {
    throw new RestoreArtifactError('manifest field "journalHash" is not lower-case 64-hex');
  }

  const artifactBytes = record.get("artifactBytes");
  if (typeof artifactBytes !== "number" || !Number.isInteger(artifactBytes) || artifactBytes <= 0) {
    throw new RestoreArtifactError('manifest field "artifactBytes" must be a positive integer');
  }

  const artifactFile = requireNonEmptyString(record, "artifactFile");
  if (artifactFile.includes("/") || artifactFile.includes("\\") || artifactFile.includes("..")) {
    throw new RestoreArtifactError(
      'manifest field "artifactFile" must be a bare file name (no path separators or "..") — refusing tampered manifest'
    );
  }

  return {
    tool: "ops:db-backup",
    toolVersion: requireNonEmptyString(record, "toolVersion"),
    postgresServerVersion: requireNonEmptyString(record, "postgresServerVersion"),
    pgDumpVersion: requireNonEmptyString(record, "pgDumpVersion"),
    database: requireNonEmptyString(record, "database"),
    startedAtUtc: requireNonEmptyString(record, "startedAtUtc"),
    finishedAtUtc: requireNonEmptyString(record, "finishedAtUtc"),
    artifactFile,
    artifactBytes,
    sha256,
    journalHash,
  };
}

// ---------------------------------------------------------------------------
// Artifact resolution
// ---------------------------------------------------------------------------

/** A located backup artifact plus its validated manifest. */
export interface ResolvedArtifact {
  runDir: string;
  manifestPath: string;
  artifactPath: string;
  manifest: BackupManifest;
  /** Actual byte size of the resolved artifact (cross-checked by the caller). */
  artifactSize: number;
}

/**
 * Resolves `--from` into (run directory, artifact, manifest).
 *
 * Accepts either a backup run directory (manifest.json + dump inside) or a
 * direct dump artifact whose manifest.json sits beside it. Any missing or
 * unreadable piece throws {@link RestoreArtifactError} so the caller refuses
 * the restore before spawning pg_restore.
 *
 * The manifest's `artifactFile` is validated as a bare file name at parse
 * time (no separators, no `..`), and — for the run-directory form — the
 * resolved artifact is additionally realpath-checked to live INSIDE the
 * resolved `--from` directory, so a symlinked entry cannot steer the restore
 * outside the operator-chosen directory.
 */
export function resolveRunArtifact(fromPath: string): ResolvedArtifact {
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(fromPath);
  } catch {
    throw new RestoreArtifactError(`--from path does not exist or is unreadable: ${fromPath}`);
  }

  const isRunDir = stats.isDirectory();
  const manifestPath = isRunDir ? join(fromPath, MANIFEST_FILE_NAME) : join(fromPath, "..", MANIFEST_FILE_NAME);

  let rawManifest: string;
  try {
    rawManifest = readFileSync(manifestPath, "utf8");
  } catch {
    throw new RestoreArtifactError(`manifest not found or unreadable next to the artifact (expected ${manifestPath})`);
  }

  const manifest = parseBackupManifest(rawManifest);

  const artifactPath = isRunDir ? join(fromPath, manifest.artifactFile) : fromPath;
  let artifactStats: ReturnType<typeof statSync>;
  try {
    artifactStats = statSync(artifactPath);
    if (!artifactStats.isFile()) {
      throw new RestoreArtifactError(`artifact is not a regular file: ${artifactPath}`);
    }
  } catch (error) {
    if (error instanceof RestoreArtifactError) {
      throw error;
    }
    throw new RestoreArtifactError(`backup artifact does not exist or is unreadable: ${artifactPath}`);
  }

  if (isRunDir) {
    // Realpath containment: the artifact must resolve INSIDE the resolved
    // run directory. A bare artifactFile name cannot traverse on its own;
    // this closes the symlink-escape variant.
    try {
      const runDirReal = realpathSync(fromPath);
      const artifactReal = realpathSync(artifactPath);
      if (artifactReal !== runDirReal && !artifactReal.startsWith(`${runDirReal}${sep}`)) {
        throw new RestoreArtifactError(
          `backup artifact resolves outside the --from directory: ${artifactReal} — refusing tampered run`
        );
      }
    } catch (error) {
      if (error instanceof RestoreArtifactError) {
        throw error;
      }
      throw new RestoreArtifactError(`backup artifact path could not be resolved — refusing tampered run`);
    }
  }

  return {
    runDir: isRunDir ? fromPath : join(fromPath, ".."),
    manifestPath,
    artifactPath,
    manifest,
    artifactSize: artifactStats.size,
  };
}

// ---------------------------------------------------------------------------
// Expected-table derivation
// ---------------------------------------------------------------------------

/**
 * Derives the expected physical table names from the Drizzle schema source.
 *
 * DERIVATION NOTE: the table list is scanned from the `pgTable("<name>", ...)`
 * first arguments in the TypeScript files under `backend/db/schema/` (any
 * depth) at runtime — the first argument IS the physical database table name.
 * A hardcoded copy of the list would go stale the moment a table is added or
 * renamed and would then silently PASS a truncated restore that is missing
 * that table; deriving from source keeps the structural contract in lockstep
 * with the schema.
 */
export function deriveExpectedTableNames(schemaDir: string): string[] {
  const tableNames = new Set<string>();
  const pgTableNamePattern = /pgTable\(\s*["']([A-Za-z_]\w*)["']/g;

  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) {
        continue;
      }
      const contents = readFileSync(entryPath, "utf8");
      for (const match of contents.matchAll(pgTableNamePattern)) {
        const tableName = match[1];
        if (tableName) {
          tableNames.add(tableName);
        }
      }
    }
  };

  try {
    visit(schemaDir);
  } catch {
    throw new RestoreArtifactError(`schema directory not found or unreadable: ${schemaDir}`);
  }

  if (tableNames.size === 0) {
    throw new RestoreArtifactError(`no pgTable definitions found under ${schemaDir}`);
  }

  return [...tableNames].toSorted((a, b) => a.localeCompare(b));
}
