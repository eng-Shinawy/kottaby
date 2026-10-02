/**
 * Payments webhook route contract (`POST /api/payments/webhook`).
 *
 * Pure-function tier: the POST handler is invoked directly with constructed
 * `NextRequest`s — NO server boot, NO database (the activation service is
 * mocked at the module boundary; its transactional settlement semantics are
 * exhaustively pinned by
 * `backend/services/billing/subscription-activation.service.test.ts`, so the
 * route-level "zero DB writes" guarantee is structural: every rejection path
 * here asserts the service mock was NEVER invoked).
 *
 * Coverage map:
 *  - KILL SWITCH fails closed: with `PAYMENT_WEBHOOK_ENABLED` anything other
 *    than exactly "true" the surface answers the endpoint-shaped BARE 404 —
 *    no envelope, no code, no requestId — even for perfectly signed
 *    deliveries (a disabled deployment is indistinguishable from any other
 *    unknown path);
 *  - SIGNATURE GATE fails closed: enabled surface + missing secret config
 *    (unset OR whitespace-only), missing header, empty header, wrong-secret
 *    signature, or a tampered body → the SAME masked 401 `UNAUTHORIZED`
 *    envelope, service never invoked;
 *  - BODY BOUND: the 64_000-byte cap is byte-exact (a UTF-8 multibyte body
 *    under 64_000 CHARACTERS still exceeds it) — the boundary body is
 *    accepted, cap+1 is a masked 400 that never echoes the payload; a
 *    declared Content-Length over the cap is rejected UP-FRONT (before the
 *    signature gate — an unsigned over-cap delivery answers the 400, not
 *    the 401), and a chunked body with no declared length is read
 *    incrementally under the byte budget (over-cap → masked 400, service
 *    never invoked; a multi-chunk delivery — multibyte characters split
 *    across chunk boundaries included — decodes byte-faithfully and
 *    verifies end-to-end); a request stream that ERRORS mid-read (the
 *    gateway aborting the connection) is masked to the same 400-family
 *    envelope with exactly one correlated log line — never an uncaught
 *    route error; a stream that STALLS past the per-read deadline
 *    (injected short — production default 30s) has its reader CANCELLED
 *    and rides the SAME masked unreadable-body envelope; a compliant-but-
 *    endless DRIP (inter-chunk gaps inside the per-read budget, total time
 *    unbounded) is cut off by the TOTAL delivery deadline (injected short —
 *    production default 60s) the same way — the per-read bound alone cannot
 *    stop a 1-byte-per-29s-forever delivery;
 *  - ENVELOPE contract: happy path `{ data: { processed: true }, requestId }`
 *    with the parsed event + "en" locale handed to the service exactly once;
 *    replay deliveries append `replayed: true`; unknown-reference/quarantine
 *    acks stay 200 `{ processed: false }`; parse rejections are masked 400
 *    `PAYMENT_WEBHOOK_MALFORMED` with the localized generic message;
 *    service-thrown non-domain failures mask behind 500 with the identical
 *    requestId in body AND exactly one correlated log line; service-thrown
 *    domain errors pass through WITHOUT any log line;
 *  - SPOOFING probes: randomized forgeries all denied while the correctly
 *    signed twin passes;
 *  - PAYMOB BRANCH dispatch: that provider signs its deliveries into the
 *    `hmac` QUERY parameter (the server-to-server processed callback and
 *    the customer redirect alike), so the parameter's presence claims the
 *    paymob branch. A query-signed delivery while the active provider is
 *    not paymob answers the SAME bare 404 as the kill switch — before any
 *    body byte is read, so an over-cap probe rides the 404 instead of the
 *    size envelope — and the mock branch keeps settling header-signed
 *    deliveries unchanged while paymob-shaped twins 404. With paymob
 *    active, the mock header gate is SKIPPED and verification happens
 *    inside the adapter's parser: confirmed / declined outcomes hand the
 *    mapped event (reference, outcome, amount, currency,
 *    providerTransactionId) to the activation service once per delivery and
 *    ack 200; a still-pending success (money has not moved) verifies then
 *    acks the 200 no-op with the service NEVER invoked — the later
 *    confirmed callback settles the purchase; TOKEN / refund / void /
 *    child-transaction / flat-redirect deliveries verify then ack the 200
 *    no-op with the service NEVER invoked; a missing or empty `hmac` and
 *    unparsable bodies answer the masked 400 family; a forged or tampered
 *    signature (wrong secret, signed-over-different-bytes, uppercase
 *    re-encoding) answers the masked 401 with exactly ONE correlated
 *    domain-error log line; the 64_000-byte
 *    cap is byte-exact on this branch too; a retrial-shaped burst of the
 *    SAME signed callback acks 200 on every delivery with exactly ONE
 *    settlement-shaped ack (the once-only guarded transition is the
 *    activation service's own contract — pinned by its suite — so the
 *    queued mock results simulate its replay signal); and a mid-flight
 *    provider flip is honored on the very next delivery.
 *  - STATIC route-source pins: POST-only export surface, the bare-404 as the
 *    single numeric status decision, zero console disclosure sites.
 *
 * Signatures in this suite are computed with an INDEPENDENT
 * `createHmac(...).digest("hex")` oracle — never via the production
 * verifier (pinned by `backend/services/billing/payment-gateway/
 * webhook-signature.helpers.test.ts`); the paymob oracle likewise
 * transcribes the vendor's documented key order locally instead of reusing
 * the production builders (pinned by `backend/services/billing/
 * payment-gateway/paymob/__tests__/paymob.hmac.test.ts`).
 *
 * Env stubbing goes through `process.env` + `resetEnvironmentCache()` (the
 * typed gateway getters read a cached snapshot — see `backend/lib/env.ts`);
 * provider flips go through `resetPaymentGateway()` (the resolved adapter is
 * a singleton — the reset drops it with the snapshot so the next request
 * resolves the newly configured provider). Every test restores the keys it
 * touched.
 *
 * Runs via `bun run test/scripts/run-test.ts
 * app/api/payments/webhook/test/payments-webhook-route.test.ts`.
 */

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
// Value import (NOT type-only): NextRequest is CONSTRUCTED below — the
// type-only form detonates at runtime (`ReferenceError`), exactly as the
// set-locale route test documents.
import { NextRequest } from "next/server";

// Module-boundary mock: the route must exercise ONLY its own gate/envelope
// logic here; the activation service's DB semantics belong to its service
// suite. The payment-gateway port runtime is NOT mocked — the mock adapter's
// parser is deterministic, network-free, and part of the route's shell
// contract.
const processCalls: Array<{ event: unknown; locale: string }> = [];
let processResult: { processed: boolean; replayed?: boolean } = { processed: true };
let processThrowable: unknown = null;
/**
 * Optional per-call results drained by the service mock BEFORE the shared
 * result: simulates the activation service's once-only guarded transition
 * across a duplicate-delivery burst (first call settles, later calls replay).
 */
const processResultQueue: Array<{ processed: boolean; replayed?: boolean }> = [];

void mock.module("@/backend/services/billing/subscription-activation.service", () => ({
  SubscriptionActivationService: {
    processWebhookEvent: async (
      event: unknown,
      locale: string
    ): Promise<{ processed: boolean; replayed?: boolean }> => {
      processCalls.push({ event, locale });
      if (processThrowable !== null) {
        throw processThrowable;
      }
      const queuedResult = processResultQueue.shift();
      if (queuedResult !== undefined) {
        return queuedResult;
      }
      return processResult;
    },
  },
}));

// The route import MUST trail its mock.module registration (bun evaluates
// the module registry in import order; the eslint import-order exemption is
// documented inline where the lint config expects it).
import { BODY_READ_DEADLINE_MS, BODY_READ_TOTAL_DEADLINE_MS, POST } from "@/app/api/payments/webhook/route";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { ValidationError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { resetPaymentGateway } from "@/backend/services/billing/payment-gateway";
import { getServerTranslations } from "@/shared/locale/server-graphql";

const BASE_URL = "http://localhost:3000/api/payments/webhook";
const ROUTE_SECRET = "route-test-webhook-secret";
const PAYMOB_HMAC_SECRET = "paymob-route-test-hmac-secret";
/** Pinned route cap — the route module declares the identical literal. */
const MAX_BODY_BYTES = 64_000;
const SIGNATURE_HEADER = "x-payment-signature";
/** Query parameter the paymob provider signs every delivery into. */
const PAYMOB_HMAC_QUERY_PARAM = "hmac";

const ENV_KEYS = [
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMENT_WEBHOOK_SECRET",
  "PAYMENT_WEBHOOK_ENABLED",
  "PAYMOB_SECRET_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_INTEGRATION_ID_CARD",
] as const;

const savedEnv: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}

const tEn = getServerTranslations("en").errorsTranslations;

const CONFIRMED_EVENT_BODY = JSON.stringify({
  reference: "mock_ref_route_1",
  outcome: "confirmed",
  amount: "120.00",
  currency: "USD",
});

// ─── Env + request fixtures ───────────────────────────────────────────────

function enableSurface(): void {
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_WEBHOOK_SECRET = ROUTE_SECRET;
  resetEnvironmentCache();
}

/** Enabled kill switch with NO secret configured — the fail-closed misconfig. */
function enableSurfaceWithoutSecret(): void {
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  resetEnvironmentCache();
}

function setSurfaceDisabled(value: string | undefined): void {
  delete process.env.PAYMENT_WEBHOOK_SECRET;
  if (value === undefined) {
    delete process.env.PAYMENT_WEBHOOK_ENABLED;
  } else {
    process.env.PAYMENT_WEBHOOK_ENABLED = value;
  }
  resetEnvironmentCache();
}

/** Independent signature oracle: lowercase-hex HMAC-SHA256 over the exact body. */
function sign(body: string, secret: string = ROUTE_SECRET): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function webhookRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(BASE_URL, {
    method: "POST",
    headers: { [SIGNATURE_HEADER]: sign(body), ...headers },
    body,
  });
}

function webhookRequestSignedWith(body: string, secret: string): NextRequest {
  return new NextRequest(BASE_URL, {
    method: "POST",
    headers: { [SIGNATURE_HEADER]: sign(body, secret) },
    body,
  });
}

function webhookRequestWithoutSignature(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(BASE_URL, { method: "POST", headers, body });
}

/**
 * Builds a streamed delivery: the chunks are enqueued verbatim (byte
 * boundaries preserved, no declared Content-Length) — the transport shape
 * the incremental body reader owns.
 */
function webhookRequestFromChunks(chunks: Uint8Array[], headers: Record<string, string> = {}): NextRequest {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
  return new NextRequest(BASE_URL, { method: "POST", headers, body: stream });
}

/** Builds a confirmed-event body padded to EXACTLY `totalBytes` ASCII bytes. */
function paddedEventBody(totalBytes: number): string {
  const prefix = '{"reference":"';
  const suffix = '","outcome":"confirmed","amount":"120.00","currency":"USD"}';
  const body = `${prefix}${"b".repeat(totalBytes - prefix.length - suffix.length)}${suffix}`;
  expect(new TextEncoder().encode(body)).toHaveLength(totalBytes);
  return body;
}

// ─── Assertion-free payload narrowing (cron/set-locale precedent) ─────────

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

function memberRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const candidate: unknown = parent[key];
  if (!isPlainJsonObject(candidate)) {
    throw new Error(`response member "${key}" was not a JSON object`);
  }
  return candidate;
}

function memberString(parent: Record<string, unknown>, key: string): string {
  const candidate: unknown = parent[key];
  if (typeof candidate !== "string") {
    throw new Error(`response member "${key}" was not a string`);
  }
  return candidate;
}

function ownKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record);
}

// ─── Paymob-branch fixtures (independent SHA-512 oracle) ──────────────────

/**
 * The vendor's documented processed-callback signed slots, transcribed
 * locally in the documented order (POST nested shape) — an independent
 * oracle copy, never the production key list.
 */
const PAYMOB_TXN_HMAC_KEYS_POST: readonly string[] = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order.id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

/** The vendor's documented response-redirect signed slots (flat names). */
const PAYMOB_TXN_HMAC_KEYS_GET: readonly string[] = [
  "amount_cents",
  "created_at",
  "currency",
  "error_occured",
  "has_parent_transaction",
  "id",
  "integration_id",
  "is_3d_secure",
  "is_auth",
  "is_capture",
  "is_refunded",
  "is_standalone_payment",
  "is_voided",
  "order_id",
  "owner",
  "pending",
  "source_data.pan",
  "source_data.sub_type",
  "source_data.type",
  "success",
];

/** The vendor's documented card-token signed slots, in order. */
const PAYMOB_TOKEN_HMAC_KEYS: readonly string[] = [
  "card_subtype",
  "created_at",
  "email",
  "id",
  "masked_pan",
  "merchant_id",
  "order_id",
  "token",
];

const PAYMOB_SECRET_KEY_FIXTURE = "sk_test_route_paymob";
const PAYMOB_PUBLIC_KEY_FIXTURE = "pk_test_route_paymob";
const PAYMOB_API_KEY_FIXTURE = "route-test-paymob-api-key";

/** Reads a (possibly dotted) signed-value path off a callback object. */
function readHmacPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isPlainJsonObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/** Serializes one signed value: booleans lowercase, absent → empty string. */
function stringifyHmacValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

/** Builds the processed-callback message the provider signs (nested shape). */
function buildPaymobTxnMessage(obj: Record<string, unknown>): string {
  return PAYMOB_TXN_HMAC_KEYS_POST.map(key => stringifyHmacValue(readHmacPath(obj, key))).join("");
}

/** Builds the card-token message the provider signs. */
function buildPaymobTokenMessage(obj: Record<string, unknown>): string {
  return PAYMOB_TOKEN_HMAC_KEYS.map(key => stringifyHmacValue(readHmacPath(obj, key))).join("");
}

/**
 * Builds the flat response-redirect message: the order-id slot prefers the
 * `order` parameter (the vendor's own sample URLs use it) and falls back to
 * `order_id`.
 */
function buildPaymobFlatMessage(query: Record<string, string>): string {
  return PAYMOB_TXN_HMAC_KEYS_GET.map(key => {
    if (key === "order_id") {
      return query.order ?? query.order_id ?? "";
    }
    return query[key] ?? "";
  }).join("");
}

/** Independent paymob oracle: lowercase-hex HMAC-SHA512 over the message. */
function signPaymob(message: string, secret: string = PAYMOB_HMAC_SECRET): string {
  return createHmac("sha512", secret).update(message).digest("hex");
}

/** Enabled surface with the paymob provider active (full config set). */
function enablePaymobProvider(): void {
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
  process.env.PAYMOB_SECRET_KEY = PAYMOB_SECRET_KEY_FIXTURE;
  process.env.PAYMOB_PUBLIC_KEY = PAYMOB_PUBLIC_KEY_FIXTURE;
  process.env.PAYMOB_HMAC_SECRET = PAYMOB_HMAC_SECRET;
  process.env.PAYMOB_API_KEY = PAYMOB_API_KEY_FIXTURE;
  process.env.PAYMOB_INTEGRATION_ID_CARD = "46511";
  resetPaymentGateway();
}

/** Enabled surface with the mock provider explicit (the default resolution). */
function enableMockProvider(): void {
  process.env.PAYMENT_WEBHOOK_ENABLED = "true";
  process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
  process.env.PAYMENT_WEBHOOK_SECRET = ROUTE_SECRET;
  resetPaymentGateway();
}

/**
 * A processed-callback transaction object that satisfies the parser's shape
 * guard, with overridable members for the variant cases (declined, pending,
 * refund / void / child transaction, tamper).
 */
function paymobTransactionObj(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    amount_cents: 12000,
    captured_amount: 0,
    created_at: "2026-09-13T10:11:12.123456",
    currency: "EGP",
    error_occured: false,
    has_parent_transaction: false,
    id: 907001,
    integration_id: 46511,
    is_3d_secure: true,
    is_auth: false,
    is_capture: false,
    is_refund: false,
    is_refunded: false,
    is_standalone_payment: true,
    is_void: false,
    is_voided: false,
    order: { id: 378804, merchant_order_id: "claim_ref_route_1", amount_cents: 12000, currency: "EGP" },
    owner: 21750,
    pending: false,
    refunded_amount_cents: 0,
    source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
    success: true,
    ...overrides,
  };
}

/** Wraps a transaction object in the documented processed-callback envelope. */
function paymobCallbackBody(obj: Record<string, unknown>): string {
  return JSON.stringify({ type: "TRANSACTION", obj });
}

/** A paymob delivery request: the signature rides the `hmac` query parameter. */
function paymobDeliveryRequest(url: string, body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { method: "POST", headers, body });
}

/** Signs a transaction delivery and builds its query-signed request. */
function paymobTransactionRequest(
  obj: Record<string, unknown>,
  options: { secret?: string; body?: string; headers?: Record<string, string> } = {}
): NextRequest {
  const body = options.body ?? paymobCallbackBody(obj);
  const hmac = signPaymob(buildPaymobTxnMessage(obj), options.secret);
  return paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, body, options.headers);
}

/** A card-token callback object with the eight documented signed members. */
function paymobTokenObj(): Record<string, unknown> {
  return {
    card_subtype: "MasterCard",
    created_at: "2026-09-13T10:11:12.123456",
    email: "student@example.com",
    id: 8555026,
    masked_pan: "xxxx-xxxx-xxxx-2346",
    merchant_id: 246628,
    order_id: "264064419",
    token: "e98aceb9_token_fixture",
  };
}

/** Signs a card-token delivery (optionally under an attacker secret). */
function paymobTokenRequest(secret?: string): NextRequest {
  const obj = paymobTokenObj();
  const hmac = signPaymob(buildPaymobTokenMessage(obj), secret);
  return paymobDeliveryRequest(
    `${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`,
    JSON.stringify({ type: "TOKEN", obj })
  );
}

/** Flat response-callback query parameters (the customer redirect shape). */
const PAYMOB_FLAT_QUERY: Record<string, string> = {
  amount_cents: "50000",
  created_at: "2026-09-13T10:11:12.123456",
  currency: "EGP",
  error_occured: "false",
  has_parent_transaction: "false",
  id: "316004",
  integration_id: "46511",
  is_3d_secure: "true",
  is_auth: "false",
  is_capture: "false",
  is_refunded: "false",
  is_standalone_payment: "true",
  is_voided: "false",
  order: "378804",
  owner: "21750",
  pending: "false",
  "source_data.pan": "2346",
  "source_data.sub_type": "MasterCard",
  "source_data.type": "card",
  success: "true",
};

/**
 * Builds the flat redirect delivery: query-signed over the flat parameters,
 * body carrying no nested object (the display-only shape — settlement never
 * trusts it).
 */
function paymobFlatRedirectRequest(): NextRequest {
  const hmac = signPaymob(buildPaymobFlatMessage(PAYMOB_FLAT_QUERY));
  const url = `${BASE_URL}?${new URLSearchParams({ ...PAYMOB_FLAT_QUERY, [PAYMOB_HMAC_QUERY_PARAM]: hmac }).toString()}`;
  return paymobDeliveryRequest(url, JSON.stringify({ message: "customer redirect" }));
}

/** Pads a callback body with trailing JSON whitespace to EXACTLY totalBytes UTF-8 bytes. */
function paddedPaymobBody(obj: Record<string, unknown>, totalBytes: number): string {
  const base = paymobCallbackBody(obj);
  const padding = totalBytes - new TextEncoder().encode(base).byteLength;
  expect(padding).toBeGreaterThanOrEqual(0);
  const body = `${base}${" ".repeat(padding)}`;
  expect(new TextEncoder().encode(body)).toHaveLength(totalBytes);
  return body;
}

/** Posts the deliveries strictly in order — retrial semantics are sequential. */
async function postSequentially(requests: readonly NextRequest[]): Promise<Response[]> {
  if (requests.length === 0) {
    return [];
  }
  const [first, ...rest] = requests;
  const response = await POST(first);
  return [response, ...(await postSequentially(rest))];
}

afterEach(() => {
  processCalls.length = 0;
  processResult = { processed: true };
  processThrowable = null;
  processResultQueue.length = 0;
  for (const key of ENV_KEYS) {
    const saved = savedEnv[key];
    if (saved === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved;
    }
  }
  // The gateway factory memoizes the resolved adapter; dropping it (with
  // the env snapshot) keeps a provider flip from one test from leaking a
  // stale adapter into the next.
  resetPaymentGateway();
});

// ─── Kill switch (disabled → bare 404) ────────────────────────────────────

describe("payments webhook route — kill switch fails closed", () => {
  test("disabled surface answers the BARE endpoint-shaped 404 even for a perfectly signed delivery", async () => {
    setSurfaceDisabled(undefined);
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(404);
    // BARE — no envelope, no code, no requestId: indistinguishable from any
    // other unknown path (the envelope's `code` would be an oracle).
    expect(await response.text()).toBe("");
    expect(processCalls).toHaveLength(0);
  });

  test.each(["false", "1", "yes", "TRUE"])("flag value %p is not the enabling literal → bare 404", async value => {
    setSurfaceDisabled(value);
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(processCalls).toHaveLength(0);
  });

  test("the enabling literal is TRIMMED: ' true' (padded) still enables the surface", async () => {
    // Documents the env parser contract at the route boundary: only the
    // trimmed exact value "true" enables; the parser — not the route — owns
    // the trim (a padded literal is NOT a second enabling shape to guard).
    setSurfaceDisabled(" true");
    process.env.PAYMENT_WEBHOOK_SECRET = ROUTE_SECRET;
    resetEnvironmentCache();
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(200);
    expect(processCalls).toHaveLength(1);
  });
});

// ─── Signature gate (fail closed) ─────────────────────────────────────────

describe("payments webhook route — signature gate fails closed", () => {
  test("enabled + missing secret config → 401 UNAUTHORIZED for a presented header", async () => {
    enableSurfaceWithoutSecret();
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("UNAUTHORIZED");
    expect(ownKeys(error)).toEqual(["code", "message", "requestId"]);
    expect(processCalls).toHaveLength(0);
  });

  test("enabled + whitespace-only secret config → 401 (empty after trim counts as unset)", async () => {
    process.env.PAYMENT_WEBHOOK_ENABLED = "true";
    process.env.PAYMENT_WEBHOOK_SECRET = "   ";
    resetEnvironmentCache();
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("enabled + missing signature header → 401", async () => {
    enableSurface();
    const response = await POST(webhookRequestWithoutSignature(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("enabled + empty signature header value → 401", async () => {
    enableSurface();
    const response = await POST(webhookRequestWithoutSignature(CONFIRMED_EVENT_BODY, { [SIGNATURE_HEADER]: "" }));
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("forged signature (signed under an attacker secret) → masked 401, service never invoked", async () => {
    enableSurface();
    const response = await POST(webhookRequestSignedWith(CONFIRMED_EVENT_BODY, "attacker-secret"));
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("UNAUTHORIZED");
    // Masked: the denial never reveals WHICH deny shape fired (misconfig vs
    // forgery) — the message is the shared generic.
    expect(error.message).toBe("Invalid payment webhook signature.");
    expect(processCalls).toHaveLength(0);
  });

  test("tampered body (valid signature over DIFFERENT bytes) → 401", async () => {
    enableSurface();
    const otherBody = JSON.stringify({
      reference: "mock_ref_route_1",
      outcome: "confirmed",
      amount: "0.01",
      currency: "USD",
    });
    const response = await POST(
      webhookRequestWithoutSignature(otherBody, { [SIGNATURE_HEADER]: sign(CONFIRMED_EVENT_BODY) })
    );
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });
});

// ─── Body bound (byte-exact cap) ──────────────────────────────────────────

describe("payments webhook route — bounded body", () => {
  test("a body of EXACTLY the cap bytes is accepted end-to-end", async () => {
    enableSurface();
    const boundaryBody = paddedEventBody(MAX_BODY_BYTES);
    const response = await POST(webhookRequest(boundaryBody));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(processCalls).toHaveLength(1);
  });

  test("cap + 1 byte → masked 400 that never echoes the payload", async () => {
    enableSurface();
    const overCapBody = paddedEventBody(MAX_BODY_BYTES + 1);
    // The requestId is PINNED: the bare-"bb" payload probe below must never
    // collide with a RANDOM generated requestId hex (an unpinned uuid can
    // legitimately contain "bb" without any payload echo — a flaky false
    // failure, not a leak).
    const response = await POST(webhookRequest(overCapBody, { "x-request-id": "corr-over-cap" }));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_TOO_LARGE");
    // Zero payload echo: neither the reference padding nor the raw body can
    // surface in the wire JSON.
    const wireJson = JSON.stringify(body) ?? "";
    expect(wireJson).not.toContain("bb");
    expect(wireJson).not.toContain(overCapBody.slice(0, 32));
    expect(error.requestId).toBe("corr-over-cap");
    expect(processCalls).toHaveLength(0);
  });

  test("the cap counts UTF-8 BYTES: a multibyte body under the char budget is still over-cap", async () => {
    enableSurface();
    // 40_000 × 2-byte characters = 80_000 bytes > 64_000, yet only 40_000
    // characters — the byte budget, not the character count, governs.
    const multibyteBody = "λ".repeat(40_000);
    const response = await POST(webhookRequest(multibyteBody));
    expect(response.status).toBe(400);
    expect(processCalls).toHaveLength(0);
  });

  test("a declared Content-Length over the cap is rejected UP-FRONT (before the signature gate)", async () => {
    enableSurface();
    // A tiny body with a lying-large declared length: the up-front header
    // check rejects without reading a byte. UNSIGNED on purpose — the 400
    // (not the signature gate's 401) proves the cap fired first.
    const response = await POST(
      webhookRequestWithoutSignature(CONFIRMED_EVENT_BODY, { "content-length": String(MAX_BODY_BYTES + 1) })
    );
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_TOO_LARGE");
    // The masked envelope never echoes the payload.
    const wireJson = JSON.stringify(body) ?? "";
    expect(wireJson).not.toContain("mock_ref_route_1");
    expect(processCalls).toHaveLength(0);
  });

  test("a chunked over-cap body with NO declared length is rejected past the byte budget", async () => {
    enableSurface();
    // 7 × 10_000-byte chunks = 70_000 bytes > 64_000, streamed with no
    // Content-Length: the incremental reader aborts the moment the budget
    // is crossed — the full delivery is never buffered. UNSIGNED: the
    // bounded read precedes the signature gate.
    const chunk = new TextEncoder().encode("b".repeat(10_000));
    const overCapChunks: Uint8Array[] = Array.from({ length: 7 }, () => chunk);
    const response = await POST(webhookRequestFromChunks(overCapChunks));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(memberRecord(body, "error").code).toBe("PAYMENT_WEBHOOK_BODY_TOO_LARGE");
    expect(processCalls).toHaveLength(0);
  });

  test("a multi-chunk streamed body of EXACTLY the cap bytes is accepted end-to-end", async () => {
    enableSurface();
    // The same byte-exact boundary body, streamed in 9_000-byte chunks with
    // no declared length: the incremental reader reassembles and decodes it
    // byte-faithfully, so the signature over the decoded string verifies.
    const boundaryBody = paddedEventBody(MAX_BODY_BYTES);
    const chunks: Uint8Array[] = [];
    for (let offset = 0; offset < boundaryBody.length; offset += 9_000) {
      chunks.push(new TextEncoder().encode(boundaryBody.slice(offset, offset + 9_000)));
    }
    const response = await POST(webhookRequestFromChunks(chunks, { [SIGNATURE_HEADER]: sign(boundaryBody) }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(processCalls).toHaveLength(1);
  });

  test("a multibyte character SPLIT across stream chunks decodes identically to a buffered read (signature verifies)", async () => {
    enableSurface();
    // 2-byte λ and é characters straddling 2-byte chunk boundaries: the
    // streamed incremental decode (with its trailing flush) must produce
    // exactly the string the sender signed — the same treatment a plain
    // buffered read applies.
    const multibyteBody = JSON.stringify({
      reference: "λé-ref-1",
      outcome: "confirmed",
      amount: "120.00",
      currency: "USD",
    });
    const chunks: Uint8Array[] = [];
    const encoded = new TextEncoder().encode(multibyteBody);
    for (let offset = 0; offset < encoded.length; offset += 2) {
      chunks.push(encoded.slice(offset, offset + 2));
    }
    const response = await POST(webhookRequestFromChunks(chunks, { [SIGNATURE_HEADER]: sign(multibyteBody) }));
    expect(response.status).toBe(200);
    expect(processCalls).toHaveLength(1);
    const deliveredEvent: unknown = processCalls[0]?.event;
    if (!isPlainJsonObject(deliveredEvent)) {
      throw new Error("service event was not a JSON object");
    }
    expect(memberString(deliveredEvent, "reference")).toBe("λé-ref-1");
  });

  test("a request stream that ERRORS mid-read answers the masked 400-family envelope (never an uncaught route error)", async () => {
    enableSurface();
    // The delivery stream itself rejects after a first chunk — the reader's
    // mid-stream abort path (the gateway dropped the connection). The route
    // must MASK it: a 400-family envelope with zero payload/transport echo
    // and exactly ONE correlated log line — not a framework 500 with a raw
    // stack. Unsigned on purpose: the bounded read precedes the gate.
    const partialPrefix = CONFIRMED_EVENT_BODY.slice(0, 12);
    const brokenStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(partialPrefix));
        controller.error(new Error("simulated mid-stream abort (peer gone)"));
      },
    });
    const errorSpy = spyOn(logger, "error");
    const response = await POST(new NextRequest(BASE_URL, { method: "POST", headers: {}, body: brokenStream }));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_UNREADABLE");
    // Zero echo: neither the partial payload nor the transport error's
    // message may reach the wire.
    const wireJson = JSON.stringify(body) ?? "";
    expect(wireJson).not.toContain(partialPrefix);
    expect(wireJson).not.toContain("simulated mid-stream abort");

    // Exactly ONE correlated log line carrying a requestId — and none of the
    // transport error material.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const firstCall: unknown = errorSpy.mock.calls[0];
    if (!Array.isArray(firstCall)) {
      throw new Error("logger.error call was not captured");
    }
    const logBag: unknown = firstCall[1];
    if (!isPlainJsonObject(logBag)) {
      throw new Error("logger.error context bag was not a JSON object");
    }
    expect(typeof memberString(logBag, "requestId")).toBe("string");
    expect(JSON.stringify(logBag)).not.toContain("simulated mid-stream abort");
    expect(processCalls).toHaveLength(0);
    errorSpy.mockRestore();
  });

  test("a body stream that STALLS past the per-read deadline → reader cancelled + the same masked envelope", async () => {
    enableSurface();
    // The slow-drip shape: one chunk, then the stream NEVER closes and
    // NEVER errors — without the deadline each incremental read would hang
    // until the platform reaps the request (~300s). The deadline holder's
    // `current` is shortened for the test and restored in the finally
    // (production keeps the 30s default).
    const productionDeadline = BODY_READ_DEADLINE_MS.current;
    BODY_READ_DEADLINE_MS.current = 25;
    let cancelCalls = 0;
    const stalledStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(CONFIRMED_EVENT_BODY.slice(0, 10)));
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const errorSpy = spyOn(logger, "error");
    try {
      const startedAt = Date.now();
      const response = await POST(new NextRequest(BASE_URL, { method: "POST", headers: {}, body: stalledStream }));
      const elapsedMs = Date.now() - startedAt;

      // The SAME masked unreadable-body envelope the mid-read abort rides —
      // a deadline stall is never an uncaught route error and never a 500.
      expect(response.status).toBe(400);
      const body = await readJson(response);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_UNREADABLE");
      // Zero payload echo.
      const wireJson = JSON.stringify(body) ?? "";
      expect(wireJson).not.toContain(CONFIRMED_EVENT_BODY.slice(0, 10));
      expect(wireJson).not.toContain("mock_ref_route_1");

      // The injected deadline — not the 30s default — bounded the read.
      expect(elapsedMs).toBeLessThan(5_000);

      // Exactly ONE correlated log line carrying a requestId — and none of
      // the payload material.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstCall: unknown = errorSpy.mock.calls[0];
      if (!Array.isArray(firstCall)) {
        throw new Error("logger.error call was not captured");
      }
      const logBag: unknown = firstCall[1];
      if (!isPlainJsonObject(logBag)) {
        throw new Error("logger.error context bag was not a JSON object");
      }
      expect(typeof memberString(logBag, "requestId")).toBe("string");
      expect(JSON.stringify(logBag)).not.toContain("mock_ref_route_1");

      // The reader was CANCELLED — the stalled delivery released its
      // connection instead of holding it.
      expect(cancelCalls).toBe(1);
      expect(processCalls).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
      BODY_READ_DEADLINE_MS.current = productionDeadline;
    }
  });

  test("a compliant-but-endless DRIP is cut off by the TOTAL delivery deadline → the same masked envelope", async () => {
    enableSurface();
    // The per-read deadline cannot bound TOTAL delivery time: a drip whose
    // every inter-chunk gap stays inside the per-read budget could stream
    // 1 byte per 29s forever. Both holders' `current` are shortened for the
    // test — the per-read deadline WIDENED to 200ms (the drip's 40ms gaps
    // stay compliant) and the total deadline to 60ms — and restored in the
    // finally (production keeps 30s + 60s).
    const productionReadDeadline = BODY_READ_DEADLINE_MS.current;
    const productionTotalDeadline = BODY_READ_TOTAL_DEADLINE_MS.current;
    BODY_READ_DEADLINE_MS.current = 200;
    BODY_READ_TOTAL_DEADLINE_MS.current = 60;
    let cancelCalls = 0;
    let drippedChunks = 0;
    const drippingStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(CONFIRMED_EVENT_BODY.slice(0, 10)));
        drippedChunks += 1;
        // A second drip 40ms later — well inside the injected 200ms per-read
        // window — then the stream never closes and never errors.
        setTimeout(() => {
          controller.enqueue(new TextEncoder().encode(CONFIRMED_EVENT_BODY.slice(10, 20)));
          drippedChunks += 1;
        }, 40);
      },
      cancel() {
        cancelCalls += 1;
      },
    });
    const errorSpy = spyOn(logger, "error");
    try {
      const startedAt = Date.now();
      const response = await POST(new NextRequest(BASE_URL, { method: "POST", headers: {}, body: drippingStream }));
      const elapsedMs = Date.now() - startedAt;

      // The SAME masked unreadable-body envelope the stall and transport
      // failure ride — a total-deadline cut-off is never a 500 or an echo.
      expect(response.status).toBe(400);
      const body = await readJson(response);
      const error = memberRecord(body, "error");
      expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_UNREADABLE");
      // Zero payload echo.
      const wireJson = JSON.stringify(body) ?? "";
      expect(wireJson).not.toContain(CONFIRMED_EVENT_BODY.slice(0, 10));
      expect(wireJson).not.toContain("mock_ref_route_1");

      // The injected TOTAL deadline — not the 60s default — bounded the
      // delivery: the response arrives ~60ms in, and the drip PROGRESSED
      // (two chunks delivered, every gap inside the per-read window), so
      // the per-read deadline cannot be what fired.
      expect(elapsedMs).toBeLessThan(5_000);
      expect(drippedChunks).toBe(2);

      // Exactly ONE correlated log line carrying a requestId — and none of
      // the payload material.
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const firstCall: unknown = errorSpy.mock.calls[0];
      if (!Array.isArray(firstCall)) {
        throw new Error("logger.error call was not captured");
      }
      const logBag: unknown = firstCall[1];
      if (!isPlainJsonObject(logBag)) {
        throw new Error("logger.error context bag was not a JSON object");
      }
      expect(typeof memberString(logBag, "requestId")).toBe("string");
      expect(JSON.stringify(logBag)).not.toContain("mock_ref_route_1");

      // The reader was CANCELLED — the endless drip released its connection
      // instead of holding it forever.
      expect(cancelCalls).toBe(1);
      expect(processCalls).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
      BODY_READ_DEADLINE_MS.current = productionReadDeadline;
      BODY_READ_TOTAL_DEADLINE_MS.current = productionTotalDeadline;
    }
  });
});

// ─── Envelope contract (enabled + valid signature) ────────────────────────

describe("payments webhook route — envelope contract", () => {
  test("happy path → 200 { data: { processed: true }, requestId } with the parsed event + 'en' locale", async () => {
    enableSurface();
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY, { "x-request-id": "corr-webhook-happy" }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(ownKeys(body)).toEqual(["data", "requestId"]);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(body.requestId).toBe("corr-webhook-happy");
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0]?.event).toEqual({
      reference: "mock_ref_route_1",
      outcome: "confirmed",
      amount: "120.00",
      currency: "USD",
    });
    expect(processCalls[0]?.locale).toBe("en");
  });

  test("replay delivery → 200 { data: { processed: true, replayed: true } } (gateways retry on non-2xx)", async () => {
    enableSurface();
    processResult = { processed: true, replayed: true };
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true, replayed: true });
    expect(processCalls).toHaveLength(1);
  });

  test("unknown reference / quarantine ack posture → 200 { data: { processed: false } }", async () => {
    enableSurface();
    processResult = { processed: false };
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(1);
  });

  test("malformed JSON body (validly signed) → masked 400 PAYMENT_WEBHOOK_MALFORMED, localized generic message", async () => {
    enableSurface();
    const malformed = '{"reference": "mock_ref_route_1",';
    const response = await POST(webhookRequest(malformed));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(error.message).toBe(tEn.validation);
    expect(JSON.stringify(body)).not.toContain("mock_ref_route_1");
    expect(processCalls).toHaveLength(0);
  });

  test("structurally invalid event (unknown outcome, valid JSON + signature) → masked 400, service never invoked", async () => {
    enableSurface();
    const invalidEvent = JSON.stringify({
      reference: "mock_ref_route_1",
      outcome: "pending",
      amount: "120.00",
      currency: "USD",
    });
    const response = await POST(webhookRequest(invalidEvent));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(memberRecord(body, "error").code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(processCalls).toHaveLength(0);
  });

  test("service-thrown non-domain failure masks behind 500 with requestId parity in body AND log", async () => {
    enableSurface();
    processThrowable = new Error("ledger unavailable (simulated driver failure)");
    const errorSpy = spyOn(logger, "error");
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY, { "x-request-id": "corr-webhook-masked" }));
    expect(response.status).toBe(500);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.requestId).toBe("corr-webhook-masked");
    const wireJson = JSON.stringify(body) ?? "";
    expect(wireJson).not.toContain("simulated driver failure");

    // Exactly ONE correlated log line carrying the SAME requestId — and none
    // of the raw body material.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const firstCall: unknown = errorSpy.mock.calls[0];
    if (!Array.isArray(firstCall)) {
      throw new Error("logger.error call was not captured");
    }
    const logBag: unknown = firstCall[1];
    if (!isPlainJsonObject(logBag)) {
      throw new Error("logger.error context bag was not a JSON object");
    }
    expect(memberString(logBag, "requestId")).toBe("corr-webhook-masked");
    expect(JSON.stringify(logBag)).not.toContain("mock_ref_route_1");
    errorSpy.mockRestore();
  });

  test("service-thrown DOMAIN error passes through its code WITHOUT a log line (expected rejection)", async () => {
    enableSurface();
    processThrowable = new ValidationError("PLAN_LANE_UNCONFIGURED", "lane unconfigured");
    const errorSpy = spyOn(logger, "error");
    const response = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    // Custom domain codes fall back to the 400-classification row.
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(memberRecord(body, "error").code).toBe("PLAN_LANE_UNCONFIGURED");
    // Expected rejections never produce logger.error noise.
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ─── Spoofing probes (randomized forgeries) ───────────────────────────────

describe("payments webhook route — spoofing probes", () => {
  test("randomized signature forgeries are ALL denied while the correctly signed twin passes", async () => {
    enableSurface();
    // Parallel forgery burst (12 randomized signatures) — every one denied.
    const forgedResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        POST(
          new NextRequest(BASE_URL, {
            method: "POST",
            headers: { [SIGNATURE_HEADER]: randomBytes(32).toString("hex") },
            body: CONFIRMED_EVENT_BODY,
          })
        )
      )
    );
    for (const forgedResponse of forgedResponses) {
      expect(forgedResponse.status).toBe(401);
    }
    expect(processCalls).toHaveLength(0);
    const twin = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(twin.status).toBe(200);
    expect(processCalls).toHaveLength(1);
  });

  test("uppercase-hex re-encoding of a valid signature is DENIED (wire contract is lowercase hex)", async () => {
    enableSurface();
    const response = await POST(
      webhookRequestWithoutSignature(CONFIRMED_EVENT_BODY, {
        [SIGNATURE_HEADER]: sign(CONFIRMED_EVENT_BODY).toUpperCase(),
      })
    );
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });
});

// ─── Paymob branch — status matrix (query-signed dispatch) ────────────────

describe("payments webhook route — paymob branch status matrix", () => {
  test("confirmed processed callback → 200 ack with the mapped event + 'en' locale handed to the service exactly once", async () => {
    enablePaymobProvider();
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj(), { headers: { "x-request-id": "corr-paymob-happy" } })
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(ownKeys(body)).toEqual(["data", "requestId"]);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(body.requestId).toBe("corr-paymob-happy");
    expect(processCalls).toHaveLength(1);
    expect(processCalls[0]?.event).toEqual({
      reference: "claim_ref_route_1",
      outcome: "confirmed",
      amount: "120.00",
      currency: "EGP",
      providerTransactionId: "907001",
    });
    expect(processCalls[0]?.locale).toBe("en");
  });

  test("declined processed callback (success=false) → 200 ack; the service receives outcome 'failed'", async () => {
    enablePaymobProvider();
    const response = await POST(paymobTransactionRequest(paymobTransactionObj({ success: false })));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(processCalls).toHaveLength(1);
    const deliveredEvent: unknown = processCalls[0]?.event;
    if (!isPlainJsonObject(deliveredEvent)) {
      throw new Error("service event was not a JSON object");
    }
    expect(memberString(deliveredEvent, "outcome")).toBe("failed");
  });

  test("a success that is STILL pending verifies then acks the 200 no-op — money has not moved", async () => {
    enablePaymobProvider();
    const response = await POST(paymobTransactionRequest(paymobTransactionObj({ pending: true })));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("replay ack posture → 200 { processed: true, replayed: true } (retrials stop on 2xx)", async () => {
    enablePaymobProvider();
    processResult = { processed: true, replayed: true };
    const response = await POST(paymobTransactionRequest(paymobTransactionObj()));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true, replayed: true });
    expect(processCalls).toHaveLength(1);
  });

  test("unknown merchant reference ack → 200 { processed: false } (no oracle)", async () => {
    enablePaymobProvider();
    processResult = { processed: false };
    const response = await POST(paymobTransactionRequest(paymobTransactionObj()));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(1);
  });

  test("service-thrown non-domain failure on the paymob branch masks behind 500 (requestId parity)", async () => {
    enablePaymobProvider();
    processThrowable = new Error("paymob ledger unavailable (simulated driver failure)");
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj(), { headers: { "x-request-id": "corr-paymob-masked" } })
    );
    expect(response.status).toBe(500);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.requestId).toBe("corr-paymob-masked");
    expect(JSON.stringify(body)).not.toContain("simulated driver failure");
  });
});

// ─── Paymob branch — delivery boundaries ───────────────────────────────────

describe("payments webhook route — paymob branch boundaries", () => {
  test("missing hmac query parameter → masked 400 PAYMENT_WEBHOOK_MALFORMED, service never invoked", async () => {
    enablePaymobProvider();
    // No query parameter AND no mock header: the provider branch is chosen
    // by the ACTIVE provider, so the delivery reaches the paymob parser —
    // which rejects a delivery that cannot be verified at all.
    const response = await POST(paymobDeliveryRequest(BASE_URL, paymobCallbackBody(paymobTransactionObj())));
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(error.message).toBe(tEn.validation);
    expect(processCalls).toHaveLength(0);
  });

  test("empty hmac parameter value → masked 400 (a delivery that cannot be verified)", async () => {
    enablePaymobProvider();
    const response = await POST(
      paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=`, paymobCallbackBody(paymobTransactionObj()))
    );
    expect(response.status).toBe(400);
    expect(memberRecord(await readJson(response), "error").code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(processCalls).toHaveLength(0);
  });

  test("malformed JSON body (with an hmac parameter) → masked 400, service never invoked", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const hmac = signPaymob(buildPaymobTxnMessage(obj));
    const response = await POST(
      paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, '{"type":"TRANSACTION","obj":')
    );
    expect(response.status).toBe(400);
    const body = await readJson(response);
    expect(memberRecord(body, "error").code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(processCalls).toHaveLength(0);
  });

  test("empty body (with an hmac parameter) → masked 400", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const hmac = signPaymob(buildPaymobTxnMessage(obj));
    const response = await POST(paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, ""));
    expect(response.status).toBe(400);
    expect(memberRecord(await readJson(response), "error").code).toBe("PAYMENT_WEBHOOK_MALFORMED");
    expect(processCalls).toHaveLength(0);
  });

  test("a paymob body of EXACTLY the cap bytes is accepted end-to-end", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const response = await POST(paymobTransactionRequest(obj, { body: paddedPaymobBody(obj, MAX_BODY_BYTES) }));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: true });
    expect(processCalls).toHaveLength(1);
  });

  test("cap + 1 byte → the shared masked transport-limit envelope, service never invoked", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const overCapBody = paddedPaymobBody(obj, MAX_BODY_BYTES + 1);
    const response = await POST(
      paymobTransactionRequest(obj, { body: overCapBody, headers: { "x-request-id": "corr-paymob-over-cap" } })
    );
    expect(response.status).toBe(400);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("PAYMENT_WEBHOOK_BODY_TOO_LARGE");
    expect(error.requestId).toBe("corr-paymob-over-cap");
    const wireJson = JSON.stringify(body) ?? "";
    expect(wireJson).not.toContain("claim_ref_route_1");
    expect(processCalls).toHaveLength(0);
  });
});

// ─── Paymob branch — verified no-ops + retrial burst ──────────────────────

describe("payments webhook route — paymob branch verified no-ops and retrial burst", () => {
  test("card-token (TOKEN) callback, validly signed → 200 { processed: false }, service never invoked", async () => {
    enablePaymobProvider();
    const response = await POST(paymobTokenRequest());
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("refund-shaped transaction (is_refund) → verified then ignored: 200 no-op, service never invoked", async () => {
    enablePaymobProvider();
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj({ is_refund: true, has_parent_transaction: true }))
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("void-shaped transaction (is_void) → verified then ignored: 200 no-op, service never invoked", async () => {
    enablePaymobProvider();
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj({ is_void: true, has_parent_transaction: true }))
    );
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("child transaction (has_parent_transaction) → verified then ignored: 200 no-op, service never invoked", async () => {
    enablePaymobProvider();
    const response = await POST(paymobTransactionRequest(paymobTransactionObj({ has_parent_transaction: true })));
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("flat response-callback shape (query-signed, no nested object) → display-only: 200 no-op, service never invoked", async () => {
    enablePaymobProvider();
    const response = await POST(paymobFlatRedirectRequest());
    expect(response.status).toBe(200);
    const body = await readJson(response);
    expect(memberRecord(body, "data")).toEqual({ processed: false });
    expect(processCalls).toHaveLength(0);
  });

  test("a forged TOKEN delivery is still DENIED — ignoring a variant never skips its verification", async () => {
    enablePaymobProvider();
    const response = await POST(paymobTokenRequest("attacker-paymob-hmac-secret"));
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("a forged refund-shaped delivery is still DENIED — no ignored variant may bypass verification", async () => {
    enablePaymobProvider();
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj({ is_refund: true, has_parent_transaction: true }), {
        secret: "attacker-paymob-hmac-secret",
      })
    );
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("an N=6 retrial-shaped burst of the SAME signed callback → every delivery 200, exactly ONE settlement ack, the rest replay acks", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const burstSize = 6;
    // The guarded once-only transition as the activation service answers it:
    // the first delivery settles; every duplicate observes the already-decided
    // payment and replays (a zero-row no-op).
    processResultQueue.push({ processed: true });
    for (let index = 1; index < burstSize; index += 1) {
      processResultQueue.push({ processed: true, replayed: true });
    }
    const responses = await postSequentially(Array.from({ length: burstSize }, () => paymobTransactionRequest(obj)));
    expect(responses).toHaveLength(burstSize);
    for (const response of responses) {
      expect(response.status).toBe(200);
    }
    const [settlement, ...replayResponses] = responses;
    expect(memberRecord(await readJson(settlement), "data")).toEqual({ processed: true });
    const replayBodies = await Promise.all(replayResponses.map(response => readJson(response)));
    for (const replayBody of replayBodies) {
      expect(memberRecord(replayBody, "data")).toEqual({ processed: true, replayed: true });
    }
    // Every delivery was dispatched — the route never skips or caches; the
    // once-only settlement is the service's guarded transition (simulated
    // by the queued results above).
    expect(processCalls).toHaveLength(burstSize);
    expect(processCalls.every(call => call.locale === "en")).toBe(true);
  });
});

// ─── Paymob branch — security gates ───────────────────────────────────────

describe("payments webhook route — paymob branch security gates", () => {
  test("forged hmac (attacker secret) → masked 401 + exactly ONE correlated domain log line, service never invoked", async () => {
    enablePaymobProvider();
    const domainSpy = spyOn(logger, "logDomainError");
    const response = await POST(
      paymobTransactionRequest(paymobTransactionObj(), {
        secret: "attacker-paymob-hmac-secret",
        headers: { "x-request-id": "corr-paymob-forged" },
      })
    );
    expect(response.status).toBe(401);
    const body = await readJson(response);
    const error = memberRecord(body, "error");
    expect(error.code).toBe("UNAUTHORIZED");
    expect(error.message).toBe("Invalid payment webhook signature.");
    expect(error.requestId).toBe("corr-paymob-forged");
    expect(processCalls).toHaveLength(0);

    // Exactly ONE correlated domain-error log line — fixed diagnostic +
    // correlation id, none of the payload material.
    expect(domainSpy).toHaveBeenCalledTimes(1);
    const firstCall: unknown = domainSpy.mock.calls[0];
    if (!Array.isArray(firstCall)) {
      throw new Error("logger.logDomainError call was not captured");
    }
    const logBag: unknown = firstCall[1];
    if (!isPlainJsonObject(logBag)) {
      throw new Error("logger.logDomainError context bag was not a JSON object");
    }
    expect(memberString(logBag, "code")).toBe("PAYMENT_WEBHOOK_SIGNATURE_INVALID");
    expect(memberString(logBag, "requestId")).toBe("corr-paymob-forged");
    expect(JSON.stringify(logBag)).not.toContain("claim_ref_route_1");
    domainSpy.mockRestore();
  });

  test("tampered payload (hmac computed over DIFFERENT bytes) → 401, service never invoked", async () => {
    enablePaymobProvider();
    const signedObj = paymobTransactionObj();
    const hmac = signPaymob(buildPaymobTxnMessage(signedObj));
    const tamperedBody = paymobCallbackBody(paymobTransactionObj({ amount_cents: 999_999 }));
    const response = await POST(paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, tamperedBody));
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("uppercase-hex hmac re-encoding is DENIED (wire contract is lowercase hex)", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const hmac = signPaymob(buildPaymobTxnMessage(obj)).toUpperCase();
    const response = await POST(
      paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${hmac}`, paymobCallbackBody(obj))
    );
    expect(response.status).toBe(401);
    expect(processCalls).toHaveLength(0);
  });

  test("randomized paymob forgeries are ALL denied while the correctly signed twin passes", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const body = paymobCallbackBody(obj);
    const forgedResponses = await Promise.all(
      Array.from({ length: 12 }, () =>
        POST(paymobDeliveryRequest(`${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=${randomBytes(64).toString("hex")}`, body))
      )
    );
    for (const forgedResponse of forgedResponses) {
      expect(forgedResponse.status).toBe(401);
    }
    expect(processCalls).toHaveLength(0);
    const twin = await POST(paymobTransactionRequest(obj));
    expect(twin.status).toBe(200);
    expect(processCalls).toHaveLength(1);
  });

  test("paymob delivery while the active provider is the mock → BARE 404, service never invoked", async () => {
    enableMockProvider();
    const response = await POST(paymobTransactionRequest(paymobTransactionObj()));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(processCalls).toHaveLength(0);
  });

  test("the mode gate 404 fires BEFORE the size gate (an over-cap query-signed probe answers the bare 404)", async () => {
    enableMockProvider();
    const obj = paymobTransactionObj();
    const request = paymobDeliveryRequest(
      `${BASE_URL}?${PAYMOB_HMAC_QUERY_PARAM}=deadbeef`,
      paddedPaymobBody(obj, MAX_BODY_BYTES + 1),
      { "content-length": String(MAX_BODY_BYTES + 1) }
    );
    const response = await POST(request);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(processCalls).toHaveLength(0);
  });

  test("kill switch off → BARE 404 for a perfectly signed paymob delivery (the switch precedes the provider gate)", async () => {
    enablePaymobProvider();
    setSurfaceDisabled("false");
    const response = await POST(paymobTransactionRequest(paymobTransactionObj()));
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
    expect(processCalls).toHaveLength(0);
  });

  test("a mid-flight provider flip is honored on the very next delivery (no cached mode)", async () => {
    enablePaymobProvider();
    const obj = paymobTransactionObj();
    const first = await POST(paymobTransactionRequest(obj));
    expect(first.status).toBe(200);
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Mock;
    resetPaymentGateway();
    const second = await POST(paymobTransactionRequest(obj));
    expect(second.status).toBe(404);
    expect(await second.text()).toBe("");
    process.env.PAYMENT_GATEWAY_PROVIDER = PaymentGateway.Paymob;
    resetPaymentGateway();
    const third = await POST(paymobTransactionRequest(obj));
    expect(third.status).toBe(200);
    expect(processCalls).toHaveLength(2);
  });

  test("the mock branch is untouched by the paymob gate: header-signed deliveries settle while paymob-shaped twins 404", async () => {
    enableMockProvider();
    const settled = await POST(webhookRequest(CONFIRMED_EVENT_BODY));
    expect(settled.status).toBe(200);
    expect(processCalls).toHaveLength(1);
    const twin = await POST(paymobTransactionRequest(paymobTransactionObj()));
    expect(twin.status).toBe(404);
    expect(await twin.text()).toBe("");
    // The 404 dispatched nothing — the settled count is unchanged.
    expect(processCalls).toHaveLength(1);
  });
});

// ─── Static route-source pins ─────────────────────────────────────────────

describe("payments webhook route — static route-source pins", () => {
  const ROUTE_SOURCE = readFileSync(join(process.cwd(), "app", "api", "payments", "webhook", "route.ts"), "utf8");

  test("route surface is POST-only (every other verb rides the framework 405)", () => {
    expect(ROUTE_SOURCE).toContain("export async function POST");
    expect(ROUTE_SOURCE).not.toMatch(/export\s+async\s+function\s+(GET|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/u);
  });

  test("the bare kill-switch 404 is the route's single numeric status decision", () => {
    expect(ROUTE_SOURCE).toContain("const ENDPOINT_GONE_STATUS = 404;");
    expect(ROUTE_SOURCE).not.toMatch(/status:\s*\d/u);
  });

  test("zero console disclosure sites in the route source", () => {
    expect(ROUTE_SOURCE).not.toContain("console.");
  });

  test("the paymob dispatch marker and the adapter-delegated verification are pinned in the route source", () => {
    // The documented dispatch marker: the query parameter whose presence
    // claims the paymob branch.
    expect(ROUTE_SOURCE).toContain('const PAYMOB_HMAC_QUERY_PARAM = "hmac";');
    // The route delegates paymob verification to the adapter's parser — no
    // direct HMAC machinery may ever live in the route source (the
    // constant-time compare is the hmac module's contract, and a route-side
    // re-implementation could silently diverge from it).
    expect(ROUTE_SOURCE).not.toContain("verifyPaymobHmac");
    expect(ROUTE_SOURCE).not.toContain("createHmac");
    expect(ROUTE_SOURCE).not.toContain("paymob.hmac");
    expect(ROUTE_SOURCE).not.toContain("paymob.mapper");
  });
});
