# Requirements — Financial Safety Verification (Double-Spend, Escrow Integrity)

<!-- Plan Directory: ai/plans/milestone_4_integration_security_launch/financial-safety-verification/ -->
<!-- Outcome Directory: ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/ -->
<!-- Related: plan.md · tasks.md · deferred-items.md -->

## Document Information

- **Feature Name**: Financial Safety Verification (Double-Spend, Escrow Integrity)
- **Ticket**: `docs/planning/TICKETS.md:2985-3026` (Dev 3, Milestone 4, 5 pts)
- **Milestone Plan**: `docs/planning/MILESTONE_PLAN.md:349-366` (Milestone 4 row) · DoD `docs/planning/MILESTONE_PLAN.md:371-387`
- **Blocked By (ticket-level)**: "Fee Escrow: Hold at Request, Decrement at Completion" + "Teacher Wallet Crediting (Earning Transactions)" — both **shipped** (`docs/sessions/session-lifecycle.md`, `ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/`)
- **Target Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/`
- **Outcome Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Stakeholders**: Platform (financial integrity gate), Teachers (wallet correctness), Students/Parents (escrow safety), Admin governance (auditability)

## Introduction

The platform already ships the escrow substrate: a session fee is held at request (`session.fee_held = true`), released on cancellation, and consumed into the teacher's wallet on dual confirmation, over append-only financial ledgers protected by immutability triggers. What does **not** exist is the adversarial proof: an automated suite that actively tries to *break* those guarantees — double-spend races against a 1-credit balance, concurrent withdrawal overdraft attempts, direct UPDATE/DELETE attacks on the ledger, and checksum-level wallet/ledger consistency.

This ticket is a **verification ticket** (per PRODUCTION_READINESS §2 and MILESTONE_PLAN line 366): the deliverable is executable evidence — adversarial tests at the repository, service, and cross-actor journey layers — plus closure of the specific coverage gaps identified during ground-truth inspection. Production behavior changes only if a probe exposes a genuine defect.

### Feature Summary

Adversarial, multi-layer verification suite proving double-spend prevention, escrow hold/release integrity, financial immutability, and wallet↔ledger consistency against the shipped escrow implementation.

### Business Value

- Launch gate: PRODUCTION_READINESS §2.1–2.3/§2.5 and §1.2 require verified financial safeguards before launch.
- Defect leverage: one escaping double-spend or ledger mutation is catastrophic; tests are the cheapest possible insurance.
- Regression armor: the invariants become permanent CI-enforced contracts for all future billing work.

### Scope

**In scope**
- Adversarial test coverage (repo / service / workflow-journey layers) of the six ticket scenarios: double-spend attempt, escrow cancellation release, immutability, wallet consistency, negative-balance prevention, concurrent request races.
- Repo-layer test gap closure: `backend/db/test/repo/billing/wallet.repository.test.ts` does not exist — create it.
- Trigger-tier verification: `teacher_transaction` UPDATE/DELETE rejection (triggers shipped in `backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:80-101`); CHECK-constraint probes for `wallet_balance_check`, `wallet_total_earning_check`, `teacher_transaction_amount_check`.
- Coverage-gap matrix: every ticket scenario + PRODUCTION_READINESS financial item mapped to a named existing or new test.
- Canonical knowledge doc consolidating financial-safety verification rules.

**Out of scope** (recorded in `deferred-items.md`)
- New production features (withdrawal settle/approve flow, arbitration-complete wallet credit, wallet↔ledger DB consistency trigger, unique index on `teacher_transaction(session_id)`) — owned by other tickets or future hardening; flagged as findings only.
- Any UI / navigation change (explicit no-UI ruling below).
- Dispute-economics semantics (covered by milestone_3_parent_portal_admin_governance dispute plan).

## Requirements

### REQ-0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an AI agent or developer, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and research is never repeated.

#### Acceptance Criteria

1. WHEN implementation begins THEN the executing agent SHALL record baseline counts (`bun tsgo` error count, `bun biome:check` warning count, lint-service JSON snapshot) to `/tmp/baseline-*` files.
2. WHEN implementation begins THEN the agent SHALL create this plan's deferred-items ledger from `.agents/spec-process-guide/templates/deferred-items-template.md`.
3. WHEN any task starts THEN the agent SHALL read ALL files in `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/` first.
4. WHEN any task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` with findings and carry-over points.
5. WHEN any subtask completes THEN the agent SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is created/modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 before proceeding.
7. WHEN any subtask is marked complete THEN the semantic review checklist (atomicity, env-config, dead code, cross-layer, enum value-imports) SHALL pass.

### REQ-0.5: Translation System & Enum Import Compliance (adapted — no UI)

**User Story:** As a developer, I want type-safe enums and canonical error-text assertions in tests, so that the suite cannot pass on accident while grepping the wrong strings.

#### Acceptance Criteria

1. WHEN an enum appears in a runtime expression in any test file THEN it SHALL be a **value import** (never `import type`), and only enum members — never string literals — SHALL be used where enum types are expected.
2. WHEN a test asserts a financial-domain rejection THEN it SHALL match the canonical translated error substring (repo/service tiers: the pattern in `session-lifecycle.service.test.ts:477` via `expectDomainDenial`; journey tier: `getServerTranslations("en").errorsTranslations` substrings per `test/workflows/AGENTS.md`) — never a hand-typed English sentence.
3. UI-specific translation rules (client/server component namespaces) are **N/A** — this plan ships no components (see UX ruling); no `next-intl`, `Translation.` enum references, or two-arg `getTranslations` appear anywhere in plan artifacts.
4. WHERE a test renders no user-facing text THEN no locale namespace is created.

### REQ-1: Double-Spend Prevention Verification

**User Story:** As the platform, I want proof that a student holding exactly one session credit can never book two sessions, even under concurrent request races, so that credits can never be spent twice.

Ticket Gherkin: *"Given a student with balance_hifz=1, when they attempt to request two sessions simultaneously, then only one session is created (double-spend prevented), and the balance is held for only one session."*

#### Acceptance Criteria

1. WHEN a student with `balance_hifz = 1` and `balance_trial = 0` issues N ≥ 2 concurrent `SessionLifecycleService.createSession` calls (`backend/services/classes/session-lifecycle.service.ts:196`) via `Promise.allSettled` THEN exactly one call SHALL succeed, exactly one `session` row SHALL exist, and `balance_hifz` SHALL be exactly 0 (debited once).
2. IF a session request races THEN all but the winner SHALL fail with the domain rejection surfaced by the guarded debit (`StudentRepository.decrementLaneIfAvailable`, `backend/db/repo/students/student.repository.ts:478-493` — one guarded `UPDATE … WHERE balance_lane > 0` zero-row match) and SHALL leave zero side-effect rows (no session, no idempotency claim).
3. WHEN the same idempotency key is replayed sequentially THEN the system SHALL reject with `DUPLICATE_REQUEST` (ConflictError) and the student's balance SHALL be unchanged (replay is free — `session-lifecycle.booking.ts:149-182`).
4. WHEN a student with all actionable lanes at 0 requests a session THEN the system SHALL reject with `INSUFFICIENT_BALANCE` and SHALL write no rows (zero-row atomicity already asserted by `session-lifecycle.service.test.ts`; re-asserted here at equilibrium).
5. The concurrent-race assertion SHALL be expressed as a sum-over-outcomes invariant (winners + losers = N, winners = 1, final lane = 0) so it stays meaningful under both true parallel execution (PostgreSQL) and serialized execution (single-connection PGlite sandbox). True-parallel proof remains real-PG-gated via the `testOnRealPostgres` precedent (`backend/services/classes/session-lifecycle.service.test.ts:143`); the journey-tier race asserts the same invariants with serialization-safe expectations.
6. IF the probe exposes a genuine double-spend path (two sessions created or two debits) THEN the finding SHALL be escalated as a release-blocking defect, not silently tolerated.

#### Additional Details
- **Priority**: High (headline ticket scenario)
- **Complexity**: Medium (race orchestration + honest failure classification)
- **Dependencies**: shipped booking ladder (`session-lifecycle.booking.ts:95-116`), trial-first lane order
- **Existing coverage (verified)**: `session-lifecycle.service.test.ts:2314` (REQ-043(d): two concurrent creations with one unit → exactly one session + one `INSUFFICIENT_BALANCE`, lanes never negative) and `:2346` (REQ-043(e): same-key concurrent replay N=4 → one session, one net debit), gated to real PostgreSQL via `testOnRealPostgres` (`:143`, skipped on PGlite). This plan's journey re-proves the scenario at the committed-fixture cross-actor tier and adds the PGlite-meaningful sum-invariant path.
- **Assumptions**: fee is platform-set constant (`shared/constants/session-fees.constants.ts`); `HeldBalanceLane` governs provenance (`backend/enum/scheduling/held-balance-lane.enum.ts:17-21`)

### REQ-2: Escrow Cancellation Release Verification

**User Story:** As the platform, I want proof that every cancellation path releases a held session credit back to its provenance lane exactly once — never decrementing, never crediting a wallet — so that held funds cannot leak or duplicate.

Ticket Gherkin: *"Given a session with fee_held=true, when the session is cancelled, then the held funds are released (no decrement), and no wallet transaction is created."*

#### Acceptance Criteria

1. WHEN a participant cancels a session with `fee_held = true` THEN `cancelSessionOnce` (`backend/db/repo/classes/session.repository.ts:217`) SHALL flip `fee_held = false` AND `refundHeldLaneToProvenance` (`backend/services/classes/session-lifecycle.transitions.ts:222-237`) SHALL restore exactly +1 to the lane recorded in `session.held_balance_lane`, all in one transaction.
2. WHEN the release completes THEN the student's lane SHALL equal its pre-booking value AND zero `teacher_transaction` rows SHALL exist for that `session_id`.
3. WHEN cancellation is attempted twice (sequential or raced) THEN exactly one release SHALL occur; the second attempt SHALL match zero rows (terminal-state predicate) and the lane SHALL NOT be over-refunded.
4. WHEN the sweeper path expires a held session (`sweepExpiredScheduledOnce` / `sweepExpiredCompletedOnce`, `session.repository.ts:473/:503`) THEN the same release semantics SHALL hold with the same provenance lane.
5. IF `held_balance_lane` is unreadable/unexpected THEN the release SHALL fail closed (transaction rolls back) rather than refunding a wrong lane (transitions.ts:222-237 behavior, asserted via corrupted-fixture probe at repo/adversarial tier).
6. `held_balance_lane` SHALL remain non-null after release (provenance is permanent; release flips `fee_held` only — schema contract at `backend/db/schema/classes/session.ts:65`).

#### Additional Details
- **Priority**: High
- **Complexity**: Medium
- **Dependencies**: shipped cancel/dispute/sweep guarded transitions
- **Assumptions**: `reviews` lane never funds holds (agent-verified: `held_balance_lane` enum has no `reviews` member)

### REQ-3: Financial Immutability Verification

**User Story:** As the platform, I want proof that completed financial records cannot be modified or deleted at the database tier, so that the ledger is a trustworthy source of truth.

Ticket Gherkin: *"Given a completed earning transaction, when any attempt is made to modify it, then the attempt is rejected (immutable)."*

#### Acceptance Criteria

1. WHEN an UPDATE targets any `teacher_transaction` row THEN the DB trigger SHALL `RAISE EXCEPTION` and the statement SHALL fail (trigger from `backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql`).
2. WHEN a DELETE targets any `teacher_transaction` row THEN the DB trigger SHALL reject it identically (append-only; corrections are compensating rows only — `backend/db/schema/billing/teacher-transaction.ts:17-22`).
3. WHEN the trigger inventory is probed (`pg_trigger`/`pg_proc`) THEN both BEFORE UPDATE and BEFORE DELETE triggers SHALL be present on `teacher_transaction`, `student_payments`, and `audit_logs` (pattern precedent: `backend/db/test/logic/audit/audit-immutability.test.ts:420-435`).
4. WHEN `student_payments` UPDATE attempts set financial columns or transition outside `pending → paid | failed` THEN the guard trigger SHALL reject (already covered in `backend/db/test/logic/billing/student-payment.repository.test.ts:206-213`; referenced, not duplicated).
5. The repository surface SHALL expose no update/delete method for `teacher_transaction` — verified by API-surface assertion on `WalletRepository` (`backend/db/repo/billing/wallet.repository.ts`) exports.
6. WHEN the suite runs on the PGlite provider THEN the trigger tier SHALL mirror the existing `describeTriggerTier = isPgliteProvider() ? describe.skip : describe` precedent (`backend/db/test/logic/audit/audit-immutability.test.ts:418`): probes never fail because of runtime capability; on real PostgreSQL they run un-gated, and a skip on PGlite SHALL be logged, never silent.

#### Additional Details
- **Priority**: High
- **Complexity**: Low-Medium
- **Dependencies**: PGlite bootstrap applies custom migrations (`scripts/pglite-bootstrap.ts:74`); the existing trigger-tier test suite still gates on provider via `describeTriggerTier` (see AC#6) — this plan follows that precedent rather than assuming trigger availability under PGlite
- **Assumptions**: schema-push-provisioned DBs lack triggers (`docs/admin/audit-trail.md:58`) — environment note, not a code change

### REQ-4: Wallet Consistency & Non-Negativity Verification

**User Story:** As the platform, I want proof that every teacher's wallet always satisfies its accounting identity and can never go negative, so that payouts are always backed by real earnings.

Ticket Gherkin: *"Given a teacher's wallet, when the balance is checked, then wallet.balance = sum of completed earnings − sum of completed withdrawals, and the balance is non-negative."*

**Shipped-semantics adjustment (verified):** withdrawals debit **at request time** (`WalletRepository.debitForWithdrawalOnce`, `backend/db/repo/billing/wallet.repository.ts:145-178` — pending row + guarded `balance = balance − amount WHERE balance >= amount`). Therefore the executable identity is:

`wallet.balance = Σ earnings(completed) − Σ withdrawals(status ∈ {pending, completed})`
`wallet.total_earning = Σ earnings(completed)`

(Failed withdrawals contributing 0 is vacuously true today: no settle/reject flow exists in code — see deferred-items D3.)

#### Acceptance Criteria

1. WHEN a journey of mixed financial events (earning credits, withdrawal requests, cancel-release non-events) completes THEN recomputing the identity from `teacher_transaction` rows SHALL equal the live `wallet` row exactly (decimal-string comparison, no float).
2. WHEN a guarded withdrawal exceeds the balance THEN `debitForWithdrawalOnce` SHALL return null (zero rows), the service SHALL surface `WALLET_INSUFFICIENT_FUNDS` (ConflictError), and the wallet SHALL be unchanged (already covered in `wallet.service.test.ts:208`; re-probed at race level in REQ-5).
3. WHEN raw SQL attempts `balance = -1` on `wallet`, `total_earning = -1`, or `amount = -1` on `teacher_transaction` inside a savepoint THEN `wallet_balance_check` / `wallet_total_earning_check` / `teacher_transaction_amount_check` SHALL reject it (`constraintNameOf` assertion, `backend/db/test/test-utils.ts:111`).
4. WHEN concurrent first-earning credits race on a teacher with no wallet THEN `ensureWalletOnce` (`wallet.repository.ts:45-50`, `INSERT … ON CONFLICT (teacher_id) DO NOTHING`) SHALL yield exactly one wallet row (unique key `wallet_teacher_id_unique`).
5. Each wallet event SHALL be individually verified: one ledger row per event, additive deltas exact, `total_earning` untouched by withdrawals.

#### Additional Details
- **Priority**: High
- **Complexity**: Medium
- **Dependencies**: none new
- **Assumptions**: money moves as decimal strings end-to-end (never re-parsed)

### REQ-5: Concurrent Race & Chaos Verification Suite

**User Story:** As the platform, I want adversarial concurrency probes against every financial guard, so that race conditions are impossible to reintroduce silently.

#### Acceptance Criteria

1. WHEN N ≥ 2 concurrent `createSession` calls race on balance = 1 THEN exactly one wins (REQ-1 #1/#5 — executed in the journey layer with committed fixtures).
2. WHEN two concurrent `requestWithdrawal` calls each attempt to drain 100% of the wallet THEN exactly one SHALL succeed and `wallet.balance` SHALL land exactly 0 — never negative (guarded UPDATE predicate is the arbiter).
3. WHEN concurrent confirm-vs-sweep races fire on an expired completed session THEN escrow is consumed-or-refunded exactly once, never both (existing coverage: `test/workflows/sessions/session-dual-confirmation.journey.test.ts:620` — mapped in the coverage matrix, not re-authored).
4. WHEN fuzzed withdrawal amounts (malformed, `0.00`, precision-overflow, `1e9` scale) hit `requestWithdrawal` THEN validation (`WITHDRAWAL_AMOUNT_PATTERN`, `wallet.service.ts:61`) SHALL reject them before any DB write.
5. All race assertions SHALL be sum-invariant-based and SHALL pass under serialized PGlite execution.

#### Additional Details
- **Priority**: High
- **Complexity**: Medium
- **Dependencies**: REQ-1/REQ-4 journey scaffolding
- **Assumptions**: journey tests never wrap service calls in `runInRollback` (test/workflows/AGENTS.md)

### REQ-6: Coverage Matrix Closure

**User Story:** As a release owner, I want a traceable matrix mapping every financial-safety claim to a passing executable test, so that "verified" means "proven by a named green test".

#### Acceptance Criteria

1. WHEN the suite ships THEN every ticket Test Scenario (6 items) and every PRODUCTION_READINESS §2.1–§2.3, §2.5, §1.2 financial item SHALL map to at least one named existing or new test with its path.
2. WHEN a gap has no existing coverage THEN a new test SHALL be created (this plan's Task 2–4 scope) rather than marked verified-by-inspection.
3. `backend/db/test/repo/billing/wallet.repository.test.ts` SHALL exist with 100% lines & functions coverage of `WalletRepository` (repo-layer rule: `backend/db/test/AGENTS.md`).
4. The matrix SHALL live in `outcome/01-verification-gap-matrix.md` and its final state SHALL be mirrored into the knowledge-propagation doc.
5. Findings that are genuine upstream gaps (not in this ticket's authority) SHALL be logged in `deferred-items.md` with an owning ticket, never silently ignored.

#### Additional Details
- **Priority**: High · **Complexity**: Low-Medium
- **Dependencies**: REQ-1..REQ-5 authoring complete

## UX/Navigation Requirements (No-UI Ruling)

This is a backend verification ticket. **No routes, navigation, sidebar, or permission UI are added.** Explicit ruling per skill requirement:

| Surface | Ruling |
|---|---|
| New routes / pages | **None** — no user-facing surface |
| Sidebar / navigation groups | **None** |
| Mobile bottom nav | **None** |
| Role-based page access | Unchanged; verification exercises existing surfaces (student booking, teacher completion, admin dispute resolve) with honest auth |
| Per-audience rendering | N/A |

The only "audience" is CI: results are observed through the standard test runners (`run-test.ts`, `test:db`, `test:services`, `test:graphql`).

## Cross-Actor Workflow Scenario (Journey)

The verification journey itself is cross-actor (student ↔ teacher ↔ system/admin) over shared financial state. It maps 1:1 to `test/workflows/billing/financial-safety-verification.journey.test.ts`.

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student | `student` | request session, confirm completion, cancel own session | book with zero balance; book two sessions on one credit; mutate ledger |
| Teacher (certified) | `teacher` | complete own session, view own wallet, request withdrawal | withdraw more than balance; receive duplicate earnings |
| Admin | `admin` / system sweeper | resolve disputes, trigger sweeps | mutate financial records directly (trigger-rejected) |

### Ordered Step List (journey outline)

1. Teacher certified; student credited exactly 1 hifz session → baseline balances recorded.
2. Student → N=4 concurrent `createSession` races → exactly 1 winner; lane 0; one `fee_held=true` row.
3. Student cancels → hold released; lane back to 1; zero ledger rows.
4. Student books again (succeeds) → teacher completes → student confirms → hold consumed; wallet credited exactly once; ledger has exactly one earning.
5. Teacher requests withdrawal of full balance ×2 concurrently → exactly one succeeds; balance 0; identity re-derived.
6. Adversarial step: direct ledger UPDATE/DELETE attempt → trigger rejection observed.
7. Teardown: tracked hard-delete with post-teardown zero-residue probes (immutability tables handled via the sanctioned trigger-suspension precedent, `session-dual-confirmation.journey.test.ts:41-45`).

### Cross-Actor EARS Criteria

- WHEN the student races N bookings THEN the teacher SHALL observe at most one pending session to act on.
- WHEN the student confirms completion THEN the teacher SHALL observe exactly one earning in `myWallet` and the student SHALL observe the balance consumed exactly once.
- WHEN the student cancels a held session THEN the student SHALL observe the credit restored AND the teacher SHALL observe zero wallet activity.
- IF a non-participant (other student/teacher) attempts cancel/confirm THEN the system SHALL reject with the real authorization path.
- WHEN the teacher double-submits withdrawal THEN the teacher SHALL observe exactly one pending withdrawal row.

## Non-Functional Requirements

### Performance
- WHEN the full new suite runs THEN wallet/immutability repo tests complete within the standard `test:db` parallel budget; the journey completes within the `test/workflows` runner timeout.
- Race cells SHALL use bounded N (≤ 8 concurrent attempts) to keep PGlite execution deterministic.

### Security
- WHEN tests exercise authorization THEN they SHALL use real roles/permissions (never monkey-patched) so denial assertions are honest (test/workflows/AGENTS.md).
- WHEN notification side effects exist THEN they SHALL be spied at the transport boundary, never hitting real channels.

### Reliability
- Test fixtures SHALL be fully self-provisioned (entity-setup helpers); zero dependence on seed data.
- Journey teardown SHALL hard-delete tracked rows and SHALL probe for zero residue; trigger-protected tables follow the documented suspension precedent.
- All suite runs SHALL be green on both PostgreSQL and the PGlite sandbox; where a runtime cannot execute true parallelism, sum-invariant assertions keep the test meaningful (never skip silently — log the serialized path).

## Constraints and Assumptions

### Technical Constraints
- Journey tests: committed fixtures, `afterAll` cleanup, NO `runInRollback` (`test/workflows/AGENTS.md`).
- DB/repo tests: `runInRollback` + `tx` propagation to every repo call; `expectRepoError` try/catch, never `.rejects.toThrow()`; savepoint-bracketed constraint probes.
- Money is decimal-string end-to-end; comparisons never float.
- Trigger probes require the custom-migration tier (present in PGlite bootstrap + migrated PG).

### Business Constraints
- Escrow model fixed by decision B.4 (`docs/specs/open-decisions-and-gaps.md:93-97`); invariants INV-B4, INV-W4, INV-W6, INV-W8 (`docs/specs/state-machine-invariants.md:148,178`); FR-5.5 dual confirmation; FR-5.7 immutability.
- No production behavior change without an evidenced defect; such findings become blocking ledger items or immediate minimal fixes with re-review.

### Assumptions
- Blocking tickets are fully shipped and green (verified in exploration).
- Withdrawal settle/reject flow does not exist yet (owned elsewhere); pending withdrawals are the only non-terminal withdrawal state in scope.
- Arbitration-Complete consumes holds without wallet credit (documented upstream behavior — reference only).

## Success Criteria

### Definition of Done
- [ ] All REQ-1..REQ-6 acceptance criteria met and green
- [ ] 6/6 ticket test scenarios mapped in the coverage matrix
- [ ] PRODUCTION_READINESS §2.1–§2.3, §2.5, §1.2 rows mapped
- [ ] `test:db`, `test:services`, workflow layer all green (no regressions)
- [ ] Zero unresolved ❌/⚠️ in `deferred-items.md`
- [ ] Knowledge doc `docs/billing/financial-safety-verification.md` published
- [ ] `sub-loop.ts --lifecycle duplicates` exit 0 on every created file

### Acceptance Metrics
- 100% method/branch coverage on `WalletRepository` via the new repo test.
- Every race probe asserts a numeric sum-invariant (not "should not error").
- New defects discovered: target ≥ 0 with honest logging; any defect found is a plan success (ledgered + escalated).

## Glossary

| Term | Definition |
|---|---|
| Escrow hold | `session.fee_held = true`: one student lane credit committed to a session at request time |
| Provenance lane | `session.held_balance_lane` (`trial`/`hifz`/`tajweed`): where the held credit returns on release |
| Dual confirmation | teacher completes + student confirms → hold consumed, teacher wallet credited |
| Debit ladder | trial-first guarded decrement order in `session-lifecycle.booking.ts:95-116` |
| Guarded UPDATE | single-statement conditional update whose WHERE clause enforces the invariant (returns 0 rows on violation) |
| Accounting identity | wallet.balance = Σ earnings − Σ (pending∪completed) withdrawals |
| Compensating row | reverse ledger entry correcting an earlier entry (no in-place mutation) |
| Journey test | cross-actor test in `test/workflows/` on committed fixtures, real DB |
