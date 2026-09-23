/**
 * Paymob HMAC module suite — pure-function tier (NO DB, NO env reads, NO
 * I/O, NO server boot), run via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/paymob/__tests__/paymob.hmac.test.ts`
 *
 * Covered contract:
 *  - Constants: the POST/GET/token key lists match the provider's
 *    documented, lexicographically ordered member lists verbatim; the two
 *    transaction lists differ only in the flat/nested order-id slot.
 *  - Golden vectors: the HMAC message for realistic processed-callback
 *    payloads is the explicit slot-by-slot value concatenation (written out
 *    in the test, not re-derived from the implementation), and the
 *    HMAC-SHA512 of that message under the shared secret verifies — for the
 *    POST success shape, the POST declined/pending shape, the GET flat
 *    redirect (via `order` and via the `order_id` fallback), and the
 *    card-token callback.
 *  - Tamper vectors: a flipped `success`, an altered `amount_cents`, a
 *    documented key missing from the payload (which shifts the
 *    concatenation), a wrong secret, a missing/empty/whitespace-padded
 *    `hmac` value, and extra whitespace in the message are ALL denied while
 *    the honestly-signed twin of the same payload still verifies — proving
 *    denial is signature-driven, never a blanket `false`.
 *  - Unsigned members: values outside the documented key lists never
 *    influence the message.
 *  - Comparison shape: wrong-length and same-length-wrong-value presented
 *    HMACs are both denied through the fixed-length digest comparison
 *    without throwing (no length-dependent early exit observable at the
 *    call site).
 */

import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  PAYMOB_TOKEN_HMAC_KEYS,
  PAYMOB_TXN_HMAC_KEYS_GET,
  PAYMOB_TXN_HMAC_KEYS_POST,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.constants";
import {
  buildTokenHmacMessage,
  buildTransactionHmacMessage,
  buildTransactionHmacMessageFromQuery,
  verifyPaymobHmac,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.hmac";
import type { PaymobProcessedCallbackBody, PaymobTokenCallbackBody } from "@/backend/types";

type TransactionObj = PaymobProcessedCallbackBody["obj"];
type TokenObj = PaymobTokenCallbackBody["obj"];

const SECRET = "unit-test-paymob-hmac-secret";

/** Independent signing oracle — exactly what the verifier recomputes. */
function signMessage(message: string, secret: string): string {
  return createHmac("sha512", secret).update(message).digest("hex");
}

/** A realistic processed-callback transaction object (card, success). */
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
  order: { id: 217503754302852, merchant_order_id: "claim-7f3a9b2c", amount_cents: 150000, currency: "EGP" },
  source_data: { pan: "2346", sub_type: "MasterCard", type: "card" },
};

function makeTransactionObj(overrides: Partial<TransactionObj> = {}): TransactionObj {
  return { ...BASE_TRANSACTION_OBJ, ...overrides };
}

/**
 * The POST success HMAC message, written out slot by slot in the
 * documented key order — the golden vector itself, not an implementation
 * echo.
 */
const POST_SUCCESS_MESSAGE =
  "150000" + // amount_cents
  "2026-09-14T10:30:00.123456" + // created_at
  "EGP" + // currency
  "false" + // error_occured
  "false" + // has_parent_transaction
  "1920364654097558" + // id
  "3646540" + // integration_id
  "true" + // is_3d_secure
  "false" + // is_auth
  "false" + // is_capture
  "false" + // is_refunded
  "false" + // is_standalone_payment
  "false" + // is_voided
  "217503754302852" + // order.id
  "2466282640" + // owner
  "false" + // pending
  "2346" + // source_data.pan
  "MasterCard" + // source_data.sub_type
  "card" + // source_data.type
  "true"; // success

const POST_SUCCESS_HMAC = signMessage(POST_SUCCESS_MESSAGE, SECRET);

/** A declined, still-pending wallet transaction (every flag flipped). */
const DECLINED_OBJ: TransactionObj = makeTransactionObj({
  id: 1920364654097560,
  pending: true,
  success: false,
  amount_cents: 9900,
  created_at: "2026-09-14T10:31:12.654321",
  error_occured: true,
  integration_id: 3646541,
  is_3d_secure: false,
  is_standalone_payment: true,
  order: { id: 217503754302854, merchant_order_id: "claim-decl-0001", amount_cents: 9900, currency: "EGP" },
  source_data: { pan: "01010101010", sub_type: "Vodafone Cash", type: "wallet" },
});

const DECLINED_MESSAGE =
  "9900" + // amount_cents
  "2026-09-14T10:31:12.654321" + // created_at
  "EGP" + // currency
  "true" + // error_occured
  "false" + // has_parent_transaction
  "1920364654097560" + // id
  "3646541" + // integration_id
  "false" + // is_3d_secure
  "false" + // is_auth
  "false" + // is_capture
  "false" + // is_refunded
  "true" + // is_standalone_payment
  "false" + // is_voided
  "217503754302854" + // order.id
  "2466282640" + // owner
  "true" + // pending
  "01010101010" + // source_data.pan
  "Vodafone Cash" + // source_data.sub_type
  "wallet" + // source_data.type
  "false"; // success

/** The same success values as flat response-callback query parameters. */
const GET_QUERY_WITH_ORDER: Record<string, string | undefined> = {
  amount_cents: "150000",
  created_at: "2026-09-14T10:30:00.123456",
  currency: "EGP",
  error_occured: "false",
  has_parent_transaction: "false",
  id: "1920364654097558",
  integration_id: "3646540",
  is_3d_secure: "true",
  is_auth: "false",
  is_capture: "false",
  is_refunded: "false",
  is_standalone_payment: "false",
  is_voided: "false",
  order: "217503754302852",
  owner: "2466282640",
  pending: "false",
  "source_data.pan": "2346",
  "source_data.sub_type": "MasterCard",
  "source_data.type": "card",
  success: "true",
};

/** A realistic card-token callback object. */
const TOKEN_OBJ: TokenObj = {
  card_subtype: "MasterCard",
  created_at: "2026-11-13T12:32:23.859982",
  email: "student@example.com",
  id: 8555026,
  masked_pan: "xxxx-xxxx-xxxx-2346",
  merchant_id: 2466282640,
  order_id: "64419e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab",
  token: "e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab0c19dea1d55d",
};

const TOKEN_MESSAGE =
  "MasterCard" + // card_subtype
  "2026-11-13T12:32:23.859982" + // created_at
  "student@example.com" + // email
  "8555026" + // id
  "xxxx-xxxx-xxxx-2346" + // masked_pan
  "2466282640" + // merchant_id
  "64419e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab" + // order_id
  "e98aceb96f5a370ddf46460db9d555f88bf12448f80e1839b39f78ab0c19dea1d55d"; // token

// ─── Documented key lists ────────────────────────────────────────────────────

describe("documented HMAC key lists", () => {
  test("the POST transaction list matches the documented order verbatim", () => {
    expect(PAYMOB_TXN_HMAC_KEYS_POST).toEqual([
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
    ]);
  });

  test("the GET transaction list matches with flat parameter names", () => {
    expect(PAYMOB_TXN_HMAC_KEYS_GET).toEqual([
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
    ]);
  });

  test("the token list is the eight documented members in order", () => {
    expect(PAYMOB_TOKEN_HMAC_KEYS).toEqual([
      "card_subtype",
      "created_at",
      "email",
      "id",
      "masked_pan",
      "merchant_id",
      "order_id",
      "token",
    ]);
  });

  test("the two transaction lists differ only in the order-id slot", () => {
    expect(PAYMOB_TXN_HMAC_KEYS_POST).toHaveLength(20);
    expect(PAYMOB_TXN_HMAC_KEYS_GET).toHaveLength(20);
    const differingSlots = PAYMOB_TXN_HMAC_KEYS_POST.map((key, index) => ({
      index,
      post: key,
      get: PAYMOB_TXN_HMAC_KEYS_GET[index],
    }))
      .filter(slot => slot.post !== slot.get)
      .map(slot => slot.index);
    expect(differingSlots).toEqual([13]);
    expect(PAYMOB_TXN_HMAC_KEYS_POST[13]).toBe("order.id");
    expect(PAYMOB_TXN_HMAC_KEYS_GET[13]).toBe("order_id");
  });
});

// ─── Golden vectors ──────────────────────────────────────────────────────────

describe("golden HMAC message vectors", () => {
  test("POST success message is the explicit value concatenation and verifies", () => {
    expect(buildTransactionHmacMessage(BASE_TRANSACTION_OBJ)).toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, POST_SUCCESS_HMAC, SECRET)).toBe(true);
  });

  test("POST declined/pending message is its own concatenation and verifies", () => {
    expect(buildTransactionHmacMessage(DECLINED_OBJ)).toBe(DECLINED_MESSAGE);
    expect(verifyPaymobHmac(DECLINED_MESSAGE, signMessage(DECLINED_MESSAGE, SECRET), SECRET)).toBe(true);
  });

  test("GET flat parameters via `order` produce the same message as the POST shape", () => {
    const getMessage = buildTransactionHmacMessageFromQuery(GET_QUERY_WITH_ORDER);
    expect(getMessage).toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(getMessage, POST_SUCCESS_HMAC, SECRET)).toBe(true);
  });

  test("GET parameters carrying only `order_id` fall back to it and verify", () => {
    const queryWithOrderId: Record<string, string | undefined> = { ...GET_QUERY_WITH_ORDER };
    queryWithOrderId.order = undefined;
    queryWithOrderId.order_id = "217503754302852";
    const getMessage = buildTransactionHmacMessageFromQuery(queryWithOrderId);
    expect(getMessage).toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(getMessage, POST_SUCCESS_HMAC, SECRET)).toBe(true);
  });

  test("when both flat names are present, `order` wins (documented precedence)", () => {
    const ambiguousQuery: Record<string, string | undefined> = { ...GET_QUERY_WITH_ORDER, order_id: "999" };
    const getMessage = buildTransactionHmacMessageFromQuery(ambiguousQuery);
    expect(getMessage).toBe(POST_SUCCESS_MESSAGE);
  });

  test("token callback message is its explicit concatenation and verifies", () => {
    expect(buildTokenHmacMessage(TOKEN_OBJ)).toBe(TOKEN_MESSAGE);
    expect(verifyPaymobHmac(TOKEN_MESSAGE, signMessage(TOKEN_MESSAGE, SECRET), SECRET)).toBe(true);
  });
});

// ─── Unsigned members ────────────────────────────────────────────────────────

describe("members outside the documented key lists", () => {
  test("action flags and totals never influence the transaction message", () => {
    const message = buildTransactionHmacMessage(
      makeTransactionObj({
        is_refund: true,
        is_void: true,
        refunded_amount_cents: 5000,
        captured_amount: 1,
        order: { ...BASE_TRANSACTION_OBJ.order, merchant_order_id: "other-reference" },
      })
    );
    expect(message).toBe(POST_SUCCESS_MESSAGE);
  });

  test("token-object extras never influence the token message", () => {
    const message = buildTokenHmacMessage({ ...TOKEN_OBJ, user_added: true, next_payment_intention: null });
    expect(message).toBe(TOKEN_MESSAGE);
  });
});

// ─── Tamper vectors (all denied) ─────────────────────────────────────────────

describe("tamper vectors", () => {
  test("a flipped `success` is denied under the original signature; re-signed it verifies", () => {
    const flipped = makeTransactionObj({ success: false });
    const tamperedMessage = buildTransactionHmacMessage(flipped);
    expect(tamperedMessage).not.toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(tamperedMessage, POST_SUCCESS_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(tamperedMessage, signMessage(tamperedMessage, SECRET), SECRET)).toBe(true);
  });

  test("an altered `amount_cents` is denied under the original signature; re-signed it verifies", () => {
    const inflated = makeTransactionObj({ amount_cents: 990000 });
    const tamperedMessage = buildTransactionHmacMessage(inflated);
    expect(tamperedMessage).not.toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(tamperedMessage, POST_SUCCESS_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(tamperedMessage, signMessage(tamperedMessage, SECRET), SECRET)).toBe(true);
  });

  test("a documented key missing from the payload shifts the concatenation and is denied", () => {
    const absentValue = makeTransactionObj({ is_standalone_payment: undefined });
    // The member contributes nothing (the empty-string slot), so every later
    // value shifts leftward and the original signature can never match.
    const shiftedMessage = buildTransactionHmacMessage(absentValue);
    expect(shiftedMessage).not.toBe(POST_SUCCESS_MESSAGE);
    expect(verifyPaymobHmac(shiftedMessage, POST_SUCCESS_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(shiftedMessage, signMessage(shiftedMessage, SECRET), SECRET)).toBe(true);
  });

  test("a wrong secret is denied in both directions", () => {
    const attackerHmac = signMessage(POST_SUCCESS_MESSAGE, "attacker-known-secret");
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, attackerHmac, SECRET)).toBe(false);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, POST_SUCCESS_HMAC, "attacker-known-secret")).toBe(false);
  });

  test("a missing or empty `hmac` value is denied", () => {
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, undefined, SECRET)).toBe(false);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, "", SECRET)).toBe(false);
  });

  test("an empty secret is denied even against a signature made with it", () => {
    const emptySecretHmac = signMessage(POST_SUCCESS_MESSAGE, "");
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, emptySecretHmac, "")).toBe(false);
  });

  test("extra whitespace anywhere is denied", () => {
    expect(verifyPaymobHmac(`${POST_SUCCESS_MESSAGE} `, POST_SUCCESS_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(` ${POST_SUCCESS_MESSAGE}`, POST_SUCCESS_HMAC, SECRET)).toBe(false);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, `  ${POST_SUCCESS_HMAC}  `, SECRET)).toBe(false);
  });

  test("an uppercase re-encoding of a correct digest is denied (exact hex compare)", () => {
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, POST_SUCCESS_HMAC.toUpperCase(), SECRET)).toBe(false);
  });
});

// ─── Comparison shape (fixed-length digest path) ────────────────────────────

describe("digest comparison shape", () => {
  test("wrong-length presented HMACs are denied without throwing", () => {
    for (const presented of ["a".repeat(63), "a".repeat(65), "f".repeat(128), "ff"]) {
      expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, presented, SECRET)).toBe(false);
    }
  });

  test("same-length wrong-value HMACs are denied without throwing", () => {
    const sameLengthForgery = `${POST_SUCCESS_HMAC.slice(0, -1)}${POST_SUCCESS_HMAC.endsWith("0") ? "1" : "0"}`;
    expect(sameLengthForgery).toHaveLength(POST_SUCCESS_HMAC.length);
    expect(sameLengthForgery).not.toBe(POST_SUCCESS_HMAC);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, sameLengthForgery, SECRET)).toBe(false);
  });

  test("verification is deterministic — repeated calls agree", () => {
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, POST_SUCCESS_HMAC, SECRET)).toBe(true);
    expect(verifyPaymobHmac(POST_SUCCESS_MESSAGE, POST_SUCCESS_HMAC, SECRET)).toBe(true);
    expect(verifyPaymobHmac(DECLINED_MESSAGE, signMessage(DECLINED_MESSAGE, SECRET), SECRET)).toBe(true);
    expect(verifyPaymobHmac(TOKEN_MESSAGE, signMessage(TOKEN_MESSAGE, SECRET), SECRET)).toBe(true);
  });
});
