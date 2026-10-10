/**
 * Scheduled tasks for the WebSocket stability harness: the ramped
 * connection opens (each with its handshake-failure classification), the
 * in-window liveness observation rounds, the Redis-published fan-out bursts,
 * the sidecar boot/reuse decision, and the teardown + residue window. Every
 * task drift-corrects against the io clock instead of trusting timer
 * accuracy, and none of them ever re-opens a dropped connection.
 */

import { WS_PING_INTERVAL_MS } from "@/backend/ws/notification-ws-server-constants";
import type { WsLoadIo } from "@/scripts/perf/lib/load-ws-io";
import type { BurstDeliveryPlan } from "@/scripts/perf/lib/load-ws-ledger";
import {
  buildBurstIds,
  buildBurstSchedule,
  buildFanoutWire,
  NOTIFICATIONS_FANOUT_CHANNEL,
} from "@/scripts/perf/lib/load-ws-plan";
import {
  attachSocketListeners,
  type BurstState,
  type ConnectionRecord,
  errorMessage,
  type RunState,
  waitUntil,
} from "@/scripts/perf/lib/load-ws-state";

const HANDSHAKE_TIMEOUT_MS = 10_000;
const SIDECAR_BOOT_TIMEOUT_MS = 15_000;
const SIDECAR_PROBE_INTERVAL_MS = 500;
const CLOSE_SETTLE_TIMEOUT_MS = 2_000;
const RESIDUE_CHECK_MS = 2_000;

/** Opens one connection at its ramp offset and classifies a handshake that never settles. */
export async function openConnectionTask(state: RunState, record: ConnectionRecord): Promise<void> {
  const dueMs = state.rampStartMs + (state.rampSchedule[record.index] ?? 0);
  await waitUntil(state.io, dueMs);
  const session = state.sessions.get(record.email);
  if (session === undefined || state.abortedWithError !== null) {
    return;
  }
  const socket = state.io.openWebSocket(state.env.wsUrl, { origin: state.env.origin, cookie: session.cookieHeader });
  record.socket = socket;
  attachSocketListeners(state, record, socket);
  await waitUntil(state.io, dueMs + HANDSHAKE_TIMEOUT_MS);
  if (record.openedAtMs === null && record.closedAtMs === null) {
    record.handshakeFailure = {
      index: record.index,
      code: null,
      label: "handshake-timeout",
      detail: "no open or close event within the handshake window",
    };
  }
}

/** Liveness-check offsets inside the window (mirrors the sidecar's ping cadence). */
function buildLivenessSchedule(windowDurationMs: number, intervalMs: number): number[] {
  const offsets: number[] = [];
  for (let offset = intervalMs; offset < windowDurationMs; offset += intervalMs) {
    offsets.push(offset);
  }
  return offsets;
}

/** One liveness observation round over every live connection. */
async function livenessTickTask(state: RunState, offsetMs: number): Promise<void> {
  await waitUntil(state.io, state.windowStartMs + offsetMs);
  for (const record of state.connections) {
    if (record.openedAtMs !== null && record.closedAtMs === null) {
      state.ledger.recordTick(record.index, record.socket?.isOpen() ?? false);
    }
  }
}

/** Publishes one guard-valid fan-out burst to every live connection's user. */
async function fanoutBurstTask(state: RunState, burstId: number, offsetMs: number): Promise<void> {
  await waitUntil(state.io, state.windowStartMs + offsetMs);
  if (state.abortedWithError !== null) {
    return;
  }
  const live = state.connections.filter(record => record.openedAtMs !== null && record.closedAtMs === null);
  const userIds = [...new Set(live.map(record => record.userId ?? 0).filter(userId => userId > 0))];
  const plan: BurstDeliveryPlan = {
    burstId,
    publishedAtMs: state.io.now(),
    expectedConnectionIndexes: live.map(record => record.index),
  };
  const burst: BurstState = { plan, latencies: new Map<number, number>(), publishError: null };
  state.bursts.push(burst);
  state.burstById.set(burstId, burst);
  if (userIds.length === 0) {
    burst.publishError = "no live connections to deliver to";
    return;
  }
  const wire = buildFanoutWire(userIds, burstId, new Date(plan.publishedAtMs).toISOString());
  try {
    await state.io.publishFanout(NOTIFICATIONS_FANOUT_CHANNEL, wire);
  } catch (error) {
    burst.publishError = errorMessage(error);
  }
}

/** Runs the stability window: liveness ticks, fan-out bursts, window end. */
export async function runStabilityWindow(state: RunState): Promise<void> {
  state.windowStartMs = state.io.now();
  state.windowEndMs = state.windowStartMs + state.options.durationS * 1000;
  const windowDurationMs = state.options.durationS * 1000;
  const tasks: Array<Promise<void>> = [];
  for (const offset of buildLivenessSchedule(windowDurationMs, WS_PING_INTERVAL_MS)) {
    tasks.push(livenessTickTask(state, offset));
  }
  const burstIds = buildBurstIds(Math.max(1, Math.floor(state.windowStartMs)), state.options.fanoutBursts);
  const burstOffsets = buildBurstSchedule(windowDurationMs, state.options.fanoutBursts);
  for (let index = 0; index < burstIds.length; index += 1) {
    tasks.push(fanoutBurstTask(state, burstIds[index] ?? 0, burstOffsets[index] ?? windowDurationMs));
  }
  tasks.push(waitUntil(state.io, state.windowEndMs));
  await Promise.all(tasks);
}

/** Waits until the sidecar accepts connections, failing the boot window shut. */
async function waitForSidecar(state: RunState, deadlineMs: number): Promise<void> {
  if (await state.io.probeSidecarUp()) {
    return;
  }
  if (state.io.now() >= deadlineMs) {
    throw new Error("the sidecar did not start listening on the configured WS host/port within the boot window");
  }
  await state.io.sleep(SIDECAR_PROBE_INTERVAL_MS);
  await waitForSidecar(state, deadlineMs);
}

/** Reuses a listening sidecar or boots one (the harness owns its teardown). */
export async function ensureSidecar(state: RunState): Promise<void> {
  if (await state.io.probeSidecarUp()) {
    state.sidecar = { spawned: false, stop: async () => undefined };
    state.io.log("perf:load-ws: sidecar already listening — reusing it");
    return;
  }
  const handle = await state.io.startSidecar();
  state.sidecar = { spawned: true, stop: () => handle.stop() };
  state.io.log("perf:load-ws: no listener on the WS port — sidecar booted by the harness (torn down on exit)");
  await waitForSidecar(state, state.io.now() + SIDECAR_BOOT_TIMEOUT_MS);
}

/** Closes every open socket, waits for the close frames, then observes the residue window. */
export async function teardownConnections(state: RunState): Promise<void> {
  state.teardownStartedAtMs = state.io.now();
  for (const record of state.connections) {
    const socket = record.socket;
    if (socket?.isOpen()) {
      socket.close(1000, "harness teardown");
    }
  }
  await waitUntil(state.io, state.teardownStartedAtMs + CLOSE_SETTLE_TIMEOUT_MS);
  await state.io.sleep(RESIDUE_CHECK_MS);
}

/** Stops a harness-booted sidecar and closes the publish client on every exit path. */
export async function releaseRunResources(io: WsLoadIo, state: RunState): Promise<void> {
  const sidecar = state.sidecar;
  if (sidecar !== null) {
    try {
      await sidecar.stop();
    } catch (error) {
      io.log(`perf:load-ws: sidecar teardown failed: ${errorMessage(error)}`);
    }
  }
  try {
    await io.closePublisher();
  } catch (error) {
    io.log(`perf:load-ws: redis publish client close failed: ${errorMessage(error)}`);
  }
}
