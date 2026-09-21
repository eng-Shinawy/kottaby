# Task 7-e — Fix parity test assertions (3 files, lint lifecycle)

- **Agent task ID:** 7-e
- **Files owned:**
  - A: `shared/locale/upNext-namespace.parity.test.ts`
  - B: `shared/locale/schedule-namespace.parity.test.ts`
  - C: `shared/locale/homework-namespace.parity.test.ts`
- **Lifecycle stage:** lint (tsgo → oxlint → biome → lint, strict order)

## STEP 1 — Applicable Rule Files (discovered via sub-loop)

All three sub-loops reported the identical set:

- Instruction file: `.agents/instructions/tests.instructions.md`
- AGENTS.md: root `AGENTS.md` (no additional shared/-level AGENTS.md listed by the sub-loop; `shared/locale/AGENTS.md` and `docs/quality/linting-rules.md` were also read as context — the latter is the canonical lint recipe doc referenced by the rule output)

## STEP 2/3 — Findings (exact, from `bunx oxlint --ignore-path .gitignore <file>`)

`typescript(no-unsafe-type-assertion)` — 2 findings per file (12 total across 3 files… actually 2 per file), all in the
`function-valued keys agree on argument arity across locales` test, all from the same root cause:
`Object.entries(<NS>_FUNCTION_KEYS)` yields `key: string`, then `key as keyof typeof <NS>_FUNCTION_KEYS`
narrows `string` to a literal union:

- A: `upNext-…:102:23`, `103:23` → cast to `'"homeworkPendingLine" | "sessionLine"'`
- B: `schedule-…:106:25`, `107:25` → cast to `'"dayColumnAria" | "dayCountLine" | "sessionChipAria" | "weekRangeLabel"'`
- C: `homework-…:114:25`, `115:25` → cast to `'"countLine" | "sessionLine"'`

## STEP 4 — Fix applied (sanctioned pattern 2 from the task + docs/quality/linting-rules.md)

Replaced the unsafe `as` narrowing with a **typed const array capturing `keyof typeof`**, validated by
`satisfies` (no assertion involved):

```ts
/** Iteration order for `UPNEXT_FUNCTION_KEYS` — `keyof typeof` captured in a typed const array. */
const UPNEXT_FUNCTION_KEY_LIST = ["sessionLine", "homeworkPendingLine"] as const satisfies ReadonlyArray<
  keyof typeof UPNEXT_FUNCTION_KEYS
>;

test("function-valued keys agree on argument arity across locales", () => {
  for (const key of UPNEXT_FUNCTION_KEY_LIST) {
    expect(upNextEn[key]).toHaveLength(UPNEXT_FUNCTION_KEYS[key]);
    expect(upNextAr[key]).toHaveLength(UPNEXT_FUNCTION_KEYS[key]);
  }
});
```

Analogous `<NS>_FUNCTION_KEY_LIST` constants added in B (`weekRangeLabel`, `dayColumnAria`, `dayCountLine`,
`sessionChipAria` — same order as the object) and C (`sessionLine`, `countLine`). Arity values are read from
the existing `<NS>_FUNCTION_KEYS` const objects, which remain the source of truth.

### Behavior preserved

- Same keys checked, same iteration order (list mirrors object property order), same `toHaveLength(arity)`
  assertions on the same `en`/`ar` leaves — no assertion added, removed, weakened, or skipped.
- Post-fix expect() counts match the pre-fix expectations exactly: A = 66, B = 98, C = 117
  (verified arithmetically against the untouched assertions and confirmed by the run-test output).

## STEP 5 — Verification (sub-loops, all exit 0)

```text
bun run scripts/health/sub-loop.ts shared/locale/upNext-namespace.parity.test.ts --lifecycle lint
  ✅ tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware — All checks passed (exit 0)
bun run scripts/health/sub-loop.ts shared/locale/schedule-namespace.parity.test.ts --lifecycle lint
  ✅ tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware — All checks passed (exit 0)
bun run scripts/health/sub-loop.ts shared/locale/homework-namespace.parity.test.ts --lifecycle lint
  ✅ tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware — All checks passed (exit 0)
```

No SIGKILL/exit-137 transient failures encountered; no retries needed.

## STEP 6 — Behavior preserved (test runs via run-test script)

```text
bun run test/scripts/run-test.ts shared/locale/upNext-namespace.parity.test.ts     → 20 pass / 0 fail / 66 expect()
bun run test/scripts/run-test.ts shared/locale/schedule-namespace.parity.test.ts  → 25 pass / 0 fail / 98 expect()
bun run test/scripts/run-test.ts shared/locale/homework-namespace.parity.test.ts  → 32 pass / 0 fail / 117 expect()
```

Case counts unchanged (20 / 25 / 32), all passing.

## Prohibition compliance

- No `oxlint-disable` / `eslint-disable` comments added.
- `.jscpd.json` untouched.
- No files modified other than the three assigned targets (git diff confirms my changes are confined to the
  three parity test files; other dirty files in the worktree are pre-existing changes from other tasks and were
  left untouched).

## Cross-file dependencies

None — all findings were fully fixable within the three assigned files.
