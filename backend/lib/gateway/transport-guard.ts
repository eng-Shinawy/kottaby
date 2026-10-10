/**
 * Pure transport guards for the GraphQL route's pre-engine tier
 * (method, content-type, declared-length, drained-length, JSON parse, and
 * batched-operation count).
 *
 * RESULT-UNION CONTRACT — never throw-as-control-flow:
 *  - NOTHING in this module throws. Every guard returns a
 *    {@link TransportGuardResult}; narrowing happens at the consumer.
 *  - Guards are PURE: fixed header whitelist only (BOPLA), no identity reads,
 *    no ctx mutation, no module-level mutable state; concurrent calls are
 *    fully independent.
 *  - Failure results carry ONLY the machine kind — no raw header echoes,
 *    body fragments, paths or stack data ever cross this boundary.
 *    Kind→HTTP mapping + localized envelopes live ROUTE-side:
 *    METHOD_NOT_ALLOWED→405+`Allow: POST` · UNSUPPORTED_CONTENT_TYPE→400 ·
 *    PAYLOAD_TOO_LARGE→413 · MALFORMED_JSON→400 ·
 *    CROSS_ORIGIN_REJECTED→403 · BATCH_OPERATION_LIMIT→400.
 *    CROSS_ORIGIN_REJECTED is emitted by the route-side origin guard (this
 *    module never returns it); BATCH_OPERATION_LIMIT is emitted here when a
 *    parsed array body carries more operations than
 *    {@link MAX_GRAPHQL_OPERATIONS_PER_REQUEST}.
 *
 * WIRE-CODE RECONCILIATION: the live `app/api/graphql/route.ts` block moved
 * its inline `GRAPHQL_MAX_BODY_BYTES = 2_000_000` onto
 * {@link MAX_GRAPHQL_BODY_BYTES} (byte-identical value). The route maps
 * kinds onto the existing transport codes: `PAYLOAD_TOO_LARGE` is reused
 * verbatim and BOTH malformed-JSON sources (`MALFORMED_JSON`) map onto the
 * existing `GRAPHQL_PARSE_FAILED` behavior — NO new wire code is introduced
 * anywhere; the GraphQL-local `{errors:[{extensions:{code,requestId}}]}`
 * rejection shape (documented exemption row) stays untouched.
 *
 * GUARD ORDER inside `guardTransport` preserves the live pipeline order:
 * cheap constant-work checks first (method → content-type → declared length),
 * then the body stream is drained exactly once (drained-length check BEFORE
 * parse — mirrors the live block), strict JSON parse, and LAST the parsed
 * array's operation count (the cap needs the parsed shape, so it cannot run
 * earlier). Every failure short-circuits — the GraphQL engine is never
 * reached on a rejection.
 */

import type { TransportErrorKind, TransportGuardResult } from "@/backend/types";

/** Accepted JSON media types for GraphQL-over-HTTP POST bodies (+ parameters such as `; charset=utf-8`). */
const ALLOWED_CONTENT_TYPES = ["application/json", "application/graphql-response-json"] as const;

/** The only method the engine route accepts (GET is excluded by design — CSRF posture; the route wires explicit 405 handlers). */
const ONLY_ALLOWED_METHOD = "POST";

/**
 * Hard cap for GraphQL request bodies — THE canonical transport-tier constant
 * (frozen). Single source shared by every consumer, so no competing inline
 * copy ever exists side-by-side.
 *
 * 2 MB comfortably exceeds the largest legitimate batched operation while
 * rejecting payload-bomb abuse. TRANSPORT-tier constant — deliberately NOT a
 * domain taxonomy row.
 */
export const MAX_GRAPHQL_BODY_BYTES = 2_000_000;

/**
 * Per-request ceiling on batched GraphQL operations — THE canonical
 * transport-tier constant for operation fan-out (frozen). The engine executes
 * EVERY entry of a JSON-array request body, so an unbounded array amplifies a
 * single HTTP request into unbounded engine work — resolver fan-out cost
 * scales with entry count, not body bytes, so the byte cap alone cannot bound
 * it. Ten comfortably covers the largest legitimate client batch window; the
 * first-party Apollo client pins `batchMax` to the same value
 * (`frontend/providers/apollo/AppApolloProvider.tsx`) so well-behaved clients
 * never trip the cap. Single-object bodies are unaffected BY DESIGN — an array
 * is the only batched shape in GraphQL-over-HTTP, so wrapping operations
 * inside one object cannot smuggle extra fan-out past this ceiling.
 */
export const MAX_GRAPHQL_OPERATIONS_PER_REQUEST = 10;

/** Success result with the (possibly pre-parsed) body attached. */
function pass(body: unknown): TransportGuardResult {
  return { ok: true, body };
}

/** Failure result carrying only the machine kind (never a payload echo). */
function fail(kind: TransportErrorKind): TransportGuardResult {
  return { ok: false, kind };
}

/**
 * Guard 1 — method allowlist.
 *
 * @param method Raw request method (e.g. `request.method`). Uppercase HTTP verbs expected.
 * @returns Pass iff method is exactly `POST`; else kind `METHOD_NOT_ALLOWED`.
 */
export function assertAllowedMethod(method: string): TransportGuardResult {
  if (method === ONLY_ALLOWED_METHOD) {
    return pass(undefined);
  }
  return fail("METHOD_NOT_ALLOWED");
}

/**
 * Guard 2 — content-type allowlist.
 *
 * Media-type comparison is case-insensitive and parameter-tolerant per RFC 9110
 * (`Application/JSON;charset=UTF-8` passes); absent header or any other type
 * fails closed BEFORE the body stream is touched.
 *
 * @param contentTypeHeader Value of the `content-type` header or `null` when absent.
 * @returns Pass iff an allowed JSON media type is present; else kind `UNSUPPORTED_CONTENT_TYPE`.
 */
export function assertJsonContentType(contentTypeHeader: string | null): TransportGuardResult {
  if (contentTypeHeader === null) {
    return fail("UNSUPPORTED_CONTENT_TYPE");
  }
  const mediaType = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "";
  if ((ALLOWED_CONTENT_TYPES as readonly string[]).includes(mediaType)) {
    return pass(undefined);
  }
  return fail("UNSUPPORTED_CONTENT_TYPE");
}

/**
 * Guard 3 — single-threshold body-size comparator used at BOTH size checkpoints.
 *
 * Passes at exactly {@link MAX_GRAPHQL_BODY_BYTES} (`>` strict), so the limit
 * itself is inclusive. Mirrors the two live call sites:
 *  - declared checkpoint: caller feeds `Number(headers.get("content-length") ?? "0")`;
 *    a NaN header stays pass-through here ONLY via the caller's
 *    `Number.isFinite(...)` pre-check (verbatim live predicate);
 *  - drained checkpoint: caller feeds `rawBody.length` after `request.text()`.
 *
 * @param bodyByteLength Declared or drained body length (UTF-16 units, matching the live `String.length` semantics).
 * @returns Pass iff within limit; else kind `PAYLOAD_TOO_LARGE`.
 */
export function assertWithinBodyLimit(bodyByteLength: number): TransportGuardResult {
  if (bodyByteLength > MAX_GRAPHQL_BODY_BYTES) {
    return fail("PAYLOAD_TOO_LARGE");
  }
  return pass(undefined);
}

/**
 * Guard 7 — batched-operation amplification cap.
 *
 * Only array-shaped request bodies are batched operations in
 * GraphQL-over-HTTP; every other shape passes through untouched, carrying the
 * same body (a single-object body IS one operation — extra operations cannot
 * hide inside it). An array longer than
 * {@link MAX_GRAPHQL_OPERATIONS_PER_REQUEST} fails with kind
 * `BATCH_OPERATION_LIMIT` BEFORE the engine is reached.
 *
 * @param body The parsed JSON body (any shape).
 * @returns Pass with the same body when it is not an array or the array is within the cap; else kind `BATCH_OPERATION_LIMIT`.
 */
export function assertBatchOperationCount(body: unknown): TransportGuardResult {
  if (!Array.isArray(body)) {
    return pass(body);
  }
  if (body.length > MAX_GRAPHQL_OPERATIONS_PER_REQUEST) {
    return fail("BATCH_OPERATION_LIMIT");
  }
  return pass(body);
}

/**
 * Composed pipeline guard for a GraphQL POST request.
 * Order-preserved port of the live transport block:
 *
 *  1. method allowlist;
 *  2. content-type allowlist (fail-closed before touching the stream);
 *  3. declared `content-length` checkpoint (live predicate verbatim — a
 *     missing/non-numeric header neither rejects nor crashes here);
 *  4. drain the body once; a mid-read stream death maps to kind
 *     `MALFORMED_JSON` (live behavior: same wire code as invalid JSON);
 *  5. drained-length checkpoint (catches lying headers);
 *  6. strict `JSON.parse` validation; success carries the parsed body as
 *     `unknown` for downstream narrowing;
 *  7. batched-operation cap on the parsed body — a JSON array longer than
 *     {@link MAX_GRAPHQL_OPERATIONS_PER_REQUEST} fails with kind
 *     `BATCH_OPERATION_LIMIT` (non-array bodies pass through untouched).
 *
 * @param request Any fetch-spec `Request` (NextRequest is assignable).
 * @returns The first failing guard's result, else `{ ok: true, body }` with the parsed JSON.
 */
export async function guardTransport(request: Request): Promise<TransportGuardResult> {
  const methodVerdict = assertAllowedMethod(request.method);
  if (!methodVerdict.ok) {
    return methodVerdict;
  }

  const contentTypeVerdict = assertJsonContentType(request.headers.get("content-type"));
  if (!contentTypeVerdict.ok) {
    return contentTypeVerdict;
  }

  // Live declared-length predicate verbatim: missing/garbage header falls
  // through to the drained-length checkpoint instead of rejecting.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength)) {
    const declaredVerdict = assertWithinBodyLimit(declaredLength);
    if (!declaredVerdict.ok) {
      return declaredVerdict;
    }
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    // Stream died mid-read — same failure class as unparseable input (live behavior).
    return fail("MALFORMED_JSON");
  }

  const drainedVerdict = assertWithinBodyLimit(rawBody.length);
  if (!drainedVerdict.ok) {
    return drainedVerdict;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail("MALFORMED_JSON");
  }

  // Batch-count runs LAST: the cap compares the parsed array's length, so it
  // needs the parse to have succeeded (guard order preserved end-to-end).
  return assertBatchOperationCount(parsed);
}
