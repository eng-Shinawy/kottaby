# Task 2 Outcome — `UserRepository.updatePassword` + repo test

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `2. UserRepository.updatePassword + repo test (D3, REQ-003, REQ-009)` (Phase 1 — Schema & Data Layer)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** method added inside the existing `UserRepository` namespace, 3 new repo tests, suite 14/14 green, sub-loop exit 0 on both touched files, full-repo `bun tsgo` 0 errors. No commits made.

## 1. What Was Implemented

### 1.1 Repository write (`backend/db/repo/users/user.repository.ts`)

Added `updatePassword` **inside the existing `export namespace UserRepository`**, immediately beside (after) `updateLocale` — the file's canonical export style is a namespace of individually exported functions, so the method was added the same way (NOT as a standalone export, NOT via a new object). Signature mirrors `updateLocale` exactly:

```typescript
export async function updatePassword(
  userId: number,
  passwordHash: string,
  mustChangePassword: boolean,
  tx: DBTransaction
): Promise<UserSelectType | null> {
  const [row] = await tx
    .update(users)
    .set({ passwordHash, mustChangePassword })
    .where(eq(users.id, userId))
    .returning();
  return row ?? null;
}
```

- **`tx` is REQUIRED** (4th positional param, no default, no `db` fallback) — the single user-write-home discipline; callers hash the plaintext BEFORE calling (same docblock contract as `create`).
- **No manual `updatedAt`**: `updated_at` re-stamps via the column's `$onUpdate(() => new Date())` hook (`backend/db/schema/users/users.ts:40-43`), exactly like `updateLocale`.
- **No import changes**: `users`, `eq`, `DBTransaction`, `UserSelectType` were all already imported from `@/backend/types` / the schema module; no local type definitions added.
- **JSDoc** describes the domain contract only (caller pre-hashes; returned row is the FULL row including `passwordHash` which service layers must strip — never reaches GraphQL; `null` on zero rows matched) with zero plan-artifact references.
- **`AdminUserRepository` NOT extended**; no second password-write path exists.

### 1.2 Repo tests (`backend/db/test/logic/users/user.repository.test.ts`, extended)

New describe block `UserRepository.updatePassword — transactional write branch` (3 tests) inserted between the `updateLocale` and `findLocalesByIds` blocks, plus two file-scope helpers and a header coverage-map line:

| Test | Asserts |
|---|---|
| `persists the new hash + flag and returns the full updated row` | fixture via `createTestUser(tx)` → `updatePassword(user.id, ROTATED_HASH, true, tx)` returns the row with the new hash + `mustChangePassword: true` + same id; row is the FULL DB row (`passwordHash` present and ≠ the fixture default — the repo/service contract pin, mirroring the `updateLocale` precedent); sibling `findById(user.id, tx)` re-read sees the new hash + flag (create → update → re-read verifies) |
| `persists the flag in both directions and is idempotent on re-write` | first call `true`, **second call flips it to `false`**, third call re-writes `false` idempotently (same row id, no drift); re-read confirms `false` persisted |
| `returns null for an id that matches no user` | absent id (above the identity max) → `null` — the miss-signal branch |

Conventions honored: `runInRollback` wraps every test body; `tx` passed to EVERY repo call and direct Drizzle query; fixtures ONLY via `createTestUser(tx)`; a new `absentUserIdOf(tx)` helper (extracted per the "aggressively extract helpers" rule; `max(users.id)` already imported); NO `expect(...).rejects` anywhere; `bun:test` imports; new rotated hash stub constant `TEST_BCRYPT_STUB_HASH_ROTATED` (distinct from the fixture default so the credential write is observable; still a placeholder, never verified). Both `??` branches of `updatePassword` are exercised → 100% branch coverage of the new method.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/db/repo/users/user.repository.ts` | +1 method (+ its JSDoc) inside the `UserRepository` namespace. **Only source file touched.** |
| `backend/db/test/logic/users/user.repository.test.ts` | +3 tests, +2 helpers (`absentUserIdOf`, rotated hash constant), +header coverage-map line. |
| `ai/plans/.../outcome/2-outcome.md` | This file (new). |
| `ai/plans/.../tasks.md` | Task 2 main line + `2.QL/2.TE/2.SEC/2.SR/2.IV` flipped only. |
| `worklog.md` | Appended Task 2 record. |

**Files NOT modified (and why):** `AdminUserRepository`/`admin-user.repository.ts` (explicitly out of scope — no extension), `backend/db/repo/index.ts` barrels (the namespace already re-exports; no new file), `backend/types/**` (no new types — `UserSelectType`/`DBTransaction` reused), `entity-setup.ts`/`test-utils.ts` (helpers reused as-is), schema file (Task 1's). Test-DB push was an environment operation, not a file change (§3).

## 3. Test-DB schema push (environment prerequisite, no file change)

First test run failed with `42703: column "must_change_password" of relation "users" does not exist` — Task 1's `db push` targeted only the dev DB (`app_db` via `.env`); the test DB (`kottaby_test` via `.env.test`) did not yet have the column. Applied the same Drizzle schema-push convention against the test env (no custom SQL):

```
bun --no-env-file run scripts/dbActions/cli-entry.ts push --env-file .env.test
# → [✓] Changes applied — ✓ Success
```

Carry-forward: **every future `users` schema delta in this plan must be pushed to BOTH `.env` and `.env.test`** (or journeys/service tests will hit the same 42703).

## 4. Verification Results

- **2.QL** `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates):
  - `backend/db/repo/users/user.repository.ts` → **exit 0**, all stages green (log `/tmp/subloop-task2-repo.log`).
  - `backend/db/test/logic/users/user.repository.test.ts` → **exit 0**, all stages green (duplicates stage auto-skips: test file outside jscpd scan scope; log `/tmp/subloop-task2-test.log`).
- **2.TE** `bun run test/scripts/run-test.ts backend/db/test/logic/users/user.repository.test.ts` (from repo root, NEVER raw `bun test`) → **14 pass / 0 fail / 39 expect() calls** (11 pre-existing + 3 new, all green). Branch coverage of `updatePassword`: both branches (`row` returned / `null` on zero rows) exercised by the new tests — a coverage-table run shows the method's lines absent from the uncovered-range list (remaining gaps — `create`, `findNamesByIds`, `findByEmail`'s tx branch — are pre-existing, outside this task's method).
- **Full-repo `bun tsgo`** → **0 `error TS`, tool exit 0** (post Task-1-fix parity maintained; output `/tmp/task2-tsgo-full.txt`).
- No `console.*` added; no `expect().rejects` inside `runInRollback`; no raw `bun test` for the recorded run (a one-off coverage measurement used the runner-guard's own documented `KOTTABY_TEST_RUNNER_OK=1` debug bypass with `--env-file=.env.test`, read-only).

## 5. Subtask Pipeline

- **2.QL** ✅ sub-loop exit 0 on repo + test file (§4).
- **2.TE** ✅ suite green incl. create → update → re-read verification; both `updatePassword` branches covered (§4).
- **2.SEC** ✅ the FULL row (hash included) is returned only to the service layer — the repo layer has no GraphQL surface; the test pins the full-row contract and the service-layer-strip obligation is documented in the JSDoc; no hash in any log (no logging added at all; no `console.*`).
- **2.SR** ✅ `tx` mandatory 4th param (no `db` fallback, no second user-write path; `AdminUserRepository` untouched); zero local type defs — `UserSelectType`/`DBTransaction` imported from `@/backend/types` like every sibling method.
- **2.IV** ✅ rule files read in full BEFORE editing: `backend/db/repo/AGENTS.md` (namespace-per-repo, types-from-backend/types, guarded single-statement UPDATE+RETURNING), `backend/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`, plus `backend/db/test/AGENTS.md` + `backend/db/test/logic/AGENTS.md` (sub-loop-printed for the test file).
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — write is id-scoped by PK; actor/target authorization is the service layer's job (Task 3/4), no permission logic belongs here. Race conditions — single guarded UPDATE…WHERE id…RETURNING; last-write-wins per row, same semantics as `updateLocale`. Enums-as-values — no enum touched. Cross-layer imports — none added. Dead code — none. Deferred items — none implicated (D1..D6 untouched).

## 6. Carry-Forward Knowledge (exact call signature for Tasks 3/4)

```typescript
// Task 3 (AdminUserManagementService.setUserPassword) and Task 4 (AuthService.changeMyPassword):
const row = await UserRepository.updatePassword(id, hashedPassword, mustChangePassword, tx);
// row: UserSelectType | null — null ⇒ user not found ⇒ service maps to NotFoundError("USER", …)
// row.passwordHash is present — STRIP before returning (RegistrationReturnType / AdminUserSafeSelect).
// Call inside withTransaction; hash via hashPassword(plaintext) BEFORE the tx.
```

- **Namespace access:** `UserRepository.updatePassword(...)` — consumers import `UserRepository` from `@/backend/db/repo` (barrel); deep import of `user.repository.ts` also valid. There is NO top-level named export `updatePassword`.
- **Flag semantics are caller-owned:** the repo persists `mustChangePassword` exactly as given — Task 3 passes the admin's choice (true/false), Task 4 always passes `false` (the only flag-clearing path). The repo does not enforce any policy.
- **Test-DB parity rule** (§3): push schema deltas to `.env` AND `.env.test`.
- **Test scaffolding reusable for later repo-side tests:** `absentUserIdOf(tx)` helper now exists in `user.repository.test.ts` for not-found write-path probes.
- Shared-worktree note: `git status` also shows uncommitted changes from Tasks 0/1/1-fix (schema, admin-query-helpers, fixtures, tasks.md Task 0/1 flips) and parallel Task 8 i18n files — none touched by this task; `git diff` for this task's own files is exactly `user.repository.ts` (+31) and `user.repository.test.ts` (+67/-1 header rewrite).

## 7. Cross-File Dependencies (for downstream tasks)

- **Task 3** calls this method inside `withTransaction`, then `AuditService.createAuditLog(...)` in the SAME tx; `null` return → `NotFoundError("USER", tErrors.adminUsers.userNotFound)`.
- **Task 4** calls it with `mustChangePassword = false` after `comparePassword` verification; returns the password-stripped updated user.
- **Task 5/6 wire tests** must NOT see `passwordHash` anywhere in GraphQL output — the repo deliberately returns the full row; stripping stays the service/type-layer obligation.
- **Task 14 baseline-diff:** tsgo remains 0 NEW errors from this task (verified).
