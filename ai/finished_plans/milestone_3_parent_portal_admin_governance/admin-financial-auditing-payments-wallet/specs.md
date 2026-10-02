# Requirements — Admin Financial Auditing (Payments, Wallets, Withdrawal Approval)

<!-- Plan Directory: ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/ -->
<!-- Outcome Directory: ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/outcome/ -->
<!-- Related: plan.md · tasks.md · deferred-items.md -->

## Document Information

- **Feature Name**: Admin Financial Auditing (Payments, Wallets, Withdrawal Approval)
- **Ticket**: `docs/planning/TICKETS.md:2564-2615` — Dev 3, Milestone 3, 5 pts
- **Blocked By (ticket-level)**: Teacher Wallet Crediting (Earning Transactions) — SHIPPED inside the finished dual-confirmation plan (`ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/`): earning credit on dual confirmation is live at `backend/services/classes/session-lifecycle.confirmation.ts:49-50` via `WalletRepository.creditEarningOnce` (`backend/db/repo/billing/wallet.repository.ts:64`); teacher self-service wallet view + withdrawal REQUEST already shipped (`backend/services/billing/wallet.service.ts:168,213`).
- **Milestone 3 DoD anchors**: `docs/planning/MILESTONE_PLAN.md:302-304` ("audit all student payments and teacher wallet transactions", "approve/reject withdrawal requests", "issue manual wallet adjustments with audit logging").
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Stakeholders**: Admin (governance operator), Teacher (wallet owner / withdrawal requester), Student (payment source), Trust & Safety / Finance ops.

## Introduction

The platform already moves money: students pay for subscriptions (`student_payments`), session fees are held and released through the dual-confirmation handshake, teacher wallets accumulate earnings, and teachers can file withdrawal requests (debit-on-request, leaving a `pending` ledger row). What the platform does NOT yet have is the **admin control room over those flows**: no query surface to audit payments, no wallet inspection, no settlement of the pending withdrawals teachers have already filed (INV-W5 demands admin approval/rejection; nothing implements it), and no governed channel for manual balance adjustments (bonuses / corrections) — while FR-10.4 (`docs/specs/functional-requirements.md:269-270`) mandates exactly these, and every decision must land in the immutable `audit_logs` trail (A.5, `docs/specs/open-decisions-and-gaps.md:35-39`).

This ticket ships that control room: read surfaces for the two money ledgers, a settlement surface for pending withdrawals, and a manual-adjustment mutation — each mutation writing an audit row in the same transaction.

### Feature Summary

Admin-only financial auditing console: paginated/filterable audit of all `student_payments`, per-teacher wallet inspection (balance, lifetime earnings, full ledger), approval/rejection of pending withdrawal requests with balance settlement, and manual wallet adjustments (bonus credit / recorded debit) — every write audited and every financial invariant (INV-W5/INV-W6) preserved.

### Business Value

- **FR-10.4 compliance** and Milestone-3 DoD coverage (withdrawal approval + financial auditing are gating launch items).
- **Financial integrity**: pending withdrawals cannot linger unbounded; rejections refund reserved balances atomically; INV-W1 (non-negative balance) upheld under concurrency.
- **Accountability**: every admin financial decision is reconstructible from `audit_logs` (`/audit` trail picks the rows up automatically).

### Scope

**In scope**
- Admin GraphQL read surfaces: `adminStudentPayments` (filters + pagination), `adminTeacherWallet` (wallet summary + filterable/paginated transactions), `adminPendingWithdrawals` (queue).
- Admin mutations: `approveWithdrawal`, `rejectWithdrawal`, `adjustTeacherWallet` — each writing exactly one `audit_logs` row in the same transaction.
- DB trigger amendment permitting **only** the withdrawal settlement status flip (`pending → completed | failed` on `type='withdrawal'` rows, all financial/identity columns frozen) — mirroring the `student_payments` precedent (`backend/db/migration/4-student-payments-status-transition.sql`).
- Admin UI: new `/admin/finances` console (Payments audit / Withdrawals queue / Wallet inspector tabs) + sidebar entry, admin-gated.
- i18n: new `adminFinance` namespace (en + ar) + new error keys, with parity tests.
- Repo/service/GraphQL tests, `test/workflows/billing/` journey coverage.

**Out of scope (with owners)**
- Withdrawal REQUEST flow (teacher self-service) — already shipped (`wallet.service.ts:213`); untouched.
- Real-money payout disbursement after approval (Paymob/bank rail execution) — ops concern; approval settles the ledger only.
- Payment-gateway refunds / chargebacks (`PaymentStatus.Refunded` writer) — none exists; stays deferred from the Paymob plan (`ai/plans/milestone_1_core_domain_mvp/` paymob lineage).
- Session escrow disputes/arbitration debits — sibling plan (`ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/`); this console's wallet inspection READS whatever they write.
- Platform analytics counters (already expose `pendingWithdrawals`; unchanged semantics) — `ai/finished_plans/milestone_3_parent_portal_admin_governance/platform-analytics-dashboard/`.
- Teacher-facing wallet UI improvements (the 50-row ledger cap "F10" remains as-is).

## Requirements

### Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an AI agent or developer, I want to establish an error baseline before implementation and track outcomes persistently, so that I can distinguish new issues from pre-existing ones and avoid repeating past research.

#### Acceptance Criteria

1. WHEN feature implementation begins THEN system SHALL record baseline error counts (`bun tsgo` / `bun biome:check` / `bun run scripts/lint-service.ts --json --id baseline`) to distinguish new from pre-existing issues.
2. WHEN feature implementation begins THEN system SHALL create the deferred-items ledger at `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/deferred-items.md` (seeded during planning).
3. WHEN an executing agent starts any task THEN the agent SHALL read ALL existing outcome files in `outcome/` first.
4. WHEN an executing agent completes any task THEN the agent SHALL write `outcome/<task-id>-outcome.md` (research, decisions, cross-file dependencies, carry-overs).
5. WHEN an executing agent completes any subtask THEN the agent SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 before moving on.
7. WHEN any subtask is marked complete THEN the agent SHALL complete the semantic review checklist (race conditions, env-config, dead code, cross-layer imports, enum value imports, deferred items) FIRST — sub-loop.ts cannot detect them.
8. WHEN a Drizzle schema change is needed THEN the agent SHALL use `bun run db push` for schema shape and `bun db migrate` + `backend/db/migration/*.sql` for custom SQL (trigger amendments) — never the reverse.

### Requirement 0.5: Translation System & Enum Import Compliance (verified against the SHIPPED system)

**User Story:** As a developer, I want compile-time safe translations and correct enum imports, so i18n/type errors surface at build time.

#### Acceptance Criteria (verified reality supersedes stale template/AGENTS.md descriptions)

1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(<NamespaceHandle>)` with the namespace handle object (e.g. `useAppTranslation(AdminFinance)`) and property access (`t.someKey`) — NEVER a string-literal namespace, NEVER a `t('key')` call. Real signature: `shared/locale/client/use-app-translation.ts:8-10`.
2. WHEN a server component renders user-facing text THEN it SHALL call `await getTranslations(locale)` (single argument, returns the full tree, `shared/locale/server.ts:15`) and index the tree (`t.adminFinanceTranslations.*`) — NEVER the two-arg form.
3. WHEN a GraphQL resolver or service needs localized text THEN it SHALL use `ctx.t("errorsTranslations")` (namespace loader bound to `ctx.locale`, `backend/graphql/gqlContextFactory.ts:46`) or `getServerTranslations(locale)` in services (see `wallet.service.ts:64`).
4. WHEN the new namespace is added THEN all 5 touchpoints SHALL land: `shared/locale/types/adminFinance/` + `shared/locale/en/adminFinance/` + `shared/locale/ar/adminFinance/` leaves, handle `shared/locale/namespaces/adminFinance/adminFinance.namespace.ts`, registration in `shared/locale/namespaces/registry.ts`, and both `messages.ts` trees; a `shared/locale/adminFinance-namespace.parity.test.ts` SHALL mirror the sibling parity tests.
5. WHEN an enum is used in a runtime expression (case guard, cast, object literal) THEN it SHALL be a VALUE import (never `import type`), and enum members SHALL be used instead of string literals.

**Forbidden (verified anti-patterns):** `Translation.<Ns>` enum (does not exist) · two-arg `getTranslations` · string-literal namespaces · `t('key')` calls · `next-intl` / `getBackendTranslations` / `shared/messages/` · hardcoded UI strings · `@/frontend/utils/logger` (real module: `@/frontend/lib/logger`) · invented `AppDataGrid` (does NOT exist — hand-rolled MUI tables only).

### Requirement 1: Student Payment Audit

**User Story:** As an admin, I want to audit all student payments with filtering and pagination, so that I can trace every collected amount back to its student, gateway, and subscription.

#### Acceptance Criteria

1. WHEN an admin queries the payment audit list THEN the system SHALL return rows from `student_payments` (`backend/db/schema/billing/student-payments.ts:34-59`) with `id`, `studentId` (with the student's display name resolved), `subscriptionId` (nullable — link may be severed), `amount` (decimal string), `currency`, `paymentGateway`, `status`, `createdAt`.
2. WHEN the admin supplies filters THEN the system SHALL support: exact `studentId`, ILIKE student-name search (wildcards escaped via `escapeLikeWildcards`, `backend/lib/db/escape-like-wildcards.ts:37`), exact `status` (`TransactionStatus`-analog `PaymentStatus`), exact `paymentGateway`, and a `createdAt` date range (`from`/`to`).
3. WHEN the admin paginates THEN the system SHALL honor `page`/`pageSize` with bounds `1..100` via the shared `resolvePageBounds` helper (`backend/services/admin/user-management.helpers.ts:298`), returning `{ items, totalCount, page, pageSize }` and an honest empty page when out of range.
4. WHILE any filter is applied THEN the result SHALL stay ordered newest-first (`created_at DESC`) so the most recent financial activity surfaces first.
5. IF the caller is not an authenticated admin THEN the system SHALL reject with the standard anonymous→401 / non-admin→403 split (`adminOnlyAuthScopes`, `backend/graphql/shared/admin-prelude.ts:24`).

**Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-8 gates every surface. · **Assumptions**: `SubscriptionPaymentReturnType` composition mirrors the audit-trail read model.

### Requirement 2: Teacher Wallet Inspection

**User Story:** As an admin, I want to inspect any teacher's wallet and ledger, so that I can reconcile earnings, withdrawals, and adjustments per teacher.

#### Acceptance Criteria

1. WHEN an admin opens a teacher's wallet view THEN the system SHALL return the wallet row (`balance`, `totalEarning` as decimal strings) from `wallet` (`backend/db/schema/billing/wallet.ts:17-37`) plus the teacher's identity (name/email) — creating/ ensuring rows on read is FORBIDDEN (inspection is read-only; a teacher without a wallet row renders an honest empty state).
2. WHEN the admin lists the wallet's transactions THEN the system SHALL return `teacher_transaction` rows (`backend/db/schema/billing/teacher-transaction.ts:26-49`) with `id`, `type` (earning/withdrawal/bonus), `status` (pending/completed/failed), `amount`, `description`, `sessionId` (nullable), `createdAt`, newest-first.
3. WHEN the admin filters transactions THEN the system SHALL support exact `type`, exact `status`, and a `createdAt` date range, with the same `resolvePageBounds` pagination contract as REQ-1.
4. WHEN the admin supplies a `teacherId` with no wallet row THEN the system SHALL return a null-wallet payload (NOT an error) so the inspector renders "no wallet activity yet".

**Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-8. · **Assumptions**: the teacher-facing capped ledger view (`WalletViewType`, 50-row cap, `backend/types/billing/wallet.types.ts:13-16`) is NOT reused for admin inspection — admin gets true server-side pagination.

### Requirement 3: Withdrawal Decision Queue

**User Story:** As an admin, I want a queue of pending withdrawal requests, so that I can work through teacher payout requests systematically.

#### Acceptance Criteria

1. WHEN an admin opens the withdrawal queue THEN the system SHALL list every `teacher_transaction` with `type='withdrawal' AND status='pending'` — matching the analytics counter semantics (`backend/db/repo/admin/platform-analytics.repository.ts:427-434`) — joined with the teacher's display name and current wallet balance.
2. WHEN the queue renders THEN rows SHALL be ordered oldest-first (longest-waiting first) or expose the ordering explicitly; an empty queue SHALL be an honest empty state, not an error.
3. WHEN the admin pages the queue THEN the same `{ items, totalCount, page, pageSize }` contract applies.
4. IF a queue row is settled elsewhere (another admin) before the admin acts THEN the settle attempt SHALL fail closed with a not-pending conflict (see REQ-4 AC4 / REQ-9 AC2).

### Requirement 4: Withdrawal Approval (settlement of a reserved debit)

**User Story:** As an admin, I want to approve a pending withdrawal, so that the teacher's reserved funds are settled as paid out.

#### Acceptance Criteria

1. WHEN an admin approves a `pending` withdrawal transaction THEN the system SHALL flip the row to `status='completed'` via a single guarded UPDATE (`WHERE id=? AND type='withdrawal' AND status='pending'`) inside one transaction — the ONLY update the amended trigger permits (plan D-2).
2. WHEN approval lands THEN the wallet balance SHALL NOT move again — the debit already happened at request time (`wallet.service.ts:213-257`, debit-on-request); approval settles the reservation. (Reconciliation of ticket gherkin "wallet.balance is decremented" with shipped behavior: plan D-1.)
3. WHEN approval lands THEN the system SHALL insert exactly one `audit_logs` row (in the same transaction) with `actionType='override'`, `entityType='teacher_transaction'`, `entityId=<transaction id>`, and JSON details `{action:"withdrawal_approved", amount, walletId, teacherId}` (contract: `backend/types/contracts/admin-audit.contract.types.ts:22-35`).
4. IF the transaction row is not a pending withdrawal (wrong id, already settled, or non-withdrawal type) THEN the guarded UPDATE SHALL miss and the system SHALL throw a localized not-pending conflict, rolling back everything (including the audit row candidate).
5. IF two admins approve the same request concurrently THEN exactly one SHALL win the guarded UPDATE; the loser SHALL receive the not-pending conflict (REQ-9).

### Requirement 5: Withdrawal Rejection (refund of the reserved debit)

**User Story:** As an admin, I want to reject a pending withdrawal with a recorded reason, so that reserved funds return to the teacher's balance.

#### Acceptance Criteria

1. WHEN an admin rejects a `pending` withdrawal THEN the system SHALL, in ONE transaction: (a) flip the row to `status='failed'` (guarded UPDATE as in REQ-4), and (b) restore the wallet balance (`balance = balance + amount`) — compensation for the request-time debit.
2. WHEN rejection lands THEN the system SHALL insert one `audit_logs` row (`actionType='override'`, details `{action:"withdrawal_rejected", amount, walletId, teacherId, reasonPresent:true}`) in the same transaction.
3. WHEN the teacher (or analytics) reads the wallet after rejection THEN the balance SHALL equal its pre-request value — invariant `balance = Σcompleted earnings + Σcompleted bonuses − Σcompleted withdrawals` holds because failed rows carry no balance effect (TICKETS invariant at `docs/planning/TICKETS.md:3014`).
4. IF the transaction is not pending THEN the rejection SHALL fail closed exactly as REQ-4 AC4.
5. WHEN an admin supplies a rejection reason THEN it SHALL be normalization-validated (trim, length cap) and referenced (boolean, not the raw text) in audit details; the raw reason is NOT stored on the ledger row (descriptions are write-once at request time).

### Requirement 6: Manual Wallet Adjustment (bonus credit / recorded debit)

**User Story:** As an admin, I want to issue manual wallet adjustments with a mandatory reason, so that legitimate corrections and bonuses are possible without violating ledger immutability (INV-W6).

#### Acceptance Criteria

1. WHEN an admin issues a **credit** adjustment THEN the system SHALL insert a `teacher_transaction` row with `type='bonus'`, `status='completed'`, the exact decimal amount, and the reason-bearing description, AND increment `wallet.balance` in the same transaction (`totalEarning` unchanged — a bonus is not teaching earnings).
2. WHEN an admin issues a **debit** adjustment THEN the system SHALL insert a `teacher_transaction` row with `type='withdrawal'`, `status='completed'`, a machine-distinguishable description marker (manual adjustment, not a payout), AND a guarded balance decrement (`WHERE balance >= amount`) — mirroring the re-evaluation-deduction precedent (`docs/planning/TICKETS.md:2153-2159`) and the dispute plan's compensating-row convention (D-5, `ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/plan.md:54-63`).
3. WHEN either direction lands THEN the system SHALL insert one `audit_logs` row with `actionType='adjust'` (ticket AC), details `{action:"wallet_adjustment", direction, amount, teacherId, walletId, reasonPresent, balanceAfter}`.
4. IF a debit adjustment exceeds the wallet balance THEN the guarded UPDATE SHALL miss and the system SHALL throw the localized `insufficientBalance` conflict with full rollback.
5. IF the amount fails the decimal grammar (`^\d{1,7}(\.\d{1,2})?$`, nonzero — the `WITHDRAWAL_AMOUNT_PATTERN` discipline at `wallet.service.ts:61`) or the reason is empty/oversized THEN the system SHALL reject pre-DB with localized validation errors.
6. IF the target teacher has no wallet row THEN the system SHALL lazily `ensureWalletOnce` (idempotent, `wallet.repository.ts:45`) before applying — a wallet-less teacher CAN receive a bonus.

### Requirement 7: Immutable Audit Logging of Financial Decisions

**User Story:** As a compliance stakeholder, I want every admin financial decision in the append-only audit trail, so that disputes and reviews can reconstruct who did what, when, and why.

#### Acceptance Criteria

1. WHEN any mutation of REQ-4/5/6 succeeds THEN exactly one `audit_logs` row SHALL exist with the mutation's acting admin as `actorId` — written via the single writer `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82-90`) inside the same DB transaction (commit/rollback fate shared).
2. WHEN an audit row is written THEN `details` SHALL be JSON with a stable vocabulary (`action`, `transactionId`, `walletId`, `teacherId`, `amount`, plus `direction`/`reasonPresent` where applicable), defensively truncated to the varchar(2000) ceiling by the writer.
3. WHEN anyone attempts to UPDATE/DELETE an audit row THEN the DB triggers SHALL raise (`backend/db/migration/3-immutability-triggers.sql:29-53`) — this feature adds NO writer that could violate the append-only contract.
4. WHEN an admin browses the existing `/audit` trail THEN the new financial decisions SHALL appear there with zero additional work (the trail reads `audit_logs` generically: `backend/graphql/query/admin/audit-trail.query.ts`).

### Requirement 8: Security & Authorization

#### Acceptance Criteria

1. WHEN any REQ-1..6 surface is called by an anonymous user THEN the system SHALL return the framework 401 (`authenticated` scope, `backend/graphql/pothos/builder.ts:122-141`).
2. WHEN any REQ-1..6 surface is called by an authenticated non-admin (teacher/student/parent) THEN the system SHALL return 403 — `$all:{authenticated, role:[UserRole.Admin]}` AND the service-layer belt `assertActorAdmin` (`backend/services/admin/admin-gate.helpers.ts:114`) which re-loads the actor row (deleted/blocked admins fail closed).
3. WHEN list filters carry free-text (student name search) THEN wildcard characters (`%`, `_`, `\`) SHALL be escaped before reaching LIKE/ILIKE (BO-SI rule).
4. WHEN mutation inputs arrive THEN they SHALL map through strict DTOs (no `{ ...input }` spread into Drizzle writes — BOPLA defense).
5. WHEN a teacher targets another teacher's wallet/withdrawal THEN the design SHALL make it impossible: the surfaces derive ownership from explicit admin-only parameters, never from `ctx.user.id`.

### Requirement 9: Concurrency & Financial Invariants

#### Acceptance Criteria

1. WHEN two admins settle the same withdrawal concurrently THEN exactly one guarded UPDATE SHALL succeed (predicate `status='pending'`) and the loser SHALL receive the not-pending conflict.
2. WHEN a rejection's balance restore races a NEW withdrawal request debit on the same wallet THEN row-level serialization of the guarded UPDATEs SHALL keep `balance >= 0` (CHECK constraint + `balance >= amount` debt guards — INV-W1).
3. WHEN any REQ-4/5/6 mutation aborts mid-flight THEN the transaction SHALL roll back fully — no ledger row without balance effect, no audit row without the mutation.
4. WHILE the amended trigger is live THEN any UPDATE that is not the exact permitted settlement shape SHALL still raise (frozen columns verified by BOTH the trigger and a dedicated test via the pattern of `backend/db/test/logic/audit/audit-immutability.test.ts`).

### Requirement 10: UX / Navigation

#### Acceptance Criteria

1. WHEN an admin opens the console THEN the route SHALL be `/admin/finances` guarded by `withPageAuth({ roles: [UserRole.Admin] })` (precedent: `app/(dashboard)/admin/users/page.tsx:30-33`) with the role-mismatch redirect behavior of `frontend/lib/auth/withPageAuth.ts`.
2. WHEN the page renders THEN it SHALL show three tabs: **Payments audit**, **Withdrawal queue**, **Wallet inspector** (tab state in the URL query for deep-linking).
3. WHEN the admin sidebar renders for `UserRole.Admin` THEN a `finances` item SHALL appear in the admin nav group (`frontend/views/dashboard/nav/navItems.ts:140-164`) with an en/ar label — inserted after the billing-adjacent entries.
4. WHEN lists render THEN they SHALL use the established hand-rolled MUI table/directory pattern (`frontend/views/admin/users/directory/DirectoryTable.tsx`, `DirectoryTableScaffold`) with desktop table + mobile card/list rendering — AppDataGrid does NOT exist and SHALL NOT be referenced.
5. WHEN the wallet inspector needs a teacher THEN it SHALL accept a deep-linked `?teacherId=` and provide a teacher picker fed by the existing admin teachers query (`backend/graphql/query/admin/admin-teachers.query.ts`).
6. WHEN any user-facing string renders THEN it SHALL come from the `adminFinance` namespace (or shared `errors`) in BOTH locales — zero hardcoded copy.

## Cross-Actor Workflow Scenarios (Journeys)

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|-------|------|--------|-----------|
| Admin | `admin` | audit payments; inspect wallets; approve/reject withdrawals; issue adjustments; read the audit trail | modify posted ledger rows; overdraw a wallet |
| Teacher | `teacher` | request withdrawals (shipped); observe own wallet/ledger (shipped) | approve/reject; see other wallets; adjust anything |
| Student | `student` | their payments appear in the audit list | see the admin console; any withdrawal surface |
| Parent | `parent` | — | everything here |

### Journey J-W1 — Approve withdrawal
1. Teacher → `requestWithdrawal(amount)` [SHIPPED] → `teacher_transaction(pending)` + balance reserved.
2. Admin → opens queue → sees the pending row (type=withdrawal, amount, teacher name, current balance).
3. Admin → `approveWithdrawal(id)` → row flips `completed`; one `audit_logs(override)` row; balance unchanged (already reserved).
4. Teacher → views wallet → ledger shows the withdrawal `completed`; balance matches reserved debit.

### Journey J-W2 — Reject withdrawal
1. Teacher → `requestWithdrawal(amount)` [SHIPPED] → pending row + reserved balance.
2. Admin → queue → `rejectWithdrawal(id, reason)` → row flips `failed`; balance restored (+amount); one `audit_logs(override)` row.
3. Teacher → views wallet → balance equals pre-request value; ledger shows the `failed` row.

### Journey J-ADJ — Manual adjustment
1. Admin → `adjustTeacherWallet(teacherId, amount, Credit, reason)` → `bonus/completed` row; balance increases; `audit_logs(adjust)` row.
2. Admin → `adjustTeacherWallet(teacherId, amount, Debit, reason)` with balance ≥ amount → `withdrawal/completed` row (manual-adjustment marker); balance decreases; `audit_logs(adjust)` row.
3. Teacher → views wallet → new ledger rows visible; analytics/admin queue counters unaffected (no `pending` rows involved).

### Cross-Actor EARS criteria
- WHEN the teacher requests a withdrawal THEN the system SHALL reserve the amount AND surface the request in the admin queue.
- WHEN the admin approves THEN the system SHALL settle the row AND the teacher SHALL see it `completed`.
- WHEN the admin rejects THEN the system SHALL restore the teacher's balance AND mark the row `failed`.
- IF a non-admin attempts any of these actions THEN the system SHALL reject with 403 (authenticated) / 401 (anonymous).
- IF an admin double-clicks approval (two concurrent settles) THEN the system SHALL settle exactly once.

## Non-Functional Requirements

### Performance Requirements
- WHEN the admin lists payments or transactions THEN pages SHALL be bounded (pageSize ≤ 100) and indexed columns used (existing indexes: `student_payments.student_id`, `teacher_transaction.wallet_id`) — count+page run in one repeatable-read transaction per the audit-trail precedent.
### Security Requirements
- REQ-8 is exhaustive; additionally: money is ALWAYS decimal strings over the wire (never floats); audit details never embed full free-text reasons (presence booleans only).
### Reliability Requirements
- WHEN a mutation errors THEN zero partial side effects survive (single-transaction discipline).
### Usability Requirements
- WHEN copy renders THEN it SHALL be locale-complete in en + ar (RTL-safe layout), with localized error surfaces (`errors` namespace).

## Constraints and Assumptions

### Technical Constraints
- `teacher_transaction` UPDATE is trigger-blocked today — settlement REQUIRES the trigger amendment (plan D-2); until the migration lands, no approve/reject code can pass integration tests.
- Custom SQL migrations apply in alphabetical filename order; the new file MUST sort after `4-*` (name: `5-teacher-transaction-settlement.sql`). The `-sqlite.sql` parity variant serves ONLY the legacy libsql dialect and MUST be registered in `EXCLUDED_FILES` (`backend/db/scripts/applyCustomMigrations.ts:58-68`); pglite test DBs consume the **PG** file (pglite runs the postgres dialect and supports PL/pgSQL triggers).
- The two `custom_4-student-payments-status-transition` drizzle dirs (`20260907182426_…`, `20260908103411_…`) are a pre-existing naming collision — payload-identical (confirmed at plan review R1); Task 2.1 records the formal verification.

### Business Constraints
- Approval does NOT execute a real-world payout — it settles the ledger; disbursement is ops (out of scope).
- Bonus adjustments do not alter `totalEarning` (lifetime teaching earnings metric stays pure).

### Assumptions
- Wallet rows may not exist for never-credited teachers; inspection and adjustment handle the absent-row case explicitly.
- `currency` renders from the payment row (`student_payments.currency`); wallet rendering uses the platform constant ("EGP") as the shipped wallet Pothos object does.

## Success Criteria

### Definition of Done
- [ ] All acceptance criteria REQ-1..REQ-10 verified by tests (repo, service, GraphQL, journey, UI)
- [ ] Ticket test scenarios all green (payments audit, wallet inspection, approve, reject, bonus, non-admin 403)
- [ ] Trigger amendment applied on both PG and pglite paths without disturbing the frozen-column guarantees
- [ ] `bun quality-gate` green; zero new errors vs baseline
- [ ] Milestone-3 DoD lines 302-304 satisfied

## Glossary

| Term | Definition |
|------|------------|
| Reserved debit | The balance reduction applied at withdrawal REQUEST time (shipped), pending admin settlement |
| Settlement | The admin decision flipping a pending withdrawal to `completed` (approve) or `failed` (reject + refund) |
| Adjustment | Admin-initiated balance change recorded as a ledger row (`bonus` credit / marked `withdrawal` debit) |
| INV-W5 | Withdrawal lifecycle: pending → completed / failed (admin) — `docs/specs/state-machine-invariants.md:179` |
| INV-W6 | Financial immutability; corrections via new transactions — `docs/specs/state-machine-invariants.md:180` |
| FR-10.4 | Admin financial auditing mandate — `docs/specs/functional-requirements.md:269-270` |
| A.5 | audit_logs append-only decision — `docs/specs/open-decisions-and-gaps.md:35-39` |
