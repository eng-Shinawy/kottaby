# Task 0 Outcome — Baseline & Ledger (REQ-0)

**Date**: 2026-09-18
**Branch**: `feat/admin-subscription-management` @ `c4971c6` (same commit as `origin/main`; branch was left un-checked-out after bootstrap — subagent switched to it before capture; no tree changes involved)
**Agent**: Phase 0 Baseline Subagent
**Method**: Pre-implementation capture only — **no source files modified** (verified by `git status` clean after all runs, including biome's internal `--write` pass).

---

## 1. Baseline counts (the ledger)

| Check | Command | Result | Artifact |
|---|---|---|---|
| **tsgo errors** | `bun tsgo` | **0 errors** (exit 0) | `/tmp/baseline-tsgo.txt` (count), `/tmp/baseline-tsgo-full.txt` (full output) |
| **biome warnings** | `bun biome:check` | **0 warnings** (exit 0; "Checked 2036 files in 13s. No fixes applied.") | `/tmp/baseline-biome.txt` (count), `/tmp/baseline-biome-full.txt` (full output) |
| **lint-service** | `bun run scripts/lint-service.ts --json --id baseline` | **success: true, exitCode 0** (full-repo scope, durationMs ≈ 119 899 ≈ 2 min, no LINT_BASELINE_FAILED marker) | `/tmp/baseline-lint.json`, `/tmp/baseline-lint-stderr.txt` (empty) |
| **git stash list** | `git stash list` | **empty** | `/tmp/baseline-stash.txt` |
| **git diff --name-only** | `git diff --name-only` | **empty** — zero modified tracked files, zero untracked files (`git status --porcelain` also empty) | `/tmp/baseline-files.txt` |

### tsgo verification detail (honesty note)

The scripted `bun tsgo` run exited 0 with no `error TS` lines. Because tsgo is build-incremental (`tsconfig.tsbuildinfo`, gitignored) and the native compiler is fast, the baseline was **re-verified with a forced from-scratch rebuild**: `bunx tsgo -b --noEmit --force` → exit 0, **0 errors, ~15.6 s wall** for the whole repo. The zero-error baseline is a genuine full-compile result, not a cache artifact. `/tmp/baseline-tsgo-full2.txt` and `/tmp/baseline-tsgo-force.txt` hold these verification runs.

### lint-service caveat (recorded honestly)

The JSON reports `"success": true, "exitCode": 0` for `--id baseline`, but with `"fileCount": 0` and empty `"output"`. That is the recorded baseline state (the lint queue server answered; no per-file findings were returned). Post-implementation comparison in task 11 must compare against this exact JSON shape — if a future run also returns `fileCount: 0`, the delta is still "no regressions observed by this tool" rather than "files were linted".

## 2. `deferred-items.md` existence check

✅ Confirmed present at plan root: `ai/plans/milestone_1_core_domain_mvp/Admin Subscription Management-admin-subscription-management/deferred-items.md` (git-tracked, committed in `Plans (#193)`). Ledger contents: 5 rows (D1 census, D2 page, D3 notification, D4 crosslane, D5 cancel-pending) — **all ✅**, zero `❌`/`⚠️`, satisfying the task-11 enforcement precondition at baseline time.

## 3. Pre-existing issues to ignore during post-implementation review

None found — the baseline is fully green (tsgo 0, biome 0 warn/0 error, lint success). Concretely:

- **No pre-existing `error TS` diagnostics** to whitelist in task 11's delta comparison; any error appearing after Phase 1+ is attributable to this feature's changes.
- **No pre-existing biome diagnostics** (no `warn` lines at all in `/tmp/baseline-biome-full.txt`; biome applied no fixes, so the run introduced no tree drift either).
- No stale stashes, no leftover modified files from environment bootstrap.

Environmental notes (not source issues, but observed during capture):

1. Session was left on branch `main` after bootstrap (worklog 0-env created the branch but the sandbox defaulted to `main`). Switched to `feat/admin-subscription-management` before capture; both point at `c4971c6`, so the baseline tree is identical either way.
2. `run-locked-cmd` imposes its own 5-minute internal timeout per locked command (scripts/lib/run-locked-cmd.ts:38) — tsgo/biome/lint all finished well inside it. The lint-service call took ~2 min of the 4-min outer `timeout 240` budget; it did not need the retry.

## 4. Environment state at baseline

- **PostgreSQL**: provisioned user-space 17.11 cluster (`/tmp/pgbin`, data dir `/tmp/pgdata`, unix socket `/tmp`, port 5432), database `app_db` created, schema pushed via drizzle-kit, seed applied (per worklog `0-env`).
- **`.env`**: present, gitignored, unmodified — `DB_PROVIDER=postgres`, `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/app_db`, encryption keys generated, admin credentials set, `SEED_PROFILE=minimal`. **Not touched** by this task.
- **Toolchain**: bun with 1164 installed packages; `tsgo` = `@typescript/native-preview` 7.0.0-dev; biome check clean over 2036 files; `.env`/`tsconfig.tsbuildinfo` gitignored so the tree stays clean.

## 5. Comparison protocol for task 11 (final gate)

1. Re-run the same three commands; compare `error TS` count (expect 0 → 0, or 0 → N with every N owned by a diff file), `warn` count, and lint JSON `success`/`exitCode`.
2. Delta triage: any new tsgo/biome diagnostic must map to a file changed by this plan's tasks; any unattributable delta blocks the gate.
3. Re-check `deferred-items.md` enforcement: `grep -c "❌\|⚠️"` must still be 0.

## REQ-0 acceptance trace

| AC | Evidence |
|---|---|
| REQ-0.1 baselines recorded to `/tmp/baseline-*` + this outcome file | §1 table (5 artifacts) + this document |
| REQ-0.2 `deferred-items.md` exists at plan root | §2 |
| REQ-0.4 outcome file written + checkbox flipped | this file + tasks.md task 0 now `[x]` |

_(REQ-0.3/0.5/0.6 are per-task obligations for the implementing agents of tasks 1–12, not this baseline task.)_
