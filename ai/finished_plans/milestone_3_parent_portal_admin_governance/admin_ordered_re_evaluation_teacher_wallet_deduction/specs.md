# Requirements — Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)

> **Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/`
> **Ticket:** `Admin-Ordered Re-Evaluation (Teacher Wallet Deduction)` (`docs/planning/TICKETS.md:2143-2180`) — Dev 2 · Milestone 3 · 5 SP · Blocked By `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` + `Teacher Wallet Crediting (Earning Transactions)` (both SHIPPED)
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory) · **Outcomes:** `outcome/`
> **Decision Refs:** B.5 (re-eval paid by teacher), A.5 (audit_logs), FR-3.8 (admin override authority — `docs/specs/functional-requirements.md:123`), INV-TV5 (`docs/specs/state-machine-invariants.md:91`)
> **Reconciliation authority (binding over the ticket's draft-era Gherkin):** `docs/billing/escrow-and-wallet-crediting.md` §5 + §8.2 (money-path hand-off), `docs/teachers/applicant-lifecycle.md` §1 (applicant transition table), `docs/workflows/01-teacher-verification-workflow.md:180` (B.5 resolution)

## Document Information

| Field | Value |
|---|---|
| Feature Name | Admin-Ordered Re-Evaluation (Teacher Wallet Deduction) |
| Milestone | M3 (`milestone_3_parent_portal_admin_governance`) |
| Owner Stream | Dev 2 |
| Story Points | 5 |
| Version / Date | 1.0 · 2026-09-30 |
| Plan kind | full-stack slice — one nullable schema column, three repository additions (one new `is_approved=false` writer + one `passed → in_evaluation` transition + one cycle-resolver extension), one new admin service, one GraphQL mutation, one admin UI action (no new route), i18n keys, four test tiers, one journey test |
| Hard inputs (EXISTING, verified) | `backend/db/schema/billing/wallet.ts:27-28,36-38` · `backend/db/schema/billing/teacher-transaction.ts:38,40-42,50` · `backend/db/schema/enums.ts:63` · `backend/db/repo/billing/wallet.repository.shared-writer.ts:60-69,77,91` · `backend/db/repo/billing/wallet.repository.admin.helpers.ts:427-432` · `backend/db/repo/teachers/applicant.repository.ts:407,468,507` · `backend/db/repo/teachers/teacher.repository.ts:286,319-331` · `backend/services/admin/audit.service.ts:82` · `backend/graphql/shared/admin-prelude.ts:24-29` |
| Downstream consumers (blocked by this ticket) | Admin re-evaluation UI polish · any future "re-evaluation notification" ticket |

## Introduction

Decision B.5 resolved the open question of who pays for an admin-ordered re-evaluation: **the teacher pays**, deducted from their wallet balance and recorded as a `withdrawal`-type `teacher_transaction` row (`docs/workflows/01-teacher-verification-workflow.md:180`; `docs/specs/open-decisions-and-gaps.md:103`). This ticket ships that admin-ordered, paid re-evaluation: an Admin can order a currently-certified teacher back through the 5-session evaluation loop, the re-evaluation fee is debited from the teacher's wallet under the same guarded-debit discipline the escrow and withdrawal surfaces already use, the order is recorded in the append-only audit trail, and the teacher is de-certified (`teacher.is_approved = false`) for the duration of the re-evaluation.

The canonical money-path hand-off for this exact ticket is already written (`docs/billing/escrow-and-wallet-crediting.md:131`):

> "deducts the re-evaluation fee from `wallet.balance` as a withdrawal-type ledger row. It must ride the same guarded debit + validation matrix … write exactly one `audit_logs` row in the same transaction, and never touch `total_earning`."

This plan implements that hand-off and nothing more on the money side: no new debit primitive, no new ledger vocabulary, no change to the wallet schema.

### Feature Summary

Add the admin-ordered re-evaluation order: a new admin-only GraphQL mutation backed by a new `TeacherReEvaluationService` that, in ONE transaction, (1) asserts the caller is a governance-active admin, (2) asserts the subject is a currently-certified teacher whose `applicants` row is `passed`, (3) debits the re-evaluation fee from the teacher's wallet via the existing `WalletRepository.debitAdjustmentOnce` guarded writer (one `withdrawal`/`completed` ledger row, `total_earning` untouched), (4) de-certifies the teacher via a new guarded `TeacherRepository.decertifyOnce`, (5) re-opens the applicant to `in_evaluation` and anchors a fresh re-evaluation cycle, and (6) appends exactly one `audit_logs` row.

### Business Value

The academy can compel a quality re-assessment of a certified teacher and make the re-assessment self-funding (B.5); every order is auditable (A.5); the teacher cannot teach while under re-assessment (`is_approved=false`); and the re-evaluation reuses the fully-verified 5-session evaluation machinery rather than inventing a parallel gate.

### Scope

**In scope:** the admin re-evaluation-order service (wallet debit + audit + de-certification + loop re-entry) and its GraphQL mutation; one nullable `applicants` column + Drizzle push; three repository additions; the cycle-resolver extension that admits a re-evaluation cycle with no new subscription; the admin UI order action (mounted on the existing admin user-detail governance surface — NO new route, NO new sidebar item); i18n keys (en + ar parity); the cross-actor journey test; SDL/codegen/audit-census refresh.

**Out of scope (explicit — deferred to child tickets or other owners; see `deferred-items.md`):**
- The generic **Admin Override of Evaluation Results** surface (manually certify / reject an applicant, FR-3.8) — owned by the still-unshipped M1 ticket `docs/planning/TICKETS.md:916-958`. It is NOT this ticket and MUST NOT be duplicated (verified absent: no `adminRejectApplicant` / `adminGrantReEvaluation` field exists).
- Wiring the `SessionType.ReEvaluation` (`"re_evaluation"`) enum value into the loop predicates. The loop reuses `teacher_evaluation` sessions because the ticket says "the same 5-session evaluation loop applies" (`docs/planning/TICKETS.md:2172-2178`); `re_evaluation` is a read-side/reporting vocabulary today and stays unused by writers — deferred item D-002.
- Teacher notification of the order — not an acceptance criterion; deferred item D-005.
- Product-configurable fee (env/plan-driven) — the fee is a shared constant; deferred item D-001.
- Any change to `withdrawal` settlement (`approveWithdrawal` / `rejectWithdrawal`) or the pending-withdrawal queue.

### Verification Reconciliation (binding — supersedes ticket prose)

The ticket's draft-era Gherkin must be reconciled against the shipped substrate before implementation. Three rulings:

| # | Ticket prose (draft-era) | Shipped reality (verified) | Binding resolution |
|---|---|---|---|
| R1 | Insufficient balance → **422** "Insufficient wallet balance for re-evaluation" (`docs/planning/TICKETS.md:2166`) | The funds-denial posture on the money path is the localized `insufficientBalance` key surfaced as a `WALLET_INSUFFICIENT_FUNDS` `ConflictError`; `CONFLICT` maps to **409** and custom SCREAMING_SNAKE codes are not taxonomy rows (`backend/lib/errors/error-code-taxonomy.ts:45-47,113-115`; `backend/lib/errors.ts:171-183`; `wallet.service.ts:305`; `admin-financial-auditing.service.ts:432`) | **Reuse the existing posture**: `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)` → 409, zero committed rows. No new 422 code, no per-domain funds-denial key (`docs/billing/escrow-and-wallet-crediting.md` §5.6). |
| R2 | "the **teacher's** is_approved is set to false during re-evaluation" (`docs/planning/TICKETS.md:2174`) | No writer in the repo ever sets `is_approved=false` (`teacher.repository.ts` writers are `insertColdStartCertified:286` and `elevateToCertified:319-331`, both `isApproved: true`) | Add exactly one new guarded writer `TeacherRepository.decertifyOnce`; the subject is a **certified teacher** (a wallet-bearing teacher row), NOT a never-certified applicant (which has no wallet). |
| R3 | "the same 5-session evaluation loop applies" (`docs/planning/TICKETS.md:2172`) | The loop gate requires `applicants.status === in_evaluation` (`evaluation-booking.helpers.ts:118`) and an ACTIVE verification subscription cycle (`session.repository.evaluation.helpers.ts:157-178`); `transitionToInEvaluation` **rejects `passed`** (`applicant.repository.ts:407-423`); a certified teacher's applicant row is `passed` and their verification subscription (14-day window) is expired | Add a guarded re-open transition `passed → in_evaluation` + a re-evaluation cycle anchor; extend the cycle resolver to honour the anchor. The 5 sessions are ordinary `teacher_evaluation` sessions — the loop machinery is reused unchanged. |

**Explicitly excluded from this reconciliation:** the applicant-lifecycle doc's statement that "No override surface exists in this lifecycle layer" (`docs/teachers/applicant-lifecycle.md:124`) is a statement about the *lifecycle guard* layer, not a prohibition on a new admin governance writer; this ticket adds a governance writer and updates that doc (§1 transition table gains the `passed → in_evaluation` re-evaluation row) in REQ-014.

## Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and past research is never redone.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL record baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) and write `ai/plans/milestone_3_parent_portal_admin_governance/admin_ordered_re_evaluation_teacher_wallet_deduction/outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists in the plan directory (created with this plan).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in the plan's `outcome/` directory first.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` with research findings, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on it and SHALL NOT proceed until exit code 0.
7. WHEN any subtask is marked complete THEN the agent SHALL have completed the semantic-review checklist (race conditions, tenancy, enums-as-values, dead code, deferred items logged) — the sub-loop script cannot detect these.

### REQ-002: Translation & Enum Compliance

**User Story:** As a maintainer, I want user-facing strings compile-time checked and enums imported as values, so locale and type errors surface at build time.

#### Acceptance Criteria

1. WHEN any new user-facing error string is added THEN it SHALL live in the `errorsTranslations` namespace as a typed `ErrorsLabels` leaf with identical key sets in `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts` (parity tests green).
2. WHEN backend code needs localized text THEN it SHALL call `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (single-arg) and access leaves by property — never hardcoded English, never `next-intl`, never `shared/messages/`.
3. WHEN the insufficient-funds denial is raised THEN it SHALL REUSE the existing `insufficientBalance` leaf (`shared/locale/types/errors/labels.ts:253`; en `shared/locale/en/errors/index.ts:113`, ar `shared/locale/ar/errors/index.ts:111`) — no new funds-denial key (`docs/billing/escrow-and-wallet-crediting.md` §5.6).
4. WHEN a new subject-eligibility or validation copy is needed (e.g. "teacher is not certified", "applicant is not awaiting evaluation", "reason required") THEN it SHALL be a typed `ErrorsLabels` leaf with en+ar parity; no string literal appears in a `throw`.
5. WHEN an enum is referenced in a runtime expression (cast, conditional, object literal, DB write) THEN it SHALL be imported as a value (never `import type`) and members used instead of string literals (`TransactionType`, `TransactionStatus`, `AuditActionType`, `ApplicantStatus`, `UserRole`).
6. WHEN the admin UI renders error copy THEN it SHALL branch on the GraphQL `extensions.code` via the existing error-link map, never on HTTP status (`frontend/AGENTS.md:63-67`).

### REQ-003: Admin Order Authority & Subject Eligibility Gating

**User Story:** As the platform, I want only a governance-active admin to order a re-evaluation, and only for an eligible certified teacher, so the sanctioned power cannot be abused and ineligible subjects are rejected before any money moves.

#### Acceptance Criteria

1. WHEN the mutation is invoked THEN the Pothos `authScopes` SHALL be the explicit `$all` conjunction `{ authenticated: true, role: [UserRole.Admin] }` (inline, matching every shipped admin mutation — `admin-teachers.mutation.ts:45-50`; `admin-finance.mutation.ts:114-119`) so an anonymous caller gets `UNAUTHORIZED` (401) and an authenticated non-admin gets `FORBIDDEN` (403) before the resolver runs.
2. WHEN the resolver runs THEN it SHALL narrow `ctx.user` (`requireAdminUser`) and delegate to the service with `ctx.user.id` as `actorUserId` and `ctx.locale` — never a client-supplied actor id.
3. WHEN the service runs THEN it SHALL re-assert the actor is a governance-active admin via `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts:133`) inside the transaction — deleted/blocked/suspended admins are denied even while holding a valid token (defense in depth).
4. WHEN `actorUserId` or `teacherId` is not a positive safe integer THEN the service SHALL reject pre-DB with `ValidationError(t.validation)`.
5. WHEN the subject teacher row does not exist THEN the service SHALL reject with `NotFoundError("TEACHER", t.teacherNotFound)` → `TEACHER_NOT_FOUND`.
6. WHEN the subject teacher is NOT currently certified (`is_approved !== true`) THEN the service SHALL reject with `ConflictError("TEACHER_NOT_CERTIFIED", …)`.
7. WHEN the subject's `applicants` row is absent or its `status !== passed` THEN the service SHALL reject with `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", …)`.
8. WHEN the order is denied for any reason THEN the system SHALL commit ZERO rows (no wallet debit, no ledger row, no de-certification, no status change, no audit row).

### REQ-004: Re-Evaluation Fee — Single Source of Truth

**User Story:** As the platform, I want the re-evaluation fee defined once as a decimal string, so pricing is server-owned and carried verbatim end-to-end.

#### Acceptance Criteria

1. WHEN the fee is charged THEN its amount SHALL come from a new shared constant `RE_EVALUATION_FEE` (decimal string, EGP) in a new shared module `shared/constants/re-evaluation.constants.ts`, alongside `RE_EVALUATION_FEE_CURRENCY = "EGP"` (mirroring `shared/constants/verification-plan.constants.ts:27-33`).
2. WHEN the fee is used THEN it SHALL be carried as a decimal STRING verbatim — never parsed into a number, never re-rounded (the money discipline of `docs/billing/escrow-and-wallet-crediting.md` §5.4).
3. WHEN the fee value is provisional THEN the constant SHALL carry a docblock marking it a product-input value and the plan SHALL record it as deferred item D-001 (product confirmation).
4. WHEN the mutation is called with no fee on the wire THEN there SHALL be no wire fee at all — the input carries `teacherId` and `reason` ONLY (server-owned pricing; mass-assignment of price structurally impossible).

### REQ-005: Wallet Deduction — withdrawal ledger row + guarded debit

**User Story:** As the academy, I want the re-evaluation fee debited from the teacher's wallet with a truthful ledger row, so the money path stays reconcilable.

#### Acceptance Criteria

1. WHEN the order commits THEN the system SHALL insert exactly ONE `teacher_transaction` row with `type = TransactionType.Withdrawal`, `status = TransactionStatus.Completed`, `amount = RE_EVALUATION_FEE` verbatim, `session_id = NULL`, and a service-composed description — via `WalletRepository.debitAdjustmentOnce` (`wallet.repository.admin.helpers.ts:427-432` → `wallet.repository.ts:472-477`), which delegates to the shared guarded writer `debitWithLedgerRow` (`wallet.repository.shared-writer.ts:60-69`).
2. WHEN the debit executes THEN it SHALL run as ONE guarded `UPDATE … WHERE wallet.id = $1 AND wallet.balance >= $2` (`wallet.repository.shared-writer.ts:77`) inside the SAME transaction as the ledger INSERT — no probe-read decides the write (`docs/billing/escrow-and-wallet-crediting.md` §5.2).
3. WHEN the debit commits THEN `wallet.balance` SHALL be decremented by the fee and `wallet.total_earning` SHALL be UNTOUCHED (a deduction spends the balance; it never rewrites lifetime earnings — `wallet.repository.shared-writer.ts:76,91`; `docs/billing/escrow-and-wallet-crediting.md` §8.2).
4. WHEN the wallet row does not exist THEN the system SHALL `ensureWalletOnce` it first (idempotent `INSERT … ON CONFLICT DO NOTHING` + select — `wallet.repository.ts:59-64`), so a certified teacher with no wallet history still gets an honest zeroed wallet before the debit is attempted.
5. WHEN the debit succeeds THEN the service SHALL NOT fork or re-implement any guarded debit primitive — it composes the EXISTING writer (`docs/billing/escrow-and-wallet-crediting.md` §5.1).
6. WHEN the order responds THEN the response SHALL carry the post-debit `balance` (read back inside the transaction) so the client converges without a refetch — mirroring `adjustTeacherWallet` (`admin-financial-auditing.service.ts:360-459`).

### REQ-006: Insufficient-Balance Denial — zero committed rows

**User Story:** As a teacher with too little balance, I want the order rejected with an honest, localized denial and no side effects, so a failed order never charges or de-certifies me.

#### Acceptance Criteria

1. WHEN the guarded debit matches zero rows (balance < fee) THEN `debitAdjustmentOnce` SHALL return `null` (`wallet.repository.shared-writer.ts:79-83`) and the service SHALL throw `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)` (409 posture; REQ-R1) — mirroring `admin-financial-auditing.service.ts:426-432` and `wallet.service.ts:295-306`.
2. WHEN the denial is thrown THEN the transaction SHALL roll back and commit ZERO rows: no ledger row, no balance change, no de-certification, no applicant status change, no audit row (the "zero committed rows" posture proven at `wallet.service.test.ts:208-235`).
3. WHEN the denial is logged THEN it SHALL emit exactly ONE bounded `logger.logDomainError(msg, {code, entity, entityId})` entry carrying the wallet id only — never the amount, never another user's identity.
4. WHEN the denial surfaces over GraphQL THEN `extensions.code` SHALL be `WALLET_INSUFFICIENT_FUNDS` and the message SHALL be the localized `insufficientBalance` copy in the caller's locale.

### REQ-007: Teacher De-Certification During Re-Evaluation

**User Story:** As the academy, I want the teacher de-certified for the duration of the re-evaluation, so an under-review teacher cannot teach or be booked.

#### Acceptance Criteria

1. WHEN the order commits THEN `teacher.is_approved` SHALL be set to `false` via a NEW guarded repository method `TeacherRepository.decertifyOnce(id, tx)` with the predicate `WHERE id = $1 AND is_approved = true` (`RETURNING`), returning `null` on a zero-row miss.
2. WHEN the de-certify matches zero rows (already not certified — a concurrent order won) THEN the service SHALL throw `ConflictError("TEACHER_NOT_CERTIFIED", …)` and roll back the whole transaction, so a rival order never double-charges.
3. WHEN the teacher is de-certified THEN booking surfaces SHALL exclude them structurally: `session.repository.lifecycle.helpers.ts:56` asserts `EXISTS (… teacher.is_approved = true)` — no new gate is required.
4. WHEN the re-evaluation later PASSES THEN re-certification SHALL reuse the existing aggregation path unchanged: `finalizeRubricPass` (`evaluation-rubric.helpers.ts:342`) → `insertColdStartCertified` on duplicate PK → `elevateToCertified` (predicate `is_approved = false`, `teacher.repository.ts:319-331`) flips it back to `true`. No new certification writer.
5. WHEN the re-evaluation later FAILS THEN the existing `finalizeRubricFail` → `transitionToFailed` path applies unchanged (cooldown stamped; the teacher remains de-certified).

### REQ-008: Loop Re-Entry — guarded `passed → in_evaluation` + cycle anchor

**User Story:** As a de-certified teacher, I want to re-enter the same 5-session evaluation loop, so I can earn my certification back through the verified process.

#### Acceptance Criteria

1. WHEN the order commits THEN the applicant SHALL be re-opened via a NEW guarded repository method `ApplicantRepository.reopenForReEvaluation(userId, tx)` with the predicate `WHERE id = $1 AND status = 'passed'`, setting `status = 'in_evaluation'` and `re_evaluation_started_at = now()`; zero rows → `null` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", …)` + rollback.
2. WHEN the schema is migrated THEN `applicants` SHALL gain a nullable timestamp column `re_evaluation_started_at` (Drizzle schema + `bun run db push`); `NULL` means "never ordered a paid re-evaluation".
3. WHEN the evaluation cycle is resolved for a re-evaluating applicant THEN `resolveCurrentEvaluationCycle` (`session.repository.evaluation.helpers.ts:157-178`) SHALL return the re-evaluation anchor as `cycleStart` when the applicant is `in_evaluation` with a non-null `re_evaluation_started_at` (this is the ONLY added precedence arm; the existing active-verification-subscription arm remains the primary path for first-time applicants).
4. WHEN the loop counts bookings THEN `countEvaluationBookingsInCycle` SHALL remain filtered on `session.session_type = 'teacher_evaluation'` AND `created_at >= cycleStart` — UNCHANGED (the five re-evaluation sessions are ordinary `teacher_evaluation` sessions; D-002).
5. WHEN the teacher books re-evaluation sessions THEN `EvaluationBookingService.bookEvaluation` SHALL apply unchanged: the `in_evaluation` status gate (`evaluation-booking.helpers.ts:118`) passes, and the per-cycle credit ceiling (5) counts only post-anchor sessions.
6. WHEN the re-evaluation order is later repeated (e.g. after a pass) THEN the flow SHALL only be reachable from `passed` again — an order against an already-`in_evaluation` applicant is denied by REQ-003.7 / REQ-008.1.

### REQ-009: Audit Logging of the Order

**User Story:** As a compliance officer, I want every ordered re-evaluation recorded in the append-only audit trail, in the same transaction as the money move.

#### Acceptance Criteria

1. WHEN the order commits THEN exactly ONE `audit_logs` row SHALL be appended via `AuditService.createAuditLog(input, tx)` (`backend/services/admin/audit.service.ts:82`) INSIDE the same transaction as the debit and the state transitions.
2. WHEN the audit contract is composed THEN `actorId` SHALL come exclusively from `ctx.user.id` (never from input); `actionType` SHALL be `AuditActionType.Override` (the admin-supersedes-automation verb, value import from `backend/enum/audit/audit-action-type.enum.ts:10`; precedent: cold-start certification `cold-start-certification.service.ts:201-214`); `entityType` SHALL be the lowercase label `"teacher"`; `entityId` SHALL be the subject teacher's `users.id`.
3. WHEN the `details` JSON is composed THEN it SHALL carry field NAMES + metadata only — `{"action":"re_evaluation_ordered","amount":"<fee>","walletId":<id>,"balanceAfter":"<balance>","reEvaluationStartedAt":"<iso>"}` — NEVER contact PII, credentials, or token values; the writer truncates defensively to `varchar(2000)` (`audit.service.ts:41-63`).
4. WHEN the order rolls back (any denial) THEN NO audit row SHALL persist — the append is in-transaction (`audit.service.ts:19-22`).
5. WHEN the audit census is checked THEN the new mutation SHALL be registered as a `wired` row in `test/workflows/admin/audit-completeness.catalog.ts` (bijection-locked by `backend/db/test/logic/audit/audit-census-drift.test.ts`).

### REQ-010: Exactly-Once Ordering & Concurrency

**User Story:** As the platform, I want a double-click or a concurrent duplicate to charge the teacher exactly once, so the wallet is never double-debited.

#### Acceptance Criteria

1. WHEN two orders for the same teacher race THEN the guarded state transitions SHALL be the arbiter: `decertifyOnce` (`is_approved = true`) and `reopenForReEvaluation` (`status = 'passed'`) each match rows for AT MOST ONE racer; the loser matches zero rows, throws `ConflictError`, and its ALREADY-EXECUTED debit rolls back with the transaction — net exactly one charge.
2. WHEN the service composes the transaction THEN the write order SHALL be: validate → governance/admin gate → load teacher → load applicant → `ensureWalletOnce` → **guarded debit** → **`decertifyOnce` (arbiter)** → **`reopenForReEvaluation` (arbiter)** → audit append → read-back. A miss at either arbiter throws and rolls back everything.
3. WHEN the order flow runs THEN there SHALL be NO read-then-write race window in the money path: the debit guard is fused into the UPDATE predicate (`wallet.repository.shared-writer.ts:77`) and the state guards are fused into their UPDATE predicates — no probe read decides a write (`docs/billing/escrow-and-wallet-crediting.md` §5.2).
4. WHEN no idempotency-key machinery exists on this flow THEN that SHALL be honest and documented: the `passed → in_evaluation` / `is_approved true → false` transitions are the replay arbiter (a completed order cannot be replayed because the applicant is no longer `passed`), mirroring the withdrawal-settlement predicate-arbiter model. No `ctx.idempotencyKey` is read.

### REQ-011: GraphQL Surface, SDL/Codegen Pins & Census

**User Story:** As an API consumer, I want a stable admin mutation contract, so the order can be driven from the admin UI or an API client.

#### Acceptance Criteria

1. WHEN the mutation is registered THEN the root field SHALL be `adminOrderTeacherReEvaluation(teacherId: ID!, reason: String!): TeacherReEvaluationOrder!` in a new `backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts`, wired via a side-effect import in `backend/graphql/mutation/admin/index.ts` (no named exports; `mutation/AGENTS.md:29-32`).
2. WHEN args are mapped THEN they SHALL be copied field-by-field (never spread) with `coerceDecimalSessionId`/`requirePositiveIntId` on the `ID` (`admin-finance.mutation.ts:120-138` precedent); the resolver delegates to the service with `ctx.locale`.
3. WHEN the object/input types are defined THEN they SHALL live in `backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts`: input `OrderTeacherReEvaluationInput` is NOT used — the two scalar args suffice (no input object); the object `TeacherReEvaluationOrderPothosObject` exposes non-null `amountCharged: String!`, `currency: String!`, `walletBalance: String!`, `reEvaluationStartedAt: String!` (ISO), and `teacherId: ID!`.
4. WHEN the new field ships THEN the frozen-inventory SDL pins SHALL be refreshed: `backend/graphql/test/sdl-static-assertions.test.ts:140-145` (`FROZEN_MUTATION_FIELDS`) and `backend/graphql/test/schema-surface.test.ts:726,1160` (mutation-set pins), and the committed SDL artifact SHALL be regenerated byte-identical via `bun run generate:gqlSchema && bun codegen`.
5. WHEN the new SDL field is pinned THEN `backend/graphql/test/schema-surface.test.ts` SHALL gain a contains-pin for the new signature (mirroring the `adjustTeacherWallet` pin at `:2954`).
6. WHEN the permission matrix is documented THEN the plan SHALL state: admin-only (SUPER_ADMIN does not exist as a distinct role; `UserRole` = `Admin | Teacher | Student | Parent`, `backend/enum/users/user-role.enum.ts:5-10`).

### REQ-012: Admin UI Order Action (existing surface — no new route)

**User Story:** As an admin, I want a button on a teacher's admin user-detail page to order a re-evaluation, with a confirmation dialog and honest error copy, so I can act without leaving the governance surface.

#### Acceptance Criteria

1. WHEN the UI ships THEN it SHALL add an "Order re-evaluation" action to the admin user-detail governance surface — `frontend/views/admin/users/detail/UserHeroActions.tsx` and/or `frontend/views/admin/users/…/GovernanceActionsSection.tsx` — rendered ONLY for a user whose role is `teacher` AND whose teacher row is certified; NO new route and NO new sidebar entry (`navItems.ts:158-199`).
2. WHEN the action is confirmed THEN a dialog (modeled on `frontend/views/admin/users/dialogs/CertifyTeacherDialog.tsx`) SHALL collect a mandatory `reason`, explain the fee deduction, and call the new hook.
3. WHEN the mutation is called THEN a new document `adminOrderTeacherReEvaluationMutationDocument` SHALL live in `frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts` (naming per `sharedDocuments/AGENTS.md:84-98`; every selection includes `id` where the type has one) and a hook `useOrderTeacherReEvaluation` SHALL import `useMutation` from `"@apollo/client/react"` (no `useLazyQuery`).
4. WHEN the order succeeds THEN the UI SHALL close the dialog and refetch the affected caches (user detail + the teacher's admin wallet view).
5. WHEN the order fails THEN the dialog SHALL stay open and render the localized copy mapped from `extensions.code` — `WALLET_INSUFFICIENT_FUNDS` (insufficient balance), `TEACHER_NOT_CERTIFIED`, `APPLICANT_NOT_AWAITING_RE_EVALUATION` — via the error-link map, never an HTTP-status branch.
6. WHEN the UI ships THEN it SHALL obey MUI v9 `sx`-only styling, theme-palette-only colors, and the reduced-motion/aria rules (`frontend/AGENTS.md:1-9,30-38,52-56`).

### REQ-013: Cross-Actor Journey Test

**User Story:** As a maintainer, I want an end-to-end journey proving admin → teacher interoperation over shared state, so the loop re-entry is test-locked.

#### Acceptance Criteria

1. WHEN the journey test ships THEN it SHALL live at `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` using real services + real DB (committed fixtures + tracked `afterAll` cleanup; NO `runInRollback`; `test/workflows/AGENTS.md:8-11`).
2. WHEN the journey runs THEN it SHALL exercise: (a) admin orders re-evaluation of a certified teacher → wallet debited + ONE `withdrawal`/`completed` ledger row + ONE `audit_logs` row + `is_approved=false` + applicant `in_evaluation`; (b) the teacher books 5 evaluation sessions and a rubric PASS re-certifies them; (c) a second scenario proves a low-balance teacher is denied with zero committed rows.
3. WHEN permission is checked THEN the journey SHALL resolve it with a REAL non-admin actor row (honest authorization) and assert `FORBIDDEN`/`UNAUTHORIZED`, never a stub (`test/workflows/AGENTS.md:23-26`).
4. WHEN the journey asserts audit rows THEN it SHALL use the journey-registry counters / whole-table oracle (`journey-fixture-registry.ts:211`; `audit-trail.journey.test.ts:103-104`).

### REQ-014: Knowledge Propagation & Documentation

**User Story:** As a future maintainer, I want the new `passed → in_evaluation` transition and the re-evaluation money-path rules documented canonically, so they are not re-derived.

#### Acceptance Criteria

1. WHEN all tasks complete THEN a canonical doc `docs/teachers/admin-ordered-re-evaluation.md` SHALL be created consolidating the order flow, the guarded-transition arbiters, the fee discipline, and the loop re-entry.
2. WHEN the applicant lifecycle doc is updated THEN `docs/teachers/applicant-lifecycle.md` §1 transition table SHALL gain the `passed → in_evaluation` (paid re-evaluation) row with its write-ownership note.
3. WHEN the money-path doc is updated THEN `docs/billing/escrow-and-wallet-crediting.md` §8.2 hand-off SHALL be marked delivered with a pointer to the new service and the new doc (this is a propagation edit, not a re-litigation of the invariants).
4. WHEN the docs are written THEN NO AGENTS.md or `.agents/instructions/*.instructions.md` file SHALL be edited (hand-curated only).
5. WHEN the plan finishes THEN all `outcome/` files SHALL be read and synthesized, and the deferred-items ledger SHALL be final.

## Cross-Actor Journey (REQUIRED — feature spans Admin + Teacher + Evaluators)

### Actor Table

| Actor | Role / permission | Can do | Cannot do |
|---|---|---|---|
| Academy Admin | `UserRole.Admin`, governance-active | Order a re-evaluation for a certified teacher; read the wallet/audit trail | Order for a non-certified teacher; order with no reason; bypass the fee |
| Subject Teacher | `UserRole.Teacher` with `is_approved=true` at order time | Be re-evaluated; see the deducted fee in their wallet ledger; book + attend the 5 evaluation sessions | Teach/book student sessions while `is_approved=false`; escape the fee |
| Certified Evaluator | `UserRole.Teacher` with `is_approved=true, is_evaluator=true` | Be booked as one of the 5 distinct evaluators; submit one rubric per session | Submit more than one rubric per (session, evaluator) |
| Anonymous / non-admin | none / non-admin role | — | Invoke the admin mutation (401 / 403) |

### Ordered Step List (`actor → action → shared-state change + side effects`)

1. **Admin → `adminOrderTeacherReEvaluation`** → `wallet.balance −= RE_EVALUATION_FEE`; +1 `teacher_transaction(withdrawal, completed)`; `teacher.is_approved = false`; `applicants.status: passed → in_evaluation`; `applicants.re_evaluation_started_at = now`; +1 `audit_logs(override, teacher)`.
2. **Non-admin → same mutation** → DENIED `FORBIDDEN` (403); zero rows.
3. **Admin (subject not certified) → same mutation** → DENIED `TEACHER_NOT_CERTIFIED`; zero rows.
4. **Admin (insufficient balance, no fee constant met) → same mutation** → DENIED `WALLET_INSUFFICIENT_FUNDS`; zero rows.
5. **Teacher → `bookEvaluation` ×5 against 5 distinct certified evaluators** → +5 `session(teacher_evaluation)` rows within the re-evaluation cycle; credit ceiling enforced.
6. **Evaluator → `submitRubricEvaluation` ×5** → +5 `evaluations` rows; at the 5th the aggregation derives the verdict → PASS ⇒ `is_approved=true` (re-certified) + `applicants.status=passed`; FAIL ⇒ cooldown stamped, teacher stays de-certified.

### Cross-Actor EARS Criteria (observer perspective)

```
WHEN an admin orders a re-evaluation for a certified teacher
THEN the system SHALL debit the fee from the teacher's wallet AS a withdrawal-type ledger row
  AND append exactly one audit_logs row
  AND set teacher.is_approved = false
  AND set the applicant to in_evaluation with a fresh re-evaluation cycle anchor

WHEN the subject teacher has insufficient wallet balance
THEN the system SHALL reject the order with the localized funds denial AND commit zero rows

WHEN the re-evaluation is ordered
THEN the system SHALL surface the teacher's own fee deduction in their wallet ledger
  AND SHALL admit the teacher to the SAME 5-session evaluation loop

WHEN the 5-session loop finalizes with a PASS
THEN the system SHALL re-certify the teacher (is_approved = true)

IF the caller is not a governance-active admin
THEN the system SHALL deny the order before any money or state moves

IF the teacher is not currently certified
THEN the system SHALL reject the order
```

---

## Design Brief (authoritative for `plan.md` / `tasks.md` — verified signatures)

This appendix is the single source of truth the derived artifacts build on. Every path/symbol below was verified against the working tree; do not re-invent alternatives.

### Component inventory (CREATE / UPDATE / EXTEND)

| # | Artifact | Verdict | Exact target | Notes |
|---|---|---|---|---|
| C1 | `RE_EVALUATION_FEE`, `RE_EVALUATION_FEE_CURRENCY` | CREATE | `shared/constants/re-evaluation.constants.ts` | decimal strings; provisional value; also add to `shared/constants/index.ts` barrel if that barrel exports constants (verify). |
| C2 | `applicants.re_evaluation_started_at` | EXTEND | `backend/db/schema/teachers/applicants.ts` | nullable `timestamp("re_evaluation_started_at")`; then `bun run db push`. |
| C3 | `ApplicantRepository.reopenForReEvaluation(userId, tx?)` | CREATE | `backend/db/repo/teachers/applicant.repository.ts` (beside `transitionToInEvaluation:407`) | guarded `AND(id=$1, status=ApplicantStatus.Passed)` → `status=InEvaluation`, `reEvaluationStartedAt=now()`, `returning()` / `null`. |
| C4 | `TeacherRepository.decertifyOnce(id, tx?)` | CREATE | `backend/db/repo/teachers/teacher.repository.ts` (beside `elevateToCertified:319-331`) | guarded `AND(id=$1, is_approved=true)` → `isApproved=false`, `returning()` / `null`. FIRST-ever false writer. |
| C5 | `resolveCurrentEvaluationCycle` re-evaluation arm | EXTEND | `backend/db/repo/classes/session.repository.evaluation.helpers.ts:157-178` (namespace wrapper `session.repository.ts:798`) | add precedence: when no active verification subscription and the applicant is `in_evaluation` with non-null `re_evaluation_started_at`, return `{cycleStart: re_evaluation_started_at, activeSubscriptionId: null}`. Must observe the caller `tx`. |
| C6 | `TeacherReEvaluationService.orderReEvaluation(...)` | CREATE | `backend/services/teachers/teacher-re-evaluation.service.ts` (+ barrel `backend/services/teachers/index.ts`) | the whole order pipeline, ONE `withTransaction`. |
| C7 | `TeacherReEvaluationOrderReturnType` | CREATE | `backend/types/teachers/teacher-re-evaluation.types.ts` (+ `backend/types/teachers/index.ts` barrel) | `{ teacherId: number; amountCharged: string; currency: string; walletBalance: string; reEvaluationStartedAt: Date }`. |
| C8 | `adminOrderTeacherReEvaluation` mutation | CREATE | `backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts` + side-effect import in `backend/graphql/mutation/admin/index.ts` | inline `$all` admin authScopes. |
| C9 | `TeacherReEvaluationOrderPothosObject` | CREATE | `backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts` (+ `backend/graphql/pothos/admin/index.ts` barrel) | non-null fields per REQ-011.3. |
| C10 | i18n error leaves (en+ar) | EXTEND | `shared/locale/types/errors/labels.ts` + `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` | REUSE existing `insufficientBalance` (`labels.ts:253`), `teacherNotFound` (`labels.ts:249`; en `:111`), `teacherNotCertified` (`labels.ts:243`; en `:108`). ADD only: `applicantNotAwaitingReEvaluation` and `reEvaluationReasonRequired` (en+ar parity). |
| C11 | frontend document + hook + dialog + action wiring | CREATE/EXTEND | `frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts`; `frontend/views/admin/users/dialogs/OrderReEvaluationDialog.tsx`; extend `UserHeroActions.tsx` / `useGovernanceActions.ts`; register the id-less `TeacherReEvaluationOrder` payload in `frontend/providers/apollo/apolloCache.ts` (`keyFields: false`) | no new route/sidebar; `id` on selections where the type has one; `useMutation` from `@apollo/client/react`. |
| C12 | admin UI locale keys (en+ar) | EXTEND | `shared/locale/types/adminUsers/index.ts` (`AdminUsersLabels`) + en `shared/locale/en/adminUsers/index.ts` + ar `shared/locale/ar/adminUsers/index.ts` (the `AdminUsers` namespace already exists and is consumed; or a small new namespace) | dialog title, reason label, confirm, fee-explanation copy. |
| C13 | SDL pins + census | EXTEND | `backend/graphql/test/sdl-static-assertions.test.ts:140-145`; `backend/graphql/test/schema-surface.test.ts:726,1160`+a contains-pin; `test/workflows/admin/audit-completeness.catalog.ts` | refresh frozen inventories + add wired census row. |
| C14 | tests | CREATE | repo tests in `backend/db/test/repo/teachers/*`; service test `backend/services/teachers/teacher-re-evaluation.service.test.ts`; wire test under `frontend/graphql/test/` or `backend/graphql/test/`; journey `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` | layers per `tasks.md` pipeline. |
| C15 | docs | CREATE/EXTEND | `docs/teachers/admin-ordered-re-evaluation.md`; `docs/teachers/applicant-lifecycle.md`; `docs/billing/escrow-and-wallet-crediting.md` | REQ-014. |

### Service signature (authoritative)

```ts
// backend/services/teachers/teacher-re-evaluation.service.ts
export namespace TeacherReEvaluationService {
  export async function orderReEvaluation(
    actorUserId: number,
    input: { readonly teacherId: number; readonly reason: string },
    locale: string,
    outerTx?: DBTransaction
  ): Promise<TeacherReEvaluationOrderReturnType>;
}
```

### Transaction pipeline (authoritative order — REQ-010.2)

1. `assertValidPositiveInt(actorUserId)` / `(input.teacherId)` pre-DB → `ValidationError(t.validation)`.
2. `normalizeReason(input.reason)` — trim; empty or > `MAX_REASON_LENGTH` → `ValidationError(t.reEvaluationReasonRequired)`. (Reuse the shape of `normalizeAdjustmentReason` at `admin-financial-auditing.service.helpers.ts:86-92`, `MAX_REASON_LENGTH = 229`.)
3. `withTransaction(outerTx, async tx => { … })`:
   1. `assertActorAdminActive(actorUserId, locale, tx)`.
   2. teacher = `TeacherRepository.findById(input.teacherId, tx)` → `NotFoundError("TEACHER", t.teacherNotFound)`; `teacher.isApproved !== true` → `ConflictError("TEACHER_NOT_CERTIFIED", t.teacherNotCertified)`.
   3. applicant = `ApplicantRepository.findByUserId(input.teacherId, tx)` → null/`status !== Passed` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", …)`.
   4. wallet = `WalletRepository.ensureWalletOnce(input.teacherId, tx)`.
   5. ledger = `WalletRepository.debitAdjustmentOnce({ walletId: wallet.id, amount: RE_EVALUATION_FEE, description: composeReEvaluationDescription(reason) }, tx)`; `null` → log + `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)`.
   6. `TeacherRepository.decertifyOnce(input.teacherId, tx)`; `null` → `ConflictError("TEACHER_NOT_CERTIFIED", …)`.
   7. `ApplicantRepository.reopenForReEvaluation(input.teacherId, tx)`; `null` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION", …)`.
   8. read back `WalletRepository.findById(wallet.id, tx)` for `balanceAfter`.
   9. `AuditService.createAuditLog({actorId: actorUserId, actionType: AuditActionType.Override, entityType: "teacher", entityId: input.teacherId, details: JSON.stringify({...})}, tx)`.
   10. return `{ teacherId, amountCharged: RE_EVALUATION_FEE, currency: RE_EVALUATION_FEE_CURRENCY, walletBalance: balanceAfter.balance, reEvaluationStartedAt: reopened.reEvaluationStartedAt }`.

### Concurrency assessment (authoritative)

- **Double-order same teacher:** arbitrated by `decertifyOnce` (`is_approved=true`) and `reopenForReEvaluation` (`status='passed'`). One racer wins; the loser's zero-row miss throws and rolls back its debit → exactly one charge. No idempotency key needed.
- **Debit vs concurrent withdrawal:** both ride the same `balance >= amount` predicate on the same wallet row; the guarded statement serializes them; the loser matches zero rows honestly (`wallet.repository.test.ts:783-859` pattern).
- **Re-certification racing a re-order:** `elevateToCertified` (`is_approved=false`) is the arbiter on pass; a re-order can only start from `passed` + `is_approved=true`.
