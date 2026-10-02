# Task 15 Outcome — Knowledge propagation → `docs/admin/user-management.md`

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `15. Knowledge propagation → docs/admin/user-management.md` (Phase 5 — Verification & Propagation, FINAL task)
> **Date:** 2026-10-01 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project`
> **Result:** `docs/admin/user-management.md` extended 218 → 312 lines with the full credential-management contract (§2.6 + §2.7 + Rules/What-NOT/Rollout/Related additions); ALL outcome files (0-baseline … 14-final-gate, plan-review-R1, midpoint-review-R1, rounds R1–R11, post-fix-1..7, 1-fix, 4-fix) read first and their recurring patterns propagated; sub-loop on the `.md` reproduced the repo's documented structural quirk (oxlint "No files found to lint" exit 1) with all compensating gates GREEN (`bun tsgo` 0 errors, `bunx @biomejs/biome check .` exit 0, `bun run lint` exit 0); every cited path/symbol verified at the tip; zero credentials/plaintext in the doc; no source files mutated; no commits made.

## 1. What Was Done

### 1.1 `docs/admin/user-management.md` — extension (the plan's named target)

The canonical doc already existed at the tip with the mandated section order (Why → Pattern (2.1–2.5) → Rules → What NOT to Do → Rollout Summary → Scope Split Record → Related Documents). The credential-management contract was EXTENDED into that structure (never forked into a new doc):

| Section | Addition |
|---|---|
| §2.4 table | +1 row: `Update` (credential rotation — `adminSetUserPassword`) → `entityType "user"`, details `{"changedFields":["credentials"], mustChangePassword}` — flag value ONLY, never the password/hash |
| **§2.6 Credential Management Contract (Admin Rotation + Self-Service Change)** | the two-surface distinction table (GraphQL field / scope / identity / input shape / flag semantics / audit / service); the single `UserRepository.updatePassword` write home (required `tx`, guarded `UPDATE … RETURNING *`, `null` on zero rows, exactly TWO production callsites, `AdminUserRepository` has NO password method; ILLUSTRATIVE SQL block); the optional `expectedCurrentHash` credential fence (READ COMMITTED re-evaluation semantics; admin override omits it — last-writer-wins per concurrent-admin rotations); the shared `validatePasswordPolicy` gate (`MIN_PASSWORD_LENGTH = 8`, `PASSWORD_REQUIRED`/`PASSWORD_TOO_SHORT`, explicit entry construction); constant denials — no oracles (admin: absent ∨ soft-deleted ⇒ `USER_NOT_FOUND` before the audit insert; self: vanished ∨ deleted ∨ wrong-current ∨ fenced-miss ⇒ ONE `CURRENT_PASSWORD_INVALID`; in-tx `isDeleted` re-check on the written row BEFORE commit; `NEW_PASSWORD_SAME_AS_CURRENT` pre-hash); hash discipline (hash-before-tx, plaintext/hashes never logged/audited/echoed, password-stripped output projections); **"the audit trail never carries credentials"** rule; i18n constraints (flat/ICU-only `adminUsers` leaves — parity walker REJECTS function leaves — pinned under BOTH locales; `errorsTranslations` denial keys zero-ICU-pinned; `authTranslations.passwordRequired/passwordTooShort` reused, never re-minted); the audit-census registration discipline (census row + `USER_LIFECYCLE_LEG` + runner + denial attempt + length pins in the SAME change; bijection drift test fails in BOTH directions); the recurring raw-SQL column gotcha (both full-row SELECT lists in `UserRepository` or production no-tx reads silently yield `undefined` while type-checking) |
| **§2.7 Forced Password-Reset Gate (Server-Authoritative Fence)** | the three layers with ONE authority (the DB row, re-read per request; no token claim, no client state): (1) the Apollo operation-guard (`backend/graphql/passwordChangeGate.ts` registered in `app/api/graphql/apollo-server.ts`; fires at `didResolveOperation` pre-resolver ⇒ zero writes/audit rows; reads `ctx.user.mustChangePassword` from the context factory's existing row — DB truth not JWT, ZERO new queries; frozen closed 7-name case-sensitive allowlist; fragment/alias/transitive-spread flattening with cycle guard; PER-OPERATION deny; constant `ForbiddenError`-family carrier, HTTP-200 head, localized message, no trigger-detail disclosure); (2) the SSR fence (`withPageAuth` `allowMustChangePassword` default-fence option, `shouldRedirectToChangePassword`, auth → fence → branch order on the SAME cached context row; the ONLY `allowMustChangePassword: true` site is the TOP-LEVEL `app/change-password/page.tsx` outside `(dashboard)`); (3) the client mirrors (DashboardLayout structural reader + `router.replace`, the error-link `PASSWORD_CHANGE_REQUIRED` row's once-per-session loop-guarded `redirectTo`, and the `updateSessionUser` snapshot merge before the success hand-off) — UX only, server boundaries client-state-blind; flag-lifecycle invariants (login never writes it; gate/fence/mirrors never write it; exactly two writes can change it); route single-sourcing (`CHANGE_PASSWORD_PAGE_PATH` — the page is NOT a nav item) |
| §3 Rules | +7 bullets: single credential write home (fence + in-tx deleted-row re-check are contract, not polish); flag-clearing discipline; server-authoritative gate (closed allowlist + per-operation deny are pinned contract); constant-shape credential denials; closed credential inputs (no widening the five-field profile whitelist); audit + census; i18n parity for credential copy |
| §4 What NOT to Do | +10 bullets: no second password-write path; no flag writes outside the two sanctioned writes; no flag-in-token / client-trust; no widening the credential input whitelists; no credentials in logs/audit/error payloads; no admin operations on the exempt allowlist; no admin mutation without census registration; no function leaves in `AdminUsersLabels`; no re-spelling the forced-reset route literal / no nav item; no skipped raw-SQL column lists |
| §5 Rollout Summary | + the full credential-vertical file inventory (schema column → repo → services → types → Pothos → mutations → gate → frontend fence/mirrors/redirect/page/dialog → shared documents → locale leaves) + a credential-surface test-lock paragraph citing the 13 green suites with their recorded pass counts (7/38/4/78/16/17/104/14/49/19/20/26/85+58/45) |
| §7 Related Documents | + one-directional cross-reference to `docs/auth/user-registration.md` (the self-service credential path — `changeMyPassword` rides the same `hashPassword`/`comparePassword` primitives and is the ONLY self-service flag clear); the Authoritative-implementations list extended with the credential-vertical files; the Test-locks line extended |

**Explicitly NOT touched:** `AGENTS.md`, `.agents/instructions/*`, `frontend/AGENTS.md`, `backend/AGENTS.md` (hand-curated — the doc only REFERENCES `backend/AGENTS.md` §2), and every other repo file. `docs/auth/user-registration.md` was left byte-identical (the cross-reference is one-directional from the new material, per the task brief's preference).

### 1.2 In-boundary doc repairs found by 15.TE (link-resolution pass)

Three PRE-EXISTING stale citations in the doc were repaired while extending (all inside the task's single permitted file):

1. `frontend/views/admin/users/AdminUsersDirectoryContainer.tsx` → `frontend/views/admin/users/directory/AdminUsersDirectoryContainer.tsx` (§5 + §7 — the file moved under `directory/`).
2. `frontend/views/admin/users/AdminUserDetailContainer.tsx` → `frontend/views/admin/users/detail/AdminUserDetailContainer.tsx` (§5 + §7 — moved under `detail/`).
3. `docs/backend/types-consolidation.md` (a document that does not exist anywhere in the repo) → `backend/AGENTS.md` §2 "Type Definitions" — the real home of the "admin types live in `backend/types/admin/`, NOT in service-layer `.types.ts` files" rule. (References to read-only `docs/` are unaffected.)

One pre-existing plan-artifact token on a doc line ("lifted in Task 0.2" in §5) was neutralized to "resolved" so the delivered doc carries no Task-N references. The doc's pre-existing `REQ-0xx` identifiers were left untouched — those are the doc's own spec-of-record numbering bound to `docs/specs/functional-requirements.md` (the doc header's stated binding), NOT this plan's REQ-001..011; no plan REQ-/Task/Phase/post-fix/round-R/`.ai-plans` token was ADDED.

## 2. Patterns Extracted from ALL Outcome Files (2+ occurrences → propagated)

| # | Recurring pattern (occurrences) | Where propagated |
|---|---|---|
| 1 | **Single password write home** — `UserRepository.updatePassword` is the only writer; no `AdminUserRepository` password method (Tasks 2/3/4 + R2 + R4 + R10 all verify "exactly 2 production callsites") | §2.6 + Rules + What-NOT |
| 2 | **Hash-before-tx / plaintext never enters a tx, log, audit row, or response** (createUser precedent, Task 3, Task 4, R2, R8, R9, R10) | §2.6 Hash discipline + What-NOT |
| 3 | **Constant-shape denials, no oracles** — absent-vs-deleted fold on the admin path; vanished/deleted/wrong-current/fenced-miss fold on the self path (Tasks 3/4, midpoint F2 → mid-fix-1, R2-F1, R7, R8, R10) | §2.6 + Rules |
| 4 | **In-tx returned-row deleted guard BEFORE commit** — a check after the tx returns is too late (mid-fix-1 admin path; R7-F1 → post-fix-6 self path) | §2.6 + Rules |
| 5 | **Credential fence** (`expectedCurrentHash` conditional write; admin override omits it) (R2-F2 → post-fix-3; R4 probe 1; R7 interleaving table; R10) | §2.6 + Rules |
| 6 | **Gate = DB truth per request, closed frozen 7-name allowlist, per-operation deny, pre-resolver ⇒ zero writes, zero new queries** (Task 7, R2, R4 probes, R5-F2, R10; "DB truth not JWT" is a plan-review carry-over) | §2.7 + Rules + What-NOT |
| 7 | **Client mirrors are UX-only; server boundaries are client-state-blind** (R1-F1 → post-fix-2 `updateSessionUser`; R3-F4 → post-fix-4 redirect consumer; R4 probe 3; R7 interleavings 7–8) | §2.7 layer 3 + What-NOT |
| 8 | **Route single-sourcing** — one `CHANGE_PASSWORD_PAGE_PATH`, top-level page outside `(dashboard)`, never a nav item (Tasks 7/9/10 byte-unchanged `navItems.ts`; R3-F6 → post-fix-4 F6; R6 grep "only occurrence") | §2.7 + What-NOT |
| 9 | **Recurring raw-SQL column trap** — new `users` columns MUST be added to BOTH full-row raw-SQL SELECT lists (`findByEmail` + `findById`) or no-tx production reads silently yield `undefined` while type-checking (Task 4 §7 cross-file dependency → 4-fix; the locale "D2 trap" precedent; R1 non-finding re-verification) | §2.6 gotcha blockquote + What-NOT |
| 10 | **The audit trail never carries credentials** — details = field names + flag only; raw-JSON non-containment pins (Tasks 3/11/12; R8 leakage audit; R9; R10) | §2.4 row + §2.6 + What-NOT |
| 11 | **Audit-census registration discipline** — new admin mutation ⇒ `ADMIN_ACTION_CENSUS` row + `USER_LIFECYCLE_LEG` + runner + denial-matrix attempt + leg-length pins in the SAME change; drift bijection fails both directions (Task 12's four-part coordination; midpoint F1 tracked it as HIGH) | §2.6 + Rules + What-NOT |
| 12 | **`adminUsers` parity constraints** — flat strings / ICU only, the walker REJECTS function leaves, pins under BOTH locales, zero-ICU `errors` denial keys, reuse `authTranslations.passwordRequired/passwordTooShort` (Task 8; R3, R6, R8, R11 parity re-runs) | §2.6 + Rules + What-NOT |
| 13 | **Stale pins assert false contracts** — census/surface/allowlist pins must be refreshed in the same change (Task 6 §7 pin-refresh; Task 3 §1.5; R5's three pin-gap findings) | Rules (audit + census bullet) |
| 14 | **Self-service is deliberately unaudited; admin rotation = exactly ONE `Update` row** (Tasks 4/6/11/12 side-effect matrix) | §2.6 table + Rules |

## 3. Verification Results

### 3.1 15.QL — sub-loop on the doc (the documented `.md` structural quirk)

`bun run scripts/health/sub-loop.ts docs/admin/user-management.md --lifecycle duplicates` → **exit 1 at the oxlint stage: "No files found to lint"** (log: `/tmp/subloop-task15-doc.txt`, re-run recorded `/tmp/subloop-task15-doc2.txt`). This is the repo's KNOWN `.md` quirk documented in `outcome/0-baseline-outcome.md` §7 — structural, not content-related: `docs/**` markdown has no oxlint extension so 0 files match regardless of content; the duplicates stage auto-skips non-`.ts/.tsx` targets. The tsgo stage PASSED for the file ("no errors for docs/admin/user-management.md"). Handled with Task 0's compensating-gates note:

- **`bun tsgo` (full repo)** → exit 0, **0 `error TS` lines** (`/tmp/t15-tsgo.log`) — first-run green, no silent-exit-1, no re-run needed.
- **`bunx @biomejs/biome check .` (full repo)** → exit 0, "Checked 2528 files in 10s. No fixes applied." (`/tmp/t15-biome.log`).
- **`bun run lint` (full repo)** → exit 0 (`/tmp/t15-lint.log`).

### 3.2 15.TE — links resolve; every cited symbol exists

- **Path sweep:** all 82 backticked file paths in the doc extracted and checked on disk. After the three §1.2 repairs, every path resolves — the five residual "shorthand" hits are prose fragments that resolve contextually (`.types.ts` prose; `3-immutability-triggers.sql` exists at `backend/db/migration/3-immutability-triggers.sql`; `public-operations.ts` / `user-management.helpers.ts` / `ChangeUserPasswordFormFields.tsx` cited by full path elsewhere in the same document).
- **Symbol sweep (grep-verified at the tip):** `UserRepository.updatePassword` + `expectedCurrentHash` (`backend/db/repo/users/user.repository.ts`); `AdminUserManagementService.setUserPassword`, `validatePasswordPolicy`, `MIN_PASSWORD_LENGTH` (`backend/services/admin/user-management.{service,helpers}.ts`); `AuthService.changeMyPassword` + `ChangeMyPasswordSubmitInput` (`backend/services/auth/auth.service.ts`, `backend/types/users/auth.types.ts`); `AdminSetUserPasswordSubmitInput` (`backend/types/admin/admin-user.types.ts`); `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts`); `PASSWORD_CHANGE_EXEMPT_ROOT_FIELDS` (exact 7 names verified verbatim), `isExemptRootField`, `extractOperationRootFieldNames`, `isPasswordChangeRequired`, `buildPasswordChangeRequiredDenial`, `createPasswordChangeGatePlugin` (`backend/graphql/passwordChangeGate.ts`) + registration line in `app/api/graphql/apollo-server.ts:46`; `allowMustChangePassword`/`shouldRedirectToChangePassword` (`frontend/lib/auth/withPageAuth.ts`); `CHANGE_PASSWORD_PAGE_PATH` single-sourced across `changePasswordRoute.ts` / page / fence / mirror / error-link map; `hasForcedPasswordResetFlag` + `router.replace` (`DashboardLayout.tsx`); `updateSessionUser` (`AuthContext.ts`/`AuthProvider.tsx`/`useChangePasswordForm.ts`); `projectServerFieldErrors`; `adminSetUserPasswordMutationDocument` / `ADMIN_USER_DETAIL_FIELDS` / `changeMyPasswordMutationDocument`; `AdminSetUserPasswordInput` / `ChangeMyPasswordInput` / both `mustChangePassword: Boolean!` Pothos fields; `ADMIN_ACTION_CENSUS` row + `USER_LIFECYCLE_LEG`; `getServerTranslations` (`shared/locale/server-graphql.ts`); the three `errors` denial keys + the `adminUsers` credential leaves in the types files; the `updated_at` `$onUpdate` re-stamp (`backend/db/schema/users/users.ts:43`); the `must_change_password` column; all 13 test-lock suite paths.
- **Test counts** cited in §5 match the recorded green runs at the tip (outcomes 3–14, R5, R10, R11).

### 3.3 15.SEC — no credentials/plaintext

The doc contains ZERO credential literals — the SQL block uses symbolic placeholders (`$hash`, `$observedHash`); a case-insensitive scan for credential-shaped strings (`TempPass|Passw0rd|password1|…`) → no matches. Password data appears only as schema/field names and error codes.

### 3.4 15.SR — docs-only

This task's entire repo delta: `docs/admin/user-management.md` (extension + 3 stale-link repairs) + this outcome file + `tasks.md` Task-15 checkbox flips + the `worklog.md` append. NO source/test/config file mutated; `AGENTS.md` / `.agents/instructions/*` byte-untouched. No `git add`/`git commit` (orchestrator owns commits).

### 3.5 15.IV — conventions

Root `AGENTS.md` read; doc structured per the repo's `docs/` conventions (verified against `docs/admin/user-management.md`'s own pre-existing skeleton and `docs/admin/account-governance.md`/`docs/auth/user-registration.md`: Why → Pattern subsections with illustrative NON-authoritative code blocks → Rules → What NOT to Do → Rollout Summary → Related Documents; the "**Gotcha (recurring):**" blockquote style mirrors `docs/auth/user-registration.md`). No plan-artifact references added (scan clean — pre-existing spec-of-record `REQ-0xx` binding and decision labels left as found, per the doc's stated `docs/specs/*` binding).

## 4. tasks.md Checkbox State

Task 15 main line + `15.QL`, `15.TE`, `15.SEC`, `15.SR`, `15.IV` all flipped `[ ]` → `[x]`. The census now shows every task checkbox in the plan checked; the only remaining `[ ]` literal is the protocol prose on line 19 (not a checkbox). **ALL PLAN TASKS (0–15) ARE COMPLETE.**

## 5. Carry-Forward / Notes for the Orchestrator

- **The 15.QL `.md` quirk is structural** — only a repo script/config change (oxlint `.md` handling) could make the sub-loop exit 0 on a markdown target; out of this task's allowed scope. Compensating gates are GREEN and recorded above.
- **Doc counts are snapshot-accurate** — the §5 test-lock pass counts mirror the last recorded green runs at the tip; a future change to any suite must update the doc in the same change (the doc now pins those contracts by reference).
- The plan directory is this task's record of truth; no history expectations for it beyond the orchestrator's commits.
