# Research Evidence Pack — #228 Admin Change User Password (with Reset-on-Login)

> Plan: `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> Produced 2026-09-30 from a 6-area read-only codebase sweep of `/home/ahmed/Projects/kottaby_kottaby`. Every row is a verified `path:line` + real symbol/signature. Line numbers are from the sweep; re-verify on touch.

## 1. Schema & types

| Fact | Citation |
|---|---|
| `users` pgTable columns: `id, fullName, email, phone, passwordHash, role, dateOfBirth, gender, country, locale, isDeleted, deletedAt, suspended, suspendedAt, suspendedPeriodDays, isBlocked, blockedAt, lastActiveAt, createdAt, updatedAt` — **NO reset/must-change column** | `backend/db/schema/users/users.ts:11-45` (`passwordHash` `:18`; unique email `:44`) |
| Child table `admin` (shared PK → `users.id` cascade) | `backend/db/schema/users/admin.ts:10-19` |
| Enums: `userRole`, `gender`, `appLocale` | `backend/db/schema/enums.ts:9,11,21` |
| `auditActionType` pgEnum = `["create","update","delete","override","adjust","suspend","reactivate"]` — no password action | `backend/db/schema/enums.ts:113-121` |
| `UserSelectType` / `UserInsertType` = `$inferSelect` / `$inferInsert` | `backend/types/users/user.types.ts:3-4` |
| `RegistrationReturnType = Omit<UserSelectType,"passwordHash"> & { preferredRecitation }` → auto-carries new column | `backend/types/users/registration.types.ts:94-96` |
| `AdminUserSafeSelect = Omit<UserSelectType,"passwordHash">` → auto-carries new column | `backend/types/admin/admin-user.types.ts:18` |
| `AdminUserDetailReturnType extends AdminUserSafeSelect { applicant; teacher; student; parent }` | `backend/types/admin/admin-user.types.ts:192-197` |
| `AdminUpdateUserPatchInput` = `{ fullName?; phone?; country?; gender?; dateOfBirth? }` — **no password** | `backend/types/admin/admin-user.types.ts:233-239` |
| `AdminUserUpdateDbPatch` = `Partial<Pick<UserSelectType, "fullName"|"phone"|"country"|"gender"|"dateOfBirth">>` | `backend/types/admin/admin-user.types.ts:266-268` |
| `AuthSession = { user: RegistrationReturnType; accessToken; refreshToken; sessionId }` | `backend/types/users/auth.types.ts:29-38` |
| `RefreshResult` | `backend/types/users/auth.types.ts:48` |

## 2. Auth / password core

| Fact | Citation |
|---|---|
| `hashPassword(plaintext: string): Promise<string>` (bcryptjs, `BCRYPT_ROUNDS = 12`) | `backend/lib/auth/password.ts:18` (const `:12`) |
| `comparePassword(plaintext: string, storedHash: string): Promise<boolean>` — canonical comparator (no `verifyPassword` alias exists) | `backend/lib/auth/password.ts:27` |
| `AuthService.login(email, password, locale): Promise<AuthSession>` — `findByEmail` → `comparePassword` → `assertUserActive` → sign tokens. **No must-change branch.** | `backend/services/auth/auth.service.ts:153` (compare `:168`; verify call site `:156`; tokens `:183-185`) |
| `assertUserActive(user, message)` (private) checks `isDeleted || isBlocked || isSuspensionActive` | `backend/services/auth/auth.service.ts:98-122` (called `:180`) |
| `AuthService.refreshToken(token, locale): Promise<RefreshResult>`; comment: **no server-side session store; revocation NOT implemented** | `backend/services/auth/auth.service.ts:223`, `:236-240` |
| `AuthService.updateMyLocale(userId, locale, requestLocale, outerTx?)` | `backend/services/auth/auth.service.ts:282` |
| JWT: `signAccessToken`/`verifyAccessToken`/`signRefreshToken`/`verifyRefreshToken`/`generateSessionId`; access 15m, refresh 7d | `backend/lib/auth/jwt.ts:133,149,183,199,227` (`:33,:35`) |
| SSR auth `getServerUserContext = cache(async (): Promise<ServerUserContext>)` — verifies cookie, `UserRepository.findById`, governance fail-closed; returns `{ userId, user: RegistrationReturnType, role }` | `backend/lib/auth/server-auth.ts:119` (`ServerUserContext` `:56-63`; governance `:150-168`; strip `:71-74`) |
| `withPageAuth(options?): Promise<WithPageAuthResult>` — `withPageAuth.ts:67`; returns `{ userId, user, role }`; redirects `/login?redirect=` for anon, role dashboard for mismatch | `frontend/lib/auth/withPageAuth.ts:67` (result `:67-…`) |
| Dashboard group layout is a Server Component rendering the CLIENT `DashboardLayout` — **the auth redirect lives inside `DashboardLayout`** (`useAuth()`+`useRouter()`) | `app/(dashboard)/layout.tsx:16` |
| Cookie helpers `setAuthCookies`/`clearAuthCookies`/`AUTH_COOKIE_NAMES`/`createAuthCookieOut` | `backend/lib/auth/cookies.ts:174,190,35-42,48` |

## 3. GraphQL context & scope mechanism (load-bearing for the gate)

| Fact | Citation |
|---|---|
| Pothos scope-auth plugin; `AuthScopes` keys = `authenticated`, `role: UserRole[]`, `permission: string[]`, `superAdmin`, `notImpersonating` | `backend/graphql/pothos/builder.ts:91-105` |
| `authScopes: ctx => ({ authenticated: () => {throw UnauthorizedError if !ctx.user}, role: roles => ctx.role ? roles.includes(ctx.role) : false, permission: () => true, superAdmin: () => ctx.isSuperAdmin, notImpersonating: true })` | `backend/graphql/pothos/builder.ts:120-150` (`permission` placeholder `:137-139`) |
| Scopes are declared PER FIELD (`authScopes` option) — **there is no default scope applied to all fields** | `backend/graphql/pothos/builder.ts:34-36,120-150` |
| `createGraphQLContext` builds `ctx.user` from `UserRepository.findById(payload.userId)` (strips passwordHash) → `ctx.user: RegistrationReturnType \| null`; `ctx.permissions: []` | `backend/graphql/gqlContextFactory.ts:205-245` (fetch `:212-220`; `permissions` `:239`) |
| Apollo Server is constructed with a plugins array; route handler creates context via `createGraphQLContext(req)` | `app/api/graphql/apollo-server.ts` (plugins); `app/api/graphql/route.ts:99-108` (context hook) |
| Apollo plugins can implement `requestDidStart → didResolveOperation` (access `requestContext.operation` root fields + `context`) — the intended global gate point | `app/api/graphql/apollo-server.ts` (plugin convention) |
| `login` mutation: `LoginPayloadPothosObject`, args `{email, password}`, pushes cookies | `backend/graphql/mutation/auth.mutation.ts:80-100` |
| `me` query → `UserPothosObject`, `authScopes: { authenticated: true }`, resolves `ctx.user` | `backend/graphql/query/auth.query.ts:33-51` |
| `updateMyLocale` mutation lives in the user mutation file | `backend/graphql/mutation/user.mutation.ts:49` |
| `LoginPayload.user` is a `User` (so `mustChangePassword` flows through the user object — no payload field needed) | `backend/graphql/pothos/auth/auth-payload.pothos.ts:44-58` |

## 4. Admin user-management backend (extension points)

| Fact | Citation |
|---|---|
| `AdminUserManagementService` namespace; imports `hashPassword`, `AuditActionType`, errors, `assertActorAdmin`, governance helpers | `backend/services/admin/user-management.service.ts:96,55-62` |
| `listDirectory(filters, page, pageSize \| undefined, locale, actorId, outerTx?)` | `:106` |
| `getStats(locale, actorId, outerTx?)` | `:148` |
| `getUserActivity(userId, locale, actorId, limit?, outerTx?)` | `:182` |
| `getUserDetail(userId, locale, actorId, outerTx?)` | `:221` (not-found `:237-242`) |
| `createUser(input, actorId, locale, outerTx?)` — hashes before tx (`:290`) | `:261` |
| `updateUser(id, patch, actorId, locale, outerTx?)` — empty-patch guard + audit `changedFields` | `:331-374` |
| `setUserDeleted/setUserSuspended/setUserBlocked` delegate to axis helpers | `:382,399,424` |
| Invalid-id guard `isPositiveSafeInteger` → `ValidationError(tErrors.validation)` | `user-management.helpers.ts:78`; used e.g. `:193,:231,:347` |
| `validateCreateInput` password rules: empty → `PASSWORD_REQUIRED`, `<8` → `PASSWORD_TOO_SHORT` | `user-management.helpers.ts:147,168-172` |
| `MIN_PASSWORD_LENGTH = 8` | `user-management.helpers.ts:32` |
| `buildCreateUserInsert(input, passwordHash): UserInsertType` | `user-management.helpers.ts:246` |
| `buildUpdatePatch(input): AdminUserUpdateDbPatch` | `user-management.helpers.ts:273` |
| `buildAuditContract(actorId, actionType, entityId, details): AuditLogWriteContract` (2000-char trunc; names only) | `user-management.helpers.ts:334-348` |
| `projectChangedFields(details): readonly string[] \| null` | `user-management.helpers.ts:56` |
| Actor guards: `assertActorAdmin(actorId, locale, outerTx?)` / `assertActorAdminActive(actorId, locale, outerTx?)` (strict: deleted/blocked/suspended → ForbiddenError) | `backend/services/admin/admin-gate.helpers.ts:114` (assertActorAdmin) / `:133` (assertActorAdminActive) |
| `resolveAdminActorRow(actorId, locale, outerTx?)` — actorId 0 → Unauthorized; non-admin → Forbidden | `backend/services/admin/admin-gate.helpers.ts:64` |
| `withTransaction<T>(...)` | `backend/lib/db/with-transaction.ts:42` |
| Error classes `NotFoundError`/`UnauthorizedError`/`ForbiddenError`/`ValidationError`/`ConflictError`/`translateDbError` | `backend/lib/errors.ts:37,44,51,65,171,201` |
| Error-code HTTP map: `UNAUTHORIZED:401, FORBIDDEN:403, CONFLICT:409, VALIDATION:422` | `backend/lib/errors/error-code-taxonomy.ts:43-47` |

## 5. Repositories

| Fact | Citation |
|---|---|
| `UserRepository.findByEmail` / `findById` / `create(insert, tx)` / `updateLocale(userId, locale, tx)` — **no password writer** | `backend/db/repo/users/user.repository.ts:43,75,106,130` |
| `AdminUserRepository.updateProfileFields(id, patch: AdminUserUpdateDbPatch, tx?) → AdminUserSafeSelect \| null` — `SET {...patch, updatedAt}`, `.returning(SAFE_USER_SELECT)` | `backend/db/repo/admin/admin-user.repository.ts:340-351` |
| `AdminUserRepository.findDetailById` / `listDirectory` / `getStats` / `getActivity` / `setDeletedOnce` / `setSuspendedOnce` / `setBlockedOnce` / `findGovernanceState` | `admin-user.repository.ts:290,119,198,258,375,456,512,563` |
| `SAFE_USER_SELECT` (explicit columns, omits `passwordHash`) | `backend/db/repo/admin/admin-user-query-helpers.ts:27` |

## 6. GraphQL admin surface

| Fact | Citation |
|---|---|
| `adminCreateUser(input: AdminCreateUserInput!)` — scope `{ $all: { authenticated: true, role: [UserRole.Admin] } }` | `backend/graphql/mutation/admin/admin-users.mutation.ts:58,64-69` |
| `adminUpdateUser(id: Int!, input: AdminUpdateUserInput!)` | `:94,101-106` |
| `adminSetUserDeleted(id: Int!, deleted: Boolean!)` | `:127,134-139` |
| `adminSetUserSuspended(id, suspended, periodDays)` / `adminSetUserBlocked(id, blocked)` | `backend/graphql/mutation/admin/admin-governance.mutation.ts:45,75` |
| Resolver prelude `resolveAdminUserMutationTarget(user, rawId)` (Unauthorized if no user; `requirePositiveIntId`) | `admin-users.mutation.ts:47` |
| `AdminUserDetailPothosObject` fields (`id…parent`) — **no reset field** | `backend/graphql/pothos/admin/admin-user.pothos.ts:225-290` |
| `AdminUpdateUserInput` closed 5-field whitelist (documented) | `backend/graphql/pothos/admin/admin-user.pothos.ts:318-334` |
| `AdminCreateUserInput` = `{ ...userRegistrationInputFields(t) }` (includes `password: t.string({ required: true })`) | `admin-user.pothos.ts:313-315`; `backend/graphql/pothos/shared/userFieldHelpers.ts:97-107` |
| `UserPothosObject` explicit field list — `mustChangePassword` must be added explicitly | `backend/graphql/pothos/users/user.pothos.ts:30-91` (boolean resolver pattern `isDeleted` `:82-84`) |
| `adminOnlyAuthScopes` = `{ $all: { authenticated: true, role: [UserRole.Admin] } }`; `requireAdminUser(ctx)` | `backend/graphql/shared/admin-prelude.ts:24,32` |
| `UserRole` = `Admin="admin", Teacher="teacher", Student="student", Parent="parent"` | `backend/enum/users/user-role.enum.ts:5-10` |
| `AuditActionType` = `Create, Update, Delete, Override, Adjust, Suspend, Reactivate` | `backend/enum/audit/audit-action-type.enum.ts:6` |
| **Permission layer is inert**: `permission: () => true`; `ctx.permissions = []`; no permission enum/seed/table exists | `backend/graphql/pothos/builder.ts:137-139`; `backend/graphql/gqlContextFactory.ts:239` |

## 7. Frontend admin surface

| Fact | Citation |
|---|---|
| Routes: directory `withPageAuth({ roles: [UserRole.Admin], redirectTo: "/admin/users" })` | `app/(dashboard)/admin/users/page.tsx:31` |
| Detail `withPageAuth(...)` + `<AdminUserDetailContainer userId={Number(id)} />` | `app/(dashboard)/admin/users/[id]/page.tsx:34-36` |
| Documents: `adminUsersQueryDocument` `:110`, `adminUserStatsQueryDocument` `:130`, `adminUserDetailQueryDocument` `:148`, `adminUserActivityQueryDocument` `:163`, `adminCreateUserMutationDocument` `:179`, `adminUpdateUserMutationDocument` `:189`, `adminSetUserDeleted/Suspended/Blocked` `:199,209,222` | `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` |
| `ADMIN_USER_DETAIL_FIELDS` fragment (no reset field) | `admin-users.documents.ts:55` |
| Barrel auto re-exports new doc exports | `frontend/graphql/sharedDocuments/admin/index.ts:18` |
| Directory kebab menu — natural mount for a new item | `frontend/views/admin/users/directory/DirectoryActionsMenu.tsx:33` (Edit `:49-57`, Deactivate/Reactivate `:58-81`) |
| Row/mobile wiring of `onEdit`/`onDelete` | `DirectoryUserRow.tsx:102`; `MobileUserCard.tsx:76`; `DirectoryResults.tsx:49-50,69-70` |
| Detail hero actions — natural mount | `frontend/views/admin/users/detail/UserHeroActions.tsx:35` (`:45-85`); threaded `UserDetailHero.tsx:64-66,127`; `AdminUserDetailContainer.tsx:109-111` |
| Inline dialogs on detail | `frontend/views/admin/users/detail/UserDetailInlineDialogs.tsx:34` (edit `:38-54`, certify `:56-76`, delete `:78-95`) |
| Directory dialog rendering + targets | `frontend/views/admin/users/dialogs/DirectoryMutationDialogs.tsx:35`; target state `frontend/views/admin/users/hooks/useDirectoryPageAndDialogs.ts:18-21` |
| Directory mutations hook (4th mutation to add) | `frontend/views/admin/users/hooks/useAdminUsersDirectory.ts:77-93` (`refetchQueries` `:80`) |
| Detail hook mutations + dialog state | `frontend/views/admin/users/hooks/useAdminUserDetail.ts:84-95` |
| Form-feedback hook `{ fieldErrors, formError, runWithFeedback }` | `frontend/views/admin/users/hooks/useAdminUserFormFeedback.ts:34`; helpers `frontend/lib/graphql-error-utils.ts:17,37,94` |
| Password field with show/hide (reuse) | `frontend/views/admin/users/dialogs/CreateUserCredentialField.tsx:33` |
| Dialog bands / footer submit | `frontend/views/admin/users/dialogs/AdminDialogBands.tsx:28,80,108` |
| `EditUserDialog` (no-RHF `useState` form precedent) | `frontend/views/admin/users/dialogs/EditUserDialog.tsx:64` |
| Snackbar component | `frontend/views/admin/users/dialogs/AdminUserDialogs.tsx:28` |
| Mutations import `@apollo/client/react` | `useAdminUsersDirectory.ts:20`, `useAdminUserDetail.ts:25` |
| Self-service placeholder (OUT OF SCOPE) | `frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx:20-21`; copy `shared/locale/en/dashboard/index.ts:67` |
| Dead "Forgot password?" link | `frontend/views/auth/login/LoginForm.tsx:47-49` |

## 8. i18n

| Fact | Citation |
|---|---|
| `AdminUsersLabels` interface | `shared/locale/types/adminUsers/index.ts:27` |
| Namespace handle `AdminUsers = defineNamespace<AdminUsersLabels>("adminUsers.adminUsers", t => t.adminUsersTranslations)` | `shared/locale/namespaces/adminUsers/adminUsers.namespace.ts:4-6` |
| Bundle key `adminUsersTranslations` | `shared/locale/en/messages.ts:48`; `shared/locale/ar/messages.ts:48` |
| Registry `AdminUsers` | `shared/locale/namespaces/registry.ts:13,44` |
| Parity test (rejects function leaves; pinned block list) | `shared/locale/adminUsers-namespace.parity.test.ts:54-117,136-145,277-283` |
| Existing password-adjacent keys: `createDialog.password` / `.passwordHelper` (`:227/:229`); `snackbars` block (`:505`) | `shared/locale/types/adminUsers/index.ts` |
| Admin `passwordHelper` en copy "…must change it on first login." (currently false advertising) | `shared/locale/en/adminUsers/index.ts:98` |
| Auth namespace password keys `password`/`passwordRequired`/`passwordTooShort`/show/hide/strength | `shared/locale/types/auth/index.ts:19,37,38,64,65,83-86` |
| `errorsTranslations.adminUsers` keys block (add password-denial keys to `errorsTranslations` itself) | `shared/locale/types/errors/labels.ts:161-195`; en `shared/locale/en/errors/index.ts:68` |
| Dashboard change-password placeholder keys | `shared/locale/types/dashboard/index.ts:104-113,141` |

## 9. Tests

| Fact | Citation |
|---|---|
| Frontend wire permission-matrix suite (7 admin ops; provisionAdminActor; deep `passwordHash` walk; audit counts) | `frontend/graphql/test/admin/admin-users.integration.test.ts:163-193,256-264,479-713` |
| Document structural lock (9 rows) — must extend for a new document | `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts:198-289` |
| Backend wire mutation suite precedent (in-process schema + `setupTestServerLifecycle`) | `backend/graphql/test/admin-teachers.mutation.test.ts:91` |
| DB logic patterns: `runInRollback`, `expectRepoError` | `backend/db/test/test-utils.ts:34,77` |
| Service test precedent (`comparePassword` assertions) | `backend/db/test/logic/auth/registration.service.test.ts:45,479-525` |
| entity-setup helpers: `createTestUser(tx, overrides)`, `createTestAdmin(tx, userId)` | `backend/db/test/entity-setup.ts:74,169` (`TEST_BCRYPT_STUB_HASH` `:63`) |
| `@/test/helpers`: `setupTestServerLifecycle`, `testClient`, `expectMutationError`, `deleteUsersByIds`, `countUsersByIds`, `withAuditDeleteTriggersSuspended`, `insertAdminUserWithChildRow` | `test/helpers/index.ts:1-14`; `test-lifecycle.ts:41-77`; `db-cleanup.ts:83,123,143`; `fixture-rows.ts:69-74` |
| Journey conventions (NO runInRollback; committed fixtures + tracked cleanup; `jrn_<domain>_<8hex>`) | `test/workflows/AGENTS.md:6-53` |
| Journey actor helpers: `provisionAdminActor(tx, options)`, `provisionStudentActor`, `provisionCertifiedTeacherActor`, `provisionParentActor` | `test/workflows/helpers/actor-context.ts:136,88,105,122` |
| Audit census (bijection drift test) + lifecycle leg | `test/workflows/admin/audit-completeness.catalog.ts:84-120`; `test/workflows/admin/audit-completeness.journey.test.ts:226-232` |
| Admin journey precedent (direct service calls + `expectJourneyError`) | `test/workflows/admin/admin-user-lifecycle.journey.test.ts:46,102`; `admin-user-denials.journey.test.ts:46,57-62` |
| Runner: `bun run test/scripts/run-test.ts <path>` | `test/workflows/AGENTS.md:91` |

## 10. Prior art & specs of record

| Fact | Citation |
|---|---|
| Shipped admin CRUD ticket excluded password reset | `ai/finished_plans/milestone_3_parent_portal_admin_governance/admin-crud-users-teachers-students-paren/specs.md:30` |
| Admin user-management contract doc (REQ-060, no password op; `passwordHash` never projected) | `docs/admin/user-management.md:119,190` |
| Login path uses `comparePassword` (bcrypt) | `docs/auth/user-registration.md:274-278` |
| No FR/INV authorizes admin password set or force-reset (gap) | `docs/specs/functional-requirements.md:8-33`; `docs/specs/state-machine-invariants.md:247-251` |
| M3 name/scope | `docs/planning/MILESTONE_PLAN.md:249-251` |
| Owning ticket M3 | `docs/planning/TICKETS.md:2221-2266` (`| **Milestone** | 3 |` `:2225`) |
| `ai/plans/` is untracked in git — the plan dir is the record | `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher-preparation/outcome/plan-review-R1.md:56` |
