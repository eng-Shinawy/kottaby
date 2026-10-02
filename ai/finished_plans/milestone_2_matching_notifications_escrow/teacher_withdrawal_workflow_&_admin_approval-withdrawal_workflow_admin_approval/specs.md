# Requirements — Teacher Withdrawal Workflow & Admin Approval (Close-the-Loop Verification)

**Plan Directory (verbatim — every header, ledger path, and self-reference in this document uses this exact string):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/`
**Ticket:** "Teacher Withdrawal Workflow & Admin Approval" (`docs/planning/TICKETS.md:1799-1846`) — Owner Stream Dev 3 · **Milestone 2** · 5 SP · Blocked By "Teacher Wallet Crediting (Earning Transactions)" (SHIPPED, test-locked by `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/`)
**Grounding docs:** `docs/specs/state-machine-invariants.md` (INV-W1 :191, INV-W2 :192, INV-W3 :193, INV-W5 :195, INV-W6 :196, INV-W7 :197, INV-W8 :198) · `docs/billing/admin-financial-auditing.md` (§2 Settlement Model :46, §3 Trigger Amendment :71, §5 Audit Trail Mapping :148) · `docs/billing/escrow-and-wallet-crediting.md` (:87, :96, :97, :113) · `docs/workflows/03-session-lifecycle-escrow.md` §6.3 (:140-161) · `docs/workflows/05-admin-governance-override.md` §6.2 (:135-170) · `docs/graphql/domain-error-extensions-code.md` · `docs/testing/workflow-journey-tests.md` · `test/workflows/AGENTS.md`

---

## Document Information

| Field | Value |
|---|---|
| Feature Name | Teacher Withdrawal Workflow & Admin Approval |
| Target Directory | `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/` |
| Outcome Directory | `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/outcome/` |
| Version | 1.0 |
| Date | 2026-09-17 |
| Status | Requirements complete — verification-scoped, pre-execution |
| Plan Kind | **Close-the-loop verification** (not a from-scratch implementation ticket) |
| Milestone | 2 — Matching, Notifications & Escrow |

---

## Introduction

### ⚠️ Load-Bearing Scope Reconciliation (READ FIRST — shapes every section below)

The ticket's gherkin describes the full withdrawal lifecycle: teacher requests → `pending` row; admin approves → `completed` + balance decremented; admin rejects → `failed` + balance unchanged; over-balance request → "422 Insufficient wallet balance"; completed/failed rows immutable.

Verified against the live tree (2026-09-17), **every one of those acceptance criteria already ships, end-to-end, with multi-layer test locks**:

| Ticket AC | Shipped surface (verified) | Primary test lock |
|---|---|---|
| AC1 request → pending row, amount validated vs balance | `WalletService.requestWithdrawal` (`backend/services/billing/wallet.service.ts:213-257`) → `WalletRepository.debitForWithdrawalOnce` (`backend/db/repo/billing/wallet.repository.ts:163-172`) | `backend/services/billing/wallet.service.test.ts:169,208` |
| AC2 admin approve → `completed`, balance effect | `AdminFinancialAuditingService.approveWithdrawal` (`backend/services/billing/admin-financial-auditing.service.ts:185-247`) | journey step 1 (`test/workflows/billing/admin-financial-auditing.journey.test.ts:485-543`) |
| AC3 admin reject → `failed`, balance restored | `AdminFinancialAuditingService.rejectWithdrawal` (`backend/services/billing/admin-financial-auditing.service.ts:268-334`) | journey step 2 (`:546-581`) |
| AC4 amount > balance → rejected | guarded debit returns `null` (`wallet.repository.shared-writer.ts:74-83`) → `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)` (`wallet.service.ts:252`) | `wallet.service.test.ts:208-236`; journey finsec step D (`financial-safety-verification.journey.test.ts:565-593`) |
| AC5 completed/failed rows immutable | settlement-only trigger amendment (`custom_5-teacher-transaction-settlement`) + append-only triggers | `backend/db/test/logic/billing/financial-immutability.test.ts:364-537`; finsec step F (`:714-752`) |

Running this ticket as a from-scratch implementation would **duplicate tested money-path code** — the exact failure mode the ticket directive warns against. This plan therefore **closes the loop**: it re-proves each AC against the live code with `path:line` evidence, green re-runs of the existing suites, and fills the **three genuine gaps** the sweep found (see §Scope) — then leaves an auditable traceability matrix.

### Feature Summary

A verification-scoped plan that proves the teacher withdrawal workflow (request → admin approve/reject → immutable settlement) is fully implemented, race-safe, permission-locked, and test-covered — closing the ticket by evidence rather than by reimplementation.

### Business Value

- Proves INV-W5/INV-W6/INV-W8 (`docs/specs/state-machine-invariants.md:195,196,198`) with evidence, before Milestone 4 "Financial Safety Verification" builds on it (it lists withdrawal drain races as already-covered (`ai/finished_plans/milestone_4_integration_security_launch/financial-safety-verification/specs.md:174`)).
- Closes the last coverage hole in the settlement journey (settle attempt on a `failed` row — the only ticket-AC arm with no journey leg anywhere).
- Rides the "422" wording reconciliation: the shipped denial is a `ConflictError` with transport code `WALLET_INSUFFICIENT_FUNDS` (GraphQL `errors[].extensions.code`; HTTP-surface mapping is a transport concern, REQ-007 documents the reconciliation).
- Repairs two doc drifts the sweep found: the stale DBML `amount >= 0` check (Drizzle says `> 0`) and the superseded debit-at-approval wording in the workflow sequence diagram.

### Scope

**In scope (this plan):**
1. Re-verification of every ticket AC against the live implementation with `path:line` code citations and test citations (`outcome/` evidence files).
2. Green re-runs of the four existing suites that lock this workflow (wallet service, admin settlement service, wallet repo + admin repo, both billing journeys) plus the admin GraphQL wire suite.
3. One **NEW test**: the journey gap-fill — settle attempt (approve + reject) on a `failed` withdrawal row → localized `WITHDRAWAL_NOT_PENDING` conflict, zero audit rows, balance untouched (journey step addition in `test/workflows/billing/`).
4. Two doc repairs: `db/schema.dbml` `teacher_transaction.amount` check `>= 0` → `> 0` (matches Drizzle `teacher_transaction_amount_check`, `backend/db/schema/billing/teacher-transaction.ts:50`); `docs/workflows/03-session-lifecycle-escrow.md` §6.3 sequence diagram wording aligned to the shipped reserve-at-request model.
5. A traceability matrix (REQ → AC → code → test) and the plan-review gate record.

**Out of scope (explicitly NOT this plan):**
- New schema, columns, enums, resolvers, mutations, routes, or UI — none are needed; any discovered gap becomes a `deferred-items.md` row, never scope creep.
- Withdrawal request/response notifications to the teacher (`NotificationType` has no withdrawal members — `backend/enum/notifications/notification-type.enum.ts:10-18`); recorded as resolved-pointer ledger entry (see REQ-008).
- Request-level idempotency keying (forward item F11, `wallet.service.ts:199`); full ledger pagination (F10, `:49`) — both stay recorded forward items.
- Wallet UI work of any kind: teacher wallet page (`app/(dashboard)/wallet/page.tsx`) and admin finance console (`app/(dashboard)/admin/finances/page.tsx`) both ship.
- `db/schema.dbml` sync beyond the one-line `amount` check fix — the dbml-sync backlog belongs to `ai/finished_plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/` (its deferred dbml-sync requirement); do not duplicate.

---

## Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I need a recorded error baseline and a working protocol, so that verification results are attributable and auditable.

#### Acceptance Criteria

1. **REQ-001 (Baseline & Ledger):** WHEN Task 0 starts THEN the agent SHALL record baseline error counts (`bun tsgo` error count, `bun biome:check` warning count, `bun run scripts/lint-service.ts --json --id baseline`) into `/tmp/baseline-*.txt|json`, SHALL initialize `deferred-items.md` in this plan directory from `.agents/spec-process-guide/templates/deferred-items-template.md`, and SHALL write `outcome/0-baseline-outcome.md` documenting the counts.
2. **REQ-002 (Outcome Knowledge Protocol):** WHEN any task starts THEN the agent SHALL first read ALL existing files in `outcome/`; WHEN any task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md`; WHEN any subtask completes THEN the agent SHALL update the checkbox `[ ]` → `[x]` in `tasks.md`.
3. **REQ-003 (Per-File Quality Loop):** WHEN any file is created or modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) on that file before moving on, and SHALL read the auto-discovered AGENTS.md + `.agents/instructions` files the script prints and validate against them.
4. **REQ-004 (Test Runner Discipline):** WHEN any suite is executed THEN the agent SHALL use `bun run test/scripts/run-test.ts <test-path>` (never raw `bun test` on workflows; `test/workflows/AGENTS.md:91-97`), and MAY use `--last --focus "<pattern>"` to read results.

### Requirement 0.5: Translation System & Enum Import Compliance

**User Story:** As a developer touching wallet/billing surfaces, I want compile-time type-safe translations and value-imported enums, so that i18n and type errors surface at build time.

#### Acceptance Criteria

1. **REQ-005 (i18n Handles):** WHEN the plan references translation consumption THEN it SHALL cite the shipped handle pattern: client components use `useAppTranslation(Wallet)` / `useAppTranslation(Errors)` with `NamespaceHandle` constants from `@/shared/locale` (`shared/locale/namespaces/wallet/wallet.namespace.ts:4`, `errors` analogous; `defineNamespace` at `shared/locale/namespaces/define-namespace.ts:8-11`); services use `getServerTranslations(locale).errorsTranslations` (ONE argument — `wallet.service.ts:219`, `admin-financial-auditing.service.ts:191`); resolvers use `ctx.locale` threading. FORBIDDEN: `next-intl`, `getBackendTranslations`, `shared/messages/`, two-arg `getTranslations`, `t('key')` function calls, hardcoded user-facing strings, `console.*`.
2. **REQ-006 (Enum Value Imports):** WHEN `TransactionStatus` / `TransactionType` / `UserRole` appear in any authored test code THEN they SHALL be VALUE imports from `@/backend/enum/billing/transaction-status.enum` (`:5-8`: Pending/Completed/Failed), `@/backend/enum/billing/transaction-type.enum` (`:6-11`: Earning/Withdrawal/Bonus/ArbitrationReversal), `@/backend/enum/users/user-role.enum` (`:5-9`: Admin/Teacher/Student/Parent) — never `import type` and never raw string literals.

### Requirement 1: Teacher Withdrawal Request (Ticket AC1, AC4)

**User Story:** As a certified teacher, I want to request a payout from my wallet, so that I can receive my earnings.

#### Acceptance Criteria

1. **REQ-101 (Pending Ledger Row):** WHEN a teacher with `wallet.balance > 0` requests a withdrawal THEN `WalletService.requestWithdrawal(callerUserId, rawAmount, locale, outerTx?)` (`backend/services/billing/wallet.service.ts:213-218`) SHALL create exactly one `teacher_transaction` row with `type='withdrawal'`, `status='pending'` via `WalletRepository.debitForWithdrawalOnce` (`backend/db/repo/billing/wallet.repository.ts:163-172` → `debitWithLedgerRow(insert, TransactionStatus.Pending, …)`, `wallet.repository.shared-writer.ts:60,66,91`), AND the reserved amount SHALL be debited from `wallet.balance` in the same transaction (guarded UPDATE `balance >= amount`, `shared-writer.ts:74-78`), AND `wallet.total_earning` SHALL NOT change (INV-W2, `wallet_total_earning_check`, `backend/db/schema/billing/wallet.ts:38`).
2. **REQ-102 (Amount Validation):** WHEN the amount does not match `/^\d{1,7}(\.\d{1,2})?$/` or is non-positive THEN the service SHALL reject pre-DB with `ValidationError("WALLET_INVALID_AMOUNT", t.walletInvalidAmount)` (`wallet.service.ts:61,75-86`; key at `shared/locale/en/errors/index.ts:93`, ar `:91`) and zero side effects.
3. **REQ-103 (Insufficient Funds):** WHEN the amount exceeds `wallet.balance` THEN the request SHALL be denied with `ConflictError("WALLET_INSUFFICIENT_FUNDS", t.insufficientBalance)` (`wallet.service.ts:247-252`; key `shared/locale/en/errors/index.ts:90`, ar `:88`) surfaced as `errors[].extensions.code === "WALLET_INSUFFICIENT_FUNDS"` over the GraphQL wire, and ZERO rows SHALL commit (the orphan pending row dies with the rollback — `wallet.service.test.ts:208-236`).
4. **REQ-104 (422 Reconciliation Ruling):** WHERE the ticket says "rejected with 422 'Insufficient wallet balance'" THEN the binding interpretation SHALL be: the GraphQL surface denies with the typed `WALLET_INSUFFICIENT_FUNDS` code + localized message (GraphQL has no per-error HTTP status; `docs/graphql/domain-error-extensions-code.md:9,112`). The literal "422" is transport trivia carried by the REST/HTTP gateway taxonomy (`ERROR_CODE_HTTP_STATUS`, `backend/lib/errors/error-code-taxonomy.ts:45-47` — `VALIDATION: 422`, `CONFLICT: 409`); the client-side routing (`frontend/views/teacher/wallet/useTeacherWalletWithdraw.ts:86-91`) keys on the CODE, not a status. No code change is required for this AC.
5. **REQ-007 (Wire-Code Presence):** WHEN verification runs THEN it SHALL confirm the denial code actually reaches clients over the wire — the teacher UI routes on `WALLET_INSUFFICIENT_FUNDS` (`useTeacherWalletWithdraw.ts:86`) and the SDL/wire suites pin the six wallet root fields (`backend/graphql/test/schema-surface.test.ts:250-252`; `frontend/graphql/test/warnings/warning-surfacing.test.ts:372` inventories `requestWithdrawal`).

### Requirement 2: Admin Approval (Ticket AC2)

**User Story:** As an admin, I want to approve a pending payout, so that the teacher receives their withdrawal.

#### Acceptance Criteria

1. **REQ-201 (Settle Completed):** WHEN an active admin approves a pending withdrawal THEN `AdminFinancialAuditingService.approveWithdrawal(actorUserId, transactionId, locale, outerTx?)` (`backend/services/billing/admin-financial-auditing.service.ts:185-193`) SHALL flip the row to `completed` via ONE guarded UPDATE — `WalletRepository.settleWithdrawalOnce({ transactionId, nextStatus: TransactionStatus.Completed }, tx)` (`wallet.repository.admin.helpers.ts:302-322`; `WHERE id AND type='withdrawal' AND status='pending'`, non-permitted `nextStatus` → `null`) — AND `wallet.balance` SHALL NOT move again (the reserve was debited at request time), AND exactly ONE `Override` audit row with details `{action:"withdrawal_approved", amount, walletId, teacherId}` SHALL be written in the same transaction (`docs/billing/admin-financial-auditing.md:157`; builder `admin-financial-auditing.service.helpers.ts:153`).
2. **REQ-202 (Reserve-at-Request Reconciliation Ruling):** WHERE the ticket gherkin says "wallet.balance is decremented" at approval THEN the binding model SHALL be **reserve at request, settle at decision** — the debit happens at request time and approval settles the reservation (`docs/billing/admin-financial-auditing.md:46-48`; ratified by `ai/finished_plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/plan.md:34-37` D-1 and INV-W5 `docs/specs/state-machine-invariants.md:195`). Observable-equivalent assertions hold: after approve, `balance = pre_request_balance − amount` and the row is `completed` (journey step 1 `:493-494,512`).
3. **REQ-203 (Denial Vocabulary):** WHEN the transaction id is unknown THEN the flow SHALL deny with `NotFoundError("WITHDRAWAL_REQUEST", t.withdrawalRequestNotFound)` (`admin-financial-auditing.service.ts:200-206`; key `shared/locale/en/errors/index.ts:113`); WHEN the row is not a pending withdrawal THEN it SHALL deny with `ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending)` (`:207-214`; key `:114`), zero audit rows.

### Requirement 3: Admin Rejection (Ticket AC3)

**User Story:** As an admin, I want to reject a suspicious payout request, so that funds return to the teacher's wallet.

#### Acceptance Criteria

1. **REQ-301 (Settle Failed + Restore):** WHEN an active admin rejects a pending withdrawal THEN `AdminFinancialAuditingService.rejectWithdrawal(actorUserId, transactionId, reason, locale, outerTx?)` (`admin-financial-auditing.service.ts:268-276`) SHALL flip the row to `failed` via the same guarded settle (`nextStatus: TransactionStatus.Failed`, `:301-305`) AND restore the reserved debit via `WalletRepository.restoreWithdrawalDebitOnce({ walletId, amount }, tx)` (`:317`; `wallet.repository.admin.helpers.ts:331-340` — strictly additive `balance + amount`), atomically in ONE transaction, AND write exactly ONE `Override` audit row with `{action:"withdrawal_rejected", …, reasonPresent:true}` (raw reason text is NEVER persisted — `docs/billing/admin-financial-auditing.md:158`).
2. **REQ-302 (Balance Unchanged Net):** WHEN rejection completes THEN `wallet.balance` SHALL equal the pre-request value (journey step 2 `:563-564` asserts restore-to-before) — the ticket's "balance is NOT decremented" holds in net terms under the reserve model.
3. **REQ-303 (Reason Validation):** WHEN the reason fails the pre-DB normalization (trim + length cap) THEN the flow SHALL deny with the localized validation error BEFORE any database work (`normalizeAdjustmentReason`, `admin-financial-auditing.service.ts:278`).

### Requirement 4: Financial Immutability (Ticket AC5, INV-W6)

**User Story:** As the platform operator, I want decided financial records to be immutable, so that the ledger is audit-trustworthy.

#### Acceptance Criteria

1. **REQ-401 (Immutability Enforcement):** WHEN any attempt is made to modify a `completed` or `failed` `teacher_transaction` row (UPDATE of any frozen column, DELETE, relabeling) THEN the attempt SHALL be rejected by the DB triggers (`3-immutability-triggers.sql` append-only base + `5-teacher-transaction-settlement.sql` settlement-only exception — `backend/db/schema/billing/teacher-transaction.ts:17-27` comment; proven for decided rows by `backend/db/test/logic/billing/financial-immutability.test.ts:364-457` and for settlement-writes on pending rows by `backend/db/test/repo/billing/wallet.repository.admin.test.ts:573-638`) AND the row SHALL read back byte-identical (journey finsec step F, `test/workflows/billing/financial-safety-verification.journey.test.ts:714-752`).
2. **REQ-402 (Service-Level Re-Settle Denial):** WHEN a settle is re-attempted on a decided row (completed OR failed) THEN the guarded settle SHALL miss (`null`) and the service SHALL deny with `ConflictError("WITHDRAWAL_NOT_PENDING", t.withdrawalNotPending)` with zero audit rows — already proven for a `completed` row (`admin-financial-auditing.service.test.ts:803-821`) and the trigger freeze proofs cover raw mutations on pending rows (`wallet.repository.admin.test.ts:574,592`).

### Requirement 5: Authorization, Tenancy & Audit (cross-cutting)

**User Story:** As a security reviewer, I want every withdrawal operation gated and audited, so that no actor can touch another teacher's money.

#### Acceptance Criteria

1. **REQ-501 (Teacher BOLA-Proof Surface):** WHEN a teacher reads or withdraws THEN identity SHALL be ctx-derived only: `myWallet` takes zero arguments and resolves `ctx.user.id` (`backend/graphql/query/billing/wallet.query.ts:46-64`); `requestWithdrawal` accepts an amount-ONLY input `RequestWithdrawalInput { amount: String! }` (`backend/graphql/mutation/billing/wallet.mutation.ts:46-50`) — no wallet id, no balance on the wire (`docs/billing/escrow-and-wallet-crediting.md:97`).
2. **REQ-502 (Role Gates — BFLA):** WHEN any wallet root field executes THEN the Pothos `$all` conjunction SHALL gate it: teacher-only `{ $all: { authenticated: true, role: [UserRole.Teacher] } }` (`wallet.query.ts:52-57`, `wallet.mutation.ts:62-67`); admin-only for approve/reject/adjust + the three admin queries `{ $all: { authenticated: true, role: [UserRole.Admin] } }` (`backend/graphql/mutation/admin/admin-finance.mutation.ts:62-67,89-94,114-119`; `backend/graphql/query/admin/admin-finance.query.ts:66,105,138`). Anonymous → 401 `UNAUTHORIZED`; authenticated wrong-role → 403 `FORBIDDEN` (proven per-role over the wire, `frontend/graphql/test/admin/admin-finance.integration.test.ts:381-543`).
3. **REQ-503 (Governance Gate):** WHEN an admin actor is not active THEN the service SHALL deny pre-settlement via `assertActorAdminActive(actorUserId, locale, tx)` (`admin-financial-auditing.service.ts:194,281`) — the suspended-admin arm is journey-proven (step 5, `admin-financial-auditing.journey.test.ts:719-805`).
4. **REQ-504 (Audit Every Settlement):** WHEN either settle branch completes THEN exactly ONE audit row SHALL share the transaction's fate; WHEN the settle denies THEN zero audit rows SHALL exist (journey steps 1/2/5 assertions on `countAuditsForActor` / audit counts).
5. **REQ-505 (Concurrency — Race Safety):** WHEN two admins settle the same row concurrently (or a settle races a new request on the same wallet) THEN exactly one settle SHALL win the guarded UPDATE and the loser SHALL receive `WITHDRAWAL_NOT_PENDING` (journey steps 6/7, `:806-915`); WHEN two requests race to drain the wallet THEN exactly one debit SHALL land (finsec step D, `:565-593`; repo funds-guard races — arbitration ∥ withdrawal — `wallet.repository.test.ts:780-857`).
6. **REQ-506 (No Notification Side-Effects Today):** WHEN request/settle completes THEN no notification SHALL be emitted (there are no withdrawal `NotificationType` members, `backend/enum/notifications/notification-type.enum.ts:10-18`); journeys assert `publishReceipts` dispatch = 0 (the `expectNoDispatches` oracle, `admin-financial-auditing.journey.test.ts:243-246`; spy installed `:222-228`). Adding withdrawal notifications is a ledger forward item (D2), NOT this plan.
7. **REQ-008 (Forward-Item Ledger Completeness):** WHEN this plan completes THEN every forward item (withdrawal notifications; F11 idempotency keying; F10 pagination; inherited fee-escrow deferrals; INV-W8 wording) SHALL exist as an explicitly-targeted row in `deferred-items.md` (see REQ-702) — no silently-absorbed scope.

### Requirement 6: Gap-Fill, Doc Repairs & Traceability (the additive work)

**User Story:** As the ticket owner, I want the discovered gaps closed and the evidence matrix recorded, so that the ticket closes with a complete audit trail.

#### Acceptance Criteria

1. **REQ-601 (Journey Gap-Fill — Failed-Row Re-Settle):** WHEN the plan executes THEN it SHALL extend the settlement journey with a new leg: after step 2's rejection, re-attempt `approveWithdrawal` AND `rejectWithdrawal` on the now-`failed` row → both deny `WITHDRAWAL_NOT_PENDING` (localized), zero audit rows, wallet balance unchanged. This is the only ticket-AC arm with no journey leg anywhere today (verified: `admin-financial-auditing.journey.test.ts` step 6 covers only the `completed` loser-arm at `:814-829`; `financial-safety-verification.journey.test.ts` step F covers direct-DB UPDATE only). The new leg SHALL follow `test/workflows/AGENTS.md` (committed fixtures, real services, no `runInRollback`, spy on `NotificationEngine.publishReceipts`, run via `bun run test/scripts/run-test.ts`).
2. **REQ-602 (DBML Check Repair):** WHEN the plan executes THEN `db/schema.dbml` `teacher_transaction.amount` check SHALL read `> 0` (currently `>= 0` at `db/schema.dbml:372`) to match the authoritative Drizzle CHECK `teacher_transaction_amount_check` (`amount > 0`, `backend/db/schema/billing/teacher-transaction.ts:50`) — the stricter invariant the tests actually prove (INV-W8 wording at `docs/specs/state-machine-invariants.md:198` says `>= 0`; the DB truth is `> 0`; this repair aligns DBML, and REQ-701 records the doc wording).
3. **REQ-603 (Workflow-Diagram Wording Repair):** WHEN the plan executes THEN `docs/workflows/03-session-lifecycle-escrow.md` §6.3 (:140-161) SHALL be updated so the approve branch documents the shipped reserve-at-request model (reserve at request `:148`; settle at decision; reject restores) instead of the superseded "Deduct from wallet.balance" at approval (`:153`) — preserving the diagram's structure and the audit-trail step.
4. **REQ-604 (Traceability Matrix):** WHEN verification completes THEN the outcome SHALL contain a complete REQ → AC → code `path:line` → test citation matrix covering every REQ in this document, and every REQ number SHALL appear in `tasks.md` (auditable via the traceability grep).
5. **REQ-605 (Verification Re-runs):** WHEN verification completes THEN all re-run suites SHALL be green: `backend/services/billing/wallet.service.test.ts`, `backend/services/billing/admin-financial-auditing.service.test.ts`, `backend/db/test/repo/billing/wallet.repository.test.ts`, `backend/db/test/repo/billing/wallet.repository.admin.test.ts`, `backend/db/test/logic/billing/financial-immutability.test.ts`, `test/workflows/billing/admin-financial-auditing.journey.test.ts`, `test/workflows/billing/financial-safety-verification.journey.test.ts`, `frontend/graphql/test/admin/admin-finance.integration.test.ts` — each executed via `bun run test/scripts/run-test.ts`.

### Requirement 7: Forward Items & Ratified Rulings

**User Story:** As a future implementer, I want the deferred surface explicitly recorded, so that no silently-absorbed scope remains.

#### Acceptance Criteria

1. **REQ-701 (Rulings Ratified):** WHEN Phase 1.5 review runs THEN it SHALL ratify: (a) the §Scope reconciliation (verification-scoped, gaps = one journey leg + two doc repairs); (b) REQ-104 (422 → typed code reconciliation); (c) REQ-202 (reserve-at-request binding over ticket wording); (d) INV-W8 wording (`>= 0` in the invariants doc) vs DB truth (`> 0`) — recorded as a ledger row targeting the invariants-doc owner, not edited by this plan.
2. **REQ-702 (Forward Items Recorded):** WHEN the final gate runs THEN every forward item SHALL exist as a resolved-pointer ledger row in `deferred-items.md` (target owning ticket/plan, status 🔄 Open forward-contract/ruling with a named owner, never open ❌/⚠️ debt): withdrawal notifications (no `NotificationType` members exist), request-level idempotency keying (F11, `wallet.service.ts:199`), full ledger pagination (F10, `:49`), runtime adoption of escrow idempotency-key contract types (inherited ledger row from the fee-escrow plan D1, `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/plan.md:42-45`), `WalletInsertType`/`WalletReturnType` four-shape completion (fee-escrow plan specs D2).

---

## Cross-Actor Workflow Scenario (Journey) — Withdrawal Request → Admin Decision

The ticket spans 2+ actors over shared state (`teacher_transaction` + `wallet`). The shipped journey `test/workflows/billing/admin-financial-auditing.journey.test.ts` encodes it; REQ-601 extends it.

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Teacher | `UserRole.Teacher` | request withdrawal from own wallet (`requestWithdrawal`); read own wallet (`myWallet`) | approve/reject any withdrawal; see other teachers' wallets; pass a wallet id on the wire |
| Admin | `UserRole.Admin` | approve/reject any pending withdrawal; inspect any teacher wallet; adjust wallets | request a withdrawal (teacher-only mutation); act while suspended |
| Student / Parent | other roles | none of the withdrawal surface | all six admin finance operations (403, wire-proven) |

### Ordered Step List (shared state = the withdrawal ledger row + wallet balance)

1. Teacher → `requestWithdrawal(amount)` → one `withdrawal/pending` row created, `balance −= amount` (reserve), ledger refreshed (journey `:488-506`).
2. Admin → queue read `adminPendingWithdrawals` → the pending row surfaces with wallet balance (visibility) (`:499-506`).
3. Admin → `approveWithdrawal(id)` → row `completed`, balance already net-reserved, one audit row; queue drains (`:509-543`) — OR Admin → `rejectWithdrawal(id, reason)` → row `failed`, `balance += amount` restored, one audit row (`:546-581`).
4. Teacher → `myWallet` → observes settled/failed row and correct balance (`:529-532`, `:563-564`).
5. Either admin → re-settle the decided row → `WITHDRAWAL_NOT_PENDING`, zero audit rows (step 6 `:806-848`; REQ-601 adds the `failed`-row arm).

### Cross-Actor EARS Criteria

- WHEN a teacher requests a withdrawal THEN the system SHALL create a pending row AND the admin's queue SHALL surface it (observer: Admin).
- WHEN an admin approves THEN the system SHALL settle the row completed AND the teacher's own wallet view SHALL show the settled row with the reserved balance (observer: Teacher).
- WHEN an admin rejects THEN the system SHALL settle the row failed AND restore the balance the teacher observes.
- IF a non-teacher calls `requestWithdrawal` or a non-admin calls `approveWithdrawal`/`rejectWithdrawal` THEN the system SHALL deny (403 wire-level, zero writes).
- IF an admin re-settles a decided row THEN the system SHALL deny with the localized not-pending conflict and write zero audit rows.

---

## Non-Functional Requirements

### Performance
- **REQ-801:** WHEN the queue or wallet inspector runs THEN pagination SHALL be bounded (`adminPendingWithdrawals` page/pageSize, `admin-finance.query.ts:131-149`; teacher ledger capped at 50, `WALLET_LEDGER_PAGE_LIMIT = 50`, `wallet.service.ts:51`).

### Security
- **REQ-802:** All REQ-501..505 criteria (BOLA/BFLA/governance/audit/races) SHALL be re-proven green, not re-designed.

### Reliability
- **REQ-803:** WHEN any settle leg fails mid-flight THEN the whole transaction SHALL roll back (probe + settle + audit share one transaction — `wallet.repository.test.ts` rollback integrity + service rollback describe `admin-financial-auditing.service.test.ts:846-898`).

---

## Constraints and Assumptions

### Technical Constraints
- Verification plan: NO new production code. The only code-bearing artifact is the journey gap-fill test (REQ-601) and the two doc repairs (REQ-602/603).
- Journey tests MUST follow `test/workflows/AGENTS.md` (no `runInRollback`; committed fixtures; tracked `afterAll` hard-delete; spy at `publishReceipts`; `bun run test/scripts/run-test.ts`).
- GraphQL suites run through `describeGraphqlSuite` + `setupTestServerLifecycle` + `testClient` (`@/test/helpers`).

### Assumptions
- The existing suites are green at baseline (Task 0 records deviations as pre-existing, not introduced).
- No other agent is concurrently editing the two journey files (shared-tree awareness; if a mid-run conflict appears, re-verify in place rather than re-applying).

---

## Success Criteria

### Definition of Done
- [ ] Every REQ-101..402 has a verified `path:line` citation in `outcome/` evidence files.
- [ ] REQ-601 journey leg exists, passes, and the whole billing-journey directory is green.
- [ ] REQ-602/603 doc repairs land and pass their file-appropriate quality loop.
- [ ] All REQ-605 suites re-run green with captured logs.
- [ ] Traceability check passes: every `REQ-[0-9]+` in `specs.md` appears in `tasks.md`.
- [ ] `deferred-items.md` exists with all forward items as resolved pointers (zero ❌/⚠️ at final gate).
- [ ] `outcome/plan-review-R1.md` records the Phase 1.5 verdict + fixes.

### Acceptance Metrics
- Zero new `error TS` beyond baseline (Task 0 comparator).
- Journey directory + the five wallet/settlement suites + admin finance wire suite: 100% pass.
- Ticket AC → evidence matrix: 5/5 ACs covered with code + test citations.

---

## Glossary

| Term | Definition |
|---|---|
| Reserve-at-request, settle-at-decision | Shipped withdrawal economics: balance is debited when the teacher requests; approval settles the reservation (`completed`), rejection restores it (`failed`). Canonical: `docs/billing/admin-financial-auditing.md` §2. |
| Guarded UPDATE | Single-statement `UPDATE … WHERE <state predicate>` that makes the write decision atomically (no read-then-write window). Used for debits (`balance >= amount`) and settles (`type='withdrawal' AND status='pending'`). |
| Settlement-only trigger exception | `custom_5-teacher-transaction-settlement.sql`: the append-only triggers permit ONLY the pending→completed/failed status flip; every other column is frozen (null-safe `IS NOT DISTINCT FROM`); DELETE blocked. |
| `WALLET_INSUFFICIENT_FUNDS` | Typed `ConflictError` code for over-balance requests; rides GraphQL `errors[].extensions.code`; the ticket's literal "422" is transport trivia (REQ-104). |
| Journey test | `test/workflows/` cross-actor test: real services + real DB, committed fixtures, honest role authorization, notification dispatch spied. |
