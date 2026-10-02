# Requirements & Specification: Segregated Session Balance Crediting — Verification, Gap Closure & Ratification

**Plan directory:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/`
**Specs path:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/specs.md`
**Plan path:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/plan.md`
**Tasks path:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/tasks.md`
**Deferred-items ledger:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/outcome/`

## Document Information

- **Feature Name**: Segregated Session Balance Crediting (DEV1-007)
- **Ticket Reference**: `docs/planning/TICKETS.md:496-536` ("Segregated Session Balance Crediting" — Owner Dev 1, Milestone 1, 5 SP, Blocked By DEV1-006 "Subscription Purchase via Payment Gateway")
- **Decision Refs (ticket)**: FR-2.5, INV-B1, INV-B2, INV-B4, INV-B5 — defined at `docs/specs/functional-requirements.md:67-70` and `docs/specs/state-machine-invariants.md:145-149`
- **Target Directory**: `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/`
- **Outcome Directory**: `ai/plans/milestone_1_core_domain_mvp/Segregated Session Balance-crediting/outcome/`
- **Blocked By (actual state)**: DEV1-006 has **LANDED** — purchase + activation + lane crediting shipped (evidence: `ai/finished_plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/`, `docs/billing/subscription-purchase.md` status Active)
- **Version**: 1.0 · **Date**: 2026-09-11 · **Author**: Spec Plan Generator (research-swarm assisted)
- **Stakeholders**: Dev 1 stream (billing owner), Dev 3 stream (session lifecycle consumes the balance surface, per `docs/planning/MILESTONE_PLAN.md` cross-stream contract "DEV1-007 (Balance Crediting): Dev 1 provides balance; Dev 3 holds/decrements for escrow"), students (balance holders), admins (observability)

## Introduction

### Feature Summary

Every student carries segregated session balances (`balance_hifz`, `balance_tajweed`, `balance_reviews`, plus the `balance_trial` 4th lane added by the free-trial plan). Activating a subscription credits the plan's full `session_count` into exactly the lane the plan designates (INV-B2); attending sessions consumes one unit from the matching lane (INV-B5, via the shipped hold-as-debit escrow); a student with no eligible balance cannot book (INV-B4); no lane may ever go negative (INV-B1).

### Business Value

- Revenue integrity: paid plans materialize as spendable session units on the correct track — miscrediting or double-crediting is direct money loss / bad debt.
- Trust: a student must never be told "insufficient balance" while holding units, and must never spend units they do not own.
- Segregation honors the product model (Hifz / Tajweed / Reviews are distinct purchase tracks — FR-2.5).

### Scope

**IN (this plan):**

1. **Verification & evidence** of the already-shipped segregated-balance substrate against the ticket's acceptance criteria — schema, repo guarantees, service wiring, i18n, error semantics, existing tests — with a durable per-AC evidence table recorded in the outcome ledger.
2. **Gap closure (tests)**: service-level Tajweed-lane activation credit test (today only Hifz + Reviews have service-level credit tests), a Tajweed leg in the purchase journey, and a GraphQL-transport pin for the `INSUFFICIENT_BALANCE` custom error code.
3. **Ratification of shipped semantics** that differ in wording (not in effect) from the ticket gherkin: debit timing (hold-as-debit at request), trial-first eligibility ladder (INV-B4/B8), reviews-lane credit-only posture, and the GraphQL rendering of the "422" requirement.
4. **Documentation sync**: `db/schema.dbml` drift repair (balance lanes, trial columns, CHECK constraints, `plans.balance_lane`, subscription payment-reference index); `docs/planning/PRODUCTION_READINESS.md` §5.3.1–5.3.5 evidence check-off; canonical reference doc `docs/billing/segregated-session-balance.md`.

**OUT (recorded in deferred-items.md):**

- Student-facing balance UI / query (`/subscriptions` page is an existing ComingSoon stub — `frontend/views/dashboard/nav/navItems.ts:117-124`); ticket carries no UI AC.
- A reviews-lane *consumption* path (no review-session booking flow exists yet; reviews credits accumulate by design until that flow ships).
- Tightening the three paid balance columns from nullable-with-default to `notNull()` (defense-in-depth already layered: guarded predicates + CHECK constraints + `COALESCE`; migration churn unjustified in Milestone 1).
- Dual-confirmation handshake / escrow mechanics themselves (DEV3-004/DEV3-012 scope, already shipped; this plan only verifies the balance effects).
- Subscription expiry / validity-window job (DEV1-008 "Subscription Validity Window & Expiry", `docs/planning/TICKETS.md:540+` — depends on this ticket but is its own scope).
- Teacher wallet crediting on confirmation (DEV3-012 surface; asserted here only as a boundary "not our table" probe).

---

## 1. Executive Summary & Problem Statement

**Problem.** The ticket was authored against a pre-implementation worldview. Since then, the blocked-by ticket (DEV1-006) and the session-lifecycle streams (DEV3-004, DEV3-012) shipped, and ~90% of the acceptance criteria are already satisfied in code. Shipping this ticket "as written" would (a) re-implement working code, (b) contradict the sanctioned hold-as-debit accounting model (`docs/sessions/session-lifecycle.md` §4–§5), and (c) silently skip the small set of genuine gaps that remain undetected precisely because everyone assumed the ticket covered them.

**Approach (summary of `plan.md`).** Run a rigorous substrate verification (each AC mapped to executing evidence), close the four real gaps (Tajweed service-level test, Tajweed journey leg, GraphQL `INSUFFICIENT_BALANCE` pin, DBML resync), ratify the three wording divergences as explicit design decisions bound to the invariant set, sync the production-readiness checklist, and propagate the consolidated balance model into `docs/billing/segregated-session-balance.md`.

**Ground-truth verification table** (row = substrate this ticket depends on; verified 2026-09-11 by direct code inspection):

| Substrate | State | Evidence |
|---|---|---|
| `students` balance columns `balance_hifz` / `balance_reviews` / `balance_tajweed` (int, default 0, nullable) + `balance_trial` (int, notNull, default 0) + `trial_granted_at` | **EXIST** | `backend/db/schema/students/students.ts:24-28` |
| Non-negative CHECK constraints ×4 (`students_balance_{hifz,reviews,tajweed,trial}_check`, each `>= 0`) | **EXIST** | `backend/db/schema/students/students.ts:42-45` |
| Plan→lane designation `plans.balance_lane` (pgEnum `subscription_credit_lane`: hifz/tajweed/reviews, nullable, fail-closed) | **EXIST** | `backend/db/schema/billing/plans.ts:29`; enum `backend/enum/billing/subscription-credit-lane.enum.ts:9-13`; pgEnum `backend/db/schema/enums.ts:65` |
| Activation credit: full `sessionCount`, single guarded credit statement, same tx as activation flip | **EXIST** | `backend/services/billing/subscription-activation.service.ts:393-400` → `StudentRepository.creditLaneBalance` (`backend/db/repo/students/student.repository.ts:531` → `student.repository.credit-lane.helpers.ts:108-120`) |
| Fail-closed lane mapper (no cast; default aborts unit) | **EXIST** | `subscription-activation.service.ts:224-242`; constants at :209-211 |
| Exactly-once activation (replay-safe, zero double credit) | **EXIST** | `SubscriptionRepository.activatePendingOnce` (`backend/db/repo/billing/subscription.repository.ts:131`) + `markPaidOnce` |
| Purchase-time NULL-lane rejection (`PLAN_LANE_UNCONFIGURED`, 422-family) | **EXIST** | `backend/services/billing/subscription-purchase.service.ts:272-278` |
| Hold-as-debit booking ladder: guarded single-statement debit, trial first then intent lane; all-miss throws localized `ValidationError("INSUFFICIENT_BALANCE", t.insufficientBalance)` | **EXIST** | `backend/services/classes/session-lifecycle.booking.ts:95-116`; entry `SessionLifecycleService.createSession` (`backend/services/classes/session-lifecycle.service.ts:196-215`); guarded repo debit `backend/db/repo/students/student.repository.ts:478-493` |
| Dual confirmation consumes the hold (no second debit); cancel/timeout refunds to recorded provenance lane | **EXIST** | `backend/services/classes/session-lifecycle.confirmation.ts:112-138` (consume), `session-lifecycle.transitions.ts:222-237` (same-lane refund via `session.held_balance_lane`, `backend/db/schema/classes/session.ts:63-65`) |
| 422 semantics: `VALIDATION → 422` in canonical taxonomy; custom code rides `extensions.code` | **EXIST** | `backend/lib/errors/error-code-taxonomy.ts:41-51`; boundary masking `backend/graphql/graphqlErrorsFinalizer.ts:1-56` |
| Localized copy `insufficientBalance` en + ar | **EXIST** | type `shared/locale/types/errors/labels.ts:174`; en `shared/locale/en/errors/index.ts:85`; ar `shared/locale/ar/errors/index.ts:84` |
| Repo/service tests & journeys for credit / debit / denial / replay / concurrency | **EXIST (with noted gaps)** | see §2.2–2.3 subsections and `plan.md` §9 |
| **Service-level Tajweed-lane credit test** | **MISSING** (author note declares hifz/tajweed "byte-identical", `subscription-activation.service.test.ts:39`) | only Hifz (`:523-542`) and Reviews (`:546-573`) credit tests exist at service level |
| **Tajweed leg in purchase journey** | **MISSING** | journey covers hifz + reviews (`test/workflows/billing/subscription-purchase.journey.test.ts:506-545,765-813`) |
| **GraphQL-transport pin for `INSUFFICIENT_BALANCE`** | **MISSING** | grep: code never asserted at `backend/graphql/test/`; closest pin `backend/graphql/test/session-lifecycle-mutations.test.ts:594` |
| **`db/schema.dbml` parity** | **STALE** | `db/schema.dbml:218-231` (students) lacks `balance_trial` / `trial_granted_at` / 4 CHECKs; `plans` (:277-288) lacks `balance_lane`; payment_reference unique index not shown |
| `docs/planning/PRODUCTION_READINESS.md` §5.3.1–5.3.5 checkboxes | **UNCHECKED** | `docs/planning/PRODUCTION_READINESS.md:243-248` |

**Semantic divergences to ratify (not bugs):** debit timing (request-time hold vs ticket's "on attending"), trial-first eligibility vs the plain zero-balance AC, reviews lane credit-only, and "422" phrasing under GraphQL transport. Full analysis in `plan.md` §1.3 decisions D1–D4.

---

## 2. Requirements (EARS)

### 2.0 Execution Discipline

**REQ-001** — WHEN implementation starts THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline` into `/tmp/baseline-*`) and store them in `outcome/0-baseline-outcome.md`.

**REQ-002** — WHEN implementation starts THEN the agent SHALL ensure `deferred-items.md` exists and remains the single ledger for all deferrals.

**REQ-003** — WHEN an agent begins ANY task THEN it SHALL read ALL existing files in the outcome directory before editing.

**REQ-004** — WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` capturing findings, evidence, and carry-over knowledge.

**REQ-005** — WHEN a task completes THEN the agent SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md`.

**REQ-006** — WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 before proceeding.

**REQ-007** — WHEN marking a subtask complete THEN the agent SHALL also complete the semantic review checklist (race conditions, dead code, cross-layer imports, enum value-imports, deferred-item logging).

### 2.0.5 i18n & Enum Compliance (real signatures, verified against code)

**REQ-008** — All user-facing strings SHALL use the compile-time i18n system exactly as the live code does:
- Server components: `const t = getTranslations(locale)` (single arg, synchronous — `shared/locale/server.ts`) then property access (`t.<Ns>.<key>`) — example `app/(dashboard)/wallet/page.tsx:26`.
- GraphQL resolvers: `await ctx.t("errorsTranslations")` — live callers `backend/graphql/shared/resolver-guards.ts:57`, `backend/graphql/shared/admin-prelude.ts:33`.
- Services / API routes / tests: `getServerTranslations(locale).errorsTranslations` (object access; no namespace arg) — live caller `backend/services/classes/session-lifecycle.service.ts:203`.
- FORBIDDEN: two-arg `getTranslations(locale, "ns")`, `Translation.` enums, function-call keys `t("x.y")`, `next-intl`, `getBackendTranslations`, `shared/messages/`.

**REQ-009** — Enums consumed at runtime SHALL be value imports, and enum members SHALL be used instead of string literals (live pattern: `LANE_HIFZ = SubscriptionCreditLane.Hifz` at `subscription-activation.service.ts:209-211`).

### 2.1 Substrate Verification (ticket AC: "balances are non-negative integers"; INV-B1)

**REQ-010** — WHEN the verification task runs THEN the agent SHALL confirm and record evidence that `students.balance_hifz/tajweed/reviews/trial` exist with default 0 and that all four `students_balance_*_check` (`>= 0`) constraints exist (`backend/db/schema/students/students.ts:24-28,42-45`), including a DB-layer proof that a raw negative UPDATE is rejected (existing proof: `backend/db/test/repo/students/student.repository.test.ts:428-460`).

**REQ-011** — WHEN the verification task runs THEN the agent SHALL confirm `plans.balance_lane` is a nullable pgEnum over exactly `{hifz, tajweed, reviews}` and that purchase fails closed with `PLAN_LANE_UNCONFIGURED` when NULL (`backend/services/billing/subscription-purchase.service.ts:272-278`).

**REQ-012** — WHEN the verification task runs THEN the agent SHALL confirm hold provenance is recorded per session on `sessions.held_balance_lane` (`backend/db/schema/classes/session.ts:65`, vocabulary `HeldBalanceLane` = trial|hifz|tajweed, reviews excluded — `backend/enum/scheduling/held-balance-lane.enum.ts:17-31`).

### 2.2 Crediting on Activation (INV-B2, FR-2.4, ticket AC 1+2 + test scenarios 1–3)

**REQ-013** — WHEN a payment-confirmed webhook event settles a pending subscription THEN the system SHALL credit the plan's full `sessionCount` to the plan's designated lane in the same transaction as the activation flip (existing wiring: `subscription-activation.service.ts:393-400`); this plan verifies and evidences it unchanged.

**REQ-014** — IF the same webhook event is delivered twice THEN the system SHALL credit exactly once (exactly-once arbiter `activatePendingOnce`, `backend/db/repo/billing/subscription.repository.ts:131`); verified with the existing replay tests (`subscription-activation.service.test.ts:380-404,861-885`).

**REQ-015** — WHEN a lane is credited THEN the other lanes SHALL be byte-identical before/after (single-column setter map, `student.repository.credit-lane.helpers.ts`).

**REQ-016** — IF the plan's stored lane is NULL or outside the closed vocabulary THEN the activation SHALL fail closed (quarantine, zero mutation, correlated error log) — never credit a different lane (`subscription-activation.service.ts:224-242`).

**REQ-017** — **GAP (new test)** — WHEN a subscription for a Tajweed-laned plan activates THEN a service-level test SHALL assert `balance_tajweed` increases by exactly `sessionCount` with hifz/reviews/trial untouched (parity with the existing Hifz `:523-542` and Reviews `:546-573` service tests; closes ticket test scenario "Tajweed plan credits balance_tajweed only" at the service level).

**REQ-018** — **GAP (new journey leg)** — WHEN the purchase journey runs THEN a Tajweed-laned plan leg SHALL drive the full purchase→webhook→credit path and assert `balance_tajweed += sessionCount` with sibling lanes untouched (extends `test/workflows/billing/subscription-purchase.journey.test.ts`, which currently exercises hifz + reviews only).

### 2.3 Consumption, Denial & Refund (INV-B4, INV-B5, INV-B8, ticket AC 3+4 + test scenarios 4–6)

**REQ-019** — WHEN a student requests a session THEN the system SHALL consume exactly one unit via the hold-as-debit ladder: guarded single-statement debit of `balance_trial` first (INV-B8), else the intent lane's guarded debit (`decrementLaneIfAvailable`, `backend/db/repo/students/student.repository.ts:478-493`), recording the funding lane on `sessions.held_balance_lane`.

**REQ-020** — WHEN no eligible lane holds a unit (trial = 0 AND intent lane = 0) THEN booking SHALL be rejected with `ValidationError("INSUFFICIENT_BALANCE", t.insufficientBalance)` (`backend/services/classes/session-lifecycle.booking.ts:107-114`); zero rows SHALL be written, the idempotency key SHALL remain reusable, and the client SHALL observe the 422-family semantics (VALIDATION → 422 per `backend/lib/errors/error-code-taxonomy.ts:41-51`; over GraphQL the custom code surfaces as `errors[].extensions.code = "INSUFFICIENT_BALANCE"` with localized en/ar copy).

**REQ-021** — **GAP (new test)** — WHEN the `createSession` mutation is executed through the GraphQL integration harness with an empty-wallet student THEN a test SHALL pin the transport contract: `errors[].extensions.code = "INSUFFICIENT_BALANCE"` and localized message present (test via `testClient` in `backend/graphql/test/`, following `session-lifecycle-mutations.test.ts`).

**REQ-022** — WHEN dual confirmation completes THEN the system SHALL consume the hold without any second student-balance debit (`fee_held` flip per `session-lifecycle.confirmation.ts:112-138`); the net per-attended-session effect is exactly −1 on the funding lane.

**REQ-023** — WHEN a held session is cancelled or its 24h confirmation window lapses THEN the unit SHALL be refunded to the recorded provenance lane (`session-lifecycle.transitions.ts:222-237`), never to a caller-chosen lane.

### 2.4 Semantic Ratifications (design decisions bound to invariants)

**REQ-024** — This plan SHALL formally ratify hold-as-debit at request time as the fulfillment of ticket AC "decrement on attending (dual confirmation)": net accounting effect is identical, and the request-time hold is what makes the zero-balance denial enforceable atomically (anchor: `docs/sessions/session-lifecycle.md` §4–§5; INV-B8).

**REQ-025** — This plan SHALL ratify the reviews lane as credit-only in Milestone 1: `reviews` is a `SubscriptionCreditLane` but not a `HeldBalanceLane` (`backend/enum/scheduling/held-balance-lane.enum.ts:13-31`); no review-session booking path exists, so no decrement path exists; INV-B5's review decrement clause binds when such a flow ships in a future ticket.

**REQ-026** — This plan SHALL ratify INV-B4's extended eligibility: a request is admissible when `(intent lane > 0) OR (balance_trial > 0)`; the ticket gherkin's plain `balance_hifz=0 ⇒ reject` holds exactly when the trial lane is also 0.

### 2.5 Integrity, Documentation & Tenancy

**REQ-027** — The non-negative invariant SHALL remain defended in depth: guarded predicates prevent negative writes in normal flow AND the four CHECK constraints are the DB backstop; the existing constraint-rejection proofs SHALL be re-run and cited (`student.repository.test.ts:428-460`, `constraintNameOf` helper `backend/db/test/test-utils.ts:111`).

**REQ-028** — **GAP (docs sync)** — `db/schema.dbml` SHALL be brought to parity with the Drizzle schema for this domain: students `balance_trial`/`trial_granted_at` + four CHECK notes, `plans.balance_lane`, and the `subscriptions_payment_reference_unique` partial index (current drift verified at `db/schema.dbml:218-231,277-288`).

**REQ-029** — Balances SHALL be mutable only through the server-side credit/debit/refund primitives; no GraphQL surface accepts caller-supplied balance deltas, and balance fields are exposed only on admin-scoped read types today (`backend/graphql/pothos/admin/admin-students.pothos.ts:49-52`); purchase and booking entry points SHALL remain role-gated (`$all { authenticated, role: [Student] }` pattern).

### 2.6 Testing Obligations

**REQ-030** — DB-layer tests SHALL use `runInRollback` with `tx` threaded to every repo call; forbidden: `expect(...).rejects.toThrow()` inside rollback (use `expectRepoError`, `backend/db/test/test-utils.ts:77`); fixtures come only from entity-setup helpers (`backend/db/test/entity-setup.ts` — `createTestStudent` initializes the three paid lanes to 0, `:102-114`; `createTestPlan` exposes `balanceLane` override, `:178`).

**REQ-031** — Journey tests in `test/workflows/` SHALL obey `test/workflows/AGENTS.md`: committed fixtures in one `beforeAll` transaction, tracked hard-delete cleanup with zero-residue re-probe, `jrn_<domain>_<8hex>` prefixes, NO `runInRollback`, spied fan-out transport, per-lane funding profiles via `buildSessionJourneyCast`; executed via `bun run test/scripts/run-test.ts` (never raw `bun test`).

**REQ-032** — GraphQL integration tests SHALL use the dev-server harness with `testClient` (no raw fetch), per existing `backend/graphql/test/session-lifecycle-mutations.test.ts`.

### 2.7 Knowledge Propagation & Closeout

**REQ-033** — WHEN verification passes THEN `docs/planning/PRODUCTION_READINESS.md` §5.3.1–5.3.5 (`:243-248`) SHALL be marked checked with the evidence references produced by this plan.

**REQ-034** — A canonical reference doc `docs/billing/segregated-session-balance.md` SHALL consolidate the lane model (credit lanes vs hold lanes, four-lane vocabulary, guarded-mutation pattern, ratified semantics D1–D4, test map), cross-linking `docs/billing/subscription-purchase.md` and `docs/sessions/session-lifecycle.md`.

**REQ-035** — Before completion, a post-edit review wave SHALL confirm zero plan-scope findings, the deferred-items ledger SHALL contain zero ❌/⚠️, and baseline-vs-final error deltas SHALL be zero.

---

## 3. Cross-Actor Workflow Scenarios (Journeys)

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student | `student` | purchase plans, request sessions, confirm completion | set/alter balances directly, book with zero eligible balance, see other students' data |
| Teacher | `teacher` | confirm completion (consumes the student's hold) | touch balances, book |
| System (webhook) | n/a (provider-signed) | settle pending → active + credit the plan lane | credit twice for one event, credit a NULL/unconfigured lane |
| Admin | `admin` | view balances (admin read surfaces) | invoke student-scoped mutations |

### Journey J1 — Purchase → Activation → Credit (maps to `test/workflows/billing/subscription-purchase.journey.test.ts`)

1. Student → purchases a lane-designated plan → `subscriptions` row `pending` + `student_payments` row `pending` (+ junction link).
2. System → provider-signed confirm webhook → subscription `active`, payment `paid`, **exactly one** `+sessionCount` credit on the plan's lane; other lanes untouched.
3. System → duplicate webhook replay → acknowledged replay: zero additional credit, zero mutation.
4. Denial probe: a NULL-lane plan purchase attempt → rejected `PLAN_LANE_UNCONFIGURED`, zero rows.

### Journey J2 — Request → Hold → Confirm → Consume (maps to `test/workflows/sessions/session-lifecycle.journey.test.ts` / `session-dual-confirmation.journey.test.ts`)

1. Student → requests a session with an eligible lane → one unit debited (trial first), hold recorded on `sessions.held_balance_lane`.
2. Teacher → confirms completion after student confirmation → hold consumed (`fee_held` flips); student balance NOT debited again.
3. Observer checks: the student's three other lanes remain byte-identical through every step.

### Journey J3 — Zero-Balance Denial (maps to `test/workflows/sessions/session-lifecycle-denials.journey.test.ts:236-295`)

1. Student with trial = 0 and intent lane = 0 → requests session → rejected with `INSUFFICIENT_BALANCE`, localized en/ar message, zero writes.
2. Same idempotency key re-submitted after funding the lane → succeeds exactly once.
3. Denial probe: a second student attempts the same key/their own request against the first student's state → no cross-tenant effect; foreign balances byte-identical.

### Journey J4 — Cancel / Timeout → Same-Lane Refund (maps to `session-dual-confirmation.journey.test.ts:561-617`)

1. Student holds a unit, then cancels before confirmation (or the 24h window lapses) → the unit returns to the lane recorded on `sessions.held_balance_lane`.
2. Observer checks: no lane other than the provenance lane ever moves.

### Cross-Actor EARS Criteria

- WHEN the system webhook settles a paid event THEN the student (observer) SHALL see exactly `+sessionCount` on the plan's lane and admins SHALL see the same values on admin read surfaces.
- WHEN the teacher confirms THEN the student (observer) SHALL keep the already-debited balance with no second deduction and see the session completed.
- IF the requesting student lacks eligible balance THEN the system SHALL reject the request AND every other actor SHALL observe zero state change.
- IF a non-participant actor attempts any balance-affecting action THEN the system SHALL deny it through the real authorization path.

## 4. UX/Navigation Requirements

**Explicit no-UI ruling (verified):** this ticket is a backend ledger-behavior ticket. No new route, nav item, or screen is introduced.

| Route | Purpose | Status |
|---|---|---|
| (none new) | — | No new routes |
| `/subscriptions` | Purchase funnel surface | Pre-existing stub: nav entry resolves to the `[feature]` catch-all ComingSoon page (`frontend/views/dashboard/nav/navItems.ts:117-124`, `app/(dashboard)/[feature]/page.tsx:26-30`) — unchanged |
| `students` admin views | Admin sees all four balances | Pre-existing (`AdminStudentDrawerBalancesSection`, `AdminStudentRowCells`) — unchanged |

Role-based access matrix for the GraphQL surface is specified in `plan.md` §3 (permission matrix table). Any student-visible balance read is a forward item (see deferred-items.md D3).

## 5. Non-Functional Requirements

- **Atomicity**: every single-unit debit/credit is one guarded `UPDATE … WHERE …` statement (no read-then-write); activation credit rides the activation transaction; concurrent same-unit claims provably yield exactly one success and one `INSUFFICIENT_BALANCE` (existing chaos test `backend/services/classes/session-lifecycle.service.test.ts:2314-2334`).
- **Idempotency**: webhook replay ⇒ zero double credit; booking idempotency keys survive denial and are reusable after funding.
- **Observability**: domain rejections go through `logger.logDomainError` with structured correlation (`code`, `entity`, `entityId`), debug-level under `TEST_SERVER=1`.
- **Security**: balances are server-computed only; no caller-supplied lane or amount reaches any mutation input.

## 6. Constraints & Assumptions

- Milestone scope: Milestone 1 only; DEV1-006 backend is landed and frozen beneath this plan (extend, never fork).
- The reviews lane has no consumption flow in this milestone — by design (REQ-025).
- DBML is documentation-only; syncing it changes no runtime behavior.
- `PRODUCTION_READINESS.md` checkboxes may be updated only with executed evidence (REQ-033).
- Rule files (`AGENTS.md`, `.agents/instructions/`) are hand-curated and NOT modified by this plan.

## 7. Success Criteria

### Definition of Done

- [ ] Every ticket AC mapped to executing, cited evidence (verification outcome file).
- [ ] Gaps REQ-017/018/021/028 implemented green via the prescribed runners.
- [ ] Ratifications REQ-024..026 recorded and reflected in `docs/billing/segregated-session-balance.md`.
- [ ] `PRODUCTION_READINESS.md` §5.3.1–5.3.5 checked with evidence refs.
- [ ] Zero unresolved ❌/⚠️ in deferred-items.md; baseline deltas zero.

### Acceptance Metrics

- `bun run test:db`, `bun run test:services`, targeted `run-test.ts` journey runs, and the GraphQL integration suite all pass with the new tests included.
- Ticket gherkin scenarios each trace to at least one executed assertion (matrix in the canonical doc).

## 8. Glossary

| Term | Definition |
|---|---|
| **Balance lane** | One segregated integer balance on `students` (`hifz` / `tajweed` / `reviews` / `trial`). |
| **Credit lane** | `SubscriptionCreditLane` (hifz\|tajweed\|reviews) — the purchase-side vocabulary on `plans.balance_lane`. |
| **Hold lane** | `HeldBalanceLane` (trial\|hifz\|tajweed) — the booking-side vocabulary recorded on `sessions.held_balance_lane`. |
| **Hold-as-debit** | Escrow model: the unit is debited at request time and refunded to the same lane on cancel/timeout, consumed at confirmation. |
| **Quarantine** | Activation fail-closed outcome: `{ processed: false }`, zero mutation, correlated error log. |
| **INV-Bx / FR-2.x** | Invariant / functional requirement ids defined in `docs/specs/state-machine-invariants.md` §4.2 and `docs/specs/functional-requirements.md` §2. |
