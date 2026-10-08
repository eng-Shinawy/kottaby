# Research: PRODUCTION_READINESS.md Section 4 — Security (rows 4.1.1–4.3.5)
Date: 2026-10-08

## Area

Authentication is a dual-token JWT architecture (`jose` HS256): 15-min access token (Bearer header, React memory, never a cookie by design) + 7-day refresh token (httpOnly `SameSite=Strict` cookie), with governance denial (deleted/blocked/suspended) enforced at login, refresh, SSR, and admin gates. Authorization is Pothos `scope-auth` (`authenticated`/`role`/`permission`/`superAdmin`/`notImpersonating`) with a strict 401-vs-403 mapping and a default-deny anonymous-operation allowlist; the `permission` scope is a placeholder that always passes. Passwords are bcryptjs (12 rounds), hashed before any transaction opens. Injection prevention rests on Drizzle parameterization plus a single canonical LIKE-escape helper; dedicated injection round-trip tests exist in repo suites. Security posture beyond that: 7 security headers pinned by config test, an in-memory sliding-window rate limiter at the GraphQL gateway (100/min/IP) plus a portal-read limiter — but NO login-specific limiter, NO CSRF token mechanism (posture = SameSite=Strict + POST-only route + CORS allowlist), NO GraphQL depth/complexity limit, and DB SSL is conditional on the connection string with `rejectUnauthorized: false`. Log hygiene is strong: a `redactLogContext` masking engine with a sensitive-key vocabulary, pinned by an 834-line security-abuse contract suite. The M4 "Security hardening: input validation & SQL injection prevention" ticket (TICKETS.md:2797, Dev 2) has real artifacts scattered across `test/config/`, `backend/lib/errors/test/`, `frontend/graphql/test/gateway/`, and repo/workflow suites — but no single consolidated battery, and its "CSRF protection" + "rate limiting on auth endpoints" acceptance criteria are the two weakest rows.

## Checklist → Codebase Mapping

| Row # | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 4.1.1 | JWT issued with correct user_id + role | `backend/lib/auth/jwt.ts:133-142` `signAccessToken` (sub=userId, role claim); `backend/lib/auth/jwt.test.ts:50-59` signs/verifies `{userId:42, role:"teacher"}`; wire `frontend/graphql/test/auth/auth.test.ts:222` login returns tokens | VERIFIED |
| 4.1.2 | RBAC enforced on all endpoints | `backend/graphql/pothos/builder.ts:127-147` authScopes (401 vs 403 mapped at source); `frontend/graphql/test/gateway/allowlist-coverage.test.ts:158` schema-unscoped ≡ PUBLIC_OPERATIONS, `:181` role-escalation mutation scan; `backend/lib/gateway/public-operations.ts` default-deny allowlist; wire FORBIDDEN probes `auth.test.ts:645`, `gateway.integration.test.ts:220` | VERIFIED (caveat: `builder.ts:142` `permission` scope is placeholder-always-true) |
| 4.1.3 | Expired tokens rejected | `backend/lib/auth/jwt.ts:140` exp set (15 min); jose `jwtVerify` rejects expired natively (`jwt.ts:152-154`); docblock claim `jwt.test.ts:7` — but NO test signs a past-exp token | PARTIAL |
| 4.1.4 | Tampered tokens rejected | `backend/lib/auth/jwt.test.ts:75-84` "returns null when verifying a tampered token"; `:87-96` cross-type replay rejection | VERIFIED |
| 4.1.5 | Passwords hashed, not plaintext | `backend/lib/auth/password.ts:10-21` bcryptjs genSalt(12)+hash; `backend/db/schema/users/users.ts:18` `password_hash varchar(255) notNull`; hash-before-tx `backend/services/auth/auth.service.ts:449-450` | VERIFIED |
| 4.1.6 | Soft-deleted/suspended/blocked denied | `backend/services/auth/auth.service.ts:117-141` `assertUserActive` (login `:199`, refresh `:270`); SSR fail-closed `backend/lib/auth/server-auth.ts:148-155`; predicate `backend/lib/auth/suspension-window.ts:46-56`; admin actor gate `backend/services/admin/admin-guards.helpers.ts:78-110`; journey `test/workflows/admin/account-governance.journey.test.ts:367,428,519` (login → ForbiddenError per state) | VERIFIED (note: `gqlContextFactory.ts:262-279` populates ctx.user for governed rows — denial is per-boundary/per-mutation, not ctx-level) |
| 4.2.1 | All API inputs validated | GraphQL type-system (v3 non-null defaults, `builder.ts:66-70`); email `shared/lib/email.ts:11-24` (ReDoS-safe, 254 cap); phone wire battery `auth.test.ts:511-600` (PHONE_INVALID/REQUIRED/TOO_LONG); password policy `backend/services/auth/auth.service.ts:444` + tests `backend/db/test/logic/auth/auth.service.test.ts:439-478`; zod only in 3 files (`shared/lib/country-code.ts`, `shared/lib/phone.ts`, `backend/types/classes/admin-session-governance.types.ts`) | PARTIAL (auth/admin surfaces proven; no exhaustive per-field audit of every mutation) |
| 4.2.2 | SQL injection prevented | Drizzle parameterized everywhere; `sql.raw` only in migration scripts (`backend/db/scripts/runDrizzleMigrations.ts:116`); LIKE escape `backend/lib/db/escape-like-wildcards.ts:37-41` consumed `backend/db/repo/admin/admin-user-query-helpers.ts:104`; round-trip proof `backend/db/test/repo/classes/report.repository.test.ts:279-300` ("Robert'); DROP TABLE reports;--" byte-identical); `backend/db/test/repo/students/student.repository.test.ts:249` garbage codes; hostile enum `test/workflows/notifications/admin-broadcast.journey.test.ts:669` | VERIFIED |

| 4.2.3 | XSS prevented (output encoding) | React auto-escaping; zero `dangerouslySetInnerHTML` in components (only `frontend/components/ui/CountrySelector.test.tsx:529` asserting its ABSENCE); CSP header `next.config.ts:74-77` (contains `'unsafe-inline' 'unsafe-eval'`); script-tag payloads through error producers `backend/lib/errors/test/security-abuse.contract.test.ts:20-23` (Tier 3); NO DOMPurify/sanitizer lib (grep returned nothing) | PARTIAL |
| 4.2.4 | CSRF protection in place | NO token-based CSRF validation (grep `csrf\|CSRF` → only posture comments). Actual posture: httpOnly `SameSite=Strict` cookies `backend/lib/auth/cookies.ts:160`; POST-only GraphQL route (`backend/lib/gateway/transport-guard.ts:37`, 405 on GET); CORS allowlist `app/api/graphql/rate-limit.ts:88-89`; `frame-ancestors 'none'` CSP | PARTIAL (checklist wording expects "CSRF token validation" — does not exist as such) |
| 4.2.5 | Rate limiting on auth endpoints | In-memory sliding window `backend/lib/ratelimit.ts:95-128`; gateway limit 100/min/IP `app/api/graphql/rate-limit.ts:56` + `graphqlRateLimiter` config `ratelimit.ts:37-41`; portal-read 30/min `backend/services/parents/parent-monitoring.service.ts:152`; mechanics tests `backend/lib/ratelimit.test.ts:38-89`. NO login-mutation-specific limiter, NO per-account lockout, fail-open posture (`ratelimit.ts:125-127`), TEST_CI/TEST_SERVER bypass with prod guard (`rate-limit.ts:34-48`); `@upstash/redis` in package.json:121 but ZERO backend usage (grep `@upstash` backend/ → nothing) | PARTIAL |
| 4.3.1 | Passwords hashed with bcrypt | `backend/lib/auth/password.ts:12` `BCRYPT_ROUNDS = 12` (bcryptjs); comment: ~250ms hash on commodity hardware | VERIFIED |
| 4.3.2 | No sensitive data in logs | `backend/lib/errors/error-masking/error-masking-redaction.ts:62-94` SENSITIVE_KEY_WORDS (token/password/secret) + nested-forest redaction; login email redaction `backend/services/auth/auth.service.ts:78-85`; abuse battery `backend/lib/errors/test/security-abuse.contract.test.ts:10-28` (Tier 1 PII/stack/SQL scan, Tier 2 token forests) | VERIFIED |
| 4.3.3 | Responses don't leak sensitive fields | `stripPasswordHash` `backend/services/auth/auth.service.ts:94-100` + context strip `backend/graphql/gqlContextFactory.ts:273`; wire pin "NO passwordHash anywhere in the response" `frontend/graphql/test/auth/auth.test.ts:374`; `maskInternalError` hides internals (`security-abuse.contract.test.ts:11-16`) | VERIFIED |
| 4.3.4 | DB connections use SSL/TLS | `backend/db/client.ts:42-46` `shouldUseSsl` (only when `sslmode=require` in URL or `*.neon.tech` host); `:157` `ssl: requiresSsl ? { rejectUnauthorized: false } : undefined` — encrypted but NOT cert-verified, and no SSL when connection string lacks sslmode | PARTIAL |
| 4.3.5 | Secrets via env, not hardcoded | Central config `backend/lib/env.ts` (`requireEnv`/`getEnv`, secrets resolution `:223+`); production fail-fast for JWT secrets `backend/lib/auth/jwt.ts:84-86,102-104`; `.env.example` 437 lines, placeholders only (`:41-42,151,211`); hardcoded-secret grep clean (only UI labels / empty form defaults); `PAYMENT_WEBHOOK_SECRET`/`CRON_SECRET` env-based (`env.ts:328-350`) | VERIFIED |

## Existing Coverage

| Test file | What it asserts |
|---|---|
| `backend/lib/auth/jwt.test.ts` | sign/verify payload correctness (userId+role), tampered → null, malformed → null, cross-type access/refresh replay rejection, explicit-vs-derived secrets, prod fail-fast, TTLs |
| `backend/lib/auth/server-auth.test.ts` | SSR boundary: anonymous on missing/empty/invalid token; fail-closed anonymous for deleted (:186), blocked (:190), suspended (:194) users; invalid role claim (:203); password stripped (:212) |
| `backend/lib/auth/suspension-window.test.ts` | fail-closed window predicate (corrupt data → indefinite; boundary `endsAt > now`) |
| `backend/lib/errors/test/security-abuse.contract.test.ts` | 5-tier battery: masked-output leak scanning (stacks/SQL/PII/env names), redactLogContext token forests, injection-shaped payloads via error channel, error-code fuzz, repeat-failure byte parity (834 lines) |
| `test/config/security-headers.test.ts` | pins all 7 headers (X-Frame-Options DENY, nosniff, CSP, HSTS preload, etc.) against `next.config.ts` |
| `frontend/graphql/test/gateway/allowlist-coverage.test.ts` | schema walk: zero unscoped ops beyond PUBLIC_OPERATIONS; every `grantRole*/elevate*` mutation admin-gated; allowlist ↔ schema bijection |
| `frontend/graphql/test/gateway/gateway.integration.test.ts` | POST-only 405s, malformed JSON 400 envelope, UNAUTHORIZED vs FORBIDDEN codes, no wildcard CORS, requestId echo |
| `frontend/graphql/test/auth/auth.test.ts` | login/refresh/logout wire contract; short password → VALIDATION; phone battery (invalid/empty/17-char); RBAC (student adminCreateUser → FORBIDDEN; unauth → UNAUTHORIZED); passwordHash leak pin |

| Test file | What it asserts |
|---|---|
| `test/workflows/admin/account-governance.journey.test.ts` | full governance lifecycle: suspend → login ForbiddenError (:367), block → login ForbiddenError (:428), soft-delete → login denied (:519), lapsed suspension login succeeds (:579), denial battery (non-admin/self-target/anonymous :659) |
| `backend/db/test/logic/auth/auth.service.test.ts` | changeMyPassword denials (wrong current, soft-deleted caller, vanished identity — same shape, no oracle), bcrypt 72-byte no-op guard, credential fence vs concurrent rotation, mid-flight soft-delete rollback |
| `backend/db/test/repo/classes/report.repository.test.ts:279-300` | SQL metacharacter/quote/unicode payloads round-trip byte-identical through parameterized insert |
| `backend/db/test/repo/students/student.repository.test.ts:249` | unicode/garbage codes pass through parameterized path harmlessly |
| `test/workflows/notifications/admin-broadcast.journey.test.ts:669` | hostile enum value `"role; DROP TABLE users"` rejected at validation boundary |
| `backend/lib/ratelimit.test.ts` | sliding-window mechanics: first-pass, block at limit, window reset, per-limiter key isolation |
| `backend/lib/gateway/transport-guard.test.ts`, `backend/lib/gateway/public-operations.test.ts`, `backend/lib/gateway/static-assertions.test.ts` | 2MB body cap, method allowlist, public-op exact-match semantics |
| `test/workflows/auth/registration-phone.journey.test.ts` | registration input validation journey incl. smuggled-field mass-assignment rejection (role/isBlocked NOT assignable, `:516-549`) |

## Gaps

1. **4.1.3 — no explicit expired-token test.** `jwt.test.ts:7` docblock claims "expired" coverage but no test signs a token with a past `exp` and asserts `null`. jose enforces `exp` internally, so the runtime behavior is near-certain — but the checklist demands a verified 401-on-expired. Needed: one test in `backend/lib/auth/jwt.test.ts` signing with `.setExpirationTime("-1h")` (or a TTL-override seam), plus optionally a wire test presenting an expired Bearer token.
2. **4.2.5 — no login/password-reset-specific rate limiting.** Only the gateway-wide 100/min/IP limiter applies to `login`. No per-account lockout, no password-reset limiter — and no password-reset (forgot-password) endpoint exists at all (grep `passwordReset|forgotPassword` → only `test/workflows/admin/admin-password-reset.journey.test.ts`, which is the admin-initiated flow). The limiter is in-memory (per-instance, resets on deploy) and fail-open. `@upstash/redis` is installed but unused.
3. **4.2.4 — no CSRF token validation.** The real posture (SameSite=Strict cookies, POST-only route, CORS allowlist, CSP frame-ancestors) is sound for a cookie-borne CSRF model but the checklist row as written ("Verify CSRF token validation") has nothing to verify. The launch plan must either re-word the row to verify the actual posture or add Origin/Referer validation middleware.
4. **GraphQL depth/complexity limits — MISSING.** Grep for `maxDepth|complexity` across `app/api/graphql/` + `backend/graphql/` returned only "defense in depth" comments. The only query-shape guard is the 2MB body cap (`backend/lib/gateway/transport-guard.ts:49`). A deeply-nested query is executable.
5. **`permission` authScope placeholder — `builder.ts:142` returns `true` unconditionally.** Any field declaring `authScopes: { permission: [...] }` today is effectively unguarded (allowlist-coverage walk would catch scopeless fields, but a permission-scoped field passes). Currently admin surfaces use `role`/`superAdmin`, so exposure is theoretical.
6. **4.3.4 — SSL conditional and not cert-verified.** `backend/db/client.ts:157` uses `rejectUnauthorized: false`; a plain `DATABASE_URL` without `sslmode=require` gets NO encryption. Production checklist execution must verify the prod connection string carries `sslmode=require` (and ideally enable CA verification).
7. **No centralized ctx-level governance denial.** A suspended/blocked user holding an unexpired access token (≤15 min) gets `ctx.user` populated (`gqlContextFactory.ts:262-279`); denial relies on per-mutation defense-in-depth gates (`admin-guards.helpers.ts`, session/class mutation re-asserts). Coverage is per-mutation, not systematic — a gap inventory of which mutations re-assert governance does not exist.
8. **4.2.1 — "all API inputs" unproven.** Validation is proven for auth/phone/password/admin-user surfaces; no exhaustive audit (or fuzz battery) covers every mutation input's length/format bounds.
9. **4.2.3 — no rendered-output XSS journey.** React escaping + CSP exist, but CSP allows `'unsafe-inline' 'unsafe-eval'` (`next.config.ts:76`) and no test renders a `<script>` payload through any view.

## Harness Recommendations

The launch plan should verify Section 4 through a mix of cheap unit additions and one consolidated workflow battery — locations follow repo layout:

1. **Expired-token pin (4.1.3)** — extend `backend/lib/auth/jwt.test.ts`: sign with a past expiration and assert `verifyAccessToken`/`verifyRefreshToken` return `null`. One test, no new files.
2. **Security launch battery** — create `test/workflows/security/security-launch.journey.test.ts` (new `test/workflows/security/` domain dir, mirroring `test/workflows/admin/` conventions): (a) RBAC matrix — for each `UserRole` value × representative op from each domain (admin, classes, parents, billing) assert 401 (anonymous) vs 403 (wrong role) vs success; (b) governance mid-token probe — suspend/block a user, then present their still-valid access token to an op that re-asserts governance, asserting the denial; (c) expired/tampered Bearer at the wire (extend the existing `testClient` pattern from `frontend/graphql/test/`).
3. **Rate limiting (4.2.5)** — add a `loginLimiter` config to `backend/lib/ratelimit.ts` and wire it at the login mutation (resolver-level `checkRateLimit(email+ip)` or gateway pre-check by operation name); cover in `backend/lib/ratelimit.test.ts` + one wire test honoring the TEST_CI bypass. If the launch wants distribution-safe limiting, wire the installed-but-unused `@upstash/redis` behind the existing `checkRateLimit` seam (contract already test-pinned).
4. **CSRF (4.2.4)** — do not invent a token mechanism for launch. Instead: (a) pin the existing posture with a config test asserting `SameSite=Strict` in `backend/lib/auth/cookies.ts` serialization + POST-only 405 behavior (both already asserted — extend `backend/lib/auth/cookies.test.ts` to pin the serialized flag string); (b) re-word the checklist row's verification to "cookie SameSite + method-restricted route + CORS allowlist verified".
5. **Depth/complexity** — smallest viable guard: reject bodies whose parsed query depth exceeds N at the transport tier (`backend/lib/gateway/transport-guard.ts` already the home) or adopt `graphql-depth-limit`/Pothos `maxDepth` in `app/api/graphql/route.ts`. Pin in `backend/lib/gateway/transport-guard.test.ts`.
6. **4.3.4 SSL probe** — `test/config/db-ssl.test.ts`: in a production-pinned env config, assert `shouldUseSsl` enables SSL for the configured `DATABASE_URL` and (recommended fix) flip `rejectUnauthorized` to a CA-verified setting; at minimum, launch checklist should verify prod `DATABASE_URL` carries `sslmode=require`.
7. **4.3.5 secrets scan** — a `scripts/security/scan-secrets.ts` (repo already has `scripts/` conventions) or a lint/CI grep gate for literal secret assignments; today's evidence is a manual grep — cheap to automate.
8. **Map M4 Dev-2 ticket sign-off** — the ticket's artifacts are the suites listed in Existing Coverage; the launch plan should reference them row-by-row rather than re-building (rows 4.2.2 → repo injection round-trips; 4.2.4/4.2.5 → the two PARTIAL rows needing the work above).

## Evidence Appendix

```ts
// backend/lib/auth/jwt.ts:152-156 — tamper/expiry/type rejection (verifyAccessToken)
const { payload } = await jwtVerify(token, secret, { issuer: JWT_ISSUER });
if (payload.type !== "access") { return null; }
```
```ts
// backend/services/auth/auth.service.ts:127-139 — governance denial (assertUserActive)
if (user.isDeleted || user.isBlocked || isSuspensionActive({ ... }, new Date())) {
  throw new ForbiddenError(message);
}
```
```ts
// backend/graphql/pothos/builder.ts:132-139 — 401-vs-403 RBAC boundary
authenticated: () => { if (!ctx.user) { throw new UnauthorizedError(...); } return true; },
role: (roles: UserRole[]) => (ctx.role ? roles.includes(ctx.role) : false),
```
```ts
// backend/graphql/pothos/builder.ts:141-142 — the placeholder gap
permission: () => true,   // always passes — NOT wired to a permission service
```
```ts
// backend/lib/db/escape-like-wildcards.ts:40 — canonical LIKE sanitizer
return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
```
```ts
// backend/db/client.ts:157 — conditional, unverified TLS (row 4.3.4 caveat)
ssl: requiresSsl ? { rejectUnauthorized: false } : undefined,
```
```ts
// backend/lib/auth/cookies.ts:160 — CSRF-relevant cookie posture (row 4.2.4)
return `${name}=${encoded}; HttpOnly; SameSite=Strict; Path=/${secure}; Max-Age=${maxAgeSeconds}`;
```
```ts
// app/api/graphql/rate-limit.ts:56 + backend/lib/ratelimit.ts:37-41 — the only auth-adjacent limiting
const { success, ... } = await checkRateLimit(identifier, graphqlRateLimiter); // 100/min/IP, gateway-wide
```
```ts
// backend/db/test/repo/classes/report.repository.test.ts:284 — injection round-trip fixture
"Robert'); DROP TABLE reports;--",
```
```ts
// backend/lib/errors/error-masking/error-masking-redaction.ts:62-67 — log redaction vocabulary
const SENSITIVE_KEY_WORDS: ReadonlySet<string> = new Set(["token", "password", ... "secret"]);
```
