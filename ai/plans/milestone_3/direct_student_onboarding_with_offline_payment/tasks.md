# Implementation Tasks: Direct Student Onboarding with Offline Payment

> **Target Directory:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment`
> **Specs:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/specs.md` (REQ-000, REQ-001, REQ-010..015, REQ-020, REQ-030; Journeys J-1..J-3, JR-1..5)
> **Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/plan.md`
> **Ledger:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/deferred-items.md`
> **Outcomes:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/outcome/`
> **Date:** 2026-09-21 · **Milestone:** M3 · **Source Ticket:** `docs/planning/TICKETS.md:2357-2402`

---

## Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Outcome-Read-Before-Work:** Before starting any task, read ALL existing files under `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/outcome/` AND `deferred-items.md` to accumulate cross-task knowledge — never re-verify what a prior outcome already proved.
2. **Per-File Quality Loop:** After EVERY file create/modify, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and require exit code 0 BEFORE the task is marked done. Progressive enforcement: fix tsgo first, then oxlint/biome/lint/duplicates — never skip ahead.
3. **Semantic Review Checklist:** Before flipping any phase checkbox `[x]`, run the `.SR` self-review against the applicable instruction files and AGENTS.md files listed in the reference table below: single-transaction atomicity, `tx` to EVERY repository call, enums as VALUE imports, no `console.*` (use `logger.logDomainError`), no `next-intl`, no `Translation.` enum, ONE-arg `getTranslations`/`getServerTranslations`, no `{ ...input }` spreads, no `SUPER_ADMIN` references, no relative imports in tests.
4. **Global Re-Check:** Tests run ONLY via `bun run test/scripts/run-test.ts <test-path>` (NEVER raw `bun test`). `bun tsgo`, `bun biome:check`, `bun run lint` are safe to run concurrently.
5. **Outcome File Per Task:** After completing each task, write `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/outcome/<task-id>-outcome.md` capturing: summary, files changed, files deliberately NOT changed, verification outputs (exact commands + results), cross-file dependencies discovered, deviations from plan (each justified or reverted).
6. **Checkbox Tracking:** Flip `[ ]` → `[x]` on the task AND every completed subtask as work lands. Never batch-flip at the end. If any cited symbol/file/line is not locatable, STOP, record a ❌ ledger row, and block dependent tasks — never inline-patch a foreign layer.

---

## Mandatory Subtask Pipeline (defined ONCE — every implementation task references `pipeline: standard` AND lists its own five sub-items with real file paths)

Every implementation task below carries five suffix-piped sub-items:

- `<id>.QL **Quality Loop:**` — `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on every created/edited file named in the task.
- `<id>.TE **Test Engineering:**` — layer-correct test approach with the exact wrapper command `bun run test/scripts/run-test.ts <test-path>` (never raw `bun test`).
- `<id>.SEC **Security & Tenancy Audit:**` — BOLA/BOPLA/BFLA review: actor only from `ctx.user.id`/`actorId` param; closed field-by-field whitelists; two-layer role gates; PII-free audit details; denial paths provably zero-write.
- `<id>.SR **Semantic Review:**` — semantic checklist per Protocol rule 3 for the files this task touched.
- `<id>.IV **Instruction Verification:**` — validate the produced code against the instruction files and AGENTS.md files listed for the file's layer in the table below.

---

## Layer → Instruction / AGENTS.md Reference Table (existence-verified in-tree)

| File layer / path pattern | Instruction file | AGENTS.md files (absolute under `/home/ahmed/Projects/kottaby_kottaby/`) |
|---|---|---|
| `backend/types/**`, `backend/services/**`, `backend/db/repo/**`, `backend/enum/**`, `backend/graphql/**` | `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` | `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` + the layer's own (below) |
| `backend/services/**` | backend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md` |
| `backend/graphql/pothos/**`, `backend/graphql/mutation/**` | backend.instructions.md | `backend/graphql/pothos/AGENTS.md`, `backend/graphql/mutation/AGENTS.md`, `backend/graphql/AGENTS.md` |
| `backend/types/**` | backend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md` |
| `backend/db/repo/**` | backend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md` |
| `backend/db/test/**` | backend.instructions.md + `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` | `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md` |
| `test/workflows/**` | tests.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` |
| `frontend/graphql/test/**` | tests.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/test/AGENTS.md` |
| `frontend/graphql/sharedDocuments/**` | frontend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/sharedDocuments/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/AGENTS.md` |
| `frontend/views/**` | frontend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md` |
| `app/**` | frontend.instructions.md | `/home/ahmed/Projects/kottaby_kottaby/app/AGENTS.md` |
| `shared/locale/**` | (no dedicated instruction file) | `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md`, `/home/ahmed/Projects/kottaby_kottaby/shared/locale/AGENTS.md` |
| Any test file (`*.test.ts(x)`) | tests.instructions.md | + the layer's AGENTS.md per the rows above |

---

## Phase 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0.1 Record Error Baseline & Seed Deferred-Items Ledger
  - Run and capture exact counts: `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`; `bun biome:check` warning count; `bun run scripts/lint-service.ts --json --id baseline` (record `success`/`exitCode`/error count from the JSON envelope). Record all three vectors verbatim.
  - Record the pre-existing modified-file set: `git diff --name-only` (verbatim list in the outcome).
  - Record schema-drift pre-state: `git diff --name-only -- backend/db/schema/` (MUST be empty now; re-verified empty in Phase 5).
  - Confirm `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/deferred-items.md` exists (created by the Phase-3 writer from `.agents/spec-process-guide/templates/deferred-items-template.md`) and carries the pre-registered seeds **D-ONB-001** (teacher assignment — out of scope per specs §1), **D-ONB-002** (scholarship `paymentReference` optional-relaxation — the original specs J-3 wording vs plan §1.3 D3 required-field decision, reconciled at plan-review R1; target: post-M3 product decision), and **D-ONB-003** (admin parents-directory surface — re-pointed at a future UX ticket; plan §8).
  - Write `outcome/0.1-baseline-outcome.md` with counts + diff set + ledger seed confirmation.
  - _Requirements: REQ-000_

- [x] 0.2 Prerequisite & Dependency Verification (Read-Only Sweep)
  - VERIFICATION CHECKLIST — verify each claim in-tree with the exact grep/read and record `path:line` anchors in the outcome; ANY absence/drift ⇒ ❌ ledger row + dependent tasks blocked (never inline-patch):
    - [x] `subscriptions.ts` offline columns: read `backend/db/schema/billing/subscriptions.ts:38-43` — confirm `status` (:38), `payment_method` (:41), `payment_reference` (:42) + partial unique `subscriptions_payment_reference_unique` (:54-56), `payment_verified_at` (:43).
    - [x] `payment_gateway` enum offline members: `grep -n "offline_cash\|bank_transfer\|scholarship" backend/db/schema/enums.ts` (expect `:56-66`); TS mirror `backend/enum/billing/payment-gateway.enum.ts:10-19`.
    - [x] `students` handshake/parent columns: `backend/db/schema/students/students.ts:24-32` (`balance_*` :24-27, `handshake_code` :31, `parent_id` :32).
    - [x] Blocked-by dependency A: `AdminUserManagementService.createUser` at `backend/services/admin/user-management.service.ts:261` (trial dormancy `:297-302`); run `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` — must be green BEFORE any of our tasks run.
    - [x] Blocked-by dependency B: `SubscriptionAdminService` lifecycle seams at `backend/services/billing/subscription-admin.service.ts:159,299,400,488`; run `bun run test/scripts/run-test.ts backend/services/billing/subscription-admin.service.test.ts` — must be green.
    - [x] Reusable seam `StudentRepository.creditLaneBalance`: `grep -n "creditLaneBalance" backend/db/repo/students/student.repository.ts` (expect `:440`).
    - [x] Reusable seam `StudentRepository.linkParentIfUnlinked`: same file `:373` (guarded UPDATE … WHERE parent_id IS NULL).
    - [x] Reusable seam `createStudentWithHandshakeRetry`: `backend/services/shared/user-provisioning.helpers.ts:118` (retry budget `HANDSHAKE_RETRY_LIMIT = 5` `:30`, format `KSB-`+8 hex `:43`).
    - [x] Reusable seam `insertAdminPeriodSubscription` template: `backend/services/billing/subscription-admin-settle.helpers.ts:43-60` (leaves payment columns NULL — our twin SETS them).
    - [x] Journey harness present: `test/workflows/AGENTS.md`, `test/workflows/helpers/` (`actor-context.ts`, `tracked-fixtures.ts`, `journey-fixtures.ts` — `catchJourneyError` at `:226`, `TrackedFixtures` at `:173`, `journeyPrefix`), `test/helpers/db-cleanup.ts:83` (`withAuditDeleteTriggersSuspended`).
    - [x] GraphQL harness present: `test/helpers/test-lifecycle.ts:41` (`setupTestServerLifecycle`), `test/helpers/graphql-test-helpers.ts:8` (`testClient`), `test/helpers/expect-mutation-error.ts:33` (`expectMutationError`), `test/helpers/fixture-rows.ts:69` (`insertAdminUserWithChildRow`).
    - [x] Census machinery present: `test/workflows/admin/audit-completeness.catalog.ts` + `backend/db/test/logic/audit/audit-census-drift.test.ts` — read the census journey `record()`/`executeCensusRows` regions and record their exact current line ranges for task 2.2.
    - [x] Toolbar host verified: `frontend/views/admin/students/AdminStudentsToolbar.tsx` EXISTS (grep its props to confirm the affordance prop name before Phase 4 names it).
    - [x] `ParentRepository` today exports only `createForRegistration`: `grep -n "export" backend/db/repo/parents/parent.repository.ts` (expect `:21`) — confirms `findById` is a CREATE-listed additive method.
  - Write `outcome/0.2-outcome.md` with the full anchor table.
  - [x] 0.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/outcome/0.2-outcome.md --lifecycle duplicates` (exit 0)
  - [x] 0.2.SR **Semantic Review:** every EXISTING claim carries a `path:line` anchor from a real read; every ABSENCE claim grep-verified; both blocked-by suites green.
  - [x] 0.2.IV **Instruction Verification:** this is a read-only sweep — no code produced; instruction files apply from Phase 1 onward.
  - _Requirements: REQ-000, REQ-012, REQ-013, REQ-014_

---

## Phase 1: Types, Enums & i18n Foundation

- [x] 1.1 Create `backend/types/admin/admin-student-onboarding.types.ts` (CREATE — first-lander)
  - Canonical types per plan §4.1 EXACTLY (NO service-layer `.types.ts` — canonical home is `backend/types/`): `AdminOnboardStudentSubmitInput` (closed whitelist: `fullName, email, phone, password, gender?: Gender, country, parentId?: number | null, planId, paymentMethod: PaymentGateway, paymentReference` — `role` is NOT client input; it is hard-coded `"student"` by the service) and `AdminOnboardStudentReturnType` (composed from EXISTING canonical return types only: `student: AdminUserDetailReturnType`, `subscription: SubscriptionReturnType`, `creditedLane: SubscriptionCreditLane`, `creditedSessions: number`, `handshakeCode: string`).
  - All runtime enums are VALUE imports of enum members from `backend/enum/**` (`PaymentGateway`, `SubscriptionCreditLane`, `AuditActionType`, `UserRole`) — NEVER string literals, NEVER new local enum mirrors; `Gender` imported from `backend/enum/users/gender.enum`.
  - NO new `StudentInsertType`/`StudentReturnType` is minted — the student insert stays owned by the EXISTING provisioning seam.
  - Import only from allowed layers: `@/backend/enum`, `@/backend/types` — never `@/backend/services/**`, never `@/backend/graphql/**` (types are a leaf layer).
  - Write `outcome/1.1-outcome.md`.
  - [x] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/admin/admin-student-onboarding.types.ts --lifecycle duplicates` (exit 0)
  - [x] 1.1.TE **Test Engineering:** no standalone test — types are exercised by 2.3 service tests and 3.x GraphQL suite; confirm `bun tsgo` reports zero NEW errors vs `/tmp/baseline-tsgo.txt`.
  - [x] 1.1.SEC **Security & Tenancy Audit:** input type is a closed whitelist (no `{ ...input }` spreads possible downstream); optional fields explicitly `| null`, never optional-and-implicit.
  - [x] 1.1.SR **Semantic Review:** typed-literal pattern per existing files in `backend/types/admin/` (read `backend/types/admin/admin-user.types.ts` first for naming conventions); no `SUPER_ADMIN` mentions; no two-arg translation signatures.
  - [x] 1.1.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/types/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014_

- [x] 1.2 New locale namespace `studentOnboarding` (CREATE — types/en/ar/namespaces 4 files + registry entry + parity test)
  - Follow the `subscriptionAdmin` precedent EXACTLY: read `shared/locale/namespaces/subscriptionAdmin/subscriptionAdmin.namespace.ts`, `shared/locale/types/message.ts:56` (`subscriptionAdminTranslations: SubscriptionAdminLabels` registry entry) and `shared/locale/subscriptionAdmin-namespace.parity.test.ts` before writing.
  - CREATE (4-file anatomy): `shared/locale/types/studentOnboarding/index.ts` — `StudentOnboardingLabels` (nested `readonly` groups; plurals as `(count: number) => string`; interpolations as typed parameter functions); `shared/locale/en/studentOnboarding/index.ts` — single `export const studentOnboardingEn: StudentOnboardingLabels`; `shared/locale/ar/studentOnboarding/index.ts` — exact key parity with en (RTL-safe, idiomatic Arabic); `shared/locale/namespaces/studentOnboarding/` — namespace handle `StudentOnboarding` (defineNamespace binding) + `index.ts` re-export.
  - EXTEND `shared/locale/types/message.ts` (additive-only): add `studentOnboardingTranslations: StudentOnboardingLabels;` beside `subscriptionAdminTranslations` (`:56`) — the compile-time registry forces BOTH leaves to implement every key.
  - Key inventory per plan §5.5 (exhaustive): `title`; `sections: { profile, parent, plan, payment }`; `fields: { fullName, email, phone, password, gender, country }`; `parentSection: { none, linkedTo, searchPlaceholder }`; `planSection` (incl. `sessions`/`intervalDays` interpolators + lane labels); `paymentSection: { methods: { offlineCash, bankTransfer, scholarship }, reference, referenceHelper }`; `actions: { submit, cancel, saving }`; `success: { title, handshakeCode: (code) => string, balanceCredited: (count) => string }`; `errors: { methodNotOffline, referenceInvalid, planInactive, planLaneUnconfigured, parentRoleInvalid, parentsRowMissing, duplicateReference }`. Existing keys (`authTranslations.emailAlreadyExists`, `errorsTranslations.*`) are REUSED, never re-minted.
  - CREATE `shared/locale/studentOnboarding-namespace.parity.test.ts` (en↔ar key-set + function-signature parity).
  - Write `outcome/1.2-outcome.md`.
  - [x] 1.2.QL **Quality Loop:** per file — `bun run scripts/health/sub-loop.ts shared/locale/types/studentOnboarding/index.ts --lifecycle duplicates` (exit 0); repeat for the en leaf, ar leaf, namespace handle files, `shared/locale/types/message.ts`, and the parity test.
  - [x] 1.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts` — green.
  - [x] 1.2.SEC **Security & Tenancy Audit:** no PII/credentials in translation strings; copy carries the admin-actor framing (WHO onboarded WHOM), never the student's password.
  - [x] 1.2.SR **Semantic Review:** `shared/` imports NOTHING from `@/frontend/**`/`@/backend/**`/`@/app/**` (ESLint-enforced); no `next-intl`, no `Translation.` enum, no string-literal namespaces; typed function keys for every plural/interpolation.
  - [x] 1.2.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/shared/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/shared/locale/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` (for the parity test).
  - _Requirements: REQ-001, REQ-010, REQ-011, REQ-012, REQ-013, REQ-020, REQ-030_

- [x] 1.3 Zero-Migration Ruling (READ-ONLY — zero drift gate, REQ-001 evidence task)
  - NO schema/enum migration is produced by this plan — every column the writers need already exists (verified in 0.2). This task records that ruling as evidence.
  - Run and capture (must be empty at this point): `git diff --name-only -- backend/db/schema/ backend/drizzle/`; `bun run generate:gqlSchema` then `git diff --name-only -- frontend/graphql/generated/` (only Phase 3 may introduce generated diffs, and only additive).
  - Link plan §2 (zero-drift gate) in the outcome; any drift ⇒ ❌ ledger row and revert.
  - Write `outcome/1.3-outcome.md`.
  - [x] 1.3.SR **Semantic Review:** diff outputs captured verbatim; zero drift confirmed against the 0.2 anchors.
  - _Requirements: REQ-001_

---

## Phase 2: Backend — Journey-Test-First + Service

- [x] 2.1 Write `test/workflows/admin/direct-student-onboarding.journey.test.ts` — TEST-FIRST (initially red)
  - Scaffold-gate: read `test/workflows/AGENTS.md` (all 98 lines) + `test/workflows/helpers/` (`actor-context.ts:88-143`, `tracked-fixtures.ts:173`, `journey-fixtures.ts:226` — `catchJourneyError`) + the representative skeleton `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` (setup/teardown + step style) BEFORE authoring.
  - NO `runInRollback` in this layer (services spawn their own top-level transactions). Committed actor cast in ONE `beforeAll` `db.transaction`: `provisionAdminActor` (actor admin), `provisionParentActor` (linked-parent + other-parent), via `createTestUser`/`createTestStudent`/`createTestParent`/`createTestAdmin`/`createTestPlan` from `@/backend/db/test/entity-setup`; a lane-bearing plan fixture via `createTestPlan` with `balanceLane` set; `const prefix = journeyPrefix("admin")`; `const tracked = new TrackedFixtures()`.
  - Sequential actor-attributed steps implementing J-1/J-2/J-3 (specs §2.9) — service called DIRECTLY (journeys are service-tier, not GraphQL):
    1. J-1 cash happy path: `StudentOnboardingService.onboardStudentWithOfflinePayment({ profile…, paymentMethod: PaymentGateway.OfflineCash, paymentReference, parentId: null }, admin.userId, LOCALE)` → assert: `users` + `students` (unique `handshake_code`, all four balance columns zeroed before credit, NO trial grant — `subscription_status` reads `'none'` pre-activation and balance_trial untouched), `subscriptions(status='active', payment_method='offline_cash', payment_reference, payment_verified_at)`, junction row, lane balance += exactly one `session_count`, EXACTLY TWO `audit_logs` rows (user Create + subscription Create) attributed to the admin's id; **`student_payments` count-delta = 0** (snapshot COUNT before/after — REQ-014).
    2. Onboarded student `login` (existing surface) succeeds; balance observable (JR-1).
    3. Admin read-back through existing surfaces: `AdminUserManagementService.getUserDetail` / `adminStudents` directory read shows the new row + audit entries attributed to the admin (JR-4).
    4. J-2 bank-transfer + parent association: `paymentMethod: PaymentGateway.BankTransfer`, distinct reference, `parentId = parentActor.userId` → J-1 rows + `students.parent_id` set (JR-2); parent monitoring read (`ParentMonitoringService.listLinkedChildren`) observes the child; other-parent probe gets the constant-403 denial with zero leakage.
    5. J-3 scholarship: unique reference (plan D3), `payment_method='scholarship'` committed.
    6. Denial steps (each via `catchJourneyError`, asserting typed error class + translated substring from `getServerTranslations("en")`, AND zero-row movement + zero audit rows): `paymentMethod: Paymob` (pre-write rejection); duplicate `payment_reference` (JR-5 ConflictError); teacher/student/parent actors calling with their REAL ids (service `FORBIDDEN`).
    7. Teardown: tracked hard-delete in FK-reverse order; audit sweep via `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83`); `deleteUsersByIds`; post-teardown zero-residue probes (`test/workflows/AGENTS.md:12-19`) incl. `countUsersByIds === 0`, zero `student_payments` rows, zero audit rows.
  - RED state expected initially (service does not exist yet); the file MUST parse/typecheck as it grows green task-by-task.
  - [x] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/admin/direct-student-onboarding.journey.test.ts --lifecycle duplicates` (exit 0)
  - [x] 2.1.TE **Test Engineering:** `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts` — red (import failure) at this task, green after 2.3; every denial step asserts (a) typed class + translated message, (b) zero row movement across `users`/`students`/`subscriptions`/`student_subscriptions`/`audit_logs`, (c) zero `student_payments` delta.
  - [x] 2.1.SEC **Security & Tenancy Audit:** honest actor ids only (no monkey-patched role/scope resolution); denials through real auth checks (`test/workflows/AGENTS.md:23-26`); no PII in assertions beyond fixture-local values.
  - [x] 2.1.SR **Semantic Review:** `runInRollback` absent; unique `jrn_` prefix present; `@/` aliases only (no relative parent imports); tracked teardown complete; every J-1..J-3 step maps to ≥1 assertion; JR-1..JR-5 each asserted.
  - [x] 2.1.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md`.
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015_

- [x] 2.2 Extend the audit census for composite (two-row) producers — EXACTLY per plan §4.7
  - FIRST read both files and cite their real current line ranges in the outcome: `test/workflows/admin/audit-completeness.catalog.ts` (the `AdminActionCensusEntry` shape at `:47-59`) and `test/workflows/admin/audit-completeness.journey.test.ts` (the `record()` helper — plan cites `:372` — and `executeCensusRows` validation — plan cites `:1010-1011`, plus the 1:1 oracle at `:1582,1646`).
  - EXTEND `audit-completeness.catalog.ts` (additive-only): `AdminActionCensusEntry` gains optional `secondaryExpectedAuditRows?: readonly { entityType: string; expectedActionTypes: readonly AuditActionType[] }[]`; every existing row is byte-untouched.
  - EXTEND `audit-completeness.journey.test.ts` (additive-only): `record()` gains an optional `entityType` param defaulting to `entry.expectedEntityType`; `executeCensusRows` accepts a recorded action whose `entityType` matches `entry.expectedEntityType` OR a `secondaryExpectedAuditRows` member (verb checked against the matching shape). This MUST land in the SAME change set as the census row (Phase 3 task 3.3) per REQ-020.6 — sequencing note: implement the machinery here; the row itself is added in 3.3.
  - Regression lock: `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts` green BEFORE and AFTER this task (the drift bijection only reads `mutationField`/`kind` — `:282-330`).
  - Write `outcome/2.2-outcome.md` with the real line-range citations.
  - [x] 2.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts test/workflows/admin/audit-completeness.catalog.ts --lifecycle duplicates` (exit 0); same for `audit-completeness.journey.test.ts`.
  - [x] 2.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts test/workflows/admin/audit-completeness.journey.test.ts` — green with every existing census row still passing (additive-only proof); `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts` — green.
  - [x] 2.2.SEC **Security & Tenancy Audit:** no existing oracle loosened — the 1:1 actor-row oracle stays intact for single-entityType rows; the extension only admits honestly-declared secondary rows.
  - [x] 2.2.SR **Semantic Review:** every change additive; no `jscpd:ignore` comments; `AuditActionType` VALUE imports only.
  - [x] 2.2.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md`.
  - _Requirements: REQ-015, REQ-020_

---

- [x] 2.3 Additive repository seam: `ParentRepository.findById` (CREATE method — additive-only)
  - Needed for the parent-existence + parent-role check inside the service's PRE-FLIGHT phase (plan §4.2 step A). Verified in 0.2 that `backend/db/repo/parents/parent.repository.ts` currently exports only `createForRegistration` (`:21`).
  - ADD `findById(userId: number, tx?: DBQueryExecutor): Promise<ParentSelectType | null>` — a bare PK read via `queryDb(tx)` per the bare-reads rule (`backend/AGENTS.md` §3); NO other method touched. The parent's `role`/identity checks are done by the service via `UserRepository.findById` — the repo stays data-access-only per `backend/db/repo/AGENTS.md`.
  - Follow the file's existing method style (read `createForRegistration` first); `DBQueryExecutor` from `@/backend/types`.
  - Write `outcome/2.3-outcome.md`.
  - [x] 2.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/repo/parents/parent.repository.ts --lifecycle duplicates` (exit 0)
  - [x] 2.3.TE **Test Engineering:** extend the repo's existing test file (locate via `ls backend/db/test/repo/parents/`) with a 100%-branch case set (found / not-found), ALL inside `runInRollback`, `tx` passed to EVERY call, try/catch error pattern (NEVER `expect(...).rejects.toThrow()` inside `runInRollback`); `bun run test/scripts/run-test.ts backend/db/test/repo/parents/parent.repository.test.ts` — green.
  - [x] 2.3.SEC **Security & Tenancy Audit:** read-only SELECT; returns only the four whitelisted columns; no tenant-scope assumptions inside the repo.
  - [x] 2.3.SR **Semantic Review:** additive-only diff confirmed via `git diff` (one method + its test block); no barrel changes needed (repo barrel already exports the class).
  - [x] 2.3.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` (repo test: + `/home/ahmed/Projects/kottaby_kottaby/backend/db/test/AGENTS.md` + `.agents/instructions/tests.instructions.md`).
  - _Requirements: REQ-010, REQ-012_

- [x] 2.4 Implement `backend/services/admin/student-onboarding.service.ts` + `student-onboarding.helpers.ts` + co-located 4-tier service tests — until the 2.1 journey is GREEN
  - Scaffold-gate: read `backend/services/AGENTS.md` and the cold-start precedent `backend/services/admin/admin-gate.service.ts` + `admin-gate.helpers.ts` (STRUCTURAL precedent for composition-style admin services).
  - CREATE `backend/services/admin/student-onboarding.service.ts` — plan §4.2 EXACTLY:
    - **PRE-TX GUARDS (BEFORE the transaction opens — zero writes on any denial, plan §4.5 steps 1–4)**: (1) `assertActorAdmin(actorId, locale)` (BFLA re-assert; precedent `backend/services/admin/user-management.service.ts:240-271`); (2) `assertOfflinePaymentMethod(input.paymentMethod)` — `!OFFLINE_PAYMENT_GATEWAYS.includes(method)` ⇒ localized `ValidationError` (REQ-012.4; `paymob` et al. belong to the gateway lifecycle only); (3) `normalizePaymentReference(input.paymentReference)` — trim, reject empty or >255 (REQ-012.3 shape; REQUIRED for ALL three methods incl. scholarship per plan D3 — relaxation tracked as D-ONB-002); (4) `PlanRepository.findById(input.planId)` — `null` ⇒ `PLAN_NOT_FOUND`; `!isActive` ⇒ localized `ValidationError`; `balanceLane === null` ⇒ localized `ValidationError` (`PLAN_LANE_UNCONFIGURED`-class, REQ-013.3 fail-closed); (5) when `parentId` present: `UserRepository.findById(input.parentId)` — `null` ⇒ `USER_NOT_FOUND` (REQ-011.4), `role !== UserRole.Parent` ⇒ localized `ValidationError` (REQ-011.3), then parents-row existence probe via `ParentRepository.findById` (task 2.3) — missing role-child row ⇒ localized `ValidationError`. NO duplicate-email pre-check SELECT (D9): `users_email_unique` arbitrates inside `createUser` via `translateDbError` (REQ-010.4).
    - **WRITES (all inside ONE `db.transaction`, `tx` passed to EVERY repo call — no exceptions)**: (1) `AdminUserManagementService.createUser(mapToCreateUserInput(input), actorId, locale, tx)` — composed seam; `mapToCreateUserInput` is a pure helper in `student-onboarding.helpers.ts` that maps field-by-field (NEVER a `{ ...input }` spread) and hard-codes the role to `UserRole.Student` (the only writer of the role — BOPLA/BFLA); trial stays dormant per `user-management.service.ts:297-302`; (2) handshake minted THROUGH `createUser`'s student branch (`createStudentWithHandshakeRetry`, `user-provisioning.helpers.ts:118`); (3) if `parentId`: `StudentRepository.linkParentIfUnlinked(studentId, parentId, tx)` (`student.repository.ts:373`) — `null` return ⇒ typed conflict (fail loud, roll back); (4) `SubscriptionRepository.insertSubscription(buildOnboardSubscriptionInsert(…), tx)` — the offline twin of `insertAdminPeriodSubscription` (`subscription-admin-settle.helpers.ts:43-60`) that ADDITIONALLY SETS `status: SubscriptionStatus.Active`, `paymentMethod`, `paymentReference`, `paymentVerifiedAt = now`; 23505 on the partial unique ⇒ `translateDbError` ⇒ localized ConflictError; (5) junction insert: `tx.insert(studentSubscriptions).values({ studentId, subscriptionId })` (precedent `subscription-purchase.service.ts:419`, `subscription-admin-settle.helpers.ts:98`); (6) `StudentRepository.creditLaneBalance(studentId, plan.balanceLane, plan.sessionCount, tx)` (`student.repository.ts:440`) — exactly one `session_count`, no proration, no trial top-up; `null` ⇒ typed NotFound (defensive); (7) subscription `Create` audit row #2 via `AuditService.createAuditLog(buildSubscriptionAuditContract(actorId, AuditActionType.Create, subscriptionId, buildOnboardAuditDetails(…)), tx)` — ids/enums only, ≤2000 chars, NO PII; audit row #1 (user `Create`) is minted inside `createUser`. `withAuditDeleteTriggersSuspended` is TEST-ONLY — never in the prod path.
    - **RETURN**: `AdminOnboardStudentReturnType` per 1.1 — `{ student, subscription, creditedLane, creditedSessions, handshakeCode }`.
    - **Never**: `console.*` (use `logger.logDomainError` from `@/backend/lib/logger` for business rejections); `{ ...input }` spreads; `SUPER_ADMIN`; two-argument `getServerTranslations`/`getTranslations` (locale copy resolves via ONE argument: `getServerTranslations(locale).studentOnboardingTranslations` / `.errorsTranslations`; resolvers use `ctx.t`).
  - CREATE `backend/services/admin/student-onboarding.helpers.ts`: payment-method offline-set check, reference format validator, parent-linkage verification — pure/testable, no DB access.
  - CREATE co-located `backend/services/admin/student-onboarding.service.test.ts` — 4-tier suite per the `backend/services/billing/subscription-admin.service.test.ts` pattern: `runInRollback` wrapper; try/catch + `expectRepoError`-style assertions (NEVER `expect(...).rejects.toThrow()` inside `runInRollback`); translated-message assertions from `getServerTranslations("en").studentOnboardingTranslations` / `.errorsTranslations` (one-argument lookup) for every A1–A5 + B-layer rejection; spy-tracking `afterEach` (restore all spies) per the subscription-admin test pattern; per-tier targets: role-gate matrix (admin/student/teacher/parent actors), all A-gate denials, happy paths for all three offline methods, parent-linkage happy + conflict, duplicate-reference ConflictError mapping, zero-`student_payments` invariant (count-delta 0), audit two-row exactness.
  - Iterate 2.1 journey ↔ this task until BOTH are green.
  - Write `outcome/2.4-outcome.md`.
  - [x] 2.4.QL **Quality Loop:** per file — `bun run scripts/health/sub-loop.ts backend/services/admin/student-onboarding.service.ts --lifecycle duplicates` (exit 0); repeat for `student-onboarding.helpers.ts` and `student-onboarding.service.test.ts`.
  - [x] 2.4.TE **Test Engineering:** `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts` — green (all 4 tiers); `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts` — GREEN (end of this task).
  - [x] 2.4.SEC **Security & Tenancy Audit:** actor NEVER from client input (admin id is a typed parameter, GraphQL layer injects `ctx.user.id`); every write admin-attributed (no orphan rows attributed to system/null); denial paths provably zero-write (asserted in tests); reference field length-bounded; no PII in audit details beyond the entity ids/emails the existing audit rows already carry.
  - [x] 2.4.SR **Semantic Review:** single-transaction proof (every repo call receives `tx`); enums as VALUE imports; error codes map 1:1 to plan §3.3; `student_payments` NEVER touched; helpers pure; no `console.*`.
  - [x] 2.4.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/services/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md` (tests: + `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md`).
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015_

---

## Phase 2.5: Mid-Point Review Gate (MANDATORY — backend phase complete, frontend not started)

- [x] 2.5 Mid-Point Review Gate — backend-scoped review subagent wave
  - Dispatch parallel review subagents scoped to the plan's backend changed files: ONE `review-backend` subagent over `backend/services/admin/student-onboarding.service.ts`, `student-onboarding.helpers.ts`, `backend/db/repo/parents/parent.repository.ts` delta; ONE `review-types` subagent over `backend/types/admin/admin-student-onboarding.types.ts` + all `studentOnboarding` locale files.
  - Checklist per wave: plan D1–D13 decision conformance (especially D2 single-tx composition, D3 required reference, D5 two audit rows, D9 constraint-only arbitration, D11 in-tx authoritative plan re-read, D13 one-arg translations); `tx` propagation to EVERY repository call; INV-PAY5 (zero `student_payments` writes anywhere in the diff); ids-only audit details; closed error taxonomy; translated-message assertions in tests.
  - Fix loop: every finding is fixed in-file and re-verified via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) + the affected `bun run test/scripts/run-test.ts <suite>` re-run; unresolved findings ⇒ ❌ ledger row, never silently dropped.
  - Re-run the backend gates once after fixes: `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts`, `bun run test/scripts/run-test.ts test/workflows/admin/direct-student-onboarding.journey.test.ts`.
  - Write `outcome/midpoint-review-R1.md` (wave findings, fixes applied, residual ledger rows).
  - _Requirements: REQ-000, REQ-010..015_

---

## Phase 3: GraphQL Surface

- [x] 3.1 Pothos input + result object — `backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts` (CREATE)
  - Per plan §3.2 EXACTLY: `AdminOnboardStudentOfflineInput` (fields: `fullName`, `email`, `phone`, `password` required strings; `gender: GenderPothosEnum` optional; `country` required; `parentId: Int` optional; `planId: Int` required; `paymentMethod: PaymentGatewayPothosEnum` required; `paymentReference: String` required — D3) and `AdminOnboardStudentResultPothosObject` composing EXISTING canonical objects ONLY: `student: AdminUserDetailPothosObject`, `subscription: SubscriptionPothosObject`, `creditedLane: SubscriptionCreditLanePothosEnum`, `creditedSessions: Int`, `handshakeCode: String`. NO new entity object types; enums reused from `backend/graphql/pothos/shared/enum.pothos.ts` (`Gender` `:70`, `PaymentGateway` `:226`, `SubscriptionCreditLane` `:266`) — never re-registered.
  - Types imported from `backend/types/admin/admin-student-onboarding.types.ts` (task 1.1) — NO local type definitions in the Pothos file.
  - [x] 3.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/pothos/admin/admin-student-onboarding.pothos.ts --lifecycle duplicates` (exit 0)
  - [x] 3.1.TE **Test Engineering:** compile/registration gate — schema builds (`bun run generate:gqlSchema` in 3.2 consumes it); covered end-to-end by the 3.3 suite.
  - [x] 3.1.SEC **Security & Tenancy Audit:** input is the closed whitelist mirror of `AdminOnboardStudentSubmitInput`; `role`/`status`/`paymentVerifiedAt` are NOT input fields anywhere (structurally unreachable — BOPLA).
  - [x] 3.1.SR **Semantic Review:** single canonical object per entity (no new object types); `id`-first discipline is the result objects' own concern (`AdminUserDetail`/`StudentSubscription` already comply); no service-layer imports in the Pothos file.
  - [x] 3.1.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/pothos/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/AGENTS.md`.
  - _Requirements: REQ-020_

- [x] 3.2 Mutation `adminOnboardStudentWithOfflinePayment` + barrel registration + census row + schema regen (SAME change set)
  - CREATE `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts` — side-effect file (no named exports), thin resolver, modeled verbatim on `backend/graphql/mutation/admin/admin-users.mutation.ts:58-86`: `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` as an INLINE LITERAL (the census drift scanner resolves literals only); resolver narrows `ctx.user`, then maps input field-by-field (NEVER `{ ...input }`) into `StudentOnboardingService.onboardStudentWithOfflinePayment(whitelist, ctx.user.id, ctx.locale)`; NO try/catch (DomainErrors propagate to the finalizer); NO local types; NO business logic.
  - EXTEND `backend/graphql/mutation/admin/index.ts` (side-effect barrel): add `import "./admin-student-onboarding.mutation";`.
  - EXTEND `test/workflows/admin/audit-completeness.catalog.ts` — add the census row per plan §4.7 EXACTLY: `mutationField: "adminOnboardStudentWithOfflinePayment"`, `serviceEntry: "StudentOnboardingService.onboardStudentWithOfflinePayment"`, `expectedActionTypes: [AuditActionType.Create]`, `expectedEntityType: "user"`, `secondaryExpectedAuditRows: [{ entityType: "subscription", expectedActionTypes: [AuditActionType.Create] }]`, `kind: "wired"` — plus the census runner (`censusRunners["adminOnboardStudentWithOfflinePayment"]`) provisioning a lane-bearing plan + parent fixture, executing the real service path, and recording BOTH rows (user Create on the student user id; subscription Create on the subscription id). Uses the 2.2 machinery.
  - Run in the SAME change set: `bun run generate:gqlSchema && bun codegen`; commit the regenerated SDL + `frontend/graphql/generated/**` artifacts together with the mutation (REQ-020.6).
  - Write `outcome/3.2-outcome.md`.
  - [x] 3.2.QL **Quality Loop:** per file — `bun run scripts/health/sub-loop.ts backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts --lifecycle duplicates` (exit 0); same for the barrel, the catalog file, and the census journey file.
  - [x] 3.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts` — green (bijection holds with the new row); `bun run test/scripts/run-test.ts test/workflows/admin/audit-completeness.journey.test.ts` — green with the new runner exercising both audit rows.
  - [x] 3.2.SEC **Security & Tenancy Audit:** `$all` conjunction inline literal VERBATIM (plain-map ANY-semantics is wrong and invisible to the census scanner); actor sourced only from `ctx.user.id`; closed field-by-field whitelist at the resolver (BOPLA); service re-asserts the actor (two-layer, REQ-020.2).
  - [x] 3.2.SR **Semantic Review:** side-effect file discipline (no named exports); thin resolver; census row + codegen + mutation in one change set (drift test proves it); no `PUBLIC_OPERATIONS` touched.
  - [x] 3.2.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/backend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/mutation/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/test/workflows/AGENTS.md` (census files).
  - _Requirements: REQ-015, REQ-020_


- [x] 3.3 GraphQL integration suite — `frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts` (CREATE)
  - Harness per `frontend/graphql/test/AGENTS.md`: `setupTestServerLifecycle()` + `testClient` + `describeGraphqlSuite` + `expectMutationError` from `@/test/helpers`; admin fixture via `insertAdminUserWithChildRow` (`test/helpers/fixture-rows.ts:69`) + `loginMutationDocument` → real bearer `Authorization` header per request; cleanup via `deleteUsersByIds` + `countUsersByIds === 0` probes; audit sweep via `withAuditDeleteTriggersSuspended`.
  - Uses the typed document from task 4.1 (`adminOnboardStudentWithOfflinePaymentMutationDocument`) — NOTE: this suite runs AFTER task 4.1 lands (dependency noted in the Dependency-Ordered Summary). ALL input fields on EVERY mutation call; optional fields passed explicitly as `null`; enums imported from `@/frontend/graphql/generated/gql/graphql` (NEVER hardcoded strings); `errorPolicy: "all"` with `expectMutationError(result.error, "CODE")`; NO backend imports (repositories/services/drizzle) — interface separation is strict.
  - Case matrix: anonymous ⇒ `UNAUTHORIZED` (pre-resolver); teacher/student/parent bearer ⇒ `FORBIDDEN` (pre-resolver); happy path — full result shape incl. `id` fields, `handshakeCode`, `subscription { status paymentMethod paymentReference paymentVerifiedAt }`; each denial via `expectMutationError` codes per plan §3.3 (`VALIDATION`, `CONFLICT`, `PLAN_NOT_FOUND`, `USER_NOT_FOUND`); every denial asserts zero-writer-visibility through the response (errors only).
  - Write `outcome/3.3-outcome.md`.
  - [x] 3.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts --lifecycle duplicates` (exit 0)
  - [x] 3.3.TE **Test Engineering:** `bun run test/scripts/run-test.ts frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts` — green; every code in the plan §3.3 table test-pinned.
  - [x] 3.3.SEC **Security & Tenancy Audit:** tokens never logged; no identity bleed between suite cases; smuggling probes (extra fields) die as GraphQL validation; BFLA exercised at the real scope gate.
  - [x] 3.3.SR **Semantic Review:** generated-code imports only; no raw string queries/fetch; no `useLazyQuery`; no prod-code changes inside the test.
  - [x] 3.3.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/tests.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/test/AGENTS.md`.
  - _Requirements: REQ-020_

---

## Phase 4: Frontend

- [x] 4.1 Shared document — `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts` (CREATE) + co-located contract test
  - CREATE the document per plan §5.4 EXACTLY: `adminOnboardStudentWithOfflinePaymentMutationDocument: TypedDocumentNode<AdminOnboardStudentWithOfflinePaymentMutation, AdminOnboardStudentWithOfflinePaymentMutationVariables>` with named operation `AdminOnboardStudentWithOfflinePayment`; selection: `student { id … }` (`id` FIRST — Apollo cache normalization), `subscription { id status paymentMethod paymentReference paymentVerifiedAt }`, `creditedLane`, `creditedSessions`, `handshakeCode`; types from `@/frontend/graphql/generated/gql/graphql` (3.2 codegen).
  - EXTEND `frontend/graphql/sharedDocuments/admin/index.ts` (additive-only barrel line). House naming precedent: `adminCreateUserMutationDocument` (`admin-users.documents.ts:179`).
  - CREATE co-located `admin-student-onboarding.documents.test.ts` — pins named operation, exact variable set, `id`-first selection, barrel identity.
  - [x] 4.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts --lifecycle duplicates` (exit 0); same for the barrel and the contract test.
  - [x] 4.1.TE **Test Engineering:** `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.test.ts` — green.
  - [x] 4.1.SEC **Security & Tenancy Audit:** document contains no fragments leaking unrelated fields; variable types match the backend input contract 1:1.
  - [x] 4.1.SR **Semantic Review:** generated-type imports only; operation name matches the backend field; document registered through the barrel (no duplicate operation anywhere).
  - [x] 4.1.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/frontend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/sharedDocuments/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/AGENTS.md`.
  - _Requirements: REQ-020, REQ-030_

- [x] 4.2 Onboarding dialog component tree under `frontend/views/admin/students/onboarding/` (CREATE — first-lander)
  - `OnboardStudentDialog.tsx` — host built on `FormDialogShell` (`frontend/views/admin/forms/FormDialogShell.tsx:12-31`); FOUR sections in ONE dialog (REQ-030.2): Profile → Parent (optional) → Plan → Offline Payment; submit via `React.SyntheticEvent<HTMLFormElement>`.
  - `OnboardStudentProfileSection.tsx` (fullName, email, phone, password, gender?, country); `OnboardStudentParentSection.tsx` (optional Autocomplete parent picker — data via `adminUsersQueryDocument` with `filters: { role: parent }` per plan §5.3); `OnboardStudentPlanSection.tsx` (active-plan cards via `planCatalogQueryDocument` — sessions/interval/lane); `OnboardStudentPaymentSection.tsx` (3 ToggleButton segments for the offline methods + reference TextField required for all three — D3, client-side trim + 1–255 bound, service re-validates); `OnboardStudentSuccessContent.tsx` (post-submit handshake-code handoff display, REQ-030.6).
  - `onboardingDialog.types.ts` — local VIEW types ONLY (dialog form state); `index.ts` barrel (`export * from "./…"`).
  - Copy: `useAppTranslation(StudentOnboarding)` with the handle imported from `@/shared/locale/namespaces/studentOnboarding` (string-literal namespaces FORBIDDEN); MUI v9 discipline: layout via `sx` ONLY, theme-palette colors ONLY, `*Outlined` icons — no style props, no hardcoded colors.
  - Write `outcome/4.2-outcome.md`.
  - [x] 4.2.QL **Quality Loop:** per file — `bun run scripts/health/sub-loop.ts frontend/views/admin/students/onboarding/OnboardStudentDialog.tsx --lifecycle duplicates` (exit 0); repeat for every section file, the types file, and the barrel.
  - [x] 4.2.TE **Test Engineering:** no static/component UI test layer exists (repo convention — UI is covered by GraphQL + journey suites); gate is `bun tsgo` zero NEW errors + `bun run lint` on the tree.
  - [x] 4.2.SEC **Security & Tenancy Audit:** password field is `type="password"`, value never logged/echoed in success content; no PII persisted client-side beyond the form state.
  - [x] 4.2.SR **Semantic Review:** FormDialogShell chrome reused (title/cancel/save/saving + global error band); `id` fields selected first on all query documents used; no `AppDataGrid`/`PageContainer` misuse; no bottom-nav/grp_* references.
  - [x] 4.2.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/frontend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md`.
  - _Requirements: REQ-030_


- [x] 4.3 Hooks: `useOnboardStudentMutation`, `useOnboardStudentFormFeedback`, `useOnboardingPlanOptions` (CREATE)
  - CREATE `frontend/views/admin/students/onboarding/hooks/useOnboardStudentMutation.ts` — `useMutation(adminOnboardStudentWithOfflinePaymentMutationDocument, { refetchQueries: [{ query: adminStudentsQueryDocument, variables }], awaitRefetchQueries: true })` per the `useAdminUsersDirectory.ts:77-97` precedent; hooks imported from `@apollo/client/react` (NEVER bare `@apollo/client`); NO `useLazyQuery` anywhere.
  - CREATE `frontend/views/admin/students/onboarding/hooks/useOnboardStudentFormFeedback.ts` — `runWithFeedback`-style error mapping seam mirroring `frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:4-16`: `VALIDATION` `extensions.fields[]` → inline `helperText`; field-less errors → top-level alert band; server messages render verbatim via `extractErrorMessage` from `@/frontend/lib/graphql-error-utils` with NO client-side re-translation (REQ-030.7).
  - CREATE `frontend/views/admin/students/onboarding/hooks/useOnboardingPlanOptions.ts` — stateful `useQuery(planCatalogQueryDocument)` (active-only by construction) + `useQuery(adminUsersQueryDocument, { variables: { filters: { role: … } } })` for the parent picker; both from `@apollo/client/react`.
  - CREATE `frontend/views/admin/students/onboarding/hooks/index.ts` barrel.
  - Write `outcome/4.3-outcome.md`.
  - [x] 4.3.QL **Quality Loop:** per file — `bun run scripts/health/sub-loop.ts frontend/views/admin/students/onboarding/hooks/useOnboardStudentMutation.ts --lifecycle duplicates` (exit 0); repeat for each hook file and the barrel.
  - [x] 4.3.TE **Test Engineering:** no static/component UI test layer exists; gates are `bun tsgo` (zero NEW errors vs baseline) + the 3.3 GraphQL suite exercising the same document end-to-end.
  - [x] 4.3.SEC **Security & Tenancy Audit:** mutation is the only write surface; no credentials/tokens stored client-side; error band never echoes the password.
  - [x] 4.3.SR **Semantic Review:** `id`-first selections already pinned by 4.1; refetch targets the REAL directory document (`adminStudentsQueryDocument`, `admin-students.documents.ts:47`); no store mutations outside Apollo cache.
  - [x] 4.3.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/frontend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md`.
  - _Requirements: REQ-020, REQ-030_

- [x] 4.4 Toolbar affordance + directory wiring (EXTENDED additive-only)
  - BEFORE editing, read the verified host files and cite real line ranges in the outcome: `frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx` and `frontend/views/admin/students/AdminStudentsToolbar.tsx` (both EXISTING — verified in 0.2).
  - EXTEND `AdminStudentsDirectoryContainer.tsx` (additive-only): `const [onboardingOpen, setOnboardingOpen] = useState(false)`; render `<OnboardStudentDialog open={onboardingOpen} onClose={() => setOnboardingOpen(false)} … />`; pass `onOnboardStudent` down to the toolbar.
  - EXTEND `AdminStudentsToolbar.tsx` (additive-only): ONE "Onboard student" button (inline-end, `PersonAddOutlined` icon, disabled while the dialog is open), label from `useAppTranslation(StudentOnboarding)`.
  - NO new route, NO nav change: `navItems.ts`, `DashboardSidebar.tsx`, and `app/(dashboard)/students/page.tsx` are untouched (plan D6; page gate `withPageAuth({ roles: [UserRole.Admin] })` already covers the host route).
  - Write `outcome/4.4-outcome.md`.
  - [x] 4.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/views/admin/students/AdminStudentsDirectoryContainer.tsx --lifecycle duplicates` (exit 0); same for `AdminStudentsToolbar.tsx`.
  - [x] 4.4.TE **Test Engineering:** no UI test layer; gates: `bun tsgo` + `bun run lint` on both files; the dialog is exercised via `bun run dev` smoke in BOTH locales (en + ar) per specs DoD #5 — record the manual/dev-server verification steps in the outcome.
  - [x] 4.4.SEC **Security & Tenancy Audit:** entry point renders ONLY behind the admin-gated `/students` page (page-level `withPageAuth`); the mutation remains independently gated at scope + service layers (defense in depth, REQ-030.5).
  - [x] 4.4.SR **Semantic Review:** additive-only diffs (`git diff` shows two small insertions); no existing toolbar behavior drift; copy via namespace handle ONLY.
  - [x] 4.4.IV **Instruction Verification:** `/home/ahmed/Projects/kottaby_kottaby/.agents/instructions/frontend.instructions.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/views/AGENTS.md` + `/home/ahmed/Projects/kottaby_kottaby/frontend/AGENTS.md`.
  - _Requirements: REQ-030_

---

## Phase 5: End-to-End Verification

- [x] 5.1 Full test sweep (all tiers, all via the run-test wrapper)
  - Journey layer: `bun run test/scripts/run-test.ts test/workflows` — whole layer green (incl. our journey AND the audit-completeness census journey).
  - Targeted suites: `bun run test/scripts/run-test.ts backend/services/admin/student-onboarding.service.test.ts`; `bun run test/scripts/run-test.ts backend/db/test/repo/parents/`; `bun run test/scripts/run-test.ts frontend/graphql/test/admin-student-onboarding/admin-student-onboarding.test.ts`; `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-census-drift.test.ts`; `bun run test/scripts/run-test.ts shared/locale/studentOnboarding-namespace.parity.test.ts`.
  - Whole layers (touched broadly): `bun run test:services` + `bun run test:graphql` + `bun run test:db` per repo conventions — all green, no regression vs pre-task state.
  - Write `outcome/5.1-outcome.md` with the command→result table.
  - _Requirements: REQ-000, REQ-010..015, REQ-020, REQ-030_

- [x] 5.2 Quality gate + baseline diff + zero-drift + INV-PAY5 assertion
  - Run `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates) — green; NEVER clear caches; resume from last failed stage on retry (`bun quality-gate` resumes; `:fresh` only resets the state file).
  - Baseline diff vs `/tmp/baseline-tsgo.txt`: `bun tsgo 2>&1 | grep -c "error TS"` MUST NOT exceed the recorded baseline count; biome warn count and lint-service `--json` error count likewise unchanged (no new debt).
  - Zero schema drift: `git diff --name-only -- backend/db/schema/` — MUST be EMPTY (NFR-8; `bun run db push` NEVER ran).
  - INV-PAY5 global assertion: grep the final diff for any `studentPayments`/`student_payments` INSERT/UPDATE in the new service/helpers — MUST be absent; the journey's count-delta = 0 probes are the runtime proof (REQ-014).
  - Write `outcome/5.2-outcome.md`.
  - _Requirements: REQ-000, REQ-014_

- [x] 5.3 Deferred-items sweep (final ledger gate)
  - Run: `grep -c "❌\|⚠️" ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/deferred-items.md` — MUST print `0`.
  - Every ledger row is either ✅ Done-with-verification or explicitly re-pointed at an owning ticket with no ❌/⚠️ status remaining; D-ONB-001 and D-ONB-002 end as RESOLVED-REFERENCE rows pointing at their owners.
  - Write `outcome/5.3-outcome.md`.
  - _Requirements: REQ-000_

---

## Phase 6: Post-Implementation Review Waves

- [x] 6.1 Parallel review subagent waves (scoped to the plan's changed files)
  - Dispatch FOUR review subagents in parallel: (a) `review-types` over `backend/types/admin/admin-student-onboarding.types.ts` + the `studentOnboarding` locale namespace files; (b) `review-backend` over `backend/services/admin/student-onboarding.service.ts` + `student-onboarding.helpers.ts` + the `ParentRepository` delta + `backend/graphql/mutation/admin/admin-student-onboarding.mutation.ts` + the Pothos file; (c) `review-frontend` over `frontend/graphql/sharedDocuments/admin/admin-student-onboarding.documents.ts` + the `frontend/views/admin/students/onboarding/` tree + the toolbar/container deltas; (d) `review-security-probing` over the ENTIRE cross-layer diff (BOLA/BOPLA/BFLA replay + INV-PAY5 + audit attribution).
  - Review axes: plan D1–D13 conformance; spec REQ/JR id coverage; AGENTS.md/instruction adherence per the reference table; test-of-weak-probes (does every denial case honestly cover the codepath it names?).
  - Fix waves: findings fixed in-file, re-verified via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) + the affected `bun run test/scripts/run-test.ts <suite>` re-run. Unresolvable ⇒ ❌ ledger row + 5.3 must clear it.
  - Write `outcome/post-implementation-review.md` (per-wave findings, fixes, residual ledger rows).
  - _Requirements: REQ-000, REQ-010..015, REQ-020, REQ-030_

---

## Phase 7: Knowledge Propagation & Documentation

- [x] 7.1 Canonical doc — `docs/admin/student-onboarding-offline-payment.md` (CREATE — first-lander)
  - VERIFY absence first (MUST before creating): `grep -rl "student onboarding" docs/` and `ls docs/admin/` — no existing doc covers the composite direct-onboarding+offline-payment flow; record the check in the outcome. Then CREATE, following an existing sibling's structure (Why / Pattern / Rules / Anti-patterns / Rollout / Related — mirror `docs/billing/admin-subscription-management.md`).
  - Content: the composite-tx pattern (identity writer composition + offline activation twin of `insertAdminPeriodSubscription`); the offline-payment invariants (INV-PAY5 zero `student_payments`; reference REQUIRED for all three methods incl. scholarship — D3, with D-ONB-002 tracking the relaxation candidate); the two-audit-row composite census extension (`secondaryExpectedAuditRows`); the dialog shape (FormDialogShell + 4 sections); Related MUST link `docs/billing/admin-subscription-management.md` and `docs/admin/user-management.md` (both verified to exist in 0.2), plus `docs/specs/state-machine-invariants.md` INV-PAY5.
  - Rules/anti-patterns sections carry: inline-literal `$all` authScopes; NO pre-check SELECT races (constraint-arbitrated via `translateDbError`); one-arg translations; `tx` to every repo call; never touch `student_payments` in this surface.
  - Write `outcome/7.1-outcome.md`.
  - [x] 7.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts docs/admin/student-onboarding-offline-payment.md --lifecycle duplicates` (exit 0)
  - [x] 7.1.TE **Test Engineering:** N/A — documentation; verify all cited `path:line` anchors resolve (re-grep each before publishing).
  - [x] 7.1.SEC **Security & Tenancy Audit:** no credentials/PII in doc; example payloads use fixture names only.
  - [x] 7.1.SR **Semantic Review:** doc matches shipped behavior exactly (post-6.1 fixes included); zero invented symbols.
  - [x] 7.1.IV **Instruction Verification:** project rule — canonical docs consolidate knowledge beyond individual files (root AGENTS.md "Important References" pattern); NO summary markdown files are created anywhere except this canonical doc + outcome files.
  - _Requirements: REQ-000, REQ-012, REQ-014_

---

## Dependency-Ordered Summary

| Task | Title | Depends on | REQ refs |
|---|---|---|---|
| 0.1 | Error baseline + ledger seeding | — | REQ-000 |
| 0.2 | Prerequisite & dependency read-only sweep | 0.1 | REQ-000, REQ-012, REQ-013, REQ-014 |
| 1.1 | `admin-student-onboarding.types.ts` | 0.2 | REQ-010..014 |
| 1.2 | `studentOnboarding` locale namespace + parity test | 0.2 | REQ-001, REQ-010..013, REQ-020, REQ-030 |
| 1.3 | Zero-migration ruling (evidence) | 0.1, 0.2 | REQ-001 |
| 2.1 | Journey test (TEST-FIRST, red) | 0.2, 1.1 | REQ-010..015 |
| 2.2 | Census `secondaryExpectedAuditRows` extension | 0.2 | REQ-015, REQ-020 |
| 2.3 | `ParentRepository.findById` additive seam | 0.2 | REQ-010, REQ-012 |
| 2.4 | Service + helpers + 4-tier tests → journey GREEN | 2.1, 2.3, 1.1, 1.2 | REQ-010..015 |
| 2.5 | Mid-point review gate (backend) | 2.4 | REQ-000, REQ-010..015 |
| 3.1 | Pothos input + result object | 1.1, 2.4 | REQ-020 |
| 3.2 | Mutation + barrel + census row + schema regen (one change set) | 2.2, 2.4, 3.1 | REQ-015, REQ-020 |
| 4.1 | Shared document + contract test | 3.2 | REQ-020, REQ-030 |
| 3.3 | GraphQL integration suite | 3.2, 4.1 | REQ-020 |
| 4.2 | Onboarding dialog component tree | 1.2, 4.1 | REQ-030 |
| 4.3 | Onboarding hooks (mutation/refetch/error mapping/plan options) | 4.1, 4.2 | REQ-020, REQ-030 |
| 4.4 | Toolbar affordance + directory wiring | 4.2, 4.3 | REQ-030 |
| 5.1 | Full test sweep | 3.3, 4.4 | REQ-000, REQ-010..015, REQ-020, REQ-030 |
| 5.2 | Quality gate + baseline diff + zero-drift + INV-PAY5 | 5.1 | REQ-000, REQ-014 |
| 5.3 | Deferred-items sweep | 5.2, 6.1 | REQ-000 |
| 6.1 | Post-implementation review waves | 5.2 | REQ-000, REQ-010..015, REQ-020, REQ-030 |
| 7.1 | Canonical doc + outcome | 6.1 | REQ-000, REQ-012, REQ-014 |
