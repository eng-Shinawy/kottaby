# Design — Workflow Tests: Parent Journey & Subscription Lifecycle

<!-- Plan Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/ -->
<!-- Outcome Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/ -->
<!-- Input: specs.md (REQ-0 … REQ-6) · Tickets: docs/planning/TICKETS.md:2735-2797 (Milestone 4, Dev 1) -->
<!-- Related: specs.md · tasks.md · deferred-items.md -->

## Document Information

- **Feature Name:** Workflow Tests — Parent Journey & Subscription Lifecycle
- **Target Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/`
- **Outcome Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/`
- **Version:** 1.0
- **Date:** 2026-09-21
- **Author:** Spec Plan Generator (spec-driven-development skill)
- **Reviewers:** plan-review skill (Phase 1.5 gate), Dev 1
- **Related Documents:** `test/workflows/AGENTS.md`, `docs/testing/workflow-journey-tests.md`,
  `docs/parents/monitoring-portal.md`, `docs/billing/paymob-gateway.md`

## Overview

Both tickets ask for chained workflow tests under `test/workflows/`. Ground-truthing (see
"Existing Coverage" below) shows every individual step of both chains already passes somewhere in
the layer — but no single file walks either ticket chain end-to-end, the parent tier has no
in-layer mutation-denial probes, and no workflow file exercises the subscription **upgrade**
direction. The design therefore creates exactly **two consolidated, chained journey files** that
compose the existing, verified service surface into the ticket chains, closing the three verified
gaps without touching production code or restructuring the existing per-domain suites (5 parent,
7 billing) that remain authoritative for their own matrices.

The three-tier story stays consistent: repository behavior is unit-tested under
`backend/db/test/`, service behavior under `backend/services/**`, GraphQL at
`backend/graphql/test/` — and this plan's two files cover the cross-actor journey tier that ties
them together over shared, committed state.

### Design Goals

1. One chained, actor-attributed journey file per ticket, matching the ticket Gherkin step-for-step.
2. Zero production-code changes; journeys compose the existing verified service surface only.
3. Close the verified gaps: parent write-denials in-layer (REQ-2) and upgrade proration at the
   journey tier (REQ-5).
4. Full compliance with `test/workflows/AGENTS.md` hard rules (committed fixtures, tracked
   teardown, honest auth, spied transports, no `rejects.toThrow`).
5. Layer-wide green run and knowledge propagation into `docs/testing/workflow-journey-tests.md`.

### Key Design Decisions

| ID | Decision | Rationale |
|---|---|---|
| D-1 | **Layer rule over ticket Gherkin**: committed fixtures + tracked teardown, NO `runInRollback`. | `test/workflows/AGENTS.md` hard rule 1 (services spawn top-level transactions; an outer rollback deadlocks or misses committed rows). Both tickets' Gherkin says "within runInRollback" — the phrase predates the journey layer; every shipped journey follows the layer rule (e.g. `parent-link-request.journey.test.ts:1145`). Same for the Gherkin's "and the GraphQL API": the journey layer is service-level by definition (`docs/testing/workflow-journey-tests.md`); GraphQL-tier proof stays with the per-domain wire suites (deferred-items D1). Both deviations documented, reviewer-visible. |
| D-2 | **Two NEW consolidated files** rather than extending the existing per-domain journey suites (5 parent + 7 billing). | The per-domain files stay authoritative for their combinatorial matrices; the tickets demand the *chain*. Filenames follow the existing convention: `parent-full-journey.journey.test.ts`, `subscription-full-lifecycle.journey.test.ts`. |
| D-3 | **Real `RegistrationService.registerUser`** for the parent journey's two lead actors (pattern `createJourneyCast`, `test/workflows/helpers/journey-fixtures.ts:251`), remaining cast via `actor-context` provisioning in one committing tx. | Ticket's chain starts at "Register"; only real registration exercises handshake-code generation. Real registration is proven in `handshake-discovery.test.ts:65` (`createJourneyCast`); tx-scoped cast provisioning is proven by the actor-context consumers (e.g. `parent-session-completion-deep-link.journey.test.ts`); combining both precedents in one file is this plan's composition. |
| D-4 | **Backdated time control**, never fake clocks: expiry legs backdate `expires_at` / `end_date`, then invoke the real expiry path (`respondToLinkRequest` re-check / `expireDue` sweep). | Matches the shipped oracles (`parent-link-request.journey.test.ts:1002`, `subscription-expiry.journey.test.ts:556-595`); expiry is cron-sweep based, no lazy flip exists. |
| D-5 | **Second tenant + foreign parent as standing controls** with byte-identical snapshot assertions at every transition. | `test/workflows/AGENTS.md` rule 12 (cross-actor visibility + denial assertions). |
| D-6 | **Proration assertions in session units, not money.** | Verified semantics: upgrade carry formula / downgrade forfeit in `subscription-proration.helpers.ts:139-169`; no wallet refund leg exists in plan changes. |
| D-7 | **Reuse the shared helpers barrel** (`@/test/workflows/helpers`): `TrackedFixtures`/`createSessionFixtureRegistry` for teardown, `SpiedFanoutTransport` for notifications, `catchJourneyError` for rejections. No new helper file. | Rule: the helpers directory is the ONLY shared-scaffolding home; additions would need the barrel and are not needed. |

### UX/Navigation Specification (Explicit No-UI Ruling)

| Required element | Ruling |
|---|---|
| New Routes & URLs | **None.** Test-layer plan; no `app/` surface is added or changed. |
| Sidebar Navigation Integration | **None.** |
| Role-Based Access Matrix | Test-internal only: journeys use real role rows (`users.role` + `parents`/`students`/`teachers`/`admin` child rows) per `test/workflows/AGENTS.md` rule 4. No permission strings are created or modified. |
| Per-Audience Rendering | **None.** |
| Permission Mapping | Consumed (existing service-level `requireActor`/`requireLinkedChild`/`assertActorAdmin`); not authored. |

### Translation System Requirements (test-layer ruling)

- Rejection assertions use translated substrings from `getServerTranslations("en").errorsTranslations`
  (`shared/locale/server-graphql.ts:3`) — the runner's enum/translation anti-patterns (hardcoded
  English, static key-enum patterns, `import type` on enums) are forbidden in specs.md REQ-0.5.
- Services receive `locale: string` (plain string, e.g. `"en"`); there is no locale wrapper type.

## Architecture

### System Context

The journey layer sits between unit tiers and the GraphQL wire tier:

```
backend/db/test/repo (runInRollback unit tests)
backend/services/**  (service unit tests, mocked adapters)
backend/graphql/test (wire suites: resolvers, SDL, permission matrices)
test/workflows/**    (THIS PLAN — cross-actor chained journeys, real services + real DB)
test/ui/e2e          (browser E2E; out of scope here)
```

### High-Level Architecture

Each new file follows the proven journey skeleton (all pieces already exist):

1. `beforeAll`: single committing `db.transaction(...)` provisioning the cast via helpers
   (`actor-context.ts` / `journey-fixtures.ts` / `session-cast.ts`), with every row id tracked in
   `TrackedFixtures`/`SessionFixtureRegistry`.
2. Ordered `test("step N …")` blocks; each step receives the attributed actor's real
   `userId`; later steps observe the committed state left by earlier ones.
3. Notification boundary: `SpiedFanoutTransport` injected at the engine `options.transport` seam
   where the service accepts one (pattern: `parent-session-completion-deep-link.journey.test.ts:222`),
   plus `InMemoryClaimCache` at the cache seam (`in-memory-claim-cache.ts:24`). Two service calls
   in the chains expose NO injected transport (`SubscriptionPurchaseService.purchase`,
   `subscription-purchase.service.ts:486-492`); those legs use the rule-5 fallback — namespace
   import + `spyOn` (precedent: `subscription-purchase.journey.test.ts:150`, whose own comment
   records the missing seam) — restored in `afterAll`.
4. `afterAll`: registry cleanup in reverse registration order, re-probing every tracked id for
   absence (fail on residue).

### Technology Stack

Bun test runner (`bun:test` imports only), Drizzle ORM (real PostgreSQL test database), real
services under test, zero network. Runner: `bun run test/scripts/run-test.ts`.

## Existing Coverage Ground Truth (verified 2026-09-21)

### Parent domain — `test/workflows/parents/`

| File | Steps | Covers | Gap vs ticket |
|---|---|---|---|
| `handshake-discovery.test.ts` (347 L, 9 tests) | register (real service), code self-read, search, already-linked/governance collapse | register/search steps in isolation |
| `parent-link-request.journey.test.ts` (1172 L, 19 steps) | request create (+7d, ONE inbox/publish), confirm, already-linked conflict, expired confirm | chained continuation into monitoring absent |
| `student-confirmation-of-link.journey.test.ts` (1314 L, 13 steps) | incoming list, confirm/reject, sibling expiry, concurrency winner, expiry boundary, parent denied `respondToLinkRequest` | — |
| `parent-monitoring.journey.test.ts` (1474 L, 13 steps) | portal reads for linked child, sever→403s, multi-child isolation, completion notify | starts post-link; no register→link chain |
| `parent-session-completion-deep-link.journey.test.ts` (809 L, 6 steps) | completion fan-out {student, linked parent}, inbox deep-link triple, `getSessionTarget`/`listChildReports` landing, unlinked fail-closed | — |
| **(new) `parent-full-journey.journey.test.ts`** | **the ticket chain itself + REQ-2/REQ-3 legs** | **this plan** |

Verified parent gaps this plan closes: (a) no single register→…→view-report chain; (b) no in-layer
parent→child-data **mutation** denial probe (GraphQL tier has it:
`backend/graphql/test/session-lifecycle-mutations.test.ts:337,367,379`);
(c) expiry/one-parent legs re-pinned inside the chain (they exist per-domain).

### Billing domain — `test/workflows/billing/`

| File | Steps | Covers | Gap vs ticket |
|---|---|---|---|
| `subscription-purchase.journey.test.ts` (991 L, 12 steps) | purchase → webhook activation → window + lane credit, idempotent replay, lane isolation | chain stops after activation |
| `subscription-expiry.journey.test.ts` (735 L, 7 steps) | backdate lag, sweep flip + lane zeroing, trial survival, tenant isolation, replay | standalone |
| `subscription-admin-lifecycle.journey.test.ts` (901 L, 11 steps) | extend, cancel (lane preserved), renew (fresh credit), downgrade (forfeit + audit), student-denied BFLA | **no upgrade leg** |
| `paymob-purchase-journey.test.ts` (996 L, 8 steps) | real-provider branch, signed callback → activation | provider-specific, off the ticket chain |
| **(new) `subscription-full-lifecycle.journey.test.ts`** | **purchase → activate → use → expire → renew → upgrade → downgrade → cancel in one chain** | **this plan** |

(The directory also hosts `admin-financial-auditing.journey.test.ts`,
`financial-safety-verification.journey.test.ts`, and `paymob-live-tunnel.journey.test.ts` —
unrelated to the ticket chain, untouched.)

Verified billing gap this plan closes: `grep -rn 'upgrade' test/workflows` returns zero hits —
upgrade proration is proven only at service-unit level
(`backend/services/billing/subscription-admin.service.test.ts:1661-1899`).

## Data Models (EXISTING — verified, unmodified)

No schema changes. The journeys read/write through services into these existing tables:

| Table | Key columns used | Citation |
|---|---|---|
| `users` | `id`, `role`, governance flags | entity-setup `createTestUser`, `backend/db/test/entity-setup.ts:74-99` |
| `students` | `id` (shared PK), `handshakeCode`, `parentId`, `balance_hifz`, `balance_reviews`, `balance_tajweed`, `balance_trial` (CHECK ≥ 0) | `backend/db/schema/students/students.ts:24-27,42-45` |
| `parents`, `admin`, `teachers` | role-child existence rows (authorization substrate) | entity-setup `createTestParent` :131, `createTestAdmin` :169 |
| `parent_link_requests` | one live pending per (parent, student) partial unique index; `expires_at` = created + 7d | `backend/db/schema/parents/parent-link-requests.ts:17-25,56-59`; `shared/constants/parent-link-request.constants.ts:17,20` |
| `plans` | `sessionCount`, `price`, `intervalDays`, `balance_lane` | `backend/db/schema/billing/plans.ts:25-29` |
| `subscriptions` | `status` (default pending), `start_date`, `end_date`, partial index on active+end_date | `backend/db/schema/billing/subscriptions.ts:37-53` |
| `student_subscriptions` | junction, `enrolled_at` only | `backend/db/schema/billing/student-subscriptions.ts:20` |
| `notifications` | inbox rows carrying `relatedEntityType`/`relatedEntityId` deep-link triple | asserted in `parent-session-completion-deep-link.journey.test.ts:534-556` |
| audit (`Override` rows) | plan-change audit incl. forfeited/excess detail | `subscription-admin-lifecycle.journey.test.ts:821-829` |
| `wallet` / teacher transactions | NOT part of either chain (monetary escrow; out of scope) | `backend/db/schema/billing/wallet.ts` |

### Data Flow

Per-actor arrows are the ordered step lists in `specs.md` §Cross-Actor Workflow Scenarios
(Journey 1 steps 1–17, Journey 2 steps 1–11); shared-state transitions are in the state machines
below.

## API Contracts (Existing Surface — zero new GraphQL fields)

### SDL (read-only consumption)

| Operation | Kind | Required role/guard | Proven by |
|---|---|---|---|
| `myHandshakeCode` | Query | student (self) | handshake suites |
| `studentByHandshakeCode(code)` | Query | parent | `handshake-discovery.test.ts:173-295` |
| `requestParentLink` / `respondToParentLinkRequest` / `cancelParentLinkRequest` | Mutation | parent / student / parent (reconciled trio, SDL-locked) | `backend/graphql/test/schema-surface.test.ts:940,663`; `parent-link.wire.test.ts` |
| `myLinkedChildren`, `parentChildProgress`, `parentChildSessions`, `parentChildReports`, `parentChildHomework`, `parentSessionTarget`, `myChildrenUpcomingSessions` (7 root Query fields) | Query | parent + `requireLinkedChild` per child | `backend/graphql/query/parents/parent-monitoring.query.ts` (:255 for the upcoming-sessions field); `parent-monitoring.wire.test.ts` |
| subscription purchase / admin subscription mutations | Mutation | student / admin (`assertActorAdmin`) | billing wire + service suites |
| `GET /api/cron/expire-subscriptions` | REST (cron) | `CRON_SECRET`, fail-closed factory | `app/api/cron/expire-subscriptions/route.ts:5-6,28` |

### Permission Matrix (journey-relevant, existing)

| Operation | PARENT | STUDENT | TEACHER | ADMIN |
|---|---|---|---|---|
| request link | ✅ own requests | ❌ | ❌ | ❌ |
| respond to link request | ❌ (denial leg J1·16) | ✅ own incoming | ❌ | ❌ |
| portal reads (per-child) | ✅ linked child only | ❌ | ❌ | ❌ |
| `createSession` / booking | ❌ (denial leg J1·16) | ✅ with balance | assists | ❌ |
| `completeSession` / `submitSessionReport` | ❌ (denial leg J1·16) | ❌ | ✅ own sessions | ❌ |
| `confirmSessionCompletion` | ❌ (denial leg J1·16) | ✅ own session | ✅ own session (dual confirm) | ❌ |
| renew / cancel / change plan | ❌ | ❌ (denial leg J2·10) | ❌ | ✅ (`assertActorAdmin`) |
| expiry sweep | ❌ | ❌ | ❌ | system/cron only |

The new files assert this matrix at the SERVICE tier (argument-actor re-checks); the GraphQL tier
already asserts it at the resolver tier (wire suites cited above) — no SDL changes are needed and
none are made.

## Service & Repository Signatures (verified against source)

```ts
// backend/services/students/student-handshake.service.ts
StudentHandshakeService.getMyHandshakeCode(studentUserId: number, locale: string): Promise<string>            // :74
StudentHandshakeService.findStudentByHandshakeCode(code, locale, tx?): Promise<HandshakeCodeLookupReturnType | null> // :118

// backend/services/parents/parent-link-request.service.ts
ParentLinkRequestService.requestLink(code: string, parentActorId: number, locale: string,
  outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<OutgoingParentLinkRequestReturnType | null> // :168
ParentLinkRequestService.respondToLinkRequest(requestId: number, accept: boolean, studentActorId: number,
  locale: string, outerTx?: DBTransaction, options?: NotificationEngineCallOptions): Promise<IncomingParentLinkRequestReturnType> // :250
ParentLinkRequestService.listMyIncoming(studentActorId: number, locale: string, tx?): Promise<IncomingParentLinkRequestReturnType[]> // :576
ParentLinkRequestService.sweepExpiredRequests(outerTx?: DBTransaction): Promise<number>            // :424
ParentLinkRequestService.sendExpiryReminders(input?: {...}): Promise<number>                       // :479

// backend/services/parents/parent-monitoring.service.ts (all: requireActor(Parent) + rate limit;
// per-child reads additionally requireLinkedChild inside repeatable-read tx)
ParentMonitoringService.listLinkedChildren(parentActorId, locale, outerTx?): Promise<ParentLinkedChildReturnType[]> // :178
ParentMonitoringService.getChildProgress(parentActorId, studentId, locale, outerTx?): Promise<ParentChildProgressReturnType> // :210
ParentMonitoringService.listChildSessions / listChildReports / listChildHomework                                                                                                  // :255 / :293 / :334
ParentMonitoringService.getSessionTarget(parentActorId, sessionId, locale, outerTx?): Promise<ParentSessionTargetReturnType> // :382

// backend/services/classes/session-lifecycle.service.ts / session-report.service.ts
SessionLifecycleService.createSession(...)         // :196   SessionLifecycleService.completeSession(...)         // :332
SessionLifecycleService.startSession(...)          // :249   SessionLifecycleService.confirmSessionCompletion(...) // :721
SessionReportService.submitSessionReport(...)      // session-report.service.ts:357

// backend/services/billing/*
SubscriptionPurchaseService.purchase(...)                       // subscription-purchase.service.ts
SubscriptionActivationService.processWebhookEvent(...)          // subscription-activation.service.ts
SubscriptionExpiryService.expireDue(outerTx?): Promise<SubscriptionExpirySweepReturnType> // subscription-expiry.service.ts:166
SubscriptionAdminService.extendSubscription(input, actorId, locale, tx?)    // subscription-admin.service.ts:159
SubscriptionAdminService.renewSubscription(input, actorId, locale, tx?)     // :299 (source must be expired)
SubscriptionAdminService.cancelSubscription(input, actorId, locale, tx?)    // :400 (mutates status only)
SubscriptionAdminService.changeSubscriptionPlan(input, actorId, locale, tx?): Promise<ChangeSubscriptionPlanResult> // :488
  → changeSubscriptionPlanFlow (subscription-plan-change.helpers.ts:448)
computeProration({ remainingSessions, oldPlan, newPlan }, tErrors): ProrationComputation // subscription-proration.helpers.ts:139
prorationDirectionOf(oldPlan, newPlan)                          // :114 (replay re-derivation)

// backend/db/repo/students/student.repository.ts
linkParentIfUnlinked(studentId, parentId, tx)   // :373 — guarded single writer (WHERE parent_id IS NULL)
creditLaneBalance(studentId, lane, amount, tx?) // :440   decrementLaneIfAvailable(studentId, lane, tx?) // :387
setLaneBalanceValue(studentId, lane, value, tx) // :473 (plan-change settle)
zeroLaneIfNoCoveringSubscription(...)           // student.repository.zero-lane.helpers.ts:95 (sweep)
```

## Concurrency & Race Condition Assessment

| ID | Scenario | Existing guard | Journey assertion |
|---|---|---|---|
| C1 | Two parents confirm/link the same student | Guarded writer `WHERE parent_id IS NULL`; zero-row collapse throws + rolls back (`student.repository.ts:373-387`) | Chain asserts exactly one winner pattern is relied upon (full matrix remains in `student-confirmation-of-link.journey.test.ts:914,995`) |
| C2 | Duplicate link request per (parent, student) | Partial unique index (`parent-link-requests.ts:56-59`) | Step 6 asserts ONE pending row |
| C3 | Webhook replay double-credit | Activation idempotency (proven `subscription-purchase.journey.test.ts:604-625`) | J2 step 3 replay leg |
| C4 | Sweep re-run | Guarded batch flip `active → expired`; honest zero counts (`subscription-expiry.journey.test.ts:712-715`) | J2 step 5 replay leg |
| C5 | Renew replay double-credit | Admin-service idempotency (`subscription-admin-lifecycle.journey.test.ts:723-731`) | J2 step 6 replay leg |
| C6 | Upgrade replay | `prorationDirectionOf` re-derivation (`subscription-plan-change.replay.helpers.ts:125,166`) | J2 step 7 replay leg |
| C7 | Sweep zeroes a lane still covered by another active sub | Guardian `zeroLaneIfNoCoveringSubscription` (wrapper `backend/db/repo/students/student.repository.ts:483-489`; impl `student.repository.zero-lane.helpers.ts:95`) | S2 control tenant byte-identical legs |

TOCTOU statement: the journeys themselves are sequential by construction (declaration order);
concurrency correctness is delegated to the services' existing guards, which the replay/leg
assertions re-verify against committed state. No new shared mutable state is introduced.

## Cross-Actor Journey Design

### Journey 1 — Shared entity: `parent_link_requests` (+ `students.parent_id`)

State machine:

```
(none) --parent: requestLink--> PENDING (expires_at = now + 7d)
PENDING --student: respond(accept)--> CONFIRMED  (writes students.parent_id; siblings -> EXPIRED)
PENDING --student: respond(reject)--> REJECTED
PENDING --sweep / confirm after expiry--> EXPIRED (materialized; translated denial on confirm)
```

Side-effect matrix (per transition):

| Transition | Rows written | Notifications | Idempotency |
|---|---|---|---|
| requestLink | +1 request (`PENDING`, +7d) | 1 inbox row → student; 1 spied publish | partial unique index per (parent, student) |
| respond accept | request → CONFIRMED; `students.parent_id` set; siblings → EXPIRED | 1 acceptance → parent | guarded single writer (C1) |
| respond on expired | row materialized EXPIRED; no link | none | guarded by expiry re-check |
| requestLink on linked student | conflict, +0 rows | none | already-linked collapse (Journey B oracle) |

Session-completion fan-out (post-chain): teacher completes + submits report → publish to
{student, linked parent} + persisted inbox rows with the deep-link triple; unlinked parents
fail closed (oracle `parent-session-completion-deep-link.journey.test.ts:635-689`).

### Journey 2 — Shared entity: `subscriptions` (+ lane columns)

State machine:

```
PENDING --webhook: processWebhookEvent--> ACTIVE (start..start+intervalDays; lane += sessionCount)
ACTIVE --time passes (backdated)--> ACTIVE (lag — row unchanged until sweep)
ACTIVE --expireDue--> EXPIRED (lane zeroed iff positive AND uncovered; trial lane immune)
EXPIRED --admin: renewSubscription--> (new row) ACTIVE (fresh window; lane += renewal credit)
ACTIVE --admin: changeSubscriptionPlan--> (old CANCELLED + new ACTIVE) lane =
            new.sessionCount + carry (upgrade) | new.sessionCount (downgrade, excess forfeited)
ACTIVE --admin: cancelSubscription--> CANCELLED (lanes untouched)
```

Side-effect matrix (per transition):

| Transition | Rows written | Lane effect | Audit | Replay behavior |
|---|---|---|---|---|
| webhook activate | payment → paid; sub ACTIVE w/ window | +sessionCount on plan lane | — | no double credit (C3) |
| booking | session rows | −1 via debit ladder | — | n/a |
| expireDue | sub → EXPIRED | zero iff uncovered; trial kept | — | zero counts (C4) |
| renew | new ACTIVE sub | +renewal credit | audit row | returns existing; no credit (C5) |
| change→upgrade | old CANCELLED, new ACTIVE | new.sessionCount + carry | Override row w/ detail | same direction re-derived (C6) |
| change→downgrade | old CANCELLED, new ACTIVE | new.sessionCount (forfeit excess) | Override row w/ `forfeitedExcess` | same (C6) |
| cancel | sub → CANCELLED | none (byte-identical) | audit row | n/a |
| student attempts admin op | none (denied) | none | none | n/a (BFLA) |

### Cross-Actor Visibility

| After step… | Parent P sees | Foreign parent P2 sees | Student S1/S sees | Other tenant (S2 / S2-billing) sees |
|---|---|---|---|---|
| J1·8 link confirmed | S1 in `listLinkedChildren` | nothing new | acceptance sent to P | — |
| J1·12-13 completion | inbox row w/ session deep link | zero fan-out rows | own notification | — |
| J2·3 activation | — | — | credited lane + window | byte-identical |
| J2·5 expiry sweep | — | — | zeroed lane; trial intact | byte-identical |
| J2·7-8 plan changes | — | — | lane per matrix above | byte-identical |
| J2·9 cancel | — | — | status cancelled; balance preserved | byte-identical |

## Security & Tenancy Mitigations

| Threat | Existing mitigation | Journey assertion |
|---|---|---|
| BOLA / cross-parent reads | `requireLinkedChild` in repeatable-read tx, constant `ForbiddenError` shape (`parent-monitoring.service.ts:379-406`) | J1·15 foreign-parent probes across all per-child reads |
| Parent privilege creep (writes) | Service-side role re-checks; portal SDL has zero mutations (grep-locked) | J1·16 four denied mutations incl. byte-identical oracle |
| BFLA on admin subscription ops | `assertActorAdmin` inside each mutation | J2·10 student attempts all three admin ops |
| Link-grooming via code guessing | pre-DB shape rejection, null on unknown, `linkable:false` collapse w/o identity leak | J1·4 negative legs |
| Secret/network egress | journeys inject `SpiedFanoutTransport` + `InMemoryClaimCache`; nothing leaves the process | suite-level spies asserted every step |
| Test-data tenancy bleed | unique `jrn_*` prefixes; full tracked teardown w/ re-probe | afterAll zero-residue (fails suite) |

## Error Handling

| Trigger | Expected error (translated, via `getServerTranslations("en").errorsTranslations`) | Produced by |
|---|---|---|
| confirm expired link request | parent-link-request expired error | `respondToLinkRequest` re-check |
| request link to linked student | already-linked/conflict error | `requestLink` |
| parent mutates child data | forbidden | service role re-checks |
| student calls admin subscription op | forbidden | `assertActorAdmin` |
| booking on zeroed/expired lane | subscription-expired error | debit ladder + `hasUncoveredExpiredLane` |
| handshake code malformed / unknown | shape rejection (pre-DB) / null | `findStudentByHandshakeCode` |

All rejections are caught via `catchJourneyError` and matched on translated substrings; both
suites use `spyOn(logger, "logDomainError")` where the domain logs expected denials (pattern
`parent-session-completion-deep-link.journey.test.ts:246`).

## Testing Strategy

### Tier mapping

| Tier | This plan |
|---|---|
| T1 (branches/statements) | each journey step is an assertion cluster; happy + denial + replay branches per transition |
| T2 (boundary) | expiry boundary via backdating to just-past `expires_at`/`end_date`; zero-count replay |
| T3 (monkey/chaos) | suite re-run (idempotent teardown proof); replay legs (C3–C6) |
| T4 (security/abuse) | BOLA probes (J1·15), write-denial probes (J1·16), BFLA probes (J2·10), isolation snapshots |

### Runner discipline (binding)

```bash
# Single file:
bun run test/scripts/run-test.ts test/workflows/parents/parent-full-journey.journey.test.ts
bun run test/scripts/run-test.ts test/workflows/billing/subscription-full-lifecycle.journey.test.ts
# Layer-wide (final verification):
bun run test/scripts/run-test.ts test/workflows
```

### Phase-0 baseline commands (Task 0 records into `outcome/baseline.md`)

```bash
bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt
bun run biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt
bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
bun run test/scripts/run-test.ts test/workflows   # pre-change layer baseline
```

### Drizzle notes

No schema changes — neither `db push` nor `migrate` is run by this plan.

## Outcome & Knowledge Transfer Protocol

- BEFORE any task: read every file in this plan's `outcome/` directory.
- AFTER each task: write `outcome/<task-id>-outcome.md` (findings, evidence, carry-over).
- PROGRESS: flip the task checkbox in `tasks.md`; keep `deferred-items.md` accurate.
- Final task propagates durable learnings into `docs/testing/workflow-journey-tests.md`
  (never into AGENTS.md / instructions files — those are hand-curated).

## Deployment & Migration Impact

None. Test-only change; no migrations, no env keys, no runtime configuration. CI impact: two
additional suites in the existing `test/workflows` runs.

## Design Review Checklist

- [x] All requirements addressed (REQ-1/2/3 → Journey 1; REQ-4/5 → Journey 2; REQ-0/0.5/6 cross-cutting)
- [x] Component responsibilities defined (two new files; helpers reused, not extended)
- [x] Interfaces specified (exact verified signatures above)
- [x] Error handling covers expected failures (translated-error table)
- [x] Security considerations addressed (BOLA/BFLA/privilege matrix + probes)
- [x] UX/Navigation explicit no-UI ruling present
- [x] Cross-actor journey design complete (state machines + side-effect matrices + visibility)

---

*Ground-truthing note: every `path:line` citation above was verified against the working tree on
2026-09-21 (coverage audit + signature reads). Where a citation names an oracle test, that oracle
already passes today and remains the authoritative per-domain proof.*
