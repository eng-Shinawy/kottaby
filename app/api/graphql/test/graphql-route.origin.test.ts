/**
 * GraphQL route — ORIGIN-tier handler-unit suite (the CSRF gate).
 *
 * Handlers and the guard are invoked DIRECTLY with constructed
 * `NextRequest`s — NO server boot (house pattern:
 * app/api/graphql/test/graphql-route.transport.test.ts).
 *
 * Coverage map:
 *  - TIER 1 (branches): every decision of the same-origin gate —
 *    cross-site `Origin` → 403 `FORBIDDEN`; `Origin === nextUrl.origin`,
 *    `*.space-z.ai`, and WebSocket-allowlist origins → pass; `Origin`
 *    absent + `Sec-Fetch-Site` `same-origin`/`none`/absent → pass;
 *    `Origin` absent + `Sec-Fetch-Site` `cross-site`/`same-site` → 403;
 *  - TIER 2 (boundaries): EMPTY-string `Origin`, malformed unparseable
 *    `Origin`, and a port-variant same-host origin (`http://localhost:3001`
 *    vs the request's `http://localhost:3066` — a different port IS a
 *    different origin) all reject;
 *  - TIER 3 (concurrency): a parallel burst mixing every branch proves the
 *    pure guard has no shared-state corruption;
 *  - TIER 4 (abuse): the `https://space-z.ai.attacker.com` suffix trick and
 *    the literal string `null` `Origin` both reject; the 403 envelope leaks
 *    NO raw origin echo;
 *  - Route wiring: the gate runs BEFORE the transport tier — every PASS
 *    case is proven by a downstream TRANSPORT signal (400 `BAD_REQUEST` on
 *    a `text/plain` content-type), and every rejection carries the
 *    localized `forbidden` message + requestId echo;
 *  - Source pins: the guard module is pure (no module-level mutable
 *    state), identity-blind (imports only the origin vocabulary — no
 *    auth/context/service modules), and the route invokes the gate before
 *    `guardTransport`.
 *
 * `WS_ALLOWED_ORIGINS` is stubbed BEFORE the route/guard modules load so
 * the WebSocket-allowlist branch is deterministic (the dev-default
 * localhost origins are replaced by a single pinned origin). A
 * pre-existing host value is captured BEFORE the stub and RESTORED in
 * `afterAll` (deleted only if it was absent) with the environment cache
 * reset, so later suites in the same process see the real configuration
 * again.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/graphql/test/graphql-route.origin.test.ts`.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below.
import { NextRequest } from "next/server";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { getServerTranslations } from "@/shared/locale/server-graphql";

/**
 * Repo root derived RELATIVELY from this suite's own location
 * (`app/api/graphql/test/` → four levels up) — never from `process.cwd()` —
 * so the source-pin scan paths are environment-insensitive (house pattern:
 * the transport suite in this directory, the static-locks suites).
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

// ─── Environment stub (BEFORE the route module loads) ────────────────────────

/** The single allow-listed WebSocket origin this suite pins. */
const WS_ALLOWLISTED_ORIGIN = "https://ws-allowlisted.example";

// Save/restore (house pattern): a host process may already carry a real
// `WS_ALLOWED_ORIGINS` value — capture it BEFORE stubbing, restore it in
// `afterAll`, and DELETE the key only when it was absent pre-stub, so a
// shared-process run never loses the host-provided configuration.
const PREEXISTING_WS_ALLOWED_ORIGINS = process.env.WS_ALLOWED_ORIGINS;

process.env.WS_ALLOWED_ORIGINS = WS_ALLOWLISTED_ORIGIN;
// The environment config is module-cached; invalidate it so the (possibly
// already-cached) config re-reads the stubbed variable.
resetEnvironmentCache();

const { POST } = await import("../route");
const { assertGraphqlPostOrigin } = await import("../origin-guard");

afterAll(() => {
  if (PREEXISTING_WS_ALLOWED_ORIGINS === undefined) {
    delete process.env.WS_ALLOWED_ORIGINS;
  } else {
    process.env.WS_ALLOWED_ORIGINS = PREEXISTING_WS_ALLOWED_ORIGINS;
  }
  resetEnvironmentCache();
});

// ─── Fixtures + narrowing helpers ─────────────────────────────────────────────

const BASE_URL = "http://localhost:3066/api/graphql";
const SAME_ORIGIN = "http://localhost:3066";

const tEn = getServerTranslations("en").errorsTranslations;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function firstRejection(response: Response): Promise<{ message: unknown; code: unknown; requestId: unknown }> {
  const parsed: unknown = await response.json();
  if (!isRecord(parsed)) {
    throw new Error(`response body was not a JSON object: status ${response.status}`);
  }
  const items: unknown = parsed.errors;
  if (!Array.isArray(items) || !isRecord(items[0])) {
    throw new Error("expected a GraphQL-local errors[] payload");
  }
  const extensions: unknown = items[0].extensions;
  if (!isRecord(extensions)) {
    throw new Error("expected record-shaped extensions");
  }
  return { message: items[0].message, code: extensions.code, requestId: extensions.requestId };
}

interface OriginPostOptions {
  readonly origin?: string;
  readonly secFetchSite?: string;
  readonly contentType?: string;
  readonly requestId?: string;
}

function makeOriginPost(options: OriginPostOptions = {}): NextRequest {
  const headers = new Headers();
  if (options.origin !== undefined) {
    headers.set("origin", options.origin);
  }
  if (options.secFetchSite !== undefined) {
    headers.set("sec-fetch-site", options.secFetchSite);
  }
  headers.set("content-type", options.contentType ?? "text/plain");
  if (options.requestId !== undefined) {
    headers.set("x-request-id", options.requestId);
  }
  return new NextRequest(BASE_URL, { method: "POST", headers, body: '{"query":"{ __typename }"}' });
}

// ─── TIER 1 — guard branches (pure unit tier) ─────────────────────────────────

describe("origin gate — pure branch evaluation", () => {
  test("Origin equal to the request's own origin → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: SAME_ORIGIN }))).toEqual({ ok: true });
  });

  test("space-z.ai apex origin → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "https://space-z.ai" }))).toEqual({ ok: true });
  });

  test("*.space-z.ai preview-panel origin → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "https://preview.space-z.ai" }))).toEqual({ ok: true });
  });

  test("WebSocket-allowlist origin → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: WS_ALLOWLISTED_ORIGIN }))).toEqual({ ok: true });
  });

  test("cross-site Origin → reject with the machine kind only", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "https://evil.example" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });

  test("Origin absent + Sec-Fetch-Site: same-origin → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ secFetchSite: "same-origin" }))).toEqual({ ok: true });
  });

  test("Origin absent + Sec-Fetch-Site: none → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ secFetchSite: "none" }))).toEqual({ ok: true });
  });

  test("Origin absent + Sec-Fetch-Site absent (non-browser client) → pass", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost())).toEqual({ ok: true });
  });

  test("Origin absent + Sec-Fetch-Site: cross-site → reject", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ secFetchSite: "cross-site" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });

  test("Origin absent + Sec-Fetch-Site: same-site (sibling subdomain) → reject", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ secFetchSite: "same-site" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });
});

// ─── TIER 2 — boundary values ─────────────────────────────────────────────────

describe("origin gate — boundary values", () => {
  test("EMPTY-string Origin header (present but blank) → reject", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });

  test("malformed unparseable Origin → reject (URL-parse defense fail-closed)", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "::not-a-url::" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });

  test("port-variant same-host origin (localhost:3001 vs :3066) → reject", () => {
    // Scheme+host+PORT — a different port is a different origin, and it is
    // NOT in this suite's stubbed WebSocket allowlist.
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "http://localhost:3001" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });
});

// ─── TIER 4 — abuse payloads ──────────────────────────────────────────────────

describe("origin gate — abuse payloads (fail-closed)", () => {
  test("suffix-trick Origin https://space-z.ai.attacker.com → reject", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "https://space-z.ai.attacker.com" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });

  test("literal string `null` Origin (sandboxed/opaque origin) → reject", () => {
    expect(assertGraphqlPostOrigin(makeOriginPost({ origin: "null" }))).toEqual({
      ok: false,
      kind: "CROSS_ORIGIN_REJECTED",
    });
  });
});

// ─── TIER 3 — concurrent invocations (purity under burst) ─────────────────────

describe("origin gate — concurrent invocations stay isolated", () => {
  interface BurstCase {
    readonly name: string;
    readonly options: OriginPostOptions;
    readonly expected: "pass" | "reject";
  }

  const BURST_CASES: readonly BurstCase[] = [
    { name: "same-origin", options: { origin: SAME_ORIGIN }, expected: "pass" },
    { name: "space-z", options: { origin: "https://preview.space-z.ai" }, expected: "pass" },
    { name: "ws-allowlist", options: { origin: WS_ALLOWLISTED_ORIGIN }, expected: "pass" },
    { name: "no-origin-browser", options: { secFetchSite: "same-origin" }, expected: "pass" },
    { name: "no-origin-server", options: {}, expected: "pass" },
    { name: "cross-site-origin", options: { origin: "https://evil.example" }, expected: "reject" },
    { name: "cross-site-fetch", options: { secFetchSite: "cross-site" }, expected: "reject" },
    { name: "suffix-trick", options: { origin: "https://space-z.ai.attacker.com" }, expected: "reject" },
    { name: "null-string", options: { origin: "null" }, expected: "reject" },
  ];

  test("parallel burst of mixed verdicts matches each request's own expectation", async () => {
    const rounds = 6;
    const verdicts = await Promise.all(
      BURST_CASES.flatMap(burstCase =>
        Array.from({ length: rounds }, () =>
          Promise.resolve(assertGraphqlPostOrigin(makeOriginPost(burstCase.options)))
        )
      )
    );

    let cursor = 0;
    for (const burstCase of BURST_CASES) {
      for (let i = 0; i < rounds; i += 1) {
        const verdict = verdicts[cursor];
        cursor += 1;
        expect(verdict).toEqual(
          burstCase.expected === "pass" ? { ok: true } : { ok: false, kind: "CROSS_ORIGIN_REJECTED" }
        );
      }
    }
  });

  test("parallel mixed POSTs each answer with their own wire pairing", async () => {
    const responses = await Promise.all(
      BURST_CASES.flatMap((burstCase, caseIndex) =>
        Array.from({ length: 3 }, (_, round) =>
          POST(
            makeOriginPost({
              ...burstCase.options,
              requestId: `corr-burst-${caseIndex}-${round}`,
            })
          )
        )
      )
    );
    // Collect every rejection item up front (no sequential awaits in the
    // assertion loop below).
    const items = await Promise.all(responses.map(response => firstRejection(response)));

    let cursor = 0;
    for (let caseIndex = 0; caseIndex < BURST_CASES.length; caseIndex += 1) {
      const burstCase = BURST_CASES[caseIndex];
      for (let round = 0; round < 3; round += 1) {
        const response = responses[cursor];
        const item = items[cursor];
        cursor += 1;
        if (burstCase.expected === "reject") {
          expect(response.status).toBe(403);
          expect(item.code).toBe("FORBIDDEN");
          expect(item.requestId).toBe(`corr-burst-${caseIndex}-${round}`);
        } else {
          // Passed the origin tier — the downstream TRANSPORT signal is the
          // 400 on the intentionally hostile text/plain content-type.
          expect(response.status).toBe(400);
          expect(item.code).toBe("BAD_REQUEST");
        }
      }
    }
  });
});

// ─── Route wiring — tier ordering + wire envelope ─────────────────────────────

describe("route POST — origin tier wiring", () => {
  test("cross-site Origin → 403 FORBIDDEN with the localized forbidden message + requestId", async () => {
    const response = await POST(makeOriginPost({ origin: "https://evil.example", requestId: "corr-403-origin" }));

    expect(response.status).toBe(403);
    const item = await firstRejection(response);
    expect(item.code).toBe("FORBIDDEN");
    expect(item.message).toBe(tEn.forbidden);
    expect(item.requestId).toBe("corr-403-origin");
  });

  test("Origin absent + Sec-Fetch-Site: cross-site → 403 (forged browser metadata rejected)", async () => {
    const response = await POST(makeOriginPost({ secFetchSite: "cross-site", requestId: "corr-403-sfs" }));

    expect(response.status).toBe(403);
    const item = await firstRejection(response);
    expect(item.code).toBe("FORBIDDEN");
    expect(item.requestId).toBe("corr-403-sfs");
  });

  test("Origin absent + Sec-Fetch-Site: same-origin → passes the origin tier (downstream 400 transport signal)", async () => {
    const response = await POST(makeOriginPost({ secFetchSite: "same-origin", requestId: "corr-pass-sfs" }));

    // NOT 403 — the origin gate passed; the request died at the transport
    // tier on the intentionally hostile content-type.
    expect(response.status).toBe(400);
    const item = await firstRejection(response);
    expect(item.code).toBe("BAD_REQUEST");
    expect(item.requestId).toBe("corr-pass-sfs");
  });

  test("Bearer-style non-browser POST (no Origin, no Sec-Fetch-Site) → passes the origin tier", async () => {
    const response = await POST(makeOriginPost({ requestId: "corr-pass-server-client" }));

    expect(response.status).toBe(400);
    const item = await firstRejection(response);
    expect(item.code).toBe("BAD_REQUEST");
    expect(item.requestId).toBe("corr-pass-server-client");
  });

  test("same-origin browser POST (Origin === nextUrl.origin) → passes the origin tier", async () => {
    const response = await POST(makeOriginPost({ origin: SAME_ORIGIN, requestId: "corr-pass-same" }));

    expect(response.status).toBe(400);
    const item = await firstRejection(response);
    expect(item.code).toBe("BAD_REQUEST");
    expect(item.requestId).toBe("corr-pass-same");
  });

  test("space-z preview-panel origin → passes the origin tier", async () => {
    const response = await POST(
      makeOriginPost({ origin: "https://preview.space-z.ai", requestId: "corr-pass-spacez" })
    );

    expect(response.status).toBe(400);
    const item = await firstRejection(response);
    expect(item.code).toBe("BAD_REQUEST");
  });

  test("WebSocket-allowlist origin → passes the origin tier", async () => {
    const response = await POST(makeOriginPost({ origin: WS_ALLOWLISTED_ORIGIN, requestId: "corr-pass-ws" }));

    expect(response.status).toBe(400);
    const item = await firstRejection(response);
    expect(item.code).toBe("BAD_REQUEST");
  });

  test("port-variant same-host origin → 403 at the route boundary", async () => {
    const response = await POST(makeOriginPost({ origin: "http://localhost:3001", requestId: "corr-403-port" }));

    expect(response.status).toBe(403);
    const item = await firstRejection(response);
    expect(item.code).toBe("FORBIDDEN");
  });

  test("the 403 envelope leaks NO raw origin echo", async () => {
    const hostileOrigin = "https://attacker.example";
    const response = await POST(
      makeOriginPost({ origin: hostileOrigin, requestId: "corr-403-no-echo", contentType: "text/plain" })
    );

    expect(response.status).toBe(403);
    const serialized = JSON.stringify(await response.json());
    expect(serialized.includes("attacker.example")).toBe(false);
    expect(serialized.includes("text/plain")).toBe(false);
    expect(serialized.includes("__typename")).toBe(false);
  });
});

// ─── Source pins — purity, identity-blindness, wiring order ───────────────────

describe("source pins — guard module purity + route wiring order", () => {
  const rawGuardSource = readFileSync(join(REPO_ROOT, "app/api/graphql/origin-guard.ts"), "utf8");
  const rawRouteSource = readFileSync(join(REPO_ROOT, "app/api/graphql/route.ts"), "utf8");

  test("guard module holds NO mutable module-level state", () => {
    expect(/\blet\s/u.test(rawGuardSource)).toBe(false);
    expect(/\bvar\s/u.test(rawGuardSource)).toBe(false);
    expect(rawGuardSource.includes("new Map")).toBe(false);
  });

  test("guard is identity-blind — imports only origin vocabulary, never auth/context/session modules", () => {
    // The gate reads request HEADERS only; any auth/context/session import
    // would break the pre-authorization, identity-blind contract.
    expect(rawGuardSource.includes("@/backend/lib/auth")).toBe(false);
    expect(rawGuardSource.includes("createGraphQLContext")).toBe(false);
    expect(rawGuardSource.includes("@/backend/graphql/")).toBe(false);
    expect(rawGuardSource.includes("@/backend/services/")).toBe(false);
  });

  test("route invokes the origin gate BEFORE the transport guard", () => {
    const gateIndex = rawRouteSource.indexOf("assertGraphqlPostOrigin(request)");
    const transportIndex = rawRouteSource.indexOf("guardTransport(request)");
    expect(gateIndex).toBeGreaterThan(-1);
    expect(transportIndex).toBeGreaterThan(-1);
    expect(gateIndex).toBeLessThan(transportIndex);
  });
});
