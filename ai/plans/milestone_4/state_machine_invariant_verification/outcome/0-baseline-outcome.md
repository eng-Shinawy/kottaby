# Task 0.1 Outcome — Record baseline + confirm ledger

**Task:** `tasks.md` Phase 0, task 0.1 (REQ-000.1 baseline record + deferred-ledger confirmation)
**Date:** 2026-10-09 · **Agent:** task executor (Phase 0)
**Raw baseline record:** `outcome/phase0-baseline.md` (authoritative numbers; durable copies `/tmp/m4-smi-baseline/`)

## Summary

Recorded the pre-implementation baseline for every gate this plan will later compare against, and confirmed the deferred ledger. No source, schema, test, or docs outside this plan directory were touched; nothing was fixed — pre-existing failures ARE the baseline.

Key numbers: **tsgo 1 pre-existing error** (frontend `EditUserDialog.tsx(79,5)` TS2322, exit 1) · **biome 0 warnings / 0 errors** (exit 0; 1 info: schema-version 2.5.13 vs CLI 2.5.15; no fixes applied) · **ESLint full-repo exit 0** (`success: true`, no findings) · **stash 1 entry** · **dirty tree 7 entries at capture** · **ledger D-401..D-412 all `❌ Blocked`, glyph-grep count 12**.

Test suites: **test:services PASS** (89/89 files, 2283/2283 tests). **test:db FAIL** (bail-on-first-failure at 12/56 files; 1 failed file, 3 failed tests — `financial-immutability.test.ts` audit_logs trigger tier; triggers absent in the test DB). **test/workflows FAIL** (482 pass / 5 skip / 56 fail, 543 tests). **backend/graphql/test FAIL** (522 pass / 75 fail, 597 tests). All failure counts reproduced identically across a contended pass and a clean uncontended re-run — deterministic pre-existing reds, not flake.

## Commands run

```
bun tsgo                                        # exit 1; 1 "error TS" line
bun biome:check                                 # exit 0; 0 warn / 0 error; no fixes applied
bun run scripts/lint-service.ts --json --id baseline   # exit 0; success:true
git stash list / git diff --name-only / git status --porcelain
bun run test:db                                 # exit 1 (bail; FAIL)
bun run test:services                           # exit 0 (PASS)
bun run test/scripts/run-test.ts test/workflows # exit 1 (FAIL) — wrapper per tasks.md:60
bun run test/scripts/run-test.ts backend/graphql/test  # exit 1 (FAIL) — NOT test:graphql (tasks.md rule 4)
grep -c "❌\|⚠️" deferred-items.md              # 12
```

Suites were run twice: a first pass that overlapped an external `bun run test` (contention), then a clean sequential re-run after it finished — both preserved (clean: `/tmp/m4-smi-baseline/`, contended: `/tmp/m4-smi-baseline/contended/`).

## Results

| Gate | Baseline | Detail |
|---|---|---|
| tsgo | 1 error (exit 1) | `frontend/views/admin/users/dialogs/EditUserDialog.tsx(79,5)` TS2322 |
| biome | 0 warn / 0 err (exit 0) | 2739 files checked; `biome.json` schema 2.5.13 vs CLI 2.5.15 info |
| ESLint | exit 0 | full-repo, success:true, no findings |
| git stash | 1 | `stash@{0}: WIP on main: ede7a747 …` |
| dirty tree | 7 entries | 6 modified (auth/cookies, cron-auth, cron-endpoint, gqlContextFactory, ws handshake) + 1 untracked (`backend/lib/api/test/cron-auth.test.ts`) |
| test:db | **FAIL** | 12/56 files at bail; 11 pass / 1 fail files; 265 pass / 3 fail tests |
| test:services | **PASS** | 89/89 files; 2283 tests; 0 failed |
| test/workflows | **FAIL** | 482 pass / 5 skip / 56 fail; 543 tests / 54 files |
| backend/graphql/test | **FAIL** | 522 pass / 75 fail; 597 tests / 49 files |
| ledger | confirmed | D-401..D-412 present, all `❌ Blocked`; glyph-grep = 12 |

## Carry-forward knowledge for later tasks

1. **The repo is a shared workspace.** Sibling milestone-4 plan agents are executing concurrently (production_launch_checklist_execution, security_hardening, workflow_tests_student_journey, load_testing_performance). The dirty tree grew from 7 → 37 entries DURING this task (snapshot: `/tmp/m4-smi-baseline/status-at-baseline-completion.txt`), including `backend/db/repo/classes/session.repository.ts`, `backend/lib/ratelimit.ts`, frontend admin views, and an untracked `test/workflows/students/` dir. **Later reviews must treat all of this as pre-existing drift — never revert or "clean" it.** The 7 dirty-at-capture files above are the ones this plan's baseline started with.
2. **`/tmp/baseline-*` is a collision-prone shared namespace.** Sibling baseline tasks use identical filenames and overwrote four of this plan's captures mid-task. Canonical files were restored from captured values, but **tasks 5.2 and 7.x must read the durable copies in `/tmp/m4-smi-baseline/` or `outcome/phase0-baseline.md`** instead of trusting the shared paths.
3. **test:db red at baseline — task 3.5 directly extends this file.** `backend/db/test/logic/billing/financial-immutability.test.ts` has 3 failing tests in the audit_logs trigger tier: the audit_logs immutability triggers are absent/not-enforced in the migrate-provisioned Postgres test DB (the teacher_transaction/student_payments trigger tiers in the same file did not fail). Task 3.5's W5 extension targets `teacher_transaction` tamper cells (live guard `20260914064155_.../migration.sql:54-76`) — pre-existing audit_logs reds must not be attributed to this plan. Root-cause note for the task 3.5 agent: check whether the audit_logs trigger migration is applied to `kottaby_test` before extending; do NOT "fix" the failing tests (out of scope — test-writing plan, baseline is red).
4. **test:db runner semantics:** `run-db-tests-parallel.ts` bails on first failure — the "12/56 completed" number means 44 files were never exercised at baseline; per-file runs via `run-test.ts` (Phase 3 pipeline) remain the way to get file-level truth.
5. **Workflows red at baseline (56 fails).** Clusters overlap files this plan EXTENDS: applicant cooldown lifecycle (10), DEV2-007 evaluation rubric journey (4), Journey A admin lifecycle (14), account-governance ladder (2), journey harness smoke (2). Tasks 4.4/4.5/4.6 must diff against these pre-existing failures, not from zero. Full cluster table in `outcome/phase0-baseline.md` §3.3.
6. **backend/graphql/test red at baseline (75 fails).** Dominated by Lessons GraphQL Role-Matrix (46, pg-pool `Cannot use a pool after calling end on the pool`) and Plan Catalog suites (32 combined). Task 4.7 (A3 wire suite, `backend/graphql/test/teacher-availability.wire.test.ts`) lands in this already-red directory — the wire command discipline (`run-test.ts backend/graphql/test`, never `test:graphql`) is recorded and enforced.
7. **tsgo's 1 pre-existing error is in a frontend admin view**, not in any layer this plan touches. Phase 5/7 comparison target: still exactly 1, i.e., "no NEW errors".
8. **biome runs with `--write --unsafe`** via the npm script; at baseline it applied nothing. Re-running `bun biome:check` mid-plan could auto-format sibling agents' in-flight files — prefer scoped checks where possible and never commit unrelated auto-fixes.
9. **Plan-review line-cite drift is resolved:** the two files that caused it (`teacher-matching.query.ts`, `teacher.repository.test.ts`) are now clean in the tree; the corrected cites (`:81`, `:123-128`, `:2447`, `:2765/:2778/:2793`) are current.
10. **Ledger discipline confirmed:** D-401..D-412 all `❌ Blocked` with target tasks intact; glyphs only in Status cells; the Phase-7 grep currently returns 12 and must reach 0 by gate time.

## Cross-file dependencies discovered

- No in-repo code dependencies (this task wrote only plan artifacts and /tmp captures).
- Process-level dependency: the plan's baseline numbers in `/tmp/baseline-*` are unsafe to rely on long-term (sibling overwrite hazard, carry-forward #2). Tasks 5.2 and 7.x reference `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json` — they must use the durable copies instead.
- The migrate-provisioned test DB (`kottaby_test`) may be missing the audit_logs trigger migration (carry-forward #3) — if task 3.5 finds the trigger genuinely absent in DDL too, that is a candidate deferred-ledger row, not an in-plan migration (test-writing plan; schema/migrations out of scope).

## Checkbox

`tasks.md` task 0.1 flipped `[ ]` → `[x]` — no other line modified.
