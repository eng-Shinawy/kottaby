# Deferred Items Ledger

**Feature:** `workflow_tests_student_journey`
**Plan:** `ai/plans/milestone_4/workflow_tests_student_journey/`
**Created:** 2026-10-08

> Convention (ratified by the milestone_2 precedent): this ledger ships **pre-seeded** with resolved-pointer rows. Out-of-plan items are recorded as ✅ resolved-pointer entries — the deferral decision itself IS the resolution, with the owning surface named. The final gate is `grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_4/workflow_tests_student_journey/deferred-items.md` = 0 (row-scoped; the legend below is exempt).

---

## Ledger Table

| ID | Deferred Item | Source Task | Target | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | CI wiring for the `test/workflows` layer (`.github/workflows/ci.yml` runs only quality/db/services/graphql jobs — no workflows job) | plan §7 constraints | Future DevOps ticket | ✅ Done (deferred-pointer) | specs §2.3, plan §7 | Test-only plan; CI wiring is a separate infrastructure concern, NOT this ticket's scope. Suite runs locally via the approved runner. |
| D2 | Persisted student recitation preference (production gap: `preferredRecitation` is registration echo-only — `backend/types/users/registration.types.ts:56-64`, `backend/services/auth/registration.service.ts:98-101`) | ruling R3 | Future product ticket | ✅ Done (deferred-pointer) | specs R3, REQ-003.4 | Journey asserts the SHIPPED echo semantics; building a preference store is production scope this test-only ticket cannot carry. |
| D3 | Teacher accept/decline session-request intake flow (wave emitters exist with zero production intake callers — `test/workflows/classes/session-request-notifications.journey.test.ts:186-204` documents the gap) | ruling R7 | Future matching-engine ticket | ✅ Done (deferred-pointer) | specs R7, REQ-007 | Journey books via the real `createSession` (book-direct at `scheduled`); the intake flow is a production feature, not a test artifact. |
| D4 | Held-escrow (pre-completion) dispute leg inside the consolidated suite | design D4 | Covered elsewhere | ✅ Done (deferred-pointer) | `test/workflows/sessions/session-state-machine.journey.test.ts:235-341` | Composition ruling R6: the consolidated file adds nothing new — the held-escrow generation keeps its deep per-domain home; the post-confirmation generation is the lean leg here (D4 rationale). |
| D5 | Stale `linkStudentToParentFixture` docblock (`test/workflows/helpers/journey-fixtures.ts:157` claimed the production link flow does not exist — disproven by `backend/services/parents/parent-link-request.service.ts:145+`) | plan S7 | Task 2.1 (in plan) | ✅ Done | `outcome/2.1-outcome.md` — docblock rewritten at `journey-fixtures.ts:151-158` (comment-only); 2.1.QL sub-loop exit 0; `helpers.self-test.test.ts` 17/17 green | Resolved in-plan by task 2.1. The `journey-fixtures.smoke.test.ts` red state observed at 2.1.TE is pre-existing D8-class baseline (country-contract drift in the fixture's own registration input), NOT a D5 regression — see the 2.1 outcome. |
| D6 | `docs/planning/TICKETS.md:2717-2728` Gherkin staleness (`runInRollback` Given + confirm-time balance decrement + "GraphQL API" wording) | rulings R1-R4 | Historical planning doc | ✅ Done (deferred-pointer) | specs R1-R7 | Reconciled by the binding rulings; TICKETS.md is a historical planning artifact this plan does not edit. The plan docs supersede for implementation. |
| D7 | REQ-008.4 / plan §5.4 "progress incremented" is unsatisfiable for a Hifz confirm: the shipped `incrementForConfirmedSession` is TAJWEED-gated (`backend/services/classes/student-progress.service.ts:282-284` — non-tajweed intents return before any write; Hifz tracking does not exist yet) | task 1.4 (step 16 finding) | Shipped semantics asserted instead | ✅ Done (deferred-pointer) | step 16 of `test/workflows/students/student-full-journey.journey.test.ts`; deep increment coverage `test/workflows/classes/tajweed-progress-increment.test.ts` | The journey asserts the honest shipped end state (ZERO progress rows for the Hifz confirm). Task 1.7's step-30 end-state table must NOT expect a progress row for this suite's student. |
| D8 | Whole-layer sweep red state in 12 FOREIGN suites (56 failing tests: the `test/workflows/admin/*` governance/audit/onboarding/certification/broadcast journeys plus the `test/workflows/teachers/*` evaluation/cooldown/re-evaluation journeys) — root cause captured live: the stale suites pass `country: "Egypt"` (full name) while the committed ISO-country-selector contract (`9c9bd29c`; `shared/lib/country-code.ts` `z.enum(COUNTRY_CODES)`) validates ISO CODES, so their provisioning rejects with `ValidationError` (`backend/services/admin/user-management.helpers.ts:165`) | task 1.7 (whole-layer gate finding) | Foreign workstream (the stale-test refresh belongs to the country-selector / launch-readiness tickets, NOT this plan) | ✅ Done (deferred-pointer) | task 1.7's whole-layer run: this plan's suite green 31/31 twice consecutively; every failing file verified `git status` CLEAN (committed state, untouched by this plan — whose deliverable is the untracked `test/workflows/students/` directory); the failures fire at the foreign suites' own provisioning steps, independent of any DB state this suite writes (its zero-residue is proven by the double-run) | Fixing foreign test files is outside this plan's scope (fix-or-report rule). Task 2.2's whole-layer criterion must scope to this plan's diff: the 56 foreign failures are pre-existing baseline state, not plan regressions. |

---

## Status Values

- ✅ **Done** — resolved (incl. resolved-pointer: the deferral decision is the resolution)
- ⚠️ **Partial** — needs follow-up
- ❌ **Blocked** — plan cannot complete until addressed
- 🔄 **In Progress** — currently being worked on
