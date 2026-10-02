# Requirements — Session Report Submission with Homework (Jadid & Madi)

**Plan Directory (verbatim, used by every header/ledger/self-reference):** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/`
**Outcome Directory:** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/`
**Ticket:** `docs/planning/TICKETS.md` — `Session Report Submission with Homework (Jadid & Madi)` (heading line 1376; table at 1378-1383)
**Milestone:** 2 (per `| **Milestone** | 2 |` ticket row; Owner Stream Dev 2; 5 SP; Blocked By `Session Report & Homework Infrastructure`)
**Decision Refs:** B.11 (Surah/Juz enum), INV-HW1, INV-HW2, INV-HW3, INV-HW4, FR-5.2, FR-5.3, FR-5.4
**Version:** 1.0 · **Date:** 2026-09-17

---

## Introduction

At the end of every completed session the teacher submits a session report: performance notes, an optional student rating, and the next homework assignment across the two parallel tracks — **Jadid** (new memorization, stored on the `home_work.current_*` columns) and **Madi** (revision, stored on `revision_*`). The first session with a student is diagnostic: homework is assigned but nothing is graded (INV-HW3). Every subsequent session grades the previous session's homework exactly once and assigns new homework (INV-HW4). Homework belongs to the student, not the teacher: a teacher viewing a student's homework sees every assignment regardless of which teacher authored it (FR-5.3 cross-teacher continuity).

**Behavioral ground truth already in the tree (verified 2026-09-17):** the blocking M1 infrastructure ticket (plan at `ai/finished_plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/`) shipped and verified the ENTIRE backend write/read surface with zero UI:

- Schema: `reports` (`backend/db/schema/classes/reports.ts:20`, one-per-session UNIQUE `:36`, 0-5 rating CHECK `:37-40`, no `teacher_id` — C.4) and `home_work` (`backend/db/schema/classes/home-work.ts:23`, one-per-session UNIQUE `:45`, 0-100 grade CHECKs `:46-47`, both `surahJuzRef` enum columns `:33,37` — B.11).
- Types: `SessionReportSubmitInput` / `HomeWorkAssignInput` / `HomeWorkBlockInput` / `HomeWorkGradeFieldsInput` (`backend/types/classes/report.types.ts:21-50`) and `HomeWorkSelectType`/`HomeWorkInsertType`/`HomeWorkReturnType` (`backend/types/classes/home-work.types.ts:3-14`).
- Service: `submitSessionReport` (`backend/services/classes/session-report.service.ts:357`) — pre-DB guards, governance re-check, one transaction (report-gate `FOR UPDATE` lock `:261`, report INSERT with 23505→`SESSION_REPORT_ALREADY_EXISTS` mapping `:286-300`, previous-grades one-shot guarded write `:198-221`, assignment INSERT with Jadid→`current_*`/Madi→`revision_*` field-by-field BOPLA mapping `:131-144`, report-ready notification emit in-tx `:306`, publish-after-commit `:390`); participant reads `getSessionReport` `:448` / `getSessionHomework` `:487` with oracle-safe `null` collapse.
- Guards: `backend/services/classes/session-report.guards.ts` (notes trim/length `:95-104`, rating 0-5 `:111-115`, grade 0-100 `:127-131`, ayah span + `isSurahJuzRef` `:147-160`, ≥1-block rule `:188-200`).
- GraphQL: `Mutation.submitSessionReport` (`backend/graphql/mutation/classes/session-report.mutation.ts:65`, `role: [Teacher]`), `Query.sessionReport`/`sessionHomework` (`backend/graphql/query/classes/session-report.query.ts:83,105`).
- Documents: `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` (mutation + both reads, pinned by co-located contract test).
- Notifications: `SessionReportNotificationService.notifySessionReportReady` (`backend/services/classes/session-report-notification.service.ts:147`) — student always, linked parent when the `students.parent_id` link exists, idempotency key `session:{id}:report`, receipts published post-commit.
- Tests: 4-tier service suite, repo suites, wire suite (`backend/graphql/test/session-report.wire.test.ts`), and journey `test/workflows/classes/session-report-homework.journey.test.ts` — all green.
- Canonical doc: `docs/sessions/session-report-homework.md` ("Status: Implemented and verified").

**The verified gaps this plan implements:**
1. **No submission UX.** The M1 plan's D11 ruling — "No UI / no nav change in this ticket … the submit-UX ticket owns the submission UX" (`ai/finished_plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/plan.md:66`) — deferred the teacher-facing form to the submission-flow ticket, and no other TICKETS.md entry owns it: this ticket is that owner. Today the teacher sessions surface renders completed rows with ZERO actions (`frontend/views/teacher/sessions/teacherSessionCacheArms.ts:126-143` — only `scheduled`→start and `started`→complete branches exist), and no route, nav item, dialog, or form for report submission exists anywhere under `frontend/` or `app/`.
2. **No teacher-facing cross-teacher homework visibility.** FR-5.3's business rule — "Cross-teacher continuity: homework is displayed regardless of which teacher the student sessions with" (`docs/specs/functional-requirements.md:174`) — has no teacher-reachable read: `sessionHomework(sessionId)` is single-session participant-gated; the paged repo primitives `HomeWorkRepository.listForStudent`/`countForStudent` (`backend/db/repo/classes/home-work.repository.ts:232,293`) are consumed only by the parent portal (`backend/services/parents/parent-monitoring.service.ts:309-329`). Ticket AC 4 and its test scenario "Cross-teacher homework visibility — all assignments visible" are therefore unimplemented and UNTESTED (the only scenario of five with zero coverage; every fixture today uses one teacher per student).
3. **No localized Surah/Juz display labels.** The 35-member `SurahJuzRef` enum (`backend/enum/shared/surah-juz-ref.enum.ts:8-44`) has no display-name map in either locale; the only existing renderer is `formatSurahJuzRef` (`frontend/views/parent/monitoring/parentMonitoringDisplay.ts:52-56`) — a regex that space-separates the raw snake_case value, not display-quality and not localized. A submission form with an enum picker and a history list needs real en/ar labels.
4. **No cross-teacher journey.** `test/workflows/classes/session-report-homework.journey.test.ts` exercises one teacher; no committed test anywhere provisions one student under two teachers.

### Feature Summary
Ship the teacher's submission flow end to end: a "Session report" CTA on completed teacher sessions opening a submission dialog (notes, rating, Jadid/Madi assignment with localized Surah/Juz pickers, and previous-homework grading derived from the student's cross-teacher homework history), backed by a new teacher-scoped `studentHomeworkHistory` query, plus the cross-teacher continuity journey.

### Business Value
Teachers can actually close the loop the M1 infrastructure made possible: the post-session record is written through a real form instead of raw GraphQL, parents/students receive their existing notification from a real user action, and any teacher picking up a student sees the full assignment history — the continuity FR-5.3 makes a product promise.

### Scope
- **In scope:** teacher-facing homework-history read surface (service + GraphQL query + documents + tests); "Session report" CTA + submission dialog UI in `frontend/views/teacher/sessions/`; sessions-namespace copy extensions (en/ar) incl. localized SurahJuzRef labels; cross-teacher journey test; wire tests for the new query; docs update.
- **Out of scope:** schema changes (none — both tables and the enum exist); any backend write-path change (the guarded submission transaction is frozen as shipped); the 114-surah enum expansion (owned by the follow-up ticket `Surah/Juz Enum Homework Tracking`, TICKETS.md:1424, which is blocked by this one); report edit/amendment (append-only posture stands); parent-portal display refactor onto the new label map (its `formatSurahJuzRef` keeps working; re-adoption is a deferred item); student-facing homework page (`/homework` remains the student-only ComingSoon it is today); parent notification deep-link display (DEV1-017 forward ticket).

---

## Requirement 0: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I need a recorded error baseline and persistent outcome knowledge, so new issues are distinguishable from pre-existing ones and research is never repeated.

1. WHEN implementation begins THEN the agent SHALL record baselines — `bun tsgo 2>&1 | grep "error TS" | wc -l > /tmp/baseline-tsgo.txt`, `bun biome:check 2>&1 | grep -c warn > /tmp/baseline-biome.txt`, `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json` — and write the counts into `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/0-baseline-outcome.md` (the outcome file is the durable record; `/tmp` copies are scratch).
2. WHEN any task starts THEN the agent SHALL read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/`.
3. WHEN any task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` and update the checkbox `[ ]` → `[x]` in `tasks.md`.
4. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 before proceeding.
5. WHEN any subtask is marked complete THEN the semantic review checklist SHALL have been executed (the script covers mechanical checks only).

## Requirement 0.5: Translation & Enum Compliance

**User Story:** As a developer, I want compile-time-safe i18n and enum usage, so errors surface at build time.

1. WHEN the dialog and CTA copy is authored THEN every new key SHALL be added to all THREE files — `shared/locale/types/sessions/labels.ts`, `shared/locale/en/sessions/labels.ts`, `shared/locale/ar/sessions/labels.ts` — because both locale leaves are typed `SessionsLabels` (tsgo fails until both exist), and to the mandated-key registry in `shared/locale/sessions-namespace.parity.test.ts` (function-valued keys listed in its function-keys registry).
2. WHEN the Surah/Juz labels are authored THEN they SHALL be function-valued (`surahJuzLabel: (ref: string) => string` style) per the established function-key pattern (`shared/locale/types/notifications/index.ts:95`), implemented in BOTH locale leaves over the full 35-member vocabulary, fail-closed to the raw ref for an unknown key.
3. WHEN frontend code consumes an enum at runtime THEN it SHALL be a value import (`import { SessionStatus } from "@/frontend/graphql/generated/gql/graphql"` — the existing idiom, `teacherSessionCacheArms.ts:15-17`); never a string literal, never `import type` for runtime use.
4. WHEN user-facing text renders THEN it SHALL come from `useAppTranslation(Sessions)` / `useAppTranslation(Errors)` handles — never hardcoded strings, never function-call translation access.

---

## Requirement 1: Report + Homework Submission Semantics (EXISTING — regression-locked)

**User Story:** As a teacher, I submit one report per completed session carrying notes, a rating, and the next homework, so the student's record and the next session's plan persist atomically.

1. WHEN the session teacher submits a report for a `completed` session THEN the system SHALL create exactly one `reports` row (`teacher_notes`, `student_rating_by_teacher` 0-5) and at most one `home_work` row in ONE transaction — the shipped pipeline (`session-report.service.ts:357-394`).
2. WHEN the input carries an assignment THEN the Jadid block SHALL land on `current_from_ayah/current_to_ayah/current_surah_juz` and the Madi block on `revision_*`, field by field, both grade columns structurally absent (`homeWorkInsertOf`, `session-report.service.ts:131-144`).
3. IF a homework grade outside 0-100 or a rating outside 0-5 is supplied THEN the system SHALL reject it pre-DB with the typed `VALIDATION` denial (guards `:111-131`), with the DB CHECK constraints as backstop only.
4. IF the caller is not the session's teacher, or the session is not `completed`, or a report already exists THEN the system SHALL answer `SESSION_NOT_FOUND` (oracle-safe), `SESSION_INVALID_TRANSITION`, and `SESSION_REPORT_ALREADY_EXISTS` respectively (`:262-279`, `:286-300`).
5. WHEN the submission commits THEN the report-ready notification wave SHALL fire (student always, linked parent when linked; `session-report-notification.service.ts:147-198`) — no new notification work is in scope.
- **Priority:** High · **Status:** EXISTS (verified — REQ-1 is the regression lock this plan's UI rides; no code change).

## Requirement 2: First Session — Diagnostic, Assign-Not-Grade (EXISTING semantics + NEW UI contract)

**User Story:** As a teacher finishing a student's first session, nothing is graded, so the diagnostic session's outcome is an initial assignment only (INV-HW3).

1. IF the student has NO homework rows THEN a submission with `previousGrades` SHALL silently absorb the grades — a no-op, never an error (`settleHomeWorkComposite`, `session-report.service.ts:198-221` — `findLatestByStudentId` probe returns `null`).
2. WHEN the UI renders the submit form for a student whose cross-teacher history is EMPTY THEN it SHALL hide the grade-previous section and show the first-session/diagnostic hint instead (NEW — the UI contract; see REQ-6).
- **Priority:** High · **Status:** AC 1 EXISTS at service level; AC 2 is NEW (delivered by REQ-6).

## Requirement 3: Subsequent Session — Grade Previous, Assign New (EXISTING semantics + NEW UI contract)

**User Story:** As a teacher in a later session, I grade the previous homework exactly once and assign the next, so INV-HW4 holds.

1. WHEN a submission carries `previousGrades` THEN the system SHALL grade the student's NEWEST homework row exactly once through the guarded one-shot UPDATE (`gradeHomeWorkOnce`, `home-work.repository.ts:185` — `WHERE id = $1 AND current_grade IS NULL AND revision_grade IS NULL`).
2. IF the newest row is already graded THEN the submission SHALL fail with the localized `CONFLICT` (`homeworkAlreadyGraded`, `session-report.service.ts:209-219`).
3. NOTE (closed contract): `HomeWorkGradeFieldsInput` requires BOTH `currentGrade` and `revisionGrade` (`report.types.ts:21`) — the grading write is a single pair; the UI collects both even when the prior row carries only one track (displayed sections follow the row's actual tracks; the submit payload always sends the pair).
4. WHEN the UI pre-fills the grade section THEN it SHALL read the student's newest row from the new history query (REQ-4), not from a second bespoke "latest" endpoint.
- **Priority:** High · **Status:** AC 1-3 EXISTS at service level; AC 4 is NEW (delivered by REQ-6).

## Requirement 4: Teacher-Scoped Student Homework History — Cross-Teacher Visibility (NEW)

**User Story:** As a teacher, I want to see a student's full homework history across all their teachers, so continuity holds when the student sessions with someone else (ticket AC 4; FR-5.3).

1. WHEN a teacher calls the new history read for a student THEN the system SHALL return the paged envelope `{ items, totalCount, page, pageSize }` over the student's homework rows ordered newest-first, REUSING `HomeWorkRepository.listForStudent`/`countForStudent` (teacher-agnostic by construction — tenancy is on `session.student_id`, `home-work.repository.ts:232,293`).
2. WHEN the gate evaluates THEN the system SHALL require, in ONE `withTransaction(..., { isolationLevel: "repeatable read" })`, that the caller is a teacher with at least one session (ANY status) with that student — via a new `SessionRepository.existsSessionForTeacherStudent(teacherUserId, studentId, tx)` EXISTS probe — else the constant-shape `FORBIDDEN` denial (`errorsTranslations.forbidden`) with exactly ONE bounded `logDomainError` (`{ code: "FORBIDDEN", entity: "students", entityId, locale }`), mirroring the parent portal's `requireLinkedChild` oracle (`parent-monitoring.helpers.ts:176-209`).
3. IF the student id is unknown, non-positive, or the caller has zero sessions with the student THEN all three shapes SHALL be the byte-identical `FORBIDDEN` (constant-denial oracle — no existence disclosure).
4. IF the caller is not a teacher THEN the field-level `authScopes $all { authenticated: true, role: [UserRole.Teacher] }` SHALL deny with 403 before the service runs (the parent-portal role-gate shape, `parent-monitoring.query.ts:102-107`).
5. WHEN paging args are absent/out-of-range THEN the service SHALL clamp: `page` → 1, `pageSize` → 25 default / 50 max, `offset = (page-1)*pageSize` (the clamp contract of `parent-monitoring.helpers.ts:56-93`, restated locally).
6. WHEN the GraphQL surface registers THEN it SHALL be `Query.studentHomeworkHistory(studentId: ID!, page: Int, pageSize: Int): StudentHomeworkPage!` returning `items: [SessionHomeWork!]!` — the canonical object reused in the sanctioned list-wrapper envelope (the `SessionPage` exception, `session.pothos.ts:9-11`; NO duplicate homework object type); and Apollo cache normalization SHALL register the id-less page wrapper with `keyFields: false` in `frontend/providers/apollo/apolloCache.ts` (the `ParentHomeworkPage` precedent, `apolloCache.ts:114-115`).
- **Priority:** High · **Complexity:** Medium

## Requirement 5: Teacher Sessions CTA — Completed & Started Rows (NEW)

**User Story:** As a teacher, I need the entry point to submit/view a session report on my sessions list, so the flow is reachable where the session lives.

1. WHEN a row with `status === Completed` renders in the teacher sessions list THEN the row SHALL offer a "Session report" action — the `teacherActionsForSession` matrix gains a completed-branch pushing `{ id: "report", label, onIntent: onReportIntent }` (`frontend/views/teacher/sessions/teacherSessionCacheArms.ts:121-143` today returns `[]` for terminal rows).
2. WHEN the `SessionRowAction` id union extends THEN it SHALL gain `"report"` and `"homework"` alongside `"start" | "complete" | "confirm" | "rate"` (`frontend/views/student/sessions/sessionRowAction.ts:15`).
3. WHEN the action fires THEN the container SHALL open the report dialog keyed by a `reportDialogSessionId` state slot — the exact `caseDialogSessionId` mount pattern (`TeacherSessionsContainer.tsx:140-148,234-236`); no new route, no nav change, no bottom-nav.
4. WHEN a row is `Started` THEN the row SHALL offer a read-only "Homework" action opening the same dialog in prepare mode (FR-5.3's "system displays the student's assigned homework" during the session itself).
5. WHEN any other role (student/parent/admin) visits their sessions surfaces THEN nothing SHALL change — the CTA is teacher-surface-only by construction (the teacher body renders with the teacher `rowRole` threaded from the container, `TeacherSessionsContainer.tsx:214` → `TeacherSessionsBody.tsx:123`; the student surface builds its own `actionsFor` and never consumes `teacherActionsForSession`).
- **Priority:** High · **Complexity:** Low-Medium

## Requirement 6: Session Report Submission Dialog (NEW)

**User Story:** As a teacher, I want a single dialog to review the student's homework state, grade the previous assignment, and submit notes + rating + new homework, so one user action completes the M1 wire contract.

1. WHEN the dialog opens for a session THEN it SHALL fetch, in parallel, the existing report (`sessionReportQueryDocument`), this session's homework (`sessionHomeworkQueryDocument`), and the student's history (`studentHomeworkHistoryQueryDocument`, page 1) — all three documents already exist or ship in this plan; stateful `useQuery` only, `useLazyQuery` is banned.
2. WHEN a report already exists for the session THEN the dialog SHALL render the read-only review state (report fields + this session's homework rows) with NO form — reusing the `caseReview*` display vocabulary already in the sessions namespace (`shared/locale/en/sessions/labels.ts:108-128`).
3. WHEN no report exists THEN the dialog SHALL render the submit form: teacher notes (required, trimmed, ≤ 2000 with live counter), student rating (0-5, required by `SubmitSessionReportInput`), Jadid block (fromAyah, toAyah, surahJuz picker), Madi block (same shape) — each block individually optional but ≥1 required (the server's `homeworkAssignmentBlocksRequired` rule, mirrored client-side), and the previous-grades section.
4. WHEN the student's history is non-empty THEN the grade-previous section SHALL pre-fill from `items[0]` (the newest row): each track the row actually carries shows its span/surah label plus a 0-100 grade input; the payload always sends the full `previousGrades` pair (REQ-3 AC 3). WHEN history is empty THEN the section SHALL be replaced by the diagnostic first-session hint.
5. IF the newest row is ALREADY graded THEN the grade-previous section SHALL render read-only (grade shown, inputs hidden) — the server would deny a re-grade with `CONFLICT`.
6. WHEN the teacher submits THEN the mutation SHALL be `submitSessionReportMutationDocument` via `useMutation` from `@apollo/client/react` with `React.SubmitEvent` form semantics (`SessionConfirmDialogLayout.tsx:94-99` idiom), disabled while loading, backdrop/Escape gated while loading.
7. WHEN the mutation errors THEN the dialog SHALL classify by `extensions.code` ONLY (single code→behavior map discipline, `frontend/AGENTS.md:65`): `SESSION_REPORT_ALREADY_EXISTS` → info notice + close + row refresh; `SESSION_INVALID_TRANSITION` → inline alert; `FORBIDDEN` → `te.forbidden`; `VALIDATION` → field-level projection via `frontend/lib/mutationFieldErrors.ts`; default → generic error notice. Server messages are never echoed.
8. WHEN the mutation succeeds THEN the container SHALL show the success notice, refetch the teacher sessions list, and the dialog SHALL flip to the read-only review state.
9. WHEN the dialog renders in Arabic THEN it SHALL be fully RTL-correct (MUI `direction` mirroring, start/end alignment, no hardcoded `dir`), and ayah numbers/Surah labels SHALL display through the localized label map (REQ-7).
- **Priority:** High · **Complexity:** Medium

## Requirement 7: Localized SurahJuzRef Labels + Sessions Copy Extensions (NEW)

**User Story:** As an Arabic-or-English teacher, I want proper display names for Surah/Juz references and all form copy localized, so the submission flow is production-quality in both locales.

1. WHEN labels are authored THEN the sessions namespace SHALL gain a function-valued key mapping every one of the 35 enum values (`surah_al_fatihah`…`surah_al_maidah`, `juz_1`…`juz_30`) to display names in each locale — English transliterations ("Surah Al-Fātihah", "Juz 1") and Arabic ("سورة الفاتحة", "الجزء 1") — fail-closed to the raw ref.
2. WHEN the parity test runs THEN the function-key SHALL be exercised across the full 35-value vocabulary in BOTH locales and the new mandated keys SHALL be registered in `shared/locale/sessions-namespace.parity.test.ts`.
3. WHEN dialog/CTA copy is authored THEN every key SHALL exist in en + ar leaves (compile-time `SessionsLabels` parity) — dialog title/labels/buttons/hints, CTA labels, review-state copy, notices, and section headers.
4. WHEN the parent portal renders homework THEN it is OUT OF SCOPE to rewire it onto the new label map (deferred item D-2) — its `formatSurahJuzRef` keeps working unchanged.
- **Priority:** Medium · **Complexity:** Low (volume, not difficulty)

## Requirement 8: Cross-Teacher Continuity Journey (NEW — test-first)

**User Story:** As a maintainer, I want a committed journey proving two teachers interoperate over one student's homework, so ticket AC 4 is not asserted by prose.

1. WHEN the journey runs THEN it SHALL provision ONE student with TWO certified teachers (T1, T2) using committed `beforeAll` fixtures via `createTestUser`/`createTestStudent`/`createTestTeacherRow` (`backend/db/test/entity-setup.ts:72,102,522`) in one committing transaction, tracked by `TrackedFixtures` with FK-safe `afterAll` cleanup — NO `runInRollback` (`docs/testing/workflow-journey-tests.md:55-75`).
2. THEN the ordered steps SHALL hold: (a) T1 completes session σ1 and submits report+homework H1 (both tracks, ungraded); (b) T2 reads the student's history through the new service and SEES H1 authored during σ1; (c) T2 completes session σ2, submits report grading H1 (`previousGrades`) and assigning H2; (d) H1 carries both grades exactly once, H2 born ungraded; (e) T1 also sees BOTH rows (visibility is symmetric); (f) a foreign teacher (zero sessions with the student) gets the constant `FORBIDDEN`; (g) a student caller of the teacher query is denied by the role scope.
3. WHEN notifications are asserted THEN the spy boundary SHALL be the injected `SpiedFanoutTransport` + memory claim cache via `NotificationEngineCallOptions` (the existing journey seam), asserting the report-ready wave fired for the student on each submission.
4. WHEN the journey asserts denials THEN it SHALL use try/catch capture + translated substrings from `getServerTranslations("en").errorsTranslations` — never `expect(...).rejects.toThrow()`.
- **Priority:** High · **Complexity:** Medium

## Requirement 9: Canonical Documentation Update (NEW)

1. WHEN implementation lands THEN `docs/sessions/session-report-homework.md` §5 Consumer Guidance SHALL be updated: Submit UX no longer future — cite the dialog path and CTA; the teacher homework-history query documented alongside the existing reads; the cross-teacher journey file added to §6 Rollout.
2. WHEN docs change THEN the root `AGENTS.md` Important References entry for that doc SHALL stay accurate (verify description only; no new doc created).
- **Priority:** Low · **Complexity:** Low

---

## UX/Navigation Requirements

**No new routes, no nav items, no bottom-nav.** The flow lives entirely on the existing teacher sessions page; the repo has NO mobile bottom-nav anywhere and none is introduced.

| Surface | Purpose | Roles | Evidence / Owner |
|---|---|---|---|
| `/teacher/sessions` (EXISTING route, `app/(dashboard)/teacher/sessions/page.tsx`, `withPageAuth({ roles: [UserRole.Teacher] })`) | Teacher session list — gains the row CTA + dialog mount | TEACHER only | `TeacherSessionsContainer.tsx` |
| Completed row → "Session report" action | Opens submit/review dialog | TEACHER | REQ-5 |
| Started row → "Homework" action | Opens read-only prepare mode | TEACHER | REQ-5 AC 4, REQ-6 AC 1 |
| Notifications inbox (existing) | Report-ready wave already lands there for student/parent | STUDENT, PARENT | unchanged |

**Sidebar:** teacher nav (`frontend/views/dashboard/nav/navItems.ts:140-147`) is unchanged — no item added, no `ComingSoon` retargeted. **Per-audience rendering:** students see their own sessions surface unchanged (`/student/sessions` — the "rate" CTA family stays); parents consume reports/homework via the existing monitoring portal (`frontend/views/parent/monitoring/` — untouched); admins touch nothing here. **Permission mapping:** route-level `withPageAuth({ roles: [UserRole.Teacher] })` (existing) + field-level teacher role scopes on the new query; no permission-string changes.

## Cross-Actor Workflow Journey

### Actor Table
| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Teacher T1 (session σ1) | `teacher`, governance-clean | complete own session; submit report + assign H1; view student's history | grade another teacher's in-flight submission; view data of students they never sessioned |
| Teacher T2 (session σ2) | `teacher`, governance-clean | view the SAME student's full history (incl. H1 by T1); grade H1 via own submission; assign H2 | read another teacher's private notes; bypass the one-shot grade |
| Student S | `student` | receive report-ready notification; read own session report/homework | call the teacher history query; grade anything |
| Parent P (linked) | `parent` | receive report-ready notification; read child reports/homework via portal | call teacher surfaces |
| Foreign teacher F | `teacher`, zero sessions with S | nothing on S's data | distinguish "unknown student" from "not your student" (constant FORBIDDEN) |

### Ordered Steps (the REQ-8 assertion set)
1. T1 → `completeSession(σ1)` → row `completed` → T1 `submitSessionReport(σ1, notes, rating, homework=H1)` → `reports` + `home_work` rows commit atomically; H1 born ungraded (INV-HW3 shape).
2. **S observes** a report-ready notification (and P when linked) — the M1 wave, now triggered by a real UI action upstream.
3. T2 → history read on S → sees H1 (authored during σ1 by T1) — **cross-teacher visibility, observer-perspective**.
4. T2 → `completeSession(σ2)` → `submitSessionReport(σ2, notes, rating, previousGrades, homework=H2)` → H1 graded exactly once (guarded UPDATE matched); H2 born ungraded (INV-HW4).
5. T1 → history read on S → sees H1(graded)+H2(ungraded) — visibility is symmetric, not author-scoped.
6. F → history read on S → constant `FORBIDDEN`; student S → teacher query → role-scope 403.
7. IF T2 re-submits σ2 or re-grades H1 → `SESSION_REPORT_ALREADY_EXISTS` / `CONFLICT` — replay-safe.

### Observer-perspective EARS
- WHEN T2 views the history THEN T2 SHALL observe every assignment any teacher authored for the student, in session-recency order.
- WHEN T2 grades via submission THEN T1 SHALL observe (via the same history read) H1 carrying grades and H2 ungraded.
- IF any non-associated teacher probes THEN the system SHALL answer the identical FORBIDDEN with no existence oracle.

## Non-Functional Requirements

- **Concurrency:** the submission path is unchanged (row-lock gate + unique arbiters + one-shot guarded UPDATE — M1-verified); the new read is one REPEATABLE READ transaction (probe + list + count), zero writes, zero locks.
- **Security:** identity exclusively from `ctx.user.id`; teacher-relationship EXISTS gate fused in SQL; constant-denial oracle; BOPLA mapping stays server-side field-by-field; no LIKE/wildcard surfaces touched (no search input).
- **i18n:** every new string en+ar, parity-test-locked; RTL via existing theme direction.
- **Performance:** one history query per dialog open (pageSize 25 default / 50 max); no N+1 on the list (the CTA is status-pure; report-existence discovered on open, not per row).
- **Observability:** read-path silent (zero logs, matching the M1 read posture); write denials keep exactly one bounded `logDomainError` each (M1 shipped); the new FORBIDDEN gate logs one bounded line mirroring `requireLinkedChild`.

## Success Criteria

- [ ] REQ-4..REQ-8 acceptance criteria all pass; REQ-1..REQ-3 regression suites stay green untouched.
- [ ] Journey `test/workflows/classes/session-report-cross-teacher.journey.test.ts` green via `bun run test/scripts/run-test.ts <path>`.
- [ ] Wire suite for `studentHomeworkHistory` green (401/403/constant-FORBIDDEN/happy/paging).
- [ ] Sessions parity test green; `bun tsgo` clean; per-file sub-loop exit 0 on every touched file.
- [ ] Traceability: every REQ-N in this file has ≥1 task in `tasks.md`; the grep audit reports zero MISSING.

## Glossary

| Term | Definition |
|---|---|
| Jadid | The new-memorization homework track — stored on `home_work.current_*` columns |
| Madi | The revision homework track — stored on `home_work.revision_*` columns |
| Diagnostic session | The student's first session: no prior homework exists to grade (INV-HW3) |
| Cross-teacher continuity | Homework rows belong to the student; every associated teacher sees all of them (FR-5.3) |
| `SurahJuzRef` | 35-member enum (5 surahs + 30 juz) classifying an assignment's surah or juz (B.11) |
| One-shot guarded UPDATE | `gradeHomeWorkOnce` — UPDATE … WHERE grades IS NULL, matching zero rows on replay |
| Constant-denial oracle | Unknown id and unauthorized id produce byte-identical errors (no existence disclosure) |

---

## Requirements Review Checklist

- [x] All user stories have clear roles, features, and benefits
- [x] Each requirement has specific acceptance criteria using EARS format
- [x] Non-functional requirements addressed; success criteria measurable
- [x] Navigation/sidebar/tabs documented (explicit no-new-route ruling) and permissions mapped
- [x] Cross-actor workflow captured (actor table + ordered steps + observer-perspective EARS) for the 2+ -actor flow
- [x] Requirements are testable, active-voiced, and implementation-agnostic except where they lock EXISTING shipped behavior as regression contracts
