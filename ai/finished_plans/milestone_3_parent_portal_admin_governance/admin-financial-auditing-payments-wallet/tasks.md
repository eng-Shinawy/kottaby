# Tasks — Admin Financial Auditing (Payments, Wallets, Withdrawal Approval)

<!-- Plan Directory: ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/ -->
<!-- Outcome Directory: ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/outcome/ -->
<!-- Related: specs.md · plan.md · deferred-items.md -->

## Document Information

- **Feature Name**: Admin Financial Auditing (Payments, Wallets, Withdrawal Approval)
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/outcome/`
- **Version**: 1.0 · **Date**: 2026-09-11
- **Related Documents**: `specs.md` (requirements REQ-0…REQ-10) · `plan.md` (decisions D-1…D-5)

## Non-Negotiable Execution Protocol (applies to every task)

1. Read ALL files in `outcome/` BEFORE starting any task.
2. Per-file quality loop `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) after every file modification — auto-discovers + prints the applicable AGENTS.md / instruction files; read & validate against them.
3. Semantic review checklist (race conditions, env-config, dead code, cross-layer, enum value imports, deferred items) before any `[x]`.
4. Write `outcome/<task-id>-outcome.md` after each task; flip the checkbox in THIS file.
5. DB tests: `runInRollback` + `tx` + try/catch error helpers (NEVER `expect.rejects` in rollback). Journeys: NO rollback — committed fixtures + tracked `afterAll` cleanup. Run tests via `bun run test/scripts/run-test.ts <path>`.

> The QL/TE/SEC/SR/IV pipeline subtasks apply to code-producing tasks only; baseline/gate/review/docs tasks (0, 1.5, 2.6, 6.1, 6.2) are exempt by nature.

## Layer → rule-file mapping (sub-loop.ts auto-discovers; listed for reference)

- Backend schema/migration: `backend/AGENTS.md` root; `.agents/instructions/backend.instructions.md`
- Repos / types / enums / services / graphql: layer AGENTS.md under each dir (`backend/db/repo/`, `backend/types/`, `backend/enum/`, `backend/services/`, `backend/graphql/` + `query/`/`mutation/` subdirs)
- Frontend views/app: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `app/AGENTS.md`; `.agents/instructions/frontend.instructions.md`
- Locale: `shared/AGENTS.md` + `shared/locale/AGENTS.md` (alias discipline: `@/shared/locale/...` only)
- Tests: `backend/db/test/AGENTS.md`, `test/workflows/AGENTS.md`, `test/ui/AGENTS.md`; `.agents/instructions/tests.instructions.md`

## Implementation Strategy

Foundation-first with interleaved tests: trigger amendment → types → repo primitives (with their tests) → journey test authored RED → service → GraphQL → documents → UI → journey green. Money correctness rides on single-statement guarded writes; every mutation shares a transaction with its audit row.

### Task 0: Pre-Implementation Baseline & Ledgers

- [x] 0. Establish error baseline + ledgers
  - Run: `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Confirm ledger: `ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/deferred-items.md` (seeded at planning time)
  - Write outcome: `outcome/0-baseline-outcome.md`
  - _Requirements: REQ-0_

### Phase 1.5: Plan Review Gate (MANDATORY — executed during planning)

- [x] 1.5 Review complete plan via @plan-review skill; verdict + fixes recorded in `outcome/plan-review-R1.md`
  - _Requirements: REQ-0_

---

### Phase 2: Backend Foundation

- [x] 2.1 Trigger amendment migration (D-2) + duplicate-dir verification
  - Formally verify the two `custom_4-student-payments-status-transition` dirs (`backend/drizzle/20260907182426_…` / `20260908103411_…`) hold payload-identical SQL; record the diff in the outcome (resolves ledger D1)
  - Author `backend/db/migration/5-teacher-transaction-settlement.sql`: `CREATE OR REPLACE FUNCTION prevent_teacher_transaction_update()` permitting ONLY `pending AND type='withdrawal' → completed|failed` with ALL other columns frozen (`IS NOT DISTINCT FROM`; `updated_at` legitimately changes and is excluded from the freeze — same as the `4-student-payments` precedent)
  - Author the parity variant `5-teacher-transaction-settlement-sqlite.sql` (legacy libsql dialect parity ONLY) AND register it in `EXCLUDED_FILES` at `backend/db/scripts/applyCustomMigrations.ts:58-68` — CRITICAL: an unregistered `*.sql` file gets bundled into the PG pipeline and aborts `bun db migrate`. pglite test DBs consume the PG file (pglite = postgres dialect, PL/pgSQL-supported).
  - Apply via the custom-migration path (`bun db migrate`); do NOT use `db push` for this; confirm the new drizzle custom folder is named `custom_5-teacher-transaction-settlement`
  - Fix the stale schema docblocks that describe the blocked-update trigger: `backend/db/schema/billing/teacher-transaction.ts:17-22` (settlement exception) AND `backend/db/schema/billing/wallet.ts:11-16` (balance is maintained by guarded repo updates, not a trigger)
  - [x] 2.1.QL sub-loop exit 0 on each edited file · [x] 2.1.TE trigger-behavior test: permitted settle passes; re-touch of settled row raises; changed-column settle raises; earning/bonus update raises (PG + pglite capability handling per `withAuditDeleteTriggersSuspended` precedent) · [x] 2.1.SEC no new code path can unfreeze columns · [x] 2.1.SR amendment text no inline `--` hazards in sql`` templates N/A (plain .sql file) · [x] 2.1.IV read printed rule files
  - Outcome: `outcome/2.1-trigger-amendment-outcome.md`
  - _Requirements: REQ-4, REQ-5, REQ-9_

- [x] 2.2 Canonical types
  - Create `backend/types/billing/admin-finance.types.ts` per plan.md (NormalizedAdminPaymentFilters, AdminStudentPaymentRow, page wrappers, AdminWalletTransactionFilters, AdminTeacherWalletReturnType/Probe, AdminWithdrawalQueueRow/Page, WithdrawalSettlementProbe, AdminWalletAdjustmentSubmitInput); export via the `backend/types` barrel
  - [x] 2.2.QL exit 0 · [x] 2.2.TE type-only (no runtime tests) · [x] 2.2.SEC no client data widened · [x] 2.2.SR no duplicate/derivative type definitions of existing shapes · [x] 2.2.IV read printed rule files
  - Outcome: `outcome/2.2-types-outcome.md`
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-6_

- [x] 2.3 Enum + repository primitives + 100% repo tests
  - New `backend/enum/billing/wallet-adjustment-direction.enum.ts` (`Credit`/`Debit`) + barrel exports
  - `backend/db/repo/billing/student-payment.repository.ts`: `listForAdminAudit`, `countForAdminAudit` (students→users join; `escapeLikeWildcards` on name search; newest-first)
  - `backend/db/repo/billing/wallet.repository.ts`: `findAdminWalletProbe`, `listTransactionsForAdmin` + `countTransactionsForAdmin`, `listPendingWithdrawals` + `countPendingWithdrawals` (predicate parity with the analytics counter), `findSettlementProbe`, `settleWithdrawalOnce`, `restoreWithdrawalDebitOnce`, `creditBonusOnce`, `debitAdjustmentOnce`
  - All new READ methods follow the bare-read dual-branch rule: Drizzle select when `tx` supplied, raw parameterized SQL via `queryDb(tx)` when not (`student-payment.repository.ts:113-134` precedent)
  - Tests: CREATE `backend/db/test/repo/billing/` suites (directory does not exist yet — no wallet/student-payment repo tests ship today) — filter matrix, wrong-state misses, guarded-debit miss, freeze violations (via crafted UPDATEs), pagination bounds; run via `bun run test/scripts/run-test.ts`
  - [x] 2.3.QL exit 0 · [x] 2.3.TE Tiers 1-4 (boundary amounts 0/huge/2dp; chaos double-settle; wildcard abuse `%_\`; deny matrix) · [x] 2.3.SEC predicate tenancy & no mass assignment · [x] 2.3.SR atomicity — no read-then-write drift · [x] 2.3.IV read printed rule files
  - Outcome: `outcome/2.3-repo-primitives-outcome.md`
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-9_

- [x] 2.4 Journey test authored TEST-FIRST (expected red until 2.5 lands)
  - Create `test/workflows/billing/admin-financial-auditing.journey.test.ts`: J-W1 approve, J-W2 reject (balance restore asserted), J-ADJ credit+debit (+ insufficient-funds denial), payment-audit filter visibility, denials (non-admin service call → reject), concurrent double-settle race (exactly one winner)
  - Per `test/workflows/AGENTS.md`: real services + real DB, committed fixtures via actor-context helpers + tracked `afterAll` cleanup, NO `runInRollback`, no `expect.rejects`, prefix via `journeyPrefix("billing")` (`jrn_billing_<8hex>`)
  - Immutable-ledger teardown: journey-created `teacher_transaction` rows are DELETE-blocked by trigger — hard-delete them FIRST in `afterAll` inside `withImmutabilityTriggersSuspended(["teacher_transaction"])` (helper in `test/helpers/db-cleanup.ts`), never register them in the tracked-fixture registry; audit rows likewise via `withAuditDeleteTriggersSuspended:83` (precedent: the billing `subscription-purchase` journey's payment cleanup)
  - [x] 2.4.QL / 2.4.TE / 2.4.SEC / 2.4.SR / 2.4.IV
  - Outcome: `outcome/2.4-journey-test-first-outcome.md`
  - _Requirements: REQ-1 … REQ-9 (the journey is the acceptance harness)_

- [x] 2.5 `AdminFinancialAuditingService`
  - New `backend/services/billing/admin-financial-auditing.service.ts` (+ `.helpers.ts`): the six methods from plan.md Component 2; `assertActorAdmin` first inside `withTransaction`; pagination via `resolvePageBounds`; wallet-absent teacher inspection resolves identity via a teacher→user fallback lookup (never fabricates a wallet row); audit contract builders mapping D-4 vocabulary; writes via `AuditService.createAuditLog(contract, tx)` only
  - Service tests (`backend/services/billing/admin-financial-auditing.service.test.ts`): gate matrix, settle/reject/adjust success + audit-row assertions (actionType, entityType/entityId, details vocabulary), validation matrix, rollback integrity, `Promise.allSettled` double-approve race
  - [x] 2.5.QL exit 0 · [x] 2.5.TE Tiers 1-4 · [x] 2.5.SEC BFLA belt, BOPLA strict DTOs, wildcard escaping path · [x] 2.5.SR single-tx atomicity; audit shares commit fate; env-config N/A · [x] 2.5.IV read printed rule files
  - Outcome: `outcome/2.5-service-outcome.md`
  - _Requirements: REQ-1 … REQ-9_

- [x] 2.6 Mid-Point Review Gate (backend-only)
  - Dispatch review-backend / review-types / review-config subagents over the Task 2.1–2.5 diff; fix findings; re-review until zero backend-specific findings; run the affected suites via run-test
  - Outcome: `outcome/midpoint-review-R1.md`
  - _Requirements: REQ-0_

---

### Phase 3: GraphQL Surface

- [x] 3.1 Pothos types/inputs/enum registration + queries + mutations + codegen
  - Pothos objects/inputs (`backend/graphql/pothos/billing/` + `pothos/admin/` per placement convention): `AdminStudentPayment`, `AdminStudentPaymentPage`, `AdminTeacherWallet`, `AdminWithdrawalQueueRow/Page`, filter inputs, `AdjustTeacherWalletInput`; register `WalletAdjustmentDirectionPothosEnum` in `pothos/shared/enum.pothos.ts`; REUSE `TeacherTransactionPothosObject`/`WalletPothosObject` for payloads
  - New `backend/graphql/query/admin/admin-finance.query.ts` (3 query fields) + `backend/graphql/mutation/admin/admin-finance.mutation.ts` (3 mutations): `adminOnlyAuthScopes` + `requireAdminUser`, closed-input whitelist copies (never spread wire args), `ctx.locale` propagation
  - Barrel side-effect imports added; `bun run generate:gqlSchema && bun codegen`
  - `TeacherTransactionPothosObject` is module-private (`pothos/billing/wallet.pothos.ts:86`) — add the one-line `export` (barrel untouched: wallet objects register resolver-transitively)
  - CI-pinned registries updated: `backend/graphql/test/schema-surface.test.ts` frozen inventory (+3 queries, +3 mutations, +1 enum, +new object/input types); `test/workflows/admin/audit-completeness.catalog.ts` — replace deferred row D-002 with three `wired` rows (approve/reject → `override`, adjust → `adjust`), flip `ACTION_TYPE_COVERAGE.Adjust` to `wired`, add producer lanes in `test/workflows/admin/audit-completeness.journey.test.ts` (guard: `backend/db/test/logic/audit/audit-census-drift.test.ts`)
  - GraphQL tests: `frontend/graphql/test/admin/admin-finance.integration.test.ts` via `setupTestServerLifecycle` + `testClient` — anon/non-admin denial bytes per field, SDL surface pinning, settle/adjust happy paths, explicit-id cleanup in `afterAll`
  - [x] 3.1.QL exit 0 · [x] 3.1.TE denial/surface matrix · [x] 3.1.SEC scopes on every field; no public-allowlist additions · [x] 3.1.SR single canonical object types; no local typedefs in pothos files · [x] 3.1.IV read printed rule files
  - Outcome: `outcome/3.1-graphql-outcome.md`
  - _Requirements: REQ-1 … REQ-9_

---

### Phase 4: Frontend Surfaces

- [x] 4.1 GraphQL documents (+ codegen outputs committed)
  - New `frontend/graphql/sharedDocuments/admin/admin-finance.documents.ts`: `adminStudentPaymentsQueryDocument`, `adminTeacherWalletQueryDocument`, `adminPendingWithdrawalsQueryDocument`, `approveWithdrawalMutationDocument`, `rejectWithdrawalMutationDocument`, `adjustTeacherWalletMutationDocument` — `id` first on every object; hooks import from `@apollo/client/react`, `useQuery` only (no `useLazyQuery`); export via the admin barrel; add `.documents.test.ts` sibling
  - Register `keyFields: false` typePolicies for the id-less wrappers (`AdminStudentPaymentPage`, `AdminTeacherWallet`, `AdminWithdrawalQueueRow`, `AdminWithdrawalQueuePage`) in `frontend/providers/apollo/apolloCache.ts` (precedent: `AdminAuditLogPage`)
  - [x] 4.1.QL exit 0 · [x] 4.1.TE document-shape snapshot via generated types · [x] 4.1.SEC no over-selection of sensitive fields · [x] 4.1.SR naming/ barrel conventions · [x] 4.1.IV read printed rule files
  - Outcome: `outcome/4.1-documents-outcome.md`
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-0.5_

- [x] 4.2 Locale: `adminFinance` namespace + error keys (en + ar) + parity
  - 5 touchpoints (`shared/locale/types/adminFinance/`, `en/`, `ar/`, `namespaces/adminFinance/`, registry + both `messages.ts`); dashboard `finances` nav label in `shared/locale/{en,ar}/dashboard/`; error keys `withdrawalRequestNotFound`, `withdrawalNotPending`, `invalidAdjustmentAmount`, `adjustmentReasonRequired` (en + ar)
  - Parity test `shared/locale/adminFinance-namespace.parity.test.ts` mirrors the sibling parity tests; errors parity stays green
  - [x] 4.2.QL exit 0 · [x] 4.2.TE parity tests green · [x] 4.2.SEC N/A · [x] 4.2.SR zero hardcoded strings touched · [x] 4.2.IV read printed rule files
  - Outcome: `outcome/4.2-locale-outcome.md`
  - _Requirements: REQ-0.5, REQ-10_

- [x] 4.3 Admin finances console UI + nav
  - `app/(dashboard)/admin/finances/page.tsx` — `withPageAuth({ roles: [UserRole.Admin] })` + metadata from `getTranslations(locale).adminFinanceTranslations`
  - `frontend/views/admin/finances/`: `AdminFinancesContainer` (tab state from `?tab=`), `PaymentsAuditPanel` + filter bar (MUI-table/directory-scaffold pattern), `WithdrawalQueuePanel` + approve/reject dialogs (reason field on reject), `WalletInspectorPanel` (teacher picker via shipped admin-teachers query + deep-link `?teacherId=`, summary cards, transactions table), Apollo `useQuery`/mutation hooks with cache-refresh on settle/adjust
  - Nav item `finances` in `NAV_ITEMS_BY_ROLE[UserRole.Admin]` (`frontend/views/dashboard/nav/navItems.ts:140-164`)
  - [x] 4.3.QL exit 0 · [x] 4.3.SEC no client-side role trust · [x] 4.3.SR MUI-v9 `sx`-only styling, theme colors, value-import enums · [x] 4.3.IV read printed rule files
  - Outcome: `outcome/4.3-admin-finances-ui-outcome.md`
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-10_

---

### Phase 5: Hardening & Penetration

- [x] 5.1 Journey green + adversarial wave
  - `bun run test/scripts/run-test.ts test/workflows/billing/admin-financial-auditing.journey.test.ts` until green, then the full workflow slice
  - Pen probes: teacher→approve (403), student→adjust (403), anon→all (401), settle non-pending/unknown ids, amount fuzz (negative/zero/over-precision/overflow), reason fuzz (empty/oversize/unicode), wildcard search injection (`%`, `_`, `\`), concurrent settle+request same wallet
  - [x] 5.1.QL / 5.1.TE / 5.1.SEC / 5.1.SR / 5.1.IV
  - Outcome: `outcome/5.1-hardening-outcome.md`
  - _Requirements: REQ-4, REQ-5, REQ-6, REQ-8, REQ-9_

---

### Phase 6: Final Gate & Propagation

- [x] 6.1 Deferred-items enforcement + full quality gate
  - `grep -cE "^\| D[0-9]+ .*(❌|⚠️)" ai/plans/milestone_3_parent_portal_admin_governance/admin-financial-auditing-payments-wallet/deferred-items.md` MUST be 0 (row-scoped: legend definitions and the command itself must not count)
  - `bun quality-gate` green; diff vs `/tmp/baseline-*` shows zero new errors; full slices green (db / services / graphql / workflows / ui)
  - Outcome: `outcome/6.1-final-gate-outcome.md`
  - _Requirements: REQ-0, REQ-9_

- [x] 6.2 Knowledge propagation
  - Create `docs/billing/admin-financial-auditing.md` (settlement model D-1, trigger amendment pattern D-2, adjustment vocabulary D-3, audit mapping D-4, admin pagination contract D-5, trigger-freeze guarantees)
  - Update ONLY touched docs domains (e.g. `docs/specs/state-machine-invariants.md` INV-W5 implementation note) — AGENTS.md / instructions stay untouched
  - Outcome: `outcome/6.2-knowledge-propagation-outcome.md`
  - _Requirements: REQ-0_
