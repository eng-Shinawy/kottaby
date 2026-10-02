# Admin User Management — Canonical Reference

**Domain:** Admin / Identity-and-governance core (Workflow 05 — "Manage Users (CRUD)" + audit-write half)
**Specs:** `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§6 Student Account Lifecycle), `docs/specs/open-decisions-and-gaps.md` (A.5, A.7, B.6, B.7)
**Status:** Implemented and verified

This document is the single canonical reference for the admin user-management surface — the directory, detail, soft-delete/reactivate, audit-emission, and role-child projection contracts. All layers (types, repos, service, GraphQL, frontend, tests) MUST conform to the contracts described here. Code blocks in this document are **illustrative and NON-authoritative** — the authoritative implementations are cited by path in each section.

---

## 1. Why

Workflow 05 (`docs/workflows/05-admin-governance-override.md`) defines the Super Admin as the supreme orchestrator of the platform, with full CRUD visibility + control across `users` and its four role-child tables (`admin`, `teacher`, `students`, `parents`). This surface ships the **identity core + audit-write half** of that workflow:

- The directory (`/admin/users`) — paginated, filterable, single-query projection of `users` + role-child status headlines.
- The detail page (`/admin/users/[id]`) — full profile + resolved role-child snapshot assembly.
- Create (student / teacher / parent only — never `admin`), whitelisted profile patch, soft-delete + reactivate.
- The audit-write contract — every successful mutation appends exactly one `audit_logs` row inside the same transaction.

The other Workflow 05 halves — cold-start bootstrapping, direct student onboarding, suspend/block governance windows, audit-trail browsing UI, session governance, financial auditing — are owned by the scope-split follow-on tickets (see §Scope Split Record). This surface establishes the substrate every later ticket imports by reference.

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
| `Update` (credential rotation — `adminSetUserPassword`) | `"user"` | rotated user's id | `{ changedFields: ["credentials"], mustChangePassword: <admin's boolean> }` — the flag value ONLY; NEVER the password or its hash |

- **Composition-only rule:** the contract arrives fully composed by the caller; the writer never constructs, mutates, or invents metadata. `actorId` is sourced from `ctx.user.id` (never input).
- **Append-only semantics:** `audit_logs` is INSERT-only; the table is trigger-protected against UPDATE/DELETE (per `3-immutability-triggers.sql`). Corrections are made by appending a new compensating row.
- **Atomicity:** the audit insert runs inside the caller's `tx` — the row shares the transaction's commit/rollback fate. A rolled-back mutation leaves zero audit rows.
- **Truncation safety:** `details` is defensively truncated to `varchar(2000)` (the column ceiling) BEFORE insert at TWO layers (`buildAuditContract` at the service + `truncateDetailsSafely` in `AuditService`). An overlong payload NEVER fails the mutation (REQ-052).
- **JR-C-1 (denial-no-audit rule):** denials (anonymous → `UNAUTHORIZED`; non-admin → `FORBIDDEN`; self-deactivation → `USER_SELF_DEACTIVATION_FORBIDDEN`; unknown-id → `USER_NOT_FOUND`; tamper-role → `ADMIN_ROLE_CREATION_FORBIDDEN`; corrupt-state → `USER_ALREADY_DELETED` / `USER_NOT_DELETED`) emit ZERO audit rows. The actor check happens BEFORE any `withTransaction` opens; the self-deactivation check happens INSIDE the tx but BEFORE any write.

- **Contract parity across surfaces (completeness verification):** the plan-catalog mutations (`createPlan` / `updatePlan` / `setPlanActiveStatus` → `Create` / `Update` / `Suspend` / `Reactivate` with `entityType="plan"`) and the session-dispute arbitration (`resolveSessionDispute` → `Override` with `entityType="session"`, details recording the resolution and the note's PRESENCE — never its content) now emit under this same contract: composed by the calling service, inside the caller's transaction, zero rows on denial paths. `test/workflows/admin/audit-completeness.catalog.ts` + `backend/db/test/logic/audit/audit-census-drift.test.ts` lock every shipped admin mutation to this shape (see `docs/admin/audit-trail.md` §10.5).

### 2.5 Shared-PK "One User, Four Role Children" Model + Idempotency Ruling

- `users.id` is the shared primary key across all four role-child tables. A `users` row plus its single role-child row share the same id. The four role-child tables are exhaustive: every `users.role` value (`admin` / `teacher` / `student` / `parent`) maps to exactly one corresponding child table.
- `registerUser` (public) and `adminCreateUser` (admin) both insert `users` + the matching child row inside ONE atomic transaction. The two registration surfaces differ in: (a) the input whitelist (admin accepts no `role=admin`); (b) the actor attribution (admin mutations are audited to `actorId = ctx.user.id`).
- **Idempotency ruling (admin ops OUTSIDE the mandated key set):** `docs/IDEMPOTENCY.md` mandates an idempotency key for `Student` / `Invoice` / `Class Instance` / `Payment` creation mutations. Admin user-management operations (create / update / soft-delete / reactivate) are LOW-FREQUENCY admin operations with natural unique-key protection (`users.email` unique index → 23505 → `ConflictError`) and guarded state updates (predicate-evaluated `UPDATE … RETURNING`); they are NOT in the mandated idempotency-key set. A double-submit on `adminCreateUser` with the same email yields exactly one success + one `CONFLICT` (23505 traversal; the loser rolls back atomically — zero residual `users` / role-child / audit rows). A double-submit on `adminSetUserDeleted(true)` yields exactly one success + one `USER_ALREADY_DELETED` (the guarded predicate serializes the loser). The UI mitigates the in-flight disable pattern (Submit button disabled while loading) — mirrors the plan-catalog REQ-043 ruling.
- **Keyset pagination** is documented as a future refinement (D8) — the directory's stable order `(created_at ASC, id ASC)` makes a future keyset migration mechanical, but offset page-based pagination is shipped here (simplicity + honest `totalCount` for a sparse admin directory).

### 2.6 Credential Management Contract (Admin Rotation + Self-Service Change)

Two DISTINCT credential surfaces share ONE write home; they must never be conflated:

| | Admin direct-change | Self-service change |
|---|---|---|
| GraphQL field | `adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!): AdminUserDetail!` | `changeMyPassword(input: ChangeMyPasswordInput!): User!` |
| Scope | `$all: { authenticated: true, role: [UserRole.Admin] }` (BFLA outer ring; the service re-guards with the strict actor gate) | `{ authenticated: true }` |
| Identity | admin-supplied target `id` — absent id and soft-deleted target fold into the SAME `USER_NOT_FOUND` (no deleted-vs-missing oracle) | always `ctx.user.id`; the input carries NO identity member (a smuggled one dies at validation before any resolver) |
| Input shape | `AdminSetUserPasswordInput` — EXACTLY `{ password, mustChangePassword }` | `ChangeMyPasswordInput` — EXACTLY `{ currentPassword, newPassword }` |
| Flag semantics | `mustChangePassword` is the admin's choice persisted in the SAME write — `true` arms the forced reset (§2.7), `false` is a plain rotation that clears any prior flag | hard-coded `false` — the ONLY self-service flag-clearing path |
| Audit | exactly ONE `Update` row on `"user"` in the same tx (§2.4) | ZERO audit rows (self-service is deliberately unaudited) |
| Service | `AdminUserManagementService.setUserPassword` — `backend/services/admin/user-management.service.ts` | `AuthService.changeMyPassword` — `backend/services/auth/auth.service.ts` |

**Single password write home.** Every production password write — admin or self — flows through `UserRepository.updatePassword(userId, passwordHash, mustChangePassword, tx, expectedCurrentHash?)` (`backend/db/repo/users/user.repository.ts`): one guarded `UPDATE users SET password_hash, must_change_password … RETURNING *` with a REQUIRED `tx` (no global-`db` fallback), `updated_at` re-stamped by the column's `$onUpdate` hook, and `null` on zero matched rows. Exactly TWO production callsites exist (admin: unfenced 4-arg form; self: fenced 5-arg form). `AdminUserRepository` deliberately exposes NO password method.

```text
// ILLUSTRATIVE — NON-AUTHORITATIVE. Canonical:
//   backend/db/repo/users/user.repository.ts (UserRepository.updatePassword)
admin: UPDATE users SET password_hash=$hash, must_change_password=$flag
         WHERE id=$id RETURNING *                    -- admin override; fence omitted
self : UPDATE users SET password_hash=$hash, must_change_password=false
         WHERE id=$id AND password_hash=$observedHash RETURNING *  -- credential fence
```

**The credential fence (`expectedCurrentHash`).** The self path threads the hash observed at identity load into the write's WHERE predicate. Under READ COMMITTED the predicate re-evaluates on the latest committed row version after a lock wait, so an admin rotation committing inside the ~bcrypt-sized proof window yields zero matched rows → the SAME denial — the admin's hash and flag survive byte-identical. Admin override paths omit the fence by design: concurrent admin rotations serialize last-writer-wins, each writing its own audit row.

**Shared policy gate.** `validatePasswordPolicy(password, authTranslations)` (`backend/services/admin/user-management.helpers.ts`) is the SINGLE password-policy validator consumed by BOTH services: empty/whitespace-only → `PASSWORD_REQUIRED`; shorter than `MIN_PASSWORD_LENGTH = 8` → `PASSWORD_TOO_SHORT`. Entries are built explicitly (`{ field: "password", code, message }` — localized `auth` copy, never a spread of submitted values) and ride `extensions.fields` on the wire. The self-service form folds the `password` field tag onto its new-password input for inline display.

**Constant denials — no oracles.** Denial shapes never disclose whether an identity exists, is governed, or raced:

- **Admin path:** strict `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts`) → invalid id → `ValidationError` → policy gate → in-tx write → `written === null || written.isDeleted === true` ⇒ `NotFoundError("USER", …)` thrown BEFORE the audit insert (the tx rollback ⇒ zero writes + zero audit rows).
- **Self path:** vanished row + soft-deleted caller (pre-compare fold) + wrong current password + fenced miss ALL collapse into ONE `CURRENT_PASSWORD_INVALID` `ValidationError` with `extensions.fields = [{ field: "currentPassword", … }]` — byte-identical client behavior, zero writes on every denial. The `written` row is re-checked for `isDeleted` INSIDE the `withTransaction` callback so the throw rolls the write back pre-commit (a check after the transaction returns would be too late). `newPassword === currentPassword` → `NEW_PASSWORD_SAME_AS_CURRENT` rejected BEFORE hashing.

**Hash discipline.** `hashPassword` (bcrypt) runs BEFORE the transaction opens; plaintext never enters a transaction, a log line, an audit row, or a response. Stored hashes are never logged, echoed, or returned — every credential output type is password-stripped by construction (`AdminUserSafeSelect` / `RegistrationReturnType` projections).

**The audit trail never carries credentials.** The admin rotation's audit details carry field names + the flag value ONLY (§2.4); service and journey suites pin raw-JSON non-containment of both the submitted plaintext and the stored hash. A credential is not a changed "value" and never travels through `details`.

**i18n constraints for the credential surfaces.** New `adminUsers` leaves are FLAT strings (ICU bands only where interpolation is genuinely needed) — the namespace parity walker REJECTS function leaves (`shared/locale/adminUsers-namespace.parity.test.ts`), and every new key is pinned under BOTH locales (`changePasswordAction`, the 8-key `changePasswordDialog` block, `detail.mustChangePasswordLabel/Value`, `snackbars.passwordChanged`). Server denial copy resolves through `getServerTranslations(locale).errorsTranslations` (`passwordChangeRequired` / `currentPasswordInvalid` / `newPasswordSameAsCurrent` — zero-ICU-placeholder keys, pinned in `shared/locale/errors-namespace.parity.test.ts`) — never hardcoded English. `authTranslations.passwordRequired` / `passwordTooShort` are REUSED by both services and both client forms — never re-minted.

**Audit-census registration discipline.** Every new admin mutation MUST land its census registration in the SAME change as the mutation itself: an `ADMIN_ACTION_CENSUS` row (`test/workflows/admin/audit-completeness.catalog.ts`), a `USER_LIFECYCLE_LEG` entry, an execution runner, a denial-matrix attempt, and the leg-length pins (`test/workflows/admin/audit-completeness.journey.test.ts`). The bijection drift test (`backend/db/test/logic/audit/audit-census-drift.test.ts`) fails loudly in BOTH directions — a wired mutation missing from the census, and a census row with no wired mutation.

> **Gotcha (recurring):** any new `users` column MUST be added to BOTH full-row raw-SQL SELECT lists in `UserRepository` (`findByEmail` + `findById`) — the production no-transaction read path used by the GraphQL context factory and login — or those reads silently yield `undefined` for the column while still type-checking. The transactional branches are immune (full Drizzle row).

### 2.7 Forced Password-Reset Gate (Server-Authoritative Fence)

`users.must_change_password` (server default `false`, no backfill) turns a credential rotation into a FORCED reset. Three enforcement layers exist; exactly ONE is authoritative — the DB row, re-read per request. No layer trusts a token claim or client state.

1. **Apollo operation-guard (the enforcement boundary).** `backend/graphql/passwordChangeGate.ts`, registered in `app/api/graphql/apollo-server.ts`'s plugins array. It fires at `didResolveOperation` — after parse/validation, BEFORE any resolver — so a denied operation performs zero writes and zero audit rows. It reads `ctx.user.mustChangePassword` from the context factory's existing per-request `UserRepository.findById` row: DB truth, NOT a JWT claim, ZERO new queries. `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` is a frozen, closed, case-sensitive 7-name allowlist — `me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken` — the flagged caller's self-service escape hatches (`adminSetUserPassword` is deliberately NOT exempt). `extractOperationRootFieldNames` flattens inline fragments and named fragment spreads (including transitive spreads, cycle-guarded), so alias-laundering and root-level-spread smuggling cannot bypass. Deny is PER OPERATION: one non-exempt root field denies the whole operation. The denial is a constant `ForbiddenError`-family carrier — `PASSWORD_CHANGE_REQUIRED`, an HTTP-200 head, a localized message (`errorsTranslations.passwordChangeRequired` via the per-request locale), and no field/operation/path disclosure.
2. **SSR fence.** `frontend/lib/auth/withPageAuth.ts` gains `allowMustChangePassword?: boolean` (fence is the DEFAULT — opt-in is the exemption) and `shouldRedirectToChangePassword(user, allowMustChangePassword)`; the fence branch sits AFTER the authentication check and BEFORE the role check, riding the SAME cached `getServerUserContext()` row (no extra round-trip). The ONLY sanctioned `allowMustChangePassword: true` site is `app/change-password/page.tsx` — a TOP-LEVEL route outside `(dashboard)`, which is what makes loop-free fencing possible for the SSR fence, the client mirror, and the login redirect.
3. **Client mirrors (UX only, non-authoritative).** `DashboardLayout`'s structural flag reader redirects flagged callers after the session settles; the Apollo error-link `PASSWORD_CHANGE_REQUIRED` row carries `redirectTo` honored at most once per session with a loop guard (`frontend/providers/apollo/utils/error-surface.ts`); and the change-password success path merges the mutation result into the session snapshot (`updateSessionUser` — `frontend/context/AuthContext.ts`) BEFORE the delayed hand-off so the freshly-mounted mirror reads the cleared flag. Both server boundaries are client-state-blind: a spoofed client flag buys nothing but client chrome.

**Flag lifecycle invariants:** `login` NEVER writes the flag (it survives login); the gate, the SSR fence, and the mirrors NEVER write it; exactly two writes can change it — the admin direct-change (the admin's chosen boolean, same tx as the credential) and `changeMyPassword` (hard-coded `false`).

**Route single-sourcing:** `CHANGE_PASSWORD_PAGE_PATH` (`frontend/lib/auth/changePasswordRoute.ts`) is the ONLY occurrence of the `"/change-password"` literal in the repo. Consumers: the page's `redirectTo`, the SSR fence target, the `DashboardLayout` mirror, the error-link row payload, and the redirect consumer's loop guard. The page is NOT a nav item — it is a forced gate reached by redirect.

---

## 3. Rules

- **REQ-017 (Soft-Delete via Guarded Update):** single guarded `UPDATE` with NULL-safe inverse-state guard + `RETURNING`; NO SELECT-then-UPDATE; nonexistent id → `USER_NOT_FOUND`; already-deleted → `USER_ALREADY_DELETED`. Touches NO child table, financial record, session, evaluation, or balance (INV-U1/INV-U5).
- **REQ-018 (Reactivation — Symmetric Guard):** symmetric guarded update; `USER_NOT_FOUND` for unknown ids; `USER_NOT_DELETED` for active users.
- **REQ-019 (Self-Protection):** `id === actorId` on a soft-delete call → `USER_SELF_DEACTIVATION_FORBIDDEN` BEFORE any write.
- **REQ-020 (Audit Emission on Every Mutation):** create / update / soft-delete / reactivate commits → ONE `audit_logs` row via `AuditLogWriteContract` inside the SAME `tx`. `actorId = ctx.user.id`; `actionType = AuditActionType.Create\|Update\|Delete\|Reactivate`; `entityType = "user"`; `entityId` = target id; `details` = capped, PII-minimal JSON (changed field NAMES for updates — NEVER values; NEVER `passwordHash`; NEVER email pre/post pairs).
- **REQ-021 (Governance Visibility Is Read-Only Here):** detail + directory rows include `suspended` / `isBlocked` / `deletedAt` / `suspendedAt` / `blockedAt` / `suspendedPeriodDays` as PURE READS; this ticket ships NO mutation for them (the account-governance surface owns them). The Pothos mutation surface is grep-verifiably absent of `suspendUser` / `blockUser` / `deleteUser` / `hardDelete*`.
- **REQ-030 (BFLA — Admin-Only Gate on Every Operation):** `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` on ALL five operations. The explicit `$all` conjunction is load-bearing (D10) — plain map = ANY semantics = wrong (any authenticated caller would pass). Anonymous → `UNAUTHORIZED` (401); authenticated non-admin → `FORBIDDEN` (403) — both BEFORE the resolver body executes.
- **REQ-032 (BOLA / IDOR — Oracle-Aware Admin Scope):** `actorId` is always `ctx.user.id` (never input); `targetId` is a legitimate admin-controlled parameter. On an admin-gated surface, `USER_NOT_FOUND` (instead of `FORBIDDEN`) is acceptable because user existence is NOT sensitive to a full-governance admin.
- **REQ-035 (Cross-Role Containment):** create / update / delete executes ZERO writes to `applicants.status` / `verification_attempts` / `cooldown_until`, teacher certification flags, student balances, subscription rows, or parent links (unless the operation is the explicit creation of a NEW user — which produces only its own fresh child row).
- **REQ-040 (Creation Atomicity):** `users` + child + audit row commit or roll back atomically inside ONE `withTransaction` block; forced child-insert failure leaves ZERO residual rows in `users`, the child table, and `audit_logs` (rollback proof).
- **REQ-014 (Generic Admin User Creation):** `role ∈ {student, teacher, parent}` only. Student → `students` row (zeroed balances + unique handshake code, bounded retry on 23505); teacher → `applicants` row only (status `pending`, `verification_attempts=0`, `cooldown_until=NULL`) — NEVER a `teacher` row (B.7 / INV-TV1); parent → `parents` row. NO subscription, payment, teacher assignment, or parent-link is created by this operation (direct student onboarding owns that). 23505 on `users.email` → `ConflictError` via cause-chain traversal.
- **REQ-015 (BFLA — Admin-Role Creation Blocked Twice):** the `RegisterPublicRole` SDL enum structurally excludes `admin` (schema layer — first line of defense, rejects `role: Admin` GraphQL literal at parse time as `GRAPHQL_VALIDATION_FAILED`); the service re-guards with `assertActorAdmin` + a runtime role-pre-guard (`ADMIN_ROLE_CREATION_FORBIDDEN` — second line of defense against transport-tamper that bypasses the schema validator).
- **REQ-052 (Audit + Log Content Hygiene):** `logger.logDomainError` for expected rejections with structured context `{ code, entity: "user", entityId }`; `logger.error` for unexpected failures; NEVER `console.*`; NO password / token / plaintext-PII payloads; `audit_logs.details` ≤2000 chars; truncation NEVER fails the mutation.
- **REQ-060 (GraphQL Surface — Exact Contract):** five operations — `adminUsers(filters, page, pageSize): AdminUserPage!`, `adminUserDetail(id): AdminUserDetail!`, `adminCreateUser(input): AdminUserDetail!`, `adminUpdateUser(id, input): AdminUserDetail!`, `adminSetUserDeleted(id, deleted): AdminUserDetail!`. `passwordHash` structurally absent from every output shape (`AdminUserListItem` + `AdminUserDetail` + the four snapshot objects).
- **REQ-062 (authScope Declaration):** every operation carries the exact REQ-030 scope map; no operation is public; the public-operations allowlist (`backend/lib/gateway/public-operations.ts`) remains untouched (1:1 coverage gate).
- **REQ-070 (Coverage Target):** all NEW service / repository code reaches 100% statement + branch coverage — every filter branch, both guarded-update zero-row paths, every validation guard.
- **REQ-074 (Mutation Matrix + Fixture Immutability):** create produces exactly `users` + child + audit rows per role and NO `teacher` row for teacher-role creation (B.7); duplicate email → CONFLICT; whitelist-only update (smuggled `role` / `email` / `passwordHash` / governance / `parentId` ignored); guarded delete/reactivate state machine incl. both conflict branches + self-protection; audit rows appended once per mutation with `actorId = admin`; pre-existing fixtures (a second student with balances / subscription / applicant record) byte-identical after every admin operation (INV-U1/INV-U5/REQ-035).
- **REQ-079 (Baseline & Quality Gates):** `bun tsgo` / `biome:check` / lint counts equal the REQ-001 baseline plus ZERO new errors; every created/modified file passes `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exit 0; codegen no-unrelated-drift rule holds.
- **Credential write home (single):** every production password write flows through `UserRepository.updatePassword` (§2.6) — admin 4-arg unfenced, self 5-arg fenced. The self path's `expectedCurrentHash` fence and the in-tx deleted-row re-check are part of the contract, not optional polish; both paths hash BEFORE the tx and re-check the written row INSIDE it.
- **Flag-clearing discipline:** `changeMyPassword` is the only self-service clear of `mustChangePassword` (hard-coded `false`); the admin direct-change persists the admin's chosen boolean in the same transaction as the credential; no other code path may write the flag (login never writes it; the gate/fence/mirrors never write it).
- **Server-authoritative forced gate:** the operation-guard deny decision reads the DB-backed per-request context row only; the closed 7-name exempt allowlist and the per-operation deny semantics are contract, pinned by the gate suite (closedness probes, fragment/alias flattening, real-listener glue, registration scan).
- **Constant-shape credential denials:** absent-vs-deleted folds on the admin path (`USER_NOT_FOUND`), vanished/deleted/wrong-current/fenced-miss folds on the self path (`CURRENT_PASSWORD_INVALID`) — never split into distinguishable error shapes.
- **Closed credential inputs:** password data travels ONLY through `AdminSetUserPasswordInput` / `ChangeMyPasswordInput` (exactly two members each; no identity member on the self input). The five-field profile-patch whitelist stays byte-stable — never extended with credential members.
- **Audit + census:** the admin credential rotation emits exactly ONE in-tx `Update` row whose details name fields + flag only (NEVER a credential); self-service emits zero audit rows; any new admin mutation registers its census row + leg entry + runner + denial attempt + pins in the same change (§2.6).
- **i18n parity for credential copy:** flat/ICU-only leaves under `adminUsers` (the parity walker rejects function leaves), pinned under BOTH locales; server denials localize via the `errorsTranslations` handle; existing `authTranslations` validation keys are reused, not duplicated.

---

## 4. What NOT to Do

- **DO NOT fork a second LIKE/ILIKE sanitizer.** `escapeLikeWildcards` at `backend/lib/db/escape-like-wildcards.ts` is the SOLE canonical sanitizer. Future admin search surfaces MUST import it — never re-implement. The service escapes + wraps `%…%`; the repo binds the final pattern directly to `ilike(column, pattern)` — never re-escape or re-wrap. A second sanitizer would diverge over time and re-open the wildcard-injection surface.
- **DO NOT use a SELECT-then-UPDATE pattern for soft-delete/reactivate.** Two concurrent deletes reading `is_deleted=false` both would "succeed" — INV-U4 / REQ-043(a) violated. Use the single guarded `UPDATE … WHERE id=? AND <null-safe inverse-state guard> … RETURNING *` pattern (D3).
- **DO NOT use a naive `= <bool>` predicate on the governance columns.** Three-valued SQL logic: `NULL IS NOT FALSE`. A legacy NULL row would be un-deletable forever (silent bug). Use `is_deleted=false OR is_deleted IS NULL` (D4).
- **DO NOT copy-paste the `USER_NOT_FOUND` oracle ruling to non-admin surfaces.** On this admin-gated surface, `USER_NOT_FOUND` (instead of `FORBIDDEN`) for an unknown id is acceptable because user existence is non-sensitive to a full-governance admin. This ruling is INVERTED on non-admin surfaces — e.g. `myApplicantProfile` returns `null` (no-oracle) for a certified teacher who never applied (per `docs/teachers/applicant-lifecycle.md` §3); the applicant surface deliberately does NOT confirm whether a given id exists. **Copying this admin-surface oracle to a non-admin surface would re-introduce a BOLA oracle leak.** (D11)
- **DO NOT mint a `teacher` row on admin user creation with `role=teacher`.** The admin create path mints an `applicants` row (`status='pending'`, `verification_attempts=0`, `cooldown_until=NULL`) — NEVER a `teacher` row. Certification belongs to the verification loop / cold-start certification surface (INV-TV1 — no certification shortcut through this surface).
- **DO NOT expose `createAdminUser` via GraphQL.** Admin accounts are NOT publicly registrable; the public registration surface `registerUser` uses the `RegisterPublicRole` enum that structurally excludes `Admin`. Admin-account provisioning is service-only (grep-verifiably unwired to GraphQL) — D6 double block.
- **DO NOT spread `{ ...input }` into the create / update payload.** `createUser` and `updateUser` build their payloads field-by-field (BOPLA — `buildCreateUserInsert` / `buildUpdatePatch`). Transport-tampered extra fields are ignored by construction. Server-controlled fields (`id`, governance flags, timestamps, balances, `passwordHash`, `parentId`, handshake code) are structurally unreachable through the input whitelist.
- **DO NOT write audit rows outside the caller's transaction.** Post-commit audit side effects lose the trail if the process crashes between write and audit. In-tx via `AuditService.createAuditLog(contract, tx)` — D7.
- **DO NOT write audit rows on denials.** Denial-no-audit rule (JR-C-1). The actor check runs BEFORE any `withTransaction` opens. A denial pollutes the append-only trail with noise; the audit trail is reserved for actual mutations.
- **DO NOT log contact-PII, credentials, or token values.** `audit_logs.details` carries field NAMES only (for updates — `changedFields: ["fullName", "phone", ...]` — NEVER values). `logger.logDomainError` payloads carry `{ code, entity, entityId }` — ids + codes only.
- **DO NOT touch the registration write path.** `registerUser` is pre-existing and permanently test-locked. The admin create path composes the SAME registration primitives (`UserRepository.create`, role-child repos, handshake retry, 23505→`ConflictError` cause-chain) inside `withTransaction(outerTx)` — never forks a parallel registration pipeline. Two registration truths would diverge the INV-U/B invariants.
- **DO NOT re-implement trial grant logic in the admin create path.** Per REQ-014 conditional path rule: when the trial lane (`StudentTrialService.grantFreeTrial`) lands and migrates `students` to add the trial columns, a follow-up amendment to this surface wires the conditional call into the student-creation flow. Until then, the trial lane is dormant — NEVER re-implemented.
- **DO NOT touch `public-operations.ts`.** The public-operations allowlist is the default-deny gate (REQ-062). The admin user-management operations are NOT public — they carry `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }`.
- **DO NOT touch `docs/specs/state-machine-invariants.md` or `docs/specs/open-decisions-and-gaps.md` numbering.** This document binds to A.5/A.7, B.6/B.7, INV-U1..U5, INV-TV1 by REFERENCE — it does not renumber, edit, or add to those files. Any future gap discovered by a downstream change MUST be recorded in that change's own doc change section, never by renumbering the invariant file.
- **DO NOT fork a second password-write path.** No `AdminUserRepository` password method, no bespoke `UPDATE users SET password_hash` outside `UserRepository.updatePassword`, no service-level SQL. A second writer would bypass the fence, the in-tx deleted-row guard, and the single-audit contract (§2.6).
- **DO NOT clear or flip `mustChangePassword` anywhere except the two sanctioned writes.** A login-time auto-clear would defeat the forced reset; a gate/fence-side write would make the UX layer authoritative; a profile-patch smuggle would bypass the credential audit semantics.
- **DO NOT mint the flag into a token or trust a client flag.** The gate re-reads DB truth per request; JWTs stay `{sub, role, type}`; client mirrors are UX only and both server boundaries are client-state-blind.
- **DO NOT widen the credential input whitelists.** No third member on `AdminSetUserPasswordInput` / `ChangeMyPasswordInput`, no identity member on the self input, no credential members on the profile-patch input. The closed shapes are pinned at the SDL layer.
- **DO NOT put credentials (plaintext or hash) in logs, audit details, or error payloads.** Denial logs carry `{ code, entity, entityId }`; audit details carry field names + the flag value; `passwordHash` stays structurally absent from every output shape.
- **DO NOT add admin operations to the forced-reset exempt allowlist.** The 7-name set is closed and frozen; widening it is a contract change that must update the gate suite's closed-set pins. `adminSetUserPassword` stays gated so a flagged caller cannot rotate others' credentials while fenced.
- **DO NOT ship a new admin mutation without its census registration** (catalog row + leg entry + runner + denial attempt + length pins) — the drift bijection fails the suite in both directions by design.
- **DO NOT add function leaves to `AdminUsersLabels` or duplicate existing validation copy.** The parity walker rejects function leaves; reuse `authTranslations.passwordRequired` / `passwordTooShort`.
- **DO NOT re-spell the forced-reset route literal.** Import `CHANGE_PASSWORD_PAGE_PATH` from `frontend/lib/auth/changePasswordRoute.ts` (page redirect, SSR fence, client mirror, error-link payload, loop guard — all single-sourced); never move the page under `(dashboard)` or add it to navigation.
- **DO NOT forget the raw-SQL column lists when adding `users` columns.** New columns MUST be added to BOTH full-row raw-SQL SELECT lists in `UserRepository` (`findByEmail` + `findById`) — the recurring silent-`undefined` trap on the production no-tx read path (§2.6 gotcha).

---

## 5. Rollout Summary

This surface ships:

- `backend/types/admin/admin-user.types.ts` — canonical types (5 return-shape interfaces + 3 input shapes + 1 repo-internal patch type + the `AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">` alias).
- `backend/db/repo/admin/admin-user.repository.ts` — directory + count + detail + `updateProfileFields` + `setDeletedOnce` + `existsById`. The `SAFE_USER_SELECT` column-pick shape structurally omits `passwordHash` at the Drizzle layer.
- `backend/services/admin/user-management.service.ts` — 5 methods: `listDirectory`, `getUserDetail`, `createUser`, `updateUser`, `setUserDeleted`. All accept `outerTx?: DBTransaction` last; propagate `tx` to every call; emit one in-tx audit row per successful mutation.
- `backend/services/admin/audit.service.ts` — `createAuditLog(contract, tx)` — composition-only, append-only, ≤2000 chars truncated before insert (D5 resolved).
- `backend/lib/db/with-transaction.ts` — `withTransaction(outerTx, fn)` — SAVEPOINT-aware under test `outerTx`; top-level `db.transaction` in production (D5 dependency, resolved).
- `backend/lib/db/escape-like-wildcards.ts` — `escapeLikeWildcards(input)` — single canonical LIKE/ILIKE sanitizer (D6 resolved).
- `backend/graphql/pothos/admin/admin-user.pothos.ts` — 6 objects (`AdminUserListItem`, `AdminUserPage`, `AdminUserDetail`, `AdminTeacherSnapshot`, `AdminStudentSnapshot`, `AdminParentSnapshot`) + 3 input types (`AdminUserFiltersInput`, `AdminCreateUserInput`, `AdminUpdateUserInput`). `id` exposed FIRST on every object (Apollo normalization). `applicant` slot reuses the applicant-lifecycle `ApplicantProfilePothosObject` (composition-only).
- `backend/graphql/query/admin/admin-users.query.ts` + `backend/graphql/mutation/admin/admin-users.mutation.ts` — 5 root fields with the exact `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` map (D10). Thin resolvers — no business logic, no try/catch; service `DomainError` subclasses propagate with `extensions.code` + boundary masking.
- `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` — 5 documents (1 query, 1 detail query, 3 mutations). `id` selected FIRST in every fragment. NO `passwordHash` selected anywhere. `useQuery` / `useMutation` only — NO `useLazyQuery`.
- `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx` — directory client surface (filter bar + paginated table + mobile stacked cards + create / edit / delete-reactivate confirm dialogs). MUI v9 `sx`-only discipline; palette tokens; `*Outlined` icons; ≥44px touch targets on Submit / Confirm / Refresh / Create buttons; debounced search.
- `frontend/views/admin/users/detail/AdminUserDetailContainer.tsx` — detail client surface (profile card + governance card + role-child snapshot cards + back-to-directory CTA + `USER_NOT_FOUND` not-found section).
- `app/(dashboard)/admin/users/page.tsx` + `app/(dashboard)/admin/users/[id]/page.tsx` — Server Components with `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` + locale-aware `generateMetadata`.

The credential-management vertical (admin rotation + forced reset + self-service change) ships on top of the surface above:

- `backend/db/schema/users/users.ts` — `users.must_change_password` (`boolean`, `notNull`, server default `false`; no backfill — existing rows read `false`).
- `backend/db/repo/users/user.repository.ts` — `UserRepository.updatePassword` (the single password write home; required `tx`; optional `expectedCurrentHash` fence) + the column added to BOTH full-row raw-SQL SELECT lists.
- `backend/services/admin/user-management.service.ts` + `user-management.helpers.ts` — `setUserPassword` + the shared `validatePasswordPolicy` policy helper (`MIN_PASSWORD_LENGTH = 8`).
- `backend/services/auth/auth.service.ts` — `changeMyPassword` (identity load → constant-shape denials → no-op guard → hash-before-tx → fenced write → in-tx deleted-row guard → password-stripped return).
- `backend/types/admin/admin-user.types.ts` (`AdminSetUserPasswordSubmitInput`) + `backend/types/users/auth.types.ts` (`ChangeMyPasswordSubmitInput`).
- `backend/graphql/pothos/admin/admin-user.pothos.ts` (`AdminSetUserPasswordInput`, `AdminUserDetail.mustChangePassword: Boolean!`) + `backend/graphql/pothos/users/user.pothos.ts` (`ChangeMyPasswordInput`, `User.mustChangePassword: Boolean!`).
- `backend/graphql/mutation/admin/admin-users.mutation.ts` (`adminSetUserPassword`) + `backend/graphql/mutation/user.mutation.ts` (`changeMyPassword`) — thin resolvers, BOPLA property mapping.
- `backend/graphql/passwordChangeGate.ts` + `app/api/graphql/apollo-server.ts` — the operation-guard plugin (closed allowlist, per-operation deny, DB truth) + its registration.
- `frontend/lib/auth/changePasswordRoute.ts` (`CHANGE_PASSWORD_PAGE_PATH` single-sourcing) + `frontend/lib/auth/withPageAuth.ts` (`allowMustChangePassword` SSR fence) + `frontend/views/dashboard/layout/DashboardLayout.tsx` (client mirror).
- `frontend/providers/apollo/error-link.map.ts` + `frontend/providers/apollo/utils/error-surface.ts` — the `PASSWORD_CHANGE_REQUIRED` row + the once-per-session, loop-guarded `redirectTo` consumer.
- `frontend/context/AuthContext.ts` + `frontend/providers/apollo/AuthProvider.tsx` — `updateSessionUser` (server-authoritative session-snapshot merge for the change-password hand-off).
- `app/change-password/page.tsx` + `frontend/views/auth/change-password/**` — the top-level forced-reset page (the ONLY `allowMustChangePassword: true` site) + form/hook (`projectServerFieldErrors` folds the `password` policy tag onto the new-password input).
- `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx` + `ChangeUserPasswordFormFields.tsx` — the shared credential dialog mounted from BOTH the directory kebab and the detail hero (hidden for soft-deleted targets).
- `frontend/graphql/sharedDocuments/auth/auth.documents.ts` + `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` — `changeMyPasswordMutationDocument` / `adminSetUserPasswordMutationDocument`; `mustChangePassword` selected by `ADMIN_USER_DETAIL_FIELDS`, `me`, and `login`.
- `shared/locale/**` — the `adminUsers` credential leaves (flat strings), the `auth.changePassword` block, and the three `errors` denial keys — EN/AR parity.

Credential-surface test locks (all GREEN): `test/workflows/admin/admin-password-reset.journey.test.ts` (7 — the full forced-reset arc incl. flagged-gate + non-admin denial legs), `backend/graphql/test/password-change-gate.test.ts` (38 — allowlist closedness, extraction flattening, per-operation deny, real-listener glue + registration scan), `frontend/lib/auth/withPageAuth.test.ts` (4 — SSR fence branch matrix), `backend/services/admin/user-management.service.test.ts` (78 — policy/audit/deleted-target legs), `backend/db/test/logic/users/user.repository.test.ts` (16 — fence match/re-arm/stale), `backend/db/test/logic/auth/auth.service.test.ts` (17 — deleted-caller, fence race, mid-flight soft-delete), `backend/graphql/test/schema-surface.test.ts` (104 — exact SDL pins for both credential inputs + scopes), `frontend/graphql/test/auth/auth.test.ts` (14) + `frontend/graphql/test/admin/admin-users.integration.test.ts` (49 — wire tiers with deep `passwordHash` walks), `backend/db/test/logic/audit/audit-census-drift.test.ts` (19) + `test/workflows/admin/audit-completeness.journey.test.ts` (20 — census bijection + executed leg), `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` (26 — document structural lock), `shared/locale/adminUsers-namespace.parity.test.ts` (85) + `shared/locale/errors-namespace.parity.test.ts` (58), `frontend/providers/apollo/error-link.map.test.ts` (45 — redirect rows + guard branches).

Tests: 147 tests / ~900 `expect()` calls across 6 files — repo logic (45), service (47), chaos (8), GraphQL integration (32 parameterized × 4 tiers), Journey A lifecycle (7), Journey B+C denials (8). All GREEN. Schema/migration drift = empty (`git diff backend/db/schema/** backend/db/migration/**` empty). `bun tsgo` exit 0; `bun biome:check` 0 errors / 8 pre-existing warnings (intentional test-file scan oracle strings). Sub-loop exit 0 on every new file.

---

## 6. Scope Split Record

This surface ships the **identity core + audit-write half** of Workflow 05. The other halves are owned by separate follow-on tickets (import-by-reference — never fork this surface):

| Half | Owner | Imports from this surface |
|---|---|---|
| Admin user CRUD (directory / detail / create / patch / soft-delete / reactivate) + audit-write contract | This ticket | — |
| Cold-start bootstrapping (`is_approved=true` / `is_evaluator=true` writes on `teacher` row) | — | The `applicants` row minted by this surface's create-teacher path (D4 deferred-item); the audit-write contract |
| Suspend / block governance windows (`suspended`, `suspended_period_days`, `is_blocked` mutations) | ✅ shipped — see `docs/admin/account-governance.md` | The `users` governance columns READ by the directory + detail (REQ-021 — pure reads here); the in-tx audit-write contract |
| Direct student onboarding (subscription creation + payment recording + parent-link `students.parent_id` write) | — | The `students` row minted by this surface's create-student path (zeroed balances + handshake); the in-tx audit-write contract |
| Audit-trail browsing UI (read-back of `audit_logs` rows) | — | The `AuditService.createAuditLog` writer + `AuditLogWriteContract` (D5 resolved); imports by reference — never forks a second writer |
| Session governance (reschedule / cancel / reassign sessions) | — | The `users` directory + detail for actor resolution; the audit-write contract |
| Financial auditing (payments / wallet / payouts) | — | The `users` directory + detail; the audit-write contract |
| Plan CRUD (create / edit / activate / deactivate plans) | — | The audit-write contract pattern (precedent); the `users` directory for admin-browsing context |
| Cold-start certification (`is_approved` write on `teacher` row) | — | The `applicants` row minted by this surface's create-teacher path; never forks a `teacher`-row-creation path |

> **Cold-start certification SHIPPED:** canonical reference — `docs/admin/cold-start-certification.md`.

### Consumer obligations for the scope-split tickets

- **Import-by-reference, never fork.** The audit-write contract (`AuditLogWriteContract` + `AuditService.createAuditLog(contract, tx)`) is the SINGLE canonical writer. A second writer would diverge the `actorId` source-of-truth and re-open the denial-no-audit rule surface. The `escapeLikeWildcards` utility is the SINGLE canonical LIKE/ILIKE sanitizer. The `withTransaction` helper is the SINGLE canonical transaction-context helper. The `UserRepository.findById` / `AdminUserRepository.*` methods are the canonical reads.
- **Honor the in-tx audit-emission contract.** Every mutation in the consumer ticket MUST append its audit row inside the SAME `tx` that performs the mutation (D7). Denial paths MUST emit ZERO audit rows (JR-C-1).
- **Honor the `actorId = ctx.user.id` rule.** Never source `actorId` from input. The admin `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` gate is the precondition; the actor identity is the verified session user.
- **Honor the `passwordHash` never-touch discipline.** The `AdminUserSafeSelect = Omit<UserSelectType, "passwordHash">` alias is enforced at both the TS-type layer AND the Drizzle column-pick layer. Consumer tickets MUST NOT project `passwordHash` to any admin surface — the GraphQL schema rejects any attempt with `GRAPHQL_VALIDATION_FAILED` (defense in depth).
- **Honor the `USER_NOT_FOUND` oracle ruling scope.** The ruling is admin-surface-only. Consumer tickets with non-admin surfaces (e.g. direct student onboarding if it ever exposes a parent-facing surface) MUST invert the ruling to `null` (no-oracle) for the non-admin surface (per the applicant-lifecycle precedent).
- **Honor the role-child projection rules.** Consumer tickets that extend the directory or detail projection MUST keep the single-`users`-directory + shared-PK LEFT JOIN + scalar-subselect discipline. A JOIN that fans out the parent row into N children violates the "one row per user" directory contract.

---

## 7. Related Documents

- Requirements & invariants: `docs/specs/functional-requirements.md`, `docs/specs/state-machine-invariants.md` (§6 Student Account Lifecycle) — **read-only for this surface**.
- Recorded decisions: `docs/specs/open-decisions-and-gaps.md` (A.5 audit_logs, A.7 governance on `users`, B.6 failed-applicant home, B.7 teacher-row timing).
- Workflow: `docs/workflows/05-admin-governance-override.md` (this surface implements §1 "Full CRUD Visibility & Control" + §5.1 Soft Delete Rules + §7 "Audit Trail" writer-side; cold-start / direct onboarding / suspend-block / session / financials / audit-browsing halves owned by the scope-split tickets).
- Error contract: `docs/graphql/domain-error-extensions-code.md` (SCREAMING_SNAKE_CASE; `NotFoundError("USER", …)` auto-generates `USER_NOT_FOUND`).
- Error handling: `docs/graphql/error-handling-contract.md` (masking/redaction pipeline; correlation bounds; per-guarantee test matrix).
- Public-operations default-deny gate: `docs/graphql/api-gateway-and-routing.md` (REQ-062 — admin operations NOT on the public allowlist).
- authScopes / RBAC: `docs/auth/jwt-authentication-service.md` (§3 RBAC consumption guide — role scope OR semantics, 401-vs-403 exclusivity, role↔certification boundary).
- Pothos scope-auth `$all` conjunction: `docs/teachers/applicant-lifecycle.md` §3 (the verified pattern — D10).
- Registration canonical contract: `docs/auth/user-registration.md` (role→child mapping; handshake generation; atomicity pattern; BOPLA/BFLA defenses; 23505→ConflictError translation — this surface composes the same primitives).
- Self-service credential path: `docs/auth/user-registration.md` (JWT auth flow — login/`me`/refresh) — `changeMyPassword` (§2.6) is the self-service credential rotation on the same `hashPassword`/`comparePassword` primitives and the ONLY self-service clear of the forced-reset flag (§2.7).
- Teacher applicant lifecycle: `docs/teachers/applicant-lifecycle.md` (the `applicants` state machine; the INVERTED `USER_NOT_FOUND` oracle ruling precedent — admin surface returns `USER_NOT_FOUND`, applicant surface returns `null`).
- Idempotency ruling: `docs/IDEMPOTENCY.md` (admin user-management ops are NOT in the mandated Student/Invoice/Class/Payment idempotency-key set; natural unique-key protection via `users.email` index + guarded state updates; in-flight UI disable mitigation).
- Drizzle prepared-statement rules: `docs/drizzle/prepared-statements.md` (directory reads run through the repo `queryDb(tx)` convention; directory filters are dynamic AND chains — no `inArray` — so plain parameterized queries).
- Drizzle Neon HTTP client: `docs/drizzle/neon-http-client.md` (provider-agnostic stateless query executor; admin reads branch on `tx` vs global `db` per the repo convention).
- DataLoader batching forward contract: `docs/graphql/dataloader-batching.md` (directory list fields are projection-shaped — single joined read; any future per-parent resolution on `AdminUserDetail` MUST use `t.loadable()` + batch repos).
- SSR page auth wrapper: `docs/app/with-page-auth.md` (the `withPageAuth({ roles, redirectTo })` pattern used by `/admin/users` + `/admin/users/[id]`).
- Cross-stream contract types: `docs/backend/cross-stream-contracts.md` (the `AuditLogWriteContract` + `ActorContextRef` composition-only rule; forbidden-field registry).
- Types consolidation: `backend/AGENTS.md` §2 (Type Definitions — the rule that admin types live in `backend/types/admin/`, NOT in service-layer `.types.ts` files).
- Platform analytics consumer: the platform-analytics read model reuses `AdminUserRepository.getStats` verbatim for its users section (the ten directory counters, consumed unchanged — see `docs/admin/platform-analytics.md`).
- Authoritative implementations: `backend/types/admin/admin-user.types.ts`, `backend/db/repo/admin/admin-user.repository.ts`, `backend/services/admin/user-management.service.ts`, `backend/services/admin/audit.service.ts`, `backend/lib/db/with-transaction.ts`, `backend/lib/db/escape-like-wildcards.ts`, `backend/graphql/pothos/admin/admin-user.pothos.ts`, `backend/graphql/query/admin/admin-users.query.ts`, `backend/graphql/mutation/admin/admin-users.mutation.ts`, `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`, `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx`, `frontend/views/admin/users/detail/AdminUserDetailContainer.tsx`, `app/(dashboard)/admin/users/page.tsx`, `app/(dashboard)/admin/users/[id]/page.tsx` — plus the credential vertical: `backend/db/repo/users/user.repository.ts` (`UserRepository.updatePassword`), `backend/services/auth/auth.service.ts` (`changeMyPassword`), `backend/graphql/passwordChangeGate.ts`, `backend/graphql/mutation/user.mutation.ts`, `backend/graphql/pothos/users/user.pothos.ts`, `frontend/lib/auth/changePasswordRoute.ts`, `frontend/lib/auth/withPageAuth.ts`, `frontend/views/dashboard/layout/DashboardLayout.tsx`, `frontend/providers/apollo/error-link.map.ts`, `frontend/providers/apollo/utils/error-surface.ts`, `frontend/views/auth/change-password/useChangePasswordForm.ts`, `app/change-password/page.tsx`, `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx`.
- Test locks: `backend/db/test/logic/admin/admin-user.repository.test.ts` (45 tests — repo 4-tier), `backend/services/admin/user-management.service.test.ts` (47 tests — service 4-tier), `backend/services/admin/user-management.chaos.test.ts` (8 tests — chaos + fuzz), `frontend/graphql/test/admin/admin-users.integration.test.ts` (32 tests — GraphQL permission-matrix integration), `test/workflows/admin/admin-user-lifecycle.journey.test.ts` (7 tests — Journey A), `test/workflows/admin/admin-user-denials.journey.test.ts` (8 tests — Journey B + C) — plus the credential-vertical locks enumerated in §5 (journey, gate contract, SSR fence, policy/audit service legs, fence + race legs, SDL pins, census bijection, document lock, parity belts).
