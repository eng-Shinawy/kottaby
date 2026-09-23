/**
 * Paymob HTTP client suite — pure unit tier (NO DB, NO server boot), run
 * via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/paymob/__tests__/paymob.http.test.ts`
 *
 * Covered contract:
 *  - Wire shape: the intention POST carries the secret key as the
 *    documented `Authorization: Token` header; the auth-token mint carries
 *    the API key in the request BODY (no header); the transaction inquiry
 *    authenticates with the freshly minted token in the request BODY —
 *    the Bearer-header form belongs to the by-transaction-id endpoint this
 *    integration does not use. Tokens are minted per inquiry and never
 *    cached.
 *  - Bounded retry policy: `special_reference` is a correlation field, NOT
 *    an idempotency key, so the intention POST is NEVER retried — a 5xx or
 *    a no-response transport failure on the intention path is TERMINAL as a
 *    `PaymobUnknownStateError` (the request may have been applied; the
 *    reconciliation sweep heals by merchant reference). The auth-token mint
 *    (idempotent) and the transaction inquiry (read-only) DO retry a 5xx
 *    and a no-response transport failure inside the attempt budget; a
 *    timed-out request is NEVER retried on any path (it was delivered — its
 *    provider-side state is unknown); a 4xx and an unusable 2xx response
 *    are terminal.
 *  - Sanitization: every failure surfaces as the typed upstream error with
 *    the sanitized HTTP status (null when no response arrived) and a fixed
 *    generic message — upstream body content never enters an error.
 *  - Minimal response validation: a 2xx payload missing a consumed member
 *    fails closed as a provider error instead of flowing `undefined` into
 *    money paths.
 */

import { describe, expect, test } from "bun:test";
import { DomainError } from "@/backend/lib/errors";
import {
  type PaymobFetch,
  PaymobHttpClient,
  PaymobUnknownStateError,
  PaymobUpstreamError,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import type { PaymobIntentionRequest, PaymobResolvedConfig } from "@/backend/types";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Fully-populated resolved configuration with a fast timeout for retry tests. */
const CONFIG: PaymobResolvedConfig = {
  secretKey: "sk_test_http_secret",
  publicKey: "pk_test_http_public",
  hmacSecret: "hmac_test_secret",
  apiKey: "api_key_test",
  integrationIdCard: 1256,
  integrationIdWallet: 4567,
  apiBaseUrl: "https://paymob.test/api",
  checkoutBaseUrl: "https://checkout.paymob.test",
  httpTimeoutMs: 10_000,
};

/** The intention request body the client POSTs verbatim. */
const INTENTION_REQUEST: PaymobIntentionRequest = {
  amount: 25_000,
  currency: "EGP",
  payment_methods: [1256, 4567],
  items: [{ name: "Subscription", amount: 25_000, quantity: 1 }],
  billing_data: {
    apartment: "NA",
    first_name: "Ala",
    last_name: "Zain",
    street: "NA",
    building: "NA",
    phone_number: "+201000000000",
    city: "NA",
    country: "NA",
    email: "ala@example.com",
    floor: "NA",
    state: "NA",
  },
  special_reference: "purchase-claim-key",
  notification_url: "https://app.example.com/api/payments/webhook",
  redirection_url: "https://app.example.com/student/checkout/result",
};

/** A fully-populated documented intention response. */
const INTENTION_RESPONSE = {
  id: "pi_100121",
  intention_order_id: 212_245_716,
  client_secret: "cs_secret_value",
  special_reference: "purchase-claim-key",
  status: "UNPAID",
  confirmed: false,
  intention_detail: { amount: 25_000, currency: "EGP" },
  created: "2026-09-11T20:31:44.000000",
  object: "intention",
};

/** A fully-populated documented transaction-inquiry result. */
const INQUIRY_RESPONSE = {
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
  order: {
    id: 212_245_716,
    merchant_order_id: "purchase-claim-key",
    amount_cents: 25_000,
    currency: "EGP",
  },
  source_data: { pan: "2346", sub_type: "MasterCard", type: "c" },
};

// ─── Recording transport ─────────────────────────────────────────────────────

/** One recorded send: every piece the client controls, plus the signal. */
interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
  readonly signal: AbortSignal;
}

/** Builds a fetch stand-in that records every call and serves a script of responses. */
function makeTransport(respond: (call: number, request: RecordedRequest) => Promise<Response> | Response): {
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
    return respond(calls.length, request);
  };
  return { fetch, calls };
}

/** Builds a JSON response with the given status and payload. */
function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status });
}

/** Resolves after the given delay — used to simulate a slow upstream. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/** Builds a client over the given transport. */
function buildClient(calls: { fetch: PaymobFetch }, config: PaymobResolvedConfig = CONFIG): PaymobHttpClient {
  return new PaymobHttpClient({ config, fetch: calls.fetch });
}

/** Type predicate for the typed upstream error (no casts on caught values). */
function isPaymobUpstreamError(value: unknown): value is PaymobUpstreamError {
  return value instanceof PaymobUpstreamError;
}

/** Asserts a caught value is the typed upstream error and returns it. */
function upstreamErrorOf(caught: unknown): PaymobUpstreamError {
  if (!isPaymobUpstreamError(caught)) {
    throw new Error("expected a PaymobUpstreamError rejection");
  }
  expect(caught).toBeInstanceOf(DomainError);
  return caught;
}

// ─── Intention wire shape ────────────────────────────────────────────────────

describe("PaymobHttpClient.createIntention", () => {
  test("POSTs the intention to the configured API base with the secret-key Token header", async () => {
    const transport = makeTransport(() => jsonResponse(200, INTENTION_RESPONSE));
    const client = buildClient(transport);

    const response = await client.createIntention(INTENTION_REQUEST);

    expect(transport.calls).toHaveLength(1);
    const request = transport.calls[0];
    expect(request.url).toBe("https://paymob.test/api/v1/intention/");
    expect(request.method).toBe("POST");
    expect(request.headers["Content-Type"]).toBe("application/json");
    expect(request.headers.Authorization).toBe("Token sk_test_http_secret");
    expect(request.body).toBe(JSON.stringify(INTENTION_REQUEST));
    expect(response).toEqual(INTENTION_RESPONSE);
  });

  test("fails closed on a 2xx response missing a consumed member", async () => {
    const { id: _id, ...incomplete } = INTENTION_RESPONSE;
    const transport = makeTransport(() => jsonResponse(200, incomplete));
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.code).toBe("SERVICE_UNAVAILABLE");
    expect(error.status).toBe(200);
    expect(error.message).toBe("Payment provider returned an unusable response.");
  });

  test("never surfaces upstream body material in the error", async () => {
    const transport = makeTransport(() =>
      jsonResponse(200, {
        error_description: "secret-integration-leak-marker",
        id: "pi_100121",
      })
    );
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.message).toBe("Payment provider returned an unusable response.");
    expect(error.message).not.toContain("secret-integration-leak-marker");
  });
});

// ─── Auth token + inquiry authentication ─────────────────────────────────────

describe("PaymobHttpClient auth token + transaction inquiry", () => {
  test("mints the auth token from the API key in the request body — no header", async () => {
    const transport = makeTransport(() => jsonResponse(200, { token: "minted-token", profile: { id: 106 } }));
    const client = buildClient(transport);

    const response = await client.mintAuthToken();

    expect(response.token).toBe("minted-token");
    expect(transport.calls).toHaveLength(1);
    const request = transport.calls[0];
    expect(request.url).toBe("https://paymob.test/api/api/auth/tokens");
    expect(JSON.parse(request.body)).toEqual({ api_key: "api_key_test" });
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.headers["Content-Type"]).toBe("application/json");
  });

  test("authenticates the inquiry with the minted token in the request BODY", async () => {
    const transport = makeTransport(call =>
      call === 1 ? jsonResponse(200, { token: "minted-token" }) : jsonResponse(200, INQUIRY_RESPONSE)
    );
    const client = buildClient(transport);

    const response = await client.transactionInquiryByMerchantRef("purchase-claim-key");

    expect(response.order.merchant_order_id).toBe("purchase-claim-key");
    expect(transport.calls).toHaveLength(2);
    const inquiry = transport.calls[1];
    expect(inquiry.url).toBe("https://paymob.test/api/api/ecommerce/orders/transaction_inquiry");
    expect(JSON.parse(inquiry.body)).toEqual({ auth_token: "minted-token", merchant_order_id: "purchase-claim-key" });
    // The minted token rides in the BODY, never as a Bearer/Token header.
    expect(inquiry.headers.Authorization).toBeUndefined();
  });

  test("mints a FRESH token per inquiry — nothing is cached between calls", async () => {
    const transport = makeTransport(call =>
      call % 2 === 1
        ? jsonResponse(200, { token: `minted-token-${Math.ceil(call / 2)}` })
        : jsonResponse(200, INQUIRY_RESPONSE)
    );
    const client = buildClient(transport);

    await client.transactionInquiryByMerchantRef("claim-one");
    await client.transactionInquiryByMerchantRef("claim-two");

    expect(transport.calls).toHaveLength(4);
    expect(JSON.parse(transport.calls[0].body).api_key).toBe("api_key_test");
    expect(JSON.parse(transport.calls[2].body).api_key).toBe("api_key_test");
    expect(JSON.parse(transport.calls[1].body).auth_token).toBe("minted-token-1");
    expect(JSON.parse(transport.calls[3].body).auth_token).toBe("minted-token-2");
  });

  test("fails closed on an inquiry result missing a consumed member", async () => {
    const { pending: _pending, ...incomplete } = INQUIRY_RESPONSE;
    const transport = makeTransport(call =>
      call === 1 ? jsonResponse(200, { token: "minted-token" }) : jsonResponse(200, incomplete)
    );
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.transactionInquiryByMerchantRef("purchase-claim-key");
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.message).toBe("Payment provider returned an unusable response.");
  });
});

// ─── Bounded retry policy ────────────────────────────────────────────────────

describe("PaymobHttpClient bounded retry policy", () => {
  test("retries a 5xx inside the attempt budget and succeeds — on the read-only inquiry path", async () => {
    const transport = makeTransport(call => {
      if (call === 1) {
        return jsonResponse(200, { token: "minted-token" });
      }
      // Two 5xx retries inside the attempt budget, then success.
      if (call < 4) {
        return jsonResponse(503, { error: "upstream marker" });
      }
      return jsonResponse(200, INQUIRY_RESPONSE);
    });
    const client = buildClient(transport);

    const response = await client.transactionInquiryByMerchantRef("purchase-claim-key");

    expect(response.order.merchant_order_id).toBe("purchase-claim-key");
    // One mint + three inquiry attempts (two 5xx retries, then success).
    expect(transport.calls).toHaveLength(4);
    expect(transport.calls[0].url).toContain("/api/auth/tokens");
  });

  test("exhausts the attempt budget on persistent 5xx with the sanitized status — on the inquiry path", async () => {
    const transport = makeTransport(call =>
      call === 1 ? jsonResponse(200, { token: "minted-token" }) : jsonResponse(500, { error: "upstream marker" })
    );
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.transactionInquiryByMerchantRef("purchase-claim-key");
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.status).toBe(500);
    expect(error.message).toBe("Payment provider rejected the request.");
    expect(error.message).not.toContain("upstream marker");
    // One mint + three inquiry attempts (the attempt budget).
    expect(transport.calls).toHaveLength(4);
  });

  test("NEVER retries the intention POST on a 5xx — the request may have been applied", async () => {
    // `special_reference` is a correlation field, not an idempotency key, so
    // a retried intention POST could mint a duplicate intention at the
    // vendor even when the first attempt seemed to fail.
    const transport = makeTransport(() => jsonResponse(500, { error: "upstream marker" }));
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error).toBeInstanceOf(PaymobUnknownStateError);
    expect(error.status).toBeNull();
    expect(error.message).toBe("Payment provider state is unknown; the request may have been applied.");
    expect(error.message).not.toContain("upstream marker");
    expect(transport.calls).toHaveLength(1);
  });

  test("NEVER retries a 4xx — a deterministic rejection is terminal", async () => {
    const transport = makeTransport(() => jsonResponse(404, { message: "Integration ID/Name does not exist" }));
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Payment provider rejected the request.");
    expect(error.message).not.toContain("Integration ID");
    expect(transport.calls).toHaveLength(1);
  });

  test("retries a no-response transport failure — on the read-only inquiry path", async () => {
    const transport = makeTransport(call => {
      if (call === 1) {
        return jsonResponse(200, { token: "minted-token" });
      }
      if (call === 2) {
        throw new Error("socket hang up");
      }
      return jsonResponse(200, INQUIRY_RESPONSE);
    });
    const client = buildClient(transport);

    const response = await client.transactionInquiryByMerchantRef("purchase-claim-key");

    expect(response.order.merchant_order_id).toBe("purchase-claim-key");
    // One mint + two inquiry attempts (one retry, then success).
    expect(transport.calls).toHaveLength(3);
  });

  test("NEVER retries the intention POST on a no-response transport failure — single call, unknown state", async () => {
    const transport = makeTransport(() => {
      throw new Error("socket hang up");
    });
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error).toBeInstanceOf(PaymobUnknownStateError);
    expect(error.status).toBeNull();
    expect(error.message).toBe("Payment provider state is unknown; the request may have been applied.");
    expect(transport.calls).toHaveLength(1);
  });

  test("NEVER retries a timed-out request — it was SENT, its state is unknown", async () => {
    const calls: RecordedRequest[] = [];
    const fetch: PaymobFetch = async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers, body: init.body, signal: init.signal });
      // Deliver the rejection only AFTER the per-attempt timeout fired: the
      // request reached the wire and its provider-side state is unknown.
      await delay(60);
      throw new Error("socket hang up");
    };
    const client = buildClient({ fetch }, { ...CONFIG, httpTimeoutMs: 20 });

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.status).toBeNull();
    expect(error.message).toBe("Payment provider did not respond in time.");
    expect(calls).toHaveLength(1);
  });

  test("surfaces a transport failure that exhausts the intention path as a single unknown-state call with status null", async () => {
    // Even at the attempt budget the intention POST never retries: the
    // rejection is the unknown-state error (status null — no response
    // arrived), surfaced after exactly one send.
    const transport = makeTransport(() => {
      throw new Error("connection refused");
    });
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error).toBeInstanceOf(PaymobUnknownStateError);
    expect(error.status).toBeNull();
    expect(error.message).toBe("Payment provider state is unknown; the request may have been applied.");
    expect(transport.calls).toHaveLength(1);
  });

  test("treats an unusable 2xx body as terminal — never retried", async () => {
    const transport = makeTransport(() => new Response("<html>gateway error page</html>", { status: 200 }));
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.status).toBe(200);
    expect(error.message).toBe("Payment provider returned an unusable response.");
    expect(error.message).not.toContain("gateway error page");
    expect(transport.calls).toHaveLength(1);
  });

  test("treats a non-object 2xx payload as terminal", async () => {
    const transport = makeTransport(() => jsonResponse(200, ["unexpected", "array"]));
    const client = buildClient(transport);

    let caught: unknown = null;
    try {
      await client.createIntention(INTENTION_REQUEST);
    } catch (error) {
      caught = error;
    }

    const error = upstreamErrorOf(caught);
    expect(error.status).toBe(200);
    expect(error.message).toBe("Payment provider returned an unusable response.");
    expect(transport.calls).toHaveLength(1);
  });
});
