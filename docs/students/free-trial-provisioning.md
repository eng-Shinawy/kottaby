# Free Trial Session Provisioning — Canonical Reference

**Domain:** Students / Acquisition & onboarding
**Status:** Implemented and verified (DEV1-004)
**Source of truth for:** the one-time free-trial-credit grant mechanic, the dedicated `balance_trial` lane, the grant-once atomic UPDATE, the forward booking-eligibility & decrement contract for DEV3, and the security posture that keeps the trial out of low-privilege hands.

This document is the single canonical reference for how the platform credits one free trial session to every newly registered student. Future developers touching the student balance family, the registration transaction, or the downstream booking/escrow flows MUST read this document before adding any new balance lane, exposure mutation, or admin grant surface.

---

## 1. Why a Free Trial, and Why a Dedicated Lane

The free trial session is the platform's primary top-of-funnel acquisition mechanic, anchored in functional requirement **FR-2.6** ("New students can receive an initial free trial session credited to their balance"). Without it, the registration flow is a dead-end until a parent or student purchases a Hifz/Tajweed subscription, which also breaks the pedagogical model documented in [`docs/workflows/03-session-lifecycle-escrow.md`](../workflows/03-session-lifecycle-escrow.md) — the first session with a new student is a diagnostic Tas-heeh session, which by design should not require a paid commitment up front. Crediting the trial at registration gives the student a real session with a certified Sheikh before any money changes hands, which is the trust-building mechanism the parent needs in order to convert.

The trial credit lives in a **dedicated, segregated `balance_trial` lane** on the `students` row, paired with a `trial_granted_at` marker column. The dedicated-lane ruling (recorded in [`docs/specs/open-decisions-and-gaps.md`](../specs/open-decisions-and-gaps.md)) is not arbitrary: a trial credit is structurally different from any paid credit, and conflating them would silently erode three canonical invariants at once. Specifically, **INV-B5** (paid-lane segregation) is kept pure because a trial is never a Hifz purchase — crediting `balance_hifz` with a trial would dilute the semantic meaning of that column for every consumer that reads it. **INV-B2** (subscription-bound crediting) is preserved because paid crediting is tied to subscription activation, while a trial has no associated `subscriptions` row, no payment, and no validity window — so it cannot ride on the same crediting path. And the **conversion-analytics separability** goal is preserved because Admin can cleanly distinguish granted trials from paid credits at query time (`SELECT count(*) FROM students WHERE trial_granted_at IS NOT NULL`), which is the foundation of the M3 trial-funnel dashboard (trials granted → trials consumed → trials converted to paid). All three reasons collapse to a single architectural commitment: the trial has its own lane.

---

## 2. The Grant-Once Pattern (Guarded Conditional UPDATE)

The grant is a **single conditional SQL statement** that combines predicate evaluation and column mutation in the same atomic operation. The repository method `StudentRepository.grantFreeTrialOnce(studentId, trialCount, tx?)` in `backend/db/repo/students/student.repository.ts` issues exactly this statement:

```ts
const updated = await queryDb
  .update(students)
  .set({
    balanceTrial: sql`${students.balanceTrial} + ${trialCount}`,
    trialGrantedAt: new Date(),
  })
  .where(and(eq(students.id, studentId), isNull(students.trialGrantedAt)))
  .returning({ id: students.id });
return updated.length > 0;
```

The `trial_granted_at IS NULL` predicate IS the atomicity mechanism. PostgreSQL's MVCC row lock guarantees that two concurrent grant attempts on the same `students` row serialize: the first writer commits, sets `trial_granted_at = now()`, and increments `balance_trial`; the second writer, after waiting on the row lock, re-evaluates the predicate against the now-committed row, finds `trial_granted_at` non-null, matches zero rows, and returns an empty `RETURNING` set. The service `StudentTrialService.grantFreeTrial` in `backend/services/students/student-trial.service.ts` then converts that empty result (`updated.length === 0` → `false`) into a localized `ConflictError` with `extensions.code = "CONFLICT"` and the `trialAlreadyGranted` message from the compile-time i18n system. The **TOCTOU window is zero by construction** — there is no `SELECT … FOR UPDATE`, no advisory lock, no SELECT-then-UPDATE read-modify-write sequence; the predicate and the mutation are inseparable inside one UPDATE statement. No advisory lock infrastructure is needed because the conditional UPDATE already serializes would-be double-grants; no `SELECT FOR UPDATE` is needed because the only thing the SELECT would do (re-check `trial_granted_at`) is already re-evaluated atomically by the UPDATE under the row lock.

The grant is invoked from exactly one call site today: the `student` branch of `RegistrationService.registerUser`'s `createRoleChild` helper, after the `students` row has been inserted via `StudentRepository.createForRegistration`. The grant shares the surrounding `withTransaction(outerTx)` SAVEPOINT-aware scope, so if any later step in the registration flow throws (e.g., a child-row insert failure), the entire transaction rolls back — the `users` row, the `students` row, and the trial grant UPDATE all disappear atomically. The grant is never wrapped in a `try/catch` that swallows exceptions: it is a first-class step of registration, not a best-effort side effect, because swallowing on the happy path would silently violate the acquisition contract.

---

## 3. Forward Contract for DEV3 (Booking & Escrow)

DEV1-004 ships only the grant; the eligibility check and decrement execution belong to the DEV3 booking and escrow verticals (`DEV3-004` session booking, `DEV3-013` escrow crediting). The forward contract recorded here locks in the semantics so DEV3 does not re-litigate balance rules.

### 3.1 Eligibility

A student is eligible to request a session with intent `hifz`/`tajweed`/review when `(<relevant intent balance> > 0) OR (balance_trial > 0)`. This extends **INV-B4** (zero-balance block) without modifying its paid-lane semantics: a student with `balance_trial = 0` AND the relevant intent balance at 0 is still blocked, exactly as before. The trial is an additional eligibility lane, not a replacement for any paid lane.

### 3.2 Trial-first decrement order

When the booking/escrow flow decrements a student's session allowance, it MUST decrement `balance_trial` FIRST whenever `balance_trial > 0`, and only fall through to the relevant paid intent lane (`balance_hifz`/`balance_tajweed`/`balance_reviews`) when the trial has already been exhausted. This is the new invariant **INV-B8** (trial-first consumption). The decrement MUST use the same single-guarded-UPDATE atomicity pattern: `UPDATE students SET balance_trial = balance_trial - 1 WHERE id = ? AND balance_trial > 0` returning a row count, with a separate conditional UPDATE on the paid lane if and only if the trial decrement returned zero rows. This guarantees the trial is always consumed before paid credits, which preserves INV-B5 segregation and keeps the trial-vs-paid analytics clean.

### 3.3 No expiry

The interval-based expiry rule **INV-B3** (subscription validity windows) does NOT apply to the trial lane. The trial is not attached to any `subscriptions` row, so there is no `interval_days` window to expire against. A trial credit persists on the `students` row until consumed by a booking, regardless of how much time has passed since registration. Do not add an expiry sweep that touches `balance_trial` — it would silently violate the contract.

### 3.4 GraphQL exposure rules (future)

The trial balance is NOT exposed via GraphQL in DEV1-004 (no new mutation or query surface was added — verified by schema-diff at [`frontend/graphql/generated/schema.graphql`](../../frontend/graphql/generated/schema.graphql)). When a future ticket surfaces the trial balance over GraphQL, it MUST do so on the canonical `Student` Pothos object pattern with an `id` field present for Apollo cache normalization, use `t.loadable()` / batch service methods per [`docs/graphql/dataloader-batching.md`](../graphql/dataloader-batching.md), and import server types from `@/backend/types` — never a local Pothos type. There is no grant mutation and there must never be one: the grant exists only as an internal service call, never reachable from a low-privilege token.

---

## 4. Anti-Patterns (DO NOT)

These anti-patterns are listed explicitly because each was considered and rejected during the DEV1-004 design. Future developers MUST NOT reintroduce them.

- **NEVER credit `balance_hifz` (or `balance_tajweed` / `balance_reviews`) with trial credits.** The dedicated `balance_trial` lane is the only acceptable target. Crediting a paid lane violates INV-B5 (paid-lane segregation), violates INV-B2 (paid crediting is subscription-bound; a trial has no subscription), and destroys the trial-vs-paid analytics distinction that the M3 funnel depends on.
- **NEVER poll paid lanes for booking eligibility where the trial applies first.** The eligibility check is `paid_lane > 0 OR balance_trial > 0`, and the decrement order is trial-first. Reading paid lanes first and only falling through to the trial as a last resort reverses INV-B8 and silently changes the analytics semantics.
- **NEVER expose a trial grant, top-up, or manipulation mutation via GraphQL.** The grant exists only as an internal service call. There is no admin surface for mercy re-grants in DEV1-004 — BFLA design requires that low-privilege tokens (student/parent/teacher/guest) have no function path to mint trial credits. Any future admin re-grant surface MUST land behind a permission-gated mutation with audit logging via the existing `audit_logs` table (A.5), and MUST reuse `StudentTrialService.grantFreeTrial` as the entry point so the guarded UPDATE enforces grant-once even for admin re-grants.
- **NEVER re-grant via admin UI without auditing.** If an admin re-grant path is ever added, it MUST write an `audit_logs` row with `action_type = 'admin_trial_adjustment'`, `entity_type = 'students'`, `entity_id = <studentId>`, and a `details` JSON containing the prior `trial_granted_at` and the new marker. Unaudited admin adjustments are forbidden because they break the conversion-analytics invariant.
- **NEVER call `StudentRepository.grantFreeTrialOnce` directly from outside `StudentTrialService.grantFreeTrial`.** The service is the single canonical provisioning entry point (this is the structural mechanism that makes grant-once impossible to bypass). Future student-creation flows — failed-applicant conversion (`DEV2-009`), direct admin onboarding (`DEV3-019`) — MUST call `StudentTrialService.grantFreeTrial`, not the repo method.
- **NEVER add a `try/catch` that swallows the grant exception on the registration happy path.** The grant is a first-class step of registration; if it throws, the whole transaction rolls back atomically (the surrounding `withTransaction(outerTx)` SAVEPOINT-aware scope guarantees this). Swallowing would leave a student row with `balance_trial = 0` and `trial_granted_at = NULL` — a silent violation of the acquisition contract.

---

## 5. Rollout Summary

### 5.1 Schema delta

The `students` table gained exactly two new columns and one new CHECK constraint, all defined in `backend/db/schema/students/students.ts`:

```ts
balanceTrial: integer("balance_trial").notNull().default(0),
trialGrantedAt: timestamp("trial_granted_at"),
// table checks array:
check("students_balance_trial_check", sql`${t.balanceTrial} >= 0`),
```

`balance_trial` is `NOT NULL DEFAULT 0` — stricter than the legacy nullable balance lanes, so the inferred `StudentSelectType.balanceTrial` is `number` (not `number | null`). `trial_granted_at` is a bare nullable timestamp with no default; it is set server-side only when the grant first executes. The CHECK constraint `students_balance_trial_check` enforces `balance_trial >= 0` at the database layer (defense in depth — even a buggy future code path or an ops script cannot drive the lane negative), and it is the live-DB guard that backs INV-B1 for the trial lane. No new enums, no new tables, no new indexes.

### 5.2 Push-only discipline

The schema change was applied exclusively via `bun run db push` (the repo's `db reset` and `db cleanGenerate` commands are permanently disabled by policy — see [`docs/DATABASE_MIGRATIONS.md`](../DATABASE_MIGRATIONS.md)). No custom SQL migration file was authored. The Drizzle schema in `backend/db/schema/` is the sole structural ground truth, and the schema + runtime code landed in the same commit set to prevent schema drift.

### 5.3 Seed parity

The student seed factory (`backend/db/seeds/students/seed-students.ts`) does NOT bypass the production provisioning service. It uses the **find-then-grant-if-null** pattern: for each demo student, it calls `StudentTrialService.findTrialGrantStateByEmail(spec.email)` (a production entry point that resolves the student row by login email), inspects `trialGrantedAt`, and invokes `StudentTrialService.grantFreeTrial(state.studentId, "en")` ONLY when the marker is `null`. This guarantees the seed is (a) production-faithful — the same grant path runs — and (b) idempotent — re-running `bun db seed` on an already-granted demo student logs `"Demo student already has trial grant, skipping"` and skips the grant, so the `ConflictError` from the guarded UPDATE never fires during a seed run.

### 5.4 Sizing constant

The trial count is the shared constant `FREE_TRIAL_SESSION_COUNT = 1` in `shared/constants/free-trial.constants.ts`, re-exported through `shared/constants/index.ts`. It is the single source of truth for trial sizing — never duplicated as a magic literal in service code, never read from an env var, never accepted as a client-supplied field. The constant lives in the shared layer (zero imports from `@/backend/**`, `@/frontend/**`, or `@/app/**`) so any future consumer — the DEV3 booking flow, a future admin dashboard, a future frontend trial-balance badge — can import it without violating layer isolation.

---

## 6. Related Documents

- [`docs/auth/user-registration.md`](../auth/user-registration.md) — Registration canonical reference; the trial grant is wired into the `student` branch of `createRoleChild` inside the registration transaction (see §3 Atomicity Transaction Pattern).
- [`docs/specs/state-machine-invariants.md`](../specs/state-machine-invariants.md) — Balance invariants §4.2; **INV-B7** (grant-once marker) and **INV-B8** (trial-first decrement) are recorded there, alongside the INV-B1 structural extension (4th non-negative lane), the INV-B3 explicit non-application to the trial lane, and the INV-B4 eligibility extension.
- [`docs/specs/open-decisions-and-gaps.md`](../specs/open-decisions-and-gaps.md) — Trial-placement decision resolution (dedicated `balance_trial` lane, NOT `balance_hifz`) per FR-2.6, with the three-point rationale (INV-B5 purity, INV-B2 subscription-binding, analytics separability).
- [`docs/workflows/03-session-lifecycle-escrow.md`](../workflows/03-session-lifecycle-escrow.md) — Session lifecycle & escrow canonical workflow; the trial exists to enable the first-session (Tas-heeh) diagnostic model documented there.
- DEV1-002 outcomes (`ai/plans/sprint_0/dev1-002-*/outcome/`) — The registration transaction pattern, BOPLA whitelist, SAVEPOINT-aware test isolation, and 23505→ConflictError cause-chain traversal that the trial grant inherits unchanged.
