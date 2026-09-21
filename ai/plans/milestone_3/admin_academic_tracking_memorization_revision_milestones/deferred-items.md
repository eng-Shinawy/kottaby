# Deferred Items Ledger — Admin Academic Tracking (Memorization & Revision Milestones)

**Plan directory (verbatim):** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/`
**Ledger path:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/deferred-items.md`
**Specs:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/specs.md`
**Plan:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/plan.md`
**Tasks:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/tasks.md`
**Outcome directory:** `ai/plans/milestone_3/admin_academic_tracking_memorization_revision_milestones/outcome/`

## Purpose

Every piece of work discovered mid-task that does not land in its current task gains a row here BEFORE that task may close. A task cannot be marked `[x]` with an untracked deferral; the plan cannot complete with any ❌/⚠️ row unresolved. Rows are added by the executing agent, updated when the target task picks them up, and closed with a verification reference (outcome file / commit / review round).

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

*(Empty at initialization, 2026-09-21 — Phase 0 closed with zero deferrals. Known OUT-of-scope items from specs.md §6.2 — the CSV/export envelope and percentage-through-curriculum maps — are excluded from this ticket's scope by design, not deferred inside it; if mid-execution work ever forces either into a later task, add a row here at that moment.)*

## Status Values

- ✅ **Done** — landed in the target task; carries a verification reference in "Verified By"
- ⚠️ **Partial** — landed incompletely; notes MUST state what remains
- ❌ **Blocked** — cannot land inside this plan; notes MUST state why and where it goes instead
- 🔄 **In Progress** — a target task is actively working it

## Usage Guidelines

- **When to add:** the moment an executing agent decides (or is forced) to leave something unfinished for a later task — add the row in the same breath, never after task close.
- **When to update status:** the target task flips 🔄 → ✅/⚠️ when it lands the item, with the verifying outcome file / commit.
- **When to reference:** task outcomes (`outcome/<task-id>-outcome.md`) and review gates cite ledger IDs rather than re-explaining the deferral.

## Enforcement

The final gate (plan.md §12 / specs REQ-061.2) runs `grep -c "❌\|⚠️" deferred-items.md` — the count MUST be 0 for plan completion. Any row still ❌ at closeout is either completed in a cleanup task or explicitly transferred to a follow-up ticket with the transfer recorded in "Notes".

## Common Deferred Item Patterns

- New capability adjacent to shipped scope — precedent exists, ticket scope does not.
- Capability blocked on absent schema — do not invent the schema inside this plan (ruling D-no-schema / specs R-C).

## Anti-Patterns

- Deferring silently and marking `[x]` — a review-gate grep for task checkboxes vs outcome files catches this.
- "Deferred" as a synonym for "deleted" — deferred items stay visible until Done or transferred.
- Adding a `jscpd:ignore`, `oxlint-disable`, or similar suppression comment instead of a ledger row.
- Seeding speculative rows at initialization — the ledger records real deferrals only; scope exclusions live in specs §6.2.

## Related Documents

- `specs.md` §6 (Scope Boundaries) · `plan.md` §11 (outcome protocol) · `.agents/spec-process-guide/templates/deferred-items-template.md` (the authoritative template).
