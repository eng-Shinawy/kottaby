# Review Iteration R1 — Full-Delta Fresh Sweep

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Feature commit:** `7a2d43b2` (branch tip) · **Base:** `5a8369fe` · Delta: 106 files, +6846/−254 (15 source files + tests/locales/stories/generated).
**Reviewer:** independent R1 (no prior review context). **Mode:** read-only; all file content read via `git show 7a2d43b2:<path>` (working tree unreliable per plan notes).

## Scope & Method

Four lenses over the full delta: Types / Backend / Frontend / Security. Bounded reads (~25 min budget, no test suites — code-only).

Read in full or in targeted diff hunks:
- Backend core: `passwordChangeGate.ts` (new, full), `user.repository.ts`, `users.ts` (schema), `admin-user.types.ts`, `auth.types.ts`, `user-management.helpers.ts`, `user-management.mappers.ts`, `user-management.service.ts`, `auth.service.ts`, `user.mutation.ts`, `admin-users.mutation.ts`, `admin-user.pothos.ts`, `user.pothos.ts`, `apollo-server.ts`, `admin-user-query-helpers.ts`, `admin-user-row-types.ts`.
- Frontend core: `withPageAuth.ts` (full), `changePasswordRoute.ts`, `app/change-password/page.tsx` (full), `ChangePasswordForm.tsx` + `useChangePasswordForm.ts` (full), `ChangeUserPasswordDialog.tsx` + `ChangeUserPasswordFormFields.tsx` (full), `DirectoryMutationDialogs.tsx`, `useAdminUsersDirectory.ts`, `useAdminUserDetail.ts`, `DashboardLayout.tsx`, `error-link.map.ts`, `auth.documents.ts` (full), `admin-users.documents.ts`, detail/directory threading diffs.
- Cross-cutting: generated SDL (`mustChangePassword: Boolean!` on `User` + `AdminUserDetail`; both new inputs/mutations present), census (`ADMIN_ACTION_CENSUS` row + `USER_LIFECYCLE_LEG` leg), locale EN/AR/types additions, `roleDashboardPath` fallback semantics, `AuthProvider`/`useRestoreSession` state topology, raw-SQL column coverage in `UserRepository`.
- Plan context: specs REQ-001..011, plan D1–D9 + §7 security table, post-fix-1-outcome (F1–F6), 14-final-gate, midpoint-review-R1 (accepted items: http-200 literal, same-as-current order, census sequencing).

Excluded from re-reporting per instructions: accepted midpoint items (F3 http-200 literal, F4 guard order), D1–D6 deferrals, post-fix-1 fixes (F1 flag selections, F2 error-link row, F3 dialog payload rename, F4 route constant, F6 timer cleanup), admin-trusts-admin no-self-guard (D4 documented).

## Findings

| # | Severity | Location | Finding | Suggested fix |
|---|---|---|---|---|
| 1 | MEDIUM | `frontend/views/auth/change-password/useChangePasswordForm.ts` (success path ~L156-176) × `frontend/views/dashboard/layout/DashboardLayout.tsx:97-107` | **Stale client session snapshot bounces the just-changed user back to the fence page.** `AuthProvider` holds `user` in React `useState`, populated only by `useRestoreSession` (mount-only `me` query) and the login mutation; the successful `changeMyPassword` result normalizes into the Apollo cache but never updates that snapshot. After the 1.5 s success beat, `router.replace(roleDashboardPath(...))` mounts `DashboardLayout` (fresh mount — page sits outside the `(dashboard)` group), whose forced-reset mirror reads `useAuth().user.mustChangePassword === true` (stale) and immediately replaces back to `/change-password`. The user — now un-flagged in the DB — lands on the fence page again; any re-submit fails `CURRENT_PASSWORD_INVALID`; recovery requires a full browser reload (re-runs `me`). This defeats the documented "proceed without a re-login" contract (`auth.service.ts` / `user.mutation.ts` docblocks) and the final step of journey J1 at the UX layer, for every flagged user (canonical J1 flow: login → mirror → fence → change → bounce). Server state and the enforcement boundary are correct; purely client-side, recoverable, no security impact — hence MEDIUM, not HIGH. Untested: journey/integration suites are backend-side; no frontend test covers this hand-off. | Reconcile the session snapshot on success: expose an `updateSessionUser` (or `refreshSessionUser`) callback from `AuthProvider`/`useAuth` and feed it the mutation result (or `await apolloClient.query({ query: meQueryDocument, fetchPolicy: "network-only" })` before routing); alternatively drive the `DashboardLayout` mirror from the normalized Apollo cache (`meQueryDocument`) instead of the React-state snapshot. |
| 2 | LOW | `frontend/views/auth/change-password/ChangePasswordForm.tsx:53` (info `Alert`) | The "A temporary password was issued to this account" notice renders unconditionally, but the module docblock itself says the page is "also reachable voluntarily by an authenticated user" (direct URL — it is not a nav item by design, D7). For a voluntary, un-flagged visitor the copy is factually wrong. | Condition the notice on the live flag (`useAuth().user?.mustChangePassword === true` — already selected in `me`/`login` documents), or add a neutral variant label for the voluntary path. |

Non-findings verified clean (sample): gate allowlist is closed + per-operation with alias/fragment-flattened root-field extraction (`selection.name.value` reads the field name, so alias-laundering cannot bypass); both full-row raw SQL reads in `UserRepository` carry `must_change_password` (the two other raw SELECTs are narrow id/locale, id/fullName projections); `withPageAuth` fence order = auth → fence → role, DB truth via the same cached context row; `resolveAdminUserMutationTarget` + strict `assertActorAdminActive` + in-tx deleted-target denial before audit (tx rollback ⇒ zero writes/zero audit); single password-write home (`UserRepository.updatePassword`, 2 callsites: admin + self) with `changeMyPassword` hard-coding `false`; plaintext/hash absent from audit details, SDL, and all output types; census row + leg registered; EN/AR locale leaves flat and symmetric; dialogs keyed by target id and conditionally mounted (state resets per open); no `console.*` / `Translation.`-enum / `t('key')` additions in code (only plan-docblock mentions); enum members imported as values; MUI v9 `sx` + theme-callback discipline holds in the new files; `roleDashboardPath(undefined)` falls back safely to the student dashboard.

## Coverage Summary

- Types ✔ (naming incl. post-fix F3 rename, closed input shapes, codegen SDL agreement, no dupes)
- Backend ✔ (layer boundaries, race windows — in-tx returned-row denial, hash-before-tx, last-write-wins credential write per plan §5.1, dead code, error shapes incl. constant gate denial + single `CURRENT_PASSWORD_INVALID` no-oracle shape)
- Frontend ✔ (MUI v9 discipline, namespace-handle i18n incl. field-name projection of `password`→`newPassword`, Apollo hook/document patterns, dialog lifecycle, route-guard placement/fence order)
- Security ✔ (BOLA/IDOR — no identity member on `ChangeMyPasswordInput`, self-derived `ctx.user.id`; BFLA double denial; gate bypass — aliases/fragments/allowlist closedness, DB-backed identity; injection — parameterized SQL; info disclosure — constant denials, no hash/plaintext on the wire; mass assignment — closed whitelists untouched)

**Verdict: PASS** — 2 findings (1 MEDIUM, 1 LOW), none security- or correctness-of-enforcement-related; finding 1 is a guaranteed client-side happy-path break recommended for immediate fix before ship.

## post-fix-2 (review fix wave — R1 findings resolved)

**Trigger:** both R1 findings routed to a fix wave. **Base:** `7a2d43b2` (post-fix-1 state). No commits (orchestrator commits).

### F1 (MEDIUM) — stale session snapshot bounce → FIXED

- **Fix surface:** `AuthContextType` gains `readonly updateSessionUser(patch: Partial<AuthUser>): void` (`frontend/context/AuthContext.ts`). `AuthProvider` implements it as a stable `useCallback` merging the patch into the React-state `user` via the functional `setUser` form, with a null guard (`currentUser ? { ...currentUser, ...patch } : currentUser`) — a patch against a momentarily-null (anonymous) session is a no-op, per finding instruction. Added to the memoized context value + deps. Docblocks updated (state-machine bullet in `AuthProvider`, contract doc in `AuthContext`).
- **Callsite:** `useChangePasswordForm.handleSubmit` success path now captures the mutation result and merges the server-authoritative payload (`result.data?.changeMyPassword` = `{ id, email, fullName, role, mustChangePassword: false }`) into the session snapshot BEFORE `setSucceeded(true)` starts the 1.5 s beat whose effect fires `router.replace(roleDashboardPath(...))` — so the freshly-mounted `DashboardLayout` mirror (`user?.mustChangePassword === true`) reads the cleared flag and no longer bounces the just-changed user back to `/change-password`. Missing-payload guarded; `updateSessionUser` added to the callback deps. No change to `DashboardLayout` (its mirror logic was already correct given a fresh snapshot).
- **Ripple:** `AuthContextType` consumers that hand-construct the context in stories needed the new member: 6 story stubs gained `updateSessionUser: () => undefined` (AdminDashboard, Landing, ParentDashboard, StudentDashboard, TeacherDashboard, Login). Production consumers (`useAuth()` readers) unaffected.

### F2 (LOW) — conditional notice copy → FIXED

- `ChangePasswordForm` no longer renders `temporaryPasswordNotice` unconditionally. A module-scope `TemporaryPasswordNotice` component gates the info `Alert` on `user?.mustChangePassword !== true → null` (same predicate as the DashboardLayout mirror; null/undefined session user reads as not flagged), reading `useAuth()` directly — the established view pattern. Voluntary (un-flagged) visitors via direct URL no longer see the wrong "a temporary password was issued" copy; flagged users see it unchanged. Layout otherwise untouched.

### Verification

- `bun tsgo` → **0 errors** (exit 0)
- `bun run lint` → **0 problems** (exit 0)
- `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` → **exit 0 on all 10 touched files** (initially 2 failures: `max-lines-per-function` — hook 76/75, view 102/100; resolved by keeping the flag predicate in the view's module-scope notice component instead of the hook, restoring headroom: hook 74/75, view component functions well under caps)
- `bun run test/scripts/run-test.ts frontend/graphql/test/auth/auth.test.ts` → **ALL TESTS PASSED, 14/14, 0 failed** (solo; strays killed + `.next-test-dev/dev/lock` cleared first)

### Environment incident (documented)

- Working tree was externally reset to base `5a8369fe` (main) — the entire feature delta was absent. Remediated per protocol: `git checkout 7a2d43b2 -- .` restored the post-fix-1 feature state (verified the 4 focus files byte-identical to `7a2d43b2`); untracked outcome artifacts (`round-R1-review-outcome.md`, `post-fix-1-outcome.md`) were not in the commit and survived untouched. Branch refs untouched.
