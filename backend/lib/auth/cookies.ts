/**
 * Auth cookie helpers — httpOnly `access_token` + `refresh_token` +
 * `session_id` cookie management for the GraphQL route handler.
 *
 * Architecture (per `docs/auth/REDIRECT_LOOP_FIX.md`):
 *  - `access_token`  — short-lived (15 min). Held in React memory by the
 *    AuthProvider (the Apollo `Authorization: Bearer` path) AND set as an
 *    httpOnly cookie so Server Components / `getServerUserContext()` can
 *    verify it during SSR without any client-supplied identity. This dual
 *    storage is the redirect-loop fix: previously the access_token was NEVER
 *    set as a cookie, so SSR could not authenticate, and the dashboard
 *    layout kept bouncing the user back to `/login` even though the client
 *    had a valid token in memory.
 *  - `refresh_token` — long-lived (7 days). Set as an httpOnly cookie. Used
 *    by the AuthProvider to silently rotate tokens via `refreshToken`.
 *  - `session_id`   — opaque correlation handle (7 days). Set as an
 *    httpOnly cookie alongside `refresh_token`.
 *
 * Wire-up:
 *  - `createGraphQLContext` accepts a per-request `Set-Cookie` accumulator
 *    (the `authCookieOut` field on `Context`). Mutations (`login`,
 *    `refreshToken`, `logout`) write serialized cookie strings into it.
 *  - `app/api/graphql/route.ts` reads `authCookieOut` after Apollo processes
 *    the request and merges the values onto the outgoing `Response` via
 *    `headers.append("Set-Cookie", ...)`.
 *
 * Parsing helpers (no `cookie` package dependency — kept inline to avoid
 * adding a runtime dep for ~20 lines of cookie-header parsing).
 */

import { getAccessTokenTtlSeconds, getRefreshTokenTtlSeconds } from "@/backend/lib/auth/jwt";
import { getEnvironmentConfig } from "@/backend/lib/env";

/** Cookie names used by the auth flow. */
export const AUTH_COOKIE_NAMES = {
  /** HttpOnly short-lived access-token cookie (JWT, 15-min TTL) — SSR auth path. */
  accessToken: "access_token",
  /** HttpOnly refresh-token cookie (JWT, 7-day TTL). */
  refreshToken: "refresh_token",
  /** HttpOnly opaque session-id cookie (correlation handle, 7-day TTL). */
  sessionId: "session_id",
} as const;

/** Per-request accumulator: list of `Set-Cookie` header values to merge onto the response. */
export type AuthCookieOut = string[];

/** Creates a fresh per-request accumulator. Mutations push cookie strings into it. */
export function createAuthCookieOut(): AuthCookieOut {
  return [];
}

/**
 * Decodes a raw cookie value. Bypasses `decodeURIComponent` + `try...catch`
 * when the value contains no `%` escapes (which applies to almost all cookie
 * values like JWTs, session IDs, and locales).
 */
function decodeCookieValue(rawValue: string): string {
  if (rawValue.indexOf("%") === -1) {
    return rawValue;
  }
  try {
    return decodeURIComponent(rawValue);
  } catch {
    // Invalid URI-encoded value (rare; treat as literal).
    return rawValue;
  }
}

/** Finds the index of the first `=` character between `start` and `end`. */
function findEqualsIndex(header: string, start: number, end: number): number {
  for (let i = start; i < end; i++) {
    if (header.charCodeAt(i) === 61) {
      return i;
    }
  }
  return -1;
}

/** Extracts a trimmed slice from `header` between `start` and `end`. */
function trimSlice(header: string, start: number, end: number): string {
  let s = start;
  while (s < end && header.charCodeAt(s) <= 32) {
    s++;
  }
  let e = end;
  while (e > s && header.charCodeAt(e - 1) <= 32) {
    e--;
  }
  return header.slice(s, e);
}

/** Parses a single `key=value` cookie pair segment between `start` and `end`. */
function parseCookiePair(header: string, start: number, end: number, out: Record<string, string>): void {
  const eqIdx = findEqualsIndex(header, start, end);
  if (eqIdx <= start) {
    return;
  }
  const key = trimSlice(header, start, eqIdx);
  if (key.length === 0) {
    return;
  }
  const rawValue = trimSlice(header, eqIdx + 1, end);
  out[key] = decodeCookieValue(rawValue);
}

/** Matches a single cookie segment against `targetName` and returns the decoded value if matched. */
function matchCookieSegment(header: string, start: number, end: number, targetName: string): string | null {
  const eqIdx = findEqualsIndex(header, start, end);
  if (eqIdx <= start) {
    return null;
  }
  const key = trimSlice(header, start, eqIdx);
  if (key !== targetName) {
    return null;
  }
  const rawValue = trimSlice(header, eqIdx + 1, end);
  return decodeCookieValue(rawValue);
}

/**
 * Fast-path single cookie value extractor.
 *
 * Performance: zero-allocation single-pass index scan. Avoids instantiating a
 * `Record<string, string>` object or decoding/parsing unrelated cookie pairs
 * when looking up a single known cookie (e.g., `access_token` or `NEXT_LOCALE`).
 *
 * @param cookieHeader Raw `Cookie` request header string (or null/undefined).
 * @param targetName The cookie name to extract.
 * @returns Decoded cookie value string if present, or `null` if absent.
 */
export function extractCookieValue(cookieHeader: string | null | undefined, targetName: string): string | null {
  if (!cookieHeader) {
    return null;
  }
  let start = 0;
  const len = cookieHeader.length;

  while (start < len) {
    let end = cookieHeader.indexOf(";", start);
    if (end === -1) {
      end = len;
    }

    const value = matchCookieSegment(cookieHeader, start, end, targetName);
    if (value !== null) {
      return value;
    }

    start = end + 1;
  }

  return null;
}

/**
 * Parses a `Cookie` request header into a plain `Record<string, string>`.
 *
 * Performance: single-pass index scan (no `.split(";")` array allocation).
 *
 * Returns an empty object for an empty/missing header. Cookie values are
 * URL-decoded per RFC 6265 (best-effort — invalid encodings are passed
 * through as-is).
 */
export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) {
    return out;
  }
  let start = 0;
  const len = cookieHeader.length;
  while (start < len) {
    let end = cookieHeader.indexOf(";", start);
    if (end === -1) {
      end = len;
    }
    parseCookiePair(cookieHeader, start, end, out);
    start = end + 1;
  }
  return out;
}

/**
 * Serializes a single cookie into a `Set-Cookie` header value.
 *
 * Flags:
 *  - `HttpOnly`  — always (JS can't read it → XSS can't steal it).
 *  - `SameSite=Strict` — blocks cross-site sends (CSRF mitigation); same-site
 *    top-level navigations still carry the cookie for the `/login → /dashboard`
 *    redirect path the redirect-loop fix relies on.
 *  - `Secure`    — production only (so local dev over `http://` works).
 *                  Opt-out for plain-HTTP test/demo servers via
 *                  `AUTH_COOKIE_SECURE=false` (HTTPS prod unchanged — the
 *                  flag can only DISABLE Secure, never force it on).
 *  - `Path=/`    — cookie is sent on all paths.
 *  - `Max-Age`   — caller-supplied TTL (seconds).
 */
function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  const envConfig = getEnvironmentConfig();
  const secure = envConfig.nodeEnv === "production" && process.env.AUTH_COOKIE_SECURE !== "false" ? "; Secure" : "";
  const encoded = encodeURIComponent(value);
  return `${name}=${encoded}; HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=${maxAgeSeconds}`;
}

/**
 * Pushes the httpOnly `access_token` + `refresh_token` + `session_id`
 * cookies onto the per-request accumulator. The route handler reads this
 * after Apollo processes the mutation and merges the values onto the
 * outgoing response.
 *
 * Call this from the `login` / `refreshToken` mutation resolvers after the
 * service returns fresh tokens. Setting the `access_token` as a cookie is
 * the redirect-loop fix — SSR (`getServerUserContext`) reads it to verify
 * the session without needing a client-supplied identity.
 */
export function setAuthCookies(out: AuthCookieOut, accessToken: string, refreshToken: string, sessionId: string): void {
  out.push(serializeCookie(AUTH_COOKIE_NAMES.accessToken, accessToken, getAccessTokenTtlSeconds()));
  out.push(serializeCookie(AUTH_COOKIE_NAMES.refreshToken, refreshToken, getRefreshTokenTtlSeconds()));
  out.push(serializeCookie(AUTH_COOKIE_NAMES.sessionId, sessionId, getRefreshTokenTtlSeconds()));
}

/**
 * Pushes cookie-deletion entries for all three auth cookies onto the
 * per-request accumulator (used by the `logout` mutation to clear the
 * auth cookies).
 *
 * Implemented by setting `Max-Age=0` + an empty value — the browser deletes
 * the cookie on receipt. `logout` is public (callable with an expired
 * token), so this is the safe path that always clears the cookies
 * regardless of which session the caller thinks they had.
 */
export function clearAuthCookies(out: AuthCookieOut): void {
  out.push(serializeCookie(AUTH_COOKIE_NAMES.accessToken, "", 0));
  out.push(serializeCookie(AUTH_COOKIE_NAMES.refreshToken, "", 0));
  out.push(serializeCookie(AUTH_COOKIE_NAMES.sessionId, "", 0));
}
