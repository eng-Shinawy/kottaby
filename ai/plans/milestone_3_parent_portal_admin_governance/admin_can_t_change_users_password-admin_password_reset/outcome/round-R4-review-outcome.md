# Review Iteration R4 — Adversarial Security Re-Probe (Tip)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Feature tip:** `187518a4` · **Base:** `5a8369fe` · Delta: 121 files (+7814/−266).
**Reviewer:** independent R4 (pentest lens). **Mode:** READ-ONLY — no git state changes; all feature content read via `git show 187518a4:<path>` (working tree confirmed clean at base `5a8369fe`, feature files absent).

## Scope & Method

Adversarial re-probe of the CURRENT tip, prioritizing attack surface introduced by the fix waves (post-fix-1..4), followed by a full surface re-sweep. Prior findings (R1: 2, R2: 2, R3: 6 — all fixed per post-fix-2/3/4) and accepted items (http-200 literal, same-as-current order, D1–D6, pre-existing out-of-delta issues) excluded per instructions.

Read at the tip:
- **Fence:** `backend/db/repo/users/user.repository.ts` (`updatePassword` conditional write, full), `backend/services/auth/auth.service.ts` (`changeMyPassword` full, all denial/log sites).
- **Gate:** `backend/graphql/passwordChangeGate.ts` (full), `app/api/graphql/apollo-server.ts` (plugin registration), `schema-surface.test.ts` pins, `frontend/graphql/generated/schema.graphql` (Subscription-type absence, `User`/input shapes).
- **Redirect consumer:** `frontend/providers/apollo/utils/error-surface.ts` (full), `error-link.map.ts` (`PASSWORD_CHANGE_REQUIRED` row), `error-link.map.test.ts` (redirectTo pins), `GraphQLErrorSurfaceHost` registration seam.
- **Session seam:** `frontend/context/AuthContext.ts`, `frontend/providers/apollo/AuthProvider.tsx`, `frontend/views/auth/change-password/useChangePasswordForm.ts`, `frontend/lib/auth/withPageAuth.ts`, `DashboardLayout.tsx` mirror.
- **Admin path:** `admin-users.mutation.ts`, `admin-user.pothos.ts`, `user-management.service.ts` (`setUserPassword`), `user-management.helpers.ts` (`validatePasswordPolicy`), `admin-user.types.ts`.
- **Tests at tip:** `password-change-gate.test.ts` (28 cases read), `admin-password-reset.journey.test.ts` (7 steps + deep `passwordHash` walker + cast-scoped zero-audit deltas read), repo/auth-service fence tests.

## Probe 1 — `updatePassword` conditional-write fence (new attack surface)

Verified: Drizzle-parameterized `WHERE id = ? AND password_hash = ?` (no injection); fence seed (`observedPasswordHash`) is the server-observed hash — never logged (`logDomainError` sites carry `{code, entity, entityId, locale}` only), never echoed to the wire, absent from all denial payloads; zero-row miss folds into the SAME `CURRENT_PASSWORD_INVALID` field-targeted denial as wrong-password/vanished/deleted (constant shape, zero writes, in-tx rollback). Admin path omits the fence per plan §5.1 last-write-wins (documented). A hypothetical `null` seed would compile to `= NULL` (never matches) — fail-closed. Repo tests pin stale-hash→null+zero-writes; auth tests pin a true committed-concurrency race on the production path. **No exploitable fence bypass, side channel, or retry oracle found.** Residual observation (INFO, not actionable): the fenced-miss path performs compare+hash+failed UPDATE while wrong-password stops at compare, so a ~100–300 ms timing differential exists — but the only inference available is "a concurrent rotation of MY OWN row happened," which is non-secret to the caller and no cross-principal signal.

## Probe 2 — `error-link` redirectTo consumer (new attack surface)

Verified: the only `redirectTo` producer is the pure map's `PASSWORD_CHANGE_REQUIRED` row, hardwired to the module constant `CHANGE_PASSWORD_PAGE_PATH` (`"/change-password"`); row selection keys on `extensions.code` only — no error-payload string ever reaches `window.location.href`. **No open redirect.** Loop-guarded (exact + `endsWith` pathname check) and honored once per session via a module-level latch set before navigation; navigation only fires client-side (window guard) and never on `/login` paths. Tests pin: row pairing (query/mutation), "no other mapping row carries a redirectTo", loop-guard, once-per-session, headless inertness. Observation (documented behavior, not a defect): the once-per-session latch means a SECOND mid-session re-flag in the same SPA session surfaces the localized denial but won't re-navigate — the SSR `withPageAuth` fence still catches the next navigation, and the copy always surfaces, so no bypass of the enforcement boundary.

## Probe 3 — `updateSessionUser` seam (spoof check)

Verified: `updateSessionUser` merges an arbitrary `Partial<AuthUser>` into React state ONLY. A crafted/spoofed `mustChangePassword: false` (or any patched field) yields at most client chrome — `DashboardLayout`'s mirror and `roleDashboardPath` are client navigation aids, while both server enforcement boundaries are client-state-blind: the Apollo gate plugin reads the DB-refreshed `ctx.user` on EVERY request, and the SSR fence reads `getServerUserContext()`. Grep confirms no server-side consumer of client auth state. **No spoofable trust path.**

## Probe 4 — Full surface re-sweep at tip

- **Gate escape:** closed 7-member case-sensitive allowlist; `selection.name.value` (alias-laundering dead); inline + named + transitive fragment flattening with cycle guard; per-operation deny (exempt+gated mix denies); batch elements each pass `didResolveOperation` (fail-closed); introspection root fields (`__schema`/`__typename`) are non-exempt → denied for flagged callers (fail-closed, no discovery oracle); **no GraphQL `Subscription` type exists in the schema** → no subscription-path escape; `didResolveOperation` fires after APQ document resolution.
- **BOLA/IDOR:** `ChangeMyPasswordInput`/`AdminSetUserPasswordInput` carry no identity member (validation-time death on injected ids); self path derives `ctx.user.id`; admin path scope-gated `$all {authenticated, Admin}` + strict `assertActorAdminActive`.
- **Mass-assignment:** both new inputs are exactly-two-member closed shapes; `AdminUpdateUserPatchInput` whitelist untouched; `mustChangePassword` reachable through no input type (only the two service write sites).
- **Privilege escalation:** gate exemptions add no authority (self-service escape hatches + public auth entries only); `updateMyLocale` writes nothing but the caller's locale.
- **Injection:** all new SQL is Drizzle-composed or parameterized raw SQL (`= ANY($1)`).
- **Info disclosure:** `passwordHash` grep over generated SDL + generated client = **0 hits**; `User`/`AdminUserDetail` expose `mustChangePassword` only (+ pre-existing governance booleans); constant denial shapes on every path; admin deleted-target and absent-id fold to the SAME `USER_NOT_FOUND` (no deleted-vs-missing oracle); self path: deleted, vanished, wrong-password, fenced-miss all identical `CURRENT_PASSWORD_INVALID` — **no NEW oracle vs the missing-identity case** (deleted + missing are both fast-path immediate throws with identical shape; the wrong-password path's bcrypt delay is inherent to proving a credential and predates the delta).
- **Audit atomicity:** admin path = guarded UPDATE → deleted/absent fold BEFORE audit insert → exactly ONE audit row sharing the tx (rollback on denial = zero writes + zero audit rows); audit details carry field names + flag only, never the credential/hash; journey test pins cast-scoped count deltas for every denial step.

## Probe 5 — Journey/wire security assertions at tip

Confirmed pinned in test source (not re-run — see note): `admin-password-reset.journey.test.ts` — foreign non-admin `setUserPassword` → FORBIDDEN with zero writes + zero audit rows (step 4); gate denial + exempt escape-hatch matrix (step 5); self-service clear with zero audit rows (step 6); ONE Update audit row with `changedFields ["credentials"]` whose raw details exclude the hash (step 2); a deep recursive walker asserting `passwordHash` is absent from EVERY mutation output (L152–166); teardown asserts zero audit residue. `password-change-gate.test.ts` — allowlist closedness (casing/suffix/unknown), extraction flattening (inline/named/nested/self-referential), per-operation deny, constant denial shape (no trigger-detail leak), HTTP-200 channel, real-finalizer pass-through EN+AR with zero leak, plugin hook surface.

**Solo test run note:** NOT executed. The working tree is externally at base `5a8369fe` (clean, `backend/graphql/test/password-change-gate.test.ts` absent); materializing the tip requires `git checkout 187518a4 -- .`, a state-changing git command prohibited for this read-only review. Assertions were verified by reading the test sources at the tip instead; the final gate (`14-final-gate-outcome.md`) plus post-fix-3/4 verification matrices record green runs of these suites at the same content.

## Findings

**None.** No new actionable security findings on the tip.

| # | Severity | Location | Finding | Suggested fix |
|---|---|---|---|---|
| — | — | — | No new HIGH/MEDIUM/LOW findings. Two informational observations recorded inline above (fence-miss timing differential, self-account only; once-per-session redirect latch on second re-flag, by design) — neither crosses the actionable bar. | — |

## Verdict

**PASS — 0 new findings (0 HIGH / 0 MEDIUM / 0 LOW).** The fix-wave surfaces hold up under adversarial re-probe: the conditional-write fence is parameterized, leak-free, and folds every miss into the single constant denial; the redirectTo consumer is constant-sourced, loop-guarded, and deduped; the session seam is client-cosmetic with DB-backed server enforcement on both boundaries; the gate remains a closed, fail-closed, alias/fragment/batch/introspection-proof operation fence with no subscription escape; and the journey/wire suites at the tip still pin zero-audit denials and deep `passwordHash` walks. The feature is ship-ready from the pentest-lens perspective; no further fix wave required.
