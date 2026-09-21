# Deferred Items Ledger

**Feature:** Student Progress Tracking & Increment
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/student_progress_tracking_&_increment-progress_tracking_increment/`
**Created:** 2026-09-21

---

## Purpose

Tracks work deliberately carved out of this 5-SP ticket. D1 arrives carried from an upstream plan's ledger; D2–D7 are design decisions (plan.md D1–D2, D4, D8) whose reversal is future-scope, not blockers. All rows that are NOT in a blocking state do not block the final gate.

## Ledger Table

| ID | Deferred Item | Source | Target | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Lesson reordering / `position` column on `lessons` | Lessons plan D1 (carried forward) | future admin-curriculum ticket | ⏳ Not started | — | Lessons are `id ASC`-ordered by contract; this plan CONSUMES that order — no work here |
| D2 | Progress advance on admin-arbitrated completions (`resolveDisputeCompleteOnce`, `resolveConsumedDisputeOnce`) | This plan, D2 | arbitration follow-up ticket | ⚪ Deferred (accepted) | plan.md D2 | Those paths set `completed` without wallet credit (repo comment: "credit flow is a later ticket's concern"); progress follows money-settlement, consistently |
| D3 | Hifz curriculum tracking (`intent = hifz`) | This plan, D3 | hifz curriculum ticket | ⚪ Deferred (accepted) | — | Ticket scope is Tajweed only (INV-PR2 wording) |
| D4 | Parent-portal progress surface upgrade (percentage + lesson names instead of raw count) | This plan, D8 | parents-domain ticket | ⚪ Deferred (accepted) | — | Portal keeps `countForStudent` honest-count rendering; zero regression |
| D5 | Progress for trial-funded sessions (no active tajweed subscription) | This plan, D4/REQ-008 | payments/trials ticket | ⚪ Deferred (accepted) | — | Skip-with-log is the honest behavior (`no-active-tajweed-subscription`) |
| D6 | Append-only per-lesson completion history (audit-style) + unique constraint revisit | This plan, D1 | future curriculum-analytics ticket | ⚪ Deferred (accepted) | — | Pointer model answers all current asks; revisit only if analytics need per-lesson timestamps |
| D7 | Admin UI / student dashboard surfacing of progress | This plan, §2 | Teacher Preparation View + later UI tickets | ⚪ Deferred (accepted) | — | Explicit no-UI ruling; this plan ships the API those UIs consume |

## Status Values

- ✅ Done · ⏳ Not started (carry-forward queue) · ⚪ Deferred (accepted ADR-level deferral, non-blocking) · 🔄 In Progress
- The two blocking states (the red-cross "Blocked" glyph and the yellow-warning "Partial" glyph) are intentionally written as words here so the final-gate glyph grep has ZERO false positives: any such glyph appearing in this file is a REAL blocker.

## Enforcement

Final gate (Task 8): grep this ledger for the red-cross or yellow-warning glyphs — expected count is exactly 0. All current rows are ⏳/⚪ — zero blockers at plan-authoring time.
