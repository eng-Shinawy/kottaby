# Review Iteration R6 — Cross-Layer Consistency, Generated Artifacts & Codegen Sync

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Feature tip:** `282e9525` · **Base:** `5a8369fe` · Delta: 125 files (+8266/−266).
**Reviewer:** independent R6 (cross-layer consistency + generated-artifact/codegen-sync lens). **Mode:** READ-ONLY for refs; the working tree was at base `5a8369fe`, so the tip was materialized once via the sanctioned `git checkout 282e9525 -- .` (content restore only; no ref/state changes).
**Prior outcomes read first:** R1 (2), R2 (2), R3 (6), R4 (0), R5 (3) — all fixed at the tip (post-fix-2/3/4 verified in place; post-fix-5 test-only wave verified in place); accepted items (http-200 literal, same-as-current order), D1–D6 deferrals, and pre-existing issues excluded from re-reporting.

## Scope & Method

Five lens checks over the whole delta:

1. **Type cascade** — traced `mustChangePassword` end-to-end at the tip: `users.ts` schema column (`boolean("must_change_password").default(false).notNull()`) → Drizzle `$inferSelect` (`UserSelectType`) → `SAFE_USER_SELECT` (`admin-user-query-helpers.ts:49`) / `AdminUserDetailRow:171` / `AdminUserSafeSelect` (`admin-user.types.ts:309`) / `user-management.mappers.ts:234` → both full-row raw-SQL reads (`user.repository.ts:52,85` — the only other raw SELECTs are narrow id/locale and id/fullName projections that don't need it) → services (`auth.service.ts` fenced write + `stripPasswordHash`; `user-management.service.ts:480,502` audit details) → Pothos (`User.mustChangePassword`, `AdminUserDetail.mustChangePassword`, both `?? false`-total over a notNull column) → SDL → `graphql.ts` → shared documents (`auth.documents.ts:70,107,173` — `me`, `login.user`, `changeMyPassword` all select the flag; `admin-users.documents.ts:83` fragment) → hooks/views (`AuthUser = NonNullable<MeQuery["me"]>` — generated-type-derived, **no manual shadow**; `DashboardLayout` mirror `:29`; `GovernanceCard:119`; `withPageAuth` reads `Pick<RegistrationReturnType, "mustChangePassword">` — same Drizzle-derived source). Exactly two write sites (`UserRepository.updatePassword` callsites: admin 4-arg + self fenced). No layer missing, misnamed, or re-declared.
2. **Codegen sync — executed, not just read:** re-ran `bun run generate:gqlSchema` and `bun run codegen` against the materialized tip and diffed both artifacts against the committed ones. **`schema.graphql`: 0-line diff (byte-identical). `gql/graphql.ts`: 0-line diff (byte-identical).** This proves (a) the Pothos definitions produce exactly the committed SDL — which contains EXACTLY the sanctioned delta (2 inputs `AdminSetUserPasswordInput`/`ChangeMyPasswordInput`, 2 mutations `adminSetUserPassword`/`changeMyPassword`, 2 `Boolean!` fields on `AdminUserDetail` + `User`, plus the `changeMyPassword` description); (b) every shared document's operation resolves against the SDL (`noSilentErrors: true`, clean generate — no stale types possible); (c) **no hand-edits exist in either generated file** (any hand-edit would necessarily drift from deterministic regeneration; the delta hunks are machine-shaped: lexicographic type placement, codegen's adjacent-block re-emission when `AdminSetUserPasswordDocument` sorts between siblings).
3. **Cross-surface error contracts** — all five codes grepped repo-wide: `PASSWORD_CHANGE_REQUIRED` (gate `passwordChangeGate.ts:205,211` carrier + `extensions.code`; `error-link.map.ts:263,269` row, both context kinds; `error-surface.ts` consumer; `errors` i18n key `passwordChangeRequired` EN+AR; journey + gate tests), `CURRENT_PASSWORD_INVALID` / `NEW_PASSWORD_SAME_AS_CURRENT` (auth.service producer = `errorsTranslations.currentPasswordInvalid`/`newPasswordSameAsCurrent` consumer; field tags `currentPassword`/`newPassword` projected 1:1 by `useChangePasswordForm` incl. the documented `password`→`newPassword` policy-tag projection `:76`), `PASSWORD_REQUIRED` / `PASSWORD_TOO_SHORT` (single helper `user-management.helpers.ts:239-241,327-329` feeding BOTH the admin path and `auth.service.ts:408-410`; messages ride the pre-existing `authTranslations.passwordRequired/passwordTooShort` keys; field tag `password` read verbatim by the admin dialog `fieldErrors.password` `ChangeUserPasswordDialog.tsx:97` — no rename layer in `graphql-error-utils`). Spelling identical everywhere; the four non-gate codes correctly have NO error-link map rows (they ride the VALIDATION row's `extensions.fields` form projection, not the code-row map).
4. **Route/guard consistency** — `CHANGE_PASSWORD_PAGE_PATH` is the ONLY occurrence of the `"/change-password"` literal in the repo (grep at tip); consumers: `app/change-password/page.tsx` (`withPageAuth` redirectTo), `withPageAuth.ts:124` fence target, `DashboardLayout.tsx:107` mirror, `error-link.map.ts` row payload, `error-surface.ts` loop-guard resolution. `allowMustChangePassword: true` has exactly ONE production consumer (`app/change-password/page.tsx:39`); the page is top-level (outside `(dashboard)`); no other `(dashboard)` page sets the option; **no navItems/navigation file appears anywhere in the delta** (only in-delta menu file is the admin row `DirectoryActionsMenu` kebab).
5. **i18n type flow** — `AuthLabels.changePassword`: EN and AR each add exactly the same 10 leaves in the same order; the types block declares exactly those 10 (flat strings, JSDoc'd); consumed only via handles (`t.changePassword.*`, `getTranslations(locale).authTranslations.changePassword.title` for page metadata). `AdminUsersLabels`: EN/AR added-key sets identical in order (`changePasswordAction`, 9× `changePasswordDialog.*`, 2× `detail.mustChangePassword*`, `snackbars.passwordChanged`); types declare all 13; consumers (`DirectoryMutationDialogs:94`, `UserDetailInlineDialogs:80`, `GovernanceCard:122-123`, `ChangeUserPasswordDialog`, `UserHeroActions` via `Pick<AdminUsersLabels, … "changePasswordAction">`) all resolve through the typed handle. Parity belts re-run green (below).

**Solo re-verifications executed at the tip** (strays killed, `.next-test-dev/dev/lock` cleared, tree restored to tip content):

| Check | Result |
|---|---|
| `bun run generate:gqlSchema` + diff vs committed `schema.graphql` | **byte-identical (0-line diff)** |
| `bun run codegen` + diff vs committed `gql/graphql.ts` | **byte-identical (0-line diff)** |
| `bun tsgo` | **exit 0, 0 errors** |
| `bun run lint` | **exit 0, 0 problems** |
| `shared/locale/adminUsers-namespace.parity.test.ts` | **85 pass / 0 fail** |
| `shared/locale/errors-namespace.parity.test.ts` | **58 pass / 0 fail** |
| `frontend/graphql/sharedDocuments/documents.contract.test.ts` | **33 pass / 0 fail** |

## Findings

| # | Severity | Location | Finding | Suggested fix |
|---|---|---|---|---|
| — | — | — | **None.** No new actionable finding within the R6 lens. Every layer of the flag cascade flows from the single Drizzle schema definition (no shadow/manual re-declaration of the flag anywhere — the only same-named re-declaration is the dialog's 2-field submit payload `AdminSetUserPasswordSubmitInput`, a deliberate frontend-local whitelist documented in post-fix-1 F3 and structurally identical to the backend type, not a shadow of any generated type); both generated artifacts are provably in sync (byte-identical deterministic regeneration); all five error codes, their i18n keys, and the `extensions.fields` tags agree between producers and consumers; the route constant is single-sourced with exactly one `allowMustChangePassword` consumer and navItems untouched; the i18n trees are shape-identical across EN/AR/types and handle-consumed. | — |

**Informational observations (recorded to bound future re-reports — none actionable):**

- `AdminUserDirectoryRow` / the `AdminUserListItem` wire shape deliberately omit `mustChangePassword` — the pending-reset observable lives only on `AdminUserDetail` (detail surface) and `User` (identity surface), exactly matching the sanctioned "2 Boolean! fields" SDL delta. No consumer reads the flag from a directory row.
- No `backend/drizzle/` generated migration folder exists for the new column: this is plan decision **D1** ("pushed, not migrated", `bun run db push` against both `.env` and `.env.test`, no custom SQL — Task-1/2 outcomes) — excluded from re-reporting per instructions.
- `CURRENT_PASSWORD_INVALID`/`NEW_PASSWORD_SAME_AS_CURRENT`/`PASSWORD_REQUIRED`/`PASSWORD_TOO_SHORT` intentionally have no `error-link.map` rows: their denials carry `extensions.fields` and are consumed by the form-bound VALIDATION projection.
- On `/change-password`, the conditional subtitle + temporary-password notice gate on the client `me` restore, so a flagged user sees title-only for the first paint tick (accepted R3-F3 pattern, no contract impact).
- The gate's identity input (`readonly mustChangePassword?: boolean;`, `passwordChangeGate.ts:149`) is a structural narrowing for pure-predicate testability; the production `Context` it is satisfied by is the DB-backed row refreshed per request (and post-fix-5 drives the REAL listener with a complete `Context` literal).

## Coverage Summary

- **Type cascade** ✔ (schema → `$inferSelect` → selects/row-types/mappers → raw-SQL + Drizzle reads → services → Pothos → SDL → `graphql.ts` → documents → hooks/views; single write home; no shadows)
- **Codegen sync** ✔ (byte-identical regeneration of BOTH artifacts; SDL delta exactly sanctioned; every document resolves; no hand-edits)
- **Error contracts** ✔ (5 codes × backend taxonomy / i18n / error-link / client projections / tests; field tags 1:1)
- **Route/guard** ✔ (constant single-sourced; one `allowMustChangePassword` consumer; `(dashboard)` group unaffected; navItems byte-unchanged by delta absence)
- **i18n flow** ✔ (handle-only consumption; EN/AR/types identical shape; parity belts green at the tip)

## Verdict

**PASS — 0 new findings (0 HIGH / 0 MEDIUM / 0 LOW).** The cross-layer surface is coherent at the tip: the flag cascades from one schema source through every layer without a shadow, the generated artifacts are in provable lockstep with the Pothos schema and the shared documents (strongest evidence this round: deterministic byte-identical regeneration of both files), error-code/field-tag contracts agree across all producer and consumer surfaces, the route constant and guard options are exactly as specified, and the i18n trees are symmetric and handle-consumed. No further fix wave required from this lens.
