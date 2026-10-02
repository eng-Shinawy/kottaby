# Design — Financial Safety Verification (Double-Spend, Escrow Integrity)

<!-- Plan Directory: ai/plans/milestone_4_integration_security_launch/financial-safety-verification/ -->
<!-- Input: specs.md (REQ-0 … REQ-6) · Ticket: docs/planning/TICKETS.md:2985-3026 (Milestone 4, Dev 3, 5 pts) -->

## Document Information

- **Feature Name**: Financial Safety Verification (Double-Spend, Escrow Integrity)
- **Target Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/`
- **Outcome Directory**: `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/`
- **Version**: 1.0 · **Date**: 2026-09-11
- **Related Documents**: `specs.md`, `tasks.md`, `deferred-items.md`

## Overview

This design converts the ticket's adversarial intent into a three-layer executable proof over the **already-shipped** escrow substrate:

1. **Repository tier** (`runInRollback`, savepoint-bracketed probes): close the `WalletRepository` coverage hole; probe CHECK constraints and immutability triggers directly.
2. **Service tier**: extend fuzz/validation and replay assertions for financial entry points (mostly existing; top-ups only where the gap matrix proves absence).
3. **Journey tier** (`test/workflows/billing/`, committed fixtures, real services): cross-actor adversarial narrative — concurrent double-spend on a 1-credit balance, cancel→release, dual-confirm→credit, concurrent withdrawal drain race, and an in-band immutability probe — ending with a recomputed accounting identity.

The design deliberately adds **no production code**. Every cited mechanism below was verified against the codebase on 2026-09-11 (see `outcome/`). If a probe fails, the failure is a defect finding: fix is minimal, adjacent, and ledgered — never a redesign inside this ticket.

### Design Goals

- **Proof, not presence**: every invariant has a named failing-capable test, not a comment.
- **Race realism with port determinism**: `Promise.allSettled` races whose assertions are sum-invariants, meaningful on both multi-connection PostgreSQL and serialized PGlite.
- **Zero production churn**: verification-only diff; schema/resolvers/services untouched unless a probe exposes a defect.
- **Ledger-conformant evidence**: outcome files record every probe result; deferred items capture out-of-authority findings.

### Key Design Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| D-1 | Verification-only plan; no new production modules | Ticket scope ("automated tests that attempt to exploit"); industrial state-of-practice |
| D-2 | Double-spend race lives in the journey layer | `runInRollback` serializes one tx — true parallel bookings need committed fixtures + separate connections; service-tier covers sequential replay/zero-balance |
| D-3 | Accounting identity asserted as recomputation from `teacher_transaction` rows | Direct executable reading of the ticket Gherkin; decimal-string comparisons avoid float error |
| D-4 | Immutability probed at the DB trigger tier (raw UPDATE/DELETE under savepoint) | The trigger IS the guarantee; app-level "no setter" is asserted as API-surface shape, not trusted as enforcement |
| D-5 | Withdrawal identity uses Σ(pending ∪ completed) | Matches shipped debit-on-request semantics (`wallet.repository.ts:145-178`); `failed` vacuous until settle flow lands elsewhere |
| D-6 | No-UI ruling; permission matrix covers exercised mutations only | No user-facing surface exists in this ticket |

### UX/Navigation Specification (Explicit No-UI Ruling)

**New Routes & URLs:** none. **Sidebar integration:** none. **Mobile bottom nav:** none.

#### Role-Based Access Matrix (unchanged; existing surfaces exercised by the journey)

| Role | Surface exercised in tests | Permission path |
|------|---------------------------|-----------------|
| STUDENT | `createSession`, `confirmSessionCompletion`, cancel own session | participant predicate in `session.repository.ts:217,433-455` |
| TEACHER | `completeSession`, `myWallet`, `requestWithdrawal` | teacher-only guards in `session-lifecycle.service.ts:332` / `wallet.service.ts:213` |
| SUPER_ADMIN / system | `resolveSessionDispute`, cron sweep | admin guard; cron route `app/api/cron/sweep-sessions/route.ts:100` |
| PARENT / GUEST | none (denials may be probed at journey tier) | honest-auth denials only |

#### Per-Audience Rendering
N/A — no rendering work. Wallet visibility difference (teacher-only `myWallet`) is asserted via the honest-auth denial probe in the journey.

### Translation System Requirements (explicit N/A ruling)

No user-facing UI strings are added, so the component translation system is out of scope. The only text-touch points are **error assertions** in tests, governed by REQ-0.5: value-import enums, canonical translated error substrings (`expectDomainDenial` / `getServerTranslations("en")` patterns), and no `Translation.` / two-arg `getTranslations` usage anywhere in the plan's artifacts.

## Architecture

### System Context

```mermaid
graph LR
    subgraph New Test Artifacts
      A[wallet.repository.test.ts]
      B[financial-immutability.test.ts]
      C[financial-safety-verification.journey.test.ts]
    end
    subgraph Shipped Substrate (verified, unmodified)
      D[SessionLifecycleService]
      E[WalletService]
      F[WalletRepository]
      G[StudentRepository debit ladder]
      H[SessionRepository guarded transitions]
      I[(PostgreSQL/PGlite: checks + triggers)]
    end
    A --> F; B --> I; C --> D; C --> E; A --> I
    D --> G; D --> H; E --> F
```

### Technology Stack
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Tests | bun:test | house standard for db/service/workflow layers |
| Runner | `test/scripts/run-test.ts` | mandated log-capture wrapper |
| DB | PGlite sandbox / PostgreSQL | dual-runtime by design |

## Data Models (EXISTING — verified, unmodified)

| Table | Key columns (verified) | Safety mechanisms |
|---|---|---|
| `students` `backend/db/schema/students/students.ts:24-28` | `balance_hifz/balance_reviews/balance_tajweed/balance_trial` int lanes | CHECK ≥ 0 per lane (`:42-45`) |
| `session` `backend/db/schema/classes/session.ts:60-65` | `fee decimal(10,2)`, `fee_held bool`, `held_balance_lane varchar` | guarded UPDATEs only (no table-level checks/triggers) |
| `wallet` `backend/db/schema/billing/wallet.ts:20-35` | `balance/total_earning decimal(10,2)`, `teacher_id` | CHECK ≥ 0 ×2; `wallet_teacher_id_unique` |
| `teacher_transaction` `backend/db/schema/billing/teacher-transaction.ts:29-47` | `wallet_id`, `session_id?`, `amount`, `type`, `status` | CHECK amount ≥ 0 (`:45`); UPDATE/DELETE immutability trigger (`backend/db/migration/3-immutability-triggers.sql:86-113`) |
| `student_payments` | `amount`, `pg payment_status` | partial-transition trigger (custom_4 migration) |
| `session_request_idempotency` | unique idempotency key | replay prevention (`booking.ts:225-238`) |

**Enums in play** (all value-imports in tests): `HeldBalanceLane { Trial, Hifz, Tajweed }` (`backend/enum/scheduling/held-balance-lane.enum.ts:17-21`) · `TransactionType { Earning, Withdrawal, Bonus }` · `TransactionStatus { Pending, Completed, Failed }` (`backend/enum/billing/transaction-*.enum.ts`) · pg `session_status = scheduled|started|completed|cancelled|disputed`.

## API Contracts (Existing Surface — SDL & Permissions)

**Ruling:** zero new GraphQL fields. The verification exercises and pins existing behavior; SDL remains as registered today.

| Field | Type | Auth | Verified guard |
|---|---|---|---|
| `createSession` | mutation | student/borrower role | certification lock + guarded debit + idempotency (`session-lifecycle.mutation.ts:87`) |
| `startSession` / `completeSession` | mutation | session teacher | `completeSessionOnce` owning-teacher predicate (`:177-197`) |
| `cancelSession` | mutation | participant | `cancelSessionOnce` live-state predicate (`:217`) |
| `confirmSessionCompletion` | mutation | session student | exactly-once predicate `fee_held AND confirmedByStudentAt IS NULL` (`:433-455`) |
| `openSessionDispute` / `resolveSessionDispute` | mutation | participant / admin | guarded transitions (`:248/:280/:313`) |
| `myWallet` | query | teacher only | `wallet.query.ts:46` |
| `requestWithdrawal` | mutation | teacher only, validated amount | guarded debit `wallet.repository.ts:145-178` |

Schema-surface pinning already exists (`backend/graphql/test/schema-surface.test.ts:222-224`); the journey adds behavioral authority assertions on top.

## Service & Repository Signatures (verified — inputs to test authoring)

```text
SessionLifecycleService.createSession(studentId, input: SessionSubmitInput, idempotencyKey, locale, outerTx?) → SessionReturnType
  └─ backend/services/classes/session-lifecycle.service.ts:196 → booking.ts:192 (withTransaction)
StudentRepository.decrementLaneIfAvailable(studentId, lane: HeldBalanceLane, tx?) → boolean
  └─ backend/db/repo/students/student.repository.ts:478-493 (single guarded UPDATE)
StudentRepository.incrementLane(studentId, lane, tx?)      └─ :507 (release path)
WalletService.requestWithdrawal(callerUserId, rawAmount: string, locale, outerTx?) → WalletViewType
  └─ backend/services/billing/wallet.service.ts:213-257
WalletRepository.ensureWalletOnce(teacherId, tx?) → WalletSelectType          └─ wallet.repository.ts:45
WalletRepository.creditEarningOnce({walletId, sessionId, amount, description}, tx?) → TeacherTransactionSelectType
  └─ wallet.repository.ts:64-98 (ledger insert + additive wallet UPDATE, one tx)
WalletRepository.debitForWithdrawalOnce({walletId, amount, description}, tx?) → TeacherTransactionSelectType | null
  └─ wallet.repository.ts:145-178 (pending row + `balance >= amount` guarded UPDATE)
SessionRepository.cancelSessionOnce / confirmStudentCompletionOnce / sweepExpired*Once / resolveDispute*Once
  └─ session.repository.ts:217 / :433-455 / :473,:503 / :280,:313
Test harness: runInRollback (backend/db/test/test-utils.ts:34) · expectRepoError (:77) · constraintNameOf (:111)
Fixtures: createTestWallet (entity-setup.ts:450) · createTestTeacherTransaction (:486) · createTestStudent (:102)
```

## Concurrency & Race Condition Assessment (assessed against shipped code)

| # | Scenario | Guard under test | Expected provable outcome |
|---|---|---|---|
| C1 | N concurrent `createSession`, 1 credit | single-statement guarded debit `WHERE balance_lane > 0` (PG row lock during UPDATE) | 1 winner / N−1 zero-row rejections; lane ends 0 |
| C2 | same-key replay reservation | `session_request_idempotency` unique key + savepoint | `DUPLICATE_REQUEST`; replay costs nothing |
| C3 | teacher certification lock | `lockForCertificationCheck` `.for("update")` (`teacher.repository.ts:192-202`) | serialized booking per teacher |
| C4 | confirm replay / arbitration race on consumed hold | exactly-once predicate in `confirmStudentCompletionOnce` | second attempt matches 0 rows, credits nothing |
| C5 | double cancel | terminal-state predicate in `cancelSessionOnce` | exactly one release |
| C6 | confirm-vs-sweep | existing coverage (journey `:620`) | consume XOR refund, never both |
| C7 | concurrent full-balance withdrawals | guarded `balance >= amount` debit | exactly one winner; balance ≥ 0 always |
| C8 | double first-earning wallet creation | `ensureWalletOnce` ON CONFLICT + unique key | one wallet row regardless of race |

**TOCTOU statement:** all balance/quota mutations are check-and-set in ONE statement (no read-then-write). The only read-before-write steps (validation overlays, certification reads) compound INTO the guarded predicate, never preceding it. Wallet↔ledger atomicity rests on same-transaction composition; no cross-transaction window exists inside a single financial event.

## Cross-Actor Journey Design

**Shared-entity state machine (financial view of `session`):**

| State | `fee_held` | Trigger (actor) | Next state | Financial side effect |
|---|---|---|---|---|
| — | — | student createSession | `scheduled`, `fee_held=true` | lane −1 (guarded) |
| `scheduled` | true | student/teacher cancels · dispute-cancel · sweep | `cancelled`, `fee_held=false` | provenance lane +1; zero ledger rows |
| `started` | true | teacher completes | `completed` (pending student confirm) | none |
| `completed` | true | student confirms | confirmed | lane consumed; wallet += fee; one earning row |
| `completed` | true | sweep (24h expiry) | auto-handled | release provenance lane; zero ledger rows |
| `disputed` | true | admin resolves complete | `completed`, consumed | **no wallet credit** (upstream ruling — reference only) |

**Side-effect matrix (journey assertion set):**

| Step | Rows written | Ledger rows | Notification surface |
|---|---|---|---|
| booking win | 1 `session`, 1 idempotency claim | 0 | none (no booking notifications — verified) |
| cancel | `cancelled` + lane restore | 0 | none |
| student confirm | confirm stamps + `fee_held=false` | 1 earning (completed) | completion-prompt emitter post-commit (spied) |
| withdrawal win | 1 withdrawal row + wallet debit | 1 pending | none |

**Cross-Actor Visibility:** student sees lane movement; teacher sees `myWallet` growth only post-confirmation; admin/analytics count pending withdrawals; non-participants see nothing (denial probe).

## Security & Tenancy Mitigations

- **Honest authorization**: journey uses real users/requirements; denial probes (non-participant confirm/cancel; parent role touching wallet) assert real permission paths — never monkey-patched.
- **BOLA scope of tests**: fixtures are per-run (`jrn_billing_<uuid8>` prefix); all assertions scoped to own fixtures.
- **Secrets**: none introduced; no env/config changes. `resolveEnvConfig` untouched.
- **Injection surface**: raw SQL probes confined to savepoint-bracketed, parameterized constraint checks in test tier.
- **Trigger teardown**: immutability-trigger teardown follows the sanctioned suspension used by `session-dual-confirmation.journey.test.ts:41-45` (drop-and-recreate assertions remain covered by trigger-presence probes). Acknowledged tension: `test/workflows/AGENTS.md` prefers asserting **zero rows** in trigger-immutable tables over writing into them; the confirmed-earning row this journey deliberately creates is asserted, then removed under the same sanctioned suspension — deviations are documented in the journey file header.

## Error Handling (test-tier expectations)

| Trigger | Expected error | Surface |
|---|---|---|
| balance exhausted | `ValidationError("INSUFFICIENT_BALANCE")` | booking ladder |
| idempotency replay | `ConflictError("DUPLICATE_REQUEST")` | booking claim |
| withdrawal overdraft | `ConflictError("WALLET_INSUFFICIENT_FUNDS")` | wallet service |
| ledger UPDATE/DELETE | trigger RAISE EXCEPTION (constraint-class error) | PG trigger |
| CHECK probes | `constraintNameOf` → `wallet_balance_check` etc. | savepoint probe |

## Testing Strategy (4-tier mapping)

| Tier | Where |
|---|---|
| T1 branch/statement | `wallet.repository.test.ts` (100% of WalletRepository); immutability probe matrix |
| T2 boundaries | amount 0.00, 7-digit cap, decimal precision; balance exactly-at-lane; confirmation deadline edges |
| T3 chaos | Promise.allSettled races (C1, C7, C8); fuzzed withdrawal payloads |
| T4 security/abuse | honest-auth denials; direct UPDATE/DELETE on ledger; negative-value SQL probes |

**Trigger-tier runtime gating:** immutability probes follow the `describeTriggerTier = isPgliteProvider() ? describe.skip : describe` precedent (`backend/db/test/logic/audit/audit-immutability.test.ts:418`) — un-gated on real PostgreSQL; provider-skipped with a logged note (never silent) on the PGlite sandbox.

**Drizzle SQL note:** no inline `--` comments inside `sql` templates in probes (parameter-shifting anti-pattern).
**Drizzle convention:** schema changes → `bun run db push`; custom SQL only → `bun db migrate`. This plan expects neither (no schema work).

## Outcome & Knowledge Transfer Protocol

- BEFORE any task: read ALL files in `ai/plans/milestone_4_integration_security_launch/financial-safety-verification/outcome/`.
- AFTER each task: write `outcome/<task-id>-outcome.md` (findings, probe results, defect evidence if any).
- Progress: flip checkboxes in `tasks.md`.
- Final: consolidate learnings into `docs/billing/financial-safety-verification.md`.

## Deployment & Migration Impact

None. No migrations, no seeds, no env keys, no rollout. CI impact = new test files join existing suites.

---
*Plan ground-truthed against repository state on 2026-09-11; all path:line citations verified by inspection subagents and spot-checks.*
