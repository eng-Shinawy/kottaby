# Deferred Items Ledger

**Feature:** `Security Hardening — Input Validation & SQL Injection Prevention`
**Plan:** `ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/`
**Ticket:** `docs/planning/TICKETS.md:2798-2838` (Milestone 4 · Dev 2 · 5 SP)
**Created:** 2026-10-08

---

## Purpose

This ledger tracks all work deferred from this plan. Every forward-looking item is a **✅ resolved-pointer**: it names the owning ticket/doc and the composition contract, so nothing is silently dropped and nothing is built twice. The final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target / Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Nonce/`strict-dynamic` CSP (drop `script-src 'unsafe-inline'`) — requires a Next 16 `proxy.ts` (middleware renamed — `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md:11`) + dynamic rendering on every page | specs §2.2 · REQ-060 AC (Decision 5) | Platform/infra hardening backlog — NOT this 5 SP ticket; canonical path pre-documented in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:36-52` | ✅ resolved-pointer | plan.md Decision 5 | This plan takes the cheap wins (`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `worker-src 'self'`, prod `unsafe-eval` removal) so the nonce work starts from a hardened baseline |
| D2 | Redis-backed / cross-instance rate limiting — `@upstash/redis` is declared (`package.json:121`) with ZERO code consumers (verified: `backend/services/redis/` holds only a README; `.env.example:47-59` reserves `UPSTASH_REDIS_REST_URL/TOKEN`) | specs §2.2 · REQ-050 | Rate-limiting hardening stream (reserved `TEST_ENFORCE_RATE_LIMIT` flag per `docs/auth/qiraah-selection-and-c5.md:340`; open gaps tracked in `docs/specs/open-decisions-and-gaps.md`) | ✅ resolved-pointer | grep audit (0 `@upstash` imports) | This plan's in-memory windows are per-instance by design (restart resets, no cross-instance sharing) — the honest limitation is documented in every corrected doc (task 5.1) |
| D3 | Persistent per-account lockout (failed-attempt counters, DB-backed) — DoS-sensitive: naive lockout lets an attacker lock out a victim's account by spamming failures | specs §2.2 · REQ-050 AC8 | Pending product ruling (needs a lockout-policy design: threshold, duration, notify-on-lockout, admin unlock path) | ✅ resolved-pointer | REQ-050 AC8 documents the tradeoff | Interim: per-identity 20/60 s sliding window bounds guessing while self-healing in 60 s — no persistent victim lockout is possible |
| D4 | GraphQL query depth/complexity `ValidationRule` framework (per-operation cost control beyond the body/size/batch transport bounds) | specs §2.2 | Financial Safety Verification ticket — `docs/billing/escrow-and-wallet-crediting.md:116` assigns "any belt-and-braces depth limiter (and a real rate limiter)" decision there | ✅ resolved-pointer | escrow doc §8/D4 assignment | This plan bounds the amplification vector it CAN close cheaply: batch count ≤ 10 (task 1.3) on top of the existing 2 MB body cap (`backend/lib/gateway/transport-guard.ts:49`) |
| D5 | `Cross-Origin-Embedder-Policy` (COEP) — requires every cross-origin subresource to carry CORP/COOP; adding it blind breaks image/font loading | specs §2.2 · REQ-060 | Platform/infra hardening backlog after a full third-party subresource audit | ✅ resolved-pointer | plan.md §9 (DoS/compat posture) | COOP + CORP (the two safe wins) ARE shipped by task 1.5; COEP deliberately excluded |
| D6 | Real permission layer — populate `ctx.permissions` via `PermissionsService.getUserContext(ctx.user.id)` and make the `permission` scope meaningful | plan.md Decision 6 · REQ-070 | Permission-layer stream (intent documented at `backend/graphql/AGENTS.md:93-95`) | ✅ resolved-pointer | builder.ts:142 flip (task 4.1) makes the scope FAIL-CLOSED until then | The fail-closed flip (task 4.1) is the safe interim: any field declaring `permission` denies loudly instead of silently allowing; zero current consumers (grep-verified) |
| D7 | Webhook HMAC hardening — ALREADY SHIPPED (no work owed): Paymob HMAC-SHA512 `timingSafeEqual` (`backend/services/billing/payment-gateway/paymob/paymob.hmac.ts:107-114`), mock HMAC-SHA256 (`backend/services/billing/payment-gateway/webhook-signature.helpers.ts:34-44`), tamper journeys (`test/workflows/billing/paymob-purchase-journey.test.ts:739-786`), canonical discipline (`docs/billing/paymob-gateway.md:88-120`) | specs §2.2 | No owner — resolved-by-prior-work | ✅ resolved-pointer (no-op) | journey tests green | This plan only re-locks the discipline via the S6 payload/static suites (task 3.1/3.2 context); zero webhook code changes |
| D8 | CSP production-eval escape hatch — IF the task-1.5 production build smoke proves a dependency genuinely requires `'unsafe-eval'` in prod, the finding lands HERE with its evidence instead of silently keeping the directive | plan.md REQ-060 AC6 · task 1.5 | task 1.5's outcome file (`outcome/1.5-outcome.md`) closes it either way: smoke passes → resolved-by-verification; smoke fails → the row is rewritten with the dependency name and re-pointed to a follow-up | ✅ resolved-by-verification | task 1.5 prod smoke (see `outcome/1.5-outcome.md`) | NO dependency required eval: `bun run build` (NODE_ENV=production) succeeded, production server booted, `/login` rendered fully with an EMPTY browser console under the eval-free prod CSP (`script-src 'self' 'unsafe-inline'`), zero CSP violations; prod headers captured in the outcome file |
| D9 | `clientIp` optional-in-type fixture debt — `Context.clientIp?: string` is guarded today (compiler narrowing requirement + test pins + factory materialization), but hand-built Context fixtures can silently regress the field to `undefined`; same debt class as the existing `idempotencyKey` | post-implementation review R1 (`review-types`, LOW) · task 2.1 | Future required-field migration: flip `clientIp` (and `idempotencyKey`) to non-optional once the ~15 hand-built fixture files are batch-updated in one sweep | ✅ resolved-pointer | outcome/post-implementation-review.md §2.1/§4 | Review verdict: the optional-in-type deviation is guarded and acceptable now; the migration is the single point that makes the guarantee fixture-enforced instead of convention-enforced |
| D10 | `notImpersonating: true` constant-true scope kind in the Pothos builder — a latent footgun: any field declaring the scope reads as "guarded" but is a no-op today | security review R1 (LOW) · builder authScope surface | Flip the scope fail-closed when an impersonation surface actually lands (zero consumers today, grep-verified — no behavior change owed now) | ✅ resolved-pointer | outcome/post-implementation-review.md §2.4 | Recorded so the footgun is not forgotten: when `notImpersonating` gains its first consumer, it must deny on the impersonating path rather than trust the constant |
| D11 | Deployment contract for edge proxy — the proxy MUST overwrite `x-real-ip` and append `x-forwarded-for`, and pin/validate the `Host` header; limiter keying (spoof-resistant `resolveClientIp`) and origin-gate meaningfulness (same-origin compare is Host-relative) both depend on it | security review R1 (MEDIUM-accepted) + review-backend R1 (LOW) · tasks 2.1/1.2 | Contract is documented in the `resolveClientIp` docblock (`backend/lib/ratelimit.ts`) and the origin-guard docblock; the launch-checklist pin is owned by the production-launch session (`scripts/launch/**` — NOT touched by this plan) | ✅ resolved-pointer (informational) | outcome/post-implementation-review.md §2.4/§4 | Until the checklist pin lands, the docblocks are the single source of the deployment assumption; a proxy that passes client-supplied `x-real-ip` through defeats the limiter keying and a floating `Host` defeats the origin same-origin compare |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

> Row-scoped gate note: the legend above intentionally contains the ❌/⚠️ symbols; the final-gate grep is row-anchored (`^\s*\|.*(❌|⚠️)`) and must count ZERO matching ledger-table rows.

---

## Usage Guidelines

- Add a row (next `D<id>`) when a task discovers work owned by another task/ticket — never defer silently.
- Update status only with a verification reference (outcome file / review round / commit).
- Task outcome files MUST reference this ledger when deferring or resolving ("Resolved D3 (see deferred-items.md)").

## Enforcement

The final quality gate (tasks.md 5.2) MUST verify:

```bash
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/security_hardening_input_validation_sql_injection_prevention/deferred-items.md
# Expected: 0
```

**Exit criteria:** the plan cannot be marked complete if any ❌/⚠️ row remains.
