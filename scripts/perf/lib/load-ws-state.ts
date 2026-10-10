/**
 * Shared run state for the WebSocket stability harness: the per-connection
 * and per-burst record shapes, the state bag every task operates on, the
 * state factory (identity assignment, ramp schedule, liveness ledger), the
 * drift-corrected clock helper, and the socket-listener wiring that feeds
 * the shared accounting.
 */

import { WS_MISSED_PONG_LIMIT } from "@/backend/ws/notification-ws-server-constants";
import type { LoadWsCliOptions } from "@/scripts/perf/lib/load-ws-cli";
import type { WsHarnessSocket, WsIdentitySession, WsLoadEnv, WsLoadIo } from "@/scripts/perf/lib/load-ws-io";
import {
  type BurstDeliveryPlan,
  ConnectionLivenessLedger,
  classifyCloseCode,
  type HandshakeFailureFact,
} from "@/scripts/perf/lib/load-ws-ledger";
import { assignConnectionIdentities, buildRampSchedule, parseDeliveredFrame } from "@/scripts/perf/lib/load-ws-plan";

/** One client connection's observed lifecycle (never re-opened once dropped). */
export interface ConnectionRecord {
  readonly index: number;
  readonly email: string;
  userId: number | null;
  socket: WsHarnessSocket | null;
  openedAtMs: number | null;
  closedAtMs: number | null;
  closeCode: number | null;
  closeReason: string;
  handshakeFailure: HandshakeFailureFact | null;
  reconnectAttempts: number;
  extraMessages: number;
}

/** One fan-out burst's delivery accounting. */
export interface BurstState {
  readonly plan: BurstDeliveryPlan;
  readonly latencies: Map<number, number>;
  publishError: string | null;
}

/** The mutable bag one run's tasks share (bounded by the connection count). */
export interface RunState {
  readonly io: WsLoadIo;
  readonly options: LoadWsCliOptions;
  readonly env: WsLoadEnv;
  readonly seedRunId: string;
  readonly identityEmails: readonly string[];
  readonly sessions: ReadonlyMap<string, WsIdentitySession>;
  readonly rampSchedule: readonly number[];
  readonly connections: ConnectionRecord[];
  readonly ledger: ConnectionLivenessLedger;
  readonly bursts: BurstState[];
  readonly burstById: Map<number, BurstState>;
  readonly report: { runId: string; runDir: string };
  rampStartMs: number;
  windowStartMs: number;
  windowEndMs: number;
  teardownStartedAtMs: number | null;
  postCloseDeliveries: number;
  sidecar: { readonly spawned: boolean; readonly stop: () => Promise<void> } | null;
  abortedWithError: string | null;
}

/** Sleeps until the io clock reaches `targetMs` (drift-corrected; never a negative wait). */
export async function waitUntil(io: WsLoadIo, targetMs: number): Promise<void> {
  const remaining = targetMs - io.now();
  if (remaining <= 0) {
    return;
  }
  await io.sleep(remaining);
  await waitUntil(io, targetMs);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Wires the socket listeners into the shared accounting (open/close/message). */
export function attachSocketListeners(state: RunState, record: ConnectionRecord, socket: WsHarnessSocket): void {
  socket.addOpenListener(() => {
    record.openedAtMs = state.io.now();
  });
  socket.addCloseListener((code, reason) => {
    record.closedAtMs = state.io.now();
    record.closeCode = code;
    record.closeReason = reason;
    if (record.openedAtMs === null && record.handshakeFailure === null) {
      record.handshakeFailure = { index: record.index, code, label: classifyCloseCode(code), detail: reason };
    }
  });
  socket.addMessageListener(wire => handleInboundFrame(state, record, wire));
}

/** Recognizes fan-out deliveries; foreign or duplicate frames never corrupt the accounting. */
function handleInboundFrame(state: RunState, record: ConnectionRecord, wire: string): void {
  const frame = parseDeliveredFrame(wire);
  const burst = frame === null ? undefined : state.burstById.get(frame.burstId);
  if (burst === undefined || burst.latencies.has(record.index)) {
    record.extraMessages += 1;
    return;
  }
  burst.latencies.set(record.index, Math.max(0, state.io.now() - burst.plan.publishedAtMs));
  if (state.teardownStartedAtMs !== null) {
    state.postCloseDeliveries += 1;
  }
}

/** Builds the shared run state: connections assigned round-robin over the identities. */
export function createRunState(params: {
  io: WsLoadIo;
  options: LoadWsCliOptions;
  env: WsLoadEnv;
  seedRunId: string;
  identities: readonly string[];
  sessions: ReadonlyMap<string, WsIdentitySession>;
  report: { runId: string; runDir: string };
}): RunState {
  const { io, options, env, seedRunId, identities, sessions, report } = params;
  const assignment = assignConnectionIdentities(options.connections, identities, env.perUserCap);
  const connections: ConnectionRecord[] = assignment.map((email, index) => ({
    index,
    email,
    userId: sessions.get(email)?.userId ?? null,
    socket: null,
    openedAtMs: null,
    closedAtMs: null,
    closeCode: null,
    closeReason: "",
    handshakeFailure: null,
    reconnectAttempts: 0,
    extraMessages: 0,
  }));
  return {
    io,
    options,
    env,
    seedRunId,
    identityEmails: identities,
    sessions,
    rampSchedule: buildRampSchedule(options.connections, options.ramp.burst, options.ramp.intervalMs),
    connections,
    ledger: new ConnectionLivenessLedger(WS_MISSED_PONG_LIMIT),
    bursts: [],
    burstById: new Map(),
    report,
    rampStartMs: 0,
    windowStartMs: 0,
    windowEndMs: 0,
    teardownStartedAtMs: null,
    postCloseDeliveries: 0,
    sidecar: null,
    abortedWithError: null,
  };
}
