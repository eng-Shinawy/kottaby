# Failed Applicant → Student Record Conversion — Specification (`specs.md`)

**Plan directory:** `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/`
**Artifacts in this plan:** `specs.md` (this file) · `plan.md` · `tasks.md` · `deferred-items.md` · `outcome/` (orchestrator-owned)
**Ticket:** `Failed Applicant → Student Record Conversion` — `docs/planning/TICKETS.md:872-912`
**Owner stream:** Dev 2 · **Milestone:** 1 · **Story points:** 3
**Blocked by:** `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` — plan at `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/` (NOT yet implemented). Its own blocker, `Evaluation Rubric Scoring`, IS shipped and archived at `ai/finished_plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`.
**Decision refs:** B.6 (applicants table), B.7 (teacher record after verification), INV-TV6, FR-3.6.
**Plan kind:** backend-only slice. **Zero schema delta.** No UI, no new routes, no nav items, no Apollo documents.

---

## 1. Purpose & Goal

When a teacher applicant **fails** the 5-session rubric cycle, the failure finalization must, **atomically inside the same DB transaction as the existing verdict write**:

| # | Effect | Concrete outcome |
|---|--------|------------------|
| (a) | Create the `students` role-child row | Shared PK = `users.id`; `balance_hifz = 0`, `balance_tajweed = 0`, `balance_reviews = 0`, `balance_trial = 0`, `parent_id = NULL`; fresh UNIQUE `handshake_code` (`KSB-XXXXXXXX`), retrying on collision |
| (b) | Flip `users.role` | `teacher` → `student` via a guarded single-statement `UPDATE` |
| (c) | Preserve the `applicants` row | **Untouched**: `status='failed'`, `cooldown_until` already stamped by the shipped rubric fail path |

**All-or-nothing:** any failure in (a)/(b)/(c) rolls back the verdict write. The account is never left in a half-converted state (student row without role, or role flipped without student row).

**Re-certification:** when a converted student later **passes** (re-evaluation rubric cycle OR admin cold-start certification), the pass path must atomically restore `users.role` `student` → `teacher` (guarded single-statement `UPDATE`; a **no-op** for a never-converted applicant whose role is already `teacher`). The `students` row is **preserved** as historical data, and the existing pass path already inserts the `teacher` row and sets `applicants.status='passed'`.

> **This document defines *what* must be true (requirements).** *How* it is built (transaction boundaries, repo/service shape, wiring sites) is the domain of `plan.md`; the ordered execution is `tasks.md`.

---

## 2. Scope

### 2.1 In scope

- A new guarded role-transition repository primitive on `UserRepository`.
- A new `ApplicantConversionService` namespace exposing `convertToStudent` and `restoreTeacherRole`.
- Two call-sites wired into the shipped rubric finalization helpers (`finalizeRubricFail`, `finalizeRubricPass`).
- Reuse of the existing handshake-generation retry helper (no duplicated retry loop).
- A cross-actor journey test exercising fail → convert → subscribe/attend → re-certify → teacher+student co-existence.
- GraphQL role-surface verification (assert the student-gated surfaces become reachable after the flip, and the re-apply surface stays reachable).
- Documentation propagation (§2.5 of `docs/teachers/applicant-lifecycle.md`; superseding a now-stale line in `docs/teachers/evaluation-rubric-scoring.md`).

### 2.2 Explicitly OUT of scope (NO-UI ruling)

| Excluded | Reason |
|---|---|
| New frontend routes / pages / nav entries | Backend-only slice; the role flip changes no GraphQL field |
| New Apollo documents (`frontend/graphql/sharedDocuments/**`) | No SDL change ⇒ no codegen, no new documents |
| Any Drizzle schema edit or migration | Every table/column already exists (see §3) |
| Widening `myApplicantProfile` role gate | Deferred cross-plan item (see REQ-011 and `deferred-items.md` D1) |
| Audit-log row for the conversion | Deferred to the audit-completeness stream (`deferred-items.md` D2) |
| Forced session/token invalidation on role flip | Deferred-by-design; the JWT self-heals on refresh (`deferred-items.md` D3) |
| Conversion on the admin-override **REJECT** path | Deferred to the Admin Override child ticket (`deferred-items.md` D4) |
| Frontend surfacing of the conversion | Deferred to a child ticket (`deferred-items.md` D5) |

---

## 3. Grounded Evidence Base

Every requirement below is anchored to code and spec locations **verified in this repository at authoring time**. No path:line is cited that was not opened and confirmed.

### 3.1 Schema (zero delta — confirm before assuming a migration is needed)

| Evidence | Location | Fact |
|---|---|---|
| `users.role` | `backend/db/schema/users/users.ts:19` | `role: userRole("role").notNull()` — the single authoritative role column |
| `students` shared PK | `backend/db/schema/students/students.ts:16-46` | `id` integer PK FK→`users.id` ON DELETE CASCADE; no auto-increment |
| `students` balances | `backend/db/schema/students/students.ts:24-27` | `balance_hifz`/`balance_reviews`/`balance_tajweed` default 0; `balance_trial` NOT NULL default 0 |
| `students` handshake | `backend/db/schema/students/students.ts:31,40` | `handshake_code` varchar(50) NOT NULL; unique index `students_handshake_code_unique` |
| `students` balance CHECKs | `backend/db/schema/students/students.ts:42-45` | CHECK `balance_* >= 0` for hifz/reviews/tajweed/trial |
| `parent_id` | `backend/db/schema/students/students.ts:32` | FK→`users.id` ON DELETE SET NULL (nullable) |
| `applicants` row | `backend/db/schema/teachers/applicants.ts:13-30` | shared PK FK→`users.id` CASCADE; `verification_attempts`, `last_attempt_at`, `cooldown_until`, `status` varchar(50) default `"pending"` |
| `teacher` row | `backend/db/schema/teachers/teacher.ts` | shared PK teacher row (created only on pass) |
| `user_role` enum | `backend/db/schema/enums.ts:8` | `pgEnum("user_role", ["admin","teacher","student","parent"])` |

### 3.2 Enums / constants

| Evidence | Location | Fact |
|---|---|---|
| `UserRole` | `backend/enum/users/user-role.enum.ts` | `{ Admin="admin", Teacher="teacher", Student="student", Parent="parent" }` + `toUserRole` |
| `ApplicantStatus` | `backend/enum/teachers/applicant-status.enum.ts` | `{ Pending, InEvaluation, Failed, Passed }` + `isApplicantStatus` |
| Handshake constants | `shared/constants/handshake-code.constants.ts` | `HANDSHAKE_CODE_PATTERN = /^KSB-[0-9A-F]{8}$/`, `HANDSHAKE_CODE_PREFIX`, `isHandshakeCode`, `normalizeHandshakeCode` |

### 3.3 Repositories (data access only; zero business rules)

| Evidence | Location | Fact |
|---|---|---|
| `ApplicantRepository.transitionToFailed` | `backend/db/repo/teachers/applicant.repository.ts:468` | Guarded single `UPDATE … WHERE id=$id AND status='in_evaluation' RETURNING *`; returns `null` on miss |
| `ApplicantRepository.finalizeOnCertification` | `backend/db/repo/teachers/applicant.repository.ts:507` | Sets `status='passed'`, `cooldown_until = NULL` |
| `StudentRepository.createForRegistration` | `backend/db/repo/students/student.repository.ts:163-185` | REQUIRED `tx`; plain insert (no ON CONFLICT); throws if insert returns no rows |
| `StudentRepository.findHandshakeCodeByStudentId` | `backend/db/repo/students/student.repository.ts:198-214` | Returns `string \| null` — reused for the idempotency existence-check |
| `UserRepository.create` | `backend/db/repo/users/user.repository.ts:106` | `create(insert, tx)` |
| `UserRepository.updateLocale` | `backend/db/repo/users/user.repository.ts:130` | Only existing user mutator — **no role-update method exists** ⇒ a new guarded method is required |

### 3.4 Services

| Evidence | Location | Fact |
|---|---|---|
| `createStudentWithHandshakeRetry` | `backend/services/shared/user-provisioning.helpers.ts:118-160` | Owns `KSB-XXXXXXXX` generation (`:43`) and the bounded `HANDSHAKE_RETRY_LIMIT = 5` collision retry; `isUniqueViolation` at `:54` |
| Registration call-site | `backend/services/auth/registration.service.ts:105-110` | Calls the helper with `cause => new ConflictError("Handshake code generation failed after retries", { cause })` |
| Admin call-site | `backend/services/admin/user-management.service.ts:80` | Second reuse of the same helper |
| `finalizeRubricPass` | `backend/services/teachers/evaluation-rubric.helpers.ts:342-374` | Inserts/elevates the teacher row, then `finalizeOnCertification` |
| `finalizeRubricFail` | `backend/services/teachers/evaluation-rubric.helpers.ts:384-395` | ONE guarded `transitionToFailed`. Its docblock (`:382`) currently says "no role-child rows, no role flips" — **this ticket AMENDS that contract** |
| `submitRubricEvaluationInTx` | `backend/services/teachers/evaluation-rubric.helpers.ts:473-518` | The submission transaction body (session gate → … → quorum → verdict → finalize → in-tx notification); fail branch at `:508`, pass branch at `:503` |
| `getMyApplicantProfile` | `backend/services/teachers/applicant-lifecycle.service.ts:142-181` | Returns `null` for a caller with no `applicants` row (safe for a widened gate) |
| `assertCanPurchaseVerification` | `backend/services/teachers/applicant-lifecycle.service.ts:204-250` | Re-apply gate; derives purely from `cooldownActive` and `status !== passed` |
| Auth login token | `backend/services/auth/auth.service.ts:184` | `signAccessToken` with `user.role` from the DB row |
| Auth refresh token | `backend/services/auth/auth.service.ts:257` | `refreshToken` re-reads the DB user row and re-signs the access token with the **current** DB `user.role` |
| Governance gate | `backend/services/classes/session-lifecycle.governance.ts:47` | `assertActorGovernanceClean` — DB-row authority: deleted/blocked/suspended denied; role is NOT changed by cooldown |

### 3.5 GraphQL role gates (the wire-level reason the flip is required)

| Surface | Location | Gate |
|---|---|---|
| `purchaseSubscription` | `backend/graphql/mutation/subscription-purchase.mutation.ts:63` | `role: [UserRole.Student]` |
| `createSession` | `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119` | `role: [UserRole.Student]` |
| `myStudentSessions` | `backend/graphql/query/classes/session-lifecycle.query.ts:193` | `role: [UserRole.Student]` |
| Handshake self-read | `backend/graphql/query/students/handshake-code.query.ts:63` | `role: [UserRole.Student]` |
| `purchaseVerificationPlan` | `backend/graphql/mutation/verification-plan-purchase.mutation.ts:50` | `authenticated` only (re-apply stays reachable) |
| `myApplicantProfile` | `backend/graphql/query/teachers/applicant.query.ts:59` | `role: [UserRole.Teacher]` — left unchanged (see REQ-011) |

### 3.6 Docs / specs (binding)

| Evidence | Location | Fact |
|---|---|---|
| FR-1.1 role enum + child-table inheritance | `docs/specs/functional-requirements.md:12-13` | One role; child table via shared PK inheritance |
| FR-1.2 one role | `docs/specs/functional-requirements.md:18` | "A user has exactly one role; role-specific data lives in the corresponding child table." |
| FR-3.6 qualification outcomes | `docs/specs/functional-requirements.md:110-120` | "Create `students` record; 1-month cooldown" (Tajweed) / "…; 3-month cooldown" (Hifz) |
| FR-3.7 cooldown periods | `docs/specs/functional-requirements.md` | 30-day / 90-day re-application lock |
| INV-TV6 | `docs/specs/state-machine-invariants.md:92` | Converted failed applicant retains student privileges during cooldown |
| INV-TV1..TV7 | `docs/specs/state-machine-invariants.md:83-91` | Certification invariants |
| §2.5 co-existence | `docs/teachers/applicant-lifecycle.md:75` | "the `students` record co-exists with the `applicants` row; the applicant row is untouched by the conversion" |
| Two-source split | `docs/teachers/applicant-lifecycle.md:60-67` | Durations set by the failure writer; the guard is a pure `cooldown_until` read |
| Stale FAIL-path sentence | `docs/teachers/evaluation-rubric-scoring.md:161-162` | "No `teacher` row, no `students` row … no role flip" — **superseded by this ticket** (implementation MUST update this line) |

### 3.7 Test harness conventions

| Evidence | Location | Fact |
|---|---|---|
| Journey conventions | `test/workflows/AGENTS.md` | Real services + real DB; committed fixtures; tracked afterAll cleanup; NO `runInRollback` |
| `createJourneyCast` | `test/workflows/helpers/journey-fixtures.ts:251` | Journey cast factory |
| `catchJourneyError` | `test/workflows/helpers/journey-fixtures.ts:226` | Error-capture helper |
| `provisionStudentActor` | `test/workflows/helpers/actor-context.ts:88` | Student actor provisioner |
| `provisionCertifiedTeacherActor` | `test/workflows/helpers/actor-context.ts:105` | Certified teacher actor provisioner |
| Cleanup | `test/workflows/helpers/journey-cleanup.ts` | Journey teardown |
| Exemplar journeys | `test/workflows/teachers/verification-plan-purchase.journey.test.ts`, `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`, `test/workflows/admin/cold-start-certification.journey.test.ts` | Structural templates for the new journey |
| DB unit tests | `backend/db/test/entity-setup.ts` | Entity-setup helpers; `runInRollback` + `tx` on every repo call; run via `bun run test/scripts/run-test.ts <path>` |
| Journey run command | — | `bun test test/workflows` |

---

## 4. Actors & Roles

| Actor | Role enum | Role in this feature |
|---|---|---|
| Teacher applicant | `teacher` | Enters evaluation; on FAIL is converted to `student` |
| Converted student | `student` | Post-conversion account: subscribes + attends sessions during cooldown; retains `applicants` row |
| Re-certified teacher | `teacher` | Former convert who later passes re-evaluation / cold-start; keeps `students` row (historical) |
| Admin | `admin` | Cold-start certification path triggers `restoreTeacherRole` |
| System (scheduler/test) | — | Drives the 5-session rubric cycle; no actor-scoped authority of its own |

---

## 5. Functional Requirements

Requirements are written in EARS style. Each is testable, anchored to evidence (§3), and mapped to the ticket's Gherkin and test scenarios in §7.

---

### REQ-001 — Pre-Implementation Baseline & Outcome Protocol

**Requirement:** Before any code change, the implementer SHALL record a pre-implementation baseline (counts of students rows / role distribution / relevant test totals) and the plan's outcome ledger, and SHALL re-measure the same counts after implementation to prove no unintended drift and to make the conversion effect observable.

**Rationale / binding source:** Repo quality protocol (`AGENTS.md` → "Code Quality Workflow"); the orchestrator-owned `outcome/` directory; plan conventions for `Task 0 · Pre-Implementation Baseline`.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-001.1 | A baseline snapshot is captured (row counts for `students`, `users` by `role`, and the pre-change pass count of the affected test files) before the first code edit |
| AC-001.2 | The baseline is recorded in the plan's ledger location used by `tasks.md` Task 0 (not in a new SUMMARY/REPORT file — those are prohibited) |
| AC-001.3 | Post-implementation, the same counts are re-measured; only the expected conversion delta (one new `students` row + one `teacher`→`student` role change per converted actor, reverted by re-certification) is observed |
| AC-001.4 | The `outcome/plan-review-R1.md` artifact is NOT written by the implementer (orchestrator-owned) |

**Evidence:** `AGENTS.md` "Never clear caches"; "NEVER create summary markdown files".

**Verification:** Manual ledger capture + diff of pre/post counts; `bun quality-gate` state file is the gate of record (not a new file).

---

### REQ-002 — Translation & Enum Compliance

**Requirement:** All user-facing strings SHALL come from the compile-time translation system in `shared/locale/` and all role/status comparisons SHALL use the canonical `UserRole` / `ApplicantStatus` enums. The conversion-triggered retry-exhaustion error SHALL reuse the existing localized `errorsTranslations.handshakeExhausted` key (no new key required); if any new key is introduced it SHALL exist **identically** in both `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts` and pass the locale parity tests. No `console.*`, no `next-intl`, no `Translation.` enum, no two-arg `getTranslations`.

**Rationale / binding source:** `AGENTS.md` → i18n/Localized Errors; Logging rules.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-002.1 | No `console.*` call in any new/changed file (backend files use `logger` from `@/backend/lib/logger`); domain rejections use `logger.logDomainError` |
| AC-002.2 | Replacement of `next-intl` is respected — imports come only from `@/shared/locale/*`; server text via single-arg `getServerTranslations(locale)` → `.errorsTranslations.<leaf>`; resolvers via `ctx.t("namespace")` |
| AC-002.3 | Role literals are compared via `UserRole.Teacher` / `UserRole.Student`, never bare `"teacher"` / `"student"` |
| AC-002.4 | The retry-exhaustion `ConflictError` reuses `errorsTranslations.handshakeExhausted` (`shared/locale/en/errors/index.ts:75`, `shared/locale/ar/errors/index.ts:74`) |
| AC-002.5 | If a new key is added, `shared/locale/en` and `shared/locale/ar` remain key-identical and locale parity tests pass |

**Evidence:** `shared/locale/en/errors/index.ts:75` = `handshakeExhausted: "Could not generate a unique handshake code. Please try again."`; Arabic parity at `shared/locale/ar/errors/index.ts:74`.

**Verification:** `bun run lint` (bans `console.*`); locale parity test suite; reviewer check of enum usage.

---

### REQ-003 — Student Record Creation on Failure (zeroed balances + unique handshake code)

**Requirement:** When a rubric verdict is FAIL, the finalization SHALL create a `students` role-child row for the applicant's `users.id` (shared PK), with `balance_hifz = 0`, `balance_tajweed = 0`, `balance_reviews = 0`, `balance_trial = 0`, `parent_id = NULL`, and a freshly generated UNIQUE `handshake_code` matching `HANDSHAKE_CODE_PATTERN` (`/^KSB-[0-9A-F]{8}$/`). Collision on the unique index SHALL be retried via the shipped bounded retry helper.

**Rationale / binding source:** Ticket Gherkin (lines "a students record is created (shared PK with users)"; "students.balance_hifz = 0, balance_tajweed = 0, balance_reviews = 0"; "a unique handshake_code is generated"); FR-3.6 (`docs/specs/functional-requirements.md:110-120`).

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-003.1 | For a FAIL verdict on user `U`, exactly one `students` row exists with `id = U` |
| AC-003.2 | `balance_hifz = 0 AND balance_tajweed = 0 AND balance_reviews = 0 AND balance_trial = 0` (columns default 0; no explicit non-zero write) |
| AC-003.3 | `handshake_code` is NOT NULL and satisfies `isHandshakeCode(...)` / `HANDSHAKE_CODE_PATTERN` |
| AC-003.4 | `handshake_code` is unique across `students` (unique index `students_handshake_code_unique`) |
| AC-003.5 | `parent_id IS NULL` (no parent linkage at conversion) |
| AC-003.6 | Collision on the unique index is handled by the bounded retry (≤ `HANDSHAKE_RETRY_LIMIT = 5`), not by surfacing the raw DB error |
| AC-003.7 | Balance CHECK constraints (`balance_* >= 0`) are never violated |
| AC-003.8 | Creation is implemented by REUSING `createStudentWithHandshakeRetry` — no duplicated generation/retry loop |

**Evidence:** `backend/db/schema/students/students.ts:24-27,31,40,42-45`; `shared/constants/handshake-code.constants.ts`; `backend/services/shared/user-provisioning.helpers.ts:118-160`; `backend/db/repo/students/student.repository.ts:163-185`.

**Verification:** DB unit test (repo/service) + journey test; assert row + balances + `isHandshakeCode`; a forced-collision unit test asserts retry.

---

### REQ-004 — Applicants Record Preservation

**Requirement:** The conversion SHALL NOT create, mutate beyond the shipped fail path, or delete the `applicants` row. After conversion the row SHALL still exist with `status = 'failed'` and `cooldown_until` as written by the shipped rubric fail path.

**Rationale / binding source:** Ticket Gherkin ("the applicants record is preserved (not deleted)"); `docs/teachers/applicant-lifecycle.md:75` ("the applicant row is untouched by the conversion"); decision refs B.6.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-004.1 | After FAIL finalization, a row exists in `applicants` with PK = `U` |
| AC-004.2 | `applicants.status = 'failed'` (`ApplicantStatus.Failed`) |
| AC-004.3 | `applicants.cooldown_until` is non-null and equals the value written by the shipped fail path (conversion does not shift it) |
| AC-004.4 | `verification_attempts` / `last_attempt_at` are not reset by the conversion |
| AC-004.5 | No DELETE / soft-delete of the `applicants` row anywhere in the conversion code path |
| AC-004.6 | The `students` row co-exists with the `applicants` row (two rows, same shared PK) — matches §2.5 |

**Evidence:** `backend/db/schema/teachers/applicants.ts:13-30`; `backend/db/repo/teachers/applicant.repository.ts:468`; `docs/teachers/applicant-lifecycle.md:75`.

**Verification:** DB unit test asserting both rows post-fail with the same PK; journey test re-reading `applicants` after subscribe/attend.

---

### REQ-005 — Role Transition `teacher` → `student` (student-surface enablement / INV-TV6)

**Requirement:** On conversion, the finalization SHALL flip `users.role` from `teacher` to `student` via a guarded single-statement `UPDATE … WHERE id = $id AND role = 'teacher'`. The flip is the mechanism that makes every student-gated GraphQL surface reachable and thereby satisfies INV-TV6. This is design decision **D1** (see `plan.md`).

**Rationale / binding source:** INV-TV6 (`docs/specs/state-machine-invariants.md:92`) requires the converted applicant to "retain student privileges (can subscribe to plans and attend sessions) during the cooldown period." FR-1.2 (`docs/specs/functional-requirements.md:18`) mandates exactly one role per user. Every student surface is wire-gated `role: [UserRole.Student]` (§3.5), so the **only** way to satisfy INV-TV6 without a cross-cutting widening of ~5+ shipped, test-locked resolvers is to make the account role `student`.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-005.1 | After FAIL finalization, `users.role = 'student'` for the converted user (`UserRole.Student`) |
| AC-005.2 | The flip is a **guarded** single-statement `UPDATE` (`WHERE id AND role = 'teacher'`), not a blind write — safe under concurrency and idempotent |
| AC-005.3 | The method returns `rowcount > 0` as a boolean (or equivalent) so callers can distinguish "flipped" from "already in target role" |
| AC-005.4 | No new role value is introduced; `user_role` enum is unchanged |
| AC-005.5 | The rejected alternative (keep `role=teacher` + widen student surfaces) is documented as **D1-rejected** in `plan.md` with rationale (cross-cutting, violates student-only scope invariants, > 3 SP, incoherent with FR-1.2) |

**Evidence:** `backend/db/schema/users/users.ts:19`; `backend/db/schema/enums.ts:8`; `backend/graphql/mutation/subscription-purchase.mutation.ts:63`; `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119`; `backend/graphql/query/classes/session-lifecycle.query.ts:193`; `backend/graphql/query/students/handshake-code.query.ts:63`; `docs/specs/functional-requirements.md:18`; `docs/specs/state-machine-invariants.md:92`.

**Verification:** Repo unit test for the guarded UPDATE (flip once → true; second call → false); journey test asserting the actor can reach student surfaces.

---

### REQ-006 — Atomicity, Idempotency & Concurrency

**Requirement:** The conversion (student-row insert + role flip) SHALL execute INSIDE the existing rubric finalization transaction and be atomic with the verdict. The conversion SHALL be idempotent: re-running it for an already-converted user is a safe no-op (existence-read via `findHandshakeCodeByStudentId` + guarded role UPDATE). A failure in the conversion SHALL roll back the verdict (fail-closed). Concurrent duplicate finalization SHALL not produce two `students` rows or a lost/incorrect role.

**Rationale / binding source:** Ticket requires a coherent fail state; code invariants demand all-or-nothing. Design decisions **D2** (in-transaction), **D3** (idempotency), **D10** (fail-closed). DB-test rules (`AGENTS.md`): `runInRollback` + `tx` to every repo call.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-006.1 | Conversion runs in the same `DBTransaction` (`tx`) as `finalizeRubricFail` — no separate/`db`-backed write inside the transaction |
| AC-006.2 | If the students insert or role flip throws, the verdict write (`transitionToFailed`) also rolls back — no `status='failed'` with a missing/mismatched student row |
| AC-006.3 | Idempotency: a second conversion for an already-converted user returns without inserting a second row and without error |
| AC-006.4 | The existence-check uses `findHandshakeCodeByStudentId(userId, tx)` (returns `string \| null`); presence ⇒ already converted |
| AC-006.5 | The guarded role UPDATE makes concurrent flips safe (only one wins; the other observes rowcount 0 and treats it as already-converted) |
| AC-006.6 | Retry exhaustion surfaces a localized `ConflictError` (see REQ-002/AC-002.4) and rolls back the verdict |
| AC-006.7 | All DB tests use `runInRollback` and pass `tx` to EVERY repository call; `expect(...).rejects.toThrow()` is NOT used inside `runInRollback` (try/catch helper pattern instead) |

**Evidence:** `backend/services/teachers/evaluation-rubric.helpers.ts:384-395,473-518`; `backend/db/repo/students/student.repository.ts:198-214`; `backend/db/repo/teachers/applicant.repository.ts:468`; `AGENTS.md` Database Testing Critical Rules.

**Verification:** DB unit test for second-call no-op; a rollback test (force conversion failure → assert `applicants.status` unchanged); concurrency test (two sequential in-tx conversions).

---

### REQ-007 — Re-Certification → Teacher Role Restoration (students row preserved)

**Requirement:** When a converted student later PASSES — via the re-evaluation rubric cycle (`finalizeRubricPass`) OR admin cold-start certification — the pass path SHALL atomically restore `users.role` `student` → `teacher` using a guarded single-statement `UPDATE`. The `students` row SHALL be PRESERVED (historical data), and the existing pass path SHALL continue to insert/elevate the `teacher` row and set `applicants.status='passed'`. For a never-converted applicant (role already `teacher`) the restore SHALL be a no-op returning `false` without error.

**Rationale / binding source:** Ticket Gherkin ("their teacher record is created / And their students record is preserved (historical data)"); B.7; FR-1.2. Design decision **D5**.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-007.1 | After re-certification, `users.role = 'teacher'` (`UserRole.Teacher`) |
| AC-007.2 | The `students` row still exists for that user id (NOT deleted by re-certification) |
| AC-007.3 | A `teacher` row exists for the user (created by the shipped pass path — unchanged) |
| AC-007.4 | `applicants.status = 'passed'` (`ApplicantStatus.Passed`) — via shipped `finalizeOnCertification` |
| AC-007.5 | Restore is guarded (`WHERE id AND role = 'student'`); for a never-converted applicant it is a no-op returning `false` (no exception) |
| AC-007.6 | Both pass entry points are covered: rubric re-evaluation (`finalizeRubricPass`) AND admin cold-start certification |
| AC-007.7 | Both teacher and student rows co-exist after re-certification (teacher + students, same PK) |

**Evidence:** `backend/db/repo/teachers/applicant.repository.ts:507`; `backend/services/teachers/evaluation-rubric.helpers.ts:342-374`; `backend/services/admin/user-management.service.ts` (cold-start path); exemplar `test/workflows/admin/cold-start-certification.journey.test.ts`.

**Verification:** DB unit test for no-op restore; journey test asserting teacher + student co-existence and `applicants.status='passed'`.

---

### REQ-008 — Student Privileges During Cooldown (INV-TV6 — consume subscribe + attend surfaces)

**Requirement:** After conversion, the actor SHALL be able to consume the student-gated surfaces as a real `student`: purchase a subscription (`purchaseSubscription`) and attend sessions (`createSession` / `myStudentSessions`). Independently, the actor SHALL still be able to re-apply via `purchaseVerificationPlan` (authenticated-only), where an active cooldown yields the 422 `APPLICANT_COOLDOWN_ACTIVE` carrying the cooldown expiry.

**Rationale / binding source:** INV-TV6 (`docs/specs/state-machine-invariants.md:92`); ticket Gherkin ("the subscription works normally / And they can attend sessions"); test scenario "Failed applicant can subscribe and attend sessions".

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-008.1 | After conversion, `purchaseSubscription` succeeds for the actor (FORBIDDEN would indicate the flip did not take effect on the wire) |
| AC-008.2 | After conversion, `createSession` succeeds and `myStudentSessions` returns the created session for the actor |
| AC-008.3 | `purchaseVerificationPlan` remains reachable (authenticated scope unchanged) and returns the cooldown 422 (`APPLICANT_COOLDOWN_ACTIVE`) while `cooldown_until` is in the future |
| AC-008.4 | The handshake self-read surface (`handshake-code.query.ts`) is reachable by the converted student (student gate satisfied) |
| AC-008.5 | Governance gate `assertActorGovernanceClean` does NOT block the actor for role/cooldown reasons (cooldown does not change governance flags) |
| AC-008.6 | No cross-cutting widening of any student-gated resolver is introduced (the flip alone enables these surfaces) |

**Evidence:** `backend/graphql/mutation/subscription-purchase.mutation.ts:63`; `backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119`; `backend/graphql/query/classes/session-lifecycle.query.ts:193`; `backend/graphql/query/students/handshake-code.query.ts:63`; `backend/graphql/mutation/verification-plan-purchase.mutation.ts:50`; `backend/services/teachers/applicant-lifecycle.service.ts:204-250`; `backend/services/classes/session-lifecycle.governance.ts:47`.

**Verification:** Wire/GraphQL integration test (student surfaces reachable after flip; re-apply 422) + journey test consuming subscribe + attend.

---

### REQ-009 — Cross-Actor Journey Test

**Requirement:** The plan SHALL add a cross-actor journey test `test/workflows/teachers/applicant-student-conversion.journey.test.ts` exercising the full lifecycle end-to-end with **real services + real DB**: applicant fails → `students` row created with zeroed balances + unique handshake → `applicants` preserved → role is `student` → actor subscribes and attends → actor re-certifies → teacher + student rows co-exist. The journey SHALL use committed fixture helpers, tracked `afterAll` cleanup, and SHALL NOT use `runInRollback`.

**Rationale / binding source:** The ticket's six test scenarios; `test/workflows/AGENTS.md` conventions; exemplars `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`, `test/workflows/teachers/verification-plan-purchase.journey.test.ts`, `test/workflows/admin/cold-start-certification.journey.test.ts`.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-009.1 | File at `test/workflows/teachers/applicant-student-conversion.journey.test.ts` exists and passes via `bun test test/workflows` |
| AC-009.2 | Journey asserts: `students` row exists; zeroed balances; `isHandshakeCode` on generated code; `applicants` row preserved with `status='failed'` |
| AC-009.3 | Journey asserts: after conversion the actor can subscribe (`purchaseSubscription`) and attend (`createSession`) |
| AC-009.4 | Journey asserts: after re-certification `users.role='teacher'`, a `teacher` row exists, and the `students` row is preserved |
| AC-009.5 | Uses `createJourneyCast` / `provisionStudentActor` / `provisionCertifiedTeacherActor` and tracked cleanup (no leaked rows) |
| AC-009.6 | No `runInRollback` (journeys use committed fixtures + afterAll cleanup) |
| AC-009.7 | The journey file is authored FIRST (write-the-test-first ordering per `tasks.md` Task 5) |

**Evidence:** `test/workflows/helpers/journey-fixtures.ts:251,226`; `test/workflows/helpers/actor-context.ts:88,105`; `test/workflows/helpers/journey-cleanup.ts`; `test/workflows/AGENTS.md`.

**Verification:** `bun test test/workflows`; cleanup verified by re-query post-run.

---

### REQ-010 — Security & Tenancy Assurance

**Requirement:** The conversion SHALL preserve role-based access control integrity: the role flip must not grant cross-tenant access, must not allow one actor to trigger another's conversion, and must not be reachable from an unauthenticated or wrong-role context (BOLA/BOPLA/BFLA). Only the rubric verdict/quorum path and the admin cold-start path may trigger conversion/restore.

**Rationale / binding source:** `AGENTS.md` layer rules; `tasks.md` per-task `SEC` subtask (BOLA/BOPLA/BFLA); Pothos role scope from `ctx.role` (`backend/graphql/pothos/builder.ts`).

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-010.1 | Conversion is triggered only as an internal effect of the verdict/quorum path — no public GraphQL mutation exposes it |
| AC-010.2 | A caller cannot convert an arbitrary user id (the target is derived from the evaluated session's applicant, not from client input) |
| AC-010.3 | Role scope enforcement is unchanged; the flip changes only the target user's own role |
| AC-010.4 | After the flip, the actor cannot access admin/teacher-only surfaces it should not (no privilege escalation beyond `student`) |
| AC-010.5 | Restore (`student → teacher`) is gated by the pass path only (rubric pass or admin cold-start), not settable by the actor |
| AC-010.6 | JWT role staleness does NOT create a privilege window: the stale `teacher` claim cannot be used to reach teacher-only surfaces after conversion in a way that violates INV-TV6; it self-heals on refresh (REQ-011/AC-011.5, D9) |

**Evidence:** `backend/graphql/pothos/builder.ts` (role scope from `ctx.role`); `backend/services/auth/auth.service.ts:184,257`.

**Verification:** Security audit subtask per task; negative tests asserting no conversion mutation is public; review of target-id derivation.

---

### REQ-011 — Knowledge Propagation & Documentation

**Requirement:** The implementation SHALL propagate the amended contract to documentation: update `docs/teachers/applicant-lifecycle.md` §2.5, supersede the now-stale FAIL-path sentence at `docs/teachers/evaluation-rubric-scoring.md:161-162`, and link the canonical doc from `docs/teachers/`. The two deferred cross-plan/child-ticket items SHALL be recorded in `deferred-items.md`. No SUMMARY/REPORT file SHALL be created.

**Rationale / binding source:** `AGENTS.md` "If you change anything an AGENTS.md documents, update it"; the stale sentence at `docs/teachers/evaluation-rubric-scoring.md:161-162` ("No `teacher` row, no `students` row … no role flip"); `docs/teachers/applicant-lifecycle.md:75`.

**Acceptance criteria:**

| ID | Criterion |
|---|---|
| AC-011.1 | `docs/teachers/applicant-lifecycle.md` §2.5 accurately describes conversion (student row created, role flipped, applicants preserved) |
| AC-011.2 | The FAIL-path sentence in `docs/teachers/evaluation-rubric-scoring.md:161-162` is updated to reflect the new behavior (student row + role flip on fail) |
| AC-011.3 | A canonical doc for the conversion is created or the existing §2.5 is made canonical, and linked from `docs/teachers/` |
| AC-011.4 | `deferred-items.md` records D1 (`myApplicantProfile` scope widening — cross-plan with Cooldown plan), D2 (audit-log row — audit stream), D3 (forced invalidation — deferred-by-design), D4 (admin-override REJECT — child ticket), D5 (frontend surfacing — child ticket) |
| AC-011.5 | `plan.md` records **D9**: JWT role staleness self-heals on refresh (`auth.service.ts:257` re-signs with the current DB role); no forced logout/revocation required |
| AC-011.6 | `plan.md` records **D6**: `myApplicantProfile` gate left Teacher-only (minimal blast radius on shipped test-locked surfaces); the safe widening to `[Teacher, Student]` (service returns `null` for a caller with no `applicants` row) is deferred |
| AC-011.7 | No new SUMMARY/REPORT/CHANGES markdown file is created |

**Evidence:** `docs/teachers/applicant-lifecycle.md:75`; `docs/teachers/evaluation-rubric-scoring.md:161-162`; `backend/services/teachers/applicant-lifecycle.service.ts:142-181`; `backend/services/auth/auth.service.ts:257`; `backend/graphql/query/teachers/applicant.query.ts:59`.

**Verification:** Doc diff review; `deferred-items.md` presence/contents; grep confirms no SUMMARY/REPORT file added.

---

## 6. Non-Functional Requirements & Constraints

| ID | Constraint | Binding source |
|---|---|---|
| NFR-1 | **Backend-only, zero schema delta.** No Drizzle edit; `bun run db push` NOT required; no migration file | §3.1; design decision D8 |
| NFR-2 | **Schema-neutral at the SDL level.** The role flip changes no GraphQL field; `bun run generate:gqlSchema` + `bun codegen` are expected to be unnecessary. If any SDL change IS needed, it must be explicitly flagged and generated | §3.5 |
| NFR-3 | **No `console.*`.** Use `logger` / `logger.logDomainError` | `AGENTS.md` Logging |
| NFR-4 | **i18n compile-time system only.** Server text single-arg `getServerTranslations(locale)`; resolvers `ctx.t(...)` | `AGENTS.md` i18n |
| NFR-5 | **Deep imports, no new barrels/shims.** `@/` path aliases; `shared/` must not import `frontend`/`backend`/`app` | `AGENTS.md` Import conventions |
| NFR-6 | **Types live in `backend/types/`.** No service-layer `.types.ts`; no local type defs in Pothos | `AGENTS.md` Type Definition Pattern |
| NFR-7 | **Per-file quality loop:** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` must exit 0 | `AGENTS.md` Parallel Subagent Quality Gate |
| NFR-8 | **Final gate:** `bun quality-gate` must pass; never clear caches | `AGENTS.md` Code Quality Workflow |
| NFR-9 | **DB tests:** `runInRollback` + `tx` to every repo call; no `rejects.toThrow()` inside rollback; run via `bun run test/scripts/run-test.ts <path>` | `AGENTS.md` Database Testing |
| NFR-10 | **Journey tests:** explicit forbidden — use `bun test test/workflows`; committed fixtures + tracked cleanup | `test/workflows/AGENTS.md` |
| NFR-11 | **3 SP budget.** One new repo method + one new service namespace + two wiring sites + one journey test + doc propagation. No scope creep | Ticket metadata |

---

## 7. Traceability Matrix

### 7.1 Ticket Gherkin → Requirements

| Ticket Gherkin clause | Requirement(s) |
|---|---|
| "a students record is created (shared PK with users)" | REQ-003 |
| "students.balance_hifz = 0, balance_tajweed = 0, balance_reviews = 0" | REQ-003 |
| "a unique handshake_code is generated for the student record" | REQ-003 |
| "the applicants record is preserved (not deleted)" | REQ-004 |
| "the subscription works normally / And they can attend sessions" | REQ-005, REQ-008 |
| "their teacher record is created / And their students record is preserved (historical data)" | REQ-007 |

### 7.2 Ticket Test Scenarios → Requirements

| Test scenario | Requirement(s) |
|---|---|
| Failed applicant gets students record | REQ-003 |
| Students record has zeroed balances | REQ-003 |
| Handshake code generated for student record | REQ-003 |
| Applicants record preserved | REQ-004 |
| Failed applicant can subscribe and attend sessions | REQ-005, REQ-008 |
| Re-certified applicant has both teacher and student records | REQ-007 |

### 7.3 Requirement → Design Decisions (`plan.md`)

| Requirement | Design decision(s) |
|---|---|
| REQ-001 | — (process) |
| REQ-002 | D4 (reuse helper → reuse `handshakeExhausted`), D10 (localized error) |
| REQ-003 | D4 (reuse `createStudentWithHandshakeRetry`) |
| REQ-004 | D2 (in-transaction; applicants untouched) |
| REQ-005 | D1 (role flip vs scope widening) |
| REQ-006 | D2 (atomic), D3 (idempotency), D10 (fail-closed) |
| REQ-007 | D5 (restore on both pass paths), D9 (no revocation needed) |
| REQ-008 | D1 (flip enables surfaces), D9 (staleness self-heals) |
| REQ-009 | — (test) |
| REQ-010 | D1 (single-role semantics), D9 |
| REQ-011 | D6 (`myApplicantProfile` deferred), D7 (audit log deferred), D8 (zero schema delta), D9 |

### 7.4 Requirement → Verification

| Requirement | Primary verification |
|---|---|
| REQ-001 | Pre/post count ledger diff |
| REQ-002 | `bun run lint` + locale parity tests + reviewer enum check |
| REQ-003 | Repo/service DB unit test + journey test (+ forced-collision test) |
| REQ-004 | DB unit test (both rows, same PK) + journey re-read |
| REQ-005 | Guarded-UPDATE repo test + GraphQL wire test |
| REQ-006 | Idempotency test + rollback test + concurrency test |
| REQ-007 | No-op restore test + cold-start/rubric pass journey |
| REQ-008 | GraphQL wire test (student surfaces reachable; re-apply 422) + journey |
| REQ-009 | `bun test test/workflows` |
| REQ-010 | Security audit subtask + negative tests |
| REQ-011 | Doc diff + `deferred-items.md` review |

---

## 8. Deferred Items (cross-reference to `deferred-items.md`)

| ID | Item | Stream | Status |
|---|---|---|---|
| D1 | Widen `myApplicantProfile` scope to `[UserRole.Teacher, UserRole.Student]` (safe — service returns `null` for a caller with no `applicants` row); needed so the Cooldown plan's derived `cooldownState` read-model stays reachable for converted students | Cross-plan with `cooldown_state_machine_1_month_tajweed_3_month_hifz` | 📋 Deferred-to-follow-up |
| D2 | Audit-log row for the conversion | Audit-completeness stream | 📋 Deferred-to-follow-up |
| D3 | Forced session/token invalidation on role flip | This ticket | 📋 Deferred-by-design (JWT self-heals on refresh — D9) |
| D4 | Conversion on the admin-override **REJECT** path | Admin Override ticket | 📋 Deferred-to-child-ticket |
| D5 | Frontend surfacing of the conversion (no UI in this slice) | This ticket | 📋 Deferred-to-child-ticket |

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Conversion** | The atomic fail-path effect: insert `students` row + flip `users.role` teacher→student; `applicants` untouched |
| **Restore** | The atomic pass-path effect: flip `users.role` student→teacher; `students` row preserved |
| **Shadow student / co-existence** | A converted student holds BOTH an `applicants` row (historical) and a `students` row (current role-child) with the same shared PK |
| **Shared PK** | Child-table PK = FK to `users.id` (no auto-increment) — FR-1.2 inheritance model |
| **Guarded UPDATE** | Single-statement `UPDATE … WHERE id = $id AND role = $from` returning `rowcount > 0` — concurrency-safe, idempotent |
| **INV-TV6** | Converted failed applicant retains student privileges during cooldown |
| **Fail-closed** | On conversion error the verdict is rolled back; no partial conversion persists |

---

## 10. Assumptions & Open Questions

| ID | Item | Disposition |
|---|---|---|
| A1 | The blocker `Cooldown State Machine` plan is NOT implemented; this ticket can still be specified against the shipped rubric fail path (`finalizeRubricFail` exists and stamps `cooldown_until`). Dependency ordering is tracked in `tasks.md`/`plan.md`. | Accepted as a stated dependency |
| A2 | Every schema element needed already exists (zero delta). Any unexpected missing column would invalidate NFR-1 and require re-scoping. | Verified in §3.1 |
| A3 | A role-update repository method does not exist today; a new guarded method is required. | Confirmed by `backend/db/repo/users/user.repository.ts` (only `create`, `updateLocale`) |
| A4 | `myApplicantProfile` remains Teacher-only; a converted student cannot read it. This is intentional and deferred (D1/REQ-011). Re-apply stays fully functional without it. | Accepted; logged in `deferred-items.md` |
| A5 | The role flip is wire-effective only after the next token refresh for an already-issued JWT (D9). No forced revocation in scope. | Accepted by design |
| A6 | No GraphQL SDL change is expected; no codegen run is required. If a change proves necessary, it is flagged in `tasks.md`. | Expected; asserted in NFR-2 |

---

## 11. Handoff

- **Downstream artifacts:** `plan.md` (design decisions D1–D10, transaction boundaries, wiring sites, rejected alternatives) and `tasks.md` (Task 0 → Phase 1.5 review gate → Tasks 1–8 with the mandatory 5-stage subtask pipeline).
- **Deferred ledger:** `deferred-items.md` (D1–D5 as in §8).
- **Do not author:** `outcome/plan-review-R1.md` (orchestrator-owned).
