# Implementation Tasks: Tajweed Curriculum Lessons CRUD

> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/`
> **Specs of record:** `specs.md` (REQ-001..REQ-081) · **Design:** `plan.md` (D1–D11) — same directory
> **Ticket:** `Tajweed Curriculum Lessons CRUD` (`docs/planning/TICKETS.md:1145-1183`) — Dev 1 · Milestone 2 · 3 SP · Blocked By Subscription Validity Window & Expiry (SHIPPED)
> **Plan kind:** full vertical slice over an EXISTING table — ZERO schema delta (`git diff backend/db/schema/** backend/drizzle/**` stays empty; no `bun run db push` ever runs). New layers: types → i18n → repository → service → GraphQL → documents → admin UI → seeds → reviews → knowledge propagation.

---

## Non-Negotiable Execution Protocol

1. **Pre-Execution Knowledge Read:** before ANY task, read ALL files in `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/outcome/` in lexical order; prior outcomes are binding context.
2. **Per-File Verification Loop:** EVERY created/modified file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before its checkbox flips — the script auto-discovers the applicable AGENTS.md + `.agents/instructions/*.md` files; fix in-file, report cross-file dependencies to the orchestrator (Fix-Or-Report rule).
3. **Test Execution:** ALL tests run via `bun run test/scripts/run-test.ts <test-path>` — NEVER raw `bun test` (and never raw `bun test` on workflow tests).
4. **Semantic Review:** every implementation task carries an `.SR` self-review (atomicity, no dead code, no cross-layer imports, enums as VALUE imports, canonical types only, no `{...input}` spread into Drizzle writes).
5. **Outcome Documentation:** every task writes `outcome/<task-id>-outcome.md` BEFORE the next task begins.
6. **Checkbox Tracking:** `[ ]` → `[x]` only when ALL subtasks of the task are complete.
7. **Ledger Discipline:** deferred/incomplete-looking items are recorded ONLY as ✅ resolved-pointer rows in `deferred-items.md`; the final gate is `grep -cE '^\s*\| D[0-9]+ .*(❌|⚠️)' deferred-items.md` = 0 (ledger table rows only — the legend lines contain the symbols).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Initialize Deferred-Items Ledger

- [x] 0.1 [Record baseline + initialize ledger]
  - Capture to `/tmp/baseline-*.txt`: `bun tsgo 2>&1 | grep "error TS" | wc -l` · `bun biome:check 2>&1 | grep -c "warn"` · `bun run scripts/lint-service.ts --json --id baseline`.
  - Initialize `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/deferred-items.md` from the template, seeded with the plan's D1–D5 resolved-pointer rows (position/reordering surface; progress-consuming surfaces + first journey; audit-completeness catalog wiring; content enrichment; anonymous-browsing ruling).
  - Write `outcome/0-baseline-outcome.md` with the captured numbers.
  - _Requirements: REQ-001_

### 0.2 Dependency & Anchor Verification (anchored, never rebuilt)

- [x] 0.2 [Verify every consumed artifact exists at its cited anchor]
  - Schema (read-only): `backend/db/schema/classes/lessons.ts:17-30`; `backend/db/schema/classes/progress.ts:26`; `backend/db/schema/billing/plans.ts:23-33`; `db/schema.dbml:446-452`; migration `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:174,358,422,430`.
  - Clone lineage: `backend/db/repo/billing/plan.repository.ts` (`isDBTransaction` `:33-42`, `insertPlan :52`, `updatePlanFields :66`, `existsById :115`, `findById :131`); `backend/services/billing/plan-catalog.service.ts:49-56,67-77`; `backend/services/billing/plan-catalog.helpers.ts:94,107,117,281,315`; `backend/services/admin/admin-gate.helpers.ts:114`; `backend/services/admin/audit.service.ts:82`; `backend/enum/audit/audit-action-type.enum.ts:6-14` (confirm the `Delete` member); `backend/lib/errors.ts:37,65-130`; `backend/lib/db/with-transaction.ts:42`.
  - GraphQL: `backend/graphql/mutation/plan-catalog.mutation.ts` (authScopes + narrowing prelude idiom); `backend/graphql/query/plan-catalog.query.ts`; `backend/graphql/pothos/billing/plan.pothos.ts:57-96`; barrels `backend/graphql/{mutation,query,pothos}/classes/index.ts`.
  - Test harness: `backend/db/test/test-utils.ts:34,77,111`; `backend/db/test/entity-setup.ts:72-77,167,178-198` — CONFIRM no `createTestLesson` exists (task 2.1 adds it); `backend/graphql/test/plan-catalog.roles.test.ts:55-74`; `plan-catalog.schema.test.ts:61-69`.
  - Frontend: `app/(dashboard)/admin/plans/page.tsx:23-35` (+ co-located page.test.ts); `frontend/views/admin/plans/**`; `frontend/views/dashboard/nav/navItems.ts:155-183`; `frontend/graphql/sharedDocuments/billing/plan-catalog.documents.ts` + `frontend/graphql/sharedDocuments/index.ts` (CONFIRM no `classes/` subdir exists on disk).
  - Seeds: `backend/db/seeds/AGENTS.md`; `backend/db/seeds/billing/seed-plans.ts:45,50` ("Tajweed & Tilawa" + `SubscriptionCreditLane.Tajweed`); master controller `backend/db/seeds/index.ts`.
  - IF any anchor is missing: record a ❌ ledger row and BLOCK dependent tasks — never inline-patch a foreign layer.
  - _Requirements: REQ-004, REQ-010, REQ-070_

### 0.3 Phase 1.5 Plan-Review Gate (BLOCKING — executed at plan generation)

- [x] 0.3 [@plan-review verdict recorded in `outcome/plan-review-R1.md`]
  - The review ran over the complete trio (`specs.md` + `plan.md` + `tasks.md`); the verdict, findings, and fixes are recorded in `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/outcome/plan-review-R1.md`. Read it before task 1.1; if implementation reveals drift, re-run the review and record R2 before continuing.
  - _Requirements: REQ-001, REQ-002, REQ-003, REQ-004_

---

## Phase 1: Canonical Types & i18n (NO Database Schema Work — Zero-Drift Ticket)

> There are **NO Drizzle schema tasks** anywhere in this plan: `lessons` is consumed read-only and `git diff backend/db/schema/** backend/drizzle/**` MUST remain empty at completion.

### 1.1 Canonical Types — NEW `backend/types/classes/lesson.types.ts`

- [x] 1.1 [Create the lesson type module + barrel registration]
  - CREATE `backend/types/classes/lesson.types.ts` with EXACTLY the exports from `plan.md` §3.3: `LessonSelectType`/`LessonInsertType` (Drizzle `$inferSelect`/`$inferInsert` over `@/backend/db/schema/classes/lessons`), `LessonReturnType` (alias of select — no forbidden fields), `LessonSubmitInput` (`{ readonly planId: number; readonly title: string }`), `LessonUpdateInput` (`Partial<LessonSubmitInput>`). Type-only import of the `lessons` table.
  - UPDATE `backend/types/classes/index.ts` (8 exports today, `:1-8`): add `export * from "./lesson.types";`.
  - NO local types in any Pothos/service file later; `DBTransaction`/`DBQueryExecutor` imports come from `@/backend/types` only.
  - _Requirements: REQ-003_
  - [x] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/classes/lesson.types.ts --lifecycle duplicates` (exit 0) + same for the barrel.
  - [x] 1.1.TE **Test Engineering:** no new logic — the layer's conformance suites stay green UNEDITED.
  - [x] 1.1.SEC **Security & Tenancy Audit:** `LessonSubmitInput` structurally omits `id`/`createdAt`/`updatedAt` — BOPLA-safe by type construction (REQ-031).
  - [x] 1.1.SR **Semantic Review:** zero dead exports; no service-layer `.types.ts`; `@/` alias imports only.
  - [x] 1.1.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + `backend/types/AGENTS.md` (auto-discovered by sub-loop).

### 1.2 i18n — Error Keys + NEW `lessons` Namespace + Nav Label (ONE changeset)

- [x] 1.2 [Add the `lessonCatalog` error group, the `lessons` UI namespace, and the nav label — en + ar in the same changeset]
  - UPDATE `shared/locale/types/errors/labels.ts`: `LessonCatalogErrorsLabels` interface with keys `lessonNotFound`, `lessonTitleRequired`, `lessonTitleTooLong`, `lessonPlanNotFound`, `lessonPatchEmpty` + root member `readonly lessonCatalog: LessonCatalogErrorsLabels;` (mirror `PlanCatalogErrorsLabels` `:8-19` / root `:71`).
  - UPDATE `shared/locale/en/errors/index.ts` + `shared/locale/ar/errors/index.ts` with concrete copy for all 5 keys (Arabic strings MUST contain Arabic script) beside the `planCatalog` blocks (`:22-33`).
  - CREATE `shared/locale/types/lessons/index.ts` (`LessonsLabels` interface — page title, plan selector placeholder, table headers, dialog title/labels/buttons, delete confirm copy, toasts), `shared/locale/namespaces/lessons/lessons.namespace.ts` (`defineNamespace<LessonsLabels>("lessons.lessons", t => t.lessonsTranslations)` — pattern `shared/locale/namespaces/plans/plans.namespace.ts:3`), `shared/locale/en/lessons/index.ts`, `shared/locale/ar/lessons/index.ts` (Arabic-script strings).
  - UPDATE `shared/locale/namespaces/registry.ts` (import + member — `:25`/`:49` precedent); `shared/locale/types/message.ts` (`lessonsTranslations: LessonsLabels` — `:31` neighbors); `shared/locale/en/messages.ts:32` + `shared/locale/ar/messages.ts:32` (import + member).
  - UPDATE nav label: `shared/locale/types/dashboard/index.ts` (`readonly lessons: string;` — `:39` neighbors), `shared/locale/en/dashboard/index.ts:15` neighbors (`lessons: "Lessons"`), `shared/locale/ar/dashboard/index.ts:15` neighbors (Arabic script).
  - FORBIDDEN anywhere: `Translation.` enum (does not exist), two-arg `getTranslations`, `next-intl`, `getBackendTranslations`, `shared/messages/`.
  - _Requirements: REQ-002, REQ-063_
  - [x] 1.2.QL **Quality Loop:** sub-loop on ALL seven locale files + the registry + message wiring (exit 0 each).
  - [x] 1.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts shared/locale/errors-namespace.parity.test.ts` AND the namespace-parity suite — both green with the new keys.
  - [x] 1.2.SEC **Security & Tenancy Audit:** no interpolation surface in the new strings (static labels only) — nothing user-controlled enters any template.
  - [x] 1.2.SR **Semantic Review:** en/ar trees structurally identical; key names EXACTLY the inventory above; no invented nested groupings.
  - [x] 1.2.IV **Instruction Verification:** validate against `shared/AGENTS.md` + `shared/locale/AGENTS.md` (namespace conventions).

---

## Phase 2: Repository, Service & Seeds

### 2.1 `LessonRepository` + `createTestLesson` Fixture Helper + Repository Test

- [x] 2.1 [Repository + entity-setup helper + 100%-coverage repo test — one changeset]
  - CREATE `backend/db/repo/classes/lesson.repository.ts` with EXACTLY the five methods/signatures of `plan.md` §4.1 (`insertLesson`, `updateLessonFields`, `deleteById`, `findById`, `listByPlanId` — `tx` LAST on every method; `listByPlanId` orders `id ASC`, the ONLY ordering in the ticket). Mirror the dual-path idiom: `isDBTransaction` guard + `LESSON_READ_COLUMNS` constant + raw `queryDb` for bare reads (precedent `backend/db/repo/billing/plan.repository.ts:33-42`); defensive `ConflictError` if `insertLesson`'s RETURNING is empty (`:52` precedent).
  - UPDATE `backend/db/repo/classes/index.ts` (6 exports today): add `export * from "./lesson.repository";`.
  - UPDATE `backend/db/test/entity-setup.ts`: add `createTestLesson(tx: DBTransaction, planId: number, overrides: Partial<LessonSelectType> = {}): Promise<LessonSelectType>` — defaults `title: `Test Lesson ${randomUUID().slice(0, 8)}``, random unique email pattern follows `createTestUser` (`:72-77`); `planId` positional REQUIRED (forces explicit plan linkage); verify `createTestPlan` (`:178-198`) for call composition. NO other entity-setup helper is modified.
  - CREATE `backend/db/test/repo/classes/lesson.repository.test.ts`: 4-Tier suite per `backend/db/test/AGENTS.md` — every test inside `runInRollback` with `tx` passed to ALL repo calls; `expectRepoError` try/catch (never `expect().rejects.toThrow()`); committed-fixture branch (`beforeAll` real committing `db.transaction` + `afterAll` hard-delete re-probes) covering the NO-`tx` `queryDb` path; Tier-3 `Promise.allSettled` concurrent double-delete/update races (REQ-042); Tier-4 FK probe via `constraintNameOf` (insert with bogus `plan_id` → `lessons_plan_id_plans_id_fkey`, REQ-035/044); progress-survivor probe (REQ-043): create lesson + progress row referencing it, delete the lesson, assert the progress row survives with `lesson_id = NULL`; `listByPlanId` ordering assertion (id ASC, REQ-015); 100% line/function coverage (`bun run test/scripts/run-test.ts` + coverage per Rule 14).
  - _Requirements: REQ-010, REQ-015, REQ-040, REQ-041, REQ-042, REQ-043, REQ-044_
  - [x] 2.1.QL **Quality Loop:** sub-loop on the repository, the barrel, `entity-setup.ts`, and the test file (exit 0 each).
  - [x] 2.1.TE **Test Engineering:** all four tiers above implemented; every repo method exercised on BOTH the `tx` and bare-`queryDb` paths.
  - [x] 2.1.SEC **Security & Tenancy Audit:** no client-supplied id used without existence resolution in later layers — repo is pure data access; all reads parameterized.
  - [x] 2.1.SR **Semantic Review:** guarded single statements only (no SELECT-then-UPDATE); `updatedAt` set server-side; zero dead exports.
  - [x] 2.1.IV **Instruction Verification:** validate against `backend/db/repo/AGENTS.md` + `backend/db/test/AGENTS.md` + `.agents/instructions/backend.instructions.md` + `tests.instructions.md`.

### 2.2 `LessonService` + `lesson.helpers.ts` + Service Test

- [x] 2.2 [Service + helpers + logic-tree service test — one changeset]
  - CREATE `backend/services/classes/lesson.helpers.ts` with EXACTLY the five helpers of `plan.md` §4.3 (`validateLessonInput`, `validateAndExtractLessonPatch`, `toLessonWriteDomainError` — including the pg-`23503` `lessons_plan_id_plans_id_fkey` → planId-field `ValidationError` mapping, `LESSON_AUDIT_ENTITY_TYPE = "lesson"`, `buildLessonAuditContract`). Validation codes: `LESSON_TITLE_REQUIRED` / `LESSON_TITLE_TOO_LONG` (trim + length ≤ 255) / `LESSON_PLAN_NOT_FOUND` / `LESSON_PATCH_EMPTY` — every message from `getServerTranslations(locale).errorsTranslations.lessonCatalog.*` (REQ-012).
  - CREATE `backend/services/classes/lesson.service.ts` with EXACTLY the namespace/method signatures of `plan.md` §4.2 (`coerceLessonId`, `createLesson`, `updateLesson`, `deleteLesson`, `listForPlan`): shared mutation prelude resolves locale → `assertActorAdmin(actorId, resolvedLocale, tx)` (`backend/services/admin/admin-gate.helpers.ts:114`) → returns `tErrors` (non-admin = ZERO writes BEFORE validation); plan existence via `PlanRepository.findById(planId, tx)` (`backend/db/repo/billing/plan.repository.ts:131`) — miss → `ValidationError` planId field (the ticket's 422; any active state accepted); `withTransaction(tx, …)` (`backend/lib/db/with-transaction.ts:42`) composes write + `AuditService.createAuditLog(buildLessonAuditContract(…), scopedTx)` — Create/Update/Delete rows, Delete snapshots `{ planId, title }`; happy paths log `logger.info`, denials log exactly ONE `logger.logDomainError` (REQ-080); no `{...input}` spread into `.set()` (REQ-031).
  - UPDATE `backend/services/classes/index.ts`: add `export * from "./lesson.service";` (top-level `backend/services/index.ts` already re-exports `./classes`).
  - CREATE `backend/db/test/logic/classes/lesson.service.test.ts` (real service + real repo + real `audit_logs` inside `runInRollback`; `spyOn(logger, "logDomainError")` silencing; `provisionAdminActor` = `createTestUser(tx, { role: "admin" })`): admin happy paths (create → row + audit row; update title/planId re-link; delete → row gone + audit snapshot); validation matrix (empty title, > 255 title, bogus plan id → `LESSON_PLAN_NOT_FOUND` on field `planId`, empty patch); `LESSON_NOT_FOUND` for update/delete of unknown + hostile ids (`0`, `-1`, `NaN` via `coerceLessonId`); FORBIDDEN probes with student/teacher/parent actors (`createTestUser` role variants) — `ForbiddenError`, ZERO lesson rows, ZERO audit rows (zero-write denial oracle, count helper mirrors `plan-catalog.service.test.ts:95-98`); BOPLA smuggling via `Object.defineProperty` (extra `id`/`createdAt` props ignored — `:695` precedent); concurrent `Promise.allSettled` double-delete → exactly one success (REQ-042); `tx` propagation accepted from callers.
  - _Requirements: REQ-011, REQ-012, REQ-013, REQ-014, REQ-018, REQ-030, REQ-031, REQ-032, REQ-035, REQ-044, REQ-053, REQ-080, REQ-081_
  - [x] 2.2.QL **Quality Loop:** sub-loop on helpers, service, the barrel, and the test file (exit 0 each).
  - [x] 2.2.TE **Test Engineering:** all suites above; run via `bun run test/scripts/run-test.ts backend/db/test/logic/classes/lesson.service.test.ts`.
  - [x] 2.2.SEC **Security & Tenancy Audit:** actor id ONLY from caller context in GraphQL later; assertActorAdmin re-check is defense in depth; smuggled-props probe green.
  - [x] 2.2.SR **Semantic Review:** service never writes `progress`/`plans`; enum members (AuditActionType.*) are VALUE imports; no dead branch — every throw reachable via a test.
  - [x] 2.2.IV **Instruction Verification:** validate against `backend/services/AGENTS.md` + `backend/db/test/logic/AGENTS.md` + instruction files.

### 2.3 Dev-Seed Parity — NEW `backend/db/seeds/classes/seed-lessons.ts`

- [x] 2.3 [Service-only, idempotent Tajweed curriculum seeder]
  - CREATE `backend/db/seeds/classes/` (NEW sub-directory — on disk today seeds has only `billing/`, `lib/`, `students/`, `users/`): `index.ts` barrel (`export { seedOrGet as seedOrGetLessons } from "./seed-lessons";` — `billing/index.ts:1` precedent) + `seed-lessons.ts` with `seedOrGet(locale = "en", adminActorId: number, tajweedPlanId: number, tx?: DBTransaction): Promise<LessonReturnType[]>` — consume `LessonService.listForPlan` + `createLesson` EXCLUSIVELY (zero raw `@/backend/db/**` imports per `backend/db/seeds/AGENTS.md`); starter curriculum ≥ 3 lessons (e.g. "Al-Madd", "An-Noon as-Sakinah", "Al-Qalqalah"); idempotent by `(tajweedPlanId, title)` matching; absorb `ConflictError` only on the non-`tx` path with a race-recovery re-read (seed-plans precedent).
  - UPDATE master controller `backend/db/seeds/index.ts`: register the classes barrel and thread the Tajweed plan identity from the plans seeding result (`"Tajweed & Tilawa"` row returned by `seedOrGet` of `backend/db/seeds/billing/seed-plans.ts:45`) into the lesson seeder via the controller context — NEVER by querying seed data.
  - Verify idempotency: run the seeder twice against the dev DB; the second run creates nothing.
  - _Requirements: REQ-017_
  - [x] 2.3.QL **Quality Loop:** sub-loop on the seeder, its barrel, and the master controller (exit 0 each).
  - [x] 2.3.TE **Test Engineering:** manual double-run idempotency check recorded in the outcome file; no new automated suite (seeds are not unit-tested by repo convention).
  - [x] 2.3.SEC **Security & Tenancy Audit:** actor id threaded from the provisioned demo admin; no hardcoded credentials anywhere.
  - [x] 2.3.SR **Semantic Review:** service-only discipline; no duplicated validation bypass (all writes go through `LessonService.createLesson` and inherit its rules).
  - [x] 2.3.IV **Instruction Verification:** validate against `backend/db/seeds/AGENTS.md`.

### Phase 2.5: Mid-Point Review Gate (backend scope)

- [x] 2.4 [Backend architecture review checkpoint — plan has >15 tasks with distinct backend/frontend phases]
  - Dispatch review subagents scoped to the `backend/` files created in Phases 1–2 (`lesson.types.ts`, locale error files, `lesson.repository.ts`, `lesson.helpers.ts`, `lesson.service.ts`, seeder): review-backend (architecture, dead code, cross-layer imports), review-types (canonical naming, import paths).
  - Aggregate findings (filter to backend-only), dispatch fix subagents per file cluster, re-run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per fixed file.
  - Write `outcome/2.4-midpoint-review-R1.md`; re-review until zero backend-specific findings.
  - _Requirements: REQ-003, REQ-010_

---

## Phase 3: GraphQL Surface (Pothos + Mutations + Query + SDL Locks)

### 3.1 `LessonPothosObject` + Inputs — NEW `backend/graphql/pothos/classes/lesson.pothos.ts`

- [x] 3.1 [Canonical object type + input types]
  - CREATE `backend/graphql/pothos/classes/lesson.pothos.ts`: `LessonPothosObject = gqlSchemaBuilder.objectRef<LessonReturnType>("Lesson").implement({...})` backed EXCLUSIVELY by `LessonReturnType` from `@/backend/types` (zero local types) — `id: t.exposeID("id", …)`, `planId: t.exposeInt("planId", …)`, `title: t.exposeString("title", { nullable: true, … })`, `createdAt`/`updatedAt: t.string({ resolve: parent => parent.createdAt.toISOString() })` (pattern `backend/graphql/pothos/billing/plan.pothos.ts:57-96`); input types `CreateLessonInput` (`planId: t.int({ required: true })`, `title: t.string({ required: true })`) and `UpdateLessonInput` (both optional).
  - UPDATE `backend/graphql/pothos/classes/index.ts`: `export * from "./lesson.pothos";`.
  - _Requirements: REQ-050_
  - [x] 3.1.QL **Quality Loop:** sub-loop on the pothos file + barrel (exit 0).
  - [x] 3.1.TE **Test Engineering:** consumed by 3.4's schema test (field-type map) — no standalone suite.
  - [x] 3.1.SEC **Security & Tenancy Audit:** NO forbidden fields to omit (no soft-delete/internal columns exist on `lessons`); payload = `{id, planId, title, createdAt, updatedAt}` only (REQ-033).
  - [x] 3.1.SR **Semantic Review:** timestamps serialize via `toISOString`; no enum re-typing (none needed).
  - [x] 3.1.IV **Instruction Verification:** validate against `backend/graphql/AGENTS.md` + `backend/graphql/pothos/AGENTS.md`.

### 3.2 Admin Mutations — NEW `backend/graphql/mutation/classes/lesson.mutation.ts`

- [x] 3.2 [createLesson / updateLesson / deleteLesson]
  - CREATE `backend/graphql/mutation/classes/lesson.mutation.ts` registering the three fields of `plan.md` §5.1: each with `authScopes: { role: [UserRole.Admin] }` (VALUE import from `@/backend/enum`), the `if (!ctx.user) throw new UnauthorizedError("Authentication required.")` TS-narrowing prelude (plan-catalog precedent), `actorId` EXCLUSIVELY from `ctx.user.id`, and delegation to the matching `LessonService` method (`updateLesson`/`deleteLesson` ids pass through `LessonService.coerceLessonId`; patch built field-by-field with conditional spreads — never `{...args.input}`).
  - UPDATE `backend/graphql/mutation/classes/index.ts`: add the side-effect import `import "./lesson.mutation";` (+ extend the barrel's doc comment listing the registered fields).
  - _Requirements: REQ-030, REQ-050, REQ-051_
  - [x] 3.2.QL **Quality Loop:** sub-loop on the mutation file + barrel (exit 0).
  - [x] 3.2.TE **Test Engineering:** exercised by 3.4's roles test (this file is registration-only — no standalone suite).
  - [x] 3.2.SEC **Security & Tenancy Audit:** all three mutations admin-gated BEFORE any resolver body (BFLA); ids never sourced from client identity claims (BOLA).
  - [x] 3.2.SR **Semantic Review:** side-effect-only module (no named exports) per `backend/graphql/mutation/AGENTS.md`.
  - [x] 3.2.IV **Instruction Verification:** validate against `backend/graphql/AGENTS.md` + `backend/graphql/mutation/AGENTS.md`.

### 3.3 Authenticated Read — NEW `backend/graphql/query/classes/lesson.query.ts`

- [x] 3.3 [planLessons query]
  - CREATE `backend/graphql/query/classes/lesson.query.ts`: `gqlSchemaBuilder.queryField("planLessons", …)` with `type: [LessonPothosObject]`, `authScopes: { authenticated: true }` (anonymous → 401), arg `planId: t.arg.id({ required: true })` coerced via `PlanCatalogService.coercePlanId` (single source of plan-id parsing; malformed/unknown plan → `PLAN_NOT_FOUND` 404 semantics — the lesson list of a nonexistent plan collapses the same way), resolver `LessonService.listForPlan(coercedId, ctx.locale)`.
  - UPDATE `backend/graphql/query/classes/index.ts`: add the side-effect import (+ doc-comment line).
  - _Requirements: REQ-016, REQ-033, REQ-050, REQ-051_
  - [x] 3.3.QL **Quality Loop:** sub-loop on the query file + barrel (exit 0).
  - [x] 3.3.TE **Test Engineering:** exercised by 3.4's roles + schema tests.
  - [x] 3.3.SEC **Security & Tenancy Audit:** read payload exposes ONLY non-sensitive curriculum fields (REQ-033); no LIKE/search args exist (wildcard-escape N/A documented).
  - [x] 3.3.SR **Semantic Review:** ordering lives in the repository, not in GraphQL (id ASC, REQ-015).
  - [x] 3.3.IV **Instruction Verification:** validate against `backend/graphql/AGENTS.md` + `backend/graphql/query/AGENTS.md`.

### 3.4 Codegen + SDL Locks — `lesson.schema.test.ts` + `lesson.roles.test.ts`

- [x] 3.4 [Regenerate schema/types + write the SDL contract and roles-matrix tests]
  - Run `bun run generate:gqlSchema && bun codegen`; the committed `frontend/graphql/generated/schema.graphql` updates in the same changeset.
  - CREATE `backend/graphql/test/lesson.schema.test.ts` mirroring `backend/graphql/test/plan-catalog.schema.test.ts:22-69`: exact `Lesson` field-type map (`id: "ID!"`, `planId: "Int!"`, `title: "String"`, `createdAt: "String!"`, `updatedAt: "String!"`), `planLessons` on the Query root + all three mutations on the Mutation root (`:44-45` pattern), committed schema.graphql equals `printSchema(lexicographicSortSchema(graphQLSchema))` (`:61-69` pattern), AND a presence assertion for `deleteLesson` (this ticket deliberately ADDS the delete that the plans catalog forbids for plans).
  - CREATE `backend/graphql/test/lesson.roles.test.ts` mirroring `backend/graphql/test/plan-catalog.roles.test.ts:55-208`: in-process schema (`graphql()` + `graphQLSchema`), `buildContextForUser` contexts; anonymous → `UNAUTHORIZED` on `planLessons` and `FORBIDDEN` on all three mutations; `test.each` over Student/Teacher/Parent → `FORBIDDEN` on every mutation and success on `planLessons`; admin happy path (seeded admin via `db.select().from(users)…` — tracked created-lesson ids hard-deleted in `afterAll` with `withAuditDeleteTriggersSuspended` from `@/test/helpers/db-cleanup`, `:45-53` pattern); assert each mutation's error path carries `extensions.fields[]` codes (`LESSON_TITLE_REQUIRED`, `LESSON_PLAN_NOT_FOUND`) and `LESSON_NOT_FOUND` for unknown ids.
  - _Requirements: REQ-016, REQ-030, REQ-051, REQ-053_
  - [x] 3.4.QL **Quality Loop:** sub-loop on both test files + the regenerated schema.graphql (exit 0).
  - [x] 3.4.TE **Test Engineering:** both suites green via `bun run test/scripts/run-test.ts backend/graphql/test/lesson.schema.test.ts` and `.../lesson.roles.test.ts`; ticket scenario mapping — "Non-admin attempts lesson CRUD — 403" proven for every non-admin role; "lesson with non-existent plan_id — 422" proven on the create AND update paths.
  - [x] 3.4.SEC **Security & Tenancy Audit:** the roles matrix IS the BFLA/BFLA-read oracle; zero rows + zero audit rows asserted after each denial.
  - [x] 3.4.SR **Semantic Review:** tests assert on `extensions.code`/`extensions.fields` — no message-string coupling beyond translated substrings where the AGENTS requires it.
  - [x] 3.4.IV **Instruction Verification:** validate against `backend/graphql/test/` conventions + `tests.instructions.md`.

---

## Phase 4: Frontend (Documents → Admin UI → Route & Nav)

### 4.1 GraphQL Documents — NEW `frontend/graphql/sharedDocuments/classes/`

- [x] 4.1 [Lesson documents + new domain barrel]
  - CREATE `frontend/graphql/sharedDocuments/classes/lesson.documents.ts` exporting `planLessonsQueryDocument` (`TypedDocumentNode<PlanLessonsQuery, PlanLessonsQueryVariables>`), `createLessonMutationDocument`, `updateLessonMutationDocument`, `deleteLessonMutationDocument` (`TypedDocumentNode<{Pascal}Mutation, {Pascal}MutationVariables>`) — `import { gql, type TypedDocumentNode } from "@apollo/client"` (never `@apollo/client/core`), operation-derived codegen types only (NO schema types, NO type mapping), `id` in EVERY selection set (Apollo cache normalization).
  - CREATE `frontend/graphql/sharedDocuments/classes/index.ts` barrel (`export * from "./lesson.documents";`); UPDATE `frontend/graphql/sharedDocuments/index.ts` with `export * from "./classes";`; UPDATE the Layout table in `frontend/graphql/sharedDocuments/AGENTS.md` (its own "Document any new sub-directory" rule).
  - Run `bun run generate:gqlSchema && bun codegen` (if not already current) so the operation types exist; `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/documents.contract.test.ts` green.
  - _Requirements: REQ-052_
  - [x] 4.1.QL **Quality Loop:** sub-loop on the documents file + both barrels + the AGENTS.md edit (exit 0).
  - [x] 4.1.TE **Test Engineering:** documents contract test green UNEDITED.
  - [x] 4.1.SEC **Security & Tenancy Audit:** no fragments leak fields beyond the `Lesson` payload (REQ-033).
  - [x] 4.1.SR **Semantic Review:** naming follows `{entityName}QueryDocument`/`{entityName}MutationDocument` exactly.
  - [x] 4.1.IV **Instruction Verification:** validate against `frontend/graphql/sharedDocuments/AGENTS.md`.

### 4.2 Admin Lessons UI — NEW `frontend/views/admin/lessons/`

- [x] 4.2 [Plan-selector + lesson management stack cloned from the plans admin]
  - CREATE `frontend/views/admin/lessons/` mirroring `frontend/views/admin/plans/`: `index.ts` barrel; `catalog/LessonsCatalogContainer.tsx` (`"use client"`; plan selector fed by `useQuery(adminPlansQueryDocument, { fetchPolicy: "cache-and-network" })` — plans list from the EXISTING billing documents; lessons via `useQuery(planLessonsQueryDocument, { variables: { planId } , skip: !planId })`); `catalog/LessonsDesktopTable.tsx` + `catalog/LessonsMobileCardList.tsx` + `catalog/LessonsMobileCard.tsx` (theme-callback `sx` styling ONLY — MUI v9, no style props); `forms/LessonFormDialog.tsx` (+ `LessonFormContent`, field components) driven by `useLessonFormDialog`; `dialogs/LessonDeleteConfirmDialog.tsx`; `hooks/useLessonFormDialog.ts` + `hooks/useLessonDelete.ts` (`useMutation(createLessonMutationDocument)` / `updateLessonMutationDocument` / `deleteLessonMutationDocument` imported from `@apollo/client/react`; refetch-after-write; errors surfaced via the GraphQL error surface, `deleteLesson` evicts the deleted row's cache entry); all strings via `useAppTranslation(Lessons)` (REQ-063 namespace) — ZERO hardcoded strings.
  - Structure rules: components stay in `frontend/views/admin/lessons/**` (no `app/` business components); Apollo hooks from `"@apollo/client/react"` only; NO `useLazyQuery`.
  - _Requirements: REQ-062_
  - [x] 4.2.QL **Quality Loop:** sub-loop on every new file (exit 0 each).
  - [x] 4.2.TE **Test Engineering:** component behavior covered by 4.3's page test + 4.4 static checks; no Storybook stories required (repo adds stories only where stores exist).
  - [x] 4.2.SEC **Security & Tenancy Audit:** UI renders only what the role-gated queries return — no client-side permission inference.
  - [x] 4.2.SR **Semantic Review:** zero dead components; every exported component consumed; MUI v9 `sx` discipline.
  - [x] 4.2.IV **Instruction Verification:** validate against `frontend/views/AGENTS.md` + `frontend/AGENTS.md` + `.agents/instructions/frontend.instructions.md`.

### 4.3 Route Page + Nav Item + Page Test

- [x] 4.3 [app/(dashboard)/admin/lessons/page.tsx + nav entry + co-located test]
  - CREATE `app/(dashboard)/admin/lessons/page.tsx` mirroring `app/(dashboard)/admin/plans/page.tsx:23-35`: `generateMetadata` via `getLocaleFromCookie()` + `getTranslations(locale).lessonsTranslations`; `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/lessons" })`; render `<LessonsCatalogContainer />`.
  - CREATE `app/(dashboard)/admin/lessons/page.test.ts` mirroring the plans page's co-located test.
  - UPDATE `frontend/views/dashboard/nav/navItems.ts`: Admin array (`:155-183`) gains `{ route: "/admin/lessons", labelKey: "lessons", Icon: MenuBookOutlined }` immediately AFTER the `/admin/plans` entry (`:161`); MUI v9 `*Outlined` icon import per `:6-28`.
  - _Requirements: REQ-060, REQ-061_
  - [x] 4.3.QL **Quality Loop:** sub-loop on the page, its test, and navItems.ts (exit 0 each).
  - [x] 4.3.TE **Test Engineering:** `bun run test/scripts/run-test.ts app/(dashboard)/admin/lessons/page.test.ts` green; nav label resolves via `resolveNavItemLabel` (`navItems.ts:209-218`).
  - [x] 4.3.SEC **Security & Tenancy Audit:** page gate = `withPageAuth` Admin-only; role-mismatch users redirect to their own dashboard (framework behavior).
  - [x] 4.3.SR **Semantic Review:** server component composes metadata; the client container owns ALL interactivity (layer separation).
  - [x] 4.3.IV **Instruction Verification:** validate against `app/AGENTS.md` + frontend instructions.

### 4.4 Static Gates

- [x] 4.4 [Role-gating static checks]
  - Run the documents contract test; record results in the outcome file.
  - _Requirements: REQ-060, REQ-061, REQ-062_
  - [x] 4.4.QL **Quality Loop:** any file the gates flag passes sub-loop after the fix.

---

## Phase 5: Review Wave & Final Quality Gate

### 5.1 Post-Implementation Review Wave (MANDATORY — >10 tasks)

- [x] 5.1 [Four parallel review subagents over the plan's files only]
  - Scope: `git diff --name-only` vs the task-0.1 baseline. Dispatch: `review-types` (new/modified type files), `review-backend` (`backend/` files — TOCTOU/dead code/cross-layer), `review-frontend` (`frontend/` + `app/` files — MUI v9/Apollo/theme), `security-probing` (all new resolvers: BFLA matrix, BOPLA smuggling, BOLA, input sanitization).
  - Deduplicate, filter to new code, fix per file cluster via sub-loop; re-review until zero feature-specific findings; write `outcome/5.1-post-implementation-review.md`.
  - _Requirements: REQ-032, REQ-070_

### 5.2 Final Quality Gate & Deferred-Items Enforcement

- [x] 5.2 [Baseline comparison + ledger gate + global health]
  - Deferred gate: `grep -cE '^\s*\| D[0-9]+ .*(❌|⚠️)' ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/deferred-items.md` = 0.
  - Zero-drift gate: `git diff --name-only backend/db/schema/ backend/drizzle/` = empty (REQ-010).
  - Baseline comparison vs `/tmp/baseline-*.txt`; run `bun tsgo`; re-run sub-loop on every file touched by fix waves (exit 0).
  - Write `outcome/5.2-final-gate-outcome.md`.
  - _Requirements: REQ-001, REQ-010, REQ-081_

---

## Phase 6: Knowledge Propagation (MANDATORY Final Task)

- [x] 6.1 [Canonical doc + outcome synthesis]
  - Read ALL outcome files; synthesize recurring patterns/gotchas; CREATE `docs/curriculum/lessons-crud.md` (new `docs/curriculum/` subdir) — Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents (linking this plan's outcome/).
  - AGENTS.md / `.agents/instructions/` files are NEVER updated from plan outcomes (hand-curated only).
  - Sub-loop the new doc's directory artifacts where applicable; write `outcome/6.1-knowledge-propagation-outcome.md`.
  - _Requirements: REQ-001, REQ-071_

---

## Requirements Traceability (every REQ-xxx of `specs.md` → owning task)

| REQ | Task(s) | | REQ | Task(s) | | REQ | Task(s) |
|---|---|---|---|---|---|---|---|
| REQ-001 | 0.1, 5.2, 6.1 | | REQ-014 | 2.2 | | REQ-044 | 2.1, 2.2 |
| REQ-002 | 0.3, 1.2 | | REQ-015 | 2.1 | | REQ-050 | 3.1, 3.2, 3.3 |
| REQ-003 | 0.3, 1.1, 2.4 | | REQ-016 | 3.3, 3.4 | | REQ-051 | 3.2, 3.3, 3.4 |
| REQ-004 | 0.2, 0.3 | | REQ-017 | 2.3 | | REQ-052 | 4.1 |
| REQ-010 | 0.2, 2.1, 2.4, 5.2 | | REQ-018 | 2.2 | | REQ-053 | 2.2, 3.4 |
| REQ-011 | 2.2 | | REQ-030 | 2.2, 3.2, 3.4 | | REQ-060 | 4.3, 4.4 |
| REQ-012 | 2.2 | | REQ-031 | 1.1, 2.2 | | REQ-061 | 4.3 |
| REQ-013 | 2.2 | | REQ-032 | 2.2, 5.1 | | REQ-062 | 4.2, 4.4 |
| REQ-033 | 3.3 | | REQ-063 | 1.2 | | REQ-070 | 0.2, 5.1 | |
| REQ-034 | 2.2 | | REQ-071 | 6.1 | | REQ-035 | 2.1, 2.2 | |
| REQ-040 | 2.1 | | REQ-080 | 2.2 | | REQ-041 | 2.1 | |
| REQ-081 | 5.2 | | REQ-042 | 2.1, 2.2 | | REQ-043 | 2.1 | |

**Ticket-scenario oracle map** (the ticket's four test scenarios → their proving suites):
- Admin creates lesson — success → `lesson.roles.test.ts` admin happy path + `lesson.service.test.ts` create tests.
- Lesson linked to plan — success → service create asserts the persisted `planId` + repo `listByPlanId` scoping.
- Non-admin attempts lesson CRUD — 403 → `lesson.roles.test.ts` `test.each` matrix (Student/Teacher/Parent + anonymous).
- Lesson with non-existent plan_id — 422 → `lesson.service.test.ts` + roles-test create/update probes asserting `extensions.fields[].code === "LESSON_PLAN_NOT_FOUND"`.
