# Requirements & Specification: Student Evaluation Submission (Teacher Rating)

> **Target ticket:** `Student Evaluation Submission (Teacher Rating)` — DEV2-016 (`docs/planning/TICKETS.md:2073-2105`; Owner: Dev 2 · Milestone 3 · 3 SP)
> **Plan directory:** `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/`
> **Outcome directory:** `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/outcome/`
> **Blocking dependencies:** DEV3-012 Dual-Confirmation Completion Handshake — **shipped** (`ai/finished_plans/milestone_2_matching_notifications_escrow/dual-confirmation-completion-handshake/`; canonical contract in `docs/sessions/session-lifecycle.md`)
> **Decision Refs:** C.3 (`evaluated_id`/`evaluator_id` disambiguation), FR-8.2 (teacher evaluations), INV-E1..E6 (evaluation lifecycle)
> **Version:** 1.0 · **Date:** 2026-09-11

---

## 1. Introduction

After a session completes and **both** the teacher and the student confirm completion (the DEV3-012 dual-confirmation handshake), the student may rate the teacher. The rating is persisted as a row in the existing `evaluations` table (`evaluated_id` = the teacher's `users.id`, `evaluator_id` = the student's `users.id`, `session_id` = the session, `score` on the 0–100 scale). This ticket ships the submission write-path end-to-end (schema guard → repository → service → GraphQL → student UI), plus the read a student needs to know they already rated.

### 1.1 Feature Summary

A student who dual-confirmed a completed session can submit exactly one whole-star rating (1–5, stored as `score = rating × 20` per INV-E1's 0–100 scale) for that session's teacher; duplicates and premature submissions are rejected with typed, localized domain errors.

### 1.2 Business Value

- FR-8.2: teacher evaluations submitted at session end feed teacher ranking/visibility.
- INV-E4 forward contract: every stored rating is input to `teacher.average_rating` aggregation in **DEV2-017** (out of scope here — see `deferred-items.md`).
- Trust & safety: students gain a voice; teachers get measurable quality feedback behind a completion gate that prevents drive-by ratings.

### 1.3 Scope

**In scope:**
- One-time-per-session student→teacher rating submission (write path) with dual-confirmation eligibility gate.
- Student's own submitted-ratings read (`myTeacherEvaluations`) powering "already rated" UI state.
- Student sessions list UX: "Rate Teacher" action + rating dialog on dual-confirmed rows.
- Write-once arbitration via a new `UNIQUE(session_id, evaluator_id)` schema index.
- Tests: repo, service, journey (`test/workflows/`), GraphQL wire, component.

**Explicitly out of scope (registered in `deferred-items.md`):**
- DEV2-017 `teacher.average_rating` aggregation & search-ranking consumption (forward contract documented).
- Rating edits / re-rating / deletion (INV-E2 soft-delete columns exist; no mutation surface in this ticket).
- Free-text `notes` on student ratings (column exists; input not offered).
- Notification to the teacher on new rating (`NotificationType.EvaluationResult` reserved for future use).
- Parent-portal visibility of ratings (DEV1-016/DEV1-017 deliver that surface).
- Admin CRUD over evaluations (DEV3-016 family).

---

### 1.4 Existing Codebase State (verified inventory — every row grep/view confirmed)

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | `evaluations` Drizzle table with `evaluated_id`/`evaluator_id`/`session_id`/`score`/`notes`/soft-delete | **EXISTS** (C.3 shape) | `backend/db/schema/teachers/evaluations.ts:21-48` |
| 2 | `score` 0–100 DB CHECK (`evaluations_score_check`) | **EXISTS** (INV-E1 enforced in DB) | `backend/db/schema/teachers/evaluations.ts:43` |
| 3 | `UNIQUE(session_id, evaluator_id)` write-once arbiter | **ABSENT — CREATE** | evaluations.ts:44-46 has plain indexes only |
| 4 | Table header doc-comment (describes sheikh→candidate-only use) | **EXISTS — UPDATE** (student-rating role must be documented) | `backend/db/schema/teachers/evaluations.ts:6-20` |
| 5 | Canonical evaluation types (`EvaluationSelectType`) | **EXISTS — EXTEND** (add Insert/Return/SubmitInput) | `backend/types/teachers/evaluation.types.ts:1-3` |
| 6 | Evaluation repository | **ABSENT — CREATE** | `backend/db/repo/teachers/` holds only `applicant.repository.ts`, `teacher.repository.ts` |
| 7 | Session eligibility inputs: `status`, `studentId`, `teacherId`, `confirmedByStudentAt`, `confirmedByTeacherAt` on `session` | **EXISTS** | `backend/db/schema/classes/session.ts:54-69`; `SessionStatus.Completed` at `backend/enum/scheduling/session-status.enum.ts:7-13` |
| 8 | Transition probe (`findTransitionProbe`) | **EXISTS — REFERENCE ONLY** (lacks `confirmedBy*` columns; new probe type added instead) | `backend/db/repo/classes/session.repository.ts:346`, type at `backend/types/classes/session.types.ts:72-75` |
| 9 | `assertPositiveSafeSessionId` pre-DB ID guard | **EXISTS — REUSE** | `backend/services/classes/session-lifecycle.guards.ts:123` |
| 10 | DEV2-016 consumption rule ("read-only; no lifecycle write surfaces") | **EXISTS — BINDING** | `docs/sessions/session-lifecycle.md:163` |
| 11 | Evaluation service / GraphQL object / mutation / query | **ABSENT — CREATE** | zero matches for `submitEvaluation`/`myEvaluations`/`Evaluation` pothos refs |
| 12 | Student sessions list surface + row-action seam | **EXISTS — EXTEND** (add Rate descriptor + dialog) | `frontend/views/student/sessions/useStudentSessionConfirm.ts:152-175` |
| 13 | `sessions` + `errors` locale namespaces | **EXIST — EXTEND** (new keys; no new namespace) | `shared/locale/namespaces/{sessions,errors}/` |
| 14 | Existing key `errors.sessionRatingRange` ("between 0 and 5") | **EXISTS — DO NOT REUSE** (belongs to teacher→student report rating; see REQ-007) | `shared/locale/en/errors/index.ts:97` |
| 15 | Workflow journey harness (`test/workflows/`, fixture registry, actor factories) | **EXISTS — EXTEND** | `test/workflows/AGENTS.md`, `test/workflows/helpers/` |
| 16 | `createTestEvaluation` fixture helper | **EXISTS — REUSE** | `backend/db/test/entity-setup.ts:412-418` |
| 17 | SDL static-assertion pins | **EXIST — EXTEND** (new type + 2 root fields) | `backend/graphql/test/sdl-static-assertions.test.ts` |
| 18 | `teacher.average_rating` column (decimal(3,2), CHECK 0–5, nullable) | **EXISTS — NOT TOUCHED** (DEV2-017 owns the write) | `backend/db/schema/teachers/teacher.ts:27,37` |

---

## 2. Requirements

### 2.1 Baseline & Foundational Preparation (MANDATORY)

#### REQ-001 — Pre-Implementation Baseline & Execution Protocol

**User Story:** As the implementing agent, I want a recorded quality baseline and a durable outcome/ledger protocol, so that new issues are distinguishable from pre-existing ones and knowledge is never re-derived.

**Acceptance Criteria:**
1. WHEN implementation begins THEN the executor SHALL record baseline counts (`bun tsgo` error count, `bun run biome:check` summary, `bun run scripts/lint-service.ts --json --id baseline` exit code) in `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/outcome/phase0-baseline-outcome.md` **(baseline at plan-generation time, 2026-09-11: tsgo = 0 errors; biome = clean; lint = exit 0 — re-verify at execution start)**.
2. WHEN implementation begins THEN the executor SHALL maintain the deferred-items ledger at `ai/plans/milestone_3_parent_portal_admin_governance/student-evaluation-submission-teacher-rating/deferred-items.md`.
3. WHEN starting ANY task THEN the executor SHALL read ALL existing outcome files in the plan's `outcome/` directory.
4. WHEN completing a task THEN the executor SHALL write `outcome/<task-id>-outcome.md` with research, implementation details, and carry-over points.
5. WHEN completing a subtask THEN the executor SHALL flip its checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the executor SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) on that file before proceeding.
7. WHEN marking any subtask complete THEN the executor SHALL complete the semantic-review checklist (race conditions, env-config, dead code, cross-layer imports, value-imported enums, zero plan-artifact references like `REQ-x`/`Task N` in code comments).
### 2.2 Localization & Enum Compliance

#### REQ-002 — Compile-Time i18n & Enum Value Imports

**User Story:** As a maintainer, I want every user-facing string and every enum to come from the single source of truth, so that nothing drifts between locales or layers.

**Acceptance Criteria:**
1. WHEN a client component renders user-facing text THEN it SHALL call `useAppTranslation(<NamespaceHandle>)` with the handle object (e.g. `Sessions`) imported from `@/shared/locale`, and access labels via property access — never a string-literal namespace, never a `Translation` enum member, never a function call `t('key')`. (Verified signature: `shared/locale/client/use-app-translation.ts:8-10`.)
2. WHEN a server component or service needs translations THEN it SHALL call `getTranslations(locale)` / `getServerTranslations(locale)` with **one argument** (verified: `shared/locale/server.ts:15`, `shared/locale/server-graphql.ts:3`).
3. WHEN a GraphQL resolver/service needs error copy THEN it SHALL use `await ctx.t("errorsTranslations")` (the argument is a key of `Translations` and the result is a Promise — verified: `backend/graphql/gqlContextFactory.ts:46`) or accept `locale` and read `getServerTranslations(locale).errorsTranslations`.
4. WHEN an enum (e.g. `SessionStatus`, `UserRole`) is used in a runtime expression THEN it SHALL be imported as a value import, and only enum members (never string literals) are compared.
5. WHEN new label keys are added THEN both `en` and `ar` leaves SHALL be filled and the namespace parity tests SHALL pass unmodified.
6. FORBIDDEN: `next-intl` imports, `getBackendTranslations`, `shared/messages/` references, hardcoded user-facing strings.

### 2.3 Data Model & Schema

#### REQ-003 — Write-Once Arbiter on `evaluations` + Table Documentation

**User Story:** As the platform, I must guarantee at most one rating per (session, evaluator) even under concurrent double submits, and the table's documentation must reflect its second consumer.

**Acceptance Criteria:**
1. WHEN the schema task runs THEN `backend/db/schema/teachers/evaluations.ts` SHALL gain `unique("evaluations_session_evaluator_unique").on(t.sessionId, t.evaluatorId)` in the table constraint block (:42-47, appended after the three indexes).
2. WHEN the constraint is added THEN it SHALL be applied via `bun run db push` (schema change — NOT `db migrate`, which is reserved for custom SQL); the executor SHALL confirm the generated DDL creates the unique index (PG treats NULL `session_id` rows as distinct, so applicant evaluations without sessions are unaffected).
3. WHEN a concurrent double-submit races THEN exactly one insert SHALL commit; the loser SHALL surface as PG 23505 (no pre-check SELECT — repo/services AGENTS rule).
4. WHEN the schema file is updated THEN its header doc-comment (:6-20) SHALL be amended to document BOTH consumers: (a) certified-sheikh evaluation of a teacher applicant, (b) student→teacher rating after completed sessions (score = rating × 20).
5. IF the push shows data-loss warnings THEN the executor SHALL stop and record the interactive plan in `outcome/` before proceeding (no existing rows write this table today — verified: zero non-test writers).
#### REQ-004 — Canonical Types (`backend/types/`)

**User Story:** As a developer, I want evaluation and session-probe types defined once in `backend/types/`, so every layer compiles against the same shapes.

**Acceptance Criteria:**
1. WHEN types are added THEN `backend/types/teachers/evaluation.types.ts` SHALL be extended (existing `EvaluationSelectType` at :3 is preserved verbatim) with:
   - `EvaluationInsertType = typeof evaluations.$inferInsert` (consumed as the insert payload type by the repository — REQ-005, this prevents a dead export)
   - `EvaluationReturnType = Omit<EvaluationSelectType, "isDeleted" | "deletedAt" | "notes" | "updatedAt">` (GraphQL-facing shape; soft-delete internals and the unused-for-now `notes` stay server-internal)
   - `EvaluationSubmitInput = { readonly rating: number }` (star input 1–5; conversion is the service's job, not the client's)
2. WHEN the session probe is needed THEN `backend/types/classes/session.types.ts` SHALL gain `SessionRatingEligibilityProbeType = Pick<SessionSelectType, "id" | "studentId" | "teacherId" | "status" | "confirmedByTeacherAt" | "confirmedByStudentAt">` — the existing `SessionTransitionProbeRowType` (:72-75) is NOT modified (other consumers depend on its exact shape).
3. All `index.ts` barrels touched (`backend/types/teachers/index.ts` re-exports via existing `export *`) SHALL need no new entries — `export *` covers new symbols automatically; the executor SHALL verify the barrel picks them up.
4. No `.types.ts` file SHALL appear outside `backend/types/` (services AGENTS: service-layer types are prohibited).

#### REQ-005 — Repository Layer

**User Story:** As the service layer, I want guarded, typed data-access functions for evaluations and session rating-eligibility, so business logic stays out of SQL.

**Acceptance Criteria:**
1. WHEN the repository is created THEN `backend/db/repo/teachers/evaluation.repository.ts` SHALL export a single `export namespace EvaluationRepository` following the conventions documented at `backend/db/repo/teachers/teacher.repository.ts:17-37`.
2. The namespace SHALL expose exactly:
   - `insertOnce(values: Pick<EvaluationInsertType, "evaluatedId" | "evaluatorId" | "sessionId" | "score">, tx: DBTransaction): Promise<EvaluationSelectType>` — single `INSERT … RETURNING` over exactly those four columns, `tx` REQUIRED. It SHALL NOT catch 23505 (the service maps the constraint to a typed conflict).
   - `listByEvaluator(evaluatorId: number, tx?: DBQueryExecutor): Promise<readonly EvaluationSelectType[]>` — non-locking read scoped to the caller, excluding soft-deleted rows via `or(eq(evaluations.isDeleted, false), isNull(evaluations.isDeleted))` (precedent: `backend/db/repo/admin/platform-analytics.repository.ts:384`), ordered `createdAt DESC, id DESC`. The non-transactional path SHALL use `queryDb` raw SQL per the repo read rule (precedent: `backend/db/repo/classes/report.repository.ts:63-72`).
3. WHEN the probe is needed THEN `SessionRepository` SHALL gain `findRatingEligibilityProbe(sessionId: number, tx: DBTransaction): Promise<SessionRatingEligibilityProbeType | null>` — a plain (non-locking) single-row SELECT of the six probe columns. **No `FOR UPDATE`**: post-dual-confirmation state is monotonic (empty `completed →` transition set at `backend/services/classes/session-lifecycle.enforcement.ts:84`; the 24h sweep only targets rows missing the student stamp), so the read cannot gate a stale write — duplicates are arbitrated by REQ-003's unique index.
4. `backend/db/repo/teachers/index.ts` SHALL gain `export * from "./evaluation.repository";`.
5. Repo unit tests SHALL cover: insert happy path (all four FK columns + converted score persisted), the 23505 surface of the unique index (asserted via `expectRepoError` + `constraintNameOf` — never `expect().rejects`), soft-delete exclusion and null-`sessionId` handling in `listByEvaluator`, ordering stability, and probe projections (six columns exactly).
### 2.4 Core Feature Logic / Service Layer

#### REQ-006 — `StudentEvaluationService` (submission gate chain + own-list read)

**User Story:** As a student, I want to rate my teacher after a completed session, and only then, so the rating is meaningful.

**Acceptance Criteria:**
1. WHEN the service is created THEN `backend/services/teachers/student-evaluation.service.ts` SHALL export `namespace StudentEvaluationService` with exactly two public functions, and `backend/services/teachers/index.ts` SHALL re-export it.
2. Signature (mirrors the session-report idiom `backend/services/classes/session-report.service.ts:357-364`):
   ```ts
   submitTeacherEvaluation(
     studentUserId: number,
     sessionId: number,
     input: EvaluationSubmitInput,
     locale: string,
     outerTx?: DBTransaction,
   ): Promise<EvaluationReturnType>
   ```
3. WHEN called THEN the flow SHALL be, in this exact order:
   1. Pre-DB guards (no DB I/O): `assertPositiveSafeSessionId(sessionId, t)` (reuse `backend/services/classes/session-lifecycle.guards.ts:123`); `input.rating` must be an integer `1..5`, else `ValidationError` with `fields` (REQ-007).
   2. `withTransaction(outerTx, tx => …)` (`backend/lib/db/with-transaction.ts:27-35`).
   3. `SessionRepository.findRatingEligibilityProbe(sessionId, tx)`.
   4. IF probe is `null` OR `probe.studentId !== studentUserId` THEN throw `NotFoundError("SESSION", t.sessionNotFound)` — **oracle collapse**: unknown id, foreign student's session, and non-participant are byte-identical (ruling: `docs/sessions/session-lifecycle.md:131`; precedent: `session-lifecycle.confirmation.ts:135`).
   5. IF `probe.status !== SessionStatus.Completed` OR `probe.confirmedByTeacherAt === null` OR `probe.confirmedByStudentAt === null` THEN throw `ConflictError("EVALUATION_SESSION_NOT_COMPLETED", t.evaluationSessionNotCompleted)` — this is the ticket's "session not completed" rejection; **no HTTP-422 exists on the GraphQL error path** (ruling in REQ-007).
   6. Compute `score = input.rating * 20` (1..5 → 20..100, inside INV-E1's 0–100 CHECK).
   7. `EvaluationRepository.insertOnce({ evaluatedId: probe.teacherId, evaluatorId: studentUserId, sessionId, score }, tx)` — `probe.teacherId` IS the teacher's `users.id` (shared-PK child table; `session.ts:54-56` → `teacher.id` = `users.id`).
   8. On PG 23505 from the insert THEN map to `ConflictError("EVALUATION_ALREADY_SUBMITTED", t.evaluationAlreadySubmitted)` (pattern: `session-report.service.ts:290-300`).
4. Every denial path SHALL log exactly one `logger.logDomainError(message, { code, entity, entityId })` (`@/backend/lib/logger`) then re-throw; success paths log nothing.
5. WHEN `listMyTeacherEvaluations(studentUserId)` is called THEN it SHALL return the caller's own non-deleted evaluation rows mapped to `EvaluationReturnType` (repo `listByEvaluator`), newest first. No pagination in v1 (a student accumulates ≤ a few hundred rows over the product's life; documented decision D12).
6. The service SHALL emit **no notifications** and **no audit rows** (decision D7 — audit census covers admin-gated mutations only).
### 2.5 Validation & Error Contracts

#### REQ-007 — Typed Error Contract (no literal "422")

**User Story:** As any API consumer, I want deterministic `extensions.code` values and localized messages for every rejection, so client error mapping is trivial.

**Acceptance Criteria:**
1. The ticket's Gherkin "rejected with 422" SHALL be delivered as typed GraphQL errors (`HTTP 200 + errors[]`), because the error-handling contract reserves `VALIDATION⇒422` taxonomy for input-shape failures and routes all domain-state rejections through custom codes that never resolve to HTTP statuses (`docs/graphql/error-handling-contract.md:42-56`; `backend/lib/errors/error-code-taxonomy.ts:41-51`).

| Code (`extensions.code`) | Class | Trigger | i18n key (new, `errors` namespace) |
|---|---|---|---|
| `SESSION_NOT_FOUND` | `NotFoundError("SESSION")` | unknown id OR caller is not the session's student (oracle collapse) | reuse existing `sessionNotFound` |
| `EVALUATION_SESSION_NOT_COMPLETED` | `ConflictError` | session not dual-confirmed-completed (missing either stamp or wrong status) | NEW `evaluationSessionNotCompleted` |
| `EVALUATION_ALREADY_SUBMITTED` | `ConflictError` | 23505 on `evaluations_session_evaluator_unique` | NEW `evaluationAlreadySubmitted` |
| `VALIDATION` (+`extensions.fields[]`) | `ValidationError` | `rating` non-integer / out of 1..5; `sessionId` not a safe positive integer | NEW `teacherRatingInvalid` |

2. The three NEW keys SHALL be added to `shared/locale/types/errors/labels.ts`, `shared/locale/en/errors/index.ts`, `shared/locale/ar/errors/index.ts`. The existing `sessionRatingRange` key (`en/errors/index.ts:97`, text "between 0 and 5") belongs to the teacher→student report rating and SHALL NOT be reused or edited.
3. WHEN a denial is thrown THEN the message SHALL come from `ctx.t`/`getServerTranslations` for the request locale; no English string literals in thrown errors.
4. `errors-namespace.parity.test.ts` SHALL pass after the additions without structural edits.

### 2.6 GraphQL Surface

#### REQ-008 — Object Type, Mutation, Query, Registration, SDL Pins

**User Story:** As the frontend, I want a typed submit mutation and a my-ratings query with honest auth scoping.

**Acceptance Criteria:**
1. WHEN the Pothos layer is added THEN `backend/graphql/pothos/teachers/evaluation.pothos.ts` SHALL define (following `backend/graphql/pothos/classes/report.pothos.ts:33-60` conventions):
   - `EvaluationPothosObject = gqlSchemaBuilder.objectRef<EvaluationReturnType>("Evaluation").implement(...)` with fields `id: ID!`, `evaluatedId: Int!`, `evaluatorId: Int!`, `sessionId: Int` (nullable), `score: Int` (nullable), `createdAt: DateTime!` — `id` first (Apollo normalization rule).
   - `SubmitTeacherEvaluationPothosInput = gqlSchemaBuilder.inputType("SubmitTeacherEvaluationInput", …)` with `rating: Int!` (string-named `inputType`, not `inputRef`, per `backend/graphql/AGENTS.md`).
   - Registration is transitive through the mutation/query imports (same convention as `pothos/teachers/applicant.pothos.ts`; the top pothos barrel at `backend/graphql/pothos/index.ts:17-19` deliberately omits teachers).
2. WHEN the mutation is added THEN `backend/graphql/mutation/classes/student-evaluation.mutation.ts` SHALL register `submitTeacherEvaluation(sessionId: ID!, input: SubmitTeacherEvaluationInput!): Evaluation!` with `authScopes: { $all: { authenticated: true, role: [UserRole.Student] } }` (student-role template: `subscription-purchase.mutation.ts:60-65`), in-resolver `if (!ctx.user) throw new UnauthorizedError(...)` narrowing, `requirePositiveIntId(Number(args.sessionId), "sessionId")` coercion, member-by-member input mapping (BOPLA), and a single delegation call to the service; the file SHALL be side-effect-imported in `backend/graphql/mutation/classes/index.ts`.
3. WHEN the query is added THEN `backend/graphql/query/teachers/student-evaluation.query.ts` SHALL register `myTeacherEvaluations: [Evaluation!]!` with the same `$all` student scope, delegating to `StudentEvaluationService.listMyTeacherEvaluations`; side-effect-imported in `backend/graphql/query/teachers/index.ts` (precedent: `applicant.query.ts` registers a student-facing `myApplicantProfile` under the entity's domain dir).
4. WHEN schema changes land THEN the executor SHALL run `bun run generate:gqlSchema && bun codegen` and extend `backend/graphql/test/sdl-static-assertions.test.ts` with pins for the new type + both root fields.
5. The gateway's public-operation allowlist (`backend/lib/gateway/public-operations.ts`) SHALL NOT gain an entry — both operations are authenticated.
### 2.7 Frontend UX

#### REQ-009 — "Rate Teacher" CTA + Rating Dialog on `/student/sessions`

**User Story:** As a student, I want a clear "Rate teacher" action on sessions I've confirmed complete, so I can leave my rating without hunting.

**Acceptance Criteria:**
1. WHEN the documents are added THEN `frontend/graphql/sharedDocuments/teachers/student-evaluation.documents.ts` SHALL export `submitTeacherEvaluationMutationDocument` and `myTeacherEvaluationsQueryDocument` (TypedDocumentNode-named per `frontend/graphql/sharedDocuments/AGENTS.md`, every selection starting with `id`), registered in that sub-directory's `index.ts`.
2. WHEN a session row is dual-confirmed (`status === "completed"` ∧ both confirmation stamps present) AND its id is absent from the student's rated-set THEN the row's action list SHALL include a Rate action rendered by the existing `SessionRowActions` seam (`frontend/views/student/sessions/useStudentSessionConfirm.ts:152-175`; descriptor type `sessionRowAction.ts`).
3. The rated-set SHALL be derived from `myTeacherEvaluationsQueryDocument` data (a `Set<number>` of `sessionId`s) — the sessions list query payload is NOT modified.
4. WHEN the student activates the action THEN `frontend/views/student/sessions/RateTeacherDialog.tsx` SHALL open a dialog (pattern: `CancelSessionConfirmDialog.tsx`) containing an MUI `Rating` control (1–5 whole stars, `sx`-only styling, theme-palette colors only, `StarOutlined`/`StarBorderOutlined` icons, per-star `aria-label`, `prefers-reduced-motion` respected) plus localized title/cancel/submit copy from the `sessions` namespace.
5. WHEN submit succeeds THEN the mutation SHALL write the returned `Evaluation` into the Apollo cache via `update()`/`cache.modify` (no refetch — precedent `useStudentSessionConfirm.ts:109-120`), the dialog SHALL close, and the row SHALL immediately show the rated state (Rate action replaced by a read-only rated chip).
6. WHEN the mutation fails THEN errors SHALL surface through the existing pipeline: `mapGraphQLErrorByCode` (`frontend/providers/apollo/error-link.map.ts`) extended with `EVALUATION_SESSION_NOT_COMPLETED` and `EVALUATION_ALREADY_SUBMITTED` (both → localized notice; ALREADY_SUBMITTED also marks the session rated); `VALIDATION` fields → inline dialog error via `mutationFieldErrors.ts`.
7. New sessions-namespace keys (en+ar): `rateTeacher`, `rateTeacherTooltip`, `rateTeacherDialogTitle`, `rateTeacherDialogSubmit`, `rateTeacherDialogCancel`, `rateTeacherSuccess`, `teacherRatedChip`, `ratingStarAriaLabel` (interpolated `(position: number) => string` per the i18n interpolation rules).

#### REQ-010 — Notification Deep-Link for Rating Entry

**User Story:** As a student who completed a session, tapping its completion notification should land me where the Rate action lives.

1. WHEN the notification deep-link map is extended THEN `frontend/lib/notification-route-resolution.ts:35-37` (`NOTIFICATION_ROUTE_BY_ENTITY_TYPE`) SHALL map `NotificationType.SessionCompletion` to the student sessions route via a NEW single-sourced `STUDENT_SESSIONS_ROUTE` constant (none exists today — precedent `STUDENT_LINK_REQUESTS_ROUTE`), with the nav item updated to the same constant.
2. IF the type is unmapped or the notification is any other kind THEN behavior SHALL remain the existing `/notifications` fallback.
3. This map change SHALL be covered by extending the existing route-resolution tests (unit tier, no server).
### 2.8 Security, Authorization & Tenancy

#### REQ-011 — BOLA / BOPLA / BFLA / Injection / Disclosure

**User Story:** As the platform, only the participating student may rate, and nobody may learn about other people's sessions or ratings through this surface.

**Acceptance Criteria:**
1. **BOLA/IDOR:** `evaluatorId` SHALL always be `ctx.user.id` (server-derived); a client-supplied evaluator id SHALL NOT exist in the input type. The session participation check SHALL use `probe.studentId !== callerUserId`. Cross-student access attempts SHALL be indistinguishable from unknown ids (identical `SESSION_NOT_FOUND`, identical message, identical timing class within the same tx).
2. **BOPLA:** resolver maps `{ rating }` member-by-member; the service derives `score`, `evaluatedId`, `evaluatorId`, `sessionId`; `{ ...input }` spread into any Drizzle call is forbidden.
3. **BFLA:** `authScopes.$all` role gate denies Teacher/Parent/Admin at the builder (`ForbiddenError`, 403 class); anonymous callers get 401. No admin/cron/internal trigger may call this flow without its own scoped surface (none planned).
4. **Injection:** inputs are an ID and a 1..5 integer only — zero string search surface, zero LIKE patterns; no injection vector beyond the pre-DB numeric guards.
5. **Disclosure:** `EvaluationReturnType` omits `isDeleted`/`deletedAt`/`notes`/`updatedAt`; `myTeacherEvaluations` returns only the caller's rows. Rated-state is never exposed to the teacher, parent, or admin by this ticket's surface (their read paths are other tickets' scope).
6. A negative security sweep SHALL assert: teacher-role caller → `FORBIDDEN` mutation error; parent-role caller → `FORBIDDEN`; anonymous → `UNAUTHORIZED`; other student's completed session → `SESSION_NOT_FOUND`.

### 2.9 Atomicity, Concurrency & Data Integrity

#### REQ-012 — Concurrency & Idempotency

**User Story:** As the platform, rapid retries, double-clicks, and two-tab races must never create duplicate ratings or corrupt state.

**Acceptance Criteria:**
1. WHEN two submit requests race for the same (session, student) THEN exactly one `evaluations` row SHALL exist afterward; the loser receives `EVALUATION_ALREADY_SUBMITTED`, and the failing transaction SHALL insert zero rows (verification: `Promise.allSettled` chaos test + journey step REQ-J2).
2. WHEN a client retries after a commit (network retry / page reload resubmit) THEN the second attempt SHALL receive `EVALUATION_ALREADY_SUBMITTED` (write-once; no idempotency header required — the UNIQUE index is the arbiter).
3. WHEN a student rates while the teacher re-completes or disputes the same session THEN the rating row SHALL still be valid: the eligibility probe reads only monotonic post-confirmation columns, and no write targets the session row (read-only consumption per `docs/sessions/session-lifecycle.md:163`).
4. No module-level mutable state, no caches, no `SELECT`-then-`INSERT` check-then-act pattern SHALL be introduced by this flow.
### 2.10 Test Coverage

#### REQ-013 — Four-Layer Test Matrix

**User Story:** As the team, each layer of the feature is proven where it lives.

**Acceptance Criteria:**
1. **Repo tests** (`backend/db/test/repo/teachers/evaluation.repository.test.ts`, new): `runInRollback` + `tx` everywhere; happy path, unique-index 23505 via `expectRepoError`/`constraintNameOf`, soft-delete exclusion, ordering; fixtures via `createTestUser`/`createTestStudent`/`createTestTeacherRow`/`createTestSession`/`createTestEvaluation` (`entity-setup.ts:72,102,301,412,522`). Session-probe additions covered in the existing session repo test file's style.
2. **Service tests** (`backend/services/teachers/student-evaluation.service.test.ts`): every denial (unknown session, foreign student, scheduled/started/cancelled statuses, teacher-stamp-only, student-stamp-impossible-by-construction, both stamps missing, rating 0 / 6 / 2.5 / NaN, duplicate), score conversion mapping (1→20 … 5→100), tx propagation via `outerTx`, denial logging spy. DB cases use `runInRollback`; the committed-fixture block pattern of `recitation.service.test.ts` is the template.
3. **Journey test** (`test/workflows/teachers/student-teacher-rating.journey.test.ts`, NEW directory): real services + real DB, committed fixtures, `createSessionFixtureRegistry()` tracking + `afterAll` cleanup, NO `runInRollback`; run via `bun run test/scripts/run-test.ts test/workflows/teachers/student-teacher-rating.journey.test.ts` — never raw `bun test`. Covers REQ-J1..J4.
4. **GraphQL wire tests** (`backend/graphql/test/student-evaluation.wire.test.ts`): `setupTestServerLifecycle` + `testClient`; anonymous → typed UNAUTHORIZED; teacher/parent role → FORBIDDEN; code pins for all four error codes; SDL assertions extended.
5. Tier goals per subtask pipeline: Tier 1 full branch coverage on new logic; Tier 2 boundary (rating at 1 and 5, empty notes — N/A, unicode dialog copy); Tier 3 chaos (`Promise.allSettled` duplicate storm); Tier 4 security (cross-student/role matrix).

### 2.11 Documentation & Knowledge Gates

#### REQ-014 — Knowledge Propagation

**User Story:** As the next ticket (DEV2-017), I inherit a canonical doc describing the rating write contract rather than re-deriving it.

**Acceptance Criteria:**
1. WHEN implementation completes THEN `docs/teachers/student-evaluation-submission.md` SHALL be created: rating write contract, gate predicate, score conversion (rating ×20) and the DEV2-017 aggregation forward contract (`avg(score)/20` → `teacher.average_rating`, exclude soft-deleted), error-code table, security posture, and "what NOT to do".
2. WHEN the doc exists THEN `docs/sessions/session-lifecycle.md:163`'s DEV2-016 consumer line SHALL gain a pointer to the new canonical doc (shipped link, not behavior change).
3. No AGENTS.md or `.agents/instructions/` file SHALL be modified (hand-curated rule).
4. `backend/db/schema/teachers/evaluations.ts`'s doc-comment SHALL describe both consumers after REQ-003.
### 2.12 Cross-Actor Workflow Scenarios (Journeys)

Maps 1:1 onto `test/workflows/teachers/student-teacher-rating.journey.test.ts`.

**Actor Table:**

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student (session's student) | `student` | rate after dual confirmation; read own ratings | rate twice; rate others' sessions; rate before confirmation |
| Teacher (session's teacher) | `teacher` | be rated (passive); confirm completion (existing flow) | submit ratings; see REQ-009's surface |
| Other student | `student` | rate own sessions | access the first student's session/rating (oracle-denied) |
| Parent / Admin | `parent` / `admin` | nothing on this surface | call mutation or query (FORBIDDEN) |

**Journey steps (primary):**
1. teacher `completeSession` → row `completed`, `confirmed_by_teacher_at` set (existing DEV3-012 flow, reused as setup)
2. student `confirmSessionCompletion` → `confirmed_by_student_at`, `fee_held=false` (existing flow)
3. student → `submitTeacherEvaluation(sessionId, { rating: 4 })` → `evaluations` row: `evaluated_id=teacherUser, evaluator_id=studentUser, session_id, score=80`
4. student → `myTeacherEvaluations` → sees exactly that row

**Cross-Actor EARS Criteria:**

- **REQ-J1:** WHEN the session's student submits a rating on a dual-confirmed completed session THEN the system SHALL create exactly one `evaluations` row with `evaluated_id` = the session teacher's `users.id`, `evaluator_id` = the caller's `users.id`, `session_id` = the session, and `score = rating × 20`.
- **REQ-J2:** WHEN the same student submits again for the same session (incl. concurrent duplicates) THEN the system SHALL reject every submission after the first with `EVALUATION_ALREADY_SUBMITTED` and the table SHALL contain exactly one row.
- **REQ-J3:** WHEN the student submits before dual confirmation (statuses `scheduled`/`started`, or `completed` awaiting the student stamp) THEN the system SHALL reject with `EVALUATION_SESSION_NOT_COMPLETED` and create no row.
- **REQ-J4:** WHEN any non-participant (another student) targets the session, the system SHALL reject with `SESSION_NOT_FOUND` byte-identically to an unknown session id; WHEN a teacher/parent/admin token calls the mutation THEN the system SHALL reject with `FORBIDDEN` before any DB work.

---

## 3. Non-Functional Requirements

1. **Performance:** submission completes in one tx with 1 probe SELECT + 1 INSERT (O(1) statements); `myTeacherEvaluations` is a single indexed read (`evaluations_evaluator_id_idx`, `evaluations.ts:45`), unbounded but self-limiting (per-student volume).
2. **Reliability:** partial failure inside the tx rolls back fully — either the row + its reads are consistent or nothing happened.
3. **Security:** REQ-011 matrix is release-gating; the journeys + wire tests prove it.
4. **Localization:** all new copy ships in `en` + `ar` at once (parity tests gate this).
5. **Compatibility:** additive-only schema change; existing readers (`platform-analytics` aggregate) are unaffected by the new unique index.

## 4. Constraints & Assumptions

- **Constraints:** score scale locked at 0–100 by `evaluations_score_check` (INV-E1); rating input locked to whole 1..5 stars by product decision D5; no `completed_at` column exists — completion is read from `status` + confirmation stamps (`session.ts:66-70`).
- **Assumptions:** DEV3-012 remains green (gate is read-only consumption of its outputs); the student sessions list documents already select `confirmedByTeacherAt`/`confirmedByStudentAt` (`frontend/graphql/sharedDocuments/scheduling/session-reads.documents.ts:57-58`, verified — so the task-4.1 contingency should not fire; re-check after codegen).
- **Dependencies:** unique index requires `bun run db push` (schema change policy); all blockers shipped.

## 5. Success Criteria (Definition of Done)

- [ ] All REQ-001..REQ-014 + REQ-J1..J4 satisfied; every AC demonstrably tested.
- [ ] `submitTeacherEvaluation` + `myTeacherEvaluations` live on the schema with pinned SDL.
- [ ] Journey suite green via the wrapped runner; component + service + repo + wire suites green.
- [ ] Zero new tsgo/biome/lint/duplicates errors vs the REQ-001 baseline; `bun quality-gate` green.
- [ ] Rate CTA visible only in the dual-confirmed-unrated state; rated state sticks across reload (server truth).
- [ ] `deferred-items.md` current; canonical doc published (REQ-014).

## 6. Glossary

| Term | Definition |
|---|---|
| Dual confirmation | Teacher stamp (`confirmed_by_teacher_at`) + student stamp (`confirmed_by_student_at`); only both settle escrow (DEV3-012) |
| Rating | Student's whole-star 1–5 UI input |
| Score | Stored 0–100 value (`rating × 20`), INV-E1 column |
| Oracle collapse | Unknown id ≡ foreign id: identical `SESSION_NOT_FOUND` denial for non-participants |
| Write-once arbiter | `UNIQUE(session_id, evaluator_id)`; 23505 → `EVALUATION_ALREADY_SUBMITTED` |
## 7. Invariant & Decision Traceability

| Ref | Text (source) | Binding requirement |
|---|---|---|
| C.3 | `evaluations.evaluated_id` (evaluated user) + `evaluator_id` (submitter), both FK→users, both indexed (`docs/specs/open-decisions-and-gaps.md:199-203`) | REQ-001.4 inventory, REQ-006 step 3.7 |
| INV-E1 | `evaluations.score` 0–100 check (`docs/specs/state-machine-invariants.md:298`) | REQ-003 (kept), REQ-006 step 3.6 conversion |
| INV-E2 | Soft-delete only (`is_deleted`/`deleted_at`) (…:299) | REQ-005.2 exclusion filter; no delete mutation shipped |
| INV-E3 | Linked to evaluated user + optional `session_id` (…:300) | REQ-006 sets both |
| INV-E4 | Teacher ratings update `teacher.average_rating` 0–5 (…:301) | Forward contract to DEV2-017: `plan.md` §4.5 + `deferred-items.md` |
| INV-E6 | Permanent retention for disputes/re-eval (…:303) | No update/delete paths in this ticket |
| FR-8.2 | Student-end-of-session teacher ratings feed ranking (`docs/specs/functional-requirements.md:238-240`) | Whole feature; ranking consumption is DEV2-017 |

## 8. Requirements Review Checklist

- [x] All user stories have role + benefit; EARS format throughout (WHEN/IF/THEN/SHALL).
- [x] Positive + negative criteria per feature area (REQ-006, REQ-011, REQ-J2..J4).
- [x] Cross-actor journeys captured with actor table, ordered steps, observer-perspective criteria (§2.12).
- [x] No implementation leakage beyond contract level (signatures + paths are design anchors, not behavior).
- [x] UX/navigation defined (no new route — ruling recorded in REQ-009 + `plan.md` §5).
- [x] Every REQ maps to ≥1 task in `tasks.md`; REQ-J1..J4 map to the journey task.
- [x] Conflicts resolved: ticket's literal "422" → typed `ConflictError` codes (REQ-007); `sessionRatingRange` key conflict avoided (REQ-007.2); scale conversion fixed at source (REQ-006).
