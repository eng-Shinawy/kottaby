# Tasks — Workflow Tests: Parent Journey & Subscription Lifecycle

<!-- Plan Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/ -->
<!-- Outcome Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/ -->
<!-- Inputs: specs.md (REQ-0…REQ-6) · plan.md (D-1…D-7, C1…C7) · Templates: .agents/spec-process-guide/templates/ -->

## Document Information

- **Feature Name:** Workflow Tests — Parent Journey & Subscription Lifecycle
- **Target Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/`
- **Outcome Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/`
- **Version:** 1.0
- **Date:** 2026-09-21

## Non-Negotiable Execution Protocol for All Tasks

1. BEFORE executing any task: read ALL files in the plan's `outcome/` directory.
2. AFTER creating/modifying any file: run
   `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` to exit code 0.
3. Complete the SEC (security) and SR (semantic review) subtasks before flipping any checkbox.
4. Tests ALWAYS run via `bun run test/scripts/run-test.ts <path>` — never raw `bun test`.
5. AFTER each task: write `outcome/<task-id>-outcome.md`.
6. WHEN done with a task: flip `[ ]` → `[x]` here and update `deferred-items.md` statuses.

## Layer → Rule-File Mapping (applies to every file in this plan)

| Path | Rule files (read before editing) |
|---|---|
| `test/workflows/**` | root `AGENTS.md` + `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` |
| `docs/testing/**` | root `AGENTS.md` (docs are hand-written knowledge; no layer AGENTS.md under `docs/testing/`) |

> **Rule-precedence note:** for files under `test/workflows/`, the layer's own hard rule 6
> (translated substrings via `getServerTranslations("en").errorsTranslations`) takes precedence
> over the generic database-test caution against direct `getServerTranslations` calls in
> `tests.instructions.md` — every green journey file does it at module scope (precedent:
> `parent-link-request.journey.test.ts:92,95`). Executing agents MUST NOT "fix" this.

## Implementation Strategy

Foundation-first with interleaved tests is vacuous here — the artifacts ARE the tests — so each
implementation task authors its journey file test-first against the existing services (write the
assertion, watch it fail/pass honestly), then runs the mandatory subtask pipeline.

- **Phase 2.5 mid-point review gate: SKIPPED** — 5 tasks (< 10), single test layer, no
  backend/frontend production split.
- **Phase 4 (UI): SKIPPED** — explicit no-UI ruling (specs.md, plan.md).
- **Penetration testing phase: folded in** — the journeys' denial/BOLA/BFLA legs (REQ-2, REQ-5
  AC5) are the security probes; no new endpoints exist to pen-test.
- **Parallelization:** Task 1 and Task 2 touch disjoint files and MAY run as two parallel
  subagents; Task 3 requires both complete.

## Implementation Plan

### Task 0: Pre-Implementation Baseline (MANDATORY)

- [ ] 0.1 **Record baseline counts** into `outcome/baseline.md`:
  - `bun tsgo 2>&1 | grep -c "error TS"`
  - `bun run scripts/lint-service.ts --json --id baseline`
  - `bun run biome:check 2>&1 | grep -c "warn"`
  - layer pre-run: `bun run test/scripts/run-test.ts test/workflows` (record pass/fail counts)
- [ ] 0.2 **Verify `deferred-items.md`** exists (initialized from template; this plan ships it).
- [ ] 0.3 **Confirm out-of-scope invariants**: no production file under `backend/`, `frontend/`,
  `app/`, `shared/` is modified by any task in this plan.
- Write `outcome/0-baseline-outcome.md`.
- _Requirements: REQ-0_

### Phase 1.5: Plan Review Gate

Already executed at planning time — verdict + fixes recorded in `outcome/plan-review-R1.md`.
The executing agent MUST read it before Task 1.

### Task 1: `test/workflows/parents/parent-full-journey.journey.test.ts` (CREATE)

- [ ] 1. **Author the consolidated parent journey** (specs.md Journey 1, steps 1–17):
  - Provisioning: parent P + student S1 via REAL `RegistrationService.registerUser` (pattern
    `createJourneyCast`, `test/workflows/helpers/journey-fixtures.ts:251`); remaining cast (S2,
    foreign parent P2, certified teacher) in one committing `db.transaction(...)` via
    `provisionCertifiedTeacherActor` / entity-setup helpers; every id tracked in
    `TrackedFixtures`/`SessionFixtureRegistry` from `@/test/workflows/helpers`.
  - Chain legs: handshake self-read → code search (incl. garbage + unknown negatives) →
    P2 requests S2 (expiry-leg setup) → P requests S1 (assert +7d TTL via
    `PARENT_LINK_REQUEST_MS`) → S1 `listMyIncoming` → S1 confirms (parent_id written, siblings
    expired, ONE acceptance notification) → P2 request on linked S1 collapses (zero rows/notifs)
    → backdate P2→S2 expiry → S2 confirm denied with translated expired error → S1 books a
    session (provisioned trial lane; real debit ladder — pattern
    `parent-session-completion-deep-link.journey.test.ts:288,408`) → teacher starts/completes and
    submits via `submitSessionReport` → completion fan-out asserted via `SpiedFanoutTransport`
    (targets {S1, P}) + persisted inbox deep-link triple + P2 zero-fan-out probe → P reads all
    seven monitoring surfaces for S1 (the six per-child reads plus the parent-level
    `listChildrenUpcomingSessions`, `parent-monitoring.service.ts:449`) → P2 denied on every per-child read (constant ForbiddenError shape) → P attempts
    `createSession`, `confirmSessionCompletion`, `submitSessionReport`, `respondToLinkRequest`
    (all denied; zero rows; byte-identical snapshots) → tracked teardown with re-probe.
  - Framework: `bun:test` only; `@/` aliases; `catchJourneyError` for every rejection;
    `getServerTranslations("en").errorsTranslations` for expected substrings;
    `jrn_parentfull_${randomUUID().slice(0, 8)}` prefix; `spyOn(logger, "logDomainError")` where
    services log domain denials.
- [ ] 1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/parents/parent-full-journey.journey.test.ts --lifecycle duplicates` → exit 0.
- [ ] 1.TE **Test Engineering**:
  - Run via `bun run test/scripts/run-test.ts test/workflows/parents/parent-full-journey.journey.test.ts`.
  - Tier coverage: happy chain (T1); expiry boundary via backdating (T2); suite re-run for
    teardown idempotency + replay/duplicate-request legs (T3); BOLA/write-denial probes (T4).
  - NO `runInRollback` (layer exception); committed fixtures + tracked cleanup only.
- [ ] 1.SEC **Security & Tenancy Audit**:
  - BOLA: P2 probes every per-child read on S1; assert constant-shape ForbiddenError + zero data.
  - Write-denial: P attempts all four child-data mutations; assert zero new sessions/reports/
    notifications AND byte-identical snapshots of S1's rows.
  - No authorization monkey-patching anywhere in the file (honest auth, rule 4).
- [ ] 1.SR **Semantic Review**:
  - No hardcoded English error text; no `import type` on enums used as values; no `console.*`.
  - No dead steps/assertions; every tracked id re-probed absent in `afterAll`.
  - Comments/JSDoc describe domain behavior only — zero references to plan artifacts.
  - No modifications outside the single new file; report (never fix) any cross-file need.
- [ ] 1.IV **Instruction Verification**: apply `test/workflows/AGENTS.md` rules 1–12 and
  `.agents/instructions/tests.instructions.md` (both auto-printed by sub-loop.ts).
- Write `outcome/1-parent-full-journey-outcome.md` (gaps closed, oracles reused, deviations).
- _Requirements: REQ-1, REQ-2, REQ-3, REQ-0.5, REQ-6_

### Task 2: `test/workflows/billing/subscription-full-lifecycle.journey.test.ts` (CREATE)

- [ ] 2. **Author the consolidated subscription lifecycle journey** (specs.md Journey 2, steps
  1–11):
  - Cast via `buildSessionJourneyCast` (`test/workflows/helpers/session-cast.ts:280`) or
    actor-context provisioning (student S, control student S2 with own untouched subscription,
    certified teacher T, admin A) + two plans via `createTestPlan` in ONE committing tx:
    plan LOW and plan HIGH on the same lane (e.g. hifz), differing price/sessionCount; capture
    pre-chain lane snapshots for all actors.
  - Chain legs: S purchases LOW (pending pair) → settle via
    `SubscriptionActivationService.processWebhookEvent` (window = intervalDays; lane credited
    LOW.sessionCount) → replay leg (no double credit) → S books one session (lane −1 through the
    real debit ladder, teacher T) → backdate `end_date` → row still active →
    `SubscriptionExpiryService.expireDue()` (flip + lane zeroed; trial + S2 byte-identical) →
    sweep replay (zero counts) → A `renewSubscription` (fresh active row + renewal credit; replay
    idempotent) → A `changeSubscriptionPlan` **upgrade** to HIGH (assert
    `ProrationDirection.Upgrade`, `carrySessions` = exact floor formula clamped to
    `MAX_SESSION_COUNT`, lane = HIGH.sessionCount + carry, `forfeitedSessions === 0`, Override
    audit row; replay re-derives direction) → A `changeSubscriptionPlan` **downgrade** to LOW
    (`carrySessions === 0`, forfeit = excess, lane = LOW.sessionCount, audit row) → A
    `cancelSubscription` (status cancelled; lanes byte-identical) → S attempts all three admin
    ops (denied via `assertActorAdmin`, zero side effects) → final tenancy sweep + tracked
    teardown with re-probe.
  - Same framework rules as Task 1 (`jrn_subfull_…` prefix).
- [ ] 2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/billing/subscription-full-lifecycle.journey.test.ts --lifecycle duplicates` → exit 0.
- [ ] 2.TE **Test Engineering**:
  - Run via `bun run test/scripts/run-test.ts test/workflows/billing/subscription-full-lifecycle.journey.test.ts`.
  - Tier coverage: full monetary-lifecycle happy chain (T1); expiry boundary + zero-count replay
    (T2); all four replay legs C3–C6 + suite re-run (T3); BFLA + cross-tenant probes (T4).
- [ ] 2.SEC **Security & Tenancy Audit**:
  - BFLA: student attempts `renewSubscription`, `cancelSubscription`, `changeSubscriptionPlan` —
    each denied by `assertActorAdmin`; assert zero new rows + zero lane deltas.
  - Tenancy: S2's subscription status, window, and all four lane columns byte-identical after
    every mutation leg (snapshot compare).
- [ ] 2.SR **Semantic Review**:
  - Proration asserted in session units only — no wallet/monetary assertions anywhere.
  - Enum members used as value imports (`ProrationDirection*`); no string literals for direction.
  - Time control strictly via row backdating; no fake timers, no module mocks of the clock.
  - Comments/JSDoc describe domain behavior only; no plan-artifact references; no `console.*`.
- [ ] 2.IV **Instruction Verification**: apply `test/workflows/AGENTS.md` rules 1–12 and
  `.agents/instructions/tests.instructions.md` (auto-printed by sub-loop.ts).
- Write `outcome/2-subscription-full-lifecycle-outcome.md`.
- _Requirements: REQ-4, REQ-5, REQ-0.5, REQ-6_

### Task 3: Layer-Wide Verification & Traceability

- [ ] 3.1 **Full layer run**: `bun run test/scripts/run-test.ts test/workflows` — green, and both
  new files pass twice consecutively (idempotent teardown proof).
- [ ] 3.2 **Baseline diff**: quality-gate counts ≤ Task-0 baseline; investigate any regression.
- [ ] 3.3 **Traceability re-check**:
  `for r in $(grep -oE 'REQ-[0-9.]+' ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/specs.md | sort -u); do grep -q "$r" ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/tasks.md || echo MISSING: $r; done`
  — zero misses.
- [ ] 3.4 **Oracle stability**: confirm the cited per-domain suites (parents ×5, billing ×7 incl.
  the financial-audit/paymob files) were NOT modified by this plan: run
  `git status --porcelain -- test/workflows/ docs/testing/` and verify the only additions are
  the two new test files plus the doc change (unrelated pre-existing tree changes are out of
  scope — do not "clean" them).
- Write `outcome/3-layer-verification-outcome.md`; flip D-items in `deferred-items.md`.
- _Requirements: REQ-6 (re-proves REQ-1…REQ-5)_

### Task 4: Knowledge Propagation & Documentation

- [ ] 4.1 Read all files in this plan's `outcome/` directory.
- [ ] 4.2 Extend `docs/testing/workflow-journey-tests.md` (UPDATE, do not create) with:
  - the "consolidated chained journey" pattern (one file per ticket chain, per-domain files stay
    authoritative), citing the two new files as the canonical examples;
  - the backdated-time-control pattern (link-request expiry + subscription expiry legs);
  - the replay-leg idempotency matrix C3–C6;
  - the session-units-not-money proration assertion rule.
- [ ] 4.3 Quality loop on the doc-adjacent change: `bun run scripts/health/sub-loop.ts` per
  modified file if any code-adjacent file changed (docs-only: state the exemption).
- Write `outcome/4-knowledge-propagation-outcome.md`.
- _Requirements: REQ-6_

## Traceability Summary

| REQ | Title (short) | Tasks |
|---|---|---|
| REQ-0 | Baseline & execution protocol | Task 0 (+ protocol rules on all) |
| REQ-0.5 | Translation & enum-import compliance | Task 1 (1.TE/1.SR), Task 2 (2.TE/2.SR) |
| REQ-1 | Parent chained journey | Task 1 |
| REQ-2 | Parent tenancy & read-only enforcement | Task 1 (steps 15–16, 1.SEC) |
| REQ-3 | Link expiry & one-parent legs | Task 1 (steps 6, 9–11) |
| REQ-4 | Subscription chain purchase→renew | Task 2 (steps 1–6) |
| REQ-5 | Proration + cancel preservation | Task 2 (steps 7–10, 2.SEC) |
| REQ-6 | Conventions, runner, traceability, docs | Task 1/2 (QL/TE), Task 3, Task 4 |

## Deferred Re-Routes (pre-ledgered; see `deferred-items.md`)

| ID | Item | Rerouted to | Resolution path |
|---|---|---|---|
| D1 | GraphQL-tier chained journey (resolver-driven equivalent of both chains) | Not in ticket scope; GraphQL tier already covered per-domain by `backend/graphql/test/parent-link.wire.test.ts`, `parent-monitoring.wire.test.ts`, `session-lifecycle-mutations.test.ts` | Task 3 verifies coverage stands; future GraphQL-hardening ticket may consolidate |
| D2 | Root `AGENTS.md` "five SDL queries" is stale — monitoring portal actually exposes seven (`docs/parents/monitoring-portal.md:7,30`) | Rule files are hand-curated (never edited from plan work) | Task 4 records the discrepancy in `docs/testing/workflow-journey-tests.md` propagation notes + outcome file |

## Estimation

| Task | Scope | Est. |
|---|---|---|
| Task 0 | baseline + ledger | 0.5h |
| Task 1 | parent chained journey (~17 steps) | 3–4h |
| Task 2 | subscription chained journey (~11 steps, incl. upgrade leg) | 3–4h |
| Task 3 | layer verification + traceability | 0.5–1h |
| Task 4 | knowledge propagation | 0.5h |

Ticket budget: 5 + 3 = 8 story points combined — consistent with the estimates above.
