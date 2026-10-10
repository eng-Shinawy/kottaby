/**
 * EXPLAIN query auditor + scale-aware scan gate (`perf:analyze-queries`).
 *
 * One invocation walks the canonical query registry: every registered
 * production surface's REAL repository read runs inside a capture window
 * that records the exact SQL text and binding values pg receives, each
 * captured statement is replayed under `EXPLAIN (ANALYZE, BUFFERS, FORMAT
 * JSON)`, and the plan trees are walked for the two gate facts — Seq Scan
 * nodes whose estimated rows reach the configured threshold, and the
 * access path serving the matching pipeline's `session` NOT EXISTS
 * subplan. Every query's raw plan is persisted under `explain/<id>.json`
 * in the run directory so index-evolution comparisons across runs stay
 * possible.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST: the resolved DATABASE_URL
 *     must name the test database or the process refuses (exit 2) before
 *     any database client is constructed — the registry's repository
 *     modules are imported dynamically only inside the post-guard capture
 *     thunks, so no pool object exists before the guard has allowed the
 *     run.
 *  2. The EXPLAIN prefix is a static string; captured binding values are
 *     re-bound as parameters, never spliced into statement text — no CLI
 *     input and no captured value ever reaches a query string.
 *  3. Only SELECT-shaped statements are ever EXPLAINed: EXPLAIN ANALYZE
 *     executes the statement it explains, so a write-shaped capture is
 *     refused by construction (typed error, no EXPLAIN issued).
 *  4. Report and explain artifacts are redacted before they reach disk
 *     (the shared report writer's contract plus explicit redaction on the
 *     artifact writer), owner-only modes, clobber-guarded.
 *
 * Exit codes: 0 = all gates pass, 1 = a gate breached or runtime failure,
 * 2 = usage refusal or guard refusal.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AnalyzeQueriesCliOptions,
  isAnalyzeQueriesCliUsageError,
  parseAnalyzeQueriesCli,
} from "@/scripts/perf/lib/analyze-queries-cli";
import {
  buildAnalyzeSections,
  buildAnalyzeSummaryLines,
  buildMatchingSessionIndexGate,
  buildScanGate,
  renderExplainArtifact,
} from "@/scripts/perf/lib/analyze-report";
import { assertTestDatabaseTarget, type DatabaseTargetOk } from "@/scripts/perf/lib/db-target-guard";
import { analyzeExplainRows, type ExplainPlanAnalysis } from "@/scripts/perf/lib/explain-scan";
import { type CaptureAround, type CapturedStatement, captureQueryStatements } from "@/scripts/perf/lib/query-capture";
import { CANONICAL_QUERY_REGISTRY, REGISTRY_ID_PATTERN, type RegistryEntry } from "@/scripts/perf/lib/query-registry";
import {
  emitVerdict,
  openRunDirectory,
  type PerfRunContext,
  redactSecrets,
  writeReport,
} from "@/scripts/perf/lib/report";
import type { GateResult } from "@/scripts/perf/lib/stats";

const SCRIPT_LABEL = "perf:analyze-queries";
const TOOL_ID = "analyze-queries";
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;
const EXPLAIN_ARTIFACT_DIR = "explain";

/** Static EXPLAIN prologue — never interpolated, never built from input. */
export const EXPLAIN_PREFIX = "EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ";

/** Raised for auditor runtime refusals (write-shaped captures, unsafe artifact ids). */
export class AnalyzeQueriesError extends Error {}

/** One captured statement analyzed end to end: text, values, raw plan rows, and the plan analysis. */
interface AnalyzedStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly analysis: ExplainPlanAnalysis;
  readonly plan: unknown;
}

/** One registry entry's complete analysis. */
interface AnalyzedEntry {
  readonly id: string;
  readonly minVolumeNote: string;
  readonly requiresSessionIndexCheck: boolean;
  readonly statements: readonly AnalyzedStatement[];
}

/** Terminal outcome of one audit run; main() turns it into stdout + exit code. */
export interface AnalyzeQueriesOutcome {
  readonly passed: boolean;
  readonly runId: string;
  readonly runDir: string;
  readonly gates: readonly GateResult[];
  readonly sections: Record<string, unknown>;
  readonly summaryLines: readonly string[];
}

/** Environment + effectful seams the audit orchestrates over. */
export interface AnalyzeQueriesIo {
  env(): { databaseUrl: string };
  assertTarget(databaseUrl: string): DatabaseTargetOk;
  captureAround: CaptureAround;
  /** Replays one captured statement under the EXPLAIN prologue; resolves to the read's ROWS. */
  explain(statement: CapturedStatement): Promise<unknown>;
  openRun(): { runDir: string; runId: string };
  writeReport(ctx: PerfRunContext, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  writeExplainArtifact(runDir: string, entryId: string, contents: string): void;
  closeDatabase(): Promise<void>;
}

/** EXPLAIN ANALYZE executes what it explains — only SELECT-shaped captures may be replayed. */
function assertExplainableRead(statement: CapturedStatement): void {
  if (!/^\s*select\s/i.test(statement.sql)) {
    throw new AnalyzeQueriesError(
      `refusing to EXPLAIN ANALYZE a non-SELECT statement (starts with: ${statement.sql.slice(0, 40).trimEnd()})`
    );
  }
}

/** Analyzes one captured statement: guard, EXPLAIN, plan walk. */
async function explainStatement(statement: CapturedStatement, io: AnalyzeQueriesIo): Promise<AnalyzedStatement> {
  assertExplainableRead(statement);
  const rows = await io.explain(statement);
  return {
    sql: statement.sql,
    params: statement.params,
    analysis: analyzeExplainRows(rows),
    plan: rows,
  };
}

/** Recursive drain over one entry's captured statements (serial EXPLAINs, no await inside a loop body). */
function analyzeStatements(
  list: readonly CapturedStatement[],
  index: number,
  sink: AnalyzedStatement[],
  io: AnalyzeQueriesIo
): Promise<void> {
  if (index >= list.length) {
    return Promise.resolve();
  }
  const statement = list[index];
  return explainStatement(statement, io).then(analyzed => {
    sink.push(analyzed);
    return analyzeStatements(list, index + 1, sink, io);
  });
}

/** Captures and analyzes one registry entry's real repository read. */
async function analyzeEntry(entry: RegistryEntry, io: AnalyzeQueriesIo): Promise<AnalyzedEntry> {
  const captured = await entry.run(io.captureAround);
  const statements: AnalyzedStatement[] = [];
  await analyzeStatements(captured, 0, statements, io);
  return {
    id: entry.id,
    minVolumeNote: entry.minVolumeNote,
    requiresSessionIndexCheck: entry.requiresSessionIndexCheck,
    statements,
  };
}

/** Recursive drain over the registry (capture windows are serial, single-owner). */
function analyzeRegistryEntries(
  registry: readonly RegistryEntry[],
  index: number,
  sink: AnalyzedEntry[],
  io: AnalyzeQueriesIo
): Promise<void> {
  if (index >= registry.length) {
    return Promise.resolve();
  }
  const entry = registry[index];
  return analyzeEntry(entry, io).then(analyzed => {
    sink.push(analyzed);
    return analyzeRegistryEntries(registry, index + 1, sink, io);
  });
}

/** Persists one entry's explain artifact: redacted, owner-only, clobber-guarded, id-validated. */
export function writeExplainArtifactFile(runDir: string, entryId: string, contents: string): void {
  if (!REGISTRY_ID_PATTERN.test(entryId)) {
    throw new AnalyzeQueriesError(`explain artifact id is not file-name safe: ${entryId}`);
  }
  const artifactDir = join(runDir, EXPLAIN_ARTIFACT_DIR);
  mkdirSync(artifactDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(artifactDir, `${entryId}.json`), redactSecrets(contents), { flag: "wx", mode: 0o600 });
}

/**
 * Drives one complete audit run. The guard is the first effectful call;
 * each registry entry's real repository read is captured and replayed
 * under EXPLAIN; the gates, report, and per-query artifacts land in a
 * fresh run directory; the database connection is closed on every path
 * after the guard has allowed the run.
 */
export async function runAnalyzeQueries(
  options: AnalyzeQueriesCliOptions,
  io: AnalyzeQueriesIo,
  registry: readonly RegistryEntry[] = CANONICAL_QUERY_REGISTRY
): Promise<AnalyzeQueriesOutcome> {
  const target = io.assertTarget(io.env().databaseUrl);
  try {
    const analyzed: AnalyzedEntry[] = [];
    await analyzeRegistryEntries(registry, 0, analyzed, io);
    const scanGate = buildScanGate(analyzed, options.scanThresholdRows);
    const matchingGate = buildMatchingSessionIndexGate(analyzed);
    const gates: readonly GateResult[] = [scanGate, matchingGate];
    const run = io.openRun();
    for (const entry of analyzed) {
      io.writeExplainArtifact(
        run.runDir,
        entry.id,
        renderExplainArtifact(entry.id, entry.minVolumeNote, entry.statements)
      );
    }
    const sections = buildAnalyzeSections({
      databaseName: target.dbName,
      threshold: options.scanThresholdRows,
      entries: analyzed,
    });
    io.writeReport(
      {
        runId: run.runId,
        tool: TOOL_ID,
        startedAt: new Date().toISOString(),
        args: { scanThresholdRows: options.scanThresholdRows },
      },
      gates,
      sections
    );
    const summaryLines = buildAnalyzeSummaryLines({
      databaseName: target.dbName,
      threshold: options.scanThresholdRows,
      entryCount: analyzed.length,
      scanBreaches: scanGate.breaches,
      matchingBreaches: matchingGate.breaches,
      runDir: run.runDir,
      scriptLabel: SCRIPT_LABEL,
    });
    return {
      passed: gates.every(gate => gate.passed),
      runId: run.runId,
      runDir: run.runDir,
      gates,
      sections,
      summaryLines,
    };
  } finally {
    await io.closeDatabase();
  }
}

/** Wires the real seams: the guard, the capture window, the lazily imported database client, the report lifecycle. */
function createRealIo(): AnalyzeQueriesIo {
  return {
    env: () => ({ databaseUrl: process.env.DATABASE_URL ?? "" }),
    assertTarget: databaseUrl => assertTestDatabaseTarget(databaseUrl),
    captureAround: invoke => captureQueryStatements(invoke),
    explain: async statement => {
      const { queryDb } = await import("@/backend/db/client");
      const result = await queryDb(EXPLAIN_PREFIX + statement.sql, [...statement.params]);
      return result.rows;
    },
    openRun: () => openRunDirectory(TOOL_ID),
    writeReport: (ctx, gates, sections) => {
      writeReport(ctx, gates, sections);
    },
    writeExplainArtifact: (runDir, entryId, contents) => {
      writeExplainArtifactFile(runDir, entryId, contents);
    },
    closeDatabase: async () => {
      const { closePool } = await import("@/backend/db/client");
      await closePool();
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseAnalyzeQueriesCli(process.argv.slice(2));
  if (isAnalyzeQueriesCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  let outcome: AnalyzeQueriesOutcome;
  try {
    outcome = await runAnalyzeQueries(parsed, createRealIo());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT_FAILURE);
  }
  for (const line of outcome.summaryLines) {
    console.log(line);
  }
  emitVerdict(outcome.gates);
  process.exit(outcome.passed ? 0 : EXIT_FAILURE);
}

if (import.meta.main) {
  void main();
}
