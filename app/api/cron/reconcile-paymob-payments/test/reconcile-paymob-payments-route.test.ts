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
 *    adds no bespoke catch beyond the shared masking).
 *
 * Env stubbing: the three `CRON_*` keys are read live through `getEnv`
 * (`process.env`, no cache — see `backend/lib/env.ts`); the provider and
 * API key travel through the TYPED cached snapshot, so every change is
 * committed with `resetEnvironmentCache()`. Every test restores the keys
 * it touched.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/cron/reconcile-paymob-payments/test/reconcile-paymob-payments-route.test.ts`.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// set-locale route test documents.
import { NextRequest } from "next/server";

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

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order; the eslint import-order exemption is
// documented inline where the lint config expects it).
import { GET } from "@/app/api/cron/reconcile-paymob-payments/route";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";

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
