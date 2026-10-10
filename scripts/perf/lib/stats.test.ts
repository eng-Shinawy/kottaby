/**
 * Colocated bun:test suite for the harness statistics module.
 *
 * Pure unit tests — no DB, no network, no filesystem: exercises the
 * nearest-rank percentile math, the gate evaluation contract (including the
 * strict p95 boundary and the inclusive error-count boundary), fuzz/chaos
 * inputs (NaN/Infinity/negative durations), and huge sample arrays.
 */

import { describe, expect, test } from "bun:test";

import {
  evaluateGate,
  type GateThreshold,
  type LatencySample,
  nearestRankPercentile,
  PerfStatsError,
  summarizeSamples,
} from "@/scripts/perf/lib/stats";

function sample(durationMs: number, ok = true, scenarioId = "scenario-a"): LatencySample {
  return { scenarioId, durationMs, ok };
}

function summaryOfDurations(durations: number[]): LatencySample[] {
  return durations.map(duration => sample(duration));
}

/** Independent nearest-rank reference implementation (ceil(p*n/100), 1-based). */
function referencePercentile(values: number[], percentile: number): number {
  const sorted = [...values].toSorted((a, b) => a - b);
  const rank = Math.ceil((percentile * sorted.length) / 100);
  return sorted[rank - 1] ?? 0;
}

describe("stats: nearest-rank percentiles", () => {
  test("known distribution 1..100 yields p50=50, p95=95, p99=99", () => {
    const values = Array.from({ length: 100 }, (_unused, index) => index + 1);
    expect(nearestRankPercentile(values, 50)).toBe(50);
    expect(nearestRankPercentile(values, 95)).toBe(95);
    expect(nearestRankPercentile(values, 99)).toBe(99);
    expect(nearestRankPercentile(values, 100)).toBe(100);
  });

  test("boundary percentiles p100 (max) and a sub-1% rank on a large set", () => {
    const values = Array.from({ length: 1000 }, (_unused, index) => index);
    expect(nearestRankPercentile(values, 100)).toBe(999);
    // ceil(0.1/100 * 1000) = rank 1 → smallest value.
    expect(nearestRankPercentile(values, 0.1)).toBe(0);
    // ceil(99.9/100 * 1000) = rank 999 → second-largest.
    expect(nearestRankPercentile(values, 99.9)).toBe(998);
  });

  test("the input array is never mutated", () => {
    const values = [3, 1, 2];
    nearestRankPercentile(values, 50);
    expect(values).toEqual([3, 1, 2]);
  });

  test("invalid percentile arguments are rejected (p<=0, p>100, NaN)", () => {
    const values = [1, 2, 3];
    for (const bad of [0, -1, -0.5, 100.0001, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => nearestRankPercentile(values, bad)).toThrow(PerfStatsError);
    }
  });

  test("percentile of an empty value set is rejected, not defaulted", () => {
    expect(() => nearestRankPercentile([], 50)).toThrow(PerfStatsError);
  });
});

describe("stats: summarizeSamples", () => {
  test("summarizes a known mixed sample set (successes + errors)", () => {
    const samples: LatencySample[] = [
      sample(10),
      sample(20),
      sample(30, false, "scenario-b"),
      sample(40),
      sample(100),
      sample(200, false, "scenario-b"),
      sample(500),
    ];
    const summary = summarizeSamples(samples);
    expect(summary.count).toBe(7);
    expect(summary.errorCount).toBe(2);
    // Sorted durations: [10,20,30,40,100,200,500]
    // p50 rank ceil(0.5*7)=4 → 40 ; p95 rank ceil(0.95*7)=7 → 500 ; p99 same → 500.
    expect(summary.p50).toBe(40);
    expect(summary.p95).toBe(500);
    expect(summary.p99).toBe(500);
    expect(summary.max).toBe(500);
  });

  test("empty sample set summarizes to all zeros", () => {
    expect(summarizeSamples([])).toEqual({ count: 0, errorCount: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  test("single sample: every percentile equals the sample", () => {
    const summary = summarizeSamples([sample(7, false)]);
    expect(summary).toEqual({ count: 1, errorCount: 1, p50: 7, p95: 7, p99: 7, max: 7 });
  });

  test("zero-duration samples are valid observations", () => {
    const summary = summarizeSamples([sample(0), sample(0)]);
    expect(summary).toEqual({ count: 2, errorCount: 0, p50: 0, p95: 0, p99: 0, max: 0 });
  });

  test("non-finite and negative durations are rejected (fail closed, not crash)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -0.001, -42]) {
      expect(() => summarizeSamples([sample(1), sample(bad)])).toThrow(PerfStatsError);
      expect(() => summarizeSamples([sample(bad)])).toThrow(PerfStatsError);
    }
  });

  test("fuzz: randomized sample sets agree with the reference implementation", () => {
    let seed = 0x2f6e2b1;
    const nextRandom = (bound: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % bound;
    };
    for (let trial = 0; trial < 40; trial += 1) {
      const size = 1 + nextRandom(200);
      const samples: LatencySample[] = Array.from({ length: size }, (_unused, index) => {
        const ok = nextRandom(4) !== 0;
        return sample(nextRandom(10_000), ok, `scenario-${index % 5}`);
      });
      const summary = summarizeSamples(samples);
      const durations = samples.map(each => each.durationMs);
      expect(summary.count).toBe(size);
      expect(summary.errorCount).toBe(samples.filter(each => !each.ok).length);
      expect(summary.p50).toBe(referencePercentile(durations, 50));
      expect(summary.p95).toBe(referencePercentile(durations, 95));
      expect(summary.p99).toBe(referencePercentile(durations, 99));
      expect(summary.max).toBe(Math.max(...durations));
      expect(summary.p50).toBeLessThanOrEqual(summary.p95);
      expect(summary.p95).toBeLessThanOrEqual(summary.p99);
      expect(summary.p99).toBeLessThanOrEqual(summary.max);
    }
  });

  test("huge sample arrays (100k samples) summarize exactly", () => {
    const size = 100_000;
    const samples = Array.from({ length: size }, (_unused, index) => sample(index % 1_000));
    const summary = summarizeSamples(samples);
    expect(summary.count).toBe(size);
    expect(summary.errorCount).toBe(0);
    expect(summary.p50).toBe(
      referencePercentile(
        samples.map(each => each.durationMs),
        50
      )
    );
    expect(summary.max).toBe(999);
  });

  test("concurrent summarization calls stay independent (pure function)", async () => {
    const sets = [
      summaryOfDurations([1, 2, 3, 4]),
      summaryOfDurations([100, 200]),
      summaryOfDurations([50]),
      summaryOfDurations([5, 5, 5, 5, 5]),
    ];
    const settled = await Promise.allSettled(sets.map(each => Promise.resolve(summarizeSamples(each))));
    expect(settled).toHaveLength(4);
    for (const result of settled) expect(result.status).toBe("fulfilled");
    expect(summarizeSamples(sets[0] ?? [])).toEqual({ count: 4, errorCount: 0, p50: 2, p95: 4, p99: 4, max: 4 });
  });
});

describe("stats: evaluateGate", () => {
  const summary = summarizeSamples([
    sample(10),
    sample(20),
    sample(30),
    sample(40),
    sample(50),
    sample(60),
    sample(70),
    sample(80),
    sample(90),
    sample(91),
  ]);
  // Sorted 10..91 → p50 rank 5 → 50 ; p95 rank 10 → 91.

  test("a healthy gate passes and reports what it observed", () => {
    const result = evaluateGate(summary, { id: "gate-fast", p95MaxMs: 92 });
    expect(result).toEqual({
      id: "gate-fast",
      passed: true,
      observed: { count: summary.count, p95: summary.p95 },
      breaches: [],
    });
  });

  test("p95 exactly at the limit FAILS; strictly below passes", () => {
    expect(evaluateGate(summary, { id: "g", p95MaxMs: 91 }).passed).toBe(false);
    expect(evaluateGate(summary, { id: "g", p95MaxMs: 91.0001 }).passed).toBe(true);
  });

  test("p95 above the limit fails with an actionable breach message", () => {
    const result = evaluateGate(summary, { id: "gate-slow", p95MaxMs: 50 });
    expect(result.passed).toBe(false);
    expect(result.breaches).toEqual([`p95 ${summary.p95}ms is not below the 50ms limit`]);
    expect(result.observed).toEqual({ count: summary.count, p95: summary.p95 });
  });

  test("error count is inclusive at the boundary and fails one past it", () => {
    const withErrors = summarizeSamples([sample(1), sample(2), sample(3, false), sample(4, false)]);
    expect(evaluateGate(withErrors, { id: "g", maxErrorCount: 2 }).passed).toBe(true);
    expect(evaluateGate(withErrors, { id: "g", maxErrorCount: 1 }).passed).toBe(false);
    expect(evaluateGate(withErrors, { id: "g", maxErrorCount: 1 }).breaches).toEqual([
      "error count 2 exceeds the maximum of 1",
    ]);
  });

  test("both bounds are judged together and breaches accumulate", () => {
    const bad = summarizeSamples([sample(1, false), sample(1000, false)]);
    const result = evaluateGate(bad, { id: "both", p95MaxMs: 100, maxErrorCount: 0 });
    expect(result.passed).toBe(false);
    expect(result.breaches).toHaveLength(2);
    expect(result.observed).toEqual({ count: 2, p95: bad.p95, errorCount: 2 });
  });

  test("a latency-bounded gate over zero samples fails closed", () => {
    const empty = summarizeSamples([]);
    const result = evaluateGate(empty, { id: "g", p95MaxMs: 500 });
    expect(result.passed).toBe(false);
    expect(result.breaches).toEqual(["no samples collected — gate cannot be verified"]);
  });

  test("an error-bounded gate over zero samples passes (nothing errored)", () => {
    expect(evaluateGate(summarizeSamples([]), { id: "g", maxErrorCount: 0 }).passed).toBe(true);
  });

  test("a threshold with no bounds is a configuration error", () => {
    expect(() => evaluateGate(summary, { id: "g" })).toThrow(PerfStatsError);
    expect(() => evaluateGate(summary, { id: "g" })).toThrow(/neither p95MaxMs nor maxErrorCount/);
  });

  test("malformed bound values are rejected (NaN, negative, fractional error counts)", () => {
    const thresholds: GateThreshold[] = [
      { id: "g", p95MaxMs: Number.NaN },
      { id: "g", p95MaxMs: -1 },
      { id: "g", maxErrorCount: -1 },
      { id: "g", maxErrorCount: 1.5 },
      { id: "g", maxErrorCount: Number.POSITIVE_INFINITY },
    ];
    for (const threshold of thresholds) {
      expect(() => evaluateGate(summary, threshold)).toThrow(PerfStatsError);
    }
  });
});
