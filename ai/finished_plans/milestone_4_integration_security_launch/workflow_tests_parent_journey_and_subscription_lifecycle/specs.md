# Requirements — Workflow Tests: Parent Journey & Subscription Lifecycle

<!-- Plan Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/ -->
<!-- Outcome Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/ -->
<!-- Related: plan.md · tasks.md · deferred-items.md -->

## Document Information

- **Feature Name:** Workflow Tests — Parent Journey & Subscription Lifecycle (single combined plan)
- **Tickets:** `docs/planning/TICKETS.md:2735-2765` (Workflow Tests: Parent Journey — Milestone 4, Dev 1, 5 pts)
  and `docs/planning/TICKETS.md:2766-2797` (Workflow Tests: Subscription Lifecycle — Milestone 4, Dev 1, 3 pts)
- **Milestone:** 4 — Integration, Security & Launch
- **Blocked By (both shipped):** Parent Read-Only Monitoring Portal
  (`ai/finished_plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/`),
  Parent Session Completion Notification Display (milestone_3), Admin Subscription Management
  (`ai/finished_plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/`)
- **Target Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/`
- **Outcome Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/`
- **Version:** 1.0
- **Date:** 2026-09-21
- **Author:** Spec Plan Generator (spec-driven-development skill)
- **Stakeholders:** Dev 1 (owner stream), QA, Milestone-4 launch review

## Introduction

### Feature Summary

Author the two remaining Milestone-4 journey suites under `test/workflows/`: one consolidated,
chained **parent journey** (register → handshake code → search child → link request → student
confirms → monitor child → session-completion notification → view report) and one consolidated,
chained **subscription lifecycle journey** (purchase → activation → balance credit → use sessions →
expiry → renewal → upgrade with prorated carry → downgrade with forfeit → cancel with preserved
balance). Both run through the real service layer against the real test database with committed
fixtures, tracked teardown, honest authorization, and spied notification boundaries — the harness
codified in `test/workflows/AGENTS.md`.

### Business Value

These two tickets are the last workflow-verification gates on the launch-critical money path
(subscription balances) and the trust path (parent oversight of children). A single chained journey
per ticket proves the actors interoperate over shared state end-to-end — something the existing
per-domain journey files (which cover the steps in isolation) do not demonstrate in one chain.

### Scope

**In scope:**
- One new chained journey file per ticket, under the journey layer's domain directories:
  `test/workflows/parents/parent-full-journey.journey.test.ts` and
  `test/workflows/billing/subscription-full-lifecycle.journey.test.ts`.
- Denial/tenancy legs inside those files (read-only enforcement for parents, admin-only BFLA on
  subscription mutations, cross-tenant isolation controls).
- Layer-wide verification run and traceability audit; knowledge propagation into
  `docs/testing/workflow-journey-tests.md`.

**Out of scope:**
- Changing any production service, repository, schema, or GraphQL resolver (all verified existing).
- Re-writing the existing per-domain journey files; they remain authoritative for their own
  domains and are cited, not merged.
- The GraphQL wire tier: covered by existing suites (`backend/graphql/test/parent-link.wire.test.ts`,
  `parent-monitoring.wire.test.ts`, `session-lifecycle-mutations.test.ts`); the journey layer is
  service-level by definition (`docs/testing/workflow-journey-tests.md` — "There is no HTTP server,
  no GraphQL resolver").
- Paymob live/network legs (`paymob-live-tunnel.` covers that; webhooks are driven in-process).

## Requirements

### REQ-0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I need a recorded error baseline and a strict execution
protocol, so that new failures are distinguishable from pre-existing ones and every task leaves an
auditable outcome trail.

#### Acceptance Criteria

1. WHEN Task 0 starts THEN the agent SHALL record baseline counts (tsgo errors, biome warnings,
   lint result) into `outcome/baseline.md` using the commands listed in `plan.md` §Testing Strategy.
2. WHEN Task 0 completes THEN `deferred-items.md` SHALL exist (initialized from the template).
3. BEFORE executing any task THEN the agent SHALL read ALL files in the outcome directory.
4. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` with findings.
5. WHEN a task completes THEN the agent SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is created or modified THEN the agent SHALL run
   `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` to exit code 0.
7. WHEN a task is marked complete THEN the semantic review checklist (SEC + SR subtasks) SHALL
   have been explicitly evaluated.

### REQ-0.5: Translation System & Enum Import Compliance (test-layer adapted)

**User Story:** As a maintainer, I need journey tests to assert localized behavior through the
compile-time translation system and to import enums as value imports, so that tests never hardcode
user-facing strings or break on enum refactors.

#### Acceptance Criteria (Translation System)

1. WHEN a journey asserts a rejection message THEN it SHALL compare against translated substrings
   obtained from `getServerTranslations("en").errorsTranslations`
   (`shared/locale/server-graphql.ts:3` — single-argument factory), never hardcoded strings.
2. IF a service takes a locale THEN the test SHALL pass a plain `locale: string` (services do not
   accept a locale type wrapper).

#### Translation System Anti-Patterns (FORBIDDEN)

- No reintroduction of a static key-enum lookup pattern (no `Translation`-style constant object).
- No legacy two-argument `getTranslations` call shapes; the journey layer uses
  `getServerTranslations("en")` only.
- Never import from `next-intl`, `getBackendTranslations`, or the removed `shared/messages/` path.

#### Acceptance Criteria (Enum Imports)

1. WHEN a test reads an enum value (e.g. `ProrationDirection.Upgrade`,
   `backend/enum/billing/proration-direction.enum.ts:9-12`) THEN it SHALL use a value import, not
   `import type`.
2. IF an assertion compares direction/status THEN it SHALL use the enum member, never a string
   literal (`"upgrade"` forbidden; `ProrationDirection.Upgrade` required).

### REQ-1: Parent Journey — Consolidated Chained Journey

**User Story:** As the Dev 1 owner, I want one chained journey file driving the complete parent
journey through real services, so that the ticket's full chain is proven end-to-end in one suite.

> Ticket Gherkin (`docs/planning/TICKETS.md:2749-2759`): register → get child's handshake code →
> search child → send link request → student confirms → parent views sessions/reports/homework/
> progress → child's session completes → parent receives notification → parent views report.

#### Acceptance Criteria

1. WHEN the suite runs THEN a single file
   `test/workflows/parents/parent-full-journey.journey.test.ts` SHALL execute the ticket chain as
   ordered, actor-attributed steps against real services and the real test database.
2. WHEN the parent and student register THEN registration SHALL go through the REAL
   `RegistrationService.registerUser` (pattern: `createJourneyCast`,
   `test/workflows/helpers/journey-fixtures.ts:251`), not bare inserts.
3. WHEN the student reads the handshake code THEN `StudentHandshakeService.getMyHandshakeCode`
   (`backend/services/students/student-handshake.service.ts:74`) SHALL return the stored code.
4. WHEN the parent searches by code THEN `findStudentByHandshakeCode`
   (`student-handshake.service.ts:118`) SHALL resolve the child; garbage-shaped codes SHALL be
   rejected pre-DB and unknown codes SHALL return null.
5. WHEN the parent sends the link request THEN
   `ParentLinkRequestService.requestLink` (`backend/services/parents/parent-link-request.service.ts:168`)
   SHALL create ONE pending row with expiry ≈ now + `PARENT_LINK_REQUEST_MS`
   (`shared/constants/parent-link-request.constants.ts:20`) and ONE inbox notification to the student.
6. WHEN the student confirms THEN `respondToLinkRequest`
   (`parent-link-request.service.ts:250`) SHALL write `students.parent_id`, expire every sibling
   pending request, and publish exactly ONE acceptance notification to the parent.
7. WHEN the teacher completes a session and submits the report (real
   `SessionLifecycleService` + `SessionReportService.submitSessionReport`,
   `backend/services/classes/session-report.service.ts:357`) THEN the parent SHALL receive the
   completion notification (spied transport + persisted inbox row with
   `relatedEntityType = "session"` and the session id), matching the deep-link contract proven in
   `parent-session-completion-deep-link.journey.test.ts:513-556`.
8. WHEN the parent then reads the portal THEN `ParentMonitoringService`
   (`backend/services/parents/parent-monitoring.service.ts`) methods `listLinkedChildren` (:178),
   `listChildSessions` (:255), `listChildReports` (:293), `listChildHomework` (:334),
   `getChildProgress` (:210), `getSessionTarget` (:382) and the parent-level
   `listChildrenUpcomingSessions` (:449) SHALL return the child's data.

#### Additional Details

- Priority: P1 (Milestone-4 launch gate) · Complexity: High · Dependencies: REQ-0, REQ-0.5.
- Existing coverage (verified): every individual step already passes in the five per-domain files
  under `test/workflows/parents/` (see plan.md §Existing Coverage); this REQ is the chained
  consolidation the ticket asks for.
- Deviation from ticket Gherkin: the ticket says "within runInRollback"; `test/workflows/AGENTS.md`
  hard rule 1 forbids `runInRollback` in this layer (committed fixtures + tracked cleanup). The
  layer rule wins; see plan.md Decision D-1.

### REQ-2: Parent Journey — Linked-Children Tenancy & Read-Only Enforcement

**User Story:** As the Dev 1 owner, I want the chained journey to prove that a parent sees only
linked children and can never mutate child data, so that ticket scenarios 2 and 3 hold at the
service tier inside the journey layer.

#### Acceptance Criteria

1. WHEN a foreign (never-linked) parent calls any per-child `ParentMonitoringService` read for the
   linked child THEN the call SHALL fail through the real `requireLinkedChild` gate with the
   constant `ForbiddenError` shape and zero returned data (oracle:
   `parent-monitoring.journey.test.ts:813` J1 step 5).
2. WHEN the linked parent's link is examined from the child's perspective THEN the parent's
   `myLinkedChildren` equivalent (`listLinkedChildren`) SHALL contain exactly the linked child and
   no other student row.
3. WHEN the parent actor attempts child-data mutations through real services —
   `SessionLifecycleService.createSession`
   (`backend/services/classes/session-lifecycle.service.ts:196`),
   `confirmSessionCompletion` (`session-lifecycle.service.ts:721`), and
   `SessionReportService.submitSessionReport` (`session-report.service.ts:357`) — THEN each call
   SHALL be denied by the service's real role re-check, throw a translated `ForbiddenError`, and
   produce zero new rows (sessions / reports / notifications unchanged).
4. WHEN the parent attempts the student's link-decision mutation `respondToLinkRequest` THEN the
   real role re-check SHALL deny it (pattern proven at
   `student-confirmation-of-link.journey.test.ts:583-585`).
5. WHEN any denial leg runs THEN the journey SHALL assert the targeted rows remain byte-identical
   (snapshot before/after), per `test/workflows/AGENTS.md` rule 12.

#### Additional Details

- Priority: P1 · Complexity: Medium · Dependencies: REQ-1's cast and link.
- Verified gap being closed: no in-`test/workflows/parents/` parent-mutation probe exists today.
  Adjacent GraphQL-tier proof covers three of the four denied mutations (parent FORBIDDEN on
  `createSession` / `startSession` / `completeSession` —
  `backend/graphql/test/session-lifecycle-mutations.test.ts:337,367,379`; report-write scope
  denial — `backend/graphql/test/session-report.wire.test.ts:18-19`); a parent-denied
  `confirmSessionCompletion` probe exists at NEITHER tier today and lands here for the first time.

### REQ-3: Parent Journey — Link-Request Expiry (7 days) & One-Parent-Per-Student Legs

**User Story:** As the Dev 1 owner, I want the consolidated journey to also pin the 7-day request
TTL and the one-parent-per-student invariant, so ticket scenarios 4 and 5 are demonstrated inside
the same chain.

#### Acceptance Criteria

1. WHEN a link request is created THEN its expiry timestamp SHALL equal creation +
   `PARENT_LINK_REQUEST_MS` where `PARENT_LINK_REQUEST_TTL_DAYS = 7`
   (`shared/constants/parent-link-request.constants.ts:17,20`).
2. WHEN a request whose `expires_at` is backdated into the past is confirmed (against a SECOND,
   otherwise-unlinked student control, keeping the main chain's link intact) THEN the service SHALL
   reject with the translated expired-request error, materialize the row as expired, and create no
   link (pattern: `parent-link-request.journey.test.ts:1002-1091` Journey C).
3. WHEN a second parent requests an already-linked student THEN the flow SHALL end with zero new
   pending rows and zero notifications (already-linked collapse; pattern:
   `parent-link-request.journey.test.ts:931` Journey B step 14).
4. WHEN the invariant is inspected structurally THEN the suite SHALL exercise only the guarded
   single writer `StudentRepository.linkParentIfUnlinked`
   (`backend/db/repo/students/student.repository.ts:373`) — the chained assertions MUST NOT bypass
   it with raw `parent_id` writes.

#### Additional Details

- Priority: P1 · Complexity: Medium · Dependencies: REQ-1.
- Existing coverage (verified): dedicated 19-step link-request journey and 13-step
  student-confirmation journey remain authoritative for the combinatorial matrix; this REQ adds
  the two invariant legs to the consolidated chain only.

### REQ-4: Subscription Lifecycle — Consolidated Chain (Purchase → Expiry → Renewal)

**User Story:** As the Dev 1 owner, I want one chained journey file driving the complete
subscription lifecycle through real services, so balances are proven correct at every stage of the
ticket's chain.

> Ticket Gherkin (`docs/planning/TICKETS.md:2780-2790`): Purchase plan → Balance credited → Use
> sessions → Subscription expires → Admin renews → New balance credited → Admin upgrades → Prorated
> balance → Admin downgrades → Prorated balance → Admin cancels → Balance preserved.

#### Acceptance Criteria

1. WHEN the suite runs THEN a single file
   `test/workflows/billing/subscription-full-lifecycle.journey.test.ts` SHALL execute the chain as
   ordered, actor-attributed steps against real services and the real test database.
2. WHEN the student purchases a plan THEN `SubscriptionPurchaseService.purchase`
   (`backend/services/billing/subscription-purchase.service.ts`) SHALL commit one pending
   payment + pending subscription pair (pattern: `subscription-purchase.journey.test.ts:457`).
3. WHEN the settlement webhook event is processed THEN
   `SubscriptionActivationService.processWebhookEvent`
   (`backend/services/billing/subscription-activation.service.ts`) SHALL mark the payment paid,
   flip the subscription active, stamp the validity window `endDate − startDate = intervalDays`,
   and credit the plan's lane (`plans.balance_lane`) by exactly `sessionCount`
   (oracle: `subscription-purchase.journey.test.ts:533-602`).
4. WHEN the webhook event is replayed THEN activation SHALL be idempotent (no double credit).
5. WHEN the student books a session (real `SessionLifecycleService.createSession`, certified
   teacher cast member) THEN the credited lane SHALL decrement by one through the real debit
   ladder (`backend/services/classes/session-lifecycle.booking.ts:127-150`).
6. WHEN the window is backdated past expiry THEN the row SHALL remain `active` until the sweep;
   `SubscriptionExpiryService.expireDue` (`backend/services/billing/subscription-expiry.service.ts:166`)
   SHALL flip it to `expired` and zero the uncovered lane while `balance_trial` and the second
   tenant's lanes stay byte-identical (oracle: `subscription-expiry.journey.test.ts:556-621`).
7. WHEN the sweep replays THEN it SHALL report honest zero counts.
8. WHEN the admin renews the expired subscription THEN `SubscriptionAdminService.renewSubscription`
   (`backend/services/billing/subscription-admin.service.ts:299`) SHALL create a fresh active
   subscription and credit the lane by the renewal amount; replay SHALL be idempotent (oracle:
   `subscription-admin-lifecycle.journey.test.ts:652-731`).

#### Additional Details

- Priority: P1 · Complexity: High · Dependencies: REQ-0, REQ-0.5.
- Existing coverage (verified): purchase/activation (`subscription-purchase.journey.test.ts`),
  expiry (`subscription-expiry.journey.test.ts`), and admin operations
  (`subscription-admin-lifecycle.journey.test.ts`) each pass per-domain today; no single chain
  walks purchase→cancel. This REQ is the consolidation.
- Balances are session-lane integers (`students.balance_hifz / balance_reviews / balance_tajweed /
  balance_trial`, `backend/db/schema/students/students.ts:24-27`), not monetary amounts.

### REQ-5: Subscription Lifecycle — Proration Legs (Upgrade / Downgrade) & Cancel Preservation

**User Story:** As the Dev 1 owner, I want the journey tier to prove upgrade proration and
downgrade forfeiture exactly as the service computes them, closing the verified journey-tier gap
on the upgrade direction.

#### Acceptance Criteria

1. WHEN the admin changes the active subscription to a higher-value plan THEN
   `SubscriptionAdminService.changeSubscriptionPlan`
   (`subscription-admin.service.ts:488`) SHALL return `direction === ProrationDirection.Upgrade`,
   `forfeitedSessions === 0`, and `carrySessions` equal to
   `floor(remaining × priceOld × scNew / (scOld × priceNew))` clamped to `MAX_SESSION_COUNT`
   (`backend/services/billing/subscription-proration.helpers.ts:139-175`), and the target lane
   SHALL equal `newPlan.sessionCount + carrySessions`.
2. WHEN the upgrade is replayed with the same idempotency input THEN the replay SHALL re-derive
   the identical direction via `prorationDirectionOf` (`subscription-proration.helpers.ts:114`)
   and apply no second credit.
3. WHEN the admin changes to a lower-value plan THEN the result SHALL be
   `direction === ProrationDirection.Downgrade`, `carrySessions === 0`, `forfeitedSessions` equal
   to the remaining excess, and the lane SHALL reset to the new plan's `sessionCount` (oracle:
   `subscription-admin-lifecycle.journey.test.ts:748-829`).
4. WHEN the admin cancels THEN `cancelSubscription` (`subscription-admin.service.ts:400`) SHALL set
   status `cancelled` and mutate NO lane column — balances before/after byte-identical
   (`subscription-admin-lifecycle.journey.test.ts:558-599`).
5. WHEN a student actor attempts `renewSubscription`, `cancelSubscription`, or
   `changeSubscriptionPlan` THEN the service's `assertActorAdmin` re-check SHALL deny each call
   (BFLA) with zero side effects (oracle: `subscription-admin-lifecycle.journey.test.ts:837`).
6. WHEN each transition completes THEN the plan-change audit rows (Override entries with proration
   details) SHALL exist and a second tenant's subscriptions and lanes SHALL be byte-identical.

#### Additional Details

- Priority: P1 · Complexity: High · Dependencies: REQ-4.
- Verified gap being closed: no `test/workflows/` file exercises the upgrade direction
  (`grep -rn 'upgrade' test/workflows` → zero hits); upgrade proration is currently proven only at
  service-unit level (`backend/services/billing/subscription-admin.service.test.ts:1661-1899`).
- Semantics note: "proration" in this codebase is session-unit based, not monetary — no wallet
  refund leg exists in plan changes (verified in `subscription-proration.helpers.ts`).

### REQ-6: Cross-Cutting — Journey-Layer Conventions, Runner Discipline & Traceability

**User Story:** As the executing agent, I need both new suites to obey every journey-layer hard
rule and to leave a green layer-wide run plus updated permanent docs, so the suites are
maintainable and teach the conventions forward.

#### Acceptance Criteria

1. WHEN either suite runs THEN fixtures SHALL be committed in one transaction, every created row
   id tracked, and `afterAll` SHALL hard-delete in reverse order re-probing every row (zero-residue
   teardown is a failing assertion, not advisory) — `test/workflows/AGENTS.md` rules 1–2.
2. WHEN names are generated THEN each suite SHALL use a `` `jrn_<domain>_${randomUUID().slice(0,8)}` ``
   prefix (`` `jrn_parentfull_…` ``, `` `jrn_subfull_…` ``) so parallel/repeated runs never collide.
3. WHEN any rejection is asserted THEN the suite SHALL use the try/catch helper
   (`catchJourneyError`, `test/workflows/helpers/journey-fixtures.ts:226`) — never
   `expect(...).rejects.toThrow()`.
4. WHEN external effects would fire THEN the suites SHALL intercept the notification boundary:
   inject `SpiedFanoutTransport` (`test/workflows/helpers/spied-transport.ts:49`) at the injected
   `options.transport` seam where the service accepts one (link/monitoring/activation paths), and
   use the rule-5 namespace `spyOn` fallback where it does not (the purchase leg —
   `subscription-purchase.journey.test.ts:150` precedent); either way, assert BOTH the dispatch
   and the exact recipient user ids.
5. WHEN suites are executed during development THEN the runner SHALL be
   `bun run test/scripts/run-test.ts <path>` — never a raw `bun test` invocation on workflows.
6. WHEN implementation completes THEN `bun run test/scripts/run-test.ts test/workflows` (layer
   run) SHALL pass with baseline-or-better quality-gate counts.
7. WHEN the plan completes THEN `docs/testing/workflow-journey-tests.md` SHALL be extended with the
   consolidated-chain pattern and the verified gap closures (knowledge propagation).

#### Additional Details

- Priority: P1 · Complexity: Low · Dependencies: REQ-1…REQ-5.

## UX/Navigation Requirements (No-UI Ruling)

This plan creates test files only — no routes, pages, sidebar entries, or navigation changes.

| Surface | Decision | Rationale |
|---|---|---|
| New Routes & URLs | None | Test-layer plan; no `app/` changes. |
| Sidebar / Navigation | None | No admin or portal UI added. |
| Role-Based Access | N/A (asserted, not built) | Role access is exercised inside tests via real role re-checks; nothing user-facing ships. |
| Per-Audience Rendering | N/A | No rendering surface. |
| Permission Mapping | N/A (verified only) | The suites consume the EXISTING permission strings; none are created. |

## Cross-Actor Workflow Scenarios (Journeys)

Two journeys, mapping 1:1 to the two new files. Both follow the layer rules in
`test/workflows/AGENTS.md` (committed fixtures, honest authorization, spied transports).

### Journey 1 — Parent Full Journey (`test/workflows/parents/parent-full-journey.journey.test.ts`)

#### Actor Table

| Actor | Role row | Can do | Cannot do |
|---|---|---|---|
| Parent P | `parents` | request link, read linked child's portal data | confirm requests, mutate sessions/reports, see other children |
| Student S1 (child) | `students` (+user) | read own handshake code, confirm/reject link requests | admin subscription ops |
| Student S2 (control) | `students` | receive a link request (used for the expiry leg) | — |
| Parent P2 (foreign) | `parents` | request a link to a not-yet-linked student | see P's linked child, link an already-linked student |
| Teacher T | `teachers` (certified, `isApproved`) | start/complete the booked session, submit its report | book sessions, parent portal reads |
| Admin A | `admin` | governance reads | (unused for mutations in this journey) |
| System | — | fixture provisioning, time control (backdating) | — |

#### Ordered Step List

1. **System** → register parent P and student S1 via REAL `RegistrationService.registerUser`
   (pattern `createJourneyCast`, `journey-fixtures.ts:251`) → `users` + role-child rows committed;
   S1 holds a generated handshake code; ids tracked in the shared registry.
2. **System** → provision remaining cast (S2, P2, teacher T via `provisionCertifiedTeacherActor`,
   `actor-context.ts:105`) in the tracked fixture transaction.
3. **Student S1** → `StudentHandshakeService.getMyHandshakeCode(s1UserId, locale)` → returns own
   code verbatim; no other student's code leaks.
4. **Parent P** → `findStudentByHandshakeCode(code, locale)` → resolves S1 as linkable; garbage
   code rejected pre-DB; unknown code returns null.
5. **Parent P2** → `requestLink(codeOfS2, p2UserId, locale)` → ONE pending row +7d, ONE inbox row
   to S2, exactly ONE spied publish targeting S2 (sets up the expiry leg).
6. **Parent P** → `requestLink(codeOfS1, pUserId, locale)` → ONE pending row +7d TTL window
   asserted ≈ `PARENT_LINK_REQUEST_MS`, ONE inbox notification to S1.
7. **Student S1** → `listMyIncoming(s1UserId, locale)` → sees P's request.
8. **Student S1** → `respondToLinkRequest(reqP, true, s1UserId, locale)` → `students.parent_id = P`
   written; all sibling pendings expired; ONE acceptance notification to P.
9. **Parent P2** → `requestLink(codeOfS1, p2UserId, locale)` on now-linked S1 → already-linked
   collapse: conflict error, zero new rows, zero notifications (one-parent-per-student leg).
10. **System** → backdate P2→S2 request's `expires_at` into the past.
11. **Student S2** → `respondToLinkRequest(reqExpired, true, s2UserId, locale)` → translated
    expired-request error via `catchJourneyError`; row materializes expired; no link written
    (7-day expiry leg, REQ-3).
12. **Student S1** → books the session through the real `SessionLifecycleService.createSession`
    (S1 is provisioned with a trial-lane balance for this leg — pattern
    `parent-session-completion-deep-link.journey.test.ts:288,408`); **Teacher T** →
    `startSession` → completes → `SessionReportService.submitSessionReport(...)` → report
    persisted for S1's session.
13. **System** → assert notification fan-out: spied publish targeted {S1, P}; persisted inbox row
    for P carries (`relatedEntityType = "session"`, `relatedEntityId = sessionId`); foreign
    parent P2 received nothing (isolation probe).
14. **Parent P** → `listLinkedChildren` → exactly [S1]; `listChildSessions` / `listChildReports` /
    `listChildHomework` / `getChildProgress` / `getSessionTarget(sessionId)` → S1-scoped rows
    including the step-12 report; `listChildrenUpcomingSessions`
    (`parent-monitoring.service.ts:449`) → includes S1's upcoming block; deep-link landing path
    constructible.
15. **Parent P2** → every per-child monitoring read against S1 → constant `ForbiddenError`, zero
    data (tenancy leg, REQ-2).
16. **Parent P** → attempts `createSession`, `confirmSessionCompletion`, `submitSessionReport`,
    and `respondToLinkRequest` with parent actor id → each denied by the real role re-check;
    zero new rows; S1's rows byte-identical (read-only leg, REQ-2).
17. **System** → tracked teardown; every registered id re-probed absent; suite fails on residue.

#### Cross-Actor EARS Criteria (Journey 1)

1. WHEN the parent searches by the child's handshake code THEN the system SHALL resolve only the
   matching, not-yet-linked student and SHALL NOT disclose parent/child identity for already-linked
   targets.
2. WHEN the student confirms the link THEN the parent SHALL observe the child in
   `listLinkedChildren` and the system SHALL expire every sibling pending request.
3. WHEN the child's session completes THEN the parent SHALL receive exactly one persisted
   notification carrying the session deep-link triple, and every non-linked parent SHALL observe
   no fan-out.
4. IF a link request is older than 7 days THEN the system SHALL reject confirmation with the
   translated expired-request error and write no link.
5. WHEN a parent attempts any child-data mutation or the student's link decision THEN the system
   SHALL deny through the real role re-check and leave all rows byte-identical.

### Journey 2 — Subscription Full Lifecycle (`test/workflows/billing/subscription-full-lifecycle.journey.test.ts`)

#### Actor Table

| Actor | Role row | Can do | Cannot do |
|---|---|---|---|
| Student S | `students` | purchase plan, book sessions against credited lane | renew/cancel/change plan (admin-only) |
| Student S2 (control) | `students` | own subscription (untouched control tenant) | observe/affect S's balances |
| Admin A | `admin` | renew, change plan (upgrade/downgrade), cancel | — |
| Teacher T | `teachers` (certified) | teach the booked session | subscription admin ops |
| System | — | webhook settlement event, expiry sweep, time control | — |

#### Ordered Step List

1. **System** → cast + two plans (`createTestPlan`, entity-setup) in one committing tx: plan LOW
   (hifz lane) and plan HIGH (hifz lane, higher price & session count); S, S2 with control
   subscription, teacher T, admin A; snapshots of all lane columns captured.
2. **Student S** → `SubscriptionPurchaseService.purchase(plan LOW)` → ONE pending payment + ONE
   pending subscription.
3. **System** → `SubscriptionActivationService.processWebhookEvent(settled event)` → payment paid;
   subscription active; window = `startDate .. startDate + intervalDays`; `balance_hifz` credited
   exactly LOW.sessionCount; replay asserts idempotency.
4. **Student S** → book one session (`SessionLifecycleService.createSession` with T) → lane
   decremented by one through the debit ladder.
5. **System** → backdate S's subscription `end_date` past now → row still `active`; run
   `SubscriptionExpiryService.expireDue()` → flip to `expired`, lane zeroed; `balance_trial`
   survives; S2 byte-identical; sweep replay → zero counts.
6. **Admin A** → `renewSubscription({ subscriptionId })` expired source → fresh active subscription,
   lane credited renewal amount; replay idempotent.
7. **Admin A** → `changeSubscriptionPlan` to plan HIGH → `ProrationDirection.Upgrade`,
   `carrySessions` per the exact formula (clamp `MAX_SESSION_COUNT`), lane =
   HIGH.sessionCount + carry; Override audit row; replay re-derives same direction.
8. **Admin A** → `changeSubscriptionPlan` to plan LOW → `ProrationDirection.Downgrade`,
   `carrySessions = 0`, `forfeitedSessions` = excess, lane = LOW.sessionCount; audit row records
   the forfeit.
9. **Admin A** → `cancelSubscription` → status `cancelled`; lane values byte-identical
   before/after (balance preserved).
10. **Student S** → attempts `renewSubscription`, `cancelSubscription`, `changeSubscriptionPlan` →
    each denied by `assertActorAdmin`, zero side effects (BFLA leg).
11. **System** → final tenancy sweep: S2's subscriptions/lanes byte-identical to step-1 snapshots;
    tracked teardown, zero residue.

#### Cross-Actor EARS Criteria (Journey 2)

1. WHEN the settlement webhook is processed THEN the student SHALL observe the credited lane and a
   usable validity window, and an event replay SHALL credit nothing twice.
2. WHEN the validity window passes THEN the system (sweep) SHALL zero the uncovered lane while the
   trial lane and every other tenant's lanes remain untouched.
3. WHEN the admin renews an expired subscription THEN the student SHALL observe a fresh active
   window and a re-credited lane.
4. WHEN the admin upgrades the plan THEN the student SHALL retain the prorated carry on top of the
   new plan's session count; WHEN the admin downgrades THEN the system SHALL forfeit the excess and
   reset the lane to the new plan's count.
5. WHEN the admin cancels THEN the student's remaining balance SHALL be byte-identical preserved.
6. WHEN a student attempts any admin subscription mutation THEN the system SHALL deny it through
   the real `assertActorAdmin` re-check with zero side effects.

## Non-Functional Requirements

### Performance Requirements

1. Each suite SHALL complete within the layer's existing runtime budget (peers run in seconds; no
   network I/O — external effects are spied in-process).
2. Suites SHALL be safe under the repo's parallel test runners (unique prefixes, no shared rows).

### Security Requirements

1. All denial assertions SHALL resolve through real role/ownership re-checks — no monkey-patching
   of authorization (`test/workflows/AGENTS.md` rule 4).
2. No real notification/email/SMS dispatch SHALL leave the process (spied transport, rule 5).
3. Assertions SHALL include at least one cross-actor denial probe per journey plus foreign-actor
   isolation checks (rule 12).

### Reliability Requirements

1. Re-running a suite twice back-to-back SHALL pass (idempotent teardown proof).
2. A failing `beforeAll` SHALL leave zero committed rows (single committing provision tx).

## Constraints and Assumptions

### Technical Constraints

- Journey-layer rules from `test/workflows/AGENTS.md` are binding over the ticket Gherkin wording
  (no `runInRollback`; no raw `bun test`; `bun:test` imports only; `@/` aliases only).
- No production code changes; the plans exercises services exactly as shipped.
- Expiry is cron-sweep based, not lazy — time travel is done by backdating `end_date`, then
  invoking the real sweep; there is no in-process scheduler.

### Business Constraints

- "Proration" is session-unit based (carry/forfeit of session counts), not a monetary refund —
  assertions MUST assert session arithmetic, never wallet deltas.
- One parent per student is enforced by the guarded single writer, not a unique constraint.

### Assumptions

- The blocking Milestone-1/3 surfaces remain stable (both finished plans shipped and verified).
- The existing per-domain journey files stay green and are not restructured by this plan.

## Success Criteria

### Definition of Done

- [ ] `parent-full-journey.journey.test.ts` passes via `run-test.ts` (all steps, REQ-1…REQ-3).
- [ ] `subscription-full-lifecycle.journey.test.ts` passes via `run-test.ts` (all steps, REQ-4…REQ-5).
- [ ] Full layer run `bun run test/scripts/run-test.ts test/workflows` green (REQ-6).
- [ ] Per-file `sub-loop.ts --lifecycle duplicates` exit 0 on both new files; quality-gate counts
  at or below the Task-0 baseline.
- [ ] Zero-residue teardown proven (suite re-run) for both files.
- [ ] Outcome files written for every task; all checkboxes flipped; `deferred-items.md` clean.
- [ ] `docs/testing/workflow-journey-tests.md` extended with the consolidated-chain pattern.

### Acceptance Metrics

| Metric | Target | Measured via |
|---|---|---|
| Ticket chain steps passing in one chained file each | 100% (parent 17 steps; subscription 11 steps) | suite output |
| New journey-tier coverage of upgrade proration | ≥1 end-to-end assertion incl. exact carry formula | REQ-5 AC1 |
| Parent write-denial probes inside journey tier | ≥4 distinct denied mutations | REQ-2 AC3-4 |
| Teardown residue across both suites | 0 rows | registry re-probe |

## Glossary

| Term | Meaning |
|---|---|
| Journey / workflow test | Chained, actor-attributed service-level test over the real DB (`test/workflows/`) |
| Handshake code | Student's unique public code (`KSB-…`) parents search by to request a link |
| Lane | Per-modality integer session balance on `students` (hifz/reviews/tajweed/trial) |
| Proration | Session-unit carry (upgrade) or forfeit (downgrade) computed by plan value comparison |
| Sweep | `SubscriptionExpiryService.expireDue` cron-driven batch expiry + lane zeroing |
| Spied transport | `SpiedFanoutTransport` injected at the notification seam; records, never delivers |

## Requirements Review Checklist

- [x] All user roles identified and addressed (parent/student/teacher/admin + system actor)
- [x] Normal, edge, and error cases covered (expiry, already-linked, replay, denial legs)
- [x] Requirements testable and measurable (every AC names service, file, and oracle)
- [x] No conflicting requirements (ticket-vs-layer conflict resolved in Decision D-1)
- [x] EARS format used consistently
- [x] Cross-actor journeys captured with actor tables, ordered steps, observer-perspective EARS
