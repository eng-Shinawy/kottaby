# Requirements — Admin Change User Password (with Reset-on-Login)

> **Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Ticket:** GitHub issue `#228 — Admin Can't change users password from the dashboard` (issue body: `/admin/users/` · Change Password, with option for reset on login — https://github.com/kottaby/kottaby/issues/228). NOT a `docs/planning/TICKETS.md` milestone block; milestone derived from the owning shipped ticket `Admin CRUD: Users, Teachers, Students, Parents` (`docs/planning/TICKETS.md:2221-2266` → `| **Milestone** | 3 |` at `:2225`).
> **Specs of record:** this file · **Design:** `plan.md` (same directory) · **Tasks:** `tasks.md` (same directory) · **Ledger:** `deferred-items.md` (same directory) · **Evidence pack:** `outcome/00-research-evidence-pack.md` (same directory)

## Document Information

| Field | Value |
|---|---|
| Feature Name | Admin Change User Password (with Reset-on-Login) |
| Milestone | M3 (`milestone_3_parent_portal_admin_governance`) |
| Version / Date | 1.0 · 2026-09-30 |
| Ticket type | GitHub issue #228 (OPEN) — no TICKETS.md block exists for it |
| Owning domain (shipped) | Admin user management — `docs/admin/user-management.md:119` (REQ-060 surface: `adminUsers` / `adminUserDetail` / `adminCreateUser` / `adminUpdateUser` / `adminSetUserDeleted`; **no password op**), archived plan `ai/finished_plans/milestone_3_parent_portal_admin_governance/admin-crud-users-teachers-students-paren/` |
| Prior-art exclusions | `admin-crud-users…/specs.md:30` lists "Email change and password reset flows" as an explicit non-goal of the shipped CRUD ticket — #228 is the follow-on that owns it |
| Live surfaces consumed | `backend/services/admin/user-management.service.ts` · `backend/graphql/mutation/admin/admin-users.mutation.ts` · `backend/lib/auth/password.ts` · `backend/services/auth/auth.service.ts` · `frontend/views/admin/users/**` · `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` |
| Absent today (net-new work) | `users.must_change_password` column; any password write path (repo/service/mutation); any force-reset flag; any `changeMyPassword` self-service path; any password/reset i18n keys; any `changePassword` enforcement |

## Introduction

An academy admin who manages users from `/admin/users/` (and the user detail page `/admin/users/[id]`) currently has no way to set or reset a user's password: the admin CRUD ticket that shipped the user directory deliberately excluded password reset (`admin-crud-users…/specs.md:30`), `AdminUpdateUserInput` is a closed five-field profile whitelist (`backend/graphql/pothos/admin/admin-user.pothos.ts:318-334`), the `AdminUserRepository` has no password writer, and no `changePassword`/`resetPassword` GraphQL field exists anywhere. The admin `CreateUserDialog` even advertises a force-change-on-first-login that does not exist: `createDialog.passwordHelper` tells the admin *"Set an initial password; the user must change it on first login."* (`shared/locale/en/adminUsers/index.ts:98`) while `users` has no such column (`backend/db/schema/users/users.ts:11-45`). Issue #228 closes that gap: an admin sets a user's password from the dashboard, with an option that requires the user to change it on next login.

The "reset on login" half is load-bearing, not cosmetic. A forced reset is only meaningful if the flagged user is actually required to replace the temporary credential before using the account; that requires (a) a persisted flag, (b) a server-authoritative gate that blocks the account until the flag clears, and (c) a self-service change-password path that is the sole way to clear it. None of these exist today — `users` carries no reset column, login has no post-password-check branch (`backend/services/auth/auth.service.ts:168-207`), and the profile page's `ChangePasswordCard` is an inert placeholder whose copy reads *"Password changes are not enabled yet"* (`shared/locale/en/dashboard/index.ts:67`).

### Feature Summary

Add an admin-only "Change password" action on both admin user surfaces that sets a user's password (via a dedicated, audited `adminSetUserPassword` mutation) with an optional `mustChangePassword` flag, plus the end-to-end forced-reset flow: a persisted `users.must_change_password` column, a server-authoritative gate (SSR page guard + GraphQL operation gate + client redirect) that blocks a flagged user from everything except a self-service `changeMyPassword` mutation, and the `/change-password` page that clears the flag.

### Business Value

The academy can hand a user a working credential without an email/OTP reset infrastructure (which does not exist — no forgot-password flow; the login "Forgot password?" link is a dead `href="#"`, `frontend/views/auth/login/LoginForm.tsx:47-49`). Support and onboarding stop blocking on "the user forgot their password." The `createDialog.passwordHelper` promise becomes true. This satisfies the Milestone-3 admin-governance scope (`docs/planning/MILESTONE_PLAN.md:249-251`) without introducing the self-service email-reset subsystem (explicitly deferred).

### Scope

**In scope:** a new `users.must_change_password` column (Drizzle `db push`); a password write path (`UserRepository.updatePassword`); `AdminUserManagementService.setUserPassword` (admin-gated, audited); the `adminSetUserPassword` GraphQL mutation + `AdminSetUserPasswordInput`; `mustChangePassword` exposure on the `User` and `AdminUserDetail` GraphQL objects; the self-service `changeMyPassword` mutation + `AuthService.changeMyPassword`; the server-authoritative forced-reset gate (SSR via `withPageAuth`, API via an Apollo operation guard, client via `DashboardLayout`); the `/change-password` page; the admin "Change password" dialog on the directory kebab menu and the detail hero; new i18n keys (`adminUsers`, `auth`, `errors` namespaces + parity pins); the cross-actor journey test; the audit-census registration; the wire/document tests.
**Out of scope (explicit):** email/OTP-based self-service password reset (no mail infra for it; deferred item D1); session/token revocation on password change (no server-side session store exists — `backend/services/auth/auth.service.ts:236-240`; deferred item D2); rate limiting on the mutation (no existing limiter for admin writes; deferred item D3); enabling the dashboard profile `ChangePasswordCard` placeholder as the self-service surface (the forced flow ships its own `/change-password` page; the profile card is a separate UX ticket — deferred item D4); password strength/complexity beyond the existing minimum length of 8 (`backend/services/auth/registration.service.ts:58`); granting admins a special "cannot change another admin's password" rule (admins are trusted; deferred item D5).

## Requirements

### REQ-001: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I want an error baseline and persistent outcome tracking, so that new issues are distinguishable from pre-existing ones and past research is never redone.

#### Acceptance Criteria

1. WHEN implementation begins THEN the agent SHALL record baseline counts (`bun tsgo 2>&1 | grep -c "error TS"`, `bun biome:check 2>&1 | grep -c "warn"`, `bun run scripts/lint-service.ts --json --id baseline`) and write `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/outcome/0-baseline-outcome.md`.
2. WHEN implementation begins THEN the agent SHALL confirm `deferred-items.md` exists in the plan directory (created with this plan, seeded with the carried-forward items listed in it).
3. WHEN an executing agent starts any task THEN it SHALL read ALL existing files in the plan's `outcome/` directory first.
4. WHEN an executing agent completes any task THEN it SHALL write `outcome/<task-id>-outcome.md` with research findings, implementation details, cross-file dependencies, and carry-over points.
5. WHEN an executing agent completes any subtask THEN it SHALL flip the checkbox `[ ]` → `[x]` in `tasks.md`.
6. WHEN any file is modified THEN the agent SHALL run `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` on it and SHALL NOT proceed until exit code 0.
7. WHEN any subtask is marked complete THEN the agent SHALL have completed the semantic-review checklist (race conditions, tenancy, enums-as-values, dead code, deferred items logged) — the sub-loop script cannot detect these.

### REQ-002: Translation & Enum Compliance

**User Story:** As a maintainer, I want user-facing strings compile-time checked and enums imported as values, so locale and type errors surface at build time.

#### Acceptance Criteria

1. WHEN any new admin-surface label is added THEN it SHALL live in the `AdminUsersLabels` interface (`shared/locale/types/adminUsers/index.ts:27`) with identical key sets in `shared/locale/en/adminUsers/index.ts` (`adminUsersEn`) and `shared/locale/ar/adminUsers/index.ts` (`adminUsersAr`), pinned in `shared/locale/adminUsers-namespace.parity.test.ts` — the existing create-dialog credential copy lives there (`createDialog.password` `:227`, `.passwordHelper` `:229`).
2. WHEN admin components consume labels THEN they SHALL read the namespace handle `AdminUsers` (`shared/locale/namespaces/adminUsers/adminUsers.namespace.ts:4-6`, id `"adminUsers.adminUsers"`) via `useAppTranslation(AdminUsers)` — namespace handles, NEVER a `Translation.` enum, NEVER `t('key')` function calls; per-component props take `AdminUsersLabels` by type (pattern: `AdminUsersDirectoryContainer.tsx:50-54`, `AdminUserDetailContainer.tsx:61-69`).
3. WHEN the `adminUsers` namespace gains keys THEN they SHALL be flat strings or flat ICU string bands — this namespace's parity walker REJECTS function leaves (`shared/locale/adminUsers-namespace.parity.test.ts:136-145` throws on non-string/non-plain-object nodes); plural copy uses ICU bands (precedent `directoryChips.childrenCount.{zero,one,…}`, `types/adminUsers/index.ts:124-140`).
4. WHEN forced-reset page labels are added THEN they SHALL extend the `Auth` namespace (`AuthLabels`, `shared/locale/types/auth/index.ts`) with a `changePassword` block (page title/description, current/new/confirm field labels, submit, mismatch, success) and read via `useAppTranslation(Auth)` — the login form's namespace (`frontend/views/auth/login/LoginForm.tsx`), which already owns `passwordRequired`/`passwordTooShort` (`shared/locale/types/auth/index.ts:37-38`).
5. WHEN server-side denial messages are added THEN they SHALL extend `errorsTranslations` (`shared/locale/types/errors/labels.ts`) with `passwordChangeRequired` and `currentPasswordInvalid` (+ optional `newPasswordSameAsCurrent`) and the shapes SHALL be surfaced through `ctx.t("errorsTranslations")` in resolvers/services — never hardcoded English (`backend/lib/errors.ts` `ForbiddenError`/`ValidationError` carry the localized message).
6. WHEN an enum is referenced in a runtime expression THEN it SHALL be imported as a value (never `import type`) and enum members used instead of string literals — `AuditActionType.Update` (`backend/enum/audit/audit-action-type.enum.ts:6`), `UserRole.Admin` (`backend/enum/users/user-role.enum.ts:5`).

### REQ-003: Admin Sets a User's Password (Direct Change)

**User Story:** As an admin, I want to set a user's password from the admin dashboard, so I can restore access for a user who is locked out or hand over a working credential.

#### Acceptance Criteria

1. WHEN an authenticated admin invokes `adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!)` THEN the system SHALL persist a new bcrypt hash for that user via `AuthService`-compatible `hashPassword(plaintext)` (`backend/lib/auth/password.ts:18`, 12 rounds) and SHALL return the updated `AdminUserDetail`.
2. WHEN the new password is shorter than 8 characters THEN the system SHALL reject with a `VALIDATION` error carrying `extensions.fields = [{ field: "password", code: "PASSWORD_TOO_SHORT" }]` — reusing `MIN_PASSWORD_LENGTH = 8` (`backend/services/admin/user-management.helpers.ts:32`) and the localized `authTranslations.passwordTooShort`.
3. WHEN the new password is empty/whitespace THEN the system SHALL reject VALIDATION with `code: "PASSWORD_REQUIRED"` and localized `authTranslations.passwordRequired`.
4. WHEN the target `id` does not identify an existing user THEN the system SHALL reject with `NotFoundError("USER", …)` / code `USER_NOT_FOUND` (the `getUserDetail` precedent, `backend/services/admin/user-management.service.ts:237-242`).
5. WHEN the password write succeeds THEN the response SHALL NEVER contain `passwordHash` — the returned `AdminUserDetail` remains `Omit<UserSelectType, "passwordHash">` (`backend/types/admin/admin-user.types.ts:18`).
6. WHEN the mutation is invoked THEN it SHALL NOT accept `email`, `role`, `passwordHash`, or any governance field — `AdminSetUserPasswordInput` is exactly `{ password: String!, mustChangePassword: Boolean! }` and is a NEW type, NOT a widening of the closed `AdminUpdateUserInput` whitelist (`backend/graphql/pothos/admin/admin-user.pothos.ts:318-334`).

#### Additional Details
- **Priority**: High · **Complexity**: Medium · **Dependencies**: REQ-009 (schema) · **Assumptions**: bcryptjs is already the project's hasher; no rehash-on-write policy change.

### REQ-004: Force-Reset-on-Login Option

**User Story:** As an admin, I want the option to require a user to change their password on next login, so I can hand over a temporary credential safely.

#### Acceptance Criteria

1. WHEN the admin submits the change-password dialog with "require change on next login" selected THEN the system SHALL persist `must_change_password = true` on that user in the same transaction as the password write.
2. WHEN the option is not selected THEN the system SHALL persist `must_change_password = false` (clearing any prior flag for that user).
3. WHEN a user's `mustChangePassword` flag is true THEN the admin surfaces SHALL render a "password reset pending" indicator: the user detail page SHALL show the flag (new `AdminUserDetail.mustChangePassword` field + detail fragment selection) and the directory row MAY surface it (deferred item D6 for the row-level chip).
4. WHEN the flag is set or cleared THEN the change SHALL be recorded in `audit_logs` as `AuditActionType.Update` with `details` containing `changedFields: ["credentials"]` and `mustChangePassword: <boolean>` — the audit detail SHALL NEVER contain the password, its hash, or any reversible derivative.
5. WHEN the flag is persisted THEN it SHALL survive across login sessions until the user clears it via REQ-006 — login SHALL NOT clear it.

### REQ-005: Server-Authoritative Forced-Reset Enforcement

**User Story:** As the platform, I want a flagged user to be blocked from everything except changing their password, so a temporary credential cannot be used indefinitely.

#### Acceptance Criteria

1. WHEN an authenticated caller has `mustChangePassword === true` and invokes any GraphQL operation whose root fields are not on the exemption allowlist THEN the system SHALL reject the operation with a `FORBIDDEN` error carrying code `PASSWORD_CHANGE_REQUIRED` and the localized `errorsTranslations.passwordChangeRequired` message.
2. WHEN the caller is flagged THEN the exempt operations SHALL remain callable: `me` (session restore), `changeMyPassword` (REQ-006), `logout` (cookie clear), `updateMyLocale`, and the public auth operations (`login`, `registerUser`, `refreshToken`) — the allowlist is a closed set of root field names.
3. WHEN a Server Component page is reached by a flagged user THEN `withPageAuth` (`frontend/lib/auth/withPageAuth.ts:67`) SHALL redirect to `/change-password` unless the caller passes `allowMustChangePassword: true` (used only by the `/change-password` page itself); the redirect SHALL NOT loop with the login redirect (both targets are outside the flagged gate).
4. WHEN a flagged client session is active THEN `DashboardLayout` (client shell, mounted by `app/(dashboard)/layout.tsx:16`) SHALL redirect to `/change-password` — the client mirror of criterion 3, so the UX is immediate even before a page navigation.
5. WHEN the gate is evaluated THEN it SHALL read the authoritative DB state (`ctx.user.mustChangePassword`, sourced from `UserRepository.findById` in the context factory), NOT a JWT claim — a flag set after token issuance SHALL take effect on the next request without waiting for token expiry.
6. WHEN a user is NOT flagged (the default for all existing users) THEN the gate SHALL be a no-op — zero behavior change, zero extra queries beyond the existing per-request `findById` (`backend/graphql/gqlContextFactory.ts:212-220`).

### REQ-006: Self-Service Change Password (the only flag-clearing path)

**User Story:** As a user who has been handed a temporary password, I want to set my own password from the reset page, so I regain normal access.

#### Acceptance Criteria

1. WHEN an authenticated caller invokes `changeMyPassword(input: ChangeMyPasswordInput!)` THEN the system SHALL verify `input.currentPassword` against the stored hash via `comparePassword(plaintext, storedHash)` (`backend/lib/auth/password.ts:27`).
2. WHEN `currentPassword` is wrong THEN the system SHALL reject with `VALIDATION` code `CURRENT_PASSWORD_INVALID` (`extensions.fields = [{ field: "currentPassword", … }]`) and SHALL NOT write anything.
3. WHEN the new password is shorter than 8 characters or empty THEN the system SHALL reject VALIDATION (`PASSWORD_TOO_SHORT` / `PASSWORD_REQUIRED`) exactly as REQ-003.
4. WHEN the new password equals the current password THEN the system SHALL reject VALIDATION code `NEW_PASSWORD_SAME_AS_CURRENT` (defense against a no-op "change" that silently clears the flag).
5. WHEN verification succeeds THEN the system SHALL hash the new password, persist it, and set `must_change_password = false` in the same transaction.
6. WHEN the caller is flagged THEN this operation SHALL remain callable (REQ-005.2) and SHALL be the ONLY operation that clears the flag.
7. WHEN the operation succeeds THEN the response SHALL be the updated `User` (password-stripped) with `mustChangePassword: false`, so the client can proceed without a re-login.
8. WHEN the caller is anonymous THEN the system SHALL reject with `UNAUTHORIZED` (the `authenticated` scope).

### REQ-007: Admin UI Placement & Dialog

**User Story:** As an admin, I want a "Change password" action where I already act on a user, so I can reset credentials without leaving the page.

#### Acceptance Criteria

1. WHEN an admin views the user directory THEN the row kebab menu SHALL offer a "Change password" item (`frontend/views/admin/users/directory/DirectoryActionsMenu.tsx:33`, beside Edit `:49-57` and Deactivate `:58-81`), wired through `DirectoryUserRow.tsx:102` / `MobileUserCard.tsx:76` / `DirectoryResults.tsx:49-50,69-70`.
2. WHEN an admin views the user detail page THEN the hero actions SHALL offer a "Change password" button (`frontend/views/admin/users/detail/UserHeroActions.tsx:35`, beside Certify `:45-55` / Edit `:56-64`), threaded through `UserDetailHero.tsx:64-66,127` and `AdminUserDetailContainer.tsx:109-111`.
3. WHEN the action fires THEN a `ChangeUserPasswordDialog` SHALL open with: a new-password field (show/hide), a confirm-password field, and a checkbox "Require the user to change this password on next login".
4. WHEN the dialog is submitted THEN it SHALL call `adminSetUserPassword`, surface field errors via `useAdminUserFormFeedback` (`frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:34`), close on success, and show the shared success snackbar with the new `snackbars.passwordChanged` copy.
5. WHEN the dialog renders THEN the password input SHALL reuse the `CreateUserCredentialField` show/hide pattern (`frontend/views/admin/users/dialogs/CreateUserCredentialField.tsx:33`) and the dialog shell SHALL reuse `AdminDialogHeaderBand`/`AdminDialogFooterBand` (`AdminDialogBands.tsx:28,80`) + the `useState` form convention of `EditUserDialog.tsx:64` (no react-hook-form in this folder).
6. WHEN the dialog is closed or the operation fails THEN no navigation and no partial write SHALL occur; the dialog state target (`changePasswordTarget`) SHALL be cleared on close.

### REQ-008: Authorization, Tenancy & the Cross-Actor Journey

**User Story:** As the platform, I want password management gated to admins and the forced-reset promise proven end-to-end, so no non-admin can set credentials and the shared-state contract is tested.

This feature spans two actors over shared state (admin sets a temporary credential → user is forced to replace it), so the journey is captured here and maps 1:1 onto `test/workflows/admin/admin-password-reset.journey.test.ts`.

#### Actor Table

| Actor | Role (`users.role`) | Can Do | Cannot Do |
|---|---|---|---|
| Admin (actor) | `admin` | call `adminSetUserPassword` for any non-deleted user; set/clear the flag; read the audit row | read any `passwordHash`; set a password without an audit row |
| Flagged target user | `student` / `teacher` / `parent` / `admin` | `login`; `me`; `changeMyPassword`; `logout`; `refreshToken` | call any other GraphQL operation while flagged (`PASSWORD_CHANGE_REQUIRED`); reach any dashboard page (redirected to `/change-password`) |
| Un-flagged target user | any | everything as before | — (gate is a no-op) |
| Non-admin authenticated (student/parent/teacher) | `student`/`parent`/`teacher` | `changeMyPassword` for self (own current password required) | call `adminSetUserPassword` → `FORBIDDEN` |
| Anonymous | — | `login`/`registerUser`/`refreshToken` | `adminSetUserPassword` / `changeMyPassword` → `UNAUTHORIZED` |

#### Ordered Step List (Journey J1 — temporary credential → forced change)

1. Fixtures commit: an admin actor, a target teacher (or student), a foreign non-admin actor (unique `jrn_adminpwd_<uuid8>` prefix; committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`).
2. Admin → `setUserPassword(targetId, { password: "TempPass123", mustChangePassword: true })` → target row has a NEW hash that verifies for `"TempPass123"` and `must_change_password = true`; ONE audit row (`Update`, `changedFields: ["credentials"]`).
3. Target → `AuthService.login(email, "TempPass123")` → succeeds; `session.user.mustChangePassword === true` (login does NOT clear the flag).
4. Non-admin actor → `setUserPassword(targetId, …)` → DENIED `FORBIDDEN`, zero writes, zero audit rows.
5. Target → any gated operation (e.g. an admin-gated read or a normal mutation) → DENIED `PASSWORD_CHANGE_REQUIRED` while flagged.
6. Target → `changeMyPassword({ currentPassword: "TempPass123", newPassword: "NewPass456" })` → succeeds; hash verifies for `"NewPass456"` and `must_change_password = false`.
7. Target → the previously denied operation → now ALLOWED (gate cleared); re-login with `"NewPass456"` succeeds and `"TempPass123"` fails.
8. Cleanup: tracked `afterAll` — zero residue.

#### Acceptance Criteria (cross-actor, observer-perspective EARS)

1. WHEN an admin sets a temporary password with the flag THEN the target user SHALL be able to log in with that password AND SHALL observe `mustChangePassword: true` on the returned user.
2. WHEN the target is flagged THEN the system SHALL deny every non-exempt operation with code `PASSWORD_CHANGE_REQUIRED` AND redirect page navigations to `/change-password`.
3. WHEN the target changes their password THEN the flag SHALL clear AND the previously denied operation SHALL succeed — the shared-state transition the whole feature exists for.
4. IF a non-admin attempts `adminSetUserPassword` THEN the system SHALL deny with `FORBIDDEN` and write zero audit rows.
5. WHEN any caller reads any admin password operation output THEN `passwordHash` SHALL be absent (deep-field check).

### REQ-009: Schema Delta & Data Model (explicit)

**User Story:** As the platform, I want the force-reset state persisted on the user row, so the gate reads authoritative DB state rather than a client signal.

#### Acceptance Criteria

1. WHEN the schema changes THEN `users` SHALL gain exactly one column: `mustChangePassword` → `boolean("must_change_password").default(false).notNull()` in `backend/db/schema/users/users.ts:11-45`, applied via `bun run db push` (Drizzle schema push convention — new column, no custom SQL).
2. WHEN the column is added THEN `UserSelectType` / `UserInsertType` SHALL pick it up automatically (`backend/types/users/user.types.ts:3-4`) and `RegistrationReturnType` (`Omit<UserSelectType, "passwordHash">`, `backend/types/users/registration.types.ts:94-96`) and `AdminUserSafeSelect` (`backend/types/admin/admin-user.types.ts:18`) SHALL both carry `mustChangePassword` with no manual interface edit.
3. WHEN the new column is added THEN existing rows SHALL read `false` (server default) — no backfill script is required.
4. WHEN a GraphQL object exposes the field THEN exactly two Pothos objects SHALL gain a `mustChangePassword: Boolean!` field: `UserPothosObject` (`backend/graphql/pothos/users/user.pothos.ts:30-91`) and `AdminUserDetailPothosObject` (`backend/graphql/pothos/admin/admin-user.pothos.ts:225-290`).
5. WHEN an admin detail query selects fields THEN the `ADMIN_USER_DETAIL_FIELDS` fragment (`frontend/graphql/sharedDocuments/admin/admin-users.documents.ts:55`) SHALL include `mustChangePassword`.

#### Additional Details
- **Priority**: High · **Complexity**: Low · **Dependencies**: none (root of the backend chain) · **Assumptions**: Postgres `ADD COLUMN … DEFAULT false NOT NULL` on an existing table is safe (the repo's `db push` path handles it).

### REQ-010: Audit, Observability & Census Registration

**User Story:** As the platform, I want every admin password change audited and counted, so the governance trail stays complete and drift-tested.

#### Acceptance Criteria

1. WHEN `adminSetUserPassword` succeeds THEN exactly ONE `audit_logs` row SHALL be written inside the same transaction via `AuditService.createAuditLog` (`backend/services/admin/audit.service.ts:82`) using `buildAuditContract(actorId, AuditActionType.Update, targetId, details)` (`backend/services/admin/user-management.helpers.ts:334`).
2. WHEN the audit `details` is built THEN it SHALL contain `changedFields: ["credentials"]` and `mustChangePassword: <boolean>` and SHALL NEVER contain the password or its hash (the 2000-char truncation + names-only discipline of `buildAuditContract` is preserved).
3. WHEN a denial occurs (non-admin, not-found, validation) THEN ZERO audit rows SHALL be written.
4. WHEN the audit-census drift test runs THEN `adminSetUserPassword` SHALL be registered in `ADMIN_ACTION_CENSUS` (`test/workflows/admin/audit-completeness.catalog.ts:84-120`) and in `USER_LIFECYCLE_LEG` (`test/workflows/admin/audit-completeness.journey.test.ts:226-232`) with `expectedActionTypes: [AuditActionType.Update]`.
5. WHEN a resolver denial is logged THEN it SHALL use `logger.logDomainError` (backend logger) with a stable `code` (`PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INVALID`) — never `console.*`.
6. WHEN a password-change denial reaches the client THEN client diagnostics SHALL go through the existing Apollo error-mapping seam — the plan adds no bespoke toast plumbing beyond the surface snackbar.

### REQ-011: Scope Guard & Explicit Non-Goals

**User Story:** As the scope owner, I want the surface delta bounded, so the feature cannot sprawl into the deferred reset subsystems.

#### Acceptance Criteria

1. WHEN this plan ships THEN it SHALL NOT add email/OTP reset delivery, mail templates, or any `app/api/**` route beyond what REQ-005/REQ-006 require.
2. WHEN this plan ships THEN it SHALL NOT add a server-side session store or token revocation (deferred item D2) — existing tokens remain valid until expiry; the gate blocks *requests*, not *tokens*.
3. WHEN this plan ships THEN it SHALL NOT enable/modify the dashboard profile `ChangePasswordCard` placeholder (`frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx:20-21`) — the forced flow owns `/change-password`; the profile card remains a separate ticket (deferred item D4).
4. WHEN this plan ships THEN it SHALL NOT introduce password complexity/strength rules beyond `MIN_PASSWORD_LENGTH = 8` — the shared minimum is reused verbatim.
5. WHEN `apps/(dashboard)/admin/users` routes are touched THEN their existing page guards (`withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })`, `app/(dashboard)/admin/users/page.tsx:31`, `[id]/page.tsx:34`) SHALL remain unchanged except for the additive `allowMustChangePassword` semantics of REQ-005.3.
6. WHEN the navigation graph is touched THEN `frontend/views/dashboard/nav/navItems.ts` SHALL be byte-unchanged — `/change-password` is a forced gate, not a nav item (the repo has no mobile bottom-nav surface).

## UX / Navigation Requirements

### New Routes & Role-Based Access

| Route | Purpose | Permission / Guard | Roles with Access |
|---|---|---|---|
| `/change-password` (NEW) | Forced self-service password change (the only flag-clearing page) | `withPageAuth({ allowMustChangePassword: true })` (authenticated) | Any authenticated role (reached only while flagged, or voluntarily) |
| `/admin/users` (existing) | User directory — gains the row-level "Change password" menu item | `withPageAuth({ roles: [UserRole.Admin] })` (`app/(dashboard)/admin/users/page.tsx:31`) | `admin` |
| `/admin/users/[id]` (existing) | User detail — gains the hero "Change password" button | `withPageAuth({ roles: [UserRole.Admin] })` (`app/(dashboard)/admin/users/[id]/page.tsx:34`) | `admin` |

### Sidebar / Navigation Placement

| Aspect | Ruling | Evidence / Rationale |
|---|---|---|
| Sidebar | UNCHANGED | `frontend/views/dashboard/nav/navItems.ts` byte-unchanged (REQ-011.6); the admin block already owns `/admin/users` |
| Mobile bottom nav | NONE | The repo has no bottom-nav surface anywhere |
| `/change-password` in nav | NOT a nav item | It is a forced gate reached by redirect (REQ-005.3/.4), not a destination; surfacing it in nav would invite voluntary use and duplicate the deferred profile card |
| Mount points (admin) | Directory kebab menu + detail hero | `DirectoryActionsMenu.tsx:33`; `UserHeroActions.tsx:35` |

### Role-Based Access Matrix

| Role | `/change-password` | `adminSetUserPassword` | `changeMyPassword` | Admin directory/detail actions |
|---|---|---|---|---|
| `admin` | ✅ (if flagged) | ✅ any non-deleted user | ✅ self | ✅ (existing pages) |
| `teacher` | ✅ (if flagged) | ❌ `FORBIDDEN` | ✅ self | ❌ pages redirect |
| `student` | ✅ (if flagged) | ❌ `FORBIDDEN` | ✅ self | ❌ pages redirect |
| `parent` | ✅ (if flagged) | ❌ `FORBIDDEN` | ✅ self | ❌ pages redirect |
| anonymous | ❌ redirect `/login` | ❌ `UNAUTHORIZED` | ❌ `UNAUTHORIZED` | ❌ |

### Per-Audience Rendering

| Audience | Rendering |
|---|---|
| Admin | Directory kebab item + detail hero button → `ChangeUserPasswordDialog` (new password, confirm, "require change on next login"); detail shows the pending-reset indicator when the flag is set. |
| Flagged user (any role) | Every dashboard page redirects to `/change-password`; the page renders the current/new/confirm form and a message explaining a temporary password was issued; on success the user proceeds normally. |
| Un-flagged user | Zero change — the profile page keeps the deferred `ChangePasswordCard` placeholder (D4). |

### Permission Mapping (exact ids)

| Surface | Enforcement point |
|---|---|
| Admin directory / detail pages | `withPageAuth({ roles: [UserRole.Admin] })` — existing, unchanged guard + additive `allowMustChangePassword` default |
| `adminSetUserPassword` | Pothos `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (the established admin-mutation scope — `admin-users.mutation.ts:64-69`) + service strict gate `assertActorAdminActive` |
| `changeMyPassword` | Pothos `authScopes: { authenticated: true }` |
| Flagged-account gate | Apollo operation guard (allowlist of root field names) + `withPageAuth` redirect + `DashboardLayout` client redirect |
| UI denial | `FORBIDDEN`/`VALIDATION` codes → dialog inline errors via `useAdminUserFormFeedback`; `PASSWORD_CHANGE_REQUIRED` → redirect to `/change-password` |

## Non-Functional Requirements

### Performance

1. WHEN `adminSetUserPassword` runs THEN it SHALL perform exactly one bcrypt hash (12 rounds — the dominant cost, ~100ms class) + one `UPDATE` + one audit `INSERT` inside one transaction — no extra reads beyond the actor gate and the post-write detail resolution already used by `updateUser` (`user-management.service.ts:331-374`).
2. WHEN the forced-reset gate is evaluated per GraphQL request THEN it SHALL add ZERO queries — it reads the already-fetched `ctx.user.mustChangePassword` (`backend/graphql/gqlContextFactory.ts:212-220`).
3. WHEN `withPageAuth` runs for a flagged user THEN the redirect decision SHALL reuse the single cached `getServerUserContext()` call (`backend/lib/auth/server-auth.ts:119`, `react.cache`) — no extra DB round-trip.

### Security

1. WHEN any admin password operation responds THEN `passwordHash` SHALL be structurally absent (`AdminUserSafeSelect`) and asserted absent by a deep-field walk (the `deepFindKey(…, "passwordHash")` precedent).
2. WHEN the password is written THEN it SHALL be bcrypt-hashed before persistence and the plaintext SHALL never be logged, audited, or returned.
3. WHEN `changeMyPassword` verifies THEN it SHALL use `comparePassword` (constant-time bcrypt compare) and SHALL NOT reveal whether the current password was wrong vs. the account missing (single `CURRENT_PASSWORD_INVALID` shape after identity is established).
4. WHEN a non-admin calls `adminSetUserPassword` THEN the system SHALL deny at BOTH the scope layer (`role: [Admin]` → 403) and the service layer (`assertActorAdminActive`) — defense in depth; zero writes.
5. WHEN the forced gate blocks an operation THEN the denial SHALL be a constant `FORBIDDEN` + `PASSWORD_CHANGE_REQUIRED` with no leak of which field triggered it.
6. WHEN `mustChangePassword` is set THEN it SHALL NOT be settable through `AdminUpdateUserInput` or any user-writable input — only via `adminSetUserPassword` (admin) or cleared via `changeMyPassword` (self).

### Reliability

1. WHEN the password write succeeds but audit insertion fails THEN the transaction SHALL roll back — no state change without its audit row (single `withTransaction`).
2. WHEN the gate is active and the exempt `changeMyPassword` fails validation THEN the user SHALL remain flagged and able to retry — no partial clear.

### Observability

1. WHEN a denial is handled THEN server-side diagnostics SHALL use `logger.logDomainError` (backend) / the Apollo error-mapping seam (frontend); zero `console.*`; zero references to plan artifacts inside code.

## Constraints and Assumptions

### Technical Constraints

- **Schema delta is REQUIRED** (one `notNull` default column) and is the sanctioned exception to the M3 "zero-drift" style — justified by REQ-004/REQ-005 (a persisted flag is not derivable). Applied via `bun run db push`, then `bun codegen` (new SDL fields).
- The GraphQL role scope reads the JWT role claim, not the DB row (`backend/graphql/pothos/builder.ts` scope docblock) — the service-layer `assertActorAdminActive` gate re-checks the DB, so a demoted admin is still blocked (the established pattern).
- No server-side session store exists (`backend/services/auth/auth.service.ts:236-240`) → password change cannot revoke existing tokens (deferred item D2).
- `adminUsers` namespace parity REJECTS function leaves → new labels are flat strings / ICU bands only (REQ-002.3).

### Business Constraints

- Milestone 3 · Dev 3 (admin-governance stream). Anything requiring mail/OTP delivery, a session store, or the profile self-service card is deferred (D1..D6), not expanded.
- Password policy stays at the shipped minimum (8 chars) — no new complexity rules.

### Assumptions

- Admins are trusted to set any non-deleted user's password, including other admins' (D5 records the stricter alternative).
- A flagged user always has a recoverable path via `/change-password` + `changeMyPassword`; the flag is never set without the user being able to log in (they hold the admin-set temporary password).
- Existing seeded users read `mustChangePassword = false` after the column lands (server default) — no fixture churn.

## Success Criteria

### Definition of Done

- [ ] All REQ-001…REQ-011 acceptance criteria met
- [ ] `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` exits 0 for every modified/new file
- [ ] Backend suites green: repo (`runInRollback` + `tx`), service, GraphQL wire/integration (via `bun run test/scripts/run-test.ts`)
- [ ] Journey `test/workflows/admin/admin-password-reset.journey.test.ts` green (8 ordered steps, incl. non-admin denial + flagged-gate denial legs)
- [ ] Audit-census drift test green (`audit-completeness.journey.test.ts`) with the new mutation registered
- [ ] `adminUsers` / `auth` / `errors` parity belts green with the new keys/pins
- [ ] `deferred-items.md` contains zero blocker-glyph rows at the final gate
- [ ] Phase 1.5 gate passed: `outcome/plan-review-R1.md` records a clean verdict

### Acceptance Metrics

- 100% branch coverage on the new backend helpers/validators (password-policy validation, flag derivation) and the gate allowlist predicate
- Zero new tsgo/biome/lint errors vs baseline (`outcome/0-baseline-outcome.md`)
- `passwordHash` absent from every response shape (deep-walk assertion in the wire suite)
- Re-login with the temporary password fails after a successful `changeMyPassword`; the previously gated operation succeeds

## Glossary

| Term | Definition |
|---|---|
| Direct change | Admin sets a user's password; the flag is `false` — the user logs in with it normally |
| Reset-on-login | Admin sets a password with `mustChangePassword = true`; the user must replace it before using the account |
| Flagged user | An authenticated user whose `users.must_change_password` is `true` |
| Forced gate | The server-authoritative block (REQ-005) that denies every non-exempt operation and redirects pages to `/change-password` |
| Exemption allowlist | The closed set of root field names still callable while flagged (`me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken`) |
| Temporary credential | The admin-set password a flagged user receives |
| Census | `ADMIN_ACTION_CENSUS` — the drift-tested bijection of admin-gated mutations ↔ audit action types |

---

## Requirements Review Checklist

- [x] User stories have roles/features/benefits · EARS throughout · NFRs present · Success criteria measurable
- [x] UX/navigation defined for all roles (new `/change-password` route + admin mount points; no-nav rulings with evidence)
- [x] Cross-actor journey captured: actor table + 7 ordered steps + observer-perspective EARS (REQ-008) with 1:1 journey file mapping
- [x] Schema delta explicit and justified (REQ-009); no-drift exceptions recorded (REQ-011)
- [x] Security/tenancy NFRs map to BOLA/BOPLA/BFLA mitigations
- [x] Deferred work recorded in `deferred-items.md` (D1..D6) and cross-referenced from Scope
