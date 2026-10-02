# Task 4 Outcome — `AuthService.changeMyPassword` + `ChangeMyPasswordSubmitInput` + service test

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `4. AuthService.changeMyPassword + service test (D5, REQ-006)` (Phase 2 — Backend Services)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** closed input type + service method + 8 new service tests; auth service suite **14 pass / 0 fail / 54 expect()** (6 pre-existing + 8 new), sub-loop exit 0 on all 3 touched files, full-repo `bun tsgo` **0 errors / exit 0**. No commits made.
> **⚠️ ORCHESTRATOR-ATTENTION:** one cross-file dependency found and REPORTED (not fixed — outside this task's write scope): `UserRepository.findById`/`findByEmail`'s non-transactional raw-SQL column list omits `must_change_password`, so production `ctx.user.mustChangePassword` is `undefined` — see §7.

## 1. What Was Implemented

### 1.1 Signature choice (documented per the task brief)

The plan's task text phrases the method as `(userId, currentPassword, newPassword, locale, outerTx?)`. **Implemented as the closed input-object form instead:**

```typescript
export async function changeMyPassword(
  userId: number,
  input: ChangeMyPasswordSubmitInput,
  locale: string,
  outerTx?: DBTransaction
): Promise<RegistrationReturnType>
```

Both shapes were declared acceptable; the input-object form was chosen because (a) the task brief recommends it as the cleaner BOPLA property-mapped shape, (b) it matches the established sibling convention (`AdminUserManagementService.setUserPassword(id, input: AdminSetUserPasswordSubmitInput, actorId, locale, outerTx?)` from Task 3), and (c) future members (e.g. a confirm-password field owned by the form layer) extend the type without signature churn. The plan's D5 sequence is unchanged — only the two plaintexts travel inside one closed object.

### 1.2 Type — `ChangeMyPasswordSubmitInput` (`backend/types/users/auth.types.ts`)

Added immediately BEFORE `AuthSession` (the plan's sanctioned sibling slot, `~:29-38`), re-exported through the existing `backend/types/users/index.ts` + `@/backend/types` barrels with zero barrel edits:

```typescript
export interface ChangeMyPasswordSubmitInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}
```

JSDoc documents the closed two-key discipline and that both members are PLAINTEXT: they exist only for the duration of the service call, are hashed before persistence, and are never stored, logged, audited, or returned.

### 1.3 Service method — `changeMyPassword` (`backend/services/auth/auth.service.ts`)

Added inside `export namespace AuthService` immediately after `updateMyLocale`; the file-header docblock gained a `changeMyPassword` bullet (same convention as Task 3's header update). Exact ordered sequence (D5):

1. `const t = getServerTranslations(locale)` — both `errorsTranslations` and `authTranslations` slices resolved once.
2. **Identity load:** `UserRepository.findById(userId, outerTx)` — the caller's transaction handle is threaded into the pre-tx read (production passes `undefined` → the bare-read `queryDb` path; the composed-write/test path shares the caller's snapshot). **This is the established seam** — `assertActorAdminActive` (`backend/services/admin/admin-gate.helpers.ts:137`) threads `outerTx` into its actor read the same way. First test run proved this is load-bearing, not cosmetic: without the thread, the no-tx read cannot see the `runInRollback` fixture row (see §3.1).
3. **Single denial shape:** `!user || !(await comparePassword(input.currentPassword, user.passwordHash))` → ONE `logger.logDomainError` (`code: "CURRENT_PASSWORD_INVALID"`, `entity: "users"`, `entityId: userId`, `locale` — ids + codes only) → `throw new ValidationError("CURRENT_PASSWORD_INVALID", tErrors.currentPasswordInvalid, undefined, [{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message: tErrors.currentPasswordInvalid }])`. The identity-missing case and the wrong-password case are INDISTINGUISHABLE (no existence oracle); both perform zero writes. (Constant-time bcrypt compare via the shared `comparePassword` seam — REQ Security.3.)
4. **No-op guard:** `input.newPassword === input.currentPassword` → `ValidationError("NEW_PASSWORD_SAME_AS_CURRENT", tErrors.newPasswordSameAsCurrent, undefined, [{ field: "newPassword", code: "NEW_PASSWORD_SAME_AS_CURRENT", message }])` — rejected BEFORE hashing.
5. **Shared policy:** `validatePasswordPolicy(input.newPassword, t.authTranslations)` (Task 3's pure helper, imported from `@/backend/services/admin/user-management.helpers` — same layer, sanctioned by Task 3's outcome §6) → non-empty → `throw new ValidationError(entries[0].message, entries)` — the `validateCreateInput` message contract; helper entries (`field: "password"`, `PASSWORD_REQUIRED` / `PASSWORD_TOO_SHORT` + localized `auth` copy) flow through verbatim.
6. **Hash before the tx:** `const passwordHash = await hashPassword(input.newPassword)` — bcrypt cost stays outside the transaction; plaintext never enters it.
7. **One write:** `withTransaction(outerTx, tx => UserRepository.updatePassword(userId, passwordHash, false, tx))` — the ONLY flag-clearing path (`mustChangePassword: false`); the single password-write home from Task 2; no second write path exists.
8. `null` return (verified caller vanished between read and write — near-unreachable race) → `UnauthorizedError(tErrors.unauthorized)` (the `updateMyLocale` vanished-caller precedent; zero rows touched, no existence oracle).
9. `return stripPasswordHash(updated)` — the file's existing `RegistrationReturnType` projection (`Omit<UserSelectType, "passwordHash">` + `preferredRecitation: null`); the returned row carries `mustChangePassword: false` from the repo's `RETURNING` clause.

New imports: `hashPassword` (added to the existing `@/backend/lib/auth/password` import), `validatePasswordPolicy`, type `ChangeMyPasswordSubmitInput`. `ValidationError`/`logger`/`getServerTranslations` were already imported. No `console.*`; no plan-artifact references in code/JSDoc; denials logged via `logger.logDomainError` only.

**Constructor-form note (repo discovery):** the custom-code + fields payload MUST use the 4-arg overload `new ValidationError(code, message, undefined, fields)` — the 3-arg call `(code, message, fields)` type-fails (TS2559: the 3-arg slot is typed `GraphQLErrorOptions`), and `ApiFieldErrorType` REQUIRES `message`, so each field entry carries the localized copy alongside `field`/`code` (same shape as `registration.service.ts:233` and `user-governance.helpers.ts:254`).

### 1.4 Service tests (`backend/db/test/logic/auth/auth.service.test.ts`, +8 tests)

New describe blocks `AuthService.changeMyPassword — happy path` (1 test) + `AuthService.changeMyPassword — denials` (7 tests) appended after the `updateMyLocale` blocks; header docblock retitled + Tier-5 coverage-map rows added. New module-scope helpers (extracted per the aggressive-extraction rule): `silenceDomainLog()` (Task 3 precedent), `asValidationError()` (no-unsafe-assertion instanceof guard), `absentUserIdOf(tx)`, and `createCredentialedUser(tx, mustChangePassword = true)` — the fixture seeds a REAL bcrypt hash of `FIXTURE_CURRENT_PASSWORD` via `hashPassword` (the entity-setup stub hash cannot satisfy a bcrypt compare) plus `mustChangePassword: true`, so the current-password verification is exercised against a genuine hash and the flag clearing is observable in both directions.

| Test | Asserts |
|---|---|
| happy path | correct current authorizes (constant-time `comparePassword` seam); return pins `mustChangePassword: false`, `Object.hasOwn(result, "passwordHash") === false`, `preferredRecitation` null; DB re-read on the SAME tx: flag `false`, new hash verifies via `comparePassword(FIXTURE_NEW_PASSWORD, stored)` `=== true`, old credential `=== false` |
| wrong current | `ValidationError` + message contains `tErrors.currentPasswordInvalid`; `fields = [{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", … }]`; **ZERO writes** — stored hash byte-identical to the seeded hash, flag still `true` |
| vanished identity (absent id) | the SAME `CURRENT_PASSWORD_INVALID` shape as wrong-current (message + fields) — no existence oracle |
| new === current | `NEW_PASSWORD_SAME_AS_CURRENT` + fields `[{ field: "newPassword", … }]`; zero writes (flag still `true`, stored hash still verifies the current plaintext) |
| empty new | `PASSWORD_REQUIRED` + `tAuth.passwordRequired` + fields `[{ field: "password", … }]` |
| whitespace-only new | `PASSWORD_REQUIRED` (shared-policy trim branch through the service) |
| 7-char new | `PASSWORD_TOO_SHORT` + `tAuth.passwordTooShort` + fields `[{ field: "password", … }]`; `comparePassword("Passw0r", stored)` `=== false` (no hash of the rejected plaintext ever landed) |
| wrong current, `ar` locale | ARABIC `currentPasswordInvalid` copy (localized-rejection tier) |

Conventions honored: `runInRollback` + `tx` threaded to every service call (outerTx param); `expectRepoError` (no `expect().rejects`); translated-message assertions via `getServerTranslations` property access; `bun:test` imports only; no seed-data queries; `silenceDomainLog()` on denial paths; `DBTransaction` typed from the test-utils re-export; no `any`.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/types/users/auth.types.ts` | +`ChangeMyPasswordSubmitInput` (+JSDoc) before `AuthSession`. Barrel re-exports unchanged (`export *` auto-flows). |
| `backend/services/auth/auth.service.ts` | +`hashPassword`/`validatePasswordPolicy`/type imports; header docblock bullet; +`changeMyPassword` (+JSDoc) after `updateMyLocale`. |
| `backend/db/test/logic/auth/auth.service.test.ts` | Header retitle + Tier-5 map; +4 imports; +2 plaintext constants; +4 module-scope helpers; +2 describe blocks / +8 tests. |
| `ai/plans/…/outcome/4-outcome.md` | This file (new). |
| `ai/plans/…/tasks.md` | Task 4 main line + `4.QL/4.TE/4.SEC/4.SR/4.IV` flipped only. |
| `worklog.md` | Appended Task 4 record. |

**Files NOT modified (and why):** `backend/db/repo/users/user.repository.ts` (Task 2's `updatePassword` consumed as-is; `findById`'s tx param already existed), `backend/services/admin/user-management.helpers.ts` (Task 3's `validatePasswordPolicy` consumed verbatim), `backend/graphql/**` (Task 5/6), `shared/locale/**` (Task 8 shipped every key consumed: `errorsTranslations.currentPasswordInvalid` / `.newPasswordSameAsCurrent`, `authTranslations.passwordRequired` / `.passwordTooShort`), `backend/lib/errors.ts` (constructor overloads used as-is), no service `.types.ts` created, no barrels edited.

## 3. Verification Results

### 3.1 4.TE — service suite

- `bun run test/scripts/run-test.ts backend/db/test/logic/auth/auth.service.test.ts` → **14 pass / 0 fail / 54 expect() calls** (6 pre-existing `updateMyLocale` + 8 new `changeMyPassword`), run twice (after the tx-threading fix and after the final constructor-form fix) — green both times.
- **Mid-run correction (honest note):** the FIRST run failed 5/8 new tests — `UserRepository.findById(userId)` was called without the outer transaction, so the bare-read `queryDb` path could not see the `runInRollback` fixture row and every verification-dependent test hit the denial branch. Fixed by threading `outerTx` into the identity read (the `assertActorAdminActive:137` precedent). Production semantics unchanged (no `outerTx` in production = the same bare-read path as before).
- **Constant-time compare (REQ Security.3):** asserted through the `comparePassword` seam — the correct current authorizes, a wrong current is denied, the old credential fails against the new stored hash, and no rejected plaintext ever lands in the column. No raw hash-string equality is ever used as an authorization predicate anywhere.

### 3.2 4.QL — sub-loop `--lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → check:duplicates)

| File | Exit | Log |
|---|---|---|
| `backend/services/auth/auth.service.ts` | **0** (after 2 fixes: 3-arg ValidationError → TS2559 → 4-arg form; missing `message` → TS2741 → localized copy added) | `/tmp/subloop-t4-service.log` |
| `backend/types/users/auth.types.ts` | **0** | `/tmp/subloop-t4-types.log` |
| `backend/db/test/logic/auth/auth.service.test.ts` | **0** (after 1 fix: split value/type imports from `test-utils` → `import-x/no-duplicates` → merged) | `/tmp/subloop-t4-test.log` |

### 3.3 Type check

- Full-repo `bun tsgo` → **0 "error TS" lines, tool exit 0** (`/tmp/task4-tsgo-full.txt`) — zero NEW errors vs the Task 0 baseline.

## 4. Subtask Pipeline

- **4.QL** ✅ — §3.2: 3/3 files exit 0.
- **4.TE** ✅ — §3.1: suite green via run-test (14/0/54); constant-time compare asserted through `comparePassword` (correct-current authorizes / wrong-current denied / old credential fails against the new hash).
- **4.SEC** ✅ — single denial shape after identity is established: `!user ||` and `!comparePassword(...)` collapse into ONE `CURRENT_PASSWORD_INVALID` `ValidationError` with identical `extensions.fields` (no wrong-vs-missing oracle; vanished-row write race maps to the oracle-free `unauthorized` precedent); no hash/plaintext in any response shape (`stripPasswordHash` projection, `Object.hasOwn` pinned), in any log (`logDomainError` carries ids + codes only), or in any audit row (this service writes ZERO audit rows — self-service is unaudited per the plan's side-effect matrix); no `console.*`; hash computed BEFORE the tx.
- **4.SR** ✅ — reuses `hashPassword`/`comparePassword` verbatim (12-round bcrypt; no rehash policy change, no new hashing primitive); tx threaded (`outerTx` into the identity read + `withTransaction` SAVEPOINT/top-level branch); enums untouched (no enum members involved — codes are transport strings, never persisted values); NO service `.types.ts` (type lives in `backend/types/users/auth.types.ts`, auto-flows through `@/backend/types`); single password-write home (`UserRepository.updatePassword` only); errors exclusively from `@/backend/lib/errors`.
- **4.IV** ✅ — read in full BEFORE editing: `backend/services/AGENTS.md`, `backend/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`; sub-loop re-printed tests+backend instructions for the test file and services rules for the service. Types from `@/backend/types`; `getServerTranslations(locale)` single-arg bundle access (no two-arg namespace form, no `Translation.` enum); locale threaded; no `oxlint-disable`.
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — the identity argument is the caller's own `userId` (Task 6's resolver passes `ctx.user.id`); no cross-actor surface; no existence oracle. Race conditions — identity read → verify → write has a TOCTOU window only for row deletion (maps to the zero-write `UnauthorizedError` branch); the write itself is one guarded `UPDATE…WHERE id…RETURNING` (last-writer-wins, same semantics as `updateLocale`/Task 3); concurrent self-changes serialize on the row lock. Enums-as-values — n/a (none touched). Cross-layer imports — one sanctioned same-layer helper import (`validatePasswordPolicy` from admin helpers, blessed by Task 3's outcome §6; no layer-rule violation found: services→services-helpers is the established seam, e.g. `isValidEmail` from `@/backend/services/shared` in the same helper family). Dead code — none. Deferred items — none implicated (D1..D6 untouched).

## 5. Carry-Forward Knowledge (exact call signature for Task 6's resolver)

```typescript
// Task 6 (backend/graphql/mutation/user.mutation.ts, beside updateMyLocale, scope { authenticated: true }):
const user = await AuthService.changeMyPassword(ctx.user.id, input, ctx.locale);
// input: ChangeMyPasswordSubmitInput { readonly currentPassword: string; readonly newPassword: string }
// returns RegistrationReturnType (password-stripped, mustChangePassword: false) → the GraphQL User payload.
// outerTx: omit — the resolver has no outer transaction (production path).
```

- Denial surface for the UI (Task 10): `extensions.code` = `CURRENT_PASSWORD_INVALID` / `NEW_PASSWORD_SAME_AS_CURRENT` (custom DomainError codes — sanctioned, same pattern as `USER_PATCH_EMPTY`; they fall through `normalizeErrorCode` as `null` by design) + `extensions.fields = [{ field, code, message }]`; policy denials ride the default `VALIDATION` code with `fields` naming `password`. `extractFieldErrors`-style projection works unchanged.
- **The 3-arg `ValidationError(code, message, fields)` call does NOT type-check** — always use the 4-arg `(code, message, undefined, fields)` form (see §1.3); field entries must include `message` (`ApiFieldErrorType` requires it).
- **`UserRepository.findById(id, outerTx?)` / `findByEmail(email, tx?)` accept an optional executor** — any service that pre-reads a row before its own transaction MUST thread the caller's `outerTx` into that read or `runInRollback` tests will hit the bare-read path and observe stale/absent fixtures.
- Test-DB prerequisites held (Task 2/3 rules): `must_change_password` column present in `kottaby_test`; seed users present — no schema/seed operations were needed this task.
- Shared-worktree note: `git status` also carries pre-existing Task 0/1/1-fix/2/3/8 artifacts; this task's own diff is exactly the 3 source/test files + plan-dir/worklog writes listed in §2.

## 6. Verification of plan §4.3 failure-contract mapping

| Condition | Emitted | Matches §4.3? |
|---|---|---|
| current wrong / identity missing | `ValidationError` code `CURRENT_PASSWORD_INVALID` + `fields [{ field: "currentPassword", code: "CURRENT_PASSWORD_INVALID", message }]` | ✅ (code per D5/task text — the §4.3 row's "VALIDATION" label reads as the class family; the custom code is the task's explicit, thrice-repeated contract) |
| new == current | code `NEW_PASSWORD_SAME_AS_CURRENT` + fields `newPassword` | ✅ |
| new empty / < 8 | `VALIDATION` + fields `password` (`PASSWORD_REQUIRED` / `PASSWORD_TOO_SHORT`) | ✅ |
| success | password-stripped `User` with `mustChangePassword: false` | ✅ |

## 7. CROSS-FILE DEPENDENCY (report — not fixed; outside this task's write scope)

```
CROSS-FILE DEPENDENCY:
  Target file: backend/services/auth/auth.service.ts (Task 4) — unaffected by the finding below
  Blocked by:  backend/db/repo/users/user.repository.ts — findById (:75-95) + findByEmail (:43-63)
               non-transactional queryDb raw-SQL column lists omit `must_change_password`
  Impact:      production (no-tx) reads return rows WITHOUT `mustChangePassword`:
               - gqlContextFactory.ts:259 (UserRepository.findById) → ctx.user.mustChangePassword === undefined
               - login (AuthService.login → findByEmail) → AuthSession.user.mustChangePassword missing on the wire
               Task 7's forced-reset gate (reads ctx.user.mustChangePassword, plan §5.1) would NEVER deny,
               and the new `mustChangePassword` GraphQL Boolean! fields (Tasks 5/6) would see undefined.
  Rule:        AGENTS.md Fix-Or-Report rule (the repo file is not in Task 4's modify list)
  Required fix: add `must_change_password AS "mustChangePassword",` to BOTH raw-SQL SELECT column lists
               (the tx path already selects the full row; tests via runInRollback are unaffected).
               Dispatch with Task 5/6/7 (wire/gate) or as a standalone one-line-fix wave.
```

Task 4's own surface is safe: the service return comes from `UserRepository.updatePassword`'s Drizzle `.returning()` (full row, flag included), and the test path reads inside the tx.
