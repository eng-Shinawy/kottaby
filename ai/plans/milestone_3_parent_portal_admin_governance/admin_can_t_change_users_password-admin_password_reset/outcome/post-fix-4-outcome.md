# Review Fix Wave post-fix-4

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Trigger:** R3 frontend deep-dive verdict PASS with 6 findings (6 LOW, 0 MEDIUM/HIGH) — all routed to this wave.
**Feature commit:** `cd6e5c7f` (working tree restored to it first — see below). **No commits made** (orchestrator commits). Delta: 15 files, +297/−56.

## Environment remediation (required first)

The working tree had been externally reset to base `5a8369fe` (only the untracked `round-R3-review-outcome.md` survived; `frontend/views/auth/change-password/` was absent). Per the wave protocol, restored the feature state with `git checkout cd6e5c7f -- .` before any edit. No branch/ref changes; feature files restored only; the untracked R3 outcome file was untouched.

## F1 (LOW) — "Change password" affordance offered for soft-deleted targets

Both admin surfaces rendered the credential-dialog affordance unconditionally while `adminSetUserPassword` (f94cd988) denies deleted targets (`USER_NOT_FOUND` — "a deleted user has no live credential to replace"): the admin filled two credentials and ate a doomed round-trip ending in misleading `userNotFound` copy.

**Fix — gate the affordance on `!isDeleted` (the flag both components already compute; mirror of the Certify slot's governance gate; dialog needs no change):**

- `frontend/views/admin/users/detail/UserHeroActions.tsx` — the outlined Change-password button now renders only when `!isDeleted`; docblock updated (deleted rows: Reactivate replaces both Deactivate AND Change password).
- `frontend/views/admin/users/directory/DirectoryActionsMenu.tsx` — the kebab `MenuItem` renders only when `!isReactivate` (the component's existing name for `user.isDeleted`); docblock updated.

## F2 (LOW) — field-less-denial fallback reused LOGIN-namespace copy

`useChangePasswordForm.ts`'s final catch fallback rendered `auth.loginError` ("Sign-in failed. Please check your credentials.") to a mid-session user whose password change failed at transport level — actively wrong copy.

**Fix — neutral surface-owned fallback leaf:**

- `shared/locale/types/auth/index.ts` — `changePassword` block gains `genericFailure: string` (flat leaf, JSDoc: fallback for a field-less denial whose wire message is unusable, deliberately NOT the login-specific copy).
- `shared/locale/en/auth/index.ts` — `"Password change failed. Please try again."`
- `shared/locale/ar/auth/index.ts` — `"فشل تغيير كلمة المرور. يرجى المحاولة مرة أخرى."`
- `frontend/views/auth/change-password/useChangePasswordForm.ts` — fallback is now `extractErrorMessage(err) ?? t.changePassword.genericFailure` (docblock updated). Auth has no parity belt in the repo (verified in 8-outcome §1.2); compile-time `AuthLabels` typing of both leaf consts is the gate — `bun tsgo` green.

## F3 (LOW) — page description asserted a mandatory change for voluntary visitors

Post-fix-2 gated `temporaryPasswordNotice` on `user?.mustChangePassword === true`, but `AuthFormHeader`'s subtitle ("For security, you must set a new password before you can continue.") still rendered unconditionally — factually wrong for an un-flagged visitor using the direct URL.

**Fix — same predicate gates the description; title stays unconditional:**

- `frontend/components/AuthFormShared.tsx` — `AuthFormHeader.subtitle` is now OPTIONAL (`subtitle?: string`); the subtitle `Typography` renders only when a non-empty subtitle is passed. Login/register consumers are unchanged (they always pass one).
- `frontend/views/auth/change-password/ChangePasswordForm.tsx` — computes `const isForcedReset = user?.mustChangePassword === true;` (the exact `TemporaryPasswordNotice` / `DashboardLayout`-mirror predicate) and passes `subtitle={isForcedReset ? t.changePassword.description : undefined}`; module + notice docblocks updated (forced-reset copy = description AND notice; both collapse for voluntary visitors).

## F4 (LOW) — `PASSWORD_CHANGE_REQUIRED` row's `redirectTo` payload had no consumer

Grep confirmed `redirectTo` appeared only in `error-link.map.ts` (descriptive-only) — no consumer mechanism existed for ANY row, so the fix per the wave instruction was to wire the row's redirect inside the error-link module's established helpers, via the same mechanism the UNAUTHENTICATED recovery uses, guarded against loops.

**Fix — the established seam consumer honors the payload once per session:**

- `frontend/providers/apollo/utils/error-surface.ts` — new module-scope `redirectTo` consumer section: `honorActionRedirectTo(action, meta)` runs AFTER the surface publish inside `dispatchMappedGraphQLErrorActions`'s per-item loop (the single seam where mapped actions exist; listener failure never blocks the navigation). Guards: (a) payload must be a non-empty string; (b) session dedupe — module-scope `hasHonoredRedirectTarget` latch mirrors `isRedirectingToLogin` in `auth-recovery.ts`, so a burst of gated denials navigates exactly once and later denials keep only their localized toast/banner copy; (c) loop guard — suppressed when `pathname === target || pathname.endsWith(target)` so a denial surfacing on `/change-password` never navigates onto itself; (d) browser-only (the dispatch gate already returns early headless/on login/self-surfaced ops). Navigation mechanism = `globalThis.window.location.href = target` — byte-identical to the UNAUTHENTICATED path's `recoverFromUnauthenticated` (`auth-recovery.ts`); the target arrives via the action payload, which the map fills from `CHANGE_PASSWORD_PAGE_PATH` (single-sourced; no path re-spelled). Docblock updates: the dispatch JSDoc gains the redirectTo bullet; the `logErrorSurfaceEvent` channel carries the from/to diagnostics.
- `frontend/providers/apollo/error-link.map.ts` — docblocks only (pure table untouched): `GraphQLErrorAction.redirectTo` now names the seam consumer + once-per-session semantics; the `mapPasswordChangeRow` JSDoc notes the consumer honors it.
- `frontend/providers/apollo/error-link.map.test.ts` — +4 tests (41 → 45): the two pure-table `PASSWORD_CHANGE_REQUIRED` rows (query → permission-fallback, mutation → toast, both `redirectTo === CHANGE_PASSWORD_PAGE_PATH`, own `passwordChangeRequired` copy), a no-other-row-carries-redirectTo sweep, and a dispatch-integration test covering all three guard branches in sequence (already-on-target → no self-redirect; elsewhere → navigates once; later denial → copy publishes, no re-navigation).
- Coverage note (unchanged ownership): `GraphQLErrorSurfaceHost` remains the ONLY listener and still ignores nothing new — the redirect rides beside the publish, not inside the UI host, preserving the R3-verified "row stays pure / no loop" contract.

## F5 (LOW) — pending-reset UI had zero story coverage

`detailUser()` hardcoded `mustChangePassword: false`, so the `GovernanceCard` pending-reset branch and `detail.mustChangePasswordLabel/Value` were unreachable in Storybook; the dialog stories skipped the client confirm-mismatch channel.

**Fix — overridable slice + two new stories:**

- `frontend/stories/admin/AdminUserDetailPage.fixtures.ts` — `detailUser(roleSlices, overrides)` gains an optional `overrides: Partial<Pick<DetailUserFixture, "mustChangePassword">>` spread after the role slices; new exported variant `PENDING_RESET_TEACHER_USER` (`mustChangePassword: true`, approved non-evaluator teacher, `applicant: null` — no Certify interference).
- `frontend/stories/admin/AdminUserDetailPage.stories.tsx` — new `PendingPasswordReset` story rendering the flagged fixture so the GovernanceCard "password reset pending" row is actually covered.
- `frontend/stories/admin/ChangeUserPasswordDialog.stories.tsx` — new `ConfirmMismatch` story matching the existing one-shot driver pattern: `autoFillMismatch` prop types the demo credential into the new-password field and a divergent (`StoryTempPass25`) value into the confirm field, then auto-submits; the dialog's pre-flight confirm-match guard rejects before any transport call (success mock never reached) and `auth.changePassword.mismatch` renders as inline `helperText` under the confirm field. Controls-exclude list and header docblock updated.

## F6 (LOW) — page re-spelled the `"/change-password"` literal

- `app/change-password/page.tsx` — `redirectTo` now imports and uses `CHANGE_PASSWORD_PAGE_PATH` from `@/frontend/lib/auth/changePasswordRoute` (same `@/frontend/lib/...` alias convention as sibling app/ files); inline comment notes the single-sourcing with the error-link map and the DashboardLayout mirror.

## Verification (bounded; no server-boot suite required this wave — frontend/shared-only delta)

| # | Check | Result |
|---|---|---|
| 1 | `bun tsgo` | ✅ 0 errors (exit 0) |
| 2 | `bun run lint` | ✅ 0 problems (exit 0) |
| 3 | `run-test.ts shared/locale/adminUsers-namespace.parity.test.ts` | ✅ 85 pass / 0 fail / 891 expect() |
| 4 | `run-test.ts shared/locale/errors-namespace.parity.test.ts` | ✅ 58 pass / 0 fail / 430 expect() (errors keys untouched — no drift) |
| 5 | `run-test.ts frontend/graphql/test/auth/auth.test.ts` | ✅ 14 pass / 0 fail (server suite, solo) |
| 6 | `sub-loop.ts <file> --lifecycle duplicates` × 15 touched files | ✅ exit 0 on every file |
| + | `run-test.ts frontend/providers/apollo/error-link.map.test.ts` (bonus, locks F4) | ✅ 45 pass / 0 fail (41 baseline + 4 new) |

## Notes for the orchestrator

- Delta confined to the 15 files listed above; no backend/graphql/schema changes, no namespace-handle/registry changes (`auth` block extended in place — bundle slices already carry the whole const).
- `AuthFormHeader.subtitle` becoming optional is the only shared-component signature change; both existing consumers (LoginForm, RegisterForm) pass it and are behaviorally identical.
- The F4 consumer intentionally lives in `error-surface.ts` (the seam where mapped actions are produced), NOT in `GraphQLErrorSurfaceHost` (UI-only host) — the map's "described vs executed" ownership split is preserved and the change stayed inside the error-link module + its established helpers per the wave instruction.
- R3 finding locations re-verified in `cd6e5c7f` before fixing; no stale-snapshot or fence-trio regressions introduced (the F4 navigation is hard-navigation, so the `DashboardLayout` mirror/snapshot interplay is untouched).
