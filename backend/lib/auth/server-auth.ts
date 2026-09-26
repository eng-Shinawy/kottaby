/**
 * `getServerUserContext` — SSR authentication for Server Components.
 *
 * This is the canonical SSR auth entry point. It reads the `access_token`
 * httpOnly cookie (set by `setAuthCookies` on login/refresh — the redirect-loop
 * fix), verifies it via `verifyAccessToken`, fetches the latest user row from
 * the DB, and returns `{ userId, user, role }` — or `{ userId: null, user:
 * null, role: null }` for anonymous / invalid-token callers.
 *
 * This function does NOT redirect — the caller decides whether to redirect
 * (e.g. `withPageAuth` or a Server Component layout).
 *
 * `react.cache()` deduplicates calls within a single request — Server
 * Components that call `getServerUserContext()` directly, plus the layout,
 * plus `withPageAuth`, all share one verify+DB-fetch per request.
 *
 * Architecture (per `docs/auth/REDIRECT_LOOP_FIX.md` +
 * `docs/auth/REDIRECT_LOOP_FIX_OPENCODE2.md`):
 *  - Pre-fix: `access_token` was NEVER set as a cookie (React memory only),
 *    so SSR could not authenticate, and the dashboard layout kept bouncing
 *    the user back to `/login` even though the client had a valid token.
 *  - Fix 1: `setAuthCookies` sets `access_token` as a 15-min httpOnly
 *    cookie (SameSite=Strict, Secure in production). SSR reads it via
 *    `next/headers` `cookies()` and verifies it through the same
 *    `verifyAccessToken` helper the GraphQL context factory uses.
 *  - Fix 2 (redirect-loop fix, session-only fallback): the 15-min
 *    `access_token` cookie expires long before the 7-day session does. An
 *    SSR render that sees only the long-lived cookies must NOT bounce the
 *    user to `/login` — the client still holds an authenticated session
 *    (`me` restored from React memory) and the `(auth)` layout bounces it
 *    straight back, producing the /login ↔ page infinite redirect loop.
 *    When the `access_token` cookie is missing/expired, fall back to the
 *    `refresh_token` cookie: verify its JWT signature and bind it to the
 *    `session_id` cookie (both are set together on login/refresh), then
 *    resolve the user from the DB with the same governance checks.
 *
 * Governance: if the DB row shows the user is `isDeleted` / `isBlocked` /
 * `suspended`, this function returns null — fail-closed at the SSR boundary.
 * The GraphQL context factory mirrors this on its own path.
 */

import { cookies } from "next/headers";
import { cache } from "react";
import { UserRepository } from "@/backend/db/repo";
import { toUserRole, type UserRole } from "@/backend/enum/users/user-role.enum";
import { AUTH_COOKIE_NAMES } from "@/backend/lib/auth/cookies";
import { verifyAccessToken, verifyRefreshToken } from "@/backend/lib/auth/jwt";
import { isSuspensionActive } from "@/backend/lib/auth/suspension-window";
import { logger } from "@/backend/lib/logger";
import type { RegistrationReturnType, UserSelectType } from "@/backend/types";

/**
 * Return shape — `null`-able on every field so callers can destructure
 * safely and decide their own redirect / deny semantics.
 */
export interface ServerUserContext {
  /** Verified user id (null for anonymous / invalid token). */
  readonly userId: number | null;
  /** Authenticated user (password-stripped) — null for anonymous. */
  readonly user: RegistrationReturnType | null;
  /** Verified role (null for anonymous). */
  readonly role: UserRole | null;
}

/**
 * Strips `passwordHash` from a user row to form the return payload (mirrors
 * `AuthService.stripPasswordHash`). The `preferredRecitation` is null on the
 * SSR path (the `me` query path doesn't re-fetch it — same as the GraphQL
 * context factory).
 */
function stripPasswordHash(user: UserSelectType): RegistrationReturnType {
  const { passwordHash: _omitted, ...rest } = user;
  return { ...rest, preferredRecitation: null };
}

/**
 * Session-only fallback — resolves the caller from the long-lived auth
 * cookies when the 15-min `access_token` cookie is missing or expired.
 *
 * Requires the `refresh_token` JWT to verify (signature, issuer,
 * `type: "refresh"`) AND its `sessionId` claim to match the `session_id`
 * cookie — the two are always written together by `setAuthCookies`
 * (login / refreshToken rotation), so a mismatch means tampered or
 * torn-apart cookies and we fail closed.
 *
 * @returns the verified user id, or `null` to treat the caller as
 *     anonymous (the caller decides whether to redirect).
 */
async function resolveUserIdFromSessionCookies(
  cookieStore: Awaited<ReturnType<typeof cookies>>
): Promise<number | null> {
  const refreshToken = cookieStore.get(AUTH_COOKIE_NAMES.refreshToken)?.value;
  if (!refreshToken) {
    return null;
  }
  const refreshPayload = await verifyRefreshToken(refreshToken);
  if (!refreshPayload) {
    return null;
  }
  const sessionId = cookieStore.get(AUTH_COOKIE_NAMES.sessionId)?.value;
  if (!sessionId || sessionId !== refreshPayload.sessionId) {
    return null;
  }
  return refreshPayload.userId;
}

/**
 * Cached SSR auth — verifies the `access_token` httpOnly cookie and returns
 * the authenticated user context. Falls back to the long-lived
 * `refresh_token` + `session_id` cookies when the short-lived access-token
 * cookie has expired (redirect-loop fix — see the architecture note above).
 *
 * Wrapped in `react.cache()` so multiple Server Components + layouts in the
 * same request share a single verify + DB-fetch.
 *
 * @returns `{ userId, user, role }` — all `null` for anonymous / invalid
 *     token / governed account. The caller decides whether to redirect.
 */
export const getServerUserContext = cache(async (): Promise<ServerUserContext> => {
  try {
    const cookieStore = await cookies();
    const accessToken = cookieStore.get(AUTH_COOKIE_NAMES.accessToken)?.value;

    let userId: number | null = null;
    let tokenRole: string | null = null;
    if (accessToken) {
      const payload = await verifyAccessToken(accessToken);
      if (payload) {
        userId = payload.userId;
        tokenRole = payload.role;
      }
    }
    userId ??= await resolveUserIdFromSessionCookies(cookieStore);
    if (userId === null) {
      // Anonymous — the caller decides whether to redirect to /login.
      return { userId: null, user: null, role: null };
    }

    // Fetch the latest user row so the SSR boundary picks up governance
    // changes (suspended/blocked flags can change between token issuance
    // and this request).
    const fetched = await UserRepository.findById(userId);

    if (!fetched) {
      return { userId: null, user: null, role: null };
    }

    // Governance: fail-closed for deleted / blocked / suspended accounts.
    // Mirrors the GraphQL context factory's behavior.
    if (
      fetched.isDeleted ||
      fetched.isBlocked ||
      isSuspensionActive(
        {
          suspended: fetched.suspended,
          suspendedAt: fetched.suspendedAt,
          suspendedPeriodDays: fetched.suspendedPeriodDays,
        },
        new Date()
      )
    ) {
      logger.logDomainError("SSR auth: governed account denied", {
        code: "SSR_GOVERNED_ACCOUNT",
        entity: "users",
        entityId: fetched.id,
      });
      return { userId: null, user: null, role: null };
    }

    // Role: prefer the access-token claim; on the session-only fallback the
    // DB row is the authoritative source. Unrecognized → tampered → anonymous.
    const role = tokenRole !== null ? toUserRole(tokenRole) : toUserRole(fetched.role);
    if (!role) {
      return { userId: null, user: null, role: null };
    }

    return {
      userId: fetched.id,
      user: stripPasswordHash(fetched),
      role,
    };
  } catch (error) {
    // Defensive: any unexpected error in cookie-read / verify / DB-fetch
    // fails closed (anonymous) — never 500 the SSR render.
    logger.logDomainError("SSR auth: unexpected error", {
      code: "SSR_AUTH_ERROR",
      errorName: error instanceof Error ? error.name : "unknown",
    });
    return { userId: null, user: null, role: null };
  }
});
