# JWT Authentication Service — Canonical Reference

**Owner:** Auth/RBAC domain
**Status:** Implemented and verified
**Last updated:** 2026-08-26

> This is the canonical reference for the JWT authentication service and the RBAC middleware contract layered on top of it. All implementation work in the auth/RBAC surface MUST consult this doc before modifying `backend/lib/auth/*`, `backend/services/auth/*`, `backend/graphql/pothos/builder.ts`, `backend/graphql/gqlContextFactory.ts`, or `frontend/lib/auth/*`.

---

## 1. Why

Every actor in the platform (Student, Teacher Applicant, Certified Sheikh, Parent, Super Admin) authenticates via the same JWT-backed login flow. The JWT `role` claim drives their downstream experience and is the canonical identity signal for the RBAC layer.

The contract must satisfy three load-bearing requirements:

1. **No redirect loops.** A user with a valid token must never bounce `/login ↔ /dashboard` indefinitely. The original substrate stored `access_token` in React memory only — SSR could not authenticate and bounced. The fix: `access_token` is set BOTH as an httpOnly cookie (for SSR) AND returned in the login payload (for the Apollo `authLink`).
2. **Trustworthy identity + role for RBAC.** The `role` claim must come exclusively from `users.role` in the DB (BFLA defense — the caller cannot inject a role via input). The context factory (`gqlContextFactory`) and SSR boundary (`getServerUserContext`) both verify the JWT signature, fetch the latest user row, and populate `ctx.role` / `ctx.user` / `ctx.isSuperAdmin` from the DB-sourced values.
3. **Fail-closed governance.** Deleted/blocked/suspended accounts are denied login with localized `FORBIDDEN` (no oracle leak). The SSR boundary fail-closes on governed accounts. The `authenticated` scope throws `UnauthorizedError` (401) on missing context; the `role` / `permission` / `superAdmin` scopes return `false` (403) on miss.

---

## 2. Pattern

### 2.1 Architecture

```
Client (browser)
  ├── Apollo Client (authLink reads access_token from React memory)
  │     ↓ Authorization: Bearer <access_token>
  └── httpOnly cookies (access_token, refresh_token, session_id)
        ↓ (SSR path — Server Components read cookies via next/headers)

Server (Next.js)
  ├── GraphQL route (app/api/graphql/route.ts)
  │     ↓ createGraphQLContext(request) → Context { user, role, isSuperAdmin, ... }
  │     ↓ gqlSchemaBuilder.authScopes: ctx => ({ authenticated, role, permission, superAdmin, notImpersonating })
  │     ↓ scope-auth plugin evaluates scopes per field → allow / 401 / 403
  │
  └── Server Components (app/(dashboard)/*/page.tsx)
        ↓ getServerUserContext() (cached via react.cache)
        ↓ reads access_token cookie → verifyAccessToken → fetch user → governance fail-closed
        ↓ withPageAuth({ roles: [...] }) / requireRoleForPage([...])
        ↓ allow / redirect to /login (anonymous) / redirect to /dashboard (role mismatch)
```

### 2.2 Token claims contract

| Token | Algorithm | TTL | Claims |
|---|---|---|---|
| `access_token` | HS256 (`jose`) | 15 minutes (`JWT_ACCESS_TOKEN_EXPIRY` = 900s) | `sub: <userId>` (stringified), `role: <user_role>`, `type: "access"`, `iss: "draft-academy"`, `iat`, `exp` |
| `refresh_token` | HS256 (`jose`) | 7 days (604800s) | `sub: <userId>` (stringified), `sessionId: <random UUID>`, `type: "refresh"`, `iss: "draft-academy"`, `iat`, `exp` |
| `session_id` | (not a JWT — opaque UUID) | 7 days (604800s) | `crypto.randomUUID()` — correlates the refresh token with the httpOnly `session_id` cookie |

**Secrets:**
- Production: set `JWT_ACCESS_SECRET` + `JWT_REFRESH_SECRET` separately (explicit env vars).
- Dev fallback: derive both from `DATABASE_ENCRYPTION_KEY` (the 64-char hex AES key) via `SHA-256(<key>:<domain>)` — produces a cryptographically distinct 32-byte secret per token type without requiring multiple env vars. Production deploys MUST NOT rely on this fallback.

**Verification contract:**
- `verifyAccessToken(token)` and `verifyRefreshToken(token)` return `null` on ANY failure (invalid signature, expired, wrong issuer, wrong type, malformed). They NEVER throw.
- The context factory and SSR boundary treat `null` as "anonymous" — no 500, no oracle leak.
- The same `UnauthorizedError(t.invalidCredentials)` is thrown for unknown email, wrong password, expired token, and tampered token (oracle equality).

### 2.3 Cookie matrix

| Cookie | HttpOnly | SameSite | Secure | Path | Max-Age | Set by | Cleared by |
|---|---|---|---|---|---|---|---|
| `access_token` | ✅ always | `Strict` | production only | `/` | 900 (15 min) | `setAuthCookies` on `login` + `refreshToken` | `clearAuthCookies` on `logout` |
| `refresh_token` | ✅ always | `Strict` | production only | `/` | 604800 (7 d) | `setAuthCookies` on `login` + `refreshToken` | `clearAuthCookies` on `logout` |
| `session_id` | ✅ always | `Strict` | production only | `/` | 604800 (7 d) | `setAuthCookies` on `login` + `refreshToken` | `clearAuthCookies` on `logout` |

**Wire-up:**
- `createGraphQLContext` accepts a per-request `Set-Cookie` accumulator (`authCookieOut: string[]` on `Context`).
- Mutations (`login`, `refreshToken`, `logout`) push serialized cookie strings into `ctx.authCookieOut` via `setAuthCookies` / `clearAuthCookies`.
- `app/api/graphql/route.ts` reads `ctx.authCookieOut` after Apollo processes the request and merges the values onto the outgoing `Response` via `headers.append("Set-Cookie", ...)`.

**Cookie flag rationale:**
- `HttpOnly` — JS can't read → XSS can't steal.
- `SameSite=Strict` — blocks cross-site sends (CSRF mitigation). Same-site top-level navigations still carry the cookie for the `/login → /dashboard` redirect path the redirect-loop fix relies on.
- `Secure` — production only (so local dev over `http://` works).
- `Path=/` — cookie sent on all paths.
- `Max-Age=0` + empty value (on logout) — browser deletes the cookie on receipt.

### 2.4 Redirect-loop fix (the load-bearing detail)

**Pre-fix:** `access_token` was React-memory-only. SSR (`getServerUserContext`) could not authenticate, and the dashboard layout kept bouncing the user back to `/login` even though the client had a valid token in memory. See `docs/auth/REDIRECT_LOOP_FIX.md` for the full root-cause analysis.

**Fix:** `setAuthCookies` now writes `access_token` as a 15-min httpOnly cookie (SameSite=Strict, Secure in production). `getServerUserContext` reads it via `cookies()` from `next/headers` and verifies it through the same `verifyAccessToken` helper the GraphQL context factory uses.

**Dual storage:**
- **React memory** (Apollo `authLink` reads `access_token` via `updateAuthToken` from `useNetworkConnectivity`) — the client-only path. Survives client-side navigation within a tab session.
- **httpOnly cookie** — the SSR-only path. Set on login + refresh; cleared on logout. Read by `getServerUserContext` and `gqlContextFactory` (fallback when `Authorization` header is absent).

Both paths funnel through the same `verifyAccessToken` → DB-fetch-by-`payload.userId` pipeline. No client-supplied identity is ever trusted.

### 2.5 authScopes (Pothos scope-auth plugin)

The Pothos `SchemaBuilder` declares five `AuthScopes` (in `backend/graphql/pothos/builder.ts`):

```typescript
AuthScopes: {
  authenticated: boolean;        // 401 boundary — throws UnauthorizedError when !ctx.user
  role: UserRole[];              // OR semantics over the role set; returns false (403) on miss
  permission: string[];          // OR semantics over permission codes; placeholder — currently always true
  superAdmin: boolean;           // ctx.isSuperAdmin (true iff role === UserRole.Admin)
  notImpersonating: boolean;     // placeholder (no impersonation surface yet); always true
}
```

The `authScopes: ctx => ({ ... })` initializer wires each scope key to a decision based on the GraphQL `Context` (populated by `createGraphQLContext` from the verified access token):

```typescript
authScopes: ctx => ({
  authenticated: () => {
    if (!ctx.user) throw new UnauthorizedError("Authentication required.");
    return true;
  },
  role: (roles: UserRole[]) => (ctx.role ? roles.includes(ctx.role) : false),
  permission: () => true,                       // placeholder — replace with PermissionsService.getUserContext call
  superAdmin: () => ctx.isSuperAdmin,
  notImpersonating: true,                       // placeholder
})
```

**Semantics:**

| Scope | Decision | Failure code | Notes |
|---|---|---|---|
| `authenticated: true` | throws `UnauthorizedError` when `!ctx.user` | `UNAUTHORIZED` (401) | 401 boundary — checked first |
| `role: [UserRole.X, ...]` | `roles.includes(ctx.role)` (OR) | `FORBIDDEN` (403) | returns `false` (not throw) on miss → Pothos converts to `FORBIDDEN` |
| `permission: ["PERM.X", ...]` | placeholder — always `true` | (n/a) | when wired: `perms.some(p => ctx.permissions.includes(p))` (OR) |
| `superAdmin: true` | `ctx.isSuperAdmin` | `FORBIDDEN` (403) | independent axis; `role` scope does NOT weaken |
| `notImpersonating: true` | `true` (placeholder) | (n/a) | no impersonation surface yet |

**Composition (Pothos authScope conjunction):**
- Declaring multiple scopes on a field requires ALL to pass (AND).
- `{ role: [UserRole.Admin], permission: ["users.update"] }` requires BOTH admin role AND the `users.update` permission.
- `{ superAdmin: true }` is an independent axis — `{ role: [UserRole.Admin], superAdmin: true }` is satisfied iff `ctx.role === Admin` AND `ctx.isSuperAdmin === true` (which is the same condition, but the composition is preserved).

**Fail-closed rule:** every scope evaluator MUST fail-closed (throw or return `false`) on missing context or unexpected error. The `permission` placeholder MUST be replaced by a fail-closed evaluator when wired.

### 2.6 SSR auth (`getServerUserContext`)

`backend/lib/auth/server-auth.ts` exports `getServerUserContext` — the canonical SSR auth entry point. Wrapped in `react.cache()` so multiple Server Components + layouts in the same request share a single verify + DB-fetch.

**Flow:**
1. Read `access_token` from `cookies()` (`next/headers`).
2. If absent → return `{ userId: null, user: null, role: null }` (anonymous).
3. `verifyAccessToken(token)` — returns `null` on any failure → anonymous.
4. `UserRepository.findById(payload.userId)` — fetch the latest user row so SSR picks up governance changes.
5. If user not found → anonymous.
6. **Governance fail-closed:** if `fetched.isDeleted || fetched.isBlocked || fetched.suspended` → log via `logger.logDomainError` → return anonymous.
7. `toUserRole(payload.role)` — validate the JWT `role` claim against the canonical `UserRole` enum. Invalid → anonymous.
8. Return `{ userId, user: stripPasswordHash(fetched), role }`.

**Caller decides redirect semantics:** `withPageAuth` / `requireRoleForPage` / the dashboard layout call `getServerUserContext()` and decide whether to redirect based on the return shape. The function itself NEVER redirects.

### 2.7 Page guards (`withPageAuth`, `requireRoleForPage`)

**`withPageAuth(options?: WithPageAuthOptions): Promise<WithPageAuthResult>`**

Options:
- `roles?: readonly UserRole[]` — optional role whitelist (OR semantics). A role mismatch redirects to `/dashboard` (canonical fallback per `app/AGENTS.md`).
- `redirectTo?: string` — path to redirect back to after a successful login. Defaults to no `?redirect=` param.

Behavior:
- Anonymous (`!ctx.user || !ctx.role || !ctx.userId`) → `redirect("/login?redirect=<redirectTo>")`.
- Role mismatch (`options.roles && !options.roles.includes(ctx.role)`) → `redirect("/dashboard")`.
- Match → returns `{ userId, user, role }`.

**`requireRoleForPage(roles: readonly UserRole[], redirectTo?: string): Promise<RequireRoleForPageResult>`**

Sister helper to `withPageAuth`, focused on role checking. Same redirect semantics, same locale-safe handling. Differs only in ergonomics — `requireRoleForPage` makes the role requirement the primary parameter (matching the `requirePermissionForPage(userId, [perms], ...)` pattern from `app/AGENTS.md`).

**Serverless cold-start rule:** both consume `getServerUserContext()` (cached via `react.cache()`) — single verify + DB-fetch per request, shared across all Server Components + layouts. No extra DB reads for role checks.

### 2.8 Role-based dashboards

| Route | Guard | Redirect (anonymous) | Redirect (role mismatch) |
|---|---|---|---|
| `/student/dashboard` | `withPageAuth({ roles: [UserRole.Student], redirectTo: "/student/dashboard" })` | `/login?redirect=/student/dashboard` | `/dashboard` |
| `/teacher/dashboard` | `withPageAuth({ roles: [UserRole.Teacher], redirectTo: "/teacher/dashboard" })` | `/login?redirect=/teacher/dashboard` | `/dashboard` |
| `/parent/dashboard` | `withPageAuth({ roles: [UserRole.Parent], redirectTo: "/parent/dashboard" })` | `/login?redirect=/parent/dashboard` | `/dashboard` |
| `/admin/dashboard` | `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/dashboard" })` | `/login?redirect=/admin/dashboard` | `/dashboard` |
| `/dashboard` | (role-aware redirect entrypoint) | `/login` | (per-role redirect) |

All four role-specific routes render the `DashboardView` client component (role-aware stat cards + nav). Metadata generated per-locale via `generateMetadata()` reading `getLocaleFromCookie()`.

### 2.9 `me` query authScope

The `me` query carries `authScopes: { authenticated: true }`. Anonymous callers receive a GraphQL `UNAUTHORIZED` error instead of `null`. The AuthProvider's `restoreSession` catches the error and falls through to its refresh-then-retry path — same UX as the prior return-null contract, but with explicit 401 semantics at the schema layer.

`me` does NOT carry `role` or `permission` scopes — every authenticated user can read their own profile.

---

## 3. Rules

### 3.1 Token claims

- **Access token claims** are exactly `{ sub, role, type: "access", iss, iat, exp }`. Do NOT add custom claims without updating this doc + the verification contract.
- **Refresh token claims** are exactly `{ sub, sessionId, type: "refresh", iss, iat, exp }`. The `sessionId` correlates with the httpOnly `session_id` cookie.
- **The `role` claim is sourced exclusively from `users.role` in the DB.** `AuthService.login` reads `user.role` from the DB-fetched user row before `signAccessToken({ userId, role: user.role })`. The caller cannot inject a role via input (BFLA defense).
- **`verifyAccessToken` / `verifyRefreshToken` return `null` on any failure.** They NEVER throw. The context factory and SSR boundary treat `null` as anonymous.
- **Oracle equality:** unknown email and wrong password produce the identical `UnauthorizedError(t.invalidCredentials)`. No distinguishing client-visible error.

### 3.2 Cookies

- **All three auth cookies are `HttpOnly; SameSite=Strict; Path=/; Max-Age=<ttl>; Secure-in-prod`.** No exceptions.
- **`access_token` is set as a cookie (the redirect-loop fix).** Do NOT remove this — SSR (`getServerUserContext`) depends on it.
- **`logout` clears all three cookies** via `clearAuthCookies` (`Max-Age=0` + empty value). `logout` is public (callable with an expired token) so the cookies always clear.
- **Token storage discipline:** access token in React memory (Apollo `authLink`) + httpOnly cookie (SSR). Refresh token in React memory only. NEVER persist tokens to `localStorage` / `sessionStorage` / Zustand `persist` store.

### 3.3 authScopes

- **401-vs-403 exclusivity:** `authenticated` throws `UnauthorizedError` (401) on `!ctx.user`. `role` / `permission` / `superAdmin` return `false` (403) on miss. No fourth ad-hoc state.
- **`role` scope uses OR semantics** over the role set (`roles.includes(ctx.role)`).
- **AND-composition across scopes:** declaring `{ role: [...], permission: [...] }` requires both (Pothos authScope conjunction).
- **`superAdmin` is an independent axis.** The `role` scope does NOT weaken, bypass, or replace the `superAdmin` gate.
- **Fail-closed:** every scope evaluator MUST fail-closed (throw or return `false`) on missing context or unexpected error.
- **`ctx.role` is sourced exclusively from the verified JWT** (`verifyAccessToken` → `payload.role` → `toUserRole(payload.role)` runtime guard). NEVER from client-supplied headers, arguments, localStorage claims, or JWT payload without server verification.
- **Role↔certification boundary:** `role=teacher` does NOT imply certification. Certification remains `teacher.is_approved` and IS enforced by domain services. The `role` scope stops at role fit.

### 3.4 SSR

- **`getServerUserContext` is the canonical SSR auth entry point.** Server Components + layouts + `withPageAuth` / `requireRoleForPage` all call it.
- **`react.cache()` deduplicates calls within a single request.** Do NOT bypass the cache.
- **Governance fail-closed at SSR:** `if (fetched.isDeleted || fetched.isBlocked || fetched.suspended) return null` — the SSR boundary treats governed accounts as anonymous.
- **`withPageAuth` / `requireRoleForPage` are the server-side security boundary.** Container-level client wrappers (`<RequirePermission>`) are UX-only — bypassable. Do NOT introduce container-level full-page client gates as a substitute for server guards.
- **`requireRoleForPage` consumes `UserPermissionContext.role` without extra DB reads** (serverless cold-start rule).

### 3.5 Login flow

- **`AuthService.login(email, password, locale)`** verifies credentials → checks governance → signs JWT pair → returns `AuthSession`. The resolver pushes cookies via `setAuthCookies(ctx.authCookieOut, ...)`.
- **Governance gate runs AFTER password verification** (prevents oracle leak) and BEFORE token issuance. `assertUserActive(user, t.accountBlocked)` throws `ForbiddenError` if `isDeleted || isBlocked || suspended`.
- **`last_active_at` bump is fire-and-forget.** `touchLastActiveAt(user.id)` runs outside the critical path; transient DB errors are swallowed + logged via `logger.logDomainError`. Never blocks authentication.
- **LoginForm calls `loginContext()` from `useAuth()` only** — no direct `loginMutationDocument` call (double-login fix). The AuthProvider's `login()` owns the single `loginMutation` call.
- **AuthProvider `login()` rethrows errors** so the LoginForm can perform granular error-code mapping (`UNAUTHORIZED` → `t.invalidCredentials`, `FORBIDDEN` → `t.accountBlocked`).

### 3.6 Refresh + logout

- **`AuthService.refreshToken(token, locale)`** verifies the refresh token → fetches the user from DB → re-checks governance → issues a fresh pair + new `session_id`. The resolver pushes fresh cookies via `setAuthCookies`.
- **Rotation is by issuance** (new refresh token supersedes old). Strict JTI equality vs stale-JTI race is NOT enforced yet — the server-side session store for JTI rotation is a deferred item. The current contract trusts the refresh-token signature.
- **`logout` is public** (no `authScope`). A caller with an expired access token (or no token at all) MUST still be able to log out so the cookies clear. The resolver always calls `clearAuthCookies` and returns `{ success: true }`.
- **AuthProvider `logout()` calls `logoutMutation` (fire-and-forget), then clears React-memory tokens, resets user state, resets Apollo cache (`client.resetStore()`), and navigates to `/login`.**

### 3.7 i18n

- **All auth-path error messages use compile-time i18n.** Resolvers use `ctx.t("errors")` / `ctx.t("auth")`. Services use `getServerTranslations(locale, "errors")` / `getServerTranslations(locale).authTranslations`.
- **No hardcoded strings** in `backend/lib/auth/*`, `backend/services/auth/*`, `backend/graphql/{mutation,query}/auth*.ts`, `frontend/providers/apollo/AuthProvider.tsx`, `app/(auth)/login/LoginForm.tsx`.
- **`redactEmail(email)` for log redaction** — preserves the first 2 chars + `***@domain`. Never log plaintext emails in `logger.logDomainError` calls.

### 3.8 Logging

- **No `console.*` calls** in any auth/RBAC file. All logging via `logger.logDomainError` (expected rejections — failed login, governed account deny, SSR auth error) or `logger.warn` (frontend — refresh failure, me query failure).
- **Plaintext access/refresh tokens NEVER logged.** `passwordHash` structurally omitted from `RegistrationReturnType` via `stripPasswordHash`.

---

## 4. What NOT to Do

- **Do NOT remove the `access_token` httpOnly cookie.** It is the redirect-loop fix. SSR (`getServerUserContext`) depends on it.
- **Do NOT persist tokens to `localStorage` / `sessionStorage` / Zustand `persist` store.** React memory only (access + refresh tokens) + httpOnly cookie (access token, SSR-only).
- **Do NOT trust client-supplied role claims.** The `role` scope evaluator reads `ctx.role` exclusively (server-sourced from the verified JWT). Never read `role` from request inputs, headers, or localStorage.
- **Do NOT create parallel auth helpers.** Extend the existing substrate in place (`backend/lib/auth/*`, `backend/services/auth/auth.service.ts`, `backend/graphql/gqlContextFactory.ts`, `backend/graphql/mutation/auth.mutation.ts`, `backend/graphql/query/auth.query.ts`, `frontend/providers/apollo/AuthProvider.tsx`, `frontend/lib/auth/*`).
- **Do NOT create parallel authorization helpers.** `gqlSchemaBuilder.ts`'s `buildAuthScopes` initializer is the single authorization decision point.
- **Do NOT weaken the `superAdmin` gate.** `{ superAdmin: true }` is an independent axis; the `role` scope does NOT bypass it.
- **Do NOT introduce container-level full-page client gates as a substitute for server guards.** `<RequirePermission>` is UX-only — bypassable. `withPageAuth` / `requireRoleForPage` are the server-side security boundary.
- **Do NOT log plaintext tokens or passwords.** Use `redactEmail(email)` for log redaction. `passwordHash` structurally omitted from `RegistrationReturnType`.
- **Do NOT distinguish "email doesn't exist" from "wrong password" in error messages.** Both produce the identical `UnauthorizedError(t.invalidCredentials)` (oracle equality).
- **Do NOT patch the `users` schema inline.** Governance fields are owned by the user-schema layer. Any schema gap must be escalated, not patched in place.
- **Do NOT add a `grantRole*` / `assignRole*` / `elevate*` mutation.** Privilege grant is categorically absent by construction. Role assignment happens only at registration (the `RegisterPublicRole` enum excludes `admin`) or via dedicated admin paths.
- **Do NOT use `as UserRole` narrowing casts.** Use the `toUserRole(value)` runtime guard.
- **Do NOT use `import type` for runtime-used enums.** Value imports where the enum is used at runtime (dashboard pages, `gqlContextFactory`, `server-auth`).
- **Do NOT call `loginMutation` directly from the LoginForm.** Use `loginContext()` from `useAuth()` (double-login fix).
- **Do NOT swallow login errors in AuthProvider.** `login()` MUST rethrow so the LoginForm can perform granular error-code mapping.

---

## 5. RBAC Consumption Guide

The RBAC middleware consumes the auth context produced by the JWT authentication service and layers the authorization contract on top. The contract is documented in this section.

### 5.1 Consume `ctx.user`, `ctx.role`, `ctx.isSuperAdmin`

`gqlContextFactory.ts` populates (after `verifyAccessToken` + DB fetch):
- `ctx.user: RegistrationReturnType | null` — password-stripped, `preferredRecitation: null` on the me/login path.
- `ctx.safeUser: RegistrationReturnType | null` — alias for `ctx.user`.
- `ctx.role: UserRole | null` — from `toUserRole(payload.role)`. Invalid/tampered role claim yields `null` (anonymous treatment).
- `ctx.isSuperAdmin: boolean` — `role === UserRole.Admin`.
- `ctx.permissions: unknown[]` — currently `[]` (placeholder, deferred until wired to `PermissionsService.getUserContext`).

The `role` authScope evaluator consumes `ctx.role` directly — no DB refetch needed.

### 5.2 Wire the `permission` authScope

The current `permission: () => true` placeholder MUST be replaced by a fail-closed evaluator:

```typescript
permission: (perms: string[]) => {
  if (!ctx.user) return false;                    // fail-closed for anonymous
  if (ctx.isSuperAdmin) return true;              // superAdmin bypasses permission checks
  // replace with ctx.permissions (populated by PermissionsService.getUserContext)
  return perms.some(p => ctx.permissions.includes(p));
}
```

And in `gqlContextFactory.ts`, populate `ctx.permissions`:

```typescript
const permissionContext = await PermissionsService.getUserContext(payload.userId);
// ...
return {
  // ...
  permissions: permissionContext.permissions,
  // ...
};
```

The evaluator MUST fail-closed on `PermissionsService.getUserContext` throw:

```typescript
permission: (perms: string[]) => {
  if (!ctx.user) return false;
  if (ctx.isSuperAdmin) return true;
  try {
    return perms.some(p => ctx.permissions.includes(p));
  } catch (error) {
    logger.error({ caller: "permissionScope" }, "[Auth] permission scope evaluation failed", error);
    return false;                                 // fail-closed
  }
}
```

### 5.3 Implement `assertNotSuspended`

`AuthService.assertUserActive` currently denies ALL `suspended = true` accounts at login (fail-closed — stricter than the active-window contract). The lapsed-suspension helper for session-creation-class operations:

```typescript
// backend/services/auth/assert-not-suspended.ts (canonical service placement)
import { ForbiddenError } from "@/backend/lib/errors";
import { logger } from "@/backend/lib/logger";
import { getServerTranslations } from "@/shared/locale/server-graphql";

interface SuspendedUser {
  readonly suspended: boolean | null;
  readonly suspendedAt: Date | null;
  readonly suspendedPeriodDays: number | null;
}

/**
 * Throws ForbiddenError if the user is currently suspended (active window).
 * Allows if the suspension period has lapsed.
 * Allows if not suspended.
 */
export function assertNotSuspended(user: SuspendedUser, locale: string): void {
  if (!user.suspended) return;
  if (!user.suspendedAt || !user.suspendedPeriodDays) {
    // suspended=true but missing metadata — fail-closed (deny)
    throwSuspendedError(locale);
    return;
  }
  const suspensionEnd = new Date(user.suspendedAt.getTime() + user.suspendedPeriodDays * 24 * 60 * 60 * 1000);
  if (suspensionEnd > new Date()) {
    // active suspension window — deny
    throwSuspendedError(locale);
  }
  // lapsed suspension — allow
}

function throwSuspendedError(locale: string): never {
  const t = getServerTranslations(locale).errorsTranslations;
  logger.logDomainError("Suspended account denied", {
    code: "ACCOUNT_SUSPENDED",
    entity: "users",
    locale,
  });
  throw new ForbiddenError(t.accountSuspended);
}
```

The session-creation service consumes this helper to enforce the active-suspension-window deny on session-creation-class operations.

> **Note (DEV3-017):** The shared suspension-window predicate NOW EXISTS at `backend/lib/auth/suspension-window.ts#isSuspensionActive` and is consumed by login / `refreshToken` / SSR (`assertUserActive` + `getServerUserContext`). Session-creation gating remains the owning consumer (forward pointer — see D2). See `docs/admin/account-governance.md`.

### 5.4 SSR parity

`requireRoleForPage` is shipped alongside `requirePermissionForPage` / `withPageAuth`:

| Helper | Signature | Use case |
|---|---|---|
| `requirePermissionForPage(userId, perms, locale, context)` | (existing — substrate) | Permission-gated SSR pages |
| `withPageAuth({ roles?, redirectTo? })` | (JWT auth service) | Optional role-whitelist SSR pages |
| `requireRoleForPage(roles, redirectTo?)` | (JWT auth service) | Role-required SSR pages (sister to `requirePermissionForPage`) |

All three use the same redirect semantics: anonymous → `/login?redirect=...`; role/permission mismatch → `/dashboard` (canonical fallback).

### 5.5 Endpoint coverage rule

Every non-public GraphQL op declares at least `authScopes: { authenticated: true }`. Where applicable, `role` and/or `permission` scopes:

```typescript
// Public (no authScope):
login, refreshToken, logout, registerUser, _health, recitationReadings

// Authenticated only:
me (authScopes: { authenticated: true })

// Role-gated (example — admin CRUD):
someAdminMutation(authScopes: { role: [UserRole.Admin], permission: ["users.update"] })

// SuperAdmin-only (example — impersonation, permission-group editing):
someSuperAdminMutation(authScopes: { superAdmin: true, notImpersonating: true })
```

The schema-coverage assertion test introspects the built schema and asserts (a) the public set is exactly the unscoped set, (b) representative protected ops carry auth/scope, (c) NO mutation matching `grantRole*`/`assignRole*`/`elevate*` exists under any non-admin scope.

### 5.6 Role↔certification boundary

`role=teacher` does NOT imply certification. Certification remains `teacher.is_approved` and IS enforced by domain services. The `role` scope stops at role fit — it does NOT pretend to gate certification.

When implementing teacher surfaces:
- Use `{ role: [UserRole.Teacher] }` to gate teacher-only surfaces (applicant flows, teacher dashboard).
- Use a separate `is_approved` check (in the resolver or service layer) to gate certified-sheikh-only surfaces (session creation, recitation approval).

### 5.7 Deferred items

| Item | Owner |
|---|---|
| `permission` authScope wiring to `PermissionsService.getUserContext(ctx.user.id)` | Future work |
| `assertNotSuspended` helper implementation (active-suspension-window calculation) — shared predicate NOW EXISTS at `backend/lib/auth/suspension-window.ts` (consumed by login/refresh/SSR); this session-creation helper remains the owning consumer (forward pointer D2). See `docs/admin/account-governance.md`. | Session-creation work |
| Schema-coverage assertion test (`rbac-schema-coverage.test.ts`) | Test-runner environment unblock |
| GraphQL context factory fail-closed hardening for governed accounts | Defense-in-depth follow-up |

---

## 6. Shipped Surface Summary

- Token claims contract (access 15m + refresh 7d, HS256 via `jose`, `null`-on-failure verification).
- Cookie matrix (three httpOnly cookies, `SameSite=Strict`, `Secure` in production, cleared on logout).
- Redirect-loop fix (`access_token` set as httpOnly cookie for SSR).
- LoginForm double-login fix (calls `loginContext()` only).
- `me` 401 boundary (`authScopes: { authenticated: true }`).
- AuthProvider rethrow (login errors rethrown for granular error-code mapping).
- Governance gate (deleted/blocked/suspended denied with localized `FORBIDDEN`).
- scope-auth plugin loaded with five `AuthScopes`.
- SSR auth (`getServerUserContext` cached via `react.cache()`).
- Page guards (`withPageAuth`, `requireRoleForPage`).
- Role-based dashboards (`/student/dashboard`, `/teacher/dashboard`, `/parent/dashboard`, `/admin/dashboard`).
- `role` authScope contract (OR semantics, AND-composition with `permission`/`superAdmin`/`notImpersonating`, superAdmin composition preserved).
- SSR parity contract (`requireRoleForPage` next to `requirePermissionForPage` / `withPageAuth`).
- Endpoint role-coverage rule.
- Role↔certification boundary.
- No `grantRole*`/`assignRole*`/`elevate*` mutation exists (schema introspection confirms).

Deferred: server-side session store for JTI rotation; real rate limiter; `permission` scope wiring; `assertNotSuspended` helper; schema-coverage assertion test; GraphQL context factory fail-closed hardening.

---

## 7. Related Documents

- `docs/auth/REDIRECT_LOOP_FIX.md` — redirect-loop root cause + fix contract (the load-bearing detail behind the `access_token` httpOnly cookie).
- `docs/auth/REDIRECT_LOOP_FIX_OPENCODE2.md` — follow-up notes on the redirect-loop fix.
- `docs/auth/user-registration.md` — canonical reference for user registration (registration surface, role→child mapping, handshake generation, atomicity pattern, BOPLA/BFLA defenses, JWT auth flow tail).
- `docs/auth/qiraah-selection-and-c5.md` — canonical reference for Qira'ah selection and its registration contract invariant (`preferredRecitation` is contract metadata only, not persistence).
- `docs/auth/permission-architecture.md` — client-side permission architecture (3-tier model: server / container / element; wrapper removal rationale).
- `docs/auth/supervisor-permissions.md` — supervisor permission model (authScope pattern; `permission` vs `superAdmin` usage rule).
- `docs/auth/manager-role-mapping.md` — manager role mapping architecture + permission group slug convention.
- `docs/graphql/error-handling-contract.md` — `SERVICE_UNAVAILABLE` transport semantics, masking pipeline, envelope/client mapping (a dedicated login cold-start resilience doc does not exist in-tree; its fail-open limiter / `retryTransient` rule text lives in `backend/graphql/AGENTS.md` §Serverless Cold-Start Optimization).
- `docs/backend/serverless-cold-start-optimization.md` — permission context propagation, lazy scopeAuth, `safeUser` on `BaseContext`, session deduplication.
- `docs/graphql/domain-error-extensions-code.md` — DomainError → GraphQLError `extensions.code` propagation pattern (`UNAUTHORIZED` / `FORBIDDEN` / `SERVICE_UNAVAILABLE`).
- `docs/app/with-page-auth.md` — App router page auth wrapper pattern reference.
- `app/AGENTS.md` — SSR usage contract + page-level access-control table.
