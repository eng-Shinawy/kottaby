# Task 4-fix Outcome — `UserRepository` raw-SQL column lists gain `must_change_password`

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `4-fix` — blocking cross-file dependency fix (orchestrator-dispatched follow-up to Task 4, closing §7 of `4-outcome.md`)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project`
> **Result:** `must_change_password AS "mustChangePassword",` added to BOTH non-transactional raw-SQL SELECT lists (`findByEmail` + `findById`); `bun tsgo` **0 errors / exit 0**, `user.repository.test.ts` **14 pass / 0 fail / 39 expect()**, sub-loop `--lifecycle duplicates` **exit 0** on the single touched file. No commits made.

## 1. What Changed

**File modified: `backend/db/repo/users/user.repository.ts` — ONLY.**

The production (no-`tx`) branch of both reader functions casts raw rows to `UserSelectType` via `queryDb` (Neon-HTTP fast path). Their explicit column lists omitted the Task-1 column `must_change_password` (schema `users.ts:19` — `boolean("must_change_password").default(false).notNull()`), so production rows read `mustChangePassword === undefined`:

- **`findByEmail` (raw-SQL branch, ~:51-53)** — `AuthService.login` feeds this into `AuthSession.user`; the flag was missing on the wire.
- **`findById` (raw-SQL branch, ~:84-86)** — `gqlContextFactory` (~:259) feeds this into `ctx.user`; Task 7's forced-reset gate would have read `undefined` and NEVER denied, and Tasks 5/6 `mustChangePassword` `Boolean!` fields would have seen undefined.

Exact insert in BOTH lists (alias style matches the neighboring `snake_case AS "camelCase",` entries; schema column order preserved — directly after `password_hash`, before `role`):

```sql
SELECT id, full_name AS "fullName", email, phone, password_hash AS "passwordHash",
       must_change_password AS "mustChangePassword",
       role, date_of_birth AS "dateOfBirth", gender, country, locale,
```

The transactional (`isDBTransaction`) branches of both functions already select the full Drizzle row and needed no change. No other code, comment, or behavior was touched.

## 2. Sweep for other raw-SQL user-row readers (per task step 1)

Grep of the file for `AS "passwordHash"` (the alias unique to full-user-row lists) matched **exactly 2 sites** — the two fixed above. The file's remaining raw-SQL reads are narrow projections, NOT `UserSelectType`-shaped, and correctly stay untouched:

- `findLocalesByIds` — `"SELECT id, locale FROM users WHERE id = ANY($1)"` (typed `{ id: number; locale: AppLocale | null }`)
- `findNamesByIds` — `'SELECT id, full_name AS "fullName" FROM users WHERE id = ANY($1)'` (typed `{ id: number; fullName: string }`)

## 3. Test-assertion check (per task step 2)

Grepped `backend/db/test` for `findById`/`findByEmail` column-list assertions: **no test pins the exact SELECT list** — `backend/db/test/logic/users/user.repository.test.ts`'s raw-SQL branch tests assert only `locale` presence (the "D2 trap guard" describe) and the tx-branch tests already pin `mustChangePassword` via the Drizzle `updatePassword`/`findById(tx)` paths. Per the task rule ("otherwise add nothing"), **zero test edits made**.

## 4. Verification Results

| Check | Command | Result |
|---|---|---|
| Type check | `bun tsgo` (full repo) | **0 "error TS" lines, exit 0** — zero NEW errors vs the Task-0 baseline |
| Repo test suite | `bun run test/scripts/run-test.ts backend/db/test/logic/users/user.repository.test.ts` | **14 pass / 0 fail / 39 expect() calls, exit 0** (all tiers incl. the raw-SQL committed-fixture branch) |
| Quality loop | `bun run scripts/health/sub-loop.ts backend/db/repo/users/user.repository.ts --lifecycle duplicates` | **exit 0** — tsgo ✅, oxlint ✅, biome:check ✅, lint:type-aware ✅, check:duplicates ✅ |

(No test file was touched, so only the single sub-loop run was required.)

## 5. Impact

Production no-tx reads now return `mustChangePassword: boolean` (never `undefined`), unblocking:
- `gqlContextFactory` → `ctx.user.mustChangePassword` → Task 7's forced-reset gate can actually deny;
- login → `AuthSession.user.mustChangePassword` present on the wire;
- Tasks 5/6 `mustChangePassword` GraphQL `Boolean!` fields resolve to a real boolean.

## 6. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/db/repo/users/user.repository.ts` | +1 line inside each of the 2 raw-SQL SELECT lists (`findByEmail`, `findById`). Nothing else. |
| `ai/plans/…/outcome/4-fix-outcome.md` | This file (new). |
| `worklog.md` | Appended Task ID `4-fix` record. |

**NOT modified:** schema (`must_change_password` already added by Task 1), `backend/db/test/**` (no column-list pin exists), GraphQL/services (consume the repo as-is), `git` (no add/commit per rules).

## 7. Carry-Forward

- `UserSelectType` rows from BOTH repo read paths (tx and no-tx) now carry `mustChangePassword` uniformly — Tasks 5/6/7 can rely on it on every path.
- Standing trap (now twice-encountered: `locale` D2, `must_change_password`): any new column on `users` MUST be added to BOTH raw-SQL lists in `user.repository.ts` (`findByEmail` + `findById`) or production no-tx reads silently yield `undefined` while type-checking. Consider a parity trap-guard test (pin a raw-branch read of `mustChangePassword` the way the `locale` guard does) in a future test-scoped task.
