# Task 7 Outcome — Server-authoritative forced gate: Apollo op-guard + `withPageAuth` fence + `DashboardLayout` mirror

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `7. Server-authoritative forced gate: withPageAuth option + DashboardLayout redirect + Apollo operation-guard plugin (D6, REQ-005, REQ-011)` (Phase 3 — GraphQL Surface)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent (COMPLETION PASS — a previous agent was interrupted after writing most of the code) · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; paths resolve 1:1)
> **Result:** three-layer gate verified complete and correct against D6/REQ-005; gate contract suite **34 pass / 0 fail / 59 expect()**; SSR fence suite **4 pass / 0 fail / 9 expect()**; schema-surface regression suite **101 pass / 0 fail / 645 expect()**; sub-loop `--lifecycle duplicates` exit **0 on all 6** Task-7 files; full-repo `bun tsgo` **0 errors / exit 0**. Zero code changes needed this pass (the interrupted agent's implementation was sound); this pass delivered verification, the missing process artifacts (outcome, checkbox flips, worklog), and the §5 carry-forward record. No commits made.

## 1. What Was Implemented (interruption accounting)

### 1.0 Completed by the interrupted agent (VERIFIED this pass, not redone)

All three layers were already written and uncommitted in the worktree:

- **`backend/graphql/passwordChangeGate.ts` (NEW, 243 lines)** — the full D6a plugin module. Verified 1:1 against the plan:
  - `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` — the CLOSED 7-name allowlist, `Object.freeze`ed, in contract order: `me`, `changeMyPassword`, `logout`, `updateMyLocale`, `login`, `registerUser`, `refreshToken` (`:68-76`) + `ReadonlySet` lookup (`:78`) + pure membership predicate `isExemptRootField` (`:85-87`, case-sensitive/closed).
  - `extractOperationRootFieldNames(operation, document)` (`:101-142`) — pure AST walk collecting every executable root field, flattening inline fragments AND named fragment spreads (the `query { ...RootFields }` bypass vector), cycle-guarded, de-duplicated; null/undefined-tolerant.
  - `isPasswordChangeRequired(user, rootFieldNames)` (`:162-178`) — the single pure deny decision: anonymous (`null`/`undefined`) → no-op; un-flagged (`mustChangePassword !== true`) → strict no-op; flagged → deny when ANY observed root field is non-exempt (**per-OPERATION** semantics, not per-field-AND).
  - `PasswordChangeRequiredDenial extends ForbiddenError` (`:203-213`) — re-declares `code = "PASSWORD_CHANGE_REQUIRED"` over the base family code, re-stamps `extensions.code`, and carries `extensions.http.status = 200` so the denial rides the same 200-channel every other DomainError uses instead of Apollo's default 500 for hook-thrown errors.
  - `buildPasswordChangeRequiredDenial(localizedMessage)` (`:215-217`) — structural seam so the wire contract is testable without Apollo.
  - `createPasswordChangeGatePlugin()` (`:228-243`) — `requestDidStart → didResolveOperation` listener; reads `requestContext.contextValue.user` + `.locale` ONLY (the context factory's existing per-request `UserRepository.findById` row — **ZERO new queries**); resolves the message through `getServerTranslations(ctx.locale).errorsTranslations.passwordChangeRequired` (the per-request seam, never a boot-time locale); throws the denial BEFORE any resolver runs. Logs nothing itself (the boundary finalizer's domain-rejection pass-through owns observability).
- **`app/api/graphql/apollo-server.ts` (MODIFIED)** — `createPasswordChangeGatePlugin()` imported and registered FIRST in the `plugins` array, beside `createGraphqlErrorsFinalizerPlugin()` (the plan's exact registration home). Comment documents the deny semantics + zero-extra-query property. **No new `app/api/**` route** (git status: only this file under `app/`).
- **`frontend/lib/auth/withPageAuth.ts` (MODIFIED)** — D6b: `allowMustChangePassword?: boolean` option (default-`false` semantics via `=== true` opt-out), the pure decision seam `shouldRedirectToChangePassword(user, allowMustChangePassword)` (`:82-90`), and the fence branch in `withPageAuth` (`:124-132`) placed **AFTER the authentication check, BEFORE the role check** so a flagged caller is fenced regardless of role. The flag rides the SAME cached `getServerUserContext()` (`react.cache`) row the anonymous check just read — **no extra DB round-trip**. Redirect target: module-private `CHANGE_PASSWORD_PAGE_PATH = "/change-password"` (`:74`).
- **`frontend/lib/auth/withPageAuth.test.ts` (NEW)** — locks the SSR decision seam's full branch matrix: flagged + default/unset → redirect; un-flagged (false flag × all three option states) → never; `allowMustChangePassword: true` (the `/change-password` page itself) → exempt even when flagged; null/undefined identities → no-op.
- **`frontend/views/dashboard/layout/DashboardLayout.tsx` (MODIFIED)** — D6c: `CHANGE_PASSWORD_ROUTE = "/change-password"` constant (documented: server-only `withPageAuth.ts` cannot be imported into a client component, so the literal is mirrored), the structural flag reader `hasForcedPasswordResetFlag(user)` (absent field / non-`true` → not flagged — activates with zero layout changes once the session `me` document selects the flag field), and a `useEffect` that `router.replace()`s to `/change-password` only after `isAuthenticated && !isLoading` — the immediate UX mirror, non-authoritative by construction. Target is OUTSIDE the `(dashboard)` group → no loop.
- **`backend/graphql/test/password-change-gate.test.ts` (NEW, 311 lines)** — the gate contract suite (repo test-home convention `backend/graphql/test/`), 34 tests: closed-allowlist pins (exact set + order, all 7 exempt names via `test.each`, closed-set probes: casing variants, suffixes, typo, `adminSetUserPassword` deliberately gated, `users`, empty string); extraction pins (direct multi-root, inline fragment, root-level named spread, transitive nested spreads, self-referential cycle guard, unknown spread skipped, null/undefined operation); deny-predicate matrix (anonymous no-op, un-flagged no-op incl. `{}`, flagged + gated → deny, flagged + EACH of the 7 exempt names → allow via `test.each`, per-operation deny on `{me, users}`, empty-set allow); denial carrier (ForbiddenError + DomainError instance-of, `code` AND `extensions.code` = `PASSWORD_CHANGE_REQUIRED`, `extensions.http.status === 200`, CONSTANT shape — extensions keys exactly `{code, http}`, localized EN message, no field name in the message, no `path`); boundary pass-through through the REAL `finalizeGraphqlErrors` (EN + AR, `requestId` attached, wire item carries code+http+requestId only — no trigger-detail leak); plugin registration surface (exactly the `requestDidStart` hook).

### 1.1 Completed by THIS pass (the remainder)

- Full verification of every layer against Task 7's acceptance criteria + D6/REQ-005 (verdict table §3).
- Test runs (gate suite, SSR suite, schema-surface regression), the 6-file quality loop, and full-repo `bun tsgo`.
- This outcome file, the Task 7 checkbox flips in `tasks.md`, and the `worklog.md` record.
- **No code edits were required** — the interrupted agent's code passed every check first-run; nothing was missing, nothing was wrong.

## 2. Files Modified / NOT Modified

| File | Change | Author |
|---|---|---|
| `backend/graphql/passwordChangeGate.ts` | NEW — op-guard module (§1.0) | interrupted agent (verified) |
| `app/api/graphql/apollo-server.ts` | +import +`createPasswordChangeGatePlugin()` first in `plugins` | interrupted agent (verified) |
| `frontend/lib/auth/withPageAuth.ts` | +`allowMustChangePassword` option + `shouldRedirectToChangePassword` + fence branch (auth→fence→role) | interrupted agent (verified) |
| `frontend/lib/auth/withPageAuth.test.ts` | NEW — SSR decision-seam branch matrix (4 tests) | interrupted agent (verified) |
| `frontend/views/dashboard/layout/DashboardLayout.tsx` | +route constant + structural flag reader + client `router.replace` effect | interrupted agent (verified) |
| `backend/graphql/test/password-change-gate.test.ts` | NEW — gate contract suite (34 tests) | interrupted agent (verified) |
| `ai/plans/…/outcome/7-outcome.md` | This file (new). | this pass |
| `ai/plans/…/tasks.md` | Task 7 main line + `7.QL/7.TE/7.SEC/7.SR/7.IV` flipped only. | this pass |
| `worklog.md` | Appended Task 7 record. | this pass |

**Files NOT modified (and why):** `frontend/views/dashboard/nav/navItems.ts` — byte-unchanged, PROVEN (`git diff --stat` empty, absent from `git status`; 7.SR/REQ-011.6 — `/change-password` is a forced gate, never a nav item); `backend/graphql/gqlContextFactory.ts` (the flag already rides the existing per-request `findById` — Tasks 2/4-fix); `backend/lib/auth/server-auth.ts` (cached `getServerUserContext` consumed as-is); `backend/graphql/graphqlErrorsFinalizer.ts` (the denial passes through its existing DomainError classifier — no change, only a pass-through test); `app/change-password/page.tsx` (Task 10's deliverable — the fence targets the path; the page ships later); `frontend/graphql/sharedDocuments/**` (the `me` document selecting `mustChangePassword` + `changeMyPasswordMutationDocument` belong to the document task — the client mirror reads the flag STRUCTURALLY so it activates with zero layout changes when the document lands); `shared/locale/**` (Task 8 already shipped `passwordChangeRequired` EN/AR); no barrels edited (gate imported directly); **no `app/api/**` route beyond the plugin registration**; no generated files touched (zero new SDL — the gate adds no schema surface).

## 3. Verification Results

### 3.1 7.TE — suites (all via `bun run test/scripts/run-test.ts`)

| Suite | Result |
|---|---|
| `backend/graphql/test/password-change-gate.test.ts` | **34 pass / 0 fail / 59 expect()** |
| `frontend/lib/auth/withPageAuth.test.ts` | **4 pass / 0 fail / 9 expect()** |
| `backend/graphql/test/schema-surface.test.ts` (regression — gate adds no SDL) | **101 pass / 0 fail / 645 expect()** |

100% branch coverage of the allowlist predicate holds by construction: every exempt name IN (`test.each` over the frozen constant — the set and the test matrix are the same source, so drift fails the pin), closed-set probes OUT (case/suffix/typo/unknown/empty), and every predicate branch (null/undefined, un-flagged incl. flag-absent `{}`, flagged-gated, flagged-exempt, mixed-root deny, empty-root allow).

### 3.2 7.QL — sub-loop `--lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates)

| File | Exit |
|---|---|
| `backend/graphql/passwordChangeGate.ts` | **0** |
| `backend/graphql/test/password-change-gate.test.ts` | **0** |
| `app/api/graphql/apollo-server.ts` | **0** |
| `frontend/lib/auth/withPageAuth.ts` | **0** |
| `frontend/lib/auth/withPageAuth.test.ts` | **0** |
| `frontend/views/dashboard/layout/DashboardLayout.tsx` | **0** |

### 3.3 Type check

Full-repo `bun tsgo` → **0 "error TS" lines, tool exit 0** — zero NEW errors vs the Task-0 baseline.

### 3.4 Layer-by-layer verdicts

- **(a) API layer — VERIFIED.** Deny fires at `didResolveOperation` (after parse/validation, before any resolver → zero writes/audit rows/field errors). Multi-root with one non-exempt field → whole operation denied (test-pinned). Constant `FORBIDDEN`-family + `PASSWORD_CHANGE_REQUIRED`; the wire item provably carries no field name, operation name, or path (`extensions` keys pinned to `{code, http, requestId}` post-finalization; message is the constant localized string). Fragment-spread flattening closes the root-level-spread bypass.
- **(b) SSR layer — VERIFIED.** Order is exactly auth → fence → role; `allowMustChangePassword: true` opts out (reserved for the Task-10 `/change-password` page); reuses the single cached `getServerUserContext()` (no extra DB round-trip).
- **(c) Client layer — VERIFIED.** Redirect only after `isAuthenticated && !isLoading`; `router.replace` (no history entry); target outside `(dashboard)` → **no redirect loop** with either the SSR fence or the login redirect.
- **7.SEC extras — VERIFIED.** The gate reads DB truth (`ctx.user.mustChangePassword` from the context factory's per-request `UserRepository.findById`), NOT a JWT claim — an admin-set flag takes effect on the next request. Anonymous callers are a no-op here (the per-field scope layer owns their denial, per REQ-005.6).
- **7.SR extras — VERIFIED.** Zero new queries in all three layers; `navItems.ts` byte-unchanged (proven); no `app/api/**` route beyond the registration; no `console.*` anywhere new (grep across all six files: zero matches); no plan-artifact references in code comments (grep for `D6|REQ-005|REQ-011|Task 7|tasks.md|plan.md`: zero matches); enums/values discipline untouched (no new literals beyond the allowlist names, which ARE the contract).

## 4. Subtask Pipeline

- **7.QL** ✅ — §3.2: 6/6 files exit 0 (all five stages each).
- **7.TE** ✅ — §3.1: gate predicate + allowlist + redirect branches green; 100% branch coverage of the allowlist predicate (§3.1 note); schema-surface regression still green.
- **7.SEC** ✅ — constant `FORBIDDEN` + `PASSWORD_CHANGE_REQUIRED` with a pinned zero-leak wire shape; gate reads DB truth, not a JWT claim (REQ-005.5); no redirect loop (`/change-password` sits outside the `(dashboard)` group so neither the SSR fence nor the client mirror can loop; the page itself will pass `allowMustChangePassword: true` in Task 10).
- **7.SR** ✅ — zero new queries (plugin reads the existing context row; SSR fence rides the cached context; client reads the session user); `/change-password` is a forced gate, NOT a nav item (`navItems.ts` diff empty, REQ-011.6); no `app/api/**` route beyond the plugin registration.
- **7.IV** ✅ — read in full BEFORE verifying/editing: `backend/graphql/AGENTS.md`, `app/AGENTS.md`, `.agents/instructions/frontend.instructions.md` (plus `backend/lib/errors.ts` + `graphqlErrorsFinalizer.ts` conventions for the denial contract). Honored rules of note: DomainError-family errors only; masking/observability belongs to the boundary finalizer alone (the gate logs nothing); exactly-one finalizer registration preserved (gate registered alongside, not around, it); no new route ⇒ no `ROUTE_INVENTORY` row needed; cached `react.cache()` pattern for the SSR guard; client component uses hooks legitimately (client layer by directive).
- **Semantic-review checklist:** tenancy/BOLA — the gate is identity-blind (reads only the caller's own flag); no cross-actor surface. Race conditions — none introduced (pure predicates + context reads; the flag is re-read per request by the existing context factory). Enums-as-values — none touched. Cross-layer imports — gate → errors/locale seams only (the finalizer's established pattern); `apollo-server.ts` → gate module (app → backend seam already canonical there). Dead code — none. Deferred items — token revocation (ledger D2) untouched, correctly: the gate is the plan-owned hit radius while the flag is set.

## 5. Carry-Forward Knowledge (for Tasks 9/10/11)

- **Allowlist constant location (Task 11's journey — step 5's denial leg):** `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` lives at `backend/graphql/passwordChangeGate.ts:68-76` (exported, frozen). The journey asserts a flagged target's non-exempt operation → `PASSWORD_CHANGE_REQUIRED` ON THE WIRE; the unit tier here pins the predicate/denial contract, the live-wire tier belongs to the journey (stated in the test header). Also useful: the exported pure seams (`isPasswordChangeRequired`, `extractOperationRootFieldNames`, `buildPasswordChangeRequiredDenial`) let the journey construct light-harness denials without booting Apollo, if needed.
- **Task 10 page contract:** `app/change-password/page.tsx` MUST be top-level (outside `(dashboard)`) and MUST call `withPageAuth({ allowMustChangePassword: true })` — the ONLY sanctioned `true` site (7.SEC/REQ-005.3). The client mirror's literal `CHANGE_PASSWORD_ROUTE` in `DashboardLayout.tsx` and the SSR `CHANGE_PASSWORD_PAGE_PATH` in `withPageAuth.ts` must stay equal to the actual route path.
- **Session-flag activation (Task 9's document ripple):** `DashboardLayout.hasForcedPasswordResetFlag` reads the flag STRUCTURALLY (`"mustChangePassword" in user && user.mustChangePassword === true`), because `AuthUser = NonNullable<MeQuery["me"]>` tracks the `me` selection. When the shared auth documents gain the `mustChangePassword` field on `me` (and `changeMyPasswordMutationDocument`), the client redirect activates with ZERO layout changes; re-run both codegen steps then.
- **Denial shape the UI maps on (Task 10's form/error surfaces):** wire item = `extensions.code === "PASSWORD_CHANGE_REQUIRED"` (+ `requestId`), constant localized message, no `fields` payload, no `path` — a single client branch (redirect to `/change-password`) consumes it; nothing else is disclosed.
- **Finalizer interaction (already test-proven):** hook-thrown DomainErrors ride Apollo's `formatError` envelope hop → `finalizeGraphqlErrors` pass-through, so the denial needs no finalizer change; `extensions.http.status = 200` is consumed by Apollo into the response status and never reaches the wire item.
- **Test-DB prerequisites held:** `must_change_password` column live on production read paths (Tasks 1/2/4/4-fix); seed users present; no schema/seed operations needed this task.
- Shared-worktree note: `git status` also carries the pre-existing Task 0–6/8 artifacts and the baseline `Caddyfile` edit; this task's diff is exactly the six files in §2 authored by the interrupted agent — this pass added no code.

## 6. Interruption-recovery report (what was found vs completed)

| Expected artifact | Found? | Action this pass |
|---|---|---|
| `backend/graphql/passwordChangeGate.ts` (plugin + predicates + allowlist) | ✅ complete & correct vs D6 | verified, no edits |
| `app/api/graphql/apollo-server.ts` registration | ✅ complete | verified, no edits |
| `frontend/lib/auth/withPageAuth.ts` option + fence branch | ✅ complete | verified, no edits |
| `frontend/lib/auth/withPageAuth.test.ts` | ✅ complete (SSR branch matrix) | verified, ran green |
| `frontend/views/dashboard/layout/DashboardLayout.tsx` client redirect | ✅ complete | verified, no edits |
| Dedicated gate predicate/allowlist test | ✅ already existed at `backend/graphql/test/password-change-gate.test.ts` (repo test-home convention — NOT `backend/graphql/passwordChangeGate.test.ts`) | verified coverage covers the full required matrix; ran green; did NOT duplicate |
| Test runs / sub-loops / tsgo | ❌ not evidenced | executed this pass (§3) |
| `outcome/7-outcome.md` | ❌ missing | written this pass |
| tasks.md checkbox flips | ❌ missing | flipped this pass (Task 7 line + 5 sub-criteria only) |
| worklog.md entry | ❌ missing | appended this pass |
