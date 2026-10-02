# Admin-Ordered Re-Evaluation — Canonical Reference

**Domain:** Teachers / certification governance (the paid re-evaluation order)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md`
**Sibling docs:** `docs/teachers/applicant-lifecycle.md` (the `applicants` state machine this flow re-opens), `docs/teachers/evaluation-loop-booking.md` (the five-session loop the re-opened applicant re-enters), `docs/teachers/evaluation-rubric-scoring.md` (the verdict writer that closes the loop), `docs/teachers/applicant-cooldown.md` (the cooldown a FAIL verdict stamps), `docs/billing/escrow-and-wallet-crediting.md` (the wallet/debit substrate this fee rides)
**Status:** Implemented and verified

This document is the single canonical reference for the admin-ordered paid re-evaluation: the order pipeline, the two guarded-transition arbiters that make it exactly-once, the fee discipline over the teacher wallet, and the loop re-entry contract that lets an existing unmodified evaluation loop produce the verdict. All layers (repository, service, GraphQL, frontend) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Why

A teacher certification is a verdict produced by the five-session evaluation loop — not an admin-editable flag. When the platform's operators judge a certification unsound (a complaint, a dispute, a quality drift the loop missed), the honest remedy is to **re-run the judgment**, not to patch it: the teacher goes back through the same loop, and the loop's verdict decides. This flow is that re-run, with three properties that make it safe to expose as an admin action:

- **The teacher pays for the re-assessment.** The fee is debited from the subject teacher's own wallet at order time — the deduction is a wallet spend (`balance`), never a rewrite of lifetime earnings (`total_earning`).
- **Certification is withdrawn for the duration.** De-certification structurally excludes the teacher from booking surfaces (the pre-existing `is_approved = true` booking gate) until the loop re-certifies.
- **One order can only ever charge once.** The two state transitions are guarded single-statement writes whose pre-conditions are fused into their `WHERE` predicates — a concurrent duplicate order loses arbitration and its already-executed debit rolls back with its transaction. No idempotency-key machinery is read; the guarded transitions are the arbiter.

## 2. Pattern — the order flow

### 2.1 One mutation, one transaction, ten ordered stages

The entire order is `TeacherReEvaluationService.orderReEvaluation(actorUserId, { teacherId, reason }, locale, outerTx?)` (`backend/services/teachers/teacher-re-evaluation.service.ts`) — ONE transaction whose stage order is load-bearing:

| # | Stage | Implementation anchor | On denial |
|---|---|---|---|
| 1 | Governance gate re-asserted INSIDE the transaction (before any input shape validation) | `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts`) | `UNAUTHORIZED` (no/anonymous actor) / `FORBIDDEN` — deleted/blocked/suspended admins denied even with a valid token |
| 2 | Subject-id shape guard + reason normalization (positive-safe-integer subject id; reason: trim, non-empty, ≤ 229 chars) | `isPositiveSafeInteger` (`backend/services/admin/user-management.helpers.ts`), `normalizeReason` (`backend/services/teachers/teacher-re-evaluation.service.helpers.ts`) | `VALIDATION` — nothing has touched the DB |
| 3 | Subject eligibility: teacher exists + currently certified; applicant row is `passed` | `TeacherRepository.findById`, `ApplicantRepository.findByUserId` | `TEACHER_NOT_FOUND` / `TEACHER_NOT_CERTIFIED` / `APPLICANT_NOT_AWAITING_RE_EVALUATION` |
| 4 | Wallet provisioning (honest zeroed wallet when absent) | `WalletRepository.ensureWalletOnce` (`backend/db/repo/billing/wallet.repository.ts`) | — |
| 5 | Guarded fee debit through the EXISTING shared writer | `WalletRepository.debitAdjustmentOnce` (namespace re-export of the guarded debit + ledger writer in `backend/db/repo/billing/wallet.repository.admin.helpers.ts`) | `WALLET_INSUFFICIENT_FUNDS` — zero rows moved |
| 6 | De-certification (guarded flip `is_approved` true → false) | `TeacherRepository.decertifyOnce` (`backend/db/repo/teachers/teacher.repository.ts`) | `TEACHER_NOT_CERTIFIED` (lost arbitration) |
| 7 | Loop re-open with fresh cycle anchor | `ApplicantRepository.reopenForReEvaluation` (`backend/db/repo/teachers/applicant.repository.ts`) | `APPLICANT_NOT_AWAITING_RE_EVALUATION` (lost arbitration) |
| 8 | Post-debit balance read-back | `WalletRepository.findById` | internal-invariant error only |
| 9 | Exactly ONE audit row, in-transaction | `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts`) — `AuditActionType.Override` on the `teacher` entity, details JSON `{action:"re_evaluation_ordered", amount, walletId, balanceAfter, reEvaluationStartedAt}` | rolls back with the transaction |
| 10 | Return the verbatim-money receipt | `TeacherReEvaluationOrderReturnType` (`backend/types/teachers/teacher-re-evaluation.types.ts`): `{teacherId, amountCharged, currency, walletBalance, reEvaluationStartedAt}` | — |

The reason text lives in exactly one place: the ledger description `Re-evaluation fee: <reason>` composed by `composeReEvaluationDescription` — write-once at order time, machine-distinguishable from payout requests and manual adjustments. The 229-char reason cap (`MAX_REASON_LENGTH`) exists so the composed description always fits the `teacher_transaction.description` column (`varchar(255)` minus the 19-char marker headroom). The audit details never record the reason text.

### 2.2 The guarded-transition arbiters (single-writer discipline)

Two state flips carry the whole exactly-once guarantee. Both are ONE guarded `UPDATE … WHERE <pre-state> RETURNING *` with the pre-condition **fused into the predicate** — no probe read, no read-then-write window:

| Arbiter | Predicate | Write | Miss signal |
|---|---|---|---|
| `TeacherRepository.decertifyOnce(id, tx)` | `WHERE teacher.id = ? AND teacher.is_approved = true` | `SET is_approved = false, updated_at = now()` | `null` → `ConflictError("TEACHER_NOT_CERTIFIED")` |
| `ApplicantRepository.reopenForReEvaluation(userId, tx)` | `WHERE applicants.id = ? AND applicants.status = 'passed'` | `SET status = 'in_evaluation', re_evaluation_started_at = now(), updated_at = now()` | `null` → `ConflictError("APPLICANT_NOT_AWAITING_RE_EVALUATION")` |

Rules that make the pattern hold:

- **Single writer per flip direction.** `decertifyOnce` does NOT mint a second `is_approved = true → false` statement — it delegates to `demoteToUncertified`, the one guarded demotion write in the repository (also shared by the admin-override rejection flow). Exactly one `is_approved: false` write target exists there, pinned by test. Likewise `reopenForReEvaluation` is the ONLY writer of the `passed → in_evaluation` edge.
- **Transaction-bound writes.** Both arbiters take a REQUIRED `tx` — the flip commits with the caller's order transaction or not at all; no standalone global-handle branch exists.
- **Row locks arbitrate replays.** Two concurrent orders on the same teacher serialize on the row locks; the loser finds the pre-states already consumed, matches zero rows, throws its typed conflict, and its ALREADY-EXECUTED debit rolls back with its transaction. Net: exactly one charge, exactly one audit row, one winner. Proven on real Postgres in the service suite (`backend/services/teachers/teacher-re-evaluation.service.test.ts`), the wire suite (`backend/graphql/test/admin-re-evaluation.wire.test.ts`), and the cross-actor journey (`test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts`).

### 2.3 The wire surface and the admin affordance

- **Mutation:** `adminOrderTeacherReEvaluation(teacherId: ID!, reason: String!): TeacherReEvaluationOrder!` (`backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts`). Admin-scoped by the inline `$all { authenticated, role: [UserRole.Admin] }` conjunction (anonymous → `UNAUTHORIZED`, non-admin → `FORBIDDEN`, both pre-resolver); the resolver sources the actor id EXCLUSIVELY from `ctx.user.id`, coerces the wire `ID` through decimal-only string coercion + `requirePositiveIntId`, and copies the two args field-by-field into the closed service payload (no spread, no caller-supplied actor, no fee argument exists at all).
- **Receipt:** the id-less five-field object `TeacherReEvaluationOrder` (`backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts`) — `teacherId: ID!`, `amountCharged: String!`, `currency: String!`, `walletBalance: String!` (money as verbatim decimal strings), `reEvaluationStartedAt: String!` (ISO-8601). Registered in the Apollo cache with `keyFields: false` (`frontend/providers/apollo/apolloCache.ts`) — `teacherId` is the subject anchor.
- **Frontend affordance:** the shared document `adminOrderTeacherReEvaluationMutationDocument` (`frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts`), the `useOrderTeacherReEvaluation` hook (`frontend/views/admin/users/hooks/useOrderTeacherReEvaluation.ts` — refetches `AdminUserDetail` + `AdminTeacherWallet`), and the `OrderReEvaluationDialog` (`frontend/views/admin/users/dialogs/OrderReEvaluationDialog.tsx`) whose helper `orderReEvaluationErrorCopy` maps `extensions.code` → localized copy (`frontend/views/admin/users/dialogs/order-re-evaluation-dialog.helpers.ts`). The action is rendered only for certified teacher-role users (`frontend/views/admin/users/detail/reEvaluationActionGate.helpers.ts`) — an affordance gate only; the server re-asserts admin scope and certification on every mutation.

## 3. Fee discipline

- **The price is server-owned.** `RE_EVALUATION_FEE = "100.00"` and `RE_EVALUATION_FEE_CURRENCY = "EGP"` live in `shared/constants/re-evaluation.constants.ts` — a product-owned pricing input, NOT a request parameter. There is no wire fee argument, so mass-assignment of price is structurally impossible. The value is provisional until the product owner confirms final re-evaluation pricing; re-pricing is a product confirmation plus a one-line edit to that constant, and every consumer follows automatically.
- **Decimal strings end-to-end.** The amount is carried verbatim as a decimal string through every hop — constant → debit writer → ledger row → audit details → receipt → UI — never parsed into a number, never re-rounded. The static-assertion suite (`backend/types/teachers/teacher-re-evaluation.types.static-assertions.test.ts`) is a compile-time gate: the receipt's money fields fail to compile if any regresses off `string`.
- **`total_earning` is untouched.** A deduction spends the balance; it does not rewrite lifetime earnings. Exactly ONE `withdrawal`/`completed` ledger row is written (session_id NULL, the composed description), and the wallet read-back oracle asserts `total_earning` is byte-identical after an order.
- **Insufficient balance = 409, zero committed rows.** The shared debit writer's funds guard (`balance >= amount` in the predicate) misses → zero rows; the service maps the miss to `ConflictError("WALLET_INSUFFICIENT_FUNDS")` with the localized `insufficientBalance` copy. Because every stage shares ONE transaction, EVERY denial — gate, eligibility, funds, lost arbitration — rolls back the whole flow: no ledger row, no balance change, no de-certification, no status change, no audit row. The zero-committed-rows oracle is asserted per denial arm in the service suite.
- **Log hygiene.** Every denial emits exactly ONE bounded `logger.logDomainError` entry (code + entity + entity id only — never the amount, never the reason text, never another user's identity; an unvalidated malformed id logs the sentinel `0`). Happy paths log nothing.

## 4. Loop re-entry (the cycle anchor and the reused loop)

- **The anchor.** `applicants.re_evaluation_started_at` (nullable timestamp, `backend/db/schema/teachers/applicants.ts`) is stamped by `reopenForReEvaluation` inside the order transaction. `NULL` means "never been ordered a paid re-evaluation"; after an order it is the fresh cycle start.
- **Cycle resolution honors it — anchor-first for paid re-evaluation loops.** `resolveCurrentEvaluationCycle` (`backend/db/repo/classes/session.repository.evaluation.helpers.ts`) probes the re-evaluation arm FIRST — `WHERE applicants.id = ? AND status = 'in_evaluation' AND re_evaluation_started_at IS NOT NULL` → `{cycleStart: <anchor>, activeSubscriptionId: null}` — regardless of any still-active verification subscription. Only when the applicant carries no anchor (a fresh, never-paid loop) does the active verification-plan subscription arm resolve the cycle, exactly as before. Every other shape (not in the loop, absent row) falls through to the closed-cycle default. A normal (non-paid) loop entry clears any stale anchor via `transitionToInEvaluation`, so the anchor can only ever steer the loop that paid for it.
- **The loop is reused unchanged.** The re-opened applicant books ordinary `teacher_evaluation` sessions through the existing evaluation-loop flow (`docs/teachers/evaluation-loop-booking.md`) — same five-credit ceiling, same distinct-evaluators rule, same half-open `created_at >= cycleStart` window counted by `countEvaluationBookingsInCycle`. This flow writes NO new session type and NO loop predicate of its own.
- **The verdict closes the loop.** The existing aggregation/rubric finalization (`docs/teachers/evaluation-rubric-scoring.md`) decides: a PASS re-certifies (`ApplicantRepository.finalizeOnCertification` restores `status = 'passed'` and clears any cooldown; the certification write re-arms booking eligibility) and the anchor becomes history; a FAIL stamps the cooldown window via `transitionToFailed` (`docs/teachers/applicant-cooldown.md`) and the teacher STAYS de-certified for it. Both branches are proven end-to-end — including a real FAIL aggregation after a second real charge — by the cross-actor journey `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts`.

## 5. Rules

1. **Ride the arbiters.** Any future writer that flips `is_approved` true → false must go through `demoteToUncertified`/`decertifyOnce`; any future writer of the `passed → in_evaluation` edge must go through `reopenForReEvaluation`. Never mint a second guarded statement for a flip direction that already has one.
2. **Keep the stage order.** The debit precedes the state flips; the audit row and receipt ride the same transaction. The order is what makes "loser's debit rolls back" true — do not split the pipeline across transactions.
3. **Money changes to this flow happen in the constant, as strings.** No numeric parsing of the fee anywhere on the path; no new money vocabulary (no second debit primitive, no new ledger description marker).
4. **Every denial is pre-commit** — zero committed rows of any kind — and logs exactly one bounded entry. New denial arms must extend the zero-committed-rows oracle and the bounded-log pins.
5. **The audit row stays in-transaction** with `AuditActionType.Override` on the `teacher` entity and the field-name details JSON; the reason text belongs to the ledger row only.
6. **Surface growth re-anchors the pins.** The mutation is registered in the audit-census `wired` catalog (`test/workflows/admin/audit-completeness.catalog.ts`) and the frozen SDL pins (`backend/graphql/test/schema-surface.test.ts`, `backend/graphql/test/sdl-static-assertions.test.ts`); schema drift re-anchors those suites as a documented one-time reconciliation, and a new census row requires a matching journey leg.
7. **The client mirrors, never owns, validation.** The dialog's reason gate and the length cap's server ownership stay as shipped: the client blocks empty reasons early; the server re-validates and owns the bound.
8. **The UI gate is an affordance, not authz.** Visibility helper changes never substitute for the server's scope and eligibility re-assertions.

## 6. Anti-patterns (what NOT to do)

- **Probe-then-write.** Reading a status and then issuing an unguarded UPDATE re-opens the TOCTOU race the fused predicates exist to kill. The pre-state IS the `WHERE` predicate.
- **A second flip statement.** Duplicating the demotion or the re-open write (e.g., "a re-evaluation-specific de-certify") breaks exactly-once arbitration and the single-writer pins.
- **Parsing the fee into a number** or accepting an amount from the wire. Float drift on money and mass-assigned pricing are both structurally excluded today; keep them that way.
- **Touching `total_earning`** or routing the charge through the earning-side credit path. A deduction is a wallet spend with its own ledger vocabulary.
- **Committing partial state.** Debiting without de-certifying, or re-opening without the anchor, is unreachable only because the stages share one transaction — do not extract a stage into its own commit.
- **Stamping the anchor anywhere else** (a second UPDATE, a client-supplied instant) or letting a fresh, un-anchored loop resolve through anything but its own subscription. The anchor-first precedence is load-bearing: an anchored in_evaluation applicant must always resolve the paid cycle, and an un-anchored one must never read a leftover anchor (cleared on normal re-entry).
- **Re-timing the debit.** The fee funds the order, not the outcome: it is charged once at order time, is not refunded by a later FAIL verdict, and a second order charges again. Charging "only on failure" or "at verdict time" re-introduces the exact double-charge ambiguity the arbitration removed.
- **Logging the amount, the reason text, or a raw unvalidated id** in denial logs; echoing client input into log fields.
- **Trusting the UI gate as the boundary.** Hiding the button for non-certified teachers is UX; `TEACHER_NOT_CERTIFIED` can still surface via races and is mapped, not masked.

## 7. Rollout Summary

Nothing to deploy: the flow and every rule above are already shipped on the trunk, and the executable evidence is the standing suite tiers (all green at verification time):

| Tier | Suites |
|---|---|
| Repository (rollback tx, real Postgres) | `backend/db/test/repo/teachers/applicant.repository.re-evaluation.test.ts` (16), `backend/db/test/repo/teachers/teacher.repository.test.ts` (45, incl. the `decertifyOnce` describe), `backend/db/test/repo/teachers/evaluation.repository.test.ts` (51, incl. the cycle arms) |
| Service (rollback tx) | `backend/services/teachers/teacher-re-evaluation.service.test.ts` (26 — happy path, every denial arm, funds posture, real-Postgres order race) |
| GraphQL surface | `backend/graphql/test/schema-surface.test.ts` (99), `backend/graphql/test/sdl-static-assertions.test.ts` (58), `backend/graphql/test/admin-re-evaluation.wire.test.ts` (15 — scope wall, localized denials, exactly-once over the wire), `backend/db/test/logic/audit/audit-census-drift.test.ts` (19) |
| Journey (committed fixtures) | `test/workflows/teachers/admin-ordered-re-evaluation.journey.test.ts` (11 — order → loop → PASS re-certify and FAIL cooldown, both real) |
| Frontend | `frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.test.ts` (7), `frontend/views/admin/users/hooks/useOrderTeacherReEvaluation.test.ts` (9), `frontend/views/admin/users/dialogs/order-re-evaluation-dialog.helpers.test.ts` (12), `frontend/views/admin/users/detail/reEvaluationActionGate.helpers.test.ts` (10), `shared/locale/adminUsers-namespace.parity.test.ts` (81) |

**Where it lives:**

| File | Purpose |
|---|---|
| `shared/constants/re-evaluation.constants.ts` | `RE_EVALUATION_FEE` / `RE_EVALUATION_FEE_CURRENCY` — the server-owned, verbatim-string price |
| `backend/types/teachers/teacher-re-evaluation.types.ts` | `TeacherReEvaluationOrderReturnType` — the canonical order receipt |
| `backend/db/schema/teachers/applicants.ts` | `re_evaluation_started_at` — the cycle anchor (NULL = never ordered) |
| `backend/db/repo/teachers/teacher.repository.ts` | `decertifyOnce` → `demoteToUncertified` — the one guarded de-certification flip |
| `backend/db/repo/teachers/applicant.repository.ts` | `reopenForReEvaluation` — the one guarded `passed → in_evaluation` writer |
| `backend/db/repo/classes/session.repository.evaluation.helpers.ts` | `resolveCurrentEvaluationCycle` — the re-evaluation cycle arm (anchor first, subscription second) |
| `backend/services/teachers/teacher-re-evaluation.service.ts` (+ `.helpers.ts`) | `TeacherReEvaluationService.orderReEvaluation` — the one-transaction pipeline |
| `backend/graphql/mutation/admin/admin-re-evaluation.mutation.ts` | The `adminOrderTeacherReEvaluation` mutation field (admin scope, ID guard, session-sourced actor) |
| `backend/graphql/pothos/admin/admin-re-evaluation.pothos.ts` | The id-less `TeacherReEvaluationOrder` receipt object |
| `frontend/graphql/sharedDocuments/admin/admin-re-evaluation.documents.ts` | The shared mutation document (five receipt fields, no `id`) |
| `frontend/views/admin/users/hooks/useOrderTeacherReEvaluation.ts` | The mutation hook + refetch targets (`AdminUserDetail`, `AdminTeacherWallet`) |
| `frontend/views/admin/users/dialogs/OrderReEvaluationDialog.tsx` (+ helpers) | The confirm dialog (mandatory reason, `extensions.code` → copy map) |
| `frontend/views/admin/users/detail/reEvaluationActionGate.helpers.ts` | The certified-teacher visibility gate (affordance only) |
| `test/workflows/admin/audit-completeness.catalog.ts` | The `wired` census row (Override / teacher) backing the audit-completeness journey |

## 8. Related Documents

- `docs/teachers/applicant-lifecycle.md` — the `applicants` state machine, including the `passed → in_evaluation` re-open edge this flow owns
- `docs/teachers/evaluation-loop-booking.md` — the five-session loop the re-opened applicant re-enters, unchanged
- `docs/teachers/evaluation-rubric-scoring.md` — the verdict finalization that re-certifies or stamps the cooldown
- `docs/teachers/applicant-cooldown.md` — the cooldown state machine a FAIL verdict arms
- `docs/teachers/verification-plan-purchase.md` — the purchased cycle this flow's anchor alternates with in cycle resolution
- `docs/billing/escrow-and-wallet-crediting.md` — the wallet/debit substrate and the guarded-writer family this fee rides (§8 boundary hand-off, delivered)
- `docs/billing/admin-financial-auditing.md` — the adjustment/ledger vocabulary (debit vs. earning-side) behind the `total_earning` discipline
- `docs/graphql/domain-error-extensions-code.md` — the `extensions.code` contract behind the denial matrix
- `docs/admin/user-management.md` — the admin user-detail surface hosting the order affordance
- `docs/workflows/01-teacher-verification-workflow.md` — the verification workflow whose loop this governance write re-enters
