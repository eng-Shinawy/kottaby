# Task 9 Outcome — Admin document + detail fragment + hooks + `ChangeUserPasswordDialog` + mounts (D8, REQ-007)

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `9. Admin document + detail fragment + hooks + ChangeUserPasswordDialog + mounts (D8, REQ-007)` (Phase 4 — admin UI)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent (COMPLETION PASS — resumed an interrupted agent's uncommitted work; verified everything, fixed nothing broken because nothing was broken)
> **Repo root used:** `/home/z/my-project`
> **Result:** 21 hand-authored files verified (2 NEW dialogs + 19 modified views/documents/test/fixtures), full-repo `bun tsgo` **0 errors / exit 0**, admin wire suite **49 pass / 0 fail / 319 expect()**, adminUsers parity belt **85 pass / 0 fail / 891 expect()**, sub-loop `--lifecycle duplicates` **exit 0 on 21/21 hand-authored files** (generated `graphql.ts` excluded from lint scope by the toolchain's ignore patterns — see §3.3).

## 1. What Was Implemented

### 1.1 Documents (`frontend/graphql/sharedDocuments/admin/admin-users.documents.ts`)

- `ADMIN_USER_DETAIL_FIELDS` fragment gains **`mustChangePassword`** (between `blockedAt` and `lastActiveAt`, mirroring the SDL order) — REQ-009.5. Every existing detail-fragment selection (directory list rows, detail query, create/update/delete mutation returns) picks the flag up.
- **NEW `adminSetUserPasswordMutationDocument`** — `mutation AdminSetUserPassword($id: Int!, $input: AdminSetUserPasswordInput!)` returning `...AdminUserDetailFields` (the plan §4.2 shape; the fragment splices above the mutation so the operation is self-contained). Typed as `TypedDocumentNode<AdminSetUserPasswordMutation, AdminSetUserPasswordMutationVariables>`; the generated types (`AdminSetUserPasswordMutation` / `AdminSetUserPasswordMutationVariables`) already existed in `frontend/graphql/generated/gql/graphql.ts` because codegen's typescript-operations pass scans this file — both were regenerated in this pass.
- Barrel `frontend/graphql/sharedDocuments/admin/index.ts` re-exports the documents file via `export * from "./admin-users.documents"` — the new document was exposed with **zero barrel edits** (as the task predicted).

### 1.2 Hooks

- **`useAdminUsersDirectory.ts`** — 4th directory mutation `setUserPassword` (`useMutation(adminSetUserPasswordMutationDocument, { refetchQueries: refetchAfterWrite, awaitRefetchQueries: true })` — identical refetch discipline to create/update/soft-delete), returned as `{ setUserPassword, passwordLoading }`; NEW dialog target state `changePasswordTarget: DirectoryUserItem | null` + `setChangePasswordTarget` owned beside the credential mutation it drives (create/edit/delete targets live in `useDirectoryPageAndDialogs`; this one stays with its mutation — documented in-file).
- **`useAdminUserDetail.ts`** — same mutation added to the inline bundle (cache-merge semantics: the returned detail fragment carries `mustChangePassword`, so the hero/governance indicator re-renders without a refetch; only the activity timeline refetches for the new audit row) + `changePasswordTarget: AdminUserChangePasswordTarget | null` dialog state, **cleared on close** (REQ-007.6). Returns `{ setUserPassword, passwordLoading, changePasswordTarget, setChangePasswordTarget }`.
- Both hooks import the mutation hook from `@apollo/client/react` (9.SR) and the document from the shared barrel.

### 1.3 Dialogs (NEW files)

- **`ChangeUserPasswordDialog.tsx`** (NEW) — the shared credential dialog, invoked from BOTH the directory and the detail surface. Composition is the `EditUserDialog` three-band recipe: `AdminDialogHeaderBand` (title/subtitle/close), tinted `DialogContent`, `AdminDialogFooterBand` (Cancel + submit), all inside a `<form onSubmit>`. State is the plain `useState` convention of `EditUserDialog` (NO react-hook-form, per REQ-007.5).
  - Client-side branches BEFORE any round-trip: **required** (trim-empty → `authTranslations.passwordRequired`), **`< 8` chars** (`passwordTooShort`; `MIN_CREDENTIAL_LENGTH = 8` mirrors the server policy), **confirm mismatch** (`authTranslations.changePassword.mismatch`). Client messages and server `fieldErrors` merge per-field at render time (`validationErrors.password ?? fieldErrors.password`).
  - Error propagation contract = `EditUserDialog`'s exactly: the caller's `onSubmit` MUST let rejections propagate (no try/catch at the call site); the dialog's `useAdminUserFormFeedback().runWithFeedback` catches once and projects VALIDATION field errors inline (`extractFieldErrors` on `extensions.fields` → `helperText`) and field-less denials into the top-level Alert. **On failure the dialog stays open; on plain close nothing is written and nothing navigates** (REQ-007.6).
  - Exports the minimal target shape `AdminUserChangePasswordTarget { id: number; fullName: string }` — both `DirectoryUserItem` and the detail projection satisfy it structurally, so no adapter objects exist.
- **`ChangeUserPasswordFormFields.tsx`** (NEW) — the extracted body stack (the `EditUserFormFields` pattern): form-level Alert, target-identity caption (names WHOSE credential is replaced), the new-password field with the **`CreateUserCredentialField` show/hide recipe verbatim** (`VisibilityOutlined`/`VisibilityOffOutlined` + `Tooltip` + borderless 44px-target `IconButton` with `focusVisibleRingSx`), the confirm field, and the **"Require the user to change this password on next login" checkbox** (`mustChangePassword`, off by default — the admin opts in) with its helper line. Show/hide state is local to the field; form state is owned by the dialog and threaded through.
- `dialogs/index.ts` barrel exports both new modules.

### 1.4 Mounts — directory (REQ-007.1)

`DirectoryActionsMenu.tsx`: **"Change password" `MenuItem`** with `KeyOutlined`, sitting **between Edit and Deactivate/Reactivate**; prop `onChangePassword` added and threaded through `DirectoryUserRow.tsx` → `DirectoryTable.tsx`, `MobileUserCard.tsx` → `MobileUserCardList.tsx`, and both consumed in `DirectoryResults.tsx` (table branch + mobile branch) wired to `directory.setChangePasswordTarget`. The labels `Pick`s at `DirectoryActionsMenu.tsx` and `DirectoryRowCells.tsx` (`RowCellLabels`) gained `"changePasswordAction"`. NO row-level pending-reset chip was added (REQ-004.3 defers it to D6).

### 1.5 Mounts — detail (REQ-007.2)

`UserHeroActions.tsx`: **"Change password" outlined button** (`KeyOutlined`, `minWidth: 168 / minHeight: 54` matching the sibling button row) between Edit and Deactivate-or-Reactivate; threaded through `UserDetailHero.tsx` (labels Pick + `onChangePassword`) and opened from `AdminUserDetailContainer.tsx` via `detail.setChangePasswordTarget({ id: user.id, fullName: user.fullName })`.

### 1.6 Mounts — dialog rendering (REQ-007.3/4)

- **`DirectoryMutationDialogs.tsx`** — renders `ChangeUserPasswordDialog` when `changePasswordTarget` is set (destructured so the truthiness check narrows the target inside the async closure — no `!` assertions), `key={target.id}`, `loading={directory.passwordLoading}`, `onClose={() => directory.setChangePasswordTarget(null)}`, `onSubmit` awaits `directory.setUserPassword({ variables: { id, input } })` then **closes + `setSnackbarMessage(labels.snackbars.passwordChanged)`** — success only.
- **`UserDetailInlineDialogs.tsx`** — same dialog from the detail state; after success it also `void detail.refetchActivity()` (the mutation appended an audit row).

### 1.7 Detail governance indicator (REQ-004.3)

`GovernanceCard.tsx` appends a "password reset pending" governance cell (`detail.mustChangePasswordLabel` + `detail.mustChangePasswordValue`) **only when `user.mustChangePassword` is true** — placed with the other boolean cells, before the timestamp-conditional rows. The directory row-level chip remains deferred (D6).

### 1.8 Wire test + fixtures

- `frontend/graphql/test/admin/admin-users.integration.test.ts`: the three probe sites (anonymous Tier 1, Tier 2 non-admin, Tier 3 admin happy path) were **swapped from the locally `parse`d probe document to the shared `adminSetUserPasswordMutationDocument` import** (single-source discipline; the Task-5 carry-forward). The local wire-shape interface + `parse` block were deleted; `TypedDocumentNode`/`graphql` `parse` imports dropped; suite docblock says "eight operations" throughout. `ADMIN_OPERATIONS` drift guard stays at 8.
- `frontend/stories/admin/AdminUserDetailPage.fixtures.ts`: the detail fixture gains `mustChangePassword: false` (Task 13 stories will flip it to exercise the GovernanceCard cell + dialog branches).

## 2. Files Created / Modified / NOT Modified

**Created (2):**
| File | Content |
|---|---|
| `frontend/views/admin/users/dialogs/ChangeUserPasswordDialog.tsx` | Shared credential dialog (both surfaces) |
| `frontend/views/admin/users/dialogs/ChangeUserPasswordFormFields.tsx` | Extracted body field stack |

**Modified (21):**
| File | Change |
|---|---|
| `frontend/graphql/sharedDocuments/admin/admin-users.documents.ts` | +`mustChangePassword` in `ADMIN_USER_DETAIL_FIELDS`; +`adminSetUserPasswordMutationDocument` |
| `frontend/graphql/generated/gql/graphql.ts` | Regenerated (both codegen steps) — `AdminSetUserPasswordMutation`(+`Variables`), `mustChangePassword` on every detail-fragment projection |
| `frontend/views/admin/users/hooks/useAdminUsersDirectory.ts` | 4th mutation + `changePasswordTarget` state |
| `frontend/views/admin/users/hooks/useAdminUserDetail.ts` | Same mutation + detail dialog state |
| `frontend/views/admin/users/dialogs/index.ts` | +2 exports |
| `frontend/views/admin/users/dialogs/DirectoryMutationDialogs.tsx` | Mounts the dialog (directory surface) |
| `frontend/views/admin/users/directory/DirectoryActionsMenu.tsx` | +Change-password MenuItem (`KeyOutlined`) |
| `frontend/views/admin/users/directory/DirectoryUserRow.tsx` | Threads `onChangePassword` |
| `frontend/views/admin/users/directory/DirectoryTable.tsx` | Threads `onChangePassword` |
| `frontend/views/admin/users/directory/DirectoryResults.tsx` | Wires both branches to `setChangePasswordTarget` |
| `frontend/views/admin/users/directory/DirectoryRowCells.tsx` | `RowCellLabels` Pick += `changePasswordAction` |
| `frontend/views/admin/users/directory/MobileUserCard.tsx` | Threads `onChangePassword` |
| `frontend/views/admin/users/directory/MobileUserCardList.tsx` | Threads `onChangePassword` |
| `frontend/views/admin/users/detail/UserHeroActions.tsx` | +Change-password Button (`KeyOutlined`) |
| `frontend/views/admin/users/detail/UserDetailHero.tsx` | Threads `onChangePassword` + labels Pick |
| `frontend/views/admin/users/detail/AdminUserDetailContainer.tsx` | Hero opens the dialog (`setChangePasswordTarget`) |
| `frontend/views/admin/users/detail/UserDetailInlineDialogs.tsx` | Mounts the dialog (detail surface) |
| `frontend/views/admin/users/detail/GovernanceCard.tsx` | Conditional pending-reset governance cell |
| `frontend/graphql/test/admin/admin-users.integration.test.ts` | Shared document replaces the local probe |
| `frontend/stories/admin/AdminUserDetailPage.fixtures.ts` | Fixture +`mustChangePassword: false` |
| `ai/plans/.../tasks.md` / `worklog.md` / this outcome file | Process artifacts |

**Deliberately NOT modified:**
- `frontend/views/dashboard/nav/navItems.ts` — **byte-unchanged** (`git status` empty; REQ-011.6 / 7.SR discipline holds; no nav entry was ever planned for this feature).
- `frontend/views/dashboard/profile/cards/ChangePasswordCard.tsx` — untouched (the profile placeholder is Task-10/REQ-006 territory, D4).
- `shared/locale/**` — Task 8 already landed every key this task consumes (`changePasswordAction`, `changePasswordDialog.*` ×8, `detail.mustChangePasswordLabel/Value`, `snackbars.passwordChanged`); zero new keys minted.
- `frontend/views/AGENTS.md`, `frontend/graphql/sharedDocuments/AGENTS.md`, `frontend.instructions.md` — 9.IV is read-and-honor: they prescribe conventions (barrel pattern, view-layer rules, MUI v9 discipline), not per-file manifests, so no staleness existed. Every convention is honored (document via the admin barrel; dialogs exported from the dialogs barrel with the same intra-barrel import style as `CreateUserDialog`/`EditUserDialog`).

## 3. Verification Results

### 3.1 REQ-007 compliance sweep (diff-level, all green)

1. **Kebab item** beside Edit/Deactivate ✅; threaded Row → Table/MobileCard → Results ✅.
2. **Hero button** beside Certify/Edit ✅; threaded through `UserDetailHero` + `AdminUserDetailContainer` ✅.
3. **Dialog** = show/hide new-password + confirm + force-reset checkbox ✅.
4. **Submit** → `adminSetUserPassword` via the shared document; `useAdminUserFormFeedback` projects field errors; **success closes + `snackbars.passwordChanged` snackbar** ✅.
5. **Shell** = `AdminDialogHeaderBand`/`AdminDialogFooterBand` + `useState` convention (no RHF) + `CreateUserCredentialField` show/hide recipe ✅.
6. **Failure/close** → no navigation, no partial write (the rejected `await` short-circuits before `setChangePasswordTarget(null)`/snackbar; server-side the write is one transaction with the audit row); **target cleared on close** in both containers ✅.

### 3.2 Labels / style discipline (9.SEC + 9.SR, all green)

- Labels only via the `AdminUsersLabels` namespace handle (prop Picks) + the `Auth` handle for client-side validation copy (`passwordRequired`/`passwordTooShort`/`changePassword.mismatch`/`showPassword`/`hidePassword`) — **no `Translation.` enum, no `t('key')`** (grep-clean on the whole `frontend/views/admin/users` tree).
- Server field errors arrive already localized via `extractFieldErrors` (the `extensions.fields[].message` is server-`ctx.t`-localized) — never raw codes; field-less denials → `extractErrorMessage` into the Alert (9.SEC).
- Icons: `KeyOutlined`, `VisibilityOutlined`, `VisibilityOffOutlined` — `*Outlined` only. Colors via `sx={theme => ({ color: theme.palette.* })}` callbacks. Layout strictly via `sx` (no direct layout props on MUI components). No `console.*`, no member-local type definitions (interfaces are module-level), no plan-artifact references in code (grep-clean on all added lines).

### 3.3 Tooling

- **`bun tsgo`** (full repo) → **0 "error TS", exit 0**.
- **Wire suite** `bun run test/scripts/run-test.ts frontend/graphql/test/admin/admin-users.integration.test.ts` → **49 pass / 0 fail / 319 expect()**. (First attempt failed environment-only: an orphaned `next-server` from the interrupted agent's run held port 3066 + a stale `.next-test-dev/dev/lock` — killed the orphan (PIDs 16530/16543), removed the lock; identical to the Task-6 incident, zero code change involved.)
- **Parity belt** `bun run test/scripts/run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` → **85 pass / 0 fail / 891 expect()**.
- **Sub-loop `--lifecycle duplicates`** → **exit 0 on 21/21 hand-authored files** (logs `/tmp/subloop-t9-<file>.log`): the documents file, both hooks, both new dialogs, `dialogs/index.ts`, `DirectoryMutationDialogs`, all 7 directory files, all 5 detail files, the wire test, the fixtures file.
- Generated `frontend/graphql/generated/gql/graphql.ts`: tsgo stage passes for it, but the toolchain's oxlint **ignore patterns exclude the generated tree** ("No files found to lint" → exit 1) — a config boundary, not a violation; the file is machine-touched only by `bun run generate:gqlSchema` + `bun codegen` (both exit 0), matching the Task-5/6 convention of never sub-looping generated output.

## 4. Subtask Pipeline Satisfaction

- **9.QL** ✅ — sub-loop exit 0 on all touched view/document files (§3.3).
- **9.TE** ✅ — document compiles against codegen types (`bun tsgo` 0; `AdminSetUserPasswordMutation`/`Variables` consumed exactly as generated); dialog branches are exercised by Task 13 stories (fixtures already carry `mustChangePassword`).
- **9.SEC** ✅ — field errors mapped (server-localized `extensions.fields` messages / client-validation strings), never raw messages; no navigation and no partial write on failure or close (REQ-007.6).
- **9.SR** ✅ — MUI v9 `sx` discipline; `*Outlined` icons; theme-callback colors; mutations imported from `@apollo/client/react` (in the hooks; the dialog itself takes `onSubmit`/`loading` as props); no member-local type defs.
- **9.IV** ✅ — `frontend/views/AGENTS.md` + `frontend/graphql/sharedDocuments/AGENTS.md` + `frontend.instructions.md` read in full before editing; every rule honored; no manifest updates required (see §2).
- **Semantic-review checklist:** BOLA — the dialog threads only `{ id, fullName }` display data; the mutation takes the admin-chosen `id` (server re-authorizes). Race conditions — concurrent sets serialize on the row lock server-side; the client refetches on completion. Enums-as-values — none touched. Cross-layer imports — none (views import the shared barrel only). Dead code — the probe document's leftovers were fully removed. Deferred items — D6 (row-level chip) untouched.

## 5. tasks.md Checkbox State

Task 9 main line + `9.QL` + `9.TE` + `9.SEC` + `9.SR` + `9.IV` flipped `[ ]` → `[x]`. No other checkbox touched (Tasks 0–8 stay `[x]`, Tasks 10–15 stay exactly as found).

## 6. Carry-Forward Knowledge

### 6.1 Dialog props/state surface (Task 13 stories, and any future consumer)

```ts
// ChangeUserPasswordDialog.tsx (both exports re-exported from the dialogs barrel)
interface ChangeUserPasswordDialogProps {
  labels: AdminUsersLabels;              // full namespace (uses changePasswordDialog.* + snackbars via caller)
  user: AdminUserChangePasswordTarget;   // { id: number; fullName: string } — minimal structural shape
  loading: boolean;                      // passwordLoading from the owning hook
  onClose: () => void;                   // MUST clear the target (setChangePasswordTarget(null))
  onSubmit: (input: { password: string; mustChangePassword: boolean }) => Promise<void>;
  // ↑ MUST let rejections propagate — the dialog projects them via useAdminUserFormFeedback;
  //   resolve ONLY on success (caller closes + snackbar AFTER the await).
}
interface ChangeUserPasswordFormState { password: string; confirmPassword: string; mustChangePassword: boolean }
```

Hook surface added: `useAdminUsersDirectory()` → `{ setUserPassword, passwordLoading, changePasswordTarget: DirectoryUserItem | null, setChangePasswordTarget }`; `useAdminUserDetail(userId)` → `{ setUserPassword, passwordLoading, changePasswordTarget: AdminUserChangePasswordTarget | null, setChangePasswordTarget }` (plus the pre-existing `refetchActivity`/`setSnackbarMessage` the detail mount consumes).

### 6.2 Document names (Task 13 stories / Task 11 journey)

- `adminSetUserPasswordMutationDocument` — `TypedDocumentNode<AdminSetUserPasswordMutation, AdminSetUserPasswordMutationVariables>`; variables `{ id: number; input: { password: string; mustChangePassword: boolean } }` (both required); returns the `AdminUserDetailFields` fragment (now incl. `mustChangePassword`).
- `AdminUserDetailFieldsFragment` carries `mustChangePassword: boolean` — stories' detail fixtures type-check against it (`AdminUserDetailPage.fixtures.ts` already pins `false`).

### 6.3 Cross-file dependencies

- The detail cache-merge means a successful set **flips the GovernanceCard cell live** — stories need no router mocks to show the indicator; they render `GovernanceCard` with a `mustChangePassword: true` fixture instead.
- The dialog's client-validation strings come from the **`Auth` namespace** (`passwordRequired`, `passwordTooShort`, `changePassword.mismatch`) while all chrome comes from **`adminUsers`** (`changePasswordDialog.*`) — keep both handles in any story wrapper.
- Task 10 (`/change-password`) is independent of this task but shares the `useAppTranslation(Auth)` handle pattern and the `authTranslations.changePassword.mismatch` copy; do not re-mint keys.
- Task 11 (journey) consumes the shared document name for the admin step and the `errorsTranslations` denial keys for the flagged-caller step (Task 7's allowlist excludes `adminSetUserPassword` by design).

## 7. Git / Protocol Notes

- No `git add`/`git commit` performed. No `console.*`. No plan-artifact references in code (JSDoc describes surfaces only).
- Environment-only fix this pass: killed the orphaned `next-server` (port 3066) + removed the stale `.next-test-dev/dev/lock` before re-running the wire suite — no code change.
- Expected `git status` after this task: the 21 frontend files + `tasks.md` (Task 9 flips) + worklog + this outcome file, plus the pre-existing backend/plan artifacts from Tasks 1–8 and mid-fix-1 (untouched).
