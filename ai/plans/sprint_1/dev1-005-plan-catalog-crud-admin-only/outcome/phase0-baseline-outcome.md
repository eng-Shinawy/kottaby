# Task 0.1 Outcome — Error Baseline Recording & Deferred-Items Ledger Initialization

**Task ID:** 0.1 · **Plan:** `dev1-005-plan-catalog-crud-admin-only` · **Date:** 2026-08-26
**Purpose:** Verbatim pre-implementation baseline (REQ-001, REQ-083) so Phase 7 final-delta check can compare machine-readable numbers against this record.

---

## 1. Baseline Numbers (verbatim)

| Check | Command | Baseline Result |
|---|---|---|
| TypeScript (tsgo) | `bun run tsgo` | **0** errors (`grep "error TS" \| wc -l` → `0`) |
| Biome | `bun run biome:check` | **0** warn lines; `Checked 504 files in 6s. No fixes applied.` |
| Full-repo ESLint | `bun run scripts/lint-service.ts --json --id baseline` | **exitCode 1, success:false, output:""** → recorded as **lint-baseline-unavailable** (see §2) |
| Working tree | `git diff --name-only` | **empty** (clean tree; no stash entries; no untracked files) |

**Artifact paths (session /tmp — numbers are durably re-recorded verbatim in this file):**
- `/tmp/baseline-tsgo.txt` (count), `/tmp/baseline-tsgo-full.txt` (full tsgo output, 5 lines: restore-next-env-dts + process-lock wrapper lines, no diagnostics)
- `/tmp/baseline-biome-tail.txt` (tail 30), `/tmp/baseline-biome.txt` (warn count)
- `/tmp/baseline-lint.json` (lint-service JSON)
- `/tmp/baseline-files.txt` (pre-biome diff), `/tmp/baseline-files-after-biome.txt` (post-biome diff), `/tmp/baseline-stash.txt`

## 2. Lint Baseline: FAIL with empty diagnostics (pre-existing)

- `bun run scripts/lint-service.ts --json --id baseline` returned `{"success": false, "output": "", "exitCode": 1, "metrics": {"id": "baseline", "scope": "full-repo", "fileCount": 0, "durationMs": 49289}}`.
- Cross-check `bun run lint` (same lint-service): identical result — exit code 1, **zero diagnostic lines** on stdout/stderr (only process-lock wrapper lines).
- **Status: lint-baseline-unavailable** — the service fails pre-existing at baseline and emits no error text, so no per-rule error inventory can be captured. Per AGENTS.md exit-code semantics (0 = clean, 1 = lint errors, 2 = config/usage), this is a pre-existing repo state, **not** caused by this task (tree was clean before the run).
- Phase 7 comparison must use **exitCode parity** (baseline `1`) and diagnostic presence, not rule counts, for ESLint.

## 3. Git-Diff Baseline

- Pre-biome `git diff --name-only`: **empty** (no modified tracked files; `git status --porcelain` clean; no stashes).
- The only working-tree modification existing **after** Task 0.1 is `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` — intentional, from the ledger initialization in §5 (Task 0.1.2). All other tracked files untouched.

## 4. Biome Mutation Check

- `biome:check` wraps `biome check --write --unsafe .` (confirmed in run output) — mutation risk was real, so ordering was respected: diff captured **before** biome ran.
- Result: **"No fixes applied"** over 504 files; post-biome `git diff --name-only` empty.
- **Biome did NOT mutate any files; no `git checkout -- .` restore was required.**

## 5. Deferred-Items Ledger State

- File: `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/deferred-items.md` — **structure matches template** (`.agents/spec-process-guide/templates/deferred-items-template.md`): Purpose section, Ledger Table with columns `ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes`, and the 4-status legend (✅ Done / ⚠️ Partial / ❌ Blocked / 🔄 In Progress).
- **Discrepancy found & resolved:** the orchestrator session had created the file with valid structure but an **empty table** — the D1/D2 rows were NOT actually present. Per Task 0.1.2, the ledger was initialized with **exactly** the two sanctioned entries (no other entries added; no blockers found at baseline):
  - **D1** — Audit-log integration for plan mutations → **DEV3-020** (❌ marker, notes: non-blocking sanctioned deferral; hook points only in this ticket)
  - **D2** — Purchase-time active-plan re-validation (`is_active = true` inside purchase transaction) → **DEV1-006** (❌ marker, notes: non-blocking forward contract; this ticket ships the predicate)
- Also corrected the header **Plan Directory** path to the real location (`ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/`).
- Pre-seeded D1/D2 content preserved (nothing deleted; statuses/notes per protocol §7 — D1/D2 are the only sanctioned non-blocking entries at close).

## 6. Pre-Existing Issues to Ignore During Post-Implementation Review

1. **Full-repo ESLint exit code 1 with empty diagnostics** (§2) — pre-existing; do not attribute to DEV1-005 changes; compare exitCode only.
2. **No recurring error-code patterns exist**: tsgo reports 0 errors and biome 0 warnings, so there is no TS/biome error inventory to exempt. Every TS/biome error appearing after implementation is attributable to this plan's work and must be fixed (not ignored).

## 7. DB / Environment State (verified read-only)

- `.env`: `DB_PROVIDER=postgres`, `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/app_db`, `CACHE_PROVIDER=memory`, `ADMIN_EMAIL=admin@app.local`.
- PostgreSQL **17** reachable at **127.0.0.1:5432** (socket dir `/tmp`); database **app_db** contains **22 public tables** including `plans` and `audit_logs` → schema **pushed**; seed completed per orchestrator session (Task 0 log). Probe was read-only (`\dt` + information_schema counts; no writes).
- ⚠️ Session reminder: sandbox may reset `.env` between sessions — re-verify before test runs (per Task 0 stage summary).

## 8. Deviations

- None from the baseline command sequence. One corrective action beyond pure capture: the D1/D2 ledger rows were missing despite being reported as "pre-seeded"; they were added exactly per Task 0.1.2 definition (see §5). This is recorded rather than silently passed over.

## 9. Deferred-Items Implications

- D1/D2 initialized at baseline (source task 0.1); no new blockers discovered during baseline capture. Downstream tasks (0.2.6, implementation tasks) must not remove or alter D1/D2 semantics.
