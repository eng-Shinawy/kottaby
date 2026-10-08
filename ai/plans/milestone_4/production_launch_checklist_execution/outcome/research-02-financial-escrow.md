# Research: PRODUCTION_READINESS Section 2 — Financial & Escrow Safeguards (rows 2.1.1–2.5.5)
Date: 2026-10-08

## Area

The escrow substrate is fully shipped and heavily tested, but the checklist's planning vocabulary
diverges from the real implementation in two load-bearing places. (1) The student-side "escrow hold"
is a **credit-lane debit at request time** (`StudentRepository.decrementLaneIfAvailable`, guarded
`UPDATE … WHERE balance_lane > 0`) plus a `fee_held = true` marker and a permanent
`held_balance_lane` provenance column — the lane IS decremented at request and restored (+1) on
release. So rows 2.2.2/2.2.3 ("balance held, not decremented, at request; decremented only upon dual
confirmation") are **false as literally written** and must be re-mapped to the real guarantee
(guarded debit at request → same-lane refund on cancel/timeout → hold consumed + teacher wallet
credited on dual confirmation). (2) Withdrawals debit the wallet **at request** (pending ledger row +
guarded debit); admin approve/reject only settles the pending row, and reject additionally
**restores** the reserved debit — rows 2.5.2/2.5.3 describe a mechanism the codebase does not use,
though end-states are equivalent. The 24h dual-confirmation timeout, auto-cancel sweeper (repo legs +
cron route), disputes (5 arbitration outcomes), CHECK constraints, and ledger immutability (triggers +
settlement carve-out) are real, named, and covered by service + journey + adversarial suites,
including the `financial-safety-verification` finished plan's shipped journey. The stale
`scripts/escrow-e2e/` UI harness hardcodes a foreign machine path (`/home/z/my-project`) and is not
runnable in this repo.

## Checklist → Codebase Mapping

| Row | Criterion (short) | Actual artifact (path:line) | STATUS |
|---|---|---|---|
| 2.1.1 | Dual confirmation required to finalize | `session-lifecycle.confirmation.ts:123-150` — guarded confirm; wallet credit composed only on match (`:140`) | VERIFIED |
| 2.1.2 | 24h timeout auto-cancels unconfirmed | `session-lifecycle.service.ts:804` `sweepExpiredSessions`; legs `session.repository.ts:583` (scheduled), `:613` (completed, student stamp NULL, teacher stamp < now−24h); cron `app/api/cron/sweep-sessions/route.ts:30` | VERIFIED |
| 2.1.3 | Auto-cancelled sessions release held funds | Sweep flips `feeHeld=false` + `refundSweptHolds` → `transitions.ts:222-241` `refundHeldLaneToProvenance` (same-lane +1, fail-closed) | VERIFIED |
| 2.1.4 | `confirmation_deadline = now + 24h` at creation | `session-lifecycle.booking.ts:185` + `SESSION_CONFIRMATION_WINDOW_MS = 86_400_000` (`shared/constants/session-fees.constants.ts:40`) | VERIFIED |
| 2.1.5 | Both confirmation timestamps recorded | `session.repository.ts:222` `completeSessionOnce` (teacher), `:543` `confirmStudentCompletionOnce` (student); cols `session.ts:72-73` | VERIFIED |
| 2.2.1 | Fee held at request (`fee_held=true`) | `session-lifecycle.booking.ts:183` `feeHeld: true` on insert | VERIFIED |
| 2.2.2 | Balance held, NOT decremented at request | **FALSE as written** — lane debited at request: `session-lifecycle.booking.ts:133-138` guarded decrement; "hold" = debit + `fee_held` + provenance lane | PARTIAL — re-map |
| 2.2.3 | Balance decremented only on dual confirmation | No second student debit exists; dual confirmation consumes hold (`fee_held=false`) + credits wallet (`confirmation.ts:58-69`) | PARTIAL — re-map |
| 2.2.4 | Teacher wallet credited only on dual confirmation | `confirmation.ts:129-140` credit after guarded match; arbitration COMPLETE consumes hold with NO credit (`service.test.ts:1900`) | VERIFIED |
| 2.2.5 | Cancelled sessions release hold, no wallet credit | `session.repository.ts:248` `cancelSessionOnce` + `transitions.ts:222` refund; admin cancel refunds too (`session-admin-governance.service.test.ts:995`) | VERIFIED |
| 2.2.6 | Fee is platform-set, not negotiated | `session-lifecycle.booking.ts:182` `sessionFeeForIntent`; `session-fees.constants.ts:26-30` (`"25.00"` EGP); no fee field in `SessionSubmitInput` | VERIFIED |
| 2.3.1 | Zero-balance request rejected | `session-lifecycle.booking.ts:151-156` `ValidationError("INSUFFICIENT_BALANCE")`, zero rows | VERIFIED |
| 2.3.2 | Concurrent requests — only one succeeds | `session-lifecycle.service.test.ts:2422` REQ-043(d) `testOnRealPostgres` (Promise.allSettled); FSV journey `:384` step A | VERIFIED |
| 2.3.3 | Student balance cannot go negative | `students.ts:42-45` 4× `students_balance_*_check` CHECKs; guarded decrement predicate | VERIFIED |
| 2.3.4 | Wallet balance cannot go negative | `wallet.ts:37` `wallet_balance_check`; `:38` `wallet_total_earning_check` | VERIFIED |
| 2.3.5 | Transaction amount cannot be negative | `teacher-transaction.ts:50` `teacher_transaction_amount_check` enforces `amount > 0` (STRICTER than `>= 0`) | VERIFIED (stronger) |
| 2.4.1 | Student can dispute completed session | `session-arbitration.service.ts:193` `openPostConfirmationDispute`; live-state `openSessionDispute` (`session.repository.ts:279`); `disputed` in `enums.ts:23` | VERIFIED |
| 2.4.2 | Admin arbitration: refund / partial / uphold | `session-arbitration.service.ts:313` `arbitrateDispute`; 5 outcomes: Refund/PartialRefund/Uphold + Cancel/Complete (`enums.ts:32-38`) | VERIFIED |
| 2.4.3 | Refund credits student, debits teacher wallet | `session-arbitration.service.ts:368-372`: `debitTeacherWalletForArbitration` (`arbitration_reversal` row, helpers `:259`) + `creditLaneForArbitration` (ONE session credit to lane, helpers `:231`) | VERIFIED |
| 2.4.4 | Dispute actions logged in audit_logs | `session-arbitration.service.ts:382` `AuditService.createAuditLog(...)` — same transaction, fails closed | VERIFIED |
| 2.5.1 | Withdrawals start `pending` | `wallet.repository.ts:145-178` `debitForWithdrawalOnce` — pending row + guarded debit at REQUEST | VERIFIED |
| 2.5.2 | Approval → completed + decrements wallet | **Mechanism differs**: debit at request; approve only settles pending→completed (`wallet.repository.admin.helpers.ts:329` guarded); no re-decrement | PARTIAL — re-map |
| 2.5.3 | Rejection → failed, NO decrement | Reject settles→failed AND restores request-time debit (`wallet.repository.admin.helpers.ts:352-365`, additive) | PARTIAL — re-map |
| 2.5.4 | Withdrawal cannot exceed wallet balance | `wallet.service.ts:301-305` `ConflictError("WALLET_INSUFFICIENT_FUNDS")`; guarded `WHERE balance >= amount` | VERIFIED |
| 2.5.5 | Withdrawal records immutable after completion | Carve-out `20260914064155_custom_5-teacher-transaction-settlement/migration.sql:60-74` (UPDATE only pending→completed/failed); DELETE blocked by `20260904084152_custom_3-immutability-triggers/migration.sql:80-101` | VERIFIED |

**Counts (25 rows): VERIFIED 21 · PARTIAL 4 (2.2.2, 2.2.3, 2.5.2, 2.5.3 — semantic re-maps, zero missing code) · MISSING 0 · DEFERRED 0**

## Existing Coverage

Service tier (`bun run test:services`):

- `backend/services/classes/session-lifecycle.service.test.ts` — booking lanes/holds (`:431-539`);
  zero-balance denial, zero rows (`:507`); cancel refunds SAME lane once (`:999`); **deadline boundary
  `confirmationDeadline = now + 86_400_000` EXACTLY** (`:1118-1141`); platform fee verbatim (`:1146`);
  double-cancel refunds once (`:1465`); dispute pair + held-family Cancel/Complete (`:1647-2013`);
  arbitration audit Override rows (`:2169-2238`); **REQ-043 chaos ×4** `testOnRealPostgres` (`:2326`
  double-start, `:2352` start⚡cancel, `:2394` double-complete, `:2422` concurrent double-book on one
  unit); dual confirmation happy/idempotent/teacher-no-op/denials (`:2504-2631`); deadline sweeper incl.
  NULL-lane + idempotent re-sweep (`:2799-2924`); two-leg sweeper composition, fail-closed (`:3157-3334`).
- `backend/services/classes/session-lifecycle.enforcement.test.ts:164-193` — 5×5 transition matrix
  sweep (terminals refuse all moves).
- `backend/services/classes/session-arbitration.service.test.ts` — dispute opens once (`:271`);
  Refund = `arbitration_reversal` + full-fee debit + lane credit + audit row (`:467`); PartialRefund
  exact decimal string (`:565`); Uphold zero financial writes (`:606`); family mismatch (`:670`);
  insufficient wallet fails closed (`:782`, `:829`).
- `backend/services/classes/session-admin-governance.service.test.ts:995` — admin cancel refunds
  recorded lane exactly once + audit row.
- `backend/services/billing/wallet.service.test.ts` — pending row + balance debited, `total_earning`
  untouched (`:169`); `WALLET_INSUFFICIENT_FUNDS` zero rows (`:208`); exact-balance OK (`:237`);
  amount validation matrix (`:251`).
- `backend/services/billing/admin-financial-auditing.service.test.ts` — approve settles completed +
  ONE audit row (`:324-336`); reject settles failed + restores debit + audit row (`:378`).

DB/repo tier (`bun run test:db`):

- `backend/db/test/repo/students/student.repository.test.ts:428-458` — CHECK-floor probes
  (`students_balance_hifz_check`, `students_balance_reviews_check` via `constraintNameOf`).
- `backend/db/test/repo/billing/wallet.repository.test.ts` — guarded debit + pending row (`:341`);
  exact boundary `"0.00"` (`:371`); insufficient → null + zero writes (`:393`); **no update/delete
  primitive for the ledger** (`:419-445`); CHECK probes `wallet_balance_check` /
  `wallet_total_earning_check` / `teacher_transaction_amount_check` incl. zero rejected (`:476-518`,
  `:722-744`); reversal slice + arbitration/withdrawal fund-guard races (`:608-822`).
- `backend/db/test/repo/billing/wallet.repository.admin.test.ts` — settle pending→completed (`:446`),
  →failed (`:467`), re-settle null (`:484`), earning refuses settlement (`:505`); restore additive
  (`:540-553`).

Journey tier (`test/workflows/`):

- `test/workflows/billing/financial-safety-verification.journey.test.ts` (shipped by finished plan
  `ai/finished_plans/milestone_4_integration_security_launch/financial-safety-verification/`) — step A
  double-spend race (`:384`), B escrow cancel release once (`:458`), C dual-confirm credit once
  (`:502`), D withdrawal drain race (`:565`), D2 amount fuzz (`:616`), E wallet-first-earning race
  (`:641`), F adversarial ledger-UPDATE trigger rejection (`:714`), G oracle-safe denials (`:754`).
- `test/workflows/sessions/session-dual-confirmation.journey.test.ts` — booking hold (`:363`), both
  stamps + wallet credited exactly the fee (`:458`), sweep refund + auto-cancel notice (`:568`),
  idempotent re-sweep (`:608`), **confirm-vs-sweep race → exactly one financial outcome** (`:627`).
- `test/workflows/sessions/post-confirmation-dispute.journey.test.ts` — Refund/PartialRefund/Uphold
  with wallet debit, lane restore, audit rows (`:631`, `:719`, `:803`).
- `test/workflows/billing/admin-financial-auditing.journey.test.ts` — approve drains queue (`:503`),
  reject restores balance + failed ledger (`:564`), concurrent double-settlement one winner (`:824`),
  settle+new-request race (`:867`), failed-row replay denied (`:935`).
- `app/api/cron/sweep-sessions/test/sweep-sessions-route.test.ts:114-178` — cron route mode/bearer
  gates fail closed (404/401).

## Gaps

1. **Rows 2.2.2/2.2.3 unverifiable as written (SEMANTIC MISMATCH — top priority).** The escrow is a
   request-time lane debit + `fee_held` marker + `held_balance_lane` provenance
   (`session-lifecycle.booking.ts:133-185`); release = same-lane +1 refund; dual confirmation consumes
   the hold and credits the teacher wallet — there is NO deferred "decrement at confirmation".
   Executing the checklist literally records a FAIL against a guarantee the platform never promised.
   Needed: rewrite the two rows to the real invariant (debit exactly once at request; refund exactly
   once on cancel/timeout; consume exactly once on dual confirmation). Evidence already exists — no
   new test needed.
2. **Rows 2.5.2/2.5.3 describe a debit-at-approval mechanism that does not exist.** Real flow: debit
   at request, approve = settle→completed only, reject = settle→failed + restore reserved debit
   (`wallet.repository.admin.helpers.ts:329`, `:352-365`). End-states match the intent; the
   "decrements wallet on approval" step is false. Needed: re-map wording; optionally one service test
   asserting the wallet delta is unchanged by approve (currently implicit — `:324` asserts the
   settled row, not the wallet delta).
3. **HTTP "422" claims (2.3.1, 2.5.4) have no GraphQL-tier status pin.** Denials are
   `ValidationError("INSUFFICIENT_BALANCE")` and `ConflictError("WALLET_INSUFFICIENT_FUNDS")`;
   the literal "rejected with 422" was never verified against the GraphQL error→HTTP mapping.
   Needed: one `frontend/graphql/test/` dev-server test pinning `extensions.code` for both denials
   (precedent: `session-booking-balance.test.ts`, cited ✅ for checklist 5.3.4), or re-map rows to
   the error-code vocabulary.
4. **`scripts/escrow-e2e/` is a stale foreign-machine artifact.** `leg1-booking.sh:4-7` hardcodes
   `/home/z/my-project` + `/home/z/pgroot/...`; `vlm-verify.sh` reads screenshots from
   `/home/z/my-project/download/escrow-e2e`. It cannot run here. Its coverage (booking hold →
   completion → wallet credit → cancel refund, UI + VLM screenshots) is superseded by
   `test/workflows/` journeys. Needed: re-home paths or mark superseded/excluded — do NOT cite as
   launch evidence.
5. **24h timeout is only ever simulated** (fixtures fabricate past deadlines; no wall-clock wait).
   The checklist allows "or simulate"; sweeper legs + cron route + route gates are tested. The launch
   plan should record "simulated" as the method rather than implying a real 24h soak.
6. **Finished-plan outcome matrix not preserved.** The finished plan dir contains only plan.md /
   specs.md / tasks.md — the `outcome/01-verification-gap-matrix.md` (REQ-6) and `deferred-items.md`
   that specs.md references are absent. Re-derive the matrix from this research; do not assume it.
7. Minor: 2.3.5 says `amount >= 0`; schema enforces `amount > 0` (zero rejected,
   `wallet.repository.test.ts:744`) — satisfied-by-stronger; record as such.

## Harness Recommendations

§2 execution is mostly an **evidence-recording exercise over existing green suites** plus the wording
re-maps:

1. **Run and capture**: `bun run test:services:sequential` (session-lifecycle, arbitration, wallet,
   admin-financial-auditing), `bun run test:db:sequential` (student + wallet repo CHECK/settlement),
   and the journeys (`financial-safety-verification`, `session-dual-confirmation`,
   `post-confirmation-dispute`, `admin-financial-auditing`). REQ-043 concurrency proofs are
   real-PostgreSQL-gated (`testOnRealPostgres`) — the launch run must execute on PG, not PGlite.
2. **Launch-day DB probes** (checklist asks for direct SQL attempts): follow the
   `wallet.repository.test.ts:476-518` pattern in a small probe file — suggested home
   `backend/db/test/logic/billing/launch-financial-probe.test.ts` — asserting CHECK violations raise
   the named constraints; post-settlement ledger UPDATE and DELETE raise the trigger exceptions.
3. **Row re-maps** for 2.2.2/2.2.3/2.5.2/2.5.3 written into the executed checklist with code
   pointers (this file's mapping table) so sign-off is honest.
4. **GraphQL error-code pin** (gap 3): one dev-server testClient file, two denials
   (`frontend/graphql/test/`).
5. **Matrix artifact**: record per-row evidence in this plan's `outcome/` (e.g.
   `02-financial-escrow-evidence.md`) mirroring the mapping + captured suite logs;
   `docs/billing/financial-safety-verification.md` (shipped) is the canonical domain doc to cite.
6. **Retire or re-home `scripts/escrow-e2e/`** — parameterize paths if kept; otherwise exclude from
   launch evidence and note supersession by `test/workflows/billing/` + `test/workflows/sessions/`.

## Evidence Appendix

```ts
// session-lifecycle.booking.ts:182-185 — fee held at request; deadline = now + 24h
      fee: sessionFeeForIntent(input.intent),
      feeHeld: true,
      heldBalanceLane: heldLane,
      confirmationDeadline: new Date(now.getTime() + SESSION_CONFIRMATION_WINDOW_MS),
```

```ts
// session-lifecycle.booking.ts:133-138 — the lane IS debited at request (the real "hold")
  const trialDebited = await StudentRepository.decrementLaneIfAvailable(studentId, HeldBalanceLane.Trial, tx);
  const intentDebited = await StudentRepository.decrementLaneIfAvailable(studentId, intentLane, tx);
```

```ts
// session-lifecycle.confirmation.ts:129,140 — wallet credit fires ONLY on the guarded confirm match
  const confirmed = await SessionRepository.confirmStudentCompletionOnce(sessionId, callerUserId, tx);
  ...
    await creditTeacherEarning(confirmed, confirmed.fee, tx);
```

```ts
// session-lifecycle.transitions.ts:222-241 — same-lane refund, fail-closed on unreadable lane
  if (resolved.heldBalanceLane === null) { return; }
  if (!isHeldBalanceLane(resolved.heldBalanceLane)) { throw new Error(`...unreadable held-balance lane`); }
  await StudentRepository.incrementLane(resolved.studentId, resolved.heldBalanceLane, tx);
```

```sql
-- 20260914064155_custom_5-teacher-transaction-settlement/migration.sql:60,74 — post-settle immutability
    IF OLD.status = 'pending' ... AND NEW.status IN ('completed', 'failed')
    RAISE EXCEPTION 'teacher_transaction is immutable — UPDATE is permitted only to settle a pending withdrawal...';
```

```ts
// wallet.repository.admin.helpers.ts:352-365 — reject RESTORES the request-time debit (2.5.3 re-map)
 * Restores a withdrawal debit to the wallet balance — the compensating
    .set({ balance: sql`${wallet.balance} + ${insert.amount}`, updatedAt: new Date() })
```

```ts
// shared/constants/session-fees.constants.ts:40 — the 24h window constant
export const SESSION_CONFIRMATION_WINDOW_MS = 86_400_000;
```
