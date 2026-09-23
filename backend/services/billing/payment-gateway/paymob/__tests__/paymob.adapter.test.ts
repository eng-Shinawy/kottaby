/**
 * Paymob gateway adapter suite — pure unit tier (NO DB, NO server boot),
 * run via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/paymob/__tests__/paymob.adapter.test.ts`
 *
 * Covered contract:
 *  - Fail-closed configuration: every operation re-resolves the provider
 *    configuration per request through the typed env getter; any absent
 *    required key raises the typed service-unavailable domain error before
 *    any network or verification work.
 *  - Checkout: the intention body is built from the server-derived input
 *    (field-by-field asserted), the secret key rides as the documented
 *    `Token` header, and the callback URL members compose ONLY from the
 *    tunnel channel (`ngrok` — the public tunnel URL, because Paymob must
 *    call that URL for the delivery to land on the local server); the real
 *    and simulation channels compose nothing — members omitted, the vendor
 *    falls back to the dashboard URL (the simulation channel delivers to
 *    the local route itself, and its public base is the local dev origin);
 *    the descriptor echoes the correlation key — never the intention id. Upstream rejections surface
 *    sanitized; the upstream body never reaches the caller.
 *  - Webhook dispatch (verified-before-trusted): the presented `hmac` is
 *    verified with the shape-matched key list BEFORE any member is acted
 *    on — a tampered refund/void/token delivery is a 401-class denial, not
 *    a silent ignore. Verified TOKEN/refund/void/parent-transaction
 *    deliveries (suppression reads the SIGNED `is_refunded` / `is_voided`
 *    flags — the unsigned `is_refund` / `is_void` flags alone settle) and
 *    the flat response-callback redirect (display-only) return `null`; a
 *    verified still-pending transaction returns `null` (the payment is not
 *    terminated); a verified terminal transaction maps to the domain
 *    event; a verified delivery whose order carries no usable
 *    `merchant_order_id` is the masked 400-class malformed rejection.
 *    Malformed JSON, a missing `hmac`, and objects that fit no documented
 *    shape are the same masked rejection.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { resetEnvironmentCache } from "@/backend/lib/env";
import { DomainError, UnauthorizedError, ValidationError } from "@/backend/lib/errors";
import {
  configureCallbackChannelTestDelivery,
  resetCallbackChannel,
} from "@/backend/services/billing/payment-gateway/callback-channel/callback-channel.factory";
import { PaymobPaymentGateway } from "@/backend/services/billing/payment-gateway/paymob/paymob.adapter";
import {
  buildTokenHmacMessage,
  buildTransactionHmacMessage,
  buildTransactionHmacMessageFromQuery,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.hmac";
import type { PaymobFetch } from "@/backend/services/billing/payment-gateway/paymob/paymob.http";
import type { PaymobIntentionResponse, PaymobTokenCallbackObj, PaymobTransactionCallbackObj } from "@/backend/types";
import { getServerTranslations } from "@/shared/locale/server-graphql";

// ─── Environment fixture (restored after every case) ─────────────────────────

/** Every env key the adapter reads, direct or through the typed snapshot. */
const ADAPTER_ENV_KEYS = [
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
  "PAYMENT_GATEWAY_PROVIDER",
  "NGROK_AUTHTOKEN",
  "NGROK_DOMAIN",
] as const;

const originalEnv: Record<string, string | undefined> = {};
for (const key of ADAPTER_ENV_KEYS) {
  originalEnv[key] = process.env[key];
}

/** The HMAC secret the adapter's env fixture installs (the vectors sign with it). */
const HMAC_SECRET = "paymob_adapter_test_hmac_secret";

/** The complete default paymob configuration the fixture installs. */
const REQUIRED_ENV_DEFAULTS: { [K in (typeof ADAPTER_ENV_KEYS)[number]]?: string } = {
  PAYMOB_SECRET_KEY: "sk_test_adapter_secret",
  PAYMOB_PUBLIC_KEY: "pk_test_adapter_public",
  PAYMOB_HMAC_SECRET: HMAC_SECRET,
  PAYMOB_API_KEY: "api_key_adapter_test",
  PAYMOB_INTEGRATION_ID_CARD: "1256",
};

/** Installs a paymob configuration; an explicit undefined UNSETS that key. */
function setAdapterEnv(values: Partial<Record<(typeof ADAPTER_ENV_KEYS)[number], string>> = {}): void {
  for (const key of ADAPTER_ENV_KEYS) {
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

function restoreAdapterEnv(): void {
  for (const key of ADAPTER_ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  resetEnvironmentCache();
  resetCallbackChannel();
}

beforeEach(() => {
  setAdapterEnv();
  resetCallbackChannel();
});

afterEach(restoreAdapterEnv);

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** A fully-populated documented transaction callback object (terminal success). */
const TRANSACTION_OBJ: PaymobTransactionCallbackObj = {
  id: 187_200_498,
  pending: false,
  success: true,
  amount_cents: 25_000,
  created_at: "2026-09-11T20:31:44.464153",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 1256,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refund: false,
  is_refunded: false,
  is_standalone_payment: false,
  is_void: false,
  is_voided: false,
  owner: 164_295,
  refunded_amount_cents: 0,
  captured_amount: 0,
  order: {
    id: 212_245_716,
    merchant_order_id: "purchase-claim-key",
    amount_cents: 25_000,
    currency: "EGP",
  },
  source_data: { pan: "2346", sub_type: "MasterCard", type: "c" },
};

/** A fully-populated documented card-token callback object. */
const TOKEN_OBJ: PaymobTokenCallbackObj = {
  card_subtype: "MasterCard",
  created_at: "2026-09-11T20:40:00.000000",
  email: "student@test.local",
  id: 555_001,
  masked_pan: "2346XXXXXX2346",
  merchant_id: 164_295,
  order_id: "212245716",
  token: "tok_saved_card",
};

/** A fully-populated documented intention response. */
const INTENTION_RESPONSE: PaymobIntentionResponse = {
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

/** The checkout input the purchase flow hands the adapter. */
const CHECKOUT_INPUT = {
  studentId: 7,
  planId: 3,
  amount: "250.00",
  currency: "EGP",
  specialReference: "purchase-claim-key",
  billing: { firstName: "Ala", lastName: "Zain", email: "ala@example.com", phone: null },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Computes the vendor's HMAC-SHA512 lowercase-hex digest of one message. */
function signMessage(message: string, secret: string = HMAC_SECRET): string {
  return createHmac("sha512", secret).update(message).digest("hex");
}

/** The query of a processed-callback POST delivery: only the signed `hmac`. */
function transactionQuery(obj: PaymobTransactionCallbackObj): Record<string, string> {
  return { hmac: signMessage(buildTransactionHmacMessage(obj)) };
}

/** The query of a token-callback POST delivery: only the signed `hmac`. */
function tokenQuery(obj: PaymobTokenCallbackObj): Record<string, string> {
  return { hmac: signMessage(buildTokenHmacMessage(obj)) };
}

/** Builds the flat response-callback query (documented parameter names, string values). */
function flatResponseQuery(obj: PaymobTransactionCallbackObj, hmac: string): Record<string, string> {
  return {
    amount_cents: String(obj.amount_cents),
    created_at: obj.created_at,
    currency: obj.currency,
    error_occured: String(obj.error_occured),
    has_parent_transaction: String(obj.has_parent_transaction),
    id: String(obj.id),
    integration_id: String(obj.integration_id),
    is_3d_secure: String(obj.is_3d_secure),
    is_auth: String(obj.is_auth),
    is_capture: String(obj.is_capture),
    is_refunded: String(obj.is_refunded),
    is_standalone_payment: String(obj.is_standalone_payment),
    is_voided: String(obj.is_voided),
    order_id: String(obj.order.id),
    owner: String(obj.owner),
    pending: String(obj.pending),
    "source_data.pan": obj.source_data.pan,
    "source_data.sub_type": obj.source_data.sub_type,
    "source_data.type": obj.source_data.type,
    success: String(obj.success),
    hmac,
  };
}

/** One recorded outbound send. */
interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** The agent command the tunnel channel's spawn seam last captured. */
let capturedSpawnCommand: string[] = [];

/** Builds an adapter over a transport that serves one scripted intention response. */
function adapterServing(response: Response): { adapter: PaymobPaymentGateway; calls: RecordedRequest[] } {
  const calls: RecordedRequest[] = [];
  const fetch: PaymobFetch = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body });
    return response;
  };
  return { adapter: new PaymobPaymentGateway({ fetch }), calls };
}

/** Runs an async thunk, returning the thrown value (or null when nothing threw). */
async function catchRejection(fn: () => Promise<unknown>): Promise<unknown> {
  let caught: unknown = null;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  return caught;
}

/** Runs a sync thunk, returning the thrown value (or null when nothing threw). */
function catchSync(fn: () => unknown): unknown {
  let caught: unknown = null;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  return caught;
}

/**
 * Asserts createCheckout fails closed (service-unavailable domain error)
 * for each missing key in turn. Sequential recursion rather than a loop:
 * every case mutates the shared env fixture, so the cases must run one at
 * a time and in order.
 */
async function expectServiceUnavailableForEachMissingKey(missingKeys: string[]): Promise<void> {
  if (missingKeys.length === 0) {
    return;
  }
  const [missingKey, ...remainingKeys] = missingKeys;
  setAdapterEnv({ [missingKey]: undefined });
  const adapter = new PaymobPaymentGateway();
  const caught = await catchRejection(() => adapter.createCheckout(CHECKOUT_INPUT));
  expect(caught).toBeInstanceOf(DomainError);
  if (caught instanceof DomainError) {
    expect(caught.code).toBe("SERVICE_UNAVAILABLE");
    expect(caught.message).toBe("Payment gateway is not configured.");
  }
  await expectServiceUnavailableForEachMissingKey(remainingKeys);
}

/** Type predicate: the failed-verification rejection. */
function isUnauthorized(value: unknown): value is UnauthorizedError {
  return value instanceof UnauthorizedError;
}

/** Type predicate: the masked malformed-delivery rejection. */
function isMalformed(value: unknown): value is ValidationError {
  return value instanceof ValidationError;
}

/** Asserts a caught value is the unauthorized rejection and returns it. */
function unauthorizedOf(caught: unknown): UnauthorizedError {
  if (!isUnauthorized(caught)) {
    throw new Error("expected an UnauthorizedError rejection");
  }
  expect(caught.code).toBe("UNAUTHORIZED");
  expect(caught.message).toBe("Invalid payment webhook signature.");
  return caught;
}

/** Asserts a caught value is the malformed-delivery rejection and returns it. */
function malformedOf(caught: unknown): ValidationError {
  if (!isMalformed(caught)) {
    throw new Error("expected a ValidationError rejection");
  }
  expect(caught.code).toBe("PAYMENT_WEBHOOK_MALFORMED");
  expect(caught.message).toBe(getServerTranslations("en").errorsTranslations.validation);
  return caught;
}

// ─── Fail-closed configuration guard ─────────────────────────────────────────

describe("PaymobPaymentGateway fail-closed configuration", () => {
  test("createCheckout rejects with the service-unavailable domain error when a required key is absent", async () => {
    await expectServiceUnavailableForEachMissingKey([
      "PAYMOB_SECRET_KEY",
      "PAYMOB_PUBLIC_KEY",
      "PAYMOB_HMAC_SECRET",
      "PAYMOB_API_KEY",
      "PAYMOB_INTEGRATION_ID_CARD",
    ]);
  });

  test("parseWebhookEvent rejects fail-closed too — verification needs the configured secret", () => {
    setAdapterEnv({ PAYMOB_HMAC_SECRET: undefined });
    const adapter = new PaymobPaymentGateway();
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({ rawBody: JSON.stringify({ obj: TRANSACTION_OBJ }), query: { hmac: "x" } })
    );
    expect(caught).toBeInstanceOf(DomainError);
    expect(caught instanceof DomainError && caught.code).toBe("SERVICE_UNAVAILABLE");
  });
});

// ─── Checkout flow ───────────────────────────────────────────────────────────

describe("PaymobPaymentGateway.createCheckout", () => {
  test("composes the callback URLs from the tunnel channel's public base when the tunnel is configured and its probe passes", async () => {
    setAdapterEnv({
      PAYMENT_GATEWAY_PROVIDER: PaymentGateway.Paymob,
      NGROK_AUTHTOKEN: "adapter-test-tunnel-token",
      NGROK_DOMAIN: "adapter-test-tunnel.ngrok.app",
    });
    // The readiness sequence: the FIRST public probe fails (no agent yet),
    // which is what starts the agent; the later probes answer 200 once the
    // (stubbed) agent is up. An already-answering tunnel is ADOPTED without
    // a spawn — a passing first probe would never start one.
    let probeCount = 0;
    configureCallbackChannelTestDelivery({
      spawnAgent: ({ command }) => {
        capturedSpawnCommand = [...command];
        return { kill: () => {} };
      },
      fetch: async () => {
        probeCount += 1;
        if (probeCount === 1) {
          throw new Error("tunnel agent not established yet");
        }
        return new Response(null, { status: 200 });
      },
    });
    const { adapter, calls } = adapterServing(new Response(JSON.stringify(INTENTION_RESPONSE), { status: 201 }));

    const session = await adapter.createCheckout(CHECKOUT_INPUT);

    const body = JSON.parse(calls[0].body);
    expect(body.notification_url).toBe("https://adapter-test-tunnel.ngrok.app/api/payments/webhook");
    expect(body.redirection_url).toBe("https://adapter-test-tunnel.ngrok.app/student/checkout/result");
    expect(capturedSpawnCommand).toEqual(["ngrok", "http", "--url=https://adapter-test-tunnel.ngrok.app", "3000"]);
    expect(session.checkoutUrl).toBe(
      "https://eg.checkout.paymob.com?publicKey=pk_test_adapter_public&clientSecret=cs_secret_value"
    );
  });

  test("omits the callback URL members when the resolved channel is the simulation channel — its public base is the local dev origin", async () => {
    setAdapterEnv({ PAYMENT_GATEWAY_PROVIDER: PaymentGateway.Paymob });
    const { adapter, calls } = adapterServing(new Response(JSON.stringify(INTENTION_RESPONSE), { status: 201 }));

    await adapter.createCheckout(CHECKOUT_INPUT);

    const body = JSON.parse(calls[0].body);
    expect("notification_url" in body).toBe(false);
    expect("redirection_url" in body).toBe(false);
  });

  test("omits the callback URL members when the resolved channel is the real channel (dashboard-configured callback URLs)", async () => {
    setAdapterEnv({ PAYMENT_GATEWAY_PROVIDER: PaymentGateway.Mock });
    const { adapter, calls } = adapterServing(new Response(JSON.stringify(INTENTION_RESPONSE), { status: 201 }));

    await adapter.createCheckout(CHECKOUT_INPUT);

    const body = JSON.parse(calls[0].body);
    expect("notification_url" in body).toBe(false);
    expect("redirection_url" in body).toBe(false);
  });

  test("builds the intention from the server-derived input and returns the correlation-key descriptor", async () => {
    setAdapterEnv();
    const { adapter, calls } = adapterServing(new Response(JSON.stringify(INTENTION_RESPONSE), { status: 201 }));

    const session = await adapter.createCheckout(CHECKOUT_INPUT);

    expect(calls).toHaveLength(1);
    const request = calls[0];
    expect(request.url).toBe("https://accept.paymob.com/v1/intention/");
    expect(request.headers.Authorization).toBe("Token sk_test_adapter_secret");

    const body = JSON.parse(request.body);
    expect(body.amount).toBe(25_000);
    expect(body.currency).toBe("EGP");
    expect(body.payment_methods).toEqual([1256]);
    expect(body.items).toEqual([{ name: "Subscription", amount: 25_000, quantity: 1 }]);
    expect(body.billing_data).toEqual({
      first_name: "Ala",
      last_name: "Zain",
      email: "ala@example.com",
      phone_number: "NA",
      apartment: "NA",
      street: "NA",
      building: "NA",
      city: "NA",
      country: "NA",
      floor: "NA",
      state: "NA",
    });
    expect(body.special_reference).toBe("purchase-claim-key");

    expect(session.provider).toBe(PaymentGateway.Paymob);
    expect(session.providerReference).toBe("purchase-claim-key");
    expect(session.checkoutUrl).toBe(
      "https://eg.checkout.paymob.com?publicKey=pk_test_adapter_public&clientSecret=cs_secret_value"
    );
  });

  test("offers the wallet integration alongside the card when configured", async () => {
    setAdapterEnv({ PAYMOB_INTEGRATION_ID_WALLET: "4567" });
    const { adapter, calls } = adapterServing(new Response(JSON.stringify(INTENTION_RESPONSE), { status: 201 }));

    await adapter.createCheckout(CHECKOUT_INPUT);

    expect(JSON.parse(calls[0].body).payment_methods).toEqual([1256, 4567]);
  });

  test("surfaces an upstream rejection sanitized — no body material, no retry", async () => {
    setAdapterEnv();
    const { adapter, calls } = adapterServing(
      new Response(JSON.stringify({ message: "Integration ID/Name does not exist" }), { status: 404 })
    );

    const caught = await catchRejection(() => adapter.createCheckout(CHECKOUT_INPUT));

    expect(caught).toBeInstanceOf(DomainError);
    expect(caught instanceof DomainError && caught.code).toBe("SERVICE_UNAVAILABLE");
    expect(caught instanceof DomainError && caught.message).toBe("Payment provider rejected the request.");
    expect(caught instanceof DomainError && caught.message).not.toContain("Integration ID");
    expect(calls).toHaveLength(1);
  });
});

// ─── Webhook dispatch: verified money-movers ─────────────────────────────────

describe("PaymobPaymentGateway.parseWebhookEvent — transaction-shaped deliveries", () => {
  const adapter = new PaymobPaymentGateway();

  test("maps a verified terminal success callback to the domain event", () => {
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ type: "TRANSACTION", obj: TRANSACTION_OBJ }),
      query: transactionQuery(TRANSACTION_OBJ),
    });
    expect(event).toEqual({
      reference: "purchase-claim-key",
      outcome: "confirmed",
      amount: "250.00",
      currency: "EGP",
      providerTransactionId: "187200498",
    });
  });

  test("dispatches by shape without the type discriminator", () => {
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: TRANSACTION_OBJ }),
      query: transactionQuery(TRANSACTION_OBJ),
    });
    expect(event?.outcome).toBe("confirmed");
  });

  test("returns null for a success still flagged pending — the payment is not terminated", () => {
    // The pending delivery moves no money: the adapter acknowledges it as a
    // no-op so the later confirmed callback can settle the purchase.
    const pendingSuccess = { ...TRANSACTION_OBJ, pending: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: pendingSuccess }),
      query: transactionQuery(pendingSuccess),
    });
    expect(event).toBeNull();
  });

  test("maps a declined callback as failed", () => {
    const declined = { ...TRANSACTION_OBJ, success: false };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: declined }),
      query: transactionQuery(declined),
    });
    expect(event?.outcome).toBe("failed");
  });

  test("rejects a verified delivery whose order carries no merchant echo as malformed", () => {
    // Without a usable `merchant_order_id` the callback cannot be resolved
    // to any purchase — the adapter rejects it at the boundary instead of
    // emitting an unrouteable event.
    const anonymousOrder = { ...TRANSACTION_OBJ, order: { ...TRANSACTION_OBJ.order, merchant_order_id: null } };
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ obj: anonymousOrder }),
        query: transactionQuery(anonymousOrder),
      })
    );
    malformedOf(caught);
  });
});

// ─── Webhook dispatch: verification precedes every ignore ────────────────────

describe("PaymobPaymentGateway.parseWebhookEvent — verification precedes every ignore", () => {
  const adapter = new PaymobPaymentGateway();

  test("denies a tampered transaction with the 401-class rejection", () => {
    const tampered = { ...TRANSACTION_OBJ, amount_cents: 1 };
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ obj: tampered }),
        query: transactionQuery(TRANSACTION_OBJ),
      })
    );
    const error = unauthorizedOf(caught);
    expect(error.message).not.toContain("amount_cents");
  });

  test("denies a tampered refund-shaped transaction with a bad hmac — verification runs BEFORE the ignore", () => {
    // `is_refund` is not a signed member — flipping it alone keeps the
    // signature valid (the verified-ignore path, pinned below). A delivery
    // whose SIGNED members were tampered is denied even when it would have
    // been ignored, because verification precedes every ignore decision.
    const refund = { ...TRANSACTION_OBJ, is_refund: true };
    const signatureBase = { ...TRANSACTION_OBJ, amount_cents: 999 };
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ obj: refund }),
        query: transactionQuery(signatureBase),
      })
    );
    expect(caught).toBeInstanceOf(UnauthorizedError);
  });

  test("denies a tampered void-shaped transaction with a bad hmac", () => {
    const voided = { ...TRANSACTION_OBJ, is_void: true };
    const signatureBase = { ...TRANSACTION_OBJ, amount_cents: 999 };
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ obj: voided }),
        query: transactionQuery(signatureBase),
      })
    );
    expect(caught).toBeInstanceOf(UnauthorizedError);
  });

  test("denies a TOKEN-typed delivery with a bad hmac", () => {
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ type: "TOKEN", obj: TOKEN_OBJ }),
        query: transactionQuery(TRANSACTION_OBJ),
      })
    );
    expect(caught).toBeInstanceOf(UnauthorizedError);
  });

  test("denies a flat redirect delivery with a bad hmac", () => {
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: "{}",
        query: flatResponseQuery(TRANSACTION_OBJ, "attacker-supplied"),
      })
    );
    expect(caught).toBeInstanceOf(UnauthorizedError);
  });
});

// ─── Webhook dispatch: verified-but-ignored variants ─────────────────────────

describe("PaymobPaymentGateway.parseWebhookEvent — verified-but-ignored variants", () => {
  const adapter = new PaymobPaymentGateway();

  test("ignores a verified TOKEN-typed callback", () => {
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ type: "TOKEN", obj: TOKEN_OBJ }),
      query: tokenQuery(TOKEN_OBJ),
    });
    expect(event).toBeNull();
  });

  test("ignores a verified token-shaped callback without the type member", () => {
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: TOKEN_OBJ }),
      query: tokenQuery(TOKEN_OBJ),
    });
    expect(event).toBeNull();
  });

  test("ignores a verified refund transaction", () => {
    // Suppression reads the HMAC-SIGNED state flags — the vendor signs
    // `is_refunded`, not its unsigned `is_refund` counterpart — so the
    // ignored delivery is always attested by the signature itself.
    const refund = { ...TRANSACTION_OBJ, is_refunded: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: refund }),
      query: transactionQuery(refund),
    });
    expect(event).toBeNull();
  });

  test("ignores a verified void transaction", () => {
    const voided = { ...TRANSACTION_OBJ, is_voided: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: voided }),
      query: transactionQuery(voided),
    });
    expect(event).toBeNull();
  });

  test("settles a verified transaction whose UNSIGNED refund flag alone is flipped", () => {
    // `is_refund` is NOT a signed member — flipping it alone keeps the
    // signature valid, and the suppression condition reads the signed
    // `is_refunded` flag, so this delivery is a first-party charge that
    // SETTLES (a confirmed event, not a silent ignore).
    const unsignedRefundFlag = { ...TRANSACTION_OBJ, is_refund: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: unsignedRefundFlag }),
      query: transactionQuery(unsignedRefundFlag),
    });
    expect(event?.outcome).toBe("confirmed");
    expect(event?.providerTransactionId).toBe(String(TRANSACTION_OBJ.id));
  });

  test("settles a verified transaction whose UNSIGNED void flag alone is flipped", () => {
    const unsignedVoidFlag = { ...TRANSACTION_OBJ, is_void: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: unsignedVoidFlag }),
      query: transactionQuery(unsignedVoidFlag),
    });
    expect(event?.outcome).toBe("confirmed");
  });

  test("ignores a verified parent-transaction callback", () => {
    const child = { ...TRANSACTION_OBJ, has_parent_transaction: true };
    const event = adapter.parseWebhookEvent({
      rawBody: JSON.stringify({ obj: child }),
      query: transactionQuery(child),
    });
    expect(event).toBeNull();
  });

  test("ignores a verified flat response-callback redirect — display-only, never settlement", () => {
    // The flat message is built from the same query record the delivery
    // presents (the `hmac` member itself is not part of the signed set).
    const unsignedQuery = flatResponseQuery(TRANSACTION_OBJ, "");
    const event = adapter.parseWebhookEvent({
      rawBody: "{}",
      query: flatResponseQuery(TRANSACTION_OBJ, signMessage(buildTransactionHmacMessageFromQuery(unsignedQuery))),
    });
    expect(event).toBeNull();
  });
});

// ─── Webhook dispatch: malformed deliveries ──────────────────────────────────

describe("PaymobPaymentGateway.parseWebhookEvent — malformed deliveries", () => {
  const adapter = new PaymobPaymentGateway();

  test("denies a missing or empty query hmac with the malformed rejection", () => {
    for (const query of [{}, { hmac: "" }]) {
      const caught = catchSync(() =>
        adapter.parseWebhookEvent({ rawBody: JSON.stringify({ obj: TRANSACTION_OBJ }), query })
      );
      malformedOf(caught);
    }
  });

  test("denies malformed JSON and non-object roots", () => {
    for (const rawBody of ["{not json", "", "42", '"a string"', "null", "[1,2]"]) {
      const caught = catchSync(() => adapter.parseWebhookEvent({ rawBody, query: { hmac: "x" } }));
      malformedOf(caught);
    }
  });

  test("denies a nested object that fits no documented shape — never guessed at", () => {
    const caught = catchSync(() =>
      adapter.parseWebhookEvent({
        rawBody: JSON.stringify({ obj: { success: "yes" } }),
        query: { hmac: "attacker-supplied" },
      })
    );
    malformedOf(caught);
  });
});

// ─── Adapter identity ────────────────────────────────────────────────────────

describe("PaymobPaymentGateway identity", () => {
  test("the adapter resolves the paymob provider by its enum value", () => {
    expect(new PaymobPaymentGateway().provider).toBe(PaymentGateway.Paymob);
  });
});
