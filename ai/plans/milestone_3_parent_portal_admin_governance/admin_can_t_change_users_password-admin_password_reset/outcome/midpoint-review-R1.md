# Mid-Point Review Gate — Round 1 (backend scope, post Phase 0–3 + i18n)

**Plan:** `ai/plans/milestone_3_parent_portal_admin_governance/admin_can_t_change_users_password-admin_password_reset/`
**Trigger:** Session-mandated gate (SKILL.md §Mid-Point Review Gate). Note: the plan documents the mid-point gate as SKIPPED (rationale: linear chain, journey-as-integration-gate); the executing session's review requirements override with a zero-skip mandate, so the gate was run after the backend chain (Tasks 0–8, commit `0d899ac1`) and before the frontend tasks (9/10).
**Reviewers (parallel, independent, read-only):** review-backend · review-types+review-config · pentester
**Scope:** `git diff 5a8369fe..0d899ac1` — 17 backend/source files + tests (all Tasks 0–8 deliverables).

## Verdicts

| Reviewer | Verdict | Findings |
|---|---|---|
| review-backend | PASS | 1 HIGH, 3 LOW |
| review-types + review-config | PASS | 0 findings |
| pentester | PASS | 0 CRITICAL/HIGH/MEDIUM, 2 LOW |

## Findings aggregation (deduplicated; pre-existing filtered)

| # | Severity | Location | Finding | Disposition |
|---|---|---|---|---|
| F1 | HIGH | `backend/graphql/mutation/admin/admin-users.mutation.ts` + `test/workflows/admin/audit-completeness.catalog.ts` | `adminSetUserPassword` not yet registered in `ADMIN_ACTION_CENSUS`/`USER_LIFECYCLE_LEG`; census drift test red (3 fail) — the "census-before-admin-mutation" rule | **Tracked → planned Task 12** (dependency graph: 12 needs 5+11; 11 authored test-first). Will land before Task 14's final gate. Reviewers confirmed the intended sequencing. |
| F2 | LOW→FIXED | `backend/services/admin/user-management.service.ts` | Deleted target not denied (specs REQ-008 actor table: "any non-deleted user" vs plan D4 omission) | **Fixed (mid-fix-1)**: in-tx returned-row check (`written.isDeleted === true` → `NotFoundError("USER")` before audit insert; tx rollback ⇒ zero writes + zero audit). +1 test (78 pass / 0 fail). |
| F3 | LOW | `backend/graphql/passwordChangeGate.ts:208` | Numeric `http.status = 200` literal adjacent to taxonomy-only-status rule (non-error 200 channel; pinned by test + documented in-file) | **Accepted**: exemption noted in gate file + this outcome; optional future named constant. |
| F4 | LOW | `backend/services/auth/auth.service.ts` | Same-as-current guard precedes policy check (legacy short stored credential edge) — matches plan D5 order verbatim | **Accepted**: documented order, not a defect. |

## Pentest probes (all clean)

BOLA/IDOR (no identity member on `ChangeMyPasswordInput`; double-validated admin id) · vertical escalation (scope `$all` + service DB re-read) · gate escapability (aliases/fragments/cycles/batch/subscriptions/introspection — 34/34 gate tests) · SSR/client fence order · injection (parameterized SQL) · information disclosure (`passwordHash` grep-absent from SDL; constant denial shapes; deep-walk test) · mass assignment (closed whitelist untouched; single flag-write callsite) · audit atomicity (tx-shared audit; zero-audit denials).

## Pre-existing observations (non-blocking)

- `ctx.role` for `role:` authScope comes from the JWT claim (pre-existing); service `assertActorAdminActive` DB re-read covers demotion — feature strengthens the vector.
- D2 (token revocation) / D3 (rate limit) are accepted ledger deferrals — not findings.
- No `auth`-namespace parity walker exists (compile-time `AuthLabels` typing only) — pre-existing structural gap.
- Mid-plan state: `/change-password` page (Task 10) and shared documents selecting the flag (Task 9) pending — SSR fence temporarily targets a 404; server gate remains authoritative meanwhile.

## Gate exit

Backend-specific NEW findings after fix wave: **0 blocking** (F1 tracked to Task 12; F3/F4 accepted-documented). Gate passed — frontend phases (9/10) unblocked.
