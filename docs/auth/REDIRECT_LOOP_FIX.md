# Authentication Architecture & Redirect Loop Fix

## Overview

This document describes the authentication architecture in Kottaby, explains the infinite redirect loop bug between `/login` and `/dashboard`, and documents the fix strategy.

## Current Auth Architecture

### Token Types

| Token | Storage | Lifetime | Purpose |
|-------|---------|----------|---------|
| `access_token` | **Dual storage**: React memory (AuthProvider, for the Apollo `Authorization: Bearer` header) + **httpOnly cookie** | Short-lived (~15min) | GraphQL API authorization header; SSR auth for Server Components / `getServerUserContext()` |
| `refresh_token` | **httpOnly cookie** | 7 days | Silent token rotation via GraphQL mutation |
| `session_id` | **httpOnly cookie** | 7 days | Server-side session validation |

### Auth Flow (Current)

```
┌─────────────────────────────────────────────────────────────┐
│ LOGIN                                                        │
│                                                              │
│ 1. User submits credentials                                 │
│ 2. Server: login mutation (auth.mutation.ts)                │
│    ├─ Generates: access_token, refresh_token, session_id    │
│    ├─ Sets cookies: session_id ✅, refresh_token ✅,          │
│    │   access_token ✅ (httpOnly — the SSR auth path)         │
│    └─ Returns: { token: access_token, user } in response    │
│ 3. Client: AuthProvider stores access_token in React state  │
│ 4. Client: hard redirect to /dashboard                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ TOKEN REFRESH (Client-side)                                  │
│                                                              │
│ 1. AuthProvider.checkAuth() calls refreshTokenMutation      │
│ 2. Server: reads session_id + refresh_token from cookies    │
│ 3. Server: validates + rotates tokens                        │
│    ├─ Sets cookies: session_id ✅, refresh_token ✅,          │
│    │   access_token ✅ (httpOnly — re-set fresh on rotation) │
│    └─ Returns: { token: new_access_token, user } in response│
│ 4. Client: AuthProvider stores new access_token in React state│
│ 5. Client: isAuthenticated = true                            │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ SERVER-SIDE AUTH CHECK (Dashboard Layout SSR)               │
│                                                              │
│ 1. getServerUserContext() reads cookies                     │
│ 2. Finds: session_id ✅, access_token ✅ (15-min httpOnly    │
│    cookie) — an expired/absent access_token falls back to   │
│    verifying refresh_token + session_id                     │
│ 3. Valid pair → returns { userId, context }; anonymous →    │
│    { userId: null, context: null } → Layout redirects to   │
│    /login                                                    │
└─────────────────────────────────────────────────────────────┘
```

### The Infinite Redirect Loop

**Original loop (fixed)**: The server-side `getServerUserContext()` required an `access_token` cookie that was never set by the auth flow, while the client authenticated successfully via `refreshToken` → client/server desync ping-pong between `/login` and `/dashboard`. Fixed by the session-only SSR fallback (below) and the `app/(auth)/layout.tsx` bounce guard.

**Current loop (post-M6)**: With the session-only fallback in place, symmetric desync can still occur on the refresh path itself:

```
/dashboard (Client)
  └─ me / notificationAlerts → UNAUTHENTICATED (no/expired access token)
  └─ errorLink → refreshToken mutation
       └─ session_id valid ✅, but refresh_token cookie JTI is STALE
          (racing tabs both rotated tokens; one cookie is out of date)
       └─ validateRefreshTokenJti: logs "allowing rotation" but
          jtiMatchesSession returns false → resolver returns null
  └─ Client: "refresh failed — redirecting to /login"
       │
/login (Server SSR)
  └─ getServerUserContext() → session_id valid → session-only auth ✅
  └─ app/(auth)/layout.tsx bounces "authenticated" user back → /dashboard
       │
     ♻️ INFINITE LOOP (plus client-logs rate-limit floods and
        MaxListenersExceededWarning on the dev-server Gzip from the storm)
```

**Root cause**: The resolver *warns* "Stale refresh_token JTI with valid session_id; allowing rotation" yet the subsequent `jtiMatchesSession` check **rejects** the same case — the code contradicts its own log. The M6 hardening made JTI matching unconditional (to close the stolen-cookies replay window), which broke the legitimate stale-cookie-after-parallel-rotation scenario: one tab's refresh rotates `session.payload.refreshTokenJti`, leaving the other tab's `refresh_token` cookie permanently stale while its `session_id` stays valid.

### Fix direction

- **Primary**: In `validateRefreshTokenJti`, when the session resolved via `session_id` and the `refresh_token` JWT *verifies* (same user, valid signature, `type: "refresh"`) but has a stale JTI, honor the "allowing rotation" contract — allow rotation and let `rotateTokensAndSession` write the fresh JTI. This converges both racing tabs onto a valid token pair instead of returning `null` forever. Strict JTI equality still applies on the non-`session_id` path (M6 replay protection).
- **Defense-in-depth**: keep the errorLink SSR/`/login` guards (no refresh-or-redirect while server-rendering or already on the login page) so a failed refresh can never bounce recursively.

## Fix Strategy

### Primary Fix: Update `getServerUserContext()` to Use Available Cookies

Change the server-side auth check to validate using `session_id` + `refresh_token` cookies (which are actually set as httpOnly cookies), instead of requiring an `access_token` cookie that the auth flow did not set at the time of the original loop (the shipped architecture now sets it too — see the Token Types table above and Addendum 2).

**Updated flow:**

```
/dashboard (Server SSR)
  └─ getServerUserContext() reads cookies:
     ├─ session_id ✅ → validate session → get userId
     └─ refresh_token ✅ → fallback: verify JWT + match session → get userId
  └─ Returns: { userId, context } ✅ → renders dashboard
```

This aligns server-side auth with the reality of what cookies are available.

### Secondary Fixes

1. **Add `app/(auth)/layout.tsx`**: Server-side auth guard on login that redirects authenticated users to `/dashboard`, eliminating the client-side redirect flash.

2. **Fix `app/page.tsx`**: Smart redirect based on auth state instead of unconditionally redirecting to `/login`.

## Security Considerations

### Why the `access_token` is Both React Memory AND an httpOnly Cookie (Design Decision)

The `access_token` is held in React memory by the AuthProvider (the Apollo `Authorization: Bearer` header source) and ALSO set as an **httpOnly cookie** (`backend/lib/auth/cookies.ts` — `setAuthCookies` writes `access_token` beside `refresh_token` and `session_id`, all `HttpOnly` + `SameSite=Strict`):
- httpOnly means an attacker executing JavaScript via XSS **cannot read the cookie** — the in-memory copy exists for the API header, not for exfiltration resistance of the cookie itself
- The in-memory copy is lost on page reload (by design); the cookie lets SSR (`getServerUserContext()`) authenticate Server Components without any client-supplied identity
- The `refreshToken` mutation (which rotates via httpOnly cookies) silently restores both storages

This dual storage is the redirect-loop fix (see `docs/auth/jwt-authentication-service.md` §2.1): the server-side auth check uses the httpOnly cookies that exist — the 15-min `access_token` cookie first, with the `refresh_token` + `session_id` pair as the fallback for the expired case.

### `sameSite: "strict"` Consideration

Auth cookies use `sameSite: "strict"`, which blocks cookies on cross-site navigations. For a same-site app this is generally fine, but `"lax"` would be more forgiving for external redirects back to the app. This is a separate security decision and not part of the current fix.

## Files Reference

| File | Purpose |
|------|---------|
| `backend/lib/auth/server-auth.ts` | Server-side auth validation (SSR) |
| `backend/graphql/mutation/auth.mutation.ts` | Login/refresh/logout mutations + cookie setting |
| `backend/graphql/gqlContextFactory.ts` | GraphQL context factory (reads auth cookies) |
| `backend/lib/auth/jwt.ts` | JWT token generation and verification |
| `backend/lib/auth/cached-user.ts` | React.cache() wrapper for current user |
| `backend/services/auth/session.service.ts` | Session management service |
| `frontend/providers/apollo/AuthProvider.tsx` | Client-side auth state management |
| `frontend/views/auth/login/index.tsx` | Login container (client redirect logic) |
| `frontend/lib/safeRedirect.ts` | Safe redirect URL validation |
| `app/(dashboard)/layout.tsx` | Dashboard layout (server auth guard) |
| `app/(auth)/layout.tsx` | Auth layout (server guard for authenticated users) |
| `app/page.tsx` | Root page (unconditional login redirect) |
| `app/layout.tsx` | Root layout (providers including AuthProvider) |

## Cookie Configuration

| Cookie | httpOnly | sameSite | secure | maxAge | path |
|--------|----------|----------|--------|--------|------|
| `session_id` | true | strict | production-only | 7 days | `/` |
| `refresh_token` | true | strict | production-only | 7 days | `/` |
| `access_token` | true | strict | production-only | ~15 min | `/` |

---

## Addendum — Preview-Gateway Trailing-Slash Loop (bare `/dashboard`)

### Symptom

Logging in through the z.ai preview gateway
(`preview-chat-*.space-z.ai`) lands the browser on
`ERR_TOO_MANY_REDIRECTS` ("redirected you too many times"). Direct
`localhost:3000` access is unaffected — the same login succeeds and lands
on the role dashboard.

### Root Cause

The gateway canonicalizes **exactly the bare path `/dashboard`** to a
trailing slash (verified: `301 /dashboard → /dashboard/`; every other app
path — `/login`, `/teacher/dashboard`, even nonexistent paths — passes
through untouched). Next.js (default `trailingSlash: false`) answers
`308 /dashboard/ → /dashboard`. A browser sent to bare `/dashboard`
therefore ping-pongs between the two forever:

```text
browser → GET /dashboard    → gateway 301 → /dashboard/
browser → GET /dashboard/   → Next 308    → /dashboard
browser → GET /dashboard    → gateway 301 → /dashboard/   … ∞
```

The app compounded this by using bare `/dashboard` as the universal
browser-facing redirect target: the login-form fallback, the `(auth)`
authenticated bounce, the sidebar dashboard item (all roles), the app-bar
wordmark, the profile "back" button, the server guards' role-mismatch
fallback, and the dispatcher's own anonymous
`/login?redirect=/dashboard` param (which fed the login form's push back
into the trap).

### Fix — "never navigate the browser to bare `/dashboard`"

New helper `frontend/lib/auth/roleDashboardRoute.ts`:

- `roleDashboardPath(role)` — role → role-specific dashboard route
  (mirrors the server dispatcher's `ROLE_DASHBOARD_ROUTE`; accepts both
  backend lowercase values and codegen capitalized values via
  lower-case normalization; unknown/null falls back to the student
  dashboard, same least-privilege precedent as `getNavItemsForRole`).
- `resolvePostAuthTarget(redirectParam, role)` — explicit safe
  `?redirect=` param wins **unless it is bare `/dashboard`** (legacy
  bookmarks / old errorLink URLs), else the role dashboard.

Call-site changes (all previously targeted bare `/dashboard`):

| Call site | Change |
|-----------|--------|
| `app/(auth)/login/LoginForm.tsx` | pushes only an explicit safe non-`/dashboard` param; no-param case defers to the layout's role-aware bounce |
| `app/(auth)/layout.tsx` | authenticated bounce → `resolvePostAuthTarget(param, user?.role)` |
| `frontend/views/dashboard/navItems.ts` | each role's dashboard item points at its own role route |
| `frontend/views/dashboard/DashboardSidebar.tsx` | exact-match active highlighting (prefix special-case obsolete) |
| `frontend/views/dashboard/DashboardAppBar.tsx` | wordmark href → role dashboard |
| `frontend/views/dashboard/profile/ProfileView.tsx` | "back to dashboard" → role dashboard |
| `frontend/lib/auth/withPageAuth.ts` | same |
| `app/(dashboard)/dashboard/page.tsx` | anonymous branch → bare `/login` (stops producing the poisoned param) |

The `/dashboard` dispatcher route itself stays online — it remains a
valid server-side deep-link entry point on direct deployments; it is just
never used as a browser navigation target from inside the app.

Contract tests: `frontend/lib/auth/roleDashboardRoute.test.ts` (mapping,
lowercase/capitalized parity, bare-`/dashboard` rejection, open-redirect
guard precedence).

---

## Addendum 2 — Loop 3 (2026-09): 15-min access_token cookie expiry vs. client-side auth state

### Symptom

Reproduced on the dev server (devtools + Playwright): with a valid 7-day
session, an in-tab (SPA) navigation to any SSR-guarded page ping-ponged
forever — 174 navigations in ~12 s:

```text
/admin/dashboard → (SSR guard: access_token cookie expired → redirect)
/login?redirect=/admin/dashboard → ((auth) layout: client isAuthenticated → bounce)
/admin/dashboard → … ∞
```

### Root cause

Two auth surfaces disagree once the 15-min `access_token` cookie expires
while the client session is still alive:

- **SSR** (`getServerUserContext`) authenticated ONLY via the short-lived
  `access_token` cookie → every guarded page rendered anonymous → server
  redirect to `/login?redirect=<path>`.
- **Client** (React-memory `user` from the `me` query, restored via cookies)
  still reported `isAuthenticated` → the `(auth)` layout immediately bounced
  back to the guarded page (`resolvePostAuthTarget`).

Neither side could recover: the client's `refreshToken` mutation required an
explicit token argument from React memory (empty on cold reload), so the
cookie-based recovery described in this document was never actually wired.

### Fix (both surfaces)

1. **Session-only SSR fallback** (`backend/lib/auth/server-auth.ts`):
   when the `access_token` cookie is missing/expired, verify the
   `refresh_token` cookie JWT (signature + `type: "refresh"`) AND bind it to
   the `session_id` cookie (the `sessionId` claim must match — both cookies
   are written together by `setAuthCookies`). Role comes from the
   authoritative DB row on this path. SSR no longer bounces a valid session.
2. **Cookie-based refresh rotation** (`backend/graphql/mutation/auth.mutation.ts`):
   the `refreshToken` mutation argument is now OPTIONAL — an omitted/empty
   argument makes the resolver rotate from the httpOnly `refresh_token`
   cookie. The client hooks (`useRefreshSession`, `useAuthRecoveryRegistration`,
   `useRestoreSession`) no longer skip refresh when the React-memory slot is
   empty; they pass the empty value and let the server fall back to the
   cookie, then retry `me` — cold reloads with a valid 7-day session now
   re-establish auth instead of landing on `/login`.

### Verification

- Anonymous (no cookies): lands on `/login?redirect=…` and stays (no loop).
- SPA navigation with expired `access_token` cookie: single navigation to the
  guarded page, stays authenticated.
- Hard reload with expired `access_token` cookie: page renders
  authenticated AND the client's cookie-based refresh re-sets a fresh
  `access_token` cookie.
