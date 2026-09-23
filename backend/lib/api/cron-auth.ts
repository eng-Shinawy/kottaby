/**
 * Externally-triggered cron-route auth helpers — the shared `app/api/cron/**`
 * bearer gate.
 *
 *  - {@link cronUnauthorizedError} — the failed-auth denial classified to the
 *    401 (UNAUTHORIZED) family.
 *  - {@link bearerSecretMatches} — the timing-safe bearer comparison: both
 *    sides are hashed to fixed-length SHA-256 digests first, so
 *    `timingSafeEqual` never sees (or leaks via early exit) length
 *    differences between the presented and expected secrets.
 *  - {@link cronBearerFromRequest} — the presented credential carved out of
 *    the `Authorization: Bearer <secret>` header (case-insensitive scheme,
 *    no query-string acceptance).
 *
 * Layer rules: pure & deterministic given their inputs — no env reads, no
 * logging; the caller owns the secret resolution and the response envelope.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { DomainError } from "@/backend/lib/errors";

/** The failed-auth denial — classified to 401 (UNAUTHORIZED family). */
export function cronUnauthorizedError(): DomainError {
  return new DomainError("UNAUTHORIZED", "Invalid cron credentials.");
}

/**
 * Timing-safe bearer comparison: both sides are hashed to fixed-length
 * SHA-256 digests first, so `timingSafeEqual` never sees (or leaks via
 * early exit) length differences between the presented and expected
 * secrets. Shared by the reconcile route and the sweep-endpoint factory
 * (the ONE comparison — the envelopes cannot drift apart).
 */
export function bearerSecretMatches(presented: string | null, expected: string): boolean {
  if (presented === null || presented.length === 0) {
    return false;
  }
  const presentedDigest = createHash("sha256").update(presented).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(presentedDigest, expectedDigest);
}

/** The presented bearer credential, carved from the Authorization header. */
export function cronBearerFromRequest(
  headerGet: (name: string) => string | null,
  expected: string | undefined
): { readonly ok: boolean; readonly presented: string | null } {
  const presented = headerGet("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
  const ok = expected !== undefined && expected.length > 0 && bearerSecretMatches(presented, expected);
  return { ok, presented };
}
