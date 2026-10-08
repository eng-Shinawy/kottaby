# Design: Workflow Tests (Student Journey)

> **Plan directory (verbatim):** `ai/plans/milestone_4/workflow_tests_student_journey`
> **Specs of record:** `ai/plans/milestone_4/workflow_tests_student_journey/specs.md` (REQ-000…REQ-014, rulings R1–R7)
> **Ticket:** `Workflow Tests: Student Journey` — Milestone 4 · Dev 1 · 5 SP · blocked by all M1–3 tickets, all verified implemented (`docs/planning/TICKETS.md:2704-2731`; specs §2.2)
> **Deliverable of record:** `test/workflows/students/student-full-journey.journey.test.ts` — ONE consolidated chained suite. ZERO production code, ZERO schema change, ZERO new helpers, ZERO UI, ZERO locale keys.
> **Layer law:** `test/workflows/AGENTS.md` (12 hard rules) + `docs/testing/workflow-journey-tests.md` (runbook). Where the ticket Gherkin conflicts with either, the layer law wins (rulings R1, R2 in specs.md).

---

## 1. Overview

The design composes the ticket's 14-step Gherkin arc into ONE sequential, actor-attributed journey over ONE committed world. The cast is provisioned in a single committing `beforeAll` transaction (real-service registration for student + parent; direct-insert for teacher/admin/denial actors; one lane-targeted plan row). The arc is then driven entirely through real production services — the same services the per-domain suites already lock individually — chained so each step observes the state the previous step committed. Three lean edge legs (zero-balance denial, paid-lane cancellation, post-confirmation dispute reversal) extend the same world; a GraphQL scope-gate parity leg uses the sanctioned in-process schema harness; a final sweep asserts the full money/content end-state in one step; the teardown proves zero residue and idempotent double-run.

### Design Goals
1. **Composition proof over fragment re-testing** — the suite's value is the CHAIN (R6); every assertion reuses an existing oracle pattern from a precedent suite (cited per step in §6.4).
2. **Zero new scaffolding** — `TrackedFixtures` + `actor-context` + `SpiedFanoutTransport` + `InMemoryClaimCache` + `journeyPrefix` are the only helpers consumed; nothing is added to `test/workflows/helpers/` (its self-test therefore needs no extension).
3. **Money honesty** — assert the SHIPPED semantics (hold-as-debit R4, report-wave R5), never the ticket's stale wording; the end-state table must close arithmetically.

### Key Design Decisions

**D1 — ONE consolidated suite, not a family of new suites.** Options: (a) one chained file; (b) per-edge-case files. Chose (a): the composition guidance prescribes it (`docs/testing/workflow-journey-tests.md:141-158`), every edge case already has a deep per-domain home (specs §2.3), and a single committed world is the only way to prove cross-domain consistency. Edge legs are STEPS in the same world, not new suites.

**D2 — Registry choice: `TrackedFixtures`, NOT `createSessionFixtureRegistry`.** The session-scoped registry tracks only 9 tables (`test/workflows/helpers/journey-fixture-registry.ts:73-83`) — no vocabulary for plans, subscriptions, payments, reports, homework, notifications, link requests, wallets. The table-generic `TrackedFixtures` (`tracked-fixtures.ts:173-263`) is the dominant modern pattern (43 suites) and the consolidated journey spans billing+classes+parents+notifications domains. Reverse-registration-order deletes + mandatory `verifyAllAbsent` re-probes give the rule-2 guarantee.

**D3 — Real-service registration INSIDE the committed beforeAll transaction.** `RegistrationService.registerUser(input, locale, outerTx?)` accepts `outerTx` (`backend/services/auth/registration.service.ts:89-92`), so student + parent registrations ride the ONE committing setup transaction (commit-or-nothing, rule 2) while still exercising the REAL registration path (free-trial grant, handshake mint, recitation validation). This improves on the `createJourneyCast` precedent (`journey-fixtures.ts:251`, which registers outside any outer tx) while consuming the same service.

**D4 — Dispute edge uses the POST-CONFIRMATION generation.** Options: held-escrow dispute (cheaper: book→start→dispute→resolve Cancel) vs post-confirmation arbitration (full second confirm cycle, then wallet reversal). Chose post-confirmation: (a) it exercises the M3 arbitration surface `SessionArbitrationService` the chain otherwise never touches; (b) the credit→reversal symmetry is the strongest possible proof of the ticket's "data is consistent across all tables" for wallets; (c) held-escrow already has a deep home in `sessions/session-state-machine.journey.test.ts:235-341` (ledger D4). The extra 3 service calls are the accepted cost.

**D5 — GraphQL coverage = in-process harness, denial-weighted.** One positive read (`planCatalog` with student context) + scope-gate denials for `purchaseSubscription` (anonymous / parent / teacher), mirroring `test/workflows/billing/subscription-purchase.journey.test.ts:189-264, 731-771` exactly (`graphql()` + `graphQLSchema` + hand-built `Context` + `expectSingleDenial`-style single-error assertion). No HTTP, no `testClient`, no new harness code — the pattern is copied, not invented.

**D6 — Interception seam map is fixed per service.** Services accepting `options?: NotificationEngineCallOptions` (report submission, link requests, webhook settlement) get the injected `{ transport: SpiedFanoutTransport, cache: InMemoryClaimCache }` seam; lifecycle methods with no options seam (createSession/startSession/completeSession/confirm) get the `spyOn(NotificationEngine, "publishReceipts")` namespace seam (precedent `session-lifecycle.journey.test.ts:250-263`). Publish-window discipline per `docs/testing/workflow-journey-tests.md:95-103`: open the window after the triggering await, assert exact window deltas.

**D7 — Synthetic webhook settlement, no gateway network.** The confirmed `PaymentWebhookEvent` is fabricated from the pending purchase's `paymentReference` + the plan row's verbatim `price`/`currency` and processed via `processWebhookEvent` directly — the exact precedent (`subscription-purchase.journey.test.ts:117-133, :540-550`). The gateway factory's `mock` default (resolved when `PAYMENT_GATEWAY_PROVIDER` is unset, `backend/lib/env.ts:415`) guarantees checkout itself touches no network in `.env.test` runs.

**D8 — Lane choreography across three sessions.** Session A books AFTER purchase and consumes the TRIAL lane (ladder precedence: trial before paid — the ladder-order proof, `session-lifecycle.booking.ts:127-158`); session B books on the PAID hifz lane (the purchased-balance decrement proof) and is cancelled (same-lane refund proof); session C books on the paid lane and runs the full confirm→dispute→Refund reversal (wallet symmetry proof). End state: trial 0, hifz back to 8, wallet exactly one surviving earning.

## 2. UX/Navigation Specification (explicit no-UI ruling)

**This design adds NO user-facing surface.** No routes, no sidebar entries, no tabs, no components, no locale keys, no mobile changes. The suite PROVES the existing navigation contract instead:

| Surface (existing, unchanged) | Proven by |
|---|---|
| Parent deep-link landing `/parent/children/<studentId>?tab=reports&session=<sessionId>` | REQ-009.3 — asserted as the returned data + URL shape (precedent `parent-session-completion-deep-link.journey.test.ts:583-633`) |
| Role access matrix (student purchase/browse/book; teacher start/complete/report; parent read-only portal; admin arbitration; anonymous denial) | REQ-005/006/008/009/012 denial + positive steps |
| Read-only parent portal | REQ-009.5/009.6 — write denial + foreign-parent 403 |

Permission mapping: N/A — no new permission strings. Per-audience rendering: N/A — behavioral assertions only.

## 3. Data Models (tables the journey touches; no schema change)

### 3.1 Cast + fixture rows (created in beforeAll; ALL tracked in `TrackedFixtures`)

| Table | Drizzle export (file) | Rows | Notes |
|---|---|---|---|
| `users` | `users` (`backend/db/schema/users/users.ts`) | 6 (S, P, T, A, S2, P2) | S+P via real service; roles: student/parent/teacher/admin/student/parent |
| `students` | `students` (`backend/db/schema/students/students.ts:24-27`) | 2 (S: trial=1; S2: all lanes 0 — `createTestStudent` grants NO trial) | lanes: `balanceHifz/balanceReviews/balanceTajweed/balanceTrial` |
| `parents` | `parents` (`backend/db/schema/parents/parents.ts:11`) | 2 (P, P2) | PK-only rows |
| `teacher` | `teacher` (`backend/db/schema/teachers/teacher.ts`) | 1 (T: `isApproved: true`, `isOnline: true`, `recitations: ["hafs_an_asim"]`, `subjects: ["hifz"]`, `languages` per recipe, `averageRating`) | `createTestTeacherRow` + metadata overrides (`on-demand-matching.journey.test.ts:435-465` recipe; tokens = `RecitationReading`/`SessionIntent` members, JSON-stringified via `jsonColumnPayload`) |
| `admin` | `admin` (`backend/db/schema/users/admin.ts:10`) | 1 (A) | `createTestAdmin` |
| `plans` | `plans` (`backend/db/schema/billing/plans.ts:29`) | 1 active plan: `balanceLane: SubscriptionCreditLane.Hifz`, `sessionCount: 8`, `price: "200.00"`, `currency: "EGP"`, `intervalDays: 30` | NULL lane fails closed — lane MUST be explicit |

### 3.2 Service-created rows (created DURING steps; every id registered into the same `TrackedFixtures`)

| Table | Export | Created by | Cleanup class |
|---|---|---|---|
| `subscriptions` | `subscriptions` | `purchase` (pending → active) | tracked |
| `student_subscriptions` | `studentSubscriptions` (`backend/db/schema/billing/student-subscriptions.ts:20`) | activation | composite-PK junction — swept by subscription id + re-probed (precedent `subscription-purchase.journey.test.ts:439-448`) |
| `student_payments` | `studentPayments` | purchase + settlement | **DELETE-blocked by immutability trigger** — swept in `afterAll` under `withImmutabilityTriggersSuspended(["student_payments"])` |
| `subscription_purchase_idempotency` | `subscriptionPurchaseIdempotency` (`backend/db/schema/billing/subscription-purchase-idempotency.ts:24`) | purchase claim | tracked |
| `parent_link_requests` | `parentLinkRequests` (`backend/db/schema/parents/parent-link-requests.ts:39`) | requestLink → accepted | tracked |
| `notifications` | `notifications` (`backend/db/schema/notifications/notifications.ts:30`) | every wave | tracked (parent-full-journey precedent registers inbox rows before cleanup, `:1002`) |
| `session` | `session` (`backend/db/schema/classes/session.ts:64-68`) | 3 bookings (A, B, C) | tracked; `fee: "25.00"`, `feeHeld` per step |
| `session_request_idempotency` | `sessionRequestIdempotency` (`backend/db/schema/classes/session-request-idempotency.ts:24`) | booking claims (A, B, C — NOT the denied S2 key) | tracked |
| `reports` | `reports` (`backend/db/schema/classes/reports.ts:20`) | report submit (session A) | tracked |
| `home_work` | `homeWork` (`backend/db/schema/classes/home-work.ts:23`) | report submit homework input | tracked |
| `progress` | `progress` (`backend/db/schema/classes/progress.ts:19`) | `incrementForConfirmedSession` at confirm | tracked |
| `wallet` | `wallet` (`backend/db/schema/billing/wallet.ts:20`) | `ensureWalletOnce` at first confirm | tracked |
| `teacher_transaction` | `teacherTransaction` (`backend/db/schema/billing/teacher-transaction.ts:31`) | 2 `earning` + 1 `arbitration_reversal` | **DELETE-blocked** — swept under `withImmutabilityTriggersSuspended(["teacher_transaction"])` (precedent `session-dual-confirmation.journey.test.ts:326-331`) |
| `audit_logs` | `auditLogs` (`backend/db/schema/audit/audit-logs.ts:30`) | arbitration resolution | swept under `withAuditDeleteTriggersSuspended` (actor + related-entity sweep; precedent `post-confirmation-dispute.journey.test.ts:429-451`) |

**Teardown order:** restore spies → suspend triggers → delete immutable/append-only rows by our ids → `tracked.cleanup()` (reverse-registration, FK-safe) → `verifyAllAbsent`-style re-probes (rule 2). Registration order IS the FK-safe deletion order (children before `users`).

## 4. API Contracts — GraphQL SDL Exercised + Permission Matrix

The journey never speaks HTTP. The "GraphQL API" touch is the in-process harness (D5): `graphql({ schema: graphQLSchema, source, variableValues, contextValue })` with a hand-built `Context` (pattern copied verbatim from `test/workflows/billing/subscription-purchase.journey.test.ts:87-105, 189-264`). No SDL changes ship; the fields below already exist and are only EXECUTED.

### 4.1 Operations exercised (all EXISTING — no schema change)

| GraphQL field | Kind | Scope (verified) | Journey use |
|---|---|---|---|
| `planCatalog: [Plan!]!` | query (`backend/graphql/query/plan-catalog.query.ts:18`) | `{ authenticated: true }` | positive parity read with student context (step 3) |
| `purchaseSubscription(input): PurchaseSubscriptionPayload!` | mutation (`backend/graphql/mutation/subscription-purchase.mutation.ts:51`) | `$all: { authenticated, role: [Student] }`; idempotency from `ctx.idempotencyKey` | denial probes: anonymous / parent / teacher contexts (step 5) |

### 4.2 Permission matrix (proven, not changed)

| Caller context | `planCatalog` | `purchaseSubscription` | `browseAvailableTeachers` | `createSession` | `startSession`/`completeSession` | `confirmSessionCompletion` | parent portal reads | `arbitrateDispute` |
|---|---|---|---|---|---|---|---|---|
| student (S) | ✅ | ✅ | ✅ (service additionally requires a real student row) | ✅ | — (non-owner → oracle-safe deny) | ✅ own | — | — |
| teacher (T) | ✅ | ❌ FORBIDDEN-family | ❌ (service `NotFoundError("STUDENT")`) | ❌ | ✅ own | no-op on own | — | — |
| parent (P) | ✅ | ❌ FORBIDDEN-family | ❌ | ❌ | ❌ | ❌ oracle-safe | ✅ linked child only | — |
| admin (A) | ✅ | ❌ FORBIDDEN-family | ❌ | ❌ | ❌ | ❌ | — | ✅ |
| anonymous (0) | ❌ `UNAUTHORIZED` | ❌ `UNAUTHORIZED` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| student S2 (zero-balance) | ✅ | ✅ (but lane-empty at booking) | ✅ | ❌ `INSUFFICIENT_BALANCE` (business denial) | — | — | — | — |
| parent P2 (never linked) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ constant 403 (requireLinkedChild) | — |

### 4.3 Service signatures consumed (EXACT — verified by read, not assumed)

| Step surface | Signature | File:line |
|---|---|---|
| Register S/P | `RegistrationService.registerUser(input: RegistrationSubmitInput, locale: string, outerTx?: DBTransaction): Promise<RegistrationReturnType>` | `backend/services/auth/registration.service.ts:89-92` |
| Catalog | `PlanCatalogService.listActiveCatalog(locale?: string, tx?: DBTransaction): Promise<PlanReturnType[]>` | `backend/services/billing/plan-catalog.service.ts:249` |
| Purchase | `SubscriptionPurchaseService.purchase(studentUserId: number, input: PurchaseSubscriptionSubmitInput, idempotencyKey: string \| null, locale: string, outerTx?: DBTransaction): Promise<PurchaseSubscriptionReturnType>` | `backend/services/billing/subscription-purchase.service.ts:491` |
| Settle | `SubscriptionActivationService.processWebhookEvent(event: PaymentWebhookEvent, locale: string, outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<{ processed: boolean; replayed?: boolean }>` | `backend/services/billing/subscription-activation.service.ts:554-558` |
| Handshake | `StudentHandshakeService.getMyHandshakeCode(studentUserId: number, locale: string): Promise<string>` | `backend/services/students/student-handshake.service.ts:74` |
| Link | `ParentLinkRequestService.requestLink(code: string, parentActorId: number, locale: string, outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<OutgoingParentLinkRequestReturnType \| null>` · `respondToLinkRequest(requestId: number, accept: boolean, studentActorId: number, locale: string, outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<IncomingParentLinkRequestReturnType>` | `backend/services/parents/parent-link-request.service.ts:168, :250` |
| Browse | `TeacherMatchingService.browseAvailableTeachers(studentUserId: number, input: TeacherMatchingSubmitInput, locale: string, tx?: DBQueryExecutor): Promise<TeacherMatchingPageReturnType>` | `backend/services/teachers/teacher-matching.service.ts:346-351` |
| Book/attend/complete/cancel/confirm | `SessionLifecycleService.createSession(studentId: number, input: SessionSubmitInput, idempotencyKey: string, locale: string, outerTx?: DBTransaction)` · `startSession(teacherUserId: number, sessionId: number, locale: string, outerTx?: DBTransaction)` · `completeSession(teacherUserId: number, sessionId: number, locale: string, outerTx?: DBTransaction)` · `cancelSession(callerUserId: number, sessionId: number, reason: string \| null, locale: string, outerTx?: DBTransaction)` · `confirmSessionCompletion(callerUserId: number, sessionId: number, locale: string, outerTx?: DBTransaction)` | `backend/services/classes/session-lifecycle.service.ts:201, :282, :361, :490, :749` |
| Report | `submitSessionReport(teacherUserId: number, sessionId: number, input: SessionReportSubmitInput, locale: string, outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<ReportReturnType>` · `getSessionReport(callerUserId: number, sessionId: number, locale: string, tx?)` | `backend/services/classes/session-report.service.ts:357, :448` |
| Portal | `ParentMonitoringService.listLinkedChildren(parentActorId, locale, outerTx?)` · `getChildProgress(parentActorId, studentId, locale, outerTx?)` · `listChildSessions(parentActorId, studentId, page?, locale, outerTx?)` · `listChildReports(parentActorId, studentId, page?, locale, outerTx?)` · `listChildHomework(parentActorId, studentId, page?, locale, outerTx?)` · `getSessionTarget(parentActorId, sessionId, locale, outerTx?)` | `backend/services/parents/parent-monitoring.service.ts:178, :210, :255, :293, :334, :382` |
| Dispute | `SessionArbitrationService.openPostConfirmationDispute(callerUserId: number, sessionId: number, reason: string, locale: string, outerTx?: DBTransaction): Promise<SessionReturnType>` · `arbitrateDispute(adminId: number, sessionId: number, resolution: DisputeResolution, note: string \| null, partialAmount: string \| null, locale: string, outerTx?: DBTransaction)` | `backend/services/classes/session-arbitration.service.ts:193, :313` |

### 4.4 Input shapes (exact)

- `RegistrationSubmitInput = { fullName, email, phone, password, gender?, country: "EG", role: "student" | "parent", preferredRecitation?: RecitationReading | null }` (`backend/types/users/registration.types.ts:42-65`)
- `PaymentWebhookEvent = { reference, outcome: "confirmed" | "failed", amount: string, currency: string, providerTransactionId? }` (`backend/types/billing/payment-gateway.types.ts:60-66`)
- `TeacherMatchingSubmitInput = { recitation: RecitationReading; intent; page; pageSize; search; minRating; sort }` (`backend/types/teachers/teacher-matching.types.ts:39-47`)
- `SessionSubmitInput = { teacherId: number; intent: SessionStudentIntentType }` — `SessionIntent.Hifz | SessionIntent.Tajweed` (`backend/types/classes/session.types.ts:52-67`)
- `SessionReportSubmitInput = { teacherNotes: string; studentRatingByTeacher: number; homework?: HomeWorkAssignInput; previousGrades?: HomeWorkGradeFieldsInput }` (`backend/types/classes/report.types.ts:47-52`)
- `PurchaseSubscriptionSubmitInput = { planId: number }` (`backend/types/billing/subscription.types.ts:41-43`)

## 5. Cross-Actor Journey Design (the assertion set of the suite)

### 5.1 Shared-entity state machines walked by the chain (all EXISTING — asserted, never changed)

**Session** (`docs/workflows/03-session-lifecycle-escrow.md:15-31`):
```
scheduled → started → completed → (student confirms) → escrow released [session A]
scheduled → cancelled (participant cancel; same-lane refund)           [session B]
scheduled → started → completed → confirmed → disputed → resolved(Refund) [session C]
```
**Subscription**: pending → active (webhook settlement) — with replay no-op.
**Parent link**: none → link_requested → linked (student accepts; `students.parentId` set).

### 5.2 Side-effect matrix (per transition — what the journey asserts)

| Transition | Rows created/updated | Waves (recipient) | Idempotency / exactly-once guard |
|---|---|---|---|
| register S | `users`, `students` (trial=1, handshake mint) | none | handshake retry loop (service-internal) |
| purchase | `subscriptions`(pending), `student_payments`(pending), `subscription_purchase_idempotency` | none | duplicate key → `DUPLICATE_REQUEST` |
| settle (webhook confirmed) | payment→paid, subscription→active, `student_subscriptions` junction, `students.balanceHifz += 8` | `payment_confirmation` → {S} (ONE) | replay → `replayed: true`, zero writes |
| requestLink | `parent_link_requests` | link-request → {S} | — |
| respondToLinkRequest(accept) | `students.parentId = P` | acceptance → {P} | `linkParentIfUnlinked` (one-parent rule) |
| createSession (book) | `session`(scheduled, fee 25.00, feeHeld=true), lane −1 (trial first), `session_request_idempotency` | session-request → {T} (ONE) | duplicate key → `DUPLICATE_REQUEST`, zero writes |
| startSession | session→started, teacher `isOnline=false` (in-session lock) | none | — |
| completeSession | session→completed | completion-prompt → {S} (ONE) | — |
| confirmSessionCompletion | `feeHeld=false`, `wallet`(ensure+credit 25.00), `teacher_transaction`(earning), `progress++` | **ZERO** (notification-free) | `confirmStudentCompletionOnce` guarded UPDATE |
| submitSessionReport | `reports`, `home_work` | report-ready → {S en, P ar} (TWO, TWO publishes) | `SESSION_REPORT_ALREADY_EXISTS` (existing suite) |
| cancelSession | session→cancelled, `feeHeld=false`, lane +1 (same lane, once) | **ZERO** (participant cancel silent — verified: no notify calls in `session-lifecycle.service.ts:490-540`) | terminal-state replay → `SESSION_INVALID_TRANSITION` |
| openPostConfirmationDispute | session→disputed | dispute-opened → admins (contains {A}) | — |
| arbitrateDispute(Refund) | wallet −25.00, lane +1, `teacher_transaction`(arbitration_reversal), audit row | dispute-resolved → {S, T} | two-admin race guarded upstream (existing suite) |

### 5.3 Cross-actor visibility (who sees what — asserted both ways per rule 12)

| Moment | S sees | P sees | T sees | A sees | S2/P2 see |
|---|---|---|---|---|---|
| After settlement | balanceHifz=8, payment_confirmation inbox | nothing | nothing | nothing | nothing |
| After link accept | parent listed in world | child in `listLinkedChildren` | nothing | nothing | nothing |
| After booking A | session scheduled, trial 0 | nothing | request wave, session in own list | nothing | nothing |
| After complete A | prompt wave, session completed | nothing yet (report-gated — R5) | own completed session | nothing | nothing |
| After confirm A | session confirmed, lanes unchanged | nothing | wallet +25.00, ONE earning row | nothing | nothing |
| After report A | report row + en wave, inbox triple | ar wave + inbox triple, portal shows report/homework | report persisted | nothing | nothing |
| After dispute open (C) | session disputed | nothing | session disputed, wallet unchanged | dispute wave in inbox | nothing |
| After Refund (C) | hifz restored, resolution wave | nothing | wallet −25.00, resolution wave | resolved case | nothing |

### 5.4 Journey file structure (test shape)

```
test/workflows/students/student-full-journey.journey.test.ts
├─ imports: bun:test · @/test/workflows/helpers (TrackedFixtures, SpiedFanoutTransport,
│   InMemoryClaimCache, journeyPrefix, catchJourneyError) · @/backend/db/test/entity-setup ·
│   services (RegistrationService, PlanCatalogService, SubscriptionPurchaseService,
│   SubscriptionActivationService, StudentHandshakeService, ParentLinkRequestService,
│   TeacherMatchingService, SessionLifecycleService, submitSessionReport,
│   ParentMonitoringService, SessionArbitrationService) · graphQLSchema + Context factory ·
│   getServerTranslations · Drizzle tables + enums (VALUE imports)
├─ describe("student full journey — registration → purchase → session → confirmation → parent report")
│   ├─ beforeAll: ONE committing db.transaction — register S (preferredRecitation: hafs_an_asim,
│   │   country "EG") + P ("ar") via real service with outerTx; direct-insert T (metadata recipe),
│   │   A, S2 (zero lanes), P2; createTestPlan(balanceLane: Hifz, sessionCount: 8, price "200.00");
│   │   tracked.register(...) every row; snapshot baselines (inbox counts per actor = 0)
│   ├─ step tests 1..30 (§5.2 of specs.md ordered step list, sequential, actor-attributed names:
│   │   test("step N — <Actor>: <expectation>", ...) — precedent naming
│   │   session-lifecycle.journey.test.ts:385, parent-full-journey.journey.test.ts:684)
│   └─ afterAll: restore spies → withImmutabilityTriggersSuspended(["student_payments",
│       "teacher_transaction"]) delete-by-our-ids → withAuditDeleteTriggersSuspended audit sweep →
│       tracked.cleanup() → zero-residue re-probes
└─ NO runInRollback anywhere · NO console.* · NO any casts · NO relative imports
```

**Money end-state table (step 30 asserts in ONE test):**

| Row | Expected |
|---|---|
| `students` S lanes | `balanceTrial=0`, `balanceHifz=8`, `balanceTajweed=0`, `balanceReviews=0` |
| Sessions | A `completed`+confirmed stamps, B `cancelled`, C terminal-resolution status; every fee `"25.00"`; all `feeHeld=false` |
| `wallet` (T) | `balance="25.00"`; `total_earning` per shipped reversal semantics (assert per `post-confirmation-dispute.journey.test.ts:654-688` precedent) |
| `teacher_transaction` | exactly 2 `earning` + 1 `arbitration_reversal`, amounts verbatim `"25.00"` |
| Content | 1 report, 1 homework, progress ≥1 confirmed increment |
| Billing | subscription active, payment paid, junction row present |
| Inbox deltas | S: payment_confirmation + link_request + prompt + report + dispute waves as stepped; P: acceptance + report + resolution; T: request + resolution; A: ≥1 dispute wave; S2/P2: zero |

## 6. Concurrency & Race Condition Assessment

The journey is SEQUENTIAL by design (rule 11) — it proves composition, not races. Race coverage is NOT duplicated here (it lives in the per-domain suites): confirm-vs-sweep race (`session-dual-confirmation.journey.test.ts:627-702`), concurrent double-booking (`session-lifecycle.journey.test.ts:508-538`), two-admin arbitration race (`post-confirmation-dispute.journey.test.ts:1039-1113`), concurrent link contention (`parent-link-request.journey.test.ts`). The two concurrency-adjacent probes the journey DOES carry: booking idempotency replay (step 13 — the guarded-claim exactly-once path) and webhook replay (step 7 — the settlement idempotency path). Financial atomicity upstream is guarded SELECT-FOR-UPDATE/`$onUpdate` discipline the suite consumes as-is.

## 7. Security & Tenancy Mitigations (test-layer assertions)

| Threat class | Journey mitigation (asserted through the REAL path — never stubbed) |
|---|---|
| **BOLA / IDOR** | Non-participant confirm denial (step 17: parent on S's session → oracle-safe not-found, row byte-identical); foreign-parent portal denial (step 22: P2 → constant 403 via `requireLinkedChild`); every read scoped by the caller's real `userId` |
| **BOPLA / mass assignment** | Not reachable from the test surface — the suite passes strict typed inputs only (no spread payloads); the producers under test use explicit field-mapped DTOs (consumed, unchanged) |
| **BFLA / function-level** | GraphQL scope-gate probes (step 5): parent/teacher on student-only `purchaseSubscription` → `FORBIDDEN`; anonymous → `UNAUTHORIZED`; admin-only arbitration exercised only by A |
| **Read-only enforcement** | Parent write-attempt denial (step 17) + portal constant-403 (step 22) prove the parent surface stays read-only at the service layer |
| **Business-logic abuse** | Zero-balance booking denial with zero writes + unburned idempotency key (step 23) proves fail-closed money paths |
| **Cross-tenant fan-out** | Every wave assertion is BOTH-ways: intended recipient set AND no accidental fan-out to the other four cast actors (rule 12) |
| **External effects** | Rule 5 interception: mock gateway (no network), `SpiedFanoutTransport` + `InMemoryClaimCache` injection seams, `publishReceipts` namespace spy for non-injectable seams (D6) |
| **Input sanitization** | Consumed, not rebuilt: browse ILIKE token patterns (`teacher.repository.matching.helpers.ts:131-137`) are exercised via valid enum tokens; wildcard abuse stays covered by the matching suite |

## 8. Error Handling (denial oracle — translated substrings only)

All denials asserted via `catchJourneyError` + substring match against `getServerTranslations("en").errorsTranslations` (rule 6). No hardcoded English. Expected codes on the chain:

| Step | Service denial | Error family |
|---|---|---|
| 5 | GraphQL scope gates | `UNAUTHORIZED` (anonymous) / `FORBIDDEN` (parent, teacher) — exact codes per precedent (`subscription-purchase.journey.test.ts:731-771`) |
| 13 | booking key replay | `DUPLICATE_REQUEST` (ConflictError) |
| 17 | non-participant confirm | session-not-found oracle (NotFoundError family) |
| 22 | unlinked parent portal read | constant 403 shape (`docs/parents/monitoring-portal.md` denial oracle) |
| 23 | zero-balance booking | `INSUFFICIENT_BALANCE` (ValidationError) |
| 26 | cancel a terminal session | `SESSION_INVALID_TRANSITION` |

## 9. Testing Strategy

- **The deliverable IS the test.** Layer rules per `docs/testing/workflow-journey-tests.md` + `test/workflows/AGENTS.md`: committed fixtures, tracked teardown, honest roles, spied transports, sequential actor-attributed steps, both-way visibility asserts, ≥1 denial probe (we ship 6).
- **4-Tier mapping for a journey deliverable**: Tier 1 (branches) = the chain itself (every transition + both-way visibility); Tier 2 (boundaries) = zero-balance lane boundary, trial-lane exhaustion, key replay; Tier 3 (chason) = idempotency replay probes (booking + settlement); Tier 4 (security/abuse) = the 6 denial probes + scope gates. Deeper chaos (races, fuzz) is explicitly NOT duplicated (§6).
- **Runner (MANDATORY form):** single suite — `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts`; whole layer — `bun run test/scripts/run-test.ts test/workflows`. NEVER raw `bun test` for iteration decisions (log capture + env pinning live in the runner). `--last`/`--last --focus` for AI-optimized re-reads.
- **Idempotent-teardown proof:** run the suite twice consecutively; both runs green (rule: second green run proves zero residual state).
- **No-neighbor-breakage gate:** whole-layer sweep green after landing.

## 10. Outcome & Knowledge Transfer Protocol

- **BEFORE any task:** read ALL files in `ai/plans/milestone_4/workflow_tests_student_journey/outcome/` (this plan ships `0-planning-outcome.md` with the verified-anchor research + `plan-review-R1.md` with the Phase 1.5 verdict).
- **AFTER every task:** write `outcome/<task-id>-outcome.md` (research, exact citation anchors discovered during implementation, cross-file dependencies, carry-overs) and flip the `tasks.md` checkbox.
- **Per-file gate:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0 (auto-discovers `test/workflows/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/tests.instructions.md` for test files).
- **Knowledge propagation (final task):** consolidate into `docs/testing/workflow-journey-tests.md` (add the suite to the canonical consolidated-examples list `:150-157`) — AGENTS.md files are hand-curated and NEVER updated from plan outcomes.

## 11. Deferred Ledger Pointers

All deferrals live in `ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md` (pre-seeded, resolved-pointer convention): D1 CI wiring for the workflows layer · D2 persisted recitation preference (production gap) · D3 teacher accept/decline intake flow · D4 held-escrow dispute leg (covered by `session-state-machine` suite) · D5 stale `linkStudentToParentFixture` docblock (IN scope — task 2.1) · D6 TICKETS.md Gherkin staleness (reconciled by rulings R1–R7; historical doc, not edited by this plan).
