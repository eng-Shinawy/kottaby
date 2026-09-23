# Mid-Point Review Report — Round 1 (Task 5)

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Scope:** Backend phases only (Tasks 2–4): schema delta, weakness enum + guard, constants, backend types, i18n keys, error-map rows, repository extensions, repo tests.
**Date:** execution session (branch `feat/evaluation_rubric_scoring`)
**Reviewers dispatched (parallel):** `review-backend`, `review-types`, `review-config`

---

## Round 1 — Findings Aggregated (pre-fix)

| # | Severity | Location | Finding | Reviewer |
|---|---|---|---|---|
| 1 | LOW | `backend/db/repo/teachers/evaluation.repository.ts:97` | Dead `value !== null &&` conjunct in `toWeaknessAreaMember` — `isRubricWeaknessArea` already fails closed on null | review-backend |
| 2 | LOW | `backend/db/repo/teachers/evaluation.repository.ts:41` | Header docblock soft-delete bullet did not state the quorum read's (`listCycleRubricSubmissions`) deliberate unfiltered posture | review-backend |
| 3 | LOW | `backend/db/test/repo/teachers/evaluation.repository.test.ts:804` | Tier-2 cycle-window probe covered −60s/+1s but not the exact boundary instant (`created_at === cycleStart` must be INCLUDED) | review-backend |
| 4 | MEDIUM | `kottaby_test` (DB provisioning) | Test DB missing `pg_trgm` extension + `is_valid_timezone` function present in `kottaby_db` (provisioning drift; drizzle-kit blind to it) | review-config |
| 5 | LOW | `outcome/2-schema-outcome.md:55` | Self-contradictory ordinal claim ("directly after notes" vs actual appended-at-end ordinal 11) | review-config |
| — | — | `review-types` scope (types/constants/i18n/error-map) | **0 findings — CLEAN** (1 non-blocking pre-existing note: `shared/locale/types/sessions/labels.ts:288` plan-era comment from an earlier plan, filtered per baseline rule) | review-types |

**Pre-existing issues filtered:** all baseline counts were 0; the `sessions/labels.ts:288` comment predates this plan's diff (excluded).

---

## Fix Phase

| Fix subagent | Files | Fixes |
|---|---|---|
| fix-agent (Task 5) | `evaluation.repository.ts`, `evaluation.repository.test.ts`, `2-schema-outcome.md` | Findings 1–3 + 5 fixed (dead conjunct removed; docblock sentence added; boundary probe added inside the existing Tier-2 test — suite stays 39 pass/0 fail; ordinal claim corrected to "appended at table end, canonical order = Drizzle source declaration order") |
| orchestrator (env maintenance) | `kottaby_test`, `kottaby_db` | Finding 4 fixed: `CREATE EXTENSION pg_trgm` + `backend/db/migration/1-extensions.sql` (adds `is_valid_timezone`) + `backend/db/migration/2-functions.sql` (adds `current_user_id`) applied to BOTH DBs — full provisioning parity verified via pg_dump/`pg_proc` comparison |

---

## Re-Review (Round 1 verification) — GATE CLEAN

- Finding 1 — FIXED VERIFIED (dead-branch rule satisfied; both branches reachable)
- Finding 2 — FIXED VERIFIED (docblock matches actual WHERE clause)
- Finding 3 — FIXED VERIFIED (boundary session at `createdAt === cycleStart` asserted INCLUDED, ordered first)
- Finding 4 — FIXED VERIFIED (both DBs: pg_trgm ✓, is_valid_timezone ✓, current_user_id ✓, rubric_weakness_area ✓, weakness_area ✓)
- Finding 5 — FIXED VERIFIED (doc corrected, facts confirmed against live DB)

**Gates:** `bun tsgo` → 0 errors; `evaluation.repository.test.ts` → 39 pass / 0 fail (143 expects); sub-loop exit 0 on both code files; zero plan-artifact references in code (the test file's single regex match is its own anti-plan-artifact guard).

**TOTAL: 0 new findings — GATE CLEAN (1 round, 5 findings, 5 fixed)**

---

## Carry-Forward to Phase 3 (Tasks 6–7)

- Repo layer returns sealed rows only; verdict logic lives in the service (Task 6).
- `listCycleRubricSubmissions` must be called after `findForBookingGate` FOR UPDATE in the SAME tx.
- Raw 23505 on `evaluations_session_evaluator_unique` propagates uncaught from `insertOnce` → service maps to `EVALUATION_ALREADY_SUBMITTED`.
- `transitionToFailed` returns null on 0 rows → service raises `APPLICANT_ALREADY_FINALIZED` + rollback.
- `findBySessionAndEvaluator` deliberately unfiltered by soft-delete (pre-check must see what a colliding insert hits).
- Enum value-import obligation: `RubricWeaknessArea`/`ApplicantStatus`/`SessionType`/`SessionStatus` as value imports in service runtime expressions.
- i18n seams for Task 6: 4 `applicant` notification keys (fail body carries `{cooldownUntil}` ICU placeholder) + 7 `errors` keys bijection established.
