# Implementation Tasks: DEV3-016 — Admin CRUD: Users, Teachers, Students, Parents

> **Plan of record:** `ai/plans/sprint_3/dev3-016-admin-user-crud/`
> **Specs:** `specs.md` REQ-001..REQ-083 · Journeys §2.9 (A, B, C; JR-A-1, JR-A-2, JR-B-1, JR-C-1)
> **Architecture:** `plan.md` §1–§6 (D1–D12 design decisions are BINDING)
> **Gate history:** Phase-1.5 `@plan-review` outcome (`outcome/plan-review-R1.md`) MUST predate the first implementation task (REQ-083).

---

## Non-Negotiable Execution Protocol (applies to EVERY task)

1. **Pre-Execution Knowledge Read**: Before touching a task, read its declared outcome file (if re-running) plus every `AGENTS.md` / instruction file listed in the task. Record what was read in the task outcome.
2. **Post-Edit Verification**: Every created/modified file MUST pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit code 0) before the task is marked complete.
3. **Test Execution**: Test files execute ONLY via `bun run test/scripts/run-test.ts <test-path>` (per-file) or the declared suite runner; capture the run log in the outcome.
4. **Semantic Review**: Before closing a task, self-review against the semantic checklist: atomicity (tx propagation, guarded writes), env-config (no hardcoded environment assumptions), zero dead code, no cross-layer imports (`shared/` purity), enums as VALUE imports (never `import type` in runtime expressions), no `console.*`, no `{ ...input }` spreads.
5. **Outcome Documentation**: Every task writes `ai/plans/sprint_3/dev3-016-admin-user-crud/outcome/<task-id>-outcome.md` (what was done, files touched, commands run + exit codes, deviations).
6. **Checkbox Tracking**: Mark `[ ]` → `[x]` ONLY after the sub-step is genuinely satisfied. Never batch-check incomplete work.
7. **Baseline Discipline**: No task ships a NEW `bun tsgo` / `bun biome:check` / lint error beyond the Phase-0 baseline (REQ-079).

---

## Phase 0: Pre-Implementation Baseline

### 0.1 Record Error Baseline & Seed Deferred-Items Ledger

- [ ] **0.1 Record baseline & initialize ledger**
  - Run and capture into `ai/plans/sprint_3/dev3-016-admin-user-crud/outcome/phase0-baseline-outcome.md`:
    - `bun tsgo` — full error count + output snapshot
    - `bun biome:check` — violation count
    - `bun run scripts/lint-service.ts --json --id baseline` — JSON artifact committed under the plan dir
    - `git diff --name-only` — pre-existing dirty-file list
  - Initialize `ai/plans/sprint_3/dev3-016-admin-user-crud/deferred-items.md` from `.agents/spec-process-guide/templates/deferred-items-template.md`, pre-seeded with the four non-blocking forward entries (REQ-001):
    - **D1** — audit-trail browsing UI → owner DEV3-020
    - **D2** — direct student onboarding (subscription + offline payment + parent association) → owner DEV3-019
    - **D3** — suspend/block governance windows → owner DEV3-017
    - **D4** — cold-start teacher certification → owner DEV3-018
  - _Requirements: REQ-001_
  - [ ] 0.1.SR **Semantic Review**: confirm ledger has exactly 4 seeded entries, all marked non-blocking with owner ticket references; baseline numbers are committed, not paraphrased.
  - [ ] 0.1.OUT **Outcome**: `outcome/phase0-baseline-outcome.md` written.

### 0.2 Prerequisite & Dependency Verification (Read-Only Sweep)

- [ ] **0.2 Verify existing infrastructure (REQ-004 dependency guard)**
  - Verify READ-ONLY (open file, confirm export, record evidence line) each of:
    - `users` table governance columns per A.7 (`isDeleted`, `deletedAt`, `suspended`, `suspendedAt`, `suspendedPeriodDays`, `isBlocked`, `blockedAt`, `lastActiveAt`) in `backend/db/schema/users/users.ts`
    - `user_role` enum with `["admin","teacher","student","parent"]` in `backend/db/schema/enums.ts`
    - `RegistrationService` + `createAdminUser` (service-only path) from DEV1-002
    - DEV2-004 applicants lifecycle: `ApplicantProfileReturnType`, `isApplicantStatus`, `ApplicantRepository`, `myApplicantProfile` surface
    - `UserRepository.create`, `StudentRepository.createForRegistration`, `ParentRepository.createForRegistration` with `tx?: DBTransaction` optional-last convention
    - `audit_logs` table + `AuditService.createAuditLog` (VERIFY EXACT METHOD NAME — 'get naming' rule) + `AuditLogWriteContract` + `ActorContextRef` from `@/backend/types/contracts`
    - DEV2-002 `role` authScope behavior + `$all` conjunction semantics (cross-check `docs/teachers/applicant-lifecycle.md` §3 verified pattern)
    - DEV2-001 `ctx.user` verified context + `ctx.locale` propagation
    - `escapeLikeWildcards` utility location and signature
    - `withTransaction(outerTx)` helper + `DBTransaction` canonical import
    - 23505→`ConflictError` cause-chain traversal utility
    - `StudentTrialService.grantFreeTrial` (DEV1-004 trial entry point): **if ABSENT**, record a ❌ deferred-dependency entry targeting DEV1-004's contract (REQ-014 conditional path) — NEVER re-implement trial logic
    - `entity-setup.ts` test helpers (`createTestAdmin`, `createTestApplicant` signature check — if missing, plan their creation in test tasks)
    - `withPageAuth` contract from `docs/app/with-page-auth.md`; `PermissionDeniedFallback` component; sidebar admin navigation group config
  - **Rule**: any required artifact missing → ❌ entry in `deferred-items.md` + dependent tasks blocked; NEVER fork a parallel invariant.
  - _Requirements: REQ-004_
  - [ ] 0.2.SR **Semantic Review**: every verification cites file path + export name; zero code written in this task.
  - [ ] 0.2.OUT **Outcome**: `outcome/0.2-outcome.md` with the full verification table and any ❌ entries raised.

---

## Phase 1: Types, Enums & i18n Foundation

> **Schema note (REQ-022/REQ-044):** This ticket performs ZERO schema changes. Phase 1 covers canonical types, the one new filter enum, and locale keys only. `git diff backend/db/schema/**` MUST remain empty throughout.

### 1.1 Canonical Types Subtree

- [ ] **1.1 Create `backend/types/admin/` canonical types**
  - Create `backend/types/admin/admin-user.types.ts` exactly per plan.md §2.2:
    - `AdminUserSafeSelect` (`Omit<UserSelectType, "passwordHash">` — DEV2-003 forbidden-field discipline)
    - `AdminUserListItemReturnType`, `AdminUserPageReturnType`
    - `AdminTeacherSnapshotReturnType`, `AdminStudentSnapshotReturnType`, `AdminParentSnapshotReturnType`
    - `AdminUserDetailReturnType` (extends `AdminUserSafeSelect`; `applicant: ApplicantProfileReturnType | null` — DEV2-004 canonical reuse)
    - `AdminCreateUserSubmitInput` (closed whitelist incl. `role: RegisterPublicRole`)
    - `AdminUpdateUserPatchInput` (EXACTLY `{fullName?, phone?, country?, gender?, dateOfBirth?}`)
    - `AdminUserFiltersSubmitInput`, `AdminUserUpdateDbPatch`
  - Create `backend/types/admin/index.ts` (`export * from "./admin-user.types";`)
  - Add one barrel line in `backend/types/index.ts` (`export * from "./admin";`)
  - Applicable docs: `backend/types/AGENTS.md` (canonical types rules); imports are `import type` ONLY for pure-type positions, VALUE imports for enums used in runtime narrowing
  - _Requirements: REQ-003, REQ-031, REQ-033_
  - [ ] 1.1.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/types/admin/admin-user.types.ts --lifecycle duplicates` (exit 0) + barrels
  - [ ] 1.1.TE **Test Engineering**: N/A for pure types — coverage obligations land on consuming modules; compile gate: `bun tsgo` shows zero new errors vs baseline.
  - [ ] 1.1.SEC **Security & Tenancy Audit**: confirm `passwordHash` structurally absent from every exported shape; no server-controlled field (`id`, governance flags, timestamps, balances) appears in either input type.
  - [ ] 1.1.SR **Semantic Review**: no service-layer `.types.ts` created; no Pothos-local types anticipated; all referenced types resolve to canonical `backend/types/**` sources.
  - [ ] 1.1.IV **Instruction Verification**: re-read `backend/types/AGENTS.md`; validate barrel discipline and CRITICAL "no local types" rule.
  - [ ] 1.1.OUT **Outcome**: `outcome/1.1-outcome.md`.

### 1.2 Governance Filter Enum

- [ ] **1.2 Create `AdminUserGovernanceFilter` enum + type guard**
  - Create `backend/enum/users/admin-user-governance-filter.enum.ts`: `AdminUserGovernanceFilter` (Active/Suspended/Blocked/Deleted values) + `isAdminUserGovernanceFilter` fail-closed type guard (plan.md §2.3)
  - Append `export * from "./admin-user-governance-filter.enum";` to `backend/enum/users/index.ts`
  - _Requirements: REQ-002, REQ-003, REQ-011_
  - [ ] 1.2.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/enum/users/admin-user-governance-filter.enum.ts --lifecycle duplicates` (exit 0)
  - [ ] 1.2.TE **Test Engineering**: covered transitively by directory filter-matrix tests (2.6 TE); guard behavior fuzzed in 5.2.
  - [ ] 1.2.SEC **Security & Tenancy Audit**: guard rejects arbitrary strings without `as` casts; unknown filter values fall back per REQ-011 (filter dropped) while malformed enum *graphql input* fails VALIDATION pre-DB (REQ-054) — confirm the split is understood and documented in the enum file docstring.
  - [ ] 1.2.SR **Semantic Review**: enum members never used as raw string literals downstream; guard uses `Object.values` membership.
  - [ ] 1.2.IV **Instruction Verification**: validate against `backend/enum/AGENTS.md` if present + root AGENTS enum rules.
  - [ ] 1.2.OUT **Outcome**: `outcome/1.2-outcome.md`.

### 1.3 Error Locale Keys (`errors.adminUsers`)

- [ ] **1.3 Add `adminUsers` grouping to the `errors` namespace**
  - `shared/locale/types/errors/index.ts`: add `adminUsers` interface block: `userNotFound`, `userAlreadyDeleted`, `userNotDeleted`, `userSelfDeactivationForbidden`, `adminRoleCreationForbidden`, `userPatchEmpty` (REQ-051)
  - `shared/locale/en/errors/index.ts`: English implementations (sentences, no key-echo)
  - `shared/locale/ar/errors/index.ts`: Arabic implementations (natural RTL phrasing)
  - Verify reuse of existing keys (`emailAlreadyExists`, `validation`, `notFound`, `forbidden`, `internalServerError`) — NO near-duplicates
  - `bun tsgo` MUST pass — `MessageSchema` compile-time parity is the gate
  - _Requirements: REQ-002, REQ-050, REQ-051_
  - [ ] 1.3.QL **Quality Loop**: sub-loop on all three touched locale files (exit 0)
  - [ ] 1.3.TE **Test Engineering**: key-parity proven by `tsgo`; translated-message substring assertions exercised by service tests in 2.6 (REQ-071 forbid raw-key assertions).
  - [ ] 1.3.SEC **Security & Tenancy Audit**: messages disclose no internals (no constraint names, no SQL, no stack hints).
  - [ ] 1.3.SR **Semantic Review**: `shared/` layer purity — locale files import nothing from `@/backend/**`/`@/frontend/**`; no `next-intl`/`getBackendTranslations`/`shared/messages/` references anywhere (grep gate).
  - [ ] 1.3.IV **Instruction Verification**: `shared/locale/AGENTS.md` namespace/extension rules followed.
  - [ ] 1.3.OUT **Outcome**: `outcome/1.3-outcome.md`.

### 1.4 UI Namespace Registration (`adminUsers`)

- [ ] **1.4 Register new `adminUsers` UI locale namespace**
  - Follow `shared/locale/AGENTS.md` registration procedure exactly:
    - `shared/locale/types/adminUsers/index.ts` — interface (page title, table headers: name/email/role/country/status/lastActive/createdAt/actions; status badges: active/suspended/blocked/deleted; role labels; filter labels: role/governance/country/search; empty state; error state; create dialog: title/field labels/submit/cancel; edit dialog; delete & reactivate confirm copy + consequences; detail sections: profile/governance/applicant/teacher/student/parent; self-protection alert; success snackbars)
    - `shared/locale/en/adminUsers/index.ts` + `shared/locale/ar/adminUsers/index.ts` — implementations
    - `MessageSchema` entry + namespace-path registration + `Translation` enum member + `LocaleProvider` wiring if SSR-consumed
  - Admin-authored DATA (names/emails) is never translated — namespace contains chrome copy only
  - _Requirements: REQ-002, REQ-066_
  - [ ] 1.4.QL **Quality Loop**: sub-loop on every new/touched locale file (exit 0); `bun tsgo` parity gate green.
  - [ ] 1.4.TE **Test Engineering**: consumed by component tests (4.x TE via `translation-preload.ts` + `readTranslation(handle, locale)`); this task itself adds no runtime behavior.
  - [ ] 1.4.SEC **Security & Tenancy Audit**: no PII-shaped placeholder content; no credentials vocabulary.
  - [ ] 1.4.SR **Semantic Review**: zero hardcoded strings will remain anywhere in 4.x UI tasks — namespace completeness checklist cross-referenced against plan §5.3/§5.5 state matrix.
  - [ ] 1.4.IV **Instruction Verification**: `shared/locale/AGENTS.md` full registration checklist executed stepwise and recorded.
  - [ ] 1.4.OUT **Outcome**: `outcome/1.4-outcome.md`.

---

## Phase 2: Repositories, Backend Services & Journey Tests (Test-First)

### 2.1 Journey Harness Scaffold + Journey A (TEST-FIRST)

- [ ] **2.1 Write Admin User Lifecycle journey test — TEST-FIRST (Journey A, specs §2.9)**
  - Create `test/workflows/admin/admin-user-lifecycle.journey.test.ts` — one file for Journey A (Create → Observe → Govern → Reactivate)
  - **Scaffold gate**: IF `test/workflows/` does not exist in the tree, this task ALSO scaffolds the layer FIRST:
    - `test/workflows/AGENTS.md` — committed-fixtures-in-`beforeAll` / hard-delete-teardown-in-`afterAll` / actor-attributed-sequential-steps / NO-`runInRollback`-for-journeys / honest-permission-resolution / spied-externalities rules (Architectural Invariant 10)
    - `test/workflows/helpers/journey-fixtures.ts` — per-domain actor-cast provisioner with tracked-ID registry creating REAL users/role rows via committed service calls
    - `test/workflows/helpers/journey-cleanup.ts` — hard-delete teardown honoring FK order (children → `users`)
  - Provision the actor cast via the helper: super admin (REAL `users.role='admin'` row), plus fixture student/parent/applicant for immutability observers — permissions resolve via REAL role context, NEVER monkey-patched, NEVER scope-stubbed
  - Sequential actor-attributed steps (service calls with explicit `actorUserId`, asserting shared-state transitions):
    1. `admin` → create `role=student` → assert `users` + `students` (zeroed balances, unique handshake) + exactly one `audit_logs(create, actorId=admin)` committed atomically
    2. `admin` → directory list filtered `role=student` → new row OBSERVABLE with student headline projection
    3. `new student` → `login` via existing auth service → SUCCEEDS (governance clean)
    4. `admin` → `setUserDeleted(id, true)` → guarded UPDATE + `audit_logs(delete)`; assert `is_deleted=true`, `deleted_at` set
    5. `new student` → `login` → DENIED at governance gate (junction assertion only — DEV2-001/002 boundary internals are not re-tested)
    6. `admin` → `setUserDeleted(id, false)` → `audit_logs(reactivate)`; `login` RESTORED
    7. Denial: `admin` → `setUserDeleted(ownId, true)` → `USER_SELF_DEACTIVATION_FORBIDDEN`, ZERO writes, ZERO audit row (JR-A-2, JR-C-1 no-audit-on-denial rule)
      - Assert cross-actor visibility after each step (who sees deleted badge; who can log in) AND the pre-existing fixture's balances/subscription/applicant rows remain byte-identical across the whole journey (INV-U1/U5)
      - External side effects: none external exist in this ticket — audit writes are REAL and asserted (never spied); confirm no notification dispatch occurs
      - Committed fixtures in `beforeAll` + tracked hard-delete in `afterAll` — NEVER `runInRollback` (services spawn their own transactions)
      - Verify: `bun run test/scripts/run-test.ts test/workflows/admin/admin-user-lifecycle.journey.test.ts` (expected RED until 2.4/2.6 land), then eventually `bun test test/workflows` green
  - _Requirements: REQ-078, REQ-014, REQ-017, REQ-018, REQ-019, REQ-020, JR-A-1, JR-A-2, JR-C-1_
  - [ ] 2.1.OUT **Outcome**: `outcome/2.1-outcome.md` (record scaffold decision, cast table, expected-red run log).

### 2.2 Journey B/C — Denials & Teacher-Applicant Identity (TEST-FIRST)

- [ ] **2.2 Write Admin User Denials journey test — TEST-FIRST (Journeys B + C, specs §2.9)**
  - Create `test/workflows/admin/admin-user-denials.journey.test.ts`
  - Actor cast: super admin + applicant fixture + certified-teacher fixture + parent fixture (all REAL rows via cast helper from 2.1; if absent, extend helpers — never bypass into raw inserts without tracked teardown)
  - Journey B steps (sequential, actor-attributed):
    1. `admin` → create `role=teacher` → `users` + `applicants(status=pending, verification_attempts=0, cooldown_until=NULL)` + audit(create); assert ZERO `teacher` rows created (B.7/INV-TV1 lock — JR-B-1)
    2. `admin` → `getUserDetail(id)` → applicant projection pending observable; NO certified artifact (`teacherIsApproved` null)
    3. `new applicant` → existing DEV2-004 `myApplicantProfile` service path → observes `pending` truthfully (cross-ticket contract verified, not reimplemented)
    4. `admin` → `updateUser(id, {fullName})` → whitelist update + audit(update, `changedFields:["fullName"]`); applicant row byte-identical (fixture-immutability)
    5. Denial: `new applicant` → `listDirectory` service path → typed denial (`FORBIDDEN` at the scope layer — asserted at the permission-resolution seam, journey asserts honest denial before resolver body)
  - Journey C steps:
    1. `anonymous` → each of the five operations → `UNAUTHORIZED`, zero writes
    2. `student`/`parent`/`teacher` (applicant AND certified) → each of the five operations → `FORBIDDEN`, zero writes; assert audit count-delta = 0 across all denials (JR-C-1)
    3. `admin` → create with tampered `role=admin` → `ADMIN_ROLE_CREATION_FORBIDDEN`, zero writes
  - Verify: `bun run test/scripts/run-test.ts test/workflows/admin/admin-user-denials.journey.test.ts`; final suite gate `bun test test/workflows`
  - _Requirements: REQ-078, REQ-015, REQ-016, REQ-030, JR-B-1, JR-C-1_
  - [ ] 2.2.OUT **Outcome**: `outcome/2.2-outcome.md`.

### 2.3 Admin User Repository

- [ ] **2.3 Implement `AdminUserRepository`**
  - Create `backend/db/repo/admin/admin-user.repository.ts` + `backend/db/repo/admin/index.ts` barrel + one line in `backend/db/repo/index.ts`
  - Methods (ALL `tx?: DBTransaction` optional-last; reads via `queryDb(tx)` convention per `backend/db/repo/AGENTS.md` / `docs/drizzle/neon-http-client.md`):
    - `listDirectory(filters, limit, offset, tx?)` — single query per plan §4.2: `users LEFT JOIN applicants/teacher/students` (shared-PK) + scalar subselects (`parentLinkedChildrenCount` count-subquery; `studentHasActiveSubscription` EXISTS-subquery on `subscriptions` active-window); ANDed filter chain; `search` already-escaped pattern via parameterized `ilike` over `fullName`/`email`; `ORDER BY created_at ASC, id ASC`; `LIMIT/OFFSET`
    - `countDirectory(filters, tx?)` — same WHERE, no joins
    - `findDetailById(id, tx?)` — detail projection single-row
    - `updateProfileFields(id, patch, tx?)` — whitelisted `AdminUserUpdateDbPatch` + server `updatedAt`, `RETURNING` (safe select, no `passwordHash`)
    - `setDeletedOnce(id, target, tx?)` — single guarded UPDATE with NULL-safe inverse-state guard (D4: `is_deleted = false OR is_deleted IS NULL` for delete; `= true` for reactivate) + `deleted_at`/`updated_at` + `RETURNING`
    - `existsById(id, tx?)` — cold-path existence probe
  - NO prepared statements here (filters are dynamic AND chains; `inArray` prohibition irrelevant — none used); NO inline `--` comments inside ANY `sql` template; ALL predicates Drizzle-parameterized; NO raw string-concatenated SQL
  - Repository purity: no business logic, no permission checks, no localized strings
  - Applicable docs: `backend/db/repo/AGENTS.md`, `docs/drizzle/prepared-statements.md`, `docs/DATABASE_MIGRATIONS.md`
  - _Requirements: REQ-010, REQ-011, REQ-012, REQ-017, REQ-018, REQ-034, REQ-041, REQ-042, REQ-044, REQ-046_
  - [ ] 2.3.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/db/repo/admin/admin-user.repository.ts --lifecycle duplicates` (exit 0) + barrels
  - [ ] 2.3.TE **Test Engineering**: 4-Tier suite at `backend/db/test/logic/admin/admin-user.repository.test.ts` via `bun run scripts/run-test/run-test.ts`: Tier-1 every filter branch (role ×4, governance ×4 incl. NULL-is-deleted rows, country, search, combined AND), ordering/pagination boundaries (page 1/mid/out-of-range, pageSize 1 & 100, multi-page no-dup/no-gap); Tier-2 boundary (pageSize 0/101 rejected upstream — repo asserts sane clamp contract of its signature); Tier-3 chaos: concurrent `setDeletedOnce` double-delete → exactly one success (REQ-043a at repo seam), wildcard fuzz (`%`,`_`,`\`,unicode/RTL → literal match); Tier-4 security: parameterized-only scan proof + no `--` in sql templates. ALL tests `runInRollback` + `tx` everywhere + `entity-setup.ts` fixtures + `expectRepoError` substring assertions. Coverage target 100% stmt/branch on the new module.
  - [ ] 2.3.SEC **Security & Tenancy Audit**: `escapeLikeWildcards` is applied BEFORE reaching repo (service duty — assert repo docstring declares the precondition); zero `passwordHash` in every projection; guarded writes are single-statement (no read-then-write); `tx` honored in every call.
  - [ ] 2.3.SR **Semantic Review**: no cross-layer imports (repo never touches services/GraphQL/locale); no module-level mutable state (REQ-045); zero dead branches; null-coalescing discipline for nullable governance columns.
  - [ ] 2.3.IV **Instruction Verification**: re-read `backend/db/repo/AGENTS.md` + drizzle instruction files; validate `queryDb(tx)` and optional-last `tx` param positions in every signature.
  - [ ] 2.3.OUT **Outcome**: `outcome/2.3-outcome.md` with coverage evidence.

### 2.4 Admin User Management Service

- [ ] **2.4 Implement `AdminUserManagementService`**
  - Create `backend/services/admin/user-management.service.ts` + `backend/services/admin/index.ts` barrel (+ top-level services barrel line per repo convention)
  - Implement per plan §4.1 exactly:
    - `listDirectory(filters, page, pageSize, locale, tx?)` — pre-DB pagination bounds (`VALIDATION`); drop empty/unknown filter members; service-side `escapeLikeWildcards` + `%…%` composition; empty out-of-range page returns `{items: [], totalCount, page, pageSize}` honestly; projection null-coalesces governance booleans (`?? false`) and fail-closes applicant status via `isApplicantStatus` (corrupt stored value → DEV2-004's existing error path/key — IMPORT, never re-invent)
    - `getUserDetail(userId, locale, tx?)` — defensive positive-safe-integer re-guard; `⊘` row → `NotFoundError("USER", tErrors.adminUsers.userNotFound)` (entity name `"USER"` — never double-suffixed code); role-child snapshot assembly (student `hasActiveSubscription` read-only EXISTS semantics; balances read-only)
    - `createUser(input, actorId, locale, outerTx?)` — role pre-guard (`role=admin` → `ValidationError` `ADMIN_ROLE_CREATION_FORBIDDEN`); field validation; password hashing via EXISTING auth helper; `withTransaction(outerTx)`: `UserRepository.create` → child create (`StudentRepository.createForRegistration` w/ handshake retry per `docs/auth/user-registration.md`; `ApplicantRepository.create` ONLY for teacher — NEVER a `teacher` row (B.7); `ParentRepository.createForRegistration`) → trial grant via `StudentTrialService.grantFreeTrial(..., tx)` ONLY IF 0.2 verified present (else `deferred-items.md` ❌ → DEV1-004 contract) → `AuditService.createAuditLog(AuditLogWriteContract {actorId, Create, "user", entityId, ≤2000-char PII-minimal details}, tx)` → return `getUserDetail(newId, locale, tx)`; 23505 → cause-chain traversal → existing `ConflictError(emailAlreadyExists)`
    - `updateUser(id, patch, actorId, locale, outerTx?)` — empty patch → `VALIDATION` + `userPatchEmpty`; per-field validation (name ≤255 trimmed non-empty, phone ≤20, country ≤100, dateOfBirth valid past); FIELD-BY-FIELD `AdminUserUpdateDbPatch` build (NO `{ ...input }` anywhere — grep gate); tx: guarded update → null → `USER_NOT_FOUND`; audit `Update` with `details={"changedFields":[...]}` (NAMES only); return post-write detail
    - `setUserDeleted(id, deleted, actorId, locale, outerTx?)` — tx: self-protection FIRST (`id===actorId` → `ConflictError(USER_SELF_DEACTIVATION_FORBIDDEN)`, zero writes, zero audit); `setDeletedOnce` → null → `existsById` probe → `USER_NOT_FOUND` vs `USER_ALREADY_DELETED`/`USER_NOT_DELETED`; success → audit (`Delete`|`Reactivate`) → detail
  - Logging: expected rejections via `logger.logDomainError` (`{code, entity:"user", entityId}` — ids/codes only); unexpected → `logger.error`; NO `console.*`; audit details truncated ≤2000 chars with truncation that NEVER fails the mutation (REQ-052)
  - No silent paths (REQ-053): zero swallowed catch, zero catch-and-return-false
  - `getServerTranslations(locale, "errors")` from `@/shared/locale/server-graphql` for error messages
  - Applicable docs: `docs/auth/user-registration.md` (§2 handshake retry, §3 atomicity, 23505), `docs/backend/cross-stream-contracts.md` (`AuditLogWriteContract` composition-only rule, actor discipline), `docs/graphql/domain-error-extensions-code.md`, `docs/graphql/error-handling-contract.md`, `backend/services/AGENTS.md`
  - _Requirements: REQ-010..REQ-021, REQ-031..REQ-035, REQ-040..REQ-046, REQ-050..REQ-054_
  - [ ] 2.4.QL **Quality Loop**: `bun run scripts/health/sub-loop.ts backend/services/admin/user-management.service.ts --lifecycle duplicates` (exit 0) + barrels
  - [ ] 2.4.TE **Test Engineering**: service test suite (4-Tier): Tier-1 — every public method happy path + every rejection branch (both guarded-update zero-row disambiguations incl. NULL-governance-column fixtures, empty patch, each invalid field, tampered role=admin, self-delete); Tier-2 — boundary values (name length 1/255/256, pageSize 1/100/101, id 0/negative/MAX_SAFE_INTEGER+1 pre-DB reject); Tier-3 — `withTransaction` forced child-insert failure → ZERO residual rows in `users`/child/`audit_logs` (REQ-040 rollback proof); `Promise.allSettled` concurrency per REQ-043(a–e); Tier-4 — smuggled-fields probes (`role`/`email`/`passwordHash`/governance/`parentId` ignored), fixture-immutability suite (second student with balances/subscription/applicant row byte-identical after EVERY admin op — INV-U1/U5/REQ-035/REQ-074). All DB-touching tests `runInRollback` + `tx` + `entity-setup.ts` + `expectRepoError` translated-substring assertions; run via `bun run scripts/run-test/run-test.ts`. Coverage: 100% stmt/branch on the module (REQ-070) — `bun test --coverage` evidence recorded.
  - [ ] 2.4.SEC **Security & Tenancy Audit**: BOLA — actor identity ALWAYS from `actorId` param sourced from `ctx.user.id` upstream; BOPLA — field-by-field mapping only (grep proof of zero spreads); BFLA — role-pre-guard + structural whitelist; injection — `escapeLikeWildcards` call site present and non-bypassable; sensitive-field scan — `passwordHash` unreachable in every code path; cross-entity purity — no writes to subscriptions/wallet/payments/sessions/evaluations/balances (REQ-035; grep-verifiable).
  - [ ] 2.4.SR **Semantic Review**: atomicity (single tx per mutation, audit shares fate); zero dead code; no cross-layer imports (service imports repos/types/locale-server only); enums as VALUE imports (`AuditActionType`, `UserRole`); no module-level mutable state; no `createAdminUser` invocation (grep gate — REQ-015/D6).
  - [ ] 2.4.IV **Instruction Verification**: validate against `backend/services/AGENTS.md`, registration doc, cross-stream-contracts doc; confirm `AuditService` method name matches 0.2's verified export.
  - [ ] 2.4.OUT **Outcome**: `outcome/2.4-outcome.md` with coverage %, rollback-proof log, concurrency matrix results.

### 2.M Mid-Point Review Gate

- [ ] **2.M Mid-Point Review (BLOCKING)**
  - Verify BEFORE Phase 3 begins:
    - [ ] Tasks 2.1–2.4 complete with outcomes; journey suites (2.1/2.2) now GREEN against implemented service (`bun test test/workflows` passing)
    - [ ] `git diff --name-only backend/db/schema/** backend/db/migration/**` EMPTY (REQ-044)
    - [ ] Grep gates: zero `{ ...input }` in new files; zero `console.*`; zero `passwordHash` in projections; zero references to `createAdminUser` from new code
    - [ ] `bun tsgo` / `bun biome:check` counts == baseline (no new errors)
    - [ ] REQ-070 coverage evidence for repo + service recorded in 2.3/2.4 outcomes
    - [ ] `deferred-items.md` contains no NEW ❌/⚠️ beyond D1–D4 (or newly raised items are documented with owners)
  - [ ] 2.M.OUT **Outcome**: `outcome/2M-midpoint-review.md` with the gate checklist result; any FAIL blocks Phase 3 until remediated.

---

## Phase 3: GraphQL Resolvers & API Surface

### 3.1 Pothos Objects & Enum Registrations

- [ ] **3.1 Register admin user GraphQL objects + enums**
  - Create `backend/graphql/pothos/admin/admin-user.pothos.ts` + `backend/graphql/pothos/admin/index.ts` barrel
  - Objects backed by canonical types ONLY: `objectRef<AdminUserListItemReturnType>("AdminUserListItem")`, `objectRef<AdminUserPageReturnType>("AdminUserPage")`, `objectRef<AdminUserDetailReturnType>("AdminUserDetail")` (field `id` FIRST — Apollo normalization), snapshot objects from `backend/types/admin/` types; reuse DEV2-004's `ApplicantProfile` object for the `applicant` field (no re-declaration)
  - SDL fields exactly per plan §3.1 (`AdminUserGovernance` enum; `AdminUserFiltersInput`; `AdminCreateUserInput`; `AdminUpdateUserInput`)
  - Enum discipline (REQ-061): in `backend/graphql/pothos/shared/enum.pothos.ts`, VERIFY-FIRST each of `UserRole`/`RegisterPublicRole`/`Gender`/`ApplicantStatus`; register `AdminUserGovernance ← AdminUserGovernanceFilter` via enum-object form (NEW); register any verified-missing pre-existing enum via enum-object form — NEVER hardcoded `values:[...]`, NEVER re-register a registered enum
  - `passwordHash` appears in NO object (structural — type composition enforces it)
  - Applicable docs: `backend/graphql/pothos/**AGENTS.md`, `docs/graphql/api-gateway-and-routing.md`
  - _Requirements: REQ-003, REQ-033, REQ-060, REQ-061_
  - [ ] 3.1.QL **Quality Loop**: sub-loop on every new/modified pothos file (exit 0)
  - [ ] 3.1.TE **Test Engineering**: schema-shape assertions land in 5.1/5.2 (generated SDL greps); this task's gate is `bun tsgo` clean + successful builder composition.
  - [ ] 3.1.SEC **Security & Tenancy Audit**: no sensitive field exposed; `applicant` projection is the DEV2-004 approved shape only; no local types defined inline in pothos files.
  - [ ] 3.1.SR **Semantic Review**: enums as value imports; no `await import`; builder registrations are side-effect-based per gateway contract.
  - [ ] 3.1.IV **Instruction Verification**: validate against pothos layer AGENTS.md + gateway routing doc Rule 8.
  - [ ] 3.1.OUT **Outcome**: `outcome/3.1-outcome.md`.

### 3.2 Queries & Mutations (authScopes + Thin Resolvers)

- [ ] **3.2 Implement admin user queries & mutations**
  - Create `backend/graphql/query/admin/admin-users.query.ts` (2 queries) and `backend/graphql/mutation/admin/admin-users.mutation.ts` (3 mutations) + per-directory barrels with side-effect registration imports (NO `await import`)
  - EVERY operation carries EXACTLY `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (D10 — `$all` conjunction; plain key-map = ANY semantics = FORBIDDEN pattern)
  - Resolver bodies are thin: ID arg → positive-safe-integer guard (no `as number`) → service call with `(…, ctx.user.id, ctx.locale)` → return. Resolvers throw NOTHING directly; service DomainErrors propagate with `extensions.code` and boundary masking
  - Operations exactly per REQ-060 SDL: `adminUsers`, `adminUserDetail`, `adminCreateUser`, `adminUpdateUser`, `adminSetUserDeleted`
  - `backend/lib/gateway/public-operations.ts` UNTOUCHED — run the existing 1:1 allowlist-coverage gate and confirm green
  - Run `bun run generate:gqlSchema && bun codegen`; commit generated artifacts in the same change set; assert generated SDL contains ZERO `deleteUser`/`hardDelete*`/`suspendUser`/`blockUser` operations (grep gate — REQ-021, INV-U4)
  - _Requirements: REQ-050, REQ-054, REQ-060, REQ-061, REQ-062, REQ-030_
  - [ ] 3.2.QL **Quality Loop**: sub-loop on both resolver files (exit 0)
  - [ ] 3.2.TE **Test Engineering**: full behavior coverage via Phase 5.1 GraphQL integration matrix (`setupTestServerLifecycle` + `testClient`); ID-guard boundary fuzz (0, negative, float, `2^53`, non-numeric string → `VALIDATION` pre-DB — assert zero DB round-trips via a repository spy count) lands in this task's resolver unit tier.
  - [ ] 3.2.SEC **Security & Tenancy Audit**: scope map present on all five operations (grep-asserted); anonymous → `UNAUTHORIZED`, non-admin → `FORBIDDEN` BEFORE resolver body (order proven by permission-matrix tests); `ctx.user.id` is the sole actor source.
  - [ ] 3.2.SR **Semantic Review**: thin-resolver discipline; no business logic leaked above the service; locale propagation via `ctx.locale` on every call; no `console.*`.
  - [ ] 3.2.IV **Instruction Verification**: validate against gateway/routing doc (registration, allowlist, codegen workflow) and `docs/auth/jwt-authentication-service.md` scope-semantics section.
  - [ ] 3.2.OUT **Outcome**: `outcome/3.2-outcome.md` with SDL grep evidence + codegen diff summary (no unrelated drift).

---

## Phase 4: Frontend Documents, Routes & UI Views

### 4.1 GraphQL Documents

- [ ] **4.1 Author `admin-users.documents.ts`**
  - Create `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` + `frontend/graphql/sharedDocuments/admin/index.ts` + one line in the top-level barrel
  - Documents (all `gql` + `TypedDocumentNode`, codegen types only): `adminUsersQueryDocument`, `adminUserDetailQueryDocument`, `adminCreateUserMutationDocument`, `adminUpdateUserMutationDocument`, `adminSetUserDeletedMutationDocument`; `id` in EVERY object selection
  - Hooks consumed from `@apollo/client/react` in views; `useQuery`/`useMutation` ONLY — NO `useLazyQuery`
  - Run `bun run generate:gqlSchema && bun codegen`; commit artifacts
  - _Requirements: REQ-063_
  - [ ] 4.1.QL **Quality Loop**: sub-loop on the documents file (exit 0)
  - [ ] 4.1.TE **Test Engineering**: consumed by 4.2/4.3 component tests via Apollo `MockedProvider`; this task's gate = codegen artifacts compile (`bun tsgo`).
  - [ ] 4.1.SEC **Security & Tenancy Audit**: selections request no sensitive field; variables are typed, never string-interpolated.
  - [ ] 4.1.SR **Semantic Review**: no inline operation strings, no mapping layers, no indexed-access type workarounds; named operations match REQ-063 exactly.
  - [ ] 4.1.IV **Instruction Verification**: `frontend/graphql/**/AGENTS.md` + codegen workflow docs.
  - [ ] 4.1.OUT **Outcome**: `outcome/4.1-outcome.md`.

### 4.2 Directory Page (`/admin/users`) — Route, Container, Filters, Table, Dialogs

- [ ] **4.2 Implement Admin Users Directory UI**
  - Files:
    - `app/(dashboard)/admin/users/page.tsx` — Server Component: `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` + `await getTranslations(locale)` → render container with labels
    - `frontend/views/admin/users/AdminUsersDirectoryContainer.tsx` — client: `useAppTranslation(Translation.AdminUsers)` (enum + property access ONLY), `useQuery(adminUsersQueryDocument, {variables})`
    - `frontend/views/admin/users/AdminUsersFilterBar.tsx` — role/governance selects, country input, debounced search
    - `frontend/views/admin/users/AdminUsersTable.tsx` — table with governance + role-child status chips, pagination controls echoing `page/pageSize/totalCount`
    - `frontend/views/admin/users/AdminUserCreateDialog.tsx` — full create form (fullName/email/phone/password/gender?/country/role∈{student,teacher,parent}), `VALIDATION` `extensions.fields[]` → `mutationFieldErrors` seam → per-field localized errors, `aria-invalid={!!error}`, submit disabled in-flight (double-submit mitigation REQ-043d)
    - `frontend/views/admin/users/AdminUserEditDialog.tsx` — whitelist patch form; empty-patch guard client-side mirror
    - `frontend/views/admin/users/AdminUserDeleteConfirmDialog.tsx` — localized delete/reactivate copy + consequences text; self-deactivation conflict → localized warning `Alert` (`theme.palette` tokens)
  - Sidebar: add translated "Users" item under the existing admin navigation group (`*Outlined` icon); mobile bottom-nav UNCHANGED
  - MUI v9/React 19: ALL styling via `sx`; colors ONLY via `theme.palette.*` callback pattern; `*Outlined` icons; submit handlers use `React.SubmitEvent`/`React.SyntheticEvent<HTMLFormElement>`; NO direct style props; `FORBIDDEN` defensive slip-through → `PermissionDeniedFallback` (never bare `null`); responsive per plan §5.5 (table ≥768px, stacked cards at 375px, ≥44px touch targets)
  - Applicable AGENTS.md: `frontend/AGENTS.md`, `frontend/views/AGENTS.md`, `frontend/components/ui/AGENTS.md`, `docs/app/with-page-auth.md`
  - _Requirements: REQ-002, REQ-064, REQ-065, REQ-066_
  - [ ] 4.2.QL **Quality Loop**: sub-loop on every new file (exit 0)
  - [ ] 4.2.TE **Unit / Component Tests**: Happy DOM + Apollo `MockedProvider` + `translation-preload.ts` + `readTranslation(handle, locale)` + `TestWrapper locale`: directory renders rows from mocked query; filter state → variable changes; role-child chips render per role branch; create dialog validation-error projection from mocked `VALIDATION` `extensions.fields[]`; delete-confirm dialog copy is translation-driven; submit disabled while mutation in flight; self-deactivation conflict alert renders localized message. React.SubmitEvent submit tests. ZERO hardcoded UI strings asserted.
  - [ ] 4.2.BF **Agent-Browser Functional Self-Loop**:
    • Launch dev server / connect via agent-browser (Playwright)
    • Navigate `/admin/users` as admin fixture: directory loads; exercise filters (role ×4, governance ×4, country, search incl. `%`/`_` input → literal results), pagination (next/prev, out-of-range page empty state), open create dialog → create student → row appears with correct chips WITHOUT manual refetch (Apollo cache via `id`)
    • Duplicate email submit → localized conflict alert; empty-form submit → per-field localized errors; soft-delete via confirm dialog → Deleted chip appears; reactivate → chip clears; attempt self-delete on own admin row → typed conflict alert + NO row change
    • Assert network requests carry expected GraphQL payloads (variables inspection) and error toasts/inline states render
    • Iterative self-loop: on any failed interaction/validation, patch code and re-test until clean
  - [ ] 4.2.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Capture high-resolution screenshots across Viewports (Desktop 1440x900, Tablet 768x1024, Mobile 375x812) × Locales (English LTR, Arabic RTL) for: directory loaded, filters active, each dialog open, error states, deleted-row state
    • Visually inspect: MUI v9 theme palette compliance (no hardcoded hex/rgb), typography hierarchy, padding/margin rhythm, text truncation/overflows (long Arabic strings in dialogs never clip), RTL mirroring (filter bar, action column at inline-end, chips alignment), dark/light contrast
    • Iterative self-loop: inspect screenshot → identify UI defect → patch MUI `sx` tokens → re-capture → repeat until visually polished
  - [ ] 4.2.SR **Semantic Review**: zero direct style props (`sx` only); zero hardcoded strings/colors; `useAppTranslation(Translation.AdminUsers)` property access everywhere; `*Outlined` icons; `React.SubmitEvent` handlers; no `useLazyQuery`.
  - [ ] 4.2.IV **Instruction Verification**: validate against `frontend.instructions.md`, `mobile-desktop.instructions.md`, and layer AGENTS.md files listed above.
  - [ ] 4.2.OUT **Outcome**: `outcome/4.2-outcome.md` with BF run log + BS screenshot evidence references.

### 4.3 Detail Page (`/admin/users/[id]`) — Profile, Governance & Role-Child Snapshots

- [ ] **4.3 Implement Admin User Detail UI**
  - Files:
    - `app/(dashboard)/admin/users/[id]/page.tsx` — Server Component: `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users/<id>" })` + `getTranslations(locale)`
    - `frontend/views/admin/users/detail/AdminUserDetailContainer.tsx` — client: `useQuery(adminUserDetailQueryDocument)`
    - `frontend/views/admin/users/detail/UserProfileCard.tsx` — all non-sensitive columns + governance timestamps (suspended/blocked are READ-ONLY displays here — DEV3-017 owns mutation)
    - `frontend/views/admin/users/detail/UserSnapshotCards.tsx` — role-branch cards: ApplicantSnapshot (status/attempts/cooldown — certified artifact absent for applicant-only users, JR-B-1 UI branch), TeacherSnapshot, StudentSnapshot (handshake/parent-link/subscription headline/balances — all read-only), ParentSnapshot (linkedChildrenCount)
    - Detail page reuses the 4.2 edit + delete/reactivate dialogs; `USER_NOT_FOUND` (stale link) → localized not-found section + back-to-directory CTA
  - Same MUI v9/React 19/i18n/RTL discipline as 4.2; detail sections stack vertically at mobile
  - _Requirements: REQ-013, REQ-021, REQ-064, REQ-065, REQ-066_
  - [ ] 4.3.QL **Quality Loop**: sub-loop on every new file (exit 0)
  - [ ] 4.3.TE **Unit / Component Tests**: Happy DOM + MockedProvider + translation preload: detail renders per role branch (teacher=applicant-only vs certified; student with/without subscription headline; parent child-count); `USER_NOT_FOUND` state; edit dialog submit → Apollo cache updates the detail view in place; governance fields render as read-only with no mutation affordance (assert NO suspend/block action exists in the DOM).
  - [ ] 4.3.BF **Agent-Browser Functional Self-Loop**:
    • Dev server + agent-browser: per role, open seeded fixture detail pages; verify applicant pending snapshot after teacher-role creation (from 4.2 flow); run edit dialog from detail page (name change → optimistic/returning update visible instantly); delete/reactivate from detail page with confirm dialog; navigate from a deleted user's detail back to directory
    • Assert GraphQL payloads + error surfaces (VALIDATION fields, NOT_FOUND state) end-to-end; iterate until clean
  - [ ] 4.3.BS **Agent-Browser Visual & Styling Self-Loop (Screenshot Analysis)**:
    • Screenshots 1440x900 / 768x1024 / 375x812 × en/ar for: each role-branch detail, not-found state, dialogs from detail context
    • Inspect palette compliance, snapshot-card rhythm, governance timestamp formatting, RTL mirroring of card layouts, mobile stacking order; iterate `sx` patches until polished
  - [ ] 4.3.SR **Semantic Review**: same checklist as 4.2.SR; PLUS assert zero mutation affordance for suspend/block anywhere in the view layer (REQ-021).
  - [ ] 4.3.IV **Instruction Verification**: `frontend.instructions.md`, `mobile-desktop.instructions.md`, layer AGENTS.md.
  - [ ] 4.3.OUT **Outcome**: `outcome/4.3-outcome.md` with BF/BS evidence.

---

## Phase 5: Integration & Differential Testing

### 5.1 GraphQL Permission-Matrix Integration Suite

- [ ] **5.1 GraphQL integration tests (all five operations)**
  - Create integration suite (e.g., `test/graphql/admin/admin-users.integration.test.ts` per repo convention) using `setupTestServerLifecycle` + `testClient` (REQ-076)
  - Assert via `expectMutationError(…, expectedCode)` / query equivalents the FULL §3.4 matrix: anonymous → `UNAUTHORIZED` on all five; student/parent/teacher (applicant AND certified fixtures) → `FORBIDDEN` on all five; admin happy paths on all five; tampered `role=admin` create → `ADMIN_ROLE_CREATION_FORBIDDEN`; self-delete → `USER_SELF_DEACTIVATION_FORBIDDEN`; unknown ids → `USER_NOT_FOUND`
  - Assert `id` present in every payload (Apollo normalization), zero `passwordHash` in any response (deep key walk), and denial responses occur with ZERO `audit_logs` writes (count delta — JR-C-1 at API tier)
  - Run: `bun run test/scripts/run-test.ts <path>`
  - _Requirements: REQ-030, REQ-032, REQ-050, REQ-076_
  - [ ] 5.1.SR **Semantic Review**: assertions use typed codes, never raw message strings; fixtures via entity-setup discipline; no monkey-patched auth.
  - [ ] 5.1.OUT **Outcome**: `outcome/5.1-outcome.md` with the matrix evidence table.

### 5.2 Chaos, Concurrency & Static-Assertion Gates

- [ ] **5.2 Chaos suite + static scans + differential baseline**
  - Chaos (REQ-043, REQ-075) — service-tier proofs via `Promise.allSettled` (extending 2.4.TE into an explicit suite file): (a) double soft-delete → one success + one `USER_ALREADY_DELETED`; (b) delete ⚡ reactivate → one winner, state consistent with winner; (c) concurrent patches → last-write-wins documented behavior; (d) double-create same email → one success + one CONFLICT (23505); (e) forced-failure create → directory count unchanged; PLUS BFLA token probes and enum/ID fuzz failing closed pre-DB
  - Static assertion scans (record command + result for each):
    - `git diff --name-only backend/db/schema/** backend/db/migration/**` → EMPTY (REQ-044)
    - Grep generated `schema.graphql`: NO `deleteUser`/`hardDelete*`/`suspend*`/`block*` mutations (REQ-021/INV-U4); NO `createAdminUser` exposure (REQ-015)
    - Grep new files: zero `{ ...input }`, zero `console.*`, zero `passwordHash` in projections, zero writes to subscriptions/wallet/payments/session/evaluations tables (REQ-035)
    - `backend/lib/gateway/public-operations.ts` unchanged; allowlist 1:1 gate green (REQ-062)
    - GraphQL introspection assertion: no hard-delete/suspend mutations exist (REQ-075)
  - Differential guard (REQ-022): existing suites for `registerUser`/`login`/`refreshToken`/`me`/`myApplicantProfile`/plan ops/session lifecycle run GREEN unmodified
  - Quality gates: `bun tsgo` / `bun biome:check` / lint-service counts == Phase-0 baseline + 0 new (REQ-079); codegen no-unrelated-drift
  - _Requirements: REQ-021, REQ-022, REQ-035, REQ-043, REQ-044, REQ-075, REQ-079_
  - [ ] 5.2.OUT **Outcome**: `outcome/5.2-outcome.md` with every scan command + exit code + baseline delta table.

---

## Phase 6: Post-Implementation Review Waves

- [ ] **6.1 Parallel Review Waves + Deferred-Items Check**
  - Launch the four review waves in parallel (each produces a review artifact under `outcome/reviews/`):
    - [ ] **review-types**: canonical types discipline (REQ-003) — `backend/types/admin/` purity, no service `.types.ts`, no Pothos-local types, `Omit<…,"passwordHash">` enforced, enum value-import audit
    - [ ] **review-backend**: atomicity (single-tx mutations, audit shares fate), guarded-update discipline (no read-then-write), `tx` propagation everywhere, i18n error-key usage, logging hygiene, 100% coverage evidence audit for new modules (REQ-070)
    - [ ] **review-frontend**: MUI v9 sx-only discipline, palette tokens, RTL correctness evidence from BS screenshots, a11y (`aria-invalid`, dialogs), documents/codegen hygiene, `withPageAuth` guard correctness on both routes
    - [ ] **pentester**: BOLA/BFLA/BOPLA matrix re-derivation from §3.4, search-injection fuzz re-run, error-disclosure review (no internals/payload PII), audit-content hygiene (≤2000 chars, names-only), `USER_NOT_FOUND`-oracle ruling scope check (admin-surface-only warning present in doc)
  - [ ] **Deferred-items reconciliation**: `grep -c "❌\|⚠️" ai/plans/sprint_3/dev3-016-admin-user-crud/deferred-items.md` equals 0 EXCEPT the four pre-seeded non-blocking D1–D4 entries with owner-ticket references (REQ-083)
  - Every finding → fix task appended to this file or ❌-deferred with owner; NO silent closure
  - [ ] 6.1.OUT **Outcome**: `outcome/6.1-review-waves-outcome.md` consolidating all four wave artifacts + the deferred-items gate result.

---

## Phase 7: Knowledge Propagation & Documentation

- [ ] **7.1 Canonical documentation**
  - Create `docs/admin/user-management.md` (structure: Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related Documents), covering (REQ-080/081):
    - Directory/filter/search contract incl. `escapeLikeWildcards` mandate for any future admin search
    - Guarded soft-delete/reactivate pattern (single conditional UPDATE + cold-path probe) incl. NULL-safe guards (D4)
    - Role-child projection rules (one `users` directory, shared-PK children, scalar-subselect discipline)
    - Audit-emission contract (writer-side; in-tx; denials write ZERO audit rows — JR-C-1)
    - Self-protection rule; `USER_NOT_FOUND` oracle ruling with the explicit "MUST NOT be copy-pasted to non-admin surfaces" warning (D11)
    - Shared-PK "one user, four role children" model; idempotency ruling (admin ops outside mandated key set — `docs/IDEMPOTENCY.md`); keyset-pagination as documented future refinement
    - **Scope-split record restated verbatim-style**: plan CRUD→DEV1-005, onboarding→DEV3-019, suspend/block→DEV3-017, cold-start→DEV3-018, audit browsing→DEV3-020, sessions→DEV3-021, financials→DEV3-022b
    - Consumer obligations for DEV3-017/018/019/020/021/022b (import-by-reference, never fork)
    - Bind to A.5/A.7, B.6/B.7, INV-U1..U5, INV-TV1, Workflow 05; NO renumbering of spec-decision files
  - _Requirements: REQ-080, REQ-081_
  - [ ] 7.1.SR **Semantic Review**: structure-section completeness; every claim traceable to an REQ or decision ref.
  - [ ] 7.1.OUT **Outcome**: `outcome/7.1-outcome.md`.

- [ ] **7.2 AGENTS.md propagation**
  - Add rule-only one-liners (pointers to `docs/admin/user-management.md`; NO code, NO recipes):
    - `backend/services/AGENTS.md` — admin user-management service + audit-emission rule
    - Root `AGENTS.md` — Important References entry
  - _Requirements: REQ-082_
  - [ ] 7.2.QL **Quality Loop**: sub-loop on touched AGENTS.md files (exit 0)
  - [ ] 7.2.OUT **Outcome**: `outcome/7.2-outcome.md`.

- [ ] **7.3 Final Completion Gate & Outcome Synthesis**
  - Verify ALL of:
    - Every task has its `outcome/<task-id>-outcome.md`; `plan-review-R1.md` predates first implementation outcome
    - Journey suites green: `bun test test/workflows`
    - Full new-module coverage ≥100% stmt/branch evidence on file (REQ-070)
    - Baseline delta = 0 new errors across tsgo/biome/lint (REQ-079); every file passed sub-loop exit 0
    - Deferred-items gate: 0 ❌/⚠️ except D1–D4 (owner-referenced)
    - Zero schema/migration drift final re-check
  - Write `outcome/final-completion-summary.md`: delivered REQ traceability checklist, journey evidence, review-wave resolutions, known-deferred items (D1–D4) with owners
  - _Requirements: REQ-083_
  - [ ] 7.3.OUT **Outcome**: `outcome/7.3-outcome.md` + `final-completion-summary.md` committed; ticket ready for closure.

---

## Dependency-Ordered Summary

| Order | Task | Blocks |
|---|---|---|
| 1 | 0.1, 0.2 | Everything (baseline + dependency guard) |
| 2 | 1.1 → 1.2 → 1.3 → 1.4 | 2.x, 3.x, 4.x |
| 3 | 2.1, 2.2 (journey tests, TEST-FIRST — expected RED) | — |
| 4 | 2.3 (repo) → 2.4 (service) | 2.M gate, 3.x |
| 5 | 2.M Mid-Point Review Gate | 3.x, 4.x |
| 6 | 3.1 → 3.2 (+codegen) | 4.x, 5.1 |
| 7 | 4.1 → 4.2 → 4.3 | 5.x component tiers |
| 8 | 5.1, 5.2 | 6.1 |
| 9 | 6.1 review waves | 7.x |
| 10 | 7.1 → 7.2 → 7.3 | Ticket closure |
