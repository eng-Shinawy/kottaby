# Task 1 — Outcome: Shared Zod phone schema module (`shared/lib/phone.ts`)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 1 — Shared Zod phone schema module (REQ-1.1, REQ-1.2, REQ-1.3)
> **Date:** 2026-09-30 · **Pipeline:** 1.QL → 1.TE → 1.SEC → 1.SR → 1.IV — all executed, all pass

## 1. Summary

Created the first cross-layer phone contract as a flat sibling of `shared/lib/phone.ts` →
`shared/lib/email.ts`. The module exports exactly the five mandated symbols —
`PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH`, `phoneSchema`, `isValidPhone`, `normalizePhone` —
with a module docblock documenting the machine-code convention (`PHONE_REQUIRED` /
`PHONE_TOO_LONG` / `PHONE_INVALID` are codes, not user copy; producers translate). Only import
is the bare `zod` package — layer-pure, no i18n, no `@/frontend` / `@/backend` / `@/app`.

Implementation choices (spec-mandated):
- `isValidPhone` **delegates to `phoneSchema.safeParse(value).success`** — the acceptance
  criterion requires the schema as the single source of truth ("no duplicated regex"), which
  also guarantees predicate/schema parity by construction for the Task 2 property tier.
- `normalizePhone` trims, strips ASCII spaces/dashes/parentheses via one character class
  (`/[ ()-]/g`), and collapses any run of leading `+` to exactly one (`"++20 100"` → `"+20"`),
  never inventing a `+` and never prepending a country code. Interior `+` characters are
  preserved (the required strip set is exactly space/dash/parens).

## 2. Files created / modified / NOT modified

| File | Action | Why |
|---|---|---|
| `shared/lib/phone.ts` | **CREATED** | The task deliverable (flat file, no barrel — `shared/lib/` has none) |
| `shared/lib/phone.test.ts` | NOT created | Authored in Task 2 (colocated 4-tier suite) |
| `shared/lib/AGENTS.md` | NOT created | Does not exist in repo; no rule file to add here |
| everything else | NOT touched | Hard rule: only `phone.ts` + plan artifacts + worklog |

`git status --porcelain` after the task shows only: pre-existing Task-0 artifacts
(`tasks.md` M, `outcome/0-baseline-outcome.md` ??) **plus the new `shared/lib/phone.ts`**.

## 3. Verification results

### 1.QL — Quality Loop

`bun run scripts/health/sub-loop.ts shared/lib/phone.ts --lifecycle duplicates` → **exit 0, all
five stages green on the first run** (no fixes needed, no re-run):

| Stage | Result |
|---|---|
| tsgo (project-wide, filtered for `shared/lib/phone.ts`) | ✅ passed — **no OOM this run** |
| oxlint | ✅ passed |
| biome:check | ✅ passed |
| lint:type-aware (in-process service) | ✅ passed |
| check:duplicates (jscpd intra-file) | ✅ passed |

**No OOM fallback was needed.** Memory at start: ~3.0 GB available (dev server holding ~1.1 GB
of the 4.1 GB). The Task-0 anomaly A2 (tsgo OOM at ~2.9 GB RSS) did **not** reproduce — the
sub-loop's project-wide tsgo completed cleanly. Carry-forward: A2 is memory-pressure-dependent,
not deterministic; if a future QL run OOMs, the documented fallback is
`bunx tsgo --noEmit --ignoreConfig <file>` (not needed here).

### 1.TE — Exported surface (type-level via QL tsgo + runtime probe)

Verified verbatim against the task block: `PHONE_E164_PATTERN` is the literal RegExp
`/^\+[1-9]\d{7,14}$/` (`.global === false`, `lastIndex === 0`); `PHONE_MAX_LENGTH === 16`
(number); `phoneSchema` exposes working `safeParse`; `isValidPhone` / `normalizePhone` are
functions with the exact `(value: string) => boolean` / `(value: string) => string` signatures
(tsgo project-wide pass covers the type surface). Runtime spot-checks all agreed.

### 1.SEC — Security & tenancy audit (REQ-9.1 seed): PASS

- **No trust decisions**: pure shape predicate/normalizer; the module grants nothing — the
  server remains the trust boundary and consumers must still validate server-side.
- **No raw input echoed**: `isValidPhone` returns only `boolean`; `normalizePhone` returns only
  a transformed `string` built by deleting characters; there are no error paths, no throw
  (verified: `safeParse` never throws on any string incl. 10k chars, newlines, control chars).
- No I/O, no logging, no network, no DB, no globals, no module-level mutable state.

### 1.SR — Semantic review: 5/5 PASS

1. No cross-layer imports — sole import is `zod` (bare package). ✅
2. `PHONE_E164_PATTERN` module-level regex, **no `g` flag** → no `lastIndex` state leak
   (verified at runtime). ✅
3. `normalizePhone` idempotent — verified on 13 fixtures incl. edge cases
   (`""`, `"   "`, `"+"`, `" ++ 20 "`, `"++20 100 123"`, `"+2+0"`, `"+1\t234"`): all
   `normalizePhone(normalizePhone(x)) === normalizePhone(x)`. ✅
4. No dead branches — both ternary arms reachable (`"+"` → collapse arm; `"20100"` → passthrough). ✅
5. No `console.*`, no dead code. ✅

### 1.IV — Instruction verification

`sub-loop.ts` printed for `shared/lib/phone.ts`: **no applicable `.agents/instructions/*`
files** (no instruction pattern matches `shared/**/*.ts`) and **root `AGENTS.md`**. Read and
validated against:
- `/home/z/my-project/AGENTS.md` — no `console.*` ✅; no oxlint-disables ✅; no barrel created
  (deep-import surface only) ✅; `@/` alias n/a (no intra-project imports).
- `/home/z/my-project/shared/AGENTS.md` — layer isolation (never `@/frontend|@/backend|@/app`) ✅;
  `shared/lib/` = pure utilities with no layer deps ✅; import/barrel conventions ✅.
- `shared/lib/AGENTS.md` — **absent** (checked; only `shared/locale/AGENTS.md` exists).

## 4. Verified runtime behavior matrix (for Task 2's test authoring)

| Input | `phoneSchema.safeParse` | Code |
|---|---|---|
| `""` / `"   "` | fail | `PHONE_REQUIRED` |
| `" +201001234567 "` (edge whitespace only) | **success**, `data` = trimmed `"+201001234567"` | — |
| 17+ chars after trim | fail | `PHONE_TOO_LONG` (`.max` fires **before** `.regex`) |
| `"+20abc1234"` (shape fail, ≤16 chars) | fail | `PHONE_INVALID` |
| missing `+` / `+0…` / too short / newline inside | fail | `PHONE_INVALID` |
| `"+201001234567"` / `+` + 15 digits | success | — |

- `" +20 (100) 123-4567 "` raw → **fail** (`PHONE_TOO_LONG`, 19 chars): trim only strips edges;
  interior formatting chars remain. Spec EC-9's "valid" outcome holds **only when the producer
  calls `normalizePhone` first** → then `"+201001234567"` parses. Task 5's helper should decide
  explicitly whether it normalizes before parsing.
- `normalizePhone(" +20 (100) 123-4567 ")` → `"+201001234567"` (exact spec example) ✅;
  `"++20 100 123"` → `"+20100123"`; `"20-100"` → `"20100"` (no `+` invented);
  interior `+`/tab preserved (not in the mandated strip set).
- zod 4.6.2: `message` param works; machine code readable at `result.error.issues[0].message`.

## 5. Carry-forward knowledge

- **Task 2 (tests):** use §4 verbatim; property `isValidPhone(x) ⇔ phoneSchema.safeParse(x).success`
  holds by construction (delegation). Fuzz idempotency of `normalizePhone` is safe (verified);
  hostile inputs never throw.
- **Task 5 (backend helper):** map codes `PHONE_REQUIRED` / `PHONE_TOO_LONG` / `PHONE_INVALID`
  → localized text; decide on `normalizePhone`-before-parse for formatted input (EC-9);
  import from `@/shared/lib/phone`.
- **Tasks 6/7/10 (wiring + frontend):** consumers import `@/shared/lib/phone` directly
  (deep import; no barrel). `safeParse(...).data` is the **trimmed** value if persisted.
- **Environment:** sub-loop tsgo passed without OOM this run (~3 GB free) — A2 is conditional;
  keep the `bunx tsgo --noEmit --ignoreConfig <file>` fallback documented for OOM recurrences.
- **Branch anomaly A1 still open:** HEAD is on `main` (not `feat/no-phone-input-component`);
  checkout forbidden to subagents — orchestrator must `git switch` before Phase 1 commits
  (both branches at `5a8369fe`, so uncommitted working-tree changes carry over cleanly).

## Fix addendum (1-fix)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 1-fix — normalizePhone idempotency (fixes the cross-file dependency reported by Task 2, outcome/2-outcome.md §5)
> **Date:** 2026-09-30 · **Scope:** `shared/lib/phone.ts` ONLY (one function + its docblock); no checkbox changes — this is an addendum to the already-[x] Task 1.

### Bug

`normalizePhone` violated REQ-1.3's idempotency requirement: `normalizePhone(normalizePhone(x)) !== normalizePhone(x)` for 33/408 corpus payloads (Task 2's mandated fuzz corpus, seed `0x51c4b3`). Canonical repro: `normalizePhone("2010\t- ") === "2010\t"` but `normalizePhone("2010\t") === "2010"`. Outputs could even START with whitespace (`"-\t2010"` → `"\t2010"`). Caught by the binding Tier-3 idempotency test in `shared/lib/phone.test.ts` (suite was 47/48).

### Root cause

The implementation ran `.trim()` **before** the `[ ()-]` strip. Trimming first left interior-adjacent separators (`"…\t- "`), which the strip then deleted — exposing a control character (tab/CR/LF) as a NEW trailing/leading edge that no later trim removed. The second normalization pass trimmed that exposed edge, so pass 1 and pass 2 disagreed.

### Fix

Reordered one line (strip FIRST, then trim) + docblock updated to match:

```diff
-  const stripped = value.trim().replace(/[ ()-]/g, "");
+  const stripped = value.replace(/[ ()-]/g, "").trim();
```

Why this is idempotent for ALL inputs (proof sketch): after one pass, the output (a) contains no `[ ()-]` characters (strip removed all, and nothing reintroduces them), (b) is fully trimmed (the trim ran last on a string already free of separators, so stripping can never expose a fresh whitespace edge afterwards), and (c) starts with at most one `+` (the collapse ran after strip+trim and consumed the full leading run). Pass 2 therefore strips nothing, trims nothing, and collapses nothing — `f(f(x)) === f(x)` unconditionally. The `+`-collapse arm and the passthrough arm are unchanged; the only behavioral delta vs. the old code is exactly the defect class: outputs that previously could carry exposed edge whitespace are now fully trimmed. All other verified behaviors are preserved (spot-proven, §Verification below), including the exact REQ-1.3/EC-9 example `" +20 (100) 123-4567 "` → `"+201001234567"` and outside-set preservation (`"+1\t234"` unchanged).

Exported surface untouched: signature stays `(value: string) => string`; `phoneSchema`, `isValidPhone`, `PHONE_E164_PATTERN`, `PHONE_MAX_LENGTH` are byte-unchanged; module still imports only `zod`. Note on spec wording: REQ-1.3 lists "trim then strip" — the observable contract (no spaces/dashes/parens, trimmed, ≤1 leading `+`, no `+` invented, no country code added) is unchanged; the internal order is what makes the contract's own idempotency requirement (REQ-1.3 / Task 1 binding "Pure, deterministic, idempotent") actually hold.

### Verification results

1. **Mandated runner:** `bun run test/scripts/run-test.ts shared/lib/phone.test.ts` → **48 pass / 0 fail** (previously 47 pass / 1 fail; 2604 expect() calls — the full-corpus idempotency assertion now runs to completion, which is also why the assertion count rises from 1840). Baseline re-confirmed before the fix: 47/48 with exactly the Tier-3 idempotency test red. Sibling `shared/lib/email.test.ts` re-run: 19 pass / 0 fail (untouched, sanity only).
2. **Sub-loop:** `bun run scripts/health/sub-loop.ts shared/lib/phone.ts --lifecycle duplicates` → **exit 0**, oxlint / biome:check / lint:type-aware / check:duplicates all green. ⚠️ **Honesty note (A2 recurrence):** the sub-loop's project-wide tsgo stage is a **vacuous pass** this window — direct `./node_modules/.bin/tsgo -b --noEmit` → **exit 137 (SIGKILL/OOM)**, retried once → 137 again. Real type-gate evidence via the documented scoped fallback: temp tsconfig `/home/z/tsconfig.task1fix.json` (OUTSIDE the repo, deleted after) `extends`-ing the root config with `include: ["/home/z/feat-wt/shared/lib/phone.ts"]`, `incremental: false`, `typeRoots: ["/home/z/feat-wt/node_modules/@types"]` → `tsgo -p … --noEmit` → **exit 0, zero diagnostics**. **Negative control** (same config + a scratch fixture outside the repo mis-typing `normalizePhone`'s return and `PHONE_MAX_LENGTH`) → `TS2322 ×2`, **exit 1** → the scoped gate genuinely engages, so the clean exit-0 is non-vacuous. **Pattern refinement vs. outcome/2 §4 / outcome/3:** the temp config must override `include` (as Tasks 2/3/5 did) — a child `files` entry does NOT suppress the inherited base `include`, and the first attempt with `files` OOM-killed (137) because it type-checked the whole repo.
3. **Idempotency spot-proof** (scratch harness outside the repo, deleted after; imported the fixed module directly):
   - Reported payload class, explicit `f(f(x)) === f(x)`: `"2010\t- "` → `"2010"` ✓; `" +20 (100) 123-4567 "` → `"+201001234567"` ✓; `"--++20 100--"` → `"+20100"` ✓; plus `"-\t2010"` → `"2010"` ✓.
   - Full-corpus proof: the exact Task 2 corpus rebuilt (seed `0x51c4b3`, xorshift32 13/7/17, 400 iterations + 8 anchors) → **NEW: 0/408 idempotency failures, 0/408 determinism failures**; the OLD implementation re-implemented verbatim in the same harness reproduces **33/408 non-idempotent** — matching Task 2's report exactly (repro samples: `")\r +9 16)69929874267\n(1 17028\r) (767\r8\n\n\r-75647 9) 7 9"`, `"-\r0\n7+\r)756\t\n0"`, `"098-7 \r)"`).
   - 16/16 regression fixtures pass (both collapse/passthrough arms, every stripped char class, edge whitespace, `""`/`"   "`, `"+"`→`"+"`, `+++20`→`+20`, interior `+`/tab preserved).

### Cross-file impact

- **Task 5 (`backend/services/shared/phone-validation.helpers.ts`):** unaffected. Verified in-tree: the helper imports `phoneSchema` only and parses the wire value as-is; its docblock points to `normalizePhone` as the caller's concern. For callers that DO normalize first (the EC-9 flow), the normalize-then-validate semantics are now strictly safer: `normalizePhone` output is always trimmed and separator-free, so "normalize → validate → persist `data`" can no longer receive non-trimmed output (resolves the caveat recorded in outcome/2 §7).
- **Task 14 (backend service validation tests / consolidation):** inherits the FIXED file; the 47/48 red that would have surfaced there is resolved at the source. No test file was modified — the Tier-3 idempotency test passes legitimately, unweakened (still 408 payloads, same seed, same assertion).
- **No other exports, files, or checkboxes touched.** `git status` after the fix shows only `shared/lib/phone.ts` modified by this task (the concurrent Task 10 artifacts in the worktree are not mine).
