"use client";

import { CombinedGraphQLErrors } from "@apollo/client";
import { logger } from "@/frontend/lib/logger";
import { buildLoginHref } from "@/frontend/lib/safeRedirect";

// ---------------------------------------------------------------------------
// Auth recovery API — registered by AppApolloProvider so the errorLink can
// attempt a refreshToken mutation BEFORE hard-redirecting to /login on a
// UNAUTHENTICATED GraphQL response. This closes the production-only
// logout-on-navigation bug where the 15-min access_token cookie expires and
// the next me-query (60s poll / on-mount) bounces the user even though the
// long-lived refresh_token cookie is still valid.
// ---------------------------------------------------------------------------
export type AuthRecoveryApi = {
  /** Run refreshToken mutation and persist new token to React memory. Returns the fresh token or null. */
  refresh: () => Promise<string | null>;
  /** After a successful refresh, re-issue all active observable queries with the new token. */
  reFetch: () => void;
};

let authRecovery: AuthRecoveryApi | null = null;

export function registerAuthRecovery(api: AuthRecoveryApi): void {
  authRecovery = api;
  logAuthRedirectEvent("authRecovery registered", { hasApi: true });
}

export function unregisterAuthRecovery(): void {
  authRecovery = null;
  logAuthRedirectEvent("authRecovery unregistered", { hasApi: false });
}

// ---------------------------------------------------------------------------
// Production-visible diagnostics
//
// The project logger (`frontend/common/lib/logger`) is dev-only by default
// (gated on `NODE_ENV === "development"` or `NEXT_PUBLIC_ENABLE_LOGGING=true`)
// — which is why the previous "[AuthRedirect] GraphQL auth error —
// redirecting to login" log was invisible on the deployed site. We now use
// the logger directly, but pass `{ force: true }` so the recovery
// diagnostics bypass the dev-only gate and appear in the production browser
// DevTools console on the remote deployed site. The logger's existing
// PII-santizer still scrubs `token`/`refreshToken`/`accessToken` keys
// before anything is queued, and `/api/logs` is dev-only so forced logs
// are console-only on prod (no 404 noise).
// ---------------------------------------------------------------------------

// Exported for the sibling split modules (`./error-surface`, `./error-routing`).
export const AUTH_REDIRECT_CALLER = "apollo.utils.errorLink";

function truncateId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.length <= 8 ? value : value.slice(0, 8);
}

// Exported for the sibling `./error-routing` module's connectivity branch.
export function logAuthRedirectEvent(message: string, payload: Record<string, unknown> = {}): void {
  try {
    logger.warn({ caller: AUTH_REDIRECT_CALLER, force: true }, "[AuthRedirect]", message, payload);
  } catch {
    // defensive: never let a logging failure swallow the redirect logic
  }
}

// Prevents multiple concurrent hard-redirects when several queries fail auth at once.
let isRedirectingToLogin = false;

// Dedupes concurrent refresh attempts so N simultaneous UNAUTHENTICATED
// responses share one refreshToken mutation (mirrors dedupedRefreshToken.ts).
let inFlightRefresh: Promise<string | null> | null = null;

async function getNewAccessToken(): Promise<string | null> {
  if (inFlightRefresh) {
    logAuthRedirectEvent("getNewAccessToken: reusing in-flight refresh");
    return inFlightRefresh;
  }

  const api = authRecovery;
  if (!api) {
    logAuthRedirectEvent("getNewAccessToken: no authRecovery registered");
    return null;
  }

  logAuthRedirectEvent("getNewAccessToken: starting refresh", {
    hadInFlight: false,
  });

  inFlightRefresh = api
    .refresh()
    .then(token => {
      logAuthRedirectEvent("getNewAccessToken: refresh resolved", {
        newTokenLength: token ? token.length : 0,
        newTokenPrefix: token ? truncateId(token) : null,
      });
      return token;
    })
    .catch(error => {
      logAuthRedirectEvent("getNewAccessToken: refresh threw", {
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      return null;
    })
    .finally(() => {
      inFlightRefresh = null;
    });

  return inFlightRefresh;
}

// Auth-recovery trigger codes. The canonical taxonomy code emitted by the
// DomainError hierarchy is "UNAUTHORIZED" (pothos scopeAuth maps missing
// sessions onto UnauthorizedError); the legacy literal "UNAUTHENTICATED" is
// kept so any pre-taxonomy producer still recovers. The deduped refresh +
// redirect machinery below is owned by this file.
// Exported for the sibling `./error-surface` module's auth-row skip.
export const AUTH_RECOVERY_TRIGGER_CODES = new Set<string>(["UNAUTHENTICATED", "UNAUTHORIZED"]);

/**
 * Public routes where an anonymous identity is expected, so the auth-recovery
 * machinery must never hijack navigation away from them. The landing page
 * (`/`) and the `me` bootstrap query legitimately answer UNAUTHORIZED for
 * visitors who have not signed in — without this exemption every anonymous
 * visit bounced straight back to /login.
 *
 * `/register` belongs in this set as well: without it, sign-up was bounced
 * to `/login?redirect=%2Fregister` ~2 s after load. Protected routes keep
 * the refresh-then-redirect recovery.
 */
function isPublicAuthExemptPath(pathname: string): boolean {
  return pathname === "/" || pathname.endsWith("/login") || pathname === "/register" || pathname.endsWith("/register");
}

// Exported for the sibling `./error-routing` module's fire-and-forget dispatch.
export async function handleAuthError(error: unknown, operationName: string | undefined): Promise<boolean> {
  if (!CombinedGraphQLErrors.is(error)) return false;

  const errorCodes = error.errors.map(err => {
    const rawCode = err.extensions?.code;
    return typeof rawCode === "string" ? rawCode : "unknown";
  });
  const isUnauthenticated = errorCodes.some(code => AUTH_RECOVERY_TRIGGER_CODES.has(code));
  const isForbidden = errorCodes.includes("FORBIDDEN");

  if (!isUnauthenticated && !isForbidden) return false;

  // Make FORBIDDEN visible on prod but DO NOT redirect (existing behavior —
  // redirecting an authenticated user on a permission denial causes a loop
  // because the auth layout bounces them straight back).
  if (isForbidden) {
    logAuthRedirectEvent("handleAuthError: FORBIDDEN (no redirect)", {
      operationName,
      errorCodes,
    });
    return false;
  }

  if (operationName === "login" || operationName === "demoLogin" || operationName === "refreshToken") {
    return false;
  }

  if (typeof globalThis.window === "undefined") return false;

  const pathname = globalThis.window.location.pathname;
  if (isPublicAuthExemptPath(pathname)) {
    return false;
  }

  logAuthRedirectEvent("handleAuthError: UNAUTHENTICATED received", {
    operationName,
    errorCodes,
    pathname,
  });

  if (isRedirectingToLogin) {
    logAuthRedirectEvent("handleAuthError: redirect already in flight — suppressing duplicate", {
      operationName,
    });
    return true;
  }

  return recoverFromUnauthenticated(operationName, pathname);
}

/**
 * Refresh-before-redirect path for UNAUTHENTICATED responses. Attempts a
 * refreshToken via the registered AuthRecoveryApi; on success stays on the
 * page (re-issuing active observable queries with the fresh token), on
 * failure hard-redirects to /login as before.
 */
async function recoverFromUnauthenticated(operationName: string | undefined, pathname: string): Promise<boolean> {
  const newToken = await getNewAccessToken();
  if (newToken) {
    // Refresh succeeded — re-issue all active observable queries with the
    // fresh token loaded into React memory by the recovery API, then reset
    // the redirect flag so we don't get stuck if a future transient
    // UNAUTHENTICATED arrives.
    isRedirectingToLogin = false;
    try {
      authRecovery?.reFetch();
      logAuthRedirectEvent("handleAuthError: recovered via refreshToken — staying on page", {
        operationName,
        pathname,
        newTokenLength: newToken.length,
      });
    } catch (reFetchError) {
      logAuthRedirectEvent("handleAuthError: reFetch threw after successful refresh", {
        operationName,
        errorName: reFetchError instanceof Error ? reFetchError.name : "unknown",
        errorMessage: reFetchError instanceof Error ? reFetchError.message : String(reFetchError),
      });
    }
    return true; // suppress the error — recovery handled it
  }

  // --- refresh failed: genuinely logged out — fall through to hard redirect --
  const search = globalThis.window.location.search;
  const currentUrl = `${pathname}${search}`;
  const targetUrl = buildLoginHref(currentUrl);
  logAuthRedirectEvent("handleAuthError: refresh failed — redirecting to login", {
    operationName,
    errorCodes: ["UNAUTHENTICATED"],
    from: currentUrl,
    to: targetUrl,
  });
  isRedirectingToLogin = true;
  globalThis.window.location.href = targetUrl;
  return true;
}
