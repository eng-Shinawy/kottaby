# Task 0 Outcome — Phase 0 Baseline & Ledger Check

> **Date:** 2026-09-27 · **Ticket:** `docs/planning/TICKETS.md:818-868` (T2-008 — Dev 2 · M1 · 5 SP)
> **Plan directory (verbatim):** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
> **Specs:** `specs.md` (REQ-001..REQ-011) · **Design:** `plan.md` · **Ledger:** `deferred-items.md` · **Task def:** `tasks.md` Phase 0
> **Requirement:** REQ-001 (Pre-Implementation Baseline & Execution Protocol)
> **Scope guard:** Task 0 modified ZERO source files; the `tasks.md` checkbox is left to the orchestrator.

---

## 1. Baseline command results (raw numbers + timestamps)

All commands ran from `/home/z/my-project` on a **clean tree** (see §2). Raw captures preserved under `/tmp/` for the post-implementation delta check (Task 8 / Task 9 compare against this file).

### 1.1 `bun tsgo` — typecheck

| Metric | Value |
|---|---|
| `grep "error TS" \| wc -l` → `/tmp/baseline-tsgo.txt` | **0** |
| Exit code | 0 |
| Window (UTC) | 2026-09-27T14:42:36+00:00 → 2026-09-27T14:42:55+00:00 (~19s) |
| Command | `bun tsgo` (= `restore-next-env.dts` + locked `tsgo -b --noEmit`) |

Raw tail (`/tmp/baseline-tsgo-raw.txt`, full output — no errors anywhere in it):

```text
$ bun run scripts/restore-next-env-dts.ts && bun run scripts/lib/run-locked-cmd.ts tsgo tsgo -b --noEmit
Restored next-env.d.ts to canonical dev dist dir (.next-dev).
[process-lock] Enqueued request for "tsgo" (PID: 2098)
[process-lock] Acquired lock for "tsgo" (PID: 2098). Executing...
[process-lock] Released lock for "tsgo" (PID: 2098)
```

**Baseline: 0 type errors.** The Task 8 gate "zero new tsgo errors vs baseline" therefore means **zero tsgo errors, period**.

### 1.2 `bun biome:check` — lint/format gate

| Metric | Value |
|---|---|
| `grep -c "warn"` → `/tmp/baseline-biome.txt` | **0** |
| Exit code | 0 |
| Window (UTC) | 2026-09-27T14:43:02+00:00 → 2026-09-27T14:43:20+00:00 (~18s) |
| Files checked | 2471 |
| Fixes applied by `--write --unsafe` | **None** ("No fixes applied" — repo was already biome-clean; git status re-verified empty after the run) |

Raw tail (`/tmp/baseline-biome-raw.txt`, full output):

```text
$ bun run scripts/lib/run-locked-cmd.ts biome:check bunx @biomejs/biome check --write --unsafe .
[process-lock] Enqueued request for "biome:check" (PID: 2144)
[process-lock] Acquired lock for "biome:check" (PID: 2144). Executing...
Checked 2471 files in 17s. No fixes applied.
[process-lock] Released lock for "biome:check" (PID: 2144)
```

**Baseline: 0 biome warnings; the tree is already format/lint-clean.**

### 1.3 `bun run scripts/lint-service.ts --json --id baseline` — type-aware lint service

| Metric | Value |
|---|---|
| Shell exit code | 0 |
| Window (UTC) | 2026-09-27T14:43:26+00:00 → 2026-09-27T14:45:53+00:00 (durationMs 147071) |
| JSON `success` | true |
| JSON `output` | `""` (empty = eslint reported ZERO issues) |
| JSON `exitCode` | 0 |
| JSON `metrics` | `{ id: "baseline", scope: "full-repo", fileCount: 0, queueDepthAtEnqueue: 0 }` |
| stderr (`/tmp/baseline-lint-stderr.txt`) | empty |

Artifacts: `/tmp/baseline-lint.json` (550 bytes; the leading `process-lock` lines are the locked-runner's stdout banner, then the JSON body), `/tmp/baseline-lint-stderr.txt` (0 bytes).

**Baseline: lint service CLEAN — `success=true`, exit 0, empty output (0 reported issues).** The `fileCount: 0` metric reflects the full-repo scope item's explicit file-list length (no per-file args passed), not an issue count; the issue count is the empty `output` + `exitCode: 0` (semantics verified against `scripts/lint-service.ts` — it surfaces eslint's combined stdout/stderr in `output` and its exit code verbatim).

### 1.4 Baseline artifact inventory (`/tmp/`)

| File | Content |
|---|---|
| `/tmp/baseline-tsgo.txt` | `0` |
| `/tmp/baseline-tsgo-raw.txt` / `-tail.txt` / `-meta.txt` | full raw output, tail, start/end timestamps + exit code |
| `/tmp/baseline-biome.txt` | `0` |
| `/tmp/baseline-biome-raw.txt` / `-tail.txt` / `-meta.txt` | full raw output, tail, start/end timestamps + exit code |
| `/tmp/baseline-lint.json` | the JSON result block (as quoted in §1.3) |
| `/tmp/baseline-lint-stderr.txt` | empty |
| `/tmp/baseline-lint-meta.txt` | start/end timestamps + shell exit code |
| `/tmp/baseline-stash.txt` | empty (no stashes) |
| `/tmp/baseline-files.txt` | empty (`git diff --name-only`) |
| `/tmp/baseline-status.txt` | empty (`git status --porcelain`) |

---

## 2. Git baseline

| Probe | Result |
|---|---|
| HEAD | `94160b9caf37a908567faa52bb9490fee8a369e3` |
| Checked-out branch | **`main`** (origin/main tip; the plan's branch `feat/cooldown_state_machine_1_month_tajweed_3_month_hifz` EXISTS locally but is **not** checked out — see note below) |
| `git stash list` → `/tmp/baseline-stash.txt` | empty — 0 stashes |
| `git diff --name-only` → `/tmp/baseline-files.txt` | **empty — ZERO files modified before implementation** |
| `git status --porcelain` → `/tmp/baseline-status.txt` | **empty — fully clean tree** |

**Note (environment-narrative correction):** the environment brief anticipated untracked `Caddyfile`/`.env` noise. Reality: the tree is *completely* clean. `Caddyfile` is a **tracked, committed** file (survives in the repo); `.env` and `.env.test` exist on disk but are **gitignored** (`.gitignore:59` — `.env*`), as are `worklog.md`, `tool-results/`, `.next/`, `.husky/_/`, `node_modules/`. So any post-implementation `git diff --name-only` delta is attributable to THIS plan's implementation alone — the cleanest possible attribution baseline.

**Branch note for the orchestrator/implementers:** the worklog (env-setup stage) recorded the feature branch as created, but HEAD currently sits on `main` at the same commit (94160b9, = origin/main). Both branches point at identical history, so the baseline is valid either way; implementation commits should land on `feat/cooldown_state_machine_1_month_tajweed_3_month_hifz` per the worklog's active-branch contract.

**Environment state (pre-implementation):** PostgreSQL 17 live at `127.0.0.1:5432/app_db` (schema pushed, seeded), `DB_MODE=postgres`, `.env` + `.env.test` present, deps installed (1164 packages). Nothing in the app tree differs from origin/main.

---

## 3. Pre-existing issues to ignore during post-implementation review

**None at the command level** — tsgo 0, biome 0, lint-service 0, clean tree. There is no baseline noise to filter; the Task 8/9 delta gates are absolute (any new error/warning/issue is attributable to this plan's diff).

Two recorded, non-actionable knowns (from `outcome/plan-review-R1.md` "Verified-accepted", carried here so no reviewer re-flags them):

1. **Stale repo-level docs (NOT code, NOT editable by this plan):** root `AGENTS.md` / the plan-review skill reference `@/frontend/utils/logger`, which does not exist on disk (real frontend logger is `@/frontend/lib/logger`), and `backend/services/AGENTS.md` shows a two-arg `getServerTranslations(locale, "<ns>")` while the real export is single-arg. Do not "fix" these as part of this plan; do not treat references to them as findings.
2. **`scripts/lint-service.ts --json` stdout banner:** the locked-runner prints `process-lock` lines before the JSON body on stdout (visible in `/tmp/baseline-lint.json`). This is expected runner behavior, not a defect; Task 8's `--id final` run will behave identically.

---

## 4. Deferred-items ledger understanding (D1..D5)

`deferred-items.md` read in full. **All five rows are 📋 — zero ❌, zero ⚠️. The plan is complete-able as authored.**

Enforcement grep executed at baseline (row-anchored regex from the ledger's Enforcement section, reused verbatim by Task 8):

```bash
grep -cE "^\| D[0-9]+ .*(❌|⚠️)" ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/deferred-items.md
# → 0  (exit 1: no matches — as expected)
```

| ID | Item | Status glyph | Reading |
|---|---|---|---|
| D1 | Failed applicant → `students` record conversion | 📋 Deferred-to-child-ticket | **Intentional child-ticket boundary, NOT a blocker.** Child ticket `Failed Applicant → Student Record Conversion` (`docs/planning/TICKETS.md:872-912`, Blocked By this ticket) owns the `students`-row creation. This plan only formalizes that cooldown must not block student privileges (REQ-010). |
| D2 | Admin override of evaluation results (FR-3.8: certify / reject / grant-re-evaluation) | 📋 Deferred-to-child-ticket | **Intentional child-ticket boundary, NOT a blocker.** Child ticket `Admin Override of Evaluation Results` (`docs/planning/TICKETS.md:916-958`) composes this ticket's primitive (`adminExtendApplicantCooldown` + `AuditActionType.Adjust`) into the override surface. |
| D3 | `users.suspended` login/session-class gating (INV-U2) | 📋 Deferred-by-design (two-source split) | Permanent architectural boundary, not a deferral to be "resolved": the `users.suspended` axis is owned by admin governance (`adminSetUserSuspended`), never by cooldown machinery — test-locked by REQ-006.5. |
| D4 | `SELECT … FOR UPDATE` for concurrent admin extensions | 📋 Deferred (5-SP scope) | Last-write-wins accepted for v1; the `Adjust` audit trail makes both racing writes observable. Future performance-hardening ticket (post-M1). |
| D5 | `cooldownState` pgEnum column on `applicants` | 📋 Deferred-by-design (D1) | `cooldownState` is a DERIVED read-model (pure compute from `cooldown_until` + captured `now`), never a stored second source of truth. Revisit only if a second writer that bypasses `cooldown_until` ever ships. |

Nothing here blocks implementation; D1/D2 are hand-offs (the ledger says so explicitly), D3/D5 are permanent boundaries, D4 is an accepted scope limit.

---

## 5. Two-source-split authority (REQ-006 binding context)

Source: `docs/teachers/applicant-lifecycle.md` — §2.3 (`:60-67`), §2.4 (`:69-71`), §7.3 (`:150-154`). This is the binding authority REQ-006 implements.

### §2.3 — Two-source split (login/session gating vs re-purchase gating)

Two disjoint concerns, two disjoint sources, two disjoint owners:

| Concern | Authoritative source | Owner |
|---|---|---|
| Login / session-class gating | `users.suspended` (+ the governance family on `users`) | The session/governance domain |
| Re-purchase gating (verification plan) | `applicants.cooldown_until` | The cooldown writer sets it; the lifecycle guard only READS it |

The lifecycle guard **writes neither source**. The failed-evaluation writer owns the cooldown write; the guard implements read semantics only (§2.1: strict `cooldown_until > now`, single captured `now` per invocation).

### §2.4 — Duration-agnostic guard

Whatever instant the failure/cooldown writer put into `cooldown_until` is honored **verbatim** by the reader. The 30-day (Tajweed) / 90-day (Hifz) minimums are a **write-time concern** of that writer; the guard carries zero duration knowledge. Recorded so the cooldown writer does not re-litigate the split. (For this plan: `resolveFinalizationCooldownUntil`/30·90 constants are consumed unchanged; `adminExtendApplicantCooldown` becomes an additional legitimate writer into the same `applicants.cooldown_until` home.)

### §7.3 — Workflow stage mapping + Vocabulary reconciliation (binding reading)

The invariant file's §2 *Cooldown_Tajweed / Cooldown_Hifz* schema-representation column (`users.suspended = true`, `suspended_period_days = 30|90`) is **draft-docs-era** vocabulary; the recorded decisions moved the lifecycle home to `applicants` (`cooldown_until`). The two-source split in §2.3 IS the binding reconciliation — no edit to the invariant file is required or made; that paragraph is the addendum-free reconciliation record (`applicant-lifecycle.md:154`).

### The rule cooldown machinery MUST NOT violate (what must never be written)

- **ZERO writes to `users.suspended`, `users.suspendedAt`, `users.suspendedPeriodDays`** — from any cooldown code path (rubric fail stamp, admin extension, future clearing). Cooldown lives ONLY in `applicants.cooldown_until`.
- **No clearing seam, no reactivation normalization, no suspension projection/stamping** — the dual-deny leftovers are void (see `outcome/00-research-evidence-pack.md` self-corrections).
- The sole writer of the `users` governance triple remains admin governance (`AdminUserRepository.setSuspendedOnce` via `setUserSuspended`/`setSuspendedAxis`).
- **Structural consequence:** an applicant in cooldown logs in, keeps sessions, and retains student privileges (INV-TV6, INV-U2 stays a `users`-governance concern); ONLY the verification-plan re-purchase is denied (`APPLICANT_COOLDOWN_ACTIVE`, 422).
- **Test lock:** journey step 2 asserts `users.suspended === false` (and the governance triple untouched) after the FAIL stamp (REQ-006.5); Task 8 enforces the grep proof (zero `suspended` matches in the new code outside the pre-existing `applicant-lifecycle.service.ts:18-20` documented-absence docblock).

---

## 6. Task 0 execution record

| REQ-001 AC | Status |
|---|---|
| AC1 baseline counts + `outcome/0-baseline-outcome.md` | ✅ (this file; §1) |
| AC2 `deferred-items.md` exists, seeded D1..D5 | ✅ (§4 — all 📋, 0 blockers) |
| AC3 read ALL `outcome/` files before starting | ✅ (00-research-evidence-pack.md, plan-review-R1.md, plan-review-R2.md read in full) |
| AC4..AC7 | Apply to subsequent tasks (protocol carried forward) |

- Source code touched: **none**. Generated artifacts touched: **none** (baseline commands are read-only for the tree; `biome --write --unsafe` reported "No fixes applied").
- `tasks.md` Task 0 checkbox: intentionally left `[ ]` — orchestrator owns Task 0 checkbox state.
- Worklog: not updated by this subagent (orchestrator handover policy).

**Hand-off to Phase 1:** baseline is a clean zero-zero-zero gate (tsgo 0 / biome 0 / lint 0) on a clean tree at `94160b9`. Every subsequent command's output can be attributed 1:1 to this plan's diff. Proceed to Task 1 (`ApplicantCooldownState` enum + types extension) after the orchestrator confirms branch checkout.
