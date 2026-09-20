# Admin Subscription Lifecycle & Management Reference

**Domain:** Billing & Subscriptions
**Lifecycle Status:** Active

---

## 1. Overview & Architecture

Four admin-gated lifecycle operations exist over the purchased `subscriptions` root — **extend**
the validity window, **renew** an expired subscription into a fresh period, **cancel** an active
subscription (balance-preserving), and **change plan** (upgrade/downgrade with exact proration) —
plus one admin **read** surface listing a student's subscriptions. All five ride the same shape:
a GraphQL field gated by the admin scope conjunction delegates to a service that re-asserts the
admin role (`assertActorAdmin`), validates fail-closed, and executes guarded single-statement
transitions plus exactly one audit row inside ONE transaction. Renew and plan-change create NEW
subscription rows (the historical row's identity is never mutated); the source row's status is
flipped only where the lifecycle requires it.

The purchase/activation half of the subscription lifecycle is documented in
[`subscription-purchase.md`](./subscription-purchase.md); the expiry sweep that owns
`active → expired` is documented in
[`subscription-validity-window-expiry.md`](./subscription-validity-window-expiry.md). The
invariants cited here (INV-B*) are defined in
[`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md).

Implementation anchors:

| Layer | Surface |
|---|---|
| GraphQL mutations | `backend/graphql/mutation/billing/subscription-admin.mutation.ts` (+ input types in `backend/graphql/pothos/billing/subscription-admin.pothos.ts`) |
| GraphQL query | `backend/graphql/query/billing/subscription-admin.query.ts` |
| Service | `SubscriptionAdminService` (`backend/services/billing/subscription-admin.service.ts`) with sibling helpers (`subscription-admin.helpers.ts`, `subscription-plan-change.helpers.ts`, `subscription-plan-change.replay.helpers.ts`, `subscription-proration.helpers.ts`, `subscription-admin-settle.helpers.ts`, `subscription-admin-read.helpers.ts`) |
| Repositories | `SubscriptionRepository` (`extendActiveOnce`, `cancelActiveOnce`, `findActiveWithPlan`, `findByIdForUpdate`), `StudentRepository` (`creditLaneBalance`, `setLaneBalanceValue`, `findByIdForUpdate`), the shared idempotency-claim repository |
| Frontend | drawer section under `frontend/views/admin/students/subscriptions/`, documents in `frontend/graphql/sharedDocuments/admin/admin-subscriptions.documents.ts` |

---

## 2. GraphQL Surface

All five fields are admin-only (§10). Wire names and shapes:

```graphql
extend type Mutation {
  adminExtendSubscription(input: ExtendSubscriptionInput!): StudentSubscription!
  adminRenewSubscription(input: RenewSubscriptionInput!): StudentSubscription!
  adminCancelSubscription(input: CancelSubscriptionInput!): StudentSubscription!
  adminChangeSubscriptionPlan(input: ChangeSubscriptionPlanInput!): ChangeSubscriptionPlanPayload!
}
extend type Query {
  adminStudentSubscriptions(userId: ID!): [StudentSubscription!]!
}

input ExtendSubscriptionInput    { subscriptionId: ID!, days: Int! }
input RenewSubscriptionInput     { subscriptionId: ID! }
input CancelSubscriptionInput    { subscriptionId: ID!, reason: String }
input ChangeSubscriptionPlanInput{ subscriptionId: ID!, newPlanId: ID! }

enum ProrationDirection { Upgrade | Downgrade }

type ChangeSubscriptionPlanPayload {
  subscription: StudentSubscription!   # the NEW row
  direction: ProrationDirection!
  carrySessions: Int!
  forfeitedSessions: Int!
}
```

Notes:

- The three simple mutations return the canonical `StudentSubscription` object (the shifted row,
  the new period, or the cancelled row respectively). Only plan-change gets a dedicated payload so
  the UI can render "carried X sessions, forfeited Y" without a refetch — the numbers ride the
  payload; the client never recomputes proration.
- `ProrationDirection` is a derived wire vocabulary (Pothos enum-member key convention), never a
  stored column.
- `reason` on cancel is optional free text; the wire `null` maps to absent at the boundary.
- The read is newest-first (the repository's `created_at DESC` ordering), owner-scoped by the
  `user_id = requested` predicate, and read-only by contract: no writes, no idempotency claims, no
  audit rows. A well-formed but unknown `userId` returns an empty list (disclosure-safe); a
  malformed one surfaces a canonical `VALIDATION` denial, never a 500.

---

## 3. Lifecycle Transition Table

No schema or enum changes back these transitions; every guard lives inside the UPDATE's WHERE.

| From | To | Operation | Guard | Side effects |
|------|----|-----------|-------|--------------|
| `active` | `active` (same row, window shifted) | extend | `UPDATE … WHERE id AND status='active' AND end_date < newEndDate` | one `Update` audit row; `updated_at` stamped; status never touched |
| `expired` | unchanged + NEW `active` row | renew | source must read `expired`; idempotency claim inserted before any write | new period (`start = now`, `end = now + intervalDays × MS_PER_DAY`), payment columns NULL, lane credited the plan's full `session_count`, junction row, claim backfill, one `Create` audit row |
| `active` | `cancelled` | cancel | `UPDATE … WHERE id AND status='active'` | **balance-preserving** — no lane column is reachable from the statement; one `Suspend` audit row |
| `active` | `cancelled` (old row) + NEW `active` row on the target plan | change plan | source reads `active` with its plan; target plan active, different, same `balance_lane`, non-null lane; idempotency claim inserted before any write | old lane reset to exact zero, exact-value settlement on the new lane, new row + junction, claim backfill, one `Override` audit row |

Deliberate scope exclusions: `pending` rows are payment-owned (never extend/cancel/renew targets);
`suspended` is owned by governance surfaces and is not used by this one; cross-lane plan changes
are rejected; the admin surface never captures or refunds payments.

A non-active source denies with zero writes and zero audit rows everywhere: extend requires
`active`, renew requires `expired` (an active row whose window merely closed is legitimately
extendable — the sweep owns the `active → expired` flip), cancel and plan-change require `active`.

---

## 4. Audit-Verb Mapping & Details Contracts

The audit vocabulary is pinned; every committed admin mutation writes exactly ONE row on the
`subscription` entity inside the same transaction (it can never outlive a rollback), and every
denial writes ZERO rows. `details` carries ids, integers, enum values, and ISO date strings — the
cancel reason is the trail's only free text (trimmed, ≤ 200 chars, never logged).

| Mutation | `AuditActionType` | `entity_id` anchor | `details` |
|---|---|---|---|
| `adminExtendSubscription` | `Update` | the extended row | `{ previousEndDate, newEndDate, addedDays }` — ISO strings + integer |
| `adminRenewSubscription` | `Create` | the NEW row | `{ renewedFromSubscriptionId, planId, creditedSessions, intervalDays }` |
| `adminCancelSubscription` | `Suspend` | the cancelled row | `{ fromStatus: "active", toStatus: "cancelled", reason? }` — the reason key is omitted entirely when absent |
| `adminChangeSubscriptionPlan` | `Override` | the NEW row | `{ direction, fromSubscriptionId, fromPlanId, toPlanId, carrySessions, forfeitedExcess }` |

The mapping is wired into the audit-completeness census (one wired row per mutation) and enforced
by the census-drift suite: a shipped admin mutation without a census row fails CI. Future admin
subscription surfaces must extend the same verb mapping and details vocabulary rather than invent
new machine keys.

The plan-change audit is also the record of the original proration arithmetic: a replayed
plan-change reports zeros (§7), so the committed audit row is the only place the original
carry/forfeit figures survive.

---

## 5. Proration (Plan Change) — Exact Arithmetic

All proration math runs in **exact BigInt minor units** over the plans' `decimal(10,2)` price
strings — never a binary float, never a percent estimate. A price string that is not the canonical
two-decimal form (`/^\d{1,8}\.\d{2}$/`) rejects with a localized validation error before any
arithmetic can drift; a zero price or non-positive session count rejects the same way (the unit
value would be undefined).

**Direction** is derived from the per-session unit value (`price / sessionCount`), compared by
cross-multiplication — never a division:

- strictly greater new unit value → `Upgrade`;
- strictly smaller → `Downgrade`;
- a unit-value **tie breaks on session count** (at least as many sessions → `Upgrade`, fewer →
  `Downgrade`); a same-shape swap is the value-neutral upgrade whose carry formula reproduces the
  remainder exactly.

**Carry (upgrade leg):**

```
carrySessions = floor( remainingSessions × priceMinorOld × sessionCountNew
                       ÷ ( sessionCountOld × priceMinorNew ) )
```

clamped to the catalog's session ceiling. The student's new lane total is the target plan's full
`sessionCount` **plus** the carry.

**Downgrade leg:** the credit is the target plan's full `sessionCount` only; the old lane's entire
remaining contribution is discarded and reported as `forfeitedSessions` (the audit row names the
same figure `forfeitedExcess`). Downgrades do not carry value across — the ticket semantics
mandate forfeiture, and the flat per-student lane model cannot attribute a partial remainder to a
specific subscription anyway.

**Window guard:** the change opens a fresh one-interval window, so the target plan's
`intervalDays` must sit inside the catalog's interval ceiling; a legacy row past the ceiling
rejects with the localized overflow copy. The extend operation enforces the same ceiling on its
own arithmetic: `days` must be a whole number ≥ 1 and the resulting window may not exceed the
ceiling measured from the row's `startDate` (the bound is inclusive).

**Remaining sessions** means the student's CURRENT lane balance for the old plan's lane, read
inside the transaction under the owner row's `FOR UPDATE` lock (§8). The plan-change refuses when
another active/pending subscription covers that lane — admin ops must not silently consume another
subscription's contribution on flat lanes.

### Worked examples

Upgrade — old plan 8 sessions × `"200.00"` (2500 minor/session), target plan 4 sessions ×
`"60.00"` (1500 minor/session), remaining lane balance 5:

- direction: `1500 × 8 (= 12000)` vs `2500 × 4 (= 10000)` → strictly greater → `Upgrade`;
- carry: `floor(5 × 20000 × 4 ÷ (8 × 6000)) = floor(400000 ÷ 48000) = 8`;
- settlement: old lane → 0, new lane → `4 + 8 = 12`; `forfeitedSessions = 0`.

Downgrade — old plan 8 sessions × `"200.00"`, target plan 4 sessions × `"50.00"`, remaining 6
(the census/journey fixture pair):

- direction: `1250 × 8 (= 10000)` vs `2500 × 4 (= 10000)` → exact unit-value TIE → session count
  breaks it (4 < 8) → `Downgrade`;
- settlement: old lane → 0, new lane → `4` (the target's full count only);
- `forfeitedSessions = 6` — the entire pre-change remainder.

---

## 6. Idempotency Claims & the Reserved Admin Namespace

Renew and plan-change are idempotency-claim backed in the EXISTING shared
`subscription_purchase_idempotency` store (the same table the purchase flow uses). Keys are
**server-constructed** from the targeted row's ids — the caller never supplies claim material on
this surface (`X-Idempotency-Key` is not consumed here):

| Operation | Claim key | Scope |
|---|---|---|
| renew | `subscription-admin:renew:<sourceSubscriptionId>` | one fresh period per expired source row |
| plan change | `subscription-admin:planChange:<sourceSubscriptionId>:<targetPlanId>` | one change per (source row, target plan) pair — a different target on the same source is a genuinely new change, not a replay |

Both keys live under the **reserved server-owned prefix** `subscription-admin:`. The shared store
is global-unique across the purchase and admin surfaces and also carries raw client-supplied
purchase idempotency headers, so an unreserved, predictably-shaped admin key could be pre-claimed
by a student and permanently block the admin flows for a targeted row. Both ends keep the space
server-owned:

- the admin flows mint every claim key under the reserved prefix (single builder functions shared
  by the claim insert, the replay lookups, and the probes — the identity can never drift between
  the write and the reads);
- the purchase ingestion boundary **rejects** any client-supplied key that starts with the
  reserved prefix, before any database work, on every purchase surface (student subscription
  purchase and teacher verification purchase alike).

Claim mechanics: the claim insert is savepoint-bracketed inside the flow's transaction and lands
BEFORE any result write — it is the flow's atomicity point. Every downstream failure rolls the
claim back with the transaction, so a denied renew or plan-change never poisons a future
legitimate one. The claim's `subscription_id` FK is nullable set-null, so the claim outlives its
produced row and the claim pointer is backfilled to the new row on the winning path.

Extend and cancel carry no claims: their replay safety is structural, via the guarded WHERE
predicates (§7).

---

## 7. Replay Semantics per Operation

| Operation | Replay shape | Surface to the caller |
|---|---|---|
| extend | A second identical request matches zero rows — the `end_date < newEndDate` predicate is the backstop (the window already sits at the target), and the flow's opening read takes the row's `FOR UPDATE` lock so concurrent extends serialize there. Genuinely NEW extensions stack legitimately (each computes its target from the row's current end date). | idempotent localized conflict (`CONFLICT`), zero audit rows |
| cancel | A second cancel matches zero rows (the row is already `cancelled`); a fresh disambiguation read on the loser path splits not-found / already-cancelled / other-non-active. | not-found → canonical `SUBSCRIPTION_NOT_FOUND`; replay → idempotent localized conflict; other state → localized active-only deny; all zero-write, zero-audit |
| renew | The claim's unique index is the serialization point: a duplicate insert blocks until the winner commits, then the claim's subscription pointer is loaded and returned — the FIRST result, no second period, no second credit, no audit row. A pointer that resolves to nothing (set-null after the result row's deletion) or to a foreign owner cannot be replayed. | success with the first result row; unresolvable pointer → localized already-renewed conflict |
| plan change | Two duplicate shapes: a serialized duplicate arrives with its source row already `cancelled` (probed via the claim key BEFORE the source-status guard), and a concurrent duplicate loses the claim insert's unique-index race (`23505`). Both return the FIRST change's result — with `carrySessions = 0` and `forfeitedSessions = 0` (the replayed call moved nothing) and the direction re-derived from the stored plan pair. | success with the first result (zeros on the proration integers); unresolvable/foreign pointer → localized already-plan-changed conflict |

Every denial path (pre-DB validation, admin gate, guarded transition, zero-row disambiguation,
coercion/ceiling/headroom failures) throws before any write. Denials use the default-code error
forms so `extensions.code` stays inside the canonical taxonomy (`UNAUTHORIZED`, `FORBIDDEN`,
`VALIDATION`, `NOT_FOUND`, `CONFLICT`) with localized copy — no invented machine keys.

---

## 8. Concurrency & Lock Ordering

- **The WHERE predicate is the lock.** Every transition is a single guarded statement; there is no
  SELECT-then-UPDATE on subscription rows, so the guard re-evaluates under the row lock at write
  time (zero TOCTOU on the target row). Zero-row results are the caller's replay/lost-race signal.
- **Lock order matches the expiry sweep: `subscriptions` first, then `students`.** The plan-change
  flow acquires the owner row's `FOR UPDATE` lock only AFTER the source row's guarded flip, and
  holds the lock to the transaction's end — composing both flows' lock acquisition in the same
  order makes a sweep × plan-change race deadlock-free. A detected deadlock (`40P01`) maps to the
  localized conflict like any other domain denial.
- **Read→settle serialization.** The proration reads the lane balance on the SAME transaction,
  under the owner row's `FOR UPDATE` lock, before the EXACT-value lane settlement lands one
  prepared total (never a relative increment on the old lane). A concurrent booking either commits
  before the lock is taken — and its debit is honestly reflected in the proration — or blocks
  until after the settlement commits; it can never commit in between and be silently superseded.
  The repository layer owns `SELECT … FOR UPDATE` (the service never issues locking reads
  directly).
- **Extend pre-image fidelity.** The extend flow's opening read is the locking read, so the audit
  row's `previousEndDate` is the true pre-image even when concurrent extends with different day
  counts serialize (each shift is audited against what it actually moved from).
- **Lane arithmetic cannot go negative**: the DB CHECK is the last line; a raw violation
  (`23514`) surfaces as the localized conflict with no partial commit. Renew's relative credit
  pre-checks its headroom so an out-of-range increment can never reach the driver.
- **Two admins on one row** (e.g. one extends while another cancels) serialize per the guarded
  predicates; the audit trail preserves both actions. That is the accepted multi-admin semantics.

---

## 9. Interplay with the Expiry Sweep

The sweep (`SubscriptionExpiryService.expireDue`) owns `active → expired` exclusively; this
surface never writes that transition. Together they partition the lifecycle: active rows take
extend (or cancel / plan change), swept rows take renew, pending rows belong to payments.

- **Extend vs sweep is linearizable** by statement ordering inside the respective transactions:
  either extend wins (the window moves out — the row is simply never sweep-eligible again) or the
  sweep wins (the row expires and renew is the recovery path). Both guarded statements
  re-evaluate their predicates under the row lock, so neither can half-apply.
- **Cancelled rows are never sweep-eligible** — the sweep flips `active` only. A cancel itself
  never zeroes or touches any lane balance (§3); the student's remaining sessions survive the
  cancellation and remain spendable per the booking rules.
- **The zeroing asymmetry is documented, deliberate, and one-directional:** the sweep's
  conditional lane-zeroing guard treats `cancelled` as NON-covering. Cancelling subscription S
  preserves the lane; but if the student holds ANOTHER subscription on the same lane that later
  expires uncovered, a LATER sweep run of that other subscription may still zero the
  cancel-preserved lane — expiry zeroes per its own coverage rule (INV-B6's window semantics with
  INV-B3's no-carryover), cancellation never does. Operators should treat cancel as
  balance-preserving-with-respect-to-its-own-action, not as a permanent lane freeze.
- The plan-change lane reset is a write owned by this surface alone (old lane → exact zero), and
  it is atomic with the new period — the sweep can never observe a half-settled change.

---

## 10. Authorization Boundary

Five fields, one gate stack, three layers deep:

1. **GraphQL scope gate (pre-resolver):** the admin scope conjunction `$all{authenticated,
   role:[Admin]}` on every field. Anonymous callers get `UNAUTHORIZED`; authenticated non-admins
   (student/teacher/parent) get `FORBIDDEN` — both before any resolver logic runs. The four
   mutation fields inline the byte-equivalent conjunction literal (the form every other admin
   mutation file uses) so the audit-census drift classifier can statically verify every wired
   field's gate — a shared-constant gate would land in the drift suite's honest-skip ledger, which
   must stay empty.
2. **`requireAdminUser(ctx)`** narrows the context user server-side; the actor id is server-bound
   (never an argument).
3. **`assertActorAdmin` service re-assertion** runs BEFORE any read or write on every path
   (defense in depth). A denied call leaves the target row byte-identical (including
   `updated_at`), mints zero idempotency claims and zero audit rows, and emits one bounded
   domain-error log carrying ids only.

The read surface adds the BOLA boundary structurally: results are bound by `user_id = requested`,
so no cross-student leakage is expressible, and the non-admin denial is spy-proven zero-touch (the
owner-scoped read never runs). Subscription ids on mutations never confer ownership — the admin
role is the only authority, and it is re-asserted per call.

---

## 11. Admin Drawer Surface (Frontend)

The surface lives inside the existing admin student directory — no new routes or nav items:

- **Mount:** a subscriptions section inside `AdminStudentDetailDrawer`, directly below the
  balances section, remounted per student (keyed) so query state can never bleed across students
  during close/open transitions.
- **Documents:** `adminStudentSubscriptionsQueryDocument` plus the four mutation documents, every
  selection set carrying `id` for cache-safe refetches; hooks wrap the mutations in `useMutation`
  and refresh via refetch of the drawer query (no cache surgery).
- **Per-status action matrix** (exhaustive over the status enum): `active` → Extend / Cancel /
  Change Plan; `expired` → Renew; `pending` / `cancelled` → none.
- **Dialogs are presentational:** they forward only validated submit intents (whole days > 0 for
  extend, the 200-character reason cap for cancel — everything else is the server's authority),
  render server-localized denials inline while staying open on every failure arm, and render the
  change-plan success copy from the payload's carried/forfeited integers — the client performs no
  proration math. A failed plans-catalog read is a distinct error state, never a false "no
  eligible plan" empty state.
- **i18n:** the `subscriptionAdmin` namespace, registered through the standard five-step flow
  (types leaf, en/ar leaves, message wiring, namespace handle) with a runtime en/ar parity suite;
  labels are compile-typed and property-accessed; count copy is pluralization-aware (CLDR classes
  including the zero class) in both locales.
- **Zero-notification contract:** this surface emits NO notifications by design — no client
  notification expectations exist anywhere in the flow, and the journey suite pins zero dispatches
  at every step. Any future notification on this surface is a contract change, not an addition.

---

## 12. Environment Note (database baseline)

The journeys and suites that pin this lifecycle assume the database has **ALL baseline migrations
applied — migrations 1 through 5, including the teacher-transaction settlement amendment**. The
immutability triggers land in an early migration in their strict form and a later migration
amends the specific trigger with its single sanctioned exception; a database that skipped the
amendment keeps the strict trigger active, and legitimate service writes (settlements, and any
leg relying on the amended guards) then abort with guard violations that look like feature
failures but are environment drift. Before diagnosing lifecycle test failures, re-apply the
repo's own idempotent migration set to the target database and re-run.

---

## 13. Related Documents

- [`subscription-purchase.md`](./subscription-purchase.md) — the purchase/activation half of the lifecycle, the shared idempotency-claim table, and the ingestion guard that reserves the admin claim namespace
- [`subscription-validity-window-expiry.md`](./subscription-validity-window-expiry.md) — the expiry sweep that owns `active → expired`, conditional lane zeroing, and the booking gate
- [`../specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) — INV-B* invariant definitions (§4 Subscription & Session Balance Lifecycle)
- [`plan-catalog.md`](./plan-catalog.md) — plan price/session-count/lane fields consumed by proration, and the catalog ceilings
- [`segregated-session-balance.md`](./segregated-session-balance.md) — the flat lane model and its guarded primitives
- `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts` — the end-to-end cross-actor journey (extend → cancel → renew → replay → plan change → denial matrix)
- `test/workflows/admin/audit-completeness.journey.test.ts` — the census journey executing each mutation's audit contract through the real service path
