# Research: Repository layer — Admin Academic Tracking (Memorization & Revision Milestones)

Scope: exported methods (exact signatures, file:line), aggregate vs row-return classification, pagination & filtering support in `backend/db/repo/classes/` (home-work, report, progress, session + session.repository.lifecycle.helpers.ts), plus `backend/db/repo/admin/` and `backend/db/repo/students/` admin directories; repo AGENTS.md mandatory rules; verified gaps.

All line numbers personally confirmed via Grep/Read this session (2026-09-21).

## 0. Path corrections / confirmations

- All five brief-named files exist under `backend/db/repo/classes/`: `home-work.repository.ts`, `report.repository.ts`, `progress.repository.ts`, `session.repository.ts`, `session.repository.lifecycle.helpers.ts` (confirmed via `ls`).
- `backend/db/repo/admin/` and `backend/db/repo/students/` both exist. `admin/` holds `admin.repository.ts`, `admin-user.repository.ts`, `platform-analytics.repository.ts` (+ query-helper modules); `students/` holds `student.repository.ts` + 4 helper modules.
- Blocker "Session Report Submission with Homework (Jadid & Madi)" IS already implemented at repo+service level: `HomeWorkRepository.insertHomeWork`/`gradeHomeWorkOnce` (home-work.repository.ts:74,185), `ReportRepository.insertReport` (report.repository.ts:99), and services `backend/services/classes/session-report.service.ts` + `backend/services/classes/student-homework.service.ts` exist (confirmed via `ls backend/services/classes/`).

## 1. HomeWorkRepository — backend/db/repo/classes/home-work.repository.ts

Table `home_work`: one row per session (`session_id` NOT NULL UNIQUE `home_work_session_id_unique`, home-work.repository.ts header doc lines 4–10). Jadid = `current_*` columns; Madi = `revision_*` columns. Grades are nullable integers in [0,100] (schema CHECKs `home_work_current_grade_check`, `home_work_current_revision_grade_check`; backend/db/schema/classes/home-work.ts:38–40).

| Method | Exact signature | Line | Returns |
|---|---|---|---|
| insertHomeWork | `export async function insertHomeWork(insert: HomeWorkInsertType, tx?: DBTransaction): Promise<HomeWorkSelectType>` | 74 | single row (INSERT…RETURNING) |
| findBySessionId | `export async function findBySessionId(sessionId: number, tx?: DBTransaction): Promise<HomeWorkSelectType \| null>` | 94 | single row or null |
| findLatestByStudentId | `export async function findLatestByStudentId(studentId: number, tx?: DBTransaction): Promise<HomeWorkSelectType \| null>` (multi-line 142–145) | 142 | latest single row (ORDER BY created_at DESC, id DESC LIMIT 1) |
| gradeHomeWorkOnce | `export async function gradeHomeWorkOnce(id: number, grades: HomeWorkGradeFieldsInput, tx?: DBTransaction): Promise<HomeWorkSelectType \| null>` (multi-line 185–189) | 185 | guarded one-shot UPDATE (requires BOTH grades NULL); null on zero rows |
| listForStudent | `export async function listForStudent(studentId: number, limit: number, offset: number, tx?: DBTransaction): Promise<HomeWorkSelectType[]>` (multi-line 232–237) | 232 | paged rows, offset pagination |
| countForStudent | `export async function countForStudent(studentId: number, tx?: DBTransaction): Promise<number>` | 293 | aggregate count |

Key facts:
- **Single-student tenancy only**: every read joins `session` with `session.student_id = $studentId` fused into the JOIN ON (shared builder `buildParentScopedHomeWorkJoinCondition(studentId)`, home-work.repository.ts:56). No method accepts a list of students or omits the studentId scoping.
- **Pagination**: plain `LIMIT $ / OFFSET $` (listForStudent raw branch, home-work.repository.ts:262–268); ordering `session.started_at DESC NULLS LAST, home_work.id DESC` (line 256, 265). No cursor pagination anywhere in this repo.
- **Dual read arms**: `tx` → Drizzle select; standalone → raw parameterized SQL via `queryDb` (Neon-HTTP-eligible pattern) — same shape via column aliases (e.g. lines 155–167).
- **Filtering support**: by studentId only. NO date-range filter, NO grade-threshold filter, NO surah/juz filter, NO ungraded-only filter.
- Writes execute on `tx ?? db` (gradeHomeWorkOnce, line 190).

## 2. ReportRepository — backend/db/repo/classes/report.repository.ts

`reports` table: `teacher_notes` + optional `student_rating_by_teacher` int [0,5]; one per session (`reports_session_id_unique`, report.repository.ts header lines 3–11). No teacher column — author reached via session.

| Method | Exact signature | Line | Returns |
|---|---|---|---|
| insertReport | `export async function insertReport(insert: ReportInsertType, tx?: DBTransaction): Promise<ReportSelectType>` | 99 | single row (INSERT…RETURNING) |
| findBySessionId | `export async function findBySessionId(sessionId: number, tx?: DBTransaction): Promise<ReportSelectType \| null>` | 121 | single row or null |
| existsReportForSession | `export async function existsReportForSession(sessionId: number, tx?: DBTransaction): Promise<boolean>` | 151 | EXISTS probe |
| listForStudent | `export async function listForStudent(studentId: number, limit: number, offset: number, tx?: DBTransaction): Promise<ReportForStudentRow[]>` (multi-line 186–191) | 186 | paged rows, offset pagination |
| countForStudent | `export async function countForStudent(studentId: number, tx?: DBTransaction): Promise<number>` | 241 | aggregate count |

- `ReportForStudentRow` is defined in-file (report.repository.ts:55–63): `id`, `sessionId`, `teacherNotes`, `studentRatingByTeacher`, `createdAt`, `updatedAt`, plus joined `sessionStatus`, `sessionStartedAt`.
- Same single-student JOIN tenancy builder (`buildParentScopedReportJoinCondition`, report.repository.ts:67 area; used at 245–246, 254).
- **Filtering**: by studentId only. No date range, no rating-threshold, no cross-student listing.
- **Pagination**: LIMIT/OFFSET only; same session-stamp-first ordering discipline as homework (header doc).

## 3. ProgressRepository — backend/db/repo/classes/progress.repository.ts

| Method | Exact signature | Line | Returns |
|---|---|---|---|
| countForStudent | `export async function countForStudent(studentId: number, tx?: DBQueryExecutor): Promise<number>` | 58 | aggregate count |

- The ENTIRE repository is one method. It counts `progress` rows by `student_id` equality riding `progress_student_id_idx` (progress.repository.ts:43–58).
- Takes `DBQueryExecutor` (not `DBTransaction`): narrows via local type guard `isDBTransaction` (lines 34–36) and has THREE arms: tx (Drizzle count), Pool/PoolClient (raw SQL through the supplied executor), standalone (`queryDb`) — lines 58–84.
- **Schema fact (decision-relevant)**: `progress` has ONLY `id`, `student_id` (NOT NULL, cascade), `lesson_id` (nullable, set-null), `created_at`, `updated_at` — NO `completed_at`, NO `score`, NO surah/juz column (backend/db/schema/classes/progress.ts:27–40, docblock lines 10–11). Surah/Juz progress cannot be computed from `progress` alone; it must be derived from `home_work`/`session` data.

## 4. SessionRepository — backend/db/repo/classes/session.repository.ts (868 lines)

Namespace `SessionRepository`. Methods (exact signatures; multi-line ones reproduced):

| Method | Exact signature | Line |
|---|---|---|
| insertSession | `export async function insertSession(insert: SessionInsertType, tx?: DBTransaction): Promise<SessionSelectType>` | 121 |
| findById | `export async function findById(id: number, tx?: DBTransaction): Promise<SessionSelectType \| null>` | 140 |
| findWaveContextById | `export async function findWaveContextById(id: number, tx?: DBTransaction): Promise<SessionWaveContextRow \| null>` | 157 |
| startSessionOnce | `export async function startSessionOnce(id: number, teacherId: number, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 172–175) | 172 |
| completeSessionOnce | `export async function completeSessionOnce(id: number, teacherId: number, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 203–206) | 203 |
| cancelSessionOnce | `export async function cancelSessionOnce(id: number, participantId: number, cancelReason: string \| null, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 229–234) | 229 |
| openDisputeOnce | `export async function openDisputeOnce(id: number, participantId: number, disputeReason: string, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 260–264) | 260 |
| resolveDisputeCancelOnce | `export async function resolveDisputeCancelOnce(id: number, resolutionNote: string \| null, resolutionOutcome: DisputeResolution, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 292–296) | 292 |
| resolveDisputeCompleteOnce | `export async function resolveDisputeCompleteOnce(id: number, resolutionNote: string \| null, resolutionOutcome: DisputeResolution, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 354–358) | 354 |

| Method | Exact signature | Line |
|---|---|---|
| findTransitionProbe | `export async function findTransitionProbe(id: number, tx?: DBTransaction): Promise<SessionTransitionProbeRowType \| null>` (multi-line 412–415) | 412 |
| findRatingEligibilityProbe | `export async function findRatingEligibilityProbe(sessionId: number, tx: DBTransaction): Promise<SessionRatingEligibilityProbeType \| null>` (multi-line 431–434) — tx REQUIRED | 431 |
| lockForReportGate | `export async function lockForReportGate(sessionId: number, tx: DBTransaction): Promise<SessionTransitionProbeRowType \| null>` (multi-line 475–478) — tx REQUIRED | 475 |
| findReportWaveContextById | `export async function findReportWaveContextById(id: number, tx?: DBTransaction): Promise<SessionReportWaveContextRow \| null>` (multi-line 499–503) | 499 |
| confirmStudentCompletionOnce | `export async function confirmStudentCompletionOnce(id: number, studentUserId: number, tx?: DBTransaction): Promise<SessionSelectType \| null>` (multi-line 524–528) | 524 |
| sweepExpiredScheduledOnce | `export async function sweepExpiredScheduledOnce(now: Date, tx?: DBTransaction): Promise<SessionSelectType[]>` | 564 |
| sweepExpiredCompletedOnce | `export async function sweepExpiredCompletedOnce(now: Date, tx?: DBTransaction): Promise<SessionSelectType[]>` | 594 |
| listForStudent | `export async function listForStudent(studentId: number, filter: SessionListFilterInput, limit: number, offset: number, tx?: DBTransaction): Promise<SessionSelectType[]>` (multi-line 619–625) | 619 |
| listForTeacher | `export async function listForTeacher(teacherId: number, filter: SessionListFilterInput, limit: number, offset: number, tx?: DBTransaction): Promise<SessionSelectType[]>` (multi-line 634–640) | 634 |
| countForStudent | `export async function countForStudent(studentId: number, filter: SessionListFilterInput, tx?: DBTransaction): Promise<number>` (multi-line 649–654) | 649 |
| countForTeacher | `export async function countForTeacher(teacherId: number, filter: SessionListFilterInput, tx?: DBTransaction): Promise<number>` (multi-line 661–666) | 661 |
| listAdminDisputed | `export const listAdminDisputed = sessionRepositoryImpl.listAdminDisputed;` | 680 |
| countAdminDisputed | `export const countAdminDisputed = sessionRepositoryImpl.countAdminDisputed;` | 687 |
| listForAdmin | `export const listForAdmin = sessionRepositoryImpl.listAdminDirectoryPage;` | 711 |
| getAnyByIdForAdmin | `export async function getAnyByIdForAdmin(id: number, tx?: DBTransaction): Promise<AdminSessionDetail>` | 723 |
| guardReschedule | `export async function guardReschedule(...)` (line 743) | 743 |
| guardCancelPreTerminal | (line 771) | 771 |
| guardReassignTeacher | (line 778) | 778 |
| resolveCurrentEvaluationCycle | (line 797) | 797 |
| countEvaluationBookingsInCycle | (line 816) | 816 |
| listEvaluationSessionsForApplicant | (line 840) | 840 |
| existsSessionForTeacherStudent | `export const existsSessionForTeacherStudent = sessionRepositoryGateImpl.existsSessionForTeacherStudent;` | 867 |
| getDisputeAnalyticsCounts | re-export of `export async function getDisputeAnalyticsCounts(tx?: DBTransaction): Promise<AdminDisputeAnalyticsReturnType>` (session.repository.arbitration.helpers.ts:190) | 453 |

Delegated impl signatures (session.repository.helpers.ts):
- `async function listAdminDirectoryPage(filter: AdminSessionListFilterInput, page: number, pageSize: number, tx?: DBTransaction): Promise<{ rows: AdminSessionRowReturnType[]; total: number }>` — session.repository.helpers.ts:324–329.
- `async function listAdminDisputed(limit: number, offset: number, tx?: DBTransaction): Promise<SessionSelectType[]>` — helpers.ts:394.
- `async function countAdminDisputed(tx?: DBTransaction): Promise<number>` — helpers.ts:418.
- `async function countAdminDirectory(filter: AdminSessionListFilterInput, tx?: DBTransaction): Promise<number>` — helpers.ts:296.
- `async function listParticipantSessions(ownerColumn, ownerId, filter: SessionListFilterInput, limit, offset, tx?)` — helpers.ts:90–98.

**Admin session directory — the ONLY existing cross-student read with filters**:
- Filters: `AdminSessionListFilterInput` = `teacherUserId?`, `studentUserId?`, `type?`, `status?`, `dateFrom?`, `dateTo?` (half-open `created_at >= dateFrom AND created_at < dateTo`), `page?`, `pageSize?` — backend/types/classes/admin-session-governance.types.ts:98–107. Absent members drop out silently.
- Pagination: page/pageSize normalized (page<1→1, size outside 1..50→25; `MAX_PAGE_SIZE = 50`, `DEFAULT_PAGE_SIZE = 25`, helpers.ts:163–164) with a deep-pagination ceiling `MAX_DIRECTORY_SCAN_ROWS = 10_000` (helpers.ts:176) that returns an empty window + honest total.
- Participant lists filter shape is much narrower: `SessionListFilterInput` = `readonly status?: SessionStatus | null` only — backend/types/classes/session.types.ts:49–51.
- `AdminSessionRowReturnType` carries a derived `needsAttention: boolean`, but it is session-lifecycle ONLY (disputed row or scheduled row with lapsed confirmation deadline) — admin-session-governance.types.ts:149–156, computed at session.repository.helpers.ts:342. NOT academic.

## 5. session.repository.lifecycle.helpers.ts (61 lines)

Not part of the public API — extracted implementations bound one-to-one inside the `SessionRepository` namespace (header lines 1–9). One exported function:

- `export async function completeSessionOnce(id: number, teacherId: number, tx?: DBTransaction): Promise<SessionSelectType | null>` — session.repository.lifecycle.helpers.ts:41–44. Single guarded UPDATE fusing id + teacherId ownership + `status = Started` + teacher-approval `EXISTS` re-assertion; writes `status=Completed, endedAt, confirmedByTeacherAt, updatedAt` from one captured `now()` (lines 46–61). Writes on `tx ?? db`.

## 6. Admin & Students repo inventory

### backend/db/repo/admin/ (existing admin directories)

| Repository | Method | Exact signature | Line |
|---|---|---|---|
| AdminRepository | create | `export async function create(userId: number, tx: DBTransaction): Promise<AdminSelectType>` — tx REQUIRED | admin.repository.ts:19 |
| AdminUserRepository | listDirectory | `export async function listDirectory(filters: NormalizedAdminUserFilters, limit: number, offset: number, tx?: DBTransaction): Promise<AdminUserDirectoryRow[]>` (multi-line 119–124) | admin-user.repository.ts:119 |
| AdminUserRepository | countDirectory | `export async function countDirectory(filters: NormalizedAdminUserFilters, tx?: DBTransaction): Promise<number>` | admin-user.repository.ts:167 |
| AdminUserRepository | getStats | `export async function getStats(tx?: DBTransaction): Promise<AdminUserStatsRow>` | admin-user.repository.ts:198 |
| AdminUserRepository | getActivity | `export async function getActivity(userId: number, limit: number, tx?: DBTransaction): Promise<AdminUserActivityRow[]>` (multi-line 258–262) | admin-user.repository.ts:258 |
| AdminUserRepository | findDetailById | `export async function findDetailById(id: number, tx?: DBTransaction): Promise<AdminUserDetailRow \| null>` | admin-user.repository.ts:290 |
| AdminUserRepository | updateProfileFields | (line 340) | admin-user.repository.ts:340 |
| AdminUserRepository | setDeletedOnce | (line 375) | admin-user.repository.ts:375 |
| AdminUserRepository | existsById | `export async function existsById(id: number, tx?: DBTransaction): Promise<boolean>` | admin-user.repository.ts:409 |
| AdminUserRepository | setSuspendedOnce | (line 456) | admin-user.repository.ts:456 |
| AdminUserRepository | setBlockedOnce | (line 512) | admin-user.repository.ts:512 |
| AdminUserRepository | findGovernanceState | `export async function findGovernanceState(id: number, tx?: DBQueryExecutor): Promise<GovernanceProbeRowType \| null>` | admin-user.repository.ts:563 |
| PlatformAnalyticsRepository | countRecentlyActiveUsers | `export async function countRecentlyActiveUsers(now: Date, tx?: DBTransaction): Promise<number>` | platform-analytics.repository.ts:117 |
| PlatformAnalyticsRepository | getSessionStats | `export async function getSessionStats(now: Date, tx?: DBTransaction): Promise<PlatformAnalyticsSessionStatsRow>` | platform-analytics.repository.ts:163 |
| PlatformAnalyticsRepository | getSessionDailyTrend | `export async function getSessionDailyTrend(now: Date, tx?: DBTransaction): Promise<PlatformAnalyticsSessionTrendRow[]>` (multi-line 178–181) | platform-analytics.repository.ts:178 |
| PlatformAnalyticsRepository | getRevenueStats | `export async function getRevenueStats(now: Date, tx?: DBTransaction): Promise<PlatformAnalyticsCurrencyRevenueRow[]>` | platform-analytics.repository.ts:200 |
| PlatformAnalyticsRepository | getRevenueDailyTrend | `export async function getRevenueDailyTrend(now: Date, tx?: DBTransaction): Promise<PlatformAnalyticsRevenueTrendRow[]>` (multi-line 215–218) | platform-analytics.repository.ts:215 |
| PlatformAnalyticsRepository | getSubscriptionStats | `export async function getSubscriptionStats(now: Date, tx?: DBTransaction): Promise<PlatformAnalyticsSubscriptionStatsRow>` (multi-line 237–240) | platform-analytics.repository.ts:237 |
| PlatformAnalyticsRepository | countOfflineActivations | `export async function countOfflineActivations(tx?: DBTransaction): Promise<number>` | platform-analytics.repository.ts:305 |
| PlatformAnalyticsRepository | getTeacherPresenceStats | `export async function getTeacherPresenceStats(tx?: DBTransaction): Promise<PlatformAnalyticsTeacherPresenceRow>` | platform-analytics.repository.ts:320 |
| PlatformAnalyticsRepository | getRatingStats | `export async function getRatingStats(tx?: DBTransaction): Promise<PlatformAnalyticsRatingStatsRow>` | platform-analytics.repository.ts:366 |
| PlatformAnalyticsRepository | getHealthIndicators | `export async function getHealthIndicators(tx?: DBTransaction): Promise<PlatformAnalyticsHealthRow>` | platform-analytics.repository.ts:424 |

- `NormalizedAdminUserFilters` (admin-user-row-types.ts:49–54): `role?`, `governance?`, `country?`, `searchPattern?` — NO academic filters.
- PlatformAnalytics IS the existing cross-student/teacher aggregate precedent: uses `count(*) filter (where ...)` + `::int` casts and conditional aggregation via `sql<number>` (e.g. platform-analytics.repository.ts:242–245); rating averages only (`averageSessionRating` 0–5, `averageEvaluationScore`) with null-when-empty semantics (platform-analytics-query-helpers.ts:88–94). NOTHING aggregates homework Jadid/Madi grades.

### backend/db/repo/students/ (admin student directory)

- `StudentRepository.listDirectory(filters: NormalizedAdminUserFilters→NormalizedAdminStudentFilters, limit, offset, tx?)`: `export async function listDirectory(filters: NormalizedAdminStudentFilters, limit: number, offset: number, tx?: DBTransaction): Promise<{ rows: AdminStudentDirectoryRow[]; total: number }>` — student.repository.ts:510–516, delegating to directory helpers (student.repository.directory.helpers.ts:151–156).
- `NormalizedAdminStudentFilters` (directory.helpers.ts:56–60): `searchPattern?` (ilike over name OR email), `hasParent?`, `language?` (lower() exact match over primary OR secondary language) — NO academic/grade/progress filters.
- `AdminStudentDirectoryRow` (directory.helpers.ts:69–88): id, name, email, phone, country, `balanceHifz/balanceReviews/balanceTajweed/balanceTrial` (wallet lane balances), `trialGrantedAt`, languages, parent fields, `createdAt` — **NO academic columns** (no grade, no session count, no memorization data).
- Other student methods (student.repository.ts): `createForRegistration` (163), `findHandshakeCodeByStudentId` (198), `findDiscoveryByHandshakeCode` (234), `findById` (266), `findByIdForUpdate` (299), `grantFreeTrialOnce` (314), `findLinkTargetByHandshakeCode` (349), `linkParentIfUnlinked` (373), `decrementLaneIfAvailable` (387), `incrementLane` (416), `creditLaneBalance` (440), `setLaneBalanceValue` (473), `zeroLaneIfNoCoveringSubscription` (483), `listLinkedChildrenByParentId` (530).

## 7. Mandatory repo rules — backend/db/repo/AGENTS.md

Citations from backend/db/repo/AGENTS.md (read in full):
- **inArray + prepared statements PROHIBITED** (AGENTS.md:29): `inArray(col, sql.placeholder("ids"))` must never be prepared — PostgreSQL treats `$1` as a scalar; use dynamic queries instead.
- **Guarded transition writes** (AGENTS.md:30-31): state/ownership mutations are single-statement guarded UPDATEs with state/ownership in the WHERE + `RETURNING` — never SELECT-then-UPDATE; zero rows = miss signal, service disambiguates.
- **Query guidelines** (AGENTS.md:32): when `findMany` with relations yields `SQL<unknown>`/type errors, revert to `.select().from().leftJoin()` or manual ID-based mapping.
- **Separation of concerns** (AGENTS.md:33): repos = data access only; business logic/permissions/orchestration live in `backend/services/`.
- **No hardcoded error strings** (AGENTS.md:34): use `getServerTranslations(locale, "...")` from `@/shared/locale/server-graphql`.
- **Conditional aggregation** (AGENTS.md:35): `CASE WHEN`/`count(*) filter` via `sql<number>` template + `.mapWith(Number)`; avoid raw DB casts like `CAST(... AS INTEGER)` in SQL.
- **Type pattern** (AGENTS.md:36-37): use `backend/types/` types (`{Entity}SelectType`, `{Entity}InsertType`, `$inferSelect/$inferInsert`), never local type definitions.
- **Import conventions** (AGENTS.md:39-41): consumers import from the top-level barrel `@/backend/db/repo` (deep imports also valid); within a repo file, `@/` for cross-layer, relative only for siblings.
- **File organization** (AGENTS.md:43-47): one `namespace` per repo file named `{Entity}Repository`; helper modules co-located; add `export * from "./<entity>.repository";` to sub-dir `index.ts`.
- **Adding repos** (AGENTS.md:48-53): follow sub-dir convention, wired types in `backend/types/<subdir>/`, wired GraphQL in `backend/graphql/pothos/<subdir>/`.

Per-file conventions (from home-work.repository.ts header 18–31 and lifecycle.helpers header 13–20, consistent across the class repos):
- Every method takes `tx` as the LAST parameter; reads use caller's tx when supplied, otherwise raw parameterized SQL via `queryDb` (Neon-HTTP-eligible); writes on `tx ?? db`.
- No prepared statements, no array-membership operators, no SQL line-comment sequences.
- No business logic, no permission checks, no i18n/logging inside repos.

Type locations: `DBTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0]` (backend/types/db.types.ts:23); `DBQueryExecutor = DBTransaction | Pool | PoolClient` (backend/types/db.types.ts:30).

## 8. Testing rules (repo tests) — backend/db/test/AGENTS.md

- Every DB test MUST run inside `runInRollback` from `./test-utils` (backend/db/test/AGENTS.md:19–20).
- Pass `tx` to ALL repository methods AND direct Drizzle queries; mixing `tx` queries with `db`-backed repo calls causes deadlocks and state pollution (AGENTS.md:22).
- NEVER `expect(...).rejects.toThrow()` inside `runInRollback` — deadlocks/timeouts; use try/catch helper pattern (AGENTS.md:31).
- Never query seed data; create test data via `entity-setup.ts` helpers inside the rollback transaction (AGENTS.md:103).
- Hard-delete any records inserted outside `runInRollback` in `afterAll` (AGENTS.md:72).

## 9. Supporting schema facts

- `home_work` columns (backend/db/schema/classes/home-work.ts:27–42): `id`, `session_id` (NOT NULL, unique, cascade), `current_from_ayah`, `current_to_ayah`, `current_grade`, `current_surah_juz`, `revision_from_ayah`, `revision_to_ayah`, `revision_grade`, `revision_surah_juz`, `created_at`, `updated_at`. Grade CHECKs [0,100]; surah/juz columns are `surahJuzRef` enums.
- `surah_juz_ref` enum (backend/db/schema/enums.ts:112) has 38 members: `surah_al_fatihah`, `surah_al_baqarah`, `surah_aal_imran`, `surah_an_nisa`, `surah_al_maidah`, `juz_1` … `juz_30` (decision ref B.11).
- `progress` has NO score/completed_at columns (see §3) — "progress" milestones must come from homework/session/lesson data, not the `progress` table.
- Existing classes/ repos NOT in the brief's list: `lesson.repository.ts`, `recitation.repository.ts`, `session-request-idempotency.repository.ts` (plus gate/evaluation/arbitration/wave helper modules) — out of scope here but relevant neighbors for a drill-down.

## GAPS (verified NOT to exist)

Absence confirmed by full export inventories (grep of every `export async function|export function|export const` in the covered repos) plus targeted searches (`avg|average|gradeThreshold|lowGrade|needsAttention|belowThreshold` across `backend/db/repo/` — only rating-average hits in platform-analytics and the session-lifecycle `needsAttention` badge).

1. **No cross-student homework listing**: `HomeWorkRepository` has no method that lists homework for all/many students — every read is scoped to one `studentId` (or one `sessionId`); there is no `listForAdmin`/`listAll`/batch variant (home-work.repository.ts:74–309, full export list).
2. **No Jadid/Madi grade averages anywhere**: no `AVG(current_grade)` / `AVG(revision_grade)` per student or global exists in any repo (grep over backend/db/repo found averages only for session ratings 0–5 and evaluation scores — platform-analytics.repository.ts:366, platform-analytics-query-helpers.ts:88–94).
3. **No grade-threshold / low-grade queries**: no repo method filters `current_grade < X` or `revision_grade < X`; no "students needing attention" academic query. The only `needsAttention` is the session dispute/deadline badge (admin-session-governance.types.ts:149–156), unrelated to academics.
4. **No "latest milestone per student" cross-student query**: `findLatestByStudentId` works for exactly one student (home-work.repository.ts:142); no per-student-latest (window function / DISTINCT ON) bulk query exists.
5. **No date-range filtering on homework/reports**: date-window filtering exists only on the admin session directory (`created_at` half-open window, admin-session-governance.types.ts:98–107); `HomeWorkRepository`/`ReportRepository` list methods accept only studentId+limit+offset.
6. **No surah/juz progress aggregation**: no repo method aggregates `current_surah_juz`/`revision_surah_juz` (e.g. count/coverage per student); the `progress` table cannot back this either (no score/completed columns, progress schema lines 10–11, 27–40).
7. **No per-student academic drill-down repo**: admin student directory (`AdminStudentDirectoryRow`, student.repository.directory.helpers.ts:69–88) exposes wallet-lane balances and parent info only — no grades, no homework history, no session academic stats; `SessionRepository.getAnyByIdForAdmin` (session.repository.ts:723) is session-scoped only.
8. **No academic cross-student stats dashboard repo**: `PlatformAnalyticsRepository` covers sessions/revenue/subscriptions/ratings/health (platform-analytics.repository.ts:117–424) but nothing touching homework grades or memorization/revision advancement.
9. **No pagination precedent beyond offset**: every paged method is LIMIT/OFFSET (homework listForStudent home-work.repository.ts:262–268; admin directory page/pageSize→offset with 10k scan ceiling, session.repository.helpers.ts:163–176, 324–342). No cursor pagination exists to copy.
10. **Consequence for the plan**: a new admin academic-tracking read surface needs new repo methods (likely `HomeWorkRepository.listForAdmin`/`listGradesForStudent`/aggregate stats, per-student averages, low-grade thresholds, latest-milestone-per-student). `PlatformAnalyticsRepository.getRatingStats` (platform-analytics.repository.ts:366) and `getSubscriptionStats` (237) are the in-repo patterns to follow for conditional aggregation (`count(*) filter` + `sql<number>` + `.mapWith(Number)`), and `session.repository.helpers.ts` (listAdminDirectoryPage + shared predicate builders, lines 296–342) is the pattern for a filterable, paged admin directory with honest totals.
