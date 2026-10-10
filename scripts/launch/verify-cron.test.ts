/**
 * Paired self-validation test for the verify-cron probe — route
 * inventory, live-envelope recording (counts as evidence, non-numeric
 * values never echoed), bearer discipline (environment only, never
 * echoed), fail-closed route gates, fan-out transport resolution,
 * sidecar liveness, arg parsing, and exit codes. The fetch transport
 * and the environment snapshot are fully stubbed: no real HTTP request
 * leaves the process here (the probe CLI's own run against a live
 * environment is recorded separately as the arming evidence).
 */

import { describe, expect, it } from "bun:test";
import { resetEnvironmentCache } from "@/backend/lib/env";
import type { ProbeLine } from "@/scripts/launch/shared/launch-types";
import {
  CRON_SWEEP_ROUTES,
  defaultFanoutSnapshot,
  type FanoutEnvSnapshot,
  main,
  type ProbeFetch,
  type VerifyCronOptions,
  verifyCron,
} from "@/scripts/launch/verify-cron";

const SECRET = "unit-test-bearer-secret";
const BEARER_ROW_ID = "verify-cron.bearer";
const FANOUT_ROW_ID = "verify-cron.fanout-transport";
const SIDECAR_ROW_ID = "verify-cron.sidecar-healthcheck";
const REDIS_URL_SEED = "redis://unit.test:6379";
const SIDECAR_URL = "http://sidecar.unit.test";

/** One recorded outgoing probe request. */
interface RecordedRequest {
  readonly url: string;
  readonly authorization: string | null;
}

/** One seeded transport outcome: an `Error` throws (transport failure), otherwise the status/body answers. */
type FetchOutcome = { status: number; body?: unknown } | Error;

/** Per-leg fetch seed: cron routes get `cron`, the sidecar liveness probe gets `sidecar` (default: the 426 liveness answer). */
interface FetchSeed {
  readonly cron: FetchOutcome;
  readonly sidecar?: FetchOutcome;
}

/**
 * Seeded fetch stub: every call is recorded (URL + authorization header)
 * and routed by leg — cron route URLs get the cron outcome, everything
 * else (the sidecar liveness probe) gets the sidecar outcome.
 */
function seededFetch(seed: FetchSeed): { requests: RecordedRequest[]; impl: ProbeFetch } {
  const requests: RecordedRequest[] = [];
  const impl: ProbeFetch = async (input, init) => {
    requests.push({ url: input, authorization: new Headers(init?.headers).get("authorization") });
    const outcome = input.includes("/api/cron/") ? seed.cron : (seed.sidecar ?? { status: 426 });
    if (outcome instanceof Error) throw outcome;
    return new Response(outcome.body === undefined ? null : JSON.stringify(outcome.body), { status: outcome.status });
  };
  return { requests, impl };
}

/** Stdout capture: every emitted line, in order. */
function captureStdout(): { lines: string[]; write: (line: string) => void } {
  const lines: string[] = [];
  return { lines, write: line => lines.push(line) };
}

/** Structural guard for reading emitted JSON records back without unsafe casts. */
function isProbeLine(value: unknown): value is ProbeLine {
  if (typeof value !== "object" || value === null) return false;
  const rowId = Reflect.get(value, "rowId");
  const result = Reflect.get(value, "result");
  const detail = Reflect.get(value, "detail");
  return typeof rowId === "string" && (result === "PASS" || result === "FAIL") && typeof detail === "string";
}

/** Parses the JSON record lines a run emitted (all but the trailing summary line). */
function parseRecordLines(lines: readonly string[]): ProbeLine[] {
  const parsed: unknown[] = lines.slice(0, -1).map(line => JSON.parse(line));
  return parsed.filter(isProbeLine);
}

/** The standard green snapshot: a configured Redis bus, the redis transport, and a reachable sidecar. */
const GREEN_SNAPSHOT: FanoutEnvSnapshot = {
  redisUrl: REDIS_URL_SEED,
  fanoutTransport: "redis",
  wsBaseUrl: SIDECAR_URL,
};

/** Green-path probe options over a seeded fetch (overridable per leg). */
function probeOptions(
  seed: FetchSeed,
  overrides: Partial<VerifyCronOptions> = {}
): {
  requests: RecordedRequest[];
  options: VerifyCronOptions;
} {
  const { requests, impl } = seededFetch(seed);
  const options: VerifyCronOptions = {
    fetchImpl: impl,
    secretFromEnv: () => SECRET,
    fanoutEnv: () => GREEN_SNAPSHOT,
    ...overrides,
  };
  return { requests, options };
}

/** The standard green-envelope seed: a sweep result payload inside the success envelope. */
const GREEN_SEED: FetchSeed = {
  cron: { status: 200, body: { data: { cancelled: 2, refunded: 1 }, requestId: "r-1" } },
};

describe("verify-cron probe", () => {
  it("pins the armed-route inventory (the four cron sweep surfaces)", () => {
    expect(CRON_SWEEP_ROUTES).toEqual([
      "/api/cron/sweep-sessions",
      "/api/cron/sweep-inactive-teachers",
      "/api/cron/expire-subscriptions",
      "/api/cron/reconcile-paymob-payments",
    ]);
  });

  it("probes every route with the bearer and records the envelope counts plus the transport and liveness legs", async () => {
    const { requests, options } = probeOptions(GREEN_SEED);
    const lines = await verifyCron("http://unit.test", options);
    expect(lines.map(line => line.rowId)).toEqual([...CRON_SWEEP_ROUTES, FANOUT_ROW_ID, SIDECAR_ROW_ID]);
    expect(lines.every(line => line.result === "PASS")).toBe(true);
    for (const line of lines.slice(0, 4)) {
      expect(line.detail).toBe("status 200; envelope: cancelled=2, refunded=1");
    }
    expect(lines[4].detail).toContain("resolves to the Redis bus");
    expect(lines[5].detail).toContain("status 426");
    const cronRequests = requests.filter(request => request.url.includes("/api/cron/"));
    const sidecarRequests = requests.filter(request => !request.url.includes("/api/cron/"));
    expect(cronRequests).toHaveLength(4);
    expect(cronRequests.every(request => request.url.startsWith("http://unit.test/api/cron/"))).toBe(true);
    expect(cronRequests.every(request => request.authorization === `Bearer ${SECRET}`)).toBe(true);
    expect(sidecarRequests).toEqual([{ url: SIDECAR_URL, authorization: null }]);
  });

  it("main exits 0 with all-PASS lines and never echoes the bearer or the Redis URL", async () => {
    const out = captureStdout();
    const { options } = probeOptions(GREEN_SEED, { stdout: out.write });
    const exit = await main([], options);
    expect(exit).toBe(0);
    const records = parseRecordLines(out.lines);
    expect(records).toHaveLength(6);
    expect(records.every(line => line.result === "PASS")).toBe(true);
    const emitted = out.lines.join("\n");
    expect(emitted).not.toContain(SECRET);
    expect(emitted).not.toContain(REDIS_URL_SEED);
    expect(emitted).toContain("verify-cron: 6 line(s) — 6 PASS, 0 FAIL");
  });

  it("records sweep counts as evidence but never echoes non-numeric payload values", async () => {
    const outcomes = await Promise.all(
      [
        { status: 200, body: { data: { offlined: 0, note: "LEAKY-NOTE", nested: { x: 1 } } } },
        { status: 200, body: {} },
        { status: 200, body: { data: {} } },
      ].map(async cron => {
        const { options } = probeOptions({ cron });
        const lines = await verifyCron("http://unit.test", options);
        return lines[0].detail;
      })
    );
    expect(outcomes[0]).toContain("offlined=0");
    expect(outcomes[0]).toContain("note");
    expect(outcomes[0]).toContain("nested");
    expect(outcomes[0]).not.toContain("LEAKY-NOTE");
    expect(outcomes[1]).toBe("status 200; envelope: none");
    expect(outcomes[2]).toBe("status 200; envelope: none");
  });

  it("reads the bearer from the environment by default (never from argv)", async () => {
    const previous = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "env-read-secret";
    try {
      const out = captureStdout();
      const { requests, impl } = seededFetch(GREEN_SEED);
      const exit = await main([], { fetchImpl: impl, fanoutEnv: () => GREEN_SNAPSHOT, stdout: out.write });
      expect(exit).toBe(0);
      const cronRequests = requests.filter(request => request.url.includes("/api/cron/"));
      expect(cronRequests.every(request => request.authorization === "Bearer env-read-secret")).toBe(true);
      expect(out.lines.join("\n")).not.toContain("env-read-secret");
    } finally {
      if (previous === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previous;
      }
    }
  });

  it("a missing or whitespace-only bearer is a named FAIL line and no route request is sent", async () => {
    const outcomes = await Promise.all(
      [() => undefined, () => "   "].map(async secretFromEnv => {
        const { requests, options } = probeOptions(GREEN_SEED, { secretFromEnv });
        const lines = await verifyCron("http://unit.test", options);
        return { lines, requests };
      })
    );
    for (const { lines, requests } of outcomes) {
      expect(lines.map(line => line.rowId)).toEqual([
        BEARER_ROW_ID,
        ...CRON_SWEEP_ROUTES,
        FANOUT_ROW_ID,
        SIDECAR_ROW_ID,
      ]);
      expect(lines[0].result).toBe("FAIL");
      expect(lines[0].detail).toContain("CRON_SECRET is not set");
      for (const line of lines.slice(1, 5)) {
        expect(line.result).toBe("FAIL");
        expect(line.detail).toContain("not probed");
      }
      expect(lines.slice(5).every(line => line.result === "PASS")).toBe(true);
      const cronRequests = requests.filter(request => request.url.includes("/api/cron/"));
      expect(cronRequests).toHaveLength(0);
    }

    const { options } = probeOptions(GREEN_SEED, { secretFromEnv: () => undefined, stdout: captureStdout().write });
    expect(await main([], options)).toBe(1);
  });

  it("fail-closed route gates (401/404) are FAIL lines with a non-zero exit", async () => {
    const outcomes = await Promise.all(
      [401, 404].map(async status => {
        const { options } = probeOptions({ cron: { status } });
        const lines = await verifyCron("http://unit.test", options);
        return { status, lines };
      })
    );
    for (const { status, lines } of outcomes) {
      expect(lines).toHaveLength(6);
      expect(lines.slice(0, 4).every(line => line.result === "FAIL")).toBe(true);
      expect(lines[0].detail).toContain(`route gate fail-closed: status ${status}`);
      expect(lines.slice(4).every(line => line.result === "PASS")).toBe(true);
    }

    const { options } = probeOptions({ cron: { status: 401 } }, { stdout: captureStdout().write });
    expect(await main([], options)).toBe(1);
  });

  it("an unreachable route is a named FAIL line (never a silent skip)", async () => {
    const { options } = probeOptions({ cron: new Error("connect ECONNREFUSED") });
    const lines = await verifyCron("http://unit.test", options);
    expect(lines.slice(0, 4).every(line => line.result === "FAIL")).toBe(true);
    expect(lines[0].detail).toContain("route unreachable");
    expect(lines[0].detail).toContain("ECONNREFUSED");
    expect(lines.slice(4).every(line => line.result === "PASS")).toBe(true);
  });

  it("the fan-out transport leg fails closed unless REDIS_URL resolves the Redis bus", async () => {
    const snapshots: FanoutEnvSnapshot[] = [
      { redisUrl: REDIS_URL_SEED, fanoutTransport: "redis", wsBaseUrl: SIDECAR_URL },
      { redisUrl: REDIS_URL_SEED, fanoutTransport: "in-process", wsBaseUrl: SIDECAR_URL },
      { redisUrl: undefined, fanoutTransport: "in-process", wsBaseUrl: SIDECAR_URL },
    ];
    const lines = await Promise.all(
      snapshots.map(async snapshot => {
        const { options } = probeOptions(GREEN_SEED, { fanoutEnv: () => snapshot });
        return (await verifyCron("http://unit.test", options)).find(line => line.rowId === FANOUT_ROW_ID);
      })
    );
    expect(lines[0]?.result).toBe("PASS");
    expect(lines[0]?.detail).not.toContain(REDIS_URL_SEED);
    expect(lines[1]?.result).toBe("FAIL");
    expect(lines[1]?.detail).toContain("silently degrades");
    expect(lines[2]?.result).toBe("FAIL");
    expect(lines[2]?.detail).toContain("REDIS_URL is not set");
  });

  it("the sidecar liveness leg fails on unexpected answers and unreachable sidecars", async () => {
    const lines = await Promise.all(
      [{ status: 200 }, new Error("connect ECONNREFUSED")].map(async sidecar => {
        const { options } = probeOptions({ cron: GREEN_SEED.cron, sidecar });
        return (await verifyCron("http://unit.test", options)).find(line => line.rowId === SIDECAR_ROW_ID);
      })
    );
    expect(lines[0]?.result).toBe("FAIL");
    expect(lines[0]?.detail).toBe("unexpected sidecar answer: status 200");
    expect(lines[1]?.result).toBe("FAIL");
    expect(lines[1]?.detail).toContain("sidecar unreachable");
  });

  it("--url overrides the cron base URL and --ws-url overrides the sidecar base URL", async () => {
    const { requests, options } = probeOptions(GREEN_SEED, { stdout: captureStdout().write });
    const exit = await main(["--url", "http://example.test/", "--ws-url", "http://ws2.unit.test/"], options);
    expect(exit).toBe(0);
    expect(requests.find(request => request.url.includes("/api/cron/"))?.url).toBe(
      `http://example.test${CRON_SWEEP_ROUTES[0]}`
    );
    expect(requests.find(request => !request.url.includes("/api/cron/"))?.url).toBe("http://ws2.unit.test");
  });

  it("a --url/--ws-url without a value and unknown flags are usage errors (exit 1)", async () => {
    const { options } = probeOptions(GREEN_SEED, { stdout: captureStdout().write });
    expect(await main(["--url"], options)).toBe(1);
    expect(await main(["--ws-url"], options)).toBe(1);
    expect(await main(["--nope"], options)).toBe(1);
    // argv carries no secret surface: --secret is rejected as an unknown argument
    expect(await main(["--secret", "nope"], options)).toBe(1);
  });

  it("--help prints usage and exits 0", async () => {
    const out = captureStdout();
    const { options } = probeOptions(GREEN_SEED, { stdout: out.write });
    const exit = await main(["--help"], options);
    expect(exit).toBe(0);
    expect(out.lines[0]).toContain("Usage: bun run scripts/launch/verify-cron.ts");
    expect(out.lines[0]).toContain("[--ws-url <sidecar-base-url>]");
  });

  it("the default fan-out snapshot reads the canonical typed environment seam", () => {
    const previous: readonly (readonly [string, string | undefined])[] = [
      ["REDIS_URL", process.env.REDIS_URL],
      ["NOTIFICATION_FANOUT_TRANSPORT", process.env.NOTIFICATION_FANOUT_TRANSPORT],
      ["WS_HOST", process.env.WS_HOST],
      ["WS_PORT", process.env.WS_PORT],
    ];
    delete process.env.NOTIFICATION_FANOUT_TRANSPORT;
    process.env.REDIS_URL = "redis://default-seed.test:6379";
    process.env.WS_HOST = "127.0.0.1";
    process.env.WS_PORT = "4599";
    resetEnvironmentCache();
    try {
      const snapshot = defaultFanoutSnapshot();
      expect(snapshot.redisUrl).toBe("redis://default-seed.test:6379");
      expect(snapshot.fanoutTransport).toBe("redis");
      expect(snapshot.wsBaseUrl).toBe("http://127.0.0.1:4599");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      resetEnvironmentCache();
    }
  });
});
