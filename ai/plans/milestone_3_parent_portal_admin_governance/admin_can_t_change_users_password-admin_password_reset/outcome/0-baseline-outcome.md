# Task 0 Outcome — Baseline Capture & Outcome Ledger

> **Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
> **Task:** `0. Baseline capture + outcome ledger + deferred-items.md confirmation` (Phase 0)
> **Date:** 2026-09-30 · **Agent:** general-purpose subagent · **Repo root used:** `/home/z/my-project` (plan docs cite the author's machine `/home/ahmed/Projects/kottaby_kottaby/`; all paths here are relative to the repo root and translate 1:1)
> **Source files modified by this task: NONE** (baseline is read-only; only this outcome file, the `tasks.md` Task 0 checkboxes, and the `worklog.md` append were written)

## 1. Baseline Counts (the numbers Task 14 compares against)

| Check | Baseline value | Tool exit | Detail |
|---|---|---|---|
| `bun tsgo` — lines matching `"error TS"` | **0** (`/tmp/baseline-tsgo.txt` → `0`) | 0 (see §1.1 for attempt 1) | Clean type check; zero errors, zero output from the inner `tsgo -b --noEmit` |
| `bun biome:check` — lines matching `"warn"` | **0** (`/tmp/baseline-biome.txt` → `0`) | 0 | `Checked 2516 files in 15s. No fixes applied.` — repo is biome-clean, so the script's `--write --unsafe` wrote NOTHING (verified: `git diff --name-only` unchanged after the run) |
| `bun run scripts/lint-service.ts --json --id baseline` | **success: true, exitCode: 0, output: ""** → **0 issues at any severity** (`/tmp/baseline-lint.json`) | 0 (CLI) / 0 (JSON `exitCode`) | full-repo scope, `durationMs: 145871` (~2 min 26 s) |
| `git stash list` | **empty** (`/tmp/baseline-stash.txt`) | 0 | No stashes |
| `git diff --name-only` | **1 pre-existing file: `Caddyfile`** (`/tmp/baseline-files.txt`) | 0 | Modified, unstaged, pre-dates this task (see §3) |

**Lint JSON summary verbatim** (banner lines precede the JSON — see §6 quirks):

```json
{
  "success": true,
  "output": "",
  "exitCode": 0,
  "metrics": { "id": "baseline", "scope": "full-repo", "fileCount": 0, "durationMs": 145871, "queueDepthAtEnqueue": 0 }
}
```

### 1.1 Honest failure note — first `bun tsgo` attempt exited 1 (silently), re-run clean

- Attempt 1 of the prescribed pipeline exited with the **tool** at code 1 while emitting **no diagnostics** (no `error TS` lines; 6 lines total: restore-next-env banner, process-lock acquire/release, bun's `error: script "tsgo" exited with code 1`). Not silently swallowed — investigated before proceeding.
- Diagnosis: `scripts/lib/run-locked-cmd.ts` (the `tsgo` script wrapper) reports `result.status ?? 1` and prints nothing for a signal-killed child (e.g. transient OOM) — the 5-minute timeout message was NOT triggered, and the lock was acquired/released normally.
- Cross-check: direct `./node_modules/.bin/tsgo -b --noEmit` → **exit 0, zero output** (clean).
- Re-run of the exact prescribed command → **tool exit 0, count 0**. That successful re-run is the recorded baseline (`/tmp/baseline-tsgo.txt` = `0`). **Rule for Task 14:** if `bun tsgo` ever exits 1 with no diagnostics, re-run before treating it as a regression signal.

## 2. Exact commands used (all from `/home/z/my-project`)

```bash
# 1. tsgo (prescribed pipeline + tee for full-output forensics + tool exit via PIPESTATUS)
bun tsgo 2>&1 | tee /tmp/baseline-tsgo-full2.txt | grep -c "error TS" > /tmp/baseline-tsgo.txt; echo "tsgo_tool_exit=${PIPESTATUS[0]}"
#    attempt 1 (transient silent exit 1, retained at /tmp/baseline-tsgo-full.txt):
bun tsgo 2>&1 | tee /tmp/baseline-tsgo-full.txt | grep -c "error TS" > /tmp/baseline-tsgo.txt; echo "tsgo_tool_exit=${PIPESTATUS[0]}"
#    diagnostic cross-check (read-only, no lock wrapper):
./node_modules/.bin/tsgo -b --noEmit   # → exit 0, zero output

# 2. biome (check-only dry run FIRST to prove --write --unsafe is a no-op on a clean repo, then the prescribed command)
bunx @biomejs/biome check .                     # → exit 0, "Checked 2516 files in 13s. No fixes applied."
bun biome:check 2>&1 | tee /tmp/baseline-biome-full.txt | grep -c "warn" > /tmp/baseline-biome.txt; echo "biome_tool_exit=${PIPESTATUS[0]}"

# 3. lint service (full-repo, JSON)
bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json; echo "lint_exit=$?"

# 4. git snapshots
git stash list > /tmp/baseline-stash.txt
git diff --name-only > /tmp/baseline-files.txt
```

Deviations from the verbatim protocol commands: (a) `tee`/`PIPESTATUS` added so a tool failure can never be silently swallowed (REQ-001 honesty; the bare pipeline reports only grep's exit code); (b) a biome **check-only** pass ran before the write-capable prescribed command to confirm zero source files would be touched (repo was clean, so the prescribed run modified nothing). Counts in `/tmp/baseline-tsgo.txt` and `/tmp/baseline-biome.txt` are exactly what the prescribed commands produce.

## 3. Pre-existing issues to IGNORE during post-implementation review (Task 14)

1. **`Caddyfile` modified** — present in `git diff --name-only` BEFORE any implementation work (unstaged ` M Caddyfile`, no stash). Not part of this plan's scope; exclude from the Task 14 scope audit delta.
2. **First-attempt transient `bun tsgo` silent exit 1** (§1.1) — if it reproduces without diagnostics, re-run before flagging.
3. **`[process-lock]` banner lines on stdout** from lock-wrapped commands (`tsgo`, `biome:check`, lint-service) — they are wrapper noise, not tool findings; they also precede the JSON in `/tmp/baseline-lint.json` (parse from the first `{`).
4. No other pre-existing tsgo / biome / lint findings exist — the repo is fully clean, so **ANY** tsgo error, biome warning, or lint issue observed in Tasks 1–13 is NEW and owned by this plan.

## 4. Deferred-Items Ledger Confirmation

- `deferred-items.md` exists in the plan dir (32 lines, created 2026-09-30).
- All six rows D1..D6 are `⚪ Deferred (accepted)` — **6/6** matches; grep for blocker glyphs `❌|⚠️` → **0 matches** (the final-gate expectation of exactly 0 holds at baseline).
- Rows: D1 email/OTP reset delivery · D2 session/token revocation · D3 rate limiting · D4 profile `ChangePasswordCard` · D5 admin-target policy · D6 directory row chip. None is a blocker for this plan.

## 5. Outcome files read (all of `outcome/`, per REQ-001.3)

| File | One-line takeaway |
|---|---|
| `outcome/00-research-evidence-pack.md` | 10-section verified `path:line` evidence pack (schema/auth/GraphQL-scope/admin service/repos/admin surface/frontend/i18n/tests/prior-art) — the citation source for every task; no password write path, no reset column, and a per-field scope model with NO default scope exist today. |
| `outcome/plan-review-R1.md` | Plan passed the Phase 1.5 gate: 6 mechanical citation/path findings (F1–F6) all fixed and re-verified; carry-overs — gate must be server-authoritative (DB-backed `ctx.user`, not JWT), `changeMyPassword` is the ONLY flag-clearing path, one repo writer (`UserRepository.updatePassword`), never widen `AdminUpdateUserInput`, register the census row, keep `adminUsers` labels flat (parity walker rejects function leaves), `ai/plans/` is untracked so this dir is the record. |

## 6. Carry-forward knowledge for Tasks 1–15

- **Baseline is a perfect zero** on all three gates (tsgo 0 / biome 0 / lint 0 issues). Task 14's "zero NEW errors" therefore means literally zero — every finding after implementation is attributable to the plan's own diffs. Compare against `/tmp/baseline-*`.
- **`bun tsgo` quirk:** runs through `run-locked-cmd.ts` (process lock `tsgo`, 5-minute spawn timeout, `restore-next-env-dts.ts` first). A silent exit 1 with no diagnostics happened once (§1.1) — re-run before diagnosing. Runtime here: well under 5 minutes (fast; incremental `-b --noEmit`).
- **`bun biome:check` quirk:** it is `biome check --write --unsafe .` under a process lock — it CAN mutate files. On a clean repo it writes nothing (proven here), but during implementation prefer a check-only `bunx @biomejs/biome check <paths>` for counting, and only run the prescribed variant via the quality gate.
- **lint-service quirk:** `--json` stdout is preceded by `[process-lock]` banner lines (3 lines before the JSON object) — parse JSON from the first `{`. Full-repo lint took **~146 s** here (comfortably inside a 10-minute shell timeout; the service's own full-repo queue timeout is 20 min). CLI exit code mirrors ESLint (0 clean / 1 errors / 2 config).
- **Git:** only `Caddyfile` was dirty at baseline; expect Task 14's `git diff --name-only` scope audit to whitelist exactly that file plus the plan's own files. Sandbox nuance vs. the plan docs: on the author's machine `ai/plans/` is untracked, but in THIS sandbox the six pre-existing plan files (tasks/specs/plan/deferred-items + the two outcome files) are git-TRACKED (committed at snapshot time); the only untracked path after Task 0 is this outcome file (`??`), and `tasks.md` is now modified (` M`) by the checkbox flip — both are expected Task 0 artifacts, not scope drift. This outcome directory is still the plan's record of truth (0.SR).
- **Sandbox path note:** the plan docs cite `/home/ahmed/Projects/kottaby_kottaby/`; in this environment the repo root is `/home/z/my-project` — all cited `path:line` evidence resolves relative to the repo root unchanged.
- **SEC:** no `.env` file was read or printed; baselines captured counts only (0.SEC satisfied).

## 7. Verification performed for this task

- **0.QL** `bun run scripts/health/sub-loop.ts ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/outcome/0-baseline-outcome.md --lifecycle duplicates` — result: **tsgo stage ✅; oxlint stage fails with the repo's KNOWN `.md` quirk** ("No files found to lint" → oxlint exits 1 on zero lintable files), exit code **1** (log: `/tmp/subloop-task0.txt`). This is structural, not content-related — `ai/**` is excluded from every file-level gate by configuration (biome.json `!**/ai`; eslint.config.mjs global `ai` ignore, `:27-28`; oxlint has no `.md` extension so 0 files match; the duplicates stage auto-skips non-`.ts/.tsx` targets per `scripts/health/sub-loop-checks.ts:190`) — so a `.md` outcome file can never satisfy the oxlint stage regardless of content. Handled per repo precedent, which documents the identical quirk and still accepts the QL step on `.md` targets via compensating gates:
  - `ai/finished_plans/milestone_3_parent_portal_admin_governance/admin-crud-users-teachers-students-paren/tasks.md:428` — "oxlint stage exhibits known `.md` sandbox quirk ('No files found to lint' exit-1 …); compensating full-repo gates GREEN".
  - `ai/finished_plans/milestone_0_foundation/role-based-authorization-middleware/tasks.md:12` — QL on `outcome/phase0-baseline-outcome.md` accepted as "(doc-only; markdownlint scope)".
  - **Compensating gates run here (all GREEN):** full-repo `bun tsgo` exit 0 / 0 errors; `bun biome:check` exit 0 / 0 warnings (2516 files); full-repo lint service success / 0 issues (§1). Also reproduced each skipped stage on the file to prove the skip is config-level, not content-level: biome → "These paths were provided but ignored"; ESLint → "File ignored because of a matching ignore pattern"; duplicates → non-ts auto-skip. **Flagged to the orchestrator in the worklog + final report** (cross-file/tooling dependency — only a repo script/config change could make the sub-loop exit 0 here, which is out of this task's allowed scope).
- **0.TE** baseline numbers captured to `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-lint.json`, `/tmp/baseline-stash.txt`, `/tmp/baseline-files.txt` (Task 14 comparison source).
- **0.SEC** no secrets read/printed (no `.env` access; counts only).
- **0.SR** plandir is untracked in git — this directory is the record; no history expected.
- **0.IV** root `AGENTS.md` + `test/workflows/AGENTS.md` protocol rules read and honored (no source files touched, no `console.*`, no banned patterns introduced).
- **Semantic-review checklist (protocol rule 3):** N/A for a read-only baseline task — tenancy/BOLA untouched, no race surfaces, no enums, no cross-layer imports, no dead code created, deferred items confirmed logged (§4).
