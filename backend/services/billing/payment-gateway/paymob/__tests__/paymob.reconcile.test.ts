/**
 * Paymob reconciliation sweep suite — pure unit tier (NO DB, NO server
 * boot), run via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/paymob/__tests__/paymob.reconcile.test.ts`
 *
 * Seams: the HTTP boundary rides an injected recording transport (the
 * production fetch stand-in); the stale-pending finder and the activation
 * handoff are spied on their repository/service namespaces — no module
 * registry mutation. The environment fixture installs a complete paymob
 * configuration per case and restores the original process.env after
 * every test.
 *
 * Covered contract:
 *  - Gating: active provider ≠ paymob OR API key absent ⇒ the zero-count
 *    result, exactly one informational skip line (never an error), the
 *    repository and the network untouched. The gate is the API key ALONE
 *    — the sweep runs with every checkout credential absent.
 *  - Batch discipline: the stale-pending finder is called with the
 *    configured window (now − reconcilePendingMinutes) and the batch
 *    bound — default ceiling 50, explicit smaller limits honored,
 *    oversized and non-positive limits clamped.
 *  - Inquiry mapping + handoff identity: a terminal inquiry is mapped to
 *    the SAME verified-event shape the webhook parser produces
 *    (row-stored reference — never the vendor echo — outcome by the
 *    success flag, cents → two-fraction decimal string, provider
 *    transaction id as its string form) and handed to the activation
 *    service's webhook entry point with the deployment-default locale.
 *    Refused handoffs count as skipped (nothing mutated); replayed
 *    handoffs count as applied (the earlier delivery settled them).
 *  - Per-row skips: no stored payment reference (no network call for that
 *    row), inquiry unavailability (ONLY the failing row skips — the batch
 *    continues), still-in-flight transactions, and reversal/child
 *    variants the webhook dispatch never settles. A non-upstream inquiry
 *    error propagates and aborts the run.
 *  - Discipline pins: the minted token and the API key never appear in
 *    any log line; a fresh auth token is minted per row (never cached);
 *    each row's outcome lands in exactly one log line carrying its
 *    correlation ids.
 */

import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { type StalePendingPaymentWithReferenceRow, StudentPaymentRepository } from "@/backend/db/repo";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { PaymentStatus } from "@/backend/enum/billing/payment-status.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { logger } from "@/backend/lib/logger";
import { type PaymobFetch, PaymobHttpClient } from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import { reconcilePendingPaymobPayments } from "@/backend/services/billing/payment-gateway/paymob/paymob.reconcile";
import { SubscriptionActivationService } from "@/backend/services/billing/subscription-activation.service";
import type { PaymentWebhookEvent } from "@/backend/types";

// ─── Environment fixture (restored after every case) ─────────────────────────

/** Every env key the sweep reads, direct or through the typed snapshot. */
const RECONCILE_ENV_KEYS = [
  "PAYMENT_GATEWAY_PROVIDER",
  "PAYMOB_SECRET_KEY",
  "PAYMOB_PUBLIC_KEY",
  "PAYMOB_HMAC_SECRET",
  "PAYMOB_API_KEY",
  "PAYMOB_INTEGRATION_ID_CARD",
  "PAYMOB_INTEGRATION_ID_WALLET",
  "PAYMOB_API_BASE_URL",
  "PAYMOB_CHECKOUT_BASE_URL",
  "PAYMOB_HTTP_TIMEOUT_MS",
  "PAYMOB_RECONCILE_PENDING_MINUTES",
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of RECONCILE_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

/** The API key fixture — its sentinel must never appear in any log line. */
const API_KEY = "api_key_reconcile_test";

/** The minted auth-token sentinel — never cached, never logged. */
const MINTED_TOKEN = "tok_reconcile_minted_secret";

/** The complete default paymob configuration the fixture installs. */
const REQUIRED_ENV_DEFAULTS: { [K in (typeof RECONCILE_ENV_KEYS)[number]]?: string } = {
  PAYMENT_GATEWAY_PROVIDER: "paymob",
  PAYMOB_SECRET_KEY: "sk_test_reconcile_secret",
  PAYMOB_PUBLIC_KEY: "pk_test_reconcile_public",
  PAYMOB_HMAC_SECRET: "hmac_test_reconcile_secret",
  PAYMOB_API_KEY: API_KEY,
  PAYMOB_INTEGRATION_ID_CARD: "1256",
  PAYMOB_API_BASE_URL: "https://paymob.test",
  PAYMOB_RECONCILE_PENDING_MINUTES: "30",
};

/** Installs a sweep configuration; an explicit undefined UNSETS that key. */
function setReconcileEnv(values: Partial<Record<(typeof RECONCILE_ENV_KEYS)[number], string>> = {}): void {
  for (const key of RECONCILE_ENV_KEYS) {
    delete process.env[key];
  }
  const merged: Record<string, string | undefined> = { ...REQUIRED_ENV_DEFAULTS, ...values };
  for (const [key, value] of Object.entries(merged)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

function restoreReconcileEnv(): void {
  for (const key of RECONCILE_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
}

// ─── Spy bookkeeping (restored after every case) ─────────────────────────────

const trackedRestores: Array<() => void> = [];

/** Registers a spy for automatic restoration after the current test. */
function trackSpy<T extends { mockRestore(): void }>(spy: T): T {
  trackedRestores.push(() => spy.mockRestore());
  return spy;
}

beforeEach(() => {
  setReconcileEnv();
});

afterEach(() => {
  for (const restore of trackedRestores.splice(0)) {
    restore();
  }
  restoreReconcileEnv();
});

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Fixed sweep clock — the stale-window assertions derive from this instant. */
const NOW = new Date("2026-09-12T12:00:00.000Z");

/** A fully-populated documented transaction-inquiry result (terminal paid). */
const INQUIRY_PAID = {
  id: 187_200_498,
  pending: false,
  success: true,
  amount_cents: 25_000,
  created_at: "2026-09-11T20:31:44.464153",
  updated_at: "2026-09-11T20:32:10.000000",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 1256,
  profile_id: 164_295,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_captured: false,
  captured_amount: 0,
  is_refund: false,
  is_refunded: false,
  refunded_amount_cents: 0,
  is_standalone_payment: false,
  is_void: false,
  is_voided: false,
  owner: 164_295,
  // The vendor's echo of the merchant-order key — deliberately NOT the
  // row's stored reference, so the suite pins that the handoff's
  // reference comes from the row, never from this echo.
  order: { id: 212_245_716, merchant_order_id: "vendor-echo-not-trusted", amount_cents: 25_000, currency: "EGP" },
  source_data: { pan: "2346", sub_type: "MasterCard", type: "c" },
};

const INQUIRY_DECLINED = { ...INQUIRY_PAID, id: 187_200_501, success: false };
const INQUIRY_IN_FLIGHT = { ...INQUIRY_PAID, id: 187_200_502, pending: true };
const INQUIRY_REFUND = { ...INQUIRY_PAID, id: 187_200_503, is_refund: true };
const INQUIRY_VOID = { ...INQUIRY_PAID, id: 187_200_504, is_void: true };
const INQUIRY_CHILD = { ...INQUIRY_PAID, id: 187_200_505, has_parent_transaction: true };
const INQUIRY_NULL_ECHO = { ...INQUIRY_PAID, order: { ...INQUIRY_PAID.order, merchant_order_id: null } };

/** Builds one stale-pending ledger row joined with its payment reference. */
function makeRow(args: { id: number; paymentReference: string | null }): StalePendingPaymentWithReferenceRow {
  return {
    id: args.id,
    studentId: 501,
    subscriptionId: 901,
    amount: "250.00",
    currency: "EGP",
    paymentGateway: PaymentGateway.Paymob,
    status: PaymentStatus.Pending,
    providerTransactionId: null,
    createdAt: new Date("2026-09-12T10:00:00.000Z"),
    updatedAt: new Date("2026-09-12T10:00:00.000Z"),
    paymentReference: args.paymentReference,
  };
}

// ─── Recording transport (the injected fetch boundary) ───────────────────────

/** One recorded send: every piece the client controls. */
interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** Builds a JSON response with the given status and payload. */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

/** Narrows a parsed value to a plain object (arrays are not request bodies). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a recorded request body as a plain object — the wire bodies are JSON objects by construction. */
function parseBody(request: RecordedRequest): Record<string, unknown> {
  const parsed: unknown = JSON.parse(request.body);
  if (!isRecord(parsed)) {
    throw new Error("test transport: recorded request body is not a JSON object");
  }
  return parsed;
}

/** Reads the single recorded call for one endpoint suffix — fails loudly when absent. */
function requiredCall(calls: readonly RecordedRequest[], urlSuffix: string): RecordedRequest {
  const found = calls.find(call => call.url.endsWith(urlSuffix));
  if (found === undefined) {
    throw new Error(`expected a recorded call to ${urlSuffix}`);
  }
  return found;
}

/**
 * Builds the fetch stand-in the sweep rides: the auth-token mint always
 * answers with the minted-token sentinel; every transaction inquiry is
 * served by the per-reference responder.
 */
function makeTransport(args: { inquiryFor: (reference: string) => Response }): {
  fetch: PaymobFetch;
  calls: RecordedRequest[];
} {
  const calls: RecordedRequest[] = [];
  const fetch: PaymobFetch = async (url, init) => {
    const request: RecordedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      signal: init.signal,
    };
    calls.push(request);
    if (url.endsWith("/api/auth/tokens")) {
      return jsonResponse(200, { token: MINTED_TOKEN });
    }
    if (url.endsWith("/api/ecommerce/orders/transaction_inquiry")) {
      const reference = parseBody(request).merchant_order_id;
      if (typeof reference !== "string") {
        throw new Error("test transport: inquiry body lacks its merchant_order_id");
      }
      return args.inquiryFor(reference);
    }
    throw new Error(`test transport: unexpected Paymob endpoint ${url}`);
  };
  return { fetch, calls };
}

/** Serves scripted inquiry payloads keyed by the queried merchant reference. */
function inquiryByReference(map: Record<string, unknown>): (reference: string) => Response {
  return reference => {
    const payload = map[reference];
    if (payload === undefined) {
      throw new Error(`test transport: no scripted inquiry for reference "${reference}"`);
    }
    return jsonResponse(200, payload);
  };
}

// ─── Sweep harness (repo + activation seams, all restored per case) ─────────

/** One captured activation handoff: the event plus the locale it was handed with. */
interface ActivationHandoff {
  readonly event: PaymentWebhookEvent;
  readonly locale: string;
}

/** Everything a case needs to drive and inspect one sweep. */
interface SweepHarness {
  readonly fetch: PaymobFetch;
  readonly calls: readonly RecordedRequest[];
  readonly repoSpy: ReturnType<typeof spyOn>;
  readonly activationSpy: ReturnType<typeof spyOn>;
  readonly handoffs: readonly ActivationHandoff[];
}

/** Installs the transport + repository + activation seams for one sweep case. */
function setupSweep(args: {
  rows: StalePendingPaymentWithReferenceRow[];
  inquiryFor: (reference: string) => Response;
  handoffResults?: Array<{ processed: boolean; replayed?: boolean }>;
}): SweepHarness {
  const transport = makeTransport({ inquiryFor: args.inquiryFor });
  const repoSpy = trackSpy(spyOn(StudentPaymentRepository, "findStalePendingByGateway"));
  repoSpy.mockResolvedValue(args.rows);
  const handoffs: ActivationHandoff[] = [];
  let handoffIndex = 0;
  const activationSpy = trackSpy(spyOn(SubscriptionActivationService, "processWebhookEvent"));
  activationSpy.mockImplementation(async (event: PaymentWebhookEvent, locale: string) => {
    handoffs.push({ event, locale });
    const queued = args.handoffResults?.[handoffIndex++];
    return queued ?? { processed: true };
  });
  return { fetch: transport.fetch, calls: transport.calls, repoSpy, activationSpy, handoffs };
}

/** Narrows a finder argument to a Date — the stale-window argument's expected type. */
function asDate(value: unknown): Date {
  if (!(value instanceof Date)) {
    throw new Error("expected the stale-window argument to be a Date");
  }
  return value;
}

/** Narrows a caught value to an Error — the propagation cases' expected rejection. */
function errorOf(caught: unknown): Error {
  if (!(caught instanceof Error)) {
    throw new Error("expected an Error rejection");
  }
  return caught;
}

// ─── Gating ──────────────────────────────────────────────────────────────────

/**
 * Runs one gating case per blank API-key value — sequential by recursion
 * (each case rewrites the shared env fixture, so the next case must not
 * start before the previous one's assertions ran).
 */
async function expectZeroCountsForBlankApiKey(blanks: readonly (string | undefined)[], index: number): Promise<void> {
  if (index >= blanks.length) {
    return;
  }
  setReconcileEnv({ PAYMOB_API_KEY: blanks[index] });
  const harness = setupSweep({
    rows: [makeRow({ id: 1, paymentReference: "claim-ref-1" })],
    inquiryFor: () => jsonResponse(200, INQUIRY_PAID),
  });

  const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

  expect(result).toEqual({ checked: 0, confirmed: 0, failed: 0, skipped: 0 });
  expect(harness.repoSpy.mock.calls).toHaveLength(0);
  expect(harness.calls).toHaveLength(0);
  await expectZeroCountsForBlankApiKey(blanks, index + 1);
}

describe("gating", () => {
  test("returns the zero-count result without repository or network work when the active provider is not paymob", async () => {
    setReconcileEnv({ PAYMENT_GATEWAY_PROVIDER: "mock" });
    const harness = setupSweep({
      rows: [makeRow({ id: 1, paymentReference: "claim-ref-1" })],
      inquiryFor: () => jsonResponse(200, INQUIRY_PAID),
    });
    const infoSpy = trackSpy(spyOn(logger, "info"));
    infoSpy.mockImplementation(() => {});
    const errorSpy = trackSpy(spyOn(logger, "error"));

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 0, confirmed: 0, failed: 0, skipped: 0 });
    expect(harness.repoSpy.mock.calls).toHaveLength(0);
    expect(harness.calls).toHaveLength(0);
    expect(harness.activationSpy.mock.calls).toHaveLength(0);
    expect(infoSpy.mock.calls.map(call => call[0])).toContain(
      "Paymob reconciliation sweep skipped: gateway not configured"
    );
    expect(errorSpy.mock.calls).toHaveLength(0);
  });

  test("returns the zero-count result without repository or network work when the API key is absent or blank", async () => {
    await expectZeroCountsForBlankApiKey([undefined, "", "   "], 0);
  });

  test("runs with the API key alone — every checkout credential absent from the environment", async () => {
    setReconcileEnv({
      PAYMOB_SECRET_KEY: undefined,
      PAYMOB_PUBLIC_KEY: undefined,
      PAYMOB_HMAC_SECRET: undefined,
      PAYMOB_INTEGRATION_ID_CARD: undefined,
      PAYMOB_INTEGRATION_ID_WALLET: undefined,
    });
    const harness = setupSweep({
      rows: [makeRow({ id: 1, paymentReference: "claim-ref-1" })],
      inquiryFor: inquiryByReference({ "claim-ref-1": INQUIRY_PAID }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, skipped: 0 });
    expect(harness.handoffs).toHaveLength(1);
  });
});

// ─── Stale window and batch bound ────────────────────────────────────────────

describe("stale window and batch bound", () => {
  test("queries the stale-pending finder for this gateway with the configured window and the default ceiling", async () => {
    const harness = setupSweep({ rows: [], inquiryFor: () => jsonResponse(200, INQUIRY_PAID) });

    await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    const finderArgs = harness.repoSpy.mock.calls[0] ?? [];
    expect(finderArgs[0]).toBe(PaymentGateway.Paymob);
    expect(asDate(finderArgs[1]).toISOString()).toBe("2026-09-12T11:30:00.000Z");
    expect(finderArgs[2]).toBe(50);
  });

  test("derives the stale window from the configured pending minutes", async () => {
    setReconcileEnv({ PAYMOB_RECONCILE_PENDING_MINUTES: "90" });
    const harness = setupSweep({ rows: [], inquiryFor: () => jsonResponse(200, INQUIRY_PAID) });

    await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    const finderArgs = harness.repoSpy.mock.calls[0] ?? [];
    expect(asDate(finderArgs[1]).toISOString()).toBe("2026-09-12T10:30:00.000Z");
  });

  test("honors an explicit batch limit and clamps oversized and non-positive limits", async () => {
    const harness = setupSweep({ rows: [], inquiryFor: () => jsonResponse(200, INQUIRY_PAID) });

    await reconcilePendingPaymobPayments({ now: NOW, batchLimit: 2, fetch: harness.fetch });
    expect(harness.repoSpy.mock.calls[0]?.[2]).toBe(2);

    await reconcilePendingPaymobPayments({ now: NOW, batchLimit: 500, fetch: harness.fetch });
    expect(harness.repoSpy.mock.calls[1]?.[2]).toBe(50);

    await reconcilePendingPaymobPayments({ now: NOW, batchLimit: -3, fetch: harness.fetch });
    expect(harness.repoSpy.mock.calls[2]?.[2]).toBe(0);
  });
});

// ─── Inquiry mapping and handoff identity ────────────────────────────────────

describe("inquiry mapping and handoff identity", () => {
  test("maps a terminal paid inquiry to the webhook event shape, hands it to the activation surface, and logs the row outcome", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 41, paymentReference: "claim-ref-41" })],
      inquiryFor: inquiryByReference({ "claim-ref-41": INQUIRY_PAID }),
    });
    const infoSpy = trackSpy(spyOn(logger, "info"));
    infoSpy.mockImplementation(() => {});

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, skipped: 0 });
    expect(harness.handoffs).toHaveLength(1);
    expect(harness.handoffs[0]?.event).toEqual({
      reference: "claim-ref-41",
      outcome: "confirmed",
      amount: "250.00",
      currency: "EGP",
      providerTransactionId: "187200498",
    });
    expect(harness.handoffs[0]?.locale).toBe("en");

    // Wire shape: the mint carries the API key in its BODY with no auth
    // header; the inquiry carries the freshly minted token in its BODY,
    // addressed by the row's stored reference; no checkout credential
    // ever reaches the network on the reconciliation path.
    const mint = requiredCall(harness.calls, "/api/auth/tokens");
    const inquiry = requiredCall(harness.calls, "/api/ecommerce/orders/transaction_inquiry");
    expect(parseBody(mint)).toEqual({ api_key: API_KEY });
    expect(mint.headers).toEqual({ "Content-Type": "application/json" });
    expect(parseBody(inquiry)).toEqual({ auth_token: MINTED_TOKEN, merchant_order_id: "claim-ref-41" });
    expect(inquiry.headers).toEqual({ "Content-Type": "application/json" });
    for (const call of harness.calls) {
      expect(call.body).not.toContain("sk_test_reconcile_secret");
      expect(call.body).not.toContain("hmac_test_reconcile_secret");
      expect(call.body).not.toContain("pk_test_reconcile_public");
    }

    const rowLogs = infoSpy.mock.calls.filter(call => call[0] === "Paymob reconciliation row");
    expect(rowLogs).toHaveLength(1);
    expect(rowLogs[0]?.[1]).toMatchObject({ paymentId: 41, reference: "claim-ref-41", outcome: "confirmed" });
  });

  test("hands off the row's stored reference even when the vendor echo is null", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 42, paymentReference: "claim-ref-42" })],
      inquiryFor: inquiryByReference({ "claim-ref-42": INQUIRY_NULL_ECHO }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, skipped: 0 });
    expect(harness.handoffs[0]?.event.reference).toBe("claim-ref-42");
  });

  test("maps a terminal declined inquiry to the failed outcome", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 43, paymentReference: "claim-ref-43" })],
      inquiryFor: inquiryByReference({ "claim-ref-43": INQUIRY_DECLINED }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 1, skipped: 0 });
    expect(harness.handoffs[0]?.event.outcome).toBe("failed");
    expect(harness.handoffs[0]?.event.providerTransactionId).toBe("187200501");
  });

  test("counts a replayed handoff as applied — an earlier delivery already settled it", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 44, paymentReference: "claim-ref-44" })],
      inquiryFor: inquiryByReference({ "claim-ref-44": INQUIRY_PAID }),
      handoffResults: [{ processed: true, replayed: true }],
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 1, failed: 0, skipped: 0 });
  });

  test("counts a refused handoff as skipped — the activation surface mutated nothing", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 45, paymentReference: "claim-ref-45" })],
      inquiryFor: inquiryByReference({ "claim-ref-45": INQUIRY_PAID }),
      handoffResults: [{ processed: false }],
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, skipped: 1 });
    expect(harness.activationSpy.mock.calls).toHaveLength(1);
  });
});

// ─── Per-row skips ───────────────────────────────────────────────────────────

describe("per-row skips", () => {
  test("skips a row with no stored payment reference without any network call for it", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 51, paymentReference: null }), makeRow({ id: 52, paymentReference: "claim-ref-52" })],
      inquiryFor: inquiryByReference({ "claim-ref-52": INQUIRY_PAID }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 2, confirmed: 1, failed: 0, skipped: 1 });
    // Only the referenced row crossed the network: one mint + one inquiry.
    expect(harness.calls).toHaveLength(2);
    expect(harness.handoffs).toHaveLength(1);
  });

  test("leaves a still-in-flight transaction pending — the sweep never terminates an in-flight purchase", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 53, paymentReference: "claim-ref-53" })],
      inquiryFor: inquiryByReference({ "claim-ref-53": INQUIRY_IN_FLIGHT }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 1, confirmed: 0, failed: 0, skipped: 1 });
    expect(harness.activationSpy.mock.calls).toHaveLength(0);
  });

  test("skips reversal and child-transaction variants the webhook dispatch never settles", async () => {
    const harness = setupSweep({
      rows: [
        makeRow({ id: 54, paymentReference: "claim-ref-54" }),
        makeRow({ id: 55, paymentReference: "claim-ref-55" }),
        makeRow({ id: 56, paymentReference: "claim-ref-56" }),
      ],
      inquiryFor: inquiryByReference({
        "claim-ref-54": INQUIRY_REFUND,
        "claim-ref-55": INQUIRY_VOID,
        "claim-ref-56": INQUIRY_CHILD,
      }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 3, confirmed: 0, failed: 0, skipped: 3 });
    expect(harness.activationSpy.mock.calls).toHaveLength(0);
  });

  test("skips only the row whose inquiry is unavailable and continues the batch", async () => {
    const harness = setupSweep({
      rows: [
        makeRow({ id: 57, paymentReference: "claim-ref-57" }),
        makeRow({ id: 58, paymentReference: "claim-ref-58" }),
      ],
      inquiryFor: reference =>
        reference === "claim-ref-57"
          ? jsonResponse(500, { message: "upstream exploded" })
          : jsonResponse(200, INQUIRY_PAID),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 2, confirmed: 1, failed: 0, skipped: 1 });
    expect(harness.handoffs).toHaveLength(1);
    expect(harness.handoffs[0]?.event.reference).toBe("claim-ref-58");
  });
});

// ─── Failure propagation ─────────────────────────────────────────────────────

describe("failure propagation", () => {
  test("propagates a non-upstream inquiry error and aborts the run", async () => {
    const harness = setupSweep({
      rows: [makeRow({ id: 61, paymentReference: "claim-ref-61" })],
      inquiryFor: () => jsonResponse(200, INQUIRY_PAID),
    });
    const inquirySpy = trackSpy(spyOn(PaymobHttpClient.prototype, "transactionInquiryByMerchantRef"));
    inquirySpy.mockRejectedValue(new Error("inquiry infrastructure breach"));

    let caught: unknown = null;
    try {
      await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });
    } catch (error) {
      caught = error;
    }

    expect(errorOf(caught).message).toBe("inquiry infrastructure breach");
    expect(harness.activationSpy.mock.calls).toHaveLength(0);
  });
});

// ─── Sweep discipline ────────────────────────────────────────────────────────

/** Serves the mixed-batch inquiry script: a paid row, an in-flight row, and an unavailable row. */
function mixedBatchInquiry(reference: string): Response {
  if (reference === "claim-ref-71") {
    return jsonResponse(200, INQUIRY_PAID);
  }
  if (reference === "claim-ref-72") {
    return jsonResponse(200, INQUIRY_IN_FLIGHT);
  }
  return jsonResponse(500, { message: "upstream exploded" });
}

describe("sweep discipline", () => {
  test("never logs the minted token or the API key", async () => {
    const silencedLevels = ["info", "warn", "error", "debug"] as const;
    const levelSpies = silencedLevels.map(level => {
      const spy = trackSpy(spyOn(logger, level));
      spy.mockImplementation(() => {});
      return spy;
    });
    const domainSpy = trackSpy(spyOn(logger, "logDomainError"));
    domainSpy.mockImplementation(() => {});
    // A mixed batch: settled, still-in-flight, reference-less, and
    // inquiry-unavailable rows — every sweep log site fires.
    const harness = setupSweep({
      rows: [
        makeRow({ id: 71, paymentReference: "claim-ref-71" }),
        makeRow({ id: 72, paymentReference: "claim-ref-72" }),
        makeRow({ id: 73, paymentReference: null }),
        makeRow({ id: 74, paymentReference: "claim-ref-74" }),
      ],
      inquiryFor: mixedBatchInquiry,
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 4, confirmed: 1, failed: 0, skipped: 3 });
    for (const spy of [...levelSpies, domainSpy]) {
      for (const call of spy.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain(MINTED_TOKEN);
        expect(serialized).not.toContain(API_KEY);
      }
    }
  });

  test("mints a fresh auth token per row — tokens are never cached across rows", async () => {
    const harness = setupSweep({
      rows: [
        makeRow({ id: 81, paymentReference: "claim-ref-81" }),
        makeRow({ id: 82, paymentReference: "claim-ref-82" }),
      ],
      inquiryFor: inquiryByReference({ "claim-ref-81": INQUIRY_PAID, "claim-ref-82": INQUIRY_DECLINED }),
    });

    const result = await reconcilePendingPaymobPayments({ now: NOW, fetch: harness.fetch });

    expect(result).toEqual({ checked: 2, confirmed: 1, failed: 1, skipped: 0 });
    const mintCalls = harness.calls.filter(call => call.url.endsWith("/api/auth/tokens"));
    const inquiryCalls = harness.calls.filter(call => call.url.endsWith("/api/ecommerce/orders/transaction_inquiry"));
    expect(mintCalls).toHaveLength(2);
    expect(inquiryCalls).toHaveLength(2);
    for (const call of inquiryCalls) {
      expect(parseBody(call).auth_token).toBe(MINTED_TOKEN);
    }
  });
});
