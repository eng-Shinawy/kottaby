/**
 * Expire-subscriptions cron route contract (`GET /api/cron/expire-subscriptions`).
 *
 * Pure-function tier: the GET handler is invoked directly with constructed
 * `NextRequest`s — NO server boot, NO database (the expiry service is
 * mocked at the module boundary; its transactional behaviour is
 * exhaustively pinned by `backend/services/billing/subscription-expiry.service.test.ts`).
 *
 * Coverage map:
 *  - MODE GATES fail closed: with `CRON_EXECUTION_MODE` not "external" OR
 *    `CRON_EXTERNAL_ENABLED` not "true" the surface answers the
 *    endpoint-shaped 404 — indistinguishable from any other unknown path,
 *    regardless of what credentials accompany the request (a disabled
 *    deployment exposes NO expiry endpoint at all);
 *  - MISSING SECRET fails closed: gates open + no `CRON_SECRET` configured
 *    → 401 for ANY presented bearer (never open);
 *  - EMPTY SECRET fails closed: gates open + `CRON_SECRET` configured as
 *    the empty string → 401 (an unconfigured secret must never authenticate);
 *  - WHITESPACE-ONLY SECRET fails closed: gates open + `CRON_SECRET`
 *    configured as whitespace-only → 401 — behaves EXACTLY like an unset
 *    secret (the factory trims the configured value once, so a whitespace
 *    config is treated as unconfigured by design, not by accident);
 *  - WRONG BEARER → 401 (`UNAUTHORIZED` envelope);
 *  - MISSING BEARER → 401;
 *  - QUERY-STRING SECRET is never accepted — only the `Authorization`
 *    header authenticates;
 *  - CORRECT BEARER → 200 success envelope `{ data: { expired, lanesZeroed },
 *    requestId }` — the HONEST COUNTS ONLY contract: no row identities
 *    cross the wire, and the zero-row idempotent re-sweep returns
 *    `{ expired: 0, lanesZeroed: 0 }` byte-equally;
 *  - the service mock records EXACTLY ONE invocation per authenticated
 *    call (the route owns no sweep logic of its own);
 *  - a service THROWN failure propagates through the shared error envelope
 *    machinery (masked per the lib-level taxonomy — the route adds no
 *    bespoke try/catch of its own);
 *  - RATE LIMITER: the dedicated `cron-sweep` namespace keyed on client IP
 *    runs AFTER the mode gates and BEFORE the credential compare —
 *    failed-auth attempts past the quota answer 429 `RATE_LIMIT_EXCEEDED`
 *    through the shared envelope, and a correct bearer cannot bypass a
 *    spent quota (the throttle sits before the secret compare);
 *  - the quota is keyed on the client IP (a second IP gets a fresh window).
 *
 * Env stubbing works because `getEnv` reads `process.env` live (no cache —
 * see `backend/lib/env.ts`); every test restores the three keys it touched.
 * The rate limiter (`@/backend/lib/ratelimit`) is swapped for an
 * INSTRUMENTED FAKE via Bun's module mock registry BEFORE the route module
 * loads (the graphql suite's exact mechanism): a fixed-window per-identifier
 * counter honoring the real limiter's contract, whose counters reset per
 * test. Today the real limiter is a fail-open stub (`checkRateLimit` always
 * returns success) — the fake proves the route's 429 path against the
 * behavior the real limiter will land with.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts`.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// set-locale route test documents.
import { NextRequest } from "next/server";
// Type-only import: erased at compile time, so it never touches the mock
// registry that shadows `@/backend/lib/ratelimit` below.
import type { RateLimiterConfig, RateLimitResult } from "@/backend/lib/ratelimit";

// Module-boundary mock: the route must exercise ONLY its own gate/envelope
// logic here; the service's DB semantics belong to the service suite.
const expireCalls: number[] = [];
let expireResult: { expired: number; lanesZeroed: number } = { expired: 0, lanesZeroed: 0 };
let expireThrowable: unknown = null;

void mock.module("@/backend/services/billing", () => ({
  SubscriptionExpiryService: {
    expireDue: async (): Promise<{ expired: number; lanesZeroed: number }> => {
      expireCalls.push(expireCalls.length + 1);
      if (expireThrowable !== null) {
        throw expireThrowable;
      }
      return expireResult;
    },
  },
}));

// Module-boundary mock #2 — the rate limiter: the lib's Redis semantics
// belong to the lib (today `checkRateLimit` is a fail-open stub). This
// instrumented fake honors the REAL limiter contract — a fixed-window
// per-identifier counter that flips to success:false the moment the quota
// is crossed — so the route's 429 path is proven against the exact behavior
// the real limiter will land with. `getClientIdentifier` mirrors the real
// extractor (the constructed NextRequests carry no IP headers, so every
// call shares the "local" identifier); `graphqlRateLimiter` re-provided to
// keep the module shape complete.
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
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      return xff.split(",")[0]?.trim() ?? "local";
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp) {
      return realIp.trim();
    }
    return "local";
  },
  graphqlRateLimiter: { name: "graphql-public", limit: 100, windowMs: 60_000 },
}));

/** The reset mechanism: counters (and the captured limiter) clear per test. */
function resetRateLimiter(): void {
  rateLimitCounters.clear();
  capturedLimiter = null;
}

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order; the eslint import-order exemption is
// documented inline where the lint config expects it).
import { GET } from "@/app/api/cron/expire-subscriptions/route";

const BASE_URL = "http://localhost:3000/api/cron/expire-subscriptions";

const ENV_KEYS = ["CRON_EXECUTION_MODE", "CRON_EXTERNAL_ENABLED", "CRON_SECRET"] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

function setGatesOpen(): void {
  process.env.CRON_EXECUTION_MODE = "external";
  process.env.CRON_EXTERNAL_ENABLED = "true";
}

function requestWithBearer(bearer: string | null): NextRequest {
  const headers = new Headers();
  if (bearer !== null) {
    headers.set("authorization", `Bearer ${bearer}`);
  }
  return new NextRequest(BASE_URL, { headers });
}

function requestWithQueryStringSecret(): NextRequest {
  // The secret is smuggled through the query string ONLY — no authorization
  // header is presented, so nothing else can authenticate the call.
  return new NextRequest(`${BASE_URL}?secret=correct-secret&token=correct-secret`, { headers: new Headers() });
}

function requestFromIp(bearer: string | null, ip: string): NextRequest {
  // The limiter keys on the client IP (x-forwarded-for first entry), so a
  // second IP must get a fresh window — this helper pins that keying.
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
  expireCalls.length = 0;
  expireResult = { expired: 0, lanesZeroed: 0 };
  expireThrowable = null;
  resetRateLimiter();
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
});

describe("expire-subscriptions cron route — mode gates fail closed", () => {
  test("disabled mode answers the bare endpoint-shaped 404 even WITH credentials", async () => {
    process.env.CRON_EXECUTION_MODE = "internal";
    process.env.CRON_EXTERNAL_ENABLED = "true";
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    // BARE — no envelope, no code, no requestId: indistinguishable from any
    // other unknown path (the envelope's `code` would be an oracle).
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toBeNull();
    // The service never runs for a disabled surface.
    expect(expireCalls).toHaveLength(0);
  });

  test("external-enabled flag unset answers the bare 404 regardless of the mode value", async () => {
    process.env.CRON_EXECUTION_MODE = "external";
    delete process.env.CRON_EXTERNAL_ENABLED;
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(expireCalls).toHaveLength(0);
  });

  test("both gates unset answers the bare 404 even without any credentials (no oracle)", async () => {
    delete process.env.CRON_EXECUTION_MODE;
    delete process.env.CRON_EXTERNAL_ENABLED;
    delete process.env.CRON_SECRET;
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(expireCalls).toHaveLength(0);
  });
});

describe("expire-subscriptions cron route — bearer gate", () => {
  test("gates open + missing CRON_SECRET fails closed to 401 for ANY presented bearer", async () => {
    setGatesOpen();
    delete process.env.CRON_SECRET;
    const response = await GET(requestWithBearer("anything"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(expireCalls).toHaveLength(0);
  });

  test("gates open + EMPTY-string CRON_SECRET fails closed to 401 (an unconfigured secret never authenticates)", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "";
    const response = await GET(requestWithBearer(""));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(expireCalls).toHaveLength(0);
  });

  test("gates open + WHITESPACE-only CRON_SECRET fails closed to 401 (behaves exactly like an unset secret)", async () => {
    setGatesOpen();
    // A whitespace-only config must authenticate NOTHING: neither the
    // whitespace bearer the Bearer stripper would strip away anyway, nor a
    // plausible non-whitespace bearer. The factory trims the configured
    // secret once at read time, so this lands 401 by DESIGN (unconfigured),
    // not by the accidental stripper quirk.
    process.env.CRON_SECRET = "   ";
    const whitespaceBearerResponse = await GET(requestWithBearer("   "));
    expect(whitespaceBearerResponse.status).toBe(401);
    const plausibleBearerResponse = await GET(requestWithBearer("anything"));
    expect(plausibleBearerResponse.status).toBe(401);
    const body = await readJson(plausibleBearerResponse);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(expireCalls).toHaveLength(0);
  });

  test("wrong bearer answers 401 UNAUTHORIZED", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    const response = await GET(requestWithBearer("wrong-secret"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(expireCalls).toHaveLength(0);
  });

  test("missing bearer with a configured secret answers 401", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(401);
    expect(expireCalls).toHaveLength(0);
  });

  test("a query-string secret is NEVER accepted — only the Authorization header authenticates", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    const response = await GET(requestWithQueryStringSecret());
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = body.error;
    if (!isPlainJsonObject(error)) {
      throw new Error("expected an error envelope");
    }
    expect(error.code).toBe("UNAUTHORIZED");
    expect(expireCalls).toHaveLength(0);
  });
});

describe("expire-subscriptions cron route — authenticated sweep", () => {
  test("correct bearer returns the honest-counts success envelope and runs the sweep ONCE", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    expireResult = { expired: 4, lanesZeroed: 3 };
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    // Honest counts ONLY — no row identities, no extra members.
    expect(data.expired).toBe(4);
    expect(data.lanesZeroed).toBe(3);
    expect(Object.keys(data).toSorted((a, b) => a.localeCompare(b))).toEqual(["expired", "lanesZeroed"]);
    expect(typeof body.requestId).toBe("string");
    expect(expireCalls).toHaveLength(1);
  });

  test("the idempotent zero-row re-sweep returns zero counts byte-equally", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    expireResult = { expired: 0, lanesZeroed: 0 };
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    expect(data.expired).toBe(0);
    expect(data.lanesZeroed).toBe(0);
    expect(expireCalls).toHaveLength(1);
  });

  test("a service thrown failure is MASKED through the shared error envelope (never a raw escape)", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    // A raw non-domain throw (e.g. an invariant breach surfacing as a
    // driver error) — the route's catch must mask it behind the localized
    // generic failure, one correlated log line, 500 INTERNAL_SERVER_ERROR.
    expireThrowable = new Error("zeroing statement unreadable (simulated driver failure)");
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
    expect(expireCalls).toHaveLength(1);
  });

  test("exceeding the limiter quota answers 429 RATE_LIMIT_EXCEEDED; a second IP gets a fresh window", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    // The route must call the DEDICATED cron-sweep limiter (never the
    // graphql one) — the instrumented fake captures every limiter config.
    // The fake's counter body runs synchronously per invocation, so the
    // concurrent burst still lands in one fixed window (count 1..100).
    const exhausted = await Promise.all(
      Array.from({ length: 100 }, () => GET(requestFromIp("correct-secret", "203.0.113.10")))
    );
    expect(exhausted.every(response => response.status === 200)).toBe(true);
    expect(expireCalls).toHaveLength(100);
    // The 101st request from the SAME IP crosses the fixed-window quota:
    // 429 through the shared envelope, and the sweep does NOT run.
    const throttled = await GET(requestFromIp("correct-secret", "203.0.113.10"));
    expect(throttled.status).toBe(429);
    const throttledBody = await readJson(throttled);
    if (!isPlainJsonObject(throttledBody.error)) {
      throw new Error("expected an error envelope");
    }
    expect(throttledBody.error.code).toBe("RATE_LIMIT_EXCEEDED");
    expect(expireCalls).toHaveLength(100);
    // A DIFFERENT IP gets a fresh window — the limiter keys on client IP.
    const freshIp = await GET(requestFromIp("correct-secret", "203.0.113.20"));
    expect(freshIp.status).toBe(200);
    expect(capturedLimiter?.name).toBe("cron-sweep");
    expect(expireCalls).toHaveLength(101);
  });
});
