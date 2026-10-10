import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { API_SCENARIOS } from "@/scripts/perf/lib/api-scenarios";
import { isLoadApiCliUsageError, LOAD_API_DEFAULTS, parseLoadApiCli } from "@/scripts/perf/lib/load-api-cli";
import {
  type ApiLoadIo,
  type ApiRunOutcome,
  type ApiServerHandle,
  errorMessage,
  isLoadApiRefusalError,
  PG_ACTIVITY_SNAPSHOT_ROW_CAP,
  samplePgActivityRows,
} from "@/scripts/perf/lib/load-api-io";
import {
  bookingOutcomes,
  buildLoadApiGates,
  classifyApiResponse,
  operationData,
  PgActivityTracker,
  ScenarioLedger,
} from "@/scripts/perf/lib/load-api-ledger";
import {
  assignVuIdentities,
  buildVuRampOffsets,
  createScenarioPicker,
  isLoadApiPlanError,
  parseWeightOverrides,
  partitionVuRoles,
  pickFromPool,
  rampSpanMs,
  resolveScenarioWeights,
} from "@/scripts/perf/lib/load-api-plan";
import { runLoadApi } from "@/scripts/perf/lib/load-api-run";
import { createSeededRandom } from "@/scripts/perf/lib/seed-random";
import { type GateResult, type LatencySample, summarizeSamples } from "@/scripts/perf/lib/stats";

const COOKIE_SENTINEL = "COOKIE-do-not-print";
const STUDENT_EMAILS = ["perf_deadbeef_student000001@test.local", "perf_deadbeef_student000002@test.local"];
const ADMIN_EMAILS = ["perf_deadbeef_admin@test.local"];
const SEED_RUN_ID = "deadbeef";

/** Virtual clock: sleeps advance time instantly (deterministic windows). */
class FakeClock {
  time = 0;

  now(): number {
    return this.time;
  }

  async sleep(ms: number): Promise<void> {
    this.time += ms;
  }
}

interface FetchCall {
  readonly url: string;
  readonly body: { query: string; variables: Record<string, unknown> };
  readonly headers: Record<string, string>;
}

interface FetchPlan {
  readonly ok: boolean;
  readonly status: number;
  readonly body: Record<string, unknown> | null;
  readonly latencyMs: number;
}

type Responder = (call: FetchCall, index: number) => FetchPlan;

/** Record-shape narrowing predicate (the repo's cast-free narrowing idiom). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extracts the top-level field name from a GraphQL document string (the data payload key). */
function fieldNameOf(query: string): string {
  const match = /\{\s*([a-z]\w*)\s*[({]/.exec(query);
  return match === null ? "" : (match[1] ?? "");
}

/** Narrows a scenario request body to the GraphQL query/variables shape (predicate, never a cast). */
function asGraphqlBody(body: unknown): { query: string; variables: Record<string, unknown> } {
  if (!isRecord(body) || typeof body.query !== "string" || !isRecord(body.variables)) {
    throw new Error("scenario request body is not a GraphQL query/variables pair");
  }
  return { query: body.query, variables: body.variables };
}

/** Report-section array accessor (refuses missing/malformed sections). */
function sectionArray(sections: Record<string, unknown> | undefined, key: string): readonly unknown[] {
  const value = sections === undefined ? undefined : sections[key];
  if (!Array.isArray(value)) {
    throw new Error(`report section "${key}" is missing or not an array`);
  }
  return value;
}

/** Records one sampler-seam call and answers with the planned pg-QueryResult-like result. */
interface RecordedSamplerQuery {
  readonly text: string;
  readonly params: readonly unknown[];
  readonly result: { readonly rows: readonly Record<string, unknown>[] } | { readonly throw: string };
}

/** Builds a recording `queryDb` fake whose rows live on `.rows` — the REAL seam shape. */
function recordingQueryFn(calls: RecordedSamplerQuery[], result: RecordedSamplerQuery["result"]) {
  return async (
    text: string,
    params: ReadonlyArray<unknown>
  ): Promise<{ rows: readonly Record<string, unknown>[] }> => {
    calls.push({ text, params, result });
    if ("throw" in result) {
      throw new Error(result.throw);
    }
    return result;
  };
}

/** Validates every row of a section array into records (predicate narrowing, no casts). */
function recordRows(rows: readonly unknown[]): readonly Record<string, unknown>[] {
  return rows.map(row => {
    if (!isRecord(row)) {
      throw new Error("section row is missing or not a record");
    }
    return row;
  });
}

/** Numeric field accessor over a report row. */
function numField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`field "${key}" is missing or not a number`);
  }
  return value;
}

/** String field accessor over a report row. */
function strField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`field "${key}" is missing or not a string`);
  }
  return value;
}

/** The default success responder: operation-appropriate payloads for every scenario. */
function defaultResponse(call: FetchCall): FetchPlan {
  const field = fieldNameOf(call.body.query);
  const data: Record<string, unknown> = {
    login: { user: { id: 5 } },
    browseAvailableTeachers: { items: [{ id: 101 }, { id: 102 }], total: 2, page: 1, pageSize: 25, pageCount: 1 },
    mySubscriptions: [],
    myNotifications: { items: [], totalCount: 0, hasMore: false },
    createSession: { id: 501 },
    adminStudentSubscriptions: [],
  };
  return { ok: true, status: 200, body: { data: { [field]: data[field] ?? {} } }, latencyMs: 10 };
}

/** The full fake io: virtual clock, recorded calls, swappable fetch responder. */
class FakeApiIo implements ApiLoadIo {
  readonly calls: FetchCall[] = [];
  readonly logs: string[] = [];
  readonly order: string[] = [];
  readonly stoppedServers: string[] = [];
  readonly reportsWritten: { runId: string; gates: readonly GateResult[]; sections: Record<string, unknown> }[] = [];
  readonly verdicts: (readonly GateResult[])[] = [];
  readonly clock = new FakeClock();
  mintShouldFail = false;
  responder: Responder = defaultResponse;
  pgRows: Record<string, unknown>[] = [{ pid: 1, state: "active" }];
  pgNonIdle = 2;
  serverDied = false;

  log(message: string): void {
    this.logs.push(message);
  }

  now(): number {
    return this.clock.now();
  }

  async sleep(ms: number): Promise<void> {
    await this.clock.sleep(ms);
  }

  env(): { databaseUrl: string; bootPort: number; serverMode: "production" | "development" } {
    return {
      databaseUrl: "postgres://user:secret@127.0.0.1:5432/kottaby_test",
      bootPort: 3066,
      serverMode: "production",
    };
  }

  assertTarget(databaseUrl: string, opts: { forceFlag: boolean }): { dbName: string } {
    this.order.push("guard");
    expect(databaseUrl).toContain("kottaby_test");
    expect(opts.forceFlag).toBe(false);
    return { dbName: "kottaby_test" };
  }

  selectManifest(runId: string | null): { runId: string; studentEmails: string[]; adminEmails: string[] } {
    this.order.push("manifest");
    expect(runId === null || runId === SEED_RUN_ID).toBe(true);
    return { runId: SEED_RUN_ID, studentEmails: STUDENT_EMAILS, adminEmails: ADMIN_EMAILS };
  }

  async ensureServer(baseUrl: string | null): Promise<ApiServerHandle> {
    this.order.push("server");
    const resolved = baseUrl ?? "http://127.0.0.1:3066";
    return {
      baseUrl: resolved,
      spawned: baseUrl === null,
      stop: async () => {
        this.stoppedServers.push(resolved);
      },
      diedUnexpectedly: () => this.serverDied,
    };
  }

  async mintSession(
    _baseUrl: string,
    email: string,
    password: string
  ): Promise<{ userId: number; cookieHeader: string }> {
    this.order.push("mint");
    if (this.mintShouldFail) {
      throw new Error(`mint failed for ${email}`);
    }
    expect(password).toBe(`perf-load-${SEED_RUN_ID}`);
    return { userId: 1000 + this.calls.length, cookieHeader: `${COOKIE_SENTINEL}:${email}` };
  }

  /**
   * Wave-model latency: one yield per call, and only the FIRST fetch of a
   * virtual-time wave advances the clock — concurrent VUs measure the same
   * latency (parallel wall time, not N x latency).
   */
  async fetchGraphql(
    baseUrl: string,
    body: unknown,
    headers: Record<string, string>
  ): Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }> {
    const call: FetchCall = { url: baseUrl, body: asGraphqlBody(body), headers };
    this.calls.push(call);
    const plan = this.responder(call, this.calls.length);
    const startedAt = this.clock.now();
    await Promise.resolve();
    if (this.clock.now() === startedAt) {
      this.clock.time = startedAt + plan.latencyMs;
    }
    return { ok: plan.ok, status: plan.status, body: plan.body };
  }

  async samplePgActivity(): Promise<{ rows: Record<string, unknown>[]; nonIdleCount: number } | null> {
    return { rows: this.pgRows, nonIdleCount: this.pgNonIdle };
  }

  openReport(args: Record<string, string | number | boolean>): { runId: string; runDir: string } {
    this.order.push("report");
    expect(Object.keys(args).length).toBeGreaterThan(0);
    return { runId: "fake-report-run", runDir: "fake-run-dir" };
  }

  writeReport(runId: string, gates: readonly GateResult[], sections: Record<string, unknown>): void {
    this.reportsWritten.push({ runId, gates, sections });
  }

  emitVerdict(gates: readonly GateResult[]): boolean {
    this.verdicts.push(gates);
    return gates.every(gate => gate.passed);
  }
}

/** Builds run options from a CLI invocation (the same path the entrypoint takes). */
function optionsFrom(argv: readonly string[]) {
  const parsed = parseLoadApiCli(argv);
  if (isLoadApiCliUsageError(parsed)) {
    throw parsed;
  }
  return parsed;
}

function scenarioForLedger(id: string): (typeof API_SCENARIOS)[number] {
  const scenario = API_SCENARIOS.find(entry => entry.id === id);
  if (scenario === undefined) {
    throw new Error(`scenario ${id} missing`);
  }
  return scenario;
}

/** Records synthetic observations into a ledger with the classifier's real taxonomy. */
function recordSamples(
  ledger: ScenarioLedger,
  kind: "success" | "domain-rejection" | "transport-error",
  latencies: readonly number[]
): void {
  let body: Record<string, unknown> | null = null;
  if (kind === "success") {
    body = { data: { [ledger.scenario.operationName]: { id: 1 } } };
  } else if (kind === "domain-rejection") {
    body = { errors: [{ message: "denied", extensions: { code: "FORBIDDEN" } }] };
  }
  const facts = kind === "transport-error" ? { ok: false, status: 0, body } : { ok: true, status: 200, body };
  for (const latency of latencies) {
    ledger.record(classifyApiResponse(facts), latency);
  }
}

describe("load-api CLI (Tier 1 — contract)", () => {
  it("applies the documented defaults", () => {
    const parsed = optionsFrom([]);
    expect(parsed.vus).toBe(LOAD_API_DEFAULTS.vus);
    expect(parsed.durationS).toBe(LOAD_API_DEFAULTS.durationS);
    expect(parsed.rampSpec).toBe("10/5s");
    expect(parsed.ramp).toEqual({ count: 10, intervalMs: 5000 });
    expect(parsed.gateMs).toBe(LOAD_API_DEFAULTS.gateMs);
    expect(parsed.baseUrl).toBeNull();
    expect(parsed.runId).toBeNull();
    expect(parsed.weightsSpec).toBeNull();
    expect(parsed.selfCheck).toBe(false);
  });

  it("parses every documented flag", () => {
    const parsed = optionsFrom([
      "--vus",
      "50",
      "--duration-s",
      "60",
      "--ramp",
      "5/1s",
      "--gate-ms",
      "300",
      "--base-url",
      "http://127.0.0.1:3100/",
      "--weights",
      "login=5",
      "--run",
      "0d15ea5e",
    ]);
    expect(parsed.vus).toBe(50);
    expect(parsed.durationS).toBe(60);
    expect(parsed.ramp).toEqual({ count: 5, intervalMs: 1000 });
    expect(parsed.gateMs).toBe(300);
    expect(parsed.baseUrl).toBe("http://127.0.0.1:3100/");
    expect(parsed.weightsSpec).toBe("login=5");
    expect(parsed.runId).toBe("0d15ea5e");
  });

  it("forces the self-check shape (2 VUs x 10s)", () => {
    const parsed = optionsFrom(["--self-check", "--vus", "999", "--duration-s", "999"]);
    expect(parsed.selfCheck).toBe(true);
    expect(parsed.vus).toBe(2);
    expect(parsed.durationS).toBe(10);
  });

  it("reports unknown flags with the accepted list", () => {
    const parsed = parseLoadApiCli(["--bogus", "--vus", "3"]);
    expect(isLoadApiCliUsageError(parsed)).toBe(true);
    if (isLoadApiCliUsageError(parsed)) {
      expect(parsed.unknownFlags).toEqual(["--bogus"]);
      expect(parsed.message).toContain("accepted flags");
    }
  });

  it("ignores bare value tokens and honors last-wins repeats", () => {
    const parsed = optionsFrom(["extra", "--vus", "5", "--vus", "7"]);
    expect(parsed.vus).toBe(7);
  });
});

describe("load-api CLI (Tier 2 — boundaries)", () => {
  const badInvocations: [string, readonly string[]][] = [
    ["--vus 0", ["--vus", "0"]],
    ["negative vus", ["--vus", "-3"]],
    ["non-integer vus", ["--vus", "abc"]],
    ["vus above cap", ["--vus", "10001"]],
    ["--duration-s 0", ["--duration-s", "0"]],
    ["duration above cap", ["--duration-s", "86401"]],
    ["missing flag value", ["--vus"]],
    ["flag value looks like a flag", ["--vus", "--duration-s"]],
    ["ramp without seconds", ["--ramp", "10/5"]],
    ["ramp zero count", ["--ramp", "0/5s"]],
    ["ramp zero seconds", ["--ramp", "10/0s"]],
    ["ramp garbage", ["--ramp", "abc"]],
    ["ramp seconds above cap", ["--ramp", "10/601s"]],
    ["ramp count above cap", ["--ramp", "1001/5s"]],
    ["gate 0", ["--gate-ms", "0"]],
    ["gate above cap", ["--gate-ms", "60001"]],
    ["bad base url", ["--base-url", "not-a-url"]],
    ["non-http base url", ["--base-url", "ftp://127.0.0.1"]],
    ["bad run id uppercase", ["--run", "DEADBEEF"]],
    ["bad run id short", ["--run", "abc"]],
  ];
  for (const [label, argv] of badInvocations) {
    it(`refuses ${label}`, () => {
      expect(isLoadApiCliUsageError(parseLoadApiCli(argv))).toBe(true);
    });
  }
});

describe("load-api weight overrides (Tier 2 — boundaries)", () => {
  const badWeights: [string, string][] = [
    ["unknown scenario", "nope=5"],
    ["missing weight", "login="],
    ["missing separator", "login5"],
    ["non-integer weight", "login=abc"],
    ["negative weight", "login=-1"],
    ["empty list", " , , "],
    ["all-zero full registry", API_SCENARIOS.map(s => `${s.id}=0`).join(",")],
  ];
  for (const [label, spec] of badWeights) {
    it(`refuses weights: ${label}`, () => {
      let caught: unknown = null;
      try {
        parseWeightOverrides(spec);
      } catch (error) {
        caught = error;
      }
      expect(isLoadApiPlanError(caught)).toBe(true);
    });
  }

  it("accepts partial zero overrides and repeat last-wins", () => {
    const weights = resolveScenarioWeights("book-session=0,login=1,login=30");
    expect(weights.get("book-session")).toBe(0);
    expect(weights.get("login")).toBe(30);
    expect(weights.get("my-subscriptions")).toBe(20);
  });

  it("resolves registry defaults when no overrides are given", () => {
    const weights = resolveScenarioWeights(null);
    expect([...weights.entries()]).toEqual(API_SCENARIOS.map(scenario => [scenario.id, scenario.weight]));
  });
});

describe("ramp + role partition + identities (plan)", () => {
  it("ramps 10 VUs per 5s to 100 on exact batch boundaries", () => {
    const offsets = buildVuRampOffsets(100, { count: 10, intervalMs: 5000 });
    expect(offsets).toHaveLength(100);
    expect(new Set(offsets.slice(0, 10))).toEqual(new Set([0]));
    expect(offsets[10]).toBe(5000);
    expect(offsets[99]).toBe(45000);
    expect(rampSpanMs(100, { count: 10, intervalMs: 5000 })).toBe(45000);
  });

  it("shortens the last batch when the ramp count exceeds the VU count", () => {
    const offsets = buildVuRampOffsets(3, { count: 10, intervalMs: 5000 });
    expect(offsets).toEqual([0, 0, 0]);
  });

  it("partitions VUs to realize the registry mix (9 admin of 100 at the 10/110 share)", () => {
    const weights = resolveScenarioWeights(null);
    expect(partitionVuRoles(100, API_SCENARIOS, weights)).toEqual({ adminVus: 9, studentVus: 91 });
    expect(partitionVuRoles(2, API_SCENARIOS, weights)).toEqual({ adminVus: 1, studentVus: 1 });
    expect(partitionVuRoles(1, API_SCENARIOS, weights)).toEqual({ adminVus: 0, studentVus: 1 });
  });

  it("collapses a role when its scenarios carry zero weight", () => {
    const adminOff = resolveScenarioWeights("admin-student-subscriptions=0");
    expect(partitionVuRoles(10, API_SCENARIOS, adminOff).adminVus).toBe(0);
    const adminOnly = resolveScenarioWeights(
      API_SCENARIOS.map(s => `${s.id}=0`)
        .join(",")
        .replace("admin-student-subscriptions=0", "admin-student-subscriptions=10")
    );
    expect(partitionVuRoles(10, API_SCENARIOS, adminOnly)).toEqual({ adminVus: 10, studentVus: 0 });
  });

  it("assigns identities round-robin per role with ramp offsets", () => {
    const weights = resolveScenarioWeights(null);
    const plans = assignVuIdentities(
      4,
      { count: 10, intervalMs: 1000 },
      STUDENT_EMAILS,
      ADMIN_EMAILS,
      API_SCENARIOS,
      weights
    );
    expect(plans).toHaveLength(4);
    expect(plans[0]?.role).toBe("admin");
    expect(plans[1]?.role).toBe("student");
    expect(plans[2]?.email).toBe(STUDENT_EMAILS[1]);
    expect(plans[3]?.email).toBe(STUDENT_EMAILS[0]);
    expect(plans.every(plan => plan.email.length > 0)).toBe(true);
  });

  it("refuses empty identity pools and zero VUs", () => {
    const weights = resolveScenarioWeights(null);
    let caught: unknown = null;
    try {
      assignVuIdentities(2, { count: 10, intervalMs: 1000 }, [], ADMIN_EMAILS, API_SCENARIOS, weights);
    } catch (error) {
      caught = error;
    }
    expect(isLoadApiPlanError(caught)).toBe(true);
    if (isLoadApiPlanError(caught)) {
      expect(caught.message).toContain("no student identities");
    }
    let zeroVus: unknown = null;
    try {
      buildVuRampOffsets(0, { count: 10, intervalMs: 1000 });
    } catch (error) {
      zeroVus = error;
    }
    expect(isLoadApiPlanError(zeroVus)).toBe(true);
  });
});

describe("scenario picker (fairness + determinism)", () => {
  const weights = resolveScenarioWeights(null);

  it("is deterministic under its seed", () => {
    const a = createScenarioPicker(API_SCENARIOS, weights, "seed-x");
    const b = createScenarioPicker(API_SCENARIOS, weights, "seed-x");
    expect(a().id).toBe(b().id);
  });

  it("realizes the normalized weights over 10k draws", () => {
    const studentScenarios = API_SCENARIOS.filter(scenario => scenario.role === "student");
    const picker = createScenarioPicker(studentScenarios, weights, "mix");
    const counts = new Map<string, number>();
    for (let draw = 0; draw < 10_000; draw += 1) {
      const picked = picker();
      counts.set(picked.id, (counts.get(picked.id) ?? 0) + 1);
    }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
    for (const scenario of studentScenarios) {
      const expected = scenario.weight / 100;
      const realized = (counts.get(scenario.id) ?? 0) / total;
      expect(Math.abs(realized - expected)).toBeLessThan(0.02);
    }
  });

  it("excludes zero-weight scenarios and refuses an empty mix", () => {
    const zeroed = resolveScenarioWeights("login=0,browse-teachers=0,browse-teachers-filtered=0");
    const studentScenarios = API_SCENARIOS.filter(scenario => scenario.role === "student");
    const picker = createScenarioPicker(studentScenarios, zeroed, "z");
    const pickedIds = new Set<string>();
    for (let draw = 0; draw < 500; draw += 1) {
      pickedIds.add(picker().id);
    }
    expect(pickedIds.has("login")).toBe(false);
    expect(pickedIds.has("my-subscriptions")).toBe(true);
    let caught: unknown = null;
    try {
      createScenarioPicker([], weights, "e");
    } catch (error) {
      caught = error;
    }
    expect(isLoadApiPlanError(caught)).toBe(true);
  });

  it("picks from pools and refuses empty pools", () => {
    const random = createSeededRandom("pool");
    expect(pickFromPool([7, 8, 9], random)).toBeGreaterThanOrEqual(7);
    let caught: unknown = null;
    try {
      pickFromPool([], random);
    } catch (error) {
      caught = error;
    }
    expect(isLoadApiPlanError(caught)).toBe(true);
  });
});

describe("response classifier (error taxonomy)", () => {
  it("classifies network rejections and non-2xx statuses as transport errors", () => {
    expect(classifyApiResponse({ ok: false, status: 0, body: null })).toEqual({
      kind: "transport-error",
      errorCode: "network",
      body: null,
    });
    expect(classifyApiResponse({ ok: true, status: 500, body: null }).errorCode).toBe("http-500");
    expect(classifyApiResponse({ ok: true, status: 429, body: null }).errorCode).toBe("http-429");
  });

  it("classifies a role-forbidden GraphQL denial as an expected domain rejection — never a transport error", () => {
    const outcome = classifyApiResponse({
      ok: true,
      status: 200,
      body: { errors: [{ message: "denied", extensions: { code: "FORBIDDEN" } }] },
    });
    expect(outcome.kind).toBe("domain-rejection");
    expect(outcome.errorCode).toBe("FORBIDDEN");
  });

  it("falls back to a generic code when the error carries no extensions code", () => {
    expect(classifyApiResponse({ ok: true, status: 200, body: { errors: [{ message: "boom" }] } }).errorCode).toBe(
      "GRAPHQL_ERROR"
    );
  });

  it("classifies unparsable 2xx bodies as malformed responses", () => {
    const outcome = classifyApiResponse({ ok: true, status: 200, body: null });
    expect(outcome.kind).toBe("transport-error");
    expect(outcome.errorCode).toBe("malformed-response");
  });

  it("extracts operation data tolerating array payloads (honest empty lists)", () => {
    const success = classifyApiResponse({ ok: true, status: 200, body: { data: { mySubscriptions: [] } } });
    expect(operationData(success, "mySubscriptions")).toEqual([]);
    expect(operationData(success, "myNotifications")).toBeNull();
  });
});

describe("scenario ledger (incremental aggregation)", () => {
  it("computes nearest-rank percentiles over rounded integer-millisecond samples", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    recordSamples(ledger, "success", [10, 20, 30, 40, 50]);
    const summary = ledger.summary();
    expect(summary.count).toBe(5);
    expect(summary.errorCount).toBe(0);
    expect(summary.p50).toBe(30);
    expect(summary.p95).toBe(50);
    expect(summary.p99).toBe(50);
    expect(summary.max).toBe(50);
  });

  it("matches the shared array-based stats on the same observations", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    const values = [7, 13, 22, 91, 45, 45, 3, 8, 120, 64];
    recordSamples(ledger, "success", values);
    const samples: LatencySample[] = values.map(durationMs => ({
      scenarioId: "browse-teachers",
      durationMs,
      ok: true,
    }));
    expect(ledger.summary().p95).toBe(summarizeSamples(samples).p95);
    expect(ledger.summary().p99).toBe(summarizeSamples(samples).p99);
    expect(ledger.summary().max).toBe(summarizeSamples(samples).max);
  });

  it("counts must-succeed domain rejections as errors but probe rejections as valid outcomes", () => {
    const read = new ScenarioLedger(scenarioForLedger("my-subscriptions"));
    recordSamples(read, "domain-rejection", [5, 6]);
    recordSamples(read, "success", [7]);
    expect(read.summary().errorCount).toBe(2);
    const booking = new ScenarioLedger(scenarioForLedger("book-session"));
    recordSamples(booking, "domain-rejection", [5, 6]);
    recordSamples(booking, "success", [7]);
    expect(booking.summary().errorCount).toBe(0);
    expect(bookingOutcomes(booking)).toEqual({
      created: 1,
      "translated-domain-rejection": 2,
      "transport-error": 0,
      "unexpected-shape": 0,
    });
  });

  it("counts a 2xx no-errors response with a missing payload as an unexpected shape", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("login"));
    ledger.record(classifyApiResponse({ ok: true, status: 200, body: { data: {} } }), 12);
    expect(ledger.kindCounts()["unexpected-shape"]).toBe(1);
  });
});

describe("scenario ledger (chaos: invalid latencies, storm bounds)", () => {
  it("rejects non-finite and negative latencies as invalid observations (excluded from percentiles)", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    recordSamples(ledger, "success", [10, 20, 30]);
    const outcome = classifyApiResponse({ ok: true, status: 200, body: { data: { browseAvailableTeachers: {} } } });
    ledger.record(outcome, Number.NaN);
    ledger.record(outcome, -5);
    expect(ledger.invalidLatencyCount()).toBe(2);
    expect(ledger.summary().count).toBe(3);
    expect(ledger.summary().max).toBe(30);
  });

  it("keeps the histogram bounded by distinct values under a sample storm", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    for (let index = 0; index < 10_000; index += 1) {
      recordSamples(ledger, "success", [index % 10]);
    }
    expect(ledger.attemptCount()).toBe(10_000);
    expect(ledger.histogramSize()).toBe(10);
  });

  it("accepts a huge latency as the max (bounded by rounding, not clamping)", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    recordSamples(ledger, "success", [10, 1e9]);
    expect(ledger.summary().max).toBe(1e9);
  });
});

describe("gate assembly (p95 + zero errors, shared evaluator semantics)", () => {
  it("fails a scenario at exactly the gate and passes one millisecond below", () => {
    const atLimit = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    recordSamples(atLimit, "success", [500]);
    expect(buildLoadApiGates([atLimit], 500)[0]?.passed).toBe(false);
    const below = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    recordSamples(below, "success", [499]);
    expect(buildLoadApiGates([below], 500)[0]?.passed).toBe(true);
  });

  it("fails any scenario with a single transport error", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("my-notifications"));
    recordSamples(ledger, "success", [10, 11]);
    recordSamples(ledger, "transport-error", [12]);
    const gate = buildLoadApiGates([ledger], 500)[0];
    expect(gate?.passed).toBe(false);
    expect(gate?.breaches.join(" ")).toContain("error");
  });

  it("fails closed for a scenario with zero latency samples", () => {
    const ledger = new ScenarioLedger(scenarioForLedger("browse-teachers"));
    expect(buildLoadApiGates([ledger], 500)[0]?.passed).toBe(false);
  });
});

describe("pg_stat_activity tracker", () => {
  it("retains the peak snapshot and counts read failures", () => {
    const tracker = new PgActivityTracker();
    tracker.observe({ takenAtMs: 1, rows: [{ pid: 1 }], nonIdleCount: 2 });
    tracker.observe({ takenAtMs: 2, rows: [{ pid: 1 }, { pid: 2 }], nonIdleCount: 5 });
    tracker.observe({ takenAtMs: 3, rows: [{ pid: 1 }], nonIdleCount: 3 });
    tracker.observe(null);
    expect(tracker.peakSnapshot()?.nonIdleCount).toBe(5);
    expect(tracker.sampleCount()).toBe(3);
    expect(tracker.failureCount()).toBe(1);
  });

  it("answers null when no sample succeeded", () => {
    const tracker = new PgActivityTracker();
    tracker.observe(null);
    expect(tracker.peakSnapshot()).toBeNull();
  });
});

describe("pg_stat_activity sampler seam (queryDb shape + bare db name)", () => {
  it("binds the BARE database name from the guard — never the full DSN", async () => {
    const calls: RecordedSamplerQuery[] = [];
    const query = recordingQueryFn(calls, { rows: [{ pid: 7, state: "active" }] });
    const snapshot = await samplePgActivityRows("kottaby_test", query);
    expect(snapshot?.nonIdleCount).toBe(1);
    expect(calls[0]?.text).toContain("FROM pg_stat_activity WHERE datname = $1");
    expect(calls[0]?.params[0]).toBe("kottaby_test");
    expect(String(calls[0]?.params[0])).not.toContain("postgres://");
  });

  it("reads rows off the pg QueryResult (`.rows`), not a bare array return", async () => {
    const queryResultLike = {
      rows: [
        { pid: 1, state: "active" },
        { pid: 2, state: "idle" },
        { pid: 3, state: "idle in transaction" },
      ],
      command: "SELECT",
      rowCount: 3,
      oid: null,
      fields: [],
    };
    const snapshot = await samplePgActivityRows("kottaby_test", async () => queryResultLike);
    expect(snapshot?.rows).toHaveLength(3);
    expect(snapshot?.nonIdleCount).toBe(2);
  });

  it("caps the retained snapshot rows and observes null on a read failure", async () => {
    const calls: RecordedSamplerQuery[] = [];
    const query = recordingQueryFn(calls, { rows: [] });
    await samplePgActivityRows("kottaby_test", query);
    expect(calls[0]?.params[1]).toBe(PG_ACTIVITY_SNAPSHOT_ROW_CAP);
    const failed = await samplePgActivityRows("kottaby_test", recordingQueryFn([], { throw: "connection refused" }));
    expect(failed).toBeNull();
  });
});

describe("runLoadApi over fake io (window, report, verdict)", () => {
  it("drives every active scenario, writes one report, and passes clean gates", async () => {
    const io = new FakeApiIo();
    const outcome: ApiRunOutcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "30"]), io);
    expect(outcome.passed).toBe(true);
    expect(outcome.runId).toBe("fake-report-run");
    expect(io.order[0]).toBe("guard");
    expect(io.stoppedServers).toEqual(["http://127.0.0.1:3066"]);
    expect(io.reportsWritten).toHaveLength(1);
    const sections = io.reportsWritten[0]?.sections;
    const rows = recordRows(sectionArray(sections, "scenarios"));
    expect(rows).toHaveLength(API_SCENARIOS.length);
    for (const row of rows) {
      expect(numField(row, "attempts")).toBeGreaterThan(0);
    }
  });

  it("skips gate semantics in self-check mode (empty verdict passes vacuously)", async () => {
    const io = new FakeApiIo();
    const outcome = await runLoadApi(optionsFrom(["--self-check"]), io);
    expect(outcome.passed).toBe(true);
    expect(io.verdicts[0]).toEqual([]);
  });

  it("isolates the admin scenario to admin identities and never lets students drive it", async () => {
    const io = new FakeApiIo();
    await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "2"]), io);
    const adminCookie = `${COOKIE_SENTINEL}:${ADMIN_EMAILS[0]}`;
    const adminCalls = io.calls.filter(call => call.body.query.includes("AdminStudentSubscriptions"));
    expect(adminCalls.length).toBeGreaterThan(0);
    for (const call of adminCalls) {
      expect(call.headers.cookie).toBe(adminCookie);
    }
    for (const call of io.calls) {
      if (call.body.query.includes("AdminStudentSubscriptions")) {
        continue;
      }
      expect(call.headers.cookie).not.toBe(adminCookie);
    }
  });

  it("mints a unique idempotency key for every booking request in the run", async () => {
    const io = new FakeApiIo();
    await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "30"]), io);
    const keys = io.calls
      .filter(call => call.body.query.includes("mutation CreateSession"))
      .map(call => call.headers["x-idempotency-key"]);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("refuses before any report when minting fails (zero residue)", async () => {
    const io = new FakeApiIo();
    io.mintShouldFail = true;
    let caught: unknown = null;
    try {
      await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "1"]), io);
    } catch (error) {
      caught = error;
    }
    expect(isLoadApiRefusalError(caught)).toBe(true);
    if (isLoadApiRefusalError(caught)) {
      expect(caught.message).toContain("session minting failed");
    }
    expect(io.reportsWritten).toHaveLength(0);
    expect(io.stoppedServers).toHaveLength(1);
  });

  it("refuses when the teacher pool harvest fails", async () => {
    const io = new FakeApiIo();
    io.responder = call =>
      call.body.query.includes("BrowseAvailableTeachers") && call.body.variables.page === 1
        ? {
            ok: true,
            status: 200,
            body: { errors: [{ message: "denied", extensions: { code: "FORBIDDEN" } }] },
            latencyMs: 1,
          }
        : defaultResponse(call);
    let caught: unknown = null;
    try {
      await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "1"]), io);
    } catch (error) {
      caught = error;
    }
    expect(isLoadApiRefusalError(caught)).toBe(true);
    if (isLoadApiRefusalError(caught)) {
      expect(caught.message).toContain("teacher pool harvest failed");
    }
    expect(io.reportsWritten).toHaveLength(0);
  });
});

describe("runLoadApi gate + failure surfaces (chaos + abuse)", () => {
  it("fails the verdict on slow scenarios and includes the pg snapshot rows", async () => {
    const io = new FakeApiIo();
    io.responder = call => ({ ...defaultResponse(call), latencyMs: 600 });
    const outcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "2"]), io);
    expect(outcome.passed).toBe(false);
    const sections = io.reportsWritten[0]?.sections;
    const pg = sections?.pgStatActivity;
    if (!isRecord(pg)) {
      throw new Error("pgStatActivity section missing");
    }
    expect(Array.isArray(pg.peakRows)).toBe(true);
    expect(numField(pg, "samples")).toBeGreaterThan(0);
  });

  it("withholds pg snapshot rows on a passing verdict", async () => {
    const io = new FakeApiIo();
    const outcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "30"]), io);
    expect(outcome.passed).toBe(true);
    const sections = io.reportsWritten[0]?.sections;
    const pg = sections?.pgStatActivity;
    if (!isRecord(pg)) {
      throw new Error("pgStatActivity section missing");
    }
    expect(typeof pg.peakRows).toBe("string");
  });

  it("records a partial report with the abort when the window throws", async () => {
    const io = new FakeApiIo();
    io.responder = (call, index) => {
      if (index > 6) {
        throw new Error("boom mid-run");
      }
      return defaultResponse(call);
    };
    const outcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "1"]), io);
    expect(outcome.passed).toBe(false);
    const sections = io.reportsWritten[0]?.sections;
    expect(strField(sections ?? {}, "abortedWithError")).toContain("boom mid-run");
  });

  it("flags a server that died mid-run and fails transport gates", async () => {
    const io = new FakeApiIo();
    io.serverDied = true;
    io.responder = (call, index) =>
      index > 6 ? { ok: false, status: 0, body: null, latencyMs: 1 } : defaultResponse(call);
    const outcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "1"]), io);
    expect(outcome.passed).toBe(false);
    const sections = io.reportsWritten[0]?.sections;
    expect(sections?.serverDiedUnexpectedly).toBe(true);
  });

  it("excludes zero-weight scenarios from the window and the gates", async () => {
    const io = new FakeApiIo();
    await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "2", "--weights", "book-session=0"]), io);
    const rows = recordRows(sectionArray(io.reportsWritten[0]?.sections, "scenarios"));
    const ids = rows.map(row => strField(row, "id"));
    expect(ids).not.toContain("book-session");
    expect(io.calls.some(call => call.body.query.includes("mutation CreateSession"))).toBe(false);
  });

  it("survives a 50-VU fetch storm with exact attempt accounting", async () => {
    const io = new FakeApiIo();
    const outcome = await runLoadApi(optionsFrom(["--vus", "50", "--duration-s", "3", "--ramp", "50/1s"]), io);
    expect(outcome.passed).toBe(true);
    const rows = recordRows(sectionArray(io.reportsWritten[0]?.sections, "scenarios"));
    const totalAttempts = rows.reduce<number>((sum, row) => sum + numField(row, "attempts"), 0);
    const harvestCalls = 2;
    expect(io.calls).toHaveLength(totalAttempts + harvestCalls);
    const vus = recordRows(sectionArray(io.reportsWritten[0]?.sections, "virtualUsers"));
    expect(vus).toHaveLength(50);
    const vuIterations = vus.reduce<number>((sum, vu) => sum + numField(vu, "iterations"), 0);
    expect(vuIterations).toBe(totalAttempts);
  });

  it("classifies mixed network resets and malformed bodies without crashing", async () => {
    const io = new FakeApiIo();
    io.responder = (call, index) => {
      const past = index - 2; // indices 1-2 are the harvest browse calls — keep them healthy
      if (past <= 0) {
        return defaultResponse(call);
      }
      if (past % 3 === 0) {
        return { ok: false, status: 0, body: null, latencyMs: 1 };
      }
      if (past % 3 === 1) {
        return { ok: true, status: 200, body: null, latencyMs: 1 };
      }
      if (past % 5 === 2) {
        return { ok: true, status: 503, body: null, latencyMs: 1 };
      }
      return defaultResponse(call);
    };
    const outcome = await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "2"]), io);
    expect(outcome.passed).toBe(false);
    const sections = io.reportsWritten[0]?.sections;
    const taxonomy = sections?.errorTaxonomy;
    expect(isRecord(taxonomy)).toBe(true);
    const flat = isRecord(taxonomy)
      ? Object.values(taxonomy).flatMap(counts => (isRecord(counts) ? Object.keys(counts) : []))
      : [];
    expect(flat).toContain("network");
    expect(flat).toContain("malformed-response");
    expect(flat).toContain("http-503");
  });

  it("never leaks cookie material into logs or reports (Tier 4)", async () => {
    const io = new FakeApiIo();
    await runLoadApi(optionsFrom(["--vus", "2", "--duration-s", "2"]), io);
    expect(io.calls.some(call => call.headers.cookie.includes(COOKIE_SENTINEL))).toBe(true);
    for (const line of io.logs) {
      expect(line.includes(COOKIE_SENTINEL)).toBe(false);
    }
    const reportJson = JSON.stringify(io.reportsWritten);
    expect(reportJson.includes(COOKIE_SENTINEL)).toBe(false);
    expect(reportJson.includes("access_token")).toBe(false);
  });
});

describe("real entrypoint guard (subprocess, Tier 4)", () => {
  const REPO_ROOT = join(import.meta.dir, "..", "..");
  const PERF_LOGS = join(REPO_ROOT, "logs", "perf");

  interface EntryResult {
    exitCode: number | null;
    stderr: string;
  }

  function runEntry(args: readonly string[], env: Record<string, string>): EntryResult {
    const proc = Bun.spawnSync({
      cmd: [process.execPath, join(REPO_ROOT, "scripts", "perf", "load-api.ts"), ...args],
      cwd: REPO_ROOT,
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, ...env },
    });
    return { exitCode: proc.exitCode, stderr: new TextDecoder().decode(proc.stderr) };
  }

  it("refuses a prod-shaped DATABASE_URL with exit 2 before any run directory exists", () => {
    const before = existsSync(PERF_LOGS) ? readdirSync(PERF_LOGS).length : 0;
    const result = runEntry(["--vus", "2"], { DATABASE_URL: "postgres://perf:sup3rs3cret@127.0.0.1:5432/kottaby" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("kottaby_test");
    expect(result.stderr).not.toContain("sup3rs3cret");
    expect(result.stderr).not.toContain("postgres://");
    const after = existsSync(PERF_LOGS) ? readdirSync(PERF_LOGS).length : 0;
    expect(after).toBe(before);
  });

  it("refuses unknown flags with exit 2 and the accepted list", () => {
    const result = runEntry(["--nope"], { DATABASE_URL: "postgres://perf:x@127.0.0.1:5432/kottaby_test" });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("accepted flags");
  });
});

describe("error message rendering", () => {
  it("renders Error instances and unknown throws", () => {
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage(42)).toBe("42");
  });
});
