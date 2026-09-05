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
 * (e.g. `withPageAuth`, `requireRoleForPage`, or a Server Component layout).
 *
 * `react.cache()` deduplicates calls within a single request — Server
 * Components that call `getServerUserContext()` directly, plus the layout,
 * plus `withPageAuth`, all share one verify+DB-fetch per request.
 *
 * Architecture (per `docs/auth/REDIRECT_LOOP_FIX.md`):
 *  - Pre-fix: `access_token` was NEVER set as a cookie (React memory only),
 *    so SSR could not authenticate, and the dashboard layout kept bouncing
 *    the user back to `/login` even though the client had a valid token.
 *  - Fix: `setAuthCookies` now sets `access_token` as a 15-min httpOnly
 *    cookie (SameSite=Strict, Secure in production). SSR reads it via
 *    `next/headers` `cookies()` and verifies it through the same
 *    `verifyAccessToken` helper the GraphQL context factory uses.
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
import { verifyAccessToken } from "@/backend/lib/auth/jwt";
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
 * Cached SSR auth — verifies the `access_token` httpOnly cookie and returns
 * the authenticated user context.
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
    if (!accessToken) {
      return { userId: null, user: null, role: null };
    }

    const payload = await verifyAccessToken(accessToken);
    if (!payload) {
      // Invalid / expired token — treat as anonymous. The caller will
      // redirect to /login if they need an authenticated user.
      return { userId: null, user: null, role: null };
    }

    // Fetch the latest user row so the SSR boundary picks up governance
    // changes (suspended/blocked flags can change between token issuance
    // and this request).
    const fetched = await UserRepository.findById(payload.userId);
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

    const role = toUserRole(payload.role);
    if (!role) {
      // Tampered role claim — treat as anonymous.
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
