# Design — Admin Change User Password (with Reset-on-Login)

> **Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Specs of record:** `specs.md` (REQ-001..REQ-011) · **Ticket:** GitHub issue `#228 — Admin Can't change users password from the dashboard` (`/admin/users/` · Change Password, with an option to require reset on next login)
> **Plan kind:** full-stack vertical — ONE additive schema column, ONE canonical repo write, ONE admin mutation + ONE self-service mutation, a server-authoritative forced-reset gate across three layers, and one new top-level page; no email/OTP, no session store, no nav change.

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-30 |
| Feature Name | Admin Change User Password (with Reset-on-Login) |
| Milestone | M3 (`milestone_3_parent_portal_admin_governance`) |
| Ticket type | GitHub issue #228 (OPEN) — no `docs/planning/TICKETS.md` block exists; milestone inherited from the owning shipped ticket (`docs/planning/TICKETS.md:2221-2266`, `| **Milestone** | 3 |` `:2225`) |
| Schema delta | ONE column: `users.must_change_password` (`backend/db/schema/users/users.ts:11-45`), applied via `bun run db push` — REQ-009 |
| New GraphQL surface | 2 mutations, 2 input types, 2 `Boolean!` fields — §4.1 |
| Design lineage | `AdminUserManagementService.updateUser` (`backend/services/admin/user-management.service.ts:331-374`) · `AuthService.updateMyLocale` (`backend/services/auth/auth.service.ts:282`) · `UserRepository.updateLocale` (`backend/db/repo/users/user.repository.ts:130`) · `UserRepository.create` (`:106`) · `withPageAuth` (`frontend/lib/auth/withPageAuth.ts:67`) · Apollo plugin array (`app/api/graphql/apollo-server.ts`) |
| Evidence pack | `outcome/00-research-evidence-pack.md` (every `path:line` below cites it; line numbers re-verify on touch) |
| Related docs | `docs/admin/user-management.md:119,190` · `docs/auth/user-registration.md:274-278` · `docs/planning/MILESTONE_PLAN.md:249-251` · `ai/finished_plans/milestone_3_parent_portal_admin_governance/admin-crud-users-teachers-students-paren/specs.md:30` (prior-art exclusion) |

## 1. Overview & Key Design Decisions

### Overview

An admin at `/admin/users/` (directory) or `/admin/users/[id]` (detail) gets a "Change password" affordance that opens a dialog with a new password, a confirmation, and a "Require the user to change this password on next login" checkbox. Submitting calls a new dedicated, admin-scoped, audited `adminSetUserPassword(id, input)` mutation that bcrypt-hashes the password and persists it together with a new `users.must_change_password` flag in one transaction, returning the updated `AdminUserDetail`. When the flag is set, the target user can still `login` with the temporary credential but is then server-authoritatively fenced: every GraphQL operation except a closed allowlist is rejected with `FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED`, every dashboard page redirects to the new top-level `/change-password` page, and the user clears the flag only by invoking the new self-service `changeMyPassword(input)` mutation (current password verified via `comparePassword`). The gate reads authoritative DB state (`ctx.user.mustChangePassword`), so a freshly set flag takes effect on the next request without token expiry.

### Design Goals

1. **One password-write home.** A single repository method (`UserRepository.updatePassword`) is the only place a password hash is written, mirroring `create`/`updateLocale`; no second user-write repository is introduced.
2. **The forced reset is real, not cosmetic.** A persisted flag plus a server-authoritative gate (API op-guard + SSR page guard + client redirect) makes the "must change on first login" copy true instead of advertised-but-inert.
3. **Zero extra per-request cost for the un-flagged 99%.** The gate reuses `ctx.user` already fetched by `UserRepository.findById` in the context factory — no new query.
4. **No mass-assignment surface.** The password is a NEW input type; the closed five-field `AdminUpdateUserInput` whitelist is untouched, and `mustChangePassword` is reachable only through `adminSetUserPassword` (admin) or `changeMyPassword` (self).

### Key Design Decisions

- **D1 — One additive `notNull` default column, pushed (not migrated).** *Context:* a forced reset needs persisted state that is not derivable; `users` has no such column today (`backend/db/schema/users/users.ts:11-45`), and the admin `createDialog.passwordHelper` copy already promises it (`shared/locale/en/adminUsers/index.ts:98`). *Options:* (1) derive "temporary" from a `lastPasswordChangedAt` timestamp or a JWT claim; (2) a dedicated boolean column. *Decision:* (2) — `boolean("must_change_password").default(false).notNull()` applied via `bun run db push` (no custom SQL). *Rationale:* it auto-flows into `UserSelectType` (`backend/types/users/user.types.ts:3-4`), `RegistrationReturnType` (`Omit<UserSelectType,"passwordHash">`, `backend/types/users/registration.types.ts:94-96`), and `AdminUserSafeSelect` (`backend/types/admin/admin-user.types.ts:18`) with zero manual interface edits; existing rows read `false` via the server default, so no backfill. A derivation would either require a write-path timestamp the repo does not have or put security-relevant state in a client-trusted token.
- **D2 — A dedicated mutation with its own input; never widen the closed 5-field whitelist.** *Context:* `AdminUpdateUserInput` is a deliberately closed `{ fullName, phone, country, gender, dateOfBirth }` whitelist (`backend/graphql/pothos/admin/admin-user.pothos.ts:318-334`). *Options:* (1) add `password` to `AdminUpdateUserInput`; (2) a new `adminSetUserPassword(id, input: AdminSetUserPasswordInput!)` whose input is exactly `{ password: String!, mustChangePassword: Boolean! }`. *Decision:* (2), scoped `{ $all: { authenticated: true, role: [UserRole.Admin] } }` (precedent `admin-users.mutation.ts:64-69`). *Rationale:* a distinct credential operation deserves a distinct audit contract (`changedFields: ["credentials"]`), a distinct failure taxonomy, and a distinct rate-limit home (deferred D3); folding it into the profile patch would silently widen a documented whitelist and blur the audit semantics of every future `updateUser` row.
- **D3 — Single canonical repo write: `UserRepository.updatePassword`.** *Context:* `AdminUserRepository` has governance/profile writers but no password writer (`backend/db/repo/admin/admin-user.repository.ts:340-351`); the admin service already calls `UserRepository.create` (`backend/services/admin/user-management.service.ts:261`) and `UserRepository` owns persistence for users (`backend/db/repo/users/user.repository.ts:43,75,106,130`). *Options:* (1) extend `AdminUserRepository` with a password writer; (2) add `updatePassword(userId, passwordHash, mustChangePassword, tx)` beside `updateLocale` (`:130`). *Decision:* (2). *Rationale:* one user-write home; the admin service is a consumer of `UserRepository` already, and the self-service path (`AuthService.changeMyPassword`) needs the same writer — duplicating it into the admin repo would create two password-write sites to keep in sync.
- **D4 — Admin orchestration in `AdminUserManagementService.setUserPassword`.** *Context:* `updateUser` (`backend/services/admin/user-management.service.ts:331-374`) is the established admin-write template: strict actor guard → id validation → validation → `withTransaction` → repo write → audit → detail re-read. *Options:* (1) a new admin service module; (2) a sibling method on the existing service. *Decision:* (2) — `setUserPassword(id, input: AdminSetUserPasswordSubmitInput, actorId, locale, outerTx?)`. Sequence: `assertActorAdminActive(actorId, locale, outerTx)` (strict; deleted/blocked/suspended actor → Forbidden) → `isPositiveSafeInteger(id)` else `ValidationError(tErrors.validation)` (`user-management.helpers.ts:78`) → password validation (empty ⇒ `PASSWORD_REQUIRED`, `< MIN_PASSWORD_LENGTH=8` ⇒ `PASSWORD_TOO_SHORT`, reusing `authTranslations.passwordRequired`/`passwordTooShort` per `user-management.helpers.ts:147,168-172`) → `hashPassword` BEFORE the transaction (the `createUser` `:290` precedent) → `withTransaction`: `UserRepository.updatePassword` (null ⇒ `NotFoundError("USER", tErrors.adminUsers.userNotFound)`) + `AuditService.createAuditLog(buildAuditContract(actorId, AuditActionType.Update, id, { changedFields: ["credentials"], mustChangePassword }))` (`audit.service.ts:82`; `buildAuditContract` `user-management.helpers.ts:334`) → return `getUserDetail(id, locale, actorId, tx)` (`:221`). *Rationale:* reuse of the shipped guard/audit/detail pipeline keeps the new admin surface diff-mechanical. NO self-guard on admin targets — D5 of the ledger records the stricter "cannot change another admin's password" alternative (specs §Constraints: admins are trusted).
- **D5 — Self-service `changeMyPassword` is the ONLY flag-clearing path.** *Context:* a flagged user must be able to regain access, and the flag must not clear by a no-op. *Options:* (1) a separate reset mutation that trusts the current session and skips current-password verification; (2) a `changeMyPassword` that verifies the current password. *Decision:* (2) — `AuthService.changeMyPassword(userId, currentPassword, newPassword, locale, outerTx?)` (model `updateMyLocale` `backend/services/auth/auth.service.ts:282`), surfaced as `changeMyPassword(input: ChangeMyPasswordInput!): User!` in `backend/graphql/mutation/user.mutation.ts` beside `updateMyLocale` (`:49`), scoped `{ authenticated: true }`. Sequence: `findById` → `comparePassword(currentPassword, user.passwordHash)` (`backend/lib/auth/password.ts:27`) false ⇒ `ValidationError("CURRENT_PASSWORD_INVALID", …)`; new == current ⇒ `ValidationError("NEW_PASSWORD_SAME_AS_CURRENT", …)`; length rules as D4; `hashPassword(new)` → `withTransaction`: `updatePassword(id, hash, false)` → return the password-stripped updated `User`. *Rationale:* knowing the temporary credential is exactly the proof the holder is the intended user; the same-as-current rejection prevents a "change" that silently clears the flag while leaving the temporary credential live.

- **D6 — Server-authoritative forced gate in three layers, ZERO new queries.** *Context:* scope is declared per field and there is no default scope (`backend/graphql/pothos/builder.ts:34-36,120-150`); the context factory already fetches the user row per request (`backend/graphql/gqlContextFactory.ts:205-245`, fetch `:212-220`), so `ctx.user.mustChangePassword` is free. *Options:* (1) a JWT claim + a token-expiry wait; (2) a per-field scope on every gated field; (3) a global Apollo operation guard keyed on the DB-backed context. *Decision:* (3), plus two client-side mirrors: (a) an Apollo Server plugin in `app/api/graphql/apollo-server.ts` (added to the existing `plugins` array beside `createGraphqlErrorsFinalizerPlugin()`) implementing `requestDidStart → didResolveOperation`; it reads the root field names of `requestContext.operation` and, for a flagged caller, throws `ForbiddenError("PASSWORD_CHANGE_REQUIRED", tErrors.passwordChangeRequired)` when any non-allowlisted root field is present; (b) `withPageAuth` (`frontend/lib/auth/withPageAuth.ts:67`) gains `allowMustChangePassword?: boolean` (default `false`) that redirects to `/change-password` after the auth check and before the role check; (c) a client redirect inside `DashboardLayout` (mounted by `app/(dashboard)/layout.tsx:16`; the auth redirect lives there today). The allowlist is a CLOSED set of root field names: `me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken`. *Rationale:* a per-request guard reading `ctx.user` needs no new query, covers every field including ones added later, and is authoritative because it reads the DB row refreshed on each request — a flag set after token issuance takes effect immediately. The two client mirrors make the UX immediate (and are non-authoritative by construction). Un-flagged users are a strict no-op (REQ-005.6).
- **D7 — `/change-password` is a TOP-LEVEL page, never a nav item.** *Context:* the client dashboard redirect and the login redirect must not form a loop; `navItems.ts` must stay byte-unchanged (REQ-011.6). *Options:* (1) put the page inside the `(dashboard)` group; (2) a top-level `app/change-password/page.tsx` outside the group. *Decision:* (2), guarded by `withPageAuth({ allowMustChangePassword: true })`. The page renders a small centered form (current / new / confirm) that calls `changeMyPassword`, then routes the user to their role dashboard via `roleDashboardPath` (`frontend/lib/auth/roleDashboardRoute.ts`). *Rationale:* the `(dashboard)` group's `DashboardLayout` client redirect targets `/change-password`; a page inside the group would be caught by its own redirect and loop. Top-level keeps the target outside the guarded boundary, matching the "never navigate to a bare loop-prone path" rule documented in `roleDashboardRoute.ts`. It is a forced gate, not a destination — surfacing it in nav would invite voluntary use and duplicate the deferred profile card (D4).
- **D8 — i18n: namespace handles only, flat-string discipline in `adminUsers`.** *Context:* the `adminUsers` namespace parity walker REJECTS function leaves (`shared/locale/adminUsers-namespace.parity.test.ts:136-145`), and the repo forbids `Translation.` enums and `t('key')` calls (REQ-002.2). *Options:* (1) a new namespace; (2) extend the three existing namespaces. *Decision:* (2) — extend `AdminUsersLabels` (`shared/locale/types/adminUsers/index.ts:27`) with a `changePasswordDialog` block (title, subtitle, newPasswordLabel, confirmPasswordLabel, mustChangePasswordLabel, mustChangePasswordHelper, submit, cancel) + `detail.mustChangePasswordLabel` / `detail.mustChangePasswordValue` + `snackbars.passwordChanged` + the directory menu label `changePasswordAction` — flat strings / ICU bands ONLY; extend the `Auth` namespace (`shared/locale/types/auth/index.ts`) with a `changePassword` block (page title/description, current/new/confirm labels, submit, mismatch, success, temporaryPasswordNotice); extend `errorsTranslations` (`shared/locale/types/errors/labels.ts`) with `passwordChangeRequired`, `currentPasswordInvalid`, `newPasswordSameAsCurrent`. Implement EN + AR and update the parity pins. *Rationale:* each surface already has exactly one namespace home (`AdminUsers` for admin chrome, `Auth` for the login-form-adjacent forced page, `errorsTranslations` for server denials); a new namespace buys nothing and would add a parity belt.
- **D9 — Tests + census: journey first, then layers, then the drift belt.** *Context:* the feature is cross-actor (admin writes → user forced to change), the census bijection test keeps admin-gated mutations ↔ audit action types honest (`test/workflows/admin/audit-completeness.catalog.ts:84-120`; `audit-completeness.journey.test.ts:226-232`). *Options:* (1) unit-only coverage; (2) a cross-actor journey plus layer tests plus census registration. *Decision:* (2) — journey `test/workflows/admin/admin-password-reset.journey.test.ts` (specs REQ-008, 8 ordered steps, test-first; real services + DB, committed fixtures + tracked cleanup, NO `runInRollback`); a repo test (`runInRollback` + `tx`) for `updatePassword`; service tests for `setUserPassword` and `changeMyPassword`; an extension to `frontend/graphql/test/admin/admin-users.integration.test.ts` and the document lock `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts`; and census registration of `adminSetUserPassword` in `ADMIN_ACTION_CENSUS` + `USER_LIFECYCLE_LEG` with `expectedActionTypes: [AuditActionType.Update]`. *Rationale:* the load-bearing contract is the shared-state transition (temporary credential → forced change → gate clears), which only a real-DB journey can prove; the census row prevents the new admin mutation from drifting out of the audit catalogue. NO session revocation (deferred D2), NO mail/OTP (D1), NO rate limit (D3), and the profile `ChangePasswordCard` stays disabled (D4).

## 2. UX / Navigation Specification

### 2.1 New Routes & URLs

| Route | Kind | Purpose | Permission / guard |
|---|---|---|---|
| `/change-password` (NEW) | top-level page, `app/change-password/page.tsx` | Forced self-service password change — the only flag-clearing page | `withPageAuth({ allowMustChangePassword: true })` — any authenticated role |
| `/admin/users` (existing) | page | Gains the row-level "Change password" kebab item | `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` (`app/(dashboard)/admin/users/page.tsx:31`) — unchanged |
| `/admin/users/[id]` (existing) | page | Gains the hero "Change password" button | `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` (`app/(dashboard)/admin/users/[id]/page.tsx:34`) — unchanged |

No other `app/` route, layout, or group changes. `/change-password` deliberately lives OUTSIDE the `(dashboard)` group so the client dashboard redirect cannot loop (D7).

### 2.2 Sidebar / Navigation Integration

- `frontend/views/dashboard/nav/navItems.ts` — **byte-unchanged** (REQ-011.6). `/change-password` is a forced gate reached by redirect, not a destination; the admin block already owns `/admin/users`.
- Mobile bottom nav: **N/A** — the repo has no bottom-nav surface anywhere.
- Mount points (admin actions): the directory kebab menu (`frontend/views/admin/users/directory/DirectoryActionsMenu.tsx:33`; Edit `:49-57`, Deactivate/Reactivate `:58-81`) and the detail hero (`frontend/views/admin/users/detail/UserHeroActions.tsx:35`; Certify `:45-55`, Edit `:56-64`).

### 2.3 Role-Based Access Matrix (the surfaces this plan touches)

| Role | `/change-password` | `adminSetUserPassword` | `changeMyPassword` | `/admin/users*` pages | Gated ops while flagged |
|---|---|---|---|---|---|
| `admin` | ✅ (if flagged) | ✅ any non-deleted user (`role: [Admin]` + `assertActorAdminActive`) | ✅ self | ✅ (existing) | ❌ `PASSWORD_CHANGE_REQUIRED` |
| `teacher` | ✅ (if flagged) | ❌ scope-layer 403 (`role: [Admin]`) | ✅ self | ❌ page guard redirect | ❌ `PASSWORD_CHANGE_REQUIRED` |
| `student` | ✅ (if flagged) | ❌ scope-layer 403 | ✅ self | ❌ page guard redirect | ❌ `PASSWORD_CHANGE_REQUIRED` |
| `parent` | ✅ (if flagged) | ❌ scope-layer 403 | ✅ self | ❌ page guard redirect | ❌ `PASSWORD_CHANGE_REQUIRED` |
| anonymous | ❌ redirect `/login?redirect=` | ❌ `UNAUTHORIZED` (scope) | ❌ `UNAUTHORIZED` (scope) | ❌ redirect | ❌ `UNAUTHORIZED` |

### 2.4 Per-Audience Rendering

| Audience | Rendering |
|---|---|
| Admin | Directory kebab item + detail hero button open `ChangeUserPasswordDialog` (new password with show/hide, confirm, "Require the user to change this password on next login"). On success: dialog closes, shared snackbar shows `snackbars.passwordChanged`, and the directory/detail refetches. Detail page shows a "password reset pending" indicator when `mustChangePassword` is true. |
| Flagged user (any role) | Every dashboard page redirects to `/change-password` (SSR `withPageAuth` + client `DashboardLayout`). The page renders the current/new/confirm form and a message explaining a temporary password was issued; on success the user is routed to their role dashboard. |
| Un-flagged user | Zero change. The profile page keeps the deferred inert `ChangePasswordCard` placeholder (`frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx:20-21`; D4 of the ledger). |

### 2.5 Permission Mapping (exact ids)

| Surface | Enforcement point |
|---|---|
| `/change-password` | `withPageAuth({ allowMustChangePassword: true })` — authenticated only |
| `/admin/users`, `/admin/users/[id]` | `withPageAuth({ roles: [UserRole.Admin] })` — existing, unchanged guard + additive `allowMustChangePassword` default `false` |
| `adminSetUserPassword` | Pothos `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (`admin-users.mutation.ts:64-69`) + service `assertActorAdminActive` (defense in depth) |
| `changeMyPassword` | Pothos `authScopes: { authenticated: true }` |
| Flagged-account gate | Apollo op-guard allowlist (D6a) + `withPageAuth` redirect (D6b) + `DashboardLayout` client redirect (D6c) |
| UI denial | `FORBIDDEN` / `VALIDATION` codes → dialog inline errors via `useAdminUserFormFeedback` (`frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:34`); `PASSWORD_CHANGE_REQUIRED` → client redirect to `/change-password` |

## 3. Data Models

### 3.1 NEW column: `users.must_change_password`

```typescript
// backend/db/schema/users/users.ts:11-45 (added to the existing pgTable columns)
import { boolean } from "drizzle-orm/pg-core";

// Added alongside `passwordHash` (`:18`); server default → existing rows read false.
mustChangePassword: boolean("must_change_password").default(false).notNull(),
```

Auto-carried (no manual interface edits) into:

| Type | Definition | Citation |
|---|---|---|
| `UserSelectType` / `UserInsertType` | `$inferSelect` / `$inferInsert` | `backend/types/users/user.types.ts:3-4` |
| `RegistrationReturnType` | `Omit<UserSelectType, "passwordHash"> & { preferredRecitation }` — carries `mustChangePassword` | `backend/types/users/registration.types.ts:94-96` |
| `AdminUserSafeSelect` | `Omit<UserSelectType, "passwordHash">` — carries `mustChangePassword` | `backend/types/admin/admin-user.types.ts:18` |
| `AdminUserDetailReturnType` | `extends AdminUserSafeSelect { applicant; teacher; student; parent }` | `backend/types/admin/admin-user.types.ts:192-197` |

`AuthSession.user` is `RegistrationReturnType` (`backend/types/users/auth.types.ts:29-38`), so the flag rides the login payload without adding a `LoginPayload` field (`LoginPayload.user` is a `User` — `backend/graphql/pothos/auth/auth-payload.pothos.ts:44-58`).

### 3.2 NEW service input types (backend/types)

```typescript
// backend/types/admin/admin-user.types.ts (new; sibling of AdminUpdateUserPatchInput `:233-239`)
export interface AdminSetUserPasswordSubmitInput {
  readonly password: string;
  readonly mustChangePassword: boolean;
}
```

```typescript
// backend/types/users/auth.types.ts (new; sibling of the AuthService input family)
export interface ChangeMyPasswordSubmitInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}
```

Rules: both are closed, property-mapped shapes (BOPLA — never a spread of the GraphQL input); no field is server-derived, and neither carries `role`, `email`, `passwordHash`, or any governance field.

### 3.3 NEW repository write

```typescript
// backend/db/repo/users/user.repository.ts (beside updateLocale `:130`, create `:106`)
export async function updatePassword(
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
  tx: DBTransaction
): Promise<UserSelectType | null> {
  const [row] = await tx
    .update(users)
    .set({ passwordHash, mustChangePassword })
    .where(eq(users.id, userId))
    .returning();
  return row ?? null;
}
```

`updated_at` re-stamps via the column `$onUpdate` hook (same as `updateLocale`). The caller hashes BEFORE calling (the `create` docblock contract, `:100-105`); the returned row INCLUDES `passwordHash` — service layers strip it (`RegistrationReturnType` / `AdminUserSafeSelect`).

### 3.4 Consumed, unchanged

| Type | Role | Citation |
|---|---|---|
| `AdminUserUpdatePatchInput` / `AdminUserUpdateDbPatch` | Closed profile patch — NOT touched (D2) | `backend/types/admin/admin-user.types.ts:233-239,266-268` |
| `AuditLogWriteContract` | Audit row shape consumed by `createAuditLog` | `backend/services/admin/audit.service.ts:70-90` |
| `Min password length = 8` | Reused verbatim, no new complexity rule | `backend/services/admin/user-management.helpers.ts:32` |

## 4. API Contracts

### 4.1 NEW SDL (generated from Pothos, then `bun codegen`)

```graphql
input AdminSetUserPasswordInput {
  password: String!
  mustChangePassword: Boolean!
}

input ChangeMyPasswordInput {
  currentPassword: String!
  newPassword: String!
}

extend type Mutation {
  adminSetUserPassword(id: Int!, input: AdminSetUserPasswordInput!): AdminUserDetail!
  changeMyPassword(input: ChangeMyPasswordInput!): User!
}

# Two existing object types gain exactly one field each:
type User {
  # …existing fields… mustChangePassword: Boolean!
}

type AdminUserDetail {
  # …existing fields… mustChangePassword: Boolean!
}
```

- `adminSetUserPassword`: scope `$all: { authenticated: true, role: [UserRole.Admin] }`; resolver prelude mirrors `resolveAdminUserMutationTarget(ctx.user, args.id)` (`admin-users.mutation.ts:47-56`) → delegates to `AdminUserManagementService.setUserPassword(id, input, actorId, ctx.locale)`. Registered as a side-effect `gqlSchemaBuilder.mutationField(...)` in `backend/graphql/mutation/admin/admin-users.mutation.ts` (beside `adminUpdateUser` `:94-126`).
- `changeMyPassword`: scope `{ authenticated: true }`; resolver delegates to `AuthService.changeMyPassword(ctx.user.id, input.currentPassword, input.newPassword, ctx.locale)`. Registered in `backend/graphql/mutation/user.mutation.ts` (beside `updateMyLocale` `:49`), returns the same canonical `UserPothosObject` `me`/`login` return so Apollo normalizes the write into the existing entry.
- `UserPothosObject` (`backend/graphql/pothos/users/user.pothos.ts:30-91`) gains `mustChangePassword: t.boolean({ resolve: parent => parent.mustChangePassword ?? false })` (the read-only-governance-field pattern, `isDeleted` `:82-84`).
- `AdminUserDetailPothosObject` (`backend/graphql/pothos/admin/admin-user.pothos.ts:225-290`) gains `mustChangePassword: t.field({ type: "Boolean", nullable: false, resolve: parent => parent.mustChangePassword ?? false })`.
- The Apollo op-guard allowlist (D6a) references `changeMyPassword` by root field name; `adminSetUserPassword` is deliberately NOT on the allowlist (a flagged user can never be an admin-setting-others actor path that matters — it is simply denied like every other gated field).

### 4.2 NEW frontend documents

```typescript
// frontend/graphql/sharedDocuments/admin/admin-users.documents.ts
export const adminSetUserPasswordMutationDocument: TypedDocumentNode<
  AdminSetUserPasswordMutation,
  AdminSetUserPasswordMutationVariables
> = gql`
  mutation AdminSetUserPassword($id: Int!, $input: AdminSetUserPasswordInput!) {
    adminSetUserPassword(id: $id, input: $input) {
      ...AdminUserDetailFields
    }
  }
  ${ADMIN_USER_DETAIL_FIELDS}
`;
```

```typescript
// frontend/graphql/sharedDocuments/auth/auth.documents.ts (existing — already owns updateMyLocale)
export const changeMyPasswordMutationDocument: TypedDocumentNode<
  ChangeMyPasswordMutation,
  ChangeMyPasswordMutationVariables
> = gql`
  mutation ChangeMyPassword($input: ChangeMyPasswordInput!) {
    changeMyPassword(input: $input) {
      id
      email
      fullName
      role
      mustChangePassword
    }
  }
`;
```

- `ADMIN_USER_DETAIL_FIELDS` (`frontend/graphql/sharedDocuments/admin/admin-users.documents.ts:55`) gains `mustChangePassword` so every existing detail fragment selection picks it up (REQ-009.5). The barrel (`frontend/graphql/sharedDocuments/admin/index.ts:18`) auto re-exports the new document.
- Imports use `import { gql, type TypedDocumentNode } from "@apollo/client"` (mutation hooks from `@apollo/client/react` — `useAdminUsersDirectory.ts:20`, `useAdminUserDetail.ts:25`).

### 4.3 Failure contract (UI mapping)

| Condition | Error code (+ `extensions.fields`) | UI branch |
|---|---|---|
| `adminSetUserPassword`: password empty | `VALIDATION` + `[{ field: "password", code: "PASSWORD_REQUIRED" }]` | inline field error via `extractFieldErrors` / `useAdminUserFormFeedback` |
| `adminSetUserPassword`: password `< 8` | `VALIDATION` + `[{ field: "password", code: "PASSWORD_TOO_SHORT" }]` | inline field error |
| `adminSetUserPassword`: target id missing | `USER_NOT_FOUND` (`NotFoundError("USER", …)`) | dialog form-level error (adminUsers `userNotFound`) |
| `adminSetUserPassword`: caller not admin | `FORBIDDEN` (scope layer) or service `ForbiddenError` | dialog form-level denial; no write occurs |
| `changeMyPassword`: current password wrong | `VALIDATION` + `[{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID" }]` | inline error on the current-password field |
| `changeMyPassword`: new == current | `VALIDATION` + `NEW_PASSWORD_SAME_AS_CURRENT` | inline error on the new-password field |
| `changeMyPassword`: new `< 8` / empty | `VALIDATION` + `PASSWORD_TOO_SHORT` / `PASSWORD_REQUIRED` | inline field error |
| Flagged caller, non-exempt operation | `FORBIDDEN` + `PASSWORD_CHANGE_REQUIRED` | client redirect to `/change-password` (Apollo error-mapping seam) |
| Anonymous caller | `UNAUTHORIZED` (scope) | existing Apollo error-link redirect |

All denials are constant-shape and leak no field beyond the explicit `extensions.fields` payload; error codes are enforced by `backend/lib/errors/error-code-taxonomy.ts:43-47`.

## 5. Services / Repositories

| Surface | Signature (file:line) | Role in this plan |
|---|---|---|
| `UserRepository.updatePassword` | `(userId: number, passwordHash: string, mustChangePassword: boolean, tx: DBTransaction) => Promise<UserSelectType \| null>` — NEW, `backend/db/repo/users/user.repository.ts` (beside `updateLocale` `:130`) | The single password-write home (D3) |
| `UserRepository.findById` / `byEmail` | `(id)` / `(email)` — `backend/db/repo/users/user.repository.ts:75,43` | Consumed by the context factory + `changeMyPassword` identity load |
| `hashPassword` / `comparePassword` | `(plaintext) => Promise<string>` / `(plaintext, storedHash) => Promise<boolean>` — `backend/lib/auth/password.ts:18,27` | bcryptjs, 12 rounds; the only hashing/compare primitives |
| `AdminUserManagementService.setUserPassword` | `(id, input: AdminSetUserPasswordSubmitInput, actorId, locale, outerTx?) => Promise<AdminUserDetailReturnType>` — NEW, `backend/services/admin/user-management.service.ts` (model `updateUser` `:331-374`) | Admin orchestration (D4) |
| `AdminUserManagementService.getUserDetail` | `(userId, locale, actorId, outerTx?)` — `backend/services/admin/user-management.service.ts:221` (not-found `:237-242`) | Post-write detail re-read inside the tx |
| `AuthService.changeMyPassword` | `(userId, currentPassword, newPassword, locale, outerTx?) => Promise<RegistrationReturnType>` — NEW, `backend/services/auth/auth.service.ts` (model `updateMyLocale` `:282`) | Self-service; the only flag clearer (D5) |
| `assertActorAdminActive` | `(actorId, locale, outerTx?)` — `backend/services/admin/admin-gate.helpers.ts:133` | Strict admin gate for the write path |
| `AuditService.createAuditLog` | `(input: AuditLogWriteContract, tx: DBTransaction) => Promise<void>` — `backend/services/admin/audit.service.ts:82` | Shares the tx commit fate |
| `buildAuditContract` | `(actorId, actionType, entityId, details) => AuditLogWriteContract` — `backend/services/admin/user-management.helpers.ts:334-348` | Names-only, 2000-char truncated |
| `withTransaction` | `<T>(outerTx, fn) => Promise<T>` — `backend/lib/db/with-transaction.ts:42` | SAVEPOINT when an outer `tx` is supplied |
| Apollo op-guard plugin | NEW factory (e.g. `createPasswordChangeGatePlugin`) added to the `plugins` array in `app/api/graphql/apollo-server.ts` | Global forced-reset gate (D6a) |
| `withPageAuth` | `(options?: WithPageAuthOptions) => Promise<WithPageAuthResult>` — `frontend/lib/auth/withPageAuth.ts:67` | MODIFIED: `allowMustChangePassword?: boolean` (D6b) |

### 5.1 Concurrency & Caching Assessment

- **Atomicity.** Each password write is a single `UPDATE … WHERE id = ?` inside one `withTransaction`; without it, the hash and the flag would be two lost-update surfaces. Two concurrent `adminSetUserPassword` calls for the same id serialize on the row lock — last writer wins, and each writes its own audit row (the actor is the audit key, so no lost audit).
- **Hash-before-tx.** Hashing (the ~100ms bcrypt cost) runs OUTSIDE the transaction (the `createUser` `:290` precedent), so the transaction stays short and never holds a row lock across CPU-bound work.
- **Gate cost.** The forced-reset gate adds ZERO queries: it reads `ctx.user.mustChangePassword` already fetched by `UserRepository.findById` in `gqlContextFactory.ts:212-220`. `withPageAuth` reuses the single `react.cache`-wrapped `getServerUserContext()` (`backend/lib/auth/server-auth.ts:119`) — no extra DB round-trip.
- **No cache to invalidate.** Admin directory/detail data is fetched per request by Apollo with `refetchQueries` after a write (`useAdminUsersDirectory.ts:77-93`); the repo has no server-side cache keyed on the user row. The self-service path returns the canonical `User` so Apollo normalizes `mustChangePassword: false` into the existing cache entry, letting the client proceed without a re-login.
- **Token expiry window (accepted).** No session store exists (`backend/services/auth/auth.service.ts:236-240`); existing tokens stay valid until expiry. The gate blocks REQUESTS (each reads fresh DB state), not TOKENS — so a flagged user cannot act even with a still-valid token (deferred D2 records token revocation).

### 5.2 Cross-Actor Journey Design (J1 — maps to REQ-008's ordered step list)

**Shared-Entity State Machine (the fence):**

```
users.must_change_password (one boolean per user row):
  false ──adminSetUserPassword{mustChangePassword:true}──▶ true
    ▲                                                        │
    │                                                        ├──changeMyPassword (self, current password verified)──▶ false
    └──adminSetUserPassword{mustChangePassword:false}────────┘  (admin "direct change" clears any prior flag)
  Invariant: the flag is written ONLY by UserRepository.updatePassword, reached ONLY from
  AdminUserManagementService.setUserPassword (admin, audited) or AuthService.changeMyPassword (self, unaudited).
  login NEVER writes the flag.
```

**Side-Effect Matrix (this plan's rows):**

| Transition/Event | `users` row writes | Audit rows | Notifications | Denials (zero writes) |
|---|---|---|---|---|
| Admin sets password (flag = either) | 1 `UPDATE` (hash + flag) | 1 (`Update`, `changedFields: ["credentials"]`, `mustChangePassword`) | ZERO | — |
| Non-admin calls `adminSetUserPassword` | ZERO | ZERO | ZERO | scope 403 / service `ForbiddenError` |
| `changeMyPassword` success | 1 `UPDATE` (hash + flag=false) | ZERO (self-service, un-audited) | ZERO | — |
| `changeMyPassword` wrong current / same / too short | ZERO | ZERO | ZERO | `VALIDATION` with field codes |
| Flagged user calls a non-exempt op | ZERO | ZERO | ZERO | `FORBIDDEN` / `PASSWORD_CHANGE_REQUIRED` |
| Flagged user loads a dashboard page | ZERO | ZERO | ZERO | redirect to `/change-password` |
| Keep-alive while flagged | ZERO | ZERO | ZERO | `login`/`me`/`logout`/`updateMyLocale`/`refreshToken` remain callable |

**Cross-Actor Visibility (who sees what, when) — IS the journey's assertion set:**

| State | Admin (actor) | Target (flagged) | Non-admin actor | Anonymous |
|---|---|---|---|---|
| Before any write (flag false) | detail shows no pending-reset indicator | full dashboard access | — | — |
| Admin sets temp password (flag true) | audit row visible; detail shows pending-reset indicator | can `login` with temp password; `session.user.mustChangePassword === true`; every gated op → `PASSWORD_CHANGE_REQUIRED`; pages → `/change-password` | calling `adminSetUserPassword` → `FORBIDDEN`, zero audit | `changeMyPassword` → `UNAUTHORIZED` |
| Target calls `changeMyPassword` (correct current, distinct new) | flag now false; detail indicator gone | flag cleared; previously denied op now succeeds; re-login with temp password FAILS, with new password succeeds | — | — |
| Admin sets a direct (non-forced) password | flag forced to false; audit row present | normal login, no gate | — | — |

`passwordHash` is absent from EVERY output shape above (deep-field assertion in the wire suite, `frontend/graphql/test/admin/admin-users.integration.test.ts:479-713` precedent).

## 6. Component Design

| File | Modeled on | Responsibility |
|---|---|---|
| `backend/db/schema/users/users.ts` (MODIFIED) | own `passwordHash` column `:18` | Add `mustChangePassword: boolean("must_change_password").default(false).notNull()` |
| `backend/db/repo/users/user.repository.ts` (MODIFIED) | own `updateLocale` `:130` / `create` `:106` | Add `updatePassword(userId, passwordHash, mustChangePassword, tx)` — the single password write (D3) |
| `backend/types/admin/admin-user.types.ts` (MODIFIED) | own `AdminUpdateUserPatchInput` `:233-239` | Add `AdminSetUserPasswordSubmitInput` |
| `backend/types/users/auth.types.ts` (MODIFIED) | own `AuthSession` `:29-38` | Add `ChangeMyPasswordSubmitInput` |
| `backend/services/admin/user-management.helpers.ts` (MODIFIED) | own `validateCreateInput` password rules `:147,168-172` | Add `validatePasswordPolicy(password, tAuth): ApiFieldErrorType[]` (empty ⇒ `PASSWORD_REQUIRED`, `< 8` ⇒ `PASSWORD_TOO_SHORT`) shared by both service paths |
| `backend/services/admin/user-management.service.ts` (MODIFIED) | own `updateUser` `:331-374` | Add `setUserPassword(id, input, actorId, locale, outerTx?)` (D4) |
| `backend/services/auth/auth.service.ts` (MODIFIED) | own `updateMyLocale` `:282` | Add `changeMyPassword(userId, currentPassword, newPassword, locale, outerTx?)` (D5) |
| `backend/graphql/pothos/admin/admin-user.pothos.ts` (MODIFIED) | own `AdminUserDetailPothosObject` `:225-290`, closed whitelist `:318-334` | Add `AdminUserDetail.mustChangePassword`; add NEW `AdminSetUserPasswordInput` (do NOT touch the whitelist) |
| `backend/graphql/pothos/users/user.pothos.ts` (MODIFIED) | own `isDeleted` field `:82-84` | Add `User.mustChangePassword: Boolean!` |
| `backend/graphql/mutation/admin/admin-users.mutation.ts` (MODIFIED) | own `adminUpdateUser` `:94-126` | Register `adminSetUserPassword` (Admin scope) |
| `backend/graphql/mutation/user.mutation.ts` (MODIFIED) | own `updateMyLocale` `:49-89` | Register `changeMyPassword` (authenticated scope) |
| `backend/graphql/passwordChangeGate.ts` (NEW) | `backend/graphql/graphqlErrorsFinalizer.ts` plugin shape | The op-guard plugin factory + closed allowlist constant + pure `isPasswordChangeRequired(user, rootFields)` predicate (bun-testable) |
| `app/api/graphql/apollo-server.ts` (MODIFIED) | own `plugins` array | Add `createPasswordChangeGatePlugin(tErrors)` beside the error finalizer (D6a) |
| `frontend/lib/auth/withPageAuth.ts` (MODIFIED) | own `WithPageAuthOptions`/`withPageAuth` `:33-90` | Add `allowMustChangePassword?: boolean`; redirect to `/change-password` after auth, before the role check (D6b) |
| `app/change-password/page.tsx` (NEW) | `app/(dashboard)/admin/users/page.tsx:31` page-guard shape | Top-level page; `withPageAuth({ allowMustChangePassword: true })`; renders `ChangePasswordForm` (D7) |
| `frontend/views/auth/change-password/ChangePasswordForm.tsx` (NEW) | `frontend/views/auth/login/LoginForm.tsx` | Centered current/new/confirm form; calls `changeMyPassword`; on success routes via `roleDashboardPath` |
| `frontend/views/dashboard/layout/DashboardLayout.tsx` (MODIFIED) | own `useAuth()` redirect | Add the client redirect to `/change-password` when `user.mustChangePassword` (D6c) |
| `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` (MODIFIED) | own detail fragment `:55` | Add `mustChangePassword` to `ADMIN_USER_DETAIL_FIELDS`; add `adminSetUserPasswordMutationDocument` (D2/§4.2) |
| `frontend/graphql/sharedDocuments/auth/auth.documents.ts` (MODIFIED) | own `updateMyLocale` document (existing) | Add `changeMyPasswordMutationDocument` |
| `frontend/views/admin/users/hooks/useAdminUsersDirectory.ts` (MODIFIED) | own `useDirectoryMutations` `:77-93` | Add `setUserPassword` as the 4th directory mutation with `refetchQueries` |
| `frontend/views/admin/users/hooks/useAdminUserDetail.ts` (MODIFIED) | own mutation bundle `:84-95` | Add `setUserPassword` + the `changePasswordTarget` dialog triple |
| `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx` (NEW) | `frontend/views/admin/users/dialogs/EditUserDialog.tsx:64` (no-RHF `useState` form) | New password (show/hide), confirm, "require change on next login" checkbox; `useAdminUserFormFeedback` (`:34`); reuse `CreateUserCredentialField` (`:33`), `AdminDialogHeaderBand`/`AdminDialogFooterBand` (`:28,80`) |
| `frontend/views/admin/users/dialogs/DirectoryMutationDialogs.tsx` (MODIFIED) | own dialog composition `:35` | Mount the new dialog; clear `changePasswordTarget` on close |
| `frontend/views/admin/users/directory/DirectoryActionsMenu.tsx` (MODIFIED) | own Edit item `:49-57` | Add the "Change password" item; thread `onChangePassword` through `DirectoryUserRow.tsx:102`, `MobileUserCard.tsx:76`, `DirectoryResults.tsx:49-50,69-70` |
| `frontend/views/admin/users/detail/UserHeroActions.tsx` (MODIFIED) | own Edit button `:56-64` | Add the "Change password" button; thread through `UserDetailHero.tsx:64-66,127` and `AdminUserDetailContainer.tsx:109-111` |
| `shared/locale/{types,en,ar}/adminUsers`, `shared/locale/{types,en,ar}/auth`, `shared/locale/types/errors/labels.ts` (MODIFIED) | own namespace key sets | The new labels + parity pins (D8) |

MUI v9 discipline: layout style via `sx` only, theme-callback colors (`sx={theme => ({ color: theme.palette.primary.main })}`), `*Outlined` icon names, `fontWeight` via `sx`. No `console.*`; all diagnostics via `logger.logDomainError` (backend) / the Apollo error-mapping seam (frontend).

## 7. Security & Tenancy Mitigations

| Vector | Mitigation | Where |
|---|---|---|
| BOLA / IDOR | `changeMyPassword` takes NO identity argument — identity is `ctx.user.id` only; `adminSetUserPassword`'s `id` is an admin-only target validated by `isPositiveSafeInteger` and `resolveAdminUserMutationTarget` | §4.1, D5 |
| BOPLA / mass assignment | The password is written by a dedicated repo method taking exactly 3 fields; `AdminSetUserPasswordInput` is a NEW closed type; the closed `AdminUpdateUserInput` whitelist is untouched, so `mustChangePassword` is unreachable through any profile/registration input | D1/D2, §3.2 |
| BFLA | `adminSetUserPassword` denies at BOTH the scope layer (`role: [Admin]` → 403) and the service layer (`assertActorAdminActive` → `ForbiddenError`) — defense in depth; `changeMyPassword` is `authenticated` only (self) | §2.5, D6 |
| Hash never returned | Every response is `RegistrationReturnType` / `AdminUserSafeSelect` (both `Omit<UserSelectType, "passwordHash">`); the wire suite deep-walks for `passwordHash` | §3.1, §8 |
| Plaintext never persisted/logged/audited | `hashPassword` (bcrypt, 12 rounds) runs before persistence; the audit `details` carries only `changedFields: ["credentials"]` + the boolean flag; no `console.*` anywhere | D4, §5.1 |
| Timing/enumeration oracle on `changeMyPassword` | `comparePassword` is constant-time bcrypt; the identity missing case and the wrong-password case produce a single `CURRENT_PASSWORD_INVALID` shape after identity is established (existence is never disclosed) | D5, REQ-006.2 |
| Forced-gate bypass | The gate is server-authoritative and reads the DB-backed `ctx.user` (not a JWT claim); the client-side `withPageAuth` redirect and `DashboardLayout` redirect are UX mirrors only, not the enforcement boundary | D6, REQ-005.5 |
| Token-revocation gap (KNOWN, DEFERRED) | No server-side session store exists (`backend/services/auth/auth.service.ts:236-240`), so an existing token is not revoked on password change; the gate blocks every non-exempt REQUEST while the flag is set, which is the hit radius this plan owns. Token revocation is deferred item D2 | D6, §5.1 |
| Enum-as-value discipline | `AuditActionType.Update` (`backend/enum/audit/audit-action-type.enum.ts:6`) and `UserRole.Admin` (`backend/enum/users/user-role.enum.ts:5`) are imported as VALUES (never `import type`); no string literals for enum members | §5, REQ-002.6 |

## 8. Testing Strategy

| Layer | File(s) | Approach |
|---|---|---|
| Repo unit | `backend/db/test/logic/users/user.repository.test.ts` (extend) | `runInRollback` + pass `tx` to every repo call; assert `updatePassword` returns the row for an existing id, returns `null` for a missing id, and that re-writing is idempotent; assert the flag persists as given (both directions) |
| Service unit | `backend/services/admin/user-management.service.test.ts` (extend); `backend/db/test/logic/auth/auth.service.test.ts` (extend) | `setUserPassword`: guard/id/validation/not-found branches, one audit row on success, zero on denial, `passwordHash` absent from the return; `changeMyPassword`: wrong-current, same-as-current, too-short, empty, success clears flag, `comparePassword` verified against the new hash (precedent `registration.service.test.ts:45,479-525`) |
| Op-guard predicate | `backend/graphql/passwordChangeGate.test.ts` (NEW) | 100% branch coverage of the pure `isPasswordChangeRequired(user, rootFields)` predicate: flagged + allowlisted → pass; flagged + non-allowlisted → throw; un-flagged → pass; multi-root operation with one non-exempt field → throw |
| GraphQL wire / permission matrix | `frontend/graphql/test/admin/admin-users.integration.test.ts` (extend) | Non-admin → `FORBIDDEN`; admin → success; deep `passwordHash` walk on the new mutation's output; audit count asserted (the `:479-713` precedent) |
| Document lock | `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` (extend) | Add the new document row (currently 9 rows, `:198-289`) and assert `mustChangePassword` is selected in `ADMIN_USER_DETAIL_FIELDS` |
| Cross-actor journey | `test/workflows/admin/admin-password-reset.journey.test.ts` (NEW) | Real services + DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`; unique `jrn_adminpwd_<uuid8>` prefix; the 8 ordered steps of REQ-008 (set temp → login sees flag → non-admin denied zero-audit → gated op denied → `changeMyPassword` clears → denied op now allowed → re-login semantics swapped → clean cleanup). Run via `bun run test/scripts/run-test.ts` |
| Audit census drift | `test/workflows/admin/audit-completeness.catalog.ts` + `audit-completeness.journey.test.ts` | Register `adminSetUserPassword` in `ADMIN_ACTION_CENSUS` (`:84-120`) + `USER_LIFECYCLE_LEG` (`:226-232`) with `expectedActionTypes: [AuditActionType.Update]`, `expectedEntityType: "user"`, `kind: "wired"` |
| i18n parity | `shared/locale/adminUsers-namespace.parity.test.ts`, auth + errors parity belts | Stay green with the new flat-string keys + pins (no function leaves in `adminUsers`) |
| Component layer | NONE | The repo has no static/component UI test layer — verifiable logic lives in the pure op-guard predicate + service helpers (bun-tested); the journey owns cross-actor behavior |
| E2E | NONE new | The forced-reset journey is fully exercised at the service/wire boundary; no live-gated UI suite is added |

## 9. Deployment & Rollback

- **Order:** (1) schema column + `bun run db push`; (2) repo writer + types; (3) services + helpers; (4) Pothos types/mutations + `bun run generate:gqlSchema` + `bun codegen`; (5) op-guard plugin + `withPageAuth` + `/change-password` + admin UI + i18n; (6) tests + census. Each step is independently type-checkable via `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`.
- **Migration safety:** `ADD COLUMN must_change_password boolean NOT NULL DEFAULT false` on an existing table is safe and instant on Postgres; existing rows read `false`, so the gate is a no-op for every current user.
- **Rollback:** the column is additive and ignored by all old code paths, so reverting the SDL/UI leaves no broken state. To fully back out, drop the two mutations + the op-guard plugin registration + the `withPageAuth` option; the column may remain (harmless) until a follow-up. No data backfill to undo.
- **Compatibility:** purely additive to the schema and the API; the only modified shared surface is `withPageAuth`'s options object (a new optional key) and the two Pothos objects (one new field each — non-breaking for existing selections).

## Outcome & Knowledge Transfer Protocol

- BEFORE any task: read every file under `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/outcome/` (starting with `00-research-evidence-pack.md`).
- AFTER any task: write `outcome/<task-id>-outcome.md` (research findings, implementation details, cross-file dependencies, carry-over points) and flip the matching checkbox in `tasks.md`.
- Every modified/new file must pass `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (exit 0) before it is used elsewhere.
- Knowledge propagation target: `docs/admin/user-management.md` (final task) — extend the canonical admin user-management contract with the `adminSetUserPassword` operation, the `mustChangePassword` flag, the forced-reset gate, and the "the audit trail never carries credentials" rule; cross-reference `docs/auth/user-registration.md` for the `changeMyPassword` self-service path.
