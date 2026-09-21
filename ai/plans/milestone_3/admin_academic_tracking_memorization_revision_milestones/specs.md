# Requirements & Specification: Admin Academic Tracking (Memorization & Revision Milestones)

**Plan directory (verbatim):** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/`
**Specs path:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/specs.md`
**Companion Plan:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/plan.md` (Phase 2)
**Companion Tasks:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/tasks.md` (Phase 3)
**Deferred-items ledger:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`

## Document Information

- **Feature Name**: Admin Academic Tracking (Memorization & Revision Milestones)
- **Ticket**: `docs/planning/TICKETS.md:2184-2217` (Owner Stream: Dev 2, Milestone 3, 3 SP; Decision Refs: B.11 + FR-6.3, `TICKETS.md:2217`; **Blocked By** "Session Report Submission with Homework (Jadid & Madi)" — VERIFIED SHIPPED: `ai/finished_plans/milestone_1_core_domain_mvp/session-report-homework-infrastructure/`, write path live at `backend/services/classes/session-report.service.ts:357`)
- **Target Directory**: `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/`
- **Outcome Directory**: `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`
- **Version**: 1.0 · **Date**: 2026-09-21 · **Author**: Spec Plan Generator (spec authored by planning agent)
- **Quality Baseline (pre-implementation, captured 2026-09-21)**: `outcome/baseline-tsgo.txt` · `outcome/baseline-biome.txt` · `outcome/baseline-lint.json` — all zero-error at capture time; REQ-001 makes these the attribution baseline.
- **Stakeholders**: Admins (sole consuming audience), Dev 2 stream (feature owner), teachers (academic-data producers via `submitSessionReport`), students (data subjects), parents (denied probes; their portal is untouched).
- **Related Canonical Documents**: `docs/specs/open-decisions-and-gaps.md:135-139` (B.11 — surah/juz enum, ✅ RESOLVED) · `docs/specs/functional-requirements.md:206-208` (FR-6.3 — authoritative text; see bridge note R-A in §7.4) · `docs/parents/monitoring-portal.md` (the repo's read-only-monitoring exemplar — constant-denial oracle, closed projections, honest counts) · `docs/sessions/session-report-homework.md` (participant-only report/homework reads — byte-locked, R-F) · `docs/testing/workflow-journey-tests.md` (journey layer).

---

## ⚠️ Phase-0 Ground-Truth Verification (verify-then-claim, ruled against the live tree 2026-09-21)

Every substrate below was verified by the research agents before being cited (digests in `outcome/research-{schema,repos,services,graphql,frontend,templates-exemplar-and-decision-refs}.md`, 2026-09-21). Prose-only (unverifiable) claims are labeled CREATE, never EXISTS/UPDATE.

| Substrate | State | Evidence (verified 2026-09-21) |
|---|---|---|
| `home_work` table — Jadid `current_*` / Madi `revision_*` columns + grades CHECK [0,100] | EXISTS | `backend/db/schema/classes/home-work.ts:23-48`; one row per session (`home_work_session_id_unique`) |
| `surah_juz_ref` enum (B.11) | EXISTS — SHIPPED with **35 members: 5 surahs + 30 juz** (NOT 114 — see ruling R-B) | `backend/db/schema/enums.ts:112-139`; TS mirror `backend/enum/shared/surah-juz-ref.enum.ts` |
| `reports` table (teacher notes + `studentRatingByTeacher` CHECK 0-5; NO `teacher_id`) | EXISTS | `backend/db/schema/classes/reports.ts:20-42` |
| `session` table (student/teacher FKs, statuses) | EXISTS | `backend/db/schema/classes/session.ts:54-90`; `session.student_id` → `users.id` (shared-PK with `students.id`) |
| `progress` table — SKELETON (`studentId`, nullable `lessonId`, timestamps; NO score/`completed_at`) | EXISTS | `backend/db/schema/classes/progress.ts:19-34` — usable ONLY as an honest row count |
| Per-student repo reads: `HomeWorkRepository.listForStudent`/`countForStudent`/`findLatestByStudentId`, `ReportRepository.listForStudent`/`countForStudent`, `ProgressRepository.countForStudent` | EXISTS | `backend/db/repo/classes/home-work.repository.ts:232,293,142`; `report.repository.ts:186,241`; `progress.repository.ts:58` |
| Cross-student homework/grade aggregation (per-student-latest, grade averages, thresholds, admin listing) | MISSING — CREATE | `HomeWorkRepository` is single-student-scoped only (full export inventory, research-repos §1/§8) |
| Admin gate: `assertActorAdmin` / `assertActorAdminActive` (BFLA, governance-ordered) | EXISTS | `backend/services/admin/admin-gate.helpers.ts:114,133`; admin services gate FIRST, before the transaction (`platform-analytics.service.ts:135`) |
| `adminOnlyAuthScopes` + `requireAdminUser` shared prelude (`$all` conjunction) | EXISTS | `backend/graphql/shared/admin-prelude.ts:24-37`; anonymous→UNAUTHORIZED, non-admin→FORBIDDEN before resolver (`admin-students.query.ts:12-15`) |
| Admin snapshot pattern (single tx, one `now`, `Promise.all` over repo aggregates) | EXISTS | `PlatformAnalyticsService.getPlatformAnalytics`, `backend/services/admin/platform-analytics.service.ts:129-158` — currently ZERO academic reads |
| Admin directory pattern (filters + page/pageSize + honest total + deep-pagination ceiling) | EXISTS | `session.repository.helpers.ts:163-176,296-342`; `resolveAdminDirectoryPageBounds` throws VALIDATION on bad bounds (`adminDirectoryPagination.helpers.ts:62-78`) |
| `withPageAuth({ roles: [UserRole.Admin] })` page-level role gate | EXISTS — REDIRECTS non-admins (no HTTP-403 page exists in the dashboard tree — see ruling R-E) | `frontend/lib/auth/withPageAuth.ts:34-90`; canonical admin usage `app/(dashboard)/admin/analytics/page.tsx:37` |
| Admin sidebar config (`NAV_ITEMS_BY_ROLE[UserRole.Admin]`) | EXISTS — no academic entry (CREATE one) | `frontend/views/dashboard/nav/navItems.ts:156-187` |
| Compile-time locale system (26 namespaces en/ar, parity tests, `defineNamespace` handles) | EXISTS — no `adminAcademic` namespace (CREATE) | `shared/locale/AGENTS.md`; handle pattern `shared/locale/namespaces/analytics/analytics.namespace.ts:3-8` |
| SDL Query-root freeze + codegen artifacts committed with registration | EXISTS — must be refreshed in the SAME change | `backend/graphql/test/sdl-static-assertions.test.ts:34-36`, `schema-surface.test.ts`; artifacts `frontend/graphql/generated/schema.graphql` + `gql/graphql.ts` (precedent commit `16b1b7f9`) |
| Any `milestone` table / academic-aggregation table | MISSING — intentionally NOT created (ruling R-C) | grep `milestone` over `backend/db/` — zero hits |
| Admin academic service / GraphQL queries / routes / documents | MISSING — CREATE | `backend/graphql/query/admin/` holds 7 query files, none academic; `app/(dashboard)/admin/` has no academic segment; `frontend/graphql/sharedDocuments/admin/` has no academic documents |

---

## 1. Executive Summary & Problem Statement

**Feature.** A strictly read-only admin surface at `/admin/academic-tracking` (+ `/admin/academic-tracking/[studentId]` drill-down) where an admin monitors every student's memorization and revision milestones: current Surah/Juz position per track (Jadid = new memorization, Madi = revision), homework grades, overall academic advancement statistics across all students, and a "students needing attention" flag for low grades / slow progress — ticket `docs/planning/TICKETS.md:2184-2217`, decision refs B.11 (`docs/specs/open-decisions-and-gaps.md:135-139`) + FR-6.3 (bridged by ruling R-A, §7.4).

**Problem.** The producer side is fully shipped: teachers submit session reports with Jadid/Madi homework and grades (`submitSessionReport`, `backend/services/classes/session-report.service.ts:357` — blocker VERIFIED SHIPPED). But NOTHING aggregates it for admins: `PlatformAnalyticsRepository` has zero homework/grade reads; `HomeWorkRepository` reads are single-student-scoped only; the admin student directory (`AdminStudentDirectoryRow`) carries wallet balances and parent info but no academic columns; and the only full-history reads (`myHomework`, parent portal, teacher `studentHomeworkHistory`) are role-gated away from admins. An admin today cannot see any student's memorization position or grade history anywhere.

**Business Value.** Closes the admin oversight half of the academic-tracking loop: academy staff can spot students falling behind early (ticket AC "students needing attention"), answer parent/teacher questions with full per-student history, and measure overall advancement — the monitoring capability the milestone-3 governance stream exists to deliver. Pure derivation over existing data: zero new tables, zero new write paths.

**Actors.** `admin` (consumer — the only authorized reader) · `teacher` (producer — submits reports/homework/grades) · `student` (data subject) · `parent`/`teacher`/`student` as non-admin denial probes.

**Non-goals (explicit):**
1. NO new tables, columns, migrations, or persisted aggregates — milestones derive from `home_work`/`reports`/`progress`/`session` as they stand (ruling R-C; no milestone table exists and none is created).
2. NO mutations of any kind on this surface — query fields only (REQ-022).
3. NO notifications, broadcasts, or alerts — this is a passive monitoring dashboard.
4. NO parent-portal changes — the parent surface stays byte-locked (ruling R-F).
5. NO `surah_juz_ref` enum expansion — the shipped enum (5 surahs + 30 juz) is consumed as-is; expansion belongs to the curriculum lane (ruling R-B).
6. NO CSV/export of the academic directory (deferred-items candidate; the existing export pattern is a precedent, not scope).

---

## 2. Requirements (EARS)

### 2.0 Execution Protocol & Engineering Discipline

#### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As an executing agent, I need a recorded quality baseline, a deferred-items ledger, and per-task outcome records, so that new issues are distinguishable from pre-existing ones and no research is repeated.

#### Acceptance Criteria
1. WHEN implementation begins THEN the executor SHALL treat the recorded baseline (`outcome/baseline-tsgo.txt`, `outcome/baseline-biome.txt`, `outcome/baseline-lint.json`, captured 2026-09-21) as the attribution baseline so new issues are attributable to this plan.
2. WHEN implementation begins THEN the ledger `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md` SHALL exist (per the deferred-items template) and every mid-task deferral SHALL gain a ledger row before its task may close.
3. WHEN an executing agent starts any task THEN it SHALL read ALL files under `outcome/` (research digests + prior task outcomes) before writing code.
4. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` (findings, implementation details, cross-file dependencies, carry-overs) AND flip the task checkbox `[ ]` → `[x]` in `tasks.md`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 on that file before the next file is touched.
6. WHEN any subtask is marked complete THEN the semantic-review checklist SHALL have run (race conditions, env-config, deferred items, cross-layer imports, enum discipline).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: none · **Assumptions**: quality tooling green at baseline (verified 2026-09-21).

#### REQ-002: Translation System & Enum Import Compliance

**User Story:** As a developer, I want compile-time type-safe translations and correct enum imports, so i18n and type errors surface at build time instead of runtime.

#### Acceptance Criteria
1. WHEN a client component renders user-facing text THEN it SHALL use `useAppTranslation(<NamespaceHandle>)` with a namespace HANDLE (`shared/locale/client/use-app-translation.ts:8-17`) and property access (`t.someKey`) — never string literals, never `t("key")`.
2. WHEN a server component renders user-facing text THEN it SHALL use single-arg `getTranslations(locale)` (`shared/locale/server.ts:15-17`) with property access; the two-arg form is FORBIDDEN. WHEN a resolver needs copy THEN it SHALL use `ctx.t("errorsTranslations")`; services receive `locale: string` and use `getServerTranslations(locale)`.
3. WHEN an enum (`UserRole`, `SurahJuzRef`, `SessionStatus`) is used at runtime THEN it SHALL be a VALUE import from `@/backend/enum/...` — never `import type`, never string literals.
4. WHEN the new en/ar namespace leaves ship THEN key parity SHALL be proven by a parity test (`shared/locale/adminAcademic-namespace.parity.test.ts` — REQ-042).
5. WHEN new/modified files are scanned THEN a grep for `next-intl`, `getBackendTranslations`, `shared/messages/`, and hardcoded user-facing strings SHALL return zero hits.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-001 · **Assumptions**: the compile-time locale system is the ONLY i18n surface (legacy `next-intl` fully removed).

### 2.1 Core Academic Read Surfaces

#### REQ-010: All-Students Academic Dashboard

**User Story:** As an admin, I want a paged dashboard listing every student with their latest memorization (Jadid) and revision (Madi) position and a per-student grade summary, so I can see the whole academy's academic standing at a glance.

#### Acceptance Criteria
1. WHEN an admin requests the academic dashboard THEN the system SHALL return a paged directory of all students (role `student`, `users.isDeleted = false`) where every row carries: the student's latest Jadid position (`currentSurahJuz` + `currentFromAyah`/`currentToAyah` from their newest `home_work` row), latest Madi position (`revisionSurahJuz` + revision ayah range), and a per-student grade summary (graded-row counts and average grades on the [0,100] scale for each track) — ticket AC-1 (memorization progress + revision milestones).
2. WHEN averages are computed THEN they SHALL be taken only over graded (non-null) rows; IF a track has zero graded rows THEN the summary SHALL report null (rendered as localized "not graded yet"), never a fabricated 0.
3. WHEN a student has zero sessions or zero homework rows (empty-platform, brand-new student edge case) THEN the row SHALL still appear with null academic fields — a student is never omitted from the directory for lacking data.
4. WHEN a student's `progress` row count is surfaced THEN it SHALL be reported as an honest count only (`ProgressRepository.countForStudent`, `backend/db/repo/classes/progress.repository.ts:58`) with NO derived percentage — the `progress` table is a skeleton (no score/`completed_at`) and fabricated completion percentages are FORBIDDEN.
5. WHEN a row's surah/juz reference is null THEN the UI SHALL omit the position gracefully (mirroring the parent-portal `composeHomeworkPosition` discipline) and the API SHALL return null — never a placeholder text value.
6. WHEN the dashboard aggregates THEN all reads SHALL execute inside one read-only transaction against one captured `now` (the `PlatformAnalyticsService` snapshot pattern, `backend/services/admin/platform-analytics.service.ts:129-158`) so cross-metric consistency holds.

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-020, REQ-014 · **Satisfies**: ticket AC-1; test scenario (a) · **Assumptions**: `session.student_id` and `session.teacher_id` live on the same table (no join-table rename — confirmed live).
- Scope of derivation per row is bounded by a single student's own homework rows (one `home_work` row per session).

#### REQ-011: Students Needing Attention

**User Story:** As an admin, I want students with low grades or slow progress visually flagged on the dashboard, so I can intervene early.

#### Acceptance Criteria
1. WHEN the dashboard computes THEN it SHALL flag students whose academic signals cross the plan-ruled "needs attention" thresholds — one low-grade rule (recent/aggregate grades vs. a low-grade threshold) and one slow-progress rule (progress velocity vs. a slow-progress threshold), both derived ONLY from existing `home_work`/`progress`/`session` data. The numeric thresholds are a plan-level ruling (design decision D-# in `plan.md`, reference-forward); these requirements bind the capability, not the constants.
2. WHEN a student is flagged THEN the dashboard SHALL surface a distinct localized flag (en + ar) on the row AND an aggregate count among the advancement statistics (REQ-012).
3. IF no student crosses a threshold THEN the UI SHALL render an empty localized "no students need attention" state — never an error, never a zero-row conflation with the error path.
4. WHEN flags are computed THEN they SHALL be transient derived values per request — NO persisted flag column, NO new table (ruling R-C).
5. WHEN the flag is named THEN it SHALL be academically distinct from the session-governance `needsAttention` (session-lifecycle concept) to avoid domain collision — a distinct GraphQL field name chosen at plan time.

#### Additional Details
- **Priority**: Medium · **Complexity**: High · **Dependencies**: REQ-010 · **Satisfies**: ticket AC-1 (last bullet); test scenario (c) · **Assumptions**: thresholds are data-derived; an ungraded-only student is treated by the threshold ruling, not silently flagged.

#### REQ-012: Aggregate Academic Advancement Statistics

**User Story:** As an admin, I want cross-student advancement statistics, so I can measure the academy's overall academic momentum.

#### Acceptance Criteria
1. WHEN an admin views the dashboard THEN the system SHALL return an aggregate statistics block computed across all students: at minimum, the tracked-student count, students-with-graded-homework count, and track-level average grades (Jadid and Madi, over graded rows only) — the exact member set is fixed at plan time, but every member SHALL be honestly derivable from `home_work`/`reports`/`progress`.
2. WHEN the platform has zero students or zero graded homework (empty-platform edge case) THEN the statistics SHALL render zero counts / null averages as localized honest-empty states — never an error, never a 0 presented as an average.
3. WHEN aggregates are computed THEN conditional aggregation SHALL follow the repo convention (`count(*) filter (where ...)` via `sql<number>` + `.mapWith(Number)`, the `PlatformAnalyticsRepository` pattern).
4. WHEN the admin refreshes THEN the statistics SHALL reflect committed data only — no caching layer of this feature's own, no write-back.

#### Additional Details
- **Priority**: Medium · **Complexity**: Medium · **Dependencies**: REQ-010 · **Satisfies**: ticket AC-1 (overall academic advancement statistics) · **Assumptions**: this feature does NOT extend `PlatformAnalyticsReturnType` — the academic snapshot is a NEW admin-scoped contract (ruling R-F: new sibling surface, existing analytics untouched).

#### REQ-013: Per-Student Academic Drill-Down

**User Story:** As an admin, I want a student's full academic record — all homework assignments, grades, and progress over time — so I can review their history in detail (ticket AC-2).

#### Acceptance Criteria
1. WHEN an admin drills into a student THEN the system SHALL return that student's full paginated homework history: every `home_work` row joined through `session`, exposing both tracks per row — Jadid (`currentFromAyah`/`currentToAyah`/`currentSurahJuz`/`currentGrade`) and Madi (`revisionFromAyah`/`revisionToAyah`/`revisionSurahJuz`/`revisionGrade`) — plus the owning session's date/teacher context.
2. WHEN a homework row carries only Jadid or only Madi data (single-track edge case) THEN the absent track SHALL render as a localized "none assigned" null state — never a fabricated zero grade, never row omission.
3. WHEN an admin drills into a student THEN the system SHALL also return that student's session-report history (`teacherNotes` + `studentRatingByTeacher` 0-5, via `reports` joined through `session`) and the honest `progress` row count, so "progress over time" = the ordered homework/report timeline + count signal.
4. WHEN a NON-ADMIN probes the drill-down with a nonexistent, soft-deleted, or malformed `studentId` THEN the system SHALL deny with the constant 403 of REQ-021 (indistinguishable causes). For ADMIN callers (plan D7 audit posture): malformed ids → localized validation error, nonexistent ids → localized NotFoundError, and soft-deleted students REMAIN viewable with a localized governance banner — the academic history survives soft delete.
5. WHEN history is paged THEN totals SHALL be honest (`listForStudent`/`countForStudent` pair discipline) and ordering SHALL be stable and newest-first (the existing session-stamp-first ordering convention).
6. IF a student exists but has zero sessions/reports/homework THEN the drill-down SHALL render localized empty states per section — never an error.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-021, REQ-030 · **Satisfies**: ticket AC-2; test scenario (b) · **Assumptions**: "progress over time" is satisfied by the honest timeline + count; no percentage-through-curriculum computation exists anywhere in the schema (no ayah-count/surah metadata tables) and none is invented (deferred-items candidate if product wants it).

#### REQ-014: Pagination & Filtering Consistency

**User Story:** As an admin, I want the student list paged and filtered like the other admin directories, so the surface scales to a large student body and behaves familiarly.

#### Acceptance Criteria
1. WHEN the dashboard student list is paged THEN it SHALL follow the existing admin directory conventions: page/pageSize args, bounds validated BEFORE any data read (out-of-range → localized validation error, the `resolveAdminDirectoryPageBounds` discipline), honest `total`, out-of-range page → empty `items` + honest `total`, and a deep-pagination scan ceiling consistent with the existing directory precedent (`MAX_DIRECTORY_SCAN_ROWS`, `session.repository.helpers.ts:176`).
2. WHEN a large directory is paged (large-directory bounds edge case) THEN reads SHALL remain windowed — no unbounded student fan-out, no per-student N+1 query pattern inside one page.
3. WHEN filters are offered THEN they SHALL reuse the normalized-filter + honest-total envelope discipline of the existing admin directories; academic filters (e.g. "only needing attention") MAY be added at plan time but SHALL NOT widen this requirement's core: name/email search parity with the admin student directory.
4. WHEN drill-down history is paged THEN page bounds SHALL be guarded identically (REQ-013.5 holds under adversarial page args).

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-010, REQ-013 · **Satisfies**: test scenario (a) at scale · **Assumptions**: offset pagination only — no cursor pattern exists in the repo and none is introduced (verified gap, research-repos §9.9).

### 2.2 Authorization & Data Exposure (BOPLA/BOLA/BFLA)

#### REQ-020: Admin-Only Role Gate on Every Query

**User Story:** As the platform owner, I want every admin academic query admin-role-gated at both GraphQL and service layers, so non-admins can never read academic records.

#### Acceptance Criteria
1. WHEN any admin academic query field is defined THEN it SHALL use the shared prelude `adminOnlyAuthScopes` + `requireAdminUser` (`backend/graphql/shared/admin-prelude.ts:24-37`) so anonymous callers get UNAUTHORIZED (401) and non-admin roles get FORBIDDEN (403) BEFORE the resolver executes.
2. WHEN the backing service method runs THEN its FIRST statement SHALL assert the actor's admin role (BFLA belt: `assertActorAdmin`/`assertActorAdminActive` from `admin-gate.helpers.ts:114,133`) before the transaction opens, matching the admin-gate-first convention.
3. WHEN `UserRole` is referenced anywhere THEN it SHALL be the VALUE import from the shared enum (never a string literal) — REQ-002.3.
4. WHEN auth fails at either layer THEN the role value (`UserRole.Admin`) SHALL never be leaked as a hint — deny, don't teach (the `toPublicSafeMessage` discipline).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-002 · **Satisfies**: test scenario (d).

#### REQ-021: Constant-Denial 403 for Non-Admins (Denial Oracle)

**User Story:** As a security reviewer, I want all non-admin denials observationally identical, so denied actors learn nothing about data existence or the reason granularity.

#### Acceptance Criteria
1. WHEN an authenticated non-admin (teacher, student, or parent) calls ANY admin academic query THEN the response SHALL be the same localized `ForbiddenError` (GraphQL `FORBIDDEN` extension code) — constant copy across every non-admin role.
2. WHEN the same denial oracle is probed with different causes — nonexistent student id, soft-deleted student id, well-formed foreign student id, or a probe on the wrong role — THEN the response SHALL remain the constant 403: one `code`, one copy key, one `logDomainError(...)` call max, never countable/per-role variant probes.
3. WHEN denial is tested THEN it SHALL be tested as a test-table oracle (role matrix probes over 0 hits in both locales, the constant-denial convention).
4. **Page-vs-API bridge (ruling R-E):** WHEN a non-admin navigates to `/admin/academic-tracking` THEN the page-level role gate `withPageAuth({ roles: [UserRole.Admin] })` SHALL redirect to their role's dashboard (the established redirect pattern — no HTTP-403 page exists in the dashboard tree). The ticket's "non-admin attempts access — 403" is satisfied at the DATA layer: the GraphQL queries return constant 403 to non-admin sessions, and the client renders the localized PermissionDeniedFallback for those FORBIDDEN errors.
5. WHEN student IDs are accepted THEN malformed values (non-integer, ≤ 0) SHALL be rejected by the same denial/validation discipline with no existence oracle.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-020 · **Satisfies**: ticket AC "non-admin attempts access — 403"; test scenario (d) · **Assumptions**: soft-deleted students are excluded from dashboard rows; non-admin drill-down probes are denied identically (constant 403), while ADMIN callers may view a soft-deleted student's record with a governance banner (plan D7 audit posture); the admin USERS directory retains its own governance filtering — separate surface.

#### REQ-022: Strictly Read-Only Posture

**User Story:** As the platform owner, I want this surface incapable of writing, so a compromised admin session cannot mutate academic data through it.

#### Acceptance Criteria
1. WHEN this feature's GraphQL additions are enumerated THEN they SHALL contain zero mutations — only root query fields (per the repo rule: domain mutations require audit entries; this feature adds none).
2. WHEN the admin UI ships THEN it SHALL expose no mutation affordances (no forms, no action buttons, no optimistic writes) — display components only.
3. WHEN a grep for mutations in this feature's files runs THEN it SHALL return zero `mutationField`/`.mutation(` matches outside the untouched registration barrels.
4. WHEN any read executes THEN it SHALL emit NO audit rows (reads emit NO audit rows by convention).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-020 · **Assumptions**: the admin surface introduces NO mutable shared state — the only lifecycle in play (session/homework creation) is owned by the teacher producer surface (§4).

#### REQ-023: Identity & Data-Scoping Discipline (BOLA)

**User Story:** As a security reviewer, I want no actor-controlled identity and closed projections, so BOLA/BOPLA are structurally impossible.

#### Acceptance Criteria
1. WHEN identity is resolved THEN it SHALL come from `ctx.user` only — never from any client-supplied argument; `studentId` is the ONLY data-scoping argument and is validated (numeric > 0) before reads.
2. WHEN an admin queries THEN their scope is ALL students — the admin role grant replaces any per-student link grant (unlike the parent portal's `requireLinkedChild`), and no student-side authorization re-checks (blocklist consent, link-state) apply to the admin reader.
3. WHEN projections are defined THEN they SHALL be closed: new admin-scoped Pothos objects exposing ONLY the academic fields required here (no re-opening of user/billing/dispute entity objects, no internal columns) — mirroring the parent-portal closed-projection precedent.
4. WHEN queries are registered THEN the auth scope and object types SHALL be defined in NEW files (registration barrel `backend/graphql/query/admin/index.ts` gains only an import line) — byte-locked sibling surfaces stay untouched (ruling R-F).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: REQ-020, REQ-030 · **Assumptions**: "foreign student id" BOLA probes only exist for NON-admin actors; for admins every valid student id is in-scope by design.

### 2.3 GraphQL API Layer

#### REQ-030: New Admin Academic Query Surface

**User Story:** As the frontend, I want typed, paginated admin-scoped queries for the dashboard and drill-down, so the UI renders from real wire data.

#### Acceptance Criteria
1. WHEN the schema is finalized THEN it SHALL register new admin-scoped root query fields covering: (a) the all-students academic dashboard page (REQ-010 rows + REQ-012 statistics + REQ-011 flags), (b) the per-student drill-down history page (REQ-013), with exact field names and argument shapes fixed at plan time.
2. WHEN query fields are registered THEN they SHALL live in NEW file(s) under `backend/graphql/query/admin/` wired via the side-effect barrel chain (`query/admin/index.ts` → `query/index.ts` → `gqlSchema.ts`), following the repo's "Adding New Queries" procedure (research-graphql §(c)).
3. WHEN object types are authored THEN backing ReturnTypes SHALL live in `backend/types/` (closed, `readonly`, value-imported enums) and Pothos objects SHALL use them via `objectRef` — no local type definitions in Pothos or service files (service-layer `.types.ts` files prohibited).
4. WHEN page/data envelope objects are exposed THEN they SHALL mirror the admin page-envelope convention (`items` + `total`/`page`/`pageSize`/`pageCount`, embedded value objects with NO `id`), and row objects SHALL carry `id` first for Apollo normalization; no-`id` value types SHALL be registered with `keyFields: false` in `frontend/providers/apollo/apolloCache.ts` (the portal's Apollo cache policy precedent).
5. WHEN pagination args exist THEN they SHALL carry SDL defaults consistent with the admin directory helpers (`page = 1`, `pageSize = 25`) — no required pagination args.
6. WHEN resolver bodies run THEN they SHALL be thin: gate-check actor (prelude) → delegate to the new admin academic service with `(ctx.user.id, …, ctx.locale)` — no business logic in the GraphQL layer.

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-020, REQ-023, REQ-010..014 · **Assumptions**: dashboard and statistics MAY collapse into one composite query field (admin-analytics precedent: zero-arg snapshot) — plan-time decision; drill-down stays a separate field.

#### REQ-031: SDL Snapshot Pins & Codegen Artifacts (Same Changeset)

**User Story:** As a maintainer, I want the schema contract, its tests, and generated artifacts consistent in one changeset, so downstream consumers never see schema drift.

#### Acceptance Criteria
1. WHEN any new query field registers THEN the frozen Query-root baselines SHALL be refreshed in the SAME change: `backend/graphql/test/schema-surface.test.ts` + `backend/graphql/test/sdl-static-assertions.test.ts` (exact-op baseline pins).
2. WHEN registrations change THEN `bun run generate:gqlSchema` AND `bun codegen` SHALL run and their artifacts (`frontend/graphql/generated/schema.graphql`, `frontend/graphql/generated/gql/graphql.ts`) SHALL be committed in the same changeset.
3. WHEN frontend documents are created THEN they SHALL live in `frontend/graphql/sharedDocuments/admin/` named `{entity}QueryDocument`, include `id` on all object types, and carry the per-domain sibling contract tests (the `documents.contract.test.ts` pattern).
4. WHEN the participant-only `sessionReport`/`sessionHomework`, parent `parentChild*`, student `myHomework`, and teacher `studentHomeworkHistory` queries are inspected after this feature ships THEN they SHALL be byte-identical in authScopes and shape — zero scope widening (ruling R-F; verified by diff in the Phase-8 review gate).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-030 · **Assumptions**: no GraphQL-layer DataLoader consumer arises unless plan-time composition creates per-row fields (repo has zero live DataLoader examples today — a plan-time ruling notes which way it goes).

### 2.4 UX, Navigation & i18n

#### REQ-040: Routes `/admin/academic-tracking` (+ `[studentId]` Drill-Down)

**User Story:** As an admin, I want a stable, deep-linkable academic-tracking location with a drill-down route, so I can navigate and share links to any student's record.

#### Acceptance Criteria
1. WHEN the feature ships THEN the dashboard root SHALL exist at `app/(dashboard)/admin/academic-tracking/page.tsx` as a server-shell performing ZERO data fetching, role-gated via `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })` (the `/admin/analytics` shell pattern).
2. WHEN an admin opens a student row THEN navigation SHALL land on `app/(dashboard)/admin/academic-tracking/[studentId]/page.tsx` (dynamic segment; `[studentId]` coerced to a safe positive integer before use) mirroring the `/admin/users` ↔ `/admin/users/[id]` pair.
3. WHEN client containers fetch THEN they SHALL use stateful `useQuery` from `@apollo/client/react` (NO `useLazyQuery` — repo rule) re-keyed on `studentId`, with the surface's loading/error/denied/empty states rendered via the existing primitives (skeleton, `ErrorRetryAlert`, `PermissionDeniedFallback` for FORBIDDEN, localized empty states).
4. WHEN any error renders THEN raw server `message` strings SHALL never render — errors classify via `mapGraphQLErrorByCode`/`extractErrorCode` (the platform error-display discipline).
5. WHEN components style THEN they SHALL be MUI v9 `sx`-only (no style props on Typography/Stack/Box/Grid), theme-palette colors only (no hardcoded colors, `on<Color>` siblings for contrast), and `*Outlined` icon names.
6. WHEN either page renders user-facing text THEN it SHALL come from the new `adminAcademic` namespace (REQ-042) / existing `dashboard` labels — zero hardcoded strings.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-041, REQ-042, REQ-030 · **Assumptions**: routes carry NO `[locale]` segment (cookie-based locale); Next.js 16 docs in `node_modules/next/dist/docs/` consulted for any new App Router usage.

#### REQ-041: Admin Sidebar Navigation Entry

**User Story:** As an admin, I want academic tracking in my sidebar, so the surface is discoverable.

#### Acceptance Criteria
1. WHEN the nav config changes THEN `NAV_ITEMS_BY_ROLE[UserRole.Admin]` (`frontend/views/dashboard/nav/navItems.ts:156-187`) SHALL gain `{ route: "/admin/academic-tracking", labelKey: "academicTracking", Icon: <MUI *Outlined icon> }` positioned as the academic sibling of the student directory (directly after the `/students` entry).
2. WHEN the label resolves THEN a new `academicTracking` key SHALL exist in the `DashboardLabels` type + BOTH locale leaves (`shared/locale/en/dashboard/index.ts`, `shared/locale/ar/dashboard/index.ts`), resolvable by exactly one label namespace (no cross-namespace collisions).
3. WHEN the route string is referenced THEN it SHALL be single-sourced in a leaf lib module — never duplicated as literals across files (frontend rule).
4. WHEN the sidebar renders THEN both desktop permanent drawer and mobile temporary drawer SHALL inherit the entry from the single config with no extra wiring.

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: REQ-040 · **Assumptions**: no new nav group needed — a flat item in the admin array.

#### REQ-042: `adminAcademic` i18n Namespace (Full Ceremony)

**User Story:** As a developer, I want one compile-time-checked namespace for all academic-tracking copy, so en/ar parity is enforced by the type system and tests.

#### Acceptance Criteria
1. WHEN the namespace is created THEN the full ceremony SHALL run: (a) type schema `shared/locale/types/adminAcademic/index.ts`; (b) handle `shared/locale/namespaces/adminAcademic/adminAcademic.namespace.ts` via `defineNamespace` (→ `adminAcademicTranslations`); (c) en + ar leaves; (d) registration in both `messages.ts` aggregates and the namespace registry; (e) parity test `shared/locale/adminAcademic-namespace.parity.test.ts`.
2. WHEN Jadid/Madi track labels, surah/juz names, attention-flag copy, statistics labels, empty states, and drill-down section titles are authored THEN en + ar SHALL ship together, with the Jadid/Madi/Surah/Juz display vocabulary MIRRORING the existing `parentMonitoring` terms (`trackJadid`, `progressLatestJadidLabel` precedents) rather than inventing divergent terminology.
3. WHEN counts appear THEN pluralization SHALL use the `(count: number) => string` function-label convention; interpolations SHALL use the ICU `{var}` convention.
4. WHEN denial copy is needed THEN it SHALL reuse the existing `errorsTranslations` entries (no duplicate denial copy in this namespace).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-002 · **Assumptions**: camelCase namespace id `adminAcademic.adminAcademic` per the `analytics.analytics` precedent.

### 2.5 Testing Strategy

#### REQ-050: Repository Tests — New Cross-Student Aggregation Reads

**User Story:** As a backend dev, I want the new cross-student repo methods DB-tested, so aggregation correctness (latest-per-student, averages, filters, pagination) is proven.

#### Acceptance Criteria
1. WHEN new repo methods ship (per-student-latest homework lookup, cross-student academic row listing, grade aggregates, attention-signal queries) THEN each SHALL have tests in `backend/db/test/repo/` wrapped in `runInRollback` + `tx` passed to EVERY repo call, creating data via `entity-setup.ts` helpers (never querying seed data).
2. WHEN failure paths are tested inside `runInRollback` THEN the try/catch helper pattern SHALL be used — `expect(...).rejects.toThrow()` inside rollback is FORBIDDEN (deadlock rule).
3. WHEN edge cases are covered THEN they SHALL include: student with zero sessions; student with only-Jadid rows; only-Madi rows; all-null-grade rows (averages null, not 0); multi-session latest-row tie-breaking (newest session stamp wins); soft-deleted students excluded; empty platform; deep-pagination ceiling; multi-student-isolation (student A's data NEVER appears in student B's rows).
4. WHEN tests run THEN they SHALL go through `bun run test/scripts/run-test.ts <path>` (log capture mandate) and pass alongside the full DB suite (`bun run test:db`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-010, REQ-012, REQ-013, REQ-014 · **Assumptions**: repo methods reuse existing `listForStudent`-style SQL composition; new methods are read-only SELECTs (no upsert/update coverage needed).

#### REQ-051: Service Tests — Admin Gate & Honest Shapes

**User Story:** As a backend dev, I want the admin academic service's gate matrix and honest-aggregate behavior under test, so denials fire pre-transaction and empty states never masquerade as errors.

#### Acceptance Criteria
1. WHEN the new admin academic service is tested THEN its tiered suite SHALL cover: gate denials (anonymous / non-admin → same localized ForbiddenError, pre-transaction) with `TEST_SERVER=1` compact-domain-log discipline; shape assertions on rows/statistics; and honest aggregates (empty platform, zero-graded, single-track students, needs-attention flag computation vs. the plan-ruled thresholds).
2. WHEN pagination/bounds are tested THEN out-of-range args SHALL produce the localized validation error (bounds-first discipline) without any DB read.
3. WHEN the drill-down service is tested THEN non-admin probes of nonexistent/soft-deleted/malformed student ids SHALL produce the constant 403 (indistinguishable); ADMIN callers get the plan-D7 branches (malformed → localized ValidationError, nonexistent → localized NotFoundError, soft-deleted → viewable with the governance banner).
4. WHEN the full suite runs THEN `bun run test:services` SHALL pass with zero new failures attributed to this feature (baseline: `outcome/baseline-*`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-020, REQ-021, REQ-010..014.

#### REQ-052: GraphQL Wire/Integration Tests — Role Matrix & Constant Denial

**User Story:** As a platform owner, I want the auth boundary proven on the wire against a live server, so scope checks aren't just unit-level claims.

#### Acceptance Criteria
1. WHEN GraphQL integration tests run (dev-server `testClient` suite, `bun run test:graphql`) THEN the role matrix SHALL be proven on the wire: anonymous → 401; teacher/student/parent → constant 403 (identical `FORBIDDEN` code, identical copy in BOTH locales, zero data fields); admin → 200 with well-formed page envelopes.
2. WHEN BOLA probes are exercised THEN nonexistent / soft-deleted / foreign student-id causes SHALL yield the identical 403 — a test-table oracle with 0 variant hits.
3. WHEN response shapes are asserted THEN rows/statistics/drill-down pages SHALL match the closed projections (no extra fields, `id` first on rows).
4. WHEN SDL freezes are refreshed THEN the Query-root baseline pins (REQ-031) SHALL hold in CI.

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-030, REQ-031, REQ-021 · **Satisfies**: test scenario (d).

#### REQ-054: Cross-Actor Journey Test (Teacher → Admin)

**User Story:** As the milestone-3 lead, I want one end-to-end cross-actor journey proving producer→consumer handoff plus all denial legs, so the read surface is validated against the real write path (not fixtures) — the repo's journey-layer mandate (`docs/testing/workflow-journey-tests.md`).

#### Acceptance Criteria
1. WHEN the journey suite runs THEN it SHALL execute the §4 J1 journey against a live test server as ONE ordered story (teacher producer → admin consumer), asserting each observable outcome in sequence; the test SHALL run through `bun run test/scripts/run-test.ts <path>`.
2. WHEN denial legs run THEN parent/student/teacher probes against BOTH admin academic queries SHALL return the identical 403 (§4 step D).
3. WHEN the journey passes THEN it SHALL prove the ticket's four test scenarios end-to-end: (a) all students visible; (b) full history on drill-down; (c) low-grade student flagged; (d) non-admin 403.

#### Additional Details
- **Priority**: High · **Complexity**: High · **Dependencies**: REQ-050, REQ-051, REQ-052 · **Assumptions**: journey data is created by the test itself (entity-setup + real mutations), never seed data; no journey-coverage file exists in `test/workflows/admin/` yet (verified gap — one is CREATED here).

### 2.6 Phase Gates & Knowledge Propagation

#### REQ-060: Plan Review Gate (Phase 1.5)

**User Story:** As the orchestrator, I want the plan reviewed against AGENTS.md and layer rules before any implementation task starts, so architecture violations are caught at the cheapest moment.

#### Acceptance Criteria
1. WHEN `plan.md` and `tasks.md` are drafted THEN the plan-review gate SHALL run (via the `plan-review` skill flow) BEFORE any implementation task starts, checking: layer separation, i18n compliance, type-pattern compliance, GraphQL accuracy, permissions/enum discipline, and preservation of this doc's rulings R-A..R-G.
2. WHEN the review finds violations THEN they SHALL be fixed in `plan.md`/`tasks.md` BEFORE implementation; the verdict SHALL be recorded in `outcome/plan-review-R1.md` (repeat until zero critical findings).

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: `plan.md`/`tasks.md` authored (Phase 2/3 of the spec workflow).

#### REQ-061: Mid-Point & Final Review Gates (Phases 2.5 + 8)

**User Story:** As the orchestrator, I want enforced mid-point and closeout review waves, so drift is caught before it propagates and before completion is claimed.

#### Acceptance Criteria
1. WHEN the plan's task count exceeds the multi-phase threshold (expected >10 tasks) THEN a Phase-2.5 mid-point review gate SHALL run after the backend phases complete (before GraphQL/UI phases begin): re-verifying REQ compliance (honest aggregates, closed projections, denial constancy) against the half-built tree, recorded in `outcome/`.
2. WHEN all implementation tasks close THEN a Phase-8 final review wave SHALL verify: zero new mutations on the admin academic surface (grep, REQ-022.3); sibling surfaces byte-identical (diff check, REQ-031.4); `bun quality-gate` green; `deferred-items.md` has zero ❌/⚠️ rows; every task checkbox `[x]`; and REQ→task traceability loops with zero misses.
3. WHEN either gate finds findings THEN they SHALL be fixed or ledger-added before the gate passes — a gate cannot pass with unresolved critical findings.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: implementation phases.

#### REQ-062: Knowledge Propagation (Canonical Doc + AGENTS.md)

**User Story:** As a future ticket author, I want a canonical doc for this surface, so its contracts and rulings are discoverable without re-research.

#### Acceptance Criteria
1. WHEN the plan completes THEN a canonical doc SHALL exist at `docs/admin/academic-tracking.md` (verified: NO admin academic-tracking doc exists today) capturing: the admin-scoped query contracts + constant-denial posture, the derivation rulings (no milestone table, R-C), the attention-threshold rulings (D-#s from `plan.md`), the FR-6.3 bridge note (R-A), and the B.11 enum-as-shipped note (R-B).
2. WHEN the doc lands THEN every task's outcome file SHALL exist under `outcome/` (REQ-001.4) so knowledge propagates forward. Root `AGENTS.md` and `.agents/instructions/` are hand-curated rule files — plan work NEVER creates or updates them; `docs/admin/academic-tracking.md` is the discoverability point.

#### Additional Details
- **Priority**: Medium · **Complexity**: Low · **Dependencies**: implementation complete.

---

## 3. UX/Navigation Requirements (MANDATORY)

### 3.1 New Routes & Role-Based Access — roles in this repo are exactly `admin`, `teacher`, `student`, `parent` (`backend/db/schema/enums.ts:9`); no other roles exist.

| Route | Purpose | Guard | Roles with Access |
|---|---|---|---|
| `/admin/academic-tracking` | Academic dashboard: all-students paged rows (memorization/revision positions, grade summaries, attention flags) + aggregate advancement statistics | `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/academic-tracking" })` + query-level admin scope | Admin |
| `/admin/academic-tracking/[studentId]` | Per-student drill-down: full homework history (Jadid & Madi), grades, report history, progress signal | Same page guard + service-level admin gate + constant-denial on invalid ids | Admin |
| All other admin routes | Unchanged | Existing guards | — |

### 3.2 Sidebar Navigation Placement

Feature appears as a flat item in the Admin array of the single config `NAV_ITEMS_BY_ROLE[UserRole.Admin]` (`frontend/views/dashboard/nav/navItems.ts:156-187`), directly after the `/students` entry (its academic sibling): Dashboard · Notifications · Users · Teachers · **Students → Academic Tracking (NEW)** · Plans · Lessons · Audit · Finances · Broadcasts · Analytics · Session Governance · Disputes · Profile. Both drawers inherit it; no new group.

### 3.3 Role-Based Access Matrix

| Surface | Admin | Teacher | Student | Parent |
|---|---|---|---|---|
| `/admin/academic-tracking` + `[studentId]` pages | Allow | Page-redirect to own dashboard (withPageAuth); query → constant 403 | Same | Same |
| Admin academic GraphQL queries | 200 (all students in scope) | 403 constant | 403 constant | 403 constant |
| Participant/parent/teacher homework queries | unchanged (admin gets nothing there — not their surface) | unchanged | unchanged | unchanged |

---

## 4. Cross-Actor Workflow Scenario (Journey)

This feature spans 2+ actors interacting over shared state (teacher writes academic data; admin reads it), so exactly ONE journey is captured per the workflow-journey mandate; it maps 1:1 onto a `test/workflows/admin/` journey test (REQ-054). **State ownership note (explicit):** the admin academic surface itself introduces NO mutable shared state — it is read-only derivation. The only state machine in play is the underlying session → report/homework lifecycle, owned by the shipped teacher producer surface; this feature is a pure observer of its committed rows.

### 4.1 Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Teacher | `teacher` | produce academic data: complete a session, submit `submitSessionReport` with Jadid/Madi homework blocks and previous-grades | read any admin academic query; view other students' homework |
| Admin | `admin` | read the academic dashboard + any student's drill-down (all students in scope) | mutate anything through this surface; impersonate a teacher's submission |
| Parent | `parent` | read their own children via the parent portal (unchanged) | read admin academic queries (403) |
| Student | `student` | read own homework via `myHomework` (unchanged) | read admin academic queries (403) |

### 4.2 Journey J1 — Teacher submits homework; Admin observes it in academic tracking

Ordered step list (actor → action → shared-state change → observable outcome):

1. Teacher → completes a session for student S (`status = completed`) → session row terminal → S gains one attendance-eligible session.
2. Teacher → submits the session report with homework: Jadid block (surah/juz ref B.11 + ayah range) and Madi block, plus `previousGrades` → `reports` row (notes + rating 0-5) AND `home_work` row (`current_*` = Jadid, `revision_*` = Madi) committed; earlier homework row graded write-once → the student's academic timeline advances.
3. (Shared state observable) → S's latest Jadid/Madi positions, grade aggregates, and advancement statistics change for every future reader.
4. Admin → opens `/admin/academic-tracking` → dashboard row for S reflects the NEW latest positions and updated grade summary; S's flag status recomputes against the plan-ruled thresholds (e.g. a low grade can flip S into "needing attention").
5. Admin → drills into `/admin/academic-tracking/<S>` → the full history shows the new homework row (both tracks) and the new report row, newest-first.
6. **Denial steps** → Teacher / Student / Parent each attempt both admin academic queries → every attempt returns the identical constant 403, zero data, both locales.

### 4.3 Cross-Actor EARS Criteria (observer = Admin)

1. WHEN a teacher submits a session report with homework for student S THEN the admin dashboard SHALL reflect S's new latest Jadid/Madi positions and updated grade summary on the next read, with no cache of this feature's own extending past committed data.
2. WHEN a teacher grades prior homework (`previousGrades`) THEN the admin drill-down SHALL show the graded values on those history rows (write-once semantics preserved — grades never silently change once set).
3. IF the student S has zero academic rows THEN the admin SHALL observe S listed with null academic fields and localized empty states — never an error and never omission.
4. WHEN a non-admin actor (teacher/student/parent) attempts either admin academic query THEN the system SHALL return the same constant 403 with zero data (denial oracle; REQ-021).
5. WHEN any admin read executes THEN it SHALL NOT alter the session/report/homework lifecycle state (no side effects on producer-owned state — read-only observer).

---

## 5. Non-Functional Requirements

### 5.1 Performance
- WHEN the dashboard renders THEN reads SHALL be windowed (page/pageSize) with honest totals; no unbounded student fan-out, no per-row N+1 service calls inside one page (batch/composite reads per the PlatformAnalytics snapshot pattern).
- WHEN lookups execute THEN they SHALL be index-aware (`home_work_session_id_idx`, `session_student_id_idx`, `progress_student_id_idx` exist; the plan justifies any new hot read path against existing indexes).
- WHEN large directories page deeply THEN the existing scan-ceiling discipline SHALL apply (REQ-014.1) — the surface degrades to an empty window + honest total, never a slow full scan.

### 5.2 Security
- WHEN authorization fails THEN BFLA (role scope), BOLA (identity from context, id validation), and BOPLA (closed projections) SHALL each be enforced by construction (REQ-020/021/023).
- WHEN denials log THEN each SHALL emit ≤1 bounded `logDomainError` via the localized-domain-error discipline — never logging student academic data fields on denial paths.
- WHEN user-facing error strings are produced THEN they SHALL come from `errorsTranslations` (localized, never hardcoded) per the i18n mandate.

### 5.3 Usability
- WHEN an admin uses Arabic THEN every label, empty state, flag, and statistic SHALL render RTL-complete from `shared/locale/ar/adminAcademic` with parity proven by the parity test.
- WHEN empty/error/denied states occur THEN the UI SHALL render the existing localized primitives (`IconCircleEmptyState`-style empty, `ErrorRetryAlert` retry, `PermissionDeniedFallback` denied) — never blank panels, never raw server messages.

### 5.4 Reliability
- IF a transient query error occurs THEN the dashboard SHALL offer retry without losing already-rendered sections (stale-data tolerance precedent: analytics keeps the last snapshot visible).
- WHEN the server returns domain errors THEN they SHALL follow the existing GraphQL error contract (structured `extensions.code`, no stack leaks).

---

## 6. Scope Boundaries

### 6.1 IN Scope

| Included | Detail |
|---|---|
| Read-only admin dashboard | `/admin/academic-tracking` — all-students paged academic rows (latest Jadid/Madi Surah/Juz positions, grade summaries, attention flags) + aggregate advancement statistics |
| Per-student drill-down | `/admin/academic-tracking/[studentId]` — full homework history (both tracks, grades, ayah ranges, surah/juz), report history, progress count, newest-first |
| Data derivation layer | New cross-student repo reads + a focused admin academic service over EXISTING `home_work` / `reports` / `session` / `users` / `students` / `progress` tables only |
| New admin GraphQL queries | New query file(s) under `backend/graphql/query/admin/` + closed-projection ReturnTypes in `backend/types/` + Pothos objects + SDL/codegen refresh (REQ-030/031) |
| Frontend | Client containers, GraphQL documents (`frontend/graphql/sharedDocuments/admin/`), admin sidebar nav entry (REQ-041), full `adminAcademic` en/ar namespace ceremony (REQ-042) |
| Tests | Repo tests (`runInRollback` + tx), service tests, GraphQL wire/integration tests, one cross-actor journey test (REQ-050..054) |
| Canonical doc | `docs/admin/academic-tracking.md` (REQ-062; AGENTS.md stays hand-curated — never updated by plan work) |

### 6.2 OUT of Scope (each excluded deliberately)

| Excluded | Reason (one line) |
|---|---|
| Any new DB table, column, or migration | Milestones derive from `home_work`/`session` as they stand — verified NO milestone table exists anywhere in `backend/db/` (grep, research-schema §(j)); ruling R-C |
| Any mutation endpoint | The surface is strictly read-only — query fields only (REQ-022); a domain-mutation census entry would be required if any mutation shipped, and none does |
| Notifications (in-app, push, email, WS) | Passive monitoring dashboard; the ticket asks for visibility, not alerting — notifications remain the engine's existing lane |
| Parent-portal changes | Parent surface stays byte-locked — this feature adds NEW admin-scoped queries and touches zero existing query files (ruling R-F) |
| Expansion of the `surah_juz_ref` enum | The B.11 decision doc lists all 114 surahs (as examples) but the SHIPPED enum carries 5 surahs + `juz_1..juz_30` (`backend/db/schema/enums.ts:112-139`); expansion belongs to the curriculum lane, not this ticket — this feature consumes the enum as shipped (ruling R-B) |
| Threshold defaults as per-admin settings | The "needing attention" thresholds ship as documented constants ruled at plan time (ruling R-D) — a settings surface would be a new feature with its own authorization analysis |
| CSV/export of the academic directory | The existing admin export-envelope pattern is a precedent, not scope; recorded as a deferred-items candidate if product wants it |

---

## 7. Constraints and Assumptions

### 7.1 Technical Constraints
- Runtime is **Bun** (never raw `node`); DB/service/GraphQL/workflow tests run via `bun run test/scripts/run-test.ts <path>` (log-capture mandate), never raw `bun test`.
- This is **Next.js 16** with breaking-changes discipline: consult `node_modules/next/dist/docs/` before writing any App Router code; routes carry NO `[locale]` segment (cookie-based locale).
- After ANY GraphQL registration change: `bun run generate:gqlSchema` then `bun codegen`, artifacts committed in the SAME changeset; the SDL Query-root freeze pins refresh in the same change (REQ-031).
- Roles are EXACTLY `admin` / `teacher` / `student` / `parent` (`backend/db/schema/enums.ts:9`) — no other role exists to grant or deny.
- Pagination follows the existing LIMIT/OFFSET directory conventions (page/pageSize, bounds-validated, honest totals, scan ceiling) — no cursor pattern exists in the repo and none is introduced.
- Grades are plain integers on a **[0,100]** scale (DB CHECK constraints `home_work_current_grade_check` / `home_work_revision_grade_check`); teacher session rating is a distinct **[0,5]** integer — the two scales never mix in display or aggregation.
- MUI v9 `sx`-only styling; theme-palette colors only; compile-time `shared/locale` system is the only i18n surface; `bun quality-gate` is the gate chain and caches are never cleared.

### 7.2 Business Constraints
- 3 SP milestone-3 ticket (Dev 2 stream): the scope is deliberately a thin read surface over shipped producer data — no producer-side changes.
- The blocker "Session Report Submission with Homework (Jadid & Madi)" is already shipped; its data contract IS this feature's read contract: Jadid → `home_work.current_*` columns, Madi → `home_work.revision_*` columns (`backend/services/classes/session-report.service.ts:133-141`), and the exposed vocabulary names them `jadid`/`madi` (ruling R-G).
- Thresholds (low-grade, slow-progress) ship as documented constants (ruling R-D) — tunable later via a dedicated ticket, not silently per-admin.

### 7.3 Assumptions
- The teacher session-report write path remains the sole producer of academic rows; no other writer of `home_work`/`reports` appears mid-plan.
- `ctx.user` is governance-fresh per request; services re-assert the admin role anyway (belt) — REQ-020.2.
- `progress` remains a skeleton (row counts only); if a future curriculum ticket adds scores/completion columns, this surface's "progress over time" may be enriched then — no pre-emption now.
- Admin scope is platform-wide (all students) by role; no per-academy/tenant partitioning exists in the data model.

### 7.4 Rulings Register (R-A..R-G — consolidated; referenced throughout §1–§5)

- **R-A — FR-6.3 bridge (EXPLICIT note):** the ticket glosses FR-6.3 as "(admin academic tracking)" (`docs/planning/TICKETS.md:2217`), but FR-6.3's authoritative definition is "Progress Update" — the Tajweed-session progress-increment mechanism (`docs/specs/functional-requirements.md:206-208`, inside "## 6. Tajweed Curriculum & Progress"). This feature does NOT redefine FR-6.3; it SURFACES academic advancement driven by FR-6.3's progress increments plus B.11 homework positions (`progress` row counts + latest Jadid/Madi milestones). FR-6.3 itself is untouched.
- **R-B — enum as shipped:** consume `surah_juz_ref` (5 surahs + `juz_1..juz_30`); expansion is the curriculum lane (§6.2).
- **R-C — derivation only:** no new tables/columns/migrations; "milestones" are derived reads (§6.2).
- **R-D — thresholds plan-level:** numeric attention thresholds are design decisions (D-#) fixed in `plan.md` and documented; specs bind the capability (REQ-011.1).
- **R-E — 403 semantics:** page-level non-admin handling is the established `withPageAuth` redirect; the ticket's "403" is satisfied by the constant FORBIDDEN at the data/API layer (REQ-021.4).
- **R-F — siblings untouched:** new admin-scoped queries only; participant/parent/student/teacher surfaces byte-locked (REQ-023.4, REQ-031.4).
- **R-G — track naming:** UI/API vocabulary says Jadid/Madi; storage columns are `current_*`/`revision_*` (§7.2).

---

## 8. Success Criteria

### 8.1 Definition of Done (measurable, mapped to the ticket's four test scenarios — `docs/planning/TICKETS.md:2211-2214`)

- [ ] **Scenario (a) — admin views academic dashboard, all students' progress visible:** an admin querying the dashboard receives a paged row per non-deleted student carrying latest Jadid/Madi positions, grade summaries, and the aggregate statistics block; proven by repo + service + wire tests (REQ-010, REQ-012, REQ-014) and exercised end-to-end in the journey (REQ-054).
- [ ] **Scenario (b) — admin drills into a specific student, full academic history:** the drill-down returns the student's complete paginated homework history (both tracks, grades, ayah ranges, surah/juz), report history, and progress count; single-track and zero-row students render honest null/empty states (REQ-013.1-3, REQ-013.6).
- [ ] **Scenario (c) — students with low grades flagged for attention:** a student crossing the plan-ruled low-grade or slow-progress threshold is flagged on the dashboard row and counted in the statistics; a below-threshold fixture flips the flag in tests (REQ-011, REQ-051).
- [ ] **Scenario (d) — non-admin attempts access, gets 403:** teacher/student/parent probes of both admin academic queries return the identical constant FORBIDDEN (same code, same copy per locale, zero data); anonymous gets 401; page navigation redirects via `withPageAuth` (REQ-020, REQ-021, REQ-052, REQ-054.2).

### 8.2 Quality Gates (all must hold at closeout)

- [ ] Every touched file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` with exit 0 (REQ-001.5).
- [ ] SDL freeze pins (`schema-surface.test.ts`, `sdl-static-assertions.test.ts`) refreshed AND `bun run generate:gqlSchema` + `bun codegen` artifacts committed in the SAME changeset as the query registrations (REQ-031.1-2).
- [ ] `bun quality-gate` green; baseline deltas attributable against `outcome/baseline-*` (REQ-001.1).
- [ ] `deferred-items.md` carries zero ❌/⚠️ rows; every task checkbox `[x]`; REQ→task traceability loop (`grep -oE 'REQ-[0-9]+' specs.md | sort -u` vs `tasks.md`) misses zero ids (REQ-061.2).
- [ ] Non-functional criteria (§5) hold: windowed reads, no N+1, constant denials, ≤1 bounded `logDomainError` per denial, full en/ar parity.

---

## 9. Traceability

### 9.1 Ticket Acceptance Criteria → REQ ids (gherkin blocks at `docs/planning/TICKETS.md:2196-2209`)

| Ticket acceptance criterion (verbatim topic) | Lines | REQ ids |
|---|---|---|
| AC-1 · sees "student memorization progress (current Surah/Juz)" | `:2196-2198` | REQ-010, REQ-030, REQ-040 |
| AC-1 · sees "revision milestones (Madi homework grades)" | `:2199-2200` | REQ-010, REQ-013 |
| AC-1 · sees "overall academic advancement statistics" | `:2201-2202` | REQ-012 |
| AC-1 · sees "students needing attention (low grades, slow progress)" | `:2203-2204` | REQ-011 |
| AC-2 · drill-down shows "all homework assignments, grades, and progress over time" | `:2206-2209` | REQ-013, REQ-014 |

### 9.2 Ticket Test Scenarios → REQ ids (`docs/planning/TICKETS.md:2211-2214`)

| Test scenario | REQ ids |
|---|---|
| (a) Admin views academic dashboard — all students' progress visible | REQ-010, REQ-012, REQ-014, REQ-030, REQ-031, REQ-040, REQ-041, REQ-042, REQ-050, REQ-051 |
| (b) Admin drills into specific student — full academic history | REQ-013, REQ-023, REQ-054 |
| (c) Students with low grades — flagged for attention | REQ-011, REQ-051 |
| (d) Non-admin attempts access — 403 | REQ-020, REQ-021, REQ-022, REQ-052, REQ-054 |
| Cross-cutting (apply to every scenario) | REQ-001 (baseline/outcome protocol), REQ-002 (i18n/enum compliance), REQ-060 (plan-review gate), REQ-061 (mid-point + final gates), REQ-062 (canonical doc + knowledge propagation) |

**REQ-id inventory note:** defined ids are REQ-001, REQ-002, REQ-010..014, REQ-020..023, REQ-030..031, REQ-040..042, REQ-050..052, REQ-054, REQ-060..062 — 23 requirements, every one of which appears in §9.1 or §9.2 above. **REQ-053 is intentionally reserved/unused** (a deliberate gap mirroring the exemplar's 05x grouping, where the journey slot is REQ-054); it is not a defined requirement and is excluded from the REQ→task traceability loop by design.
