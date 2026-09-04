# Technical Architecture & Implementation Design: DEV3-020 — Immutable Audit Logging for All Admin Actions

> **Plan of record:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`
> **Specs:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/specs.md` (REQ-001..083, journeys J-AUD-01..05)
> **Canonical refs:** `docs/admin/user-management.md` (DEV3-016 substrate: writer pattern, guarded state updates, JR-C-1), `docs/workflows/05-admin-governance-override.md` §7, `docs/specs/functional-requirements.md` FR-10.5, `docs/specs/open-decisions-and-gaps.md` A.5/A.7, `docs/specs/state-machine-invariants.md` INV-U1/U5, `docs/DATABASE_MIGRATIONS.md`, `docs/graphql/api-gateway-and-routing.md` §8, `docs/graphql/error-handling-contract.md`, `docs/graphql/domain-error-extensions-code.md`, `docs/drizzle/prepared-statements.md`, `docs/testing/workflow-journey-tests.md`, `test/workflows/AGENTS.md`
> **Ledger:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` (initialized in Task 0)

---

## 1. System Overview & Architecture Diagram

### 1.1 Scope Statement

DEV3-020 is the **read-surface + immutability-proof** half of the audit trail. The WRITE half is already shipped and permanently test-locked by DEV3-016 (single writer `AuditService.createAuditLog` at `backend/services/admin/audit.service.ts:82-90`; contract `AuditLogWriteContract` at `backend/types/contracts/admin-audit.contract.types.ts:22-30`). This ticket adds:

1. The **global admin audit-trail READ surface**: `adminAuditLogs` query → `AuditTrailService` → new `AuditTrailRepository` (`backend/db/repo/audit/`, CREATE) → the append-only `audit_logs` table ⋈ `users` for the actor name.
2. The `/audit` page (CREATE `app/(dashboard)/audit/page.tsx` + `frontend/views/admin/audit/AuditTrailView.tsx`) — the EXISTING admin nav item (`navItems.ts:133`) is retargeted from placeholder intent to a real page with ZERO nav-model changes.
3. The **immutability proof at two tiers**: a static single-writer/callsite scan (application tier) + a verify-or-create DB trigger tier (custom SQL migration, per `docs/DATABASE_MIGRATIONS.md`'s trigger channel) with an honest push-vs-migrate environment branch.
4. The cross-actor journey proving producer (Admin A) → observer (Admin B) → denied non-admin behavior across committed rows.

There are ZERO new mutations, ZERO schema drift (with ONE conditional carve-out: the trigger SQL file, REQ-020/042), and ZERO new writers.

### 1.2 Data Flow

```text
┌── CLIENT (React 19 / Apollo 4) ───────────────────────────────────────────────┐
│ app/(dashboard)/audit/page.tsx  (Server Component)                             │
│   await withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })        │
│   └─ <AuditTrailView initialFilters={sanitizedSearchParams} />  (client)       │
│        useQuery(adminAuditLogsQueryDocument, { variables: {filters,page,...} })│
└──────────────────────────────────┬────────────────────────────────────────────┘
▼  Apollo → POST /api/graphql
┌── POTHOOS ────────────────────────────────────────────────────────────────────┐
│ backend/graphql/query/admin/audit-trail.query.ts                               │
│   adminAuditLogs — authScopes { $all: { authenticated: true,                   │
│                                        role: [UserRole.Admin] } }              │
│   thin resolver: ctx.user belt + explicit field copies → service (no logic)    │
└──────────────────────────────────┬────────────────────────────────────────────┘
▼
┌── SERVICE ────────────────────────────────────────────────────────────────────┐
│ backend/services/admin/audit-trail.service.ts                                  │
│   listAuditTrail(filters, page, pageSize, locale, actorId, outerTx?)           │
│   1. assertActorAdmin(actorId, locale, outerTx)   [SHARED EXTRACTED GATE]      │
│   2. filter structural validation (pre-DB, REQ-014/015/016)                    │
│   3. pagination validation (pre-DB, REQ-013)                                   │
│   4. ONE transaction (repeatable-read snapshot): countEntries + listEntries    │
│   5. map rows (toAuditActionType-coerced; corrupt → masked-internal throw)     │
└──────────────────────────────────┬────────────────────────────────────────────┘
▼
┌── REPOSITORY (dynamic filter chain, parameterized) ───────────────────────────┐
│ backend/db/repo/audit/audit-trail.repository.ts (CREATE)                       │
│   listEntries(filters, limit, offset, tx?)   countEntries(filters, tx?)        │
│   executor rule: (tx ?? db); order: createdAt DESC, id DESC                    │
└──────────────────────────────────┬────────────────────────────────────────────┘
▼
┌── POSTGRESQL ─────────────────────────────────────────────────────────────────┐
│ audit_logs (READ-ONLY here; inner JOIN users ON actor_id)                      │
│ immutability: application single-writer + DB trigger tier (verify-or-create)   │
└────────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Key Design Decisions Table

| # | Decision | Options Considered | Pros / Cons | Rationale (Maintainability · Scalability · Reliability) |
|---|---|---|---|---|
| D1 | **New sibling read stack** (`AuditTrailRepository` + `AuditTrailService` + `adminAuditLogs`) — the DEV3-016 `AdminUserRepository.getActivity` (`backend/db/repo/admin/admin-user.repository.ts:510-528`) is the PATTERN donor only, never the reused method | (a) extend `getActivity` with optional global mode; (b) new sibling stack | (a) user-Scoped `entityType="user"` shape + actorName join would be widened/bent; two surfaces drift apart while sharing fragile internals; (b) one projection per surface, each minimal | REQ-004. The global trail projects `actorId`/`actorName`/`entityType`/`entityId`/`details` — a deliberately different shape from the per-user, `changedFields`-parsed projection. Composition of the pattern, divergence of the shape |
| D2 | **Extract the DEV3-016 gate + audit coercion into `backend/services/admin/admin-gate.helpers.ts`** (VERIFY-OR-CREATE: if DEV3-022c's extraction landed first, import and add the coercion there instead of duplicating). `assertActorAdmin` is currently module-local (unexported) at `user-management.service.ts:240-271`; `toAuditActionType` at :130-149 | (a) copy both into the new service; (b) shared module | (a) two divergent copies of a security boundary + `check:duplicates` clone finding; (b) single gate; DEV3-016's existing suites are the byte-equivalence regression lock | REQ-004. Extraction is mechanical; behavior must stay byte-equal. The admin barrel (`backend/services/admin/index.ts` — currently `audit.service` + `user-management.service`) re-exports the module |
| D3 | **Count + items run inside ONE transaction opened at REPEATABLE READ** (`db.transaction(fn, { isolationLevel: "repeatable read" })`; outer-tx path inherits the parent's snapshot via SAVEPOINT. If the bundled Drizzle rc's txConfig shape fails Phase-0 verification, fall back to a first-statement `tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`)`) | (a) two free reads (DEV3-016 directory posture); (b) one read-committed tx; (c) one repeatable-read tx | (a) tears `totalCount` vs `items` under a mid-gap commit; (b) each statement re-snapshots — same tear; (c) both statements share one snapshot — intra-response coherence structurally pinned on a live-commit surface (the journey) | REQ-040. An audit ledger is append-only and producer-busy precisely because other admins mutate users; snapshot isolation is the honest primitive. Zero writes ever occur inside it |
| D4 | **All timestamps surface via the registered `DateTime` scalar** (`t.expose("createdAt", { type: "DateTime" })`); filter args `from`/`to` are `DateTime` input fields | (a) legacy `String` + `.toISOString()` (the DEV3-016-era workaround); (b) `DateTime` | (a) is the retired pre-scalar pattern (still present in the admin-user surface, which this ticket does not touch); (b) the scalar is registered at `backend/graphql/pothos/shared/scalar.pothos.ts:28` with builder Scalars slot at `backend/graphql/pothos/builder.ts:76-82` | Architectural Invariant 11; DEV2-004 already ships the precedent (`backend/graphql/pothos/teachers/applicant.pothos.ts:49-51`) |
| D5 | **Filtering is equality/comparison only — NO LIKE/ILIKE surface exists** (entityType is trimmed EXACT equality; there is no free-text search). `escapeLikeWildcards` is NOT needed (no wildcard surface arises) | (a) ILIKE substring search on entityType/details; (b) exact-match only | (a) would re-open the wildcard-injection surface AND make `details` (raw JSON blobs) text-searchable, a PII-adjacent smell; (b) closed, index-friendly (`audit_logs_entity_type_entity_id_idx` at `audit-logs.ts:45`), honest v1 | REQ-011/034. The dropdown-feed refinement is deferred (ledger D-ET-DROPDOWN), not hacked in |
| D6 | **A corrupt stored `actionType` fails masked-internal** (the service's coercion returns null → plain `new Error(...)` bubbles to the boundary → `INTERNAL_SERVER_ERROR`), mirroring the DEV3-016 `getUserActivity` drift branch VERBATIM (`user-management.service.ts:787-792`) | (a) new domain code `AUDIT_ACTION_TYPE_CORRUPT`; (b) masked internal | (a) mints a code for an impossible-by-construction state (the pgEnum column cannot hold a non-member write from any shipped writer); (b) states honesty: corrupt rows are a platform defect, not client info | REQ-051. The `audit_action_type` pgEnum (`backend/db/schema/enums.ts:66-74`) makes corrupt values non-persistable through the shipped writer; the branch exists purely as defense-in-depth |
| D7 | **Two-tier immutability proof**: (a) static source scan pinning zero production `update(auditLogs)`/`delete(auditLogs)` callsites + `AuditService` exposing no mutation method beyond the insert writer; (b) DB trigger tier — the trigger SQL is ALREADY PRESENT at `backend/db/migration/3-immutability-triggers.sql` and ALREADY SHIPPED as `backend/drizzle/20260825222701_custom_3-immutability-triggers/migration.sql` (idempotent: `CREATE OR REPLACE FUNCTION prevent_audit_logs_update/delete` + `DROP TRIGGER IF EXISTS`; covers `audit_logs` alongside `student_payments`/`teacher_transaction`) — the ticket's job is the verification/proof tier; only if Phase 0's grep contradicts (drift) does a NEW drizzle custom migration folder get authored. The environment-branched test uses the `pg_trigger` catalog probe (per the existing probe at `test/helpers/db-cleanup.ts:84-86`) | (a) docs-only promise; (b) app scan + shipped trigger proof | (a) is what a claim without a test is; (b) makes the shipped trigger's behavior executable and survives "a future repo PR adds a delete path" | REQ-019/020. The trigger file is the ONLY sanctioned non-Drizzle artifact; `git diff backend/db/schema/**` stays EMPTY (REQ-042) |
| D8 | **`details` flows through VERBATIM** (raw string, nullable). The read layer never parses, never re-seals, never rejects malformed JSON | (a) parse + project `changedFields` globally (DEV3-016's activity surface behavior); (b) verbatim | (a) belongs to the per-user activity surface where the producer vocabulary is closed (`{changedFields: [...]}`); the GLOBAL trail aggregates DEV3-017..022d writers with heterogeneous `details` shapes (e.g. `{role:...}`, `{changedFields:[...]}`, `{cohort:...}`) — parsing here would hard-fail future producers; (b) maximal forward-compatibility | REQ-021. The write-side hygiene (names/metadata only, ≤2000 chars) stays enforced at the writer |
| D9 | **`entityId` is nullable end-to-end** (wire `Int`, type `number | null`, UI em-dash branch). The column is nullable at `backend/db/schema/audit/audit-logs.ts:39`; DEV3-022d's broadcast writer documents `entityId: null` rows. NOTE (verified): the WRITE-side contract `AuditLogWriteContract.entityId` is still `number` at `backend/types/contracts/admin-audit.contract.types.ts:27` — its widening is DEV3-022d's in-flight gap-fix (their plan D6); this ticket consumes the COLUMN (read-only) and never touches the write contract | (a) require non-null; (b) nullable | (a) would break the moment broadcast rows land; (b) matches the physical column | Forward-compat without cross-ticket coupling |
| D10 | **The page table is built from raw MUI `Table` primitives — NOT from `AppDataGrid`.** Verification finding: `AppDataGrid` appears ONLY in root `AGENTS.md` prose; it is ABSENT from `frontend/components/ui/` (CONFIRMED contents: the eight components `fieldError.ts`, `focusRing.ts`, `GraphQLErrorSurfaceHost.tsx`, `NotificationDrawer.tsx`, `NotificationRealtimeToastHost.tsx`, `NotificationUnreadBadge.tsx`, `PermissionDeniedFallback.tsx`, `RetryableNotice.tsx`, PLUS `fieldError.test.ts` and an (empty) `graphqlErrorSurface/` subdirectory — `AppDataGrid`, `PageContainer`, and `MetricCard` are prose-only phantoms with NO definition anywhere under `frontend/`). Prose-only phantom → do not consume | (a) `AppDataGrid`; (b) MUI primitives | (a) imports a component that cannot build; (b) self-contained, per the spec directive | REQ-066 (spec-mandated) + Verification-First Ground-Truth Rule 1 |
| D11 | **Date pickers are native `TextField type="date"` pairs**, building UTC-day boundaries (`<day>T00:00:00.000Z` → next day) — NOT the MUI X DatePicker/locale-provider stack | (a) DatePicker + localization provider; (b) native date inputs | (a) drags the MUI X providers + adapter surface into a filter corner for zero value; (b) native, RTL-inert, cheap | REQ-066. Boundary semantics (`>= from`, `< to`) pinned by REQ-014 tests row-by-row |
| D12 | **Navigation is a ZERO-CHANGE retarget**: `{ route: "/audit", labelKey: "audit" }` already exists in the Admin nav list (`frontend/views/dashboard/navItems.ts:126-135`, the item at :133; the icon is imported aliased as `AssessmentOutlined as AuditIcon` at `navItems.ts:7`). The job is shipping the page the item points at — NOT adding a duplicate, NOT moving the label (the `audit` key stays owned by `DashboardLabels` per the ownership matrix test `navItems.test.ts:46-59`) | (a) add a new item; (b) retarget by shipping the page | (a) duplicates a route key; (b) honors Invariant 12 | REQ-065 |
| D13 | **i18n extends the EXISTING `adminUsers` namespace** with ONE `auditTrail` block; the seven action labels are REUSED from `adminUsers.activity.action*` (`shared/locale/types/adminUsers/index.ts:417-451`). Parity-test note (VERIFIED): `shared/locale/adminUsers-namespace.parity.test.ts` is VERIFIED ABSENT (the parity suite inventory is exactly applicant/errors/handshakeCode/notifications/plans; `handshakeCode-namespace.parity.test.ts` is VERIFIED PRESENT) — CREATE it modeled on `shared/locale/handshakeCode-namespace.parity.test.ts` and pin the new block under both locales + Arabic-script presence | (a) new namespace; (b) extend adminUsers | (a) mints near-duplicate admin-surface copy — banned by `shared/AGENTS.md`'s no-near-duplicates posture; (b) the audit trail IS an admin-users-domain surface | REQ-067 |

---

## 2. Data Models & Database Schema

### 2.1 Existing Schema Verification (READ-ONLY — zero drift gate REQ-042)

| Element | Verified location (bundle anchor) | Contract consumed |
|---|---|---|
| `audit_logs` (id identity PK (`generatedAlwaysAsIdentity`), `actor_id` FK → users ON DELETE RESTRICT, `action_type` pgEnum, `entity_type` varchar(100), `entity_id` integer **NULLABLE**, `details` varchar(2000) nullable, `created_at` defaultNow) | `backend/db/schema/audit/audit-logs.ts:30-46` | Sole read target; indexes `audit_logs_actor_id_idx` + `audit_logs_entity_type_entity_id_idx` (:44-45) are the filter's index cover |
| `audit_action_type` pgEnum (7 values) | `backend/db/schema/enums.ts:66-74`; TS mirror `backend/enum/audit/audit-action-type.enum.ts:6-14` | `AuditActionType` value imports |
| `users` (`fullName` for the join projection; governance columns NOT filtered on — REQ-022) | `backend/db/schema/users/users.ts` | Inner join `actor_id = users.id` |

**Completion gate:** `git diff backend/db/schema/**` MUST be EMPTY. The single carve-out (REQ-042): the trigger SQL is VERIFIED PRESENT — `backend/db/migration/3-immutability-triggers.sql` exists live and is ALREADY SHIPPED as `backend/drizzle/20260825222701_custom_3-immutability-triggers/migration.sql`; an OPTIONAL new idempotent SQL file under `backend/db/migration/**` is authored ONLY IF Phase 0's grep contradicts this verified fact (drift). (`docs/admin/user-management.md` §2.4's `3-immutability-triggers.sql` reference resolves to a real file, not merely a prose anchor.) No `bun run db push` for this ticket; any drift-authored trigger applies via `bun db migrate` per `docs/DATABASE_MIGRATIONS.md` ("after changing custom SQL on an already-migrated DB, add a NEW drizzle custom migration folder").

### 2.2 Canonical Types (NEW — `backend/types/audit/audit-trail.types.ts`)

No table is added — NO `{Entity}SelectType`/`InsertType` pair is re-declared (the existing `AuditLogSelectType`/`AuditLogInsertType` at `backend/types/audit/audit-log.types.ts:3-4` remain the table types). Barrel `backend/types/audit/index.ts` (currently `export * from "./audit-log.types";` at :1) gains `export * from "./audit-trail.types";`.

```typescript
// backend/types/audit/audit-trail.types.ts (NEW)
import type { AuditActionType } from "@/backend/enum/audit/audit-action-type.enum";

/** Service input as copied field-by-field from the GraphQL resolver (closed whitelist). */
export interface AdminAuditTrailFiltersSubmitInput {
  readonly actorId?: number | null;
  readonly actionType?: AuditActionType | null;
  readonly entityType?: string | null;
  readonly entityId?: number | null;
  readonly from?: Date | null;
  readonly to?: Date | null;
}

/** One rendered row of the global trail. entityId/details are nullable by design (D8/D9). */
export interface AdminAuditLogEntryReturnType {
  readonly id: number;
  readonly actionType: AuditActionType;
  readonly actorId: number;
  readonly actorName: string;         // CURRENT users.full_name (documented, not a snapshot)
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
}

export interface AdminAuditLogPageReturnType {
  readonly items: readonly AdminAuditLogEntryReturnType[];
  readonly totalCount: number;
  readonly page: number;
  readonly pageSize: number;
}
```

### 2.3 Repo-local row types (documented precedent — NOT in `backend/types/`)

Mirroring the DEV3-016 repo-local pattern (`AdminUserDirectoryRow`…`AdminUserActivityRow` live INSIDE `backend/db/repo/admin/admin-user.repository.ts:113-250`), the NEW repository file exposes:

```typescript
// backend/db/repo/audit/audit-trail.repository.ts (CREATE) — module-local, exported
export interface NormalizedAuditTrailFilters {
  readonly actorId?: number;
  readonly actionType?: AuditActionType;   // post-membership-assertion
  readonly entityType?: string;            // trimmed, ≤ 100
  readonly entityId?: number;
  readonly from?: Date;
  readonly to?: Date;
}
export interface AuditTrailEntryRow {
  readonly id: number;
  readonly actionType: string;             // RAW stored value; coercion is service-owned (D6)
  readonly actorId: number;
  readonly actorName: string;
  readonly entityType: string;
  readonly entityId: number | null;
  readonly details: string | null;
  readonly createdAt: Date;
}
```

### 2.4 Phantom-Guard Registry (statically pinned for the NEW files)

| Forbidden token (in the new production files) | Why | Enforcement |
|---|---|---|
| `update(auditLogs)`, `delete(auditLogs)` | Append-only table — REQ-019 | REQ-072(a) static scan over production sources (`backend/**` minus test layers), teardown files path-allowlisted (`test/**`) |
| `rejects.toThrow` inside rollback tests | Deadlock hazard | `backend/db/test/AGENTS.md` rule 3 |
| `--` inside any `sql` template | Parameter-binding hazard | repo AGENTS + review checklist |
| `useLazyQuery`, `next-intl`, `console.` | Layer rules | sub-loop + lint |
| `LIKE` / `ILIKE` / `escapeLikeWildcards` | No wildcard surface exists; guard never arises (D5) | static grep on the new repo file |
| A second `enumType(` registration for `AuditActionType` | Re-registration is a runtime error; REUSE `AuditActionTypePothosEnum` (`backend/graphql/pothos/shared/enum.pothos.ts:112-114`) | Pothos build + schema tests |

---

## 3. API Contracts & Pothos Resolvers

### 3.1 GraphQL Schema Additions (exact — REQ-060/061)

```graphql
input AdminAuditLogFiltersInput {
  actorId: Int
  actionType: AuditActionType
  entityType: String
  entityId: Int
  from: DateTime
  to: DateTime
}

type AdminAuditLogEntry {
  id: ID!
  actionType: AuditActionType!
  actorId: Int!
  actorName: String!
  entityType: String!
  entityId: Int
  details: String
  createdAt: DateTime!
}

type AdminAuditLogPage {
  items: [AdminAuditLogEntry!]!
  totalCount: Int!
  page: Int!
  pageSize: Int!
}

extend type Query {
  adminAuditLogs(filters: AdminAuditLogFiltersInput, page: Int, pageSize: Int): AdminAuditLogPage!
}
```

### 3.2 Pothos Registration Details

| Layer | File | Content |
|---|---|---|
| Objects + input (NEW) | `backend/graphql/pothos/admin/audit-trail.pothos.ts` | `gqlSchemaBuilder.objectRef<AdminAuditLogEntryReturnType>("AdminAuditLogEntry")` — `id: t.exposeID("id")` FIRST (Apollo normalization), `actionType: t.expose("actionType", { type: AuditActionTypePothosEnum })` (REUSED enum — NEVER re-register), `actorId: t.exposeInt(...)`, `actorName: t.exposeString(...)`, `entityType: t.exposeString(...)`, `entityId: t.exposeInt("entityId", { nullable: true })`, `details: t.exposeString("details", { nullable: true })`, `createdAt: t.expose("createdAt", { type: "DateTime" })` (D4); `AdminAuditLogPage` object — `items/totalCount/page/pageSize`, NO `id` (embedded wrapper); `AdminAuditLogFiltersInput` input type — all six members optional; `from`/`to` via `t.field({ type: "DateTime", required: false })` (builder Scalars `Input: Date`). NO local types — canonical imports from `@/backend/types` |
| Query (NEW) | `backend/graphql/query/admin/audit-trail.query.ts` | ONE `gqlSchemaBuilder.queryField("adminAuditLogs", …)`, `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (the load-bearing conjunction — `backend/graphql/query/admin/admin-users.query.ts:74-79` precedent), resolver: `if (!ctx.user) throw new UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized)` belt (pattern per `backend/graphql/mutation/notifications/notification.mutation.ts:114-117`), then delegate with EXPLICIT field copies: `filters: { actorId: args.filters?.actorId ?? null, actionType: args.filters?.actionType ?? null, entityType: args.filters?.entityType ?? null, entityId: args.filters?.entityId ?? null, from: args.filters?.from ?? null, to: args.filters?.to ?? null }`, `args.page ?? null`, `args.pageSize ?? null`, `ctx.locale`, `ctx.user.id`. NO try/catch, NO business logic |
| Barrels | `backend/graphql/pothos/admin/index.ts` (currently `export * from "./admin-user.pothos";` :1) + `backend/graphql/query/admin/index.ts` (currently `import "./admin-users.query";` :1) | ONE line each |

`backend/lib/gateway/public-operations.ts:36-46` is NOT touched — the frozen six stay frozen; the handshake surface test's allowlist assertion (`backend/graphql/test/handshake-code-surface.test.ts:268-290`) stays green UNCHANGED.

### 3.3 Error Mapping (`extensions.code`)

| Failure | Class | `extensions.code` | Emission point |
|---|---|---|---|
| Anonymous caller | scope `$all.authenticated` throws `UnauthorizedError` | `UNAUTHORIZED` | pre-resolver (builder at `backend/graphql/pothos/builder.ts:111-143`) |
| Authenticated non-admin | `role` scope false → mapped `ForbiddenError` | `FORBIDDEN` | pre-resolver |
| Service gate `actorId = 0` | `UnauthorizedError` | `UNAUTHORIZED` | shared `assertActorAdmin` |
| Service gate non-admin actor | `ForbiddenError` | `FORBIDDEN` | shared gate |
| Hostile page/pageSize/ids/entityType/date-range/actionType | `ValidationError` (default code) | `VALIDATION` | service, pre-DB (REQ-013..016) |
| Corrupt stored `actionType` | plain `Error` (D6 precedent) | masked `INTERNAL_SERVER_ERROR` | boundary (`backend/graphql/graphqlErrorsFinalizer.ts` — the masking function `finalizeGraphqlErrors` itself lives in `@/backend/lib/errors`; `graphqlErrorsFinalizer.ts` imports/calls it at :61/:181) |
| Unexpected internals | masked | `INTERNAL_SERVER_ERROR` | boundary |

NO `NotFoundError` exists on this surface (no per-id endpoint — REQ-050). NO new codes minted.

### 3.4 Permission Matrix

| Caller | `adminAuditLogs` | Public allowlist impact |
|---|---|---|
| Anonymous | `UNAUTHORIZED` (401 semantics, pre-resolver) | — |
| Student / Teacher / Parent | `FORBIDDEN` (403, pre-resolver; ALSO service-gated if reached directly) | — |
| Super Admin (active) | ✅ full read | none |
| Governed admin (suspended/blocked/deleted, pre-issued unexpired token) | ⚠️ **documented governance window — reads proceed** (REQ-033): `createGraphQLContext` (`backend/graphql/gqlContextFactory.ts:167-239`) applies no governance re-check by design; login (`backend/services/auth/auth.service.ts:91-98`'s governance gate, login call at :155-156) and SSR (`backend/lib/auth/server-auth.ts:97-106`) own that denial. NO request-time re-check is added by this ticket. (Contrast: DEV3-022d's high-blast-radius BROADCAST mutation added a service-tier self-guard — a divergence a read surface deliberately does not copy.) | — |

### 3.5 Schema-Surface Baseline Updates (SAME change set — REQ-062)

| File | Update |
|---|---|
| `backend/graphql/test/schema-surface.test.ts` | `PRE_3_1_QUERY_FIELDS` (:91-99) additions-baseline: the additions assertion (:195-200, currently `["_health","findStudentByHandshakeCode","myHandshakeCode"]`) GAINS `"adminAuditLogs"` (sorted, computed: `["_health","adminAuditLogs","findStudentByHandshakeCode","myHandshakeCode"]`); the whole-schema type-name additions pin (:277-284, currently `["DateTime","HandshakeCodeLookup","HealthCheck"]`) GAINS the three new type names (`AdminAuditLogEntry`, `AdminAuditLogFiltersInput`, `AdminAuditLogPage`). **NOTE (verified): the live `PRE_3_1_QUERY_FIELDS` is [`adminPlans`, `me`, `myApplicantProfile`, `myNotifications`, `myUnreadNotificationCount`, `planCatalog`, `recitationReadings`], and it ALSO OMITS the DEV3-016 admin query fields (`adminUsers`, `adminUserDetail`, …) — the same staleness concern as `sdl-static-assertions.test.ts`**; if sibling Sprint-3 surfaces (DEV3-022c analytics fields / DEV3-022d `broadcastNotification`) land concurrently, the baselines absorb them additively — NEVER drop entries; the task re-pins against the live regenerated schema and asserts the computed sorted literal |
| `backend/graphql/test/sdl-static-assertions.test.ts` | `FROZEN_QUERY_FIELDS` (:78-85) gains `"adminAuditLogs"` in sorted position. VERIFY live contents at this point — the bundle's frozen list notably OMITS the DEV3-016 admin surface (`adminUsers`/`adminUserStats`/…), which implies the committed SDL snapshot may predate DEV3-016's codegen; the implementing agent re-pins against the regenerated SDL per the same-change-set rule, recording the reconciliation in the outcome |
| `backend/graphql/test/plan-catalog.schema.test.ts` | committed-SDL byte-parity assertion (:67-73) MUST stay green AFTER `bun run generate:gqlSchema && bun codegen` artifacts are committed in the same change set |
| `backend/graphql/test/handshake-code-surface.test.ts` | frozen-six public-allowlist pin (:268-290) — UNCHANGED, stays green |

---

## 4. Backend Services, Repositories & Concurrency Model

### 4.1 Shared Gate + Coercion Extraction (REQ-004 — D2)

**VERIFY-OR-CREATE** `backend/services/admin/admin-gate.helpers.ts`:

- IF the file already exists (the DEV3-022c extraction direction), import `assertActorAdmin` from it and ADD `toAuditActionType` there (extend, never fork).
- ELSE create it carrying BOTH functions extracted VERBATIM:

```typescript
// EXTRACTED VERBATIM from backend/services/admin/user-management.service.ts:240-271
export async function assertActorAdmin(actorId: number, locale: string, outerTx?: DBTransaction): Promise<void>;

// EXTRACTED VERBATIM from backend/services/admin/user-management.service.ts:130-149
export function toAuditActionType(raw: string): AuditActionType | null;
```

**UPDATE** `backend/services/admin/user-management.service.ts`: delete the private copies, import from the shared module. Zero API/behavior drift; its suites (`user-management.service.test.ts`, `user-management.chaos.test.ts`, both under `backend/services/admin/`) are the byte-equivalence regression lock. Export the helpers via `backend/services/admin/index.ts`.

### 4.2 Service — `backend/services/admin/audit-trail.service.ts` (CREATE)

Namespace `AuditTrailService`; exported from `backend/services/admin/index.ts`.

```typescript
export async function listAuditTrail(
  filters: AdminAuditTrailFiltersSubmitInput,
  page: number | null | undefined,
  pageSize: number | null | undefined,
  locale: string,
  actorId: number,
  outerTx?: DBTransaction
): Promise<AdminAuditLogPageReturnType>;
```

**Pipeline (validation precedence is load-bearing — REQ-053):**

1. **Gate:** `await assertActorAdmin(actorId, locale, outerTx)` — PRE-DB for everything else; denials emit exactly ONE `logger.logDomainError` (inside the shared gate) and write ZERO rows (JR-C-1 extension: reads never audit).
2. **Filter structural validation (pre-DB):**
   - `actorId`/`entityId` present → must satisfy a module-local positive-safe-integer guard (`typeof "number" && Number.isInteger && > 0 && <= Number.MAX_SAFE_INTEGER`); else `ValidationError(tErrors.validation)`.
   - `entityType` present → `trim()`; empty-after-trim ⇒ DROPPED from the normalized filter (treated as absent); length > 100 ⇒ `ValidationError` (the column is varchar(100)).
   - `actionType` present → re-assert membership against `Object.values(AuditActionType)` (fail-closed defense-in-depth — wire input already carries a real enum member, but journey/service callers are honored); non-member ⇒ `ValidationError`.
   - `from`/`to` present → each must be `instanceof Date` with finite `getTime()`; BOTH present ⇒ `from.getTime() < to.getTime()` strictly; otherwise `ValidationError`. All BEFORE any DB contact.
3. **Pagination (pre-DB):** `resolvedPage = page ?? 1` — must be a positive integer; `resolvedPageSize = pageSize ?? 25` — integer in `1..100` (DEV3-016 parity, `user-management.service.ts` constants precedence). Violations → `ValidationError`.
4. **Read:** ONE transaction at repeatable-read snapshot (D3): `countEntries(normalized, tx)` + `listEntries(normalized, limit, offset, tx)` from the same snapshot.
5. **Map:** per row, `toAuditActionType(row.actionType)`; `null` ⇒ `throw new Error(\`Unexpected audit action type: ${row.actionType}\`)` (D6 — masked at the boundary, NEVER a domain code). Assemble `AdminAuditLogEntryReturnType[]` + wrapper. Honest empty: `{ items: [], totalCount: 0, page, pageSize }` (REQ-017).
6. **Logging:** happy path logs NOTHING (REQ-035); every expected denial = exactly one bounded `logDomainError` `{ code, entity: "audit_logs", entityId?, locale }` — NEVER filter payloads, NEVER `details` content.

### 4.3 Repository — `backend/db/repo/audit/audit-trail.repository.ts` (CREATE)

`backend/db/repo/audit/index.ts` (CREATE: `export * from "./audit-trail.repository";`); top-level `backend/db/repo/index.ts` gains `export * from "./audit";` (its current listing — admin/billing/notifications/parents/students/teachers/users — is bundle-verified). `backend/db/repo/AGENTS.md`'s Layout forward-names `audit/` — the repo now exists (the AGENTS line lands in knowledge propagation).

```typescript
export namespace AuditTrailRepository {
  export async function listEntries(
    filters: NormalizedAuditTrailFilters,
    limit: number,
    offset: number,
    tx?: DBTransaction
  ): Promise<AuditTrailEntryRow[]>;
  export async function countEntries(
    filters: NormalizedAuditTrailFilters,
    tx?: DBTransaction
  ): Promise<number>;
}
```

Implementation contract:

- Executor discipline `(tx ?? db)` (precedent: `admin-user.repository.ts:515`).
- ONE shared `buildWhere(filters): SQL | undefined` — conjunctive conditions: `eq(auditLogs.actorId, …)`, `eq(auditLogs.actionType, …)`, `eq(auditLogs.entityType, …)`, `eq(auditLogs.entityId, …)`, `gte(auditLogs.createdAt, from)`, `lt(auditLogs.createdAt, to)`. Absent members drop out entirely (unfiltered listing is the fallback, never an error).
- Projection: `id`, `actionType`, `actorId`, `actorName: users.fullName`, `entityType`, `entityId`, `details`, `createdAt` via `.innerJoin(users, eq(users.id, auditLogs.actorId))` — mirrors the join in `getActivity` (`admin-user.repository.ts:515-526`) with `actorId` additionally selected.
- Order `desc(auditLogs.createdAt), desc(auditLogs.id)`; `.limit(limit).offset(offset)`.
- NO prepared statements (dynamic filter chain — `docs/drizzle/prepared-statements.md`); NO `sql.placeholder` combos; NO inline `--` comments in any `sql` template; NO LIKE/ILIKE anywhere (D5 — the `escapeLikeWildcards` obligation never arises).
- NO governance filtering anywhere (REQ-022/037 — history survives governance; INV-U1/U5).

### 4.4 Concurrency & Race Condition Assessment

| Scenario | Actors | Risk | Mitigation |
|---|---|---|---|
| `totalCount` vs `items` tear under a mid-request producer commit | admin reader × writing admins (this is the norm — audit rows are produced constantly) | page shows a count from a different instant than its rows | D3: BOTH reads inside ONE REPEATABLE READ transaction — one snapshot per response (REQ-040) |
| Rows inserted DURING pagination (page N then page N+1) | reader across multiple requests | duplicate/skipped rows between pages | Stable sort key `createdAt DESC, id DESC` + offset; newest-rows-shift is the documented, honest page-window semantics (same as the DEV3-016 directory); keyset refinement is deferred (ledger D-KEYSET) |
| Concurrent N-way reader storm | N admin tabs | load | Pure reads; FORCED mid-read failure chaos case asserts masked `INTERNAL_SERVER_ERROR` + exactly one correlated log (REQ-043), never a partial page presented as complete |
| Writer deletes a user row referenced by an audit row | governance × reader | impossible — `actor_id` has `ON DELETE RESTRICT` (`audit-logs.ts:34-36`) | structural |
| Governance flips on the actor AFTER rows exist | governed actor | hidden history | non-issue by design: the trail NEVER governance-filters (REQ-022); the join reads `fullName` regardless of governance flags |
| TOCTOU on filters | — | none — values are validated once, pre-DB, and the read is a closed snapshot | REQ-053 ordering |
| Locks | — | — | NO `SELECT FOR UPDATE`, NO advisory locks, NO Redis `SET NX EX` — a pure read of an append-only table has nothing to race against (REQ-044) |

### 4.5 Cross-Actor Journey Design (MANDATORY — specs §2.9)

**Shared-entity state machine (the trail's observable slice):**

```mermaid
stateDiagram-v2
  [*] --> Baselined: cast committed (admin A, admin B, student, parent) + row-count oracles captured
  Baselined --> ProducerRows: Admin A commits createUser → updateUser → setUserDeleted(true) → setUserDeleted(false)
  ProducerRows --> FullVocabulary: System commits fixture-direct override/adjust/suspend rows
  FullVocabulary --> Observed: Admin B filters/paginates/date-ranges (every assertion green)
  Observed --> DenialsClean: student/parent/anonymous probes rejected pre-DB; oracles byte-identical
  DenialsClean --> Teardown: tracked hard-delete (audit rows FIRST via withAuditDeleteTriggersSuspended) → zero residue
```

**Side-effect matrix per journey step:**

| Step (actor → action via REAL service) | Rows created/updated | What Admin B observes | Side effects (notifications/audit) |
|---|---|---|---|
| 1. System → committed cast | users + role children | baseline snapshot | none |
| 2. Admin A → `createUser` (student target) | users + students + 1 audit row (`create`, entityType `user`, entityId target) | filter `{entityType:"user", entityId}` → exactly ONE row, `actorId=AdminA`, `actorName`=A's name, `details` parses to names-only (`{role:...}` — NO PII pairs) | zero notifications |
| 3. Admin A → `updateUser` → `setUserDeleted(true)` → `setUserDeleted(false)` | +3 audit rows | FOUR rows newest-first: `reactivate, delete, update, create` — exact order + per-row action types | zero notifications |
| 4. System → fixture rows for `override`/`adjust`/`suspend` (documented fixture lane — producer tickets future) | +3 fixture audit rows | filtering by EACH of the seven `AuditActionType` members returns exactly the matching subset (J-AUD-02; PRODUCTION_READINESS 1.3.5) | none |
| 5. Admin B → pagination (pageSize=2 over a 5-row filtered set) + `from`/`to` window | none | gapless/non-overlapping windows, honest `totalCount`; boundary rows included/excluded per REQ-014's `>= from` / `< to` rule | none |
| 6. Denied actors (student / parent → `ForbiddenError`; anonymous id=0 → `UnauthorizedError`) | ZERO new rows | denial BEFORE any read; audit_logs + notifications row-count oracles byte-unchanged | none (no audit pollution from denials) |
| 7. Governance probe — target already soft-deleted in step 3 | — | the full four-row history of the governed target STILL renders in full (J-AUD-05 / REQ-022) | none |
| 8. System teardown → tracked hard-delete, audit rows FIRST under `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`), users after | all fixture rows removed | post-teardown snapshot == baseline EXACTLY; re-probes assert zero residue | — |

**Cross-Actor Visibility Matrix:**

| After step | Admin A | Admin B | Student | Parent |
|---|---|---|---|---|
| Cast committed | (no trail reads needed) | baseline | nothing (service→`ForbiddenError`) | nothing |
| Producer mutations | sees own actions | sees A's actions fully attributed | MUST NOT read (J-AUD-04) | MUST NOT read |
| Target governed | history intact | history intact | row EXISTS but is invisible to them regardless | invisible |
| Teardown | baseline | baseline | — | — |

**Journey harness obligations:** `test/workflows/admin/audit-trail.journey.test.ts` — written TEST-FIRST. Rules honored from `test/workflows/AGENTS.md`: ONE committing `db.transaction` in `beforeAll`; all fixture ids registered with `TrackedFixtures`; teardown = reverse-order hard-delete + `withAuditDeleteTriggersSuspended` for audit rows + post-teardown zero-residue re-probes; unique `jrn_aud_<uuid8>` prefixes; actors via `provisionAdminActor`/`provisionStudentActor`/`provisionParentActor` (helpers barrel `@/test/workflows/helpers` — VERIFIED PRESENT: `test/workflows/` already contains `admin/` (2 journey tests), `helpers/` (`actor-context.ts` with `provisionAdminActor` at L136 / `provisionStudentActor` at L88 / `provisionParentActor` at L122, `tracked-fixtures.ts` `TrackedFixtures`, `spied-transport.ts`, `index.ts` barrel), `notifications/`, `parents/`, and `AGENTS.md`; the barrel is anchored live by the `SpiedFanoutTransport` import at `backend/services/notifications/realtime/fanout-transport.test.ts:25` — note the observed import there is from the sub-file `@/test/workflows/helpers/spied-transport`, but THIS ticket's journey code imports from the barrel; the workflow AGENTS documents `TrackedFixtures`, the actor-context factory, and the harness self-test); REAL actor ids into service calls; denials through the real role path (no monkey-patching); NO `runInRollback`; no external channels are touched by this surface at all (zero notifications — proven by oracles, no spy needed). Run via `bun run test/scripts/run-test.ts test/workflows/admin/audit-trail.journey.test.ts`. The harness scaffolding EXISTS — this ticket adds only the journey file inside the existing `test/workflows/admin/` directory; nothing needs to be scaffolded.

---

## 5. Frontend UX & Navigation Specification

### 5.1 Routes & URLs Table

| Path | Purpose | Required permission | Allowed roles |
|---|---|---|---|
| `/audit` | Global audit-trail browser (filter + paginated list) | Server guard `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })` + `adminAuditLogs` `$all`-gated | Admin only |
| `/audit?entityType=<v>&entityId=<n>` (+ optional `actionType`, `actorId`, `from`, `to`) | Deep-linked prefilter — the stable target for DEV3-016's per-user "view full audit log" affordance (REQ-068) | same | Admin only |

Anonymous → `/login?redirect=/audit`; role mismatch → `roleDashboardPath(ctx.role)` (`frontend/lib/auth/roleDashboardRoute.ts:52-65`) — bare `/dashboard` is FORBIDDEN as a redirect target. The new static route wins over any `[feature]` catch-all by Next.js static-over-dynamic precedence (Phase 0 verifies the catch-all relationship per REQ-064).

### 5.2 Sidebar & Navigation Integration

**ZERO nav-model change (D12).** The Admin nav ALREADY carries `{ route: "/audit", labelKey: "audit", Icon: AuditIcon … }` (`frontend/views/dashboard/navItems.ts:126-135`, item at :133; the icon is imported aliased as `AssessmentOutlined as AuditIcon` at `navItems.ts:7`). This ticket SHIPS THE PAGE; it does not touch `navItems.ts`. `frontend/views/dashboard/navItems.test.ts` GAINS two pins: admin nav contains `/audit` with `labelKey: "audit"`; student/teacher/parent lists exclude it. The ownership-matrix test (:46-59) stays green because `audit` stays owned by `DashboardLabels` alone. There is NO mobile bottom-nav component — mobile flows through the temporary MUI `Drawer` in `DashboardSidebar.tsx` automatically.

### 5.3 Per-Audience Rendering

| Audience | Render |
|---|---|
| Student / Teacher / Parent | never reach it — server redirect to their role dashboard; query denied pre-resolver if probed |
| Admin | header (title/subtitle) + filter form + paginated table + expandable details; refresh on demand |
| Governed admin | SSR guard fails closed (`server-auth.ts:97-106`); the GraphQL-window posture is documented only (REQ-033) |

### 5.4 Apollo GraphQL Documents & UI Components

**CREATE** `frontend/graphql/sharedDocuments/admin/audit-trail.documents.ts`:

```graphql
query AdminAuditLogs($filters: AdminAuditLogFiltersInput, $page: Int, $pageSize: Int) {
  adminAuditLogs(filters: $filters, page: $page, pageSize: $pageSize) {
    items { id actionType actorId actorName entityType entityId details createdAt }
    totalCount
    page
    pageSize
  }
}
```

- `adminAuditLogsQueryDocument: TypedDocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables>`; `id` FIRST in the entry selection; exported via `frontend/graphql/sharedDocuments/admin/index.ts` (currently `export * from "./admin-users.documents";` :1) and flows through the top barrel (`frontend/graphql/sharedDocuments/index.ts:1` already re-exports `./admin`).
- `useQuery` ONLY (no `useLazyQuery`); hooks from `@apollo/client/react`.
- **Cache registration:** `frontend/providers/apollo/apolloCache.ts` `typePolicies` gains `AdminAuditLogPage: { keyFields: false }` (embedded wrapper; `AdminAuditLogEntry` normalizes by `id` naturally — no registration). The frozen policy-inventory assertion (`frontend/providers/apollo/apolloCache.test.ts:176-185`) is extended in the SAME change set — VERIFIED: the assertion pins five policies while `apolloCache.ts` registers six (`NotificationListPage` drift confirmed); reconcile to the LIVE current set + `AdminAuditLogPage`, never subtracting. `frontend/graphql/AGENTS.md`'s embedded-type list gains the `AdminAuditLogPage` row. Companion documents contract test `frontend/graphql/sharedDocuments/admin/audit-trail.documents.test.ts` pins: named operation, variable set exactly `["filters","page","pageSize"]`, id-first selection (conventions per `frontend/graphql/sharedDocuments/documents.contract.test.ts`).
- Error seams: existing only — `mapGraphQLErrorByCode` (`frontend/providers/apollo/error-link.map.ts`), `PermissionDeniedFallback` for query-context FORBIDDEN, `RetryableNotice` for `RATE_LIMITED`/`SERVICE_UNAVAILABLE`, `fieldError.ts` projections for field errors. NO bespoke mapping.

**Component tree:**

```text
app/(dashboard)/audit/page.tsx              (Server Component — withPageAuth + generateMetadata)
└─ AuditTrailView                            (client; frontend/views/admin/audit/AuditTrailView.tsx — `frontend/views/admin/` EXISTS; only the `audit/` subdir is CREATE)
   ├─ Page header (title, subtitle)
   ├─ FilterBar: actorId TextField(number), entityId TextField(number),
   │   actionType Select (codegen AuditActionType values × localized adminUsers.activity.action* labels),
   │   entityType TextField, from/to native TextField type="date", Apply + Clear (≥44px)
   ├─ Table (MUI Table primitives — D10): When | Actor | Action chip | Entity type | Entity ID | Details
   │   └─ per-row expandable <details>/code block rendering `details` VERBATIM
   ├─ Pagination row (reuse adminUsers.pagination labels)
   ├─ Skeleton rows while loading (Box component="output" aria-busy)
   ├─ Empty state (namespace copy), generic error + retry, PermissionDeniedFallback, RetryableNotice
   └─ All styling via sx + theme.palette tokens; *Outlined icons; React.SubmitEvent discipline;
      logger from @/frontend/lib/logger; NO console.*
```

Date rendering uses the EXISTING `formatApplicantDate` (`frontend/lib/i18n/format-date.ts:56-59`) — reuse, never fork (REQ-069).

### 5.5 Visual Design & Responsive Specifications

- **Desktop 1440px:** table full-width in the dashboard container; filter bar as a single-row wrap grid; `details` column capped with an expandable toggle.
- **Tablet 768px:** filter grid collapses 2-col; table horizontally scrolls with a min-width track.
- **Mobile 375px:** single-column stacked filter fields; table horizontal scroll; touch targets ≥ 44px.
- **RTL/Arabic:** logical properties only (`marginInlineStart/End`, `textAlign: "start"`); `dir="auto"` on `details` code content (mixed-direction JSON blobs); Arabic copy rides the taller line-height stack; the `actionType` Select labels come from the localized `adminUsers.activity.action*` entries, never raw enum names.
- **Visual State Matrix:**

| State | Render |
|---|---|
| Initial load | skeleton rows + `aria-busy` output wrapper |
| Empty result set | namespace empty-state copy with `totalCount: 0`; NO error styling |
| Detail content | `null` → em-dash-style placeholder from the namespace; malformed JSON still renders verbatim |
| Null entityId | placeholder em-dash |
| Query error | namespace generic error + retry (`common.retry`); `RATE_LIMITED`/`SERVICE_UNAVAILABLE` → `RetryableNotice` |
| FORBIDDEN | `PermissionDeniedFallback` (never bare null) |
| Submit in flight | Apply button disabled + `aria-busy` |
| Hostile URL params | silently DROPPED at the server page's sanitize step (never trusted, never error) |

**Agent-Browser Verification Protocol:** login via the sanctioned flow (`test/ui/AGENTS.md` §Agent Browser Login — `bun run scripts/browser-login.ts --inject`), navigate `/audit` as the seeded admin: (1) trail table renders with seeded rows; (2) filters narrow the set (entityType=user + entityId); (3) pagination advances without overlap; (4) `details` expansion shows raw JSON; (5) anonymous/`student` session redirects to role dashboard or `/login`; (6) screenshots at 1440/768/375 × `en`/`ar` via the isolated visual-inspection subagent rule (DOM-first assertions, translations via handles only).

### 5.6 i18n — Extend `adminUsers` (NO new namespace — D13, REQ-067)

| File | Change |
|---|---|
| `shared/locale/types/adminUsers/index.ts` | `AdminUsersLabels` gains `auditTrail: { pageTitle; pageSubtitle; filters: { actorIdLabel; entityTypeLabel; entityIdLabel; actionTypeLabel; fromDateLabel; toDateLabel; applyAction; clearAction }; table: { whenHeader; actorHeader; actionHeader; entityTypeHeader; entityIdHeader; detailsHeader; detailsShowLabel; detailsHideLabel; noDetailsValue; noEntityIdValue; allActionsOption }; emptyState: { title; message }; errorState: { title; message } }` |
| `shared/locale/en/adminUsers/index.ts` + `shared/locale/ar/adminUsers/index.ts` | both leaf implementations (Arabic script in EVERY `ar` string slot) |
| `shared/locale/adminUsers-namespace.parity.test.ts` | **CREATE** (VERIFIED ABSENT — the parity suite inventory is exactly applicant/errors/handshakeCode/notifications/plans; the convention is pinned by `handshakeCode-namespace.parity.test.ts`, VERIFIED PRESENT): key-set equality across locales, non-empty values, Arabic-script presence, registry + bundle wiring (`AdminUsers` handle + `adminUsersTranslations` on both message bundles) — and the NEW `auditTrail` block pinned under both locales |
| Reuse rule | the seven action labels COME FROM `adminUsers.activity.action*` (`shared/locale/types/adminUsers/index.ts:417-451`) — NO near-duplicate minting (`shared/AGENTS.md` namespace discipline) |

Client reads use `useAppTranslation(AdminUsers)` (handle const — NOT a string; no `Translation` enum exists). The server page reads `getTranslations(locale).adminUsersTranslations.auditTrail…` for `generateMetadata`. Zone locale plumbing: `getLocaleFromCookie()` (`shared/locale/server-cookies.ts:6-13`).

---

## 6. Security, Authorization & Tenancy Mitigations

| Threat | Mitigation (load-bearing, test-pinned) |
|---|---|
| **BFLA** | `$all: { authenticated: true, role: [UserRole.Admin] }` scope conjunction on the single field (pre-resolver 401/403, the `admin-users.query.ts:74-79` precedent) + service-tier re-verification through the SHARED `assertActorAdmin` gate (`actorId = 0` → `UnauthorizedError`; resolvable non-admin → `ForbiddenError`) fired BEFORE any read. Denials write ZERO audit rows and perform ZERO reads beyond the gate (JR-C-1 extension — service-tier oracle tests) |
| **BOLA / IDOR** | The trail is a governed-read surface by design: `actorId`/`entityId` filters are FILTERS, never authorization inputs (REQ-031). The surface exposes NO per-row ownership semantics, NO mutation path to the referenced entities, and NO projection of `details` beyond verbatim display to admins. `ctx.user.id` is the only actor identity |
| **BOPLA** | `AdminAuditLogFiltersInput` is a CLOSED six-member input shape; the resolver copies field-by-field (NO `{ ...input }` spread); unknown/smuggled fields (`userId`, `actor_id`, etc.) die as `GRAPHQL_VALIDATION_FAILED` pre-resolver (wire-probe tests pin this); unknown root args likewise |
| **Injection / LIKE wildcards** | Equality + range comparisons only, all Drizzle-parameterized; ZERO LIKE/ILIKE surface (D5 — `escapeLikeWildcards` never arises); NO `sql`-template interpolation of input; NO inline `--` comments inside any `sql` template |
| **Error disclosure** | Closed code set `UNAUTHORIZED`/`FORBIDDEN`/`VALIDATION`; corrupt stored `actionType` is a masked internal (D6), never a decoded hint; unexpected internals mask once at `finalizeGraphqlErrors` with stack/SQL stripped |
| **Log hygiene** | One bounded `logDomainError` per denial (`{ code, entity: "audit_logs", entityId?, locale }`); NEVER filter payloads, NEVER `details` content, NEVER actor PII; happy paths emit NOTHING; `console.*` forbidden (logger: `@/backend/lib/logger` / `@/frontend/lib/logger`) |
| **Governance window honesty (REQ-033)** | NOT claimed fail-closed: `createGraphQLContext` applies NO governance filter (verified posture); login + SSR own the denial; the window is documented in the canonical doc and DELIBERATELY not patched service-side for this read surface |
| **History integrity (REQ-022/037)** | NO governance filtering on joins/reads — a soft-deleted actor's or target's rows render in full (INV-U1/U5 at the audit layer); journey step 7 pins it |
| **Immutability — application tier (REQ-019)** | Static scan pins: zero production `update(auditLogs)`/`delete(auditLogs)` callsites (test teardown layers path-allowlisted) + `AuditService` exposes NO mutation method beyond the insert writer |
| **Immutability — DB tier (REQ-020)** | Verify-or-create idempotent trigger SQL under `backend/db/migration/**` per `docs/DATABASE_MIGRATIONS.md` (custom-SQL channel for triggers); the test tier probes `pg_trigger` (shape per `test/helpers/db-cleanup.ts:84-86`), gated by `isPgliteProvider()` (`test/helpers/skip-when-pglite.ts:47-50`): WITH triggers → direct `tx.update`/`tx.delete` MUST throw (asserted via `expectRepoError`, NEVER `rejects.toThrow`); WITHOUT (push-provisioned) → the structural tier assertion stands and the gap is recorded in the outcome |
| **Rate limiting** | Unchanged — platform fail-open stub posture (`docs/parents/handshake-code-discovery.md` R6); nothing introduced here (REQ-036) |

---

## Test & Verification Topology (map for the tasks phase)

| Suite | File | Runner |
|---|---|---|
| Repo tier (runInRollback, tx everywhere, `expectRepoError`) — REQ-070 | `backend/db/test/logic/audit/audit-trail.repository.test.ts` (dir per `backend/db/test/logic/AGENTS.md` Layout, which forward-names `audit/`) | `bun run test/scripts/run-test.ts` |
| Immutability triple (static scan + trigger tier + migration-DDL idempotence pins) — REQ-072 | `backend/db/test/logic/audit/audit-immutability.test.ts` | same |
| Service tier (100% statement/branch on new code; denials-zero-oracles; boundary matrix; determinism) — REQ-071 | `backend/services/admin/audit-trail.service.test.ts` (+ chaos cases inline) | `bun run test:services` path |
| Wire matrix (anonymous/roles/BOPLA probes/bad enum/hostile pagination) — REQ-073 | `backend/graphql/test/audit-trail.query.test.ts` (`setupTestServerLifecycle` + `testClient` + raw HTTP, per `notification-integration.matrix.test.ts` precedent) | `bun run test:graphql` |
| Documents + cache + nav — REQ-074 | `frontend/graphql/sharedDocuments/admin/audit-trail.documents.test.ts`; `frontend/providers/apollo/apolloCache.test.ts` (extended); `frontend/views/dashboard/navItems.test.ts` (extended) | respective runners |
| Component tier (Happy DOM, translation preloads, mocked Apollo; skeleton/empty/FORBIDDEN/retryable/filter-submit/null-branches/RTL) — REQ-074 | `test/ui/components/admin/AuditTrailView.test.tsx` | `bun run test:ui:components` |
| Cross-actor journey (TEST-FIRST) — REQ-075 | `test/workflows/admin/audit-trail.journey.test.ts` | `bun run test/scripts/run-test.ts test/workflows/admin/audit-trail.journey.test.ts` |

---

## Deferred items (pre-registered in `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` at Task 0 — resolved-as-reference entries only)

| ID | Item | Owning direction | Status at plan time |
|---|---|---|---|
| D-ET-DROPDOWN | `SELECT DISTINCT entity_type` feed for a dropdown-backed filter UI | future UX ticket (spec-recorded) | ✅ reference |
| D-GOV-WINDOW | Request-time governance re-check on read surfaces (governed caller + pre-issued token window, REQ-033) | governance-context ticket (shared with the notification matrix's documented window and DEV3-022c's D-GOV-WINDOW) | ✅ reference |
| D-KEYSET | Keyset pagination refinement over `(created_at, id)` | future perf refinement (mirrors DEV3-016's D8 posture) | ✅ reference |
| D-EXPORT | CSV/PDF audit export | future compliance ticket — explicitly out of scope | ✅ reference |
| D-DETAIL-PROJECTION | Per-producer `details` projection vocabulary (e.g. broadcasting a structured `cohort` preview) stays per-surface | owning producer tickets (DEV3-022d lineage) | ✅ reference |
| D-TRIGGER-PUSH-GAP | Push-provisioned environments never apply custom SQL triggers — migrate-capable rollout path documented in the canonical doc | ops runbook / `docs/admin/audit-trail.md` REQ-080 | ✅ reference |

**End-state gates (REQ-076/082/083):** `git diff backend/db/schema/**` EMPTY; the conditional `backend/db/migration/**` addition reviewed per `docs/DATABASE_MIGRATIONS.md`; baseline deltas tsgo/oxlint/biome/lint = baseline + 0; `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` = 0; `@plan-review` passes with zero violations BEFORE implementation (`outcome/plan-review-R1.md` exists); canonical doc `docs/admin/audit-trail.md` exists; AGENTS propagation (services + repo + root `AGENTS.md` Important References) lands before closure.
