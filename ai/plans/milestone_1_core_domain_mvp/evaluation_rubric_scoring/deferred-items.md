# Deferred Items Ledger

**Feature:** Evaluation Rubric Scoring (≥80% Threshold) (DEV2-007)  
**Plan:** `ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`  
**Created:** 2026-09-21

---

## Purpose

This ledger tracks all work deferred from this plan to other tickets/plans to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved by its target ticket's plan before that plan is marked complete. Because every seeded row here targets a *future* ticket, the final gate for THIS plan is a scope check (no stray emoji markers), not full resolution — resolution happens in the target tickets.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | `users.suspended` / `suspended_at` / `suspended_period_days` writes on evaluation FAIL | Plan scope (DEV2-007) | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) ticket plan (docs/planning/TICKETS.md:818+, Blocked By DEV2-007) | Blocked | That ticket's plan | This plan owns only `applicants.status='failed'` + `applicants.cooldown_until`; all suspension-state writes belong to the Cooldown State Machine |
| D2 | `students` record creation for failed applicants + any `users.role` flip | Plan scope (DEV2-007) | DEV2-009 "Failed Applicant → Student Record Conversion" (docs/planning/TICKETS.md:872+, Blocked By Cooldown State Machine) | Blocked | That ticket's plan | DEV2-009 owns conversion semantics (handshake code generation, zeroed balances, role decision); DEV2-006 already recorded this boundary |
| D3 | Admin visibility/override surfaces over rubric results | Plan scope (DEV2-007) | "Admin Override of Evaluation Results" ticket (docs/planning/TICKETS.md:916+) | Blocked | That ticket's plan | Rubric results are computed and persisted here; admin-facing override UI/API is owned by that ticket |
| D4 | `teacher.average_rating` recompute / any average-rating semantics tied to evaluation rows, and the admin-ordered re-evaluation loop (`session_type='re_evaluation'` exists but is unused) | Plan scope (DEV2-007) | Admin-Ordered Re-Evaluation (Milestone 3, `docs/planning/TICKETS.md:2143+`; DEV2-006 deferred-item D2 lineage) | Blocked | That ticket's plan | The rubric flow neither reads nor writes `average_rating` (`aggregateLiveRatings` untouched); the aggregation engine stays cycle-scoped and re-evaluation gets its own plan — this plan handles only first-pass evaluation sessions |

---

## Status Values

- **Done** — Item completed and verified (with reference to outcome file or commit)
- **Partial** — Partially completed, needs follow-up work
- **Blocked** — Not resolved in this plan; awaiting the target ticket
- **In Progress** — Currently being worked on in the target ticket

---

## Usage Guidelines

### When to Add a Deferred Item

Add a row to this table when:
1. A task discovers work that belongs to a different task/phase/ticket
2. A technical constraint requires splitting work across tasks
3. A dependency is discovered that blocks immediate completion
4. A TODO comment is added to code with "deferred to Task X"

**Format:**
```markdown
| D<next-id> | <Brief description> | <source-task-id> | <target-task-id> | Blocked | — | <Context/rationale> |
```

### When to Update Status

Update the status when:
- **To In Progress:** Target task begins working on the item
- **To Partial:** Item partially resolved but needs follow-up
- **To Done:** Item fully resolved and verified
  - Add verification reference (outcome file, commit hash, review round)
  - Example: `R5 outcome` or `commit abc123f` or `Task 13.2 complete`

### When to Reference in Outcome Files

In task outcome files, reference this ledger when:
- Adding a deferred item: "Deferred X to Task Y (see deferred-items.md D3)"
- Completing a deferred item: "Resolved deferred item D3 (see deferred-items.md)"

---

## Enforcement

The **final quality gate task** (last task before Phase 7: Knowledge Propagation) MUST verify no unresolved in-scope deferred items remain:

```bash
# Count unresolved items (hex escapes for the U+274C / U+26A0 FE0F markers,
# so this ledger itself carries no literal emoji)
grep -cP "\x{274C}|\x{26A0}\x{FE0F}" ai/plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/deferred-items.md

# Expected: 0
# If >0: Task is blocked — resolve all unresolved-status items before plan completion
```

**Exit criteria:** This plan cannot be marked complete if any unresolved status marker remains. Rows D1–D4 are cross-ticket scope boundaries: they are verified Done by their target tickets' plans, not by this plan.

---

## Related Documents

- Task template: `.agents/spec-process-guide/templates/tasks-template.md` — Phase 1 setup, Final quality gate
- Execution guide: `.agents/spec-process-guide/execution/implementation-guide.md` — Deferred item workflow
- SKILL.md: `.agents/skills/spec-driven-development/SKILL.md` — Deferred-items ledger enforcement
- Ticket source: `docs/planning/TICKETS.md` — DEV2-007 and its successor tickets (lines 818+, 872+, 916+)
