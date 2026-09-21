# Technical Architecture & Implementation Design: Admin Academic Tracking (Memorization & Revision Milestones)

**Plan directory (verbatim):** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/`
**Plan path:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/plan.md`
**Specs:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/specs.md`
**Tasks:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/tasks.md` (Phase 3)
**Deferred-items ledger:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`

## Document Information

- **Ticket**: `docs/planning/TICKETS.md:2184-2217` — Milestone **M3**, Owner Stream Dev 2, 3 SP; Decision Refs B.11 + FR-6.3 (bridged by specs R-A, §7.4); blocker "Session Report Submission with Homework (Jadid & Madi)" VERIFIED SHIPPED.
- **Version / Date**: 1.0 · 2026-09-21 · **Author**: Spec Plan Generator (design authored by planning agent).
- **Baseline**: `outcome/phase-0-baseline-outcome.md` (tsgo 0 errors · biome 0 warnings · lint `exitCode: 0`, 2026-09-21).
- **REQ coverage statement**: §1–§2 ground REQ-001/002 (protocol, i18n/logging pins); §2 D-rulings + §3 cover REQ-010..014 (data surfaces, derived shapes); §4 covers REQ-030/031 (GraphQL, SDL pins) and the permission matrix behind REQ-020..023; §5 covers REQ-010..014 service/repo mechanics + the J1 journey (specs §4); §6 covers REQ-040/041/042 (routes, sidebar, namespace); §7–§8 cover REQ-020..023 (security, errors); §9 covers REQ-050..054 (tests); §10–§11 cover REQ-014/061 operational gates; §12 self-certifies against specs REQ-001..062 as a whole.

---

## 1. Overview & Design Goals

This plan designs a strictly read-only admin monitoring surface — `/admin/academic-tracking` (+ `[studentId]` drill-down) — that derives every student's memorization (Jadid) and revision (Madi) milestones, homework grades, cross-student advancement statistics, and "students needing attention" flags purely by aggregating EXISTING committed rows (`home_work`, `reports`, `session`, `users`, `students`, `progress`). The producer side (teacher `submitSessionReport` with Jadid/Madi blocks, `backend/services/classes/session-report.service.ts:357`) is shipped and untouched; this feature adds a new admin-scoped read lane: two GraphQL queries, one admin service, one new aggregation repository, closed projection types, one route pair, one sidebar entry, one i18n namespace, and a full test ladder. Zero DDL, zero mutations, zero notifications.

**Design goals:**
1. **Derive, never persist** — no new tables/columns/migrations (D1); every "milestone" is a read-time computation.
2. **Honest data** — nulls stay null (ungraded tracks), `progress` is a row count (never a percentage), totals are exact.
3. **Constant-denial oracle for non-admins** — teacher/student/parent probes are observationally identical 403s (D6), mirroring `docs/parents/monitoring-portal.md:99`.
4. **Convention-clone, not convention-invent** — admin gate-first services, page envelopes, SDL freeze refresh, nav/i18n ceremony all clone verified precedents.
5. **Bounded queries** — paginated, indexed, ceiling-guarded reads at any student-body size.

---

## 2. Key Design Decisions (D1..D9)

Each decision: Context → Options → Decision → Rationale. These D-rulings operationalize specs rulings R-A..R-G (specs.md §7.4) and are binding for `tasks.md`.

### D1 — NO schema changes: milestones are read-time derivations
- **Context**: The ticket asks for "memorization and revision milestones", but no milestone table exists anywhere (`backend/db/` grep — zero hits) and `home_work` already carries per-session Jadid (`current_*`) / Madi (`revision_*`) columns with grades CHECKed to [0,100] (`backend/db/schema/classes/home-work.ts:23-49`, columns :30-37, CHECKs :46-47).
- **Options**: (a) new `student_milestones` table maintained on write; (b) materialized aggregate refreshed by cron; (c) read-time aggregation over existing rows.
- **Decision**: **(c)** — no new tables, columns, migrations, or persisted aggregates. Dashboard/drill-down data derives from `home_work` joined through `session` (`session.student_id` → `users.id`), plus `reports`, `students`/`users` identity, and `progress` row counts.
- **Rationale**: the producer contract (`home_work` = one immutable row per session, `home_work_session_id_unique`) is already the milestone ledger; a shadow table would add write-path coupling, drift risk, and migrations for zero information gain. Matches specs R-C and the parent-portal derived-read precedent (attendance from `session.status`, `docs/parents/monitoring-portal.md:126-131`).

### D2 — Latest Surah/Juz position = newest `home_work` row per lane (graded-lane nuance)
- **Context**: "Current Surah/Juz" per student must come from the newest Jadid/Madi references. Shipped precedent: `ParentMonitoringService.getChildProgress` derives `latestJadidPosition`/`latestMadiPosition` from the newest `home_work` row's `current_*`/`revision_*` columns via `HomeWorkRepository.findLatestByStudentId` (`backend/services/parents/parent-monitoring.service.ts:210`, `home-work.repository.ts:142`, ORDER BY `created_at DESC, id DESC LIMIT 1`), emitting a position ONLY when the lane carries a surah/juz ref (`composeHomeworkPosition`, `parent-monitoring.helpers.ts:334`).
- **Options**: (a) newest row regardless of grade; (b) newest GRADED row; (c) teacher-declared "current position" field.
- **Decision**: **(b) newest graded row for position display**, falling back to the newest row carrying a `current_surah_juz`/`revision_surah_juz` when no graded row exists yet — both computed from the same newest-first window, never from a new column. Position objects are null when the lane has no surah/juz ref (clone of `composeHomeworkPosition` discipline).
- **Rationale**: an ungraded assignment is the teacher's PLAN, not the student's achieved position; admin monitoring cares about achievement. Option (c) needs DDL (violates D1). The fallback keeps brand-new students visible with their first assigned position while grades are pending, and the parent-portal mapper logic is reused conceptually (an admin-domain mapper file re-implements it; the parent helpers are parent-domain and not imported cross-domain per service AGENTS).

### D3 — "Students needing attention" thresholds: named constants, typed-union reasons
- **Context**: The ticket demands flagging of "students needing attention (low grades, slow progress)" but NO numeric definition exists anywhere in planning docs (verified gap, research digests) — this is a plan ruling, not a discovery.
- **Options**: (a) hardcode literals inline; (b) DB-configurable thresholds; (c) named constants in the new service's helpers with a typed reason union.
- **Decision**: **(c)** — constants live in `backend/services/admin/admin-academic-tracking.constants.ts` (service layer; `.types.ts` files are prohibited there):
  - `NEEDS_ATTENTION_LOW_AVG_GRADE = 60` — flag `lowGrade` when the average of the student's last `NEEDS_ATTENTION_RECENT_WINDOW = 10` graded Jadid `current_grade` rows is **< 60** (scale [0,100], the DB CHECK range). If fewer than 10 graded Jadid rows exist, average over what exists; a student with **zero** graded Jadid rows is NOT low-grade-flagged (absence ≠ failure).
  - `NEEDS_ATTENTION_STALE_DAYS = 14` — flag `staleProgress` when the student has ≥1 `completed` session AND zero graded homework rows in the last **14 days** (staleness anchored on `home_work.updated_at` of graded rows — the grade write bumps it — falling back to `created_at` for never-graded rows; "now" comes from the single captured transaction timestamp).
  - Reasons form a typed union `AdminAcademicAttentionReason = "lowGrade" | "staleProgress"`, each carrying a localized label from the new `adminAcademic` namespace (en + ar). A student may carry both reasons; the flag is a transient per-request derivation — never persisted (D1).
- **Rationale**: constants are greppable, reviewable, and documented; a settings surface was ruled out of scope (specs §6.2); the union keeps the wire contract closed and i18n-typed. Exact semantics above are the canonical definition for tasks, tests, and the canonical doc.

### D4 — Repository split: one NEW admin aggregation repo; drill-down reuses existing class repos
- **Context**: `HomeWorkRepository`/`ReportRepository` are single-student-scoped only (full export inventories, research-repos §1/§2) — no cross-student listing, averages, or threshold queries exist. The admin repo lane already lives at `backend/db/repo/admin/` (`admin-user.repository.ts`, `platform-analytics.repository.ts:117-424`).
- **Options**: (a) widen `HomeWorkRepository` with admin methods; (b) new `backend/db/repo/admin/academic-tracking.repository.ts`; (c) compute aggregates in the service from raw SQL.
- **Decision**: **(b)** for cross-student reads (dashboard rows, stats, attention signals) + **reuse existing readers** for per-student drill-down: `HomeWorkRepository.listForStudent`/`countForStudent` (`home-work.repository.ts:232,293`), `ReportRepository.listForStudent`/`countForStudent` (`report.repository.ts:186,241`), `ProgressRepository.countForStudent` (`progress.repository.ts:58`) — all with the tx-last-param convention, no prepared statements, no `inArray` + placeholder.
- **Rationale**: repo AGENTS mandate one namespace per repo file and data-access-only repos; widening a class-domain repo with admin cross-tenant reads muddies ownership; `platform-analytics.repository.ts` (conditional `count(*) filter` via `sql<number>` + `.mapWith(Number)`, `:366` `getRatingStats`) is the in-repo aggregation pattern to clone. Reusing proven per-student readers avoids duplicating the session-join tenancy builders already tested in `backend/db/test/repo/classes/`.

### D5 — GraphQL: exactly two new admin queries + full SDL/codegen same-changeset refresh
- **Context**: `backend/graphql/query/admin/` holds 7 query files, none academic (verified). The Query root is FROZEN as an exact baseline ("EXACTLY the refreshed 57-op baseline", `backend/graphql/test/sdl-static-assertions.test.ts:34-36`); precedent commit `16b1b7f9` shows the full same-changeset ritual.
- **Options**: (a) one mega query; (b) N narrow queries per widget; (c) exactly two: dashboard + drill-down.
- **Decision**: **(c)** — register exactly two root query fields in a NEW `backend/graphql/query/admin/academic-tracking.query.ts`, gated via the shared prelude `adminOnlyAuthScopes` + `requireAdminUser` (`backend/graphql/shared/admin-prelude.ts:24-37`, the explicit conjunction `$all: { authenticated: true, role: [UserRole.Admin] } }`):
  - `adminAcademicDashboard(page, pageSize, search)` — paged all-students academic rows + one aggregate `stats` block + per-row attention flags.
  - `adminStudentAcademicDetail(studentId, page, pageSize)` — one student's composite academic record (homework page + reports page + progress count + flag).
  Pothos objects in a NEW `backend/graphql/pothos/admin/academic-tracking.pothos.ts` (barrel `backend/graphql/pothos/admin/index.ts:8-14` gains one export); query barrel `backend/graphql/query/admin/index.ts:12-18` gains one import. In the SAME changeset: refresh `schema-surface.test.ts` + `sdl-static-assertions.test.ts` (57 → 59 ops) and commit `bun run generate:gqlSchema` (`frontend/graphql/generated/schema.graphql`) + `bun codegen` (`frontend/graphql/generated/gql/graphql.ts`) artifacts.
- **Rationale**: two fields match the two UX surfaces (dashboard/drill-down), keep resolvers thin, and avoid both N+1 schema sprawl and a brittle mega-payload; the admin-analytics zero-arg snapshot precedent (`platform-analytics.query.ts:48-67`) supports collapsing stats INTO the dashboard payload; the freeze-refresh ritual is mandatory repo law, not an option.

### D6 — 403 reconciliation: constant-denial at GraphQL, existing redirect at page level
- **Context**: Ticket scenario (d) says "Non-admin attempts access — 403", but the dashboard tree has NO HTTP-403 page: `withPageAuth({ roles: [UserRole.Admin] })` REDIRECTS non-admins to their own role dashboard (`frontend/lib/auth/withPageAuth.ts:34-90`; canonical admin usage `app/(dashboard)/admin/analytics/page.tsx:37`). The parent portal's constant-denial oracle (`docs/parents/monitoring-portal.md:99`) is the security posture to mirror.
- **Options**: (a) invent a new HTTP-403 page; (b) keep the redirect and satisfy "403" at the data layer; (c) drop page gating entirely.
- **Decision**: **(b)** — explicit reconciliation: at the **GraphQL layer**, every non-admin role (teacher/student/parent) calling either query receives the SAME localized `ForbiddenError` (`extensions.code = FORBIDDEN`, HTTP-classified 403) with constant copy, ≤1 bounded `logDomainError`, and zero cause disclosure (existence, deletion state, and role all indistinguishable); anonymous callers get `UnauthorizedError` (401) from the scope check BEFORE the resolver runs. At the **page layer**, the established `withPageAuth` redirect convention is KEPT verbatim — no new UX invented for a route non-admins never see in their nav. If a non-admin session nonetheless reaches the client container (e.g. deep link), the FORBIDDEN query errors render through `PermissionDeniedFallback`.
- **Rationale**: inventing a 403 page diverges from every existing admin route; the threat that matters (data) is sealed by the constant oracle; the redirect is the ratified platform behavior (specs R-E / REQ-021.4).

### D7 — Soft-deleted students: excluded from dashboard, viewable in drill-down (audit posture)
- **Context**: `users.isDeleted` (`users.ts:30`) governs soft delete; the parent portal severs reads on soft-deleted children, but an admin is whole-tenant and other admin surfaces (users directory) retain visibility of governed accounts.
- **Options**: (a) exclude everywhere + constant-deny drill-down (parent-portal mirror); (b) exclude from the dashboard by default, keep drill-down viewable with a governance marker; (c) include everywhere.
- **Decision**: **(b)** — the dashboard row set filters `users.isDeleted = false` by default; the drill-down of a soft-deleted student REMAINS viewable for audit (admin is whole-tenant), rendering a localized "account deleted" governance banner on the detail header. This REFINES specs REQ-013.4/REQ-021.2 for the soft-deleted cause only: for ADMIN callers, a nonexistent or malformed `studentId` still fails closed (see §7 BOLA — localized NotFoundError for admins, never an existence oracle for non-admins).
- **Rationale**: admins must answer "what did this student's record look like before deletion?" — the academic history survives soft delete by design (cascade deletes only fire on hard delete); the dashboard stays clean of dead accounts. Non-admin callers NEVER reach this nuance (constant 403 regardless of id validity).

### D8 — Time basis: no scheduled-date column exists; orderings ride homework/report timestamps
- **Context**: `session` has NO scheduled-date column (`scheduled_at|slot` grep over `backend/db/schema/` — zero hits; only `startedAt`/`endedAt`/confirmation stamps, `session.ts:70-74`), so "progress over time" cannot be anchored on a session calendar date. `home_work` and `reports` both carry server-managed `created_at` + `updated_at` (with `$onUpdate`), and `reports` rows are immutable after insert while `home_work` grades land via the write-once `gradeHomeWorkOnce` UPDATE.
- **Options**: (a) synthesize a date from `session.startedAt`; (b) anchor all orderings/aggregates on `home_work.created_at` / `reports.created_at` with display joining `session.startedAt` when present.
- **Decision**: **(b)** — canonical ordering is newest-first on `home_work.created_at` (tie-break `id DESC`, cloning the repo's existing ordering discipline, `home-work.repository.ts:256`); the D3 staleness window rides the graded rows' timestamps; drill-down row display shows `session.startedAt` (nullable → fallback to `home_work.created_at`) as the human-facing session date. Consistent column names: `home_work.created_at`/`updated_at`, `reports.created_at`/`updated_at`, `session.started_at`/`ended_at` (SQL) — TS keys `createdAt`/`updatedAt`/`startedAt`/`endedAt`.
- **Rationale**: homework/report rows are the atomic academic events; they are never null (`created_at` NOT NULL `defaultNow()`), unlike `session.startedAt` (nullable until the session starts); cloning the shipped ordering avoids inventing a second time axis.

### D9 — i18n & logging pins (build-time compliance, non-negotiable)
- **Context**: The repo's compile-time locale system replaced `next-intl` entirely; MUI v9 forbids style props; console.* is an ESLint error.
- **Options**: none — these are convention pins, recorded so reviewers can grep.
- **Decision**: server components use single-arg `getTranslations(locale)` from `shared/locale/server.ts:15` with property access; client components use `useAppTranslation(<handle>)` (`shared/locale/client/use-app-translation.ts:8-17`); resolvers use `ctx.t("errorsTranslations")` and services receive `locale: string` + `getServerTranslations(locale)`; frontend logging via `@/frontend/lib/logger`, backend via `@/backend/lib/logger` with `logDomainError` for denials. FORBIDDEN: `Translation.` enum (does not exist), two-arg `getTranslations`, `t("key")` calls, `next-intl`, `getBackendTranslations`, `shared/messages/`, `console.*`, hardcoded colors, MUI style props, `*Outline` icon names. All enums (`UserRole`, `SurahJuzRef`, `SessionStatus`) are VALUE imports from `@/backend/enum/...`.
- **Rationale**: matches REQ-002 and the frontend/backend AGENTS rule sets; violations fail sub-loop/quality-gate before review sees them.

---

## 3. Data Models

**NO DDL — zero new tables, columns, migrations, or indexes.** Everything below is an EXISTING read model (verified 2026-09-21, research-schema.md) projected into NEW closed types. Read path join keys: `home_work.session_id → session.id`, `session.student_id → users.id` (= `students.id`, shared PK), `reports.session_id → session.id`, `progress.student_id → students.id`.

### 3.1 Existing read model (source of truth)

| Table (file) | Columns this feature reads | Notes |
|---|---|---|
| `home_work` (`backend/db/schema/classes/home-work.ts:23-49`) | `id` (:26) · `sessionId` (:27) · **Jadid lane**: `currentFromAyah` (:30), `currentToAyah` (:31), `currentGrade` (:32, nullable int **[0,100]**, CHECK :46), `currentSurahJuz: surahJuzRef` (:33) · **Madi lane**: `revisionFromAyah` (:34), `revisionToAyah` (:35), `revisionGrade` (:36, nullable int [0,100], CHECK :47), `revisionSurahJuz: surahJuzRef` (:37) · `createdAt`/`updatedAt` (:38-42) | One row per session (`home_work_session_id_unique` :45); created ungraded, graded once via `gradeHomeWorkOnce`; grades NEVER mix with the reports rating scale |
| `reports` (`backend/db/schema/classes/reports.ts:20-42`) | `id`, `sessionId`, `teacherNotes` (text, nullable), `studentRatingByTeacher` (nullable int **[0,5]**, CHECK :37-40), `createdAt`/`updatedAt` | NO `teacher_id` (teacher via session, :14-16); one row per session (`reports_session_id_unique` :36) |
| `session` (`backend/db/schema/classes/session.ts:54-90`) | `id`, `teacherId` (→ `teacher.id` → shared-PK `users.id`), `studentId` (→ `users.id`), `status` (`session_status`: scheduled/started/completed/cancelled/disputed), `startedAt`/`endedAt` (nullable), `createdAt`/`updatedAt` | Indexes: `session_student_id_idx`, `session_teacher_id_idx` (:87-90); NO scheduled-date column (D8) |
| `users` (`backend/db/schema/users/users.ts:11-45`) | `id`, `fullName` (:15), `email` (:16), `role` (:19), `isDeleted` (:30) | Dashboard default filter: `role = 'student' AND isDeleted = false` (D7) |
| `students` (`backend/db/schema/students/students.ts:18-47`) | `id` (shared PK = FK `users.id`) | Existence marker for the student lane; governance fields live on `users` |
| `progress` (`backend/db/schema/classes/progress.ts:19-34`) | `studentId`, `createdAt` | SKELETON — NO score/`completed_at`; read as an honest COUNT only (`progress_student_id_idx` :33) |
| `surahJuzRef` enum (`backend/db/schema/enums.ts:112-139`) | 35 members: `surah_al_fatihah`, `surah_al_baqarah`, `surah_aal_imran`, `surah_an_nisa`, `surah_al_maidah`, then `juz_1`…`juz_30` | Consumed AS SHIPPED — expansion is the curriculum lane (specs R-B / D1); TS mirror `backend/enum/shared/surah-juz-ref.enum.ts` (value imports) |

### 3.2 New derived shapes (PROPOSED — destined for `backend/types/admin/admin-academic-tracking.types.ts`; all members `readonly`; enums as VALUE imports)

```ts
export enum AdminAcademicAttentionReason { LowGrade = "lowGrade", StaleProgress = "staleProgress" }

export interface AdminAcademicPositionReturnType { readonly surahJuz: SurahJuzRef; readonly fromAyah: number | null; readonly toAyah: number | null }
export interface AdminAcademicGradeSummaryReturnType { readonly gradedCount: number; readonly averageGrade: number | null } // null when gradedCount = 0
export interface AdminAcademicAttentionFlagReturnType { readonly reasons: readonly AdminAcademicAttentionReason[] } // [] = not flagged → flag object is nullable
export interface AdminAcademicStudentRowReturnType {
  readonly id: number;                       // students.id (= users.id) — id FIRST for Apollo normalization
  readonly fullName: string; readonly email: string;
  readonly latestJadidPosition: AdminAcademicPositionReturnType | null;   // D2
  readonly latestMadiPosition: AdminAcademicPositionReturnType | null;    // D2
  readonly jadidGradeSummary: AdminAcademicGradeSummaryReturnType | null;  // null = no Jadid rows at all
  readonly madiGradeSummary: AdminAcademicGradeSummaryReturnType | null;
  readonly progressRowCount: number;                                      // honest count, never a percentage
  readonly lastGradedHomeworkAt: string | null;                           // ISO DateTime (D3 staleness anchor)
  readonly needsAttention: AdminAcademicAttentionFlagReturnType | null;
}
export interface AdminAcademicStatsReturnType {
  readonly trackedStudentCount: number; readonly studentsWithGradedHomeworkCount: number;
  readonly averageJadidGrade: number | null; readonly averageMadiGrade: number | null; // over graded rows only
  readonly needingAttentionCount: number;
}
export interface AdminAcademicDashboardPageReturnType {
  readonly items: readonly AdminAcademicStudentRowReturnType[]; readonly total: number;
  readonly page: number; readonly pageSize: number; readonly pageCount: number;
  readonly stats: AdminAcademicStatsReturnType;
}
export interface AdminAcademicHomeworkTrackReturnType { readonly surahJuz: SurahJuzRef | null; readonly fromAyah: number | null; readonly toAyah: number | null; readonly grade: number | null }
export interface AdminAcademicHomeworkEntryReturnType { readonly id: number; readonly sessionId: number; readonly sessionStartedAt: string | null; readonly teacherName: string; readonly jadid: AdminAcademicHomeworkTrackReturnType | null; readonly madi: AdminAcademicHomeworkTrackReturnType | null; readonly createdAt: string }
export interface AdminAcademicReportEntryReturnType { readonly id: number; readonly sessionId: number; readonly sessionStartedAt: string | null; readonly teacherName: string; readonly teacherNotes: string | null; readonly studentRatingByTeacher: number | null; readonly createdAt: string }
export interface AdminAcademicStudentDetailEchoReturnType { readonly id: number; readonly fullName: string; readonly email: string; readonly isDeleted: boolean }
export interface AdminStudentAcademicDetailReturnType {
  readonly student: AdminAcademicStudentDetailEchoReturnType;               // isDeleted → governance banner (D7)
  readonly homeworkPage: { readonly items: readonly AdminAcademicHomeworkEntryReturnType[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly pageCount: number };
  readonly reportPage: { readonly items: readonly AdminAcademicReportEntryReturnType[]; readonly total: number; readonly page: number; readonly pageSize: number; readonly pageCount: number };
  readonly progressRowCount: number; readonly needsAttention: AdminAcademicAttentionFlagReturnType | null;
}
export interface AdminAcademicDashboardFiltersSubmitInput { readonly search?: string | null }
```

Notes: page-envelope sub-objects are embedded values with NO `id` (Apollo `keyFields: false` registration in `frontend/providers/apollo/apolloCache.ts`, the portal precedent); all timestamps surface as ISO `DateTime` strings (codegen maps `DateTime` → `string`, `codegen.ts:24`). Teacher name derives from `session.teacher_id → teacher (shared PK users.id) → users.fullName`.

---

## 4. API Contracts (GraphQL)

### 4.1 Proposed SDL (names FINAL for tasks; artifacts regenerated, never hand-edited)

```graphql
type Query {
  adminAcademicDashboard(page: Int = 1, pageSize: Int = 25, search: String): AdminAcademicDashboardPage!
  adminStudentAcademicDetail(studentId: Int!, page: Int = 1, pageSize: Int = 25): AdminStudentAcademicDetail!
}

type AdminAcademicDashboardPage {
  items: [AdminAcademicStudentRow!]!
  total: Int!; page: Int!; pageSize: Int!; pageCount: Int!
  stats: AdminAcademicStats!
}
type AdminAcademicStudentRow { id: Int!, fullName: String!, email: String!, latestJadidPosition: AdminAcademicPosition, latestMadiPosition: AdminAcademicPosition, jadidGradeSummary: AdminAcademicGradeSummary, madiGradeSummary: AdminAcademicGradeSummary, progressRowCount: Int!, lastGradedHomeworkAt: DateTime, needsAttention: AdminAcademicAttentionFlag }
type AdminAcademicStats { trackedStudentCount: Int!, studentsWithGradedHomeworkCount: Int!, averageJadidGrade: Float, averageMadiGrade: Float, needingAttentionCount: Int! }
type AdminAcademicPosition { surahJuz: SurahJuzRef!, fromAyah: Int, toAyah: Int }
type AdminAcademicGradeSummary { gradedCount: Int!, averageGrade: Float }
type AdminAcademicAttentionFlag { reasons: [AdminAcademicAttentionReason!]! }
enum AdminAcademicAttentionReason { lowGrade staleProgress }
type AdminStudentAcademicDetail {
  student: AdminAcademicStudentDetailEcho!
  homeworkPage: AdminAcademicHomeworkPage!
  reportPage: AdminAcademicReportPage!
  progressRowCount: Int!
  needsAttention: AdminAcademicAttentionFlag
}
type AdminAcademicStudentDetailEcho { id: Int!, fullName: String!, email: String!, isDeleted: Boolean! }
type AdminAcademicHomeworkPage { items: [AdminAcademicHomeworkEntry!]!, total: Int!, page: Int!, pageSize: Int!, pageCount: Int! }
type AdminAcademicHomeworkEntry { id: Int!, sessionId: Int!, sessionStartedAt: DateTime, teacherName: String!, jadid: AdminAcademicHomeworkTrack, madi: AdminAcademicHomeworkTrack, createdAt: DateTime! }
type AdminAcademicHomeworkTrack { surahJuz: SurahJuzRef, fromAyah: Int, toAyah: Int, grade: Int }
type AdminAcademicReportPage { items: [AdminAcademicReportEntry!]!, total: Int!, page: Int!, pageSize: Int!, pageCount: Int! }
type AdminAcademicReportEntry { id: Int!, sessionId: Int!, sessionStartedAt: DateTime, teacherName: String!, teacherNotes: String, studentRatingByTeacher: Int, createdAt: DateTime! }
```

`SurahJuzRef` is the EXISTING registered enum (`pothos/shared/enum.pothos.ts`) — never re-registered. Argument conventions clone `adminDirectoryPagination.helpers.ts:52-78`: `page` positive integer (default 1), `pageSize` integer 1..100 (default 25), violations → localized `ValidationError` thrown BEFORE any service/DB work; `studentId` mirrors the parent-monitoring `t.arg.int({ required: true })` precedent (`parent-monitoring.query.ts:150-152`). Out-of-range page → empty `items` + honest `total`. `search` (optional) is a case-insensitive name/email pattern reusing the student-directory filter discipline (`student.repository.directory.helpers.ts:56-60`), LIKE-wildcards escaped (§7).

### 4.2 Wire example (happy path)

```graphql
query { adminAcademicDashboard(page: 1, pageSize: 25, search: "ahmed") {
  items { id fullName latestJadidPosition { surahJuz fromAyah toAyah } jadidGradeSummary { gradedCount averageGrade }
          progressRowCount needsAttention { reasons } }
  total pageCount stats { trackedStudentCount averageJadidGrade needingAttentionCount } } }
# → { "data": { "adminAcademicDashboard": { "items": [ { "id": 42, "fullName": "Ahmed …", "latestJadidPosition": { "surahJuz": "juz_1", "fromAyah": 1, "toAyah": 20 }, "jadidGradeSummary": { "gradedCount": 3, "averageGrade": 74.33 }, "progressRowCount": 2, "needsAttention": { "reasons": [] } } ], "total": 1, "pageCount": 1, "stats": { "trackedStudentCount": 9, "averageJadidGrade": 71.2, "needingAttentionCount": 2 } } } }
```

### 4.3 Error contract (localized, structured, `extensions.code` always present)

| Case | Error class · `extensions.code` | HTTP class | Copy source |
|---|---|---|---|
| Anonymous caller (either query) | `UnauthorizedError` · `UNAUTHORIZED` | 401 | `ctx.t("errorsTranslations").unauthorized` (scope check fires pre-resolver) |
| Authenticated teacher/student/parent (either query, ANY id cause) | `ForbiddenError` · `FORBIDDEN` | 403 | constant `errorsTranslations.forbidden`; ≤1 bounded `logDomainError`; identical bytes across causes/roles (D6) |
| Admin + malformed `studentId` (≤0 / non-integer) or out-of-range pagination | `ValidationError` · `VALIDATION` | 422-class | pre-DB bounds discipline; no DB read |
| Admin + nonexistent `studentId` | `NotFoundError` · `NOT_FOUND` | 404-class | localized; **admins only** — non-admins never reach this branch (constant 403 first), so no existence oracle leaks (§7) |

All errors propagate as service-layer `DomainError` subclasses; masked at the boundary by `finalizeGraphqlErrors` only — resolvers throw nothing directly (`backend/graphql/AGENTS.md:104-108`).

### 4.4 Permission matrix (both queries × every role; roles are exactly admin/teacher/student/parent — `enums.ts:9`)

| Caller | `adminAcademicDashboard` | `adminStudentAcademicDetail` |
|---|---|---|
| anonymous | 401 `UNAUTHORIZED` (scope, pre-resolver) | 401 `UNAUTHORIZED` (scope, pre-resolver) |
| admin | 200 — paged rows + stats, all non-deleted students | 200 — any student incl. soft-deleted (governance banner, D7); unknown id → localized `NOT_FOUND` |
| teacher | 403 `FORBIDDEN` — constant copy, zero data | 403 `FORBIDDEN` — identical bytes for every id cause |
| student | 403 `FORBIDDEN` — identical | 403 `FORBIDDEN` — identical |
| parent | 403 `FORBIDDEN` — identical | 403 `FORBIDDEN` — identical |

Reads emit ZERO audit rows (no mutation census entries — query-only feature).

---

## 5. Services & Repositories

### 5.1 New service — `backend/services/admin/admin-academic-tracking.service.ts`

Two exported, gate-first, read-only methods (admin-gate BEFORE the transaction — `platform-analytics.service.ts:135` precedent; `assertActorAdminActive` from `admin-gate.helpers.ts:133` because a soft-deleted admin must not read):

```ts
export async function getAcademicDashboard(
  actorId: number, filters: AdminAcademicDashboardFiltersSubmitInput,
  page: number, pageSize: number, locale: string, outerTx?: DBTransaction
): Promise<AdminAcademicDashboardPageReturnType>;
export async function getStudentAcademicDetail(
  actorId: number, studentId: number, page: number, pageSize: number,
  locale: string, outerTx?: DBTransaction
): Promise<AdminStudentAcademicDetailReturnType>;
```

Flow (both): ① `assertActorAdminActive(actorId)` (denial localization via `getServerTranslations(locale, "errorsTranslations")`) → ② open ONE read-only transaction (or join `outerTx`) capturing `now = new Date()` → ③ validate bounds via the shared pagination helper clone (`adminDirectoryPagination.helpers.ts:52-78` → throws pre-DB) → ④ repo reads → ⑤ assemble via mappers. Dashboard = directory page + stats + attention signals in `Promise.all` over the SAME tx (the `getPlatformAnalytics` `Promise.all` pattern, `platform-analytics.service.ts:129-158`); drill-down additionally resolves the student echo first (`admin-user.repository.ts` or a small new lookup) — soft-deleted students proceed (D7), missing ids throw `NotFoundError`. Threshold/flag computation lives in `admin-academic-tracking.helpers.ts` (pure functions over repo output + `now`), constants in `admin-academic-tracking.constants.ts` (D3), projection mapping in `admin-academic-tracking.mappers.ts` (D2 position logic cloned conceptually from `composeHomeworkPosition`). No service-layer `.types.ts` (repo rule) — types live in `backend/types/admin/admin-academic-tracking.types.ts` (§3.2).

### 5.2 New repository — `backend/db/repo/admin/academic-tracking.repository.ts` (namespace `AdminAcademicTrackingRepository`)

Every method: single-statement guarded SELECT, tx-last param, NO prepared statements, NO `inArray` + placeholder, DB types as inputs (`AdminAcademicDashboardFiltersSelectType` in the repo-layer schema types), ReturnTypes assembled in the service (D4 split):

```ts
// directory rows: users(students lane) LEFT JOIN LATERAL latest home_work row per lane + per-student grade aggregates
export async function listStudentAcademicRows(filters: AdminAcademicDashboardFiltersSelectType, now: Date, limit: number, offset: number, tx: DBTransaction): Promise<AdminAcademicStudentRowSelectType[]>;
export async function countStudentAcademicRows(filters: AdminAcademicDashboardFiltersSelectType, tx: DBTransaction): Promise<number>;
// stats block: ONE conditional-aggregation statement over home_work joined to users (count(*) filter (where ...) via sql<number> + .mapWith(Number), platform-analytics.repository.ts:117-424 pattern)
export async function getAcademicStats(now: Date, tx: DBTransaction): Promise<AdminAcademicStatsSelectType>;
// attention signals: per-student recent graded window (D3) — bounded by the constants, not by client args
export async function listAttentionSignals(now: Date, tx: DBTransaction): Promise<AdminAcademicAttentionSignalSelectType[]>;
// student echo for drill-down (id, fullName, email, isDeleted)
export async function getStudentEchoById(studentId: number, tx: DBTransaction): Promise<AdminAcademicStudentEchoSelectType | null>;
```

Latest-row derivation uses `LEFT JOIN LATERAL (… ORDER BY created_at DESC, id DESC LIMIT 1)` per lane over `home_work ⨝ session` (windowed per student; bounded by the page slice, NOT a correlated subquery per row — D4's no-N+1). Grade summaries use conditional `avg`/`count` filters. Drill-down reuses existing readers (D4): `HomeWorkRepository.listForStudent`/`countForStudent` (`home-work.repository.ts:232,293`), `ReportRepository.listForStudent`/`countForStudent` (`report.repository.ts:186,241`), `ProgressRepository.countForStudent` (`progress.repository.ts:58`) — all tx-last.

### 5.3 Concurrency assessment — why NO locks

All new paths are pure SELECTs inside one read-only transaction: there is NO read-then-write, no check-then-act, and no guarded transition, so no mutex/`SELECT … FOR UPDATE` is warranted (locks exist to serialize write decisions, none here). Statement-level consistency is acceptable because every consumer is a monitoring view over COMMITTED rows: the dashboard deliberately mirrors `getPlatformAnalytics`'s single-tx + captured-`now` snapshot so stats and rows cannot straddle a mid-flight teacher submission; the drill-down's three sub-reads share one tx so the header and pages are mutually consistent. The only concurrent writers (`submitSessionReport`, `gradeHomeWorkOnce`) own immutability/write-once semantics upstream — a report/homework row the admin reads either exists committed or not at all; a grade seen once can never silently change (write-once), so no torn read is observable.

### 5.4 Journey Design for J1 (specs §4): teacher submits report → admin observes

**Shared-entity lifecycle:** `home_work` rows are created once by `submitSessionReport` (`session-report.service.ts:357`) and NEVER mutated by this feature; the only later write is the teacher-owned write-once `gradeHomeWorkOnce` UPDATE (`home-work.repository.ts:185`). `reports` rows are immutable after insert. This feature adds no lifecycle states, transitions, or state machine — the admin surface is a pure observer.

**Side-effect matrix (what this feature writes):** NONE. Zero mutations, zero notifications, zero audit rows, zero cache writes. (Canonical: a domain-mutation census entry would be REQUIRED if any mutation shipped — none does.)

**Cross-actor visibility (J1 ordered steps → observable outcome):**

| Step | Actor → action | Shared-state change | Admin (consumer) observes | Teacher/Parent/Student observe |
|---|---|---|---|---|
| 1 | Teacher completes session for student S | `session.status = completed` | S's completed-session count feeds attention eligibility (D3) | Participants: own session surfaces (unchanged) |
| 2 | Teacher submits report + Jadid/Madi blocks (+ previous grades) | `reports` row + `home_work` row (immutable; earlier row graded write-once) | S's latest positions, grade summaries, stats, and flag state all recompute on next read (no feature-owned cache) | Parent: portal children views (unchanged); Student: `myHomework` (unchanged) |
| 3 | Admin opens `/admin/academic-tracking` | (none — read) | Dashboard row for S reflects the new positions/grades; low grade can flip S's `needsAttention` | — |
| 4 | Admin drills into `[studentId]` | (none — read) | Full newest-first history incl. the new homework/report rows | — |
| D | Teacher/Student/Parent probe either admin query | (none — denied) | — | Identical constant 403, zero data, both locales (D6) |

---

## 6. UX / Navigation Specification

### 6.1 Routes & page structure (both admin-only; other roles are never routed here and never see the nav entry)

| Route | Structure |
|---|---|
| `/admin/academic-tracking` | `app/(dashboard)/admin/academic-tracking/page.tsx` — server shell, ZERO data fetch, `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })`, `generateMetadata` via single-arg `getTranslations(locale)` → renders `<AdminAcademicTrackingContainer />` (client, no props) |
| `/admin/academic-tracking/[studentId]` | `app/(dashboard)/admin/academic-tracking/[studentId]/page.tsx` — same guard; `params.studentId` coerced to a safe positive int (`Number(...)` + `Number.isInteger` guard) before passing as a prop to `<AdminStudentAcademicDetailContainer studentId={…} />` |

Container pattern clones the analytics exemplar (`app/(dashboard)/admin/analytics/page.tsx:36-38` → `PlatformAnalyticsContainer.tsx:81`): a `"use client"` container owns `useQuery` from `@apollo/client/react` (`:50` — never `useLazyQuery`), stateful per-`studentId` re-key (drill-down mirrors the `ParentChildDetailContainer` keying), and a render-state matrix: initial → skeleton; error → `ErrorRetryAlert`; FORBIDDEN → `PermissionDeniedFallback` (`frontend/components/ui/PermissionDeniedFallback.tsx:46`); empty → `IconCircleEmptyState`-style localized empty; populated → data sections. Raw server `message` strings never render — errors classify via `mapGraphQLErrorByCode` + `extractErrorCode` (`frontend/providers/apollo/error-link.map.ts`, `frontend/lib/graphql-error-utils`; exemplar docblock `PlatformAnalyticsContainer.tsx:31-35`). Refresh: manual `refetch()` (pollInterval optional at plan-task discretion — analytics uses 120_000, `:75`).

### 6.2 Sidebar — insertion AFTER `/students`

`NAV_ITEMS_BY_ROLE[UserRole.Admin]` (`frontend/views/dashboard/nav/navItems.ts:156-187`) gains `{ route: "/admin/academic-tracking", labelKey: "academicTracking", Icon: <MUI *Outlined icon> }` directly after the `/students` entry (`:161`). New label key `academicTracking` is added to the `DashboardLabels` type + BOTH leaves: `shared/locale/en/dashboard/index.ts` ("Academic Tracking") and `shared/locale/ar/dashboard/index.ts` ("التتبع الأكاديمي"), resolvable by exactly one label namespace. The route string is single-sourced in a leaf lib module (frontend rule) — never duplicated literals. Both drawers inherit from the single config.

### 6.3 New `adminAcademic` namespace (full ceremony; en + ar ship together)

Pattern = the `adminStudents` ceremony: (a) type schema `shared/locale/types/adminAcademic/index.ts`; (b) handle `shared/locale/namespaces/adminAcademic/adminAcademic.namespace.ts` via `defineNamespace<AdminAcademicLabels>("adminAcademic.adminAcademic", …)` (the `analytics.namespace.ts:3-8` precedent); (c) leaves `shared/locale/en/adminAcademic/index.ts` + `shared/locale/ar/adminAcademic/index.ts` (literals only, ICU `{var}` interpolation, `(count: number) => string` pluralization for counts); (d) registration in both `messages.ts` aggregates + the namespace registry; (e) parity test `shared/locale/adminAcademic-namespace.parity.test.ts` (the `adminStudents-namespace.parity.test.ts` pattern). Jadid/Madi/Surah/Juz vocabulary MIRRORS the existing `parentMonitoring` terms (`trackJadid: "Jadid (new memorization)"`, `progressLatestJadidLabel`, research-frontend §G) — no divergent terminology. Denial copy reuses `errorsTranslations` (no duplication). Attention-reason labels: `attentionReasonLowGrade` / `attentionReasonStaleProgress` (+ ar).

### 6.4 UI primitives — REAL, verified to exist (AppDataGrid/PageContainer do NOT exist and are NEVER cited)

| Concern | Primitive (verified path) |
|---|---|
| Table (dashboard rows, drill-down history) | `AdminDesktopTable` (`frontend/components/ui/AdminDesktopTable.tsx:22` — plain responsive table shell) |
| Stat cards (stats block, drill-down summaries) | `MetricCard`/`MetricRow` (`frontend/views/admin/analytics/MetricCard.tsx:34,86` — admin-analytics-local, importable within admin views) and `SharedStatCard` (`frontend/views/parent/monitoring/SharedStatCard.tsx:31`) |
| Denied / retry / empty | `PermissionDeniedFallback` (`frontend/components/ui/PermissionDeniedFallback.tsx:46`) · `ErrorRetryAlert` / `RetryableNotice` (`frontend/components/ui/`) · `IconCircleEmptyState` (same dir) |
| Apollo error surface | `GraphQLErrorSurfaceHost` + `mapGraphQLErrorByCode` discipline |
| Styling | MUI v9 `sx`-ONLY (no style props on Typography/Stack/Box/Grid), theme-palette colors with `on<Color>` siblings, `*Outlined` icons (D9) |

GraphQL documents live in `frontend/graphql/sharedDocuments/admin/academic-tracking.documents.ts` (`adminAcademicDashboardQueryDocument`, `adminStudentAcademicDetailQueryDocument`; `id` on all object types; sibling contract tests per the `documents.contract.test.ts` pattern; index barrel line added).

### 6.5 Role-based access matrix (routes)

| Route | Admin | Teacher | Student | Parent | Anonymous |
|---|---|---|---|---|---|
| `/admin/academic-tracking` | Allow (full surface) | `withPageAuth` redirect to own dashboard; any direct query → constant 403 | Same | Same | Redirect to login (`withPageAuth`) |
| `/admin/academic-tracking/[studentId]` | Allow (any student id; soft-deleted → governance banner, D7) | Same as above | Same | Same | Same |

Per-audience rendering: this is an admin-ONLY surface — no per-role rendering variants exist; non-admin roles are handled exclusively by the route guard + query denial, never by conditional UI.

---

## 7. Security, Authorization & Tenancy Mitigations

- **BFLA (function-level)** — both query fields declare the shared `adminOnlyAuthScopes` (`backend/graphql/shared/admin-prelude.ts:24-37`) — the EXPLICIT conjunction `$all: { authenticated: true, role: [UserRole.Admin] } }` (a plain key-map is ANY-semantics and wrong, `backend/graphql/AGENTS.md:17`); the service re-asserts via `assertActorAdminActive` as its FIRST statement (belt; a soft-deleted/blocked/suspended admin is denied in governance order, `admin-gate.helpers.ts:133`).
- **BOLA (object-level)** — caller identity comes EXCLUSIVELY from `ctx.user.id`; `studentId` is the only data-scoping argument and is validated (positive integer) before any read. For ADMIN callers an unknown id resolves to a localized `NotFoundError` (whole-tenant audience, no secret to keep — D7); a malformed id resolves to `ValidationError` pre-DB. NON-ADMIN callers NEVER reach either branch: the role scope denies first, so existence/deletion state is never disclosed to them (constant 403 for every id cause — D6). Soft-deleted drill-down access is deliberate (D7) and bannered, never silent.
- **BOPLA (property-level)** — query args are scalars (`Int`, `String`) only; no object spreading (`{ ...input }`-style copies are forbidden by convention — filter fields are copied field-by-field, the `admin-students.query.ts:71-73` pattern). Pothos objects are CLOSED projections (§3.2): no `extends Entity`, no `& SelectType`, no `Omit` re-opening — internal user/billing/dispute columns are unreachable by construction; `teacherNotes`/grades expose only the academic columns the ticket demands.
- **Denial oracle** — teacher/student/parent denials of either query are byte-identical (same `FORBIDDEN` code, same localized copy in en AND ar, zero data fields), each emitting ≤1 bounded `logDomainError` with a bounded context bag (caller id + code, never student data fields) — mirroring `docs/parents/monitoring-portal.md:99`. Wire tests assert this as a 0-variant oracle table (§9).
- **Audit** — read-only surface: ZERO audit rows are written; no `wired` row is added to `test/workflows/admin/audit-completeness.catalog.ts` (that census is for MUTATIONS only, `backend/graphql/AGENTS.md:88-90`).
- **LIKE-wildcard escaping** — the optional `search` filter escapes `%`, `_`, and `\` in the client-supplied pattern BEFORE the repo's `ilike` (name OR email) — the existing student-directory search shape (`student.repository.directory.helpers.ts:56-60`) with explicit escaping added at the service normalization seam; the normalized pattern is the ONLY thing passed down (repo never interpolates raw client text — parameterized SQL only, no prepared statements).
- **Tenancy** — no tenant partitioning exists in the data model; the admin role IS the whole-tenant grant (D7). No per-student link/consent checks apply to the admin reader (the parent portal's `requireLinkedChild` is role-specific and NOT cloned here — specs REQ-023.2).

---

## 8. Error Handling

Domain-error inventory (all existing classes; nothing new is invented; all copy localized via `getServerTranslations(locale).errorsTranslations` server-side and `ctx.t("errorsTranslations")` on the wire):

| Error | `extensions.code` | Raised when | Raised by |
|---|---|---|---|
| `UnauthorizedError` | `UNAUTHORIZED` | anonymous caller hits either query | Pothos scope check (pre-resolver) |
| `ForbiddenError` | `FORBIDDEN` | authenticated non-admin (any id cause); soft-deleted/blocked/suspended ADMIN actor at the belt | scope check / `assertActorAdminActive` |
| `ValidationError` | `VALIDATION` | `page` < 1, `pageSize` outside 1..100, malformed `studentId` (≤0 / non-integer) | pagination bounds helper + service guard (pre-DB) |
| `NotFoundError` | `NOT_FOUND` | admin drill-down on a nonexistent student id | service (after echo lookup returns null) |

Discipline: resolvers throw nothing directly; `DomainError` subclasses propagate with `extensions.code` and are masked at the boundary by `finalizeGraphqlErrors` (no stack leaks, `backend/graphql/AGENTS.md:104-108`). Domain/expected rejections log via `logger.logDomainError` (debug under `TEST_SERVER=1`, warn in production) — never `console.*`. The client NEVER renders raw `message` — every error routes through `mapGraphQLErrorByCode` to the correct UI state (§6.1); FORBIDDEN → `PermissionDeniedFallback`, RATE_LIMITED/SERVICE_UNAVAILABLE-class → `RetryableNotice`, data-empty ≠ error (localized empty states). Soft-deleted drill-down is NOT an error (D7): it renders with a localized governance banner.

---

## 9. Testing Strategy (mapped to specs REQ-050..054)

| Layer | File(s) | Coverage (per REQ) | Rules |
|---|---|---|---|
| Repo (REQ-050) | `backend/db/test/repo/admin/academic-tracking.repository.test.ts` (+ drill-down assertions added to/alongside the existing classes suites where new wiring needs proof) | latest-per-lane tie-breaking (newest `created_at`, then `id DESC`); grade summaries (graded-only averages; null when zero graded); only-Jadid / only-Madi / zero-row students; soft-deleted excluded from rows but echo-reachable (D7); attention-signal window math (D3) incl. boundary: avg exactly 60 → NOT flagged (`< 60`), staleness at exactly 14 days → NOT flagged (`≥` boundary per D3 semantics); empty platform; deep-pagination ceiling; multi-student isolation | `runInRollback` + `tx` to EVERY call; try/catch helper (NEVER `expect(...).rejects.toThrow()` inside rollback); fixtures via `entity-setup.ts` (never seed data); run via `bun run test/scripts/run-test.ts <path>` |
| Service (REQ-051) | `backend/services/admin/admin-academic-tracking.service.test.ts` | gate matrix (anonymous → UnauthorizedError pre-tx; teacher/student/parent actor rows → identical ForbiddenError; soft-deleted admin → ForbiddenError); bounds rejections (pre-DB, no DB touch — asserted via tx spy or read-count); NotFoundError on unknown id (admin only); honest shapes: empty stats (zero/null, never 0-as-average), flag computation vs. constants, envelope echo of resolved page/pageSize | localized denial copy asserted via `getServerTranslations(locale).errorsTranslations.*` — never raw strings; both locales; `TEST_SERVER=1` compact logs |
| GraphQL wire/integration (REQ-052) | `frontend/graphql/test/admin/academic-tracking.integration.test.ts` (dev-server `testClient`, `bun run test:graphql`) | full role matrix (§4.4): anonymous 401; admin 200 with envelope + `id`-first rows; teacher/student/parent 403 with 0-variant oracle across causes (nonexistent id / soft-deleted id / valid foreign id) in BOTH locales; `VALIDATION` on bad bounds; `NOT_FOUND` for admin+unknown id; SDL freeze pins hold (57 → 59 ops, `schema-surface.test.ts` + `sdl-static-assertions.test.ts` updated in the SAME changeset) | sibling participant/parent/teacher queries asserted untouched (byte-identical authScopes/shapes) |
| Journey (REQ-054) | `test/workflows/admin/academic-tracking.journey.test.ts` — written TEST-FIRST (before the UI task lands) | J1 end-to-end (specs §4.2): teacher completes session → submits report+homework (+ previous grades) → admin dashboard reflects new positions/grades/stats/flag; admin drill-down shows the new rows newest-first; denial legs: teacher/student/parent → identical 403 on both queries; proves ticket scenarios (a)–(d) | runs via `bun run test/scripts/run-test.ts test/workflows/admin/academic-tracking.journey.test.ts` — NEVER raw `bun test`; data created by the test itself (entity-setup + real `submitSessionReport` mutation), never seed data |
| UI (e2e conventions) | `test/ui/e2e/` conventions | admin loads dashboard → rows/stats render; drill-down navigation; loading/error/denied states; RTL (ar locale) label rendering | browser-verification discipline per repo AGENTS (DOM/a11y-first, screenshots to `scratch/screenshots/`) |

---

## 10. Performance & Deployment

- **Pagination bounds**: `page ≥ 1`, `pageSize` 1..100 (default 25) validated pre-DB (`adminDirectoryPagination.helpers.ts:62-78` clone); out-of-range page → empty `items` + honest `total` (never a slow scan); a deep-pagination scan ceiling mirrors the existing directory precedent (`MAX_DIRECTORY_SCAN_ROWS = 10_000`, `session.repository.helpers.ts:176`).
- **Aggregate query budget**: dashboard = 3 statements total (rows window, count, stats) + attention signals, all in ONE tx via `Promise.all` — no per-row N+1 (lateral joins derive per-student lanes inside the windowed statement, D4). Drill-down = 5 statements (echo, homework list+count, report list+count, progress count) + attention signal — constant regardless of history size.
- **Indexes**: all joins ride existing indexes (`session_student_id_idx`, `home_work_session_id_idx`, `progress_student_id_idx`, `session_teacher_id_student_id_idx`); NO new indexes ship (D1). Any hot-path concern is justified against these at review.
- **No migrations to deploy**: zero DDL — deployment is pure application code + locale files.
- **Codegen artifacts**: `frontend/graphql/generated/schema.graphql` + `frontend/graphql/generated/gql/graphql.ts` regenerated (`bun run generate:gqlSchema` then `bun codegen`, `package.json:69-70`) and committed in the SAME changeset as the registrations + SDL pin updates (commit `16b1b7f9` precedent).
- **Caching**: no feature-owned cache; the surface reflects committed data on every read. Apollo default normalization with `keyFields: false` registered for the no-`id` envelope/position/summary value types (`frontend/providers/apollo/apolloCache.ts`, portal precedent).

---

## 11. Outcome & Knowledge Transfer Protocol

- **Pre-execution (every task):** the executing agent reads ALL files under `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/` FIRST — the six research digests, `phase-0-baseline-outcome.md`, and every prior `<task-id>-outcome.md` — so no research is repeated and pitfalls carry forward (REQ-001.3).
- **Post-execution (every task):** write `outcome/<task-id>-outcome.md` (research findings, implementation details, cross-file dependencies, deviations from this plan, carry-overs) AND flip the task checkbox `[ ]` → `[x]` in `tasks.md` (REQ-001.4). Per-file verification `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` must exit 0 BEFORE a file's outputs are used elsewhere (REQ-001.5); the semantic-review checklist runs before any `[x]` (REQ-001.6).
- **Deferral discipline:** any unfinished work gains a `deferred-items.md` row in the same breath (never after close); the ledger must hold zero ❌/⚠️ rows at the final gate (REQ-061.2).
- **Knowledge propagation (closeout):** canonical doc `docs/admin/academic-tracking.md` ships as the final task — query contracts + permission matrix, D1..D9 rulings (esp. D3 threshold semantics and the FR-6.3 bridge R-A), honest-data rules, consumer obligations. Root `AGENTS.md` and `.agents/instructions/` are hand-curated rule files — plan work NEVER updates them (spec-process-guide Rule-File Policy); durable knowledge goes ONLY to `docs/admin/` and the plan's outcome files (REQ-062).
- **Review gates:** Phase 1.5 plan-review (`outcome/plan-review-R1.md`, REQ-060), Phase 2.5 mid-point review after backend phases (REQ-061.1), Phase 8 final wave (zero-mutation grep, sibling-diff check, `bun quality-gate` green, traceability loop with zero missing REQ ids — REQ-061.2).

---

## 12. Self-Certification Checklist (author self-certification against the design templates)

- [x] **Requirements alignment** — every REQ-001..062 is either directly designed here (§1–§10) or owned by the outcome protocol (§11); the two-surface structure (dashboard + drill-down) matches ticket AC-1/AC-2 and the four test scenarios map 1:1 to §9 rows; specs §9 traceability ids all covered.
- [x] **No invented implementation facts** — every EXISTS claim cites a verified digest `path:line` (research digests, 2026-09-21); every new artifact is labeled CREATE/PROPOSED; AppDataGrid/PageContainer (nonexistent) are never cited — §6.4 lists only verified primitives.
- [x] **Zero-DDL discipline** — §3 opens with the explicit no-DDL statement; all shapes are read projections (D1); specs R-C honored.
- [x] **Decision log** — D1..D9 each carry Context/Options/Decision/Rationale and trace to specs rulings (R-A..R-G) and REQ ids; thresholds (D3) are defined with exact boundary semantics for tests.
- [x] **i18n compliance** — §6.3 full `adminAcademic` ceremony with parity test; D9 pins the compile-time system (no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`); en+ar parity enforced by test.
- [x] **GraphQL accuracy** — §4 SDL matches the Pothos registration mechanics (side-effect barrels, closed objects, existing `SurahJuzRef`), envelope/id-first conventions, and the mandatory same-changeset SDL-pin + codegen refresh (D5).
- [x] **Security posture** — §4.4 permission matrix covers all roles × both queries; §7 covers BFLA/BOLA/BOPLA, the constant-denial oracle (D6), audit-zero posture, and LIKE-escaping; the admin NotFoundError nuance (D7) is explicitly reconciled with specs REQ-021.
- [x] **Concurrency assessed** — §5.3 explains why lock-free read-only snapshots are correct (no read-then-write, single-tx consistency, upstream immutability).
- [x] **Journey captured** — §5.4 J1 with actor steps, side-effect matrix (feature owns NO writes/notifications), and cross-actor visibility table incl. denial legs; maps to `test/workflows/admin/academic-tracking.journey.test.ts` (REQ-054).
- [x] **Testability** — §9 maps every layer to REQ-050..054 with the repo's mandatory runners (`run-test.ts`, never raw `bun test`) and DB-test deadlock rules.
- [x] **Performance bounded** — §10 fixes the per-page statement budget, pagination caps/ceiling, index reuse, and no-feature-cache rule (REQ-014, §5 NFR).
- [x] **Outcome/knowledge protocol present** — §11 binds REQ-001/060/061/062; deferred-items ledger initialized empty.

**Deferred-items pointer:** all mid-execution deferrals MUST be recorded in `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md` (initialized 2026-09-21, empty) — never inline in tasks; the final gate fails on any ❌/⚠️ row.
