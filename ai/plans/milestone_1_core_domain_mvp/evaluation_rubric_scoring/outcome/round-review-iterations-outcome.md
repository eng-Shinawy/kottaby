# Review Iterations Record — Independent Fresh-Reviewer Sweeps

**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`
**Protocol:** each iteration = one independent fresh reviewer subagent (no prior-iteration context) covering the complete plan diff vs the pre-plan baseline commit `6bf6c71`; stop condition = 0 new findings in 2 consecutive iterations.

---

## Context: prior review coverage before the iteration loop

- Mid-Point Review Gate (Task 5): 5 findings (1 MEDIUM + 4 LOW) → all fixed → re-review GATE CLEAN.
- Post-Implementation Review Wave (Task 12): 4 parallel reviewers (backend/frontend/types/pentester) → 9 actionable findings (1 MEDIUM + 7 LOW) + 2 INFO → all fixed → re-review WAVE CLEAN.
- Final Gate (Task 13): lint loop caught 7 assertion-less transport tests → direct assertions added → lint clean.

## Iteration Ledger

| Iteration | Focus | Findings | Disposition |
|---|---|---|---|
| 1 | Full 4-angle sweep (types/backend/frontend/security) | **0 — CLEAN** | — |
| 2 | Concurrency/correctness/contract/UI/security re-derivation | **4** (1 MEDIUM + 3 LOW): silent `TEACHER_NOT_CERTIFIED`/`APPLICANT_NOT_IN_EVALUATION` denials (no error-link rows); pending-read window capped at 25 losing the CTA; pending-page predicate missing the `intent = evaluation` leg; dead `RubricSubmissionInsertInput` | All 4 fixed in commit `f7175c2`; suites re-verified (error-link 40/0, repo 24/0, transport 15/15, journey 16/16, tsgo 0) |
| 3 | Error-surface closure/gate parity/state machine/dead exports | **6 LOW**: `APPLICANT_STATUS_CORRUPT` unmapped; 2 dead exports; silent failed pending `useQuery`; + 2 by-design surfaces documented | 4 fixed in commit `8a27b3a`; 2 plan-mandated surfaces docblocked as by-design; suites re-verified (error-link 41/0, arms 19/0, transport 15/15, journey 16/16, tsgo 0) |
| 4 | Full-diff hygiene + error-surface closure + hook state machine | **0 — CLEAN** | — |
| 5 | Security/data-integrity (BOLA, injection, notes hygiene, scope, `any`) | **0 — CLEAN** | — |

## Stop Condition

**Iterations 4 and 5 returned 0 new findings consecutively** (iteration 1 was also clean) — the stop condition is satisfied after 5 independent iterations. Every code raised over the wire now has a mapping row and localized copy; every read/write gate predicate is paired; no client-controlled identity reaches the data layer; `notes` is confined to the sealed insert payload.

## Cumulative Review Totals (this plan)

- Findings found across all waves + iterations: **24** (3 MEDIUM + 20 LOW + 2 INFO-by-design + pre-existing filtered)
- Fixed in-plan: **22**; documented by-design: **2**
- Outstanding: **0**
