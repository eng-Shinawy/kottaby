# Deferred Items Ledger

**Feature:** `Failed Applicant → Student Record Conversion`
**Plan:** `ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/`
**Ticket:** `docs/planning/TICKETS.md:872-912` — Dev 2 · Milestone 1 · 3 SP
**Blocked By:** `Cooldown State Machine (1-Month Tajweed / 3-Month Hifz)` (`ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/` — NOT yet implemented; its own blocker `Evaluation Rubric Scoring` IS shipped/archived at `ai/finished_plans/milestone_1_core_domain_mvp/evaluation_rubric_scoring/`)
**Created:** 2026-09-30

---

## Purpose

This ledger tracks all work deliberately carved out of this 3-SP backend-only slice so that no deferred item is lost. Each entry is either an **intentional cross-plan / child-ticket boundary** (📋 `Deferred-to-follow-up`, `Deferred-to-child-ticket`) or a **permanent architectural decision / accepted scope limit** (📋 `Deferred-by-design`). None of the five entries below is a blocker.

The final quality gate (Task 7) enforces that **zero ❌ / ⚠️** entries remain. This plan is authored as complete-able: all rows are 📋 at plan-authoring time.

**Scope anchor.** This ticket performs an atomic `students`-row insert + `teacher`→`student` role flip INSIDE the existing rubric finalization transaction (`finalizeRubricFail` / `finalizeRubricPass`, `backend/services/teachers/evaluation-rubric.helpers.ts:342-395`). It is **schema-neutral at the SDL level** and adds **no UI** (no routes, no nav, no Apollo documents). Everything that would widen the blast radius beyond the two rubric call-sites, introduce a migration, add a wire field, or touch a frontend surface is deferred below.

---

## Ledger Table

| ID | Deferred Item | Source | Target | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Widen `myApplicantProfile` scope from `[UserRole.Teacher]` to `[UserRole.Teacher, UserRole.Student]` | plan.md D6 | Sibling **Cooldown State Machine** plan (`ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/`) — cross-plan item | 📋 Deferred-to-follow-up | plan.md D6; `backend/graphql/query/teachers/applicant.query.ts:59` | After the `teacher`→`student` flip a converted student can no longer read `myApplicantProfile` (gate is Teacher-only), so the Cooldown plan's derived `cooldownState` read-model becomes unreachable for converted students. THIS ticket leaves the gate UNCHANGED (minimal blast radius on a shipped, test-locked surface). The widening is safe — `ApplicantLifecycleService.getMyApplicantProfile` returns `null` for a caller with no `applicants` row (`backend/services/teachers/applicant-lifecycle.service.ts:142-181`). Re-apply remains fully functional without it: `purchaseVerificationPlan` is `authenticated`-only (`backend/graphql/mutation/verification-plan-purchase.mutation.ts:50`) and its 422 `APPLICANT_COOLDOWN_ACTIVE` carries the cooldown expiry. Cross-reference this row with the Cooldown plan's own ledger before shipping either. |
| D2 | Audit-log row for the conversion event (a durable `audit_logs` entry recording the role flip + `students`-row creation) | plan.md D7 | **Audit-completeness stream** (a dedicated cross-domain ticket hardening audit coverage) | 📋 Deferred-to-follow-up | plan.md D7 | The conversion is currently observable only via the DB row (`applicants.status='failed'` + the new `students` row + `users.role`). This ticket does NOT add an audit write — doing so pulls in the audit-logs schema/action-enum surface and its own test matrix, expanding a 3-SP slice. The rubric fail path already owns its verdict/notification audit posture; the conversion rides the same transaction. Revisit when the audit-completeness stream standardizes role-transition auditing. |
| D3 | Forced session / access-token invalidation on the role flip (revoke existing JWTs at conversion time) | plan.md D9 | — (permanent boundary; no target) | 📋 Deferred-by-design | plan.md D9; `backend/services/auth/auth.service.ts:257` | NOT a deferral to be resolved later — a permanent architectural decision. JWT role staleness **self-heals**: the Pothos `role` scope reads `ctx.role` from the token claim (`backend/graphql/pothos/builder.ts`), but `AuthService.refreshToken` re-reads the DB user row and re-signs the access token with the **current DB role** (`auth.service.ts:257`). The `teacher`→`student` flip therefore takes effect on the next silent token refresh with **no forced logout or token revocation**. A forced-revocation path would add a session-store dependency the current auth model does not have. |
| D4 | Conversion of a rejected applicant on the **admin-override REJECT** path | plan.md §1 boundary note | Child ticket **Admin Override of Evaluation Results** (`docs/planning/TICKETS.md:916-958`, Blocked By the Cooldown plan) | 📋 Deferred-to-child-ticket | plan.md §1; `docs/teachers/evaluation-rubric-scoring.md:162` (FAIL-path contract) | This ticket wires the conversion into the rubric **fail** finalization only (`finalizeRubricFail`) plus **re-certification** restoration (`finalizeRubricPass`). An admin override that REJECTS through a different code path is the child ticket's responsibility; it will reuse the same `ApplicantConversionService.convertToStudent` primitive shipped here. Analogous to the Cooldown plan's D2 (admin-override composition boundary). |
| D5 | Frontend surfacing of the conversion (student dashboard showing cooldown banner, re-apply CTA, student-identity affordances) | plan.md §1 NO-UI ruling | Child/UI ticket (a frontend slice after the backend slice lands) | 📋 Deferred-to-child-ticket | plan.md §1 (explicit NO-UI ruling) | This plan is **backend-only**: zero new routes, zero nav items, zero Apollo documents, zero MUI components. The role flip makes the existing student surfaces reachable (verified by Task 6 wire tests), but rendering cooldown/re-apply UX for converted students is a separate UI ticket. INV-TV6 is satisfied at the wire (the account IS a `student`); presentation is out of scope. |

---

## Status Values

- ✅ **Done** — Item completed and verified (reference the outcome file or commit).
- ⚠️ **Partial** — Partially completed, needs follow-up work. *(blocker)*
- ❌ **Blocked** — Not resolved; the plan cannot complete until addressed. *(blocker)*
- 🔄 **In Progress** — Currently being worked on.
- 📋 **Deferred-to-follow-up** — Intentionally out of scope for this plan; tracked as a named follow-up / cross-plan item (NOT a blocker).
- 📋 **Deferred-to-child-ticket** — Intentionally out of scope; belongs to a sibling or child ticket (NOT a blocker).
- 📋 **Deferred-by-design** — A permanent architectural boundary or accepted scope limit documented in the plan's design decisions (NOT a blocker).

The two blocking glyphs (⚠️ / ❌) are written only in this legend; elsewhere in this file they appear **only as real blockers** so the final-gate glyph grep has zero false positives.

---

## Enforcement

The final quality gate (Task 7 in `tasks.md`) verifies zero unresolved blockers:

```bash
# Count unresolved BLOCKERS (⚠️/❌ ledger rows only — 📋 items are intentional, NOT blockers).
# Row-anchored regex so the status-legend and prose glyph mentions never match.
grep -cE "^\| D[0-9]+ .*(❌|⚠️)" ai/plans/milestone_1_core_domain_mvp/failed_applicant_student_record_conversion/deferred-items.md

# Expected: 0
# (📋 Deferred-to-follow-up / Deferred-to-child-ticket / Deferred-by-design entries are NOT counted.)
```

**Exit criteria:** the plan CAN be marked complete with 📋 entries present (they are intentional cross-plan boundaries or architectural decisions), but MUST have **zero** ❌/⚠️ entries. All five deferrals (D1..D5) are 📋 — the plan is complete-able as authored. The same command is re-run by Task 7 after the whole-plan `bun quality-gate` passes.

---

## Related Documents

- Specs: `specs.md` REQ-004 (applicants preserved), REQ-005 (role flip / INV-TV6), REQ-006 (atomicity/idempotency), REQ-007 (re-certification restoration), REQ-010 (security/tenancy)
- Design: `plan.md` §1 Scope (NO-UI ruling), D6 (`myApplicantProfile`), D7 (audit deferral), D9 (JWT self-heal), §1 boundary note (admin override)
- Binding docs: `docs/teachers/applicant-lifecycle.md:75` (§2.5 students/applicants co-existence), `docs/teachers/evaluation-rubric-scoring.md:162` (FAIL-path contract — amended by Task 8), `docs/specs/functional-requirements.md:18,110-120` (FR-1.2, FR-3.6/3.7), `docs/specs/state-machine-invariants.md:92` (INV-TV6)
- Sibling plan (cross-plan partner for D1): `ai/plans/milestone_1_core_domain_mvp/cooldown_state_machine_1_month_tajweed_3_month_hifz/deferred-items.md`
- Process: `.agents/skills/spec-driven-development/SKILL.md` (deferred-items ledger enforcement), `.agents/spec-process-guide/execution/implementation-guide.md` (deferred item workflow)
