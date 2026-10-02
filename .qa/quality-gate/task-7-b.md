# Task 7-b — HomeworkContainer quality fixes (lint stage)

## Task ID
`7-b` — quality gate lifecycle stage: `lint` (tsgo → oxlint → biome → lint:type-aware, strict order)

## Files changed / created

| File | Status | Role |
|---|---|---|
| `frontend/views/student/homework/HomeworkContainer.tsx` | modified (owned) | container + `HomeworkBody` branch matrix only |
| `frontend/views/student/homework/HomeworkBody.parts.tsx` | **created (owned)** | body chrome: `SummaryStrip`, `HomeworkListHeader`, `HomeworkPrintDialog`, `HomeworkSkeleton` |
| `frontend/views/student/homework/HomeworkRow.parts.tsx` | **created (owned)** | `HomeworkListBody` + `HomeworkRow` card pair |

No other existing file was modified (worktree shows other dirty files from parallel subagent tasks — untouched here). No CROSS-FILE DEPENDENCY reports: every fix fit inside the owned files.

## Rule discovery (STEP 1)
`bun run scripts/health/sub-loop.ts ... --lifecycle lint` listed: `.agents/instructions/frontend.instructions.md`, root `AGENTS.md`, `frontend/AGENTS.md`, `frontend/views/AGENTS.md` — all read; fixes comply (sx-only styling, theme-palette tokens, `*Outlined` icons, no `any`, deep `@/` imports, parts-file convention per `HomeworkTab.parts.tsx` / `SearchFilterBar.parts.tsx` precedents).

## Per-rule fixes (STEP 4)
1. **eslint(max-lines-per-function) — `HomeworkBody` 126 counted lines (max 100)** — the two cohesive chrome blocks of `HomeworkBody` were extracted into the new sibling parts file `HomeworkBody.parts.tsx`:
   - `HomeworkListHeader` — settled-list heading + print/export toggle (typed props: `labels: HomeworkLabels`, `onPrintOpenChange: (open: boolean) => void`; no `any`).
   - `HomeworkPrintDialog` — namespace-copy wrapper over the shared `PrintExportDialog` (`rows: readonly PrintableRow[]`).
   `HomeworkBody` prop plumbing was also reduced 19 → 8 typed props by letting it own its translation/locale hooks and the print state (see behavior notes). `HomeworkBody` now passes the 100-line function cap.
2. **eslint(max-lines) — file 429 counted lines (cap 150 for `frontend/views/**`)** — moved the presentation chrome out: `SummaryStrip`, `HomeworkSkeleton`, `HomeworkListHeader`, `HomeworkPrintDialog` → `HomeworkBody.parts.tsx`; `HomeworkListBody` + `HomeworkRow` → `HomeworkRow.parts.tsx`. Two parts files were required by arithmetic: the file had 429 counted (code-only; oxlint counts skip blanks+comments) lines, and 150 (container) + 150 (one parts file) = 300 < 429, so a single parts file could never hold the remainder. Within `SummaryStrip` the card descriptors were compacted to `as const` tuples (identical labels/values/icons/aria/toggle per bucket) to keep the parts file under its own 150 cap. Container is now ~148 counted lines.
3. **react(set-state-in-effect)** — **not present / nothing to fix.** The pre-fix oxlint run reported exactly 2 errors (`max-lines`, `max-lines-per-function`); grep confirms there is no `useEffect` (and no effect-driven `setState`) anywhere in the target file, so no cascading-render sync existed to restructure. No conditions were added; behavior untouched.

## Behavior-identity notes
- `printOpen` state + `printableRows` memo moved from `HomeworkContainer` into `HomeworkBody`: both are consumed only by the settled branch (print button + dialog live there), and `HomeworkBody` is never remounted across branch swaps, so state lifetime is unchanged.
- `HomeworkBody` now calls `useAppTranslation(Homework/Errors/Common)` + `useAppLocale()` directly — same context values the container read; rendered output identical.
- Moved components (`SummaryStrip`, `HomeworkListBody`, `HomeworkRow`, `HomeworkSkeleton`) are verbatim except the tuple compaction noted above; all `data-testid`s, aria attributes, and branch conditions unchanged.
- `useMemo` dependency arrays unchanged (`[rows, statusFilter, searchQuery, locale]`, `[rows, locale]`).

## Verification (STEP 5)

| Check | Result |
|---|---|
| `bunx oxlint --ignore-path .gitignore` (3 files) | 0 warnings, 0 errors |
| sub-loop `HomeworkContainer.tsx --lifecycle lint` | tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware ✅ — **exit 0** |
| sub-loop `HomeworkBody.parts.tsx --lifecycle lint` | tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware ✅ — **exit 0** |
| sub-loop `HomeworkRow.parts.tsx --lifecycle lint` | tsgo ✅ oxlint ✅ biome:check ✅ lint:type-aware ✅ — **exit 0** |

No SIGKILL/exit-137 transient failures encountered. Full-repo `bun run lint` / `bun tsgo` were not run (per instructions).

## Prohibitions
No `oxlint-disable`/`eslint-disable` comments added; `.jscpd.json` untouched, no `jscpd:ignore`; no tests run; no dev servers started; `worklog.md` untouched.
