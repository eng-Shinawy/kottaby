/**
 * Structural verification + report contract for the restore-verify tool.
 *
 * After pg_restore completes, every table expected from the schema source
 * must be present, the critical set gets individual row counts (a critical
 * table that was non-empty at the source but restored to 0 rows fails), and
 * the aggregated verdict feeds restore-report.json.
 */

import { chmodSync, closeSync, lstatSync, mkdirSync, openSync, writeSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";

import { scrubDsnSecrets } from "@/scripts/ops/_shared";
import type { OracleResult } from "@/scripts/ops/restore-oracles";
import { type PsqlRunner, RESTORE_REPORT_FILE, type RESTORE_TOOL_ID } from "@/scripts/ops/restore-shared";

/** Tables whose row counts are proven individually after the restore (the financial and governance critical set). */
export const CRITICAL_TABLES = [
  "users",
  "wallet",
  "teacher_transaction",
  "session",
  "session_request_idempotency",
  "audit_logs",
  "notifications",
  "parent_link_requests",
] as const;

/** One structural verification row (persisted in restore-report.json). */
export interface StructuralCheckRow {
  table: string;
  present: boolean;
  /** Restored row count; -1 when not counted (non-critical table) or the count errored. */
  rowCount: number;
  /** True when the source database was reachable and held >0 rows for this table. */
  sourceNonEmpty: boolean;
  ok: boolean;
}

/** Full restore-verify report contract (persisted as restore-report.json). */
export interface RestoreReport {
  tool: typeof RESTORE_TOOL_ID;
  artifactFile: string;
  artifactSha256: string;
  target: { database: string };
  startedAtUtc: string;
  durationMs: number;
  structural: StructuralCheckRow[];
  oracles: OracleResult[];
  verdict: "PASS" | "FAIL";
}

/** Thrown when verification cannot proceed far enough to produce a report. */
export class RestoreVerificationError extends Error {}

const IDENTIFIER_PATTERN = /^[A-Za-z_]\w*$/;
const COUNT_OUTPUT_PATTERN = /^\d+$/;

/** Quote a table identifier for interpolation into a structural-count query. */
function quoteIdentifier(name: string): string {
  if (!IDENTIFIER_PATTERN.test(name)) {
    throw new RestoreVerificationError(`unexpected table identifier from schema scan: ${name}`);
  }
  return `"${name}"`;
}

function parseCount(outcome: PsqlOutcomeLike): number | null {
  return outcome.ok && COUNT_OUTPUT_PATTERN.test(outcome.value) ? Number.parseInt(outcome.value, 10) : null;
}

/** Minimal structural shape shared by psql outcomes (keeps this module decoupled). */
interface PsqlOutcomeLike {
  ok: boolean;
  value: string;
}

async function checkTable(
  table: string,
  presentTables: Set<string>,
  targetPsql: PsqlRunner,
  sourcePsql: PsqlRunner | null,
  warn: (line: string) => void
): Promise<StructuralCheckRow> {
  const present = presentTables.has(table);
  const isCritical = (CRITICAL_TABLES as readonly string[]).includes(table);
  if (!isCritical) {
    return { table, present, rowCount: -1, sourceNonEmpty: false, ok: present };
  }

  const countSql = `SELECT COUNT(*) FROM ${quoteIdentifier(table)}`;
  // Source-side probe is BOUNDED (LIMIT 1 subquery): `sourcePsql` names the
  // LIVE source database, and an exact COUNT(*) there is a full table scan —
  // 8 critical tables through Promise.all would fire 8 concurrent scans on
  // production. The source comparison only consumes "any rows?" (see
  // `sourceNonEmpty` below), so a 0/1 probe preserves the semantics exactly.
  const sourceProbeSql = `SELECT COUNT(*) FROM (SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1) probe`;
  const [targetCount, sourceCount] = await Promise.all([
    targetPsql(countSql),
    sourcePsql !== null ? sourcePsql(sourceProbeSql) : Promise.resolve(null),
  ]);

  const targetRows = parseCount(targetCount);
  const rowCount = targetRows ?? -1;

  // FAIL CLOSED: an unverifiable count on a PRESENT critical table must fail
  // the row (and the verdict) — "could not count" is never "zero problems".
  // The error detail is recorded on the report's stderr/log channel; the
  // StructuralCheckRow contract keeps its {table, present, rowCount,
  // sourceNonEmpty, ok} shape (rowCount: -1 marks the unverifiable count).
  if (targetRows === null && present) {
    const detail = scrubDsnSecrets(targetCount.stderr).trim() || "(no stderr captured)";
    warn(`[verify] row count query failed for "${table}" (count unverifiable): ${detail}`);
  }

  let sourceNonEmpty = false;
  if (sourceCount !== null) {
    const sourceRows = parseCount(sourceCount);
    if (sourceRows === null) {
      warn(
        `[verify] could not read source row count for "${table}" (source comparison skipped): ${scrubDsnSecrets(sourceCount.stderr).trim()}`
      );
    } else {
      sourceNonEmpty = sourceRows > 0;
    }
  }

  return {
    table,
    present,
    rowCount,
    sourceNonEmpty,
    ok: present && rowCount >= 0 && (rowCount > 0 || !sourceNonEmpty),
  };
}

/**
 * Structural verification: presence for every schema-derived table, plus
 * individual row counts for the critical set; a critical table that was
 * non-empty at the source but restored to 0 rows fails its row.
 */
export async function runStructuralChecks(
  targetPsql: PsqlRunner,
  sourcePsql: PsqlRunner | null,
  expectedTables: string[],
  warn: (line: string) => void
): Promise<StructuralCheckRow[]> {
  const presenceOutcome = await targetPsql("SELECT tablename FROM pg_tables WHERE schemaname = 'public'");
  if (!presenceOutcome.ok) {
    throw new RestoreVerificationError(
      `could not list restored tables via psql: ${scrubDsnSecrets(presenceOutcome.stderr).trim()}`
    );
  }
  const presentTables = new Set(
    presenceOutcome.value
      .split("\n")
      .map(name => name.trim())
      .filter(Boolean)
  );

  const rows = await Promise.all(
    expectedTables.map(table => checkTable(table, presentTables, targetPsql, sourcePsql, warn))
  );

  for (const row of rows) {
    if (!(CRITICAL_TABLES as readonly string[]).includes(row.table)) {
      continue;
    }
    if (!row.present) {
      warn(`[verify] missing table "${row.table}" after restore`);
    } else if (row.sourceNonEmpty && row.rowCount === 0) {
      warn(`[verify] critical table "${row.table}" restored to 0 rows (source held data)`);
    } else if (row.rowCount === -1) {
      warn(`[verify] row count unavailable for critical table "${row.table}"`);
    }
  }

  return rows;
}

/**
 * Verdict aggregation: PASS requires every structural row ok, every oracle
 * passed, and the artifact hash to match the manifest.
 */
export function evaluateVerdict(
  structural: StructuralCheckRow[],
  oracles: { passed: boolean }[],
  hashesMatch: boolean
): "PASS" | "FAIL" {
  const structuralOk = structural.every(row => row.ok);
  const oraclesOk = oracles.every(oracle => oracle.passed);
  return structuralOk && oraclesOk && hashesMatch ? "PASS" : "FAIL";
}

/**
 * Serializes and persists the restore report (0600) into the run directory.
 *
 * `fileName` defaults to the base `restore-report.json`; the orchestrator
 * passes a UNIQUE per-run name (`restoreReportFileName(startedAt)`) because
 * the run directory is retained — a repeat drill against the same artifact
 * must never collide with (or overwrite) a previous run's report.
 */
export function writeRestoreReport(
  runDir: string,
  report: RestoreReport,
  writeReportFile: (path: string, contents: string) => void,
  fileName: string = RESTORE_REPORT_FILE
): string {
  const reportPath = isAbsolute(runDir) ? join(runDir, fileName) : resolve(join(runDir, fileName));
  writeReportFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  return reportPath;
}

/**
 * Default report writer: parent dirs as needed, file created EXCLUSIVELY
 * (`wx` = O_CREAT|O_EXCL) and forced to 0600.
 *
 * The report path lives in the run directory the restore owns, so ABSENCE is
 * the expected state; the CALLER supplies a unique per-run file name (see
 * `writeRestoreReport` / `restoreReportFileName`). A pre-existing entry of
 * ANY kind — regular file, hard link, symlink (dangling or not), or
 * directory — refuses the run: the write would otherwise follow a pre-placed
 * link and clobber its target outside the run directory (live-probe failure
 * mode). The lstat gate produces the precise [verify] error; the `wx` create
 * is the atomic backstop — O_EXCL never follows a symlink and fails if any
 * entry appears between the check and the create (TOCTOU-safe).
 */
export function defaultReportFileWriter(path: string, contents: string): void {
  let prePlaced = false;
  try {
    lstatSync(path);
    prePlaced = true;
  } catch {
    // absent — the expected state for a fresh restore run
  }
  if (prePlaced) {
    throw new RestoreVerificationError(
      `restore report path already exists — refusing to overwrite a pre-placed file/link (report clobber guard): ${path}`
    );
  }
  mkdirSync(resolve(path, ".."), { recursive: true });
  const fd = openSync(path, "wx", 0o600);
  try {
    writeSync(fd, contents);
  } finally {
    closeSync(fd);
  }
  chmodSync(path, 0o600);
}

/** Basename helper re-exported so the entry does not need node:path for reports. */
export const reportArtifactFile = (artifactPath: string): string => basename(artifactPath);
