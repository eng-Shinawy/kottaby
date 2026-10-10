/**
 * Reconciliation cron route contract
 * (`GET /api/cron/reconcile-paymob-payments`).
 *
 * Pure-function tier: the GET handler is invoked directly with constructed
 * `NextRequest`s — NO server boot, NO database (the reconciliation sweep is
 * mocked at the module boundary; its batch/inquiry/handoff semantics are
 * exhaustively pinned by
 * `backend/services/billing/payment-gateway/paymob/__tests__/paymob.reconcile.test.ts`).
 *
 * Coverage map:
 *  - CRON MODE GATES fail closed: with `CRON_EXECUTION_MODE` not
 *    "external" OR `CRON_EXTERNAL_ENABLED` not "true" the surface answers
 *    the endpoint-shaped 404 — indistinguishable from any other unknown
 *    path, regardless of what credentials accompany the request (a
 *    deployment with externally-triggered jobs disabled exposes NO cron
 *    endpoint at all);
 *  - PROVIDER CONFIGURATION GATE fails closed: even with the cron mode
 *    gates open AND correct credentials, a deployment whose active
 *    provider is not paymob — or whose reconciliation API key is not
 *    configured (unset or whitespace-only) — answers the SAME bare 404:
 *    the reconciliation surface does not exist, and no envelope may prove
 *    otherwise. A mid-flight provider flip is honored on the very next
 *    run (the typed environment is re-read per request);
 *  - MISSING SECRET fails closed: gates + provider open + no `CRON_SECRET`
 *    configured → 401 for ANY presented bearer (never open);
 *  - WRONG/MISSING BEARER → 401 (`UNAUTHORIZED` envelope);
 *  - CORRECT BEARER → 200 success envelope
 *    `{ data: { checked, confirmed, failed, skipped }, requestId }` — the
 *    HONEST TALLY ONLY contract: no row identities cross the wire, and the
 *    zero-count idempotent re-sweep serializes all four counters
 *    byte-equally;
 *  - the service mock records EXACTLY ONE invocation per authenticated
 *    call, each carrying a fresh `now` Date (the route owns no sweep
 *    logic of its own — it delegates with the current instant);
 *  - a service THROWN failure propagates through the shared error
 *    envelope machinery (masked per the lib-level taxonomy — the route
 *    adds no bespoke catch beyond the shared masking);
 *  - RATE LIMITER: the dedicated `cron-sweep` namespace — the sweep
 *    factory's OWN exported config (`cronSweepRateLimiter` from
 *    `backend/lib/gateway/cron-endpoint.ts`), never re-declared — keyed
 *    on client IP, runs AFTER both bare-404 existence gates and BEFORE
 *    the credential compare: failed-auth attempts past the quota answer
 *    429 `RATE_LIMIT_EXCEEDED` through the shared envelope, and a
 *    correct bearer cannot bypass a spent quota (the throttle sits
 *    before the secret compare — 100 garbage-bearer probes lock the
 *    window and the next VALID bearer answers 429 with the sweep never
 *    invoked);
 *  - the quota is keyed on the client IP (a second IP gets a fresh
 *    window), and disabled/unconfigured-surface traffic never consumes
 *    limiter state (both bare-404 gates precede the limiter).
 *
 * Env stubbing: the three `CRON_*` keys are read live through `getEnv`
 * (`process.env`, no cache — see `backend/lib/env.ts`); the provider and
 * API key travel through the TYPED cached snapshot, so every change is
 * committed with `resetEnvironmentCache()`. Every test restores the keys
 * it touched. The rate limiter (`@/backend/lib/ratelimit`) is swapped
 * for an INSTRUMENTED FAKE via Bun's module mock registry BEFORE the
 * route module loads (the expire-subscriptions suite's exact mechanism):
 * a fixed-window per-identifier counter honoring the real limiter's
 * contract, whose counters reset per test.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/cron/reconcile-paymob-payments/test/reconcile-paymob-payments-route.test.ts`.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// set-locale route test documents.
import { NextRequest } from "next/server";
// Type-only import: erased at compile time, so it never touches the mock
// registry that shadows `@/backend/lib/ratelimit` below.
import type { RateLimiterConfig, RateLimitResult } from "@/backend/lib/ratelimit";

// Module-boundary mock: the route must exercise ONLY its own
// gate/envelope logic here; the sweep's DB and inquiry semantics belong
// to the service suite.
const sweepCalls: Array<{ now: Date }> = [];
let sweepResult: { checked: number; confirmed: number; failed: number; skipped: number } = {
  checked: 0,
  confirmed: 0,
  failed: 0,
  skipped: 0,
};
let sweepThrowable: unknown = null;

void mock.module("@/backend/services/billing/payment-gateway/paymob/paymob.reconcile", () => ({
  reconcilePendingPaymobPayments: async (deps: {
    now: Date;
  }): Promise<{ checked: number; confirmed: number; failed: number; skipped: number }> => {
    sweepCalls.push({ now: deps.now });
    if (sweepThrowable !== null) {
      throw sweepThrowable;
    }
    return sweepResult;
  },
}));

// Module-boundary mock #2 — the rate limiter: the lib's window semantics
// belong to the lib. This instrumented fake honors the REAL limiter
// contract — a fixed-window per-identifier counter that flips to
// success:false the moment the quota is crossed — so the route's 429 path
// is proven against the exact behavior the real limiter enforces.
// `getClientIdentifier` mirrors the real extractor (the route resolves
// its limiter key through the shared helper, never by hand); the sibling
// limiter configs are re-provided to keep the module shape complete.
const rateLimitCounters = new Map<string, { count: number; windowStart: number }>();
let capturedLimiter: RateLimiterConfig | null = null;

void mock.module("@/backend/lib/ratelimit", () => ({
  checkRateLimit: async (identifier: string, limiter: RateLimiterConfig): Promise<RateLimitResult> => {
    capturedLimiter = limiter;
    const now = Date.now();
    const entry = rateLimitCounters.get(identifier);
    if (entry === undefined || now - entry.windowStart >= limiter.windowMs) {
      rateLimitCounters.set(identifier, { count: 1, windowStart: now });
      return { success: true, limit: limiter.limit, remaining: limiter.limit - 1, reset: now + limiter.windowMs };
    }
    entry.count += 1;
    if (entry.count > limiter.limit) {
      return { success: false, limit: limiter.limit, remaining: 0, reset: entry.windowStart + limiter.windowMs };
    }
    return {
      success: true,
      limit: limiter.limit,
      remaining: limiter.limit - entry.count,
      reset: entry.windowStart + limiter.windowMs,
    };
  },
  getClientIdentifier: (request: Request): string => {
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      const candidate = realIp.trim();
      if (candidate) {
        return candidate;
      }
    }
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const entries = xff.split(",");
      const rightmost = entries[entries.length - 1]?.trim();
      if (rightmost) {
        return rightmost;
      }
    }
    return "local";
  },
  clearRateLimitStore: (): void => {
    rateLimitCounters.clear();
  },
  graphqlRateLimiter: { name: "graphql-public", limit: 100, windowMs: 60_000 },
  portalReadLimiter: { name: "portal-read", limit: 30, windowMs: 60_000 },
}));

/** The reset mechanism: counters (and the captured limiter) clear per test. */
function resetRateLimiter(): void {
  rateLimitCounters.clear();
  capturedLimiter = null;
}

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order; the eslint import-order exemption is
// documented inline where the lint config expects it).
import { GET } from "@/app/api/cron/reconcile-paymob-payments/route";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { cronSweepRateLimiter } from "@/backend/lib/gateway/cron-endpoint";

const BASE_URL = "http://localhost:3000/api/cron/reconcile-paymob-payments";

const ENV_KEYS = [
  "CRON_EXECUTION_MODE",
  "CRON_EXTERNAL_ENABLED",
  "CRON_SECRET",
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMOB_API_KEY",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

function setCronGatesOpen(): void {
  process.env.CRON_EXECUTION_MODE = "external";
  process.env.CRON_EXTERNAL_ENABLED = "true";
}

/** Paymob active + the reconciliation inquiry credential configured. */
function configureReconciliation(): void {
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
  process.env.PAYMOB_API_KEY = "paymob-reconcile-route-test-api-key";
  resetEnvironmentCache();
}

/** Cron mode gates + bearer secret + reconciliation configured. */
function openSurface(secret = "correct-secret"): void {
  setCronGatesOpen();
  process.env.CRON_SECRET = secret;
  configureReconciliation();
}

function requestWithBearer(bearer: string | null): NextRequest {
  const headers = new Headers();
  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  return new NextRequest(BASE_URL, { headers });
}

function requestFromIp(bearer: string | null, ip: string): NextRequest {
  // The limiter keys on the client IP (x-forwarded-for first entry) —
  // this helper pins that keying for per-IP window assertions.
  const headers = new Headers();
  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  headers.set("x-forwarded-for", ip);
  return new NextRequest(BASE_URL, { headers });
}

// ─── Assertion-free payload narrowing (set-locale precedent) ────────────────

function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json();
  if (!isPlainJsonObject(parsed)) {
    throw new Error(`response body was not a JSON object: status ${response.status}`);
  }
  return parsed;
}

afterEach(() => {
  sweepCalls.length = 0;
  sweepResult = { checked: 0, confirmed: 0, failed: 0, skipped: 0 };
  sweepThrowable = null;
  resetRateLimiter();
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  // Drop the typed snapshot a test built so the next test re-reads fresh.
  resetEnvironmentCache();
});

describe("reconcile-paymob-payments cron route — cron mode gates fail closed", () => {
  test("disabled mode answers the bare endpoint-shaped 404 even WITH credentials", async () => {
    process.env.CRON_EXECUTION_MODE = "internal";
    process.env.CRON_EXTERNAL_ENABLED = "true";
    process.env.CRON_SECRET = "test-secret";
    configureReconciliation();
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    // BARE — no envelope, no code, no requestId: indistinguishable from any
    // other unknown path (the envelope's `code` would be an oracle).
    expect(await response.text()).toBe("");
    // The sweep never runs for a disabled surface.
    expect(sweepCalls).toHaveLength(0);
  });

  test("external-enabled flag unset answers the bare 404 regardless of the mode value", async () => {
    process.env.CRON_EXECUTION_MODE = "external";
    delete process.env.CRON_EXTERNAL_ENABLED;
    process.env.CRON_SECRET = "test-secret";
    configureReconciliation();
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });

  test("both gates unset with no credentials and no gateway configured answers the bare 404 (no oracle)", async () => {
    delete process.env.CRON_EXECUTION_MODE;
    delete process.env.CRON_EXTERNAL_ENABLED;
    delete process.env.CRON_SECRET;
    delete process.env.PAYMENT_GATEWAY_PROVIDER;
    delete process.env.PAYMOB_API_KEY;
    resetEnvironmentCache();
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });
});

describe("reconcile-paymob-payments cron route — provider configuration gate", () => {
  test("non-paymob active provider answers the bare 404 even with CORRECT credentials", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
    process.env.PAYMOB_API_KEY = "paymob-reconcile-route-test-api-key";
    resetEnvironmentCache();
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(404);
    // BARE — a valid credential must not prove the surface exists while
    // the deployment's active provider never reconciles through it.
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });

  test("paymob active but the reconciliation API key unset answers the bare 404 with correct credentials", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    delete process.env.PAYMOB_API_KEY;
    resetEnvironmentCache();
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });

  test("a whitespace-only API key parses to unconfigured → bare 404", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    process.env.PAYMOB_API_KEY = "   ";
    resetEnvironmentCache();
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });

  test("a mid-flight provider flip is honored on the very next run", async () => {
    openSurface();
    const first = await GET(requestWithBearer("correct-secret"));
    expect(first.status).toBe(200);
    expect(sweepCalls).toHaveLength(1);

    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
    resetEnvironmentCache();
    const second = await GET(requestWithBearer("correct-secret"));
    expect(second.status).toBe(404);
    expect(await second.text()).toBe("");
    expect(sweepCalls).toHaveLength(1);

    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    resetEnvironmentCache();
    const third = await GET(requestWithBearer("correct-secret"));
    expect(third.status).toBe(200);
    expect(sweepCalls).toHaveLength(2);
  });
});

describe("reconcile-paymob-payments cron route — bearer gate", () => {
  test("gates + provider open + missing CRON_SECRET fails closed to 401 for ANY presented bearer", async () => {
    setCronGatesOpen();
    delete process.env.CRON_SECRET;
    configureReconciliation();
    const response = await GET(requestWithBearer("anything"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(sweepCalls).toHaveLength(0);
  });

  test("gates + provider open + an empty-string CRON_SECRET stays closed to 401 for ANY presented bearer", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "";
    configureReconciliation();
    const response = await GET(requestWithBearer("anything"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(sweepCalls).toHaveLength(0);
  });

  test("wrong bearer answers 401 UNAUTHORIZED", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    configureReconciliation();
    const response = await GET(requestWithBearer("wrong-secret"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(sweepCalls).toHaveLength(0);
  });

  test("missing bearer with a configured secret answers 401", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    configureReconciliation();
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(401);
    expect(sweepCalls).toHaveLength(0);
  });

  test("a blank presented bearer token (header present, token empty) answers 401", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    configureReconciliation();
    const headers = new Headers();
    headers.set("authorization", "Bearer ");
    const response = await GET(new NextRequest(BASE_URL, { headers }));
    expect(response.status).toBe(401);
    expect(sweepCalls).toHaveLength(0);
  });
});

describe("reconcile-paymob-payments cron route — authenticated sweep", () => {
  test("correct bearer returns the honest-tally success envelope and runs the sweep ONCE with a fresh now", async () => {
    openSurface();
    sweepResult = { checked: 5, confirmed: 2, failed: 1, skipped: 2 };
    const before = Date.now();
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    // Honest tally ONLY — no row identities, no extra members.
    expect(data.checked).toBe(5);
    expect(data.confirmed).toBe(2);
    expect(data.failed).toBe(1);
    expect(data.skipped).toBe(2);
    expect(Object.keys(data).toSorted((a, b) => a.localeCompare(b))).toEqual([
      "checked",
      "confirmed",
      "failed",
      "skipped",
    ]);
    expect(typeof body.requestId).toBe("string");
    // The route delegates exactly once, with the current instant.
    expect(sweepCalls).toHaveLength(1);
    expect(sweepCalls[0].now).toBeInstanceOf(Date);
    expect(sweepCalls[0].now.getTime()).toBeGreaterThanOrEqual(before);
  });

  test("the idempotent zero-count sweep returns zero counters byte-equally", async () => {
    openSurface();
    sweepResult = { checked: 0, confirmed: 0, failed: 0, skipped: 0 };
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    expect(data.checked).toBe(0);
    expect(data.confirmed).toBe(0);
    expect(data.failed).toBe(0);
    expect(data.skipped).toBe(0);
    expect(sweepCalls).toHaveLength(1);
  });

  test("a sweep thrown failure is MASKED through the shared error envelope (never a raw escape)", async () => {
    openSurface();
    // A raw non-domain throw (e.g. an infrastructure breach inside the
    // settlement surface surfacing as a driver error) — the route's catch
    // must mask it behind the localized generic failure, one correlated
    // log line, 500 INTERNAL_SERVER_ERROR.
    sweepThrowable = new Error("settlement lane unreadable (simulated driver failure)");
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(500);
    const body = await readJson(response);
    if (!isPlainJsonObject(body.error)) {
      throw new Error("expected an error envelope");
    }
    expect(body.error.code).toBe("INTERNAL_SERVER_ERROR");
    // The error envelope carries the correlation id INSIDE `error`.
    expect(typeof body.error.requestId).toBe("string");
    // The masked message must NOT carry the raw throw text.
    const message = body.error.message;
    if (typeof message !== "string") {
      throw new Error("expected a string message");
    }
    expect(message).not.toContain("simulated driver failure");
    expect(sweepCalls).toHaveLength(1);
  });
});

describe("reconcile-paymob-payments cron route — rate limiter parity with the sweep factory", () => {
  test("the route enforces the factory's own exported cronSweepRateLimiter config (single-sourced, never re-declared)", async () => {
    openSurface();
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    // IDENTITY, not shape: the config object handed to checkRateLimit IS
    // the factory's export — a route-local re-declaration would fail here.
    expect(capturedLimiter).toBe(cronSweepRateLimiter);
    expect(capturedLimiter?.name).toBe("cron-sweep");
  });

  test("at-cap requests from one IP all succeed; the over-cap 101st answers 429 RATE_LIMIT_EXCEEDED and the sweep never runs", async () => {
    openSurface();
    // The fake's counter body runs synchronously per invocation, so the
    // concurrent burst still lands in one fixed window (count 1..100).
    const atCap = await Promise.all(
      Array.from({ length: 100 }, () => GET(requestFromIp("correct-secret", "203.0.113.10")))
    );
    expect(atCap.every(response => response.status === 200)).toBe(true);
    expect(sweepCalls).toHaveLength(100);
    // The 101st request from the SAME IP crosses the fixed-window quota:
    // 429 through the shared envelope, and the sweep does NOT run.
    const overCap = await GET(requestFromIp("correct-secret", "203.0.113.10"));
    expect(overCap.status).toBe(429);
    const body = await readJson(overCap);
    if (!isPlainJsonObject(body.error)) {
      throw new Error("expected an error envelope");
    }
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(sweepCalls).toHaveLength(100);
    // A DIFFERENT IP gets a fresh window — the limiter keys on client IP.
    const freshIp = await GET(requestFromIp("correct-secret", "203.0.113.20"));
    expect(freshIp.status).toBe(200);
    expect(sweepCalls).toHaveLength(101);
  });

  test("secret-hammering: 100 garbage-bearer probes lock the window; the next VALID bearer answers 429 — the secret compare is never reached for it", async () => {
    openSurface();
    // 100 garbage bearers inside the 60s window: each probe PASSES the
    // limiter (still under quota), then fails the bearer compare → 401 —
    // so every probe consumes limiter state exactly like any other attempt.
    const probes = await Promise.all(
      Array.from({ length: 100 }, (_, i) => GET(requestFromIp(`garbage-bearer-${i}`, "198.51.100.7")))
    );
    expect(probes.every(response => response.status === 401)).toBe(true);
    expect(sweepCalls).toHaveLength(0);
    // The 101st request carries the CORRECT bearer but the quota is spent:
    // 429, not 200 — the limiter sits BEFORE the secret compare, so the
    // timing-safe compare is never reached for the throttled request (the
    // sweep running would prove the compare had succeeded; it stays idle).
    const throttled = await GET(requestFromIp("correct-secret", "198.51.100.7"));
    expect(throttled.status).toBe(429);
    const body = await readJson(throttled);
    if (!isPlainJsonObject(body.error)) {
      throw new Error("expected an error envelope");
    }
    expect(body.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(sweepCalls).toHaveLength(0);
  });

  test("mode-gate 404s never consume limiter state — junk traffic at a disabled surface leaves the window untouched", async () => {
    process.env.CRON_EXECUTION_MODE = "internal";
    process.env.CRON_EXTERNAL_ENABLED = "true";
    process.env.CRON_SECRET = "correct-secret";
    configureReconciliation();
    const junk = await Promise.all(Array.from({ length: 150 }, () => GET(requestFromIp("anything", "192.0.2.30"))));
    expect(junk.every(response => response.status === 404)).toBe(true);
    expect(sweepCalls).toHaveLength(0);
    // Opening the surface hands the SAME IP a fresh, unconsumed window —
    // the first legitimate tick is not throttled by the disabled-era junk.
    setCronGatesOpen();
    const firstLegit = await GET(requestFromIp("correct-secret", "192.0.2.30"));
    expect(firstLegit.status).toBe(200);
    expect(sweepCalls).toHaveLength(1);
  });

  test("provider-gate 404s never consume limiter state — a non-paymob deployment's traffic leaves the window untouched", async () => {
    setCronGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
    process.env.PAYMOB_API_KEY = "paymob-reconcile-route-test-api-key";
    resetEnvironmentCache();
    const junk = await Promise.all(Array.from({ length: 150 }, () => GET(requestFromIp("anything", "203.0.113.50"))));
    expect(junk.every(response => response.status === 404)).toBe(true);
    expect(sweepCalls).toHaveLength(0);
    // Re-configuring paymob hands the SAME IP a fresh window.
    configureReconciliation();
    const firstLegit = await GET(requestFromIp("correct-secret", "203.0.113.50"));
    expect(firstLegit.status).toBe(200);
    expect(sweepCalls).toHaveLength(1);
  });
});
