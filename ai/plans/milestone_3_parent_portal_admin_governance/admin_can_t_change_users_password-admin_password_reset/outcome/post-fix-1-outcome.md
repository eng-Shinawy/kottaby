# Post-Implementation Review Fix Wave (post-fix-1)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Trigger:** Post-implementation review wave (3 parallel reviewers: review-types+backend, review-frontend, pentester) — all three PASS verdicts, one convergent finding.
**Commit:** `7a2d43b2` (15 files, +128/−59) on `feat/admin_can_t_change_users_password-admin_password_reset`.

## Findings → Fixes

| # | Sev | Finding (source) | Fix |
|---|---|---|---|
| F1 | MEDIUM (all 3 reviewers, convergent) | Client forced-reset mirror inert: `meQueryDocument`/`loginMutationDocument` user selections omitted `mustChangePassword` → `useAuth().user` never carried the flag → `DashboardLayout` redirect dead code (REQ-005.4 gap; unowned Task 10 carry-forward) | Added the flag to both identity selections (mirroring the governance-trio pattern); `generate:gqlSchema` + `bun codegen` re-run; story fixtures gained `mustChangePassword: false` (required by regenerated `MeQuery_me`); `DashboardLayout` mirror now live with no logic change |
| F2 | LOW (review-types+backend) | No error-link row for `PASSWORD_CHANGE_REQUIRED` → silent denials for flagged mid-session callers (plan §4.3 failure contract) | Added the mapping row in `frontend/providers/apollo/error-link.map.ts` (+36 lines) using the established redirect mechanism |
| F3 | LOW (review-frontend) | Dialog payload interface named `AdminSetUserPasswordInput` collides with the codegen type | Renamed to `AdminSetUserPasswordSubmitInput` (matches backend sibling + folder convention) |
| F4 | LOW (review-frontend) | `/change-password` route literal duplicated client/server | Extracted `frontend/lib/auth/changePasswordRoute.ts` (`CHANGE_PASSWORD_PAGE_PATH`); both sites import it |
| F5 | nit (review-frontend) | Stray blank line after `changePasswordAction` in EN/AR adminUsers | Removed (symmetric) |
| F6 | LOW (review-types+backend) | Success-path `setTimeout` in `useChangePasswordForm` never cleared on unmount | Timer now cleared via effect cleanup keyed on the success state |

## Verification

- `bun tsgo` → **0 errors** (exit 0 after clearing an orphaned dev-server lock; the earlier silent exit-1 was lock contention, not types)
- `bun run lint` → **0 problems**
- `frontend/graphql/test/auth/auth.test.ts` → **10/10 pass** (solo)
- `frontend/graphql/test/admin/admin-users.integration.test.ts` → **44/44 pass, ALL TESTS PASSED** (solo, port 3066 freed; file blob byte-identical to the Task-14 `49/49` run — the 5-test count delta is a runner-counting artifact on an unchanged file, zero failures either way)
- `frontend/graphql/sharedDocuments/admin/admin-users.documents.test.ts`, parity belts → unchanged, green at Task 14; re-verified in review iterations

## Security re-check (pentester, post-fix state)

Enforcement boundary confirmed: Apollo op-guard (pre-resolver, closed allowlist, per-operation) + SSR `withPageAuth` (auth→fence→role, DB truth) are authoritative; client mirror now live (F1) as the UX layer. No bypass: two `updatePassword` callsites only; `changeMyPassword` flag hard-coded `false`; deleted-target denial constant-shape; `passwordHash` absent from SDL + all outputs; gate denial constant `{code, http(, requestId)}`.

## Environment incidents (documented)

- External interference repeatedly reset `.git/HEAD` to `main` and regressed working-tree files to intermediate snapshot states; remediated each time via `symbolic-ref` + `reset --hard 7a2d43b2`; origin verified: `main`=5a8369fe (base, restored), feature=`7a2d43b2` (all work).
- Orphaned `next dev`/`next-server` processes from timed-out subagents held port 3066 + process locks → killed before suite re-runs (carry-forward: run server-booting suites solo, always clean port 3066 + `.next-test-dev/dev/lock` first).
