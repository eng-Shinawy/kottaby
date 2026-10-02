#!/usr/bin/env bun
/**
 * Restore a verified database backup into an explicit scratch/staging
 * Postgres target and prove post-restore integrity.
 *
 * Pipeline: parse args → load env (source context) → safety-gate the target
 * DSN → locate artifact + re-verify SHA-256 against the manifest → pg_restore
 * → structural checks (tables derived from schema source; critical-table row
 * counts; migrations-hash correspondence) → read-only invariant oracles →
 * restore-report.json (0600) → VERDICT.
 *
 * SCRATCH-TARGET ASSUMPTION: the restore runs `pg_restore --clean
 * --if-exists --no-owner --no-privileges`, which DROPS and recreates public
 * objects in the target. The target must therefore be a disposable scratch or
 * staging database — never a live production instance. The target DSN is
 * parsed once, guard-assessed, and threaded as a single variable to the
 * pg_restore spawn; there is no default and no re-parse (TOCTOU-safe).
 *
 * Usage:
 *   bun run scripts/ops/restore-verify.ts --from <runDir|dump.pgc> --target <dsn> --yes-i-understand [--env <file>]
 *
 * Exit codes:
 *   0  VERDICT: PASS
 *   1  VERDICT: FAIL, restore failure, or artifact verification failure
 *   2  usage error, env bootstrap error, or safety-guard refusal
 */

import { join, resolve } from "node:path";

import { applyEnvFile, isValidDatabaseUrl } from "@/scripts/dbActions/envFile";
import { resolveEnvFilePath, scrubDsnSecrets } from "@/scripts/ops/_shared";
import { sha256File } from "@/scripts/ops/backup-artifacts";
import {
  parseRestoreArgs,
  RESTORE_USAGE_TEXT,
  type RestoreCliArgs,
  RestoreUsageError,
} from "@/scripts/ops/restore-cli";
import {
  assertRestoreConfirmation,
  assessRestoreTargetSafety,
  formatRestoreGuardBlockMessage,
} from "@/scripts/ops/restore-guard";
import { ORACLE_ERROR_OFFENDING_COUNT, type OracleResult, runOracles } from "@/scripts/ops/restore-oracles";
import {
  type BackupManifest,
  type Clock,
  defaultSpawnRunner,
  deriveExpectedTableNames,
  makePsqlRunner,
  type PsqlRunner,
  RESTORE_TOOL_ID,
  RestoreArtifactError,
  redactTargetDatabaseName,
  resolveRunArtifact,
  restoreReportFileName,
  type SpawnRunner,
  systemClock,
} from "@/scripts/ops/restore-shared";
import {
  CRITICAL_TABLES,
  defaultReportFileWriter,
  evaluateVerdict,
  type RestoreReport,
  RestoreVerificationError,
  reportArtifactFile,
  runStructuralChecks,
  type StructuralCheckRow,
  writeRestoreReport,
} from "@/scripts/ops/restore-structure";

type LineWriter = (line: string) => void;

/** Dependency seams for the orchestrator (all optional — production defaults). */
export interface RestoreVerifyDeps {
  spawnRunner?: SpawnRunner;
  clock?: Clock;
  stdout?: LineWriter;
  stderr?: LineWriter;
  /** Repository root used to locate backend/db/schema. */
  repoRoot?: string;
  /** Report writer seam (defaults to writeFileSync + chmod 0600). */
  writeReportFile?: (path: string, contents: string) => void;
}

interface ResolvedDeps {
  spawnRunner: SpawnRunner;
  clock: Clock;
  stdout: LineWriter;
  stderr: LineWriter;
  repoRoot: string;
  writeReportFile: (path: string, contents: string) => void;
}

function resolveDeps(deps: RestoreVerifyDeps): ResolvedDeps {
  return {
    spawnRunner: deps.spawnRunner ?? defaultSpawnRunner,
    clock: deps.clock ?? systemClock,
    stdout: deps.stdout ?? (line => console.log(line)),
    stderr: deps.stderr ?? (line => console.error(line)),
    repoRoot: deps.repoRoot ?? resolve(import.meta.dir, "../.."),
    writeReportFile: deps.writeReportFile ?? defaultReportFileWriter,
  };
}

/** Loads env for source-database context; an explicit file failure is fatal, a missing default is not. */
function bootstrapEnv(args: RestoreCliArgs, stderr: LineWriter): void {
  if (args.envFile !== null) {
    // Resolve BEFORE applyEnvFile: applyEnvFile joins its fileName against a
    // root directory (cwd by default), which would re-root an absolute path
    // under cwd and silently miss the operator's file.
    const { fileName, rootDir } = resolveEnvFilePath(args.envFile);
    try {
      applyEnvFile(fileName, rootDir);
    } catch (error) {
      // The env file's contents may be echoed in the failure message — scrub
      // credential material before it reaches stderr (mirrors the default-
      // path scrubbing below).
      throw new RestoreUsageError(
        `env bootstrap failed: ${scrubDsnSecrets(error instanceof Error ? error.message : String(error))}`
      );
    }
    return;
  }

  try {
    applyEnvFile(".env");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // The env file's contents may be echoed in the failure message — scrub
    // credential material before it reaches stderr.
    stderr(
      "[env] proceeding without source-database context (row-count comparisons skipped): " + scrubDsnSecrets(reason)
    );
  }
}

/** Runs pg_restore into the target via an argv-array spawn; false on failure. */
async function restoreArtifact(
  spawnRunner: SpawnRunner,
  targetDsn: string,
  artifactPath: string,
  stdout: LineWriter,
  stderr: LineWriter
): Promise<boolean> {
  const outcome = await spawnRunner({
    cmd: "pg_restore",
    args: ["--clean", "--if-exists", "--no-owner", "--no-privileges", "--dbname", targetDsn, artifactPath],
  });

  if (outcome.exitCode !== 0) {
    const tail = scrubDsnSecrets(outcome.stderr, targetDsn).trim().split("\n").slice(-40).join("\n");
    stderr(`[pg_restore] pg_restore failed with exit code ${outcome.exitCode}; stderr tail:\n${tail}`);
    return false;
  }
  if (outcome.stderr.trim().length > 0) {
    stderr(`[pg_restore] warnings:\n${scrubDsnSecrets(outcome.stderr, targetDsn).trim()}`);
  }
  stdout("restore-verify: pg_restore completed");
  return true;
}

/** Resolves the psql runners for the restored target and (optionally) the source. */
function resolvePsqlRunners(
  spawnRunner: SpawnRunner,
  targetDsn: string
): { targetPsql: PsqlRunner; sourcePsql: PsqlRunner | null } {
  const targetPsql = makePsqlRunner(spawnRunner, targetDsn);
  const sourceDsn = process.env.DATABASE_URL;
  const sourcePsql =
    sourceDsn !== undefined && isValidDatabaseUrl(sourceDsn) && sourceDsn !== targetDsn
      ? makePsqlRunner(spawnRunner, sourceDsn)
      : null;
  return { targetPsql, sourcePsql };
}

/** Structural + oracle verification of the restored target (read-only). */
async function verifyRestoredTarget(
  spawnRunner: SpawnRunner,
  targetDsn: string,
  repoRoot: string,
  manifest: BackupManifest,
  stderr: LineWriter
): Promise<{ structural: StructuralCheckRow[]; oracles: OracleResult[] }> {
  const { targetPsql, sourcePsql } = resolvePsqlRunners(spawnRunner, targetDsn);
  const expectedTables = deriveExpectedTableNames(join(repoRoot, "backend", "db", "schema"));
  const structural = await runStructuralChecks(targetPsql, sourcePsql, expectedTables, stderr);
  const oracles = await runOracles(targetPsql, { journalHash: manifest.journalHash });

  for (const oracle of oracles) {
    if (oracle.offendingCount === ORACLE_ERROR_OFFENDING_COUNT) {
      stderr(`[verify:${oracle.id}] oracle errored (could not evaluate): ${oracle.description}`);
    } else if (!oracle.passed) {
      stderr(`[verify:${oracle.id}] ${oracle.offendingCount} offending row(s)/value(s): ${oracle.description}`);
    }
  }

  return { structural, oracles };
}

function printReportSummary(stdout: LineWriter, report: RestoreReport): void {
  const structuralOk = report.structural.filter(row => row.ok).length;
  const oraclesPassed = report.oracles.filter(oracle => oracle.passed).length;
  stdout(`restore-verify: structural checks ${structuralOk}/${report.structural.length} ok`);
  stdout(
    `restore-verify: critical tables ` +
      report.structural
        .filter(row => (CRITICAL_TABLES as readonly string[]).includes(row.table))
        .map(row => `${row.table}=${row.rowCount}`)
        .join(" ")
  );
  stdout(`restore-verify: oracles ${oraclesPassed}/${report.oracles.length} passed`);
  stdout(`VERDICT: ${report.verdict}`);
}

/**
 * DI orchestrator for the full restore-verify pipeline. Returns the process
 * exit code (0 PASS, 1 FAIL/restore error, 2 usage/guard refusal).
 */
export async function runRestoreVerify(args: RestoreCliArgs, deps: RestoreVerifyDeps = {}): Promise<number> {
  const { spawnRunner, clock, stdout, stderr, repoRoot, writeReportFile } = resolveDeps(deps);

  if (args.showHelp) {
    stdout(RESTORE_USAGE_TEXT);
    return 0;
  }
  if (args.targetDsn === null) {
    throw new RestoreUsageError("--target is REQUIRED (no default target exists). Pass --help for usage.");
  }
  if (args.from === null) {
    throw new RestoreUsageError("--from is REQUIRED (run directory or dump artifact). Pass --help for usage.");
  }

  const startedAt = clock();
  bootstrapEnv(args, stderr);

  // Guard the EXACT dsn string that pg_restore will receive (single-variable
  // threading) BEFORE any child process is spawned.
  const guardAssessment = assessRestoreTargetSafety(args.targetDsn);
  if (guardAssessment.blocked) {
    stderr(formatRestoreGuardBlockMessage(guardAssessment));
    return 2;
  }
  assertRestoreConfirmation(args.confirmed);

  const targetDatabase = redactTargetDatabaseName(args.targetDsn);
  stdout(`restore-verify: target database "${targetDatabase}" (scratch/staging expected)`);

  // Artifact resolution + tamper re-verification (no restore spawn on mismatch).
  const resolved = resolveRunArtifact(args.from);
  stdout(
    `restore-verify: artifact ${resolved.artifactPath} (manifest: ${resolved.manifestPath}, ` +
      `backed-up database: "${resolved.manifest.database}")`
  );

  const artifactSha256 = await sha256File(resolved.artifactPath);
  const hashesMatch = artifactSha256 === resolved.manifest.sha256;
  if (!hashesMatch) {
    stderr(
      `[verify] artifact sha256 mismatch: manifest ${resolved.manifest.sha256} vs recomputed ${artifactSha256} — refusing restore`
    );
    return 1;
  }
  // Manifest-controlled byte-size cross-check: a manifest that claims a
  // different artifact length than the file it names is tampered or mispaired
  // (tamper-fail class — refuses the restore before any spawn).
  if (resolved.artifactSize !== resolved.manifest.artifactBytes) {
    stderr(
      `[verify] artifact byte size mismatch: manifest ${resolved.manifest.artifactBytes} vs actual ${resolved.artifactSize} — refusing restore`
    );
    return 1;
  }
  stdout(`restore-verify: artifact sha256 verified (${artifactSha256})`);

  if (!(await restoreArtifact(spawnRunner, args.targetDsn, resolved.artifactPath, stdout, stderr))) {
    return 1;
  }

  const { structural, oracles } = await verifyRestoredTarget(
    spawnRunner,
    args.targetDsn,
    repoRoot,
    resolved.manifest,
    stderr
  );

  // A hash mismatch refuses the restore before any verification runs, so any
  // report reaching this aggregation point necessarily has matching hashes;
  // the REAL comparison result is threaded into the verdict regardless.
  const verdict = evaluateVerdict(structural, oracles, hashesMatch);
  const finishedAt = clock();
  const report: RestoreReport = {
    tool: RESTORE_TOOL_ID,
    artifactFile: reportArtifactFile(resolved.artifactPath),
    artifactSha256,
    target: { database: targetDatabase },
    startedAtUtc: startedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    structural,
    oracles,
    verdict,
  };

  // Per-run report name: the run directory is RETAINED (the operator may
  // re-drill the same artifact), so the fixed base name would collide with
  // the previous run's report and lose this run's verdict (writer fails
  // closed, never clobbers).
  const reportPath = writeRestoreReport(resolved.runDir, report, writeReportFile, restoreReportFileName(startedAt));
  printReportSummary(stdout, report);
  stdout(`restore-verify: report written to ${reportPath}`);

  return verdict === "PASS" ? 0 : 1;
}

/** CLI entry point: parse → orchestrate → exit. Scrubs credentials before printing failures. */
async function main(): Promise<number> {
  try {
    return await runRestoreVerify(parseRestoreArgs(process.argv.slice(2)));
  } catch (error) {
    if (error instanceof RestoreUsageError) {
      console.error(`restore-verify: ${error.message}`);
      console.error(`\n${RESTORE_USAGE_TEXT}`);
      return 2;
    }
    if (error instanceof RestoreArtifactError || error instanceof RestoreVerificationError) {
      console.error(`[verify] ${scrubDsnSecrets(error.message)}`);
      return 1;
    }
    console.error(`restore-verify: unexpected failure (credentials scrubbed):\n${scrubDsnSecrets(String(error))}`);
    return 1;
  }
}

const isDirectExecution = process.argv[1] !== undefined && import.meta.path === process.argv[1];
if (isDirectExecution) {
  process.exit(await main());
}
