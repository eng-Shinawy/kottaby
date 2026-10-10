/**
 * Report assembly for the index verification tool: the coverage gate,
 * the full covered/uncovered Markdown table, and the report sections the
 * harness report writer persists. Gate semantics: the audit passes only
 * when zero FK columns are uncovered; the hot-column facts are evidence
 * sections, never gate inputs.
 */

import {
  DOCUMENTED_UNCOVERED_FK_COLUMNS,
  type FkColumnCoverage,
  type HotColumnCoverage,
} from "@/scripts/perf/lib/index-audit";
import type { PlanScan } from "@/scripts/perf/lib/index-audit-planner";
import type { GateResult } from "@/scripts/perf/lib/stats";

export const FK_COVERAGE_GATE_ID = "fk-coverage";

/** The uncovered-FK-column gate: passes only on zero uncovered columns. */
export function buildFkCoverageGate(coverage: readonly FkColumnCoverage[]): GateResult {
  const uncovered = coverage.filter(column => !column.covered);
  return {
    id: FK_COVERAGE_GATE_ID,
    passed: uncovered.length === 0,
    observed: {},
    breaches: uncovered.map(
      column => `${column.schemaName}.${column.tableName}.${column.columnName} (${column.constraintName})`
    ),
  };
}

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

/**
 * Renders the full covered/uncovered table — one row per FK column, in
 * declaration order — as a Markdown table for the run directory's
 * coverage artifact.
 */
export function renderCoverageMarkdownTable(coverage: readonly FkColumnCoverage[]): string {
  const lines = [
    "# FK Index Coverage Audit",
    "",
    `Audited ${coverage.length} foreign-key column(s).`,
    "",
    "| Schema | Table | Constraint | Column | Covered | Covering indexes |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const column of coverage) {
    const covering = column.coveringIndexNames.length > 0 ? column.coveringIndexNames.join(", ") : "—";
    lines.push(
      `| ${escapeTableCell(column.schemaName)} | ${escapeTableCell(column.tableName)} | ${escapeTableCell(column.constraintName)} | ${escapeTableCell(column.columnName)} | ${column.covered ? "yes" : "NO"} | ${escapeTableCell(covering)} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

/** Everything the report sections need, precomputed by the entrypoint. */
export interface VerifySectionsInput {
  readonly databaseName: string;
  readonly coverage: readonly FkColumnCoverage[];
  readonly hotColumns: readonly HotColumnCoverage[];
  readonly compositeEligibilityIndex: string | null;
  readonly plannerScans: readonly PlanScan[];
}

/**
 * Builds the report sections: the database identity, the FK coverage
 * facts with the uncovered list, the hot-column and planner evidence
 * (informational), and the documented pre-remediation baseline with an
 * observed-vs-baseline drift flag.
 */
export function buildVerifySections(input: VerifySectionsInput): Record<string, unknown> {
  const uncovered = input.coverage.filter(column => !column.covered);
  const observedSet = uncovered.map(column => `${column.tableName}.${column.columnName}`);
  const documented = [...DOCUMENTED_UNCOVERED_FK_COLUMNS];
  const matchesBaseline =
    observedSet.length === documented.length && observedSet.every(column => documented.includes(column));
  return {
    database: { name: input.databaseName },
    fkCoverage: {
      constraints: new Set(
        input.coverage.map(column => `${column.schemaName}.${column.tableName}.${column.constraintName}`)
      ).size,
      columnsTotal: input.coverage.length,
      columnsCovered: input.coverage.length - uncovered.length,
      uncovered: uncovered.map(column => ({
        table: column.tableName,
        column: column.columnName,
        constraint: column.constraintName,
      })),
    },
    hotColumns: {
      note: "informational planner evidence for the matching pipeline's driving columns; not a gate",
      columns: input.hotColumns.map(column => ({
        table: column.table,
        column: column.column,
        leadingIndexNames: [...column.leadingIndexNames],
      })),
      compositeEligibilityIndex: input.compositeEligibilityIndex,
      plannerChoice: input.plannerScans.map(scan => ({
        relation: scan.relationName,
        nodeType: scan.nodeType,
        indexName: scan.indexName,
      })),
    },
    documentedBaseline: {
      uncoveredFkColumns: documented,
      observedMatchesBaseline: matchesBaseline,
      note: "pre-remediation documentation; the live catalog is always the audit's source of truth",
    },
  };
}
