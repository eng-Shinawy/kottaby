# Requirements & Specification: Teacher Average Rating Aggregation & Update

> **Target ticket:** `Teacher Average Rating Aggregation & Update` — DEV2-017 (`docs/planning/TICKETS.md:2108-2139`; Owner: Dev 2 · Milestone 3 · 3 SP)
> **Plan directory:** `ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/`
> **Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/outcome/`
> **Blocking dependencies:** DEV2-016 Student Evaluation Submission (Teacher Rating) — **shipped** (`ai/finished_plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/`; canonical contract in `docs/teachers/student-evaluation-submission.md`)
> **Decision Refs:** FR-8.2 (teacher ratings influence search ranking), INV-E4 (teacher evaluations update `teacher.average_rating`, 0–5 scale)
> **Version:** 1.0 · **Date:** 2026-09-17

---

## 1. Introduction

Every student→teacher session rating written by DEV2-016 lands in the shared `evaluations` table (`score` on the 0–100 scale, `session_id` always populated). This ticket is the aggregation consumer that contract always named as its forward target: on every committed rating submission, the teacher's cached `teacher.average_rating` column is recalculated as the average of ALL live student-rating rows for that teacher, converted back onto the column's 0–5 decimal(3,2) scale, and clamped by the existing `teacher_average_rating_check` constraint. A teacher with no live ratings reads as `NULL` today (column nullable, no default), which every existing renderer already renders as the localized "not rated yet" em-dash state — this ticket preserves that honest-null contract and registers the ticket's literal "default 0" as a deferred semantic conflict (see `deferred-items.md`).

### 1.1 Feature Summary

`StudentEvaluationService.submitTeacherEvaluation` gains a second write inside its existing single transaction: after the rating row inserts, the rated teacher's `average_rating` is recomputed from the live rating family (`evaluated_id = teacher`, `session_id IS NOT NULL`, soft-deleted excluded) via `ROUND(AVG(score) / 20, 2)` and stored in one guarded UPDATE. The aggregation runs atomically with the rating insert — a rollback of either is a rollback of both — and introduces no new route, page, mutation, or query: every existing read surface (admin directory, admin user detail, platform analytics) begins reflecting the maintained value through the columns they already select.

### 1.2 Business Value

- **INV-E4 closes:** teacher evaluations (submitted by students) now update `teacher.average_rating` on the 0–5 scale (`docs/specs/state-machine-invariants.md:317`) — the invariant was documented as a forward contract in DEV2-016 and is now enforced in code.
- **FR-8.2 lands its data substrate:** teacher ratings "directly influence search ranking and visibility" (`docs/specs/functional-requirements.md:238-240`) — the maintained column is the ranking input. The student-facing teacher-search/ranking surface itself does not exist yet in the codebase; its binding is registered as a forward contract plus a deferred item (`deferred-items.md` D2), mirroring how DEV2-016 deferred this very ticket.
- **Trust surfaces stay cheap:** the admin teacher directory, admin user detail, and platform-analytics reads keep selecting the cached column; no read path pays a per-row AVG.
- **Data hygiene:** soft-deleted (moderation-removed) ratings drop out of the average at the next recalculation; the value is always recomputed from ground truth, never incremented/decremented.

### 1.3 Scope

**In scope:**
- Atomic `teacher.average_rating` recalculation inside DEV2-016's existing submission transaction (evaluations insert + teacher UPDATE in ONE unit of work).
- One new repository aggregate (`EvaluationRepository` live-rating AVG read) + one new guarded teacher UPDATE (`TeacherRepository.updateAverageRating`).
- Conversion contract: `average_rating = ROUND(AVG(score) / 20, 2)` over live rating rows only (applicant evaluations with `session_id IS NULL` excluded — per the canonical forward contract, `docs/teachers/student-evaluation-submission.md:65-68`).
- Honest-null semantics preserved: zero live ratings ⇒ `average_rating = NULL` (never a fabricated 0) — documented ruling against the ticket's literal "default 0" (deferred-items D1).
- Service-layer tests, repo tests, journey test extension, canonical doc.
- Cross-actor journey: student rates → teacher's cached average moves → admin directory reflects it.

**Explicitly out of scope (registered in `deferred-items.md`):**
- Student-facing teacher search/browse/ranking query & UI — no such surface exists in the codebase today (verified: `backend/graphql/query/` has no teacher-list query; only admin directory `admin-teachers.query.ts`). The column is the ranking input for that future surface (ledger D2).
- Recalculation on rating soft-delete (no soft-delete mutation surface exists yet; the moderation flow is a future ticket — ledger D3 documents the recompute hook obligation).
- Batch backfill job for historical rows (zero production rating rows predate this feature; the DEV2-016 contract guarantees the invariant starts maintained — ledger D4).
- Rating visibility to the rated teacher, parent-portal rating surfaces, notification on rating (all named as future consumers in `docs/teachers/student-evaluation-submission.md:74`).
- Any change to the student rating UI, documents, or error contract.

---

### 1.4 Existing Codebase State (verified inventory — every row grep/view confirmed)

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | `teacher.average_rating` column — `decimal("average_rating", { precision: 3, scale: 2 })`, nullable, NO default | **EXISTS — NOT TOUCHED** (this ticket only writes it) | `backend/db/schema/teachers/teacher.ts:27` |
| 2 | `teacher_average_rating_check` — `>= 0 AND <= 5` | **EXISTS — BINDING** (the 0–5 clamp is DB-enforced) | `backend/db/schema/teachers/teacher.ts:37` |
| 3 | `evaluations` table, dual-consumer (applicant rows `session_id NULL`; student ratings `session_id` set, `score = rating × 20`) | **EXISTS** | `backend/db/schema/teachers/evaluations.ts:34-61`, doc-comment `:6-33` |
| 4 | `evaluations_score_check` (0–100) + `evaluations_session_evaluator_unique` | **EXISTS — BINDING** (write-once arbiter) | `backend/db/schema/teachers/evaluations.ts:56,60` |
| 5 | Rating write path: `StudentEvaluationService.submitTeacherEvaluation` (guards → one tx → probe → gates → `EvaluationRepository.insertOnce`) | **EXISTS — EXTEND** (add the aggregation step inside `submitWithinTransaction`) | `backend/services/teachers/student-evaluation.service.ts:210-263`, tx body `:122-175`, insert `:165-173` |
| 6 | Service's documented cross-surface purity — "writes to the `evaluations` table ONLY" (header `:35-37`) | **EXISTS — UPDATE** (doc-comment must name the second, same-tx write target) | `backend/services/teachers/student-evaluation.service.ts:35-37` |
| 7 | `EvaluationRepository` (`insertOnce`, `listByEvaluator`) | **EXISTS — EXTEND** (add the live-rating AVG aggregate) | `backend/db/repo/teachers/evaluation.repository.ts:73,100` |
| 8 | `TeacherRepository` (`findById`, `lockForCertificationCheck`, `insertColdStartCertified`, `elevateToCertified`, `listDirectory`, `setOnline`) | **EXISTS — EXTEND** (add `updateAverageRating`) | `backend/db/repo/teachers/teacher.repository.ts:147,192,216,249,287,367` |
| 9 | Aggregation formula contract — `ROUND(AVG(score) / 20, 2)`, `session_id IS NOT NULL`, soft-delete exclusion | **EXISTS — BINDING** (canonical forward contract this ticket implements) | `docs/teachers/student-evaluation-submission.md:65-68` |
| 10 | 0–100 aggregate-read precedent (`avg(score)` + NULL-safe soft-delete filter + `round(…, 2)::float8`) | **EXISTS — REUSE** (pattern reference) | `backend/db/repo/admin/platform-analytics.repository.ts:366-403` |
| 11 | Existing read surfaces of the cached column (admin directory row + mapper parser; admin user detail snapshot; GraphQL `exposeFloat`) | **EXISTS — NOT TOUCHED** (begin reflecting maintained values automatically) | `backend/db/repo/teachers/teacher.repository.ts:305`; `backend/services/admin/teacher-directory.mappers.ts:38-44,61`; `backend/db/repo/admin/admin-user.repository.ts:300`; `backend/graphql/pothos/admin/admin-teachers.pothos.ts:51` |
| 12 | Nullable-rating rendering precedent ("not rated yet" em-dash / honest-null, never fabricated 0) | **EXISTS — BINDING** (the NULL-vs-0 ruling follows it) | `frontend/views/admin/teachers/adminTeachersDirectory.helpers.ts:74-81`; `backend/db/repo/admin/platform-analytics.repository.ts:39-41` |
| 13 | Entity fixtures: `createTestTeacherRow` (accepts `averageRating` override as decimal string), `createTestEvaluation` (`score` default 85, soft-delete override) | **EXISTS — REUSE** | `backend/db/test/entity-setup.ts:522-542,412-437` |
| 14 | Journey harness incl. `evaluations` in tracked tables + delete order | **EXISTS — EXTEND** (extend the existing rating journey with aggregation steps) | `test/workflows/teachers/student-teacher-rating.journey.test.ts:442-724`; `test/workflows/helpers/journey-fixture-registry.ts:65,81,102` |
| 15 | Repo test utilities (`runInRollback`, `expectRepoError`, `constraintNameOf`) | **EXISTS — REUSE** | `backend/db/test/test-utils.ts:111`; usage `backend/db/test/repo/teachers/evaluation.repository.test.ts:80,360-374` |
| 16 | Student-facing teacher search/ranking surface | **ABSENT — NOT THIS TICKET** (no student-facing teacher browse query/service exists; ranking consumer is the ledger D2 forward contract) | `backend/graphql/query/teachers/` holds only `applicant.query.ts` + `student-evaluation.query.ts` |
| 17 | Any existing writer of `teacher.average_rating` | **ABSENT — CREATE** (grep: all usages are reads or test fixtures; `createTestTeacherRow` writes `null`) | `backend/db/repo/teachers/teacher.repository.ts:97,158,305`; `backend/db/test/entity-setup.ts:534` |
| 18 | i18n: this feature adds **zero** user-facing strings (no new UI, no new denials) | **n/a — NO KEYS** (locale surfaces untouched) | `shared/locale/en/errors/index.ts` (rating keys `:118-121` belong to DEV2-016, untouched) |

---

## 2. Requirements

### 2.1 Baseline & Foundational Preparation (MANDATORY)

#### REQ-001 — Pre-Implementation Baseline & Execution Protocol

**User Story:** As the implementing agent, I want a recorded quality baseline and a durable outcome/ledger protocol, so that new issues are distinguishable from pre-existing ones and knowledge is never re-derived.

**Acceptance Criteria:**
1. WHEN implementation begins THEN the executor SHALL record baseline counts (`bun tsgo` error count, `bun run biome:check` summary, `bun run scripts/lint-service.ts --json --id baseline` exit code) in `outcome/phase0-baseline-outcome.md` **(baseline at plan-generation time, 2026-09-17: tsgo = 0 errors; biome = clean, 2037 files; lint = `success: true`, exit 0 — re-verify at execution start)**.
2. WHEN implementation begins THEN the executor SHALL maintain the deferred-items ledger at `ai/plans/milestone_3_parent_portal_admin_governance/teacher_average_rating_aggregation_update/deferred-items.md`.
3. WHEN starting ANY task THEN the executor SHALL read ALL existing outcome files in the plan's `outcome/` directory.
4. WHEN completing a task THEN the executor SHALL write `outcome/<task-id>-outcome.md` with research, implementation details, and carry-over points.
5. WHEN completing a subtask THEN the executor SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the executor SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file before proceeding.
7. WHEN marking any subtask complete THEN the executor SHALL complete the semantic-review checklist (race conditions, env-config, dead code, cross-layer imports, value-imported enums, zero plan-artifact references like `REQ-x`/`Task N` in code comments).

### 2.2 Localization & Enum Compliance

#### REQ-002 — Compile-Time i18n & Enum Value Imports (zero-new-keys ruling)

**User Story:** As a maintainer, I want the feature to add zero translation surface while provably conforming to the locale system, so parity cannot drift and reviewers need not hunt for phantom strings.

**Acceptance Criteria:**
1. WHEN the aggregation is wired THEN the implementation SHALL add **no new i18n keys** (no new UI copy, no new denial codes, no new namespaces) — the feature is a same-transaction data write behind an existing mutation (`shared/locale/en/errors/index.ts:118-121` keys belong to DEV2-016 and SHALL NOT be touched).
2. IF any user-facing string becomes necessary during implementation (it must not) THEN the executor SHALL add it to BOTH `shared/locale/en/errors/index.ts` and `shared/locale/ar/errors/index.ts` with the typed label in `shared/locale/types/errors/labels.ts` — but the plan's ruling is zero keys; a discovered need is a spec-drift report to the plan-review outcome, not a silent addition.
3. WHEN an enum (e.g. none expected — this flow uses no new enums) would be used in a runtime expression THEN it SHALL be a value import with enum members, never string literals.
4. FORBIDDEN (standing, verified anchors): `next-intl` imports; `getBackendTranslations`; `shared/messages/` references; hardcoded user-facing strings; two-argument `getTranslations` (verified signatures: `getTranslations(locale)` at `shared/locale/server.ts:15`, `getServerTranslations(locale)` at `shared/locale/server-graphql.ts:3`).

### 2.3 Data Model & Schema

#### REQ-003 — Zero Schema Change (column + clamp already exist)

**User Story:** As the platform, I want the aggregation to land with zero schema change, so the riskiest part of the ticket is nothing.

**Acceptance Criteria:**
1. WHEN the feature ships THEN `backend/db/schema/teachers/teacher.ts` SHALL be untouched: `averageRating` `decimal(3,2)` nullable without default (`:27`) and `teacher_average_rating_check` (`:37`) already provide the storage and the 0–5 clamp.
2. WHEN the feature ships THEN `backend/db/schema/teachers/evaluations.ts` SHALL be untouched — the aggregation is a read over existing columns; no index is added in this ticket (the `evaluations_evaluated_id_idx` at `:57` already serves the `evaluated_id = $1` filter; rating-row counts per teacher are naturally small).
3. WHEN the feature ships THEN the executor SHALL run NO `bun run db push` and NO `bun db migrate` (nothing to apply; the migration snapshot tree stays untouched — verified latest migration `backend/drizzle/20260915232950_custom_7-notification-dispute-types/`).
4. IF a stored average could ever exceed the 0–5 CHECK THEN the CHECK SHALL reject the write (`23514` check violation) — the executor SHALL NOT catch or translate that constraint error in the repository; the service rethrows it untouched (a violated clamp is a defect to surface loudly, never to mask). The formula's inputs make this unreachable (scores are CHECK-bound 0–100 ⇒ `/20` ⇒ 0–5), which is exactly why it needs no defensive code.

#### REQ-004 — Canonical Types (`backend/types/`)

**User Story:** As a developer, I want the aggregate row-shape typed once in `backend/types/`, so every layer compiles against the same projection.

**Acceptance Criteria:**
1. WHEN the repository aggregate is added THEN `backend/types/teachers/evaluation.types.ts` SHALL gain exactly one additive export (existing `EvaluationSelectType` `:3`, `EvaluationInsertType` `:5`, `EvaluationReturnType` `:14`, `EvaluationSubmitInput` `:21-23` preserved verbatim):

```ts
/**
 * Single-row aggregate over one teacher's live student-rating family:
 * `averageScore` is the 0-100-scale mean (or null when no live rating
 * rows exist — never a fabricated value), `ratingCount` the live sample
 * size behind it.
 */
export interface EvaluationRatingAggregateType {
  readonly averageScore: number | null;
  readonly ratingCount: number;
}
```

2. WHEN the teacher write is added THEN `backend/types/teachers/teacher.types.ts` SHALL gain no new type — `TeacherRepository.updateAverageRating` returns the existing `TeacherSelectType` (`:3`) via `.returning()` (the single canonical select shape needs no twin).
3. WHEN the types land THEN `backend/types/teachers/index.ts` SHALL need NO edit — its `export * from "./evaluation.types";` picks up the new interface automatically (verified barrel content); the executor SHALL verify with a type-level consumer import in the outcome.
4. No `.types.ts` file SHALL appear outside `backend/types/` (services AGENTS rule: service-layer types are prohibited — `backend/services/AGENTS.md:9`).

### 2.4 Repository Layer

#### REQ-005 — Aggregate Read + Guarded Teacher Update

**User Story:** As the service layer, I want two typed data-access functions — a live-rating aggregate and a guarded average UPDATE — so business logic stays out of SQL.

**Acceptance Criteria:**
1. WHEN the aggregate is added THEN `backend/db/repo/teachers/evaluation.repository.ts` SHALL export, inside the existing `EvaluationRepository` namespace, exactly:

```ts
/**
 * Aggregates one teacher's LIVE student-rating family: rows with
 * evaluated_id = the teacher, session_id IS NOT NULL (applicant
 * evaluations are a different flow on the shared table), score
 * non-null, soft-deleted rows excluded NULL-safely.
 */
export async function aggregateLiveRatings(
  evaluatedId: number,
  tx: DBTransaction
): Promise<EvaluationRatingAggregateType>;
```

   - `tx` REQUIRED (last parameter) — the aggregate feeds a same-transaction write; a cold branch would be a read-your-write hazard.
   - `averageScore` = `AVG(score)` over the live family on the 0–100 scale, computed **in SQL** (`avg(${evaluations.score})::float8`) — the float8 cast is load-bearing: pg returns bare `numeric` as a JS string, which would contradict this type; the repo's own aggregate precedent casts to float for exactly this reason (`platform-analytics.repository.ts:366-403`). Never materialize rows into JS and reduce client-side (unbounded row fan-out into a service).
   - `ratingCount` = `count(*)` of the same family (`::int` mapping per the repo AGENTS conditional-aggregation rule — `backend/db/repo/AGENTS.md:34`).
   - Empty family ⇒ `{ averageScore: null, ratingCount: 0 }` (a SQL `avg/count` over zero rows already yields exactly that — the empty case needs no special-casing, only honest projection).
   - Filters: `eq(evaluations.evaluatedId, evaluatedId)`, `isNotNull(evaluations.sessionId)`, `or(eq(evaluations.isDeleted, false), isNull(evaluations.isDeleted))` (NULL-safe soft-delete exclusion — precedent `platform-analytics.repository.ts:386-389`), and `isNotNull(evaluations.score)` (NULL scores are absent from `AVG` by SQL semantics anyway; the explicit filter keeps `ratingCount` and `averageScore` agreeing on the same family).
   - No business logic, no i18n, no logging in the repo (repo AGENTS).

2. WHEN the teacher write is added THEN `backend/db/repo/teachers/teacher.repository.ts` SHALL export, inside the existing `TeacherRepository` namespace, exactly:

```ts
/**
 * Writes the teacher's cached average_rating in ONE guarded UPDATE
 * (row identity in the WHERE clause, RETURNING the updated row). The
 * value arrives already converted to the column's 0-5 decimal(3,2)
 * scale and clamped by teacher_average_rating_check at the DB.
 */
export async function updateAverageRating(
  teacherId: number,
  averageRating: string,
  tx: DBTransaction
): Promise<TeacherSelectType | null>;
```

   - `tx` REQUIRED (write convention — `backend/db/repo/AGENTS.md:30`).
   - The rating value is passed as a **decimal string** (e.g. `"4.25"`) — Drizzle's default numeric mode treats the column as string-typed; a JS float would round-trip through float64 and could violate the column's exact-decimal discipline (fixture precedent passes strings: `entity-setup.ts:534` `averageRating: null`, overrides documented as decimal strings `:540-541`).
   - The payload is exactly `{ averageRating, updatedAt: sql`now()` }` — member-by-member, never a spread of a caller object (BOPLA discipline).
   - Zero-row result (`null`) = no `teacher` row for the id — the service owns the semantics (a rating can only target a teacher whose probe row existed; see REQ-006.4).
3. WHEN either repository function is added THEN the file's header doc-comment SHALL be amended in the SAME change to describe the new method's contract (both repos carry method inventories in their headers — `teacher.repository.ts:2-38`, `evaluation.repository.ts:2-38`).
4. Repo unit tests SHALL cover (REQ-010.1): aggregate over the full live family; applicant rows (`session_id NULL`) excluded; soft-deleted rows excluded; NULL-score rows excluded from both mean and count; empty family ⇒ `{ null, 0 }`; boundary scores 20/100 ⇒ averages 1.00/5.00; `updateAverageRating` happy path stores the exact decimal string and refreshes `updatedAt`; unknown teacher id ⇒ `null` and zero writes; a `> 5` value ⇒ the `teacher_average_rating_check` violation surfaces untranslated via `expectRepoError` + `constraintNameOf` (never `expect().rejects`).

### 2.5 Core Feature Logic / Service Layer

#### REQ-006 — Atomic Aggregation Step Inside the Submission Transaction

**User Story:** As a teacher, I want my visible average to move the moment a student's rating commits — and never to move without it — so the cached column is always explainable from the rating rows.

**Acceptance Criteria:**
1. WHEN `StudentEvaluationService.submitTeacherEvaluation` succeeds THEN the teacher's `average_rating` SHALL have been recomputed and stored within the SAME transaction that inserted the rating row (extend `submitWithinTransaction`, `student-evaluation.service.ts:122-175` — after `EvaluationRepository.insertOnce` at `:165-173`).
2. The pipeline inside the transaction SHALL be, in this exact order:
   1. eligibility probe + participant oracle + completion gate (unchanged, `:130-164`);
   2. `EvaluationRepository.insertOnce(...)` (unchanged, `:165-173`);
   3. `const aggregate = await EvaluationRepository.aggregateLiveRatings(probe.teacherId, tx)` — the rated subject IS `probe.teacherId` (server-derived; never a client value);
   4. convert: `averageScore === null` ⇒ the write is skipped (zero live ratings is unreachable on this path by construction — the row just inserted is live — but the contract is honest-null, and the skip is the defense); otherwise `const averageRating = (aggregate.averageScore / SCORE_POINTS_PER_STAR).toFixed(2)` — a decimal string, 2 fraction digits, on the 0–5 scale;
   5. `await TeacherRepository.updateAverageRating(probe.teacherId, averageRating, tx)`; a `null` return (no teacher row — the probe row's teacher always has one in practice, `session.teacherId` → `teacher.id` = `users.id` shared-PK family) SHALL be treated as an internal-consistency failure: log one bounded `logger.logDomainError` entry through the file's existing `logDenial` helper (`student-evaluation.service.ts:87-89` — `code: "TEACHER_PROFILE_MISSING"`, `entity: "teacher"`, `entityId: probe.teacherId`) and rethrow as `new Error(...)` with a server-side English-only message — NOT a `DomainError`, because there is no client surface or i18n key for an invariant break that must never happen (it is not a user-facing denial; inventing a key would violate REQ-002's zero-keys ruling).
3. WHEN the transaction rolls back (any denial, any failure — including the 23505 duplicate map at `:251-259`) THEN the teacher's `average_rating` SHALL be unchanged — the aggregation MUST NOT run in a `finally`, a post-commit hook, an event, or a separate transaction.
4. WHEN the submission is denied THEN the flow SHALL write nothing anywhere — the extension adds zero new denials; every existing gate, oracle, and code path is byte-identical (the rating flows' typed errors are pinned by DEV2-016's suites, which stay green unmodified).
5. WHEN the service file is edited THEN its header doc-comment's cross-surface purity paragraph (`:35-37`, "writes to the `evaluations` table ONLY") SHALL be updated to name the second, same-transaction write target — the teacher row's cached average — while keeping the remaining purity claims true (still zero notification, audit, wallet, ledger, or session-row writes, and still no imports from those surfaces; the only newly imported surface is `TeacherRepository` from the already-imported `@/backend/db/repo` barrel, `student-evaluation.service.ts:47`).

### 2.6 Rounding & Scale Discipline

#### REQ-007 — Conversion Contract (0–100 → 0–5, exact 2-decimal string)

**User Story:** As the platform, I want one canonical conversion so every stored average is byte-predictable from the rating rows.

**Acceptance Criteria:**
1. WHEN converting THEN the executor SHALL use the canonical contract: `average_rating = AVG(score) / 20`, rounded to exactly 2 decimal places (`docs/teachers/student-evaluation-submission.md:67` names `ROUND(AVG(score) / 20, 2)`).
2. WHERE the rounding happens SHALL be the service layer, on the SQL-returned mean — the repo returns the unrounded 0–100 average as a JS number (the float8 cast, REQ-005.1), the service divides by `SCORE_POINTS_PER_STAR` (`student-evaluation.service.ts:74`, value `20`) and formats with `.toFixed(2)`.
   - Rationale: one rounding site — the service seam that already owns `SCORE_POINTS_PER_STAR`; the repo stays a pure data-access layer. Round-in-SQL (`round(avg(score)::numeric / 20, 2)`) is equally correct but duplicates the 20 constant into SQL — rejected (decision D5 in `plan.md`).
3. WHEN the stored value is later read THEN it SHALL be a `decimal(3,2)` string (Drizzle numeric mode) — existing consumers already parse it: `parseAverageRating` (`teacher-directory.mappers.ts:36-45`) or surface it verbatim (`admin-user.pothos.ts:176`). No consumer changes.
4. WHEN a teacher has live ratings whose mean lands on repeating decimals (e.g. scores 60+70 ⇒ mean 65 ⇒ 3.25) THEN `.toFixed(2)` half-up rounding SHALL apply consistently: `((65) / 20).toFixed(2)` = `"3.25"`; a mean of 3.245 on the 0–5 scale formats as `"3.25"` or `"3.24"` per IEEE-754 float representation — the contract pins the JAVASCRIPT side only (the source of truth is `Number.prototype.toFixed` semantics); tests SHALL assert exact strings for the tested samples, not float tolerance ranges.
5. WHEN scores are at the boundaries THEN the converted average SHALL stay inside [0.00, 5.00]: all-100 ⇒ `"5.00"`, all-20 ⇒ `"1.00"` — the DB CHECK (`teacher.ts:37`) is the final clamp and SHALL NOT be catch-translated anywhere (REQ-003.4).

### 2.7 Existing-Surface Integrity

#### REQ-008 — Read Surfaces Reflect the Maintained Value Without Edits

**User Story:** As an admin, I want every existing rating read to be consistent with the rating rows, so I never see two different truths.

**Acceptance Criteria:**
1. WHEN the aggregation ships THEN the admin teacher directory (`TeacherRepository.listDirectory` selecting `teacher.averageRating` at `teacher.repository.ts:305`, mapped by `teacher-directory.mappers.ts:61`) SHALL display the maintained value with ZERO code change; the executor SHALL NOT touch the directory query, its mapper, its service (`backend/services/admin/`), its documents, or its UI.
2. WHEN the aggregation ships THEN the admin user-detail teacher snapshot (`admin-user.repository.ts:300` `teacherAverageRating: teacher.averageRating`, exposed `admin-user.pothos.ts:176`) and the platform-analytics aggregates (`platform-analytics.repository.ts:366-403`) SHALL remain untouched — analytics reads `AVG(score)` live from the evaluations table and is NOT switched to the cached column (they measure different things: the analytics 0–100 average covers ALL live evaluations including applicant rows on that table; `teacher.average_rating` covers only student ratings on the 0–5 scale — conflating them would corrupt both).
3. WHEN a GraphQL surface is inspected THEN this ticket SHALL add NO new mutation, query, object, input, or enum to the schema: the write rides the EXISTING `submitTeacherEvaluation` mutation (`backend/graphql/mutation/classes/student-evaluation.mutation.ts:54`); `bun run generate:gqlSchema` output SHALL be byte-identical (no SDL pins change; no codegen commit needed — verify and record in the outcome).
4. WHEN the returned `EvaluationReturnType` is inspected THEN it SHALL remain unchanged — the mutation's response is the rating row; the updated average is NOT added to it (the average is observable through admin reads; widening the return shape would churn DEV2-016's SDL pins for no consumer).

### 2.8 Security, Authorization & Tenancy

#### REQ-009 — BOLA / BOPLA / BFLA / Injection / Disclosure (extension inherits; nothing new exposed)

**User Story:** As the platform, the aggregation must widen zero attack surfaces — it is an internal write behind an existing student-gated mutation.

**Acceptance Criteria:**
1. **BOLA/IDOR:** the aggregated teacher id SHALL be `probe.teacherId` — the session row's server-read value, already the subject of the rating insert (`student-evaluation.service.ts:167`); no client-supplied id reaches the aggregate or the UPDATE (the mutation takes only `sessionId` + `{ rating }` — verified input shape, `student-evaluation.mutation.ts:54`).
2. **BOPLA:** `updateAverageRating` receives a server-computed decimal string; the repo payload is member-by-member (`{ averageRating, updatedAt }`) — no client input is spread anywhere on the path, and no client-controlled byte can reach the teacher row.
3. **BFLA:** zero new operations ship; the role gate (`$all { authenticated: true, role: [UserRole.Student] }` — `student-evaluation.mutation.ts:66-71`) is unchanged. A student can only move THEIR OWN teacher's average through sessions they actually dual-confirmed — the participant oracle (`:131-142`) remains the gate.
4. **Injection:** the aggregate's only input is the teacher id (a DB-sourced integer bound as a Drizzle parameter); the UPDATE's values are the integer id and the server-formatted decimal string — zero string-search surface, zero LIKE, zero interpolation.
5. **Disclosure:** the average is not returned by the mutation (REQ-008.4); no new read surface ships; a student learns nothing about other students' ratings (the aggregate is one number over the family, never enumerated rows — and it is written to a column the student cannot read through any student-scoped surface today; the teacher-facing surfaces are other tickets' scope per `docs/teachers/student-evaluation-submission.md:74`).
6. A negative security sweep SHALL re-run DEV2-016's existing matrix (foreign student → `SESSION_NOT_FOUND`; teacher/parent/admin token → `FORBIDDEN`; anonymous → `UNAUTHORIZED`) and stay green unmodified — proving the extension added no auth-bypass leg. The service tests additionally assert write-purity: rating submission still emits zero `notifications` and zero `audit_logs` rows (the teacher row is not an audited entity for the census — the admin-mutation audit census applies to admin-gated mutations only, `backend/graphql/AGENTS.md:89-91`).

### 2.9 Atomicity, Concurrency & Data Integrity

#### REQ-010 — Concurrency: Recompute-from-Source, Not Increment

**User Story:** As the platform, concurrent ratings and aborted submissions must never leave the cached average diverged from the rating rows.

**Acceptance Criteria:**
1. WHEN the flow recomputes THEN the average SHALL always be a full `AVG` over the live family (recompute-from-source), never an incremental `(old × (n-1) + new) / n` update — a lost-update race between two concurrent submissions would corrupt an incremental average, while a recomputed one is by construction consistent with the rows its own transaction sees.
2. WHEN two students rate the same teacher concurrently (two sessions, one teacher) THEN both transactions SHALL insert their rows and recompute; under PostgreSQL READ COMMITTED each recompute sees a snapshot that may or may not include the other transaction's committed row — every committed value is therefore an average over some valid subset of the live family (never double-counted, never fabricated, always CHECK-safe), and a subset average persists only until the NEXT submission recomputes from the then-committed family (recompute-from-source is the self-healing property, D1). The journey's concurrency leg (REQ-J3) asserts what is practically reachable: sequentially committed submissions converge exactly (mean over the full family at each step), while the chaotic same-teacher race is probed only for bounds and CHECK safety.
3. WHEN a submission rolls back THEN the teacher row SHALL be untouched (same-tx discipline, REQ-006.3) — asserted by snapshotting the teacher row before a denied submission and byte-comparing after (service-test tier).
4. WHEN a duplicate submission loses the 23505 race THEN the loser's transaction SHALL leave the teacher's average unchanged — the duplicate-map catch (`:251-259`) rethrows after rollback; no aggregation residue exists (asserted in the journey's existing duplicate steps, extended with a teacher-row snapshot).
5. No module-level mutable state, no caches, no SELECT-then-UPDATE-without-guard, no advisory locks, no `SELECT FOR UPDATE` on the teacher row SHALL be introduced: the teacher-row UPDATE is guarded by row identity only, and serialization is unnecessary because the value is a pure function of the rating family (a stale recompute under contention is corrected by the next write — see `plan.md` §4.3 for the full assessment).

### 2.10 Test Coverage

#### REQ-011 — Three-Layer Test Matrix (repo, service, journey)

**User Story:** As the team, each layer of the feature is proven where it lives, against real rows.

**Acceptance Criteria:**
1. **Repo tests** (`backend/db/test/repo/teachers/evaluation.repository.test.ts` EXTEND + `backend/db/test/repo/teachers/teacher.repository.test.ts` EXTEND): the REQ-005.4 matrix via `runInRollback` + `tx` on live `kottaby_test` PostgreSQL; fixtures via `createTestUser`/`createTestStudent`/`createTestTeacherRow`/`createTestEvaluation` (`entity-setup.ts:72,102,524,412`); no seed rows; `expectRepoError`/`constraintNameOf` for the CHECK-violation leg — never `expect().rejects` inside rollback.
2. **Service tests** (`backend/services/teachers/student-evaluation.service.test.ts` EXTEND): single rating ⇒ stored average = the rating's stars (e.g. 4★ ⇒ `4.00`); multiple pre-seeded live ratings ⇒ exact recomputed mean; applicant-evaluation rows present for the same evaluated teacher ⇒ NOT folded in; soft-deleted rating rows ⇒ excluded; rollback-purity (denied submission leaves the teacher row byte-identical); duplicate-submission leaves the average unchanged; the returned `EvaluationReturnType` shape unchanged; write-purity oracles (zero notifications, zero audit rows) stay green.
3. **Journey test** (`test/workflows/teachers/student-teacher-rating.journey.test.ts` EXTEND — same file, same fixture cast, new steps): REQ-J1..J3 below. Real services + real DB, committed fixtures, tracked cleanup, NO `runInRollback` (`test/workflows/AGENTS.md:8-11`); run via `bun run test/scripts/run-test.ts test/workflows/teachers/student-teacher-rating.journey.test.ts`.
4. All suites run through the wrapped runner (`bun run test/scripts/run-test.ts <path>`) — never raw `bun test` (root AGENTS).
5. WHEN tests are added THEN existing DEV2-016 assertions SHALL NOT be deleted or weakened — the extension is additive steps/arms only (the file's existing steps 1-10 remain byte-equivalent in behavior).

### 2.11 Documentation & Knowledge Gates

#### REQ-012 — Knowledge Propagation

**User Story:** As the next consumer (the future teacher-search/ranking ticket), I inherit a canonical doc describing the maintained average rather than re-deriving it.

**Acceptance Criteria:**
1. WHEN implementation completes THEN `docs/teachers/teacher-average-rating.md` SHALL be created: the aggregation trigger (inside the submission tx), the formula + row-selection contract, the honest-null ruling vs the ticket's literal "default 0", the concurrency model (recompute-from-source), the ranking forward contract (ledger D2), and "what NOT to do" (no incremental updates, no separate tx, no SQL-side rounding with a duplicated constant, no touching analytics' live AVG).
2. WHEN the doc exists THEN `docs/teachers/student-evaluation-submission.md` §3's forward-contract block (`:65-74`) SHALL gain a shipped-status pointer to the new doc (link only; the DEV2-016 contract text stays — it is history, not a stale claim).
3. No AGENTS.md or `.agents/instructions/` file SHALL be modified (hand-curated rule — spec skill "Rule Files Content Policy").

### 2.12 Cross-Actor Workflow Scenarios (Journeys)

Extends the existing `test/workflows/teachers/student-teacher-rating.journey.test.ts` (same cast, same registry) — maps onto the new steps REQ-J1..J3.

**Actor Table:**

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student (session's student) | `student` | submit a rating; move the teacher's cached average as a side effect | read the teacher's average (no student surface exists); rate twice |
| Teacher (rated subject) | `teacher` | observe the effect passively (be rated) | trigger or suppress the recalculation; see it on their own dashboard (no teacher surface yet) |
| Other student | `student` | rate their own sessions with the same teacher | move the average through a session they never participated in (oracle-denied) |
| Admin | `admin` | observe the maintained value via `adminTeachers` directory / user detail | mutate `average_rating` (no admin write surface — the ONLY writer is the submission flow) |
| Platform analytics reader | internal | read `AVG(score)` live from evaluations (unchanged) | read the cached column as if it were the same metric (different scale + different family) |

**Journey steps (additive):**
1. *(existing steps 1-3 unchanged)* cast commits; student books + teacher completes + student confirms; student submits a 4★ rating → `evaluations` row with `score = 80`.
2. student's submission → teacher row's `average_rating` = `"4.00"` (one live rating of 80 ⇒ 80/20).
3. a second session with the same teacher, dual-confirmed, rated 2★ (`score = 40`) → `average_rating` = `"3.00"` ((80+40)/2/20) — recomputed, not incremented.
4. admin-directory projection check: `TeacherRepository.listDirectory` (raw repo read, journey-side) returns the teacher with `averageRating = "3.00"`.
5. denied legs (existing steps 4-8) → teacher row snapshot byte-identical after each denial.
6. teardown: all tracked rows hard-deleted (registry already tracks `evaluations`; the teacher row's average is reset by the fixture teardown — no cleanup change needed).

**Cross-Actor EARS Criteria:**

- **REQ-J1:** WHEN the session's student submits a rating on a dual-confirmed session THEN the system SHALL, in the SAME committed transaction, store the rating row AND recompute the rated teacher's `average_rating` from ALL live student-rating rows for that teacher (`evaluated_id` = the teacher, `session_id` not null, soft-deleted excluded), converted to the 0–5 scale as a 2-decimal string — so the admin directory (a different actor's surface) observes the new value with no further action.
- **REQ-J2:** WHEN a second live rating for the same teacher is later submitted THEN the system SHALL recompute the average over the full family (never an incremental merge), and WHEN the denied duplicate (sequential or concurrent) is rejected THEN the teacher's `average_rating` SHALL remain byte-identical to its pre-attempt value.
- **REQ-J3:** WHEN the same teacher accumulates a mix of live student ratings, soft-deleted student ratings, and applicant-evaluation rows (`session_id NULL`) THEN the stored average SHALL reflect ONLY the live student-rating family — and WHEN concurrent submissions hit the same teacher THEN every committed value SHALL stay within the `teacher_average_rating_check` bounds as an average over a valid subset of the family (exact-mean convergence is asserted for sequential submissions; a concurrent subset average is CHECK-safe and heals at the next submission).

---

## 3. Non-Functional Requirements

1. **Performance:** the aggregation adds ONE single-row SELECT (indexed `evaluations_evaluated_id_idx` over a per-teacher family that is naturally small) + ONE single-row UPDATE to the existing submission transaction — the whole mutation remains O(1) round-trips per leg. No read path pays anything (the cached column is already selected everywhere it renders).
2. **Reliability:** same-tx atomicity — either the rating AND the moved average commit together, or neither does. The value is a pure function of the live rating family (recompute-from-source), so recovery from any interrupted state is implicit: the next submission self-heals.
3. **Security:** REQ-009 — zero new surfaces; the write is server-derived end-to-end behind DEV2-016's existing gates.
4. **Localization:** zero new keys (REQ-002) — parity tests untouched.
5. **Compatibility:** zero schema change, zero SDL change, zero frontend change; every existing suite stays green; `decimal(3,2)` string round-trips preserved.

## 4. Constraints & Assumptions

- **Constraints:** `evaluations.score` is 0–100 (`evaluations.ts:56`) and whole-star ratings land in {20, 40, 60, 80, 100} — the `/20` conversion is therefore exact for every producible row (DEV2-016's guarantee, `docs/teachers/student-evaluation-submission.md:71`). `teacher.average_rating` is nullable `decimal(3,2)` CHECK 0–5 (`teacher.ts:27,37`). No soft-delete mutation surface for ratings exists yet (exclusion happens at the moderation flow's future seam — ledger D3). No `bun run db push` runs in this ticket.
- **Assumptions:** DEV2-016's suites remain green (the extension must not regress them); the admin directory renders `null` as "—" (`adminTeachersDirectory.helpers.ts:78-80`), so the honest-null ruling needs no UI companion; `test/workflows` journey harness tracks `evaluations` already (`journey-fixture-registry.ts:81,102`) — no registry extension is needed.
- **Dependencies:** DEV2-016 shipped (rating write path + canonical forward contract, `docs/teachers/student-evaluation-submission.md:65-68`). All blockers clear.

## 5. Success Criteria (Definition of Done)

- [ ] All REQ-001..REQ-012 + REQ-J1..J3 satisfied; every AC demonstrably tested.
- [ ] `submitTeacherEvaluation` writes rating + teacher average atomically; rollback purity proven by snapshot tests.
- [ ] Repo, service, and journey suites green via the wrapped runner; DEV2-016's existing assertions unweakened.
- [ ] Zero schema change verified (no `db push`, no migration dir added); SDL byte-identical (verified + recorded).
- [ ] Zero new tsgo/biome/lint/duplicates errors vs the REQ-001 baseline; `bun quality-gate` green.
- [ ] `deferred-items.md` current (D1–D4 recorded); canonical doc `docs/teachers/teacher-average-rating.md` published (REQ-012).

## 6. Glossary

| Term | Definition |
|---|---|
| Rating row | An `evaluations` row with `session_id` set and `score = rating × 20` (student→teacher flow) |
| Applicant evaluation | An `evaluations` row with `session_id = NULL` (sheikh→candidate flow) — excluded from the aggregation |
| Live family | The rating rows for one `evaluated_id`: non-soft-deleted, `session_id` non-null, `score` non-null |
| Cached average | `teacher.average_rating` — `decimal(3,2)` recomputed on every submission, never incremented |
| Recompute-from-source | Full `AVG` over the live family per submission, as opposed to incremental merge |
| Honest null | `NULL` = "no live ratings", preserved; never a fabricated `0` (rendered "—" by existing UI) |
| Oracle collapse | Unknown id ≡ foreign id: identical `SESSION_NOT_FOUND` (DEV2-016 contract, unchanged here) |

## 7. Invariant & Decision Traceability

| Ref | Text (source) | Binding requirement |
|---|---|---|
| INV-E4 | Teacher evaluations (submitted by students) update `teacher.average_rating` (0–5 scale) (`docs/specs/state-machine-invariants.md:317`) | The whole feature — REQ-006, REQ-007 |
| FR-8.2 | Teacher ratings directly influence search ranking and visibility (`docs/specs/functional-requirements.md:238-240`) | REQ-006 writes the ranking input; ranking consumer is ledger D2 (no student-facing search surface exists yet — verified §1.4 #16) |
| INV-E1 | `evaluations.score` 0–100 check (`docs/specs/state-machine-invariants.md:314`, schema `evaluations.ts:56`) | REQ-007.5 boundary conversion |
| INV-E2 | Soft-delete only (`is_deleted`/`deleted_at`) (`:315`) | REQ-005.1 aggregate excludes soft-deleted rows |
| DEV2-016 forward contract | `ROUND(AVG(score) / 20, 2)` over non-soft-deleted rows, `evaluated_id` = teacher, `session_id IS NOT NULL` (`docs/teachers/student-evaluation-submission.md:65-68`) | REQ-005.1, REQ-007.1 — implemented verbatim |
| Session lifecycle rule | Ratings consume the lifecycle read-only; no lifecycle writes (`docs/sessions/session-lifecycle.md:176`) | REQ-006.5 — purity paragraph keeps "no session-row writes" |
| Honest-null precedent | Empty family ⇒ `null` average, never a fabricated zero (`platform-analytics.repository.ts:39-41`; em-dash rendering `adminTeachersDirectory.helpers.ts:78-80`) | REQ-006.2.iv, ruling vs the ticket's literal "default 0" (ledger D1) |

## 8. Requirements Review Checklist

- [x] All user stories have role + benefit; EARS format throughout (WHEN/IF/THEN/SHALL).
- [x] Positive + negative criteria per area (denial purity REQ-006.4, CHECK-violation REQ-005.4, concurrency REQ-010).
- [x] Cross-actor journeys captured with actor table, ordered steps, observer-perspective criteria (§2.12 — student acts, admin observes).
- [x] No implementation leakage beyond contract level (signatures + paths are design anchors).
- [x] UX/navigation defined — explicit no-new-route/no-UI ruling (REQ-008, `plan.md` §5).
- [x] Every REQ maps to ≥1 task in `tasks.md`; REQ-J1..J3 map to the journey task.
- [x] Conflicts resolved: ticket's literal "average_rating = 0 (default)" vs existing honest-null surfaces ⇒ NULL ruling recorded + deferred (ledger D1); "influences search ranking" with no search surface ⇒ forward contract + ledger D2; ticket's "stored in teacher.average_rating (0-5 scale, check constraint)" verified as already-satisfied schema (REQ-003 — zero schema change, the story point is the aggregation, not DDL).
