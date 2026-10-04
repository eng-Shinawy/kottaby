# Deferred Items Ledger

**Feature:** `15-Minute Inactivity Auto-Offline`  
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/`  
**Created:** 2026-10-04

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete. This plan's discipline: every row is either a **resolved-pointer** (a named owning ticket/doc absorbs the item — this plan owes nothing further) or an **in-plan target** (a task in `tasks.md` completes it). No row may remain ❌/⚠️ at the final gate.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| DEF-1 | INV-A4 never-resurrect release gating — `releaseTeacherInSessionLock` restores `is_online = true` unconditionally (`backend/services/classes/session-lifecycle.transitions.ts:249-257`); needs a persisted prior-online marker (none exists — `backend/db/schema/teachers/teacher.ts:22-35`) | plan D10 | sibling ticket "In-Session Locking (Hide from Directory)" (`docs/planning/TICKETS.md:1338`; verified unimplemented) | ✅ resolved-pointer | plan R1 review | This ticket's sweep self-heals resurrections at the next pass (sweep flips resurrected-but-inactive teachers offline); the release path itself is NOT modified here |
| DEF-2 | INV-A3 directory appearance/hiding — the student-facing consumer of truthful `is_online` | plan §1.1 non-goals | Dev 3 — On-Demand Matching (`docs/planning/TICKETS.md:1457`) + Teacher Directory Browse (`TICKETS.md:1509`) | ✅ resolved-pointer | plan R1 review | No directory exists in-tree; this ticket makes `is_online` truthful so the future directory reads truth |
| DEF-3 | Heartbeat mounts for non-teacher audiences (parent/student "last seen" freshness while idle) | plan D3 (teacher-scoped mount ruling) | future UX ticket | ✅ resolved-pointer | plan R1 review | The `recordMyActivity` mutation is role-agnostic (all authenticated roles); only the teacher heartbeat mount ships in this ticket (Task 12) |
| DEF-4 | External scheduler cadence wiring (≤5-min cron schedule hitting `/api/cron/sweep-inactive-teachers` with bearer) | plan D8 | ops runbook pattern (`docs/billing/subscription-validity-window-expiry.md:232-244`) | ✅ resolved-pointer | plan R1 review | No in-repo scheduler artifact is permitted (verified anti-pattern); ops arms env + wires the scheduler at deploy time |
| DEF-5 | `.env.example:155` stale `CRON_EXECUTION_MODE=vercel-daily` residue (shipped gate accepts only `"external"`, `backend/lib/gateway/cron-endpoint.ts:112-116`) | plan §7.3 assumptions | repo hygiene sweep (out of ticket scope) | ✅ resolved-pointer | plan R1 review | Pre-seed residue documented for the next docs/env cleanup ticket; this ticket adds only its own `.env.example` row |
| DEF-6 | Stale citation in `docs/teachers/teacher-availability.md:315` — cites `backend/db/schema/users/users.ts:37`; the column is at `:44` | plan §13 / REQ-081.1 | Task 15 (canonical doc update) | 🔄 In Progress | — | Completed by Task 15 alongside the §6.3 rewrite; flip to ✅ with the task outcome reference |

---

## Status Values

- ✅ **Done / resolved-pointer** — Item completed or formally owned by a named ticket/doc (with reference)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved; plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on (in-plan target)

---

## Usage Guidelines

Add a row when a task discovers work owned by another task/ticket, a constraint forces a split, a dependency blocks completion, or a TODO comment is added. Update status when the target task begins/finishes. Reference this ledger in outcome files ("Deferred X to Y — see deferred-items.md DEF-N").

---

## Enforcement

The final quality gate (Task 16) MUST verify:

```bash
grep -c "❌\|⚠️" ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/deferred-items.md
# Expected: 0
```

**Exit criteria:** the plan cannot be marked complete while any ❌ or ⚠️ remains. Resolved-pointers with a named owner count as resolved only when the owning ticket/doc is cited verbatim (sibling-plan precedent: the blocker plan's DEF-3 forward-pointer to THIS ticket).

---

## Deferral Lineage (verified at generation time)

| Ticket | `docs/planning/TICKETS.md` | Relationship | Status |
|---|---|---|---|
| Teacher Availability Toggle (Available/Unavailable) | `:1253` | Blocker of this ticket | SHIPPED (`1775142f`) |
| 15-Minute Inactivity Auto-Offline (this plan) | `:1298` | Successor of the toggle | this plan |
| In-Session Locking (Hide from Directory) | `:1338` | Sibling (Blocked By the same toggle); owns DEF-1 | NOT implemented |
| On-Demand Matching / Teacher Directory Browse | `:1457` / `:1509` | Forward consumers (DEF-2) | Dev 3, not started |

---

## Related Documents

- Specs: `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/specs.md` (REQ-082 discipline)
- Plan: `ai/plans/milestone_2_matching_notifications_escrow/15_minute_inactivity_auto_offline_m2_auto_offline/plan.md` (§13 seeds, D10 ruling)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
