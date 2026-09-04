# Admin User Management — Canonical Reference

**Domain:** Admin / Identity-and-governance core (Workflow 05 — "Manage Users (CRUD)" + audit-write half)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§6 Student Account Lifecycle), `docs/specs/open-decisions-and-gaps.md` (A.5, A.7, B.6, B.7)
**Status:** Implemented and verified

This document is the single canonical reference for the admin user-management surface — the directory, detail, soft-delete/reactivate, audit-emission, and role-child projection contracts. All layers (types, repos, service, GraphQL, frontend, tests) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Why

Workflow 05 (`docs/workflows/05-admin-governance-override.md`) defines the Super Admin as the supreme orchestrator of the platform, with full CRUD visibility + control across `users` and its four role-child tables (`admin`, `teacher`, `students`, `parents`). DEV3-016 ships the **identity core + audit-write half** of that workflow:

- The directory (`/admin/users`) — paginated, filterable, single-query projection of `users` + role-child status headlines.
- The detail page (`/admin/users/[id]`) — full profile + resolved role-child snapshot assembly.
- Create (student / teacher / parent only — never `admin`), whitelisted profile patch, soft-delete + reactivate.
- The audit-write contract — every successful mutation appends exactly one `audit_logs` row inside the same transaction.

The other Workflow 05 halves — cold-start bootstrapping, direct student onboarding, suspend/block governance windows, audit-trail browsing UI, session governance, financial auditing — are owned by DEV3-017/018/019/020/021/022b (see §Scope Split Record). DEV3-016 establishes the substrate every later ticket imports by reference.

This document binds to **A.5** (`audit_logs` table + AuditService write contract), **A.7** (`users` governance fields — `is_deleted`, `deleted_at`, `suspended`, `is_blocked`, etc.), **B.6** (failed-applicant home is `applicants`, not `teacher`), **B.7** (`teacher` row created only after verification passes), **INV-U1..U5** (student/any-user lifecycle — soft-delete preserves all historical/financial data; no hard delete exists; balances survive suspension/blocking/soft-delete), **INV-TV1** (no certification shortcut through this surface), and **Workflow 05** §1 "Full CRUD Visibility & Control" + §7 "Audit Trail".

---

## 2. Pattern

### 2.1 Directory / Filter / Search Contract

The directory ships ONE paginated query joining `users` with its four role-child tables (shared-PK LEFT JOINs) plus two scalar subselects (`parentLinkedChildrenCount`, `studentHasActiveSubscription`) so each user row appears exactly once (no fan-out).

- **Pagination:** page-based (`page ≥ 1`, `pageSize ∈ 1..100`, default 25), stable order `(created_at ASC, id ASC)`. Out-of-range page yields an empty `items` array with the honest `totalCount` (never clamped, never an error). Keyset pagination is a documented future refinement — NOT shipped here (D8).
- **Filters:** independent ANDed predicates (role / governance / country / search). Absent or null members drop out at the service layer (the directory falls back to the unfiltered listing rather than erroring). Malformed enum / pagination values fail VALIDATION pre-DB.
- **Search:** `escapeLikeWildcards` (`backend/lib/db/escape-like-wildcards.ts`) is invoked on the trimmed search string at the SERVICE layer, then wrapped as `%…%`, then handed to the repo as `NormalizedAdminUserFilters.searchPattern`. The repo binds it directly to `ilike(column, pattern)` — Drizzle-parameterized. The repo NEVER re-escapes or re-wraps. **One canonical escape point (the service) + one canonical binding point (the repo's `ilike`)** — eliminates the wildcard-injection surface.

```text
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical:
//   - service: backend/services/admin/user-management.service.ts (normalizeFilters)
//   - repo:     backend/db/repo/admin/admin-user.repository.ts (buildFilterChain + listDirectory)
service: const escaped = escapeLikeWildcards(filters.search.trim());
        searchPattern = `%${escaped}%`;
repo:     or(ilike(users.fullName, filters.searchPattern),
              ilike(users.email,  filters.searchPattern))
```

> **Mandate for any future admin search surface:** import `escapeLikeWildcards` from `@/backend/lib/db/escape-like-wildcards` — NEVER fork a second sanitizer. A second sanitizer would diverge over time and re-open the wildcard-injection surface.

### 2.2 Guarded Soft-Delete / Reactivate Pattern

Soft-delete and reactivate are atomic single-statement guarded `UPDATE`s — NO SELECT-then-UPDATE pattern (which carries a TOCTOU race). The predicate is evaluated under a PostgreSQL row lock; two concurrent deletes serialize: the first's predicate matches (state = false/NULL), the second's predicate fails (state = true) → zero-row return → service disambiguates via a cold-path `existsById` probe.

```text
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical:
//   - repo:     backend/db/repo/admin/admin-user.repository.ts (setDeletedOnce)
//   - service:  backend/services/admin/user-management.service.ts (setUserDeleted)
delete     : UPDATE users SET is_deleted=true,  deleted_at=now(), updated_at=now()
             WHERE id=$1 AND (is_deleted=false OR is_deleted IS NULL)
             RETURNING <SAFE_USER_SELECT>
reactivate : UPDATE users SET is_deleted=false, deleted_at=NULL, updated_at=now()
             WHERE id=$1 AND is_deleted=true
             RETURNING <SAFE_USER_SELECT>
```

**NULL-safe state guards (D4):** The delete predicate is `is_deleted=false OR is_deleted IS NULL` (NULL-safe inverse-state guard) — a legacy NULL row reads correctly under three-valued SQL logic and is deletable. The reactivate predicate is `is_deleted=true` — legacy NULL rows are NOT reactivatable (they're already not-deleted; a reactivation request on them yields `USER_NOT_DELETED`).

**Cold-path probe:** When the guarded UPDATE returns zero rows, the service calls `AdminUserRepository.existsById(id, tx)` — a columnless `SELECT 1 FROM users WHERE id=? LIMIT 1` that NEVER re-reads sensitive columns. `exists=true` → the id is real but in the wrong state for the requested transition → typed conflict (`USER_ALREADY_DELETED` / `USER_NOT_DELETED`). `exists=false` → the id never existed → `USER_NOT_FOUND`.

**Self-protection:** `setUserDeleted(id, deleted=true)` with `id === actorId` rejects with `ConflictError(USER_SELF_DEACTIVATION_FORBIDDEN)` BEFORE any write — zero rows mutated, zero audit rows appended. The orchestrator cannot remove his own account; other admins MAY be soft-deleted by an admin (and the action is audited).

### 2.3 Role-Child Projection Rules

- ONE `users` directory — no per-role separate queries/tabs. Every row carries nullable per-role headline columns: only the columns applicable to a given `role` carry non-null values; the others remain `null` so a single row shape serves all four roles without per-role variant unions.
- Shared-PK children: `applicants.id = users.id`, `teacher.id = users.id`, `students.id = users.id`, `parents.id = users.id` — `LEFT JOIN`s on `child.id = users.id` preserve every `users` row.
- Scalar-subselect discipline (no fan-out): `parentLinkedChildrenCount` (count of `students` rows whose `parent_id` points at the current `users.id`) and `studentHasActiveSubscription` (EXISTS on `subscriptions` with `status='active'` and now-in-window) are scalar subselects — never JOINs — so a parent with N linked students still appears as ONE row in the directory.
- Detail projection is a single flat row across all four role-child tables (LEFT JOINs) — single round-trip, trivially EXPLAIN-able. The service layer assembles the role-child snapshot objects (`AdminTeacherSnapshotReturnType`, `AdminStudentSnapshotReturnType`, `AdminParentSnapshotReturnType`, `ApplicantProfileReturnType`) from this flat row.

### 2.4 Audit-Emission Contract (Writer-Side; In-Tx; Denials Write ZERO Audit Rows — JR-C-1)

Every successful `createUser` / `updateUser` / `setUserDeleted(deleted=true|false)` mutation appends exactly ONE `audit_logs` row INSIDE the same `withTransaction` block via `AuditService.createAuditLog(contract, tx)`. The contract is composed by the calling service (`AdminUserManagementService.buildAuditContract`) — NEVER by the writer (`AuditService`) — so actor / action / entity fields stay a single source of truth.

| `actionType` | `entityType` | `entityId` | `details` (≤2000 chars, names-only) |
|---|---|---|---|
| `Create` | `"user"` | new user's id | `{ role: "student"\|"teacher"\|"parent" }` (the role enum string, NEVER the email/phone/name) |
| `Update` | `"user"` | patched user's id | `{ changedFields: ["fullName", "phone", "country", "gender", "dateOfBirth"] }` — field NAMES only, NEVER values |
| `Delete` | `"user"` | soft-deleted user's id | `{ deleted: true }` |
| `Reactivate` | `"user"` | reactivated user's id | `{ deleted: false }` |

- **Composition-only rule:** the contract arrives fully composed by the caller; the writer never constructs, mutates, or invents metadata. `actorId` is sourced from `ctx.user.id` (never input).
- **Append-only semantics:** `audit_logs` is INSERT-only; the table is trigger-protected against UPDATE/DELETE (per `3-immutability-triggers.sql`). Corrections are made by appending a new compensating row.
- **Atomicity:** the audit insert runs inside the caller's `tx` — the row shares the transaction's commit/rollback fate. A rolled-back mutation leaves zero audit rows.
- **Truncation safety:** `details` is defensively truncated to `varchar(2000)` (the column ceiling) BEFORE insert at TWO layers (`buildAuditContract` at the service + `truncateDetailsSafely` in `AuditService`). An overlong payload NEVER fails the mutation (REQ-052).
- **JR-C-1 (denial-no-audit rule):** denials (anonymous → `UNAUTHORIZED`; non-admin → `FORBIDDEN`; self-deactivation → `USER_SELF_DEACTIVATION_FORBIDDEN`; unknown-id → `USER_NOT_FOUND`; tamper-role → `ADMIN_ROLE_CREATION_FORBIDDEN`; corrupt-state → `USER_ALREADY_DELETED` / `USER_NOT_DELETED`) emit ZERO audit rows. The actor check happens BEFORE any `withTransaction` opens; the self-deactivation check happens INSIDE the tx but BEFORE any write.

### 2.5 Shared-PK "One User, Four Role Children" Model + Idempotency Ruling

- `users.id` is the shared primary key across all four role-child tables. A `users` row plus its single role-child row share the same id. The four role-child tables are exhaustive: every `users.role` value (`admin` / `teacher` / `student` / `parent`) maps to exactly one corresponding child table.
- `registerUser` (public) and `adminCreateUser` (admin) both insert `users` + the matching child row inside ONE atomic transaction. The two registration surfaces differ in: (a) the input whitelist (admin accepts no `role=admin`); (b) the actor attribution (admin mutations are audited to `actorId = ctx.user.id`).
- **Idempotency ruling (admin ops OUTSIDE the mandated key set):** `docs/IDEMPOTENCY.md` mandates an idempotency key for `Student` / `Invoice` / `Class Instance` / `Payment` creation mutations. Admin user-management operations (create / update / soft-delete / reactivate) are LOW-FREQUENCY admin operations with natural unique-key protection (`users.email` unique index → 23505 → `ConflictError`) and guarded state updates (predicate-evaluated `UPDATE … RETURNING`); they are NOT in the mandated idempotency-key set. A double-submit on `adminCreateUser` with the same email yields exactly one success + one `CONFLICT` (23505 traversal; the loser rolls back atomically — zero residual `users` / role-child / audit rows). A double-submit on `adminSetUserDeleted(true)` yields exactly one success + one `USER_ALREADY_DELETED` (the guarded predicate serializes the loser). The UI mitigates the in-flight disable pattern (Submit button disabled while loading) — mirrors DEV1-005 REQ-043 ruling.
- **Keyset pagination** is documented as a future refinement (D8) — the directory's stable order `(created_at ASC, id ASC)` makes a future keyset migration mechanical, but offset page-based pagination is shipped here (simplicity + honest `totalCount` for a sparse admin directory).

---

## 3. Rules

- **REQ-017 (Soft-Delete via Guarded Update):** single guarded `UPDATE` with NULL-safe inverse-state guard + `RETURNING`; NO SELECT-then-UPDATE; nonexistent id → `USER_NOT_FOUND`; already-deleted → `USER_ALREADY_DELETED`. Touches NO child table, financial record, session, evaluation, or balance (INV-U1/INV-U5).
- **REQ-018 (Reactivation — Symmetric Guard):** symmetric guarded update; `USER_NOT_FOUND` for unknown ids; `USER_NOT_DELETED` for active users.
- **REQ-019 (Self-Protection):** `id === actorId` on a soft-delete call → `USER_SELF_DEACTIVATION_FORBIDDEN` BEFORE any write.
- **REQ-020 (Audit Emission on Every Mutation):** create / update / soft-delete / reactivate commits → ONE `audit_logs` row via `AuditLogWriteContract` inside the SAME `tx`. `actorId = ctx.user.id`; `actionType = AuditActionType.Create\|Update\|Delete\|Reactivate`; `entityType = "user"`; `entityId` = target id; `details` = capped, PII-minimal JSON (changed field NAMES for updates — NEVER values; NEVER `passwordHash`; NEVER email pre/post pairs).
- **REQ-021 (Governance Visibility Is Read-Only Here):** detail + directory rows include `suspended` / `isBlocked` / `deletedAt` / `suspendedAt` / `blockedAt` / `suspendedPeriodDays` as PURE READS; this ticket ships NO mutation for them (DEV3-017). The Pothos mutation surface is grep-verifiably absent of `suspendUser` / `blockUser` / `deleteUser` / `hardDelete*`.
- **REQ-030 (BFLA — Admin-Only Gate on Every Operation):** `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` on ALL five operations. The explicit `$all` conjunction is load-bearing (D10) — plain map = ANY semantics = wrong (any authenticated caller would pass). Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN` (403) — both BEFORE the resolver body executes.
- **REQ-032 (BOLA / IDOR — Oracle-Aware Admin Scope):** `actorId` is always `ctx.user.id` (never input); `targetId` is a legitimate admin-controlled parameter. On an admin-gated surface, `USER_NOT_FOUND` (instead of `FORBIDDEN`) is acceptable because user existence is NOT sensitive to a full-governance admin.
- **REQ-035 (Cross-Role Containment):** create / update / delete executes ZERO writes to `applicants.status` / `verification_attempts` / `cooldown_until`, teacher certification flags, student balances, subscription rows, or parent links (unless the operation is the explicit creation of a NEW user — which produces only its own fresh child row).
- **REQ-040 (Creation Atomicity):** `users` + child + audit row commit or roll back atomically inside ONE `withTransaction` block; forced child-insert failure leaves ZERO residual rows in `users`, the child table, and `audit_logs` (rollback proof).
- **REQ-014 (Generic Admin User Creation):** `role ∈ {student, teacher, parent}` only. Student → `students` row (zeroed balances + unique handshake code, bounded retry on 23505); teacher → `applicants` row only (status `pending`, `verification_attempts=0`, `cooldown_until=NULL`) — NEVER a `teacher` row (B.7 / INV-TV1); parent → `parents` row. NO subscription, payment, teacher assignment, or parent-link is created by this operation (DEV3-019). 23505 on `users.email` → `ConflictError` via cause-chain traversal.
- **REQ-015 (BFLA — Admin-Role Creation Blocked Twice):** the `RegisterPublicRole` SDL enum structurally excludes `admin` (schema layer — first line of defense, rejects `role: Admin` GraphQL literal at parse time as `GRAPHQL_VALIDATION_FAILED`); the service re-guards with `assertActorAdmin` + a runtime role-pre-guard (`ADMIN_ROLE_CREATION_FORBIDDEN` — second line of defense against transport-tamper that bypasses the schema validator).
- **REQ-052 (Audit + Log Content Hygiene):** `logger.logDomainError` for expected rejections with structured context `{ code, entity: "user", entityId }`; `logger.error` for unexpected failures; NEVER `console.*`; NO password / token / plaintext-PII payloads; `audit_logs.details` ≤2000 chars; truncation NEVER fails the mutation.
- **REQ-060 (GraphQL Surface — Exact Contract):** five operations — `adminUsers(filters, page, pageSize): AdminUserPage!`, `adminUserDetail(id): AdminUserDetail!`, `adminCreateUser(input): AdminUserDetail!`, `adminUpdateUser(id, input): AdminUserDetail!`, `adminSetUserDeleted(id, deleted): AdminUserDetail!`. `passwordHash` structurally absent from every output shape (`AdminUserListItem` + `AdminUserDetail` + the four snapshot objects).
- **REQ-062 (authScope Declaration):** every operation carries the exact REQ-030 scope map; no operation is public; the public-operations allowlist (`backend/lib/gateway/public-operations.ts`) remains untouched (1:1 coverage gate).
- **REQ-070 (Coverage Target):** all NEW service / repository code reaches 100% statement + branch coverage — every filter branch, both guarded-update zero-row paths, every validation guard.
- **REQ-074 (Mutation Matrix + Fixture Immutability):** create produces exactly `users` + child + audit rows per role and NO `teacher` row for teacher-role creation (B.7); duplicate email → CONFLICT; whitelist-only update (smuggled `role` / `email` / `passwordHash` / governance / `parentId` ignored); guarded delete/reactivate state machine incl. both conflict branches + self-protection; audit rows appended once per mutation with `actorId = admin`; pre-existing fixtures (a second student with balances / subscription / applicant record) byte-identical after every admin operation (INV-U1/INV-U5/REQ-035).
- **REQ-079 (Baseline & Quality Gates):** `bun tsgo` / `biome:check` / lint counts equal the REQ-001 baseline plus ZERO new errors; every created/modified file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0; codegen no-unrelated-drift rule holds.

---

## 4. What NOT to Do

- **DO NOT fork a second LIKE/ILIKE sanitizer.** `escapeLikeWildcards` at `backend/lib/db/escape-like-wildcards.ts` is the SOLE canonical sanitizer. Future admin search surfaces MUST import it — never re-implement. The service escapes + wraps `%…%`; the repo binds the final pattern directly to `ilike(column, pattern)` — never re-escape or re-wrap. A second sanitizer would diverge over time and re-open the wildcard-injection surface.
- **DO NOT use a SELECT-then-UPDATE pattern for soft-delete/reactivate.** Two concurrent deletes reading `is_deleted=false` both would "succeed" — INV-U4 / REQ-043(a) violated. Use the single guarded `UPDATE … WHERE id=? AND <null-safe inverse-state guard> … RETURNING *` pattern (D3).
- **DO NOT use a naive `= <bool>` predicate on the governance columns.** Three-valued SQL logic: `NULL IS NOT FALSE`. A legacy NULL row would be un-deletable forever (silent bug). Use `is_deleted=false OR is_deleted IS NULL` (D4).
- **DO NOT copy-paste the `USER_NOT_FOUND` oracle ruling to non-admin surfaces.** On this admin-gated surface, `USER_NOT_FOUND` (instead of `FORBIDDEN`) for an unknown id is acceptable because user existence is non-sensitive to a full-governance admin. This ruling is INVERTED on non-admin surfaces — e.g. `myApplicantProfile` returns `null` (no-oracle) for a certified teacher who never applied (per `docs/teachers/applicant-lifecycle.md` §3); the applicant surface deliberately does NOT confirm whether a given id exists. **Copying this admin-surface oracle to a non-admin surface would re-introduce a BOLA oracle leak.** (D11)
- **DO NOT mint a `teacher` row on admin user creation with `role=teacher`.** The admin create path mints an `applicants` row (`status='pending'`, `verification_attempts=0`, `cooldown_until=NULL`) — NEVER a `teacher` row. Certification belongs to the verification loop / DEV3-018 (INV-TV1 — no certification shortcut through this surface).
- **DO NOT expose `createAdminUser` via GraphQL.** Admin accounts are NOT publicly registrable; the public registration surface `registerUser` uses the `RegisterPublicRole` enum that structurally excludes `Admin`. Admin-account provisioning is service-only (grep-verifiably unwired to GraphQL) — D6 double block.
- **DO NOT spread `{ ...input }` into the create / update payload.** `createUser` and `updateUser` build their payloads field-by-field (BOPLA — `buildCreateUserInsert` / `buildUpdatePatch`). Transport-tampered extra fields are ignored by construction. Server-controlled fields (`id`, governance flags, timestamps, balances, `passwordHash`, `parentId`, handshake code) are structurally unreachable through the input whitelist.
- **DO NOT write audit rows outside the caller's transaction.** Post-commit audit side effects lose the trail if the process crashes between write and audit. In-tx via `AuditService.createAuditLog(contract, tx)` — D7.
- **DO NOT write audit rows on denials.** Denial-no-audit rule (JR-C-1). The actor check runs BEFORE any `withTransaction` opens. A denial pollutes the append-only trail with noise; the audit trail is reserved for actual mutations.
- **DO NOT log contact-PII, credentials, or token values.** `audit_logs.details` carries field NAMES only (for updates — `changedFields: ["fullName", "phone", ...]` — NEVER values). `logger.logDomainError` payloads carry `{ code, entity, entityId }` — ids + codes only.
- **DO NOT touch the registration write path.** `registerUser` is pre-existing and permanently test-locked. The admin create path composes the SAME DEV1-002 primitives (`UserRepository.create`, role-child repos, handshake retry, 23505→`ConflictError` cause-chain) inside `withTransaction(outerTx)` — never forks a parallel registration pipeline. Two registration truths would diverge the INV-U/B invariants.
- **DO NOT re-implement trial grant logic in the admin create path.** Per REQ-014 conditional path rule: when the trial lane (DEV1-004 `StudentTrialService.grantFreeTrial`) lands and migrates `students` to add the trial columns, a follow-up DEV3-016 amendment wires the conditional call into the student-creation flow. Until then, the trial lane is dormant — NEVER re-implemented.
- **DO NOT touch `public-operations.ts`.** The public-operations allowlist is the default-deny gate (REQ-062). The admin user-management operations are NOT public — they carry `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
- **DO NOT touch `docs/specs/state-machine-invariants.md` or `docs/specs/open-decisions-and-gaps.md` numbering.** This document binds to A.5/A.7, B.6/B.7, INV-U1..U5, INV-TV1 by REFERENCE — it does not renumber, edit, or add to those files. Any future gap discovered by a downstream change MUST be recorded in that change's own doc change section, never by renumbering the invariant file.

---

## 5. Rollout Summary

DEV3-016 ships:

- `backend/types/admin/admin-user.types.ts` — canonical types (5 return-shape interfaces + 3 input shapes + 1 repo-internal patch type + the `AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">` alias).
- `backend/db/repo/admin/admin-user.repository.ts` — directory + count + detail + `updateProfileFields` + `setDeletedOnce` + `existsById`. The `SAFE_USER_SELECT` column-pick shape structurally omits `passwordHash` at the Drizzle layer.
- `backend/services/admin/user-management.service.ts` — 5 methods: `listDirectory`, `getUserDetail`, `createUser`, `updateUser`, `setUserDeleted`. All accept `outerTx?: DBTransaction` last; propagate `tx` to every call; emit one in-tx audit row per successful mutation.
- `backend/services/admin/audit.service.ts` — `createAuditLog(contract, tx)` — composition-only, append-only, ≤2000 chars truncated before insert (D5 resolved).
- `backend/lib/db/with-transaction.ts` — `withTransaction(outerTx, fn)` — SAVEPOINT-aware under test `outerTx`; top-level `db.transaction` in production (D5 dependency, lifted in Task 0.2).
- `backend/lib/db/escape-like-wildcards.ts` — `escapeLikeWildcards(input)` — single canonical LIKE/ILIKE sanitizer (D6 resolved).
- `backend/graphql/pothos/admin/admin-user.pothos.ts` — 6 objects (`AdminUserListItem`, `AdminUserPage`, `AdminUserDetail`, `AdminTeacherSnapshot`, `AdminStudentSnapshot`, `AdminParentSnapshot`) + 3 input types (`AdminUserFiltersInput`, `AdminCreateUserInput`, `AdminUpdateUserInput`). `id` exposed FIRST on every object (Apollo normalization). `applicant` slot reuses the DEV2-004 `ApplicantProfilePothosObject` (composition-only).
- `backend/graphql/query/admin/admin-users.query.ts` + `backend/graphql/mutation/admin/admin-users.mutation.ts` — 5 root fields with the exact `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` map (D10). Thin resolvers — no business logic, no try/catch; service `DomainError` subclasses propagate with `extensions.code` + boundary masking.
- `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` — 5 documents (1 query, 1 detail query, 3 mutations). `id` selected FIRST in every fragment. NO `passwordHash` selected anywhere. `useQuery` / `useMutation` only — NO `useLazyQuery`.
- `frontend/views/admin/users/AdminUsersDirectoryContainer.tsx` — directory client surface (filter bar + paginated table + mobile stacked cards + create / edit / delete-reactivate confirm dialogs). MUI v9 `sx`-only discipline; palette tokens; `*Outlined` icons; ≥44px touch targets on Submit / Confirm / Refresh / Create buttons; debounced search.
- `frontend/views/admin/users/AdminUserDetailContainer.tsx` — detail client surface (profile card + governance card + role-child snapshot cards + back-to-directory CTA + `USER_NOT_FOUND` not-found section).
- `app/(dashboard)/admin/users/page.tsx` + `app/(dashboard)/admin/users/[id]/page.tsx` — Server Components with `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` + locale-aware `generateMetadata`.

Tests: 147 tests / ~900 `expect()` calls across 6 files — repo logic (45), service (47), chaos (8), GraphQL integration (32 parameterized × 4 tiers), Journey A lifecycle (7), Journey B+C denials (8). All GREEN. Schema/migration drift = empty (`git diff backend/db/schema/** backend/db/migration/**` empty). `bun tsgo` exit 0; `bun biome:check` 0 errors / 8 pre-existing warnings (intentional test-file scan oracle strings). Sub-loop exit 0 on every new file.

---

## 6. Scope Split Record

DEV3-016 ships the **identity core + audit-write half** of Workflow 05. The other halves are owned by separate Sprint-3 tickets (import-by-reference — never fork this surface):

| Half | Owner ticket | Imports from DEV3-016 |
|---|---|---|
| Admin user CRUD (directory / detail / create / patch / soft-delete / reactivate) + audit-write contract | **DEV3-016** (this ticket) | — |
| Cold-start bootstrapping (`is_approved=true` / `is_evaluator=true` writes on `teacher` row) | **DEV3-018** | The `applicants` row minted by DEV3-016's create-teacher path (D4 deferred-item); the audit-write contract |
| Suspend / block governance windows (`suspended`, `suspended_period_days`, `is_blocked` mutations) | **DEV3-017** | The `users` governance columns READ by the directory + detail (REQ-021 — pure reads here); the in-tx audit-write contract |
| Direct student onboarding (subscription creation + payment recording + parent-link `students.parent_id` write) | **DEV3-019** | The `students` row minted by DEV3-016's create-student path (zeroed balances + handshake); the in-tx audit-write contract |
| Audit-trail browsing UI (read-back of `audit_logs` rows) | **DEV3-020** | The `AuditService.createAuditLog` writer + `AuditLogWriteContract` (D5 resolved); imports by reference — never forks a second writer |
| Session governance (reschedule / cancel / reassign sessions) | **DEV3-021** | The `users` directory + detail for actor resolution; the audit-write contract |
| Financial auditing (payments / wallet / payouts) | **DEV3-022b** | The `users` directory + detail; the audit-write contract |
| Plan CRUD (create / edit / activate / deactivate plans) | DEV1-005 (separate sprint) | The audit-write contract pattern (precedent); the `users` directory for admin-browsing context |
| Cold-start certification (`is_approved` write on `teacher` row) | DEV3-018 | The `applicants` row minted by DEV3-016's create-teacher path; never forks a `teacher`-row-creation path |

> **DEV3-018 SHIPPED:** canonical reference — `docs/admin/cold-start-certification.md`.

### Consumer obligations for DEV3-017 / 018 / 019 / 020 / 021 / 022b

- **Import-by-reference, never fork.** The audit-write contract (`AuditLogWriteContract` + `AuditService.createAuditLog(contract, tx)`) is the SINGLE canonical writer. A second writer would diverge the `actorId` source-of-truth and re-open the denial-no-audit rule surface. The `escapeLikeWildcards` utility is the SINGLE canonical LIKE/ILIKE sanitizer. The `withTransaction` helper is the SINGLE canonical transaction-context helper. The `UserRepository.findById` / `AdminUserRepository.*` methods are the canonical reads.
- **Honor the in-tx audit-emission contract.** Every mutation in the consumer ticket MUST append its audit row inside the SAME `tx` that performs the mutation (D7). Denial paths MUST emit ZERO audit rows (JR-C-1).
- **Honor the `actorId = ctx.user.id` rule.** Never source `actorId` from input. The admin `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` gate is the precondition; the actor identity is the verified session user.
- **Honor the `passwordHash` never-touch discipline.** The `AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">` alias is enforced at both the TS-type layer AND the Drizzle column-pick layer. Consumer tickets MUST NOT project `passwordHash` to any admin surface — the GraphQL schema rejects any attempt with `GRAPHQL_VALIDATION_FAILED` (defense in depth).
- **Honor the `USER_NOT_FOUND` oracle ruling scope.** The ruling is admin-surface-only. Consumer tickets with non-admin surfaces (e.g. DEV3-019 student onboarding if it ever exposes a parent-facing surface) MUST invert the ruling to `null` (no-oracle) for the non-admin surface (per the applicant-lifecycle precedent).
- **Honor the role-child projection rules.** Consumer tickets that extend the directory or detail projection MUST keep the single-`users`-directory + shared-PK LEFT JOIN + scalar-subselect discipline. A JOIN that fans out the parent row into N children violates the "one row per user" directory contract.

---

## 7. Related Documents

- Requirements & invariants: `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§6 Student Account Lifecycle) — **read-only for this surface**.
- Recorded decisions: `docs/specs/open-decisions-and-gaps.md` (A.5 audit_logs, A.7 governance on `users`, B.6 failed-applicant home, B.7 teacher-row timing).
- Workflow: `docs/workflows/05-admin-governance-override.md` (DEV3-016 implements §1 "Full CRUD Visibility & Control" + §5.1 Soft Delete Rules + §7 "Audit Trail" writer-side; cold-start / direct onboarding / suspend-block / session / financials / audit-browsing halves owned by DEV3-017..022b).
- Error contract: `docs/graphql/domain-error-extensions-code.md` (SCREAMING_SNAKE_CASE; `NotFoundError("USER", …)` auto-generates `USER_NOT_FOUND`).
- Error handling: `docs/graphql/error-handling-contract.md` (masking/redaction pipeline; correlation bounds; per-guarantee test matrix).
- Public-operations default-deny gate: `docs/graphql/api-gateway-and-routing.md` (REQ-062 — admin operations NOT on the public allowlist).
- authScopes / RBAC: `docs/auth/jwt-authentication-service.md` (§3 DEV2-002 RBAC consumption guide — role scope OR semantics, 401-vs-403 exclusivity, role↔certification boundary).
- Pothos scope-auth `$all` conjunction: `docs/teachers/applicant-lifecycle.md` §3 (the verified pattern — D10).
- Registration canonical contract: `docs/auth/user-registration.md` (role→child mapping; handshake generation; atomicity pattern; BOPLA/BFLA defenses; 23505→ConflictError translation — DEV3-016 composes the same primitives).
- Teacher applicant lifecycle: `docs/teachers/applicant-lifecycle.md` (the `applicants` state machine; the INVERTED `USER_NOT_FOUND` oracle ruling precedent — admin surface returns `USER_NOT_FOUND`, applicant surface returns `null`).
- Idempotency ruling: `docs/IDEMPOTENCY.md` (admin user-management ops are NOT in the mandated Student/Invoice/Class/Payment idempotency-key set; natural unique-key protection via `users.email` index + guarded state updates; in-flight UI disable mitigation).
- Drizzle prepared-statement rules: `docs/drizzle/prepared-statements.md` (directory reads run through the repo `queryDb(tx)` convention; directory filters are dynamic AND chains — no `inArray` — so plain parameterized queries).
- Drizzle Neon HTTP client: `docs/drizzle/neon-http-client.md` (provider-agnostic stateless query executor; admin reads branch on `tx` vs global `db` per the repo convention).
- DataLoader batching forward contract: `docs/graphql/dataloader-batching.md` (directory list fields are projection-shaped — single joined read; any future per-parent resolution on `AdminUserDetail` MUST use `t.loadable()` + batch repos).
- SSR page auth wrapper: `docs/app/with-page-auth.md` (the `withPageAuth({ roles, redirectTo })` pattern used by `/admin/users` + `/admin/users/[id]`).
- Cross-stream contract types: `docs/backend/cross-stream-contracts.md` (DEV2-003 — the `AuditLogWriteContract` + `ActorContextRef` composition-only rule; forbidden-field registry).
- Types consolidation: `docs/backend/types-consolidation.md` (the rule that admin types live in `backend/types/admin/`, NOT in service-layer `.types.ts` files).
- Authoritative implementations: `backend/types/admin/admin-user.types.ts`, `backend/db/repo/admin/admin-user.repository.ts`, `backend/services/admin/user-management.service.ts`, `backend/services/admin/audit.service.ts`, `backend/lib/db/with-transaction.ts`, `backend/lib/db/escape-like-wildcards.ts`, `backend/graphql/pothos/admin/admin-user.pothos.ts`, `backend/graphql/query/admin/admin-users.query.ts`, `backend/graphql/mutation/admin/admin-users.mutation.ts`, `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`, `frontend/views/admin/users/AdminUsersDirectoryContainer.tsx`, `frontend/views/admin/users/AdminUserDetailContainer.tsx`, `app/(dashboard)/admin/users/page.tsx`, `app/(dashboard)/admin/users/[id]/page.tsx`.
- Test locks: `backend/db/test/logic/admin/admin-user.repository.test.ts` (45 tests — repo 4-tier), `backend/services/admin/user-management.service.test.ts` (47 tests — service 4-tier), `backend/services/admin/user-management.chaos.test.ts` (8 tests — chaos + fuzz), `frontend/graphql/test/admin/admin-users.integration.test.ts` (32 tests — GraphQL permission-matrix integration), `test/workflows/admin/admin-user-lifecycle.journey.test.ts` (7 tests — Journey A), `test/workflows/admin/admin-user-denials.journey.test.ts` (8 tests — Journey B + C).
