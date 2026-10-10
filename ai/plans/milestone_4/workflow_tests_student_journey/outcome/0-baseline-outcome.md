# 0.1 — Baseline Outcome (Error Baseline & Deferred-Items Ledger)

**Plan:** `ai/plans/milestone_4/workflow_tests_student_journey` · **Task:** 0.1 · **Date:** 2026-10-09
**Capture point:** branch `feat/9_10_2026`, HEAD `c017d4f0`

## Summary

Error baseline captured and recorded below as the REQ-000 comparator for task 2.2's final gate. The pre-seeded deferred-items ledger (D1–D6) was verified intact: **5 ✅ resolved-pointer rows (D1, D2, D3, D4, D6) and 1 🔄 In Progress row (D5 → task 2.1)** — exactly the expected state per the task definition. No ledger row was modified. This task wrote no code; the working tree remains clean of plan-authored changes.

## Baseline numbers (comparator for task 2.2)

| Check | Result | Detail |
|---|---|---|
| tsgo | **1 pre-existing error** | `frontend/views/admin/users/dialogs/EditUserDialog.tsx(79,5): error TS2322: Type '"", "Female", "Male", "Other"' is not assignable to type '"", "Female", "Male"'` |
| biome:check | **PASS** (exit 0) | "Checked 2738 files… Found 1 info" — the info is a biome.json schema version mismatch (2.5.13 vs 2.5.15); zero warnings, zero errors |
| lint (full-repo, `lint-service --id baseline`) | **PASS** | `success: true`, exitCode 0 |
| git stash list | 1 entry | `stash@{0}: WIP on main: ede7a747 …` |
| `git diff --name-only` at capture | **EMPTY** | Working tree completely clean at baseline |

## Pre-existing issues to EXCLUDE from post-implementation review

1. **tsgo TS2322 in `frontend/views/admin/users/dialogs/EditUserDialog.tsx(79,5)`** — pre-existing before this plan; the plan is test-only and never touches `frontend/`. Any recurrence at the final gate is baseline carry-over, not a plan regression.
2. **Foreign in-flight agent work (concurrent session, NOT this plan).** While the baseline was captured, another agent session began modifying three files:
   - `backend/lib/auth/cookies.ts` (+99/−32, includes a new `extractCookieValue` refactor)
   - `backend/lib/auth/cookies.test.ts` (+42)
   - `backend/ws/notification-ws-server-handshake.ts` (4 lines)
   These are foreign in-flight changes. The post-implementation review must EXCLUDE them from this plan's diff scope, and any issues found in them must be logged as pre-existing/foreign — never blocking this plan.

## Git diff baseline

`git diff --name-only` at capture: **EMPTY — working tree completely clean.** The plan's diff scope at review time is therefore exactly: `test/workflows/students/student-full-journey.journey.test.ts` (tasks 1.1–1.7), the comment-only docblock fix in `test/workflows/helpers/journey-fixtures.ts` (task 2.1), and the `docs/testing/workflow-journey-tests.md` examples-list line (task 2.3), plus plan-outcome artifacts under `ai/plans/milestone_4/workflow_tests_student_journey/`.

## Deferred-items ledger verification

Verified against Task 0.1's definition ("ships with resolved-pointer rows D1–D6; do NOT re-create from template; confirm D5 is the only in-plan target"):

- D1 (CI wiring for `test/workflows`) — ✅ Done (deferred-pointer) — correct
- D2 (persisted recitation preference) — ✅ Done (deferred-pointer) — correct
- D3 (teacher accept/decline intake flow) — ✅ Done (deferred-pointer) — correct
- D4 (held-escrow dispute leg) — ✅ Done (deferred-pointer, covered by `session-state-machine.journey.test.ts:235-341`) — correct
- D5 (stale `linkStudentToParentFixture` docblock) — 🔄 In Progress, Target = Task 2.1 (the ONLY in-plan deferred item) — correct
- D6 (TICKETS.md Gherkin staleness) — ✅ Done (deferred-pointer) — correct

No ❌ or ⚠️ rows exist; the final-gate grep (`grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0) is currently satisfied. No row status was changed by this task.

## Carry-forward knowledge

- **This plan is TEST-ONLY**: ZERO production code, ZERO schema change, ZERO new helpers, ZERO UI, ZERO locale keys. The ONE non-test edit is the comment-only docblock fix in `test/workflows/helpers/journey-fixtures.ts:157` (task 2.1). Expected new-error count at the final gate: **none**.
- **Mandated test layer**: ALL test runs go through `bun run test/scripts/run-test.ts <test-path>` — raw `bun test` is FORBIDDEN for iteration (it skips the `.env.test` preload pinning `DATABASE_URL` to `kottaby_test`). This suite: `bun run test/scripts/run-test.ts test/workflows/students/student-full-journey.journey.test.ts`; whole layer: `bun run test/scripts/run-test.ts test/workflows`.
- **Single-file suite**: tasks 1.1–1.7 all land in ONE file, `test/workflows/students/student-full-journey.journey.test.ts` (~31 sequential steps), so they run strictly sequentially under the approved runner. Incremental-green strategy is binding: never land a red intermediate state.
- **0.2 Anchor Verification BLOCKS Phase 1** — every consumed anchor must be verified at its cited path:line before task 1.1 begins; drift → ledger row + blocked task, never inline-patch a foreign layer.
- Baseline artifacts from the capture (`/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json`) are the task-2.2 comparison inputs; the numbers are transcribed in this file in case `/tmp` is swept.

## Cross-file dependencies

None yet. (Task 2.1 will touch `test/workflows/helpers/journey-fixtures.ts` — comment-only — and task 2.3 will touch `docs/testing/workflow-journey-tests.md`; both are in-plan, no external coordination required.)

## Deviations

None. Baseline numbers were captured by a prior agent (tsgo/biome/lint NOT re-run per instructions); ledger verified read-only; this outcome file + the Task 0.1 checkbox are the only writes.
