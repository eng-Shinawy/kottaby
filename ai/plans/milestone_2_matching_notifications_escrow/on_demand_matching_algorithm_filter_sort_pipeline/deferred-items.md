# Deferred Items Ledger

**Feature:** `On-Demand Matching Algorithm (Filter/Sort Pipeline)`
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/`
**Created:** 2026-10-04
**Ticket:** `docs/planning/TICKETS.md:1457-1505` (Dev 3, Milestone 2, 8 SP; B.10, A.6, FR-4.4)

---

## Purpose

This ledger tracks all work deferred from this ticket to other tickets. Per the plan's governing scope ruling, every forward item below is a **resolved-pointer entry**: it names the owning ticket/program, is verified in-tree or in docs, and therefore starts (and must end) at ✅ — never open ❌/⚠️ debt. The final gate (task 4.1) enforces `grep -cE '^\s*\|.*(❌|⚠️)'` = 0.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Owner | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Student browse GraphQL root field + SDL types + teacher-profile projection + `authScopes` student gating — wraps `TeacherMatchingService.browseAvailableTeachers` | this plan (governing ruling §1.5) | `Teacher Directory Browse & Filter API` (`docs/planning/TICKETS.md:1509-1549`, Blocked By this ticket) | ✅ Resolved-pointer | plan.md §3.2 forward SDL contract | Sibling-owned by design; `git diff backend/graphql/**` must stay empty in this slice |
| D2 | Student browse UI — route, nav item, teacher cards, empty-state rendering of `teacherDirectory.noTeachersAvailable` | this plan (§1.5, specs §3) | same sibling ticket `:1509` | ✅ Resolved-pointer | specs §3.2 forward-consumed UX contract | Zero `app/`/`frontend/` files in this slice |
| D3 | Production write path for `teacher.recitations` + `teacher.languages` (certification-time capture or teacher self-service profile editing) — NO production writer ships with the matcher; data flows from tests/seeds/admin ops until the owner lands | 1.1 (columns created read-first) | candidate: `Cold-Start Bootstrapping (Direct Sheikh Certification)` (`docs/planning/TICKETS.md:2314`) — no dedicated teacher-profile ticket exists at plan time (grep-verified) | ✅ Resolved-pointer | plan.md §2.2 doc comments; specs §6.3 | Write path must validate strictly (catalog members for recitations; lowercase tokens for languages); read-side parsers are fail-closed regardless |
| D4 | Durable student-side recitation preference home (`setMyPreferredRecitation` + persistence) — this ticket takes recitation as a per-browse input instead | this plan (governing ruling; D2 sub-ruling) | documented deferred program: `docs/auth/qiraah-selection-and-c5.md:501-531` (§7 "Deferred Durable Persistence") | ✅ Resolved-pointer | specs governing block; `backend/types/users/registration.types.ts:56-64` | Post-C.5 the `recitation` table is session-linked 1:1 — no user-preference home exists; per-browse input is the session-scoped semantics |
| D5 | INV-A4 never-resurrect release gating (persisted prior-online marker + conditional `releaseTeacherInSessionLock`) — the matcher's NOT EXISTS predicate already neutralizes the stale-`true` window (compose rule REQ-006.4) | 2.2 (compose rule shipped instead) | `In-Session Locking (Hide from Directory)` (`docs/planning/TICKETS.md:1338-1372`) | ✅ Resolved-pointer | `docs/teachers/teacher-availability.md:299-311` (hazard + owner); journey step 5-6 asserts the compose-rule behavior | Root fix belongs inside the release transaction — never patched from the read side |
| D6 | 15-minute inactivity auto-offline sweep (keeps `is_online` truthful between manual toggles) | this plan (consume-only) | `15-Minute Inactivity Auto-Offline` (`docs/planning/TICKETS.md:1298-1334`, Blocked By the availability toggle) | ✅ Resolved-pointer | `docs/teachers/teacher-availability.md` §6.3; `docs/specs/functional-requirements.md:140-142` (FR-4.2, B.15) | Matcher only READS `is_online`; sweep correctness improves input truthfulness, not matcher semantics |
| D7 | Browse-time TOCTOU re-assert — session creation MUST re-assert `isOnline` + `is_approved` under `SELECT FOR UPDATE` per `TeacherAvailabilitySnapshotContract` | 2.3 (snapshot disclosure docblock) | session-request flow: `Session Request Notification to Teacher` (`docs/planning/TICKETS.md:1601`) + session engine | ✅ Resolved-pointer | `backend/types/contracts/teacher-availability.contract.types.ts:8-14`; `docs/backend/cross-stream-contracts.md:117-119` §7.3 | Browse results are a point-in-time snapshot by contract; booking-side verification is a distinct ownership seam |

---

## Status Values

- ✅ **Resolved-pointer** — deferred BY DESIGN to a named owning ticket/program; not debt; nothing to complete in this plan
- 🔄 **In Progress** / ⚠️ **Partial** / ❌ **Blocked** — none exist in this ledger; any future item discovered mid-implementation MUST be added here and resolved (or re-pointed with a named owner) before task 4.1 can pass

---

## Enforcement

```bash
grep -cE '^\s*\|.*(❌|⚠️)' ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/deferred-items.md
# Expected: 0  (task 4.1 BLOCKED above zero)
```

**Exit criteria:** the plan cannot be marked complete while any ❌/⚠️ remains; every entry must be a ✅ resolved-pointer with a named owning ticket and a verification reference.

---

## Related Documents

- Specs: `ai/plans/milestone_2_matching_notifications_escrow/on_demand_matching_algorithm_filter_sort_pipeline/specs.md` (governing scope ruling + REQ-001.4)
- Design: `plan.md` (D1, D5, "Deferred-Items Ledger Pointers")
- Tasks: `tasks.md` (seed table + task 4.1 gate)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
