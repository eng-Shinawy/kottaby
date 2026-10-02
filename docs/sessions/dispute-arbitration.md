# Session Dispute Arbitration — Canonical Reference

**Domain:** Sessions (dispute arbitration over the P2P `session` entity — both escrow generations)
**Status:** Implemented and verified
**Source of truth for:** the two-generation dispute model and its `fee_held` discriminator, the classification rule and the resolver pre-gate, the exactly-once dispute state-machine legs, the quantized student refund ruling, the compensating withdrawal-row pattern, the dispute notification waves and their claim keys, the arbitration audit convention, the admin case-review read surface, and the boundary this surface shares with the admin session-governance, financial-auditing, and student-evaluation surfaces.

This document is the single canonical reference for session dispute arbitration. All layers (types, repo, service, GraphQL, frontend, tests) MUST conform to the contracts described here. Downstream tickets that open, classify, or resolve a disputed row MUST read it together with `docs/sessions/session-lifecycle.md` (the participant lifecycle, the guarded-transition pattern, and the held generation's pre-completion dispute posture) and `docs/admin/admin-session-governance.md` §9 (the arbitration boundary). A disputed row has exactly ONE writer — the arbitration write path documented here; consumers extend it, never re-implement it. The authoritative implementations are `SessionArbitrationService` (+ its flow helpers), the guarded `SessionRepository`/`WalletRepository` primitives it composes, and `SessionDisputeNotificationService` — cited by name throughout.

---

## 1. Why

A dispute is money in motion with two parties disagreeing. Before dual confirmation the disagreement is over escrow that still exists: the hold is frozen and arbitration releases or consumes it. After dual confirmation the escrow is gone — the fee is consumed, the teacher's wallet is credited, and the student has confirmed the session — yet a student who confirmed too early still needs a credible recourse. That recourse is a **binding** admin arbitration whose every decision atomically reverses (or declines to reverse) internal ledger value, notifies both sides, and lands one audit row.

The failure modes that shaped every ruling here: a double resolution moving money twice; a held-family outcome applied to consumed escrow (or the reverse) — refunding value that no longer exists, or completing a row whose money already moved; a wallet debit stranding its ledger row (or vice versa); and a dispute note's free text leaking into the immutable audit trail. Each was either proven or ruled out during the surface's review waves; nothing in this document is aspirational.

## 2. The Two-Generation Dispute Model

| Generation | Escrow at dispute time | Who may open | Opened from | Legal outcomes | Canonical semantics |
|---|---|---|---|---|---|
| **Held** | `fee_held = true` (hold not yet consumed) | either participant | `scheduled` \| `started` | `Cancel` \| `Complete` | `docs/sessions/session-lifecycle.md` §2 — byte-stable |
| **Consumed** | `fee_held = false` (hold consumed; wallet credited) | the session's student only | `completed` (dual-confirmed) | `Refund` \| `PartialRefund` \| `Uphold` | this document |

- The discriminator is the persisted `fee_held` column **on the disputed row** — not the caller, the route, or the open surface. The admin disputes queue lists BOTH generations under one predicate (no schema distinction); every row carries the classification-relevant facts: fee, escrow class, disputed-at stamp, and the dispute reason.
- **Held generation.** Opening freezes the hold; arbitration resolves the row to `cancelled` (same-lane hold refund) or `completed` (hold consumed). It is notification-silent by canonical ruling and its semantics are owned by the session lifecycle — this document changes none of them.
- **Consumed generation.** Opening touches NO escrow and NO wallet: the row moves to `disputed` with its reason and stamp, and the financial reversal (if any) happens only at arbitration.

```mermaid
stateDiagram-v2
    scheduled --> disputed: openSessionDispute (either participant; held escrow)
    started --> disputed: openSessionDispute (either participant; held escrow)
    disputed --> cancelled: Cancel (held escrow; same-lane hold refund)
    disputed --> completed: Complete (held escrow; hold consumed)
    completed --> disputed: openPostConfirmationDispute (student only; consumed escrow)
    disputed --> completed: arbitration Refund / PartialRefund / Uphold (consumed escrow; financial reversal)
```

(The full lifecycle machine — creation, start, completion, sweeps — remains `docs/sessions/session-lifecycle.md` §2.1; the diagram above is the dispute-focused view.)

## 3. Classification Rule & the Resolver Pre-Gate

- **One entry.** `resolveSessionDispute` (admin-gated: `adminOnlyAuthScopes` scope conjunction + the governance-clean admin re-assertion in service) stays the single arbitration mutation. Its input gained the optional `partialAmount` decimal string; its args are otherwise unchanged.
- **Dispatch by family.** The resolver dispatches on the submitted outcome: `Cancel | Complete` → the session-lifecycle service (held generation); `Refund | PartialRefund | Uphold` → `SessionArbitrationService.arbitrateDispute` (consumed generation).
- **The pre-gate.** `SessionArbitrationService.assertResolutionFamilyMatchesEscrow` runs BEFORE the dispatch and BEFORE any write: a probe read of the disputed row, the submitted outcome checked against the row's escrow class, and a cross-family submission rejected with the localized `disputeResolutionMismatch` validation denial — zero writes (no status change, no money, no audit row, no wave). Rows that are not disputed at all pass through the gate untouched; their denials stay owned by the generation services.
- **The gate is load-bearing.** Without it, a held-family value submitted against a consumed row would route into the held-escrow service, whose state machine accepts a disputed consumed row — a double-resolution window (a `Cancel` would refund an already-consumed hold's lane a second time).
- **Race posture.** The gate is advisory in the race sense and authoritative for the vocabulary error: both generation services RE-CLASSIFY inside their own transactions, and every write predicate re-asserts `status` + `fee_held` — a classification that drifted after the gate cannot pass a write.
- **Client discipline.** The classification vocabulary has a single frontend source — `resolveDisputeOutcomeOptions(feeHeld, translation)` derives the legal outcome list per row. Never hardcode an outcome list on a new surface; never coerce an off-class selection (a stale one renders the mismatch alert).

## 4. The Exactly-Once State-Machine Legs

### 4.1 `completed → disputed` — student open (consumed escrow)

`SessionArbitrationService.openPostConfirmationDispute` → `SessionRepository.openPostConfirmationDisputeOnce`:

- ONE guarded single-statement UPDATE fusing `id ∧ student_id = caller ∧ status = 'completed' ∧ confirmed_by_student_at IS NOT NULL ∧ fee_held = false`; SET `status = 'disputed'`, `dispute_reason`, `disputed_at`, `updated_at`. Escrow columns and completion stamps are deliberately untouched.
- Denials: a non-participant — including the row's own teacher — is oracle-collapsed behind `SESSION_NOT_FOUND`; a wrong shape (held, unstamped, or not `completed`) is the state conflict `SESSION_INVALID_TRANSITION`; **an already-arbitrated row (`resolved_at` stamped — both resolution families stamp it) is the same state conflict: arbitration is TERMINAL, so a decided case can never re-enter the disputed state and a second arbitration can never move money for the same fee again** (the probe classifier denies pre-DB and the guarded statement carries the matching `resolved_at IS NULL` leg, so the denial holds under races); an empty/whitespace/oversized reason is `VALIDATION` (required-reason normalization, ≤ 500 chars, applied pre-DB).
- Zero audit rows — opening a dispute is a participant action, mirroring the held generation.
- Exactly-once: a concurrent duplicate submit is the state-conflict loser; the recorded reason is never rewritten.

### 4.2 `disputed → completed` — the arbitration completion leg (consumed escrow)

`SessionRepository.resolveConsumedDisputeOnce`:

- ONE guarded UPDATE fusing `id ∧ status = 'disputed' ∧ fee_held = false`; SET `status = 'completed'`, `resolution_note` (optional, trimmed ≤ 500, whitespace → NULL), `resolved_at`, `updated_at`.
- The statement `.returning()`-projects the arbitration probe (`id, status, studentId, teacherId, fee, feeHeld, heldBalanceLane, confirmedByStudentAt`, plus `resolvedAt` — the terminality marker the student re-dispute classifier reads) — the financial legs consume it with no re-read. A zero-row match means the row was already resolved or is held-class: the state conflict, before any money moves.

### 4.3 Transaction composition & race posture

- Arbitration is ONE transaction with a FIXED composition order: guarded completion leg → wallet reversal (when money moves) → student lane credit (when a refund is awarded) → audit row → wave receipts → response re-read.
- The completion leg fires FIRST so a concurrent-arbitration loser never moves money: the loser's guarded predicate matches zero rows and classifies as `SESSION_INVALID_TRANSITION` with zero net effect on row, wallet, lane, ledger, audit, or wave.
- No `SELECT … FOR UPDATE` is needed anywhere on these legs: every transition is a single guarded statement, and the wallet debit is statement-atomic (its funds guard lives inside the UPDATE).
- A wallet shortfall surfaces as the typed `WALLET_INSUFFICIENT_FUNDS` conflict thrown on the flow's transaction — full rollback (the compensating ledger row rolls back with it), the session REMAINS `disputed`, and the admin may retry with a lower amount or choose Uphold.

## 5. The Quantized Student Refund Ruling

- Student balances are integer session-credit lanes (INV-B1) — a fractional credit is not representable (lane CHECKs). `session.fee` is the platform-set money amount (a decimal string) that priced the ONE credit the student spent.
- **Ruling:** `Refund` AND `PartialRefund` BOTH restore ONE full session credit to the recorded provenance lane — the only student-facing refund unit in the domain. The partial quantum moves ONLY on the teacher's money ledger.
- **Arbitration economics.** For a partial award the platform absorbs the remainder (`fee − partialAmount` worth of the restored credit). This is an accepted consequence of the integer-lane domain, recorded PER ROW in the audit details for financial review; platform-level reconciliation belongs to the Admin Financial Auditing ticket (§10).
- **Provenance discipline.** The lane credited is always the lane recorded at booking — `held_balance_lane` is never rewritten or nulled by this surface. A NULL lane (the never-held defensive case) makes the student credit leg a no-op while the teacher debit still applies.

## 6. The Compensating Withdrawal-Row Pattern

- The teacher-side reversal is a **compensating row, never an UPDATE of an old row**: `teacher_transaction` is an append-only ledger (INV-W6) whose amounts are non-negative (INV-W8), and the transaction-type vocabulary has no `reversal` member (it is governance-pinned; no migration is warranted).
- ONE primitive owns the reversal — `WalletRepository.debitForArbitrationOnce`: INSERT the compensating row `{type: 'withdrawal', status: 'completed', sessionId, amount, description}` THEN the guarded `UPDATE wallet SET balance = balance - amount WHERE id ∧ balance >= amount`, one statement sequence on the caller's transaction. A `null` return (insufficient funds) means the caller throws: the compensating row rolls back with the transaction — either both effects commit or neither (savepoint-proven).
- `wallet.total_earning` is NEVER decremented: it is a gross lifetime counter (INV-W2 ≥ 0); the spendable truth is `balance`.
- **Money hygiene.** Amounts are decimal STRINGS bound verbatim — never re-parsed, never re-rounded in code; the two-fraction storage belongs to the `decimal(10,2)` columns. The partial amount is validated BEFORE any write (strict two-decimal shape, strictly `0 < amount < fee`) and the exact supplied string is what the ledger row and the audit row record. An amount supplied with any non-partial outcome is rejected with `partialRefundAmountInvalid` — money input is never silently ignored.
- **Precedent.** Forced wallet debits already ride the `withdrawal` type (the admin-ordered re-evaluation deduction); this surface reuses that precedent and the shared funds-guard implementation rather than minting a parallel money path.

## 7. Notification Waves (consumed generation only)

| Wave | Recipients | Trigger |
|---|---|---|
| `session_dispute_opened` | every admin user | committed post-confirmation open |
| `session_dispute_resolved` | the session's student + teacher | committed arbitration (the outcome rides the stored copy) |

- **Claim keys** `session:<id>:dispute-opened` / `session:<id>:dispute-resolved` — session id + wave kind ONLY, deterministic across retries; these kinds occur at most once per dispute, so no occurrence stamp is folded in.
- **In-tx receipts, publish-after-commit.** `SessionDisputeNotificationService` persists UNPUBLISHED delivery receipts INSIDE the owning flow's transaction — they survive the commit and vanish on any rollback (the insufficient-funds leg leaves zero wave rows) — and the module NEVER publishes. Publish-after-commit is owned by the transaction owner: the flow publishes after its own commit when it opened the transaction; on a caller-owned transaction the caller publishes. Push failures degrade at the engine boundary (fail-open) and never fail a committed domain write — the `docs/notifications/realtime-engine.md` contract is consumed unchanged (`emitForUsers` + `publishReceipts`; no direct `notifications` writes).
- **Recipient scoping is server-side.** The admin cohort resolves through the broadcast-audience role arm (blocked/deleted admins excluded); the participant pair arrives from the arbitration flow's OWN guarded write. No recipient id is ever caller-supplied. Copy is composed per recipient locale (platform default fallback) and names the outcome only — no participant names, no reason content (the disputes console renders the case).
- **Zero waves for the held generation** — the pre-completion dispute stays notification-silent (canonical ruling in `docs/sessions/session-lifecycle.md`); held-family denials never reach the wave seam.

## 8. Audit Convention

- Exactly ONE `audit_logs` row per committed arbitration — written in the SAME transaction through the composition-only audit writer. Denial paths append ZERO rows; the audit insert failing rolls the whole arbitration back.
- Row shape: `action_type = 'override'` (the seven-member audit vocabulary is pinned — no new enum value), `entity_type = 'session'`, `entity_id = sessionId`, `actor_id` = the verified admin's id from server-resolved context.
- Details: `{resolution, refundAmount | partialAmount | null, notePresent}` — the exact decimal string supplied for a monetary award, the amount key ABSENT (not nulled) on Uphold, and NEVER the free-text note's content. The trimmed note persists on the session row; the audit row records only that a note existed.

## 9. Admin Case-Review Read Surface

- `adminDisputeCase` — admin-gated (scope gate + the service's governance re-assertion) — returns ONE bundle: the full session detail (including dispute reason, disputed-at stamp, fee, and escrow class), the session report (including the teacher's student rating), the homework row, the recitation record, and the session-scoped audit trail.
- **Honest nulls.** Absent artifacts (no report submitted, no homework, no recitation, empty trail) return null/empty — never fabricated placeholders.
- One round trip; the independent artifact reads run concurrently (no N+1). An unknown id resolves to the localized not-found denial — this is an admin surface (role-gated, never participant-gated), so there is no foreign-caller arm to collapse; the sessions-are-sensitive oracle ruling applies to participant surfaces, not this one.
- The case read writes nothing — reading the trail never audits.

## 10. Boundary With Sibling Surfaces

- **Admin Session Governance** (`docs/admin/admin-session-governance.md` §9) owns browse / reschedule / cancel / teacher reassignment / live join. A disputed row is eligible for NOTHING there; the arbitration surface is the ONLY writer allowed to exit a disputed row — a ruling that now covers BOTH generations on the single write path. Both surfaces enforce the same governance-clean admin gate and the same byte-identical denial split.
- **Admin Financial Auditing** owns payment-gateway money refunds/chargebacks and platform-level reconciliation. This surface reverses INTERNAL ledger value only (one session credit + wallet balance); no gateway money moves, ever.
- **Student Evaluation** owns student-rates-teacher evaluation content. The case review exposes the artifacts that exist today (the report's `studentRatingByTeacher`) and is the forward integration point — an evaluation row joins the bundle without schema churn.
- **Pre-completion dispute semantics** are owned by `docs/sessions/session-lifecycle.md` (held generation) and remain byte-stable; this document amends none of them.

## 11. Testing Map (maintainer's guide)

| Layer | Suite | What it pins |
|---|---|---|
| Cross-actor journey | `test/workflows/sessions/post-confirmation-dispute.journey.test.ts` | The acceptance harness on real services + real Postgres: the three outcomes end-to-end (full refund / partial at `"15.00"` of `"25.00"` / uphold with zero financial writes), the denial matrix (roles, oracle collapse, classification mismatch, emptied wallet), and the real double-arbitration race. Waves are asserted as persisted inbox rows AND at the spied publish boundary. Committed fixtures + tracked teardown — no rollback wrappers at journey level. |
| GraphQL wire | `backend/graphql/test/session-arbitration.wire.test.ts` | Live-server matrix incl. the adversarial probes: denial byte-identity against the shipped admin reference, oracle collapse (teacher / foreign student / nonexistent id), classification mismatch in BOTH directions, partial-amount fuzz (zero / fee-equal / over-precision / NaN text / negative / stray amount beside a non-partial outcome), and zero-partial-write probes. |
| Repo | `backend/db/test/repo/classes/session.repository.test.ts` (arbitration sections) + `backend/db/test/repo/billing/wallet.repository.test.ts` | 100% branch on the guarded primitives: per-clause miss branches, dual-confirmation and escrow-class boundaries, same-connection serialization races, savepoint-proven reversal atomicity, and money boundaries (exact balance, one cent short, maximal decimal, over-precision stored verbatim). |
| Service | `backend/services/classes/session-arbitration.service.test.ts` + `backend/services/classes/session-dispute-notification.service.test.ts` | Probe chains, outcome legs, the amount policy, the audit contract (note-content exclusion), the insufficient-funds rollback, the committed double-arbitration race; wave recipient scoping, claim-key determinism, in-tx receipts + publish ownership. |
| Surface pins | `backend/graphql/test/schema-surface.test.ts` + `backend/graphql/test/sdl-static-assertions.test.ts` | SDL arg shapes + scope snapshots, codegen byte-identity, frozen mutation/query inventories. |
| Locale | `shared/locale/sessions-namespace.parity.test.ts` + `shared/locale/errors-namespace.parity.test.ts` | The arbitration key inventory (en/ar parity + typed labels), including the two denial keys `disputeResolutionMismatch` / `partialRefundAmountInvalid`. |

Race-harness conventions inherited from the lifecycle suites: same-connection `Promise.allSettled` serialization proves guarded-predicate semantics; cross-connection contention proofs need COMMITTED fixtures with tracked, zero-residue teardown.

## 12. Related Documents

- `docs/sessions/session-lifecycle.md` — the participant state machine, the guarded-transition pattern, the hold-as-debit ruling and provenance lane, and the held generation's byte-stable dispute semantics.
- `docs/admin/admin-session-governance.md` §9 — the arbitration boundary: single write path, disputed rows unreachable from the governance surface.
- `docs/notifications/realtime-engine.md` — the emit contract and publish-after-commit composition the dispute waves consume unchanged.
- `docs/admin/audit-trail.md` — the audit-trail read surface over the `override` rows this surface writes.
- `docs/specs/state-machine-invariants.md` — INV-B1 (integer session-credit lanes), INV-W1/W2/W6/W8 (wallet non-negativity, gross lifetime counter, immutable ledger, non-negative amounts), INV-S1/S2 (the structural state guards these legs compose onto).
- `docs/specs/open-decisions-and-gaps.md` — B.18 (the post-confirmation recourse) and A.5 (audit logging of administrative action).
- `docs/graphql/error-handling-contract.md` + `docs/graphql/domain-error-extensions-code.md` — the DomainError taxonomy every denial here rides.
