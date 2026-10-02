# Review Fix Wave post-fix-2

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Trigger:** R1 full-delta review verdict PASS with 2 findings (1 MEDIUM, 1 LOW) — both routed to this wave.
**Base:** `7a2d43b2` (feature branch tip, post-fix-1 state). **No commits made** (orchestrator commits). Delta vs base: 10 files, +88/−13.

## Environment remediation (required first)

The working tree had been externally reset to base `5a8369fe` (main) — the entire 106-file feature delta was absent (change-password views deleted, `auth.documents.ts`/locales/generated types regressed). Per the wave protocol, restored the post-fix-1 state with `git checkout 7a2d43b2 -- .` and verified the four focus files byte-identical to `7a2d43b2`. The untracked wave artifacts (`round-R1-review-outcome.md`, `post-fix-1-outcome.md`) are not in the commit and survived untouched. No branch/ref changes; feature files restored only.

## F1 (MEDIUM) — stale session snapshot bounces the just-changed user back to `/change-password`

**Root cause (as reviewed):** `AuthProvider` holds `user` in React `useState`, populated only by the mount-time `me` restore and the login mutation. The successful `changeMyPassword` result normalizes into the Apollo cache but never updates that snapshot; after the 1.5 s success beat, `router.replace(roleDashboardPath(...))` mounts `DashboardLayout`, whose (correct) forced-reset mirror reads the stale `mustChangePassword: true` and bounces the user back. Server state is right; purely a client snapshot bug.

**Fix — minimal, in the established pattern (no DashboardLayout change):**

1. `frontend/context/AuthContext.ts` — `AuthContextType` gains
   `readonly updateSessionUser: (patch: Partial<AuthUser>) => void;` (contract documented: merges a server-authoritative partial user payload into the session snapshot; no-op against a null session).
2. `frontend/providers/apollo/AuthProvider.tsx` — implements the seam as a stable `useCallback` using the functional `setUser` form with the required null guard:
   `setUser(currentUser => (currentUser ? { ...currentUser, ...patch } : currentUser))`. Exposed on the memoized context value (deps updated). State-machine docblock gains the corresponding bullet. Studied first: the provider's established seam is exactly this (`setUser` threaded into focused hooks); a merge-style public surface is the cleanest extension — no Apollo-cache-driven provider rewrite, no duplicate setter.
3. `frontend/views/auth/change-password/useChangePasswordForm.ts` — success path captures the mutation result and merges it BEFORE the delayed hand-off:
   ```ts
   const result = await changeMyPassword({ variables: { input: { currentPassword, newPassword } } });
   const changedUser = result.data?.changeMyPassword;   // { id, email, fullName, role, mustChangePassword: false }
   if (changedUser) updateSessionUser(changedUser);
   setFieldErrors({});
   setSucceeded(true); // success beat — delayed replace lives in the effect below
   ```
   The snapshot is patched before `setSucceeded(true)` arms the 1.5 s effect that fires `router.replace`, so the freshly-mounted dashboard mirror reads `mustChangePassword: false` and does not bounce. Missing payload is skipped (guard); `updateSessionUser` added to the `handleSubmit` deps. Module docblock documents the sync.
4. Ripple (types only): 6 story files hand-construct `AuthContextType` and needed the new member — `updateSessionUser: () => undefined` added to `AdminDashboard`, `Landing`, `ParentDashboard`, `StudentDashboard`, `TeacherDashboard`, `auth/Login` story stubs. No production `useAuth()` consumer affected.

## F2 (LOW) — `temporaryPasswordNotice` rendered unconditionally

**Fix:** `frontend/views/auth/change-password/ChangePasswordForm.tsx` — the info `Alert` moved into a module-scope `TemporaryPasswordNotice({ user, label })` component that returns `null` unless `user?.mustChangePassword === true` (the same predicate as the DashboardLayout mirror; null/undefined user reads as not flagged, per finding instruction). The view reads `useAuth()` directly (established view pattern — ProfileView/DashboardView/etc.). Voluntary un-flagged visitors reaching `/change-password` by direct URL no longer see the factually-wrong "a temporary password was issued" copy; flagged users see it unchanged; nothing else in the layout moved. Component docblocks updated.

**Note:** the flag predicate deliberately lives in the view's module-scope notice component (not the hook) — the first cut put `isForcedPasswordReset` on the hook return and busts `max-lines-per-function` (hook 76/75, view 102/100). Final placement restores headroom (hook 74/75) with identical behavior.

## Verification (all commands bounded; server suite run solo after `kill` strays + `rm -f .next-test-dev/dev/lock`)

| Check | Result |
|---|---|
| `bun tsgo` | **exit 0 — 0 errors** |
| `bun run lint` | **exit 0 — 0 problems** |
| `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` | **exit 0 on all 10 touched files** (context, provider, 2 change-password views, 6 story stubs); biome:check + lint:type-aware + check:duplicates green |
| `bun run test/scripts/run-test.ts frontend/graphql/test/auth/auth.test.ts` | **ALL TESTS PASSED — 14/14, 0 failed, 49 assertions, ~12 s** (solo, port 3066 clean) |

## Files changed (10)

- `frontend/context/AuthContext.ts` (+8) — `updateSessionUser` on `AuthContextType`
- `frontend/providers/apollo/AuthProvider.tsx` (+21/−2) — seam implementation + exposure + docs
- `frontend/views/auth/change-password/useChangePasswordForm.ts` (+20/−3) — snapshot sync on success path
- `frontend/views/auth/change-password/ChangePasswordForm.tsx` (+34/−7) — flag-gated `TemporaryPasswordNotice`
- `frontend/stories/pages/{AdminDashboard,Landing,ParentDashboard,StudentDashboard,TeacherDashboard}.stories.tsx`, `frontend/stories/pages/auth/Login.stories.tsx` (+1 each) — stub member

## Carry-forwards

- None from this wave. Two prior environment notes remain operational: (1) external working-tree resets to `main` recur — each wave should verify/restore `7a2d43b2` state before editing; (2) run server-booting suites solo after clearing port 3066 + `.next-test-dev/dev/lock`.
