# Admin Financial Auditing & Withdrawal Settlement Reference

**Domain:** Billing & Wallets
**Lifecycle Status:** Active

---

## 1. Overview & Architecture

The admin control room over the two money ledgers (`student_payments` + `teacher_transaction`):
a paginated payments audit, per-teacher wallet inspection, a pending-withdrawal settlement queue,
and three financial mutations (`approveWithdrawal` / `rejectWithdrawal` / `adjustTeacherWallet`) —
each mutation composing a guarded ledger/wallet write with exactly one `audit_logs` insert in one
transaction. Everything is additive except one deliberate DB amendment: a narrow settlement
exception in the `teacher_transaction` immutability trigger (§3).

Layer flow stays canonical: page → Apollo hook → Pothos resolver (`adminOnlyAuthScopes` +
`requireAdminUser`) → `AdminFinancialAuditingService` (`assertActorAdmin` re-assertion) →
repository (single-statement guarded writes) → PostgreSQL.

- Service: `backend/services/billing/admin-financial-auditing.service.ts` (+ `.helpers.ts` for
  pure validators/normalizers/audit-contract builders)
- Repositories: `backend/db/repo/billing/wallet.repository.ts` (admin reads + guarded writers),
  `backend/db/repo/billing/student-payment.repository.ts` (admin payment reads)
- GraphQL: `backend/graphql/query/admin/admin-finance.query.ts` (3 queries),
  `backend/graphql/mutation/admin/admin-finance.mutation.ts` (3 mutations)
- Console UI: `/admin/finances` (admin-gated; Payments / Withdrawals / Wallets tabs)

### Key invariants

1. **INV-W5 + amendment (withdrawal lifecycle):** a withdrawal is `pending` until an admin settles
   it to `completed` (approve) or `failed` (reject + refund). The settled state is terminal — no
   re-open, no re-settle (§3, §7).
2. **INV-W6 (ledger immutability):** `teacher_transaction` rows are append-only. The single
   permitted exception is the guarded settlement flip of a pending withdrawal with every other
   column frozen; corrections ride NEW adjustment transactions; `DELETE` is always blocked.
3. **INV-W1 (non-negative balance):** every balance movement is a single guarded SQL statement;
   debits carry `balance >= amount` in the predicate and the `wallet_balance_check >= 0` CHECK is
   the concurrent-overdraw backstop (§7).
4. **Balance accounting:** `balance = Σcompleted earnings + Σcompleted bonuses − Σcompleted
   withdrawals`. Failed rows carry no balance effect; a settled (approved) withdrawal does NOT move
   the balance again (§2).

---

## 2. Settlement Model — Debit on Request, Settle on Decision

Withdrawal economics are **reserve at request, settle at decision**:

1. **Request (teacher self-service, shipped):** `WalletService.requestWithdrawal` inserts ONE
   `teacher_transaction(type='withdrawal', status='pending')` row and debits the wallet balance via
   ONE guarded UPDATE (`balance >= amount` in the predicate) — both on the caller's transaction.
   The reserved amount is locked from the moment the teacher files the request, which prevents a
   backlog of pending requests from overdrawing the wallet.
2. **Approve (admin):** flips the row to `completed` via the guarded
   `WalletRepository.settleWithdrawalOnce` UPDATE — settle-only. The wallet balance NEVER moves
   again: the debit already happened at request time, so approval settles the reservation, it does
   not re-charge it.
3. **Reject (admin):** flips the same row to `failed` via the same guarded UPDATE AND restores the
   reserved debit (`balance = balance + amount`, strictly additive — the `>= 0` CHECK cannot fire,
   so `restoreWithdrawalDebitOnce` carries no lower guard) — atomically in ONE transaction. After
   rejection the balance equals its pre-request value.

All settlement and adjustment writes are single guarded SQL statements with `RETURNING`; the
pending predicate (`WHERE id = ? AND type = 'withdrawal' AND status = 'pending'`) is the
concurrency arbiter, not a probe read. Probe reads (`findSettlementProbe`) exist only for
human-readable error disambiguation and are never trusted for the write decision.

---

## 3. Trigger Amendment — the Settlement Exception

The base `teacher_transaction` BEFORE UPDATE guard
(`prevent_teacher_transaction_update_trigger` → `prevent_teacher_transaction_update()`,
seeded by `backend/db/migration/3-immutability-triggers.sql`) raises on ANY update. The amendment
`backend/db/migration/5-teacher-transaction-settlement.sql` (drizzle folder
`custom_5-teacher-transaction-settlement`, applied via the custom-migration path) replaces the
FUNCTION so the guard permits exactly ONE update shape:

- `OLD.status = 'pending'` — a settled withdrawal (completed/failed) is final;
- `NEW.type = 'withdrawal'` — earning and bonus rows have no lifecycle and stay frozen in every
  direction;
- `NEW.status IN ('completed', 'failed')` — no-op rewrites (`pending → pending`) are rejected;
- every other column frozen via NULL-safe `IS NOT DISTINCT FROM` comparison (`wallet_id`,
  `session_id`, `description`, `amount`, `created_at`) — the correction ban is preserved as a
  column freeze, so a settlement can never redirect funds, rewrite an amount, or relabel the row;
- `updated_at` is the ONE legitimate change: it moves with the settlement via the column's
  Drizzle `$onUpdate` (the `student_payments` precedent has no such column — this is the single
  deviation).

`CREATE OR REPLACE FUNCTION` re-arms the guard in place (the trigger DDL already exists and
executes this function) and is idempotent. The `-sqlite.sql` parity variant targets only the
legacy libsql dialect and is registered in the custom-migration bundler's `EXCLUDED_FILES`
(`backend/db/scripts/applyCustomMigrations.ts`) so it never reaches the PG pipeline; PG and
pglite test DBs both consume the PG file (pglite runs PL/pgSQL).

**What code may and may not update:**

- MAY: `status` (only `pending → completed | failed` on withdrawal rows) and `updated_at` — via
  `WalletRepository.settleWithdrawalOnce` exclusively.
- MAY NOT: any other column, any other row type, any other transition, any re-touch of a settled
  row, and any `DELETE` (the delete guard `prevent_teacher_transaction_delete` is untouched).
  This is why the manual-debit adjustment inserts its ledger row at `completed` directly and why
  rejection's reason text lives ONLY in the audit trail / description-at-request — descriptions
  are write-once.

**Reactive-freeze test approach:** the freeze is verified live, not just by reading the migration —
the repo test suite (`backend/db/test/repo/billing/wallet.repository.admin.test.ts`) attempts a raw
amount rewrite and a changed-column settlement inside a rollback wrapper and asserts the guard
raises (`expectRepoError` try/catch pattern, never `.rejects.toThrow()` inside `runInRollback`).
Permitted settles and settled-row re-touch raising are asserted alongside, plus that earning/bonus
rows still raise on any update.

---

## 4. Adjustment Vocabulary

Manual balance corrections ride the EXISTING `transaction_type` vocabulary — no pgEnum change, no
signed amounts (`teacher_transaction.amount` has a `> 0` CHECK). Direction lives in the service
enum `WalletAdjustmentDirection` (`backend/enum/billing/wallet-adjustment-direction.enum.ts`:
`Credit`/`Debit`) and in the audit details — never as a column.

**Ledger row shapes:**

| Direction | Ledger row | Balance effect | `total_earning` |
|---|---|---|---|
| Credit (bonus) | `type='bonus'`, `status='completed'`, amount = exact decimal string | `+ amount` (strictly additive increment) | UNCHANGED (a bonus is not teaching earnings) |
| Debit (marked withdrawal) | `type='withdrawal'`, `status='completed'` | `− amount` via ONE guarded UPDATE (`balance >= amount` in the predicate); miss → localized `insufficientBalance` conflict with full rollback | UNCHANGED (a debit spends the balance, it does not rewrite lifetime earnings) |

**Description marker convention** (composed in
`admin-financial-auditing.service.helpers.ts`, machine-distinguishable from the shipped
payout-request wording `"Withdrawal request (pending payout)"`):

- Credit: `Manual bonus adjustment: <reason>`
- Debit: `Manual debit adjustment: <reason>`

The ledger row is the ONLY place the reason text is stored (write-once at adjustment time). The
amount must match the decimal grammar `^\d{1,7}(\.\d{1,2})?$` and be strictly positive (nonzero
digit string check — no numeric parse ever touches a money value); the reason is normalized
(trim, ≤ 229 chars — 255 minus the composed-description prefix) before any database work. A wallet-less teacher lazily `ensureWalletOnce`s
(idempotent `INSERT … ON CONFLICT DO NOTHING`) — a wallet-less teacher CAN receive a bonus.

Manual debits never pollute the pending-withdrawal queue or the analytics backlog counter: those
count only `status='pending'` rows, and adjustment rows are born `completed`.

---

## 5. Audit Trail Mapping

Every financial mutation writes exactly ONE `audit_logs` row through the single writer
`AuditService.createAuditLog(contract, tx)` inside the mutation's transaction — commit/rollback
fate is shared, so a rolled-back mutation leaves no ledger row and no audit row, and denials
write ZERO audit rows.

| Mutation | `actionType` | `entityType` | `entityId` | details |
|---|---|---|---|---|
| `approveWithdrawal` | `Override` | `teacher_transaction` | ledger row id | `{action:"withdrawal_approved", amount, walletId, teacherId}` |
| `rejectWithdrawal` | `Override` | `teacher_transaction` | ledger row id | `{action:"withdrawal_rejected", amount, walletId, teacherId, reasonPresent:true}` |
| `adjustTeacherWallet` | `Adjust` | `teacher_transaction` | ledger row id | `{action:"wallet_adjustment", direction:"Credit"\|"Debit", amount, teacherId, walletId, reasonPresent:true, balanceAfter}` |

Exact details key vocabulary (built in
`backend/services/billing/admin-financial-auditing.service.helpers.ts`): `action`, `amount`
(verbatim decimal string), `walletId`, `teacherId`, plus `direction`, `reasonPresent` (BOOLEAN),
and `balanceAfter` (post-write re-read) for adjustments. `balanceAfter` is re-read from the wallet
inside the same transaction.

**Raw reason text is NEVER persisted in audit details** — only the `reasonPresent` boolean. The
reason is validated + normalized at intake and lives only on the ledger description (§4). This
keeps the append-only trail free of free-text and the bounded-context error logs free of reason
content too (`logger.logDomainError` carries `{code, entity, entityId}` only).

**The 2000-char parseable-JSON cap:** `serializeAuditDetails` enforces the
`audit_logs.details` varchar(2000) ceiling WITHOUT ever storing truncated (unparseable) JSON — a
plain slice can cut mid-JSON, so instead the details object is rebuilt with keys dropped
(least-significant first, `action` preserved whenever it can fit) until the serialized form fits;
a pathological overflow falls back to a minimal parseable record.

The existing `/audit` trail (`backend/graphql/query/admin/audit-trail.query.ts`) picks the new
rows up automatically — it reads `audit_logs` generically; the audit-completeness catalog
(`test/workflows/admin/audit-completeness.catalog.ts`) carries the three mutations as `wired`
producers of `Override`/`Adjust` rows.

---

## 6. Admin Pagination Contract

All three list surfaces share one contract:

- **Bounds:** `resolvePageBounds` (`backend/services/admin/user-management.helpers.ts`) — page
  ≥ 1, pageSize clamped to `1..100` (default 25). Out-of-range pages return an honest empty page.
- **Count + page single snapshot:** the paired count and listing run inside ONE transaction at
  `repeatable read` isolation (`readInSnapshot` in the service — the audit-trail precedent), so
  `totalCount` and `items` can never tear across a concurrent producer commit. The surrounding
  identity/probe reads (admin gate, wallet probes, settlement probes) stay best-effort reads
  outside that snapshot — no write decision trusts them. The pending-withdrawal queue
  additionally aggregates `totalAmount` — the WHOLE queue's pending payout sum — inside the
  same snapshot over the same predicate as `items`/`totalCount` (`WalletRepository.sumPendingWithdrawals`),
  so the queue header renders an honest payout total for ANY queue size (the client-side page
  sum it replaced was a partial figure on multi-page queues and had to be hidden there).
- **Ordering:** payments audit and wallet ledger newest-first (`id DESC`); the pending-withdrawal
  queue oldest-first (`createdAt ASC`, `id` as the stable tie-breaker — longest-waiting first,
  so a backfilled row cannot be stranded behind insertion-order rows).
- **Flat `AdminTeacherWallet` shape:** the wallet inspection query returns a FLAT wrapper —
  `balance`/`totalEarning` (nullable pair = honest no-wallet empty state), a constant
  `currency` label (`"EGP"` — the `wallet` table has no currency column), teacher identity,
  and the transaction page fields — NOT the teacher-facing capped `Wallet` object (whose
  `WalletViewType` ledger is capped at 50 rows; admin gets true server-side pagination).
- **Id-less wrappers:** the page/row wrapper types (`AdminStudentPaymentPage`,
  `AdminTeacherWallet`, `AdminWithdrawalQueueRow`, `AdminWithdrawalQueuePage`) carry no `id`
  field, so they are excluded from Apollo cache normalization via explicit `keyFields: false`
  typePolicies in `frontend/providers/apollo/apolloCache.ts` (the `AdminAuditLogPage` precedent) —
  omission leaks normalization warnings. The nested `TeacherTransaction` objects DO carry `id`
  and normalize normally.
- **Wire discipline:** money is always decimal strings; ID args are coerced decimal-ONLY
  (`coerceDecimalSessionId` + `requirePositiveIntId` — no `Number()`-style generosity); filter
  inputs are copied field-by-field into closed service whitelists (never spread); the student
  name search is wildcard-escaped and `%…%`-wrapped by the service, and the repo binds the final
  pattern directly without re-escaping.

---

## 7. Trigger-Freeze Guarantees & Concurrency Model

The two mechanisms are complementary and independent:

1. **Application-level guard (the write decision):** `settleWithdrawalOnce` is a single
   `UPDATE … WHERE id = ? AND type='withdrawal' AND status='pending' … RETURNING`. The pending
   predicate is the concurrency lock — a replayed settlement matches zero rows and the caller
   surfaces the localized not-pending conflict. The repo also defends: any `nextStatus` other than
   `Completed | Failed` returns `null` without touching the row.
2. **DB-level guard (the freeze):** the amended trigger independently re-verifies the column
   freeze and re-raises on any other mutation — including a direct SQL write that skips the
   repository entirely. Even if future code set `status` correctly but touched `amount`, the
   trigger raises.

**Concurrency model — double settle → exactly one winner:** two admins settling the same request
concurrently (the journey race uses `Promise.allSettled` across real connections) serialize on the
guarded UPDATE's row lock; exactly one matches a row and wins, the loser matches zero rows and
receives the not-pending conflict. Exactly one audit row is written — by the winner, inside its
transaction — and the balance moved exactly once (at request time, before either admin acted; a
rejection additionally restores it exactly once, inside the winner's transaction).

Other races are covered by the same discipline:

- A rejection's balance restore racing a NEW withdrawal request debit: both are single
  statement-atomic UPDATEs on the wallet row; PG row lock serializes them; the `balance >= amount`
  debit predicate plus the `>= 0` CHECK hold INV-W1 at all times.
- A debit adjustment racing a concurrent settle: the `balance >= amount` guarded decrement misses
  on insufficient funds → the localized insufficient-balance conflict; the already-inserted ledger
  row dies with the caller's transaction rollback (the ledger row lands FIRST, then the guarded
  debit — rollback removes the orphan).
- No `SELECT FOR UPDATE` is required anywhere — guarded single statements are the repository's
  locking idiom; every write predicate re-asserts the state it read (TOCTOU window = 0).

---

## 8. Sandbox & Testing Lessons (durable)

Short list of environment/test lessons from shipping this feature that stay true for future work:

- **Bun collapses `import { type X }` when X is a class used with `instanceof`.** If a module
  imports `DomainError` (or any error class) with `import type` and later needs
  `err instanceof DomainError`, Bun's type-elision breaks the instanceof chain — import the
  class as a plain VALUE wherever `instanceof` is used.
- **MUI happy-dom dialog testing:**
  - `await screen.findByRole("dialog")` — no `{ hidden: true }`-style options needed.
  - Reach fields through their label association: `within(dialog).getByLabelText(/Rejection
    reason/i)` (MUI renders the test id on the FormControl ROOT, not the input).
  - NEVER pass `{ hidden: true }` to `getByRole` under happy-dom — it hangs the process.
  - Pin dialog close with a deadline poll (`queryByRole("dialog") === null` + sleeps), not
    `waitFor` — the act-wrapper observer churns unbounded across the MUI exit.
  - Mocked Apollo: queue reads are `cache-and-network` and settle hooks refetch after every
    mutation, so mocks need `maxUsageCount: Number.POSITIVE_INFINITY`; mutation mocks must match
    variables EXACTLY (e.g. `{ transactionId, reason }`) or the call never settles.
- **Port 3066:** graphql integration tests run a dev server on port 3066
  (`test/scripts/run-server-tests.ts`, `TEST_PORT` in `test/helpers/graphql-test-helpers.ts`).
  Kill stale `next-server` listeners on 3066 before a run or the server-ready poll burns its
  180 s timeout (protected app ports 3000/4000 are never touched).
- **Immutable-ledger test hygiene:** journeys use committed fixtures + registry teardown;
  `teacher_transaction` rows are DELETE-blocked, so journey teardown hard-deletes them FIRST
  inside `withImmutabilityTriggersSuspended(["teacher_transaction"])` (helper at
  `test/helpers/db-cleanup.ts`; audit rows via `withAuditDeleteTriggersSuspended`) and never
  registers them in the tracked-fixture registry. Service/repo tests use `runInRollback` + `tx`
  passed to every repo call + try/catch error capture (`expectRepoError`) — never
  `.rejects.toThrow()` inside rollback (deadlock hazard).
- **Custom SQL migrations:** any new `backend/db/migration/*.sql` must be considered against the
  bundler's `EXCLUDED_FILES` (sqlite-variant registration); custom SQL applies via
  `bun db migrate`, `db push` is for schema shape only.
- **Sandbox quirk:** scripts importing `@/scripts/lib` transitively load `@/backend/db` and need
  env present BEFORE module load — run type check as
  `bun --env-file=.env.test run tsgo`, lint as
  `bun --env-file=.env.test run scripts/lint-service.ts …`, and migrations via
  `bun --env-file=.env.test run backend/db/scripts/migrate.ts` directly. Test runners
  (`bun run test/scripts/run-test.ts`) load env themselves.

---

## Verification addendum (2026-09-18)

Closed-the-loop verification of this reference (plan: `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/`) re-proved the settlement model end-to-end. Facts landed by that run, all cited against the live tree and the plan's outcome records:

- **Failed-row re-settle denial is journey-proven (step 8, `test/workflows/billing/admin-financial-auditing.journey.test.ts:935-992`).** Re-attempting BOTH `approveWithdrawal` and `rejectWithdrawal` on a settled-`failed` row denies with the localized not-pending conflict (`withdrawalNotPending` via `ConflictError`), leaves the ledger row `failed`, byte-compares the restored balance unchanged, adds zero audit rows, and dispatches nothing.
- **DBML ↔ Drizzle ↔ live DB now agree on the amount bound (three-way agreement).** The `teacher_transaction.amount` DBML annotation was repaired to `amount > 0` (`db/schema.dbml:372`), matching the authoritative Drizzle CHECK (`backend/db/schema/billing/teacher-transaction.ts:50`) and the live-DB `teacher_transaction_amount_check`; the strict bound is test-locked by the zero-amount-movement probe (`backend/db/test/repo/billing/wallet.repository.test.ts:725-742`, `constraintNameOf` === `teacher_transaction_amount_check`).
- **The §6.3 sequence diagram (`docs/workflows/03-session-lifecycle-escrow.md:149-160`) now states the reserve-at-request model** — reserve at request (`:149`), settle the reservation at decision (`:155`), restore on reject (`:160`) — replacing the superseded debit-at-approval wording; structure and audit-trail step preserved, mermaid validation green.
- **Race discipline re-proven on real connections — concurrent double-settle (step 6, `test/workflows/billing/admin-financial-auditing.journey.test.ts:824-865`):** two concurrent approve calls (same admin actor) target the same pending request → exactly one approve wins (the loser receives the localized not-pending conflict), exactly one audit row, and one balance movement — the reserve was already taken at request time, so the winning approve settles the reservation instead of debiting again.
- **settle∥new-request (step 7, `:867-933`):** the SAME-wallet race has NO loser — both legs land valid (A settles `completed`, B files as a fresh `pending` request carrying its own reserved debit) and the final balance arithmetic is exact: `start − A − B` (two request-time reserves; the settle adds no second debit). The guarded pending predicate remains the arbiter (§7), no `SELECT FOR UPDATE` anywhere.
- **Verification evidence base:** 8 suites green this plan-run — **142 tests / 0 failures** (150 executions counting the journey suite's consecutive stability re-run) — captured under real PostgreSQL 17.11 (`DB_PROVIDER=postgres`); consolidated per-suite results and anchors in `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/outcome/verification-matrix.md`; provider-switch record in `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/outcome/environment-addendum.md`.
- **Zero-dispatch withdrawal behavior re-confirmed:** `backend/enum/notifications/notification-type.enum.ts:10-18` defines no withdrawal-related notification type, every settlement journey leg asserts `expectNoDispatches()` plus zero notification rows, and the withdrawal-notification forward contract (notifications deferred to future work) stays recorded in the plan's forward-item ledger (mapped in `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/outcome/verification-matrix.md`).
