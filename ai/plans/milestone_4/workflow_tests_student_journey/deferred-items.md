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
| D5 | Stale `linkStudentToParentFixture` docblock (`test/workflows/helpers/journey-fixtures.ts:157` claims the production link flow does not exist — disproven by `backend/services/parents/parent-link-request.service.ts:145+`) | plan S7 | Task 2.1 (IN PLAN) | 🔄 In Progress | — | The ONLY in-plan deferred item; comment-only fix, resolved by task 2.1. |
| D6 | `docs/planning/TICKETS.md:2717-2728` Gherkin staleness (`runInRollback` Given + confirm-time balance decrement + "GraphQL API" wording) | rulings R1-R4 | Historical planning doc | ✅ Done (deferred-pointer) | specs R1-R7 | Reconciled by the binding rulings; TICKETS.md is a historical planning artifact this plan does not edit. The plan docs supersede for implementation. |

---

## Status Values

- ✅ **Done** — resolved (incl. resolved-pointer: the deferral decision is the resolution)
- ⚠️ **Partial** — needs follow-up
- ❌ **Blocked** — plan cannot complete until addressed
- 🔄 **In Progress** — currently being worked on (D5 → task 2.1)
