# Requirements & Specification: Parent Read-Only Monitoring Portal

**Plan directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal`
**Specs path:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/specs.md`
**Companion Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md`
**Companion Tasks:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/tasks.md`
**Deferred-items ledger:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/`

## Document Information

- **Feature Name**: Parent Read-Only Monitoring Portal
- **Ticket**: `docs/planning/TICKETS.md:1988-2036` (Owner Stream: Dev 1, Milestone 3, 8 SP, Blocked By: "Student Confirmation of Parent Link" + "Session Request Notification to Teacher" — both shipped: `ai/finished_plans/milestone_3_parent_portal_admin_governance/student-confirmation-of-parent-link/`, `ai/finished_plans/milestone_2_matching_notifications_escrow/session-request-notification-to-teacher/`)
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Author**: Spec Plan Generator (spec authored by planning agent)
- **Stakeholders**: Parents (consuming audience), Dev 1 stream (feature owner), students (data subjects — consent-gated per INV-P1), teachers (report/homework producers), Dev 1 downstream tickets DEV1-017 (session-completion notification display — consumes the portal's deep-link route) and DEV1-019 (E2E parent journey coverage).
- **Related Canonical Documents**: `docs/parents/parent-link-request.md` (link state machine + consumer contract §8) · `docs/parents/handshake-code-discovery.md` · `docs/workflows/04-parent-supervision-handshake.md` (monitoring scope §5, restrictions, severance) · `docs/specs/state-machine-invariants.md:226-239` (INV-P1..P4) · `docs/specs/functional-requirements.md:222-224` (FR-7.3) · `docs/sessions/session-report-homework.md` (participant-only read posture) · `docs/notifications/realtime-engine.md` (WS substrate) · `docs/testing/workflow-journey-tests.md` (journey layer).

---

## ⚠️ Phase-0 Ground-Truth Verification (verify-then-claim, ruled against the live tree 2026-09-11)

Every substrate below was re-probed against the live tree by the spec author BEFORE being cited. Prose-only (unverifiable) claims are labeled CREATE, never EXISTS/UPDATE. Research basis: `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/research-00-planning-basis.md` (5 read-only research agents, 2026-09-11).

| Substrate | State | Evidence (verified 2026-09-11) |
|---|---|---|
| `user_role` enum incl. `parent` | EXISTS | `backend/db/schema/enums.ts:9` (`["admin","teacher","student","parent"]`); TS mirror `backend/enum/users/user-role.enum.ts:5-10` (`UserRole.Parent = "parent"`, `toUserRole` guard :24-36) |
| `parents` role-child table | EXISTS | `backend/db/schema/parents/parents.ts:11` — shared-PK FK→users.id, CASCADE only; no extra columns |
| `students.parentId` — the authorization grant | EXISTS | `backend/db/schema/students/students.ts:32` (nullable FK→users, `onDelete: "set null"`); index `students_parent_id_idx` at `students.ts:41`; B.12 (one parent per student) + B.13 (one parent, many children) ratified at `docs/workflows/04-parent-supervision-handshake.md:162-163` |
| `parent_link_requests` table | EXISTS — history only, NEVER read for authorization | `backend/db/schema/parents/parent-link-requests.ts:39`; binding rule `docs/parents/parent-link-request.md:121-122` |
| `session` table (attendance source) | EXISTS | `backend/db/schema/classes/session.ts:50`; `status` pgEnum :60 (`session_status` : `backend/db/schema/enums.ts:23` = scheduled/started/completed/cancelled/disputed); `startedAt`/`endedAt` :66-67; indexes incl. `session_student_id_idx` :84 |
| `reports` table (session reports + per-session evaluation data) | EXISTS | `backend/db/schema/classes/reports.ts:20`; `sessionId` NN+unique :24-26/:36; `teacherNotes` :27; `studentRatingByTeacher` int CHECK 0-5 :28/:37-40; `reports_session_id_idx` :41. NO `teacher_id` column (reached via session) |
| `home_work` table (Jadid `current*` + Madi `revision*`) | EXISTS | `backend/db/schema/classes/home-work.ts:23`; `current*` columns :30-33, `revision*` :34-37; grade CHECKs 0-100 :46-47; `sessionId` NN+unique :27-29/:45 |
| `progress` table | EXISTS — SKELETON (`studentId`, nullable `lessonId`, timestamps; NO score/completed_at) | `backend/db/schema/classes/progress.ts:19-34`; indexes `progress_student_id_idx` :33 |
| `lessons` table | EXISTS — SKELETON (`planId` nullable, `title` only) | `backend/db/schema/classes/lessons.ts:17-29` |
| `evaluations` table | EXISTS — sheikh→teacher-candidate orientation; NOT child-scoped; EXCLUDED from portal (ruling R-C) | `backend/db/schema/teachers/evaluations.ts:21-47`; header :9-14 (evaluator/evaluated FKs, session nullable, score 0-100 CHECK :43, soft-delete) |
| `SessionRepository.listForStudent` / `countForStudent` + shared predicate helper | EXISTS | `backend/db/repo/classes/session.repository.ts:528` / `:558`; shared predicate builder in `session.repository.helpers.ts` (template for parent-scoped reads) |
| `ReportRepository.findBySessionId` | EXISTS | `backend/db/repo/classes/report.repository.ts:76` |
| `HomeWorkRepository.findBySessionId` / `findLatestByStudentId` | EXISTS | `backend/db/repo/classes/home-work.repository.ts:74` / `:122` |
| `StudentRepository.linkParentIfUnlinked` (single writer of `students.parent_id`) | EXISTS | `backend/db/repo/students/student.repository.ts:443`; single-writer rule `docs/parents/parent-link-request.md` rule R2 |
| `StudentRepository.findById` | EXISTS | `backend/db/repo/students/student.repository.ts:356` |
| `StudentRepository.listLinkedChildrenByParentId` | MISSING — CREATE | no such member (verified: full export span of the repository at `student.repository.ts:230-608` — namespace opens :230, file ends :608) |
| Parent-scoped session/report/homework/progress repo read variants | MISSING — CREATE | `backend/db/repo/classes/*` has owner/student-scoped reads only |
| `ParentLinkRequestService` + `requireActor` helper (pattern to reuse) | EXISTS | `backend/services/parents/parent-link-request.service.ts`; helper `requireActor(actorId, expectedRole, locale, tx, enforceGovernance)` at `parent-link-request.helpers.ts:246-298` (fresh DB re-check, `UnauthorizedError`/`ForbiddenError`, governance-aware, constant-copy denial) |
| `requireLinkedChild` confirmed-link gate | MISSING — CREATE | no such helper exists anywhere (grep-verified) |
| Pothos scope-auth mechanism (`$all` conjunction, role scopes, localized 403) | EXISTS | `backend/graphql/pothos/builder.ts:111-142` (`authenticated` throws `UnauthorizedError` :127-132; `role` OR-semantics :134; `permission` placeholder :137; failures → `ForbiddenError` localized :119); root `queryType`/`mutationType` :155-156 |
| Existing parent queries (`myOutgoingParentLinkRequests` etc.) + zero-arg BOLA pattern | EXISTS | `backend/graphql/query/parents/parent-link.query.ts:55-81` (`authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }`, `ctx.t("errorsTranslations")`, service call) |
| Participant-only `sessionReport`/`sessionHomework` queries | EXISTS — UNTOUCHED (ruling R-E) | `docs/sessions/session-report-homework.md:46` (indistinguishable `null` collapse; parents get nothing there), :80 ("a parent read surface is a NEW ruling…not a scope tweak"), :90 |
| `SessionReportNotificationService.notifySessionReportReady` (already notifies parent) | EXISTS | `backend/services/classes/session-report-notification.service.ts:147` — emits `session_completion` to the linked parent when `students.parent_id` is set (`docs/notifications/realtime-engine.md`) |
| Parent nav block in sidebar config | EXISTS — NEEDS FIX (`/children` → `/parent/children`) | `frontend/views/dashboard/nav/navItems.ts:133-139` (`NAV_ITEMS_BY_ROLE[UserRole.Parent]`; dead route at :136); `DashboardNavItem` shape :40-44; label resolution :190-199 |
| `/parent/children` page | EXISTS as ComingSoon stub — replaced by this plan (ruling R-H) | `app/(dashboard)/parent/children/page.tsx:16-22` (`ComingSoonView feature="children"`) |
| Parent dashboard + handshake pages | EXIST | `app/(dashboard)/parent/dashboard/page.tsx` (via `createRoleDashboardPage`), `app/(dashboard)/parent/handshake/page.tsx` (`withPageAuth({ roles: [UserRole.Parent] })`) |
| i18n namespace handles registry | EXISTS — new `parentMonitoring` handle MISSING (CREATE) | `shared/locale/namespaces/registry.ts:27-47` — 19 handles; no parent-monitoring namespace |
| Shared locale accessors (single-arg, property access) | EXIST | `shared/locale/server.ts:15-17` `getTranslations(locale)`; client `useAppTranslation(handle)` `shared/locale/client/use-app-translation.ts:8-17` |
| Shared UI primitives (`ErrorRetryAlert`, `PermissionDeniedFallback`, `NoticeSnackbar`, `IconCircleEmptyState`) | EXIST | `frontend/components/ui/` listing (verified). NOTE: no `AppDataGrid`/`MetricCard`/`PageContainer` components exist in `frontend/components/ui/` (root AGENTS.md §File Organization is stale there) — the portal MUST NOT cite them. CAUTION: a view-local `MetricCard` DOES exist at `frontend/views/admin/analytics/MetricCard.tsx:34`; it is admin-analytics-private and MUST NOT be imported by this feature |
| Attendance as a first-class table | MISSING — intentionally NOT created (ruling R-B: derived read over `session.status`) | grep over `backend/db/schema/**` finds no attendance table |
| Parent-monitoring projection types (`ParentLinkedChildReturnType`, `ParentAttendanceEntryReturnType`/`ParentAttendancePageReturnType`, `ParentReportEntryReturnType`, `ParentChildProgressReturnType`, `ParentHomeworkPositionReturnType`, `ParentPageInput` — full set per plan §2.3) | MISSING — CREATE in `backend/types/parents/parent-monitoring.types.ts` (never in service files) | `backend/types/parents/parent.types.ts:3` (`ParentSelectType` only); none of the parent-monitoring projection types exist anywhere in `backend/types/`; `ParentReturnType` is deliberately NOT created by this plan |
| Confirmed-link authorization gate (service-level) | MISSING — CREATE | covered above (`requireLinkedChild`); enforced per R-A on `students.parent_id` only |
| Journey test precedent for INV-P1 | EXISTS | `test/workflows/parents/student-confirmation-of-link.journey.test.ts` (+ `parent-link-request.journey.test.ts`, `handshake-discovery.test.ts`) |
| Wire-test precedent (role×op matrix, Bearer auth, en/ar copy) | EXISTS | `backend/graphql/test/parent-link.wire.test.ts` |

---

## 1. Executive Summary & Problem Statement

**Feature.** A read-only monitoring portal where a parent views their confirmed-linked children's: attendance history (per ticket: "sessions attended, cancelled"), session reports (teacher notes + ratings), homework assignments (Jadid & Madi tracks, grades), teacher evaluations (scores, notes), and academic progress statistics (Tajweed curriculum) — ticket `docs/planning/TICKETS.md:2002-2009`, canonical FR-7.3 (`docs/specs/functional-requirements.md:222-224`), workflow monitoring scope `docs/workflows/04-parent-supervision-handshake.md:108-116`.

**Problem.** The parent-child link machinery is fully shipped (handshake-code discovery, link request, student confirmation — finished milestone_3_parent_portal_admin_governance plans dev1-013/014/015), and the parent's `_id` grant lives on `students.parentId` (`backend/db/schema/students/students.ts:32`). But once linked, the parent sees NOTHING: `app/(dashboard)/parent/children/page.tsx` renders a ComingSoon stub, the existing `sessionReport`/`sessionHomework` queries return indistinguishable `null` to parents by design (`docs/sessions/session-report-homework.md:46`), and no parent-scoped read queries exist. The portal closes INV-P1's promise: confirmation granted access; access must now exist.

**Business Value.**
- Fulfills the monitoring half of the supervision value proposition (FR-7.3) — the reason parents on the platform consent, link, and stay engaged.
- Informs DEV1-017's completion-notification display (deep-link target for `session_completion` notifications the emitter already produces — `notifySessionReportReady` at `session-report-notification.service.ts:147`).
- Unblocks DEV1-019's E2E parent-journey coverage (sibling ticket consumes this portal).

**Actors.** `parent` (consumer, read-only) · `student` (data subject; confirmation is the access grant) · `teacher` (producer of reports/homework) · `admin` (may set `students.parent_id` directly at onboarding — recorded exception, `docs/workflows/04-parent-supervision-handshake.md:166`).

**Non-goals (explicit, ticket + workflow §5 restrictions `docs/workflows/04-parent-supervision-handshake.md:118-122`):**
1. NO payments / subscriptions from the portal.
2. NO session requests on behalf of the student.
3. NO data modification of any kind (INV-P2).
4. NO notification DISPLAY surface (owned by DEV1-017; the portal only ships the deep-linkable report view that those notifications will target — ruling R-I).
5. NO teacher contact / messaging.
6. NO schema changes — zero new tables, zero new columns (ruling R-J).

---

## 2. Requirements (EARS)

### 2.0 Execution Protocol & Engineering Discipline

#### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I need a recorded quality baseline, a deferred-items ledger, and per-task outcome records, so that new issues are distinguishable from pre-existing ones and no research is repeated.

#### Acceptance Criteria
1. WHEN implementation begins THEN the executor SHALL record the measured baseline captured in `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/0-baseline-outcome.md` (already measured 2026-09-11 from `/tmp/baseline-pp/`: `bun tsgo` error count **0**, `bun biome:check` warning count **0**, `bun run scripts/lint-service.ts --json --id baseline` full-repo `exitCode` **0**) so new issues are attributable.
2. WHEN implementation begins THEN the ledger `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/deferred-items.md` SHALL exist (pre-seeded D1..D5 at planning time) and every mid-task deferral SHALL gain a ledger row before its task may close.
3. WHEN an executing agent starts any task THEN it SHALL read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/` before writing code.
4. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` (research findings, implementation details, cross-file dependencies, carry-overs) AND flip the task checkbox `[ ]` → `[x]` in `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/tasks.md`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 on that file before the next file is touched (progressive tsgo → oxlint → biome → lint → duplicates).
6. WHEN any subtask is marked complete THEN the semantic-review checklist SHALL have run (race conditions, env-config, deferred items, cross-layer imports, enum discipline) — `sub-loop.ts` covers mechanics only.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: none · **Assumptions**: quality tooling is green on the working branch (measured green at baseline, 2026-09-11).

#### REQ-002: Translation System & Enum Import Compliance

**User Story:** As a developer, I want compile-time type-safe translations and correct enum imports, so i18n and type errors surface at build time instead of runtime.

#### Acceptance Criteria
1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(ns)` with a namespace HANDLE (`shared/locale/client/use-app-translation.ts:8-17`) and property access (`t.someKey`) — NEVER a `Translation.` enum (no such enum exists), NEVER string-literal or function-call access `t("key")`.
2. WHEN a server component renders user-facing text THEN it SHALL use `getTranslations(locale)` SINGLE-arg (`shared/locale/server.ts:15-17`) then `.parentMonitoringTranslations`-style property access — the two-argument `getTranslations(locale, "ns")` call is FORBIDDEN.
3. WHEN a GraphQL resolver needs user-facing copy THEN it SHALL use `ctx.t("errorsTranslations")`-style loader (bound to `ctx.locale`); services receive `locale: string` and use `getServerTranslations(locale).errorsTranslations`.
4. WHEN new denial copy is emitted THEN it SHALL come from the `Errors` namespace (and the new `parentMonitoring` namespace for portal UI); hardcoded strings in production code are FORBIDDEN and a grep for `next-intl`, `getBackendTranslations`, `shared/messages/`, and `Translation.` SHALL return zero hits in new/modified files.
5. WHEN an enum (`UserRole`, `SessionStatus`, `SurahJuzRef`, `NotificationType`) is used at runtime THEN it SHALL be a VALUE import from `@/backend/enum/...` — never `import type`, never string literals.
6. WHEN a new en/ar namespace leaf ships THEN key parity between `shared/locale/en/<ns>/index.ts` and `shared/locale/ar/<ns>/index.ts` SHALL be proven by a parity test (`shared/locale/<ns>-namespace.parity.test.ts`).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-001 · **Assumptions**: the compile-time locale system is the ONLY i18n surface (legacy `next-intl` fully removed).

---

### 2.1 Core Read Surfaces (per child portal surface)

#### REQ-010: Linked-Children List

**User Story:** As a parent, I want to see all my confirmed-linked children, so that I can choose whose progress to inspect (ticket AC third scenario `docs/planning/TICKETS.md:2019-2021`; B.13 one parent → many children).

#### Acceptance Criteria
1. WHEN a parent opens the portal root THEN the system SHALL return exactly those students whose `students.parentId` equals the caller's id (R-A: the student row is the grant — `docs/parents/parent-link-request.md:121-122`) and whose student account is not soft-deleted (`users.isDeleted = false`), ordered stably (e.g. `createdAt ASC, id ASC`).
2. WHEN a request reaches the service with a non-`parent` role THEN the layer-1 scope gate SHALL have already rejected it (403) — the service still re-asserts the caller role via the `requireActor` pattern (`parent-link-request.helpers.ts:246-298`).
3. WHEN the caller has zero linked children THEN the list SHALL be an empty array (honest empty state, never an error).
4. IF a linked student's account is soft-deleted THEN that student SHALL NOT appear in the list and SHALL be denied at every detail read (severance per `docs/workflows/04-parent-supervision-handshake.md:164`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020, REQ-021 · **Assumptions**: child's `fullName` IS shown — masking applies to pre-confirmation discovery only, not to one's own confirmed children (ruling R-G). Precedent reconciliation: the SHIPPED emitter `backend/services/classes/session-report-notification.service.ts:191` already includes the child's full name (`wave.student.fullName`) in the parent's completion-notification copy, so full-name display for a confirmed-linked child is the platform's ratified posture; masking (R9, `docs/parents/parent-link-request.md:139`) applies to pre-confirmation discovery and link-request surfaces only.

#### REQ-011: Child Switcher (Multi-Child Navigation)

**User Story:** As a parent with multiple linked children, I want to switch between their views without re-login, so I can monitor each child independently (ticket AC `docs/planning/TICKETS.md:2019-2021`).

#### Acceptance Criteria
1. WHEN a parent selects a child in the switcher THEN the selected-child state SHALL be expressed via the `?student=<id>` URL search parameter (ruling R-G; NO Zustand — the package is absent from `package.json`, verified) and the detail view SHALL re-render for the selected child.
2. WHEN the portal root loads with NO `?student` param and the parent has ≥1 linked children THEN the view SHALL either auto-select the first child (stable order) or present the children list — a single deterministic behavior chosen at plan time.
3. WHEN the `?student` param names a student not in the caller's linked set THEN the UI SHALL show the localized permission-denied/empty fallback AND the backing queries SHALL return 403 (no data rendered).
4. WHILE a child view is active THEN switching children SHALL NOT leak one child's rows into another (query keys include the student id; Apollo cache entries are scoped per `studentId` variable).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-010, REQ-040 · **Assumptions**: URL-param state survives refresh/share and is the deep-link anchor (ruling R-I).

---

#### REQ-012: Attendance History (Derived — ruling R-B)

**User Story:** As a parent, I want to see my child's attendance history (sessions attended and cancelled), so I know teaching actually happened (ticket `docs/planning/TICKETS.md:2005`; workflow §5 row `session` (`status`) at `docs/workflows/04-parent-supervision-handshake.md:112`).

#### Acceptance Criteria
1. WHEN a parent requests a linked child's attendance THEN the system SHALL return a paginated list of that child's `session` rows with `status`, `startedAt`, `endedAt`, and the display fields needed to classify each row (NO attendance table exists — derivation is from `session.status` only).
2. WHEN classifying a row THEN `completed` SHALL render as attended, `cancelled` as cancelled, `disputed` as disputed (surfaced, not hidden), and `scheduled`/`started` as upcoming/in-progress.
3. IF the child has no sessions THEN the surface SHALL render a null-safe empty state (localized), never an error.
4. WHEN the list is paged THEN pagination SHALL ride the existing `SessionRepository.listForStudent`/`countForStudent` pattern (`session.repository.ts:528`/`558`) reusing its shared predicate builder, and lookups SHALL be served by `session_student_id_idx` (`session.ts:84`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-030 · **Assumptions**: per ruling R-B attendance is a DERIVED read; introducing a first-class attendance table is NOT a gap for MVP (deferred-items D4).

#### REQ-013: Session Reports (Teacher Notes + Ratings)

**User Story:** As a parent, I want to read the teacher's notes and rating after each session, so I understand how my child is doing (ticket `docs/planning/TICKETS.md:2006`; workflow §5 `reports` row).

#### Acceptance Criteria
1. WHEN a parent requests a linked child's session reports THEN the system SHALL return a paginated list of `{ session summary, teacherNotes, studentRatingByTeacher (0-5, nullable), createdAt }` derived from `reports` joined through `session` on `studentId` (`reports.ts:20-42`).
2. WHEN a session exists but its report does not, THEN the pair SHALL NOT appear as a fabricated report row — absence is honest omission, and nullable report fields (rating not yet given) render as localized "not rated yet"-style empty states.
3. IF the student's link is not in force THEN the query SHALL deny with 403 and return ZERO rows (observer-safe, see REQ-021/022).
4. WHEN a parent clicks a report row THEN the UI SHALL display the report in a detail view deep-linkable by URL (`/parent/children/<studentId>?tab=reports&session=<sessionId>` or equivalent — the forward contract for DEV1-017 notification deep links, ruling R-I).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-030 · **Assumptions**: existing participant-only `sessionReport` query stays untouched (R-E); the portal query is NEW and parent-scoped.

#### REQ-014: Homework (Jadid & Madi Tracks with Grades)

**User Story:** As a parent, I want to see my child's assigned homework (new memorization and revision) and its grades, so I can follow along (ticket `docs/planning/TICKETS.md:2007`; workflow §5 `home_work` row :114).

#### Acceptance Criteria
1. WHEN a parent requests a linked child's homework THEN the system SHALL return a paginated list of `home_work` rows joined through the session of that student, exposing BOTH tracks: Jadid = `currentFromAyah`/`currentToAyah`/`currentSurahJuz`/`currentGrade`; Madi = `revisionFromAyah`/`revisionToAyah`/`revisionSurahJuz`/`revisionGrade` (`home-work.ts:30-37`), plus the owning session summary.
2. WHEN a track block is fully null (no assignment on that track) THEN the UI SHALL render a localized "none assigned" state — never fabricate `0` grades.
3. WHEN grades render THEN they SHALL be shown on their [0,100] scale (`home_work` CHECK constraints `home-work.ts:46-47`) and surah/juz refs SHALL render via the localized names of the `surah_juz_ref` enum members (`enums.ts:89` — value imports from `@/backend/enum/...` server-side, generated types client-side).
4. IF the child has no homework rows THEN the surface SHALL render a null-safe empty localized state.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-030 · **Assumptions**: Jadid/Madi verbatim labels come from the `parentMonitoring` namespace (REQ-043).

#### REQ-015: Teacher Evaluations of the Child (Ruling R-C)

**User Story:** As a parent, I want to see the teacher's evaluation of my child (score + notes), so I can judge teaching quality (ticket `docs/planning/TICKETS.md:2008`; workflow §5 `evaluations` row :115).

#### Acceptance Criteria
1. WHEN the portal renders "teacher evaluations" for a child THEN the data SHALL come from the per-session teacher evaluation OF THE CHILD stored in `reports` — specifically `studentRatingByTeacher` (0-5) + `teacherNotes` (`reports.ts:27-28`) — presented per session with timestamps.
2. WHEN any code reads evaluation data for the PORTAL THEN it SHALL NOT read the `evaluations` table (`backend/db/schema/teachers/evaluations.ts:21`) — that table is sheikh→teacher-candidate orientation data (verified header :9-14), not child data; including it would expose unrelated people to a parent.
3. IF no reports exist for the child THEN the evaluations surface SHALL render a localized empty state identical in structure to the reports empty state.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-013, REQ-021, REQ-030
- **Assumptions / clarification (RATIFIED interpretation, ruling R-C):** the ticket's "teacher evaluations (scores, notes)" and workflow §5's `evaluations` table row conflict with the live schema (the `evaluations` table is teacher-candidate evaluation). The product intent — parent's view of how the TEACHER evaluates the CHILD — is satisfied by `reports.studentRatingByTeacher` + `teacherNotes`. This interpretation is recorded as a documentation note; IF product later wants sheikh-evaluations surfaced, that requires a new authorization analysis and a new ticket.

---

#### REQ-016: Academic Progress (Tajweed Position — ruling R-D)

**User Story:** As a parent, I want a summary of my child's Tajweed/curriculum progress, so I know where they stand (ticket `docs/planning/TICKETS.md:2009`; workflow §5 `progress` row :116).

#### Acceptance Criteria
1. WHEN a parent requests a child's progress THEN the system SHALL return: (a) a count of `progress` rows for the student (the existingskeleton's honest signal), plus (b) the LATEST homework position per track (Jadid: latest `currentSurahJuz` + ayah range; Madi: latest `revisionSurahJuz` + ayah range — via `HomeWorkRepository.findLatestByStudentId`-style reads, `home-work.repository.ts:122`) as the Tajweed curriculum position indicator.
2. WHEN the `progress` table has no rows for the student THEN the count SHALL be `0` rendered as a localized "no recorded progress yet" empty state (never an error).
3. WHEN deep curriculum-traversal statistics (percentage-through-curriculum, per-ayah completion maps) are requested THEN they SHALL NOT be implemented here — deferred to a future curriculum ticket (deferred-items D1; the `lessons` table is a title-only skeleton, `lessons.ts:17-29`).
4. IF the link is not in force THEN the query SHALL deny 403 with zero rows.

#### Additional Details
- **Priority**: Medium · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-030; CREATE `Progress*` reads (none exist in any repo today)
- **Assumptions (RATIFIED interpretation, ruling R-D):** `progress`/`lessons` have no writers or readers today; honest reads over skeleton tables + homework position constitute the MVP "academic progress statistics."

---

### 2.2 Authorization & Read-Only Enforcement (INV-P1, INV-P2)

#### REQ-020: Parent Role Gate

**User Story:** As the platform, I want every portal query reachable only by authenticated parents, so role boundaries hold before data is touched.

#### Acceptance Criteria
1. WHEN any portal query field is defined THEN it SHALL carry `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }` (conjunction is load-bearing — pattern at `query/parents/parent-link.query.ts:60-65` and scope resolution at `pothos/builder.ts:122-142`).
2. WHEN an unauthenticated caller hits a portal field THEN the system SHALL throw `UnauthorizedError` (extensions.code = UNAUTHORIZED per `builder.ts:127-132`) — 401 semantics, never 403.
3. WHEN a non-parent authenticated caller (admin/teacher/student) hits a portal field THEN the system SHALL throw the localized `ForbiddenError` (extensions.code = FORBIDDEN — mapped at `builder.ts:111-121`); admins do NOT get portal access (portal is parent-private; admin analytics have their own surfaces).
4. WHEN `UserRole.Parent` is referenced THEN it SHALL be a value import from `@/backend/enum/users/user-role.enum` (`user-role.enum.ts:9`).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: none · **Assumptions**: role scope is OR-semantics by design (`builder.ts:133-134`); portal fields list exactly `[UserRole.Parent]`.

#### REQ-021: Confirmed-Link Gate (Ruling R-A, INV-P1)

**User Story:** As the platform, I want data served only when the student row still names the caller as parent, so consent revocation takes effect immediately (INV-P1, `docs/specs/state-machine-invariants.md:236`; severance `docs/workflows/04-parent-supervision-handshake.md:164`).

#### Acceptance Criteria
1. WHEN any portal service read executes THEN it SHALL first verify `students.parentId === callerId` for the requested student via a new `requireLinkedChild(parentActorId, studentId, locale, tx)` gate modeled on `requireActor` (`parent-link-request.helpers.ts:246-298`): fresh DB read, `UnauthorizedError` for unauthenticated, `ForbiddenError` for link mismatch, localized constant copy, one bounded `logDomainError`.
2. WHEN the portal authorizes reads THEN it SHALL read ONLY `students.parentId` (via `StudentRepository.findById`, `student.repository.ts:356`) — it SHALL NEVER query `parent_link_requests` for authorization (`docs/parents/parent-link-request.md:121-122`).
3. WHEN the linked student's account is soft-deleted (`users.isDeleted = true`) THEN the gate SHALL deny with the SAME constant 403 shape as a never-linked probe (severance is immediate per `docs/workflows/04-parent-supervision-handshake.md:164`, no branch disclosure). BY CONTRAST, a suspended/blocked child does NOT sever read access — monitoring is NOT the login posture (deliberate governance ruling; the workflow doc's severance governs soft-delete only).
4. IF the admin set `students.parent_id` directly at onboarding (override path, `docs/workflows/04-parent-supervision-handshake.md:166`) THEN the grant SHALL be honored identically to a handshake-confirmed link — the gate reads the row, not its provenance.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020 · **Assumptions**: the link tables' statuses (`linkStatus` confirmed/expired) are history; only the live FK governs reads; soft-deleted child severs access immediately (`docs/workflows/04-parent-supervision-handshake.md:164`), while suspension/blocks do NOT sever the parent's read access (monitoring ≠ login posture, deliberate — no scope expansion implied).

#### REQ-022: 403 on Unlinked / Cross-Child Probes (Observer-Safe)

**User Story:** As the platform, I want a parent probing a foreign or unlinked student id to get the same flat denial, so no existence or linkage oracle is exposed (ticket AC `docs/planning/TICKETS.md:2015-2017`).

#### Acceptance Criteria
1. WHEN a parent requests ANY portal surface with a `studentId` that is (a) their own non-linked id, (b) another student's id, or (c) a nonexistent id, THEN the response SHALL be the SAME localized `ForbiddenError` shape (`extensions.code = FORBIDDEN`, HTTP-classified 403) with constant copy across all three cases.
2. WHEN a probe fails THEN the response SHALL contain ZERO child data (no partial lists, no hints about existence), and exactly one bounded `logDomainError` SHALL be emitted server-side.
3. WHEN the denial copy is produced THEN it SHALL resolve through `getServerTranslations(locale).errorsTranslations` (or `ctx.t("errorsTranslations")` in resolvers) so en and ar clients receive localized text — wire tests shall assert both locales (REQ-052).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021 · **Assumptions**: read denials MAY log (unlike the silent participant-only report reads) because the 403 is already disclosed to the caller; never log child data.

---

#### REQ-023: Read-Only Posture (INV-P2)

**User Story:** As a product owner, I want parents structurally unable to modify portal-owned data, so read-only is enforced by construction, not by vigilance (INV-P2 `docs/specs/state-machine-invariants.md:237`; ticket AC `docs/planning/TICKETS.md:2011-2013`; FR-7.3 business rule `functional-requirements.md:224`).

#### Acceptance Criteria
1. WHEN the portal ships THEN its GraphQL surface SHALL consist of QUERY FIELDS ONLY — zero new mutations under any parent-facing monitoring domain.
2. WHEN a parent attempts to modify data through the portal THEN every avenue SHALL be unavailable by construction (no mutation field exists to call); any attempt against unrelated surfaces SHALL still meet the existing per-field role scopes (the generalized 403 "Read-only access" outcome in the ticket is satisfied by absence + scope denial; no new global "parents may not mutate" blanket is introduced — parents retain their legitimate link-request mutations: `requestParentChildLink` / `cancelParentLinkRequest`).
3. WHEN portal UI is rendered THEN it SHALL expose no mutation affordances (no edit buttons, forms, or actions) for portal-owned data.
4. WHILE the portal page is open THEN zero mutation operations SHALL appear in the network layer for portal-owned entities.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-020 · **Assumptions**: INV-P2 enforcement = read-surface-only scope + per-field role scopes (existing mechanism), NOT a veto on parents' own legit mutations (link requests).

#### REQ-024: BOLA Discipline (Identity From Context Only)

**User Story:** As the platform, I want caller identity derived exclusively from the authenticated context, so no client can reassign identity or peek at others' children.

#### Acceptance Criteria
1. WHEN a portal query resolves THEN the parent identity SHALL come from `ctx.user.id` — NEVER from a client-supplied parent id (the zero-arg pattern precedent `query/parents/parent-link.query.ts:66-79`, where args are not even accepted for identity).
2. WHEN a query accepts a `studentId` argument THEN it SHALL be validated against the caller's OWN linked set inside the service (REQ-021 gate) before any data read.
3. IF a `studentId` is malformed (non-integer, ≤0) THEN the service SHALL fail identically to the denial shape (or a validation error per existing convention) — never an existence oracle.
4. WHEN the frontend issues portal queries THEN it SHALL send only `studentId` + pagination params — never parent identity, role, or auth hints.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-021 · **Assumptions**: `ctx.user` is governance-fresh per `gqlContextFactory` (password stripped) — consumed as-is.

---

### 2.3 GraphQL Contract

#### REQ-030: New Parent-Scoped Query Surface

**User Story:** As the frontend, I want typed, paginated parent-scoped queries, so the portal renders from real wire data.

#### Acceptance Criteria
1. WHEN the schema is finalized THEN it SHALL register at minimum: `myLinkedChildren` (zero-arg, REQ-010), and per-child paginated reads `parentChildSessions` / `parentChildReports` / `parentChildHomework` / `parentChildProgress` taking a `studentId` argument plus pagination (exact field names fixed at plan time, one per REQ-012..016 surface).
2. WHEN pagination arguments are accepted THEN they SHALL follow the existing `SessionListFilterInput`/`SessionPageReturnType` shape conventions (`backend/types/classes/session.types.ts:49,58`) — honest total + page window.
3. WHEN Pothos object types are authored THEN each SHALL follow the `pothos/<domain>/<entity>.pothos.ts` convention with `t.exposeID("id")` first, `DateTime` exposures for timestamps, and backing `...ReturnType` interfaces from `backend/types/` — NO local type definitions in Pothos files; the CREATE set is the parent-monitoring projection types per plan §2.3 (`ParentLinkedChildReturnType`, `ParentAttendanceEntryReturnType`/`ParentAttendancePageReturnType`, `ParentReportEntryReturnType`/`ParentReportPageReturnType`, `ParentHomework*ReturnType`, `ParentChildProgressReturnType`, `ParentHomeworkPositionReturnType`, `ParentPageInput`), CREATEd in `backend/types/parents/parent-monitoring.types.ts` (+ `classes/` where canonical), never in service files (service-layer `.types.ts` files are prohibited); no `ParentReturnType` is created.
4. WHEN new documents/types are authored THEN `bun run generate:gqlSchema` AND `bun codegen` SHALL be re-run, and the generated `frontend/graphql/generated/` output committed.
5. WHEN query fields register THEN they SHALL ride the `query/<domain>/` side-effect-barrel mechanism (new `query/parents/parent-monitoring.query.ts` imported via `query/parents/index.ts` → `query/index.ts` → `gqlSchema.ts`) and pass ROUTE_INVENTORY/registration checks.

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-020, REQ-021, REQ-024 · **Assumptions**: field set may collapse report+evaluation reads into one field if the shapes align (decision D-note at plan time); the JOURNEY/WIRE tests pin the final names.

#### REQ-031: Existing Participant-Only Queries Stay Untouched (Ruling R-E)

**User Story:** As a maintainer, I want zero drift on the locked-down report/homework read surfaces, so the participant-only oracle posture survives this ticket.

#### Acceptance Criteria
1. WHEN this plan ships THEN the existing `sessionReport` and `sessionHomework` queries SHALL NOT change authScopes, service gate (`resolveVisibleSessionForCaller`), or return shape — the indistinguishable-`null` collapse for non-participants preserved (`docs/sessions/session-report-homework.md:46,80,90`).
2. WHEN a parent needs report/homework data THEN the portal SHALL serve it through the NEW parent-scoped queries (REQ-030) — never by widening the participant-only queries.
3. IF any diff touches the participant-only read path THEN the plan review SHALL reject it (oracle-posture regression).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-030 · **Assumptions**: `docs/sessions/session-report-homework.md:80` explicitly frames the parent surface as a NEW ruling — this plan is that ruling.

---

### 2.4 UX, Navigation & i18n

#### REQ-040: Portal Routes Under `/parent/children` (Ruling R-H)

**User Story:** As a parent, I want a stable, deep-linkable portal location, so links (incl. notifications) land deterministically.

#### Acceptance Criteria
1. WHEN the portal ships THEN the portal root SHALL replace the ComingSoon stub at `app/(dashboard)/parent/children/page.tsx` (stub verified at :16-22) with the children list / first-child view, server-guarded via `withPageAuth({ roles: [UserRole.Parent] })` (pattern at `app/(dashboard)/parent/handshake/page.tsx`).
2. WHEN child detail views exist THEN they SHALL live under `app/(dashboard)/parent/children/[studentId]/` (App Router dynamic segment) with tabbed sections: attendance / reports / homework / evaluations / progress.
3. WHEN a tab is selected THEN the active section SHALL be expressible in the URL (tab via search param or segment) so a single URL is a shareable/deep-linkable destination (forward contract for DEV1-017, ruling R-I).
4. WHEN a non-parent hits any portal route THEN `withPageAuth` SHALL deny per its existing redirect/forbidden behavior, with the client fallback in `DashboardLayout` intact.
5. WHEN server components render user-facing text THEN they SHALL use `getTranslations(locale)` single-arg + property access (REQ-002); client views use `useAppTranslation(ParentMonitoring)` — `ParentMonitoring` is the camelCase namespace HANDLE object registered in `shared/locale/namespaces/registry.ts`, NOT a string argument.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-041, REQ-043 · **Assumptions**: routes carry NO `[locale]` segment (locale via cookie); Next.js 16 docs (`node_modules/next/dist/docs/`) consulted for any new App Router usage.

#### REQ-041: Child Switcher via URL Param (Ruling R-G)

**User Story:** As a multi-child parent, I want the switcher reflected in the URL, so refresh/share preserves context.

#### Acceptance Criteria
1. WHEN the switcher changes the selected child THEN it SHALL write `?student=<id>` via Next.js navigation (no Zustand, no global store — package not installed, verified).
2. WHEN the URL carries `?student=<id>` THEN the views SHALL re-key their `useQuery` calls on that id (pattern: `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` re-key precedent) — stale-child rows never render.
3. WHEN the URL student is invalid/unlinked THEN the view SHALL render `PermissionDeniedFallback` (existing, `frontend/components/ui/PermissionDeniedFallback.tsx`) fed by `mapGraphQLErrorByCode`/`extractErrorCode` (precedent `frontend/views/admin/analytics/PlatformAnalyticsContainer.tsx`).

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-040 · **Assumptions**: local state only for transient UI (hover, menu open).

#### REQ-042: Sidebar Nav Fix (`/children` → `/parent/children`)

**User Story:** As a parent, I want the sidebar "Children" item to land on the real portal, not a catch-all stub.

#### Acceptance Criteria
1. WHEN nav config changes THEN `NAV_ITEMS_BY_ROLE[UserRole.Parent]` (`frontend/views/dashboard/nav/navItems.ts:136`) SHALL retarget from route `/children` to `/parent/children`, keeping labelKey `children` and the existing icon.
2. WHEN the single-nav-source design is preserved THEN both the desktop permanent drawer and mobile temporary drawer SHALL inherit the fix with no UI code change (single config drives both via `DashboardSidebar.tsx`).
3. WHEN labelKey discipline applies THEN the key SHALL remain resolvable by exactly one label namespace per the `NavLabelKey` exclusion guard (`navItems.ts:55-77`) — no cross-namespace collisions introduced.

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-040 · **Assumptions**: the old `/children` route may still resolve to the catch-all ComingSoon for other entry paths; the nav fix is the only change required by this plan.

#### REQ-043: `parentMonitoring` i18n Namespace (Full Ceremony)

**User Story:** As a developer, I want one compile-time checked namespace for all portal copy, so en/ar parity is enforced by the type system.

#### Acceptance Criteria
1. WHEN the namespace is created THEN the full ceremony SHALL run: (a) type schema `shared/locale/types/parentMonitoring/index.ts`; (b) handle `shared/locale/namespaces/parentMonitoring/parentMonitoring.namespace.ts` via `defineNamespace<Labels>(...)`; (c) implementations `shared/locale/en/parentMonitoring/index.ts` + `shared/locale/ar/parentMonitoring/index.ts`; (d) registration in `shared/locale/namespaces/registry.ts` (verified current content :27-47), the `namespaces/index.ts` barrel, and both `shared/locale/en/messages.ts` / `shared/locale/ar/messages.ts` aggregates; (e) parity test `shared/locale/parentMonitoring-namespace.parity.test.ts`.
2. WHEN Jadid/Madi track labels, tab names, empty states, and denial-adjacent copy are needed THEN they SHALL come from this namespace (en + ar), with pluralization implemented as `(count: number) => string` function labels where counts appear.
3. WHEN namespace keys are consumed THEN access SHALL be property-only via typed labels — no string keys, no `Translation.` enum, no two-arg `getTranslations` (REQ-002).
4. WHEN wire copy for 403 denials is produced THEN it SHALL reuse the existing `Errors` namespace entries (no duplicate denial copy).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-002 · **Assumptions**: namespace handle naming follows the camelCase precedent (`parentLink`, `handshakeCode`).

---

### 2.5 Testing Strategy

#### REQ-050: Repository Tests (runInRollback + tx Discipline)

**User Story:** As a maintainer, I want the new repo reads proven against real SQL, so mapping/pagination bugs surface before review.

#### Acceptance Criteria
1. WHEN repo tests are written THEN they SHALL live under `backend/db/test/repo/`, run inside `runInRollback`, and pass `tx` to EVERY repository call inside the transaction (mixing `tx` and `db` calls prohibited — deadlock risk).
2. WHEN asserting rejections inside `runInRollback` THEN tests SHALL use the try/catch helper — NEVER `expect(...).rejects.toThrow()`.
3. WHEN fixtures are needed THEN they SHALL be built via `backend/db/test/entity-setup.ts` (no seed-data reads); helper signatures verified at authoring time.
4. WHEN tests run THEN they SHALL execute via `bun run test/scripts/run-test.ts <path>` — never raw `bun test`.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-030

#### REQ-051: Service Tests (Gate + Shape)

**User Story:** As a maintainer, I want the link gate and per-surface shaping proven in isolation, so authorization logic is pinned independent of transport.

#### Acceptance Criteria
1. WHEN service tests are authored THEN they SHALL cover: linked parent → data; unlinked parent → `ForbiddenError`; cross-child id → `ForbiddenError`; soft-deleted child → `ForbiddenError` (same constant copy, REQ-021/022); empty sets → honest empty payloads.
2. WHEN denial copy is asserted THEN it SHALL compare against `getServerTranslations(locale).errorsTranslations.*` values — never raw strings.
3. WHEN tests execute THEN they SHALL use `bun run test/scripts/run-test.ts <path>`.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-022

#### REQ-052: GraphQL Wire Tests (Role Matrix + en/ar Denial Copy)

**User Story:** As a security reviewer, I want wire-level proof of the role/link matrix, so authorization holds over the real HTTP boundary.

#### Acceptance Criteria
1. WHEN wire tests run THEN a new suite (sibling precedent `backend/graphql/test/parent-link.wire.test.ts`) SHALL exercise every portal query across: anonymous → 401; admin/teacher/student roles → 403; parent without link → 403; parent with link to ANOTHER child → 403; parent with link to the requested child → 200 with data.
2. WHEN denial assertions check copy THEN they SHALL assert `extensions.code = "FORBIDDEN"` and the localized message from BOTH `en` and `ar` locales (locale header/cookie per existing test client).
3. WHEN BOLA probes run THEN a request carrying a foreign `studentId` together with a valid parent session SHALL 403 with zero data leakage.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020..024, REQ-030 · **Runner**: `bun run test/scripts/run-test.ts <path>`.

#### REQ-054: Journey Tests (`test/workflows/parents/`)

**User Story:** As QA, I want the cross-actor flows proven end-to-end at the service/db layer, so regressions in the handbook flows fail CI.

#### Acceptance Criteria
1. WHEN journey coverage ships THEN a new journey suite SHALL exist in `test/workflows/parents/` (precedent: `student-confirmation-of-link.journey.test.ts`) covering: (J1) teacher completes session → parent reads report/homework; (J2) severed link → parent immediately loses access; (J3) unlinked probe → 403, zero leakage; (J4) multi-child switch between children.
2. WHEN journeys execute THEN they SHALL run via `bun run test/scripts/run-test.ts <path>` (NEVER raw `bun test`) and use entity-setup fixtures, not seed data.
3. WHEN a journey asserts denial THEN it SHALL assert the constant 403 shape in both en and ar where localized copy is in the assert path.

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: all 01x/02x/03x REQs · **Assumptions**: E2E browser coverage is DEV1-019's lane (deferred item D3) — journey tests here are the service/db wire.

---

### 2.6 Phase Gates & Knowledge Propagation

#### REQ-060: Plan Review Gate (Phase 1.5)

**User Story:** As an orchestrator, I want the plan reviewed against AGENTS.md before implementation, so architecture violations are caught at the cheapest moment.

#### Acceptance Criteria
1. WHEN `plan.md` and `tasks.md` are drafted THEN the plan-review gate SHALL run as an in-plan phase record (per plan-house convention) BEFORE any implementation task starts: layer rules, i18n compliance, type-pattern compliance, R-A..R-J rulings preserved.
2. WHEN the review finds violations THEN they SHALL be fixed in plan/tasks BEFORE implementation; the verdict recorded in `outcome/`.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: `plan.md`/`tasks.md` authored.

#### REQ-061: Post-Implementation Review Wave

**User Story:** As a maintainer, I want a final correctness review wave after implementation, so drift is caught before closeout.

#### Acceptance Criteria
1. WHEN all implementation tasks close THEN a review wave SHALL verify: zero new mutations on the parent portal surface (INV-P2 grep-scan), no `parent_link_requests` reads in portal code (R-A grep-lock), no writes to participant-only queries (R-E diff check), and full `bun quality-gate` green.
2. WHEN review findings exist THEN they SHALL be fixed or ledger-added (`deferred-items.md`) before closeout; unresolved ❌/⚠️ items block completion.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: implementation phases complete.

#### REQ-062: Knowledge Propagation (Canonical Doc)

**User Story:** As a future ticket author, I want a canonical doc, so the portal's rulings and contracts are discoverable.

#### Acceptance Criteria
1. WHEN the plan completes THEN a canonical doc SHALL exist (e.g. `docs/parents/monitoring-portal.md`) capturing: the new parent-scoped query contracts + BOLA posture, the confirmed-link gate (R-A / INV-P1), read-only posture (INV-P2), attendance-derivation (R-B), the evaluations disambiguation (R-C), progress-source ruling (R-D), deep-link target for DEV1-017 (R-I), and consumer obligations.
2. WHEN the doc lands THEN `AGENTS.md`'s Important References list SHALL gain the entry, and cross-refs SHALL be added where they belong (`docs/parents/parent-link-request.md` forward-pointer satisfied).

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: implementation complete.

---

## 3. UX/Navigation Requirements (MANDATORY)

### 3.1 New / Modified Routes — Roles in this repo are exactly `admin`, `teacher`, `student`, `parent` (`user-role.enum.ts:5-10`); no other roles exist.

| Route | Purpose | Guard | Roles with Access |
|---|---|---|---|
| `/parent/children` | Portal root — linked-children list / first-child view (replaces ComingSoon stub) | `withPageAuth({ roles: [UserRole.Parent] })` | Parent |
| `/parent/children/[studentId]` | Child detail — tabs: attendance, reports, homework, evaluations, progress; deep-linkable via `?student=`/`?tab=` params | `withPageAuth` parent + service-side `requireLinkedChild` on backing queries | Parent (and only for their own confirmed-linked students) |
| `/parent/dashboard` | Existing parent landing (unchanged) | `withPageAuth` parent | Parent |
| `/parent/handshake` | Existing handshake flow (unchanged) | `withPageAuth` parent | Parent |
| `/children` | Legacy bare route remains a catch-all ComingSoon (out of scope to remove) | dashboard layout | — (unlinked to new portal) |

### 3.2 Sidebar Navigation Placement

The parent's sidebar group (single config `NAV_ITEMS_BY_ROLE[UserRole.Parent]`, `frontend/views/dashboard/nav/navItems.ts:133-139`) becomes:

1. Dashboard — `/parent/dashboard` (unchanged)
2. Notifications — `/notifications` (unchanged)
3. **Children — RETARGETED `/children` → `/parent/children`** (the only change; REQ-042)
4. Link My Child — `/parent/handshake` (unchanged)
5. Profile — `/profile` (unchanged)

No new nav group; the single config feeds both desktop permanent drawer and mobile temporary drawer (no bottom nav anywhere).

### 3.3 Role-Based Access Matrix (portal surface)

| Surface | Admin | Teacher | Student | Parent (linked) | Parent (unlinked) |
|---|---|---|---|---|---|
| `/parent/children` + detail routes | Deny (403/redirect — not their portal) | Deny | Deny | Allow (own children only) | Allow list page; shows empty state |
| Portal GraphQL queries | 403 (role scope) | 403 | 403 | 200 for own children; 403 for foreign ids | 200 `[]` list; 403 on any `studentId` arg |
| Participant-only `sessionReport`/`sessionHomework` | null (unchanged) | own sessions only (unchanged) | own sessions only (unchanged) | null (unchanged, R-E) | null (unchanged, R-E) |

(Admins administer via admin surfaces — analytics/governance — not through the parent portal; impersonation is out of scope of this ticket.)

---

## 4. Cross-Actor Workflow Scenarios (Journeys)

### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Parent | `parent` | read own confirmed-linked children's portal surfaces; switch children; run legit link-request mutations (`requestParentChildLink`, `cancelParentLinkRequest`) | modify any child data; request sessions; pay; read foreign students; contact teachers |
| Student | `student` | confirm/reject link requests (grant authority); own dashboard | revoke selectively through this portal (severance flows live elsewhere) |
| Teacher | `teacher` | complete sessions; submit reports/homework incl. ratings & tracks | access parent portal |
| Admin | `admin` | set `students.parent_id` directly at onboarding (recorded exception) | impersonate a parent; read portal queries (portal is role-gated, not theirs) |

Observing actor in all criteria below: **Parent**.

### Journey J1 — Teacher completion becomes visible to the linked parent

1. Teacher → completes a session (`status = completed`) → session row terminal.
2. Teacher → submits report + homework for the session → `reports` row (rating 0-5 + notes) and `home_work` row (Jadid/Madi tracks; grades land when graded) land.
3. (Forward signal) → `notifySessionReportReady` emits `session_completion` to the linked parent (`session-report-notification.service.ts:147`) — display owned by DEV1-017.
4. Parent → opens portal → child's new report + homework visible in the Reports/Homework tabs.

EARS (observer = parent):
1. WHEN a linked child's session report and homework are committed THEN the parent SHALL see them via the portal's report/homework queries without refreshing anything else.
2. WHEN the parent navigates directly to the report deep link THEN the same detail SHALL render (deep-link invariant, ruling R-I).
3. IF the parent was never linked THEN the same access attempt SHALL deny 403 with zero data.

### Journey J2 — Severed link revokes access immediately

1. (Cause, outside this ticket) → `students.parentId` is cleared or the student's account is soft-deleted (rulings: `docs/workflows/04-parent-supervision-handshake.md:164,166`).
2. Parent → refreshes/re-queries any portal surface.
3. System → `requireLinkedChild` re-reads `students.parentId`; the grant no longer names this parent; every portal query returns the constant 403; children list excludes the severed child.

EARS:
1. WHEN the underlying grant row no longer names the calling parent THEN the next portal read SHALL deny 403 — no cache may extend visibility beyond the DB truth (reads always hit the DB, no authorization cache).
2. WHEN severance occurs during an open portal page THEN the next query SHALL fail closed and the UI SHALL swap to `PermissionDeniedFallback` / list-empty state.
3. IF the child's account is soft-deleted THEN the parent SHALL observe the SAME constant 403 as a never-linked probe (no branch disclosure).

### Journey J3 — Unlinked parent probes a student id

1. Unlinked parent → calls a portal query with a foreign/nonsense `studentId`.
2. System → role scope passes (caller IS a parent) → link gate fails → constant `ForbiddenError` 403.
3. Parent (observer) → receives localized denial; zero data; no signal distinguishing "student doesn't exist" from "not your child."

EARS:
1. WHEN a parent supplies any `studentId` outside their own linked set THEN the response SHALL be the single constant 403 shape with byte-identical copy across all mismatch causes (observer-safe, ticket AC `TICKETS.md:2015-2017`).
2. WHEN the probe is repeated with en then ar locale THEN the denial copy SHALL be localized per locale and the `extensions.code` SHALL be `FORBIDDEN` in both.

### Journey J4 — Multi-child parent switches views

1. Parent (2+ confirmed children, B.13) → opens portal → list shows both children.
2. Parent → selects child B → `?student=B` in URL → views re-render with child B's attendance/reports/homework/evaluations/progress.
3. Parent → reloads → child B still active (URL is the state).

EARS:
1. WHEN a parent with multiple confirmed-linked children loads the portal THEN the switcher SHALL offer every confirmed-linked child and nothing else (R-A list correctness).
2. WHEN switching children THEN previously-viewed child's rows SHALL NOT appear in the new child's view (re-key on `studentId`).

---

## 5. Non-Functional Requirements

### 5.1 Performance
- WHEN portal lists render THEN they SHALL be paginated (page window + honest total via the repo `list*`/`count*` pair) — no unbounded reads.
- WHEN reads execute THEN lookups SHALL be index-backed: `students_parent_id_idx` (`students.ts:41`) for the children list, `session_student_id_idx` (`session.ts:84`) for attendance/session joins; any new hot read path SHALL be justified against an existing index.
- WHEN a parent has many children THEN each portal query SHALL be scoped to ONE student (no N+1 cross-child fan-out).
- WHEN the page loads THEN the server component SHALL remain a guard-only shell; data fetch happens in client views via Apollo `useQuery` (no `useLazyQuery`).

### 5.2 Security
- WHEN a portal query resolves THEN BOLA SHALL be enforced: identity from `ctx.user` only; `studentId` validated against the caller's own linked set (REQ-021/024).
- WHEN a BOPLA attempt is made (extra payload fields, crafted ids) THEN unknown fields SHALL be ignored-by-typed-inputs and mismatched ids 403 — no mass-assignment surface exists because no mutations exist.
- WHEN BFLA is probed (non-parent role calling portal fields) THEN role scope SHALL deny 403 before service execution (REQ-020).
- WHEN denial shapes are authored THEN non-existence, foreign linkage, and severed linkage SHALL be indistinguishable in response bodies (oracle posture, REQ-022) — the SAME ruling the participants-only report reads hold (`docs/sessions/session-report-homework.md:46`).
- WHEN logging THEN denials SHALL produce ≤1 bounded `logDomainError` each, never logging child data fields.

### 5.3 Usability
- WHEN a parent uses Arabic THEN all portal copy SHALL render RTL-complete from the `parentMonitoring` namespace with en/ar key parity proven by the parity test.
- WHEN the switcher is interacted with THEN focus/tab order SHALL follow MUI defaults (no custom tab traps).
- WHEN empty surfaces render THEN they SHALL use `IconCircleEmptyState`-style localized empty states (existing primitive) — no dead blank panels.

### 5.4 Reliability
- IF a per-surface query returns no rows THEN the UI SHALL render a localized empty state (203-class expectation), never an error toast.
- IF a transient network/server error occurs THEN the UI SHALL offer retry via `ErrorRetryAlert` (existing primitive).
- WHEN the server encounters a domain error THEN single structured responses SHALL follow the existing GraphQL error contract (`docs/graphql/error-handling-contract.md`) — `extensions.code` present, no stack leaks.

---

## 6. Constraints and Assumptions

### 6.1 Technical Constraints
- Runtime is **Bun**; dev via `bun run dev`; tests via the repo runners only (never raw `bun test` for db/service/workflow suites).
- This is **Next.js 16** with breaking-changes discipline: before writing any Next.js code, consult `node_modules/next/dist/docs/` (not training memory).
- After ANY schema or GraphQL document change, run `bun run generate:gqlSchema` then `bun codegen` and commit generated output.
- `quality-gate` runs tsgo → oxlint → biome → lint → duplicates; no cache files may be cleared manually.

### 6.2 Ticket/spec Clarifications (ratified interpretations — this plan's rulings)
- **INV-P1/INV-P2 vs INV-P3 (ticket-citation discrepancy):** the ticket's decision refs cite INV-P3 for the unlinked-403 AC, but canonical INV-P3 is the session-completion NOTIFICATION invariant (`state-machine-invariants.md:238`); the unlinked-denial invariant is INV-P1 (:236) and the read-only rule is INV-P2 (:237), matching `docs/planning/PRODUCTION_READINESS.md` §5.5.1-5.5.3. This plan implements INV-P1 + INV-P2 + FR-7.3 and treats the ticket's INV-P3 cite as a documentation discrepancy, not a scope change.
- **R-C (teacher evaluations):** ticket "teacher evaluations (scores, notes)" is satisfied from `reports.studentRatingByTeacher` + `teacherNotes`; the `evaluations` table (sheikh→teacher-candidate) is EXCLUDED from the portal. Recorded as a product clarification note (REQ-015).
- **R-D (progress):** `progress`/`lessons` are skeletons; MVP progress = row count + latest homework surah/juz position per track; deep curriculum stats deferred (D1).
- **R-B (attendance):** attendance is derived from `session.status`; no attendance table in MVP.
- **R-E (read surfaces):** the portal adds NEW parent-scoped queries; participant-only `sessionReport`/`sessionHomework` stay untouched.
- **R-A (grant):** authorization reads ONLY `students.parentId`; `parent_link_requests` is history (per the shipped consumer contract).

**Rulings R-F..R-J (enumerated here for completeness; brief anchors only):**
- **R-F — denial codes:** unlinked / cross-child / nonexistent `studentId` probes all return the SAME constant localized 403 via `errorsTranslations.forbidden` (REQ-022); per INV-P2 the portal exposes QUERY fields only, zero new mutations (REQ-023).
- **R-G — multi-child navigation & confirmed-child naming:** the child switcher state lives in the `?student=<id>` URL search param; NO Zustand, no global store (REQ-011/REQ-041). A confirmed-linked child's `fullName` IS shown to its own parent (masking — R9 — applies to pre-confirmation discovery/link-request surfaces only; REQ-010, precedent `backend/services/classes/session-report-notification.service.ts:191`).
- **R-H — routes:** the portal REPLACES the ComingSoon stub at `/parent/children` and adds the `[studentId]` child-detail segment (REQ-040).
- **R-I — deep-link forward contract:** tab/entity state is URL-expressible so DEV1-017's completion notifications can deep-link into the portal (REQ-013.4, REQ-040.3).
- **R-J — zero schema changes:** no new tables, no new columns anywhere (non-goal 6; §6.1).

### 6.3 Assumptions
- Both blocked-by tickets are shipped (handshake-code discovery, link-request workflow, student confirmation — verified `ai/finished_plans/`).
- One parent per student (B.12); a parent may have many children (B.13).
- `ctx.user` is governance-fresh; services additionally re-check role per the `requireActor` pattern.
- DEV1-017 will consume the portal's report deep-link URL as its notification target (forward item D2, not built here).

---

## 7. Success Criteria

### 7.1 Definition of Done
- [ ] All acceptance criteria for REQ-001..REQ-062 are met and verified.
- [ ] `bun quality-gate` green; baseline deltas attributable (REQ-001).
- [ ] `deferred-items.md` has zero ❌/⚠️ rows at closeout.
- [ ] All portal surfaces enforce INV-P1 (link gate) and INV-P2 (no mutations) as demonstrated at repo, service, wire, and UI layers.
- [ ] Canonical doc published (REQ-062) and `docs/parents/parent-link-request.md` consumer contract satisfied.

### 7.2 Acceptance Metrics (mapped to ticket Test Scenarios, `docs/planning/TICKETS.md:2024-2032`)

| Ticket scenario | Verified by | Metric |
|---|---|---|
| Parent views child's attendance — success | REQ-012 + wire/service/journey coverage | Query returns correct derived set; UI renders rows |
| Parent views child's session reports — success | REQ-013 | reports rows incl. rating+notes render |
| Parent views child's homework — success | REQ-014 | both tracks + grades render; empties localized |
| Parent views child's evaluations — success | REQ-015 | report-sourced scores/notes render; zero `evaluations` reads |
| Parent views child's progress — success | REQ-016 | count + latest position render; honest empty on none |
| Modify attempt → 403 (read-only) | REQ-023 + wire role matrix | portal exposes query fields only; grep: zero new parent-surface mutations |
| Unlinked parent → 403 | REQ-021/022 + wire matrix | constant 403 en+ar; zero leakage |
| Multi-child switching | REQ-010/011/041 + J4 journey | correct per-child data; URL-state survives reload |

### 7.3 Quality Gates
- Repo/service/wire layers run via `bun run test/scripts/run-test.ts <path>`; journey suites in `test/workflows/parents/`.
- Codegen artifacts regenerated (`bun run generate:gqlSchema` + `bun codegen`) and green.
- Plan-review gate (REQ-060) and post-implementation review wave (REQ-061) both recorded in `outcome/`.

---

## 8. Glossary

| Term | Definition |
|---|---|
| **Jadid** | The "new memorization" homework track (`current*` columns in `home_work`: from/to ayah, surah/juz ref, grade 0-100) |
| **Madi** | The "revision" homework track (`revision*` columns in `home_work`) |
| **Tajweed** | The recitation-rules curriculum; one of the session intents (`session_intent` = hifz/tajweed/evaluation) and the progress lens used by the portal |
| **Handshake code** | Unique per-student code (`students.handshakeCode`, `KSB-[0-9A-F]{8}`) used by a parent to find their child and send a link request |
| **Confirmed link** | `students.parentId = <parent id>` — the ONLY authorization grant for portal reads (B.12/B.13, R-A) |
| **Oracle posture** | Denial responses shaped so an attacker cannot distinguish "doesn't exist" from "not yours" — constant copy, constant 403 |
| **INV-P1 / INV-P2 / INV-P3** | Parent-child invariants at `docs/specs/state-machine-invariants.md:236-238`: confirmed-consent gating; MVP read-only access; session-completion notification to parents |
| **BOLA / BOPLA / BFLA** | Broken object-level / object-property-level / function-level authorization — the three API-security failure classes the portal must resist |
| **Oracle collapse** | The participant-only report/homework queries' null-on-deny behavior (existing, untouched — R-E) |
| **EARS** | Easy Approach to Requirements Syntax (WHEN/IF/WHILE/WHERE + SHALL) |
| **`requireLinkedChild`** | The NEW service-side gate (this plan) verifying `students.parentId === callerId`; modeled on `requireActor` |
| **R-A … R-J** | This plan's ratified design rulings: R-A..R-E enumerated in §6.2; R-F (denial codes / queries-only) at REQ-022/023; R-G (multi-child `?student=` URL param) at REQ-011; R-H (portal routes replace ComingSoon) at REQ-040; R-I (deep-link forward contract for DEV1-017) at REQ-040 non-goals; R-J (zero schema changes) at constraints §6.1 / non-goal 6 — R-F..R-J are also enumerated compactly at the end of §6.2 |
