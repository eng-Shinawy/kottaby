/**
 * `scripts/perf/load-ws.ts` — WebSocket stability harness suite.
 *
 * Pure unit posture: NO live sidecar, NO live Redis, NO live database — the
 * WebSocket and Redis seams are fakes, the clock is virtual (every sleep
 * advances it deterministically), and the sidecar's protocol constants are
 * consumed as the single source of truth. Tier map:
 *  - Tier 1: CLI contract, identity assignment (per-user cap invariant),
 *    bucket-honoring ramp, burst schedule, guard-valid envelopes (proven
 *    against the real runtime shape guard), delivery summarization,
 *    liveness accounting, gate assembly, full-run happy path.
 *  - Tier 2: 0 connections, identity floor/ceiling, cap math, duration 0,
 *    ramp boundaries (burst exactly 5), single connection, p95 exactly at
 *    the limit, fail-closed zero-delivery burst, empty/short identity
 *    lists, manifest selection edges.
 *  - Tier 3: post-open drops, Redis publish failure, message storms,
 *    duplicate frames, clock skew, 100 simultaneous deliveries, mid-run
 *    sidecar loss (clean partial report), sidecar boot failure, liveness
 *    misses through the window.
 *  - Tier 4: cookies never logged/reported, Origin always the allowlisted
 *    value, secrets absent from reports, invalid-cookie handshake yields a
 *    classified `4401` (never retried), guard-first refusal in a real
 *    subprocess with no run directory created.
 *
 * Runs via the mandated runner:
 * `bun run test/scripts/run-test.ts scripts/perf/load-ws.test.ts`
 */

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseFanoutEnvelope } from "@/backend/services/notifications/realtime/redis-pubsub-transport";
import {
  WS_HANDSHAKE_BUCKET_CAPACITY,
  WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS,
  WS_MISSED_PONG_LIMIT,
  WS_PING_INTERVAL_MS,
} from "@/backend/ws/notification-ws-server-constants";
import { isLoadWsCliUsageError, type LoadWsCliOptions, parseLoadWsCli } from "@/scripts/perf/lib/load-ws-cli";
import {
  LoadWsRefusalError,
  type WsHarnessSocket,
  type WsLoadEnv,
  type WsLoadIo,
  type WsSeedManifestSelection,
} from "@/scripts/perf/lib/load-ws-io";
import {
  type BurstDeliveryFacts,
  buildLoadWsGates,
  ConnectionLivenessLedger,
  classifyCloseCode,
  type LoadWsRunFacts,
  summarizeBurstDelivery,
} from "@/scripts/perf/lib/load-ws-ledger";
import {
  assignConnectionIdentities,
  buildBurstSchedule,
  buildFanoutWire,
  buildRampSchedule,
  FANOUT_P95_GATE_MS,
  LoadWsPlanError,
  NOTIFICATIONS_FANOUT_CHANNEL,
  parseDeliveredFrame,
} from "@/scripts/perf/lib/load-ws-plan";
import { runLoadWs } from "@/scripts/perf/lib/load-ws-run";
import { buildRunPassword } from "@/scripts/perf/lib/seed-random";
import type { GateResult } from "@/scripts/perf/lib/stats";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SEED_RUN_ID = "deadbeef";
const TEST_EMAILS: string[] = [];
for (let index = 0; index < 25; index += 1) {
  TEST_EMAILS.push(`perf_${SEED_RUN_ID}_student${String(index).padStart(6, "0")}@test.local`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A report section viewed as a record (empty when absent/malformed). */
function sectionRecord(sections: Record<string, unknown> | undefined, key: string): Record<string, unknown> {
  const value = sections?.[key];
  return isRecord(value) ? value : {};
}

/** A report section viewed as a record list (empty when absent/malformed). */
function sectionRecords(sections: Record<string, unknown> | undefined, key: string): Array<Record<string, unknown>> {
  const value = sections?.[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/** Records the rejection of an async call without the unsafe rejects matcher. */
async function captureRejection(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
  } catch (error) {
    return error;
  }
  return null;
}

/** Deterministic fake client socket: behavior is programmed per test. */
class FakeSocket implements WsHarnessSocket {
  openState = false;
  private readonly openHandlers: Array<() => void> = [];
  private readonly closeHandlers: Array<(code: number, reason: string) => void> = [];
  private readonly messageHandlers: Array<(data: string) => void> = [];

  addOpenListener(handler: () => void): void {
    this.openHandlers.push(handler);
  }

  addCloseListener(handler: (code: number, reason: string) => void): void {
    this.closeHandlers.push(handler);
  }

  addMessageListener(handler: (data: string) => void): void {
    this.messageHandlers.push(handler);
  }

  isOpen(): boolean {
    return this.openState;
  }

  close(code: number, reason: string): void {
    this.simulateClose(code, reason);
  }

  simulateOpen(): void {
    this.openState = true;
    for (const handler of this.openHandlers) {
      handler();
    }
  }

  simulateClose(code: number, reason: string): void {
    this.openState = false;
    for (const handler of this.closeHandlers) {
      handler(code, reason);
    }
  }

  simulateMessage(data: string): void {
    for (const handler of this.messageHandlers) {
      handler(data);
    }
  }
}

interface HandshakeRejection {
  readonly code: number;
  readonly reason: string;
}

interface FakeIoConfig {
  readonly env?: Partial<WsLoadEnv>;
  readonly manifest?: WsSeedManifestSelection;
  readonly bootProbe?: boolean;
  readonly startSidecarError?: Error;
  readonly publishError?: Error;
  readonly mintError?: Error;
  readonly deliveryLatencyMs?: number;
  readonly openLatencyMs?: number;
  readonly handshakeRejection?: (index: number) => HandshakeRejection | null;
  readonly script?: (socket: FakeSocket, index: number, io: FakeIo) => void;
}

/** Fake io with a virtual clock: every sleep advances time exactly. */
class FakeIo implements WsLoadIo {
  clockMs = 1_700_000_000_000;
  readonly logs: string[] = [];
  readonly openSocketCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  readonly sockets: FakeSocket[] = [];
  readonly publishCalls: Array<{ channel: string; wire: string }> = [];
  readonly mintCalls: Array<{ email: string; password: string }> = [];
  assertCalls = 0;
  assertForceFlags: boolean[] = [];
  sidecarStarts = 0;
  sidecarStops = 0;
  publisherClosed = 0;
  reportOpened = 0;
  reportArgs: Record<string, string | number | boolean> = {};
  reportWritten: { runId: string; gates: readonly GateResult[]; sections: Record<string, unknown> } | null = null;
  verdictEmitted = 0;
  private readonly config: FakeIoConfig;

  constructor(config: FakeIoConfig = {}) {
    this.config = config;
  }

  log(message: string): void {
    this.logs.push(message);
  }

  now(): number {
    return this.clockMs;
  }

  async sleep(ms: number): Promise<void> {
    this.clockMs += ms;
  }

  env(): WsLoadEnv {
    return {
      databaseUrl: "postgres://perf:secret@127.0.0.1:5432/kottaby_test",
      wsUrl: "ws://127.0.0.1:3101",
      origin: "http://localhost:3000",
      perUserCap: 5,
      redisUrl: "redis://default:secret@localhost:6379",
      transport: "redis",
      ...this.config.env,
    };
  }

  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): { dbName: string } {
    this.assertCalls += 1;
    this.assertForceFlags.push(opts.forceFlag);
    expect(databaseUrl).toBe("postgres://perf:secret@127.0.0.1:5432/kottaby_test");
    return { dbName: "kottaby_test" };
  }

  selectManifest(): WsSeedManifestSelection {
    return this.config.manifest ?? { runId: SEED_RUN_ID, wsIdentityEmails: TEST_EMAILS };
  }

  async mintSession(
    _baseUrl: string,
    email: string,
    password: string
  ): Promise<{ userId: number; cookieHeader: string }> {
    this.mintCalls.push({ email, password });
    const mintError = this.config.mintError;
    if (mintError !== undefined) {
      throw mintError;
    }
    const index = TEST_EMAILS.indexOf(email);
    return {
      userId: 5000 + Math.max(0, index),
      cookieHeader: `access_token=fake-jwt-${email}; refresh_token=fake-jwt-r`,
    };
  }

  openWebSocket(url: string, headers: Record<string, string>): WsHarnessSocket {
    const socket = new FakeSocket();
    const index = this.sockets.length;
    this.openSocketCalls.push({ url, headers });
    this.sockets.push(socket);
    const rejection = this.config.handshakeRejection?.(index) ?? null;
    if (rejection !== null) {
      void (async () => {
        await this.sleep(1);
        socket.simulateClose(rejection.code, rejection.reason);
      })();
      return socket;
    }
    this.config.script?.(socket, index, this);
    const openLatency = this.config.openLatencyMs ?? 5;
    void (async () => {
      await this.sleep(openLatency);
      socket.simulateOpen();
    })();
    return socket;
  }

  async publishFanout(channel: string, wire: string): Promise<void> {
    const publishError = this.config.publishError;
    if (publishError !== undefined) {
      throw publishError;
    }
    this.publishCalls.push({ channel, wire });
    const envelope: unknown = JSON.parse(wire);
    const payload = isRecord(envelope) ? envelope.payload : null;
    const frame = JSON.stringify(payload);
    const latency = this.config.deliveryLatencyMs ?? 50;
    const recipients = this.sockets.filter(socket => socket.openState);
    void (async () => {
      await this.sleep(latency);
      for (const socket of recipients) {
        if (socket.openState) {
          socket.simulateMessage(frame);
        }
      }
    })();
  }

  async closePublisher(): Promise<void> {
    this.publisherClosed += 1;
  }

  async probeSidecarUp(): Promise<boolean> {
    if (this.config.bootProbe === true) {
      return this.sidecarStarts > 0;
    }
    return true;
  }

  async startSidecar(): Promise<{ stop(): Promise<void> }> {
    const startError = this.config.startSidecarError;
    if (startError !== undefined) {
      throw startError;
    }
    this.sidecarStarts += 1;
    return {
      stop: async () => {
        this.sidecarStops += 1;
      },
    };
  }

  openReport(args: Record<string, string | number | boolean>): { runId: string; runDir: string } {
    this.reportOpened += 1;
    this.reportArgs = args;
    return { runId: "2026-10-09T00-00-00_load-ws", runDir: "logs/perf/2026-10-09T00-00-00_load-ws" };
  }

  writeReport(runId: string, gates: readonly GateResult[], sections: Record<string, unknown>): void {
    this.reportWritten = { runId, gates, sections };
  }

  emitVerdict(gates: readonly GateResult[]): boolean {
    this.verdictEmitted += 1;
    return gates.every(gate => gate.passed);
  }
}

/** Default-parsed options with per-test overrides. */
function testOptions(overrides: Partial<LoadWsCliOptions> = {}): LoadWsCliOptions {
  const parsed = parseLoadWsCli([]);
  if (isLoadWsCliUsageError(parsed)) {
    throw new Error("default CLI must parse");
  }
  return { ...parsed, ...overrides };
}

/** Full-report JSON for secret-absence assertions. */
function serializedReport(io: FakeIo): string {
  const written = io.reportWritten;
  expect(written).not.toBeNull();
  return JSON.stringify({ gates: written?.gates, sections: written?.sections });
}

function burstFact(partial: Partial<BurstDeliveryFacts>): BurstDeliveryFacts {
  return {
    burstId: 1,
    publishedAtMs: 0,
    expected: 2,
    delivered: 2,
    missingConnectionIndexes: [],
    p50: 50,
    p95: 100,
    p99: 120,
    max: 130,
    publishError: null,
    ...partial,
  };
}

function runFacts(partial: Partial<LoadWsRunFacts>): LoadWsRunFacts {
  return {
    connectionsRequested: 2,
    handshakeFailures: [],
    drops: [],
    livenessFailureIndexes: [],
    livenessMissedLimit: 2,
    burstFacts: [burstFact({})],
    p95GateMs: FANOUT_P95_GATE_MS,
    postCloseDeliveries: 0,
    unclosedSockets: 0,
    abortedWithError: null,
    ...partial,
  };
}

/** Writes one fixture manifest into a run directory shaped like logs/perf. */
function writeFixtureManifest(
  root: string,
  dirName: string,
  runId: string,
  completed: boolean,
  emailCount: number
): void {
  const dir = join(root, dirName);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const emails: string[] = [];
  for (let index = 0; index < emailCount; index += 1) {
    emails.push(`perf_${runId}_student${index}@test.local`);
  }
  writeFileSync(
    join(dir, "seed-manifest.json"),
    JSON.stringify({
      runId,
      prefix: `perf_${runId}_`,
      startedAt: "2026-10-09T00:00:00.000Z",
      completedAt: completed ? "2026-10-09T00:01:00.000Z" : null,
      tables: [],
      identities: { wsIdentityEmails: emails },
    })
  );
}

// ─── Tier 1: contract & branches ─────────────────────────────────────────────

describe("load-ws CLI (Tier 1)", () => {
  test("parses the documented defaults", () => {
    const parsed = parseLoadWsCli([]);
    expect(isLoadWsCliUsageError(parsed)).toBe(false);
    if (isLoadWsCliUsageError(parsed)) {
      return;
    }
    expect(parsed.connections).toBe(100);
    expect(parsed.identities).toBe(21);
    expect(parsed.durationS).toBe(300);
    expect(parsed.ramp).toEqual({ burst: 5, intervalMs: 2000 });
    expect(parsed.fanoutBursts).toBe(3);
    expect(parsed.baseUrl).toBe("http://127.0.0.1:3000/");
    expect(parsed.runId).toBeNull();
    expect(parsed.noReconnect).toBe(false);
    expect(parsed.forceProdShapedTarget).toBe(false);
  });

  test("the default ramp mirrors the sidecar handshake token bucket", () => {
    const parsed = parseLoadWsCli([]);
    expect(isLoadWsCliUsageError(parsed)).toBe(false);
    if (isLoadWsCliUsageError(parsed)) {
      return;
    }
    expect(parsed.ramp.burst).toBe(WS_HANDSHAKE_BUCKET_CAPACITY);
    expect(parsed.ramp.intervalMs).toBe(WS_HANDSHAKE_BUCKET_REFILL_INTERVAL_MS);
    expect(WS_PING_INTERVAL_MS).toBe(30_000);
    expect(WS_MISSED_PONG_LIMIT).toBe(2);
  });

  test("parses every value flag and the boolean flags", () => {
    const parsed = parseLoadWsCli([
      "--connections",
      "50",
      "--identities",
      "25",
      "--duration-s",
      "60",
      "--ramp",
      "3/500s",
      "--fanout-bursts",
      "1",
      "--base-url",
      "http://127.0.0.1:3100",
      "--run",
      "0badcafe",
      "--no-reconnect",
      "--force-prod-shaped-target",
    ]);
    expect(isLoadWsCliUsageError(parsed)).toBe(false);
    if (isLoadWsCliUsageError(parsed)) {
      return;
    }
    expect(parsed.connections).toBe(50);
    expect(parsed.identities).toBe(25);
    expect(parsed.durationS).toBe(60);
    expect(parsed.ramp).toEqual({ burst: 3, intervalMs: 500_000 });
    expect(parsed.fanoutBursts).toBe(1);
    expect(parsed.baseUrl).toBe("http://127.0.0.1:3100/");
    expect(parsed.runId).toBe("0badcafe");
    expect(parsed.noReconnect).toBe(true);
    expect(parsed.forceProdShapedTarget).toBe(true);
  });

  test("unknown flags produce the usage refusal shape listing accepted flags", () => {
    const parsed = parseLoadWsCli(["--bogus", "--connections", "5", "--nope"]);
    expect(isLoadWsCliUsageError(parsed)).toBe(true);
    if (!isLoadWsCliUsageError(parsed)) {
      return;
    }
    expect(parsed.unknownFlags).toEqual(["--bogus", "--nope"]);
    expect(parsed.message).toContain("unknown flag(s): --bogus, --nope");
    expect(parsed.message).toContain("accepted flags:");
    expect(parsed.message).toContain("--no-reconnect");
  });

  test("a value flag without a value is a usage error", () => {
    const parsed = parseLoadWsCli(["--connections"]);
    expect(isLoadWsCliUsageError(parsed)).toBe(true);
    expect(isLoadWsCliUsageError(parsed) ? parsed.message : "").toContain("--connections expects a value");
  });

  test("bare tokens are flag values, not unknown flags", () => {
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--connections", "5", "bare-value"]))).toBe(false);
  });

  test("the force flag reaches the destructive-target guard", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 1, durationS: 1, fanoutBursts: 0, forceProdShapedTarget: true }), io);
    expect(io.assertCalls).toBe(1);
    expect(io.assertForceFlags).toEqual([true]);
  });
});

describe("load-ws plan math (Tier 1)", () => {
  test("assigns identities round-robin within the per-user cap", () => {
    const identities = TEST_EMAILS.slice(0, 21);
    const assignment = assignConnectionIdentities(100, identities, 5);
    expect(assignment).toHaveLength(100);
    const perIdentity = new Map<string, number>();
    for (const email of assignment) {
      perIdentity.set(email, (perIdentity.get(email) ?? 0) + 1);
    }
    expect(perIdentity.size).toBe(21);
    for (const count of perIdentity.values()) {
      expect(count).toBeLessThanOrEqual(5);
    }
    expect(assignment[0]).toBe(identities[0]);
    expect(assignment[21]).toBe(identities[0]);
    expect(assignment[84]).toBe(identities[0]);
    expect(assignment[99]).toBe(identities[15]);
  });

  test("the ramp honors the bucket and spans >=190s for 100 connections", () => {
    const offsets = buildRampSchedule(100, 5, 2000);
    expect(offsets).toHaveLength(100);
    expect(offsets.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(offsets[5]).toBe(2250);
    expect(offsets[99] ?? 0).toBeGreaterThanOrEqual(190_000);
    for (let index = 6; index < 100; index += 1) {
      expect((offsets[index] ?? 0) - (offsets[index - 1] ?? 0)).toBe(2000);
    }
  });

  test("the burst schedule spaces bursts inside the window", () => {
    expect(buildBurstSchedule(300_000, 3)).toEqual([75_000, 150_000, 225_000]);
    expect(buildBurstSchedule(1_000, 1)).toEqual([500]);
    expect(buildBurstSchedule(300_000, 0)).toEqual([]);
  });

  test("fan-out envelopes pass the real runtime shape guard", () => {
    const wire = buildFanoutWire([5001, 5002, 5003], 4242, "2026-10-09T10:00:00.000Z");
    const envelope = parseFanoutEnvelope(wire);
    expect(envelope).not.toBeNull();
    expect(envelope?.userIds).toEqual([5001, 5002, 5003]);
    expect(envelope?.payload.data.id).toBe(4242);
    expect(envelope?.payload.data.type).toBe("system_broadcast");
  });

  test("the delivery frame recognizer accepts only notification frames", () => {
    const wire = buildFanoutWire([5001], 77, "2026-10-09T10:00:00.000Z");
    const parsed: unknown = JSON.parse(wire);
    const payload = isRecord(parsed) ? parsed.payload : null;
    expect(parseDeliveredFrame(JSON.stringify(payload))?.burstId).toBe(77);
    expect(parseDeliveredFrame("not json")).toBeNull();
    expect(parseDeliveredFrame('{"v":1,"kind":"other"}')).toBeNull();
    expect(parseDeliveredFrame('{"v":2,"kind":"notification","data":{"id":77}}')).toBeNull();
    expect(parseDeliveredFrame('{"v":1,"kind":"notification","data":{"id":"77"}}')).toBeNull();
  });

  test("burst delivery summarization computes nearest-rank percentiles and missing connections", () => {
    const latencies = new Map<number, number>();
    for (let index = 0; index < 99; index += 1) {
      latencies.set(index, 100 + index);
    }
    const facts = summarizeBurstDelivery(
      { burstId: 9, publishedAtMs: 5, expectedConnectionIndexes: [...Array(100).keys()] },
      latencies,
      null
    );
    expect(facts.delivered).toBe(99);
    expect(facts.expected).toBe(100);
    expect(facts.missingConnectionIndexes).toEqual([99]);
    expect(facts.p50).toBe(149);
    expect(facts.p95).toBe(194);
    expect(facts.max).toBe(198);
  });
});

describe("load-ws liveness + gates (Tier 1)", () => {
  test("close codes classify into the documented vocabulary", () => {
    expect(classifyCloseCode(4401)).toBe("unauthenticated");
    expect(classifyCloseCode(4429)).toBe("throttled");
    expect(classifyCloseCode(4009)).toBe("superseded");
    expect(classifyCloseCode(1013)).toBe("overloaded");
    expect(classifyCloseCode(1001)).toBe("shutdown");
    expect(classifyCloseCode(1000)).toBe("clean-close");
    expect(classifyCloseCode(1006)).toBe("abnormal");
    expect(classifyCloseCode(null)).toBe("no-close-code");
    expect(classifyCloseCode(4999)).toBe("close-4999");
  });

  test("the liveness ledger resets on live ticks and fails at exactly the limit", () => {
    const ledger = new ConnectionLivenessLedger(2);
    ledger.register(0);
    expect(ledger.recordTick(0, false)).toBe(1);
    expect(ledger.limitReached(0)).toBe(false);
    expect(ledger.recordTick(0, true)).toBe(0);
    expect(ledger.recordTick(0, false)).toBe(1);
    expect(ledger.recordTick(0, false)).toBe(2);
    expect(ledger.limitReached(0)).toBe(true);
    expect(ledger.failureIndexes()).toEqual([0]);
  });

  test("a clean facts set produces five passing gates", () => {
    const gates = buildLoadWsGates(runFacts({}));
    expect(gates.map(gate => gate.id)).toEqual(["handshake", "stability", "liveness", "fanout-delivery", "residue"]);
    expect(gates.every(gate => gate.passed)).toBe(true);
  });

  test("every gate branch produces its breach line", () => {
    const gates = buildLoadWsGates(
      runFacts({
        handshakeFailures: [{ index: 1, code: 4401, label: "unauthenticated", detail: "unauthenticated" }],
        drops: [{ index: 0, code: 1006, label: "abnormal", atOffsetMs: 1200 }],
        livenessFailureIndexes: [0],
        burstFacts: [
          burstFact({ expected: 1, delivered: 0, missingConnectionIndexes: [0], p50: 0, p95: 0, p99: 0, max: 0 }),
        ],
        postCloseDeliveries: 2,
        unclosedSockets: 1,
      })
    );
    const byId = new Map(gates.map(gate => [gate.id, gate]));
    expect(byId.get("handshake")?.passed).toBe(false);
    expect(byId.get("handshake")?.breaches[0]).toContain("4401");
    expect(byId.get("stability")?.passed).toBe(false);
    expect(byId.get("liveness")?.passed).toBe(false);
    expect(byId.get("fanout-delivery")?.passed).toBe(false);
    expect(byId.get("fanout-delivery")?.breaches.join(" ")).toContain("0/1 delivered");
    expect(byId.get("residue")?.passed).toBe(false);
    expect(byId.get("residue")?.breaches.join(" ")).toContain("2 fan-out deliveries");
  });

  test("an aborted run gains a run-completed gate", () => {
    const gates = buildLoadWsGates(runFacts({ abortedWithError: "sidecar lost" }));
    const abortGate = gates.find(gate => gate.id === "run-completed");
    expect(abortGate?.passed).toBe(false);
    expect(abortGate?.breaches.join(" ")).toContain("sidecar lost");
  });
});

describe("runLoadWs full lifecycle (Tier 1)", () => {
  test("a small clean run passes every gate end to end", async () => {
    const io = new FakeIo();
    const outcome = await runLoadWs(testOptions({ connections: 5, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    expect(io.assertCalls).toBe(1);
    expect(io.openSocketCalls).toHaveLength(5);
    expect(io.sockets.every(socket => !socket.isOpen())).toBe(true);
    expect(io.publishCalls).toHaveLength(1);
    expect(io.publishCalls[0]?.channel).toBe(NOTIFICATIONS_FANOUT_CHANNEL);
    expect(io.reportWritten?.gates.every(gate => gate.passed)).toBe(true);
    expect(io.verdictEmitted).toBe(1);
    expect(io.publisherClosed).toBe(1);
    expect(io.sidecarStarts).toBe(0);
  });

  test("the handshake carries the minted cookie and the allowlisted origin", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    for (const call of io.openSocketCalls) {
      expect(call.url).toBe("ws://127.0.0.1:3101");
      expect(call.headers.origin).toBe("http://localhost:3000");
      expect(call.headers.cookie).toContain("access_token=fake-jwt-");
    }
  });

  test("minting uses the seed run's derived per-run password", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 0 }), io);
    expect(io.mintCalls).toHaveLength(21);
    for (const call of io.mintCalls) {
      expect(call.password).toBe(buildRunPassword(SEED_RUN_ID));
    }
  });

  test("the report records uptime, reconnect attempts, and delivery per connection", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 3, durationS: 1, fanoutBursts: 1 }), io);
    const sections = io.reportWritten?.sections;
    const connections = sectionRecords(sections, "connections");
    expect(connections).toHaveLength(3);
    for (const connection of connections) {
      expect(typeof connection.uptimeMs).toBe("number");
      expect(connection.reconnectAttempts).toBe(0);
      expect(connection.deliveredBursts).toBe(1);
    }
    const fanout = sectionRecords(sections, "fanout");
    expect(fanout).toHaveLength(1);
    expect(fanout[0]?.delivered).toBe(3);
    expect(fanout[0]?.expected).toBe(3);
    const environment = sectionRecord(sections, "environment");
    expect(environment.soakCommand).toBe("bun run perf:load-ws --duration-s 3600");
    expect(environment.sidecar).toBe("external");
  });

  test("the harness boots the sidecar itself when nothing listens", async () => {
    const io = new FakeIo({ bootProbe: true });
    const outcome = await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    expect(io.sidecarStarts).toBe(1);
    expect(io.sidecarStops).toBe(1);
    const environment = sectionRecord(io.reportWritten?.sections, "environment");
    expect(environment.sidecar).toBe("booted-by-harness");
    expect(outcome.passed).toBe(true);
  });
});

// ─── Tier 2: boundaries ──────────────────────────────────────────────────────

describe("load-ws CLI boundaries (Tier 2)", () => {
  test("rejects zero connections and a zero-second window", () => {
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--connections", "0"]))).toBe(true);
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--duration-s", "0"]))).toBe(true);
  });

  test("rejects --identities 20 for a 100-connection run (identity floor + cap math)", () => {
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--identities", "20"]))).toBe(true);
    const capMath = parseLoadWsCli(["--identities", "21", "--connections", "106"]);
    expect(isLoadWsCliUsageError(capMath)).toBe(true);
    if (isLoadWsCliUsageError(capMath)) {
      expect(capMath.message).toContain("per-user cap math");
    }
  });

  test("rejects --identities above the seed manifest cap of 25", () => {
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--identities", "26"]))).toBe(true);
  });

  test("rejects malformed ramp specs and bad base urls and run ids", () => {
    for (const bad of ["5/2", "0/2s", "5/0s", "abc", "5/200000s"]) {
      expect(isLoadWsCliUsageError(parseLoadWsCli(["--ramp", bad]))).toBe(true);
    }
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--base-url", "example.test"]))).toBe(true);
    expect(isLoadWsCliUsageError(parseLoadWsCli(["--run", "nothex!"]))).toBe(true);
  });

  test("the ramp burst boundary is exactly five immediate connections", () => {
    expect(buildRampSchedule(5, 5, 2000)).toEqual([0, 0, 0, 0, 0]);
    expect(buildRampSchedule(6, 5, 2000)).toEqual([0, 0, 0, 0, 0, 2250]);
  });

  test("p95 exactly at the delivery budget fails; one millisecond below passes", () => {
    expect(
      buildLoadWsGates(runFacts({ burstFacts: [burstFact({ p50: 2000, p95: 2000, p99: 2000, max: 2000 })] })).every(
        gate => gate.passed
      )
    ).toBe(false);
    expect(
      buildLoadWsGates(runFacts({ burstFacts: [burstFact({ p50: 1999, p95: 1999, p99: 1999, max: 1999 })] })).every(
        gate => gate.passed
      )
    ).toBe(true);
  });

  test("a burst with zero deliveries fails closed", () => {
    const gate = buildLoadWsGates(
      runFacts({
        burstFacts: [burstFact({ delivered: 0, missingConnectionIndexes: [0, 1], p50: 0, p95: 0, p99: 0, max: 0 })],
      })
    ).find(candidate => candidate.id === "fanout-delivery");
    expect(gate?.passed).toBe(false);
    expect(gate?.breaches.join(" ")).toContain("no samples collected");
  });

  test("a zero-burst run cannot verify the fan-out gate (fail closed)", async () => {
    const io = new FakeIo();
    const outcome = await runLoadWs(testOptions({ connections: 1, durationS: 1, fanoutBursts: 0 }), io);
    expect(outcome.passed).toBe(false);
    expect(io.publishCalls).toHaveLength(0);
    const fanoutGate = io.reportWritten?.gates.find(gate => gate.id === "fanout-delivery");
    expect(fanoutGate?.passed).toBe(false);
    expect(fanoutGate?.breaches.join(" ")).toContain("no fan-out bursts were scheduled");
  });

  test("a single connection round-trips cleanly with one burst", async () => {
    const io = new FakeIo();
    const outcome = await runLoadWs(testOptions({ connections: 1, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    expect(io.openSocketCalls).toHaveLength(1);
    const fanout = sectionRecords(io.reportWritten?.sections, "fanout");
    expect(fanout[0]?.delivered).toBe(1);
  });
});

describe("identity + manifest boundaries (Tier 2)", () => {
  test("an empty identity list is a planning refusal", () => {
    expect(() => assignConnectionIdentities(5, [], 5)).toThrow(LoadWsPlanError);
  });

  test("more connections than identities x cap is a planning refusal", () => {
    expect(() => assignConnectionIdentities(26, TEST_EMAILS.slice(0, 5), 5)).toThrow(LoadWsPlanError);
  });

  test("the orchestrator refuses an empty manifest identity list before any report", async () => {
    const io = new FakeIo({ manifest: { runId: SEED_RUN_ID, wsIdentityEmails: [] } });
    const caught = await captureRejection(() => runLoadWs(testOptions({ connections: 5, durationS: 1 }), io));
    expect(caught).toBeInstanceOf(LoadWsRefusalError);
    expect(io.reportOpened).toBe(0);
    expect(io.openSocketCalls).toHaveLength(0);
  });

  test("the orchestrator refuses when the manifest lists fewer identities than requested", async () => {
    const io = new FakeIo({ manifest: { runId: SEED_RUN_ID, wsIdentityEmails: TEST_EMAILS.slice(0, 3) } });
    const caught = await captureRejection(() => runLoadWs(testOptions({ identities: 21 }), io));
    expect(caught instanceof Error ? caught.message : String(caught)).toMatch(/lists only 3 websocket identities/);
    expect(io.reportOpened).toBe(0);
  });

  test("manifest selection refuses missing runs, skips incomplete ones, and reads the newest", async () => {
    const { selectWsManifest } = await import("@/scripts/perf/load-ws");
    const root = mkdtempSync(join(tmpdir(), "load-ws-manifest-"));
    try {
      expect(() => selectWsManifest("cafe0001", root)).toThrow(/no seed manifest found for run/);
      expect(() => selectWsManifest(null, root)).toThrow(/no completed seed manifest found/);
      writeFixtureManifest(root, "2026-10-09T01-00-00_seed", "aaaa0001", true, 21);
      writeFixtureManifest(root, "2026-10-09T02-00-00_seed", "dddd0004", false, 5);
      writeFixtureManifest(root, "2026-10-09T03-00-00_seed", "bbbb0002", true, 22);
      const selected = selectWsManifest(null, root);
      expect(selected.runId).toBe("bbbb0002");
      expect(selected.wsIdentityEmails).toHaveLength(22);
      const byRun = selectWsManifest("aaaa0001", root);
      expect(byRun.runId).toBe("aaaa0001");
      expect(() => selectWsManifest("cccc0003", root)).toThrow(/no seed manifest found for run/);
      expect(() => selectWsManifest("dddd0004", root)).toThrow(/incomplete seed run/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ─── Tier 3: chaos ───────────────────────────────────────────────────────────

describe("runLoadWs under chaos (Tier 3)", () => {
  test("a post-open drop fails the stability gate, is never reconnected, and the burst still reaches the rest", async () => {
    const io = new FakeIo({
      script: (socket, index, fakeIo) => {
        if (index === 1) {
          socket.addOpenListener(() => {
            void (async () => {
              await fakeIo.sleep(1000);
              socket.simulateClose(1006, "abnormal closure");
            })();
          });
        }
      },
    });
    const outcome = await runLoadWs(testOptions({ connections: 5, durationS: 2, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(false);
    expect(io.openSocketCalls).toHaveLength(5);
    const stability = io.reportWritten?.gates.find(gate => gate.id === "stability");
    expect(stability?.passed).toBe(false);
    expect(stability?.breaches.join(" ")).toContain("connection 1 dropped");
    expect(stability?.breaches.join(" ")).toContain("abnormal");
    const drops = sectionRecords(io.reportWritten?.sections, "drops");
    expect(drops).toHaveLength(1);
    expect(drops[0]?.index).toBe(1);
    const fanoutGate = io.reportWritten?.gates.find(gate => gate.id === "fanout-delivery");
    expect(fanoutGate?.passed).toBe(true);
    const fanout = sectionRecords(io.reportWritten?.sections, "fanout");
    expect(fanout[0]?.delivered).toBe(4);
    expect(fanout[0]?.expected).toBe(4);
  });

  test("a Redis publish failure is classified, not fatal, and fails the gate", async () => {
    const io = new FakeIo({ publishError: new Error("connection lost to redis") });
    const outcome = await runLoadWs(testOptions({ connections: 3, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(false);
    const fanout = io.reportWritten?.gates.find(gate => gate.id === "fanout-delivery");
    expect(fanout?.passed).toBe(false);
    expect(fanout?.breaches.join(" ")).toContain("could not be published");
    expect(io.reportWritten).not.toBeNull();
  });

  test("a message storm of foreign frames never corrupts delivery accounting", async () => {
    const io = new FakeIo({
      script: socket => {
        socket.addOpenListener(() => {
          for (let round = 0; round < 50; round += 1) {
            socket.simulateMessage(`{"v":1,"kind":"noise","data":{"id":${round}}}`);
            socket.simulateMessage("garbage");
          }
        });
      },
    });
    const outcome = await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    const connections = sectionRecords(io.reportWritten?.sections, "connections");
    for (const connection of connections) {
      expect(connection.deliveredBursts).toBe(1);
      expect(connection.extraMessages).toBe(100);
    }
  });

  test("a duplicate delivery frame counts once and the duplicate lands in extraMessages", async () => {
    const io = new FakeIo({
      script: socket => {
        let echoed = false;
        socket.addMessageListener(data => {
          if (!echoed) {
            echoed = true;
            socket.simulateMessage(data);
          }
        });
      },
    });
    const outcome = await runLoadWs(testOptions({ connections: 1, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    const connections = sectionRecords(io.reportWritten?.sections, "connections");
    expect(connections[0]?.deliveredBursts).toBe(1);
    expect(connections[0]?.extraMessages).toBe(1);
  });

  test("clock skew (now jumping backwards once) never produces negative waits or latencies", async () => {
    const io = new FakeIo();
    let skewed = false;
    const realSleep = io.sleep.bind(io);
    io.sleep = async (ms: number): Promise<void> => {
      if (!skewed) {
        skewed = true;
        io.clockMs -= 5000;
      }
      await realSleep(ms);
    };
    const outcome = await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    const fanout = sectionRecords(io.reportWritten?.sections, "fanout");
    const p95 = fanout[0]?.p95;
    expect(typeof p95).toBe("number");
    expect(typeof p95 === "number" && p95 >= 0).toBe(true);
  });

  test("100 simultaneous deliveries all land within the budget", async () => {
    const io = new FakeIo({ deliveryLatencyMs: 120 });
    const outcome = await runLoadWs(testOptions({ connections: 100, durationS: 10, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(true);
    const fanout = sectionRecords(io.reportWritten?.sections, "fanout");
    expect(fanout[0]?.delivered).toBe(100);
    expect(fanout[0]?.expected).toBe(100);
    expect(fanout[0]?.p95).toBe(120);
  });

  test("losing the sidecar mid-window records every drop and still writes a report", async () => {
    const io = new FakeIo({
      bootProbe: true,
      script: (socket, _index, fakeIo) => {
        socket.addOpenListener(() => {
          void (async () => {
            await fakeIo.sleep(500);
            socket.simulateClose(1001, "server shutting down");
          })();
        });
      },
    });
    const outcome = await runLoadWs(testOptions({ connections: 4, durationS: 2, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(false);
    expect(io.sidecarStarts).toBe(1);
    expect(io.sidecarStops).toBe(1);
    const drops = sectionRecords(io.reportWritten?.sections, "drops");
    expect(drops).toHaveLength(4);
    for (const drop of drops) {
      expect(drop.label).toBe("shutdown");
    }
    const handshake = io.reportWritten?.gates.find(gate => gate.id === "handshake");
    expect(handshake?.passed).toBe(true);
  });

  test("a sidecar boot failure aborts cleanly with a partial report", async () => {
    const io = new FakeIo({ bootProbe: true, startSidecarError: new Error("spawn failed") });
    const outcome = await runLoadWs(testOptions({ connections: 2, durationS: 1 }), io);
    expect(outcome.passed).toBe(false);
    expect(io.reportWritten).not.toBeNull();
    const abortGate = io.reportWritten?.gates.find(gate => gate.id === "run-completed");
    expect(abortGate?.passed).toBe(false);
    expect(abortGate?.breaches.join(" ")).toContain("spawn failed");
    expect(io.publisherClosed).toBe(1);
  });

  test("exactly two missed liveness observations fail the liveness gate without a drop", async () => {
    const io = new FakeIo({
      script: socket => {
        socket.addOpenListener(() => {
          socket.openState = false;
        });
      },
    });
    const outcome = await runLoadWs(testOptions({ connections: 1, durationS: 95, fanoutBursts: 0 }), io);
    expect(outcome.passed).toBe(false);
    const liveness = io.reportWritten?.gates.find(gate => gate.id === "liveness");
    expect(liveness?.passed).toBe(false);
    expect(liveness?.breaches.join(" ")).toContain("missed 2 consecutive liveness checks");
    const drops = sectionRecords(io.reportWritten?.sections, "drops");
    expect(drops).toHaveLength(0);
    const connections = sectionRecords(io.reportWritten?.sections, "connections");
    expect(connections[0]?.livenessMisses).toBe(3);
  });
});

// ─── Tier 4: security & abuse ───────────────────────────────────────────────

describe("load-ws security posture (Tier 4)", () => {
  test("cookie values reach the handshake but never a log line or report", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    expect(io.openSocketCalls[0]?.headers.cookie).toContain("fake-jwt");
    for (const line of io.logs) {
      expect(line).not.toContain("fake-jwt");
    }
    expect(serializedReport(io)).not.toContain("fake-jwt");
  });

  test("the connection DSN and Redis URL never appear in logs or reports", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 1 }), io);
    const allLogs = io.logs.join("\n");
    expect(allLogs).not.toContain("postgres://");
    expect(allLogs).not.toContain("redis://");
    expect(serializedReport(io)).not.toContain("redis://default:secret");
  });

  test("the harness always uses the allowlisted origin — never a foreign one", async () => {
    const io = new FakeIo();
    await runLoadWs(testOptions({ connections: 2, durationS: 1, fanoutBursts: 0 }), io);
    for (const call of io.openSocketCalls) {
      expect(call.headers.origin).toBe("http://localhost:3000");
      expect(call.headers.origin).not.toBe("https://evil.example");
    }
  });

  test("an in-process transport or missing REDIS_URL refuses before any socket or report", async () => {
    const inProcess = new FakeIo({ env: { transport: "in-process" } });
    const inProcessError = await captureRejection(() => runLoadWs(testOptions(), inProcess));
    expect(inProcessError instanceof Error ? inProcessError.message : String(inProcessError)).toMatch(
      /requires the Redis bus/
    );
    expect(inProcess.reportOpened).toBe(0);
    const noRedis = new FakeIo({ env: { redisUrl: undefined } });
    const noRedisError = await captureRejection(() => runLoadWs(testOptions(), noRedis));
    expect(noRedisError instanceof Error ? noRedisError.message : String(noRedisError)).toMatch(
      /REDIS_URL is not configured/
    );
    expect(noRedis.reportOpened).toBe(0);
  });

  test("a minting failure refuses before any report directory exists", async () => {
    const io = new FakeIo({ mintError: new Error("the login mutation was rejected") });
    const caught = await captureRejection(() => runLoadWs(testOptions({ connections: 2, durationS: 1 }), io));
    expect(caught instanceof Error ? caught.message : String(caught)).toMatch(/session minting failed/);
    expect(io.reportOpened).toBe(0);
    expect(io.openSocketCalls).toHaveLength(0);
  });

  test("an invalid-cookie handshake closes 4401, is classified, and is never retried", async () => {
    const io = new FakeIo({
      handshakeRejection: index => (index === 0 ? { code: 4401, reason: "unauthenticated" } : null),
    });
    const outcome = await runLoadWs(testOptions({ connections: 3, durationS: 1, fanoutBursts: 1 }), io);
    expect(outcome.passed).toBe(false);
    expect(io.openSocketCalls).toHaveLength(3);
    const perCookie = new Map<string, number>();
    for (const call of io.openSocketCalls) {
      const cookie = call.headers.cookie ?? "";
      perCookie.set(cookie, (perCookie.get(cookie) ?? 0) + 1);
    }
    for (const count of perCookie.values()) {
      expect(count).toBe(1);
    }
    const handshake = io.reportWritten?.gates.find(gate => gate.id === "handshake");
    expect(handshake?.passed).toBe(false);
    expect(handshake?.breaches.join(" ")).toContain("connection 0 never opened (unauthenticated [4401])");
    const connections = sectionRecords(io.reportWritten?.sections, "connections");
    expect(connections[0]?.userId).toBe(5000);
  });

  test("guard-first: a prod-shaped DATABASE_URL refuses with exit 2 and no run directory", () => {
    const logsPerf = join(import.meta.dir, "..", "..", "logs", "perf");
    const before = directoryEntryCount(logsPerf);
    const proc = Bun.spawnSync({
      cmd: [process.execPath, "scripts/perf/load-ws.ts", "--connections", "5"],
      cwd: join(import.meta.dir, "..", ".."),
      env: {
        ...process.env,
        DATABASE_URL: "postgres://perf:pw@127.0.0.1:5432/kottaby",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).toBe(2);
    const stderr = new TextDecoder().decode(proc.stderr);
    expect(stderr).toContain("kottaby_test");
    expect(stderr).not.toContain("postgres://perf:pw");
    expect(directoryEntryCount(logsPerf)).toBeLessThanOrEqual(before);
  });
});

function directoryEntryCount(path: string): number {
  try {
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return 0;
    }
    return readdirSync(path).length;
  } catch {
    return 0;
  }
}
