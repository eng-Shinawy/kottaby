# Requirements — Student Progress Tracking & Increment

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`
> **Ticket:** `Student Progress Tracking & Increment` (`docs/planning/TICKETS.md:1180-1217`) — Dev 1 · Milestone 2 · 5 SP · Blocked By `Tajweed Curriculum Lessons CRUD` (SHIPPED)
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory)

## Document Information

| Field | Value |
|---|---|
| Feature Name | Student Progress Tracking & Increment |
| Milestone | M2 (`milestone_2_matching_notifications_escrow`) |
| Version / Date | 1.0 · 2026-09-21 |
| Decision Refs | FR-6.2, FR-6.3 (`docs/specs/functional-requirements.md:202-208`), INV-PR1, INV-PR2, INV-PR3 (`docs/specs/state-machine-invariants.md:321-325`) |
| Hard Inputs | `backend/db/schema/classes/progress.ts:19-34` · `backend/db/schema/classes/lessons.ts:17-30` · `backend/services/classes/session-lifecycle.confirmation.ts:112-139` |
| Downstream Consumer | `Teacher Preparation View (Student Progress Before Session)` (`docs/planning/TICKETS.md:1219-1252`) — the next ticket; this plan ships its data substrate |

## Introduction

Students on Tajweed plans follow a fixed curriculum of lessons (`lessons`, ordered `id ASC` per plan — the contract shipped by the Tajweed Curriculum Lessons CRUD ticket). Today nothing connects a completed session to that curriculum: the `progress` table exists (`student_id`, `lesson_id`, timestamps) but has **no writer** — `ProgressRepository` (`backend/db/repo/classes/progress.repository.ts:38-84`) exposes only `countForStudent`. This feature makes `progress` live: when a Tajweed session reaches its successful end state (dual confirmation — teacher completes, student confirms, escrow settles), the student's progress record advances to the next lesson; and it exposes one permission-gated read so teachers (and the student themselves, and admins) can see the current lesson and completion percentage before a session.

### Feature Summary

On dual-confirmed completion of an `intent = tajweed` session, advance the student's per-plan progress row to the next curriculum lesson (creating it lazily on the first completion, capping at the final lesson), and serve a `studentProgress` GraphQL query returning current lesson + completion percentage.

### Business Value

Teachers prepare the correct material (FR-6.2); the academy gets an honest curriculum-position signal per student (FR-6.3); the parent portal's progress surface (which currently renders the raw `progress` row count) starts reflecting real movement.

### Scope

**In scope:** the increment writer on the dual-confirmation path; the progress read service + GraphQL query; repository/type/i18n plumbing; the cross-actor journey test (`test/workflows/classes/…`); SDL/codegen refresh.
**Out of scope (explicit):** any UI page (no frontend routes — the Teacher Preparation View ticket builds the UI); admin CRUD for progress; Hifz curriculum tracking; arbitration-path increments; per-lesson history tables; percentage upgrades of the parent-portal surface.

## Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and past research is never redone.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL record baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) and write `ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists in the plan directory (created with this plan, seeded with the carried-forward items listed in it).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in the plan's `outcome/` directory first.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` with research findings, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on it and SHALL NOT proceed until exit code 0.
7. WHEN any subtask is marked complete THEN the agent SHALL have completed the semantic-review checklist (race conditions, tenancy, enums-as-values, dead code, deferred items logged) — the sub-loop script cannot detect these.

### REQ-002: Translation & Enum Compliance

**User Story:** As a maintainer, I want user-facing strings compile-time checked and enums imported as values, so locale and type errors surface at build time.

#### Acceptance Criteria

1. WHEN any new user-facing error string is added THEN it SHALL live in the `errorsTranslations` namespace as a typed `ErrorsLabels` leaf with identical key sets in `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts` (parity tests green).
2. WHEN backend code needs localized text THEN it SHALL call `getServerTranslations(locale)` from `@/shared/locale/server-graphql` and access leaves by property — never hardcoded English, never `next-intl`, never `shared/messages/`.
3. WHEN an enum is referenced in a runtime expression THEN it SHALL be imported as a value (never `import type`) and members used instead of string literals.

### REQ-003: Progress Record Model (INV-PR1)

**User Story:** As the curriculum domain, I want one progress row per (student, plan) pointing at the student's current lesson, so that "where is this student in the curriculum" is one indexed read.

#### Acceptance Criteria

1. WHEN a progress row exists for a student THEN its `lesson_id` SHALL reference a lesson of the plan currently governing that student's Tajweed track (INV-PR1: `progress.student_id` ↔ `students.id`, `progress.lesson_id` ↔ `lessons.id`; FK behavior unchanged — student delete cascades, lesson delete sets null).
2. WHEN the row's `lesson_id` points at a lesson THEN that lesson's position in the plan's `id ASC` ordering SHALL be the student's current curriculum position (the row is a "current lesson pointer": the lesson the student is on, one slot ahead of the last completed lesson).
3. The feature SHALL consume the existing table with ZERO schema delta — no new columns, no new constraints (mirrors the lessons ticket's zero-delta lineage).

### REQ-004: Increment on Dual-Confirmed Tajweed Completion (INV-PR2)

**User Story:** As the academy, I want a student's curriculum position to advance exactly once per genuinely completed Tajweed session, so progress reflects endorsed teaching outcomes — never raw teacher claims.

#### Acceptance Criteria

1. WHEN `SessionLifecycleService.confirmSessionCompletion` completes the exactly-once branch of `confirmCompletionInTx` (`backend/services/classes/session-lifecycle.confirmation.ts:118-130`) for a session whose `intent` is `SessionIntent.Tajweed` THEN the system SHALL advance the student's progress within the SAME transaction (teacher-wallet credit and progress advance commit or roll back together).
2. WHEN the confirmation path is replayed (student re-confirm, teacher confirm attempt, or admin-consumed hold — the `resolveSettledOrConflict` arms at `session-lifecycle.confirmation.ts:86-104`) THEN the system SHALL NOT advance progress (progress moves only on the zero-row-guard success arm — at most once per session).
3. WHEN the progress advance runs THEN it SHALL set the row's `lesson_id` to the NEXT lesson in the resolved plan's `id ASC` sequence (INV-PR2 "updated (incremented)").
4. IF the advance fails with an unexpected error THEN the confirmation transaction SHALL roll back (fail-closed, matching the existing side-effect convention documented at `session-lifecycle.confirmation.ts:1-29`).
5. WHEN a session completes via any other path (teacher-only completion, the 24h sweep cancel, admin arbitration `resolveDisputeCompleteOnce`/`resolveConsumedDisputeOnce`) THEN progress SHALL NOT move in this ticket (recorded as deferred item D2).

### REQ-005: Lazy Initialization on First Confirmed Completion

**User Story:** As a new student, I want my progress record to appear after my first properly completed Tajweed session, so no empty rows pollute the curriculum state.

#### Acceptance Criteria

1. WHEN a student with NO progress row completes their first dual-confirmed Tajweed session THEN the system SHALL insert one progress row: `lesson_id` = the second lesson of the plan when ≥2 lessons exist, else the plan's single lesson (INV-PR1 satisfied on insert).
2. WHEN a student with no progress row has sessions that are booked/started/teacher-completed-but-unconfirmed THEN the system SHALL create NO progress row (the write happens only on the settled, dual-confirmed state).
3. WHEN a student's existing row has `lesson_id = NULL` (their lesson was admin-deleted — `ON DELETE SET NULL`, `progress.ts:26`) THEN the next increment SHALL re-anchor the row to the plan's first lesson before advancing (documented recovery rule, not an error).

### REQ-006: Curriculum-Complete Cap

**User Story:** As a student who finished the curriculum, I want extra sessions not to corrupt my record, so my state stays pinned at the final lesson.

#### Acceptance Criteria

1. WHEN a student whose current lesson is the plan's LAST lesson (`id ASC` order) completes another dual-confirmed Tajweed session THEN the system SHALL leave the progress row byte-identical (no lesson_id change, no new row) — the ticket's "curriculum complete" observable.
2. WHEN the ticket Gherkin scenario "student who has completed all lessons completes another session" runs THEN the assertion SHALL be: row unchanged AND `currentLessonPosition = totalLessons` on the read API.
3. WHEN the plan contains exactly one lesson THEN the first completion SHALL insert the row pointing at that lesson and all further completions SHALL be no-ops.

### REQ-007: Intent Scoping — Tajweed Only

**User Story:** As the domain owner, I want only Tajweed sessions to move Tajweed curriculum progress, so evaluation sessions (which settle through the same tajweed balance lane) and Hifz sessions never corrupt the pointer.

#### Acceptance Criteria

1. WHEN a dual-confirmed session has `intent = SessionIntent.Evaluation` THEN the system SHALL NOT touch `progress` (lane ≠ intent: `intentLaneFor` maps evaluation to the tajweed LANE at `session-lifecycle.guards.ts:92-94` — the lane MUST NOT be used as the trigger).
2. WHEN a dual-confirmed session has `intent = SessionIntent.Hifz` THEN the system SHALL NOT touch `progress` (Hifz curriculum tracking is deferred item D3).
3. WHEN the trigger is evaluated THEN it SHALL read `intent` off the session row returned by `confirmStudentCompletionOnce` (`SessionReturnType = session.$inferSelect`, `backend/types/classes/session.types.ts:19`) — no extra query.

### REQ-008: Plan Resolution & Graceful Skips

**User Story:** As the escrow-settlement path, I want progress advancement to never invent a curriculum context, so settlement stays the single source of truth and progress never blocks or fabricates.

#### Acceptance Criteria

1. WHEN the increment resolves the governing plan THEN it SHALL select the student's most recent `active` subscription whose plan's `balance_lane = 'tajweed'` (`subscriptions` ⋈ `plans`, ordered `start_date DESC, id DESC`, LIMIT 1) — the same lane-keyed join discipline as `SubscriptionRepository.hasUncoveredExpiredLane` (`backend/db/repo/billing/subscription.repository.ts:453-483`).
2. IF the student has NO active tajweed-lane subscription (e.g. a trial-funded session) THEN the increment SHALL no-op with one structured `logger.logDomainError`/debug log carrying `{ sessionId, studentId }` — NEVER a throw (settlement must not roll back over a missing curriculum context).
3. IF the resolved plan has zero lessons THEN the increment SHALL no-op with the same structured log discipline.
4. WHEN the plan resolution runs inside the confirmation transaction THEN it SHALL read through the caller's `tx` (repeatable snapshot, consistent with the settlement reads).

### REQ-009: Progress Read API

**User Story:** As a teacher, I want to see a student's current lesson and completion percentage before a session, so I prepare the correct material (FR-6.2 substrate).

#### Acceptance Criteria

1. WHEN an authorized caller executes `studentProgress(studentId: Int!)` THEN the system SHALL return: `hasProgress`, `studentId`, `planId`/`planTitle` (nullable), `totalLessons`, `currentLessonId`/`currentLessonTitle`/`currentLessonPosition` (nullable, 1-based), `lessonsCompleted`, `completionPercent` (integer 0–100, `floor(lessonsCompleted × 100 / totalLessons)`), `isOnFinalLesson`.
2. WHEN the student has no progress row THEN the read SHALL return `hasProgress: false`, null lesson fields, `lessonsCompleted: 0`, `completionPercent: 0` — never a fabricated percentage (the honesty rule the parent portal established).
3. WHEN the student has no active tajweed-lane subscription THEN the read SHALL return `hasProgress: false` with null plan fields.
4. WHEN a teacher views a student with no progress THEN the payload SHALL make the "First session — diagnostic" rendering of the NEXT ticket possible purely from `hasProgress === false` (REQ-011).

### REQ-010: Authorization & Tenancy on the Read

**User Story:** As the platform, I want progress visible only to the student themselves, teachers who actually have a session relationship with that student, and admins, so curriculum position does not leak across tenants.

This is the domain's core cross-actor workflow, so journeys are captured here (mapping 1:1 onto `test/workflows/classes/tajweed-progress-increment.test.ts`).

#### Actor Table

| Actor | Role (`users.role`) | Can Do | Cannot Do |
|---|---|---|---|
| Student | `student` | read OWN `studentProgress`; confirm their session (existing surface) | read others' progress; trigger increments directly |
| Teacher | `teacher` | read `studentProgress` for students they share ≥1 session row with | read unlinked students; move any pointer manually |
| Foreign teacher | `teacher` (no shared session) | — | 403 on read |
| Admin | `admin` | read any student's `studentProgress` | trigger increments (system-only writer) |
| Parent | `parent` | — (existing portal surface, `parentChildProgress`, unchanged) | call `studentProgress` |

#### Ordered Step List (Journey J1 — increment & observation)

1. Fixtures commit: tajweed plan + 3 lessons (id ASC), active subscription, certified teacher, student, booked session (`intent = tajweed`).
2. Teacher → `startSession` → `completeSession` → session `completed`, `fee_held = true`, NO progress row yet.
3. Foreign teacher → reads `studentProgress(student)` → DENIED (403).
4. Student → confirms completion → teacher wallet credited AND `progress` row inserted pointing at lesson 2 (SAME commit).
5. Teacher → reads `studentProgress` → sees `currentLessonPosition = 2`, `completionPercent = 33`, `totalLessons = 3`.
6. Repeat full cycle (book → start → complete → confirm) → pointer advances to lesson 3 (`completionPercent = 66`).
7. Third full cycle at the final lesson → pointer STAYS at lesson 3 (curriculum-complete cap, REQ-006).
8. Student → reads own `studentProgress` → identical payload to the teacher's read.
9. Admin → reads → identical payload.
10. Parent → reads → DENIED at scope layer (403), and foreign-teacher denial already proven in step 3.

#### Acceptance Criteria (cross-actor, observer-perspective EARS)

1. WHEN the teacher completes the session THEN the student SHALL observe their progress UNCHANGED until they themselves confirm (pointer moves only on dual confirmation — REQ-004).
2. WHEN the student confirms THEN the teacher SHALL observe the advanced lesson on their next read (shared-state change visibility).
3. IF a teacher shares no session with the student THEN the read SHALL be denied with the constant-shape `ForbiddenError` (no existence oracle).
4. IF a parent calls `studentProgress` THEN the scope layer SHALL deny with 403 (the parent's honest surface remains `parentChildProgress`).
5. IF an unauthenticated caller calls `studentProgress` THEN the `authenticated` scope SHALL throw 401 (before any DB read).

### REQ-011: No-Progress Honesty (First-Session Substrate)

**User Story:** As the next ticket (Teacher Preparation View), I want a machine-readable "no progress" signal, so the UI can render "First session — diagnostic" without inference.

#### Acceptance Criteria

1. WHEN the student has never completed a dual-confirmed tajweed session THEN `studentProgress` SHALL return `hasProgress: false` (REQ-009.2/0.3).
2. WHEN `hasProgress` is false THEN the payload SHALL NOT fabricate a lesson pointer (all lesson fields null).

### REQ-012: User Roles & Admin Surface

**User Story:** As an operator, I want no new admin UI in this ticket, so the 5-SP scope stays backend + API only.

#### Acceptance Criteria

1. WHEN the feature ships THEN no new route, page, nav item, or frontend component SHALL be created (the nav graph in `frontend/views/dashboard/nav/navItems.ts` is untouched).
2. WHEN an audit is needed THEN the code SHALL rely on existing structured logging (`logger.logDomainError`); no new `audit_logs` writer is added (progress moves are derivable from the session confirmation, which the dual-confirmation ticket already logs/audits).

## UX / Navigation Requirements (Explicit No-UI Ruling)

| Aspect | Ruling | Evidence / Rationale |
|---|---|---|
| New routes | NONE | Ticket scope is tracking + increment + read API; the consuming UI is the NEXT ticket (`Teacher Preparation View`, TICKETS.md:1219) |
| Sidebar / nav | UNCHANGED | `frontend/views/dashboard/nav/navItems.ts` untouched |
| Mobile bottom nav | NONE | Repo has no bottom-nav anywhere (verified in the lessons ticket D9) |
| Role surfaces | `studentProgress` GraphQL query only; per-role behavior in REQ-010 | Parent surface stays on the existing `parentChildProgress` portal query |
| Frontend deps | NONE | No Apollo document, no store, no view — zero `frontend/` and zero `app/` changes |

## Non-Functional Requirements

### Performance

1. WHEN `studentProgress` executes THEN it SHALL perform ≤ 4 indexed reads (student existence, pair-session count OR role bypass, plan resolution, lessons + progress row) — all equality/ordered-index scans (`progress_student_id_idx`, `lessons_plan_id_idx`, session/composite indexes, subscription user index).
2. WHEN the increment runs inside the confirmation transaction THEN it SHALL add ≤ 3 statements (plan resolution, row lock read, one guarded write) — no N+1, no cross-row fan-out.

### Security

1. WHEN any resolver path executes THEN caller identity SHALL come exclusively from `ctx.user` (verified JWT → `UserRepository.findById`); the `studentId` arg is a resource selector, never an identity claim.
2. WHEN a teacher reads progress THEN the service SHALL verify a ≥1-session relationship via a count query (BOLA defense); students are locked to `studentId = caller.id` regardless of the arg.
3. WHEN DTOs are constructed THEN they SHALL be field-picked (no `{ ...row }` spread into the wire shape — BOPLA).
4. WHEN the increment writes THEN it SHALL write only `progress.lesson_id`/`updated_at` via strict column picks (no input spread exists — the writer takes no user input at all).

### Reliability

1. WHEN any non-fatal curriculum-context miss occurs (no subscription, zero lessons, dangling lesson pointer) THEN the increment SHALL log and no-op (REQ-008) rather than roll back settlement.
2. WHEN two confirmations race for sessions of the same student THEN the `FOR UPDATE` progress-row lock SHALL serialize the advances (second sees the first's committed pointer).

### Observability

1. WHEN the increment no-ops for context reasons THEN exactly one structured log SHALL carry `sessionId`, `studentId`, and the machine reason (`no-active-tajweed-subscription` | `no-lessons` | `lesson-pointer-reanchored`).

## Constraints and Assumptions

### Technical Constraints

- Zero schema delta (REQ-003.3): `db push`/`migrate` are NOT part of this plan; only `bun run generate:gqlSchema` + `bun codegen` for the GraphQL surface.
- The writer MUST run inside the existing `withTransaction` boundary of `confirmCompletionInTx` — no new transaction nesting, no post-commit async job (no event mechanism exists in the codebase; verified by grep — direct sequential calls on the same `tx` are the established side-effect convention).
- All repo writes take `tx` as the LAST parameter (per-repo docblock convention, e.g. `backend/db/repo/classes/progress.repository.ts:14-27`); bare non-transactional reads fall back to `queryDb` (rule: "Bare Reads" in `backend/AGENTS.md`).

### Business Constraints

- 5 SP · Dev 1 · Milestone 2. Anything requiring schema change, UI, or arbitration-path behavior is deferred, not expanded.
- Curriculum order is `id ASC` per plan (immutable contract shipped by the lessons ticket — consumption only).

### Assumptions

- A student has at most one active tajweed-lane subscription that matters; `ORDER BY start_date DESC, id DESC` is the deterministic tiebreak if more than one exists.
- Admin-authored curriculum edits mid-progress are tolerated via REQ-005.3 re-anchoring; no historical guarantee is made for moved/deleted lessons.
- Session rows carry `intent` reliably (column exists at `backend/db/schema/classes/session.ts`; `SessionReturnType` = full select).

## Success Criteria

### Definition of Done

- [ ] All REQ-001…REQ-012 acceptance criteria met
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every modified/new file
- [ ] Repo tests (`backend/db/test/repo/**`), service tests, GraphQL wire/role tests, schema-surface tests green
- [ ] Journey `test/workflows/classes/tajweed-progress-increment.test.ts` green via `bun run test/scripts/run-test.ts test/workflows`
- [ ] `deferred-items.md` contains zero ❌/⚠️ entries at the final gate
- [ ] Phase 1.5 gate passed (this plan): `outcome/plan-review-R1.md` records a clean verdict

### Acceptance Metrics

- 100% branch coverage on new service/repo methods (repo: `runInRollback` + `tx` discipline)
- Zero new tsgo/biome/lint errors vs baseline (`outcome/0-baseline-outcome.md`)
- Journey: 10 ordered steps (REQ-010) asserted, including both denial probes and the cap assertion

## Glossary

| Term | Definition |
|---|---|
| Curriculum position | 1-based index of the current lesson in the plan's `id ASC` sequence |
| Pointer row | The single `progress` row for a (student, plan) whose `lesson_id` IS the current lesson |
| Dual confirmation | Teacher `completeSession` (status → `completed`) + student `confirmSessionCompletion` (stamp + `fee_held=false` + wallet credit) — the ONLY progress trigger |
| Cap / pinned | Current lesson = last lesson; further completions are no-ops (curriculum complete) |
| Re-anchor | Recovery for `lesson_id = NULL` after an admin lesson delete: pointer resets to the first lesson on next increment |
| Lane vs intent | `intent` (hifz/tajweed/evaluation) is semantic; `heldBalanceLane`/plan `balance_lane` is financial. Only `intent` gates progress. |

---

## Requirements Review Checklist

- [x] User stories have roles/features/benefits · EARS throughout · NFRs present · Success criteria measurable
- [x] UX/navigation defined for all roles (explicit no-UI ruling with evidence)
- [x] Cross-actor journey captured: actor table + 10 ordered steps + observer-perspective EARS (REQ-010)
- [x] Terminology consistent with `docs/specs/state-machine-invariants.md` and `docs/specs/functional-requirements.md`
