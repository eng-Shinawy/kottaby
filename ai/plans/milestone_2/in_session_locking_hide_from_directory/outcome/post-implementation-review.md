# Post-Implementation Review Wave

**Plan:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/`
**Scope:** `git diff --name-only` vs Phase 0 baseline (origin/main @ 6da6a526) — all backend + test + docs files of the branch
**Method:** four parallel review subagents (review-types, review-backend, review-frontend, pentester) — each re-read the plan + all outcome files + applicable rule files; pentester ran LIVE PostgreSQL 17.11 race probes against the shipped SQL semantics.

---

## Round 1 findings (aggregated, deduplicated; pre-existing filtered)

| # | Sev | Source | Finding |
|---|-----|--------|---------|
| 1 | MEDIUM | review-backend + pentester #1 (dup) | `releaseInSessionLock` double-defer strand: the `NOT EXISTS(started)` probe evaluates pre-lock; two concurrent terminal exits of the same teacher's two `started` sessions can both classify `active_sessions_remain` (guard-failing UPDATE writes nothing → no row-lock serialization) and commit, stranding the lock permanently. **Empirically reproduced on live PG 17.11** (both releases defer; final state marker set + zero started rows). |
| 2 | MEDIUM | pentester #2 | `setAvailabilityIntent` Available-direction guard's "race-closed" attribution is false as documented: a blocked guarded UPDATE lands via EPQ re-check reusing the stale one-time-filter result. The invariant holds in the shipped composition ONLY because the sole caller (`setAvailability`) holds `lockForCertificationCheck`'s FOR UPDATE row lock across the toggle transaction — an undocumented emergent property; any future caller without that lock would silently re-open INV-A2. |
| 3 | LOW | review-types | `TeacherInSessionLockReleaseOutcomeType` dead export (knip: zero importers; plan §2.2 mandates the vocabulary). |
| 4 | LOW | review-backend | Plan §10 service-tier "two-started-sessions deferral matrix" absent from the INV-S6 suite (pinned only at repo tier + journey). |
| 5 | LOW | review-backend | Plan §10 "zero setOnline references remain" source pin not implemented as a test. |

**review-frontend: FINDINGS: 0** — zero-UI-drift structurally proven (0 files under frontend/app/locale/storybook/graphql in the diff; consumed surfaces byte-unchanged; no new locale keys; no marker exposure).

## Fix phase

| Finding | Fix (cluster) | Evidence |
|---|---|---|
| 1 | `releaseInSessionLock` opens with a teacher-row `SELECT … FOR UPDATE` serialization preamble (zero-row → `null` fail-closed); docblock states the both-defer rationale; TWO new cross-connection race tests via the real-Postgres `testOnRealPostgres` harness (double-complete interleave + both-committed race) proving exactly-once restore. | `outcome/post-fix-A-outcome.md`; repo suite 82/0; commit a1ebfea2 |
| 2 | Docblock truthing (primitive + service): guard = defense-in-depth; serialization = caller's FOR UPDATE obligation; NEW static source pins (zero `setOnline` in service source; `lockForCertificationCheck` precedes `setAvailabilityIntent`). | `outcome/post-fix-B-outcome.md`; service suite 66/0 |
| 3 | Production consumption: typed disambiguation `const outcome: TeacherInSessionLockReleaseOutcomeType = …` in the repo; knip `check:unused` exit 0. | `outcome/post-fix-A-outcome.md` |
| 4 | Two new INV-S6 verdicts (true + false marker variants): first exit defers (marker intact, one deferred-debug), second restores per original marker. | `outcome/post-fix-C-outcome.md`; INV-S6 83/0 |
| 5 | Same static-pin test as fix 2 (service source `setOnline`-free). | `outcome/post-fix-B-outcome.md` |
| carry-overs | Truthful test naming (repo ~:1744) + state-machine doc anchor refresh (`:624`/`:751`). | `outcome/post-fix-E-outcome.md`; repo 82/0 |

## Re-review verdict

Fix clusters A/B/C/D/E verified: sub-loop exit 0 on every touched file · `bun tsgo` 0 errors · repo 82/0 · INV-S6 83/0 · availability 66/0 · governance 52/0 · enforcement 17/0 · journey 17/0 · knip clean · zero scope creep. **Zero feature-specific findings remain** (pre-existing-filtered items unchanged: 4.1's two RED suites on origin/main, oxlint tsgolint OOM, disputed-window D5, deploy-cutover transient).

Verification of the fixed race finding's re-review is reinforced by the independent review iterations R1–R10 (each recorded in `outcome/round-R<N>-review-outcome.md`; R1 fixed stale doc anchors at c9f078b9, R2 ratified the preamble amendment into plan/specs at c81b91d9, R3 corrected outcome-file prose).
