/**
 * Foreign-key index coverage audit + hot-column planner check
 * (`perf:verify-indexes`).
 *
 * One invocation reads the live PostgreSQL catalog — every foreign-key
 * constraint's referencing columns (`pg_constraint contype='f'` joined
 * through `pg_attribute`), and every index `pg_indexes` reports — then
 * applies the coverage rule: an FK column is covered iff some btree
 * index on the same table lists it as the leading key column, or the
 * constraint's referencing columns form a prefix of an index's key
 * columns (primary-key and unique-constraint backing counts, because
 * PostgreSQL implements both as btree indexes). The gate is zero
 * uncovered FK columns.
 *
 * The matching pipeline's driving columns are reported as evidence: the
 * leading-column coverage for `teacher.is_online`, `is_approved`, and
 * `average_rating`, plus the planner's actual index choice from one
 * matching-shaped `EXPLAIN (FORMAT JSON)` read — informational, never a
 * gate input.
 *
 * Safety contract, in order:
 *  1. The destructive-target guard runs FIRST: the resolved DATABASE_URL
 *     must name the test database or the process refuses (exit 2)
 *     before any database client is constructed. The client module is
 *     imported dynamically only after the guard has allowed the run —
 *     the tool is read-only, but it still refuses the wrong target for
 *     consistency with every other harness entry point.
 *  2. Every catalog query is static SQL with positional parameters — no
 *     CLI input ever reaches a query string.
 *  3. Report content is redacted before it reaches disk (the shared
 *     report writer's contract); the extra coverage artifact is written
 *     owner-only with a clobber guard.
 *
 * Exit codes: 0 = zero uncovered FK columns, 1 = uncovered columns found
 * or runtime failure, 2 = usage refusal or guard refusal.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { assertTestDatabaseTarget, type DatabaseTargetOk } from "@/scripts/perf/lib/db-target-guard";
import {
  analyzeHotColumnCoverage,
  computeFkColumnCoverage,
  type FkColumnRow,
  findCompositeEligibilityIndex,
  type IndexRow,
} from "@/scripts/perf/lib/index-audit";
import { extractExplainPlan, summarizeMatchingPlan } from "@/scripts/perf/lib/index-audit-planner";
import {
  buildFkCoverageGate,
  buildVerifySections,
  renderCoverageMarkdownTable,
} from "@/scripts/perf/lib/index-audit-report";
import {
  emitVerdict,
  openRunDirectory,
  type PerfRunContext,
  redactSecrets,
  writeReport,
} from "@/scripts/perf/lib/report";
import type { GateResult } from "@/scripts/perf/lib/stats";
import {
  isVerifyIndexesCliUsageError,
  parseVerifyIndexesCli,
  type VerifyIndexesCliOptions,
} from "@/scripts/perf/lib/verify-indexes-cli";

const SCRIPT_LABEL = "perf:verify-indexes";
const TOOL_ID = "verify-indexes";
const EXIT_USAGE = 2;
const EXIT_FAILURE = 1;
const SCHEMA_NAME = "public";
const COVERAGE_ARTIFACT_NAME = "fk-coverage.md";

/** Static catalog read: one row per referencing FK column, declaration-ordered (ordinal is smallint-cast — pg returns bigint as text). */
export const FK_COLUMNS_SQL = `
SELECT c.conname AS "constraintName", n.nspname AS "schemaName", t.relname AS "tableName",
       k.n::int AS "ordinal", a.attname AS "columnName"
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, n) ON TRUE
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
WHERE c.contype = $1 AND n.nspname = $2`;

/** Static catalog read: every index the catalog reports for the schema. */
export const INDEXES_SQL = `
SELECT schemaname AS "schemaName", tablename AS "tableName", indexname AS "indexName", indexdef AS "indexDefinition"
FROM pg_indexes WHERE schemaname = $1`;

/**
 * Static matching-shaped read for the hot-column planner check: the
 * matching pipeline's eligibility chain (online + certified teacher,
 * governed-account exclusions, the `started`-session NOT EXISTS
 * exclusion), country-tier-first ordering with the rating sort, page
 * windowed. Mirrors the repository matching read's shape; every value is
 * a positional parameter.
 */
export const MATCHING_EXPLAIN_SQL = `
EXPLAIN (FORMAT JSON)
SELECT teacher.id, users.full_name, users.country, users.country_code, teacher.subjects,
       teacher.recitations, teacher.languages, teacher.average_rating, teacher.is_online
FROM teacher
INNER JOIN users ON users.id = teacher.id
WHERE teacher.is_online = true AND teacher.is_approved = true
  AND users.is_deleted IS DISTINCT FROM true
  AND users.suspended IS DISTINCT FROM true
  AND users.is_blocked IS DISTINCT FROM true
  AND NOT EXISTS (
    SELECT 1 FROM session WHERE session.teacher_id = teacher.id AND session.status = 'started'
  )
ORDER BY CASE WHEN users.country_code = $1 THEN 0 ELSE 1 END, teacher.average_rating DESC NULLS LAST, teacher.id DESC
LIMIT $2 OFFSET $3`;

/** Row shape of the EXPLAIN read (PostgreSQL names the column `QUERY PLAN`). */
type ExplainRow = { readonly "QUERY PLAN": unknown };

/** Environment + effectful seams the audit orchestrates over. */
export interface VerifyIndexesIo {
  env(): { databaseUrl: string };
  assertTarget(databaseUrl: string): DatabaseTargetOk;
  listFkColumns(): Promise<readonly FkColumnRow[]>;
  listIndexes(): Promise<readonly IndexRow[]>;
  explainMatchingQuery(): Promise<unknown>;
  openRun(): { runDir: string; runId: string };
  writeReport(ctx: PerfRunContext, gates: readonly GateResult[], sections: Record<string, unknown>): void;
  writeArtifact(runDir: string, fileName: string, contents: string): void;
  closeDatabase(): Promise<void>;
}

/** Terminal outcome of one audit run; main() turns it into stdout + exit code. */
export interface VerifyIndexesAuditOutcome {
  readonly passed: boolean;
  readonly runId: string;
  readonly runDir: string;
  readonly gates: readonly GateResult[];
  readonly sections: Record<string, unknown>;
  readonly summaryLines: readonly string[];
}

function formatScan(scan: { nodeType: string; relationName: string; indexName: string | null }): string {
  return `${scan.relationName}: ${scan.nodeType} (${scan.indexName ?? "no index"})`;
}

/** Operator-facing summary lines (human mode only; --json prints the machine body instead). */
function buildSummaryLines(outcome: {
  databaseName: string;
  coverage: readonly { covered: boolean; tableName: string; columnName: string }[];
  hotColumns: readonly { column: string; leadingIndexNames: readonly string[] }[];
  plannerScans: readonly { nodeType: string; relationName: string; indexName: string | null }[];
  runDir: string;
}): readonly string[] {
  const uncovered = outcome.coverage.filter(column => !column.covered);
  const lines = [
    `${SCRIPT_LABEL}: FK coverage audit against ${outcome.databaseName}: ` +
      `${outcome.coverage.length} FK columns, ${outcome.coverage.length - uncovered.length} covered`,
    `${SCRIPT_LABEL}: uncovered FK columns: ${
      uncovered.length === 0 ? "(none)" : uncovered.map(column => `${column.tableName}.${column.columnName}`).join(", ")
    }`,
  ];
  const hotSummary = outcome.hotColumns
    .map(
      column =>
        `${column.column}: ${column.leadingIndexNames.length > 0 ? column.leadingIndexNames.join(", ") : "no leading index"}`
    )
    .join("; ");
  lines.push(`${SCRIPT_LABEL}: matching hot columns — ${hotSummary}`);
  lines.push(
    `${SCRIPT_LABEL}: matching plan scans — ${outcome.plannerScans.length > 0 ? outcome.plannerScans.map(formatScan).join("; ") : "(plan unavailable)"}`
  );
  lines.push(
    `${SCRIPT_LABEL}: report: ${join(outcome.runDir, "report.md")} (+ report.json, ${COVERAGE_ARTIFACT_NAME})`
  );
  return lines;
}

/**
 * Drives one complete audit run. The guard is the first effectful call;
 * the catalog reads run read-only; the report and coverage artifact are
 * written into a fresh run directory; the database connection is closed
 * on every path after the guard has allowed the run.
 */
export async function runVerifyIndexesAudit(
  options: VerifyIndexesCliOptions,
  io: VerifyIndexesIo
): Promise<VerifyIndexesAuditOutcome> {
  const target = io.assertTarget(io.env().databaseUrl);
  try {
    const [fkRows, indexRows, explainRows] = await Promise.all([
      io.listFkColumns(),
      io.listIndexes(),
      io.explainMatchingQuery(),
    ]);
    const coverage = computeFkColumnCoverage(fkRows, indexRows);
    const hotColumns = analyzeHotColumnCoverage(indexRows);
    const compositeIndex = findCompositeEligibilityIndex(indexRows);
    const planner = summarizeMatchingPlan(extractExplainPlan(explainRows));
    const gates: readonly GateResult[] = [buildFkCoverageGate(coverage)];
    const run = io.openRun();
    const sections = buildVerifySections({
      databaseName: target.dbName,
      coverage,
      hotColumns,
      compositeEligibilityIndex: compositeIndex,
      plannerScans: planner.scans,
    });
    io.writeReport(
      { runId: run.runId, tool: TOOL_ID, startedAt: new Date().toISOString(), args: { json: options.json } },
      gates,
      sections
    );
    io.writeArtifact(run.runDir, COVERAGE_ARTIFACT_NAME, renderCoverageMarkdownTable(coverage));
    return {
      passed: gates.every(gate => gate.passed),
      runId: run.runId,
      runDir: run.runDir,
      gates,
      sections,
      summaryLines: buildSummaryLines({
        databaseName: target.dbName,
        coverage,
        hotColumns,
        plannerScans: planner.scans,
        runDir: run.runDir,
      }),
    };
  } finally {
    await io.closeDatabase();
  }
}

/** Wires the real seams: the guard, the lazily imported database client, the report lifecycle. */
function createRealIo(): VerifyIndexesIo {
  return {
    env: () => ({ databaseUrl: process.env.DATABASE_URL ?? "" }),
    assertTarget: databaseUrl => assertTestDatabaseTarget(databaseUrl),
    listFkColumns: async () => {
      const { queryDb } = await import("@/backend/db/client");
      return (await queryDb<FkColumnRow>(FK_COLUMNS_SQL, ["f", SCHEMA_NAME])).rows;
    },
    listIndexes: async () => {
      const { queryDb } = await import("@/backend/db/client");
      return (await queryDb<IndexRow>(INDEXES_SQL, [SCHEMA_NAME])).rows;
    },
    explainMatchingQuery: async () => {
      const { queryDb } = await import("@/backend/db/client");
      return (await queryDb<ExplainRow>(MATCHING_EXPLAIN_SQL, ["EG", 25, 0])).rows;
    },
    openRun: () => openRunDirectory(TOOL_ID),
    writeReport: (ctx, auditGates, auditSections) => {
      writeReport(ctx, auditGates, auditSections);
    },
    writeArtifact: (runDir, fileName, contents) => {
      writeFileSync(join(runDir, fileName), contents, { flag: "wx", mode: 0o600 });
    },
    closeDatabase: async () => {
      const { closePool } = await import("@/backend/db/client");
      await closePool();
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseVerifyIndexesCli(process.argv.slice(2));
  if (isVerifyIndexesCliUsageError(parsed)) {
    console.error(parsed.message);
    process.exit(EXIT_USAGE);
  }
  let outcome: VerifyIndexesAuditOutcome;
  try {
    outcome = await runVerifyIndexesAudit(parsed, createRealIo());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(EXIT_FAILURE);
  }
  if (parsed.json) {
    const body = JSON.stringify(
      {
        tool: TOOL_ID,
        runId: outcome.runId,
        gates: outcome.gates,
        sections: outcome.sections,
        verdict: outcome.passed ? "PASS" : "FAIL",
      },
      null,
      2
    );
    console.log(redactSecrets(body));
  } else {
    for (const line of outcome.summaryLines) {
      console.log(line);
    }
    emitVerdict(outcome.gates);
  }
  process.exit(outcome.passed ? 0 : EXIT_FAILURE);
}

if (import.meta.main) {
  void main();
}
