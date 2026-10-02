# Task 1-fix Outcome — `must_change_password` schema ripple cascade cleared

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `1-fix` (orchestrator-dispatched follow-up to Task 1 — cross-file dependency ripple fix)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project`
> **Result:** full-repo `bun tsgo` → **0 errors** (exit 0). All 17 NEW errors from the Task 1 column addition cleared with 13 files × one-line mechanical additions. No runtime behavior changed; no commits made.

## 1. Scope Followed

Exactly the fix inventory from `1-outcome.md` §6 (Groups A + B), verified against the live `bun tsgo` output before editing (17 errors, all `TS2741`/`TS2322` "Property 'mustChangePassword' is missing"). Every fix is a one-line property addition; the property mirrors the schema column order (sits immediately before `role`, as in `backend/db/schema/users/users.ts:19`). `false` used in every fixture — the DB default and the semantically neutral value; no fixture in the touched files exercises a password-change flow.

## 2. Files Changed (13)

**Group A — projection mirror (clears 5 errors: 4 × `admin-user.repository.ts` `.returning(SAFE_USER_SELECT)` sites + `assembleDetail`):**

| File | Exact change |
|---|---|
| `backend/db/repo/admin/admin-user-query-helpers.ts` | `SAFE_USER_SELECT`: added `mustChangePassword: users.mustChangePassword,` (between `phone` and `role`, mirroring table order). Restores the structural mirror of `AdminUserSafeSelect` (`Omit<UserSelectType, "passwordHash">`); the 4 `.returning(SAFE_USER_SELECT)` sites in `admin-user.repository.ts` and the detail select's `...SAFE_USER_SELECT` spread recover automatically. |
| `backend/db/repo/admin/admin-user-row-types.ts` | `AdminUserDetailRow`: added `readonly mustChangePassword: boolean;` (interface is manually declared, so the property does not auto-flow; needed for `assembleDetail` to read it). |
| `backend/services/admin/user-management.mappers.ts` | `assembleDetail` (~line 229): added `mustChangePassword: row.mustChangePassword,` to the returned `AdminUserDetailReturnType` literal. |

**Group B — full-row literal fixtures (clears 12 errors; `mustChangePassword: false,` added immediately before `role` in each literal, mirroring schema order):**

| File | Fixture touched |
|---|---|
| `backend/graphql/test/admin-teachers.mutation.test.ts` | `mockInProcessUser` return literal (~line 519) |
| `backend/graphql/test/lesson.roles.test.ts` | `mockUser` return literal (~line 125) |
| `backend/graphql/test/plan-catalog.concurrency.test.ts` | `buildAdminContext` `adminUser` literal (errors at lines 45–46 were the `user:`/`safeUser:` slots) |
| `backend/graphql/test/plan-catalog.lane.test.ts` | `buildAdminContext` `adminUser` literal (same pattern, lines 61–62) |
| `backend/graphql/test/plan-catalog.roles.test.ts` | `mockUser` return literal (~line 78) |
| `backend/graphql/test/platform-analytics.query.test.ts` | `contextOnlyUser` return literal (~line 327) |
| `backend/lib/auth/server-auth.test.ts` | `mockUserRow` base literal (~line 68): added the explicit `mustChangePassword: false,` BEFORE the `...overrides` (`Partial<UserSelectType>`) spread — the optional spread member was typing the property `boolean | undefined` into the select-typed slot (TS2322); the explicit required member resolves it while overrides remain possible |
| `backend/services/parents/parent-link-request.helpers.test.ts` | `requireActor` describe-block `baseUser` literal (~line 204) |
| `backend/services/parents/parent-monitoring.helpers.test.ts` | `baseUser` fixture (~line 73) |
| `backend/services/parents/parent-monitoring.service.test.ts` | `parentUser` fixture (~line 121); `childUser` inherits via spread |

Not touched: `admin-user.repository.ts` (its 4 errors were pure consumers of the `SAFE_USER_SELECT` shape — fixed at the source), `backend/db/schema/users/users.ts` (Task 1's file), and everything else.

## 3. Verification

- **Full-repo `bun tsgo`:** before = 17 errors → after = **0 errors, exit 0** (run twice: post-edit and via sub-loop stages).
- **Per-file quality loop** — `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates) on ALL 13 modified files:

| File | Exit |
|---|---|
| `backend/db/repo/admin/admin-user-query-helpers.ts` | 0 |
| `backend/db/repo/admin/admin-user-row-types.ts` | 0 |
| `backend/services/admin/user-management.mappers.ts` | 0 |
| `backend/graphql/test/admin-teachers.mutation.test.ts` | 0 |
| `backend/graphql/test/lesson.roles.test.ts` | 0 |
| `backend/graphql/test/plan-catalog.concurrency.test.ts` | 0 |
| `backend/graphql/test/plan-catalog.lane.test.ts` | 0 |
| `backend/graphql/test/plan-catalog.roles.test.ts` | 0 |
| `backend/graphql/test/platform-analytics.query.test.ts` | 0 |
| `backend/lib/auth/server-auth.test.ts` | 0 |
| `backend/services/parents/parent-link-request.helpers.test.ts` | 0 |
| `backend/services/parents/parent-monitoring.helpers.test.ts` | 0 |
| `backend/services/parents/parent-monitoring.service.test.ts` | 0 |

All five stages green per file (logs under `/tmp/subloop-<basename>.log`).

## 4. Rules Honored

- Type-coverage/mechanical fixes only — no runtime behavior change (fixtures gain a property that equals the DB default; the repo/mapper changes make the allowlist cover the full row again).
- Clean comments only — no plan-artifact references added; no comments added at all (self-evident one-line property).
- No `git add`/`git commit`; `git status` shows only the 13 files above newly modified by this task (pre-existing: `Caddyfile`, `tasks.md`, `schema/users/users.ts`, prior outcome files — untouched).
- Instruction files read before editing: root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`.

## 5. Carry-Forward Knowledge

- The `AdminUserSafeSelect` allowlist discipline (`1-outcome.md` §9) now holds again end-to-end: `SAFE_USER_SELECT` ↔ `AdminUserSafeSelect` ↔ `AdminUserDetailRow` ↔ `assembleDetail` all carry `mustChangePassword`. Any future `users` `.notNull()` column must repeat this four-point ripple (plus fixture literals).
- Task 14's baseline-diff is unblocked: `bun tsgo` is back to 0 NEW errors.
- Tasks 2/3 can now write `{ passwordHash, mustChangePassword, updatedAt }` and read `row.mustChangePassword` in the admin detail path without further type work.
