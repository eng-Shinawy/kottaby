# Deferred Items Ledger

**Feature:** Teacher Preparation View (Student Progress Before Session)
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/teacher_preparation_view_student_progress_before_session-teacher_preparation/`
**Created:** 2026-09-26

---

## Purpose

Tracks work deliberately carved out of this 3-SP ticket. D1..D6 are design decisions (plan.md D1-D5, §8, D2) whose reversal is future-scope, not blockers. All rows in a non-blocking state do not block the final gate.

## Ledger Table

| ID | Deferred Item | Source | Target | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Student display names on teacher session surfaces (rows + prep dialog header) | plan.md D7 | teacher-UX ticket touching the shared `Session` payload or a name-composite read | ⚪ Deferred (accepted) | plan.md D7 | Every teacher surface is student-ID-opaque today (`session.pothos.ts:165-266`); the server-side compose precedent exists (`session-arbitration.case-reads.helpers.ts:114`); fixing it here means modifying the shipped progress contract or the shared Session type — blast radius beyond a 3-SP read view |
| D2 | Prep affordance on the dashboard up-next card (`TeacherUpNextCard.tsx:58-94`) and `/schedule` chips | plan.md §2 (future surfaces row) | teacher-UX ticket after matching stream | ⚪ Deferred (accepted) | — | One `openPrepDialog(sessionId)` intent away; the dialog is row-derived and mounts unchanged |

| D3 | In-dialog homework-history pagination controls (page 2..N browsing) | plan.md D5 | teacher-UX ticket | ⚪ Deferred (accepted) | — | Prep shows page 1 (5 rows) + "+N more" from `totalCount`; full paging belongs to a dedicated history browser (student-side `HomeworkContainer` owns that pattern) |
| D4 | Mount the prep view inside the future session-request accept/decline flow | plan.md D2 | the request-intake ticket (accept/decline waves at `docs/planning/TICKETS.md:1611-1624`; matching filter/sort ticket at `:1457-1508`); dormant waves at `session-request-notification.service.ts:139-145` | ⚪ Deferred (accepted) | plan.md D2 | The dialog props are row-derived (`sessionId`, `studentId`, `open`, `onClose`) — the accept flow mounts it with its own intent; zero dialog changes expected |
| D5 | Preparation content for Hifz / evaluation sessions | plan.md §2 out-of-scope | hifz curriculum ticket (blocked-by plan's own D3) + evaluation UX | ⚪ Deferred (accepted) | — | Progress is the Tajweed curriculum pointer only (INV-PR2 lane); the Prepare CTA is gated `intent = tajweed` |
| D6 | Automated component-render / E2E coverage for the prep dialog | plan.md §8 (component-test reality) | whenever the repo gains a component test layer or a general Playwright config (today: E2E is the live-gated paymob suite only) | ⚪ Deferred (accepted) | plan.md §8 | Interim evidence: helper unit suites (100% branches) + journey (service boundary) + stories (every branch rendered); Task 6's dev-server DOM smoke covers the wired path |

## Status Values

- ✅ Done · ⏳ Not started (carry-forward queue) · ⚪ Deferred (accepted ADR-level deferral, non-blocking) · 🔄 In Progress
- The two blocking states (the red-cross "Blocked" glyph and the yellow-warning "Partial" glyph) are intentionally written as words here so the final-gate glyph grep has ZERO false positives: any such glyph appearing in this file is a REAL blocker.

## Enforcement

Final gate (Task 9): grep this ledger for the red-cross or yellow-warning glyphs — expected count is exactly 0. All current rows are ⚪ — zero blockers at plan-authoring time.
