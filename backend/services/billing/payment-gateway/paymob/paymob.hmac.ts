/**
 * Paymob callback HMAC verification — pure string and hashing functions
 * over explicitly passed inputs: no environment reads, no I/O, no logging,
 * no module state. The same builders therefore serve the production webhook
 * verifier and any server-side signer (dev callback simulation, tests)
 * without a parallel signing implementation.
 *
 * The provider signs a callback by concatenating the VALUES of a
 * documented, fixed-order key list and computing HMAC-SHA512 over the
 * result. The builders reproduce that message exactly: booleans serialize
 * as lowercase `true`/`false`, numbers as their plain decimal form, and a
 * missing value contributes the empty string — the message is
 * position-sensitive, so an absent member still consumes its slot.
 *
 * Verification computes the lowercase hex SHA-512 HMAC over the message and
 * compares it to the presented `hmac` parameter through the fixed-length
 * digest idiom: both sides are first hashed to SHA-256 digests, so
 * `timingSafeEqual` never sees (or leaks via early exit) length differences
 * between the presented and expected hex strings. Every failure mode
 * (missing or empty presented value, empty secret, mismatch) returns
 * `false`; nothing on an attacker-controlled input path can throw.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import {
  PAYMOB_TOKEN_HMAC_KEYS,
  PAYMOB_TXN_HMAC_KEYS_GET,
  PAYMOB_TXN_HMAC_KEYS_POST,
} from "@/backend/services/billing/payment-gateway/paymob/paymob.constants";
import type { PaymobProcessedCallbackBody, PaymobTokenCallbackBody } from "@/backend/types";

/** Narrows to a plain object so documented paths can walk into it. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Reads a (possibly dotted) getter path off a plain object. */
function readPath(source: unknown, path: string): unknown {
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

/**
 * Serializes one signed value into its message contribution: booleans as
 * lowercase words, absent values as the empty string, everything else in
 * its plain string form.
 */
function stringifyHmacValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number" || typeof value === "string") {
    return String(value);
  }
  return "";
}

/**
 * Resolves one flat response-callback parameter. The order id arrives under
 * two names in the wild — `order` and `order_id` (the vendor's own pages
 * use both) — so the `order_id` slot prefers `order` and falls back to
 * `order_id` when `order` is absent.
 */
function readQueryParam(query: Record<string, string | undefined>, key: string): string | undefined {
  if (key === "order_id") {
    return query.order ?? query.order_id;
  }
  return query[key];
}

/**
 * Builds the HMAC message of a processed (POST) transaction callback from
 * its nested transaction object, walking the documented POST key order.
 */
export function buildTransactionHmacMessage(source: PaymobProcessedCallbackBody["obj"]): string {
  return PAYMOB_TXN_HMAC_KEYS_POST.map(key => stringifyHmacValue(readPath(source, key))).join("");
}

/**
 * Builds the HMAC message of a response (GET) transaction redirect from its
 * flat query parameters, walking the documented GET key order.
 */
export function buildTransactionHmacMessageFromQuery(query: Record<string, string | undefined>): string {
  return PAYMOB_TXN_HMAC_KEYS_GET.map(key => stringifyHmacValue(readQueryParam(query, key))).join("");
}

/**
 * Builds the HMAC message of a card-token (TOKEN) callback from its token
 * object, walking the documented eight-key token order.
 */
export function buildTokenHmacMessage(obj: PaymobTokenCallbackBody["obj"]): string {
  return PAYMOB_TOKEN_HMAC_KEYS.map(key => stringifyHmacValue(readPath(obj, key))).join("");
}

/**
 * Verifies a callback's presented `hmac` parameter against the HMAC-SHA512
 * of the message produced by one of the builders above, under the
 * merchant's HMAC secret. Returns `true` only on an exact lowercase-hex
 * match; a missing or empty presented value is denied outright.
 */
export function verifyPaymobHmac(message: string, providedHmac: string | undefined, hmacSecret: string): boolean {
  if (providedHmac === undefined || providedHmac.length === 0 || hmacSecret.length === 0) {
    return false;
  }
  const expectedHmac = createHmac("sha512", hmacSecret).update(message).digest("hex");
  const providedDigest = createHash("sha256").update(providedHmac).digest();
  const expectedDigest = createHash("sha256").update(expectedHmac).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
