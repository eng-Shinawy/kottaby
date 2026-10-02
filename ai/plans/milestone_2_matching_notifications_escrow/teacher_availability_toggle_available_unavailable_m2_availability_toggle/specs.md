# Requirements & Specification: Teacher Availability Toggle (Available/Unavailable)

> **Plan directory (verbatim — every header, ledger path, task `0.1`, and self-reference in this document uses this exact string):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle`
> **Ticket:** `Teacher Availability Toggle (Available/Unavailable)` — Owner Dev 2, Milestone 2, 3 SP, blocked by `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` (`docs/planning/TICKETS.md:1253-1294`; decision refs INV-A1, INV-A2, FR-4.1, FR-4.3).
> **Grounding docs:** `docs/specs/functional-requirements.md` §4 **FR-4.1** (Teacher Availability Toggle `:135-139`) + **FR-4.3** (In-Session Locking `:144-147`) · `docs/specs/state-machine-invariants.md` §3 **Teacher Availability Lifecycle** (`:97-125`; INV-A1 `:120`, INV-A2 `:121`, INV-A3 `:122`, INV-A4 `:123`) + **INV-S6** (`:47`) · `docs/planning/TICKETS.md:1253-1294` (this ticket) and sibling rows `:1298` (15-min auto-offline), `:1338` (in-session locking / hide-from-directory), `:1457`/`:1509` (matching + directory — INV-A3 owners), `:818` (cooldown state machine) · `docs/backend/cross-stream-contracts.md` **`TeacherAvailabilitySnapshotContract`** (contract row `:12`, TOCTOU rule `:119`) · `docs/workflows/02-on-demand-matching-workflow.md` §1 state machine (`:19-25`) + state table (`:85-93`) + data field map (`:134`).
>
> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).** The ticket's Gherkin describes four observable outcomes, but two of them name machinery owned by OTHER tickets, and one of those is not merely "deferred" — it is owned by a consumer that does not exist in-tree:
> - **"they appear in / are hidden from the Available Teachers directory" (INV-A3).** There is NO student-facing "Available Teachers directory" in the tree. Grep-verified: no `frontend/**` directory/availability surface, no `backend/services/**` matching service, no `backend/graphql/**` `availableTeachers`-style root field, no `availability` locale namespace. The directory's appearing/hiding is Dev 3 work (`docs/planning/TICKETS.md:1457` On-Demand Matching Algorithm, `:1509` Teacher Directory Browse & Filter API — the latter Blocked By the former). This ticket's obligation toward the directory is therefore EXACTLY ONE THING it can honor: **make `teacher.is_online` truthfully reflect the teacher's intent, so that whatever directory later reads it reads truth.** No directory code is written here.
> - **"teacher.is_online must be false (INV-A2)" on session start.** This is ALREADY SHIPPED by the session lifecycle: `SessionLifecycleService.startSession` composes `TeacherRepository.setOnline(started.teacherId, false, tx)` inside the start transaction, with a prior-online capture read (`backend/services/classes/session-lifecycle.service.ts:276-290`). This ticket does NOT rebuild it; it reuses the shipped INV-A2 *seam gate* (`assertTeacherNotInActiveSession`, `backend/services/classes/session-lifecycle.enforcement.ts:200-214`) to reject a concurrent toggle-to-Available.
> - **INV-A4 ("returns to Available only if still active").** The release path lives in `releaseTeacherInSessionLock` (`backend/services/classes/session-lifecycle.transitions.ts:249-256`) and is currently UNCONDITIONAL — a prior-online marker exists only as a transient local (`session-lifecycle.service.ts:276-280`), never persisted. Correct never-resurrect gating therefore requires the release transaction to be reworked, which belongs to the sibling `:1338` ticket. This ticket ships the seam gate that MAKES the toggle honest and records the INV-A4 release-path gating as a resolved-pointer deferred item (DEF-1; REQ-042) — it does NOT overload the release path here.
>
> **This ticket therefore ships exactly the slice it owns:** the canonical `TeacherAvailabilityService` (read + write), one additive canonical return type, a teacher-scoped GraphQL query + mutation, a minimal teacher-facing availability card on `/teacher/dashboard`, the new `availability` UI locale namespace, and full 4-tier + journey test locks — against the ZERO-DRIFT baseline (`teacher.is_online` exists; NO migration, NO enum, NO schema change). This reconciliation is the spec's governing ruling and must be ratified at Phase 1.5 plan review.

---

## 1. Executive Summary & Problem Statement

### 1.1 Feature Summary

The canonical teacher availability toggle. A certified teacher (`teacher.is_approved = true`) can manually flip his runtime availability between **Available** (`teacher.is_online = true`) and **Unavailable** (`teacher.is_online = false`) from the teacher dashboard; a non-certified teacher may never set Available; and a teacher who is inside a `started` session may not set Available. One new service (`TeacherAvailabilityService`) is the single writer of the toggle; one `query` + one `mutation` expose it; one dashboard card drives it.

### 1.2 Problem from user perspective

- **Certified Sheikh (actor):** his availability today can be driven FALSE by the session lifecycle but has NO owner that can drive it TRUE on demand, and no surface at all on the teacher dashboard to express "I am free to take sessions now". The platform's on-demand matching premise (`docs/workflows/02-on-demand-matching-workflow.md:10`) requires a truthful manual toggle; without it, a teacher is permanently Unavailable after his first session.
- **Non-certified teacher / applicant (would-be actor):** must be denied honestly with a 403 "Not certified" (INV-A1) — not silently granted availability, and not conflated with a 409 state conflict.
- **Teacher already in a session (actor):** must be unable to mark himself Available while `session.status = started` (INV-A2), so the in-session lock the lifecycle sets can never be self-overwritten mid-session.
- **Future directory / matching consumers (Dev 3):** need ONE canonical service + one canonical write primitive that keeps `teacher.is_online` truthful; re-implementing the toggle per surface would drift the semantics of "Available".

### 1.3 Business value

FR-4.1 and FR-4.3 are launch-gate requirements for the on-demand matching milestone. This ticket turns `teacher.is_online` from a lifecycle-driven flag into a teacher-controlled state with a certified-only, in-session-locked, transactional write path — the precondition for the Dev 3 directory (INV-A3) and the sibling 15-min auto-offline work (`:1298`, Blocked By this ticket).

### 1.4 Actors involved

Certified Sheikh (toggle owner; sole subject) · Non-certified teacher/applicant (denied actor) · Teacher in a `started` session (denied actor) · System (`SessionLifecycleService` — the existing INV-S6 lock/release writer, consume-only here) · Future directory/matching consumer (Dev 3 — read-side consumer of `teacher.is_online`, not built here).

### 1.5 Non-goals (explicitly OUT of scope)

- NO student-facing "Available Teachers directory" (INV-A3) — no directory query/mutation/service/route/nav item/component; owned by Dev 3 (`docs/planning/TICKETS.md:1457`, `:1509`).
- NO INV-A4 never-resurrect release-path gating — the release path (`releaseTeacherInSessionLock`) is NOT modified; gating it belongs to the sibling `:1338` ticket and needs a persisted prior-online marker that does not exist (DEF-1).
- NO 15-minute inactivity auto-offline sweep — sibling `:1298` (Blocked By this ticket); `users.last_active_at` (`backend/db/schema/users/users.ts:37`) is context only.
- NO schema change of any kind — `teacher.is_online` ALREADY EXISTS (`backend/db/schema/teachers/teacher.ts:28`); NO migration, NO new enum. `git diff backend/db/schema/** backend/db/migration/**` MUST be empty.
- NO new nav item, NO new route, NO bottom-nav change — the card mounts on the EXISTING `/teacher/dashboard` slot (`frontend/views/dashboard/home/RoleDashboardPage.tsx:72-78`).
- NO change to the public-operation allowlist (frozen six, `backend/lib/gateway/public-operations.ts:36-46`) — the toggle is authenticated and must NOT be added.
- NO new error keys — the three denial keys (`teacherNotCertified`, `teacherInActiveSession`, `teacherNotFound`) all exist (`shared/locale/types/errors/labels.ts:243,247,249`).
- NO change to `SessionLifecycleService`, `assertTeacherNotInActiveSession`, `TeacherRepository.setOnline`, or any session state transition.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger):** WHEN implementation begins THEN the executing agent SHALL record baseline error counts and SHALL initialize the tracking artifacts.
  - **REQ-001.1:** SHALL record `bun tsgo` error count, `bun biome:check` warning count, `bun run scripts/lint-service.ts --json --id baseline`, and `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit codes into `/tmp/baseline-*.txt`.
  - **REQ-001.2:** SHALL confirm the ledger `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/deferred-items.md` exists (seeded from `.agents/spec-process-guide/templates/deferred-items-template.md`) and is kept current.
  - **REQ-001.3:** SHALL write `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/outcome/0-baseline-outcome.md`.
  - **REQ-001.4:** Every forward (directory / release-gating / auto-offline) item MUST be recorded as a resolved-pointer entry naming its owning ticket — never open ❌/⚠️ debt at the final gate.
- **REQ-002 (i18n & Enum Value-Import Compliance):**
  - **REQ-002.1 (Service i18n):** the service SHALL resolve error copy via `getServerTranslations(locale)` from `@/shared/locale/server-graphql` — ONE argument, full `Translations` tree, then `.errorsTranslations` (VERIFIED signature at `shared/locale/server-graphql.ts:3`).
  - **REQ-002.2 (Client i18n):** the UI card SHALL use `useAppTranslation(Availability)` (a `defineNamespace` handle const) with property access, never a string literal and never a `Translation.*` enum.
  - **REQ-002.3 (Resolver i18n):** resolvers SHALL pass `ctx.locale` into the service (locale propagation, `backend/graphql/AGENTS.md`) and SHALL NOT translate inline beyond `ctx.t("errorsTranslations")` fallback usage.
  - **REQ-002.4 (Enum value imports):** ALL runtime enum usages (`UserRole`, `SessionStatus`) MUST be VALUE imports (never `import type`) and enum members, never raw string literals.
  - **REQ-002.5 (Forbidden set):** `next-intl`, `getBackendTranslations`, `shared/messages/` references, `console.*`, hardcoded user-facing strings, and a two-argument `getTranslations` are FORBIDDEN.
- **REQ-003 (Canonical Types Discipline):** WHEN any code is authored THEN entity types SHALL come from `backend/types/`.
  - **REQ-003.1:** consume existing `TeacherSelectType` (`backend/types/teachers/teacher.types.ts:3`), `DBTransaction`, `DBQueryExecutor`.
  - **REQ-003.2:** the ONLY additive type is ONE canonical interface `TeacherAvailabilityReturnType` in `backend/types/teachers/teacher.types.ts`, re-exported via its barrel (`backend/types/teachers/index.ts:4`) → `@/backend/types`.
  - **REQ-003.3:** NO local types in the service/resolver; NO service-layer `.types.ts` files (`backend/services/AGENTS.md`).
- **REQ-004 (Dependency Guard — Verify, Never Rebuild):** WHEN domain work begins THEN the agent SHALL verify (anchored, not re-created):
  - **REQ-004.1:** `TeacherRepository.setOnline(id, online, tx)` (`backend/db/repo/teachers/teacher.repository.ts:437`) + its seam docstring (`:398-447`, "the service layer composes WHEN … the future availability-toggle work owns the never-resurrect gating").
  - **REQ-004.2:** `TeacherRepository.findById(id, tx?)` (`:172`) and `TeacherRepository.lockForCertificationCheck(teacherId, tx)` (`:217`; `null` ⇒ no row, `isApproved === null` ⇒ NOT certified).
  - **REQ-004.3:** `assertTeacherNotInActiveSession(teacherId, tx, t?)` (`backend/services/classes/session-lifecycle.enforcement.ts:200-214`, re-exported `backend/services/classes/index.ts:6`) and `SessionRepository.listForTeacher(...)` (`backend/db/repo/classes/session.repository.ts:635`).
  - **REQ-004.4:** the `SessionStatus` enum (`backend/enum/scheduling/session-status.enum.ts:7-13`) and the `teacher` / `session` table shapes (`backend/db/schema/teachers/teacher.ts:19-38`, `backend/db/schema/classes/session.ts:54-92`).
  - **REQ-004.5:** IF any required artifact is missing THEN record a ❌ ledger entry and BLOCK the dependent task — never inline-patch a foreign layer.

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Canonical Service Surface):** WHEN the feature ships THEN it SHALL expose the NEW service namespace `TeacherAvailabilityService`.
  - **REQ-010.1:** file `backend/services/teachers/teacher-availability.service.ts`; registered via a new `export * from "./teacher-availability.service";` line in the existing alphabetical barrel `backend/services/teachers/index.ts`, transitively via the top-level `backend/services` barrel.
  - **REQ-010.2:** EXACTLY two public methods — `getAvailability(teacherId: number, locale: string): Promise<TeacherAvailabilityReturnType>` (read projection) and `setAvailability(teacherId: number, isOnline: boolean, locale: string, tx?: DBTransaction): Promise<TeacherAvailabilityReturnType>` (write; `outerTx` LAST per the house convention).
  - **REQ-010.3:** the namespace SHALL be the single writer of `teacher.is_online` for the MANUAL toggle; no other manual-toggle writer is added. `SessionLifecycleService` remains an independent lifecycle writer of the same column (INV-S6 lock/release) — this ticket does NOT reroute it.
- **REQ-011 (Toggle-to-Available — INV-A1 + INV-A2 then write `true`):** WHEN `setAvailability(teacherId, true, locale, tx?)` is called THEN the service SHALL, in ONE `withTransaction` (`backend/lib/db/with-transaction.ts:42`, imported deep — NOT from `@/backend/db`), execute in this exact order:
  - **REQ-011.1:** lock the teacher row via `TeacherRepository.lockForCertificationCheck(teacherId, tx)` (`:217`); IF `null` (no teacher row) THEN throw `NotFoundError("TEACHER", t.teacherNotFound)` (code `TEACHER_NOT_FOUND`, HTTP 404).
  - **REQ-011.2:** IF `isApproved !== true` (including `null` — treat as NOT certified) THEN throw `ForbiddenError(t.teacherNotCertified)` (code `FORBIDDEN`, HTTP 403) — REQ-014.
  - **REQ-011.3:** call the shipped INV-A2 gate `assertTeacherNotInActiveSession(teacherId, tx, t)` which throws `ConflictError("TEACHER_IN_ACTIVE_SESSION")` (HTTP 409) when a `started` session exists — REQ-015.
  - **REQ-011.4:** ONLY THEN call `TeacherRepository.setOnline(teacherId, true, tx)` and return the projected state (REQ-013).
  - **REQ-011.5 (gate order):** certification (403) is decided BEFORE the in-session check (409), so a non-certified teacher who also happens to be in a session sees the certification denial, not the state conflict.
- **REQ-012 (Toggle-to-Unavailable — always allowed):** WHEN `setAvailability(teacherId, false, locale, tx?)` is called THEN the service SHALL perform ONLY the existence check (lock-for-certification read; `null` ⇒ `TEACHER_NOT_FOUND`) and then `TeacherRepository.setOnline(teacherId, false, tx)`.
  - **REQ-012.1:** the certification gate SHALL NOT block an offline transition — an uncertified teacher may still go offline (repo docstring `:398-447`).
  - **REQ-012.2:** the in-session gate SHALL NOT block an offline transition — a teacher inside a session is already offline (INV-A2), so re-asserting `false` is a sanctioned idempotent write.
  - **REQ-012.3:** this asymmetry (Available gated, Unavailable ungated) IS the core INV-A1/INV-A2 semantic and SHALL be pinned by tests.
- **REQ-013 (State Projection / Return Type):** WHEN either method returns THEN it SHALL return `TeacherAvailabilityReturnType = { id: number; isOnline: boolean; isApproved: boolean }`.
  - **REQ-013.1:** `id` from the teacher row (Apollo cache normalization, `backend/graphql/AGENTS.md`).
  - **REQ-013.2:** `isOnline` normalized to a non-nullable boolean (column default `false`; a stray `null` projects as `false`).
  - **REQ-013.3:** `isApproved` normalized to a non-nullable boolean (`true` iff the stored value is `true`; the column is nullable, `backend/db/schema/teachers/teacher.ts:25`).
  - **REQ-013.4:** `getAvailability` SHALL load the row via `TeacherRepository.findById(teacherId)` (`:172`) and throw `NotFoundError("TEACHER", t.teacherNotFound)` when absent; NO field beyond these three is projected (BOPLA read-side minimality).
- **REQ-014 (Certification Gate — INV-A1):** WHEN a toggle-to-Available is attempted by a caller whose `teacher` row has `isApproved` not strictly `true` THEN the service SHALL deny with `new ForbiddenError(t.teacherNotCertified)`.
  - **REQ-014.1:** `ForbiddenError` (`backend/lib/errors.ts:51`) is the ONLY class yielding `extensions.code = "FORBIDDEN"` → HTTP 403 (`backend/lib/errors/error-code-taxonomy.ts:41-51`); a custom SCREAMING_SNAKE code normalizes to `null` and CANNOT produce a 403.
  - **REQ-014.2:** the denial SHALL use the existing `teacherNotCertified` key (`shared/locale/types/errors/labels.ts:243`; en `shared/locale/en/errors/index.ts:108`) — no new key.
  - **REQ-014.3:** this deliberately DIFFERS from the booking/rubric VALIDATION-class `TEACHER_NOT_CERTIFIED` toast consumed by `frontend/providers/apollo/error-link.map.ts:346-360` — the toggle's 403 is the ticket-accurate "Not certified" outcome (D3).
- **REQ-015 (In-Session Gate — INV-A2, reuse the shipped gate):** WHEN a toggle-to-Available is attempted while the teacher is in a `started` session THEN the service SHALL reuse `assertTeacherNotInActiveSession(teacherId, tx, t)` VERBATIM.
  - **REQ-015.1:** the gate probes `SessionRepository.listForTeacher(teacherId, { status: SessionStatus.Started }, 1, 0, tx)`; on a hit it logs ONE bounded domain error and throws `ConflictError("TEACHER_IN_ACTIVE_SESSION", t.teacherInActiveSession)` (HTTP 409).
  - **REQ-015.2:** NO re-implementation, NO new query, NO modification of the gate file — reuse IS the requirement; the gate's oracle rule (no session id disclosed) and its single log call MUST NOT be re-authored.
- **REQ-016 (Zero Schema / Enum Drift):** WHEN this ticket completes THEN `git diff backend/db/schema/** backend/db/migration/**` SHALL be EMPTY; `teacher.is_online` is consumed as-is (`backend/db/schema/teachers/teacher.ts:28`, nullable default `false`), the shared PK/FK to `users.id` with cascade (`:22-24`) is untouched, and NO new `pgEnum` / `backend/enum/**` file is introduced. `SessionStatus` is consumed read-only through the reused gate.
- **REQ-017 (Idempotency / Same-Value):** WHEN `setAvailability` is called with a value equal to the stored `is_online` THEN the service SHALL still execute and return the projected state (the guarded UPDATE returns the row for a redundant same-value write — `teacher.repository.ts:437-447`, "idempotent under retry by construction"). A repeated Available toggle by a certified, non-in-session teacher SHALL succeed with ZERO error; a repeated Unavailable toggle SHALL succeed likewise; the read-after-write value SHALL reflect the persisted value.
- **REQ-018 (Dependency Boundary & Out-of-Scope Pointers):** WHEN scope is evaluated THEN the service SHALL perform ZERO session writes, ZERO `users` writes, ZERO `is_approved` writes, and SHALL NOT add a directory/appearance side effect; the ONLY write is `TeacherRepository.setOnline`.
  - **REQ-018.1:** INV-A3 directory appearance → `docs/planning/TICKETS.md:1457`/`:1509` (Dev 3).
  - **REQ-018.2:** INV-A4 release-path never-resurrect → `:1338`.
  - **REQ-018.3:** 15-min auto-offline → `:1298`.
  - **REQ-018.4:** Cooldown State Machine (`:818`) blocks this ticket by lineage/scheduling ONLY (it writes `applicants.cooldown_until`, never `teacher.is_online`) — a scheduling dependency, not a code dependency (D10).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BFLA / AuthZ — role scope + service-side certification, self-only):** WHEN the GraphQL surface ships THEN both `myTeacherAvailability` (query) and `setTeacherAvailability` (mutation) SHALL declare `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }`.
  - **REQ-030.1:** the explicit `$all` conjunction is required (anonymous → `UNAUTHORIZED`/401; authenticated non-teacher → `FORBIDDEN`/403), per `backend/graphql/AGENTS.md` scope-composition rule and the precedent at `backend/graphql/mutation/classes/student-evaluation.mutation.ts:66-71`.
  - **REQ-030.2:** the role scope is NOT the certification gate — certification is enforced SERVICE-SIDE (REQ-014) because `UserRole.Teacher` says nothing about `is_approved`.
  - **REQ-030.3:** neither operation is added to the public-operation allowlist (`backend/lib/gateway/public-operations.ts:36-46`, frozen six).
- **REQ-031 (BOLA / IDOR — actor id from `ctx.user.id` only):** WHEN either resolver runs THEN the teacher id SHALL be derived EXCLUSIVELY from `ctx.user.id` (the verified access-token user), NEVER from an argument.
  - **REQ-031.1:** the query takes NO arguments; the mutation takes exactly ONE input field (`isOnline: Boolean!`) and NO id — self-only by construction.
  - **REQ-031.2:** precedence: `backend/graphql/query/teachers/applicant.query.ts` zero-argument identity derivation.
- **REQ-032 (BOPLA — closed construction, boolean-only input):** WHEN the mutation input is authored THEN it SHALL carry EXACTLY one non-nullable `Boolean` field `isOnline`.
  - **REQ-032.1:** NO spread of client objects into the service, NO object echo, NO writable field beyond the boolean; the service signature accepts a bare `boolean`.
  - **REQ-032.2:** `{ ...input }` spreads into service calls are PROHIBITED.
- **REQ-033 (PII Minimality in Logs):** WHEN a denial fires THEN the log context SHALL carry at most `{ code, entity: "teacher", entityId: teacherId, locale }` — NEVER teacher name, email, phone, subjects, or the raw input payload. The INV-A2 gate already logs its denial (`assertTeacherNotInActiveSession`, `:210-214`); the service SHALL NOT add a second log for the gate denial (one bounded call per denial — REQ-053). Happy path logs NOTHING.
- **REQ-034 (Oracle Safety — no session id disclosed):** WHEN the in-session denial surfaces THEN the message SHALL be the reused `teacherInActiveSession` copy with `extensions.code = "TEACHER_IN_ACTIVE_SESSION"` and SHALL disclose NO session id, status, counterparty, or count (the gate's invariant, reused verbatim). The `TEACHER_NOT_FOUND` (404) and `FORBIDDEN`/403 shapes disclose only the caller's own account posture — a teacher probing his own availability never sees another teacher's state.

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Transaction Composition — ONE `withTransaction`):** WHEN `setAvailability` executes THEN ALL of {existence lock, certification read, INV-A2 probe, `setOnline` write} SHALL compose inside a single `withTransaction(outerTx, async tx => …)` call (`backend/lib/db/with-transaction.ts:42`).
  - **REQ-040.1:** a denial rolls back with ZERO writes; a successful flow commits lock+read+write as one unit.
  - **REQ-040.2:** a caller-supplied `tx` SHALL be the `outerTx` and SHALL be joined, never bypassed; the global `db` handle SHALL NEVER be used inside the write path when a `tx` is in scope.
  - **REQ-040.3:** `getAvailability` (read-only) may run on the global executor via `findById(id)`.
- **REQ-041 (Lock Ordering / Deadlock Assessment):** WHEN the write composes its statements THEN the lock acquisition order SHALL be: `teacher` row `FOR UPDATE` (`lockForCertificationCheck`) → `session` read (gate's `listForTeacher`, no lock) → `teacher` row `UPDATE`.
  - **REQ-041.1:** the sole row lock is the caller's own teacher row (one row, one acquisition); all subsequent statements address the same row or read-only projections ⇒ NO second-row lock and no lock-ordering cycle.
  - **REQ-041.2:** the session lifecycle locks the session row first then writes the teacher row — a DIFFERENT first resource; concurrent toggle-vs-session-start is serialized by row-level locking, not crossed.
  - **REQ-041.3:** the plan SHALL record this as a reasoned no-cycle argument; a race test SHALL assert one winner and a consistent final value (REQ-071 Tier-3).
- **REQ-042 (Never-Resurrect (INV-A4) — DEFERRED POINTER + HAZARD):** WHEN scope is bounded THEN this ticket SHALL NOT gate the release path.
  - **REQ-042.1 (hazard, documented):** `releaseTeacherInSessionLock` (`backend/services/classes/session-lifecycle.transitions.ts:249-256`) currently writes `is_online = true` UNCONDITIONALLY on every `started`-exit, and the prior-online capture at start (`session-lifecycle.service.ts:276-280`) is a transient local never persisted — so a teacher who was OFFLINE before a session is resurrected to Available on release, violating INV-A4.
  - **REQ-042.2:** correct gating requires a persisted prior-online marker (or an "active session" predicate at release) and belongs to the sibling `docs/planning/TICKETS.md:1338` ticket.
  - **REQ-042.3:** this ticket SHALL record the item in `deferred-items.md` as a resolved-pointer to `:1338` with the hazard note and SHALL add NO release-path code.
- **REQ-043 (Repo Write Discipline):** WHEN the write executes THEN it SHALL go through the EXISTING `TeacherRepository.setOnline(id, online, tx)` (`:437`) — no new repo write method, no inline Drizzle UPDATE, no raw SQL. The existing write is parameterized, guarded by row identity, `tx`-required, and returns the updated row (or `null`). IF `setOnline` returns `null` (row vanished between lock and write — structurally unreachable under the same-tx `FOR UPDATE`) THEN the service SHALL fail closed with `NotFoundError("TEACHER", t.teacherNotFound)` rather than returning a phantom projection.

### 2.5 Validation & Error Contracts

- **REQ-050 (Input Validation):** WHEN `setAvailability` is invoked THEN `isOnline` SHALL be validated as a strict `boolean` (the Pothos `Boolean!` input enforces this at the boundary; the service SHALL treat a non-boolean defensively and reject with `ValidationError(t.validation)`); the derived `teacherId` SHALL be a positive safe integer (`ctx.user.id` from a verified context — valid by construction; a malformed value SHALL throw `ValidationError` before any DB work). `getAvailability` has no client input beyond the context-derived id.
- **REQ-051 (Error Contract / Codes):** WHEN any failure surfaces THEN it SHALL be a `DomainError` subclass with the exact HTTP semantics below; plain `new Error(...)` in the flow is PROHIBITED; unexpected internals bubble UNCATCHED to the masking boundary (`docs/graphql/error-handling-contract.md`).

| Condition | Class | `extensions.code` | HTTP |
|---|---|---|---|
| No `teacher` row (read or write) | `NotFoundError("TEACHER", …)` | `TEACHER_NOT_FOUND` | 404 |
| `isApproved !== true` on Available | `ForbiddenError(…)` | `FORBIDDEN` | 403 |
| `started` session on Available (gate) | `ConflictError("TEACHER_IN_ACTIVE_SESSION", …)` | `TEACHER_IN_ACTIVE_SESSION` | 409 |
| Non-boolean / malformed id | `ValidationError(…)` | `VALIDATION` | 422 |

- **REQ-052 (Localized Errors — reuse keys only):** WHEN error copy is resolved THEN it SHALL use the THREE existing keys — `teacherNotCertified` (`shared/locale/types/errors/labels.ts:243`; en `:108`, ar `:106`), `teacherInActiveSession` (`:247`; en `:110`), `teacherNotFound` (`:249`) — resolved via `getServerTranslations(locale).errorsTranslations` with ONE argument. NO new `errors`-namespace key is minted; the `errors`-namespace parity suite SHALL remain green UNEDITED.
- **REQ-053 (Logging Discipline):** WHEN an expected rejection fires THEN exactly ONE bounded `logger.logDomainError(message, ctx)` (`backend/lib/logger.ts:92`, message-first) SHALL be emitted for the branches the SERVICE owns (the certification 403 and the not-found 404), with the REQ-033 context. The INV-A2 gate's own log is the sole log for the in-session 409 (the service adds none). The happy path SHALL emit ZERO domain logs. `console.*` is FORBIDDEN; the logger import is `@/backend/lib/logger` (never `@/frontend/utils/logger`).

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (GraphQL Surface — one query + one mutation):** WHEN the schema is rebuilt THEN it SHALL gain EXACTLY:
  - **REQ-060.1:** query `myTeacherAvailability: TeacherAvailabilityState!` (non-nullable; resolver returns the projected state or throws for a missing teacher row).
  - **REQ-060.2:** mutation `setTeacherAvailability(isOnline: Boolean!): TeacherAvailabilityState!`.
  - **REQ-060.3:** both SHALL carry the REQ-030 `$all` scope.
  - **REQ-060.4 (files):** NEW `backend/graphql/query/teachers/teacher-availability.query.ts` (side-effect import added to `backend/graphql/query/teachers/index.ts:18-21`); NEW `backend/graphql/mutation/teachers/teacher-availability.mutation.ts` + NEW `backend/graphql/mutation/teachers/index.ts` sub-barrel + NEW side-effect import in `backend/graphql/mutation/index.ts` (currently NO `./teachers` entry exists).
  - **REQ-060.5:** resolvers delegate to `TeacherAvailabilityService` and pass `ctx.locale`; the mutation passes `args.isOnline` and the derived `ctx.user.id`.
- **REQ-061 (Pothos Object / Input):** WHEN the Pothos types are authored THEN:
  - **REQ-061.1:** object `gqlSchemaBuilder.objectRef<TeacherAvailabilityReturnType>("TeacherAvailabilityState")` with EXACTLY three structurally-mapped fields (`id: t.exposeInt`, `isOnline: t.exposeBoolean`, `isApproved: t.exposeBoolean`), in `backend/graphql/pothos/teachers/teacher-availability.pothos.ts`, registered transitively through the resolver's import (the `graphql/pothos` barrel does NOT enumerate teachers).
  - **REQ-061.2:** input — ONE pinned shape: `gqlSchemaBuilder.inputType("SetTeacherAvailabilityInput")` with exactly one non-nullable `isOnline: t.field({ type: "Boolean", required: true })`, OR a bare `isOnline: t.arg({ type: "Boolean", required: true })` on the mutation. The plan SHALL pin ONE and exactly one.
  - **REQ-061.3:** NO local type definitions in the Pothos file — the object is backed by the canonical `TeacherAvailabilityReturnType` (`backend/graphql/pothos/AGENTS.md`).
- **REQ-062 (SDL / Gate Regen + Test Inventories):** WHEN the schema changes THEN `bun run generate:gqlSchema && bun codegen` SHALL be run, and the schema-surface gate SHALL be updated IN THE SAME CHANGESET.
  - **REQ-062.1:** a NEW `TEACHER_AVAILABILITY_QUERY_FIELDS = ["myTeacherAvailability"] as const` and `TEACHER_AVAILABILITY_MUTATION_FIELDS = ["setTeacherAvailability"] as const` const pair, included in the exact-match `expect(names).toEqual([...])` lists at `backend/graphql/test/schema-surface.test.ts:1097` (mutation root) and the query-root pin `:972-1006`.
  - **REQ-062.2:** `frontend/graphql/test/gateway/allowlist-coverage.test.ts:135,142,158` exact 1:1 agreement SHALL stay green with NO allowlist edit (both operations are scoped).
  - **REQ-062.3:** the committed `frontend/graphql/generated/schema.graphql` byte-parity check SHALL stay green after codegen.
- **REQ-063 (Frontend Documents & Component — minimal card, no route/nav):** WHEN the UI ships THEN it SHALL add:
  - **REQ-063.1:** NEW document `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.ts` exporting `myTeacherAvailabilityQueryDocument` (zero-arg `TypedDocumentNode`, selecting `id`, `isOnline`, `isApproved`) and `setTeacherAvailabilityMutationDocument` (one `$isOnline: Boolean!` variable, selecting `id`, `isOnline`, `isApproved`), with `id` present for cache normalization.
  - **REQ-063.2:** NEW client component `TeacherAvailabilityCard` at `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx` (added to the `frontend/views/teachers/dashboard/index.ts` barrel) using stateful `useQuery`/`useMutation` from `@apollo/client/react` (NO `useLazyQuery`), MUI v9 `sx` props only, theme-palette colors only, rendering a Switch/ActionArea and its confirmation. Label copy is the frozen 8-slot `availability` namespace key set: `cardTitle`, `toggleToAvailableCta`, `toggleToUnavailableCta`, `certificationRequiredHint`, `inSessionLockedHint`, `updateSuccess`, `updateGenericError`, `loadErrorNotice`.
  - **REQ-063.3:** mounting in the teacher slot of `frontend/views/dashboard/home/RoleDashboardPage.tsx:72-78` alongside `<ApplicantStatusCard />` + `<TeacherUpNextCard />`.
  - **REQ-063.4:** NO new route, NO new nav item (`frontend/views/dashboard/nav/navItems.ts` stays byte-identical), NO bottom-nav work; the card reflects the server-returned `isOnline` after mutation (server-authoritative; optimistic UI optional and, if used, reconciled from the mutation result).

### 2.7 Test Coverage

- **REQ-070 (Repository Tier):** WHEN `setOnline`/`findById`/`lockForCertificationCheck` are exercised THEN the agent SHALL EXTEND the existing tests at `backend/db/test/repo/teachers/teacher.repository.test.ts:393-500` (do NOT duplicate) inside `runInRollback` with `tx` propagated to every call and fixtures from `backend/db/test/entity-setup.ts` (verify signatures before use). Repo coverage for the touched file SHALL remain at target (100%); a redundant same-value `setOnline` SHALL return the row (idempotency assertion).
- **REQ-071 (Service 4-Tier Suite):** `backend/services/teachers/teacher-availability.service.test.ts` SHALL cover, inside `runInRollback` with a try/catch helper (NEVER `expect(...).rejects.toThrow()`):
  - **REQ-071.1 (Tier-1 branches):** Available happy path (certified, no active session → `setOnline(true)`); Unavailable happy path (uncertified allowed → `setOnline(false)`); certification denial (403); in-session denial (409); not-found (404) for both read and write; and the null-`setOnline` fail-closed branch.
  - **REQ-071.2 (Tier-2 boundaries):** `isApproved=null` treated as not-certified; non-boolean input → `VALIDATION`; same-value toggle idempotency; `getAvailability` on a missing row.
  - **REQ-071.3 (Tier-3 chaos):** a concurrent toggle-vs-toggle pair (`Promise.allSettled`) both resolved with a consistent final `is_online`; a tx-composed call joined into a caller transaction returning a tx-scoped result.
  - **REQ-071.4 (Tier-4 security):** gate-order proof (a non-certified teacher with a started session sees `FORBIDDEN` not `CONFLICT`); the derived-id invariant (no code path accepts a client id); and a log-spy count of exactly ONE per owned denial / ZERO on happy paths.
- **REQ-072 (Workflow Journey Test — teacher × session-state):** `test/workflows/teachers/teacher-availability.journey.test.ts` SHALL be written following `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`:
  - **REQ-072.1:** committed fixture cast in `beforeAll` (ONE committing transaction), tracked hard-delete + zero-residue re-probe in `afterAll`, unique `jrn_avail_<uuid8>` prefix.
  - **REQ-072.2:** actors via `provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:105-116`) plus `buildSessionJourneyCast`.
  - **REQ-072.3:** a `session` row in `started` state is REQUIRED as the INV-A2 fixture (committed via a direct insert per the sanctioned fixture-level pattern); the alternative — driving the real `SessionLifecycleService.startSession` — SHALL be preferred IF the harness supports it cheaply.
  - **REQ-072.4:** run via `bun run test/scripts/run-test.ts test/workflows/teachers/teacher-availability.journey.test.ts`; scenario content in §2.9.
- **REQ-073 (Test Runner Discipline):** WHEN any test runs THEN it SHALL use `bun run test/scripts/run-test.ts <path>` (with `--last` / `--focus` for inspection) — NEVER raw `bun test` for workflow/service files with transaction semantics; the repo-co-located service suite runs via `bun run test:services`; DB repo tests via `bun run test:db`. No `console.*` in tests; `bun:test` imports only.
- **REQ-074 (Coverage Gates / Regression Locks):** WHEN the ticket completes THEN the NEW service file SHALL meet the service-tier coverage expectation (all branches incl. every denial), the touched repo file SHALL hold 100% coverage, the `errors`-namespace parity suite and `schema-surface.test.ts` / `allowlist-coverage.test.ts` SHALL be green (the latter two updated ONLY for the REQ-062 inventory additions), and `bun run generate:gqlSchema && bun codegen` SHALL be a recorded no-diff beyond the new operations.
- **REQ-075 (Baseline Gate):** WHEN the ticket completes THEN tsgo/biome/lint counts SHALL equal the REQ-001 baseline + ZERO new errors; EVERY created/modified file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0; the deferred ledger final gate shows `grep -cE '^\s*\|.*(❌|⚠️)' <plan-dir>/deferred-items.md` = 0 (row-scoped — the template legend lines are exempt); the INV-A3/INV-A4/auto-offline items are resolved-pointers to their owning tickets.

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Outcome Protocol):** WHEN any task executes THEN the executor SHALL read all prior files in `<plan-dir>/outcome/` first, write `<plan-dir>/outcome/<task-id>-outcome.md` per task, keep task checkboxes current, and record the baseline capture (REQ-001) in `<plan-dir>/outcome/0-baseline-outcome.md`.
- **REQ-081 (Knowledge Propagation — canonical doc):** WHEN implementation completes THEN `docs/teachers/teacher-availability.md` SHALL be created (Why → the Available/Unavailable state + certification/in-session gate table → Rules: single-service writer, `$all` role scope, self-only identity, `ForbiddenError` for 403 vs the booking `TEACHER_NOT_CERTIFIED` conflict, tx composition + gate order → What NOT to Do: never add a directory here, never gate the release path here, never widen the input beyond the boolean, never mint new error keys → Rollout file table → Forward Contracts: INV-A3 directory appearance (`:1457`/`:1509`), INV-A4 release gating (`:1338`), 15-min auto-offline (`:1298`) → Related Documents). `docs/backend/cross-stream-contracts.md` `TeacherAvailabilitySnapshotContract` SHALL receive at most a one-line shipped-pointer (no structural edit).
- **REQ-082 (Deferred Ledger Discipline):** WHEN deferrals are recorded THEN `<plan-dir>/deferred-items.md` SHALL contain resolved-pointer rows per the table below; NO open ❌/⚠️ rows at the final gate (REQ-075).

| Deferred item | Owning ticket | Lineage |
|---|---|---|
| INV-A3 directory appearance/hiding | On-Demand Matching Algorithm / Teacher Directory Browse | `docs/planning/TICKETS.md:1457` / `:1509` |
| INV-A4 release-path never-resurrect gating | In-Session Locking (Hide from Directory) | `docs/planning/TICKETS.md:1338` (with the REQ-042 hazard note) |
| 15-min inactivity auto-offline | 15-Minute Inactivity Auto-Offline | `docs/planning/TICKETS.md:1298` |

- **REQ-083 (No AGENTS.md / instruction Edits):** WHEN propagation runs THEN **NO `AGENTS.md` or `.agents/instructions/*.md` file is modified** — `backend/services/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/db/repo/AGENTS.md`, root `AGENTS.md`, and every `.agents/instructions/*.md` file SHALL NOT be edited (they are hand-curated) unless a genuinely NEW, durable rule is minted. The expected state is NO such edit: the toggle follows existing service/graphql/repo/i18n conventions and adds no new rule. The canonical doc (REQ-081) is the knowledge home.

### 2.9 Cross-Actor Workflow Scenarios (Journeys) — teacher × session-state over shared state

**Actor Table**

| Actor | Role / Provisioning | Can Do | Cannot Do |
|---|---|---|---|
| Certified Teacher T | `users.role=teacher` + `teacher` row (`isApproved=true`); locale `ar` | toggle Available (off-session) and Unavailable; read his own availability | toggle while a session is `started`; affect another teacher's row; see another teacher's state |
| Non-Certified Teacher N | `users.role=teacher` + `teacher` row (`isApproved=false` OR `null`) | toggle Unavailable | set Available (403 Not Certified, INV-A1) |
| Session-Started Teacher S | `users.role=teacher` + `teacher` row (`isApproved=true`) + committed `session` row with `status=started` for S | toggle Unavailable (no-op re-assert) | set Available while the session is `started` (409, INV-A2) |
| Session-State Owner (System) | the shipped `SessionLifecycleService` writer of the INV-S6 lock | force `is_online=false` on session start; release on exit | be triggered from the toggle surface (no toggle→lifecycle call) |
| Isolation Observer O | unrelated committed teacher row | observe NOTHING change on T/N/S toggles | appear as any toggle's subject |
| System (fixture layer) | committed direct inserts for the `started` session row + actors | seed fixtures, invoke services directly | leave residue after teardown |

**Ordered Step List** (each row maps to journey assertions; "→" = shared-state change + side effects):

| # | Actor | Action | Shared-state change + side effect |
|---|---|---|---|
| 1 | System | commit cast: T (`isApproved=true`, ar), N (`isApproved=false`), S (`isApproved=true`) + a `started` `session` row for S; observer O | all rows committed in ONE `beforeAll` transaction (fixture-level direct insert for the `started` row — SANCTIONED, the started transition is owned by the lifecycle caller) |
| 2 | T | `setAvailability(T.id, true, "ar")` | `teacher.is_online=true` for T; returns `{ id:T.id, isOnline:true, isApproved:true }`; ZERO domain logs |
| 3 | T | `getAvailability(T.id, "ar")` | fresh read observes `isOnline=true` (truth persisted across the commit) |
| 4 | T | `setAvailability(T.id, false, "ar")` | `is_online=false`; the "hidden from directory" observable is asserted at the DATA level only (no directory exists — the column is the whole contract) |
| 5 | N | `setAvailability(N.id, true, "ar")` → DENIED; then `setAvailability(N.id, false, "ar")` → ALLOWED | 403 `FORBIDDEN` with `teacherNotCertified` copy; N's `is_online` unchanged; exactly ONE owned domain log. Then an uncertified teacher may go offline |
| 6 | S | `setAvailability(S.id, true, "ar")` → DENIED | 409 `TEACHER_IN_ACTIVE_SESSION` with `teacherInActiveSession` copy; S's `is_online` stays `false`; the gate's ONE log is the only log (message contains no session id) |
| 7 | Session-State Owner | (already applied in fixture) | demonstrates INV-A2: a teacher in `started` state has `is_online=false` and cannot self-set it true; S's row stays `false` across step 6 |
| 8 | Isolation Observer O | row-count / value oracle for O | UNCHANGED at journey end (cross-actor invariance: T/N/S toggles never touch O) |
| 9 | System (teardown) | tracked hard-delete of all fixture rows (the `session` row, the three `teacher` rows, the users rows) in FK-safe order | `verifyAllAbsent` re-probes MUST show zero residue |

**Cross-Actor EARS Criteria (observer-perspective):**

- **REQ-090 (Journey J-AV-1 — Available):** WHEN the certified teacher T toggles Available THEN the system SHALL persist `teacher.is_online = true` for T AND return `{ id, isOnline: true, isApproved: true }` AND a subsequent read SHALL observe `true` AND NO other actor's availability SHALL change.
- **REQ-091 (Journey J-AV-2 — Unavailable):** WHEN T toggles Unavailable THEN the system SHALL persist `teacher.is_online = false` AND the same toggle SHALL succeed regardless of certification or session state (an uncertified or in-session teacher may always go offline).
- **REQ-092 (Journey J-AV-3 — Null input node, validation edge):** WHEN the mutation is invoked with a missing/`null` `isOnline` variable THEN the GraphQL boundary SHALL reject it as a validation error BEFORE the resolver runs, leaving `is_online` byte-identical (defense-in-depth with REQ-050).
- **REQ-093 (Journey J-AV-4 — Non-certified denial):** WHEN the non-certified teacher N (a PRESENT `teacher` row with `isApproved=false` — distinct from the absent-row `TEACHER_NOT_FOUND`/404 probe) attempts to toggle Available THEN the system SHALL reject with `FORBIDDEN` (HTTP 403) carrying the localized `teacherNotCertified` copy AND N's `is_online` SHALL remain unchanged AND exactly ONE bounded domain log SHALL be emitted.
- **REQ-094 (Journey J-AV-5 — In-session denial):** WHEN the in-`started`-session teacher S attempts to toggle Available THEN the system SHALL reject with `TEACHER_IN_ACTIVE_SESSION` (HTTP 409) carrying the localized `teacherInActiveSession` copy with NO session id disclosed AND S's `is_online` SHALL remain `false` AND the session row SHALL be byte-identical.
- **REQ-095 (Journey J-AV-6 — Isolation + self-only):** WHEN any toggle step executes THEN the isolation observer O's availability SHALL be UNCHANGED AND no operation SHALL accept a teacher id from the caller (self-only by construction), so a foreign-teacher target is unrepresentable at the API surface.

Each criterion maps 1:1 onto steps in `test/workflows/teachers/teacher-availability.journey.test.ts` (REQ-072).

---

## 3. System Decisions & State Machine Invariants Alignment

**Decision References (`docs/specs/state-machine-invariants.md` §3 "Teacher Availability Lifecycle" `:97-125`; `docs/specs/functional-requirements.md` §4):**

| Invariant / Req | Text (source) | Where ENFORCED by this ticket | REQ IDs |
|---|---|---|---|
| **INV-A1** | "Only certified teachers (`is_approved = true`) can set their status to Available." (`:120`) | `TeacherAvailabilityService.setAvailability` Available branch, SERVICE-SIDE, after `lockForCertificationCheck` → `ForbiddenError(t.teacherNotCertified)` (403) | REQ-011, REQ-014, REQ-030, REQ-093 |
| **INV-A2** | "While a teacher is in an active session (`session.status = started`), their `is_online` must be `false`." (`:121`) | (a) state set by the SHIPPED lifecycle lock (`setOnline(false)` at start — consume-only here); (b) the Available branch reuses `assertTeacherNotInActiveSession` → 409 | REQ-011, REQ-015, REQ-034, REQ-094 |
| **INV-A3** | "A teacher in In-Session state is hidden from the Available Teachers directory for all other students." (`:122`) | NOT enforced here (no directory exists). This ticket makes `is_online` truthful; the directory filter is Dev 3 (`:1457`/`:1509`) | REQ-018 (pointer), REQ-082 (ledger) |
| **INV-A4** | "Upon session conclusion, the teacher's status returns to Available only if they are still active (app open)." (`:123`) | NOT enforced here — release path out of scope; recorded as resolved-pointer deferred item with the unconditional-release hazard | REQ-042, REQ-082 |
| **INV-S6** | "While a session is in `started` state, the teacher's `is_online` must be `false` (in-session lock)." (`:47`) | Same column, different writer: the shipped lock/release owns INV-S6 writes; the toggle defers to it via the gate; the two writers are serialized by teacher-row locks, never crossed | REQ-011, REQ-015, REQ-041, REQ-043 |
| **FR-4.1** | "Teachers can manually toggle their status between Available and Unavailable." (`:135-139`) | The whole service + GraphQL + card | REQ-010, REQ-011, REQ-012, REQ-060..063 |
| **FR-4.3** | "When a teacher accepts a session request, their status automatically becomes Unavailable and they are hidden from the directory until the session concludes." (`:144-147`) | The auto-set half is SHIPPED (`session-lifecycle.service.ts:276-290`, consume-only); the toggle refuses to override it (409); "hidden from directory" is Dev 3 | REQ-015, REQ-018, REQ-042, REQ-094 |

**Ticket Acceptance-Criteria → REQ Mapping** (`docs/planning/TICKETS.md:1266-1285` Gherkin; `:1287-1292` Test Scenarios):

| Ticket AC / Test Scenario | Mapped REQ IDs |
|---|---|
| Certified teacher toggles Available → `is_online=true` | REQ-010, REQ-011, REQ-013, REQ-017, REQ-090 |
| "…appear in the Available Teachers directory" | DATA-level only: `is_online` truthful → REQ-011, REQ-018 (directory deferred) |
| Certified teacher toggles Unavailable → `is_online=false` | REQ-010, REQ-012, REQ-013, REQ-091 |
| "…hidden from the Available Teachers directory" | DATA-level only: `is_online=false` → REQ-012, REQ-018 (directory deferred) |
| Non-certified teacher attempts toggle → 403 "Not certified" | REQ-014 (403 via `ForbiddenError`), REQ-051, REQ-052, REQ-093 |
| Teacher in active session → `is_online=false`, cannot toggle | REQ-015 (409 gate), REQ-041, REQ-094 |
| "Only `is_approved=true` teachers can set Available (INV-A1)" | REQ-011, REQ-014, REQ-030 |

**State transition table served** (`docs/workflows/02-on-demand-matching-workflow.md:19-25`): `Offline → Available: Teacher manually toggles Available` (REQ-011) · `Available → Offline: Teacher manually toggles Unavailable` (REQ-012) · `Available → In_Session: Teacher accepts session request` (SHIPPED lifecycle; not this ticket) · `In_Session → Available: Session concludes` (INV-A4, deferred) · `Available → Offline: app close/inactivity` (sibling `:1298`).

**Architecture standards:** service namespace + single-writer + `outerTx`-last composition (`backend/services/AGENTS.md`); GraphQL `$all` scope + resolver delegation + locale propagation (`backend/graphql/AGENTS.md`); Pothos canonical-object-type pattern (`backend/graphql/pothos/AGENTS.md`); error taxonomy & masking (`docs/graphql/error-handling-contract.md`, `docs/graphql/domain-error-extensions-code.md`); i18n via the compile-time system (`shared/locale/`); zero schema drift (`docs/DATABASE_MIGRATIONS.md`); journey rules (`docs/testing/workflow-journey-tests.md`).

**Evidence Index (spot-verified facts, cited above):**

| Claim | Evidence (path:line) |
|---|---|
| `is_online` and `is_approved` columns exist (nullable default false) | `backend/db/schema/teachers/teacher.ts:25,28` |
| Teacher PK/FK → `users.id` cascade | `backend/db/schema/teachers/teacher.ts:22-24` |
| `setOnline(id, online, tx)` guarded UPDATE, required tx, idempotent | `backend/db/repo/teachers/teacher.repository.ts:437` (+ docstring `:398-447`) |
| `lockForCertificationCheck` FOR UPDATE projection; null semantics | `backend/db/repo/teachers/teacher.repository.ts:217` (+ docstring `:200-217`) |
| `findById(id, tx?)` | `backend/db/repo/teachers/teacher.repository.ts:172` |
| INV-A2 gate reuses `listForTeacher` and throws CONFLICT, logs once | `backend/services/classes/session-lifecycle.enforcement.ts:200-214` |
| Gate re-exported from classes barrel | `backend/services/classes/index.ts:6` |
| `listForTeacher` signature | `backend/db/repo/classes/session.repository.ts:635` |
| `SessionStatus` members incl. `Started` | `backend/enum/scheduling/session-status.enum.ts:7-13` |
| FORBIDDEN→403; custom codes normalize to null | `backend/lib/errors/error-code-taxonomy.ts:41-51` |
| `ForbiddenError` code = FORBIDDEN | `backend/lib/errors.ts:51` |
| `ConflictError` custom-code ctor | `backend/lib/errors.ts:171-181` |
| `getServerTranslations(locale)` ONE arg | `shared/locale/server-graphql.ts:3` |
| Three reuse error keys exist (en/ar) | `shared/locale/types/errors/labels.ts:243,247,249`; `shared/locale/en/errors/index.ts:108,110` |
| Frozen public-operation six | `backend/lib/gateway/public-operations.ts:36-46` |
| Mutation-root exact `toEqual` pin | `backend/graphql/test/schema-surface.test.ts:1097` |
| Allowlist 1:1 agreement (no allowlist edit) | `frontend/graphql/test/gateway/allowlist-coverage.test.ts:135,142,158` |
| Teacher `$all` scope precedent | `backend/graphql/mutation/classes/student-evaluation.mutation.ts:66-71` |
| Zero-arg context identity query precedent | `backend/graphql/query/teachers/applicant.query.ts` |
| Unconditional release hazard (no persisted prior-online) | `backend/services/classes/session-lifecycle.transitions.ts:249-256`; `backend/services/classes/session-lifecycle.service.ts:276-290` |
| No directory/matching surface exists in-tree | grep-verified: no `availability`/`availableTeachers`/matching service |
| INV-A3/A4 + sibling ticket rows | `docs/planning/TICKETS.md:1298,1338,1457,1509` |

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001..004 (baseline, i18n, types, dependency guard) | Phase-0 protocol; canonical types | verify repo primitives + gate + enum | — | — | `<plan-dir>/outcome/0-baseline-outcome.md`; parity + tsgo gates |
| REQ-010 (canonical service) | FR-4.1; single-writer | NEW `TeacherAvailabilityService` (`backend/services/teachers/`) | — | — | service suite module-shape pins |
| REQ-011/012 (Available / Unavailable) | INV-A1, INV-A2, FR-4.1 | `setAvailability` both branches (`lockForCertificationCheck` + gate + `setOnline`) | `setTeacherAvailability` | `TeacherAvailabilityCard` | service 4-tier; journey steps 2–6 |
| REQ-013 (return type) | BOPLA read-side minimality | projection `{ id, isOnline, isApproved }` | `TeacherAvailabilityState` | card render | service Tier-1/2; object field pins (REQ-062) |
| REQ-014 (certification gate) | INV-A1; error taxonomy | `ForbiddenError(t.teacherNotCertified)` → 403 | code propagated | error toast | journey step 5; service Tier-4 |
| REQ-015 (in-session gate) | INV-A2; oracle | REUSE `assertTeacherNotInActiveSession` → 409 | code propagated | error toast | journey step 6; gate-order test |
| REQ-016 (zero drift) | freeze posture | `setOnline` reused as-is | no schema type beyond 3 objects | — | `git diff` emptiness; codegen no-diff |
| REQ-017 (idempotency) | repo docstring | same-value UPDATE returns row | repeated mutation | switch steady state | service Tier-2; repo test extension |
| REQ-018 (boundary/pointers) | INV-A3/A4 deferral | zero session/users/approval writes | — | — | ledger pointers; journey observer |
| REQ-030 (BFLA/AuthZ) | 401/403 split | service-side certification | `$all { authenticated, role:[Teacher] }` | role-guarded dashboard | scope pins (REQ-062); journey denial |
| REQ-031 (BOLA/IDOR, self-only) | context-derived identity | `ctx.user.id` only | zero/id-free args | — | service Tier-4; journey step 8 |
| REQ-032 (BOPLA) | closed input | bare boolean param | single `isOnline: Boolean!` | — | resolver + input-shape pins |
| REQ-033/034 (PII/oracle) | log & oracle rules | bounded log ctx; reused gate copy | masked codes | — | log-spy counts; message-substring assertions |
| REQ-040/041 (tx composition / lock ordering) | atomicity | ONE `withTransaction`; teacher-row lock only | — | — | rollback-purity test; concurrency Tier-3 |
| REQ-042 (INV-A4 deferred) | release-path hazard | NO release-path code | — | — | ledger resolved-pointer; documented hazard |
| REQ-043 (repo write discipline) | single write primitive | `TeacherRepository.setOnline` only | — | — | service fail-closed branch; repo test |
| REQ-050..053 (validation/errors/logs) | error contract | `VALIDATION`/`TEACHER_NOT_FOUND`/`FORBIDDEN`/`TEACHER_IN_ACTIVE_SESSION`; happy-path silence | codes on wire | localized copy reuses keys | service error matrix; parity suites green |
| REQ-060/061 (GQL surface / Pothos) | FR-4.1 | delegate with `ctx.locale` + `ctx.user.id` | query + mutation; object/input | — | schema-surface inventory; codegen |
| REQ-062 (SDL/gate regen) | freeze reconciliation | — | inventory consts added | — | `schema-surface.test.ts` updated; allowlist agreement green |
| REQ-063 (FE documents/card) | FR-4.1 UI | — | documents + hooks | `TeacherAvailabilityCard` mounted in teacher slot | component tests / journey dtype |
| REQ-070..075 (coverage/gates) | testing canon | repo/service 4-tier | GraphQL integration | — | full test map; ledger `grep` gate = 0 |
| REQ-080..083 (docs/propagation) | knowledge protocol | `docs/teachers/teacher-availability.md`; ledger pointers | — | — | doc existence; plan-review |
| REQ-090..095 (journeys) | §2.9; Workflow 02 §1 | full flow EXCEPT directory/release via real services + committed fixtures | scoped both ops | server-authoritative card | `test/workflows/teachers/teacher-availability.journey.test.ts` |

### 4.1 Artifact Inventory — NEW / CHANGED files

| Artifact | Status | Path | REQ |
|---|---|---|---|
| Canonical service | NEW | `backend/services/teachers/teacher-availability.service.ts` | REQ-010, REQ-011, REQ-012 |
| Service barrel line | CHANGED (additive) | `backend/services/teachers/index.ts` | REQ-010.1 |
| Canonical return type | CHANGED (additive) | `backend/types/teachers/teacher.types.ts` | REQ-003.2, REQ-013 |
| Types barrel (unchanged export) | CHANGED (no-op if `export *` already covers) | `backend/types/teachers/index.ts` | REQ-003.2 |
| Pothos object | NEW | `backend/graphql/pothos/teachers/teacher-availability.pothos.ts` | REQ-061.1 |
| Query field | NEW | `backend/graphql/query/teachers/teacher-availability.query.ts` | REQ-060.1 |
| Query barrel line | CHANGED (additive) | `backend/graphql/query/teachers/index.ts` | REQ-060.4 |
| Mutation field | NEW | `backend/graphql/mutation/teachers/teacher-availability.mutation.ts` | REQ-060.2 |
| Mutation sub-barrel | NEW | `backend/graphql/mutation/teachers/index.ts` | REQ-060.4 |
| Mutation top barrel line | CHANGED (additive) | `backend/graphql/mutation/index.ts` | REQ-060.4 |
| Apollo documents | NEW | `frontend/graphql/sharedDocuments/teachers/teacher-availability.documents.ts` | REQ-063.1 |
| Dashboard card | NEW | `frontend/views/teachers/dashboard/TeacherAvailabilityCard.tsx` | REQ-063.2 |
| Teacher slot mount | CHANGED (additive) | `frontend/views/dashboard/home/RoleDashboardPage.tsx:72-78` | REQ-063.3 |
| UI namespace type | NEW | `shared/locale/types/availability/labels.ts` | REQ-002.2, D9 |
| UI namespace handle | NEW | `shared/locale/namespaces/availability/availability.namespace.ts` | REQ-002.2, D9 |
| en / ar leaves | NEW | `shared/locale/en/availability/labels.ts`, `shared/locale/ar/availability/labels.ts` | REQ-002.2, D9 |
| Namespace registry + messages slices | CHANGED (additive) | `shared/locale/namespaces/registry.ts`, `shared/locale/en/messages.ts`, `shared/locale/ar/messages.ts`, `shared/locale/namespaces/index.ts` | REQ-002.2, D9 |
| SDL + codegen artifacts | CHANGED (generated) | `frontend/graphql/generated/**` (via `bun run generate:gqlSchema && bun codegen`) | REQ-062 |
| Schema-surface inventory | CHANGED (additive consts) | `backend/graphql/test/schema-surface.test.ts:1097` (+ query-root pin `:972-1006`) | REQ-062.1 |
| Canonical doc | NEW | `docs/teachers/teacher-availability.md` | REQ-081 |

### 4.2 Test Artifact Inventory

| Artifact | Status | Path | REQ |
|---|---|---|---|
| Repo tests (extend) | CHANGED (additive) | `backend/db/test/repo/teachers/teacher.repository.test.ts:393-500` | REQ-070 |
| Service 4-tier suite | NEW | `backend/services/teachers/teacher-availability.service.test.ts` | REQ-071 |
| Workflow journey | NEW | `test/workflows/teachers/teacher-availability.journey.test.ts` | REQ-072, REQ-090..095 |
| UI namespace parity | NEW | `shared/locale/availability-namespace.parity.test.ts` | REQ-002.2, REQ-074 |
| GraphQL integration (scoped) | OPTIONAL/NEW | `frontend/graphql/test/teachers/teacher-availability.test.ts` (401/403 split pins) | REQ-030, REQ-062 |
| Outcome + ledger | NEW/TRACKED | `<plan-dir>/outcome/*.md`, `<plan-dir>/deferred-items.md` | REQ-001, REQ-080, REQ-082 |

**Byte-identical (MUST NOT change):** `backend/db/schema/**`, `backend/db/migration/**`, `backend/lib/gateway/public-operations.ts`, `frontend/views/dashboard/nav/navItems.ts`, `backend/services/classes/session-lifecycle.enforcement.ts`, `backend/services/classes/session-lifecycle.transitions.ts`, `shared/locale/en/errors/*` / `ar/errors/*` / `types/errors/*` (reuse only).

### 4.3 Definition of Done

- [ ] All REQ-010..018, REQ-030..034, REQ-040..043, REQ-050..053, REQ-060..063 acceptance criteria met.
- [ ] REQ-070..075 test gates green; ledger `grep` gate = 0; baseline + ZERO new errors.
- [ ] `git diff backend/db/schema/** backend/db/migration/**` empty; `bun run generate:gqlSchema && bun codegen` no-diff beyond the two operations.
- [ ] REQ-080..083 docs + ledger pointers landed; Phase 1.5 `@plan-review` passed with zero violations.
- [ ] REQ-090..095 journey green via `bun run test/scripts/run-test.ts`.

---

**End of Specification.** Governing next step: Phase 1.5 — invoke `@plan-review` on the complete plan (`specs.md` + `plan.md` + `tasks.md`) BEFORE any implementation begins; the §0 scope reconciliation (this ticket ships the canonical toggle Q&M + dashboard card; the directory appearance (INV-A3) and the release-path gating (INV-A4) are Dev 3 / sibling-ticket work) is the load-bearing ruling the review MUST ratify.
