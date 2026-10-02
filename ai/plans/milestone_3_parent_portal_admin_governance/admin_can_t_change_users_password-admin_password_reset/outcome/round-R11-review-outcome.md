# Review Iteration R11 — Independent Confirmation Pass

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Feature tip:** `7760c5c9` · **Base:** `5a8369fe` · Delta: 131 files (+8,724 / −268) — `git diff 5a8369fe..7760c5c9`.
**Reviewer:** independent R11 (confirmation sweep — blind spots of the 10 prior lenses, not their checklists). Working tree verified identical to the tip (`git diff 7760c5c9` = empty); no restore needed; READ-ONLY honored. Prior outcomes skimmed: R10 (zero findings, rejected candidates list) + R1–R9 / post-fix-1..7 via the R10 confidence summary — no previously rejected candidate re-raised.

## Scope & Method

Four lenses aimed at what prior rounds could have **systemically missed**:

1. **Requirement coverage audit** — every REQ-001..REQ-011 acceptance criterion walked one-by-one against tip code + tests (table below). Special attention to the criteria the brief flagged as historically thin: REQ-004.3 detail indicator, REQ-005.2 allowlist completeness, REQ-006.7/8, REQ-009.5 fragment, REQ-010.5 logging, REQ-011.1-6 non-goals.
2. **Cross-artifact consistency** — tasks.md checkbox census; `deferred-items.md` blocker-glyph grep.
3. **A11y + RTL spot-check** — the two new UI surfaces (`ChangeUserPasswordDialog`/`ChangeUserPasswordFormFields` + `/change-password` page/form) and the shared `PasswordField`/`AuthFormHeader` blocks.
4. **Build/runtime sanity** — solo runs (strays killed, `.next-test-dev/dev/lock` cleared) of `bun tsgo`, `bun run lint`, and `backend/graphql/test/schema-surface.test.ts`; plus the two new i18n parity belts as a bonus gate.

## 1. REQ Coverage Table (criterion → implementation → test)

| REQ | Criterion (abridged) | Implementing code (tip) | Test pin | Verdict |
|---|---|---|---|---|
| 001.1-7 | Baseline, ledger, outcomes, checkbox flips, sub-loop | `outcome/0-baseline-outcome.md` + 1..14 outcomes exist; `deferred-items.md` seeded | artifacts present | ✅ |
| 002.1 | New admin labels in `AdminUsersLabels` w/ en+ar parity | `types/adminUsers/index.ts` (`changePasswordDialog.*`, `snackbars.passwordChanged`) | `adminUsers-namespace.parity.test.ts` (85 pass, run) | ✅ |
| 002.2 | Namespace handles, never `t('key')` / `Translation.` enum | `ChangeUserPasswordFormFields` uses `useAppTranslation(Auth)` + `AdminUsersLabels` props; form same | parity + tsgo | ✅ |
| 002.3 | Flat strings / ICU bands only (no function leaves) | all new adminUsers keys flat strings | parity walker (REJECTS functions) green | ✅ |
| 002.4 | `Auth.changePassword` block via `AuthLabels` | `types/auth/index.ts:100-121` + en/ar blocks; page reads `useAppTranslation(Auth)` | auth parity (errors belt 58 pass, run) | ✅ |
| 002.5 | `errorsTranslations` + `ctx.t` seam, never hardcoded EN | `passwordChangeRequired`/`currentPasswordInvalid`/`newPasswordSameAsCurrent` in types + en + ar; resolvers/services localize | errors-namespace parity (58 pass, run) | ✅ |
| 002.6 | Enums as values (`AuditActionType.Update`, `UserRole.Admin`) | `user-management.service.ts` `AuditActionType.Update`; `admin-users.mutation.ts` `UserRole.Admin` | tsgo (type-only imports fail) | ✅ |
| 003.1 | `adminSetUserPassword` → bcrypt(12) hash + returns detail | `user-management.service.ts:setUserPassword` → `hashPassword` → `updatePassword` → `getUserDetail` | service suite (359 lines added) + journey step 2 | ✅ |
| 003.2 | `<8` → VALIDATION `PASSWORD_TOO_SHORT` fields shape | `validatePasswordPolicy` (`MIN_PASSWORD_LENGTH`) | service tests + dialog client mirror | ✅ |
| 003.3 | empty/whitespace → `PASSWORD_REQUIRED` | same helper (`trim().length === 0` first) | service tests | ✅ |
| 003.4 | absent id → `NotFoundError("USER")` | `setUserPassword` null-row branch → `NotFoundError(USER_ENTITY, …)` | service tests + journey step 2 (deleted/absent legs) | ✅ |
| 003.5 | response NEVER carries `passwordHash` | `AdminUserDetailReturnType` = `Omit<UserSelectType,"passwordHash">` (unchanged); mappers strip | journey deep-walk (`expect(key).not.toBe("passwordHash")` + `rawDetails` raw-string scan) | ✅ |
| 003.6 | input exactly `{password, mustChangePassword}` | `AdminSetUserPasswordInput` Pothos closed two-field type (`admin-user.pothos.ts:411-425`) | `schema-surface.test.ts` SDL pins (104 pass, run) | ✅ |
| 004.1 | flag=true in SAME tx as password write | single `withTransaction` { `updatePassword(id, hash, true)` → audit } | journey step 2 | ✅ |
| 004.2 | option off → flag persisted `false` (clears prior) | `updatePassword(..., input.mustChangePassword)` passes admin's boolean | service tests | ✅ |
| 004.3 | detail page shows "password reset pending" indicator | `GovernanceCard.tsx:119-125` appends the flag cell (`mustChangePasswordLabel`/`Value`) from the fragment-selected field | stories fixtures + fragment contract test | ✅ |
| 004.4 | audit `changedFields:["credentials"]` + `mustChangePassword`, never the password | `buildAuditContract(actorId, Update, id, {changedFields:["credentials"], mustChangePassword})` | journey step 2 asserts details; step 4 asserts zero rows on denial | ✅ |
| 004.5 | flag survives login until cleared via REQ-006 | login writes `lastActiveAt` only | journey step 3 ("login does NOT clear the flag") | ✅ |
| 005.1 | non-exempt op → FORBIDDEN + `PASSWORD_CHANGE_REQUIRED` + localized msg | `passwordChangeGate.ts` `PasswordChangeRequiredDenial` (ForbiddenError family, extensions.code re-stamped) | `password-change-gate.test.ts` (38 pass, R10; static-scan pinned) | ✅ |
| 005.2 | closed allowlist: `me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken` | `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` — EXACTLY the 7 spec members, frozen, case-sensitive lookup | gate suite (allowlist membership + alias/fragment-escape cases) | ✅ |
| 005.3 | `withPageAuth` redirect + `allowMustChangePassword` only for `/change-password` | `withPageAuth.ts:77-127` (fence after auth, before role; pure `shouldRedirectToChangePassword`) | `withPageAuth.test.ts` (+44 lines) | ✅ |
| 005.4 | `DashboardLayout` client mirror redirect | `DashboardLayout.tsx:99-107` (`router.replace(CHANGE_PASSWORD_PAGE_PATH)`, target outside `(dashboard)`) | layout predicate + R10 loop analysis | ✅ |
| 005.5 | gate reads DB state, not JWT claim | gate reads `ctx.user.mustChangePassword` only (context factory per-request `findById`) | gate suite identity-source cases | ✅ |
| 005.6 | un-flagged → strict no-op, zero extra queries | `isPasswordChangeRequired` returns false unless `=== true`; reads existing ctx row only | gate suite | ✅ |
| 006.1 | `comparePassword` against stored hash | `auth.service.ts:changeMyPassword` compare step | service suite (538 lines added) | ✅ |
| 006.2 | wrong current → `CURRENT_PASSWORD_INVALID` field-targeted, zero writes | single denial shape (vanished row / deleted / mismatch / fence-miss folded) | service tests + journey step 6 semantics | ✅ |
| 006.3 | `<8`/empty → same policy as REQ-003 | `validatePasswordPolicy(input.newPassword, …)` shared helper | service tests | ✅ |
| 006.4 | same-as-current → `NEW_PASSWORD_SAME_AS_CURRENT` | pre-hash no-op guard (`auth.service.ts:413-419`) | service tests | ✅ |
| 006.5 | hash+persist+flag=false in one tx | fenced `updatePassword(userId, hash, false, tx, observed)` inside `withTransaction` | service tests (fence + in-tx deleted guard legs) | ✅ |
| 006.6 | the flag-clearing path | self path writes `false`; admin path's clear is the separately-specified REQ-004.2 behavior (both implemented as spec'd) | journey step 6→7 gate-open transition | ✅ |
| 006.7 | returns updated password-stripped `User` with `mustChangePassword: false` | `return stripPasswordHash(updated)`; Pothos `User.mustChangePassword: Boolean!` (SDL :377); `auth.documents.ts` changeMyPassword selection rides the field | `documents.contract.test.ts` (33 pass, R10) | ✅ |
| 006.8 | anonymous → UNAUTHORIZED | `authScopes:{authenticated:true}` + resolver `UnauthorizedError` guard | `frontend/graphql/test/auth/auth.test.ts` (+147) | ✅ |
| 007.1 | directory kebab "Change password" wired row/mobile/results | `DirectoryActionsMenu` (KeyIcon item, `marginInlineEnd`) → `DirectoryUserRow`/`MobileUserCard`/`DirectoryResults`/containers | stories + container wiring | ✅ |
| 007.2 | detail hero button | `UserHeroActions.tsx:82-91` (gated `!isDeleted` — the R10-verified affordance contract matching the backend's deleted-target denial) | stories (`AdminUserDetailPage.stories`) | ✅ |
| 007.3 | dialog: show/hide new field + confirm + force-reset checkbox | `ChangeUserPasswordDialog` + `ChangeUserPasswordFormFields` (3-band EditUserDialog layout) | `ChangeUserPasswordDialog.stories.tsx` (320 lines) | ✅ |
| 007.4 | calls mutation, `useAdminUserFormFeedback` inline errors, closes on success, snackbar | dialog submit → `runWithFeedback(onSubmit)`; containers close on resolve; `snackbars.passwordChanged` (en/ar pinned) | stories + feedback-hook reuse | ✅ |
| 007.5 | reuses credential show/hide recipe + dialog bands + useState convention | `CreateUserCredentialField` recipe replicated; `AdminDialogHeaderBand`/`FooterBand`; `useState` form (no RHF) | parity via sibling convention | ✅ |
| 007.6 | no nav/partial write on close/fail; target cleared on close | dialogs conditionally mounted + `key={target.id}`; close only after caller resolves | container wiring (both surfaces) | ✅ |
| 008 (journey) | actor table + 8 ordered steps + observer EARS | — | `admin-password-reset.journey.test.ts` steps 1-8 + fixtures commit + tracked cleanup (509 lines) | ✅ |
| 008.1-5 | login-with-temp / fence denial / flag-clear-open / non-admin FORBIDDEN / deep hash absence | — | journey steps 2,3,4,5,6,7 + deep-walk walker | ✅ |
| 009.1 | exactly one column `boolean().default(false).notNull()` | `backend/db/schema/users/users.ts:19` | schema-surface (SDL emission byte-identical) | ✅ |
| 009.2 | inferred types propagate to `RegistrationReturnType` / `AdminUserSafeSelect` | `$inferSelect` cascade; both safe selects carry the field | tsgo + wire tests | ✅ |
| 009.3 | no backfill needed (server default false) | default in DDL only | — | ✅ |
| 009.4 | exactly two Pothos objects gain the field | `user.pothos.ts:98` + `admin-user.pothos.ts:310` (SDL :377/:559) | schema-surface SDL pins | ✅ |
| 009.5 | `ADMIN_USER_DETAIL_FIELDS` includes `mustChangePassword` | `admin-users.documents.ts:83` | documents contract test | ✅ |
| 010.1 | ONE audit row in same tx via `buildAuditContract` | `setUserPassword` tx body (audit inside, rollback-shared) | journey step 2 (exactly-one assertion) | ✅ |
| 010.2 | details contract, never the password/hash | names + flag only | journey step 2 details assertion | ✅ |
| 010.3 | denials → ZERO audit rows | throws before insert; tx rollback | journey steps 4/5 zero-row assertions | ✅ |
| 010.4 | census + `USER_LIFECYCLE_LEG` registration | `audit-completeness.catalog.ts:101` + `journey.test.ts:239` | census drift test green (R10 re-run) | ✅ |
| 010.5 | denials logged via `logger.logDomainError` with stable codes, never `console.*` | 5 sites (`auth.service.ts:397,453,472`; `user-management.service.ts` admin path; finalizer observes gate) — codes `CURRENT_PASSWORD_INVALID`/`USER_NOT_FOUND`/`PASSWORD_CHANGE_REQUIRED` | grep sweep: zero `console.*` in delta code | ✅ |
| 010.6 | client diagnostics via Apollo error-mapping seam only | `error-link.map.ts` map row keyed on `extensions.code` → redirect consumer (`error-surface.ts`) | `error-link.map.test.ts` (+51) | ✅ |
| 011.1 | no mail/OTP/reset routes; no new `app/api/**` | delta touches `app/api/graphql/apollo-server.ts` only (plugin registration) | delta file list | ✅ |
| 011.2 | no session store / token revocation | no new session-store file; tokens untouched | delta file list | ✅ |
| 011.3 | `ChangePasswordCard` untouched | `git diff base..tip -- <card>` = empty | — | ✅ |
| 011.4 | policy stays `MIN_PASSWORD_LENGTH = 8` verbatim | `validatePasswordPolicy` reuses the constant | service tests | ✅ |
| 011.5 | admin/users page guards unchanged | `app/(dashboard)/admin/users/{page,[id]/page}.tsx` not in delta | — | ✅ |
| 011.6 | `navItems.ts` byte-unchanged | not in delta (`git diff --stat` = 0 lines) | — | ✅ |

**Coverage: 11/11 REQs, every acceptance criterion mapped to implementing code AND a test/artifact pin. No criterion found without either.**

## 2. Cross-Artifact Consistency

- `tasks.md`: **90 `[x]` / 6 `[ ]`** — every unchecked box is inside Task 15 (knowledge propagation, sub-items 15.*), which is intentionally open (runs next). Tasks 0-14 fully closed.
- `deferred-items.md`: blocker-glyph grep (🔴🚫❌⚠) = **0**; all six rows ⚪ Deferred (accepted). Matches the ledger's zero-blocker contract.
- Delta boundary re-confirmed from the file list: no nav items, no migration/session-store/mail files, no dependency changes; plan-artifact files confined to `ai/plans/…/outcome/` + `tasks.md`.

## 3. A11y + RTL Spot-Check (dialog + page)

- **Labels**: dialog fields use `AdminDialogFieldLabel htmlFor` ↔ matching `TextField id` (explicit association); page fields use MUI `TextField label` (built-in association); checkbox uses `FormControlLabel`.
- **Error semantics**: `aria-invalid` set on every errorable field in BOTH surfaces (dialog: password + confirm; page: current/new/confirm); `helperText` mirrors the message; page helperText is `aria-live="polite"`.
- **Focus management**: MUI `Dialog` provides trap + initial focus + Escape/backdrop close; dialog is conditionally mounted and `key`-ed by target id so state never leaks across targets; page is a plain route with a natural DOM order (`AuthFormHeader` → notice → form).
- **Icon-only buttons**: every show/hide toggle carries a localized `aria-label` + `Tooltip` + 44px touch target + shared `focusVisibleRingSx` ring (dialog replicates the `CreateUserCredentialField` recipe verbatim).
- **RTL**: `DirectoryActionsMenu` KeyIcon uses `marginInlineEnd` (logical); `InputAdornment position="end"` is logical (auto-flips in RTL); Visibility icons are direction-symmetric; no physical left/right CSS introduced by the delta. (The pre-existing `mr: 1` on `AuthFormShared`'s lock glyph predates the tip — delta to that file is the optional-subtitle change only.)
- **Arabic copy**: `changePasswordDialog.*`, `auth.changePassword.*`, and the three error labels all present in `ar/` with en/ar key parity enforced by the two parity belts (85 + 58 pass, run below); forced-reset subtitle + notice collapse correctly for un-flagged voluntary visitors (shared predicate).

## 4. Build/Runtime Sanity (solo runs)

| Command | Result |
|---|---|
| `bun tsgo` | ✅ clean — zero errors |
| `bun run lint` | ✅ clean — zero findings |
| `bun run test/scripts/run-test.ts backend/graphql/test/schema-surface.test.ts` | ✅ **104 pass / 0 fail** (562 ms, 657 expect) — matches R10's recorded count; incl. byte-identical SDL emission |
| `shared/locale/adminUsers-namespace.parity.test.ts` (bonus) | ✅ 85 pass / 0 fail |
| `shared/locale/errors-namespace.parity.test.ts` (bonus) | ✅ 58 pass / 0 fail |

## Findings

| # | Severity | Location | Finding | Suggested fix |
|---|---|---|---|---|
| — | — | — | **Zero.** No new actionable finding. Notes examined and dismissed as non-actionable: (a) REQ-006.6's "ONLY operation that clears the flag" coexists with REQ-004.2's mandated admin-side clear — both are implemented exactly as their respective criteria specify, so the spec-internal tension is a pre-existing authoring nuance, not a delta defect (and the admin-side clear was R10's accepted last-writer-wins territory); (b) `AuthFormShared`'s physical `mr: 1` on the lock glyph is pre-existing code outside the delta's 12-line change; (c) the suspended-but-not-deleted caller can still self-clear via `changeMyPassword` — R10-rejected candidate (a), no new evidence. | — |

## Verdict

**PASS — zero findings (0 HIGH / 0 MEDIUM / 0 LOW).** Independent confirmation at `7760c5c9`: all REQ-001..REQ-011 acceptance criteria trace to implementing code and a test/artifact pin (coverage table above); cross-artifact state is exactly as expected (tasks 0-14 closed, Task 15 intentionally open, ledger zero blockers); both new UI surfaces pass the a11y/RTL spot-check; and the typecheck, lint, and schema-surface suite are green at the tip with counts matching the last recorded gates. Nothing outstanding from this review; the plan is ready for Task 15 (docs propagation) to run.
