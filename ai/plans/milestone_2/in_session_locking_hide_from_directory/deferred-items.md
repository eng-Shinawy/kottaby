# Deferred Items Ledger

**Feature:** `In-Session Locking (Hide from Directory)`
**Plan:** `ai/plans/milestone_2/in_session_locking_hide_from_directory/`
**Ticket:** `docs/planning/TICKETS.md:1338-1372` (Milestone 2 · Dev 2 · 3 SP)
**Created:** 2026-10-04

---

## Purpose

This ledger tracks all work deferred from this plan. Per the predecessor plan's discipline, every forward-looking item here is a **✅ resolved-pointer**: it names the owning ticket/doc and the composition contract, so nothing is silently dropped and nothing is built twice. The final gate is `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target / Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Real accept/decline session-request intake (queue / reject / offer-alternatives) — the ticket's literal "teacher accepts" vocabulary. Seams already exist: unused `teacher.request_preference` pgEnum (`backend/db/schema/enums.ts:162`) and the zero-caller emitters `notifyStudentOfSessionAccepted` / `notifyStudentOfSessionDeclined` / `notifyStudentOfSessionAutoRejected` / `notifyStudentOfSessionQueued` / `notifyStudentOfAlternativesOffered` (`backend/services/classes/session-request-notification.service.ts:229-276`) | plan D5 / REQ-004 | Dev 3 — On-Demand Matching (`docs/planning/TICKETS.md:1457`); lock composition moves with the intake if built | ✅ resolved-pointer | specs §2.2, plan D5 | Ruling: accept-moment ≙ `startSession` (INV-A2 binds `started`, `docs/specs/state-machine-invariants.md:121`); booking stays lock-free (a `scheduled` teacher remains bookable for later slots) |
| D2 | Student-facing "Available Teachers directory" read-side (INV-A3 consumer): browse/filter/sort API + UI that hides in-session teachers | REQ-011 | Dev 3 — On-Demand Matching (`TICKETS.md:1457`) + Teacher Directory Browse & Filter API (`TICKETS.md:1509`) | ✅ resolved-pointer | grep audit: zero `availableTeachers`/matching/directory surfaces in `backend/graphql/query/`, `backend/services/`, `frontend/views/student/` | This ticket ships the data-level truth (`is_online=false` while locked) + the forward contract (`docs/teachers/teacher-availability.md:297`: compose `is_online=true` AND the `assertTeacherNotInActiveSession` oracle — NEVER `is_online` alone) |
| D3 | "Still active (app open)" real-time detection + 15-min inactivity auto-offline sweep that converges a restored-Available but actually-gone teacher to Unavailable | specs REQ-006.5 / design D4 | `15-Minute Inactivity Auto-Offline` (`TICKETS.md:1298-1334`, Dev 2, 5 SP, Refs B.15/A.7/FR-4.2) | ✅ resolved-pointer | `TICKETS.md:1322-1324` | Composition contract: the sweep MUST NOT auto-offline a teacher holding a `started` session (its own AC: "in-session lock takes priority"); this ticket restores persisted intent, the sweep owns liveness. `users.last_active_at` is login-stamped only today (`backend/services/auth/auth.service.ts:514-516`) — gating the restore on its freshness was REJECTED (would misclassify hours-active teachers) |
| D4 | Booking-time availability gate — `createSession`/`bookSessionInTx` asserts certification only (`backend/services/classes/session-lifecycle.booking.ts:245-261`); a student can book an offline/in-session teacher today | REQ-004 / plan §6 | Dev 3 — matching flow (`TICKETS.md:1457`: "Only teachers with is_online=true and is_approved=true appear. In-session teachers are excluded."); TOCTOU re-assertion rule `docs/backend/cross-stream-contracts.md:117-119` | ✅ resolved-pointer | `docs/sessions/session-lifecycle.md:171-173` (D3 pointer of the session-state-machine plan) | Whether booking REJECTS unavailable teachers (vs. only the directory hiding them) is a matching-flow product decision; this ticket keeps `bookSessionInTx` untouched |
| D5 | Widening the INV-A2 toggle gate to `disputed`-from-started sessions — today `assertTeacherNotInActiveSession` counts only `started` (`backend/services/classes/session-lifecycle.enforcement.ts:205`), so a teacher may toggle Available mid-dispute while the lock's release is still owed at arbitration | plan §6 | Pending product ruling; candidate owner: dispute/arbitration surface or Dev 3 escalation flow | ✅ resolved-pointer | `docs/specs/state-machine-invariants.md:121` (INV-A2 text binds `started` only) | Invariant text is the spec of record — this ticket does not widen the gate; the marker keeps the release consistent (mid-dispute Available toggle ⇒ marker true ⇒ arbitration release restores true, idempotent) |
| D6 | An `inSession`-style availability flag for consumers/UI | REQ-011.5 | REJECTED BY CONTRACT — forbidden-field registry (`docs/backend/cross-stream-contracts.md:56`: "No parallel inSession flag exists; exclusability [sic] via `isOnline` only") | ✅ resolved-pointer (rejected) | contract registry + `backend/types/teachers/teacher.types.ts:21-22` doctrine | Never build; consumers compose the session-state oracle with `is_online` instead |
| D7 | `users.last_active_at` activity cadence (heartbeat / per-request bump) — the presence machinery the `:1298` sweep will consume | specs §7 assumption (c) | `TICKETS.md:1298` (B.15 / A.7) | ✅ resolved-pointer | only writers today: registration (`backend/services/auth/registration.service.ts:316`) + login `touchLastActiveAt` (`backend/services/auth/auth.service.ts:514-516`) | This ticket never reads `last_active_at` (see D3 rationale) |
| D8 | Ordering constraint: `setOnline` deletion (task 2.4) completes only after the last caller rewire (task 3.4) — the retirement is split across 2.4/3.4 by the sequencing graph | 2.4 | 3.4 (final grep + delete) | ✅ resolved-by-sequencing | tasks.md dependency graph: 2.2 → 2.3 → 2.4 → 3.1 → 3.2 → 3.3 → 3.4 | Not a knowledge gap — an execution-order guard so the tree never has a dangling import; verify with `grep -rn "setOnline" backend/ --include="*.ts"` excluding tests at 3.4 completion — COMPLETED at 3.4: grep clean, method + docblock deleted |

---

## Status Values

- ✅ **Done** — Item completed and verified (with reference to outcome file or commit)
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on

> Row-scoped gate note: the legend above intentionally contains the ❌/⚠️ symbols; the final-gate grep is row-anchored (`^\s*\|.*(❌|⚠️)`) and must count ZERO matching ledger-table rows.

---

## Usage Guidelines

- Add a row (next `D<id>`) when a task discovers work owned by another task/ticket — never defer silently.
- Update status only with a verification reference (outcome file / review round / commit).
- Task outcome files MUST reference this ledger when deferring or resolving ("Resolved D3 (see deferred-items.md)").

## Enforcement

The final quality gate (tasks.md 6.1) MUST verify:

```bash
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2/in_session_locking_hide_from_directory/deferred-items.md
# Expected: 0
```

**Exit criteria:** the plan cannot be marked complete if any ❌/⚠️ row remains.

## Predecessor-Ledger Reconciliation (informational)

The predecessor plan's ledger (Teacher Availability Toggle) was deleted from the tree in its merge commit `1775142f` but its DEF-1..DEF-6 live on in its `plan.md:440-451` / `tasks.md:438-447` / `specs.md` and in `docs/teachers/teacher-availability.md`. Mapping into THIS ledger: predecessor **DEF-1** (INV-A4 release gating) = this plan's core scope (REQ-005..REQ-010 — RESOLVED HERE); predecessor **DEF-2** (directory) = D2; predecessor **DEF-3** (15-min sweep) = D3/D7; predecessor **DEF-4** (cooldown lineage) = N/A (verified: cooldown never writes `teacher.is_online`); predecessor **DEF-5** (`canSetAvailable` flag) = stays unbuilt by design (minimal projection pinned); predecessor **DEF-6** (enforcement docstring FORBIDDEN-class drift) = FIXED HERE (task 5.2, REQ-015.5).
