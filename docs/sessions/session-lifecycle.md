# Session Creation & Lifecycle — Canonical Reference

**Domain:** Sessions (P2P `session` table — teacher × student)
**Status:** Implemented and verified (DEV3-004 — Scheduled → Started → Completed/Cancelled)
**Source of truth for:** the session state machine and its guarded-transition pattern, the four-phase creation transaction, the hold-as-debit ruling and its reconciliation with decision B.4, the trial-first debit ladder and same-lane refund, the idempotency claim-table design, the sessions-are-sensitive disclosure (oracle) ruling, and the consumer guidance for every downstream ticket that touches the lifecycle.

This document is the single canonical reference for the session lifecycle. Downstream tickets (DEV3-005/006/011/012/013/021, DEV2-016) MUST read it before touching `session`, the balance lanes, or the lifecycle mutations. The lifecycle is written **exactly once** — the guarded primitives live in `SessionRepository` and are composed by `SessionLifecycleService`; consumers extend them, never re-implement them.

---

## 1. Why

A booking is money in motion: one allowance unit leaves the student's balance the moment a session is requested, and it must come back exactly once if the session dies. The lifecycle therefore has to be race-proof (two concurrent bookings on a one-unit lane must produce exactly one session), oracle-safe (a hostile caller must learn nothing about other people's sessions), and idempotent (a network retry must never book twice or debit twice). Those properties are easy to get subtly wrong — every ruling in this document exists because a specific failure mode was either proven or ruled out during DEV3-004. The worst failure mode for this domain is *copy-paste*: the plan-catalog ticket (DEV1-005) shipped the **opposite** disclosure ruling for a domain that looks structurally identical (see §7). Read §7 before touching any read-or-write predicate here.

## 2. State Machine & the Guarded-Transition Pattern

### 2.1 States and transitions

| State | Meaning |
|---|---|
| `scheduled` | Created; fee held (`fee_held = true`); 24h confirmation deadline armed. |
| `started` | Live session (`started_at` set). |
| `completed` | Teacher marked complete (`ended_at`, `confirmed_by_teacher_at` set). **Terminal in this slice.** |
| `cancelled` | Cancelled before start or during (`fee_held = false`, hold refunded). **Terminal.** |
| `disputed` | Exists in the `session_status` enum (B.18) but has **no transition surface** here — DEV3-022/DEV3-005 own it. |

```mermaid
stateDiagram-v2
    [*] --> scheduled: createSession (student; four-phase tx)
    scheduled --> started: startSession (owner teacher)
    scheduled --> cancelled: cancelSession (either participant)
    started --> completed: completeSession (owner teacher, certified)
    started --> cancelled: cancelSession (either participant)
    completed --> [*]: terminal (dual confirmation/wallet = DEV3-012/013)
    cancelled --> [*]: terminal (hold already refunded)
```

### 2.2 The guarded-transition pattern (INV-S1/S2)

Every lifecycle mutation is **ONE** `UPDATE … WHERE <row identity> AND <owner/participant> AND <required pre-state> RETURNING *` — predicate evaluation and mutation share one statement under the row lock, so the TOCTOU window is zero by construction:

| Mutation | WHERE predicate (all fused) | SET |
|---|---|---|
| `startSessionOnce` | `id ∧ teacher_id = caller ∧ status = scheduled` | `started_at`, `updated_at` (from ONE captured `now`). `confirmation_deadline` is **never** in any SET clause (B.2 — written at creation, never re-armed). |
| `completeSessionOnce` | `id ∧ teacher_id = caller ∧ status = started ∧ EXISTS (SELECT 1 FROM teacher WHERE teacher.id = session.teacher_id AND teacher.is_approved = true)` | `status=completed`, `ended_at`, `confirmed_by_teacher_at`, `updated_at`. Certification is **fused into the statement** — a decertified teacher cannot complete, and there is no separate read to race against. |
| `cancelSessionOnce` | `id ∧ (student_id = caller ∨ teacher_id = caller) ∧ status ∈ {scheduled, started}` | `status=cancelled`, `fee_held=false`, `updated_at`. Keeps `started_at`; never writes `ended_at`. Terminal states are structurally unreachable in the predicate — a double cancel can never double-refund. |

A zero-row match is ambiguous (unknown id vs non-owner vs wrong state vs decertified), so the service classifies it with **one cold probe read** (`findTransitionProbe`: the 4-column projection `id, status, studentId, teacherId`) that runs only AFTER the guarded UPDATE already matched zero rows and **never feeds a write**:

- probe `null` → `SESSION_NOT_FOUND`;
- probe status ≠ the required pre-state → `SESSION_INVALID_TRANSITION`;
- probe `started` on a complete attempt → the fused certification `EXISTS` was the miss cause → `TEACHER_NOT_CERTIFIED`.

**Rules:** never branch a write off the probe; never add a second write path for a transition; never "helpfully" widen a participant predicate (admins get exactly the non-participant denial — DEV3-021 owns the future admin surface); never persist cancel `reason` here (validated ≤500 chars, then discarded — DEV3-005's status-history seam owns persistence).

### 2.3 Invariant binding (state machine)

| Invariant | How this implementation holds it |
|---|---|
| **INV-S1** (no regression from `completed`) | Structural — `completed` appears in no transition's pre-state predicate; exhaustively matrix-tested. |
| **INV-S2** (`cancelled` terminal) | Same — double-cancel chaos-proofed; refund exactly once. |
| **INV-S3** (earning only on dual confirmation) | By absence: ZERO `teacher_transaction`/`wallet` writes exist in the lifecycle (grep-gated + journey count-delta oracles). |
| **INV-S4** (both parties NOT NULL) | Schema NOT NULL FKs + creation always writes both from server-side identity/lock. |
| **INV-S5** (certified at creation) | `SELECT … FOR UPDATE` on the `teacher` row inside the creation tx (§4) — and re-asserted fused into the complete UPDATE (§2.2). |
| **INV-S6** (in-session `is_online=false`) | **DEV3-005-owned** (with DEV2-011/012) — deferred here (D5; see §8). |
| **INV-S7** (report only on `completed`) | **DEV3-005-owned** — no report surface exists in this slice. |
| **INV-S8** (homework gated on report) | **DEV3-005-owned** — same. |
| **INV-B1/B4/B8** | Trial-first guarded ladder; lanes never negative (CHECK + guarded `> 0` predicate); zero-balance block at booking (§5). |
| **INV-W3/W4** | No wallet/transaction writes — consistent by construction. |
| **INV-U2/U5** | Governance denial verified at the login/SSR boundary (the GraphQL context is NOT fail-closed) **plus** a service-layer re-check on `createSession`/`startSession`/`completeSession` — `cancelSession` is deliberately EXEMPT (a governed student may still release an in-flight hold; REQ-023 no-punishment clause). Historical rows are never mutated by governance flips. |
| **INV-TV1** | Booking an applicant (a `role=teacher` user with no `teacher` row) is impossible — the cert lock resolves `null` → `TEACHER_NOT_FOUND`. Nothing here mints certification. Teachers are **unconditionally FORBIDDEN** on `createSession` (the REQ-011 students-row carve-out was struck; its dedicated-authScope design is deferred — ledger D7). |

**Decision binding:** A.8 — every row is `session_type = student_session` (evaluation types unreachable through this surface); A.10 — `intent` is `hifz | tajweed` only, `evaluation` is rejected pre-DB with `VALIDATION`; B.2 — `confirmation_deadline = now + 24h` at creation, never re-armed (sweeper = DEV3-012); B.3 — fee comes from platform constants, never input; B.4 — implemented per the hold-as-debit ruling (§4); B.18 — `disputed` exists in the enum with no producer here; C.5 — zero `recitation` rows written (1:1 session→recitation is DEV3-007's).

## 3. Four-Phase Creation Invariant (REQ-040)

`createSession` composes everything inside **one** `withTransaction(outerTx)` (outerTx → SAVEPOINT; undefined → new top-level transaction). The phase order is FIXED and never reordered:

- **Phase 0 — pre-DB (before any database work):** positive-safe-integer guards on `studentId`/`teacherId` (and on the target session id for `startSession`/`completeSession`/`cancelSession` — see §9b); idempotency key non-empty and ≤128 chars (`VALIDATION` if not — carried verbatim, never trimmed/coerced); intent ∈ {hifz, tajweed}; governance re-check on the acting user (`isDeleted ∨ isBlocked ∨ suspended` → `ForbiddenError`); ONE `now` instant captured for the whole flow → `confirmation_deadline = now + 86_400_000 ms` exactly.
- **Phase 1 — certification lock (INV-S5):** `SELECT id, is_approved FROM teacher WHERE id = $1 FOR UPDATE` (tx REQUIRED — a lock released at statement end protects nothing). `null` → `TEACHER_NOT_FOUND`; `is_approved !== true` (strict — the column is nullable, `null` counts as NOT certified) → `TEACHER_NOT_CERTIFIED`. The locked value IS the certification the insert commits against.
- **Phase 2 — trial-first guarded debit ladder (INV-B8):** see §5.
- **Phase 3 — idempotency claim insert:** see §6. Savepoint-bracketed so a duplicate key poisons only the savepoint and the transaction stays readable for the replay lookup.
- **Phase 4 — session insert + claim backfill:** `insertSession` maps every server-controlled column **field-by-field** (BOPLA — never a spread of caller input): participants from server identity/lock, `status=scheduled`, `sessionType=student_session`, intent, platform fee (decimal **string**), `fee_held=true`, `held_balance_lane` = the winning lane, `confirmation_deadline`. The claim's `session_id` is backfilled in the same tx — claim + session commit atomically.

Rollback is the only cleanup: any phase failure leaves zero writes (proven by a forced-insert-failure test — the idempotency key stays reusable afterwards).

## 4. Hold-as-Debit Ruling & the B.4 Reconciliation

**Ruling:** "hold" = a **guarded debit of one allowance unit at request time** (trial-first per INV-B8); dual confirmation (DEV3-012/013) flips `fee_held = false` and credits the wallet; cancellation re-increments the **SAME** lane exactly once. The `fee_held` boolean is the *marker*; the **`session.held_balance_lane` varchar column is the *provenance*** — it records which lane funded the hold (`trial | hifz | tajweed`), is NULL until a fee has ever been held, and once placed is **never rewritten or nulled** (release/consumption flips `fee_held` only; every refund reads the recorded lane).

This **supersedes `docs/planning/TEAM_ALLOCATION.md` Contract 1's older phrasing** ("held, not decremented"). Escrow-hold-at-request is only meaningful if the lane was debited at request; INV-B8 (booking decrements, trial-first) and the DEV3-004 acceptance criteria both require it. Decision B.4's escrow model is thereby *implemented* as debit-at-request + same-lane refund + the `fee_held` marker; the **wallet-side** release/credit still lands with DEV3-012/013. Pre-existing rows from the DEV1-004 era carry `fee_held = false` and a NULL lane — cancelling them refunds nothing, which is exactly correct (no hold exists).

## 5. Trial-First Ladder & Same-Lane Refund

**Debit ladder (inside Phase 2, same tx):**

1. `UPDATE students SET balance_trial = balance_trial - 1, updated_at = now() WHERE id = $1 AND balance_trial > 0 RETURNING id` — matched ⇒ held lane is `trial`.
2. Else the same guarded statement on the intent lane (`balance_hifz` for Hifz, `balance_tajweed` for Tajweed) — matched ⇒ held lane is that lane.
3. Both match zero rows → `ValidationError("INSUFFICIENT_BALANCE")` (422) and the transaction rolls back leaving zero writes. The debit **precedes** the session insert so a failed insert can never strand a debit.

The lane column is resolved from a module-private frozen `{ HeldBalanceLane → column }` map keyed by enum members — a caller string can never name a column. `reviews` is deliberately not in the vocabulary (it never funds held fees). Each call removes exactly ONE unit; a trial grant may hold N units and drains unit by unit across bookings.

**Refund:** on a successful cancel, the guarded UPDATE's RETURNING row carries `held_balance_lane`; only when it is non-null does the service run the unguarded `+1` `incrementLane` to the **same** lane, in the same transaction. An unreadable provenance value fails closed (refusal rolls the whole cancellation back), so the row and the hold can never disagree. Double-cancel cannot double-refund because terminal states are structurally outside the cancel predicate.

## 6. Idempotency Claim Design

**Table:** `session_request_idempotency { id, idempotency_key varchar(128) UNIQUE NOT NULL, user_id NOT NULL (FK cascade), session_id NULL (FK set-null), created_at }`. The claim is a **durable DB-level key record** — it extends `docs/IDEMPOTENCY.md`'s class-instance booking mandate to session booking by intent consistency (that doc's Affected Operations list names the quota-era `class_instances`, not the P2P `session` table, and SHOULD eventually name session bookings explicitly).

**Flow:** the key arrives via the `X-Idempotency-Key` header, captured exactly once in `createGraphQLContext` as `ctx.idempotencyKey` and **propagation-only** (never re-derived, never trimmed, never authorization-relevant, never logged). Phase 3 inserts the claim `{ idempotencyKey, userId: actingStudentId }` inside a savepoint; a duplicate key raises PG `23505`, detected by a cycle-safe cause-chain walker (`code === "23505"` on the deepest cause — **never** branch off the message; Drizzle's wrapper embeds query params, including the key). A failed booking rolls its claim back with the transaction — the key is released and reusable (REQ-040-proven).

**Replay-throw ruling (load-bearing):** a replayed booking **THROWS `ConflictError("DUPLICATE_REQUEST")` (409) and NEVER returns the pre-existing session row** — the service's replay branch is typed `Promise<never>`. The throw is what makes replays free: the replayed attempt's own partial writes (its debit-ladder step) roll back with the transaction — zero new rows, no second allowance unit (four concurrent same-key bookings → exactly one session, one claim, one net debit, three `DUPLICATE_REQUEST` denials). The **success-equivalent experience is the client's** job: REQ-065 maps the 409 to the `duplicateBookingInfo` info notice. A key spent by a DIFFERENT caller is denied with the oracle-safe `SESSION_NOT_FOUND` — another user's claim is never surfaced. The 24h sweeper/expiry is deferred (claim rows are harmless; owner DEV3-012 — ledger D2).

## 7. Oracle Ruling — Contrast With Plans + Anti-Copy-Paste Warning

**Sessions are sensitive ⇒ collapse.** A session row reveals balances, counterparty identity, and lifecycle state — all private to its two participants. Therefore, on **every** read and mutation: a foreign id and a nonexistent id are **indistinguishable** — `sessionById` resolves to the identical `null` (no error), and transition denials for foreign/nonexistent/non-participant targets (including parents and admins) throw the byte-identical `NotFoundError("SESSION")` shape. Error text never contains the other party's identity, balances, or governance state. This is a deliberate inversion of the plan-catalog ruling and it applies to the *mutation* denials too, not just reads.

**Plans are public ⇒ `NOT_FOUND` for a nonexistent plan is fine.** The plan catalog (DEV1-005) is marketing data readable by anonymous visitors; distinguishing "doesn't exist" from "exists but inactive" leaks nothing there, so that ticket's stricter oracle posture is unnecessary for its domain.

> **ANTI-COPY-PASTE WARNING.** These two rulings are structurally symmetric and semantically opposite — this is exactly the pair that gets copied between tickets by accident. When adding any read or mutation over `session`: foreign ≡ nonexistent, always. Do NOT import the plan-catalog posture into the session domain (a distinguishable "session exists but you can't see it" is a disclosure bug), and do NOT import the session collapse into a genuinely public catalog (it needlessly destroys legitimate UX). The one documented exception here: on `createSession` the *teacher-target* entity keeps a distinguishable oracle (`TEACHER_NOT_FOUND` vs `TEACHER_NOT_CERTIFIED`) because teacher existence becomes public with the DEV3-008 directory — the denial is for the booking caller's legitimate UX. Sessions themselves stay fully collapsed.

## 8. `is_online` Deferral Note (D3)

`teacher.is_online` defaults `false` and NO surface to set it exists until DEV2-011 (Sprint 2). Asserting availability in Sprint 1 would make ALL bookings impossible. DEV3-004 therefore asserts **certification only** (INV-S5) and records the `is_online` assertion + teacher-directory wiring as deferred item **D3** with owning tickets **DEV3-008 / DEV2-011**. Consequence: the directory is not shipped in this slice either — no session-creation UI route exists (D4 → DEV3-009); `createSession` is exercised by tests/journeys and consumed by the future directory. When DEV3-008 lands the directory, revisit the teacher-target oracle note in §7 if the public-data contract changes.

## 9. Battle-Tested Gotchas — What NOT to Repeat

Each of these was found or proven during DEV3-004's review waves; all are load-bearing.

- **(a) Replay-throw, not replay-return.** The service must THROW `DUPLICATE_REQUEST` on a replayed key (§6). Returning the pre-existing row from the service would skip the rollback that cancels the replay's own debit-ladder writes — a second allowance unit silently burned on the retry path. The 409-to-info-notice mapping lives in the client (`mapGraphQLErrorByCode` → `duplicateBookingInfo`), never in the resolver/service.
- **(b) Session-id shape guards (REQ-054).** The GraphQL boundary parses `ID` shape-only (`Number(args.id)`), so every service entry point must guard the target id **pre-DB**: `assertPositiveSafeSessionId` at the top of `startSession`/`completeSession`/`cancelSession` (→ `VALIDATION`/422, before the governance probe — a garbage id never spends a read), and `getSessionById` short-circuits malformed ids to the same oracle-safe `null`. Without the guard, `"12abc"` reaches SQL as `NaN` → PG `22P02` → a masked 500 instead of the mandated `VALIDATION`-or-`null`.
- **(c) `FORBIDDEN` via the `ForbiddenError` class.** Governance/authorization denials throw `new ForbiddenError(t.forbidden)` (`extensions.code = "FORBIDDEN"` → 403 via the taxonomy) — not `ConflictError("FORBIDDEN", …)`, even though the wire is identical. The class is the semantic record; a Conflict class carrying an authorization denial misdescribes the code for every reader and future grep.
- **(d) Exhaustive Pothos enum mappers — no silent default.** The DB-string → TS-enum mappers (`toSessionStatus`/`toSessionType`/`toSessionIntent` in `session.pothos.ts`) take the canonical row-column literal unions as scrutinees, have one case per pgEnum member, NO `default`, and end with the `const exhaustive: never = …; throw` idiom. A future pgEnum member without a case fails `tsgo` with TS2322 — compile-guarded drift instead of a silent runtime `null`.
- **(e) Happy-DOM portal-input limitation (D8/D9) — verify in a real browser.** React 19 + Happy DOM do not deliver dispatched input events into the MUI Dialog portal (a controlled textarea's `onChange` never fires), and cache-surgery arms (`cache.modify` filter + `evict` + `gc()`) running under an active `useQuery` observer deterministically OOM bun (exit 137, even isolated). The affected component-suite branches are `test.skip` with FULL bodies intact (one-line flip to re-enable); the compensating control is the real-Chromium agent-browser loop, which verified both flows in the app's favor (4.2.BF/4.3.BF). Don't "fix" the app code for a runner-tier artifact, and don't re-triage the skips without reading the D8/D9 ledger rows.
- **(f) `FOR UPDATE` cannot block on uncommitted INSERTs (READ COMMITTED).** A locking read only serializes against **committed** rows — another transaction's uncommitted INSERT is simply invisible, so a "concurrency" test that locks a fixture created inside the same uncommitted transaction proves nothing about cross-connection contention. Concurrency tests must create the fixture in a COMMITTED transaction (tracked + hard-deleted in `afterAll`), park a holder on a gate (`Promise.withResolvers`), probe the waiter with `Promise.race` (blocked ⇒ pending after a window), then release via commit — and release idempotently in `finally` so an assertion failure can't deadlock the suite. Same-client `runInRollback` serialization is the honest shape for *predicate-semantics* chaos (the guarded `> 0` UPDATE), not for lock behavior.

## 10. Consumer Guidance

| Ticket | What it must (and must not) do with this slice |
|---|---|
| **DEV3-005** (INV-S6/S7/S8 enforcement, status history, dispute surface) | **Extend** the guarded primitives in `SessionRepository` — never duplicate or fork them. Owns: in-session `is_online=false` lock (with DEV2-011/012), report/homework gating, the `disputed` transition (B.18), and persisting the cancel `reason` this slice validates-then-discards. |
| **DEV3-006** (reports) | INV-S7 gating is DEV3-005's; reports hang off `session_id` (C.4 removed the redundant teacher FK). One recitation per session (C.5) — write it via DEV3-007's surface, never from the lifecycle. |
| **DEV3-011** (notifications) | Wire notifications at the document seams WITHOUT making this ticket's flows depend on the notification engine. Zero `notifications` rows are written here (D1) — keep it that way until your ticket owns the emitters. |
| **DEV3-012** (dual confirmation + 24h auto-cancel sweeper) | Student confirm flips `fee_held=false` and credits the wallet (same tx discipline as §4). The timeout sweeper **reuses this slice's same-lane refund primitive** (read `held_balance_lane` from the row, `incrementLane` the same lane, once). The deadline is never re-armed anywhere — B.2. |
| **DEV3-013** (wallet credit / finalize) | Consume `fee_held` + `held_balance_lane` EXACTLY as defined (§4). Plan-linked pricing replaces the interim constant fees (`SESSION_FEE_*` in `shared/constants/session-fees.constants.ts` = `"25.00"` decimal strings, EGP) — a recorded forward contract; until then do not add per-plan fee inputs to the wire. |
| **DEV3-021** (admin governance surface) | Ship the admin surface under its OWN authScopes; today admins get `FORBIDDEN` on role-gated ops and the oracle `SESSION_NOT_FOUND`/`null` like any non-participant — no bypass exists. Honors the REQ-030 sensitivity ruling (§7). |
| **DEV2-016** (ratings) | Treat `confirmedByTeacherAt` + `status` as the rating-eligibility substrate — read-only consumption; do not add write surfaces to the lifecycle to support it. |

## 11. Rollout Summary

**Shipped in DEV3-004:** `SessionLifecycleService` (`backend/services/classes/session-lifecycle.service.ts` — 7 public methods; the sole owner of the state machine), `SessionRepository` (guarded transitions + probe + participant reads), `TeacherRepository.lockForCertificationCheck` (FOR UPDATE lock), `StudentRepository.decrementLaneIfAvailable`/`incrementLane` (guarded ladder + refund), `SessionRequestIdempotencyRepository` (claim trio), schema deltas `session.held_balance_lane` + `session_request_idempotency` (push-only), the 7-operation GraphQL surface (3 queries + 4 mutations, participant-scoped, `$all` conjunctions where a role leg exists), the `HeldBalanceLane` enum + guard, the platform fee constants, i18n (7 flat error keys + the `sessions` UI namespace), and the `/student/sessions` + `/teacher/sessions` pages. Verification: 370-test battery across 20 files (0 fail, 12 known runner-tier skips per D8/D9), twice-green journey suites on real services, 100% statement/branch coverage on all new service/repo/helper code, and compile/lint baseline delta = 0.

## 12. Related Documents

- `docs/specs/state-machine-invariants.md` — the canonical invariant registry (INV-S\*, INV-B\*, INV-W\*, INV-U\*, INV-TV\*) this implementation binds to.
- `docs/specs/open-decisions-and-gaps.md` — decisions A.8/A.10/B.2/B.3/B.4/B.18/C.5 + the DEV3-004 implementation addendum (hold-as-debit, interim fees, `is_online` deferral, claim table + sweeper, sessions-are-sensitive ruling).
- `docs/IDEMPOTENCY.md` — the idempotency mandate this claim table extends to session booking; `docs/graphql/error-handling-contract.md` — the `DUPLICATE_REQUEST` → success-equivalent client mapping (REQ-065).
- `docs/graphql/domain-error-extensions-code.md` + `docs/graphql/api-gateway-and-routing.md` — the DomainError contract, taxonomy, and gateway registration rules the lifecycle surface consumes.
- `docs/auth/jwt-authentication-service.md` — the `authScopes` contract (`authenticated`/`role`/`$all`) and the 401-vs-403 split; governance fail-closure lives at the login/SSR boundary, not in the GraphQL context.
- `docs/backend/cross-stream-contracts.md` — `SessionRequestContract` (feeHeld literal, non-null fee/deadline, idempotency key) the creation insert statically conforms to.
- `docs/students/free-trial-provisioning.md` — the `balance_trial` lane + grant-once pattern the trial-first ladder builds on; `docs/teachers/applicant-lifecycle.md` — the INV-TV1 applicant context behind the unconditional teacher ban on `createSession`.
- `docs/planning/TEAM_ALLOCATION.md` — Contract 1 phrasing superseded by §4 (kept for history only).
- Plan of record: `ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/` (specs REQ-080/081/082, outcomes, deferred-items ledger D1–D10).
