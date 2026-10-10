/**
 * GraphQL route — TRANSPORT-tier handler-unit suite (static-import tier).
 *
 * Handlers are invoked DIRECTLY with constructed `NextRequest`s — NO server
 * boot (house pattern: app/api/set-locale/test/set-locale-route.test.ts).
 *
 * Coverage map:
 *  - Explicit 405 handlers (`PUT`/`DELETE`/`PATCH` + default-denied `GET`) →
 *    guarded rejection envelope + mandatory `Allow: POST` header +
 *    `X-Request-Id` echo (never Next.js' default-absent behavior);
 *  - unsupported/missing content-type → 400 `BAD_REQUEST`;
 *  - malformed JSON / empty body / whitespace-only body boundaries → 400
 *    with the LIVE `GRAPHQL_PARSE_FAILED` pairing (stream deaths and
 *    unparseable bodies share the kind→code row);
 *  - forged INFLATED `content-length` → 413 `PAYLOAD_TOO_LARGE` pre-drain,
 *    deflated-header lie caught at the DRAINED checkpoint (both size
 *    checkpoints proven distinct);
 *  - the transport wire map is EXHAUSTIVE over the `TransportErrorKind`
 *    union, both new kinds included: `CROSS_ORIGIN_REJECTED` → 403
 *    `FORBIDDEN` with the localized `forbidden` message,
 *    `BATCH_OPERATION_LIMIT` → 400 with code `BATCH_OPERATION_LIMIT`;
 *    direct builder calls cover every row, a concurrent-call burst proves
 *    no shared-state corruption, and the new-kind envelopes are pinned to
 *    machine members ONLY (zero raw origin/header/body echo);
 *  - MISSING `content-length` falls through the declared checkpoint without
 *    crashing (live predicate preserved verbatim by `guardTransport`);
 *  - batched-operation amplification cap: a JSON-array body longer than
 *    `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` → 400 `BATCH_OPERATION_LIMIT`
 *    (branch + boundary matrix on `assertBatchOperationCount`, the cap−1 /
 *    cap / cap+1 / empty-array edges, single-object bodies unaffected by
 *    design, mixed concurrent posts verdict-isolated, and the order proof
 *    that a 2 MB body carrying 11 ops is rejected by the SIZE guard first);
 *  - envelope SHAPE is the GraphQL-local `{errors:[{message,
 *    extensions:{code,requestId}}]}` exemption-row form — NEVER the REST
 *    envelope (docs/graphql/error-handling-contract.md §exemption register);
 *  - localization rides the compile-time i18n `errors` namespace (en + ar
 *    parity rows);
 *  - zero-leak + constant-unification source pins: the deleted inline
 *    `GRAPHQL_MAX_BODY_BYTES` copy appears NOWHERE in the route, the body
 *    limit is owned exclusively by `@/backend/lib/gateway`, cookie merging
 *    is `headers.append`-only, and the client Apollo provider's
 *    `batchMax` literal equals the imported server
 *    `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` (cross-layer parity — the two
 *    cannot share an import, so the client source text is scanned).
 *
 * The happy-path engine/context flow (ordering + cookie atomicity) lives in
 * graphql-route.pipeline-order.test.ts (injected-fake tier).
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/graphql/test/graphql-route.transport.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below (type-only
// form detonates at runtime).
import { NextRequest } from "next/server";
import { DELETE, GET, PATCH, POST, PUT } from "@/app/api/graphql/route";
import { transportRejectionResponse } from "@/app/api/graphql/transport-rejection";
import {
  assertBatchOperationCount,
  guardTransport,
  MAX_GRAPHQL_BODY_BYTES,
  MAX_GRAPHQL_OPERATIONS_PER_REQUEST,
} from "@/backend/lib/gateway";
import type { TransportErrorKind, TransportGuardResult } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const BASE_URL = "http://localhost:3066/api/graphql";

/**
 * Repo root derived RELATIVELY from this suite's own location
 * (`app/api/graphql/test/` → four levels up) — never from `process.cwd()` —
 * so the source-pin scan paths are environment-insensitive (house pattern:
 * the static-locks suites).
 */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

const tEn = getServerTranslations("en").errorsTranslations;
const tAr = getServerTranslations("ar").errorsTranslations;

// ─── Assertion-free payload narrowing (house helpers) ───────────────────────

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

function errorsArrayOf(body: Record<string, unknown>): readonly unknown[] {
  const candidate: unknown = body.errors;
  if (!Array.isArray(candidate)) {
    throw new Error("expected a GraphQL-local errors[] payload");
  }
  return candidate;
}

/** Full structural narrowing of ONE transport rejection item. */
interface TransportRejectionItem {
  readonly message: unknown;
  readonly extensions: { readonly code: unknown; readonly requestId: unknown };
}

function firstRejectionItem(response: Response): Promise<TransportRejectionItem> {
  return readJson(response).then(body => {
    const items = errorsArrayOf(body);
    if (!isPlainJsonObject(items[0])) {
      throw new Error("expected a record-shaped first error item");
    }
    const extensions: unknown = items[0].extensions;
    if (!isPlainJsonObject(extensions)) {
      throw new Error("expected record-shaped extensions");
    }
    return {
      message: items[0].message,
      extensions: { code: extensions.code, requestId: extensions.requestId },
    };
  });
}

// ─── Request fixtures ────────────────────────────────────────────────────────

interface PostOptions {
  readonly contentType?: string | null;
  readonly headers?: Record<string, string>;
  readonly bodyText?: string;
  readonly extraContentLength?: string | null;
}

function makePostRequest(options: PostOptions = {}): NextRequest {
  const headers = new Headers(options.headers);
  if (options.contentType !== null) {
    headers.set("content-type", options.contentType ?? "application/json");
  }
  if (options.extraContentLength !== undefined) {
    if (options.extraContentLength === null) {
      headers.delete("content-length");
    } else {
      headers.set("content-length", options.extraContentLength);
    }
  }
  return new NextRequest(BASE_URL, { method: "POST", headers, body: options.bodyText ?? "" });
}

function makeDisallowedRequest(method: "GET" | "PUT" | "DELETE" | "PATCH", requestId: string): NextRequest {
  return new NextRequest(BASE_URL, { method, headers: { "x-request-id": requestId } });
}

// ─── Shared invariant runner: every disallowed-method export ────────────────

describe("explicit disallowed-method exports → guarded 405 envelope", () => {
  const HANDLERS = [
    { name: "PUT", call: PUT },
    { name: "DELETE", call: DELETE },
    { name: "PATCH", call: PATCH },
    { name: "GET default-denied", call: GET },
  ] as const;

  for (const entry of HANDLERS) {
    test(`${entry.name} → 405 with Allow: POST, localized message, requestId echo`, async () => {
      const response = await entry.call(
        makeDisallowedRequest(entry.name === "GET default-denied" ? "GET" : entry.name, `corr-405-${entry.name}`)
      );

      expect(response.status).toBe(405);
      // RFC 9110 — the Allow header is MANDATORY on 405 for this resource.
      expect(response.headers.get("allow")).toBe("POST");

      const item = await firstRejectionItem(response);
      expect(item.extensions.code).toBe("BAD_REQUEST");
      expect(item.message).toBe(tEn.badRequest);
      expect(item.extensions.requestId).toBe(`corr-405-${entry.name}`);
    });
  }

  test("405 responses localize through the ar errors namespace (en–ar parity)", async () => {
    const response = await PUT(
      new NextRequest(BASE_URL, {
        method: "PUT",
        headers: { "accept-language": "ar", "x-request-id": "corr-405-ar" },
      })
    );
    expect(response.status).toBe(405);
    const item = await firstRejectionItem(response);
    expect(item.message).toBe(tAr.badRequest);
    expect(item.extensions.requestId).toBe("corr-405-ar");
  });
});

// ─── Content-type guard rows ─────────────────────────────────────────────────

describe("content-type transport guard → 400 (engine never invoked)", () => {
  test("unsupported media type → 400 BAD_REQUEST envelope with requestId", async () => {
    const response = await POST(
      makePostRequest({
        contentType: "text/plain",
        bodyText: '{"query":"{ _health { status } }"}',
        headers: { "x-request-id": "corr-wrong-ct" },
      })
    );

    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("BAD_REQUEST");
    expect(item.message).toBe(tEn.badRequest);
    expect(item.extensions.requestId).toBe("corr-wrong-ct");
  });

  test("MISSING content-type boundary rejects closed BEFORE the stream is touched", async () => {
    const response = await POST(makePostRequest({ contentType: null, bodyText: '{"query":"x"}' }));
    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("BAD_REQUEST");
    expect(typeof item.extensions.requestId).toBe("string");
  });
});

// ─── Malformed-JSON family + body boundaries (LIVE GRAPHQL_PARSE_FAILED pairing) ──

describe("malformed-JSON family → 400 GRAPHQL_PARSE_FAILED (live pairing)", () => {
  test("unparsable body keeps the LIVE transport wire code", async () => {
    const response = await POST(
      makePostRequest({ bodyText: '{"query": "{ _health"', headers: { "x-request-id": "corr-bad-json" } })
    );

    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("GRAPHQL_PARSE_FAILED");
    expect(item.message).toBe(tEn.badRequest);
    expect(item.extensions.requestId).toBe("corr-bad-json");
  });

  test("boundary: EMPTY body parses to nothing → same 400 pairing", async () => {
    const response = await POST(makePostRequest({ bodyText: "", headers: { "content-length": "0" } }));
    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("GRAPHQL_PARSE_FAILED");
  });

  test("boundary: WHITESPACE-ONLY body fails strict JSON.parse → same 400 pairing", async () => {
    const response = await POST(makePostRequest({ bodyText: "   \n\t  " }));
    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("GRAPHQL_PARSE_FAILED");
  });

  test("boundary: MISSING content-length falls through the declared checkpoint then parses-for-real (no crash)", async () => {
    const response = await POST(makePostRequest({ bodyText: "not-json-at-all", extraContentLength: null }));
    // The declared checkpoint MUST skip (missing/garbage header semantics —
    // verbatim live predicate); the failure lands at strict JSON.parse with
    // the identical wire pairing, proving the boundary fell THROUGH rather
    // than rejecting or exploding at the header stage.
    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("GRAPHQL_PARSE_FAILED");
  });
});

// ─── Size checkpoints (declared vs drained, frozen canonical limit) ──────────

describe("body-size checkpoints → 413 PAYLOAD_TOO_LARGE (verbatim reuse)", () => {
  test("forged INFLATED declared length rejects PRE-DRAIN", async () => {
    const response = await POST(
      makePostRequest({
        bodyText: '{"query":"{ _health { status } }"}',
        extraContentLength: "2000001",
        headers: { "x-request-id": "corr-413-declared" },
      })
    );
    expect(response.status).toBe(413);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("PAYLOAD_TOO_LARGE");
    expect(item.extensions.requestId).toBe("corr-413-declared");
  });

  test("DEFATED-header lie is caught at the DRAINED checkpoint (distinct site)", async () => {
    // One byte beyond the canonical limit, declared as tiny — the drained
    // String.length checkpoint must fire BEFORE strict JSON.parse consults.
    const oversizedBody = `{"q":"${"a".repeat(2_000_001)}"}`;
    const response = await POST(makePostRequest({ bodyText: oversizedBody, extraContentLength: "10" }));
    expect(response.status).toBe(413);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

// ─── Batched-operation amplification cap (canonical guard constant) ─────────

function operationArray(count: number): { readonly query: string }[] {
  return Array.from({ length: count }, () => ({ query: "{ _health { status } }" }));
}

function operationArrayText(count: number): string {
  return JSON.stringify(operationArray(count));
}

/** Narrows a failing guard result to its machine kind without assertion casts. */
function failureKind(verdict: TransportGuardResult): TransportErrorKind {
  if (verdict.ok) {
    throw new Error("expected a failing transport verdict");
  }
  return verdict.kind;
}

describe("batched-operation cap — assertBatchOperationCount branch + boundary matrix", () => {
  test("NON-ARRAY bodies pass through untouched (object / null / string — one operation each)", () => {
    const objectBody = { query: "{ _health { status } }" };
    const objectVerdict = assertBatchOperationCount(objectBody);
    if (!objectVerdict.ok) throw new Error("expected the object body to pass");
    expect(objectVerdict.body).toBe(objectBody);

    const nullVerdict = assertBatchOperationCount(null);
    if (!nullVerdict.ok) throw new Error("expected the null body to pass");
    expect(nullVerdict.body).toBeNull();

    const stringVerdict = assertBatchOperationCount("one-string-operation");
    if (!stringVerdict.ok) throw new Error("expected the string body to pass");
    expect(stringVerdict.body).toBe("one-string-operation");
  });

  test("boundary matrix: empty array, cap−1, and cap pass; cap+1 fails closed", () => {
    const passingCounts = [0, MAX_GRAPHQL_OPERATIONS_PER_REQUEST - 1, MAX_GRAPHQL_OPERATIONS_PER_REQUEST];
    for (const count of passingCounts) {
      const verdict = assertBatchOperationCount(operationArray(count));
      if (!verdict.ok) throw new Error(`expected ${count} operations to pass the cap`);
      expect(verdict.body).toHaveLength(count);
    }

    const overVerdict = assertBatchOperationCount(operationArray(MAX_GRAPHQL_OPERATIONS_PER_REQUEST + 1));
    expect(failureKind(overVerdict)).toBe("BATCH_OPERATION_LIMIT");
  });
});

describe("batched-operation cap — guardTransport wiring (order: parse → batch-count)", () => {
  test("cap+1 array body → 400 BATCH_OPERATION_LIMIT envelope end-to-end (engine never reached)", async () => {
    const response = await POST(
      makePostRequest({
        bodyText: operationArrayText(MAX_GRAPHQL_OPERATIONS_PER_REQUEST + 1),
        headers: { "x-request-id": "corr-batch-11" },
      })
    );

    expect(response.status).toBe(400);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("BATCH_OPERATION_LIMIT");
    expect(item.message).toBe(tEn.badRequest);
    expect(item.extensions.requestId).toBe("corr-batch-11");
  });

  test("at-cap array body passes the transport tier (parsed array carried downstream)", async () => {
    const verdict = await guardTransport(
      makePostRequest({ bodyText: operationArrayText(MAX_GRAPHQL_OPERATIONS_PER_REQUEST) })
    );
    if (!verdict.ok) throw new Error("expected the at-cap array to pass the transport tier");
    expect(Array.isArray(verdict.body)).toBe(true);
    expect(verdict.body).toHaveLength(MAX_GRAPHQL_OPERATIONS_PER_REQUEST);
  });

  test("single OBJECT body is unchanged by the cap", async () => {
    const verdict = await guardTransport(makePostRequest({ bodyText: '{"query":"{ _health { status } }"}' }));
    if (!verdict.ok) throw new Error("expected the single-object body to pass");
    expect(verdict.body).toEqual({ query: "{ _health { status } }" });
  });

  test("object body wrapping an embedded array passes by design — embedded data is NOT fan-out", async () => {
    // An array nested inside a single operation is request DATA, not a batch:
    // the engine executes exactly one query for this body, so there is no
    // amplification for the cap to bound. The transport tier must pass it.
    const wrapped = JSON.stringify({
      query: "query($ids: [String!]!) { batched(ids: $ids) { id } }",
      variables: { ids: operationArray(50).map(() => "id-1") },
    });
    const verdict = await guardTransport(makePostRequest({ bodyText: wrapped }));
    if (!verdict.ok) throw new Error("expected the wrapped-object body to pass");
    expect(verdict.body).toEqual(JSON.parse(wrapped));
  });

  test("mixed concurrent posts stay verdict-isolated under Promise.all", async () => {
    const oversizedOps = JSON.stringify([
      { query: "{ _health { status } }", variables: { pad: "a".repeat(MAX_GRAPHQL_BODY_BYTES + 50) } },
      ...operationArray(MAX_GRAPHQL_OPERATIONS_PER_REQUEST),
    ]);

    const verdicts = await Promise.all([
      guardTransport(makePostRequest({ bodyText: operationArrayText(1) })),
      guardTransport(makePostRequest({ bodyText: operationArrayText(MAX_GRAPHQL_OPERATIONS_PER_REQUEST) })),
      guardTransport(makePostRequest({ bodyText: operationArrayText(MAX_GRAPHQL_OPERATIONS_PER_REQUEST + 1) })),
      guardTransport(makePostRequest({ bodyText: oversizedOps, extraContentLength: "10" })),
      guardTransport(makePostRequest({ bodyText: '{"query":' })),
      guardTransport(
        makePostRequest({
          contentType: "text/plain",
          bodyText: operationArrayText(MAX_GRAPHQL_OPERATIONS_PER_REQUEST + 1),
        })
      ),
    ]);

    const singleOp = verdicts[0];
    if (!singleOp.ok) throw new Error("expected the 1-op array to pass");
    expect(singleOp.body).toHaveLength(1);
    const atCap = verdicts[1];
    if (!atCap.ok) throw new Error("expected the at-cap array to pass");
    expect(atCap.body).toHaveLength(MAX_GRAPHQL_OPERATIONS_PER_REQUEST);
    expect(failureKind(verdicts[2])).toBe("BATCH_OPERATION_LIMIT");
    expect(failureKind(verdicts[3])).toBe("PAYLOAD_TOO_LARGE");
    expect(failureKind(verdicts[4])).toBe("MALFORMED_JSON");
    // Content-type guard outranks the batch cap — order holds under concurrency.
    expect(failureKind(verdicts[5])).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  test("oversize body ALSO carrying cap+1 ops → the SIZE guard wins (drained checkpoint precedes parse/batch)", async () => {
    const oversizedOps = JSON.stringify([
      { query: "{ _health { status } }", variables: { pad: "a".repeat(MAX_GRAPHQL_BODY_BYTES + 50) } },
      ...operationArray(MAX_GRAPHQL_OPERATIONS_PER_REQUEST),
    ]);
    expect(oversizedOps.length).toBeGreaterThan(MAX_GRAPHQL_BODY_BYTES);

    // Lying small declared length forces the DRAINED checkpoint to fire —
    // the request must die as 413 size-rejected, never reach parse or the
    // batch cap.
    const response = await POST(makePostRequest({ bodyText: oversizedOps, extraContentLength: "10" }));
    expect(response.status).toBe(413);
    const item = await firstRejectionItem(response);
    expect(item.extensions.code).toBe("PAYLOAD_TOO_LARGE");
  });
});

// ─── Wire-map coverage — exhaustive over the TransportErrorKind union ────────

/** One row per transport kind: the wire pairing the builder must emit. */
interface ExpectedWire {
  readonly status: 400 | 403 | 405 | 413;
  readonly code: string;
  readonly message: string;
}

/**
 * Exhaustive kind→wire expectation table. Typing it as
 * `Record<TransportErrorKind, ExpectedWire>` makes tsgo fail this suite the
 * moment a union member is added without a row here — the enumeration
 * cannot drift from the taxonomy.
 */
const EXPECTED_WIRE: Record<TransportErrorKind, ExpectedWire> = {
  METHOD_NOT_ALLOWED: { status: 405, code: "BAD_REQUEST", message: tEn.badRequest },
  UNSUPPORTED_CONTENT_TYPE: { status: 400, code: "BAD_REQUEST", message: tEn.badRequest },
  PAYLOAD_TOO_LARGE: { status: 413, code: "PAYLOAD_TOO_LARGE", message: tEn.badRequest },
  MALFORMED_JSON: { status: 400, code: "GRAPHQL_PARSE_FAILED", message: tEn.badRequest },
  CROSS_ORIGIN_REJECTED: { status: 403, code: "FORBIDDEN", message: tEn.forbidden },
  BATCH_OPERATION_LIMIT: { status: 400, code: "BATCH_OPERATION_LIMIT", message: tEn.badRequest },
};

/**
 * Runtime enumeration of the union. Contextually typed so each literal is
 * checked against `TransportErrorKind` (no assertion), and pinned to the
 * union-keyed table above by the co-exhaustiveness test below.
 */
const ALL_KINDS: readonly TransportErrorKind[] = [
  "METHOD_NOT_ALLOWED",
  "UNSUPPORTED_CONTENT_TYPE",
  "PAYLOAD_TOO_LARGE",
  "MALFORMED_JSON",
  "CROSS_ORIGIN_REJECTED",
  "BATCH_OPERATION_LIMIT",
];

describe("transport wire map — exhaustive kind→wire coverage", () => {
  test("the enumerated kind list is co-exhaustive with the union-keyed expectation table", () => {
    // Set equality = same size + mutual membership, with no sort semantics.
    expect(new Set(Object.keys(EXPECTED_WIRE))).toEqual(new Set(ALL_KINDS));
  });

  for (const kind of ALL_KINDS) {
    const expected = EXPECTED_WIRE[kind];
    test(`${kind} → ${expected.status} + code ${expected.code} + localized message + requestId`, async () => {
      const response = transportRejectionResponse(
        kind,
        makePostRequest({ headers: { "x-request-id": `corr-wire-${kind}` } })
      );

      expect(response.status).toBe(expected.status);
      // Only the 405 row carries the RFC 9110 Allow header.
      expect(response.headers.get("allow")).toBe(kind === "METHOD_NOT_ALLOWED" ? "POST" : null);

      const item = await firstRejectionItem(response);
      expect(item.extensions.code).toBe(expected.code);
      expect(item.message).toBe(expected.message);
      expect(item.extensions.requestId).toBe(`corr-wire-${kind}`);
    });
  }

  test("CROSS_ORIGIN_REJECTED localizes through the ar errors namespace (en–ar parity)", async () => {
    const response = transportRejectionResponse(
      "CROSS_ORIGIN_REJECTED",
      new NextRequest(BASE_URL, { method: "POST", headers: { "accept-language": "ar", "x-request-id": "corr-403-ar" } })
    );
    expect(response.status).toBe(403);
    const item = await firstRejectionItem(response);
    expect(item.message).toBe(tAr.forbidden);
    expect(item.extensions.requestId).toBe("corr-403-ar");
  });

  test("unknown kind fails LOUD at construction — no silent fallback envelope", () => {
    // The map is exhaustive over the union at type level; a kind outside it
    // is a programming error. Existing semantics: the row lookup yields no
    // spec and construction throws TypeError instead of emitting an
    // unspecified envelope — fail-loud, never fail-open.
    //
    // Hostile-value pattern shared with the BOPLA probes: keep the static
    // type honest on a typed base, then `Object.assign` the out-of-union
    // runtime string (no assertion cast) to simulate a caller bypassing
    // the compile-time union.
    const hostileKind: { kind: TransportErrorKind } = { kind: "MALFORMED_JSON" };
    Object.assign(hostileKind, { kind: "NOT_A_TRANSPORT_KIND" });
    let thrown: unknown = null;
    try {
      transportRejectionResponse(hostileKind.kind, makePostRequest({}));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(TypeError);
  });

  test("concurrent builder calls stay isolated (no shared-state corruption)", async () => {
    const rounds = 4;
    const responses = await Promise.all(
      ALL_KINDS.flatMap(kind =>
        Array.from({ length: rounds }, (_, i) =>
          Promise.resolve(
            transportRejectionResponse(kind, makePostRequest({ headers: { "x-request-id": `corr-conc-${kind}-${i}` } }))
          )
        )
      )
    );

    let cursor = 0;
    const observed = await Promise.all(
      responses.map(async response => ({ status: response.status, item: await firstRejectionItem(response) }))
    );
    for (const kind of ALL_KINDS) {
      const expected = EXPECTED_WIRE[kind];
      for (let i = 0; i < rounds; i += 1) {
        const { status, item } = observed[cursor];
        cursor += 1;
        expect(status).toBe(expected.status);
        expect(item.extensions.code).toBe(expected.code);
        expect(item.message).toBe(expected.message);
        expect(item.extensions.requestId).toBe(`corr-conc-${kind}-${i}`);
      }
    }
  });
});

// ─── New-kind disclosure pins (machine members only, zero raw echo) ─────────

describe("cross-origin + batch-limit rejection envelopes — disclosure pins", () => {
  test("CROSS_ORIGIN_REJECTED leaks NO raw origin/header/body echo", async () => {
    const response = transportRejectionResponse(
      "CROSS_ORIGIN_REJECTED",
      new NextRequest(BASE_URL, {
        method: "POST",
        headers: {
          origin: "https://attacker.example",
          "content-type": "text/plain",
          "x-request-id": "corr-403-leak",
        },
        body: '{"query":"{ __typename }","payload":"DROP TABLE users;"}',
      })
    );

    expect(response.status).toBe(403);
    const body = await readJson(response);
    // Envelope members ONLY: errors → [{message, extensions:{code,requestId}}].
    expect(Object.keys(body)).toEqual(["errors"]);
    const items = errorsArrayOf(body);
    expect(items).toHaveLength(1);
    if (!isPlainJsonObject(items[0])) throw new Error("expected record-shaped item");
    expect(Object.keys(items[0])).toEqual(["message", "extensions"]);
    const extensions: unknown = items[0].extensions;
    if (!isPlainJsonObject(extensions)) throw new Error("expected record-shaped extensions");
    expect(Object.keys(extensions)).toEqual(["code", "requestId"]);
    expect(extensions.requestId).toBe("corr-403-leak");

    // Zero-leak: no raw origin, header value, or body fragment crosses the wire.
    const serialized = JSON.stringify(body) ?? "";
    expect(serialized.includes("attacker.example")).toBe(false);
    expect(serialized.includes("text/plain")).toBe(false);
    expect(serialized.includes("DROP TABLE")).toBe(false);
  });

  test("BATCH_OPERATION_LIMIT leaks NO raw body echo", async () => {
    const response = transportRejectionResponse(
      "BATCH_OPERATION_LIMIT",
      makePostRequest({
        bodyText: '[{"query":"{ __typename }"},{"query":"mutation { dropSecrets }"}]',
        headers: { "x-request-id": "corr-400-batch-leak" },
      })
    );

    expect(response.status).toBe(400);
    const body = await readJson(response);
    const items = errorsArrayOf(body);
    expect(items).toHaveLength(1);
    if (!isPlainJsonObject(items[0])) throw new Error("expected record-shaped item");
    expect(items[0].message).toBe(tEn.badRequest);
    const extensions: unknown = items[0].extensions;
    if (!isPlainJsonObject(extensions)) throw new Error("expected record-shaped extensions");
    expect(extensions.code).toBe("BATCH_OPERATION_LIMIT");
    expect(extensions.requestId).toBe("corr-400-batch-leak");

    const serialized = JSON.stringify(body) ?? "";
    expect(serialized.includes("dropSecrets")).toBe(false);
    expect(serialized.includes("__typename")).toBe(false);
  });
});

// ─── Envelope-shape + disclosure pins ────────────────────────────────────────

describe("rejection-envelope shape and disclosure pins", () => {
  test("payload is EXACTLY {errors:[{message,extensions:{code,requestId}}]} — never REST-shaped", async () => {
    const response = await POST(makePostRequest({ bodyText: "{", headers: { "x-request-id": "corr-shape" } }));
    const body = await readJson(response);

    // GraphQL-local transport shape ONLY — no `error`/`data` members may appear.
    expect(Object.keys(body)).toEqual(["errors"]);
    const items = errorsArrayOf(body);
    expect(items).toHaveLength(1);
    if (!isPlainJsonObject(items[0])) throw new Error("expected record-shaped item");
    expect(Object.keys(items[0])).toEqual(["message", "extensions"]);
    const extensions: unknown = items[0].extensions;
    if (!isPlainJsonObject(extensions)) throw new Error("expected record-shaped extensions");
    expect(Object.keys(extensions)).toEqual(["code", "requestId"]);
    expect(extensions.requestId).toBe("corr-shape");

    // Zero-leak: no stack/path/limit internals cross the wire.
    const serialized = JSON.stringify(body) ?? "";
    expect(serialized.includes("stack")).toBe(false);
    expect(serialized.includes("/srv")).toBe(false);
    expect(serialized.includes("SQL")).toBe(false);
  });
});

// ─── Source-level pins (composition purity) ─────────────────────────────────

describe("route-source pins — constant unification + composition purity", () => {
  const rawSource = readFileSync(join(REPO_ROOT, "app/api/graphql/route.ts"), "utf8");
  /** Comment-stripped view so literal-count pins measure CODE sites only. */
  const routeSource = rawSource
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .split("\n")
    .filter(line => !line.trim().startsWith("//"))
    .join("\n");

  test("the inline GRAPHQL_MAX_BODY_BYTES copy is DELETED — the lib constant is the only home", () => {
    expect(routeSource.includes("GRAPHQL_MAX_BODY_BYTES")).toBe(false);
    expect(routeSource.includes("2_000_000")).toBe(false);
  });

  test("the batch-operation cap is owned exclusively by the guard constant — no inline numeric copies", () => {
    // The route never names the cap and never re-checks operation counts: the
    // batch check lives INSIDE guardTransport (single composed call pinned
    // above), so no route-side ladder with a literal ceiling can exist.
    expect(routeSource.includes("MAX_GRAPHQL_OPERATIONS_PER_REQUEST")).toBe(false);
    expect(routeSource.includes("BATCH_OPERATION_LIMIT")).toBe(false);

    const rawGuardSource = readFileSync(join(REPO_ROOT, "backend/lib/gateway/transport-guard.ts"), "utf8");
    const guardSource = rawGuardSource
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .filter(line => !line.trim().startsWith("//"))
      .join("\n");

    // Exactly ONE definition, and the comparison routes through the named
    // constant — never a bare numeric ceiling.
    expect(guardSource.split("MAX_GRAPHQL_OPERATIONS_PER_REQUEST =").length - 1).toBe(1);
    expect(guardSource.includes("> MAX_GRAPHQL_OPERATIONS_PER_REQUEST")).toBe(true);
    expect(guardSource.includes("> 10")).toBe(false);
  });

  test("client batch window stays in lockstep with the server operation cap (cross-layer parity)", () => {
    // The first-party Apollo provider's `batchMax` is the CLIENT half of the
    // gateway's batched-operation cap: an over-window client batch would
    // dead-letter every query it sends (400 BATCH_OPERATION_LIMIT). The two
    // values cannot share an import (frontend never imports backend), so the
    // parity is pinned by scanning the client source text for the explicit
    // literal and asserting it equals the imported server constant.
    const rawClientSource = readFileSync(join(REPO_ROOT, "frontend/providers/apollo/AppApolloProvider.tsx"), "utf8");
    const clientSource = rawClientSource
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .split("\n")
      .filter(line => !line.trim().startsWith("//"))
      .join("\n");

    const batchMaxLiterals = Array.from(clientSource.matchAll(/batchMax:\s*(\d+)/gu), match => Number(match[1]));
    expect(batchMaxLiterals).toHaveLength(1);
    expect(batchMaxLiterals[0]).toBe(MAX_GRAPHQL_OPERATIONS_PER_REQUEST);
  });

  test("the transport tier composes guardTransport exactly ONCE (no re-implemented guards)", () => {
    expect(routeSource.split("guardTransport(").length - 1).toBe(1);
    // No second body-limit/name/parse ladder is hand-rolled route-side.
    expect(routeSource.includes("JSON.parse(")).toBe(false);
    expect(routeSource.includes("request.text()")).toBe(false);
  });

  test("cookie merge is append-only; never headers.set for Set-Cookie", () => {
    expect(routeSource.split('headers.append("Set-Cookie"').length - 1).toBe(1);
    expect(routeSource.includes('headers.set("Set-Cookie"')).toBe(false);
  });

  test("composition purity — zero domain/service imports in the route module", () => {
    const SERVICE_IMPORT_RE = /from "@\/backend\/services\//u;
    expect(SERVICE_IMPORT_RE.test(routeSource)).toBe(false);
    expect(/from "@\/backend\/db\//u.test(routeSource)).toBe(false);
    expect(routeSource.includes("await import(")).toBe(false);
    expect(routeSource.includes("console.")).toBe(false);
  });

  test("no module-level mutable registries beyond the pre-existing WeakMap hand-off", () => {
    // Frozen maps only; the sole mutable module member stays the sanctioned
    // request-scoped WeakMap channel (preserved verbatim).
    expect(routeSource.match(/\bconst [A-Za-z]+ = new Map</gu)).toBeNull();
    expect(routeSource.match(/\blet [A-Za-z]+ = \[\]/gu)).toBeNull();
    expect(routeSource.includes("new WeakMap<NextRequest, Context>()")).toBe(true);
  });
});
