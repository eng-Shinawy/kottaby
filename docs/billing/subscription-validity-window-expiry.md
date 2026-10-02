# Subscription Validity Window & Expiry Reference

**Domain:** Billing & Subscriptions
**Lifecycle Status:** Active

---

## 1. Overview & Architecture

A subscription purchases a fixed session-credit window: activation credits the plan's balance lane
and stamps the validity window; when the window closes, an externally-triggered expiry sweep retires
the subscription and settles its credited balance; the booking path denies subscription-funded
spend against an expired, uncovered lane. The purchase/activation half of this lifecycle is
canonically documented in [`subscription-purchase.md`](./subscription-purchase.md); the invariants
cited here (INV-B1..B8) are defined in
[`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md).

```mermaid
sequenceDiagram
    participant SC as External scheduler (ops-wired)
    participant RT as GET /api/cron/expire-subscriptions
    participant SV as SubscriptionExpiryService
    participant DB as Postgres (one tx)
    participant ST as Student (booking)
    participant BL as debitBookingLadder

    SC->>RT: GET + Bearer CRON_SECRET
    RT->>RT: bare 404 unless CRON_EXECUTION_MODE=external AND CRON_EXTERNAL_ENABLED=true
    RT->>RT: timing-safe SHA-256 digest compare (401 masked on mismatch)
    RT->>SV: expireDue()
    SV->>DB: withTransaction: now once; guarded UPDATE active→expired (end_date ≤ now) RETURNING
    SV->>DB: per distinct (owner, lane): guarded zeroing UPDATE (no covering subscription)
    SV-->>RT: { expired, lanesZeroed }
    RT-->>SC: apiSuccessResponse envelope
    ST->>BL: book session
    BL->>DB: trial debit? success → done (INV-B3 exempt)
    BL->>DB: intent-lane debit? success → done
    BL->>DB: both missed: uncovered expired lane on the intent lane?
    BL-->>ST: SUBSCRIPTION_EXPIRED (VALIDATION family) | INSUFFICIENT_BALANCE
```

### Key invariants

1. **INV-B2 (credit at activation):** the plan's full session count is credited to the lane exactly
   once, atomically with the window stamp (`activatePendingOnce` guarded arbiter — see
   [`subscription-purchase.md`](./subscription-purchase.md) §7).
2. **INV-B3 (expiry, no carryover):** unused sessions expire at the end of the `interval_days`
   window. The rule explicitly does NOT apply to `balance_trial` — the trial lane is not
   subscription-bound, has no window, and persists until consumed by a booking (§7).
3. **INV-B4 (eligibility):** a student may request a session while any funding lane is positive;
   after expiry the subscription lanes stop funding bookings (§5).
4. **INV-B6 (admin extension):** admins may manually extend `end_date`. No admin expiry surface
   ships with the sweep; an extended in-window row is simply never sweep-eligible again.

---

## 2. Window Arithmetic (activation-owned)

- **Stamp:** activation writes `end_date = start_date + plans.interval_days × 86_400_000 ms`
  (`MS_PER_DAY`) with **both timestamps taken from a single captured `now`** in the activation flow
  (`backend/services/billing/subscription-activation.service.ts`). The delta is exact —
  `endDate − startDate === intervalDays × 86_400_000` is pinned by the activation service suite and
  the billing journey suite.
- **`interval_days` lives ONLY on `plans`** (column `plans.interval_days`, CHECK `> 0`; the catalog
  additionally enforces a purchase-time ceiling so the arithmetic can never overflow). It is NOT a
  `subscriptions` column: the window is never derived client-side, never re-stored, and plan edits
  after purchase never touch an already-stamped window.
- **Window semantics (A.9 reading):** `Active` means `start_date <= now < end_date`; `Expired` means
  `now >= end_date` — the boundary is **inclusive**: a row whose `end_date` equals the sweep instant
  is already due. `pending` rows (NULL or future dates, pending-until-paid) are never sweep-eligible.
- **Window-vs-status lag:** between `end_date` passing and the next sweep run, the row remains
  `status = 'active'` with a spendable balance. This lag is a contract, not a bug: only the sweep
  transitions the status (§3) and only swept state feeds the booking denial (§5).

---

## 3. Expiry Sweep Design

### Route (`app/api/cron/expire-subscriptions/route.ts`)

GET-only sibling of the payments webhook / sessions sweep cron surfaces. Fixed gate order:

1. **Mode gates FIRST (fail-closed):** the surface answers a **bare 404** — `new Response(null,
   { status: 404 })`, no envelope, no code, no `requestId`, no `content-type` — unless BOTH
   `getEnv("CRON_EXECUTION_MODE") === "external"` AND `getEnv("CRON_EXTERNAL_ENABLED") === "true"`.
   Every envelope carries a `code`, so any envelope would leak "this path exists and is special";
   the bare 404 keeps a disabled deployment byte-indistinguishable from an unknown path. This is the
   ONE status literal the error-code taxonomy cannot express, documented on the route as the single
   sanctioned exemption.
2. **Timing-safe bearer gate:** `Authorization: Bearer <CRON_SECRET>`; both sides are hashed to
   fixed-length SHA-256 digests before `node:crypto.timingSafeEqual` (no length leak, no early
   exit). Missing bearer, wrong secret, or an empty/undefined configured secret ⇒ masked `401
   UNAUTHORIZED` envelope. The secret is NEVER accepted via query string.
3. **Delegate:** `SubscriptionExpiryService.expireDue()` (no outer transaction in production).
4. **Success envelope:** `apiSuccessResponse({ expired, lanesZeroed }, { requestId })` — honest
   counts produced by the guarded statements, never row identities.
5. **Failure envelope:** any thrown sweep failure (e.g. a fail-closed invariant abort rolling the
   cohort back) is caught and masked through `apiErrorResponse` — 500 `INTERNAL_SERVER_ERROR` plus
   one correlated log line; the raw error never escapes the handler.

The route is locale-free (`locale = "en"` for envelope classification only — cron callers never
render localized copy) and performs zero session reads; it is registered in the gateway
`ROUTE_INVENTORY` as an envelope-classified route.

### Service (`backend/services/billing/subscription-expiry.service.ts`)

`SubscriptionExpiryService.expireDue(outerTx?)` — the whole cohort in **ONE transaction** (a
caller-owned `outerTx` runs it as a SAVEPOINT; that seam exists for tests only):

1. `const now = new Date()` — **one clock reading**, captured inside the transaction, governs every
   window comparison and settlement decision in the run.
2. **Guarded batch flip:** `SubscriptionRepository.expireDueActive(now, tx)` moves every `active`
   row with `end_date IS NOT NULL AND end_date <= now` to `expired`, returning
   `{ id, userId, planId }` projections. Zero rows ⇒ the replay/no-op branch: `{ expired: 0,
   lanesZeroed: 0 }`, one debug log, no error noise.
3. **Plan-lane resolution:** ONE `inArray(plans.id, …)` batch read on the same transaction resolves
   each expired row's credited lane. A NULL `balance_lane` is a configuration gap: the flip STANDS,
   the zeroing is skipped with one correlated warn (fail-safe, not fail-silent). A missing plan row
   or an out-of-vocabulary stored lane aborts the whole cohort closed (one error log + client-safe
   throw ⇒ full rollback — loud over silent-wrong).
4. **Conditional zeroing walk:** the distinct (owner, lane) pairs are walked sequentially (one
   guarded statement per pair, head-first before the next pair), each on the sweep transaction — a
   flip and its zeroings commit together or not at all.
5. **Counts-only return** `{ expired, lanesZeroed }`. Deliberately NO notification fan-out and NO
   audit write: the sweep is system-scope and actor-less; observability is structured logs (ids and
   counts only) plus the returned counts.

### Repository guards (the only writers)

| Method | Statement shape | Notes |
|---|---|---|
| `SubscriptionRepository.expireDueActive(now, tx?)` | ONE guarded `UPDATE subscriptions SET status='expired', updated_at=now() WHERE status='active' AND end_date IS NOT NULL AND end_date <= now RETURNING id, user_id, plan_id` | SQL-side comparison keeps the predicate inside the row lock (no SELECT-then-UPDATE); the raw `SET` bypasses `$onUpdate`, hence the explicit stamp; zero rows = replay/no-op |
| `SubscriptionRepository.hasUncoveredExpiredLane(studentId, lane, tx?)` | read-only fused probe: `EXISTS(expired subscription of the user on the lane) AND NOT EXISTS(pending OR active with end_date > now() coverage)` | one consistent snapshot; `now()` evaluated SQL-side; strictly transactional (no bare-read variant); owner-scoped by `user_id` |
| `StudentRepository.zeroLaneIfNoCoveringSubscription(studentId, lane, tx?)` | ONE guarded `UPDATE students SET balance_<lane> = 0, updated_at = now() WHERE id = ? AND COALESCE(balance_<lane>,0) > 0 AND NOT EXISTS(active/pending coverage on the lane) RETURNING id` | predicate + mutation share one statement under the row lock (zero TOCTOU); lane column resolved through the frozen `ZERO_LANE_BALANCE_COLUMNS` enum-keyed map; returns `true` iff the lane was positive and uncovered — the honest `lanesZeroed` signal |

### Partial index

`subscriptions_active_end_date_idx` — partial index on `subscriptions(end_date) WHERE status =
'active'` (Drizzle-declared, applied via the schema push path). The flip predicate is a tiny
range scan; the index routes expired rows out on every flip, so write amplification stays
near zero. Before it, no `status`/`end_date` index existed on the table.

---

## 4. Balance-Zeroing Semantic — Conditional Lane Zeroing

The balance model is flat per-student lanes (`balance_hifz` / `balance_tajweed` / `balance_reviews`
/ `balance_trial`) with **no per-subscription attribution**, so literal per-period zeroing is not
expressible. The shipped semantic is **conditional lane zeroing**:

> When the batch flip expires subscription S, the plan's credited lane on the owning student is
> zeroed **only if** no other subscription of that student credits the same lane with `status =
> 'active'` (post-flip, therefore in-window by construction) or `status = 'pending'`.

Why this shape:

- **Matches the no-carryover rule (INV-B3) exactly in the dominant single-subscription case** — an
  expired period's residual is gone at window end.
- **Revoke-Never-Wrongly:** when coverage genuinely overlaps (a co-subscription still backs the
  lane), the guard refuses to zero — the conservative direction is *under-revoke only*. The units
  are indistinguishable on flat lanes, so taking them could only claw back another paid period's
  credit. This residual gap (shared-lane co-subscriptions) is the documented, accepted cost of the
  flat model; a per-subscription attribution ledger is the recorded future refinement that would
  make per-period zeroing exact.
- **The guard is cheap and exact:** because the flip runs first in the same transaction, "active"
  at zeroing time is precisely "in-window at the captured `now`" — no separate date predicate is
  needed inside the coverage guard.
- **`balance_trial` is structurally exempt (INV-B3):** the zeroing write resolves its column
  through a map keyed by the subscription credit lanes (`hifz`, `tajweed`, `reviews`) — the trial
  lane has no member and can never gain one. A student whose subscription lanes zero out but who
  holds trial credit keeps exactly the trial balance.
- **Atomicity:** the flip and every zeroing share the sweep's one transaction (§3) — a crash can
  never leave `status='expired'` with un-zeroed lanes, nor zeroed lanes with `status='active'`
  past-window.

---

## 5. Booking Gate & Denial Ordering

The booking debit ladder (`debitBookingLadder` in
`backend/services/classes/session-lifecycle.booking.ts`) is trial-first; the expiry gate is a
**failure-branch insertion**, not a pre-ladder check. Pinned predicate order:

1. **Trial debit attempt** — success returns immediately. The trial exemption is *structural*: a
   trial-funded booking never reaches the expiry gate (§7).
2. **Intent-lane debit attempt** — success returns immediately; balance-based eligibility is
   unchanged and the successful-booking hot path gains ZERO subscription reads.
3. **Double-miss only:** if the intent lane is subscription-funded (Hifz/Tajweed — the reviews lane
   never funds bookings; trial has no credit-lane counterpart), probe
   `hasUncoveredExpiredLane(studentId, lane, tx)` once. On a hit, log the domain denial and throw
   `ValidationError("SUBSCRIPTION_EXPIRED", t.subscriptionExpired)`.
4. **Otherwise** the pre-existing `INSUFFICIENT_BALANCE` denial fires unchanged.

Denial never writes: the ladder's misses are no-op guarded statements and the throw lands before
any insert.

### Error contract

| Situation | `extensions.code` | Surface |
|---|---|---|
| Expired + uncovered lane on a subscription-funded intent | `SUBSCRIPTION_EXPIRED` | VALIDATION family → 422 on REST envelopes; over GraphQL, HTTP 200 with `errors[].extensions.code` per `docs/graphql/error-handling-contract.md` |
| Empty lane, no expired coverage (never-subscribed or exhausted) | `INSUFFICIENT_BALANCE` | unchanged precedent |

**Sweep-lag contract:** a lane past its window but not yet swept still books. The gate keys on
swept state (an *expired, uncovered* subscription on the lane), never on raw dates — forbidding the
lag case would deny spendable units the window-vs-status contract (§2) deliberately leaves alone.
The next sweep closes the lag: the lane zeroes, and the same request then denies
`SUBSCRIPTION_EXPIRED` instead of `INSUFFICIENT_BALANCE`.

### Localized copy & the future booking-UI obligation

The denial copy is the typed errors-namespace key `subscriptionExpired`, present in exactly three
files (type + English + Arabic leaves, parity-suite covered):

- en: `"Your subscription has expired."`
- ar: `"انتهت صلاحية اشتراكك."`

Today the copy travels **server-side only** (inside the `ValidationError` message, request locale)
alongside `extensions.code` — the client error map defines no row for custom domain codes and no
wired booking UI exists. **Obligation:** when the student booking UI lands, its error arm SHALL map
`SUBSCRIPTION_EXPIRED` → the `subscriptionExpired` snackbar key. That arm is required at that
landing, not optional polish; until then zero frontend changes is the correct posture.

---

## 6. Cron Contract & External-Trigger Deployment Handoff

The sweep is **externally triggered by design**: there is no in-process scheduler, no `vercel.json`
cron config, and no worker script in the repo. The route ships fail-closed and is *live but
unused* until ops arms it.

### Arming the trigger (ops runbook)

| Step | Action |
|---|---|
| 1 | Deployment env: `CRON_EXECUTION_MODE=external` **and** `CRON_EXTERNAL_ENABLED=true` (both via raw `getEnv`; no other keys are required — `CRON_SECRET` already exists). Missing either ⇒ bare 404. |
| 2 | Wire an external caller (host crontab / scheduler / HTTP job) to `GET /api/cron/expire-subscriptions` with header `Authorization: Bearer ${CRON_SECRET}`. |
| 3 | Cadence: daily is sufficient (the finest plan granularity is days); more frequent runs are harmless — replay is a zero-row no-op. |
| 4 | Verify with one manual invocation (same curl-shaped call): |

```bash
curl -fsS \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  "https://<deployment-host>/api/cron/expire-subscriptions"
# → 200 {"data":{"expired":<N>,"lanesZeroed":<M>},"requestId":"…"}
```

### Response contract

| Deployment state | Response |
|---|---|
| Gates closed (`CRON_EXECUTION_MODE != "external"` or `CRON_EXTERNAL_ENABLED != "true"`) | bare 404 — no body, no envelope, no content-type |
| Gates open, wrong/missing/empty bearer | 401 `UNAUTHORIZED` masked envelope |
| Gates open, valid bearer | 200 `{ data: { expired, lanesZeroed }, requestId }` |
| Sweep failure | 500 `INTERNAL_SERVER_ERROR` masked envelope + one correlated log line |

**Kill switch:** flipping `CRON_EXTERNAL_ENABLED` off returns the surface to the bare-404 posture
immediately — no redeploy of code, no dangling envelope.

**Retry semantics:** duplicate or overlapping deliveries are safe by construction — the guarded
flip matches zero rows on replay and the envelope honestly reports `{ expired: 0, lanesZeroed: 0 }`
(§8). Callers may retry on transport failure without idempotency keys.

---

## 7. Trial Exemption (INV-B3)

The trial lane is not subscription-bound: no `subscriptions` row credits it, no `interval_days`
window applies, and expiry never touches it. This holds at every layer:

- **Zeroing (structural):** the zeroing write's lane map is keyed by the subscription credit lanes
  and has no trial member — the column is unreachable from the statement (§4).
- **Booking (structural):** the ladder attempts the trial debit first, so a student with an expired
  subscription but `balance_trial > 0` still books from the trial lane; the expiry gate is never
  reached. The gate's lane map covers exactly the subscription-funded held lanes (Hifz/Tajweed).
- **Sweep counts:** trial balances are asserted intact by the repo/service/journey suites on every
  zeroing path.

---

## 8. Concurrency & Race Summary

All transitions are single-statement guarded UPDATEs — the WHERE predicate is the lock (no
SELECT-then-UPDATE, no advisory locks). A losing writer re-evaluates its predicate against the
post-commit value under the row lock.

| Race | Outcome |
|---|---|
| Double-fire sweep (duplicate scheduler delivery) | second run matches zero rows ⇒ `{ expired: 0, lanesZeroed: 0 }` — provable no-op |
| Concurrent sweeps ×2 | batch UPDATE row lock serializes; the loser re-evaluates and matches zero — identical terminal state in both orders |
| Sweep vs in-flight booking | linearizable on the `students` row lock: booking debits pre-zero (sweep zeroes the remainder), or the sweep zeroes first (booking's debit misses → expiry gate → denial, zero writes). Never double-spent, never half-zeroed |
| Booking during the window-vs-sweep lag | intentional success (§5 sweep-lag contract) |
| Refund landing after the lane was zeroed | a post-expiry cancellation refund can re-credit one unit (the refund increment carries no expired check) — accepted residual risk owned by the refund path; the re-credited unit remains spendable until consumed |
| Activation racing a sweep | disjoint row sets — activation targets `pending` rows, which are never sweep-eligible |
| Mid-cohort failure | one transaction for the whole cohort ⇒ full rollback; no half-swept cohort; masked 500 to the caller |

---

## 9. Anti-Patterns (what NOT to do)

- Never probe subscription state on the successful-booking hot path — the expiry gate lives
  strictly in the double-miss failure branch.
- Never give the zeroing map a `balance_trial` member, and never zero a lane whose coverage guard
  matches (Revoke-Never-Wrongly) — under-revoke is the only acceptable direction on flat lanes.
- Never derive `interval_days` from the client, re-store it on `subscriptions`, or re-window an
  already-stamped subscription.
- Never accept the cron secret via query string, and never replace the timing-safe digest compare
  with a plain string equality.
- Never wrap the disabled surface's 404 in an envelope — any code (even masked) is an existence
  oracle.
- Never write `audit_logs` rows or notification fan-out from the sweep (system-scope/actor-less —
  observability is structured logs + honest counts).
- Never treat the `end_date` boundary as exclusive — `now >= end_date` is expired, and the sweep's
  comparison is `end_date <= now`.
- Never implement the expiry transition as a date-derived read-time label; the `expired` status is
  a written state owned exclusively by the sweep's guarded statement.
