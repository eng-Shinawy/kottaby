/**
 * Measurement ledger for the API load harness: the response classifier
 * (transport error vs expected domain rejection vs success), the bounded
 * per-scenario latency tally (integer-millisecond histogram — incremental
 * aggregation, no per-request retention), the booking outcome accounting,
 * the per-scenario gate assembly through the shared stats evaluator, and
 * the pg_stat_activity peak tracker.
 */

import type { ApiScenario } from "@/scripts/perf/lib/api-scenarios";
import { evaluateGate, type GateResult, type GateThreshold, type PercentileSummary } from "@/scripts/perf/lib/stats";

/** Outcome class of one completed request attempt. */
export type OutcomeKind = "success" | "domain-rejection" | "transport-error";

/** Classified result of one request attempt (pure — no io anywhere). */
export interface ClassifiedOutcome {
  readonly kind: OutcomeKind;
  /** Machine code: extensions.code for domain rejections, http-<status>/network/malformed-response for transport errors. */
  readonly errorCode: string | null;
  /** The response's JSON body (already parsed by the io seam; null when unparsable). */
  readonly body: Record<string, unknown> | null;
}

/** Response facts the classifier consumes (io-agnostic, pure data). */
export interface ApiResponseFacts {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Record<string, unknown> | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstErrorCode(body: Record<string, unknown>): string {
  const errors: unknown = body.errors;
  if (!Array.isArray(errors) || errors.length === 0) {
    return "GRAPHQL_ERROR";
  }
  const first: unknown = errors[0];
  if (isRecord(first) && isRecord(first.extensions)) {
    const code: unknown = first.extensions.code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "GRAPHQL_ERROR";
}

/**
 * Classifies one response. Domain errors stay HTTP 200 with an errors[]
 * payload (the application's Apollo convention), so a translated rejection
 * — a forbidden admin read, an exhausted balance, a busy teacher — is an
 * EXPECTED business outcome, never a transport error. Only fetch rejections
 * (network) and non-2xx statuses are transport errors.
 */
export function classifyApiResponse(facts: ApiResponseFacts): ClassifiedOutcome {
  if (!facts.ok) {
    return { kind: "transport-error", errorCode: "network", body: facts.body };
  }
  if (facts.status < 200 || facts.status >= 300) {
    return { kind: "transport-error", errorCode: `http-${facts.status}`, body: facts.body };
  }
  if (facts.body === null) {
    return { kind: "transport-error", errorCode: "malformed-response", body: null };
  }
  if (Array.isArray(facts.body.errors) && facts.body.errors.length > 0) {
    return { kind: "domain-rejection", errorCode: firstErrorCode(facts.body), body: facts.body };
  }
  return { kind: "success", errorCode: null, body: facts.body };
}

/** Extracts the operation's data payload (null when absent — arrays are valid payloads). */
export function operationData(outcome: ClassifiedOutcome, operationName: string): unknown {
  if (outcome.body === null) {
    return null;
  }
  const data: unknown = outcome.body.data;
  if (!isRecord(data)) {
    return null;
  }
  const operation: unknown = data[operationName];
  return operation ?? null;
}

/** Latency recorded for one attempt (rounded to whole ms; NaN rejected). */
export interface LatencyObservation {
  readonly scenarioId: string;
  readonly durationMs: number;
  readonly ok: boolean;
  readonly errorCode: string | null;
}

/**
 * Bounded per-scenario latency tally. Latencies collapse into an
 * integer-millisecond histogram (size bounded by the distinct observed
 * values, not the request count) plus scalar counters; percentiles use the
 * shared integer-first nearest-rank math. Non-finite or negative durations
 * are invalid observations: excluded from percentiles, counted as errors.
 */
export class ScenarioLedger {
  private readonly histogram = new Map<number, number>();
  private total = 0;
  private errors = 0;
  private invalidLatency = 0;
  private readonly kinds = new Map<string, number>();
  private readonly codes = new Map<string, number>();

  constructor(readonly scenario: ApiScenario) {}

  /** Records one attempt's outcome + latency. */
  record(outcome: ClassifiedOutcome, durationMs: number): void {
    this.total += 1;
    const kind = this.classifyKind(outcome);
    this.kinds.set(kind, (this.kinds.get(kind) ?? 0) + 1);
    const codeKey = outcome.errorCode ?? "none";
    this.codes.set(codeKey, (this.codes.get(codeKey) ?? 0) + 1);
    if (this.isError(kind)) {
      this.errors += 1;
    }
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      this.invalidLatency += 1;
      return;
    }
    const bucket = Math.round(durationMs);
    this.histogram.set(bucket, (this.histogram.get(bucket) ?? 0) + 1);
  }

  /**
   * Refines the transport-level class with the payload-shape probe: a 2xx
   * no-errors response whose operation payload is missing violates the wire
   * contract (an honest empty list is a present array — only an absent or
   * nulled payload is a shape violation).
   */
  private classifyKind(outcome: ClassifiedOutcome): OutcomeKind | "unexpected-shape" {
    if (outcome.kind !== "success") {
      return outcome.kind;
    }
    return operationData(outcome, this.scenario.operationName) === null ? "unexpected-shape" : "success";
  }

  /** Errors are transport failures, contract violations, and rejections of scenarios that must succeed. */
  private isError(kind: OutcomeKind | "unexpected-shape"): boolean {
    return (
      kind === "transport-error" ||
      kind === "unexpected-shape" ||
      (kind === "domain-rejection" && this.scenario.expect.mustSucceed)
    );
  }

  /** Nearest-rank percentile over the histogram (integer-first rank math, ascending key walk). */
  private percentile(percentile: number): number {
    const count = this.sampleCount();
    if (count === 0) {
      return 0;
    }
    const rank = Math.ceil((percentile * count) / 100 - 1e-9);
    let remaining = rank;
    const keys = [...this.histogram.keys()].toSorted((a, b) => a - b);
    for (const key of keys) {
      remaining -= this.histogram.get(key) ?? 0;
      if (remaining <= 0) {
        return key;
      }
    }
    return keys[keys.length - 1] ?? 0;
  }

  /** Number of latency samples in the histogram (excludes invalid observations). */
  sampleCount(): number {
    let count = 0;
    for (const value of this.histogram.values()) {
      count += value;
    }
    return count;
  }

  /** Shared summary shape (percentiles over valid samples; errorCount from the taxonomy). */
  summary(): PercentileSummary {
    return {
      count: this.sampleCount(),
      errorCount: this.errors,
      p50: this.percentile(50),
      p95: this.percentile(95),
      p99: this.percentile(99),
      max: this.percentile(100),
    };
  }

  /** Per-kind outcome counts (success / domain-rejection / transport-error / unexpected-shape). */
  kindCounts(): Record<string, number> {
    return {
      success: this.kinds.get("success") ?? 0,
      "domain-rejection": this.kinds.get("domain-rejection") ?? 0,
      "transport-error": this.kinds.get("transport-error") ?? 0,
      "unexpected-shape": this.kinds.get("unexpected-shape") ?? 0,
    };
  }

  /** Per-error-code counts (the taxonomy lens — codes carry no secrets). */
  errorCodeCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [code, count] of this.codes) {
      if (code !== "none") {
        counts[code] = count;
      }
    }
    return counts;
  }

  /** Attempts whose measured latency was not a usable finite number. */
  invalidLatencyCount(): number {
    return this.invalidLatency;
  }

  /** Total attempts recorded (every class). */
  attemptCount(): number {
    return this.total;
  }

  /** Distinct histogram buckets (the bounded-memory proof surface). */
  histogramSize(): number {
    return this.histogram.size;
  }
}

/**
 * Builds one gate per active scenario: p95 strictly below the configured
 * ceiling AND zero errors (transport errors, unexpected shapes, and domain
 * rejections on scenarios that must succeed — the probe scenario's
 * translated rejections stay valid outcomes, never errors).
 */
export function buildLoadApiGates(ledgers: readonly ScenarioLedger[], gateMs: number): GateResult[] {
  const gates: GateResult[] = [];
  for (const ledger of ledgers) {
    const threshold: GateThreshold = { id: `scenario-${ledger.scenario.id}`, p95MaxMs: gateMs, maxErrorCount: 0 };
    gates.push(evaluateGate(ledger.summary(), threshold));
  }
  return gates;
}

/** One pg_stat_activity snapshot observation (rows already truncated by the io seam). */
export interface PgActivitySnapshot {
  readonly takenAtMs: number;
  readonly rows: readonly Record<string, unknown>[];
  readonly nonIdleCount: number;
}

/** Retains the peak snapshot (most non-idle connections) of the window. */
export class PgActivityTracker {
  private peak: PgActivitySnapshot | null = null;
  private samples = 0;
  private failures = 0;

  observe(snapshot: PgActivitySnapshot | null): void {
    if (snapshot === null) {
      this.failures += 1;
      return;
    }
    this.samples += 1;
    if (this.peak === null || snapshot.nonIdleCount >= this.peak.nonIdleCount) {
      this.peak = snapshot;
    }
  }

  peakSnapshot(): PgActivitySnapshot | null {
    return this.peak;
  }

  sampleCount(): number {
    return this.samples;
  }

  failureCount(): number {
    return this.failures;
  }
}

/** Booking-scenario outcome accounting (created | translated-domain-rejection | transport-error | unexplained shape). */
export function bookingOutcomes(ledger: ScenarioLedger): Record<string, number> {
  const kinds = ledger.kindCounts();
  return {
    created: kinds.success,
    "translated-domain-rejection": kinds["domain-rejection"],
    "transport-error": kinds["transport-error"],
    "unexpected-shape": kinds["unexpected-shape"],
  };
}
