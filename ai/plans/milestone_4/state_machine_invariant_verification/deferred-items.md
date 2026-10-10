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
| D-401 | INV-TV7 producer: rubric flow writes `teacher_verification.tajweed_level`/`hifz_level` | pre-seed (specs REQ-000.2) | 3.2 + 6.1 | ✅ Done | 3.2 outcome (schema-contract probe + round-trip) + 6.1 outcome (TV7 `KNOWN-UNIMPLEMENTED` doc annotation landed) | No producer exists; levels live in `evaluations.weakness_area` (`backend/db/schema/teachers/evaluations.ts:50`). In-plan: schema-contract probe + `KNOWN-UNIMPLEMENTED` doc annotation. Future producer ticket to be opened separately |
| D-402 | INV-W7 DB CHECK: `type <> 'earning' OR session_id IS NOT NULL` on `teacher_transaction` | pre-seed (specs REQ-000.2) | 3.5 + 6.1 | ✅ Done | 3.5 outcome (creditEarningOnce session-link signature pin) + 6.1 outcome (W7 signature-level-enforcement doc annotation landed) | Plain nullable FK today (`backend/db/schema/billing/teacher-transaction.ts:38`). In-plan: `creditEarningOnce` signature pin (fixture sessionId on every earning row, `backend/db/repo/billing/wallet.repository.ts:81`) + doc drift note. Future hardening ticket |
| D-403 | INV-E2/E6 `prevent_evaluations_delete` trigger (delete guard + full retention) | pre-seed (specs REQ-000.2) | 3.9 + 6.1 | ✅ Done | 3.9 outcome (surface-absence source pins + E3/E6 set-null survival pin) + 6.1 outcome (E2/E6 design-boundary doc notes landed) | No guard exists — teardowns hard-delete successfully (`backend/db/test/repo/teachers/evaluation.repository.test.ts:290-292`); a raw DELETE-rejection test is FORBIDDEN. In-plan: source pins + E3 set-null survival pin + doc boundary note. Future migration ticket |
| D-404 | INV-U4 `prevent_users_delete` DB trigger | pre-seed (specs REQ-000.2) | 3.6 | ✅ Done | 3.6 outcome | The grep-lock `backend/graphql/test/inv-u4-grep-lock.test.ts:211` stays THE enforcement. In-plan: FK-RESTRICT backstop probe + unreferenced-DELETE-succeeds pin landed (`student_status_history.test.ts`). Future trigger ticket |
| D-405 | INV-PC3 `prevent_plans_delete` trigger | pre-seed (specs REQ-000.2) | 3.4 + 6.1 | ✅ Done | 3.4 outcome (writer-absence namespace/source pin + referenced-plan restrict-FK probe + unreferenced-DELETE boundary pin) + 6.1 outcome (PC3 design-boundary doc note landed) | `PlanRepository` exposes no delete method; referenced-plan raw DELETE ⇒ 23001 `restrict_violation` on `subscriptions_plan_id_plans_id_fkey`; unreferenced DELETE documented as accepted boundary (`lessons.plan_id` set-null). Future trigger ticket |
| D-406 | INV-B5 reviews-lane decrementer surface (`HeldBalanceLane.Reviews` member + decrement writer) | pre-seed (specs REQ-000.2) | 3.4 + 6.1 | ✅ Done | 3.4 outcome (reviews-lane exclusion pin: enum vocabulary + frozen-map absence) + 6.1 outcome (B5 reviews-decrement clause marked UNIMPLEMENTED in the doc) | No enum member (`backend/enum/scheduling/held-balance-lane.enum.ts:17-21`), zero decrement writers; runtime reviews-booking test FORBIDDEN. In-plan: segregation pin + doc clause marked UNIMPLEMENTED. Future surface ticket |
| D-407 | Duplicate-earning-per-session unique index (sibling financial-safety deferred item) | pre-seed (specs REQ-000.2) | 4.1 | ✅ Done | 4.1 outcome | Sibling-owned hardening. In-plan: the W4 arbitration oracle (wallet null + `confirmedByStudentAt` null without student confirm) completes the no-credit-without-confirm proof — landed as the binding-named arbitration-Complete test in `backend/services/classes/session-lifecycle.service.test.ts` (wallet never ensured, zero earning ledger rows for the session). Future sibling ticket |
| D-408 | Session-status DB-trigger hardening option (dossier 01 §6.9) | pre-seed (specs REQ-000.2) | 4.3 + 6.2 | ✅ Done | 4.3 outcome (journey sweep cells) + 6.2 outcome (canonical doc record of the trigger option, docs/testing/invariant-verification.md §4) | `session.status` has no DB trigger; terminality is guarded-UPDATE predicates + app matrix only. In-plan: S2 journey sweep cells + the canonical doc record the option. Future hardening ticket |
| D-409 | Doc drift: `docs/parents/monitoring-portal.md` `:248/:250/:268` say "five SDL queries" — the portal exposes seven (`backend/graphql/test/schema-surface.test.ts:709-717`) | pre-seed (specs REQ-130.4) | 6.1 | ✅ Done | 6.1 outcome (all three rollout-summary rows corrected five → seven with the SDL pin cite) | Pure doc-truthing row; correct five→seven with the SDL pin cite |
| D-410 | Doc drift: `docs/planning/PRODUCTION_READINESS.md` §5 stale rows — §5.3.3 "no expiry surface" (the sweep shipped, `backend/services/billing/subscription-expiry.service.ts`), unchecked §5.1/§5.2/§5.4/§5.5 rows, missing PAY/HW/PR/E/PC rows | pre-seed (specs REQ-130.2) | 6.1 | ✅ Done | 6.1 outcome (§5.3.3 stale claim corrected; §5.1/§5.2/§5.4/§5.5 rows flipped with census test cites; §5.6–§5.10 PAY/HW/PR/E/PC rows added with census test cites) | Refresh with census test cites; ledger-defer missing rows with a pointer if checklist ownership resists |
| D-411 | Fixture gap: no `createTestTeacherVerification` helper (not among the verified 16 in `backend/db/test/entity-setup.ts:74-571`) | pre-seed (plan §3.3) | 3.2 | ✅ Done | 3.2 outcome | Resolved by single-consumer raw `tx.insert(teacherVerification)` + `information_schema` reads — the frozen battery stays frozen (knip); do NOT add a helper |
| D-412 | Fixture gap: no `createTestProgress` helper | pre-seed (plan §3.3) | 3.8 | ✅ Done | 3.8 outcome | Resolved by `ProgressRepository.insertRow({studentId, lessonId}, tx)` or raw `tx.insert(progress)`; do NOT add a helper |
| D-413 | Environmental: the two `audit_logs` immutability triggers are persistently DISABLED (`tgenabled='D'`) in the shared migrate-provisioned `kottaby_test` DB — the 3 pre-existing audit_logs-tier failures in `backend/db/test/logic/billing/financial-immutability.test.ts` are environmental, not plan-attributable | 3.5 discovery (baseline §3) | 3.5 | ✅ Done | 3.5 outcome | The shipped DDL installs both triggers (`backend/drizzle/20260904084152_custom_3-immutability-triggers/migration.sql:24-45`); a dev-DB probe verified them enabled, and the test DB carries them installed-and-wired but disabled — a stale leak from an interrupted trigger-suspension sweep (`withAuditDeleteTriggersSuspended` / `withImmutabilityTriggersSuspended([…, 'audit_logs'])`, `test/helpers/db-cleanup.ts:229`). The pre-existing audit_logs tests are left untouched (baseline-red rule); before/after counts 3 fail / 3 fail. Future ticket: crash-safe re-enable or a provisioning health-check that fails fast on disabled immutability triggers before the db suite runs; re-enabling mid-flight is unsafe while sibling suites hold suspension windows |
| D-414 | Environmental: DEV `.env` `ADMIN_EMAIL`/`ADMIN_PASSWORD` leak into every `bun run`-mediated test process (Bun auto-loads the cwd `.env`; `DEV_LEAKED_ENV_KEYS` at `test/scripts/runner-helpers.ts:66` strips only the two payment keys; `.env.test` defines neither admin key) — the shared test DB's seeded admin is `admin@kottaby.local` (seeded with the leaked email but the FALLBACK password `Seed_Pass1!`, `backend/db/seeds/users/seed-users.ts:19` + `backend/db/seeds/lib/seed-config.ts:29`), so the leaked DEV password mismatches and 4 wire suites' seeded-admin logins fail UNAUTHORIZED (`admin-governance.matrix`, `notification-integration.matrix`, `admin-broadcast.integration`, `parent-link.wire`) — pre-existing baseline reds, not plan-attributable | 5.1b discovery (wire-tier half) | 5.1 | ✅ Done | 5.1b outcome | Probes: `AuthService.login(admin@kottaby.local, <DEV password>)` → LOGIN_PASSWORD_MISMATCH; `AuthService.login(admin@kottaby.local, "Seed_Pass1!")` → SUCCESS (userId 211284); the sibling suites' intended fallback pair is `admin@draftacademy.local` + `Seed_Pass1!` (CI-true: no DEV `.env` ⇒ fallbacks fire ⇒ the CI seed matches). The pre-existing suites are left untouched (baseline-red rule); wire before/after counts 70 fail / 70 fail. Future ticket: add `ADMIN_EMAIL`/`ADMIN_PASSWORD` to `DEV_LEAKED_ENV_KEYS` AND define the pair in `.env.test` (or re-seed the test DB admin) so local runs resolve the same credential CI does; fixing only the strip list without the `.env.test` pair would break the suites differently (fallback email absent from the locally seeded DB) |
| D-415 | Harness hazard: `closePool()` in the `afterAll` of `backend/graphql/test/admin-session-governance.mutation.test.ts:344` (and `.query.test.ts:347`) ends the process-wide shared pg pool mid-`bun test` — every DB-touching file scheduled after them in the single shared wire-tier process fails `Cannot use a pool after calling end on the pool` (63 of the 70 wire-tier suite reds, incl. `lesson.roles.test.ts` 23/26, this plan's own `teacher-matching.integration.test.ts` 4/4, and ~24 more suites' hooks). Baseline's 46-fail Lessons Role-Matrix cluster is this same mechanism. The victim suites are individually green (isolation-proved: lesson.roles 26/26, teacher-matching 2/2 twice) — pre-existing harness behavior, not plan-attributable | 5.1b discovery (wire-tier half) | 5.1 | ✅ Done | 5.1b outcome | Two-file probe reproduces it exactly (`admin-session-governance.mutation` + `lesson.roles` in ONE process → `[WARN] [db] pool closed` → exactly the 23 lesson pool reds); the full-suite log shows the `[WARN] [db] pool closed` line immediately before the next file's first pool death. The sibling-owned suites are left untouched (baseline-red rule); wire before/after counts 70 fail / 70 fail. Future ticket: remove or condition the two `closePool()` calls (a standalone run exits cleanly without them — Bun tears the process down), or give those two suites a dedicated pool instance |
| D-416 | Pre-existing timing-sensitive test turned persistently red: the credential-fence race (`backend/db/test/logic/auth/auth.service.test.ts`, "credential fence (concurrent admin rotation)") now fails 3/3 in QUIET isolated windows at the final gate — the concurrent admin rotation's commit lands after the ~500ms bcrypt proof window closes, so the self-change resolves instead of denying. The test is committed at HEAD (pre-dates this plan; verified via `git show HEAD:` — not in the dirty diff), 3.6's revert-proof already established its failure is independent of this plan's INV-U3 extension, and 5.1a carried it as "green in quiet windows" — a condition that no longer holds against the current shared-DB state. The `auth.service.ts` product diff in the tree is comment/docblock-only (verified) | 7.1 discovery (3.6 + 5.1a carry-forwards) | 7.1 | ✅ Done | 7.1 outcome (3/3 isolated `run-test.ts` re-runs, zero concurrent test processes) | Future ticket per 3.6's ruling: de-flake the race (a deterministic fencing seam, or re-baseline the window); no cheap test-side fix exists that does not weaken its stage-indistinguishability contract |
| D-417 | Environmental: shared-DB committed-fixture accumulation driven by the D-415 pool-kill — every full wire-tier run leaks its victims' fixtures (their teardowns die with the pool), and the `users` student-role population has accumulated to ~110 rows (`matrix-`/`gateway-f`/`pmwire-`-prefixed `@test.local` leaks from sibling wire suites); this now breaks absolute-window assertions in pre-existing suites: `admin-user-lifecycle.journey.test.ts` step 2 (`listDirectory` page-1-of-100, `createdAt ASC`) fails deterministically whenever pre-existing students ≥ 100 — the workflows tier moved 614/5/15 → 613/5/16 on this one cell. Not plan-attributable: this plan's journeys leave zero residue (zero `jrn_` rows); this plan's own 3 leaked `matching-` rows (from interrupted earlier runs of the 4.7 wire suite, created 03:28/03:44/05:03 — before the gate's clean 2/2 isolation runs) were cleaned FK-safely at the gate (students child first, then users; verified 0 remain) | 7.1 discovery (workflows-tier movement) | 7.1 | ✅ Done | 7.1 outcome (live probe: 99→110 students across one wire-tier run; threshold math reproduced; post-cleanup isolation re-run confirms the red is independent of this plan's residue) | Future ticket: the D-415 remediation (remove/condition the two `closePool()` calls) stops the leak source; a shared-DB residue health-check/sweep would bound the accumulation; consider scoping the journey's directory assertion to a per-run prefix instead of an absolute page-1 window |

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
