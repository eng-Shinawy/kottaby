# Requirements & Specification: DEV1-005 — Plan Catalog CRUD (Admin Only)

> **Target ticket:** `[DEV1-005] Plan Catalog CRUD (Admin Only)` (Owner: Dev 1 · Sprint 1 · 3 SP)
> **Plan directory:** `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/`
> **Blocking dependencies:** DEV1-001 (`plans` table + CHECK constraints), DEV1-002 (registration + `createAdminUser` service path), DEV2-001 (JWT context factory: `ctx.user` / `ctx.role`), DEV2-002 (`role` authScope with OR semantics, fail-closed evaluation).
> **Critical reconciliation note:** The `plans` table delivered by DEV1-001 (`backend/db/schema/billing/plans.ts`) contains **no activation/status column**. The ticket's acceptance criteria require "activate / deactivate" semantics. This ticket therefore carries an explicitly authorized **schema delta**: `plans.is_active boolean NOT NULL DEFAULT true` and `plans.deactivated_at timestamp NULL`, applied via `bun run db push` — following the DEV1-004 precedent for per-ticket schema deltas (`balance_trial`/`trial_granted_at`). The addendum is recorded in `docs/specs/open-decisions-and-gaps.md` (REQ-081). No other structural drift is permitted.

---

## 1. Executive Summary & Problem Statement

- **Feature**: The admin-facing Plan Catalog management surface for Kottaby / Draft Academy. A Super Admin can create, edit, activate, and deactivate subscription plans (`plans` rows: `title`, `session_count`, `price`, `currency`, `interval_days`, plus the new `is_active`/`deactivated_at` lifecycle columns), list the full catalog (including inactive plans), and see changes reflected immediately in the authenticated plan catalog read model that purchasing flows (student plans and the Teacher Verification Plan) will consume. The feature spans: one schema delta, one canonical repository, one service (`PlanCatalogService`), a small Pothos surface (1 query for admins, 1 authenticated catalog query, 3 admin mutations), and one admin UI page (`/admin/plans`).
- **Problem from user perspective**:
  - **Super Admin**: must be able to manage the commercial catalog (FR-2.1) — publish a new Hifz/Tajweed/Atfal/Mukathaf/Tathbeet plan, fix a mispriced plan, or pull a plan from sale — without touching the database directly and without breaking students who already bought it.
  - **Student (Yusuf)**: must never see or purchase a deactivated plan, and any plan visible in the catalog must be purchasable with sane constraints (positive session quota, non-negative price, positive validity window).
  - **Teacher Applicant (Ibrahim)**: the "New Teacher Verification & Evaluation Plan" (FR-2.3, 5 sessions) is simply a catalog entry created by the admin; DEV2-005 will purchase through the same catalog, so the catalog contract must be stable and active-filtered before DEV1-006 and DEV2-005 build on it.
  - **Parent (Fatima)**: may read the active catalog (read-only posture preserved), but must never mutate it.
  - **Dev 1 (DEV1-006..009) / Dev 2 (DEV2-005)**: need the canonical read/write contract (`PlanCatalogService` + GraphQL documents) so purchase, crediting, expiry, and admin subscription management never re-implement plan lookup or active-state filtering.
- **Business value**: Plan management is the first step of the revenue funnel on the critical path to M1 ("Student can subscribe & book"). The strict catalog lifecycle prevents defective or obsolete plans from generating revenue against invalid terms, while forward-only edit semantics preserve the integrity of already-credited balances (INV-B2/B3). The active-filter split (`planCatalog` vs `adminPlans`) is the single enforcement point the entire monetization surface depends on.
- **Actors involved**:
  - **Callers**: Super Admin (only role permitted to mutate); authenticated Student/Parent/Teacher-Applicant (read-only catalog consumers); Anonymous (no access).
  - **Downstream consumers**: DEV1-006 (Subscription Purchase), DEV1-007 (Balance Crediting), DEV1-008 (Validity/Expiry reads `interval_days`), DEV1-009 (Admin Subscription Management), DEV2-005 (Verification Plan Purchase), DEV3-019 (Direct onboarding with offline payment — references plans), DEV3-020 (audit logging — integration deferred, see deferred-items D1).
  - **Non-actors**: no teacher, student, or parent may mutate; no anonymous caller may read the catalog (browsing follows registration in the customer journey).
- **Non-goals** (explicitly OUT of scope for DEV1-005):
  1. **Subscription purchase flow** (payment gateway, `student_payments`, escrow) — DEV1-006.
  2. **Session balance crediting/decrementing** — DEV1-007; this ticket never touches `students.balance_*` or `wallet`/`teacher_transaction`.
  3. **Subscription lifecycle management** (extend/renew/cancel/upgrade/downgrade, proration B.17) — DEV1-009.
  4. **Verification-plan-specific machinery** (5-session loop eligibility, cooldown blocking INV-TV3) — DEV2-005+; this ticket only guarantees a 5-session plan can exist and be purchased later.
  5. **Lessons/curriculum linkage** (`lessons.plan_id` CRUD) — DEV1-010.
  6. **Audit-log writes** for admin plan actions — wiring lands with DEV3-020 (deferred item D1); this ticket defines hook points only.
  7. **Hard deletion of plans** — no `deletePlan` mutation exists by construction (REQ-020); the catalog is append-and-deactivate only.
  8. **Public/anonymous catalog browsing**, plan search/LIKE endpoints, and any notification dispatch on plan changes.
  9. **Plan content i18n duplication** — `title` is admin-authored free text, not a translation key; UI chrome is translated, catalog content is data.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger)**: WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline` plus `git diff --name-only`) and SHALL initialize `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` from the template, pre-seeded with: **D1** (audit-log integration for plan mutations → target DEV3-020, non-blocking) and **D2** (purchase-time active-plan re-validation → target DEV1-006, non-blocking forward contract).
- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance)**:
  - Client components MUST use `useAppTranslation(<NamespaceHandle>)` with the typed namespace handle defined via `defineNamespace` (e.g., `Plans` from `shared/locale/namespaces/plans`) and property access (`t.property`), never string-literal namespaces or `t('key')` function calls.
  - Server components MUST use `await getTranslations(locale)` (single argument) and property access (`t.plansTranslations.*`).
  - GraphQL resolvers MUST use `ctx.t("...")`; services/repositories MUST use `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (single-argument API) with property access (e.g., `.errorsTranslations.planCatalog.*`).
  - All enum usages in runtime expressions/casts (e.g., `UserRole.Admin`, `SubscriptionStatus`) MUST use value imports (not `import type`) and enum members instead of raw string literals.
  - FORBIDDEN: `next-intl` imports, `getBackendTranslations`, `shared/messages/` references, any hardcoded user-facing string.
- **REQ-003 (Canonical Types Discipline)**: Entity types MUST come from `backend/types/billing/plan.types.ts` — extending the existing `PlanSelectType`/`PlanInsertType` with `PlanReturnType`, `PlanSubmitInput`, and `PlanUpdateInput` per the canonical naming rules. No local type definitions in Pothos files, no service-layer `.types.ts` files, and `DBTransaction`/`DBQueryExecutor` MUST be imported from `@/backend/types` only.
- **REQ-004 (Dependency Guard)**: WHEN domain work starts THEN the agent SHALL verify: DEV1-001 artifacts (`plans` table with `plans_session_count_check`, `plans_price_check`, `plans_interval_days_check`; `paymentGateway`/`subscriptionStatus` enums), DEV1-002 artifacts (`registerUser`/`createAdminUser`), and DEV2-002's `role` authScope in `backend/graphql/pothos/builder.ts` (the `gqlSchemaBuilder` export — no file named `gqlSchemaBuilder.ts` exists) exist; IF any artifact is missing THEN the agent SHALL record a ❌ entry in `deferred-items.md` and block dependent tasks.

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Schema Delta — Plan Lifecycle Columns)**: WHEN this ticket is implemented THEN the `plans` table SHALL gain exactly two columns: `is_active boolean NOT NULL DEFAULT true` and `deactivated_at timestamp NULL` (no default). The change SHALL be applied exclusively via `bun run db push` (repo policy: `db reset`/`db cleanGenerate` permanently disabled). No new tables, enums, or indexes SHALL be created (the catalog is a small lookup set; the partial-scan cost of `WHERE is_active` is trivially acceptable — recorded as a decision note, not an omission).
- **REQ-011 (Create Plan)**: WHEN an authenticated admin submits a valid plan (`title`, `sessionCount`, `price`, `currency`, `intervalDays`) THEN the system SHALL insert exactly one `plans` row with `is_active = true`, `deactivated_at = NULL`, server-generated `id`/`createdAt`/`updatedAt`, and SHALL return the created row. The service SHALL explicitly validate all inputs BEFORE any DB write (422 `VALIDATION` semantics), while the existing DB CHECK constraints remain as defense-in-depth.
- **REQ-012 (Validation Rules — Create & Update)**: WHEN plan input is processed THEN the service SHALL enforce, with localized field errors: `title` trimmed non-empty and ≤ 255 chars; `sessionCount` integer ≥ 1; `price` a non-negative decimal string matching `^\d{1,8}(\.\d{1,2})?$` (fits `decimal(10,2)`; string-carried everywhere to avoid float precision loss); `currency` matching `^[A-Z]{3}$` (ISO 4217 alpha-3; default `"EGP"`); `intervalDays` integer ≥ 1. IF any rule fails THEN the system SHALL reject with `ValidationError` carrying per-field `extensions.fields[]` per the DEV3-002 error contract — before touching the DB.
- **REQ-013 (Update Plan — Partial, Whitelisted)**: WHEN an admin edits a plan THEN the system SHALL accept a partial patch of the five mutable fields only (`title`, `sessionCount`, `price`, `currency`, `intervalDays`), SHALL validate every supplied field per REQ-012, SHALL reject a structurally empty patch with `VALIDATION`, and SHALL reject a nonexistent `id` with `NotFoundError("PLAN", …)` (`PLAN_NOT_FOUND`). Edits SHALL NOT touch `id`, `is_active`, `deactivated_at`, `created_at`, and SHALL set `updated_at` server-side.
- **REQ-014 (Deactivate Plan — Guarded Conditional Update)**: WHEN an admin deactivates an active plan THEN the system SHALL execute a single guarded statement of the form `UPDATE plans SET is_active = false, deactivated_at = now(), updated_at = now() WHERE id = <id> AND is_active = true RETURNING *` — with NO SELECT-then-UPDATE sequence. IF the plan id does not exist THEN the service SHALL throw `PLAN_NOT_FOUND`. IF the plan is already inactive THEN the guarded update SHALL match zero rows and the service SHALL throw `ConflictError` with code `PLAN_ALREADY_INACTIVE` (localized message). Deactivation SHALL NOT modify any `subscriptions`, `student_subscriptions`, `student_payments`, `students`, `wallet`, or `teacher_transaction` row.
- **REQ-015 (Reactivate Plan)**: WHEN an admin reactivates an inactive plan THEN the system SHALL execute the symmetric guarded update (`... SET is_active = true, deactivated_at = NULL ... WHERE id = <id> AND is_active = false RETURNING *`); a nonexistent id SHALL yield `PLAN_NOT_FOUND`, and an already-active plan SHALL yield `PLAN_ALREADY_ACTIVE` (CONFLICT semantics). The reactivation decision (marker cleared, history preserved only in `audit_logs` once DEV3-020 lands) SHALL be recorded in the decisions addendum (REQ-081).
- **REQ-016 (Catalog Visibility Split)**: WHEN plan listings are read THEN the system SHALL expose two distinct read paths: (a) `planCatalog` — authenticated, returns ONLY `is_active = true` plans, ordered by `created_at` ascending, exposing no admin-only metadata beyond the public shape; and (b) `adminPlans(includeInactive: Boolean = true)` — admin-gated, defaulting to the full catalog including deactivated rows with their `isActive`/`deactivatedAt` state. The deactivated-exclusion predicate SHALL live in exactly ONE place (shared repository filter or query composition), never re-implemented per caller.
- **REQ-017 (Deactivation Preserves Existing Subscriptions)**: IF a plan with existing active/expired/cancelled `subscriptions` (and their credited `students.balance_*` lanes) is deactivated THEN all such rows SHALL remain byte-identical after the operation (termination/conversion is DEV1-009 scope), and `subscription.status` (A.9) SHALL be unaffected.
- **REQ-018 (Forward-Only Edit Semantics)**: WHEN an admin edits a plan's `price`, `sessionCount`, or `intervalDays` THEN already-existing `subscriptions` rows (their `start_date`/`end_date`/status) and already-credited balances (INV-B2/B3) SHALL NOT be recomputed or rewritten; the new terms SHALL apply only to purchases made after the edit (DEV1-006 consumer). This forward-only rule SHALL be recorded in the decisions addendum as the known trade-off (no price snapshot column in MVP).
- **REQ-019 (Plan Varieties Are Title-Encoded)**: WHEN the catalog is designed THEN plan taxonomy (Hifz Jadid / Muraja'ah / Tathbeet / Atfal / Mukathaf / Tajweed) SHALL remain encoded in `plans.title` per FR-2.2, and the Teacher Verification Plan SHALL be an ordinary plan with `sessionCount = 5` per FR-2.3 — this ticket SHALL NOT introduce a `plan_type`/`kind` column; DEV1-006/DEV2-005 will resolve the verification plan by a documented lookup rule (`title` match or a seeded reference constant recorded in the canonical doc; the exact mechanism is owned by those tickets).
- **REQ-020 (No Hard Deletion Surface)**: WHEN the GraphQL schema is inspected THEN there SHALL be NO `deletePlan`/`removePlan` mutation; catalog rows SHALL only ever be created, edited, deactivated, or reactivated. A schema-level grep assertion SHALL prove the absence of any deletion operation over `plans`.
- **REQ-021 (Seed Parity)**: WHEN dev seeds run THEN the demo catalog (at minimum: one Hifz plan, one Tajweed plan, one "New Teacher Verification & Evaluation Plan" with `sessionCount = 5`, one deactivated plan) SHALL be provisioned through the service-layer find-or-create bootstrap pattern per `backend/db/seeds/AGENTS.md` — never via raw `@/backend/db/**` imports from seeders — and SHALL be safe to re-run (idempotent by stable title lookup).
- **REQ-022 (Money Typing Discipline)**: WHEN `price` flows through ANY layer THEN it SHALL be carried as a decimal string (Drizzle `decimal` → `string` at `$inferSelect`, GraphQL `String!` on input/output, frontend string rendering), and no `Float`/JS `number` coercion SHALL occur at the GraphQL boundary; arithmetic on price is PROHIBITED in this ticket (no aggregation exists).
- **REQ-023 (Registration/Auth Unchanged)**: WHEN this ticket ships THEN `registerUser`, login, refresh, and the DEV2-001 cookie/token contract SHALL remain behaviorally identical (no auth-surface edits beyond consuming `ctx.user`/`ctx.role`).

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BFLA — Admin-Only Mutation Gate)**: WHEN any of the three catalog mutations (`createPlan`, `updatePlan`, `setPlanActiveStatus`) is invoked THEN the Pothos field SHALL carry `authScopes: { authenticated: true, role: [UserRole.Admin] }` (value-imported `UserRole`), such that anonymous callers receive `UNAUTHORIZED` (401 semantics, via `scopeAuth`) and authenticated non-admin callers (student/parent/teacher) receive `FORBIDDEN` (403 semantics) before any resolver body or service executes. No permission-bundle wiring is added in this ticket (the DEV2-002 `permission` scope remains a documented placeholder; role is the coarse gate used here).
- **REQ-031 (BOPLA — Whitelist Mapping)**: WHEN input is mapped to Drizzle inserts/updates THEN the service SHALL copy fields one-by-one from the whitelist (`title`, `sessionCount`, `price`, `currency`, `intervalDays`) and SHALL NEVER spread `{ ...input }`; client-supplied `id`, `isActive`, `deactivatedAt`, `createdAt`, `updatedAt`, or any extra field SHALL be ignored. `PlanSubmitInput` SHALL structurally omit all server-controlled fields (creation of an already-inactive plan is impossible by type construction).
- **REQ-032 (BOLA / IDOR & Data Sensitivity)**: WHEN any catalog operation resolves identity THEN the admin actor SHALL come exclusively from `ctx.user.id` (RBAC already enforces role fit); plan IDs are non-sensitive catalog identifiers whose enumeration reveals only public commercial data, so `PLAN_NOT_FOUND` (not `FORBIDDEN`) is the documented response for a bad `id` — no existence-oracle concern exists here, and this ruling SHALL be documented in the canonical doc so future sensitive resources don't inherit it by copy-paste.
- **REQ-033 (Read-Surface Least Privilege)**: WHEN `planCatalog` executes THEN it SHALL require an authenticated context and SHALL expose only non-sensitive plan fields; no user data, financial data, or governance state SHALL be joined into the catalog payload. No LIKE/search input exists on any catalog operation in this ticket, so `escapeLikeWildcards` is documented as not-applicable (any future search endpoint MUST use it).
- **REQ-034 (Abuse & Rate Posture)**: WHEN the admin mutations and catalog queries execute THEN they SHALL inherit the platform's global GraphQL rate-limit posture (fail-open stub per DEV1-002/DEV2-002 precedent; real limits owned by DEV2-002) — no new public endpoint warrants additional limiting; list queries SHALL be bounded by the small catalog size (no pagination required; the ruling is documented so future catalog growth revisits it).
- **REQ-035 (Defense in Depth)**: WHEN any path (present or future, script or bug) attempts to write `session_count <= 0`, `price < 0`, or `interval_days <= 0` THEN the existing DB CHECK constraints SHALL reject it at the database layer independently of service validation.

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (No TOCTOU on State Transitions)**: WHEN deactivate/reactivate executes THEN the single guarded conditional UPDATE (REQ-014/015) SHALL be the only mutation primitive; concurrent double-deactivation (proven via `Promise.allSettled`) SHALL yield exactly one success and one `PLAN_ALREADY_INACTIVE` — serialization is provided by PostgreSQL row locking inside the statement, so no advisory lock or `SELECT FOR UPDATE` is required.
- **REQ-041 (Single-Statement Write Discipline)**: WHEN any catalog mutation executes THEN all writes SHALL be single statements (create = one INSERT, edit = one UPDATE, state change = one guarded UPDATE); no multi-write flow exists, so no explicit Drizzle transaction is required in this ticket — every repository method MUST still accept optional `tx?: DBTransaction` (propagated when supplied) per `backend/db/repo/AGENTS.md` so future consumers (DEV1-009) can compose them transactionally.
- **REQ-042 (Schema Application Discipline)**: WHEN the schema delta lands THEN the Drizzle schema (`backend/db/schema/billing/plans.ts`) and canonical types SHALL be updated in the same commit set to prevent drift; `bun tsgo` SHALL pass, and the new columns SHALL flow into `PlanSelectType`/`PlanInsertType` automatically via `$inferSelect`/`$inferInsert`.
- **REQ-043 (Create Double-Submit Ruling)**: WHEN an admin double-submits plan creation THEN two plan rows MAY result (plans carry no natural unique key and duplicate titles are historically possible — e.g., annual price refreshes); this tolerance is an explicit documented decision (admin-only, low-frequency surface; `docs/IDEMPOTENCY.md` mandates keys only for Student/Invoice/Class-Instance/Payment creation — plan creation is outside that scope), and the UI SHALL additionally guard with a disabled-during-flight submit button as UX mitigation.
- **REQ-044 (Purchase-Time Race Forward Contract)**: WHEN DEV1-006 implements purchase THEN it SHALL re-validate `is_active = true` inside its own transaction at purchase time (a plan browsed-then-deactivated mid-flow must not be purchasable); this ticket documents the contract and ships the read predicate it depends on, but implements no purchase logic (deferred item D2 converts the contract into enforcement).
- **REQ-045 (Concurrent Edit Semantics)**: WHEN two admins edit the same plan concurrently THEN last-write-wins SHALL apply per-field-patch (acceptable for a low-frequency admin catalog surface, recorded in the canonical doc); no optimistic-version column is added (documented non-goal; can be revisited if analytics/audit surfaces require it).

### 2.5 Validation & Error Contracts

- **REQ-050 (DomainError Discipline & Code Map)**: WHEN any error surfaces from the catalog path THEN it SHALL be a `DomainError` subclass per `docs/graphql/domain-error-extensions-code.md`, using exactly this mapping: unauthenticated → `UNAUTHORIZED`; non-admin role → `FORBIDDEN`; missing plan → `NotFoundError("PLAN", …)` → `PLAN_NOT_FOUND` (entity name, never the full code, per the double-suffix rule); invalid input → `VALIDATION` (+ `extensions.fields[]` where field-level); state conflicts → `ConflictError` carrying the stable custom code `PLAN_ALREADY_INACTIVE` / `PLAN_ALREADY_ACTIVE` as `extensions.code` (overriding the default `CONFLICT`; requires extending `backend/lib/errors.ts` `ConflictError` with the same overloaded custom-code constructor `ValidationError` has). Plain `new Error(...)` is PROHIBITED.
- **REQ-051 (Localization of Every Client-Visible String)**: WHEN errors/messages are produced THEN services SHALL use `getServerTranslations(locale).errorsTranslations` and resolvers SHALL use `ctx.t("errors")`; new keys (at minimum: `planNotFound`, `planAlreadyInactive`, `planAlreadyActive`, `planTitleRequired`, `planTitleTooLong`, `planSessionCountInvalid`, `planPriceInvalid`, `planCurrencyInvalid`, `planIntervalDaysInvalid`) SHALL be added to the `errors` namespace under a `planCatalog` grouping in all three contract files (`shared/locale/types/errors/`, `shared/locale/en/errors/`, `shared/locale/ar/errors/`) — compile-time `ErrorsLabels`/`Translations` interface parity is the gate (missing key = `tsgo` failure).
- **REQ-052 (DB CHECK Safety-Net Translation)**: WHEN a CHECK-constraint violation (PostgreSQL `23514`) escapes service validation THEN it SHALL be translated via the existing cycle-safe `Error.cause` traversal pattern (DEV1-002 `isUniqueViolation` precedent) into a localized `ValidationError`, never masked as an unclassified 500 and never surfaced with raw SQL text to the client.
- **REQ-053 (Logging Discipline)**: WHEN expected business rejections occur (not-found, validation, state conflict, forbidden) THEN they SHALL be logged via `logger.logDomainError` (debug under `TEST_SERVER=1`, warn in production); unexpected failures SHALL use `logger.error`; `console.*` is PROHIBITED in all touched files. No price/payment-adjacent payload logging beyond the plan id and code.
- **REQ-054 (UI i18n Namespace Registration)**: WHEN the admin plans page renders THEN a new `plans` UI namespace SHALL be registered per `shared/locale/AGENTS.md` conventions (labels types interface + `ar` + `en` implementations + `plansTranslations` entry in the `Translations` interface + `Plans` namespace handle registered under `shared/locale/namespaces/`), and all page chrome (headings, buttons, dialog copy, status badges, empty/error states) SHALL come from it via property access only.

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (GraphQL Surface — Exact Contract)**: WHEN the schema is built THEN the catalog surface SHALL be:
  ```graphql
  type Plan {
    id: ID!
    title: String!
    sessionCount: Int!
    price: String!          # decimal string (REQ-022)
    currency: String!
    intervalDays: Int!
    isActive: Boolean!
    deactivatedAt: DateTime
    createdAt: DateTime!
    updatedAt: DateTime!
  }
  input CreatePlanInput { title: String!, sessionCount: Int!, price: String!, currency: String!, intervalDays: Int! }
  input UpdatePlanInput { title: String, sessionCount: Int, price: String, currency: String, intervalDays: Int }
  extend type Query {
    planCatalog: [Plan!]!   # authenticated; active-only
    adminPlans(includeInactive: Boolean = true): [Plan!]!   # role: [Admin]
  }
  extend type Mutation {
    createPlan(input: CreatePlanInput!): Plan!        # role: [Admin]
    updatePlan(id: ID!, input: UpdatePlanInput!): Plan!      # role: [Admin]
    setPlanActiveStatus(id: ID!, isActive: Boolean!): Plan!  # role: [Admin]
  }
  ```
  The single canonical `PlanPothosObject` SHALL back all operations (`id` exposed for Apollo normalization), Pothos types SHALL be backed by `PlanReturnType`/`PlanSubmitInput`/`PlanUpdateInput` from `@/backend/types` (no resolver-local types), mutations SHALL declare the REQ-030 authScopes, and `bun run generate:gqlSchema && bun codegen` SHALL run and have its artifacts committed in the same change set.
- **REQ-061 (Document Naming & Placement)**: WHEN frontend documents are authored THEN they SHALL live in `frontend/graphql/sharedDocuments/billing/plan-catalog.documents.ts` as `planCatalogQueryDocument`, `adminPlansQueryDocument`, `createPlanMutationDocument`, `updatePlanMutationDocument`, `setPlanActiveStatusMutationDocument` — `TypedDocumentNode<…>` imported from `@apollo/client`, codegen types only, `id` in every object selection, no `useLazyQuery`, hooks from `@apollo/client/react`, and sub-directory/top-level barrels updated per `frontend/graphql/sharedDocuments/AGENTS.md`.
- **REQ-062 (Route & Server Guard)**: WHEN the admin page renders THEN it SHALL live at `app/(dashboard)/admin/plans/page.tsx`, guarded server-side by `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/plans" })` (DEV2-001 contract: anonymous → `/login?redirect=…`, role mismatch → the caller's role-specific dashboard via `roleDashboardPath` — never bare `/dashboard`, per `docs/auth/REDIRECT_LOOP_FIX.md`); the page SHALL be a Server Component that resolves `getTranslations(locale)` and delegates interactivity to a client container (`frontend/views/admin/plans/…`) wired to the REQ-061 documents.
- **REQ-063 (MUI v9 / React 19 Discipline)**: WHEN any frontend file is authored THEN all styling SHALL be inside `sx` (no direct style props on Typography/Box/Stack/Grid), icons SHALL use `*Outlined` naming, colors SHALL come from `theme.palette.*` via the theme-callback pattern, forms SHALL submit via `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>` (never `FormEvent`), and submit buttons SHALL disable while the mutation is in flight (REQ-043 UX mitigation).
- **REQ-064 (Permission & Rendering Matrix)**: WHEN the catalog surface is exercised THEN the following SHALL hold and be test-proven:

  | Caller | `planCatalog` | `adminPlans` | `createPlan`/`updatePlan`/`setPlanActiveStatus` | `/admin/plans` page |
  |---|---|---|---|---|
  | Anonymous | `UNAUTHORIZED` | `UNAUTHORIZED` | `UNAUTHORIZED` | redirect → `/login` |
  | Student | ✅ active-only | `FORBIDDEN` | `FORBIDDEN` | redirect → role dashboard |
  | Parent (read-only, INV-P2) | ✅ active-only | `FORBIDDEN` | `FORBIDDEN` | redirect → role dashboard |
  | Teacher (incl. applicant) | ✅ active-only | `FORBIDDEN` | `FORBIDDEN` | redirect → role dashboard |
  | Super Admin | ✅ active-only | ✅ full catalog incl. inactive | ✅ full control | ✅ page renders |

  The admin list SHALL render deactivated plans with a localized status badge (e.g., translated "Active"/"Inactive" chips) distinct from active chips via `theme.palette` tokens; the student-facing catalog surface will omit deactivated rows entirely (server-filtered — never client-filtered).

### 2.7 Test Coverage

- **REQ-070 (Coverage Target)**: WHEN tests are authored THEN all new service and repository code SHALL reach 100% statement and branch coverage (`bun test --coverage` on the new/modified suites), including every guard branch of REQ-012 and both zero-row branches of the guarded updates.
- **REQ-071 (DB Test Discipline)**: WHEN DB tests execute THEN every test SHALL run inside `runInRollback`, pass `tx` to every repository/Drizzle call (position verified per signature), create entities exclusively through `entity-setup.ts` helpers (never seed data), and assert failures via the `expectRepoError` try/catch helper — NEVER `expect(...).rejects.toThrow()` inside `runInRollback`; DB-bound tests SHALL run via `bun run test/scripts/run-test.ts <path>` (the canonical runner location — root AGENTS.md documents it as the log-capturing runner mandatory for DB tests).
- **REQ-072 (GraphQL Role Matrix)**: WHEN integration tests run (`setupTestServerLifecycle` + `testClient`) THEN they SHALL prove the full REQ-064 matrix (`extensions.code` asserted per cell: `UNAUTHORIZED` anonymous, `FORBIDDEN` for student/parent/teacher on all four admin surfaces, success for admin) and SHALL prove the visibility split (deactivated plan absent from `planCatalog`, present in `adminPlans`).
- **REQ-073 (Validation Matrix — Boundaries)**: WHEN validation tests run THEN they SHALL cover at minimum: empty/whitespace-only title, 255-char title (pass), 256-char title (fail); `sessionCount` = 0 (fail), 1 (pass), −1 (fail), non-integer (fail); `price` = `"0.00"` (pass), `"−0.01"` fail, `"abc"` fail, `"1.005"` fail (cent-precision), `"99999999.99"` (pass, `decimal(10,2)` bound), `"100000000.00"` (fail, overflow); `currency` = `"EGP"` (pass), `"egp"` (fail, case), `"EG"` (fail, length); `intervalDays` = 0 (fail), 1 (pass); plus DB-level CHECK rejection passes via `expectRepoError` for direct-write bypass attempts (REQ-052/035).
- **REQ-074 (Concurrency Probes)**: WHEN chaos-tier tests run THEN they SHALL include: (a) `Promise.allSettled` double-deactivation of the same plan → exactly one success + one `PLAN_ALREADY_INACTIVE` with final row state exactly once transitioned; (b) deactivate/reactivate round-trip converging to a consistent state; (c) concurrent `updatePlan` patches converging to last-write-wins without error.
- **REQ-075 (Deactivation Preservation Proof)**: WHEN the deactivated-plan test runs THEN a fixture subscription linked to the plan (created via entity-setup helpers inside `runInRollback`) SHALL be asserted byte-identical (status, dates) after deactivation, and student balance fixtures SHALL be untouched (REQ-017/018).
- **REQ-076 (Component Test Discipline)**: WHEN frontend tests are authored for the admin plans page THEN they SHALL use Happy DOM + Apollo mocks, `translation-preload.ts` + `readTranslation(handle, locale)`, `TestWrapper locale`, translation-driven matchers only (zero hardcoded UI strings), and `bun run test/scripts/run-test.ts` for execution; deactivated-badge rendering and disabled-during-flight submit SHALL be asserted.
- **REQ-077 (Quality Gates)**: WHEN tasks complete THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 for every created/modified file; and the REQ-020 no-delete-surface grep assertion SHALL be part of the verification.

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Doc)**: WHEN the plan closes THEN a canonical reference doc SHALL be created at `docs/billing/plan-catalog.md` (Why FR-2.1/2.2/2.3 → lifecycle columns → guarded state-transition pattern → catalog/admin visibility split → forward-only edits → error code map → DEV1-006/DEV2-005/DEV1-009 consumption guide), following the standard doc structure (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents).
- **REQ-081 (Invariant & Decision Addenda)**: WHEN knowledge propagation runs THEN `docs/specs/state-machine-invariants.md` SHALL gain a "Plan Catalog Lifecycle" section with invariants **INV-PC1** (a deactivated plan never appears in the active catalog and can never be purchased while inactive), **INV-PC2** (deactivation/edit never mutates existing subscriptions or credited balances), **INV-PC3** (plan rows are never hard-deleted); and `docs/specs/open-decisions-and-gaps.md` SHALL gain a resolved addendum recording: the activation-flag schema delta (A-category addendum), forward-only edit semantics, title-encoded taxonomy (FR-2.2 reaffirmed), and the create double-submit tolerance ruling (REQ-043).
- **REQ-082 (AGENTS.md Propagation)**: WHEN propagation runs THEN layer rule-only one-liners SHALL be added referencing `docs/billing/plan-catalog.md` in `backend/services/AGENTS.md` (catalog service + forward-only edit rule), `backend/graphql/AGENTS.md` (role-scope mutation gate example + required `id` on Plan), and root `AGENTS.md` "Important References". AGENTS.md entries SHALL contain rules/pointers only — no code, no implementation recipes.
- **REQ-083 (Outcome & Deferred-Items Gate)**: WHEN the plan is considered complete THEN every task SHALL have an `outcome/<task-id>-outcome.md` under `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/outcome/`, the plan-review gate outcome SHALL exist before implementation, and `grep -c "❌\|⚠️" ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` SHALL equal 0 except the explicitly non-blocking pre-seeded D1/D2 (targeted at DEV3-020 / DEV1-006 with documented owners); a final baseline comparison SHALL prove zero NEW tsgo/biome/lint errors versus the REQ-001 baseline.

---

## 3. System Decisions & State Machine Invariants Alignment

### Decision References (`docs/specs/open-decisions-and-gaps.md`)

| Decision | Relevance to DEV1-005 | Enforcing Requirements |
|---|---|---|
| **FR-2.1** (admin-exclusive plan CRUD) | Primary mandate: all mutations admin-gated; no other role may mutate the catalog. | REQ-030, REQ-060, REQ-064, REQ-072 |
| **FR-2.2** (student plan varieties) | Varieties are title-encoded; NO `plan_type` column is added. | REQ-019, REQ-081 |
| **FR-2.3** (Teacher Verification Plan, 5 sessions) | Realized as an ordinary catalog row with `sessionCount = 5`; no special schema surface. | REQ-019, REQ-021, REQ-081 |
| **A.9** (subscription lifecycle status) | Plan activation is an **independent** lifecycle: deactivating a plan never rewrites `subscriptions.status`. | REQ-017, REQ-075 |
| **B.8 / C.2** (generic `subscriptions.user_id`) | The single plans catalog serves BOTH student plans and teacher-verification purchases — the catalog is deliberately role-agnostic on read. | REQ-016, REQ-019 |
| **B.9** (offline payment audit fields) | Out of scope but protected: DEV3-019 will reference active plans; the active predicate shipped here is the shared guard. | REQ-016, REQ-044 |
| **B.17** (prorated plan changes) | Belongs to subscription management (DEV1-009), NOT plan editing; forward-only semantics prevent collision. | REQ-018 |
| **A.5** (audit trail) | Plan mutations are admin actions destined for `audit_logs`; hook points are documented, writes are deferred to DEV3-020 (D1). | REQ-080, REQ-083 |
| **A.7 / INV-U** (governance on `users`) | Governed admins (deleted/blocked) fail earlier at the DEV2-001 fail-closed context boundary; no additional plan-level handling. | REQ-030 note, REQ-004 |

### State Machine & Lifecycle Invariants (`docs/specs/state-machine-invariants.md`)

- **INV-B1..B6 (Balances)**: Untouched and protected — catalog operations perform zero balance writes; INV-B2 (full credit on activation) and INV-B3 (expiry) are shielded by forward-only edit semantics (REQ-018) and proven by fixture immutability tests (REQ-075).
- **INV-S1..S8 (Session)**: Not exercised by this ticket; no session rows are read or written.
- **INV-TV1..TV7 (Verification)**: Defer-compatible — this ticket guarantees the verification plan CAN exist and be catalog-visible (enabling DEV2-005) without engaging INV-TV3 cooldown gating (owned by the verification purchase path).
- **INV-W1..W8 (Wallet)**, **INV-PAY1..PAY5 (Payments)**: Not exercised; zero financial writes.
- **INV-P1..P4 (Parent)**: INV-P2 read-only posture preserved — parents may read the active catalog but are structurally denied from all admin surfaces (REQ-064).
- **New invariants introduced** (addendum, REQ-081): **INV-PC1..PC3** (see 2.8), establishing the plan catalog lifecycle as a first-class, testable contract.

### Canonical Workflow & Standards Alignment

- **Workflow 05 (Admin Governance Override)**: This ticket implements the "Plan Management" row of the admin governance module (CRUD + lifecycle), respecting Workflow 05's audit posture via the D1 hook contract.
- **Workflow 01 (Teacher Verification)**: The verification plan catalog entry is the purchase target of Workflow 01's opening step; REQ-019 keeps that path unblocked.
- **`docs/DATABASE_MIGRATIONS.md`**: Schema via `bun run db push` only; no custom SQL, no `CONCURRENTLY`, no seeder-owned system data — REQ-010/042 enforce it.
- **`docs/IDEMPOTENCY.md`**: Scope analysis performed (REQ-043): plan creation is outside the mandated key set (Student/Invoice/Class/Payment); double-submit tolerated by decision + UI guard.
- **`docs/drizzle/prepared-statements.md` / `docs/graphql/dataloader-batching.md`**: Repository reads follow `queryDb(tx)` conventions; simple hot reads (active catalog) MAY use module-level prepared statements on the TCP path per repo rules; `id` is exposed on the canonical `Plan` object for Apollo normalization; no list-typed `t.loadable()` misuse.
- **`docs/graphql/domain-error-extensions-code.md` + DEV3-002 error contract**: REQ-050/051/052 bind the catalog surface to the shared taxonomy (`UNAUTHORIZED`/`FORBIDDEN`/`PLAN_NOT_FOUND`/`VALIDATION`/`CONFLICT`), field-leveling, localization, and masking rules.
- **DEV1-002 precedent / DEV1-004 design reference**: 23505-style cause-chain translation (extended here to 23514) is reused from DEV1-002 code; the guarded conditional UPDATE pattern for at-most-once/at-most-one transitions is fully specified by REQ-014/015 + plan.md D2 — the sprint_0 DEV1-004 plan doc is a documented design reference only (no DEV1-004 code exists in this repo; 0.3 gate D3 ruling); decisions-addendum discipline is reused, not reinvented.

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001..004 | Process baseline; dependency guards (DEV1-001/002, DEV2-001/002) | N/A — plan artifacts | — | — | `outcome/phase0-baseline-outcome.md`; plan-review gate |
| REQ-002 / REQ-054 | i18n namespace registry rules (`shared/locale/AGENTS.md`) | `getServerTranslations(locale).errorsTranslations` usage | `ctx.t("errors")` in resolvers | `useAppTranslation(Plans)` + `getTranslations(locale)` | tsgo `Translations`-parity gate; parity test (ar/en) |
| REQ-003 | Canonical types (`backend/types/AGENTS.md`) | `backend/types/billing/plan.types.ts` (`PlanReturnType`, `PlanSubmitInput`, `PlanUpdateInput`) | Pothos consumes canonical types only | Codegen types from `graphql.ts` | `review-types` wave; tsgo via sub-loop |
| REQ-010 / REQ-042 | Schema-delta addendum; DBMigrations policy | `backend/db/schema/billing/plans.ts` delta in the same commit set as the code; types flow via `$infer*` | — | — | `bun run db push` log; column-presence test |
| REQ-011 / REQ-012 | FR-2.1; DEV3-002 validation contract | `PlanCatalogService.createPlan` + `validatePlanInput` | `createPlan` | Create dialog (translated field errors) | REQ-073 validation matrix; happy-path create test |
| REQ-013 | FR-2.1; BOPLA whitelist | `PlanCatalogService.updatePlan` → `PlanRepository.updatePlan` | `updatePlan` | Edit dialog | Partial-patch tests; not-found test; empty-patch `VALIDATION` test |
| REQ-014 / REQ-015 / REQ-040 | INV-PC1 (new); spec-defined guarded-update pattern (DEV1-004 = documented design reference only — 0.3 gate D3 ruling) | `PlanCatalogService.setPlanActiveStatus` → guarded conditional UPDATE (`RETURNING`) | `setPlanActiveStatus` | Activate/Deactivate buttons (confirm + status chip) | Double-deactivate `Promise.allSettled` test (REQ-074); `PLAN_ALREADY_INACTIVE/ACTIVE` code assertions |
| REQ-016 | B.8/C.2; catalog split | `PlanCatalogService.listActiveCatalog` / `listForAdmin` → shared active-filter predicate in `PlanRepository` | `planCatalog`, `adminPlans` | Catalog read today: admin page; student view consumed by DEV1-006 | REQ-072 visibility-split assertions |
| REQ-017 / REQ-018 | A.9; INV-B2/B3 protection; forward-only edits | Service docs + no-cascade implementation (zero joins/writes to subscriptions/balances) | Mutation behavior assertions | — | REQ-075 fixture-immutability test (subscriptions + balances byte-identical) |
| REQ-019 | FR-2.2/FR-2.3 | Canonical doc lookup rule for verification plan | — | Demo seed produces verification plan | Seed idempotency run; `REQ-021` service-bootstrap seed test |
| REQ-020 | INV-PC3 (new); append-and-deactivate policy | No delete path exists by construction | Schema grep: no `deletePlan`/`removePlan` | — | REQ-077 grep assertion in verification task |
| REQ-021 | Seeder service-only rule | Seed bootstrap via `PlanCatalogService` find-or-create | — | — | `bun db seed` re-run idempotence proof |
| REQ-022 | Money-precision rule | Decimal string preserved through types/service | `price: String!` | String rendering in table | Type-level tsgo gate + boundary price tests (REQ-073) |
| REQ-023 | DEV2-001 contract stability | No auth-surface change | Existing auth ops untouched | — | Existing auth suites stay green (baseline gate) |
| REQ-030 / REQ-064 | DEV2-002 `role` scope; INV-P2 | Resolver authScopes `role: [UserRole.Admin]` | All 3 mutations + `adminPlans` + `planCatalog` auth | `/admin/plans` server guard | REQ-072 full role matrix via `testClient` + page-redirect tests |
| REQ-031 | BOPLA defense | Field-by-field mapping; no `{ ...input }` | Input types structurally omit server fields | — | BOPLA test: smuggled `id`/`isActive`/`createdAt` ignored |
| REQ-032 / REQ-033 | BOLA ruling; least-privilege read | Identity from `ctx.user.id`; non-sensitive catalog ruling documented | `planCatalog` without joins | — | Security review wave; no-oracle doc assertion |
| REQ-034 / REQ-035 | Rate posture precedent; CHECK defense-in-depth | Service-first validation + inherited limiter posture; DB CHECKs untouched | — | — | REQ-073 direct-write CHECK rejection tests via `expectRepoError` |
| REQ-041 | Repo `tx` contract | All `PlanRepository` methods accept `tx?: DBTransaction` | — | — | Signature review + rollback-discipline tests (REQ-071) |
| REQ-043 / REQ-044 / REQ-045 | IDEMPOTENCY scope analysis; forward contract to DEV1-006; last-write-wins ruling | Documented in canonical doc; disabled-submit UI guard | — | Disabled-while-pending button assertion | REQ-076 component test; deferred-items D2 linkage |
| REQ-050..053 | Error taxonomy (`domain-error-extensions-code.md`, DEV3-002) | `DomainError` subclasses; `NotFoundError("PLAN", …)`; `ConflictError` custom codes; logDomainError | `extensions.code` assertions incl. `extensions.fields[]` | Translated inline/banner errors | Integration tests per code; log-capture assertions via run-test |
| REQ-060..063 | GraphQL/MUI/React-19 discipline | Pothos: `billing/plan.pothos.ts` + mutation/query files; codegen run | REQ-060 SDL surface; documents in `sharedDocuments/billing/` | `frontend/views/admin/plans/*` container | Codegen artifacts committed; sub-loop per file (REQ-077) |
| REQ-070..077 | Test pyramid rules | `backend/db/test/logic/billing/plan-catalog*.test.ts`, repo tests, service tests | `setupTestServerLifecycle` + `testClient` suites | Happy DOM component suites | Coverage report (100% on new files); all suites green |
| REQ-080..083 | Knowledge propagation; INV-PC addenda; deferred gate | `docs/billing/plan-catalog.md`, spec addenda files | — | — | Doc existence; `grep -c "❌\|⚠️"` = 0 (except D1/D2 owners); baseline delta = 0 |

---

**End of Specification — DEV1-005.** Ready for `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/plan.md` (Phase 2 design), gated by `@plan-review` (Phase 1.5) before any implementation begins.

