/**
 * Accounting + gate assembly for the WebSocket stability harness.
 *
 * Pure bookkeeping over observed facts: the per-connection liveness ledger
 * (consecutive-miss tracking that mirrors the sidecar's missed-pong limit),
 * fan-out delivery summarization per burst, close-code classification using
 * the sidecar's documented vocabulary, and the final gate list the report
 * and verdict consume. No io, no clock, no network.
 */

import { evaluateGate, type GateResult, nearestRankPercentile } from "@/scripts/perf/lib/stats";

/** Documented close-code vocabulary of the sidecar plus the runtime's standard codes. */
const CLOSE_CODE_LABELS: ReadonlyMap<number, string> = new Map(
  Object.entries({
    4401: "unauthenticated",
    4429: "throttled",
    4009: "superseded",
    1013: "overloaded",
    1001: "shutdown",
    1000: "clean-close",
    1006: "abnormal",
  }).map(([code, label]) => [Number(code), label])
);

/** Human label for a close code (unknown codes stay numeric). */
export function classifyCloseCode(code: number | null): string {
  if (code === null) {
    return "no-close-code";
  }
  return CLOSE_CODE_LABELS.get(code) ?? `close-${code}`;
}

/**
 * Consecutive-miss liveness ledger, one entry per registered connection.
 * A tick with a live connection resets its streak; the limit mirrors the
 * sidecar's missed-pong termination threshold.
 */
export class ConnectionLivenessLedger {
  private readonly misses = new Map<number, number>();

  constructor(private readonly missedLimit: number) {}

  register(connectionIndex: number): void {
    this.misses.set(connectionIndex, 0);
  }

  /** Records one liveness observation; returns the current consecutive-miss streak. */
  recordTick(connectionIndex: number, isOpen: boolean): number {
    const next = isOpen ? 0 : (this.misses.get(connectionIndex) ?? 0) + 1;
    this.misses.set(connectionIndex, next);
    return next;
  }

  missesFor(connectionIndex: number): number {
    return this.misses.get(connectionIndex) ?? 0;
  }

  limitReached(connectionIndex: number): boolean {
    return this.missesFor(connectionIndex) >= this.missedLimit;
  }

  /** Every connection index whose consecutive-miss streak hit the limit. */
  failureIndexes(): number[] {
    const failures: number[] = [];
    for (const [index, streak] of this.misses) {
      if (streak >= this.missedLimit) {
        failures.push(index);
      }
    }
    return failures;
  }
}

/** What one fan-out burst intended: recipients and the publish instant. */
export interface BurstDeliveryPlan {
  readonly burstId: number;
  readonly publishedAtMs: number;
  readonly expectedConnectionIndexes: readonly number[];
}

/** Per-connection delivery latencies for one burst (connection index → latency ms). */
export type BurstLatencyMap = ReadonlyMap<number, number>;

/** Everything the delivery gate judges, per burst. */
export interface BurstDeliveryFacts {
  readonly burstId: number;
  readonly publishedAtMs: number;
  readonly expected: number;
  readonly delivered: number;
  readonly missingConnectionIndexes: readonly number[];
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
  readonly publishError: string | null;
}

/** Summarizes one burst's delivery accounting from its plan, latencies, and publish outcome. */
export function summarizeBurstDelivery(
  plan: BurstDeliveryPlan,
  latencies: BurstLatencyMap,
  publishError: string | null
): BurstDeliveryFacts {
  const deliveredIndexes = [...latencies.keys()];
  const missing = plan.expectedConnectionIndexes.filter(index => !latencies.has(index));
  const samples = [...latencies.values()];
  const p50 = samples.length > 0 ? nearestRankPercentile(samples, 50) : 0;
  const p95 = samples.length > 0 ? nearestRankPercentile(samples, 95) : 0;
  const p99 = samples.length > 0 ? nearestRankPercentile(samples, 99) : 0;
  const max = samples.length > 0 ? nearestRankPercentile(samples, 100) : 0;
  return {
    burstId: plan.burstId,
    publishedAtMs: plan.publishedAtMs,
    expected: plan.expectedConnectionIndexes.length,
    delivered: deliveredIndexes.length,
    missingConnectionIndexes: missing,
    p50,
    p95,
    p99,
    max,
    publishError,
  };
}

/** One handshake that never produced an open connection. */
export interface HandshakeFailureFact {
  readonly index: number;
  readonly code: number | null;
  readonly label: string;
  readonly detail: string;
}

/** One connection that closed during the observation window. */
export interface DropFact {
  readonly index: number;
  readonly code: number | null;
  readonly label: string;
  readonly atOffsetMs: number;
}

/** Everything the gate assembly judges. */
export interface LoadWsRunFacts {
  readonly connectionsRequested: number;
  readonly handshakeFailures: readonly HandshakeFailureFact[];
  readonly drops: readonly DropFact[];
  readonly livenessFailureIndexes: readonly number[];
  readonly livenessMissedLimit: number;
  readonly burstFacts: readonly BurstDeliveryFacts[];
  readonly p95GateMs: number;
  readonly postCloseDeliveries: number;
  readonly unclosedSockets: number;
  readonly abortedWithError: string | null;
}

function formatHandshakeFailure(failure: HandshakeFailureFact): string {
  const code = failure.code === null ? "" : ` [${failure.code}]`;
  return `connection ${failure.index} never opened (${failure.label}${code}): ${failure.detail}`;
}

function buildHandshakeGate(facts: LoadWsRunFacts): GateResult {
  const breaches = facts.handshakeFailures.map(formatHandshakeFailure);
  if (facts.connectionsRequested === 0) {
    breaches.push("no connections were requested — gate cannot be verified");
  }
  return { id: "handshake", passed: breaches.length === 0, observed: { count: facts.connectionsRequested }, breaches };
}

function buildStabilityGate(facts: LoadWsRunFacts): GateResult {
  const breaches = facts.drops.map(drop => `connection ${drop.index} dropped at ${drop.atOffsetMs}ms (${drop.label})`);
  return { id: "stability", passed: breaches.length === 0, observed: { count: facts.connectionsRequested }, breaches };
}

function buildLivenessGate(facts: LoadWsRunFacts): GateResult {
  const breaches = facts.livenessFailureIndexes.map(
    index => `connection ${index} missed ${facts.livenessMissedLimit} consecutive liveness checks`
  );
  return { id: "liveness", passed: breaches.length === 0, observed: { count: facts.connectionsRequested }, breaches };
}

function buildFanoutGate(facts: LoadWsRunFacts): GateResult {
  const breaches: string[] = [];
  let totalDelivered = 0;
  let totalMissing = 0;
  let widestP95 = 0;
  for (const burst of facts.burstFacts) {
    if (burst.publishError !== null) {
      breaches.push(`burst ${burst.burstId} could not be published: ${burst.publishError}`);
    }
    if (burst.missingConnectionIndexes.length > 0) {
      breaches.push(
        `burst ${burst.burstId}: ${burst.delivered}/${burst.expected} delivered ` +
          `(missing connections: ${burst.missingConnectionIndexes.join(", ")})`
      );
    }
    const gate = evaluateGate(
      {
        count: burst.delivered,
        errorCount: burst.missingConnectionIndexes.length,
        p50: burst.p50,
        p95: burst.p95,
        p99: burst.p99,
        max: burst.max,
      },
      { id: `fanout-burst-${burst.burstId}`, p95MaxMs: facts.p95GateMs, maxErrorCount: 0 }
    );
    breaches.push(...gate.breaches.map(breach => `burst ${burst.burstId}: ${breach}`));
    totalDelivered += burst.delivered;
    totalMissing += burst.missingConnectionIndexes.length;
    widestP95 = Math.max(widestP95, burst.p95);
  }
  if (facts.burstFacts.length === 0) {
    breaches.push("no fan-out bursts were scheduled — gate cannot be verified");
  }
  return {
    id: "fanout-delivery",
    passed: breaches.length === 0,
    observed: { count: totalDelivered, errorCount: totalMissing, p95: widestP95 },
    breaches,
  };
}

function buildAbortGate(facts: LoadWsRunFacts): GateResult | null {
  if (facts.abortedWithError === null) {
    return null;
  }
  return {
    id: "run-completed",
    passed: false,
    observed: {},
    breaches: [`the run aborted before completing: ${facts.abortedWithError}`],
  };
}

function buildResidueGate(facts: LoadWsRunFacts): GateResult {
  const breaches: string[] = [];
  if (facts.postCloseDeliveries > 0) {
    breaches.push(`${facts.postCloseDeliveries} fan-out deliveries arrived after teardown began`);
  }
  if (facts.unclosedSockets > 0) {
    breaches.push(`${facts.unclosedSockets} socket(s) were still open after teardown`);
  }
  return { id: "residue", passed: breaches.length === 0, observed: { count: facts.connectionsRequested }, breaches };
}

/**
 * Assembles the verdict gate list from the run's observed facts:
 * handshake completeness, in-window stability (zero drops), liveness
 * (no connection missed the limit of consecutive checks), fan-out delivery
 * (100% of live connections, p95 within budget), client-observable zero
 * residue, and — only when the run aborted mid-flight — run completion.
 */
export function buildLoadWsGates(facts: LoadWsRunFacts): GateResult[] {
  const gates = [
    buildHandshakeGate(facts),
    buildStabilityGate(facts),
    buildLivenessGate(facts),
    buildFanoutGate(facts),
    buildResidueGate(facts),
  ];
  const abortGate = buildAbortGate(facts);
  if (abortGate !== null) {
    gates.push(abortGate);
  }
  return gates;
}

/** One connection's client-observable lifecycle, report-shaped (no secrets ever). */
export interface ConnectionSummary {
  readonly index: number;
  readonly identity: string;
  readonly userId: number | null;
  readonly openedAtMs: number | null;
  readonly closedAtMs: number | null;
  readonly closeCode: number | null;
  readonly closeLabel: string;
  readonly uptimeMs: number;
  readonly reconnectAttempts: number;
  readonly livenessMisses: number;
  readonly deliveredBursts: number;
  readonly extraMessages: number;
}

/** Serializes the run's report sections (environment, per-connection, accounting). */
export function buildLoadWsReportSections(params: {
  readonly facts: LoadWsRunFacts;
  readonly connections: readonly ConnectionSummary[];
  readonly environment: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    environment: params.environment,
    connections: params.connections.map(connection => ({ ...connection })),
    liveness: {
      missedLimit: params.facts.livenessMissedLimit,
      failureIndexes: [...params.facts.livenessFailureIndexes],
    },
    fanout: params.facts.burstFacts.map(burst => ({
      ...burst,
      missingConnectionIndexes: [...burst.missingConnectionIndexes],
    })),
    drops: params.facts.drops.map(drop => ({ ...drop })),
    handshakeFailures: params.facts.handshakeFailures.map(failure => ({ ...failure })),
    residue: {
      postCloseDeliveries: params.facts.postCloseDeliveries,
      unclosedSockets: params.facts.unclosedSockets,
    },
  };
}
