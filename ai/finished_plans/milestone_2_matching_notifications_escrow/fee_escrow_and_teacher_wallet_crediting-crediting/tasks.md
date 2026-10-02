# Tasks — Fee Escrow & Teacher Wallet Crediting (Close-the-Loop Verification)

**Plan Directory:** `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/`
**Requirements:** `specs.md` · **Design:** `plan.md` · **Tickets:** `docs/planning/TICKETS.md:1704-1796` · **Milestone:** 2

---

## Non-Negotiable Execution Protocol

1. BEFORE executing any task, read ALL files in the outcome directory.
2. This plan modifies **no production code**. Quality loops apply to plan/docs files when edited: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (markdown checks run cheap; loop must exit 0 for any file the plan touches).
3. Semantic review checklist applies per subtask (atomicity, tenancy, comments-without-plan-refs) — for this plan it audits *claims and citations*, not new code.
4. Test invocations MUST use `bun run test/scripts/run-test.ts <path>` (log-captured). Never raw `bun test` on DB-backed suites; journeys must never be wrapped in `runInRollback`.
5. After each task: write `outcome/<task-id>-outcome.md`; flip `[ ]` → `[x]`.
6. A failing suite that matches the recorded baseline is reported, not silently "fixed"; a NEW failure stops the plan.

## Subtask Pipeline (per task X.Y)

- **X.Y.QL Quality Loop** — sub-loop on every file the task touched.
- **X.Y.TE Test Engineering** — run the task's suites via run-test.ts; capture output paths. (For doc-only verifications: the four tiers are satisfied by the existing suites — Tier 1 branch coverage and Tier 2/3/4 edge/chaos/security cases already exist per the service suite :470/:2439/:1363/:208 and repo races :1430/:1582/:1617.)
- **X.Y.SEC Security & Tenancy Audit** — re-verify the cited guard (BOLA oracle-safe denial, BOPLA fee-omitting input, BFLA role scopes) at its `path:line`.
- **X.Y.SR Semantic Review** — citations resolve; no plan-meta references leak into code/docs; no dead claims.
- **X.Y.IV Instruction Verification** — read the AGENTS.md/instruction files that govern any touched path (sub-loop.ts prints them; markdown plan files fall under the repo-root AGENTS.md).

---

- [x] 0. **Pre-Implementation Baseline & Ledger Setup**
  - [x] 0.1 Record baselines: `tsgo` errors = 0 (`/tmp/baseline-tsgo.txt`), `biome:check` warnings = 0 (`/tmp/baseline-biome.txt`), lint-service JSON `success: true` (`/tmp/baseline-lint.json`) — captured 2026-09-11.
  - [x] 0.2 Create `deferred-items.md` from the template (rows D1, D2 — both target external tickets).
  - [x] 0.3 Write `outcome/0.1-baseline-outcome.md` with the recorded numbers and environment.
  - _Requirements: REQ-0_

---

- [x] 1. **Service & Repository Suite Re-Runs (escrow/credit/refund proof)**
  - [x] 1.1 Run `bun run test/scripts/run-test.ts backend/services/classes/session-lifecycle.service.test.ts` — assert green; confirm escrow cases present: hold-at-booking (:394), insufficient-balance rollback (:470), fee boundary (:1109), settle-credits-once (:2396), replay zero-writes (:2439, :2469), double-cancel single refund (:1363), sweep/arbitration refunds (:2522, :2572, :1791).
  - [x] 1.2 Run `bun run test/scripts/run-test.ts backend/services/billing/wallet.service.test.ts` — assert green; confirm lazy-ensure (:102), ledger ordering (:132), insufficient-funds zero-commit (:208), exact-balance guard (:237), validation matrix (:251), governance deny (:295).
  - [x] 1.3 Run `bun run test/scripts/run-test.ts backend/db/test/repo/classes/session.repository.test.ts` — assert green; confirm guarded primitives: cancel-clears-hold (:490), double-cancel single winner (:1430), confirm-vs-sweep races (:1582, :1617), sweep idempotence (:1552), escrow-consumed-by-earning (:1256).
  - [x] 1.QL/SEC/SR/IV — no files modified; audit the cited guards at their `path:line` (incl. the localized error keys of REQ-0.5 at `shared/locale/en/errors/index.ts:85`, `shared/locale/ar/errors/index.ts:84`); record suite outputs + observed test names in `outcome/1.x-suites-outcome.md`.
  - _Requirements: REQ-0, REQ-0.5, REQ-1, REQ-2, REQ-3, REQ-4, REQ-5, REQ-7_

---

- [x] 2. **Journey Re-Runs (cross-actor escrow arcs)**
  - [x] 2.1 Run `bun run test/scripts/run-test.ts test/workflows/sessions/session-dual-confirmation.journey.test.ts` — assert green; confirm: wallet-less teacher start (:348), hold at booking (:363), settle credits exactly the fee once (:451), replay/foreign zero-writes (:492), sweep refund to same lane (:561), confirm-vs-sweep single financial outcome (:620).
  - [x] 2.2 Run `bun run test/scripts/run-test.ts test/workflows/sessions/session-lifecycle.journey.test.ts` — assert green; confirm trial-first binding (:369, :402), idempotent replay (:492), cancel refunds exactly once (:611), completed-cancel denial (:645).
  - [x] 2.3 Run `bun run test/scripts/run-test.ts test/workflows/sessions/session-lifecycle-denials.journey.test.ts` — assert green; confirm zero-balance denial with zero writes + funded retry (:236), uncertified-teacher denial with balances untouched (:200).
  - [x] 2.QL/SEC/SR/IV — journeys are committed-fixture suites; confirm zero-residue afterAll probes pass (no orphaned `teacher_transaction`/`wallet` rows); record in `outcome/2.x-journeys-outcome.md`.
  - _Requirements: REQ-1, REQ-2, REQ-3, REQ-4, REQ-5 (Journeys A/B/C), REQ-7_

---

- [x] 3. **GraphQL Pins, Traceability Matrix & Reconciliation Record**
  - [x] 3.1 Run GraphQL suites (`bun run test:graphql` scoped, or run-test.ts equivalents): `backend/graphql/test/session-lifecycle-mutations.test.ts`, `schema-surface.test.ts`, `sdl-static-assertions.test.ts` — assert green AND assert SDL delta = zero (no new fields/types introduced by this plan).
  - [x] 3.2 Build the traceability matrix in `outcome/3.2-traceability-outcome.md`: every ticket AC (both tickets, `docs/planning/TICKETS.md:1716-1747` and `:1765-1793`) → REQ → code `path:line` → test citation. Zero unmapped ACs. Prose-only claims are rejected — every row needs a grep-verifiable citation.
  - [x] 3.3 Write the reconciliation record `outcome/3.3-reconciliation-outcome.md` covering: hold-as-debit ruling (supersedes ticket wording), unit-lane vs EGP-fee two-sided model, dispute-from-`completed` divergence (dual-confirmation plan D-2), idempotency-key deferral D1.
  - [x] 3.QL/SEC/SR/IV — citations re-grepped after writing; instruction files for `outcome/` content per repo-root AGENTS.md.
  - _Requirements: REQ-6, REQ-7_

---

- [x] 4. **Knowledge Propagation & Closure**
  - [x] 4.1 Read ALL outcome files; synthesize the escrow/ledger invariants.
  - [x] 4.2 Create `docs/billing/escrow-and-wallet-crediting.md` — canonical reference: hold-as-debit semantics, settle/release/race matrix, INV-W1/W2/W3/W4/W7/W8 + INV-B4/INV-S3 mapping to schema + code citations, deferral pointers (D1/D2), and the dependent-ticket boundary hand-offs (Withdrawal, Re-Evaluation Deduction, Financial Safety Verification). Follow the docs file structure (Why / Pattern / Rules / What NOT to do / Rollout Summary / Related Documents).
  - [x] 4.3 Deferred-items gate: run `grep -c "❌\|⚠️" deferred-items.md` — expected raw output is **3** (rows D1, D2, and the Status Legend line), i.e. zero ❌/⚠️ rows whose Target Task is inside this plan; D1/D2 target external tickets and are exempt per the ledger's gate rule. Record the grep output in `outcome/4.x-knowledge-propagation-outcome.md`.
  - [x] 4.QL (sub-loop on `docs/billing/escrow-and-wallet-crediting.md`) / SEC / SR / IV — docs conventions per root AGENTS.md (no summary-file sprawl: this is canonical domain documentation, not a plan report).
  - _Requirements: REQ-6, REQ-7, REQ-8_

---

## Phase 1.5 — Plan Review Gate (status: RECORDED)

Invoked on `specs.md` + `plan.md` + `tasks.md` before execution; verdict and fixes recorded in `outcome/plan-review-R1.md`. Mid-Point gate (Phase 2.5) skipped: ≤9 tasks, no backend-then-frontend phase split.

## Estimation

| Task | Effort | Note |
|---|---|---|
| 0 | done | baseline recorded 2026-09-11 |
| 1 | ~1 h | three suite runs + audit |
| 2 | ~1 h | three journey runs |
| 3 | ~1.5 h | SDL pins + matrix + reconciliation |
| 4 | ~1 h | propagation doc + closure |

## Quality Gates

- Plan completion requires: all task checkboxes `[x]`; REQ-7 suites green against baseline; traceability matrix zero-unmapped; in-plan deferred `❌/⚠️` count = 0; `outcome/plan-review-R1.md` verdict = pass.
