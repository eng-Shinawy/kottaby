# Tasks — Admin Change User Password (with Reset-on-Login)

> **Plan directory (verbatim):** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Outcomes:** `outcome/`
> **Ticket:** GitHub issue `#228 — Admin Can't change users password from the dashboard` (`/admin/users/` · Change Password, option to require reset on next login) · M3 (admin-governance stream; owning shipped ticket `docs/planning/TICKETS.md:2221-2266` → `| **Milestone** | 3 |` at `:2225`)
> **Evidence pack:** `outcome/00-research-evidence-pack.md` — every `path:line` below is cited from it; re-verify on touch.

## Document Information

| Field | Value |
|---|---|
| Version / Date | 1.0 · 2026-09-30 |
| Sequencing | Schema → repo → services → GraphQL → gate → i18n → admin UI → `/change-password` → verification (journey → census → stories) → gates → propagation. Backend chain is linear; i18n (Task 8) is independent after Task 0 and may run in parallel with Tasks 2-7 |
| Phase 2.5 mid-point gate | **SKIPPED** — single backend+frontend feature (~15 tasks) with a linear chain and no independent parallel workstreams large enough to justify a mid-point checkpoint. The journey test (Task 11) is authored test-first against the locked contracts (D2/D4/D5/D6) and is the integration gate that would otherwise be the mid-point reviewer |
| Drizzle | ONE schema delta → ONE `bun run db push` (Task 1, Drizzle schema-push convention; no custom SQL) + `bun codegen` (new SDL fields, Tasks 5-6). No `db migrate`; no backfill script (existing rows read server default `false`, REQ-009.3) |

## Non-Negotiable Execution Protocol (all tasks)

1. Read ALL files in `outcome/` before starting a task; write `outcome/<task-id>-outcome.md` on completion and flip the task checkbox `[ ]` → `[x]`.
2. After ANY file edit: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → exit 0 (sub-loop auto-prints the applicable `AGENTS.md` + `.agents/instructions/*` — read them all first). Never mark a subtask complete before exit 0.
3. Complete the semantic-review checklist before `[x]`: tenancy/BOLA, race conditions, enums-as-values, no cross-layer imports, no dead code, deferred items logged — the sub-loop cannot detect these.
4. Test-first for the journey (Task 11): author it against the locked contracts before the UI mount tasks; it is the cross-actor integration gate.
5. Never `console.*`. Server denials use `logger.logDomainError` with a stable `code` (`PASSWORD_CHANGE_REQUIRED`, `CURRENT_PASSWORD_INVALID`); client diagnostics go through the existing Apollo error-mapping seam (`frontend/lib/graphql-error-utils.ts`) — zero bespoke toast plumbing.
6. Banned patterns: no `Translation.` enum, no two-arg `getTranslations(locale, "ns")`, no `@/frontend/utils/logger`, no `useLazyQuery`, no `next-intl`, no bottom-nav. Workflow tests run via `bun run test/scripts/run-test.ts <path>` — NEVER raw `bun test`.
7. Enum members are imported as VALUES: `AuditActionType.Update` (`backend/enum/audit/audit-action-type.enum.ts:6`), `UserRole.Admin` (`backend/enum/users/user-role.enum.ts:5`).
8. Never widen the closed `AdminUpdateUserInput` whitelist (`backend/graphql/pothos/admin/admin-user.pothos.ts:318-334`); never add a session store / token revocation / mail delivery (D2, D1); never touch `frontend/views/dashboard/nav/navItems.ts` (REQ-011.6).

### Layer → rule-file map (absolute; sub-loop re-prints them)

| Layer touched here | AGENTS.md | `.agents/instructions/` |
|---|---|---|
| Backend schema `/home/ahmed/Projects/kottaby_kottaby/backend/db/schema/users/` | `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Backend repo `/home/ahmed/Projects/kottaby_kottaby/backend/db/repo/users/` | `…/backend/db/repo/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Backend services `/home/ahmed/Projects/kottaby_kottaby/backend/services/` | `…/backend/services/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Backend GraphQL `/home/ahmed/Projects/kottaby_kottaby/backend/graphql/` | `…/backend/graphql/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Backend types `/home/ahmed/Projects/kottaby_kottaby/backend/types/` | `…/backend/types/AGENTS.md`, `…/backend/AGENTS.md`, root | `backend.instructions.md` |
| Frontend views `/home/ahmed/Projects/kottaby_kottaby/frontend/views/admin/users/` | `…/frontend/views/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Frontend documents `/home/ahmed/Projects/kottaby_kottaby/frontend/graphql/sharedDocuments/admin/` | `…/frontend/graphql/sharedDocuments/AGENTS.md`, `…/frontend/graphql/AGENTS.md`, `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| App Router `/home/ahmed/Projects/kottaby_kottaby/app/` | `…/app/AGENTS.md`, root | `frontend.instructions.md` |
| Shared locale `/home/ahmed/Projects/kottaby_kottaby/shared/locale/` | `…/shared/AGENTS.md`, root | — |
| Stories `/home/ahmed/Projects/kottaby_kottaby/frontend/stories/admin/` | `…/frontend/AGENTS.md`, root | `frontend.instructions.md` |
| Workflows `/home/ahmed/Projects/kottaby_kottaby/test/workflows/` | `…/test/workflows/AGENTS.md`, root | `tests.instructions.md` |

## Phase 0 — Baseline & Ledger

- [ ] 0. Baseline capture + outcome ledger + `deferred-items.md` confirmation
  - Record baseline counts: `bun tsgo 2>&1 | grep -c "error TS" > /tmp/baseline-tsgo.txt`; `bun biome:check 2>&1 | grep -c "warn" > /tmp/baseline-biome.txt`; `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json`
  - Confirm `deferred-items.md` exists in the plan dir (D1..D6 accepted deferrals — email/OTP reset, session revocation, rate limit, profile `ChangePasswordCard`, admin-target policy, directory row chip — NOT blockers); read ALL files in `outcome/`
  - Write `outcome/0-baseline-outcome.md` (baseline counts + ledger confirmation)
  - [ ] 0.QL sub-loop `--lifecycle duplicates` on the new outcome file → 0
  - [ ] 0.TE baseline numbers captured to `/tmp/baseline-*` (comparison source for Task 14)
  - [ ] 0.SEC no secrets read/printed while recording baselines
  - [ ] 0.SR plandir is untracked in git — this dir is the record (do not expect history)
  - [ ] 0.IV root + `test/workflows/AGENTS.md` protocol rules
  - _Requirements: REQ-001_

## Phase 1 — Schema & Data Layer

- [ ] 1. `users.must_change_password` column + `db push` (D1, REQ-009)
  - `backend/db/schema/users/users.ts:11-45`: add exactly one column — `mustChangePassword: boolean("must_change_password").default(false).notNull()` (the `passwordHash` sibling style at `:18`)
  - Apply with `bun run db push` (no custom SQL; existing rows read `false` — no backfill, REQ-009.3)
  - Confirm the column auto-flows with NO manual interface edit: `UserSelectType`/`UserInsertType` (`backend/types/users/user.types.ts:3-4`), `RegistrationReturnType` (`backend/types/users/registration.types.ts:94-96`), `AdminUserSafeSelect` (`backend/types/admin/admin-user.types.ts:18`)
  - [ ] 1.QL sub-loop `--lifecycle duplicates` on `backend/db/schema/users/users.ts` → 0
  - [ ] 1.TE `bun tsgo` clean; `UserSelectType` exposes `mustChangePassword: boolean`
  - [ ] 1.SEC no password/reset value leaked into any type string; default is server-side `false`
  - [ ] 1.SR exactly ONE column added (schema-delta is the sanctioned exception, REQ-011); enums imported as values; no backfill script
  - [ ] 1.IV backend schema + `backend.instructions.md`
  - _Requirements: REQ-009_

- [ ] 2. `UserRepository.updatePassword` + repo test (D3, REQ-003, REQ-009)
  - `backend/db/repo/users/user.repository.ts`: add `updatePassword(userId: number, passwordHash: string, mustChangePassword: boolean, tx: DBTransaction): Promise<UserSelectType | null>` — mirror `updateLocale` (`:130`); `SET { passwordHash, mustChangePassword, updatedAt }`, `.where(eq(users.id, userId))`, `.returning()`; `tx` REQUIRED (no `db` fallback — single user-write home; D3). `AdminUserRepository` is NOT extended
  - Repo test under `backend/db/test/logic/users/`: use `runInRollback` + pass `tx` to EVERY repo call (`backend/db/test/test-utils.ts:34`); create fixtures via `createTestUser(tx, overrides)` (`backend/db/test/entity-setup.ts:74`); assert the new hash lands, the flag toggles true→false, and a non-existent id returns `null`
  - Run via `bun run test/scripts/run-test.ts <test-path>` (never raw `bun test`; NO `expect().rejects` inside `runInRollback`)
  - [ ] 2.QL sub-loop `--lifecycle duplicates` on repo + test file → 0
  - [ ] 2.TE repo suite green (create → update → re-read verifies); 100% branch coverage of `updatePassword`
  - [ ] 2.SEC returns the full row (hash included) ONLY to the service layer (never to GraphQL); no hash in logs
  - [ ] 2.SR `tx` mandatory param; no second user-write path; no local type defs (use `UserSelectType`/`DBTransaction` from `@/backend/types`)
  - [ ] 2.IV `backend/db/repo/AGENTS.md` + `backend.instructions.md` + `tests.instructions.md`
  - _Requirements: REQ-003, REQ-009_

## Phase 2 — Backend Services

- [ ] 3. `AdminUserManagementService.setUserPassword` + validation helpers + service test (D4, REQ-003, REQ-004, REQ-010)
  - `backend/services/admin/user-management.service.ts`: add `setUserPassword(id, input: AdminSetUserPasswordSubmitInput, actorId, locale, outerTx?): Promise<AdminUserDetailReturnType>` — model the sequence on `updateUser` (`:331-374`)
  - Ordered sequence: strict `assertActorAdminActive(actorId, locale, outerTx?)` (`backend/services/admin/admin-gate.helpers.ts:133`; deleted/blocked/suspended → `ForbiddenError`) → `isPositiveSafeInteger(id)` else `ValidationError(tErrors.validation)` (`user-management.helpers.ts:78`) → validate password (trimmed empty → `PASSWORD_REQUIRED`; `< MIN_PASSWORD_LENGTH = 8` → `PASSWORD_TOO_SHORT`; reuse the localized `authTranslations.passwordRequired`/`passwordTooShort`) → `hashPassword(plaintext)` BEFORE the tx (`backend/lib/auth/password.ts:18`; `createUser` precedent `:290`) → `withTransaction` (`backend/lib/db/with-transaction.ts:42`): `updatePassword` (`null` → `NotFoundError("USER", tErrors.adminUsers.userNotFound)`) + `AuditService.createAuditLog(buildAuditContract(actorId, AuditActionType.Update, id, { changedFields: ["credentials"], mustChangePassword }))` (`audit.service.ts:82`; `buildAuditContract` `user-management.helpers.ts:334`) → return `getUserDetail(id, locale, actorId, tx)` (`:221`)
  - NO self-guard on admin targets (D5 defers the stricter admin-target policy — admins are trusted)
  - Add pure helpers in `backend/services/admin/user-management.helpers.ts` only if extraction reduces the service body (validator + audit-details builder); no service-layer `.types.ts` files
  - Service test asserts: happy path (new hash verifies via `comparePassword`, flag true and false), empty → `PASSWORD_REQUIRED`, 7-char → `PASSWORD_TOO_SHORT`, missing id → `USER_NOT_FOUND`, non-admin actor → `FORBIDDEN`, ZERO audit rows on any denial, ONE audit row on success with `changedFields: ["credentials"]`
  - [ ] 3.QL sub-loop `--lifecycle duplicates` on service + helpers + test → 0
  - [ ] 3.TE service suite green via `bun run test/scripts/run-test.ts`; 100% branch coverage of the validator
  - [ ] 3.SEC hash before persistence; audit `details` NEVER contains the password/hash/reversible derivative (REQ-004.4); non-admin denied at service layer (defense in depth)
  - [ ] 3.SR no `AdminUserRepository` extension; errors via `@/backend/lib/errors`; enums as values; transaction rolls back if audit insert fails (REQ Reliability.1)
  - [ ] 3.IV `backend/services/AGENTS.md` + `backend.instructions.md` + `tests.instructions.md`
  - _Requirements: REQ-003, REQ-004, REQ-010_

- [ ] 4. `AuthService.changeMyPassword` + service test (D5, REQ-006)
  - `backend/services/auth/auth.service.ts`: add `changeMyPassword(userId, currentPassword, newPassword, locale, outerTx?): Promise<RegistrationReturnType>` — model on `updateMyLocale` (`:282`)
  - Sequence: `UserRepository.findById` → `comparePassword(currentPassword, user.passwordHash)` (`backend/lib/auth/password.ts:27`) false → `ValidationError("CURRENT_PASSWORD_INVALID", tErrors.currentPasswordInvalid)` (`extensions.fields = [{ field: "currentPassword", … }]`) → new == current → `ValidationError("NEW_PASSWORD_SAME_AS_CURRENT", tErrors.newPasswordSameAsCurrent)` → length rules as Task 3 → `hashPassword(new)` → `withTransaction`: `UserRepository.updatePassword(id, hash, false, tx)` → return the password-stripped updated user (`RegistrationReturnType`, `mustChangePassword: false`)
  - This is the ONLY flag-clearing path (REQ-006.6)
  - Service test: happy path clears the flag; wrong current → `CURRENT_PASSWORD_INVALID` with zero writes; same-as-current → `NEW_PASSWORD_SAME_AS_CURRENT`; empty/short new → `PASSWORD_REQUIRED`/`PASSWORD_TOO_SHORT`; returned user has NO `passwordHash`
  - [ ] 4.QL sub-loop `--lifecycle duplicates` on service + test → 0
  - [ ] 4.TE service suite green via `bun run test/scripts/run-test.ts`; constant-time compare asserted (`comparePassword`, REQ Security.3)
  - [ ] 4.SEC single denial shape after identity is established (no wrong-vs-missing oracle); no hash in response or logs
  - [ ] 4.SR reuses `hashPassword`/`comparePassword` (no rehash policy change); `tx` threaded; enums as values; no service `.types.ts`
  - [ ] 4.IV `backend/services/AGENTS.md` + `backend.instructions.md` + `tests.instructions.md`
  - _Requirements: REQ-006_

## Phase 3 — GraphQL Surface

- [ ] 5. `adminSetUserPassword` mutation + `AdminSetUserPasswordInput` + `mustChangePassword` Pothos fields + codegen + wire test (D2, REQ-003, REQ-007, REQ-009)
  - `backend/graphql/mutation/admin/admin-users.mutation.ts`: add `adminSetUserPassword` beside `adminUpdateUser` (`:94`): `args: { id: t.arg.int({ required: true }), input: t.arg({ type: AdminSetUserPasswordInput, required: true }) }`, `authScopes: { $all: { authenticated: true, role: [UserRole.Admin] } }` (precedent `:64-69`), resolver reuses `resolveAdminUserMutationTarget` (`:47`) → calls `AdminUserManagementService.setUserPassword`
  - `backend/graphql/pothos/admin/admin-user.pothos.ts`: NEW input `AdminSetUserPasswordInput { password: t.string({ required: true }), mustChangePassword: t.boolean({ required: true }) }` — EXACTLY two fields, NOT a widening of the closed `AdminUpdateUserInput` (`:318-334`, D2)
  - Add `mustChangePassword: Boolean!` to exactly TWO objects: `UserPothosObject` (`backend/graphql/pothos/users/user.pothos.ts:30-91`; boolean resolver pattern `isDeleted` `:82-84`) and `AdminUserDetailPothosObject` (`admin-user.pothos.ts:225-290`)
  - Run `bun run generate:gqlSchema` then `bun codegen`; commit generated artifacts
  - Extend `frontend/graphql/test/admin/admin-users.integration.test.ts` (`:163-193,256-264,479-713`): add `adminSetUserPassword` to the permission matrix (admin allowed; student/teacher/parent/anonymous denied `FORBIDDEN`/`UNAUTHORIZED`), assert the deep `passwordHash` walk is absent on the response (`deepFindKey(…, "passwordHash")` precedent), and assert ONE audit row on success
  - [ ] 5.QL sub-loop `--lifecycle duplicates` on mutation + pothos + test → 0
  - [ ] 5.TE wire/integration suite green via `bun run test/scripts/run-test.ts`; codegen types resolve; input is exactly 2 fields
  - [ ] 5.SEC `AdminUserDetail` stays `Omit<UserSelectType, "passwordHash">` (`admin-user.types.ts:18`) + deep-walk assertion; scope denies non-admin at the layer
  - [ ] 5.SR no local type defs in Pothos (import from `@/backend/types`); single canonical object type per entity; generated files never hand-edited
  - [ ] 5.IV `backend/graphql/AGENTS.md` + `backend/types/AGENTS.md` + `backend.instructions.md`
  - _Requirements: REQ-003, REQ-007, REQ-009_

- [ ] 6. `changeMyPassword` mutation + `ChangeMyPasswordInput` + codegen (D5, REQ-006)
  - `backend/graphql/mutation/user.mutation.ts`: add `changeMyPassword` beside `updateMyLocale` (`:49`): `args: { input: t.arg({ type: ChangeMyPasswordInput, required: true }) }`, `authScopes: { authenticated: true }`, returns `UserPothosObject`, resolver calls `AuthService.changeMyPassword(ctx.user.id, …)`
  - Define `ChangeMyPasswordInput { currentPassword: t.string({ required: true }), newPassword: t.string({ required: true }) }` (in the user mutation/pothos file where inputs for this domain live; no local type defs beyond the input)
  - Run `bun codegen`; commit generated artifacts
  - Extend the wire suite (or add a focused `backend/graphql/test/` case) proving: authenticated happy path returns `mustChangePassword: false` and no `passwordHash`; anonymous → `UNAUTHORIZED`; wrong current → `VALIDATION` `CURRENT_PASSWORD_INVALID`
  - [ ] 6.QL sub-loop `--lifecycle duplicates` on mutation + pothos + test → 0
  - [ ] 6.TE codegen resolves; wire test green via `bun run test/scripts/run-test.ts`
  - [ ] 6.SEC response is password-stripped; `authenticated` scope rejects anonymous; no field leak of the stored hash
  - [ ] 6.SR resolver delegates to the service (no business logic in the resolver); errors from `@/backend/lib/errors`; `ctx.t("errorsTranslations")` for messages
  - [ ] 6.IV `backend/graphql/AGENTS.md` + `backend.instructions.md`
  - _Requirements: REQ-006_

- [ ] 7. Server-authoritative forced gate: `withPageAuth` option + `DashboardLayout` redirect + Apollo operation-guard plugin (D6, REQ-005, REQ-011)
  - **(a) API layer** `app/api/graphql/apollo-server.ts` (plugins array): add an operation-guard plugin with `requestDidStart → didResolveOperation` that inspects root field names against the closed allowlist; for a caller whose `context.user.mustChangePassword === true` invoking any NON-allowlisted root field, throw `ForbiddenError("PASSWORD_CHANGE_REQUIRED", tErrors.passwordChangeRequired)` before execution. Allowlist (closed set): `me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken`. ZERO new queries — reads `ctx.user.mustChangePassword` sourced from `UserRepository.findById` in `backend/graphql/gqlContextFactory.ts:212-220`
  - **(b) SSR layer** `frontend/lib/auth/withPageAuth.ts:67`: add `allowMustChangePassword?: boolean` (default `false`) — after auth, before the role check, redirect a flagged user to `/change-password` unless the flag is set. Reuse the single cached `getServerUserContext()` (`backend/lib/auth/server-auth.ts:119`, `react.cache`) — no extra DB round-trip
  - **(c) Client layer** `frontend/views/dashboard/layout/DashboardLayout.tsx` (mounted by `app/(dashboard)/layout.tsx:16`, where the auth redirect lives): add a client redirect to `/change-password` when the session user is flagged — the immediate UX mirror of (b)
  - Add a focused test (backend guard predicate + allowlist predicate 100% branches; SSR helper branch) proving: flagged caller denied on a non-allowlisted field, allowed on each allowlisted field, no-op for un-flagged callers
  - [ ] 7.QL sub-loop `--lifecycle duplicates` on apollo-server + withPageAuth + layout + test → 0
  - [ ] 7.TE guard predicate + allowlist + redirect branches green via `bun run test/scripts/run-test.ts`; 100% branch coverage of the allowlist predicate
  - [ ] 7.SEC denial is constant `FORBIDDEN` + `PASSWORD_CHANGE_REQUIRED` (no field-trigger leak); gate reads DB truth, NOT a JWT claim (REQ-005.5); no redirect loop (`/change-password` is outside the gate)
  - [ ] 7.SR zero new queries; `/change-password` is a forced gate, NOT a nav item (`navItems.ts` byte-unchanged, REQ-011.6); no `app/api/**` route beyond this
  - [ ] 7.IV `backend/graphql/AGENTS.md` + `app/AGENTS.md` + `frontend.instructions.md`
  - _Requirements: REQ-005, REQ-011_

## Phase 4 — i18n & Frontend

- [ ] 8. i18n: `adminUsers` + `auth` + `errors` keys EN/AR + parity pins (D8, REQ-002, REQ-010)
  - `shared/locale/types/adminUsers/index.ts` (interface `:27`) + `shared/locale/en/adminUsers/index.ts` + `shared/locale/ar/adminUsers/index.ts`: add a `changePasswordDialog` block (title, subtitle, newPasswordLabel, confirmPasswordLabel, mustChangePasswordLabel, mustChangePasswordHelper, submit, cancel), `detail.mustChangePasswordLabel` / `detail.mustChangePasswordValue`, a `snackbars.passwordChanged`, and the directory menu label `changePasswordAction`. FLAT strings / ICU bands ONLY — this namespace's parity walker REJECTS function leaves (`shared/locale/adminUsers-namespace.parity.test.ts:136-145`)
  - `shared/locale/types/auth/index.ts` (`AuthLabels`): add a `changePassword` block (page title/description, current/new/confirm labels, submit, mismatch, success, temporaryPasswordNotice) + EN/AR in `shared/locale/en/auth/` + `shared/locale/ar/auth/`
  - `shared/locale/types/errors/labels.ts` (`errorsTranslations`): add `passwordChangeRequired`, `currentPasswordInvalid`, `newPasswordSameAsCurrent` + EN/AR in `shared/locale/en/errors/` + `shared/locale/ar/errors/`
  - Update the parity pins for `adminUsers` (and the auth/errors belts) so identical key sets hold; keep the existing `createDialog.password`/`.passwordHelper` copy in sync if touched
  - Run `bun run test/scripts/run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` → green
  - [ ] 8.QL sub-loop `--lifecycle duplicates` on all locale files + parity test → 0
  - [ ] 8.TE adminUsers/auth/errors parity belts green; identical key sets EN/AR; no function leaves in `adminUsers`
  - [ ] 8.SEC no identifiers/secrets inside copy; server messages surfaced via `ctx.t("errorsTranslations")`
  - [ ] 8.SR namespace handles only — NEVER a `Translation.` enum, NEVER `t('key')`; aliases inside `shared/locale/**` use `@/shared/...`; leaf modules contain no logic
  - [ ] 8.IV `shared/AGENTS.md` + `shared/locale` rules
  - _Requirements: REQ-002, REQ-010_

- [ ] 9. Admin document + detail fragment + hooks + `ChangeUserPasswordDialog` + mounts (D8, REQ-007)
  - `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`: add `adminSetUserPasswordMutationDocument` (`:179`-style) and add `mustChangePassword` to the `ADMIN_USER_DETAIL_FIELDS` fragment (`:55`, REQ-009.5); the barrel `frontend/graphql/sharedDocuments/admin/index.ts:18` auto re-exports it
  - `frontend/views/admin/users/hooks/useAdminUsersDirectory.ts` (`:77-93`): add the `adminSetUserPassword` mutation (4th mutation; `refetchQueries` `:80`); `frontend/views/admin/users/hooks/useAdminUserDetail.ts` (`:84-95`): add it + the `changePasswordTarget` dialog state (cleared on close)
  - Create `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx`: new-password field with show/hide (reuse `CreateUserCredentialField.tsx:33`), confirm-password field, a "Require the user to change this password on next login" checkbox; reuse `AdminDialogHeaderBand`/`AdminDialogFooterBand` (`AdminDialogBands.tsx:28,80`) + the `useState` form convention of `EditUserDialog.tsx:64` (no react-hook-form); surface field errors via `useAdminUserFormFeedback` (`:34`); on success close + shared success snackbar with `snackbars.passwordChanged`
  - Mounts: directory kebab item in `DirectoryActionsMenu.tsx:33` (beside Edit `:49-57`/Deactivate `:58-81`), wired through `DirectoryUserRow.tsx:102` / `MobileUserCard.tsx:76` / `DirectoryResults.tsx:49-50,69-70`; detail hero button in `UserHeroActions.tsx:35` (beside Certify `:45-55`/Edit `:56-64`), threaded through `UserDetailHero.tsx:64-66,127` and `AdminUserDetailContainer.tsx:109-111`; render the dialog from `DirectoryMutationDialogs.tsx:35` / `UserDetailInlineDialogs.tsx:34`
  - [ ] 9.QL sub-loop `--lifecycle duplicates` on all touched view/document files → 0
  - [ ] 9.TE document compiles against codegen types (`bun tsgo`); dialog branches exercised by Task 13 stories
  - [ ] 9.SEC field errors mapped, never raw messages; no navigation / no partial write on failure or close (REQ-007.6)
  - [ ] 9.SR MUI v9 `sx` discipline (no layout props on Typography/Stack/Box); icons `*Outlined`; theme-callback colors; mutations imported from `@apollo/client/react`; no member-local type defs
  - [ ] 9.IV `frontend/views/AGENTS.md` + `frontend/graphql/sharedDocuments/AGENTS.md` + `frontend.instructions.md`
  - _Requirements: REQ-007_

- [ ] 10. `/change-password` page + form/hook (D7, REQ-005, REQ-006)
  - Create TOP-LEVEL `app/change-password/page.tsx` (OUTSIDE the `(dashboard)` group so the client dashboard redirect cannot loop), guarded by `withPageAuth({ allowMustChangePassword: true })`
  - Small centered form (current / new / confirm) calling the `changeMyPassword` mutation; on success show the `auth.changePassword` success copy and route the user to their role dashboard; surface `CURRENT_PASSWORD_INVALID` / `NEW_PASSWORD_SAME_AS_CURRENT` / length errors inline; explain that a temporary password was issued (`temporaryPasswordNotice`)
  - Add the page's mutation hook beside the page (or reuse a small local hook); DO NOT touch the profile `ChangePasswordCard` placeholder (`frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx:20-21`, D4)
  - Dev-server smoke (agent-browser, DOM-first per global AGENTS.md): admin sets a temp password with the flag → flagged user login → any dashboard nav redirects to `/change-password` → submit new → proceeds normally; screenshot to `scratch/screenshots/` for human review
  - [ ] 10.QL sub-loop `--lifecycle duplicates` on the page + hook → 0
  - [ ] 10.TE form validation branches covered (mismatch, too-short, wrong current); smoke proves the wired end-to-end path
  - [ ] 10.SEC page is authenticated; `allowMustChangePassword: true` used ONLY here; no `passwordHash` exposure
  - [ ] 10.SR page outside `(dashboard)`; `navItems.ts` byte-unchanged; no `console.*`; MUI v9 `sx` discipline
  - [ ] 10.IV `app/AGENTS.md` + `frontend.instructions.md`
  - _Requirements: REQ-005, REQ-006_

## Phase 5 — Verification & Propagation

- [ ] 11. Journey `test/workflows/admin/admin-password-reset.journey.test.ts` (test-first, D9, REQ-008)
  - Test-first against the locked contracts: real services + DB, committed fixtures + tracked `afterAll` cleanup, NO `runInRollback`; unique `jrn_adminpwd_<uuid8>` prefixes (`test/workflows/AGENTS.md:6-53`); run via `bun run test/scripts/run-test.ts test/workflows/admin/admin-password-reset.journey.test.ts`
  - Helpers: `provisionAdminActor(tx, options)` + a target teacher/student actor (`test/workflows/helpers/actor-context.ts:136,88`); direct service calls (precedent `admin-user-lifecycle.journey.test.ts:46`); `expectJourneyError` (`admin-user-denials.journey.test.ts:57-62`)
  - Encode the 8 ordered steps (specs REQ-008): (1) fixtures commit; (2) admin `setUserPassword(targetId, { password: "TempPass123", mustChangePassword: true })` → new hash verifies + flag true + ONE `Update` audit row `changedFields: ["credentials"]`; (3) target `login` succeeds and `session.user.mustChangePassword === true` (login does NOT clear); (4) non-admin actor → `FORBIDDEN`, zero writes, zero audit rows; (5) target → a non-exempt operation → `PASSWORD_CHANGE_REQUIRED`; (6) target `changeMyPassword({ currentPassword: "TempPass123", newPassword: "NewPass456" })` → new hash verifies + flag false; (7) previously-denied op now ALLOWED, re-login with new password succeeds and old fails; (8) tracked `afterAll` → zero residue
  - [ ] 11.QL sub-loop `--lifecycle duplicates` on the journey file → 0
  - [ ] 11.TE journey green (8 steps incl. non-admin denial + flagged-gate denial legs); zero residue after cleanup
  - [ ] 11.SEC denial legs use honest roles (no monkey-patching); constant-shape denials (no existence oracle); `passwordHash` absent on every output (deep-field check, REQ-008.5)
  - [ ] 11.SR no `runInRollback`; no duplication of the lifecycle/denials journeys; notification boundary spied if the drive emits shipped waves (`test/workflows/AGENTS.md` rules 5+12)
  - [ ] 11.IV `test/workflows/AGENTS.md` + `tests.instructions.md`
  - _Requirements: REQ-008_

- [ ] 12. Document structural lock + audit-census registration (D9, REQ-010)
  - Extend `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts` (`:198-289`, 9 rows) with the new document row (`adminSetUserPasswordMutationDocument`) — same structural assertions as the sibling mutations
  - Register `adminSetUserPassword` in `ADMIN_ACTION_CENSUS` (`test/workflows/admin/audit-completeness.catalog.ts:84-120`) and in `USER_LIFECYCLE_LEG` (`test/workflows/admin/audit-completeness.journey.test.ts:226-232`) with `expectedActionTypes: [AuditActionType.Update]`
  - Run `bun run test/scripts/run-test.ts` for both: `admin-users.documents.test.ts` and `audit-completeness.journey.test.ts` → green
  - [ ] 12.QL sub-loop `--lifecycle duplicates` on both test files → 0
  - [ ] 12.TE document lock green; census drift test green (bijection holds; `Update` count reconciled)
  - [ ] 12.SEC census asserts a password op writes exactly ONE `Update` row (no orphan writes)
  - [ ] 12.SR `AuditActionType` imported as a VALUE; no census row duplicated; no bespoke audit path
  - [ ] 12.IV `frontend/graphql/sharedDocuments/AGENTS.md` + `test/workflows/AGENTS.md` + `tests.instructions.md`
  - _Requirements: REQ-010_

- [ ] 13. Admin dialog stories `frontend/stories/admin/` (D9, REQ-007)
  - Create `frontend/stories/admin/ChangeUserPasswordDialog.stories.tsx` (precedent `frontend/stories/admin/CertifyTeacherDialog.stories.tsx`; harness `frontend/stories/lib/storyHarness.tsx:12-18`): default (empty), filled, flagged-checkbox checked (helper text shown), field-error (`PASSWORD_TOO_SHORT`), form-error (`FORBIDDEN`), submitting/disabled
  - Mock `adminSetUserPassword` via `MockLink`; story data uses no real ids/emails
  - [ ] 13.QL sub-loop `--lifecycle duplicates` on the story file → 0
  - [ ] 13.TE each dialog branch of REQ-007.3/.4 renders in at least one story (human-verified visually; logic already unit/wire-proven)
  - [ ] 13.SEC story mocks carry no real credentials/ids
  - [ ] 13.SR stories stay in `frontend/stories/admin/`; no component logic added just to make a story work; no RHF
  - [ ] 13.IV `frontend/AGENTS.md` + `frontend.instructions.md`
  - _Requirements: REQ-007_

- [ ] 14. Final quality gate + deferred enforcement
  - `grep -c "❌\|⚠️" ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/deferred-items.md` → **exactly 0** (D1..D6 are accepted `⚪` deferrals; any blocker glyph blocks completion)
  - `bun quality-gate` (tsgo → oxlint → biome → lint → duplicates); baseline diff vs `/tmp/baseline-*` — zero NEW errors
  - `bun run test/scripts/run-test.ts test/workflows` green (new journey + pre-existing journeys unbroken); repo/service/wire/parity suites green
  - Scope audit: `git diff --name-only` contains NO session-store/revocation, NO mail/OTP delivery, NO `navItems.ts`, NO profile `ChangePasswordCard` edit, NO `app/api/**` route beyond the GraphQL guard (REQ-011)
  - Write `outcome/14-final-gate-outcome.md`
  - [ ] 14.QL sub-loop `--lifecycle duplicates` on any file touched during fixes → 0
  - [ ] 14.TE quality gate exits 0; all suites green; zero NEW baseline errors
  - [ ] 14.SEC `passwordHash` absent from every response shape (deep-walk assertions in wire + journey suites)
  - [ ] 14.SR zero blocker glyphs in the ledger; scope delta bounded to the plan's files
  - [ ] 14.IV root protocol rules
  - _Requirements: REQ-001, REQ-011_

- [ ] 15. Knowledge propagation → `docs/admin/user-management.md`
  - Read ALL outcome files; create `docs/admin/user-management.md` (Why → Pattern → Rules → What NOT to Do → Rollout Summary → Related): the admin direct-change vs reset-on-login distinction, the single `UserRepository.updatePassword` write home, the server-authoritative forced gate (allowlist + SSR + client-layers, DB truth not JWT), the `changeMyPassword` as the ONLY flag-clearing path, the `adminUsers` parity constraints (flat/ICU only), and the audit-census registration discipline
  - Do NOT touch `AGENTS.md` / `.agents/instructions/*` (hand-curated)
  - Write `outcome/15-knowledge-propagation-outcome.md`
  - [ ] 15.QL sub-loop `--lifecycle duplicates` on the new doc → 0
  - [ ] 15.TE doc links resolve; every cited symbol exists
  - [ ] 15.SEC no credentials/plaintext examples in the doc
  - [ ] 15.SR docs-only task; no source files mutated
  - [ ] 15.IV root + `docs/` conventions
  - _Requirements: REQ-001_

## Dependency Graph

0 → 1 → 2 → 3 → 5 → 7 → 9 → 10 → 11 → 14 → 15

(1 needs 0. 2 needs 1. 3 needs 2. 4 needs 2 (independent of 3). 5 needs 3. 6 needs 4. 7 needs 5. 8 is independent after 0 and may run in parallel with 2-7. 9 needs 5+8. 10 needs 6+8+9's document. 11 is authored test-first after 1 (contracts locked) but run at Phase 5. 12 needs 5+11. 13 needs 9. 14 needs 11+12+13. 15 needs 14.)
