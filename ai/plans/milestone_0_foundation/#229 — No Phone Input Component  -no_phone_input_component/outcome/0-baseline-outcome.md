# Task 0 — Baseline Outcome (Phase 0)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 0 — Baseline + ledger + outcome read (MANDATORY)
> **Date:** 2026-09-30 · **Branch precondition:** see ⚠️ A1 below (HEAD was found on `main`, not `feat/no-phone-input-component`; both at commit `5a8369fe`)
> **Artifacts:** `/tmp/baseline-tsgo.txt`, `/tmp/baseline-tsgo-raw.txt`, `/tmp/baseline-biome.txt`, `/tmp/baseline-biome-raw.txt`, `/tmp/baseline-lint.json`, `/tmp/baseline-lint-stderr.txt`, `/tmp/baseline-stash.txt`, `/tmp/baseline-files.txt`

## 1. Baseline numbers

| Gate | Command | Baseline result | Exit |
|---|---|---|---|
| tsgo | `bun tsgo 2>&1 \| grep -c "error TS"` | **0** (⚠️ VACUOUS — see A2: process OOM-killed before emitting any diagnostics) | 1 via `run-locked-cmd` wrapper; SIGKILL (137) when run directly |
| biome:check | `bun biome:check 2>&1 \| grep -c "warn"` | **0** — `Checked 2516 files in 18s. No fixes applied.` | 0 |
| lint-service | `bun run scripts/lint-service.ts --json --id baseline` | `success: true`, `output: ""`, `fileCount: 0`, `durationMs: 148998` | 0 |

Notes on artifacts:
- `/tmp/baseline-tsgo.txt` contains `0`; `/tmp/baseline-tsgo-raw.txt` (6 lines) contains NO `error TS` lines — only the wrapper banner + `error: script "tsgo" exited with code 1`.
- `/tmp/baseline-biome.txt` contains `0`; raw output has zero `warn`/`error`/`Found` lines. biome is **clean** pre-implementation. (`biome:check` runs `--write --unsafe`; "No fixes applied" + empty `git status --porcelain` after the run ⇒ it mutated nothing.)
- `/tmp/baseline-lint.json` has the `[process-lock]` banner lines prefixed on stdout BEFORE the JSON object — strip the first 3 lines when machine-parsing.

## 2. Git baseline

- `git stash list` → **empty** (artifact: `/tmp/baseline-stash.txt`).
- `git diff --name-only` → **empty** (artifact: `/tmp/baseline-files.txt`).
- `git status --porcelain | head -20` → **empty** (working tree fully clean, no untracked).
- `.env` and `.env.test` are confirmed gitignored (`git check-ignore .env .env.test` → both match, exit 0), which is why they don't appear as untracked.

### ⚠️ A1 — Branch anomaly (recorded, NOT fixed — checkout forbidden to this subagent)

`git rev-parse --abbrev-ref HEAD` → **`main`**, not `feat/no-phone-input-component`. Reflog:

```
5a8369fe HEAD@{0}: checkout: moving from feat/no-phone-input-component to main
5a8369fe HEAD@{1}: checkout: moving from main to feat/no-phone-input-component
5a8369fe HEAD@{3}: branch: Created from origin/main
```

Both local branches point at the **same commit `5a8369fe`** (`docs(plans): add M0–M3 spec plans … (#270)`), so there is **zero content drift** — the working tree matches what the feature branch would have. The "already checked out" precondition was violated after the orchestrator's setup (something moved HEAD back to `main`). **The orchestrator must `git switch feat/no-phone-input-component` before Phase 1 implementation commits**, otherwise work would land on `main`.

### ⚠️ A2 — tsgo cannot complete in this sandbox (OOM)

- Sandbox: 4.1 GiB RAM, no swap, 2 CPUs. `tsgo -b --noEmit` (single monolithic root `tsconfig.json`, no project references) was **killed by the kernel OOM killer** before printing a single diagnostic.
- Evidence (dmesg): `Out of memory: Killed process 4325 (tsgo) total-vm:4184204kB, anon-rss:2918732kB` (≈2.9 GB RSS when killed). Direct run → exit 137 (SIGKILL); via `bun tsgo` → `spawnSync` status null → wrapper reports exit 1.
- Consequence: the recorded `0` is **not** evidence of a clean typecheck; it is a vacuous count from a killed process. Post-implementation "no new tsgo errors" comparisons must NOT rely on this baseline. Mitigations for later tasks: (a) run tsgo with more available RAM (dev server holds ~1.1 GiB and must stay up), (b) use the per-file QL mechanism (`scripts/health/sub-loop.ts <file> --lifecycle duplicates`) — note plain `tsgo --noEmit <file>` errors with **TS5112** ("tsconfig.json is present but will not be loaded if files are specified on commandline. Use '--ignoreConfig'"), so the QL chain's tsgo invocation must already handle this — verify before Task 1.
- `scripts/lib/run-locked-cmd.ts` enforces a **5-minute timeout** on non-exempt locked commands (tsgo/biome/lint) — relevant for future long checks.

## 3. Frozen-facts verification (6/6 actionable facts hold; minor line/caret drift noted)

| # | Claim | Status | Evidence |
|---|---|---|---|
| 1a | `backend/db/schema/users/users.ts:17` `phone` = `varchar(20)` nullable | **CONFIRMED** (exact line) | Line 17: `phone: varchar("phone", { length: 20 }),` — no `.notNull()` |
| 1b | `users.ts:44` the ONLY unique constraint is on email | **CONFIRMED** (exact line) | Line 44 (3rd table arg): `t => [unique("users_email_unique").on(t.email)]` — sole unique in the table |
| 2 | `backend/services/admin/user-management.helpers.ts:~30` `MAX_PHONE_LENGTH = 20` | **CONFIRMED with line drift** | Actual line **31** (line 30 is `MAX_FULL_NAME_LENGTH = 255`); private non-exported `const` (matches plan-review H-3 correction) |
| 3 | `rg "phoneInvalid" shared/ backend/ frontend/` → 0 matches | **CONFIRMED** | Grep over all three dirs → 0 files (backend included) |
| 4 | `package.json:116` `"zod": "4.6.2"`, unused in shared/ + frontend/ | **CONFIRMED (minor drift)** | Line 116 is `"zod": "^4.6.2"` (caret prefix the plan omitted); installed `node_modules/zod` = 4.6.2. Bare-word `zod` search → **0 matches in shared/ and 0 in frontend/**. Sole repo usage: type-only `import type { z } from "zod"` at `backend/types/classes/admin-session-governance.types.test.ts:14` (matches plan-review M-5) |
| 5 | Deferred ledger: #230 CountrySelector + legacy phone backfill non-blocking | **CONFIRMED** | `grep -c "❌\|⚠️" deferred-items.md` = **6**, but ALL 6 hits are prose/legend/enforcement lines (`:21, :82, :83, :91, :127, :133`) — **zero table rows** carry ❌/⚠️. All 9 rows D-1…D-9 are `⏭️ Out of scope` (status-column grep → 9). D-1 (#230 CountrySelector) and D-6 (legacy phone backfill) are ⏭️ non-blocking. Note: the ledger's non-blocking marker is `⏭️ Out of scope` (no 📋 marker exists in this ledger — intent satisfied) |
| 6 | `scripts/ci/materialize-env-test.ts` does NOT exist (DRIFT) | **CONFIRMED ABSENT** | `scripts/ci/` directory does not exist at all; `.env.test.ci` header still says "Consumed by scripts/ci/materialize-env-test.ts (Task 2.2)". `.env.test` was manually materialized: `DATABASE_URL=postgresql://postgres@127.0.0.1:5432/kottaby_test`, real `DATABASE_ENCRYPTION_KEY`, plus `CRON_SECRET`, `GRAPHQL_ENCRYPTION_KEY`, `ADMIN_EMAIL=admin@app.local`, `ADMIN_PASSWORD=…`, `CACHE_PROVIDER=memory`, `REDIS_PROVIDER=local` (file retains the template's banner comment; `diff .env.test.ci .env.test` shows exactly the expected secret/URL deltas) |

**No frozen fact is contradicted.** Drift is limited to: `MAX_PHONE_LENGTH` line 30→31, `^` caret on zod, and the already-known materialize-env-test absence.

## 4. Pre-existing issues to IGNORE during post-implementation review

1. **tsgo error-line sample: none available.** The process was OOM-killed before emitting diagnostics (see A2) — there are no "first ~30 error lines" to sample. This is an **environment limitation, not a code signal**; do not treat baseline tsgo as green.
2. **biome: none.** 2516 files checked, zero warnings/errors/fixes.
3. From `deferred-items.md` §Pre-existing Issues (keep ignoring unless touched by this plan):
   - **P1** stale `PhoneInput`/`CountrySelect` mention at `frontend/COMPONENT_PATTERNS.md:257`;
   - **P2** `users.phone` has no uniqueness/shape constraint in DB (`users.ts:17`, only `users_email_unique` at `:44`);
   - **P3** no country→dial-code dataset (documented absent at `CreateUserDialog.tsx:23-27`);
   - **P4** `auth` namespace has no locale-parity test.
4. `.env.test` banner comment still reads "CI test-environment template (COMMITTED) — .env.test.ci" even though the file is the materialized runtime copy — cosmetic, from the template.

## 5. Carry-forward knowledge for future tasks

- **Git:** orchestrator must re-checkout `feat/no-phone-input-component` (A1) before Phase 1; both branches are at `5a8369fe` so no rebase needed.
- **tsgo memory:** full-repo `bun tsgo` OOMs at 4.1 GiB sandbox RAM; expect it to fail again during QL gates unless memory is freed or a scoped check is used. Watch for TS5112 when passing file args (needs `--ignoreConfig`).
- **Locked commands:** `tsgo`, `biome:check`, `lint` go through `scripts/lib/run-locked-cmd.ts` (5-min timeout, process-lock banners on stdout/stderr). lint-service JSON output has 3 banner lines before the JSON.
- **biome:check mutates** (`--write --unsafe`): always re-verify `git status --porcelain` after running it.
- **zod is virgin territory** in shared/ and frontend/ — Task 1's `shared/lib/phone.ts` will be the first zod consumer in `shared/`; the only existing repo usage is the backend type-only test import (`admin-session-governance.types.test.ts:14`).
- **Backend phone bounds:** `MAX_PHONE_LENGTH = 20` lives at `user-management.helpers.ts:31` (not :30) — cite the real line in later outcome files.
- **Env materialization:** `scripts/ci/materialize-env-test.ts` is referenced by `.env.test.ci` but absent; `.env.test` exists and is correct for local runs. If any task claims to run it, stop — it doesn't exist.
- **Deferred ledger discipline:** rows D-1…D-9 are all `⏭️ Out of scope`; the "In-plan deferred items" table is empty and must be populated the moment implementation discovers cross-task work. Enforcement greps target `| ❌ Blocked |` / `| ⚠️ Partial |` rows only.
