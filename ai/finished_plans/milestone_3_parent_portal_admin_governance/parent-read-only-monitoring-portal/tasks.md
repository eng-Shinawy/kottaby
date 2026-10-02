# Tasks: Parent Read-Only Monitoring Portal

**Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal`
**Specs:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/specs.md`
**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/plan.md`
**Deferred-items ledger:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/deferred-items.md`
**Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/`

> Source of truth: `specs.md` (REQ-001/002 protocol, REQ-010..016 reads, REQ-020..024 authz, REQ-030/031 GraphQL, REQ-040..043 UX/i18n, REQ-050..054 testing, REQ-060..062 gates; journeys J1-J4) + `plan.md` (D1..D12 rulings; five new SDL queries; zero schema changes).

## Document Information

- **Feature Name**: Parent Read-Only Monitoring Portal
- **Ticket**: `docs/planning/TICKETS.md:1988-2036` (Milestone 3, Dev 1 stream, 8 SP; both blockers shipped)
- **Target Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal`
- **Outcome Directory**: `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/`
- **Version**: 1.0
- **Date**: 2026-09-11
- **Author**: Tasks author (Phase 3 of spec-driven development)
- **Related Documents**: Requirements `specs.md` · Design `plan.md` · Ledger `deferred-items.md` · Research basis `outcome/research-00-planning-basis.md`

### Numbering & Traceability Conventions

- Task ids `X.Y` follow phases; every implementation task carries the pipeline: `.QL` (per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, exit 0) → `.TE` (4-tier test engineering) → `.SEC` (BOLA/BOPLA/BFLA/security audit) → `.SR` (semantic review) → `.IV` (instruction verification). Strict order; no skipping.
- Outcome files: `outcome/<task-id>-outcome.md` per task (MANDATORY before `[x]`).
- `_Requirements:` lines list REQ ids EXPANDED — no ranges — grep-verifiable against `specs.md`.
- Test runners: db/service/wire/workflow tests via `bun run test/scripts/run-test.ts <path>` ONLY (NEVER raw `bun test`, even though the journey skill text mentions `bun test test/workflows` as an alias — this repo routes all lanes through `run-test.ts`).

---

## Non-Negotiable Execution Protocol for All Tasks

1. **P1 — Pre-Execution Outcome Read.** Before executing ANY task, read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/` (starting with `0-baseline-outcome.md` and `research-00-planning-basis.md`). Prior findings are authoritative — do not re-research what an outcome already settled (REQ-001.3).
2. **P2 — Per-File Quality Verification Loop.** Whenever a file is created/modified, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and reach exit code 0 (progressive tsgo → oxlint → biome → lint → duplicates, short-circuits at first failure) BEFORE touching the next file (REQ-001.5). NEVER clear caches; never add `oxlint-disable`/`jscpd:ignore`.
3. **P3 — Test Discipline.** Run suites via `bun run test/scripts/run-test.ts <path>` — NEVER raw `bun test` for db/service/wire/workflow lanes. DB tests: ALWAYS `runInRollback`, pass `tx` to EVERY repo call inside the transaction, NEVER `expect(...).rejects.toThrow()` inside rollback (try/catch helper only), fixtures via `backend/db/test/entity-setup.ts` (never seed data). Journey tests (`test/workflows/`): real services + real DB, committed fixtures in `beforeAll`, tracked hard-delete cleanup in `afterAll`, NO `runInRollback`.
4. **P4 — Semantic Review Before `[x]`**. Before marking any subtask complete, run the X.Y.SR checklist (authz/tenancy, race conditions, env-config registration, dead code, cross-layer imports, enum value imports, deferred items logged). `sub-loop.ts` covers mechanics only; it cannot catch semantic bugs. Code comments MUST NOT contain REQ ids, task ids, or plan paths.
5. **P5 — Outcome File Per Task.** After each task completes (implementation + quality checks), write `outcome/<task-id>-outcome.md` (research findings, implementation details, cross-file dependencies, carry-overs) (REQ-001.4).
6. **P6 — Checkbox Tracking.** Flip `[ ]` → `[x]` in THIS file only after P2/P4/P5 are satisfied for the task (REQ-001.4).
7. **P7 — Instruction-File Reality.** `sub-loop.ts` auto-discovers and prints the applicable AGENTS.md + `.agents/instructions/*.instructions.md` files for each target; the executing agent MUST read ALL printed files before editing and respect the Fix-Or-Report rule (fix in-file; report cross-file dependencies to the orchestrator — never edit unassigned files).

---

## Mandatory Subtask Pipeline (every implementation task, strict order)

**EVERY implementation task X.Y MUST include these five subtasks in strict order, each as its own completion line:**

```
QL → TE → SEC → SR → IV → mark [x]
```

- **`X.Y.QL` Quality Loop (per file):**
  - Run: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`
  - The script runs: tsgo → oxlint → biome → lint → check:duplicates; exit 0 = pass; read ALL printed AGENTS.md/instruction files.
  - Fix all errors and re-run until exit 0 before proceeding to the next file.
- **`X.Y.TE` Test Engineering (4-Tier Framework):**
  - **Tier 1 (Branch & Statement Coverage)**: 100% coverage of new logic branches/methods.
  - **Tier 2 (Boundary Value Analysis)**: empty/unset values, nullability arms, unicode/RTL strings, numeric limits (non-integer/negative/zero `studentId`, `page`/`pageSize` clamp bounds at 1/50).
  - **Tier 3 (Monkey & Chaos)**: fuzz payloads, concurrent/overlapping reads (`Promise.allSettled`), out-of-order state transitions.
  - **Tier 4 (Security & Abuse)**: forged ids/roles, unauthenticated rejections, oracle-uniformity probes (SQL/LIKE wildcards are N/A — no search input exists, plan §6).
  - Layer rules enforced: db tests → `runInRollback` + `tx` + try/catch rejection helper; service/wire tests → mocked external channels, real Pothos schema for wire; journey tests → committed fixtures + tracked `afterAll` cleanup.
- **`X.Y.SEC` Security & Tenancy Audit:**
  - BOLA/IDOR: identity from `ctx.user.id`/session context ONLY; caller cannot reach foreign-child records.
  - BOPLA: no `{ ...input }` spread anywhere (read-only: trivially zero writes); output projections expose ONLY the fields in plan §2.3 (no participant-object billing/dispute columns).
  - BFLA: non-parent roles (admin/teacher/student) cannot call any portal field; role denial happens before service execution.
  - Composite relations: every child-scoped row is reached only after `requireLinkedChild` passes (`students.parentId === callerId`).
  - Input sanitization: LIKE/ILIKE N/A (no search input); malformed `studentId` collapses to the constant 403 — never a VALIDATION leak.
- **`X.Y.SR` Semantic Review (agent self-review before any `[x]`):**
  - No client-supplied identity used without ownership assertion; single-tenant scoping verified (`students.parentId = $caller`, `session.student_id = $gated`).
  - No read-then-write races (portal ships zero writes; D11 gate+read in ONE `withTransaction`).
  - No module-level mutable state; no dead branches; no cross-layer imports (`shared/` never imports `@/frontend`/`@/backend`); enums imported as VALUES at runtime (never `import type`).
  - All deferred items logged in `deferred-items.md`; comments free of REQ ids/plan paths.
- **`X.Y.IV` Instruction Verification:**
  - Read ALL AGENTS.md + instruction files printed by `sub-loop.ts` discovery for every touched path; validate the file against those rules; report cross-file blockers via the Fix-Or-Report rule.

**Scoping rule:** doc-only / process tasks (Phase 0, Phase 1, Phase 7, Phase 8) mark `TE`/`SEC` **N/A** inline with the reason (e.g., "N/A — no runtime code changed"), keep QL (or its doc equivalent), SR, and IV.

---

## Layer-to-Instructions Mapping (applicable to this plan)

| Touched paths (this plan) | AGENTS.md to read | `.agents/instructions/` files |
|---|---|---|
| root (all tasks) | `AGENTS.md` | — |
| `backend/types/parents/**` | `backend/AGENTS.md`, `backend/types/AGENTS.md` | `backend.instructions.md` |
| `backend/db/repo/{students,classes}/**` | `backend/AGENTS.md`, `backend/db/repo/AGENTS.md` | `backend.instructions.md` |
| `backend/services/parents/**` | `backend/AGENTS.md`, `backend/services/AGENTS.md` | `backend.instructions.md` |
| `backend/graphql/{pothos,query}/parents/**` | `backend/AGENTS.md`, `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md` (+ `backend/graphql/query/AGENTS.md` for queries) | `backend.instructions.md` |
| `backend/db/test/repo/**` | `backend/AGENTS.md`, `backend/db/test/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `backend/graphql/test/**` | `backend/AGENTS.md`, `backend/graphql/AGENTS.md` | `backend.instructions.md`, `tests.instructions.md` |
| `shared/locale/**` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | — |
| `shared/locale/*parity*.test.ts` | `shared/AGENTS.md`, `shared/locale/AGENTS.md` | `tests.instructions.md` |
| `frontend/graphql/sharedDocuments/parents/**` | `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md` | `frontend.instructions.md` |
| `frontend/providers/**` | `frontend/AGENTS.md`, `frontend/graphql/AGENTS.md` | `frontend.instructions.md` |
| `frontend/views/{parent,dashboard}/**` | `frontend/AGENTS.md`, `frontend/views/AGENTS.md` | `frontend.instructions.md` |
| `app/(dashboard)/parent/**` | `app/AGENTS.md` | `frontend.instructions.md` |
| `test/workflows/parents/**` | `test/workflows/AGENTS.md` | `tests.instructions.md` |
| `docs/parents/**` (Phase 8) | root `AGENTS.md` | — |

---

## Implementation Overview

Read-only vertical slice, bottom-up: canonical types → repository parent-scoped reads → `ParentMonitoringService` behind the new `requireLinkedChild` gate → five Pothos root query fields (zero mutations) → `parentMonitoring` i18n namespace → typed GraphQL documents → routes (`/parent/children` root + `[studentId]` detail, URL-param child switcher) → views. Testing wave pins every layer (repo, service, wire role matrix, UI states, J1–J4 journeys), then a review wave and final gate close the plan. Zero Drizzle schema changes (R-J); every read is index-backed (plan §9).

### Implementation Strategy
- **Authorization by construction:** one gate (`requireLinkedChild` on `students.parentId` only — R-A) funnels every portal read; Pothos `$all { authenticated, role: [UserRole.Parent] }` at the fields.
- **No stores, no schema, no mutations:** URL is the state (`?student=`, `?tab=`, `?session=` deep link); Drizzle untouched (D7); INV-P2 holds because no mutation field exists.
- **Tests interleaved:** each layer's test task lands in the same phase wave as its implementation (Phase 6 owns the dedicated test suites; QL/TE per-task subtasks cover inline assertions).

---
## Phase 0 — Pre-Implementation Baseline (blocking)

- [x] 0.1 Verify and confirm the recorded baseline + ledger
  - Read `ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/outcome/0-baseline-outcome.md` (measured 2026-09-11 from `/tmp/baseline-pp/`: tsgo errors 0, biome warnings 0, lint-service full-repo exit 0) and CONFIRM the numbers still hold on the implementation branch (rerun `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline-confirm` if drift is suspected); confirm `deferred-items.md` exists with the pre-seeded rows D1..D5 (curriculum-traversal stats, DEV1-017 deep-link forward contract, DEV1-019 E2E lane, attendance-table rule, probe rate-limiting deferral); confirm no `❌`/`⚠️` rows.
  - Re-probe a sample of plan `path:line` anchors in the live tree (e.g. `backend/db/schema/students/students.ts:32`, `backend/db/repo/students/student.repository.ts:356`, `app/(dashboard)/parent/children/page.tsx`, `frontend/views/dashboard/nav/navItems.ts:133-139`) and note any drift in the outcome file before proceeding.
  - TE: N/A (process task, no runtime code) · SEC: N/A (no code surface)
  - [x] 0.1.SR **Semantic Review**: baseline deltas (if any) are attributable before implementation; ledger rows intact
  - [x] 0.1.IV **Instruction Verification**: read root `AGENTS.md` in full
  - Write outcome: `outcome/0.1-baseline-confirm-outcome.md` (new)
  - _Requirements: REQ-001_

---

## Phase 1 — Plan Review Gate (blocking, executed at authoring time)

- [x] 1.1 Plan review gate
  - Invoke the `@plan-review` skill over this plan directory (`specs.md`, `plan.md`, `tasks.md`): layer rules, i18n/enum compliance (no `Translation.` enum, no two-arg `getTranslations`, no `next-intl`), type-pattern compliance (no service-layer `.types.ts`), R-A..R-J preserved verbatim, no invented paths, INV-P2 zero new mutations, role set exactly admin/teacher/student/parent.
  - Fix ALL findings in the plan files and re-run until the verdict is clean.
  - TE: N/A (review record, no runtime code) · SEC: N/A (review itself is the security posture check)
  - [x] 1.1.SR **Semantic Review**: rulings R-A..R-J survive the fix cycle unaltered
  - [x] 1.1.IV **Instruction Verification**: `.agents/spec-process-guide/` conventions followed
  - Write outcome: `outcome/plan-review-R1.md`
  - _Requirements: REQ-060_

---
## Phase 2 — Backend types, repositories & services

- [x] 2.1 Canonical parent-monitoring types
  - CREATE `backend/types/parents/parent-monitoring.types.ts` with the ten closed read projections verbatim from plan §2.3: `ParentLinkedChildReturnType`, `ParentAttendanceEntryReturnType`, `ParentAttendancePageReturnType`, `ParentReportEntryReturnType`, `ParentReportPageReturnType`, `ParentHomeworkTrackReturnType`, `ParentHomeworkEntryReturnType`, `ParentHomeworkPageReturnType`, `ParentHomeworkPositionReturnType`, `ParentChildProgressReturnType`, plus the shared `ParentPageInput` (`{ readonly page?: number; readonly pageSize?: number }`). All members `readonly`; `SessionStatus` / `SurahJuzRef` as VALUE imports from `@/backend/enum/...` (types-only usage still via `import type` where erased at runtime — follow the layer's existing convention); nullability exactly as designed (rating/notes nullable, never coerced).
  - UPDATE `backend/types/parents/index.ts` with `export * from "./parent-monitoring.types";` (relative `./` only; root `@/backend/types` barrel re-exports the parents barrel already — VERIFY, do not duplicate).
  - Deliberately NOT created (plan §2.3): `ParentChildOverviewReturnType`, `ParentReturnType`, any `evaluations` DTO.
  - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/parents/parent-monitoring.types.ts --lifecycle duplicates` (and the barrel) exit 0
  - [x] 2.1.TE **Test Engineering**: type-level checks only — Tier 1 compile pass; a pinned type-assertion snippet in the file's verification outcome (no runtime test suite for a pure types file per layer convention)
  - [x] 2.1.SEC **Security & Tenancy Audit**: projections expose ONLY the plan §2.3 fields — no billing/dispute/internal columns reachable (BOPLA output side)
  - [x] 2.1.SR **Semantic Review**: closed shapes, `readonly`, no re-opened entity types
  - [x] 2.1.IV **Instruction Verification**: read files printed by sub-loop (`backend/types/AGENTS.md`, `backend/AGENTS.md`, backend instructions)
  - Write outcome: `outcome/2.1-types-outcome.md`
  - _Requirements: REQ-002, REQ-010, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-030_

- [x] 2.2 Repository reads — linked children + progress count
  - UPDATE `backend/db/repo/students/student.repository.ts`: ADD `StudentRepository.listLinkedChildrenByParentId(parentId: number, tx?: DBQueryExecutor): Promise<ParentLinkedChildReturnType-projecting rows>` — join `students → users`, predicates `students.parentId = parentId AND users.isDeleted = false`, order `students.createdAt ASC, students.id ASC` (stable; rides `students_parent_id_idx`). Namespace-member style; `tx` LAST; NO permission logic in the repo.
  - CREATE `backend/db/repo/classes/progress.repository.ts`: `ProgressRepository.countForStudent(studentId: number, tx?: DBQueryExecutor): Promise<number>` (`SELECT count(*) FROM progress WHERE student_id = $1`, `.mapWith(Number)`); UPDATE `backend/db/repo/classes/index.ts` barrel (`export * from "./progress.repository";`).
  - No writes of any kind introduced; no `inArray`+prepared-statement violations (repo layer rule).
  - Executor conventions (per `backend/db/repo/AGENTS.md` + `.agents/instructions/backend.instructions.md` and the sibling repos in this directory): bare reads go through `queryDb(tx)` from `@/backend/db` (raw parameterized SQL, `tx` last); simple read-only queries (e.g. the new count reads) use a module-level Prepared Statement 2.0 per `docs/drizzle/prepared-statements.md` and the existing-sibling-repo convention.
  - [x] 2.2.QL **Quality Loop**: sub-loop exit 0 on all three touched files
  - [x] 2.2.TE **Test Engineering**: covered jointly by task 6.1 suites (this task authors the reads; branches pinned there) — inline check: compile + repo exports resolve
  - [x] 2.2.SEC **Security & Tenancy Audit**: predicates are caller-scoped only (`parentId = $1`, `student_id = $1`); listRepository returns no soft-deleted rows (severance predicate)
  - [x] 2.2.SR **Semantic Review**: no business logic absorbed into the repo; ordering stable + deterministic
  - [x] 2.2.IV **Instruction Verification**: `backend/db/repo/AGENTS.md` + `backend/AGENTS.md` + backend instructions read
  - Write outcome: `outcome/2.2-repo-children-progress-outcome.md`
  - _Requirements: REQ-010, REQ-016_

- [x] 2.3 Repository reads — report & homework parent-scoped windows
  - UPDATE `backend/db/repo/classes/report.repository.ts`: ADD `ReportRepository.listForStudent(studentId, limit, offset, tx?: DBTransaction)` returning report rows joined to their session (session `status`, `startedAt`) and `ReportRepository.countForStudent(studentId, tx?)` — SAME predicate set in both (single shared predicate/extract so the pair never drifts); inner join `reports ⋈ session ON session_id AND session.student_id = $1`; order `session.startedAt DESC NULLS LAST, reports.id DESC`.
  - UPDATE `backend/db/repo/classes/home-work.repository.ts`: ADD the same pair (`listForStudent` / `countForStudent`) over `home_work`, identical join/order discipline; CONFIRM existing `findLatestByStudentId` (`:122`) is reused unchanged by the service (D3).
  - Both repo pairs return the raw select rows; the parent-shaped projection mapping happens in the service helpers (plan §4.2) — never in the repo.
  - Executor conventions (same as task 2.2): bare reads go through `queryDb(tx)` from `@/backend/db` (raw parameterized SQL, `tx` last); simple read-only queries use a module-level Prepared Statement 2.0 per `docs/drizzle/prepared-statements.md`, `backend/db/repo/AGENTS.md` + `.agents/instructions/backend.instructions.md` and the sibling-repo convention.
  - [x] 2.3.QL **Quality Loop**: sub-loop exit 0 on both files
  - [x] 2.3.TE **Test Engineering**: covered by task 6.1 suites; inline check: shared predicate reused by list+count (no drift risk) verified by reading the diff
  - [x] 2.3.SEC **Security & Tenancy Audit**: every row returned is provably `session.student_id = $gatedStudent`; joins cannot fan out cross-student
  - [x] 2.3.SR **Semantic Review**: list/count pairs describe the SAME filtered set; pagination is offset-based with honest total
  - [x] 2.3.IV **Instruction Verification**: repo AGENTS.md + backend instructions read
  - Write outcome: `outcome/2.3-repo-reports-homework-outcome.md`
  - _Requirements: REQ-012, REQ-013, REQ-014, REQ-015_

- [x] 2.4 `ParentMonitoringService` + `requireLinkedChild` gate
  - CREATE `backend/services/parents/parent-monitoring.helpers.ts`: `requireLinkedChild(parentActorId, studentId, locale, tx)` implemented exactly per plan §4.2 (malformed id ⇒ deny; `students.parentId !== parentActorId` ⇒ deny; `users.isDeleted` re-check ⇒ deny — ALL throwing the SAME constant `ForbiddenError` via `getServerTranslations(locale).errorsTranslations.forbidden`, exactly one bounded `logger.logDomainError` per denial, never logging child fields); plus the pure projection mappers (session row → `ParentAttendanceEntryReturnType`, report+session pair → `ParentReportEntryReturnType`, `HomeWorkSelectType` → track blocks + `*PositionReturnType` extraction) colocated here. `requireActor` imported from the same-domain sibling `./parent-link-request.helpers` (not duplicated).
  - CREATE `backend/services/parents/parent-monitoring.service.ts`: `ParentMonitoringService` namespace with the five methods from plan §4.2 (`listLinkedChildren`, `getChildProgress`, `listChildSessions`, `listChildReports`, `listChildHomework`). Every method: `requireActor(parentActorId, UserRole.Parent, locale, undefined, false)` first (relaxed READ path per helper docblock); per-student methods then open ONE `withTransaction` and run gate + reads inside it (D11 TOCTOU seal). Pagination: `page >= 1`, `pageSize` clamped to [1,50], effective values echoed in the page payload. NO mutation methods; NO reads of `parent_link_requests` or `evaluations` (D2/D5 grep-locks enforced in Phase 7).
  - UPDATE `backend/services/parents/index.ts` barrel to export the service namespace (match the existing barrel's export style for `ParentLinkRequestService`).
  - [x] 2.4.QL **Quality Loop**: sub-loop exit 0 on all touched files (helpers first, then service, then barrel — verify the new files BEFORE wiring consumers per root AGENTS.md per-file loop)
  - [x] 2.4.TE **Test Engineering**: full coverage authored in task 6.2; inline sanity: projection mappers' boundary arms (null rating, null tracks, missing latest position) reviewed against plan §2.3
  - [x] 2.4.SEC **Security & Tenancy Audit**: gate runs BEFORE any data read inside the tx; denial copy constant across nonexistent/foreign/never-linked/severed/malformed (REQ-022); ≤1 bounded log per denial; zero data in denial throws
  - [x] 2.4.SR **Semantic Review**: no authz caching; single `withTransaction` per read; locale threaded; enum VALUE imports; no dead branches
  - [x] 2.4.IV **Instruction Verification**: `backend/services/AGENTS.md` + `backend/AGENTS.md` + backend instructions read
  - Write outcome: `outcome/2.4-service-gate-outcome.md`
  - _Requirements: REQ-010, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-020, REQ-021, REQ-022, REQ-024_

---

## Phase 3 — GraphQL layer

- [x] 3.1 Pothos parent-object types
  - CREATE `backend/graphql/pothos/parents/parent-monitoring.pothos.ts`: all ten parent objects from plan §3.1 (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentAttendancePage`, `ParentReportEntry`, `ParentReportPage`, `ParentHomeworkTrack`, `ParentHomeworkEntry`, `ParentHomeworkPage`, `ParentHomeworkPosition`, `ParentChildProgress`) as single `objectRef<...ReturnType>("GraphQLName")` each, backed by the task-2.1 types imported from `@/backend/types/parents` (NO local type definitions); `t.exposeID("id")` first on entity shapes; timestamps via `t.expose(..., { type: "DateTime" })`; enums via the ONCE-registered `SessionStatusPothosEnum` / `SurahJuzRefPothosEnum` from `backend/graphql/pothos/shared/enum.pothos.ts` (never re-register); nullability marks EXACTLY matching the TS nullability (notes/rating/track blocks nullable).
  - The existing participant objects (`SessionPothosObject`, `SessionReportPothosObject`, `SessionHomeWorkPothosObject`) are NOT touched (D4/REQ-031).
  - [x] 3.1.QL **Quality Loop**: sub-loop exit 0 on the new file
  - [x] 3.1.TE **Test Engineering**: N/A as a standalone suite (schema-surface assertions land in 3.3); inline: compile-time object-shape pinning via the generated-schema diff in 3.3
  - [x] 3.1.SEC **Security & Tenancy Audit**: BOPLA output check — confirm none of the participant objects' billing/dispute columns (`fee`, `cancelReason`, `disputeReason`, confirmation stamps) exist on any parent object
  - [x] 3.1.SR **Semantic Review**: zero inline logic in the Pothos file; docs strings non-leaking; no enum re-registration
  - [x] 3.1.IV **Instruction Verification**: `backend/graphql/AGENTS.md` + `backend/graphql/pothos/AGENTS.md` + `backend/AGENTS.md` read
  - Write outcome: `outcome/3.1-pothos-objects-outcome.md`
  - _Requirements: REQ-002, REQ-030_

- [x] 3.2 Query field registration + side-effect barrel
  - CREATE `backend/graphql/query/parents/parent-monitoring.query.ts`: registers the five root fields by side effect (NO named exports) — `myLinkedChildren` (zero-arg, identity from `ctx.user.id` only) and `parentChildProgress` / `parentChildSessions` / `parentChildReports` / `parentChildHomework` (args `studentId: Int!` + optional `page`/`pageSize`). EVERY field carries `authScopes: { $all: { authenticated: true, role: [UserRole.Parent] } }` ($all conjunction load-bearing; `UserRole` VALUE import). Resolvers delegate to `ParentMonitoringService` passing `ctx.user.id`, args, `ctx.locale`; the `if (!ctx.user)` narrowing branch throws `UnauthorizedError` via `await ctx.t("errorsTranslations")` (localized) exactly per plan §3.2 template. ZERO new mutation fields (INV-P2).
  - UPDATE `backend/graphql/query/parents/index.ts`: append `import "./parent-monitoring.query";` (side-effect chain into `query/index.ts` → `gqlSchema.ts` flows without further edits — verify).
  - [x] 3.2.QL **Quality Loop**: sub-loop exit 0 on the query module + barrel
  - [x] 3.2.TE **Test Engineering**: wire-level coverage authored in task 6.3; inline: schema introspection via dev boot confirms all five fields register with correct arg shapes
  - [x] 3.2.SEC **Security & Tenancy Audit**: BFLA — non-parent roles deny 403 pre-service; BOLA — no parent-id arg exists anywhere; BOPLA — no spread of args into service calls beyond typed fields
  - [x] 3.2.SR **Semantic Review**: scope fields unchanged on parent-link queries; no drift on participant-only query registrations
  - [x] 3.2.IV **Instruction Verification**: `backend/graphql/AGENTS.md` + query/AGENTS.md + backend instructions read
  - Write outcome: `outcome/3.2-query-registration-outcome.md`
  - _Requirements: REQ-020, REQ-022, REQ-023, REQ-024, REQ-030_

- [x] 3.3 GraphQL codegen checkpoint + SDL surface lock
  - Run `bun run generate:gqlSchema` then `bun codegen`; COMMIT the regenerated `frontend/graphql/generated/` output (required after every schema/document change — rerun later after Phase 5 documents too).
  - UPDATE the schema-surface assertion suites (precedents: `backend/graphql/test/session-sdl.test.ts`, `backend/graphql/test/schema-surface.test.ts` — inspect and extend the live one matching parent queries): pin all five field names + arg shapes; ADD the INV-P2 lock assertion proving ZERO new fields exist on root `Mutation` referencing the portal service/names; pin that the participant-only `sessionReport`/`sessionHomework` field definitions are byte-unchanged (REQ-031).
  - [x] 3.3.QL **Quality Loop**: sub-loop exit 0 on the touched test file(s) (generated output is excluded from lint by config — verify, do not hand-edit)
  - [x] 3.3.TE **Test Engineering**: the SDL assertions ARE the tests (run via `bun run test/scripts/run-test.ts <path>`); Tier 4: rename-drift probe — a renamed field fails the pin (self-check the assertion catches a deliberate temp rename, then revert)
  - [x] 3.3.SEC **Security & Tenancy Audit**: public-operations allowlist (`backend/lib/gateway/public-operations.ts`) confirmed to NEED NO new entries (all five fields are authenticated — never anonymous)
  - [x] 3.3.SR **Semantic Review**: generated diff reviewed — no unintended schema churn beyond the five additions + new object types
  - [x] 3.3.IV **Instruction Verification**: graphql AGENTS.md codegen rules followed
  - Write outcome: `outcome/3.3-codegen-sdl-lock-outcome.md`
  - _Requirements: REQ-023, REQ-030, REQ-031_

---

## Phase 4 — i18n namespace (`parentMonitoring` full ceremony)

- [x] 4.1 `parentMonitoring` namespace ceremony (all eight artifacts)
  - CREATE `shared/locale/types/parentMonitoring/index.ts` — `ParentMonitoringLabels` (plain strings; `(count: number) => string` functions for pluralized counts; interpolation functions where values are inlined).
  - UPDATE `shared/locale/types/message.ts` — import `ParentMonitoringLabels` and add `parentMonitoringTranslations: ParentMonitoringLabels;` to the `Translations` interface (precedent: `parentLinkTranslations` at `shared/locale/types/message.ts:39` — verify before editing).
  - CREATE `shared/locale/namespaces/parentMonitoring/parentMonitoring.namespace.ts` — `defineNamespace<ParentMonitoringLabels>(...)` verbatim-shaped after `shared/locale/namespaces/parentLink/parentLink.namespace.ts`; CREATE `shared/locale/namespaces/parentMonitoring/index.ts` barrel.
  - CREATE `shared/locale/en/parentMonitoring/index.ts` (`parentMonitoringEn`) and `shared/locale/ar/parentMonitoring/index.ts` (`parentMonitoringAr`) — FULL Arabic parity; cover tab labels (attendance/reports/homework/evaluations/progress), Jadid/Madi track labels, per-surface empty-state title+body, switcher label, "not rated yet" / "none assigned" / "no recorded progress yet" states, detail-page titles.
  - UPDATE `shared/locale/namespaces/registry.ts` (alphabetical entry), `shared/locale/namespaces/index.ts` barrel, `shared/locale/en/messages.ts`, `shared/locale/ar/messages.ts` (aggregate `parentMonitoringTranslations`).
  - CREATE `shared/locale/parentMonitoring-namespace.parity.test.ts` (precedent: `shared/locale/parentLink-namespace.parity.test.ts`) proving en/ar key/shape parity.
  - Denial copy is NOT duplicated here — the portal reuses `errorsTranslations.forbidden` (REQ-043.4). NO `Translation.` enum, NO two-arg `getTranslations` anywhere.
  - [x] 4.1.QL **Quality Loop**: sub-loop exit 0 on every created/updated file
  - [x] 4.1.TE **Test Engineering**: the parity test IS Tier 1/2 (key parity, shape parity incl. function-typed leaves); run via `bun run test/scripts/run-test.ts shared/locale/parentMonitoring-namespace.parity.test.ts`
  - [x] 4.1.SEC **Security & Tenancy Audit**: N/A (copy-only, no code surface) — verify no child/identity data strings hardcoded in labels
  - [x] 4.1.SR **Semantic Review**: shared layer purity (no `@/backend`/`@/frontend` imports); no hardcoded user-facing strings left for the views to need
  - [x] 4.1.IV **Instruction Verification**: `shared/AGENTS.md` + `shared/locale/AGENTS.md` + `tests.instructions.md` (parity test) read
  - Write outcome: `outcome/4.1-i18n-namespace-outcome.md`
  - _Requirements: REQ-002, REQ-043_

---

## Phase 5 — Frontend documents, routes & views

- [x] 5.1 GraphQL documents + codegen
  - CREATE `frontend/graphql/sharedDocuments/parents/parent-monitoring.documents.ts` with the five documents (`myLinkedChildrenQueryDocument`, `parentChildProgressQueryDocument`, `parentChildSessionsQueryDocument`, `parentChildReportsQueryDocument`, `parentChildHomeworkQueryDocument`) per plan §5.5: `TypedDocumentNode`-typed against generated types, `id` FIRST in every selection set, docblock per document, NO `useLazyQuery`. Documents send ONLY `studentId` + pagination — never identity/role hints (REQ-024.4).
  - UPDATE `frontend/graphql/sharedDocuments/parents/index.ts` barrel.
  - Re-run `bun run generate:gqlSchema` + `bun codegen` (documents now resolve against the generated schema) and commit the final generated output.
  - [x] 5.1.QL **Quality Loop**: sub-loop exit 0 on the documents file + barrel
  - [x] 5.1.TE **Test Engineering**: follow the sibling precedent `parents/parent-link.documents.test.ts` — snapshot/shape assertions per document; run via `bun run test/scripts/run-test.ts <path>`
  - [x] 5.1.SEC **Security & Tenancy Audit**: REQ-024.4 grep-check — no parent id / role / auth fields in any request body
  - [x] 5.1.SR **Semantic Review**: selection sets match the projections (no over-fetch); id-first everywhere
  - [x] 5.1.IV **Instruction Verification**: `frontend/graphql/sharedDocuments/AGENTS.md` + `frontend/graphql/AGENTS.md` + `frontend/AGENTS.md` read
  - Write outcome: `outcome/5.1-documents-outcome.md`
  - _Requirements: REQ-002, REQ-024, REQ-030_

- [x] 5.2 Portal routes + nav fix
  - UPDATE `app/(dashboard)/parent/children/page.tsx`: replace the `ComingSoonView` stub with the real portal root as a **guard-only server shell** — `withPageAuth({ roles: [UserRole.Parent] })` guard (pattern from `app/(dashboard)/parent/handshake/page.tsx`); the server component awaits `searchParams` and passes the raw `?student=` value through as a plain prop — it MUST NOT auto-select the first linked child and MUST NOT redirect to `/parent/children/<id>` (pinned decision: no data fetch, no `myLinkedChildren` resolution, no first-child redirect on the server). The CLIENT root container resolves a missing `?student=` AFTER `useQuery(myLinkedChildrenQueryDocument)` resolves (auto-select first linked child → navigate to `/parent/children/<id>`; zero children → localized empty state; per plan §4.3/§5.6).
  - CREATE `app/(dashboard)/parent/children/[studentId]/page.tsx`: server shell awaits `params` (`Promise<{ studentId: string }>` per Next.js 16 async-params convention — verify against `node_modules/next/dist/docs/` before writing any App Router code), coerces/validates the id (integer-coercion failures redirect to the portal root), extracts `?tab=`/`?session=` from `searchParams`, passes plain props into the detail container. `withPageAuth` parent-only.
  - UPDATE `frontend/views/dashboard/nav/navItems.ts` (inside `NAV_ITEMS_BY_ROLE[UserRole.Parent]`, ~:133-139): retarget the Children entry route `/children` → `/parent/children`, keeping `labelKey: "children"` and the existing icon; single-config drives both drawers — no per-breakpoint work, NO bottom nav.
  - Before writing ANY Next.js code: consult `node_modules/next/dist/docs/` for the dynamic-routes and page conventions (async `params`/`searchParams`) per this repo's Next.js 16 discipline.
  - [x] 5.2.QL **Quality Loop**: sub-loop exit 0 on all three files
  - [x] 5.2.TE **Test Engineering**: N/A — page shells are not unit-exercised (Happy DOM does not mount server components); inline: typecheck of the async-params/params props contract
  - [x] 5.2.SEC **Security & Tenancy Audit**: guard composition verified — non-parent roles never reach portal views; no param value trusted without server-side coercion
  - [x] 5.2.SR **Semantic Review**: guard-only server shells (no data fetch, no `useQuery` in server files); label-key namespace discipline intact (no NavLabelKey collisions)
  - [x] 5.2.IV **Instruction Verification**: `app/AGENTS.md` + `frontend/views/AGENTS.md` + frontend instructions read
  - Write outcome: `outcome/5.2-routes-nav-outcome.md`
  - _Requirements: REQ-002, REQ-040, REQ-041, REQ-042_

- [x] 5.3 Portal view components
  - CREATE `frontend/views/parent/monitoring/` module per plan §5.6: `ParentChildrenRootContainer.tsx` (`useQuery(myLinkedChildrenQueryDocument)`; missing `?student=` resolved CLIENT-SIDE after the query resolves — auto-select first linked child → navigate to `/parent/children/<id>` (pinned decision: never on the server page); empty → `IconCircleEmptyState` + handshake CTA; ≥1 → switcher + select), `ParentChildDetailContainer.tsx` (owns child switcher writing `?student=` via Next.js navigation — NO Zustand, NO global store; MUI `Tabs` writing `?tab=`; ALL child `useQuery` hooks re-keyed on `studentId` so rows never leak across children), and the five tabs `AttendanceTab.tsx` / `ReportsTab.tsx` / `HomeworkTab.tsx` / `EvaluationsTab.tsx` (consumes `parentChildReports` rows through the evaluations lens — D9) / `ProgressTab.tsx`; barrel `index.ts` (components only).
  - State matrix per tab (plan §5.6): loading → skeleton; FORBIDDEN via `extractErrorCode` + `mapGraphQLErrorByCode` (precedent `frontend/views/admin/analytics/PlatformAnalyticsContainer.tsx`) → `PermissionDeniedFallback`; other errors → `ErrorRetryAlert`; empty → localized `IconCircleEmptyState`; data → rows. Deep-link `?session=` scrolls the Reports tab to that session row (R-I forward contract for DEV1-017). All copy from `useAppTranslation(ParentMonitoring)` / server `getTranslations(locale)` single-arg; en/ar strings from task 4.1; Jadid/Madi verbatim labels and surah/juz localized names honored; null rating renders "not rated yet" — NEVER `0`.
  - Styling: MUI v9 `sx` ONLY (no style props on Typography/Stack/Box/Grid), `*Outlined` icons, theme palette callbacks + Material 3 `on*` siblings — NO hardcoded colors; plain `Stack`/`Card` composition (`AppDataGrid`/`MetricCard`/`PageContainer` DO NOT EXIST — do not import). No mutation affordances anywhere in the portal UI (REQ-023.3).
  - [x] 5.3.QL **Quality Loop**: sub-loop exit 0 on every new file (one pass each before moving on)
  - [x] 5.3.TE **Test Engineering**: state-matrix coverage lands in task 6.4; inline: every tab's 4 states enumerated in the container props contract
  - [x] 5.3.SEC **Security & Tenancy Audit**: server error text never rendered raw; no child data from a previous `studentId` can render under a new one (re-key verified)
  - [x] 5.3.SR **Semantic Review**: URL-is-the-state (no parallel local copy that can diverge); no dead branches in the state matrix
  - [x] 5.3.IV **Instruction Verification**: `frontend/views/AGENTS.md` + `frontend/AGENTS.md` + frontend instructions read
  - Write outcome: `outcome/5.3-views-outcome.md`
  - _Requirements: REQ-002, REQ-011, REQ-013, REQ-014, REQ-015, REQ-016, REQ-023, REQ-040, REQ-041, REQ-043_

- [x] 5.4 Apollo cache registration for the no-`id` portal types
  - UPDATE `frontend/providers/apollo/apolloCache.ts`: register the six no-`id` GraphQL portal types from plan §3.1 — `ParentAttendancePage`, `ParentReportPage`, `ParentHomeworkPage`, `ParentHomeworkTrack`, `ParentHomeworkPosition`, `ParentChildProgress` — each as `{ keyFields: false }` under `typePolicies`, per the embedded-type normalization policy (`frontend/graphql/AGENTS.md`; live registry at `frontend/providers/apollo/apolloCache.ts`). Append after the last documented entry with a per-family inline comment, and extend the file's header docblock to name the new family (existing convention): the `*Page` wrappers' normalizable entities are the `id`-carrying `*Entry` rows inside `items`, so the wrappers themselves never need an identity; `ParentHomeworkTrack`, `ParentHomeworkPosition` and `ParentChildProgress` are embedded value objects read back through their enclosing parent and replaced wholesale on refetch.
  - [x] 5.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts frontend/providers/apollo/apolloCache.ts --lifecycle duplicates` exit 0
  - [x] 5.4.TE **Test Engineering**: N/A per the pipeline's scoping rule — cache-config-only change with no runtime code branches
  - [x] 5.4.SEC **Security & Tenancy Audit**: N/A per the scoping rule — no auth surface; verify no `id`-carrying type (`ParentLinkedChild`, `ParentAttendanceEntry`, `ParentReportEntry`, `ParentHomeworkEntry`) is registered with `keyFields: false` (would break per-entity cache identity)
  - [x] 5.4.SR **Semantic Review**: exactly the plan §3.1 no-`id` set registered — nothing more, nothing less
  - [x] 5.4.IV **Instruction Verification**: `frontend/graphql/AGENTS.md` (embedded-type policy) + `frontend/AGENTS.md` + frontend instructions read
  - Write outcome: `outcome/5.4-apollo-cache-outcome.md`
  - _Requirements: REQ-030_

---

## Phase 6 — Testing & journeys

- [x] 6.1 Repository tests
  - CREATE/EXTEND suites per plan §8: `backend/db/test/repo/students/student.parent-monitoring.repository.test.ts`, `backend/db/test/repo/classes/report.parent.repository.test.ts`, `backend/db/test/repo/classes/home-work.parent.repository.test.ts`, `backend/db/test/repo/classes/progress.repository.test.ts` (CREATE).
  - Discipline (REQ-050): every suite wrapped in `runInRollback`; `tx` passed to EVERY repo call inside the transaction; try/catch rejection helper (NEVER `expect(...).rejects.toThrow()`); fixtures built via `backend/db/test/entity-setup.ts` (verify helper signatures at authoring time; never seed data).
  - Coverage: join predicates isolate cross-student leakage; ordering (`createdAt ASC` list, `startedAt DESC NULLS LAST, id DESC` windows); pagination windows (limit/offset both pairs describe the same set); soft-deleted child excluded from the children list; progress count 0 vs N.
  - Run: `bun run test/scripts/run-test.ts <path>` per suite until green.
  - [x] 6.1.QL **Quality Loop**: sub-loop exit 0 per test file
  - [x] 6.1.TE **Test Engineering**: Tiers 1-3 boundary arms (empty windows, offset beyond end, concurrent inserts via Promise.allSettled do not corrupt a window) — Tier 4 SQL-injection via id args N/A (parameterized integer columns), abuse probes live in wire tests
  - [x] 6.1.SEC **Security & Tenancy Audit**: cross-tenant rows never returned for another student/parent id in fixtures
  - [x] 6.1.SR **Semantic Review**: no seed-data reads; rollback hygiene
  - [x] 6.1.IV **Instruction Verification**: `backend/db/test/AGENTS.md` + backend+tests instructions read
  - Write outcome: `outcome/6.1-repo-tests-outcome.md`
  - _Requirements: REQ-050_

- [x] 6.2 Service tests (gate + shape)
  - CREATE `backend/services/parents/parent-monitoring.service.test.ts` (+ helpers colocated tests for `requireLinkedChild` and the mappers, following the sibling `parent-link-request.helpers.test.ts` convention).
  - Coverage (REQ-051): linked parent → data for every method; unlinked parent → `ForbiddenError`; cross-child id → `ForbiddenError`; soft-deleted child → `ForbiddenError` (SAME constant copy across all four denial classes); malformed id (non-integer, ≤0) → same shape; empty sets → honest empty payloads (`[]`, count 0, null positions); page/pageSize clamping echoed (1 lower, 50 upper, defaults); ordering of windows pinned.
  - Denial copy asserted against `getServerTranslations(locale).errorsTranslations.forbidden` for BOTH `en` and `ar` — never raw strings (REQ-051.2). Token-role denial (non-parent actor id) → `ForbiddenError`.
  - Mock external seams per service-test rules; run via `bun run test/scripts/run-test.ts <path>`.
  - [x] 6.2.QL **Quality Loop**: sub-loop exit 0 per test file
  - [x] 6.2.TE **Test Engineering**: Tier 1 all method branches; Tier 2 boundary arms (null rating/notes, fully-null Jadid/Madi blocks, empty progress, clamp bounds); Tier 3 concurrent mixed calls on one parent (`Promise.allSettled`); Tier 4 oracle-uniformity across the five denial causes (identical error message + code)
  - [x] 6.2.SEC **Security & Tenancy Audit**: denial responses carry zero child fields; exactly one bounded `logDomainError` per denial (spy assertion)
  - [x] 6.2.SR **Semantic Review**: no DB seed reads; gate-before-read proven by call ordering
  - [x] 6.2.IV **Instruction Verification**: services/testing instructions read
  - Write outcome: `outcome/6.2-service-tests-outcome.md`
  - _Requirements: REQ-021, REQ-022, REQ-051_

- [x] 6.3 GraphQL wire tests (role matrix + en/ar denial copy)
  - CREATE `backend/graphql/test/parent-monitoring.wire.test.ts` (precedent `backend/graphql/test/parent-link.wire.test.ts`; real test server via the layer's `testClient` + `setupTestServerLifecycle`, never raw fetch).
  - Role × operation matrix over ALL FIVE portal fields (REQ-052.1): anonymous → 401 `UNAUTHORIZED`; admin/teacher/student → 403 `FORBIDDEN` before service execution; parent without link → 403 (detail queries) and 200 `[]` (list); parent with link to another child → 403 zero data; parent with link to the requested child → 200 with data.
  - BOLA probe (REQ-052.3): a request with a foreign `studentId` AND a valid parent session → 403 with zero data leakage (response body assertions). Malformed `studentId` over the wire → same constant 403.
  - Denial copy asserted in BOTH `en` and `ar` via the locale mechanism used by the existing test client; `extensions.code` asserted for every error case.
  - Run via `bun run test/scripts/run-test.ts <path>`.
  - [x] 6.3.QL **Quality Loop**: sub-loop exit 0 on the suite
  - [x] 6.3.TE **Test Engineering**: the matrix IS Tier 1-4 here (boundary: malformed/zero/negative ids; chaos: repeated probes; security: forged-role tokens)
  - [x] 6.3.SEC **Security & Tenancy Audit**: BFLA (403 predates service) asserted; error envelopes carry `extensions.code`, no stack leaks
  - [x] 6.3.SR **Semantic Review**: fixtures built per wire-suite conventions; no cross-suite coupling
  - [x] 6.3.IV **Instruction Verification**: graphql + tests instructions read
  - Write outcome: `outcome/6.3-wire-tests-outcome.md`
  - _Requirements: REQ-020, REQ-021, REQ-022, REQ-024, REQ-030, REQ-052_

- [x] 6.5 Journey tests J1-J4
  - CREATE `test/workflows/parents/parent-monitoring.journey.test.ts` (precedent: `test/workflows/parents/student-confirmation-of-link.journey.test.ts`; read `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md` FIRST; write TEST-FIRST against the plan §4.4 service contract where the consuming implementation is still in flight).
  - Real services + real DB; committed fixtures in `beforeAll` via `backend/db/test/entity-setup.ts` (never seed data); tracked hard-delete cleanup in `afterAll`; NEVER `runInRollback` in the journey lane; notification dispatch boundary spied (never real channels).
  - Journeys (specs §4): **J1** teacher completes session (real existing service surface) + submits report/homework → parent reads them via the portal services AND the `?session=` deep link resolves to the same record; never-linked parent's attempt → 403. **J2** sever the link (clear `students.parentId` / soft-delete the student via existing seams) → EVERY portal read immediately 403s and the children list excludes the child (no cache may extend visibility). **J3** unlinked parent probes foreign/nonexistent ids → constant 403 byte-identical across causes, asserted in BOTH en and ar. **J4** two confirmed children → both listed; per-child reads return that child's rows only.
  - Run via `bun run test/scripts/run-test.ts <path>` until green.
  - [x] 6.5.QL **Quality Loop**: sub-loop exit 0 on the suite
  - [x] 6.5.TE **Test Engineering**: journeys ARE the cross-tier proof (real race via severance mid-sequence; en/ar boundary; abuse repeats)
  - [x] 6.5.SEC **Security & Tenancy Audit**: cross-actor visibility table from plan §4.4 asserted verbatim per step
  - [x] 6.5.SR **Semantic Review**: cleanup airtight (afterAll hard-deletes tracked fixtures even on assertion failure)
  - [x] 6.5.IV **Instruction Verification**: workflow tests AGENTS.md + tests instructions read
  - Write outcome: `outcome/6.5-journey-tests-outcome.md`
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-021, REQ-022, REQ-054_

---

## Phase 7 — Post-Implementation Review Wave (REQ-061)

- [x] 7.1 Parallel review wave over plan-touched files only
  - Dispatch review subagents in parallel, SCOPED to the files this plan created/modified: **types-review** (backend/types parents projections + barrel), **backend-review** (repos + `ParentMonitoringService` + helpers + Pothos/query modules), **frontend-review** (documents, routes, views, nav diff), **security-review** (gate constant-shape proofs, projection narrowness, authScopes matrix, nav/guard composition).
  - Programmatic grep-locks (all four MUST be asserted and recorded): (a) INV-P2 — zero new mutations: grep the new query module + generated schema for portal-named fields on root `Mutation` (expect none); (b) R-A — grep portal files for `parent_link_requests`/parent-link-request repo imports (expect none); (c) D2/R-C — grep portal files for `evaluations`/`Evaluation` imports (expect none); (d) R-E — `git diff` on `sessionReport`/`sessionHomework` authScopes/service gate (`resolveVisibleSessionForCaller`) proves byte-unchanged.
  - Aggregate findings; dispatch per-file fix subagents; re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per fixed file; iterate until ZERO findings; remaining nits enter `deferred-items.md` before closeout.
  - TE: N/A (review wave; test suites already green per Phase 6) · SEC: this task IS the security audit of record
  - [x] 7.1.SR **Semantic Review**: reviewers' outputs cross-checked against plan §6 security table — every mitigation has a verifying artifact
  - [x] 7.1.IV **Instruction Verification**: reviewers cite the layer AGENTS.md/instructions their findings derive from
  - Write outcome: `outcome/post-implementation-review.md`
  - _Requirements: REQ-023, REQ-031, REQ-061_

---

## Phase 8 — Final gate & knowledge propagation

- [x] 8.1 Final quality gate + ledger enforcement
  - Run the full `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates); all green. Compare against the baseline (task 0.1 counts): any new error MUST be attributable to this plan's files.
  - Schema-parity assertion (D7/R-J): `git diff` over `backend/db/schema/` is EMPTY for this plan's delta; `drizzle-kit` push/generate NOT run.
  - Ledger enforcement (BLOCKING): `awk '/^## Ledger Table/,/^## Status Values/' ai/plans/milestone_3_parent_portal_admin_governance/parent-read-only-monitoring-portal/deferred-items.md | grep -c "❌\|⚠️"` MUST equal 0 (scoped to the ledger table so the Status Values legend glyphs do not self-match — paymob precedent); `📅 Forward` items (D1 curriculum-depth, D2 DEV1-017 deep-link, D3 DEV1-019 E2E, D4 attendance table, D5 probe rate-limiting) are exempt per the ledger's forward status but MUST be re-asserted as still-open.
  - Traceability loop: `for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo MISSING: $r; done` — zero misses; every task checkbox `[x]`.
  - [x] 8.1.SR **Semantic Review**: outcome directory complete (one file per task); no orphan `❌` carry-overs
  - [x] 8.1.IV **Instruction Verification**: quality-gate rules respected (no cache clearing anywhere in this plan)
  - Write outcome: `outcome/8.1-final-gate-outcome.md`
  - _Requirements: REQ-001, REQ-061, REQ-062_

- [x] 8.2 Knowledge propagation (canonical doc)
  - CREATE `docs/parents/monitoring-portal.md` (docs structure: Why → Pattern → Rules → Anti-patterns → Rollout Summary → Related Documents) consolidating ALL outcome files: the five query contracts + BOLA posture (identity from context only), the `requireLinkedChild` gate (R-A / INV-P1) and its constant-403 oracle, read-only posture (INV-P2), attendance derivation (R-B), evaluations disambiguation (R-C), progress-source ruling (R-D), the untouched participant-only surfaces (R-E), the `/parent/children/<studentId>?tab=reports&session=<id>` deep-link contract for DEV1-017 (R-I), and consumer guidance for DEV1-019.
  - UPDATE root `AGENTS.md` Important References with the one-line entry for the new canonical doc.
  - UPDATE `docs/parents/parent-link-request.md` (single forward-pointer line amending its consumer-contract note → monitoring portal shipped at the new doc) — satisfies its §8 forward pointer.
  - TE: N/A (documentation task) · SEC: N/A (docs only — verify no secrets/PII in examples)
  - [x] 8.2.QL **Quality Loop**: sub-loop exit 0 on every edited `.md` (doc lint lanes apply)
  - [x] 8.2.SR **Semantic Review**: doc matches the SHIPPED behavior (rulings cross-checked against outcomes, not the plan's intent alone); markdown link integrity verified
  - [x] 8.2.IV **Instruction Verification**: plan-house docs conventions followed (`.agents/spec-process-guide/`)
  - Write outcome: `outcome/8.2-knowledge-propagation-outcome.md`
  - _Requirements: REQ-001, REQ-062_

---

## Traceability Map (REQ → tasks)

| REQ | Task(s) |
|---|---|
| REQ-001 | 0.1, 8.1, 8.2 |
| REQ-002 | 2.1, 3.1, 4.1, 5.1, 5.2, 5.3 |
| REQ-010 | 2.1, 2.2, 2.4, 6.5 |
| REQ-011 | 5.3, 6.4, 6.5 |
| REQ-012 | 2.1, 2.3, 2.4, 6.5 |
| REQ-013 | 2.1, 2.3, 2.4, 5.3, 6.5 |
| REQ-014 | 2.1, 2.3, 2.4, 5.3, 6.5 |
| REQ-015 | 2.1, 2.3, 2.4, 5.3, 6.5 |
| REQ-016 | 2.1, 2.2, 2.4, 5.3, 6.5 |
| REQ-020 | 2.4, 3.2, 6.3 |
| REQ-021 | 2.4, 6.2, 6.3, 6.5 |
| REQ-022 | 2.4, 3.2, 6.2, 6.3, 6.5 |
| REQ-023 | 3.2, 3.3, 5.3, 7.1 |
| REQ-024 | 2.4, 3.2, 5.1, 6.3 |
| REQ-030 | 2.1, 3.1, 3.2, 3.3, 5.1, 5.4, 6.3 |
| REQ-031 | 3.3, 7.1 |
| REQ-040 | 5.2, 5.3, 6.4 |
| REQ-041 | 5.2, 5.3, 6.4 |
| REQ-042 | 5.2 |
| REQ-043 | 4.1, 5.3 |
| REQ-050 | 6.1 |
| REQ-051 | 6.2 |
| REQ-052 | 6.3 |
| REQ-054 | 6.5 |
| REQ-060 | 1.1 |
| REQ-061 | 7.1, 8.1 |
| REQ-062 | 8.1, 8.2 |

(Every REQ-0NN defined in `specs.md` appears above — 28 ids; journeys J1-J4 trace to task 6.5, which in turn traces to its component REQs.)

---

## Completion Definition

ALL of the following MUST hold before the plan may be marked finished:

- [x] Every task checkbox in this file is `[x]` and each has its `outcome/<task-id>-outcome.md`.
- [x] `bun quality-gate` is green end-to-end; baseline deltas (vs task 0.1) are zero or fully attributed.
- [x] All test lanes green via their canonical runners: repo/service/wire/workflow suites via `bun run test/scripts/run-test.ts`.
- [x] INV-P1: every portal read funnels through `requireLinkedChild` on `students.parentId`; wire matrix + journeys J2/J3 prove immediate severance and constant-shape 403 in en AND ar.
- [x] INV-P2: zero new GraphQL mutations on the portal surface (grep-locked in 7.1 + SDL-pinned in 3.3); zero writes of any kind from portal code; no mutation affordances in portal UI.
- [x] R-E: `sessionReport`/`sessionHomework` participant-only queries byte-unchanged (diff-proof recorded).
- [x] R-A grep-lock: zero `parent_link_requests` reads in portal code; R-C grep-lock: zero `evaluations` reads.
- [x] R-J: zero Drizzle schema changes; generated GraphQL codegen artifacts committed and current.
- [x] `deferred-items.md` ledger has zero `❌`/`⚠️` rows (scoped grep: `awk '/^## Ledger Table/,/^## Status Values/'` … `grep -c "❌\|⚠️"` = 0); `📅 Forward` items (D1-D5) still tracked and linked to their owning tickets.
- [x] Canonical doc `docs/parents/monitoring-portal.md` published; root `AGENTS.md` Important References updated; `docs/parents/parent-link-request.md` forward pointer satisfied.
