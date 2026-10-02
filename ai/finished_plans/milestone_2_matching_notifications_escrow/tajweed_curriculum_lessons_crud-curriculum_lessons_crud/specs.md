# Requirements & Specification: Tajweed Curriculum Lessons CRUD

> **Target ticket:** `Tajweed Curriculum Lessons CRUD` (Owner: Dev 1 · Milestone 2 · 3 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/`
> **Blocking dependency:** Subscription Validity Window & Expiry — SHIPPED and test-locked at `ai/finished_plans/milestone_1_core_domain_mvp/subscription-validity-window-expiry/`; it delivers the `plans` catalog (`backend/db/schema/billing/plans.ts:23-33`) that `lessons.plan_id` links into.
> **Blocked-by-us:** Student Progress Tracking & Increment (next Dev 1 M2 ticket, `docs/planning/TICKETS.md:1185`) — consumes this ticket's curriculum read model and ordering contract (REQ-015, REQ-071).
> **Grounding docs:** FR-6.1 `docs/specs/functional-requirements.md:198-200` · FR-6.2 `:202-204` · FR-6.3 `:206-208` · INV-PR1/PR2/PR3 `docs/specs/state-machine-invariants.md:303-305` · DBML `db/schema.dbml:446-452` (`Ref: lessons.plan_id > plans.id [delete: set null]` at `:555`).

> **Critical reconciliation notes (READ FIRST — every section below assumes these rulings):**
> 1. **ZERO schema delta.** The `lessons` table already ships complete: `backend/db/schema/classes/lessons.ts:17-30` — `id` integer identity PK (`:20`), `plan_id` nullable FK → `plans.id` ON DELETE SET NULL (`:21`), `title` varchar(255) nullable (`:22`), `created_at`/`updated_at` (`:23-27`), index `lessons_plan_id_idx` (`:29`) — created by migration `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:174`. `git diff backend/db/schema/** backend/drizzle/**` MUST remain empty at completion; `bun run db push` is never invoked (D1).
> 2. **No ordering column exists and none is minted.** FR-6.1 names only `(plan_id, title)` and the schema agrees — so the curriculum sequence is **`ORDER BY id ASC` within a plan** (creation order = curriculum order), enforced in exactly ONE repository predicate (D1; reorder surfaces deferred — ledger D1).
> 3. **The ticket demands DELETE.** Unlike the plans catalog's forward-only INV-PC3 posture, this ticket explicitly says "Admin can create, edit, and delete lessons". Hard delete is FK-safe by construction: `progress.lesson_id` is ON DELETE SET NULL (`backend/db/schema/classes/progress.ts:26`), so deleting a lesson preserves every progress row as a historical record with `lesson_id = NULL` (D3).
> 4. **`plan_id` nullability is a survival artifact, never an input option.** The column is nullable ONLY so a plan row deletion cannot cascade lessons; no `deletePlan` mutation exists (`backend/graphql/mutation/plan-catalog.mutation.ts` header: "NO deletePlan/removePlan mutation exists"). The admin API therefore REQUIRES `planId` on create and never writes `NULL` on update (INV-PR3, D2).
> 5. **The ticket's "non-existent plan_id — 422" scenario maps to `ValidationError`** carrying a `planId` field error (`LESSON_PLAN_NOT_FOUND`), NOT to `PLAN_NOT_FOUND` (404) semantics — the ticket mandates 422/VALIDATION for a bad plan reference (D6).

---

## 1. Executive Summary & Problem Statement

- **Feature**: The admin-facing curriculum management surface for Tajweed subscription plans: full CRUD over `lessons` rows linked to `plans` via `lessons.plan_id` — one new canonical repository (`LessonRepository`), one new domain service (`LessonService` + `lesson.helpers.ts`), one new canonical types file, a Pothos surface (1 authenticated query `planLessons`, 3 admin mutations `createLesson`/`updateLesson`/`deleteLesson`), a new `lessons` i18n namespace + error-key group, dev-seed parity, and one admin UI page (`/admin/lessons`) cloned from the shipped plans-admin stack.

- **Problem from user perspective**:
  - **Super Admin**: must be able to author the Tajweed curriculum — add lessons, fix titles, re-link a mis-attached lesson, and remove obsolete ones — without touching the database directly, while never corrupting the student progress history that hangs off those lessons (FR-6.1).
  - **Student (subscribed to a Tajweed plan)**: needs the plan's lessons to form a stable, deterministic curriculum sequence so progress tracking (next ticket) can point at a well-defined "current lesson" and advance it (FR-6.3 / INV-PR2 contract starts here).
  - **Certified Teacher (Sheikh Abdullah)**: FR-6.2 requires reviewing a student's current lesson position before accepting a Tajweed session request — the teacher-facing read of the curriculum rides this ticket's authenticated `planLessons` query; the progress overlay ships with the next ticket.
  - **Dev 1 (Student Progress Tracking & Increment)**: needs the canonical lesson read model + ordering rule + the `createTestLesson` entity-setup helper so the progress ticket never re-implements lesson lookup.
- **Business value**: lessons are the backbone of the M2 Tajweed matching loop (session requests → teacher preparation → completion → progress increment). A deterministic per-plan sequence and an audited, tenancy-safe admin surface prevent silent curriculum drift; deleting a lesson can never destroy a student's history (FK set-null).
- **M2 positioning (Matching, Notifications & Escrow focus)**: this ticket is the Dev 1 data substrate of M2 — it feeds the progress-increment leg of the matching loop (FR-6.2/FR-6.3) and touches NO escrow, wallet, or notification surface (explicit non-goal, REQ-070/REQ-071); no notifications fire on lesson mutations (admin configuration changes, not user-facing events — ledger D-pointer).
- **Actors involved**:
  - **Admin (sole mutator)**: full CRUD via the GraphQL admin mutations and the `/admin/lessons` page.
  - **Authenticated readers (student / teacher / parent / admin)**: read-only `planLessons` query for curriculum display.
  - **Downstream consumer**: Student Progress Tracking & Increment ticket (repository + ordering contract).
  - **Non-actors**: anonymous callers (no reads, no mutations); no actor other than Admin may mutate.
- **Non-goals** (explicitly OUT of scope):
  1. **Progress tracking/increment logic** (INV-PR1/INV-PR2 runtime behavior, FR-6.3 "increment to next lesson") — the Student Progress Tracking & Increment ticket; this ticket only guarantees the data + read contract it consumes.
  2. **Teacher preparation workflow UI** (FR-6.2 review surface) — next ticket; only the raw `planLessons` read ships here.
  3. **Lesson content enrichment** (descriptions, media, surah/juz references, duration) — no such columns exist in `lessons` (`backend/db/schema/classes/lessons.ts:17-30`); future enhancement (ledger D4).
  4. **Curriculum reordering / `position` column** — the schema has no ordering column and this ticket mints none (D1; ledger D1).
  5. **Schema changes of ANY kind** — the `lessons` table is consumed as-is (reconciliation note 1).
  6. **Student/parent-facing lesson UI pages** — the read query ships for future consumers; no student/parent page renders it in this ticket.
  7. **Notification dispatch on lesson mutations** — no `NotificationType` member applies to curriculum edits and none is added; admin configuration changes are not user events.
  8. **Audit-log viewing UI** — audit rows are written (REQ-018); the existing admin audit surfaces render them later.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo 2>&1 | grep "error TS" | wc -l`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline`) to `/tmp/baseline-*.txt` AND SHALL initialize `ai/plans/milestone_2_matching_notifications_escrow/tajweed_curriculum_lessons_crud-curriculum_lessons_crud/deferred-items.md` from the template, pre-seeded with the plan's D1–D5 resolved-pointer rows (ledger targets a future sequencing ticket, the progress ticket, the audit-completeness catalog follow-up, content enrichment, and the anonymous-browsing ruling).
- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
  - Client components MUST use `useAppTranslation(Lessons)` with the namespace handle object from `@/shared/locale/namespaces/lessons` (the repo has NO `Translation` enum — the handle pattern is `defineNamespace` at `shared/locale/namespaces/define-namespace.ts:3-11`; precedent: `Plans` at `shared/locale/namespaces/plans/plans.namespace.ts:3`) with property access `t.propertyName`.
  - Server components MUST use `await getTranslations(locale)` (single argument) and namespace property access (`t.lessonsTranslations.*`).
  - GraphQL resolvers MUST use `ctx.t("...")` (bound to `ctx.locale`); services/repositories MUST use `getServerTranslations(locale).errorsTranslations` from `@/shared/locale/server-graphql` (`shared/locale/server-graphql.ts:3` — ONE argument).
  - Every runtime enum usage (`UserRole.Admin`, `AuditActionType.Create/Update/Delete`, `TransactionType`-style members) MUST be a VALUE import, never `import type`.
  - FORBIDDEN anywhere: `Translation.` enum references (does not exist), two-arg `getTranslations`, `next-intl`, `getBackendTranslations`, `shared/messages/` (removed), hardcoded user-facing strings.
- **REQ-003 (Canonical Types Discipline)**: Entity types MUST live in `backend/types/classes/lesson.types.ts` (NEW) exporting `LessonSelectType`/`LessonInsertType` (Drizzle `$inferSelect`/`$inferInsert` over `backend/db/schema/classes/lessons.ts`), `LessonReturnType` (= select — no forbidden fields, no enum re-typing), `LessonSubmitInput` (`{ planId: number; title: string }` — client whitelist only), `LessonUpdateInput` (`Partial<LessonSubmitInput>`); the `backend/types/classes/index.ts` barrel (today 8 exports, `backend/types/classes/index.ts:1-8`) gains `export * from "./lesson.types";`. NO local type definitions in Pothos/service files; `DBTransaction`/`DBQueryExecutor` imported from `@/backend/types` only.
- **REQ-004 (Dependency Guard)**: WHEN domain work starts THEN the agent SHALL verify at its cited anchor: the `lessons` schema (`backend/db/schema/classes/lessons.ts:17-30`), the `progress` FK (`backend/db/schema/classes/progress.ts:26`), the plans target (`backend/db/schema/billing/plans.ts:23-33`), `PlanRepository.findById` (`backend/db/repo/billing/plan.repository.ts:131`), `assertActorAdmin` (`backend/services/admin/admin-gate.helpers.ts:114`), `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`), `AuditActionType.Delete` (`backend/enum/audit/audit-action-type.enum.ts:10`), and the plan-catalog GraphQL precedent (`backend/graphql/mutation/plan-catalog.mutation.ts`). IF any anchor is missing THEN the agent SHALL record a ❌ ledger row and block dependent tasks — never inline-patch a foreign layer.

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Zero Schema Delta Declaration)**: WHEN this ticket is implemented THEN `backend/db/schema/**` and `backend/drizzle/**` SHALL remain byte-identical; the `lessons` table is consumed exactly as shipped (reconciliation note 1); no `bun run db push` run is ever recorded in any task.
- **REQ-011 (Create Lesson)**: WHEN an authenticated admin submits a valid lesson (`planId`, `title`) THEN the system SHALL insert exactly ONE `lessons` row with the validated `planId` and trimmed `title`, server-generated `id`/`createdAt`/`updatedAt`, and SHALL return the created row. The service SHALL validate all inputs BEFORE any database write (per-field 422 semantics per REQ-012) and SHALL append exactly ONE audit row (Create, entityType `"lesson"`) in the same transaction as the insert.
- **REQ-012 (Validation Rules — Create & Update)**: WHEN lesson input is processed THEN the service SHALL enforce, with localized per-field errors carried on `ValidationError.fields` (`{ field, code, message }` per `backend/lib/errors.ts:65-130`): `title` trimmed non-empty (`LESSON_TITLE_REQUIRED`) and ≤ 255 chars (`LESSON_TITLE_TOO_LONG`, DB ceiling `varchar(255)` at `backend/db/schema/classes/lessons.ts:22`); `planId` an integer ≥ 1 referencing an EXISTING plan — a non-existent plan SHALL reject with `LESSON_PLAN_NOT_FOUND` on the `planId` field BEFORE any write (the ticket's 422 scenario; existence read via `PlanRepository.findById`, `backend/db/repo/billing/plan.repository.ts:131`, any active state — deactivation does not strand curriculum editing). IF the patch is structurally empty THEN the system SHALL reject with `LESSON_PATCH_EMPTY`.
- **REQ-013 (Update Lesson — Partial, Whitelisted)**: WHEN an admin edits a lesson THEN the system SHALL accept a partial patch of `title` and `planId` only, validate every supplied field per REQ-012 (re-assignment to another existing plan is allowed; `planId` can never be set to `null` — D2), reject a nonexistent lesson id with `NotFoundError("LESSON", …)` (`LESSON_NOT_FOUND`, zero-row guarded update is the miss signal), leave `id`/`createdAt` untouched, set `updatedAt` server-side, and append exactly ONE audit row (Update, `changedFields` detail) in the same transaction.
- **REQ-014 (Delete Lesson — Guarded Single Statement)**: WHEN an admin deletes a lesson THEN the system SHALL execute ONE guarded statement `DELETE FROM lessons WHERE id = <id> RETURNING …`; a zero-row delete SHALL yield `LESSON_NOT_FOUND`. Deletion SHALL NOT cascade to `progress` rows — the `ON DELETE SET NULL` FK (`backend/db/schema/classes/progress.ts:26`) preserves them as historical records with `lesson_id = NULL` (D3). Exactly ONE audit row (Delete, entityType `"lesson"`, details snapshotting `{ planId, title }` before the row disappears) SHALL share the mutation's transaction, and the deleted row SHALL be returned for Apollo cache eviction.
- **REQ-015 (Curriculum Sequence Read Model)**: WHEN lessons are listed for a plan THEN the repository SHALL return them ordered `id ASC` — the single canonical curriculum-sequence predicate, implemented in exactly ONE place (`LessonRepository.listByPlanId`) that every consumer (admin UI, future teacher-preparation read, progress-increment logic) reuses; no caller-side re-sorting exists.
- **REQ-016 (Read Surface Split)**: WHEN lesson reads are exposed THEN the system SHALL expose exactly ONE query — `planLessons(planId: ID!): [Lesson!]!` with `authScopes: { authenticated: true }` (any authenticated role may read a plan's curriculum — lesson rows are non-sensitive `{id, planId, title, timestamps}` data), while ALL mutations remain admin-gated per REQ-030; no `adminLessons` duplicate exists (no `is_active`-style state to split on, unlike the plans catalog's `planCatalog` vs `adminPlans` pair).
- **REQ-017 (Seed Parity)**: WHEN dev seeds run THEN a starter Tajweed curriculum (at least 3 lessons on the seeded Tajweed plan — `"Tajweed & Tilawa"`, `backend/db/seeds/billing/seed-plans.ts:45`, `balanceLane: SubscriptionCreditLane.Tajweed` at `:50`) SHALL be provisioned through `LessonService` exclusively (seedOrGet idiom per `backend/db/seeds/AGENTS.md`, idempotent by `(planId, title)` lookup, never via raw `@/backend/db/**` imports), with the plan identity threaded by the master seed controller via its context — never by querying seed data.
- **REQ-018 (Audit Trail)**: WHEN any lesson mutation commits THEN exactly ONE `audit_logs` row (`AuditService.createAuditLog`, `backend/services/admin/audit.service.ts:82`, `tx` REQUIRED) with `entityType: "lesson"` and action `Create`/`Update`/`Delete` (`backend/enum/audit/audit-action-type.enum.ts:6-14`) SHALL commit atomically WITH the mutation; a failed mutation mints nothing (zero-write denial oracle asserted in tests).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BFLA — Admin-Only Mutation Gate)**: WHEN any of `createLesson`/`updateLesson`/`deleteLesson` is invoked THEN the Pothos field SHALL carry `authScopes: { role: [UserRole.Admin] }` (VALUE-imported enum), such that anonymous callers AND authenticated non-admin callers (student/teacher/parent) receive `FORBIDDEN` (403) before any resolver body or service executes (the `role` scope returns false for both; `backend/graphql/pothos/builder.ts:28-42`). The ticket's "Non-admin attempts lesson CRUD — 403" scenario SHALL be proven for every non-admin role via the roles test matrix; the resolver keeps the `if (!ctx.user) throw new UnauthorizedError` TS-narrowing prelude (unreachable in practice — mirrors `backend/graphql/mutation/plan-catalog.mutation.ts`).
- **REQ-031 (BOPLA — Whitelist Mapping)**: WHEN input is mapped to Drizzle writes THEN the service SHALL copy `title`/`planId` one-by-one from the whitelisted `LessonSubmitInput`; NEVER spread `{ ...input }` into inserts/updates. Client-supplied `id`, `createdAt`, `updatedAt`, or any extra field SHALL be structurally impossible (`LessonSubmitInput` omits them) and runtime-smuggled extras SHALL be ignored (BOPLA probe asserted via `Object.defineProperty` in the service test, mirroring `backend/db/test/logic/billing/plan-catalog.service.test.ts:695`).
- **REQ-032 (BOLA / IDOR & Data Sensitivity)**: WHEN any lesson operation resolves identity THEN the actor SHALL come exclusively from `ctx.user.id` (never args). Lesson ids are non-sensitive curriculum identifiers whose enumeration reveals only lesson titles — so a bad lesson id yields `LESSON_NOT_FOUND` (not `FORBIDDEN`); this existence-oracle ruling is documented so sensitive resources do not inherit it by copy-paste (mirrors the plans-catalog ruling).
- **REQ-033 (Read-Surface Least Privilege)**: WHEN `planLessons` executes THEN it SHALL require an authenticated context and expose ONLY `{ id, planId, title, createdAt, updatedAt }`; no user data, financial data, or governance state SHALL be joined into the payload. No LIKE/search input exists on any lesson operation — `escapeLikeWildcards` is documented as not-applicable (any future search endpoint MUST use it).
- **REQ-034 (Abuse & Rate Posture)**: WHEN lesson reads/mutations execute THEN they SHALL inherit the platform's global GraphQL rate-limit posture; no new public endpoint warrants additional limiting; the per-plan list is bounded by curriculum size (tens of rows — no pagination required; the ruling is documented so unbounded growth revisits it).
- **REQ-035 (Defense in Depth)**: WHEN any path attempts to write a lesson row whose `plan_id` references a missing plan THEN the FK `lessons_plan_id_plans_id_fkey` (`backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:422`) SHALL reject it at the database layer independently of service validation; the `varchar(255)` column ceiling backstops the title-length rule.

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Single-Statement Write Discipline)**: WHEN any lesson mutation executes THEN all writes SHALL be single statements (create = ONE INSERT; update = ONE guarded UPDATE … WHERE id RETURNING; delete = ONE guarded DELETE … WHERE id RETURNING); no SELECT-then-UPDATE TOCTOU window exists; a zero-row result IS the not-found signal.
- **REQ-041 (Transaction Propagation)**: WHEN any `LessonRepository` method is called THEN it SHALL accept an optional `tx?: DBTransaction` as its last parameter (propagated when supplied), and the service SHALL compose insert/update/delete + audit via `withTransaction(tx, …)` (`backend/lib/db/with-transaction.ts:42`) so future consumers compose them transactionally.
- **REQ-042 (Concurrent Mutation Races)**: WHEN two admins concurrently delete the same lesson (proven via `Promise.allSettled`) THEN exactly ONE call SHALL succeed and the other SHALL receive `LESSON_NOT_FOUND`; the same holds for concurrent update-vs-delete and double-update on one row — PostgreSQL row-level serialization inside the single statements provides the guarantee, no advisory lock or `SELECT FOR UPDATE` required (asserted in repo/service tests).
- **REQ-043 (Progress FK Set-Null Preservation)**: WHEN a lesson with referencing `progress` rows is deleted THEN every progress row SHALL survive with `lesson_id = NULL` (FK contract, `backend/db/schema/classes/progress.ts:26`); the delete mutation returns the removed row for cache eviction; the progress-increment logic (next ticket) must tolerate `lesson_id = NULL` rows — recorded as its forward contract (REQ-071, ledger D2).
- **REQ-044 (FK Violation Error Mapping)**: WHEN a write surfaces an FK violation (pg `23503` on `lessons_plan_id_plans_id_fkey`) THEN the lesson error mapper SHALL fold it into the SAME `ValidationError` planId field error as the pre-write existence check (defense-in-depth parity — the mapper extends the plan-catalog `toPlanWriteDomainError` unique/check mapping at `backend/services/billing/plan-catalog.helpers.ts:94`).

### 2.5 GraphQL & Integration Contracts

- **REQ-050 (LessonPothosObject & Inputs)**: WHEN the lesson type is exposed THEN `backend/graphql/pothos/classes/lesson.pothos.ts` (NEW) SHALL implement `LessonPothosObject = gqlSchemaBuilder.objectRef<LessonReturnType>("Lesson")` backed EXCLUSIVELY by `LessonReturnType` from `@/backend/types` (zero local types), with `id: t.exposeID` (Apollo cache normalization), `planId: t.exposeInt`, `title: t.exposeString` (nullable — legacy rows may carry NULL), `createdAt`/`updatedAt: t.string` resolved via `toISOString()` (mirrors `backend/graphql/pothos/billing/plan.pothos.ts:57-96`), plus `CreateLessonInput` (`planId: Int!`, `title: String!`) and `UpdateLessonInput` (`planId: Int`, `title: String` — both optional).
- **REQ-051 (SDL Surface, Registration & Codegen Parity)**: WHEN the schema ships THEN the Query root SHALL gain `planLessons` (registered in `backend/graphql/query/classes/index.ts` via side-effect import of NEW `lesson.query.ts`) and the Mutation root SHALL gain `createLesson`/`updateLesson`/`deleteLesson` (registered in `backend/graphql/mutation/classes/index.ts` via side-effect import of NEW `lesson.mutation.ts`); the classes Pothos barrel (`backend/graphql/pothos/classes/index.ts`) re-exports the new object/inputs; `bun run generate:gqlSchema && bun codegen` runs once and the committed `frontend/graphql/generated/schema.graphql` parity assertion (mirroring `backend/graphql/test/plan-catalog.schema.test.ts:61-69`) SHALL pass. ID arguments use STRICT numeric coercion — `LessonService.coerceLessonId` mirrors `PlanCatalogService.coercePlanId` (`backend/services/billing/plan-catalog.service.ts:67`), and `planLessons` reuses `PlanCatalogService.coercePlanId` for its `planId: ID!` argument (single source of truth for plan-id parsing).
- **REQ-052 (Frontend Documents)**: WHEN the admin UI consumes the surface THEN `frontend/graphql/sharedDocuments/classes/lesson.documents.ts` (NEW sub-directory `classes/` — on disk `sharedDocuments/` currently has only `admin/`, `auth/`, `billing/`, `notifications/`, `parents/`, `scheduling/`, `students/`, `teachers/`) SHALL export `planLessonsQueryDocument`, `createLessonMutationDocument`, `updateLessonMutationDocument`, `deleteLessonMutationDocument` as `TypedDocumentNode<{Pascal}Query/{Pascal}Mutation[, Variables]>` with `id` in EVERY selection set; the new barrel registers in `frontend/graphql/sharedDocuments/index.ts` and the sharedDocuments AGENTS.md Layout table; documents contract test (`frontend/graphql/sharedDocuments/documents.contract.test.ts`) stays green.
- **REQ-053 (Error Code Inventory)**: WHEN lesson failures surface THEN the wire SHALL carry exactly: `LESSON_NOT_FOUND` (NotFoundError, `backend/lib/errors.ts:37`), `VALIDATION` with `extensions.fields[]` (`LESSON_TITLE_REQUIRED`, `LESSON_TITLE_TOO_LONG`, `LESSON_PLAN_NOT_FOUND`, `LESSON_PATCH_EMPTY`), `FORBIDDEN` (auth scope), `CONFLICT` (defensive insert-returned-no-rows guard). No other codes are minted.

### 2.6 UX / Navigation & Frontend

- **REQ-060 (Admin Lessons Page)**: WHEN the admin UI ships THEN the route `app/(dashboard)/admin/lessons/page.tsx` (NEW) SHALL gate via `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/lessons" })` (mirrors `app/(dashboard)/admin/plans/page.tsx:33`), render the `LessonsCatalogContainer` client component, and localize `generateMetadata` via `getTranslations(locale).lessonsTranslations`; a co-located `page.test.ts` mirrors the plans page's.
- **REQ-061 (Sidebar Navigation Integration)**: WHEN nav renders THEN the Admin array in `frontend/views/dashboard/nav/navItems.ts` (`:155-183`) SHALL gain `{ route: "/admin/lessons", labelKey: "lessons", Icon: <Outlined icon> }` positioned immediately AFTER the `/admin/plans` entry (`:161`), with the `"lessons"` key added to `DashboardLabels` (`shared/locale/types/dashboard/index.ts:39` neighbors), `dashboardEn` (`shared/locale/en/dashboard/index.ts:15` neighbors — "Lessons"), and `dashboardAr` (`shared/locale/ar/dashboard/index.ts:15` neighbors — Arabic script). NO bottom-nav work exists anywhere (the repo has none).
- **REQ-062 (Admin Management UI Stack)**: WHEN the page renders THEN `frontend/views/admin/lessons/` (NEW) SHALL clone the shipped plans stack structure (`frontend/views/admin/plans/` — catalog container + desktop MUI `Table` + `PlanMobileCardList`-style mobile cards + form dialog + delete confirm dialog + hooks): `useQuery`/`useMutation` imported from `@apollo/client/react`, `useAppTranslation(Lessons)` for strings, theme-callback `sx` styling ONLY (MUI v9 — style props are invalid), per-plan management driven by an `adminPlansQueryDocument`-fed plan selector.
- **REQ-063 (Lessons UI Namespace)**: WHEN UI strings are authored THEN a NEW `lessons` namespace SHALL be wired end-to-end mirroring the `plans` pattern: `shared/locale/namespaces/lessons/lessons.namespace.ts` (`defineNamespace<LessonsLabels>("lessons.lessons", t => t.lessonsTranslations)`), `shared/locale/types/lessons/index.ts` (`LessonsLabels` interface), `shared/locale/en/lessons/index.ts` + `shared/locale/ar/lessons/index.ts` (Arabic-script strings), registry import (`shared/locale/namespaces/registry.ts:25` precedent), `lessonsTranslations: LessonsLabels` on the `Translations` interface (`shared/locale/types/message.ts:31` neighbors) + `en/messages.ts:32`/`ar/messages.ts:32` wiring, and the error-key group `lessonCatalog` (interface + root member mirroring `PlanCatalogErrorsLabels` at `shared/locale/types/errors/labels.ts:8-19`/`:71`, en `:22-33`, ar `:22-33`) — all landing in ONE changeset with the parity suites green.

### 2.7 Journeys & M2 Feed Contract

- **REQ-070 (Journey Ruling — Single-Actor Surface)**: WHEN the cross-actor journey analysis is performed THEN this ticket SHALL be ruled **single-actor**: the Admin is the SOLE mutator of `lessons`, and the only other actor interaction (teacher/student consumption of curriculum state) is read-only over immutable list data with no shared mutable state machine — therefore NO `test/workflows/` journey test ships in this ticket; the denial matrix (REQ-030) is proven by the GraphQL roles test instead (mirroring `backend/graphql/test/plan-catalog.roles.test.ts`). The FIRST cross-actor journey of this domain (student completes session → progress increments → teacher observes next lesson, FR-6.2/FR-6.3) belongs to the Student Progress Tracking & Increment ticket (ledger D2 — resolved pointer).
- **REQ-071 (M2 Feed Contract)**: WHEN the progress ticket builds THEN it SHALL consume THIS ticket's contract unchanged: `LessonRepository.listByPlanId(planId, tx?)` ordered `id ASC` (REQ-015) is THE "next lesson in the curriculum" oracle, `LessonRepository.findById` resolves a student's current lesson, `createTestLesson(tx, planId, overrides)` provisions fixtures, and progress rows with `lesson_id = NULL` (deleted-lesson survivors, REQ-043) are a legitimate mid-curriculum state it must tolerate. This ticket wires NO notification, escrow, or wallet surface.

### 2.8 Non-Functional Requirements

- **REQ-080 (Logging Discipline)**: WHEN lesson operations run THEN happy paths log via `logger.info` (create/delete summary lines, ids only), and every denial logs exactly ONE bounded `logger.logDomainError` entry (code + entity, never the submitted payload) — mirroring `backend/services/billing/plan-catalog.service.ts:70-77`; `console.*` is FORBIDDEN (ESLint errors); frontend uses the established error-surface components, never `console`.
- **REQ-081 (Registration & Auth Unchanged)**: WHEN this ticket ships THEN `registerUser`, login, refresh, and the JWT context contract SHALL remain behaviorally identical — the surface only consumes `ctx.user`/`ctx.locale`/`ctx.role`.

---

## 3. Cross-Actor Workflow Analysis (Actor Table — Journey Discharge Ruling)

| Actor | Role / Permission | Can Do | Cannot Do |
|---|---|---|---|
| Admin | `UserRole.Admin` (role authScope) | create / update / delete lessons; read `planLessons` | — |
| Student | authenticated | read `planLessons(planId)` (curriculum display) | any mutation (403) |
| Teacher | authenticated | read `planLessons(planId)` (FR-6.2 preparation substrate) | any mutation (403) |
| Parent | authenticated | read `planLessons(planId)` (read-only monitoring posture) | any mutation (403) |
| Anonymous | none | — | everything (403 on mutations via role scope; 401 on `planLessons` via authenticated scope) |

**Ordered interaction** (the only interplay over shared state in this ticket): Admin mutates lesson set → authenticated readers observe the new list on next fetch. No state machine, no side-effect fan-out, no second mutator — hence REQ-070's ruling: journey-suite coverage begins with the progress ticket, and this ticket's test surface is the roles matrix + repo/service/SDL tests defined in §5 of `plan.md`.

## 4. Constraints, Assumptions & Success Criteria

### Constraints
- Zero schema delta (REQ-010); `lessons.title` nullable at the DB while REQUIRED at the API (D5 accepts NULL only from legacy/foreign writes); no `position` column (D1).
- Dev seeds must stay idempotent and service-only (`backend/db/seeds/AGENTS.md`).
- All tests run via `bun run test/scripts/run-test.ts <path>` (never raw `bun test` on workflows).

### Success Criteria (Definition of Done)
- [ ] All REQ-001..REQ-081 acceptance criteria pass; the four ticket test scenarios (create ✓, plan-link ✓, non-admin 403 ✓, bad plan_id 422 ✓) are each proven by a named test.
- [ ] `git diff backend/db/schema/** backend/drizzle/**` is empty; quality gates green (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` per file).
- [ ] Traceability audit: every REQ-xxx in this file appears in `tasks.md` (zero misses).
- [ ] `outcome/plan-review-R1.md` records the Phase 1.5 verdict.

### Glossary
| Term | Definition |
|---|---|
| Lesson | A row of `lessons` (`backend/db/schema/classes/lessons.ts:17-30`) — a discrete curriculum unit tied to a plan. |
| Curriculum sequence | The deterministic per-plan ordering `id ASC` (D1) — creation order defines teaching order. |
| Progress survivor | A `progress` row whose `lesson_id` became NULL when its lesson was deleted (FK set-null, REQ-043). |
| Plan-deletion survival | The reason `lessons.plan_id` is nullable: a deleted plan unlinks lessons instead of cascading (D2). |

---

## 6. Traceability Matrix (REQ → design → task)

| REQ | plan.md section | tasks.md task |
|---|---|---|
| REQ-001 | §10 Outcome Protocol | 0.1 |
| REQ-002, REQ-063 | §8 i18n | 1.2 |
| REQ-003 | §4.1 Types | 1.1 |
| REQ-004 | §8 Verification Anchors | 0.2 |
| REQ-010, REQ-015, REQ-043 | §3 Data Models | 0.2, 2.1 |
| REQ-011, REQ-012, REQ-013, REQ-014, REQ-018 | §4.2/§4.3 Service | 2.2 |
| REQ-016, REQ-050, REQ-051 | §5 API Contracts | 3.1–3.4 |
| REQ-017 | §4.4 Seeds | 2.3 |
| REQ-030–REQ-035 | §6 Security | 2.2, 3.4 |
| REQ-040–REQ-044 | §4.5 Concurrency | 2.1, 2.2 |
| REQ-052, REQ-062 | §2 UX/Nav | 4.1, 4.2 |
| REQ-053 | §5.3 Errors | 2.2, 3.4 |
| REQ-060, REQ-061 | §2 UX/Nav | 4.3 |
| REQ-070, REQ-071 | §7 Journey Design | 0.2, 5.1 |
| REQ-080, REQ-081 | §9 Testing/§6 | 2.2, 5.2 |
