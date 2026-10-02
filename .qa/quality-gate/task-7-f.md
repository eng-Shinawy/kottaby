# Task 7-f — Fix seed paid-flow warnings (lint lifecycle)

- **Target file**: `backend/db/seeds/parents/seed-demo-paid-flow.ts`
- **Lifecycle**: lint (tsgo → oxlint → biome:check → lint:type-aware)
- **Result**: ✅ `bun run scripts/health/sub-loop.ts backend/db/seeds/parents/seed-demo-paid-flow.ts --lifecycle lint` → exit 0 (all four stages pass)

## STEP 1 — Applicable rule files (from sub-loop discovery)

- `.agents/instructions/backend.instructions.md` (read)
- `AGENTS.md` (root — read)
- `backend/db/seeds/AGENTS.md` (read)
- `backend/AGENTS.md` (read)

Key constraints honored: seeds never import `@/backend/db/**`, enums come from `@/backend/enum/**`, canonical types from `@/backend/types`, no `oxlint-disable` comments anywhere, no cross-file edits.

## STEP 4 — Fixes applied (single file only)

### 1. unicorn(no-array-sort) — line 129
- `.sort(...)` on the lane-backed catalog list → `.toSorted(...)` (non-mutating). Comparator kept byte-identical: `(a, b) => Number(a.price) - Number(b.price) || a.id - b.id`.
- Note: the task brief said ×2, but `bunx oxlint` on the current HEAD listed exactly one occurrence (only one `.sort(` exists in the file — verified by grep). The pipeline is the source of truth; after the fix oxlint reports 0 warnings.

### 2. typescript(no-unsafe-enum-comparison) ×4 — lines 194, 198, 232, 235
- Root cause: `ACTIVE_SUBSCRIPTION_STATUS` / `PENDING_SUBSCRIPTION_STATUS` were annotated `: string` while `SubscriptionReturnType["status"]` is the `SubscriptionStatus` enum → enum-vs-string comparison.
- Fix (cleanest option, no `as` casts, no `String()` fallback needed): typed the constants as the enum, using the source already imported in the file (line 10, `@/backend/enum/billing/subscription-status.enum`):
  ```ts
  const ACTIVE_SUBSCRIPTION_STATUS: SubscriptionStatus = SubscriptionStatus.Active;
  const PENDING_SUBSCRIPTION_STATUS: SubscriptionStatus = SubscriptionStatus.Pending;
  ```
- `COMPLETED_STATUS` (SessionStatus) intentionally left `: string` — it is compared against demo session rows whose status is a widened string union, so oxlint never flags it; its doc comment was updated to singular to stay accurate.
- Doc comments updated: the constants are no longer "widened the same way"; they stay enum members so both comparison sides share one vocabulary.

### 3. typescript(consistent-return) — `walkSequentially`'s inner `step` (SUPERSEDED by shared-helper extraction)
- ⚠️ Record accuracy note (autofix round 2): when this record was written, `walkSequentially` was a LOCAL helper of `seed-demo-paid-flow.ts` and its `step` closure was changed to return explicitly (`return;` → `return undefined;`, plus an explicit `return undefined;` after the recursive `await step();`).
- The later shared-helper extraction moved `walkSequentially` into `backend/db/seeds/lib/demo-session-reconcilers.ts`, and the extracted shared implementation does NOT carry those explicit returns — its `step` keeps the single bare `return;` on the exhausted-queue path. The extraction SUPERSEDED the local change described below; the imported shared implementation is the source of truth, and all lint stages (tsgo/oxlint/biome/ESLint) pass against it as-is.
- Original record (for history): per the task instruction and the sub-loop's documented fix pattern ("use `return undefined` instead of bare `return`"), every code path of the then-local `step` returned explicitly; behavior identical (`Promise<void>` async arrow), no lint stage objected.

## STEP 5 — Verification

- `bunx oxlint --ignore-path .gitignore backend/db/seeds/parents/seed-demo-paid-flow.ts` → **0 warnings, 0 errors** (was 5 warnings: 1× no-array-sort, 4× no-unsafe-enum-comparison).
- `bun run scripts/health/sub-loop.ts ... --lifecycle lint` → tsgo ✅ / oxlint ✅ / biome:check ✅ / lint:type-aware ✅, **exit 0**.
- No SIGKILL/exit-137 transient failures encountered (one early run died on PGlite init before the lock was acquired; clean re-run passed — unrelated to lint).
- Prohibitions respected: no disable comments, `.jscpd.json` untouched, no other files modified, seed/tests not executed.

## Cross-file dependencies

None — everything was fixable within the target file.
