# Task 0.1 Outcome — Pre-Implementation Error Baseline & Deferred-Ledger Verification

**Task:** 0.1 (Record Error Baseline & Initialize Deferred-Items Ledger) · **Requirement:** REQ-001 (`specs.md:67-90`)
**Date:** 2026-10-04 · **Branch:** `feat/in_session_locking_hide_from_directory` · **Commit at capture:** `6da6a526` (clean tree)

---

## 1. Baseline Numbers (the REQ-001 comparator)

These are the authoritative pre-implementation values. Every post-implementation review wave (sub-loop / SR / IV / 6.1 final gate) MUST compare against them; anything above these counts is NEW and must be fixed or ledgered — anything at or below is pre-existing and ignored.

| Check | Command | Baseline value | Raw file |
|---|---|---|---|
| **tsgo errors** | `bun tsgo 2>&1 \| grep "error TS" \| wc -l` | **0** | `/tmp/baseline-tsgo.txt` |
| **biome warnings** | `bun biome:check 2>&1 \| grep -c "warn"` | **0** | `/tmp/baseline-biome.txt` |
| **lint-service** | `bun run scripts/lint-service.ts --json --id baseline` | **success** | `/tmp/baseline-lint.json` |
| **git stash list** | `git stash list` | **0 entries** (empty) | `/tmp/baseline-stash.txt` |
| **modified files** | `git diff --name-only` | **0 files** (empty) | `/tmp/baseline-files.txt` |

### Check details

- **tsgo** (`tsgo -b --noEmit` via `scripts/lib/run-locked-cmd.ts`): exit 0, **zero `error TS` lines**. Run twice for confidence: first full run (count 0), second cached run captured raw (`/tmp/tsgo-raw.txt`, 4 lines: banner + process-lock enqueue/acquire/release, no diagnostics). The build-mode cache makes repeat runs fast (~20 s).
- **biome** (`biome check --write --unsafe .` via lock wrapper): exit 0, **"Checked 2635 files in 17s. No fixes applied."** — zero `warn` occurrences. NOTE: `biome:check` is defined with `--write --unsafe` in `package.json`; it applied **no fixes** and left the tree byte-identical (verified: `git status --porcelain` diffed empty before vs. after the run), so the git baseline below was not perturbed by the capture itself.
- **lint-service** (`--json --id baseline`, full-repo scope): `{"success": true, "output": "", "exitCode": 0, "metrics": {"scope": "full-repo", "durationMs": 155017}}` — zero findings. (The JSON blob is preceded by three `[process-lock]` banner lines; the `output` field itself is empty = no violations.)

## 2. Baseline Modified-File List (`git diff --name-only`)

**EMPTY — zero files modified.** No stashes. The working tree is exactly at branch commit `6da6a526` ("Milestone 2 plans…" #296). Nothing to carry as pre-existing modifications.

**Anomaly recorded (no action needed):** at task start the checkout was on `main`, not the feature branch named by the plan. `main` and `feat/in_session_locking_hide_from_directory` point to the **same commit `6da6a5265c2c85f01ffccd359bfef33a0a714f7f`** with a zero-file content delta, so the executor checked out the feature branch before capturing (content-identical, baseline unaffected). The branch is up to date with its remote tracking ref.

## 3. Pre-Existing Issues to IGNORE During Post-Implementation Review

**None.** The baseline is fully clean (0 tsgo errors, 0 biome warnings, lint-service success). Two benign tooling behaviors to not mistake for failures:
1. `grep -c "warn"` / `grep "error TS"` exit with status 1 when the count is 0 — that is grep's no-match exit, not a tool failure.
2. All three quality tools route through `scripts/lib/run-locked-cmd.ts` and print `[process-lock] Enqueued/Acquired/Released` banner lines to stdout/stderr — ignore these lines; they are queue telemetry, not diagnostics.

## 4. Deferred-Items Ledger Verification (VERIFY-only — no edits made)

Ledger at `ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md` was verified as already-seeded and complete. **Every row D1–D8 carries an owner target and a rationale; every status is a resolved-pointer (or resolved-by-sequencing); gate = 0. No discrepancies found; no fixes required.**

| ID | Deferred item | Owner target — verified | Rationale — verified | Verdict |
|---|---|---|---|---|
| D1 | Real accept/decline session-request intake | **Dev 3 — On-Demand Matching** (`docs/planning/TICKETS.md:1457`) | accept-moment ≙ `startSession` (INV-A2 binds `started`, `docs/specs/state-machine-invariants.md:121`); booking stays lock-free; lists all five zero-caller emitters (`session-request-notification.service.ts:229-276`) | ✅ complete |
| D2 | Directory read-side (INV-A3 consumer) | **Dev 3** — `TICKETS.md:1457` **and** `TICKETS.md:1509` (Teacher Directory Browse & Filter API — both headings spot-verified at those lines) | forward contract: compose `is_online=true` AND the `assertTeacherNotInActiveSession` oracle — never `is_online` alone (`docs/teachers/teacher-availability.md:297`) | ✅ complete |
| D3 | 15-min sweep composition | **`TICKETS.md:1298`** (15-Minute Inactivity Auto-Offline — heading spot-verified; Dev 2, 5 SP) | sweep MUST NOT auto-offline a teacher holding a `started` session (its own AC `TICKETS.md:1322-1324`); `last_active_at` freshness gating REJECTED with reasoning | ✅ complete |
| D4 | Booking-time availability gate | **Dev 3 — matching flow** (`TICKETS.md:1457`) + TOCTOU rule `docs/backend/cross-stream-contracts.md:117-119` | reject-vs-hide is a matching-flow product decision; this ticket keeps `bookSessionInTx` untouched (`session-lifecycle.booking.ts:245-261`) | ✅ complete |
| D5 | INV-A2 gate widening to `disputed` | **Pending product ruling**; candidate owner: dispute/arbitration surface or Dev 3 escalation flow | invariant text is spec of record (`state-machine-invariants.md:121` binds `started`); marker keeps arbitration release consistent/idempotent | ✅ complete |
| D6 | `inSession`-style availability flag | **REJECTED BY CONTRACT** — forbidden-field registry `docs/backend/cross-stream-contracts.md:56` (row spot-verified verbatim: "No parallel inSession flag exists; exclusability via `isOnline` only") | never build; consumers compose the session-state oracle with `is_online` | ✅ complete (rejected) |
| D7 | `last_active_at` heartbeat cadence | **`TICKETS.md:1298`** (B.15 / A.7) | only writers today are registration + login `touchLastActiveAt` (`auth.service.ts:514-516`); this ticket never reads the column | ✅ complete |
| D8 | `setOnline`-deletion ordering guard | **Task 3.4** (final grep + delete) — split across 2.4/3.4 per the dependency graph `2.2 → 2.3 → 2.4 → 3.1 → 3.2 → 3.3 → 3.4` | **✅ resolved-by-sequencing** — an execution-order guard so the tree never holds a dangling import; verify with the `setOnline` grep (tests excluded) at 3.4 completion | ✅ complete |

**Gate:** `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` → **0** (expected 0; the legend's ❌/⚠️ symbols at `deferred-items.md:34-35` are outside table rows and correctly not counted by the row-anchored pattern, as documented at `deferred-items.md:38`).

Carry-over from plan-review R1 (still open, by design): flip D8's status note when the final `setOnline` grep is clean at task 3.4.

## 5. Evidence — These Numbers Are the REQ-001 Comparator

- REQ-001 AC-1 (`specs.md:69`): "WHEN implementation begins THEN the system SHALL record baseline counts (`bun tsgo …`, `bun biome:check …`, `bun run scripts/lint-service.ts --json --id baseline`) into `/tmp/baseline-*.txt` and mirror them into `outcome/0-baseline-outcome.md`." — Satisfied: all three commands ran verbatim, counts captured in `/tmp/baseline-tsgo.txt` (0), `/tmp/baseline-biome.txt` (0), `/tmp/baseline-lint.json` (success), and mirrored in §1 above.
- REQ-001 AC-2: ledger initialization — satisfied via the VERIFY path mandated by tasks 0.1 / plan-review fix #2: the ledger ships pre-seeded D1–D8 and was verified complete (§4), not re-created from the template.
- Baseline capture ran on the feature branch at the implementation start commit with an empty `git diff`, so "pre-existing" and "new" are unambiguous for every later comparison.

## 6. Files Created / Modified by This Task

- **Created:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/outcome/0-baseline-outcome.md` (this file)
- **Modified:** none (no source files touched; ledger verified, not edited; tasks.md checkbox left for the orchestrator)
- **Artifacts in `/tmp`:** `baseline-tsgo.txt`, `baseline-biome.txt`, `baseline-lint.json`, `baseline-stash.txt`, `baseline-files.txt`, plus evidence copies `tsgo-raw.txt`, `biome-raw.txt`, `pre/post-biome-status.txt`
