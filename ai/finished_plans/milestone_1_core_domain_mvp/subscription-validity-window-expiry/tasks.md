# `tasks.md` — Subscription Validity Window & Expiry

**Plan directory:** this directory (under `ai/finished_plans/milestone_1_core_domain_mvp/`; moved from `ai/plans/` on completion)
**Specs:** `specs.md` · **Plan:** `plan.md` · **Ledger:** removed on completion (D1–D3 ✅ Done) · **Outcomes:** removed on completion

**Nature of this ticket:** backend-only enforcement of an already-written validity window — AC1 is verification/lock-in only (no re-implementation), AC2 is a new externally-triggered cron route + sweep service + two guarded repo statements + one partial index implementing Decision D2 (O1 conditional lane zeroing), AC3 is a narrow failure-branch insertion into the existing booking debit ladder (Decision D3). Zero GraphQL delta (D4), zero new env keys (D1), zero UI (REQ-060), ride the existing VALIDATION snackbar fallback (D7).

## Document Information

- **Feature**: Subscription Validity Window & Expiry · **Ticket**: Milestone 1, Dev 1, 3 pts (`docs/planning/TICKETS.md:540-581`)
- **Version**: 1.0 · **Date**: 2026-09-11

### Numbering & Traceability Conventions

- Task ids `X.Y` follow phases below; every implementation task carries the standard pipeline suffixes: `.QL` (quality loop `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, exit 0), `.TE` (4-tier tests), `.SEC` (BOLA/BOPLA/BFLA audit), `.SR` (semantic review checklist), `.IV` (instruction verification — read ALL AGENTS.md + `.agents/instructions/*.instructions.md` files printed by `sub-loop.ts`, listed as absolute paths per task).
- Outcome files: `outcome/<task-id>-outcome.md` per completed task (MANDATORY).
- Every task declares `_Requirements: REQ-…_` with EXPANDED id lists (no ranges) so traceability is grep-verifiable.
- Tests run via `bun run test/scripts/run-test.ts <path>` ONLY (REQ-004); NEVER raw `bun test`.
- Deferred-items ledger guards: **D1** (REQ-023 semantic — O1 ratified in plan.md Decision D2) is guarded by task 1.1 (plan-review ratification) and implemented by 4.2/5.1; **D2** (external scheduler wiring — ops handoff) is guarded by 6.1 (fail-closed route ships) and 9.1 (canonical doc records the handoff); **D3** (booking-dialog error arm) is deferred to the future booking-UI surface by plan.md Decision D7 — no wired `createSession` consumer exists and the client error map has no custom-domain-code row, so there is nothing to arm this milestone; its closure is recorded at 1.1 (plan-review ratification) and the requirement-to-arm-at-landing is written into 9.1's canonical doc.

## Non-Negotiable Execution Protocol

1. **Read `outcome/` first** — before ANY task, read every existing file in `ai/plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/outcome/` (starting with `research-01..04`).
2. **Per-file loop** — after each file edit, `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` must exit 0 before the next file (progressive tsgo → oxlint → biome → lint → duplicates; caches NEVER cleared).
3. **Semantic review before `[x]`** — race conditions, env-config (raw `getEnv` only — there is NO `env-config-keys.ts`), dead code, cross-layer imports, enum value imports, deferred items.
4. **No plan-meta in code** — comments/JSDoc never reference REQ ids, task ids, or plan paths.
5. **Evidence or it didn't happen** — checkboxes flip only with outcome-file evidence; write `outcome/<task-id>-outcome.md` after each task.
6. **Anti-pattern safelist (verified negatives — do NOT introduce):** `Translation.` enum · two-arg `getTranslations` · `LocaleType` · `@/frontend/utils/logger` in backend (use `@/backend/lib/logger`) · raw `bun test` · bottom-nav items · `scripts/cron-worker.ts` · `backend/services/cron/` · `vercel.json` · `env-config-keys.ts` · `backend/lib/auth/require-permission.ts` · `jscpd:ignore` comments · `--` comments inside Drizzle `sql` templates.

## Implementation Overview

Foundation-first: schema index → types → locale key → **journey test FIRST (RED)** → repos → services (journey GREEN) → route → AC1 lock-in/regression → mid-point review → final gate → knowledge propagation. Task sizes target 2–4h each; every move mirrors a verified precedent (sweep-sessions cron route, `sweepExpiredSessions`, `activatePendingOnce` guarded-update doctrine).

## Phase 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0.1 Record baseline & confirm ledger
  - Run `bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`; store counts in `/tmp/baseline-*.txt`.
  - Confirm `deferred-items.md` exists (authored at spec time, closed at the Phase 1.5 gate: D1 ✅ and D3 ✅ ratified by `outcome/plan-review-R1.md`; D2 ❌ is the sanctioned open item — its resolution is the 9.1 documented ops handoff; all other statuses must be ✅ before 8.1's gate).
  - Write `outcome/0.1-baseline-outcome.md` with counts + environment notes.
  - _Requirements: REQ-001_

## Phase 1.5: Plan Review Gate (MANDATORY — executed at planning time)

- [x] 1.1 Plan review via `@plan-review` skill
  - Verdict + fixes recorded in `outcome/plan-review-R1.md` BEFORE any implementation task starts; the gate ratifies plan.md Decisions D1–D7 verbatim (no redesign) — this closes ledger **D1** (O1 semantic ratified) and **D3** (no wired booking-UI surface exists; the snackbar arm is deferred to the ticket that lands it, per corrected Decision D7).
  - _Requirements: REQ-001_

## Phase 2: Foundation (Schema · Types · Locale)

- [x] 2.1 Partial index on `subscriptions` (Decision D5)
  - EXTEND `backend/db/schema/billing/subscriptions.ts` index list with `index("subscriptions_active_end_date_idx").on(t.endDate).where(sql`…status = 'active'…`)` — same `.where(sql\`…\`)` idiom as the existing partial unique index in that file; NO `--` comments inside any `sql` template.
  - Apply DDL via `bun run db` (push path per schema AGENTS + tasks-template convention); verify drift-free; NO custom SQL migration (guarded UPDATEs are app-level parameterized statements).
  - [x] 2.1.QL · [x] 2.1.TE (schema-shape compile + push verification; index present in reflected schema) · [x] 2.1.SEC · [x] 2.1.SR · [x] 2.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/schema/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`)
  - Write `outcome/2.1-outcome.md`
  - _Requirements: REQ-002, REQ-022_

- [x] 2.2 Canonical types EXTEND
  - EXTEND `backend/types/billing/subscription.types.ts` with `ExpiredDueSubscriptionRow` (`{ readonly id; readonly userId; readonly planId }` — batch-flip RETURNING projection) and `SubscriptionExpirySweepReturnType` (`{ readonly expired; readonly lanesZeroed }` — counts-only contract); barrel via existing `export *`; NO service-layer `.types.ts`.
  - [x] 2.2.QL · [x] 2.2.TE (type-level compile: whole-repo tsgo green) · [x] 2.2.SEC · [x] 2.2.SR · [x] 2.2.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`)
  - Write `outcome/2.2-outcome.md`
  - _Requirements: REQ-002, REQ-021_

- [x] 2.3 Locale key `subscriptionExpired` (3 files — REQ-032 recipe)
  - (1) Type: `shared/locale/types/errors/labels.ts` — `ErrorsLabels` flat entry beside `insufficientBalance` (docblock: self-contained sentence, no identifiers); (2) `shared/locale/en/errors/index.ts`; (3) `shared/locale/ar/errors/index.ts` (RTL-safe). Errors namespace already wired — NO `message.ts` registration, NO new namespace.
  - FORBIDDEN: `Translation.*` enum, two-arg `getTranslations`, `next-intl`, `getBackendTranslations`, `shared/messages/`, hardcoded strings.
  - [x] 2.3.QL · [x] 2.3.TE (`shared/locale/errors-namespace.parity.test.ts` via `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` green) · [x] 2.3.SEC · [x] 2.3.SR · [x] 2.3.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md`)
  - Write `outcome/2.3-outcome.md`
  - _Requirements: REQ-002, REQ-003, REQ-032_

## Phase 3: Journey Test FIRST (RED skeleton → GREEN after Phase 5)

- [x] 3.1 Journey suite `test/workflows/billing/subscription-expiry.journey.test.ts` (CREATE — test-first)
  - Encode plan.md §5.3 state machine + side-effect matrix end-to-end: activate (existing activation path) → assert window arithmetic `endDate - startDate === PLAN_INTERVAL_DAYS * MS_PER_DAY` via `secondPrecisionMs` (`test/workflows/helpers/second-precision.ts:21`) → backdate `endDate` (expired-row fixture precedent `backend/db/test/entity-setup.ts:208-218`, direct Drizzle backdate) → `SubscriptionExpiryService.expireDue()` → assert `status = Expired` + original `startDate`/`endDate` unchanged + lane zeroed (uncovered case) + `balance_trial` intact → booking denial `extensions.code === "SUBSCRIPTION_EXPIRED"` via `expectSingleDenial`-shape assertion + zero writes on denial → trial-lane booking SUCCEEDS (INV-B3) → Student B probe byte-identical (direct read-back oracles) → sweep replay ⇒ `{ expired: 0, lanesZeroed: 0 }` honest zero counts.
  - Rules per `test/workflows/AGENTS.md`: ONE committing `beforeAll` transaction; `TrackedFixtures` teardown with post-teardown re-probes (`test/workflows/helpers/tracked-fixtures.ts`); `journeyPrefix("billing")`; `provisionStudentActor` (`test/workflows/helpers/actor-context.ts`); NO `runInRollback`; `catchJourneyError` + translated substrings; side effects spied at the seam (`spyOn(NotificationEngine, "publishReceipts").mockImplementation(...)` precedent — billing journey `subscription-purchase.journey.test.ts:142`).
  - Run: `bun run test/scripts/run-test.ts test/workflows/billing/subscription-expiry.journey.test.ts` — expected RED until 5.2 ships; checkpoint re-run GREEN.
  - [x] 3.1.QL · [x] 3.1.TE (this IS the Tier-4 capstone for the whole ticket) · [x] 3.1.SEC (cross-student isolation probe is part of the suite) · [x] 3.1.SR · [x] 3.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/3.1-outcome.md`
  - _Requirements: REQ-002, REQ-004, REQ-010, REQ-011, REQ-024, REQ-025, REQ-031, REQ-033, REQ-034, REQ-040, REQ-053, REQ-061, REQ-074_

## Phase 4: Repositories (guarded-transition doctrine)

- [x] 4.1 `SubscriptionRepository` extensions
  - EXTEND `backend/db/repo/billing/subscription.repository.ts`: `expireDueActive(now: Date, tx?)` — ONE guarded `UPDATE … SET status='expired', updated_at=now() WHERE status='active' AND end_date IS NOT NULL AND end_date <= $now RETURNING id, user_id, plan_id` (enum VALUE import of `SubscriptionStatus`; explicit `updated_at` stamp mirroring `activatePendingOnce` — `$onUpdate` bypassed by raw set); `hasUncoveredExpiredLane(studentId, lane, tx?)` — single tx-bound `EXISTS(expired row on lane) AND NOT EXISTS(pending OR in-window active on lane)` probe, bound parameters only, used ONLY inside the booking transaction (no `queryDb` variant per bare-reads rule).
  - [x] 4.1.QL · [x] 4.1.TE — CREATE `backend/db/test/logic/billing/subscription-expiry.repository.test.ts` (`runInRollback` + `tx` on EVERY call; try/catch helper, never `.rejects.toThrow` inside rollback): past-window active→expired; in-window untouched; `pending` untouched; `cancelled`/`suspended` untouched; null `end_date` untouched; re-run = zero-row idempotency; T2 boundary `end_date == now` IS due (A.9: `now >= end_date`); T3 concurrent `expireDueActive` ×2 identical terminal state; `hasUncoveredExpiredLane` truth table (expired-only → true; expired+covering-active → false; expired+pending-cover → false; none → false) · [x] 4.1.SEC (tenancy: predicates key on `user_id`) · [x] 4.1.SR · [x] 4.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/logic/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/4.1-outcome.md`
  - _Requirements: REQ-002, REQ-004, REQ-005, REQ-011, REQ-022, REQ-050, REQ-071_

- [x] 4.2 `StudentRepository.zeroLaneIfNoCoveringSubscription` + helper (Decision D2 = O1; guards ledger D1)
  - EXTEND `backend/db/repo/students/student.repository.ts` with ONE guarded UPDATE: `SET balance_<lane> = 0, updated_at = now() WHERE id = $1 AND COALESCE(balance_<lane>,0) > 0 AND NOT EXISTS (subscriptions ⨝ plans: same user, same `balance_lane`, `status IN ('active','pending')`) RETURNING id`; returns `true` iff row matched (honest `lanesZeroed`).
  - CREATE `backend/db/repo/students/student.repository.zero-lane.helpers.ts`: frozen lane→column map keyed by `SubscriptionCreditLane` (three members incl. `reviews`), mirroring the `student.repository.credit-lane.helpers.ts` extraction convention; `balance_trial` structurally unreachable (no map member) — INV-B3.
  - [x] 4.2.QL · [x] 4.2.TE — EXTEND the subscription-expiry repo suite (or sibling students file): trial-lane untouched with seeded trial balance even when lanes zero (REQ-024); uncovered ⇒ zeroed; covered by second ACTIVE sub ⇒ NOT zeroed (D2 shared-lane guard); covered by PENDING sub ⇒ NOT zeroed; already-zero ⇒ no-op; re-run no-op · [x] 4.2.SEC (no cross-student zeroing; lane resolved only via frozen map — BOPLA column injection impossible) · [x] 4.2.SR · [x] 4.2.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/logic/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/4.2-outcome.md` (records D1's O1 load-bearing semantics)
  - _Requirements: REQ-002, REQ-004, REQ-005, REQ-023, REQ-024, REQ-025, REQ-053, REQ-071_

## Phase 5: Services

- [x] 5.1 `SubscriptionExpiryService` (CREATE — Decision D6 single-tx cohort sweep)
  - CREATE `backend/services/billing/subscription-expiry.service.ts` (+ `backend/services/billing/index.ts` barrel): `expireDue(outerTx?): Promise<SubscriptionExpirySweepReturnType>` = `withTransaction(outerTx, …)`; `const now = new Date()` captured ONCE; `expireDueActive(now, tx)`; plan lanes via ONE `inArray` batch read (NO inArray+placeholder prepared statements); dedupe (student, lane) pairs; NULL-lane rows skipped with warn-log (fail-safe); zeroings inside the SAME transaction; counts-only return; replay ⇒ `{ expired: 0, lanesZeroed: 0 }`; NO notification fan-out, NO `audit_logs` writes; `logger` from `@/backend/lib/logger` (`logger.error` anomalies, info/debug for empty sweeps).
  - [x] 5.1.QL · [x] 5.1.TE — CREATE `backend/services/billing/subscription-expiry.service.test.ts` (4-tier, `runInRollback` per service-test convention): T1 branches (empty cohort, NULL-lane skip, dedupe, count honesty); T2 boundary `end_date == now` inclusive; T3 chaos concurrent `expireDue()` ×2 via `Promise.allSettled` + sweep-vs-booking race (never torn, never double-spent); atomicity probe (mid-cohort failure ⇒ full rollback, zero half-swept cohort) · [x] 5.1.SEC (system-scope/actor-less — verify no session assumptions, no PII in logs) · [x] 5.1.SR · [x] 5.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/5.1-outcome.md`
  - _Requirements: REQ-002, REQ-004, REQ-005, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-050, REQ-052, REQ-053, REQ-071_

- [x] 5.2 Booking expiry gate (Decision D3 — insertion, not redesign)
  - EXTEND `backend/services/classes/session-lifecycle.booking.ts` `debitBookingLadder` ONLY: inside the double-debit-miss branch, BEFORE the existing `INSUFFICIENT_BALANCE` log+throw, add the one-shot `hasUncoveredExpiredLane(studentId, HELD_LANE_TO_CREDIT_LANE[intentLane], tx)` probe; on hit `logger.logDomainError("Session booking rejected: subscription expired", { code: "SUBSCRIPTION_EXPIRED", entity: "session", entityId: studentId })` then `throw new ValidationError("SUBSCRIPTION_EXPIRED", t.subscriptionExpired)`; frozen module-local `HELD_LANE_TO_CREDIT_LANE` (two members); ladder order (trial → intent-lane → gate → insufficient) preserved verbatim; trial exemption structural (trial debit succeeds first, gate never reached).
  - Zero frontend changes (D7): assert (as negative evidence) that `createSessionMutationDocument` gains NO new consumer and that `mapGraphQLErrorByCode("SUBSCRIPTION_EXPIRED", …)` returns `null` (custom domain codes have no map row — the denial rides `extensions.code` + the server-localized `ValidationError` message only); NO dedicated arm in `sessionDialogErrorArms.ts` (ledger D3 deferred to the future booking-UI surface, which does not exist yet).
  - [x] 5.2.QL · [x] 5.2.TE — EXTEND `backend/services/classes/session-lifecycle.booking.test.ts`: expired+zeroed lane → `SUBSCRIPTION_EXPIRED` thrown BEFORE any write (zero rows); expired + `balance_trial > 0` → booking SUCCEEDS via trial; in-window subscription → unchanged; never-subscribed empty lane → `INSUFFICIENT_BALANCE` regression intact; expired-over-insufficient precedence proven; GraphQL shape `extensions.code === "SUBSCRIPTION_EXPIRED"` via `expectSingleDenial`-style assertion · [x] 5.2.SEC (gate evaluates ONLY the authenticated booking student inside their own tx — BOLA; no scope-gate changes — BFLA) · [x] 5.2.SR · [x] 5.2.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Re-run 3.1 journey — must be GREEN; Write `outcome/5.2-outcome.md`
  - _Requirements: REQ-002, REQ-003, REQ-004, REQ-030, REQ-031, REQ-033, REQ-034, REQ-040, REQ-051, REQ-053, REQ-061, REQ-073_

## Phase 6: Cron Route

- [x] 6.1 Route `app/api/cron/expire-subscriptions/route.ts` (Decision D1 — line-for-line sibling of sweep-sessions; guards ledger D2)
  - GET only; bare-404 fail-closed gates (`getEnv("CRON_EXECUTION_MODE") === "external"` AND `getEnv("CRON_EXTERNAL_ENABLED") === "true"`) BEFORE any auth work; SHA-256 digest + `crypto.timingSafeEqual` bearer vs `CRON_SECRET` (module-local `bearerSecretMatches` — copy the sweep-sessions shape; do NOT invent `backend/lib/cron-auth.ts`); masked 401 `DomainError("UNAUTHORIZED", …)` envelope; delegate `SubscriptionExpiryService.expireDue()`; `apiSuccessResponse({ expired, lanesZeroed }, { requestId })`; thrown errors masked via `apiErrorResponse`; fixed `locale = "en"`; NO session reads; NO new env keys; secret NEVER via query string.
  - MANDATORY registration: EXTEND `backend/lib/gateway/route-inventory.ts` with `{ path: "/api/cron/expire-subscriptions", classification: "envelope" }`; EXTEND the route-inventory static-assertions suite so the new route is covered.
  - [x] 6.1.QL · [x] 6.1.TE — CREATE `app/api/cron/expire-subscriptions/test/expire-subscriptions-route.test.ts` (env gymnastics precedent `sweep-sessions-route.test.ts:66-74`): disabled → bare 404 (no envelope/body); wrong bearer → masked 401; missing bearer → 401; empty-secret configured → 401 (fail-closed); query-string secret NOT accepted; happy path → envelope honest counts · [x] 6.1.SEC (BFLA route-abuse probes; existence-oracle check: disabled-mode 404 byte-identical to unknown path) · [x] 6.1.SR · [x] 6.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/app/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/frontend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/6.1-outcome.md` (records D2's live-but-unused route status and the pending external-trigger ops handoff)
  - _Requirements: REQ-002, REQ-004, REQ-020, REQ-026, REQ-050, REQ-052, REQ-072, REQ-075_

## Phase 6.5: Mid-Point Backend Review Gate (MANDATORY — plan has >10 tasks)

- [x] 6.5 Backend review checkpoint (after 6.1, before lock-in/final gates)
  - Dispatch backend-scoped review subagents (`review-backend`, `review-types`, `review-config`) over ALL `backend/` + `app/api/cron/expire-subscriptions/` + `backend/db/schema/billing/subscriptions.ts` + `shared/locale/` files touched in Phases 2–6; aggregate backend-only findings; fix-per-file with `sub-loop.ts`; re-review until zero backend-specific findings.
  - Write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-001, REQ-002_

## Phase 7: AC1 Lock-In & Regression Pin

- [x] 7.1 Window-arithmetic lock-in + regression pin (REQ-070/075)
  - Confirm EXISTING suites green UNCHANGED (activation, booking, `errors-namespace.parity`, route-inventory, the blocking ticket's suites — "Segregated Session Balance-crediting"); EXTEND the activation service suite with explicit `endDate - startDate === intervalDays * 86_400_000` assertions using `secondPrecisionMs`; Tier-2 boundary probes: minimum `intervalDays = 1`, leap-day-adjacent activation, `interval_days = 0`/NULL impossible-by-CHECK confirmations; journey already pins the same arithmetic (3.1).
  - NO re-implementation of the window arithmetic — AC1 is verify-and-pin only; `interval_days` read ONLY from the plan row.
  - [x] 7.1.QL · [x] 7.1.TE (the lock-in assertions + pins above; every suite via `bun run test/scripts/run-test.ts`) · [x] 7.1.SEC · [x] 7.1.SR · [x] 7.1.IV (`/home/ahmed/Projects/kottaby_kottaby/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md`, `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`)
  - Write `outcome/7.1-outcome.md`
  - _Requirements: REQ-002, REQ-004, REQ-010, REQ-011, REQ-012, REQ-040, REQ-051, REQ-060, REQ-070, REQ-075_

## Phase 8: Final Quality Gate & Deferred-Items Enforcement (MANDATORY)

- [x] 8.1 Baseline comparison + deferred gate + full quality gate
  - Re-run baseline trio; confirm zero NEW errors vs `/tmp/baseline-*.txt` (compare against `outcome/0.1-baseline-outcome.md`).
  - Deferred gate: `grep -c "❌\|⚠️" ai/plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/deferred-items.md` counts the Ledger Table rows (the ❌/⚠️ icons in the "Status Values" legend are definitional and excluded). At THIS checkpoint the expected count is exactly 1 — D2's sanctioned ❌, which closes ONLY when 9.1's canonical doc records the external-trigger ops handoff (D1 closed ✅ at 1.1 via plan-review R1; D3 closed ✅ at 1.1). After 9.1 the count MUST be 0 (re-run the grep there; a non-zero post-9.1 count blocks completion).
  - `bun quality-gate` green end-to-end (tsgo → oxlint → biome → lint → duplicates); caches NEVER cleared.
  - [x] 8.1.IV (instructions re-verified against every touched file)
  - Write `outcome/8.1-outcome.md`
  - _Requirements: REQ-001, REQ-002, REQ-075_

## Phase 9: Knowledge Propagation (MANDATORY — final task)

- [x] 9.1 Canonical doc + invariant addendum + cross-refs
  - CREATE `docs/billing/subscription-validity-window-expiry.md` — canonical reference: window arithmetic (AC1), sweep design (route/service/repo, D1/D6), REQ-023 zeroing semantic O1 + rationale + Revoke-Never-Wrongly guard (closes ledger D1's runtime documentation), booking gate + pinned predicate order (Decision D3/D7, incl. the ledger-D3 requirement that the future booking UI SHALL map `SUBSCRIPTION_EXPIRED` to the `subscriptionExpired` snackbar key at landing), cron contract + **external-trigger deployment handoff (closes ledger D2 ops note)**, trial exemption (INV-B3), concurrency/race table summary.
  - EXTEND `docs/specs/state-machine-invariants.md` — INV-B3 implementation addendum (chosen O1 semantic; the `active → expired` writer now EXISTS — A.9's "Expired" transition gains its producer).
  - ≤2-line cross-refs to `backend/AGENTS.md` / `backend/services/AGENTS.md` per convention; instruction files otherwise NEVER modified; NO plan-meta comments in code.
  - Write `outcome/9.1-outcome.md`
  - _Requirements: REQ-001, REQ-080, REQ-081, REQ-082_

## Traceability Map (REQ → tasks)

Covers ALL REQ ids in `specs.md`. Note: `REQ-0xx` in specs §7 means "all requirements" — structurally satisfied by 8.1 + 9.1.

| REQ | Tasks |
|---|---|
| REQ-001 | 0.1, 1.1, 6.5, 8.1, 9.1 |
| REQ-002 | 2.1, 2.2, 2.3, 3.1, 4.1, 4.2, 5.1, 5.2, 6.1, 7.1, 8.1 |
| REQ-003 | 2.3, 5.2 |
| REQ-004 | 3.1, 4.1, 4.2, 5.1, 5.2, 6.1, 7.1 |
| REQ-005 | 4.1, 4.2, 5.1 |
| REQ-010 | 3.1, 7.1 |
| REQ-011 | 3.1, 4.1, 7.1 |
| REQ-012 | 7.1 |
| REQ-020 | 6.1 |
| REQ-021 | 2.2, 5.1 |
| REQ-022 | 2.1, 4.1, 5.1 |
| REQ-023 | 4.2, 5.1 |
| REQ-024 | 3.1, 4.2, 5.1 |
| REQ-025 | 3.1, 4.2, 5.1 |
| REQ-026 | 5.1, 6.1 |
| REQ-030 | 5.2 |
| REQ-031 | 3.1, 5.2 |
| REQ-032 | 2.3 |
| REQ-033 | 3.1, 5.2 |
| REQ-034 | 3.1, 5.2 |
| REQ-040 | 3.1, 5.2, 7.1 |
| REQ-050 | 4.1, 5.1, 6.1 |
| REQ-051 | 5.2, 7.1 |
| REQ-052 | 5.1, 6.1 |
| REQ-053 | 3.1, 4.2, 5.1, 5.2 |
| REQ-060 | 7.1 |
| REQ-061 | 3.1, 5.2 |
| REQ-070 | 7.1 |
| REQ-071 | 4.1, 4.2, 5.1 |
| REQ-072 | 6.1 |
| REQ-073 | 5.2 |
| REQ-074 | 3.1 |
| REQ-075 | 6.1, 7.1, 8.1 |
| REQ-080 | 9.1 |
| REQ-081 | 9.1 |
| REQ-082 | 9.1 |
