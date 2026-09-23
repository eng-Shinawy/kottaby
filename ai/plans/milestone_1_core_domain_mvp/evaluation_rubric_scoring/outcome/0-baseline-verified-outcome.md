# Task 0 — Baseline Verification Outcome — Evaluation Rubric Scoring (≥80% Threshold)

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Ticket:** DEV2-007, Milestone 1
**Task:** 0 — Verify the existing baseline (counts were recorded at plan time in `outcome/0-baseline-outcome.md`; this task RE-VERIFIES, it does not re-capture from scratch)
**Date:** 2026-09-21
**Executed from:** repo root `/home/z/my-project`

---

## Verification Note

- `outcome/0-baseline-outcome.md` exists and records: tsgo = **0** `error TS` lines, biome = **0** `warn` lines, lint-service = **success: true, exitCode: 0** (full-repo clean). Zero pre-existing errors of any kind.
- `deferred-items.md` carries the D1–D4 ledger from specs §11 (D1 suspension-state writes, D2 failed-applicant→student conversion, D3 admin override surfaces, D4 `average_rating` recompute + admin-ordered re-evaluation) — all rows present with target-ticket pointers.
- `outcome/plan-review-R1.md` verdict: gate PASSED (0 blocking findings; 6 non-blocking findings, all fixed in-session). Already flipped forward — this task does not touch Task 1.5's checkbox.
- The `/tmp/baseline-*` files from plan time did not exist in this fresh sandbox (expected). Fresh artifacts were re-saved during this verification for later phases: `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json` (plus raw `/tmp/baseline-tsgo-raw.txt`, `/tmp/baseline-biome-raw.txt`).
- The authoritative comparison is against the counts RECORDED in `outcome/0-baseline-outcome.md`.

---

## Re-Run Counts vs Recorded Counts

All commands run from repo root `/home/z/my-project` with Bun.

| # | Command | Recorded (plan time) | Re-run (this task) | Match | Evidence |
|---|---|---|---|---|---|
| 1 | `bun tsgo 2>&1 \| grep "error TS" \| wc -l` | 0 | **0** | ✅ MATCH | fresh artifact `/tmp/baseline-tsgo.txt` = `0` |
| 2 | `bun biome:check 2>&1 \| grep -c "warn"` | 0 | **0** | ✅ MATCH | fresh artifact `/tmp/baseline-biome.txt` = `0` (grep exit 1 on zero matches tolerated via `\|\| true`; count is the authoritative number) |
| 3 | `bun run scripts/lint-service.ts --json --id baseline` | success: true, exitCode: 0 (clean) | **success: true, exitCode: 0** (ESLint `output: ""`) | ✅ MATCH | fresh artifact `/tmp/baseline-lint.json`; durationMs 140604 (cold cache in fresh sandbox vs ~6.7s warm at plan time — result identical: clean) |

**New pre-existing errors above baseline: NONE.** Every count equals the recorded baseline. Any error/warning/lint failure observed in Task 2+ is by definition NEW and must be fixed by the task that introduced it (per `outcome/0-baseline-outcome.md` attribution rule).

Notes:
- `biome:check` auto-writes fixes (`--write --unsafe`) as the repo's own script behavior (documented as acceptable in the task driver). `git status --short` after the run is empty — biome modified nothing (tree was already clean/conformant).
- tsgo/biome/lint were near-instant-to-slow purely on cache state; counts are unaffected and remain valid read-only measurements.

---

## Environment State (verified)

| Check | Expected | Observed | Status |
|---|---|---|---|
| `.env` exists | yes | exists | ✅ |
| `.env` `DB_PROVIDER` | `postgres` | `DB_PROVIDER=postgres` (`.env:1`) | ✅ |
| `.env` `DATABASE_URL` | `postgresql://z@127.0.0.1:5432/kottaby_db` | exact match (`.env:2`) | ✅ |
| PostgreSQL on 127.0.0.1:5432 | running | `/tmp/pg-root/usr/lib/postgresql/17/bin/psql -h 127.0.0.1 -U postgres -tAc "SELECT 1"` → `1`, exit 0 (server 17.11) | ✅ |
| `.env.test` exists, points at kottaby_test | yes | `DB_PROVIDER=postgres` + `DATABASE_URL=postgresql://z@127.0.0.1:5432/kottaby_test` | ✅ |
| Database `kottaby_db` exists | yes | listed in `pg_database` | ✅ |
| `kottaby_db` tables (public schema) | 0 expected at this point | `count = 0` | ✅ expected-empty — schema push is Task 2 scope; **NOT pushed now** |
| Database `kottaby_test` exists | yes | listed in `pg_database` | ✅ |

---

## Git Baseline

Run from `/home/z/my-project`:

```
$ git rev-parse --abbrev-ref HEAD
main

$ git diff --name-only
(empty — exit 0, no output)

$ git stash list
(empty — exit 0, no output)

$ git status --short
(empty — fully clean tree, no modified and no untracked files)

$ git check-ignore -v .env .env.test
.gitignore:59:.env*	.env
.gitignore:59:.env*	.env.test
```

Tree is clean apart from `.env` / `.env.test`, which are gitignored (`.gitignore:59` `.env*`) — matching the expectation.

Observations (non-blocking, no action taken):
- Sandbox branch is `main` (plan-time baseline recorded branch `plans`); the working tree content is identical for baseline purposes (counts and cleanliness match exactly).
- tasks.md layer-table AGENTS.md paths carry the plan-time absolute prefix (`/home/ahmed/Projects/kottaby_kottaby/...`); rule files resolve equivalently in this sandbox under `/home/z/my-project/`. Noted for path normalization awareness; no artifact edited for this.

---

## Files Created/Modified

| File | Action | Why |
|---|---|---|
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/outcome/0-baseline-verified-outcome.md` | CREATED | this verification record (task deliverable) |
| `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/tasks.md` | EDITED | checkbox `- [ ] 0.` → `- [x] 0.` only |

**No source code touched. No db push run. No other checkbox flipped.**

---

## Carry-Forward for Task 2+

- Baseline is **zero-error across tsgo / biome / lint**; attribution rule: anything observed later is new → fix in the introducing task.
- Fresh baseline artifacts live at `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json`.
- `kottaby_db` is EMPTY (0 public tables) — Task 2 runs `bun run db push` and must inspect the DDL diff before applying (expect exactly CREATE TYPE + ADD COLUMN).
- D1–D4 absorbed: this plan owns only `applicants.status` + `applicants.cooldown_until`; no `users.suspended*`, no `students` rows, no admin surfaces, no re-evaluation loop.
