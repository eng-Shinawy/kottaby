# Implementation Tasks: Teacher Withdrawal Workflow & Admin Approval (Close-the-Loop Verification)

> **Plan of record:** `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/`
> **Specs:** `specs.md` REQ-001..REQ-803 · **Design:** `plan.md` D1–D5
> **Ticket:** "Teacher Withdrawal Workflow & Admin Approval" (`docs/planning/TICKETS.md:1799-1846`) · Dev 3 · Milestone 2 · 5 SP · Blocked By "Teacher Wallet Crediting" (SHIPPED, test-locked)
> **Deliverables in this directory:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md` · `outcome/`

**Plan kind:** close-the-loop verification — all five ticket ACs already ship; this plan proves them, closes the ONE journey-coverage hole (settle-on-`failed`), repairs two stale doc wordings (plus the knowledge-propagation addendum from task 4.3), and records the forward-pointer ledger. Zero new production code except one journey-test leg.

## Non-Negotiable Execution Protocol

1. **Pre-execution read:** before ANY task, read ALL files under `ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/outcome/` (baseline, review verdicts, prior task outcomes).
2. **Per-file quality loop:** after every file edit run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before moving on.
3. **Test commands:** every suite runs via `bun run test/scripts/run-test.ts <test-path>` (NEVER raw `bun test` on workflows — `test/workflows/AGENTS.md:91-97`); `--last --focus "<pattern>"` for reading results. Journey tests: committed fixtures + tracked cleanup, NO `runInRollback`; DB/service tests DO use `runInRollback` + `tx`.
4. **Outcome write-back:** after each task, write `outcome/<task-id>-outcome.md`; flip the checkbox only after its gates pass.
5. **Semantic review:** complete the SR checklist per subtask (atomicity, env-config, dead code, cross-layer imports, value-imported enums, zero plan-artifact references in code comments).
6. **Fix-or-report:** fix violations inside your assigned file; cross-file dependencies are reported to the orchestrator in the outcome file.

## Layer → Instructions Mapping (applies to every task)

| Path prefix | Read before editing |
|---|---|
| `test/workflows/` | `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` |
| `db/schema.dbml` | root `AGENTS.md` (documentation file; no TS layer rules) |
| `docs/` | root `AGENTS.md` doc conventions only |

(`scripts/health/sub-loop.ts` auto-prints the exact set per file — follow its output.)

---

## Phase 0 — Baseline & Gate

### - [x] 0.1 Baseline & Ledger — `outcome/0-baseline-outcome.md`, `deferred-items.md`
- Record baseline counts BEFORE any edit: `bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline` — into `/tmp/baseline-*.txt|json` and echoed into the outcome file.
- Confirm `deferred-items.md` D1–D7 rows exist and are accurate.
- _Requirements: REQ-001_
- [x] 0.1.QL **Quality Loop**: not a code task — no sub-loop run; record raw command output in the outcome.
- [x] 0.1.TE **Test Engineering**: n/a.
- [x] 0.1.SEC **Security & Tenancy Audit**: n/a.
- [x] 0.1.SR **Semantic Review**: baseline numbers quoted from real command output, never from memory.
- [x] 0.1.IV **Instruction Verification**: root `AGENTS.md` quality-workflow section re-read.

### - [x] 0.2 Plan-Review Gate — `outcome/plan-review-R1.md`
- The planning session already recorded the Phase 1.5 verdict in `outcome/plan-review-R1.md` — read it; if implementation reveals drift, re-run the review and record R2 before continuing.
- _Requirements: REQ-701_
- [x] 0.2.QL/.TE/.SEC: n/a (verification task).
- [x] 0.2.SR **Semantic Review**: any spec↔code drift discovered during execution is written back into specs/plan/tasks in the same commit.
- [x] 0.2.IV **Instruction Verification**: `.agents/spec-process-guide/` templates re-read.

---

## Phase 1 — Journey Gap-Fill (the ONE uncovered ticket-AC arm)

### - [x] 1.1 Journey Leg: Re-Settle on a `failed` Withdrawal — `test/workflows/billing/admin-financial-auditing.journey.test.ts` (EXTEND) · `outcome/1.1-journey-gapfill-outcome.md`
- Append a **step-8 leg** inside the EXISTING describe (same file, same cast, same `TrackedFixtures` registry, same `publishReceipts` spy — NO new journey file, NO new cast, NO registry changes). This is the only ticket-AC arm with no journey leg anywhere today: step 6 covers the `completed` loser-arm only (`:814-829`); finsec step F covers direct-DB UPDATE only (`test/workflows/billing/financial-safety-verification.journey.test.ts:714-752`).
- Leg steps (insert AFTER step 7, keeping existing steps 1–7 byte-identical — diff-check step bodies before finishing):
  1. Fund check: read teacherB's wallet row (`readWalletRow(teacherB.userId)`) and record the balance (wallet was funded 300.00 at `:392`; earlier steps' net effect is already asserted there — this leg needs its OWN fresh withdrawal).
  2. Teacher (teacherB) requests a withdrawal (`WalletService.requestWithdrawal(teacherB.userId, PAYOUT_PRIMARY, LOCALE)` with a new constant `PAYOUT_REJECTED_REPLAY = "60.00"` — add beside `PAYOUT_RACED` at `:150`); capture the pending row via `newestPendingWithdrawal(requested.transactions)`; push its id onto `ledgerTxnIds` (`:170` — the append-only teardown registry).
  3. Admin rejects it (`AdminFinancialAuditingService.rejectWithdrawal(adminActor.userId, pending.id, prefixedReason("failed-row replay probe"), LOCALE)`) → assert `rejected.status === TransactionStatus.Failed` and one `Override` audit row (`readAuditsForTransaction`, `:335`).
  4. **The gap-fill arms** — re-attempt BOTH settles on the now-`failed` row:
     - `AdminFinancialAuditingService.approveWithdrawal(adminActor.userId, pending.id, LOCALE)` → catch via `expectJourneyError` (`:255`) → `ConflictError` + `error.message` contains `ERRORS_EN.withdrawalNotPending` (`:131`).
     - `AdminFinancialAuditingService.rejectWithdrawal(adminActor.userId, pending.id, prefixedReason("replay"), LOCALE)` → same denial.
     - After BOTH: the ledger row still reads `failed` (`readLedgerRow`), the wallet balance still equals the post-restore value (byte-compare decimal strings — NOT just `toBe` on numbers), audit rows for the transaction STILL number exactly 1 (the rejection's original row — the two replays added zero), and the admin's audit count delta is zero.
  5. `expectNoDispatches()` (`:243`) and `countNotificationsForUser(teacherB.userId) === 0` — the denied replays are silent.
- Follow every `test/workflows/AGENTS.md` rule: real services, real users, committed fixtures, NO `runInRollback`, never `expect(...).rejects.toThrow()` (use the file's existing try/catch helpers), translated substrings from `ERRORS_EN` — no hardcoded denial copy.
- Enum discipline: `TransactionStatus`/`TransactionType` are ALREADY value-imported in this file — no new imports unless a helper needs one; never raw string literals.
- Run: `bun run test/scripts/run-test.ts test/workflows/billing/admin-financial-auditing.journey.test.ts` until green; then the whole billing journey dir (`bun run test/scripts/run-test.ts test/workflows/billing/admin-financial-auditing.journey.test.ts` + the sibling file) — both files green.
- _Requirements: REQ-601, REQ-402, REQ-504, REQ-505, REQ-506_
- [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts test/workflows/billing/admin-financial-auditing.journey.test.ts --lifecycle duplicates` (exit 0).
- [x] 1.1.TE **Test Engineering**: this leg IS Tier 1–4 delivery — Tier 1 both re-settle branches on the failed row; Tier 2 the exact-decimal balance equality; Tier 3 the leg composes with the file's existing concurrent steps (run order stability — run the file twice); Tier 4 the denial path is an adversarial replay attempt by a legitimately-authenticated actor.
- [x] 1.1.SEC **Security & Tenancy Audit**: the re-settle attempts use a REAL admin actor (honest authorization); the teacher's wallet is never read by id from client input — identity flows from the actor factory; zero rows mutate on denial.
- [x] 1.1.SR **Semantic Review**: existing steps 1–7 byte-identical (diff-verify); no `runInRollback`; tracked cleanup covers the new ledger row (`ledgerTxnIds`); no plan-artifact references in test comments; no hardcoded user-facing strings.
- [x] 1.1.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + `.agents/instructions/tests.instructions.md` (auto-printed by sub-loop).

---

## Phase 2 — Doc Repairs (documentation-only; no runtime surface)

### - [x] 2.1 DBML Check Repair — `db/schema.dbml:372` (UPDATE) · `outcome/2.1-dbml-repair-outcome.md`
- Change the `teacher_transaction.amount` column check from `check: \`amount >= 0\`` to `check: \`amount > 0\`` — aligning the DBML (documentation) with the authoritative Drizzle CHECK `teacher_transaction_amount_check` (`backend/db/schema/billing/teacher-transaction.ts:50`), which the tests actually prove (`financial-immutability.test.ts` constraint probes; ticket AC relies on the stricter bound).
- No migration, no schema change — the DB CHECK already says `> 0`; only the stale DBML annotation drifts (`db/schema.dbml:372`).
- Verify the DBML/mermaid CI validation still passes if the repo gates it (the M0 pipeline `ai/finished_plans/milestone_0_foundation/cicd-pipeline-with-dbml-mermaid-validati/`); otherwise verify by inspection + the dbml lint if available.
- _Requirements: REQ-602_
- [x] 2.1.QL **Quality Loop**: `db/schema.dbml` is not TypeScript — sub-loop does not apply; record the inspection + any validation command output in the outcome.
- [x] 2.1.TE **Test Engineering**: n/a (documentation) — the underlying constraint is already test-proven (citied in the outcome).
- [x] 2.1.SEC **Security & Tenancy Audit**: n/a.
- [x] 2.1.SR **Semantic Review**: DBML now matches the Drizzle schema AND the live DB CHECK (all three agree at `> 0`); INV-W8's doc wording stays untouched (D6 ledger row — the invariants doc is edited only by its owner).
- [x] 2.1.IV **Instruction Verification**: root `AGENTS.md` doc conventions re-read.

### - [x] 2.2 Workflow-Diagram Wording Repair — `docs/workflows/03-session-lifecycle-escrow.md` §6.3 (UPDATE) · `outcome/2.2-diagram-repair-outcome.md`
- Repair the withdrawal sequence diagram so the approve branch reflects the shipped **reserve-at-request, settle-at-decision** model instead of the superseded debit-at-approval wording:
  - Request step (`:147-148` region): keep "Create teacher_transaction (type = withdrawal, status = pending)" and ADD the reserve semantics — "Reserve: deduct wallet.balance (guarded `balance >= amount`)".
  - Approve branch (`:153` "Deduct from wallet.balance"): replace with "Settle the reservation: status pending → completed (balance already reserved at request)".
  - Reject branch: add "Restore: wallet.balance += amount (compensation for the request-time reserve)".
  - Keep the mermaid structure, the audit-trail step, and all other lines untouched.
- Cross-check against the canonical model (`docs/billing/admin-financial-auditing.md` §2 `:46-60`) — the diagram must agree with the doc verbatim in semantics, not necessarily wording.
- _Requirements: REQ-603_
- [x] 2.2.QL **Quality Loop**: markdown file — sub-loop does not apply; verify the mermaid block still renders (the repo's mermaid validation, if gated) and record in the outcome.
- [x] 2.2.TE **Test Engineering**: n/a (documentation) — semantics are re-proven by the journey re-runs (Phase 3).
- [x] 2.2.SEC **Security & Tenancy Audit**: n/a.
- [x] 2.2.SR **Semantic Review**: diagram now matches REQ-202's binding ruling exactly; no other section of the doc was touched (diff shows only §6.3 lines).
- [x] 2.2.IV **Instruction Verification**: root `AGENTS.md` doc conventions re-read.

---

## Phase 3 — Verification Re-Run Matrix (the proof work)

### - [x] 3.1 Teacher-Side Request Suites (green re-runs with captured evidence) — `backend/services/billing/wallet.service.test.ts`, `backend/db/test/repo/billing/wallet.repository.test.ts`
- Run both suites via `bun run test/scripts/run-test.ts <path>`; capture pass/fail counts into `outcome/3.1-teacher-request-outcome.md` as an AC → code `path:line` → test `:line` → green-run table:
  - AC1 pending row + reserve debit: `wallet.service.test.ts:169` (happy path), `wallet.repository.test.ts:341` (`debitForWithdrawalOnce`).
  - AC4 amount matrix: `wallet.service.test.ts:251` (`WALLET_INVALID_AMOUNT`), `:237` (exact-balance boundary).
  - AC4 insufficient funds: `wallet.service.test.ts:208` (zero committed rows), `wallet.repository.test.ts:393` (guarded debit returns `null`).
  - Funds-guard races: `wallet.repository.test.ts:819` + `:780` (`Promise.allSettled` — arbitration ∥ withdrawal, exactly one debit lands; the two-REQUEST drain race is finsec step D, re-cited in task 3.3).
- Also capture the wire-level leg already living in the admin-finance GraphQL suite (teacher request leg): `frontend/graphql/test/admin/admin-finance.integration.test.ts:638-647` — re-run happens in 3.3.
- _Requirements: REQ-101, REQ-102, REQ-103, REQ-104, REQ-007, REQ-501, REQ-505_
- [x] 3.1.QL **Quality Loop**: read-only re-runs — no file edits; record run-test `--last` output in the outcome.
- [x] 3.1.TE **Test Engineering**: this IS the verification deliverable for the teacher leg — every REQ-101..104 clause must appear with a passing citation.
- [x] 3.1.SEC **Security & Tenancy Audit**: confirm the request surface stays BOLA-proof (zero-arg `myWallet`, amount-only input) while re-reading the cited lines.
- [x] 3.1.SR **Semantic Review**: any test failure is investigated to root cause — a red suite is a finding, not a skip.
- [x] 3.1.IV **Instruction Verification**: read the suites' layer AGENTS.md (backend tests) as printed by any sub-loop output from earlier phases.

### - [x] 3.2 Admin Settlement + Immutability Suites — `backend/services/billing/admin-financial-auditing.service.test.ts`, `backend/db/test/repo/billing/wallet.repository.admin.test.ts`, `backend/db/test/logic/billing/financial-immutability.test.ts`
- Run all three via `bun run test/scripts/run-test.ts <path>`; capture into `outcome/3.2-admin-settlement-outcome.md`:
  - AC2 approve: `admin-financial-auditing.service.test.ts:324` (completed + one `Override` audit row), `:803` (already-completed denial), `:824` (earning-row denial), `:900` (double-approve race — exactly one wins).
  - AC3 reject: `:378` (failed + restore + `reasonPresent` audit), `:424` (reason validation), `:846` + `:876` (rollback integrity).
  - AC5 immutability: `wallet.repository.admin.test.ts:573-638` (trigger-freeze proofs), `financial-immutability.test.ts:364` (direct UPDATE rejected), `:383` (DELETE rejected), `:428` (type relabeling rejected), `:457` (compensating-row doctrine), `wallet.repository.test.ts:419` (repo namespace closure — no update/delete primitive).
- _Requirements: REQ-201, REQ-202, REQ-203, REQ-301, REQ-302, REQ-303, REQ-401, REQ-402, REQ-502, REQ-503, REQ-504, REQ-803_
- [x] 3.2.QL **Quality Loop**: read-only re-runs; record output in the outcome.
- [x] 3.2.TE **Test Engineering**: every REQ-2xx/3xx/4xx clause carries a passing citation in the evidence table.
- [x] 3.2.SEC **Security & Tenancy Audit**: confirm the governance gate + audit-row-fate invariants while re-reading the cited lines (`assertActorAdminActive` arms at `admin-financial-auditing.service.ts:194,281`).
- [x] 3.2.SR **Semantic Review**: probe reads are disambiguation-only (never the write decision) — re-confirm while reading `settleWithdrawalOnce` (`wallet.repository.admin.helpers.ts:302-322`).
- [x] 3.2.IV **Instruction Verification**: layer AGENTS.md as printed by earlier sub-loop runs.

### - [x] 3.3 Cross-Actor Journey + Wire Suites — `test/workflows/billing/admin-financial-auditing.journey.test.ts`, `test/workflows/billing/financial-safety-verification.journey.test.ts`, `frontend/graphql/test/admin/admin-finance.integration.test.ts`
- Re-run BOTH journeys via `bun run test/scripts/run-test.ts` (they must be green INCLUDING the new step-8 leg from task 1.1); run the GraphQL integration suite via its harness (`bun run test:graphql` or the run-test wrapper as the suite header directs — `describeGraphqlSuite` + `setupTestServerLifecycle` + `testClient`).
- Capture into `outcome/3.3-journey-wire-outcome.md`:
  - Journey step 1 (request → approve → queue drain → teacher sees settled state) `:485-543`; step 2 (request → reject → restore) `:546-581`; step 5 (denials + suspended-admin governance) `:719-805`; step 6 (concurrent double settle) `:806-848`; step 7 (settle ∥ new-request race) `:849-915`; NEW step 8 (failed-row re-settle denial) — task 1.1.
  - Finsec step D (drain race) `:565-593`; step D2 (amount fuzz) `:616-639`; step F (append-only trigger) `:714-752`.
  - Wire tiers: anonymous `UNAUTHORIZED` ×6 `admin-finance.integration.test.ts:381-445`; non-admin `FORBIDDEN` ×6 `:455-543`; request → queue → approve leg `:636-689`; reject leg `:690-730`.
- _Requirements: REQ-601, REQ-605, REQ-502, REQ-506, REQ-801, REQ-802_
- [x] 3.3.QL **Quality Loop**: no edits here (the journey file was gated in 1.1) — record run output.
- [x] 3.3.TE **Test Engineering**: the consolidated cross-actor proof — actor table + ordered steps from `specs.md` §Journey each map to a green step citation.
- [x] 3.3.SEC **Security & Tenancy Audit**: wire tiers re-prove BFLA on all six admin operations; the journey re-proves honest-role authorization.
- [x] 3.3.SR **Semantic Review**: journeys ran WITHOUT `runInRollback`; fixtures committed + tracked cleanup verified green.
- [x] 3.3.IV **Instruction Verification**: `test/workflows/AGENTS.md` + `frontend/graphql/test/AGENTS.md` re-read.

---

## Phase 4 — Consolidation, Final Gate & Knowledge Propagation

### - [x] 4.1 Traceability Matrix & Verification Consolidation — `outcome/verification-matrix.md`
- Consolidate the Phase 1–3 evidence into ONE matrix covering EVERY REQ (REQ-001..REQ-803): REQ → ticket AC → code `path:line` → test citation `file:line` → green-run result → notes/deviations.
- Cross-check the actor table + ordered step list from `specs.md` §Journey against journey citations; every cross-actor EARS criterion must have a green step.
- Record the reconciliation rulings as PROVEN rows: REQ-104 (422 → typed `WALLET_INSUFFICIENT_FUNDS` code), REQ-202 (reserve-at-request), REQ-203/302 (restore-on-reject), REQ-602/603 (doc repairs now landed).
- _Requirements: REQ-604, REQ-005, REQ-006_
- [x] 4.1.QL **Quality Loop**: markdown outcome — no sub-loop; verify table renders (no broken pipes).
- [x] 4.1.TE **Test Engineering**: matrix rows reference only suites that ran green THIS plan-run.
- [x] 4.1.SEC **Security & Tenancy Audit**: matrix includes the BOLA/BFLA/governance rows (REQ-501..505) with citations.
- [x] 4.1.SR **Semantic Review**: zero unresolved ❌/⚠️ rows; every "verified" claim carries a citation from this run.
- [x] 4.1.IV **Instruction Verification**: templates re-read (`tasks-template.md` traceability rules).

### - [x] 4.2 Final Gate: Deferred-Items Enforcement & Baseline Compare
- Enforce the ledger: `grep -cE '^\| D[0-9]+ .*\| (❌|⚠️) ' ai/plans/milestone_2_matching_notifications_escrow/teacher_withdrawal_workflow_&_admin_approval-withdrawal_workflow_admin_approval/deferred-items.md` — expected 0 (all rows are ✅ Done or 🔄 Open forward-contracts with named owners, per `deferred-items.md`'s status legend; the row-scoped pattern avoids matching the legend's own vocabulary lines).
- Compare current `bun tsgo` error count and `bun run scripts/lint-service.ts --json --id final` against the Phase-0 `/tmp/baseline-*` — document the delta (expected: 0 new errors; the journey-test edit is covered by its own sub-loop pass).
- Mark every task in this file `[x]` as its gates pass.
- _Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-702_
- [x] 4.2.QL **Quality Loop**: run `bun run scripts/health/sub-loop.ts test/workflows/billing/admin-financial-auditing.journey.test.ts --lifecycle duplicates` once more (the only TS file this plan edited) — exit 0.
- [x] 4.2.TE **Test Engineering**: final full-suite pass summary quoted from real output.
- [x] 4.2.SEC **Security & Tenancy Audit**: final sweep — no client-supplied id used without ownership/role proof anywhere the plan touched; tenancy filters intact.
- [x] 4.2.SR **Semantic Review**: no dead code introduced; no cross-layer imports in the journey edit; enums value-imported; zero plan-artifact references in code comments.
- [x] 4.2.IV **Instruction Verification**: sub-loop's printed AGENTS.md + instruction files re-validated.

### - [x] 4.3 Knowledge Propagation — `docs/billing/` addendum + outcome synthesis
- Read ALL files in `outcome/`; extract recurring patterns and pitfalls.
- The canonical settlement doc ALREADY exists (`docs/billing/admin-financial-auditing.md`) — append a short "Verification addendum (2026-09-17)" noting: the failed-row re-settle journey arm now exists (step 8), the DBML check was repaired to `> 0`, and the workflow diagram §6.3 now matches the reserve-at-request model. Do NOT rewrite the doc.
- AGENTS.md and `.agents/instructions/*.instructions.md` are hand-curated — NEVER updated from plan outcomes.
- Write `outcome/4.3-knowledge-propagation-outcome.md` with the synthesis.
- _Requirements: REQ-002_
- [x] 4.3.QL **Quality Loop**: sub-loop on the edited doc is n/a (markdown); inspection + repo doc validation only.
- [x] 4.3.TE **Test Engineering**: n/a.
- [x] 4.3.SEC **Security & Tenancy Audit**: n/a.
- [x] 4.3.SR **Semantic Review**: addendum states facts with citations; no scope creep into other sections.
- [x] 4.3.IV **Instruction Verification**: root `AGENTS.md` "AI Agent Communication Rules" (no summary files outside sanctioned docs) re-read.

---

## Traceability Command (run at 4.2)

```bash
for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo "MISSING: $r"; done
# Expected: no output (every REQ-001..REQ-803 appears in this file)
grep -cE '^\| D[0-9]+ .*\| (❌|⚠️) ' deferred-items.md   # Expected: 0 (ledger rows only)
```

## Dependency Graph

- Phase 0 (0.1 → 0.2) is the entry gate for everything.
- Task 1.1 (journey leg) blocks 3.3 (journey re-runs must include the new step) and 4.1 (matrix rows).
- Phase 2 (doc repairs) is independent of Phase 1/3 — may run in parallel after 0.2.
- 4.1 depends on ALL of Phase 1–3; 4.2 depends on 4.1; 4.3 depends on 4.2.

## REQ Coverage Index (audit-friendly)

- REQ-001 · REQ-002 · REQ-003 · REQ-004 — tasks 0.1, protocol lines, 4.2
- REQ-005 · REQ-006 · REQ-007 — tasks 3.1, 4.1, 3.1
- REQ-008 — task 4.2 (ledger completeness enforcement)
- REQ-101 · REQ-102 · REQ-103 · REQ-104 — task 3.1
- REQ-201 · REQ-202 · REQ-203 — tasks 3.2, 4.1
- REQ-301 · REQ-302 · REQ-303 — task 3.2
- REQ-401 · REQ-402 — tasks 3.2, 1.1
- REQ-501 · REQ-502 · REQ-503 · REQ-504 · REQ-505 · REQ-506 — tasks 3.1, 3.2, 3.3, 1.1
- REQ-601 — task 1.1 · REQ-602 — task 2.1 · REQ-603 — task 2.2 · REQ-604 — task 4.1 · REQ-605 — task 3.3
- REQ-701 — task 0.2 · REQ-702 — task 4.2
- REQ-801 · REQ-802 · REQ-803 — tasks 3.3, 3.2
