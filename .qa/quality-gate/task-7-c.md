# Task 7-c — homework.helpers.test.ts (lint lifecycle)

## Target
`frontend/views/student/homework/homework.helpers.test.ts` — pure-math unit tier for the student
homework summary strip (bun:test, no DB / network / React).

## Applicable rule files (read before fixing, per sub-loop discovery)
- `.agents/instructions/tests.instructions.md`
- `.agents/instructions/frontend.instructions.md`
- `AGENTS.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md`

## Findings (initial `bunx oxlint --deny-warnings --ignore-path .gitignore <file>`)
1. `unicorn/consistent-function-scoping` × 2 — `anyDate` (line 142) and `noDate` (line 143)
   declared inside the `filterHomeworkByQuery` describe block without capturing anything from it.
2. `max-lines` — measured the file at task start: 185 raw lines = **142 counted lines**
   (skipBlankLines + skipComments), i.e. under the 150 `frontend/views/**` cap, but with only 8
   lines of headroom; the task mandated consolidation regardless. ESLint (`eslint.config.mjs`)
   has no max-lines rule; oxlint is the only size gate.

## Fixes (this file only — no other file touched, no disable comments)
1. **consistent-function-scoping**: hoisted `const anyDate = () => true` and
   `const noDate = () => false` to module scope (grouped under a shared doc comment, next to the
   `row` factory).
2. **Scaffolding consolidation (coverage preserved — all 23 `test()` cases kept)**:
   - Extracted the duplicated 3-row fixture (`[row(1,92,88), row(2,null,null), row(3,null,81)]`)
     that was re-declared in both the status-filter and query-filter describes into one module-level
     `mixedRows` builder (distinct name avoids shadowing the per-test `rows` locals).
   - Hoisted the identical `const summary = computeHomeworkSummary(rows)` recomputation from the
     graded-arm/pending-arm tests to describe scope.
   - Net effect: counted lines 142 → **140** (raw 185 → 186, delta is doc comments which are not
     counted); removes the remaining cross-describe repetition without merging/dropping any case
     (STEP 6 requires the same number of test cases, so table-driven merging was deliberately NOT
     applied — the file is already under the counted-lines limit).

## Verification
- `bun run scripts/health/sub-loop.ts frontend/views/student/homework/homework.helpers.test.ts --lifecycle lint`
  → **exit 0**: tsgo ✅, oxlint ✅ (0 warnings/0 errors), biome:check ✅, lint:type-aware ✅.
  (One transient lock wait behind another sub-loop was observed; no SIGKILL/137 occurred.)
- `bun run test/scripts/run-test.ts frontend/views/student/homework/homework.helpers.test.ts`
  → **23 pass, 0 fail, 39 expect() calls** — identical test-case count to the pre-fix baseline
  (23), so no coverage was dropped.

## Cross-file dependencies
None. Everything was fixable within the target file.

## Prohibitions honored
No `oxlint-disable`/`eslint-disable` comments added; `.jscpd.json` untouched; no other file
modified; `worklog.md` untouched.
