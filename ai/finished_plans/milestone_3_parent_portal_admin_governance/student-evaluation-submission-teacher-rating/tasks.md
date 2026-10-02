# Implementation Tasks: Student Evaluation Submission (Teacher Rating)

> **Plan of record:** `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/`
> **Specs:** `specs.md` REQ-001..REQ-014 (incl. REQ-J1..J4) · **Design:** `plan.md` D1–D13
> **Ticket:** DEV2-016 (`docs/planning/TICKETS.md:2073`) · Dev 2 · Milestone 3 · 3 SP · Blocker DEV3-012 shipped
> **Deliverables in this directory:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md` · `outcome/`

## Non-Negotiable Execution Protocol

1. **Pre-execution read:** before ANY task, read ALL files under `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/outcome/` (baseline, review verdicts, prior task outcomes).
2. **Per-file quality loop:** after every file edit run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before moving on.
3. **Test commands:** DB/service/journey tests run via `bun run test/scripts/run-test.ts <path>` (NEVER raw `bun test`); GraphQL suites via `bun run test:graphql`; journey tests live under `test/workflows/` with committed fixtures + tracked cleanup, NO `runInRollback` there.
4. **Outcome write-back:** after each task, write `outcome/<task-id>-outcome.md`; flip the checkbox only after its gates pass.
5. **Semantic review:** complete the SR checklist (atomicity, env-config, dead code, cross-layer imports, value-imported enums, zero plan-artifact references in code comments) per subtask.
6. **Fix-or-report:** fix violations inside your assigned file; cross-file dependencies are reported to the orchestrator in the outcome file.

## Layer → Instructions Mapping (applies to every task)

| Path prefix | Read before editing |
|---|---|
| `backend/db/schema/` | `backend/db/schema/AGENTS.md` + `.agents/instructions/backend.instructions.md` |
| `backend/db/repo/` | `backend/db/repo/AGENTS.md`, `backend/AGENTS.md`, backend+tests instructions |
| `backend/types/` | `backend/types/AGENTS.md` + backend instructions |
| `backend/services/` | `backend/services/AGENTS.md`, `backend/AGENTS.md` + backend instructions |
| `backend/graphql/` | `backend/graphql/AGENTS.md` (+ `mutation/`/`query/`/`pothos/` variants), backend instructions |
| `shared/locale/` | `shared/locale/AGENTS.md`, `shared/AGENTS.md` |
| `frontend/**`, `app/**` | `frontend/AGENTS.md`, `frontend/views/AGENTS.md` (defers to frontend), `frontend/graphql/**/AGENTS.md` + frontend instructions |
| `test/workflows/`, `**/*.test.ts` | `test/workflows/AGENTS.md`, tests instructions |

(`scripts/health/sub-loop.ts` auto-prints the exact set per file — follow its output.)

---

## Phase 0 — Baseline & Gate

### - [x] 0.1 Baseline & Ledger Verification — `outcome/phase0-baseline-outcome.md`, `deferred-items.md`
- Re-run and record: `bun tsgo 2>&1 | grep -c "error TS"`, `bun run biome:check`, `bun run scripts/lint-service.ts --json --id baseline-dev2-016` — compare against planning-time baseline (tsgo 0 errors · biome clean · lint exit 0 @ 2026-09-11); record delta, if any.
- Confirm `deferred-items.md` entries D1..D4 + cross-ticket section are present and still accurate.
- _Requirements: REQ-001_
- [x] 0.1.QL **Quality Loop**: not a code task — no sub-loop run; record commands' raw output in the outcome.
- [x] 0.1.TE **Test Engineering**: n/a.
- [x] 0.1.SEC **Security & Tenancy Audit**: n/a.
- [x] 0.1.SR **Semantic Review**: baseline numbers quoted from real command output, never from memory.
- [x] 0.1.IV **Instruction Verification**: root `AGENTS.md` quality-workflow section re-read.

### - [x] 0.2 Plan-Review Gate — `outcome/plan-review-R1.md`
- Confirm the generation-time Phase 1.5 review verdict (`outcome/plan-review-R1.md`) is present and clean; if implementation reveals drift, re-run the review and record R2 before continuing.
- _Requirements: REQ-001_
- [x] 0.2.QL/.TE/.SEC: n/a (verification task).
- [x] 0.2.SR **Semantic Review**: any spec↔code drift discovered during implementation is written back into specs/plan/tasks in the same commit.
- [x] 0.2.IV **Instruction Verification**: `.agents/spec-process-guide/` templates re-read.
---

## Phase 1 — Data Substrate (schema, types, i18n)

### - [x] 1.1 Schema: Write-Once Arbiter + Doc-Comment — `backend/db/schema/teachers/evaluations.ts`
- Add `unique("evaluations_session_evaluator_unique").on(t.sessionId, t.evaluatorId)` as the last element of the constraint block (:42-47, after the three indexes) and add `unique` to the `drizzle-orm/pg-core` import (:2).
- Rewrite the file header doc-comment (:6-19) to document BOTH consumers (applicant evaluation pipeline; student→teacher session rating, `score = rating × 20`).
- Apply with `bun run db push` (schema change; never `db migrate` for this); capture the generated DDL in the outcome; confirm the index exists (`\d evaluations` or DB introspection).
- Verify no data-loss prompt appears (zero existing writer rows — evidence in `outcome/phase0-baseline-outcome.md`).
- _Requirements: REQ-003_
- [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/schema/teachers/evaluations.ts --lifecycle duplicates` (exit 0).
- [x] 1.1.TE **Test Engineering**: covered transitively by 2.1's repo tests (23505 assertion) — mark here once those pass.
- [x] 1.1.SEC **Security & Tenancy Audit**: index introduces no read surface; confirm no existing query breaks (grep all `evaluations` table readers: `platform-analytics.repository.ts` only).
- [x] 1.1.SR **Semantic Review**: constraint name spelled identically in schema and in the service's 23505 mapping (task 2.3); snapshot/drizzle metadata committed by the push flow.
- [x] 1.1.IV **Instruction Verification**: read `backend/db/schema/AGENTS.md` + printed instruction files; comply.

### - [x] 1.2 Canonical Types — `backend/types/teachers/evaluation.types.ts`, `backend/types/classes/session.types.ts`
- Extend evaluation types per `plan.md` §2.3: `EvaluationInsertType`, `EvaluationReturnType` (Omit `isDeleted`/`deletedAt`/`notes`/`updatedAt`), `EvaluationSubmitInput { readonly rating: number }`.
- Add `SessionRatingEligibilityProbeType` (Pick of id/studentId/teacherId/status/confirmedByTeacherAt/confirmedByStudentAt) beside — not altering — `SessionTransitionProbeRowType` (:72-75).
- No barrel edits needed (`export *` covers new symbols); verify with a type-level consumer import in the outcome.
- _Requirements: REQ-004, REQ-001.7_
- [x] 1.2.QL **Quality Loop**: sub-loop on BOTH files, exit 0.
- [x] 1.2.TE **Test Engineering**: type-level correctness is tsgo-enforced (Tier 1); no runtime tests for type aliases.
- [x] 1.2.SEC **Security & Tenancy Audit**: ReturnType omit-list hides soft-delete internals + notes from GraphQL consumers.
- [x] 1.2.SR **Semantic Review**: no duplicate probe types; no new local types elsewhere (Pothos must import these).
- [x] 1.2.IV **Instruction Verification**: read `backend/types/AGENTS.md` + printed instructions.

### - [x] 1.3 i18n Keys — `shared/locale/types/errors/labels.ts`, `shared/locale/{en,ar}/errors/index.ts`, `shared/locale/types/sessions/labels.ts`, `shared/locale/{en,ar}/sessions/labels.ts`
- `errors` (REQ-007): add `evaluationSessionNotCompleted`, `evaluationAlreadySubmitted`, `teacherRatingInvalid` (en+ar, real translations — not transliterations).
- `sessions` (REQ-009.7): add `rateTeacher`, `rateTeacherTooltip`, `rateTeacherDialogTitle`, `rateTeacherDialogSubmit`, `rateTeacherDialogCancel`, `rateTeacherSuccess`, `teacherRatedChip`, `ratingStarAriaLabel (position: number) => string` (en+ar; typed interpolation in `types/sessions/labels.ts`).
- Do NOT touch `sessionRatingRange` (`en/errors/index.ts:97` — belongs to the report flow).
- Run parity: `bun run test/scripts/run-test.ts shared/locale/sessions-namespace.parity.test.ts` and `…/errors-namespace.parity.test.ts`.
- _Requirements: REQ-002, REQ-007, REQ-009_
- [x] 1.3.QL **Quality Loop**: sub-loop on each touched locale/type file (exit 0).
- [x] 1.3.TE **Test Engineering**: the two parity suites (key parity, ICU placeholder agreement, Arabic-script sanity) — extend nothing; they verify automatically.
- [x] 1.3.SEC **Security & Tenancy Audit**: n/a (static strings).
- [x] 1.3.SR **Semantic Review**: interpolation signatures identical en↔ar; no key collisions with existing `sessions` keys (`statusCompleted`, `confirmCompletion`, …).
- [x] 1.3.IV **Instruction Verification**: read `shared/locale/AGENTS.md`, `shared/AGENTS.md` + printed instructions (`@/shared/locale` alias imports only).
---

## Phase 2 — Backend (repository → journey-first → service)

### - [x] 2.1 Repository — `backend/db/repo/teachers/evaluation.repository.ts` (NEW) + `backend/db/repo/classes/session.repository.ts` (EXTEND) + `backend/db/repo/teachers/index.ts` (barrel)
- Create `EvaluationRepository` namespace with `insertOnce(values: Pick<EvaluationInsertType, "evaluatedId" | "evaluatorId" | "sessionId" | "score">, tx)` (typed payload — precedent `insertReport(insert: ReportInsertType, …)` at `backend/db/repo/classes/report.repository.ts:54`) and `listByEvaluator(evaluatorId, tx?)` exactly as specified in `plan.md` §4.2 (soft-delete exclusion mirroring `platform-analytics.repository.ts:384`, order `createdAt DESC, id DESC`). The non-transactional `listByEvaluator` path MUST go through `queryDb` raw SQL per `backend/AGENTS.md:24` (precedent `report.repository.ts:63-72`); the tx path stays Drizzle.
- Extend `SessionRepository` with `findRatingEligibilityProbe(sessionId, tx)` (non-locking; projection = `SessionRatingEligibilityProbeType`; `tx` REQUIRED).
- Add the barrel export; keep the repo free of business logic, translations, and error translation.
- Tests: NEW `backend/db/test/repo/teachers/evaluation.repository.test.ts` — happy-path insert (FK columns + converted score), unique-index 23505 via `expectRepoError` + `constraintNameOf(err) === "evaluations_session_evaluator_unique"`, soft-delete exclusion (soft-deleted row filtered; NULL `is_deleted` rows still returned), ordering with 3 rows, `sessionId: null` rows unaffected by the unique index. Probe coverage added in the closest session repo test file's style (six-column projection, unknown id → null).
- Run: `bun run test/scripts/run-test.ts backend/db/test/repo/teachers/evaluation.repository.test.ts`.
- _Requirements: REQ-005, REQ-012, REQ-013.1_
- [x] 2.1.QL **Quality Loop**: sub-loop on all three edited/created files (exit 0).
- [x] 2.1.TE **Test Engineering**: Tier 1 100% branch coverage of both functions; Tier 2 boundaries (_nullable_ `sessionId`, `isDeleted` tri-state false/null/true); Tier 3 concurrent `insertOnce` pair under `Promise.allSettled`; Tier 4 enormous/absurd ids.
- [x] 2.1.SEC **Security & Tenancy Audit**: `listByEvaluator` is caller-scoped (no teacherId/evaluatedId filter parameter that could widen reads); raw 23505 surfaces untranslated for the service to own.
- [x] 2.1.SR **Semantic Review**: no SELECT-then-INSERT helpers; `tx` unoptional on writes; probe never feeds a guarded update.
- [x] 2.1.IV **Instruction Verification**: read `backend/db/repo/AGENTS.md`, `backend/AGENTS.md` + printed instructions.

### - [x] 2.2 Journey Test (test-first, RED) — `test/workflows/teachers/student-teacher-rating.journey.test.ts` (NEW dir)
- Author the journey for REQ-J1..J4 BEFORE the service exists (RED by failure): new directory `test/workflows/teachers/`.
- Harness (verified patterns): `bun:test`; import real services `SessionLifecycleService` + (future) `StudentEvaluationService`; `journeyPrefix("teachers")`; `createSessionFixtureRegistry()` (`test/workflows/helpers/journey-fixture-registry.ts:122`); `beforeAll` commits fixtures via `buildSessionJourneyCast` (`test/workflows/helpers/session-cast.ts:280-284`); every created row `registry.track(...)`ed; `afterAll` `registry.cleanup()`; final test asserts `registry.trackedCount()`.
- **Registry extension (required first)**: `JourneyTrackedTable` + `JOURNEY_TRACKED_TABLE_DELETE_ORDER` (`test/workflows/helpers/journey-fixture-registry.ts:67-77`) currently do NOT include `evaluations`, and `track("evaluations", …)` would throw. Add `"evaluations"` to the tracked-table union and to the delete order BEFORE `users` (the `evaluator_id → users.id` FK is RESTRICT, `evaluations.ts:28-30` — user teardown must see the rating rows already gone). Extend `test/workflows/helpers/helpers.self-test.test.ts` accordingly (`test/workflows/AGENTS.md` self-test rule).
- Flow: drive the REAL lifecycle (`completeSession` → `confirmSessionCompletion`) to reach dual-confirmation; then assert REQ-J1 (row contents incl. `score = rating × 20`), REQ-J2 (second submit → `EVALUATION_ALREADY_SUBMITTED`; concurrent `Promise.allSettled` pair → exactly one row), REQ-J3 (a second session left `scheduled` → `EVALUATION_SESSION_NOT_COMPLETED`; a teacher-stamp-only session → same code), REQ-J4 (other student → `SESSION_NOT_FOUND`), plus `listMyTeacherEvaluations` reads back exactly the submitted row.
- Denial assertions via local try/catch helper asserting `DomainError.code` + exact translated message from `getServerTranslations("en").errorsTranslations` (pattern: `session-dual-confirmation.journey.test.ts:135-149`). NO `runInRollback` in this file (`test/workflows/AGENTS.md:8-11`).
- Run (RED expected pre-2.3): `bun run test/scripts/run-test.ts test/workflows/teachers/student-teacher-rating.journey.test.ts`.
- _Requirements: REQ-J1, REQ-J2, REQ-J3, REQ-J4, REQ-013.3_
- [x] 2.2.QL **Quality Loop**: sub-loop on the new file (exit 0; the file may fail tests — type/lint must pass).
- [x] 2.2.TE **Test Engineering**: this IS the Tier-1..4 journey deliverable; chaos leg = concurrent dup race.
- [x] 2.2.SEC **Security & Tenancy Audit**: REQ-J4 oracle identity asserted byte-identically (same code + message for unknown id and foreign session).
- [x] 2.2.SR **Semantic Review**: fixtures are committed (not rollback); every row tracked; no seed-data usage.
- [x] 2.2.IV **Instruction Verification**: read `test/workflows/AGENTS.md` + tests instructions.
### - [x] 2.3 Service — `backend/services/teachers/student-evaluation.service.ts` (NEW) + `backend/services/teachers/index.ts`
- Implement `StudentEvaluationService.submitTeacherEvaluation` and `listMyTeacherEvaluations` exactly per `plan.md` §4.1 (guard order, `withTransaction`, probe gate, oracle collapse, 23505 mapping, one `logDomainError` per denial, success logs nothing).
- Reuse `assertPositiveSafeSessionId` (`backend/services/classes/session-lifecycle.guards.ts:123`) — do not re-implement id guards.
- Service tests `backend/services/teachers/student-evaluation.service.test.ts` (template: `backend/services/classes/recitation.service.test.ts`): every REQ-006/REQ-007 denial; rating matrix 1..5 → score 20..100; rating 0 / 6 / 2.5 / NaN / non-integer string-coerced values → `VALIDATION` with `fields[]`; `outerTx` SAVEPOINT propagation; log-spy per denial; `listMyTeacherEvaluations` scoping (two students, each sees only their own).
- Journey (2.2) MUST go green here; capture run output in the outcome.
- Run: `bun run test/scripts/run-test.ts backend/services/teachers/student-evaluation.service.test.ts` and re-run the journey.
- _Requirements: REQ-006, REQ-007, REQ-011, REQ-012, REQ-013.2_
- [x] 2.3.QL **Quality Loop**: sub-loop on service + test + barrel (exit 0).
- [x] 2.3.TE **Test Engineering**: 4-tier matrix per REQ-013.2 (incl. `Promise.allSettled` duplicate storm at service level).
- [x] 2.3.SEC **Security & Tenancy Audit**: BOLA (server-derived evaluator), BOPLA (no spread), oracle byte-identity, denial logging exactly once.
- [x] 2.3.SR **Semantic Review**: no lifecycle writes (read-only consumption per `docs/sessions/session-lifecycle.md:163`); no notifications/audit emitted (D7); no module-level state.
- [x] 2.3.IV **Instruction Verification**: read `backend/services/AGENTS.md`, `backend/AGENTS.md` + printed instructions.

---

## Phase 3 — GraphQL Surface

### - [x] 3.1 Pothos Types — `backend/graphql/pothos/teachers/evaluation.pothos.ts` (NEW)
- Define `EvaluationPothosObject` (fields: `id` first, `evaluatedId`/`evaluatorId` Int!, `sessionId` Int nullable, `score` Int nullable, `createdAt` DateTime!) over `EvaluationReturnType`, and `SubmitTeacherEvaluationPothosInput` (`rating: Int!`, string-named `inputType`).
- No local type declarations; no enum literals; registration is transitive via 3.2/3.3 imports (mirrors `pothos/teachers/applicant.pothos.ts`).
- _Requirements: REQ-008, REQ-004_
- [x] 3.1.QL **Quality Loop**: sub-loop exit 0.
- [x] 3.1.TE **Test Engineering**: SDL pins land in 3.4 (asserted there).
- [x] 3.1.SEC **Security & Tenancy Audit**: object exposes only `EvaluationReturnType` fields (no soft-delete/notes).
- [x] 3.1.SR **Semantic Review**: nullability matches `plan.md` §3.1 exactly; no `inputRef` coupling.
- [x] 3.1.IV **Instruction Verification**: read `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md` + printed instructions.

### - [x] 3.2 Mutation — `backend/graphql/mutation/classes/student-evaluation.mutation.ts` (NEW) + `backend/graphql/mutation/classes/index.ts`
- Register `submitTeacherEvaluation` per `plan.md` §3.2 (thin resolver: `$all` student scope, `ctx.user` narrowing with `await ctx.t("errorsTranslations")`, `requirePositiveIntId` coercion, member-mapped input, single service delegation; no try/catch, no business logic).
- Add the side-effect import to the classes barrel (list near `session-report.mutation`).
- _Requirements: REQ-008, REQ-011, REQ-002_
- [x] 3.2.QL **Quality Loop**: sub-loop exit 0.
- [x] 3.2.TE **Test Engineering**: wire coverage lands in 3.4; here, compile-time resolver-shape checks only.
- [x] 3.2.SEC **Security & Tenancy Audit**: `$all` conjunction (never plain key-map); no client-supplied evaluator id.
- [x] 3.2.SR **Semantic Review**: file has no named exports; resolver is logic-free; locale comes from `ctx.locale`.
- [x] 3.2.IV **Instruction Verification**: read `backend/graphql/mutation/AGENTS.md` + printed instructions.

### - [x] 3.3 Query — `backend/graphql/query/teachers/student-evaluation.query.ts` (NEW) + `backend/graphql/query/teachers/index.ts`
- Register `myTeacherEvaluations` (`$all` student scope; delegate to the service) per `plan.md` §3.2 bullet 3; add the side-effect import to the teachers query barrel (`myApplicantProfile` precedent).
- _Requirements: REQ-008_
- [x] 3.3.QL **Quality Loop**: sub-loop exit 0.
- [x] 3.3.TE **Test Engineering**: wire coverage in 3.4 incl. empty-list shape.
- [x] 3.3.SEC **Security & Tenancy Audit**: caller-scoped service call; no args that could widen scope.
- [x] 3.3.SR **Semantic Review**: non-paginated by design (D12) — note in outcome.
- [x] 3.3.IV **Instruction Verification**: read `backend/graphql/query/AGENTS.md` + printed instructions.
### - [x] 3.4 Registration, SDL Pins, Wire Tests, Codegen
- Run `bun run generate:gqlSchema && bun codegen`; commit the regenerated artifacts.
- Extend `backend/graphql/test/sdl-static-assertions.test.ts`: `Evaluation` type fields, `submitTeacherEvaluation`, `myTeacherEvaluations` pins.
- NEW `backend/graphql/test/student-evaluation.wire.test.ts` (`setupTestServerLifecycle` + `testClient` + `expectMutationError`): anonymous → UNAUTHORIZED; teacher/parent role → FORBIDDEN; happy-path mutation returns the row (score = rating×20); all four spec'd error codes pinned; query returns only the caller's rows; `extensions.fields` present on VALIDATION.
- Run `bun run test:graphql`.
- _Requirements: REQ-008, REQ-011, REQ-013.4_
- [x] 3.4.QL **Quality Loop**: sub-loop on the two test files (exit 0).
- [x] 3.4.TE **Test Engineering**: covers Tier-1 wire matrix + Tier-4 role matrix; error `code` assertions only, never HTTP status.
- [x] 3.4.SEC **Security & Tenancy Audit**: proves the REQ-011 role matrix over the wire.
- [x] 3.4.SR **Semantic Review**: no public-operation allowlist edit; SDL pins are additive.
- [x] 3.4.IV **Instruction Verification**: read the backend GraphQL test guidance (`backend/graphql/AGENTS.md`, error-contract docs) + tests instructions.

---

## Phase 4 — Frontend (documents → hook/dialog → CTA → deep link)

### - [x] 4.1 GraphQL Documents — `frontend/graphql/sharedDocuments/teachers/student-evaluation.documents.ts` (NEW) + teachers `index.ts`
- `submitTeacherEvaluationMutationDocument` + `myTeacherEvaluationsQueryDocument` per REQ-009.1 (TypedDocumentNode naming, `id` first in every selection, `import { gql, type TypedDocumentNode } from "@apollo/client"` per `sharedDocuments/AGENTS.md`).
- Verify the sessions-list documents already expose `confirmedByTeacherAt`/`confirmedByStudentAt` on row items (`frontend/graphql/sharedDocuments/scheduling/session-reads.documents.ts:75` `myStudentSessionsQueryDocument`); if absent, add both fields in the SAME task and record it in the outcome (flagged assumption, specs §4).
- _Requirements: REQ-009_
- [x] 4.1.QL **Quality Loop**: sub-loop exit 0 on the new file (+ documents file if touched).
- [x] 4.1.TE **Test Engineering**: `frontend/graphql/sharedDocuments/documents.contract.test.ts` conventions (shape/id-first) cover the file — assert it picks the new documents up.
- [x] 4.1.SEC **Security & Tenancy Audit**: selections expose only `Evaluation` public fields.
- [x] 4.1.SR **Semantic Review**: no inline type literals; generated-type imports only.
- [x] 4.1.IV **Instruction Verification**: read `frontend/graphql/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`.

### - [x] 4.2 Hook + Dialog + CTA Wiring — `frontend/views/student/sessions/useMyTeacherEvaluations.ts` (NEW), `RateTeacherDialog.tsx` (NEW), `useStudentSessionConfirm.ts` (EXTEND), `StudentSessionsDialogs.tsx` (EXTEND)
- Build the rated-set hook, the dialog (MUI `Rating` 1..5, a11y + reduced-motion + RTL-safe), the `rate` descriptor with the REQ-009.2 gate, dialog hosting in the existing slot system, and success/error paths per REQ-009.5/6 (cache `update()`; error-link map additions for `EVALUATION_SESSION_NOT_COMPLETED` + `EVALUATION_ALREADY_SUBMITTED`).
- SESSION_NOT_FOUND on submit → evict the row via the existing `sessionListCacheEviction` helper semantics.
- _Requirements: REQ-009, REQ-011, REQ-002_
- [x] 4.2.QL **Quality Loop**: sub-loop on each touched file (exit 0).
- [x] 4.2.TE **Test Engineering**: component coverage in 4.4; hook logic verified through the dialog component path.
- [x] 4.2.SEC **Security & Tenancy Audit**: no `console.*`; deny-paths never log sensitive payloads client-side.
- [x] 4.2.SR **Semantic Review**: gated on enum-string lookup tables (no `===` on enums); no hardcoded colors; no direct style props on MUI components.
- [x] 4.2.IV **Instruction Verification**: read `frontend/AGENTS.md`, `frontend/views/AGENTS.md` + frontend instructions.

### - [x] 4.3 Notification Deep-Link — `frontend/lib/notification-route-resolution.ts` (EXTEND)
- Map `NotificationType.SessionCompletion → STUDENT_SESSIONS_ROUTE`; NO such constant exists today — create it in the leaf module following the `STUDENT_LINK_REQUESTS_ROUTE` precedent (`frontend/lib/notification-route-resolution.ts:13-16`), and point the existing nav item at the same constant (`frontend/views/dashboard/nav/navItems.ts:119` currently holds the `"/student/sessions"` literal) so the route is genuinely single-sourced; extend the existing route-resolution unit tests (unmapped types still fall back to `/notifications`).
- _Requirements: REQ-010_
- [x] 4.3.QL **Quality Loop**: sub-loop exit 0.
- [x] 4.3.TE **Test Engineering**: table-driven additions for the new mapping + fallback preservation.
- [x] 4.3.SEC **Security & Tenancy Audit**: navigation target is a role-guarded page already (`withPageAuth`).
- [x] 4.3.SR **Semantic Review**: route literal single-sourced (no second literal in the repo).
- [x] 4.3.IV **Instruction Verification**: read `frontend/AGENTS.md` + frontend instructions.

---

## Phase 5 — Review Wave & Knowledge Propagation

### - [x] 5.1 Post-Implementation Review Wave (parallel subagents)
- Dispatch scoped reviewers (types / backend / frontend / security) over the plan's file set only; aggregate findings CRITICAL→LOW; fix per-file with sub-loop verification; repeat until zero feature-specific findings. Record verdicts in `outcome/5.1-review-wave-outcome.md`.
- _Requirements: REQ-001, REQ-011, REQ-012_
- [x] 5.1.QL **Quality Loop**: sub-loop exit 0 on every file touched by fixes.
- [x] 5.1.TE **Test Engineering**: every fixhood re-runs its owning suite from §7 of `plan.md`.
- [x] 5.1.SEC **Security & Tenancy Audit**: reviewers reproduce the REQ-011 matrix from the wire tests.
- [x] 5.1.SR **Semantic Review**: zero deferred items created without a `deferred-items.md` entry.
- [x] 5.1.IV **Instruction Verification**: reviewers read each file's printed rule set.

### - [x] 5.2 Knowledge Propagation — `docs/teachers/student-evaluation-submission.md` (NEW)
- Author the canonical doc (per the propagation template): rating write contract, gate predicate, `score = rating × 20` conversion + DEV2-017 aggregation forward contract (`avg(score)/20` → `teacher.average_rating`), error-code table, security posture, what-NOT-to-do (no pre-check SELECT, no lifecycle writes, no `sessionRatingRange` reuse).
- Append the doc pointer to the DEV2-016 consumer line in `docs/sessions/session-lifecycle.md:163` (link only; no semantic change).
- Do NOT touch AGENTS.md / `.agents/instructions/` (hand-curated).
- _Requirements: REQ-014_
- [x] 5.2.QL **Quality Loop**: markdown lint surface — run sub-loop equivalent checks available for md; tsgo/lint unaffected by docs (record n/a with evidence).
- [x] 5.2.TE **Test Engineering**: n/a (documentation).
- [x] 5.2.SEC **Security & Tenancy Audit**: doc discloses the error contract accurately (codes + oracle policy).
- [x] 5.2.SR **Semantic Review**: links resolve; line refs are current at write time.
- [x] 5.2.IV **Instruction Verification**: n/a beyond root `AGENTS.md` doc conventions.

### - [x] 5.3 Final Gate & Definition-of-Done Audit
- `bun quality-gate` green; re-record tsgo/biome/lint counts against the 0.1 baseline (no regressions attributable to this plan).
- Full relevant suites green: repo, service, journey, wire (`test:graphql`).
- DoD sweep against `specs.md` §5; close out the ledger; final checkbox sweep.
- _Requirements: REQ-001, REQ-013, all others transitively_
- [x] 5.3.QL **Quality Loop**: `bun quality-gate` exit 0.
- [x] 5.3.TE **Test Engineering**: suite table pasted into the outcome with counts.
- [x] 5.3.SEC **Security & Tenancy Audit**: REQ-011 matrix re-run once, end to end.
- [x] 5.3.SR **Semantic Review**: every REQ id from `specs.md` appears in this file (traceability audit command in §below).
- [x] 5.3.IV **Instruction Verification**: sweep — every edited file's printed rule set was read (attest in outcome).

## Traceability Command (run at 5.3)

```bash
cd ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating
for r in $(grep -oE 'REQ-[0-9]+' specs.md | sort -u); do grep -q "$r" tasks.md || echo "MISSING: $r"; done
for j in REQ-J1 REQ-J2 REQ-J3 REQ-J4; do grep -q "$j" tasks.md || echo "MISSING: $j"; done
```

## Dependency Graph

```
0.1 → 0.2 → 1.1 → 1.2 → 1.3 → 2.1 → 2.2 (RED) → 2.3 (GREEN) → 3.1 → 3.2 → 3.3 → 3.4 → 4.1 → 4.2 → 4.3 → 4.4 → 5.1 → 5.2 → 5.3
```

(1.1/1.2/1.3 are mutually independent; 2.2 and 2.3 are a red/green pair and must not be reordered.)
