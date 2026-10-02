# 0.1 — Baseline Outcome — Issue #230 "No Country Selector Component"

**Task:** 0.1 Establish error baseline, initialize outcome dir, and seed deferred-items ledger
**Plan directory:** `ai/plans/issue_230/no_country_selector_component/`
**Outcome file:** `ai/plans/issue_230/no_country_selector_component/outcome/0-baseline-outcome.md`
**Date measured:** 2026-09-30 (18:31–18:36 UTC)
**Repo state at measurement:** commit `5a8369feecbb21f6a5d7e673a3bca26bfcad2d6d` ("docs(plans): add M0–M3 spec plans …"), branch `feat/no_country_selector_component`, working tree clean (0 modified, 0 staged, 0 stashes)
**Author:** Phase-0 baseline subagent
**Scope guard:** RESEARCH + DOC ONLY — no source file was modified; no git add/commit performed. The only repo writes are: this outcome file, the four Result cells in `deferred-items.md`, and the 0.1 checkbox in `tasks.md`.

---

## 1. Baseline results (summary)

| # | Check | Result at baseline | Exit code |
|---|---|---|---|
| B1 | `bun tsgo` — TypeScript (`tsgo -b --noEmit`) errors matching `error TS` | **0 errors** (full output empty of diagnostics) | 0 |
| B2 | Biome check — warnings matching `warn` | **0 warnings / 0 errors** ("Checked 2516 files in 13s. No fixes applied.") | 0 |
| B3 | `bun run scripts/lint-service.ts --json --id baseline` — full-repo ESLint envelope | **success: true, output: "", exitCode: 0** (durationMs 146672 ≈ 2m27s) | 0 |
| B4 | Per-file `sub-loop.ts --lifecycle duplicates` | **N/A at Phase 0** — no source file touched by Phase 0; run per-file from Phase 1 onward | — |
| — | `git stash list` / `git diff --name-only` | **0 stashes; empty diff (0 files)** | — |

The baseline is **completely clean**: 0 type errors, 0 biome warnings, 0 lint errors, clean git tree. Per the deferred-items baseline policy, any post-change `error TS` / biome warning / lint error above these counts is a regression introduced by the change.

---

## 2. Exact commands executed (and adaptations, with reasons)

Executed from `/home/z/my-project` on the clean tree at `5a8369fe`.

### B1 — tsgo (no adaptation; repo script used as-is)

```bash
bun tsgo > /tmp/baseline-tsgo-full.txt 2>&1 ; echo "tsgo_exit=$?" ; \
grep "error TS" /tmp/baseline-tsgo-full.txt | wc -l > /tmp/baseline-tsgo.txt
```

- `tsgo` **is** a real `package.json` script:
  `"tsgo": "bun run scripts/restore-next-env-dts.ts && bun run scripts/lib/run-locked-cmd.ts tsgo tsgo -b --noEmit"` — so `bun tsgo` (the skill's canonical form) works verbatim.
- Exit code **0**; `error TS` count **0**; no diagnostics at all in the captured output. The only output lines are the restore-next-env banner and the process-lock enqueue/acquire/release lines.
- Side effect: `scripts/restore-next-env-dts.ts` (re)writes the **untracked** `next-env.d.ts` (canonical dev dist dir `.next-dev`) — it is not git-tracked, so the tree stays clean. Confirmed: `git ls-files | grep next-env.d.ts` → no match.

### B2 — biome (ADAPTED: read-only invocation; do NOT use the repo script for a baseline)

**Adaptation reason:** the repo's `biome:check` script is
`"biome:check": "bun run scripts/lib/run-locked-cmd.ts biome:check bunx @biomejs/biome check --write --unsafe ."`
— it carries `--write --unsafe`, i.e. **it mutates source files**. Task 0.1 is forbidden from modifying any source file, and a baseline captured *after* auto-fixes would understate the true pre-existing state. The adaptation runs the exact same binary + config in read-only mode (only `--write --unsafe` removed):

```bash
bunx @biomejs/biome check . > /tmp/baseline-biome-full.txt 2>&1 ; echo "biome_exit=$?" ; \
grep -c "warn" /tmp/baseline-biome-full.txt > /tmp/baseline-biome.txt
```

- Binary: `@biomejs/biome` **2.5.13** (devDependency `^2.5.13`), repo config `biome.json` picked up automatically.
- Exit code **0**; summary line: `Checked 2516 files in 13s. No fixes applied.`
- Plan-literal `grep -c "warn"` on the full output → **0**; the summary reports no warnings and no errors. Both counts agree: **0 warnings / 0 errors**.
- Verified no mutation: `git status --porcelain` remained 0 after the run.

### B3 — lint-service (no adaptation; flags verified against `scripts/lint-service-cli.ts`)

```bash
bun run scripts/lint-service.ts --json --id baseline > /tmp/baseline-lint.json
```

- `--json` and `-i/--id` are both valid CLI flags (`lint-service-cli.ts:34-35,90`). Full-repo ESLint ran ~2m27s (lint-service is exempt from the 5-minute process-lock timeout).
- Parsed envelope (after stripping the process-lock banner — see §5 gotcha G-3):

```json
{
  "success": true,
  "output": "",
  "exitCode": 0,
  "metrics": {
    "id": "baseline",
    "scope": "full-repo",
    "fileCount": 0,
    "durationMs": 146672,
    "enqueuedAt": 1790793175819,
    "startedAt": 1790793175819,
    "finishedAt": 1790793322491,
    "queueDepthAtEnqueue": 0
  }
}
```

- `fileCount: 0` = full-repo scope (per the script header: "Empty files → full-repo lint via eslint.config.js files/ignores block"); `output: ""` = zero ESLint findings.

### B4 — git state (captured BEFORE the tool runs, then re-verified after)

```bash
git stash list > /tmp/baseline-stash.txt      # → empty file (0 stashes)
git diff --name-only > /tmp/baseline-files.txt # → empty file (0 modified files)
```

- `git status --porcelain` count was **0** before and remained **0** after all tool runs (no tool dirtied the tree; `.quality-gate-lock/` and `.eslintcache` are git-ignored).
- B4's actual subject (per-file `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`) cannot run at Phase 0 because Phase 0 touches no source file; recorded as N/A with instructions in the ledger. It becomes the per-file gate for every Phase 1+ task.

### Branch-state note (environment correction, no content change)

At session start HEAD was on `main` while the orchestrator worklog recorded the feat branch as the working branch. Both `main` and `feat/no_country_selector_component` point at the **same commit** `5a8369fe`, so the baseline is identical for either branch. The checkout was switched to `feat/no_country_selector_component` (clean-tree checkout of an identical commit — zero content change) so subsequent implementation tasks operate on the documented working branch.

---

## 3. Raw artifacts (as captured)

| File | Content |
|---|---|
| `/tmp/baseline-tsgo.txt` | `0` |
| `/tmp/baseline-tsgo-full.txt` | tsgo run banner + process-lock lines only (no diagnostics) |
| `/tmp/baseline-biome.txt` | `0` (plan-literal `grep -c "warn"`) |
| `/tmp/baseline-biome-full.txt` | `Checked 2516 files in 13s. No fixes applied.` |
| `/tmp/baseline-lint.json` | process-lock banner + the JSON envelope reproduced in §2-B3 |
| `/tmp/baseline-lint-clean.json` | JSON envelope only (banner stripped, for machine parsing) |
| `/tmp/baseline-stash.txt` | empty (0 stashes) |
| `/tmp/baseline-files.txt` | empty (0 files in `git diff --name-only`) |

`/tmp` artifacts are ephemeral; the durable record of the numbers is the Phase-0 table in `deferred-items.md` (populated by this task) and §1 above.

---

## 4. Pre-existing issues to IGNORE during review (cross-reference `deferred-items.md`)

The deferred-items ledger's "Pre-existing Issues" section records P1–P5, verified during plan review. None of them are caused by this plan; reviewers/implementers must not "fix" them beyond what their task scope allows:

- **P1** — `backend/services/admin/user-management.helpers.ts:173-177`: admin create still uses `COUNTRY_REQUIRED` + a `COUNTRY_TOO_LONG` branch (`MAX_COUNTRY_LENGTH`). Task 3.4 will replace the create-path check with `countryCodeSchema.safeParse`; the update patch (`:220-225`) stays free-text (D-4).
- **P2** — `backend/graphql/pothos/users/user.pothos.ts:39`: `country` is exposed as legacy free-text string on the user entity — deliberately unchanged (D-6).
- **P3** — `backend/db/schema/notifications/broadcasts.ts:41`: `audienceCountry varchar(100)` exact-matches legacy display strings — untouched (D-3).
- **P4** — `shared/constants/index.ts`: generated `iana-*` files are deep-import-only (absent from the barrel). `shared/constants/countries.ts` must follow the same convention.
- **P5** — `codegen.ts:18` `strictScalars: true`: forgetting the `CountryCode: "string"` map entry is a **hard codegen failure**, not a warning.

Since the measured baseline is fully clean (0/0/0), there is additionally **no pre-existing error noise** of any kind to whitelist: every `error TS`, biome warning, or ESLint error observed after any Phase 1+ edit is new and must be fixed before its per-file loop exits 0.

---

## 5. Deferred-items ledger state (after this task)

- **Ledger exists** at `ai/plans/issue_230/no_country_selector_component/deferred-items.md` (pre-seeded at orchestration; NOT recreated — only the four Phase-0 Result cells were edited; all other rows byte-identical, verified via `git diff` = exactly 4 changed lines).
- **Baseline table B1–B4**: populated with the measured values (§1) — B1 `0 errors (exit 0)`, B2 `0 warnings / 0 errors (exit 0; read-only invocation)`, B3 `{ success: true, output: "", exitCode: 0 }`, B4 `_N/A at Phase 0_`.
- **D-1..D-7**: all seven rows remain `⏭️ Out of scope` (non-blocking, future-issue decisions): D-1 dial-code metadata, D-2 legacy country-value backfill, D-3 admin directory filter / broadcast cohort on ISO, D-4 admin filter/update inputs → `CountrySelector`/`CountryCode`, D-5 `@hookform/resolvers`, D-6 `CountryCode` on output/entity types, D-7 `Intl.DisplayNames` / extra locales.
- **In-plan deferred items table**: still empty (no cross-task deferral discovered during Phase 0).
- **Enforcement invariant**: zero `❌ Blocked` / `⚠️ Partial` / `🔄 In Progress` rows — grep gate at plan close-out must stay clean.

---

## 6. Carry-forward knowledge for later tasks

### Environment facts (from the orchestration session, unchanged by Phase 0)

- **PostgreSQL 17 user-space cluster** at `/tmp/pgdata`, listening on `127.0.0.1:5432` (trust auth). Databases: `app_db` (dev), `kottaby`, `app_db_test` (tests). Schemas pushed on both dev and test; core seed data applied (4 users, 26 tables). `demo-paid-flow` seed step failed on the unconfigured Paymob gateway — known sandbox limitation, not a blocker.
- **`.env`** (DB_PROVIDER=postgres, `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/app_db`) and **`.env.test`** (points at `app_db_test`) both present at repo root. Test entry points use `bun --env-file=.env.test`.
- **Deps installed**: `node_modules/` present (801 top-level packages, `bun install` OK). Bun binary is **1.3.14** while `packageManager` declares `bun@1.4.0` — all commands above ran fine on 1.3.14; note the mismatch if a tool ever demands ≥1.4.
- **Working branch**: `feat/no_country_selector_component` (now checked out; same commit as `main`, `5a8369fe`). Do the implementation here.

### Tooling gotchas learned while capturing the baseline

- **G-1 — `bun biome:check` mutates files.** It is `bunx @biomejs/biome check --write --unsafe .`. Never run it to *measure* anything; run read-only `bunx @biomejs/biome check .` for counts. (For fixing, the script is fine — that is its purpose.)
- **G-2 — `bun tsgo` is safe and fast.** Script = `restore-next-env-dts.ts` + `run-locked-cmd tsgo tsgo -b --noEmit`; measured well under a minute here. It hard-caps at **5 minutes** via `run-locked-cmd` (tsgo is not in `isTimeoutExempt`), so a hang shows up as a lock-timeout message, not a slow run. It rewrites the *untracked* `next-env.d.ts` — harmless for git.
- **G-3 — `lint-service.ts` stdout is banner-prefixed.** `withProcessLock` prints ANSI-colored `[process-lock] Enqueued/Acquired/Released` lines **before** the `--json` payload on stdout; strip leading non-`{` lines (e.g. `sed -n '/^{/,$p'`) before machine-parsing. Full-repo lint took ~2m27s; lint-service is timeout-exempt (up to 20 min full-repo cap by default).
- **G-4 — Process-lock contention.** `tsgo`, `biome:check`, `lint`, `test`, `duplicates`, `build` all serialize through `.quality-gate-lock/` process locks — do not run two of these concurrently across agents, or one will queue behind the other (it queues rather than fails; stale locks expire after 5 min except for exempt classes).
- **G-5 — Baseline policy mechanics.** With the clean 0/0/0 baseline, the per-file loop (`bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates`, strict order `tsgo → oxlint → biome:check → lint:type-aware → check:duplicates`) must exit 0 for every touched file; the global gate for Phase 7 is `bun quality-gate` + `bun run check:unused`, with counts compared against this file's §1 table.

### Pointers the implementing tasks will need (from the evidence pack, unchanged)

- Scalar sync rule: register once in `scalar.pothos.ts` + builder `Scalars` slot + `codegen.ts` map (`strictScalars: true`), then `bun run generate:gqlSchema` + `bun codegen`, and pin `schema-surface.test.ts` (gotchas S-2/S-3/S-11 in `00-research-evidence-pack.md`).
- The `graphql-scalars@2.0.0` `CountryCode` resolver is a full-ISO-list, case-insensitive check (not a `^[A-Z]{2}$` shape check) — service-layer `COUNTRY_CODES` membership + `normalizeCountryCode` remain mandatory (S-1).
- Raw-SQL read paths in `user.repository.ts:51-58,83-90` name columns explicitly — adding `country_code` requires touching those SELECTs or non-tx reads silently drop it (S-9).

---

## 7. Task 0.1 acceptance checklist

- [x] Read all existing files in `outcome/` (REQ-11 protocol item 1): `00-research-evidence-pack.md`, `plan-review-R1.md` — both read in full before execution.
- [x] Baseline error counts recorded BEFORE any implementation (B1/B2/B3 above; B4 N/A at Phase 0, structure documented).
- [x] Deferred-items ledger: already seeded (D-1..D-7 + baseline table); Phase-0 Result cells populated; everything else byte-identical.
- [x] Outcome file written: this file.
- [x] Progress updated: task 0.1 checkbox flipped to `[x]` in `tasks.md`.
- [x] No source file modified; no dev/build server run; no git add/commit.
