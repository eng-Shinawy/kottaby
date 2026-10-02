# Task 16a — Final Gate Proofs + Scoped Type Gate (subagent outcome)

> **Plan:** `ai/plans/milestone_0_foundation/#229 — No Phone Input Component  -no_phone_input_component/`
> **Task:** 16 — final quality gate (subagent 16a: proofs + type gate; full suites are 16b's job)
> **Worktree:** `/home/z/feat-wt` · **Branch:** `feat/no-phone-input-component` · **HEAD:** `64f7f6a3650f6a28565a3bdf32622a726b10884e` (`64f7f6a3` ✓, matches dispatch contract)
> **Date:** 2026-09-30 · **Constraints honored:** no git write commands; only `deferred-items.md` + this outcome file + `/home/z/my-project/worklog.md` modified.

## 1. Static proofs (all observed values verbatim)

| # | Proof | Command | Observed | Verdict |
|---|---|---|---|---|
| 1 | D3 zero-dependency | `git diff --stat origin/main..HEAD -- package.json bun.lock` | **EMPTY** (no output, no files changed) | ✅ PASS |
| 2 | D3 zero-dependency (content) | `rg -c "libphonenumber\|hookform/resolvers" package.json frontend/ shared/ backend/` | exit **1**, **zero matches** | ✅ PASS |
| 3 | D7 zero-SDL | `git diff --stat origin/main..HEAD -- frontend/graphql/generated/ backend/graphql` | **EMPTY** (no codegen/schema artifacts changed) | ✅ PASS |
| 4 | Cross-layer (plan-exact form) | `rg "@/backend" frontend/components frontend/views/auth frontend/views/admin \| rg -v "test"` | **1 informational hit**: `frontend/components/ui/fieldError.ts` — a **JSDoc comment** mentioning `@/backend/types` (`backend/types/errors/api-error.types.ts`). Verified: `git diff --stat origin/main..HEAD -- frontend/components/ui/fieldError.ts` → EMPTY (file unchanged by this plan; pre-existing doc text) and `rg -n "^import" … \| rg -c "@/backend"` → 0 (no actual import). ⇒ **0 unexpected hits** | ✅ PASS |
| 5 | Cross-layer (broader sweep) | `rg -l "@/backend/services\|@/backend/db" frontend/` | **7 hits, all pre-existing `frontend/graphql/test/**` files** (scheduling/session-lifecycle-queries, subscription-admin, admin-finance, admin-users, academic-tracking integration tests, students/handshake-code, teachers/applicant-profile) — all in the plan's `rg -v "test"`-excluded class; none in components/views; none touched by this plan. Informational only. | ✅ PASS (with note) |
| 6 | Layer purity of shared lib | `rg "@/frontend\|@/backend\|@/app" shared/lib/phone.ts` | exit **1**, **zero matches** | ✅ PASS |
| 7 | No barrel / no shim | `ls shared/lib/index.ts` | `No such file or directory` (absent, as mandated) | ✅ PASS |
| 8 | Traceability | `for r in $(grep -oE 'REQ-[0-9]+(\.[0-9]+)?' specs.md \| sort -u); do grep -q "$r" tasks.md \|\| echo "MISSING: $r"; done` | **zero MISSING lines** (every REQ incl. dotted sub-ids present in tasks.md) | ✅ PASS |
| 9 | Deferred-ledger enforcement | `grep -nE "❌\|⚠️" deferred-items.md` | 6 hits at lines **21, 82, 83, 91, 127, 133** — all **legend / prose / enforcement-comment** lines (verified by full read); **zero table rows** carry ❌/⚠️. All ledger rows D-1…D-9 are `⏭️ Out of scope` (intentional child-ticket deferrals #230 / legacy backfill). Enforcement grep target count = 0. | ✅ PASS |

### Quotepath anomaly (tooling note)

`git diff --name-only origin/main..HEAD | rg -v "^ai/plans/"` returned **45** lines — the `ai/plans/` filter was a **no-op** because git quotes the non-ASCII plan-dir name (`"ai/plans/milestone_0_foundation/#229 \342\200\224 No Phone Input Component  -no_phone_input_component/…"`), so those paths do not start with `ai/plans/`. Re-run with `git -c core.quotepath=off` → the true changed-file set is **26 code/test files** (20 source + 6 test). All subsequent steps used the corrected list.

## 2. Scoped-tsgo batch type gate (the REAL type evidence)

Per the outcome/3-outcome.md §3 pattern (and Task 0 anomaly A2 / Task 3–13 honesty notes: full-repo tsgo is OOM-flaky and the sub-loop tsgo stage can false-pass on OOM):

- **Config:** `/tmp/tsconfig.task16.json` (OUTSIDE the repo), `extends: "/home/z/feat-wt/tsconfig.json"` (preserves `paths {"@/*": ["./*"]}`, `strict`, `moduleResolution: "bundler"`, `types: ["bun"]`), overrides `incremental: false` + `typeRoots: ["/home/z/feat-wt/node_modules/@types"]`, and **overrides `include`** (Task 1-addendum pitfall) with **22 files** = the 20 non-test changed source files (`backend/services/**` ×4, `frontend/components/ui/PhoneInput.tsx`, `frontend/stories/ui/PhoneInput.stories.tsx`, the 4 view integrations, `shared/lib/phone.ts`, 9 `shared/locale/**` files) **plus the two ambient augmentations** `frontend/providers/theme/types.ts` (MUI Palette module augmentation — Task 12/13 pitfall) and `frontend/types/apollo-client.d.ts`. The 6 `*.test.ts` files were excluded (type evidence for tests is the suites' job in 16b; keeping the closure lean for the 4.1 GiB sandbox).
- **Command:** `bunx tsgo -p /tmp/tsconfig.task16.json --noEmit` (from `/home/z/feat-wt`, 300 s budget)
- **Result:** **exit 0 — ZERO diagnostics** over the full import closure of every changed source file.

### Negative control (gate-engagement proof)

- Scratch probe `/tmp/task16-probe.tsx`: `import { PhoneInput } from "@/frontend/components/ui/PhoneInput"; … <PhoneInput label="probe" error={123} />` via second config `/tmp/tsconfig.task16-neg.json` (same extends + both augmentations in include).
- **Result: exit 1** with exactly one diagnostic: `../../../tmp/task16-probe.tsx(4,36): error TS2322: Type 'number' is not assignable to type 'boolean | undefined'.`
- ⇒ The scoped gate genuinely resolves the `@/` alias and type-checks `PhoneInputProps`; the clean exit-0 run is **non-vacuous**. All scratch files (both configs + probe) deleted.

### Full-repo tsgo — for the record (expected OOM; observed WORSE: masked false-clean)

- `timeout 240 bun tsgo` → **wrapper exit 0** — but `dmesg` shows `Out of memory: Killed process 21442 (tsgo) total-vm:3984564kB, anon-rss:2657364kB … oom-kill:constraint=CONSTRAINT_NONE … global_oom task=tsgo`.
- **HONESTY:** the kernel OOM-killed tsgo (A2 recurrence, ~2.66 GB RSS) and the locked wrapper **did not propagate the kill** — it reported success over a process that emitted no diagnostics. So this window's `bun tsgo` exit 0 is **VACUOUS** (Task 0 observed wrapper exit 1 on the same kill; the masking is not even consistent). The scoped run + negative control in §2 is the only trustworthy type evidence, which is why it was produced.

## 3. 16.QL — sub-loop batch over every file touched in Tasks 1–15

- Loop: `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` over all **26** code/test files (corrected quotepath list) → **DONE=26 / 26, FAILS=0**; **zero `FAIL(...)` lines**; every file exit 0 (final line: `✅ All checks for lifecycle "duplicates" passed for test/workflows/auth/registration-phone.journey.test.ts`).
- **Per-stage honesty:** the **real** per-file signals are `oxlint`, `biome:check`, `lint:type-aware`, and `check:duplicates` — all green for all 26 files. The **project-wide `tsgo` stage inside sub-loop is ADVISORY-ONLY this window**: full tsgo was kernel-OOM-killed seconds earlier (§2) with a wrapper false-clean, so its per-file "tsgo passed (no errors for …)" lines are the exact vacuous-pass pattern Task 3 documented (`filterTsgoForFile` sees no output from a killed process). Non-vacuous type proof = §2. (`check:duplicates` reports "passed/skipped" by design for files outside the jscpd scan scope, e.g. the journey test.)

## 4. Deferred ledger note (this task's only ledger edit)

Appended **one** `📋 Informational` row (**D-10**) to the deferred-items ledger table (format-matched; NOT ❌/⚠️, enforcement count unaffected):
(a) pre-existing doc contradiction `tests.instructions.md:29` vs `test/workflows/AGENTS.md` rule 6 (`getServerTranslations` in tests) — empirically green per midpoint-review-R1 R2; hand-curated rule files are not editable by plan work → **for a human curator**;
(b) `normalizePhone` currently has **no production consumer** — plan-mandated public API (D2/REQ-1.3, EC-9), not dead code; consumers are the future **#230 normalization hand-off** (mirrors D-3/D-6).

## 5. Deliverables

| Deliverable | Status |
|---|---|
| D3 zero-dependency proof (EMPTY diff + zero rg matches) | ✅ |
| D7 zero-SDL proof (EMPTY diff) | ✅ |
| No-shim / no-cross-layer proofs (0 unexpected hits; `shared/lib/index.ts` absent) | ✅ |
| Traceability loop → zero missing REQs | ✅ |
| Deferred-ledger ❌/⚠️ table-row scan → 0 rows (hits are prose/legend only) | ✅ |
| Scoped-tsgo batch gate → exit 0, zero diagnostics (22-file include) | ✅ |
| Negative control → TS2322, exit 1 (gate proven engaged; scratch deleted) | ✅ |
| Full-repo tsgo recorded → OOM-killed, wrapper exit 0 = VACUOUS (documented) | ✅ (honesty note) |
| 16.QL batch → 26/26 exit 0, 0 FAILs | ✅ |
| `deferred-items.md` D-10 📋 row appended | ✅ |
| `outcome/16a-gate-proofs-outcome.md` (this file) | ✅ |
| Worklog 16a section appended (`/home/z/my-project/worklog.md`) | ✅ |

## 6. Anomalies / carry-forward for 16b

1. **A2 recurrence, new mask mode:** full-repo tsgo OOM (2.66 GB RSS) with the wrapper exiting **0** (Task 0 saw exit 1) — never trust a bare `bun tsgo` exit code in this sandbox; the scoped-tsgo + negative-control pattern is the type-gate standard.
2. **Quotepath pitfall:** filter diffs for the plan dir with `git -c core.quotepath=off` or the `ai/plans/` exclusion silently fails (45 vs 26 files).
3. **Broader cross-layer sweep** surfaces 7 pre-existing `@/backend/services|@/backend/db` hits, all in `frontend/graphql/test/**` (outside the plan's gate scope — components/views only, test-excluded). Left untouched; noting in case a future plan wants a repo-wide rule.
4. **Next actions (16b):** full suites (`test:services`, `test:graphql`, journey via mandated runner, `bun test`-equivalent `bun run test`), `bun biome:check` / `lint-service --id final` deltas, `bun quality-gate`, then Task 16's `outcome/16-final-gate-outcome.md` consolidation.
