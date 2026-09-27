# Requirements — Teacher Preparation View (Student Progress Before Session)

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`
> **Ticket:** `Teacher Preparation View (Student Progress Before Session)` (`docs/planning/TICKETS.md:1218-1252`) — Dev 1 · Milestone 2 · 3 SP · Blocked By `Student Progress Tracking & Increment` (SHIPPED — ticket #227; plan archived at `ai/finished_plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`)
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory)

## Document Information

| Field | Value |
|---|---|
| Feature Name | Teacher Preparation View (Student Progress Before Session) |
| Milestone | M2 (`milestone_2_matching_notifications_escrow`) |
| Version / Date | 1.0 · 2026-09-26 |
| Decision Refs | FR-6.2 (`docs/specs/functional-requirements.md:202-204`), FR-5.3 (`:173-175`), INV-PR1 (`docs/specs/state-machine-invariants.md:321`), INV-PR2 (`:322`), INV-HW3 (`:315`), INV-HW4 (`:316`) |
| Hard dependency | `studentProgress` GraphQL query — SHIPPED with the `Student Progress Tracking & Increment` ticket (#227); its plan (`ai/finished_plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`) defines the payload and gate verbatim (specs REQ-009/REQ-010/REQ-011); live surface: `backend/graphql/query/classes/student-progress.query.ts`, `frontend/graphql/generated/schema.graphql:1717,1948-1960` |
| Hard inputs | `backend/graphql/query/classes/session-report.query.ts:134` (`studentHomeworkHistory`, SHIPPED) · `backend/services/classes/student-homework.service.ts:134` · `frontend/views/teacher/sessions/teacherSessionCacheArms.ts:157-198` · `frontend/graphql/sharedDocuments/scheduling/session-reads.documents.ts:117-149` |
| Downstream consumer | The future session-request intake / accept-decline flow (accept/decline waves at `docs/planning/TICKETS.md:1611-1624` within the notification-engine ticket `:1553+`; the matching filter/sort ticket at `:1457-1508`) mounts this same read surface inside its accept dialog — deferred item D4 |

## Introduction

When a Tajweed session lands on a teacher's plate, FR-6.2 wants the teacher to review the student's current curriculum position and their previous homework BEFORE the session starts, so the lesson is prepared with the right material. The data substrate shipped with the progress ticket: on dual-confirmed Tajweed completion the student's `progress` pointer row advances (`INV-PR2`), and a permission-gated `studentProgress` query exposes current lesson + completion percentage (`frontend/graphql/generated/schema.graphql:1717`). What does NOT exist anywhere is the teacher-facing surface: teacher session views are student-ID-opaque (`backend/graphql/pothos/classes/session.pothos.ts:165-271` exposes `studentId` only), and although `studentHomeworkHistory` (`backend/graphql/query/classes/session-report.query.ts:134`) is a shipped teacher-gated read — its document is even already fetched inside the report dialog (`frontend/views/teacher/sessions/useTeacherSessionReportQueries.ts:35-38`) — the UI reduces it to `items[0]` and renders no history list.

One naming caution for the reader: the ticket Gherkin says "when a student requests a Tajweed session … before accepting the request". No request/accept flow exists today — a student books directly against a certified teacher and the session row is born `scheduled` (`backend/services/classes/session-lifecycle.booking.ts:235-291`), while the request-intake/accept-decline flow is a later matching-stream ticket (the `teacher_request` notification waves at `backend/services/classes/session-request-notification.service.ts:139-145` are dormant scaffolding with no student-session caller). This plan therefore treats the `scheduled` Tajweed row as the "request" and ships the preparation read as a first-class surface on `/teacher/sessions` that the future accept flow can mount unchanged.

### Feature Summary

Add a read-only "Prepare" dialog to the teacher sessions page: for `scheduled` Tajweed sessions it shows the student's current curriculum position (current lesson title, 1-based position, completion percentage, final-lesson state — or the "First session — diagnostic" state when `hasProgress` is false) and the student's previous homework assignments (Jadid/Madi spans, Surah/Juz refs, grades), reusing the shipped `studentProgress` query and the shipped `studentHomeworkHistory` query. Zero new backend code, zero schema delta, zero new routes.

### Business Value

Teachers stop improvising: they walk into every Tajweed session knowing exactly which lesson the student is on and what homework was previously assigned/graded (FR-6.2's business rule). The academy gets the Milestone-2 Definition-of-Done line "Teachers can view student progress before accepting sessions" (`docs/planning/MILESTONE_PLAN.md:200`) satisfied on a shipped, teacher-visible surface rather than only as an API.

### Scope

**In scope:** the preparation read surface for teachers — one new Apollo document (studentProgress), one new dialog cluster on `/teacher/sessions` (hook, helpers, parts, orchestrator, mount), row-CTA wiring for `scheduled` + Tajweed rows, Apollo cache policy for the id-less `StudentProgress` type, SessionsLabels i18n additions (en/ar + parity), the new cross-actor journey test, Storybook stories, and the substrate pre-flight gate.
**Out of scope (explicit):** ANY backend code — no new query, mutation, service, repo, schema column, or SDL (the `studentProgress` read belongs to the shipped progress surface; `studentHomeworkHistory` is shipped); the session-request intake / accept-decline flow; teacher/student display names on session rows (deferred item D1); homework-history pagination controls inside the dialog (D3); prep surfaces on the dashboard up-next card or `/schedule` (D2); Hifz/evaluation preparation content (D5).

## Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and past research is never redone.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL record baseline counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`) and write `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists in the plan directory (created with this plan, seeded with the carried-forward items listed in it).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in the plan's `outcome/` directory first.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` with research findings, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on it and SHALL NOT proceed until exit code 0.
7. WHEN any subtask is marked complete THEN the agent SHALL have completed the semantic-review checklist (race conditions, tenancy, enums-as-values, dead code, deferred items logged) — the sub-loop script cannot detect these.

### REQ-002: Translation & Enum Compliance

**User Story:** As a maintainer, I want user-facing strings compile-time checked and enums imported as values, so locale and type errors surface at build time.

#### Acceptance Criteria

1. WHEN any new user-facing label is added THEN it SHALL live in the `sessions` UI namespace as a typed `SessionsLabels` leaf with identical key sets in `shared/locale/en/sessions/labels.ts` and `shared/locale/ar/sessions/labels.ts` (parity belt `shared/locale/sessions-namespace.parity.test.ts` stays green) — the teacher-session keys already live there (`viewHomeworkAction` at `shared/locale/types/sessions/labels.ts:292`).
2. WHEN the dialog renders homework rows THEN track/grade/date labels SHALL come from the existing `homework` namespace leaves (`HomeworkLabels`: `trackJadid`, `trackMadi`, `gradeLabel`, `assignedPrefix`, `sessionLine` — `shared/locale/types/homework/labels.ts:24`) via TWO separate `useAppTranslation` calls — `useAppTranslation(Sessions)` and `useAppTranslation(Homework)` (the hook takes exactly ONE namespace handle, `shared/locale/client/use-app-translation.ts:8-17`; the two-call composition precedent is `StudentSessionsContainer.tsx:116-117` — `useAppTranslation(Sessions)` + `useAppTranslation(Errors)`).
3. WHEN an enum is referenced in a runtime expression THEN it SHALL be imported as a value (never `import type`) and members used instead of string literals — the CTA gate uses the codegen-generated `SessionIntent` (`frontend/graphql/generated/gql/graphql.ts:398`) and `SessionStatus` (`:413`) exactly as `teacherSessionCacheArms.ts:134-138` uses `SessionType` via a `Record` lookup.
4. WHEN any locale file is touched THEN imports inside `shared/locale/**` SHALL use the `@/shared/locale/...` alias, never relative traversals (`shared/locale/AGENTS.md:12-23`).

### REQ-003: Substrate Dependency Gate (Blocked-By Contract)

**User Story:** As the executing agent, I want a hard pre-flight gate on the blocked-by plan's delivery, so this feature never ships against a missing progress API.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL verify the blocked-by ticket's GraphQL surface is LANDED: `studentProgress(studentId: Int!): StudentProgress!` present in `frontend/graphql/generated/schema.graphql:1717` with the `StudentProgress` type (`:1948-1960`), and `StudentProgressService.getStudentProgress` present at `backend/services/classes/student-progress.service.ts:173`. As of 2026-09-27 all three are LANDED — the blocked-by ticket shipped while this plan was being authored; the gate is the standing guard against regressed checkouts.
2. IF the substrate is absent THEN the agent SHALL HALT this plan and report the blocker — it SHALL NOT reimplement any part of the blocked-by plan (no duplicate service, query, or repo writers).
3. WHEN the substrate is present THEN this plan SHALL consume it verbatim per that ticket's contract (`specs.md` REQ-009): payload fields `hasProgress`, `studentId`, `planId`, `planTitle`, `totalLessons`, `currentLessonId`, `currentLessonTitle`, `currentLessonPosition` (nullable, 1-based), `lessonsCompleted`, `completionPercent` (integer 0-100), `isOnFinalLesson`; teacher gate = `countTeacherStudentSessions ≥ 1` (any status — a freshly booked `scheduled` row qualifies); role scope = `[Admin, Teacher, Student]` with `parent` denied at the scope layer.
4. WHEN the payload contract of the shipped query changes THEN this plan's dialog SHALL be re-verified against it (the four REQ-004/REQ-005 display rules are the only consumption points).

### REQ-004: Preparation Read Surface (Current Lesson Progress)

**User Story:** As a teacher, I want the student's current curriculum position displayed when I review an upcoming Tajweed session, so I prepare the appropriate lesson material (FR-6.2).

#### Acceptance Criteria

1. WHEN a teacher opens the preparation dialog for a Tajweed session THEN the system SHALL display the student's progress as returned by `studentProgress(studentId)`: current lesson title, current lesson position as "position of total", completion percentage, and the plan title — all read from the blocked-by query, zero client-side derivation beyond formatting.
2. WHEN `hasProgress` is true THEN the dialog SHALL render the current-lesson card WITHOUT any write affordance (no lesson picker, no edit control) — progress is system-written only on dual-confirmed completion (INV-PR2, consumed read-only).
3. WHEN `isOnFinalLesson` is true THEN the dialog SHALL render the curriculum-complete presentation (position = total, percentage of the completed prefix) — the same honest end-state the blocked-by plan's REQ-006 defines.
4. WHEN the `studentProgress` query fails with a non-`FORBIDDEN` error THEN the dialog SHALL render the localized error/empty branch — never a fabricated progress card.

### REQ-005: First-Session Honesty ("First session — diagnostic")

**User Story:** As a teacher receiving a brand-new student, I want an explicit "First session — diagnostic" state, so I know to run a diagnostic instead of preparing a curriculum lesson.

#### Acceptance Criteria

1. WHEN `studentProgress` returns `hasProgress: false` THEN the dialog SHALL render the localized "First session — diagnostic" state and SHALL NOT render any lesson title, position, or percentage (the honesty rule: no fabricated curriculum position — blocked-by plan REQ-009.2/REQ-011).
2. WHEN `hasProgress: false` occurs for a student whose sessions exist but none dual-confirmed THEN the presentation SHALL be identical to the never-booked case (the payload cannot and must not distinguish them).
3. WHEN the first-session state renders THEN the homework section SHALL still render (a first session may still carry a prior homework row when a previous session completed without confirmation — INV-HW3/HW4 govern assignment/grading, not this view).

### REQ-006: Previous Homework Assignments

**User Story:** As a teacher, I want the student's previous homework assignments with their grades, so I know what was assigned and how it was performed (FR-5.3 cross-teacher continuity).

#### Acceptance Criteria

1. WHEN the dialog opens THEN the system SHALL fetch the student's homework history via the SHIPPED teacher-gated `studentHomeworkHistory(studentId, page, pageSize)` query (`backend/graphql/query/classes/session-report.query.ts:134`, service `backend/services/classes/student-homework.service.ts:134`) — zero new backend reads.
2. WHEN history rows exist THEN the dialog SHALL render a newest-first list of the first page (page 1, `pageSize` 5) showing per row: Jadid span (Surah/Juz + from/to ayah + grade), Madi span, and the owning session line — labels from the `homework` namespace leaves; rows authored by OTHER teachers SHALL be visible identically (cross-teacher continuity, FR-5.3 — the gate is "≥1 session together", not authorship).
3. WHEN the history page is empty (`totalCount: 0`) THEN the dialog SHALL render the localized no-assignments-yet state (the student's first session — consistent with INV-HW3's "assigned, not graded" first-session semantics on later views).
4. WHEN a grade is null on a track THEN the row SHALL render the not-yet-graded presentation for that track — never `0` and never a fabricated grade.
5. WHEN deeper history exists beyond the first page THEN the dialog SHALL surface the total count ("+N more" line); full in-dialog pagination is deferred item D3.

### REQ-007: Read-Only Guarantee

**User Story:** As the platform, I want the preparation view provably read-only, so a teacher can review but never alter curriculum state or homework records.

#### Acceptance Criteria

1. WHEN this plan ships THEN it SHALL add ZERO mutations: no mutation document, no mutation hook, no write affordance inside the dialog; the only GraphQL operations the dialog issues are the two reads of REQ-004/REQ-006.
2. WHEN the ticket test scenario "Progress view is read-only for teachers" is verified THEN the evidence SHALL be (a) the dialog's document set contains no `mutation` operations and (b) the SDL exposes no progress/homework mutation reachable by teachers (progress writes are internal-only — blocked-by plan §4/§8 BFLA row).
3. WHEN a teacher interacts with the dialog THEN the ONLY session-mutating affordances remain the existing lifecycle CTAs outside the dialog (start/complete owned by `teacherSessionCacheArms.ts:157-198`), untouched by this plan.

### REQ-008: Affordance Placement & Gating

**User Story:** As a teacher, I want a "Prepare" action on exactly the sessions where preparation is meaningful, so the affordance is never noise.

#### Acceptance Criteria

1. WHEN a session row on `/teacher/sessions` has `status = scheduled` AND `intent = tajweed` THEN the row SHALL offer a "Prepare" affordance, ordered BEFORE the existing "Start" affordance (review precedes start — FR-6.2), produced by the shipped affordance-matrix builder `teacherActionsForSession` (`frontend/views/teacher/sessions/teacherSessionCacheArms.ts:157-198`) extended with a Record-gated branch mirroring `RUBRIC_SESSION_TYPES` (`:134-138`).
2. WHEN a row has any other status or intent (`started`, `completed`, `cancelled`, `disputed`, `hifz`, `evaluation`, null) THEN the row SHALL NOT offer the Prepare affordance (scope: Tajweed, pre-session only).
3. WHEN the Prepare intent fires THEN the dialog slot SHALL follow the keyed-dialog pattern: a `prepDialogSessionId` triple in `useTeacherSessionDialogSessions` (`frontend/views/teacher/sessions/useTeacherSessionDialogSessions.ts:13-48`), a mount resolving the row + `studentId` (pattern `TeacherSessionReportDialogMount.tsx:25-45`), mounted once in `TeacherSessionsOverlays.tsx:43-97`.
4. WHEN the dialog is closed THEN the two queries SHALL skip (no network round-trip on a closed mount — `skip: !open` per `useTeacherSessionReportQueries.ts:33-38`).

### REQ-009: Authorization, Tenancy & the Cross-Actor Journey

**User Story:** As the platform, I want the preparation read to inherit the consumed queries' authorization exactly, so no new tenancy surface opens and the cross-actor contract is proven end-to-end.

This feature observes shared state across actors (student books → teacher reads), so the journey is captured here and maps 1:1 onto `test/workflows/classes/teacher-preparation-read.journey.test.ts`.

#### Actor Table

| Actor | Role (`users.role`) | Can Do | Cannot Do |
|---|---|---|---|
| Teacher (session owner) | `teacher` | open the Prepare dialog on own `scheduled` tajweed rows; read `studentProgress` + `studentHomeworkHistory` for that student (shared-session gate passes on the booked row itself) | read students they share no session with; alter progress/homework |
| Foreign teacher | `teacher` (no shared session) | — | 403 on both reads (constant-shape `ForbiddenError`, no existence oracle) |
| Student | `student` | book the session (existing `createSession`); read own `studentProgress` (blocked-by plan) | see the teacher's prep view; read others' progress |
| Parent | `parent` | — (existing `parentChildProgress` portal surface, unchanged) | call `studentProgress` (scope-layer 403, blocked-by plan REQ-010.4) |
| Admin | `admin` | read any student's progress via `studentProgress` (not this plan's UI) | — |

#### Ordered Step List (Journey J1 — pre-session preparation read)

1. Fixtures commit: tajweed plan + 3 lessons (`id ASC`), active tajweed subscription for student A (progressed) and student B (fresh), certified teacher T1, foreign certified teacher T2.
2. Student A settles one prior tajweed session through the real lifecycle (`createSession` → `startSession` → `completeSession` → `confirmSessionCompletion`) — the progress increment advances A's pointer to lesson 2; the lifecycle's shipped notification waves are SPIED at the dispatch boundary and asserted to fan out to nobody unexpected (`test/workflows/AGENTS.md` rules 5+12; precedent `test/workflows/classes/tajweed-progress-increment.test.ts:215`).
3. Student B books a tajweed session with T1 (`createSession`) — row born `scheduled` (the "request" analogue).
4. T1 → prep read for B (`getStudentProgress` + `listStudentHomeworkHistory`) → `hasProgress: false`, empty homework page — the first-session substrate, zero fabricated fields.
5. Student A books a tajweed session with T1 → T1 → prep read for A → `currentLessonPosition: 2`, `totalLessons: 3`, `completionPercent: 33`, and A's prior homework row visible with its grade.
6. T2 → prep read for A and for B → DENIED (`ForbiddenError`, code `FORBIDDEN`) on both reads.
7. Cleanup: tracked `afterAll` — zero residue (per `test/workflows/AGENTS.md`).

#### Acceptance Criteria (cross-actor, observer-perspective EARS)

1. WHEN student B books a Tajweed session THEN teacher T1 SHALL observe `hasProgress: false` on the preparation read — the machine-readable "First session — diagnostic" substrate (REQ-005).
2. WHEN student A (with a settled history) books THEN teacher T1 SHALL observe the advanced current lesson and A's graded homework rows on the same read — shared-state visibility before the session starts.
3. IF a teacher shares no session with the student THEN both preparation reads SHALL deny with the constant-shape `ForbiddenError` (no existence oracle — blocked-by plan D6 discipline).
4. WHEN any caller invokes the preparation surface THEN the system SHALL expose no mutation path (REQ-007) — the teacher's preparation is observation, never authorship.

### REQ-010: i18n Namespace Extension

**User Story:** As a bilingual academy, I want every new prep-view string compile-typed in both locales, so the Arabic teacher experience is first-class.

#### Acceptance Criteria

1. WHEN the dialog labels are added THEN `SessionsLabels` (`shared/locale/types/sessions/labels.ts:20`) SHALL gain the prep leaf set (dialog title, prepare CTA, current-lesson heading, position line `(position: number, total: number) => string`, completion heading, first-session title/body, previous-homework heading, homework-empty title/body, "+N more" line `(count: number) => string`, read-only hint, loading aria-label) with EN + AR implementations (formal MSA, no identifiers in copy) — exact-arity function-leaf precedents: `ledgerShownPage: (visibleCount: number, totalCount: number) => string` (`shared/locale/types/wallet/labels.ts:80`) and in-namespace `reportGradeAriaLabel: (gradeLabel: string, grade: number) => string` (`shared/locale/types/sessions/labels.ts:365`).
2. WHEN the parity belt runs THEN `shared/locale/sessions-namespace.parity.test.ts` SHALL stay green (exact key-set parity, compile-typed both locales).
3. WHEN any prep string renders THEN it SHALL come from `useAppTranslation` leaves — never hardcoded English, never `next-intl`, never `shared/messages/`.
4. WHEN a function leaf is added THEN the parity belt's `FUNCTION_LABEL_KEYS` set (`sessions-namespace.parity.test.ts:248`) and `sampleArgsFor` (`:351`) SHALL register it with sample arguments — an unregistered function leaf makes the belt's non-empty-string resolution throw (the belt's `nonEmptyLabelOf` rejects non-string values).

### REQ-011: Zero New Routes, Nav & Backend Surfaces (Scope Guard)

**User Story:** As the scope owner of a 3-SP ticket, I want the surface delta provably minimal, so the plan cannot sprawl into the matching stream's territory.

#### Acceptance Criteria

1. WHEN this plan ships THEN `app/` SHALL gain no route/page/layout (the dialog mounts inside the EXISTING `/teacher/sessions` page, `app/(dashboard)/teacher/sessions/page.tsx:32-34`) and `frontend/views/dashboard/nav/navItems.ts:143-150` SHALL be byte-unchanged.
2. WHEN this plan ships THEN `backend/` SHALL gain no file and no modified line outside generated artifacts — the plan's git diff SHALL touch only `frontend/`, `shared/locale/`, `test/workflows/`, `frontend/stories/`, and generated `frontend/graphql/generated/` (codegen output only).
3. WHEN the session-request intake flow ticket lands later THEN it SHALL be able to mount the same dialog cluster unchanged (deferred item D4) — this plan keeps the dialog props row-derived (`sessionId`, `studentId`, `open`, `onClose`) with no list-page coupling beyond the mount.

## UX / Navigation Requirements

| Aspect | Ruling | Evidence / Rationale |
|---|---|---|
| New routes | NONE | The dialog mounts inside the existing `/teacher/sessions` page (`app/(dashboard)/teacher/sessions/page.tsx:32-34`, `withPageAuth({ roles: [UserRole.Teacher] })`) — REQ-011.1 |
| Sidebar / nav | UNCHANGED | Teacher block `frontend/views/dashboard/nav/navItems.ts:143-150` untouched; the Prepare affordance lives on the session row, not the nav |
| Mobile bottom nav | NONE | Repo has no bottom-nav surface anywhere (confirmed in the lessons + progress sibling plans) |
| Primary surface | "Prepare" row CTA → `TeacherPrepDialog` on `/teacher/sessions` | Affordance matrix `teacherSessionCacheArms.ts:157-198`; keyed-dialog mount pattern `TeacherSessionReportDialogMount.tsx:25-45` |
| Future surfaces | Dashboard up-next card + `/schedule` chips + the request-accept dialog | Deferred items D2/D4 — mounting is one `openPrepDialog(sessionId)` intent away |
| Role surfaces | Teacher UI only | Parent keeps `parentChildProgress` (portal); student self-read and admin reads exist at the query level (blocked-by plan REQ-010), no UI in this plan |

## Non-Functional Requirements

### Performance

1. WHEN the dialog opens THEN it SHALL issue exactly two parallel read queries (progress + homework first page) and skip both while closed (`skip: !open`) — no N+1, no per-row fetches (the CTA carries no in-flight slot, status-pure per the matrix docblock at `teacherSessionCacheArms.ts:150-156`).
2. WHEN the homework history renders THEN the first page SHALL be bounded at `pageSize: 5` (the service clamps pages — `clampHomeworkHistoryPage`, `student-homework.helpers`) — the "+N more" line is computed from `totalCount`, no extra fetch.

### Security

1. WHEN the dialog issues reads THEN caller identity SHALL be server-derived (`ctx.user` on both queries); the `studentId` argument SHALL come exclusively from the cached session row resolved in the mount (server data), never from user input — no BOLA seam is opened by this plan.
2. WHEN a read denies with `FORBIDDEN` THEN the dialog SHALL render the `PermissionDeniedFallback` seam (`frontend/components/ui/PermissionDeniedFallback.tsx`, rule `frontend/AGENTS.md:66`) — never a bare `null`, never a raw error dump.
3. WHEN the `StudentProgress` type (no `id` field) enters the Apollo cache THEN `apolloCacheTypePolicies` SHALL register `StudentProgress: { keyFields: false }` (`frontend/providers/apollo/apolloCache.ts:76+`, precedent `StudentHomeworkPage` — the sibling wrapper with the same no-id shape).

### Reliability

1. WHEN either query is still loading THEN the dialog SHALL render its skeleton branch with the localized loading aria-label; the two queries fold ONE `loading` value (pattern `useTeacherSessionReportQueries.ts:43`).
2. WHEN the progress query succeeds but the homework query fails (or vice versa) THEN each section SHALL branch independently — one section's failure never blanks the other.

### Observability

1. WHEN the dialog renders a denial or error state THEN client-side diagnostics SHALL go through the Apollo error-mapping seam (`frontend/providers/apollo/error-link.map.ts` / `GraphQLErrorSurfaceHost`) — the plan adds zero `console.*` and zero bespoke toasts beyond the localized in-dialog branches.

## Constraints and Assumptions

### Technical Constraints

- Zero backend delta (REQ-011.2): `db push`/`db migrate` are NOT part of this plan; the ONLY generated-artifact step is `bun codegen` (the SDL carrying `studentProgress` is already landed — `frontend/graphql/generated/schema.graphql:1717`).
- The substrate gate (REQ-003) MUST pass before the document task runs — it guards against regressed checkouts, not a missing dependency (the progress ticket shipped on 2026-09-26, ticket #227).
- All view files follow the max-lines split discipline of the teacher sessions folder (orchestrator / parts / helpers / hook / mount — precedent `TeacherSessionReportDialog.tsx` header `:1-14`).

### Business Constraints

- 3 SP · Dev 1 · Milestone 2. Anything needing backend reads, display names, or the request-accept flow is deferred (D1..D6), not expanded.
- Curriculum order is `id ASC` per plan (immutable contract of the lessons ticket — consumed only).

### Assumptions

- The shipped `studentProgress` query carries its contracted payload (REQ-003.3) for this plan's UI tasks; if a field is ever renamed there, only the document + helpers adapt.
- Teachers reach the prep view through `/teacher/sessions`; the row payload carries `intent` and `studentId` already (`session-reads.documents.ts:117-149`).
- A `scheduled` tajweed row satisfies the sibling plan's teacher gate (`countTeacherStudentSessions ≥ 1`, any status) — the booked row itself is the relationship.

## Success Criteria

### Definition of Done

- [ ] All REQ-001…REQ-011 acceptance criteria met
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every modified/new file
- [ ] Helper unit suites + `shared/locale/sessions-namespace.parity.test.ts` green via `bun run test/scripts/run-test.ts`
- [ ] Journey `test/workflows/classes/teacher-preparation-read.journey.test.ts` green (7 ordered steps, both denial probes)
- [ ] `deferred-items.md` contains zero blocker-glyph rows at the final gate
- [ ] Phase 1.5 gate passed (this plan): `outcome/plan-review-R1.md` records a clean verdict

### Acceptance Metrics

- 100% branch coverage on the new helpers (view-model derivation: progress card model, first-session resolution, homework row shaping, "+N more" math)
- Zero new tsgo/biome/lint errors vs baseline (`outcome/0-baseline-outcome.md`)
- Zero backend files in the diff; zero mutation operations in the new documents (REQ-007)

## Glossary

| Term | Definition |
|---|---|
| Preparation read | The composed read of `studentProgress` + `studentHomeworkHistory` for a student of an upcoming Tajweed session |
| First-session substrate | `hasProgress: false` — the machine-readable state rendered as "First session — diagnostic" |
| Pointer row | The single `progress` row for a (student, plan) whose `lesson_id` IS the current lesson (blocked-by plan's model) |
| Dual confirmation | Teacher `completeSession` + student `confirmSessionCompletion` — the only progress-advancing event |
| Cross-teacher continuity | Homework rows visible to any teacher sharing ≥1 session with the student, regardless of authoring teacher (FR-5.3) |
| The "request" | Today: the `scheduled` row a student's booking created. Future: the intake/accept flow's request object mounts the same dialog (D4) |

---

## Requirements Review Checklist

- [x] User stories have roles/features/benefits · EARS throughout · NFRs present · Success criteria measurable
- [x] UX/navigation defined for all roles (no-new-route ruling with evidence, REQ-011 + UX table)
- [x] Cross-actor journey captured: actor table + 7 ordered steps + observer-perspective EARS (REQ-009) with 1:1 journey file mapping
- [x] Blocked-by dependency explicit with a pre-flight gate and verbatim contract consumption (REQ-003)
- [x] Terminology consistent with `docs/specs/state-machine-invariants.md` (INV-PR1/PR2, INV-HW3/HW4) and `docs/specs/functional-requirements.md` (FR-6.2, FR-5.3)
