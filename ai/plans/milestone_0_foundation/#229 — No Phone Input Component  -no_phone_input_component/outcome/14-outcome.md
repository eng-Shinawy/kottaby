# Task 14 — Outcome: Backend service validation tests (4-tier consolidation)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 14 — Backend service validation tests (4-tier consolidation) (REQ-6.2, REQ-9.2, REQ-9.3)
> **Date:** 2026-09-30 · **Worktree:** `/home/z/feat-wt` (branch `feat/no-phone-input-component` @ `d76cb6cc`) · **Pipeline:** 14.QL → 14.TE → 14.SEC → 14.SR → 14.IV — all executed
> **Scope discipline:** consolidation/audit/EXPANSION of the two colocated suites authored by Tasks 6/7 — **zero production code touched** (no production bug found; `git status` shows only the two test files modified by this task).

## 1. Summary

Audited both colocated backend phone suites against the 4-tier framework and the joint
14.TE assertion (every phone code × en/ar + valid path), then filled the genuinely missing
cells. **5 coverage gaps found, 5 filled, 0 production changes:**

| # | Gap (audit result) | Fix |
|---|---|---|
| 1 | `ar` locale never exercised through the **registration funnel** (`registerUser`) — file was en-only | New ar tier: all 3 machine codes with EXACT ar templates + valid-path-in-ar persistence (1 test) |
| 2 | `createAdminUser` only proved ONE code (`PHONE_INVALID`) — funnel matrix incomplete | New test: REQUIRED + TOO_LONG (en) + INVALID (ar) through the privileged entry point, residual probes each |
| 3 | **BOPLA at the registration create boundary** was asserted nowhere (admin file covers the update path only) | New Tier-4 describe: `id`/`isBlocked`/`suspended`/`passwordHash` smuggled onto the input at runtime → never reach the users row (explicit field-by-field mapping pinned), phone persists |
| 4 | `ar` existed only in the admin file's **pure** tiers — locale threading through the **DB-backed** admin service calls unproven | New DB-tier test: `createUser`(ar)→`PHONE_INVALID` ar copy + `updateUser`(ar)→`PHONE_TOO_LONG` ar copy, zero writes, target row byte-identical |
| 5 | Onboarding inheritance proved for `PHONE_INVALID` only | Extended the existing inheritance test with the REQUIRED branch (empty phone → `PHONE_REQUIRED` — create-gate semantics, never the update-path silent clear), still one rollback/one plan fixture |

Counts: `registration.service.test.ts` **12 → 15 tests** (177 → 218 expect() calls); `user-management.helpers.test.ts` **27 → 28 tests** (158 → 168 expect() calls).

## 2. Audit matrix (post-task state — which test covers which code × locale × tier)

Legend: ✅ pre-existing (Task 6/7) · ➕ ADDED by Task 14 · ◻️ covered-by-composition (documented, deliberately not duplicated).

### 2.1 `backend/services/auth/registration.service.test.ts` — the registration funnel (`validateInput`)

| Tier | Code | en | ar |
|---|---|---|---|
| T1 outcomes | PHONE_REQUIRED | ✅ `registerUser` (entry mirrored by top-level message + residual probe) | ➕ `registerUser` (exact ar template) |
| T1 outcomes | PHONE_INVALID | ✅ `registerUser` + ✅ `createAdminUser` | ➕ `registerUser` + ➕ `createAdminUser` |
| T1 outcomes | PHONE_TOO_LONG | ✅ `registerUser` (generic `errorsTranslations.validation` copy) + ➕ `createAdminUser` | ➕ `registerUser` |
| T1 outcomes | valid E.164 | ✅ persists verbatim + ✅ no phone entry when an unrelated field fails (email-first ordering) | ➕ persists verbatim in ar |
| T1 outcomes | REQUIRED+TOO_LONG via `createAdminUser` (en) | ➕ | — (ar threading proven via INVALID arm) |
| T2 boundaries | 16 accepted vs 17 rejected · empty · whitespace-only · edge-whitespace tolerated | ✅ | ◻️ (schema-level boundaries owned by Task 2's 48-test suite; locale-independent) |
| T3 fuzz/concurrency | `Promise.allSettled` over the deterministic 11-payload hostile corpus (`\u0024{phone}` injection shape included), no cross-arm pollution, zero leaked rows | ✅ | ◻️ (verdict equivalence pinned per-locale in the helper's own suite) |
| T4 no-echo (REQ-9.3) | message EQUALS localized template + set membership + `not.toContain(payload)` on entry & top-level message | ✅ (en; ar templates are the same fixed-template objects asserted exactly in the ar tier) | ◻️ |
| T4 BOPLA (REQ-9.2) | smuggled `id`/`isBlocked`/`suspended`/`passwordHash` never reach the users insert; service-minted id; governance defaults server-set | ➕ | ◻️ |

### 2.2 `backend/services/admin/user-management.helpers.test.ts` — admin create/update + inheritance

| Tier | Code / case | en | ar |
|---|---|---|---|
| T1 pure | `validateCreateInput` × {valid, REQUIRED, INVALID, TOO_LONG} with exact localized entries | ✅ | ✅ |
| T1 pure | `validateUpdatePatch` × {absent, `undefined`, `null`, ""-clears, whitespace-clears, INVALID, TOO_LONG, valid ± edge-ws} | ✅ (ar for INVALID/TOO_LONG/""-clear) | ✅ (same cells) |
| T2 | 16 vs 17 through BOTH validators; whitespace REQUIRED-on-create vs silent-clear-on-update asymmetry | ✅ | ◻️ |
| T3 | 19-payload hostile fuzz verdict === shared gate's verdict (single source of truth) ×2 paths | ✅ ×2 locales | ✅ ×2 locales |
| T3 | `Promise.allSettled` pure probes agree with sequential; DB concurrent hostile `createUser` (both reject, zero users rows, zero audit rows) | ✅ | ◻️ |
| T3/DB | locale threading through the SERVICE boundary: `createUser`(INVALID) + `updateUser`(TOO_LONG) with zero writes | ◻️ (en DB tiers pre-existing) | ➕ |
| T4 BOPLA | `buildUpdatePatch` drops smuggled `role`/`id`/`isBlocked`/`passwordHash`/`email`; through-service `updateUser` writes ONLY phone (smuggled id does NOT redirect — bystander byte-identical); invalid-phone update leaves row byte-identical; "" clears storage; valid create persists verbatim | ✅ | ◻️ |
| T4 inheritance | onboarding → `createUser` rejects: PHONE_INVALID | ✅ | ◻️ |
| T4 inheritance | onboarding → `createUser` rejects: PHONE_REQUIRED (create semantics) | ➕ | ◻️ |
| BFLA | student→`ForbiddenError`, anonymous→`UnauthorizedError` on create/update, zero writes | ✅ | — |

### 2.3 Joint 14.TE assertion — SATISFIED

Every phone code in **en AND ar** plus the **valid path** is exercised by the two files together, in BOTH the pure and the through-the-service projections:

- `PHONE_REQUIRED`: en (reg-funnel T1 · admin create T1 · onboarding ➕) · ar (reg-funnel ➕ · admin create T1)
- `PHONE_TOO_LONG`: en (reg-funnel T1+➕ · admin both validators T1/T2) · ar (reg-funnel ➕ · admin create/update T1 + DB update ➕)
- `PHONE_INVALID`: en (reg-funnel T1 · admin both validators · DB concurrent create) · ar (reg-funnel ➕ + createAdminUser ➕ · admin T1 + DB create ➕)
- valid path: en (registration persists verbatim · admin persists verbatim · update accepts ± edge-ws) · ar (registration ➕ · admin create/update T1 ✅)

**Deliberately NOT duplicated** (documented so the audit is honest): PHONE_TOO_LONG through onboarding (onboarding → `createUser` → `validateCreateInput`, whose TOO_LONG branch is pinned en+ar; two inherited codes already prove the delegation is code-agnostic); an `undefined`-phone boundary on the registration path (`RegistrationSubmitInput.phone` is a REQUIRED `string` — no such arm exists; the `undefined`-patch boundary belongs to the update path and is covered); ar re-runs of locale-independent Tier-2/Tier-3 shapes.

## 3. Verification results

### 14.QL — Quality Loop: **exit 0 on BOTH files** (honest tsgo caveat)

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`:

| File | tsgo | oxlint | biome | lint:type-aware | duplicates | Exit |
|---|---|---|---|---|---|---|
| `backend/services/auth/registration.service.test.ts` | ✅ (see caveat) | ✅ | ✅ | ✅ | ✅ (skipped — outside jscpd scan scope, per script) | **0** |
| `backend/services/admin/user-management.helpers.test.ts` | ✅ (see caveat) | ✅ | ✅ | ✅ | ✅ (skipped — outside jscpd scan scope, per script) | **0** |

**tsgo honesty note (A2 recurrence, THIS window):** dmesg records `tsgo` OOM kills at uptime
8554 s and 8592 s (`anon-rss ~2.9–3.0 GB`) — inside this task's sub-loop window — so both
"✅ tsgo passed" lines are the documented **vacuous false-pass** (killed process emits no
diagnostics for the target file; the filter then finds nothing). **Non-vacuous scoped gate**
per the outcome/3 §3 fallback: temp tsconfig OUTSIDE the repo (`/tmp/tsconfig.task14.json`,
`extends` root tsconfig, `incremental: false`, `typeRoots` pinned into the repo's
`node_modules/@types`, `include` overridden to exactly the two touched files — the 1-fix
"must override `include`" pitfall honored) → `tsgo -p … --noEmit` → **exit 0, ZERO
diagnostics** over the full import closure. **Negative control** through the same config
shape (scratch probe mis-typing `validatePhoneField`'s return AND argument) → **TS2322 ×2 +
TS2345, exit 1** ⇒ the gate engages and the `@/` alias resolves. All scratch files deleted.

### 14.TE — Test runs (mandated runners, never raw `bun test`)

Per-file (mandated runner):

- `bun run test/scripts/run-test.ts backend/services/auth/registration.service.test.ts`
  → **15 pass / 0 fail, 218 expect() calls** (was 12/177)
- `bun run test/scripts/run-test.ts backend/services/admin/user-management.helpers.test.ts`
  → **28 pass / 0 fail, 168 expect() calls** (was 27/158)

`bun run test:services` (parallel runner) → **aborted fail-fast at file 19/81**: 435 pass /
**1 fail** — `AdminUserManagementService.getStats > happy path …` (see baseline §4). Re-run
of that file in isolation: **63 pass / 1 fail** — same deterministic failure.

`bun run test:services:sequential` (ONCE, per task block) → **1989 pass / 2 fail across ALL
81 files / 191 tests**, 28,924 expect() calls:

1. `AdminUserManagementService.getStats > happy path …` — same deterministic pre-existing failure (below).
2. `SessionAdminGovernanceService — chaos … admin cancel ⚡ participant complete on the SAME started session` — **passes in isolation** (49 pass / 0 fail re-run via the mandated runner): a deliberate race/chaos probe that flaked under full-suite load. Not reproducible standalone.

**Phone gate:** ALL phone-related suites are green in both runner modes — the two
consolidated files (43 tests total), the helper's own suite, and the sibling
`backend/db/test/logic/auth/registration.service.test.ts` (21) are inside the 1989 passes
(the only 2 failures are named above and neither is a phone test). **No NEW failures were
introduced by Task 14.**

### 14.SEC — Security & Tenancy Audit: PASS

- **BOPLA / REQ-9.2 at the service boundary** — now asserted on BOTH write paths: the admin
  update whitelist (pre-existing: helper-level `buildUpdatePatch` drop-probe +
  through-service smuggled-role/id/isBlocked probe with bystander byte-identity) AND the
  registration create boundary (new: runtime-smuggled `id`/`isBlocked`/`suspended`/
  `passwordHash` never reach the users row — the service's explicit field-by-field insert
  mapping is pinned, service-minted id, server-set governance defaults).
- **REQ-9.3 (no raw-input echo)** — registration Tier 4 asserts per hostile payload that
  `fields[0].message` EQUALS the localized template, is a member of the 3-template set, and
  does not contain the submitted value (entry + top-level message). The admin file's fuzz
  pins `toEqual` against the shared gate's own fixed-template entry (exact-equality ⇒ no
  echo by construction), and the new ar DB-tier asserts exact ar templates.
- **REQ-9.1** — every hostile-phone case proves rejection BEFORE any write (identity-scoped
  zero-row probes; audit-row zero-probes on admin paths; target row byte-identity on the
  rejected update).
- **No external channel is reachable** on any tested path (validation precedes every write;
  these flows dispatch no notifications/providers) — recorded honestly rather than mocked
  vacuously, consistent with Tasks 6/7.

### 14.SR — Semantic Review: PASS

- ✅ No seed-data queries — fixtures come from `entity-setup.ts` helpers
  (`createTestUser`/`createTestStudent`/`createTestPlan`, signatures re-verified in
  `entity-setup.ts:74/:104/:180` before use) and per-run unique inputs (`crypto.randomUUID` /
  `randomUUID` emails).
- ✅ Helper signatures verified before use: `validatePhoneField(value, locale)`,
  `RegistrationService.registerUser/createAdminUser(input, locale, outerTx?)`,
  `AdminUserManagementService.createUser(input, actorId, locale, tx)` /
  `updateUser(userId, patch, actorId, locale, tx)`, `runInRollback`/`expectRepoError`.
- ✅ Every DB-touching case runs inside `runInRollback` with `tx` propagated to every
  service call and direct query; rejections captured via `expectRepoError` try/catch and the
  sync `caughtValidationError` analog — **zero** `.rejects.toThrow()` inside the wrapper.
- ✅ No `console.*`, no `oxlint-disable`, no `any`, no new deps (grep 0 over both files).
- ✅ **NO production code changed** — `git status` shows only the two test files modified by
  this task (a third file, `frontend/graphql/test/auth/auth.test.ts`, appeared mid-window
  from the CONCURRENT Task 15 subagent — not touched by Task 14).
- ✅ Comments stay domain-language; no REQ/Task artifacts in code.

### 14.IV — Instruction Verification: PASS

Read in full: root `AGENTS.md`, `backend/AGENTS.md`, `backend/services/AGENTS.md`,
`backend/db/test/AGENTS.md`, `.agents/instructions/backend.instructions.md`,
`.agents/instructions/tests.instructions.md` (sub-loop re-printed the applicable set for both
files). Validated: bun:test only; mandated runners; `runInRollback`/tx/`expectRepoError`
discipline; entity-setup-only fixtures; types from `@/backend/types`; no service-layer
`.types.ts`; no new deps; no cross-layer imports. **Documented deviation (precedented):**
`tests.instructions.md`'s "getServerTranslations hangs in tests" rule remains stale vs the
current synchronous static-bundle lookup — the suites (like their pre-existing selves and
Tasks 5/6/7) source expected templates from `getServerTranslations` at module scope and
complete in <2 s; recorded as a deviation, not silently ignored.

## 4. Pre-existing baseline issues (NOT phone-related, NOT introduced by Task 14, NOT fixed — outside this task's allowed files)

1. **`AdminUserManagementService.getStats > happy path` fails deterministically** (parallel
   runner fail-fast + sequential + isolated re-run): the test asserts
   `stats.totalCount >= 6` expecting **seed rows** ("observable on top of the seed rows"),
   but `kottaby_test.users` currently holds **0 rows** (verified read-only), so the counter
   is 2 (its own fixtures). Root cause is environmental/structural: the test DB has no seed
   users, and the test depends on their presence (itself a tension with the
   never-query-seed-data rule). Phase 0 baseline (`outcome/0-baseline-outcome.md`) recorded
   no test:services run, so this is the first time the full services suite ran in this
   sandbox. Carry-forward for Task 16: either seed `kottaby_test` before the final gate or
   the test needs de-seeding (owner: orchestrator / Task 16 — file is outside Task 14's
   scope).
2. **`SessionAdminGovernanceService` chaos race** flakes under full-suite load (passed 49/0
   in isolation). Timing-sensitive by design ("production tx path, committed fixtures"
   concurrent-cancel race). Carry-forward for Task 16: tolerate as a known load-sensitive
   probe or isolate it.

## 5. Carry-forward

- **Task 15 (GraphQL wire):** the service-level contract it must observe on the wire is
  fully pinned here — codes `PHONE_REQUIRED`/`PHONE_TOO_LONG`/`PHONE_INVALID`, exact
  localized templates (en+ar), `fields[0]`-mirrors-`error.message` first-entry contract,
  en AND ar threading. The `\u0024{phone}` escape remains the required literal form for
  injection fixtures in test sources (biome/oxlint collision).
- **Task 16 (final gate):** expect `registration.service.test.ts` 15/0 +
  `user-management.helpers.test.ts` 28/0 + helper suite 15/0 + logic suite 21/0 + journey 9/9
  green via the mandated runners; the two baseline issues in §4 are the only expected red
  noise in `test:services`/`test:services:sequential`; full-repo tsgo OOM persists — the
  scoped-tsgo + negative-control pattern remains the only valid type evidence.
- **Concurrent Task 15 activity observed** in this worktree (`frontend/graphql/test/auth/auth.test.ts`
  modified mid-window) — commit each task's files from its own wave.

## 6. Progress tracking

- [x] 14. Backend service validation tests (4-tier consolidation) — flipped ONLY the
  `- [ ] 14.` line in `tasks.md`; no other checkbox touched.
