# Research: Admin Academic Tracking — Services & Types Layer

Scope: how Jadid/Madi homework is written (session-report + student-homework services), the parent-monitoring read analogue, admin gating/directory/analytics patterns, canonical types, and verified gaps for the admin academic-tracking feature (TICKETS.md:2184).

## 0. Blocker verdict — "Session Report Submission with Homework (Jadid & Madi)" is ALREADY IMPLEMENTED

Evidence (all confirmed this session):

| Evidence | Citation |
|---|---|
| Teacher write surface `submitSessionReport(teacherUserId, sessionId, input: SessionReportSubmitInput, locale, outerTx?, options?)` | `backend/services/classes/session-report.service.ts:357` |
| Read surfaces `getSessionReport` / `getSessionHomework` | `backend/services/classes/session-report.service.ts:448`, `backend/services/classes/session-report.service.ts:487` |
| GraphQL mutation registered: `gqlSchemaBuilder.mutationField("submitSessionReport", …)` calling `SessionReportService.submitSessionReport(ctx.user.id, sessionId, input, ctx.locale)` | `backend/graphql/mutation/classes/session-report.mutation.ts:65`, `:120` |
| SDL locked by test: `submitSessionReport(id: ID!, input: SubmitSessionReportInput!): SessionReport!` | `backend/graphql/test/schema-surface.test.ts:2448` |
| Service test suite: 32 tests in 5 describe tiers (denials, validator bounds, chaos/double-submit, payload smuggling, read surface) | `backend/services/classes/session-report.service.test.ts:443,893,1412,1571,1717` (32 `it(`/`test(` matches) |
| Teacher-scoped homework history read also implemented (`listStudentHomeworkHistory`, 4 test tiers) | `backend/services/classes/student-homework.service.ts:134`; `backend/services/classes/student-homework.service.test.ts:414,578,968,1141` |
| Blocker ticket header exists at TICKETS.md:1376 (no completion-status column in ticket table itself) | `docs/planning/TICKETS.md:1376` |

Conclusion: the milestone-3 admin tracking ticket is NOT blocked — the write path that populates `reports` and `home_work` (including Jadid/Madi grades) is in production shape with tests.

## 1. (a) Session report + student homework services (Jadid/Madi write path)

### 1.1 `session-report.service.ts` public methods (exact signatures)

```ts
// backend/services/classes/session-report.service.ts:357
export async function submitSessionReport(
  teacherUserId: number,
  sessionId: number,
  input: SessionReportSubmitInput,
  locale: string,
  outerTx?: DBTransaction,
  options?: NotificationEngineCallOptions
): Promise<ReportReturnType>

// backend/services/classes/session-report.service.ts:448
export async function getSessionReport(
  callerUserId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<ReportReturnType | null>

// backend/services/classes/session-report.service.ts:487
export async function getSessionHomework(
  callerUserId: number,
  sessionId: number,
  locale: string,
  tx?: DBTransaction
): Promise<HomeWorkReturnType | null>   // (null when session not visible / no assignment)
```

Key pipeline facts:
- Pre-DB guard vocabulary resolved once per request: `getServerTranslations(locale).errorsTranslations` (guards list in §1.3).
- ONE `withTransaction` body: report-gate row lock (`SELECT … FOR UPDATE`) → report INSERT → optional homework INSERT → optional previous-grades write-once UPDATE. Duplicate submission maps raw `23505` on `reports_session_id_unique` to localized `SESSION_REPORT_ALREADY_EXISTS` (`backend/services/classes/session-report.service.ts:154-167`).
- **Jadid/Madi → column mapping** (the critical fact for the new admin view):
  - Jadid block → `current_*` columns: `insert.currentFromAyah/currentToAyah/currentSurahJuz = assignment.jadid.*` — `backend/services/classes/session-report.service.ts:133-136`
  - Madi block → `revision_*` columns: `insert.revisionFromAyah/revisionToAyah/revisionSurahJuz = assignment.madi.*` — `backend/services/classes/session-report.service.ts:138-141`
  - Previous grades write: `gradeHomeWorkOnce` with `currentGrade`/`revisionGrade` from `input.previousGrades` — `backend/services/classes/session-report.service.ts:204-205`
- `getSessionReport`/`getSessionHomework` are participant-gated via `resolveVisibleSessionForCaller`; every non-participant shape (unknown id included) collapses to identical `null` (`backend/services/classes/session-report.service.ts:462-479`).

### 1.2 `student-homework.service.ts` (teacher-scoped cross-teacher history read)

```ts
// backend/services/classes/student-homework.service.ts:134
export async function listStudentHomeworkHistory(
  teacherUserId: number,
  studentId: number,
  page: StudentHomeworkPageInput | undefined,
  locale: string,
  outerTx?: DBTransaction
): Promise<StudentHomeworkPageReturnType>
```
- Gate: `requireTeacherOfStudent` inside ONE repeatable-read transaction with the data reads (`backend/services/classes/student-homework.service.ts:143-150`); denial is constant `ForbiddenError`, one bounded `logDomainError`.
- Data: `HomeWorkRepository.listForStudent(studentId, pageSize, offset, tx)` + `countForStudent` in `Promise.all` (`backend/services/classes/student-homework.service.ts:148-150`).

Helper (pure, in `student-homework.helpers.ts`):
```ts
// backend/services/classes/student-homework.helpers.ts:45
export function clampHomeworkHistoryPage(input: StudentHomeworkPageInput | undefined): { … page, pageSize, offset }
```
Constants: `MAX_HOMEWORK_HISTORY_PAGE_SIZE = 50`, `DEFAULT_HOMEWORK_HISTORY_PAGE_SIZE = 25`, `DEFAULT_HOMEWORK_HISTORY_PAGE = 1` (`backend/services/classes/student-homework.helpers.ts:19,22,25`).

### 1.3 `session-report.guards.ts` exports (pre-DB validation vocabulary)

| Guard | Exact signature | Citation |
|---|---|---|
| `assertPositiveSessionId` | `(id: unknown, t: ErrorsTranslations): asserts id is number` | `backend/services/classes/session-report.guards.ts:82` |
| `assertTeacherNotes` | `(notes: string, t: ErrorsTranslations): string` (trim + required + length bound) | `backend/services/classes/session-report.guards.ts:95` |
| `assertRating0To5` | `(rating: number, t: ErrorsTranslations): void` | `backend/services/classes/session-report.guards.ts:111` |
| `assertGrade0To100` | `(grade: number, t: ErrorsTranslations): void` | `backend/services/classes/session-report.guards.ts:127` |
| `assertHomeWorkBlock` | `(block: HomeWorkBlockInput, t: ErrorsTranslations): void` | `backend/services/classes/session-report.guards.ts:147` |
| `isSuppliedBlock` | `(value: unknown): value is HomeWorkBlockInput` | `backend/services/classes/session-report.guards.ts:173` |
| `validateAssignment` | `(input: HomeWorkAssignInput, t: ErrorsTranslations): void` (≥1-block presence rule) | `backend/services/classes/session-report.guards.ts:188` |
| `validatePreviousGrades` | `(g: HomeWorkGradeFieldsInput, t: ErrorsTranslations): void` | `backend/services/classes/session-report.guards.ts:207` |

`ErrorsTranslations = ReturnType<typeof getServerTranslations>["errorsTranslations"]` (`backend/services/classes/session-report.guards.ts:68`).

## 2. `home_work` schema (the data the admin view will aggregate)

`backend/db/schema/classes/home-work.ts:19-41` — table `home_work`, TS export `homeWork`, one row per session (`session_id` NOT NULL + UNIQUE, cascade delete):
- Jadid track: `currentFromAyah`, `currentToAyah`, `currentGrade` (int, nullable), `currentSurahJuz: surahJuzRef` — lines 29-32
- Madi track: `revisionFromAyah`, `revisionToAyah`, `revisionGrade`, `revisionSurahJuz` — lines 33-36
- CHECK constraints `home_work_current_grade_check` (`0..100`) and matching revision check — lines 47-48 (`check("home_work_current_grade_check", sql\`${t.currentGrade} >= 0 AND ${t.currentGrade} <= 100\`)`)
- `createdAt`/`updatedAt` server-managed.

Surah/Juz enum (Decision ref B.11): `backend/enum/shared/surah-juz-ref.enum.ts:9-42` — `SurahJuzRef` with exactly 35 members: `SurahAlFatihah..SurahAlMaidah` (5 surahs: `surah_al_fatihah`, `surah_al_baqarah`, `surah_aal_imran`, `surah_an_nisa`, `surah_al_maidah`) then `Juz1..Juz30` (`juz_1`..`juz_30`). Fail-closed type guard `isSurahJuzRef(value): value is SurahJuzRef` at `backend/enum/shared/surah-juz-ref.enum.ts:49`.

`progress` table (`backend/db/schema/classes/progress.ts:19-33`): only `id`, `studentId` (NOT NULL, cascade), `lessonId` (nullable, set-null), `createdAt`, `updatedAt` — **NO `completed_at`, NO `score` columns** (comment at `backend/db/schema/classes/progress.ts:15`). Surah/Juz progress is therefore derivable only via `home_work.current_surah_juz`/`revision_surah_juz`, not from `progress`.

## 3. (b) Parent monitoring service — the closest functional analogue

### 3.1 `ParentMonitoringService` namespace — `backend/services/parents/parent-monitoring.service.ts:159`

| Method | Exact signature | Aggregations / data |
|---|---|---|
| `listLinkedChildren` (`:178`) | `(parentActorId: number, locale: string, outerTx?: DBTransaction): Promise<ParentLinkedChildReturnType[]>` | `StudentRepository.listLinkedChildrenByParentId` |
| `getChildProgress` (`:210`) | `(parentActorId: number, studentId: number, locale: string, outerTx?: DBTransaction): Promise<ParentChildProgressReturnType>` | progress row COUNT + latest Jadid/Madi curriculum positions (see below) |
| `listChildSessions` (`:255`) | `(parentActorId, studentId, page: ParentPageInput \| undefined, locale, outerTx?) => Promise<ParentAttendancePageReturnType>` | attendance entries from session rows |
| `listChildReports` (`:293`) | `(parentActorId, studentId, page, locale, outerTx?): Promise<ParentReportPageReturnType>` | `ReportRepository.listForStudent` + `countForStudent` |
| `listChildHomework` (`:334`) | `(parentActorId, studentId, page, locale, outerTx?): Promise<ParentHomeworkPageReturnType>` | `HomeWorkRepository.listForStudent` + `countForStudent` (Jadid/Madi track blocks) |
| `getSessionTarget` (`:382`) | `(parentActorId, sessionId, locale, outerTx?): Promise<ParentSessionTargetReturnType>` | notification deep-link id pair |
| `listChildrenUpcomingSessions` (`:449`) | `(parentActorId, page, locale, outerTx?): Promise<ParentChildUpcomingBlockReturnType[]>` | per-child "what's next" card |

`getChildProgress` internals (`backend/services/parents/parent-monitoring.service.ts:212-232`): `requireActor(parentActorId, UserRole.Parent, locale, outerTx, false)` → repeatable-read `withTransaction` → `requireLinkedChild` gate FIRST → `ProgressRepository.countForStudent` → `HomeWorkRepository.findLatestByStudentId` → `composeChildProgress(student, childUser, progressRowCount, latestHomeWork)`.

### 3.2 Shared plumbing (directly reusable for an admin-wide view)

- `runGatedPagedRead<TRepo, TEntry>(…)` — private generic pipeline (actor re-check → rate limit → one tx → link gate → list+count Promise.all → mapper) at `backend/services/parents/parent-monitoring.service.ts:119`.
- `enforcePortalRateLimit(parentActorId, locale)` — `backend/services/parents/parent-monitoring.service.ts:144`.

### 3.3 `parent-monitoring.helpers.ts` exports — `backend/services/parents/parent-monitoring.helpers.ts`

| Helper | Exact signature | Citation |
|---|---|---|
| `clampPageInput` | `(input: ParentPageInput \| undefined): { … page, pageSize, offset }` | `:84` |
| `requireLinkedChild` | `(parentActorId: number, studentId: number, locale: string, tx: DBQueryExecutor \| undefined): Promise<StudentSelectType>` | `:177` |
| `mapSessionToAttendanceEntry` | `(row: SessionSelectType): ParentAttendanceEntryReturnType` | `:223` |
| `mapSessionToUpcomingEntry` | `(row: SessionSelectType): ParentChildUpcomingSessionReturnType` | `:245` |
| `mapReportRowToEntry` | `(row: ReportForStudentRow): ParentReportEntryReturnType` | `:262` |
| `mapHomeWorkRowToEntry` | `(row: HomeWorkSelectType): ParentHomeworkEntryReturnType` | `:312` |
| `composeChildProgress` | `(student: StudentSelectType, childUser: UserSelectType, progressRowCount: number, latestHomeWork: HomeWorkSelectType \| null): ParentChildProgressReturnType` | `:364` |

Internal but pattern-relevant: `toSurahJuzRef` (fail-closed enum coercion, `:138`) and `composeHomeworkPosition(row, surahJuz, fromAyah, toAyah): ParentHomeworkPositionReturnType | null` (`:334`) — emits a curriculum position only when a surah/juz ref exists; generalizable verbatim for an admin per-student position card.

**Reusable/generalizable notes**: the parent portal already computes (a) Jadid/Madi grade-bearing homework pages, (b) latest surah/juz position per track, (c) report (notes+rating) pages, (d) attendance pages — but always single-student, parent-link-gated, and paged per child. An admin view needs the SAME read shapes minus the link gate, plus cross-student aggregation (averages, low-grade flags, ranking) that the portal does not compute.

## 4. (c) Admin services — gate, guards, directory, analytics, user-management patterns

### 4.1 Admin auth enforcement (how non-admins get 403-equivalent)

`backend/services/admin/admin-gate.helpers.ts`:

| Export | Exact signature | Behavior | Citation |
|---|---|---|---|
| `toAuditActionType` | `(raw: string): AuditActionType \| null` | fail-closed enum coercion | `:25` |
| `resolveAdminActorRow` | `(actorId: number, locale: string, outerTx?: DBTransaction): Promise<UserSelectType>` | anonymous (`actorId === 0` sentinel) → `UnauthorizedError`; missing actor or role ≠ `UserRole.Admin` → `ForbiddenError`; both logged via ONE `logDomainError` | `:64` |
| `assertActorAdmin` | `(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>` | BFLA gate — delegates to `resolveAdminActorRow` | `:114` |
| `assertActorAdminActive` | `(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>` | BFLA + governance (deleted → blocked → suspended order) | `:133` |

`backend/services/admin/admin-guards.helpers.ts`: re-exports `assertActorAdmin` (`:35`) and adds `assertActiveActorAdmin(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>` (`:67`). Pattern used by every admin service: **gate is the FIRST statement, before any transaction opens** (e.g. `platform-analytics.service.ts:135`, `student-directory.service.ts:105`).

### 4.2 `AdminStudentDirectoryService` — `backend/services/admin/student-directory.service.ts:87`

```ts
// :96
export async function list(
  filters: AdminStudentFiltersSubmitInput,
  page: number,
  pageSize: number | undefined,
  locale: string,
  actorId: number,
  outerTx?: DBTransaction
): Promise<AdminStudentPageReturnType>
```
- `assertActorAdmin(actorId, locale, outerTx)` first (`:105`); `resolvePageBounds(page, pageSize, locale)` throws `VALIDATION` on out-of-range (pre-DB, `1..100` pageSize, default 25 — header doc `:88-94`); `normalizeFilters(filters)` then `StudentRepository.listDirectory(normalized, resolvedPageSize, offset, outerTx)` returning `{ rows, total }`; rows mapped via `mapStudentDirectoryRow`; envelope `{ items, total, page, pageSize, pageCount }` (`:107-116`).
- `exportAll(filters, locale, actorId, outerTx?)` — first 1000 (`EXPORT_MAX_ROWS`) filtered rows, same filter path, honest `truncated` flag (`:134`, header doc `:118-127`).
- Mapper: `mapStudentDirectoryRow(row: AdminStudentDirectoryRow): AdminStudentItemReturnType` — `backend/services/admin/student-directory.mappers.ts:19`.

### 4.3 `PlatformAnalyticsService` — dashboard aggregation pattern

`backend/services/admin/platform-analytics.service.ts:117` (namespace), method at `:129`:
```ts
export async function getPlatformAnalytics(
  actorId: number,
  locale: string,
  outerTx?: DBTransaction
): Promise<PlatformAnalyticsReturnType>
```
Pipeline (all confirmed at `:135-158`): `assertActorAdminActive` FIRST → one `withTransaction` capturing a single `now` → ONE `Promise.all` over 11 repository reads (`AdminUserRepository.getStats`, `PlatformAnalyticsRepository.countRecentlyActiveUsers/getSessionStats/getSessionDailyTrend/getRevenueStats/getRevenueDailyTrend/getSubscriptionStats/countOfflineActivations/getTeacherPresenceStats/getRatingStats/getHealthIndicators`) → sparse daily trend rows zero-filled onto a 30-day UTC skeleton by pure helpers. Zero writes, zero audit rows on read. **This is the template for an "academic advancement statistics" snapshot** — but note it currently has NO homework/grade/progress reads (none of the 11 repo calls touch `home_work`/`reports`/`progress`).

### 4.4 `AdminUserManagementService` — filters/pagination pattern

`backend/services/admin/user-management.service.ts:96` (namespace). Read methods:
- `listDirectory(filters: AdminUserFiltersSubmitInput, page: number, pageSize: number | undefined, locale: string, actorId: number, outerTx?: DBTransaction): Promise<AdminUserPageReturnType>` (`:106`) — gate → `resolvePageBounds` → `normalizeFilters` → `Promise.all([AdminUserRepository.listDirectory(normalized, resolvedPageSize, offset, outerTx), AdminUserRepository.countDirectory(normalized, outerTx)])` → `mapDirectoryRow(row, locale)` → `{ items, totalCount, page, pageSize }` (`:112-129`).
- `getStats(locale, actorId, …)` — directory-wide counters, one aggregate round-trip (`:148`); `getUserActivity` (`:182`); `getUserDetail` (`:221`). Writes: `createUser` `:261`, `updateUser` `:331`, `setUserDeleted` `:382`, `setUserSuspended` `:399`, `setUserBlocked` `:424`.

### 4.5 Admin GraphQL query surface (where the new surface would slot in)

`backend/graphql/query/admin/` contains only: `admin-finance.query.ts`, `admin-students.query.ts`, `admin-teacher-applicants.query.ts`, `admin-teachers.query.ts`, `admin-users.query.ts`, `audit-trail.query.ts`, `platform-analytics.query.ts` (`ls` verified). No academic-tracking query file exists.

## 5. (d) Canonical types in `backend/types/`

| Type | File:line | Shape highlights |
|---|---|---|
| `ReportSelectType` / `ReportInsertType` | `backend/types/classes/report.types.ts:4,5` | `typeof reports.$inferSelect/Insert` |
| `ReportReturnType` | `backend/types/classes/report.types.ts:14` | row-shaped consumer contract, identical to Select |
| `HomeWorkGradeFieldsInput` | `backend/types/classes/report.types.ts:21` | `{ currentGrade: number; revisionGrade: number }` (each 0..100) |
| `HomeWorkBlockInput` | `backend/types/classes/report.types.ts:29` | `{ fromAyah: number; toAyah: number; surahJuz: SurahJuzRef }` |
| `HomeWorkAssignInput` | `backend/types/classes/report.types.ts:37` | `{ jadid?: HomeWorkBlockInput; madi?: HomeWorkBlockInput }` — the two named tracks |
| `SessionReportSubmitInput` | `backend/types/classes/report.types.ts:47` | `{ teacherNotes: string; studentRatingByTeacher: number; homework?: HomeWorkAssignInput; previousGrades?: HomeWorkGradeFieldsInput }` (client whitelist only) |
| `HomeWorkSelectType` / `HomeWorkInsertType` / `HomeWorkReturnType` | `backend/types/classes/home-work.types.ts:3,4,14` | `$inferSelect`/`$inferInsert`; Return identical to Select |
| `StudentHomeworkPageInput` | `backend/types/classes/home-work.types.ts:27` | `{ page?: number; pageSize?: number }` |
| `StudentHomeworkPageReturnType` | `backend/types/classes/home-work.types.ts:38` | `{ items: readonly HomeWorkReturnType[]; totalCount; page; pageSize }` |
| `ParentHomeworkTrackReturnType` | `backend/types/parents/parent-monitoring.types.ts:112` | `{ surahJuz: SurahJuzRef \| null; fromAyah: number \| null; toAyah: number \| null; grade: number \| null }` — one Jadid-or-Madi projection |
| `ParentHomeworkEntryReturnType` | `backend/types/parents/parent-monitoring.types.ts:127` | `{ id; sessionId; jadid: ParentHomeworkTrackReturnType \| null; madi: … \| null; createdAt }` |
| `ParentHomeworkPositionReturnType` | `backend/types/parents/parent-monitoring.types.ts:156` | `{ surahJuz: SurahJuzRef; fromAyah: number \| null; toAyah: number \| null }` |
| `ParentChildProgressReturnType` | `backend/types/parents/parent-monitoring.types.ts:174` | child echo + `progressRowCount` + `latestJadidPosition` + `latestMadiPosition` (composed in `composeChildProgress`, helpers `:364`) |
| Other parent page shapes | `backend/types/parents/parent-monitoring.types.ts:15,29,45,62,81,96,140,188,204,222` | `ParentPageInput`, `ParentLinkedChildReturnType`, `ParentAttendanceEntry/PageReturnType`, `ParentReportEntry/PageReturnType`, `ParentHomeworkPageReturnType`, `ParentSessionTargetReturnType`, `ParentChildUpcomingSessionReturnType`, `ParentChildUpcomingBlockReturnType` |
| `AdminStudentFiltersSubmitInput` | `backend/types/admin/admin-student-directory.types.ts:28` | `{ search?: string \| null; hasParent?: boolean \| null; language?: string \| null }` — absent members drop out (ANDed) |
| `AdminStudentItemReturnType` / `AdminStudentExportEnvelopeReturnType` / `AdminStudentPageReturnType` | `backend/types/admin/admin-student-directory.types.ts:49,77,90` | safe users columns + students projection + linked-parent identity; page envelope echoes resolved pagination |
| `PlatformAnalyticsReturnType` | `backend/types/admin/platform-analytics.types.ts:150` | `{ generatedAt; users; sessions; revenue; subscriptions; teachers; ratings; health; sessionTrendDaily; revenueTrendDaily }` — NO academic/grade section |
| `AdminUserSafeSelect` etc. | `backend/types/admin/admin-user.types.ts:18,36,64,91` | `Omit<UserSelectType, "passwordHash">` convention |
| `DBTransaction` / `DBQueryExecutor` | `backend/types/db.types.ts:23,30` | `DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]`; `DBQueryExecutor = DBTransaction \| Pool \| PoolClient`; re-exported via `@/backend/types` (types AGENTS rule `backend/types/AGENTS.md:56`) |

No `progress` types file exists in `backend/types/` (grep for `Progress` across `backend/types/` matches only `parent-monitoring.types.ts:163,174`) — the `progress` table currently has no canonical Select/Insert/Return types, and `ProgressRepository` exposes only `countForStudent` (`backend/db/repo/classes/progress.repository.ts:38,58`).

## 6. (e) `backend/services/AGENTS.md` rules relevant to adding a new admin service

From `backend/services/AGENTS.md:1-10` (read in full):
- **Domain-driven, no monoliths**: construct services per domain concern; no generic `DashboardService`-style catch-all (lines 3-4) — an academic-tracking service should be one focused domain service (or namespace), not an umbrella.
- **Business logic hub**: orchestration + permission gating lives here, above the repository layer (line 5).
- **SSR-safe**: services are called directly by Server Components/Actions; no GraphQL-context reliance (line 6).
- **i18n mandatory**: every user-facing message via `getServerTranslations(locale, "<namespace>")` from `@/shared/locale/server-graphql`; hardcoded exception strings forbidden (line 7).
- **Types from `@/backend/types` only**: `{Entity}ReturnType`, `{Entity}SubmitInput`, `DBTransaction`; **service-layer `.types.ts` files are prohibited** — split runtime code into `.helpers.ts`/`.constants.ts` (lines 8-9).
- **DataLoader batching**: services called from GraphQL field resolvers must expose batch versions of single-entity lookups (line 10, truncated in read but stated).
- Established idiom observed in this layer: namespace-wrapped bare `export async function` members (`AdminStudentDirectoryService`, `PlatformAnalyticsService`, `ParentMonitoringService`) OR bare exported functions (`submitSessionReport`); admin services always take `(…, locale, actorId, outerTx?)` and start with `assertActorAdmin*`.

## 7. Reusability map for the new admin academic view

| Existing asset | Reuse mode |
|---|---|
| `HomeWorkRepository.listForStudent/countForStudent/findLatestByStudentId` (`backend/db/repo/classes/home-work.repository.ts:232,293,142`) | per-student drill-down reads work as-is |
| `ReportRepository.listForStudent/countForStudent` (`backend/db/repo/classes/report.repository.ts:186,241`) | report history per student |
| `SessionRepository.listForStudent/countForStudent` | attendance context per student |
| `ProgressRepository.countForStudent` (`backend/db/repo/classes/progress.repository.ts:58`) | honest progress-row signal |
| `mapHomeWorkRowToEntry`, `mapReportRowToEntry`, `composeHomeworkPosition`, `toSurahJuzRef` (`parent-monitoring.helpers.ts:312,262,334,138`) | projection logic generalizable; a new admin mapper can mirror these (helpers are parent-domain module; admin service should have its own `.helpers.ts` per AGENTS, possibly calling the repo directly) |
| `assertActorAdmin` / `assertActorAdminActive` (`admin-gate.helpers.ts:114,133`) | 403 enforcement for the new surface — drop-in |
| `PlatformAnalyticsService.getPlatformAnalytics` snapshot pattern (`platform-analytics.service.ts:129`) | template for platform-wide academic advancement stats (single `now`, one tx, Promise.all of repo aggregates) |
| `AdminUserManagementService.listDirectory` filter/pagination pattern (`user-management.service.ts:106`) | template for an all-students academic listing with filters + honest page envelope |
| `resolvePageBounds` (throws VALIDATION) vs `clampPageInput` (clamps) | admin listing convention throws on bad bounds (`student-directory.service.ts:88-94,107`); portal clamps — pick the admin convention for a dashboard filter surface |

## 8. GAPS (verified NOT to exist)

Verified absence via searches this session:

1. **No academic-tracking service of any kind**: `grep -rni "academic" backend/ frontend/ app/` returned ZERO files; `AdminAcademic`/`admin-academic` matches nothing repo-wide.
2. **No admin service reads homework/reports**: no file under `backend/services/admin/` imports `HomeWorkRepository` or `ReportRepository` (grep over the directory returned no matches).
3. **No admin GraphQL academic query**: `backend/graphql/query/admin/` contains only finance/students/teacher-applicants/teachers/users/audit-trail/platform-analytics queries.
4. **No cross-student homework/grade aggregation repository**: `HomeWorkRepository` has only per-session/per-student methods (`insertHomeWork`, `findBySessionId`, `findLatestByStudentId`, `gradeHomeWorkOnce`, `listForStudent`, `countForStudent` — `backend/db/repo/classes/home-work.repository.ts:74,94,142,185,232,293`); no list-all, no AVG/grade aggregates, no admin filters.
5. **No grade averaging / low-grade flagging anywhere**: `currentGrade`/`revisionGrade` appear only in the write path (`session-report.service.ts`, `session-report.guards.ts`) and the parent mappers (`parent-monitoring.helpers.ts`) — no service or repo computes averages, thresholds, or "students needing attention" from grades. (The only `needsAttention` flag in the repo is SESSION-lifecycle — disputed status or lapsed confirmation deadline — `backend/db/repo/classes/session.repository.helpers.ts:198-200`, purely presentation, not grade-based.)
6. **No "slow progress" analysis**: no service derives progress velocity or stagnation; `progress` table itself stores no score/completed_at (`backend/db/schema/classes/progress.ts:15`), and `ProgressRepository` exposes only `countForStudent` (`backend/db/repo/classes/progress.repository.ts:58`) — no list, no joins, no windowing.
7. **No canonical progress types**: no `progress.types.ts` in `backend/types/classes/` (directory listing verified); `Progress` matches only parent-monitoring types.
8. **No admin per-student academic drill-down**: parent portal (`ParentMonitoringService`) and teacher history (`listStudentHomeworkHistory`) are the only full-history reads, both role-gated to non-admin callers with link/teacher gates; an admin variant must be new.
9. **PlatformAnalyticsReturnType has no academic section** (`backend/types/admin/platform-analytics.types.ts:150`): users/sessions/revenue/subscriptions/teachers/ratings/health/trends only — no grades, homework, or memorization fields.

## 9. Path corrections to the brief

- All paths in the brief resolved as stated (`backend/services/classes/session-report.service.ts`, `student-homework.service.ts`, `student-homework.helpers.ts`, `session-report.guards.ts`, `backend/services/parents/parent-monitoring.{service,helpers}.ts`, `backend/services/admin/admin-gate.helpers.ts`, `admin-guards.helpers.ts`, `student-directory.{service,mappers}.ts`, `platform-analytics.service.ts`, `user-management.service.ts`). No corrections needed.
- Note: ticket text says homework lives "on the `home_work` table" — correct; the Jadid track is stored in `current_*` columns and Madi in `revision_*` columns (`backend/db/schema/classes/home-work.ts:12-13`), while the API/type vocabulary names them `jadid`/`madi` (`backend/types/classes/report.types.ts:37`). Any new admin surface should expose Jadid/Madi naming (like the parent portal does) while reading `current_*`/`revision_*` columns.
