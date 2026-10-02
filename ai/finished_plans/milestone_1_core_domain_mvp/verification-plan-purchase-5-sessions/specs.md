# Requirements & Specification: DEV2-005 — Verification Plan Purchase (5 Sessions)

> **Date**: 2026-09-11 (Milestone 1)
> **Target Ticket**: `DEV2-005 — Verification Plan Purchase (5 Sessions)` (`docs/planning/TICKETS.md:679-716`)
> **Plan directory**: this directory (under `ai/finished_plans/milestone_1_core_domain_mvp/`; moved from `ai/plans/` on completion)
> **Specs path**: this file
> **Design path**: `plan.md` (this directory)
> **Tasks path**: `tasks.md` (this directory)
> **Deferred-items ledger / Outcome directory**: removed at close-out
> **Blocked By (both FINISHED)**: DEV2-004 (`ai/finished_plans/milestone_1_core_domain_mvp/teacher-applicant-registration-applicant/`), DEV1-006 (`ai/finished_plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/`)
> **Decision Refs (ticket)**: B.8/C.2 (`subscriptions.user_id` generic), FR-3.2, FR-3.3; normative text in `docs/specs/open-decisions-and-gaps.md:105-121,193-197` and `docs/specs/functional-requirements.md:91-99`

---

## 1. Executive Summary & Problem Statement

**Feature:** Let a registered teacher applicant purchase the platform-owned **"New Teacher Verification & Evaluation Plan"** (`sessionCount = 5`) through the SAME subscription/payment spine shipped by DEV1-006. On purchase the system records a pending `subscriptions` row (generic `userId`), a pending `student_payments` ledger row, and an idempotency claim; the applicant's lifecycle row flips `pending|failed → in_evaluation`; a re-application after an expired cooldown increments `verification_attempts`. Applicants inside an active cooldown are rejected with the localized cooldown error (422-VALIDATION family, `APPLICANT_COOLDOWN_ACTIVE`).

**Problem from user perspective:**

- **Teacher Applicant (Ibrahim):** after registration he must be able to pay for and enter the evaluation pipeline from his dashboard — the two card CTAs that today are deliberate no-ops (`frontend/views/teachers/dashboard/ApplicantStatusZones.tsx:25-27,44,80`) become real purchase entry points. After a failed evaluation + expired cooldown he can re-apply, with his attempt counted.
- **Certified Sheikh / platform integrity:** gates must hold at the database boundary — no purchase while cooldown active (INV-TV3, `docs/specs/state-machine-invariants.md:84-90`), no purchase after certification (`applicants.status = 'passed'`).
- **Dev 2 (owner) / DEV2-006 (consumer):** the 5-session evaluation loop booking needs an active verification subscription and `in_evaluation` status as its precondition; both are produced here.
- **Dev 1 (payments owner):** the financial spine (`PaymentGatewayPort`, idempotency claim, webhook activation) is reused unchanged — no forked payment stack.

**Business value:** Activates the teacher-side revenue/verification gate that the M1 demo requires ("applicant can register, purchase verification plan, complete evaluation loop" — `docs/planning/MILESTONE_PLAN.md:118`). Without it the evaluation loop (DEV2-006) has no entry condition.

## 2. Source Ticket (verbatim anchor)

`docs/planning/TICKETS.md:679-716` — Owner: Dev 2, Milestone 1, 3 SP, Blocked By DEV2-004 + DEV1-006. Scope: "verification plan purchase for teacher applicants … specialized plan with session_count=5 … 5 evaluation session credits … same subscription/payment infrastructure as student plans (subscriptions.user_id is generic)." Acceptance criteria: (a) pending applicant purchase → subscription row with the applicant's `user_id`, linked to the verification plan, payment via `student_payments`, `applicants.status → 'in_evaluation'`; (b) applicant in cooldown → rejected 422 "Cooldown active until {cooldown_until}"; (c) expired cooldown → purchase allowed + `verification_attempts` incremented.

---

## 3. Verified Ground-Truth Inventory (grepped 2026-09-11, branch state at HEAD `cd18c0d3`)

Every EXISTING claim below was verified in code; ABSENT items are gaps this plan closes. Labels: **EXISTING** (reuse as-is) · **UPDATE** (touched by this plan) · **CREATE** (new artifact).

| # | Artifact | Verdict | Evidence (verified) |
|---|----------|---------|---------------------|
| G1 | `applicants` table (`id`=shared PK→`users`, `verification_attempts` int default 0, `last_attempt_at`, `cooldown_until`, `status varchar(50)` default `'pending'`, no pgEnum) | EXISTING | `backend/db/schema/teachers/applicants.ts:17-30` |
| G2 | `ApplicantStatus` enum (`Pending/InEvaluation/Failed/Passed`) + `isApplicantStatus` guard + Pothos enum registration | EXISTING | `backend/enum/teachers/applicant-status.enum.ts:12-27`; `backend/graphql/pothos/shared/enum.pothos.ts:109-111` |
| G3 | `ApplicantLifecycleService.assertCanPurchaseVerification(userId, locale, tx?)` — throws `NotFoundError("APPLICANT")` / `ValidationError("APPLICANT_COOLDOWN_ACTIVE", …localized {cooldownUntil}…)`; strict `cooldownUntil > now` | EXISTING (UPDATE — add `Passed` rejection) | `backend/services/teachers/applicant-lifecycle.service.ts:196-228` |
| G4 | `ApplicantLifecycleService.recordReapplication(userId, locale, tx?)` → atomic `verification_attempts + 1` via repo | EXISTING | `backend/services/teachers/applicant-lifecycle.service.ts:241-259`; repo `backend/db/repo/teachers/applicant.repository.ts:212` |
| G5 | Guarded applicant status write `pending|failed → in_evaluation` | **CREATE** (repo method + service composition) | ABSENT — verified by repo-wide grep (`applicant.repository.ts` writes only `create`/`recordVerificationAttempt`/`finalizeOnCertification:384`) |
| G6 | Verification plan seed row: `"New Teacher Verification & Evaluation Plan"`, sessionCount 5, price `150.00` EGP, intervalDays 14, lane `Reviews`, active | EXISTING | `backend/db/seeds/billing/seed-plans.ts:53-59` (title-keyed `seedOrGet`, `:84`) |
| G7 | `SubscriptionPurchaseService.purchase(studentUserId, {planId}, idempotencyKey, locale, outerTx?)` — pending pair + claim + gateway checkout | EXISTING (student-coupled; pattern mirrored, NOT called for applicants) | `backend/services/billing/subscription-purchase.service.ts:529-591` |
| G8 | `student_payments.student_id` NOT NULL FK→`students.id` (restrict) + immutability trigger (`pending → paid|failed`) | **UPDATE** (column → nullable; trigger untouched) | `backend/db/schema/billing/student-payments.ts:34-40` |
| G9 | `subscriptions.user_id` generic Users FK; `payment_reference` partial unique index | EXISTING | `backend/db/schema/billing/subscriptions.ts:28-53` |
| G10 | `subscription_purchase_idempotency` claim table (key UNIQUE, generic `userId`, backfill column) | EXISTING | `backend/db/schema/billing/subscription-purchase-idempotency.ts:24-…`; repo fns `insertClaim:82`, `updateClaimSubscriptionId:106`, `findByKey:136` |
| G11 | Payment gateway port + MOCK adapter only (`PaymentGateway.Paymob` enum member exists; adapter is paymob-plan in-flight, NOT committed) | EXISTING | `backend/types/billing/payment-gateway.types.ts:12-58`; `backend/services/billing/payment-gateway/payment-gateway.factory.ts:45-83`; mock adapter `mock-payment-gateway.adapter.ts` |
| G12 | Webhook route `POST /api/payments/webhook` → `SubscriptionActivationService.processWebhookEvent(event, locale, outerTx?)` | EXISTING (UPDATE — applicant credit-skip branch) | `app/api/payments/webhook/route.ts:288`; service `backend/services/billing/subscription-activation.service.ts:486`; lane credit+abort at `:393-408` |
| G13 | Plan catalog reads (`PlanRepository.findActiveById:156`, `listActive:179`; `PlanCatalogService.coercePlanId`, `listActiveCatalog`) | EXISTING | `backend/db/repo/billing/plan.repository.ts:156,179` |
| G14 | Error taxonomy: `DomainError/NotFoundError/ValidationError(custom code)/ConflictError`; GraphQL carries `extensions.code`; `VALIDATION → 422` mapping is REST-envelope only | EXISTING | `backend/lib/errors.ts:19,37,65,171`; `backend/lib/errors/error-code-taxonomy.ts:41-51`; `docs/graphql/error-handling-contract.md` |
| G15 | Locale keys `errors.applicantNotFound` / `applicantCooldownActive`({cooldownUntil}) / `applicantStatusCorrupt`; `subscriptionPurchase.*` block | EXISTING | `shared/locale/types/errors/labels.ts:29-40,71,79,81`; `shared/locale/en/errors/index.ts:41-43` |
| G16 | Errors key for "already certified" rejection | **CREATE** (`errors.applicantAlreadyCertified`, en+ar+types+parity) | ABSENT (grep-verified) |
| G17 | `getServerTranslations(locale)` is ONE-arg returning the full tree; `useAppTranslation(handle)` takes a `defineNamespace` handle; NO `Translation` enum exists | EXISTING (rules doc correction) | `shared/locale/server-graphql.ts:3`; `shared/locale/client/use-app-translation.ts:8-10`; `shared/locale/namespaces/define-namespace.ts:8` |
| G18 | Applicant dashboard card + zones with deliberate no-op CTAs (`handleReapplyIntent`) | EXISTING (UPDATE — wire CTAs to real purchase) | `frontend/views/teachers/dashboard/ApplicantStatusCard.tsx:61`; `ApplicantStatusZones.tsx:25-27,44,80`; `ApplicantStatusResolution.tsx:63` |
| G19 | GraphQL `purchaseSubscription` mutation — student-only scope; `PurchaseSubscriptionPayload` wrapper | EXISTING (NOT reused by scope; payload object reused) | `backend/graphql/mutation/subscription-purchase.mutation.ts:51-86`; `backend/graphql/pothos/billing/purchase-checkout.pothos.ts:41-100` |
| G20 | `purchaseVerificationPlan` mutation + frontend purchase documents | **CREATE** | ABSENT (grep-verified) |
| G21 | Test fixtures: `createTestApplicant(tx, userId, overrides?)` (pending/0/null defaults), `createTestPlan`, `createTestSubscription`, `createTestStudentPayment`; `runInRollback`, `expectRepoError`; journey helpers (`createJourneyFixtures` includes an `applicant` cast member, `createSessionFixtureRegistry`, `SpiedFanoutTransport`) | EXISTING | `backend/db/test/entity-setup.ts:141-161,178,220,262`; `backend/db/test/test-utils.ts:34,77`; `test/workflows/helpers/` |
| G22 | Journey doc contract: guard + recordReapplication inside purchase tx; `pending → in_evaluation` write owned by this flow | EXISTING (binding contract) | `docs/teachers/applicant-lifecycle.md` §1 `:15-23`, §4 `:101-103`, §6 `:119` |
| G23 | Doc tension: `docs/billing/subscription-purchase.md:369-372` claims "verification purchase rides this exact flow — no special-casing" | CONFLICT (plan amends; schema makes verbatim reuse impossible for applicants) | doctrine vs `student_payments.studentId` NOT NULL FK (G8) |

## 4. Scope

### In Scope
- New zero-argument `purchaseVerificationPlan` GraphQL mutation (identity = `ctx.user.id`; server-resolved verification plan; `X-Idempotency-Key` propagation).
- New `VerificationPurchaseService.purchase` composing: governance check → cooldown guard (shared tx) → verification-plan resolution → gateway checkout (pre-tx) → single tx (idempotency claim + pending `subscriptions` + pending `student_payments` with `studentId = NULL` + conditional attempt increment + guarded `pending|failed → in_evaluation` flip + claim backfill).
- Schema delta: `student_payments.student_id` becomes nullable (owner of a verification payment is the subscription's `user_id`); `bun run db push`.
- `ApplicantRepository.transitionToInEvaluation` (guarded single-statement UPDATE) + `assertCanPurchaseVerification` hardening (reject `Passed`).
- Activation service amendment: applicant-owned subscriptions skip the student lane credit (no abort); notification remains.
- Applicant dashboard purchase entry: wire the two existing no-op CTAs to a confirmation dialog + mutation + snackbar handling (no new route).
- i18n additions: `errors.applicantAlreadyCertified` + `applicant.*` purchase-dialog keys (en+ar+types+parity).
- Tests: repo unit, service 4-tier, activation, GraphQL boundary, journey test (`test/workflows/teachers/`), UI component tests.

### Out of Scope (explicit)
- Cooldown **durations/writes** (`cooldown_until` assignment, 30d/90d rules) → DEV2-008 cooldown state machine (`docs/planning/TICKETS.md:818+`).
- The 5-session booking loop, evaluator distinctness → DEV2-006. Rubric/threshold → DEV2-007. Failed→student conversion → DEV2-009.
- Real Paymob adapter, checkout URL redirect flow, purchase result pages → in-flight `ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/` (mock gateway is the test target).
- Admin surfaces for verification purchases (listing/audit views) → later admin tickets.
- Changing the student `purchaseSubscription` mutation surface (stays student-only; untouched).
- Catalog audience restriction: the active verification plan remains visible in the student catalog (a student could purchase it via `purchaseSubscription`); gating catalog visibility by role is a separate future ticket (ledger D3).

---

## 5. Requirements

### REQ-0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I want a recorded error baseline, an outcome knowledge base, and a deferred-items ledger, so that new issues are distinguishable from pre-existing ones and research is never repeated.

#### Acceptance Criteria
1. WHEN implementation begins THEN the executing agent SHALL record baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) into `outcome/0-baseline-outcome.md`.
2. WHEN any task starts THEN the agent SHALL read ALL files in the plan's `outcome/` directory first (removed at close-out).
3. WHEN any task finishes THEN the agent SHALL write `outcome/<task-id>-outcome.md` and flip the task checkbox `[ ]` → `[x]` in `tasks.md`.
4. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` to exit code 0 (progressive tsgo → oxlint → biome → lint:type-aware → duplicates), and complete the semantic-review checklist (race conditions, env-config, dead code, cross-layer imports, enums) before marking the subtask done.
5. WHEN work is deferred THEN the item SHALL be logged in `deferred-items.md` with source/target task; plan completion REQUIRES zero `❌`/`⚠️` rows.

### REQ-0.5: i18n & Enum Import Compliance (verified real API — template drift corrected)

**User Story:** As a developer, I want all user-facing strings via the compile-time locale system with correct enum imports, so errors surface at build time.

#### Acceptance Criteria
1. WHEN a backend service/resolver needs translations THEN it SHALL call `getServerTranslations(locale)` (ONE argument, full tree) and access `t.errorsTranslations.<key>` / namespace properties — never a two-arg variant (`shared/locale/server-graphql.ts:3`).
2. WHEN a GraphQL resolver needs its locale tree THEN it SHALL use `await ctx.t("errorsTranslations")` (`backend/graphql/gqlContextFactory.ts:46,236`).
3. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(<NamespaceHandle>)` with a `defineNamespace` handle object (e.g. `Applicant` from `shared/locale/namespaces/applicant/applicant.namespace.ts`) and property access (`t.key`) — never string-literal namespaces, never `t('key')` function calls.
4. WHEN a Server Component/page needs translations THEN it SHALL use `getTranslations(locale)` (ONE argument, full tree; `shared/locale/server.ts:15`).
5. WHEN an enum is used in a runtime expression THEN it SHALL be a value import — never `import type`; enum members, never string literals.
6. WHEN a locale key is added THEN `shared/locale/types/<ns>/index.ts` + `shared/locale/en/<ns>/index.ts` + `shared/locale/ar/<ns>/index.ts` SHALL be updated together and the namespace parity test extended (placeholder pins when interpolation is used).

### REQ-1: Verification Plan Catalog Contract

**User Story:** As the platform, I want a single canonical verification plan descriptor, so that purchase, seeding, and UI all reference the same plan.

#### Acceptance Criteria
1. WHEN the system seeds the plan catalog THEN it SHALL contain exactly one active plan titled `"New Teacher Verification & Evaluation Plan"` with `sessionCount = 5` (verified existing row, `backend/db/seeds/billing/seed-plans.ts:53-59`).
2. WHEN the verification purchase service resolves its plan THEN it SHALL look it up server-side from the ACTIVE catalog by the canonical title constant (`shared/constants/verification-plan.constants.ts`) — never from client input.
3. IF the active verification plan row is missing THEN purchase SHALL fail with `NotFoundError("PLAN", …planNotPurchasable)` before any gateway call or database write.
4. WHEN the plan is referenced in tests THEN it SHALL be created via `createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE, sessionCount: VERIFICATION_PLAN_SESSION_COUNT, … })` — never by querying seeded rows.
- **Priority**: High · **Dependencies**: DEV1-006 plan catalog. **Decision refs**: FR-3.2, `docs/billing/plan-catalog.md:84-85`.

### REQ-2: `purchaseVerificationPlan` Mutation Surface

**User Story:** As a teacher applicant, I want a dedicated purchase action, so that I can buy the verification plan without any plan id knowledge.

#### Acceptance Criteria
1. WHEN an unauthenticated caller invokes `purchaseVerificationPlan` THEN the system SHALL reject with the canonical localized `UnauthorizedError` (UNAUTHORIZED channel).
2. WHEN an authenticated caller invokes `purchaseVerificationPlan` THEN the system SHALL resolve identity exclusively from `ctx.user.id`; the mutation carries NO input arguments (no plan id, no user id — BOLA/BOPLA-proof by construction).
3. IF the caller has no `applicants` row THEN the system SHALL reject with `NotFoundError` code `APPLICANT_NOT_FOUND` (service-level gate — non-applicants including pure students/admins can never purchase).
4. WHEN the mutation resolves THEN the response SHALL be the existing `PurchaseSubscriptionPayload` shape: `{ subscription, payment, checkout { provider, providerReference, checkoutUrl } }` (`backend/graphql/pothos/billing/purchase-checkout.pothos.ts:41-100`), reusing `PurchaseSubscriptionReturnType` (`backend/types/billing/subscription.types.ts:51-55`).
5. WHEN the caller supplies `X-Idempotency-Key` THEN it SHALL travel verbatim via `ctx.idempotencyKey` into the service; an absent key SHALL be rejected with `ValidationError` (`subscriptionPurchase.idempotencyKeyRequired`) pre-DB.
6. WHEN the schema changes THEN `bun run generate:gqlSchema && bun codegen` SHALL be run and the generated types committed.
- **Priority**: High · **Dependencies**: REQ-3, REQ-4. **Design rationale**: dedicated mutation keeps `purchaseSubscription` student-only untouched (DEV1-006 contract; the in-flight paymob plan's scope lock re-affirms it).

### REQ-3: Purchase Transaction (Pending Pair + Idempotency)

**User Story:** As the platform, I want the verification purchase to record money identically to student purchases, so that finance/audit has one ledger.

#### Acceptance Criteria
1. WHEN a purchase proceeds THEN the system SHALL open the gateway checkout session BEFORE the database transaction (`getPaymentGateway(locale).createCheckout(...)`, mock adapter default) and SHALL carry the plan row's `price`/`currency` verbatim into the payment row (BOPLA — money never from client).
2. WHEN the purchase transaction runs THEN it SHALL create, in ONE atomic transaction: (a) the idempotency claim row (23505 → `ConflictError("DUPLICATE_REQUEST")` replay; FK-violation → oracle-safe `NotFoundError("PAYMENT", …)`), (b) `subscriptions` row with `userId = applicant's users.id`, `planId = verification plan id`, `status = pending`, (c) `student_payments` row with `studentId = NULL`, `subscriptionId` linked, `amount`/`currency` from the plan, `paymentGateway` from the adapter, `paymentReference` from the checkout session, (d) claim backfill `subscriptionId`.
3. IF any step fails THEN the whole transaction SHALL roll back (zero partial rows).
4. WHEN `student_payments.student_id` accepts NULL THEN the immutability trigger behavior SHALL remain unchanged (`pending → paid|failed` only) and the paired student-junction insert SHALL NOT be attempted for applicants (no `students` row exists by construction).
5. WHEN the flow is called with an `outerTx` (test path) THEN the entire flow SHALL join the caller's transaction (savepoint semantics identical to DEV1-006).
- **Priority**: High · **Dependencies**: REQ-1. **Decision refs**: B.8/C.2 (`user_id` generic), FR-3.2 (payment logged in `student_payments`).

### REQ-4: Applicant Lifecycle Integration (Cooldown Gate + Status Flip)

**User Story:** As the platform, I want cooldown and attempt rules enforced atomically at purchase time, so that re-application timing cannot be gamed.

#### Acceptance Criteria
1. WHEN an applicant purchases THEN `ApplicantLifecycleService.assertCanPurchaseVerification(userId, locale, tx)` SHALL be called with the PURCHASE transaction's `tx` BEFORE any write (TOCTOU closure per `docs/teachers/applicant-lifecycle.md` §4 `:101-103`, §6 `:119`).
2. WHEN the applicant's `cooldown_until` is strictly in the future THEN purchase SHALL be rejected with `ValidationError("APPLICANT_COOLDOWN_ACTIVE", <localized "…{cooldownUntil}…">)` — the ticket's "422 Cooldown active until {cooldown_until}" semantic (VALIDATION family; GraphQL surface carries `extensions.code = "APPLICANT_COOLDOWN_ACTIVE"`).
3. WHEN the applicant's cooldown has expired (`cooldown_until ≤ now`, including exact-now) THEN purchase SHALL proceed (strict `>` boundary is EXISTING behavior; do not re-implement).
4. WHEN a purchase succeeds from status `failed` (re-application) THEN `ApplicantLifecycleService.recordReapplication(userId, locale, tx)` SHALL run inside the same transaction (`verification_attempts + 1`, `last_attempt_at` stamped); purchases from `pending` SHALL NOT increment.
5. WHEN a purchase succeeds from status `pending` OR `failed` THEN `applicants.status` SHALL flip to `in_evaluation` via a GUARDED single-statement UPDATE (`WHERE id = :userId AND status IN ('pending','failed') RETURNING *`); zero rows (already `in_evaluation` — concurrent/repeat purchase) is a silent no-op, not an error.
6. IF the applicant's status is `passed` THEN purchase SHALL be rejected with `ValidationError("APPLICANT_ALREADY_CERTIFIED")` (guard hardening inside `assertCanPurchaseVerification`; new localized key).
7. WHEN any rejection fires THEN zero writes SHALL commit (guard pre-write + single tx).
- **Priority**: High · **Dependencies**: REQ-3. **Decision refs**: INV-TV3 (`docs/specs/state-machine-invariants.md:84-90`), `docs/teachers/applicant-lifecycle.md` §1 `:15-23`, §6 `:119`.

### REQ-5: Activation (Webhook) Integration

**User Story:** As the platform, I want confirmed verification payments to activate the subscription without breaking on the applicant's missing `students` row, so that payment confirmation completes the purchase.

#### Acceptance Criteria
1. WHEN a webhook `confirmed` event arrives for a verification subscription THEN `SubscriptionActivationService.processWebhookEvent` SHALL still run `activatePendingOnce` (zero-row arbiter) and `markPaidOnce` unchanged.
2. WHEN the purchaser has an `applicants` row and NO `students` row THEN the activation SHALL skip the lane credit (no `StudentRepository.creditLaneBalance` call, no abort) and SHALL otherwise complete (subscription `active`, payment `paid`).
3. WHEN the purchaser has a `students` row THEN lane crediting SHALL behave exactly as today (regression-proof).
4. IF neither a `students` row nor an `applicants` row exists for the purchaser THEN the existing fail-closed abort SHALL fire (corruption detector preserved).
5. WHEN activation succeeds THEN the existing `payment_confirmation` notification SHALL still persist in-tx and publish post-commit to the purchasing user (`subscription.userId`), unchanged in shape.
6. WHEN a `failed` webhook arrives for a verification subscription THEN the existing failed branch SHALL run unchanged (subscription stays `pending`; applicant status retains its purchase-time value — documented posture, no new compensation).
- **Priority**: High · **Dependencies**: REQ-3, REQ-4. **Note**: the status flip already occurred at purchase time (REQ-4); activation owns money finality + notification only.

### REQ-6: Applicant Purchase UI Entry Point

**User Story:** As a teacher applicant, I want to buy the verification plan from my dashboard status card, so that I never hunt for a hidden page.

#### Acceptance Criteria
1. WHEN a `pending` applicant views `/teacher/dashboard` THEN the existing prompt panel SHALL offer a working "purchase" CTA and WHEN a `failed` applicant is cooldown-eligible (`canPurchaseVerification = true`) THEN the re-apply CTA SHALL be enabled — both opening the new verification-purchase confirmation dialog (replacing the no-op `handleReapplyIntent` at `ApplicantStatusZones.tsx:25-27`).
2. WHEN the dialog opens THEN it SHALL display the resolved plan's title, session count (5), price, currency, and interval, sourced from the `planCatalog` query matched on `VERIFICATION_PLAN_TITLE` (`backend/graphql/query/plan-catalog.query.ts:18` is authenticated-any-role).
3. WHEN the applicant confirms THEN the UI SHALL execute `purchaseVerificationPlan` via `useMutation` from `@apollo/client/react` with a per-attempt `x-idempotency-key` context header (pattern: `frontend/views/admin/broadcasts/useBroadcastComposeSend.ts:49`) that survives domain rejections and rotates only on success.
4. WHEN the mutation succeeds THEN the UI SHALL refetch `myApplicantProfileQueryDocument` (`frontend/graphql/sharedDocuments/teachers/applicant.documents.ts:24`) — the card re-renders `in_evaluation` — and show a localized success snackbar (`NoticeSnackbar`, `frontend/components/ui/NoticeSnackbar.tsx:22`).
5. WHEN the mutation fails THEN the UI SHALL branch on `extensions.code` (`extractErrorCode`, `frontend/lib/graphql-error-utils.ts:17`): `APPLICANT_COOLDOWN_ACTIVE` → refetch profile + show the SERVER message; `DUPLICATE_REQUEST` → treat as already-received (info); otherwise → generic localized error snackbar. Raw server messages are never rendered except the cooldown copy (already localized server-side).
6. WHERE the gateway is the mock adapter (`checkout.checkoutUrl === null`) THEN no redirect SHALL be attempted (Paymob redirect lands in the paymob plan, not here).
- **Priority**: Medium · **Dependencies**: REQ-2. **Nav note**: NO new route/sidebar/bottom-nav item — entry point is the existing dashboard card slot (`RoleDashboardPage` → `ApplicantStatusCard`).

### REQ-7: i18n Additions (errors + applicant UI)

**User Story:** As a user, I want all new purchase copy localized in en and ar with parity tests.

#### Acceptance Criteria
1. WHEN the service rejects a certified applicant THEN the message SHALL come from a new `errors.applicantAlreadyCertified` key (en + ar).
2. WHEN the purchase dialog renders THEN all copy SHALL come from new keys under the `applicant` namespace (proposal: `purchaseDialogTitle`, `purchasePlanLine(title, price, currency, sessions, days)`, `purchaseConfirmCta`, `purchaseCancelCta`, `purchaseSuccess`, `purchaseGenericError`).
3. WHEN keys land THEN the `errors` and `applicant` parity tests SHALL stay green and pin the new placeholders (e.g. exactly one `{cooldownUntil}`-style rule extended for the dialog line).
- **Priority**: High (user-facing) · **Dependencies**: none structural.

### REQ-8: Testing (4-Tier + Journey)

**User Story:** As the platform team, I want layered proof that the purchase contract holds.

#### Acceptance Criteria
1. WHEN the repo transition lands THEN `backend/db/test/repo/teachers/` tests SHALL cover: pending→in_evaluation, failed→in_evaluation, zero-row no-op for `in_evaluation`/`passed`, and `studentId = NULL` payment inserts — all inside `runInRollback` with `tx` propagation and `expectRepoError` (never `rejects.toThrow`).
2. WHEN the service lands THEN `backend/services/teachers/verification-purchase.service.test.ts` SHALL cover Tier 1-4: happy path (attempts stay 0 on first purchase), cooldown-active rejection (zero writes verified), expired-cooldown re-application (attempts +1, `failed → in_evaluation`), certified rejection, non-applicant rejection, missing/foreign/duplicate idempotency key replay, missing plan, gateway-throw rollback, concurrent double-purchase (`Promise.allSettled`, pglite-gated skip), unicode/RTL fuzz on localized assertions.
3. WHEN activation changes THEN activation tests SHALL prove: applicant confirmation skips credit without abort, student regression intact, corrupt purchaser still aborts, notification still emitted to `subscription.userId`.
4. WHEN the GraphQL boundary ships THEN integration tests (`frontend/graphql/test/teachers/verification-plan-purchase.test.ts`, `setupTestServerLifecycle` + `testClient`) SHALL pin anonymous → UNAUTHORIZED, non-applicant → `APPLICANT_NOT_FOUND`, missing key → VALIDATION (happy path owned by service/journey layers to avoid seed dependency).
5. WHEN the journey lands THEN `test/workflows/teachers/verification-plan-purchase.journey.test.ts` SHALL execute the Section-6 journey end-to-end: real actors, committed fixtures + tracked hard-delete `afterAll`, NO `runInRollback`, notification spy assertions, denial probes — via `bun run test/scripts/run-test.ts`.
- **Priority**: High · **Dependencies**: all implementation REQs.

### REQ-9: Security, Tenancy & Financial Integrity (Non-Functional)

**User Story:** As the platform, I want the purchase boundary hardened against abuse, so that money and identities stay safe.

#### Acceptance Criteria
1. WHEN any caller invokes the mutation THEN identity SHALL come from `ctx.user.id` only (BOLA); the wire input carries zero owned fields (BOPLA: nothing to mass-assign).
2. WHEN a non-applicant role (student/parent/admin/supervisor) attempts purchase THEN the service-level applicant gate SHALL reject with `APPLICANT_NOT_FOUND` (BFLA: no privilege gain possible; the surface grants nothing beyond self-purchase).
3. WHEN the same idempotency key is replayed by the same caller THEN `DUPLICATE_REQUEST` (409-family) SHALL surface with zero new writes; WHEN the key belongs to another user THEN oracle-safe `PAYMENT_NOT_FOUND` SHALL surface.
4. WHEN money is written THEN `amount`/`currency` SHALL originate exclusively from the DB plan row inside the transaction.
5. WHEN the cooldown gate runs THEN it SHALL run inside the purchase transaction (TOCTOU closure; advisory-guard caveat of DEV2-004 satisfied).
6. WHEN errors are logged THEN domain rejections SHALL use `logger.logDomainError` with `entity`/`entityId`/`locale` context and SHALL NOT log the idempotency key material.
7. WHEN concurrent purchases race (distinct keys) THEN behavior SHALL match DEV1-006 posture: two pending pairs may be created (idempotency is per-key); the status flip's guarded UPDATE keeps the applicant row consistent under row lock; the double-increment exposure on racing re-applications is documented as accepted consistent-with-students posture (`plan.md` §Concurrency).
8. WHEN new code handles search/user input THEN wildcard escaping and parameterization rules apply (no new search surfaces planned; listed for SEC checklist completeness).

---

## 6. Cross-Actor Workflow Scenario (Journey)

### J1: Verification Purchase & Activation
**File:** `test/workflows/teachers/verification-plan-purchase.journey.test.ts`

#### Actor Table
| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Applicant A (fresh) | `teacher` + applicants row (`pending`) | purchase; becomes `in_evaluation` | purchase while cooldown active; purchase after `passed` |
| Applicant B (cooldown active) | `teacher` + applicants row (`failed`, `cooldownUntil` future) | — | purchase (422/`APPLICANT_COOLDOWN_ACTIVE`) |
| Applicant C (cooldown expired) | `teacher` + applicants row (`failed`, `cooldownUntil` past) | re-purchase (attempts +1, back to `in_evaluation`) | — |
| System (webhook) | — | confirm payment → activate + notify | credit a lane for applicant purchasers |
| Student (non-applicant) | `student` | — | purchase verification plan (`APPLICANT_NOT_FOUND`) |

#### Ordered Step List
1. System → seeds fixture: verification plan via `createTestPlan` (title `VERIFICATION_PLAN_TITLE`, `sessionCount: 5`), actors via `createTestUser`+`createTestApplicant` / journey cast helpers, all tracked for teardown.
2. Applicant A → `VerificationPurchaseService.purchase(...)` → subscription `pending` + payment `pending` (`studentId NULL`) + claim backfilled; `applicants.status = in_evaluation`; `verification_attempts` unchanged (0).
3. System → `processWebhookEvent(confirmed, "en")` → subscription `active`, payment `paid`, NO lane credit attempted, zero abort; `payment_confirmation` notification persisted & published to Applicant A only (spy on the publish boundary).
4. Applicant B → purchase attempt → `APPLICANT_COOLDOWN_ACTIVE` (translated message asserted via `getServerTranslations("en").errorsTranslations`); DB unchanged (row-count deltas zero).
5. Applicant C → purchase → success; `verification_attempts = 1`; `failed → in_evaluation`.
6. Student → purchase attempt → `APPLICANT_NOT_FOUND`; student's rows untouched.
7. (Denial/visibility) Foreign actor reads/writes against another actor's purchase → authorization resolves honestly; no cross-tenant leakage.
8. System → `afterAll` hard-deletes all tracked ids (immutability triggers suspended for the payment ledger), re-probes each id → zero residue.

#### Cross-Actor EARS Criteria
1. WHEN Applicant A completes purchase THEN the system SHALL create the pending `subscriptions`+`student_payments` pair AND flip `applicants.status` to `in_evaluation` observable via `myApplicantProfile`.
2. WHEN the webhook confirms THEN the system SHALL activate the subscription AND notify only Applicant A — other cast members' notification counts SHALL NOT change.
3. WHEN Applicant B attempts purchase THEN the system SHALL reject with `ValidationError("APPLICANT_COOLDOWN_ACTIVE")` containing the formatted expiry — and SHALL write nothing.
4. WHEN Applicant C re-applies after cooldown THEN the system SHALL increment `verification_attempts` by exactly 1 and return the applicant to `in_evaluation`.
5. IF a non-applicant (student) attempts purchase THEN the system SHALL reject with `APPLICANT_NOT_FOUND` and zero side effects.

---

## 7. UX / Navigation Requirements

**Ruling: NO new routes, NO sidebar changes, NO bottom-nav changes.** The entry point already exists and is mounted: `frontend/views/dashboard/home/RoleDashboardPage.tsx:53` renders `ApplicantStatusCard` for role Teacher on `/teacher/dashboard`; the card's zones contain the purchase CTAs.

### Routes & Role-Based Access
| Route | Purpose | Guard | Roles |
|-------|---------|-------|-------|
| `/teacher/dashboard` (EXISTING) | Hosts `ApplicantStatusCard` purchase entry | `withPageAuth({ roles: [UserRole.Teacher] })` (existing); pattern at `frontend/lib/auth/withPageAuth.ts:67` | TEACHER only (others redirected by existing page auth) |
| (new) — none | Dialog lives inside the card tree | — | — |

### Sidebar / Navigation Integration
| Aspect | Decision |
|---|---|
| New sidebar items | NONE (`frontend/views/dashboard/nav/navItems.ts:125-132` unchanged) |
| Mobile bottom nav | N/A — project has no bottom nav (responsive `Drawer` only) |
| GraphQL scope note | `purchaseVerificationPlan` = `authenticated` scope + service-level applicant gate (role scope deliberately NOT teacher-only: post-conversion re-appliers (DEV2-009) may hold `role: student` while retaining an applicants row — gating by role would lock future re-application); service gate keeps the effective audience identical |

### Role-Based Access Matrix
| Role | `/teacher/dashboard` card | `purchaseVerificationPlan` |
|------|---------------------------|----------------------------|
| SUPER_ADMIN / ACADEMY_ADMIN | N/A (different dashboard) | `APPLICANT_NOT_FOUND` |
| SUPERVISOR / STAFF | N/A | `APPLICANT_NOT_FOUND` |
| TEACHER (applicant) | Full purchase entry | allowed (cooldown/status rules apply) |
| TEACHER (certified, `passed`) | `certifiedSummary` surface | `APPLICANT_ALREADY_CERTIFIED` |
| STUDENT / PARENT | N/A | `APPLICANT_NOT_FOUND` |
| GUEST | login redirect (existing page auth) | UNAUTHORIZED |

### Per-Audience Rendering
| Audience | Rendering |
|----------|-----------|
| Applicant pending | Prompt + purchase CTA opens confirmation dialog |
| Applicant `failed` + cooldown active | Disabled CTA + formatted `cooldownExpiryLine` (EXISTING) |
| Applicant `failed` + expired | Enabled re-apply CTA → same dialog (attempt will increment) |
| Applicant `in_evaluation` | In-evaluation hint (EXISTING), CTA not offered |
| Everyone else | No change |

## 8. Non-Functional Requirements

- **Performance**: purchase adds ≤ 2 in-tx reads (applicant row: guard read + transition) and ≤ 1 pre-tx catalog list read over DEV1-006's flow; no N+1; `planCatalog` dialog read uses the existing authenticated query.
- **Reliability**: gateway call precedes the tx (network fault leaves zero rows); replay-by-throwing keeps retries safe; `outerTx` support preserved for tests/composition.
- **Observability**: `logger.logDomainError` on every enumerated rejection (code, entity, entityId, locale); no happy-path logging; no idempotency-key material in logs.
- **Localization**: all new user-facing copy en+ar with parity pins; RTL-safe dialog layout (MUI + theme).
- **Compatibility**: `bun run db push` handles the nullable-column delta; no data migration (no verification payments exist yet).

## 9. Constraints & Assumptions

- Mock payment gateway only (`PAYMENT_GATEWAY_PROVIDER=mock` default; `GATEWAY_ADAPTERS` registry holds `mock` only — `payment-gateway.factory.ts:45-47`). Paymob is an in-flight plan; DEV2-005 codes against the stable `PaymentGatewayPort` and notes the A1–A3 amendment churn risk (`ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/deferred-items.md`).
- Cooldown durations/writers are owned by DEV2-008; this ticket is duration-agnostic and read-only over `cooldown_until` (guard) per `docs/teachers/applicant-lifecycle.md` §2.4 `:69-71`.
- FR-3.2's literal `subscriptions.teacher_id` schema text is stale; B.8/C.2 (`subscriptions.user_id` generic) supersedes (`docs/specs/open-decisions-and-gaps.md:117-121,193-197`).
- The ticket's "422" is the VALIDATION/REST-envelope mapping; the GraphQL wire contract is HTTP 200 + `errors[].extensions.code` (`docs/graphql/error-handling-contract.md`). Client assertions target `extensions.code`.
- Test database is never seeded-trusted: fixtures create their own plan row (REQ-1.4), matching the repo's "never query seed data" rule.

## 10. Success Criteria

- [ ] Applicant purchases → pending pair persisted (`student_payments.student_id` NULL, subscription `user_id` = applicant) + `status = in_evaluation`, attempts unchanged.
- [ ] Cooldown-active purchase → `APPLICANT_COOLDOWN_ACTIVE`, zero writes.
- [ ] Expired-cooldown re-purchase → attempts `+1`, `failed → in_evaluation`.
- [ ] Webhook confirm → active/paid, no lane-credit abort, notification to purchaser only.
- [ ] Non-applicant/anonymous denied honestly at the boundary.
- [ ] UI: both CTAs functional; success flips the card without reload; new copy localized en+ar.
- [ ] `bun quality-gate` green on all touched files; all new tests green via the approved runners; journey zero-residue teardown.
- **Traceability**: every `REQ-*` id above is referenced by at least one task in `tasks.md`.

## 11. Glossary

| Term | Definition |
|------|------------|
| Verification plan | The seeded catalog plan `"New Teacher Verification & Evaluation Plan"` (`sessionCount=5`) granting evaluation-session eligibility |
| Applicant | A `users` row (role teacher) with an `applicants` row; not yet a `teacher` record (B.7) |
| Cooldown | `applicants.cooldown_until` written by the cooldown state machine ticket; purchase gate when strictly future |
| Pending pair | The atomic `subscriptions(pending)` + `student_payments(pending)` couplet created at purchase (DEV1-006 pattern) |
| Claim | `subscription_purchase_idempotency` row keyed by `X-Idempotency-Key`; 23505 → `DUPLICATE_REQUEST` |

## 12. Deferred & Boundary Items (seed ledger)

See `deferred-items.md` for the live ledger. Seeded entries: **D1** payment-failed status posture (`in_evaluation` retained; re-purchase allowed), **D2** paymob port churn watch (`ai/plans/milestone_1_core_domain_mvp/paymob-gateway-integration/deferred-items.md`), **D3** student-catalog exposure of the verification plan, **D4** lane-credit skip hand-off to DEV2-006, **D5** stale root-AGENTS.md i18n/logger bullets (report-only). The `docs/billing/subscription-purchase.md:369-372` drift is FIXED by Task 13, not deferred.
