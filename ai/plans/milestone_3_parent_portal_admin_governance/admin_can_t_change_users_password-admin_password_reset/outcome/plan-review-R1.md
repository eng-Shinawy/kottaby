# Plan Review Gate — Round 1 (Phase 1.5)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Date:** 2026-09-30 · **Reviewers:** a 6-area read-only research swarm (verified `path:line` evidence pack), a 3-artifact authoring swarm (design / tasks / ledger), and an orchestrator citation + structure audit against `@plan-review` dimensions.
**Plan reviewed:** `specs.md` (347 ln) · `plan.md` (393 ln) · `tasks.md` (248 ln) · `deferred-items.md` (31 ln) · `outcome/00-research-evidence-pack.md` (173 ln)

## R1 Findings (all resolved before gate exit)

| # | Layer | Finding | Fix applied |
|---|---|---|---|
| F1 | HIGH · backend citation | `assertActorAdminActive` was cited at `backend/services/admin/admin-guards.helpers.ts:114`; the real home is `backend/services/admin/admin-gate.helpers.ts:133` (verified by grep: `assertActorAdmin` `:114`, `assertActorAdminActive` `:133` in `admin-gate.helpers.ts`) | Corrected in `plan.md` §5 table + `tasks.md` Task 3 + `outcome/00-research-evidence-pack.md` §4 — all now `backend/services/admin/admin-gate.helpers.ts:133` |
| F2 | HIGH · test path | Repo-unit test path was `backend/db/test/repo/users/user.repository.test.ts` — that directory does not exist; the real file is `backend/db/test/logic/users/user.repository.test.ts` (verified) | Corrected in `plan.md` §8 + `tasks.md` Task 2 to `backend/db/test/logic/users/` |
| F3 | HIGH · test path | Service-test path was `backend/db/test/logic/admin/user-management.service.test.ts` — absent; service tests in this repo are colocated, e.g. `backend/services/admin/user-management.service.test.ts` (verified present) | Corrected `plan.md` §8 to extend `backend/services/admin/user-management.service.test.ts` + `backend/db/test/logic/auth/auth.service.test.ts` (both verified to exist) |
| F4 | MED · frontend path | `DashboardLayout` was cited as `frontend/views/dashboard/DashboardLayout.tsx` — the real file is `frontend/views/dashboard/layout/DashboardLayout.tsx` (verified) | Corrected `plan.md` §6 + `tasks.md` Task 7(c) |
| F5 | MED · cross-artifact consistency | Knowledge-propagation target disagreed: `plan.md` tail said `docs/admin/user-management.md`, `tasks.md` Task 15 said `docs/auth/admin-password-reset.md` | Aligned `tasks.md` Task 15 to `docs/admin/user-management.md` (the canonical admin surface, `docs/admin/user-management.md:119`) |
| F6 | LOW · evidence-pack hygiene | The evidence pack's guard row listed the pre-grep guess `admin-guards.helpers.ts:114 / :67` | Corrected to the verified `admin-gate.helpers.ts:114` / `:133` |

## Clean dimensions (R1)

- **Structure:** `plan.md` carries all mandated sections in order (Overview + D1–D9 · UX/Nav 2.1–2.5 · Data Models · API Contracts + SDL + permission mapping · Services/Repos + concurrency assessment + Cross-Actor Journey Design · Components · Security/Tenancy · Testing · Deployment · Outcome protocol).
- **Traceability:** `REQ-001`…`REQ-011` all appear in `tasks.md`; zero misses (the sole grep "miss", `REQ-060`, is a *spec-of-record* reference in `specs.md`'s doc-info table for the shipped admin contract — not one of this plan's requirements).
- **Anti-pattern sweep:** every `Translation.` / `getTranslations(locale,` / `@/frontend/utils/logger` / `next-intl` / `bottom-nav` / raw-`bun test` hit is a *prohibition statement* (specs REQ-002.2, plan D8, tasks protocol rule 6); no actual violation.
- **i18n facts:** `AdminUsers` handle id `"adminUsers.adminUsers"`, the parity walker's function-leaf rejection (`adminUsers-namespace.parity.test.ts:136-145`), and the existing `createDialog.passwordHelper` copy were all verified against the live files.
- **Gate mechanism:** the chosen Apollo operation-guard site is real — `backend/graphql/graphqlErrorsFinalizer.ts:205` exports `createGraphqlErrorsFinalizerPlugin(): ApolloServerPlugin<Context>` with a `requestDidStart` listener shape, so the sibling `createPasswordChangeGatePlugin` in the same plugins array is a faithful pattern.
- **Document lineage:** `frontend/graphql/sharedDocuments/auth/auth.documents.ts` was confirmed to already own `updateMyLocaleMutationDocument:129-134`, so adding `changeMyPasswordMutationDocument` there is correct (not a new file).
- **Scope discipline:** the plan adds exactly one schema column, two mutations, two inputs, two `Boolean!` fields, one top-level page, and zero nav/route-group changes — all deferred subsystems (mail/OTP, session revocation, rate limit, profile card) are recorded in the ledger.

## R2 Verification (post-fix)

Every patched item was re-checked against the live repo by the orchestrator:

| Check | Evidence |
|---|---|
| `assertActorAdminActive` at `backend/services/admin/admin-gate.helpers.ts:133` | `grep -n "export async function assertActorAdminActive"` → exact |
| Repo test file `backend/db/test/logic/users/user.repository.test.ts` | exists (`ls`); `backend/db/test/repo/users/` absent |
| Service tests `backend/services/admin/user-management.service.test.ts` + `backend/db/test/logic/auth/auth.service.test.ts` | both exist |
| `frontend/views/dashboard/layout/DashboardLayout.tsx` | exists (`find frontend -iname "DashboardLayout*"`); the `views/dashboard/DashboardLayout.tsx` path is absent |
| `frontend/graphql/sharedDocuments/auth/auth.documents.ts` owns `updateMyLocaleMutationDocument` | `:129-134` — exact |
| `createGraphqlErrorsFinalizerPlugin` plugin shape | `backend/graphql/graphqlErrorsFinalizer.ts:205` — exact |
| `backend/graphql/graphqlErrorsFinalizer.ts` exists | exists |
| `frontend/stories/lib/storyHarness.tsx` (StoryApolloProvider) + `frontend/stories/admin/` | both exist |
| `withPageAuth` at `frontend/lib/auth/withPageAuth.ts:67` | exact (read in full) |
| Schema has no reset column; `passwordHash` only | `backend/db/schema/users/users.ts:18`, table `:11-45` — exact |
| `UserRepository.updateLocale` `:130` / `create` `:106` | exact |
| Scope mechanism has no default scope | `backend/graphql/pothos/builder.ts:34-36,120-150` — exact |

Post-generation audit: **truncation check** — all five artifacts end on complete sections (`specs.md` review checklist · `plan.md` Outcome protocol · `tasks.md` dependency graph · `deferred-items.md` Enforcement · evidence pack last citation row). **Structure check** — all `plan.md` sections present. **Traceability check** — REQ-001..REQ-011 present in `tasks.md`, zero misses. **Anti-pattern sweep** — clean (prohibition statements only).

## R2 Verdict

**Plan passes all AGENTS.md rules for affected layers.** The engineering substance was grounded by a 6-area parallel code sweep that produced a `path:line` evidence pack (used verbatim by the authoring swarm), and the only findings were mechanical citation/path errors — each fixed and re-verified against the live repo. No architecture, i18n-pattern, tenancy, or scope violation remains.

## Carry-overs for implementers

- The forced-reset gate is the load-bearing half: **do not** reduce it to a client-only redirect. The Apollo operation-guard (D6a) reading the DB-backed `ctx.user` is the enforcement boundary; the SSR `withPageAuth` + `DashboardLayout` redirects are UX mirrors.
- `changeMyPassword` MUST be the only flag-clearing path (D5) — reject `newPassword === currentPassword` or the flag can be cleared with the temporary credential still live.
- Use the ONE repo writer `UserRepository.updatePassword` for both the admin and self-service paths (D3) — do not add a second password-write site.
- Never widen the closed five-field `AdminUpdateUserInput` whitelist (D2); `mustChangePassword` is reachable only through `adminSetUserPassword` / `changeMyPassword`.
- Register `adminSetUserPassword` in `ADMIN_ACTION_CENSUS` + `USER_LIFECYCLE_LEG` (D9) or the audit-completeness drift test fails.
- The `adminUsers` namespace parity walker rejects function leaves — keep new labels flat strings / ICU bands (D8).
- `ai/plans/` is untracked in git — this plan directory is the record of truth; do not expect it in history.
