/**
 * Sweep-inactive-teachers cron route contract
 * (`GET /api/cron/sweep-inactive-teachers`).
 *
 * Pure-function tier: the GET handler is invoked directly with constructed
 * `NextRequest`s — NO server boot, NO database (the inactivity service is
 * mocked at the module boundary; its transactional behaviour is exhaustively
 * pinned by `backend/services/teachers/teacher-inactivity.service.test.ts`).
 *
 * Coverage map:
 *  - MODE GATES fail closed: with `CRON_EXECUTION_MODE` not "external" OR
 *    `CRON_EXTERNAL_ENABLED` not "true" the surface answers the
 *    endpoint-shaped 404 — indistinguishable from any other unknown path,
 *    regardless of what credentials accompany the request (a disabled
 *    deployment exposes NO sweep endpoint at all);
 *  - MISSING SECRET fails closed: gates open + no `CRON_SECRET` configured
 *    → 401 for ANY presented bearer (never open);
 *  - WRONG BEARER → 401 (`UNAUTHORIZED` envelope) — including a
 *    well-formed role token (a student/parent-shaped JWT bearer): role
 *    tokens never arm the sweep;
 *  - CORRECT BEARER → 200 success envelope `{ data: { offlined }, requestId }`
 *    — the HONEST COUNT ONLY contract: no row identities cross the wire,
 *    and the zero-row idempotent re-sweep returns `{ offlined: 0 }`
 *    byte-equally;
 *  - the service mock records EXACTLY ONE invocation per authenticated
 *    call (the route owns no sweep logic of its own);
 *  - a service THROWN failure propagates through the shared error envelope
 *    machinery (masked per the lib-level taxonomy — the route adds no
 *    bespoke try/catch).
 *
 * Env stubbing works because `getEnv` reads `process.env` live (no cache —
 * see `backend/lib/env.ts`); every test restores the three keys it touched.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/cron/sweep-inactive-teachers/test/sweep-inactive-teachers-route.test.ts`.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// set-locale route test documents.
import { NextRequest } from "next/server";

// Module-boundary mock: the route must exercise ONLY its own gate/envelope
// logic here; the service's DB semantics belong to the service suite.
const sweepCalls: number[] = [];
let sweepResult: { offlined: number } = { offlined: 0 };
let sweepThrowable: unknown = null;

void mock.module("@/backend/services/teachers/teacher-inactivity.service", () => ({
  TeacherInactivityService: {
    sweepInactiveTeachers: async (): Promise<{ offlined: number }> => {
      sweepCalls.push(sweepCalls.length + 1);
      if (sweepThrowable !== null) {
        throw sweepThrowable;
      }
      return sweepResult;
    },
  },
}));

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order; the eslint import-order exemption is
// documented inline where the lint config expects it).
import { GET } from "@/app/api/cron/sweep-inactive-teachers/route";

const BASE_URL = "http://localhost:3000/api/cron/sweep-inactive-teachers";

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
  sweepResult = { offlined: 0 };
  sweepThrowable = null;
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
});

describe("sweep-inactive-teachers cron route — mode gates fail closed", () => {
  test("disabled mode answers the bare endpoint-shaped 404 even WITH credentials", async () => {
    process.env.CRON_EXECUTION_MODE = "internal";
    process.env.CRON_EXTERNAL_ENABLED = "true";
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    // BARE — no envelope, no code, no requestId: indistinguishable from any
    // other unknown path (the envelope's `code` would be an oracle).
    expect(await response.text()).toBe("");
    // The service never runs for a disabled surface.
    expect(sweepCalls).toHaveLength(0);
  });

  test("external-enabled flag unset answers the bare 404 regardless of the mode value", async () => {
    process.env.CRON_EXECUTION_MODE = "external";
    delete process.env.CRON_EXTERNAL_ENABLED;
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(requestWithBearer("test-secret"));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });

  test("both gates unset answers the bare 404 even without any credentials (no oracle)", async () => {
    delete process.env.CRON_EXECUTION_MODE;
    delete process.env.CRON_EXTERNAL_ENABLED;
    delete process.env.CRON_SECRET;
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(sweepCalls).toHaveLength(0);
  });
});

describe("sweep-inactive-teachers cron route — bearer gate", () => {
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
    expect(sweepCalls).toHaveLength(0);
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
    expect(sweepCalls).toHaveLength(0);
  });

  test("a well-formed low-privilege bearer (a student/parent-shaped token) answers 401 UNAUTHORIZED", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    // A real-looking role credential (three dot-separated JWT segments) is
    // just another wrong bearer to the timing-safe compare — no student or
    // parent token arms the sweep, whatever gate state the deployment has.
    const response = await GET(requestWithBearer("eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiU3R1ZGVudCJ9.c3R1ZGVudC10b2tlbg"));
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
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    const response = await GET(requestWithBearer(null));
    expect(response.status).toBe(401);
    expect(sweepCalls).toHaveLength(0);
  });
});

describe("sweep-inactive-teachers cron route — authenticated sweep", () => {
  test("correct bearer returns the honest-count success envelope and runs the sweep ONCE", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    sweepResult = { offlined: 3 };
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    // Honest count ONLY — no row identities, no extra members.
    expect(data.offlined).toBe(3);
    expect(Object.keys(data).toSorted((a, b) => a.localeCompare(b))).toEqual(["offlined"]);
    expect(typeof body.requestId).toBe("string");
    expect(sweepCalls).toHaveLength(1);
  });

  test("the idempotent zero-row re-sweep returns the zero count byte-equally", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    sweepResult = { offlined: 0 };
    const response = await GET(requestWithBearer("correct-secret"));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    const data = body.data;
    if (!isPlainJsonObject(data)) {
      throw new Error("expected a data envelope");
    }
    expect(data.offlined).toBe(0);
    expect(sweepCalls).toHaveLength(1);
  });

  test("a service thrown failure is MASKED through the shared error envelope (never a raw escape)", async () => {
    setGatesOpen();
    process.env.CRON_SECRET = "correct-secret";
    // A raw non-domain throw (e.g. an invariant breach rolling the sweep
    // pass back) — the route's catch must mask it behind the localized
    // generic failure, one correlated log line, 500 INTERNAL_SERVER_ERROR.
    sweepThrowable = new Error("sweep pass rolled back (simulated driver failure)");
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
