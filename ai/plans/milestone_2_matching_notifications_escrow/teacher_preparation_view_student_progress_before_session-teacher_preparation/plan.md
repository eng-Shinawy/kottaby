# Design — Teacher Preparation View (Student Progress Before Session)

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`
> **Specs of record:** `specs.md` (REQ-001..REQ-011) · **Ticket:** `docs/planning/TICKETS.md:1218-1252` — Dev 1 · M2 · 3 SP · Blocked By `Student Progress Tracking & Increment` (SHIPPED — ticket #227)
> **Plan kind:** frontend-consumption slice — zero backend code, zero schema delta, zero new routes; one new dialog cluster on the existing teacher sessions page, one new Apollo document, one new journey test.

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-26 |
| Consumed contract (shipped progress ticket #227) | `ai/finished_plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/plan.md` §3.2 (`StudentProgressReturnType`), §4.1 (SDL), §4.3 (authScopes), §5.1 (`getStudentProgress`), REQ-009/010/011 (payload + gate + honesty) — live surface: `backend/graphql/query/classes/student-progress.query.ts`, `backend/services/classes/student-progress.service.ts:173`, `frontend/graphql/generated/schema.graphql:1717,1948-1960` |
| Consumed shipped surfaces | `studentHomeworkHistory` query (`backend/graphql/query/classes/session-report.query.ts:134-172`, scope `:147-152`) · `StudentHomeworkService.listStudentHomeworkHistory` (`backend/services/classes/student-homework.service.ts:134`) · gate `requireTeacherOfStudent` (`:84`) → `SessionRepository.existsSessionForTeacherStudent` (`backend/db/repo/classes/session.repository.ts:888`) |
| Frontend clone lineage | `TeacherSessionReportDialog.tsx:49-104` (dialog split) · `useTeacherSessionReportQueries.ts:28-46` (query bundle) · `TeacherSessionReportDialogMount.tsx:25-45` (row-keyed mount) · `teacherSessionCacheArms.ts:157-198` (affordance matrix) · `academic-tracking-student-card.tsx:50-103` (progress-card visuals) |
| Related docs | `docs/specs/functional-requirements.md:202-204` (FR-6.2) · `docs/specs/state-machine-invariants.md:318-323` (§9.2) · `docs/planning/MILESTONE_PLAN.md:177,200` |

## 1. Overview & Key Design Decisions

### Overview

A teacher opens `/teacher/sessions`, sees a freshly booked Tajweed session, and — before pressing Start — presses the new "Prepare" affordance on that row. A dialog opens, keyed by the row's session id, and issues exactly two parallel reads: the shipped `studentProgress(studentId)` and the shipped `studentHomeworkHistory(studentId, page: 1, pageSize: 5)`. The dialog renders a curriculum-position card (current lesson, position of total, completion percent — or the "First session — diagnostic" state) and a newest-first previous-homework list. It contains no write affordance of any kind. No backend file changes; no new route; the nav graph is untouched.

### Design Goals

1. Consume, never duplicate: every byte of progress semantics stays owned by the shipped progress ticket; every byte of homework-history semantics stays owned by the shipped session-report domain.
2. The preparation surface must be mountable unchanged from the future request-accept flow (props are row-derived; no list-page coupling beyond the mount).
3. Read-honesty end to end: `hasProgress: false` renders the diagnostic state, null grades render not-yet-graded — zero fabrication at every layer.
4. Pattern isomorphism: every new file mirrors its shipped teacher-sessions sibling so review is diff-mechanical (split discipline: orchestrator / parts / helpers / hook / mount).

### Key Design Decisions

- **D1 — Zero new backend; compose two existing teacher-gated reads.** *Context:* the ticket needs current lesson + previous homework; the sibling plan ships `studentProgress` (teacher gate = shared session, any status) and `studentHomeworkHistory` is already shipped with a cross-teacher gate. *Options:* (1) a new composite query (parent-portal/admin-portal precedent: `parentChildProgress`, `adminStudentAcademicDetail` — both built because their actor had NO other access); (2) frontend composition over the two reads. *Decision:* (2). *Rationale:* the teacher's access already exists on both reads; a composite would add a second read path over the same data and a third authorization surface. Consequence (accepted): two round-trips on open instead of one — acceptable for a dialog opened on demand.
- **D2 — The "request" is today's `scheduled` row; the future accept flow reuses the mount.** *Context:* the ticket Gherkin says "before accepting the request", but no request/accept entity exists — booking is direct (`session-lifecycle.booking.ts:235-291`) and the intake flow is the matching stream's ticket (dormant waves `session-request-notification.service.ts:139-145` prove the intended shape). *Decision:* gate the affordance to `status = scheduled ∧ intent = tajweed` rows and keep the dialog props row-derived. *Rationale:* the scheduled row IS the teacher-visible "incoming Tajweed session" today; the accept flow later mounts the same dialog with its own open/close intent (deferred item D4) without touching the dialog internals.
- **D3 — Affordance ordered before "Start", Record-gated like the rubric branch.** The matrix builder (`teacherSessionCacheArms.ts:157-198`) gains a `PREP_SESSION_INTENTS: Readonly<Record<SessionIntent, boolean>>` lookup mirroring `RUBRIC_SESSION_TYPES` (`:134-138`) — `tajweed: true`, everything else false — with one discipline difference the rubric does not need: `session.intent` is NULLABLE (`MyTeacherSessionsQuery_myTeacherSessions_items` — `frontend/graphql/generated/gql/graphql.ts:1631`), so the predicate null-guards before indexing (`session.intent !== null && PREP_SESSION_INTENTS[session.intent] === true`); `shouldOfferPrep` in the helpers owns that guard. The Prepare descriptor is pushed BEFORE the Start descriptor for scheduled rows (review precedes start, FR-6.2) and carries NO in-flight slot (the dialog owns loading — same status-pure discipline as Homework/Report, matrix docblock `:150-156`).
- **D4 — First-session presentation keys off `hasProgress` only.** The shipped progress query delivers the machine-readable signal (`hasProgress`, its plan's REQ-011); the dialog renders the localized "First session — diagnostic" state and suppresses the curriculum card entirely. *Rejected:* deriving "first session" from homework emptiness (`totalCount = 0`) — the two states can diverge (a session can complete-without-confirmation, leaving homework rows but no progress; INV-HW3/HW4 semantics differ from INV-PR2), and the ticket's own Gherkin ties the indicator to lesson progress.
- **D5 — Homework history: first page only, "+N more" from `totalCount`.** `pageSize: 5` (server clamps via `clampHomeworkHistoryPage`); the count line is computed, never fetched. *Rejected:* in-dialog pagination controls (D3 deferred — the prep glance wants recency, not an archive browser; the student-side `HomeworkContainer` owns full paging).
- **D6 — i18n: extend `sessions`, reuse `homework`.** All dialog chrome keys land in `SessionsLabels` (the teacher-session keys' established home — `viewHomeworkAction` `labels.ts:292`); Jadid/Madi/grade/date row labels come from the existing `HomeworkLabels` via TWO separate `useAppTranslation` calls — `useAppTranslation(Sessions)` + `useAppTranslation(Homework)` (the hook takes exactly ONE namespace handle, `shared/locale/client/use-app-translation.ts:8-17`; the two-call composition precedent is `StudentSessionsContainer.tsx:116-117`). *Rejected:* a new namespace — no other surface consumes it; the parity harness is per-namespace and a new one buys nothing. Function leaves must ALSO be registered in the sessions parity belt's `FUNCTION_LABEL_KEYS` + `sampleArgsFor` (`shared/locale/sessions-namespace.parity.test.ts:248,351`) or the belt throws on the non-string value.
- **D7 — Student identity stays numeric ("Student #id") — names deferred.** *Context:* every teacher surface today is student-ID-opaque (`Session` Pothos object `session.pothos.ts:165-271` exposes `studentId` only; no `fullName` anywhere in the rows). *Options:* (1) extend the `Session` payload or the shipped `StudentProgress` DTO with a name; (2) render the numeric id like every existing teacher surface. *Decision:* (2), with deferred item D1 recording the server-side compose precedent (`session-arbitration.case-reads.helpers.ts:114` — `studentName: studentUser?.fullName ?? null`). *Rationale:* a name would require either modifying the shipped progress contract or touching the shared `Session` type used by every list — blast radius far beyond a 3-SP read view. The prep dialog is reachable only from a specific session row, so the row context already disambiguates.
- **D8 — `StudentProgress: { keyFields: false }`.** The shipped SDL type has no `id` (by design — a computed read-model DTO), so it cannot normalize; without the policy Apollo emits cache-loss warnings on re-reads. This is not discretionary: `frontend/graphql/AGENTS.md:87-96` mandates the `keyFields: false` opt-out for every id-less type. Precedent: `StudentHomeworkPage: { keyFields: false }` at `apolloCache.ts:131` in the wrapper family whose policy block starts at `:76`. The docblock's registered-types inventory (`apolloCache.ts:10-40`) gains the one-line rationale entry.
- **D9 — One slim journey; the sibling journey is not duplicated.** The shipped progress ticket's journey (`test/workflows/classes/tajweed-progress-increment.test.ts` — landed with ticket #227) owns the settlement→advance visibility contract. This plan adds `test/workflows/classes/teacher-preparation-read.journey.test.ts` for the ONE untested cross-actor leg: the pre-session read (booked-but-not-started) across both honesty states + the foreign-teacher denial — the ticket's own four test scenarios, executed at the service boundary the UI consumes, with the same notification-spy discipline as the sibling (`tajweed-progress-increment.test.ts:215`).

## 2. UX / Navigation Specification

### 2.1 New Routes & URLs

| Route | Purpose | Permission | Roles |
|---|---|---|---|
| — (NONE) | — | — | — |

No `app/` route, page, or layout changes (REQ-011.1). The only new surface is the in-page dialog cluster on `/teacher/sessions` (existing page guard `withPageAuth({ roles: [UserRole.Teacher] })`, `app/(dashboard)/teacher/sessions/page.tsx:32-34`).

### 2.2 Sidebar / Navigation Integration

- `frontend/views/dashboard/nav/navItems.ts:143-150` (teacher block) — **untouched**. The Prepare affordance lives on the session row; no nav entry exists for row-scoped actions (same as Start/Complete/Report — none of them are nav items either).
- Mobile bottom nav: **N/A** — the repo has no bottom-nav surface anywhere.

### 2.3 Role-Based Access Matrix (the surfaces this plan touches)

| Role | `/teacher/sessions` page | Prepare CTA (scheduled tajweed row) | `studentProgress` query | `studentHomeworkHistory` query |
|---|---|---|---|---|
| `teacher` | ✅ (existing page guard) | ✅ own rows (`teacherActionsForSession` receives only the caller's list) | ✅ shared-session gate (progress ticket plan D6) | ✅ shared-session gate (`requireTeacherOfStudent`) |
| `student` | ❌ page guard | — | ✅ self only (no UI here) | ❌ scope-layer 403 (`session-report.query.ts:147-152`) |
| `parent` | ❌ | — | ❌ scope-layer 403 (progress ticket plan REQ-010.4) | ❌ scope-layer 403 |
| `admin` | ❌ (admin has its own surfaces) | — | ✅ any student (no UI here) | ❌ scope-layer 403 (teacher-only) |
| anonymous | ❌ redirect to login | — | ❌ 401 | ❌ 401 |

### 2.4 Per-Audience Rendering

| Audience | Rendering |
|---|---|
| Teacher | The ONLY audience with UI in this plan: Prepare CTA → dialog (curriculum card + previous-homework list + first-session state, read-only). |
| Student | No new rendering. Their own progress consumption arrives with future student-dashboard tickets (progress ticket's deferred item D7). |
| Parent | No new rendering. Portal keeps `parentChildProgress` (raw row count) — progress ticket plan D8 discipline. |
| Admin | No new rendering. Admin academic tracking (`adminStudentAcademicDetail`) already renders richer drill-downs. |

### 2.5 Permission Mapping (exact strings/ids)

| Surface | Enforcement point |
|---|---|
| Page | `withPageAuth({ roles: [UserRole.Teacher] })` — existing, unchanged |
| `studentProgress` | Pothos `authScopes: { $all: { authenticated: true, role: [Admin, Teacher, Student] } }` — progress ticket plan §4.3; service-level teacher gate `countTeacherStudentSessions ≥ 1` |
| `studentHomeworkHistory` | Pothos `authScopes: { $all: { authenticated: true, role: [UserRole.Teacher] } }` — `session-report.query.ts:147-152`; service gate `requireTeacherOfStudent` |
| UI denial | `FORBIDDEN` → `PermissionDeniedFallback` (`frontend/AGENTS.md:66`); `UNAUTHENTICATED` → redirect via existing auth hooks |

## 3. Data Models (zero schema delta — consumed types only)

### 3.1 Consumed: `StudentProgress` (progress ticket plan §3.2/§4.1 — SHIPPED, ticket #227)

```typescript
// backend/types/classes/progress.types.ts (shipped verbatim by the progress ticket)
export interface StudentProgressReturnType {
  readonly hasProgress: boolean;
  readonly studentId: number;
  readonly planId: number | null;
  readonly planTitle: string | null;
  readonly totalLessons: number;
  readonly currentLessonId: number | null;
  readonly currentLessonTitle: string | null;
  readonly currentLessonPosition: number | null; // 1-based
  readonly lessonsCompleted: number;
  readonly completionPercent: number;           // floor(lessonsCompleted * 100 / totalLessons)
  readonly isOnFinalLesson: boolean;
}
```

GraphQL (shipped — live at `frontend/graphql/generated/schema.graphql:1717,1948-1960`): `type StudentProgress { hasProgress: Boolean!, studentId: Int!, planId: Int, planTitle: String, totalLessons: Int!, currentLessonId: Int, currentLessonTitle: String, currentLessonPosition: Int, lessonsCompleted: Int!, completionPercent: Int!, isOnFinalLesson: Boolean! }` + `extend type Query { studentProgress(studentId: Int!): StudentProgress! }`. **No `id` field → Apollo cannot normalize → D8 policy.** Codegen type arrives as `StudentProgressQuery_studentProgress` (non-nullable field).

### 3.2 Consumed: `StudentHomeworkPage` (SHIPPED — `home-work.pothos.ts:190-202` envelope + 12-field item)

Document already exists and selects every field the prep view needs: `frontend/graphql/sharedDocuments/scheduling/session-report.documents.ts:129-154` — item fields `id, sessionId, currentFromAyah, currentToAyah, currentGrade, currentSurahJuz, revisionFromAyah, revisionToAyah, revisionGrade, revisionSurahJuz, createdAt, updatedAt` + envelope `totalCount, page, pageSize`. The wrapper already carries the `keyFields: false` cache policy. The prep view reuses this document verbatim — no changes.

### 3.3 Consumed: session row (`MyTeacherSessionsQuery_myTeacherSessions_items`)

Already carries everything the CTA gate and mount need: `id, status, intent, sessionType, studentId, …` (`session-reads.documents.ts:117-149`). The mount resolves the row from the cached page data exactly like `TeacherSessionReportDialogMount.tsx:33`.

### 3.4 NEW type-level surface (frontend only): the view model

No new shared/backend types. The dialog's derived view model lives in the helpers file (frontend view-local — the established home for presentation shaping, e.g. `teacherSessionReportDialog.helpers.ts`):

```typescript
/** frontend/views/teacher/sessions/teacherPrepDialog.helpers.ts */
export type PrepProgressSection =
  | { readonly kind: "firstSession" }
  | {
      readonly kind: "positioned";
      readonly lessonTitle: string;
      readonly position: number;
      readonly totalLessons: number;
      readonly completionPercent: number;
      readonly planTitle: string | null;
      readonly isOnFinalLesson: boolean;
    };

export interface PrepHomeworkRow {
  readonly id: string;
  readonly sessionId: string;
  readonly jadid: { readonly surahJuz: string | null; readonly fromAyah: number | null; readonly toAyah: number | null; readonly grade: number | null } | null;
  readonly madi: { readonly surahJuz: string | null; readonly fromAyah: number | null; readonly toAyah: number | null; readonly grade: number | null } | null;
}
```

Rules: null grades stay null in the model (REQ-006.4 rendering decides presentation); both spans null → the row renders the no-assignment state; the helpers are pure functions over the codegen types (bun-testable — the layer's only testable seam).

## 4. API Contracts (consumed + one new frontend document)

### 4.1 Consumed SDL: `studentProgress` (SHIPPED — present in `frontend/graphql/generated/schema.graphql:1717`; REQ-003 gate guards regressed checkouts)

```graphql
extend type Query {
  studentProgress(studentId: Int!): StudentProgress!
}
```

- Permission matrix (from that plan §4.3 + REQ-010): `Admin` → any student; `Teacher` → shared-session gate (`countTeacherStudentSessions(teacherId, studentId) >= 1`, ANY session status — the booked row itself qualifies); `Student` → self only; `Parent` + anonymous → scope-layer 403; existence never leaked (constant-shape `ForbiddenError`).
- **This plan adds zero SDL of its own.** The schema carrying `studentProgress` is already landed; this plan runs only `bun codegen` after the gate passes.

### 4.2 Consumed SDL: `studentHomeworkHistory` (SHIPPED — cited verbatim from the live schema)

```graphql
extend type Query {
  studentHomeworkHistory(studentId: Int!, page: Int, pageSize: Int): StudentHomeworkPage!
}
```

- Scope: `role: [UserRole.Teacher]` only (`session-report.query.ts:147-152`); gate `requireTeacherOfStudent` (`student-homework.service.ts:84`) → `existsSessionForTeacherStudent` (`session.repository.ts:888`) — the same any-status shared-session relationship.
- Pagination contract: `page` defaults 1, clamped ≥ 1; `pageSize` defaults 20, clamped 1-20 (`clampHomeworkHistoryPage`). The prep view passes `{ studentId, page: 1, pageSize: 5 }` — always explicit, never null defaults (the report dialog's `page: null, pageSize: null` call is fine for its single-row peek; the prep view wants a deterministic window).

### 4.3 NEW frontend document (the plan's ONLY new operation surface)

```typescript
// frontend/graphql/sharedDocuments/scheduling/student-progress.documents.ts
export const studentProgressQueryDocument: TypedDocumentNode<
  StudentProgressQuery,
  StudentProgressQueryVariables
> = gql`
  query StudentProgress($studentId: Int!) {
    studentProgress(studentId: $studentId) {
      hasProgress
      studentId
      planId
      planTitle
      totalLessons
      currentLessonId
      currentLessonTitle
      currentLessonPosition
      lessonsCompleted
      completionPercent
      isOnFinalLesson
    }
  }
`;
```

- Naming per convention: `{entityName}QueryDocument` → `studentProgressQueryDocument`; codegen query name `StudentProgress` (`frontend/graphql/sharedDocuments/AGENTS.md` naming rule).
- The whole payload is selected (11 fields) — the honesty rule needs `hasProgress` FIRST-class; omitting nullable fields would force fallbacks that can fabricate. Imports: `import { gql, type TypedDocumentNode } from "@apollo/client"` (never `@apollo/client/core`) + the codegen type import — the exact head of `session-reads.documents.ts:1-9`.
- `StudentHomeworkPage` precedent for the id-less type: cache policy `StudentProgress: { keyFields: false }` registered in `frontend/providers/apollo/apolloCache.ts` (policy block `:76+`, family precedent `StudentHomeworkPage` at `:131`; + docblock inventory line) — the mandated opt-out for id-less types (`frontend/graphql/AGENTS.md:87-96`); the "always include id" rule is for entity types, and read-model DTOs without identity take this documented exception instead.
- **ZERO mutations** anywhere in the plan's document set (REQ-007.1) — the read-only proof is the document imports themselves.

### 4.4 Failure contract (UI mapping)

| Condition | Error code | UI branch |
|---|---|---|
| Teacher shares no session / parent scope / student not self | `FORBIDDEN` | `PermissionDeniedFallback` seam (`frontend/AGENTS.md:66`) inside the dialog |
| Unauthenticated | `UNAUTHENTICATED` | existing apollo error-link redirect |
| Uncoded / network failure | none (`extensions.code` absent) | localized generic error body + retry `refetch()` — the `frontend/views/teachers/dashboard/TeacherUpNextCard.tsx:74-88` branch discipline (code gates would swallow uncoded errors into a silent empty render) |

## 5. Services / Repositories (ALL consumed — ZERO new, ZERO modified)

| Surface | Signature (file:line) | Role in this plan |
|---|---|---|
| `StudentProgressService.getStudentProgress` | `(callerId, callerRole, studentId, locale, outerTx?)` — `backend/services/classes/student-progress.service.ts:173` (shipped) | Powers `studentProgress`; called by GraphQL, never by this plan directly |
| `StudentHomeworkService.listStudentHomeworkHistory` | `(teacherUserId, studentId, page, locale, outerTx?)` — `student-homework.service.ts:134` | Powers `studentHomeworkHistory` (shipped) |
| `requireTeacherOfStudent` | `(teacherUserId, studentId, locale, t, tx)` — `student-homework.service.ts:84-90` | The shared-session gate (both reads effectively share this relationship shape) |
| `SessionRepository.existsSessionForTeacherStudent` | `(teacherId, studentId, tx)` — `session.repository.ts:888` | Tenancy predicate (consumed, unchanged) |
| `teacherActionsForSession` | `(session, wiring: TeacherActionsWiring)` → `SessionRowAction[]` — `teacherSessionCacheArms.ts:157-198` | MODIFIED (frontend helper, not backend): gains the Prepare descriptor |

### 5.1 Concurrency & Caching Assessment

- **Read-only composition**: the dialog issues 2 parallel `useQuery` reads; there are NO writes, NO optimistic updates, NO cache mutations. The only cache writes are Apollo-normalized read results.
- **Staleness window (accepted)**: the prep queries run with the default cache-first policy exactly like the sibling hook bundle (`useTeacherSessionReportQueries.ts:33-38` sets no `fetchPolicy`); the keyed remount (`key={sessionId}`) plus `skip: !open` means every dialog open is a fresh mount — a progress advance that settles while a dialog stays open appears on next open. No subscription polling (progress changes only on dual confirmation — minutes-scale events, not seconds).
- **`keyFields: false` consequence**: the `StudentProgress` payload is re-fetched per open (never merged into the normalized store) — correct for a computed read-model; no lost-update hazard because there are no local writes.
- **Row-slot race**: the Prepare descriptor carries no in-flight slot; the keyed mount (`key={sessionId}`) unmounts/remounts on row switch — stale-dialog-content races are structurally impossible (the mount pattern's own discipline, `TeacherSessionReportDialogMount.tsx:36`).
- **No `useLazyQuery`** — stateful `useQuery` with `skip` only (repo-wide rule; the sibling hook bundle `useTeacherSessionReportQueries.ts:33-38` is the reference).

### 5.2 Cross-Actor Journey Design (J1 — maps to REQ-009 step list)

**Shared-Entity State Machine (consumed — no new states in this plan):**

```
progress row (per student×tajweed plan, single pointer):
  ABSENT ──(session dual-confirmed; INV-PR2, shipped progress increment)──▶ POINTING(lesson k) ──(next dual-confirmation)──▶ POINTING(lesson k+1) … ▶ POINTING(final)
                │
                └── read-only observed by: teacher (this plan's dialog) · student (self-read) · admin (drill-down)
teacher×student relationship gate: countTeacherStudentSessions(teacherId, studentId) ≥ 1, ANY session status
  ── the "request" moment (student books) creates the qualifying scheduled row BEFORE any lesson state exists
```

**Side-Effect Matrix (this plan's rows only — read-only by construction):**

| Transition/Event | Rows created/updated | Notifications dispatched | Idempotency keys |
|---|---|---|---|
| Student books (existing `createSession`) | 1 `sessions` row (`scheduled`) | existing booking waves (shipped) | existing booking idempotency (shipped) |
| Teacher opens Prepare dialog | ZERO (2 reads) | ZERO | n/a |
| Teacher reads progress/homework | ZERO | ZERO | n/a |
| Foreign teacher attempts read | ZERO | ZERO (denial logged service-side) | n/a |

**Cross-Actor Visibility (who sees what, when):**

| State | Teacher T1 (owner) | Foreign teacher T2 | Student | Parent |
|---|---|---|---|---|
| B books → row `scheduled`, no progress | sees row + Prepare CTA; dialog: "First session — diagnostic" + empty homework | sees nothing (not their list); direct read → 403 | sees own booking | portal shows booking only |
| A books (has settled history) | dialog: current lesson 2/3, 33%, prior homework with grade | 403 | self-read shows same lesson | portal row count reflects advance |
| Progress advances (settlement elsewhere) | next dialog open shows new position | — | self-read updated | portal count updated |

This table IS the journey's assertion set (specs.md REQ-009 steps 4-6).

## 6. Component Design (the dialog cluster)

| File (all under `frontend/views/teacher/sessions/`) | Modeled on | Responsibility |
|---|---|---|
| `useTeacherPrepQueries.ts` (NEW) | `useTeacherSessionReportQueries.ts:28-46` | Two stateful `useQuery`s (`studentProgressQueryDocument` + `studentHomeworkHistoryQueryDocument`), `skip: !open \|\| !studentId`, folded single `loading`; **no local type defs** — codegen + helpers types only |
| `teacherPrepDialog.helpers.ts` (NEW) | `teacherSessionReportDialog.helpers.ts` | Pure derivation: `resolvePrepSection(progress): PrepProgressSection` (first-session vs positioned — REQ-004/005), `resolvePrepHomeworkRows(items): PrepHomeworkRow[]` (jadid/madi span shaping, null-grade preservation — REQ-006.4), `resolveHiddenHomeworkCount(totalCount, shown): number` ("+N more" math — REQ-006.5), `shouldOfferPrep(session): boolean` (Record-gated intent+status predicate for the CTA — mirrors `RUBRIC_SESSION_TYPES` discipline) |
| `teacherPrepDialog.helpers.test.ts` (NEW) | `rubricEvaluationDialog.helpers.test.ts` | bun-testable unit coverage of all four helpers, 100% branches |
| `TeacherPrepDialog.parts.tsx` (NEW) | `TeacherSessionReportDialog.parts.tsx` + `academic-tracking-student-card.tsx:65-103` | Presentational blocks: `PrepProgressCard` (curriculum-position card / first-session banner), `PrepHomeworkList` (newest-first rows, homework-namespace labels, null-grade presentation), loading skeleton, error/denial branches (`PermissionDeniedFallback` seam) |
| `TeacherPrepDialog.tsx` (NEW) | `TeacherSessionReportDialog.tsx:49-133` | Orchestrator-only: TWO separate translation calls — `useAppTranslation(Sessions)` + `useAppTranslation(Homework)` (single-handle hook, `use-app-translation.ts:8-17`; two-call precedent `StudentSessionsContainer.tsx:116-117`); wires hook → helpers → parts; `<Dialog fullWidth maxWidth="sm">` with `aria-labelledby`; **zero mutation imports** |
| `TeacherPrepDialogMount.tsx` (NEW) | `TeacherSessionReportDialogMount.tsx:25-45` | Row resolver + keyed conditional mount: derives `studentId` from the cached `myTeacherSessions` page, renders dialog when `prepDialogSessionId !== null` |
| `teacherSessionCacheArms.ts` (MODIFIED) | own `RUBRIC_SESSION_TYPES` pattern `:134-138` | `TeacherActionsWiring` gains `onPrepare: (sessionId: string) => void`; scheduled branch pushes the Prepare descriptor FIRST (`id: "prepare"`, label `t.prepAction`, no in-flight slot) when `PREP_SESSION_INTENTS` admits the row's intent |
| `useTeacherSessionDialogSessions.ts` (MODIFIED) | own triple pattern | Adds the `prepDialogSessionId` / `openPrepDialog` / `closePrepDialog` triple |
| `TeacherSessionsContainer.tsx` (MODIFIED) | own wiring | Destructures the new triple, passes `onPrepare` into the body wiring + mount into overlays (one intent, one prop — the container stays an orchestrator) |
| `TeacherSessionsOverlays.tsx` (MODIFIED) | own mount composition | Mounts `TeacherPrepDialogMount` beside the report mount |
| `TeacherSessionsBody.tsx` (MODIFIED) | own `actionsFor` plumbing | Threads `onPrepare` into the `teacherActionsForSession` wiring |
| `frontend/providers/apollo/apolloCache.ts` (MODIFIED) | own wrapper family | `StudentProgress: { keyFields: false }` + docblock inventory line |
| `frontend/graphql/sharedDocuments/scheduling/student-progress.documents.ts` (NEW) | `session-reads.documents.ts` | The §4.3 document; `export *` added to `scheduling/index.ts` |

MUI v9 discipline everywhere: layout props via `sx` only, theme-callback colors (`sx={theme => ({ color: theme.palette.primary.main })}`), `@keyframes` inline in `sx`, no `*Outline` icon names, `Typography` weight via `sx={{ fontWeight: 600 }}` (`frontend/AGENTS.md:26-44`).

## 7. Security & Tenancy Mitigations

| Vector | Mitigation | Where |
|---|---|---|
| BOLA/IDOR | `studentId` never taken from user input — derived from the cached session row in the mount; both queries re-verify the caller↔student relationship server-side (shared-session gates) | mount + consumed services |
| BOPLA | the plan ships zero input objects and zero mutations — nothing to mass-assign; the dialog's only inputs are open/close intents | REQ-007 |
| BFLA | no new mutation/field reachable by any role; progress writes remain internal to the settlement path (progress ticket plan §8) | §4.3 |
| Info oracle | denials are constant-shape 403s from the consumed services; the UI renders `PermissionDeniedFallback` without echoing server detail | §4.4 |
| Injection | no new SQL, no LIKE anywhere in the plan; ids are codegen-typed strings passed to typed GraphQL args | §4 |
| Cache identity | id-less `StudentProgress` opted out of normalization (`keyFields: false`) so no cross-student field-merge hazard exists | D8 |

## 8. Testing Strategy

| Layer | File(s) | Approach |
|---|---|---|
| Helper units | `frontend/views/teacher/sessions/teacherPrepDialog.helpers.test.ts` | bun test via `bun run test/scripts/run-test.ts`; T1 100% branches · T2 boundaries (0 lessons payload, null grades, null spans, `isOnFinalLesson`, `totalCount` 0 vs >5, position null with hasProgress true — the re-anchor display case) · T4 hostile shapes (null intent row, unknown status) |
| CTA matrix | extend `teacherSessionCacheArms.test.ts` | scheduled+tajweed → [prepare, start]; scheduled+hifz → [start] only; started/completed/cancelled/disputed → no prepare; descriptor order + no-in-flight-slot assertions |
| Journey | `test/workflows/classes/teacher-preparation-read.journey.test.ts` (NEW) | conventions per `test/workflows/AGENTS.md`: committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`; actors via `provisionStudentActor`/`provisionCertifiedTeacherActor` (`test/workflows/helpers/actor-context.ts:88,105`); denial legs via `catchJourneyError` (`journey-fixtures.ts:226`); **notification dispatch SPIED** (`spyOn(NotificationEngine, "publishReceipts")` — sibling precedent `tajweed-progress-increment.test.ts:215`) with a zero-unexpected-fan-out assertion (AGENTS rules 5+12); run via `bun run test/scripts/run-test.ts` |
| i18n parity | existing `shared/locale/sessions-namespace.parity.test.ts` | stays green with the new key set |
| Stories (manual visual) | `frontend/stories/teachers/TeacherPrepDialog.stories.tsx` (NEW) | `StoryApolloProvider`/`MockLink` harness (`frontend/stories/lib/storyHarness.tsx:14`); stories: positioned card, first-session, homework-empty, denied, loading — precedent `RubricEvaluationDialog.stories.tsx` |
| Wire/role tests | NONE new | both queries' wire behavior is owned by the shipped surface (`backend/graphql/test/student-progress.wire.test.ts` from the progress ticket, and the shipped `student-homework-history.wire.test.ts`) — this plan adds no backend surface to test |
| E2E | NONE | repo's UI verification is E2E-only for live-gated suites; no general component-render layer exists (`test/ui/AGENTS.md`) — visual coverage via stories, logic via helpers (D6 ledger) |

**Component test layer reality**: there is no static/component UI test layer in this repo. The plan therefore puts ALL verifiable logic in pure helpers (bun-tested), all branches in stories (human-verified), and all cross-actor behavior in the journey.

## 9. Deployment & Rollback

- Order: substrate gate (passes — schema landed) → document + `bun codegen` → UI files. Zero `db push`/`db migrate`.
- Rollback: remove the `TeacherPrepDialogMount` line from `TeacherSessionsOverlays.tsx` + revert the CTA wiring — the dialog cluster, document, and cache policy are additive and harmless left in place.
- Compatibility: purely additive UI; no existing query/mutation payload changes; the sessions list rendering is untouched except one added descriptor.

## Outcome & Knowledge Transfer Protocol

- BEFORE any task: read everything under `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/outcome/`.
- AFTER any task: write `outcome/<task-id>-outcome.md`; flip the checkbox in `tasks.md`.
- Knowledge propagation target: `docs/teachers/preparation-view.md` (final task) — the teacher-domain doc consolidating the consume-don't-duplicate pattern, the first-session honesty rule, and the row-keyed dialog discipline.
