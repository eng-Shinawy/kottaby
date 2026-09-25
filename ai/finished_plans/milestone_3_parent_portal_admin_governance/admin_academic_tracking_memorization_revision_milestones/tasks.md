# Tasks: Admin Academic Tracking (Memorization & Revision Milestones)

**Plan directory (verbatim):** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones`
**Specs:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/specs.md`
**Plan:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/plan.md`
**Deferred-items ledger:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`

> Source of truth: `specs.md` (REQ-001/002 protocol, REQ-010..014 reads, REQ-020..023 authz, REQ-030/031 GraphQL, REQ-040..042 UX/i18n, REQ-050..052/054 testing, REQ-060..062 gates) + `plan.md` (D1..D9 rulings; two new SDL queries; zero schema changes; Jadid=`current_*`, Madi=`revision_*`).

## Document Information

- **Feature Name**: Admin Academic Tracking (Memorization & Revision Milestones)
- **Ticket**: `docs/planning/TICKETS.md:2184` (Milestone 3, admin governance stream)
- **Target Directory**: `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones`
- **Outcome Directory**: `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-21
- **Author**: Tasks author (Phase 3 of spec-driven development)
- **Related Documents**: Requirements `specs.md` · Design `plan.md` · Ledger `deferred-items.md` · Baseline `outcome/phase-0-baseline-outcome.md`

### Numbering & Traceability Conventions

- Task ids `X.Y` follow phases; every implementation task carries the pipeline: `.QL` (per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, exit 0) → `.TE` (4-tier test engineering) → `.SEC` (BOLA/BOPLA/BFLA audit) → `.SR` (semantic review) → `.IV` (instruction verification). Strict order; no skipping.
- Outcome files: `outcome/<task-id>-outcome.md` per task (MANDATORY before `[x]`).
- `_Requirements:` lines list REQ ids EXPANDED — no ranges — grep-verifiable against `specs.md`.
- Test runners: db/service/wire/workflow tests via `bun run test/scripts/run-test.ts <path>` ONLY (NEVER raw `bun test`).

---

## Non-Negotiable Execution Protocol for All Tasks

1. **P1 — Pre-Execution Outcome Read.** Before executing ANY task, read ALL files under `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/` (starting with `phase-0-baseline-outcome.md`). Prior findings are authoritative — do not re-research what an outcome already settled (REQ-001.3).
2. **P2 — Per-File Quality Verification Loop.** Whenever a file is created/modified, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 (progressive tsgo → oxlint → biome → lint → duplicates, short-circuits at first failure) BEFORE touching the next file (REQ-001.5). NEVER clear caches; never add `oxlint-disable`/`jscpd:ignore`.
3. **P3 — Test Discipline.** Run suites via `bun run test/scripts/run-test.ts <path>` — NEVER raw `bun test`. DB tests: ALWAYS `runInRollback`, pass `tx` to EVERY repo call inside the transaction, NEVER `expect(...).rejects.toThrow()` inside rollback (try/catch helper only), fixtures via `backend/db/test/entity-setup.ts` (never seed data). Journey tests (`test/workflows/`): real services + real DB, committed fixtures in `beforeAll`, tracked hard-delete cleanup in `afterAll`, NO `runInRollback`.
4. **P4 — Semantic Review Before `[x]`.** Before marking any subtask complete, run the X.Y.SR checklist. Code comments MUST NOT contain REQ ids, task ids, or `.ai/plans` paths.
5. **P5 — Outcome File Per Task.** After each task completes, write `outcome/<task-id>-outcome.md` (findings, changes, cross-file dependencies, carry-overs) (REQ-001.4).
6. **P6 — Checkbox Tracking.** Flip `[ ]` → `[x]` in THIS file only after P2/P4/P5 are satisfied.
7. **P7 — Instruction-File Reality.** `sub-loop.ts` auto-discovers and prints applicable AGENTS.md + `.agents/instructions/*.instructions.md`; read ALL printed files before editing and respect the Fix-Or-Report rule (fix in-file; report cross-file dependencies to the orchestrator — never edit unassigned files).

### Anti-Pattern Pins (build-time compliance, binding on every task — plan D9)

- FORBIDDEN: `Translation.` enum (does not exist), two-arg `getTranslations`, `t("key")` raw calls, `next-intl`, `getBackendTranslations`, `shared/messages/`, `console.*`, hardcoded colors, MUI v9 style props (`fontWeight`/`mb`/`p` as direct props — use `sx`), `*Outline` icon names.
- Server components: `getTranslations(locale)` single-arg from `@/shared/locale/server`; client components: `useAppTranslation(<handle>)` from `@/shared/locale/client`; resolvers: `ctx.t("errorsTranslations")`; services receive `locale: string` + `getServerTranslations(locale, ...)` from `@/shared/locale/server-graphql`.
- Loggers: backend `@/backend/lib/logger` (denials via `logDomainError`, ≤1 bounded call per denial); frontend `@/frontend/lib/logger`.
- All enums (`UserRole`, `SurahJuzRef`, `SessionStatus`) are VALUE imports from `@/backend/enum/...` — never `import type` at runtime, never re-registered in Pothos.
- No new barrels beyond the two mandated registration edits (pothos/admin barrel line + query/admin barrel line); deep imports everywhere else.

---

## Phase 0 — Pre-Implementation Baseline (DONE)

- [x] 0.1 Baseline recorded; deferred-items ledger created
  - Baseline captured in `outcome/phase-0-baseline-outcome.md`: **tsgo 0 errors · biome 0 warnings · lint exit 0**. Ledger `deferred-items.md` created from template.
  - _Requirements: REQ-001_

- [x] 0.2 Plan review gate (Phase 1.5)
  - `specs.md` + `plan.md` reviewed via the `@plan-review` skill against all layer AGENTS.md rules BEFORE tasks authoring; zero violations outstanding. Outcome: `outcome/plan-review-R1.md`.
  - _Requirements: REQ-060_

---

## Phase 1 — Types + Repository (no schema changes — plan D1/D4)

> **EXPLICITLY NO drizzle migration**: this feature derives all data read-time from `home_work` (`current_*`=Jadid, `revision_*`=Madi, grades CHECK [0,100]), `reports`, `session`, `students`, `users`, `progress`. Zero new tables/columns/migrations/push runs (D1, specs R-C).

- [x] 1.1 Types file `backend/types/admin/admin-academic-tracking.types.ts`
  - CREATE `backend/types/admin/admin-academic-tracking.types.ts` with ALL derived shapes from plan §3.2 as `readonly`-member type exports, named per repo convention: `AdminAcademicDashboardFiltersSelectType`/`InsertType`-style DB inputs (`AdminAcademicDashboardFiltersSelectType`, `AdminAcademicStudentRowSelectType`, `AdminAcademicStatsSelectType`, `AdminAcademicAttentionSignalSelectType`, `AdminAcademicStudentEchoSelectType`), service/API shapes (`AdminAcademicDashboardPageReturnType`, `AdminAcademicStudentRowReturnType`, `AdminAcademicStatsReturnType`, `AdminAcademicPositionReturnType`, `AdminAcademicGradeSummaryReturnType`, `AdminAcademicAttentionFlagReturnType`, `AdminStudentAcademicDetailReturnType`, `AdminAcademicStudentDetailEchoReturnType`, `AdminAcademicHomeworkEntryReturnType`, `AdminAcademicHomeworkTrackReturnType`, `AdminAcademicReportEntryReturnType`, `AdminAcademicHomeworkPageReturnType`, `AdminAcademicReportPageReturnType`), attention reason union `AdminAcademicAttentionReason = "lowGrade" | "staleProgress"`, and `AdminAcademicDashboardFiltersSubmitInput` / `AdminStudentAcademicDetailSubmitInput` submit inputs. Enums as VALUE imports (`SurahJuzRef`); no local enum literals duplicating registered enums.
  - Reuse `DBTransaction`/`DBQueryExecutor` from `@/backend/types` (never redefine). NO service-layer `.types.ts` (rule) — this file is the single canonical home.
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/admin/admin-academic-tracking.types.ts --lifecycle duplicates` — exit 0
  - [x] 1.1.TE **Test Engineering**: type-only file — compile-time pinning via QL tsgo pass; runtime coverage flows through tasks 1.2/2.2/5.x suites
  - [x] 1.1.SEC **Security & Tenancy Audit**: shapes expose NO billing/dispute/confirmation columns or teacher-private fields; `isDeleted` exposed ONLY on the drill-down echo (D7 governance banner)
  - [x] 1.1.SR **Semantic Review**: all members `readonly`; enums imported as values; no cross-layer imports; no duplicate type names colliding with `@/backend/types` barrel
  - [x] 1.1.IV **Instruction Verification**: sub-loop-printed files — `backend/types/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` — read & validated
  - Write outcome: `outcome/1.1-types-outcome.md`
  - _Requirements: REQ-002, REQ-013, REQ-023_

- [x] 1.2 Admin cross-student aggregation repository `backend/db/repo/admin/academic-tracking.repository.ts`
  - CREATE `backend/db/repo/admin/academic-tracking.repository.ts`, namespace `AdminAcademicTrackingRepository`, with the five methods from plan §5.2, all single-statement guarded SELECTs, `tx` LAST, NO prepared statements, NO `inArray` + placeholder:
    - `listStudentAcademicRows(filters: AdminAcademicDashboardFiltersSelectType, now: Date, limit: number, offset: number, tx: DBTransaction)` — `users` (student role lane) LEFT JOIN LATERAL newest graded `home_work` row per Jadid/Madi lane (`ORDER BY created_at DESC, id DESC LIMIT 1`, graded-first with ungraded fallback per D2), per-student conditional `count`/`avg` grade summaries (`sql<number>` + `.mapWith(Number)`, cloning `platform-analytics.repository.ts:117-424`), `progressRowCount` count, `lastGradedHomeworkAt`, search filter on name/email (LIKE wildcards escaped via the student-directory discipline, `student.repository.directory.helpers.ts:56-60`); predicate `users.isDeleted = false` (dashboard excludes soft-deleted — D7); ordering deterministic.
    - `countStudentAcademicRows(filters, tx)` — SAME predicate set as the list (single shared predicate extract so list/count never drift), honest `total`.
    - `getAcademicStats(now, tx)` — ONE conditional-aggregation statement over `home_work ⋈ session ⋝ users` producing `trackedStudentCount`, `studentsWithGradedHomeworkCount`, `averageJadidGrade`, `averageMadiGrade`, `needingAttentionCount` inputs (attention count computed in service helpers from `listAttentionSignals` output — no client args bound the window).
    - `listAttentionSignals(now, tx)` — per-student recent graded window inputs bounded by the service constants (D3), NOT by client args.
    - `getStudentEchoById(studentId, tx)` — `id, fullName, email, isDeleted`; soft-deleted students RETURN (D7); returns `null` for missing ids.
  - NO writes anywhere; NO N+1 (LATERAL joins windowed by the page slice, never correlated per-row subqueries — D4).
  - Drill-down reads REUSE existing readers unchanged: `HomeWorkRepository.listForStudent`/`countForStudent` (`home-work.repository.ts:232,293`), `ReportRepository.listForStudent`/`countForStudent` (`report.repository.ts:186,241`), `ProgressRepository.countForStudent` (`progress.repository.ts:58`) — all tx-last, called by the SERVICE not this repo.
  - [x] 1.2.QL **Quality Loop**: sub-loop exit 0 on the new repo file
  - [x] 1.2.TE **Test Engineering** (4-Tier, REQ-050 suite `backend/db/test/repo/admin/academic-tracking.repository.test.ts` via `bun run test/scripts/run-test.ts`): **Tier 1** 100% branch coverage of every method incl. empty result sets; **Tier 2** zero graded rows (avg null, not flagged), single-row windows, grade bounds 0/100, page-slice boundaries, soft-deleted-student exclusion from dashboard rows + inclusion in echo; **Tier 3** concurrent overlapping reads (`Promise.allSettled`) inside one rollback; **Tier 4** LIKE wildcard probes (`%`, `_`, `\` escape) on `search`. ALL tests `runInRollback`, `tx` threaded to every call, try/catch rejection helper (NEVER `.rejects.toThrow` inside rollback), fixtures via `entity-setup.ts` (never seed data).
  - [x] 1.2.SEC **Security & Tenancy Audit**: repo is data-access-only (no role logic — gate lives in service); dashboard predicate hard-seals `isDeleted = false`; joins cannot fan out cross-student; search input escaped
  - [x] 1.2.SR **Semantic Review**: list/count share one predicate extract; LATERAL bounded by page slice; no business logic absorbed; ordering stable (`created_at DESC, id DESC`)
  - [x] 1.2.IV **Instruction Verification**: `backend/db/repo/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` read & validated
  - Write outcome: `outcome/1.2-repo-outcome.md`
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-023, REQ-050_

---

## Phase 2 — Service layer

- [x] 2.1 Constants + helpers + mappers `backend/services/admin/admin-academic-tracking.{constants,helpers,mappers}.ts`
  - CREATE `backend/services/admin/admin-academic-tracking.constants.ts` (D3 — named constants, NO service-layer `.types.ts`):
    - `NEEDS_ATTENTION_LOW_AVG_GRADE = 60` — flag `lowGrade` when the average of the last `NEEDS_ATTENTION_RECENT_WINDOW = 10` graded Jadid `current_grade` rows is < 60; fewer rows → average over what exists; **zero graded Jadid rows ⇒ NOT flagged** (absence ≠ failure).
    - `NEEDS_ATTENTION_STALE_DAYS = 14` — flag `staleProgress` when the student has ≥1 `completed` session AND zero graded homework rows in the last 14 days (staleness anchored on graded rows' `updated_at`, falling back to `created_at`; "now" = the single captured transaction timestamp).
  - CREATE `backend/services/admin/admin-academic-tracking.helpers.ts`: pure threshold/flag functions over repo output + `now` → `AdminAcademicAttentionFlagReturnType` (typed-union reasons; both reasons may co-occur; never persisted — D1); pagination bounds validation cloning `adminDirectoryPagination.helpers.ts:52-78` (`page ≥ 1` default 1, `pageSize` 1..100 default 25, violations → localized `ValidationError` thrown BEFORE any DB read; out-of-range page → empty `items` + honest `total`).
  - CREATE `backend/services/admin/admin-academic-tracking.mappers.ts`: projection mapping `AdminAcademicStudentRowSelectType` → ReturnTypes; position composition cloned conceptually from `composeHomeworkPosition` (`parent-monitoring.helpers.ts:334` — newest GRADED row first, fallback newest row carrying a `current_surah_juz`/`revision_surah_juz`; position objects null when the lane has no ref — D2; parent helpers NOT imported cross-domain).
  - [x] 2.1.QL **Quality Loop**: sub-loop exit 0 on all three new files (constants → helpers → mappers order)
  - [x] 2.1.TE **Test Engineering**: pure-function suites for helpers/mappers via `bun run test/scripts/run-test.ts`: Tier 1 all flag arms (`lowGrade` only / `staleProgress` only / both / neither); Tier 2 boundary values (avg exactly 60.0 → not flagged; 59.99 → flagged; 9 vs 10 graded rows; 13 vs 14 vs 15 days stale; null positions; zero graded rows); Tier 3 chaos (`Promise.allSettled` over shuffled windows); Tier 4 adversarial (negative/zero/huge page/pageSize, non-integer studentId → ValidationError pre-DB)
  - [x] 2.1.SEC **Security & Tenancy Audit**: constants are numeric only (no injection surface); validation rejects before DB work
  - [x] 2.1.SR **Semantic Review**: comments clean (no REQ/task ids, no `.ai/plans` paths); no dead branches; pure functions only (no I/O)
  - [x] 2.1.IV **Instruction Verification**: `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` read & validated
  - Write outcome: `outcome/2.1-constants-helpers-mappers-outcome.md`
  - _Requirements: REQ-002, REQ-011, REQ-014_

- [x] 2.2 `AdminAcademicTrackingService` — gate-first, read-only (plan §5.1)
  - CREATE `backend/services/admin/admin-academic-tracking.service.ts`, namespace `AdminAcademicTrackingService`, exporting exactly two methods (signatures verbatim from plan §5.1):
    - `getAcademicDashboard(actorId, filters: AdminAcademicDashboardFiltersSubmitInput, page, pageSize, locale, outerTx?)` → `AdminAcademicDashboardPageReturnType`
    - `getStudentAcademicDetail(actorId, studentId, page, pageSize, locale, outerTx?)` → `AdminStudentAcademicDetailReturnType`
  - Flow (both): ① `assertActorAdminActive(actorId)` FIRST (from `admin-gate.helpers.ts:133` — soft-deleted admin must not read; denial localization via `getServerTranslations(locale, "errorsTranslations")` from `@/shared/locale/server-graphql`) → ② open ONE read-only transaction (or join `outerTx`) capturing `now = new Date()` → ③ bounds validation via 2.1 helpers (pre-DB) → ④ repo reads (dashboard: list+count+stats+signals in `Promise.all` over the SAME tx, `platform-analytics.service.ts:129-158` pattern; drill-down: student echo first — soft-deleted proceeds (D7), missing id → localized `NotFoundError` for ADMIN callers only — then `HomeWorkRepository`/`ReportRepository`/`ProgressRepository` reuse readers, all tx-last) → ⑤ assemble via 2.1 mappers.
  - NO locks, NO mutations, ZERO side effects (plan §5.3/§5.4); logger `@/backend/lib/logger` with `logDomainError` for denials (≤1 bounded call per denial).
  - [x] 2.2.QL **Quality Loop**: sub-loop exit 0 on the service file
  - [x] 2.2.TE **Test Engineering** (REQ-051 suite `backend/services/admin/` test via `bun run test/scripts/run-test.ts`): Tier 1 every branch (admin happy paths both methods; non-admin denial; anonymous; soft-deleted admin denial; nonexistent studentId → NotFound; empty search; out-of-range page → empty items + honest total); Tier 2 zero-graded student (no flag, null summaries), single-track student, unicode/RTL name search; Tier 3 overlapping concurrent reads; Tier 4 forged roles, `search` wildcards. Mock external channels per layer rules; DB access via `runInRollback`.
  - [x] 2.2.SEC **Security & Tenancy Audit**: BOLA — `actorId` from `ctx.user.id` only (never client-supplied); gate runs BEFORE any data read; constant FORBIDDEN for every non-admin regardless of id validity (zero existence oracle — D6); BOPLA — strict typed-field mapping, no `...input` spreads; BFLA — no mutation surface exists at all (REQ-022)
  - [x] 2.2.SR **Semantic Review**: single captured `now` per request; no authz caching; enum VALUE imports; locale threaded everywhere; zero dead branches
  - [x] 2.2.IV **Instruction Verification**: `backend/services/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` read & validated
  - Write outcome: `outcome/2.2-service-outcome.md`
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-020, REQ-021, REQ-022, REQ-023, REQ-051_

---

## Phase 3 — GraphQL (Pothos) — SDL pins + codegen MUST land in the SAME changeset as the queries (never split)

- [x] 3.1 Pothos objects `backend/graphql/pothos/admin/academic-tracking.pothos.ts`
  - CREATE `backend/graphql/pothos/admin/academic-tracking.pothos.ts` with ALL objects from plan §4.1 as single `objectRef<...ReturnType>("GraphQLName")` each: `AdminAcademicDashboardPage`, `AdminAcademicStudentRow`, `AdminAcademicStats`, `AdminAcademicPosition`, `AdminAcademicGradeSummary`, `AdminAcademicAttentionFlag`, `AdminStudentAcademicDetail`, `AdminAcademicStudentDetailEcho`, `AdminAcademicHomeworkPage`, `AdminAcademicHomeworkEntry`, `AdminAcademicHomeworkTrack`, `AdminAcademicReportPage`, `AdminAcademicReportEntry`, plus the `AdminAcademicAttentionReason` enum type (`lowGrade` / `staleProgress` — the ONE new enum; `SurahJuzRef` is the existing registered enum from `pothos/shared/enum.pothos.ts`, NEVER re-registered).
  - ALL types imported from `@/backend/types/admin/admin-academic-tracking.types` (NO local type definitions in Pothos files); nullability marks EXACTLY matching TS nullability per plan §4.1 SDL; `t.exposeID("id")` first on entity shapes; timestamps via `t.expose(..., { type: "DateTime" })`; sibling participant objects (`SessionPothosObject`, `SessionReportPothosObject`, `SessionHomeWorkPothosObject`) NOT touched (R-F).
  - [x] 3.1.QL **Quality Loop**: sub-loop exit 0 per object file
  - [x] 3.1.TE **Test Engineering**: schema-level covered by 3.3 SDL pin test + 5.2 role-matrix integration tests
  - [x] 3.1.SEC **Security & Tenancy Audit**: no field exposes billing/dispute/teacher-private data; `isDeleted` surfaced ONLY on the student echo object (D7 governance)
  - [x] 3.1.SR **Semantic Review**: 1:1 plan §4.1 SDL contract; no duplicated enum; no local types; no barrel added in this task
  - [x] 3.1.IV **Instruction Verification**: `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` read & validated
  - Write outcome: `outcome/3.1-objects-outcome.md`
  - _Requirements: REQ-002, REQ-030_

- [x] 3.2 Two queries + registration `backend/graphql/query/admin/academic-tracking.query.ts`
  - CREATE `backend/graphql/query/admin/academic-tracking.query.ts` registering BOTH root query fields by side effect (NO named exports): `adminAcademicDashboard(page: Int = 1, pageSize: Int = 25, search: String)` and `adminStudentAcademicDetail(studentId: Int!, page: Int = 1, pageSize: Int = 25)` — arg conventions cloning `adminDirectoryPagination.helpers.ts:52-78` (page positive int default 1; pageSize 1..100 default 25; `studentId` mirrors the `t.arg.int({ required: true })` precedent `parent-monitoring.query.ts:150-152`).
  - EVERY field carries `authScopes` from the shared prelude `adminOnlyAuthScopes` (`backend/graphql/shared/admin-prelude.ts:24-37` — the explicit conjunction `$all: { authenticated: true, role: [UserRole.Admin] }`; `UserRole` VALUE import) plus `requireAdminUser`; the `if (!ctx.user)` narrowing branch throws `UnauthorizedError` via `await ctx.t("errorsTranslations")` (localized, 401 pre-resolver). Resolvers delegate to `AdminAcademicTrackingService` passing `ctx.user.id`, args, `ctx.locale` — resolvers throw nothing directly (`backend/graphql/AGENTS.md` rule; service `DomainError`s masked by `finalizeGraphqlErrors`).
  - Registration (the ONLY two barrel touches, per D5): `backend/graphql/pothos/admin/index.ts:8-14` gains ONE export line for the new pothos file; `backend/graphql/query/admin/index.ts:12-18` gains ONE side-effect import line. Verify the side-effect chain into `query/index.ts` → `gqlSchema.ts` needs no further edits. ZERO new mutations (read-only feature — REQ-022).
  - [x] 3.2.QL **Quality Loop**: sub-loop exit 0 on the query file + both touched barrels
  - [x] 3.2.TE **Test Engineering**: runtime behavior pinned by the 5.2 role-matrix integration suite; inline: schema introspection via dev boot confirms both fields register with correct arg shapes
  - [x] 3.2.SEC **Security & Tenancy Audit**: BFLA — teacher/student/parent deny 403 pre-service via the scope gate; BOLA — no adminId arg exists; BOPLA — no spread of args into service calls beyond typed fields; public-operations allowlist (`backend/lib/gateway/public-operations.ts`) confirmed to NEED NO new entries (both fields authenticated-only)
  - [x] 3.2.SR **Semantic Review**: scope fields unchanged on the 7 existing admin queries; zero drift on participant/parent query registrations
  - [x] 3.2.IV **Instruction Verification**: `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md`, `backend/AGENTS.md`, `.agents/instructions/backend.instructions.md` read & validated
  - Write outcome: `outcome/3.2-queries-outcome.md`
  - _Requirements: REQ-013, REQ-020, REQ-021, REQ-022, REQ-023, REQ-030_

- [x] 3.3 SDL pin refresh + codegen artifacts (SAME changeset as 3.1/3.2 — never split; D5/REQ-031)
  - In the SAME changeset as 3.1/3.2: UPDATE `backend/graphql/test/schema-surface.test.ts` + `backend/graphql/test/sdl-static-assertions.test.ts` to pin the refreshed 57 → 59 ops baseline (query-field names, arg shapes, new object/enum types; also pin that root `Mutation` gains ZERO fields and the 7 existing admin queries + participant/parent surfaces are byte-unchanged — R-F); run `bun run generate:gqlSchema` (regenerating `frontend/graphql/generated/schema.graphql`) then `bun codegen` (regenerating `frontend/graphql/generated/gql/graphql.ts`); COMMIT the regenerated artifacts together with the registrations — generated files are never hand-edited.
  - [x] 3.3.QL **Quality Loop**: sub-loop exit 0 on both touched pin-test files (generated output excluded from lint by config — verify, do not hand-edit)
  - [x] 3.3.TE **Test Engineering**: the SDL assertions ARE tests (run via `bun run test/scripts/run-test.ts <path>`); Tier 4 rename-drift probe — a deliberate temp rename of either new field must fail the pin (self-check, then revert)
  - [x] 3.3.SEC **Security & Tenancy Audit**: audit the generated diff — ZERO schema churn beyond the two additions + new object/enum types; no new anonymous operation
  - [x] 3.3.SR **Semantic Review**: artifacts committed same-changeset; pins updated not deleted
  - [x] 3.3.IV **Instruction Verification**: `backend/graphql/AGENTS.md`, `.agents/instructions/tests.instructions.md` read & validated
  - Write outcome: `outcome/3.3-sdl-codegen-outcome.md`
  - _Requirements: REQ-023, REQ-030, REQ-031_

---

## Phase 3.5 — MID-POINT REVIEW GATE (blocking)

- [x] 3.5 Backend mid-point review (spec REQ-061; `@plan-review`/`code-review` skill, fresh subagent)
  - Scope: Phases 1–3 diff against specs §5/§6/§8 + plan D1..D9 + all layer AGENTS.md. Checklist: no schema drift (D1), no N+1 (D4), gates identical on both queries (D6), no client-bound windows (D3), service-layer translation ban honored (D8), soft-delete behavior (D7), test discipline (`run-test.ts`, no raw `bun test`). Blockers fixed before Phase 4; findings recorded in `outcome/3.5-midpoint-review-outcome.md`.
  - _Requirements: REQ-060, REQ-061_

---

## Phase 4 — Frontend (routes, containers, states, nav, i18n)

- [x] 4.1 `adminAcademic` i18n namespace — full ceremony (en + ar) + parity test
  - CREATE `shared/locale/types/adminAcademic/index.ts` (typed namespace schema: dashboard labels, stats labels, position/grade labels, attention-reason labels `lowGrade`/`staleProgress`, detail-page labels, governance banner "account deleted", pagination/empty-state strings; pluralized counts as `(count: number) => string`; interpolations as typed functions) and register the namespace in the compile-time locale system's namespace registry (same pattern as `parentMonitoring`).
  - CREATE `shared/locale/en/adminAcademic/index.ts` + `shared/locale/ar/adminAcademic/index.ts` (directory + `index.ts` leaf — the `shared/locale/en/adminStudents/index.ts` convention) — full Arabic mirror, RTL-safe strings, zero hardcoded strings elsewhere.
  - CREATE `shared/locale/adminAcademic-namespace.parity.test.ts` cloning the existing `shared/locale/*-namespace.parity.test.ts` pattern: en/ar key parity + type-shape parity.
  - Also add the `academicTracking` dashboard-nav label key to the EXISTING dashboard namespace (en + ar) used by `navItems.ts` (task 4.3 consumes it).
  - [x] 4.1.QL **Quality Loop**: sub-loop exit 0 on every new/updated locale file
  - [x] 4.1.TE **Test Engineering**: parity test green via `bun run test/scripts/run-test.ts shared/locale/adminAcademic-namespace.parity.test.ts`; Tier 2 unicode/RTL Arabic strings; interpolation boundary values
  - [x] 4.1.SEC **Security & Tenancy Audit**: no locale string leaks existence/deletion cause to non-admins (constant-denial copy stays in `errorsTranslations`, unchanged)
  - [x] 4.1.SR **Semantic Review**: plural/interpolation signatures typed; no `Translation.` enum; no raw `t("key")`; no next-intl imports
  - [x] 4.1.IV **Instruction Verification**: `shared/AGENTS.md` + sub-loop-printed files read & validated
  - Write outcome: `outcome/4.1-i18n-outcome.md`
  - _Requirements: REQ-002, REQ-042_

- [x] 4.2 Route shells `app/(dashboard)/admin/academic-tracking/page.tsx` + `[studentId]/page.tsx`
  - CREATE `app/(dashboard)/admin/academic-tracking/page.tsx` (server component): `withPageAuth` wrapper with `roles: [UserRole.Admin]` (canonical admin usage precedent `app/(dashboard)/admin/analytics/page.tsx:37`); `getTranslations(locale)` SINGLE-ARG from `@/shared/locale/server` (never two-arg); renders the dashboard container (task 4.4). Soft-nav non-admin handling = established `withPageAuth` redirect — NO new HTTP-403 page (D6).
  - CREATE `app/(dashboard)/admin/academic-tracking/[studentId]/page.tsx` (server component): same auth wrapper; parses `studentId` route param; renders the drill-down container; localized page title from `adminAcademic` namespace.
  - NO fetching in the shell (client containers own Apollo reads); NO prop-drilled data.
  - [x] 4.2.QL **Quality Loop**: sub-loop exit 0 on both page files
  - [x] 4.2.TE **Test Engineering**: page-level behavior pinned by the 5.1 journey (admin reaches dashboard; teacher redirected by `withPageAuth`); inline: `UserRole` VALUE import compile check
  - [x] 4.2.SEC **Security & Tenancy Audit**: roles gate is `[UserRole.Admin]` ONLY (never `roles: undefined`); no client-visible data in the shell; drill-down id never used to bypass — data still sealed by the GraphQL constant 403
  - [x] 4.2.SR **Semantic Review**: single-arg `getTranslations`; no MUI style props; `React.SubmitEvent`/no deprecated APIs; no hardcoded colors
  - [x] 4.2.IV **Instruction Verification**: `app/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md` read & validated
  - Write outcome: `outcome/4.2-routes-outcome.md`
  - _Requirements: REQ-002, REQ-040_

- [x] 4.3 Nav entry after `/students` in `frontend/views/dashboard/nav/navItems.ts`
  - UPDATE `frontend/views/dashboard/nav/navItems.ts`: INSERT the academic-tracking item into the ADMIN array immediately AFTER the `/students` entry (~line 161): `label: "academicTracking"` dashboard-namespace key, route `/admin/academic-tracking`, icon consistent with adjacent entries (verified `*Outlined` naming), admin-only visibility (item lives in the admin-scoped block so teacher/student/parent never see it — plan §6.2).
  - UPDATE the dashboard nav namespace en + ar with `academicTracking` label translation (paired with 4.1).
  - [x] 4.3.QL **Quality Loop**: sub-loop exit 0 on `navItems.ts` + touched locale files
  - [x] 4.3.TE **Test Engineering**: nav item asserted in the 5.1 journey (admin sees entry post-login); Tier 2 RTL label renders
  - [x] 4.3.SEC **Security & Tenancy Audit**: entry exists ONLY in the admin-scoped nav block — grep-prove no teacher/student/parent block gained it
  - [x] 4.3.SR **Semantic Review**: placement after `/students` exact; no style props; icon name not `*Outline`
  - [x] 4.3.IV **Instruction Verification**: `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md` read & validated
  - Write outcome: `outcome/4.3-nav-outcome.md`
  - _Requirements: REQ-041_

- [x] 4.4 Containers + states components under `frontend/views/admin/academic-tracking/`
  - CREATE `frontend/graphql/sharedDocuments/admin/academic-tracking.documents.ts` + sibling contract test `frontend/graphql/sharedDocuments/admin/academic-tracking.documents.test.ts` (the `admin-*.documents.test.ts` pattern, REQ-031.3): `AdminAcademicDashboardQueryDocument` + `AdminStudentAcademicDetailQueryDocument` — GraphQL documents matching plan §4.1 SDL; `id` field on EVERY object type (Apollo cache normalization); NO `useLazyQuery` — stateful `useQuery` only; hooks imported from `"@apollo/client/react"`; index barrel `frontend/graphql/sharedDocuments/admin/index.ts` gains one export line.
  - CREATE `frontend/views/admin/academic-tracking/academic-tracking-dashboard.container.tsx` (client): `useAppTranslation("adminAcademic")`; `useQuery(AdminAcademicDashboardQueryDocument)` with `page`/`pageSize`/`search` state (page ≥ 1, pageSize 1..100, mirroring the API contract — REQ-014); stats block, paged rows table with latest Jadid/Madi positions, grade summaries, progress row count, attention flags (localized reason labels); search input with debounced term; pagination controls echoing honest `total`/`pageCount`; rows link to `/admin/academic-tracking/[studentId]`.
  - CREATE `frontend/views/admin/academic-tracking/student-academic-detail.container.tsx` (client): `useQuery(AdminStudentAcademicDetailQueryDocument)` with `studentId` + paginated homework/report pages; full newest-first history (both tracks, grades, ayah ranges, surah/juz, teacher names, `sessionStartedAt` display with `createdAt` fallback — D8); soft-deleted student renders the localized governance banner via `student.isDeleted` (D7); progress row count.
  - CREATE state components `frontend/views/admin/academic-tracking/states/`: `loading-state.tsx`, `error-state.tsx` (renders `PermissionDeniedFallback` on FORBIDDEN errors per D6 deep-link path), `empty-state.tsx` — honest null/empty rendering for zero-row and single-track students (REQ-013.6); shared row/summary subcomponents colocated (NO new barrels — deep imports).
  - ALL styling via `sx` callbacks with theme palette tokens (no hardcoded colors, no MUI style props); logger `@/frontend/lib/logger`.
  - [x] 4.4.QL **Quality Loop**: sub-loop exit 0 on every new frontend file (documents → containers → states order)
  - [x] 4.4.TE **Test Engineering**: UI layer is E2E-only (repo convention — no static/component UI test layer): behavior asserted end-to-end by the 5.1 journey + browser verification per root AGENTS (DOM/accessibility snapshot, console error check); Tier 2 inline: empty/zero-row and single-track render arms reviewed
  - [x] 4.4.SEC **Security & Tenancy Audit**: containers derive `studentId` only from route params; FORBIDDEN renders `PermissionDeniedFallback` with zero data disclosure; no client-side role logic duplicated (gate stays server-side)
  - [x] 4.4.SR **Semantic Review**: `useQuery` stateful only; `id` on all document selections; namespace handle `"adminAcademic"`; no dead code; comments clean
  - [x] 4.4.IV **Instruction Verification**: `frontend/views/AGENTS.md`, `frontend/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend/graphql/AGENTS.md`, `.agents/instructions/frontend.instructions.md` read & validated
  - Write outcome: `outcome/4.4-containers-states-outcome.md`
  - _Requirements: REQ-002, REQ-013, REQ-014, REQ-040_

---

## Phase 5 — Testing: journey (test-first) + GraphQL role matrix

> REQ-050 (repo) and REQ-051 (service) suites were authored inside the 1.2.TE and 2.2.TE pipelines; this phase adds the cross-actor journey and the wire-level role matrix.

- [x] 5.1 Journey test (TEST-FIRST): teacher-submits → admin-observes + non-admin denial
  - CREATE `test/workflows/admin/academic-tracking.journey.test.ts` — ONE file for journey J1 (specs §4.2), authored FIRST (before wiring the frontend beyond Phase 3 — backend surface is already testable via services):
    - Provision the actor cast via the per-domain cast helper in `test/workflows/helpers/` (real admin/teacher/student users; authorization NEVER monkey-patched).
    - Step 1: teacher completes session for student S → shared-state `session.status = completed`.
    - Step 2: teacher submits report + Jadid/Madi blocks (+ write-once grade of the previous row) via real services → `reports` + `home_work` rows committed.
    - Step 3: admin calls `getAcademicDashboard` → asserts S's row reflects the NEW positions, grade summaries, stats, and a below-threshold grade flips `needsAttention` to `["lowGrade"]`.
    - Step 4: admin calls `getStudentAcademicDetail` → asserts the new homework/report rows appear newest-first with correct grades/tracks.
    - Denial D: teacher/student/parent probe BOTH queries → identical constant FORBIDDEN, zero data, same `extensions.code`, in en AND ar (denial-oracle uniformity).
    - Committed fixtures in `beforeAll` + tracked hard-delete cleanup in `afterAll`; NO `runInRollback`; notification boundary spied (this feature dispatches none — assert ZERO).
  - Run: `bun run test/scripts/run-test.ts test/workflows/admin/academic-tracking.journey.test.ts` until green (NEVER raw `bun test`).
  - [x] 5.1.QL **Quality Loop**: sub-loop exit 0 on the journey file
  - [x] 5.1.TE **Test Engineering**: the journey IS the test (tiers embedded per the template's Journey pattern: cross-actor visibility after each step + denial paths both locales)
  - [x] 5.1.SEC **Security & Tenancy Audit**: denial oracle byte-uniform across roles/causes; no fixture leaks cross-test (tracked `afterAll`)
  - [x] 5.1.SR **Semantic Review**: real services + real DB; no monkey-patched authz; fixtures not seed data
  - [x] 5.1.IV **Instruction Verification**: `test/workflows/AGENTS.md`, `.agents/instructions/tests.instructions.md` read & validated
  - Write outcome: `outcome/5.1-journey-outcome.md`
  - _Requirements: REQ-010, REQ-011, REQ-013, REQ-014, REQ-020, REQ-021, REQ-054_

- [x] 5.2 GraphQL integration tests — role matrix + constant denial (REQ-052)
  - CREATE `frontend/graphql/test/admin/academic-tracking.integration.test.ts` (GraphQL integration lane via `setupTestServerLifecycle()` + `testClient` — NEVER raw fetch): full permission matrix from plan §4.4 across BOTH queries × every role:
    - anonymous → 401 `UNAUTHORIZED` pre-resolver, zero data;
    - teacher / student / parent → 403 `FORBIDDEN` with IDENTICAL bytes/copy for every id cause (valid id, foreign id, nonexistent id, malformed id ≤0) in both locales — the constant-denial oracle;
    - admin → 200: paged rows + stats on dashboard; full detail on drill-down; nonexistent `studentId` → localized `NOT_FOUND` (admins only); malformed `studentId` / out-of-range pagination → `VALIDATION` with NO DB read;
    - out-of-range page → empty `items` + honest `total`;
    - `search` LIKE-wildcard probes (`%`, `_`, `\`) → escaped, honest result sets;
    - assertion that responses are strictly READ-ONLY shaped (no mutation affordances).
  - Run: `bun run test/scripts/run-test.ts frontend/graphql/test/admin/academic-tracking.integration.test.ts`.
  - [x] 5.2.QL **Quality Loop**: sub-loop exit 0 on the test file
  - [x] 5.2.TE **Test Engineering**: Tier 1 all matrix cells; Tier 2 locale × id-cause boundary combos, pageSize 1/100/101; Tier 3 parallel probe bursts (`Promise.allSettled`); Tier 4 forged tokens/roles, wildcard injection
  - [x] 5.2.SEC **Security & Tenancy Audit**: proves no existence oracle for non-admins; proves BFLA seal on the two fields; public-operations allowlist untouched
  - [x] 5.2.SR **Semantic Review**: matrix complete (2 queries × 5 caller classes); en+ar copy asserted; no test shortcuts through services where the wire is the target
  - [x] 5.2.IV **Instruction Verification**: `frontend/graphql/AGENTS.md`, test lane instructions, `.agents/instructions/tests.instructions.md` read & validated
  - Write outcome: `outcome/5.2-role-matrix-outcome.md`
  - _Requirements: REQ-020, REQ-021, REQ-022, REQ-023, REQ-052_

---

## Phase 6 — Review gates, knowledge propagation, final gate

- [x] 6.1 Post-implementation parallel review wave (REQ-061)
  - Dispatch parallel review subagents (per the quality-gate skill's wave model): `review-backend` (service/repo/authz), `review-graphql` (pothos + SDL pins), `review-frontend` (containers/documents/i18n), `review-tests` (all four lanes). Scope: the FULL Phase 1–5 diff against specs §2/§5/§8, plan D1..D9, and every layer AGENTS.md. Findings fixed per-file (re-run sub-loop exit 0 on each fixed file); re-review until zero findings. Write `outcome/6.1-postimpl-review-outcome.md`.
  - _Requirements: REQ-001, REQ-061_

- [x] 6.2 Knowledge propagation — canonical doc (REQ-062)
  - Synthesize ALL `outcome/*.md` files into `docs/admin/academic-tracking.md` (Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents): the D1 derived-milestone read model, D3 threshold constants, the constant-denial oracle, the 57→59 SDL freeze-refresh ritual, D7 soft-delete posture, D8 time basis. AGENTS.md and `.agents/instructions/` files are hand-curated — NEVER created or updated by plan work; durable knowledge goes ONLY to `docs/admin/` and the plan's own outcome files.
  - [x] 6.2.QL **Quality Loop**: sub-loop exit 0 on the new doc path (markdown lanes run tsgo-clean; verify no lint fallout)
  - [x] 6.2.TE **Test Engineering**: N/A (documentation)
  - [x] 6.2.SEC **Security & Tenancy Audit**: doc contains no credentials, no fixture secrets, no internal URLs
  - [x] 6.2.SR **Semantic Review**: doc matches shipped behavior (thresholds, gates, routes) — no stale numbers
  - [x] 6.2.IV **Instruction Verification**: docs structure conventions followed (kebab-case, section order)
  - Write outcome: `outcome/6.2-knowledge-propagation-outcome.md`
  - _Requirements: REQ-062_

- [x] 6.3 Final quality gate + baseline comparison + deferred-ledger sweep
  - Run `bun quality-gate` end-to-end (tsgo → oxlint → biome → lint → duplicates; NEVER clear caches). Compare against `outcome/phase-0-baseline-outcome.md` (tsgo 0 errors · biome 0 warnings · lint exit 0) — zero unattributed deltas. Run the REQ→task traceability loop: `grep -oE 'REQ-[0-9]+' specs.md | sort -u` vs this file — zero missing ids. Deferred-ledger sweep (BLOCKING): `grep -c "❌\|⚠️" deferred-items.md` MUST output `0`; any ❌/⚠️ rows block completion. Flip every satisfied checkbox to `[x]`; write `outcome/6.3-final-gate-outcome.md`.
  - _Requirements: REQ-001, REQ-060, REQ-061_

---

## Traceability Map (REQ → tasks)

| REQ | Task(s) |
|---|---|
| REQ-001 | 0.1, 6.1, 6.3 |
| REQ-002 | 1.1, 2.1, 2.2, 3.1, 3.2, 4.1, 4.2, 4.4 |
| REQ-010 | 1.2, 2.2, 5.1 |
| REQ-011 | 1.2, 2.1, 2.2, 5.1 |
| REQ-012 | 1.2, 2.2 |
| REQ-013 | 1.1, 1.2, 2.2, 3.2, 4.4, 5.1 |
| REQ-014 | 1.2, 2.1, 2.2, 4.4, 5.1 |
| REQ-020 | 2.2, 3.2, 5.1, 5.2 |
| REQ-021 | 2.2, 3.2, 5.1, 5.2 |
| REQ-022 | 2.2, 3.2, 5.2 |
| REQ-023 | 1.1, 1.2, 2.2, 3.2, 3.3, 5.2 |
| REQ-030 | 3.1, 3.2, 3.3 |
| REQ-031 | 3.3 |
| REQ-040 | 4.2, 4.4 |
| REQ-041 | 4.3 |
| REQ-042 | 4.1 |
| REQ-050 | 1.2 |
| REQ-051 | 2.2 |
| REQ-052 | 5.2 |
| REQ-054 | 5.1 |
| REQ-060 | 0.2, 3.5, 6.3 |
| REQ-061 | 3.5, 6.1, 6.3 |
| REQ-062 | 6.2 |

REQ-053 — intentionally unused/reserved (no task by design; see specs.md §9 inventory note).

(Every REQ id defined in `specs.md` — all 23 — appears on at least one task `_Requirements:` line and in the table above.)
