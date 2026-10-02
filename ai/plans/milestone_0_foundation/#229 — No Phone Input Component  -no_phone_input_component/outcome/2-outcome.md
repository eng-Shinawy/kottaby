# Task 2 — Outcome: Shared schema 4-tier unit tests (`shared/lib/phone.test.ts`)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 2 — Shared schema 4-tier unit tests (REQ-1.4, REQ-6.1, REQ-9.3)
> **Date:** 2026-09-30 · **Pipeline:** 2.QL → 2.TE → 2.SEC → 2.SR → 2.IV — all executed; **2.TE is 47/48 GREEN with 1 RED that is a genuine module bug in `shared/lib/phone.ts` (cross-file dependency below) — the test file is correct-by-spec and must stay red until the Task-1 owner applies the one-line fix.**

## 1. Environment recovery (read first)

On dispatch, the working tree had been reset to `main` (`5a8369fe`) and **`shared/lib/phone.ts` — Task 1's deliverable — was absent** (no untracked copy, no stash, no dangling blob; `git status --porcelain` empty). The work was not lost: the orchestrator had already committed Tasks 1+3+8 as **`9a2b5bb2` on `feat/no-phone-input-component`** (reflog-verified: `commit: feat(shared): add E.164 phone schema, i18n keys, and reusable PhoneInput component`), then something moved HEAD back to `main` again (anomaly A1, third recurrence).

Since the test file cannot type-check or run without its import target, and git-write commands are forbidden to subagents, this task **restored `shared/lib/phone.ts` byte-exact from `9a2b5bb2`** (`git show 9a2b5bb2:shared/lib/phone.ts > shared/lib/phone.ts`, verified `diff`-identical, 55 lines). **Zero content changes were made to the module** — this is a working-tree restoration of an already-committed artifact, not an implementation edit. It is also load-bearing for the concurrently-running Task 5 subagent, whose `backend/services/shared/phone-validation.helpers.ts` imports `@/shared/lib/phone`.

Git-state guidance for the orchestrator is in §6.

## 2. Summary

Created `shared/lib/phone.test.ts` — bun:test, 4 explicit tiers, 48 tests / 1840 assertions, no render/DOM/DB/network, mirroring the structure of `shared/lib/email.test.ts` (tier `describe` blocks, house docblock, deep import `@/shared/lib/phone`, `@/` alias discipline). Imports are exactly `bun:test` + `@/shared/lib/phone`; no `console.*`; fully deterministic (seeded xorshift32, fixed seed `0x51c4b3`, fixed iteration counts, no wall-clock/locale).

| Tier | describe blocks | Tests | Covers |
|---|---|---|---|
| 1 — branch & statement | `phoneSchema` / `isValidPhone` / `normalizePhone` | 24 | all 4 schema arms with exact machine-code `message` assertions; all 8 behavioral branches of the predicate; both `normalizePhone` arms + every stripped char class |
| 2 — boundary values | length boundaries / non-ASCII scripts | 12 | `PHONE_MAX_LENGTH=16` valid vs 17 rejected; 8-digit floor vs 7; bare `+`; leading zero; Arabic-Indic (EC-10 fixture), extended Arabic-Indic, fullwidth digits; RLM/LRM/RLE/isolates; empty / `"   "` |
| 3 — fuzz & property | deterministic corpus (408 payloads: 8 anchors + 400 seeded, lengths 0–64, alphabet `0-9 + - ( ) space \t \n \r`) | 5 | never-throws + determinism; idempotency; predicate⇔schema agreement; validity-survives-canonicalization (converse deliberately not asserted — normalization may repair formatted input); `Promise.allSettled` over 408 concurrent parses |
| 4 — security & abuse | hostile payloads | 7 | 10k-char payloads; SQL/LIKE wildcards (`% _ \ ' OR 1=1 --`); null bytes + BEL; embedded `\r\n` (edge-only CRLF follows the trim rule, pinned explicitly); `+{1}` / `${phone}` / `+<script>`; machine-code-only error channel (no echo) |

Tier 3 property note (deliberate, documented in-code): the corpus asserts `isValidPhone(x) ⇔ phoneSchema.safeParse(x).success` and `isValidPhone(x) ⟹ isValidPhone(normalizePhone(x))` + canonical shape of the normalized output. The literal REQ-6.1 implication direction (`normalized-valid ⟹ raw-valid`) is **false by design** for this contract (EC-9: `" +20 (100) 123-4567 "` is `PHONE_TOO_LONG` raw but repairs to `"+201001234567"`) — the repair behavior is pinned explicitly in Tier 1 instead of asserting a vacuous/contradictory direction.

## 3. Files created / modified / NOT modified

| File | Action | Why |
|---|---|---|
| `shared/lib/phone.test.ts` | **CREATED** | The task deliverable (colocated 4-tier suite) |
| `shared/lib/phone.ts` | **RESTORED byte-exact from commit `9a2b5bb2`** | Environment recovery — Task 1 artifact lost from working tree (§1); `diff`-verified identical; NOT modified |
| `outcome/2-outcome.md` | **CREATED** | This file |
| `tasks.md` | Task-2 checkbox flip ONLY | Mandated; other agents' concurrent flips (4/5/9/…) untouched |
| `worklog.md` | Appended | Mandated |
| `shared/lib/phone.ts` content | **NOT modified** | Hard rule — the idempotency bug is reported, not patched (§5) |

## 4. Verification results

### 2.QL — Quality Loop: **exit 0**

`bun run scripts/health/sub-loop.ts shared/lib/phone.test.ts --lifecycle duplicates` → **exit 0, all five stages green** (tsgo → oxlint → biome:check → lint:type-aware → check:duplicates). Iteration history: first run failed at biome (`noTemplateCurlyInString` on the `"${phone}"` fixture), second at oxlint (`no-useless-concat` on the `"$" + "{phone}"` workaround) — resolved with an escaped template placeholder `` `\${phone}` `` (runtime value byte-identical, both linters clean, value re-verified at runtime).

**⚠️ Honesty note on the tsgo stage (A2 recurrence, confirms Task 3):** direct measurement in this window — `./node_modules/.bin/tsgo -b --noEmit` → **exit 137 (SIGKILL, OOM)** — so the sub-loop's "✅ tsgo passed" line is a **vacuous false pass** (killed process emits no diagnostics). **Real type-gate evidence via the documented scoped fallback** (Task 3's pattern, one new twist):

- Temp tsconfig at `/home/z/tsconfig.task2.json` (OUTSIDE the repo; deleted afterwards): `extends` root `tsconfig.json`, `incremental: false`, `typeRoots: ["/home/z/my-project/node_modules/@types"]` — **the `typeRoots` addition is required for any file importing `bun:test`**, because a config outside the repo cannot resolve the base config's `types: ["bun"]` entry (TS2688). `include` = `phone.test.ts` + `phone.ts`.
- `tsgo -p /home/z/tsconfig.task2.json --noEmit` → **exit 0, zero diagnostics** (bun:test + `@/` alias + zod types all resolve).
- **Negative control (gate-engagement proof):** same config + a scratch fixture mis-typing `PHONE_MAX_LENGTH` as `string` → `error TS2322: Type 'number' is not assignable to type 'string'`, exit 1 → the gate engages and the alias resolves, so the clean exit-0 is **non-vacuous** proof that the test file type-checks against the module. All scratch files deleted.

### 2.TE — Test Engineering: **47 pass / 1 fail (RED = module bug, §5)**

`bun run test/scripts/run-test.ts shared/lib/phone.test.ts` (mandated runner; never raw `bun test`) → **48 tests, 47 pass, 1 fail, 1840 expect() calls**. The single failure is the binding Tier-3 full-corpus idempotency assertion — a genuine `shared/lib/phone.ts` defect (cross-file dependency, §5), not a test defect. Sibling suites unaffected: `shared/lib/email.test.ts` → 19 pass / 0 fail.

**Coverage:** the mandated runner exposes no coverage flag (`--help` audited), so 100% branch/statement coverage of `shared/lib/phone.ts` is justified by enumeration:

| Module element | Branches / arms | Fixtures |
|---|---|---|
| `phoneSchema` min | `PHONE_REQUIRED` | `""`, `"   "`, `" \t\n "`, `"\r\n"` |
| `phoneSchema` max (fires **before** regex — asserted on a shape-failing 17-char input) | `PHONE_TOO_LONG` | `"20100123456789012"`, `"+2010012345678901"`, `"+1234567890123456"`, 10k-char payloads ×2 |
| `phoneSchema` regex | `PHONE_INVALID` | `"+20abc1234"`, `"+1234567"`, `"+"`, `"+0123456789"`, `"+1\n234"`, `"+٢٠١٠٠١٢٣٤٥٦"`, bidi fixtures, wildcard/null-byte/control/template fixtures |
| `phoneSchema` success | no issue, trimmed `data` | `"+201001234567"`, `" +201001234567 "`, `"\t+12345678\n"`, `"+123456789012345"`, `"+201001234567\r\n"` |
| `isValidPhone` (single delegation; behavioral branches) | true / false ×8 classes | valid E.164 ×3; empty; whitespace-only ×2; missing `+`; leading zero; too short; too long; non-digit body ×2 |
| `normalizePhone` ternary | collapse arm / passthrough arm | `"++20 100 123"`, `"+++20"`, `"+"` vs `"20100"`, `"20-100"`, `""` |
| `normalizePhone` strip set + trim | space / dash / paren / mixed / already-normal / outside-set preserved | `"  +201001234567  "`, `"+20 100 123"`, `"+20-100-123-4567"`, `"+20(100)1234567"`, `" +20 (100) 123-4567 "`, `"+201001234567"`, `"+1\t234"` |

Every statement and both conditional branches of the module execute under the suite; no unreachable path remains unexercised. `runInRollback`/`tx` N/A (pure unit, no DB); no render tier (repo has none).

### 2.SEC — Security & Tenancy Audit: **PASS**

- Tier 4 probes ARE the security artifact: 10k-char payloads, SQL/LIKE wildcards, null bytes/BEL, embedded CRLF, template-injection shapes — every one asserts rejection, `boolean`/`string`-only returns, and no throw.
- REQ-9.3 seed: the error channel is asserted to carry **only the three fixed machine codes** (`PHONE_REQUIRED`/`PHONE_TOO_LONG`/`PHONE_INVALID`) — a constant set, so nothing payload-shaped can be reflected; an explicit `code.includes(payload) === false` probe backs it. No test expects raw-input echo from the predicate (the predicate returns `boolean` — asserted via exact `toBe(false)` / `typeof` checks throughout).
- No trust decisions, no secrets, no I/O, no DB, no network — pure unit tier.
- Linter-collision gotcha for future hostile-payload authors: the `"${phone}"` fixture must be written as `` `\${phone}` `` — a plain string literal trips biome `noTemplateCurlyInString`, and a `"$" + "{phone}"` concat trips oxlint `no-useless-concat`. Likewise, `_` must stay out of "message never echoes payload" lists — `_` is itself a character of `PHONE_INVALID` (cost one test iteration here).

### 2.SR — Semantic Review: **PASS**

Deterministic: fixed xorshift32 seed `0x51c4b3`, fixed 400 iterations + 8 anchors, lengths `0..64`; no `Date.now`, no `Math.random`, no locale, no wall-clock (grep-verified: zero matches for `console.` / `Date.now` / `Math.random` / `toLocale` / `process.env` / plan-artifact strings in the test file). Imports exactly `bun:test` + `@/shared/lib/phone` (grep-verified). No `console.*`, no `oxlint-disable`, no barrels, no `any`, no skipped tests.

### 2.IV — Instruction Verification: **PASS**

The sub-loop printed for `shared/lib/phone.test.ts`: `.agents/instructions/tests.instructions.md` + root `AGENTS.md` — both read in full (plus `shared/AGENTS.md`), validated:

- `tests.instructions.md`: bun:test utilities ✓; never `any` ✓; no logging at all (stronger than the `testLogger` rule) ✓; mandated run-test script used, never raw `bun test` ✓; DB/`runInRollback`/GraphQL/RLS sections N/A (pure unit, no DB) ✓; no `oxlint-disable` ✓; helpers small (<70 lines) ✓; `bun tsgo` + lint run via the sub-loop ✓.
- Root `AGENTS.md`: `@/` alias deep import (mirrors the `isValidEmail` example) ✓; no `console.*` ✓; no barrel created ✓; no new deps ✓; never-add-oxlint-disable ✓.
- `shared/AGENTS.md`: layer isolation (no `@/frontend` / `@/backend` / `@/app`) ✓; `shared/lib/` = pure utilities ✓; `@/` alias, no relative imports ✓.

## 5. CROSS-FILE DEPENDENCY (blocks 2.TE full green)

```
CROSS-FILE DEPENDENCY:
  Target file:    shared/lib/phone.test.ts (this task)
  Blocked by:     shared/lib/phone.ts (Task 1 owner)
  Rule violated:  REQ-1.3 "Pure, deterministic, idempotent" + Task 2 Tier-3 binding item
                  ("fuzz … asserting … normalizePhone is idempotent")
  Evidence:       normalizePhone("2010\t- ") === "2010\t", but
                  normalizePhone("2010\t") === "2010"  ⇒ f(f(x)) ≠ f(x).
                  33 of the 408 mandated-alphabet corpus payloads are non-idempotent.
                  Root cause: `.trim()` runs BEFORE the `[ ()-]` strip, so stripping a
                  trailing dash/space/paren exposes a control char (tab/CR/LF) as a NEW
                  edge that no later trim removes; outputs can even START with
                  whitespace ("-\t2010" → "\t2010"). Task 1's 13-fixture idempotency
                  probe never hit the whitespace-then-strip-char ordering.
  Required fix:   re-trim AFTER the strip, e.g.
                  const stripped = value.replace(/[ ()-]/g, "").trim();
                  return stripped.startsWith("+") ? `+${stripped.replace(/^\++/, "")}` : stripped;
                  (one line; preserves every other verified behavior incl.
                  " +20 (100) 123-4567 " → "+201001234567", "+1\t234" unchanged,
                  "++20 100 123" → "+20100123"; makes output always-trimmed and
                  idempotent; phoneSchema untouched → Task 5's helper unaffected)
  Re-run after fix: bun run test/scripts/run-test.ts shared/lib/phone.test.ts → 48/48 expected
```

The red test is left red **on purpose**: it is the plan's own spec (REQ-1.3) speaking, and skipping/weakening it to manufacture green would fake the contract. Per the Fix-Or-Report rule, `phone.ts` was not modified.

## 6. Git-state guidance for the orchestrator (A1 third recurrence)

- HEAD is on `main` (`5a8369fe`); Tasks 1+3+8 are committed as `9a2b5bb2` on `feat/no-phone-input-component`.
- The working tree currently carries (beyond my two files + checkbox flip) concurrent artifacts from other subagents (Tasks 4/5/9/10: `test/workflows/auth/`, `backend/services/shared/phone-validation.helpers.{ts,test.ts}` + `backend/services/shared/index.ts` barrel edit, `frontend/stories/ui/PhoneInput.stories.tsx`, their outcome files and checkbox flips).
- `tasks.md` is tracked and **differs between main and the feature branch** (commit `9a2b5bb2` flipped 0/1/3/8) while the working copy is locally modified (4/5/9/2 flips) → a plain `git switch feat/no-phone-input-component` will refuse; stash around the switch (the Task-2 checkbox line is byte-identical in both versions, so the pop applies cleanly).
- `shared/lib/phone.ts` is untracked-but-identical to the feature branch's blob; if checkout complains about the untracked file, `rm shared/lib/phone.ts` first (the branch carries the identical 55 lines) — re-verify with `git show 9a2b5bb2:shared/lib/phone.ts | diff - shared/lib/phone.ts`.

## 7. Carry-forward

- **Task 5 (helper)**: no code impact (schema untouched), but the §5 fix must land before Task 14 — the consolidation suite inherits this file and the red will surface there. Note for the normalize-before-parse decision (EC-9): `normalizePhone` repairs formatted input, but **as currently shipped it is not idempotent and can emit non-trimmed output** — after the one-line fix both properties hold, making "normalize → validate → persist `data`" safe.
- **Task 14 (backend service validation tests)**: reuse the deterministic corpus recipe (seed `0x51c4b3`, xorshift32 shifts `13,7,17`, 400 iterations + anchors) for parity with this suite; keep hostile-payload assertions at fixed-machine-code membership.
- **Environment**: full-repo tsgo OOM reproduced again this window (direct exit 137; 4.1 GiB sandbox) — treat the sub-loop tsgo line as advisory; use the scoped temp-tsconfig pattern, and for test files add `typeRoots: ["<repo>/node_modules/@types"]` (needed wherever `bun:test` is imported; files without bun imports can keep Task 3's `types: []` form).
- **Test-authoring gotchas locked in**: `` `\${phone}` `` for injection fixtures (biome vs oxlint collision); `_` excluded from no-echo payload lists (underscore is a character of `PHONE_INVALID`).
- The REQ-6.1 implication direction is documented as deliberately one-sided (normalization may repair); future authors should not "fix" the test into asserting the false direction.
