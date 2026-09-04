# DEV3-020 — Immutable Audit Logging for All Admin Actions: Implementation Tasks

> **Plan directory (verbatim — used in every header, ledger path, outcome path, and self-reference below):** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac`
> **Specs:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/specs.md` (REQ-001..083, J-AUD-01..05)
> **Plan:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/plan.md` (Decisions D1–D13)
> **Ledger:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md`
> **Outcomes:** `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/`

---

## ⚠️ Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Pre-Execution Outcome Read:** Before starting any task, read ALL existing files under `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/` — later tasks build on earlier verified facts (especially the Phase-0 phantom-sweep verdicts).
2. **Post-Edit Quality Gate:** After EVERY created/modified file, run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` and require exit code **0** before the task may be checked off.
3. **Test Execution:** Test files run ONLY via `bun run test/scripts/run-test.ts <test-path>` (never raw `bun test` — it skips `--env-file=.env.test`).
4. **Semantic Review:** Each implementation task closes with an agent self-review against the semantic checklist (atomicity, env-config, zero dead code, no cross-layer imports, enums as value imports, canonical types only).
5. **Outcome Documentation:** After each task, write `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/<task-id>-outcome.md` capturing: what was verified, what changed, gate results, deviations, and any ledger entries added/resolved.
6. **Checkbox Tracking:** Mark `[ ]` → `[x]` only after the task's own verification commands pass AND its outcome file is written.

---

## Phase 0: Pre-Implementation Baseline

- [x] **0.1 Record error baseline & initialize deferred-items ledger**
  - Run and record counts: `bun tsgo`, `bun run oxlint`, `bun biome:check`, `bun run lint --json --id baseline`; capture pre-existing modified files via `git diff --name-only`.
  - Initialize `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with the six resolved-as-reference entries from plan.md: **D-ET-DROPDOWN, D-GOV-WINDOW, D-KEYSET, D-EXPORT, D-DETAIL-PROJECTION, D-TRIGGER-PUSH-GAP**.
  - Write `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/phase0-baseline-outcome.md` with counts + modified-file set.
  - _Requirements: REQ-001, REQ-082_

- [x] **0.2 Prerequisite verification & prose-phantom sweep (verify-then-claim — MANDATORY)**
  - Verify each against LIVE code; record one verified-fact row per item in the outcome; any missing required artifact → ❌ ledger entry blocking the dependent task:
    1. Grep `backend/db/migration/**` for an audit-immutability trigger (`audit_logs` + `trigger`) → decides REQ-020 verify-vs-create branch.
    2. `backend/db/repo/audit/` — VERIFIED ABSENT → expected CREATE.
    3. `frontend/views/admin/audit/` (the `frontend/views/admin/` directory itself EXISTS with index/plans/users — only the `audit/` subdirectory is new) and `app/(dashboard)/audit/page.tsx` — expected CREATE.
    4. Any existing audit-immutability / audit-trail test under `backend/db/test/logic/audit/` — bundle shows none → verify.
    5. `/audit` routing: confirm the `[feature]` catch-all relationship so the new static route wins by Next.js precedence (REQ-064).
    6. `backend/services/admin/admin-gate.helpers.ts` existence (DEV3-022c extraction direction) → decides D2 import-vs-extract branch.
    7. `shared/locale/adminUsers-namespace.parity.test.ts` existence (VERIFIED ABSENT — parity suite inventory is exactly applicant/errors/handshakeCode/notifications/plans) → decides D13 verify-or-create.
    8. `frontend/providers/apollo/apolloCache.ts` registered policies vs the frozen inventory assertion in `apolloCache.test.ts:176-185` (reconcile the known `NotificationListPage` drift — VERIFY live set, never subtract).
    9. `backend/graphql/test/schema-surface.test.ts` (`PRE_3_1_QUERY_FIELDS`, additions assertion, whole-schema type-name additions) and `sdl-static-assertions.test.ts` (`FROZEN_QUERY_FIELDS`) LIVE contents → the Task-3.2 re-pin targets; absorb any concurrently-landed Sprint-3 fields additively.
    10. Confirm bundle anchors still hold: `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82-90`), `assertActorAdmin` (`user-management.service.ts:240-271`), `toAuditActionType` (:130-149), `getActivity` (`admin-user.repository.ts:510-528`), `AuditActionTypePothosEnum` (`enum.pothos.ts:112-114`), `DateTime` scalar (`scalar.pothos.ts:28`), `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`), `isPgliteProvider` (`test/helpers/skip-when-pglite.ts`), journey helpers barrel `@/test/workflows/helpers`, `navItems.ts:133` admin `/audit` item, seven `adminUsers.activity.action*` labels (`shared/locale/types/adminUsers/index.ts:417-451`), `formatApplicantDate` (`frontend/lib/i18n/format-date.ts:56-59`), `withPageAuth`/`roleDashboardPath`, `PermissionDeniedFallback`/`RetryableNotice` (real), `AppDataGrid` ABSENT (prose-only phantom — D10).
  - Write `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/0.2-prereq-verification-outcome.md`.
  - _Requirements: REQ-004, REQ-020 (branch decision), REQ-062, REQ-064, REQ-065, REQ-067, REQ-074_

---

## Phase 1: Types, Enums & Database Schema

> No Drizzle schema changes exist in this ticket (REQ-042 zero-drift gate). The only conditional structural artifact is the REQ-020 trigger SQL file decided by Task 0.2.

- [x] **1.1 Create canonical audit-trail types**
  - CREATE `backend/types/audit/audit-trail.types.ts` exactly per plan §2.2: `AdminAuditTrailFiltersSubmitInput`, `AdminAuditLogEntryReturnType`, `AdminAuditLogPageReturnType` (all `readonly`, `AuditActionType` value-typed, nullable `entityId`/`details`).
  - UPDATE `backend/types/audit/index.ts:1` — add `export * from "./audit-trail.types";` alongside the existing `./audit-log.types` re-export.
  - Applicable instructions: root `AGENTS.md`; `.agents/instructions/backend.instructions.md`. NO service-layer `.types.ts`; NO type re-declaration of `AuditLogSelectType`/`InsertType`.
  - _Requirements: REQ-003, REQ-010, REQ-061_
  - [x] 1.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/types/audit/audit-trail.types.ts --lifecycle duplicates` (exit 0); also on `backend/types/audit/index.ts`.
  - [x] 1.1.TE **Test Engineering:** compile-level guarantee — `bun tsgo` delta = 0; referenced from service/resolver tasks that consume the types (their suites are the behavioral pin).
  - [x] 1.1.SEC **Security & Tenancy Audit:** filter input contains NO identity-authority fields; return types expose no fields beyond REQ-010's closed projection.
  - [x] 1.1.SR **Semantic Review:** canonical location honored; no local duplicates of the table types; `AuditActionType` imported as a type from `@/backend/enum/audit/audit-action-type.enum`.
  - [x] 1.1.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md` + root `AGENTS.md`.
  - Write `outcome/1.1-outcome.md`.

- [x] **1.2 Immutability trigger verification (VERIFIED PRESENT + SHIPPED — proven, not created)**
  - The trigger SQL is VERIFIED present at `backend/db/migration/3-immutability-triggers.sql` and ALREADY SHIPPED as `backend/drizzle/20260825222701_custom_3-immutability-triggers/migration.sql` (idempotent: `CREATE OR REPLACE FUNCTION` + `DROP TRIGGER IF EXISTS`, covering `audit_logs` via `prevent_audit_logs_update/delete` alongside `student_payments`/`teacher_transaction`). This task confirms that fact: consume the existing trigger by reference; NO new file by default; record the confirmation in the outcome.
  - **Drift branch (only if Task 0.2's grep contradicts the verified finding):** CREATE one new idempotent custom SQL migration under `backend/db/migration/**` per `docs/DATABASE_MIGRATIONS.md` (the sanctioned raw-SQL channel for triggers): `CREATE OR REPLACE FUNCTION` raising on `UPDATE`/`DELETE` of `audit_logs` + `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`. NO inline `--` comments inside any `sql` template (parameter-binding hazard). Apply to the migrate-capable dev DB via `bun db migrate`.
  - FORBIDDEN: any change under `backend/db/schema/**`; `bun run db push` is NOT the trigger channel.
  - _Requirements: REQ-020, REQ-042_
  - [x] 1.2.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts <migration-file> --lifecycle duplicates` (exit 0).
  - [x] 1.2.TE **Test Engineering:** the behavioral pin is Task 2.5's trigger-tier test (`pg_trigger` probe; update/delete attempted via `expectRepoError` try/catch); the migration-DDL idempotence pin (file contains `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`) lives in Task 2.5(c).
  - [x] 1.2.SEC **Security & Tenancy Audit:** trigger covers UPDATE and DELETE on `audit_logs` only; function raises unconditionally; no other table touched.
  - [x] 1.2.SR **Semantic Review:** idempotent (re-runnable), matches `docs/DATABASE_MIGRATIONS.md` conventions; zero Drizzle schema drift.
  - [x] 1.2.IV **Instruction Verification:** validate against `.agents/instructions/backend.instructions.md`, `backend/db/AGENTS.md` (if present per sub-loop discovery), `docs/DATABASE_MIGRATIONS.md`.
  - Write `outcome/1.2-outcome.md` (MUST record the branch taken and the environment applied to).

---

## Phase 2: Repositories & Backend Services

- [x] **2.1 Shared admin gate + audit coercion extraction (`admin-gate.helpers.ts` — VERIFY-OR-CREATE, D2)**
  - **IF** Task 0.2 found `backend/services/admin/admin-gate.helpers.ts` existing (DEV3-022c landed first): import `assertActorAdmin` from it; ADD `toAuditActionType` extracted VERBATIM from `backend/services/admin/user-management.service.ts:130-149` (extend, never fork).
  - **ELSE:** CREATE `backend/services/admin/admin-gate.helpers.ts` carrying BOTH functions extracted VERBATIM: `assertActorAdmin(actorId, locale, outerTx?)` (from `user-management.service.ts:240-271`) and `toAuditActionType(raw)` (from :130-149).
  - UPDATE `backend/services/admin/user-management.service.ts`: DELETE the private copies; import from the shared module. ZERO behavior/API drift — the existing DEV3-016 suites are the byte-equivalence regression lock.
  - UPDATE `backend/services/admin/index.ts`: export the helpers module.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/services/AGENTS.md`.
  - _Requirements: REQ-004, REQ-030, REQ-076_
  - [x] 2.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/admin/admin-gate.helpers.ts --lifecycle duplicates` (exit 0) — MUST NOT report a clone of the two functions anywhere else after the edit; run on `user-management.service.ts` too.
  - [x] 2.1.TE **Test Engineering:** `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` + `user-management.chaos.test.ts` — byte-green, unchanged.
  - [x] 2.1.SEC **Security & Tenancy Audit:** gate semantics unchanged (actorId=0 → `UnauthorizedError`; non-admin → `ForbiddenError`; exactly one bounded `logDomainError` per denial; zero writes).
  - [x] 2.1.SR **Semantic Review:** verbatim extraction (diff the function bodies); no new dependencies; no dead exports.
  - [x] 2.1.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files.
  - Write `outcome/2.1-outcome.md`.

- [x] **2.2 [Write global audit-trail journey test — TEST-FIRST]**
  - Create `test/workflows/admin/audit-trail.journey.test.ts` (create `test/workflows/admin/` if absent) — authored BEFORE the service surface of Task 2.4 exists; it MUST fail at this point (red state captured in the outcome) and be re-run green in Phase 5.
  - Provision the actor cast via `provisionAdminActor` (×2: producer Admin A, observer Admin B) / `provisionStudentActor` / `provisionParentActor` from `@/test/workflows/helpers` — REAL permission/role rows; NEVER monkey-patch permission resolution.
  - Steps as sequential REAL service calls with REAL `actorUserId`s per specs §2.9 ordered step list:
    1. System: committed cast + `audit_logs`/`notifications` row-count oracles.
    2. Admin A → `AdminUserManagementService.createUser` (student target) → Admin B → `AuditTrailService.listAuditTrail({entityType:"user", entityId:targetId}, …)` → exactly ONE row, `actionType=create`, `actorId=AdminA.id`, `actorName`=A's name, `details` parses to names-only (`{role:…}`, NO PII pairs).
    3. Admin A → `updateUser` → `setUserDeleted(true)` → `setUserDeleted(false)` → Admin B sees FOUR rows newest-first in exact order `reactivate, delete, update, create`.
    4. System → fixture-direct committed rows for `override`/`adjust`/`suspend` (documented fixture lane — producers are future tickets) → Admin B filters by EACH of the seven `AuditActionType` values → exactly the matching subset (J-AUD-02).
    5. Admin B paginates a 5-row filtered set with `pageSize=2` → gapless/non-overlapping windows + honest `totalCount`; `from`/`to` window: boundary rows included/excluded exactly per REQ-014 (`>= from`, `< to`).
    6. Denials: student/parent → `ForbiddenError` BEFORE any read; anonymous (`actorId=0`) → `UnauthorizedError`; `audit_logs` + `notifications` oracles byte-unchanged (zero audit pollution).
    7. Governance probe: the already-soft-deleted target's full four-row history STILL renders (J-AUD-05 / REQ-022).
    8. Teardown: tracked hard-delete — audit rows FIRST under `withAuditDeleteTriggersSuspended` (`test/helpers/db-cleanup.ts:83-109`), role children, then users — post-teardown re-probes assert ZERO residue.
  - Committed fixtures in ONE `db.transaction` in `beforeAll` + tracked ids; **NEVER `runInRollback`**; unique `jrn_aud_<uuid8>` prefixes; per `test/workflows/AGENTS.md` + `docs/testing/workflow-journey-tests.md`. No external channels exist on this surface — oracles (not spies) prove zero notifications.
  - `test/workflows/` scaffolding is VERIFIED PRESENT (`admin/` with 2 journey tests, `helpers/` — actor-context.ts with `provisionAdminActor` (L136)/`provisionStudentActor` (L88)/`provisionParentActor` (L122), `tracked-fixtures.ts` `TrackedFixtures`, `spied-transport.ts`, `index.ts` barrel — plus `notifications/`, `parents/`, and `test/workflows/AGENTS.md`); nothing to scaffold — this task adds ONLY the journey file.
  - Verify (at authoring time, expected RED): `bun run test/scripts/run-test.ts test/workflows/admin/audit-trail.journey.test.ts`.
  - _Requirements: REQ-075; J-AUD-01..05_
  - Write `outcome/2.2-outcome.md` (records the red-state signature for later differential comparison).

- [x] **2.3 Implement `AuditTrailRepository` (`backend/db/repo/audit/`)**
  - CREATE `backend/db/repo/audit/audit-trail.repository.ts`: `AuditTrailRepository.listEntries(filters, limit, offset, tx?)` and `countEntries(filters, tx?)`; module-local exported row types `NormalizedAuditTrailFilters` + `AuditTrailEntryRow` (raw `actionType: string` — coercion is service-owned, D6) per plan §2.3.
  - Implementation contract: executor `(tx ?? db)` (precedent `admin-user.repository.ts:515`); ONE shared `buildWhere` with conjunctive parameterized `eq`/`gte`/`lt` conditions that drop out when absent; inner join `users` on `actor_id` projecting `actorName: users.fullName` (pattern from `getActivity`, `admin-user.repository.ts:515-526`); order `desc(createdAt), desc(id)`; `.limit().offset()`; `tx?: DBTransaction` LAST on every method.
  - FORBIDDEN on this file: LIKE/ILIKE (`escapeLikeWildcards` obligation never arises — D5), prepared statements (dynamic filter chain — `docs/drizzle/prepared-statements.md`), inline `--` in `sql` templates, governance filtering of any kind (REQ-022), any write call.
  - CREATE `backend/db/repo/audit/index.ts` (`export * from "./audit-trail.repository";`); UPDATE top-level `backend/db/repo/index.ts` adding `export * from "./audit";`.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/db/repo/AGENTS.md`, `backend/db/AGENTS.md` (as discovered).
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-013, REQ-017, REQ-022, REQ-034, REQ-041, REQ-070_
  - [x] 2.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/repo/audit/audit-trail.repository.ts --lifecycle duplicates` (exit 0).
  - [x] 2.3.TE **Test Engineering (REQ-070):** CREATE `backend/db/test/logic/audit/audit-trail.repository.test.ts` under `runInRollback` with `tx` propagated to EVERY call and `expectRepoError` try/catch (NEVER `rejects.toThrow`): each filter dimension alone + combined; ordering + `id` tiebreak; page-window continuity with no overlap; out-of-range page → empty items, honest count; empty-set honesty; join projection integrity (`actorName` present); null `entityId`/`details` pass-through; zero-write oracle (row counts unchanged). Run: `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-trail.repository.test.ts`.
  - [x] 2.3.SEC **Security & Tenancy Audit:** all values Drizzle-parameterized; zero LIKE surface; filters are data, never authorization inputs (REQ-031); no governance filters.
  - [x] 2.3.SR **Semantic Review:** no dead code; repo-local row types documented as the DEV3-016 precedent; no cross-layer imports.
  - [x] 2.3.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files incl. `backend/db/repo/AGENTS.md`.
  - Write `outcome/2.3-outcome.md`.

- [x] **2.4 Implement `AuditTrailService.listAuditTrail`**
  - CREATE `backend/services/admin/audit-trail.service.ts` per plan §4.2; export via `backend/services/admin/index.ts`.
  - Pipeline (load-bearing order, REQ-053): ① `assertActorAdmin(actorId, locale, outerTx)` (Task 2.1 shared module); ② pre-DB filter structural validation — positive-safe-integer guard on `actorId`/`entityId` (REQ-015); `entityType` trim / drop-if-empty / >100 → `ValidationError`; `actionType` membership re-assertion vs `Object.values(AuditActionType)` fail-closed (REQ-016); `from`/`to` valid Dates, `from < to` strictly (REQ-014); ③ pagination pre-DB: `page ?? 1` positive int, `pageSize ?? 25` int in `1..100` (REQ-013); ④ ONE REPEATABLE READ transaction (D3 — txConfig shape verified in Task 0.2, else first-statement `SET TRANSACTION ISOLATION LEVEL` fallback) containing `countEntries` + `listEntries` with the SAME `tx`; ⑤ map rows via `toAuditActionType`; `null` → plain `new Error(...)` masked-internal (D6, precedent `user-management.service.ts:787-792`).
  - Contracts: honest empty `{items: [], totalCount: 0, page, pageSize}` (REQ-017); `details` verbatim pass-through (D8); happy path logs NOTHING; each denial exactly ONE bounded `logDomainError` `{ code, entity: "audit_logs", entityId?, locale }` (REQ-035); closed error set only (REQ-050); `outerTx?: DBTransaction` trailing; canonical types only.
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/services/AGENTS.md`.
  - _Requirements: REQ-010..018, REQ-021, REQ-030, REQ-031, REQ-033, REQ-035, REQ-040, REQ-041, REQ-043, REQ-044, REQ-050..053_
  - [x] 2.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/services/admin/audit-trail.service.ts --lifecycle duplicates` (exit 0).
  - [x] 2.4.TE **Test Engineering (REQ-071):** CREATE `backend/services/admin/audit-trail.service.test.ts` targeting 100% statement/branch on new code: gate denials (`actorId=0` → `UnauthorizedError`; resolvable non-admin → `ForbiddenError`; ZERO reads beyond gate, ZERO writes, ONE bounded log per denial — JR-C-1 extension oracles for REQ-018/052); full validation boundary matrix (pageSize 1/100/101; page 0/negative/fractional; fractional/negative/oversized ids; entityType 100/101 chars; from ≥ to; invalid Date; corrupt actionType input) — every pre-DB tier proves zero row contact (REQ-053); happy-path mapping + determinism (equal inputs → equal output on a stable set); REQ-017 oracles; REQ-040 single-transaction snapshot assertion (tx propagation spy); D6 corrupt-stored-enum masked-internal branch. Run: `bun run test/scripts/run-test.ts backend/services/admin/audit-trail.service.test.ts`.
  - [x] 2.4.SEC **Security & Tenancy Audit:** BFLA service self-check before any read; BOPLA closed-input assumption documented (resolver whitelists — Task 3.1); no filter payload / `details` content / actor PII in logs; no new domain codes; no LIKE surface.
  - [x] 2.4.SR **Semantic Review:** atomicity of the read snapshot; env-config untouched; zero dead code; no service-layer `.types.ts`; enums as value imports; validation precedence matches REQ-053 exactly.
  - [x] 2.4.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files.
  - Write `outcome/2.4-outcome.md`.

- [x] **2.5 Immutability proof triple (static scan + trigger tier + DDL idempotence)**
  - CREATE `backend/db/test/logic/audit/audit-immutability.test.ts` per `backend/db/test/AGENTS.md` conventions:
    - (a) **REQ-019 static scan:** zero production callsites of `update(auditLogs)`/`delete(auditLogs)` across `backend/**` (path-allowlist `test/**` teardown infrastructure incl. `test/helpers/db-cleanup.ts`); `AuditService` module surface exposes NO mutation method beyond `createAuditLog`.
    - (b) **REQ-020 trigger tier (environment-branched):** probe `pg_trigger` (shape per `test/helpers/db-cleanup.ts:84-86`), gated by `isPgliteProvider()` (`test/helpers/skip-when-pglite.ts`): WITH triggers present → direct `tx.update(auditLogs)` and `tx.delete(auditLogs)` MUST throw inside `runInRollback`, asserted via `expectRepoError` try/catch (NEVER `rejects.toThrow`); WITHOUT triggers (push-provisioned) → assert the REQ-019 structural tier and RECORD the push-vs-migrate gap in the outcome.
    - (c) **Migration-DDL pin:** IF the Task-1.2 SQL file exists, assert idempotent DDL content (`CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`); IF consumed-by-reference, pin the found file's idempotence instead.
  - Applicable instructions: `.agents/instructions/backend.instructions.md` (and `.agents/instructions/tests.instructions.md` per discovery), `backend/db/test/AGENTS.md`.
  - _Requirements: REQ-019, REQ-020, REQ-042, REQ-072_
  - [x] 2.5.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/db/test/logic/audit/audit-immutability.test.ts --lifecycle duplicates` (exit 0).
  - [x] 2.5.TE **Test Engineering:** run `bun run test/scripts/run-test.ts backend/db/test/logic/audit/audit-immutability.test.ts`; the test IS the tier — ensure the environment branch actually observed is recorded (trigger-present vs absent).
  - [x] 2.5.SEC **Security & Tenancy Audit:** scan covers ALL production roots (no blind spots like a missed service directory); allowlist is path-exact, not glob-loose; the test itself never leaves writes committed.
  - [x] 2.5.SR **Semantic Review:** honest branching (no force-skipping the trigger tier); assertions use `expectRepoError` convention; zero `console.*`.
  - [x] 2.5.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files.
  - Write `outcome/2.5-outcome.md` (MUST name which trigger-tier branch executed).

### Phase 2.M: Mid-Point Review Gate

- [x] **2.M Mid-point review gate**
  - Consolidate: journey test authored (red) ✔; repo+service implemented with green unit tiers ✔; gate extraction byte-equivalence ✔; immutability triple recorded ✔.
  - Re-run: `bun tsgo`, `bun run oxlint`, `bun biome:check` — deltas vs Phase-0 baseline recorded; targeted suites: `bun run test/scripts/run-test.ts backend/services/admin` and `bun run test/scripts/run-test.ts backend/db/test/logic/audit`.
  - Verify ledger `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` has no unplanned ❌/⚠️ entries; if any, resolve or explicitly defer with owner before proceeding past this gate.
  - Write `outcome/2M-midpoint-review-outcome.md`.
  - _Requirements: REQ-076, REQ-082_

---

## Phase 3: GraphQL Resolvers & API Handlers

- [x] **3.1 Pothos objects/input + `adminAuditLogs` query registration**
  - CREATE `backend/graphql/pothos/admin/audit-trail.pothos.ts` per plan §3.2: `AdminAuditLogEntry` (via `objectRef<AdminAuditLogEntryReturnType>` — `t.exposeID("id")` FIRST, `actionType` via the REUSED `AuditActionTypePothosEnum` (NEVER re-register), `actorId`/`actorName`/`entityType`, nullable `entityId`/`details`, `createdAt` via `t.expose("createdAt", { type: "DateTime" })` — D4, NEVER `String` + `toISOString()`); `AdminAuditLogPage` embedded wrapper (NO `id`); `AdminAuditLogFiltersInput` closed six-member input, `from`/`to` as `DateTime` fields. NO local types — canonical imports from `@/backend/types`.
  - CREATE `backend/graphql/query/admin/audit-trail.query.ts`: ONE `queryField("adminAuditLogs", …)` with `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (precedent `admin-users.query.ts:74-79`); thin resolver: `ctx.user` belt + `UnauthorizedError((await ctx.t("errorsTranslations")).unauthorized)` (pattern `backend/graphql/mutation/notifications/notification.mutation.ts:114-117`), then EXPLICIT field-by-field copies into `AdminAuditTrailFiltersSubmitInput` (NO `{ ...input }` spread — BOPLA, REQ-032), passing `args.page ?? null`, `args.pageSize ?? null`, `ctx.locale`, `ctx.user.id`. NO try/catch, NO business logic.
  - UPDATE barrels: `backend/graphql/pothos/admin/index.ts` (+ one export line) and `backend/graphql/query/admin/index.ts` (+ one import line).
  - DO NOT touch `backend/lib/gateway/public-operations.ts` — the frozen six stay frozen (load-bearing REQ-060 / Invariant-rule 3).
  - Applicable instructions: `.agents/instructions/backend.instructions.md`, `backend/graphql/AGENTS.md`, `backend/graphql/pothos/AGENTS.md` (as discovered).
  - _Requirements: REQ-030, REQ-032, REQ-050, REQ-051, REQ-060, REQ-061_
  - [x] 3.1.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts` on both new files (exit 0).
  - [x] 3.1.TE **Test Engineering:** deferred to Task 3.3 wire matrix (the resolver is behaviorally covered there; builder-level smoke via `bun run generate:gqlSchema` in Task 3.2 catching duplicate-enum/duplicate-type registration errors).
  - [x] 3.1.SEC **Security & Tenancy Audit:** `$all` conjunction load-bearing (anonymous → `UNAUTHORIZED`, non-admin → `FORBIDDEN` pre-resolver); closed input shape dies smuggled fields at schema validation; scalar discipline (`DateTime`, no hand-serialization).
  - [x] 3.1.SR **Semantic Review:** thin-resolver rule honored; no local type declarations in Pothos files; enum REUSE not re-registration; no dead code.
  - [x] 3.1.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files + `docs/graphql/api-gateway-and-routing.md` §8 registration recipe.
  - Write `outcome/3.1-outcome.md`.

- [x] **3.2 Codegen + schema-surface baseline re-pin (SAME change set — atomic)**
  - Run `bun run generate:gqlSchema && bun codegen`; commit regenerated artifacts (SDL + generated types) IN THE SAME change set as Task 3.1.
  - UPDATE `backend/graphql/test/schema-surface.test.ts`: additions assertion gains `"adminAuditLogs"` (sorted computed literal — VERIFY against the live regenerated schema; absorb any concurrently-landed sibling Sprint-3 fields additively, NEVER drop entries); whole-schema type-name additions gain `AdminAuditLogEntry`, `AdminAuditLogFiltersInput`, `AdminAuditLogPage`.
  - UPDATE `backend/graphql/test/sdl-static-assertions.test.ts`: `FROZEN_QUERY_FIELDS` gains `"adminAuditLogs"` in sorted position (verify live contents first; reconcile the documented possibility that the frozen list predates DEV3-016's surface — re-pin against the regenerated SDL and RECORD the reconciliation).
  - KEEP GREEN UNCHANGED: `backend/graphql/test/plan-catalog.schema.test.ts` committed-SDL byte-parity; `backend/graphql/test/handshake-code-surface.test.ts` frozen-six public-allowlist pin — NO edits to those files.
  - Run: `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` (+ the other three surface files).
  - _Requirements: REQ-060, REQ-061, REQ-062_
  - [x] 3.2.QL **Quality Loop:** sub-loop on both edited test files (exit 0).
  - [x] 3.2.SR **Semantic Review:** additive-only baselines; no snapshot hand-editing outside the regenerated SDL; surface tests assert computed sorted literals, not duplicated stale lists.
  - [x] 3.2.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files.
  - Write `outcome/3.2-outcome.md` (MUST record the final frozen-list literals and any sibling-surface absorption).

- [x] **3.3 GraphQL wire matrix (anonymous / roles / BOPLA probes / hostile inputs)**
  - CREATE `backend/graphql/test/audit-trail.query.test.ts` per the `notification-integration.matrix.test.ts` precedent (`setupTestServerLifecycle` + `testClient` + raw-HTTP probes):
    - anonymous → `UNAUTHORIZED` (pre-resolver);
    - student / teacher / parent → `FORBIDDEN` (pre-resolver);
    - admin happy path → payload satisfies REQ-010 projection + REQ-013 pagination echo;
    - smuggled identity args (`userId` at root; `userId` inside `filters`) → `GRAPHQL_VALIDATION_FAILED` PRE-resolver (BOPLA wire proof, REQ-032);
    - invalid enum literal for `actionType` → `GRAPHQL_VALIDATION_FAILED` (REQ-016 wire tier);
    - hostile `pageSize` (0 / 101) → `VALIDATION` with `audit_logs` row-count oracle unchanged;
    - corrupt-stored-enum and unexpected-internal paths → masked `INTERNAL_SERVER_ERROR` per `graphqlErrorsFinalizer` contract (chaos probe via service-layer fault injection where feasible).
  - Applicable instructions: `.agents/instructions/backend.instructions.md` (+ tests instructions per discovery), `backend/graphql/AGENTS.md`.
  - _Requirements: REQ-030, REQ-032, REQ-050, REQ-073_
  - [x] 3.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts backend/graphql/test/audit-trail.query.test.ts --lifecycle duplicates` (exit 0).
  - [x] 3.3.TE **Test Engineering:** run `bun run test/scripts/run-test.ts backend/graphql/test/audit-trail.query.test.ts` — 4-tier mapping: Tier 1 (happy + denial matrix), Tier 2 (boundary pageSize/page), Tier 3 (masked-internal chaos), Tier 4 (smuggle + bad-enum security probes).
  - [x] 3.3.SEC **Security & Tenancy Audit:** the matrix IS the BFLA/BOPLA wire proof; assert deny happens pre-resolver (no service hit) via row-count oracle or resolver spy.
  - [x] 3.3.SR **Semantic Review:** closed code set assertions only (`UNAUTHORIZED`/`FORBIDDEN`/`GRAPHQL_VALIDATION_FAILED`/`VALIDATION`/masked `INTERNAL_SERVER_ERROR`); no code minted ad hoc.
  - [x] 3.3.IV **Instruction Verification:** validate against auto-discovered AGENTS/instruction files.
  - Write `outcome/3.3-outcome.md`.

---

## Phase 4: Frontend GraphQL Documents, i18n, Cache & UI Views

- [x] **4.1 Extend `adminUsers` namespace with the `auditTrail` block (NO new namespace — D13)**
  - UPDATE `shared/locale/types/adminUsers/index.ts`: `AdminUsersLabels` gains the `auditTrail` block exactly per plan §5.6 (page title/subtitle, filter labels + apply/clear, table headers, details show/hide + null placeholders, empty state, error state).
  - UPDATE `shared/locale/en/adminUsers/index.ts` and `shared/locale/ar/adminUsers/index.ts`: both leaf implementations; EVERY `ar` string in Arabic script.
  - REUSE the seven `adminUsers.activity.action*` labels (`shared/locale/types/adminUsers/index.ts:417-451`) for action rendering — mint NO near-duplicates (`shared/AGENTS.md` discipline).
  - **VERIFY-OR-CREATE** `shared/locale/adminUsers-namespace.parity.test.ts` per the Task-0.2 finding (VERIFIED ABSENT — parity suite inventory is exactly applicant/errors/handshakeCode/notifications/plans): modeled on `shared/locale/handshakeCode-namespace.parity.test.ts` (VERIFIED PRESENT) — key-set equality across locales, non-empty values, Arabic-script presence, registry/bundle wiring (`AdminUsers` handle + `adminUsersTranslations` on both bundles), and the NEW `auditTrail` block pinned under BOTH locales. Extend existing parity/growing-shape suites if present instead.
  - NO change to `namespaces/index.ts` (no new namespace registration).
  - Applicable instructions: `shared/AGENTS.md` (registration checklist); auto-discovered instruction files.
  - _Requirements: REQ-002, REQ-067_
  - [x] 4.1.QL **Quality Loop:** sub-loop on each touched locale/type/test file (exit 0).
  - [x] 4.1.TE **Test Engineering:** `bun run test/scripts/run-test.ts shared/locale` (parity suites green, new block pinned both locales).
  - [x] 4.1.SR **Semantic Review:** zero hardcoded strings destined for UI outside locale leaves; no near-duplicate action labels; flat `ErrorsLabels` discipline untouched (no error keys minted — REQ-051).
  - [x] 4.1.IV **Instruction Verification:** validate against `shared/AGENTS.md` + auto-discovered files.
  - Write `outcome/4.1-outcome.md`.

- [x] **4.2 Frontend GraphQL documents + Apollo cache policy + contract tests**
  - CREATE `frontend/graphql/sharedDocuments/admin/audit-trail.documents.ts`: `adminAuditLogsQueryDocument` — named operation `AdminAuditLogs($filters: AdminAuditLogFiltersInput, $page: Int, $pageSize: Int)`, `id` FIRST in the entry selection, `TypedDocumentNode<AdminAuditLogsQuery, AdminAuditLogsQueryVariables>`-typed; `useQuery` only (NO `useLazyQuery`).
  - UPDATE `frontend/graphql/sharedDocuments/admin/index.ts` (+ one export; the top barrel `frontend/graphql/sharedDocuments/index.ts:1` already re-exports `./admin`).
  - UPDATE `frontend/providers/apollo/apolloCache.ts`: `typePolicies` gains `AdminAuditLogPage: { keyFields: false }` (embedded wrapper; `AdminAuditLogEntry` normalizes by `id` — no registration).
  - UPDATE `frontend/providers/apollo/apolloCache.test.ts:176-185`: extend the frozen policy-inventory assertion in the SAME change set to the LIVE current set + `AdminAuditLogPage` (reconcile the known `NotificationListPage` drift — additive only).
  - CREATE `frontend/graphql/sharedDocuments/admin/audit-trail.documents.test.ts`: pins operation name, variable set exactly `["filters","page","pageSize"]`, id-first selection (conventions per `documents.contract.test.ts`).
  - UPDATE `frontend/graphql/AGENTS.md`: embedded-type list gains the `AdminAuditLogPage` row.
  - Applicable instructions: `frontend/graphql/AGENTS.md`, `.agents/instructions/frontend.instructions.md`.
  - _Requirements: REQ-063, REQ-074_
  - [x] 4.2.QL **Quality Loop:** sub-loop on each new/edited file (exit 0).
  - [x] 4.2.TE **Test Engineering:** `bun run test/scripts/run-test.ts frontend/graphql/sharedDocuments/admin/audit-trail.documents.test.ts`; `bun run test/scripts/run-test.ts frontend/providers/apollo/apolloCache.test.ts`.
  - [x] 4.2.SR **Semantic Review:** no bespoke error mapping (existing `mapGraphQLErrorByCode` seams only — REQ-054); generated types imported, never hand-written.
  - [x] 4.2.IV **Instruction Verification:** validate against `frontend/graphql/AGENTS.md` + auto-discovered files.
  - Write `outcome/4.2-outcome.md`.

- [x] **4.3 Server-guarded route `app/(dashboard)/audit/page.tsx` (CREATE)**
  - CREATE `app/(dashboard)/audit/page.tsx` as a Server Component: `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/audit" })`; locale-aware `generateMetadata` via `getTranslations(locale).adminUsersTranslations.auditTrail…`; render `<AuditTrailView initialFilters={sanitized} />`.
  - Deep-link sanitize step (REQ-068): parse `?entityType=<v>&entityId=<n>` (+ optional `actionType`, `actorId`, `from`, `to`); INVALID values silently DROPPED (never trusted, never error); component state owns subsequent edits.
  - Anonymous → `/login?redirect=/audit`; role mismatch → `roleDashboardPath(ctx.role)` (bare `/dashboard` FORBIDDEN). Zone locale via `getLocaleFromCookie()` (`shared/locale/server-cookies.ts:6-13`). Enum as VALUE import (`UserRole.Admin`).
  - Applicable instructions: `app/AGENTS.md`, `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md`.
  - _Requirements: REQ-002, REQ-064, REQ-068_
  - [x] 4.3.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts app/(dashboard)/audit/page.tsx --lifecycle duplicates` (exit 0).
  - [x] 4.3.TE **Test Engineering:** covered by the 4.4 component suite (initialFilters wiring) + 4.5 nav/browser assertions (route reachability); add a server-component render smoke where the project's test harness supports it.
  - [x] 4.3.SR **Semantic Review:** server-only imports allowed here; zero `"use client"`; one-argument `getTranslations(locale)` with property access.
  - [x] 4.3.IV **Instruction Verification:** validate against `app/AGENTS.md` + auto-discovered files.
  - Write `outcome/4.3-outcome.md`.

- [x] **4.4 Implement `frontend/views/admin/audit/AuditTrailView.tsx` (CREATE — client container + full UI)**
  - CREATE `frontend/views/admin/audit/AuditTrailView.tsx` per plan §5.4/§5.5: header; filter bar (actorId/entityId number `TextField`s, `actionType` `Select` fed by codegen enum values × localized `adminUsers.activity.action*` labels, `entityType` free text, native `TextField type="date"` from/to pair — D11 UTC-day boundary construction; Apply + Clear ≥44px touch targets); paginated table from RAW MUI `Table` primitives (D10 — `AppDataGrid` is a prose-only phantom, FORBIDDEN); per-row expandable `details` block rendered VERBATIM (`dir="auto"`); null `entityId`/`details` → namespace em-dash placeholders; skeletons with `aria-busy`; honest empty state; generic error + `common.retry`; `PermissionDeniedFallback` on FORBIDDEN; `RetryableNotice` on `RATE_LIMITED`/`SERVICE_UNAVAILABLE`; `createdAt` via `formatApplicantDate` (`frontend/lib/i18n/format-date.ts:56-59` — reuse, REQ-069); pagination echoing server `page`/`pageSize`/`totalCount`.
  - Discipline: ALL styling via `sx` with `theme.palette.*` tokens ONLY; RTL-safe logical properties (`marginInlineStart/End`, `textAlign: "start"`); `*Outlined` icons; form submit via `React.SubmitEvent`; `useAppTranslation(AdminUsers)` handle-const (NO string, NO `Translation` enum); `logger` from `@/frontend/lib/logger`; NO `console.*`; hooks from `@apollo/client/react`; `useQuery` only.
  - Applicable instructions: `frontend/AGENTS.md`, `.agents/instructions/frontend.instructions.md`. (NOTE: `frontend/views/AGENTS.md` and `frontend/components/ui/AGENTS.md` do NOT exist — do not cite them.)
  - _Requirements: REQ-002, REQ-054, REQ-063, REQ-066, REQ-068, REQ-069_
  - [x] 4.4.QL **Quality Loop:** `bun run scripts/health/sub-loop.ts frontend/views/admin/audit/AuditTrailView.tsx --lifecycle duplicates` (exit 0).
  - [x] 4.4.TE **Unit / Component Tests (REQ-074):** CREATE `test/ui/components/admin/AuditTrailView.test.tsx` — Happy DOM + Apollo `MockedProvider` + translation-handle preloads (NEVER hardcoded copy): skeleton → loaded table; empty state; FORBIDDEN fallback; retryable notice; filter submit wiring (`React.SubmitEvent` path); `null` `details`/`entityId` rendering; details expand/collapse; deep-link `initialFilters` application incl. invalid-value dropping; RTL (ar) render. Run: `bun run test/scripts/run-test.ts test/ui/components/admin/AuditTrailView.test.tsx`.
  - [-] 4.4.BF **Agent-Browser Functional Self-Loop:**
    - Login via the sanctioned flow (`test/ui/AGENTS.md` §Agent Browser Login — `bun run scripts/browser-login.ts --inject`), navigate `/audit` as the seeded admin.
    - Execute end-to-end: (1) trail table renders seeded rows; (2) filter `entityType=user` + `entityId` narrows the set (assert the GraphQL request variables); (3) actionType select filters on all seven values; (4) date pair narrows by day boundary; (5) pagination advances without overlap (`totalCount` honest); (6) `details` expansion shows raw JSON; (7) Clear restores unfiltered listing; (8) anonymous session → `/login?redirect=/audit`; student session → role-dashboard redirect.
    - Iterative self-loop: any interaction/validation failure → patch code → re-run until clean.
  - [-] 4.4.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis):**
    - Capture screenshots at 1440×900 / 768×1024 / 375×812 × {`en` LTR, `ar` RTL} via the isolated visual-inspection subagent rule (DOM-first assertions, translations via handles only).
    - Inspect for: MUI v9 palette-token compliance (no hardcoded hex/rgb), typography hierarchy, spacing rhythm, table horizontal-scroll track at 768/375, text truncation/overflow in `details` cells, RTL mirroring (logical properties, Select alignment, date-field layout), dark/light contrast, ≥44px targets.
    - Iterative self-loop: identify defect → patch `sx` tokens → re-capture → repeat until visually polished; attach final screenshot set references in the outcome.
  - [x] 4.4.SR **Semantic Review:** zero direct style props (sx only); no hardcoded strings/colors; `useAppTranslation` property access; `*Outlined` icons; no `next-intl`; no `console.*`.
  - [x] 4.4.IV **Instruction Verification:** validate against `.agents/instructions/frontend.instructions.md` + `frontend/AGENTS.md` (the ONLY frontend instruction file is `.agents/instructions/frontend.instructions.md`).
  - Write `outcome/4.4-outcome.md`.

- [x] **4.5 Navigation retarget pinning (ZERO nav-model change — D12)**
  - `frontend/views/dashboard/navItems.ts` MUST NOT change — the existing admin item `{ route: "/audit", labelKey: "audit" }` (:133) is retargeted purely by Task 4.3/4.4 shipping the page.
  - UPDATE `frontend/views/dashboard/navItems.test.ts`: pin (a) admin nav CONTAINS `/audit` with `labelKey: "audit"`; (b) student/teacher/parent navs EXCLUDE `/audit`; keep the ownership-matrix test (:46-59) green (`audit` stays owned by `DashboardLabels`).
  - Run: `bun run test/scripts/run-test.ts frontend/views/dashboard/navItems.test.ts`.
  - _Requirements: REQ-065_
  - [x] 4.5.QL **Quality Loop:** sub-loop on `navItems.test.ts` (exit 0).
  - [x] 4.5.SR **Semantic Review:** no duplicate nav item; no label move; no bottom-nav assumptions (mobile = Drawer).
  - [x] 4.5.IV **Instruction Verification:** validate against auto-discovered files.
  - Write `outcome/4.5-outcome.md`.

---

## Phase 5: Integration & Differential Testing

- [x] **5.1 Journey green + full differential suite run**
  - Re-run the Task-2.2 journey — MUST now be GREEN: `bun run test/scripts/run-test.ts test/workflows/admin/audit-trail.journey.test.ts` (differential vs the recorded 2.2 red state).
  - Run the complete affected matrix: `backend/db/test/logic/audit/*` (repo + immutability), `backend/services/admin/*` (new service + DEV3-016 regression): `bun run test/scripts/run-test.ts backend/db/test/logic/audit` / `backend/services/admin`; `bun run test/scripts/run-test.ts backend/graphql/test` (surface + wire matrix + SDL parity + handshake allowlist); locale parity; frontend documents/cache/nav; `bun run test/scripts/run-test.ts test/ui/components/admin`.
  - REQ-043 chaos: confirm the forced mid-read failure case surfaces masked `INTERNAL_SERVER_ERROR` with exactly one correlated log (service chaos tier) — cross-check REQ-071 chaos coverage recorded in 2.4.
  - Coverage gate: 100% statement/branch on ALL new service/repository code (REQ-076).
  - _Requirements: REQ-070..077_ (outcome: `outcome/5.1-outcome.md`)

- [x] **5.2 Zero-drift & frozen-surface gates**
  - `git diff backend/db/schema/**` MUST be EMPTY (REQ-042); the only permitted migration-tree delta is the conditional Task-1.2 SQL file.
  - `backend/lib/gateway/public-operations.ts` diff MUST be EMPTY; `handshake-code-surface.test.ts` allowlist pin green.
  - Re-run baseline counters: `bun tsgo`, `bun run oxlint`, `bun biome:check`, `bun run lint` — each delta vs Phase-0 baseline = +0 (REQ-076).
  - Scan guard: no `console.*`, no `next-intl`, no LIKE/ILIKE, no `toISOString()` hand-serialization, no LIKE-escape helper references in any NEW file.
  - _Requirements: REQ-042, REQ-060, REQ-076, REQ-077_ (outcome: `outcome/5.2-outcome.md`)

---

## Phase 6: Post-Implementation Review Waves (parallel)

- [x] **6.1 review-types wave**
  - Verify: canonical types only in `backend/types/audit/audit-trail.types.ts`; repo-local row types are the documented DEV3-016-style exception; NO service-layer `.types.ts`; NO local types in Pothos files; barrel edits minimal; codegen types consumed, never handwritten.
  - _Requirements: REQ-003, REQ-061_ → `outcome/6.1-review-types-outcome.md`

- [x] **6.2 review-backend wave**
  - Verify: pipeline order REQ-053; D3 single-snapshot read; gate extraction byte-equivalence (DEV3-016 suites green); immutability triple (REQ-019/020) including which trigger branch executed; closed error set; D6 masked-internal branch; logging hygiene (REQ-035); `tx` propagation and `(tx ?? db)` discipline everywhere.
  - _Requirements: REQ-004, REQ-013..022, REQ-030..053, REQ-070..073_ → `outcome/6.2-review-backend-outcome.md`

- [x] **6.3 review-frontend wave**
  - Verify: server guard + `roleDashboardPath` redirects; documents/cache/contract pins; MUI v9 discipline (sx-only, palette tokens, RTL logical props, `*Outlined`); translation-handle usage; reuse-not-fork (`formatApplicantDate`, `activity.action*` labels, error seams); zero-change nav retarget; BF/BS screenshot evidence reviewed.
  - _Requirements: REQ-054, REQ-063..069, REQ-074_ → `outcome/6.3-review-frontend-outcome.md`

- [x] **6.4 pentester wave + deferred-items ledger check**
  - Attack review: BFLA dual-gate (wire + service), BOPLA smuggle probes, BOLA posture (filters-are-not-authorization, REQ-031), injection surface absence (no LIKE), error-disclosure masking, governance-window honesty (REQ-033 claims no more than documented), immutability attack paths (direct SQL excluded only by DB trigger — environment gap honestly recorded), log-hygiene PII scan.
  - Deferred ledger: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` MUST equal `0`; all six pre-registered ✅-reference entries intact; any task-encountered gaps either resolved or appended with owner + status.
  - _Requirements: REQ-030..037, REQ-050..052, REQ-082_ → `outcome/6.4-pentester-outcome.md`

---

## Phase 7: Knowledge Propagation & Documentation

- [x] **7.1 Canonical reference doc `docs/admin/audit-trail.md` (CREATE — REQ-080)**
  - Contents (mandatory sections): WHY (FR-10.5 / Workflow 05 §7 / PRODUCTION_READINESS §1.3.1–1.3.5 mapping); read-surface contract (fields, `createdAt DESC, id DESC` order, pagination semantics, filter semantics incl. the `>= from` / `< to` date-boundary rule and client day-boundary convention); two-tier immutability proof (application single-writer scan + DB trigger tier) INCLUDING the honest push-vs-migrate environment caveat (D-TRIGGER-PUSH-GAP / REQ-020 record of which branch was verified); governance-window acknowledgment (REQ-033); history-survives-governance rule (REQ-022/037, INV-U1/U5); details-hygiene consumption note (verbatim pass-through, writer-enforced ≤2000-char names-only contract, REQ-021/035); deep-link contract (`/audit?entityType=…&entityId=…`, REQ-068); anti-pattern list (NEVER add update/delete/edit surface to `audit_logs`; NEVER LIKE-search `details`; NEVER fork a second audit writer; NEVER filter history by governance; NEVER add a second enum registration).
  - _Requirements: REQ-080_ → include doc path confirmation in `outcome/7.1-outcome.md`
  - [x] 7.1.QL **Quality Loop:** sub-loop on the doc file (exit 0).

- [x] **7.2 Layer AGENTS propagation (REQ-081)**
  - `backend/services/AGENTS.md`: one-line rule — audit-trail read service exists; admin-gated via the shared `admin-gate.helpers.ts`; single writer remains `AuditService.createAuditLog`; see `docs/admin/audit-trail.md`.
  - `backend/db/repo/AGENTS.md`: reconcile the Layout's forward-named `audit/` listing — the repo now EXISTS; one-line read-only rule.
  - `backend/graphql/AGENTS.md`: one line ONLY if a real layer convention changed (embedded-wrapper list already updated in Task 4.2 — otherwise reference-only).
  - Root `AGENTS.md` Important References: gain the `docs/admin/audit-trail.md` line.
  - NO edits to `test/workflows/AGENTS.md` unless the journey revealed a real convention gap (record decision).
  - _Requirements: REQ-081_ → `outcome/7.2-outcome.md`

- [x] **7.3 Final gate & outcome synthesis (REQ-076, REQ-082, REQ-083)**
  - Final re-verification: tsgo/oxlint/biome/lint = baseline + 0; all suites green through sanctioned runners; `git diff backend/db/schema/**` empty; `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/deferred-items.md` = 0.
  - `outcome/plan-review-R1.md` (Phase 1.5 `@plan-review` on specs + plan + tasks) MUST exist with zero violations — verify presence before closing; if implementation ran ahead, halt and complete it now.
  - Write `ai/plans/sprint_3/dev3-020-immutable-audit-logging-for-all-admin-ac/outcome/final-synthesis-outcome.md`: REQ coverage ledger (REQ-001..REQ-083 → task → test anchor), J-AUD-01..05 evidence, trigger-tier branch honestly recorded, baseline-delta table, screenshot evidence references, remaining risk register (should be empty).
  - _Requirements: REQ-076, REQ-080..083_

---

### Traceability Snapshot (phases → requirement clusters)

| Phase | Tasks | Requirements |
|---|---|---|
| 0 | 0.1–0.2 | REQ-001, REQ-004 (sweep), REQ-020-branch, REQ-062/064/065/067/074 verification |
| 1 | 1.1–1.2 | REQ-003, REQ-010/061, REQ-020, REQ-042 |
| 2 | 2.1–2.5, 2.M | REQ-004, REQ-010..022, REQ-030..053, REQ-070..072, REQ-075 (J-AUD-01..05), REQ-076/082 |
| 3 | 3.1–3.3 | REQ-016, REQ-030/032, REQ-050/051, REQ-060..062, REQ-073 |
| 4 | 4.1–4.5 | REQ-002, REQ-054, REQ-063..069, REQ-074 |
| 5 | 5.1–5.2 | REQ-040/043, REQ-070..077 |
| 6 | 6.1–6.4 | all security & type REQ clusters; REQ-082 ledger gate |
| 7 | 7.1–7.3 | REQ-080..083 |
