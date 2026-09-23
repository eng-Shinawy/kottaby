/**
 * Payment webhook signature verification — the transport-level trust
 * boundary for gateway callbacks.
 *
 * The webhook route authenticates a callback by comparing the presented
 * `x-payment-signature` header against the lowercase hex HMAC-SHA256 of the
 * EXACT raw request body keyed with the configured webhook secret. The
 * comparison runs through the fixed-length digest idiom: both sides are
 * hashed to SHA-256 digests first, so `timingSafeEqual` never sees (or
 * leaks via early exit) length differences between the presented and
 * expected signatures.
 *
 * Purity contract: pure function over its three arguments — no env reads,
 * no database, no logging. Every failure mode (missing header, empty
 * signature, missing/empty secret, mismatch) returns `false`; the helper
 * NEVER throws, so a malformed attacker-controlled header can only deny
 * the callback, never crash the route.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a gateway callback signature against the raw request body.
 *
 * @param rawBody The request body exactly as read from the wire (the same
 *   bytes the sender signed — re-serialization invalidates signatures).
 * @param signatureHeader The presented signature header value, or `null`
 *   when the header is absent.
 * @param secret The shared webhook secret; an empty or missing secret
 *   fails closed.
 * @returns `true` only when the presented hex signature matches the
 *   HMAC-SHA256 of the raw body under the secret.
 */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string): boolean {
  if (signatureHeader === null || signatureHeader.length === 0) {
    return false;
  }
  if (secret.length === 0) {
    return false;
  }
  const expectedSignature = createHmac("sha256", secret).update(rawBody).digest("hex");
  const presentedDigest = createHash("sha256").update(signatureHeader).digest();
  const expectedDigest = createHash("sha256").update(expectedSignature).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}
