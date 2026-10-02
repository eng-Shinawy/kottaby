# Task 3 Outcome — `AdminUserManagementService.setUserPassword` + `validatePasswordPolicy` + service test

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `3. AdminUserManagementService.setUserPassword + validation helpers + service test (D4, REQ-003, REQ-004, REQ-010)` (Phase 2 — Backend Services)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root:** `/home/z/my-project` (plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; all paths resolve 1:1 relative to the repo root)
> **Result:** service method + pure validator helper + closed input type + 13 new tests; service suite **77 pass / 0 fail** (64 pre-existing + 13 new), governance static-scan suite **53/53** (one count-pin updated in the same change per `tests.instructions.md`), sub-loop exit 0 on all 5 touched files, full-repo `bun tsgo` **0 errors**. No commits made.

## 1. What Was Implemented

### 1.1 Type — `AdminSetUserPasswordSubmitInput` (`backend/types/admin/admin-user.types.ts`)

Added directly after `AdminUpdateUserPatchInput` (the plan's sanctioned sibling slot), re-exported through the existing `backend/types/admin/index.ts` + `@/backend/types` barrels with zero barrel edits:

```typescript
export interface AdminSetUserPasswordSubmitInput {
  readonly password: string;
  readonly mustChangePassword: boolean;
}
```

JSDoc documents the closed-whitelist discipline (exactly two keys; plaintext never stored/logged/audited/returned; NOT an extension of the profile patch whitelist).

### 1.2 Pure helper — `validatePasswordPolicy` (`backend/services/admin/user-management.helpers.ts`)

Placed between `validateUpdatePatch` and `buildCreateUserInsert` (the validator block):

```typescript
export function validatePasswordPolicy(password: string, tAuth: AuthLabels): ApiFieldErrorType[] {
  const entries: ApiFieldErrorType[] = [];
  if (!password || password.trim().length === 0) {
    entries.push({ field: "password", code: "PASSWORD_REQUIRED", message: tAuth.passwordRequired });
  } else if (password.length < MIN_PASSWORD_LENGTH) {
    entries.push({ field: "password", code: "PASSWORD_TOO_SHORT", message: tAuth.passwordTooShort });
  }
  return entries;
}
```

- **Pure and locale-agnostic**: takes the translated `AuthLabels` slice as its 2nd argument (imported `type { AuthLabels } from "@/shared/locale/types/auth"`) — **Task 4 can call it verbatim** with `getServerTranslations(locale).authTranslations`.
- Returns collected entries (empty array = policy satisfied) instead of throwing, so each consuming service composes its own `ValidationError` (the `validateCreateInput` throw-shape is preserved by the caller).
- Empty/whitespace-only → `PASSWORD_REQUIRED` (trim applied per REQ-003.3 "empty/whitespace"); `< MIN_PASSWORD_LENGTH = 8` → `PASSWORD_TOO_SHORT` — the constant reused verbatim, no new complexity rule (REQ-011.4).
- The plan's optional "audit-details builder" extraction was NOT needed: the details literal is a one-shot object at the single call site (`{ changedFields: ["credentials"], mustChangePassword: input.mustChangePassword }`) — extracting it would have added indirection, not reduced the body.

### 1.3 Service method — `setUserPassword` (`backend/services/admin/user-management.service.ts`)

Added inside `export namespace AdminUserManagementService` between `updateUser` and `setUserDeleted`; the file-header docblock was updated (seven → **eight** operations + a `setUserPassword` bullet + a note that the credential mutation uses the strict `assertActorAdminActive` gate).

```typescript
export async function setUserPassword(
  id: number,
  input: AdminSetUserPasswordSubmitInput,
  actorId: number,
  locale: string,
  outerTx?: DBTransaction
): Promise<AdminUserDetailReturnType>
```

Exact ordered sequence (D4):

1. `await assertActorAdminActive(actorId, locale, outerTx)` — the STRICT gate from `admin-gate.helpers.ts:133` (imported from `@/backend/services/admin/admin-gate.helpers`; note the distinct strict variant `assertActiveActorAdmin` lives in `admin-guards.helpers.ts` — this method uses the plan-named `assertActorAdminActive`). Deleted/blocked/suspended actor → `ForbiddenError` (localized `accountDeleted`/`accountBlocked`/`accountSuspended`); anonymous → `UnauthorizedError`; non-admin → `ForbiddenError`. **NO self-guard on admin targets** (admins trusted — documented decision; D5 defers any stricter admin-target policy).
2. `isPositiveSafeInteger(id)` else `throw new ValidationError(tErrors.validation)` (helper at `user-management.helpers.ts`).
3. `validatePasswordPolicy(input.password, t.authTranslations)` → non-empty → `throw new ValidationError(entries[0].message, entries)` — top-level message = first entry's localized `auth` copy, `extensions.fields` = `[{ field: "password", code: … }]` (the `validateCreateInput` message contract).
4. `const passwordHash = await hashPassword(input.password)` — **BEFORE the tx** (the `createUser` precedent); plaintext never enters the transaction.
5. `withTransaction(outerTx, async tx => …)`:
   - `UserRepository.updatePassword(id, passwordHash, input.mustChangePassword, tx)` (the single password-write home from Task 2; `AdminUserRepository` NOT extended) → `null` ⇒ one `logger.logDomainError` + `throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound)`.
   - `AuditService.createAuditLog(buildAuditContract(actorId, AuditActionType.Update, id, { changedFields: ["credentials"], mustChangePassword: input.mustChangePassword }), tx)` — **exactly ONE audit row** sharing the tx commit/rollback fate (an audit-insert failure rolls the password write back); `AuditActionType.Update` imported as a VALUE; details carry field names + the flag only.
   - `return getUserDetail(id, locale, actorId, tx)` — post-write detail re-read inside the tx; the returned `AdminUserDetailReturnType extends AdminUserSafeSelect` is password-stripped by type.
6. New imports: `assertActorAdminActive` (admin-gate.helpers), `validatePasswordPolicy` (helpers), `AdminSetUserPasswordSubmitInput` (types). Everything else (`hashPassword`, `withTransaction`, `NotFoundError`, `ValidationError`, `logger`, `AuditService`, `buildAuditContract`, `AuditActionType`, `UserRepository`) was already imported.

### 1.4 Service tests (`backend/services/admin/user-management.service.test.ts`, +13 tests)

New describe `AdminUserManagementService.setUserPassword` (10 tests, inserted after the `updateUser` describe) + new describe `validatePasswordPolicy — pure validator branch coverage` (3 direct unit probes of the helper):

| Test | Asserts |
|---|---|
| happy path — flag **true** | new plaintext verifies via `comparePassword(new, storedHash)`; old fixture credential fails against the new REAL bcrypt hash (the stub was replaced → hash-before-persistence observable); `result.mustChangePassword === true`; `"passwordHash" in result === false`; exactly ONE `Update` audit row for (actor, target); parsed `details.changedFields` deep-equals `["credentials"]`, `details.mustChangePassword === true`; raw details JSON does NOT contain the plaintext nor the stored hash |
| happy path — flag **false** | fixture pre-flagged `mustChangePassword: true` → after the call the DB flag and `result.mustChangePassword` are `false` (direct change clears any prior flag); ONE audit row |
| empty password | `ValidationError` + message contains `tAuth.passwordRequired`; `fields = [{ field: "password", code: "PASSWORD_REQUIRED" }]`; user row untouched (flag still false) + **zero audit rows for the actor** |
| whitespace-only password | same `PASSWORD_REQUIRED` shape (exercises the validator's trim branch) |
| 7-char password | `PASSWORD_TOO_SHORT` + `tAuth.passwordTooShort`; `comparePassword("Passw0r", storedHash)` false (no hash of the rejected plaintext ever landed) + zero audit rows |
| user not found | `NotFoundError` / code `USER_NOT_FOUND` + `tErrors.adminUsers.userNotFound`; zero audit rows |
| invalid id (0) | `ValidationError(tErrors.validation)`; zero audit rows |
| anonymous actor (0) | `UnauthorizedError` + zero audit rows |
| non-admin actor | `ForbiddenError` + zero audit rows (service-layer denial — defense in depth behind the GraphQL scope) |
| **deleted admin actor** | strict-guard proof: actor row marked `isDeleted` directly → `ForbiddenError` with `tErrors.accountDeleted` (distinguishes `setUserPassword`'s `assertActorAdminActive` from the relaxed CRUD gate) + zero audit rows |
| validator: empty / whitespace | direct probe — exactly one `PASSWORD_REQUIRED` entry with `field`/`code`/`message` pinned |
| validator: 7-char | direct probe — exactly one `PASSWORD_TOO_SHORT` entry pinned |
| validator: 8-char + longer | direct probe — `[]` (the shared-minimum boundary) |

Conventions honored: `runInRollback` + `tx` to every call; `expectRepoError` (no `expect().rejects`); `silenceDomainLog()` on denial paths; `countAuditRowsForActor` as the zero-audit oracle (per-actor counts immune to parallel-suite churn — the file's documented pattern); translated-message assertions via `getServerTranslations` property access; audit-JSON parsed through a new module-scope `isRecord` type-guard (`no-unsafe-type-assertion`-safe — the first sub-loop run caught a `JSON.parse(…) as {…}` assertion and it was replaced with the `unknown` + guard pattern). Header coverage map updated with the new branches.

### 1.5 Sanctioned pin update — `backend/services/admin/user-governance.service.test.ts` (scope note ⚠️)

That file's Tier-4 static scan "withTransaction single boundary per mutation" asserts the service's code-only `withTransaction(` count. `setUserPassword` legitimately adds a third call, so the pin went stale the moment the method landed. Per `tests.instructions.md` ("ANY change to a source file covered by static source-scan pin tests must update those pins in the SAME change — a stale pin asserts a false contract"), the assertion was updated `2 → 3` (+ comment naming the three mutations). **This is the only file touched beyond the task's base list**; the update is assertion-only (no behavioral test changed), and the whole 53-test governance suite re-ran green against the modified service.

## 2. Files Modified / NOT Modified

| File | Change |
|---|---|
| `backend/types/admin/admin-user.types.ts` | +`AdminSetUserPasswordSubmitInput` (+JSDoc). Barrel re-exports unchanged. |
| `backend/services/admin/user-management.helpers.ts` | +`import type { AuthLabels }`; +`validatePasswordPolicy` (+JSDoc). |
| `backend/services/admin/user-management.service.ts` | +3 imports; header docblock (8 operations, strict-gate note); +`setUserPassword` (+JSDoc). |
| `backend/services/admin/user-management.service.test.ts` | +2 imports; +`isRecord` helper; header coverage-map line; +10 `setUserPassword` tests; +3 validator probes. |
| `backend/services/admin/user-governance.service.test.ts` | Pin maintenance ONLY: `withTransaction` count `2 → 3` + comment (see §1.5). |
| `ai/plans/…/outcome/3-outcome.md` | This file (new). |
| `ai/plans/…/tasks.md` | Task 3 main line + `3.QL/3.TE/3.SEC/3.SR/3.IV` flipped only. |
| `worklog.md` | Appended Task 3 record. |

**Files NOT modified (and why):** `AdminUserRepository`/`admin-user.repository.ts` (explicitly out of scope — no extension), `backend/db/repo/users/user.repository.ts` (Task 2's `updatePassword` consumed as-is), `backend/graphql/**` (Task 5/6), `backend/services/auth/auth.service.ts` (Task 4), shared/locale/** (Task 8 already shipped the keys — none new needed here), `user-management.mappers.ts` (already carries `mustChangePassword` from Task 1-fix), `admin-gate.helpers.ts`/`admin-guards.helpers.ts` (guards consumed, not changed), backend/types barrels (`export *` auto-flows the new type).

## 3. Environment prerequisite (no file change)

First full-suite run failed ONE pre-existing test unrelated to this task: `getStats > happy path` asserts `totalCount >= 6` "on top of the seed rows", but the suite runs against `kottaby_test` (run-test.ts pins `.env.test`), which had **0 committed users** (verified via psql). CI performs this exact step (`ci.yml`: "Seed database for service tests" → `bun run db seed` before `test:services`). Applied the same environment-operation convention as Task 2's schema push:

```
bun --no-env-file run scripts/dbActions/cli-entry.ts seed --env-file .env.test   # ✓ Success
```

Re-run → suite fully green. **Carry-forward: the sandbox test DB must stay seeded (4 demo users) for this suite; schema deltas must be pushed to BOTH `.env` and `.env.test` (Task 2's rule).**

## 4. Verification Results

- **3.QL** — `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` (tsgo → oxlint → biome → lint:type-aware → duplicates), all from repo root:

| File | Exit | Log |
|---|---|---|
| `backend/types/admin/admin-user.types.ts` | **0** | `/tmp/subloop-t3-types.log` |
| `backend/services/admin/user-management.helpers.ts` | **0** | `/tmp/subloop-t3-helpers.log` |
| `backend/services/admin/user-management.service.ts` | **0** | `/tmp/subloop-t3-service.log` |
| `backend/services/admin/user-management.service.test.ts` | **0** (after the §1.4 unsafe-assertion fix; first run oxlint-failed) | `/tmp/subloop-t3-test3.log` |
| `backend/services/admin/user-governance.service.test.ts` (pin file) | **0** | `/tmp/subloop-t3-govtest.log` |

- **3.TE** — `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` → **77 pass / 0 fail / 316 expect() calls** (64 pre-existing + 13 new). Validator branch coverage: all four branches exercised BOTH through the service (empty, whitespace-only, 7-char, valid) and via direct probes (8-char boundary). `backend/services/admin/user-governance.service.test.ts` → **53 pass / 0 fail / 188 expect()** (static scans green against the modified service).
- **Full-repo `bun tsgo`** → **0 "error TS" lines, tool exit 0** (before edits 0 → after edits 0; no NEW errors vs the Task 0 baseline).
- No `console.*` added anywhere; no `expect(...).rejects` inside `runInRollback`; no raw `bun test`; no `oxlint-disable` comments.

## 5. Subtask Pipeline

- **3.QL** ✅ — §4 table: 5/5 files exit 0.
- **3.TE** ✅ — suite green via run-test (77/0); validator 100% branch-covered (service-level + direct probes).
- **3.SEC** ✅ — `hashPassword` runs BEFORE the tx and the stored column is a real bcrypt hash (verified by `comparePassword`); audit `details` = `{"changedFields":["credentials"],"mustChangePassword":<bool>}` — the test asserts the raw JSON contains neither the plaintext nor the stored hash (and the Tier-4 no-PII static scan still passes); non-admin/anonymous denied at the service layer with zero writes and zero audit rows; the return type structurally omits `passwordHash` (asserted `"passwordHash" in result === false`).
- **3.SR** ✅ — no `AdminUserRepository` extension (password write flows through `UserRepository.updatePassword` only); all errors are `DomainError` subclasses from `@/backend/lib/errors` (`ValidationError` with field payloads, `NotFoundError("USER", …)`, `ForbiddenError`, `UnauthorizedError`); `AuditActionType.Update` imported as a VALUE (static scan "AuditActionType is a VALUE import with MEMBERS" still green); the audit row rides the caller's `tx`, so an audit-insert failure rolls back the password write (REQ Reliability.1).
- **3.IV** ✅ — read in full BEFORE editing: `backend/services/AGENTS.md`, `backend/AGENTS.md`, root `AGENTS.md`, `.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md` (sub-loop re-printed tests+backend instructions for the test file; services AGENTS.md set for the service). Types from `@/backend/types` only (no service `.types.ts`); `locale` threaded; `logger.logDomainError` for expected denials (ids + codes only).
- **Semantic-review checklist (protocol rule 3):** tenancy/BOLA — write is id-scoped by PK, target identity comes from the resolver argument validated by `isPositiveSafeInteger`; actor authorization via the strict gate before any tx. Race conditions — single guarded `UPDATE…WHERE id…RETURNING`; concurrent writes serialize on the row lock (last-writer-wins, each writes its own audit row — plan §5.1). Enums-as-values — `AuditActionType.Update` value import; no string literals. Cross-layer imports — none added (service→helpers/repo/gate are the established same-layer seams). Dead code — none (the optional audit-details-builder extraction was deliberately skipped). Deferred items — D5 (admin-target policy) untouched: no self-guard added, per the documented decision.

## 6. Carry-Forward Knowledge (for Tasks 4/5/11/14)

- **Task 4 (`AuthService.changeMyPassword`) — the validator is ready to import:**

```typescript
import { validatePasswordPolicy } from "@/backend/services/admin/user-management.helpers";
// inside the service, after identity + current-password checks:
const fieldErrors = validatePasswordPolicy(newPassword, getServerTranslations(locale).authTranslations);
if (fieldErrors.length > 0) {
  throw new ValidationError(fieldErrors[0].message, fieldErrors); // same shape as setUserPassword
}
```

  Signature: `validatePasswordPolicy(password: string, tAuth: AuthLabels): ApiFieldErrorType[]` — empty array = policy satisfied; entries are `{ field: "password", code: "PASSWORD_REQUIRED" | "PASSWORD_TOO_SHORT", message: <localized auth copy> }`. It does NOT throw and does NOT take a locale (pass `t.authTranslations`).
- **Task 5 (wire test)** can reuse the service-test's audit assertion shape: ONE `Update` row per success, `details.changedFields === ["credentials"]`, raw JSON free of plaintext/hash; deep `passwordHash` walk stays green because the service returns `AdminUserDetailReturnType` (hash structurally absent).
- **`assertActorAdminActive` vs `assertActiveActorAdmin`:** two similarly-named STRICT guards exist — the credential mutation uses `assertActorAdminActive` (`admin-gate.helpers.ts`, boolean `actor.suspended` check) exactly as the plan names it; `assertActiveActorAdmin` (`admin-guards.helpers.ts`, suspension-window predicate with lapsed pass) remains the governance-axes guard. Do not "unify" them.
- **Static-scan pins on `user-management.service.ts`** live in `user-governance.service.test.ts` (Tier 4). The `withTransaction` count is now **3**; any future service method with its own transaction boundary must bump it in the same change. Other pins (no `{ ...input }` spreads, no PII keys in `details` blocks, `getUserDetail(id, locale, actorId, tx)` literal, happy-path log silence) all still hold and constrain future edits.
- **Test-DB seeding rule** (§3): service suites assume the 4 demo seed users in `kottaby_test`; seed after any test-DB reset (`bun --no-env-file run scripts/dbActions/cli-entry.ts seed --env-file .env.test`).
- Task 14 baseline-diff: `bun tsgo` remains 0 NEW errors; the shared worktree's `git status` also carries pre-existing Task 0/1/1-fix/2/8 artifacts — this task's own diff is exactly the 5 source/test files + plan-dir/worklog writes listed in §2.

## 7. Cross-File Dependencies

- **Task 4** consumes `validatePasswordPolicy` (§6) and `UserRepository.updatePassword` (with `mustChangePassword: false`); its `ValidationError` field payloads should mirror this task's `fields`-entry shape.
- **Task 5** registers `adminSetUserPassword` → `AdminUserManagementService.setUserPassword(id, input, ctx.user.id, ctx.locale)`; the scope layer (`role: [Admin]`) is the outer BFLA ring, this service's strict gate the inner one.
- **Task 11 (journey)** inherits the shared-state transition proven here: `adminSetUserPassword{mustChangePassword:true}` ⇒ flag true + ONE `Update`/`credentials` audit row; `{false}` clears the flag.
- **Task 14** compares lint/tsgo/biome baselines — unchanged at zero.

---

## 8. Mid-point review fix (deleted-target denial)

> **Task ID:** `mid-fix-1` · **Date:** 2026-09-30 · **Agent:** general-purpose subagent
> **Trigger:** mid-point review — the specs' REQ-008 actor table scopes `adminSetUserPassword` to "any **non-deleted** user", but the §1.3 ordered sequence (plan D4) omitted a deleted-target check; the review resolved the specs↔plan inconsistency in favor of the specs. As shipped, a soft-deleted user's credential could be rotated + audited.

### 8.1 Change (minimal, atomic, zero extra queries)

`AdminUserManagementService.setUserPassword` — the in-tx repo-write step now re-checks the returned FULL row. `UserRepository.updatePassword`'s guarded `UPDATE … WHERE id = …` has NO `isDeleted` predicate (it still matches soft-deleted rows), so the deleted-target denial rides the row the write already returns:

```typescript
if (written === null || written.isDeleted === true) {
  logger.logDomainError(
    written === null
      ? "Admin user password set: user not found"
      : "Admin user password set: target user is deleted",
    { code: "USER_NOT_FOUND", entity: "user", entityId: id }
  );
  throw new NotFoundError(USER_ENTITY, tErrors.adminUsers.userNotFound);
}
```

- The two previously-separate denial conditions are ONE guarded branch (absent id ∨ soft-deleted row) → the SAME `NotFoundError("USER", tErrors.adminUsers.userNotFound)` the file's other methods construct, distinguished only by the `logDomainError` stem. Net code-line delta kept negative on purpose: the first sub-loop run failed oxlint `max-lines` (302 > 300) on the two-branch shape; the merge brought the file to 295 code lines without weakening the contract.
- **Thrown BEFORE the audit insert**; the `withTransaction` unit (top-level tx in production, SAVEPOINT under the test's `outerTx`) rolls back the already-executed UPDATE — net effect **ZERO writes + ZERO audit rows**.
- **Pattern choice (documented):** the preferred in-tx returned-row check was adopted over (a) an earlier `findById` pre-check (extra query + check-then-write race window) and (b) mirroring the governance ladder's `ConflictError("USER_ALREADY_DELETED")` (`user-governance.helpers.ts:90`) / cold-start's `TEACHER_ACCOUNT_GOVERNED` conflict (`cold-start-certification.service.ts:192`) — those are surface-specific state conflicts on the axis being toggled, whereas a deleted target here is simply outside the op's addressable set (specs: "any non-deleted user"), which is exactly the existing `USER_NOT_FOUND` contract. Only the `=== true` nullable-boolean guard shape mirrors `user-governance.helpers.ts:90`.
- JSDoc (method + file header) updated to state the deleted-target rule; no other method touched.

### 8.2 Test (+1, service suite now 78)

`backend/services/admin/user-management.service.test.ts` — new test in the `setUserPassword` describe, placed beside the absent-id sibling: **soft-deleted target → `NotFoundError` / `USER_NOT_FOUND` + `tErrors.adminUsers.userNotFound`; ZERO writes; ZERO audit rows.** Zero-write proof: the fixture's hash is REPLANTED with a REAL bcrypt hash of a known `oldPassword` before the denial (the default `TEST_BCRYPT_STUB_HASH` verifies nothing, so "old credential still compares true" needs a genuine hash); after the failed call the stored hash still verifies `oldPassword` and rejects `newPassword`, `mustChangePassword` is untouched, and `countAuditRowsForActor(tx, admin.id) === 0`. `hashPassword` added to the test's `@/backend/lib/auth/password` import; header coverage map extended.

### 8.3 Verification

- `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` → **78 pass / 0 fail / 324 expect()** (77 + 1 new).
- `user-governance.service.test.ts` static-scan pins (withTransaction=3, happy-path silence, no-PII, tx propagation, DomainError-only denials) → **53 pass / 0 fail**.
- Sub-loop `--lifecycle duplicates`: service **exit 0** (after the max-lines merge; first run oxlint-failed at 302 code lines), test **exit 0**.
- Full-repo `bun tsgo` → **0 "error TS" lines, exit 0**. No `console.*`; no plan-artifact references in code; files touched: service + service test + this outcome + worklog only.
