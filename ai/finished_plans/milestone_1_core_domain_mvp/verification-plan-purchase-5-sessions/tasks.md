# Tasks: DEV2-005 — Verification Plan Purchase (5 Sessions)

> **Date**: 2026-09-11 · **Plan directory**: this directory (under `ai/finished_plans/milestone_1_core_domain_mvp/`; moved from `ai/plans/` on completion)
> **Specs**: `./specs.md` · **Design**: `./plan.md` · Ledger and outcome files removed at close-out

## Non-Negotiable Execution Protocol (every task)

1. Read ALL files in the plan's `outcome/` directory before starting (removed at close-out).
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 (progressive tsgo → oxlint → biome → lint:type-aware → duplicates; auto-prints the applicable AGENTS.md + .agents/instructions files — read them).
3. Semantic self-review before `[x]`: tenancy filters, no read-then-write without atomicity, no unbounded module state, env-config keys registered, enums as value imports, no cross-layer imports, no noisy comments, no plan-artifact references in code/JSDoc.
4. Write `outcome/<task-id>-outcome.md`; flip the checkbox here.
5. Never `console.*` — `logger` from `@/backend/lib/logger` / `@/frontend/lib/logger`. Never raw `bun test` for a single file — use `bun run test/scripts/run-test.ts <path>`.
6. Deferrals go to `deferred-items.md` immediately.

## Layer → Rule Files (this repo — absolute paths)

| Layer | AGENTS.md | Instructions |
|-------|-----------|--------------|
| Root | `/home/ahmed/Projects/kottaby_kottaby/AGENTS.md` | — |
| Schema | `backend/db/schema/AGENTS.md`, `backend/AGENTS.md` | `.agents/instructions/backend.instructions.md` |
| Repos | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| DB tests | `backend/db/test/AGENTS.md` (if present, per sub-loop output), `backend/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| Services | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| GraphQL | `backend/graphql/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| Types/Enums | `backend/types/AGENTS.md` / `backend/enum/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| Shared locale/constants | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | — |
| Frontend views/graphql | `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md` | `frontend.instructions.md` |
| App router | `app/AGENTS.md` | `frontend.instructions.md` |
| Journeys | `test/workflows/AGENTS.md` | `tests.instructions.md` |
| UI tests | `test/ui/AGENTS.md` | `tests.instructions.md` |

(Under `.agents/instructions/`; prefix every path with `/home/ahmed/Projects/kottaby_kottaby/`. sub-loop.ts prints the authoritative list per file.)

## Drizzle Convention (binding)
- Schema change (`student_payments.student_id` nullable): `bun run db push`. Custom SQL migrations are NOT used for this.

---

## Task 0 — Pre-Implementation Baseline

- [x] 0. Record error baselines BEFORE any change
  - `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`
  - `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`
  - `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Write `outcome/0-baseline-outcome.md` with the three counts.
  - _Requirements: REQ-0_

## Phase 1.5 — Plan Review Gate (MANDATORY)

- [x] 1.5 Review the complete plan (specs/plan/tasks) with the `@plan-review` checklist; fix all violations; record in `outcome/plan-review-R1.md`
  - Verdict + findings ledger lived in `outcome/plan-review-R1.md` (removed at close-out).
  - _Requirements: REQ-0_

---

## Phase 2 — Backend Foundation

- [x] 1. **Nullable payment owner + type ripple audit**
  - Files: `backend/db/schema/billing/student-payments.ts` (drop `.notNull()` on `studentId` ~:38-40); run `bun run db push`.
  - Widen `StudentPaymentRepository.insertPayment` input (`backend/db/repo/billing/student-payment.repository.ts:92`) and any payment insert contract to `studentId: number | null`.
  - Audit NULL-context consumers of `StudentPaymentSelectType.studentId` (admin views, queries, codegen types); fix ONLY nullability compile errors — no behavior changes.
  - [x] 1.QL `bun run scripts/health/sub-loop.ts backend/db/schema/billing/student-payments.ts --lifecycle duplicates` + same for each edited file (exit 0)
  - [x] 1.TE Repo test (in `backend/db/test/logic/billing/student-payment.repository.test.ts` or colocated repo test): insert with `studentId = NULL` succeeds; existing non-null inserts unchanged; immutability trigger still blocks deletes. `runInRollback` + `tx` everywhere; `expectRepoError` for denials.
  - [x] 1.SEC NULL owner never widens read scope; no predicate change that hides student_id IS NULL rows from admins.
  - [x] 1.SR Checklist: no cross-layer imports; db push generated SQL matches intent (review the push diff).
  - [x] 1.IV Read printed AGENTS/instruction files; validate.
  - _Requirements: REQ-3.2, REQ-3.4, REQ-9_

- [x] 2. **Applicant transition write + guard hardening**
  - Files: `backend/db/repo/teachers/applicant.repository.ts` (add `transitionToInEvaluation(userId, tx?)` — guarded single-statement UPDATE `SET status='in_evaluation', updated_at=now() WHERE id=$1 AND status IN ('pending','failed') RETURNING *`, `null` on miss); `backend/services/teachers/applicant-lifecycle.service.ts:196-228` (add `status === ApplicantStatus.Passed` rejection with `ValidationError("APPLICANT_ALREADY_CERTIFIED", t.applicantAlreadyCertified)` + `logDomainError`; `ApplicantStatus` as VALUE import).
  - i18n: `errors.applicantAlreadyCertified` → `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts`; extend `shared/locale/errors-namespace.parity.test.ts` pins.
  - [x] 2.QL sub-loop `--lifecycle duplicates` on every edited file → exit 0
  - [x] 2.TE `backend/db/test/repo/teachers/applicant.repository.transition.test.ts`: pending→flip, failed→flip, zero-row no-op for in_evaluation/passed, nonexistent id → null. Guard tests appended to `backend/services/teachers/applicant-lifecycle.service.test.ts`: passed → code + translated message via `getServerTranslations("en").errorsTranslations.applicantAlreadyCertified`; existing cooldown cases stay green. Tiers 1-4 (boundary timestamp, concurrency via Promise.allSettled on transition, unicode names).
  - [x] 2.SEC Guarded UPDATE folds state into WHERE (no SELECT-then-UPDATE); zero-row handled; no new read surfaces.
  - [x] 2.SR No module state; no env-config additions needed; enums as value imports.
  - [x] 2.IV Read printed rule files; validate.
  - _Requirements: REQ-4.1-4.3, REQ-4.5, REQ-4.6, REQ-7.1, REQ-0.5, REQ-8.1_

- [x] 3. **Shared verification-plan constants**
  - Files: CREATE `shared/constants/verification-plan.constants.ts` (`export const VERIFICATION_PLAN_TITLE = "New Teacher Verification & Evaluation Plan" as const;` + `export const VERIFICATION_PLAN_SESSION_COUNT = 5 as const;`); register in `shared/constants/index.ts` barrel (`export * from "./verification-plan.constants"`).
  - UPDATE `backend/db/seeds/billing/seed-plans.ts:53-59` to source those fields from the constants (title, sessionCount) — prevents drift.
  - [x] 3.QL sub-loop per file (constants + barrel + seed) → exit 0
  - [x] 3.TE Extend `backend/db/test/logic/billing/plan-seed.test.ts` (or add a constants unit test): seeded plan carries the constant values; `sessionCount === 5` pinned (ticket's "Verification plan has exactly 5 sessions").
  - [x] 3.SEC Constants are read-only data; no env coupling.
  - [x] 3.SR `shared/` imports nothing from frontend/backend; barrel conventions honored.
  - [x] 3.IV Read printed rule files; validate.
  - _Requirements: REQ-1.1-1.4_

---

## Phase 3 — Journey-First Service Implementation

- [x] 4. **Journey test FIRST (red)**
  - CREATE `test/workflows/teachers/verification-plan-purchase.journey.test.ts` implementing specs §6/J1 steps 1-8: cast via `createJourneyFixtures(prefix)` (includes an `applicant`) plus additional `createTestApplicant` rows for the cooldown/expired cases; plan fixture via `createTestPlan(tx, { title: VERIFICATION_PLAN_TITLE, sessionCount: 5, balanceLane: SubscriptionCreditLane.Reviews, price: "150.00", intervalDays: 14, isActive: true })`; webhook confirmation via direct `SubscriptionActivationService.processWebhookEvent(event, "en")` call; notification assertion via `spyOn(NotificationEngine, "publishReceipts")`; committed fixtures, UUID prefix `jrn_teacherverify_${randomUUID().slice(0,8)}`, tracked `afterAll` hard-deletes (`withImmutabilityTriggersSuspended` for `student_payments`), zero-residue re-probes.
  - Runs RED until Tasks 5-6 land (TDD gate) — do NOT silence with skips.
  - [x] 4.QL sub-loop on the new test file → exit 0 (compile-clean even while red)
  - [x] 4.TE The file IS the Tier coverage for the cross-actor flow (denial probes mandated by `test/workflows/AGENTS.md`).
  - [x] 4.SEC Honest authorization (real roles; no monkey-patching); foreign-actor denial probe included.
  - [x] 4.SR No `runInRollback`; translated-string assertions only.
  - [x] 4.IV Read `test/workflows/AGENTS.md` + `tests.instructions.md`; validate.
  - Run: `bun run test/scripts/run-test.ts test/workflows/teachers/verification-plan-purchase.journey.test.ts`
  - _Requirements: REQ-8.5, REQ-9.2, REQ-4, REQ-5_

- [x] 5. **`VerificationPurchaseService.purchase`** (turns the journey green for purchase)
  - CREATE `backend/services/teachers/verification-purchase.service.ts` per `plan.md` §4.3 EXACTLY (steps 1-8: guards → plan resolve → gateway pre-tx → single tx claim+pair+increment+flip+backfill); export via `backend/services/teachers/index.ts` (and ensure surfaced by `@/backend/services` barrel if needed).
  - Extract shared guards FIRST: `isPositiveSafeId` + `isCarryableIdempotencyKey` are module-private at `backend/services/billing/subscription-purchase.service.ts:109,120` — promote them into a NEW `backend/services/billing/purchase-guards.helpers.ts`, export from there, and update `subscription-purchase.service.ts` to import them (behavior-preserving refactor; no copies — jscpd would flag a duplicate). `withTransaction` comes from `@/backend/lib/db/with-transaction`; `assertActorGovernanceClean` from `@/backend/services/classes/session-lifecycle.governance` (dev1-006 import at `subscription-purchase.service.ts:78`).
  - [x] 5.QL sub-loop on service + barrel → exit 0
  - [x] 5.TE CREATE `backend/services/teachers/verification-purchase.service.test.ts` (mirrors `subscription-purchase.service.test.ts` patterns incl. `spyOn(MockPaymentGatewayAdapter.prototype, "createCheckout")` seam and its suite-local `expectDomainDenial` helper — declare an equivalent suite-local helper here (it is NOT a shared export; note: a same-named local lives in `test/workflows/sessions/recitation-record.journey.test.ts:161`); `expectRepoError` for DB denials): happy path (pending pair with NULL owner, flip pending→in_evaluation, attempts=0, claim backfilled); cooldown-active → `APPLICANT_COOLDOWN_ACTIVE` + zero rows; expired cooldown + failed → attempts+1 + flip; passed → `APPLICANT_ALREADY_CERTIFIED`; non-applicant → `APPLICANT_NOT_FOUND`; missing key → VALIDATION; replay → `DUPLICATE_REQUEST` zero new rows; foreign key → `PAYMENT_NOT_FOUND`; missing plan → `PLAN_NOT_FOUND`; gateway-throw → zero rows (pre-tx boundary); concurrent double key-race (`Promise.allSettled`, `isPgliteProvider()` gate); unicode fuzz on localized asserts.
  - [x] 5.SEC BOLA (identity param only, callers pass `ctx.user.id`), BOPLA (no input object at all), BFLA (service gate), no key logging.
  - [x] 5.SR Atomicity (all writes in one tx; guard in-tx), no module state, enums as values, no dead branches.
  - [x] 5.IV Read printed files; validate.
  - Run: `bun run test/scripts/run-test.ts backend/services/teachers/verification-purchase.service.test.ts`
  - _Requirements: REQ-2.5, REQ-1.2, REQ-3, REQ-4, REQ-8.2_

- [x] 6. **Activation credit-skip branch**
  - UPDATE `backend/services/billing/subscription-activation.service.ts` confirmed branch (:381-408 covers decision→credit; exact credit+abort block at :393-408) per `plan.md` §4.4: students-row-first probe → credit + existing abort; applicants-row probe → skip credit (verification subscription); neither → existing abort. Notification emission unchanged.
  - [x] 6.QL sub-loop → exit 0
  - [x] 6.TE Extend `backend/services/billing/subscription-activation.service.test.ts`: applicant-owned confirmation (no credit, no abort, active+paid, notification to purchaser); student regression (credit unchanged); corrupt purchaser (neither row) → abort preserved; failed branch unchanged for verification subscriptions.
  - [x] 6.SEC Credit-skip cannot be reached for student purchasers (probe order); no notification fan-out change.
  - [x] 6.SR `ApplicantRepository` import via barrel; no business logic drift into repo.
  - [x] 6.IV Read printed files; validate.
  - Run: `bun run test/scripts/run-test.ts backend/services/billing/subscription-activation.service.test.ts`
  - _Requirements: REQ-5.1-5.6, REQ-8.3_

- [x] 7. **`purchaseVerificationPlan` GraphQL mutation**
  - CREATE `backend/graphql/mutation/verification-plan-purchase.mutation.ts` (`plan.md` §4.5: inputless, `authScopes: { authenticated: true }`, delegates to `VerificationPurchaseService.purchase(ctx.user.id, ctx.idempotencyKey ?? null, ctx.locale)`); register side-effect import in `backend/graphql/mutation/index.ts` AND extend that barrel's header docblock (it narrates each wired file — add the verification line so the header never drifts).
  - Run `bun run generate:gqlSchema && bun codegen` (commit generated changes).
  - [x] 7.QL sub-loop per file → exit 0
  - [x] 7.TE CREATE `frontend/graphql/test/teachers/verification-plan-purchase.test.ts` (`describeGraphqlSuite`, `setupTestServerLifecycle`, `testClient`; register/login like `frontend/graphql/test/teachers/applicant-profile.test.ts:109-190`): anonymous → UNAUTHORIZED; student (non-applicant) w/ key → `APPLICANT_NOT_FOUND`; applicant w/o key → VALIDATION key-required; happy-path purchase covered by service+journey (no seed dependency).
  - [x] 7.SEC authScope + narrowing guard exactly as DEV1-006 pattern; errors propagate uncaught to masking boundary.
  - [x] 7.SR No local types; payload object reused; barrel wiring per `backend/graphql/mutation/AGENTS.md`.
  - [x] 7.IV Read printed files; validate.
  - _Requirements: REQ-2.1-2.6, REQ-8.4, REQ-9_

### Phase 2.5 — Mid-Point Backend Review Gate (>10 tasks, backend/frontend split ⇒ MANDATORY)

- [x] 8. **Backend review wave + fixes**
  - Dispatch review subagents scoped to backend files of Tasks 1-7 (schema/repo/service/activation/mutation/locale): `review-backend`, `review-types`, plus error/i18n spot-check.
  - Fix findings per file; each fix re-runs `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0).
  - Re-review until zero backend findings; write `outcome/midpoint-review-R1.md`.
  - _Requirements: REQ-0_

---

## Phase 4 — Frontend

- [x] 9. **Purchase documents + dialog + CTA wiring + copy**
  - CREATE `frontend/graphql/sharedDocuments/billing/verification-purchase.documents.ts`: `purchaseVerificationPlanMutationDocument` (`mutation purchaseVerificationPlan { subscription { id status planId … } payment { id amount currency status … } checkout { provider providerReference checkoutUrl } }` — `id` on every object; `TypedDocumentNode` types from codegen; exported through `billing/index.ts`).
  - CREATE `frontend/views/teachers/dashboard/VerificationPurchaseDialog.tsx` per `plan.md` §6 (planCatalog query + title constant, confirm/cancel, per-attempt idempotency key header, NoticeSnackbar feedback, `extractErrorCode` branching).
  - UPDATE `frontend/views/teachers/dashboard/ApplicantStatusZones.tsx` — both CTAs open the dialog; on success refetch `myApplicantProfileQueryDocument`.
  - i18n `applicant` keys: types + en + ar + parity pins (REQ-7.2).
  - [x] 9.QL sub-loop per file → exit 0
  - [x] 9.TE component tests: dialog renders plan line (AR snapshot too), confirm mutation success → refetch + success snackbar; `APPLICANT_COOLDOWN_ACTIVE` → server message + refetch; `DUPLICATE_REQUEST` → info; generic error path; RTL render.
  - [x] 9.SEC No raw server messages rendered except the localized cooldown copy; key rotation policy implemented.
  - [x] 9.SR MUI v9 `sx`-only, theme palette callbacks, no hardcoded colors/strings; `useAppTranslation` handle + property access; hooks from `@apollo/client/react`; NO `useLazyQuery`.
  - [x] 9.IV Read printed files (frontend AGENTS/instructions); validate.
  - _Requirements: REQ-6.1-6.6, REQ-7.2-7.3, REQ-0.5, REQ-9_

---

## Phase 5 — Journey Green + Post-Implementation Review

- [x] 10. **Journey green + full layer suites**
  - Re-run journey: `bun run test/scripts/run-test.ts test/workflows/teachers/verification-plan-purchase.journey.test.ts` → green; run TWICE back-to-back (idempotent teardown proof).
  - Full layer sweeps: `bun run test:db:sequential` (changed repos) · `bun run test:services:sequential` · `bun run test:graphql`.
  - Fix any cross-test regressions.
  - _Requirements: REQ-8.1-8.5_

- [x] 11. **Post-implementation review wave (MANDATORY, >10 tasks)**
  - Parallel review subagents over the git diff of this plan only: `review-types`, `review-backend` (incl. concurrency/TOCTOU), `review-frontend` (MUI v9/Apollo/i18n), `security-probing` (BOLA/BOPLA/BFLA on the new mutation + wildcard/like probes + webhook surface regression).
  - Aggregate CRITICAL/HIGH/MEDIUM/LOW; filter pre-existing noise; fix per file cluster; re-verify via sub-loop.
  - Re-review until zero feature-specific findings; write `outcome/post-implementation-review.md`.
  - _Requirements: REQ-9_

---

## Phase 6/7 — Final Gate & Knowledge Propagation

- [x] 12. **Final quality gate + deferred-items enforcement**
  - `grep -c "❌\|⚠️" deferred-items.md` (removed at close-out) → resolve or reclassify (D2/D3/D4 are cross-ticket coordination notes — mark ✅ once the explicit hand-off notes exist in this plan's outcome files and `docs/` references are updated by Task 13).
  - Baseline comparison vs Task 0 counts → document deltas.
  - `bun quality-gate` green.
  - _Requirements: REQ-0.5, REQ-9_

- [x] 13. **Knowledge propagation & docs**
  - Rewrite `docs/billing/subscription-purchase.md` §10 (:369-372): replace "no special-casing" with the shipped contract — dedicated `purchaseVerificationPlan` mutation, nullable payment owner, activation credit-skip, and why (schema/INV-TV binding).
  - CREATE `docs/teachers/verification-plan-purchase.md` consolidating: purchase flow steps, guard contract, transition semantics, idempotency, testing map, links to `docs/teachers/applicant-lifecycle.md` and `docs/billing/subscription-purchase.md`.
  - Do NOT edit AGENTS.md or `.agents/instructions/*` (hand-curated).
  - Write `outcome/13-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-1.2, REQ-5.6, Success Criteria_

---

## Traceability Matrix

| REQ | Tasks |
|-----|-------|
| REQ-0 | 0, 1.5, all (protocol), 12 |
| REQ-0.5 | 2, 9, 12 |
| REQ-1 | 3, 5 |
| REQ-2 | 5, 7 |
| REQ-3 | 1, 5 |
| REQ-4 | 2, 4, 5 |
| REQ-5 | 4, 6, 13 |
| REQ-6 | 9 |
| REQ-7 | 2, 9 |
| REQ-8 | 2, 4, 5, 6, 7, 10 |
| REQ-9 | 1, 4, 5, 7, 9, 11, 12 |
