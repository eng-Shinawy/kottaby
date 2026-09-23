/**
 * `verifyWebhookSignature` exhaustive unit suite — pure function tier (NO
 * DB, NO env reads, NO server boot), run via the mandated runner:
 * `bun run test/scripts/run-test.ts backend/services/billing/payment-gateway/webhook-signature.helpers.test.ts`
 *
 * Covered contract (Tier 1 branches + Tier 2 boundaries + Tier 4 abuse):
 *  - Happy path: the lowercase hex HMAC-SHA256 of the exact raw body under
 *    the shared secret verifies.
 *  - Boundaries: empty body, the 64_000-byte webhook body cap, wrong-length
 *    signatures (63/65/128-but-wrong), whitespace-only header values, and a
 *    binary-safe body containing every byte value 0–255 as a latin1 string.
 *  - Fail-closed denial (never throws): missing header (`null`), empty
 *    signature, empty/missing secret, tampered bodies, case-flipped hex.
 *  - Fuzz: repeated wrong-secret probes across random bodies and random
 *    wrong secrets are ALL rejected while the correctly-signed twin of the
 *    same body verifies — proving the deny path is signature-driven, not a
 *    blanket `false`.
 *  - SECURITY (forged-signature probes): attacker-signed bodies, body
 *    extension after a legitimate signing (HMAC length-extension resistance
 *    pin), and one-bit/one-char signature forgeries are all rejected; the
 *    only accepting inputs are signatures the secret holder produced over
 *    the byte-exact body.
 */

import { describe, expect, test } from "bun:test";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { verifyWebhookSignature } from "@/backend/services/billing/payment-gateway/webhook-signature.helpers";

/** Independent signing oracle — the exact contract the helper verifies. */
function sign(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

const SECRET = "unit-test-webhook-secret";

// ─── Happy path ──────────────────────────────────────────────────────────────

describe("verifyWebhookSignature happy path", () => {
  test("a correctly signed body verifies", () => {
    const rawBody = JSON.stringify({ reference: "mock_abc", outcome: "confirmed", amount: "150.00", currency: "EGP" });
    expect(verifyWebhookSignature(rawBody, sign(rawBody, SECRET), SECRET)).toBe(true);
  });

  test("verification is deterministic — repeated calls agree", () => {
    const rawBody = "same-body";
    const signature = sign(rawBody, SECRET);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
  });

  test("every non-empty secret value works, including unicode secrets", () => {
    for (const secret of ["s", "a".repeat(200), "مفتاح-توقيع", randomBytes(32).toString("hex")]) {
      const rawBody = `body-for-${randomUUID()}`;
      expect(verifyWebhookSignature(rawBody, sign(rawBody, secret), secret)).toBe(true);
    }
  });
});

// ─── Boundary bodies ─────────────────────────────────────────────────────────

describe("verifyWebhookSignature body boundaries", () => {
  test("an empty body verifies with its (well-defined) HMAC", () => {
    const signature = sign("", SECRET);
    expect(verifyWebhookSignature("", signature, SECRET)).toBe(true);
    expect(verifyWebhookSignature("", sign("x", SECRET), SECRET)).toBe(false);
  });

  test("a 64_000-byte body (the webhook size cap) verifies byte-exactly", () => {
    const rawBody = "x".repeat(64_000);
    expect(verifyWebhookSignature(rawBody, sign(rawBody, SECRET), SECRET)).toBe(true);
    // One extra byte changes the signed material → deny.
    const oversized = `${rawBody}x`;
    expect(verifyWebhookSignature(oversized, sign(oversized, SECRET), SECRET)).toBe(true);
    expect(verifyWebhookSignature(oversized, sign(rawBody, SECRET), SECRET)).toBe(false);
  });

  test("a binary-safe body (all byte values 0–255 as latin1) verifies consistently", () => {
    const rawBody = Buffer.from(Array.from({ length: 256 }, (_, byte) => byte)).toString("latin1");
    expect(rawBody).toHaveLength(256);
    const signature = sign(rawBody, SECRET);
    expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(true);
    // Tampering the leading control byte inside the binary body invalidates it.
    const tampered = `A${rawBody.slice(1)}`;
    expect(tampered).not.toBe(rawBody);
    expect(verifyWebhookSignature(tampered, signature, SECRET)).toBe(false);
  });

  test("unicode content signs and verifies as-is (no ASCII-only shortcut)", () => {
    const rawBody = '{"reference":"مرجع-٣٤٥","outcome":"confirmed","amount":"١٥٠.٠٠","currency":"EGP"}';
    expect(verifyWebhookSignature(rawBody, sign(rawBody, SECRET), SECRET)).toBe(true);
  });
});

// ─── Fail-closed denial paths ────────────────────────────────────────────────

describe("verifyWebhookSignature fail-closed denial", () => {
  const rawBody = "denial-body";

  test("a missing header is denied", () => {
    expect(verifyWebhookSignature(rawBody, null, SECRET)).toBe(false);
  });

  test("an empty signature header is denied", () => {
    expect(verifyWebhookSignature(rawBody, "", SECRET)).toBe(false);
  });

  test("a whitespace-only signature header is denied (not trimmed, not accepted)", () => {
    expect(verifyWebhookSignature(rawBody, "   ", SECRET)).toBe(false);
    expect(verifyWebhookSignature(rawBody, `  ${sign(rawBody, SECRET)}  `, SECRET)).toBe(false);
  });

  test("an empty secret is denied even against a signature made with it", () => {
    const signature = sign(rawBody, "");
    expect(verifyWebhookSignature(rawBody, signature, "")).toBe(false);
  });

  test("wrong-length signatures are denied without throwing", () => {
    for (const signature of ["a".repeat(63), "a".repeat(65), "f".repeat(128), "ff", "zzzz"]) {
      expect(verifyWebhookSignature(rawBody, signature, SECRET)).toBe(false);
    }
  });

  test("case-flipped hex of an otherwise correct signature is denied", () => {
    // The wire contract is lowercase hex (digest("hex")); the compare is
    // exact — an uppercase re-encoding fails closed rather than loosening.
    const signature = sign(rawBody, SECRET);
    expect(verifyWebhookSignature(rawBody, signature.toUpperCase(), SECRET)).toBe(false);
  });

  test("a signature for a DIFFERENT body is denied (byte-exact body matching)", () => {
    expect(verifyWebhookSignature(rawBody, sign("other-body", SECRET), SECRET)).toBe(false);
    expect(verifyWebhookSignature(`${rawBody}\n`, sign(rawBody, SECRET), SECRET)).toBe(false);
    expect(verifyWebhookSignature(`${rawBody} `, sign(rawBody, SECRET), SECRET)).toBe(false);
  });
});

// ─── Wrong-secret fuzz (Tier 3) ──────────────────────────────────────────────

describe("verifyWebhookSignature wrong-secret fuzz", () => {
  test("random wrong secrets NEVER verify; the true secret twin does", () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const rawBody = `fuzz-${randomUUID()}-${randomBytes(8).toString("hex")}`;
      const wrongSecret = randomBytes(16).toString("hex");
      const forged = sign(rawBody, wrongSecret);
      expect(verifyWebhookSignature(rawBody, forged, SECRET)).toBe(false);
      expect(verifyWebhookSignature(rawBody, sign(rawBody, SECRET), SECRET)).toBe(true);
    }
  });

  test("a wrong secret denies across body shapes (empty, unicode, binary, huge)", () => {
    const bodies = [
      "",
      "عربي-body",
      Buffer.from([0x00, 0x01, 0xfe, 0xff]).toString("latin1"),
      "y".repeat(64_000),
      JSON.stringify({ reference: "mock_abc", outcome: "failed", amount: "0.01", currency: "USD" }),
    ];
    for (const rawBody of bodies) {
      const wrongSecret = randomBytes(16).toString("hex");
      expect(verifyWebhookSignature(rawBody, sign(rawBody, wrongSecret), SECRET)).toBe(false);
    }
  });
});

// ─── SECURITY: forged-signature probes (Tier 4) ─────────────────────────────

describe("verifyWebhookSignature forged-signature probes", () => {
  test("an attacker-signed evil body is denied", () => {
    const evilBody = JSON.stringify({
      reference: "mock_victim",
      outcome: "confirmed",
      amount: "0.00",
      currency: "EGP",
    });
    const attackerSecret = randomBytes(16).toString("hex");
    expect(verifyWebhookSignature(evilBody, sign(evilBody, attackerSecret), SECRET)).toBe(false);
  });

  test("appending to a legitimately signed body is denied (extension probe)", () => {
    const legitBody = JSON.stringify({ reference: "mock_abc", outcome: "failed", amount: "150.00", currency: "EGP" });
    const legitSignature = sign(legitBody, SECRET);
    const extended = `${legitBody}{"reference":"mock_abc","outcome":"confirmed"}`;
    expect(verifyWebhookSignature(extended, legitSignature, SECRET)).toBe(false);
  });

  test("single-character signature forgeries are denied", () => {
    const rawBody = "forgery-probe";
    const signature = sign(rawBody, SECRET);
    for (let index = 0; index < signature.length; index += 17) {
      const forgedChar = signature[index] === "0" ? "1" : "0";
      const forged = signature.slice(0, index) + forgedChar + signature.slice(index + 1);
      expect(verifyWebhookSignature(rawBody, forged, SECRET)).toBe(false);
    }
  });

  test("a stolen valid signature does not transfer to a different secret rotation", () => {
    // Signature captured under the OLD secret must fail once the secret
    // rotates — replaying captured callbacks across rotations is denied.
    const rawBody = "rotation-probe";
    const oldSignature = sign(rawBody, "old-secret");
    expect(verifyWebhookSignature(rawBody, oldSignature, "new-secret")).toBe(false);
  });
});
