/**
 * Gate construction, report sections, summary lines, and the explain
 * artifact body for the EXPLAIN query auditor — pure assembly over the
 * analyzed entries, no I/O of its own (the entrypoint owns the seams).
 *
 * Two gates drive the verdict:
 *  - `scan-gate` — zero Seq Scan nodes whose estimated rows reach the
 *    configured threshold, across every captured statement of every
 *    registered query. A statement whose plan could not be read fails
 *    closed: an unverifiable plan can never prove the absence of a scan.
 *  - `matching-session-index` — every matching-shaped plan must serve its
 *    NOT EXISTS subplan through the expected composite session index;
 *    any other access path (or an unverifiable one) is flagged.
 */

import {
  EXPECTED_MATCHING_SESSION_INDEX,
  type ExplainPlanAnalysis,
  type SeqScanFact,
  seqScanBreachesThreshold,
} from "@/scripts/perf/lib/explain-scan";
import type { GateResult } from "@/scripts/perf/lib/stats";

export const SCAN_GATE_ID = "scan-gate";
export const MATCHING_SESSION_INDEX_GATE_ID = "matching-session-index";

/** One analyzed statement as the report sees it. */
export interface StatementRecord {
  readonly sql: string;
  readonly analysis: ExplainPlanAnalysis;
}

/** One analyzed registry entry as the report sees it. */
export interface EntryRecord {
  readonly id: string;
  readonly minVolumeNote: string;
  readonly requiresSessionIndexCheck: boolean;
  readonly statements: readonly StatementRecord[];
}

/** One statement's full evidence for the persisted explain artifact (raw plan included). */
export interface ExplainArtifactStatement {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly analysis: ExplainPlanAnalysis;
  readonly plan: unknown;
}

function statementLabel(entryId: string, statementIndex: number): string {
  return `${entryId}#stmt-${statementIndex + 1}`;
}

function describeRows(fact: SeqScanFact, threshold: number): string {
  return fact.estimatedRows === null
    ? "estimated rows unavailable — fail-closed"
    : `${fact.estimatedRows} >= ${threshold}`;
}

/** Breach lines for one statement's plan against the scan threshold (empty = compliant). */
function scanBreachesFor(
  entryId: string,
  statementIndex: number,
  analysis: ExplainPlanAnalysis,
  threshold: number
): string[] {
  const label = statementLabel(entryId, statementIndex);
  if (!analysis.readable) {
    return [`${label}: plan unreadable — Seq Scan absence cannot be verified (fail-closed)`];
  }
  return analysis.seqScans
    .filter(fact => seqScanBreachesThreshold(fact, threshold))
    .map(
      fact => `${label}: Seq Scan on ${fact.relationName ?? "(unknown relation)"} (${describeRows(fact, threshold)})`
    );
}

/** The scale-aware scan gate over every statement of every registered query. */
export function buildScanGate(entries: readonly EntryRecord[], threshold: number): GateResult {
  const breaches = entries.flatMap(entry =>
    entry.statements.flatMap((statement, statementIndex) =>
      scanBreachesFor(entry.id, statementIndex, statement.analysis, threshold)
    )
  );
  const statementCount = entries.reduce((total, entry) => total + entry.statements.length, 0);
  return {
    id: SCAN_GATE_ID,
    passed: breaches.length === 0,
    observed: { count: statementCount },
    breaches,
  };
}

function matchingIndexBreachesFor(entry: EntryRecord): string[] {
  if (entry.statements.length === 0) {
    return [`${entry.id}: no statements captured — index choice unverifiable (fail-closed)`];
  }
  return entry.statements.flatMap((statement, statementIndex) => {
    const label = statementLabel(entry.id, statementIndex);
    const sessionScan = statement.analysis.sessionScan;
    if (sessionScan === null) {
      return [`${label}: no session scan found in plan — NOT EXISTS index choice unverifiable (fail-closed)`];
    }
    if (sessionScan.indexName !== EXPECTED_MATCHING_SESSION_INDEX) {
      return [
        `${label}: session NOT EXISTS scan: ${sessionScan.nodeType} (${sessionScan.indexName ?? "no index"}) — expected ${EXPECTED_MATCHING_SESSION_INDEX}`,
      ];
    }
    return [];
  });
}

/** The matching NOT EXISTS index-choice gate (matching-shaped entries only). */
export function buildMatchingSessionIndexGate(entries: readonly EntryRecord[]): GateResult {
  const matchingEntries = entries.filter(entry => entry.requiresSessionIndexCheck);
  const breaches = matchingEntries.flatMap(matchingIndexBreachesFor);
  return {
    id: MATCHING_SESSION_INDEX_GATE_ID,
    passed: breaches.length === 0,
    observed: { count: matchingEntries.length },
    breaches,
  };
}

/** The plan-cost evidence table: one row per analyzed statement. */
function buildPlanCostTable(entries: readonly EntryRecord[]): Record<string, unknown>[] {
  return entries.flatMap(entry =>
    entry.statements.map((statement, statementIndex) => {
      const seqScans = statement.analysis.seqScans;
      const maxSeqScanRows = seqScans.reduce<number | null>(
        (max, fact) => (fact.estimatedRows === null ? null : Math.max(max ?? 0, fact.estimatedRows)),
        null
      );
      return {
        id: entry.id,
        statement: statementLabel(entry.id, statementIndex),
        rootNodeType: statement.analysis.rootNodeType,
        totalCost: statement.analysis.totalCost,
        seqScanCount: seqScans.length,
        maxSeqScanEstimatedRows: maxSeqScanRows,
        sessionScan: statement.analysis.sessionScan,
      };
    })
  );
}

/** The report sections: target, threshold, registry census, per-query facts, and the plan-cost table. */
export function buildAnalyzeSections(input: {
  readonly databaseName: string;
  readonly threshold: number;
  readonly entries: readonly EntryRecord[];
}): Record<string, unknown> {
  return {
    database: input.databaseName,
    scanThresholdRows: input.threshold,
    registry: {
      size: input.entries.length,
      ids: input.entries.map(entry => entry.id),
    },
    queries: input.entries.map(entry => ({
      id: entry.id,
      minVolumeNote: entry.minVolumeNote,
      statementCount: entry.statements.length,
      statements: entry.statements.map(statement => ({
        sql: statement.sql,
        readable: statement.analysis.readable,
        rootNodeType: statement.analysis.rootNodeType,
        totalCost: statement.analysis.totalCost,
        seqScans: statement.analysis.seqScans,
        sessionScan: statement.analysis.sessionScan,
        parseNotes: statement.analysis.parseNotes,
      })),
    })),
    planCostTable: buildPlanCostTable(input.entries),
  };
}

/** Operator-facing summary lines (human mode). */
export function buildAnalyzeSummaryLines(input: {
  readonly databaseName: string;
  readonly threshold: number;
  readonly entryCount: number;
  readonly scanBreaches: readonly string[];
  readonly matchingBreaches: readonly string[];
  readonly runDir: string;
  readonly scriptLabel: string;
}): readonly string[] {
  return [
    `${input.scriptLabel}: EXPLAIN audit against ${input.databaseName}: ${input.entryCount} registry queries analyzed`,
    `${input.scriptLabel}: scan gate at threshold ${input.threshold}: ${
      input.scanBreaches.length === 0
        ? "zero materialized Seq Scan breaches"
        : `${input.scanBreaches.length} breach(es)`
    }`,
    `${input.scriptLabel}: matching NOT EXISTS index check: ${
      input.matchingBreaches.length === 0 ? "clean" : `${input.matchingBreaches.length} breach(es)`
    }`,
    `${input.scriptLabel}: report: ${input.runDir}/report.md (+ report.json, explain/<queryId>.json per query)`,
  ];
}

/** The persisted per-query evidence body: captured SQL, bound values, raw plan, and the analysis. */
export function renderExplainArtifact(
  id: string,
  minVolumeNote: string,
  statements: readonly ExplainArtifactStatement[]
): string {
  return JSON.stringify(
    {
      id,
      minVolumeNote,
      statements: statements.map(statement => ({
        sql: statement.sql,
        params: statement.params,
        analysis: statement.analysis,
        plan: statement.plan,
      })),
    },
    null,
    2
  );
}
