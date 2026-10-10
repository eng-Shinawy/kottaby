/**
 * Orchestrator for the API load harness.
 *
 * Sequences one full run over the injected io seams: destructive-target
 * guard first, seed-manifest and identity refusals before any server or
 * run directory exists, then the application server (booted by the harness
 * or reused via --base-url), the per-VU session minting, the teacher-pool
 * harvest, and — once the report opens — the ramped VU window with the
 * pg_stat_activity sampler, the gate evaluation, and the verdict emission.
 * The harness-booted server is stopped on every exit path; any mid-window
 * failure is captured into a partial report instead of crashing.
 */

import { API_SCENARIOS } from "@/scripts/perf/lib/api-scenarios";
import type { LoadApiCliOptions } from "@/scripts/perf/lib/load-api-cli";
import { type ApiLoadIo, type ApiRunOutcome, LoadApiRefusalError } from "@/scripts/perf/lib/load-api-io";
import {
  bookingOutcomes,
  buildLoadApiGates,
  PgActivityTracker,
  ScenarioLedger,
} from "@/scripts/perf/lib/load-api-ledger";
import { assignVuIdentities, rampSpanMs, resolveScenarioWeights, type VuPlan } from "@/scripts/perf/lib/load-api-plan";
import { harvestTeacherIds, mintVuSessions, runWindow, type WindowState } from "@/scripts/perf/lib/load-api-window";

/** Resolves the active scenarios' ledgers after weight overrides (zero-weight scenarios are excluded). */
function createLedgers(weights: ReadonlyMap<string, number>): Map<string, ScenarioLedger> {
  const ledgers = new Map<string, ScenarioLedger>();
  for (const scenario of API_SCENARIOS) {
    if ((weights.get(scenario.id) ?? 0) > 0) {
      ledgers.set(scenario.id, new ScenarioLedger(scenario));
    }
  }
  return ledgers;
}

function argsEcho(options: LoadApiCliOptions, seedRunId: string): Record<string, string | number | boolean> {
  return {
    vus: options.vus,
    "duration-s": options.durationS,
    ramp: options.rampSpec,
    "gate-ms": options.gateMs,
    "base-url": options.baseUrl ?? "(harness-booted)",
    weights: options.weightsSpec ?? "(registry defaults)",
    run: seedRunId,
    "self-check": options.selfCheck,
  };
}

/** The environment echo section (env-seam facts; never secrets). */
function environmentSection(
  options: LoadApiCliOptions,
  env: { serverMode: string; bootPort: number; seedRunId: string },
  server: { baseUrl: string; spawned: boolean },
  weights: ReadonlyMap<string, number>
): Record<string, unknown> {
  return {
    serverMode: env.serverMode,
    server: server.spawned ? "booted-by-harness" : "external (--base-url)",
    baseUrl: server.baseUrl,
    bootPort: env.bootPort,
    seedRunId: env.seedRunId,
    vus: options.vus,
    durationSeconds: options.durationS,
    ramp: options.rampSpec,
    gateMs: options.gateMs,
    selfCheck: options.selfCheck,
    weights: Object.fromEntries(weights),
    cookieHygiene: "minted cookies live in harness memory only — never logged, never reported",
  };
}

/** Per-scenario report rows: summary, throughput, taxonomy, booking outcomes. */
function scenarioRows(
  ledgers: readonly ScenarioLedger[],
  weights: ReadonlyMap<string, number>,
  windowSeconds: number
): Record<string, unknown>[] {
  return ledgers.map(ledger => ({
    id: ledger.scenario.id,
    role: ledger.scenario.role,
    weight: weights.get(ledger.scenario.id) ?? ledger.scenario.weight,
    attempts: ledger.attemptCount(),
    throughputPerSecond: windowSeconds > 0 ? ledger.attemptCount() / windowSeconds : 0,
    summary: ledger.summary(),
    outcomes: ledger.kindCounts(),
    errorCodes: ledger.errorCodeCounts(),
    invalidLatencyCount: ledger.invalidLatencyCount(),
    booking: ledger.scenario.id === "book-session" ? bookingOutcomes(ledger) : undefined,
  }));
}

/** The pg_stat_activity section: peak stats always, full peak rows only on a FAIL verdict. */
function pgSection(tracker: PgActivityTracker, includeRows: boolean): Record<string, unknown> {
  const peak = tracker.peakSnapshot();
  return {
    samples: tracker.sampleCount(),
    readFailures: tracker.failureCount(),
    peakNonIdleConnections: peak?.nonIdleCount ?? 0,
    peakRows: includeRows ? (peak?.rows ?? []) : "(retained; included only on a FAIL verdict)",
  };
}

/**
 * Drives one complete harness run. Refusals (guard, manifest, identities,
 * minting, harvest) surface before any run directory exists; everything
 * after the report opens is captured into a partial report instead of
 * crashing, and the finally block always stops the harness-booted server.
 */
export async function runLoadApi(options: LoadApiCliOptions, io: ApiLoadIo): Promise<ApiRunOutcome> {
  const env = io.env();
  io.assertTarget(env.databaseUrl, { forceFlag: options.forceProdShapedTarget });
  const manifest = io.selectManifest(options.runId);
  const weights = resolveScenarioWeights(options.weightsSpec);
  let plans: readonly VuPlan[];
  try {
    plans = assignVuIdentities(
      options.vus,
      options.ramp,
      manifest.studentEmails,
      manifest.adminEmails,
      API_SCENARIOS,
      weights
    );
  } catch (error) {
    throw new LoadApiRefusalError(error instanceof Error ? error.message : String(error));
  }
  const server = await io.ensureServer(options.baseUrl);
  try {
    const sessions = await mintVuSessions(io, server.baseUrl, plans, manifest.runId);
    const studentUserIds = plans
      .filter(plan => plan.role === "student")
      .map(plan => sessions.get(plan.index)?.userId ?? 0)
      .filter(userId => userId > 0);
    const teacherIds = await harvestTeacherIds(io, server.baseUrl, sessions, plans);
    const report = io.openReport(argsEcho(options, manifest.runId));
    const windowStartMs = io.now();
    const state: WindowState = {
      io,
      options,
      baseUrl: server.baseUrl,
      seedRunId: manifest.runId,
      runId: report.runId,
      windowEndMs: windowStartMs + rampSpanMs(options.vus, options.ramp) + options.durationS * 1000,
      weights,
      ledgers: createLedgers(weights),
      vuFacts: [],
      pgTracker: new PgActivityTracker(),
      sessions,
      plans,
      teacherIds,
      studentUserIds,
      abortedWithError: null,
    };
    await runWindow(state);
    const windowMs = Math.max(1, io.now() - windowStartMs);
    const gates = options.selfCheck ? [] : buildLoadApiGates([...state.ledgers.values()], options.gateMs);
    const passed = gates.every(gate => gate.passed);
    const bookingLedger = state.ledgers.get("book-session");
    io.writeReport(report.runId, gates, {
      environment: environmentSection(
        options,
        { serverMode: env.serverMode, bootPort: env.bootPort, seedRunId: manifest.runId },
        server,
        weights
      ),
      scenarios: scenarioRows([...state.ledgers.values()], weights, windowMs / 1000),
      virtualUsers: state.vuFacts,
      errorTaxonomy: Object.fromEntries(
        [...state.ledgers.values()].map(ledger => [ledger.scenario.id, ledger.errorCodeCounts()])
      ),
      pgStatActivity: pgSection(state.pgTracker, !passed),
      serverDiedUnexpectedly: server.diedUnexpectedly(),
      abortedWithError: state.abortedWithError,
      bookingOutcomeAccounting:
        bookingLedger === undefined ? "(book-session not active)" : bookingOutcomes(bookingLedger),
    });
    const verdictPassed = io.emitVerdict(gates);
    return { passed: verdictPassed, runId: report.runId, runDir: report.runDir };
  } finally {
    await server.stop();
  }
}
