# Tasks — Failed Applicant → Student Record Conversion

> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` (D1..D10) · **Ledger:** `deferred-items.md` (D1..D5) · **Outcomes:** `outcome/`
> **Ticket:** `docs/planning/TICKETS.md:872-912` — Dev 2 · Milestone 1 · 3 SP · Blocked By Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)
> **Blocker plan:** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/` (NOT yet implemented; its own blocker, Evaluation Rubric Scoring, IS shipped at `ai/finished_plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`)

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-30 |
| Plan kind | Backend-only slice — ZERO schema delta, ZERO UI (no routes, no nav, no Apollo documents) |
| Sequencing | Foundation-first with interleaved tests; **journey authored test-first (Task 5) before service/repo wiring is exercised green (Tasks 1–3)** — see `Task Sequencing Summary` |
| Phase 1.5 gate | Plan Review Gate (`@plan-review`) — BLOCKING, before any code |
| Drizzle | **ZERO schema delta** → NO `db push`, NO `db migrate`, NO snapshot/migration file (D8) |
| GraphQL SDL | **Schema-neutral** — the role flip changes no GraphQL field; `bun run generate:gqlSchema` + `bun codegen` expected to produce a no-op diff (asserted in Task 6) |
| New files | `test/workflows/teachers/applicant-student-conversion.journey.test.ts` · `backend/services/teachers/applicant-conversion.service.ts` · `backend/services/teachers/applicant-conversion.service.test.ts` |
| Extended files | `backend/db/repo/users/user.repository.ts` · `backend/db/test/logic/users/user.repository.test.ts` · `backend/services/teachers/index.ts` (add `export * from "./applicant-conversion.service"`) · `backend/services/teachers/evaluation-rubric.helpers.ts` · `backend/services/teachers/evaluation-rubric.service.test.ts` · `docs/teachers/applicant-lifecycle.md` · `docs/teachers/evaluation-rubric-scoring.md` |
| Types | No new wire type expected; a service return type is added to `backend/types/teachers/` only if Task 4 finds it necessary (see Task 4) |
| i18n | REUSE `shared/locale/{en,ar}/errors/index.ts:75` leaf `handshakeExhausted` — no new key required (Task 4) |

## Non-Negotiable Execution Protocol (all tasks)

1. Read ALL files in `outcome/` before starting a task.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → **exit 0** (sub-loop auto-prints the applicable AGENTS.md + `.agents/instructions/*` — read them before fixing).
3. Every implementation task (1, 2, 3, 5, 6) carries the MANDATORY 5-stage subtask pipeline: `.QL` quality loop → `.TE` Test Engineering (4 tiers) → `.SEC` Security & Tenancy Audit (BOLA/BOPLA/BFLA) → `.SR` Semantic Review → `.IV` Instruction Verification.
4. Complete the `.SR` semantic-review checklist before flipping `[x]` (tenancy, races/idempotency, enums-as-values, no cross-layer imports, no dead code).
5. Write `outcome/<task-id>-outcome.md`; flip the checkbox only after the artifact lands.
6. **Never** `console.*` — use `logger` from `@/backend/lib/logger`; domain/expected rejections via `logger.logDomainError`.
7. No `Translation.` enum, no two-arg `getTranslations`, no `next-intl`, no frontend logging imports (this plan ships zero frontend code).
8. Journey tests run via `bun test test/workflows` (real services + real DB, committed fixtures, tracked `afterAll` cleanup, **NO `runInRollback`**); DB unit tests run via `bun run test/scripts/run-test.ts <path>` (never raw `bun test`).
9. Whole-plan final gate: `bun quality-gate`. Do NOT clear caches.

### Layer → rule-file map (absolute; `sub-loop` re-prints these)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Repos `backend/db/repo/users/` | `…/backend/db/repo/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| DB tests `backend/db/test/logic/users/` | `…/backend/db/test/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md`, `tests.instructions.md` |
| Services `backend/services/teachers/` | `…/backend/services/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Types `backend/types/teachers/` | `…/backend/types/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Shared locale `shared/locale/` | `…/shared/locale/AGENTS.md`, `…/shared/AGENTS.md`, root | — |
| Journeys `test/workflows/teachers/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |
| Docs `docs/teachers/` | root | — |

## REQ → Task Coverage Matrix (all 11 requirements)

| REQ | Title | Primary task(s) | Verification task |
|---|---|---|---|
| REQ-001 | Pre-Implementation Baseline & Outcome Protocol | Task 0 | Task 0 (ledger/baseline) + Task 7 |
| REQ-002 | Translation & Enum Compliance | Task 4 (i18n), Task 1/2 (enums-as-values) | Task 4.QL, Task 1.SR, Task 2.SR |
| REQ-003 | Student Record Creation on Failure (zeroed balances + unique handshake code) | Task 2 (service), Task 3 (wiring) | Task 5 (journey), Task 2.TE |
| REQ-004 | Applicants Record Preservation | Task 3 (no applicants mutation in the new branch) | Task 5 (journey), Task 3.SR |
| REQ-005 | Role Transition `teacher` → `student` (student-surface enablement / INV-TV6) | Task 1 (repo), Task 2 (service), Task 3 (wiring) | Task 6 (role-surface wire tests), Task 5 |
| REQ-006 | Atomicity, Idempotency & Concurrency | Task 2 (idempotency), Task 3 (same-tx) | Task 2.TE (chaos), Task 5 |
| REQ-007 | Re-Certification → Teacher Role Restoration (students row preserved) | Task 2 (`restoreTeacherRole`), Task 3 (pass wiring) | Task 5 (journey), Task 6 |
| REQ-008 | Student Privileges During Cooldown (INV-TV6 — subscribe + attend surfaces) | Task 6 (wire: student surfaces reachable) | Task 6, Task 5 |
| REQ-009 | Cross-Actor Journey Test | Task 5 | Task 5 |
| REQ-010 | Security & Tenancy Assurance | Tasks 1/2/3 (`.SEC`) | Task 6 (BOLA/BFLA), Task 7 |
| REQ-011 | Knowledge Propagation & Documentation | Task 8 | Task 8 |

## Design Decision → Task Trace (D1..D10 from `plan.md`)

| Decision | One-line summary | Realized in |
|---|---|---|
| D1 | Role flip `teacher`→`student` (vs cross-cutting scope widening) | Task 1 (repo), Task 3 (wiring) |
| D2 | Conversion runs INSIDE the existing rubric finalization transaction | Task 3 (same `tx`, same call-site) |
| D3 | Idempotency: existence-read `findHandshakeCodeByStudentId` + guarded role UPDATE (re-failure = safe no-op) | Task 2, Task 1 |
| D4 | Reuse `createStudentWithHandshakeRetry` (DRY; no duplicated retry loop) | Task 2 |
| D5 | Re-certification restores `student`→`teacher` (rubric pass AND admin cold-start) | Task 2 (`restoreTeacherRole`), Task 3 |
| D6 | `myApplicantProfile` gate left Teacher-only; widening DEFERRED | Ledger D1; Task 8 note; Task 7 enforcement |
| D7 | Audit-log row for the conversion DEFERRED | Ledger D2; Task 7 enforcement |
| D8 | Zero schema delta — no migration | Task 7 (gate assertion), Task 0 (baseline) |
| D9 | JWT role staleness self-heals on refresh (`auth.service.ts:257`) — no forced revocation | Task 6 (documented as no-op), Ledger D3 |
| D10 | Fail-closed: conversion failure rolls back the verdict; localized `handshakeExhausted` ConflictError | Task 2 (error contract), Task 3 (same-tx rollback), Task 4 |

## Locked Ground Truth (cite these; do not re-derive)

| Fact | Path:line |
|---|---|
| Shared PK `students.id` FK→`users.id` CASCADE; balances default 0; `handshakeCode` varchar(50) NOT NULL | `backend/db/schema/students/students.ts:16-46` |
| Unique index `students_handshake_code_unique` | `backend/db/schema/students/students.ts:40` |
| `applicants` row columns (`status`, `cooldownUntil`, `verificationAttempts`) | `backend/db/schema/teachers/applicants.ts:13-30` |
| `users.role` single `user_role` pgEnum | `backend/db/schema/users/users.ts:19`, `backend/db/schema/enums.ts:8` |
| `UserRole` enum + `toUserRole` | `backend/enum/users/user-role.enum.ts` |
| `createForRegistration(userId, handshakeCode, tx)` (REQUIRED tx, plain insert) | `backend/db/repo/students/student.repository.ts:163-185` |
| `findHandshakeCodeByStudentId(studentId, tx?)` → `string \| null` | `backend/db/repo/students/student.repository.ts:198-214` |
| `UserRepository.create/updateLocale` — NO role-update method exists | `backend/db/repo/users/user.repository.ts:106,130` |
| `createStudentWithHandshakeRetry(userId, tx, boundary, buildExhaustedError)` + `HANDSHAKE_RETRY_LIMIT = 5` | `backend/services/shared/user-provisioning.helpers.ts:118-160` |
| `finalizeRubricFail(...)` — ONE guarded `transitionToFailed` (docblock to be AMENDED) | `backend/services/teachers/evaluation-rubric.helpers.ts:384-395` |
| `finalizeRubricPass(...)` — teacher insert/elevate then `finalizeOnCertification` | `backend/services/teachers/evaluation-rubric.helpers.ts:342-374` |
| `AuthService.refreshToken` re-signs access token with fresh DB `user.role` | `backend/services/auth/auth.service.ts:257` |
| FR-1.2 "exactly one role" | `docs/specs/functional-requirements.md:18` |
| INV-TV6 converted applicant retains student privileges during cooldown | `docs/specs/state-machine-invariants.md:92` |
| §2.5 converted student co-exists with applicants row | `docs/teachers/applicant-lifecycle.md:75` |
| Stale FAIL-path doc sentence to supersede | `docs/teachers/evaluation-rubric-scoring.md:162` |

## Phase 0 — Baseline

- [x] **Task 0 · Pre-Implementation Baseline (baseline counts + ledger)**
  - Record baseline counts to tracked temp files (no cache clears): `bun tsgo 2>&1 | grep -c "error TS" > /tmp/conversion-baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/conversion-baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id conversion-baseline > /tmp/conversion-baseline-lint.json`
  - Confirm the blocker status honestly: the Cooldown plan is **NOT implemented**; the plan is authored to the pinned architecture and the FAIL-path seam (`finalizeRubricFail`, `evaluation-rubric.helpers.ts:384-395`) SHIPPED with Evaluation Rubric Scoring. Verify by opening the file and confirming `finalizeRubricFail` exists and its docblock still reads "no role-child rows, no role flips".
  - Read `deferred-items.md` (D1..D5). Classify each: D1 cross-plan (Cooldown), D2 audit stream, D3 by-design, D4 child-ticket, D5 child-ticket. **None is a blocker for this ticket.**
  - Read binding docs: `docs/specs/functional-requirements.md:12-20,110-120` (FR-1.1/1.2, FR-3.6/3.7); `docs/specs/state-machine-invariants.md:83-92` (INV-TV1..TV7); `docs/teachers/applicant-lifecycle.md:60-75,142,147,154` (two-source split + §2.5).
  - Assert the schema-neutrality premise: `grep -n "role" backend/db/schema/users/users.ts` shows the enum column already exists; `grep -n "handshakeCode\|balanceHifz\|balanceTajweed\|balanceReviews" backend/db/schema/students/students.ts` shows all columns already exist → **no migration**.
  - Write `outcome/0-baseline-outcome.md` (baseline numbers + the four deferred-item classifications + schema-neutrality proof).
  - _Requirements: REQ-001_

## Phase 1.5 — Plan Review Gate (BLOCKING)

- [x] **[Phase 1.5] · Plan Review Gate (`@plan-review`)**
  - Dispatch the `plan-review` skill against `specs.md` + `plan.md` + `tasks.md` BEFORE writing any code.
  - Assert the review confirms: (a) REQ↔Task coverage is complete (all 11 REQs mapped); (b) D1 (role flip) rationale is coherent with FR-1.2 + INV-TV6 + the shipped `role: [UserRole.Student]` resolver gates; (c) D8 zero-schema-delta holds; (d) D6/D7 deferrals are logged and cross-referenced; (e) no i18n/type-pattern violations.
  - Resolve every BLOCKER finding before Phase 1; record resolutions in `outcome/phase-1.5-review-outcome.md`. The orchestrator writes `outcome/plan-review-R1.md` — do NOT author it here.
  - _Requirements: REQ-001, REQ-002_

## Phase 1 — Repository (guarded role transition)

- [x] **Task 1 · `UserRepository.transitionRoleOnce(userId, fromRole, toRole, tx)` + repo tests**
  - APPEND to `backend/db/repo/users/user.repository.ts`: `transitionRoleOnce(userId: number, fromRole: UserRole, toRole: UserRole, tx: DBTransaction): Promise<boolean>` — a **guarded single-statement UPDATE**: `UPDATE users SET role = <toRole> WHERE id = <userId> AND role = <fromRole>` returning `rowCount > 0`. Mirror the guard discipline of `ApplicantRepository.transitionToFailed` (`applicant.repository.ts:468-485`) and the `updateLocale` tx signature style (`user.repository.ts:130`).
  - Import `UserRole` as a **VALUE** from `@/backend/enum/users/user-role.enum` (enums-as-values, REQ-002.3) — the `fromRole`/`toRole` are validated enum members, never raw strings. Use `and`, `eq` from `drizzle-orm`; NO inline `sql\`\`` concatenation of role strings.
  - The method is **idempotent on the source role**: a second call whose `role != <fromRole>` matches zero rows and returns `false` (D3). Returning `false` is NOT an error at the repo layer — the service decides meaning.
  - Extend `backend/db/test/logic/users/user.repository.test.ts` (create it if absent, mirroring sibling repo test discipline): happy path (`teacher`→`student` flips, returns `true`); zero-row when current role ≠ `fromRole` (returns `false`, row unchanged — read back); missing-user zero-row; **role does not change for an unrelated user id** (tenancy); hostile ids (0, negative). All wrapped in `runInRollback` with `tx` threaded to every repo call; use the `expectRepoError` try/catch helper, **never `.rejects.toThrow()`**.
  - Verify the `backend/db/repo/users/index.ts` barrel already re-exports `UserRepository` (no new barrel needed; deep-import default).
  - [x] **1.QL** `bun run scripts/health/sub-loop.ts backend/db/repo/users/user.repository.ts backend/db/test/logic/users/user.repository.test.ts --lifecycle duplicates` → 0
  - [x] **1.TE** (T1 coverage) 100% branch coverage on the new method (both `true` and `false` rowcount outcomes); (T2 boundaries) `fromRole == toRole`, missing row, unrelated-id no-op; (T3 chaos) two sequential calls where the second is the opposite direction; (T4 security) hostile `userId` values + a cross-user isolation assertion.
  - [x] **1.SEC** BOLA/BOPLA/BFLA: the UPDATE predicate pins BOTH `id` and the expected source role (a foreign caller cannot flip an arbitrary user's role — the service only ever passes its own resolved `applicantUserId`). No mass-assignment (explicit `set({ role })` only).
  - [x] **1.SR** tx-last signature; `UserRole` imported as a value; guard is a single-statement UPDATE (no read-then-write TOCTOU); no new barrel; no `console.*`; no plan-artifact references in code comments.
  - [x] **1.IV** read the printed rule files (`backend.instructions.md`, `backend/db/repo/AGENTS.md`, `backend/db/test/AGENTS.md`, `tests.instructions.md`).
  - _Requirements: REQ-005, REQ-006, REQ-002, REQ-010_

## Phase 2 — Service (conversion namespace)

- [x] **Task 2 · NEW `ApplicantConversionService` namespace (`convertToStudent`, `restoreTeacherRole`) + tests**
  - CREATE `backend/services/teachers/applicant-conversion.service.ts` — an `export namespace ApplicantConversionService` (mirror sibling service namespaces; **no `.types.ts` file** — types live in `backend/types/`).
  - `convertToStudent(applicantUserId: number, tx: DBTransaction, t: ErrorsTranslations): Promise<void>`:
    1. **Idempotency probe (D3):** `await StudentRepository.findHandshakeCodeByStudentId(applicantUserId, tx)` (`student.repository.ts:198-214`). If non-null → a `students` row already exists → still ensure the role is coherent via step 3, then return (safe re-conversion no-op).
    2. **Create the `students` row (D4):** `await createStudentWithHandshakeRetry(applicantUserId, tx, "applicant conversion", cause => new ConflictError("HANDSHAKE_EXHAUSTED", t.handshakeExhausted))` — REUSE the shared helper (`user-provisioning.helpers.ts:118-160`); it owns `KSB-XXXXXXXX` generation + bounded collision retry + `isUniqueViolation`. The row lands with default-zero balances, `parentId` NULL (the helper's `createForRegistration` sets these).
    3. **Role flip (D1):** `const flipped = await UserRepository.transitionRoleOnce(applicantUserId, UserRole.Teacher, UserRole.Student, tx)`. If `false` AND no `students` row existed before this call, the caller's role was not `teacher` — an internal invariant violation (the applicant was `teacher` at evaluation time). Throw a plain `Error("ApplicantConversionService: role flip matched zero rows for a non-teacher applicant")` — mirroring `finalizeRubricPass`'s internal-inconsistency throw (`evaluation-rubric.helpers.ts:363`) — NOT a localized domain error, so **no new i18n key is required**. If `false` but a `students` row DID already exist (idempotent re-run on an already-converted user) → treat as success no-op.
  - `restoreTeacherRole(applicantUserId: number, tx: DBTransaction): Promise<void>` (D5): `await UserRepository.transitionRoleOnce(applicantUserId, UserRole.Student, UserRole.Teacher, tx)`. Return value is intentionally discarded by the caller — a **no-op for a never-converted applicant whose role is already `teacher`** (zero rows, `false`, harmless). This method MUST NOT touch the `students` row (REQ-007 historical preservation).
  - ADD `export * from "./applicant-conversion.service";` to `backend/services/teachers/index.ts` (domain barrel — sibling services are barrel-exported and re-exported via `@/backend/services`).
  - The service performs **no DB reads other than the idempotency probe**; all writes go through repo methods on the passed `tx` — the conversion is ATOMIC with the verdict (D2, D10), so this service NEVER opens its own transaction.
  - CREATE `backend/services/teachers/applicant-conversion.service.test.ts`: (a) fresh conversion inserts a zeroed student row AND flips the role; (b) re-invocation on an already-converted user is a no-op (no duplicate row, role unchanged) — idempotency; (c) `transitionRoleOnce` returns `false` for a non-`teacher` precondition → typed ConflictError (mock/spy the repo or drive via a DB test); (d) `restoreTeacherRole` flips `student`→`teacher` and leaves the `students` row byte-identical; (e) `restoreTeacherRole` on a `teacher`-role user is a silent no-op. DB-backed cases use `runInRollback`; spy-only cases assert the exact repo call arguments.
  - [x] **2.QL** `bun run scripts/health/sub-loop.ts backend/services/teachers/applicant-conversion.service.ts backend/services/teachers/applicant-conversion.service.test.ts --lifecycle duplicates` → 0
  - [x] **2.TE** (T1) 100% branches across both methods (row-exists / row-absent × flip-true / flip-false); (T2) `applicantUserId` with no `applicants` row but a `students` row (idempotent path), role already `student`; (T3 chaos) concurrent double invocation (both see no row, one insert wins, loser's `23505` is retried by the helper or caught by the outer tx) — assert exactly ONE `students` row survives; (T4 security) callers cannot pass an arbitrary role pair that escalates privileges (matrix is fixed to `teacher→student` and `student→teacher` only).
  - [x] **2.SEC** BOLA: the service never accepts a target user id from the wire (it is resolved server-side from the authenticated applicant). BOPLA: no client-supplied fields reach the insert (balances/parentId are helper-fixed). BFLA: the service is only reachable from the rubric finalization helpers and the certification path — not exposed on any GraphQL mutation.
  - [x] **2.SR** no `.types.ts` file; namespace export; `tx` threaded everywhere; reuses `createStudentWithHandshakeRetry` (no duplicated retry loop — grep for a second `HANDSHAKE_RETRY_LIMIT` definition returns zero); the retry-exhaustion `ConflictError` carries the localized `t.handshakeExhausted` leaf; the role invariant throws a plain `Error` (internal inconsistency, not user-facing); no logging on the happy/idempotent path (domain-service discipline — the no-op is an expected state, not a rejection).
  - [x] **2.IV** read printed rule files (`backend/services/AGENTS.md`, `backend.instructions.md`).
  - _Requirements: REQ-003, REQ-005, REQ-006, REQ-007, REQ-002, REQ-010_

## Phase 3 — Wiring into the rubric finalization helpers

- [x] **Task 3 · Wire into `finalizeRubricFail` + `finalizeRubricPass` (`evaluation-rubric.helpers.ts`) + rubric service tests**
  - `backend/services/teachers/evaluation-rubric.helpers.ts:384-395` — AMEND `finalizeRubricFail`: AFTER the guarded `ApplicantRepository.transitionToFailed(...)` succeeds (i.e. the verdict has committed its authoritative pre-state), call `await ApplicantConversionService.convertToStudent(applicantUserId, tx, t)` **inside the SAME `tx`** (D2). Ordering matters: the fail-transition is the concurrency guard (exactly one verdict commits); the conversion runs only once the guard passed. Any throw from the conversion propagates and **rolls back the entire submission transaction** (D10) — the verdict is NOT recorded without the student row.
  - **REQ-004 enforcement:** the conversion branch MUST NOT execute any `applicants` UPDATE/DELETE. Grep-verify: the diff of `finalizeRubricFail` introduces NO new `ApplicantRepository.*` write call and NO reference to `applicants` columns. The `applicants` row remains `status='failed'` with `cooldown_until` stamped by the shipped `transitionToFailed`.
  - Update the `finalizeRubricFail` **docblock** (`:384-395`): replace "NOTHING else is written: no suspension fields, no role-child rows, no role flips" with the amended contract — "the FAIL path additionally converts the applicant to a `student` in the SAME transaction (guarded role flip + zeroed `students` row + unique handshake code); the `applicants` row is untouched." (REQ-011 seed — Task 8 propagates to docs.)
  - `backend/services/teachers/evaluation-rubric.helpers.ts:342-374` — AMEND `finalizeRubricPass`: AFTER `ApplicantRepository.finalizeOnCertification(...)` succeeds, call `await ApplicantConversionService.restoreTeacherRole(applicantUserId, tx)` in the SAME `tx` (D5). This covers BOTH re-evaluation passes and admin cold-start certification (the admin path routes through the same helper). The `students` row is untouched (historical data — REQ-007). Failure to flip (e.g. already `teacher`) is a harmless no-op, so `restoreTeacherRole` MUST NOT throw on `false`.
  - Extend `backend/services/teachers/evaluation-rubric.service.test.ts`: (a) FAIL path now creates a zeroed `students` row + flips role to `student` AND leaves the `applicants` row `status='failed'` with `cooldown_until` intact; (b) PASS path after a prior conversion flips role back to `teacher` AND preserves the `students` row; (c) PASS path for a never-converted applicant is unaffected (role stays `teacher`); (d) an injected conversion failure (spy `convertToStudent` to throw) rolls back the verdict — the `applicants` row is NOT left `failed` and no `students` row exists (atomicity, REQ-006). Use the existing test harness for this service; keep `runInRollback` discipline for any DB-backed case.
  - Confirm the submission transaction body (`submitRubricEvaluationInTx`, `evaluation-rubric.helpers.ts:473-518`) already threads the single `tx` into both `finalizeRubricFail`/`finalizeRubricPass` — no signature change should be needed; if it is, keep `tx` as the last parameter.
  - [x] **3.QL** `bun run scripts/health/sub-loop.ts backend/services/teachers/evaluation-rubric.helpers.ts backend/services/teachers/evaluation-rubric.service.test.ts --lifecycle duplicates` → 0
  - [x] **3.TE** (T1) both call-sites exercised; (T2) boundary: conversion throws on the retry-exhaustion path → whole tx rolls back; (T3 chaos) a concurrent second submission for the same applicant loses the `transitionToFailed` guard and never re-runs the conversion; (T4 security) the conversion cannot be reached without passing the fail-transition guard.
  - [x] **3.SEC** the wiring introduces no new external entry point; tenancy is inherited from the existing applicant-id resolution; confirm no applicant-supplied role/balance value reaches the write path.
  - [x] **3.SR** same-`tx` guarantee proven (no nested `db.transaction` introduced — grep the new lines for `db.transaction` returns zero); applicants row untouched (grep proof for REQ-004); docblocks updated to match behavior (no stale "no role flips" text remains anywhere — `grep -rn "no role flips\|no role-child rows" backend/services/teachers/` returns zero after the edit); no `console.*`.
  - [x] **3.IV** read printed rule files (`backend/services/AGENTS.md`, `backend.instructions.md`, root).
  - _Requirements: REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-010_

## Phase 4 — Types & i18n plumbing

- [x] **Task 4 · Types + i18n plumbing (reuse `handshakeExhausted`)**
  - **i18n (primary):** REUSE the existing leaf `handshakeExhausted` in `shared/locale/en/errors/index.ts:75` and its Arabic parity entry in `shared/locale/ar/errors/index.ts`. Confirm the exact key path the service reads via `getServerTranslations(locale).errorsTranslations.<leaf>` — for the helper's `t` parameter, the WRONG key path would surface a runtime `undefined`; open both files and confirm the leaf name byte-for-byte before wiring the `buildExhaustedError` builder in Task 2.
  - **Decision gate — new key?** A new key is permitted ONLY if the reused copy is semantically wrong for the conversion context; if added, it MUST exist IDENTICALLY (same key, same shape) in BOTH `en` and `ar` and MUST pass the locale-parity test. Default: NO new key.
  - **Optional type (only if required):** if `convertToStudent`/`restoreTeacherRole` need a return shape (they do NOT — both return `void`), add it to `backend/types/teachers/` and re-export from the `backend/types/teachers/index.ts` barrel. Strong default: **no new type**; assert this and stop.
  - Run the existing errors-parity test (ar/en key sets must match) to green.
  - [x] **4.QL** `bun run scripts/health/sub-loop.ts shared/locale/en/errors/index.ts shared/locale/ar/errors/index.ts --lifecycle duplicates` → 0 (add `shared/locale/types/errors/labels.ts` only if a new key was added)
  - [x] **4.TE** parity test green; confirm the reused copy contains no unexpected interpolations (static leaf).
  - [x] **4.SEC** no user-controlled value is interpolated into the error copy (no reflected content).
  - [x] **4.SR** NO `Translation.` enum, NO two-arg `getTranslations`, NO `next-intl`; the leaf is consumed single-arg via `@/shared/locale/server-graphql`; en and ar are byte-identical in key structure.
  - [x] **4.IV** read printed rule files (`shared/locale/AGENTS.md`, `shared/AGENTS.md`, root).
  - _Requirements: REQ-002, REQ-003_

## Phase 5 — Journey test (authored test-first)

- [x] **Task 5 · Journey test (WRITE FIRST): `test/workflows/teachers/applicant-student-conversion.journey.test.ts`**
  - Author this journey **before** the wiring is exercised end-to-end (red → green). Read `test/workflows/AGENTS.md` first. Real services + real DB; **no `runInRollback`**; committed fixtures via `createJourneyCast("teachers")` (`test/workflows/helpers/journey-fixtures.ts:251`); errors captured via `catchJourneyError` (`:226`); actors via `provisionStudentActor` (`test/workflows/helpers/actor-context.ts:88`) and `provisionCertifiedTeacherActor` (`:105`); tracked `afterAll` cleanup via `test/workflows/helpers/journey-cleanup.ts`.
  - Model the structure on the shipped exemplars: `test/workflows/teachers/evaluation-rubric-scoring.journey.test.ts`, `test/workflows/teachers/verification-plan-purchase.journey.test.ts`, `test/workflows/admin/cold-start-certification.journey.test.ts`.
  - **Journey A — failed applicant gets a students record** (Gherkin AC 1; REQ-003/REQ-004/REQ-005):
    - Provision a `teacher`-role applicant, drive a rubric cycle to a **fail verdict** via the real service (5-session cycle reaching quorum-fail). Assert: a `students` row exists with `id == applicantUserId` (shared PK) via `StudentRepository.findHandshakeCodeByStudentId`; `balanceHifz == 0`, `balanceTajweed == 0`, `balanceReviews == 0`, `balanceTrial == 0`, `parentId == null`; the handshake code matches `HANDSHAKE_CODE_PATTERN` (`/^KSB-[0-9A-F]{8}$/` from `shared/constants/handshake-code.constants.ts`); `users.role == "student"`; the `applicants` row is **still present** with `status == "failed"` and `cooldown_until` set (READ it back — do not assume).
  - **Journey B — converted student subscribes + attends during cooldown** (Gherkin AC 2; REQ-008 / INV-TV6):
    - Refresh the converted actor's access token (exercise `AuthService.refreshToken` so the new `student` role is in the JWT — D9). Then consume the two student-gated surfaces end-to-end: `purchaseSubscription` (`backend/graphql/mutation/subscription-purchase.mutation.ts:63`, gated `role: [UserRole.Student]`) succeeds and a subscription row exists; `createSession` (`backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119`) is reachable and an attendable session row exists. Assert both succeed **as the converted account** (not via an admin proxy).
  - **Journey C — re-certification restores teacher, preserves student row** (Gherkin AC 3; REQ-007):
    - Drive the converted student through a **pass** (re-evaluation rubric pass, or `provisionCertifiedTeacherActor` cold-start certification), routed through `finalizeRubricPass`. Assert: a `teacher` row exists (created by the shipped pass path); `users.role == "teacher"` again; the `students` row is **still present and byte-identical** (same `handshake_code`, same zeroed balances — historical data preserved); `applicants.status == "passed"` with `cooldown_until == null`.
  - **Journey D — applicants row preserved across the full arc**: assert the `applicants` row is never deleted at any step (compare its `id`/`created_at` before and after).
  - **Authorization clause:** the generated GraphQL calls in Journeys B/C use the converted actor's own token (BFLA check in-journey) — never an admin token impersonating them.
  - Run: `bun test test/workflows` (and the focused path via `bun run test/scripts/run-test.ts test/workflows/teachers/applicant-student-conversion.journey.test.ts`).
  - [x] **5.QL** `bun run scripts/health/sub-loop.ts test/workflows/teachers/applicant-student-conversion.journey.test.ts --lifecycle duplicates` → 0
  - [x] **5.TE** (T1) all four journeys green; (T2) assert exact boundary values (three balances exactly `0`, not "falsy"); (T3 chaos) re-run a second fail cycle on an already-converted user → still exactly ONE `students` row, role stays `student` (idempotent); (T4 security) the conversion surfaces are not reachable without the real verdict path.
  - [x] **5.SEC** cross-tenant: a DIFFERENT applicant's token cannot observe or mutate the converted record; the handshake code of user A is never returned to user B.
  - [x] **5.SR** committed fixtures + tracked `afterAll` cleanup (grep the file for `afterAll`); no `runInRollback`; no raw `fetch` (use the journey client used by the exemplars); no `console.*`; localized assertions do not hardcode English copy.
  - [x] **5.IV** read printed rule files (`test/workflows/AGENTS.md`, `tests.instructions.md`, root).
  - _Requirements: REQ-003, REQ-004, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010_

## Phase 6 — Role-surface verification & SDL assertion

- [x] **Task 6 · GraphQL/role-surface verification + wire tests**
  - **Purpose:** prove the role flip is SUFFICIENT to satisfy INV-TV6 — i.e. that making the account `student` unlocks the shipped student-gated resolvers with ZERO resolver edits. This is a verification task, not a change task.
  - Enumerate the shipped student-gated surfaces and confirm each is `role: [UserRole.Student]` on the wire (open each file, confirm the gate): `purchaseSubscription` (`backend/graphql/mutation/subscription-purchase.mutation.ts:63`); `createSession` (`backend/graphql/mutation/classes/session-lifecycle.mutation.ts:119`); `myStudentSessions` (`backend/graphql/query/classes/session-lifecycle.query.ts:193`); handshake self-read (`backend/graphql/query/students/handshake-code.query.ts:63`); student homework; student evaluation.
  - Confirm the re-apply path is **unaffected by the flip**: `purchaseVerificationPlan` is `authenticated`-only (`backend/graphql/mutation/verification-plan-purchase.mutation.ts:50`) and its 422 `APPLICANT_COOLDOWN_ACTIVE` still carries the cooldown expiry — write a wire test asserting the converted student can still call `purchaseVerificationPlan` and receives the cooldown 422 (not a 403 role denial).
  - Write role-surface wire tests (GraphQL integration, grouped under the existing student/teachers wire-test location — locate the sibling file first; do NOT invent a new directory): assert the five student surfaces return **authorization-success** (not 403) for the converted student's token, and the teacher-only `myApplicantProfile` (`backend/graphql/query/teachers/applicant.query.ts:59`) returns a **403** for the converted student — this is the EXPECTED consequence of D6 and must be asserted so D6 is test-locked (a future widening of that gate will intentionally flip this assertion).
  - **D9 assertion:** verify `AuthService.refreshToken` (`backend/services/auth/auth.service.ts:257`) re-signs with the fresh DB `user.role`; add a focused test (or reuse an existing auth test) proving a token refreshed AFTER the flip carries `role: "student"` and grants the student surfaces — no forced revocation/logout (documented no-op; ledger D3).
  - **SDL neutrality (D8):** run `bun run generate:gqlSchema` + `bun codegen` and assert **no diff** in `backend/graphql/generated/**` and the schema SDL — the role flip changes no GraphQL field. If a diff appears, STOP and report (schema change was declared impossible by D8).
  - [x] **6.QL** `bun run scripts/health/sub-loop.ts <each new/extended wire-test file> --lifecycle duplicates` → 0
  - [x] **6.TE** (T1) every listed surface exercised for the converted actor; (T2) the 403 boundary on `myApplicantProfile`; (T3 chaos) refresh-then-call with a stale token vs a refreshed token (stale token still denied until refresh — documents D9 semantics); (T4 security) BFLA matrix per surface (student token allowed on student surfaces, denied on the teacher-only read).
  - [x] **6.SEC** BOLA: a converted student cannot read another user's sessions/handshake; BFLA: verify the exact 403/authorization outcomes per surface; confirm no resolver was widened (grep the diff — zero resolver-gate edits).
  - [x] **6.SR** zero resolver/gate changes (the whole point of D1); the `myApplicantProfile` 403 is asserted as intentional (D6), not a bug; no dead code; no `console.*`.
  - [x] **6.IV** read printed rule files (`backend/graphql/AGENTS.md`, `backend.instructions.md`, root).
  - _Requirements: REQ-005, REQ-007, REQ-008, REQ-010_

## Phase 7 — Final Quality Gate

- [x] **Task 7 · Final Quality Gate & Deferred-Items Enforcement**
  - Run `bun quality-gate` (tsgo → oxlint → biome:check → lint → duplicates). Do NOT clear caches. Resume from the last failed stage on re-run.
  - Run the schema-neutrality gate assertion (D8): `git status --porcelain` shows NO change under `backend/drizzle/`, `db/`, and no new migration SQL; `bun run db push` is NOT run.
  - Run the SDL gate assertion (D8): `git status --porcelain` shows NO change under `backend/graphql/generated/**`.
  - **Deferred-items enforcement:** open `deferred-items.md` and confirm all five ledger entries exist, are classified, and are cross-referenced (D1 cross-plan with the Cooldown plan; D2 audit stream; D3 by-design; D4/D5 child-ticket). Confirm `docs/teachers/applicant-lifecycle.md` (Task 8) points to this ledger. Fail the task if any ledger entry is missing or mis-classified.
  - Confirm every other task's `outcome/<task-id>-outcome.md` exists and its checkbox is flipped; run the full suite (`bun test test/workflows`, `bun run test:services`, `bun run test:db`).
  - Write `outcome/7-final-gate-outcome.md` with the gate log tail + the no-migration/no-SDL-diff proof.
  - _Requirements: REQ-001, REQ-010, REQ-011_

## Phase 8 — Knowledge Propagation

- [x] **Task 8 · Knowledge Propagation & Documentation**
  - `docs/teachers/applicant-lifecycle.md:75` — UPDATE §2.5 to state the NOW-SHIPPED behavior: the FAIL verdict atomically converts the applicant to a `student` in the same transaction (guarded role flip + zeroed `students` row + unique handshake code), the `applicants` row is untouched, and re-certification restores `teacher` while preserving the `students` row. Cross-reference the canonical doc (below) and the `deferred-items.md` ledger.
  - `docs/teachers/evaluation-rubric-scoring.md:162` — UPDATE the stale sentence that claims the FAIL path writes "no `students` row … no role flip". Replace it with the amended contract (this ticket SUPERSEDES that line). Also reconcile any matching sentence in the `finalizeRubricFail` docblock (Task 3 already edited the code-side docblock — ensure doc and code agree exactly).
  - CREATE (or point to) a canonical doc under `docs/teachers/` describing the conversion slice end-to-end: the role-flip rationale (D1) tied to FR-1.2 (`docs/specs/functional-requirements.md:18`) and INV-TV6 (`docs/specs/state-machine-invariants.md:92`); the atomicity guarantee (D2/D10); the idempotency contract (D3); the re-certification restoration (D5); the D6 deferral (`myApplicantProfile` remains Teacher-only); the D9 self-heal (token refresh, no revocation); and the D3/D4/D5 ledger pointers. Keep it under `docs/teachers/` (do NOT create a SUMMARY/REPORT file at the repo root or in the plan dir).
  - Link the new/updated doc from the `docs/teachers/` entry point (its `README`/index if one exists — locate it; if none, ensure `applicant-lifecycle.md` §2.5 is the canonical link target). If any `AGENTS.md` documents the FAIL-path contract, update it to match.
  - [x] **8.QL** `bun run scripts/health/sub-loop.ts <any changed markdown that a rule file governs> --lifecycle duplicates` → 0 where applicable (docs are typically lint-exempt; run only if the changed file is linted).
  - [x] **8.TE** N/A (documentation) — but re-run the full suite once more to confirm no doc-driven snapshot/test regressed.
  - [x] **8.SEC** the doc must NOT expose internal identifiers/secrets beyond what shipped docs already disclose.
  - [x] **8.SR** grep proof: `grep -rn "no role flip\|no role-child rows\|no \`students\` row" docs/` returns ZERO stale matches in the FAIL-path descriptions; every claim in the doc is traceable to a shipped code path or the pinned design decisions.
  - [x] **8.IV** read root `AGENTS.md`; confirm no misleading doc line survives.
  - _Requirements: REQ-011, REQ-001_

## Task Sequencing Summary

| # | Task | Depends on | Test-first? | Gate |
|---|---|---|---|---|
| 0 | Pre-Implementation Baseline & Outcome Protocol | — | — | baseline recorded |
| 1.5 | Plan Review Gate (`@plan-review`) | Task 0 | — | BLOCKING — no code before green |
| 1 | `UserRepository.transitionRoleOnce` + repo tests | 1.5 | — | sub-loop duplicates = 0 |
| 2 | `ApplicantConversionService` + tests | Task 1 | — | sub-loop duplicates = 0 |
| 3 | Wire into `finalizeRubricFail` / `finalizeRubricPass` + tests | Task 2 | — | sub-loop duplicates = 0 |
| 4 | Types + i18n plumbing (reuse `handshakeExhausted`) | — (parallel with 1–3) | — | parity test green |
| 5 | Journey test (WRITE FIRST) | authored alongside 1–3 | **YES** (red before green) | `bun test test/workflows` |
| 6 | GraphQL/role-surface verification + wire tests | Tasks 3, 5 | — | SDL no-diff |
| 7 | Final Quality Gate & Deferred-Items Enforcement | Tasks 1–6, 8 | — | `bun quality-gate` green |
| 8 | Knowledge Propagation & Documentation | Tasks 3, 6 | — | stale-line grep = 0 |

> **Ordering note:** Task 5 (journey) is authored test-first and may be written immediately after Task 1.5 (it encodes the Gherkin ACs and the D1/D5 role-flip expectations); it goes GREEN only after Tasks 1–3 land. Task 4 is independent and may run in parallel. Tasks 7 and 8 are order-tolerant (8 may precede 7); the final gate must be run last on the frozen tree.

## Deferred-Items Ledger Cross-Reference (from `deferred-items.md`)

| Ledger | Item | Disposition | Enforced by |
|---|---|---|---|
| D1 | `myApplicantProfile` scope widening to `[Teacher, Student]` — cross-plan with Cooldown plan | 📋 Deferred-to-follow-up | Task 6 (403 assertion test-locks current gate); Task 7 (ledger presence) |
| D2 | Audit-log row for the conversion — audit-completeness stream | 📋 Deferred-to-follow-up | Task 7 (ledger presence); Task 8 (doc pointer) |
| D3 | Forced session/token invalidation on role flip | 📋 Deferred-by-design (self-heals on refresh — D9) | Task 6 (refresh test); Task 8 |
| D4 | Conversion on the admin-override REJECT path — Admin Override ticket | 📋 Deferred-to-child-ticket | Task 7 (ledger presence) |
| D5 | Frontend surfacing of the conversion | 📋 Deferred-to-child-ticket | Task 7 (ledger presence) |

## Post-Implementation Review Wave (advisory, after Task 7)

- Dispatch a parallel per-file review over every file touched in Tasks 1–6 to confirm the `.SR` checklists held and no cross-file regression slipped in; fold findings into `outcome/post-implementation-review-outcome.md`.
- Confirm the D1 no-resolver-widening invariant with a repo-wide grep: no `role: [` gate in `backend/graphql/**` was modified in this plan's diff.
- Confirm the zero-migration invariant one final time (`git status` clean under `backend/drizzle/` and `db/`).
