# Design — Session Report Submission with Homework (Jadid & Madi)

**Plan Directory (verbatim, used by every header/ledger/self-reference):** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/`
**Specs of record:** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/specs.md` (REQ-0…REQ-9)
**Ledger:** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/deferred-items.md`
**Outcome dir:** `ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/`
**Tickets:** `docs/planning/TICKETS.md:1376-1418` (Milestone 2 · Dev 2 · 5 SP) · **Milestone:** 2 (M2 — Matching, Notifications & Escrow)

---

## 1. System Overview & Architecture Diagram

This ticket is the **submit-UX + cross-teacher-visibility ticket** riding on the shipped M1 infrastructure: the guarded write/read surface is frozen as verified (`docs/sessions/session-report-homework.md` "Implemented and verified"), and this plan adds (a) the teacher-facing UI that finally drives it, (b) the one missing teacher-scoped read (a student's homework history across ALL teachers), (c) the localized Surah/Juz labels, and (d) the cross-teacher journey proof. Zero schema changes; zero write-path changes; the mutation, its transaction, and its notification wave are consumed, never modified.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ Teacher browser — /teacher/sessions (EXISTING route, role-gated)              │
│  SessionRow ──actionsFor── teacherActionsForSession (EXTEND)                  │
│    started row  → { id:"homework", "Homework" }      (read-only prepare mode) │
│    completed row→ { id:"report",  "Session report" } (submit / review)       │
│  TeacherSessionReportDialog (NEW) + parts + useTeacherSessionReportSubmit(NEW)│
│    ├ useQuery sessionReportQueryDocument        (EXISTING read; review state) │
│    ├ useQuery sessionHomeworkQueryDocument      (EXISTING read; review state) │
│    ├ useQuery studentHomeworkHistoryQueryDocument (NEW — REQ-4 cross-teacher) │
│    │    page 1 → items[0] = newest row → grade-previous pre-fill / first-session
│    └ useMutation submitSessionReportMutationDocument (EXISTING — M1 wire)     │
│         code→behavior: ALREADY_EXISTS→info+refresh · INVALID_TRANSITION→row   │
│                        FORBIDDEN→errors.forbidden · VALIDATION→field pairs   │
└──────────────┬───────────────────────────────────────▲────────────────────────┘
               │ TypedDocumentNode documents (Apollo) │ localized errors (DomainError)
┌──────────────▼───────────────────────────────────────┴────────────────────────┐
│ Pothos schema (side-effect barrels: query/classes/index.ts → query/index.ts)   │
│  Mutation.submitSessionReport (EXISTING, $all{authenticated, role:[Teacher]})  │
│  Query.sessionReport / sessionHomework (EXISTING, authenticated, null-collapse)│
│  Query.studentHomeworkHistory (NEW)  $all{authenticated, role:[Teacher]}      │
│    args: studentId: ID! (requirePositiveIntId), page/pageSize: Int            │
│    → StudentHomeworkPage { items:[SessionHomeWork!]! totalCount page pageSize }│
├───────────────────────────────────────────────────────────────────────────────┤
│ Services                                                                       │
│  SessionReportService (UNCHANGED — submit + participant reads)                │
│  StudentHomeworkService (NEW student-homework.service.ts)                     │
│    listStudentHomeworkHistory(teacherUserId, studentId, page, locale, outerTx?)│
│    ONE withTransaction(outerTx, {isolationLevel:"repeatable read"}):          │
│      requireTeacherOfStudent → EXISTS(session teacher_id=caller ∧ student_id) │
│      constant ForbiddenError(errorsTranslations.forbidden) + 1 bounded log    │
│      HomeWorkRepository.listForStudent/countForStudent (REUSE, teacher-agnostic)│
├───────────────────────────────────────────────────────────────────────────────┤
│ Repositories (tx always propagated)                                            │
│  SessionRepository.existsSessionForTeacherStudent (NEW — teacher.id ≡ users.id)│
│  HomeWorkRepository.listForStudent / countForStudent (REUSE)                  │
├───────────────────────────────────────────────────────────────────────────────┤
│ PostgreSQL (UNCHANGED): session · reports (1/session UNIQUE) · home_work      │
│  (1/session UNIQUE, 0-100 CHECKs, surah_juz_ref enum ×2)                       │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Consumer guidance honored (M1 forward notes, `session-report-homework.md:84-93`):** the submit form follows the MUI v9 sx-only discipline, desktop-first (1440px) with a mobile (375px) stacked variant, Arabic RTL via theme direction; the documents contract is consumed as shipped.

## 2. Design Goals

- **G1:** The teacher closes a completed session with ONE user action that persists report + (optional) previous-grades + (optional) new homework through the frozen M1 transaction (REQ-1, REQ-6).
- **G2:** Cross-teacher continuity is real: any teacher with a session history for a student reads that student's full homework history (REQ-4; ticket AC 4; FR-5.3).
- **G3:** The first-vs-subsequent UX is derived, not asked: history emptiness ⇒ diagnostic mode; newest-row grade state ⇒ editable vs read-only grading (INV-HW3/HW4, REQ-2/3/6).
- **G4:** Both locales are first-class: every new string en+ar, parity-test-locked, RTL-correct; Surah/Juz display names are real labels, not regex artifacts (REQ-7).

## 3. Key Design Decisions

| # | Decision | Options Considered | Rationale (evidence-grounded) |
|---|---|---|---|
| D1 | **Submission UX lives on the sessions list, dialog not page.** CTA `"report"` on completed rows + dialog mounted via the `caseDialogSessionId` state-slot pattern (`TeacherSessionsContainer.tsx:140-148`). | (a) new route `/teacher/sessions/[id]/report`; (b) dialog on the existing list. | (a) creates a route + nav surface the teacher never asked for and duplicates row context plumbing; (b) matches every existing teacher action (cancel/dispute/case dialogs) and needs zero routing/auth changes. The ticket text ("the teacher submits a report") names the flow, not a destination. |
| D2 | **New query `studentHomeworkHistory(studentId: ID!, page, pageSize)` keyed on student, gated by "caller has ≥1 session with student"** — NOT a session-scoped read. | (a) `sessionStudentHomework(sessionId)` reusing the participant probe; (b) student-keyed with a teacher-relationship EXISTS gate. | (b) matches the ticket's actor ("a teacher viewing a student's homework"), serves the Started-row prepare mode (REQ-5.4) without a completed-session id, and keeps ONE read for both modes. The gate reuses the natural domain relationship; probe cost is one indexed EXISTS (`session_teacher_id_student_id_idx`, `session.ts:86`). |
| D3 | **Return the canonical `SessionHomeWork` object in a paged envelope — no duplicate homework projection.** | (a) teacher-specific track/entry composites (parent-portal style, `parent-monitoring.types.ts:112-145`); (b) `[SessionHomeWork!]!` inside `StudentHomeworkPage`. | "Single canonical GraphQL object type per entity" — `SessionHomeWorkPothosObject` (`home-work.pothos.ts:137`) already exposes every field the UI needs, and the list-wrapper envelope is the sanctioned pagination exception (`session.pothos.ts:9-11` names it). Option (a) would fork the entity type for zero field gain. |
| D4 | **Constant-`FORBIDDEN` oracle, not null-collapse, for the history gate.** | (a) nullable envelope collapsing foreign/unknown to `null` (the `sessionReport` idiom); (b) constant `ForbiddenError` (the parent-portal `requireLinkedChild` idiom, `parent-monitoring.helpers.ts:176-209`). | This is a LIST read about ANOTHER actor's data reached by a relationship predicate — the exact parent-portal shape. `null` collapses would mask auth outcomes as "no homework" for a teacher who owns zero sessions, an honest-data lie; constant FORBIDDEN with ONE bounded log is the established cross-actor oracle. |
| D5 | **`SurahJuzRef` labels as ONE function-valued locale key** (`surahJuzLabel: (ref: string) => string`) implemented in each locale leaf over the 35-value vocabulary. | (a) 35 flat keys; (b) one function key with an in-leaf record; (c) a frontend-only label module outside locale. | (a) 35×2 interface members bloat a shared namespace; (c) bypasses the compile-time i18n system (forbidden). (b) is the established function-key pattern (`shared/locale/types/notifications/index.ts:95`), keeps the map per-locale where translation parity lives, and fails closed to the raw ref. The 35-value vocabulary is pinned by the plan (5 surahs + 30 juz, `surah-juz-ref.enum.ts:8-44`). |
| D6 | **Grade-previous section is derived from `items[0]` of the history page-1 fetch — no bespoke "latest" endpoint.** | (a) add `studentLatestHomework` query; (b) reuse history page 1. | `listForStudent` already orders newest-first (`session.started_at DESC NULLS LAST, hw.id DESC`, `home-work.repository.ts:232`), the same recency the grading probe uses (`findLatestByStudentId:142`). One query serves the pre-fill, the first-session rule, and the history list (REQ-6.1/6.4). |
| D7 | **Dialog fetches the existing report on open; review state replaces the form; no `hasReport` added to the session list.** | (a) extend `myTeacherSessions`/`Session` with a report-existence field; (b) per-open `sessionReport` read. | (a) is a Session-object + service change rippling into every sessions consumer for a cosmetic CTA label; (b) costs one cached read exactly when the teacher opens the dialog, and ALREADY_EXISTS remains the race-safe backstop (REQ-6.7). |
| D8 | **New service module `student-homework.service.ts`** rather than extending `session-report.service.ts`. | (a) add to the report module; (b) new sibling module. | The report module's own contract says it stays "a small set of bare functions: the submit flow plus the two session-row readers" (`session-report.service.ts:63-65`); a teacher-scoped student-keyed paged read is a different surface with a different gate. The classes layer already has per-surface modules (13+ service files, e.g. `session-dispute-notification.service.ts`). |
| D9 | **No governance re-check on the history read.** | (a) assert governance-clean; (b) read posture without it. | The M1 read surface explicitly skips governance ("historical rows survive later governance flips", `session-report.service.ts:404-410`); the teacher-relation EXISTS is the authority for this read. The WRITE path keeps its governance re-check — unchanged. |
| D10 | **Wire tests in a NEW suite file** `backend/graphql/test/student-homework-history.wire.test.ts`. | (a) extend `session-report.wire.test.ts` (1,153 lines); (b) new sibling suite. | (b) mirrors the repo's one-suite-per-surface convention and keeps the existing 53-block suite untouched; both boot the same shared server via `setupTestServerLifecycle()`. |

## 4. UX/Navigation Specification

### New Routes & URLs
**None.** Explicit ruling: the flow is a row-scoped affordance on the existing teacher sessions surface — no new route, no nav item, no `ComingSoon` retarget, no bottom-nav (none exists in the codebase; none introduced).

| Surface | Purpose | Permission / Gate | Roles with Access |
|---|---|---|---|
| `/teacher/sessions` (EXISTING, `app/(dashboard)/teacher/sessions/page.tsx`) | Row list; gains CTA + dialog mount | `withPageAuth({ roles: [UserRole.Teacher] })` (existing) | TEACHER |
| Started row → "Homework" action → dialog prepare mode | Read the student's current assignment + history | teacher-relation gate (REQ-4) | TEACHER |
| Completed row → "Session report" action → dialog submit/review | Submit or review report + homework | `role:[Teacher]` mutation scopes (M1) + participant gates | TEACHER |
| `Query.studentHomeworkHistory` (NEW) | Paged cross-teacher history | `$all { authenticated: true, role: [UserRole.Teacher] }` + teacher-relation EXISTS | TEACHER |

### Sidebar Navigation Integration
Unchanged. Teacher nav (`frontend/views/dashboard/nav/navItems.ts:140-147`): dashboard, notifications, sessions, schedule (ComingSoon), wallet, profile — no edits. `/homework` nav remains student-only (`navItems.ts:136`).

### Role-Based Access Matrix
| Role | Routes Accessible | New Permissions Granted |
|---|---|---|
| TEACHER | `/teacher/sessions` (existing) + dialog + `studentHomeworkHistory` | none (role-scoped fields only) |
| STUDENT | `/student/sessions` unchanged; `studentHomeworkHistory` → 403 (role scope) | none |
| PARENT | `/parent/*` monitoring unchanged (reads reports/homework via portal SDL) | none |
| ADMIN | untouched | none |

### Per-Audience Rendering
| Audience | Delta |
|---|---|
| Teacher | NEW: two row actions + dialog (prepare / submit / review modes) |
| Student | none (the "rate" CTA family and session rows unchanged) |
| Parent | none (portal consumes the same M1 rows; receives the same report-ready wave on submit) |
| Admin | none |

### Permission Mapping
| Component | Required Permission | Source |
|---|---|---|
| TeacherSessionsContainer + dialog | route `roles: [UserRole.Teacher]` | `withPageAuth` (existing) |
| `submitSessionReport` | `$all { authenticated, role: [Teacher] }` | M1 mutation (existing) |
| `studentHomeworkHistory` | `$all { authenticated, role: [Teacher] }` + service gate | this plan |

### Mobile / RTL
The dialog follows the M1 forward note: desktop-first form (1440px), mobile stacked variant (375px; `fullScreen` on `xs` per dialog conventions), Arabic RTL via theme `direction` (`ThemeProvider.tsx:31,114`) with start/end alignment; ayah numbers and Surah/Juz labels render through the localized map (D5).

## 5. Translation System Requirements (i18n extension recipe)

All new copy lives in the EXISTING `sessions` namespace — the file-trio + registry recipe (both locale leaves are typed `SessionsLabels`, so tsgo fails until all three agree):

| File | Change |
|---|---|
| `shared/locale/types/sessions/labels.ts` | add the new `readonly` keys (plain + the function-valued `surahJuzLabel: (ref: string) => string`) |
| `shared/locale/en/sessions/labels.ts` | implement the `sessionsEn` additions — incl. the 35-value label map inside `surahJuzLabel` |
| `shared/locale/ar/sessions/labels.ts` | implement the `sessionsAr` additions — Arabic twins (سورة الفاتحة … الجزء 30) |
| `shared/locale/sessions-namespace.parity.test.ts` | register every new key in the mandated-key registry; list `surahJuzLabel` in the function-keys registry and exercise it across the full 35-value vocabulary in both locales |

New key inventory (~36 keys incl. the label fn): `sessionReportAction`, `viewHomeworkAction`, `reportDialogSubmitTitle`, `reportDialogReviewTitle`, `reportDialogPrepareTitle`, `reportNotesLabel`, `reportNotesPlaceholder`, `reportNotesRequiredMessage`, `reportNotesTooLongMessage`, `reportRatingLabel`, `reportRatingRequiredMessage`, `reportSubmitLabel`, `reportCancelLabel`, `reportSubmitSuccessNotice`, `reportAlreadySubmittedNotice`, `reportBlocksRequiredMessage`, `reportAyahRangeMessage`, `reportGradeRangeMessage`, `reportSurahJuzRequiredMessage`, `jadidSectionTitle`, `madiSectionTitle`, `fromAyahLabel`, `toAyahLabel`, `surahJuzPickerLabel`, `gradePreviousSectionTitle`, `reportFirstSessionHint`, `reportAlreadyGradedLabel`, `reportHistorySectionTitle`, `reportHistoryEmptyMessage`, `reportGradeJadidLabel`, `reportGradeMadiLabel`, `reportReviewedNotesLabel`, `reportReviewedRatingLabel`, `reportTrackEmptyLabel`, `reportSessionDateLabel`, `surahJuzLabel(ref)`. **Pinned names:** `sessionReportAction` and `viewHomeworkAction` are consumed verbatim by Task 4's CTA matrix and MUST keep these names; any other key may consolidate during implementation ONLY as an atomic rename across all three trio files + the parity registry in the same task.

## 6. Concurrency & Race Condition Assessment

**Write path: UNCHANGED (M1-verified).** The submission transaction already carries the complete concurrency story and this plan does not touch it:

| Scenario | Actors | Risk | Mitigation (shipped, cited) |
|---|---|---|---|
| Duplicate submit / double-click | Teacher ×2 tabs | second report row | `reports_session_id_unique` arbiter → `SESSION_REPORT_ALREADY_EXISTS` (`session-report.service.ts:286-300`); UI disables while loading + info-notice arm |
| Concurrent grading of the newest row | Teacher A + Teacher B submit simultaneously for the same student | double grade / lost update | `gradeHomeWorkOnce` guarded one-shot UPDATE (`WHERE grades IS NULL`, `home-work.repository.ts:185`); loser gets `CONFLICT` (`homeworkAlreadyGraded`) |
| Gate vs. state flip | admin transitions session while teacher submits | report on non-completed row | `lockForReportGate` `SELECT … FOR UPDATE` + probe in ONE statement (`session.repository.ts:465`) |
| Notification double-fire | retry / replays | duplicate student/parent pings | idempotency key `session:{id}:report` + claim cache (`session-report-notification.service.ts:114-124`) |

**New read path (this plan): zero new write races by construction.**

| Scenario | Actors | Risk | Mitigation |
|---|---|---|---|
| Teacher-relation flips between gate and list | session created/cancelled mid-read | stale authorization or torn page | ONE `withTransaction(outerTx, { isolationLevel: "repeatable read" })` wrapping probe + list + count — the parent-portal TOCTOU seal (`parent-monitoring.service.ts:94-116`); the EXISTS gate and the rows share one snapshot |
| Pagination drift | rows inserted between list and count | `totalCount` ≠ items | list + count inside the SAME REPEATABLE READ transaction (above) |
| Unbounded page size | abusive client | DB pressure | service-side clamp: page ≥1, pageSize ∈ [1, 50] default 25 (`clampPageInput` contract, `parent-monitoring.helpers.ts:56-93`) |
| `FOR UPDATE` usage | — | — | NONE on the read path (reads never lock; the M1 principle `session-report.service.ts:398-400`) |

## 7. Cross-Actor Journey Design (assertion set for REQ-8)

**Shared-Entity State Machine (per-session report+homework settle — unchanged, now UI-driven):**

| State (session σ) | Trigger (actor + action) | Next State | Guard / Permission |
|---|---|---|---|
| `started` | teacher → `completeSession` | `completed` | teacher-of-record + certified (M1 lifecycle) |
| `completed`, no report | teacher → `submitSessionReport` | `completed` + `reports`/`home_work` rows | `FOR UPDATE` gate, completed-only, teacher-only |
| `completed` + report exists | teacher → resubmit | unchanged + `SESSION_REPORT_ALREADY_EXISTS` | unique arbiter |
| (any) | teacher → history read on σ's student | read-only page | ≥1 session with student, constant FORBIDDEN otherwise |

**Side-Effect Matrix (per transition):**

| Transition | Rows Created/Updated | Notifications (channel → recipient) | Idempotency |
|---|---|---|---|
| submit (first session) | 1× `reports`; 1× `home_work` ungraded | `SessionCompletion` → student (+ linked parent) | `session:{id}:report` claim key |
| submit (subsequent) | 1× `reports`; 1× `home_work` ungraded; 1× guarded UPDATE grading the student's newest prior row | same wave | same key + `WHERE grades IS NULL` |
| history read | none (pure read) | none | n/a |

**Cross-Actor Visibility (what each actor observes after each step):**

| State | Teacher T1 (sessioned σ1) | Teacher T2 (sessioned σ2) | Student | Parent (linked) | Foreign teacher |
|---|---|---|---|---|---|
| σ1 submitted, H1 ungraded | own report + H1 in history | — (before σ2 exists: constant FORBIDDEN — no sessions with S yet) | report-ready notification + own reads | report-ready notification + portal rows | constant FORBIDDEN |
| σ2 submitted, H1 graded, H2 ungraded | history shows H1 (graded) + H2 — rows he did not author | own report + full history | notification + reads | notification + portal rows | constant FORBIDDEN |

**Journey test file:** `test/workflows/classes/session-report-cross-teacher.journey.test.ts` — written TEST-FIRST (Task 4), real `SessionLifecycleService.createSession/startSession/completeSession` provisioning via the `outerTx` seam, `SpiedFanoutTransport` + memory claim cache injection, `TrackedFixtures` cleanup, no `runInRollback` (`docs/testing/workflow-journey-tests.md`).

## 8. Architecture / Components (exact signatures)

### A. Types — `backend/types/classes/home-work.types.ts` (EXTEND)

```ts
/** Paged-list request for the teacher-scoped history read (optional bounds; service clamps). */
export interface StudentHomeworkPageInput {
  readonly page?: number;
  readonly pageSize?: number;
}

/** Sanctioned list-wrapper envelope over the canonical homework object (teacher surface). */
export interface StudentHomeworkPageReturnType {
  readonly items: readonly HomeWorkReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}
```
Exported through the existing `backend/types` barrel (the `classes/index.ts` re-export chain already forwards this file). No other type changes: `HomeWorkReturnType`/`SessionReportSubmitInput` etc. are consumed as-is.

### B. Repository — `backend/db/repo/classes/session.repository.ts` (EXTEND)

```ts
/**
 * Teacher↔student relationship probe: does ANY session row (any status)
 * link this teacher (shared PK with users) to this student? EXISTS-select
 * only — no row data, no lock; rides the caller's transaction.
 */
existsSessionForTeacherStudent(
  teacherUserId: number,
  studentId: number,
  tx?: DBQueryExecutor
): Promise<boolean>
```
Query-builder only (`select({ exists: sql`1` }) … .where(and(eq(session.teacherId, teacherUserId), eq(session.studentId, studentId))).limit(1)`); `session.teacherId` references `teacher.id` which is the shared users PK (`session.ts:54-56`; `createTestTeacherRow(tx, userId)` inserts `{ id: userId }` — `entity-setup.ts:522`). Compiled with the repo's existing prepared-statement discipline for the classes domain.

### C. Service — `backend/services/classes/student-homework.service.ts` (NEW) + `student-homework.helpers.ts` (NEW, pure)

```ts
// student-homework.helpers.ts (pure, no DB)
export const MAX_HOMEWORK_HISTORY_PAGE_SIZE = 50;
export const DEFAULT_HOMEWORK_HISTORY_PAGE_SIZE = 25;
export function clampHomeworkHistoryPage(
  input: StudentHomeworkPageInput | undefined
): { page: number; pageSize: number; offset: number };

// student-homework.service.ts
/**
 * Teacher-scoped cross-teacher homework history (REQ-4). Pipeline:
 *  0. pre-DB id-shape guard (studentId positive safe integer — the shared
 *     session-lifecycle id guard, localized once via getServerTranslations(locale));
 *  1. ONE withTransaction(outerTx, { isolationLevel: "repeatable read" }):
 *     a. requireTeacherOfStudent — SessionRepository.existsSessionForTeacherStudent;
 *        ANY miss (unknown id, non-teacher, zero sessions) = the constant
 *        ForbiddenError(errorsTranslations.forbidden) + exactly ONE bounded
 *        logger.logDomainError({ code: "FORBIDDEN", entity: "students", entityId, locale });
 *     b. HomeWorkRepository.listForStudent(studentId, pageSize, offset, tx)
 *        + HomeWorkRepository.countForStudent(studentId, tx);
 *  2. return { items, totalCount, page, pageSize } — zero writes, zero locks.
 * The read path is silent on success (the M1 read posture) and performs NO
 * governance re-check (D9).
 */
export async function listStudentHomeworkHistory(
  teacherUserId: number,
  studentId: number,
  page: StudentHomeworkPageInput | undefined,
  locale: string,
  outerTx?: DBTransaction
): Promise<StudentHomeworkPageReturnType>;
```
Bare-export module style matching `session-report.service.ts:61-65`. `requireTeacherOfStudent` stays module-private (the parent portal keeps its gate module-private too, `parent-monitoring.helpers.ts` notwithstanding — the helper here is one probe + one throw; a separate file is unnecessary).

### D. GraphQL — Pothos object + query registration

`backend/graphql/pothos/classes/home-work.pothos.ts` (EXTEND — new page object beside the existing canonical object):

```ts
export const StudentHomeworkPagePothosObject = gqlSchemaBuilder
  .objectRef<StudentHomeworkPageReturnType>("StudentHomeworkPage")
  .implement({
    fields: t => ({
      items: t.field({ type: [SessionHomeWorkPothosObject], resolve: p => p.items }),
      totalCount: t.exposeInt("totalCount"),
      page: t.exposeInt("page"),
      pageSize: t.exposeInt("pageSize"),
    }),
  });
```
(shape mirrors `ParentHomeworkPagePothosObject`, `parent-monitoring.pothos.ts:262-274`).

`backend/graphql/query/classes/session-report.query.ts` (EXTEND — one new field, same file, side-effect registration unchanged):

```ts
gqlSchemaBuilder.queryField("studentHomeworkHistory", t =>
  t.field({
    type: StudentHomeworkPagePothosObject,
    args: {
      studentId: t.arg.id({ required: true }),  // ID discipline matches this file's session ids
      page: t.arg.int(),                        // no GraphQL default — the service clamps
      pageSize: t.arg.int(),
    },
    authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }, // value import
    resolve: (_root, args, ctx) => {
      const studentId = requirePositiveIntId(Number(args.studentId), "studentId");
      return StudentHomeworkService.listStudentHomeworkHistory(
        ctx.user.id, studentId,
        { page: args.page ?? undefined, pageSize: args.pageSize ?? undefined },
        ctx.locale
      );
    },
  })
);
```
`UserRole` is a VALUE import (`parent-monitoring.query.ts:79-105` idiom); `requirePositiveIntId` from `@/backend/graphql/shared` (`resolver-guards.ts:19`); resolver stays thin-delegation — zero repository calls, no try/catch (denials are typed errors; the finalizer preserves `extensions.code`).

### E. Frontend documents — `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts` (EXTEND)

```ts
export const studentHomeworkHistoryQueryDocument: TypedDocumentNode<
  StudentHomeworkHistoryQuery,
  StudentHomeworkHistoryQueryVariables
> = gql`
  query StudentHomeworkHistory($studentId: ID!, $page: Int, $pageSize: Int) {
    studentHomeworkHistory(studentId: $studentId, page: $page, pageSize: $pageSize) {
      items {
        id
        sessionId
        currentFromAyah
        currentToAyah
        currentGrade
        currentSurahJuz
        revisionFromAyah
        revisionToAyah
        revisionGrade
        revisionSurahJuz
        createdAt
        updatedAt
      }
      totalCount
      page
      pageSize
    }
  }
`;
```
`id` FIRST on the object selection (Apollo normalization, `sharedDocuments/AGENTS.md` "id Field Requirement"); every type from codegen. After authoring: `bun run generate:gqlSchema && bun codegen`. The co-located `session-report.documents.test.ts` gains a block pinning this selection (12 homework fields + envelope, nothing extra).

### F. Row actions — `frontend/views/teacher/sessions/teacherSessionCacheArms.ts` (EXTEND) + `sessionRowAction.ts` (EXTEND)

- `SessionRowAction["id"]` union (`frontend/views/student/sessions/sessionRowAction.ts:15`) gains `"homework" | "report"`.
- `TeacherActionsWiring` (`teacherSessionCacheArms.ts:108-113`) gains `onHomework: (sessionId: string) => void` and `onReport: (sessionId: string) => void`.
- `teacherActionsForSession` (`:121-143`) gains two branches BEFORE the fall-through:
  - `status === SessionStatus.Started` → push `{ id: "homework", label: t.viewHomeworkAction, onIntent: onHomework }`
  - `status === SessionStatus.Completed` → push `{ id: "report", label: t.sessionReportAction, onIntent: onReport }`
- No in-flight slot bookkeeping needed (no mutation on intent; the dialog owns loading).

### G. Container — `frontend/views/teacher/sessions/TeacherSessionsContainer.tsx` (EXTEND)

- New state slot `reportDialogSessionId: string | null` (the `caseDialogSessionId` pattern at `:140-148`), plus `setReportDialogSessionId`.
- Body wiring passes `onHomework`/`onReport` intent handlers down through `TeacherSessionsBody` → `actionsFor` (the existing `onStart`/`onComplete` path).
- Conditional mount alongside `TeacherDisputeCaseDialog` (`:234-236`): `<TeacherSessionReportDialog key={reportDialogSessionId ?? "none"} session={row} onClose={...} onSuccess={...} />` where `row` is resolved from the cached `myTeacherSessions` data by id.

### H. Dialog components — `frontend/views/teacher/sessions/` (NEW)

| File | Responsibility |
|---|---|
| `TeacherSessionReportDialog.tsx` | The single dialog, mode-resolved: `prepare` (session `started` — read-only homework/history), `submit` (completed + no report — form), `review` (report exists — read-only report + this session's homework). Fetches the three documents in parallel (stateful `useQuery`, re-keyed by `sessionId`; NO `useLazyQuery`). MUI `Dialog` with `slotProps={{ paper: { component: "form", onSubmit } }}` (`SessionConfirmDialogLayout.tsx:94-99` idiom), `fullScreen` on `xs`, backdrop/Escape gated while loading. |
| `TeacherSessionReportDialog.parts.tsx` | Presentational sections: assignment block (Jadid / Madi — surahJuz `Select` over `Object.values(SurahJuzRef)` with `t.surahJuzLabel(ref)`, from/to ayah number fields), grade-previous block (pre-filled from `history.items[0]`, read-only when already graded), first-session hint, history list (compact rows: createdAt + tracks + grades), review state (reuses the `caseReview*` display vocabulary). |
| `useTeacherSessionReportSubmit.ts` | `useMutation(submitSessionReportMutationDocument)` from `@apollo/client/react`; `onCompleted` → success notice + `client.refetchQueries({ include: [myTeacherSessionsQueryDocument] })` + dialog flips to review; `onError` → code→behavior arm. |
| `teacherSessionReportDialog.helpers.ts` | Pure helpers: `buildSubmitPayload(form)` → `SubmitSessionReportInput` (field-by-field, BOPLA — never a spread), `validateReportForm(form, t)` mirroring the server guards (notes trim/2000, rating 0-5, ayah span, ≥1 block, grades 0-100), `resolveNewestRow(historyPage)`, `isNewestRowUngraded(row)` (both grade columns null ⇒ Jadid AND Madi ungraded per the one-shot predicate). |

**Client validation mirrors the server vocabulary exactly** (`session-report.guards.ts`): same bounds, same ≥1-block rule — localized via the NEW sessions keys (not the errors namespace, which is server-authored copy; the client surfaces its own messages but never echoes server strings).

**Error arm mapping (`extensions.code` ONLY, single map discipline `frontend/AGENTS.md:65`):**

| Code | Behavior |
|---|---|
| `SESSION_REPORT_ALREADY_EXISTS` | info notice (`t.reportAlreadySubmittedNotice`), close, refetch |
| `SESSION_INVALID_TRANSITION` | inline alert in-dialog + row alert |
| `FORBIDDEN` | `te.forbidden` notice |
| `VALIDATION` | field-level projection via `frontend/lib/mutationFieldErrors.ts` + `components/ui/fieldError.ts` |
| default | `t.genericError` error notice |

### I. Apollo cache registration — `frontend/providers/apollo/apolloCache.ts` (EXTEND)

`StudentHomeworkPage` is an id-less wrapper (the pagination envelope carries no `id`), so it MUST be registered in the cache `typePolicies` with `keyFields: false` — the exact precedent of `ParentReportPage`/`ParentHomeworkPage` (`apolloCache.ts:114-115`, per `frontend/graphql/AGENTS.md` "Embedded type normalization policy"):

```ts
StudentHomeworkPage: { keyFields: false },
```
Without it, Apollo emits "Cache data may be lost" normalization warnings on every history read. The `SessionHomeWork` items themselves keep their `id`-first normalization (no policy needed — the existing `SessionReport`/`SessionHomeWork` rows already normalize via `id`).

## 9. Data Models

**No schema changes.** Both tables, both unique arbiters, the CHECK constraints, and the 35-member `surah_juz_ref` enum are frozen M1 deliverables — this plan treats them as read-only contracts (`backend/db/schema/classes/reports.ts:20-43`, `home-work.ts:23-50`, `backend/enum/shared/surah-juz-ref.enum.ts:8-44`). No `db push`, no migration, no seed.

| Entity (frozen) | Key columns | Constraints this plan relies on |
|---|---|---|
| `reports` | `session_id` (UNIQUE, FK cascade), `teacher_notes`, `student_rating_by_teacher` | 0-5 rating CHECK; one per session (duplicate = arbiter); teacher via `session.teacher_id` (C.4) |
| `home_work` | `session_id` (UNIQUE, FK cascade), `current_*` (Jadid), `revision_*` (Madi) | 0-100 grade CHECKs ×2; born ungraded; one-shot guarded grading; enum-classified surah/juz ×2 |
| `session` | `teacher_id` (→ `teacher.id` ≡ users PK), `student_id`, `status` | `session_teacher_id_student_id_idx` (`session.ts:86`) makes the new EXISTS probe indexed |

**New non-table types only:** `StudentHomeworkPageInput` / `StudentHomeworkPageReturnType` (§8.A) — transport envelopes, not entities.

## 10. API Contracts

### SDL delta (after `bun run generate:gqlSchema`)

```graphql
type StudentHomeworkPage {
  items: [SessionHomeWork!]!
  totalCount: Int!
  page: Int!
  pageSize: Int!
}

extend type Query {
  """Paged homework history of one student, visible to any teacher who has
  at least one session (any status) with that student — cross-teacher by
  construction. Constant FORBIDDEN otherwise."""
  studentHomeworkHistory(studentId: ID!, page: Int, pageSize: Int): StudentHomeworkPage!
}
```
`SessionHomeWork` (canonical, 12 fields incl. `id` first) is consumed unchanged. The mutation and both existing reads are consumed unchanged.

### Permission matrix (wire behavior)

| Caller shape | `submitSessionReport` (existing) | `sessionReport`/`sessionHomework` (existing) | `studentHomeworkHistory` (NEW) |
|---|---|---|---|
| anonymous | `UNAUTHORIZED` (401) | `UNAUTHORIZED` (401) | `UNAUTHORIZED` (401) |
| student | `FORBIDDEN` (role scope) | participant gate → row or `null` | `FORBIDDEN` (role scope — 403) |
| parent | `FORBIDDEN` (role scope) | `null` (non-participant) | `FORBIDDEN` (role scope — 403) |
| admin | `FORBIDDEN` (role scope) | `null` (non-participant) | `FORBIDDEN` (role scope — 403) |
| teacher, session-of-record | full submit path | own rows | paged history (gate passes) |
| teacher, NOT of record | `SESSION_NOT_FOUND` (oracle) | `null` | paged history IF ≥1 session with the student, else constant `FORBIDDEN` |
| unknown studentId / malformed id | `SESSION_NOT_FOUND` / `VALIDATION` | `null` / `VALIDATION` | constant `FORBIDDEN` (byte-identical for unknown vs unlinked) / `VALIDATION` |

### Error code contract (new surface; codes ride `extensions.code` via the DomainError constructor — `backend/lib/errors.ts:19-29`, preserved verbatim by `graphqlErrorsFinalizer.ts:209`)

| Code | When | Copy source |
|---|---|---|
| `UNAUTHORIZED` | anonymous | scope layer |
| `FORBIDDEN` | non-teacher role OR zero teacher-student sessions | `errorsTranslations.forbidden` (en+ar, exists) |
| `VALIDATION` | malformed studentId shape | id-guard copy (en+ar, exists) |
| `SESSION_REPORT_ALREADY_EXISTS` / `SESSION_INVALID_TRANSITION` / `SESSION_NOT_FOUND` / `CONFLICT` | consumed from the UNCHANGED submit path | M1 errors-namespace keys (en+ar, exist) |

## 11. Security & Tenancy Mitigations

- **BOLA/IDOR:** identity exclusively `ctx.user.id` (verified context); the student id is data, the teacher id is NEVER client-supplied. The relationship EXISTS gate fuses the tenancy predicate in SQL (`eq(session.teacherId, caller) ∧ eq(session.studentId, studentId)`), constant-denial for every miss shape — unknown student ≡ unlinked student ≡ (service-internal) non-teacher, byte-identical `FORBIDDEN` (D4).
- **BOPLA:** the submit payload is built field-by-field client-side (`buildSubmitPayload`) onto the closed `SubmitSessionReportInput` whitelist; the server's own field-by-field insert mapping (`homeWorkInsertOf`, `session-report.service.ts:131-144`) is unchanged — no `{ ...input }` spread anywhere on either side.
- **BFLA:** the new query is role-scoped `$all { authenticated, role: [UserRole.Teacher] }` — students/parents/admins are denied at the scope layer before the service; the mutation keeps its M1 teacher scope.
- **Input sanitization:** the pre-DB positive-safe-integer id guard runs on `studentId` before any SQL; no LIKE/wildcard surface exists on this path (no search input).
- **Enumeration:** paged reads clamp pageSize ≤ 50; the constant oracle prevents student-existence probing by unlinked teachers.
- **Logging:** the read path logs NOTHING on success (M1 read posture) and exactly ONE bounded `logDomainError` per denial — context `{code, entity, entityId, locale}` only, never notes or payload.
- **Tenancy note:** homework rows are student-tenant-scoped by construction (`session.student_id`); the teacher dimension is the authorization lens, not the storage tenant — the reason `listForStudent` is already teacher-agnostic (`home-work.repository.ts:232`).

## 12. Testing Strategy

| Suite | File | Scope |
|---|---|---|
| Repo (EXTEND) | `backend/db/test/repo/classes/session.repository.test.ts` | `existsSessionForTeacherStudent`: true for linked pair (any status incl. cancelled), false for unlinked/unknown, tx-propagated form — `runInRollback` + `tx`, `expectRepoError` discipline, 100% branch coverage of the new method |
| Service (NEW) | `backend/services/classes/student-homework.service.test.ts` | constant-FORBIDDEN oracle (unknown id ≡ unlinked ≡ 0/‑1 shapes, byte-identical copy from `getServerTranslations("en").errorsTranslations`); happy path with rows authored by TWO teachers both visible, newest-first; clamp boundaries (page 0→1, pageSize 0/51→25/50); `outerTx` SAVEPOINT seam; read silence (no logs on success — spy `logger.logDomainError`) |
| Wire (NEW) | `backend/graphql/test/student-homework-history.wire.test.ts` | `setupTestServerLifecycle()` + `buildSessionJourneyCast` + real `signAccessToken` clients (the `session-report.wire.test.ts:96-200` recipe): anonymous → `UNAUTHORIZED`; student/parent/admin → `FORBIDDEN`; unlinked teacher → constant `FORBIDDEN` (byte-identical for unknown vs foreign); teacher-of-record happy path with envelope echo (`items/totalCount/page/pageSize`); id-shape junk → `VALIDATION` |
| Journey (NEW — test-first) | `test/workflows/classes/session-report-cross-teacher.journey.test.ts` | REQ-8's 7 ordered steps; committed fixtures, `TrackedFixtures.cleanup()`, spied transport + memory claim cache, try/catch denials (never `.rejects.toThrow()`), no `runInRollback` |
| Documents contract (EXTEND) | `frontend/graphql/sharedDocuments/scheduling/session-report.documents.test.ts` | pin the new query's selection: `id` first, exact 12 homework fields, envelope fields, nothing extra |
| Frontend pure units (NEW) | `frontend/views/teacher/sessions/teacherSessionCacheArms.test.ts` · `teacherSessionReportDialog.helpers.test.ts` | CTA matrix (scheduled→start; started→complete+homework; completed→report; cancelled→[]); payload building (BOPLA, grades absent on assignment), validation mirroring (bounds, ≥1 block, first-session derivation), newest-row/graded derivations |
| Parity (EXTEND) | `shared/locale/sessions-namespace.parity.test.ts` | new mandated keys on both maps, non-empty values, function-key exercised across the 35-value vocabulary in both locales, ICU/placeholder parity where applicable |
| Regression (read-only) | M1 suites — service/guards/repo/wire/journey | run unchanged; any red = plan regression, not pre-existing |

**Run discipline:** journey via `bun run test/scripts/run-test.ts test/workflows/classes/session-report-cross-teacher.journey.test.ts`; DB/service suites via the same run-test wrapper; every touched file through `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0).

**Browser verification (final task):** `bun run scripts/browser-login.ts --inject` (super-admin/teacher session), DOM-first snapshot of `/teacher/sessions`, open the dialog, assert the form fields and a completed-session CTA via the accessible snapshot; screenshots to `scratch/screenshots/` — read by an isolated subagent only, text summary back.

## 13. Drizzle Anti-Pattern Reminder

NEVER inline `--` comments inside `sql\`…\`` templates — they shift parameter bindings. The new EXISTS probe uses the query builder (no raw SQL needed); if a `sql` fragment is ever introduced, comments stay OUTSIDE the template.

## 14. Outcome & Knowledge Transfer Protocol

`ai/plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/outcome/`
- **BEFORE Execution:** read ALL existing outcome files (baseline counts, findings, pitfalls).
- **AFTER Execution:** write `outcome/<task-id>-outcome.md` per task (research, implementation notes, cross-file dependencies, carry-overs).
- **PROGRESS:** update `[ ]` → `[x]` in `tasks.md` per subtask.
- **Propagation (final task):** update `docs/sessions/session-report-homework.md` (§5 consumer guidance → cite the shipped dialog + new query; §6 rollout rows) — AGENTS.md / `.agents/instructions` files are hand-curated and are NEVER touched by plan work.

---

## Design Review Checklist

- [x] Architecture: overview diagram + component responsibilities + interfaces (exact signatures) specified
- [x] Requirements alignment: every REQ-0..REQ-9 has a design home (§4 UX, §5 i18n, §6 concurrency, §7 journey, §8 components, §9-11 contracts/security)
- [x] Cross-actor journey has state machine + side-effect matrix + cross-actor visibility table (§7)
- [x] Security: BOLA/BOPLA/BFLA + sanitization + logging posture (§11)
- [x] Error handling: code contract + client arm mapping (§10, §8.H)
- [x] Implementation-ready: exact file paths, signatures, and test recipes (§8, §12)
- [x] UX/Navigation completeness: routes (explicit none), sidebar, role matrix, per-audience, permissions, mobile/RTL (§4)
- [x] No schema change; no write-path change; M1 surfaces consumed, never modified
