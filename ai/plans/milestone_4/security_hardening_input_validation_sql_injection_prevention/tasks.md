# Trackable Tasks: Security Hardening — Input Validation & SQL Injection Prevention

> **Plan directory (verbatim):** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention`
> **Requirements:** `specs.md` · **Design:** `plan.md` · **Version:** 1.0 · **Date:** 2026-10-08
> **Ticket:** `docs/planning/TICKETS.md:2798-2838` (Milestone 4, Dev 2, 5 SP)

## Non-Negotiable Execution Protocol for All Tasks

1. **Pre-Execution Outcome Knowledge Read:** before ANY task, read ALL files in `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/`.
2. **Per-File Quality Loop:** after EVERY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0; progressive tsgo → oxlint → biome → lint:type-aware → duplicates; auto-discovers + prints applicable AGENTS.md and `.agents/instructions/*.md` files).
3. **Semantic Review Checklist:** before marking any subtask `[x]` — race conditions, env-config registration, dead code, cross-layer imports, enum value imports, deferred-items logging, no plan-artifact references in code comments.
4. **Test rules:** DB tests use `runInRollback` + `tx` propagation (`backend/db/test/test-utils.ts:34`; never `expect(...).rejects.toThrow()` inside the wrapper — `backend/db/test/AGENTS.md:31`); route tests invoke handlers directly (precedent: `app/api/graphql/test/graphql-route.transport.test.ts`); journey/workflow tests: NOT created by this plan (ruling in `specs.md` §4 / `plan.md` §5.14); run tests via `bun run test/scripts/run-test.ts <path>` (never raw `bun test` on workflow files).
5. **Post-Execution Outcome File:** write `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/<task-id>-outcome.md` after every task.
6. **Progress:** update `[ ]` → `[x]` in THIS file upon subtask completion.
7. **Fix-Or-Report:** fix violations within the assigned file; report cross-file dependencies to the orchestrator — never modify an unassigned file.

## Layer-to-Instructions Mapping (reference — `sub-loop.ts` discovers at runtime)

| Files touched by this plan | AGENTS.md | `.agents/instructions` |
|---|---|---|
| `backend/types/gateway/gateway-context.types.ts` | `backend/types/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/lib/ratelimit.ts`, `backend/lib/gateway/transport-guard.ts`, `backend/lib/gateway/cron-endpoint.ts` | `backend/AGENTS.md` | `backend.instructions.md` |
| `backend/graphql/gqlContextFactory.ts`, `backend/graphql/pothos/builder.ts`, `backend/graphql/mutation/auth.mutation.ts`, `backend/graphql/mutation/plan-catalog.mutation.ts` | `backend/graphql/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `app/api/graphql/**`, `app/api/set-locale/**`, `app/api/cron/**`, `next.config.ts` | `app/AGENTS.md` | `frontend.instructions.md` |
| `frontend/utils/**`, `frontend/views/**`, `frontend/components/ui/**` | `frontend/AGENTS.md` (+ `frontend/views/AGENTS.md` for views) | `frontend.instructions.md` |
| `test/config/**`, `app/api/**/test/**`, `backend/**/test/**` | layer AGENTS.md of the code under test | `tests.instructions.md` (+ `backend.instructions.md` for backend tests) |
| `docs/**` | — (docs are the deliverable; NEVER touch AGENTS.md / instructions files) | — |

## Implementation Overview

**Strategy — risk-first, tier-by-tier:** the gateway/transport guards land first (Phase 1 — they protect every subsequent change), then the auth limiter (Phase 2 — the headline gap), then the CI regression locks (Phase 3 — they freeze the just-hardened posture), then authorization consistency (Phase 4), then documentation truth + verification (Phase 5) and knowledge propagation (Phase 6). Tests are interleaved per task (`.TE` subtask inside every task — never deferred).

**Key consideration:** every guard must preserve the four legitimate client classes (same-origin browser, `*.space-z.ai` preview, Bearer-header server clients, test harness). No DB migration, no SDL/codegen, no env keys anywhere in the plan.

---

## Task 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0. Establish error baseline and confirm the deferred-items ledger
  - Read ALL files in `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/`
  - Record baselines:
    ```bash
    bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt
    bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
    bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
    ```
  - Confirm `deferred-items.md` exists with D1–D8 pre-seeded (this plan ships with them)
  - Write outcome file: `outcome/0-baseline-outcome.md` (baseline counts + the evidence-pack summary from `specs.md` header so later agents inherit the audit)
  - _Requirements: REQ-001_

## Phase 1.5: Plan Review Gate — EXECUTED AT PLAN GENERATION TIME

- [x] 1.5-GATE. Review complete plan using `@plan-review` skill — **DONE during plan generation**: verdict + fixes recorded in `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/plan-review-R1.md`. Re-run the gate ONLY if `specs.md`/`plan.md`/`tasks.md` are materially edited after R1.
  - _Requirements: REQ-001, REQ-090_

---

## Phase 1: Gateway & Transport Hardening

- [x] 1.1 Extend the transport taxonomy with the two new rejection kinds
  - Files: `backend/types/gateway/gateway-context.types.ts` (UPDATE — append `"CROSS_ORIGIN_REJECTED" | "BATCH_OPERATION_LIMIT"` to `TransportErrorKind` at `:23-27`; extend the kind→status docblock map at `:19-21` with the 403/400 rows), `app/api/graphql/transport-rejection.ts` (UPDATE — two new wire-map rows: `CROSS_ORIGIN_REJECTED` → 403 + localized `errorsTranslations.forbidden`; `BATCH_OPERATION_LIMIT` → 400 + `errorsTranslations.badRequest`)
  - No runtime exports added to the types file (types-only contract — `backend/types/gateway/gateway-context.types.ts:4-11`)
  - Tests: extend the transport suite's wire-map assertions (`app/api/graphql/test/graphql-route.transport.test.ts`) with the two new kinds (status + code + localized message + requestId presence)
  - - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/gateway/gateway-context.types.ts --lifecycle duplicates` then `... app/api/graphql/transport-rejection.ts ...` (exit 0)
  - - [x] 1.1.TE **Test Engineering**: Tier 1 map-coverage; Tier 2 both kinds + unknown-kind fallback; Tier 3 map invoked concurrently; Tier 4 envelope leaks no origin/body echo
  - - [x] 1.1.SEC **Security & Tenancy Audit**: rejection carries machine kind only — no raw header/payload echo across the boundary (`backend/lib/gateway/transport-guard.ts:10-12` contract)
  - - [x] 1.1.SR **Semantic Review**: no runtime code in types file; no cross-layer imports; docblock map matches route map
  - - [x] 1.1.IV **Instruction Verification**: read printed rule files; validate against `backend/types/AGENTS.md:51-56` + `backend/AGENTS.md:92` (taxonomy-only statuses)
  - Write outcome file: `outcome/1.1-outcome.md` · Update progress here
  - _Requirements: REQ-002 (AC1, AC3), REQ-040 (AC1 wire side), REQ-010 (AC2, AC5)_

- [x] 1.2 CSRF same-origin guard for the GraphQL gateway
  - Files: `app/api/graphql/origin-guard.ts` (CREATE — `assertGraphqlPostOrigin(request: NextRequest): OriginGuardResult` per `plan.md` §5.1: Origin absent → inspect `sec-fetch-site` (`same-origin`/`none`/absent pass, else reject); Origin === `request.nextUrl.origin` pass; `isAllowedSpaceZOrigin` pass (`app/api/graphql/space-z-cors.ts:21-31`); `getWebSocketAllowedOrigins()` membership pass (`backend/lib/env.ts:523`); else reject), `app/api/graphql/route.ts` (UPDATE — invoke the guard as the FIRST statement of `POST` at `:165-171`, before `guardTransport`; rejection → `transportRejectionResponse("CROSS_ORIGIN_REJECTED", request)`; do NOT touch OPTIONS `:137-139`, GET/PUT/DELETE/PATCH `:227-246`, or `flushAuthCookies` `:81-93`)
  - New test: `app/api/graphql/test/graphql-route.origin.test.ts` (direct `POST(request)` invocations): cross-site `Origin: https://evil.example` → 403 + `FORBIDDEN` code; `Origin` absent + `Sec-Fetch-Site: same-origin` → passes to transport tier (assert 405/400 transport response, proving the guard passed); `Origin` absent + `Sec-Fetch-Site: cross-site` → 403; space-z origin → pass; WS-allowlist origin → pass (stub `WS_ALLOWED_ORIGINS` via env before import); same-origin → pass
  - - [x] 1.2.QL: sub-loop both files (exit 0)
  - - [x] 1.2.TE: Tier 1 all origin branches; Tier 2 empty-Origin-string, malformed Origin (unparseable URL — `isAllowedSpaceZOrigin` already fail-closed), port-variant same-host origin; Tier 3 concurrent guard invocations (pure — no state); Tier 4 `Origin: https://space-z.ai.attacker.com` suffix-trick (must reject — URL-parse defense at `space-z-cors.ts:26-29`), `null` string Origin
  - - [x] 1.2.SEC: guard is identity-blind + pre-authorization (no `ctx` reads); Bearer-header clients without Origin unaffected; no allowlist widening
  - - [x] 1.2.SR: pure module (no module-level mutable state); app-layer module imports backend only (no backend→app import); docblock documents the CSRF threat model without citing plan artifacts
  - - [x] 1.2.IV: validate against `app/AGENTS.md:62-65` (route composition) + backend gateway contracts
  - Write outcome file: `outcome/1.2-outcome.md`
  - _Requirements: REQ-040 (all ACs), REQ-002 (AC1, AC3)_

- [x] 1.3 Batched-operation amplification cap
  - Files: `backend/lib/gateway/transport-guard.ts` (UPDATE — `MAX_GRAPHQL_OPERATIONS_PER_REQUEST = 10` beside `MAX_GRAPHQL_BODY_BYTES` `:49`; `assertBatchOperationCount(body: unknown): TransportGuardResult` — non-array → pass; array ≤ cap → pass; array > cap → `fail("BATCH_OPERATION_LIMIT")`; wire it inside `guardTransport` immediately after the `JSON.parse` success at `:167`), `frontend/providers/apollo/AppApolloProvider.tsx` (UPDATE — add `batchMax: 10` to the `BatchHttpLink` construction at `:99` with a docblock cross-referencing the paired server constant; the installed default is `0` = unlimited at `node_modules/@apollo/client/link/batch/batchLink.js:36`, so the client cap MUST be explicit), `app/api/graphql/apollo-server.ts` (NO CHANGE — `allowBatchedHttpRequests: true` stays)
  - Tests: extend `app/api/graphql/test/graphql-route.transport.test.ts` — 11-op array → 400 `BATCH_OPERATION_LIMIT`; 10-op array → passes transport tier; single object body unchanged; existing no-inline-copy pin extended to the new constant (precedent `:299-300`)
  - - [x] 1.3.QL: sub-loop `backend/lib/gateway/transport-guard.ts` (exit 0)
  - - [x] 1.3.TE: Tier 1 branch coverage (array/non-array/boundary); Tier 2 cap-1/cap/cap+1, empty array; Tier 3 mixed concurrent posts; Tier 4 oversized arrays nested with big bodies (2 MB + 11 ops — size guard wins by order)
  - - [x] 1.3.SEC: guard order preserved (method → CT → declared → drain → drained → parse → batch-count); no engine reach on rejection
  - - [x] 1.3.SR: constant single-sourced (no inline copies); pure guards; docblock explains the amplification bound in domain terms
  - - [x] 1.3.IV: validate against gateway guard contracts (`backend/lib/gateway/transport-guard.ts:1-30`)
  - Write outcome file: `outcome/1.3-outcome.md`
  - _Requirements: REQ-010 (AC2–AC5)_

- [x] 1.4 set-locale POST body-size cap
  - Files: `app/api/set-locale/route.ts` (UPDATE — replace the bare `request.json()` at `:167-183` with: declared `content-length` checkpoint (reject `> MAX_SET_LOCALE_BODY_BYTES` via the existing `badRequestError(tErrors.badRequest)` envelope BEFORE reading), bounded `request.text()`, drained-length checkpoint, `JSON.parse`; module-local `MAX_SET_LOCALE_BODY_BYTES = 4_096`; keep the `SyntaxError`-localized BAD_REQUEST branch semantics verbatim; ALSO remove the stale `proxy.ts` docblock references at `:27` and `:72` — REQ-080 AC2 rides along)
  - Tests: extend `app/api/set-locale/test/set-locale-route.test.ts` — declared `content-length: 5000` → 400 envelope (body never read — assert via a stream that fails if consumed, or by asserting rejection with the declared header alone); drained body 5 000 B with lying small header → 400; boundary 4 096 B valid `{locale:"en"}` → 200; malformed JSON → existing localized 400 unchanged; origin-gate cases unchanged
  - - [x] 1.4.QL: sub-loop the route file (exit 0)
  - - [x] 1.4.TE: Tier 1 all new branches; Tier 2 boundary bytes, empty body, non-UTF8; Tier 3 concurrent posts; Tier 4 lying `content-length` (declared small + drained large), oversize body containing a VALID locale (must still reject — size wins over content)
  - - [x] 1.4.SEC: no request-body echo in rejections; whitelist validation (`isSetLocaleBody` at `:60-66`) stays downstream of the cap
  - - [x] 1.4.SR: envelope helper reuse (no hand-rolled body — `backend/AGENTS.md:93`); no cross-layer imports; docblock updated without stale refs
  - - [x] 1.4.IV: validate against `app/AGENTS.md:64` (route bodies follow shared envelope conventions)
  - Write outcome file: `outcome/1.4-outcome.md`
  - _Requirements: REQ-010 (AC1), REQ-080 (AC2), REQ-002_

- [x] 1.5 Security headers completion
  - Files: `next.config.ts` (UPDATE — add top-level `poweredByHeader: false`; in `headers()` `:48-85` add `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Resource-Policy: same-origin`; rebuild the CSP value with `object-src 'none'; base-uri 'self'; form-action 'self'; worker-src 'self'` appended and `script-src` composed with a CALL-TIME `NODE_ENV` branch — production drops `'unsafe-eval'`, non-production keeps it; read `process.env.NODE_ENV` inside `headers()`, never at module scope, so tests can pin both branches), `test/config/security-headers.test.ts` (UPDATE — pin COOP + CORP + `poweredByHeader === false`; pin BOTH CSP branches by setting `process.env.NODE_ENV` around the `await nextConfig.headers()` call with save/restore; keep existing pins intact)
  - Production smoke: `bun run build` must succeed and the implementing agent boots the production server and loads `/login` checking the browser console for CSP violations (REQ-060 AC6 — if a prod dependency genuinely requires eval, log finding in `deferred-items.md` D8 instead of keeping `unsafe-eval` silently)
  - - [x] 1.5.QL: sub-loop `next.config.ts` + the test file (exit 0)
  - - [x] 1.5.TE: Tier 1 both env branches + all directives; Tier 2 directive ordering/value byte-exactness (existing pins `:15-23` must keep passing untouched); Tier 4 CSP string abuse probes (no `unsafe-eval` in the prod branch string, `object-src 'none'` present)
  - - [x] 1.5.SEC: header values never interpolate request data (static strings only); no COEP (deferred D5 — do not add)
  - - [x] 1.5.SR: no other config keys touched (`distDir`, `serverExternalPackages` etc. byte-preserved); both-branch test restores `NODE_ENV` in a `finally`
  - - [x] 1.5.IV: Next 16 docs check — `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/headers.md` + `poweredByHeader.md` (this is NOT the Next.js you know — read before writing)
  - Write outcome file: `outcome/1.5-outcome.md`
  - _Requirements: REQ-060 (all ACs), REQ-080 (documentation of the prod branch in the canonical doc comes in 6.1)_

---

## Phase 2: Auth Rate Limiting

- [x] 2.1 Spoof-resistant client-IP resolution + `ctx.clientIp`
  - Files: `backend/lib/ratelimit.ts` (UPDATE — new `resolveClientIp(request): string`: `x-real-ip` header first (trimmed, non-empty), else RIGHTMOST comma-separated `x-forwarded-for` entry, else `"local"`; `getClientIdentifier` `:76-86` becomes a one-line delegation to `resolveClientIp`; docblock documents the single-trusted-proxy deployment assumption), `backend/graphql/gqlContextFactory.ts` (UPDATE — `Context` interface `:49-99` gains `readonly clientIp: string;` with a NON-AUTHORIZATION docblock mirroring `idempotencyKey` `:64-71`; `createGraphQLContext` `:224` resolves it once via `resolveClientIp` and exposes it beside `:312-313`)
  - Tests: EXTEND the existing `backend/lib/ratelimit.test.ts` with `clearRateLimitStore()` isolation: resolution matrix — `x-real-ip` wins over XFF; XFF `"1.1.1.1, 2.2.2.2"` → `"2.2.2.2"` (rightmost); empty/whitespace XFF → `"local"`; concurrent resolution pure. GREP-FIRST: `grep -rn "x-forwarded-for" backend/**/test test/ app/**/test` — update every leftmost-XFF pin to rightmost semantics
  - - [x] 2.1.QL: sub-loop both files (exit 0)
  - - [x] 2.1.TE: Tier 1 resolution branches; Tier 2 empty strings, whitespace-only, IPv6 with colons in XFF (comma-split must not split colons); Tier 3 concurrent context construction; Tier 4 spoof probes — client-controlled `"9.9.9.9, 1.2.3.4"` must key on `1.2.3.4`, not the forged leftmost
  - - [x] 2.1.SEC: `clientIp` used for limiting ONLY — assert no authorization path reads it (grep consumers); no PII concern (IP in limiter keys already exists today)
  - - [x] 2.1.SR: single resolution site; existing consumers (`app/api/graphql/rate-limit.ts:50`, `backend/services/parents/parent-monitoring.service.ts:151`, `backend/lib/gateway/cron-endpoint.ts:126-134`) untouched and inheriting via delegation
  - - [x] 2.1.IV: validate against `backend/graphql/AGENTS.md:102` (context anchor: single per-request wiring site)
  - Write outcome file: `outcome/2.1-outcome.md`
  - _Requirements: REQ-051 (all ACs), REQ-002_

- [x] 2.2 Auth limiter configs + enforcement helper
  - Files: `backend/lib/ratelimit.ts` (UPDATE — additive: `authIpLimiter` `{ name: "auth-ip", limit: 10, windowMs: 60_000 }`, `authIdentityLimiter` `{ name: "auth-identity", limit: 20, windowMs: 60_000 }` beside `graphqlRateLimiter` `:37-41`; `hashAuthIdentity(email: string): string` — `createHash("sha256")` over `email.trim().toLowerCase()`, empty input → `""`; `enforceAuthMutationRateLimit({ clientIp, identity }: { clientIp: string; identity: string }, locale: string): Promise<void>` — IP bucket first (`checkRateLimit(clientIp, authIpLimiter)`), identity bucket second when `identity !== ""`, throws localized `RateLimitExceededError(getServerTranslations(locale).errorsTranslations.rateLimitExceeded)` on exhaustion, returns void on pass; logs via `logger.logDomainError` with limiter name + IP only, NEVER the identity hash's preimage; PLUS a test-harness bypass MIRRORING the transport tier verbatim — skip when `TEST_CI === "1" || TEST_SERVER === "1"` with the identical production guard throw (`app/api/graphql/rate-limit.ts:34-48`) so live-server suites (one shared dev-server process, one `windows` Map, no cross-process reset) cannot flake, while the bypass stays unreachable in production)
  - Tests: extend `backend/lib/ratelimit.test.ts` with `clearRateLimitStore()` isolation — 10th in-window IP call passes, 11th throws; identity 20th passes, 21st throws; identity exhaustion is per-hash (two emails → independent buckets); IP bucket shared across identities; order proof (identity bucket not consumed when IP bucket already rejects — mock via counting `checkRateLimit` calls); localization both `en`/`ar`; fail-open catch preserved (`:125-127` semantics — a thrown internal error must NOT block a legitimate request)
  - - [x] 2.2.QL: sub-loop `backend/lib/ratelimit.ts` (exit 0)
  - - [x] 2.2.TE: Tier 1 helper branches; Tier 2 window-edge (oldest timestamp expiry), boundary 10/20; Tier 3 `Promise.allSettled` of 11 concurrent enforcement calls → exactly 10 resolves + 1 rejection (event-loop atomicity proof); Tier 4 hash-collision/empty-email/unicode-email determinism, plaintext-never-logged assertion
  - - [x] 2.2.SEC: no plaintext identity in Map or logs (assert key format `auth-identity:<64-hex>`); throw carries no input echo; harness bypass copies the transport tier's guard throw VERBATIM (production-unreachable — REQ-050 AC7)
  - - [x] 2.2.SR: reuses the ONE bounded Map (`:51`, `:58`) — no second store; `await` placement keeps check-then-throw atomic (no awaits between decision and throw)
  - - [x] 2.2.IV: validate against `backend/AGENTS.md:89-93` (taxonomy-only status via `RateLimitExceededError` — no numeric literals)
  - Write outcome file: `outcome/2.2-outcome.md`
  - _Requirements: REQ-050 (AC1–AC3, AC6–AC8), REQ-002 (AC1)_

- [x] 2.3 Wire enforcement into the auth mutation resolvers + login normalization
  - Files: `backend/graphql/mutation/auth.mutation.ts` (UPDATE — `login` resolver `:89`: call `enforceAuthMutationRateLimit({ clientIp: ctx.clientIp, identity: hashAuthIdentity(args.email) }, ctx.locale)` FIRST; then normalize: `const email = args.email.trim()`, reject empty email/password or `password.length > 1_024` with the existing localized invalid-credentials `UnauthorizedError` (message via `(await ctx.t("authTranslations")).invalidCredentials` — the namespace key is `authTranslations`, `keyof Translations`; the service reads the same key at `backend/services/auth/auth.service.ts:173`); pass the trimmed email to `AuthService.login`; `setAuthCookies` block unchanged. `registerUser` resolver `:58`: enforcement with `identity: hashAuthIdentity(input.email)` — NO other change (service validates — `backend/services/auth/registration.service.ts:208`). `refreshToken` resolver `:118`: enforcement with `identity: ""` (IP-only — REQ-050 AC5); existing trim/cookie fallback logic `:123-125` unchanged. `logout`: untouched. Module-local `MAX_LOGIN_PASSWORD_LENGTH = 1_024` with a transport-hygiene docblock (bcrypt truncates at 72 B; this bound is payload hygiene, not password policy))
  - Tests: NEW in-process suite `backend/graphql/test/auth-rate-limit.test.ts` executing the BUILT schema in-process (precedent: the anonymous in-process probes in `backend/graphql/test/schema-surface.test.ts` — resolvers are anonymous side-effect registrations and CANNOT be invoked directly, `backend/graphql/mutation/AGENTS.md:29-32`), isolated via `clearRateLimitStore()`; ordering proof with ZERO spies: exhausted IP bucket + a nonexistent email → error code `RATE_LIMIT_EXCEEDED` (had the service run first, it would throw `UNAUTHORIZED` invalid-credentials — the code distinction IS the ordering proof); login normalization cases (untrimmed email reaches the service trimmed — extend `backend/db/test/logic/auth/auth.service.test.ts`; empty/oversize password rejects invalid-credentials); register/refresh limiter wiring; refreshToken IP-only (two different emails from one IP share the IP bucket). `frontend/graphql/test/auth/auth.test.ts` stays wire-level ONLY (rule 10 — `testClient`, no backend service imports; verify it still passes unchanged under the harness bypass)
  - - [x] 2.3.QL: sub-loop `backend/graphql/mutation/auth.mutation.ts` + test files (exit 0)
  - - [x] 2.3.TE: Tier 1 all three resolvers' enforcement + normalization branches; Tier 2 boundary password lengths (72/1 024/1 025), unicode emails; Tier 3 concurrent login bursts (11 parallel → 10 pass/1 rate-limited); Tier 4 rate-limit bypass attempts — aliasing the mutation (`loginAlias: login`) must NOT bypass (field-level enforcement), empty-string email, whitespace-only email
  - - [x] 2.3.SEC: BFLA — the public-operation allowlist is untouched (`backend/lib/gateway/public-operations.ts:36-46`); no identity/role from input; limiter keyed on context-derived IP + hashed identity only; BOPLA — explicit field mapping preserved (no spreads)
  - - [x] 2.3.SR: resolver stays a thin composition (enforcement → normalization → service — `backend/graphql/mutation/AGENTS.md:34-35` delegation rule); no business logic moves into the resolver; error masking belongs to the finalizer (throw the DomainError, never format)
  - - [x] 2.3.IV: validate against `backend/graphql/AGENTS.md:14` (localized resolver errors via `ctx.t`) + `backend/graphql/mutation/AGENTS.md`
  - Write outcome file: `outcome/2.3-outcome.md`
  - _Requirements: REQ-050 (AC4, AC5), REQ-011 (all ACs), REQ-002 (AC3)_

- [x] 2.4 Cron route rate-limit parity (reconcile-paymob)
  - Files: `backend/lib/gateway/cron-endpoint.ts` (UPDATE — add the `export` keyword to `cronSweepRateLimiter` at `:79`; it is currently a module-private `const`; the config is NOT duplicated or re-homed), `app/api/cron/reconcile-paymob-payments/route.ts` (UPDATE — invoke `checkRateLimit(<ip>, cronSweepRateLimiter)` BEFORE the timing-safe bearer compare, matching the factory ordering `backend/lib/gateway/cron-endpoint.ts:126-143`; resolve the IP via the shared `getClientIdentifier`; 429 branch mirrors the siblings' envelope; docblock notes the divergence from the factory and why inline wiring was chosen)
  - Tests: extend/locate the route's test suite (sibling pattern: `app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts`): limiter fires before bearer compare (exhaust bucket → 429 even with a VALID bearer); valid bearer under limit → 200 path unchanged; mode-gate 404s unchanged
  - - [x] 2.4.QL: sub-loop the route file (exit 0)
  - - [x] 2.4.TE: Tier 1 branches; Tier 2 limit boundary; Tier 4 secret-hammering probe (100 requests/60 s with garbage bearers → rate-limited BEFORE secret compare, proving the DoS-protection ordering)
  - - [x] 2.4.SEC: timing-safe compare untouched (`backend/lib/api/cron-auth.ts:34-41`); no secret material in limiter keys or logs
  - - [x] 2.4.SR: config single-sourced (no duplicated limiter constant); envelope shape matches siblings
  - - [x] 2.4.IV: validate against `app/AGENTS.md:62-65` + gateway factory contracts
  - Write outcome file: `outcome/2.4-outcome.md`
  - _Requirements: REQ-052 (all ACs), REQ-051 (AC2)_

---

## Phase 3: Injection & XSS Regression Locks

- [x] 3.1 SQL-injection static-lock suite
  - File: `test/config/sql-injection-static-locks.test.ts` (CREATE — source-scanning suite, pattern precedent `backend/services/parents/parent-link.static-locks.test.ts:373-397`):
    **Lock (a) `sql.raw` zero-tolerance:** scan every production file under `backend/db/repo/` and `backend/services/` (exclude `*.test.ts`, `*.spec.ts`, `__tests__/`) for `sql.raw(` → assert ZERO matches (codifies today's verified state — the only `sql.raw` sites in the tree are dev migration tooling at `backend/db/scripts/runDrizzleMigrations.ts:116` and `backend/db/scripts/ensureIdempotentMigrations.ts:310`, both outside the scan roots; `scripts/dbActions/` greps clean).
    **Lock (b) `ilike` census pin:** scan `backend/db/repo/**` for `\b(?:ilike)\s*\(` on a COMMENT-STRIPPED corpus (strip `/* */` blocks + `//` tails — docblock prose MUST NOT count; two files match only in prose: `admin-user.repository.ts:28`, `admin-user-row-types.ts:50`); assert the match set equals EXACTLY the pinned census — 8 files / 14 call-site lines / 19 call occurrences, table in `plan.md` §5.15 (single source of truth): `student-payment.repository.ts:135`, `student.repository.directory.helpers.ts:103`, `teacher.repository.directory.helpers.ts:90`, `applicant.repository.ts:120`, `academic-tracking.repository.ts:119`, `admin-user-query-helpers.ts:100,101,104,183`, `teacher.repository.matching.helpers.ts:138,139,141,142`, `broadcast.repository.ts:138` — a new call site outside the census FAILS, forcing an explicit escape-discipline review (extend, don't bypass); re-grep and freeze exact per-line counts at implementation before the lock ships.
    **Lock (c) single-sanitizer pin:** scan `backend/` + `shared/` for `escapeLikeWildcards|escapeWildcard|LIKE_ESCAPE` — assert every definition site is `backend/lib/db/escape-like-wildcards.ts` and all other hits are imports/usages of it (no second implementation).
    **Lock (d) docblock truth:** assert `backend/lib/db/escape-like-wildcards.ts:26-29` still declares itself the ONLY sanitizer.
  - - [x] 3.1.QL: sub-loop the new test file (exit 0)
  - - [x] 3.1.TE: Tier 1 all four locks green against current tree; Tier 4 negative-proof — temporarily seeding a scratch copy with a `sql.raw(` hit and asserting the lock FAILS (prove the scanner works; use a fixture directory string, never a real source edit — or assert against a synthetic in-memory content sample through the same matcher functions)
  - - [x] 3.1.SEC: scanner reads sources only; no test writes into production trees
  - - [x] 3.1.SR: census sourced from `plan.md` §5.15 (the single source of truth — verified line refs); scanner file-list helper excludes generated dirs (`.next*`, `node_modules`); comment-stripping semantics stated in the lock
  - - [x] 3.1.IV: validate against `test/` conventions + root `AGENTS.md` (no `oxlint-disable`)
  - Write outcome file: `outcome/3.1-outcome.md`
  - _Requirements: REQ-020 (AC1–AC3), REQ-021 (AC1)_

- [x] 3.2 Hostile-payload service tests (injection + wildcard)
  - Files: extend the EXISTING suites at their homes (do not create parallel suites): teacher matching (`backend/services/teachers/teacher-matching.service.test.ts` — verify exact filename), admin teacher directory (`backend/services/admin/teacher-directory.service.test.ts`), admin student-payments audit (`backend/services/billing/` suite hosting `admin-financial-auditing` tests — locate at implementation). Payloads: `'; DROP TABLE users; --`, ` Robert'); DROP TABLE students;--`, `%`, `_`, `\`, `100%`, `%admin%`, mixed `a%b_c\d`; assertions: results equal the literal-substring match set (never widened), zero rows modified (count before/after), translated-substring error assertions where rejection is expected (never raw message keys — `backend/db/test/AGENTS.md:44`)
  - DB-touching variants: wrap in `runInRollback(async tx => ...)` and pass `tx` to EVERY repo call inside (`backend/db/test/AGENTS.md:19-22`); NEVER `expect(...).rejects.toThrow()` inside the wrapper (deadlock rule `:31`) — use try/catch
  - - [x] 3.2.QL: sub-loop each extended test file (exit 0)
  - - [x] 3.2.TE: Tier 4 is the whole point (payload matrix); Tier 2 covers empty search, 100-char clamp boundary (directory services clamp — `backend/services/admin/teacher-directory.service.ts:68-71`), unicode/RTL search strings
  - - [x] 3.2.SEC: this suite IS the SEC artifact — the assertions prove BOLA-adjacent search widening is impossible
  - - [x] 3.2.SR: no production code changes in this task (tests only — if a production defect IS found by a payload, fix it in this task and note it in the outcome file)
  - - [x] 3.2.IV: validate against `backend/db/test/AGENTS.md` + `tests.instructions.md`
  - Write outcome file: `outcome/3.2-outcome.md`
  - _Requirements: REQ-020 (AC4, AC5), REQ-021 (AC2, AC3)_

- [x] 3.3 XSS static-lock suite (the scanner three components already cite)
  - File: `test/config/xss-static-locks.test.ts` (CREATE): scan every production `*.ts`/`*.tsx` under `app/` and `frontend/` (exclude `*.test.ts(x)`, `*.stories.tsx`, `frontend/graphql/generated/`, any `.next*` dirs) for `dangerouslySetInnerHTML`, `.innerHTML`, `.outerHTML`, `insertAdjacentHTML`, `document.write(`, `eval(`, `new Function(`, `srcDoc` → assert ZERO matches (codifies today's verified zero-sink state; the repo's only tracked hit is the CountrySelector negative assertion at `frontend/components/ui/CountrySelector.test.tsx:529`, which lives in an excluded test file)
  - Files: UPDATE the three production comments that cite the previously-nonexistent scanner to reference the real test path: `frontend/components/ui/NotificationDrawer.tsx:67`, `frontend/views/notifications/feed/NotificationRowContent.tsx:10`, `frontend/views/notifications/feed/NotificationRow.tsx:41` — keep the domain statements, drop predecessor-plan artifact ids (the `REQ-`-prefixed references) from the comments, cite `test/config/xss-static-locks.test.ts`
  - - [x] 3.3.QL: sub-loop the test file + the three comment-touched components (exit 0)
  - - [x] 3.3.TE: Tier 1 scanner green on current tree; Tier 4 negative-proof the matcher (synthetic sample containing `dangerouslySetInnerHTML` must FAIL the matcher)
  - - [x] 3.3.SEC: scanner covers both `app/` and `frontend/` (server AND client sinks); comment hygiene removes stale contract references without weakening the documented behavior
  - - [x] 3.3.SR: comments describe behavior, cite the enforcing test, and contain zero plan-artifact references (semantic checklist "Clean Comments" rule)
  - - [x] 3.3.IV: validate against `frontend/AGENTS.md` comment hygiene + root AGENTS.md rule
  - Write outcome file: `outcome/3.3-outcome.md`
  - _Requirements: REQ-030 (AC1, AC2)_

- [x] 3.4 CSV formula-injection neutralization
  - Files: `frontend/utils/csv-formula.ts` (CREATE by EXTRACTION — move the EXISTING `neutralizeCsvFormulas(value: string): string` VERBATIM from `frontend/views/shared/print-export/PrintExportDialog.tsx:36-42` (regex `/^[=+\-@\t\r]/`, `'` prefix — its CWE-1236 docblock travels with it); zero duplicated logic, `check:duplicates`-safe), `frontend/utils/csv-formula.test.ts` (CREATE — triggers `=cmd|'/C calc'!A0`, `+1=1`, `-2+3`, `@SUM(A1:A2)`, `\t=cmd`, `\r=cmd`; non-triggers `hello`, `a=b`, `€`, Arabic/RTL text, empty string; idempotence; quoting interplay), cell builders (UPDATE — route each through the shared helper, quote-doubling preserved INSIDE the neutralized value): `frontend/views/teacher/wallet/walletLedgerCsv.ts:16-18` (`csvCell`), `frontend/views/admin/directory-shared/directory-csv.ts:37` (`csvCell` + docblock correction at `:23-27` whose "intentionally not applied" note becomes stale), `frontend/views/admin/analytics/platform-analytics-csv.ts:50` (`csvCell`); `frontend/views/shared/print-export/PrintExportDialog.tsx` (UPDATE — drop the local copy, import the shared helper; `escapeCsv` composition at `:40-42` unchanged); NOTE: the students/applicants exporters delegate into `directory-csv.ts` (`studentsCsvExport.ts:28`, `AdminApplicantsPanel.tsx:77`) and are covered transitively — do NOT edit them — plus extend the cell-builder tests (locate at implementation; create colocated where absent) with one formula-payload row assertion each
  - - [x] 3.4.QL: sub-loop the helper + the four touched view files (exit 0)
  - - [x] 3.4.TE: Tier 1 trigger/non-trigger branches; Tier 2 leading whitespace-only values, single `=` char, CRLF-prefixed values; Tier 4 the payload matrix above + a full-ledger export containing a hostile `description` cell rendering as inert text; regression-assert `PrintExportDialog.tsx` still neutralizes identically post-extraction (byte-level CSV output comparison on a formula-trigger fixture)
  - - [x] 3.4.SEC: neutralization applied at the CELL level (before join) so no field can escape quoting; helper is frontend-only (no shared-layer placement — CSV is a client concern)
  - - [x] 3.4.SR: helper single-sourced (extraction, not duplication — exactly ONE implementation tree-wide, `check:duplicates` clean); exporters keep their existing BOM/UTF-8 behavior byte-for-byte for non-trigger values; the `directory-csv.ts:23-27` docblock no longer describes the old no-guard behavior
  - - [x] 3.4.IV: validate against `frontend/AGENTS.md` + `frontend/views/AGENTS.md` for the view files
  - Write outcome file: `outcome/3.4-outcome.md`
  - _Requirements: REQ-030 (AC3–AC5)_

---

## Phase 3.5: Mid-Point Review Gate (CONDITIONAL — TRIGGERED: 18 tasks > 15, distinct backend+frontend phases)

- [x] 3.5-GATE. Backend architecture review checkpoint (after Phases 1–3 land, BEFORE Phase 4)
  - Scope: ALL files modified in tasks 1.1–3.4 (`git diff --name-only` vs the task-0 baseline commit)
  - Dispatch parallel review subagents: `review-backend` (limiter/helper/guard/transport semantics — race conditions, dead code, fail-open/fail-closed inversions), `review-config` (`next.config.ts`, route wiring order, wire-map completeness), `review-frontend` (CSV helper + exporter seams)
  - Aggregate findings, filter to issues in THIS plan's files only (pre-existing code issues → log, don't fix here)
  - Dispatch fix subagents per file cluster using `.agents/instructions/*.instructions.md` as guardrails; each fix re-runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`
  - Re-review until zero plan-specific findings; write outcome: `outcome/midpoint-review-R1.md`
  - _Requirements: REQ-001 (AC5, AC6)_

---

## Phase 4: Authorization-Guard Integrity

- [x] 4.1 `permission` authScope → fail-closed
  - Files: `backend/graphql/pothos/builder.ts` (UPDATE — `:142` `permission: () => true` → `permission: (codes: string[]) => codes.length > 0 && codes.some(p => ctx.permissions.includes(p))`; update the builder header docblock `:34-36` and the inline comment `:140-141` to state: fail-closed OR-membership over `ctx.permissions`; `ctx.permissions` is `[]` today (`backend/graphql/gqlContextFactory.ts:312`) so any field declaring the scope denies until the permission layer lands — cite no plan artifacts in comments)
  - GREP-FIRST safety proof: `grep -rn "permission:" backend/graphql/mutation backend/graphql/query --include="*.ts" | grep -v authScopes` → confirm ZERO production fields declare the `permission` scope before flipping (the flip must be behavior-preserving — REQ-070 AC1); also grep `backend/graphql/test/schema-surface.test.ts` (48 `authScopes` refs) for pins of the old `() => true` shape and update if present
  - Tests: extend `backend/graphql/test/schema-surface.test.ts` (or the builder's nearest test home — locate at implementation): assert a synthetic field with `authScopes: { permission: ["X"] }` DENIES with localized FORBIDDEN (fail-closed proof); assert the deny is 403-family (scope-`false` path → `builder.ts:124` mapping)
  - - [x] 4.1.QL: sub-loop `backend/graphql/pothos/builder.ts` (exit 0)
  - - [x] 4.1.TE: Tier 1 deny branch + empty-codes; Tier 2 single/multiple codes; Tier 4 BFLA probe — a hypothetical low-privilege field using the scope cannot pass (synthetic schema probe)
  - - [x] 4.1.SEC: THIS IS THE SEC TASK — the silent-allow footgun documented at `backend/graphql/AGENTS.md:93-95` is closed; no existing field's semantics change (zero-consumer proof recorded in the outcome file)
  - - [x] 4.1.SR: docblocks truthful (no "wired to PermissionsService later" promises — the D6 deferral lives in `deferred-items.md`, not code comments)
  - - [x] 4.1.IV: validate against `backend/graphql/AGENTS.md:10` (scope checks fail-closed; 401/403 discipline) + `backend/graphql/pothos/AGENTS.md`
  - Write outcome file: `outcome/4.1-outcome.md`
  - _Requirements: REQ-070 (AC1, AC2, AC4, AC5)_

- [x] 4.2 plan-catalog 401/403 convention fix
  - Files: `backend/graphql/mutation/plan-catalog.mutation.ts` (UPDATE — `:24-26`, `:55-57`, `:101-103`: `authScopes: { role: [UserRole.Admin] }` → `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` for `createPlan`, `updatePlan`, `setPlanActiveStatus`; the file's header docblock claims the conjunction already — make the code match it)
  - Tests: extend `backend/graphql/test/plan-catalog.roles.test.ts` (verify exact filename at implementation; sibling: `backend/graphql/test/plan-catalog.schema.test.ts`): anonymous caller now receives UNAUTHORIZED (401-family code) not FORBIDDEN; authenticated non-admin still FORBIDDEN; admin still allowed — all three fields
  - - [x] 4.2.QL: sub-loop the mutation file + test file (exit 0)
  - - [x] 4.2.TE: Tier 1 the three-fields × three-callers matrix; Tier 2 expired-token caller (401)
  - - [x] 4.2.SEC: BFLA — admin-only semantics unchanged; `$all` conjunction is load-bearing (plain map = ANY semantics — `docs/parents/monitoring-portal.md:38`); 401-vs-403 indistinguishability rule honored (`backend/graphql/AGENTS.md:10`)
  - - [x] 4.2.SR: `backend/graphql/test/schema-surface.test.ts` authScopesSnapshot re-verified for the three fields (update the pinned snapshot entries)
  - - [x] 4.2.IV: validate against `backend/graphql/AGENTS.md:17` (explicit `$all` conjunction rule)
  - Write outcome file: `outcome/4.2-outcome.md`
  - _Requirements: REQ-070 (AC3, AC4, AC5)_

---

## Phase 5: Verification & Documentation Truth

- [x] 5.1 Documentation truth hygiene + readiness check-off
  - Files (all UPDATE, docs only — NEVER touch `AGENTS.md` / `.agents/instructions/*`):
    a. `app/api/graphql/rate-limit.ts:16-24` docblock — replace the "stub limiter always returns success" claim (`:18-19`) with the real contract: `checkRateLimit` enforces an in-memory sliding window (`backend/lib/ratelimit.ts:95-128`), per-instance (restart resets, not shared across instances), keyed on the spoof-resistant resolver (2.1); the batch-amplification note `:52-54` is now RESOLVED by task 1.3 — update it to cite the cap.
    b. `docs/billing/escrow-and-wallet-crediting.md:116` — replace the "fail-open stub that always allows" sentence (and its stale `backend/lib/ratelimit.ts:75-87` line refs) with the real window + its honest limits + the new auth limiter.
    c. `docs/parents/handshake-code-discovery.md:173` and `:197` — same correction; `:197`'s "do not add rate limiting inside the discovery service" guidance stays (portal reads remain governed by `enforcePortalRateLimit` — `backend/services/parents/parent-monitoring.service.ts:144-157`).
    d. `docs/auth/qiraah-selection-and-c5.md:340` — same correction for the `registerUser` posture.
    d2. SIX additional live sites carrying the same stale "stub" claim (grep-verified census): `docs/auth/user-registration.md:355` + `:389`, `backend/graphql/test/helpers/admin-session-governance.wire.ts:15`, `backend/graphql/test/admin-session-governance.query.test.ts:15`, `backend/graphql/test/admin-session-governance.mutation.test.ts:23`, `app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts:49` + `:85` — same correction, phrased for each site's context (test-file comments say "the limiter is real but bypassed under the test harness").
    e. `app/api/set-locale/route.ts` — already handled in task 1.4 (verify no other stale `proxy.ts` references: `grep -rn "proxy.ts" app/ backend/ shared/ frontend/ --include="*.ts"`).
    f. `docs/auth/REDIRECT_LOOP_FIX.md:9-14` — fix the token-table contradiction ("React memory only" → dual storage: React memory + httpOnly cookie, per `docs/auth/jwt-authentication-service.md:17` and `backend/lib/auth/cookies.ts:35-42`).
    g. `docs/planning/PRODUCTION_READINESS.md` §4.2 (`:191-199`) — amend 4.2.1's verification wording to the real contract (localized 400-family envelopes + GraphQL `VALIDATION`/transport codes — the platform never returns HTTP 422), then check `☐` → `☑` rows 4.2.1–4.2.5, each citing its verifying artifact: 4.2.1 → tasks 1.3/1.4 + service suites; 4.2.2 → tasks 3.1/3.2; 4.2.3 → tasks 3.3/3.4 (+ CSP prod branch, task 1.5); 4.2.4 → task 1.2 (origin gate) + `backend/lib/auth/cookies.ts:160` SameSite=Strict; 4.2.5 → tasks 2.2/2.3.
  - - [x] 5.1.QL: docs are markdown — run sub-loop only on the touched `.ts` docblock files (`app/api/graphql/rate-limit.ts`); markdown needs no quality loop
  - - [x] 5.1.TE: verification = grep audits (each corrected doc greps clean for "stub"/"always succeeds"; readiness rows grep-clean for `☐` in §4.2)
  - - [x] 5.1.SEC: no security-relevant detail is REMOVED — corrections must keep the honest limitations (per-instance, restart-reset) visible
  - - [x] 5.1.SR: every claim in the corrected docs carries a current `path:line` reference (spot-check three)
  - - [x] 5.1.IV: docs-only task — the hand-curated rule-file exclusion is honored
  - Write outcome file: `outcome/5.1-outcome.md`
  - _Requirements: REQ-080 (AC1–AC4)_

- [x] 5.2 Full verification sweep + deferred-items enforcement (BLOCKING GATE)
  - Run the complete matrix and record in `outcome/5.2-outcome.md`:
    ```bash
    bun quality-gate                                  # must pass (resume from last failed stage if partial)
    bun run test/scripts/run-test.ts test/config/sql-injection-static-locks.test.ts
    bun run test/scripts/run-test.ts test/config/xss-static-locks.test.ts
    bun run test/scripts/run-test.ts test/config/security-headers.test.ts
    bun run test/scripts/run-test.ts app/api/graphql/test/graphql-route.transport.test.ts
    bun run test/scripts/run-test.ts app/api/graphql/test/graphql-route.origin.test.ts
    bun run test/scripts/run-test.ts app/api/set-locale/test/set-locale-route.test.ts
    bun run test/scripts/run-test.ts <auth-limiter-suite-paths from 2.2/2.3>
    bun run test                                        # full suite — compare failures vs /tmp/baseline-*.txt
    grep -c "❌\|⚠️" ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/deferred-items.md   # MUST be 0
    ```
  - Baseline comparison: any NEW error vs task-0 baselines is fixed in this task before proceeding (pre-existing failures documented, not fixed here)
  - Ticket-AC final proof (maps to `docs/planning/TICKETS.md:2820-2827` test scenarios): SQLi attempt rejected (3.1/3.2) · XSS sanitized (3.3/3.4) · CSRF prevented (1.2) · auth rate-limited (2.2/2.3) · headers present (1.5) · all fields validated (1.3/1.4 + service suites)
  - - [x] 5.2.QL: per-file sub-loop re-run on anything touched during fixes (exit 0)
  - _Requirements: REQ-001 (AC5, AC6), all REQ-010…REQ-080 (verification), REQ-090_

---

## Phase 6: Knowledge Propagation (MANDATORY FINAL TASK)

- [x] 6.1 Canonical security doc + outcome synthesis
  - Read ALL files in `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/outcome/`
  - CREATE `docs/security/input-validation-and-injection-hardening.md` (`mkdir -p docs/security/` — no matching subdir exists today, verified) consolidating: (1) the parameterized-query rules (Drizzle builder / `sql\`\`` binds / `queryDb` `$N`-index patterns; `sql.raw` zero-tolerance + its static lock); (2) the `escapeLikeWildcards` single-sanitizer contract (`backend/lib/db/escape-like-wildcards.ts:20-29`) + the ilike census + how to extend it; (3) the no-HTML-sink rule + CSV formula neutralization; (4) the CSRF defense matrix (SameSite=Strict cookies, POST/JSON gates, origin gate, WS allowlist, webhook HMAC — one table with `path:line` refs); (5) the rate-limiting topology (transport blanket vs resolver-level auth buckets vs portal vs cron vs WS throttle — limits, key derivations, the single-trusted-proxy XFF assumption and its revisit trigger); (6) the security-header inventory + prod/dev CSP branch. Structure: Why → Pattern → Rules (MUST/MUST NOT) → What NOT to do → Rollout Summary (files modified per this plan) → Related Documents.
  - IF the plan introduced patterns relevant to an existing skill's domain (e.g. the transport-guard extension pattern for `drizzle`/GraphQL skills): add a short section to that skill's SKILL.md referencing the new doc — AGENTS.md and `.agents/instructions/*` are NEVER touched (hand-curated only)
  - - [x] 6.1.QL: sub-loop on any touched non-markdown file (exit 0); the canonical doc itself is markdown
  - Write outcome file: `outcome/6.1-knowledge-propagation-outcome.md`
  - Mark task 6.1 `[x]` here
  - _Requirements: REQ-080 (AC5), REQ-001 (AC4)_

---

## Task Sequencing & Dependency Notes

- 1.1 → 1.2, 1.3 (wire-map rows precede their guards) · 2.1 → 2.2 → 2.3 (IP resolution precedes configs precedes wiring) · 2.4 independent of 2.3 · 3.1 → 3.2 (locks before payloads is NOT required — they are independent; the order is reviewer convenience) · 3.5-GATE after all of Phase 3 · 4.1/4.2 independent of each other · 5.1 AFTER all code lands (it documents shipped state) · 5.2 blocking gate before 6.1.
- Total: 19 tracked items (0, 1.1–1.5, 2.1–2.4, 3.1–3.4, 3.5-GATE, 4.1, 4.2, 5.1, 5.2, 6.1) + the executed 1.5-GATE entry.
- Estimates: every implementation task is sized 2–4 h (5 SP ticket total; the suites are the long pole).

## Post-Implementation Review Wave (MANDATORY — >10 tasks)

After 5.2 and BEFORE 6.1: dispatch `review-types` (the `TransportErrorKind`/Context extensions), `review-backend` (limiter/guard/builder/plan-catalog semantics), `review-frontend` (CSV helper/exporters), `security-probing` (BOLA/BOPLA/BFLA probes on the new guards — origin-gate bypass attempts, batch-cap evasion, limiter key manipulation, CSP string integrity). Aggregate, dedupe, filter to plan files, fix per file cluster with sub-loop verification, re-review until zero findings; write `outcome/post-implementation-review.md`. (Protocol per `spec-driven-development` SKILL — this wave is part of task 5.2's completion criteria.)

---

## Checklist (completion gates — tick ALL before declaring done)

- [x] Every task above is `[x]` with its outcome file present
- [x] `deferred-items.md` greps 0 for `❌\|⚠️`
- [x] All REQ-010…REQ-090 ACs have a task + test reference (traceability matrix in `specs.md` §8)
- [x] `bun quality-gate` passes; full `bun run test` has no NEW failures vs baseline
- [x] Ticket scenarios (`TICKETS.md:2820-2827`) all demonstrably green
- [x] No code comment cites a plan artifact (`grep -rn "REQ-\|Task [0-9]\|Phase [0-9]" backend/ frontend/ app/ shared/ --include="*.ts" --include="*.tsx"` shows no NEW hits introduced by this plan)
