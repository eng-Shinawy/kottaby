# Task 1 Outcome — `users.must_change_password` column + `db push`

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `1. users.must_change_password column + db push (D1, REQ-009)` (Phase 1 — Schema & Data Layer)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root used:** `/home/z/my-project` (plan docs cite the author's machine `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **⚠️ ORCHESTRATOR-ATTENTION:** full-repo `bun tsgo` now reports **17 NEW errors** — all mechanical ripples of the sanctioned column addition, **all located OUTSIDE this task's single permitted source file**, reported as a CROSS-FILE DEPENDENCY in §6 with a complete fix inventory (10 files, uniform one-line fixes). Nothing else about this task is blocked.

## 1. What Was Implemented

Exactly ONE column added to the `users` pgTable in `backend/db/schema/users/users.ts`, immediately beside `passwordHash` (sibling style — no comment, mirroring the adjacent governance-column style):

```diff
     passwordHash: varchar("password_hash", { length: 255 }).notNull(),
+    mustChangePassword: boolean("must_change_password").default(false).notNull(),
     role: userRole("role").notNull(),
```

- `boolean` was **already imported** at `users.ts:1` (`import { boolean, date, integer, pgTable, timestamp, unique, varchar } from "drizzle-orm/pg-core";`) — no import change needed; enums untouched (none added).
- Applied via the repo's Drizzle schema-push convention: `bun --no-env-file run scripts/dbActions/cli-entry.ts push` from the repo root (this is the `bun run db push` path — `scripts/dbActions/cli.ts` non-interactive mode → `drizzle-kit push --force --config drizzle.config.ts`; no custom SQL, no `db migrate`, no backfill script).
- DB result: `ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false` — push output: `[✓] Pulling schema from database... [✓] Changes applied — ✓ Success` (extensions pg_trgm/is_valid_timezone ensured by the wrapper; env file `.env`, `postgresql://***@127.0.0.1:5432/app_db`).

## 2. Files Created / Modified

| File | Change |
|---|---|
| `backend/db/schema/users/users.ts` | +1 line (the column). **Only source file touched.** |
| `ai/plans/.../outcome/1-outcome.md` | This file (new). |
| `ai/plans/.../tasks.md` | Task 1 checkbox flips only (§8 of this file). |
| `worklog.md` | Appended Task 1 record. |

**Files NOT modified (and why):** every other file in the repo. The plan's auto-flow premise covers the three type aliases (verified in §4 — no manual interface edit permitted or needed). Ten additional files DO require a one-line ripple fix each (tsgo §5) but are outside this task's write scope — reported in §6 per the AGENTS.md Fix-Or-Report rule and the task's "Modify ONLY the schema file" constraint.

## 3. DB Verification (REQ-009.1, REQ-009.3)

`/tmp/pg/root/usr/lib/postgresql/17/bin/psql -U postgres -h 127.0.0.1 -p 5432 -d app_db -c "\d users"` — the new column row:

```
 must_change_password  | boolean | not null | false
```

(verbatim column row from `\d users`; sits at the end of the physical column order — drizzle-kit appends new columns; the TS definition sits beside `passwordHash`. Physical order is cosmetic and irrelevant to Drizzle.)

- **REQ-009.3 (no backfill):** server default in effect for existing rows — `SELECT count(*), count(*) FILTER (WHERE must_change_password = false) FROM users` → **4 | 4** (every existing row reads `false`). No backfill script authored.
- Drizzle runtime introspection (`getTableConfig(users)`): `must_change_password` → `PgBoolean`, `notNull: true`, `hasDefault: true` (static DDL default `false`; `defaultFn` correctly `undefined` because it is a value default, not a function default).

## 4. Auto-Flow Verification — NO manual interface edit (REQ-009.2)

Read-only verification that the flag rides the existing type plumbing:

| Type | File (plan citation → actual) | Verification |
|---|---|---|
| `UserSelectType` / `UserInsertType` | `backend/types/users/user.types.ts:3-4` | `typeof users.$inferSelect` / `$inferInsert` — the new column is part of the table object, so both infer `mustChangePassword: boolean` (required in Select; optional-with-default in Insert). Compiler-confirmed: tsgo diagnostics now REQUIRE the property on full-row select shapes (§5). |
| `RegistrationReturnType` | `backend/types/users/registration.types.ts:94-96` | `Omit<UserSelectType, "passwordHash"> & { readonly preferredRecitation }` — `Omit` removes only `passwordHash`; `mustChangePassword` carries. Compiler-confirmed (TS2322 at `backend/graphql/test/plan-catalog.*.test.ts` demands it). |
| `AdminUserSafeSelect` | `backend/types/admin/admin-user.types.ts:20` (plan cites `:18` — 2-line citation drift, same symbol) | `Omit<UserSelectType, "passwordHash">` — carries `mustChangePassword`. Compiler-confirmed (TS2741 at `admin-user.repository.ts` ×4 demands it). `AdminUserDetailReturnType extends AdminUserSafeSelect` inherits it (`admin-user.types.ts` ~192-197). |
| `AuthSession.user` | `backend/types/users/auth.types.ts:29-38` | `user: RegistrationReturnType` — the flag rides login/session payloads with zero edits (plan §3.1 claim holds). |

The plan's "no manual interface edit" claim is TRUE for every type alias; it does NOT extend to exhaustive literal row constructions and the explicit `SAFE_USER_SELECT` projection (§5/§6) — that is the one premise the plan missed, and it is mechanical.

## 5. Quality Gates

- **1.QL** `bun run scripts/health/sub-loop.ts backend/db/schema/users/users.ts --lifecycle duplicates` from repo root → **exit 0**, all five stages green (log: `/tmp/subloop-task1.txt`): tsgo ✅ ("no errors for backend/db/schema/users/users.ts") → oxlint ✅ → biome:check ✅ → lint:type-aware ✅ → check:duplicates ✅.
- **1.TE** two halves:
  - `UserSelectType` exposes `mustChangePassword: boolean` — **proven** (compiler diagnostics require the property on select-typed shapes; Drizzle infers required `boolean` from `.notNull()`; runtime introspection shows `PgBoolean`).
  - Full-repo `bun tsgo` → **NOT clean: 17 NEW `error TS`** (tool exit 1, WITH diagnostics — not the silent-exit-1 quirk). Baseline was 0 (Task 0 outcome). Every error is `TS2741`/`TS2322` "Property 'mustChangePassword' is missing" — i.e. the compiler enforcing exactly the intended contract change — inside 12 files that build full user-row literals or use the explicit safe projection. **Zero errors reference the schema file itself.** Full inventory + fixes in §6; fixes are outside this task's write scope.

## 6. CROSS-FILE DEPENDENCY (dispatch a mechanical ripple-fix wave)

```
CROSS-FILE DEPENDENCY:
  Target file: backend/db/schema/users/users.ts (Task 1)
  Blocked by: 10 files that construct full user-row literals or mirror the safe projection
  Rule violated: Task-1 write scope ("Modify ONLY backend/db/schema/users/users.ts") +
                 AGENTS.md Fix-Or-Report rule (never modify a file you were not assigned to)
  Required fix: uniform one-line additions below — makes full-repo `bun tsgo` return to 0
                before Task 14's baseline-diff gate ("zero NEW errors") is evaluated
```

**Group A — projection mirror (3 files; do these first, they clear 5 of 17):**

1. `backend/db/repo/admin/admin-user-query-helpers.ts:44-64` — `SAFE_USER_SELECT`: add `mustChangePassword: users.mustChangePassword,` (restores the documented structural mirror of `AdminUserSafeSelect`). Clears the 4 errors at `admin-user.repository.ts:379,423,507,561` (the `.returning(SAFE_USER_SELECT)` sites: `updateProfileFields`/`setDeletedOnce`/`setSuspendedOnce`/`setBlockedOnce`) and threads the column into the detail select's `...SAFE_USER_SELECT` spread at `:321`.
2. `backend/db/repo/admin/admin-user-row-types.ts:166-204` — `AdminUserDetailRow`: add `readonly mustChangePassword: boolean;` among the safe-user columns.
3. `backend/services/admin/user-management.mappers.ts:229` — `assembleDetail` return literal: add `mustChangePassword: row.mustChangePassword,`.

**Group B — full-row literal fixtures (9 files / 12 errors; add `mustChangePassword: false,` to each literal):**

4. `backend/graphql/test/admin-teachers.mutation.test.ts:519`
5. `backend/graphql/test/lesson.roles.test.ts:125`
6. `backend/graphql/test/plan-catalog.concurrency.test.ts:45,46`
7. `backend/graphql/test/plan-catalog.lane.test.ts:61,62`
8. `backend/graphql/test/plan-catalog.roles.test.ts:78`
9. `backend/graphql/test/platform-analytics.query.test.ts:327`
10. `backend/lib/auth/server-auth.test.ts:68` (literal currently spreads an insert-shaped object — `mustChangePassword?: boolean | undefined` — into a select-typed slot; add the explicit `mustChangePassword: false`)
11. `backend/services/parents/parent-link-request.helpers.test.ts:204`
12. `backend/services/parents/parent-monitoring.helpers.test.ts:73`
13. `backend/services/parents/parent-monitoring.service.test.ts:121`

Total 17 errors = 5 (Group A) + 12 (Group B), matching `bun tsgo 2>&1 | grep -c "error TS"` (full output: `/tmp/task1-tsgo-full.txt`). No `db push` re-run needed after these (code-only); re-run `bun tsgo` to confirm 0.

## 7. Subtask Pipeline Satisfaction

- **1.QL** ✅ — sub-loop `--lifecycle duplicates` on `backend/db/schema/users/users.ts` → exit 0 (§5).
- **1.TE** ✅ (with flagged caveat) — `UserSelectType` exposes `mustChangePassword: boolean` (compiler-proven); schema file clean under the sub-loop tsgo stage. Full-repo tsgo shows the 17-error ripple documented in §5/§6 — owned by the orchestrator's fix wave, not by any file this task may write.
- **1.SEC** ✅ — the column is a boolean governance flag: no password/reset/credential value enters any type string, log, or wire shape via this change; `passwordHash` handling untouched; default is server-side `false` (DDL default — no client can seed it). No secrets read (`.env` never opened; the push wrapper masked the URL itself).
- **1.SR** ✅ — exactly ONE column added (git diff = 1 line; `\d users` delta = 1 column); `boolean` already imported as a value from `drizzle-orm/pg-core`; no enum added/changed; no custom SQL, no `db migrate`, no backfill script (REQ-009.3 verified: 4/4 existing rows read `false`).
- **1.IV** ✅ — sub-loop printed the applicable rule files, all read in full before the edit: `.agents/instructions/backend.instructions.md`, root `AGENTS.md`, `backend/AGENTS.md`; additionally read `backend/db/schema/AGENTS.md` (schema-layer rules: Drizzle `pgTable` only, no raw DDL, sync via `db push`, enums exactly from `enums.ts`) and `backend/db/AGENTS.md` confirmed nonexistent. Every rule honored.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — n/a (no surface, no query); race conditions — n/a (instant `ADD COLUMN … DEFAULT false NOT NULL`, plan §9 migration-safety note confirmed); enums-as-values — n/a; cross-layer imports — none added; dead code — none; deferred items — none implicated (D1..D6 untouched).

## 8. tasks.md Checkbox State

Task 1 main line + `1.QL`, `1.TE`, `1.SEC`, `1.SR`, `1.IV` all flipped `[ ]` → `[x]` (per the orchestrator's explicit directive). No other checkbox touched. The 1.TE flip carries the §5 caveat — the orchestrator owns the §6 fix wave before Task 14.

## 9. Carry-Forward Knowledge

- **The 17-error ripple is EXPECTED and attributable.** Task 14's baseline-diff (`/tmp/baseline-*`, all zeros) will flag it as "NEW" unless the §6 fix wave lands first — dispatch that wave before Task 14 (any time after now; independent of Tasks 2-8, though `user-management.mappers.ts` is a Task-3-adjacent file, so folding fix 3 into Task 3's wave is also viable).
- **`SAFE_USER_SELECT` is an explicit allowlist, not `Omit`-derived** (`admin-user-query-helpers.ts:44-64`) — any future `users` column with `.notNull()` must be added there (and to `AdminUserDetailRow` + `assembleDetail`) or `AdminUserSafeSelect`-typed projections stop compiling. Same discipline applies to full-row literal fixtures.
- **Push mechanics:** `scripts/dbActions/cli-entry.ts <action>` runs non-interactive with `--env-file` default `.env`; wrapper ensures `pg_trgm`/`is_valid_timezone` extensions; drizzle-kit appends new columns at the END of physical column order regardless of TS definition position (cosmetic only).
- **`bun tsgo` quirk update:** the Task 0 "silent exit-1" quirk did NOT recur; this run failed loudly WITH diagnostics (the correct failure mode for a real regression). The re-run-once rule stays on the books for silent exit-1s only.
- **Citation drift noted:** plan/spec cite `AdminUserSafeSelect` at `admin-user.types.ts:18`; the symbol is at `:20` in this sandbox (2-line offset, same file/symbol). No other citation drift encountered.
- `git status` at task end: `M backend/db/schema/users/users.ts`, `M tasks.md` (Task 0+1 checkbox flips), `M Caddyfile` (pre-existing, untouched), untracked outcome files. No commits made (orchestrator owns commits).

## 10. Cross-File Dependencies (for downstream tasks)

- **Task 2** (`UserRepository.updatePassword`): writes `{ passwordHash, mustChangePassword, updatedAt }` — the column exists in `UserInsertType`/`UserSelectType`; the `tx` param and repo pattern are unaffected by this task.
- **Task 3** (`setUserPassword`): the flag's only `true`-writer; §6 fix 3 (`user-management.mappers.ts`) touches a file Task 3 also works near — coordinate.
- **Task 5/6** (Pothos `Boolean!` fields): source value `user.mustChangePassword` is already present on `RegistrationReturnType` and `AdminUserDetailReturnType` — no type work needed there beyond the SDL additions.
- **Task 11/14**: `mustChangePassword` is now a required member of every full user-row shape; journey fixtures and the final baseline-diff must account for §6.
