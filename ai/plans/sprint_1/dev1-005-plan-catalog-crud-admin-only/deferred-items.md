# Deferred Items Ledger

**Feature:** `dev1-005-plan-catalog-crud-admin-only`  
**Plan Directory:** `ai/plans/sprint_1/dev1-005-plan-catalog-crud-admin-only/`  
**Created:** `2026-08-26`

---

## Purpose

This ledger tracks all work deferred from one task to another to ensure no deferred item is forgotten. Every deferred item must be explicitly logged here and resolved before the plan is marked complete.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D1 | Audit-log integration for plan mutations (hook points only in this ticket) | 0.1 | DEV3-020 | ❌ Blocked | — | Non-blocking sanctioned deferral: this ticket ships audit hook points only; full audit-log integration owned by DEV3-020 |
| D2 | Purchase-time active-plan re-validation (`is_active = true` inside purchase transaction) | 0.1 | DEV1-006 | ❌ Blocked | — | Non-blocking forward contract: this ticket ships the predicate; purchase-time re-validation owned by DEV1-006 |
| D3 | DEV1-004 guarded-update precedent (`grantFreeTrialOnce`-pattern) missing from codebase — reference implementation for REQ-014/015 does not exist in `backend/` | 0.2.5 | 0.3 (ruling) → 2.2/2.3 (implementation) | ✅ Done (resolved by 0.3 gate — option (a)) | 0.2 verification subagent → 0.3 plan-review gate | Evidence (verified 0.2): `grantFreeTrialOnce` → 0 hits in `backend/` (only in `ai/plans/sprint_0/dev1-004-free-trial-session-provisioning/plan.md` + this plan's docs); `balance_trial`/`trial_granted_at` columns → 0 hits in `backend/db/schema/` (`students.ts` has only `balance_hifz/tajweed/reviews`); guarded conditional UPDATE (`.where(and(eq(...), isNull(...)))` + `.returning()`) → 0 hits in `backend/db/repo` + `backend/services` (closest partial precedent: single-statement `UPDATE … WHERE id … RETURNING` at `backend/db/repo/teachers/applicant.repository.ts:145-149`, no predicate guard). DEV1-004 (sprint_0) has no `outcome/` dir → planned, never executed. RESOLUTION PATHS for the 0.3 plan-review gate (pick one as a pre-implementation amendment per 0.3.2): (a) amend plan.md D2/REQ-014/015 to make the REQ-014/015-specified guarded UPDATE the normative, spec-defined pattern (specs.md:57-58 fully define the SQL) with `ai/plans/sprint_0/dev1-004-free-trial-session-provisioning/plan.md` (D2 ruling + `grantFreeTrialOnce` sketch) as DOCUMENTED reference only — downgrading the "proven, reviewed" code-reuse claim; or (b) land the DEV1-004 precedent first (out of this ticket's scope). RESOLVED by the Task 0.3 plan-review gate via resolution path (a): plan.md (canonical-refs header + D2 rationale) and tasks.md 0.2.5 amended so the REQ-014/015-specified guarded conditional UPDATE is the normative, spec-defined pattern (specs.md REQ-014/015 + plan.md §4.2 `setActiveStatusOnce` sketch are fully normative — SQL, TOCTOU-window-zero argument, and `PLAN_ALREADY_*` mapping unchanged), with `ai/plans/sprint_0/dev1-004-free-trial-session-provisioning/plan.md` downgraded to DOCUMENTED design reference only (the repo never merged DEV1-004 code; closest partial in-repo precedent: single-statement `UPDATE … WHERE id … RETURNING` at `backend/db/repo/teachers/applicant.repository.ts:145-149`, no predicate guard). Tasks 2.2.3 (`setActiveStatusOnce`) / 2.3.4 (`setPlanActiveStatus`) UNBLOCKED. |

---

## Status Values

- ✅ **Done** — Item completed and verified
- ⚠️ **Partial** — Partially completed, needs follow-up work
- ❌ **Blocked** — Not resolved, plan cannot complete until addressed
- 🔄 **In Progress** — Currently being worked on
