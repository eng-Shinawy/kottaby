# Plan Review Gate — Round 1 (Phase 1.5)

**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`
**Artifacts reviewed:** `specs.md` · `plan.md` · `tasks.md` · `deferred-items.md`
**Date:** 2026-09-21 · **Method:** `@plan-review` skill — 3 parallel layer-scoped reviewers (types+repo+db-test / services+graphql / locale+workflows+cross-cutting), every citation spot-verified against code.

## R1 Findings (6 — all resolved before gate exit)

| # | Layer | Finding | Fix |
|---|---|---|---|
| F1 | backend/db/test | tasks.md pointed the subscription repo test at non-existent `backend/db/test/repo/billing/subscription.repository.test.ts` | Re-pointed to the real `backend/db/test/logic/billing/subscription.repository.test.ts` (verified to exist) |
| F2 | backend/db/repo | `findLatestActivePlanIdForLane` SQL sketch carried a hardcoded `'active'` literal, contradicting REQ-002.3; Task 4.SR's value-enum checklist omitted `SubscriptionStatus` | Sketch now binds `$2 = SubscriptionStatus.Active` with the `findActiveWithPlan` (:322-325) precedent cited; 4.SR lists `SubscriptionStatus` |
| F3 | citations | `hasUncoveredExpiredLane` cited as `subscription.repository.ts:453-491` — file is 484 lines, method spans :453-483 | Corrected in plan.md (×3) and specs.md (×1); R2 grep confirms zero `453-491` remain |
| F4 | specs.md | `queryDb` bare-read rule misattributed to `backend/db/repo/AGENTS.md` | Re-attributed to `backend/AGENTS.md` "Bare Reads" (:24); tx-last convention attributed to the repo docblock (`progress.repository.ts:14-27`) |
| F5 | concurrency (highest severity) | `FOR UPDATE` on the progress pointer row cannot close the first-insert race (missing row = nothing to lock) → two concurrent first settlements could insert duplicate pointer rows | Model changed: increments serialize on `StudentRepository.findByIdForUpdate` (`student.repository.ts:299`, always-existing row). Touchpoints rewritten: plan.md §3.1, §5.1 step 4, §5.3 (no `…ForUpdate` repo variant), §6 model/locking inventory; tasks.md Task 2 repo list + T3 leg + Task 9 doc keywords + Task 5 gains a two-sessions race leg |
| F6 | backend/graphql | §4.3 resolver passed `ctx.user.role` (raw `user_role` string union) where the service takes `UserRole` | Resolver now narrows and passes `ctx.role: UserRole \| null` (`gqlContextFactory.ts:82`, populated via `toUserRole` at :227) |

## R2 Verification Round

Independent re-verification of all six fixes + regression sweep: **all FIXED**, no regressions, citations byte-accurate.

**R2 verdict: Plan passes all AGENTS.md rules.**

## Carry-Overs for Implementers

- Portal surface (`parentChildProgress`) intentionally untouched — deferred item D4.
- Zero schema delta: run only `bun run generate:gqlSchema` + `bun codegen` (Task 7); never `db push` here.
- Journey file is built test-first (Task 5 red → Task 6 hook green).
- The progress repo adds NO `ForUpdate` variant on purpose — serialization is the student-row lock in the service layer (R1-F5).
