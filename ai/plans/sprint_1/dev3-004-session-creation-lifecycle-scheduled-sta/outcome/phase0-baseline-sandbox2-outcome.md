# Phase 0 Baseline — Sandbox #2 (Fresh Re-Provisioned Sandbox) — READ-ONLY VERIFICATION

**Task ID:** V-1 · **Date:** 2026-08-31 · **Agent:** general-purpose (sandbox re-verification pool)
**Branch at capture:** `feat/dev3-004-session-creation-lifecycle-scheduled-sta` @ `a14c61c` (HEAD; sandbox initially sat on `main`, re-checked out at session start; branch survived all gate runs)
**Mandate:** capture a FRESH baseline of the code-quality gates in THIS re-provisioned sandbox and verify the plan's intake artifacts, so subsequent verification rounds can distinguish pre-existing vs new issues. **Nothing was fixed, formatted, staged, committed, or pushed.**

---

## 1. Fresh Gate Baseline (exact commands + raw counts)

| Gate | Exact command | Fresh result | Prior-run reference (7.4-final-outcome §2) | Match? |
|---|---|---|---|---|
| TypeScript (tsgo) | `bun tsgo` (repo script = `restore-next-env-dts.ts` + `run-locked-cmd tsgo -b --noEmit`) | **exit 0 — 0 "error TS" lines** (raw: `/tmp/baseline-tsgo.txt`) | exit 0, 0 errors | ✅ MATCH |
| Biome (read-only) | `bunx @biomejs/biome check .` (NO `--write`; identical to the 7.4 final-gate variant) | **exit 1 — "Checked 603 files. Found 3 errors. Found 1 info."** (raw: `/tmp/baseline-biome.txt`) | exit 0 — "Checked 570 files", 0 diagnostics | ⚠️ DIFFERS — fully classified below (§2) |
| ESLint (sandbox-safe) | `NODE_OPTIONS="-r ./scripts/ts6-eslint-patch.cjs --max-old-space-size=2048" bun x eslint --concurrency=1 .` (7.4-verbatim; cacheless) | **exit 1 — 1 error / 0 warnings** (raw: `/tmp/baseline-eslint.txt`) | exit 0 — 0 errors / 0 warnings | ⚠️ DIFFERS — fully classified below (§3) |

Note on Biome invocation: the repo script `biome:check` runs with `--write --unsafe` (auto-fixes). It was deliberately NOT run to honor the read-only mandate; the no-write `check .` is the count-equivalent and is the same form the plan's own 7.4 final gate used. No files were modified by any gate run (re-verified via `git status` after each run).

## 2. Biome delta classification (3 errors + 1 info — NOT dev3-004 regressions)

All three errors are **format-only** ("Formatter would have printed the following content") — zero lint-rule violations:

1. `frontend/views/teacher/wallet/TeacherWalletContainer.tsx:439` — **committed code**, last touched by `24dc17c` "feat(wallet): DEV3-013 /wallet page" — a plan that landed on this branch AFTER dev3-004's final gate (clean 570-file run at `8779acc`, which is an ancestor of current HEAD).
2. `test/ui/components/teachers/teacher-wallet/TeacherWalletContainer.suite.tsx` (several hunks) — **committed code**, from `d923d78` "test(ui): DEV3-013 teacher wallet component suite".
3. `tsconfig.json` — **working-tree-only artifact of the sandbox provisioning**: the provisioning step rewrote tsconfig.json at 14:45:19 (before the gates ran) via a JSON.stringify-style rewrite — expanding the `lib`/`paths`/`types` arrays one-element-per-line and appending `.next-dev/types/**/*.ts` + `.next-dev/dev/types/**/*.ts` to `include` (the `.next-dev` dev-dist dir used by `dev:safe`). **The COMMITTED tsconfig.json is biome-format-clean** — proven by `git show HEAD:tsconfig.json | bunx @biomejs/biome format --stdin-file-path=tsconfig.json` producing byte-identical output (diff empty). Do not "fix" the working tree tsconfig.json; it belongs to the provisioning, and the dev server relies on the `.next-dev` includes.

Version-drift cross-check: bun.lock pins `@biomejs/biome@2.5.10`, but node_modules resolved **2.5.11** (fresh install inside `^2.5.10`). Re-running the same check with `bunx @biomejs/biome@2.5.10 check .` (raw: `/tmp/baseline-biome-2510.txt`) yields the **same 3 errors** — so the format drift is version-independent. The "1 info" (biome.json `$schema` 2.5.10 vs CLI 2.5.11) is the only 2.5.11-only artifact.

File-count delta 570 → 603: the branch legitimately grew after dev3-004 closed (DEV3-005 / DEV3-012 / DEV3-013 commits), so more files are in the lint surface. **Verdict: 2 pre-existing format errors from DEV3-013 (out of dev3-004 scope) + 1 provisioning-caused tsconfig format error + 1 toolchain-version info. Zero dev3-004-introduced diagnostics.**

## 3. ESLint delta classification (1 error / 0 warnings)

```
/home/z/my-project/test/ui/components/teachers/teacher-wallet/TeacherWalletContainer.suite.tsx
  350:7  error  Prefer "expect(screen.getAllByText("EGP")).toHaveLength(2)" over this generic assertion ...  sonarjs/prefer-specific-assertions
✖ 1 problem (1 error, 0 warnings)
```

Same provenance as §2 item 2: a **pre-existing committed finding in a DEV3-013 wallet test file** (post-dev3-004 work), not a sandbox artifact and not a dev3-004 regression. tsgo's 0 errors confirms the dev3-004 session code itself remains type-clean in this sandbox.

## 4. tsgo OOM incident (environment-caused, resolved without any changes)

The first two tsgo attempts were killed by the OOM killer (direct run exit **137** SIGKILL; wrapped run exit 1, silent, ~29s — spawnSync sees a signal-killed child). Cause: 4 GB box (4041 MB total, no swap) with the dev server (`next-server` ~930 MB RSS), agent-browser Chrome instances, and a leftover `bun --env-file=.env.test test/scripts/run-db-tests-parallel.ts` process co-resident. After memory freed up (~2.4 GB available), both the direct `./node_modules/.bin/tsgo -b --noEmit` (11.7 s) and the canonical `bun tsgo` completed **exit 0 with 0 errors**. No code or config change was made or needed. The typescript shim was checked and is intact: `node_modules/typescript/lib/version.cjs` = `7.0.2` re-export shim over `@typescript/typescript6` (package.json postinstall artifact) — **no `bun install` restore was required**.

## 5. Diff baseline

- `git diff --name-only` → **`tsconfig.json` only** (provisioning rewrite, §2.3).
- `git status --porcelain` → ` M tsconfig.json` and **nothing else**: no untracked artifacts surface (`/worklog.md`, `/download/`, `tool-results/`, `.env*` are `.gitignore`d; `dev.log`/`upload/` absent in this sandbox).
- `git stash list` → empty.

## 6. Intake artifact verification (ai/plans/sprint_1/dev3-004-session-creation-lifecycle-scheduled-sta/)

- **Plan-review gate:** `outcome/0.3-outcome.md` (round 1 — 4 BLOCKING B1–B4 + 10 advisory, GATE: FAIL) and `outcome/0.3-R2-outcome.md` (round 2 — "Blocking verdict: 4/4 PASS", gate preconditions satisfied) both exist, with `outcome/0.3-fix-outcome.md` between them. ✅ Rounds 1+2 present, round 2 = gate pass.
- **Plan-level completion:** `outcome/final-outcome.md` line 5: "**Verdict: PLAN COMPLETE** — all 27 tasks (+ 2.M midpoint, plan-review rounds 1–2, review rounds R1–R4) executed with outcomes; final gates green at baseline delta = 0."
- **Deferred ledger** (`deferred-items.md`): `rg -n '❌|⚠️'` = **exactly 4 matches**, all legend/prose glyphs, **zero item statuses**:
  - L32: `**Ruling addendum (0.3-fix, 2026-08-30):** D7 added per the 0.3 gate's BLOCKING finding B3 (orchestrator ruling: teachers unconditionally FORBIDDEN on `createSession` in this slice; the REQ-011/REQ-064 carve-out wording struck and deferred). D7 uses the neutral ⏸ Forward marker — it joins D6 as a ledger row that contributes nothing to the REQ-083 `grep -c "❌\|⚠️"` gate (which stays 0).`
  - L36: `**6.1-fix addendum (2026-08-31):** D10 added per the 6.1 review-types wave finding F1 (LOW, report-only residual): … Neutral marker — the REQ-083 `grep -c "❌\|⚠️"` item-status gate stays 0.` (both ❌/⚠️ glyphs sit inside the quoted grep expression)
  - L43: `- ⚠️ **Partial** — Partially completed, needs follow-up work` (Status-Values legend definition)
  - L44: `- ❌ **Blocked** — Not resolved, plan cannot complete until addressed` (Status-Values legend definition)
  - Item rows D1–D10 all neutral: D1–D5, D7, D8, D9, D10 = ⏸ Forward; D6 = ✅ Done. REQ-083 item-status gate: **clean (0)**.
- **Checkbox census (`tasks.md`):** `- [x]` = **122** · `- [ ]` = **0** · `[-]` = **0**. All boxes flipped — consistent with "PLAN COMPLETE".
- **Journey test inventory (`test/workflows/`):**
  - `test/workflows/sessions/session-lifecycle.journey.test.ts` (J1 happy-path) — 28 KB
  - `test/workflows/sessions/session-lifecycle-denials.journey.test.ts` (J2 denials) — 29 KB
  - `test/workflows/helpers/{index.ts, journey-fixtures.ts, session-cast.ts}` + `test/workflows/AGENTS.md`
  - Matches the 5.3 gate record (16 pass / 0 fail / 272 expects ×2 runs: J1 10/179 + J2 6/93).

## 7. Environment notes for subsequent verification agents

1. **RAM is the constraint:** 4 GB total, NO swap, 2 vCPU. The dev server (~930 MB), agent-browser Chrome, and stray `bun test` runner processes can OOM-kill tsgo/eslint (exit 137 / silent exit 1). Re-verify memory (`free -m`) and retry after pressure clears before diagnosing a gate failure as a code issue.
2. **Two `next dev` pairs were observed** during capture (one serving :3000 via next-server; provisioning-era duplicates). Postgres 17.5 on 127.0.0.1:5432 is up. Dev server was left running; nothing was killed or restarted by this task.
3. **Biome CLI drift:** node_modules has 2.5.11 vs bun.lock's 2.5.10 → every biome run will print the schema-version "info". Do NOT run `biome migrate` or rewrite biome.json.
4. **`tsconfig.json` working-tree rewrite is provisioning-owned** (adds `.next-dev` type includes). Leave it; the committed version is format-clean.
5. **Standing baseline for future rounds (pre-existing, non-dev3-004):** biome format errors in `frontend/views/teacher/wallet/TeacherWalletContainer.tsx` + `test/ui/components/teachers/teacher-wallet/TeacherWalletContainer.suite.tsx` (DEV3-013), and eslint `sonarjs/prefer-specific-assertions` at the suite's line 350. Any NEW occurrence beyond these three locations is attributable to the work under verification.
6. Raw baseline artifacts: `/tmp/baseline-tsgo.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-eslint.txt`, plus `/tmp/baseline-biome-2510.txt` (2.5.10 cross-check) and `/tmp/tsgo-raw.txt` (direct-run evidence).

**Baseline verdict:** tsgo matches the prior reference exactly (0/0). Biome and ESLint differ from the 570-file zero-delta reference ONLY through (a) post-dev3-004 branch growth (DEV3-013 wallet files), and (b) two sandbox artifacts (provisioning tsconfig rewrite; lockfile-vs-node_modules biome patch drift). **Zero unexplained deltas; zero dev3-004-attributable issues; nothing fixed.**
