/**
 * Latency percentile helpers for the `scripts/load/` CLI tools.
 *
 * Percentiles use the nearest-rank method (the standard definition for
 * load-test reporting): the p-th percentile of N sorted samples is the
 * sample at rank `ceil(p/100 * N)`. Ties and tiny sample counts degrade
 * gracefully — one sample reports itself at every percentile.
 */

/** Summary of one latency sample set. */
export interface LatencySummary {
  readonly count: number;
  readonly rps: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly meanMs: number;
}

/** Nearest-rank percentile over ASCENDING-sorted samples. */
export function percentileOf(sortedSamples: readonly number[], p: number): number {
  if (sortedSamples.length === 0) {
    return 0;
  }
  const rank = Math.ceil((p / 100) * sortedSamples.length);
  const clamped = Math.min(Math.max(rank, 1), sortedSamples.length);
  const sample = sortedSamples[clamped - 1];
  return sample ?? 0;
}

/**
 * Summarizes raw latency samples (milliseconds) over the observed wall
 * clock duration (seconds). `wallSeconds <= 0` yields `rps = 0` rather
 * than a divide-by-zero — a zero-length window carries no rate evidence.
 */
export function summarizeLatencies(samples: readonly number[], wallSeconds: number): LatencySummary {
  const sorted = [...samples].toSorted((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    rps: wallSeconds > 0 ? sorted.length / wallSeconds : 0,
    p50Ms: percentileOf(sorted, 50),
    p95Ms: percentileOf(sorted, 95),
    p99Ms: percentileOf(sorted, 99),
    minMs: sorted[0] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
    meanMs: sorted.length > 0 ? total / sorted.length : 0,
  };
}
