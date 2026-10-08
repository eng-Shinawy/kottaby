# Requirements & Specification: Security Hardening — Input Validation & SQL Injection Prevention

> **Plan directory (verbatim — every header, ledger path, task id, and self-reference in this document uses this exact string):** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention`
> **Ticket:** `Security Hardening: Input Validation & SQL Injection Prevention` — Owner Dev 2, Milestone 4, 5 SP, blocked by all Milestone 1–3 tickets (`docs/planning/TICKETS.md:2798-2838`). Acceptance criteria: input validation on all endpoints, SQL-injection prevention (parameterized queries), XSS prevention (output encoding), CSRF protection, rate limiting on auth endpoints, security headers (CSP, X-Frame-Options, X-Content-Type-Options) — `TICKETS.md:2808-2817` (Gherkin) and test scenarios `:2820-2827`.
> **Grounding docs:** `docs/planning/PRODUCTION_READINESS.md` §4.2 "Input Validation & Injection Prevention" (`:191-199`, all rows `☐` unchecked — this plan is the closing stream) · `docs/billing/paymob-gateway.md` HMAC discipline §"Webhook signature verification" (`:88-120` — already shipped, re-locked only) · `docs/auth/jwt-authentication-service.md` (token/cookie contract) · `docs/planning/TICKETS.md:2798` (this ticket).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's Gherkin names six observable outcomes. Grep-verified current state shows four are already substantially shipped; the genuine build items are the gaps:
> - **"Security headers are set (CSP, X-Frame-Options, X-Content-Type-Options)" — PARTIALLY shipped.** `next.config.ts:48-85` already emits `X-Frame-Options: DENY` (`:54-55`), `X-Content-Type-Options: nosniff` (`:58-59`), `Referrer-Policy` (`:62-63`), `Permissions-Policy` (`:66-67`), `X-XSS-Protection: 0` (`:70-71`), CSP (`:74-77`), HSTS (`:79-80`); pinned by `test/config/security-headers.test.ts:14-23`. **Gaps this ticket closes:** CSP carries `'unsafe-inline' 'unsafe-eval'` in `script-src` with no `object-src`/`base-uri`/`form-action`/`worker-src` directives (`next.config.ts:76`); `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` are absent (verified: zero occurrences in the 88-line file); `X-Powered-By` is not suppressed (no `poweredByHeader` key). Nonce-based CSP requires a Next 16 `proxy.ts` (renamed from middleware — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`) and is **deferred** (D1).
> - **"SQL injection attempts are prevented (parameterized queries)" — SHIPPED, needs regression locks.** Every production query is a Drizzle builder call, a `sql\`\`` template with `${}` binds, or a `queryDb(text, params)` string whose only interpolations are `$N` placeholder indexes / module-constant fragments with values in the params array (e.g. `backend/db/repo/billing/student-payment.repository.ts:171`, executed `:431-438`). `sql.raw(` has zero production-runtime hits (only dev migration tooling: `backend/db/scripts/runDrizzleMigrations.ts:116` and `backend/db/scripts/ensureIdempotentMigrations.ts:310` — both outside the lock's scan roots; `scripts/dbActions/` has zero hits). LIKE/ILIKE wildcard discipline is centrally enforced via `escapeLikeWildcards` (`backend/lib/db/escape-like-wildcards.ts:37-40`) applied at 8 service escape points covering all 14 `ilike()` call-site lines across 8 repo files (full census in `plan.md` §5.15). **This ticket's obligation:** turn these verified facts into CI-enforced regression locks (static scans + payload tests), because today they are verified-by-audit only.
> - **"XSS attempts are prevented (output encoding)" — SHIPPED by architecture, three gaps.** Production has zero `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`<iframe>`/`srcDoc` sinks (repo-grep verified); React text-node auto-escaping is the entire defense (no sanitizer dependency exists, by design). **Gaps:** (a) three production components cite a "static scan" test that does NOT exist (`frontend/components/ui/NotificationDrawer.tsx:67`, `frontend/views/notifications/feed/NotificationRowContent.tsx:10`, `frontend/views/notifications/feed/NotificationRow.tsx:41` — repo-grep for the scanner returns only the CountrySelector negative assertion at `frontend/components/ui/CountrySelector.test.tsx:529`); (b) CSV formula neutralization exists in exactly ONE exporter (`neutralizeCsvFormulas` + `escapeCsv` at `frontend/views/shared/print-export/PrintExportDialog.tsx:36-42`) but is missing from every other cell builder — `frontend/views/teacher/wallet/walletLedgerCsv.ts:16-18` (free-form `description` cells at `:30`), `frontend/views/admin/directory-shared/directory-csv.ts:37` (whose docblock at `:23-27` explicitly says the guard is "intentionally not applied"), and `frontend/views/admin/analytics/platform-analytics-csv.ts:50` (the students/applicants exporters delegate into `directory-csv.ts`); (c) CSP `unsafe-inline`/`unsafe-eval` (covered by REQ-060).
> - **"CSRF protection is in place" — PARTIALLY shipped.** Auth cookies are `HttpOnly; SameSite=Strict` (`backend/lib/auth/cookies.ts:156-161`); the GraphQL gateway is POST-only with a JSON content-type gate (`backend/lib/gateway/transport-guard.ts:37-38`, `:67-68`, `:84-93`); GET/PUT/DELETE/PATCH return explicit 405 envelopes (`app/api/graphql/route.ts:227-246`); the WS handshake checks an origin allowlist first (`backend/ws/notification-ws-server-handshake.ts:62-70`); `/api/set-locale` has its own origin gate (`app/api/set-locale/route.ts:102-113`, enforced `:156-161`). **Gap:** the cookie-authenticated GraphQL POST path has NO Origin/`Sec-Fetch-Site` verification (`app/api/graphql/route.ts:165-213` — the POST pipeline is transport guards → rate limit → Apollo, zero origin vocabulary; repo-grep for `verifyOrigin|originCheck` finds only WS-side helpers). SameSite=Strict + POST/JSON gates are strong but incomplete (subdomain-attacker and stale-browser edge cases); the missing same-origin check is the genuine build item (REQ-040).
> - **"Rate limiting is enforced on auth endpoints" — NOT SHIPPED for auth.** The route-level limiter is REAL (not a stub — see stale-docs finding below): an in-memory sliding window enforcing 100 req/60 s per identifier (`backend/lib/ratelimit.ts:37-41`, enforcement `:95-128`, bounded 10 000-identifier LRU `:51`, `:65-74`) wired at `app/api/graphql/route.ts:188` via `withRateLimit` (`app/api/graphql/rate-limit.ts:25-94`, 429 envelope `:56-84`). But `login`/`registerUser`/`refreshToken` ride the SAME shared 100/min per-IP bucket as every other operation — there is NO auth-specific limit, NO per-identity (email) limit, and NO failed-attempt counter (repo-grep for `lockout|failedAttempts` finds only the unrelated parent-link re-submission lockout at `backend/services/parents/parent-link-request.service.ts:415`). **This is the ticket's headline build item (REQ-050).** Adjacent inconsistency: `app/api/cron/reconcile-paymob-payments/route.ts` is the ONLY cron route without a rate limit (the other three use the factory's `cronSweepRateLimiter` — `backend/lib/gateway/cron-endpoint.ts:79-83`, enforcement `:126-134`) → REQ-052.
> - **"All inputs are sanitized and validated" — SHIPPED at the service boundary, two transport gaps.** Input validation is systematically service-side by design (registration: `backend/services/auth/registration.service.ts:208` `validateInput`; session guards: `backend/services/classes/session-lifecycle.guards.ts:126-169`; shared canonical gates `shared/lib/phone.ts:30-35`, `shared/lib/country-code.ts:112-118`; resolver ID guards `backend/graphql/shared/resolver-guards.ts:19-27`, `:41-43`). Pothos runs only `WithInputPlugin` + `ScopeAuthPlugin` — no schema-level validation plugin, deliberately (`backend/graphql/pothos/builder.ts:101`). **Gaps:** (a) `/api/set-locale` POST has NO body-size cap — bare `request.json()` at `app/api/set-locale/route.ts:169` (the GraphQL route caps at 2 MB dual-checkpoint via `backend/lib/gateway/transport-guard.ts:49`; the Paymob webhook at 64 KB via `app/api/payments/webhook/route.ts:101`); (b) batched GraphQL operations are unbounded — `allowBatchedHttpRequests: true` (`app/api/graphql/apollo-server.ts:71`) with a self-documented amplification gap (`app/api/graphql/rate-limit.ts:52-54`) while the frontend uses `BatchHttpLink` (`frontend/providers/apollo/AppApolloProvider.tsx:98-99`); (c) `AuthService.login` passes the email untrimmed/unbounded to `UserRepository.findByEmail` (`backend/services/auth/auth.service.ts:172`, call `:175`) → REQ-011.
> - **Two authorization-layer footguns enter scope because a hardening ticket must not leave a known silent-allow in the guard layer:** (a) the `permission` authScope is a no-op placeholder — `permission: () => true` (`backend/graphql/pothos/builder.ts:142`, docblock `:34-36`, `:140-141`) while `ctx.permissions` is always `[]` (`backend/graphql/gqlContextFactory.ts:312`); zero production fields use it today (repo-grep verified), so flipping it to fail-closed is behavior-preserving and closes the trap where any new field following `backend/graphql/AGENTS.md:93-95` ships an unenforced gate; (b) `backend/graphql/mutation/plan-catalog.mutation.ts` declares `authScopes: { role: [UserRole.Admin] }` without the `$all { authenticated: true }` conjunction on all three fields (`:24-26`, `:55-57`, `:101-103`), deviating from the pinned 401/403 split convention — still fail-closed (anonymous gets 403 via `builder.ts:139` → `:124`), so this is a consistency fix, not a vulnerability.
> - **Documentation-truth defects enter scope because the plan's own evidence chain depends on them:** four docs claim the limiter is a "fail-open stub that always succeeds" — FALSE against current code (`backend/lib/ratelimit.ts:95-128` enforces): `app/api/graphql/rate-limit.ts:18-19` (docblock), `docs/billing/escrow-and-wallet-crediting.md:116`, `docs/parents/handshake-code-discovery.md:173` + `:197`, `docs/auth/qiraah-selection-and-c5.md:340`. Also `app/api/set-locale/route.ts:27` + `:72` reference a `proxy.ts` first-visit locale setter that does not exist (verified: no `middleware.ts`/`proxy.ts` in repo or git history) → REQ-080.
>
> **This ticket therefore ships exactly the slice it owns:** ONE new origin guard module for the GraphQL gateway, ONE new CSV formula-neutralization helper, TWO new transport-guard checks (set-locale body cap locally, batch-count cap in the shared guard), TWO new rate-limiter configs + a spoof-resistant client-IP resolver + a resolver-level auth enforcement helper, ONE context field (`clientIp`), TWO new TransportErrorKind members, security-header completion in `next.config.ts`, TWO authorization-guard consistency fixes, FOUR static-lock/payload regression suites, and documentation-truth hygiene. **No DB schema change, no GraphQL SDL change, no new routes, no UI.**

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

Close every gap in the platform's input-validation and injection-prevention posture: transport-tier request validation completed (set-locale body cap, batched-operation cap), SQL-injection and wildcard-injection facts converted from audit-verified to CI-enforced regression locks, XSS output-encoding locks made real (static sink scan + CSV formula neutralization), CSRF same-origin verification added to the cookie-authenticated GraphQL gateway, dedicated per-IP + per-identity rate limiting on the auth mutations, security headers completed (COOP, CORP, `X-Powered-By` suppression, CSP directive set + production `unsafe-eval` removal), and the two known authorization-guard footguns flipped to fail-closed/consistent.

### 1.2 Problem from user perspective

- **Attacker (unauthenticated):** can submit unlimited credential guesses against `login` — the only bound is the shared 100 req/min per-IP GraphQL window, and a rotating-IP attacker has no per-account bound at all (`backend/graphql/mutation/auth.mutation.ts:89-90` → `backend/services/auth/auth.service.ts:172`; failures are logged but carry no enforcement consequence, `auth.service.ts:178-195`).
- **Attacker (cross-site):** can attempt cross-site cookie-authenticated GraphQL POSTs; nothing at the gateway verifies the request's Origin (the sole structural defenses are SameSite=Strict cookies and the POST+JSON transport gates — `backend/lib/auth/cookies.ts:160`, `backend/lib/gateway/transport-guard.ts:37-38`).
- **Attacker (batch amplifier):** can pack an unbounded number of GraphQL operations into one ≤2 MB JSON array body — `allowBatchedHttpRequests: true` (`app/api/graphql/apollo-server.ts:71`) with the amplification guard self-documented as missing (`app/api/graphql/rate-limit.ts:52-54`).
- **Analyst opening an exported CSV:** a wallet ledger `description` cell like `=cmd|'/C calc'!A0` executes as a formula in Excel — every exporter quotes-doubles but none neutralizes formula prefixes (`frontend/views/teacher/wallet/walletLedgerCsv.ts:16-18`, free-form `description` at `:30`).
- **Maintainer:** docs claim the rate limiter is a stub (it is not), three components cite a scanner test that does not exist, and `backend/graphql/AGENTS.md:93-95` recommends a `permission` scope whose implementation silently always-allow passes — the codebase's security narrative cannot be trusted without re-auditing.

### 1.3 Business value

- Converts `docs/planning/PRODUCTION_READINESS.md` §4.2 (`:191-199`) from five unchecked `☐` rows into verified, test-pinned production readiness — a Milestone 4 launch gate.
- Closes the credential-guessing surface on the only public authentication entry point (`POST /api/graphql` → `login`/`registerUser`/`refreshToken`, the three brute-force-relevant members of `PUBLIC_OPERATION_NAMES` — four auth members total sit at `backend/lib/gateway/public-operations.ts:38-41`; `logout` is cookie-clear only).
- Makes the existing injection defenses (parameterized queries, `escapeLikeWildcards`, React text-node rendering) regression-proof instead of regression-prone: today a new `sql.raw(` or a new `dangerouslySetInnerHTML` would pass all quality gates.

---

## 2. Scope

### 2.1 In scope

| # | Slice | Evidence-driven rationale |
|---|-------|---------------------------|
| S1 | GraphQL same-origin guard (CSRF) — new `app/api/graphql/origin-guard.ts`, new `TransportErrorKind` member, wired first in the POST pipeline | No Origin vocabulary in `app/api/graphql/route.ts:165-213`; set-locale precedent `app/api/set-locale/route.ts:102-113` |
| S2 | Auth rate limiting — `authIpLimiter` + `authIdentityLimiter` configs, `resolveClientIp` hardening, `enforceAuthMutationRateLimit` helper, wired in the three public auth mutation resolvers; `clientIp` on GraphQL Context | No auth-specific limit exists; limiter infra reusable (`backend/lib/ratelimit.ts:95-128`) |
| S3 | Transport validation completion — `MAX_SET_LOCALE_BODY_BYTES` cap in the set-locale route; `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` batch cap in the shared transport guard + new `TransportErrorKind` member | `app/api/set-locale/route.ts:169` uncapped; `app/api/graphql/apollo-server.ts:71` + `app/api/graphql/rate-limit.ts:52-54` |
| S4 | Security headers completion — COOP, CORP, `poweredByHeader: false`, CSP `object-src`/`base-uri`/`form-action`/`worker-src` additions, production-only removal of `script-src 'unsafe-eval'`; test pin update | `next.config.ts:48-85` gaps verified; `test/config/security-headers.test.ts:14-23` pin extended |
| S5 | XSS locks — new `test/config/xss-static-locks.test.ts` (dangerous-sink source scan) + EXTRACT the existing `neutralizeCsvFormulas` (`frontend/views/shared/print-export/PrintExportDialog.tsx:36-42`) into `frontend/utils/csv-formula.ts` and apply it to the three unguarded cell builders | Scanner cited but absent; only 1 of 4 cell-builder sites neutralizes formulas |
| S6 | SQLi locks — new `test/config/sql-injection-static-locks.test.ts` (`sql.raw` zero-tolerance + `ilike` census pin + single-sanitizer pin) + hostile-payload service tests through representative search paths | Facts audit-verified only today; precedent `backend/services/parents/parent-link.static-locks.test.ts:373-397` |
| S7 | Authorization-guard integrity — `permission` scope fail-closed (`builder.ts:142`); plan-catalog `$all` conjunction fix (3 fields) | Silent-allow placeholder + 401/403 convention deviation |
| S8 | Cron rate-limit parity — wire `cronSweepRateLimiter` into `app/api/cron/reconcile-paymob-payments/route.ts` | Sole cron route without a limiter (factory: `backend/lib/gateway/cron-endpoint.ts:79-83`) |
| S9 | Documentation truth hygiene — 4 stale "stub limiter" claims, 2 stale `proxy.ts` references, PRODUCTION_READINESS §4.2 check-off with verification references, canonical doc under `docs/security/` | Verified false claims listed in the header reconciliation |

### 2.2 Out of scope (each with a ledger pointer — see `deferred-items.md`)

- Redis-backed / cross-instance rate limiting (`@upstash/redis` declared at `package.json:121`, zero code consumers — `backend/services/redis/` holds only a README) — D2.
- Nonce/`strict-dynamic` CSP via Next 16 `proxy.ts` (requires dynamic rendering; canonical path per `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:36-52`) — D1.
- Persistent per-account lockout (failed-attempt counters in the DB) — DoS-sensitive design, needs its own product ruling — D3.
- GraphQL query depth/complexity ValidationRule framework — D4 (batch cap here is the bounded first step).
- COEP (`Cross-Origin-Embedder-Policy`) — requires CORP/COOP on every third-party subresource; risk of breaking image/font loading — D5.
- Populating `ctx.permissions` from a real permission layer (`PermissionsService.getUserContext`) — the fail-closed flip in S7 is the safe interim — D6.
- Server actions origin checks (zero server actions exist — repo-grep `"use server"` → 0 production hits) — not applicable, no ledger item.
- Webhook HMAC verification (already shipped + tamper-tested: `backend/services/billing/payment-gateway/paymob/paymob.hmac.ts:107-114`, mock branch `backend/services/billing/payment-gateway/webhook-signature.helpers.ts:34-44`, journeys `test/workflows/billing/paymob-purchase-journey.test.ts:739-786`) — re-locked by S6 payload suite only, no code change — D7 (no-op pointer).

- Any DB schema change, GraphQL SDL change, codegen run, new route file, new locale namespace, or UI change — exclusions-by-design (REQ-090).

---

## 3. Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want an error baseline and a persistent outcome record, so that new issues are distinguishable from pre-existing ones and prior research is never repeated.

**Acceptance Criteria:**
1. WHEN implementation begins THEN system SHALL record baseline error counts (`bun tsgo` error count, `bun biome:check` warn count, `bun run scripts/lint-service.ts --json --id baseline`) to `/tmp/baseline-*.txt` files.
2. WHEN implementation begins THEN system SHALL treat `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/deferred-items.md` as the live ledger for every deferral.
3. WHEN an executing agent starts any task THEN system SHALL read ALL existing files in `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/` first.
4. WHEN an executing agent completes any task THEN system SHALL write `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/<task-id>-outcome.md`.
5. WHEN any file is modified THEN system SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file before moving on.
6. WHEN any subtask is marked `[x]` THEN system SHALL have completed the semantic review checklist first (sub-loop covers mechanical checks only).

**Priority:** High · **Complexity:** Low · **Dependencies:** none.

### REQ-002: Localized Security-Error Vocabulary (reuse-only)

**User Story:** As a user receiving a security rejection, I want a localized, non-revealing message, so that I am not handed an oracle and Arabic/English parity holds.

**Acceptance Criteria:**
1. WHEN any new rejection path added by this plan fires THEN system SHALL emit an already-existing localized message: `errorsTranslations.rateLimitExceeded` (`shared/locale/en/errors/index.ts:9`, type slot `shared/locale/types/errors/labels.ts:108`, Arabic sibling `shared/locale/ar/errors/index.ts`), `errorsTranslations.forbidden` (used at `backend/graphql/pothos/builder.ts:124`), `errorsTranslations.badRequest` (used at `app/api/graphql/transport-rejection.ts`), or `errorsTranslations.invalidOrigin` (`shared/locale/en/errors/index.ts:15`, used at `app/api/set-locale/route.ts:157`).
2. WHEN this plan adds any user-facing string THEN system SHALL add NO new locale namespace and NO new translation keys (verified: every needed key exists).
3. WHEN a rejection fires THEN system SHALL NOT echo the offending input, origin value, identity, or limiter key back to the client (matches the transport contract at `backend/lib/gateway/transport-guard.ts:10-12` and the constant-denial oracle at `docs/parents/monitoring-portal.md:99-112`).

**Priority:** Medium · **Complexity:** Low · **Dependencies:** none.

### REQ-010: Transport-Tier Input Validation Completion

**User Story:** As the platform, I want every request body bounded at the transport tier, so that no unbounded parse surface exists on any route.

**Acceptance Criteria:**
1. WHEN a POST hits `/api/set-locale` whose declared `content-length` exceeds the new cap or whose drained body exceeds the cap THEN system SHALL reject with the localized BAD_REQUEST envelope BEFORE JSON parsing (mirroring the dual checkpoint at `backend/lib/gateway/transport-guard.ts:145-151`, `:161-164`) — new module-local constant `MAX_SET_LOCALE_BODY_BYTES` (4 096 — a locale payload is `{ "locale": "en" }`).
2. WHEN a GraphQL POST body is a JSON array with more than `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` (10) operations THEN `guardTransport` SHALL reject with the new kind `BATCH_OPERATION_LIMIT` mapped to a 400 BAD_REQUEST envelope, BEFORE the engine and rate limiter are reached.
3. WHEN the frontend `BatchHttpLink` sends a legitimate batch THEN system SHALL accept arrays up to the cap without behavior change — the installed client's `batchMax` DEFAULT is `0` = unlimited (`node_modules/@apollo/client/link/batch/batchLink.js:36`), so the implementing task MUST set an EXPLICIT `batchMax: 10` on the `BatchHttpLink` construction (`frontend/providers/apollo/AppApolloProvider.tsx:99`) and the server cap SHALL equal that explicit client setting (server cap ≥ client cap would otherwise be unsatisfiable against an unlimited default, and a dashboard-mount query burst would break against a lone server cap).
4. IF the body is a single JSON object THEN the batch cap SHALL NOT alter any existing behavior (`guardTransport` passes non-array bodies through — `backend/lib/gateway/transport-guard.ts:167`).
5. WHEN either new rejection fires THEN the response SHALL carry the request correlation id and a localized message, reusing the existing `transportRejectionResponse` machinery (`app/api/graphql/transport-rejection.ts`).

**Priority:** High · **Complexity:** Medium · **Dependencies:** REQ-002.

### REQ-011: Auth-Mutation Input Normalization & Enforcement Order

**User Story:** As the auth surface, I want credential arguments normalized and bounded before any DB work, so that probing costs are contained and no pathological input reaches the repository.

**Acceptance Criteria:**
1. WHEN `login` executes THEN the resolver SHALL pass a trimmed email and a password whose length is capped (≤ 1 024 characters) into `AuthService.login` — bounded BEFORE the `UserRepository.findByEmail` call (`backend/services/auth/auth.service.ts:175`) and before bcrypt compare.
2. IF the trimmed email is empty or the password is empty THEN system SHALL reject with the existing localized invalid-credentials path (no new error shape; `auth.service.ts:178-183` already fails closed on unknown user).
3. WHEN `registerUser` or `refreshToken` execute THEN system SHALL apply no new normalization (registration validates service-side at `backend/services/auth/registration.service.ts:208`; `refreshToken` already trims at `backend/graphql/mutation/auth.mutation.ts:123`).
4. WHEN any auth mutation rejects THEN system SHALL NOT log the raw password or the raw identity key in plaintext (log via existing `redactEmail` — `backend/services/auth/auth.service.ts:77-85` pattern).

**Priority:** Medium · **Complexity:** Low · **Dependencies:** REQ-050 (enforcement order — see REQ-050 AC4).

### REQ-020: SQL-Injection Regression Locks (Parameterized Queries)

**User Story:** As the platform, I want the parameterized-query discipline machine-enforced, so that a future `sql.raw(` or string-concatenated query cannot merge silently.

**Acceptance Criteria:**
1. WHEN CI runs THEN a new static-lock test (`test/config/sql-injection-static-locks.test.ts`) SHALL fail if any production file under `backend/db/repo/**` or `backend/services/**` (excluding `*.test.ts`) contains `sql.raw(` — codifying the today-zero state verified by audit.
2. WHEN CI runs THEN the same test SHALL pin the current `ilike()` call-site census (8 repo files / 14 call-site lines / 19 call occurrences — enumerated in `plan.md` §5.15, which is the single source of truth for the lock) so a NEW `ilike(` call site outside the pinned set fails the lock and forces an explicit escape-discipline review; the lock SHALL state its counting semantics (comment/docblock prose matches MUST be excluded by a comment-stripping scan or explicitly pinned per file — the precedent pins docblock mentions lexically, `backend/services/parents/parent-link.static-locks.test.ts:395-397`).
3. WHEN CI runs THEN the same test SHALL pin `backend/lib/db/escape-like-wildcards.ts` as the single sanitizer (zero competing `escapeLike`-named implementations — today verified 58 references all pointing at the one module).
4. WHEN hostile payloads run through representative search service entry points (teacher matching `search` arg → `backend/services/teachers/teacher-matching.service.ts:243`; admin teacher directory → `backend/services/admin/teacher-directory.service.ts:70`; admin student-payments audit → `backend/services/billing/admin-financial-auditing.service.read.helpers.ts:150`) THEN payload tests SHALL assert literal-match-only behavior (`'; DROP TABLE users; --`, `%`, `_`, `\` variants), following the Tier-4 precedent at `backend/db/test/logic/admin/admin-user.repository.test.ts:1317-1338`.
5. IF any existing injection-shaped test asserts on the same surfaces THEN the new tests SHALL extend rather than duplicate (7 existing `injection`-grep files verified — e.g. `backend/db/test/repo/teachers/teacher.repository.test.ts:598`).

**Priority:** High · **Complexity:** Medium · **Dependencies:** REQ-002 (localized assertions use translated substrings per `backend/db/test/AGENTS.md:44`).

### REQ-021: LIKE/ILIKE Wildcard-Escape Discipline Enforcement

**User Story:** As a maintainer adding a future search surface, I want CI to force me through the canonical escape, so that wildcard widening cannot regress.

**Acceptance Criteria:**
1. WHEN a new `ilike(`/`like(` construction appears in `backend/db/repo/**` outside the census pin THEN the static-lock test SHALL fail (extending the pattern proven at `backend/services/parents/parent-link.static-locks.test.ts:373-397`, `:601-612`).
2. WHEN the escape helper is consumed THEN services SHALL keep the existing contract: escape + `%…%` wrap at the service, verbatim bind at the repo (`backend/lib/db/escape-like-wildcards.ts:20-24`).
3. IF the plan's payload tests pass THEN every tested search surface SHALL treat `%`, `_`, `\` as literals, never as wildcards.

**Priority:** Medium · **Complexity:** Low · **Dependencies:** REQ-020 (same test module).

### REQ-030: XSS Output-Encoding Locks

**User Story:** As the platform, I want the no-HTML-sink architecture machine-enforced and spreadsheet injection closed, so that XSS cannot re-enter through a future raw-HTML sink or a CSV export.

**Acceptance Criteria:**
1. WHEN CI runs THEN a new static-lock test (`test/config/xss-static-locks.test.ts`) SHALL fail if any production file under `app/**` or `frontend/**` (excluding `*.test.ts(x)`, `*.stories.tsx`, generated dirs) contains `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write(`, `eval(`, `new Function(`, or `srcDoc` — codifying today's verified zero-sink state.
2. WHEN the lock exists THEN the three production comments citing a "static scan" SHALL be updated to reference the real test path (comments at `frontend/components/ui/NotificationDrawer.tsx:67`, `frontend/views/notifications/feed/NotificationRowContent.tsx:10`, `frontend/views/notifications/feed/NotificationRow.tsx:41` — without citing plan artifact ids in code comments).
3. WHEN any CSV export builds cells THEN the EXISTING formula-neutralization implementation (`neutralizeCsvFormulas` at `frontend/views/shared/print-export/PrintExportDialog.tsx:36-42` — prefixes `'` on `=`, `+`, `-`, `@`, tab, CR) SHALL be extracted verbatim into `frontend/utils/csv-formula.ts` as the single shared helper, and the three unguarded cell builders SHALL route through it: `frontend/views/teacher/wallet/walletLedgerCsv.ts:16-18` (`csvCell`), `frontend/views/admin/directory-shared/directory-csv.ts:37` (`csvCell`, + docblock update at `:23-27` which today says the guard is "intentionally not applied"), `frontend/views/admin/analytics/platform-analytics-csv.ts:50` (`csvCell`) — the students/applicants exporters delegate into `directory-csv.ts` and are covered transitively; `PrintExportDialog.tsx` imports the shared helper instead of its local copy (zero duplicated logic).
4. WHEN a cell value is neutralized THEN CSV quoting behavior SHALL remain unchanged (quote-doubling preserved; the `'` prefix is added inside the quoted cell).
5. IF a value does not start with a formula trigger THEN `neutralizeCsvFormula` SHALL return it byte-identical (pure function, idempotent).

**Priority:** High · **Complexity:** Medium · **Dependencies:** none.

### REQ-040: CSRF Same-Origin Verification on the GraphQL Gateway

**User Story:** As an authenticated user's browser, I want cross-site GraphQL POSTs rejected before reaching the engine, so that my httpOnly cookies cannot be replayed from an attacker page.

**Acceptance Criteria:**
1. WHEN a GraphQL POST carries an `Origin` header that is neither the request's own origin, a `*.space-z.ai` origin (reuse `isAllowedSpaceZOrigin` — `app/api/graphql/space-z-cors.ts:21-31`), nor a `WS_ALLOWED_ORIGINS` entry (`backend/lib/env.ts:523`) THEN system SHALL reject with a 403 envelope carrying the new `TransportErrorKind` member `CROSS_ORIGIN_REJECTED` and the localized `errorsTranslations.forbidden` message, BEFORE the body is drained.
2. IF the `Origin` header is absent THEN the request SHALL pass (non-browser clients — server-to-server, CLI, the test `HttpLink` — do not send Origin and are not CSRF-capable), and IF `Origin` is absent but `Sec-Fetch-Site` is present and not `same-origin`/`none` THEN system SHALL reject (mirrors `app/api/set-locale/route.ts:109`).
3. WHEN the guard passes THEN no existing legitimate flow SHALL change (same-origin browser Apollo clients, `*.space-z.ai` preview panels with credentialed CORS — `app/api/graphql/space-z-cors.ts:39-40` — and Bearer-header clients all pass).
4. WHEN the guard rejects THEN the OPTIONS preflight handler (`app/api/graphql/route.ts:137-139`) and the WS handshake origin allowlist (`backend/ws/notification-ws-server-handshake.ts:62-70`) SHALL be untouched.
5. WHEN the guard runs THEN it SHALL be pure (fixed allowlists, no identity reads, no module-level mutable state — matching the transport-guard module contract at `backend/lib/gateway/transport-guard.ts:4-10`).

**Priority:** High · **Complexity:** Medium · **Dependencies:** REQ-002.

### REQ-050: Auth-Endpoint Rate Limiting

**User Story:** As the platform, I want credential-guessing on `login`/`registerUser`/`refreshToken` bounded per-IP AND per-identity, so that both distributed and targeted brute-force are contained.

**Acceptance Criteria:**
1. WHEN any of the three public auth mutations executes THEN the resolver SHALL first enforce a dedicated per-IP sliding window (`authIpLimiter`, 10 requests / 60 s — new config in `backend/lib/ratelimit.ts`) keyed on `ctx.clientIp`, reusing `checkRateLimit` (`backend/lib/ratelimit.ts:95-128`).
2. WHEN `login` or `registerUser` executes with a non-empty identity THEN the resolver SHALL additionally enforce a per-identity window (`authIdentityLimiter`, 20 requests / 60 s) keyed on `sha256(trimmed + lowercased email)` — the identity key MUST be a hash so no plaintext email rests in the limiter Map, and MUST never be logged in plaintext.
3. WHEN either window is exhausted THEN system SHALL throw the existing localized `RateLimitExceededError` (`backend/lib/errors.ts:186`) which the boundary finalizer passes through with code `RATE_LIMIT_EXCEEDED` → 429 family (`backend/lib/errors/error-code-taxonomy.ts:48`, `:60`) — the frontend already maps it to `RetryableNotice` (`frontend/AGENTS.md:66`).
4. WHEN enforcement runs THEN the order SHALL be: resolver-level auth limiter BEFORE `AuthService.login` input normalization and any DB/bcrypt work, so exhausted buckets cost zero hashing CPU.
5. IF `refreshToken` executes THEN the identity bucket SHALL be skipped (IP-only) — the refresh token argument is secret material and MUST NOT become a limiter key.
6. WHEN enforcement state accumulates THEN it SHALL live in the same bounded 10 000-identifier LRU Map (`backend/lib/ratelimit.ts:51`, `:65-74`) — no new unbounded module-level state.
7. WHEN tests run THEN the limiter MUST be resettable via the existing `clearRateLimitStore()` (`backend/lib/ratelimit.ts:131-133`) for IN-PROCESS suites, and — because live-server suites (`testClient` against the shared dev server, one process, one `windows` Map, no cross-process reset) would otherwise flake once their traffic exceeds the 10/60 s IP bucket — `enforceAuthMutationRateLimit` SHALL mirror the transport tier's sanctioned test-harness bypass (`TEST_CI`/`TEST_SERVER` skip with the identical production guard throw, `app/api/graphql/rate-limit.ts:34-48`), while dedicated in-process tests exercise the real enforcement path directly (unit suite + in-process schema execution).
8. IF an attacker exhausts a victim identity's 20/min window THEN the victim SHALL still be able to log in after the 60 s window elapses — sliding-window semantics, no persistent lockout (D3 documents the DoS tradeoff explicitly).

**Priority:** High · **Complexity:** Medium · **Dependencies:** REQ-051 (clientIp resolution), REQ-002.

### REQ-051: Spoof-Resistant Client-Identifier Resolution

**User Story:** As the rate limiter, I want the hardest-to-spoof IP signal available, so that rotating forged `X-Forwarded-For` values cannot mint fresh buckets.

**Acceptance Criteria:**
1. WHEN resolving a client identifier THEN `backend/lib/ratelimit.ts` SHALL prefer `x-real-ip` (proxy-set), then the RIGHTMOST (last) comma-separated value of `x-forwarded-for` (the hop nearest our own proxy), then fall back to `"local"` — replacing today's leftmost-XFF-first behavior (`backend/lib/ratelimit.ts:76-86`) which trusts the client-controlled first entry.
2. WHEN the resolver changes THEN all existing limiter consumers (GraphQL transport `app/api/graphql/rate-limit.ts:50`, parent portal `backend/services/parents/parent-monitoring.service.ts:151`, cron factory `backend/lib/gateway/cron-endpoint.ts:126-134`) SHALL inherit the hardened resolution through the shared `getClientIdentifier` delegation with zero call-site changes.
3. WHEN any existing test pins the leftmost-XFF behavior THEN the task SHALL update it to the rightmost semantics (grep `x-forwarded-for` across `backend/**/test/**` and `test/**` at implementation time).
4. WHEN `createGraphQLContext` builds the Context THEN it SHALL expose `clientIp: string` resolved by the same helper (single resolution site — `backend/graphql/gqlContextFactory.ts:224`), documented as NON-AUTHORIZATION (correlation/limiting only, mirroring the `idempotencyKey` contract at `gqlContextFactory.ts:64-71`).

**Priority:** High · **Complexity:** Low · **Dependencies:** none.

### REQ-052: Cron Route Rate-Limit Parity

**User Story:** As the platform operator, I want every externally-triggerable cron route rate-limited before credential comparison, so that the secret-compare path cannot be hammered.

**Acceptance Criteria:**
1. WHEN `GET /api/cron/reconcile-paymob-payments` executes THEN system SHALL enforce the same IP-keyed `cronSweepRateLimiter` (100/60 s) the three sibling routes already enforce (`backend/lib/gateway/cron-endpoint.ts:79-83`, `:126-134`), applied BEFORE the timing-safe bearer comparison — matching the factory's documented ordering.
2. WHEN the limit is exhausted THEN system SHALL return the existing 429 envelope shape used by the sibling routes.
3. IF the route cannot adopt the factory wholesale (it is hand-rolled with its own mode gates at `app/api/cron/reconcile-paymob-payments/route.ts:103-114`) THEN the task SHALL wire the limiter call inline with minimal diff and document the divergence in the file docblock.

**Priority:** Medium · **Complexity:** Low · **Dependencies:** REQ-051 (shared resolution).

### REQ-060: Security Headers Completion

**User Story:** As the browser, I want the complete modern header set, so that clickjacking, MIME confusion, cross-origin window attacks, and script injection are all structurally mitigated.

**Acceptance Criteria:**
1. WHEN any response ships THEN `next.config.ts` `headers()` SHALL additionally emit `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Resource-Policy: same-origin` on `/:path*`.
2. WHEN Next.js builds THEN `poweredByHeader: false` SHALL suppress `X-Powered-By`.
3. WHEN the CSP is composed THEN it SHALL gain `object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'` while preserving every existing directive value byte-for-byte (`next.config.ts:76`).
4. WHEN `NODE_ENV === "production"` THEN `script-src` SHALL drop `'unsafe-eval'` (prod bundles need no eval; dev keeps it for HMR/Fast Refresh), and the CSP assembly SHALL read `NODE_ENV` at `headers()` invocation time (not module scope) so the pinning test can exercise both branches.
5. WHEN headers change THEN `test/config/security-headers.test.ts` SHALL pin BOTH the production branch (no `unsafe-eval`, new directives present) and the development branch (`unsafe-eval` retained) by mutating `process.env.NODE_ENV` around the `headers()` call, and the new COOP/CORP values SHALL be pinned.
6. IF the production CSP change breaks any runtime script evaluation THEN the implementing task SHALL verify via a production build smoke (`bun run build` + boot) before marking complete — and if a dependency genuinely requires eval in prod, the finding SHALL land in `deferred-items.md` (D8) rather than silently keeping `unsafe-eval`.

**Priority:** High · **Complexity:** Medium · **Dependencies:** none.

### REQ-070: Authorization-Guard Integrity

**User Story:** As a maintainer, I want no authScope that silently always-passes and no 401/403 convention drift, so that future fields inherit honest, fail-closed gates.

**Acceptance Criteria:**
1. WHEN the `permission` scope is declared on any field THEN `builder.ts` SHALL implement it as fail-closed OR-membership over `ctx.permissions` (`permissions.length > 0 && permissions.some(p => ctx.permissions.includes(p))`) instead of `() => true` (`backend/graphql/pothos/builder.ts:142`) — with `ctx.permissions` always `[]` today (`backend/graphql/gqlContextFactory.ts:312`), ANY use denies loudly; zero current fields use it (repo-grep verified), so the flip is behavior-preserving.
2. WHEN the flip lands THEN the docblocks SHALL be updated (`builder.ts:34-36` scope summary, `:140-141` inline) to state the fail-closed contract and the D6 pointer for the real permission layer.
3. WHEN `createPlan`/`updatePlan`/`setPlanActiveStatus` execute (`backend/graphql/mutation/plan-catalog.mutation.ts:24-26`, `:55-57`, `:101-103`) THEN their `authScopes` SHALL use `$all { authenticated: true, role: [UserRole.Admin] }` — anonymous callers get 401 (not 403), matching the pinned convention (`backend/graphql/AGENTS.md:17`).
4. WHEN the scope flip or the `$all` fix lands THEN existing schema-surface pins SHALL be re-verified (`backend/graphql/test/schema-surface.test.ts` — grep `authScopes` for pins of the old shapes and update if present; the file is the schema-surface authority, exact count verified at implementation).
5. WHEN either change lands THEN authorization semantics of every existing mutation SHALL be unchanged (the three plan-catalog fields remain Admin-only; the `permission` scope has zero consumers).

**Priority:** Medium · **Complexity:** Low · **Dependencies:** none.

### REQ-080: Documentation Truth Hygiene

**User Story:** As a future auditor, I want the security docs to describe shipped reality, so that decisions are not made on false claims.

**Acceptance Criteria:**
1. WHEN the plan completes THEN the "fail-open stub" claims SHALL state the real limiter, across ALL live sites (grep-verified census): the four gateway-posture sites — `app/api/graphql/rate-limit.ts:18-19` (docblock), `docs/billing/escrow-and-wallet-crediting.md:116` (also refreshes its stale `ratelimit.ts:75-87` line refs), `docs/parents/handshake-code-discovery.md:173` + `:197`, `docs/auth/qiraah-selection-and-c5.md:340` — PLUS the six additional live sites: `docs/auth/user-registration.md:355` + `:389`, `backend/graphql/test/helpers/admin-session-governance.wire.ts:15`, `backend/graphql/test/admin-session-governance.query.test.ts:15`, `backend/graphql/test/admin-session-governance.mutation.test.ts:23`, `app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts:49` + `:85` — each describing the in-memory sliding window (`backend/lib/ratelimit.ts:95-128`) WITH its honest limits (per-instance, restart-reset, XFF-derived keys) and the NEW auth limiter.
2. WHEN the set-locale docblock is touched THEN the stale `proxy.ts` references SHALL be removed (`app/api/set-locale/route.ts:27`, `:72` — no `middleware.ts`/`proxy.ts` exists in repo or git history).
3. WHEN the verification suites land THEN `docs/planning/PRODUCTION_READINESS.md` §4.2 rows 4.2.1–4.2.5 SHALL be checked off (`☐` → `☑`) with verification references to the specific test files this plan ships; 4.2.1's verification wording SHALL be amended to match the real rejection contract (localized 400-family envelopes + GraphQL `VALIDATION` codes — the platform never returns HTTP 422).
4. WHEN the plan completes THEN `docs/auth/REDIRECT_LOOP_FIX.md`'s token-table contradiction SHALL be fixed (its `:9-14` "React memory only" row vs `docs/auth/jwt-authentication-service.md:17` httpOnly cookie reality).
5. WHEN knowledge propagates THEN a canonical doc SHALL be created at `docs/security/input-validation-and-injection-hardening.md` consolidating: parameterized-query rules, the `escapeLikeWildcards` single-sanitizer contract, the no-HTML-sink + CSV-neutralization rules, the CSRF origin-gate matrix, and the rate-limiting topology.

**Priority:** Medium · **Complexity:** Low · **Dependencies:** REQ-010 through REQ-060 landing first (3 depends on the suites existing).

### REQ-090: UX/Navigation — Explicit No-UI Ruling

**User Story:** As a reviewer, I want the UI surface question answered explicitly, so that no hidden UI scope rides along.

**Acceptance Criteria:**
1. WHEN this plan ships THEN system SHALL add NO new routes, NO sidebar entries, NO locale namespaces, NO components, NO navigation changes — full matrix in `plan.md` §8.
2. WHEN a user hits a rate limit THEN the existing `RetryableNotice` UX SHALL surface it unchanged (`frontend/AGENTS.md:66` — `RATE_LIMITED`/`RATE_LIMIT_EXCEEDED` already mapped).
3. WHEN a transport-level rejection (origin/batch/body-size) fires THEN no client UI change is required (these rejections indicate attack traffic or client bugs, not user flows).

**Priority:** Low · **Complexity:** Low · **Dependencies:** none.

---

## 4. Cross-Actor Workflow Scenarios (Journeys)

**Ruling: NO cross-actor journeys are required.** Justification: every requirement in this plan is system-level hardening observed by a single actor (an unauthenticated attacker or the platform itself); no requirement spans 2+ roles interacting over persistent shared state (the only shared state introduced — the in-memory limiter windows — is attacker-vs-platform and is covered by REQ-050 AC7/AC8 as unit + integration assertions, not a `test/workflows/` journey; journey tests require real multi-role DB fixtures per `test/workflows/AGENTS.md:23-26` which none of these flows involve). The closest multi-actor surface — HMAC webhook trust — is ALREADY journey-covered by `test/workflows/billing/paymob-purchase-journey.test.ts:739-786` and is out of scope (D7). The S6 payload tests extend existing service-level suites instead.

---

## 5. Non-Functional Requirements

- **Performance:** WHEN the origin guard, batch cap, and auth limiter run on the hot path THEN added latency SHALL remain header-parse + Map-read only (no DB, no network) — the rate-limit check is already on every request today (`app/api/graphql/route.ts:188`).
- **Reliability:** IF the limiter throws internally THEN it SHALL fail open for legitimate traffic (`backend/lib/ratelimit.ts:125-127` preserved); IF the origin guard or batch cap throws THEN the route catch fallback masks to the localized 500 envelope (`app/api/graphql/route.ts:193-208`).
- **Security:** WHEN any new module ships THEN it SHALL hold no client-supplied identity in authorization decisions (REQ-051 AC4) and echo no raw input in rejections (REQ-002 AC3).
- **Compatibility:** WHEN the CSP/origin/batch changes ship THEN existing test clients (`testClient` — `test/helpers/graphql-test-helpers.ts:8` — sends no Origin header; direct `POST(request)` route tests) and the preview-panel CORS flow SHALL keep working.

---

## 6. Constraints & Assumptions

- **Technical:** Next.js 16 App Router (NOT standard Next — `node_modules/next/dist/docs/` is authoritative); Bun runtime; in-memory rate limiting is per-instance by design (D2 tracks the Redis upgrade); the auth limiter cannot use `withRateLimit`'s transport tier because identity (email) only exists inside the operation body — hence resolver-level enforcement.
- **Deployment assumption (load-bearing for REQ-051):** exactly ONE trusted reverse proxy sits in front of the app, so the rightmost XFF entry is proxy-appended. If the deployment adds a second proxy hop, the resolution helper's docblock MUST be revisited (tracked in the canonical doc, REQ-080 AC5).
- **Business:** 5 SP ticket; no product-visible behavior changes for legitimate users.

---

## 7. Success Criteria

- [ ] All REQ-010…REQ-090 acceptance criteria met with test references.
- [ ] `docs/planning/PRODUCTION_READINESS.md` §4.2 rows 4.2.1–4.2.5 checked with references.
- [ ] Ticket Gherkin: SQLi rejected (S6), XSS sanitized (S5), CSRF prevented (S1), auth rate-limited (S2), headers present (S4), all fields validated (S3).
- [ ] Zero unresolved ❌/⚠️ rows in `deferred-items.md`.

---

## 8. Traceability Matrix (REQ → Tasks — task ids defined in `tasks.md`)

| REQ | Covering tasks | Verifying artifacts |
|---|---|---|
| REQ-001 | 0, 1.5 (gate) | `outcome/0-baseline-outcome.md`, `outcome/plan-review-R1.md` |
| REQ-002 | 1.1–1.4, 2.1–2.3 (all rejection emitters) | extended envelopes in each task's TE subtask |
| REQ-010 | 1.3 (set-locale cap), 1.4 (batch cap) | `app/api/set-locale/test/set-locale-route.test.ts`, `app/api/graphql/test/graphql-route.transport.test.ts` |
| REQ-011 | 2.3 (login normalization) | `backend/db/test/logic/auth/auth.service.test.ts` (existing suite extended) + the in-process auth-limiter suite from 2.3 |
| REQ-020 | 3.1 (static locks), 3.2 (payload suites) | `test/config/sql-injection-static-locks.test.ts`, extended service tests |
| REQ-021 | 3.1 (census + sanitizer pins inside the same test) | `test/config/sql-injection-static-locks.test.ts` |
| REQ-030 | 3.3 (XSS static lock), 3.4 (CSV helper extraction + 3 cell builders) | `test/config/xss-static-locks.test.ts`, `frontend/utils/csv-formula.test.ts` |
| REQ-040 | 1.1 (origin guard) + 1.2 (wire) | `app/api/graphql/test/graphql-route.origin.test.ts` (new) |
| REQ-050 | 2.2 (configs + helper), 2.3 (resolver wiring) | `backend/lib/ratelimit.test.ts` (extend), resolver tests |
| REQ-051 | 2.1 (resolveClientIp + ctx.clientIp) | `backend/lib/ratelimit.test.ts`, `backend/graphql/test/` context tests |
| REQ-052 | 2.4 (cron parity) | `app/api/cron/reconcile-paymob-payments/test/` (extend or new) |
| REQ-060 | 1.5 (headers completion) | `test/config/security-headers.test.ts` (both env branches pinned) |
| REQ-070 | 4.1 (permission scope), 4.2 (plan-catalog `$all`) | `backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/plan-catalog.roles.test.ts` |
| REQ-080 | 5.1 (docs truth), 6.1 (canonical doc) | grep-clean verification per row |
| REQ-090 | — (ruling; enforced by Phase 1.5 review) | review round 1 |

**Glossary:** CSRF — Cross-Site Request Forgery; BOLA/BFLA/BOPLA — Broken Object/Function/Property-Level Authorization; EARS — Easy Approach to Requirements Syntax; XFF — `X-Forwarded-For` header; COOP/CORP/COEP — Cross-Origin Opener/Resource/Embedder Policy; sliding window — rate-limit algorithm keeping request timestamps inside a moving interval (`backend/lib/ratelimit.ts:60-63`).
