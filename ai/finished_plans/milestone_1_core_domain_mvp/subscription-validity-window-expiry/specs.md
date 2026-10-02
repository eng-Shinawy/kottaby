# Requirements & Specification: Subscription Validity Window & Expiry

**Plan directory:** this directory (under `ai/finished_plans/milestone_1_core_domain_mvp/`; moved from `ai/plans/` on completion)
**Specs path:** this file
**Plan path:** `plan.md` (this directory)
**Tasks path:** `tasks.md` (this directory)
**Deferred-items ledger:** removed on completion (all items D1–D3 ✅ Done; evidence in PR #156)
**Outcome directory:** removed on completion (evidence in PR #156)

## Document Information

- **Feature Name**: Subscription Validity Window & Expiry
- **Ticket Reference**: `docs/planning/TICKETS.md:540-581` (this ticket, Milestone 1, Dev 1, 3 pts, Blocked By "Segregated Session Balance Crediting" — shipped in `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/`)
- **Target Directory**: `ai/plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/`
- **Outcome Directory**: `ai/plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/outcome/`
- **Companion Plan**: `plan.md`
- **Companion Tasks**: `tasks.md`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Author**: Spec Plan Generator (swarm)
- **Stakeholders**: Dev 1 stream (owner), Planner/PM, QA, sibling Admin Subscription Management ticket (Dev 1, blocked by this one)
- **Decision Refs**: FR-2.4, INV-B3, INV-B6 (`docs/planning/TICKETS.md:579`)

## Introduction

### Feature Summary
A subscription carries a validity window (`start_date` → `end_date`, derived at activation from `plans.interval_days`); a scheduled expiry sweep transitions past-window subscriptions to `status = 'expired'` and zeroes the expired period's remaining session balance (no carryover, INV-B3); students whose funding subscription is expired are rejected at session booking with "Subscription expired" (422 / `SUBSCRIPTION_EXPIRED`), while the trial lane stays bookable (INV-B3 exemption).

### Business Value
Enforces the commercial contract "sessions expire at the end of the interval with no carryover" (FR-2.4, INV-B3): expired credits stop entitling bookings, revenue-impacting stale entitlements are swept automatically, and the canonical `expired` state (already in the `subscription_status` enum and GraphQL schema) begins to be written — unblocking the sibling Admin Subscription Management ticket (`docs/planning/TICKETS.md:583-631`), which renews/extends rows this ticket expires.

### Scope
- **IN**: Validity-window lock-in (AC1 — already implemented; verification & test lock-in only); new externally-triggered cron route + service sweep + guarded repo batch for `active → expired`; period-balance zeroing whose implementable semantic plan.md MUST decide and justify; booking-path expiry rejection with new `SUBSCRIPTION_EXPIRED` domain code and new localized error key (en + ar + type); trial-lane exemption from expiry and from expiry-based denial; journey + service + repo tests; canonical knowledge propagation.
- **OUT**: Admin extend/renew/cancel/upgrade/downgrade, proration, `audit_logs` writes for admin actions, balance-preserving cancel semantics — ALL sibling scope (`TICKETS.md:583-631`); student-facing subscription UI (no such surfaces exist today — see REQ-060 ruling); in-process schedulers, `vercel.json`-style cron generation, or any deployment wiring (none exists — deferred-items D2); parent-purchased expiry administration.

## 1. Executive Summary & Problem Statement

**Verification-first finding (ground truth — research digests `outcome/research-01..04`, all verified against the tree on 2026-09-11):**

| Substrate | State | Evidence |
|---|---|---|
| Validity window written at activation (`endDate = startDate + intervalDays`) | **ALREADY IMPLEMENTED** + unit-tested (AC1) | `backend/services/billing/subscription-activation.service.ts:360-372`; `MS_PER_DAY` at `:96` |
| `subscription_status` enum incl. `expired` | EXISTS — DB pgEnum + TS enum + GraphQL schema enum all aligned | `backend/db/schema/enums.ts:47-53`; `backend/enum/billing/subscription-status.enum.ts:6-12`; `frontend/graphql/generated/schema.graphql:1166-1172` |
| Any writer of `status = 'expired'` | **NOT FOUND** — no expired-transition writer exists | verified grep; activation-service replay comment `subscription-activation.service.ts:354-359` anticipates it |
| Expiry sweep route / service / repo batch | **NOT FOUND** | `app/api/cron/` holds only `sweep-sessions/`; no `findExpiredActive` / `expireMany` in `backend/db/repo/billing/subscription.repository.ts` |
| Cron-route pattern to copy | EXISTS (externally-triggered, fail-closed gates, timing-safe bearer) | `app/api/cron/sweep-sessions/route.ts`; in-process scheduler: **none** |
| Service sweep pattern to copy | EXISTS (one tx, `now` once, guarded batch, counts-only return) | `SessionLifecycleService.sweepExpiredSessions` — `backend/services/classes/session-lifecycle.service.ts:776-808` |
| Booking choke point + `INSUFFICIENT_BALANCE` denial precedent | EXISTS; booking NEVER reads `subscriptions` today | `backend/services/classes/session-lifecycle.booking.ts:95-116,192`; prototype: new check must be inserted |
| `SUBSCRIPTION_EXPIRED` code / "Subscription expired" locale key | **NOT FOUND** — new domain code + new `errors`-namespace key (types + en + ar) required | verified grep; key recipe: `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts`; parity auto-covered by `shared/locale/errors-namespace.parity.test.ts` |
| Per-subscription / per-period balance attribution | **NOT FOUND** — `students` holds flat lane counters only (AC2 tension) | `backend/db/schema/students/students.ts:24-45` |
| Student subscription UI surface | **NOT FOUND** — `/subscriptions` nav link → catch-all `ComingSoonView`; `MySubscriptionsContainer` planned-but-unlanded (paymob plan) | `frontend/views/dashboard/nav/navItems.ts:120`; `app/(dashboard)/[feature]/page.tsx:26-30` |
| Trial exemption (INV-B3) | Documented invariant: `balance_trial` never expires, survives expiry-balance-zeroing | `docs/specs/state-machine-invariants.md:147` |
| Canonical doc anticipates this job | `docs/billing/subscription-purchase.md:359-362` assigns "balance zeroing and status transitions at window end" to the expiry job | this ticket is that job |

**Problem:** Expiry is specified by FR-2.4/INV-B3 but nothing in the system ever transitions a subscription to `expired`, zeroes expired-period balances, or rejects bookings on expiry — the validity window is written but never enforced.

**Actors:** System (external cron trigger + sweep), Student (booking actor, expiry victim, trial holder), foreign Student (no-op observer), unauthenticated caller (route probe).

**Non-goals:** Admin management of subscriptions (sibling), any new UI page/nav item, scheduler infrastructure, per-period attribution ledger (candidate — decision deferred to plan.md; see REQ-023 and deferred-items D1).

## 2. Requirements (EARS)

### 2.0 Execution Protocol & Engineering Discipline

- **REQ-001 (Baseline & Outcome Knowledge Base)**: WHEN implementation begins THEN the executor SHALL record the quality baseline (`bun tsgo`, `bun biome:check`, lint JSON counts) in `outcome/0.1-baseline-outcome.md`, SHALL create `deferred-items.md` (done at spec time — see ledger), SHALL read ALL existing files under `ai/plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/outcome/` (starting with `research-01..04`) BEFORE any task, SHALL write `outcome/<task-id>-outcome.md` after each task, and SHALL flip `tasks.md` checkboxes `[ ]` → `[x]` only with verification evidence.
- **REQ-002 (Per-File Quality Loop)**: WHEN any file is created or modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL pass with exit code 0 (progressive tsgo → oxlint → biome → lint → duplicates, short-circuit on first failure) before the next file is touched; cache files are NEVER cleared.
- **REQ-003 (i18n Compile-Time Discipline — Req 0.5a)**: WHEN any user-facing string is authored THEN services SHALL use `getServerTranslations(locale).errorsTranslations` from `@/shared/locale/server-graphql` with single-argument property access (verified signature `shared/locale/server-graphql.ts:3`; resolver context passes `ctx.locale` — services own their `t`), resolvers SHALL stay thin, and every new key SHALL exist in the types file + `en` + `ar` leaves so `shared/locale/errors-namespace.parity.test.ts` passes. FORBIDDEN: two-arg `getTranslations`, `Translation.*` enums, `next-intl`, `getBackendTranslations`, `shared/messages/`, hardcoded strings.
- **REQ-004 (Test Runner Discipline)**: WHEN DB, service, GraphQL, or journey tests run THEN execution SHALL go through `bun run test/scripts/run-test.ts <path>` (log capture); raw `bun test` is PROHIBITED for DB/service/journey surfaces; `runInRollback` + `tx` propagation is mandatory in DB/service tests (no `expect(...).rejects.toThrow()` inside rollback); journey tests follow `test/workflows/AGENTS.md` rules (no `runInRollback`, committed fixtures, tracked teardown).
- **REQ-005 (Enum Discipline — Req 0.5b)**: WHEN `SubscriptionStatus` is used in a runtime expression THEN it SHALL be imported as a VALUE import from `@/backend/enum/billing/subscription-status.enum` and compared as enum members (never string literals); the GraphQL enum registration already exists — schema/codegen regeneration is required ONLY if the schema surface changes.

### 2.1 Validity Window (AC1 — verification & lock-in)

**Context:** AC1's arithmetic is ALREADY in production (`subscription-activation.service.ts:360-372`). These REQs lock the behavior with tests; they authorize NO re-implementation.

- **REQ-010 (Window Arithmetic Lock-In)**: WHEN a subscription is activated THEN the written row SHALL satisfy `end_date = start_date + plan.interval_days * 86_400_000ms` exactly (both timestamps = `now` captured ONCE in the activation flow), and regression tests SHALL pin this at BOTH the service level and the journey level (existing precedent: `test/workflows/billing/subscription-purchase.journey.test.ts:539` asserts `endDate - startDate === PLAN_INTERVAL_DAYS * MS_PER_DAY`).
- **REQ-011 (Window Semantics per A.9)**: WHEN validity is evaluated THEN `Active` SHALL mean `start_date <= now < end_date` and `Expired` SHALL mean `now >= end_date` (`docs/specs/state-machine-invariants.md:124-135`); `pending` rows (null or future `start_date`) SHALL NOT be sweep-eligible.
- **REQ-012 (Interval Source Discipline)**: WHEN the window is computed THEN `interval_days` SHALL come ONLY from the activating plan row (`plans.interval_days`, CHECK `> 0` at `backend/db/schema/billing/plans.ts:28,41`) — `interval_days` is NOT a `subscriptions` column and SHALL NOT be derived client-side or re-stored on the subscription.

### 2.2 Expiry Job (AC2)

**Context:** No expiry infrastructure exists; the sanctioned shape is the sweep-sessions cron pattern (see research-03 §1).

- **REQ-020 (Cron Route — fail-closed envelope)**: WHEN the expiry job is triggered THEN it SHALL be served by a new GET-only route `app/api/cron/expire-subscriptions/route.ts` mirroring `app/api/cron/sweep-sessions/route.ts` line-for-line: bare-404 unless `CRON_EXECUTION_MODE === "external"` AND `CRON_EXTERNAL_ENABLED === "true"` (via `getEnv`), timing-safe bearer comparison against `CRON_SECRET` (SHA-256 digest + `timingSafeEqual`, 401 masked envelope on mismatch), `apiSuccessResponse`/`apiErrorResponse` envelopes, fixed `locale = "en"`, register in `backend/lib/gateway/route-inventory.ts`. NO new env keys are required (research-03 §6 recommendation); if plan.md adds a dedicated toggle it SHALL follow the raw `getEnv` + `.env.example` recipe.
- **REQ-021 (Sweep Service — shape)**: WHEN the route delegates THEN a new service method (e.g. `SubscriptionExpiryService.expireDue()`) SHALL mirror `sweepExpiredSessions`: one `withTransaction`, `const now = new Date()` captured ONCE, all row writes inside the transaction, counts-only return (`{ expired: number, ... }` — no row ids cross the wire), locale-free (no notification fan-out is in scope for this ticket).
- **REQ-022 (Guarded Batch Transition)**: WHEN the sweep updates rows THEN the repo method SHALL be a single guarded `UPDATE … SET status = 'expired' WHERE status = 'active' AND end_date IS NOT NULL AND end_date <= now()` (SQL-side comparison, UTC timestamps) whose zero-row outcome is the replay/no-op branch — guarding doctrine per house style (`activatePendingOnce` precedent, `subscription.repository.ts:131-149`); re-running the sweep SHALL change nothing; a second concurrent sweep SHALL never produce a different terminal state (idempotent convergence). plan.md SHOULD address sweep efficiency (no index on `status`/`end_date` exists today — the index list in `backend/db/schema/billing/subscriptions.ts:51-55` covers only `user_id`/`plan_id`/partial `payment_reference`).
- **REQ-023 (AC2 Balance Zeroing — semantic DECISION REQUIRED in plan.md)**: WHEN a subscription expires THEN that period's remaining session balance SHALL be zeroed (INV-B3: unused sessions expire at window end, no carryover — `docs/specs/state-machine-invariants.md:147`). BUT the shipped balance model is flat per-student lanes with NO per-subscription attribution (`students.ts:24-45`), so literal per-period zeroing is unimplementable today. plan.md MUST decide and justify ONE implementable semantic before implementation begins, choosing between (or a documented variant of): **(a) conservative lane-conditional zeroing** — zero the expiring plan's credited lane ONLY when no other subscription of the same student credits that lane with `status = 'active'` (post-flip, hence in-window) or `status = 'pending'` (both `active` and `pending` count as coverage — plan.md's chosen guard); **(b) per-subscription allocation ledger** — new schema tracking credit provenance enabling exact per-period zeroing. The decision, its trade-offs vs INV-B3's wording, and rejection of the alternatives SHALL be recorded in plan.md's Key Design Decisions table and ratified in the outcome ledger; deferred-items D1 tracks this. The specs deliberately do NOT smuggle the choice in.
- **REQ-024 (Trial Exemption — INV-B3)**: WHEN zeroing executes THEN `balance_trial` SHALL NEVER be touched — the trial lane is not subscription-bound and persists until consumed by a booking (`state-machine-invariants.md:147`); a student whose subscription lanes zero out but who holds trial credit SHALL retain exactly the trial balance afterward.
- **REQ-025 (Zeroing Atomicity)**: WHEN a subscription's expiry (status flip + balance zeroing) executes THEN both writes SHALL occur inside the same transaction per subscription (or per batch, per plan.md's design) — a crash SHALL never leave `status='expired'` with un-zeroed lanes, nor zeroed lanes with `status='active'` past-window.
- **REQ-026 (Honest Counts & Logging)**: WHEN the route responds THEN the envelope SHALL carry honest counts produced by the guarded updates; expected empty-sweep runs SHALL log at info/debug (no error noise); unexpected failures SHALL surface via `apiErrorResponse` without leaking internal detail; `logger.logDomainError` is reserved for domain-expected outcomes and `logger.error` for anomalies (house logging doctrine — `console.*` PROHIBITED).

### 2.3 Booking Rejection on Expiry (AC3)

**Context:** the booking path never reads subscriptions today (`session-lifecycle.booking.ts:95-116`); "422" = `ValidationError` over GraphQL as HTTP 200 + `errors[].extensions.code` (`backend/lib/errors/error-code-taxonomy.ts:47`; precedent `INSUFFICIENT_BALANCE` at `session-lifecycle.booking.ts:113`).

- **REQ-030 (Expiry Gate in Booking Path)**: WHEN a student's session request would be funded by a subscription lane (`balance_hifz`/`balance_tajweed`/`balance_reviews`) AND no in-window subscription covers that student-lane pair THEN `bookSessionInTx` (or its immediate eligibility predecessor in the createSession order) SHALL reject with `ValidationError("SUBSCRIPTION_EXPIRED", t.subscriptionExpired)` — logged via `logger.logDomainError` exactly as the `INSUFFICIENT_BALANCE` branch does. The check SHALL be lane-aware scoping (subscription lanes gated; trial lane exempt), inserted WITHOUT weakening the existing balance ladder.
- **REQ-031 (Error Contract)**: WHEN the rejection surfaces THEN the GraphQL response SHALL be HTTP 200 with `errors[].extensions.code === "SUBSCRIPTION_EXPIRED"` (VALIDATION family → 422 on REST envelopes; over GraphQL the status-bearing surface is `extensions.code` per `docs/graphql/error-handling-contract.md`); denial SHALL occur BEFORE any debit/insert within the transaction; zero rows SHALL be written on denial.
- **REQ-032 (Localized Copy)**: WHEN the denial message is produced THEN a new `subscriptionExpired` key SHALL exist in `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, and `shared/locale/ar/errors/index.ts` (3 files), self-contained user-facing sentence in each locale (en e.g. "Your subscription has expired." class of copy; ar RTL-safe), and the parity suite SHALL pass unchanged in mechanics.
- **REQ-033 (Trial Still Bookable — denial boundary)**: WHEN a student has an EXPIRED subscription but `balance_trial > 0` THEN the trial lane SHALL still fund the booking per the existing trial-first ladder (INV-B3 — trial is not subscription-bound); the `SUBSCRIPTION_EXPIRED` gate SHALL NOT block trial-funded bookings.
- **REQ-034 (Denial Ordering vs Balance)**: WHEN a student has an expired subscription AND a zeroed subscription lane THEN the surfaced error SHALL be the expiry error per AC3's contract ("Subscription expired"), NOT `INSUFFICIENT_BALANCE` — plan.md SHALL pin the exact predicate order inside the debit ladder so the observable code is deterministic; both denials remain 422/ValidationError-class.

### 2.4 Balance Visibility Within Window (AC4)

- **REQ-040 (In-Window Balance Truthfulness)**: WHILE a subscription is within its validity window (`start_date <= now < end_date`, `status = 'active'`) THEN the student's visible session balance SHALL reflect the remaining funded sessions (existing lane counters, credited at activation and debited at booking — surfaces: `mySubscriptions` returns `startDate`/`endDate`/`status` per `frontend/graphql/generated/schema.graphql:1117-1151`; analytics counters exist). This ticket adds NO new read surface; the REQ pins that expiry work SHALL NOT regress these reads, and the expired rows SHALL report `status = 'expired'` through the already-registered GraphQL enum with NO schema change.

### 2.5 Security, Trust Boundaries & Tenancy

- **REQ-050 (Cron Trust Boundary)**: WHEN the expiry route is hit THEN it carries NO user session; authorization is the bearer-signature check alone; a wrong/missing secret SHALL yield a masked 401 envelope; a disabled mode SHALL yield bare 404 (no existence oracle); the sweep SHALL be system-scope/actor-less (precedent: `sweepExpiredRequests` — `backend/services/parents/parent-link-request.service.ts:27-29`).
- **REQ-051 (No New GraphQL Surface)**: WHEN this ticket ships THEN it SHALL add ZERO GraphQL operations and ZERO authScope changes — `mySubscriptions`/`purchaseSubscription` stay untouched; booking denial rides the existing session-booking mutation's scope gate (`{ $all: { authenticated: true, role: [UserRole.Student] } }` precedent). The role universe remains exactly Admin/Teacher/Student/Parent (`backend/enum/users/user-role.enum.ts:5-10`).
- **REQ-052 (Audit Trail Boundary)**: WHEN the autonomous sweep runs THEN it SHALL NOT write `audit_logs` rows (schema `actor_id` is NOT NULL with no system-actor convention — `backend/db/schema/audit/audit-logs.ts:30-47`; admin-action auditing belongs to the sibling ticket); expiry observability is via structured logs + sweep counts only. If plan.md later elects to introduce a system actor, that decision SHALL be recorded in plan.md with a schema-conforming approach.
- **REQ-053 (Concurrency with Booking)**: WHEN the expiry sweep runs concurrently with a student's in-flight booking THEN the sweep's guarded UPDATE and the booking's transaction SHALL NOT double-spend a unit or strand a half-zeroed lane; a booking authorized under an active subscription racing the sweep SHALL either complete before expiry lands or fail on the post-sweep state — never a torn write (race table + TOCTOU analysis REQUIRED in plan.md §Concurrency; guarded-update doctrine per REQ-022/REQ-030).

### 2.6 UX, Navigation & Client Error Surface

- **REQ-060 (No-UI Ruling — Explicit & Evidence-Backed)**: This ticket ships NO new UI, NO new routes, NO nav changes. Evidence: no `app/(dashboard)/subscriptions/`, no `frontend/views/student/subscriptions/`, no `MySubscriptionsContainer` exist; the student sidebar's `/subscriptions` link (`navItems.ts:120`) renders the pre-existing catch-all `ComingSoonView` (`app/(dashboard)/[feature]/page.tsx:26-30`) and remains so; the paymob plan's subscription screens are planned-but-unlanded (`ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/plan.md:263-264`). The GraphQL schema ALREADY exposes `SubscriptionStatus.Expired` + `startDate`/`endDate`, so when those screens land they render the expired state for free from this ticket's data. No bottom nav exists to change (verified negative).
- **REQ-061 (Booking-Dialog Error Arm — deferred to the surface that lands the booking UI)**: WHEN `SUBSCRIPTION_EXPIRED` travels to the browser THEN this ticket SHALL ship ZERO frontend changes — justified by two verified facts, NOT by a fallback that does not exist: (1) **no wired UI consumer of the booking mutation exists** (`createSessionMutationDocument`, `frontend/graphql/sharedDocuments/scheduling/session-lifecycle.documents.ts:48`, is referenced only by its own document file and `documents.contract.test.ts` — grep-verified 2026-09-12), so no dialog can render the denial this milestone; (2) the client error map has **no row for custom domain codes** (`normalizeGraphQLErrorCode` folds only the `RATE_LIMIT_EXCEEDED` legacy alias, `frontend/providers/apollo/error-link.map.ts:58-65`; `mapValidationRow` matches the literal `VALIDATION` only, `:242-258`; unmapped codes return `null` per the dispatcher's documented "anything else → null" contract), so `SUBSCRIPTION_EXPIRED` renders nothing client-side today. The localized copy is therefore delivered server-side inside the `ValidationError` message (request locale) alongside `extensions.code`; WHEN the student booking UI lands (future sessions/paymob surface) THEN its error arm SHALL map `SUBSCRIPTION_EXPIRED` to the localized snackbar via the new `subscriptionExpired` key — that arm is REQUIRED at that landing and stays deferred here (deferred-items D3).

### 2.7 Testing Obligations

- **REQ-070 (AC1 Lock-In Tests)**: WHEN AC1 is verified THEN existing activation tests SHALL be confirmed green, AND the service-suite SHALL include explicit `endDate - startDate === intervalDays * 86_400_000` assertions (journey precedent `subscription-purchase.journey.test.ts:539`; use `secondPrecisionMs` — `test/workflows/helpers/second-precision.ts:21` — for timestamp comparison), INCLUDING Tier-2 boundary probes: minimum `intervalDays = 1`, leap-day-adjacent activation, and `plans.interval_days = 0`/`null` impossible-by-CHECK confirmations where reachable.
- **REQ-071 (Repo & Service Tests — sweep)**: WHEN the sweep ships THEN repo tests under `runInRollback` (`backend/db/test/test-utils.ts:34`; try/catch helper, never `.rejects` inside rollback) SHALL cover: active-past-window → expired; active-in-window untouched; pending rows untouched; `cancelled`/`suspended` rows untouched; null `end_date` untouched; re-run = zero-row idempotency; zeroing respects REQ-024 trial exemption; zeroing honors the plan.md-chosen REQ-023 semantic incl. its shared-lane guard case. Service tests SHALL follow the 4-tier framework (T1 branches; T2 boundary `end_date == now`; T3 chaos: concurrent sweep ×2 and sweep-vs-booking via `Promise.allSettled`; T4 abuse: n/a beyond route T4 — see REQ-072).
- **REQ-072 (Cron Route Tests)**: WHEN the route ships THEN route tests SHALL cover: disabled → bare 404; wrong/missing bearer → masked 401; happy path → envelope with honest counts (env gymnastics precedent `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts:66-74`); no query-string secret accepted.
- **REQ-073 (Booking-Denial Tests)**: WHEN the expiry gate ships THEN service tests SHALL prove: expired-subscription + subscription-lane funding → `SUBSCRIPTION_EXPIRED` before any write; expired-subscription + `balance_trial > 0` → booking SUCCEEDS via trial lane (INV-B3); in-window subscription → unchanged behavior; denial appears in GraphQL shape as `extensions.code === "SUBSCRIPTION_EXPIRED"`.
- **REQ-074 (Journey Test)**: WHEN implementation lands THEN `test/workflows/billing/subscription-expiry.journey.test.ts` SHALL exist following `test/workflows/AGENTS.md` (committed fixtures, `TrackedFixtures` teardown, `journeyPrefix("billing")`, no `runInRollback`, `catchJourneyError`), encoding §3's journeys end-to-end: activate → force-expire ([time manipulation per fixture precedent `entity-setup.ts:208-218` expired-row shape / direct `endDate` backdating] ) → sweep → assert status + zeroed lane + intact trial → booking denial `SUBSCRIPTION_EXPIRED` → trial booking success; run via `bun run test/scripts/run-test.ts test/workflows/billing/subscription-expiry.journey.test.ts`.
- **REQ-075 (Regression Pin)**: WHEN this ticket lands THEN the existing suites SHALL stay green unchanged: activation tests, booking suites, `shared/locale/errors-namespace.parity.test.ts`, route-inventory static assertions (extended for the new cron route), and the blocking ticket's suites (`Segregated Session Balance-crediting`).

### 2.8 Knowledge Propagation & Spec Hygiene

- **REQ-080 (Canonical Doc)**: WHEN the plan completes THEN `docs/billing/subscription-validity-window-expiry.md` SHALL be created as the canonical reference (window arithmetic, sweep design, REQ-023 zeroing semantic + rationale, booking gate, cron contract, trial exemption).
- **REQ-081 (Invariant Addendum)**: WHEN propagation runs THEN `docs/specs/state-machine-invariants.md` SHALL gain an INV-B3 implementation note recording the chosen zeroing semantic (REQ-023) and the `active → expired` writer existence (A.9 table's "Expired" transition now has a producer).
- **REQ-082 (AGENTS Cross-Refs & No Plan-Meta)**: WHEN propagation runs THEN ≤2-line cross-refs SHALL be added to `backend/AGENTS.md`/`backend/services/AGENTS.md` per convention, AGENTS.md/instruction files are otherwise NEVER modified by plan work, and code SHALL contain NO plan-meta comments (no REQ ids, task ids, or plan paths in code comments/JSDoc).

## 3. Cross-Actor Workflow Scenarios (Journeys)

### Actor Table

| Actor | Identity | Can do | Cannot do |
|---|---|---|---|
| System (External scheduler) | Cron caller with `CRON_SECRET` | trigger the sweep route | act with a user session; run when disabled (404) |
| Student A | `UserRole.Student` with active subscription + funded lane | book sessions within the window | book subscription-funded sessions after expiry; spend other students' balances |
| Student A (trial facet) | same student holding `balance_trial > 0` | book trial-funded sessions even after expiry | — |
| Student B (observer probe) | unrelated student | unaffected by A's expiry | be swept/zeroed by A's expiry |
| Unauthenticated caller | no session | — | trigger the cron route (401); book (401) |

### Ordered Step List (Happy Path → Expiry Path)

1. Student A activates a plan (`intervalDays = 30`) → row committed with `status='active'`, `startDate`, `endDate = startDate + 30 days`; lanes credited by the blocking ticket's machinery. *(Shared-state writes: `subscriptions`, `students` lanes.)*
2. Student A books within window → booking succeeds; lane decrements; balance reflects the remaining funded sessions (AC4).
3. Time passes beyond `endDate` (fixture backdating in tests) → NO state change yet; row remains `status='active'` (window-vs-status lag is expected — sweep closes it).
4. System (external scheduler) → `GET /api/cron/expire-subscriptions` with valid bearer → sweep runs in one transaction: Student A's subscription flips to `expired`; the period's remaining lane balance zeroes per the REQ-023 semantic; counts returned in the envelope.
5. System re-runs the sweep → zero-row replay; nothing changes (idempotent convergence).
6. Student A → attempts a subscription-lane-funded booking → rejected `SUBSCRIPTION_EXPIRED` (422/VALIDATION family) with localized "Subscription expired" copy; zero writes.
7. Student A (trial facet) → requests the same session with `balance_trial > 0` → booking SUCCEEDS via the trial lane even though the subscription is expired (INV-B3).
8. Student B (probe) → reads own state → absolutely unchanged by Student A's expiry (no cross-tenant effect by construction).

### Denial / Probe Steps

9. Unauthenticated caller → route → bare 404 when disabled; masked 401 when enabled without a valid secret.
10. Scheduler replay / double-fire → zero-row guarded update; honest zero counts.
11. Sweep during Student A's in-flight booking → either booking completes pre-expiry or fails post-expiry; never double-spent, never torn zeroing (REQ-053).

### Cross-Actor EARS Criteria (observer-perspective)

- WHEN the sweep expires Student A's subscription THEN Student B's subscriptions, lanes, and trial balances SHALL be byte-identical before and after.
- WHEN Student A's subscription is expired THEN Student A's `mySubscriptions` SHALL show `status = Expired` with the ORIGINAL unchanged `startDate`/`endDate` (sweep mutates status + balances only), and Student B SHALL see no row of A's (existing owner-scope unchanged).
- IF Student A's subscription is expired AND `balance_trial > 0` THEN the booking surface SHALL still complete a trial-funded booking while subscription-lane booking fails — the two outcomes co-exist without interference.
- WHEN an unauthenticated or wrongly-secreted caller hits the cron route THEN zero subscription rows SHALL change.

## 4. UX/Navigation Requirements

### New Routes & Role-Based Access

| Route | Purpose | Permission | Roles with Access |
|---|---|---|---|
| `GET /api/cron/expire-subscriptions` (NEW) | Expiry sweep trigger | Bearer `CRON_SECRET` via timing-safe digest compare; fail-closed mode gates | System (external scheduler) — no user role |
| (none — pages) | — | — | — |

**No new page routes, no new GraphQL operations.** The denial exists at the GraphQL error surface of session booking (HTTP 200 + `errors[].extensions.code === "SUBSCRIPTION_EXPIRED"` + server-localized message). It is NOT rendered client-side this milestone: no wired `createSession` consumer exists in `frontend/` (verified negative) and the client error map has no custom-domain-code row (REQ-061).

### Sidebar Navigation Placement

UNCHANGED — no new nav items, no bottom nav (none exists). The pre-existing Student `/subscriptions` entry continues to render `ComingSoonView`; surfacing expired state in subscription UI belongs to the paymob plan's unlanded screens, not this ticket (REQ-060).

### Role-Based Access Matrix

| Role | Cron route | Booking impact | UI delta |
|---|---|---|---|
| Admin | ❌ (no user access at all) | none | none |
| Teacher | ❌ | none | none |
| Parent | ❌ | none | none |
| Student | ❌ | `SUBSCRIPTION_EXPIRED` denial on expired subscription-lane funding | none this milestone (server-localized message + `extensions.code`; snackbar arm lands with the booking UI — REQ-061) |
| System scheduler | ✅ (bearer-gated) | — | — |

## 5. Non-Functional Requirements

### Performance
- WHEN the sweep runs THEN it SHALL execute as a bounded set of guarded batch updates within one short transaction (target < 500ms p99 locally, mirroring `sweepExpiredSessions`); plan.md SHALL state the batching/indexing approach given no `status`/`end_date` index exists today.
- WHEN booking executes THEN the new expiry gate SHALL add at most one indexed constant-time read per booking inside the existing transaction (no N+1, no extra round-trips outside the tx).

### Security
- WHEN the cron route receives a wrong/missing secret THEN the comparison SHALL be timing-safe and the response masked (no oracle, no body detail).
- WHEN the sweep writes THEN it SHALL never log raw row contents or user PII beyond ids/counts; `console.*` PROHIBITED.

### Reliability
- WHEN the sweep transaction fails mid-flight THEN ALL writes roll back (no half-swept cohort).
- WHEN the sweep double-fires (duplicate scheduler delivery) THEN the second run SHALL be a provable no-op (zero-row guards).

### Usability / Localization
- WHEN the booking denial surfaces THEN the en + ar copies SHALL be parity-complete and RTL-safe; no hardcoded strings anywhere.

## 6. Constraints & Assumptions

### Technical Constraints
- Drizzle schema changes (if the REQ-023 decision selects an allocation ledger) follow `bun run db push` for schema DDL and `bun db migrate` for custom SQL; `db reset`/`cleanGenerate` are repo-policy disabled.
- No `--` comments inside Drizzle `sql` templates; single guarded-statement transitions only (no SELECT-then-UPDATE, no advisory locks).
- Cron precedent is GET-only + `route-inventory.ts` registration + static-assertions test extension.
- 422-over-GraphQL = HTTP 200 + `extensions.code`; there is no HTTP-422 surface on GraphQL.

### Business Constraints
- Expiry ZEROES the expired period's remainder (AC2); sibling CANCEL preserves balance (`TICKETS.md:606-609`) — this asymmetry is intentional and must be preserved inviolate.
- Trial credit is never expired, never attributed to any subscription (INV-B3).
- No carryover under any circumstance (FR-2.4).

### Assumptions
- The blocking ticket's flat-lane model and crediting remain as shipped; this ticket consumes, not rebuilds.
- An external scheduler trigger will be wired at deployment (deferred D2); the repo side ships the fail-closed route.
- Booking-time eligibility continues to be primarily balance-based; the expiry gate is a narrow lane-aware addition, not a redesign of the ladder.

## 7. Success Criteria

### Definition of Done
- [ ] All REQ-0xx criteria met; `tasks.md` fully checked with evidence outcomes
- [ ] `bun quality-gate` green; zero new errors vs baseline (`outcome/0.1-baseline-outcome.md`)
- [ ] plan.md records the REQ-023 zeroing decision with justification; ledger D1 resolved
- [ ] Journey + repo + service + route tests green via `run-test.ts`
- [ ] `deferred-items.md` has zero ❌/⚠️ at the Phase 7 gate; D2's external-trigger wiring documented as deployment note
- [ ] Canonical doc (REQ-080) + invariant addendum (REQ-081) + cross-refs (REQ-082) landed

### Acceptance Metrics
- Expired subscription sweep: exactly the past-window active rows flip, exactly once (replay = zero).
- Expired student's subscription-lane booking: `extensions.code === "SUBSCRIPTION_EXPIRED"`; trial-lane booking: success.
- A second student's balances: untouched (delta zero across every probe).

## 8. Glossary

| Term | Definition |
|---|---|
| Validity window | `[start_date, end_date)` on `subscriptions`; `end_date = start_date + plans.interval_days × 86_400_000ms` at activation |
| Expiry sweep | The new cron-triggered batch transition `active → expired` for past-window subscriptions + balance zeroing |
| Lane | One of `balance_hifz` / `balance_tajweed` / `balance_reviews` on `students`; the unit of balance zeroing (flat, unattributed) |
| Trial lane | `balance_trial` — INV-B3-exempt: never expired, never zeroed by the sweep, still books post-expiry |
| Guarded transition | Single-statement `UPDATE … WHERE <predicate> … RETURNING`; zero rows = replay/no-op branch |
| Subscription lane pair | (student, plan's `balance_lane`) — the unit the booking expiry gate evaluates |
| REQ-023 semantic | plan.md's mandated decision between conservative lane-conditional zeroing and a per-subscription allocation ledger |
