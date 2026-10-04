# Deferred Items Ledger

**Feature:** Surah/Juz Enum Homework Tracking
**Plan:** `ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/`
**Created:** 2026-10-04

---

## Purpose

This ledger tracks work deferred out of this plan's tasks so nothing is forgotten. Context:
the BLOCKING plan's ledger row D1 ("Full 114-surah `SurahJuzRef` enum expansion") is
**discharged by this plan itself** (its core deliverable) and therefore does not appear as a
row here. The rows below are carry-overs this plan deliberately does NOT absorb, each with a
named owner surface.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task / Owner Surface | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Read-surface localized label adoption: swap the regex `formatSurahJuzRef` (`frontend/views/parent/monitoring/parentMonitoringDisplay.ts:52-56`) for `t.surahJuzLabel` across its consumers — parent portal (`HomeworkSummary.tsx:7`, `HomeworkTab.parts.helpers.tsx:7,61`, `ProgressSummary.tsx:8`, `ProgressTab.parts.tsx:6,93`), admin tracking (`academic-tracking-display.ts:17,61,87`), student homework (`homework.helpers.ts:16,59-60,113-114` incl. the formatted-text search probe + print rows). Requires a wire-value→ref helper (backend enum key→value lookup, parity-tested). | Blocking plan's ledger D2 (handed off into this plan's scope ruling — decision D7) | Next parent-portal display ticket | 🔄 Handed off | Blocking plan ledger D2 + this plan's §4/§11 | No breakage: the regex mechanically splits the new CamelCase keys (English-only, no diacritics). Amplified urgency post-expansion: 109 more members render un-localized on 3 read surfaces / 8 files. Fold-out would breach this 3-SP ticket's scope. |
| D2 | Per-surah ayah-count metadata: model each surah's ayah count and validate homework spans (`toAyah` ≤ surah bound; today guards only check `from ≤ to ≤ MAX_AYAH_VALUE`, `session-report.guards.ts:147-160`). Enables richer picker affordances (bounded ayah inputs). | This plan (REQ-2 boundary analysis) | Curriculum/content stream (future ticket) | 🔄 Handed off | — | Not modeled anywhere today; requires a canonical per-surah dataset + guard + test updates. Out of this plan's scope (schema/metadata addition). |

---

## Status Values

- ✅ **Done** — completed and verified (outcome file / commit reference)
- ⚠️ **Partial** — partially resolved, needs follow-up
- ❌ **Blocked** — unresolved; plan cannot complete until addressed
- 🔄 **In Progress / Handed off** — actively worked, or deliberately transferred to a named
  owner surface with documented rationale

---

## Usage Guidelines

- Add a row whenever a task discovers work owned by a different task/ticket/plan.
- Update status with a verification reference when resolving.
- Reference rows from outcome files ("Deferred X to owner Y — see deferred-items.md D1").

---

## Enforcement

The final gate (Task 7.1) runs a **row-scoped** check (the Status Values legend below
legitimately contains the glyphs, so the gate scopes to ledger table rows only):

```bash
grep -E '^\| D[0-9]+' ai/plans/milestone_2_matching_notifications_escrow/surah_juz_enum_homework_tracking/deferred-items.md | grep -c '❌\|⚠️'
```

**Expected: 0.** Handed-off rows (🔄) carry a named owner surface and a documented rationale —
they are deliberate scope boundaries, not orphans. If either row regains ❌/⚠️ status, the
plan is blocked until re-triaged.

---

## Related Documents

- Blocking plan (implemented): `ai/finished_plans/milestone_2_matching_notifications_escrow/session_report_submission_with_homework_jadid_madi/`
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- This plan's scope rulings: `plan.md` §3 (D7), `specs.md` Out-of-scope
