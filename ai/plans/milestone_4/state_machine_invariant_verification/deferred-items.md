# Deferred Items Ledger

**Feature:** State Machine Invariant Verification Tests
**Plan:** `ai/plans/milestone_4/state_machine_invariant_verification`
**Created:** 2026-10-08

---

## Purpose

This ledger tracks all work deferred by this TEST-WRITING plan. The ticket ships verification tests, a census registry, and documentation only — **no schema, triggers, migrations, or product writers** (specs out-of-scope ruling #1/#2). Every enforcement gap discovered by the research dossiers is resolved IN-PLAN by pinning the shipped/app-layer semantics with tests plus doc-truthing annotations (REQ-130); the genuine schema-hardening work is recorded here as a **future-ticket pointer** and never built by this plan. All rows MUST reach ✅ before the Phase 7 gate.

---

## Ledger Table

| ID | Deferred Item | Source Task | Target Task | Status | Verified By | Notes |
|---|---|---|---|---|---|---|
| D-401 | INV-TV7 producer: rubric flow writes `teacher_verification.tajweed_level`/`hifz_level` | pre-seed (specs REQ-000.2) | 3.2 + 6.1 | ❌ Blocked | — | No producer exists; levels live in `evaluations.weakness_area` (`backend/db/schema/teachers/evaluations.ts:50`). In-plan: schema-contract probe + `KNOWN-UNIMPLEMENTED` doc annotation. Future producer ticket to be opened separately |
| D-402 | INV-W7 DB CHECK: `type <> 'earning' OR session_id IS NOT NULL` on `teacher_transaction` | pre-seed (specs REQ-000.2) | 3.5 + 6.1 | ❌ Blocked | — | Plain nullable FK today (`backend/db/schema/billing/teacher-transaction.ts:38`). In-plan: `creditEarningOnce` signature pin (fixture sessionId on every earning row, `backend/db/repo/billing/wallet.repository.ts:81`) + doc drift note. Future hardening ticket |
| D-403 | INV-E2/E6 `prevent_evaluations_delete` trigger (delete guard + full retention) | pre-seed (specs REQ-000.2) | 3.9 + 6.1 | ❌ Blocked | — | No guard exists — teardowns hard-delete successfully (`backend/db/test/repo/teachers/evaluation.repository.test.ts:290-292`); a raw DELETE-rejection test is FORBIDDEN. In-plan: source pins + E3 set-null survival pin + doc boundary note. Future migration ticket |
| D-404 | INV-U4 `prevent_users_delete` DB trigger | pre-seed (specs REQ-000.2) | 3.6 | ❌ Blocked | — | The grep-lock `backend/graphql/test/inv-u4-grep-lock.test.ts:211` stays THE enforcement. In-plan: FK-RESTRICT 23503 backstop probe + unreferenced-DELETE-succeeds pin prove the real tier. Future trigger ticket |
| D-405 | INV-PC3 `prevent_plans_delete` trigger | pre-seed (specs REQ-000.2) | 3.4 + 6.1 | ❌ Blocked | — | `PlanRepository` exposes no delete method; referenced-plan raw DELETE ⇒ 23503 `subscriptions_plan_id_fkey`; unreferenced DELETE documented as accepted boundary (`lessons.plan_id` set-null). Future trigger ticket |
| D-406 | INV-B5 reviews-lane decrementer surface (`HeldBalanceLane.Reviews` member + decrement writer) | pre-seed (specs REQ-000.2) | 3.4 + 6.1 | ❌ Blocked | — | No enum member (`backend/enum/scheduling/held-balance-lane.enum.ts:17-21`), zero decrement writers; runtime reviews-booking test FORBIDDEN. In-plan: segregation pin + doc clause marked UNIMPLEMENTED. Future surface ticket |
| D-407 | Duplicate-earning-per-session unique index (sibling financial-safety deferred item) | pre-seed (specs REQ-000.2) | 4.1 | ❌ Blocked | — | Sibling-owned hardening. In-plan: the W4 arbitration oracle (wallet null + `confirmedByStudentAt` null without student confirm) completes the no-credit-without-confirm proof. Future sibling ticket |
| D-408 | Session-status DB-trigger hardening option (dossier 01 §6.9) | pre-seed (specs REQ-000.2) | 4.3 + 6.2 | ❌ Blocked | — | `session.status` has no DB trigger; terminality is guarded-UPDATE predicates + app matrix only. In-plan: S2 journey sweep cells + the canonical doc record the option. Future hardening ticket |
| D-409 | Doc drift: `docs/parents/monitoring-portal.md` `:248/:250/:268` say "five SDL queries" — the portal exposes seven (`backend/graphql/test/schema-surface.test.ts:709-717`) | pre-seed (specs REQ-130.4) | 6.1 | ❌ Blocked | — | Pure doc-truthing row; correct five→seven with the SDL pin cite |
| D-410 | Doc drift: `docs/planning/PRODUCTION_READINESS.md` §5 stale rows — §5.3.3 "no expiry surface" (the sweep shipped, `backend/services/billing/subscription-expiry.service.ts`), unchecked §5.1/§5.2/§5.4/§5.5 rows, missing PAY/HW/PR/E/PC rows | pre-seed (specs REQ-130.2) | 6.1 | ❌ Blocked | — | Refresh with census test cites; ledger-defer missing rows with a pointer if checklist ownership resists |
| D-411 | Fixture gap: no `createTestTeacherVerification` helper (not among the verified 16 in `backend/db/test/entity-setup.ts:74-571`) | pre-seed (plan §3.3) | 3.2 | ❌ Blocked | — | Resolved by single-consumer raw `tx.insert(teacherVerification)` + `information_schema` reads — the frozen battery stays frozen (knip); do NOT add a helper |
| D-412 | Fixture gap: no `createTestProgress` helper | pre-seed (plan §3.3) | 3.8 | ❌ Blocked | — | Resolved by `ProgressRepository.insertRow({studentId, lessonId}, tx)` or raw `tx.insert(progress)`; do NOT add a helper |

---

## Status Values

- ✅ **Done** — item completed and verified (reference the target task's outcome file in Verified By)
- **Blocked** — not resolved; the plan cannot complete until addressed (shown in the table's Status cell)
- **Partial** — partially resolved, needs follow-up work (shown in the table's Status cell)
- 🔄 **In Progress** — the target task is currently working the item

> Glyph discipline: the blocked/partial status glyphs appear ONLY in the table's Status cells, so the
> Phase-7 gate (defined in `tasks.md` 7.1) can truly reach zero once every row flips to ✅.

---

## Usage Guidelines

- The pre-seeded rows (D-401..D-412) carry their **Target Task**; that task's agent flips the status to 🔄 when it starts and to ✅ when the pin/probe/doc lands, adding a verification reference (e.g. `3.2 outcome`, `6.1 outcome`) in **Verified By**.
- New discoveries during execution append rows in the table format above — name the exact missing surface/ticket; vague descriptions are rejected.
- Blocked/Partial rows MUST be resolved or explicitly re-routed before Phase 7; the future hardening tickets stay **in Notes**, never as a blocking status — the blocking status tracks only this plan's pin/document/ledger work.

---

## Enforcement

The Phase 7 final gate (tasks.md 7.1) runs the template's unresolved-item grep over this file and
MUST get `0`: every Blocked/Partial row is a plan-completion blocker until its target task flips it
to ✅ with a verification reference. The executable command lives in `tasks.md` 7.1 (kept out of this
file so the gate counts ledger rows only).

**Exit criteria:** the plan cannot be marked complete while any row is still Blocked or Partial.

---

## Anti-Patterns

- Don't "resolve" a hardening row by building schema, triggers, or writers — this plan is test-writing only (the census rows PIN the shipped tier instead).
- Don't mark ✅ without a verification reference in **Verified By**.
- Don't renumber or reuse IDs; append new rows only.
- Don't drop the future-ticket pointer from **Notes** when flipping to ✅.
- Don't defer a discovered gap silently — an unpinned, unledgered enforcement gap is a plan defect.

---

## Related Documents

- Specs: `ai/plans/milestone_4/state_machine_invariant_verification/specs.md` (REQ-000.2 pre-seeds D-401..D-408; REQ-130 drives D-409/D-410)
- Design: `ai/plans/milestone_4/state_machine_invariant_verification/plan.md` (§10 ledger protocol; §3.3 fixture model)
- Tasks: `ai/plans/milestone_4/state_machine_invariant_verification/tasks.md` (Phase 7 gate)
- Template: `.agents/spec-process-guide/templates/deferred-items-template.md`
- Canonical doc (landed by task 6.2): `docs/testing/invariant-verification.md`
