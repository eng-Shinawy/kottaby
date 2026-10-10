/**
 * Orchestrator for the WebSocket stability harness.
 *
 * Sequences one full run over the injected io seams: destructive-target
 * guard first, environment/manifest refusals before any run directory
 * exists, real session minting per identity, then — once the report opens —
 * the ramped connection opens, the stability window (liveness + fan-out
 * bursts), teardown, resource release, and the gate/verdict emission. Any
 * mid-run failure is captured into a partial report instead of crashing.
 */

import { WS_MISSED_PONG_LIMIT, WS_PING_INTERVAL_MS } from "@/backend/ws/notification-ws-server-constants";
import type { LoadWsCliOptions } from "@/scripts/perf/lib/load-ws-cli";
import {
  LoadWsRefusalError,
  type WsIdentitySession,
  type WsLoadEnv,
  type WsLoadIo,
  type WsRunOutcome,
} from "@/scripts/perf/lib/load-ws-io";
import {
  buildLoadWsGates,
  buildLoadWsReportSections,
  type ConnectionSummary,
  classifyCloseCode,
  type DropFact,
  type HandshakeFailureFact,
  type LoadWsRunFacts,
  summarizeBurstDelivery,
} from "@/scripts/perf/lib/load-ws-ledger";
import {
  assignConnectionIdentities,
  buildSoakCommand,
  FANOUT_P95_GATE_MS,
  LoadWsPlanError,
} from "@/scripts/perf/lib/load-ws-plan";
import { createRunState, errorMessage, type RunState } from "@/scripts/perf/lib/load-ws-state";
import {
  ensureSidecar,
  openConnectionTask,
  releaseRunResources,
  runStabilityWindow,
  teardownConnections,
} from "@/scripts/perf/lib/load-ws-tasks";
import { buildRunPassword } from "@/scripts/perf/lib/seed-random";

/** Fail-closed environment refusals mirroring the sidecar entry's own messaging. */
function assertHarnessEnvironment(env: WsLoadEnv): void {
  if (env.transport === "in-process") {
    throw new LoadWsRefusalError(
      "the WebSocket stability harness requires the Redis bus: NOTIFICATION_FANOUT_TRANSPORT resolved to " +
        '"in-process", but fan-out published by the harness would never reach the sidecar process. ' +
        "Set REDIS_URL (or NOTIFICATION_FANOUT_TRANSPORT=redis) — see docs/notifications/realtime-engine.md."
    );
  }
  if (env.redisUrl === undefined) {
    throw new LoadWsRefusalError(
      "REDIS_URL is not configured — the harness publishes fan-out bursts through the Redis bus the sidecar " +
        "subscribes to. Export REDIS_URL (e.g. REDIS_URL=redis://localhost:6379) and re-run."
    );
  }
  if (env.origin.length === 0) {
    throw new LoadWsRefusalError("the WebSocket origin allowlist resolved to an empty list — refusing to run");
  }
}

/** Resolves + validates the identity list the seed manifest provides. */
function resolveIdentities(
  env: WsLoadEnv,
  options: LoadWsCliOptions,
  seedRunId: string,
  available: readonly string[]
): readonly string[] {
  if (available.length === 0) {
    throw new LoadWsRefusalError(
      `the seed manifest for run "${seedRunId}" lists no websocket identities — run perf:seed first`
    );
  }
  if (available.length < options.identities) {
    throw new LoadWsRefusalError(
      `the seed manifest for run "${seedRunId}" lists only ${available.length} websocket identities — ` +
        `at most ${available.length} can be used (requested ${options.identities})`
    );
  }
  try {
    assignConnectionIdentities(options.connections, available.slice(0, options.identities), env.perUserCap);
  } catch (error) {
    if (error instanceof LoadWsPlanError) {
      throw new LoadWsRefusalError(error.message);
    }
    throw error;
  }
  return available.slice(0, options.identities);
}

/** Mints one real session per identity through the login mutation (parallel, all-or-nothing). */
async function mintSessions(
  io: WsLoadIo,
  options: LoadWsCliOptions,
  identities: readonly string[],
  seedRunId: string
): Promise<Map<string, WsIdentitySession>> {
  const password = buildRunPassword(seedRunId);
  let minted: { email: string; session: WsIdentitySession }[];
  try {
    minted = await Promise.all(
      identities.map(async email => ({ email, session: await io.mintSession(options.baseUrl, email, password) }))
    );
  } catch (error) {
    throw new LoadWsRefusalError(
      `session minting failed (the harness logs in through the real login mutation at ${options.baseUrl}; ` +
        `check the server is up and the seed run "${seedRunId}" is present): ${errorMessage(error)}`
    );
  }
  const sessions = new Map<string, WsIdentitySession>();
  for (const entry of minted) {
    sessions.set(entry.email, entry.session);
  }
  return sessions;
}

/** Reduces the run's records into the gate-judging facts. */
function collectRunFacts(state: RunState): LoadWsRunFacts {
  const baseline = state.windowStartMs || state.rampStartMs;
  const handshakeFailures: HandshakeFailureFact[] = [];
  const drops: DropFact[] = [];
  let unclosedSockets = 0;
  for (const record of state.connections) {
    if (record.openedAtMs === null) {
      handshakeFailures.push(
        record.handshakeFailure ?? {
          index: record.index,
          code: record.closeCode,
          label: classifyCloseCode(record.closeCode),
          detail: record.closeReason,
        }
      );
    } else if (
      record.closedAtMs !== null &&
      (state.teardownStartedAtMs === null || record.closedAtMs < state.teardownStartedAtMs)
    ) {
      drops.push({
        index: record.index,
        code: record.closeCode,
        label: classifyCloseCode(record.closeCode),
        atOffsetMs: Math.max(0, record.closedAtMs - baseline),
      });
    }
    if (record.socket?.isOpen()) {
      unclosedSockets += 1;
    }
  }
  return {
    connectionsRequested: state.options.connections,
    handshakeFailures,
    drops,
    livenessFailureIndexes: state.ledger.failureIndexes(),
    livenessMissedLimit: WS_MISSED_PONG_LIMIT,
    burstFacts: state.bursts.map(burst => summarizeBurstDelivery(burst.plan, burst.latencies, burst.publishError)),
    p95GateMs: FANOUT_P95_GATE_MS,
    postCloseDeliveries: state.postCloseDeliveries,
    unclosedSockets,
    abortedWithError: state.abortedWithError,
  };
}

/** Label for the sidecar resolution: reused, harness-booted, or never resolved. */
function describeSidecar(sidecar: RunState["sidecar"]): string {
  if (sidecar === null) {
    return "not-resolved";
  }
  return sidecar.spawned ? "booted-by-harness" : "external";
}

/** Per-connection report summaries (identity emails are synthetic seed data; cookies never appear). */
function resolveWindowEndMs(state: RunState): number {
  if (state.windowEndMs > 0) {
    return state.windowEndMs;
  }
  if (state.teardownStartedAtMs !== null) {
    return state.teardownStartedAtMs;
  }
  return state.io.now();
}

function connectionSummaries(state: RunState): ConnectionSummary[] {
  const endMs = resolveWindowEndMs(state);
  return state.connections.map(record => ({
    index: record.index,
    identity: record.email,
    userId: record.userId,
    openedAtMs: record.openedAtMs,
    closedAtMs: record.closedAtMs,
    closeCode: record.closeCode,
    closeLabel: classifyCloseCode(record.closeCode),
    uptimeMs: record.openedAtMs === null ? 0 : Math.max(0, (record.closedAtMs ?? endMs) - record.openedAtMs),
    reconnectAttempts: record.reconnectAttempts,
    livenessMisses: state.ledger.missesFor(record.index),
    deliveredBursts: state.bursts.filter(burst => burst.latencies.has(record.index)).length,
    extraMessages: record.extraMessages,
  }));
}

/** The environment echo section (env-seam facts; never secrets). */
function environmentSection(state: RunState): Record<string, unknown> {
  return {
    wsUrl: state.env.wsUrl,
    origin: state.env.origin,
    transport: state.env.transport,
    perUserConnectionCap: state.env.perUserCap,
    sidecar: describeSidecar(state.sidecar),
    seedRunId: state.seedRunId,
    identitiesUsed: state.identityEmails.length,
    connectionsRequested: state.options.connections,
    durationSeconds: state.options.durationS,
    ramp: state.options.rampSpec,
    fanoutBursts: state.options.fanoutBursts,
    pingIntervalMs: WS_PING_INTERVAL_MS,
    missedPongLimit: WS_MISSED_PONG_LIMIT,
    cookieHygiene: "minted cookies live in harness memory only — never logged, never reported",
    soakCommand: buildSoakCommand(3600),
  };
}

/**
 * Drives one complete harness run. Refusals (guard, environment, manifest,
 * minting) surface before any run directory exists; everything after the
 * report opens is captured into a partial report instead of crashing, and
 * the finally block always tears sockets, the harness-booted sidecar, and
 * the publish client down.
 */
export async function runLoadWs(options: LoadWsCliOptions, io: WsLoadIo): Promise<WsRunOutcome> {
  const env = io.env();
  io.assertTarget(env.databaseUrl, { forceFlag: options.forceProdShapedTarget });
  assertHarnessEnvironment(env);
  const manifest = io.selectManifest(options.runId);
  const identities = resolveIdentities(env, options, manifest.runId, manifest.wsIdentityEmails);
  const sessions = await mintSessions(io, options, identities, manifest.runId);
  const report = io.openReport({
    connections: options.connections,
    identities: options.identities,
    "duration-s": options.durationS,
    ramp: options.rampSpec,
    "fanout-bursts": options.fanoutBursts,
    "base-url": options.baseUrl,
    run: manifest.runId,
    "no-reconnect": options.noReconnect,
  });
  const state = createRunState({ io, options, env, seedRunId: manifest.runId, identities, sessions, report });
  try {
    await ensureSidecar(state);
    state.rampStartMs = io.now();
    await Promise.all(state.connections.map(record => openConnectionTask(state, record)));
    await runStabilityWindow(state);
  } catch (error) {
    state.abortedWithError = errorMessage(error);
    io.log(`perf:load-ws: run aborted: ${state.abortedWithError}`);
  } finally {
    await teardownConnections(state);
    await releaseRunResources(io, state);
  }
  const facts = collectRunFacts(state);
  const gates = buildLoadWsGates(facts);
  const sections = buildLoadWsReportSections({
    facts,
    connections: connectionSummaries(state),
    environment: environmentSection(state),
  });
  io.writeReport(report.runId, gates, sections);
  const passed = io.emitVerdict(gates);
  return { passed, runId: report.runId, runDir: report.runDir };
}
