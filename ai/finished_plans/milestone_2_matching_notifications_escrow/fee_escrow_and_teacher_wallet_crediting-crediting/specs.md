# Requirements — Fee Escrow & Teacher Wallet Crediting (Close-the-Loop Verification)

**Plan Directory:** `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/`
**Tickets:** "Fee Escrow: Hold at Request, Decrement at Completion" (`docs/planning/TICKETS.md:1704-1750`) and "Teacher Wallet Crediting (Earning Transactions)" (`docs/planning/TICKETS.md:1753-1796`)
**Milestone:** 2 · **Owner Stream:** Dev 3 · **Story Points:** 5 + 5

---

## Document Information

| Field | Value |
|---|---|
| Feature Name | Fee Escrow & Teacher Wallet Crediting |
| Target Directory | `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/` |
| Version | 1.0 |
| Date | 2026-09-11 |
| Status | Requirements complete — verification-scoped, pre-execution |
| Plan Kind | **Close-the-loop verification** (not a full implementation ticket) |

---

## Introduction

### Feature Summary

Two tickets define the money-side escrow of a booked session: (1) at session request the platform-set fee is held (`session.fee_held = true`) after an eligibility debit, and a zero balance rejects the request; (2) on dual confirmation the hold settles — `fee_held` flips false, the teacher's wallet is lazily ensured and credited exactly once with an `earning` `teacher_transaction`; (3) on cancellation the hold releases back with no decrement-kept and no wallet write.

Every one of those behaviors **already shipped and is test-covered** inside two finished plans — Session Creation & Lifecycle (`ai/finished_plans/milestone_1_core_domain_mvp/session-creation-lifecycle-scheduled-sta/`, all tasks `[x]`) and Dual-Confirmation Completion Handshake (`ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/`, all tasks `[x]`). Running these tickets as full implementation tickets would **duplicate tested code**.

This plan therefore closes the loop: it re-proves each acceptance criterion against the live code, reconciles the one semantic divergence (hold-as-debit vs. the ticket's "held, not decremented" wording), records deferrals, and leaves an auditable traceability matrix — AC → code citation → test citation.

### Business Value

- Proves the platform never double-charges a student and never double-pays a teacher (INV-B4, INV-W4, INV-S3), with evidence, before the Milestone 4 "Financial Safety Verification" ticket builds on it.
- Produces the canonical escrow/ledger reference doc that the Withdrawal (`docs/planning/TICKETS.md:1799`) and Admin Re-Evaluation Deduction (`docs/planning/TICKETS.md:2143`) tickets consume.
- Ratifies the escrow wording so future tickets stop copy-pasting the superseded "held, not decremented" phrasing.

### Scope

**In scope (this plan):**
1. Verification of every ticket AC against the live implementation, with `path:line` evidence and test citations.
2. Green re-runs of the existing escrow/crediting suites (service, repository, wallet service, journey, GraphQL pins) with recorded output.
3. A reconciliation record for documented divergences (hold-as-debit ruling; dispute-from-`completed` ruling).
4. A traceability matrix (REQ → AC → code → test) and a canonical knowledge-propagation doc under `docs/billing/`.

**Out of scope (explicitly NOT this plan):**
- New schema, columns, enums, resolvers, routes, or UI — none are needed; any discovered gap becomes a `deferred-items.md` row, not scope creep.
- Withdrawal settlement (admin approve/reject) — `Teacher Withdrawal Workflow & Admin Approval` ticket (`docs/planning/TICKETS.md:1799-1845`); `TransactionStatus.Failed` is intentionally unused today (`backend/services/billing/wallet.service.ts` writes only pending withdrawal intents).
- Runtime adoption of the escrow idempotency-key contract types — deferred (see REQ-8, ledger D1).
- The `db/schema.dbml` sync — owned by `ai/plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/` (its deferred dbml-sync requirement); do not duplicate.

---

## Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I need a recorded error baseline and a working protocol, so that verification results are attributable and auditable.

#### Acceptance Criteria

1. WHEN Task 0 starts THEN the agent SHALL record `tsgo` error count, `biome:check` warning count, and the lint-service JSON result into `/tmp/baseline-*.txt|json` and echo them into `outcome/0.1-baseline-outcome.md`.
2. WHEN any suite is re-run during this plan THEN new failures SHALL be distinguishable from the recorded baseline.
3. WHEN Task 0 completes THEN `deferred-items.md` SHALL exist (created from the template) before any verification task runs.
4. WHEN any agent executes ANY task THEN it SHALL first read ALL files under the outcome directory.
5. WHEN any task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` and flip the task checkbox `[ ]` → `[x]` in `tasks.md`.
6. IF any file is created or modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 before the task closes.
7. WHEN a ticket AC contradicts shipped behavior THEN the agent SHALL record the divergence as a decision (REQ-6) instead of editing tested code.

## Requirement 0.5: Translation, Enum & House-Rule Compliance

**User Story:** As a maintainer, I need the plan and its outputs to respect the project's compile-time i18n and enum rules even though no runtime code is added.

#### Acceptance Criteria

1. WHEN the plan cites error behavior THEN it SHALL reference the actual localized keys (`insufficientBalance` at `shared/locale/en/errors/index.ts:85`, `shared/locale/ar/errors/index.ts:84`; type at `shared/locale/types/errors/labels.ts:174`) — never invented message strings.
2. IF any doc or test is touched THEN it SHALL NOT introduce a `Translation.` enum, a two-arg `getTranslations` call, `next-intl` imports, or raw `console.*`.
3. WHEN enum values are cited (`TransactionType.Earning`, `TransactionStatus.Completed`) THEN citations SHALL point at `backend/enum/billing/transaction-type.enum.ts:6-10` and `backend/enum/billing/transaction-status.enum.ts:5-9` (value imports in code).
4. WHEN tests are run THEN the command SHALL be `bun run test/scripts/run-test.ts <path>` (log-captured), never a bare `bun test` for DB-backed suites.

---

## Requirement 1: Platform-Set Fee and Hold-at-Request (Escrow Open) — Status: EXISTING

**User Story:** As a student, when I request a session, the platform sets the fee and my booking is escrow-marked so the eventual charge is reserved and immutable to me.

**Ticket Source:** Fee Escrow AC #1 (`docs/planning/TICKETS.md:1718-1722`). **Decision Refs:** B.3 (`docs/specs/open-decisions-and-gaps.md:87-91`), B.4 (`:93-97`), INV-B4 (`docs/specs/state-machine-invariants.md:148`).

#### Acceptance Criteria

1. WHEN a booking transaction inserts the session row THEN the system SHALL set `session.fee` from the platform constants only (`SESSION_FEE_HIFZ`/`SESSION_FEE_TAJWEED` = `"25.00"` EGP, `shared/constants/session-fees.constants.ts:27-33`) via `sessionFeeForIntent` (`backend/services/classes/session-lifecycle.guards.ts:83-85`).
2. WHEN the session row is inserted THEN the system SHALL set `fee_held = true`, `held_balance_lane` = the lane that paid, and `confirmation_deadline = now + 24h` (`backend/services/classes/session-lifecycle.booking.ts:139-142`; columns at `backend/db/schema/classes/session.ts:63-65,70`).
3. WHEN the booking input arrives THEN it SHALL contain no fee field — the client cannot name a price (input type `SessionSubmitInput {teacherId, intent}`, `backend/types/classes/session.types.ts`).
4. IF the student's trial lane and intent lane are both empty THEN the system SHALL throw `ValidationError("INSUFFICIENT_BALANCE", …)` and SHALL roll back the entire transaction (zero rows) (throw at `session-lifecycle.booking.ts:95-116`).

5. WHEN the request is replayed with the same idempotency key THEN the system SHALL reject with `ConflictError("DUPLICATE_REQUEST")` (409, localized) and SHALL insert zero new rows and touch no lane — replay never returns and never double-holds (`SessionRequestIdempotencyRepository.insertClaim` savepoint-bracketed, `session-lifecycle.booking.ts:225-238`; replay-by-throw at `:162-182`).

#### Evidence (verified 2026-09-11)

| AC | Code citation | Test citation |
|---|---|---|
| AC1 platform fee | `session-lifecycle.booking.ts:139`; constants `shared/constants/session-fees.constants.ts:27-33` | `backend/services/classes/session-lifecycle.service.test.ts` (tajweed fee case :449; decimal-string boundary :1109) |
| AC2 hold + provenance | `session-lifecycle.booking.ts:139-142`; `session.ts:63-65,70` | `session-lifecycle.service.test.ts` (trial-hold :394) |
| AC4 insufficiency | throw `session-lifecycle.booking.ts:113` (ladder :95-116) | `session-lifecycle.service.test.ts:470`; journey `test/workflows/sessions/session-lifecycle-denials.journey.test.ts:236` |
| AC5 replay | `session-lifecycle.booking.ts:225-238` | `test/workflows/sessions/session-lifecycle.journey.test.ts:492` |

#### Additional Details

- **Priority:** P0 (ticket blocker for everything money-side) · **Complexity:** none (verification only) · **Dependencies:** `ai/plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/` ratification D1 (hold-as-debit) — compatible, not blocking.
- **Semantics note:** "Held" = guarded **debit of one unit** from `balance_trial` first, else the intent lane (`decrementLaneIfAvailable`, `backend/db/repo/students/student.repository.ts:478-493`). See REQ-6 for the wording reconciliation.

---

## Requirement 2: Guarded Balance Debit & Insufficient-Balance Rejection — Status: EXISTING

**User Story:** As the platform, I need every booking to atomically consume eligibility and to fail cleanly — 422, localized, zero rows — when no lane can pay.

**Ticket Source:** Fee Escrow AC #4 (`docs/planning/TICKETS.md:1736-1739`). **Decision Refs:** INV-B4 (`docs/specs/state-machine-invariants.md:148`).

#### Acceptance Criteria

1. WHEN a booking runs THEN the debit ladder SHALL try trial lane first, then the intent lane, each via the guarded `UPDATE … WHERE balance_lane > 0` primitive (`student.repository.ts:478-493`).
2. IF all ladders miss THEN the system SHALL throw `ValidationError("INSUFFICIENT_BALANCE")` with the localized `insufficientBalance` message, HTTP 422 class (`session-lifecycle.booking.ts:113`; locale keys per REQ-0.5).
3. WHEN the rejection fires THEN the transaction SHALL leave zero committed rows — no session, no idempotency-claim tombstone, no lane movement.
4. WHEN eligibility returns (lane credited) THEN the same idempotency key SHALL succeed exactly once (`session-lifecycle-denials.journey.test.ts:236`).

#### Evidence

| AC | Code citation | Test citation |
|---|---|---|
| AC1-AC3 | `session-lifecycle.booking.ts:95-116`; `student.repository.ts:478-493` | `session-lifecycle.service.test.ts:470` |
| AC4 | replay arm `session-lifecycle.booking.ts:162-182` | `session-lifecycle-denials.journey.test.ts:236` |

#### Additional Details

- **Priority:** P0 · **Complexity:** none · **Dependencies:** none.

---

## Requirement 3: Dual-Confirmation Settlement & Teacher Wallet Crediting — Status: EXISTING

**User Story:** As a teacher, when the student confirms my completed session, my wallet is credited exactly once with the session fee — and re-confirmation can never double-pay me.

**Ticket Sources:** Fee Escrow AC #2 (`docs/planning/TICKETS.md:1724-1728`); Teacher Wallet Crediting ACs #1-#2 (`:1767-1780`). **Decision Refs:** INV-W4, INV-S3 (`docs/specs/state-machine-invariants.md:178,44`), FR-5.5 (`docs/specs/functional-requirements.md:181-183`).

#### Acceptance Criteria

1. WHEN the student confirms a `completed` session whose hold is marked THEN one guarded UPDATE SHALL stamp `confirmed_by_student_at` and flip `fee_held = false` — the guard is the statement predicate (`fee_held = true` ∧ teacher stamp present ∧ student stamp absent), `SessionRepository.confirmStudentCompletionOnce` (`backend/db/repo/classes/session.repository.ts:433-455`).
2. WHEN the guarded update lands THEN in the SAME transaction the system SHALL ensure the teacher's wallet (`WalletRepository.ensureWalletOnce`, idempotent `INSERT … ON CONFLICT DO NOTHING`, `backend/db/repo/billing/wallet.repository.ts:45-50`) and insert exactly ONE `teacher_transaction` with `type = earning`, `status = completed`, `amount = session.fee` verbatim, `session_id` linked, `wallet_id` = teacher's wallet (`creditEarningOnce`, `wallet.repository.ts:64-98`), incrementing `wallet.balance` and `wallet.total_earning` by the fee via guarded SQL — the composition lives at `session-lifecycle.confirmation.ts:48-59,129`.
3. IF the teacher has no wallet WHEN the first earning lands THEN the wallet SHALL be created by the same idempotent ensure (lazy-creation AC satisfied), `wallet.repository.ts:45-50`.
4. WHEN the confirm is replayed (student re-confirm, teacher confirm, or hold already consumed by arbitration) THEN the system SHALL make ZERO financial writes and return the current row (`session-lifecycle.confirmation.ts:86-104`).
5. IF a hold-marked row somehow carries `fee = null` THEN the system SHALL fail closed (throw) rather than credit an unpriced lesson (`session-lifecycle.confirmation.ts:123-127`).
6. WHEN a non-participant attempts confirmation THEN the system SHALL throw `NotFoundError("SESSION", …)` indistinguishable from a missing row (oracle-safe denial, `session-lifecycle.confirmation.ts:66-76`).

#### Evidence

| AC | Code citation | Test citation |
|---|---|---|
| AC1 exactly-once predicate | `session.repository.ts:433-455` | service suite :2439 (replay, zero writes); repo races :1582, :1617 |
| AC2 credit composition | `session-lifecycle.confirmation.ts:48-59,129`; `wallet.repository.ts:64-98` | `session-lifecycle.service.test.ts:2396` (exactly one earning); journey `test/workflows/sessions/session-dual-confirmation.journey.test.ts:451` |
| AC3 lazy wallet | `wallet.repository.ts:45-50` | journey :348 (teacher starts wallet-less) + :451 |
| AC4 replay arms | `session-lifecycle.confirmation.ts:86-104` | service suite :2439, :2469; journey :492 |
| AC5 fail-closed fee | `session-lifecycle.confirmation.ts:123-127` | no dedicated test — branch is unreachable while the booking invariant (AC1, test :1109) holds; noted as a candidate edge case for the Milestone 4 Financial Safety suite |
| Race confirm-vs-sweep | predicates in `session.repository.ts:433-455,473-517` | repo suite :1582, :1617; journey :620 (exactly ONE financial outcome) |

#### Additional Details

- **Priority:** P0 · **Complexity:** none · **Dependencies:** REQ-1.
- **Known limiting fact:** exactly-once rests on the `fee_held = true` predicate alone; the escrow idempotency-key contract types (`backend/types/contracts/session-completion-escrow.contract.types.ts:14-80`) are type-level pins, not runtime-consumed — recorded as deferral D1 (REQ-8), not re-engineered here.

---

## Requirement 4: Cancellation & Timeout Release (Escrow Close Without Earning) — Status: EXISTING

**User Story:** As a student, when my session is cancelled or times out, my held unit returns to the lane it came from and the teacher is never paid for a lesson that did not settle.

**Ticket Sources:** Fee Escrow AC #3 (`docs/planning/TICKETS.md:1730-1734`); Teacher Wallet Crediting AC #3 (`:1782-1784`). **Decision Refs:** B.2 24h timeout (`docs/specs/open-decisions-and-gaps.md:81-85`), INV-S3.

#### Acceptance Criteria

1. WHEN a participant cancels a hold-marked session THEN one guarded UPDATE SHALL set `status = cancelled, fee_held = false` (`SessionRepository.cancelSessionOnce`, `session.repository.ts:217-231`) AND in the same transaction the held unit SHALL be re-incremented into the SAME lane recorded in `held_balance_lane` (`refundHeldLaneToProvenance` → `incrementLane`, `backend/services/classes/session-lifecycle.transitions.ts:222-237`; `student.repository.ts:507-517`).
2. WHEN cancellation settles THEN the system SHALL create NO `teacher_transaction` row.
3. WHEN a second cancel attempt arrives THEN it SHALL be rejected (`SESSION_INVALID_TRANSITION`) and SHALL NOT refund twice.
4. WHEN the 24h confirmation window lapses unconfirmed THEN the sweeper SHALL cancel + release the hold with the same provenance refund (`sweepExpiredCompletedOnce`, `session.repository.ts:503-517`; `sweepExpiredSessions`, `session-lifecycle.service.ts:776-796`) and still write NO earning.
5. WHEN admin arbitration resolves a dispute as CANCEL THEN the hold SHALL release via the same primitive atomically (`resolveDisputeCancelOnce`, `session.repository.ts:280-290`; `session-lifecycle.service.ts:651-655`); a dispute-COMPLETE outcome consumes the hold with **no wallet credit** (ruling of the dual-confirmation plan).

#### Evidence

| AC | Code citation | Test citation |
|---|---|---|
| AC1 same-lane refund | `transitions.ts:222-237`; `session.repository.ts:217-231` | service suite :962; journey `session-lifecycle.journey.test.ts:611` |
| AC2/AC3 no earning, single refund | absence-by-design in cancel path | service suite :1363 (double-cancel exactly once); repo suite :490, :1430 (`Promise.allSettled`) |
| AC4 sweep release | `session.repository.ts:473-517`; service `:776-796` | service suite :2522, :2572; journey `session-dual-confirmation.journey.test.ts:561` |
| AC5 arbitration | `session.repository.ts:280-290` | service suite :1791 (dispute-complete consumes hold, NO wallet credit) |

#### Additional Details

- **Priority:** P0 · **Complexity:** none · **Dependencies:** REQ-1.

---

## Requirement 5: Wallet & Ledger Structural Invariants — Status: EXISTING

**User Story:** As the platform, I need the wallet schema itself to make the money invariants un-representable when violated.

**Ticket Source:** Teacher Wallet Crediting test scenarios (`docs/planning/TICKETS.md:1792-1793`). **Decision Refs:** INV-W1/W2/W3/W7/W8 (`docs/specs/state-machine-invariants.md:175-182`).

#### Acceptance Criteria

1. WHERE the `wallet` table is defined THEN `teacher_id` SHALL be unique (exactly one wallet per teacher), `balance >= 0` and `total_earning >= 0` SHALL be CHECK constraints (`backend/db/schema/billing/wallet.ts:33-35` — INV-W1/W2/W3).
2. WHERE the `teacher_transaction` table is defined THEN `amount >= 0` SHALL be a CHECK constraint, and indexes SHALL exist on `wallet_id` and `session_id` (`backend/db/schema/billing/teacher-transaction.ts:45-47` — INV-W8).
3. WHEN an `earning` row exists THEN `session_id` SHALL be non-null (INV-W7 — enforced by construction: only `creditEarningOnce` writes `earning`, always with `sessionId`).
4. WHEN any code attempts UPDATE/DELETE on `teacher_transaction` THEN the immutability triggers SHALL block it (`backend/db/migration/3-immutability-triggers.sql:87-113`).
5. WHEN transaction vocabularies are cited THEN `transaction_type ∈ {earning, withdrawal, bonus}` and `transaction_status ∈ {pending, completed, failed}` SHALL match the pgEnums (`backend/db/schema/enums.ts:31,33`; TS mirrors `backend/enum/billing/transaction-type.enum.ts:6-10`, `transaction-status.enum.ts:5-9`).

#### Evidence

| AC | Code citation | Test citation |
|---|---|---|
| AC1-AC2 schema constraints | `wallet.ts:33-35`; `teacher-transaction.ts:45-47` | wallet service suite `backend/services/billing/wallet.service.test.ts:208` (insufficient → zero rows), :237 (exact-balance guard), :251 (validation matrix) |
| AC3 earning ↔ session | `wallet.repository.ts:64-98` | service suite :2396; journey :451 |
| AC4 immutability | `3-immutability-triggers.sql:87-113` | exercised by journey cleanup via `withImmutabilityTriggersSuspended` (`test/helpers/db-cleanup.ts:229`) |

#### Additional Details

- **Priority:** P1 · **Complexity:** none · **Dependencies:** none.

---

## Requirement 6: Semantic Reconciliation Record (Ticket Wording vs Shipped Model) — Status: RECONCILE (documentation only)

**User Story:** As a future ticket author, I need the binding escrow semantics recorded so I stop re-deriving them from contradictory ticket prose.

#### Acceptance Criteria

1. WHEN the ticket gherkin says "balance held (not decremented yet)" (`docs/planning/TICKETS.md:1722`) THEN the plan SHALL record the binding ruling: **hold = guarded debit of one unit at request** (trial-first per INV-B4), settlement flips `fee_held = false` and credits the wallet, cancellation re-increments the SAME lane — as ruled in `ai/finished_plans/milestone_1_core_domain_mvp/session-creation-lifecycle-scheduled-sta/specs.md` ruling #2 and ratified by `ai/plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/plan.md` D1.
2. WHEN the ticket implies dispute-after-confirmation THEN the plan SHALL record the shipped divergence: `disputed` is not reachable from `completed`; arbitration diverges per dual-confirmation plan decision D-2 (`ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/plan.md`) — no code change.
3. WHEN the wallet credit is described as money THEN the plan SHALL record that student-side escrow is unit lanes while teacher-side credit is the EGP fee string — the two sides reconcile at settlement by design, and the Milestone 4 Financial Safety Verification ticket (`docs/planning/TICKETS.md:2985-3026`) owns the end-to-end money audit.
4. WHEN the reconciliation is complete THEN it SHALL live in `outcome/3.x-reconciliation-outcome.md` AND the propagated doc (Task 4) — code remains untouched.

#### Additional Details

- **Priority:** P1 · **Complexity:** small (writing only) · **Dependencies:** REQ-1..REQ-5 evidence complete.

---

## Requirement 7: Regression Proof & Traceability — Status: VERIFY (the executable core of this plan)

**User Story:** As a reviewer, I need one command-list whose green output, plus a matrix, proves this ticket is done without new code.

#### Acceptance Criteria

1. WHEN the verification phase runs THEN the following suites SHALL pass and their output SHALL be captured via `bun run test/scripts/run-test.ts`:
   - `backend/services/classes/session-lifecycle.service.test.ts` (escrow/credit/refund/race unit-integration)
   - `backend/services/billing/wallet.service.test.ts` (wallet invariants, withdrawal guard)
   - `backend/db/test/repo/classes/session.repository.test.ts` (guarded primitives, races)
   - `test/workflows/sessions/session-dual-confirmation.journey.test.ts` (end-to-end credit + replay + sweep race)
   - `test/workflows/sessions/session-lifecycle.journey.test.ts` (book-hold-cancel arc)
   - `test/workflows/sessions/session-lifecycle-denials.journey.test.ts` (insufficient-balance denial + retry)
2. WHEN GraphQL surface is re-proven THEN `backend/graphql/test/session-lifecycle-mutations.test.ts`, `schema-surface.test.ts`, and `sdl-static-assertions.test.ts` SHALL pass (SDL unchanged: zero additions expected).
3. WHEN verification completes THEN `outcome/` SHALL contain the traceability matrix REQ → AC → `path:line` → test file:line, with zero unmapped ACs.
4. IF any suite regresses against the baseline THEN the plan SHALL stop and report — it SHALL NOT fix unrelated pre-existing failures silently.

#### Additional Details

- **Priority:** P0 · **Complexity:** small · **Dependencies:** REQ-1..REQ-6.

---

## Requirement 8: Deferrals & Boundary Hand-Offs — Status: DEFERRED (owned elsewhere)

#### Deferred Items (ledger rows in `deferred-items.md`)

1. **D1 — Runtime escrow idempotency key:** `EscrowTriggerContract`/`WalletCreditContract` (`backend/types/contracts/session-completion-escrow.contract.types.ts:14-80`) define an `idempotencyKey` the runtime credit path does not consume; exactly-once currently rests on the `fee_held = true` predicate. Target: Financial Safety Verification ticket (`docs/planning/TICKETS.md:2985-3026`). Adopting it now would touch tested money paths — out of scope for a verification plan.
2. **D2 — Insert/Return wallet types:** only `WalletSelectType`/`WalletViewType` (`backend/types/billing/wallet.types.ts:4-16`) and `TeacherTransactionSelectType` (`backend/types/billing/teacher-transaction.types.ts:3`) exist; the four-shape convention's Insert/Return variants are absent because no consumer needs them. Target: first ticket that needs them (Withdrawal surface).

#### Boundary Conditions Handed to Dependent Tickets

1. Withdrawal settlement (approve/reject, `failed` transitions): Withdrawal ticket (`docs/planning/TICKETS.md:1799-1845`).
2. Admin re-evaluation wallet deduction: `docs/planning/TICKETS.md:2143-2180`.
3. Double-spend / escrow-integrity stress harness: Financial Safety Verification (`docs/planning/TICKETS.md:2985-3026`) — this plan's REQ-7 evidence is its entry criterion.

---

## Cross-Actor Workflow Scenarios (Journeys)

All three journeys below are **already implemented and covered** by `test/workflows/sessions/*`; this plan re-executes them as proof (REQ-7) rather than authoring new journeys.

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student | STUDENT | `createSession`, `confirmSessionCompletion`, `cancelSession`; observe own balance lanes | Set fees; confirm others' sessions; see teacher wallets |
| Teacher | TEACHER | `startSession`, `completeSession` (+report), view `myWallet`; own earning ledger | Confirm completion (student-only); self-credit |
| Admin | ADMIN/SUPER_ADMIN | Dispute arbitration (`resolveSessionDispute`); governance reads | Create sessions as participant |
| System sweeper | SYSTEM | Cancel + release timed-out holds | Credit wallets from a sweep |

### Journey A — Book → Hold → Dual-Confirm → Credit (happy path)

1. Student → `createSession` → one lane debited (trial first); row inserted with `fee`, `fee_held=true`, `held_balance_lane`, `confirmation_deadline`.
2. Teacher → `startSession` then `completeSession` (+report) → teacher stamp written.
3. Student → `confirmSessionCompletion` → guarded settle: `fee_held=false`, wallet ensured, ONE `earning` (`completed`, amount = fee) inserted, `balance`/`total_earning` += fee.
4. Student (replays confirm) → current row returned; zero financial writes — teacher observes unchanged wallet.
5. Foreign user (confirms) → oracle-safe `SESSION_NOT_FOUND`; zero writes.

**Observer EARS:** WHEN the student's confirm lands THEN the teacher SHALL observe `myWallet.total_earning` increased by exactly `session.fee`; WHEN any replay/foreign attempt runs THEN the teacher SHALL observe zero ledger movement.

### Journey B — Book → Hold → Cancel → Release (no earning)

1. Student books → hold marked, lane debited.
2. Student (or teacher) cancels → `fee_held=false`, same lane re-incremented exactly once.
3. Teacher observes `myWallet.transactions` — NO `earning` row exists for that `session_id`.
4. Double-cancel race → exactly one refund (repo suite :1430).

### Journey C — Insufficient Balance → Deny → Fund → Succeed

1. Student with empty lanes → `createSession` → `INSUFFICIENT_BALANCE`, zero rows.
2. Same idempotency key retried after funding → succeeds exactly once (`session-lifecycle-denials.journey.test.ts:236`).

---

## UX / Navigation Requirements — Explicit No-New-UI Ruling

This plan adds **no routes, no navigation entries, no components**. The user-visible surface already exists and is owned by other tickets:

| Surface | Location | Permission | Roles |
|---|---|---|---|
| Mutation `createSession` | `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:87` | student-only (`$all` scope) | STUDENT |
| Mutation `confirmSessionCompletion` | same file `:293` | participant (student settle) | STUDENT |
| Mutation `cancelSession` | same file `:195` | participant | STUDENT, TEACHER |
| Query `myWallet` | `backend/graphql/query/billing/wallet.query.ts:46-67` | teacher-only | TEACHER |
| Mutation `requestWithdrawal` | `backend/graphql/mutation/billing/wallet.mutation.ts:53-78` | teacher-only | TEACHER |
| `Session` object `fee`/`feeHeld` fields | `backend/graphql/pothos/classes/session.pothos.ts:170,174-175` | session viewers | per session visibility |

Sidebar/mobile placement for a wallet page belongs to the Withdrawal ticket; not this plan.

---

## Non-Functional Requirements

1. **Financial integrity:** WHEN any escrow transition runs THEN it SHALL be atomic in one `withTransaction` and exactly-once — REQ-3/REQ-4 suites prove it, incl. races (`Promise.allSettled`).
2. **Observability:** WHEN a denial fires THEN it SHALL log via `logger.logDomainError` with code + entity id (`session-lifecycle.confirmation.ts:70-75,98-103`).
3. **Performance:** settlement SHALL add ≤ 2 statements to the confirmation transaction (guard update + ledger insert + wallet update composed in `creditEarningOnce`) — no new round-trips introduced by this plan.
4. **Auditability:** WHEN this plan closes THEN every REQ SHALL carry code+test citations that were re-verified on 2026-09-11.

## Constraints and Assumptions

- No schema, resolver, service, or UI changes; any discovered need becomes a ledger row.
- Money at rest is decimal-as-string (`decimal(10,2)`); tests assert verbatim fee strings.
- Environment: Bun runtime; suites run through `test/scripts/run-test.ts` (log capture); journeys commit fixtures and hard-delete via registry.

## Success Criteria (Definition of Done)

- [ ] All REQ-7 suites green with captured output in `outcome/`.
- [ ] Traceability matrix: every AC of both tickets mapped to code + test citation; zero unmapped.
- [ ] Reconciliation record accepted (REQ-6) and propagated into `docs/billing/`.
- [ ] `deferred-items.md` has zero `❌`/`⚠️` rows whose Target is inside this plan.
- [ ] Phase 1.5 review gate report at `outcome/plan-review-R1.md` with pass verdict.

## Glossary

| Term | Meaning |
|---|---|
| Hold / escrow | `session.fee_held=true` plus a consumed unit lane; released by settle (false + credit) or refund (false + lane returned) |
| Lane | Student unit balance column: `balance_trial`, `balance_hifz`, `balance_tajweed` |
| Settlement | Student's dual-confirmation flip that consumes the hold and credits the teacher |
| Provenance | `session.held_balance_lane` remembering which lane paid, so refunds return home |

## Requirements Review Checklist

- [x] All roles addressed (actor table) · [x] EARS phrasing · [x] Journeys captured with observer-perspective criteria · [x] UX/nav explicitly ruled · [x] Each AC carries evidence · [x] No conflicting requirements (divergences recorded in REQ-6) · [x] Scope matches the close-the-loop directive.
