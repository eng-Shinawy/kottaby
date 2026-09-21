# Phase-0 Baseline Outcome — Evaluation Rubric Scoring (≥80% Threshold)

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`  
**Ticket:** DEV2-007, Milestone 1  
**Branch:** `plans`  
**Date:** 2026-09-21

---

## Purpose

This file records the pre-implementation baseline quality measurements for the repo on branch `plans` BEFORE any task in this plan touches code. All later task outcomes MUST attribute any tsgo / biome / lint errors they observe against these baselines: counts at or below these numbers are pre-existing (not caused by the task); counts above must be justified as new and fixed by the task that introduced them.

---

## Baseline Commands and Recorded Counts

All commands run from repo root with Bun (`~/.bun/bin/bun`). No caches were cleared; no fix/auto-fix variants were run.

| # | Command | Recorded Count | Wall-clock | Raw Artifact |
|---|---|---|---|---|
| 1 | `bun tsgo 2>&1 \| grep -c "error TS" \| tee /tmp/baseline-tsgo.txt` | **0** error TS lines | ~0.6s (incremental cache warm) | `/tmp/baseline-tsgo.txt` |
| 2 | `bun biome:check 2>&1 \| grep -c "warn" \| tee /tmp/baseline-biome.txt` | **0** warn lines | ~3.0s | `/tmp/baseline-biome.txt` |
| 3 | `bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json` (full-repo, in-process serialized service) | **success: true, exitCode: 0** — full-repo lint clean (ESLint output empty apart from a benign concurrency notice) | ~6.7s (durationMs 6640; ESLint cache warm) | `/tmp/baseline-lint.json` |

Notes:
- `grep -c` exits 1 on zero matches; counts of 0 were captured via the `tee`'d output with the pipeline guarded (`|| true`) so `0` is still recorded as a number in the artifact.
- tsgo and biome completed nearly instantly because their caches were already warm from prior runs on this branch; the counts are still valid read-only measurements of the current tree.

---

## Pre-existing vs New Errors

**There are zero pre-existing errors of any kind on this baseline.** tsgo reports 0 `error TS` lines, biome reports 0 `warn` lines, and the full-repo lint service exits 0 with no lint findings. Therefore any error, warning, or lint failure observed during any later task in this plan is by definition **new** and must be fixed by the task that introduced it — no error can be excused as "pre-existing" against this baseline.

---

## Scope-Boundary Deferrals (D1–D4) — Mandatory Read

Executing agents MUST absorb these boundaries during mandatory pre-execution reads (see `deferred-items.md` in this plan directory):

- **D1 — Suspension-state writes:** `users.suspended` / `suspended_at` / `suspended_period_days` writes on evaluation FAIL are deferred to the "Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)" ticket (`docs/planning/TICKETS.md:818+`, which is Blocked By DEV2-007). This plan owns ONLY `applicants.status='failed'` plus `applicants.cooldown_until`.
- **D2 — Failed-applicant → student conversion:** `students` record creation for failed applicants and any `users.role` flip are deferred to DEV2-009 "Failed Applicant → Student Record Conversion" (`docs/planning/TICKETS.md:872+`, Blocked By the Cooldown State Machine). That ticket owns conversion semantics — handshake code generation, zeroed balances, role decision; DEV2-006 already recorded this boundary.
- **D3 — Admin override surfaces:** Admin visibility/override surfaces over rubric results are deferred to the "Admin Override of Evaluation Results" ticket (`docs/planning/TICKETS.md:916+`).
- **D4 — Re-evaluation sessions:** Admin-ordered re-evaluation (`session_type='re_evaluation'`) is deferred to the Milestone-3 re-evaluation ticket; the enum value exists but is out of scope here.

Any task tempted to implement these must instead log/update the ledger row in `deferred-items.md` — never write the deferred behavior itself.
