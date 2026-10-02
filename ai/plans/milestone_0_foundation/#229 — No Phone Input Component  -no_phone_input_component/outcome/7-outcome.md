# Task 7 — Outcome: admin create/update wired to the shared phone gate

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 7 — Wire shared helper into admin create/update; verify onboarding inheritance
> **Date:** 2026-09-30 · **Worktree:** `/home/z/feat-wt` (branch `feat/no-phone-input-component` @ 5111b928)
> **Pipeline:** 7.QL → 7.TE → 7.SEC → 7.SR → 7.IV — all executed, all pass

## 1. Summary

`validateCreateInput` and `validateUpdatePatch` (`backend/services/admin/user-management.helpers.ts`)
now route every phone check through the Task 5 shared gate
`validatePhoneField(value, locale)` (imported from the live barrel `@/backend/services/shared`),
so the admin surface can no longer drift from the public registration rule:

- **Create path** — the inline presence + legacy length-20 block was REPLACED by one
  `validatePhoneField(input.phone, locale)` call; a non-null result is pushed into the
  existing `entries` collection exactly like every sibling field check (same
  `ValidationError(entries[0].message, entries)` throw — message contract untouched).
  `""` → `PHONE_REQUIRED`, `"12345"` → `PHONE_INVALID` (new capability), 17-char →
  `PHONE_TOO_LONG`, valid E.164 → passes.
- **Update path** — the length-only check was REPLACED by a module-scope
  `phonePatchError(patch, locale)` resolver that keeps the `typeof patch.phone === "string"`
  guard shape and validates ONLY non-empty values: absent / `undefined` / `null` = leave
  alone (skip), empty or whitespace-only string = clears the stored phone (skip — the
  required-phone error can never fire on this path), non-empty = full shared E.164 gate.
- **`MAX_PHONE_LENGTH = 20` REMOVED** (private, non-exported; both in-file references
  disappeared with the wiring → dead constant, plan §Task-7 resolution). No test referenced it.
- **`user-management.service.ts` NOT modified** — verified clean, see §4 (no spread defect).
- **Onboarding inheritance verified by test, zero onboarding code touched** (§3, §5).

## 2. Files modified

| File | Action | Delta |
|---|---|---|
| `backend/services/admin/user-management.helpers.ts` | EDITED | +25 / −8 (import merge, const removal, two call-site replacements, `phonePatchError` helper + docblock) |
| `backend/services/admin/user-management.helpers.test.ts` | **CREATED** | 607→611 lines; the plan said EXTEND but NO colocated helpers test existed in the tree (checked before writing) — created fresh per the task's coverage matrix |
| `backend/services/admin/user-management.service.ts` | NOT touched | `updateUser` already builds the whitelisted patch field-by-field; no signature change (§4) |
| `backend/services/admin/student-onboarding.service.ts` | NOT touched | hard rule — inheritance proven through the real service in the test |

`git status --porcelain` over the scope: exactly the two files above (helpers modified, test untracked-new).

## 3. 7.TE — test run (mandated runner, never raw `bun test`)

`bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts`
→ **27 pass / 0 fail, 158 expect() calls, exit 0** (final run; one iteration fixed a fuzz
corpus expectation, see §3.1). Suite runs in ~0.7 s; DB tiers ride the live `kottaby_test`
Postgres through `runInRollback` + `tx` propagation.

Coverage matrix (4 tiers):

- **Tier 1 — every branch, pure:** create × {valid, `""`→PHONE_REQUIRED, `"12345"`→PHONE_INVALID,
  17-char→PHONE_TOO_LONG} in en + ar with `toEqual` on the exact localized entry and the
  entries[0] single-failure message contract; update × {absent key, explicit `undefined`,
  `null`, `""` clears, whitespace-only clears, `"12345"`→PHONE_INVALID, 17-char→PHONE_TOO_LONG,
  valid ± edge whitespace}.
- **Tier 2 — boundaries:** 16 vs 17 through BOTH validators; whitespace-only REQUIRED-on-create
  vs silent-clear-on-update asymmetry; `undefined` patch member; edge-whitespace tolerance.
- **Tier 3 — fuzz + concurrency:** 19-payload hostile corpus (control chars, bidi marks,
  Arabic-Indic digits, SQL/LIKE wildcards, `\u0024{phone}`, 10k-char runs, `+`×17, edge-whitespace
  valid) asserted to produce EXACTLY the shared gate's verdict on both paths × both locales;
  concurrent create/update probes (`Promise.allSettled`) agree with sequential; DB-backed
  concurrent `createUser` with hostile phones → both reject, zero users rows, zero audit rows.
- **Tier 4 — security:** `buildUpdatePatch` drops smuggled `role`/`id`/`isBlocked`/`passwordHash`/`email`;
  through-service `updateUser` with a smuggled phone patch writes ONLY the phone (role-child
  role intact, `isBlocked` false, smuggled `id` does NOT redirect the write — bystander row
  byte-identical); invalid-phone update leaves the row byte-identical; empty-string update
  clears the stored phone (storage read raw via `tx.select`); valid create persists verbatim;
  **onboarding delegation** — `StudentOnboardingService.onboardStudentWithOfflinePayment` with
  `"12345"` rejects through the REAL service + plan fixture with a `PHONE_INVALID` phone entry,
  the inherited `entries[0]` message, zero users rows, zero audit rows; **BFLA** — a real
  student actor and the anonymous caller are denied `createUser`/`updateUser`
  (`ForbiddenError` / `UnauthorizedError`) with zero writes.

Test-file house rules honored: `runInRollback` + `tx` on every DB case, `expectRepoError`
try/catch (never `.rejects.toThrow()` inside the rollback), module-scope `caughtValidationError`
as the sync analog (no per-test manual catches), tracked logger spies restored per test,
`bun:test` only, entities only via `entity-setup.ts`, no `console.*`.

### 3.1 Fix iterations (honest log)

1. First run: 26 pass / 1 fail — the update-path fuzz test wrongly demanded a rejection for
   the corpus's VALID edge-whitespace payload; fixed to assert the gate's actual verdict
   (valid → passes update too). Re-run: 27/0.
2. `sonarjs/no-hardcoded-passwords` on the smuggled `passwordHash` literal → intermediate
   const (mirrors the sibling service suite). `ANONYMOUS_ACTOR_ID` typo (unused-var + TS2552)
   and `makePhonePatch` return type (`AdminUpdateUserPatchInput`, structurally assignable to
   the DB patch) fixed under oxlint.

## 4. 7.SEC — Security & Tenancy Audit: PASS

- **BOPLA / mass-assignment (verified, NO defect found, NO service change):** `updateUser`
  never spreads the wire input — it calls `buildUpdatePatch(input)`, an explicit field-by-field
  whitelist of the five patchable columns, producing `AdminUserUpdateDbPatch`
  (`Partial<Pick<UserSelectType, "fullName" | "phone" | "country" | "gender" | "dateOfBirth">>`).
  The repository's `updateProfileFields` then applies `.set({ ...patch, updatedAt })` — the
  spread is of the ALREADY-WHITELISTED five-key DB shape (a documented, repo-test-pinned
  design: `backend/db/test/logic/admin/admin-user.repository.test.ts:1397`), never of raw
  input. Tier-4 probes prove smuggled keys cannot land (helper-level and through-service,
  including the smuggled-`id` redirection probe).
- **BFLA / tenancy:** both mutations open with `await assertActorAdmin(actorId, locale, outerTx)`
  before any work; denials are asserted with REAL fixture roles (student actor →
  `ForbiddenError`; anonymous id 0 → `UnauthorizedError`), zero writes.
- **Server-side gate before any write:** every hostile-phone case asserts zero user rows for
  the attempted email and zero audit rows attributed to the admin — validation precedes the
  transaction on create, update, and the delegated onboarding path alike.
- **No external channel is reachable** on any path under test (these flows dispatch no
  notifications and no provider calls; offline onboarding settles only after validation), so
  no channel mock was required — recorded honestly rather than mocked vacuously.

## 5. Onboarding inheritance (verified, zero service code)

`student-onboarding.service.ts` delegates identity creation to
`AdminUserManagementService.createUser` (its `:322` call site inside the single transaction),
which funnels through the now-wired `validateCreateInput`. The colocated test proves the
inherited rejection (`PHONE_INVALID`, exact localized message, zero writes) through the REAL
onboarding service with a real lane-bearing plan — no onboarding file was modified.

## 6. 7.QL — Quality Loop

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`:

| File | tsgo | oxlint | biome | lint:type-aware | duplicates | Exit |
|---|---|---|---|---|---|---|
| `user-management.helpers.ts` | ✅ | ✅ | ✅ | ✅ (after extracting `phonePatchError` — sonarjs cognitive-complexity 16→≤15) | ✅ | **0** |
| `user-management.helpers.test.ts` | ✅ | ✅ (3 fix iterations, §3.1) | ✅ | ✅ | ✅ (intra-file jscpd skipped — file outside jscpd scan scope, per script) | **0** |

**Non-vacuous type evidence (scoped-tsgo pattern, per outcome/3 §3):** the sub-loop's
project-wide tsgo stage has a documented OOM-false-pass history in this sandbox, so the real
gate was run separately: temp tsconfig OUTSIDE the repo (`/tmp/tsconfig.task7.json`, extends
root tsconfig, `incremental: false`, `typeRoots` pinned into repo `node_modules/@types`,
`include` overridden to exactly the touched files + the shared gate) → `tsgo -p … --noEmit`
**exit 0, ZERO diagnostics** over the full import closure; **negative control** through the
same config (probe assigning a `number` to the patch's `phone` member) → `error TS2322`, exit 1
— the gate engages and the `@/` alias resolves. Scratch configs/probes deleted.

## 7. 7.SR — Semantic Review: PASS

- ✅ No leftover inline phone check: the only phone logic left in the helpers file is the two
  `validatePhoneField` call sites (+ the `phonePatchError` intent resolver). Grep:
  `MAX_PHONE_LENGTH|PHONE_TOO_LONG|PHONE_REQUIRED` in `user-management.helpers.ts` → 0 matches.
- ✅ `MAX_PHONE_LENGTH` removed-if-dead honored: it became dead after wiring and is REMOVED;
  repo-wide grep shows it only in journey-test prose comments and plan documents (no code reference).
- ✅ Patch semantics preserved: absent ≠ required — `undefined`/`null`/`""`/whitespace-only all
  skip validation (test-pinned, including "never PHONE_REQUIRED on the update path").
- ✅ No `console.*` (grep 0 in both files); no `oxlint-disable`; no new deps; no cross-layer
  import (helpers imports only `@/backend/*` + `@/shared/locale`; test adds `@/shared/lib`-free,
  `@/backend` + `@/shared/locale` imports only).
- ✅ Error-envelope contract untouched: same `ValidationError(entries[0].message, entries)`
  throw, same `ApiFieldErrorType` shapes, sibling suites unaffected (the existing
  `user-management.service.test.ts` phone expectations — `PHONE_REQUIRED` for `""` create,
  31-char → `PHONE_TOO_LONG`, valid-phone patches — remain satisfied by construction).

## 8. 7.IV — Instruction Verification: PASS

Read in full and validated against: root `AGENTS.md`, `backend/AGENTS.md`,
`backend/services/AGENTS.md`, `backend/types/AGENTS.md`,
`.agents/instructions/backend.instructions.md`, `.agents/instructions/tests.instructions.md`
(the sub-loop printed the applicable set for both files). Notable rulings: types imported from
`@/backend/types`; no service-layer `.types.ts`; `getServerTranslations` single-arg + property
access; the tests.instructions "getServerTranslations hangs in tests" rule remains STALE vs the
current sync implementation — used at module scope per the Task 5 documented deviation
(suite completes in <1 s); DB rules (runInRollback / tx / expectRepoError / entity-setup-only) honored.

## 9. Carry-forward

- **Task 4 journey now 9/9 GREEN** — verified this session:
  `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts`
  → 9 pass / 0 fail (steps 6, 7, 8 flipped green by this wiring; 2/3 were already green via
  Task 6's registration wiring landing concurrently in the tree).
- `updateUser` consumers must know the tightened rule: a legacy non-E.164 phone (accepted by
  the old length-only check) now rejects on update with `PHONE_INVALID` — the intended
  supersession of `MAX_PHONE_LENGTH = 20` by the shared 16-char E.164 contract.
- Task 14 (test consolidation) can fold this suite's tier shapes; Task 15 wire-test asserts
  the same `PHONE_*` codes through the GraphQL envelope (unchanged producer contract).
- No spread defect existed to fix: `user-management.service.ts` left byte-identical.

## 10. Progress tracking

- [x] 7. Wire shared helper into admin create/update; verify onboarding inheritance — flipped
  ONLY this line in `tasks.md` (the Task 7 checkbox); no other checkbox touched.
