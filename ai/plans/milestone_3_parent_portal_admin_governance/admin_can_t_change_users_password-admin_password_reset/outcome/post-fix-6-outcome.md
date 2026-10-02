# Post-Fix 6 — R7 Finding 1 (LOW): mid-flight soft-delete window in `changeMyPassword`

**Scope:** single LOW finding from `round-R7-review-outcome.md` — the self-service password path's deleted check was pre-compare only, while a governance soft delete commits only `is_deleted`/`deleted_at`/`updated_at` (never `password_hash`), so a deletion landing inside the ~500 ms bcrypt proof window (after the identity read, before the fenced write) left the fence's WHERE fully satisfied and the write landed on the dead row with a success return.

## Code change — `backend/services/auth/auth.service.ts` (`changeMyPassword`)

1. **In-tx deleted-row guard** (the fix): the `withTransaction` callback was expanded from a one-liner into an async block that captures the fenced write's RETURNING row and re-checks it BEFORE the transaction commits:
   - `const written = await UserRepository.updatePassword(userId, passwordHash, false, tx, observedPasswordHash);`
   - `if (written !== null && written.isDeleted === true)` → the SAME single `CURRENT_PASSWORD_INVALID` `ValidationError` (constant shape, field `currentPassword`, identical to both existing denial sites), preceded by the standard `logger.logDomainError` security-audit event (`code/entity/entityId` only — no credentials).
   - The throw inside the callback rolls back the in-callback UPDATE — net effect **zero writes**, mirroring the admin path's in-tx returned-row check (`setUserPassword`, `user-management.service.ts:489`). A check after `withTransaction` returns would be too late (the top-level transaction has already committed) — the fix deliberately runs inside the callback per the finding's guidance.
   - No new error shape, no new oracle: a mid-flight deletion is indistinguishable from a wrong current password (identity is always the caller itself).
2. **Unchanged:** the fence-null branch (`!updated` → same denial), the returned-row `stripPasswordHash`, and the pre-compare `callerIsDeleted` fold.
3. **JSDoc updated:** the `changeMyPassword` sequence paragraph now describes the in-transaction deleted-row guard (written row re-checked pre-commit; deletion commits only governance columns; in-tx throw rolls the write back), the denial paragraph notes the deleted check runs at identity load AND on the written row inside the write transaction (closing the mid-flight window), and the `@throws` block lists both check points.

## Test — `backend/db/test/logic/auth/auth.service.test.ts` (one new Rule-9 committed-fixture test, Tier 7)

New describe `AuthService.changeMyPassword — mid-flight soft-delete (in-tx deleted-row guard)`, mirroring the sibling credential-fence describe's sanctioned static-fixture pattern (the race runs on the production no-`outerTx` path, which cannot observe an uncommitted `runInRollback` row):

- `beforeAll`: commit a user fixture with a REAL bcrypt hash of `FIXTURE_CURRENT_PASSWORD` + pending force-reset flag; `afterAll`: hard-delete ONLY that fixture (Rule 9).
- The interleaving: dispatch `changeMyPassword` (production shape) → `sleep(100)` → soft-delete via the governance seam the other tests use (`AdminUserRepository.setDeletedOnce(id, true)`, bare pool = committed) → await the change promise. The 100 ms priming delay parks the delete INSIDE the mid-flight window deterministically: the identity read completes in single-digit ms (delete lands AFTER it — the pre-compare fold cannot see this interleaving) while the fenced write is ~500 ms of bcrypt away (delete lands BEFORE it). This is the sibling true-race test's technique (fast concurrent commit vs. the bcrypt-sized window) tightened by the delay so the new guard branch is exercised, not merely possible — documented in the test body.
- Assertions: the single `CURRENT_PASSWORD_INVALID` shape (exactly one field entry, `currentPassword`/`CURRENT_PASSWORD_INVALID`, translated-substring match) + the dead row untouched (hash byte-identical to the committed fixture hash, flag still `true`, `isDeleted === true`, `deletedAt` non-null — the governance columns prove the delete committed inside the window) + zero `audit_logs` rows for the fixture (self path unaudited by design).
- Determinism evidence: the test ran at 568 ms — the full bcrypt compare + hash executed (the pre-compare fold short-circuits at ~5 ms), proving the denial came from the new in-tx guard.

## Verification (all green, logs in `/tmp/pf6-*`)

| Gate | Result |
|---|---|
| `bun tsgo` | exit 0 (0 errors) |
| `bun run lint` | exit 0 (0 problems) |
| `bun run test/scripts/run-test.ts backend/db/test/logic/auth/auth.service.test.ts` | **17 pass / 0 fail** (16 existing + 1 new) |
| `bun run test/scripts/run-test.ts backend/services/admin/user-management.service.test.ts` | **78 pass / 0 fail** (admin path untouched) |
| `bun run test/scripts/run-test.ts test/workflows/admin/admin-password-reset.journey.test.ts` | **7 pass / 0 fail** (solo) |
| `bun run scripts/health/sub-loop.ts backend/services/auth/auth.service.ts --lifecycle duplicates` (and the test file) | exit 0 both (sub-loop is single-file; ran once per file) |

## Outcome

R7 Finding 1 closed: the self path now re-checks the written row for `isDeleted` inside the write transaction, matching the admin path's post-write discipline — every interleaving of `changeMyPassword` ∥ admin soft-delete (delete-before-read, delete-in-window, admin-path counterpart) now denies with zero writes and the identical constant shape. Interleaving table row #4 in `round-R7-review-outcome.md` is fully ✔ (see appended post-fix-6 section there). No commits made (orchestrator commits).
