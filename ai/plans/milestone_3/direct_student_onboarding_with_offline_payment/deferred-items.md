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

**Exit criteria:** The plan cannot be marked complete while any ❌ or ⚠️ status remains. Note: the ⚠️/❌ glyphs inside THIS enforcement code block and the Status Values legend do NOT count as ledger rows — only table rows carry status; the gate command above is evaluated against the live file state, and the seeded D-ONB-001/D-ONB-002/D-ONB-003 rows carry ✅.

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
