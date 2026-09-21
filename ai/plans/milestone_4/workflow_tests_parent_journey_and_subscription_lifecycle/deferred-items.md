# Deferred Items — Workflow Tests: Parent Journey & Subscription Lifecycle

**Feature:** Workflow Tests — Parent Journey & Subscription Lifecycle
**Plan:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/`
**Created:** 2026-09-21

## Purpose

Every work item discovered during planning/execution that is intentionally NOT done in this plan
is recorded here with its owning reroute. Enforcement at plan completion (scoped to ledger rows
only, so the legend below cannot trip it): `grep '^| D' deferred-items.md | grep -c "❌\|⚠️"`
must return 0.

## Ledger Table

| ID | Deferred Item | Source Task | Target / Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | GraphQL-tier chained journey (resolver-driven equivalent of both ticket chains) | Plan design (D-2) | Future GraphQL-hardening ticket | 🔄 In Progress | Task 3 | Per-domain GraphQL coverage already exists and stays green: `backend/graphql/test/parent-link.wire.test.ts`, `parent-monitoring.wire.test.ts`, `session-lifecycle-mutations.test.ts`; journey layer is service-level by definition (`docs/testing/workflow-journey-tests.md`) |
| D2 | Root `AGENTS.md` "five SDL queries" stale — portal exposes seven queries (`docs/parents/monitoring-portal.md:7,30`) | Planning audit | Hand-curated rule-file owner (plan work must not edit AGENTS.md) | 🔄 In Progress | Task 4 | Discrepancy recorded in Task 4's propagation doc note + outcome file |

## Status Values

- Done ✅ — item completed/resolved with evidence
- Partial — partially complete; remainder tracked
- Blocked — cannot proceed; escalated
- In Progress 🔄 — being worked / awaiting its target step

(The legend deliberately avoids the glyphs the enforcement grep scans for.)

## Usage Guidelines

- Task 3 flips D1 to ✅ once the layer run proves the existing GraphQL wire suites untouched and
  green (coverage stands; nothing further needed in this plan).
- Task 4 flips D2 to ✅ once the discrepancy is documented in
  `docs/testing/workflow-journey-tests.md` propagation notes + `outcome/4-…-outcome.md`.
- No other deferrals are anticipated; any new deferral discovered mid-execution MUST be appended
  here before the executing task is marked complete.
