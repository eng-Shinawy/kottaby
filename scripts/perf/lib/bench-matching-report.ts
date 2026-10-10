/**
 * Report assembly for the matching benchmark: the gate table (one gate per
 * gate-volume cell — p95 strictly below the budget and ZERO assertion
 * errors), the machine sections (environment, windowing, matrix, callers),
 * and the operator summary lines. Scale-evidence cells (every volume other
 * than the gate volume) are reported but never gated.
 */

import { type BenchCellSpec, GATE_VOLUME } from "@/scripts/perf/lib/bench-matching-cells";
import type { VolumeStep } from "@/scripts/perf/lib/bench-matching-plan";
import type { CellRunResult } from "@/scripts/perf/lib/bench-matching-runner";
import { evaluateGate, type GateResult, type PercentileSummary } from "@/scripts/perf/lib/stats";

/**
 * Builds one volume's window record: how many teachers the window holds,
 * how many were flipped offline to reach it, how many started-session
 * teachers sit inside it, and the resulting browsable estimate.
 */
export function windowRecordFor(
  step: VolumeStep,
  startedIds: readonly number[],
  censusIds: readonly number[]
): BenchWindowRecord {
  const windowIds = new Set(censusIds.slice(0, step.volume));
  let startedWithinWindow = 0;
  for (const startedId of startedIds) {
    if (windowIds.has(startedId)) {
      startedWithinWindow += 1;
    }
  }
  return {
    volume: step.volume,
    windowSize: step.windowSize,
    flippedOffline: step.flipIds.length,
    startedWithinWindow,
    browsableEstimate: step.windowSize - startedWithinWindow,
  };
}

/** One measured matrix cell, joined with its spec and summary. */
export interface BenchCellRecord {
  readonly spec: BenchCellSpec;
  readonly run: CellRunResult;
  readonly gateCell: boolean;
}

/** Facts about the run the report and summary lines carry. */
export interface BenchReportFacts {
  readonly databaseName: string;
  readonly seedRunId: string;
  readonly prefix: string;
  readonly eligibleCensus: number;
  readonly startedTeacherCount: number;
  readonly callerNoFilterId: number;
  readonly callerLanguageId: number;
  readonly benchSeededCallerCount: number;
  readonly selfCheck: boolean;
  readonly samplesPerCell: number;
  readonly warmupPerCell: number;
}

/** Facts about one volume's window step, for the report's windowing section. */
export interface BenchWindowRecord {
  readonly volume: number;
  readonly windowSize: number;
  readonly flippedOffline: number;
  readonly startedWithinWindow: number;
  readonly browsableEstimate: number;
}

/** Builds the gate list: one gate per gate-volume cell (skipped for self-check runs). */
export function buildBenchGates(records: readonly BenchCellRecord[], gateMs: number): GateResult[] {
  const gates: GateResult[] = [];
  for (const record of records) {
    if (!record.gateCell) {
      continue;
    }
    gates.push(
      evaluateGate(record.run.summary, {
        id: record.spec.id,
        p95MaxMs: gateMs,
        maxErrorCount: 0,
      })
    );
  }
  return gates;
}

function cellSummary(summary: PercentileSummary): Record<string, number> {
  return {
    count: summary.count,
    errorCount: summary.errorCount,
    p50: summary.p50,
    p95: summary.p95,
    p99: summary.p99,
    max: summary.max,
  };
}

/** Builds the report sections: environment, windowing, the full cell matrix, and the callers. */
export function buildBenchSections(
  facts: BenchReportFacts,
  windows: readonly BenchWindowRecord[],
  records: readonly BenchCellRecord[]
): Record<string, unknown> {
  return {
    environment: {
      database: facts.databaseName,
      seedRunId: facts.seedRunId,
      prefix: facts.prefix,
      eligibleCensus: facts.eligibleCensus,
      startedTeacherCount: facts.startedTeacherCount,
      gateVolume: GATE_VOLUME,
      selfCheck: facts.selfCheck,
      samplesPerCell: facts.samplesPerCell,
      warmupPerCell: facts.warmupPerCell,
      poolNote:
        "census and window are seed-run scoped; the live browse also sees any non-seed eligible rows in the shared test database",
    },
    windowing: windows,
    callers: {
      noFilterCallerId: facts.callerNoFilterId,
      languageCallerId: facts.callerLanguageId,
      benchSeededCallerCount: facts.benchSeededCallerCount,
    },
    matrix: records.map(record => ({
      id: record.spec.id,
      volume: record.spec.volume,
      sort: record.spec.sortToken,
      variant: record.spec.variantToken,
      caller: record.spec.caller,
      gateCell: record.gateCell,
      ...cellSummary(record.run.summary),
      totalMin: record.run.totalMin,
      totalMax: record.run.totalMax,
      errorCodes: record.run.errorCodes,
    })),
  };
}

/** The run-echo argument block persisted into both report files. */
export interface BenchReportArgs {
  readonly volumes: string;
  readonly samples: number;
  readonly warmup: number;
  readonly gateMs: number;
  readonly selfCheck: boolean;
}

/** Everything the entrypoint needs to persist and print once the matrix is done. */
export interface AssembledBenchReport {
  readonly gates: GateResult[];
  readonly sections: Record<string, unknown>;
  readonly args: BenchReportArgs;
}

/**
 * Assembles the run's gates, report sections, and argument echo from the
 * matrix results and run facts. Gate cells are exactly the gate-volume
 * cells; a self-check run contributes none.
 */
export function assembleBenchReport(
  facts: BenchReportFacts,
  windows: readonly BenchWindowRecord[],
  records: readonly BenchCellRecord[],
  volumesArg: string,
  gateMs: number
): AssembledBenchReport {
  return {
    gates: buildBenchGates(records, gateMs),
    sections: buildBenchSections(facts, windows, records),
    args: {
      volumes: volumesArg,
      samples: facts.samplesPerCell,
      warmup: facts.warmupPerCell,
      gateMs,
      selfCheck: facts.selfCheck,
    },
  };
}

/** Builds the operator summary lines printed to the terminal. */
export function buildBenchSummaryLines(
  facts: BenchReportFacts,
  windows: readonly BenchWindowRecord[],
  cellCount: number,
  runDir: string
): string[] {
  const lines: string[] = [
    `perf:bench-matching: database ${facts.databaseName}, seed run ${facts.seedRunId} (prefix ${facts.prefix})`,
    `perf:bench-matching: eligible teacher census: ${facts.eligibleCensus} (seed-run scoped); started-session teachers: ${facts.startedTeacherCount}`,
    `perf:bench-matching: callers: no-filter #${facts.callerNoFilterId}, language #${facts.callerLanguageId} (bench-seeded: ${facts.benchSeededCallerCount})`,
  ];
  for (const window of windows) {
    lines.push(
      `perf:bench-matching: volume ${window.volume}: window ${window.windowSize} (flipped offline: ${window.flippedOffline}, ` +
        `started within window: ${window.startedWithinWindow}, browsable estimate: ${window.browsableEstimate})` +
        (window.volume === GATE_VOLUME ? " [gate volume]" : "")
    );
  }
  lines.push(
    `perf:bench-matching: cells: ${cellCount}, samples per cell: ${facts.samplesPerCell} (warmup ${facts.warmupPerCell})`
  );
  lines.push(`perf:bench-matching: report: ${runDir}`);
  return lines;
}
