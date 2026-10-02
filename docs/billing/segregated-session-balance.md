# Segregated Session Balance — Canonical Reference

**Domain:** Billing & Subscriptions (session-balance lanes on `students`)
**Status:** Implemented and verified (credit on activation, hold-as-debit at booking, same-lane refund)
**Source of truth for:** the four balance lanes and their two deliberately separate vocabularies, the activation credit path, the hold/refund escrow path, the guarded debit rules, and the four ratified semantic decisions (D1–D4) that reconcile the ticket phrasing with the shipped implementation.

This document is the single canonical reference for the segregated session-balance domain. Downstream consumers (session lifecycle, expiry windows, admin balance surfaces, any future review-session flow) MUST read it before touching `students.balance_*`, `plans.balance_lane`, or `sessions.held_balance_lane`. The lanes are written **exactly once** per event — the guarded primitives live in `StudentRepository` and are composed by `SubscriptionActivationService` (credit) and `SessionLifecycleService` (hold/refund); consumers extend them, never re-implement them.

---

## 1. Why

A session balance is money in the student's hands: a paid plan credits a specific lane, and every booking spends exactly one unit from that lane. The domain therefore has to be segregated (a Hifz purchase never funds a Tajweed booking), race-proof (two concurrent bookings on a one-unit lane must settle as exactly one session and one debit), and fail-closed (a plan without a configured lane can never credit anything). Each rule below exists because a specific failure mode was either proven or ruled out during implementation — the worst of them is *vocabulary merge*: the credit vocabulary and the hold vocabulary look interchangeable and are not (§2). Read §5 and §7 before adding any writer over these columns.

## 2. Lane Model

### 2.1 The four lanes (`backend/db/schema/students/students.ts`)

| Column | Type / constraint | Role |
|---|---|---|
| `balance_trial` | integer, NOT NULL, default 0, CHECK `>= 0` | Free-trial allowance (`docs/students/free-trial-provisioning.md`); grant-once, never subscription-bound |
| `balance_hifz` | integer, nullable, default 0, CHECK `>= 0` | Hifz-plan allowance |
| `balance_tajweed` | integer, nullable, default 0, CHECK `>= 0` | Tajweed-plan allowance |
| `balance_reviews` | integer, nullable, default 0, CHECK `>= 0` | Verification/review-plan allowance — **credit-only** (§5, D2) |

All four are server-owned: no GraphQL mutation accepts a caller-supplied balance value on any lane (grep-gated; the only wire exposure is the admin read type).

### 2.2 Two vocabularies, deliberately separate

| Vocabulary | Type / map | Members | Used by |
|---|---|---|---|
| Credit lanes | pgEnum `subscription_credit_lane` (`plans.balance_lane`) + frozen `CREDIT_LANE_BALANCE_COLUMNS` map | `hifz`, `tajweed`, `reviews` | Activation crediting (`docs/billing/subscription-purchase.md` §7) |
| Held-fee lanes | TS `HeldBalanceLane` enum + guard (`backend/enum/scheduling/held-balance-lane.enum.ts`) + frozen column map | `trial`, `hifz`, `tajweed` | Booking holds and refunds (`docs/sessions/session-lifecycle.md` §4–§5) |

`reviews` is a credit lane but **never** a held-fee lane: it is funded by the verification plan and no review-session booking flow exists. `trial` is the inverse: it funds holds but is never purchased. The two maps must never be merged and a lane must never be smuggled across them (§7).

A plan row with a NULL `balance_lane` cannot be purchased (`PLAN_LANE_UNCONFIGURED`), and a NULL lane at activation quarantines the delivery — nothing is mutated (INV-B2/INV-B5 require a lane to credit; the lane is never guessed).

## 3. Credit Path (activation)

The credit happens once, inside the webhook activation transaction (`SubscriptionActivationService.processWebhookEvent` — full contract in `docs/billing/subscription-purchase.md` §7):

1. The signature-verified `confirmed` callback correlates to the pending pair; the guarded `activatePendingOnce` (`WHERE status = 'pending'`) is the exactly-once arbiter — a replayed callback matches zero rows and acks as a replay with **no credit and no second notification**.
2. `creditLaneBalance(studentId, plan.balanceLane, plan.sessionCount, tx)` credits exactly `plan.sessionCount` to exactly one lane: a single relative UPDATE (`SET balance_<lane> = balance_<lane> + amount`) resolved through the frozen credit map — one column moves, sibling lanes are untouched, CHECK floors still enforced.
3. The amount is the plan row's `session_count` (server-owned, CHECK `> 0`); it is never derived from client input and never split across lanes.

Ordering guarantees: the credit never runs for a quarantined delivery (NULL lane, ledger mismatch, over-ceiling rows), never runs twice for one subscription (the state machine is the arbiter — no event-bookkeeping table), and always commits atomically with the `active` flip, the payment decision, and the confirmation notification row.

## 4. Hold/Refund Path (booking escrow)

**Hold = a guarded debit of one allowance unit at request time** (ratified D1, §6). The booking transaction (`SessionLifecycleService.createSession`, phase 2 in `docs/sessions/session-lifecycle.md` §4–§5):

1. **Trial-first ladder:** attempt `UPDATE students SET balance_trial = balance_trial - 1 WHERE id = $1 AND balance_trial > 0 RETURNING id`; on a miss, the same guarded statement on the intent lane (`balance_hifz` for Hifz, `balance_tajweed` for Tajweed). Both miss → `ValidationError("INSUFFICIENT_BALANCE")`, transaction rolls back leaving zero writes and the idempotency key reusable.
2. **Provenance:** the winning lane is written to `sessions.held_balance_lane`. It is NULL until a fee has ever been held; once placed it is **permanent provenance** — never rewritten or nulled. `fee_held` is the marker; the lane column is the driver.
3. **Release (consumption):** dual confirmation (student confirm, or admin arbitration to COMPLETE) flips `fee_held = false` and credits the teacher's wallet — **no second debit** on the student lane. Net effect per attended session: exactly −1 on the funding lane.
4. **Refund:** on a cancel (either participant) or the 24h timeout sweep, the guarded row update returns `held_balance_lane`; only when it is non-null does the service run the guarded `+1` `incrementLane` to the **same** lane, in the same transaction. An unreadable provenance value fails closed (the refusal rolls the whole cancellation back) — the row and the hold can never disagree. Pre-lifecycle rows carry `fee_held = false` and a NULL lane; cancelling them refunds nothing, which is correct (no hold exists).

## 5. Guarded-Mutation Rules

Every balance write is ONE relative `UPDATE … WHERE <lane> guard RETURNING` inside the owning transaction:

- **Non-negative by construction:** the `balance > 0` (debit) or the CHECK floor (credit) is fused into the statement under the row lock — the TOCTOU window is zero. A concurrent one-unit race settles as exactly one fulfillment and one `INSUFFICIENT_BALANCE`, lanes never negative (proven by the chaos case).
- **Fail-closed amounts:** debit amount is the constant 1; credit amount is the plan row's `session_count`. Neither is caller-controlled.
- **Column resolution through frozen maps:** lane columns are resolved from module-private frozen maps keyed by enum members — a caller string can never name a column, and an unknown member fails closed.
- **Rollback is the only cleanup:** a booking failure (insufficient balance, failed insert) leaves zero writes; the debit precedes the session insert so a failed insert can never strand a debit.
- **No read-then-write:** never branch a balance write off a pre-read; the guarded predicate IS the lock.

## 6. Ratified Semantics (D1–D4)

These four divergences between the ticket's literal phrasing and the shipped implementation were reviewed and ratified; each is bound to its governing invariant and canonical doc.

| # | Decision | Ratified semantics | Invariant binding |
|---|---|---|---|
| **D1** | **Debit timing = hold-as-debit at request (REQ-024).** The ticket says "decrement on attending (dual confirmation)"; the shipped code debits one unit at request time. Ratified as-shipped: refactoring to debit-at-confirmation would reintroduce the double-booking race the escrow killed. Net effect per attended session is exactly −1 on the funding lane — identical arithmetic; holds additionally make the zero-balance denial atomic. | Hold = guarded debit at request; release flips `fee_held` only; refund returns the same lane | `docs/sessions/session-lifecycle.md` §4–§5; INV-B4/B8; decision B.4 implemented as debit-at-request + same-lane refund |
| **D2** | **Reviews lane is credit-only (REQ-025).** `reviews` stays in the credit vocabulary and stays OUT of `HeldBalanceLane` (`backend/enum/scheduling/held-balance-lane.enum.ts`); no booking flow can spend it. The future decrement obligation (a guarded debit on the reviews lane when a review-session booking flow lands) is a forward item owned by that ticket, not by this domain. | Credit path green end-to-end; hold path structurally unreachable for `reviews` | INV-B5 (segregation); `HeldBalanceLane` enum contract |
| **D3** | **"422" means the VALIDATION family, custom code preserved (REQ-020/021).** Over GraphQL the envelope is HTTP 200 with `errors[].extensions.code`; the canonical map `VALIDATION → 422` applies (`backend/lib/errors/error-code-taxonomy.ts`). Acceptance is: VALIDATION-class + `extensions.code = INSUFFICIENT_BALANCE` + the localized `insufficientBalance` message — never a raw HTTP 422, never a mangled custom code. | `ValidationError("INSUFFICIENT_BALANCE", t.insufficientBalance)` is the canonical denial shape | `docs/graphql/domain-error-extensions-code.md`; ERROR_CODE_HTTP_STATUS taxonomy |
| **D4** | **Trial-first eligibility is the eligibility rule (REQ-026).** The ticket's plain `balance = 0 ⇒ reject` applies only when the trial lane is also empty: eligibility is `(intent lane > 0) OR (balance_trial > 0)`, with the trial consumed first (INV-B8 order). The trial is an additional eligibility lane, not a replacement for any paid lane; blocking semantics for an all-empty student are unchanged. | The `debitBookingLadder` ladder (trial → intent lane, both-miss → `INSUFFICIENT_BALANCE`) | INV-B4 (extended), INV-B8; `docs/students/free-trial-provisioning.md` |

## 7. Anti-Patterns (what NOT to do)

- Never merge the credit map and the hold map, or smuggle `reviews` into hold semantics / `trial` into purchase semantics — the two vocabularies are deliberately separate worlds (§2.2).
- Never accept caller-supplied balance values, lane names, or debit amounts — lanes and amounts are server-owned (BOPLA).
- Never read-then-write a lane balance — the guarded `WHERE balance > 0` predicate IS the lock.
- Never resolve a lane column from a raw string — always through the frozen enum-keyed maps.
- Never debit a second unit at confirmation — the hold already debited at request; release flips the marker only.
- Never refund to a guessed lane — always to the recorded `held_balance_lane` provenance, and only when it is non-null.
- Never rewrite or null `held_balance_lane` after it is placed — it is permanent provenance.
- Never surface a custom code as a raw HTTP status — the taxonomy (`VALIDATION → 422`) owns HTTP semantics; the wire carries `extensions.code`.

## 8. Test Map

| Behavior | Executing test refs |
|---|---|
| Lane credit, one lane, siblings untouched (Hifz / Tajweed / Reviews) | `backend/db/test/repo/students/student.repository.test.ts` (credit tiers); `backend/services/billing/subscription-activation.service.test.ts` (per-lane exact-delta); `test/workflows/billing/subscription-purchase.journey.test.ts` (journey legs) |
| Replay / no double credit, exactly-once activation | `subscription-activation.service.test.ts` (duplicate-delivery + zero-credit replay tiers); `subscription-purchase.journey.test.ts` (replay leg) |
| Quarantines (NULL lane, ledger mismatch, tampered amount) | `subscription-activation.service.test.ts` (NULL-lane, orphan, tampered-amount tiers) |
| Trial-first ladder + INSUFFICIENT_BALANCE denial (zero writes, key reusable) | `backend/services/classes/session-lifecycle.service.test.ts` (ladder + total-miss branches); `test/workflows/sessions/session-lifecycle-denials.journey.test.ts` |
| Concurrent one-unit race — exactly one session, lanes never negative | `session-lifecycle.service.test.ts` (chaos case) |
| Hold release without second debit; same-lane refund; net −1 | `session-lifecycle.service.test.ts` (confirm happy path, dispute resolves, sweep/race refund legs); `test/workflows/sessions/session-dual-confirmation.journey.test.ts` |
| GraphQL transport pin (VALIDATION + `extensions.code`, no balance leak, auth probes) | `backend/graphql/test/session-booking-balance.test.ts` |
| CHECK floor never negative | `backend/db/test/repo/students/student.repository.test.ts` (CHECK constraint tiers); `backend/db/schema/students/students.ts` |

## 9. Related Documents

- `docs/billing/subscription-purchase.md` — the purchase → activation → credit pipeline this document's credit path consumes (gateway port, webhook security, ledger trigger).
- `docs/sessions/session-lifecycle.md` — the booking state machine, hold-as-debit ruling (§4), trial-first ladder and same-lane refund (§5), and idempotency claim design this document's hold/refund path consumes.
- `docs/specs/state-machine-invariants.md` §4.2 — the canonical INV-B1/B2/B4/B5/B8 invariant registry these semantics bind to.
- `docs/students/free-trial-provisioning.md` — the `balance_trial` grant-once pattern behind the trial-first ladder.
- `docs/graphql/domain-error-extensions-code.md` — the DomainError contract and `extensions.code` wire shape behind D3.
- `docs/planning/PRODUCTION_READINESS.md` §5.3 — the readiness check-off bound to this domain's verification evidence.

## 10. Gotchas & Operational Notes

Transport-level facts proven while pinning this domain's behavior over the GraphQL wire — every consumer that drives `createSession` through the integration harness needs them:

- **A student `createSession` client must carry an `X-Idempotency-Key` header.** The pre-DB `idempotencyKeyRequired` guard VALIDATION-denies any keyless student call *before* the balance ladder is reached — such a denial exercises the idempotency guard, never the balance path. Use a fixed per-run key so denial assertions are deterministic.
- **`ID!` fields serialize as strings.** Wire payloads return `id`, `teacherId`, etc. as quoted strings (`"6555"`); assertions against numeric DB ids must cast (`String(...)`). Compare against `extensions.code` (`INSUFFICIENT_BALANCE`) for machine-readable denials — D3.
- **GraphQL integration suites share the dev-server database and accumulate committed rows by convention.** Pre-existing rows (e.g. session rows from other suites' fixtures) are not residue; scope every row-count assertion to fixture-scoped ids (teacher/student pair, per-run idempotency keys), never to global table counts.
- **Denial evidence lives in the captured server log.** `[DOMAIN] Session booking rejected: insufficient balance {"code":"INSUFFICIENT_BALANCE",...}` lines appear once per denial leg; the test runner's `--focus` view filters failures only, so for green suites grep the captured run log instead.
