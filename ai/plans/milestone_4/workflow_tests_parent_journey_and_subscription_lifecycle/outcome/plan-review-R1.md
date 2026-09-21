# Plan Review Report — Workflow Tests: Parent Journey & Subscription Lifecycle

<!-- Plan Directory: ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/ -->

## Review Round: 1

- **Date:** 2026-09-21
- **Subagents Dispatched:** 3 read-only verifiers (dimension-1 verify-paths-exist,
  dimension-2 verify-layer-rules-compliance, dimension-3 verify-cross-ref-and-ticket-coverage)
- **Outcome Directory:** `ai/plans/milestone_4/workflow_tests_parent_journey_and_subscription_lifecycle/outcome/`

## Summary

| Total findings | Blocking (CRITICAL/HIGH) | MEDIUM | LOW / observations |
|---|---|---|---|
| 14 | 1 | 7 | 6 |

Verdict BEFORE fixes: plan was architecturally sound (all 12 `test/workflows/AGENTS.md` hard rules
compliant, no production-code changes proposed, 76/80 citations exact) but carried real defects
that would have misdirected execution. All findings were fixed in the plan files; traces below.

## Findings by Dimension

| Dimension | Result |
|---|---|
| verify-paths-exist | 2 MEDIUM mismatches + 2 LOW imprecisions (of 80 citations) |
| verify-layer-rules-compliance | 12/12 hard rules CLEAN; 2 MEDIUM (seam over-claim, wrong-file citation), 4 LOW |
| verify-cross-ref-and-ticket-coverage | traceability CLEAN (all REQs, all 11 ticket scenarios mapped); 1 HIGH actor misattribution |

## Detailed Findings & Fixes Applied

| # | Sev | Location | Finding | Fix Applied |
|---|---|---|---|---|
| 1 | HIGH | specs.md J1 actor table + step 12; tasks.md Task 1 | Session booking was attributed to Teacher T; the real `SessionLifecycleService.createSession` treats the STUDENT as acting caller and the debit ladder requires student balance | Rewrote: S1 books with a provisioned trial lane (oracle `parent-session-completion-deep-link.journey.test.ts:288,408`); T starts/completes/submits report. Actor table + task bullet aligned. |
| 2 | MED | specs.md REQ-6 AC4; plan.md Architecture | Blanket "inject `SpiedFanoutTransport`" overstates the seam — `SubscriptionPurchaseService.purchase` (`subscription-purchase.service.ts:486-492`) exposes no options/transport param | Carve-out: inject where the seam exists; rule-5 namespace `spyOn` fallback for the purchase leg (precedent `subscription-purchase.journey.test.ts:150`). |
| 3 | MED | plan.md C7 row | `zeroLaneIfNoCoveringSubscription` cited at `subscription.repository.ts:453-482` — that range is `hasUncoveredExpiredLane` | Corrected to wrapper `student.repository.ts:483-489` + impl `student.repository.zero-lane.helpers.ts:95`. |
| 4 | MED | plan.md SDL table | `parentChildrenUpcomingSessions` does not exist | Correct field is `myChildrenUpcomingSessions` (`parent-monitoring.query.ts:255`); row rewritten with all seven fields. |
| 5 | MED | plan.md SDL table | cron route cite `:19-21` lands on a doc comment | Corrected to `:5-6,28` (CRON_SECRET contract + fail-closed factory invocation). |
| 6 | MED | specs.md REQ-0 AC1 vs plan/tasks | biome warnings demanded but no baseline command existed | Added `bun run biome:check … grep -c "warn"` to plan.md Phase-0 commands and tasks.md Task 0.1. |
| 7 | MED | deferred-items.md | enforcement grep `grep -c "❌\|⚠️"` could never return 0 (legend lines contain the glyphs) | Ledger-scoped grep (`grep '^| D' …`); legend rewritten glyph-free. |
| 8 | LOW | plan.md overview + D-2; tasks.md 3.4 | "five parent / four billing suites" contradicted by 7 billing files; D-2 said "seven existing journey suites" | Overview/D-2/3.4 now say 5 parent + 7 billing; coverage table footnote lists the 3 unrelated billing files as untouched. |
| 9 | LOW | specs.md REQ-1 AC8 vs tasks.md Task 1 | tasks said "all seven portal surfaces" while docs enumerated six | AC8, step 14, and Task 1 now enumerate the six per-child reads + parent-level `listChildrenUpcomingSessions` (`parent-monitoring.service.ts:449`). |
| 10 | LOW | specs.md REQ-2 details | GraphQL-tier cite implied proof for 4 mutations; it proves 3 (+report-write scope) | Split cites: `session-lifecycle-mutations.test.ts:337,367,379` + `session-report.wire.test.ts:18-19`; `confirmSessionCompletion` parent-denial flagged as landing at neither tier until this plan. |
| 11 | LOW | plan.md D-3 | "mixed mechanism proven by handshake-discovery :65,:273" — that file is pure real-registration | Reworded: two separately-proven precedents (real registration; tx-scoped provisioning) composed here. |
| 12 | LOW | tasks.md 3.4 | `git diff --name-only` would trip on unrelated pre-existing dirty files | Scoped to `git status --porcelain -- test/workflows/ docs/testing/`. |
| 13 | LOW | specs/tasks | step-13 foreign-parent zero-fan-out probe absent from Task 1 bullet | Added to Task 1 chain legs (1.SEC covers read denials; chain bullet now carries the fan-out isolation probe). |
| 14 | LOW | plan.md security table; schema table; proration cite | `:419-432` half-supported the ForbiddenError claim; `plans.ts:29` excluded 3 columns; proration range stopped before the clamp | Corrected to `:379-406`, `plans.ts:25-29`, `subscription-proration.helpers.ts:139-175`. |

## Explicitly Verified Clean (no fix needed)

- All 12 `test/workflows/AGENTS.md` hard rules honored by both journeys' step lists.
- REQ↔task traceability grep: zero MISSING. All 11 ticket test scenarios map to REQ ACs.
- Journey-2 steps consistent across specs/plan/tasks (11/11), actor tables aligned.
- `grep -rn 'upgrade' test/workflows` → zero hits (the journey-tier upgrade gap is real; REQ-5 closes it).
- No production-code changes proposed anywhere in the plan; new filenames are unused.
- Documented deviations (D-1): `runInRollback` wording and "GraphQL API" wording of the ticket
  Gherkins — both resolved with citations; rule-precedence note added to tasks.md for the
  `getServerTranslations` instruction conflict (journey rule 6 wins; green precedent
  `parent-link-request.journey.test.ts:92,95`).

## Post-Fix Verification

- Traceability loop re-run after fixes: zero MISSING.
- Tails of all four artifacts read — no truncation.
- `grep '^| D' deferred-items.md | grep -c "❌\|⚠️"` → 0 (enforcement predicate is now
  satisfiable and currently clean).

## Lessons for Future Plans

1. Actor attribution for `createSession` must be the STUDENT (debit ladder + governance assert are
   callee-scoped) — cite the deep-link oracle's provisioning pattern when in doubt.
2. Notification interception is seam-dependent: check for an injected `options.transport`
   parameter before promising `SpiedFanoutTransport`; purchase uses the namespace-spy fallback.
3. Repo-file citations: `hasUncoveredExpiredLane` (billing repo) vs `zeroLaneIfNoCoveringSubscription`
   (students repo) are easy to conflate — verify per symbol, not per topic.
4. Ledger self-checks must exclude legend/prose lines from their own grep predicates.

## Traceability

- Plan files modified in this round: `specs.md`, `plan.md`, `tasks.md`, `deferred-items.md`.
- This report: `outcome/plan-review-R1.md`. Re-review verdict after fixes: **Plan passes all
  AGENTS.md rules for affected layers; zero unresolved findings.**

## Next Steps

- Task 0 (baseline) may begin; executing agents must read this file and the rest of `outcome/`
  first (REQ-0 AC3).
