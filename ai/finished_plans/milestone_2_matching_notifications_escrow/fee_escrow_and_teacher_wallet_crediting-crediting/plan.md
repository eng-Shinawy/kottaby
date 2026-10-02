# Design — Fee Escrow & Teacher Wallet Crediting (Close-the-Loop Verification)

**Plan Directory:** `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/`
**Requirements:** `specs.md` (same directory) · **Tickets:** `docs/planning/TICKETS.md:1704-1796` · **Milestone:** 2

---

## Document Information

| Field | Value |
|---|---|
| Version | 1.0 |
| Date | 2026-09-11 |
| Status | Design complete — verification-scoped |
| Companion | `specs.md`, `tasks.md` |

---

## Overview

Both ticket surfaces shipped inside Session Creation & Lifecycle and Dual-Confirmation Completion Handshake (both finished, all tasks `[x]`). This design therefore specifies **how to prove and ratify**, not how to build: an evidence plan over the live code, a reconciliation record for the ticket-vs-shipped semantic gap, and a regression harness whose green output is the deliverable.

### Design Goals

1. Zero new production code (schema, services, resolvers, UI).
2. Every acceptance criterion carries a verified `path:line` code citation and a running test citation.
3. Divergences between ticket wording and shipped behavior are recorded as binding rulings, not silently absorbed.
4. Hand the Milestone 4 Financial Safety Verification ticket a proven foundation (its Blocked-By).

### Key Design Decisions

**D1 — Close-the-loop, not reimplementation.**
*Context:* Code-state verification (2026-09-11) found every ticket AC already implemented and test-covered.
*Decision:* This plan proves, reconciles, and propagates knowledge; it introduces no new runtime code.
*Rationale:* Rebuilding would duplicate tested money paths — the exact failure mode the ticket directive warns against.

**D2 — Hold-as-debit is the binding escrow semantics.**
*Context:* Ticket gherkin says "balance held (not decremented yet)"; shipped behavior debits one lane unit at request (trial-first), with provenance in `held_balance_lane`.
*Decision:* Ratify the shipped semantics (already ruled in session-creation specs.md ruling #2 and ratified by `ai/plans/milestone_1_core_domain_mvp/segregated_session_balance-crediting/plan.md` D1). The ticket wording is superseded and noted as such.
*Rationale:* The debit-at-request model is what makes double-booking races lose by construction (guarded `UPDATE … WHERE balance > 0`).

**D3 — No runtime adoption of the escrow idempotency-key contracts.**
*Context:* `session-completion-escrow.contract.types.ts:14-80` is type-level; exactly-once runs on the `fee_held = true` guard predicate.
*Decision:* Record as deferral D1 targeting Financial Safety Verification; do not touch the money path in a verification plan.
*Rationale:* Current predicate is race-proven (confirm-vs-sweep both directions, repo suite :1582/:1617); adding a key now would be change-for-change's-sake on tested code.

**D4 — Dispute-from-`completed` divergence stands.**
*Context:* Ticket/B.18 imply post-confirmation dispute; shipped state machine rejects it (dual-confirmation plan D-2).
*Decision:* Document the divergence; the Dispute Resolution plan (`ai/plans/milestone_3_parent_portal_admin_governance/dispute-resolution-with-admin-arbitration/`) owns any redesign.

---

## UX / Navigation Specification — Explicit No-New-UI Ruling

This plan ships **zero routes, zero navigation entries, zero components**. The row below is the complete route table; the rest of this section inventories the pre-existing surface so dependent tickets can consume it.

### New Routes & URLs

| Route | Purpose | Permission | Roles with Access |
|---|---|---|---|
| — none — | — | — | — |

### Sidebar Navigation Integration

None. Teacher wallet UI placement (sidebar group, mobile order) belongs to the Withdrawal Workflow ticket (`docs/planning/TICKETS.md:1799-1845`), which consumes the `myWallet` query this plan verifies.

### Pre-Existing Surface Inventory (verified 2026-09-11)

| Surface | Kind | Location | Role Access |
|---|---|---|---|
| `createSession` | GraphQL mutation | `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:87` | STUDENT (`$all` scope) |
| `startSession` / `completeSession` | GraphQL mutation | same file `:144` / `:169` | TEACHER |
| `cancelSession` | GraphQL mutation | same file `:195` | STUDENT, TEACHER (participants) |
| `openSessionDispute` / `resolveSessionDispute` | GraphQL mutation | same file `:223` / `:255` | participant / ADMIN |
| `confirmSessionCompletion` | GraphQL mutation | same file `:293` | STUDENT (settle), TEACHER (no-op arm) |
| `myWallet` | GraphQL query | `backend/graphql/query/billing/wallet.query.ts:46-67` | TEACHER (lazy-ensure) |
| `requestWithdrawal` | GraphQL mutation | `backend/graphql/mutation/billing/wallet.mutation.ts:53-78` | TEACHER |
| `Session.fee`, `Session.feeHeld` | SDL fields | `backend/graphql/pothos/classes/session.pothos.ts:170,174-175` | session viewers |
| `Wallet`, `TeacherTransaction` objects | SDL types | `backend/graphql/pothos/billing/wallet.pothos.ts:86-147` | TEACHER (via `myWallet`) |

### Role-Based Access Matrix (existing behavior, re-asserted by REQ-7 GraphQL suites)

| Capability | SUPER_ADMIN | ADMIN | SUPERVISOR | TEACHER | PARENT | STUDENT |
|---|---|---|---|---|---|---|
| Request session (hold opens) | — | — | — | — | — | ✔ |
| Confirm completion (settle) | — | — | — | — | — | ✔ (participant) |
| Cancel (release) | — | — | — | ✔ participant | — | ✔ participant |
| Dispute arbitration | ✔ | ✔ | — | — | — | — |
| Read wallet / ledger | — | — | — | ✔ own | — | — |
| Request withdrawal | — | — | — | ✔ own | — | — |

### Per-Audience Rendering

N/A — no UI. GraphQL field visibility follows resolver-level role guards listed above; `myWallet` never exposes another teacher's data (zero-arg, `ctx`-derived).

---

## Translation System Requirements

No new user-facing strings. Compliance obligations carried by this plan: (1) all denial citations use the real localized keys — `insufficientBalance` (`shared/locale/types/errors/labels.ts:174`; en `shared/locale/en/errors/index.ts:85`; ar `shared/locale/ar/errors/index.ts:84`), `sessionNotFound`, `sessionInvalidTransition`, `duplicateRequest`; (2) any touched artifact uses no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`, no `console.*`; enum references name the real members (`TransactionType.Earning`, `TransactionStatus.Completed`).

---

## Concurrency & Race Condition Assessment (existing mitigations, re-proven by REQ-7)

| Scenario | Actors | Risk | Mitigation (verified) |
|---|---|---|---|
| Double-booking with one unit left | 2 requests, same student | Double hold | Guarded debit `decrementLaneIfAvailable` (`backend/db/repo/students/student.repository.ts:478-493`); second misses → `INSUFFICIENT_BALANCE` |
| Duplicate request replay | Retries / double-click | Two sessions | Request idempotency claim, savepoint-bracketed (`session-lifecycle.booking.ts:225-238`) |
| Confirm vs. confirmation sweep | Student confirm ∥ timeout sweeper | Double settle (credit + refund) | Mutually exclusive guard predicates; repo race tests :1582, :1617; journey :620 asserts exactly ONE financial outcome |
| Re-confirm / teacher-confirm | Participant retries | Double credit | Zero-write replay arms (`session-lifecycle.confirmation.ts:86-104`); service suite :2439, :2469 |
| Double-cancel | Two cancels | Double refund | Second cancel → `SESSION_INVALID_TRANSITION`; repo suite :1430 (`Promise.allSettled`) |
| Dispute vs. settle | Admin arbitration ∥ confirm | Split-brain escrow | One guarded transition consumes the hold; loser classified by probe |

`SELECT … FOR UPDATE` usage: teacher certification lock in booking (`session-lifecycle.booking.ts:202`, via `TeacherRepository.lockForCertificationCheck`). Escrow guards otherwise live in UPDATE predicates — no TOCTOU window reopens between the probe (classification-only) and the guarded write.

## Cross-Actor Journey Design

### Shared-Entity State Machine (`session`, escrow perspective)

| Current State | Trigger (actor + action) | Next State | Guard / Permission |
|---|---|---|---|
| — (no row) | Student `createSession` | `scheduled`, `fee_held=true` | lane debit succeeds; certified-teacher lock; idempotency claim |
| `scheduled`, held | Teacher `startSession` | `started`, held | participant teacher |
| `started`, held | Teacher `completeSession` + report | `completed`, held, teacher stamp | participant teacher |
| `completed`, held | Student `confirmSessionCompletion` | `completed`, `fee_held=false`, **earning written** | guarded UPDATE predicate (REQ-3 AC1) |
| held-any-state | Participant `cancelSession` | `cancelled`, `fee_held=false`, lane refunded | participant; transition whitelist |
| `completed`, held, deadline lapsed | System sweeper | `cancelled`, `fee_held=false`, lane refunded | `confirmation_deadline < now` |
| `completed`, held | Student re-confirm / teacher confirm | unchanged | replay arm (zero writes) |

### Side-Effect Matrix

| Transition | Rows Created/Updated | Notifications | Idempotency |
|---|---|---|---|
| Book | `session` insert; lane −1; claim row | teacher request notification (existing) | request idempotency key |
| Settle | `session` stamp + `fee_held=false`; `teacher_transaction` (earning/completed); `wallet` +=fee | teacher earning credit surfaces via `myWallet` | `fee_held=true` predicate |
| Cancel/Sweep/Arb-cancel | `session` → cancelled, hold cleared; lane +1 (provenance) | per dual-confirmation/notification plans | guarded single-winner transition |
| Replay of any terminal op | none | none | replay arms / probe classification |

### Cross-Actor Visibility

| State | Teacher sees | Student sees | Admin sees |
|---|---|---|---|
| Held | session + `feeHeld=true` | session + lane −1 | governance read |
| Settled | wallet + one earning row | session completed | settlement in audit surfaces |
| Released (cancel/sweep) | NO earning row | lane +1 back | release in audit surfaces |

---

## Outcome & Knowledge Transfer Protocol

- BEFORE any task: read all files under the outcome directory.
- AFTER each task: write `outcome/<task-id>-outcome.md` (findings, citations re-verified, carry-overs) and flip the task's checkbox in `tasks.md`.
- AFTER the plan: Task 4 propagates the escrow/ledger invariants into `docs/billing/` per the knowledge-propagation rules.

## Architecture

No architectural change. The verified shape (unchanged by this plan):

```
Client → GraphQL mutation (session-lifecycle.mutation.ts)
  → SessionLifecycleService (withTransaction)
    → SessionRepository / StudentRepository / SessionRequestIdempotencyRepository / WalletRepository
      → session / students / session_request_idempotency / wallet / teacher_transaction
```

Money-side settlement composes INSIDE the confirmation transaction (`session-lifecycle.confirmation.ts:112-139`) — no post-commit hook, no queue.

## Components and Interfaces (existing inventory this plan verifies)

### SessionLifecycleService (`backend/services/classes/session-lifecycle.service.ts`)

- `createSession(studentId, input, idempotencyKey, locale, outerTx?)` — :196-215 — opens escrow (REQ-1/2).
- `confirmSessionCompletion(...)` — :721-733 — settles escrow + credits wallet (REQ-3).
- `cancelSession(...)` — :459-493 — releases escrow (REQ-4).
- `sweepExpiredSessions(...)` — :776-796 — timeout release (REQ-4 AC4).

### Repositories (signatures verified 2026-09-11)

- `WalletRepository.ensureWalletOnce(teacherId, tx?) → WalletSelectType` — `backend/db/repo/billing/wallet.repository.ts:45`
- `WalletRepository.creditEarningOnce({walletId, sessionId, amount, description}, tx?) → TeacherTransactionSelectType` — `:64-98`
- `WalletRepository.findByTeacherId` / `listTransactionsByWalletId` / `debitForWithdrawalOnce` / `listRecentTransactions` — `:105/:116/:145-178/:187`
- `SessionRepository.confirmStudentCompletionOnce` — `backend/db/repo/classes/session.repository.ts:433-455`; `cancelSessionOnce` :217-231; `resolveDisputeCancelOnce` :280-290; `sweepExpiredScheduledOnce`/`sweepExpiredCompletedOnce` :473/:503-517
- `StudentRepository.decrementLaneIfAvailable(studentId, lane, tx?) → boolean` — `backend/db/repo/students/student.repository.ts:478-493`; `incrementLane` :507-517
- `SessionRequestIdempotencyRepository.insertClaim/findByKey/updateClaimSessionId`

## Data Models (existing — verified, unchanged)

- `session` — `backend/db/schema/classes/session.ts:50-87`: `fee` decimal(10,2) nullable (:63), `feeHeld` boolean default false (:64), `heldBalanceLane` varchar provenance (:65), dual-confirm stamps + deadline (:68-70).
- `wallet` — `backend/db/schema/billing/wallet.ts:17-37`: unique `teacher_id`, `balance`/`total_earning` decimal with `>= 0` CHECKs (:33-35).
- `teacher_transaction` — `backend/db/schema/billing/teacher-transaction.ts:26-49`: FK wallet (RESTRICT), nullable `session_id`, `amount` CHECK `>= 0` (:45), enum `type`/`status` (:36-37), indexes :46-47; immutable via triggers `backend/db/migration/3-immutability-triggers.sql:87-113`.
- Enums: `transaction_type {earning, withdrawal, bonus}`, `transaction_status {pending, completed, failed}` — `backend/db/schema/enums.ts:31,33`; TS mirrors `backend/enum/billing/transaction-type.enum.ts:6-10`, `transaction-status.enum.ts:5-9`.
- Contract pins (type-level only): `DualConfirmationState`, `EscrowTriggerContract`, `WalletCreditContract`, `EscrowReleaseContract` — `backend/types/contracts/session-completion-escrow.contract.types.ts:14-80`.

## API Design (existing — SDL re-proven by REQ-7.2)

```graphql
# escrow/wallet surface (excerpt — authoritative SDL in the generated schema)
# the request idempotency key rides the HTTP header into ctx.idempotencyKey,
# it is NOT a mutation argument (session-lifecycle.mutation.ts:138)
type Mutation {
  createSession(input: CreateSessionInput!): Session!
  startSession(id: ID!): Session!
  completeSession(id: ID!): Session!
  cancelSession(id: ID!, reason: String): Session!
  confirmSessionCompletion(id: ID!): Session!            # settle + wallet credit
  resolveSessionDispute(id: ID!, resolution: DisputeResolution!, note: String): Session!
  requestWithdrawal(input: RequestWithdrawalInput!): Wallet!  # returns updated wallet
}
type Query { myWallet: Wallet! }                          # teacher-only, lazy-ensure
```

`Session.fee: String` (nullable), `Session.feeHeld: Boolean!` — `session.pothos.ts:170,174-175`. SDL delta from this plan: **zero**.

## Security Considerations (existing mitigations under audit)

- **BOLA/IDOR:** confirmation denial is oracle-safe (missing vs. foreign indistinguishable, `session-lifecycle.confirmation.ts:66-76`); wallet reads are `ctx`-derived, never by passed id.
- **BFLA:** booking is student-scoped; arbitration is admin-only (`session-lifecycle.mutation.ts:255`); withdrawal is teacher-only.
- **BOPLA:** booking input omits fee entirely — mass-assignment of price is structurally impossible.
- **Immutability:** ledger UPDATE/DELETE blocked at the DB layer (triggers), not just by convention.
- **Tenancy:** no cross-tenant surface exists in the wallet domain (teacher-only own wallet).
- This plan's audit subtasks re-verify each of the above rather than re-asserting by prose.

## Error Handling (existing taxonomy, cited)

| Case | Code | Class | Citation |
|---|---|---|---|
| Empty lanes at booking | `INSUFFICIENT_BALANCE` | `ValidationError` (422 family), localized | `session-lifecycle.booking.ts:113` |
| Duplicate request | `DUPLICATE_REQUEST` | `ConflictError` | `session-lifecycle.booking.ts:225-238` |
| Foreign/missing confirm | `SESSION_NOT_FOUND` | `NotFoundError` | `session-lifecycle.confirmation.ts:66-76` |
| Wrong-state confirm | `SESSION_INVALID_TRANSITION` | `ConflictError` | `session-lifecycle.confirmation.ts:86-104` |
| Hold without fee (impossible) | fail-closed throw | internal | `session-lifecycle.confirmation.ts:123-127` |
| Withdrawal over balance | `WALLET_INSUFFICIENT_FUNDS` | `ValidationError` | wallet service suite :208 |

## Performance

No new statements. Settlement adds one guarded UPDATE + one INSERT + one guarded UPDATE to the existing confirmation transaction. Booking already runs the fixed-order lock → debit → claim → insert sequence. Index coverage for ledger reads: `teacher_transaction(wallet_id)`, `(session_id)`.

## Testing Strategy (verification harness)

| Tier | Suite | Run command |
|---|---|---|
| Service (rollback tx) | `backend/services/classes/session-lifecycle.service.test.ts`; `backend/services/billing/wallet.service.test.ts` | `bun run test/scripts/run-test.ts <path>` |
| Repository (rollback tx) | `backend/db/test/repo/classes/session.repository.test.ts` | same |
| Journey (committed fixtures) | `test/workflows/sessions/session-dual-confirmation.journey.test.ts`; `session-lifecycle.journey.test.ts`; `session-lifecycle-denials.journey.test.ts` | same |
| GraphQL/SDL pins | `backend/graphql/test/session-lifecycle-mutations.test.ts`; `schema-surface.test.ts`; `sdl-static-assertions.test.ts` | `bun run test:graphql` scoped — see tasks.md |
| Type-level pins | `backend/db/repo/students/__tests__/student-lane-debit.test-d.ts`; `backend/types/contracts/*.test-d.ts` | via tsgo stage |

New tests authored by this plan: **none required** — any genuine gap found during evidence capture becomes a ledger row with a target ticket.

## Deployment and Operations

Nothing to deploy. Verification runs against the existing dev/test stack; journeys self-clean (`afterAll` registry + zero-residue re-probe).

## Migration and Compatibility

No migrations. `bun run db push` / `migrate` are NOT invoked by this plan. Backward compatibility is definitionally preserved (no code change).

## Design Review Checklist

- [x] Every requirement maps to evidence + test · [x] UX/Nav explicitly ruled (no UI) with role matrix inventoried · [x] Journey state machine + side-effect matrix + visibility table present · [x] Concurrency assessment with existing mitigations · [x] No new secrets/env keys · [x] No schema changes (push/migrate untouched) · [x] Deferrals bound to named target tickets.
