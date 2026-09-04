```markdown
# Requirements & Specification: DEV3-020 — Immutable Audit Logging for All Admin Actions

> **Ticket:** DEV3-020 (Sprint 3 · Dev 3 · 5 SP · blocked by DEV3-016 — DONE)
> **Plan directory (verbatim — every header, ledger path, task 0.1, and deferred self-reference MUST use this exact string):** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`
> **Specs source anchors:** `docs/planning/TICKETS.md` §DEV3-020, `docs/specs/functional-requirements.md` FR-10.5, `docs/specs/open-decisions-and-gaps.md` A.5, `docs/workflows/05-admin-governance-override.md` §7 "Audit Trail", `docs/planning/PRODUCTION_READINESS.md` §1.3 (criteria 1.3.1–1.3.5), `docs/admin/user-management.md` (DEV3-016 canonical substrate).
> **Ledger (initialized in Task 0):** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md`
>
> **Critical design note (Existing Codebase State):** the audit WRITE half of the Workflow 05 contract is ALREADY SHIPPED and test-locked by DEV3-016: the single in-transaction writer `AuditService.createAuditLog(contract, tx)` (`backend/services/admin/audit.service.ts:82-90`), the composed contract `AuditLogWriteContract` (`backend/types/contracts/admin-audit.contract.types.ts:22-30`), the table (`backend/db/schema/audit/audit-logs.ts:30-46`), and the 7-value enum (`backend/enum/audit/audit-action-type.enum.ts:6-14`). DEV3-020 SHALL NOT re-plan or fork the writer. This ticket's net-new scope is exactly: (a) the **global audit-trail READ surface** (repository + service + `adminAuditLogs` query + `/audit` page) satisfying the ticket's "review the audit trail … filter by actor_id, action_type, entity_type, entity_id, and date range" acceptance criterion, (b) the **immutability HARDENING + PERMANENT PROOF** (application single-writer surface lock + DB trigger tier, environment-aware), and (c) the cross-actor journey proving producer→observer→denial behavior end-to-end.

---

## 1. Executive Summary & Problem Statement

- **Feature:** A governed, admin-only audit-trail browsing surface at `/audit` backed by a new `adminAuditLogs` GraphQL query — paginated, newest-first, filterable by actor, action type, entity type, entity id, and date range over the append-only `audit_logs` table — plus the permanently test-locked immutability contract for that table (application tier: there IS no mutation API; database tier: trigger protection, verified-or-created as custom migration SQL).

- **Problem from user perspective:**
  - **Super Admin (Workflow 05 §7 "Review Audit Trail"):** after DEV3-016, every governance mutation lands an audit row, but there is no place to *review the whole trail*. The only existing read is per-user activity (`AdminUserRepository.getActivity`, `backend/db/repo/admin/admin-user.repository.ts:510-528`) nested inside one user's detail page. The admin cannot answer "who did what, to which entity, when — across the platform." FR-10.5 demands that review surface; PRODUCTION_READINESS 1.3.4 demands the filters.
  - **Platform integrity owner:** `audit_logs` is the accountability spine (decision A.5: append-only, immutable). Today, immutability rests on documentation and on DB triggers whose presence is environment-dependent (custom SQL migrations apply via `bun db migrate`; push-provisioned test databases lack them — the teardown helper `withAuditDeleteTriggersSuspended` at `test/helpers/db-cleanup.ts:83-109` is written precisely around that asymmetry). This ticket converts that posture from *claimed* to *permanently proven*.
  - **Downstream producers (DEV3-017/018/019/021/022b/022d):** suspend/block, cold-start, onboarding, session governance, financial approval, and broadcast tickets write `override`/`adjust`/`suspend` and `entityType: "notification"` rows — this surface must render ALL seven action types and BOTH `entityId` shapes (`number` and `null`; the column is nullable at `backend/db/schema/audit/audit-logs.ts:39`, and DEV3-022d's broadcast writes it as `null`).

- **Business value:** completes Workflow 05 §7 ("Review Audit Trail" — the read half the Workflow lists as an admin capability), satisfies the PRODUCTION_READINESS §1.3 audit-completeness gate items 1.3.1–1.3.5 in one verifiable surface, and gives the M3 release-gate walkthrough ("admin can perform all governance operations with audit logging" — `docs/planning/ROADMAP.md` M3) its visible accountability demo.

- **Actors involved:**
  | Actor | Role on this surface |
  |---|---|
  | **Super Admin** | Sole reader. Browses/filters the full trail. Gains NO write here. |
  | **Producing services** (existing `AdminUserManagementService` mutations now; later DEV3-017..022d) | Writers whose committed rows become visible. Unmodified. |
  | **Student / Teacher / Parent** | No access (BFLA `FORBIDDEN` at scope AND service tiers). |
  | **System (test journeys)** | Fixture provisioning (incl. direct fixture-level audit rows for not-yet-shipped producer action types). |

- **Non-goals (explicitly OUT of scope):**
  - **NO new audit writers and NO edits to producer services.** `AuditService.createAuditLog` remains the single writer; producer emission coverage belongs to each producer ticket (DEV3-017..022d) and to DEV2-021's audit-completeness verification ticket.
  - **NO mutation surface of any kind** — no edit, no delete, no redact, no export-job writer. There is deliberately no `adminAuditLogDetail` resolver either; the list row IS the detail.
  - **NO CSV/PDF export, NO scheduled reports, NO alerting, NO realtime push** for audit events.
  - **NO details-content redesign.** The write-side content contract (names + metadata only, capped ≤2000 chars — DEV3-016 REQ-020/REQ-052) is consumed as-is; this layer adds no re-sealing and no per-entity detail projections (the `changedFields` projection stays scoped to DEV3-016's per-user activity surface).
  - **NO entity-type dropdown service tix‑adjacent extras** (a `SELECT DISTINCT entity_type` feed for the filter UI is recorded as a deferred item; v1 ships exact-match free text — see REQ-011/REQ-061 and ledger item D-ET-DROPDOWN).
  - **NO Drizzle schema changes.** `audit_logs` gains nothing. The ONLY conditional structural artifact is the DB-immutability trigger as a raw custom-SQL migration (VERIFIED PRESENT and shipped today: `backend/db/migration/3-immutability-triggers.sql`, applied via `backend/drizzle/20260825222701_custom_3-immutability-triggers/migration.sql`; the conditional fires only if drift is found, REQ-020) — the sanctioned channel for triggers per `docs/DATABASE_MIGRATIONS.md`.
  - **NO request-time governance re-check hardening.** The documented governance window posture of the GraphQL context boundary is acknowledged (REQ-033), not re-litigated.

---

## 2. Requirements & Acceptance Criteria (EARS Format)

### 2.1 Baseline & Foundational Preparation (MANDATORY)

- **REQ-001 (Pre-Implementation Baseline & Ledger):** WHEN implementation begins THEN the executing agent SHALL record baseline error counts (`bun tsgo`, `bun run oxlint`, `bun biome:check`, `bun run lint --json --id baseline`) AND initialize `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md` AND write `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/phase0-baseline-outcome.md` capturing counts and the pre-existing modified-file set (`git diff --name-only`).

- **REQ-002 (Type-Safe i18n & Enum Value Imports Compliance):**
  - Client components MUST use `useAppTranslation(<NamespaceHandle>)` with `defineNamespace` handle consts (e.g. `AdminUsers`) and property access — never string literals, never a `Translation` enum (it does NOT exist), never `t('key')`.
  - Server components MUST use `getTranslations(locale)` (ONE argument, full `Translations` tree) and property access.
  - GraphQL resolvers MUST use `ctx.t("errorsTranslations")` (precedent: `backend/graphql/mutation/notifications/notification.mutation.ts:114-117`).
  - Services MUST use `getServerTranslations(locale)` from `@/shared/locale/server-graphql` (ONE argument — `shared/locale/server-graphql.ts:3-5`).
  - All enum usages at runtime (`UserRole`, `AuditActionType`) MUST be VALUE imports with enum members, never string literals.
  - FORBIDDEN: `next-intl`, `getBackendTranslations`, `shared/messages/` references, hardcoded user-facing strings, `console.*`.

- **REQ-003 (Canonical Types Discipline):** WHEN any code is authored THEN new view/shape types SHALL live in `backend/types/audit/audit-trail.types.ts` (NEW; barrel `backend/types/audit/index.ts` gains `export * from "./audit-trail.types";` — the barrel currently re-exports only `./audit-log.types`, bundle: `backend/types/audit/index.ts:1`) reusing the existing `AuditLogSelectType`/`AuditLogInsertType` (`backend/types/audit/audit-log.types.ts:3-4`). NO local types in Pothos resolvers; NO service-layer `.types.ts` files.

- **REQ-004 (Verification-First Reuse Guard — verify-then-claim):** WHEN domain work begins THEN the agent SHALL verify against the bundled/live code and REUSE (never fork):
  - the single writer `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82-90`) — READ-ONLY reference;
  - `AuditLogWriteContract` (`backend/types/contracts/admin-audit.contract.types.ts:22-30`);
  - the admin gate `assertActorAdmin` — currently module-local (unexported) at `backend/services/admin/user-management.service.ts:240-271`. IF `backend/services/admin/admin-gate.helpers.ts` already exists (the DEV3-022c extraction direction) THEN import it; ELSE extract the function VERBATIM into that new module and re-import it in BOTH services (byte-equivalence guarded by DEV3-016's existing suites staying green);
  - the audit action coercion switch `toAuditActionType` (`backend/services/admin/user-management.service.ts:130-149`) — extract it VERBATIM into the new shared helper module and re-import it in both services (a second copy would trip `check:duplicates`);
  - the scoped-activity read precedent `AdminUserRepository.getActivity` (`backend/db/repo/admin/admin-user.repository.ts:510-528`) — projection + join + `desc(createdAt), desc(id)` pattern to mirror, not fork;
  - the registered Pothos enum `AuditActionTypePothosEnum` (`backend/graphql/pothos/shared/enum.pothos.ts:112-114`) — REUSE; re-registration is a runtime error;
  - the `DateTime` scalar (`backend/graphql/pothos/shared/scalar.pothos.ts:28` + builder Scalars slot) for all timestamp exposure;
  - the trigger-suspension teardown helper `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`);
  - journey provisioning helpers (`provisionAdminActor`/`provisionStudentActor`/`provisionParentActor` via `@/test/workflows/helpers` — existence anchored by `backend/services/notifications/realtime/fanout-transport.test.ts:25`);
  - `withPageAuth` (`frontend/lib/auth/withPageAuth.ts:67`), `roleDashboardPath` (`frontend/lib/auth/roleDashboardRoute.ts:52-65`), `formatApplicantDate` (`frontend/lib/i18n/format-date.ts:56-59`), `PermissionDeniedFallback`, `RetryableNotice`;
  - the EXISTING admin nav item `{ route: "/audit", labelKey: "audit" }` (`frontend/views/dashboard/navItems.ts` admin list) — RETARGET by shipping the real page; NEVER add a second audit nav entry;
  - the seven existing localized action labels (`adminUsers.activity.actionCreate|actionUpdate|actionDelete|actionReactivate|actionOverride|actionAdjust|actionSuspend` — `shared/locale/types/adminUsers/index.ts:417-451`).
  - IF any required artifact is missing THEN record a ❌ entry in `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` and block the dependent task — never inline-patch a foreign layer.
  - **Phase-0 prose-phantom sweep (MANDATORY):** verify whether (i) an audit-immutability trigger definition exists under `backend/db/migration/**` (grep for `audit_logs` + trigger), (ii) `backend/db/repo/audit/` exists (bundle shows it ABSENT — CREATE), (iii) `frontend/views/admin/audit/` and `app/(dashboard)/audit/page.tsx` exist (the `frontend/views/admin/` parent directory EXISTS; only the `audit/` subdirectory and the page are CREATE), (iv) any existing `audit-immutability`/audit-trail test already exists under `backend/db/test/logic/audit/` (the directory AGENTS layout names such tests; the bundle shows none — verify live before authoring), and (v) whether `/audit` currently resolves to a `[feature]` catch-all ComingSoon route (the static route wins once created). Each finding lands in the Phase-0 outcome as verified-fact rows.

---

### 2.2 Core Feature Logic / Happy Paths

- **REQ-010 (Trail Composition):** WHEN an admin lists the audit trail THEN the system SHALL return a page of entries projected from `audit_logs` INNER JOIN `users` on `actor_id`, each entry exposing EXACTLY: `id`, `actionType` (typed `AuditActionType`), `actorId`, `actorName` (the actor's CURRENT `users.full_name` — current value, not a historical snapshot; documented), `entityType`, `entityId` (nullable — `null` renders for e.g. broadcast rows), `details` (nullable raw JSON string, verbatim), and `createdAt`.

- **REQ-011 (Conjunctive Filter Surface):** WHEN filters are supplied THEN the system SHALL apply them conjunctively over EXACTLY the ticket's documented dimensions: `actorId` (equality), `actionType` (equality on the enum), `entityType` (trimmed exact equality), `entityId` (equality), and a date range (`from`/`to`). Absent/null members drop out entirely (the unfiltered listing is the fallback, never an error).

- **REQ-012 (Deterministic Newest-First Ordering):** WHEN entries are returned THEN ordering SHALL be `created_at DESC, id DESC` (mirroring the DEV3-016 precedent), and paginated windows over a stable set SHALL be gapless and non-overlapping.

- **REQ-013 (Pagination Contract):** WHEN `page`/`pageSize` are supplied THEN: `page` MUST be a positive integer (default 1); `pageSize` MUST be an integer in `1..100` and defaults to 25; violations throw `ValidationError` (generic localized copy) BEFORE any DB access; an out-of-range page SHALL return empty `items` with the honest `totalCount` (never clamped — DEV3-016 parity).

- **REQ-014 (Date-Range Semantics):** WHEN `from` and/or `to` are supplied THEN they SHALL be applied verbatim as instants (`createdAt >= from`, `createdAt < to`); IF either value is not a valid Date or `from >= to` THEN the service SHALL throw `ValidationError` BEFORE any DB access. (The client sends `from` = start of the selected day and `to` = start of the following day, so a single picked day selects exactly that day; tests pin the boundary inclusivity/exclusivity row-by-row.)

- **REQ-015 (Identifier & String Guards):** WHEN `actorId` or `entityId` are present but are not positive safe integers (0, negative, fractional, NaN, > MAX_SAFE_INTEGER) THEN the service SHALL throw `ValidationError` pre-DB; WHEN `entityType` is present THEN it SHALL be trimmed, dropped if empty, and rejected with `ValidationError` if it exceeds 100 characters.

- **REQ-016 (Action-Type Pass-Through, Fail-Closed):** WHEN `actionType` is supplied THEN Pothos enum validation SHALL make non-member values unwinnable at the wire layer, AND the service SHALL defensively assert membership against the `AuditActionType` value set before any DB read (a corrupt/foreign value can never become a query parameter).

- **REQ-017 (Empty-State Honesty):** IF zero rows match THEN the surface SHALL return `items: [], totalCount: 0, page, pageSize` — never an error, never a fabricated row.

- **REQ-018 (Read Purity):** WHEN any read on this surface executes THEN the system SHALL write ZERO rows to EVERY table — including ZERO new `audit_logs` rows (reads never audit; JR-C-1 extension from DEV3-016) and ZERO `notifications` rows — proven by before/after row-count oracles in the service tier.

- **REQ-019 (Immutability — Application Structural Tier):** WHEN this ticket ships THEN the ONLY production code path that writes `audit_logs` SHALL remain `AuditService.createAuditLog` (insert-only), and NO production source shall contain an `update(auditLogs)` or `delete(auditLogs)` call. A static-scan test SHALL pin: (i) zero production callsites of `update(auditLogs)`/`delete(auditLogs)` (test-infra teardown files explicitly path-excluded), and (ii) the `AuditService` module exposes NO mutation method beyond the insert writer.

- **REQ-020 (Immutability — Database Trigger Tier, Verify-or-Create):** IF Phase 0 finds an audit-immutability trigger definition under `backend/db/migration/**` THEN this ticket SHALL consume it by reference and lock its behavior; IF absent THEN this ticket SHALL CREATE an idempotent custom SQL migration (`CREATE OR REPLACE FUNCTION` raising on `UPDATE`/`DELETE` + `DROP TRIGGER IF EXISTS`/`CREATE TRIGGER` on `audit_logs`) — the sanctioned raw-SQL channel for triggers per `docs/DATABASE_MIGRATIONS.md` — and apply it via `bun db migrate`. WHEN the DB logic test tier runs THEN it SHALL detect trigger presence via the `pg_trigger` catalog: WITH triggers present, direct `tx.update(auditLogs)` and `tx.delete(auditLogs)` MUST throw (asserted via the `expectRepoError` try/catch helper, never `rejects.toThrow`); WITHOUT triggers (push-provisioned environments), the tier SHALL assert the REQ-019 structural tier and record the documented push-vs-migrate gap in the outcome. Provider gating follows the existing `isPgliteProvider()` convention (`test/helpers/skip-when-pglite.ts`).

- **REQ-021 (Details Contract Consumption, Unmodified):** WHEN `details` surfaces THEN it SHALL flow through VERBATIM as the raw string the producer committed (the write-side hygiene — field NAMES + metadata only, ≤2000 chars — is owned by DEV3-016's contract and re-pinned by the journey, not re-implemented here); the read layer SHALL NOT re-seal, re-parse-fail on malformed JSON, or drop the entry (malformed `details` still renders as raw text).

- **REQ-022 (History Survives Governance):** WHEN an entity or actor referenced by an audit row is later soft-deleted/blocked/suspended THEN the audit row SHALL still render in full (no governance filtering on the trail — an audit surface that hides history after a governance action is an accountability lie; mirrors INV-U1/INV-U5 history-preservation semantics).

---

### 2.3 Security, Authorization & Tenancy

- **REQ-030 (BFLA — Dual-Gate Admin Enforcement):** WHEN `adminAuditLogs` is invoked THEN `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` SHALL deny anonymous callers with `UNAUTHORIZED` and authenticated non-admins with `FORBIDDEN` BEFORE the resolver body executes (the load-bearing `$all` conjunction — `backend/graphql/query/admin/admin-users.query.ts:74-79` precedent), AND the service SHALL re-verify the actor: `actorId = 0` → `UnauthorizedError`; a resolvable non-admin actor → `ForbiddenError` (via the shared/extracted gate of REQ-004), executed BEFORE any read.

- **REQ-031 (BOLA Posture — Governed-Read by Design):** the trail carries no per-row ownership scope and none SHALL be introduced: audit reading is a supreme-governance capability (Workflow 05), so `actorId`/`entityId` filters are FILTERS, never authorization inputs; no user-supplied identity is ever trusted for access, and the surface exposes no capability to MUTATE the entities the trail references. `ctx.user.id` is the sole actor identity.

- **REQ-032 (BOPLA — Closed Input):** WHEN the resolver maps input THEN it SHALL copy fields explicitly from the closed `AdminAuditLogFiltersInput` shape (whitelist: `actorId`, `actionType`, `entityType`, `entityId`, `from`, `to`) — NO `{ ...input }` spread; unknown/identity-smuggling fields die as `GRAPHQL_VALIDATION_FAILED` at the schema boundary.

- **REQ-033 (Governance Window — Acknowledged, Not Expanded):** the documented window (`createGraphQLContext` verifies the JWT without a governance re-check — `backend/graphql/gqlContextFactory.ts:167-239`) applies to this READ-ONLY surface as-is; login (`backend/services/auth/auth.service.ts:91-98,155-156`) and SSR (`backend/lib/auth/server-auth.ts:97-106`) own governance denial. This ticket adds NO request-time re-check and makes NO fail-closed claim for governed callers holding pre-issued tokens; the posture is recorded in the canonical doc. (Contrast with DEV3-022d's high-blast-radius broadcast MUTATION, which added a service-tier governance self-guard — a divergence this read surface deliberately does NOT copy.)

- **REQ-034 (Injection Safety — No LIKE Surface):** WHEN filters are bound THEN all values SHALL be Drizzle-parameterized equality/comparisons; there SHALL be NO `LIKE`/`ILIKE` anywhere on this surface (no text search exists in v1 — therefore no `escapeLikeWildcards` obligation arises), and NO inline `--` comments inside any `sql` template (parameter-binding hazard).

- **REQ-035 (Log Hygiene):** WHEN a denial fires THEN exactly ONE `logger.logDomainError` SHALL emit with bounded context `{ code, entity: "audit_logs", entityId?, locale }` — NEVER filter payloads, NEVER `details` content, NEVER actor PII; happy paths log NOTHING; `console.*` is forbidden.

- **REQ-036 (Rate Limiting — Unchanged):** no new throttle surface; the platform's documented fail-open stub posture stays untouched (real limiting belongs to the rate-limiting hardening stream).

- **REQ-037 (Read-Only Scope of History):** historical rows of governed actors/targets render unfiltered (REQ-022); this is the documented accounting posture, test-pinned.

---

### 2.4 Atomicity, Concurrency & Data Integrity

- **REQ-040 (Single Read Transaction per Page Request):** WHEN a list call executes THEN the count read and the items read SHALL run inside ONE transaction (the service opens it via the `withTransaction(outerTx, …)` helper convention or its equivalent single `db.transaction` read block), so `totalCount` and `items` cannot tear across concurrent inserts; the transaction performs ZERO writes.

- **REQ-041 (`tx` Propagation Discipline):** WHEN any repository method is called THEN it SHALL receive the SAME `tx`; every method on the new repository accepts `tx?: DBTransaction` LAST and resolves its executor as `tx ?? db` (existing dynamic-query precedent at `backend/db/repo/admin/admin-user.repository.ts:515`); and the service SHALL accept `outerTx?: DBTransaction` as its trailing parameter.

- **REQ-042 (Schema-Drift Gate with a Single Carve-Out):** WHEN the ticket completes THEN `git diff backend/db/schema/**` SHALL be EMPTY; the ONLY permitted migration-tree addition is the conditional REQ-020 trigger SQL file under `backend/db/migration/**` (absent ⇒ created; present ⇒ zero diff). Everything else under migration/schema stays untouched.

- **REQ-043 (Concurrent Read Safety):** WHEN N concurrent list calls execute THEN all SHALL resolve; a forced mid-read failure SHALL surface as the masked `INTERNAL_SERVER_ERROR` at the boundary with exactly one correlated log (chaos tier), never a partial page presented as complete.

- **REQ-044 (No Locks by Design):** the surface introduces NO `SELECT FOR UPDATE`, NO advisory locks, NO Redis claims — a pure read of an append-only table has nothing to race against.

---

### 2.5 Validation & Error Contracts

- **REQ-050 (Closed Error Set):** this surface SHALL throw ONLY `UnauthorizedError` (anonymous/at the service gate), `ForbiddenError` (non-admin actor), and `ValidationError` (hostile filters/pagination) — `extensions.code` values `UNAUTHORIZED` / `FORBIDDEN` / `VALIDATION`. Unexpected internals SHALL bubble to the single masking finalizer (`backend/graphql/graphqlErrorsFinalizer.ts`) as `INTERNAL_SERVER_ERROR`. NO new domain codes; NO `NotFoundError` exists on this surface (no per-id endpoint).
- **REQ-051 (Localized-Only):** all error copy resolves through compile-time i18n (`errorsTranslations.unauthorized` / `.forbidden` / `.validation`); NO new error keys are minted; a corrupt stored `actionType` (theoretical — writers only emit enum values) fails closed via the shared coercion guard's `null` path, documented as masked-internal behavior.
- **REQ-052 (Structured Denial Logging):** each denial SHALL emit exactly ONE bounded `logDomainError` (REQ-035 shape); denials SHALL produce ZERO reads beyond the gate and ZERO writes.
- **REQ-053 (Validation Precedence):** failures SHALL surface in deterministic order: actor gate → filter structural validation (REQ-014/015/016) → pagination validation (REQ-013) → DB read; every pre-DB tier proves zero row contact.
- **REQ-054 (Client Error Mapping):** the client SHALL consume the existing seams only — `mapGraphQLErrorByCode` (`frontend/providers/apollo/error-link.map.ts`), `PermissionDeniedFallback` for query-context `FORBIDDEN`, `RetryableNotice` for `RATE_LIMITED`/`SERVICE_UNAVAILABLE`, and inline field errors via the `fieldError` seams for `VALIDATION` with `fields`; NO bespoke mapping is authored.

### 2.6 GraphQL & Frontend Contracts

- **REQ-060 (Exact Operation Signature):** the schema SHALL gain EXACTLY ONE root field:
  `adminAuditLogs(filters: AdminAuditLogFiltersInput, page: Int, pageSize: Int): AdminAuditLogPage!`
  carrying `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`. NO mutations. `backend/lib/gateway/public-operations.ts` stays the frozen six (`PUBLIC_OPERATIONS` — the ReadonlySet at `public-operations.ts:59`, built from the frozen tuple at :36-46).
- **REQ-061 (Object Shapes & Scalar/Enum Discipline):** `AdminAuditLogEntry` SHALL expose `id` FIRST (via `exposeID` for Apollo normalization), then `actionType` (the EXISTING `AuditActionTypePothosEnum` — reuse, never re-register), `actorId: Int!`, `actorName: String!`, `entityType: String!`, `entityId: Int` (nullable), `details: String` (nullable), `createdAt` via `t.expose("createdAt", { type: "DateTime" })` (NEVER `String` + `toISOString()`); `AdminAuditLogPage` SHALL be the embedded wrapper `{ items: [AdminAuditLogEntry!]!, totalCount: Int!, page: Int!, pageSize: Int! }` (NO `id`); `AdminAuditLogFiltersInput` SHALL be the closed input `{ actorId: Int, actionType: AuditActionType, entityType: String, entityId: Int, from: DateTime, to: DateTime }` — every member nullable. All shapes are backed by canonical types from REQ-003 (plus a documented repo-local row interface mirroring the DEV3-016 `AdminUserActivityRow` repo-local precedent); NO local types in Pothos files.
- **REQ-062 (Codegen & Surface-Freeze Re-Pin, SAME Change Set):** WHEN the field lands THEN the SAME change set SHALL run `bun run generate:gqlSchema && bun codegen`, commit regenerated artifacts, AND extend whatever baseline inventories the live `backend/graphql/test/schema-surface.test.ts` and `backend/graphql/test/sdl-static-assertions.test.ts` pin (the bundled snapshots show `PRE_3_1_QUERY_FIELDS` / `FROZEN_QUERY_FIELDS` lists — VERIFY their live contents and extend additively; committed-SDL byte-parity `backend/graphql/test/plan-catalog.schema.test.ts` MUST stay green), while `backend/graphql/test/handshake-code-surface.test.ts`'s frozen-six public-allowlist assertion stays green UNCHANGED.
- **REQ-063 (Frontend Document):** `frontend/graphql/sharedDocuments/admin/audit-trail.documents.ts` SHALL export `adminAuditLogsQueryDocument` — a single named operation `AdminAuditLogs($filters: AdminAuditLogFiltersInput, $page: Int, $pageSize: Int)`, `TypedDocumentNode`-typed against generated types, `id` FIRST in the entry selection; exported through `frontend/graphql/sharedDocuments/admin/index.ts` and the top barrel; `useQuery` ONLY (no `useLazyQuery`); a documents contract test pins operation name, variable set, and the id-first selection.
- **REQ-064 (Route & Server Guard):** `app/(dashboard)/audit/page.tsx` (CREATE — bundle shows it absent) SHALL be a Server Component calling `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })`, rendering the client container, with locale-aware `generateMetadata` via `getTranslations(locale).adminUsersTranslations`/new block; anonymous → `/login?redirect=/audit`; role mismatch → `roleDashboardPath(ctx.role)` (bare `/dashboard` is FORBIDDEN). Phase 0 verifies the catch-all relationship — the new static route wins over any `[feature]` dynamic segment by Next.js precedence.
- **REQ-065 (Navigation — Zero-Change Retarget):** `frontend/views/dashboard/navItems.ts` SHALL NOT change — the existing admin `/audit` item already exists. `frontend/views/dashboard/navItems.test.ts` SHALL pin: admin nav CONTAINS `/audit` with `labelKey: "audit"`; student/teacher/parent navs exclude it. NO duplicate item, NO label move (the `audit` key stays owned by `DashboardLabels` per the ownership matrix test).
- **REQ-066 (View Composition & MUI v9 Discipline):** `frontend/views/admin/audit/AuditTrailView.tsx` (new directory, CREATE) SHALL render: header (title/subtitle), a filter form (actorId number input, entityId number input, actionType select fed by the codegen enum values + localized labels, entityType free text, native `TextField type="date"` pair — deliberately NOT the DataPicker/Locale provider stack), a paginated table composed from MUI `Table` primitives (no reliance on any unverified shared grid component), an expandable `details` code block per row, loading skeletons, honest empty state, localized generic error + retry, `PermissionDeniedFallback` on FORBIDDEN, `RetryableNotice` on the retryable codes. ALL styling via `sx`; `theme.palette.*` tokens only; `*Outlined` icons; form submit via `React.SubmitEvent` discipline; touch targets ≥44px; RTL-safe logical properties; `logger` from `@/frontend/lib/logger` only.
- **REQ-067 (i18n — Extend `adminUsers` Namespace, No New Namespace):** the `adminUsers` namespace SHALL gain ONE `auditTrail` block on `AdminUsersLabels` (`shared/locale/types/adminUsers/index.ts`) with en + ar leaves (`shared/locale/en/adminUsers/index.ts`, `shared/locale/ar/adminUsers/index.ts`), covering: page title/subtitle, filter labels + apply/clear, column headers, empty state, details toggle copy, error/retry copy. The seven action labels SHALL be REUSED from the existing `activity.action*` keys (NO near-duplicate minting — `shared/AGENTS.md` errors-namespace rule applied by analogy). NO new namespace registration, NO `namespaces/index.ts` churn; the existing parity/growing-shape suites SHALL be extended to pin the new block on both locales (and Arabic-script presence in `ar`).
- **REQ-068 (Deep-Link Prefilter):** WHEN the page loads with `?entityType=<v>&entityId=<n>` (optionally `actionType`, `actorId`, `from`, `to`) THEN the initial filter state SHALL be pre-populated from the SANITIZED search params (invalid values dropped, never trusted); subsequent user edits live in component state; this gives DEV3-016's per-user activity "view full audit log" affordance a stable deep-link target (`/audit?entityType=user&entityId=<id>`).
- **REQ-069 (Date Rendering Reuse):** `createdAt` SHALL render through the existing `formatApplicantDate` (`frontend/lib/i18n/format-date.ts:56-59`) — reused, never forked.

### 2.7 Test Coverage

- **REQ-070 (Repository Tier — `runInRollback`):** `backend/db/test/logic/audit/`-adjacent repo tests (file placement per `backend/db/test/AGENTS.md`) SHALL cover under `runInRollback` with `tx` propagated to every call and `expectRepoError` try/catch: each filter dimension alone and combined (conjunctive), ordering + tiebreak, page-window continuity with no overlap, out-of-range page honesty, empty-set honesty, join projection integrity (`actorName` present), null `entityId`/`details` pass-through, and a zero-write oracle (row counts unchanged).
- **REQ-071 (Service Tier — 100% Statement/Branch Target):** `backend/services/admin/audit-trail.service.test.ts` SHALL cover: gate denials (`actorId=0` → `UnauthorizedError`; non-admin → `ForbiddenError`; zero reads beyond gate, zero writes, one bounded log per denial), every validation guard of REQ-013/014/015/016 incl. boundary values (pageSize 1/100/101, page 0, fractional ids, from ≥ to, entityType 101 chars), happy-path mapping, REQ-017/018 oracles, and the REQ-026-equivalent determinism (equal inputs → equal output for a stable set).
- **REQ-072 (Immutability Tiers):** (a) the REQ-019 static single-writer/callsite scan test; (b) the REQ-020 trigger-tier DB logic test (environment-branched exactly as specified there, with provider gating); (c) a merge-guard pinning that the conditional migration file contains idempotent trigger DDL when present. All three live under the DB-logic/test-layer conventions of `backend/db/test/AGENTS.md`.
- **REQ-073 (GraphQL Wire Matrix):** a wire-tier suite under `backend/graphql/test/` (precedent: `notification-integration.matrix.test.ts` with `setupTestServerLifecycle` + `testClient` + raw-HTTP probes) SHALL assert per the matrix: anonymous → `UNAUTHORIZED`; student/teacher/parent → `FORBIDDEN`; admin happy-path payload satisfies REQ-010/013; smuggled identity args (`userId` at root, `userId` inside `filters`) die as `GRAPHQL_VALIDATION_FAILED` PRE-resolver; an invalid enum literal dies as `GRAPHQL_VALIDATION_FAILED`; a hostile pageSize path returns `VALIDATION` with an unchanged row-count oracle.
- **REQ-074 (Documents, Cache, Nav & Component Tier):** the documents contract test (REQ-063 conventions); `frontend/providers/apollo/apolloCache.ts` SHALL register `AdminAuditLogPage: { keyFields: false }` (embedded wrapper), with the pinned policy-inventory assertion in `frontend/providers/apollo/apolloCache.test.ts` extended in the SAME change set (the entry row itself `AdminAuditLogEntry` normalizes by `id` — no registration); `frontend/graphql/AGENTS.md`'s embedded-type list gains the wrapper; the navItems test deltas of REQ-065; and `test/ui/components/admin/AuditTrailView.test.tsx` SHALL cover (Happy DOM, mocked Apollo, translation handle preloads — NEVER hardcoded copy): skeleton → loaded table, empty state, FORBIDDEN fallback, retryable notice, filter submit wiring, `null` `details`/`entityId` rendering, RTL (ar) render.
- **REQ-075 (Cross-Actor Journey — TEST-FIRST):** `test/workflows/admin/audit-trail.journey.test.ts` SHALL be authored BEFORE the service surface, per `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`: committed cast in `beforeAll` (real `provisionAdminActor`/`provisionStudentActor`/`provisionParentActor`), service calls carry REAL actor ids, NO `runInRollback`, denials resolve through the real role path, fixture-direct audit rows only for the not-yet-shipped producer action types (documented fixture lane), teardown tracked and replay-checked INCLUDING audit rows deleted via `withAuditDeleteTriggersSuspended` (FK-safe: audit rows before users), zero-residue re-probes. Run via `bun run test/scripts/run-test.ts test/workflows/admin/audit-trail.journey.test.ts`.
- **REQ-076 (Coverage & Baseline Gates):** 100% statement/branch coverage target on ALL new service/repository code; suites run through sanctioned runners; final re-verification shows tsgo/biome/lint = baseline + 0; schema/surface gates green.
- **REQ-077 (Per-File Gateway):** every created/modified file SHALL pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0.

### 2.8 Documentation & Knowledge Gates

- **REQ-080 (Canonical Reference Doc):** WHEN implementation completes THEN `docs/admin/audit-trail.md` SHALL exist containing: WHY (FR-10.5 / Workflow 05 §7 / PRODUCTION_READINESS §1.3), the read-surface contract (fields, order, pagination, filter semantics incl. date-boundary rules), the two-tier immutability proof (application single-writer + DB trigger, including the honest push-vs-migrate environment caveat of REQ-020), the governance-window acknowledgment (REQ-033), the history-survives-governance rule (REQ-022/037), the details-hygiene consumption note (REQ-021 + REQ-035), the deep-link contract (REQ-068), and the anti-pattern list (NEVER add an update/delete/field-edit surface to `audit_logs`; NEVER LIKE-search `details` without the canonical escape helper — moot in v1; NEVER fork a second audit writer; NEVER filter history by governance).
- **REQ-081 (Layer AGENTS Propagation):** `backend/services/AGENTS.md` SHALL gain a one-line rule (audit-trail read service exists; admin-gated; single-writer remains `AuditService.createAuditLog`; see canonical doc); `backend/db/repo/AGENTS.md` SHALL gain/reconcile the `audit/` repository listing with a one-line read-only rule (the Layout already forward-names `audit/` — the repo now exists); `backend/graphql/AGENTS.md` gains a line ONLY if a real layer convention changed (otherwise reference-only); the root `AGENTS.md` Important References section SHALL gain the canonical doc line.
- **REQ-082 (Outcome Protocol):** every task SHALL read prior files in `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/` first and write `outcome/<task-id>-outcome.md` after; the final gate SHALL re-verify baseline deltas AND `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` = 0.
- **REQ-083 (Plan-Review Gate):** Phase 1.5 `@plan-review` on the complete plan (`specs.md` + `plan.md` + `tasks.md`) SHALL pass with zero violations BEFORE implementation; `outcome/plan-review-R1.md` SHALL exist.

---

### 2.9 Cross-Actor Workflow Scenarios (Journeys)

The surface spans producers (admin mutations + future producers), a privileged observer (a potentially DIFFERENT admin), and denied non-admins — 2+ actors over shared state mandates a journey, written TEST-FIRST.

**Actor Table:**

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| **Admin A (producer)** | `UserRole.Admin` + real `admin` row | Perform real `AdminUserManagementService` mutations whose commits mint audit rows | Read NOTHING extra if they call as non-admin (not applicable — they hold the role) |
| **Admin B (observer)** | `UserRole.Admin` + real `admin` row | Read/filter the full trail via `AuditTrailService.listAuditTrail` | Mutate audit rows through any service surface (none exists), see trail rows disappear on governance of a target |
| **Student / Parent (denied)** | real role rows | — | Call the service (→ `ForbiddenError`) or reach the GraphQL field (→ `FORBIDDEN` pre-resolver) |
| **Anonymous** | no identity | — | `UnauthorizedError` at the service gate; `UNAUTHORIZED` at the scope layer |
| **System (fixtures)** | direct committed inserts for `override`/`adjust`/`suspend` rows (their producer tickets are future work) | seed fixture rows | leak rows past teardown |

**Ordered Step List (`test/workflows/admin/audit-trail.journey.test.ts`):**

1. **System** → commit the cast (Admin A, Admin B, student, parent) with tracked ids; record audit_logs/notifications row-count oracles.
2. **Admin A** → `createUser` (student target) → **Observer Admin B** filters `{ entityType: "user", entityId: targetId }` → sees exactly ONE row: `actionType=create`, `actorId=adminA.id`, `actorName=Admin A's name`; `details` parses to names-only content (`{ role: ... }` — NO PII pairs).
3. **Admin A** → `updateUser` → `setUserDeleted(true)` → `setUserDeleted(false)` on the same target → **Admin B** observes FOUR rows newest-first in exact action order (`reactivate, delete, update, create` under DESC ordering) with correct per-row `actionType`.
4. **System** → fixture-direct committed rows for `override`, `adjust`, `suspend` action types (documented fixture lane) → **Admin B** filters by EACH of the seven `AuditActionType` values and sees exactly its matching rows (full vocabulary is filterable — PRODUCTION_READINESS 1.3.5).
5. **Admin B** → paginates a 5-row filtered set with `pageSize=2` → pages are gapless/non-overlapping with stable `totalCount`; a `from`/`to` range includes the in-range fixture and excludes a backdated one exactly at the boundary semantics of REQ-014.
6. **Student actor** → `AuditTrailService.listAuditTrail(..., actorId=student.id)` → `ForbiddenError` BEFORE any read; **anonymous** (`actorId=0`) → `UnauthorizedError`; **parent** → `ForbiddenError`. Oracles (audit_logs and notifications counts) byte-unchanged through all denials.
7. **Governance-history probe:** the target user is soft-deleted (already done in step 3) — the trail rows about them REMAIN fully readable (REQ-022/037).
8. **System (teardown)** → tracked hard-delete incl. audit rows under `withAuditDeleteTriggersSuspended`; post-teardown re-probes assert ZERO residue.

**Cross-Actor EARS Criteria (observer-perspective):**

- **J-AUD-01:** WHEN admin A commits user-management mutations THEN observer admin B SHALL read exactly those committed rows — newest-first, correctly attributed to A — through the trail surface.
- **J-AUD-02:** WHEN rows exist for every action type THEN the observer SHALL filter by each of the seven `AuditActionType` values and see exactly the matching subset (the full audit vocabulary is observable).
- **J-AUD-03:** WHEN the observer paginates or date-filters THEN windows SHALL be gapless, non-overlapping, and boundary-exact, with an honest `totalCount`.
- **J-AUD-04:** WHEN a student, parent, or anonymous actor attempts the read THEN the system SHALL reject them (`ForbiddenError`/`UnauthorizedError`) BEFORE any read AND the platform's row oracles SHALL be unchanged (zero audit pollution from attempts).
- **J-AUD-05:** WHEN the target of logged actions is later governed (soft-deleted) THEN the historical trail SHALL remain fully readable to the admin observer.

The journey maps 1:1 onto `test/workflows/admin/audit-trail.journey.test.ts` in `plan.md`/`tasks.md`.

---

## 3. System Decisions & State Machine Invariants Alignment

| Ref | Alignment |
|---|---|
| **A.5 (`audit_logs` table + `audit_action_type` enum; append-only)** | The ticket's entire premise: REQ-010/011 deliver the read half; REQ-019/020 turn "append-only (immutable)" into a permanently PROVEN property rather than a documented claim. |
| **FR-10.5 (Audit Trail)** | "Every administrative action is permanently logged with actor ID, action type, entity target, and timestamp" — the write half shipped in DEV3-016; the review half ships here. |
| **Workflow 05 §7 "Audit Trail"** | This ticket IS the "Review the audit trail" capability row; its §7.2 action-category table maps onto the 7-value filter vocabulary proven by J-AUD-02. |
| **PRODUCTION_READINESS §1.3.1–1.3.5** | 1.3.1 (every action logged) — journey steps 2–3 observe producer emissions; 1.3.2 (immutability) — REQ-019/020; 1.3.3 (all fields populated) — REQ-010 + journey assertions; 1.3.4 (filters by actor/action/entity/date) — REQ-011 + J-AUD-03; 1.3.5 (all 7 action types exercised) — J-AUD-02. |
| **INV-U1 / INV-U5 (history survives governance)** | REQ-022/037 — the trail never filters by governance; enforced by J-AUD-05. |
| **DEV3-016 contracts (`AuditLogWriteContract`, JR-C-1 denial-no-audit, writer choreo)** | Composed unchanged; REQ-018 extends JR-C-1 to the read surface itself (reads never audit). The `USER_NOT_FOUND`-oracle ruling stays admin-surface-scoped and is IRRELEVANT here (no per-id lookup exists). |
| **DEV3-022d (broadcast writes `entityType:"notification", entityId:null`)** | The surface tolerates nullable `entityId` (REQ-010/061) so future broadcast/history rows render once produced; no dependency on that ticket landing. |
| **B.9 / INV-PAY / INV-W / INV-S / INV-TV families** | Read-only in every dimension; NO invariant file edits; NO new invariants minted (audit append-only-ness is A.5's decision, not a new INV). |
| **Architecture standards** | `docs/graphql/api-gateway-and-routing.md` §8 registration recipe followed; public allowlist untouched (Rule 4); `docs/drizzle/prepared-statements.md` — the dynamic filter chain uses the plain builder (no prepared statement, no `inArray`-in-prepared pattern); `docs/graphql/dataloader-batching.md` — N/A (single root read, no per-parent resolution); `docs/IDEMPOTENCY.md` — N/A (read-only); `docs/graphql/error-handling-contract.md` + `docs/graphql/domain-error-extensions-code.md` — closed code set. |

**State-machine edits:** NONE. `docs/specs/state-machine-invariants.md` is not modified; no new INV ids are minted.

---

## 4. Cross-Layer Traceability Matrix

| Requirement ID | Decision Ref / Invariant | Backend Service | GraphQL Mutation/Query | Frontend View | Test Coverage |
|---|---|---|---|---|---|
| REQ-001..002 | Process canon | — | — | — | Phase-0 outcome; i18n parity suites green |
| REQ-003 | Types layer rules | `backend/types/audit/audit-trail.types.ts` (NEW) | Pothos backs onto it | Codegen types | tsgo; documents contract |
| REQ-004 | DEV3-016 reuse; DEV3-022c extraction direction | extracted `backend/services/admin/admin-gate.helpers.ts` (+ audit coercion helper) shared by both admin services | — | — | DEV3-016 suites stay byte-green |
| REQ-010/012/013/017 | FR-10.5; DEV3-016 read precedent | `AuditTrailRepository.listEntries`/`countEntries` (NEW `backend/db/repo/audit/`) + `AuditTrailService.listAuditTrail` | `adminAuditLogs` | Trail table | REQ-070/071 matrix + oracles |
| REQ-011/014/015/016 | PRODUCTION_READINESS 1.3.4 | Filter normalization + validation in service | `AdminAuditLogFiltersInput` | Filter form | REQ-070/071 boundary matrix |
| REQ-018 | JR-C-1 extension | read purity proof | — | — | before/after row-count oracles |
| REQ-019 | A.5 immutability, app tier | single-writer surface lock | — | — | REQ-072(a) static scan |
| REQ-020 | A.5 immutability, DB tier; `docs/DATABASE_MIGRATIONS.md` triggers rule | conditional `backend/db/migration/**` trigger SQL | — | — | REQ-072(b) trigger-aware DB logic |
| REQ-021 | DEV3-016 details-hygiene | verbatim pass-through | `details: String` | expandable details cell | REQ-070/075 content assertions |
| REQ-022/037 | INV-U1/U5 | unfiltered join | — | — | J-AUD-05 |
| REQ-030..036 | Workflow 05; BFLA/BOLA/BOPLA; governance window doc | `$all` scope + shared gate; closed input | `authScopes` | — | REQ-073 wire matrix; smuggle/bad-enum probes |
| REQ-040..044 | Single-tx read coherence; zero-drift | `withTransaction` read block; tx propagation | — | — | REQ-071; REQ-043 chaos tier; drift gate in REQ-042 |
| REQ-050..054 | Error contract docs | closed error set; bounded logs | `extensions.code` pins | error seams reuse | REQ-071/073 code assertions |
| REQ-060..062 | Gateway Rule 4 + Pothos rules | `backend/graphql/query/admin/audit-trail.query.ts`; `backend/graphql/pothos/admin/audit-trail.pothos.ts` | `adminAuditLogs` | — | REQ-073; schema-surface + sdl-static baselines re-pinned; committed-SDL parity green |
| REQ-063 | sharedDocuments conventions | — | `adminAuditLogsQueryDocument` | hooks `useQuery` | REQ-074 documents contract test |
| REQ-064..066 | Server guard + MUI v9 discipline | — | — | `app/(dashboard)/audit/page.tsx`; `frontend/views/admin/audit/AuditTrailView.tsx` | REQ-074 component suite |
| REQ-065 | Existing nav item retarget | — | — | `navItems.ts` (UNCHANGED) | navItems.test assertions |
| REQ-067 | i18n reuse-not-duplicate | — | — | `adminUsers.auditTrail` block; reuse of `activity.action*` labels | extended parity pins both locales |
| REQ-068 | Deep-link contract | — | — | searchParams prefilter | component test + contract |
| REQ-069 | Date formatter reuse | — | — | `formatApplicantDate` | covered by REQ-074 |
| REQ-070..077 | Test layer rules | repo/service/chaos tiers | wire matrix | component tier | all suites green; coverage 100% on new code; baseline delta = 0 |
| REQ-080..083 | Knowledge protocol | `docs/admin/audit-trail.md`; AGENTS updates | — | — | doc existence; AGENTS diffs; `grep -c "❌\|⚠️"` ledger = 0; plan-review R1 exists |
| J-AUD-01..05 (§2.9) | FR-10.5 + A.5 + PRODUCTION_READINESS §1.3 + INV-U1/U5 | real `AdminUserManagementService` producers + real `AuditTrailService` observer | service-level in journey | — | `test/workflows/admin/audit-trail.journey.test.ts` (committed fixtures, tracked teardown, zero residue) |

---

**End of Specification — DEV3-020.** Governing next step: Phase 1.5 — invoke `@plan-review` on the complete plan (`specs.md` + `plan.md` + `tasks.md`) before any implementation begins.
```
