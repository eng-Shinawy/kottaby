# Task 6 — Outcome: Wire the shared phone helper into registration

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 6 — Wire shared helper into registration — `backend/services/auth/registration.service.ts` (REQ-4.2, REQ-4.5, REQ-9.1, REQ-9.3, REQ-9.4, REQ-9.5)
> **Date:** 2026-09-30 · **Pipeline:** 6.QL → 6.TE → 6.SEC → 6.SR → 6.IV — all executed, all pass
> **Workspace:** stable linked worktree `/home/z/feat-wt` (branch `feat/no-phone-input-component`), concurrent Tasks 7/11/12/13 subagents active in the same tree (their files untouched by this task).

## 1. Summary

Replaced the hand-rolled phone check inside `RegistrationService.validateInput` with the
shared backend gate:

```ts
// before (:213-215)
if (!input.phone || input.phone.trim().length === 0) {
  entries.push({ field: "phone", code: "PHONE_REQUIRED", message: t.phoneRequired });
}
// after
const phoneError = validatePhoneField(input.phone, locale);
if (phoneError) {
  entries.push(phoneError);
}
```

- `validatePhoneField` is imported from the live barrel
  `@/backend/services/shared` (added to the EXISTING barrel import line — no deep path), so
  registration and admin (Task 7) compose the identical rule.
- `entries[0]` ordering is untouched: the phone slot stays between the email and password
  checks, so `throw new ValidationError(entries[0].message, entries)` (preserved verbatim)
  keeps the same first-failure message contract. Empty/whitespace values yield
  `PHONE_REQUIRED` exactly as before (the schema trims then applies `min(1)`); the NEW
  rejections are format (`PHONE_INVALID` → `authTranslations.phoneInvalid`) and the 16-char
  ceiling (`PHONE_TOO_LONG` → `errorsTranslations.validation`).
- `registerUser(input, locale, outerTx?)` (`:86`) and `createAdminUser(input, locale, outerTx?)`
  (`:140`) signatures unchanged — both funnel through `validateInput` and inherit the rule
  (asserted by tests for both entry points).
- Module docblock bullet 1 updated to say "phone E.164 via the shared backend validator".
  No other comment touched; no REQ/plan artifacts in code.

## 2. Anchor drift (recorded): the colocated test path

The task block (and hard rule) names `backend/services/auth/registration.service.test.ts` —
**no such file existed**; the plan author's "colocated test with runInRollback + tx
propagation + expectRepoError" description actually matches
`backend/db/test/logic/auth/registration.service.test.ts` (which is OUTSIDE this task's
allowed file list). Per `backend/services/AGENTS.md` ("service tests live next to the code
they cover, `*.test.ts` or `test/` subdirectories, run via `bun run test:services`") and the
sibling precedent `backend/services/auth/__tests__/registration-trial-provisioning.test.ts`
(a DB-touching service test that mirrors the `backend/db/test/AGENTS.md` house rules), the
mandated file was **CREATED at the exact task-named path**
`backend/services/auth/registration.service.test.ts` as the registration service's colocated
phone suite. The pre-existing `backend/db/test/logic` suite was NOT modified (it still passes
21/21 against the wired service — see §4).

## 3. Files modified

| File | Action | Why |
|---|---|---|
| `backend/services/auth/registration.service.ts` | **EDITED** (+14/−5) | Barrel import line + the phone block swap + docblock bullet. Nothing else. |
| `backend/services/auth/registration.service.test.ts` | **CREATED** (352 lines) | Colocated 4-tier phone suite at the task-named path (see §2). |
| everything else | NOT touched | Concurrent agents' files (`user-management.helpers.ts`, admin dialogs, tasks.md flips) belong to their own tasks. |

## 4. Verification results

### 6.QL — Quality Loop: **exit 0 on BOTH files**

`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`:

| File | tsgo | oxlint | biome | lint:type-aware | duplicates | Exit |
|---|---|---|---|---|---|---|
| `registration.service.ts` | ✅ | ✅ | ✅ | ✅ | ✅ | **0** |
| `registration.service.test.ts` | ✅ | ✅ (2 `no-await-in-loop` warnings fixed → `Promise.all` / single `inArray` probe) | ✅ | ✅ | ✅ (skipped — outside jscpd scan scope) | **0** |

**tsgo honesty note (A2 pattern):** dmesg shows FIVE `tsgo` OOM kills in this window
(`anon-rss:~2.9-3.0 GB`, uptime 7646-7775 s) from the concurrent subagents' sub-loops, so the
sub-loop's project-wide tsgo line cannot be treated as proof. **Non-vacuous scoped gate**
(documented fallback): temp tsconfig OUTSIDE the repo (`extends` root tsconfig,
`incremental: false`, `typeRoots` pinned into the repo's `node_modules/@types`, `include` =
exactly the two touched files) → `tsgo -p … --noEmit` → **exit 0, ZERO diagnostics** over the
full import closure (shared barrel, `@/shared/lib/phone`, locale bundles, drizzle, bun:test).
**Negative control** through the same config (scratch fixture mis-typing
`validatePhoneField`'s return AND argument) → `error TS2322` + `error TS2345`, **exit 1** ⇒
the gate engages and the aliases resolve, so the clean run is real type evidence. All scratch
files deleted.

### 6.TE — Test run (mandated runner, never raw `bun test`)

`bun run test/scripts/run-test.ts backend/services/auth/registration.service.test.ts`
→ **12 pass / 0 fail, 177 expect() calls** (re-run green after each iteration).

| Tier | Tests | Covers |
|---|---|---|
| 1 — outcomes through `validateInput` | 6 | `""` → exact `{field:"phone", code:"PHONE_REQUIRED", message:tAuth.phoneRequired}` entry; `"12345"` → `PHONE_INVALID` (`tAuth.phoneInvalid`); 17-char → `PHONE_TOO_LONG` (`tErrors.validation`) — each entry also mirrored by the top-level `error.message` (first-entry contract) and followed by an identity-scoped no-residual-row probe; valid E.164 registers and persists verbatim (`users.phone` read back through `tx`); a valid phone never contributes a `phone` entry even when an unrelated field fails (email-first ordering pinned); privileged `createAdminUser` inherits the gate. |
| 2 — boundaries | 4 | 16-char ceiling accepted (registered) vs 17-char rejected (`PHONE_TOO_LONG`) in one contrast test; empty → `PHONE_REQUIRED`; whitespace-only → `PHONE_REQUIRED` (trim-before-min); edge-whitespace around a valid value tolerated (EC-9 semantics). |
| 3 — concurrency | 1 | `Promise.allSettled` over a deterministic 11-payload hostile corpus (all three codes; `$\{phone\}` injection shape included via the `\u0024` escape) — every arm rejects at the gate (which runs BEFORE hash/tx, so arms never contend for the DB), each carries EXACTLY its own single-entry payload with its own code (no cross-arm pollution of `entries`), and one identity-scoped `inArray` probe proves zero leaked rows. |
| 4 — no-echo (REQ-9.3) | 1 | For every corpus payload: `fields[0].message` EQUALS the localized template for its machine code AND is a member of the three-template set; `not.toContain(payload)` on both the entry message and the top-level message (empty-string payload excluded from the substring probe — the empty string is a substring of everything); `field === "phone"`, `code` ∈ the three machine codes. |

House patterns honored: every test inside `runInRollback` with `tx` passed as the service's
`outerTx`; `expectRepoError` try/catch helper (NEVER `.rejects.toThrow()` inside the rollback
wrapper); expected templates sourced from `getServerTranslations("en")` at module scope
(English throughout — the helper's own Task-5 suite already covers the en/ar mapping matrix).
Documented deviation: `tests.instructions.md`'s "getServerTranslations hangs in tests" rule is
stale (sync static-bundle lookup since the locale rework) — directly precedented in
`backend/db/test/logic/auth/registration.service.test.ts:394` and the journey test `:103`, and
recorded the same way by Task 5. No mocking needed: the registration flow owns NO notification
dispatch (the journey's passthrough-spied zero-dispatch windows prove it) and rejection paths
throw before any I/O — there is no external channel to mock.

**Regression check (untouched siblings still green):**
`backend/db/test/logic/auth/registration.service.test.ts` → **21 pass / 0 fail**;
`backend/services/auth/__tests__/registration-trial-provisioning.test.ts` → **8 pass / 0 fail**.

### 6.SEC — Security & Tenancy Audit: PASS

- **REQ-9.1:** the suite drives the service boundary directly with crafted inputs (no client
  in the loop) — `"12345"`, 17-char, whitespace, and `${phone}`-shaped phones are ALL rejected
  with a `ValidationError` before any DB work, proving a client that bypasses the advisory
  frontend rule cannot persist an invalid phone.
- **REQ-9.3:** no raw input echoed — asserted per payload (Tier 4) and by construction: the
  pushed entry is the helper's fixed-template object; the service interpolates nothing.
- **REQ-9.4:** the only channel is `ApiFieldErrorType` inside `ValidationError.fields` (+
  `extensions.fields` mirroring in the existing boundary); top-level message is a localized
  template.
- **REQ-9.5:** the gate is a pure synchronous call inside `validateInput` — no DB read, no
  existence probe, no enumeration surface introduced.

### 6.SR — Semantic Review: PASS

| Item | Result |
|---|---|
| No duplicate phone check left inline | ✅ grep: zero `PHONE_REQUIRED`/`phoneRequired` refs remain in the service; the only `input.phone` reads are the helper call and the pre-existing BOPLA insert mapping |
| `entries[0]` ordering deterministic | ✅ check order unchanged (fullName → email → phone → password → country → role → gender); test pins email-first with the phone slot empty |
| No `console.*` | ✅ grep 0 (the sole match is pre-existing docblock prose) |
| No change to transaction semantics | ✅ diff is +14/−5: import line, phone block, docblock bullet; `withTransaction`/`outerTx` flow, signatures (`:86`, `:140`), throw site (`:244-246` region) untouched |
| `validatePhoneField` = single source of phone truth | ✅ imported via the `@/backend/services/shared` barrel (no deep path); no local constants/regex added |
| Comments clean (domain language only) | ✅ no REQ/Task/plan artifacts in code |

### 6.IV — Instruction Verification: PASS

Sub-loop printed and read for both files: `.agents/instructions/backend.instructions.md`,
`.agents/instructions/tests.instructions.md`, root `AGENTS.md`,
`backend/services/AGENTS.md`, `backend/AGENTS.md` (+ `backend/db/test/AGENTS.md` read as the
house-rule source the sibling service tests mirror). Validated: types from `@/backend/types`,
no service `.types.ts`, `getServerTranslations` discipline, no `oxlint-disable`, no
`console.*`, bun:test + mandated runner, `runInRollback`/`expectRepoError` discipline,
aggressive helper extraction, no seed-data queries.

## 5. Cross-file dependencies / carry-forward

- **Journey flips GREEN (Task 4 → this task):** with this wiring (and the concurrent Task 7
  helper wiring already present in the tree),
  `bun run test/scripts/run-test.ts test/workflows/auth/registration-phone.journey.test.ts`
  → **9 pass / 0 fail, 98 expect() calls** (was the documented 4-pass/5-fail test-first RED).
  Steps 2 (`"12345"` → `PHONE_INVALID`, no row) and 3 (17-char → `PHONE_TOO_LONG` +
  `errorsTranslations.validation` copy, no row) are THIS task's direct flips; steps 6/7/8
  flipped via the admin-side wiring owned by Task 7.
- **Task 14 (backend service validation consolidation):** reuse this suite's shapes — the
  four outcome tiers, the 16/17 contrast, the deterministic corpus
  (required ×2 / too-long ×4 / invalid ×5, `\u0024{phone}` escape for injection shapes), and
  the exact-template membership assertions. Service-level tests only need the
  through-the-service projections; the helper's own 15 tests own the mapping × locale matrix.
- **Task 15 (GraphQL wire):** `registerUser` rejections surface the helper's codes via
  `ValidationError.fields` → `extensions.fields`; `PHONE_INVALID` is produced by `"12345"`,
  `PHONE_TOO_LONG` by any 17-char value, `PHONE_REQUIRED` by `""`/whitespace. The top-level
  error message is always `fields[0].message` (asserted here per case).
- **Task 16 (final gate):** expect the registration logic suite (21), trial-provisioning (8),
  the new phone suite (12), the helper suite (15) and the journey (9) all green; the
  full-repo tsgo OOM persists — keep using the scoped-tsgo + negative-control pattern.
- **Environment:** concurrent Task 7/11/12/13 subagents were mutating `tasks.md` and admin
  files in the same worktree during this run; the Task 6 checkbox flip below is the ONLY line
  this task changed there.

## 6. Progress tracking

- [x] 6. Wire shared helper into registration — `backend/services/auth/registration.service.ts` — flipped in `tasks.md` (only the `- [ ] 6. …` line).
