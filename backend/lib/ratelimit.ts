/**
 * Rate-limit helper — in-memory sliding-window implementation.
 *
 * Provides per-identifier rate limiting using an in-memory Map of request
 * timestamps. Designed for the portal read-query hardening (prevents
 * brute-force child-id enumeration) and the public GraphQL endpoint.
 *
 * Contract:
 *  - `checkRateLimit(identifier, limiter)` — returns `{ success, … }`
 *    based on a sliding window of request timestamps. Fail-open on
 *    transient errors (mirrors the login cold-start resilience pattern).
 *  - `resolveClientIp(request)` — spoof-resistant client-IP resolution:
 *    `x-real-ip`, else the RIGHTMOST `x-forwarded-for` entry, else "local".
 *  - `getClientIdentifier(request)` — delegates to `resolveClientIp`; the
 *    shared keying entry point every limiter consumer calls.
 *  - `graphqlRateLimiter` — config for the public GraphQL endpoint.
 *  - `portalReadLimiter` — config for parent portal read queries.
 *  - `authIpLimiter` — config for the public auth mutations' brute-force cap
 *    per client IP. The credential-stuffing cap per hashed identity
 *    (`authIdentityLimiter`) is module-internal — consumed only by
 *    `enforceAuthMutationRateLimit`.
 *  - `hashAuthIdentity(email)` — sha256 hex of the trimmed+lowercased email;
 *    `""` when the identity is absent (no identity bucket).
 *  - `enforceAuthMutationRateLimit(...)` — resolver-level enforcement: IP
 *    bucket first, then the identity bucket; throws the localized
 *    `RateLimitExceededError` on exhaustion.
 *  - `isRateLimitTestBypass()` — the single-sourced TEST_CI/TEST_SERVER
 *    harness-bypass predicate with the production fail-fast guard.
 *  - `loginAccountLimiter()` — FACTORY for the account-keyed login lockout
 *    tier (default 5 attempts / 15 min); the limit/window resolve lazily
 *    from the env-cached config on every check.
 *  - `enforceLoginAccountRateLimit(email, locale)` — login-resolver
 *    enforcement for the account tier (absent identities skip: the `""`
 *    sentinel never mints an account bucket).
 *
 * Memory model: a Map<string, number[]> where the array holds request
 * timestamps within the current window. Entries are pruned on each check
 * and on periodic cleanup. The Map is bounded to `MAX_TRACKED_IDENTIFIERS`
 * entries (LRU eviction when exceeded) to prevent unbounded growth.
 */
import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { getEnvironmentConfig } from "@/backend/lib/env";
import { RateLimitExceededError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";

export interface RateLimiterConfig {
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

export interface RateLimitResult {
  readonly success: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly reset: number;
}

export const graphqlRateLimiter: RateLimiterConfig = {
  name: "graphql-public",
  limit: 100,
  windowMs: 60_000,
};

/** Limiter for parent portal read queries — tighter window to cap probing. */
export const portalReadLimiter: RateLimiterConfig = {
  name: "portal-read",
  limit: 30,
  windowMs: 60_000,
};

/** Limiter for the public auth mutations — brute-force cap per client IP. */
export const authIpLimiter: RateLimiterConfig = {
  name: "auth-ip",
  limit: 10,
  windowMs: 60_000,
};

/** Limiter for the public auth mutations — credential-stuffing cap per hashed identity. */
const authIdentityLimiter: RateLimiterConfig = {
  name: "auth-identity",
  limit: 20,
  windowMs: 60_000,
};

/** Maximum number of tracked identifiers to prevent unbounded Map growth. */
const MAX_TRACKED_IDENTIFIERS = 10_000;

interface WindowEntry {
  readonly timestamps: number[];
  lastAccessed: number;
}

const windows = new Map<string, WindowEntry>();

function pruneWindow(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter(ts => ts > cutoff);
}

function evictStaleEntries(): void {
  if (windows.size <= MAX_TRACKED_IDENTIFIERS) {
    return;
  }
  const entries = [...windows.entries()].toSorted((a, b) => a[1].lastAccessed - b[1].lastAccessed);
  const toEvict = Math.min(windows.size - Math.floor(MAX_TRACKED_IDENTIFIERS * 0.8), entries.length);
  for (let i = 0; i < toEvict; i++) {
    windows.delete(entries[i][0]);
  }
}

/**
 * Spoof-resistant client-IP resolution.
 *
 * Deployment assumption: exactly ONE trusted reverse proxy sits in front of
 * the app. Under that assumption the proxy is the only party in a position
 * to set `x-real-ip`, and the RIGHTMOST comma-separated `x-forwarded-for`
 * entry is the client address that trusted proxy observed — every preceding
 * entry was appended by less-trusted hops and is client-forgeable (in
 * particular the LEFTMOST entry is fully attacker-controlled and is never
 * used as a limiter key). That proxy must OVERWRITE any client-supplied
 * `x-real-ip` (never forward it) and APPEND the address it observed to
 * `x-forwarded-for` (never let a client-supplied entry stay rightmost) —
 * a proxy that passes client-chosen IP headers through verbatim hands an
 * attacker a fresh limiter bucket on every request. If a second proxy hop
 * is ever introduced, this resolution order must be revisited.
 *
 * Resolution order:
 *  1. `x-real-ip` header (trimmed, non-empty) — the proxy's direct statement.
 *  2. Rightmost comma-separated `x-forwarded-for` entry (trimmed, non-empty).
 *  3. `"local"` — headerless/unproxied callers (e.g. direct dev access).
 *
 * Empty or whitespace-only values never win: the chain keeps descending so
 * distinct requests cannot collapse onto an empty-string limiter key.
 */
export function resolveClientIp(request: NextRequest | Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) {
    const candidate = realIp.trim();
    if (candidate) {
      return candidate;
    }
  }
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    // Comma-split only — colons are legal inside IPv6 entries and must
    // never be treated as separators.
    const entries = xff.split(",");
    const rightmost = entries[entries.length - 1]?.trim();
    if (rightmost) {
      return rightmost;
    }
  }
  return "local";
}

/** Client identifier for limiter keying — delegates to `resolveClientIp`. */
export function getClientIdentifier(request: NextRequest | Request): string {
  return resolveClientIp(request);
}

/**
 * Rate limiter identity for the public auth mutations.
 *
 * SHA-256 hex digest of the trimmed + lowercased email. An empty (or
 * whitespace-only) identity digests to `""` — the sentinel for "no identity
 * bucket", so an absent identity never mints a fresh limiter key.
 *
 * The plaintext email must never reach limiter keys or logs: the digest is
 * the only identity form stored (key format `auth-identity:<64-hex>`), and
 * enforcement logs carry the limiter name and client IP only.
 */
export function hashAuthIdentity(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (normalized === "") {
    return "";
  }
  return createHash("sha256").update(normalized).digest("hex");
}

/**
 * Checks the rate limit for the given identifier + limiter config.
 *
 * Uses an in-memory sliding window: keeps timestamps of requests within
 * the window, rejects when count exceeds `limit`. Fail-open on errors
 * (a transient Map/alloc failure must NOT block a legitimate request) —
 * each fail-open emits a `logger.warn` carrying the limiter name and the
 * error name (never message content or stack) so the bypass stays
 * observable.
 */
export async function checkRateLimit(identifier: string, limiter: RateLimiterConfig): Promise<RateLimitResult> {
  const now = Date.now();
  try {
    const key = `${limiter.name}:${identifier}`;
    const entry = windows.get(key);
    if (entry === undefined) {
      const timestamps = [now];
      windows.set(key, { timestamps, lastAccessed: now });
      evictStaleEntries();
      return { success: true, limit: limiter.limit, remaining: limiter.limit - 1, reset: now + limiter.windowMs };
    }
    const pruned = pruneWindow(entry.timestamps, now, limiter.windowMs);
    if (pruned.length >= limiter.limit) {
      entry.lastAccessed = now;
      return {
        success: false,
        limit: limiter.limit,
        remaining: 0,
        reset: pruned[0] !== undefined ? pruned[0] + limiter.windowMs : now + limiter.windowMs,
      };
    }
    pruned.push(now);
    entry.lastAccessed = now;
    windows.set(key, { timestamps: pruned, lastAccessed: now });
    return {
      success: true,
      limit: limiter.limit,
      remaining: limiter.limit - pruned.length,
      reset: now + limiter.windowMs,
    };
  } catch (error) {
    // Fail-open, never fail-silent: the warn carries the limiter name and
    // the error NAME only — message content and stack traces could leak
    // internal state into logs.
    const errorName = error instanceof Error ? error.name : "non-Error";
    logger.warn(`Rate limiter fail-open (limiter: ${limiter.name}, error: ${errorName})`);
    return { success: true, limit: limiter.limit, remaining: limiter.limit, reset: now + limiter.windowMs };
  }
}

/**
 * Resolver-level rate-limit enforcement for the public auth mutations.
 *
 * Bucket order: the client-IP bucket FIRST (`authIpLimiter`), then the
 * identity bucket SECOND (`authIdentityLimiter`) — and only when
 * `identity !== ""` (absent identities are IP-only). A rejection in the
 * IP bucket never consumes the identity bucket.
 *
 * On exhaustion, throws the localized `RateLimitExceededError`; returns
 * `void` on pass. Logging carries the limiter name and the client IP ONLY —
 * never the identity (neither plaintext nor digest).
 *
 * Fail-open posture is inherited from `checkRateLimit`'s internal catch: a
 * transient limiter failure must not block a legitimate auth attempt.
 */
export async function enforceAuthMutationRateLimit(
  input: { readonly clientIp: string; readonly identity: string },
  locale: string
): Promise<void> {
  // Test-flag isolation: the bypass is a TEST-HARNESS affordance, single-
  // sourced in `isRateLimitTestBypass` (the same predicate the transport
  // tier's block encodes, `app/api/graphql/rate-limit.ts`) so live-server
  // suites sharing this process's limiter state cannot flake. A real
  // production deployment must never run with these flags set — they would
  // silently disable auth rate limiting. Anything else fails fast with a
  // named error.
  if (isRateLimitTestBypass()) {
    return;
  }

  const ipResult = await checkRateLimit(input.clientIp, authIpLimiter);
  if (!ipResult.success) {
    logger.logDomainError(`Auth mutation rate limit exceeded for ${input.clientIp} (limiter: ${authIpLimiter.name})`, {
      code: "RATE_LIMIT_EXCEEDED",
    });
    throw new RateLimitExceededError(getServerTranslations(locale).errorsTranslations.rateLimitExceeded);
  }

  if (input.identity === "") {
    return;
  }

  const identityResult = await checkRateLimit(input.identity, authIdentityLimiter);
  if (!identityResult.success) {
    logger.logDomainError(
      `Auth mutation rate limit exceeded for ${input.clientIp} (limiter: ${authIdentityLimiter.name})`,
      {
        code: "RATE_LIMIT_EXCEEDED",
      }
    );
    throw new RateLimitExceededError(getServerTranslations(locale).errorsTranslations.rateLimitExceeded);
  }
}

/** Test helper — clears the in-memory windows (for isolated test runs). */
export function clearRateLimitStore(): void {
  windows.clear();
}

/**
 * Single-sourced TEST_CI/TEST_SERVER harness-bypass predicate for every
 * rate-limit tier (transport, auth-mutation, login-account).
 *
 * The bypass is a TEST-HARNESS affordance: `.env.test` sets both flags for
 * the shared harness, and suites that need to observe a limiter delete them
 * per-probe (stash in `beforeEach`, restore in `afterEach`). A real
 * production deployment must never run with these flags set — they would
 * silently disable rate limiting. The one sanctioned production-NODE_ENV
 * consumer is the demo server (`IS_DEMO=1`); anything else fails fast with
 * a named error.
 */
export function isRateLimitTestBypass(): boolean {
  const harnessFlagSet = process.env.TEST_CI === "1" || process.env.TEST_SERVER === "1";
  if (!harnessFlagSet) {
    return false;
  }
  if (process.env.NODE_ENV === "production" && process.env.IS_DEMO !== "1" && process.env.IS_DEMO !== "true") {
    throw new Error(
      "isRateLimitTestBypass: TEST_CI/TEST_SERVER rate-limit bypass is forbidden outside the test harness (set IS_DEMO=1 for the sanctioned test server)"
    );
  }
  return true;
}

/**
 * FACTORY for the account-keyed login lockout tier.
 *
 * Returns a fresh `RateLimiterConfig` on every call so the limit and window
 * resolve LAZILY from the env-cached config (`LOGIN_RATE_LIMIT_MAX` /
 * `LOGIN_RATE_LIMIT_WINDOW_MS`, default 5 attempts / 15 min) INSIDE each
 * check — `resetEnvironmentCache()` is therefore observable in override
 * tests (no module-scope const captures a stale value).
 *
 * ACCOUNT-keyed only: the bucket identifier is the normalized login email
 * (trim + lowercase via `hashAuthIdentity` — the digest is the only
 * identity form stored, honoring this module's plaintext-never-in-keys
 * contract), so the lockout follows the ACCOUNT across any number of
 * client IPs and survives IP rotation. NO IP-keyed tier exists here: the
 * GraphQL context is the only IP source and this limiter never consults
 * it; transport-level IP throttling remains the gateway-wide limiter
 * (`app/api/graphql/rate-limit.ts`). Distribution (Redis) and per-account
 * lockout persistence stay deferred.
 */
export function loginAccountLimiter(): RateLimiterConfig {
  const { loginRateLimitMax, loginRateLimitWindowMs } = getEnvironmentConfig();
  return {
    name: "login",
    limit: loginRateLimitMax,
    windowMs: loginRateLimitWindowMs,
  };
}

/**
 * Login-resolver enforcement for the account-keyed lockout tier.
 *
 * Layers ON TOP of `enforceAuthMutationRateLimit` (the per-IP brute-force
 * and per-identity credential-stuffing tiers): the same account is capped
 * regardless of how many IPs or identity buckets an attacker rotates
 * through. An absent identity (empty/whitespace-only email — the `""`
 * sentinel) never mints an account bucket.
 *
 * On exhaustion, throws the localized `RateLimitExceededError`; returns
 * `void` on pass. Logging carries the limiter name ONLY — never the
 * identity (neither plaintext nor digest). Fail-open posture is inherited
 * from `checkRateLimit`'s internal catch: a transient limiter failure must
 * not block a legitimate login.
 */
export async function enforceLoginAccountRateLimit(email: string, locale: string): Promise<void> {
  if (isRateLimitTestBypass()) {
    return;
  }
  const identity = hashAuthIdentity(email);
  if (identity === "") {
    return;
  }
  const result = await checkRateLimit(identity, loginAccountLimiter());
  if (!result.success) {
    logger.logDomainError("Account-keyed login rate limit exceeded (limiter: login)", {
      code: "RATE_LIMIT_EXCEEDED",
    });
    throw new RateLimitExceededError(getServerTranslations(locale).errorsTranslations.rateLimitExceeded);
  }
}
