# Phase 1.5 Plan-Review — Round 1 (R1)

**Plan directory (verbatim):** `ai/plans/milestone_2/in_session_locking_hide_from_directory/`
**Reviewed artifacts:** `specs.md` (REQ-001..REQ-023) · `plan.md` (design D1–D6) · `tasks.md` · `deferred-items.md` (ledger D1–D8)
**Review method:** three parallel review agents — (A) full `plan-review` skill application (`.agents/skills/plan-review`) against root + layer `AGENTS.md` and `.agents/instructions/*`; (B) evidence verification of every cited `path:line` anchor + signature against the live tree (~150 anchors checked); (C) anti-pattern sweep + internal-consistency audit (plan-directory string, REQ traceability, D-id consistency, truncation, 5-stage pipeline completeness, section completeness, protocol-command accuracy).
**Date:** 2026-10-04

---

## Governing rulings — RATIFIED (unanimous, evidence-accurate)

1. **Lock re-locked, not rebuilt** — `startSession` already composes the INV-S6 lock in-tx (`session-lifecycle.service.ts:283`, fail-closed `:284-289`, INV-S6 suite `session-lifecycle.service.test.ts:3245-3440`). Verified by all three reviewers.
2. **Accept ≙ `startSession`** — no accept/decline production flow exists (five emitters at `session-request-notification.service.ts:229-276` have zero production callers; booking inserts at `scheduled` with no `is_online` write, `session-lifecycle.booking.ts:179,245-261`); INV-A2 binds `started` (`state-machine-invariants.md:121`).
3. **INV-A3 = data-level only** — no student-facing directory/matching surface exists anywhere (grep-verified); Dev 3 owns the read-side (`TICKETS.md:1457`, `:1509`); forward contract intact.
4. **INV-A4 = marker-gated release** — `releaseTeacherInSessionLock` restores `true` unconditionally today (`session-lifecycle.transitions.ts:249-257`); the canonical doc prescribes the marker fix for this ticket (`teacher-availability.md:305-313`); "app open" liveness composes with the `TICKETS.md:1298` sweep per its own AC (`:1322-1324`).
5. **Admin-governance leak + classifier pollution are real** — zero release references in `session-admin-governance.helpers.ts` (grep-verified); `guardReschedule` pollutes `startedAt` on scheduled rows (`session.repository.helpers.ts:443-457`).
6. **`setOnline` retirement (three-writer map)** — exactly three production callers verified; single-writer rule honored; knip dead-export policy supports deletion.

## Round-1 verdict (before fixes)

**PLAN FAILS — 15 deduplicated findings** (3 MEDIUM, 12 LOW; 0 CRITICAL/HIGH). All were plan-artifact text/anchor fixes; none invalidated a governing ruling, and no architecture, i18n, GraphQL, type, permission, or test-discipline violation existed. ~150 cited anchors verified accurate; ~70 additional consistency anchors verified clean; anti-pattern sweep, plan-directory-string audit, truncation check, pipeline completeness, and section completeness all CLEAN from the start.

## Fixes applied (all 15 — every finding resolved in-place)

| # | Sev | Finding (source) | Fix applied |
|---|-----|------------------|-------------|
| 1 | MEDIUM | Task 5.1 missed the `setOnline` doc blast radius (19 present-tense doc references survive the method's retirement) (A#1) | tasks 5.1: added the `grep -rn "setOnline" docs/` sweep bullet (itemizing `teacher-availability.md` §3.1 `:92-103`, §4.1 `:172-182`, `:41-42`, `:75`, `:162`, `:215`, `:315`; `session-lifecycle.md:190`); 5.1.TE grep list extended with the `setOnline` historical-only check |
| 2 | MEDIUM | Task 2.4.SR demanded `setOnline` gone before 3.4 rewires — unsatisfiable checkbox (A#2) | 2.4.SR rescoped to "this task's slice; retirement tracked by ledger D8, grep-verified at 3.4"; 0.1 reworded to "verify/complete the already-seeded ledger (D1–D8)"; 2.4's D8 instruction changed to "verify ledger D8 already records the split" |
| 3 | MEDIUM | "Teacher row is the transaction's LAST row-lock" was false (wave/receipt writes follow it) and would enter a docblock (A#3) | Reworded in specs REQ-008.4, plan §5.3, plan §6 table, tasks 3.3, 3.3.SR, 0.3(c) to the TRUE claim: teacher row acquired after the session-row transition and before the notification-receipt writes — same lock order as the completion path (consistent ordering = deadlock safety) |
| 4 | MEDIUM | Locale-key anchor drift `labels.ts:243-249` would self-trip the 0.2 drift rule (A#6, B#1, D) | Corrected to `labels.ts:293-299` in specs REQ-002.1 and tasks 0.2 (keys verified at `:293/:297/:299`) |
| 5 | LOW | Deploy-cutover edge unaddressed (in-flight `started` sessions hold no marker) (A#4) | plan §11: added the compatibility note (release resolves `no_lock_held`; teachers self-heal via manual toggle; optional one-time backfill documented, not scheduled); 5.1 adds the cutover note to the session-lifecycle doc bullet |
| 6 | LOW | Repo-tier three-way disambiguation deviates from `backend/db/repo/AGENTS.md:30` zero-row convention (A#5) | RATIFIED as a conscious deviation with rationale in plan §4.2; 2.3.SR pins "do not fix it into the service tier" |
| 7 | LOW | REQ-001.2 said D1–D7 "defined in §2.2" but §2.2 letters only D1–D5 (A#7, Cons-A) | specs REQ-001.2 pointer corrected (§2.2 → D1–D5; REQ-011 AC-5 → D6; §7 assumption (c) → D7); the §2.2 sixth bullet now notes it is exclusion-by-design with D6 covering the rejected flag variant |
| 8 | LOW | D-id namespace collision: design D1–D6 vs ledger D1–D8 used bare (Cons-B) | All bare refs disambiguated: "(design D4)" (tasks 0.3), "(design D6)" (tasks 3.2), "(ledger D2)" (plan §7), "design D4"/"specs REQ-006.5" (ledger D3), "specs §7 assumption (c)" (ledger D7 source) |
| 9 | LOW | D1 named a nonexistent emitter `…SessionAlternativesOffered` (A#8) | ledger D1 now lists all five emitters explicitly with exact names (`notifyStudentOfAlternativesOffered` at `:269` — grep-verified) |
| 10 | LOW | plan §3 denial-taxonomy attributed to `error-code-taxonomy.ts` (wrong evidence) (A#8, B#2) | Re-anchored to `teacher-availability.mutation.ts:33-35` + integration suite; `ConflictError` at `backend/lib/errors.ts:171-183` carries the 409 |
| 11 | LOW | `cancelSession` scope range `:235-265` imprecise (B#4) | Corrected to `:213-238` (scope at `:227-229`) |
| 12 | LOW | `teacher-availability.md:308` quote anchor off by 3 (B#3, Cons-F) | Corrected to `:305` (specs §1.3) |
| 13 | LOW | "20-way chaos" misdescribed the existing 25-way repo case (B#5) | plan §10 + tasks 2.4 MIGRATE now say 25-way existing (`:562-580`), preserve-or-exceed; 20-way remains the NEW-tests prescription |
| 14 | LOW | tasks 2.3.TE Tier-3 fixture self-contradictory ("two teachers" ⇒ both release) (A#9) | Rewritten: ONE teacher with two started sessions racing (exactly one `"released"`, other `"active_sessions_remain"`) + a two-teacher control asserting both release |
| 15 | LOW | `JourneyActor` anchor `:62-67` off (it is `:43-47`) (Cons-E) | plan §7 corrected |

Reviewer claims REJECTED after ground-truth check (recorded for the audit trail): (a) "the enforcement re-export is at `backend/services/classes/index.ts:5`" — it is at `:6` (`export * from "./session-lifecycle.enforcement"` verified by direct read); the plan's original cite stands. (b) `notifyStudentOfAlternativesOffered` at `:275` — it is at `:269` (grep-verified); fixed accordingly in fix #9.

## Post-fix verification (re-review evidence)

- All 15 fixes applied via surgical edits; every edited string re-grepped clean (no `243-249`, no "LAST row-lock", no "(D4)"/"(D6)"/"(D2)" bare refs, no `:308`, no `notifyStudentOfSessionAlternativesOffered`, no "two teachers' rows" fixture, no "initialize … D1–D7").
- Traceability re-run: every `REQ-001..REQ-023` in `specs.md` present in `tasks.md` — zero misses.
- Anti-pattern sweep re-run on all four artifacts: zero forbidden usages (all occurrences are prohibition-context only); plan-directory string exact in every occurrence.
- Truncation check re-run: all four artifacts end in complete sentences/tables.
- Ledger gate: `grep -cE '^\s*\|.*(❌|⚠️)' deferred-items.md` = 0 (resolved-pointers only).

## R1 verdict (after fixes)

**PLAN PASSES ALL RULES** — zero unresolved findings across the plan-review skill dimensions (architecture/layering, i18n, GraphQL, type patterns, permissions, cross-references, 5-stage pipeline, Drizzle discipline, test-layer constraints), evidence verification (~150 anchors accurate post-fix), and internal consistency. The four governing rulings stand ratified. Implementation may begin at task 0.1.

**Carry-overs for executors:** (1) ledger D8 ordering guard (2.4/3.4 split) — flip its status note when the final `setOnline` grep is clean; (2) the §4.2 repo-tier deviation is RATIFIED — do not refactor it into the service tier; (3) the deploy-cutover transient (plan §11) is accepted by design — do not add a backfill task without ops sign-off; (4) `backend/services/classes/index.ts:6` cite is correct as-is.
