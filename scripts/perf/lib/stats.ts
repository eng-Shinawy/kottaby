/**
 * Latency sample statistics for the performance harness library.
 *
 * Pure, dependency-free measurement math: nearest-rank percentiles over
 * observed latency samples plus pass/fail gate evaluation against configured
 * thresholds. Nothing here touches the filesystem, the network, or the
 * database, so every function is safe to call concurrently from any harness
 * loop.
 */

/** One observed request/operation outcome. */
export interface LatencySample {
  scenarioId: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
}

/** Nearest-rank percentile summary over a sample set. */
export interface PercentileSummary {
  count: number;
  errorCount: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** Upper bounds a gate enforces. At least one bound must be set. */
export interface GateThreshold {
  id: string;
  p95MaxMs?: number;
  maxErrorCount?: number;
}

/** Outcome of evaluating one gate against one summary. */
export interface GateResult {
  id: string;
  passed: boolean;
  observed: Partial<PercentileSummary>;
  breaches: string[];
}

/** Raised for malformed samples or thresholds; harnesses surface it as a usage error. */
export class PerfStatsError extends Error {}

function assertValidSample(sample: LatencySample, index: number): void {
  if (typeof sample.durationMs !== "number" || !Number.isFinite(sample.durationMs)) {
    throw new PerfStatsError(`sample ${index} (${sample.scenarioId}) has a non-finite durationMs`);
  }
  if (sample.durationMs < 0) {
    throw new PerfStatsError(`sample ${index} (${sample.scenarioId}) has a negative durationMs`);
  }
}

function assertValidThreshold(threshold: GateThreshold): void {
  if (threshold.p95MaxMs === undefined && threshold.maxErrorCount === undefined) {
    throw new PerfStatsError(`gate "${threshold.id}" defines neither p95MaxMs nor maxErrorCount`);
  }
  if (threshold.p95MaxMs !== undefined && (!Number.isFinite(threshold.p95MaxMs) || threshold.p95MaxMs < 0)) {
    throw new PerfStatsError(`gate "${threshold.id}" has an invalid p95MaxMs`);
  }
  if (
    threshold.maxErrorCount !== undefined &&
    (!Number.isInteger(threshold.maxErrorCount) || threshold.maxErrorCount < 0)
  ) {
    throw new PerfStatsError(`gate "${threshold.id}" has an invalid maxErrorCount`);
  }
}

function rankFromSorted(sorted: readonly number[], percentile: number): number {
  // Integer-first math with an epsilon snap: `(p/100)*n` suffers upward
  // float drift at exact boundaries (e.g. p=99.9, n=1000), which would
  // silently promote the rank past the mathematical ceil(p*n/100).
  const rank = Math.ceil((percentile * sorted.length) / 100 - 1e-9);
  return sorted[rank - 1] ?? sorted[sorted.length - 1] ?? 0;
}

/**
 * Nearest-rank percentile (deterministic, no interpolation): the p-th
 * percentile is the smallest value whose rank is ceil(p/100 * n) in the
 * ascending-sorted values. `percentile` must lie in (0, 100]; 100 yields the
 * maximum. The input array is never mutated.
 */
export function nearestRankPercentile(values: readonly number[], percentile: number): number {
  if (values.length === 0) {
    throw new PerfStatsError("percentile of an empty value set is undefined");
  }
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 100) {
    throw new PerfStatsError(`percentile must be a number in (0, 100], got ${String(percentile)}`);
  }
  const sorted = [...values].toSorted((a, b) => a - b);
  return rankFromSorted(sorted, percentile);
}

/**
 * Summarizes latency samples. Percentiles are computed over the durations of
 * ALL samples (successful and failed alike) using the nearest-rank method;
 * failed samples are additionally counted in `errorCount`. An empty sample set
 * summarizes to all zeros. A sample with a non-finite or negative duration is
 * rejected (throws) rather than silently corrupting the summary.
 */
export function summarizeSamples(samples: readonly LatencySample[]): PercentileSummary {
  for (let index = 0; index < samples.length; index += 1) {
    assertValidSample(samples[index], index);
  }
  const count = samples.length;
  if (count === 0) {
    return { count: 0, errorCount: 0, p50: 0, p95: 0, p99: 0, max: 0 };
  }
  const sortedDurations = samples.map(sample => sample.durationMs).toSorted((a, b) => a - b);
  let errorCount = 0;
  for (const sample of samples) {
    if (!sample.ok) errorCount += 1;
  }
  return {
    count,
    errorCount,
    p50: rankFromSorted(sortedDurations, 50),
    p95: rankFromSorted(sortedDurations, 95),
    p99: rankFromSorted(sortedDurations, 99),
    max: sortedDurations[count - 1] ?? 0,
  };
}

/**
 * Evaluates a gate against a summary. Contract:
 *  - the p95 gate is strict: p95 < p95MaxMs passes, p95 exactly at the limit
 *    FAILS;
 *  - the error-count gate is inclusive: errorCount <= maxErrorCount passes;
 *  - a latency-bounded gate over zero collected samples fails closed (an
 *    unobserved gate is unverifiable, never a pass);
 *  - a threshold with no bounds at all is a configuration error.
 * `observed` carries exactly the summary fields the gate judged.
 */
export function evaluateGate(summary: PercentileSummary, threshold: GateThreshold): GateResult {
  assertValidThreshold(threshold);
  const breaches: string[] = [];
  const observed: Partial<PercentileSummary> = { count: summary.count };

  if (threshold.p95MaxMs !== undefined) {
    observed.p95 = summary.p95;
    if (summary.count === 0) {
      breaches.push("no samples collected — gate cannot be verified");
    } else if (summary.p95 >= threshold.p95MaxMs) {
      breaches.push(`p95 ${summary.p95}ms is not below the ${threshold.p95MaxMs}ms limit`);
    }
  }

  if (threshold.maxErrorCount !== undefined) {
    observed.errorCount = summary.errorCount;
    if (summary.errorCount > threshold.maxErrorCount) {
      breaches.push(`error count ${summary.errorCount} exceeds the maximum of ${threshold.maxErrorCount}`);
    }
  }

  return { id: threshold.id, passed: breaches.length === 0, observed, breaches };
}
