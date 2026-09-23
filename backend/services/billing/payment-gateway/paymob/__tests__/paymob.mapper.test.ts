/**
 * Paymob mapper suite — pure-function tier (NO DB, NO env reads, NO I/O,
 * NO server boot), run via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/paymob/__tests__/paymob.mapper.test.ts`
 *
 * Covered contract:
 *  - Intention request: the full `POST v1/intention/` body field by field
 *    (integer cents on the total AND the line item, currency passthrough,
 *    integer integration IDs with the wallet appended only when
 *    configured, single named item, `special_reference` verbatim, both
 *    callback URLs verbatim) plus the `"NA"` billing placeholder matrix
 *    (nullable phone, empty/whitespace members, absent address members,
 *    whitespace trimming of usable values).
 *  - Cents guard: accepted shapes ("0.01", "250.00", one fraction digit,
 *    zero) and rejected shapes (three fraction digits, non-numeric text,
 *    empty, trailing/leading dot, sign prefix, negative) — rejections are
 *    `ValidationError`s carrying the localized purchase-rejection copy from
 *    the compile-time `errors` bundle (pinned against the en leaf) thrown
 *    before any network call, and cent values beyond the safe integer
 *    range are rejected too.
 *  - Checkout descriptor: the URL is the configured checkout prefix plus
 *    EXACTLY the two documented query parameters (pinned for a path-less
 *    prefix and for a legacy prefix with path + trailing slash); the
 *    descriptor carries the paymob enum value and echoes the correlation
 *    key from the handed-in request; a response missing the intention id
 *    or the client secret, or whose echoed correlation key or
 *    `intention_detail` amount/currency diverges from the request, is a
 *    domain error.
 *  - Callback event: terminal success confirms; declined fails; a success
 *    still flagged pending returns `null` — the local payment stays open
 *    for the later confirmed callback instead of being marked failed;
 *    cents become a two-fraction-digit decimal string (including
 *    sub-cent-scale values); the correlation reference comes from
 *    `order.merchant_order_id` (empty when the provider omits it — the
 *    adapter rejects such deliveries as malformed at its boundary) and the
 *    transaction id is stringified.
 */

import { describe, expect, test } from "bun:test";
import { PaymentGateway } from "@/backend/enum/billing/payment-gateway.enum";
import { DomainError, ValidationError } from "@/backend/lib/errors";
import {
  buildIntentionRequest,
  mapCallbackToEvent,
  toCheckoutDescriptor,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.mapper";
import type {
  PaymentCheckoutInput,
  PaymentWebhookEvent,
  PaymobIntentionResponse,
  PaymobProcessedCallbackBody,
  PaymobResolvedConfig,
} from "@/backend/types";
import { errorsEn } from "@/shared/locale/en/errors";

type TransactionObj = PaymobProcessedCallbackBody["obj"];

const SPECIAL_REFERENCE = "claim-7f3a9b2c";

/** A fully-populated server-derived checkout input (real billing values). */
const BASE_INPUT: PaymentCheckoutInput = {
  studentId: 84,
  planId: 12,
  amount: "250.00",
  currency: "EGP",
  specialReference: SPECIAL_REFERENCE,
  billing: {
    firstName: "Ala",
    lastName: "Zain",
    email: "ala@example.com",
    phone: "+201000000000",
  },
};

function makeInput(overrides: Partial<PaymentCheckoutInput> = {}): PaymentCheckoutInput {
  return { ...BASE_INPUT, ...overrides };
}

/** A fail-closed resolved config (both integrations configured). */
const BASE_CONFIG: PaymobResolvedConfig = {
  secretKey: "sk_test_unit",
  publicKey: "pk_test_unit",
  hmacSecret: "hmac_test_unit",
  apiKey: "api_key_unit",
  integrationIdCard: 1256,
  integrationIdWallet: 4567,
  apiBaseUrl: "https://accept.paymob.com",
  checkoutBaseUrl: "https://eg.checkout.paymob.com",
  httpTimeoutMs: 10000,
};

function makeConfig(overrides: Partial<PaymobResolvedConfig> = {}): PaymobResolvedConfig {
  return { ...BASE_CONFIG, ...overrides };
}

/** A realistic intention response for the base input's amount. */
const BASE_RESPONSE: PaymobIntentionResponse = {
  id: "pi_test_bd49bb7fb4da48cfac4ec71ab4d8c433",
  intention_order_id: 265715202,
  client_secret: "egy_csk_test_bd49bb7f",
  special_reference: SPECIAL_REFERENCE,
  status: "intended",
  confirmed: false,
  intention_detail: { amount: 25000, currency: "EGP" },
  created: "2026-09-14T10:30:00.123456",
  object: "paymentintention",
};

function makeResponse(overrides: Partial<PaymobIntentionResponse> = {}): PaymobIntentionResponse {
  return { ...BASE_RESPONSE, ...overrides };
}

/**
 * Asserts a mapped callback event is non-null and returns it — every
 * non-pending fixture below settles, so a null would be a contract break
 * caught as a test failure instead of a type error.
 */
function eventOf(event: PaymentWebhookEvent | null): PaymentWebhookEvent {
  if (event === null) {
    throw new Error("expected a settled webhook event");
  }
  return event;
}

/** A realistic processed-callback transaction object (card, terminal success). */
const BASE_TRANSACTION_OBJ: TransactionObj = {
  id: 1920364654097558,
  pending: false,
  success: true,
  amount_cents: 150000,
  created_at: "2026-09-14T10:30:00.123456",
  currency: "EGP",
  error_occured: false,
  has_parent_transaction: false,
  integration_id: 3646540,
  is_3d_secure: true,
  is_auth: false,
  is_capture: false,
  is_refund: false,
  is_refunded: false,
  is_standalone_payment: false,
  is_void: false,
  is_voided: false,
  owner: 2466282640,
  refunded_amount_cents: 0,
  captured_amount: 0,
  order: { id: 217503754302852, merchant_order_id: SPECIAL_REFERENCE, amount_cents: 150000, currency: "EGP" },
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
};

function makeTransactionObj(overrides: Partial<TransactionObj> = {}): TransactionObj {
  return { ...BASE_TRANSACTION_OBJ, ...overrides };
}

/** Builds the intention request with the suite's standard surroundings. */
function buildRequest(overrides: {
  input?: Partial<PaymentCheckoutInput>;
  config?: Partial<PaymobResolvedConfig>;
  itemName?: string;
  notificationUrl?: string;
  redirectionUrl?: string;
}) {
  return buildIntentionRequest({
    input: makeInput(overrides.input ?? {}),
    itemName: overrides.itemName ?? "Math Annual Plan",
    config: makeConfig(overrides.config ?? {}),
    notificationUrl: overrides.notificationUrl ?? "https://tutor.example.com/api/payments/webhook",
    redirectionUrl: overrides.redirectionUrl ?? "https://tutor.example.com/student/checkout/result",
  });
}

describe("buildIntentionRequest", () => {
  test("builds the full intention body field by field", () => {
    const request = buildRequest({});
    expect(request).toEqual({
      amount: 25000,
      currency: "EGP",
      payment_methods: [1256, 4567],
      items: [{ name: "Math Annual Plan", amount: 25000, quantity: 1 }],
      billing_data: {
        first_name: "Ala",
        last_name: "Zain",
        email: "ala@example.com",
        phone_number: "+201000000000",
        apartment: "NA",
        street: "NA",
        building: "NA",
        city: "NA",
        country: "NA",
        floor: "NA",
        state: "NA",
      },
      special_reference: SPECIAL_REFERENCE,
      notification_url: "https://tutor.example.com/api/payments/webhook",
      redirection_url: "https://tutor.example.com/student/checkout/result",
    });
  });

  test("keeps the line item amount equal to the total amount", () => {
    const request = buildRequest({ input: { amount: "17.35" } });
    expect(request.amount).toBe(1735);
    expect(request.items).toHaveLength(1);
    expect(request.items[0].amount).toBe(request.amount);
  });

  test("offers only the card integration when the wallet is unconfigured", () => {
    const request = buildRequest({ config: { integrationIdWallet: null } });
    expect(request.payment_methods).toEqual([1256]);
  });

  test("sends integration IDs as integers and the correlation key verbatim", () => {
    const reference = "phe4sjw11q-1x-special_key.09";
    const request = buildRequest({
      input: { specialReference: reference },
      config: { integrationIdCard: 1256, integrationIdWallet: 0 },
    });
    expect(request.payment_methods).toEqual([1256, 0]);
    expect(Number.isInteger(request.payment_methods[0])).toBe(true);
    expect(request.special_reference).toBe(reference);
  });

  test("passes the currency and both callback URLs through verbatim", () => {
    const request = buildRequest({
      input: { currency: "EGP" },
      notificationUrl: "https://tunnel.example.org/api/payments/webhook?hmac=after",
      redirectionUrl: "https://app.example.org/student/checkout/result?src=paymob",
    });
    expect(request.currency).toBe("EGP");
    expect(request.notification_url).toBe("https://tunnel.example.org/api/payments/webhook?hmac=after");
    expect(request.redirection_url).toBe("https://app.example.org/student/checkout/result?src=paymob");
  });

  test("omits the callback URL members entirely when the caller resolved none", () => {
    // No fabricated URLs: without caller-resolved values the vendor falls
    // back to the callback URL configured on the merchant dashboard, so the
    // members must be ABSENT from the body — never empty strings.
    const request = buildIntentionRequest({
      input: makeInput({}),
      itemName: "Math Annual Plan",
      config: makeConfig({}),
    });
    expect("notification_url" in request).toBe(false);
    expect("redirection_url" in request).toBe(false);
  });

  test("fills a missing phone with the placeholder", () => {
    const request = buildRequest({ input: { billing: { ...BASE_INPUT.billing, phone: null } } });
    expect(request.billing_data.phone_number).toBe("NA");
  });

  test("fills empty and whitespace-only billing members with the placeholder", () => {
    const request = buildRequest({
      input: {
        billing: { firstName: "   ", lastName: "", email: "ala@example.com", phone: "   " },
      },
    });
    expect(request.billing_data.first_name).toBe("NA");
    expect(request.billing_data.last_name).toBe("NA");
    expect(request.billing_data.email).toBe("ala@example.com");
    expect(request.billing_data.phone_number).toBe("NA");
  });

  test("trims usable billing values and never fabricates address data", () => {
    const request = buildRequest({
      input: {
        billing: { firstName: " Ala ", lastName: "Zain ", email: " ala@example.com ", phone: " +201000000000 " },
      },
    });
    expect(request.billing_data.first_name).toBe("Ala");
    expect(request.billing_data.last_name).toBe("Zain");
    expect(request.billing_data.email).toBe("ala@example.com");
    expect(request.billing_data.phone_number).toBe("+201000000000");
    expect(request.billing_data.apartment).toBe("NA");
    expect(request.billing_data.street).toBe("NA");
    expect(request.billing_data.building).toBe("NA");
    expect(request.billing_data.city).toBe("NA");
    expect(request.billing_data.country).toBe("NA");
    expect(request.billing_data.floor).toBe("NA");
    expect(request.billing_data.state).toBe("NA");
  });
});

describe("buildIntentionRequest cents guard", () => {
  test("converts two-fraction-digit amounts", () => {
    expect(buildRequest({ input: { amount: "250.00" } }).amount).toBe(25000);
    expect(buildRequest({ input: { amount: "0.01" } }).amount).toBe(1);
  });

  test("converts one-fraction-digit amounts", () => {
    expect(buildRequest({ input: { amount: "0.1" } }).amount).toBe(10);
    expect(buildRequest({ input: { amount: "12.5" } }).amount).toBe(1250);
  });

  test("converts whole-number amounts without a fraction part", () => {
    expect(buildRequest({ input: { amount: "250" } }).amount).toBe(25000);
    expect(buildRequest({ input: { amount: "0" } }).amount).toBe(0);
  });

  test("rejects more than two fraction digits with the localized shape copy", () => {
    const rejection = () => buildRequest({ input: { amount: "1.234" } });
    expect(rejection).toThrow(ValidationError);
    expect(rejection).toThrow(errorsEn.subscriptionPurchase.planPriceShapeInvalid);
  });

  test("rejects non-numeric, empty, and dot-shaped text with the localized shape copy", () => {
    const rejection = () => buildRequest({ input: { amount: "abc" } });
    expect(rejection).toThrow(ValidationError);
    expect(rejection).toThrow(errorsEn.subscriptionPurchase.planPriceShapeInvalid);
    expect(() => buildRequest({ input: { amount: "" } })).toThrow(ValidationError);
    expect(() => buildRequest({ input: { amount: "12." } })).toThrow(ValidationError);
    expect(() => buildRequest({ input: { amount: ".5" } })).toThrow(ValidationError);
    expect(() => buildRequest({ input: { amount: "1e3" } })).toThrow(ValidationError);
  });

  test("rejects signed and negative amounts", () => {
    expect(() => buildRequest({ input: { amount: "-1.00" } })).toThrow(ValidationError);
    expect(() => buildRequest({ input: { amount: "+1.00" } })).toThrow(ValidationError);
  });

  test("rejects amounts whose cent value leaves the safe integer range with the localized range copy", () => {
    const rejection = () => buildRequest({ input: { amount: "99999999999999999.99" } });
    expect(rejection).toThrow(ValidationError);
    expect(rejection).toThrow(errorsEn.subscriptionPurchase.planPriceOutOfRange);
    expect(() => buildRequest({ input: { amount: "92233720368547.75" } })).toThrow(ValidationError);
  });

  test("accepts the largest safe cent value", () => {
    expect(buildRequest({ input: { amount: "90071992547409.91" } }).amount).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("toCheckoutDescriptor", () => {
  test("assembles the checkout URL from the configured prefix and exactly the two documented params", () => {
    const descriptor = toCheckoutDescriptor(
      makeResponse({ client_secret: "egy_csk_test_bd49bb7f" }),
      makeConfig({ publicKey: "pk_test_unit" }),
      makeInput()
    );
    expect(descriptor.checkoutUrl).toBe(
      "https://eg.checkout.paymob.com?publicKey=pk_test_unit&clientSecret=egy_csk_test_bd49bb7f"
    );
  });

  test("percent-encodes the URL params — an opaque secret cannot split or grow the URL", () => {
    const descriptor = toCheckoutDescriptor(
      makeResponse({ client_secret: "secret&injected=1" }),
      makeConfig({ publicKey: "pk&weird" }),
      makeInput()
    );
    expect(descriptor.checkoutUrl).toBe(
      "https://eg.checkout.paymob.com?publicKey=pk%26weird&clientSecret=secret%26injected%3D1"
    );
  });

  test("supports a checkout prefix that already carries the hosted path", () => {
    const descriptor = toCheckoutDescriptor(
      makeResponse(),
      makeConfig({ checkoutBaseUrl: "https://accept.paymob.com/unifiedcheckout/" }),
      makeInput()
    );
    expect(descriptor.checkoutUrl).toBe(
      "https://accept.paymob.com/unifiedcheckout/?publicKey=pk_test_unit&clientSecret=egy_csk_test_bd49bb7f"
    );
  });

  test("carries the paymob enum value as the provider", () => {
    const descriptor = toCheckoutDescriptor(makeResponse(), makeConfig(), makeInput());
    expect(descriptor.provider).toBe(PaymentGateway.Paymob);
  });

  test("rejects a response whose echoed special_reference diverges from the request", () => {
    // The response crosses the network boundary, so its echo members are
    // trusted only when they match the request verbatim — a divergent
    // `special_reference` would pair another intention's checkout secret
    // with this purchase's correlation key.
    const rejection = () =>
      toCheckoutDescriptor(makeResponse({ special_reference: "not-the-hands-value" }), makeConfig(), makeInput());
    expect(rejection).toThrow(DomainError);
  });

  test("rejects a response whose intention_detail amount diverges from the request", () => {
    const rejection = () =>
      toCheckoutDescriptor(
        makeResponse({ intention_detail: { amount: 999, currency: "EGP" } }),
        makeConfig(),
        makeInput()
      );
    expect(rejection).toThrow(DomainError);
  });

  test("rejects a response whose intention_detail currency diverges from the request", () => {
    const rejection = () =>
      toCheckoutDescriptor(
        makeResponse({ intention_detail: { amount: 25000, currency: "USD" } }),
        makeConfig(),
        makeInput()
      );
    expect(rejection).toThrow(DomainError);
  });

  test("rejects a response without an intention id", () => {
    expect(() => toCheckoutDescriptor(makeResponse({ id: "" }), makeConfig(), makeInput())).toThrow(DomainError);
  });

  test("rejects a response without a client secret", () => {
    expect(() => toCheckoutDescriptor(makeResponse({ client_secret: "" }), makeConfig(), makeInput())).toThrow(
      DomainError
    );
  });
});

describe("mapCallbackToEvent", () => {
  test("maps a terminal success to a confirmed event", () => {
    const event = eventOf(mapCallbackToEvent(makeTransactionObj({})));
    expect(event).toEqual({
      reference: SPECIAL_REFERENCE,
      outcome: "confirmed",
      amount: "1500.00",
      currency: "EGP",
      providerTransactionId: "1920364654097558",
    });
  });

  test("returns null for a success still flagged pending — the payment is not terminated", () => {
    // A pending transaction has not moved money: mapping it to an event
    // would make the local payment terminal and reject the later confirmed
    // callback, so the mapper yields `null` instead.
    const event = mapCallbackToEvent(makeTransactionObj({ pending: true }));
    expect(event).toBeNull();
  });

  test("maps a declined transaction to a failed event", () => {
    const event = eventOf(
      mapCallbackToEvent(makeTransactionObj({ success: false, pending: false, error_occured: true }))
    );
    expect(event.outcome).toBe("failed");
  });

  test("converts the cents amount to a two-fraction-digit decimal string", () => {
    expect(eventOf(mapCallbackToEvent(makeTransactionObj({ amount_cents: 1 }))).amount).toBe("0.01");
    expect(eventOf(mapCallbackToEvent(makeTransactionObj({ amount_cents: 5 }))).amount).toBe("0.05");
    expect(eventOf(mapCallbackToEvent(makeTransactionObj({ amount_cents: 999999 }))).amount).toBe("9999.99");
    expect(eventOf(mapCallbackToEvent(makeTransactionObj({ amount_cents: 0 }))).amount).toBe("0.00");
  });

  test("carries the currency verbatim and stringifies the transaction id", () => {
    const event = eventOf(mapCallbackToEvent(makeTransactionObj({ id: 42, currency: "USD" })));
    expect(event.currency).toBe("USD");
    expect(event.providerTransactionId).toBe("42");
    expect(typeof event.providerTransactionId).toBe("string");
  });

  test("maps a callback without the merchant echo to an unresolvable empty reference", () => {
    const event = eventOf(
      mapCallbackToEvent(makeTransactionObj({ order: { ...BASE_TRANSACTION_OBJ.order, merchant_order_id: null } }))
    );
    expect(event.reference).toBe("");
    expect(event.outcome).toBe("confirmed");
  });
});
