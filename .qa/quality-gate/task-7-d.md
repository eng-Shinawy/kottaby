# Task 7-d — scheduleWeek helpers quality fixes (lint lifecycle)

Assigned files (both owned by this task):
- A: `frontend/views/teacher/schedule/scheduleWeek.helpers.ts`
- B: `frontend/views/teacher/schedule/scheduleWeek.helpers.test.ts`

## Step 1 — Applicable rule files (from sub-loop discovery)

For A and B (both under `frontend/views/`):
- Instruction files: `.agents/instructions/frontend.instructions.md` (+ `.agents/instructions/tests.instructions.md` for the test file B)
- AGENTS.md files: `AGENTS.md` (root), `frontend/AGENTS.md`, `frontend/views/AGENTS.md`
- Pattern doc referenced by the gate: `docs/quality/linting-rules.md` — all read before fixing.

## Step 2 — Actual diagnostics at run time (ground truth via oxlint)

The task brief listed three items, but re-running `bunx oxlint --ignore-path .gitignore <file>`
against the current tree showed the live gates flag a different (partially overlapping) set.
Items 1 (`consistent-function-scoping`) and the key-union `no-unsafe-type-assertion` named in the
brief do NOT exist in the current snapshot — no nested non-capturing function and no `as`
assertion narrowing to `"dayColumnAria" | "dayCountLine" | ...` is present in either file
(likely already resolved by the prior commits `d58117f`/`a59df93` on these files). Everything the
gates currently report was fixed:

- A `unicorn(no-array-sort)` @ 121:35 — `[...buckets[index]].sort(cmp)` mutates-copy pattern.
- B `typescript(no-unsafe-type-assertion)` @ 66–88 — fixture built as a literal then
  `as unknown as ScheduleSession` (double assertion; oxlint: "type … is more narrow than the
  original type", caused by `sessionType: "Hifz"` — not a valid `SessionType`, so the literal
  was not assignable without the cast).

## Step 3 — Changes (only A and B touched)

A (`scheduleWeek.helpers.ts`, 1 line):
- `groupSessionsByWeekDay` bucket assembly: replaced
  `sessions: [...buckets[index]].sort(cmp)` with
  `sessions: buckets[index].toSorted(cmp)` — identical output (new sorted array, original
  bucket untouched), satisfies `unicorn/no-array-sort`. `lib: esnext` provides `toSorted`.

B (`scheduleWeek.helpers.test.ts`, fixture `makeSession` + imports + header comment):
- Removed the `as unknown as ScheduleSession` double assertion entirely by making the literal
  genuinely assignable: `sessionType: "Hifz"` (an invalid hard-coded string — "Hifz" is a
  `SessionIntent` value) → `sessionType: SessionType.StudentSession` (valid enum from the
  generated types, per tests.instructions.md "use valid enum values from generated types —
  never hardcode strings"). Import of `SessionType` added next to `SessionStatus`.
  The fixture covers all 21 fields of `MyTeacherSessionsQuery_myTeacherSessions_items`, so the
  return type checks directly — no cast, no type-guard needed.
- Header comment updated to stay truthful ("session literals typed against the generated item
  shape" — no longer "cast").

No oxlint-disable/eslint-disable comments added; `.jscpd.json` untouched; no other files
modified (the 3 other dirty files in `git status` were dirty before this task started and
belong to other subagents).

## Step 4 — Verification (all exit 0)

- `bunx oxlint --deny-warnings --ignore-path .gitignore` on A+B: 0 warnings, 0 errors.
- `bun tsgo`: no diagnostics for either file.
- `bun run scripts/health/sub-loop.ts frontend/views/teacher/schedule/scheduleWeek.helpers.ts
  --lifecycle lint` → tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware ✅ (exit 0).
- Same sub-loop for `scheduleWeek.helpers.test.ts` → all four stages ✅ (exit 0).
- No SIGKILL/exit-137 transient failures encountered.

## Step 5 — Behavior preserved

`bun run test/scripts/run-test.ts frontend/views/teacher/schedule/scheduleWeek.helpers.test.ts`
→ **17 pass, 0 fail, 35 expect() calls** — same case count as before the change (pure
type-level + non-mutating-sort changes; helpers' outputs byte-identical).

## Cross-file dependencies

None — both fixes were fully contained in the assigned files.
