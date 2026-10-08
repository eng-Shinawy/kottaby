# Requirements & Specification: Workflow Tests (Student Journey)

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_4/workflow_tests_student_journey`
> **Ticket:** `Workflow Tests: Student Journey` — Owner Stream Dev 1, **Milestone 4**, 5 SP, **Blocked By: All Milestone 1–3 tickets** (`docs/planning/TICKETS.md:2704-2731`). Every blocked-by dependency on the student arc is **verified implemented** — see the blocked-by verification table in §2.2.
> **Grounding docs:** `test/workflows/AGENTS.md` (layer law — 12 hard rules) · `docs/testing/workflow-journey-tests.md` (layer runbook: no HTTP/GraphQL client `:26-28`, full-journey composition guidance `:141-158`, canonical examples `:150-157`) · `docs/workflows/02-on-demand-matching-workflow.md` (browse pipeline `:30-43`) · `docs/workflows/03-session-lifecycle-escrow.md` (state machine `:15-31`, escrow rules `:126-138`) · `docs/workflows/04-parent-supervision-handshake.md` (link lifecycle `:15-29`, monitoring scope `:108-136`) · `docs/billing/escrow-and-wallet-crediting.md` (hold-as-debit ruling §2) · `docs/sessions/session-lifecycle.md` · `docs/parents/monitoring-portal.md`.
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's Gherkin (`docs/planning/TICKETS.md:2717-2728`) names a chain and a harness style; four of its statements contradict the governing layer law or the shipped production semantics. The rulings below are binding and must be ratified at the Phase 1.5 plan review:
>
> - **R1 — `runInRollback` is FORBIDDEN.** The ticket's Given says "a new student created via entity-setup helpers within runInRollback" (`TICKETS.md:2718`). `test/workflows/AGENTS.md:8-11` (rule 1) forbids `runInRollback` outright in this layer because services own their top-level transactions; the layer is the documented exception to the `backend/db/test/` rollback rule. **Ruling:** the journey uses committed fixtures in ONE committing `beforeAll` transaction + `TrackedFixtures`-tracked hard-delete teardown with mandatory zero-residue re-probes (`test/workflows/AGENTS.md:12-19`). The ticket prose is stale wording, not a requirement.
> - **R2 — "GraphQL API" coverage is the in-process schema harness, not HTTP.** The layer runbook says journeys have "no HTTP server, no GraphQL resolver, no Apollo client" (`docs/testing/workflow-journey-tests.md:26-28`), yet three live suites (billing + teachers) already execute the REAL Pothos schema in-process via `graphql({ schema: graphQLSchema, source, variableValues, contextValue })` with a hand-built `Context` for scope-gate denial parity (`test/workflows/billing/subscription-purchase.journey.test.ts:87-105, 189-264, 731-771`). **Ruling:** the chain is driven through real services (the layer's primary surface); the ticket's "GraphQL level" is satisfied by the sanctioned in-process harness pattern — one positive read + scope-gate denial probes — never HTTP, never `testClient`. Positive GraphQL-resolver coverage belongs to the `test:graphql` layer and is NOT in scope.
> - **R3 — "Select recitation" is a registration echo, not a persisted step.** `RegistrationSubmitInput.preferredRecitation` is validated against the catalog but is "contract metadata only — NOT persisted" (`backend/types/users/registration.types.ts:56-64`; validation at `backend/services/auth/registration.service.ts:98-101`); `RegistrationReturnType` echoes it (`registration.types.ts:106-109`). No student-preference store exists; recitation surfaces again as the teacher-browse filter input and the teacher-authored per-session record. **Ruling:** the journey asserts the echo and reuses the same token as the browse filter; NO production code is written (test-only ticket). The persistence gap is ledgered (D2).
> - **R4 — The balance decrements at BOOKING (hold-as-debit), not at confirmation.** The shipped money semantics: the trial-first debit ladder consumes a lane credit at `createSession` (`backend/services/classes/session-lifecycle.booking.ts:127-158`, guarded `StudentRepository.decrementLaneIfAvailable`); dual confirmation is an escrow flip (`fee_held=true→false`) + teacher wallet credit in ONE transaction (`backend/services/classes/session-lifecycle.confirmation.ts:123-139`; canonical ruling `docs/billing/escrow-and-wallet-crediting.md` §2). **Ruling:** the journey asserts the SHIPPED semantics — lane −1 at request, `fee_held` flip + `wallet.balance/total_earning +fee` + exactly ONE `earning` ledger row at confirmation, no further student-lane change at confirmation. The ticket's "Student confirms → Balance decremented" ordering is reconciled to hold-as-debit.
> - **R5 — The parent wave is the report-ready wave, not a confirm-time wave.** `confirmSessionCompletion` is notification-free (`test/workflows/sessions/session-dual-confirmation.journey.test.ts:493` pins zero publishes); the parent notification the ticket means is `SessionReportNotificationService.notifySessionReportReady` (`backend/services/classes/session-report-notification.service.ts:147`, type `session_completion` `:117`), emitted on `submitSessionReport`'s transaction and gated on the student's stored `parent_id`. Therefore the parent MUST be linked mid-journey through the REAL production link chain (`ParentLinkRequestService.requestLink` → `respondToLinkRequest`, `backend/services/parents/parent-link-request.service.ts:168, :250`) before the report step — the stale `linkStudentToParentFixture` emulation (`test/workflows/helpers/journey-fixtures.ts:157`) is NOT used. **Ruling:** the journey links the parent through the real flow and asserts the report wave targets `{student, parent}`.
> - **R6 — The unique deliverable is ONE consolidated chained suite; every fragment already has deep per-domain coverage.** Verified gap analysis: `billing/subscription-full-lifecycle.journey.test.ts` stops after the booking debit; `parents/parent-full-journey.journey.test.ts` has no purchase, no confirmation, no wallet credit; `sessions/session-dual-confirmation.journey.test.ts` has no purchase and no parent leg. **NO existing suite chains purchase → booking → completion → confirmation → parent-notification → parent-report in one committed world.** The layer runbook prescribes exactly this composition: "a ticket chain gets ONE consolidated journey file" that "reuses the same services/oracles/cast helpers and adds nothing new" (`docs/testing/workflow-journey-tests.md:141-158`). **Ruling:** this ticket ships `test/workflows/students/student-full-journey.journey.test.ts` — one file, one cast, the full arc plus the three edge legs; it reuses existing oracles, invents no new helpers, and does NOT re-duplicate the deep denial matrices of the per-domain suites.
> - **R7 — "Request session" is `createSession` (book-direct); "attend" is `startSession`.** No production teacher accept/decline intake exists (the request-wave emitters have zero production intake callers; `test/workflows/classes/session-request-notifications.journey.test.ts:186-204` inserts sessions directly for that reason). **Ruling:** the journey books through `SessionLifecycleService.createSession` (insert at `scheduled`), and the teacher's "accept/attend" moment is `startSession` — matching the shipped state machine (`docs/workflows/02-on-demand-matching-workflow.md:47-76`). The missing intake flow is ledgered (D3).
>
> **This ticket therefore ships exactly the slice it owns:** ONE new consolidated journey file under `test/workflows/students/`, ~30 sequential actor-attributed steps driving the real services over one committed cast, three lean edge legs (insufficient balance, paid-lane cancellation, post-confirmation dispute reversal), one in-process GraphQL parity leg, ONE comment-only hygiene fix (`journey-fixtures.ts:157` stale docblock, whose "production link flow does not exist yet" claim this journey disproves), and docs propagation. ZERO production code, ZERO schema change, ZERO new helpers, ZERO UI.

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature summary

A chained cross-actor journey test proving the complete student lifecycle composes: registration (with free-trial grant + handshake code + recitation echo) → plan catalog browse → subscription purchase → webhook settlement → lane credit → parent link via the real handshake chain → teacher browse → session booking (trial-first debit ladder) → teacher start → teacher complete → teacher report (parent wave) → student dual confirmation (escrow release + teacher wallet credit) → parent notification + read-only portal views → plus three edge legs (insufficient balance, cancellation with same-lane refund, post-confirmation dispute with admin-arbitrated wallet reversal).

### 1.2 Problem from the observer perspective

- **QA / release gate (primary actor):** Milestone 4's acceptance story for the student arc is "all steps succeed and data is consistent across all tables" (`TICKETS.md:2724`). Today that sentence is only provable by reading 8+ separate per-domain suites; no single green run demonstrates the CHAIN composes (R6 evidence). A regression that only manifests across handoffs — e.g. a purchase that credits a lane the booking ladder can never consume, or a confirm path that double-counts against a purchased balance — would pass every fragment suite and still break the student's real day.
- **Finance consistency:** the money story spans four tables (`students` lanes, `session.fee/fee_held`, `wallet`, `teacher_transaction`); only a chained journey can assert the end-to-end ledger closes (credits − debits + refunds − reversals = surviving earnings).
- **Parent observability:** the parent legs depend on a mid-chain link; only the chained journey proves the wave and portal reads fire for a parent linked DURING the journey, not fixture-linked.

### 1.3 Business value

Closes Milestone 4's student-journey acceptance ticket (5 SP) as a pure verification asset: no production risk, direct release-gate value, and a permanent regression tripwire for every cross-domain contract on the money path (purchase credit ↔ booking debit ↔ confirmation escrow ↔ arbitration reversal).

## 2. Scope

### 2.1 In scope

| # | Slice | Evidence-driven rationale |
|---|-------|---------------------------|
| S1 | `test/workflows/students/student-full-journey.journey.test.ts` — the consolidated suite (new domain dir `students/`) | Composition guidance `docs/testing/workflow-journey-tests.md:141-158`; naming precedent `parents/parent-full-journey.journey.test.ts` |
| S2 | Committed cast in ONE `beforeAll` transaction: student + parent via REAL `RegistrationService.registerUser` (with `preferredRecitation`, country `"EG"`), certified+online teacher with full directory metadata (on-demand-matching fixture recipe), admin, zero-balance second student, foreign second parent, one active `balanceLane: hifz` plan row | `test/workflows/AGENTS.md:12-19`; recipe `test/workflows/teachers/on-demand-matching.journey.test.ts:435-465`; plan lane `backend/db/schema/billing/plans.ts:29` |
| S3 | The full happy arc (~22 steps): registration outcomes → catalog → purchase → settle+credit → replay → link chain → browse → book (trial ladder) → replay guard → start → complete → confirm → report → parent wave → portal reads | Ticket Gherkin `TICKETS.md:2717-2723`, reconciled by R1–R7 |
| S4 | In-process GraphQL parity leg: one positive catalog read + purchase-scope denial probes (anonymous / parent / teacher contexts) via the `graphQLSchema` + hand-built `Context` harness | Precedent `test/workflows/billing/subscription-purchase.journey.test.ts:189-264, 731-771` |
| S5 | Edge legs: insufficient-balance booking denial (zero writes, idempotency key unburned); paid-lane booking → participant cancellation → same-lane refund exactly once; post-confirmation dispute → admin `Refund` arbitration → wallet reversal + lane restore + compensating ledger row | Ticket scenarios `TICKETS.md:2725-2728`; precedents `session-lifecycle-denials.journey.test.ts:236-317`, `session-lifecycle.journey.test.ts:627-682`, `post-confirmation-dispute.journey.test.ts:654-712` |
| S6 | Final cross-table consistency sweep + teardown hardening: immutability-trigger suspension sweeps, `TrackedFixtures.cleanup()` reverse-order deletes, zero-residue re-probes, idempotent double-run proof | `test/workflows/AGENTS.md:12-19`; precedents `subscription-purchase.journey.test.ts:432-448`, `session-dual-confirmation.journey.test.ts:326-331` |
| S7 | ONE comment-only hygiene fix: `linkStudentToParentFixture` stale docblock (`test/workflows/helpers/journey-fixtures.ts:157` claims the production link flow does not exist — disproven by `parent-link-request.service.ts:145+`) | Root `AGENTS.md` comment-hygiene sweep; zero behavior change |
| S8 | Docs propagation: add the consolidated suite to the canonical-examples list in `docs/testing/workflow-journey-tests.md` + outcome synthesis | Skill knowledge-propagation mandate; `docs/` is the ONLY durable-knowledge home (AGENTS.md files are hand-curated) |

### 2.2 Blocked-by verification (gate: all Milestone 1–3 dependencies implemented)

Every arc fragment the journey consumes was verified to exist as production code (grep/read verified, not assumed):

| Arc fragment | Owning ticket (TICKETS.md) | Verified production surface |
|---|---|---|
| Registration + role child | M0 `:66` | `RegistrationService.registerUser` (`backend/services/auth/registration.service.ts:89-92`) |
| Recitation catalog validation | M0 `:116` | `RecitationCatalogService.validateOptionalReading` (`backend/services/shared/recitation-catalog.service.ts:72`) |
| Free trial provisioning | M0 `:149` | `StudentTrialService.grantFreeTrial` (`backend/services/students/student-trial.service.ts:29`), `FREE_TRIAL_SESSION_COUNT = 1` (`shared/constants/free-trial.constants.ts:11`) |
| Plan catalog | M1 `:401` | `PlanCatalogService.listActiveCatalog` (`backend/services/billing/plan-catalog.service.ts:249`) |
| Subscription purchase | M1 `:448` | `SubscriptionPurchaseService.purchase` (`backend/services/billing/subscription-purchase.service.ts:491`) |
| Balance crediting | M1 `:496` | `SubscriptionActivationService.processWebhookEvent` (`backend/services/billing/subscription-activation.service.ts:554-558`) → `creditLaneBalance` (`backend/db/repo/students/student.repository.credit-lane.helpers.ts:108`) |
| Session lifecycle + state machine | M1 `:962`, `:1023` | `SessionLifecycleService` (`backend/services/classes/session-lifecycle.service.ts:201-872`) |
| Report & homework | M1 `:1065` | `submitSessionReport` (`backend/services/classes/session-report.service.ts:357`) |
| On-demand matching / teacher directory | M2 `:1457`, `:1509` | `TeacherMatchingService.browseAvailableTeachers` (`backend/services/teachers/teacher-matching.service.ts:346-351`) |
| Notification engine + session waves | M2 `:1553`, `:1601` | `NotificationEngine` (`backend/services/notifications/notification-engine.service.ts:41-116`), `SessionRequestNotificationService` (`backend/services/classes/session-request-notification.service.ts:219-295`) |
| Dual confirmation + fee escrow | M2 `:1653`, `:1704` | `confirmSessionCompletion` (`session-lifecycle.service.ts:749`) + `confirmCompletionInTx` (`backend/services/classes/session-lifecycle.confirmation.ts:123`) |
| Teacher wallet crediting | M2 `:1753` | `WalletRepository.ensureWalletOnce`/`creditEarningOnce` (`backend/db/repo/billing/wallet.repository.ts:59, :78`) |
| Handshake code | M3 `:1853` | `StudentHandshakeService.getMyHandshakeCode` (`backend/services/students/student-handshake.service.ts:74`) |
| Parent link request + confirmation | M3 `:1892`, `:1946` | `ParentLinkRequestService.requestLink/respondToLinkRequest` (`backend/services/parents/parent-link-request.service.ts:168, :250`) |
| Parent monitoring portal | M3 `:1988` | `ParentMonitoringService` seven reads (`backend/services/parents/parent-monitoring.service.ts:178-449`) |
| Parent session-completion notification | M3 `:2038` | `SessionReportNotificationService.notifySessionReportReady` (`backend/services/classes/session-report-notification.service.ts:147`) |
| Dispute resolution + arbitration | M3 `:2509` | `SessionArbitrationService.openPostConfirmationDispute/arbitrateDispute` (`backend/services/classes/session-arbitration.service.ts:193, :313`) |

**Verdict: the blocked-by gate is satisfied — implementation may begin.**

### 2.3 Out of scope (ratified rulings + ledger pointers)

- ANY production code, schema, GraphQL SDL, locale key, or UI change (test-only ticket).
- Re-duplicating the deep per-domain denial matrices (each stays authoritative in its own suite; the consolidated file carries lean versions only — R6).
- Held-escrow (pre-completion) dispute leg — covered by `sessions/session-state-machine.journey.test.ts:235-341`; not duplicated here (ledger D4).
- CI wiring for the `test/workflows` layer — `.github/workflows/ci.yml` has no workflows job today; separate DevOps concern (ledger D1).
- Persisted student recitation preference (production feature gap; ledger D2) and the teacher accept/decline intake flow (ledger D3).

## 3. Requirements

### REQ-000: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want an error baseline and a persistent outcome ledger, so that I can distinguish new issues from pre-existing ones and never repeat research.

**Acceptance Criteria:**
1. WHEN implementation begins THEN system SHALL record baseline error counts (`bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline`) into `/tmp/baseline-*.txt` and `ai/plans/milestone_4/workflow_tests_student_journey/outcome/0-baseline-outcome.md`.
2. WHEN any agent starts any task THEN system SHALL read ALL files in `ai/plans/milestone_4/workflow_tests_student_journey/outcome/` first.
3. WHEN any agent completes any task THEN system SHALL write `outcome/<task-id>-outcome.md` and flip the `[ ]` → `[x]` checkbox in `tasks.md`.
4. WHEN any file is modified THEN system SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file before moving on.
5. WHEN the plan completes THEN `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md` SHALL return 0.

### REQ-001: Layer Compliance of the New Suite (Translation, Enums, Imports, Framework)

**User Story:** As the layer owner, I want the new suite to obey every `test/workflows/AGENTS.md` hard rule, so that it remains green, residue-free, and honest.

**Acceptance Criteria:**
1. WHEN the suite provisions fixtures THEN system SHALL NOT use `runInRollback` anywhere (rule 1) and SHALL provision inside ONE committing `db.transaction(...)` in `beforeAll` (rule 2, commit-or-nothing).
2. WHEN naming fixtures THEN system SHALL derive the per-run prefix via `journeyPrefix("students")` → `jrn_students_<8hex>` (rule 3; `test/workflows/helpers/session-cast.ts:314-316`).
3. WHEN asserting error denials THEN system SHALL use the `catchJourneyError(fn)` try/catch helper (`test/workflows/helpers/journey-fixtures.ts:226`) and assert translated substrings from `getServerTranslations("en").errorsTranslations` — NEVER `expect(...).rejects.toThrow()` (rule 6) and never hardcoded English strings.
4. WHEN importing THEN system SHALL use `bun:test` for test APIs, `@/` aliases for modules, and enum VALUE imports for runtime enum members (`SessionIntent`, `SessionStatus`, `SubscriptionCreditLane`, `RecitationReading`, `NotificationType`, `TransactionType`) (rules 7-8; root AGENTS.md enum rule).
5. WHEN provisioning actors THEN system SHALL use real `users` rows + real role-child rows via `entity-setup.ts` / `actor-context.ts` factories with honest roles — never seed/demo rows, never monkey-patched permissions (rules 4, 9).
6. WHEN any external effect could fire THEN system SHALL intercept it at the dispatch boundary (`SpiedFanoutTransport` injection seams + `spyOn(NotificationEngine, "publishReceipts")` namespace seam) and assert BOTH that a dispatch happened AND which userIds it targeted (rule 5).
7. WHEN the suite uses translations in wave-copy assertions THEN system SHALL pin per-actor locales at provisioning (student `"en"`, parent `"ar"`) because waves compose in the RECIPIENT's locale (precedent `test/workflows/classes/session-report-homework.journey.test.ts:507-543`).

### REQ-002: Consolidated Journey File & Coverage Contract

**User Story:** As the release gate, I want ONE green suite that walks the whole student arc over one committed world, so that cross-domain composition regressions fail loudly.

**Acceptance Criteria:**
1. WHEN the plan completes THEN `test/workflows/students/student-full-journey.journey.test.ts` SHALL exist as ONE file (rule 10) covering, in declaration order, the steps of §5.2 with sequential actor attribution (rule 11).
2. WHEN the suite runs THEN every step SHALL call the REAL production service with the acting user's real `userId` — no HTTP, no Apollo client, no `testClient`.
3. WHEN any step creates shared state THEN later steps SHALL observe it (chain composition; rule 11) and the suite SHALL assert cross-actor visibility BOTH ways: the intended observer sees the change AND every non-participant cast member observes no accidental fan-out (rule 12).
4. WHEN the suite completes THEN it SHALL include at least one denial probe per actor boundary (rule 12) — the minimum set: zero-balance booking denial, foreign-parent portal denial, non-participant confirm denial, GraphQL scope-gate denials.
5. WHEN any existing per-domain suite already covers a fragment deeply THEN this suite SHALL reuse its oracles and assert lean versions only — it adds no new helper, no new oracle pattern, no new production surface (composition ruling R6; `docs/testing/workflow-journey-tests.md:141-147`).

### REQ-003: Registration & Recitation-Echo Leg

**User Story:** As a new student, I want my registration to grant my free trial, mint my handshake code, and echo my recitation choice, so that I can start the journey.

**Acceptance Criteria:**
1. WHEN the student registers via `RegistrationService.registerUser({ ..., country: "EG", role: "student", preferredRecitation: RecitationReading.HAFS_AN_ASIM }, "en")` THEN system SHALL return a user with `role: "student"` and `preferredRecitation: "hafs_an_asim"` echoed (`backend/types/users/registration.types.ts:106-109`).
2. WHEN registration commits THEN `students.balanceTrial` SHALL equal `FREE_TRIAL_SESSION_COUNT` (1) and all paid lanes SHALL be 0 (`shared/constants/free-trial.constants.ts:11`; grant at `backend/services/students/student-trial.service.ts:29`).
3. WHEN the student row is read THEN `handshakeCode` SHALL be non-empty (canonical `KSB-` format) and retrievable via `StudentHandshakeService.getMyHandshakeCode` (`backend/services/students/student-handshake.service.ts:74`).
4. WHEN the echo is asserted THEN system SHALL also assert NO `recitation` row exists for the student (contract-metadata-only ruling R3) — the echo is the entire shipped "select recitation" surface.

### REQ-004: Plan Catalog, Purchase, Settlement & Lane-Credit Leg

**User Story:** As a student, I want to browse active plans, purchase one, and receive my lane credit after settlement, so that I can book paid sessions.

**Acceptance Criteria:**
1. WHEN the student browses `PlanCatalogService.listActiveCatalog("en")` THEN the result SHALL include the journey's active plan (`balanceLane: "hifz"`, `sessionCount: 8`, `price: "200.00"`, `currency: "EGP"`).
2. WHEN the student purchases via `SubscriptionPurchaseService.purchase(studentUserId, { planId }, idempotencyKey, "en")` THEN system SHALL create the pending subscription + pending payment pair with a verbatim checkout reference, touching NO network (the gateway factory resolves the `mock` provider when `PAYMENT_GATEWAY_PROVIDER` is unset — `backend/lib/env.ts:415`; the runtime guard refuses mock only in real production runtimes, `payment-gateway.factory.ts:83`).
3. WHEN the confirmed webhook event is processed via `SubscriptionActivationService.processWebhookEvent({ reference, outcome: "confirmed", amount: plan.price, currency: plan.currency }, "en", undefined, { transport: spied, cache: claimCache })` THEN payment SHALL flip to paid, subscription to active, and `students.balanceHifz` SHALL credit exactly `plan.sessionCount` (8) — the "Balance credited" arc step.
4. WHEN settlement commits THEN exactly ONE `PaymentConfirmation` notification SHALL be persisted and published for the student only (`subscription-activation.service.ts:554-558`; precedent `subscription-purchase.journey.test.ts:550-597`).
5. WHEN the same confirmed event is replayed THEN system SHALL report the replay (`{ processed: true, replayed: true }` shape per `subscription-activation.service.ts:554-558`), SHALL NOT double-credit the lane, and SHALL NOT emit a second notification (replay matrix `docs/testing/workflow-journey-tests.md:169-181`; precedent `subscription-purchase.journey.test.ts:625-657`).

### REQ-005: In-Process GraphQL Parity Leg

**User Story:** As the GraphQL layer owner, I want the journey to prove the schema's scope gates hold for the arc's operations, so that "GraphQL level" coverage is honest without HTTP.

**Acceptance Criteria:**
1. WHEN the journey executes the GraphQL layer THEN it SHALL use the in-process harness — `graphql({ schema: graphQLSchema, source, variableValues, contextValue })` with a hand-built `Context` from the gql context factory (pattern `test/workflows/billing/subscription-purchase.journey.test.ts:189-264`) — never HTTP.
2. WHEN the student context executes the `planCatalog` query THEN the result SHALL return the journey's plan (positive parity between service and schema read).
3. WHEN an anonymous context executes `purchaseSubscription` THEN system SHALL deny with code `UNAUTHORIZED` (the exact code the precedent asserts), with zero writes.
4. WHEN parent and teacher contexts execute `purchaseSubscription` (student-only scope) THEN system SHALL deny with the FORBIDDEN-family code, with zero writes and the student's pending rows byte-identical.

### REQ-006: Parent Link Chain Leg (Real Production Flow)

**User Story:** As a parent, I want to link to my child through the real handshake flow mid-journey, so that I receive the session-completion report wave.

**Acceptance Criteria:**
1. WHEN the parent submits the student's handshake code via `ParentLinkRequestService.requestLink(code, parentUserId, "ar", undefined, { transport, cache })` THEN an outgoing link request SHALL be created and the student SHALL receive the link-request notification wave `{student}` (`parent-link-request.service.ts:168`).
2. WHEN the student accepts via `ParentLinkRequestService.respondToLinkRequest(requestId, true, studentUserId, "en", undefined, { transport, cache })` THEN `students.parentId` SHALL be set to the parent's user id and the parent SHALL receive the acceptance wave `{parent}` (`parent-link-request.service.ts:250`).
3. WHEN the link commits THEN `ParentMonitoringService.listLinkedChildren(parentUserId, "ar")` SHALL return exactly the one student (the linked-during-journey proof, distinct from fixture-linked precedents).
4. WHEN the link chain runs THEN the journey SHALL NOT use `linkStudentToParentFixture` (the direct-write emulation, `test/workflows/helpers/journey-fixtures.ts:157`) — ruling R5.

### REQ-007: Teacher Browse & Session Booking Leg

**User Story:** As a student, I want to browse available teachers matching my recitation and book a session, so that my balance is debited through the real escrow ladder.

**Acceptance Criteria:**
1. WHEN the student browses `TeacherMatchingService.browseAvailableTeachers(studentUserId, { recitation: "hafs_an_asim", intent: SessionIntent.Hifz, page: 1, pageSize: 25, search: null, minRating: null, sort: RATING_DESC }, "en")` THEN the journey's teacher SHALL appear (hard filters: `is_online=true` + recitations token + language resolution — `backend/db/repo/teachers/teacher.repository.matching.helpers.ts:131-137`).
2. WHEN the student books session A via `SessionLifecycleService.createSession(studentUserId, { teacherId, intent: SessionIntent.Hifz }, idempotencyKeyA, "en")` THEN the session SHALL insert at `scheduled` with `fee = "25.00"` and `feeHeld = true` (`SESSION_FEE_HIFZ`, `shared/constants/session-fees.constants.ts:35-38`).
3. WHEN booking commits THEN the debit ladder SHALL consume the TRIAL lane first (`balanceTrial` 1→0) leaving `balanceHifz` at 8 — the ladder-precedence assertion (`session-lifecycle.booking.ts:127-158`).
4. WHEN booking commits THEN the teacher SHALL receive exactly ONE session-request notification wave `{teacher}` (emitter at `session-lifecycle.service.ts:228`).
5. WHEN the student replays the same idempotency key THEN system SHALL deny with `DUPLICATE_REQUEST` and create zero new rows (idempotency replay; precedent `session-lifecycle.journey.test.ts:508-538`).

### REQ-008: Session Lifecycle, Dual Confirmation & Wallet-Credit Leg

**User Story:** As the student and teacher, I want the session to run start→complete→confirm with the escrow released and the teacher paid exactly once.

**Acceptance Criteria:**
1. WHEN the teacher starts session A (`startSession(teacherUserId, sessionIdA, "en")`) THEN status SHALL be `started` and the teacher's `isOnline` SHALL be false (in-session lock; INV-S6 seam) — restored after the terminal exit.
2. WHEN the teacher completes session A (`completeSession(teacherUserId, sessionIdA, "en")`) THEN status SHALL be `completed` and the student SHALL receive exactly ONE completion-prompt wave `{student}` (emitter `session-lifecycle.service.ts:438`).
3. WHEN the student confirms via `confirmSessionCompletion(studentUserId, sessionIdA, "en")` THEN `feeHeld` SHALL flip to false, the teacher wallet SHALL be ensured once and credited exactly `"25.00"` on BOTH `balance` and `total_earning`, exactly ONE `teacher_transaction` row of type `earning` with the fee verbatim SHALL exist, and ZERO notifications SHALL be published (notification-free confirmation; `session-lifecycle.confirmation.ts:123-139`; precedent `session-dual-confirmation.journey.test.ts:463-497`).
4. WHEN confirmation commits THEN `students.balanceTrial` and `balanceHifz` SHALL be unchanged (hold-as-debit ruling R4) and the student's progress row SHALL be incremented (`incrementForConfirmedSession` composes in the same transaction).
5. WHEN a non-participant (the foreign parent) attempts `confirmSessionCompletion` THEN system SHALL deny oracle-safely (`SESSION_NOT_FOUND` family) with the session row byte-identical (rule 12; precedent `parent-full-journey.journey.test.ts:919-1000`).

### REQ-009: Report, Parent Wave & Portal Read Leg

**User Story:** As a linked parent, I want the session report to notify me and remain readable in my read-only portal.

**Acceptance Criteria:**
1. WHEN the teacher submits the report via `submitSessionReport(teacherUserId, sessionIdA, { teacherNotes, studentRatingByTeacher: 5, homework: {...} }, "en", undefined, { transport: spied, cache })` THEN exactly TWO localized receipt waves SHALL fire — student (`en` copy) AND linked parent (`ar` copy) — with exactly TWO fan-out publishes targeting `{student, parent}` and report + homework rows persisted (`session-report.service.ts:357`; wave `session-report-notification.service.ts:147`).
2. WHEN the waves land THEN the parent's `notifications` inbox SHALL carry a `session_completion`-type row with the `(type, "session", sessionId)` related-entity triple (deep-link contract; precedent `parent-session-completion-deep-link.journey.test.ts:534-560`).
3. WHEN the parent resolves the deep link via `ParentMonitoringService.getSessionTarget(parentUserId, sessionIdA, "ar")` THEN it SHALL return `{ sessionId, studentId }` and the landing URL shape SHALL be `/parent/children/<studentId>?tab=reports&session=<sessionId>` (asserted as data, not UI).
4. WHEN the parent reads the portal THEN `listChildReports` SHALL show exactly the one report, `listChildSessions` the completed session, `listChildHomework` the assigned homework, `getChildProgress` the confirmed-session progress, and `listLinkedChildren` the one child (`parent-monitoring.service.ts:178-449`).
5. WHEN the FOREIGN parent (never linked) attempts `listChildReports`/`listChildSessions` on the same student THEN system SHALL deny with the portal's constant 403 and the owner's rows SHALL be byte-identical (rule 12; precedent `parent-monitoring.journey.test.ts:813-869`).
6. WHEN the parent attempts a WRITE on the student's world (e.g. `confirmSessionCompletion`) THEN system SHALL deny oracle-safely (REQ-008.5) — the read-only ruling enforced at the service layer (`docs/parents/monitoring-portal.md`).

### REQ-010: Edge — Insufficient Balance

**User Story:** As a zero-balance student, I want my booking attempt to fail atomically, so that no session or hold is created.

**Acceptance Criteria:**
1. WHEN the zero-balance student (direct-insert: `createTestStudent` grants NO trial) attempts `createSession` with any certified teacher THEN system SHALL throw the `INSUFFICIENT_BALANCE` ValidationError (`session-lifecycle.booking.ts:149-156`) and the message SHALL match the translated `errorsTranslations` substring.
2. WHEN the denial fires THEN zero session rows, zero holds, and zero ledger writes SHALL exist for that student.
3. WHEN the denial fires THEN the idempotency key SHALL NOT be burned (no `session_request_idempotency` row for the key) — the whole booking rolls back including the claim (precedent `session-lifecycle-denials.journey.test.ts:236-317`).

### REQ-011: Edge — Session Cancellation with Same-Lane Refund

**User Story:** As a student, I want to cancel a booked paid-lane session and receive my credit back exactly once.

**Acceptance Criteria:**
1. WHEN the student books session B (`createSession`, key B) THEN the debit ladder SHALL consume the PAID hifz lane (`balanceHifz` 8→7, trial already 0) — the purchased-balance decrement proof.
2. WHEN the student cancels via `cancelSession(studentUserId, sessionBId, reason, "en")` THEN status SHALL be `cancelled`, `feeHeld` SHALL be false, and the SAME provenance lane SHALL be refunded exactly once (`balanceHifz` 7→8) via the one shared refund primitive (`session-lifecycle.service.ts:490-516`).
3. WHEN the cancellation commits THEN ZERO notification waves SHALL fire (participant cancel is refund+lock-release only; no notify calls in the cancel path — verified `session-lifecycle.service.ts:490-540`).
4. WHEN a terminal-state session is cancelled again THEN system SHALL deny with `SESSION_INVALID_TRANSITION` and the row SHALL be byte-identical (precedent `session-lifecycle.journey.test.ts:661-682`).

### REQ-012: Edge — Post-Confirmation Dispute & Admin Arbitration Reversal

**User Story:** As a student with a consumed escrow, I want the dispute→arbitration path to reverse the money symmetrically, so that balances, wallet, and ledger stay consistent.

**Acceptance Criteria:**
1. WHEN the journey books session C (paid lane, 8→7), starts, completes, and confirms it THEN the teacher wallet SHALL reach `"50.00"` (two earnings) with a second `earning` ledger row (the pre-dispute baseline).
2. WHEN the student opens the dispute via `SessionArbitrationService.openPostConfirmationDispute(studentUserId, sessionCId, reason, "en")` THEN status SHALL be `disputed` and the governance-clean admin wave SHALL include the cast admin's userId (`session-arbitration.service.ts:193`; emitter `session-dispute-notification.service.ts:259`; membership assertion — the DB may hold other admins, so assert contains, not equals).
3. WHEN the admin arbitrates `Refund` via `SessionArbitrationService.arbitrateDispute(adminUserId, sessionCId, "Refund", note, null, "en")` THEN the teacher wallet SHALL be debited exactly `"25.00"`, the student's hifz lane SHALL be restored (7→8), and a compensating `TransactionType.ArbitrationReversal` ledger row SHALL exist (precedent `post-confirmation-dispute.journey.test.ts:654-688`).
4. WHEN the resolution commits THEN both participants (student + teacher) SHALL receive the resolution wave and the session SHALL reach its terminal resolution status.
5. WHEN the money story is totaled THEN the final consistency sweep (REQ-013) SHALL reconcile: `balanceTrial=0`, `balanceHifz=8`, wallet balance `"25.00"`, exactly TWO `earning` rows + ONE `arbitration_reversal` row, one report, one homework row, sessions A (confirmed), B (cancelled), C (resolved).

### REQ-013: Final Cross-Table Consistency Sweep

**Acceptance Criteria:**
1. WHEN the last arc step completes THEN a dedicated sweep step SHALL re-read every money row (student lanes, session fees/holds, wallet, teacher_transaction ledger), every content row (report, homework, notifications inbox per actor), and every link row (subscription, payment, parent link) and assert the full expected end-state table in ONE step — the ticket's "data is consistent across all tables" as a single auditable assertion.

### REQ-014: Teardown, Zero-Residue & Idempotent Double-Run

**Acceptance Criteria:**
1. WHEN `afterAll` runs THEN the suite SHALL restore all spies, sweep append-only rows under sanctioned trigger suspension (`withImmutabilityTriggersSuspended(["teacher_transaction", "student_payments"])`, `withAuditDeleteTriggersSuspended` — `test/helpers/db-cleanup.ts:229`; precedents `session-dual-confirmation.journey.test.ts:326-331`, `subscription-purchase.journey.test.ts:432-448`), then `TrackedFixtures.cleanup()` in reverse registration order with mandatory zero-residue re-probes (`test/workflows/AGENTS.md:12-19`).
2. WHEN cleanup finishes THEN EVERY registered row SHALL be re-probed absent — a leaking `afterAll` MUST fail the suite (rule 2).
3. WHEN the suite is run twice consecutively THEN both runs SHALL be green (idempotent-teardown proof; per-run `jrn_students_<8hex>` prefixes make collisions impossible).

## 4. UX/Navigation Requirements (MANDATORY — explicit no-UI ruling)

This is a **test-only ticket**: it adds NO routes, NO sidebar items, NO tabs, NO components, NO locale keys, NO mobile surfaces.

| Question | Ruling |
|---|---|
| New routes & URLs | **NONE.** The only URL-shaped artifact is the parent deep-link landing string `/parent/children/<studentId>?tab=reports&session=<sessionId>`, asserted as DATA (REQ-009.3), not rendered |
| Sidebar/navigation integration | NONE (no UI) |
| Role-based access matrix | The suite PROVES the existing matrix instead: student-only purchase scope, teacher-only start/complete, parent read-only portal + constant-403 denial, admin-only arbitration, anonymous denial — see REQ-005, REQ-006, REQ-008.5, REQ-009.5, REQ-012 |
| Per-audience rendering | N/A — asserted behaviorally via cross-actor visibility (rule 12), not visually |
| Permission mapping | N/A — no new permission strings exist or are needed |

## 5. Cross-Actor Workflow Scenarios (Journeys)

This feature IS a journey: the entire requirement set maps onto ONE `test/workflows/students/student-full-journey.journey.test.ts` suite. `docs/testing/workflow-journey-tests.md` (`:16-28`) defines the layer: sequential actor-attributed steps, each step one service call with the actor's real `userId`, over committed shared state.

### 5.1 Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| **S** — primary student | `student` (registered via REAL `RegistrationService`, locale `en`, country `EG`, `preferredRecitation: hafs_an_asim`) | browse catalog, purchase, read handshake, accept link, browse teachers, book, cancel own, confirm completion, open post-confirmation dispute, read own report | book beyond balance, act on others' sessions, arbitrate |
| **P** — parent | `parent` (registered via REAL `RegistrationService`, locale `ar`) | request link by code, read linked child's sessions/reports/homework/progress, resolve deep link | write anything in the child's world (confirm/cancel/book), read unlinked children |
| **T** — teacher | `teacher` (direct-insert, `isApproved: true`, `isOnline: true`, full directory metadata) | start, complete, submit report/homework on own sessions | confirm (no-op), browse as student, purchase |
| **A** — admin | `admin` (direct-insert) | arbitrate disputes (Refund family), receive dispute waves | book sessions, purchase |
| **S2** — zero-balance student | `student` (direct-insert — `createTestStudent` grants NO trial) | nothing on the happy path (existence proves the denial) | book with zero balance (INSUFFICIENT_BALANCE) |
| **P2** — foreign parent | `parent` (direct-insert, never linked) | nothing on the happy path | read S's portal surfaces (constant 403) |
| **System** | fixture/setup actor | provisions the cast + plan row in ONE committed transaction | — |

### 5.2 Ordered Step List (the chain — maps 1:1 onto REQ-003…REQ-013)

| # | Actor → action | Expected shared-state change + side effects | REQ |
|---|---|---|---|
| 0 | System: committed `beforeAll` — register S + P (real service, outerTx), direct-insert T (full metadata) / A / S2 / P2, `createTestPlan(balanceLane: hifz, sessionCount: 8, price: "200.00")`; track every row | Cast + plan exist; registration side effects: `balanceTrial=1` (S), handshake code minted | 001, 003 |
| 1 | Student: observe registration outcomes (user/student rows, trial=1, handshake non-empty, `preferredRecitation` echo, zero recitation rows) | Arc steps "Register", "Select recitation" proven | 003 |
| 2 | Student: `listActiveCatalog("en")` | Journey plan visible | 004 |
| 3 | Student: GraphQL `planCatalog` query in-process (student context) | Positive schema parity | 005 |
| 4 | Student: `purchase(S, { planId }, keyP, "en")` | Pending subscription + payment + checkout ref; no network | 004 |
| 5 | Anonymous/Parent/Teacher: GraphQL `purchaseSubscription` denial probes in-process | `UNAUTHORIZED` (anonymous) / `FORBIDDEN` (parent, teacher) — exact precedent codes; zero writes | 005 |
| 6 | System: `processWebhookEvent(confirmed event, …, { transport, cache })` | Payment paid, subscription active, `balanceHifz` 0→8, ONE `PaymentConfirmation` wave `{S}` | 004 |
| 7 | System: replay the same event | `{ processed: true, replayed: true }`; lane stays 8; no second wave | 004 |
| 8 | Student: `getMyHandshakeCode(S, "en")` | Non-empty code (KSB- format) | 006 |
| 9 | Parent: `requestLink(code, P, "ar", …, { transport, cache })` | Link-request row + student wave `{S}` | 006 |
| 10 | Student: `respondToLinkRequest(requestId, true, S, "en", …)` | `students.parentId = P`; parent acceptance wave `{P}`; `listLinkedChildren(P)` = [S] | 006 |
| 11 | Student: `browseAvailableTeachers(S, { recitation: hafs_an_asim, intent: Hifz, … }, "en")` | Teacher T present in page | 007 |
| 12 | Student: `createSession(S, { teacherId: T, intent: Hifz }, keyA, "en")` → session A | `scheduled`, fee 25.00, `feeHeld=true`, trial 1→0 (hifz stays 8), ONE request wave `{T}` | 007 |
| 13 | Student: replay keyA | `DUPLICATE_REQUEST`; zero new rows | 007 |
| 14 | Teacher: `startSession(T, sessionA, "en")` | `started`; T `isOnline=false` (in-session lock) | 008 |
| 15 | Teacher: `completeSession(T, sessionA, "en")` | `completed`; ONE prompt wave `{S}` | 008 |
| 16 | Student: `confirmSessionCompletion(S, sessionA, "en")` | `feeHeld=false`; wallet ensured+credited 25.00; ONE `earning` ledger row; ZERO waves; lock released (`isOnline=true`); progress incremented; lanes unchanged | 008 |
| 17 | Parent (denial): `confirmSessionCompletion(P, sessionA, "en")` | `SESSION_NOT_FOUND`-family; row byte-identical (read-only proof) | 008, 009 |
| 18 | Teacher: `submitSessionReport(T, sessionA, { notes, rating: 5, homework }, "en", undefined, { transport, cache })` | Report + homework rows; TWO waves `{S en, P ar}`; TWO publishes | 009 |
| 19 | Student: `getSessionReport(S, sessionA, "en")` | Report visible to owner | 009 |
| 20 | Parent: inbox + `getSessionTarget(P, sessionA, "ar")` | `session_completion` inbox row with `(type, "session", id)` triple; `{ sessionId, studentId }` target; landing URL shape | 009 |
| 21 | Parent: portal reads — `listLinkedChildren`, `listChildSessions`, `listChildReports`, `listChildHomework`, `getChildProgress` | 1 child, completed session A, 1 report, 1 homework, confirmed progress | 009 |
| 22 | P2 (denial): `listChildReports(P2, S)` | Constant 403; owner rows byte-identical | 009 |
| 23 | S2 (edge): `createSession(S2, { teacherId: T, intent: Hifz }, keyD, "en")` | `INSUFFICIENT_BALANCE`; zero writes; keyD unburned | 010 |
| 24 | Student: `createSession(S, { teacherId: T, intent: Hifz }, keyB, "en")` → session B | Paid-lane debit: hifz 8→7 (trial 0); `feeHeld=true` | 011 |
| 25 | Student: `cancelSession(S, sessionB, reason, "en")` | `cancelled`; `feeHeld=false`; hifz 7→8 (same-lane refund once); ZERO waves | 011 |
| 26 | Student: replay cancel on session B | `SESSION_INVALID_TRANSITION`; byte-identical | 011 |
| 27 | Student: `createSession(S, { teacherId: T, intent: Hifz }, keyC, "en")` → session C; Teacher: `startSession`, `completeSession`; Student: `confirmSessionCompletion` | hifz 8→7 → confirmed; wallet 25.00→50.00; second `earning` row; prompt wave `{S}` | 012 |
| 28 | Student: `openPostConfirmationDispute(S, sessionC, reason, "en")` | `disputed`; admin wave contains `{A}` | 012 |
| 29 | Admin: `arbitrateDispute(A, sessionC, "Refund", note, null, "en")` | Wallet 50.00→25.00; hifz 7→8; ONE `ArbitrationReversal` row; participants wave `{S, T}`; terminal resolution | 012 |
| 30 | System: final consistency sweep (one step, full end-state table) | trial=0, hifz=8, wallet 25.00, 2 earnings + 1 reversal, 1 report, 1 homework, sessions A/B/C in expected statuses, per-actor inbox counts | 013 |
| 31 | System: `afterAll` teardown (restore spies → trigger-suspension sweeps → `TrackedFixtures.cleanup()` → zero-residue re-probes) | ZERO residue; second consecutive run green | 014 |

### 5.3 Cross-Actor EARS Criteria (observer perspective)

1. WHEN the student's settlement commits THEN the student observer SHALL see `balanceHifz` credited by exactly `sessionCount` AND the teacher/parent/admin inboxes SHALL record nothing (no fan-out).
2. WHEN the teacher completes the session THEN the student observer SHALL receive exactly one completion prompt AND the parent observer SHALL record nothing yet (parent wave is report-gated — ruling R5).
3. WHEN the teacher submits the report THEN the parent observer (linked during the journey) SHALL receive the `arabic`-locale report wave AND the foreign parent P2 SHALL observe nothing.
4. WHEN the student confirms completion THEN the teacher observer SHALL see wallet + fee exactly once AND all other inboxes SHALL be untouched (confirmation is notification-free).
5. WHEN the student opens the post-confirmation dispute THEN the admin observer SHALL receive the dispute wave AND the teacher observer SHALL see the session flip to `disputed` with the wallet balance unchanged until resolution.
6. WHEN the admin resolves `Refund` THEN the student observer SHALL see the lane restored, the teacher observer SHALL see the wallet debited exactly the fee, and both SHALL receive the resolution wave.
7. IF any non-owner (S2 zero-balance, P2 foreign parent, anonymous caller, parent-as-writer) attempts an out-of-scope action THEN system SHALL deny through the real authorization/ownership path with zero writes AND the owner's rows SHALL remain byte-identical.

## 6. Non-Functional Requirements

### Performance & runtime
1. WHEN the suite runs via `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts` THEN every step SHALL complete within the runner's 60s per-test timeout; the full suite SHALL stay in the same runtime band as `parents/parent-full-journey.journey.test.ts` (~20 steps, largest precedent).
2. WHEN run in the whole-layer sweep (`bun run test/scripts/run-test.ts test/workflows`) THEN the suite SHALL coexist with its siblings (per-run prefixes guarantee no collision — rule 3).

### Security & honesty (test-layer equivalent)
3. WHEN authorization matters THEN every denial SHALL resolve through the real role/ownership path — no monkey-patching, no permission stubs (rule 4).
4. WHEN external effects exist THEN nothing SHALL reach real email/SMS/push/FX/payment providers: the gateway is the mock provider, transports are spied, the claim cache is in-memory (rule 5).

### Reliability
5. WHEN teardown fails to remove any row THEN the suite SHALL fail loudly (mandatory re-probes) — a residue leak is a defect, never a warning.
6. WHEN the suite re-runs THEN per-run UUID prefixes SHALL make it collision-free and idempotent.

## 7. Constraints & Assumptions

### Technical constraints
- **Layer law supersedes ticket prose** wherever they conflict (rulings R1, R2); `test/workflows/AGENTS.md` is non-negotiable.
- The workflows layer has **NO CI wiring** today (`​.github/workflows/ci.yml` runs only quality/db/services/graphql jobs) — local/runner execution only (ledger D1).
- `run-test.ts` pins `DATABASE_URL` from `.env.test` (the `kottaby_test` PostgreSQL DB) — never the dev DB.
- Money constants are frozen: `SESSION_FEE_HIFZ/TAJWEED = "25.00"` EGP, `SESSION_CONFIRMATION_WINDOW_MS = 86_400_000`, `FREE_TRIAL_SESSION_COUNT = 1`.
- The plan row MUST set `balanceLane` explicitly — a NULL-lane plan fails closed at purchase (`backend/db/schema/billing/plans.ts:13-16, :29`).

### Assumptions
- The test DB may contain seeded admins; the dispute-wave assertion is therefore membership-based (`contains adminId`), never set-equality.
- The gateway factory resolves the `mock` provider when `PAYMENT_GATEWAY_PROVIDER` is unset (`backend/lib/env.ts:415`) — the case in `.env.test` runs; `.env.example:384` documents the switch. Checkout returns without network.
- The mock gateway's checkout reference is sufficient to fabricate the confirmed `PaymentWebhookEvent` (exact precedent `subscription-purchase.journey.test.ts:540-550`).

## 8. Success Criteria

### Definition of Done
- [ ] REQ-000…REQ-014 acceptance criteria all demonstrably green in the new suite (traceability: every REQ maps to ≥1 step in §5.2 and ≥1 task in `tasks.md`).
- [ ] Suite green TWICE consecutively; zero residue; `bun run test/scripts/run-test.ts test/workflows` whole-layer sweep stays green (no sibling breakage).
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 on every touched file.
- [ ] Deferred ledger shows zero ❌/⚠️ rows.
- [ ] Docs propagation task complete (`docs/testing/workflow-journey-tests.md` example list + outcome synthesis).

### Acceptance metrics
| Metric | Target |
|---|---|
| Journey steps (sequential, actor-attributed) | ~31 (§5.2) |
| Denial probes (rule 12 minimum exceeded) | ≥6 (steps 5, 13, 17, 22, 23, 26) |
| Money rows asserted (lanes, fee/hold ×3 sessions, wallet, 3 ledger rows) | full end-state table in step 30 |
| New production code | 0 lines |
| New helper modules | 0 |

## 9. Glossary

| Term | Definition |
|---|---|
| Lane (balance lane) | One of `students.balance_trial/balance_hifz/balance_tajweed/balance_reviews` — segregated session credits (`backend/db/schema/students/students.ts:24-27`) |
| Hold-as-debit | The shipped ruling: booking decrements the lane and holds the fee (`fee_held=true`); confirmation flips the hold and pays the teacher (`docs/billing/escrow-and-wallet-crediting.md` §2) |
| Provenance lane | The lane a booking recorded as its debit source; refunds return to the SAME lane, exactly once |
| Dual confirmation | `scheduled→started→completed` then the student's `confirmSessionCompletion` releases escrow + credits wallet (`docs/workflows/03-session-lifecycle-escrow.md:15-31`) |
| Handshake code | Per-student `KSB-` code minted at registration; the parent's link-request lookup key (`student-handshake.service.ts:74`) |
| Journey test | Sequential multi-actor suite under `test/workflows/` driving real services over committed fixtures (`docs/testing/workflow-journey-tests.md:16-28`) |
| In-process GraphQL harness | `graphql()` execution of the real Pothos schema with a hand-built `Context` — the only sanctioned "GraphQL API" touch in this layer |
| TrackedFixtures | Table-generic fixture registry: reverse-registration hard-delete + mandatory zero-residue re-probes (`test/workflows/helpers/tracked-fixtures.ts:173-263`) |
| Consolidated journey | ONE suite chaining a ticket's whole arc, reusing per-domain oracles, adding nothing new (`docs/testing/workflow-journey-tests.md:141-158`) |

---

## Requirements Review Checklist (self-validation)

- [x] All user roles identified (student, parent, teacher, admin + 2 denial actors)
- [x] Normal, edge (REQ-010/011/012), and error/denial cases covered
- [x] EARS format used consistently; observer-perspective criteria included (§5.3)
- [x] Cross-actor journey captured (actor table + ordered steps + both-way visibility + denials)
- [x] UX/Nav section present with explicit no-UI ruling
- [x] Ticket-vs-reality reconciliations explicit and ratifiable (R1–R7)
- [x] Blocked-by gate verified with production-code evidence (§2.2)
- [x] Testable, measurable success criteria; no conflicting requirements
