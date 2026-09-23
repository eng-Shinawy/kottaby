# Deferred Items Ledger

**Feature:** Direct Student Onboarding with Offline Payment
**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/`
**Specs:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/specs.md`
**Plan:** `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/plan.md`
**Created:** 2026-09-21

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved (or re-pointed at an owning ticket with no ❌/⚠️ status remaining) before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task/Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D-ONB-001 | Teacher assignment during onboarding (named in FR-10.2 prose, `docs/specs/functional-requirements.md:263-264`) | plan §8 (pre-registered) | Future placement ticket (post-M3) | ✅ Done | specs.md §1 (OUT-of-scope table); TICKETS.md:2369-2394 | ABSENT from ticket acceptance criteria — OUT of scope per specs §1; the flow composes cleanly without it (no placement fields anywhere). Future extension lands additively on `AdminOnboardStudentSubmitInput`, never via a parallel surface (plan §9). |
| D-ONB-002 | `paymentReference` optional for scholarship (specs §2.9 J-3 step 1: "no `paymentReference`") | plan §1.3 D3 (pre-registered) | Post-M3 product decision | ✅ Done | plan §1.3 D3; tasks.md 2.4 (A-guard) | Kept REQUIRED for ALL three offline methods in v1 — a uniform reference is the human idempotency token (REQ-012.3 partial-unique guard); the scholarship leg supplies a unique reference (e.g. `SCH-<uuid8>`). The `subscriptions.payment_reference` column stays nullable, so the relaxation is non-breaking if the product later reverses this. |
| D-ONB-003 | Admin "parents directory" surface (the onboarding parent picker today queries `adminUsers` role-filtered) | plan §8 (pre-registered) | Future admin parents-directory UX ticket (post-M3) | ✅ Done | plan §8 (D-ONB-003 row); ground truth agent-3 §1 | No admin parents page exists (`frontend/views/admin/` has no `parents/` dir); the role-filtered `adminUsersQueryDocument` picker is sufficient for v1. A dedicated parents-directory surface is separate UX work; when it lands, the picker (plan §5.3) switches to it without contract change. |
| D-ONB-004 | Instruction drift: `backend/db/test/AGENTS.md` rule 19 ("Do Not Call `getServerTranslations` Directly in Tests") vs tasks.md 2.4 + the newest precedent suites, which mandate/exercise direct `getServerTranslations("en")` calls for translated-message assertions in service tests | Task 2.4 | Repo instruction-set maintenance (docs-only reword of rule 19, next touch of `backend/db/test/AGENTS.md`) | ✅ Done | outcome/2.4-outcome.md §7 (deviation 2); tasks.md 2.4 mandate | Tests.instructions.md forbids the direct call (i18n-hang warning), but the task definition explicitly requires translated-message assertions via `getServerTranslations("en").studentOnboardingTranslations`, and both newest precedents (`subscription-admin.service.test.ts:143`, `user-management.service.test.ts:67`) do exactly that — the loader demonstrably does not hang under the run-test harness (22 pass / 3.89s). RESOLVED-REFERENCE row — the reconciliation verdict LANDED with task 2.4: the authoritative instruction is the task definition (translated-message assertions via `getServerTranslations("en").studentOnboardingTranslations`) plus the two newest precedent suites, and the loader demonstrably does not hang under the run-test harness. Zero code impact — no product or test file changed for this. The remaining stale rule-19 wording is a docs-only reword owned by repo instruction-set maintenance; until it lands, tasks.md 2.4 + the precedent suites govern, so future agents are not pulled both ways. |
| D-ONB-005 | Pre-existing `backend/graphql/test/schema-surface.test.ts` drift vs the merged main lineage: the parent-monitoring surface (`ParentChildUpcomingBlock` / `ParentChildUpcomingSession` named types + their root query fields) joined the schema without re-anchoring the "root query retains EXACTLY the baseline fields" and "whole-schema named-type delta" freeze tests — both red BEFORE task 3.2 (verified by a stash-isolation run; 67 pass / 4 fail pre-change) and still red after (69 pass / 2 fail) | Task 3.2 (out-of-scope discovery during the schema-regen pin work) | Parent-monitoring lineage schema-inventory reconciliation (owning surface: `backend/graphql/query/parents/parent-monitoring.query.ts` / `docs/parents/monitoring-portal.md`; post-M3) | ✅ Done | outcome/3.2-outcome.md §3/§5; outcome/5.1-outcome.md §3 isolation proof; commit `d50fee0` | RESOLVED-REFERENCE row — re-pointed at the owning surface (fix-or-report rule: another lineage's inventory). NOT this plan's regression: both reds pre-date task 3.2 (stash-isolation on the pre-change tree: 67p/4f) and the 5.1 full-sweep re-proved pre-existence on `main` (68p/3f) vs the feature branch (69p/2f — branch one failure LOWER, zero regression; log `/tmp/sweep-main-schemasurface.log`). Task 3.2's own pins are green: the admin contiguous-block slice, the mutation-set freeze (after also removing a pre-existing `purchaseVerificationPlan` double-pin that made the freeze un-satisfiable — same-file fix, documented in outcome §5), and the committed-SDL sync test. The two reds need the parent-monitoring root-query fields + the two named types anchored into the schema-surface inventory consts, owned by the lineage that added them without re-anchoring the freeze tests. |
| D-ONB-006 | Orphaned dev-server teardown in the shared graphql test harness: after a `frontend/graphql/test/**` run, a `next-server (v16.3.5)` child survives on TEST_PORT 3066 (SIGTERM reaches the `next dev` wrapper in `test/helpers/test-lifecycle.ts` afterAll / the runner in `test/scripts/run-server-tests.ts`, not the renamed child process); when that orphan is wedged (spinning, not answering the `{ _health { status } }` probe), the NEXT suite run dies as a 120s "(unnamed) beforeEach/afterEach hook timed out" instead of reusing or rebooting | Task 3.3 (out-of-scope discovery; reproduced twice during suite verification) | Shared test-harness infra — test platform tooling (`test/scripts/run-server-tests.ts` + `test/helpers/test-lifecycle.ts`; post-M3) | ✅ Done | outcome/3.3-outcome.md §3/§7.2; outcome/5.1-outcome.md §2 row 4 (workaround applied); commit `a79ea2c` | RESOLVED-REFERENCE row — re-pointed at test platform tooling (fix-or-report rule: shared harness owned outside task 3.3 file scope). Root cause stands: SIGTERM reaches the `next dev` wrapper, not the renamed `next-server (v16.3.5)` child, which survives on TEST_PORT 3066; a WEDGED orphan (spinning, not answering the `{ _health { status } }` probe) wedges the NEXT suite run as a 120s `beforeEach/afterEach` hook timeout. Proper fix (owner): detached spawn + negative-pid process-group kill in both the lifecycle helper and the runner so the renamed `next-server` child cannot outlive the run. Workaround applied and proven during the 5.1 full sweep: orphaned pids on 3066 killed before every run (`ss -ltnp | rg 3066` then `kill -9`); the reuse-when-live path is healthy against a NON-wedged leftover. |
| D-ONB-007 | Onboarding option feeds fire at directory mount: `useOnboardingPlanOptions()` (mounted unconditionally in `AdminStudentsDirectoryContainer`) issues `planCatalogQueryDocument` + the parent-role `adminUsersQueryDocument` on every `/students` visit even when the dialog is never opened; the stateful-`useQuery`-only rule (NO `useLazyQuery`, `frontend/graphql/AGENTS.md`) makes conditional fetching a structural follow-up (mount the dialog subtree on first open), not an in-place flag | 6.1 (review-frontend wave R1) | Post-plan polish round 1 (CRON-1, webDevReview cron agent) — IMPLEMENTED this round | ✅ Done | commit `feat(frontend): lazy onboarding option feeds and dialog polish` (post-plan polish round 1); prior v1-acceptance evidence: outcome/post-implementation-review.md (review-frontend wave R1); D-ONB-003 still tracks the future dedicated parents-directory feed | IMPLEMENTED: both option reads are skip-gated on the dialog being open (`skip: !enabled` threaded from the container's `onboardingOpen` — still stateful `useQuery`, no `useLazyQuery`), so browse-only directory visits issue zero option reads and Apollo re-fires when the dialog opens; the in-flight flags now surface INSIDE the dialog (skeleton placeholder cards + hidden loading copy in the plan section, Autocomplete loading state in the parent section); the success view gained a clipboard copy affordance (bordered monospace code box + copy icon with transient check/confirmation). v1 acceptance note kept for the record: plan §5.3 wires the hooks layer to feed options verbatim. |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

---

## Usage Guidelines

### When to Add a Deferred Item

Add a row to this table when:

1. A task discovers work that belongs to a different task/phase
2. A technical constraint requires splitting work across tasks
3. A dependency is discovered that blocks immediate completion
4. A plan/spec deviation is accepted (e.g. plan D3 superseding specs J-3 wording) and needs a revisit path

**Format:**
```markdown
| D-ONB-<next-id> | <Brief description> | <source-task-id> | <target-task-id/owner> | ❌ Blocked | — | <Context/rationale> |
```

### When to Update Status

- **To 🔄 In Progress:** Target task begins working on the item
- **To ⚠️ Partial:** Item partially resolved but needs follow-up
- **To ✅ Done:** Item fully resolved and verified — add verification reference (outcome file, ticket, or review round)

### How to Reference in Outcome Files

- Adding a deferred item: "Deferred X to Task Y (see deferred-items.md D-ONB-00N)"
- Completing a deferred item: "Resolved deferred item D-ONB-00N (see deferred-items.md)"

---

## Enforcement (final gate)

The final verification task (tasks.md Phase 5, task 5.3) MUST verify all deferred items are resolved:

```bash
# Count unresolved items
grep -c "❌\|⚠️" ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/deferred-items.md

# Expected: 0
# If >0: the plan is blocked — resolve all ❌/⚠️ items before completion
```

**Exit criteria:** The plan cannot be marked complete while any ❌ or ⚠️ status remains. Note: the ⚠️/❌ glyphs inside THIS enforcement code block and the Status Values legend do NOT count as ledger rows — only table rows carry status; the gate command above is evaluated against the live file state, and all seven ledger rows (D-ONB-001…D-ONB-007) carry ✅ — every row is either Done-with-verification or a RESOLVED-REFERENCE row explicitly re-pointed at its owning ticket/area.

---

## Anti-Patterns (What NOT to Do)

❌ **Don't defer without logging:** "I'll handle it later" without a ledger row
❌ **Don't use vague descriptions:** "Fix the thing" → use specific symbol/file names
❌ **Don't mark ✅ without verification:** status changes must reference an outcome file, ticket, or plan section
❌ **Don't leave ⚠️ unresolved:** partial items must have a completion path
❌ **Don't defer critical bugs:** security, data-corruption, or blocking issues are fixed immediately, never deferred

---

## Related Documents

- Specs: `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/specs.md` (§1 scope table — D-ONB-001; §2.9 J-3 — D-ONB-002; §2.10/§4 — D-ONB-003 parent-picker sourcing)
- Plan: `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/plan.md` (§1.3 D3, §8 deferred items, §9 traceability)
- Tasks: `ai/plans/milestone_3/direct_student_onboarding_with_offline_payment/tasks.md` (Phase 0.1 seeds verification; Phase 5.3 enforces the gate)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Execution guide: `.agents/spec-process-guide/execution/implementation-guide.md`
