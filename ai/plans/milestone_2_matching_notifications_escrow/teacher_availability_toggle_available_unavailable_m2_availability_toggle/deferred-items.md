# Deferred Items Ledger

**Feature:** Teacher Availability Toggle (Available/Unavailable)  
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/`  
**Created:** 2026-09-30

---

## Purpose

This ledger tracks all work deferred from this plan to a sibling ticket or a later phase to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

For this plan, "deferred" means **resolved-pointer deferral**: the item is NOT a gap in this plan's own deliverable. Each row below is work that is intentionally owned by another ticket (verified `Blocked By` lineage in `docs/planning/TICKETS.md`) and must NOT be built here. Rows are seeded at **✅ Done** status because the resolution action for this plan is to record the boundary and the pointer — not to implement the deferred behavior.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| DEF-1 | INV-A4 never-resurrect release gating — restore Available only if still active. **HAZARD:** today `releaseTeacherInSessionLock` (`backend/services/classes/session-lifecycle.transitions.ts:249-250`) unconditionally restores `is_online=true`; no persisted prior-online marker exists. | REQ-042 / REQ-018 | `In-Session Locking (Hide from Directory)` — `docs/planning/TICKETS.md:1338` | ✅ resolved-pointer | Grep of `releaseTeacherInSessionLock` @ `backend/services/classes/session-lifecycle.transitions.ts:249-250` | Sibling ticket declares `Blocked By | Teacher Availability Toggle (Available/Unavailable)` (`TICKETS.md:1345`) and refs INV-A2/A3/A4. This plan MUST NOT add the persisted marker or touch the release path. |
| DEF-2 | Student-facing "Available Teachers directory" appearance / INV-A3 — the toggle's `is_online=true` is CONSUMED, not built, here | REQ-018 | `On-Demand Matching Algorithm (Filter/Sort Pipeline)` — `docs/planning/TICKETS.md:1457`; `Teacher Directory Browse & Filter API` — `docs/planning/TICKETS.md:1509` | ✅ resolved-pointer | Grep verified: NO `availability` / `teachers` locale namespace, NO available-teachers directory in-tree | Dev3 owns both tickets. `On-Demand Matching Algorithm` declares `Blocked By | Teacher Availability Toggle (Available/Unavailable)` (`TICKETS.md:1464`); `Teacher Directory Browse & Filter API` declares `Blocked By | On-Demand Matching Algorithm` (`TICKETS.md:1516`). This plan exposes only the teacher-owned read/write surface (`myTeacherAvailability` / `setTeacherAvailability`). |
| DEF-3 | 15-minute inactivity auto-offline (`users.last_active_at`, `backend/db/schema/users/users.ts:37`) | REQ-018 | `15-Minute Inactivity Auto-Offline` — `docs/planning/TICKETS.md:1298` | ✅ resolved-pointer | `users.last_active_at` exists @ `backend/db/schema/users/users.ts:37`; declared read-only context for this plan | Sibling ticket declares `Blocked By | Teacher Availability Toggle (Available/Unavailable)` (`TICKETS.md:1305`), Dev 2, 5 SP, refs B.15/A.7/FR-4.2. This plan installs no scheduler/cron and never inspects `last_active_at`. |
| DEF-4 | Cooldown "Blocked By" = scheduling/lineage only — NOT a code dependency (verified: never writes `teacher.is_online`) | REQ-018 | `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` — `docs/planning/TICKETS.md:818` | ✅ resolved-pointer | Grep of `backend/services/teachers/applicant-lifecycle.service.ts:224-226` | Handoff ticket `TICKETS.md:1260` declares the `Blocked By` lineage. Verified: the cooldown flow reads/writes **only** `applicants.cooldown_until` (`backend/db/schema/teachers/applicants.ts:23`) and never calls `TeacherRepository.setOnline` nor touches `teacher.is_online`. |
| DEF-5 | Optional `canSetAvailable` derived eligibility flag deferred | REQ-013 / REQ-063 | This plan's `TeacherAvailabilityService` — intentionally NOT built | ✅ resolved-pointer | Design decision D6 (see `plan.md`) | The chosen return surface is the minimal `TeacherAvailabilityReturnType { id; isOnline; isApproved }` (`REQ-013`). Eligibility is enforced server-side and surfaced through the localized denial (FORBIDDEN/`teacherNotCertified`, 409/`teacherInActiveSession`) plus the Apollo error-link map — no speculative field added (YAGNI); zero schema/type drift (`REQ-016`). |
| DEF-6 | `assertTeacherNotInActiveSession` docstring says the denial is "FORBIDDEN-class" (`backend/services/classes/session-lifecycle.enforcement.ts:186-188`) while the code throws `ConflictError`/409 (`:212`) — foreign-file doc drift; code is authoritative | REQ-015 / REQ-034 | session-lifecycle enforcement owner | ✅ resolved-pointer | `backend/services/classes/session-lifecycle.enforcement.ts:186-188` vs `:212` | Recorded so reviewers do not fix a foreign docstring inside this ticket's file scope; the CODE (`ConflictError`/409) is pinned by D4. |

---

## Deferral Lineage (Verified)

The table below records the `Blocked By` edges that make DEF-1–DEF-4 sibling-owned rather than gaps in this plan. Every edge was read directly from `docs/planning/TICKETS.md`.

| Sibling Ticket | TICKETS.md Line | Blocked By (verbatim) | Direction | Owner Stream |
|---|---|---|---|---|
| Teacher Availability Toggle (Available/Unavailable) — **THIS plan** | `:1253` | Cooldown State Machine (1-Month Tajweed / 3-Month Hifz) | predecessor | Dev 2 |
| 15-Minute Inactivity Auto-Offline | `:1298` | Teacher Availability Toggle (Available/Unavailable) | successor | Dev 2 |
| In-Session Locking (Hide from Directory) | `:1338` | Teacher Availability Toggle (Available/Unavailable) | successor | Dev 2 |
| On-Demand Matching Algorithm (Filter/Sort Pipeline) | `:1457` | Teacher Availability Toggle (Available/Unavailable), Session Creation & Lifecycle | successor | Dev 3 |
| Teacher Directory Browse & Filter API | `:1509` | On-Demand Matching Algorithm (Filter/Sort Pipeline) | successor (transitive) | Dev 3 |

**Reading the lineage:** this ticket is *below* the Cooldown State Machine in the graph but has *no* code-level coupling to it (DEF-4); it is *above* the four successor tickets, which is the whole reason their behavior (auto-offline, in-session locking, matching, directory) is not implemented here.

---

## Hazard Detail — INV-A4 Never-Resurrect (DEF-1)

The single non-obvious risk carried by this plan is that release-path behavior *already in the tree* contradicts a naive reading of "toggle to unavailable sticks":

- `backend/services/classes/session-lifecycle.transitions.ts:249-250` — `releaseTeacherInSessionLock(teacherId, tx)` calls `TeacherRepository.setOnline(teacherId, true, tx)` with no precondition, throwing if zero rows matched.
- Consequence: when a session that caused an in-session lock ends, the teacher is flipped to online **regardless** of whether they were available beforehand. There is no column storing the pre-lock availability to restore (verified: `teacher` table columns at `backend/db/schema/teachers/teacher.ts:19-38` carry `isOnline` only — no `wasOnlineBeforeLock`-style marker).
- This plan MUST NOT attempt to fix this: the correct fix lives inside the release transaction and the sibling ticket `In-Session Locking (Hide from Directory)` (`TICKETS.md:1338`, refs INV-A2/A3/A4). Recorded here so the hazard is traceable and is not silently "resolved" by an out-of-scope edit (`REQ-042`, `REQ-018`).

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file, grep, or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

---

## Usage Guidelines

### When a Deferred Item Applies

Add or reference a row here when:
1. A task discovers work that belongs to a different ticket/phase (a sibling "Blocked By" descendant).
2. A requirement is intentionally scoped OUT of this plan with an explicit pointer to its owner.
3. A technical constraint (e.g. a missing persisted marker for INV-A4) makes immediate completion impossible *in this plan's transaction boundaries*.
4. A TODO/comment in code is placed with "deferred to <sibling ticket>" and must be traceable.

**Format:**
```markdown
| D<next-id> | <Brief description> | <source-req-id> | <target-ticket + TICKETS.md:line> | ✅ Done | <grep/path evidence> | <rationale + hazard> |
```

### When to Update Status

- **To 🔄 In Progress:** the target sibling ticket begins the deferred work.
- **To ⚠️ Partial:** partially resolved; needs follow-up.
- **To ✅ Done:** fully resolved and verified — add a verification reference (grep result, path:line, outcome file, or commit).

### When to Reference in Outcome Files

In this plan's task outcome files, reference this ledger when:
- Declaring a boundary: "INV-A4 release gating deferred to In-Session Locking (see deferred-items.md DEF-1)".
- Confirming scope exclusion: "Student directory is Dev3-owned (see deferred-items.md DEF-2)".

---

## Enforcement

The **final quality gate task** (last task before the knowledge-propagation phase) MUST verify all deferred items are resolved. Because every row in this ledger is a **resolved-pointer** row, the exit criterion is that **no open rows remain**:

```bash
# Count unresolved (open) rows — row-scoped: only table rows whose Status cell is ❌ or ⚠️
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/deferred-items.md

# Expected: 0
# If >0: the plan is blocked — resolve or re-scope every ❌/⚠️ row before plan completion
```

The `-E '^\s*\|.*'` anchor matches only Markdown table rows, so the 🔄/❌/⚠️ glyphs that appear elsewhere in this document (e.g. in this Enforcement block, the Status Values list, or the Anti-Patterns section) do NOT count toward the total. A non-zero result means an actual ledger row is open.

**Exit criteria:** the plan cannot be marked complete if any ⚠️ or ❌ **ledger row** remains.

---

## Anti-Patterns (What NOT to Do)
- ❌ **Don't defer silently:** "handle later" without a ledger row is prohibited.
- ❌ **Don't use vague descriptions:** "fix availability" → name the exact symbol/ticket (`releaseTeacherInSessionLock`).
- ❌ **Don't mark ✅ without evidence:** every row carries a `path:line` or grep result in `Verified By`.
- ❌ **Don't build the deferred item here:** DEF-1–DEF-4 are owned by sibling tickets; implementing any of them in this plan drifts scope and violates `REQ-018`.
- ❌ **Don't add a speculative field to satisfy a deferral:** DEF-5 (`canSetAvailable`) is deliberately NOT added; the UI consumes the mutation error instead.
- ❌ **Don't "fix" the INV-A4 hazard in this plan:** correcting `releaseTeacherInSessionLock`'s unconditional `setOnline(true)` requires the release transaction plus a persisted prior-online marker that does not exist — that is DEF-1's owner.

---

## Related Documents

- Plan: `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/plan.md` — decisions D1–D10
- Specs: `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/specs.md` — REQ-018 (Dependency Boundary & Out-of-Scope Pointers), REQ-042 (Never-Resurrect deferred pointer + hazard)
- Tasks: `ai/plans/milestone_2_matching_notifications_escrow/teacher_availability_toggle_available_unavailable_m2_availability_toggle/tasks.md` — final quality-gate task enforcing this ledger
- Ticket source: `docs/planning/TICKETS.md` — `Teacher Availability Toggle` (`:1253`), `15-Minute Inactivity Auto-Offline` (`:1298`), `In-Session Locking (Hide from Directory)` (`:1338`), `On-Demand Matching Algorithm` (`:1457`), `Teacher Directory Browse & Filter API` (`:1509`), `Cooldown State Machine` (`:818`)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
