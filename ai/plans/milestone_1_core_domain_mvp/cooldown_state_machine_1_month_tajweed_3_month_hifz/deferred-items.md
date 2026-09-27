# Deferred Items Ledger

**Feature:** `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)`
**Plan:** `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`
**Ticket:** `docs/planning/TICKETS.md:818-868` — Dev 2 · M1 · 5 SP
**Created:** 2026-09-26

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item is explicitly logged here and resolved before the plan is marked complete.

This ticket is the **parent** of two child tickets (`Failed Applicant → Student Record Conversion` and `Admin Override of Evaluation Results`, both Blocked By this one). The deferrals below are mostly intentional child-ticket boundaries (📋), NOT blockers (❌). The final quality gate (Task 8) verifies zero ❌/⚠️ entries remain.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Failed applicant → `students` record conversion (create the `students` row with zeroed balances + `handshake_code` so the failed applicant can subscribe/attend during cooldown) | — (plan authoring) | Child ticket `Failed Applicant → Student Record Conversion` (`docs/planning/TICKETS.md:872-912`, Blocked By THIS ticket) | 📋 Deferred-to-child-ticket | Plan §1 Scope + REQ-010 boundary note | This ticket formalizes the cooldown MUST NOT block student privileges (REQ-010); the `students` row creation itself is the child ticket's job. The `finalizeRubricFail` docblock (`evaluation-rubric.helpers.ts:377-383`) explicitly states "no role-child rows" are written by the fail path — the conversion is a separate write. |
| D2 | Admin override of evaluation results: certify / reject / grant-re-evaluation (the FR-3.8 surface that composes the cooldown-extension primitive shipped here) | — (plan authoring) | Child ticket `Admin Override of Evaluation Results` (`docs/planning/TICKETS.md:916-958`, Blocked By THIS ticket) | 📋 Deferred-to-child-ticket | Plan §1 Scope + REQ-007 FR-3.8 lineage | This ticket ships ONLY the low-level `adminExtendApplicantCooldown` primitive (service + mutation + audit). The Admin Override ticket composes it into grant-re-evaluation (clear cooldown) and reject (set cooldown) + the certify path, plus the audit-logs `override` action. The `adminExtendApplicantCooldown` mutation's `authScopes: adminOnlyAuthScopes` + `AuditActionType.Adjust` are the composition-ready primitives. |
| D3 | `users.suspended` login/session-class gating (INV-U2) | — (plan authoring) | Separate governance domain (`backend/services/admin/user-governance.helpers.ts:230` — `setSuspendedAxis`) | 📋 Deferred-by-design (two-source split) | Plan D6 + REQ-006 + `docs/teachers/applicant-lifecycle.md:60-67,154` | The cooldown state machine MUST NOT touch `users.suspended` (the binding reconciliation). The `users.suspended` axis is owned by `adminSetUserSuspended` (`admin-governance.mutation.ts:45`) for login/session-class gating. This is NOT a deferral to be resolved later — it is a permanent architectural boundary (test-locked by REQ-006.5). |
| D4 | `SELECT FOR UPDATE` on the applicant row for stricter concurrent-admin-extension ordering | 6 (concurrency assessment) | Future performance-hardening ticket (post-M1) | 📋 Deferred (5-SP scope) | Plan §6 race-condition table (concurrent-admin-extensions row) | Last-write-wins on `cooldown_until` between two concurrent admins is accepted for 5-SP scope — the audit trail records BOTH extensions with timestamps, so the conflict is observable. A `FOR UPDATE` variant (e.g. `ApplicantRepository.findByIdForUpdate`) would serialize the extensions if a stricter ordering is ever needed. The existing `transitionToFailed` uses guarded-predicate UPDATE (not FOR UPDATE) — this ticket follows that discipline (plan §6 SELECT FOR UPDATE Usage: NONE). |
| D5 | `cooldownState` pgEnum column on `applicants` (if a second writer ever ships) | 1 (types) / D1 rationale | Future ticket (only if a second cooldown writer ships) | 📋 Deferred-by-design (D1) | Plan D1 | `cooldownState` is a DERIVED read-model (D1: pure compute from `cooldown_until` + `now`), NOT a stored column. A stored pgEnum would introduce a second source of truth that could drift from `cooldown_until` (exactly the anti-pattern REQ-006 forbids for `users.suspended`). Revisit ONLY if a second writer that doesn't go through `cooldown_until` ever ships — until then, the derived model is canonical. |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on
- 📋 **Deferred-to-child-ticket** — Intentionally out of scope; belongs to a child ticket that is Blocked By this one (NOT a blocker for this plan)
- 📋 **Deferred-by-design** — A permanent architectural boundary or accepted scope limit (NOT a blocker; documented in the plan's design decisions)

---

## Enforcement

The final quality gate (Task 8 in `tasks.md`) verifies:

```bash
# Count unresolved BLOCKERS (❌/⚠️ ledger rows only — 📋 items are intentional, NOT blockers).
# Row-anchored regex so status-legend and prose glyph mentions never match (the status-legend glyphs are excluded by design).
grep -cE "^\| D[0-9]+ .*(❌|⚠️)" ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/deferred-items.md

# Expected: 0
# (📋 Deferred-to-child-ticket and 📋 Deferred-by-design entries are NOT counted — they are intentional)
```

**Exit criteria:** the plan CAN be marked complete with 📋 entries present (they are intentional child-ticket boundaries or architectural decisions), but MUST have zero ❌/⚠️ entries. All five deferrals (D1..D5) are 📋 — the plan is complete-able as authored.

---

## Related Documents

- Task template: `.agents/spec-process-guide/templates/tasks-template.md` — Phase 1 setup, Final quality gate
- Execution guide: `.agents/spec-process-guide/execution/implementation-guide.md` — Deferred item workflow
- SKILL.md: `.agents/skills/spec-driven-development/SKILL.md` — Deferred-items ledger enforcement
- Specs: `specs.md` REQ-006 (two-source split), REQ-010 (student-privileges boundary), REQ-007 (admin extension primitive)
- Design: `plan.md` §1 Scope, D1/D6, §6 (concurrency), §8 (security/tenancy)
