# Review Fix Wave post-fix-3

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Trigger:** R2 backend-semantics deep-dive verdict PASS with 2 findings (2 LOW, 0 MEDIUM/HIGH) — both routed to this wave.
**Feature commit:** `f6090190` (working tree restored to it first — see below). **No commits made** (orchestrator commits). Delta: 4 files, +284/−44.

## Environment remediation (required first)

The working tree had been externally reset to base `5a8369fe` (only the untracked `round-R2-review-outcome.md` survived). Per the wave protocol, restored the feature state with `git checkout f6090190 -- .` (all 4 focus files verified against `git show f6090190:<path>` before editing). No branch/ref changes; feature files restored only; the untracked R2 outcome file was untouched.

## F1 (LOW) — self path wrote credentials for soft-deleted principals

**Root cause (as reviewed):** `AuthService.changeMyPassword` performed no governance evaluation on the identity load, while the sibling admin path (`AdminUserManagementService.setUserPassword`) explicitly denies soft-deleted targets (`USER_NOT_FOUND`, in-tx) on the stated ground that "a deleted user has no live credential to replace". An in-session deleted caller could rotate a dead row's hash and clear the force-reset flag — two opposite semantics for the same predicate on the two paths sharing the single write home.

**Fix — folded into the EXISTING single denial shape (no new oracle, no new error code):**

- `backend/services/auth/auth.service.ts` (`changeMyPassword`): after the identity load, a cheap boolean `const callerIsDeleted = user?.isDeleted === true;` is evaluated BEFORE the bcrypt compare and folded into the existing condition: `if (!user || callerIsDeleted || !(await comparePassword(...)))` → the SAME `CURRENT_PASSWORD_INVALID` `ValidationError` (same code, same localized message, same single `currentPassword` field entry, same `logDomainError` shape with the unchanged message). Deleted callers receive byte-identical client behavior to a wrong current password — no existence/governance oracle (identity is always the caller itself), zero writes. Empirically the fold is pre-compare: the deleted-caller denial test runs ~280 ms vs ~560 ms for the wrong-password test (the ~250 ms compare is skipped).
- Method + module docblocks updated (denial contract now names all four folded cases; the stale `@throws UnauthorizedError` line for this method removed).

## F2 (LOW) — TOCTOU: current-password proof raced a concurrent admin rotation

**Root cause (as reviewed):** the current-password proof happened outside the write tx; an `adminSetUserPassword` committing inside the ~500 ms compare+hash window was silently clobbered by the self path's unconditional write (temporary hash overwritten AND the fence flag cleared).

**Fix — conditional write inside the SINGLE password-write home (no second repo method):**

1. `backend/db/repo/users/user.repository.ts` — `UserRepository.updatePassword` gains an OPTIONAL trailing param `expectedCurrentHash?: string`. When provided, the guarded UPDATE's WHERE gains `and(eq(users.id, userId), eq(users.passwordHash, expectedCurrentHash))` (Drizzle `and` imported alongside `eq, inArray`); when omitted, the WHERE is exactly the previous id-only predicate. Zero matched rows → `null`, the same miss signal as an absent id (JSDoc documents the fence, the re-arm semantics, and that admin override paths omit it).
2. `backend/services/auth/auth.service.ts` (`changeMyPassword`): after the compare succeeds, the observed credential is captured (`const observedPasswordHash = user.passwordHash;`) and threaded as the fence: `UserRepository.updatePassword(userId, passwordHash, false, tx, observedPasswordHash)`. When the write returns `null` inside the tx, the service logs (`logDomainError`, `{ code: "CURRENT_PASSWORD_INVALID", entity: "users", entityId, locale }`, message "credential fence rejected the write") and throws the SAME single `CURRENT_PASSWORD_INVALID` ValidationError — the concurrent-rotation case is deliberately indistinguishable from a wrong current password (constant shape, zero writes, savepoint/tx rollback). The former `UnauthorizedError` vanish-between-read-and-write branch is folded into this same denial (no race oracle).
3. Admin path verified untouched: `backend/services/admin/user-management.service.ts:480` still calls `updatePassword(id, passwordHash, input.mustChangePassword, tx)` — 4-arg, no fence, admin override semantics identical (its 78-test suite + journey D green). Exactly two production callsites confirmed by grep.

## Tests

`backend/db/test/logic/users/user.repository.test.ts` (+2, 14 → 16; coverage map updated):

- `fenced write succeeds when the expected current hash matches (fence re-arms to the rotated hash)` — conditional write with the fixture's own hash returns the FULL updated row; a second conditional write expecting the ROTATED hash also matches (fence re-arms).
- `fenced write with a STALE expected hash returns null and writes nothing` — a hash that cannot match yields `null` (same miss signal as absent id) and the stored credential + flag are byte-identical to the fixture (zero writes).

`backend/db/test/logic/auth/auth.service.test.ts` (+2, 14 → 16; coverage map Tier 5/6 updated):

- `soft-deleted caller → the SAME CURRENT_PASSWORD_INVALID shape; zero writes` — credentialed fixture soft-deleted in-session (`isDeleted: true` + `deletedAt`), the CORRECT current password offered → exactly the wrong-password shape (field `currentPassword`, code `CURRENT_PASSWORD_INVALID`, translated en copy) and the dead row's hash + pending flag untouched.
- Credential-fence describe (new) — `a concurrent admin rotation inside the proof window → the SAME CURRENT_PASSWORD_INVALID denial; the admin's write survives untouched`. **Approach (true race, not a mock):** the sanctioned Rule-9 committed-fixture pattern (real bcrypt hash of the fixture credential, created in `beforeAll` via `db.transaction` + `createTestUser`, hard-deleted in `afterAll`) because the fence runs on the PRODUCTION no-`outerTx` path (bare pool read → fresh `db.transaction`), which cannot observe an uncommitted `runInRollback` row. The self-change is invoked without awaiting (bare identity read dispatched), then the concurrent rotation (`passwordHash = real bcrypt hash of "AdminTemp99!"`, `mustChangePassword: true`) is committed on the pool — landing deep inside the ~500 ms cost-12 bcrypt compare+hash window. The assertions hold under EVERY interleaving (rotation before the read → read-stage denial; during compare/hash → fenced-miss denial; both identical client shapes), so the test is deterministic in outcome: CURRENT_PASSWORD_INVALID single-shape denial + the admin's rotated hash and `mustChangePassword: true` surviving byte-identical (a regression to the unconditional write would clobber both).

## Verification (bounded; server suites run solo after `kill` strays + `rm -f .next-test-dev/dev/lock`)

| # | Check | Result |
|---|---|---|
| 1 | `bun tsgo` | ✅ 0 errors (exit 0; re-confirmed after final edit) |
| 2 | `bun run lint` | ✅ 0 problems (exit 0; re-confirmed) |
| 3 | `run-test.ts backend/db/test/logic/users/user.repository.test.ts` | ✅ 16 pass / 0 fail (14 baseline + 2 new) |
| 4 | `run-test.ts backend/db/test/logic/auth/auth.service.test.ts` | ✅ 16 pass / 0 fail (incl. new deleted-caller + fence tests) |
| 5 | `run-test.ts backend/services/admin/user-management.service.test.ts` | ✅ 78 pass / 0 fail (admin path untouched) |
| 6 | `run-test.ts test/workflows/admin/admin-password-reset.journey.test.ts` | ✅ 7 pass / 0 fail |
| 7 | `sub-loop.ts <file> --lifecycle duplicates` × 4 touched files | ✅ exit 0 on all (one iteration needed: sonarjs `existing-groups` rejected a `replace("$2b$", …)` string pattern in the repo test — replaced with a plain distinct-hash literal, root-cause fixed, no disable comments) |

## Notes for the orchestrator

- `UnauthorizedError` remains imported in `auth.service.ts` (still thrown by `updateMyLocale`) — no dead import.
- No schema, gate, GraphQL, or i18n changes; delta confined to the 4 files listed.
- Logs stay distinguishable server-side (two distinct `logDomainError` messages: "identity or current password rejected" vs "credential fence rejected the write") while the client-facing contract remains a single constant shape — audit value without a new oracle.
