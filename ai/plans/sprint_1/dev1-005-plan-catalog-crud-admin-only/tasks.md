# Implementation Tasks — DEV1-005: Plan Catalog CRUD (Admin Only)

> **Ticket:** `[DEV1-005] Plan Catalog CRUD (Admin Only)` (Owner: Dev 1 · Sprint 1 · 3 SP)
> **Plan directory:** `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/`
> **Source of truth:** `specs.md` (REQ-001..REQ-083) + `plan.md` (D1..D8)
> **Blocking dependencies (verified in Phase 0):** DEV1-001, DEV1-002, DEV2-001, DEV2-002

---

## Non-Negotiable Execution Protocol

The executing agent MUST follow this protocol for **every task** — no exceptions:

1. **Pre-Execution Outcome Knowledge Read** — Before touching any file, read the outcome files of prerequisite tasks under `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/` and the AGENTS.md files of every layer being modified.
2. **Post-Edit Quality Loop** — After every file creation/modification, run:
   ```
   bun run scripts/health/sub-loop.ts <file-path> --lifecycle duplicates
   ```
   Exit code MUST be 0 before proceeding. Non-zero → fix and re-run until clean.
3. **Test Execution** — All test files MUST be executed via:
   ```
   bun run test/scripts/run-test.ts <test-path>
   ```
   (the canonical runner location — root AGENTS.md documents `bun run test/scripts/run-test.ts <test-path>` for log-captured runs; no `test/scripts/n.ts` exists — 0.3 gate re-validation). DB-bound tests MUST use `runInRollback` + `tx` propagation + `entity-setup.ts` helpers + `expectRepoError` (never `expect(...).rejects.toThrow()` inside `runInRollback`).
4. **Semantic Review Checklist Self-Review** — Before marking any task `[x]`, the agent self-reviews against: atomicity, env-config correctness, zero dead code, no cross-layer imports (`shared/` purity enforced), enums as **value imports**, logging via `logger` only (never `console.*`), canonical types only (no resolver-local types, no service `.types.ts`), MUI v9 `sx`-only discipline, i18n property-access discipline.
5. **Outcome Documentation** — Every completed task MUST produce `outcome/<task-id>-outcome.md` under the plan directory, recording: what was changed, verification command outputs summary, deviations (if any), and deferred-items implications.
6. **Checkbox Tracking** — Mark `[ ]` → `[x]` only when ALL sub-pipelines of that task are complete and verified.
7. **Deferred-Items Discipline** — Anything not completed in-plan MUST be recorded in `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` with a ❌/⚠️ marker, target ticket, and owner. The pre-seeded D1/D2 are the only sanctioned non-blocking entries at close.

---

## Phase 0: Pre-Implementation Baseline

### Task 0.1 — Error Baseline Recording & Deferred-Items Ledger Initialization

- [x] 0.1 Record implementation baseline and initialize the deferred-items ledger
  - Files to create:
    - `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` (from template)
    - `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/phase0-baseline-outcome.md`
  - Applicable instructions: root `AGENTS.md`; `docs/specs/open-decisions-and-gaps.md`
  - _Requirements: REQ-001_
  - [x] 0.1.1 Run and record baseline error counts as JSON artifacts: `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, `git diff --name-only`
  - [x] 0.1.2 Initialize `deferred-items.md` pre-seeded with:
    - **D1** — Audit-log integration for plan mutations → target **DEV3-020** (non-blocking; hook points only in this ticket)
    - **D2** — Purchase-time active-plan re-validation (`is_active = true` inside purchase transaction) → target **DEV1-006** (non-blocking forward contract; this ticket ships the predicate)
  - [x] 0.1.3 Write `outcome/phase0-baseline-outcome.md` capturing baseline counts verbatim (numbers must be comparable at Phase 7 final-delta check, REQ-083)
  - [x] 0.1.SR **Semantic Review**: baseline artifacts exist and are machine-comparable; ledger matches template structure — VERIFIED: outcome file records tsgo=0 / biome warn=0 / lint exitCode=1 (empty diagnostics) verbatim; raw artifacts written to /tmp; ledger table columns and status legend match the deferred-items template
  - [x] 0.1.IV **Instruction Verification**: confirm the ledger template and baseline commands against root AGENTS.md — VERIFIED: ledger matches `.agents/spec-process-guide/templates/deferred-items-template.md` (columns ID|Deferred Item|Source Task|Target Task|Status|Verified By|Notes + ✅/⚠️/❌/🔄 legend); commands confirmed against AGENTS.md: `bun run tsgo` (Essential Commands), `bun biome:check` (safe concurrent formatter, wraps `check --write --unsafe .` hence pre/post diff capture), `lint-service.ts --json --id` (Lint Service section, exit codes 0/1/2); AGENTS.md cache rule (NEVER CLEAR CACHES) respected

### Task 0.2 — Prerequisite & Dependency Guard Verification

- [x] 0.2 Verify all blocking-dependency artifacts exist before domain work starts
  - Files to read (no modification): `backend/db/schema/billing/plans.ts`, `backend/types/billing/plan.types.ts`, `backend/services/` (registration service from DEV1-002), `backend/graphql/pothos/builder.ts` (the `gqlSchemaBuilder` export), `shared/locale/` structure
  - _Requirements: REQ-004_
  - [x] 0.2.1 Verify DEV1-001 artifacts: `plans` table present with `plans_session_count_check`, `plans_price_check`, `plans_interval_days_check`; `paymentGateway`/`subscriptionStatus` enums exist; `PlanSelectType`/`PlanInsertType` exist in `backend/types/billing/plan.types.ts`
  - [x] 0.2.2 Verify DEV1-002 artifacts: `registerUser`/`createAdminUser` service paths exist; `isUniqueViolation`-style cause-chain translation precedent located for reuse pattern (REQ-052)
  - [x] 0.2.3 Verify DEV2-001 artifacts: JWT context factory producing `ctx.user` / `ctx.role` / `ctx.locale`; `withPageAuth({ roles, redirectTo })` server guard contract
  - [x] 0.2.4 Verify DEV2-002 artifacts: `role` authScope with OR semantics and fail-closed evaluation in `backend/graphql/pothos/builder.ts` (the `gqlSchemaBuilder` export — path corrected by the 0.3 gate; no file named `gqlSchemaBuilder.ts` exists); `authenticated` scope → `UnauthorizedError` (401)
  - [x] 0.2.5 Verify the DEV1-004 guarded-update DESIGN reference exists (`ai/plans/sprint_0/dev1-004-free-trial-session-provisioning/plan.md`) as the documented pattern source for REQ-014/015 — pattern reference ONLY per the 0.3 gate ruling on deferred-item D3 (resolution path a): the guarded UPDATE is fully specified by REQ-014/015 + plan.md D2/§4.2 and does NOT depend on DEV1-004 code being merged (no `grantFreeTrialOnce` symbol exists in this repo state) — VERIFIED by the 0.3 gate: the sprint_0 DEV1-004 plan doc exists (specs/plan/tasks/prototype/deferred-items present on disk); REQ-014/015 + D2/§4.2 carry the normative SQL; cell was redefined by the gate ruling and is now satisfiable
  - [x] 0.2.6 IF any artifact is missing → record a ❌ entry in `deferred-items.md` and BLOCK dependent tasks; otherwise record verification evidence
  - [x] 0.2.SR **Semantic Review**: every dependency cell has verifiable evidence (file path + symbol), not assumptions
  - [x] 0.2.IV **Instruction Verification**: `docs/specs/open-decisions-and-gaps.md` re-read to confirm REQ-081 addendum authorization for the schema delta (A-category)
  - [x] 0.2.OD **Outcome**: `outcome/0.2-prerequisite-verification-outcome.md`

### Task 0.3 — Plan-Review Gate (Phase 1.5 Gate)

- [x] 0.3 Plan-review gate executed and outcome recorded BEFORE any implementation begins
  - _Requirements: REQ-083 ("the plan-review gate outcome SHALL exist before implementation")_
  - [x] 0.3.1 Run `@plan-review` against `specs.md` + `plan.md`; record verdict and required adjustments
  - [x] 0.3.2 Apply any required spec/plan adjustments as a pre-implementation amendment (with change log entry)
  - [x] 0.3.OD **Outcome**: `outcome/plan-review-gate-outcome.md` — implementation is BLOCKED until this file exists

---

## Phase 1: Types, Enums & Database Schema

### Task 1.1 — Drizzle Schema Delta: Plan Lifecycle Columns

- [x] 1.1 Implement the `plans` table schema delta (`is_active`, `deactivated_at`)
  - Files to modify:
    - `backend/db/schema/billing/plans.ts` (add two columns; CHECK constraints untouched)
  - Applicable AGENTS.md: `backend/db/schema/AGENTS.md` (note: no `backend/db/AGENTS.md` exists — corrected by 0.3 gate); instruction docs: `docs/DATABASE_MIGRATIONS.md`
  - _Requirements: REQ-010, REQ-042_
  - [x] 1.1.1 Add `isActive: boolean("is_active").notNull().default(true)` and `deactivatedAt: timestamp("deactivated_at")` to `pgTable("plans", ...)` — NO new enums, NO new indexes (no-index ruling per REQ-010 decision note)
  - [x] 1.1.2 Apply via `bun run db push` ONLY (`db reset` / `db cleanGenerate` permanently disabled); capture the push log
  - [x] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/schema/billing/plans.ts --lifecycle duplicates` (exit 0)
  - [x] 1.1.TE **Test Engineering**: DB column-presence test in `backend/db/test/logic/billing/plan-catalog-schema.test.ts` asserting `is_active` (NOT NULL, default true) and `deactivated_at` (NULL default) via information_schema probes inside `runInRollback`; assert existing CHECK constraints still reject invalid direct writes (Tier 2 boundary + Tier 3 chaos entry-point for 1.2)
  - [x] 1.1.SEC **Security & Tenancy Audit**: confirm default `true` backfills existing rows non-destructively (zero data-loss); confirm no new writable surface exposed (columns server-controlled only)
  - [x] 1.1.SR **Semantic Review**: schema change and runtime code land in the same commit set (no drift); no raw SQL migration; `$inferSelect`/`$inferInsert` automatically flow the new fields (verify via tsgo downstream)
  - [x] 1.1.IV **Instruction Verification**: `docs/DATABASE_MIGRATIONS.md` compliance (push-only, no custom SQL)
  - [x] 1.1.OD **Outcome**: `outcome/1.1-schema-delta-outcome.md`

### Task 1.2 — Canonical Types Extension

- [x] 1.2 Extend canonical billing plan types (`PlanReturnType`, `PlanSubmitInput`, `PlanUpdateInput`)
  - Files to modify:
    - `backend/types/billing/plan.types.ts` (extend — NO new file; barrel already re-exports `./plan.types`)
  - Applicable AGENTS.md: `backend/types/AGENTS.md`
  - _Requirements: REQ-003, REQ-022, REQ-031_
  - [x] 1.2.1 Add `PlanReturnType = PlanSelectType` (identity — plans carry no forbidden fields)
  - [x] 1.2.2 Add `PlanSubmitInput` interface with readonly fields: `title: string`, `sessionCount: number`, `price: string` (decimal string), `currency: string`, `intervalDays: number` — structurally omitting `id`, `isActive`, `deactivatedAt`, `createdAt`, `updatedAt` (BOPLA by type construction)
  - [x] 1.2.3 Add `PlanUpdateInput` as a strict mapped partial over `PlanSubmitInput`
  - [x] 1.2.4 Verify `DBTransaction`/`DBQueryExecutor` NOT redefined here — they are imported from `@/backend/types` by consumers only
  - [x] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/billing/plan.types.ts --lifecycle duplicates` (exit 0)
  - [x] 1.2.TE **Test Engineering**: Tier 1 type-level proof via tsgo (new columns present on `PlanSelectType`); compile-level negative assertions (assigning `isActive` into `PlanSubmitInput` fails type-check — documented via `// @ts-expect-error` assertion block in a type test file `backend/types/billing/plan.types.test-d.ts` or equivalent established pattern)
  - [x] 1.2.SEC **Security & Tenancy Audit**: BOPLA — server-controlled fields structurally absent from both input types; money discipline — `price` is `string`, never `number`/`Float` (REQ-022)
  - [x] 1.2.SR **Semantic Review**: no local types outside `backend/types/`; no service-layer `.types.ts` file created anywhere in this ticket
  - [x] 1.2.IV **Instruction Verification**: `backend/types/AGENTS.md` canonical naming rules honored (`{{Entity}}SelectType/InsertType/ReturnType/SubmitInput`)
  - [x] 1.2.OD **Outcome**: `outcome/1.2-canonical-types-outcome.md`

### Task 1.3 — i18n: `errors.planCatalog` Grouping (EN/AR/Types)

- [x] 1.3 Add `planCatalog` error-message grouping to the `errors` namespace
  - Files to modify:
    - `shared/locale/types/errors/index.ts` (add `planCatalog` interface group: `planNotFound`, `planAlreadyInactive`, `planAlreadyActive`, `planTitleRequired`, `planTitleTooLong`, `planSessionCountInvalid`, `planPriceInvalid`, `planCurrencyInvalid`, `planIntervalDaysInvalid`, `planPatchEmpty`)
    - `shared/locale/en/errors/index.ts` (English implementations)
    - `shared/locale/ar/errors/index.ts` (Arabic implementations — natural RTL phrasing)
  - Applicable AGENTS.md: `shared/locale/AGENTS.md`
  - _Requirements: REQ-002, REQ-050, REQ-051_
  - [x] 1.3.1 Implement types interface group first (compile-time `ErrorsLabels` interface parity is the gate)
  - [x] 1.3.2 Implement EN messages (localized, user-facing, domain-error-safe phrasing — no internal/SQL hints)
  - [x] 1.3.3 Implement AR messages (natural translations; no machine-translated artifacts)
  - [x] 1.3.4 Run `bun tsgo` — parity gate MUST pass (missing key = tsgo failure)
  - [x] 1.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts shared/locale/types/errors/index.ts --lifecycle duplicates` (exit 0); repeat for both locale implementation files
  - [x] 1.3.TE **Test Engineering**: locale parity test — enumerate all `planCatalog` keys and assert EN/AR/type-shape alignment (ar/en structural equality assertion per existing locale test patterns)
  - [x] 1.3.SEC **Security & Tenancy Audit**: messages contain no internal identifiers, constraint names, SQL fragments, or stack hints (error disclosure confidentiality, REQ-052/050)
  - [x] 1.3.SR **Semantic Review**: `shared/` purity — zero imports from `@/frontend/**`, `@/backend/**`, `@/app/**`; no `next-intl`; no `shared/messages/` references
  - [x] 1.3.IV **Instruction Verification**: `shared/locale/AGENTS.md` property-access and namespace registration rules
  - [x] 1.3.OD **Outcome**: `outcome/1.3-errors-i18n-outcome.md`

### Task 1.4 — i18n: New `plans` UI Namespace (Full Registration Procedure)

- [x] 1.4 Register the `plans` UI namespace end-to-end per `shared/locale/AGENTS.md`
  - Files to create/modify:
    - `shared/locale/types/plans/index.ts` (NEW — labels interface: page title, table headers, status chips `active`/`inactive`, create/edit dialog labels, field labels, empty/error states, confirm-deactivate/reactivate copy, submit/loading/success states)
    - `shared/locale/namespaces/plans/plans.namespace.ts` + `shared/locale/namespaces/plans/index.ts` (NEW — `Plans` handle via `defineNamespace`, pattern per `shared/locale/namespaces/dashboard/`; exported through `shared/locale/namespaces/index.ts`)
    - `shared/locale/en/plans/index.ts` (NEW)
    - `shared/locale/ar/plans/index.ts` (NEW)
    - `shared/locale/types/message.ts` (add `plansTranslations` entry to the `Translations` interface)
    - Locale server namespace-path registration map (add `plans` path per `shared/locale/AGENTS.md` procedure)
  - Applicable AGENTS.md: `shared/locale/AGENTS.md`
  - _Requirements: REQ-002, REQ-051, REQ-054_
  - [x] 1.4.1 Author the types interface with complete key coverage for every UI surface planned in Phase 4 (table, chips, dialogs, toasts, empty/error states, confirm copy)
  - [x] 1.4.2 Author EN implementation; author AR implementation (RTL-safe phrasing, no truncation-prone hardcoded width assumptions coupled to copy)
  - [x] 1.4.3 Register `plansTranslations` in the `Translations` interface (`shared/locale/types/message.ts`), aggregate label consts into `shared/locale/en/messages.ts` + `shared/locale/ar/messages.ts`, and create the `Plans` namespace handle (`defineNamespace<PlansLabels>` in `shared/locale/namespaces/plans/`, exported via `shared/locale/namespaces/index.ts`)
  - [x] 1.4.4 Run `bun tsgo` (parity gate) — MUST pass
  - [x] 1.4.QL **Quality Loop**: sub-loop on every created/modified locale file (exit 0)
  - [x] 1.4.TE **Test Engineering**: parity test asserting every EN key exists in AR and matches type shape; verify `getTranslations(locale)` exposes `t.plansTranslations.*` on the server and `useAppTranslation(Plans)` resolves on the client (test-lineage only; wiring proven in Phase 4)
  - [x] 1.4.SEC **Security & Tenancy Audit**: plan *content* (`title`) documented as admin-authored DATA, not translation keys — no key-space pollution
  - [x] 1.4.SR **Semantic Review**: property-access convention only; the `Plans` namespace handle used (import path verified in Phase 4); no hardcoded strings anywhere
  - [x] 1.4.IV **Instruction Verification**: every step of the `shared/locale/AGENTS.md` new-namespace procedure executed in order
  - [x] 1.4.OD **Outcome**: `outcome/1.4-plans-i18n-outcome.md`

### Task 1.5 — Phase 1 Seed Bootstrap Contract (Service-Only Pattern Declaration)

- [x] 1.5 Pre-stage the seed-parity contract for the demo catalog (implementation lands in Phase 3 after the service exists)
  - Files to read: `backend/db/seeds/AGENTS.md`
  - _Requirements: REQ-019, REQ-021_
  - [x] 1.5.1 Document the exact demo catalog fixtures to be provisioned in Phase 3.5: (a) one Hifz Jadid plan, (b) one Tajweed plan, (c) "New Teacher Verification & Evaluation Plan" with `sessionCount = 5` (FR-2.3), (d) one deactivated demo plan — all via service find-or-create by stable title lookup, idempotent on re-run
  - [x] 1.5.2 Verify `backend/db/seeds/AGENTS.md` service-bootstrap rule (never raw `@/backend/db/**` imports from seeders)
  - [x] 1.5.SR **Semantic Review**: the declared fixtures will exercise the FULL lifecycle (incl. deactivated state) so dev/demo environments prove INV-PC1 visibility filtering
  - [x] 1.5.IV **Instruction Verification**: seeds AGENTS.md contract confirmed before Phase 3.5 starts
  - [x] 1.5.OD **Outcome**: `outcome/1.5-seed-contract-outcome.md`

---

## Phase 2: Repositories & Backend Services

### Task 2.1 — `entity-setup.ts` Test Helper: `createTestPlan`

- [x] 2.1 Add `createTestPlan` (and `createTestPlanWithSubscription` linkage fixture) to entity-setup helpers
  - Files to modify:
    - `backend/db/test/entity-setup.ts` (verify exact existing signatures FIRST per rule 17; unique suffixes via `randomUUID()`)
  - Applicable AGENTS.md: `backend/db/test/AGENTS.md` (note: no `backend/db/AGENTS.md` exists — corrected by 0.3 gate)
  - _Requirements: REQ-070, REQ-071, REQ-075_
  - [x] 2.1.1 Add `createTestPlan(overrides, tx)` helper creating a plan row with randomized unique title
  - [x] 2.1.2 Add (or verify existing) subscription/balance fixture linkage helpers needed by the REQ-075 byte-identical preservation proof (subscription row + student balance lane referencing a plan)
  - [x] 2.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/test/entity-setup.ts --lifecycle duplicates` (exit 0)
  - [x] 2.1.TE **Test Engineering**: helper self-test — create two plans with helpers inside `runInRollback`, assert unique IDs/titles, assert rollback leaves zero residue
  - [x] 2.1.SEC **Security & Tenancy Audit**: helpers never bypass validation via unsafe defaults; all writes go through `tx`
  - [x] 2.1.SR **Semantic Review**: no seed data used; helpers compose existing entity factories rather than duplicating them (duplicates lifecycle clean)
  - [x] 2.1.IV **Instruction Verification**: verify signatures against existing callers per rule 17 before adding overloads
  - [x] 2.1.OD **Outcome**: `outcome/2.1-entity-setup-outcome.md`

### Task 2.2 — `PlanRepository` Implementation

- [x] 2.2 Implement `backend/db/repo/billing/plan.repository.ts`
  - Files to create:
    - `backend/db/repo/billing/plan.repository.ts` (NEW)
    - `backend/db/repo/billing/index.ts` (create-or-extend barrel per existing `billing/` domain layout)
  - Applicable AGENTS.md: `backend/db/repo/AGENTS.md`; instruction docs: `docs/drizzle/prepared-statements.md`
  - _Requirements: REQ-014, REQ-015, REQ-016, REQ-040, REQ-041, REQ-042_
  - [x] 2.2.1 Implement `insertPlan(insert: PlanInsertType, tx?: DBTransaction): Promise<PlanSelectType>` — single INSERT … RETURNING
  - [x] 2.2.2 Implement `updatePlanFields(id, patch, tx?): Promise<PlanSelectType | null>` — single UPDATE … RETURNING with server-side `updatedAt: new Date()`; empty-returned rows → `null`
  - [x] 2.2.3 Implement `setActiveStatusOnce(id, target, tx?): Promise<PlanSelectType | null>` — the guarded conditional UPDATE (D2):
    ```ts
    .set({ isActive: target, deactivatedAt: target ? null : new Date(), updatedAt: new Date() })
    .where(and(eq(plans.id, id), eq(plans.isActive, !target)))
    .returning()
    ```
    No `sql` template (no inline-comment hazard); full Drizzle parameterization; NO SELECT-then-UPDATE
  - [x] 2.2.4 Implement `existsById(id, tx?): Promise<boolean>` — read-only post-guard disambiguation probe (D3)
  - [x] 2.2.5 Implement `listActive(tx?)` — `WHERE is_active = true ORDER BY created_at ASC` — **THE single active predicate** (REQ-016); and `listAll(tx?)` — `ORDER BY created_at ASC`
  - [x] 2.2.6 Non-transactional reads use `queryDb(tx)` Neon-HTTP-eligible pattern; `tx` is the LAST parameter everywhere; NO `inArray`; NO module-level mutable state
  - [x] 2.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/billing/plan.repository.ts --lifecycle duplicates` (exit 0)
  - [x] 2.2.TE **Test Engineering**: `backend/db/test/logic/billing/plan-catalog.repository.test.ts` — 4-Tier:
    - Tier 1: every method happy path inside `runInRollback` with `tx` propagation position-verified per signature
    - Tier 2: boundary — `updatePlanFields` on nonexistent id returns `null`; `listActive` excludes deactivated rows; `listAll` includes them; ordering `created_at ASC` proven with three fixtures
    - Tier 3: chaos — `setActiveStatusOnce` double-guard: second identical transition returns `null` (empty RETURNING), row transitioned exactly once
    - Tier 4: security — direct-write CHECK bypass attempts (`session_count <= 0`, `price < 0`, `interval_days <= 0`) rejected at DB layer, asserted via `expectRepoError` try/catch (REQ-035)
  - [x] 2.2.SEC **Security & Tenancy Audit**: all queries Drizzle-parameterized; no LIKE/search surface (`escapeLikeWildcards` documented N/A); guarded update is the ONLY mutation primitive for state (TOCTOU window = 0)
  - [x] 2.2.SR **Semantic Review**: zero business rules/translations/log strings in the repository; `DBTransaction` imported from `@/backend/types` only; single-statement writes (no explicit transaction needed, REQ-041); methods composable via optional `tx` for future DEV1-009 consumers
  - [x] 2.2.IV **Instruction Verification**: `backend/db/repo/AGENTS.md` (`queryDb(tx)` pattern, tx-last convention, prepared-statement read-path rules) + `docs/drizzle/prepared-statements.md`
  - [x] 2.2.OD **Outcome**: `outcome/2.2-plan-repository-outcome.md`

### Task 2.3 — `PlanCatalogService` Implementation

- [x] 2.3 Implement `backend/services/billing/plan-catalog.service.ts`
  - Files to create:
    - `backend/services/billing/plan-catalog.service.ts` (NEW)
    - `backend/services/billing/index.ts` (create-or-extend barrel per existing layout)
  - Applicable AGENTS.md: `backend/services/AGENTS.md`; instruction docs: `docs/graphql/domain-error-extensions-code.md`
  - _Requirements: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017, REQ-018, REQ-031, REQ-032, REQ-040, REQ-050, REQ-051, REQ-052, REQ-053_
  - [x] 2.3.1 Implement module-scope pure `validatePlanInput(input, tErrors)` — collects field-error map, throws ONE `ValidationError` with `extensions.fields[]` (`{field, code, message}` localized): title trim/≤255, `sessionCount` integer ≥1, `price` regex `^\d{1,8}(\.\d{1,2})?$` (module-level const), `currency` regex `^[A-Z]{3}$`, `intervalDays` integer ≥1
  - [x] 2.3.2 Implement `createPlan(input, locale, tx?)` — validate BEFORE any write → explicit field-by-field insert mapping (`title: input.title.trim()`, …) with NO `{ ...input }` spread; `isActive`/`deactivatedAt`/timestamps never mapped from input → `PlanRepository.insertPlan(insert, tx)` → catch-path `23505`/`23514` cause-chain translation to localized `ValidationError` (DEV1-002 `isUniqueViolation` precedent; REQ-052)
  - [x] 2.3.3 Implement `updatePlan(id, patch, locale, tx?)` — id coercion (positive integer; invalid → `ValidationError`) → empty-patch → `VALIDATION` (`planPatchEmpty`) → validate every supplied field → whitelist patch key-by-key → repo `updatePlanFields` → `null` → `NotFoundError("PLAN", …)` (entity name only — double-suffix rule)
  - [x] 2.3.4 Implement `setPlanActiveStatus(id, isActive, locale, tx?)` — id validation → `setActiveStatusOnce` (guarded) → `null` return → `existsById` probe → `false` → `NotFoundError("PLAN", …)`; `true` → `ConflictError` with custom code `PLAN_ALREADY_INACTIVE` / `PLAN_ALREADY_ACTIVE` (REQ-050 map) → `logger.logDomainError` with `{ code, entity: "plans", entityId: id }`. NOTE (0.3 gate): extend `backend/lib/errors.ts` `ConflictError` with the overloaded custom-code constructor mirroring `ValidationError` (default `CONFLICT` preserved) — add `backend/lib/errors.ts` to this task's change set
  - [x] 2.3.5 Implement `listActiveCatalog(locale, tx?)` → `PlanRepository.listActive(tx)`; `listForAdmin(includeInactive, locale, tx?)` → `includeInactive ? listAll(tx) : listActive(tx)` (single-predicate consumption)
  - [x] 2.3.6 All expected rejections via `logger.logDomainError`; unexpected via `logger.error`; NO `console.*`; log payloads limited to plan id + code (REQ-053)
  - [x] 2.3.7 Emit the DEV3-020 audit hook seam (`logger.info` + marked comment) after every successful transition — D1 deferred-item linkage; NO `audit_logs` writes
  - [x] 2.3.8 Physical zero-import guarantee: the service file contains NO imports of `subscriptions`, `student_subscriptions`, `student_payments`, `students`, `wallet`, `teacher_transaction` tables (grep-verifiable forward-only/no-cascade proof, REQ-017/018)
  - [x] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/billing/plan-catalog.service.ts --lifecycle duplicates` (exit 0)
  - [x] 2.3.TE **Test Engineering**: `backend/db/test/logic/billing/plan-catalog.service.test.ts` — 4-Tier:
    - Tier 1 (branch/statement): every guard branch of REQ-012; both zero-row branches of guarded updates (NotFound vs Conflict disambiguation); every error class thrown with correct `extensions.code`
    - Tier 2 (boundary, full REQ-073 matrix): title empty / whitespace-only / 255 (pass) / 256 (fail); `sessionCount` 0 (fail), 1 (pass), −1 (fail), non-integer (fail); `price` `"0.00"` (pass), `"-0.01"` (fail), `"abc"` (fail), `"1.005"` (fail), `"99999999.99"` (pass), `"100000000.00"` (fail); `currency` `"EGP"` (pass), `"egp"` (fail), `"EG"` (fail); `intervalDays` 0 (fail), 1 (pass); empty patch (fail); nonexistent id update (PLAN_NOT_FOUND)
    - Tier 3 (chaos): `Promise.allSettled` double-deactivation → exactly one success + one `PLAN_ALREADY_INACTIVE` with row transitioned exactly once; deactivate/reactivate round-trip; concurrent `updatePlan` patches converge last-write-wins without error
    - Tier 4 (security): BOPLA smuggle test — extra `id`/`isActive`/`createdAt` fields on input ignored by construction; `23514` escape path translated via cause-chain (never raw SQL, never 500)
  - [x] 2.3.SEC **Security & Tenancy Audit**: BOLA — identity comes from caller context only (service receives no actor input); BOPLA — grep-level audit proves zero `{ ...input }` spreads reach DB calls; error disclosure — no constraint names/SQL surface in any thrown message
  - [x] 2.3.SR **Semantic Review**: errors localized via `getServerTranslations(locale).errorsTranslations`; `DomainError` subclasses only (plain `new Error` prohibited); no cross-layer imports; no service `.types.ts`; zero dead code
  - [x] 2.3.IV **Instruction Verification**: `backend/services/AGENTS.md` + `docs/graphql/domain-error-extensions-code.md` error map honored verbatim
  - [x] 2.3.OD **Outcome**: `outcome/2.3-plan-catalog-service-outcome.md`

### Task 2.4 — Phase 2.M Mid-Point Review Gate

- [x] 2.4 Mid-point review of all Phase 1–2 artifacts before GraphQL exposure
  - _Requirements: REQ-070, REQ-077 (partial gate)_
  - [x] 2.4.1 Re-run `bun tsgo`, `bun biome:check` — compare against Phase 0 baseline (zero NEW errors allowed)
  - [x] 2.4.2 Verify coverage so far: `bun test --coverage` on repository + service suites — target 100% statements/branches on new files
  - [x] 2.4.3 Verify the REQ-016 single-predicate rule by grep: the `is_active = true` filter exists in EXACTLY ONE place (`PlanRepository.listActive`)
  - [x] 2.4.4 Verify REQ-017/018 zero-import guarantee by grep on the service file
  - [x] 2.4.5 Resolve or defer any findings into `deferred-items.md` with owners before Phase 3 begins
  - [x] 2.4.SR **Semantic Review**: full Phase 1–2 diff reviewed against canonical-type discipline, repo AGENTS.md conventions, and transaction rules
  - [x] 2.4.IV **Instruction Verification**: `docs/specs/state-machine-invariants.md` re-read — confirm plan lifecycle addendum targets (INV-PC1..PC3) still match the implementation shape
  - [x] 2.4.OD **Outcome**: `outcome/2.4-mid-point-review-outcome.md` — Phase 3 is BLOCKED until this file exists with a pass verdict

---

## Phase 3: GraphQL Resolvers & API Handlers

### Task 3.1 — Canonical `PlanPothosObject`

- [ ] 3.1 Implement the single canonical Pothos object for `Plan`
  - Files to create:
    - `backend/graphql/pothos/billing/plan.pothos.ts` (NEW)
    - `backend/graphql/pothos/billing/index.ts` (create-or-extend barrel)
  - Applicable AGENTS.md: `backend/graphql/AGENTS.md`
  - _Requirements: REQ-003, REQ-022, REQ-060_
  - [ ] 3.1.1 Define `PlanPothosObject = gqlSchemaBuilder.objectRef<PlanReturnType>("Plan").implement(...)` with explicit `t.expose*` fields: `id` (exposed as `ID!` — CRITICAL for Apollo normalization), `title`, `sessionCount` (Int), `price` (**String!** — no Float anywhere), `currency`, `intervalDays`, `isActive` (Boolean!), `deactivatedAt` (DateTime, nullable), `createdAt`, `updatedAt` (DateTime!)
  - [ ] 3.1.2 Back the object EXCLUSIVELY by `PlanReturnType` from `@/backend/types` — zero resolver-local types
  - [ ] 3.1.3 Top-level static imports only (Bun ESM rule — no `await import()`)
  - [ ] 3.1.QL **Quality Loop**: sub-loop on the new file (exit 0)
  - [ ] 3.1.TE **Test Engineering**: schema-shape assertion (post-codegen) that `Plan` SDL matches REQ-060 exactly, including `price: String!` and nullable `deactivatedAt`
  - [ ] 3.1.SEC **Security & Tenancy Audit**: object exposes NO user/financial/governance joins (least-privilege payload, REQ-033)
  - [ ] 3.1.SR **Semantic Review**: DateTime scalars consistent with existing billing Pothos objects; no field-level business logic in the object
  - [ ] 3.1.IV **Instruction Verification**: `backend/graphql/AGENTS.md` object-definition rules (id exposure, canonical-type backing)
  - [ ] 3.1.OD **Outcome**: `outcome/3.1-plan-pothos-outcome.md`

### Task 3.2 — Catalog Queries (`planCatalog`, `adminPlans`)

- [ ] 3.2 Implement `backend/graphql/query/plan-catalog.query.ts`
  - Files to create:
    - `backend/graphql/query/plan-catalog.query.ts` (NEW)
    - Update the query domain barrel with a side-effect import per existing `backend/graphql` layout
  - Applicable AGENTS.md: `backend/graphql/AGENTS.md`
  - _Requirements: REQ-016, REQ-030, REQ-033, REQ-034, REQ-060_
  - [ ] 3.2.1 `planCatalog: [Plan!]!` with `authScopes: { authenticated: true }` → `PlanCatalogService.listActiveCatalog(ctx.locale)` — anonymous receives `UNAUTHORIZED` via scopeAuth
  - [ ] 3.2.2 `adminPlans(includeInactive: Boolean = true): [Plan!]!` with `authScopes: { authenticated: true, role: [UserRole.Admin] }` (`UserRole` as VALUE import) → `PlanCatalogService.listForAdmin(includeInactive ?? true, ctx.locale)`; nullable-hardened arg handling per Pothos input rules
  - [ ] 3.2.3 Resolvers remain thin: resolve args → service call → return; zero business logic, zero repository calls
  - [ ] 3.2.QL **Quality Loop**: sub-loop on the new file (exit 0)
  - [ ] 3.2.TE **Test Engineering**: integration tests via `setupTestServerLifecycle` + `testClient`: active-only filtering proven (deactivated fixture absent from `planCatalog`, present in `adminPlans`); `includeInactive: false` path on `adminPlans`; role cells per REQ-064 matrix
  - [ ] 3.2.SEC **Security & Tenancy Audit**: visibility gate at FIELD level (structurally impossible for non-admin to reach full catalog — D5); no LIKE/search input (escapeLikeWildcards documented N/A); BFLA pre-check proven before resolver body
  - [ ] 3.2.SR **Semantic Review**: enum value imports; ctx-context usage only (no service-locator antipatterns); fail-closed posture
  - [ ] 3.2.IV **Instruction Verification**: `backend/graphql/AGENTS.md` query conventions + DEV2-002 authScopes contract per `docs/auth/jwt-authentication-service.md`
  - [ ] 3.2.OD **Outcome**: `outcome/3.2-catalog-queries-outcome.md`

### Task 3.3 — Catalog Mutations (`createPlan`, `updatePlan`, `setPlanActiveStatus`)

- [ ] 3.3 Implement `backend/graphql/mutation/plan-catalog.mutation.ts`
  - Files to create:
    - `backend/graphql/mutation/plan-catalog.mutation.ts` (NEW)
    - Update the mutation domain barrel with a side-effect import per existing layout
  - Applicable AGENTS.md: `backend/graphql/AGENTS.md`
  - _Requirements: REQ-011, REQ-013, REQ-014, REQ-015, REQ-020, REQ-030, REQ-031, REQ-050, REQ-060_
  - [ ] 3.3.1 Define `CreatePlanInput` input object (five required fields; `price: String!`) and `UpdatePlanInput` (five optional fields) — input types structurally omit server-controlled fields (BOPLA at the SDL layer)
  - [ ] 3.3.2 `createPlan(input): Plan!` — `authScopes: { authenticated: true, role: [UserRole.Admin] }` → `PlanCatalogService.createPlan(input, ctx.locale)` → returns `RETURNING *` row for Apollo cache convergence
  - [ ] 3.3.3 `updatePlan(id: ID!, input): Plan!` — same authScopes → service
  - [ ] 3.3.4 `setPlanActiveStatus(id: ID!, isActive: Boolean!): Plan!` — same authScopes → service
  - [ ] 3.3.5 Confirm NO `deletePlan`/`removePlan` mutation exists by construction (INV-PC3)
  - [ ] 3.3.QL **Quality Loop**: sub-loop on the new file (exit 0)
  - [ ] 3.3.TE **Test Engineering**: integration tests asserting every REQ-064 mutation matrix cell (`UNAUTHORIZED` anonymous / `FORBIDDEN` student·parent·teacher·supervisor / success admin); `extensions.code` asserted per failure class (`VALIDATION` + `fields[]`, `PLAN_NOT_FOUND`, `PLAN_ALREADY_INACTIVE`, `PLAN_ALREADY_ACTIVE`); BOPLA integration smuggle on the wire
  - [ ] 3.3.SEC **Security & Tenancy Audit**: BFLA enforced before resolver body executes for non-admin roles (proven via tests); actor identity exclusively from `ctx.user`; rate posture inherits global fail-open stub (no new limiter, REQ-034)
  - [ ] 3.3.SR **Semantic Review**: mutations return `Plan!` (non-null) backed by `RETURNING *` authoritative rows; canonical types only
  - [ ] 3.3.IV **Instruction Verification**: `backend/graphql/AGENTS.md` mutation conventions + `docs/graphql/domain-error-extensions-code.md` mapping
  - [ ] 3.3.OD **Outcome**: `outcome/3.3-catalog-mutations-outcome.md`

### Task 3.4 — Codegen, SDL Verification & No-Delete-Surface Assertion

- [ ] 3.4 Generate schema + client artifacts and run static schema gates
  - Files affected: generated schema artifact (`schema.graphql` or per-repo convention), codegen outputs under `frontend/graphql/` generated types
  - _Requirements: REQ-020, REQ-060, REQ-077_
  - [ ] 3.4.1 Run `bun run generate:gqlSchema && bun codegen`; commit ALL generated artifacts in the same change set
  - [ ] 3.4.2 REQ-020 static assertion: case-insensitive grep of generated SDL for `deletePlan`/`removePlan` — MUST be absent; encode as a persistent test so future diffs can't regress INV-PC3
  - [ ] 3.4.3 Assert SDL matches the REQ-060 contract byte-for-byte on field names/types/nullability (`price: String!`, `deactivatedAt: DateTime` nullable, etc.)
  - [ ] 3.4.QL **Quality Loop**: sub-loop on any hand-authored touched files; codegen outputs verified via tsgo
  - [ ] 3.4.TE **Test Engineering**: the no-delete grep is a committed test (`backend/graphql/test` or established schema-assertion location); SDL-shape snapshot assertion
  - [ ] 3.4.SEC **Security & Tenancy Audit**: confirm no ungated mutation leaked into SDL (every mutation field carries the role scope)
  - [ ] 3.4.SR **Semantic Review**: no manual edits to generated files; no drift between Pothos definitions and committed SDL
  - [ ] 3.4.IV **Instruction Verification**: codegen workflow per `backend/graphql/AGENTS.md`
  - [ ] 3.4.OD **Outcome**: `outcome/3.4-codegen-gates-outcome.md`

### Task 3.5 — Seed Parity (Demo Catalog via Service Bootstrap)

- [ ] 3.5 Implement idempotent demo catalog seeding through the service layer
  - Files to create/modify:
    - `backend/db/seeds/` plan-catalog seed module (create or extend per `backend/db/seeds/AGENTS.md` existing structure)
  - Applicable AGENTS.md: `backend/db/seeds/AGENTS.md`
  - _Requirements: REQ-019, REQ-021_
  - [ ] 3.5.1 Implement find-or-create bootstrap via `PlanCatalogService` (NEVER raw `@/backend/db/**` imports): Hifz Jadid plan; Tajweed plan; "New Teacher Verification & Evaluation Plan" with `sessionCount = 5` (FR-2.3); one deactivated demo plan
  - [ ] 3.5.2 Stable title lookup as the idempotency key (safe re-run)
  - [ ] 3.5.QL **Quality Loop**: sub-loop on the seed module (exit 0)
  - [ ] 3.5.TE **Test Engineering**: seed idempotency test — run bootstrap twice inside `runInRollback`, assert row counts stable and verification plan has `sessionCount = 5`
  - [ ] 3.5.SEC **Security & Tenancy Audit**: seeder carries no credentials/user data; goes through service validation like any caller
  - [ ] 3.5.SR **Semantic Review**: no business-logic duplication with the service; seed module consumes the public service contract
  - [ ] 3.5.IV **Instruction Verification**: `backend/db/seeds/AGENTS.md` service-bootstrap rule
  - [ ] 3.5.OD **Outcome**: `outcome/3.5-seed-parity-outcome.md`

### Task 3.6 — Full GraphQL Role-Matrix Integration Proof (REQ-072)

- [ ] 3.6 Implement the complete REQ-064 permission-matrix integration suite
  - Files to create:
    - `backend/graphql/test/plan-catalog.roles.test.ts` (path per established integration-test layout)
  - _Requirements: REQ-030, REQ-064, REQ-072_
  - [ ] 3.6.1 For EVERY surface (`planCatalog`, `adminPlans`, `createPlan`, `updatePlan`, `setPlanActiveStatus`) assert: anonymous → `UNAUTHORIZED`; student → active-only / `FORBIDDEN`; parent → active-only / `FORBIDDEN`; teacher → active-only / `FORBIDDEN`; supervisor → consistent with matrix / `FORBIDDEN`; admin → success
  - [ ] 3.6.2 Assert `extensions.code` per cell — never message-text-coupled for the matrix (messages asserted separately as localized substrings)
  - [ ] 3.6.3 Visibility split assertion: deactivated plan absent from `planCatalog` for every authenticated role, present in `adminPlans` for admin
  - [ ] 3.6.QL **Quality Loop**: sub-loop on the test file (exit 0)
  - [ ] 3.6.TE **Test Engineering**: suite executed via `bun run test/scripts/run-test.ts <path>`; fixtures exclusively via `entity-setup.ts`; token fixtures per established auth-fixture patterns
  - [ ] 3.6.SEC **Security & Tenancy Audit**: this suite IS the BFLA proof — confirm no matrix cell is skipped or soft-asserted
  - [ ] 3.6.SR **Semantic Review**: assertions translation-agnostic at the matrix layer; no dead helpers
  - [ ] 3.6.IV **Instruction Verification**: integration-test conventions per graphql test-layer AGENTS.md
  - [ ] 3.6.OD **Outcome**: `outcome/3.6-role-matrix-outcome.md`

---

## Phase 4: Frontend GraphQL Documents, Stores & UI Views

### Task 4.1 — Apollo Documents & Barrels

- [ ] 4.1 Author the plan-catalog frontend GraphQL documents
  - Files to create:
    - `frontend/graphql/sharedDocuments/billing/plan-catalog.documents.ts` (NEW — billing/ sub-directory mirrors the existing `teachers/` layout)
    - `frontend/graphql/sharedDocuments/billing/index.ts` (NEW — `export * from "./plan-catalog.documents";` sub-directory barrel per AGENTS.md)
    - `frontend/graphql/sharedDocuments/index.ts` (MODIFY — top-level barrel currently exports only `./auth` + `./teachers`; add `export * from "./billing";` — 0.3 gate correction)
  - Applicable AGENTS.md: `frontend/graphql/sharedDocuments/AGENTS.md`
  - _Requirements: REQ-061_
  - [ ] 4.1.1 Author `planCatalogQueryDocument`, `adminPlansQueryDocument` (with `AdminPlansQueryVariables`), `createPlanMutationDocument`, `updatePlanMutationDocument`, `setPlanActiveStatusMutationDocument` as `TypedDocumentNode<…>` (from `@apollo/client`, codegen types only)
  - [ ] 4.1.2 `id` present in EVERY `Plan` selection set (Apollo normalization)
  - [ ] 4.1.3 No `useLazyQuery`; hooks will be consumed from `@apollo/client/react` in Phase 4.2
  - [ ] 4.1.QL **Quality Loop**: sub-loop on the documents file (exit 0)
  - [ ] 4.1.TE **Test Engineering**: document-shape assertion (selection sets contain `id`; variables typing aligns with codegen); codegen green (`bun codegen`)
  - [ ] 4.1.SEC **Security & Tenancy Audit**: no client-side active-filtering logic planned anywhere — deactivation exclusion is server-side only
  - [ ] 4.1.SR **Semantic Review**: codegen types only (no inline literals, no mapping layers); barrel discipline per subdirectory rules
  - [ ] 4.1.IV **Instruction Verification**: `frontend/graphql/sharedDocuments/AGENTS.md` naming + barrel conventions
  - [ ] 4.1.OD **Outcome**: `outcome/4.1-frontend-documents-outcome.md`

### Task 4.2 — Server Component Page & SSR Guard (`/admin/plans`)

- [ ] 4.2 Implement `app/(dashboard)/admin/plans/page.tsx` with `withPageAuth` admin guard
  - Files to create:
    - `app/(dashboard)/admin/plans/page.tsx` (NEW — Server Component)
  - Applicable AGENTS.md: `app/AGENTS.md`
  - _Requirements: REQ-002, REQ-062, REQ-064_
  - [ ] 4.2.1 Apply `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/plans" })` (UserRole as value import): anonymous → `/login?redirect=/admin/plans`; role mismatch → caller's role-specific dashboard via `roleDashboardPath` (never bare `/dashboard` — REDIRECT_LOOP_FIX rule; verified `frontend/lib/auth/withPageAuth.ts` + `roleDashboardRoute.ts`)
  - [ ] 4.2.2 Server Component resolves `await getTranslations(locale)` (single argument) and passes shell labels via property access (`t.plansTranslations.*`) as props to the client container
  - [ ] 4.2.3 Server component contains ZERO data-fetching through GraphQL (server layer consumes services directly if needed — here it delegates everything to the client container)
  - [ ] 4.2.QL **Quality Loop**: sub-loop on the page file (exit 0)
  - [ ] 4.2.TE **Unit / Component Tests**: guard behavior tests — anonymous redirect, student/parent/teacher redirect to their role-specific dashboards (`/student/dashboard`, `/parent/dashboard`, `/teacher/dashboard`), admin renders (SSR-level harness per established app-layer test patterns)
  - [ ] 4.2.SR **Semantic Review**: server/client boundary clean (no client hooks in server file); `UserRole` value import; no hardcoded strings
  - [ ] 4.2.IV **Instruction Verification**: `app/AGENTS.md` (SSR guard = security boundary; client gating is UX-only)
  - [ ] 4.2.OD **Outcome**: `outcome/4.2-admin-page-outcome.md`

### Task 4.3 — Client Container: `PlanCatalogContainer` + Table

- [ ] 4.3 Implement the client container and catalog table
  - Files to create:
    - `frontend/views/admin/plans/PlanCatalogContainer.tsx` (NEW — client)
    - `frontend/views/admin/plans/PlanCatalogTable.tsx` (NEW — client)
    - `frontend/views/admin/plans/index.ts` (barrel per views conventions, if applicable)
  - Applicable AGENTS.md: `frontend/AGENTS.md` + convention docs `frontend/COMPONENT_PATTERNS.md` + `frontend/THEME_PALETTE.md` (no `frontend/views/AGENTS.md` / `frontend/components/ui/AGENTS.md` exist — corrected by 0.3 gate)
  - _Requirements: REQ-054, REQ-060, REQ-062, REQ-063, REQ-064, REQ-076_
  - [ ] 4.3.1 Container: `useAppTranslation(Plans)` with property access only; `useQuery(adminPlansQueryDocument, { variables: { includeInactive: true } })` from `@apollo/client/react`
  - [ ] 4.3.2 Table columns: title, sessionCount, price + currency (string rendering — no number coercion), intervalDays, isActive status chip (Active/Inactive via `theme.palette.success.*` / `theme.palette.grey.*` — theme-callback pattern, NO hex), deactivatedAt, createdAt; per-row edit + activate/deactivate actions
  - [ ] 4.3.3 Mutation wiring here (create/edit/status dialogs in 4.4); success path: localized snackbar + Apollo cache convergence via `id`-normalized `Plan!` payloads (no manual refetch unless cache update insufficient); row action buttons disabled during their in-flight transition
  - [ ] 4.3.4 Loading: skeleton rows per dashboard conventions; empty: localized empty state (icon + translated copy + create CTA)
  - [ ] 4.3.QL **Quality Loop**: sub-loop on each created file (exit 0)
  - [ ] 4.3.TE **Unit / Component Tests** (REQ-076 discipline): Happy DOM + Apollo `MockedProvider` + `translation-preload.ts` + `readTranslation(handle, locale)` + `TestWrapper locale`; translation-driven matchers ONLY (zero hardcoded UI strings); assert: active/inactive chip rendering from query data, empty state, skeleton state, table row fields
  - [ ] 4.3.BF **Agent-Browser Functional Self-Loop**:
    - Launch dev server; connect via agent-browser (Playwright)
    - Anonymous `GET /admin/plans` → assert redirect to `/login?redirect=/admin/plans`; non-admin login → `/admin/plans` → redirect to the role-specific dashboard (no table render); admin login → table renders with seeded catalog
    - Navigate tabs/rows; trigger per-row edit/status actions; assert GraphQL request payloads (`adminPlans` issued; mutations carry whitelisted fields only) and error toast / inline alert states for conflict cases
    - Iterative self-loop: any interaction or state failure → patch → re-test until clean
  - [ ] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    - Capture high-resolution screenshots across viewports (Desktop 1440×900, Tablet 768×1024, Mobile 375×812 — card-stacked layout) and locales (English LTR + Arabic RTL)
    - Inspect screenshots for: MUI v9 theme-palette compliance (zero hardcoded hex/rgb visible in computed styles), typography hierarchy, padding/margin rhythm, chip contrast in dark/light modes, text truncation/overflows (Arabic copy), RTL mirroring (action column at inline-end, logical properties only), table-to-card responsive switch
    - Iterative self-loop: inspect screenshot → identify defect → patch `sx` tokens → re-capture → repeat until visually polished
  - [ ] 4.3.SR **Semantic Review**: zero direct style props (sx only); `*Outlined` icons; `theme.palette.*` only; property-access i18n; no Zustand store introduced (server state = Apollo cache only)
  - [ ] 4.3.IV **Instruction Verification**: `frontend/AGENTS.md`, `frontend/THEME_PALETTE.md`, `frontend/COMPONENT_PATTERNS.md` (the repo has no `frontend.instructions.md` / `mobile-desktop.instructions.md` — corrected by 0.3 gate)
  - [ ] 4.3.OD **Outcome**: `outcome/4.3-catalog-container-outcome.md`

### Task 4.4 — Dialogs: `PlanFormDialog` (Create/Edit) + `PlanStatusConfirmDialog`

- [ ] 4.4 Implement the create/edit form dialog and status confirmation dialog
  - Files to create:
    - `frontend/views/admin/plans/PlanFormDialog.tsx` (NEW)
    - `frontend/views/admin/plans/PlanStatusConfirmDialog.tsx` (NEW)
  - Applicable AGENTS.md: `frontend/AGENTS.md` + convention docs `frontend/COMPONENT_PATTERNS.md` + `frontend/THEME_PALETTE.md`
  - _Requirements: REQ-012, REQ-043, REQ-050, REQ-063_
  - [ ] 4.4.1 `PlanFormDialog`: shared create/edit scaffold; fields title/sessionCount/price/currency/intervalDays; submit via `React.SubmitEvent` / `React.SyntheticEvent<HTMLFormElement>` (never `FormEvent`); per-field error mapping from `extensions.fields[]` → `TextField error` + localized `helperText` + `aria-invalid={!!error}`; price entered/rendered as a string
  - [ ] 4.4.2 Submit button disabled while mutation in flight (`loading`) — REQ-043 double-submit UX mitigation; spinner adornment
  - [ ] 4.4.3 `PlanStatusConfirmDialog`: localized confirm copy for deactivate AND reactivate flows; `PLAN_ALREADY_*` / `PLAN_NOT_FOUND` → localized inline `Alert` (severity via theme tokens) + list convergence
  - [ ] 4.4.4 `FORBIDDEN`/`UNAUTHORIZED` handled via global errorLink posture; masked `INTERNAL_SERVER_ERROR` → generic localized toast with correlation guidance
  - [ ] 4.4.QL **Quality Loop**: sub-loop on each file (exit 0)
  - [ ] 4.4.TE **Unit / Component Tests** (REQ-076 discipline): Happy DOM + MockedProvider: (a) create happy path creates via mocked mutation; (b) server `VALIDATION` + `fields[]` renders localized per-field errors; (c) `PLAN_ALREADY_INACTIVE` renders localized inline alert; (d) disabled-during-flight asserted; (e) `React.SubmitEvent` submit handling proven
  - [ ] 4.4.BF **Agent-Browser Functional Self-Loop**:
    - Admin: open create dialog → submit valid payload → new row appears with Active chip; submit invalid payloads (price `"19.999"`, sessionCount `0`, currency `"egp"`) → localized field-level errors under the CORRECT fields
    - Edit flow: partial patch applies; status flow: deactivate → confirm → Inactive chip; reactivate → Active chip
    - Double-click submit rapidly → exactly ONE mutation issued (button disabled while pending — assert network count = 1)
    - Iterative self-loop until every flow is clean
  - [ ] 4.4.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    - Screenshot dialogs at 1440×900 / 768×1024 / 375×812 in EN (LTR) and AR (RTL), including error-rendered states and disabled-submit state
    - Inspect: dialog sizing to content (Arabic copy not truncated), field error placement/alignment under RTL, button width behavior on mobile (full-width), severity-color token usage on chips/alerts/snackbars, focus rings and contrast
    - Iterative self-loop: screenshot → defect → `sx` token patch → re-capture → polish
  - [ ] 4.4.SR **Semantic Review**: sx-only styling; `*Outlined` icons; property-access translations; no hardcoded strings/colors; `aria-invalid` present
  - [ ] 4.4.IV **Instruction Verification**: `frontend/AGENTS.md`, `frontend/THEME_PALETTE.md`, `frontend/COMPONENT_PATTERNS.md`
  - [ ] 4.4.OD **Outcome**: `outcome/4.4-dialogs-outcome.md`

### Task 4.5 — Sidebar Navigation Integration (Admin Group)

- [ ] 4.5 Add the "Plans" entry to the admin navigation group
  - Files to modify: existing admin sidebar/navigation config (locate per `frontend/` layout conventions before editing)
  - Applicable AGENTS.md: `frontend/AGENTS.md`
  - _Requirements: REQ-054, REQ-064_
  - [ ] 4.5.1 Add translated "Plans" nav item (label from `plans` namespace) in the Admin/Management group, ordered after existing admin entries; icon `Inventory2Outlined`-class (`*Outlined` naming)
  - [ ] 4.5.2 NO mobile bottom-nav addition (admin-only surface)
  - [ ] 4.5.3 Role-visibility: item hidden/never reachable for non-admin roles (SSR guard remains the security boundary; nav hiding is UX only)
  - [ ] 4.5.QL **Quality Loop**: sub-loop on modified nav file (exit 0)
  - [ ] 4.5.TE **Unit / Component Tests**: nav renders the item for admin fixture with translated label; absent for student fixture
  - [ ] 4.5.BF **Agent-Browser Functional Self-Loop**: admin login → click "Plans" in sidebar → `/admin/plans` loads; verify nav item absent for student session
  - [ ] 4.5.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**: capture sidebar in EN/AR desktop + mobile drawer; verify RTL item alignment, icon mirroring, label truncation
  - [ ] 4.5.SR **Semantic Review**: translated label only; `*Outlined` icon; no hardcoded colors
  - [ ] 4.5.IV **Instruction Verification**: nav conventions per `frontend/AGENTS.md`
  - [ ] 4.5.OD **Outcome**: `outcome/4.5-navigation-outcome.md`

---

## Phase 5: Integration & Differential Testing

### Task 5.1 — Deactivation Preservation Proof (REQ-075)

- [ ] 5.1 Prove deactivation/edit preserves existing subscriptions and credited balances byte-identically
  - Files to create:
    - `backend/db/test/logic/billing/plan-catalog-preservation.test.ts`
  - _Requirements: REQ-017, REQ-018, REQ-075_
  - [ ] 5.1.1 Fixture: plan + linked subscription (via entity-setup helpers) + student balance lanes inside `runInRollback`; snapshot rows
  - [ ] 5.1.2 Execute `setPlanActiveStatus(id, false)` → assert subscription row (status/dates) and balance fixtures byte-identical
  - [ ] 5.1.3 Execute `updatePlan` with changed price/sessionCount/intervalDays → assert the same byte-identical invariance (forward-only semantics, INV-B2/B3 shield)
  - [ ] 5.1.QL **Quality Loop**: sub-loop on the test file (exit 0)
  - [ ] 5.1.TE **Test Engineering**: executed via `bun run test/scripts/run-test.ts`; `expectRepoError` discipline for any failure probes; `tx` propagation verified
  - [ ] 5.1.SEC **Security & Tenancy Audit**: confirms zero cross-entity writes (A.9 lifecycle independence)
  - [ ] 5.1.SR **Semantic Review**: assertions on full row shape, not selected columns
  - [ ] 5.1.IV **Instruction Verification**: test AGENTS.md fixtures-only rule
  - [ ] 5.1.OD **Outcome**: `outcome/5.1-preservation-proof-outcome.md`

### Task 5.2 — Concurrency & Chaos Probes (REQ-074)

- [ ] 5.2 Implement the Tier-3 chaos/concurrency suite end-to-end through the GraphQL boundary
  - Files to create:
    - `backend/graphql/test/plan-catalog.concurrency.test.ts`
  - _Requirements: REQ-040, REQ-074, REQ-045_
  - [ ] 5.2.1 `Promise.allSettled` double-deactivation of the same plan via testClient → exactly one fulfilled + one rejected with `PLAN_ALREADY_INACTIVE`; final row transitioned exactly once (`deactivated_at` set once)
  - [ ] 5.2.2 Deactivate/reactivate interleave converges to a consistent final state
  - [ ] 5.2.3 Concurrent `updatePlan` patches → last-write-wins; no errors; final row equals the chronologically-last patch
  - [ ] 5.2.QL **Quality Loop**: sub-loop on the test file (exit 0)
  - [ ] 5.2.TE **Test Engineering**: all concurrency inside `runInRollback`-compatible harness per integration-suite conventions; deterministic assertions on outcome classes (not timing)
  - [ ] 5.2.SEC **Security & Tenancy Audit**: proves TOCTOU window = 0 under the guarded-UPDATE primitive (D2)
  - [ ] 5.2.SR **Semantic Review**: no flaky timing sleeps; race orchestration via `Promise.allSettled` only
  - [ ] 5.2.IV **Instruction Verification**: chaos-tier conventions per test-layer AGENTS.md
  - [ ] 5.2.OD **Outcome**: `outcome/5.2-concurrency-outcome.md`

### Task 5.3 — Coverage Gate & Full-Suite Differential Run

- [ ] 5.3 Close the REQ-070 coverage target and run the full differential test + lint baseline comparison
  - _Requirements: REQ-070, REQ-077, REQ-083 (partial), REQ-023_
  - [ ] 5.3.1 `bun test --coverage` on ALL new/modified backend suites — assert 100% statements/branches on new service/repo files (incl. both zero-row guard branches)
  - [ ] 5.3.2 Run full impacted suites: `bun run test/scripts/run-test.ts` for every new test file; assert DEV1-002/DEV2-001 auth suites REMAIN GREEN (registration/refresh contract untouched, REQ-023)
  - [ ] 5.3.3 Run `bun tsgo`, `bun biome:check` — compare to Phase 0 baseline: zero NEW errors
  - [ ] 5.3.4 Re-run REQ-020 no-delete grep + REQ-016 single-predicate grep + REQ-031 no-spread grep as the verification bundle
  - [ ] 5.3.QL **Quality Loop**: sub-loop across every created/modified file in the change set (final sweep, exit 0 each)
  - [ ] 5.3.TE **Test Engineering**: differential report written (baseline counts vs final counts) into the outcome
  - [ ] 5.3.SR **Semantic Review**: any coverage gap is either closed or explicitly justified + deferred with owner
  - [ ] 5.3.IV **Instruction Verification**: quality-gate rules per root AGENTS.md
  - [ ] 5.3.OD **Outcome**: `outcome/5.3-coverage-differential-outcome.md`

---

## Phase 6: Post-Implementation Review Waves

### Task 6.1 — Review Wave: review-types

- [ ] 6.1 Parallel review wave: canonical types & GraphQL artifacts
  - _Requirements: REQ-003, REQ-042, REQ-060_
  - [ ] 6.1.1 Verify `backend/types/billing/plan.types.ts` canonical naming + BOPLA-construction; no local types in Pothos files; no service `.types.ts`; `DBTransaction` from `@/backend/types` only
  - [ ] 6.1.2 Verify codegen artifacts committed, no drift, no manual edits
  - [ ] 6.1.QL/IV: sub-loop + AGENTS.md verification on any finding-fix files
  - [ ] 6.1.OD **Outcome**: `outcome/6.1-review-types-outcome.md` (findings resolved or deferred with owner)

### Task 6.2 — Review Wave: review-backend

- [ ] 6.2 Parallel review wave: repository, service, resolvers, error contracts
  - _Requirements: REQ-011..018, REQ-040..045, REQ-050..053_
  - [ ] 6.2.1 Verify guarded-UPDATE primitive is the only state-transition mechanism; single-predicate active filter; whitelist mapping; no-cascade physical guarantee; error `extensions.code` map; localization paths; logging discipline (`logDomainError` vs `logger.error`; no `console.*`)
  - [ ] 6.2.2 Verify `runInRollback`/`tx`/helper/`expectRepoError` discipline across every DB test
  - [ ] 6.2.QL/IV: sub-loop + instruction verification on any fix files
  - [ ] 6.2.OD **Outcome**: `outcome/6.2-review-backend-outcome.md`

### Task 6.3 — Review Wave: review-frontend

- [ ] 6.3 Parallel review wave: page, container, dialogs, navigation, documents
  - _Requirements: REQ-054, REQ-060..064_
  - [ ] 6.3.1 Verify: sx-only styling; theme-palette-only colors; `*Outlined` icons; `React.SubmitEvent` discipline; translation property-access only; documents naming/barrel compliance; SSR-guard boundary; screenshot archives from 4.3.BS/4.4.BS/4.5.BS complete for all viewport×locale cells
  - [ ] 6.3.QL/IV: sub-loop + instruction verification on any fix files
  - [ ] 6.3.OD **Outcome**: `outcome/6.3-review-frontend-outcome.md`

### Task 6.4 — Review Wave: pentester

- [ ] 6.4 Parallel review wave: security posture audit
  - _Requirements: REQ-030..035, REQ-052_
  - [ ] 6.4.1 BFLA: matrix proof that all 4 admin surfaces reject non-admin BEFORE resolver body; BOPLA: grep + smuggle-test evidence; BOLA: catalog-ID non-sensitivity ruling documented (REQ-032 caveat for future sensitive resources); error-disclosure: no SQL/constraint leakage on `23514` fallback; wildcard-escaping N/A ruling documented
  - [ ] 6.4.QL/IV: sub-loop + instruction verification on any fix files
  - [ ] 6.4.OD **Outcome**: `outcome/6.4-pentester-outcome.md`

### Task 6.5 — Deferred-Items Gate Check

- [ ] 6.5 Audit the deferred-items ledger against the REQ-083 close gate
  - _Requirements: REQ-001, REQ-083_
  - [ ] 6.5.1 Run `grep -c "❌\|⚠️" ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` — MUST equal exactly the pre-seeded entries (D1 → DEV3-020, D2 → DEV1-006), both non-blocking with documented owners; any additional open marker MUST be resolved first (scope the count to `| D…` ledger-table rows — the template's Status-Values legend also contains the marker glyphs, so a raw whole-file count over-counts by 2)
  - [ ] 6.5.OD **Outcome**: `outcome/6.5-deferred-gate-outcome.md`

---

## Phase 7: Knowledge Propagation & Documentation

### Task 7.1 — Canonical Reference Doc

- [ ] 7.1 Author `docs/billing/plan-catalog.md`
  - _Requirements: REQ-080, REQ-032, REQ-033, REQ-043, REQ-044, REQ-045_
  - [ ] 7.1.1 Structure: Why (FR-2.1/2.2/2.3) → lifecycle columns (D1) → guarded state-transition pattern (D2/D3) → catalog/admin visibility split (D5) → forward-only edits + no price snapshot trade-off → error code map → consumption guides for DEV1-006 (incl. purchase-time re-validation contract D2-deferred), DEV2-005 (verification plan lookup rule), DEV1-009 (transactional composition of repo methods)
  - [ ] 7.1.2 Explicit warnings: catalog-ID non-sensitivity ruling is NOT inheritable by sensitive resources; `escapeLikeWildcards` mandated for any future catalog search; title is admin-authored data NOT i18n keys
  - [ ] 7.1.QL/IV: doc lint + cross-link validation
  - [ ] 7.1.OD **Outcome**: `outcome/7.1-canonical-doc-outcome.md`

### Task 7.2 — Invariant & Decision Addenda

- [ ] 7.2 Update `docs/specs/state-machine-invariants.md` and `docs/specs/open-decisions-and-gaps.md`
  - _Requirements: REQ-081, REQ-010, REQ-015, REQ-018, REQ-020, REQ-043_
  - Gate note (0.3 ruling): the specs.md header statement "The addendum is recorded in `docs/specs/open-decisions-and-gaps.md`" is FORWARD-LOOKING until 7.2.2 lands (0.2.IV caveat); the 7.4 closure MUST verify the addendum rows actually exist in the decisions doc before plan close
  - [ ] 7.2.1 Add "Plan Catalog Lifecycle" section: **INV-PC1** (deactivated plan never appears in active catalog / never purchasable while inactive), **INV-PC2** (deactivation/edit never mutates existing subscriptions or credited balances), **INV-PC3** (no hard deletion of plan rows)
  - [ ] 7.2.2 Add resolved addendum to `open-decisions-and-gaps.md`: activation-flag schema delta (A-category), reactivation semantics (marker cleared, audit history via DEV3-020), forward-only edit semantics, title-encoded taxonomy (FR-2.2 reaffirmed), verification-plan lookup rule ownership (FR-2.3 → DEV1-006/DEV2-005), create double-submit tolerance ruling (REQ-043), no-pagination/no-index rulings with revisit triggers
  - [ ] 7.2.QL/IV: doc lint; confirm numbering consistency with the existing 33-decision register
  - [ ] 7.2.OD **Outcome**: `outcome/7.2-spec-addenda-outcome.md`

### Task 7.3 — AGENTS.md Propagation

- [ ] 7.3 Add rule-only one-liner references to layer AGENTS.md files
  - Files to modify: `backend/services/AGENTS.md`, `backend/graphql/AGENTS.md`, root `AGENTS.md` (Important References)
  - _Requirements: REQ-082_
  - [ ] 7.3.1 `backend/services/AGENTS.md`: one-liner — catalog service + forward-only edit rule → `docs/billing/plan-catalog.md`
  - [ ] 7.3.2 `backend/graphql/AGENTS.md`: one-liner — role-scope mutation gate example + required `id` on `Plan` → canonical doc
  - [ ] 7.3.3 Root `AGENTS.md` Important References: one-liner pointer
  - [ ] 7.3.IV: verify entries are rules/pointers ONLY — no code, no implementation recipes
  - [ ] 7.3.OD **Outcome**: `outcome/7.3-agents-propagation-outcome.md`

### Task 7.4 — Final Baseline Delta & Plan Closure Synthesis

- [ ] 7.4 Final closure: baseline comparison, outcome index, deferred-ledger attestation
  - _Requirements: REQ-001, REQ-083_
  - [ ] 7.4.1 Re-run `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json` — prove zero NEW errors versus the Phase 0 baseline (numbers recorded side-by-side)
  - [ ] 7.4.2 Verify every task has its `outcome/<task-id>-outcome.md`; produce the outcome index
  - [ ] 7.4.3 Final deferred-items attestation: only D1 (→ DEV3-020) and D2 (→ DEV1-006) remain, both non-blocking with owners
  - [ ] 7.4.4 Synthesize `outcome/7.4-plan-closure-outcome.md`: REQ-by-REQ satisfaction table (REQ-001..REQ-083), quality-gate evidence bundle (sub-loop exits, coverage report, SDL grep assertions, role-matrix proof, browser-loop screenshot archive references), and forward handoff notes to DEV1-006 / DEV1-009 / DEV2-005 / DEV3-020

---

## Task Dependency Graph (Execution Order)

```
0.1 → 0.2 → 0.3 (GATE)
  → 1.1 → 1.2 → (1.3, 1.4 parallel) → 1.5
  → 2.1 → 2.2 → 2.3 → 2.4 (MID-POINT GATE)
  → 3.1 → (3.2, 3.3 parallel) → 3.4 → 3.5 → 3.6
  → 4.1 → 4.2 → 4.3 → 4.4 → 4.5
  → 5.1 → 5.2 → 5.3
  → (6.1, 6.2, 6.3, 6.4 parallel) → 6.5 (DEFERRED GATE)
  → 7.1 → 7.2 → 7.3 → 7.4 (CLOSURE)
```

**Hard gates:** 0.3 (plan review), 2.4 (mid-point review), 5.3 (coverage/differential), 6.5 (deferred-items), 7.4 (closure). Downstream phases are BLOCKED until the gate outcome file exists with a pass verdict.
