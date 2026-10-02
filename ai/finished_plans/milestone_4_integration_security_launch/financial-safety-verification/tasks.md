# Tasks — Financial Safety Verification (Double-Spend, Escrow Integrity)

<!-- Plan Directory: ai/plans/milestone_4_integration_security_launch/financial-safety-verification/ -->
<!-- Inputs: specs.md (REQ-0…REQ-6) · plan.md (D-1…D-6, C1…C8) · Templates: .agents/spec-process-guide/templates/ -->

## Document Information

- **Feature Name**: Financial Safety Verification (Double-Spend, Escrow Integrity)
- **Target Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/`
- **Outcome Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/`
- **Version**: 1.0 · **Date**: 2026-09-11

## Non-Negotiable Execution Protocol (applies to every task)

1. **Pre-Execution**: read ALL files in `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/`.
2. **Per-file quality loop** after every edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0; auto-prints applicable AGENTS.md + instruction files).
3. **Semantic review checklist** before any `[x]` (ownership/tenancy, atomicity, env-config, dead code, cross-layer, enum value-imports, no raw `bun test` — use `run-test.ts`).
4. **Post-execution**: write `outcome/<task-id>-outcome.md`; flip checkbox here.
5. **Drizzle convention**: schema changes → `bun run db push`; custom SQL only → `bun db migrate`. This plan expects **neither**.
6. **Runner discipline**: db/service tests via `bun run test/scripts/run-test.ts <path>`; journey via the same wrapper on `test/workflows/**`. Never raw `bun test`.

## Layer → rule-file mapping (sub-loop.ts auto-discovers; listed for reference)

| Files touched | AGENTS.md | Instructions |
|---|---|---|
| `backend/db/test/repo/**`, `backend/db/test/logic/**` | `AGENTS.md`, `backend/AGENTS.md`, `backend/db/test/AGENTS.md` | `backend.instructions.md` + `tests.instructions.md` (`.agents/instructions/`) |
| `backend/services/**` (reads only; tests reference) | `backend/services/AGENTS.md`, `backend/AGENTS.md` | `backend.instructions.md` |
| `test/workflows/**` | `test/workflows/AGENTS.md` | `tests.instructions.md` |
| `docs/billing/**` | root `AGENTS.md` | — |

## Implementation Strategy

Verification-only plan (D-1). Sequence: baseline → gap matrix (research) → repo-tier gaps → trigger-tier probes → adversarial journey → matrix ratification + full suites → knowledge propagation. Tests are authored test-first where they exercise shipped behavior: author, run red-capable probes, confirm green against shipped code, and treat any red as a defect finding.

**Phase 2.5 mid-point gate: SKIPPED** — single-discipline (backend test) plan, ≤ 8 tasks, no frontend phase (template: skip when < 10 tasks or frontend-free).

## Implementation Plan

### Task 0: Pre-Implementation Baseline (MANDATORY)

- [x] 0. Establish error baseline and create deferred-items ledger
  - Record baseline counts BEFORE any test authorship:
    `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`;
    `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`;
    `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Confirm `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/deferred-items.md` exists (created with the plan).
  - Baseline suite snapshot: `bun run test/scripts/run-test.ts test/workflows/billing` and wallet service test — capture current green state as reference.
  - Write outcome file: `outcome/0-baseline-outcome.md` documenting counts + suite snapshots.
  - _Requirements: REQ-0_

### Task 1: Verification Gap Matrix (research → outcome)

- [x] 1. Author the financial-safety coverage matrix
  - Read all `outcome/` files first (REQ-0).
  - Produce `outcome/01-verification-gap-matrix.md`: one row per ticket test scenario (6) and per PRODUCTION_READINESS financial row (§1.2, §2.1, §2.2, §2.3, §2.4-ref, §2.5) → mapped to existing test path:line OR "NEW (Task N)".
  - Classify each row: COVERED / PARTIAL / NEW REQUIRED.
  - Pre-verified mapping inputs (from exploration; re-verify during execution):
    - confirm-vs-sweep race → COVERED by `test/workflows/sessions/session-dual-confirmation.journey.test.ts:620`
    - student_payments trigger matrix → COVERED by `backend/db/test/logic/billing/student-payment.repository.test.ts:206-213`
    - concurrent booking double-spend (one-unit race) + same-key replay → COVERED at service tier, real-PG gated: `session-lifecycle.service.test.ts:2314` (REQ-043(d)), `:2346` (REQ-043(e)); journey adds committed-fixture cross-actor tier
    - replay/zero-balance booking → COVERED by `backend/services/classes/session-lifecycle.service.test.ts`
    - wallet repo coverage, withdrawal drain race, teacher_transaction trigger probe, CHECK probes, journey-tier cross-actor flow → NEW (Tasks 2–4)
  - Log out-of-authority findings into `deferred-items.md` (D1–D4 seed rows already drafted).
  - _Requirements: REQ-6, REQ-0_

### Phase 1.5: Plan Review Gate (MANDATORY — executed during planning)

- [x] 1.5 Review complete plan via @plan-review skill
  - Input: `specs.md`, `plan.md`, `tasks.md`; verdict + fixes recorded in `outcome/plan-review-R1.md`.
  - Loop until the review reports no AGENTS.md violations.
  - _Requirements: REQ-0_

### Task 2: Wallet repository coverage & constraint probes

- [x] 2. Create `backend/db/test/repo/billing/wallet.repository.test.ts`
  - 100% lines & functions coverage of `WalletRepository` (per `backend/db/test/AGENTS.md` §14, `bun test --coverage`): `ensureWalletOnce` (create + conflict-idempotent re-enter), `creditEarningOnce` (ledger row + additive balance/total_earning, decimal-string fidelity), `findByTeacherId`, `listTransactionsByWalletId`, `listRecentTransactions` (ordering/limit), `debitForWithdrawalOnce` (success, exact-boundary `balance == amount`, insufficient → null + zero writes) (`backend/db/repo/billing/wallet.repository.ts:45-194`).
  - Constraint probes (savepoint-bracketed, `expectRepoError` + `constraintNameOf`, `backend/db/test/test-utils.ts:77,111`): raw `wallet.balance = -1` → `wallet_balance_check`; `total_earning = -1` → `wallet_total_earning_check`; direct negative `amount` insert → `teacher_transaction_amount_check`.
  - API-surface assertion: `WalletRepository` exposes no update/delete method for `teacher_transaction` (REQ-3 #5).
  - Fixtures via `createTestWallet` / `createTestTeacherTransaction` (`backend/db/test/entity-setup.ts:450,486`); all wrapped in `runInRollback` with `tx` propagation.
  - [x] 2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/test/repo/billing/wallet.repository.test.ts --lifecycle duplicates` → exit 0.
  - [x] 2.TE **Test Engineering**: run `bun run test/scripts/run-test.ts backend/db/test/repo/billing/wallet.repository.test.ts`; Tier-1 coverage of every method/branch; Tier-2 boundaries (0.00, exact-limit, precision); Tier-4 negative probes above.
  - [x] 2.SEC **Security & Tenancy Audit**: probes stay savepoint-contained; no seed data; no cross-fixture reads.
  - [x] 2.SR **Semantic Review**: checklist pass (no `.rejects.toThrow`, all repo calls receive `tx`, decimal strings never parsed).
  - [x] 2.IV **Instruction Verification**: read rule files printed by sub-loop (`backend/db/test/AGENTS.md`, `backend.instructions.md`, `tests.instructions.md`) and validate.
  - Write `outcome/2-wallet-repo-outcome.md`.
  - _Requirements: REQ-4, REQ-6, REQ-3(#5), REQ-0_

### Task 3: Immutability & trigger-tier probes

- [x] 3. Create `backend/db/test/logic/billing/financial-immutability.test.ts`
  - Trigger-presence probe via `pg_trigger`/`pg_proc` for `teacher_transaction`, `student_payments`, `audit_logs` (pattern: `backend/db/test/logic/audit/audit-immutability.test.ts:420-435`).
  - Adversarial probes under savepoint: UPDATE any column on `teacher_transaction` → RAISE EXCEPTION; DELETE → RAISE EXCEPTION; assert error text/class per trigger (`backend/db/migration/3-immutability-triggers.sql:86-113`).
  - Compensating-row doctrine check: a second corrective INSERT succeeds while a mutation of the original fails (proves corrections path).
  - Runtime gating: trigger-tier block is wrapped in `describeTriggerTier = isPgliteProvider() ? describe.skip : describe` (precedent `backend/db/test/logic/audit/audit-immutability.test.ts:418`); a PGlite skip logs a note, never silently skips.
  - Assertion-only (reference) coverage rows for `student_payments` transition guard — do NOT duplicate `student-payment.repository.test.ts:206-213`; assert presence + one fresh tamper probe to pin behavior in the billing suite.
  - [x] 3.QL **Quality Loop**: sub-loop on the file → exit 0.
  - [x] 3.TE **Test Engineering**: `run-test.ts` green; Tier-1 covers both trigger branches (update/delete) per table; Tier-2 includes idempotent re-probe (fails identically on repeat).
  - [x] 3.SEC **Security & Tenancy Audit**: probes are destructive-by-design but savepoint-contained; `runInRollback` wrap; no global trigger manipulation.
  - [x] 3.SR **Semantic Review**: no dead branches; enum value-imports; no `Translation.`/string-literal misuse (N/A here but checked).
  - [x] 3.IV **Instruction Verification**: validate against printed rule files.
  - Write `outcome/3-immutability-outcome.md`.
  - _Requirements: REQ-3, REQ-4(#3 constraint adjacency), REQ-6, REQ-0_

### Task 4: Cross-actor adversarial journey (headline scenarios)

- [x] 4. Create `test/workflows/billing/financial-safety-verification.journey.test.ts` (one journey file, prefixed `jrn_billing_finsec_<uuid8>`)
  - Cast: `provisionStudentActor`, `provisionCertifiedTeacherActor`, `provisionAdminActor` from `test/workflows/helpers/`; committed fixtures in `beforeAll`; full tracked cleanup + zero-residue probes in `afterAll`.
  - **Step A — Double-spend race (REQ-1):** fund student exactly 1 hifz credit; fire N=4 concurrent `createSession` via `Promise.allSettled`; assert exactly 1 fulfilled, lane == 0, exactly one `session` row with `fee_held=true`, all losers classified (INSUFFICIENT_BALANCE/DUPLICATE_REQUEST). Sum-invariant assertions (serialization-safe). Complements — does not duplicate — the real-PG service-tier chaos proof REQ-043(d) (`session-lifecycle.service.test.ts:2314`).
  - **Step B — Escrow cancel release (REQ-2):** cancel the won session; assert lane restored exactly once, ledger row count == 0 for that session; re-attempt cancel → rejected, lane unchanged. `held_balance_lane` still set post-release.
  - **Step C — Dual-confirm credit & consistency (REQ-4):** re-book, teacher completes, student confirms; assert exactly one completed earning row, wallet.balance == fee, and recomputed identity == live wallet (decimal-string compare).
  - **Step D — Withdrawal drain race (REQ-5 #2):** two concurrent `requestWithdrawal` of full balance; exactly one succeeds; final balance == "0.00"; identity re-verified.
  - **Step D2 — Withdrawal input fuzz (REQ-5 #4):** malformed amounts, `"0.00"`, precision-overflow, and over-scale strings rejected by `WITHDRAWAL_AMOUNT_PATTERN` (`wallet.service.ts:61`) before any DB write; wallet row untouched after each rejection.
  - **Step E — Wallet-first-earning race (REQ-5/C8):** fresh teacher, two concurrent earning credits → one wallet row (unique key), both credits reflected (balance == sum).
  - **Step F — Adversarial immutability (REQ-3):** direct tx-level UPDATE on the created earning row inside the journey's own tx → exception observed; row unchanged.
  - **Step G — Denials:** non-participant confirm/cancel and a parent-role wallet read rejected through real auth paths.
  - Notifications: spy at transport boundary where emitters fire (completion prompt); assert no financial notification leaks on cancel/release.
  - [x] 4.QL **Quality Loop**: sub-loop on the journey file → exit 0.
  - [x] 4.TE **Test Engineering**: `bun run test/scripts/run-test.ts test/workflows/billing/financial-safety-verification.journey.test.ts` until green; then `bun run test/scripts/run-test.ts test/workflows` (layer-wide no-regression). Serialized-runtime path logged, never silently skipped.
  - [x] 4.SEC **Security & Tenancy Audit**: honest auth only; per-run prefixed fixtures; no ledger residue; immutability teardown via sanctioned trigger-suspension precedent (`session-dual-confirmation.journey.test.ts:41-45`).
  - [x] 4.SR **Semantic Review**: NO `runInRollback`; no `expect().rejects.toThrow()` (try/catch + translated substrings via `getServerTranslations("en")`); `@/` imports; clean comments (no REQ/task refs in code).
  - [x] 4.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + `tests.instructions.md` (auto-printed), validate.
  - Write `outcome/4-journey-outcome.md` incl. any defect evidence.
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-6, REQ-0_

### Task 5: Matrix ratification & full-suite verification

- [x] 5. Ratify the coverage matrix end-state
  - Update `outcome/01-verification-gap-matrix.md`: every row → COVERED with final path:line (no NEW REQUIRED remaining).
  - Run full layers: `bun run test:services`, `bun run test:db`, `bun run test/scripts/run-test.ts test/workflows` — all green; compare error counts vs `/tmp/baseline-*.txt`.
  - Grep-audit new files for anti-patterns: no `Translation.` enum misuse, no two-arg `getTranslations`, no `@/frontend/utils/logger` in backend, no raw `bun test`, no `.rejects.toThrow` in db tests.
  - Doc-only exemption note: Tasks 5–7 touch only `outcome/*.md` / `docs/**` markdown — the QL gate still applies (sub-loop run), TE/SEC/SR are satisfied by the matrix + baseline-diff assertions in place of executable tests.
  - [x] 5.QL **Quality Loop**: sub-loop `duplicates` lifecycle on the updated matrix doc → exit 0.
  - [x] 5.IV **Instruction Verification**: validate edited docs against sub-loop-printed rule files (root `AGENTS.md` docs rules).
  - Write `outcome/5-matrix-ratification-outcome.md`.
  - _Requirements: REQ-6, REQ-0_

### Task 6: Final quality gate, deferred enforcement & knowledge propagation (MANDATORY)

- [x] 6. Final quality gate & deferred-items enforcement
  - Deferred enforcement (BLOCKING): `grep -c "❌\|⚠️" ai/plans/milestone_4_integration_security_launch/financial-safety-verification/deferred-items.md` → 0 (or every item explicitly re-routed to an owning ticket with ✅-recorded re-route note).
  - Re-run baseline diff: tsgo/biome/lint counts vs `/tmp/baseline-*`; zero new errors.
  - [x] 6.QL **Quality Loop**: sub-loop re-run on every file this plan created → exit 0.
  - [x] 6.IV **Instruction Verification**: confirm each created file passed its auto-discovered rule files (recorded in prior QL outcomes).
  - _Requirements: REQ-0, REQ-6_

- [x] 7. Knowledge propagation & documentation
  - Synthesize all `outcome/` files.
  - Create canonical doc `docs/billing/financial-safety-verification.md` (Why → Verified invariants table with test path:line anchors → how to extend probes → anti-patterns → rollout summary).
  - Rule-file policy: AGENTS.md / `.agents/instructions/` are hand-curated — do NOT edit.
  - Quality loop on the doc file via sub-loop (duplicates lifecycle) → exit 0.
  - [x] 7.IV **Instruction Verification**: root `AGENTS.md` + `.agents/instructions/` untouched (hand-curated); the new doc validated against repo docs conventions.
  - Write `outcome/7-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-6, REQ-0_

## Traceability Summary

| REQ | Tasks |
|---|---|
| REQ-0 | 0, 1, 1.5, 2, 3, 4, 5, 6, 7 |
| REQ-0.5 | 2, 3, 4 (per-task SR/IV subtasks), 5 (anti-pattern grep audit) |
| REQ-1 | 4 (Step A), 5 |
| REQ-2 | 4 (Step B), 5 |
| REQ-3 | 3, 4 (Step F), 2 (API surface), 5 |
| REQ-4 | 2, 4 (Steps C–E), 5 |
| REQ-5 | 4 (Steps A, D, D2, E), 5 |
| REQ-6 | 1, 2, 3, 4, 5, 6, 7 |

## Deferred re-routes (pre-ledgered; see deferred-items.md)

| ID | Finding | Owning ticket |
|---|---|---|
| D1 | No DB unique index preventing duplicate `earning` per `session_id` (guarded app-side only) | Production launch hardening |
| D2 | Arbitration-complete consumes hold without wallet credit | Dispute/economics follow-up |
| D3 | Withdrawal settle/reject flow absent (pending has no terminal transition) | Admin Financial Auditing (Milestone 3) |
| D4 | Schema-push-provisioned DBs lack trigger tier | Ops/migration policy (`docs/admin/audit-trail.md:58` — note: that doc cites a stale journal id; the live tier is `backend/drizzle/20260904084152_custom_3-immutability-triggers/`) |
