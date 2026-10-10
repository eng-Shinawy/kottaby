# Input Validation & Injection Hardening

> **Canonical reference** for the platform's input-validation, injection-prevention, and request-hygiene discipline: SQL parameterization, LIKE-wildcard sanitization, HTML/CSV injection defense, CSRF, rate limiting, security headers, and authorization-integrity conventions.
>
> **Audience:** every contributor touching a repository method, a search filter, a CSV export, a GraphQL gateway guard, or an `authScopes` declaration. Every rule below is enforced by an executable lock — the cited test files fail the suite when a rule is violated, so "the tests won't let me" is the intended experience.

---

## 1. Why

Every hostile input in this threat model arrives as ordinary request data — a search box, a CSV cell, an HTTP header, a GraphQL document. None of the defenses below rely on rejecting "looks dangerous" input at the edge; instead each layer makes the *unsafe construction impossible*:

- **SQL injection** is prevented structurally: every query goes through Drizzle's builders or bound `sql``` templates, never string concatenation. Search wildcards (`%`, `_`, `\`) are sanitized at exactly one place so a user searching `100%` cannot silently widen into "every row starting with 100".
- **HTML/XSS injection** is prevented architecturally: React text nodes escape everything, and a static-lock suite fails the build if a raw-HTML sink ever appears in production code. CSV exports additionally defuse spreadsheet-formula triggers (`=`, `+`, `-`, `@`, TAB, CR) so a hostile name field cannot execute a formula on an admin's machine.
- **CSRF** is prevented at the transport tier: cookies are `SameSite=Strict`, the GraphQL POST path verifies same-origin *before* any parsing work, and non-browser clients (no `Origin`/`Sec-Fetch-Site`) pass through — they are not CSRF principals.
- **Resource exhaustion** is bounded at fixed checkpoints (body bytes, batched-operation count, auth attempts per IP and per identity) with spoof-resistant client-IP keying.
- **Authorization** fails closed: an unrecognized or unsatisfied scope denies, and anonymous callers always receive the 401 family before any role check can answer 403.

The rest of this document states each pattern, its rules, and the enforcement test that pins it.

---

## 2. Pattern

### 2.1 Parameterized queries — Drizzle's binding discipline

All data access goes through Drizzle: typed builders (`db.select().from(...).where(...)`), the `sql` template-literal binder (interpolated values become bind parameters), and `$N`-indexed placeholders in raw `queryDb` paths. User input never appears inside the SQL text itself.

**Enforcement — `test/config/sql-injection-static-locks.test.ts` Lock (a)** (scanner at `test/config/sql-injection-static-locks.test.ts:249`): zero `sql.raw(` occurrences across the production scan roots `backend/db/repo/**` and `backend/services/**` (test files and `__tests__/` directories are excluded corpora). The suite seeds synthetic `sql.raw(` fixtures to prove the scanner fires, and a corpus guard asserts the scanner is not regex-blind by requiring the two known dev-tooling call sites to still exist.

**Dev-tooling exemption (documented, bounded):** the only `sql.raw` call sites in the tree are the migration tooling `backend/db/scripts/runDrizzleMigrations.ts:116` and `backend/db/scripts/ensureIdempotentMigrations.ts:310` — both under `backend/db/scripts/`, outside the production scan roots, executing DDL statements that cannot be expressed as prepared statements. A corpus guard asserts both files exist, contain the call-form, and stay outside the scan roots; if they move, the lock fails and the boundary must be re-drawn deliberately.

**Hostile-payload proof pattern (the oracle to copy for new search surfaces):** the three service suites `backend/services/teachers/teacher-matching.service.test.ts`, `backend/services/admin/teacher-directory.service.test.ts`, and `backend/services/billing/admin-financial-auditing.service.test.ts` share a payload matrix (single-sourced in the test-only module `backend/services/shared/hostile-search-payloads.ts`) covering `'; DROP TABLE users; --`, ` Robert'); DROP TABLE students;--`, `%`, `_`, `\`, `100%`, `%admin%`, `a%b_c\d`, plus empty search, clamp boundaries, and Arabic/RTL text. For every payload, the suite proves three things:

1. **Match-set equality oracle** — the surfaced rows are exactly the rows whose searchable text literally contains the payload (verified against an independent `position()`-based substring oracle that shares no semantics with the LIKE path).
2. **No widening** — decoy rows that would surface under wildcard semantics (`1000` for `100%`, single-char swaps for `_`) never appear.
3. **Zero rows modified** — a `$count(...)` before and after every payload execution is identical: the injection strings reached the database only as bound parameters and executed nothing.

### 2.2 `escapeLikeWildcards` — the single LIKE/ILIKE sanitizer

PostgreSQL treats `%`, `_`, and `\` as wildcards/escapes inside `LIKE`/`ILIKE` patterns. Free-text search input must be sanitized **once, at exactly one place in the codebase**: `escapeLikeWildcards` at `backend/lib/db/escape-like-wildcards.ts:37`, which prefixes each `\`, `%`, and `_` with the default escape character (backslash first, so the added escapes are not themselves re-escaped).

**Flow: service escapes, repository binds.** The service layer calls `escapeLikeWildcards`, wraps the result as a `%…%` pattern, and passes it down; the repository binds the finished pattern verbatim to `ilike(column, pattern)` without re-escaping. Example pair: escape at `backend/services/billing/admin-financial-auditing.service.read.helpers.ts:150`, verbatim bind at `backend/db/repo/billing/student-payment.repository.ts:135`.

**Frozen ilike census — `test/config/sql-injection-static-locks.test.ts` Lock (b)** (`ILIKE_CENSUS` at `test/config/sql-injection-static-locks.test.ts:306`): every `ilike(` call site in `backend/db/repo/**` is pinned per-file at exact `[line, occurrenceCount]` — currently **8 files / 14 call-site lines / 19 call occurrences**:

| File | Pinned lines `[line] × occurrences` |
|---|---|
| `backend/db/repo/admin/academic-tracking.repository.ts` | `[119] ×2` |
| `backend/db/repo/admin/admin-user-query-helpers.ts` | `[100] ×1, [101] ×1, [104] ×1, [183] ×2` |
| `backend/db/repo/billing/student-payment.repository.ts` | `[135] ×1` |
| `backend/db/repo/notifications/broadcast.repository.ts` | `[138] ×1` |
| `backend/db/repo/students/student.repository.directory.helpers.ts` | `[103] ×2` |
| `backend/db/repo/teachers/applicant.repository.ts` | `[120] ×2` |
| `backend/db/repo/teachers/teacher.repository.directory.helpers.ts` | `[90] ×2` |
| `backend/db/repo/teachers/teacher.repository.matching.helpers.ts` | `[138] ×1, [139] ×1, [141] ×1, [142] ×1` |

A companion **bare-`like(` zero-lock** asserts no bare `like(` call site exists in the repository corpus either (`\blike\s*\(` — disjoint from the census regex because `ilike(`'s prefix letter blocks the word boundary). The scanner is string-aware: comment-stripped source is scanned, but **string and template-literal content is scanned verbatim** (an `ilike(` inside a string counts as a call site — fail-closed direction).

**How to extend the census correctly** when you add or move an `ilike(` call site in a repository:

1. Re-grep `\bilike\s*\(` over `backend/db/repo/**` (`.ts` files) — never trust memory or a plan-era count.
2. Freeze the new per-file `[line, occurrenceCount]` pins in `ILIKE_CENSUS` in the same changeset — the drift tripwire fails the suite otherwise, and that failure is the signal working, not noise. Line-number strictness is intentional: any edit that shifts a pinned line forces the pin through review.
3. Pass the raw search string through `escapeLikeWildcards` at the **service** layer before the repository sees it; the repository must bind, not sanitize.
4. Pin the negative direction too: if your new site's file previously appeared only in prose/docblock mentions, keep it that way — prose-only files are asserted to match the raw regex but not the stripped scan.

**Sanitizer exclusivity — Locks (c)/(d):** the suite also pins that `backend/lib/db/escape-like-wildcards.ts` is the ONLY definition site tree-wide, that no variant identifier (`escapeWildcard`/`escapeWildcards`/`LIKE_ESCAPE`) exists, that every caller imports from the canonical specifier, and that the module's own docblock keeps its exclusivity claim (`backend/lib/db/escape-like-wildcards.ts:26`).

### 2.3 No HTML sinks + CSV formula neutralization

**Architecture:** all user-supplied content renders through React text nodes (`Typography`, plain JSX text), which escape by construction. There is no `dangerouslySetInnerHTML`, no DOM `innerHTML` writes, no `document.write`, no `eval`, no `new Function`, and no `srcDoc` anywhere in the production corpus.

**Enforcement — `test/config/xss-static-locks.test.ts`** (sink patterns at `test/config/xss-static-locks.test.ts:154-161`): scans the full production corpus (`app/**` server components and `frontend/**` client components — both roots' contribution asserted; >1000 files) for **8 locked sinks**: `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write(`, `eval(`, `new Function(`, `srcDoc`. DOM property names are matched as word-bounded tokens (bracket access `el["innerHTML"]` is caught); `eval(`'s word boundary keeps benign look-alikes (`retrieval(`) silent — proven by fixture. The suite asserts zero violations on the live tree and fires every sink shape on synthetic fixtures.

**Documented lexical scope limits** (accepted, stated in the suite docblock): comments and string content count as matches (fail-closed — this is why production comments must not name sink tokens); bracket-form `eval`, bare `Function` without `new`, and the `.js` corpus sit outside the scanned roots. Extending the corpus is deliberate future work, not a silent widening.

**CSV formula injection (CWE-1236):** an exported cell opening with `=`, `+`, `-`, `@`, TAB, or CR can execute as a spreadsheet formula on import. `neutralizeCsvFormulas` at `frontend/utils/csv-formula.ts:8` is the **single implementation tree-wide**: it prefixes one `'` to any trigger-opening value, rendering it inert text. The guard is applied **at cell level, before quoting**, in every CSV cell builder:

| Builder | File |
|---|---|
| Conditional-quote cell builder (shared recipe) | `frontend/utils/csv-record.ts:22` (`csvCell` — defuse first, then the quote test runs on the defused value) |
| Teacher wallet ledger export | `frontend/views/teacher/wallet/walletLedgerCsv.ts` (always-quote recipe over the same guard) |
| Print/export dialog composition | `frontend/views/shared/print-export/print-export-csv.ts` |
| Admin directory CSV (delegates: students/applicants/teachers directories) | `frontend/views/admin/directory-shared/directory-csv.ts` |
| Platform analytics snapshot | `frontend/views/admin/analytics/platform-analytics-csv.ts` |

Coverage: `frontend/utils/csv-formula.test.ts` (25 tests — trigger branches, non-triggers incl. Arabic/RTL and `€`, idempotence, quoting interplay with both recipes), plus colocated golden-output suites per builder. BOM (`\uFEFF`) prefixing for Arabic label rendering is pinned byte-exact in the benign-path goldens.

**Client–server batch parity pin:** the first-party Apollo client pins `batchMax: 10` explicitly (`frontend/providers/apollo/AppApolloProvider.tsx:104`) to match the server's `MAX_GRAPHQL_OPERATIONS_PER_REQUEST`. The installed BatchHttpLink default is `0` = **unlimited** — never rely on it. The two values cannot share an import across layers (frontend never imports backend), so a source pin in `app/api/graphql/test/graphql-route.transport.test.ts` scans the client source for the literal and asserts it equals the imported server constant. An over-window client batch would dead-letter every request it sends with `400 BATCH_OPERATION_LIMIT`.

### 2.4 CSRF defense matrix

The threat: a victim's browser is tricked into a cookie-authenticated cross-site POST. Browser-forgeable metadata (`Origin`, `Sec-Fetch-Site`) is what the gates inspect — page script cannot strip or forge either header on a navigational/fetch request.

| Layer | Mechanism | Reference |
|---|---|---|
| Cookie SameSite | `access_token` / `refresh_token` / `session_id` serialized `HttpOnly; SameSite=Strict; Path=/` (Secure in production) — blocks cross-site sends outright | `backend/lib/auth/cookies.ts:197-201` (`serializeCookie`), `:35` (`AUTH_COOKIE_NAMES`), `:215` (`setAuthCookies`); cookie table in `docs/auth/jwt-authentication-service.md` |
| Method + content-type gates | GraphQL transport accepts POST + `application/json` only; violations answer the transport wire map before any parsing | `backend/lib/gateway/transport-guard.ts:91` (`assertAllowedMethod`), `:108` (`assertJsonContentType`); wire rows at `app/api/graphql/transport-rejection.ts:62-63` |
| Origin guard — first POST statement | Same-origin CSRF gate invoked BEFORE the transport guard; rejection → `403 FORBIDDEN` (localized `forbidden`), zero origin/body echo | `app/api/graphql/origin-guard.ts:62-84` (`assertGraphqlPostOrigin`), wired at `app/api/graphql/route.ts:182-184` |
| space-z preview allowlist | `space-z.ai` + `*.space-z.ai` origins allowed via URL parsing (no string-suffix tricks: `space-z.ai.attacker.com` rejected) | `app/api/graphql/space-z-cors.ts:14-21` (`SPACE_Z_DOMAIN`, `isAllowedSpaceZOrigin`) |
| WebSocket origin allowlist | Handshake requires an `Origin` header present in the allowlist set (from `WS_ALLOWED_ORIGINS` env or dev defaults); non-allowlisted origin is rejected before the socket upgrades | `backend/ws/notification-ws-server-handshake.ts:63-70`; allowlist getter `backend/lib/env.ts:523` |
| set-locale route | Cookie-mutating POST carries its own origin gate + method gate + a 4 KB dual body-size checkpoint (declared `content-length` then drained length) | `app/api/set-locale/route.ts:57` (`MAX_SET_LOCALE_BODY_BYTES = 4_096`), `:186` (declared gate), `:199` (drained gate) |
| Webhook HMAC | Server-to-server callbacks (Paymob) authenticate by HMAC-SHA512 over the canonical sorted payload — not cookies, hence not CSRF-exposed | `docs/billing/paymob-gateway.md:88-120` (HMAC verification discipline); `backend/services/billing/payment-gateway/paymob/paymob.hmac.ts` |

**The origin-guard decision ladder** (`app/api/graphql/origin-guard.ts:62-84`):

1. `Origin` absent → inspect `Sec-Fetch-Site`: `same-origin` or `none` pass; absent **passes** (see ruling below); anything else (`cross-site`, `same-site`, unknown values) → reject.
2. `Origin === request.nextUrl.origin` → pass.
3. `isAllowedSpaceZOrigin(origin)` → pass (URL-parse defense).
4. `getWebSocketAllowedOrigins().includes(origin)` → pass.
5. Anything else — including empty-string `Origin`, the literal string `null`, malformed unparseable origins, port-variant same-host origins, and suffix tricks → **403 `CROSS_ORIGIN_REJECTED`**.

**Missing-header ruling (documented decision):** a request with *neither* `Origin` nor `Sec-Fetch-Site` **passes** the origin tier. Bearer-header server clients and CLI tools send neither header; they carry no ambient cookies and therefore cannot be CSRF principals. The gate is identity-blind and pre-authorization by design — authentication and authorization happen downstream.

**Deployment note:** the `Origin === request.nextUrl.origin` comparison is `Host`-relative. A reverse proxy that lets clients float the `Host` header defeats the same-origin comparison, and one that passes client-supplied `x-real-ip` through defeats limiter keying (below). The proxy MUST overwrite `x-real-ip`, append `x-forwarded-for`, and pin/validate `Host` — the contract is documented in the `resolveClientIp` docblock and tracked in the launch checklist.

### 2.5 Rate-limiting topology

All limiters share one in-memory sliding-window store (`backend/lib/ratelimit.ts`): a module-private `windows` Map of request timestamps, LRU-bounded to `MAX_TRACKED_IDENTIFIERS = 10_000` (`backend/lib/ratelimit.ts:80`).

| Tier | Limiter / mechanism | Limit & window | Key derivation | Reference |
|---|---|---|---|---|
| GraphQL transport blanket | `withRateLimit` over `graphqlRateLimiter` | 100 requests / 60 s | `resolveClientIp` | `app/api/graphql/rate-limit.ts:39` (`withRateLimit`, invoked unconditionally at `app/api/graphql/route.ts:207`); config `backend/lib/ratelimit.ts:52` |
| Auth mutations — IP bucket | `enforceAuthMutationRateLimit` → `authIpLimiter` | 10 attempts / 60 s per client IP | `resolveClientIp` | `backend/lib/ratelimit.ts:66` (config), `:239` (enforcement helper) |
| Auth mutations — identity bucket | `enforceAuthMutationRateLimit` → `authIdentityLimiter` (module-private) | 20 attempts / 60 s per identity | `hashAuthIdentity` — sha-256 hex over `email.trim().toLowerCase()`; empty/whitespace-only digests to `""` (the "no identity bucket" sentinel → IP-only bucketing) | `backend/lib/ratelimit.ts:73` (config), `:166` (`hashAuthIdentity`) |
| Cron sweep surfaces | `enforceCronSweepRateLimit` over `cronSweepRateLimiter` | 100 / 60 s per client IP | `getClientIdentifier` (delegates to `resolveClientIp`) | `backend/lib/gateway/cron-endpoint.ts:79` (exported config), `:98` (shared helper) |
| Parent portal reads | `enforcePortalRateLimit` over `portalReadLimiter` | 30 / 60 s | `parent:<parentActorId>` (actor id, NOT the IP) | `backend/lib/ratelimit.ts:59` (config), `backend/services/parents/parent-monitoring.service.ts:144` (enforcement, wired on every portal read) |
| WebSocket handshakes | Per-IP handshake token bucket (burst capacity + interval refill, bounded tracked-IP map) | bucket capacity/refill (constant defaults) | client IP | `backend/ws/notification-ws-server-throttle.ts:22` (`tryAcquire`), fail-closed reject at `backend/ws/notification-ws-server-handshake.ts:75-84` |

**Client-IP resolution — `resolveClientIp` (`backend/lib/ratelimit.ts:129`), the single resolution site:** `x-real-ip` (trimmed, non-empty) first → **rightmost** comma-separated `x-forwarded-for` entry (trimmed, non-empty; comma-split only so IPv6 colons stay intact) → `"local"`. `getClientIdentifier` is a one-line delegation; the GraphQL context factory captures it once onto `ctx.clientIp` (limiting/correlation ONLY — never authorization). The leftmost XFF entry is client-forgeable and is never keyed; a forged leftmost prefix cannot mint a fresh bucket (pinned by spoof-probe tests in `backend/lib/ratelimit.test.ts`).

**Identity hygiene:** the plaintext email never reaches limiter keys or logs — keys are `auth-identity:<64-hex>`; enforcement logs carry the limiter name and client IP only. Casing/whitespace variants of one email share a single identity bucket (the hash folds trim + lowercase).

**Bucket ordering:** the IP bucket runs FIRST, the identity bucket second and only when `identity !== ""`. An IP flood cannot be laundered through identity rotation, and an IP rejection never consumes the identity bucket (pinned by invocation-count tests).

**Single-trusted-proxy assumption:** the keying is spoof-resistant only under an edge proxy that *overwrites* `x-real-ip` and *appends* `x-forwarded-for`. A proxy that passes client-supplied `x-real-ip` through lets any caller mint unlimited fresh buckets. Revisit (keying on rightmost-2, or a trusted-hop count) only if a second proxy hop is ever introduced.

**Honest limits (in-memory, per-instance — D2-class):** the store is per-instance and resets on restart; horizontal deployments do not share buckets. This is a deliberate interim — a shared store (Redis) remains deferred. Fail-open: a transient store failure must not block a legitimate request — `checkRateLimit`'s internal catch resolves `success: true` and emits a `logger.warn` carrying the limiter name and the error NAME only (`backend/lib/ratelimit.ts:214-219`), so fail-open is observable, never silent.

**Test-harness bypass with production guard:** both tiers skip enforcement when `TEST_CI=1` or `TEST_SERVER=1`, read at call time (never module scope). The bypass is mirrored byte-equivalently at the transport tier (`app/api/graphql/rate-limit.ts:48-56`) and the resolver tier (`backend/lib/ratelimit.ts:249-253`), and both throw a named error if either flag is set under `NODE_ENV=production` (the sanctioned `IS_DEMO=1` test server excepted) — a leaked test flag in production fails fast instead of silently disabling rate limiting. Pinned by dedicated tests in `backend/lib/ratelimit.test.ts`.

**Wire shape:** every 429 rides the shared envelope — `RateLimitExceededError` (`RATE_LIMIT_EXCEEDED`) + the localized `errorsTranslations.rateLimitExceeded` message (en/ar), carrying `requestId` correlation and never echoing the request.

### 2.6 Security-header inventory + CSP branch

Configured in `next.config.ts`, pinned byte-exact for both environment branches by `test/config/security-headers.test.ts` (`PRODUCTION_CSP`/`NON_PRODUCTION_CSP` constants, header-key order, restore pin):

| Header | Value | Reference |
|---|---|---|
| `X-Frame-Options` | `DENY` | `next.config.ts` (headers array) |
| `X-Content-Type-Options` | `nosniff` | `next.config.ts` |
| `Referrer-Policy` | strict policy | `next.config.ts` |
| `Permissions-Policy` | restrictive defaults | `next.config.ts` |
| `X-XSS-Protection` | `0` (legacy auditor disabled) | `next.config.ts` |
| `Strict-Transport-Security` | HSTS | `next.config.ts` |
| `Cross-Origin-Opener-Policy` | `same-origin` | `next.config.ts:83` |
| `Cross-Origin-Resource-Policy` | `same-origin` | `next.config.ts:87` |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' *.space-z.ai *.space-zai; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self';` | `next.config.ts:92` |
| `X-Powered-By` | suppressed (`poweredByHeader: false`) | `next.config.ts:18` |

**CSP branch:** `process.env.NODE_ENV` is read **at call time inside `headers()`** (`next.config.ts:54-57`) — production composes `script-src 'self' 'unsafe-inline'` (drops `'unsafe-eval'`), non-production keeps `'unsafe-eval'` for HMR/Fast Refresh. Production was smoke-verified dependency-free of eval: a production build boots and renders with an empty browser console under the eval-free policy. The call-time read (never module scope) is what makes both branches observable to the pinning test.

**No COEP (deliberate):** `Cross-Origin-Embedder-Policy` requires every cross-origin subresource to carry CORP/COOP headers or loading breaks. It stays excluded until a full third-party subresource audit exists — COOP + CORP are the two safe wins that shipped.

### 2.7 Authorization integrity

**Fail-closed `permission` scope.** The Pothos builder's `permission` scope is OR-membership over the caller's granted codes (`backend/graphql/pothos/builder.ts:156`): `codes.some(p => ctx.permissions.includes(p))`. An empty declaration denies (empty code sets never satisfy `some`), and `ctx.permissions` is currently always `[]`, so **any field declaring this scope denies loudly** with the localized `FORBIDDEN` (403 family) until a permission source populates the context. The historical always-allow placeholder (`() => true`) is gone — the latent silent-allow footgun is closed. Enforced by the fail-closed probe block in `backend/graphql/test/schema-surface.test.ts` (deny on missing code, deny on empty declaration, OR-pass on one granted code, BFLA probe: unrelated granted codes still deny).

**The `$all` conjunction rule (plain map = ANY semantics).** Per `backend/graphql/AGENTS.md:17`: when a role leg exists, the conjunction must be EXPLICIT — `authScopes: { $all: { authenticated: true, role: [UserRole.X] } }`. A plain key-map combines its keys with ANY semantics, and a bare `role: [...]` map answers **anonymous callers with FORBIDDEN (403)** instead of the platform-required 401 family — the wrong-403-for-anonymous bug class. The `$all` wrapper makes both legs mandatory: the `authenticated` leg answers anonymous callers with the localized `UNAUTHORIZED` before the role leg can fire.

Conforming surface today: the three plan-catalog mutations (`createPlan`/`updatePlan`/`setPlanActiveStatus` at `backend/graphql/mutation/plan-catalog.mutation.ts:32,66,115`), the `adminPlans` query (`backend/graphql/query/plan-catalog.query.ts:37`), and the three lesson mutations (`backend/graphql/mutation/classes/lesson.mutation.ts:37,71` and `deleteLesson`). Scope shapes are pinned by the `$all` snapshot pins in `backend/graphql/test/schema-surface.test.ts`, and anonymous/401-first behavior by the caller matrix in `backend/graphql/test/plan-catalog.roles.test.ts` (27 tests) and `lesson.roles.test.ts`.

**401/403 indistinguishability:** the 401 denial message is byte-identical across fields and locales (en/ar) — no field-existence oracle. The same discipline governs disclosure-sensitive objects (foreign id ≡ nonexistent id).

**Password bound agreement (set-time vs verify-time).** `MAX_PASSWORD_LENGTH = 1_024` (`backend/lib/auth/password-limits.ts:21`) is the single source for every credential surface: public registration, admin user creation, `changeMyPassword`, `adminSetUserPassword` (via `validatePasswordPolicy`), and the login-side bound in `backend/graphql/mutation/auth.mutation.ts:125`. The property is AGREEMENT: a password accepted at set-time must never be silently denied at login — bcrypt truncates at 72 bytes, so a >1 024-char login argument is payload hygiene (DoS bound), not a password policy. Set-time violations answer with the field-targeted localized `passwordTooLong` (`shared/locale/en/auth/index.ts:29`, `shared/locale/ar/auth/index.ts:29`); the login side folds into the generic invalid-credentials denial (no oracle on the wire).

**Known latent footgun — `notImpersonating`:** the builder's `notImpersonating: true` scope kind (`backend/graphql/pothos/builder.ts:160`) is a constant-true placeholder with zero consumers. When an impersonation surface lands, it must be flipped fail-closed (deny on the impersonating path) rather than trusted — recorded so the footgun is not forgotten.

---

## 3. Rules

**MUST**

- Build every query through Drizzle builders or the `sql` template-literal binder; user input is always a bind parameter.
- Route every free-text `ilike`/`like` search through `escapeLikeWildcards` at the service layer; the repository binds the finished `%…%` pattern verbatim.
- Update the `ILIKE_CENSUS` pins in the same changeset that adds/moves any `ilike(` call site (re-grep first; freeze per-line counts).
- Render all user content through React text nodes; apply `neutralizeCsvFormulas` cell-level in every CSV builder before quoting.
- Keep the client `batchMax` literal equal to `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` (the source pin enforces it).
- Invoke the origin gate as the first POST statement on any cookie-authenticated mutation route; reject with the machine kind + localized message, never echoing the request.
- Key limiter buckets via `resolveClientIp` / `hashAuthIdentity` — never a second resolver, never plaintext identity.
- Read `NODE_ENV` at call time inside `headers()` (both CSP branches stay observable).
- Declare `authScopes` with the explicit `$all` conjunction whenever a role leg exists.
- Use localized error copy everywhere a rejection reaches the wire (`errorsTranslations.*`, `ctx.t(...)`, or `getServerTranslations` per layer) — never hardcode user-facing strings.
- Cite the enforcing test path when documenting one of these disciplines, so future contributors find the lock.

**MUST NOT**

- No `sql.raw` in `backend/db/repo/**` or `backend/services/**` (the dev-tooling exemption under `backend/db/scripts/` is frozen and corpus-guarded).
- No second LIKE sanitizer, no variant-named escape helper, no repository-side re-escaping.
- No HTML sinks (the 8-token lock list); no production comment naming a sink token (string content is scanned verbatim).
- No reliance on `batchMax: 0` semantics — the installed default is **unlimited**, not "off".
- No leftmost-XFF keying (forgeable); no plaintext identity in limiter keys or logs.
- No `() => true` scope kinds (see the `notImpersonating` footgun above).
- No raw request echo (origin, headers, body fragments) in rejection envelopes.
- No COEP until the third-party subresource audit exists.

---

## 4. What NOT to do

**Do not write a second LIKE sanitizer.** A "small local escape" in a service or repository re-opens the wildcard-injection surface and fails Lock (c)/(d) of `test/config/sql-injection-static-locks.test.ts`. The single-helper contract exists because sanitizers diverge over time; the census exists because an un-escaped call site is invisible until it widens a search.

**Do not concatenate SQL, ever.** Not for a "quick filter", not for a dynamic ORDER BY, not in a service. If a query cannot be expressed with builders + `sql``` interpolation, stop and restructure — the static lock treats `sql.raw(` in production as a build failure, and the hostile-payload suites prove injected strings reach the database only as inert parameters.

**Do not render into an HTML sink.** If a component seems to need `dangerouslySetInnerHTML` or `innerHTML`, the content is either (a) not actually HTML (format it as text), or (b) trusted static markup that belongs in the component tree as JSX. The scanner does not distinguish intent; neither should you.

**Do not trust declared `content-length`.** Both body-size checkpoints exist because clients lie: the declared header is checked before reading the body, and the drained length is checked after (lying-small declared headers force the drained site). Mirror the dual-checkpoint sequence in any new body-reading route.

**Do not key rate limits on the leftmost XFF entry** — the caller controls that position. And do not add a second IP-resolution site; `resolveClientIp` is the only one, and context wiring captures it once.

**Do not log or key identity material in plaintext.** The sha-256 digest is the only identity form that may appear in a limiter key; logs carry limiter name + client IP (and error *names*, never messages, in fail-open paths).

**Do not declare a plain `authScopes` role map.** `{ role: [UserRole.Admin] }` alone answers anonymous callers with 403 — wrong family, and a field-existence oracle if messages ever diverge. Always `{ $all: { authenticated: true, role: [...] } }`.

**Do not widen the origin allowlist casually.** Every pass-arm beyond same-origin (space-z preview, WS allowlist) is a named, URL-parsed, membership-read-only check. String-suffix matching and "just add the domain to the list" both fail the suffix-trick tests.

**Do not add COEP** without the subresource audit — it breaks cross-origin image/font loading wholesale.

**Do not swallow rate-limiter failures silently.** Fail-open is the posture, but every fail-open path must emit its `logger.warn` — an invisible fail-open is indistinguishable from a removed limiter.

---

## 5. Rollout Summary

**What shipped:**

- **Guards:** same-origin CSRF gate ahead of the GraphQL transport guard; batched-operation cap (≤ 10) as the final transport checkpoint; 4 KB dual-checkpoint body cap on the set-locale POST; resolver-level auth rate limiting (IP 10/60 s + identity-hash 20/60 s) wired into `login`/`registerUser`/`refreshToken` with login email normalization; cron-sweep limiter parity on the Paymob reconciliation route; spoof-resistant `resolveClientIp` with a single context capture; shared password-length bound across all set/verify surfaces; fail-closed `permission` scope; `$all` conjunctions across the plan-catalog and lesson mutation surfaces; completed security-header set (COOP/CORP, `object-src`/`base-uri`/`form-action`/`worker-src`, prod `unsafe-eval` removal, `x-powered-by` suppression); CSV formula neutralization routed through every cell builder.
- **Static locks:** `test/config/sql-injection-static-locks.test.ts` (26 tests — `sql.raw` zero-tolerance, ilike census, sanitizer exclusivity, docblock truth, negative-fire fixtures), `test/config/xss-static-locks.test.ts` (8 tests — 8-sink zero-match over >1000 production files, synthetic-fire matrix), `test/config/security-headers.test.ts` (7 tests — both CSP branches byte-exact).
- **Suites:** transport wire-map (41), origin gate (29), set-locale (39), rate-limit core (24), auth-rate-limit on the built schema (15), hostile-search payload matrices in three service suites (73/33/32), CSV golden suites (25+4+3+3+2), schema-surface scope pins (130), plan-catalog roles (27).

**Review waves:** a mid-implementation architecture gate (three parallel reviewers over phases 1–3: five LOW findings, all fixed — bare-`like` companion lock, stripper string-content docblock, origin-test env hygiene, docblock truths, root-pin + batchMax parity pin) and a post-implementation wave (four reviewers: types/frontend/backend/security-probing — zero CRITICAL/HIGH ever raised; three fix waves closed every MEDIUM: fail-open logging, password-bound symmetry, lesson `$all`; all 30 adversarial probes held). The proxy-deployment contract, fixture debt, and the `notImpersonating` footgun are recorded as resolved-pointer ledger items.

**Accepted limits (deliberate, documented):** limiter keying is proxy-dependent (the edge must overwrite `x-real-ip`, append XFF, pin `Host`); limiter state is per-instance and resets on restart; per-identity throttling admits a victim-throttle tradeoff (a 60 s self-healing window bounds guessing without persistent lockout — persistent lockout awaits a product ruling); the XSS scanner's documented lexical scope (bracket-eval, bare `Function`, `.js` corpus) is fail-closed within what it scans; the identity hash does not NFC-normalize (normalization-equivalent preimages merely share buckets — the hash is an abuse-bound key, not an identity oracle); CSP retains `'unsafe-inline'` in `script-src` pending a nonce/`strict-dynamic` migration on dynamic rendering.

**Deferred work pointers:** the security-hardening plan's deferred-items ledger (`ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/deferred-items.md`, rows D1–D11) is the authoritative index of every forward-looking item — nonce CSP, shared-store rate limiting, persistent lockout, query-depth limiting, COEP, the real permission layer populating `ctx.permissions`, the `clientIp` required-field fixture migration, the `notImpersonating` fail-closed flip, and the edge-proxy launch-checklist pin. Each row names its owning stream and composition contract; nothing is silently dropped.

---

## 6. Related Documents

- `docs/billing/paymob-gateway.md` — webhook HMAC verification discipline (canonical).
- `docs/parents/monitoring-portal.md` — 401/403 indistinguishability and the denial-oracle posture.
- `docs/auth/jwt-authentication-service.md` — cookie storage, TTLs, and SameSite/Secure flags.
- `docs/auth/REDIRECT_LOOP_FIX.md` — dual token storage (React memory + httpOnly cookie) rationale.
- Enforcing tests: `test/config/sql-injection-static-locks.test.ts`, `test/config/xss-static-locks.test.ts`, `test/config/security-headers.test.ts`, `app/api/graphql/test/graphql-route.origin.test.ts`, `app/api/graphql/test/graphql-route.transport.test.ts`, `app/api/set-locale/test/set-locale-route.test.ts`, `backend/lib/ratelimit.test.ts`, `backend/graphql/test/auth-rate-limit.test.ts`, `backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/plan-catalog.roles.test.ts`.
