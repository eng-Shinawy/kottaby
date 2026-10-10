/**
 * Shared plumbing for the launch probe CLIs (`probe-decisions.ts`,
 * `probe-constraints.ts`, `secrets-scan.ts`, `verify-cron.ts`).
 *
 * Every probe is a read-only, one-shot stage tool the launch gate spawns
 * through the row registry's canonical command. A probe takes no process
 * lock (the gate already serializes stage execution) and performs zero
 * writes — no database writes, no filesystem writes, no cache writes. Its
 * entire output contract is one `ProbeLine` JSON record per stdout line
 * plus the process exit status: exit 0 iff every emitted line is PASS,
 * non-zero the moment any line FAILs. A probe never silently skips a
 * check — an unreachable dependency (database, route, target file) is
 * emitted as a named FAIL line of its own.
 *
 * The database-backed probes share this module's CLI runner so the
 * command-line surface (usage handling, handle opening, error containment,
 * line emission, exit codes) is single-sourced; each probe file owns only
 * its mapped-row inventory and its catalog assertions.
 */

import { type SQLWrapper, sql } from "drizzle-orm";
import { logger } from "@/backend/lib/logger";
import { applyEnvFile } from "@/scripts/dbActions/envFile";
import { LAUNCH_CHECKLIST } from "@/scripts/launch/launch-checklist";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import { scrubDsnSecrets } from "@/scripts/ops/_shared";
import { errorMessage } from "@/scripts/ops/backup-toolchain";

// ─── Mapped-Row Inventory ─────────────────────────────────────────────────────

/**
 * The read-only catalog-query surface the database-backed probes consume.
 * The shared client's database handle satisfies this structurally (its
 * `execute` returns a promise-like query result); narrowing the seam to
 * the one method the probes need keeps the probes decoupled from the full
 * ORM surface and lets a plain object stub it with no type casts.
 */
export interface ProbeDb {
  /** Runs one read-only statement and resolves its result rows. */
  execute(query: SQLWrapper | string): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * The checklist rows a probe command proves — derived from the row
 * registry (the single source of truth), so a registry edit re-maps the
 * probe's line inventory automatically.
 */
export function rowIdsForCommand(command: string): readonly string[] {
  return LAUNCH_CHECKLIST.filter(row => row.command === command).map(row => row.rowId);
}

// ─── Arg Parsing ──────────────────────────────────────────────────────────────

/** Which argv tokens one probe CLI accepts. */
export interface ProbeArgSpec {
  /** Long flags that consume the next token as their value (e.g. `--url`). */
  readonly valueFlags?: readonly string[];
  /** Whether bare tokens are collected as positionals (e.g. scan targets). */
  readonly allowPositionals?: boolean;
}

/** One probe CLI's parsed argv. */
export interface ParsedProbeArgs {
  /** `--help` / `-h` was requested. */
  readonly help: boolean;
  /** Values collected for the spec's `valueFlags`, keyed by flag name without `--`. */
  readonly values: Readonly<Partial<Record<string, string>>>;
  /** Bare tokens collected when the spec allows positionals. */
  readonly positionals: readonly string[];
  /** Unrecognized flags (and bare tokens when positionals are not allowed) — a usage error. */
  readonly rejected: readonly string[];
  /** The first value flag whose argument token is missing, if any — a usage error. */
  readonly missingValueFor: string | null;
}

/**
 * Parses probe CLI args — the tokens after the interpreter and script path
 * (callers pass `process.argv.slice(2)` or a synthetic args array).
 */
export function parseProbeArgs(args: readonly string[], spec: ProbeArgSpec = {}): ParsedProbeArgs {
  const valueFlags = spec.valueFlags ?? [];
  const values: Partial<Record<string, string>> = {};
  const positionals: string[] = [];
  const rejected: string[] = [];
  let missingValueFor: string | null = null;

  let index = 0;
  while (index < args.length) {
    const token = args[index];
    if (token === "--help" || token === "-h") {
      index += 1;
    } else if (token.startsWith("--")) {
      if (valueFlags.includes(token)) {
        const valueToken = index + 1 < args.length ? args[index + 1] : undefined;
        if (valueToken === undefined || valueToken.startsWith("--")) {
          missingValueFor ??= token;
        } else {
          values[token.slice(2)] = valueToken;
          index += 1;
        }
        index += 1;
      } else {
        rejected.push(token);
        index += 1;
      }
    } else if (spec.allowPositionals) {
      positionals.push(token);
      index += 1;
    } else {
      rejected.push(token);
      index += 1;
    }
  }
  return { help: args.includes("--help") || args.includes("-h"), values, positionals, rejected, missingValueFor };
}

// ─── Usage Handling & Line Emission ──────────────────────────────────────────

/**
 * The shared probe usage surface: `--help` prints usage (exit 0); unknown
 * or incomplete arguments print a usage error to stderr (exit 1). Returns
 * null when the run should continue past argv.
 */
export function handleProbeUsage(
  probeName: string,
  usage: string,
  parsed: ParsedProbeArgs,
  stdout: (line: string) => void,
  stderr: (line: string) => void
): number | null {
  if (parsed.help) {
    stdout(usage);
    return 0;
  }
  const rejected = [...parsed.rejected, ...(parsed.missingValueFor === null ? [] : [parsed.missingValueFor])];
  if (rejected.length > 0) {
    stderr(`${probeName}: unknown argument(s): ${rejected.join(", ")}`);
    stderr(usage);
    return 1;
  }
  return null;
}

/**
 * Emits one `ProbeLine` JSON record per stdout line (the ops
 * stdout-line-as-record pattern) plus the probe's closing summary, and
 * logs the outcome through the structured logger. Returns the probe's
 * process exit status: 0 iff every line is PASS.
 */
export function emitProbeLines(
  probeName: string,
  lines: readonly ProbeLine[],
  stdout: (line: string) => void = console.log
): number {
  for (const line of lines) stdout(JSON.stringify(line));
  const failed = lines.filter(line => line.result === "FAIL").length;
  stdout(`${probeName}: ${lines.length} line(s) — ${lines.length - failed} PASS, ${failed} FAIL`);
  if (failed > 0) {
    logger.error(`${probeName} completed with FAIL lines`, { failed, total: lines.length });
  } else {
    logger.info(`${probeName} completed clean`, { total: lines.length });
  }
  return failed > 0 ? 1 : 0;
}

// ─── Database-Probe Plumbing ──────────────────────────────────────────────────

/**
 * The connection probe every database-backed probe run starts with: a
 * single liveness statement through the shared client (read-only). A
 * connection failure is returned as a named FAIL line — never a silent
 * skip — and the mapped-row checks are not run; the caller exits non-zero
 * on it. Error text is scrubbed of any credential material before it can
 * reach a line.
 */
export async function probeDbConnection(db: ProbeDb, connectionRowId: string): Promise<ProbeLine> {
  try {
    await db.execute(sql`select 1`);
    return { rowId: connectionRowId, result: "PASS", detail: "database connection established (read-only handle)" };
  } catch (error) {
    const detail = `database connection error: ${scrubDsnSecrets(errorMessage(error))}`;
    logger.error(`probe connection failed (${connectionRowId})`, { detail });
    return { rowId: connectionRowId, result: "FAIL", detail };
  }
}

/** Configuration one database-backed probe CLI hands to the shared runner. */
export interface DbProbeCliConfig {
  /** Probe name used in the summary line, usage errors, and diagnostics. */
  readonly probeName: string;
  /** Usage text printed for `--help` and usage errors. */
  readonly usage: string;
  /** rowId for the connection line and for environment/open failures (a named FAIL, never a crash). */
  readonly connectionRowId: string;
  /** The probe's row-inventory check — run with an open, read-only handle. */
  readonly runProbe: (db: ProbeDb) => Promise<readonly ProbeLine[]>;
}

/** Injectable seams for the database-probe CLI runner (tests stub the handle and the stdout sink). */
export interface DbProbeCliOptions {
  /** Pre-opened database handle — when omitted the shared client is opened from the repo `.env`. */
  readonly db?: ProbeDb;
  /** Line sink (defaults to console.log). */
  readonly stdout?: (line: string) => void;
}

/**
 * The shared database-probe CLI body: usage handling, handle opening,
 * error containment, `ProbeLine` emission, exit status. The handle is
 * opened from the repo `.env` through the existing shared client
 * (`applyEnvFile` + `@/backend/db` — the established probe precedent) and
 * always closed on the way out; an injected handle is never closed here.
 * Environment or client-open failures are contained into the named
 * connection FAIL line — a probe never crashes without leaving a record.
 */
export async function runDbProbeCli(
  config: DbProbeCliConfig,
  args: readonly string[],
  options: DbProbeCliOptions = {}
): Promise<number> {
  const stdout = options.stdout ?? console.log;
  const usageExit = handleProbeUsage(config.probeName, config.usage, parseProbeArgs(args), stdout, console.error);
  if (usageExit !== null) return usageExit;

  let db: ProbeDb;
  let close: (() => Promise<void>) | null = null;
  const lines: ProbeLine[] = [];
  try {
    if (options.db === undefined) {
      applyEnvFile(".env");
      const client = await import("@/backend/db");
      db = client.db;
      close = () => client.closePool();
    } else {
      db = options.db;
    }
    lines.push(...(await config.runProbe(db)));
  } catch (error) {
    const detail = `probe harness error: ${scrubDsnSecrets(errorMessage(error))}`;
    logger.error(`${config.probeName} harness error`, { detail });
    lines.push({ rowId: config.connectionRowId, result: "FAIL", detail });
  } finally {
    await close?.();
  }
  return emitProbeLines(config.probeName, lines, stdout);
}
