# Plan — Failed Applicant → Student Record Conversion

> **Plan directory:** `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/`
> **Ticket:** `Failed Applicant → Student Record Conversion` — `docs/planning/TICKETS.md:872-912`
> **Owner stream:** Dev 2 · **Milestone:** 1 · **Story points:** 3
> **Blocked by:** `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` — plan at
> `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/` (**not yet implemented**).
> That blocker's own blocker (`Evaluation Rubric Scoring`) IS shipped and archived at
> `ai/finished_plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`.
> **Plan kind:** backend-only slice — **zero schema delta**, one new repo method, one new service namespace,
> two call-sites in the rubric finalization helpers, one journey test, documentation propagation.
> **UI ruling (explicit):** NO new routes, NO nav items, NO Apollo documents, NO frontend surfacing.

---

## 1. Purpose & Scope

When a teacher applicant fails the 5-session evaluation rubric cycle, this ticket makes the failure
finalization **atomically** (a) create the `students` role-child row for the applicant's user id
(shared PK = `users.id`) with zeroed balances and a fresh unique `handshake_code`, and (b) flip
`users.role` from `teacher` → `student`, so that the failed applicant satisfies **INV-TV6** — they
retain student privileges (subscribe to plans, attend sessions) during the cooldown. The `applicants`
row is left **untouched** (`status='failed'`, `cooldown_until` already stamped by the shipped rubric
fail path) so re-evaluation tracking and the audit trail survive.

When a converted student later passes (rubric re-evaluation pass **or** admin cold-start
certification), the role is restored `student` → `teacher` atomically; the `students` row is
**preserved** as historical data, and the existing pass path already inserts the `teacher` row and
sets `applicants.status='passed'`.

**In scope**

| # | Deliverable |
|---|---|
| S1 | One new guarded repo method `UserRepository.transitionRoleOnce(userId, fromRole, toRole, tx)` |
| S2 | One new service namespace `ApplicantConversionService` (`convertToStudent`, `restoreTeacherRole`) |
| S3 | Two call-sites wired into `evaluation-rubric.helpers.ts` (`finalizeRubricFail`, `finalizeRubricPass`) |
| S4 | One cross-actor journey test `test/workflows/teachers/applicant-student-conversion.journey.test.ts` |
| S5 | Documentation propagation (`docs/teachers/applicant-lifecycle.md` §2.5, stale line `docs/teachers/evaluation-rubric-scoring.md:162`) |

**Out of scope (ruled out explicitly)**

| Ruled out | Reason |
|---|---|
| Schema migration / `bun run db push` | Zero delta — every column and index already exists (see §4). |
| Widening student-gated resolvers to admit `teacher`-role callers | Rejected alternative — see **D1**. |
| `myApplicantProfile` scope widening | Deferred cross-plan — see **D6** and `deferred-items.md` D1. |
| Audit-log row for the conversion | Deferred — see **D7** and `deferred-items.md` D2. |
| Forced session/token invalidation on the flip | Deferred-by-design (self-heals) — see **D9** and `deferred-items.md` D3. |
| Frontend surfacing | Deferred to child ticket — `deferred-items.md` D5. |

---

## 2. Binding References (read before implementing)

| Layer | Path | Why |
|---|---|---|
| Root | `AGENTS.md` | Layer separation, i18n rules, quality workflow, no `console.*`. |
| Backend | `backend/AGENTS.md`, `backend/services/AGENTS.md`, `backend/db/repo/AGENTS.md` | Service/repo rules; repo = data access only; no service `.types.ts`. |
| Shared | `shared/AGENTS.md` | Locale parity tests; constants live in `shared/`. |
| Workflow tests | `test/workflows/AGENTS.md` | Journey conventions: real services + real DB, committed fixtures, tracked `afterAll` cleanup, NO `runInRollback`. |
| DB tests | `backend/db/test/AGENTS.md` | `runInRollback`, `tx` to every repo call, entity-setup helpers. |
| Specs | `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` | FR-1.2, FR-3.6, INV-TV6. |
| Domain docs | `docs/teachers/applicant-lifecycle.md`, `docs/teachers/evaluation-rubric-scoring.md` | Conversion co-existence contract; the stale sentence this ticket supersedes. |

---

## 3. Architecture Overview

The conversion is **not** a new transaction — it joins the transaction the rubric service already
opens. The shipped fail path already runs inside a single DB transaction that gates the session,
checks quorum, computes the verdict, calls `finalizeRubricFail`, then emits the in-tx notification.
This ticket extends `finalizeRubricFail` (and `finalizeRubricPass`) by one service call each.

```
rubric submission (service tx opens)
  └─ submitRubricEvaluationInTx  (backend/services/teachers/evaluation-rubric.helpers.ts:473-518)
       ├─ session gate → … → quorum
       ├─ verdict = FAIL
       │    └─ finalizeRubricFail(applicantUserId, cooldownUntil, tx, t)   ← AMENDED
       │         ├─ ApplicantRepository.transitionToFailed(...)            (unchanged — the verdict)
       │         └─ ApplicantConversionService.convertToStudent(userId, tx) [NEW]
       │              ├─ StudentRepository.findHandshakeCodeByStudentId(userId, tx)  (idempotency read)
       │              ├─ createStudentWithHandshakeRetry(userId, tx, …)   [REUSED]
       │              └─ UserRepository.transitionRoleOnce(userId, Teacher→Student, tx)  [NEW]
       └─ verdict = PASS
            └─ finalizeRubricPass(applicantUserId, tx, t)                  ← AMENDED
                 ├─ TeacherRepository.insertColdStartCertified / elevate    (unchanged)
                 ├─ ApplicantRepository.finalizeOnCertification(...)        (unchanged)
                 └─ ApplicantConversionService.restoreTeacherRole(userId, tx)  [NEW]
                            └─ UserRepository.transitionRoleOnce(userId, Student→Teacher, tx)
```

**Atomicity contract (D2, D10):** the whole block runs in the caller's transaction. A
`handshakeExhausted` `ConflictError`, a role-UPDATE failure, or a `transitionToFailed` miss rolls the
verdict back — the DB never records a failure whose student conversion did not commit, and vice
versa.

**Data flow touched**

| Step | Surface | Type |
|---|---|---|
| In | `submitRubricEvaluationInTx` (existing tx) | Pothos mutation `submitRubricEvaluation` (no SDL change) |
| Write | `students` insert (new) | SQL INSERT via reused helper |
| Write | `users.role` guarded UPDATE (new) | SQL UPDATE via new repo method |
| Write | `applicants.status` guarded UPDATE (unchanged) | SQL UPDATE |
| Read | `students.handshake_code` existence (new call, existing method) | SQL SELECT |

**SDL neutrality (asserted):** the role flip writes a column the JWT carries; it introduces no new
GraphQL field, argument, or type. `bun run generate:gqlSchema` + `bun codegen` are **not required**
(this is asserted as a Task 6 verification step; the plan's tasks will fail fast if a schema diff
appears). See **D8**.

---

## 4. Zero-Schema-Delta Evidence

Every column, index and constraint the conversion needs already exists. No migration is authored and
`bun run db push` is **not** run.

| Need | Existing artifact | Evidence |
|---|---|---|
| `users.role` single pgEnum column | `role: userRole("role").notNull()` | `backend/db/schema/users/users.ts:19` |
| `user_role` enum membership | `pgEnum("user_role", ["admin","teacher","student","parent"])` | `backend/db/schema/enums.ts:8` |
| `students` shared PK → `users.id` | FK ON DELETE CASCADE | `backend/db/schema/students/students.ts:16-46` |
| Zeroed balances | `balanceHifz`/`balanceTajweed`/`balanceReviews` default 0 | `backend/db/schema/students/students.ts:16-46` |
| Trial balance | `balanceTrial` NOT NULL default 0 | `backend/db/schema/students/students.ts:16-46` |
| `parent_id` NULL | FK SET NULL, nullable | `backend/db/schema/students/students.ts:16-46` |
| Unique handshake code | `handshakeCode` varchar(50) NOT NULL + unique index `students_handshake_code_unique` | `backend/db/schema/students/students.ts:40` |
| Balance non-negativity | CHECK `balance_* >= 0` | `backend/db/schema/students/students.ts:42-45` |
| `applicants.status` / `cooldown_until` | present, typed varchar(50)/timestamp | `backend/db/schema/teachers/applicants.ts:13-30` |
| `teacher` row insert on pass | shared-PK row already written by pass path | `backend/db/schema/teachers/teacher.ts` |

**Conclusion:** D8 holds — the ticket is schema-neutral. The only migration-free risk is a
handshake-code unique collision, handled by reuse of the bounded retry helper (D4).

---

## 5. REQ → Design Coverage Map

Every requirement in `specs.md` maps to exactly one or more design decisions and tasks below.

| REQ | Title | Owning design decision(s) | Owning task(s) |
|---|---|---|---|
| REQ-001 | Pre-Implementation Baseline & Outcome Protocol | §13 Outcome protocol | Task 0 |
| REQ-002 | Translation & Enum Compliance | D4, §9 i18n plumbing | Task 4 |
| REQ-003 | Student Record Creation on Failure (zeroed balances + unique handshake) | D2, D3, D4 | Task 1, 2, 3 |
| REQ-004 | Applicants Record Preservation | D2 | Task 3 |
| REQ-005 | Role Transition `teacher` → `student` (INV-TV6) | **D1**, D9 | Task 1, 2, 3, 6 |
| REQ-006 | Atomicity, Idempotency & Concurrency | D2, D3, D10 | Task 1, 2, 3 |
| REQ-007 | Re-Certification → Teacher Role Restoration | D5 | Task 2, 3 |
| REQ-008 | Student Privileges During Cooldown | D1, D9 | Task 6 |
| REQ-009 | Cross-Actor Journey Test | §11 test strategy | Task 5 |
| REQ-010 | Security & Tenancy Assurance | §12 | Task 1, 2, 6 |
| REQ-011 | Knowledge Propagation & Documentation | §14 | Task 8 |

---

## 6. Design Decisions

### D1 — Role flip `teacher` → `student` (vs scope widening) — **bisected decision record**

**Status:** ACCEPTED.

**Context.** INV-TV6 (`docs/specs/state-machine-invariants.md:92`) states a converted failed applicant
"retains student privileges (can subscribe to plans and attend sessions) during the cooldown period."
FR-1.2 (`docs/specs/functional-requirements.md:18`) states "A user has exactly one role;
role-specific data lives in the corresponding child table." `users.role` is a single `user_role`
pgEnum (`backend/db/schema/enums.ts:8`).

**Evidence — every student surface is gated `role: [UserRole.Student]` on the wire:**

| Surface | File:line | Scope |
|---|---|---|
| `purchaseSubscription` | `backend/graphql/mutation/subscription-purchase.mutation.ts:63` | `$all: { authenticated: true, role: [UserRole.Student] }` |
| `createSession` | `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119` | role `[UserRole.Student]` |
| `myStudentSessions` | `backend/graphql/query/classes/session-lifecycle.query.ts:193` | role `[UserRole.Student]` |
| handshake self-read | `backend/graphql/query/students/handshake-code.query.ts:63` | role `[UserRole.Student]` |
| student homework / student evaluation | student-gated resolvers | role `[UserRole.Student]` |

**Option A (CHOSEN) — flip `users.role` to `student`.** The account's single role becomes `student`
for the cooldown window. Every student-gated resolver admits the caller **without any change to
shipped, test-locked resolvers**. INV-TV6 is satisfied by construction. Re-apply still works because
`purchaseVerificationPlan` is `authenticated`-only
(`backend/graphql/mutation/verification-plan-purchase.mutation.ts:50`) and its 422
`APPLICANT_COOLDOWN_ACTIVE` carries the cooldown expiry. On re-certification the role is restored
(D5).

**Option B (REJECTED) — keep `role=teacher`, widen each student-gated resolver to admit teacher-role
users who own a `students` row.** Rejected because:

| Rejection axis | Detail |
|---|---|
| Blast radius | ≥5 shipped, test-locked resolvers would need a new union predicate + a `students`-row existence check per request. |
| Scope invariants | The `role:` scopes are "student-only" by design; admitting teachers breaks the invariant that role scopes map 1:1 to `users.role`. |
| Effort | Far beyond 3 SP; each widened resolver needs its own tests + security review. |
| Semantics | Contradicts FR-1.2's "exactly one role" — a teacher-role user owning a `students` row is a two-role hybrid the model forbids. |

**Consequence.** A converted student can no longer read `myApplicantProfile` (Teacher-only) — see
**D6**.

### D2 — Conversion runs INSIDE the existing rubric finalization transaction

**Status:** ACCEPTED. The conversion is spliced into the *same* `tx` that `submitRubricEvaluationInTx`
already holds (`backend/services/teachers/evaluation-rubric.helpers.ts:473-518`). No nested top-level
transaction, no second connection, no post-commit hook. This makes the verdict and the conversion a
single atomic unit (D10). The `students` insert reuses the caller's transaction via the required-`tx`
signature of `StudentRepository.createForRegistration`
(`backend/db/repo/students/student.repository.ts:163-185`).

### D3 — Idempotency: existence-read + guarded role UPDATE

**Status:** ACCEPTED. Before inserting, read `StudentRepository.findHandshakeCodeByStudentId(userId, tx)`
(`backend/db/repo/students/student.repository.ts:198-214`). If a handshake code already exists the
student row is present → skip the insert (a re-conversion after a second failure is a safe no-op). The
role flip is always expressed as the guarded `transitionRoleOnce` (a `WHERE role = <fromRole>`
predicate), so replaying the conversion finds `role` already `student` and matches zero rows — never
double-applying. `createForRegistration` is a plain insert with no `ON CONFLICT` (so the existence-read
is the required guard).

### D4 — Reuse `createStudentWithHandshakeRetry` (DRY)

**Status:** ACCEPTED. `createStudentWithHandshakeRetry(userId, tx, boundary, buildExhaustedError)`
(`backend/services/shared/user-provisioning.helpers.ts:118-160`) already owns the `KSB-XXXXXXXX`
generation (`:43`) and the bounded `HANDSHAKE_RETRY_LIMIT = 5` collision retry with
`isUniqueViolation` (`:54`). Registration calls it at
`backend/services/auth/registration.service.ts:105-110`; the admin path at
`backend/services/admin/user-management.service.ts:80`. The conversion passes `boundary = "evaluation
conversion"` and `buildExhaustedError = cause => new ConflictError("HANDSHAKE_EXHAUSTED", t.errors.handshakeExhausted, { cause })`. **No duplicated retry loop.**

### D5 — Re-certification restores `student` → `teacher`

**Status:** ACCEPTED. Both the rubric re-evaluation pass (`finalizeRubricPass`,
`backend/services/teachers/evaluation-rubric.helpers.ts:342-374`) and admin cold-start certification
(the admin path that reaches the same pass finalization) call
`ApplicantConversionService.restoreTeacherRole(userId, tx)`, which issues the guarded
`transitionRoleOnce(userId, Student→Teacher, tx)`. For a never-converted applicant whose role is
already `teacher`, the guarded UPDATE matches zero rows → no-op. The `students` row is preserved
(historical data). The existing pass path already inserts the `teacher` row and calls
`finalizeOnCertification` (`backend/db/repo/teachers/applicant.repository.ts:507-530`), setting
`status='passed'` and clearing the cooldown.

### D6 — `myApplicantProfile` gate left Teacher-only; widening deferred (cross-plan)

**Status:** ACCEPTED (deferral). `myApplicantProfile` is Teacher-only
(`backend/graphql/query/teachers/applicant.query.ts:59`). After the flip a converted student cannot
read it, so the sibling Cooldown plan's derived `cooldownState` read-model becomes unreachable for
converted students. Decision for THIS ticket: **leave the gate unchanged** (minimal blast radius on
shipped, test-locked surfaces) and log a deferred item to widen `myApplicantProfile` to
`[UserRole.Teacher, UserRole.Student]` (safe — the service returns `null` for a caller with no
`applicants` row, see `backend/services/teachers/applicant-lifecycle.service.ts:142-181`). Re-apply
remains fully functional without it. Cross-referenced with the Cooldown plan. Tracked in
`deferred-items.md` **D1**.

### D7 — Audit-log row for the conversion DEFERRED

**Status:** ACCEPTED (deferral). The conversion is a governance-relevant role change and would
normally warrant an `audit_logs` row. This ticket does **not** write one; the audit-completeness
stream owns the audit surface. Tracked in `deferred-items.md` **D2**. The conversion still emits a
`logger.logDomainError` / `logger.info` domain event (no `console.*`).

### D8 — Zero schema delta — no migration

**Status:** ACCEPTED. See §4 for the column-by-column evidence. `bun run db push` is **not** run; no
`.sql` migration is authored; `drizzle-kit generate` would produce an empty diff.

### D9 — JWT role staleness self-heals on token refresh

**Status:** ACCEPTED. The Pothos `role` scope reads `ctx.role` from the JWT claim
(`backend/graphql/pothos/builder.ts` — "role comes exclusively from `ctx.role`"), so immediately after
the flip an in-flight access token still carries `teacher`. **No forced logout or revocation is
required:** `AuthService.refreshToken` re-reads the DB user row and re-signs the access token with the
CURRENT DB role (`backend/services/auth/auth.service.ts:257`), so the new role takes effect on the
next silent token refresh. Login likewise signs with `user.role` (`backend/services/auth/auth.service.ts:184`).
The consequence — a short-lived window where the converted student's cached token still asserts
`teacher` — is acceptable and documented. Forced invalidation is deferred (`deferred-items.md` **D3**).

### D10 — Fail-closed: conversion failure rolls back the verdict

**Status:** ACCEPTED. Because the conversion shares the verdict transaction (D2), any thrown error —
the `handshakeExhausted` `ConflictError` from D4, a connection error on the role UPDATE, or a
`transitionToFailed` miss (the existing `APPLICANT_ALREADY_FINALIZED` `ConflictError`) — aborts the
whole transaction. The DB never commits a `failed` verdict without the matching `students` row and
`student` role, nor a `passed` verdict without the restored `teacher` role (for a converted account).

---

## 7. Repository Design — Task 1

**New method:** `UserRepository.transitionRoleOnce(userId, fromRole, toRole, tx)`.

| Aspect | Design |
|---|---|
| SQL shape | Single guarded `UPDATE users SET role = $toRole WHERE id = $userId AND role = $fromRole RETURNING id` |
| Return | `boolean` — `rowcount > 0` (true = the transition applied; false = the guarded predicate missed → idempotent no-op) |
| Concurrency | The `WHERE role = <fromRole>` predicate is the concurrency guard — a concurrent flip cannot double-apply. |
| Parameterization | Always parameterized via Drizzle `eq`/`and`; id and role are bound values, never concatenated; no prepared statement (writes excluded — `docs/drizzle/prepared-statements.md`). |
| `updated_at` | Re-stamps automatically via the column `$onUpdate` hook. |
| Layering | Data access ONLY — no business rule, no role validation (the closed `user_role` pgEnum rejects anything else at the DB boundary as defense-in-depth). Contrast `updateLocale` (`backend/db/repo/users/user.repository.ts:130`), the closest existing guarded-write exemplar. |

**Why a new method:** no role-update method exists in `UserRepository` today (only `create` at `:106`
and `updateLocale` at `:130`). A blind `UPDATE … SET role` would be non-idempotent and would risk
flipping an admin; the `WHERE role = <fromRole>` predicate makes the write self-guarding.

**Repo tests (Task 1):** `runInRollback` + `tx` to every call; assert (a) apply path flips role and
returns `true`; (b) from-role mismatch returns `false` and leaves the row unchanged; (c) target-role
value is persisted verbatim; (d) zero-row id returns `false`.

---

## 8. Service Design — Task 2

**New namespace:** `ApplicantConversionService` (backend service, domain `teachers`). Two exported
functions, both transaction-joining.

| Function | Signature | Behavior |
|---|---|---|
| `convertToStudent` | `(applicantUserId: number, tx: DBTransaction, t: ErrorsTranslations): Promise<void>` | (1) `findHandshakeCodeByStudentId(applicantUserId, tx)` — if non-null, still run step 3 then return (student row exists → idempotent no-op). (2) `createStudentWithHandshakeRetry(applicantUserId, tx, "applicant conversion", cause => new ConflictError("HANDSHAKE_EXHAUSTED", t.handshakeExhausted, { cause }))`. (3) `UserRepository.transitionRoleOnce(applicantUserId, UserRole.Teacher, UserRole.Student, tx)` — a `false` with no prior student row is an internal invariant violation → plain `Error` (not a localized domain error). |
| `restoreTeacherRole` | `(userId: number, tx: DBTransaction): Promise<void>` | `UserRepository.transitionRoleOnce(userId, UserRole.Student, UserRole.Teacher, tx)`; no-op for a caller whose role is already `teacher`. Does NOT touch the `students` row (historical preservation). |

**Layering:** business logic only — delegates every write to a repository. No SQL in the service. No
`.types.ts` file (types live in `backend/types/`; if a return type is ever needed it goes there — see
§9). `t` (errors translations) is threaded from the caller, matching the existing
`finalizeRubricFail(..., t: ErrorsTranslations)` convention — resolvers supply `ctx.t("errors")`.

**Error contract:** the only new throw is the `ConflictError` on handshake exhaustion (reusing the
existing localized `handshakeExhausted` leaf — see §9). All other errors propagate unchanged from the
repositories and are translated by the outer `translateDbError` boundary already wrapping the
submission.

---

## 9. Call-Site Wiring & Types + i18n — Task 3 / Task 4

### Task 3 — wire into the rubric finalization helpers

| Call-site | File:line | Change |
|---|---|---|
| `finalizeRubricFail` | `backend/services/teachers/evaluation-rubric.helpers.ts:384-395` | After the guarded `transitionToFailed` succeeds, call `ApplicantConversionService.convertToStudent(applicantUserId, tx)`. **Amend the docblock** — it currently says "no suspension fields, no role-child rows, no role flips"; it must now say the fail path *does* create the `students` row and flip the role, in the same transaction, both atomic with the verdict. |
| `finalizeRubricPass` | `backend/services/teachers/evaluation-rubric.helpers.ts:342-374` | After `finalizeOnCertification` succeeds, call `ApplicantConversionService.restoreTeacherRole(applicantUserId, tx)`. |

**Ordering is load-bearing.** In the fail path the conversion runs *after* `transitionToFailed`
returns non-null — so a concurrent finalization that matched zero rows throws
`APPLICANT_ALREADY_FINALIZED` *before* any conversion write, and the rollback is clean. In the pass
path `restoreTeacherRole` runs *after* the `teacher`-row insert and `finalizeOnCertification` succeed.

**Task 4 — types + i18n plumbing**

| Need | Decision |
|---|---|
| New return type | Not required — both service functions return `Promise<void>`. No new type in `backend/types/`. |
| New i18n error key | **Not required** — reuse `handshakeExhausted`: `shared/locale/en/errors/index.ts:75` = "Could not generate a unique handshake code. Please try again." and its Arabic parity in `shared/locale/ar/errors/index.ts`. |
| If a key is added | It MUST exist identically in BOTH `ar` and `en`, guarded by the locale parity tests (see `shared/AGENTS.md`). |
| Server text plumbing | `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (single-arg) → `.errorsTranslations.<leaf>`. Resolvers use `ctx.t("namespace")`. |
| Enum compliance | Use `UserRole` from `backend/enum/users/user-role.enum.ts` (`UserRole.Teacher`/`UserRole.Student`) — never string literals. Use `ApplicantStatus` from `backend/enum/teachers/applicant-status.enum.ts`. |
| Forbidden | NO `next-intl`, NO `Translation.` enum, NO two-arg `getTranslations`, NO `console.*`. |

---

## 10. Files Touched

| # | Path | Kind | Change |
|---|---|---|---|
| 1 | `backend/db/repo/users/user.repository.ts` | MODIFY | Add `transitionRoleOnce`. |
| 2 | `backend/services/teachers/applicant-conversion.service.ts` | NEW | `ApplicantConversionService` namespace. |
| 3 | `backend/services/teachers/index.ts` | MODIFY | Add `export * from "./applicant-conversion.service";` (domain barrel — sibling services are barrel-exported). |
| 4 | `backend/services/teachers/evaluation-rubric.helpers.ts` | MODIFY | Two call-sites + docblock amendment. |
| 5 | `backend/db/test/logic/users/user.repository.test.ts` | MODIFY | `transitionRoleOnce` tests — this is the canonical `UserRepository` test file (`runInRollback`, `tx`-threaded, `entity-setup`); a `users` dir does not exist under `backend/db/test/repo/`. |
| 6 | `backend/services/teachers/applicant-conversion.service.test.ts` | NEW | Service tests (co-located, per `backend/services/teachers/*.service.test.ts`). |
| 7 | `backend/services/teachers/evaluation-rubric.service.test.ts` | MODIFY | Assert conversion happens on fail / restore on pass. |
| 8 | `test/workflows/teachers/applicant-student-conversion.journey.test.ts` | NEW | Cross-actor journey. |
| 9 | `docs/teachers/applicant-lifecycle.md` | MODIFY | §2.5 co-existence contract + conversion pointer. |
| 10 | `docs/teachers/evaluation-rubric-scoring.md` | MODIFY | Supersede the stale line `:162`. |
| 11 | `ai/plans/.../outcome/*` (orchestrator-owned) | — | Not authored by this plan. |

**No migration file. No GraphQL SDL file. No frontend file. No locale key added (reuse).**

---

## 11. Test Strategy — Task 5 / Task 6

### Task 5 — cross-actor journey test (write FIRST)

Path: `test/workflows/teachers/applicant-student-conversion.journey.test.ts`. Conventions from
`test/workflows/AGENTS.md`: real services + real DB, committed fixtures, tracked `afterAll` cleanup,
**NO `runInRollback`**; run via `bun test test/workflows`.

| Helper | Path:line | Use |
|---|---|---|
| `createJourneyCast(domain)` | `test/workflows/helpers/journey-fixtures.ts:251` | Register the cast + tracked rows. |
| `catchJourneyError(fn)` | `test/workflows/helpers/journey-fixtures.ts:226` | Assert typed errors (e.g. handshake exhaustion). |
| `provisionStudentActor` | `test/workflows/helpers/actor-context.ts:88` | Re-certified-student actor. |
| `provisionCertifiedTeacherActor` | `test/workflows/helpers/actor-context.ts:105` | Evaluator actors for the 5-session cycle. |
| cleanup | `test/workflows/helpers/journey-cleanup.ts` | `teardown()` + `residueCounts()`. |
| Exemplars | `test/workflows/teachers/verification-plan-purchase.journey.test.ts`, `.../evaluation-rubric-scoring.journey.test.ts`, `test/workflows/admin/cold-start-certification.journey.test.ts` | Pattern to mirror. |

| Scenario | Gherkin | Assertions |
|---|---|---|
| T5.1 | failed applicant gets students record | `students` row exists for the applicant's user id. |
| T5.2 | zeroed balances | `balance_hifz = 0`, `balance_tajweed = 0`, `balance_reviews = 0`, `balance_trial = 0`. |
| T5.3 | handshake code generated | code matches `HANDSHAKE_CODE_PATTERN` (`shared/constants/handshake-code.constants.ts`) and is unique. |
| T5.4 | applicants record preserved | `applicants.status='failed'`, `cooldown_until` stamped, row still present. |
| T5.5 | role flipped | `users.role='student'` after the fail. |
| T5.6 | subscribe + attend during cooldown | `purchaseSubscription` succeeds and a `createSession` (student) succeeds. |
| T5.7 | re-certified applicant has BOTH teacher and student records | after a pass, `teacher` row exists, `students` row preserved, `users.role='teacher'`. |

### Task 6 — role-surface verification + wire tests

| Check | How |
|---|---|
| Student surfaces reachable after flip | assert the flipped account passes `role: [UserRole.Student]` on `purchaseSubscription` / `createSession` / `myStudentSessions`. |
| `purchaseVerificationPlan` still reachable | already `authenticated`-only at `backend/graphql/mutation/verification-plan-purchase.mutation.ts:50`; assert a 422 `APPLICANT_COOLDOWN_ACTIVE` (not a 403) during cooldown. |
| SDL neutrality | assert `bun run generate:gqlSchema` + `bun codegen` produce **no diff** (D8); if a diff appears, halt — an unplanned schema change. |

---

## 12. Security & Tenancy Assurance — REQ-010

| Vector | Analysis | Control |
|---|---|---|
| BOLA (broken object-level auth) | The conversion writes only the applicant's OWN user id (`applicantUserId` from the session-derived evaluation context) — no caller-supplied id reaches the writes. `transitionRoleOnce` predicates on `id = userId AND role = fromRole`. | Id is derived server-side, never from input. |
| BOPLA (mass assignment) | The `students` insert uses the fixed field-by-field payload in `createForRegistration` (`id`, `handshakeCode`, `balanceHifz/Tajweed/Reviews`, `parentId`) — no spread of caller data. | No mass assignment. |
| BFLA (function-level auth) | The conversion runs inside `submitRubricEvaluation`, whose caller must be a certified evaluator (session gate upstream). The conversion introduces **no new resolver** and no new scope — it cannot be invoked directly. | No new wire surface. |
| Privilege escalation | The guarded `WHERE role = <fromRole>` prevents flipping an `admin` or a never-applicant account. The fail path can only down-shift `teacher`→`student`; the pass path only up-shifts `student`→`teacher` for a user the rubric certified. | Closed enum + guarded predicate. |
| Governance authority | `session-lifecycle.governance.ts:47` `assertActorGovernanceClean` reads the DB row for deleted/blocked/suspended — the role flip does not weaken that gate. Cooldown does not set any `users.suspended*` field (FR-3.6/3.7 cooldown lives on `applicants.cooldown_until`). | Unchanged governance path. |
| Tenancy | The `students` row shares `users.id`; no cross-tenant id is ever written. | Shared-PK by construction. |

**No new secrets, no new endpoint, no new permission, no schema exposure.**

---

## 13. Sequencing, Task Pipeline & Outcome Protocol — REQ-001

### Dependency graph

```
Task 0 (baseline + ledger)
  └─ [Phase 1.5] Plan Review Gate (@plan-review)  ← orchestrator writes outcome/plan-review-R1.md
        └─ Task 1 (repo: transitionRoleOnce + repo tests)
              └─ Task 2 (service: ApplicantConversionService + tests)
                    └─ Task 3 (wire finalizeRubricFail/Pass + rubric service tests)
                          ├─ Task 4 (types + i18n plumbing)
                          └─ Task 5 (journey test — written FIRST at file level, run after Task 3)
                                └─ Task 6 (role-surface verification + wire tests)
                                      └─ Task 7 (final quality gate + deferred enforcement)
                                            └─ Task 8 (knowledge propagation)
```

### MANDATORY 5-stage subtask pipeline (implementation tasks 1, 2, 3, 5, 6)

Each implementation subtask `X.Y` carries, in order:

| Suffix | Stage | Command / action |
|---|---|---|
| `X.Y.QL` | Quality loop | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0 required). |
| `X.Y.TE` | Test engineering | 4 tiers: coverage / boundaries / chaos / security. |
| `X.Y.SEC` | Security & tenancy audit | BOLA / BOPLA / BFLA (see §12). |
| `X.Y.SR` | Semantic review | Read the diff, confirm it matches the decision record. |
| `X.Y.IV` | Instruction verification | Re-read the layer `AGENTS.md` + instruction files for the touched path. |

### Per-file / whole-plan quality protocol

| Scope | Command |
|---|---|
| Per file | `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0). |
| Whole plan | `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates). |
| GraphQL SDL | `bun run generate:gqlSchema` + `bun codegen` **only if** a schema change appears; expected NO diff (D8). |
| Unused code | `bun run check:unused`. |
| **Never clear caches**; never add `jscpd:ignore` or edit `.jscpd.json`; never add `oxlint-disable`. |

### Baseline & outcome protocol (REQ-001)

| Item | Rule |
|---|---|
| Task 0 | Capture baseline counts (tests, lint, tsgo) BEFORE any edit; record in the plan ledger. |
| Outcome dir | `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/outcome/` — the orchestrator writes `outcome/plan-review-R1.md`; **this plan does NOT author it**. |
| Delta | Final report records metric deltas vs baseline. |

---

## 14. Knowledge Propagation & Documentation — REQ-011

| Doc | Path:line | Change |
|---|---|---|
| Applicant lifecycle | `docs/teachers/applicant-lifecycle.md:75` (§2.5) | Confirm/extend the co-existence contract: after conversion the `students` record co-exists with the untouched `applicants` row; add the `users.role` flip and the re-certification restore. |
| Evaluation rubric scoring | `docs/teachers/evaluation-rubric-scoring.md:162` | **Supersede the stale sentence** — it currently says the FAIL path writes "no `students` row … no role flip". Replace with the new contract: the fail path creates the `students` row and flips the role, in the same transaction. |
| Teachers index | `docs/teachers/` | Link the canonical conversion narrative from the teachers doc index. |
| Canonical doc | create/point a canonical section (in `applicant-lifecycle.md` or a sibling) describing the conversion as the single source of truth. |

**Doc-drift rule:** no code comment may reference `REQ-xx` / `Task x.y`; those IDs live only in plan
artifacts. Sweep the amended docblocks for stale copy (e.g. the "no role flips" sentence in
`finalizeRubricFail`) after the change.

---

## 15. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | Handshake-code unique collision exhausts the retry budget. | Low | Fail-closed 409; verdict rolls back. | Reuse bounded retry (D4); localized `handshakeExhausted`; journey test asserts typed error. |
| R2 | Concurrent finalizations race the conversion. | Low | Double-write risk. | Guarded `transitionToFailed` + guarded `transitionRoleOnce` + idempotency read (D3). |
| R3 | JWT still asserts `teacher` for a short window post-flip. | Medium | Transient 403 on student surfaces. | D9 — self-heals on refresh; documented; forced revocation deferred. |
| R4 | Blocker (Cooldown plan) not implemented at implementation time. | High | Cannot run end-to-end. | Ticket is Blocked-By; implement Task 1–3 mechanics; integration verified once the cooldown plan lands (`cooldown_until` already written by the shipped rubric fail path, so the conversion itself is testable now). |
| R5 | Unplanned SDL diff. | Low | Scope creep. | Task 6 asserts no diff; halt on diff. |
| R6 | `myApplicantProfile` unreachable for converted students. | Medium | Cooldown read-model gap. | D6 — deferred cross-plan; re-apply unaffected. |

---

## 16. Traceability & Deferred Cross-References

| Decision | Deferred ledger id | Class |
|---|---|---|
| D6 `myApplicantProfile` widening | `deferred-items.md` D1 | 📋 Deferred-to-follow-up (cross-plan with Cooldown plan). |
| D7 audit-log row | `deferred-items.md` D2 | 📋 Deferred-to-follow-up (audit-completeness stream). |
| D9 forced invalidation | `deferred-items.md` D3 | 📋 Deferred-by-design (self-heals on refresh). |
| Admin-override REJECT path conversion | `deferred-items.md` D4 | 📋 Deferred-to-child-ticket (Admin Override ticket). |
| Frontend surfacing | `deferred-items.md` D5 | 📋 Deferred-to-child-ticket. |

**Ticket acceptance-criteria traceability**

| Gherkin clause | REQ | Task | Test |
|---|---|---|---|
| students record created (shared PK) | REQ-003 | 2,3 | T5.1 |
| zeroed balances | REQ-003 | 3 | T5.2 |
| unique handshake code | REQ-003 | 2 | T5.3 |
| applicants record preserved | REQ-004 | 3 | T5.4 |
| subscribe + attend during cooldown | REQ-008 | 6 | T5.6 |
| re-certified has both teacher + student records | REQ-007 | 2,3 | T5.7 |

**Decision refs:** B.6 (applicants table), B.7 (teacher record after verification), INV-TV6, FR-3.6.

---

## 17. Definition of Done

- [ ] `transitionRoleOnce` added + repo tests pass (`runInRollback`, `tx`-threaded).
- [ ] `ApplicantConversionService` added + service tests pass.
- [ ] `finalizeRubricFail` creates the student row + flips role; `finalizeRubricPass` restores role; docblocks amended.
- [ ] Journey test T5.1–T5.7 pass via `bun test test/workflows`.
- [ ] Student surfaces reachable post-flip; `purchaseVerificationPlan` 422 during cooldown.
- [ ] No SDL diff; no migration; no frontend change.
- [ ] `bun quality-gate` green; per-file `sub-loop --lifecycle duplicates` exit 0.
- [ ] Docs updated (`applicant-lifecycle.md` §2.5, `evaluation-rubric-scoring.md:162`); no `REQ-xx`/`Task x.y` in code comments.
- [ ] Deferred items D1–D5 recorded in `deferred-items.md`.

---

## Appendix A — Data Models, API Contracts & Permission Matrix, UX/Navigation

### A.1 Data Models (canonical shapes touched — all EXISTING, zero delta; see §4)

| Entity | Table | Columns the conversion reads/writes | Change |
|---|---|---|---|
| User | `users` | `role` (`user_role` pgEnum, `backend/db/schema/users/users.ts:19`) | guarded UPDATE on failure (`teacher`→`student`) and on pass (`student`→`teacher`) |
| Student | `students` | `id` (PK = FK→`users.id`), `balance_hifz`/`balance_tajweed`/`balance_reviews` (default 0), `balance_trial` (0), `parent_id` (NULL), `handshake_code` (NOT NULL, unique) | INSERT on first conversion; skipped when the row already exists (D3) |
| Applicant | `applicants` | `status` (`failed`/`passed`), `cooldown_until` | READ only here — written exclusively by the shipped rubric path |
| Teacher | `teacher` | shared-PK row | unchanged (pass path only) |

No new type is added to `backend/types/` — both service functions return `Promise<void>` (§9).

### A.2 API Contracts & SDL

| Surface | Kind | SDL delta | Notes |
|---|---|---|---|
| `submitRubricEvaluation` (mutation) | existing | NONE | the conversion is an internal side effect of the fail finalization |
| `purchaseSubscription` / `createSession` / `myStudentSessions` | existing | NONE | become *reachable* for the converted account because its role is now `Student` — no signature change |
| `purchaseVerificationPlan` | existing | NONE | remains `authenticated`-only; the re-apply path (422 `APPLICANT_COOLDOWN_ACTIVE` during cooldown) |

`bun run generate:gqlSchema` + `bun codegen` MUST produce **no diff** (D8). No new field, argument,
enum, or type is introduced.

### A.3 Permission Matrix (role × surface, post-conversion)

| Surface | admin | teacher (applicant) | student (converted) | parent |
|---|---|---|---|---|
| `submitRubricEvaluation` | ❌ (not a certified evaluator) | ✅ (evaluator) | ❌ | ❌ |
| `purchaseVerificationPlan` | ❌ | ✅ (422 during cooldown) | ✅ (422 during cooldown) | ❌ |
| `myApplicantProfile` | ✅ (own) | ✅ (own) | ❌ 403 — D6 deferred widening | ❌ |
| `purchaseSubscription` | ❌ | ❌ 403 | ✅ | ❌ |
| `createSession` / `myStudentSessions` | ❌ | ❌ 403 | ✅ | ❌ |
| `adminExtendApplicantCooldown` (sibling) | ✅ | ❌ 403 | ❌ 403 | ❌ |

### A.4 UX / Navigation Specification (Explicit No-UI Ruling)

| Dimension | Ruling |
|---|---|
| New routes / URLs | NONE |
| Sidebar / nav items (`frontend/views/dashboard/nav/navItems.ts`) | UNCHANGED — the converted account's nav shifts automatically because `getNavItemsForRole(role)` is role-keyed and the role is now `student` |
| Mobile bottom nav | N/A — no such surface exists in the repo |
| Apollo documents / stores / views | NONE added |
| User-visible change | The account's dashboard becomes the student dashboard after the next token refresh (D9); no bespoke conversion UI ships in this ticket (deferred — `deferred-items.md` D5) |
