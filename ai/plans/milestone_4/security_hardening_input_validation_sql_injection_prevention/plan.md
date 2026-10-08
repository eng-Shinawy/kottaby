# Design & Implementation Plan: Security Hardening — Input Validation & SQL Injection Prevention

> **Plan directory (verbatim):** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention`
> **Requirements:** `specs.md` (same directory) · **Ticket:** `docs/planning/TICKETS.md:2798-2838` · **Version:** 1.0 · **Date:** 2026-10-08
> **Scope ruling (from specs.md header):** four of six ticket outcomes are substantially shipped; this plan closes the verified gaps: CSRF origin gate, auth rate limiting, transport validation completion (set-locale cap + batch cap), header completion, XSS/SQLi regression locks, CSV formula neutralization, authorization-guard consistency, documentation truth.

---

## 1. Overview

The platform's injection defenses are real but unenforced-by-CI (parameterized queries, `escapeLikeWildcards`, React text-node rendering), its auth surface is rate-limit-free (all auth mutations share one blanket 100/min per-IP bucket), its CSRF posture rests on cookie flags + transport gates with no origin verification on the GraphQL gateway, and its security narrative contains false claims (four "stub limiter" statements). This design adds thin, pure, composable guards at the exact seams the existing architecture already provides — the transport-guard tier, the rate-limit module, the Pothos scope layer, and `next.config.ts` — and converts every verified security fact into a static-lock or payload test so it can never silently regress.

### Design Goals

1. **Close the attacker's cheapest paths first:** credential guessing (auth rate limiting), cross-site cookie replay (origin gate), and request amplification (batch cap).
2. **Zero legitimate-flow breakage:** every guard must pass same-origin browser clients, `*.space-z.ai` preview panels, Bearer-header clients, server-to-server tests, and the existing E2E suites.
3. **Facts → locks:** every "verified by audit today" claim (no `sql.raw`, no HTML sinks, single LIKE sanitizer) becomes a CI-failing static lock.
4. **Fail-closed everywhere new:** the `permission` scope flip, the origin guard, and every new rejection path default to deny; no new bypass flags.

### Key Design Decisions

**Decision 1 — Origin verification at the route tier, not in the engine.**
- **Context:** the cookie-authenticated POST path has no origin check (`app/api/graphql/route.ts:165-213`).
- **Options:** (a) Apollo plugin checking Origin per operation; (b) a pure guard module invoked first in the POST handler; (c) rely on SameSite=Strict alone.
- **Decision:** (b) — new `app/api/graphql/origin-guard.ts` invoked BEFORE `guardTransport`, so cross-site junk never even gets its body drained (cheapest-constant-work-first, the pipeline principle documented at `backend/lib/gateway/transport-guard.ts:26-29`).
- **Rationale:** origin is a request-level property (not per-operation); a plugin would run after body parse + context construction; SameSite=Strict alone leaves subdomain-attacker and legacy-browser edges. Reuses the transport result-union + `transportRejectionResponse` machinery for a correlated, localized 403 with zero new envelope code.

**Decision 2 — Auth rate limiting in the resolvers, not the transport wrapper.**
- **Context:** identity (email) exists only inside the GraphQL operation; `withRateLimit` runs before Apollo parses the body.
- **Options:** (a) name-sniff the raw body in `withRateLimit` (brittle — aliases, formatting); (b) resolver-level enforcement with a `clientIp` field on Context; (c) transport-only IP tightening (no identity bucket).
- **Decision:** (b) — a `clientIp: string` field on `Context` (resolved once in `createGraphQLContext`, `backend/graphql/gqlContextFactory.ts:224`) + `enforceAuthMutationRateLimit` called at the top of the three auth resolvers (`backend/graphql/mutation/auth.mutation.ts:89`, `:118`, `:58`).
- **Rationale:** field-level enforcement is alias-proof (it runs when the `login` FIELD resolves, whatever the operation is called); the context factory is the documented single anchor for per-request wiring (`backend/graphql/AGENTS.md:102`); the transport limiter stays untouched for its blanket role.

**Decision 3 — Batch cap inside `guardTransport`, new wire kinds in the existing taxonomy.**
- **Context:** `allowBatchedHttpRequests: true` (`app/api/graphql/apollo-server.ts:71`) with no per-array bound; the frontend needs batching (`frontend/providers/apollo/AppApolloProvider.tsx:99`). The installed `BatchHttpLink` default is `batchMax = 0` = UNLIMITED (`node_modules/@apollo/client/link/batch/batchLink.js:36`) — a lone server cap would break legitimate dashboard-mount bursts, so the client must declare an explicit `batchMax`.
- **Options:** (a) disable batching (breaks BatchHttpLink); (b) cap array length post-parse in the shared guard, client unchanged; (c) cap server-side AND set an explicit client `batchMax`.
- **Decision:** (c) — `MAX_GRAPHQL_OPERATIONS_PER_REQUEST = 10` exported beside `MAX_GRAPHQL_BODY_BYTES` (`backend/lib/gateway/transport-guard.ts:49`), enforced in `guardTransport` right after `JSON.parse` (`:167`), rejecting with a new `TransportErrorKind` member `BATCH_OPERATION_LIMIT`; simultaneously `BatchHttpLink` gains `batchMax: 10` at its construction site (`frontend/providers/apollo/AppApolloProvider.tsx:99`, with a docblock naming the paired server constant — a provider setting, not a UI change). Same pattern for the origin gate's `CROSS_ORIGIN_REJECTED`. Both new members extend the union at `backend/types/gateway/gateway-context.types.ts:23-27` and get rows in the route's kind→wire map.
- **Rationale:** single canonical transport-constant home; the guard already owns body-shape validation; `apollo-server.ts` stays byte-identical; server cap == explicit client cap, so no legitimate batch can cross the bound.

**Decision 4 — Identity keys are SHA-256 hashes, never plaintext emails.**
- **Context:** the limiter Map is module-level memory; logging exists in the 429 path.
- **Decision:** `authIdentityLimiter` keys are `sha256(email.trim().toLowerCase())` hex digests (node:crypto `createHash`); no plaintext identity in the Map, no plaintext identity in any log line; the resolver logs only the IP + limiter name on exhaustion.
- **Rationale:** the limiter would otherwise become an unbounded in-memory PII cache (10 000-identifier LRU, `backend/lib/ratelimit.ts:51`); hashing is deterministic for bucketing and free.

**Decision 5 — CSP tightened incrementally; nonce CSP deferred.**
- **Context:** CSP ships `script-src 'self' 'unsafe-inline' 'unsafe-eval'` (`next.config.ts:76`); nonce + `strict-dynamic` requires a Next 16 `proxy.ts` and dynamic rendering (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:36-52`).
- **Options:** (a) full nonce CSP now; (b) add the cheap directive wins (`object-src`/`base-uri`/`form-action`/`worker-src`, COOP, CORP, `poweredByHeader: false`) and drop `unsafe-eval` in production only.
- **Decision:** (b); (a) is deferred as D1 because forcing dynamic rendering across every page is a platform-wide change far beyond a 5 SP hardening ticket.
- **Rationale:** `object-src 'none'` + `base-uri 'self'` kill the two remaining script-injection escalation paths that `unsafe-inline` leaves open; `'unsafe-eval'` is dev-only (HMR/Fast Refresh) and no production path needs it (verified: `eval(` has zero production hits); the env branch is read at `headers()` call time so the test pins both branches.

**Decision 6 — `permission` scope flips fail-closed; the real permission layer stays deferred.**
- **Context:** `permission: () => true` (`backend/graphql/pothos/builder.ts:142`) with `ctx.permissions` always `[]` (`backend/graphql/gqlContextFactory.ts:312`); `backend/graphql/AGENTS.md:93-95` recommends the scope as if enforced.
- **Options:** (a) leave the placeholder; (b) implement the permission layer now; (c) flip to fail-closed OR-membership over `ctx.permissions`.
- **Decision:** (c) — `(codes: string[]) => codes.length > 0 && codes.some(p => ctx.permissions.includes(p))`. Zero current consumers (repo-grep verified) → zero behavior change today; any future field that follows the AGENTS.md guidance now denies loudly instead of silently allowing. (b) is D6.

**Decision 7 — No new DB tables, no SDL change, no codegen.**
- **Rationale:** rate limiting is deliberately in-memory per-instance (Redis upgrade is D2); a persistent lockout table is D3; the origin/batch/body-size guards are transport metadata (`TransportErrorKind` is a TS union by contract — `backend/types/gateway/gateway-context.types.ts:6-8`); nothing touches the Pothos schema, so `bun run generate:gqlSchema` / `bun codegen` are NOT in this plan's task list. **Drizzle convention: zero schema changes ⇒ zero `bun run db push` / `bun db migrate` invocations.**

---

## 2. Architecture — Request Pipeline (Before → After)

```mermaid
graph LR
    subgraph "POST /api/graphql (AFTER)"
        A[Origin guard] -->|CROSS_ORIGIN_REJECTED → 403| X((reject))
        A --> B[guardTransport]
        B -->|method/CT/size/parse| C[Batch cap ≥ 10 ops?]
        C -->|BATCH_OPERATION_LIMIT → 400| X
        C --> D[withRateLimit — blanket 100/min per-IP]
        D -->|429 envelope| X
        D --> E[createGraphQLContext — +clientIp]
        E --> F["Apollo engine (authScopes → resolver)"]
        F --> G["auth resolvers: enforceAuthMutationRateLimit (IP 10/min + identity 20/min)"]
        G -->|RateLimitExceededError → RATE_LIMIT_EXCEEDED| Y((200 + errors[]))
        G --> H[AuthService / RegistrationService — unchanged]
    end
```

**Before:** POST → `guardTransport` → `withRateLimit` (blanket) → engine (no origin vocabulary, no batch bound, no auth-specific limit). Pipeline today: `app/api/graphql/route.ts:165-213`.

**Every new guard is fail-closed, pure (no module-level mutable state except the pre-existing bounded limiter Map), and short-circuits before more expensive work.**

---

## 3. Data Models

**Ruling: NO database schema changes.** No new tables, no columns, no enums, no `check()` constraints (existing checks at `backend/db/schema/billing/wallet.ts:37-38` etc. are untouched), no migrations, no seeds. All new state is in-memory or type-level.

### 3.1 New/Updated TypeScript Types

| Type | File | Kind | Exact shape |
|---|---|---|---|
| `TransportErrorKind` (EXTEND) | `backend/types/gateway/gateway-context.types.ts:23-27` | UPDATE — add two members | `\| "CROSS_ORIGIN_REJECTED" \| "BATCH_OPERATION_LIMIT"` appended; docblock kind→status map (`:19-21`) gains `CROSS_ORIGIN_REJECTED → 403`, `BATCH_OPERATION_LIMIT → 400` |
| `Context.clientIp` (EXTEND) | `backend/graphql/gqlContextFactory.ts:49` interface + `:224` factory | UPDATE — new readonly field | `readonly clientIp: string;` — resolved via the shared limiter resolver; documented NON-AUTHORIZATION (correlation/limiting only, same stance as `idempotencyKey` at `:64-71`) |
| `RateLimiterConfig` (reuse) | `backend/lib/ratelimit.ts:24-28` | EXISTING | consumed by the two new configs — no type change |
| `OriginGuardResult` (CREATE) | `app/api/graphql/origin-guard.ts` (new module-local type) | CREATE | `type OriginGuardResult = { readonly ok: true } \| { readonly ok: false; readonly kind: "CROSS_ORIGIN_REJECTED" }` — narrowed into `TransportGuardResult`'s failure arm shape by the route |

### 3.2 New In-Memory State (all bounded)

| Structure | Home | Bound |
|---|---|---|
| `auth-identity:<sha256hex>` windows | the EXISTING `windows` Map (`backend/lib/ratelimit.ts:58`) | shared `MAX_TRACKED_IDENTIFIERS = 10_000` LRU (`:51`, eviction `:65-74`) — no second Map, no second eviction path |
| `auth-ip:<ip>` windows | same Map | same bound |

### 3.3 New Constants

| Constant | Home | Value |
|---|---|---|
| `authIpLimiter` | `backend/lib/ratelimit.ts` (beside `graphqlRateLimiter` `:37-41`) | `{ name: "auth-ip", limit: 10, windowMs: 60_000 }` |
| `authIdentityLimiter` | same | `{ name: "auth-identity", limit: 20, windowMs: 60_000 }` |
| `MAX_SET_LOCALE_BODY_BYTES` | `app/api/set-locale/route.ts` (module-local) | `4_096` |
| `MAX_GRAPHQL_OPERATIONS_PER_REQUEST` | `backend/lib/gateway/transport-guard.ts` (beside `MAX_GRAPHQL_BODY_BYTES` `:49`) | `10` (aligned with client `batchMax` at implementation time — REQ-010 AC3) |

---

## 4. API Contracts

### 4.1 GraphQL SDL — EXPLICIT NO-CHANGE RULING

The Pothos schema is untouched: no new fields, no input/object types, no enum registrations, no SDL delta ⇒ **`bun run generate:gqlSchema` and `bun codegen` are NOT run by this plan.** The only GraphQL-layer edits are (a) scope implementations inside the builder's `authScopes` initializer (`backend/graphql/pothos/builder.ts:127-147`) and (b) `authScopes` option maps in `backend/graphql/mutation/plan-catalog.mutation.ts` — neither changes the SDL surface (scope wiring is runtime-only; the plan-catalog change alters failure CODES for anonymous callers from 403→401, which is a wire-visible behavior fix tracked in REQ-070 AC3, with its role test updated).

### 4.2 Transport Wire Contract (the only wire-level changes)

| Trigger | HTTP | Envelope | Code | Existing machinery reused |
|---|---|---|---|---|
| Cross-origin GraphQL POST (Origin present, not allowlisted; or `Sec-Fetch-Site` cross-site with Origin absent) | 403 | `{errors:[{message,extensions:{code:"FORBIDDEN",requestId}}]}` | `FORBIDDEN` (localized `errorsTranslations.forbidden`) | `transportRejectionResponse` (`app/api/graphql/transport-rejection.ts`) + new map row |
| GraphQL batch array > 10 ops | 400 | same shape | `BAD_REQUEST` (localized `errorsTranslations.badRequest`) | same |
| set-locale POST body > 4 096 B (declared or drained) | 400 | shared API error envelope `{error:{code,message,requestId}}` | `BAD_REQUEST` | `apiErrorResponse` + existing `badRequestError` helper (`app/api/set-locale/route.ts:51-53`) |
| Auth mutation IP bucket exhausted (10/60 s) or identity bucket exhausted (20/60 s) | 200 + `errors[]` (Apollo domain convention — `app/api/graphql/route.ts:163`) | GraphQL errors array | `RATE_LIMIT_EXCEEDED` → taxonomy `RATE_LIMITED: 429` (`backend/lib/errors/error-code-taxonomy.ts:48`) | `RateLimitExceededError` (`backend/lib/errors.ts:186`) passes through the finalizer untouched |
| Cron reconcile route > 100/60 s per IP | 429 | route's existing envelope convention (match `backend/lib/gateway/cron-endpoint.ts:126-134` shape) | `RATE_LIMITED` | `cronSweepRateLimiter` + `checkRateLimit` |

### 4.3 Permission Matrix (all existing surfaces — unchanged by this plan)

| Surface | Guard today | Effect of this plan |
|---|---|---|
| `login`/`registerUser`/`refreshToken`/`logout` | public-by-design (`backend/lib/gateway/public-operations.ts:36-46`) | + rate limit; still public |
| All 58 scoped mutations | `authScopes` (`backend/graphql/pothos/builder.ts:127-147`) | unchanged semantics; `permission` kind flips fail-closed (zero consumers) |
| `createPlan`/`updatePlan`/`setPlanActiveStatus` | `role: [Admin]` | `$all { authenticated, role: [Admin] }` — anonymous 403→401 (REQ-070 AC3) |
| GraphQL transport | method/CT/size guards | + origin gate, + batch cap (pre-authorization tiers — no authorization change) |
| WS handshake / webhook / cron bearer | existing (`backend/ws/notification-ws-server-handshake.ts:62-70`, `backend/services/billing/payment-gateway/paymob/paymob.hmac.ts:107-114`, `backend/lib/api/cron-auth.ts:34-41`) | untouched except cron limiter parity (REQ-052) |

**BOLA/BFLA/BOPLA note:** this plan adds no client-supplied-ID surface, no input spread, and no function-level widening — it only tightens. The origin/batch guards run BEFORE authorization and apply to authenticated and anonymous traffic alike (defense-in-depth, not an authorization tier).

---

## 5. Component & Service Signatures

### 5.1 New module: `app/api/graphql/origin-guard.ts` (CREATE)

```typescript
import type { NextRequest } from "next/server";
import { isAllowedSpaceZOrigin } from "@/app/api/graphql/space-z-cors";        // sibling (app→app OK)
import { getWebSocketAllowedOrigins } from "@/backend/lib/env";                // app→backend OK

export function assertGraphqlPostOrigin(request: NextRequest): OriginGuardResult;
// Pure header evaluation:
//  1. origin = request.headers.get("origin")
//  2. if origin === null → inspect sec-fetch-site: reject unless "same-origin" | "none" | absent
//  3. if origin === request.nextUrl.origin → pass
//  4. if isAllowedSpaceZOrigin(origin) → pass              (space-z-cors.ts:21-31)
//  5. if getWebSocketAllowedOrigins() contains origin → pass (backend/lib/env.ts:523)
//  6. else → { ok: false, kind: "CROSS_ORIGIN_REJECTED" }
```

**Wiring:** first statement inside `POST` before `guardTransport` (`app/api/graphql/route.ts:171`); rejection returns `transportRejectionResponse("CROSS_ORIGIN_REJECTED", request)` — the map row is added in `app/api/graphql/transport-rejection.ts` (403 + localized `forbidden` + requestId). OPTIONS (`:137-139`) and GET/PUT/DELETE/PATCH (`:227-246`) untouched.

### 5.2 `backend/lib/ratelimit.ts` (UPDATE — additive)

```typescript
export const authIpLimiter: RateLimiterConfig;        // { name: "auth-ip", limit: 10, windowMs: 60_000 }
export const authIdentityLimiter: RateLimiterConfig; // { name: "auth-identity", limit: 20, windowMs: 60_000 }

/** Spoof-resistant client IP: x-real-ip → rightmost XFF entry → "local". */
export function resolveClientIp(request: NextRequest | Request): string;

/** Rate limiter identity for auth mutations — SHA-256 of trimmed+lowercased email; "" when absent. */
export function hashAuthIdentity(email: string): string;

/**
 * Resolver-level enforcement for the public auth mutations. Checks the IP
 * bucket first, then the identity bucket when identity !== "". Throws the
 * localized RateLimitExceededError on exhaustion; returns void on pass.
 */
export async function enforceAuthMutationRateLimit(
  input: { readonly clientIp: string; readonly identity: string },
  locale: string
): Promise<void>;

// getClientIdentifier (backend/lib/ratelimit.ts:76-86) becomes a delegation to
// resolveClientIp — all four existing consumers inherit rightmost-XFF semantics
// with zero call-site changes (REQ-051 AC2).
```

### 5.3 `backend/lib/gateway/transport-guard.ts` (UPDATE — additive)

```typescript
export const MAX_GRAPHQL_OPERATIONS_PER_REQUEST = 10;

/** Guard 6.5 — array-batch amplification bound. Non-array bodies pass untouched. */
export function assertBatchOperationCount(body: unknown): TransportGuardResult;
// wired inside guardTransport immediately after the JSON.parse pass/fail (:167):
//   if parsed body is an Array with length > MAX_GRAPHQL_OPERATIONS_PER_REQUEST
//   → fail("BATCH_OPERATION_LIMIT")
```

### 5.4 `backend/graphql/gqlContextFactory.ts` (UPDATE)

- `Context` interface (`:49-99`): add `readonly clientIp: string;` with a NON-AUTHORIZATION docblock.
- `createGraphQLContext` (`:224`): `const clientIp = resolveClientIp(request);` — one resolution site, exposed on the returned object (beside `permissions`/`isSuperAdmin` at `:312-313`).

### 5.5 `backend/graphql/mutation/auth.mutation.ts` (UPDATE — resolvers only)

```typescript
// login resolver (:89) — enforcement FIRST, then normalization, then service:
resolve: async (_root, args, ctx) => {
  await enforceAuthMutationRateLimit(
    { clientIp: ctx.clientIp, identity: hashAuthIdentity(args.email) },
    ctx.locale
  );
  const email = args.email.trim();
  if (email === "" || args.password === "" || args.password.length > MAX_LOGIN_PASSWORD_LENGTH) {
    throw new UnauthorizedError((await ctx.t("authTranslations")).invalidCredentials);
  }
  const session = await AuthService.login(email, args.password, ctx.locale);
  ...  // setAuthCookies unchanged (:96)
};

// registerUser resolver (:58): identity = hashAuthIdentity(input.email) — validation itself stays
//   service-side (backend/services/auth/registration.service.ts:208) — resolver adds ONLY the limit.
// refreshToken resolver (:118): identity = "" (IP-only — REQ-050 AC5); existing trim logic (:123) kept.
// logout: untouched (cookie-clear only, no brute-force surface).
```

`MAX_LOGIN_PASSWORD_LENGTH = 1024` lives module-local in `auth.mutation.ts` (transport-hygiene bound, not a password policy — the policy lives at `registration.service.ts:67` `MIN_PASSWORD_LENGTH = 8`; bcrypt truncates at 72 B regardless, so the bound is a payload-hygiene guard, documented in the constant's docblock).

### 5.6 Repository layer — NO changes

Zero repository files are touched. The S6 payload tests exercise services → repositories as-is.

### 5.7 CSV formula neutralization — EXTRACT the existing helper (CREATE-adjacent)

`frontend/utils/csv-formula.ts` is created by EXTRACTING the already-shipped implementation (`neutralizeCsvFormulas` at `frontend/views/shared/print-export/PrintExportDialog.tsx:36-42` — regex `/^[=+\-@\t\r]/`, `'` prefix) verbatim, so the codebase keeps exactly ONE implementation (no duplicate — `check:duplicates` safe):

```typescript
/** Neutralizes spreadsheet formula injection (CWE-1236): prefixes ' when the
 *  value starts with =, +, -, @, tab, or CR. Pure, idempotent, byte-identical
 *  otherwise. Extracted from PrintExportDialog — the single shared home. */
export function neutralizeCsvFormulas(value: string): string;
```

Applied at the three unguarded cell builders (single-line seam per file): `frontend/views/teacher/wallet/walletLedgerCsv.ts:16` (`csvCell`), `frontend/views/admin/directory-shared/directory-csv.ts:37` (`csvCell`, + docblock correction at `:23-27` whose "intentionally not applied" note becomes stale), `frontend/views/admin/analytics/platform-analytics-csv.ts:50` (`csvCell`); `PrintExportDialog.tsx` drops its local copy and imports the shared helper. The students/applicants exporters delegate into `directory-csv.ts` (`studentsCsvExport.ts:28` → `buildStudentsDirectoryCsv`, `AdminApplicantsPanel.tsx:77` → Blob line) and are covered transitively.

### 5.8 `next.config.ts` (UPDATE)

- Top level: `poweredByHeader: false`.
- `headers()` block (`:48-85`): add COOP + CORP entries; rebuild the CSP string with added directives and a call-time `NODE_ENV` branch for `script-src` (prod drops `'unsafe-eval'`).

### 5.9 `backend/graphql/pothos/builder.ts` (UPDATE)

- `:142`: `permission: () => true` → fail-closed OR-membership (REQ-070 AC1); docblocks `:34-36` + `:140-141` updated (no plan-artifact references in comments).

### 5.10 `backend/graphql/mutation/plan-catalog.mutation.ts` (UPDATE)

- `:24-26`, `:55-57`, `:101-103`: `authScopes: { role: [UserRole.Admin] }` → `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (import `UserRole` already present).

### 5.11 `app/api/set-locale/route.ts` (UPDATE)

- POST body read (`:167-183`): before `request.json()`, declared-length checkpoint + bounded `request.text()` + drained-length checkpoint + `JSON.parse` — local 3-line mirror of the transport-guard dual checkpoint (`backend/lib/gateway/transport-guard.ts:145-164`), rejecting via the existing `badRequestError` envelope. Stale `proxy.ts` docblock refs removed (`:27`, `:72`).

### 5.12 `app/api/cron/reconcile-paymob-payments/route.ts` (UPDATE)

- Inline `checkRateLimit(<ip>, cronSweepRateLimiter)` before the bearer compare, matching the factory's ordering (`backend/lib/gateway/cron-endpoint.ts:126-143`), with the 429 branch mirroring the siblings' envelope.
- `cronSweepRateLimiter` is currently a module-private `const` (`backend/lib/gateway/cron-endpoint.ts:79-83`) — the export is added in the same change (one `export` keyword; the config is NOT duplicated or re-homed).

### 5.13 Concurrency & Race-Condition Assessment

| Surface | Risk | Assessment |
|---|---|---|
| Limiter Map (`backend/lib/ratelimit.ts:58`) | Concurrent read-prune-push races | **None** — `checkRateLimit`'s body is synchronous after entry (`:96-124`); the event loop serializes microtasks, so prune+push is atomic per check. The helper preserves this (no awaits between check and throw). |
| Bounded memory | Unbounded Map growth | **None** — new buckets reuse the SAME bounded Map + LRU eviction (`:51`, `:65-74`); no second store. |
| TOCTOU | Read-then-write DB windows | **None introduced** — no new DB reads/writes; auth resolvers gain no sequential read-write pairs. |
| Origin guard | Statefulness | **None** — pure function of headers; no module state. |
| CSP env branch | Build-time vs runtime skew | `headers()` re-evaluates at invocation; Next calls it under the build/run NODE_ENV; the test pins both branches. |
| Batch cap | Client/server cap drift | Server cap == EXPLICIT client `batchMax: 10` (task 1.3 sets it at `frontend/providers/apollo/AppApolloProvider.tsx:99`; the installed default `0` = unlimited at `node_modules/@apollo/client/link/batch/batchLink.js:36` is overridden, so drift is impossible while both constants carry cross-referencing docblocks). |

### 5.14 Journey Design

**No cross-actor journeys** (ruling + justification in `specs.md` §4). The S6 payload suites extend existing service-level tests; the auth limiter is covered by unit + in-process resolver-level tests (REQ-050 AC7).

### 5.15 `ilike()` Call-Site Census (single source of truth for task 3.1 Lock b)

Counting semantics (the lock MUST implement exactly this): scan `backend/db/repo/**` for `\bilike\s*\(` on a COMMENT-STRIPPED corpus (remove `/* */` blocks and `//` line tails; docblock prose matches — e.g. the lexical caveats documented at `backend/services/parents/parent-link.static-locks.test.ts:395-397` — MUST NOT count). Expected: **8 files / 14 call-site lines / 19 call occurrences** (some lines carry two calls).

| # | File | Call-site lines |
|---|---|---|
| 1 | `backend/db/repo/billing/student-payment.repository.ts` | `:135` |
| 2 | `backend/db/repo/students/student.repository.directory.helpers.ts` | `:103` |
| 3 | `backend/db/repo/teachers/teacher.repository.directory.helpers.ts` | `:90` |
| 4 | `backend/db/repo/teachers/applicant.repository.ts` | `:120` |
| 5 | `backend/db/repo/admin/academic-tracking.repository.ts` | `:119` |
| 6 | `backend/db/repo/admin/admin-user-query-helpers.ts` | `:100`, `:101`, `:104`, `:183` |
| 7 | `backend/db/repo/teachers/teacher.repository.matching.helpers.ts` | `:138`, `:139`, `:141`, `:142` |
| 8 | `backend/db/repo/notifications/broadcast.repository.ts` | `:138` |

Every call site has a verified upstream `escapeLikeWildcards` escape (8 service escape points — `backend/services/admin/teacher-directory.service.ts:70`, `backend/services/admin/student-directory.service.ts:73`, `backend/services/admin/teacher-applicant-directory.service.ts:81`, `backend/services/admin/admin-academic-tracking.service.ts:123`, `backend/services/admin/user-management.query.helpers.ts:112`, `backend/services/teachers/teacher-matching.service.ts:213` + `:243`, `backend/services/notifications/admin-broadcast-lifecycle.service.ts:134`, `backend/services/billing/admin-financial-auditing.service.read.helpers.ts:150`). Two further files match the regex ONLY in docblock prose (`backend/db/repo/admin/admin-user.repository.ts:28`, `backend/db/repo/admin/admin-user-row-types.ts:50`) — comment-stripping keeps them out; if the lock instead pins per-file raw counts, those two files MUST be part of the pinned set with a prose note. The implementing task re-greps and freezes the exact per-line counts before the lock ships.

---

## 6. Error Handling

All new rejections ride EXISTING machinery — no new error classes, no new codes except the two transport kinds: taxonomy-only statuses (`backend/AGENTS.md:92`), envelopes via `transportRejectionResponse` / `apiErrorResponse`, GraphQL domain errors via `RateLimitExceededError`/`UnauthorizedError` pass-through (`backend/graphql/graphqlErrorsFinalizer.ts` contract), masking at the boundary only. The route catch fallback (`app/api/graphql/route.ts:193-208`) already masks unexpected faults.

## 7. Testing Strategy

| Suite | Layer rules | What it proves |
|---|---|---|
| `app/api/graphql/test/graphql-route.origin.test.ts` (NEW) + extend `graphql-route.transport.test.ts` | direct `POST(request)` invocation (existing pattern — transport tests bypass the dev server) | cross-origin 403; absent-Origin pass; `Sec-Fetch-Site: cross-site` reject; space-z/WS-origin pass; batch array 11 ops → 400, 10 ops pass; non-array pass |
| `backend/lib/ratelimit.test.ts` (EXTEND — existing file, verify path at implementation) | pure unit + `clearRateLimitStore()` isolation | rightmost-XFF resolution matrix; `hashAuthIdentity` determinism + no-plaintext; `enforceAuthMutationRateLimit` IP-then-identity order; 429 localization; fail-open catch preserved |
| Auth limiter/resolver tests (in-process: `backend/lib/ratelimit.test.ts` + a new `backend/graphql/test/auth-rate-limit.test.ts` executing the BUILT schema in-process — precedent: the anonymous in-process probes in `backend/graphql/test/schema-surface.test.ts`; `frontend/graphql/test/auth/auth.test.ts` stays wire-level only per `frontend/graphql/test/AGENTS.md` rule 10 — no backend service imports there) | in-process schema execution + `clearRateLimitStore()` isolation + the sanctioned `TEST_CI`/`TEST_SERVER` harness bypass mirrored from the transport tier | enforcement BEFORE service (exhausted bucket + nonexistent email → `RATE_LIMIT_EXCEEDED`, not `UNAUTHORIZED` — proves ordering with zero spies); login trim/empty/cap rejections; refreshToken IP-only; live-server suites unaffected |
| `app/api/set-locale/test/set-locale-route.test.ts` (EXTEND) | direct route invocation (existing file) | declared > 4 096 reject; drained > 4 096 reject; boundary 4 096 pass; malformed JSON unchanged |
| `test/config/security-headers.test.ts` (EXTEND) | config import + env mutation around `headers()` | prod CSP (no `unsafe-eval`, new directives), dev CSP (eval kept), COOP, CORP, `poweredByHeader: false` |
| `test/config/sql-injection-static-locks.test.ts` (NEW) + payload extensions | source-scan precedent (`backend/services/parents/parent-link.static-locks.test.ts:373-397`); DB tests `runInRollback` + `tx` (`backend/db/test/test-utils.ts:34`) | `sql.raw` zero-tolerance; `ilike` census pin; single-sanitizer pin; hostile payloads literal-match-only |
| `test/config/xss-static-locks.test.ts` (NEW) | source-scan | zero dangerous HTML sinks in `app/**` + `frontend/**` production sources |
| `frontend/utils/csv-formula.test.ts` (NEW) + exporter test extensions | colocated frontend test (precedent: `frontend/components/ui/CountrySelector.test.tsx:529`) | formula triggers prefixed; non-triggers byte-identical; idempotence; quoting preserved |
| Cron parity (extend `app/api/cron/reconcile-paymob-payments/test/`, sibling suites as pattern) | direct invocation | limiter fires before bearer compare; 429 shape matches siblings |

**4-Tier emphasis (per task `.TE`):** Tier 4 carries the weight in this plan — every suite above includes the abuse payloads (`'; DROP TABLE`, `%`/`_`/`\` wildcards, `=cmd|'/C calc'!A0`, forged Origin/XFF/sec-fetch-site). Tier 3 covers concurrent bucket exhaustion (`Promise.allSettled` of 11 parallel login-shaped resolver calls → exactly 10 pass). Tier 2 covers boundary values (cap-1/cap/cap+1 bodies and arrays, empty/absent headers). Journey/workflow tests: NOT created (ruling §5.14).

## 8. UX/Navigation Specification (EXPLICIT NO-UI RULING)

| Concern | Ruling |
|---|---|
| New routes | **None.** Zero `app/api/**/route.ts` files added ⇒ the `ROUTE_INVENTORY` append rule (`app/AGENTS.md:65`) does not trigger. |
| Sidebar / bottom nav / tabs | **None.** No `frontend/views/`, no nav stores touched (CSV helper + exporter seams only — no rendering change). |
| Role-based access matrix | Unchanged — see §4.3. No route gains or loses a role. |
| Per-audience rendering | Unchanged for every role (SUPER_ADMIN … GUEST). |
| Permission mapping | Unchanged; `permission` scope semantics flip fail-closed with zero consumers (§5.9). |
| User-visible behavior | Two: (a) a brute-forcing client now receives localized `RATE_LIMIT_EXCEEDED` (already mapped to `RetryableNotice` — `frontend/AGENTS.md:66`); (b) legitimate flows see no change (same-origin clients always passed Origin; BatchHttpLink batches stay ≤ cap). |
| i18n | Zero new keys/namespaces (REQ-002). |

## 9. Security & Tenancy Mitigations

- **BOLA/IDOR:** no new id-bearing surface; guards are pre-authorization and identity-blind. `clientIp` is documented NON-AUTHORIZATION (never used for access decisions — only limiting), mirroring the `idempotencyKey` precedent (`backend/graphql/gqlContextFactory.ts:64-71`).
- **BOPLA:** no `{ ...input }` spreads anywhere in the plan; login normalization builds explicit strings.
- **BFLA:** `permission` scope flips fail-closed (kills the silent-allow trap); public-operation allowlist untouched (`backend/lib/gateway/public-operations.ts:36-46` — no new anonymous operations); plan-catalog tightening is anonymous-403→401 only.
- **Tenancy:** rate-limit keys are IP/identity-hash — no tenant rows touched; CSV neutralization is client-side and role-scoped to data the viewer already sees (`frontend/views/teacher/wallet/walletLedgerCsv.ts:4-9` docblock contract preserved).
- **Info-leak:** rejections echo no origin/identity/input; identity keys hashed (Decision 4); login failure logging stays on the existing `redactEmail` pattern (`backend/services/auth/auth.service.ts:77-85`).
- **DoS posture:** every new check is O(headers) or O(1) Map work BEFORE expensive tiers (body drain, parse, context, DB, bcrypt); limiter bounded; batch cap bounds per-request resolver fan-out.

## 10. Deployment & Compatibility

- Env: **zero new env keys** (origin allowlists reuse `WS_ALLOWED_ORIGINS` at `backend/lib/env.ts:523` + the space-z list; no `resolveEnvConfig` additions ⇒ no `env-config-keys` registration work).
- Rollout: single deploy; no migrations; no feature flags; `TEST_CI`/`TEST_SERVER` harness bypass semantics mirrored by BOTH limiters (`app/api/graphql/rate-limit.ts:34-48` transport tier; `enforceAuthMutationRateLimit` adopts the identical skip + production-guard throw so live-server suites — one shared dev-server process, one `windows` Map, no cross-process reset — cannot flake; the bypass is unreachable in production because the same guard throws outside the test harness).
- Rollback: revert the commit; no persistent state to unwind.
- Monitoring: limiter 429s log via existing `logger.warn` (transport) / `logDomainError` (resolver) with IP + limiter name only.
