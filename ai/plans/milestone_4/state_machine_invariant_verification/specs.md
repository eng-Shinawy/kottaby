# Requirements & Specification: State Machine Invariant Verification

> **Plan directory (verbatim — every header, ledger path, task 0.1, and self-reference in this document uses this exact string):** `ai/plans/milestone_4/state_machine_invariant_verification`
> **Ticket:** `State Machine Invariant Verification Tests` — Owner Stream Dev 2, Milestone 4, 5 SP, Blocked By: All Milestone 1–3 tickets (`docs/planning/TICKETS.md:2873-2910`; description `:2883`, Gherkin table `:2888-2900`, five test scenarios `:2903-2907`). The blocked-by milestone tickets are **verified shipped** — escrow schema, guarded purchase/activation, the evaluation loop, and the audit-trail census are all on disk (`backend/db/schema/classes/session.ts:68-69`, `backend/services/billing/subscription-activation.service.ts`, `backend/services/teachers/evaluation-booking.service.ts:56`, `test/workflows/admin/audit-completeness.catalog.ts`).
> **Grounding docs:** `docs/specs/state-machine-invariants.md` (358 lines, 67 invariants, 11 sections — the canonical census source) · the 12 line-verified research dossiers `ai/plans/milestone_4/state_machine_invariant_verification/outcome/research/01-session-lifecycle.md` … `12-sibling-plans-canonical-docs.md` (per-invariant enforcement maps, path:line test citations, COVERED/PARTIAL/GAP verdicts — this spec reuses their verified cites; nothing was invented at spec time) · `docs/billing/financial-safety-verification.md:30-41` (sibling verified-invariants registry) · `docs/testing/workflow-journey-tests.md` · `backend/db/test/AGENTS.md` · `test/workflows/AGENTS.md` · `docs/planning/PRODUCTION_READINESS.md` §5.

## Document Information
- **Feature Name**: State Machine Invariant Verification Tests
- **Target Directory**: `ai/plans/milestone_4/state_machine_invariant_verification`
- **Outcome Directory**: `ai/plans/milestone_4/state_machine_invariant_verification/outcome`
- **Version / Date**: 1.0 · 2026-10-08
- **Author**: Dev 2 stream (spec authored by the requirements-writer agent from the 12 ground-truth dossiers)
- **Stakeholders**: Dev 2 (owner), release gate (PRODUCTION_READINESS §5), compliance/audit consumers, maintainers of the ten state machines
- **Related Canonical Documents**: `docs/specs/state-machine-invariants.md` · `docs/billing/financial-safety-verification.md` · `docs/sessions/session-lifecycle.md` · `docs/teachers/teacher-availability.md` · `docs/teachers/evaluation-loop-booking.md` · `docs/billing/subscription-purchase.md` · `docs/billing/subscription-validity-window-expiry.md` · `docs/billing/admin-financial-auditing.md` · `docs/parents/monitoring-portal.md`

---

## Introduction

The platform's ten shipped state machines — session lifecycle, teacher verification, teacher availability, subscription & balance, wallet & transaction, student account, parent-child link, payment, homework & progress, evaluation — plus the doc's eleventh section (plan catalog) carry **67 documented invariants** in `docs/specs/state-machine-invariants.md:1-358`. Enforcement is deliberately heterogeneous: DB CHECK/UNIQUE/FK constraints, immutability triggers, guarded single-statement UPDATEs, service gates and transition matrices, and — for several invariants — app-layer discipline only (writer absence, static grep-locks, transactional composition). Milestones 1–3 and the two finished verification siblings produced abundant per-invariant tests, but spread across ~90 files with no registry, no per-invariant naming convention, and no completeness oracle: dossier 11 verified that `grep -ri invariant` across the test tree returns only prose and `find -iname "*invariant*"` returns nothing (§3.9). The ticket's acceptance criterion — "every invariant is tested and passes" — is today unverifiable as a claim.

What is missing is the **completeness proof**: (1) a machine-readable census binding all 67 INV-IDs to named, passing tests; (2) an anti-drift oracle so a new doc invariant without a census row + binding fails CI; (3) surgical closure of the residuals the 12 dossiers enumerated (4 GAP, 18 PARTIAL of 67); and (4) honest pinning of the invariants that have **no DB-level enforcement**, together with doc-truthing annotations for the research-proven drift between doc wording and shipped semantics. This is a TEST-WRITING plan: new verification tests, a census registry, and documentation truthing — no product features, no schema changes, no UI, no GraphQL changes.

### Feature Summary

Ship (1) the machine-readable **67-invariant census** (`backend/db/test/logic/invariants/invariant-census.catalog.ts`) binding every INV-ID to ≥1 named test with enforcement-tier and disposition records; (2) the **anti-drift static oracle** (`backend/db/test/logic/invariants/invariant-census-drift.test.ts`) asserting the doc↔census↔test-file bijection; (3) the dossier-recommended **residual probes** — new per-domain DB-tier suites under `backend/db/test/logic/invariants/`, service-tier denial extensions in existing co-located files, journey extensions to existing journey files, and one new journey (plan-catalog invariance); (4) **doc truthing** — annotations on `docs/specs/state-machine-invariants.md`, a PRODUCTION_READINESS §5 refresh where stale, and a canonical `docs/testing/invariant-verification.md`; (5) a pre-seeded **deferred-items ledger** for the schema-hardening items a test ticket must not build.

### Business Value

- Converts the ticket's "every invariant is tested" from belief into a computable, CI-enforced claim — and hands PRODUCTION_READINESS §5 the same evidence.
- Catches invariant drift permanently: a doc invariant without a census row + binding fails CI; a census row citing a phantom or renamed test fails CI.
- Closes the four true gaps (INV-TV7 no producer, INV-U1 history preservation, INV-PAY1 CHECK probe, INV-E6 retention) and 18 partials with surgical, dossier-specified probes — no speculative test sprawl.
- Records doc-vs-code drift honestly (shipped `> 0` CHECKs, the 9-value gateway enum, `applicants.cooldown_until`, governance-on-`users`, the stricter booking denial) so future agents stop rediscovering it.

### Scope

**In scope:** census module + anti-drift test; per-domain invariants suites and dossier-named residual probes/extensions; one new journey (PC2) + four journey extensions; INV-named census bindings; doc annotations on the invariants spec; PRODUCTION_READINESS §5 refresh where stale; `docs/testing/invariant-verification.md`; deferred-items ledger pre-seed (D-401..D-408).

**Out of scope (explicit non-goals):**
1. **No schema changes** — no CHECK constraints, triggers, migrations, columns, or enum values (INV-W7 session-link CHECK, INV-E2/E6 delete guard, INV-U4/INV-PC3 DELETE triggers, the INV-TV7 producer → deferred-items ledger; resolved within this plan by pinning + doc annotation).
2. **No product code** — no services, repos, resolvers, writers, or producers added or modified.
3. **No UI** — no `frontend/` or `app/` files; verification is test-layer infrastructure.
4. **No GraphQL schema changes** — the only wire-tier addition is a test file exercising the existing student browse.
5. **No re-authoring sibling suites** — `financial-safety-verification` and `workflow_tests_parent_journey_and_subscription_lifecycle` own their legs; this plan cites them and adds only residuals.
6. **No live-gateway E2E** — `bun run test:ui:e2e:paymob` (live creds + `build:test` + ngrok tunnel) is excluded; every INV-PAY invariant is verifiable via the mock channel (dossier 08 §6.3).
7. **No "fixing" shipped semantics to match doc wording** — tests pin shipped behavior; the doc gets annotations (REQ-130).

---

> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).**
> - **67 vs 60 — the census ruling.** The ticket Gherkin names only **60 IDs across 10 machines** — it caps at INV-B6 (`docs/planning/TICKETS.md:2893`) and INV-PAY5 (`:2897`) and omits §11 Plan Catalog — while the ticket's own description (`:2883`) says "all state machine invariants from `docs/specs/state-machine-invariants.md`", and that doc defines **67** (adds INV-B7 `:158`, INV-B8 `:159`, INV-PAY6 `:307`, INV-PAY7 `:308`, INV-PC1..PC3 `:356-358`). **Ruling (REQ-010 + the Phase-0 census): the doc is canonical — the plan verifies ALL 67**, with the ticket's 10 machines / 60 IDs as the acceptance-criteria core and the 7 doc-extras as a cheap explicit extension (research: B7/B8/PAY6/PAY7 already heavily covered; PC1 covered, PC2/PC3 partial — one genuinely missing test, the PC2 journey).
> - **INV-A3 adjudication — a stale claim dies here.** A student-facing directory **EXISTS**: `browseAvailableTeachers` (`backend/graphql/query/teachers/teacher-matching.query.ts:81`, student-only scopes `:123-128`) over the compose-rule chain (`backend/db/repo/teachers/teacher.repository.matching.helpers.ts:129-142`), journey-tested and named for INV-A3 (`test/workflows/teachers/on-demand-matching.journey.test.ts:806`). The milestone_2-era "no student-facing directory exists" ruling (`ai/plans/milestone_2/in_session_locking_hide_from_directory/specs.md:9`) and dossier 12's contrary note are **stale; dossier 03 is authoritative**. INV-A3's verification surface is the matching browse (repo + journey + NEW wire tier) — never "data-level truthfulness only".
> - **Test-only discipline.** Several invariants have **no DB-level enforcement**: INV-TV7 (no runtime producer), INV-W7 (no CHECK tying earning → session_id), INV-E2/E6 (no delete guard on evaluations), INV-U4 (no DB DELETE trigger — enforcement is the app-layer grep-lock `backend/graphql/test/inv-u4-grep-lock.test.ts:211`), INV-PC3 (no plan DELETE trigger), INV-B5 (no `balance_reviews` decrementer exists). The plan **pins shipped/app-layer semantics with tests + records doc-vs-code drift**; it shall NEVER add schema, triggers, or writers. Genuine schema-hardening items go to the deferred-items ledger as future-ticket pointers (D-401..D-408), resolved within this plan by pinning + documentation.
> - **Sibling boundaries — verify-by-reference, never re-author.** `financial-safety-verification` owns the wallet CHECK probes, the financial-immutability trigger tier, the dual-confirm journey, and the concurrency races (verified-invariants table `docs/billing/financial-safety-verification.md:30-41`); `workflow_tests_parent_journey_and_subscription_lifecycle` owns the INV-P legs and the subscription chained journeys. This plan adds only the residual per-invariant ratification layer named in the census + the census-driven completeness oracle.
> - **Placement (dossier 11 verdict).** New DB-tier suites live at `backend/db/test/logic/invariants/<machine>-invariants.test.ts` (11 files, incl. plan-catalog) alongside the census module + drift test; service-tier denials extend existing co-located service test files; journey extensions extend existing journey files. Existing runners auto-discover by glob — zero `package.json` edits (dossier 11 §3.6).
> - **Shipped semantics over literal doc wording** (tests pin shipped behavior; REQ-130 annotates the doc; semantics are never silently rewritten): INV-W8 CHECK is `amount > 0` (`backend/db/schema/billing/teacher-transaction.ts:50`) not `>= 0`; INV-PAY1 CHECK is `> 0` (`backend/db/schema/billing/student-payments.ts:74`); INV-PAY4's `payment_gateway` pgEnum carries **9** values (`backend/db/schema/enums.ts:67-77`) not 5; cooldowns live on `applicants.cooldown_until` (`backend/db/schema/teachers/applicants.ts:23`), never `students.suspended_period_days`; student governance columns live on `users` (`backend/db/schema/users/users.ts:37-43`); INV-U2's booking guard denies on the raw `suspended` boolean — stricter than the login window; the teacher-availability writer lines are `:460/:558/:685` (doc's `:527/:625/:752` stale); the parent portal is **seven** SDL query fields (`backend/graphql/test/schema-surface.test.ts:709-717`), not five.

---

## ⚠️ Phase-0 Ground-Truth Verification — The 67-Invariant Census (ruled against the live tree 2026-10-08)

Every row below is dossier-verified (`outcome/research/01..12`); every path:line was read on the live tree during research — no cite was invented at spec time. **Tier** = where enforcement lives (DB CHECK · TRIGGER · SCHEMA FK/UNIQUE/NOT NULL · REPO guarded-UPDATE · SVC gate/matrix · JRN journey · SDL schema-surface · STATIC grep-lock/source-pin). **Disposition** = what THIS plan does: **VERIFY-BY-REFERENCE** (existing named test proves it; the census binds it) · **EXTEND** (existing coverage/file gains named assertions) · **NEW-PROBE** (new test file/journey authored) · **PIN-APP-LAYER+DOC-DRIFT** (no DB-level enforcement exists or shipped semantics differ from the doc; tests pin the app-layer behavior and REQ-130 annotates the drift). `†` = doc-truthing annotation required. New DB-tier probes default to the per-domain invariants file; a probe whose dossier-named helper battery lives in an existing file may extend that file instead — the census binding records the final home, and no assertion may exist in two files (`backend/db/test/logic/AGENTS.md:47`).

| ID | Invariant (abridged) | Tier | Verdict | Strongest existing test (dossier-verified) | Disposition (this plan) |
|---|---|---|---|---|---|
| INV-S1 | `completed` is terminal — no backward move | SVC matrix · REPO · JRN | COVERED | `backend/services/classes/session-lifecycle.enforcement.test.ts:193` (5×5 sweep) | VERIFY-BY-REFERENCE |
| INV-S2 | `cancelled` is terminal — no exit | SVC · REPO · JRN | COVERED | `test/workflows/sessions/session-state-machine.journey.test.ts:434` | EXTEND — add `cancelled→complete` + `cancelled→dispute` service-level cells to the journey sweep (`:395-460`) |
| INV-S3 | earning row only on dual confirmation | SVC · REPO | COVERED | `backend/services/classes/session-lifecycle.service.test.ts:2505` (+ import-allowlist source pin `:1517`) | VERIFY-BY-REFERENCE |
| INV-S4 | session has NOT NULL teacher + student | SCHEMA | COVERED | `backend/db/test/repo/classes/session.repository.test.ts:2311` (raw 23502 probe) | VERIFY-BY-REFERENCE |
| INV-S5 | certified teacher at creation (strict `true`) | SVC · REPO | COVERED | `backend/services/classes/session-lifecycle.service.test.ts:854` (null-certification boundary) | VERIFY-BY-REFERENCE |
| INV-S6 | `started` ⇒ `is_online=false` (marker lock) | SVC · REPO · JRN | COVERED | `backend/services/classes/session-lifecycle.service.test.ts:3463` (12-test block) | VERIFY-BY-REFERENCE |
| INV-S7 | report only for `completed` session | SVC | COVERED | `backend/services/classes/session-report.service.test.ts:532` (production FOR UPDATE gate) | VERIFY-BY-REFERENCE |
| INV-S8 | homework only when report submitted | SVC · SCHEMA | PARTIAL | `backend/services/classes/session-lifecycle.enforcement.test.ts:243` | EXTEND — static `notNull` pins, single-call-site source pin (`session-report.service.ts:227`), data-level homework⇒report LEFT-JOIN-zero probe |
| INV-TV1 | certification only via 5-pass or admin cold-start (3-arm writer closure) | SVC · REPO · JRN | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:490` | VERIFY-BY-REFERENCE |
| INV-TV2 | 5 distinct evaluators per cycle | SVC · REPO · JRN | COVERED | `backend/services/teachers/evaluation-booking.service.test.ts:650` (+ 23505 arbiter `backend/db/test/repo/teachers/evaluation.repository.test.ts:460`) | VERIFY-BY-REFERENCE |
| INV-TV3 | cooldown fully expired before re-purchase (strict `>`) | SVC | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:433` | VERIFY-BY-REFERENCE |
| INV-TV4 | 30/90-day cooldowns, minimums (admin extend/clear only) | SVC · REPO · JRN | COVERED | `backend/services/teachers/evaluation-rubric.service.test.ts:535` | EXTEND — constants tripwire `TAJWEED_COOLDOWN_DAYS===30` / `HIFZ_COOLDOWN_DAYS===90` (`shared/constants/evaluation-rubric.constants.ts:21,:24`) † |
| INV-TV5 | admin override in all 3 directions, admin-only | SVC · JRN | COVERED | `backend/services/teachers/applicant-lifecycle.service.test.ts:1524` | VERIFY-BY-REFERENCE |
| INV-TV6 | failed→converted student keeps privileges during cooldown | SVC · JRN | COVERED | `test/workflows/teachers/applicant-student-conversion.journey.test.ts:1063` | VERIFY-BY-REFERENCE |
| INV-TV7 | `teacher_verification` stores tajweed/hifz levels | SCHEMA only — NO producer | GAP | none (cleanup-harness docstring `test/helpers/db-cleanup.ts:19`) | NEW-PROBE — schema-contract suite (`backend/db/test/repo/teachers/teacher-verification.repository.test.ts`, dossier 02): information_schema columns + FK + index + rollback round-trip; rubric-write assertion FORBIDDEN † |
| INV-A1 | only certified teachers can go Available | SVC · REPO · JRN · wire | COVERED | `backend/services/teachers/teacher-availability.service.test.ts:1374` (BFLA, zero writes) | EXTEND — `FOR UPDATE` toggle-vs-demote serialization probe (both orderings consistent; no uncertified-online bypass) |
| INV-A2 | `started` session ⇒ `is_online=false` | SVC · REPO · JRN · wire | COVERED | `backend/services/teachers/teacher-availability.service.test.ts:1411` | EXTEND — one battery firing ALL three `is_online` writers against a started session: each leaves `isOnline=false` |
| INV-A3 | in-session teacher hidden from student browse | REPO compose-rule · JRN | COVERED | `test/workflows/teachers/on-demand-matching.journey.test.ts:806` | NEW-PROBE — wire tier `backend/graphql/test/teacher-matching.integration.test.ts` (student 200 sees no in-session teacher; anon/teacher denied per scopes `teacher-matching.query.ts:123-128`) † |
| INV-A4 | restore per pre-lock intent (marker), never-resurrect | REPO marker · JRN | COVERED | `backend/db/test/repo/teachers/teacher.repository.test.ts:897` | EXTEND — INV-A4-named journey pin: marker-restore then sweep re-offlines (`teacher-inactivity-auto-offline.journey.test.ts:506` pattern) † |
| INV-B1 | 4 non-negative balance lanes (named CHECKs) | DB CHECK | COVERED | `backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts:191` (trial) + `student-lane-debit.test.ts:379` (paid lanes) | VERIFY-BY-REFERENCE |
| INV-B2 | full plan sessionCount credited on activation | SVC · REPO | COVERED | `backend/services/billing/subscription-activation.service.test.ts:927` | VERIFY-BY-REFERENCE |
| INV-B3 | expiry zeroing (conditional lanes; trial exempt) | SVC · REPO · JRN · cron | COVERED | `backend/services/billing/subscription-expiry.service.test.ts:223` (6 tests) | EXTEND — one cancel→later-sweep interplay case (cancelled is NON-covering; a later covering sweep may zero a cancel-preserved lane — doc `:186-187`) |
| INV-B4 | zero relevant balance ⇒ booking denied (trial OR lane) | SVC · JRN | COVERED | `backend/services/classes/session-lifecycle.booking.test.ts:603` | VERIFY-BY-REFERENCE |
| INV-B5 | lane segregation; trial never co-mingles | REPO frozen map | PARTIAL | `backend/db/repo/students/__tests__/student-lane-debit.test.ts:346` (map pin) | PIN-APP-LAYER+DOC-DRIFT — the doc's "reviews decrement `balance_reviews`" clause has NO surface (no `HeldBalanceLane.Reviews` member, `backend/enum/scheduling/held-balance-lane.enum.ts:17-21`; zero decrement writers); pin the implemented half + optional `@ts-expect-error` type pin; never a runtime reviews-booking test (D-406) † |
| INV-B6 | admin extends `end_date` (guarded) | SVC · JRN | COVERED | `backend/services/billing/subscription-admin.service.test.ts:501` | VERIFY-BY-REFERENCE |
| INV-B7 | trial granted at most once (`trial_granted_at IS NULL` arbiter) | REPO · SVC | COVERED | `backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts:98` | VERIFY-BY-REFERENCE |
| INV-B8 | trial decremented BEFORE paid lanes | SVC · JRN | COVERED | `test/workflows/classes/session-report-homework.journey.test.ts:583` | EXTEND — one runInRollback ordering cell seeding `{balanceTrial:1, balanceHifz:3}` ⇒ `heldBalanceLane === Trial`, hifz untouched |
| INV-PC1 | deactivated plan invisible + unpurchasable | REPO · SVC · SDL | COVERED | `backend/db/test/logic/billing/plan-catalog.repository.test.ts:175` | VERIFY-BY-REFERENCE |
| INV-PC2 | deactivation/edits never touch subscriptions or balances | SVC zero-coupling | PARTIAL | `backend/db/test/logic/billing/plan-catalog.service.test.ts:154` (mutation semantics only) | NEW-PROBE — `test/workflows/billing/plan-catalog-invariance.journey.test.ts`: activate → deactivate + edit → subscription/lane byte-identical → booking still succeeds |
| INV-PC3 | no plan hard-delete; deactivation stamps `deactivated_at` | SDL · writer-absence (NO DB guard) | PARTIAL | `backend/graphql/test/plan-catalog.schema.test.ts:58` (SDL absence) | PIN-APP-LAYER+DOC-DRIFT — no `prevent_plans_delete` trigger exists; pin writer-absence + referenced-plan 23503 probe; unreferenced raw DELETE documented as accepted boundary (D-405) † |
| INV-W1 | `wallet.balance >= 0` | DB CHECK · REPO | COVERED | `backend/db/test/repo/billing/wallet.repository.test.ts:476` (sibling-owned) | VERIFY-BY-REFERENCE |
| INV-W2 | `wallet.total_earning >= 0` | DB CHECK | COVERED | `backend/db/test/repo/billing/wallet.repository.test.ts:494` | VERIFY-BY-REFERENCE |
| INV-W3 | exactly one wallet per teacher | DB UNIQUE · REPO | PARTIAL | `backend/db/test/repo/billing/wallet.repository.test.ts:226` (idempotent ensure; unique never tripped) | EXTEND — raw second INSERT bypassing ON CONFLICT ⇒ 23505 `wallet_teacher_id_unique` via `constraintNameOf` |
| INV-W4 | earning row only on dual confirmation | SVC · JRN | COVERED | `backend/services/classes/session-lifecycle.service.test.ts:2505` | EXTEND — arbitration-Complete arm gains the missing wallet oracle (`WalletRepository.findByTeacherId` null + `confirmedByStudentAt` null) at `:1900` |
| INV-W5 | withdrawal pending→completed/failed only (guarded + amended trigger) | REPO · SVC · TRIGGER · JRN | PARTIAL (trigger residuals) | `backend/db/test/repo/billing/wallet.repository.admin.test.ts:445` (predicate matrix) | EXTEND — 4 residual trigger cells: `pending→pending` no-op, decided-row re-open, description freeze, session_id NULL-swap (live guard `backend/drizzle/20260914064155_custom_5-teacher-transaction-settlement/migration.sql:54-76`) |
| INV-W6 | financial records immutable (append-only) | TRIGGER · REPO · JRN | COVERED | `backend/db/test/logic/billing/financial-immutability.test.ts:364` (sibling-owned) | VERIFY-BY-REFERENCE |
| INV-W7 | earning session-linked; withdrawal/bonus may be NULL | REPO signature (NO DB CHECK) | PARTIAL | `backend/db/test/repo/billing/wallet.repository.test.ts:246` (positive link only) | PIN-APP-LAYER+DOC-DRIFT — no CHECK ties earning→session_id (`backend/db/schema/billing/teacher-transaction.ts:38` plain nullable FK); pin the `ledger.sessionId` contract at `backend/db/repo/billing/wallet.repository.ts:81`; schema CHECK → ledger D-402 † |
| INV-W8 | `teacher_transaction.amount` non-negative | DB CHECK (`> 0` shipped) | COVERED | `backend/db/test/repo/billing/wallet.repository.test.ts:504` + zero-reject `:722-758` | VERIFY-BY-REFERENCE † (doc `:220` says `>= 0`; shipped CHECK is `> 0` — annotate) |
| INV-U1 | soft-delete preserves sessions/reports/payments | REPO guarded-UPDATE · FK | GAP | none (adjacent: `test/workflows/admin/admin-user-lifecycle.journey.test.ts:311` never re-reads child rows) | NEW-PROBE — `backend/db/test/logic/students/student_status_history.test.ts` (name pre-documented `backend/db/test/logic/AGENTS.md:23`): byte-identical child history across the full governance ladder |
| INV-U2 | suspended student cannot book | SVC | COVERED | `backend/services/classes/session-lifecycle.service.test.ts:752` | EXTEND — lapsed-suspension cell: booking STILL denies on the raw boolean (`backend/services/classes/session-lifecycle.governance.ts:53`) — pin the deliberate stricter-than-login behavior † |
| INV-U3 | blocked student cannot access the platform | SVC (login/refresh/SSR) | PARTIAL | `backend/services/admin/user-governance.service.test.ts:1332` (login arm; SSR `backend/lib/auth/server-auth.test.ts:190-191`) | EXTEND — `refreshToken` governance arms on committed fixtures (`backend/services/auth/auth.service.ts:270` gate; mirror D11 pattern `user-governance.service.test.ts:1205-1319`) |
| INV-U4 | no user/student/teacher hard-delete | STATIC grep-lock · FK | COVERED | `backend/graphql/test/inv-u4-grep-lock.test.ts:211` | PIN-APP-LAYER+DOC-DRIFT — no DB trigger exists; keep the grep-lock as THE enforcement + FK-RESTRICT 23503 backstop probe + un-referenced DELETE-succeeds pin; never expect a `prevent_users_delete` trigger (D-404) † |
| INV-U5 | balances preserved across governance transitions | REPO (SET clauses exclude lanes) | PARTIAL | `backend/services/admin/user-management.service.test.ts:2151` (sibling rows only) | NEW-PROBE — `backend/db/test/logic/students/student_status_transition.test.ts` (pre-documented name): TARGET's own four lanes + `trialGrantedAt` byte-identical across the ladder |
| INV-P1 | monitoring only after student confirmation | REPO · SVC · JRN · chaos | COVERED | `backend/services/parents/parent-link.static-locks.test.ts:533` (single-writer corpus) | VERIFY-BY-REFERENCE |
| INV-P2 | parent access strictly read-only | SDL · SVC · JRN | COVERED | `backend/graphql/test/schema-surface.test.ts:1417` | VERIFY-BY-REFERENCE |
| INV-P3 | parent notified when child session completes | SVC · JRN | COVERED | `backend/services/classes/session-report-notification.test.ts:248` | EXTEND — thin absence pin: linked child, session completed, NO report ⇒ zero parent rows/publishes (producer is report submission, `backend/services/classes/session-report.service.ts:306`) |
| INV-P4 | `parent_id` FK + handshake code data model | SCHEMA · REPO | COVERED | `backend/db/test/logic/students/handshake-code-generation-locks.test.ts:219` | VERIFY-BY-REFERENCE † (portal is SEVEN SDL fields — annotate the stale "five" rows in `docs/parents/monitoring-portal.md:248/:250/:268`) |
| INV-PAY1 | `student_payments.amount` non-negative | DB CHECK (`> 0` shipped) | GAP | none — no test trips `student_payments_amount_check` | EXTEND — savepoint probe: `-1.00` AND `"0.00"` inserts ⇒ 23514 + `constraintNameOf` (zero MUST reject: shipped `> 0`, `backend/db/schema/billing/student-payments.ts:74`) † |
| INV-PAY2 | payment rows immutable (guarded pending→paid/failed exception) | TRIGGER | COVERED | `backend/db/test/logic/billing/student-payment.repository.test.ts:169` (+ `:227/:259/:295`, provider refs `:420-574`) | VERIFY-BY-REFERENCE |
| INV-PAY3 | activation + credit only on `paid` | SVC | COVERED | `backend/services/billing/subscription-activation.service.test.ts:533` (failed ⇒ stays pending, zero credit) | VERIFY-BY-REFERENCE |
| INV-PAY4 | gateway recorded (NOT NULL pgEnum) | SCHEMA pgEnum | PARTIAL | `backend/db/test/logic/billing/student-payment.repository.test.ts:142` (verbatim echo) | EXTEND — bogus enum ⇒ 22P02; NULL gateway ⇒ 23502; `enum_range` pin = the 9 shipped values (`backend/db/schema/enums.ts:67-77`) † |
| INV-PAY5 | offline onboarding bypasses ledger (audit cols) | SVC | COVERED | `backend/services/admin/student-onboarding.service.test.ts:703` (zero-ledger oracle) | VERIFY-BY-REFERENCE |
| INV-PAY6 | exactly-one pending→paid activation | REPO · SVC · JRN · route | COVERED | `backend/db/test/logic/billing/student-payment.repository.test.ts:190` (replay null; late-confirmed `subscription-activation.service.test.ts:612`) | VERIFY-BY-REFERENCE |
| INV-PAY7 | mismatched callback quarantined (zero mutation, 200 ack) | SVC · route · JRN | COVERED | `backend/services/billing/subscription-activation.service.test.ts:894` (+ route ack `app/api/payments/webhook/test/payments-webhook-route.test.ts:1027`) | VERIFY-BY-REFERENCE |
| INV-HW1 | homework linked to exactly one session (NOT NULL + UNIQUE + FK) | SCHEMA | PARTIAL | `backend/db/test/repo/classes/home-work.repository.test.ts:436` (unique 23505) | EXTEND — 23502 NULL-session, 23503 orphan-FK, cascade probes + static `notNull` pin (`backend/db/schema/classes/report-homework-schema.static-assertions.test.ts`) |
| INV-HW2 | grades 0-100 (both CHECKs) | DB CHECK · SVC guard | PARTIAL | `backend/db/test/repo/classes/home-work.repository.test.ts:336` (bounds accepted, CHECK never tripped) | EXTEND — trip the CHECKs via `gradeHomeWorkOnce` (bypasses service validation) with 101/-1 ⇒ 23514 `home_work_current_grade_check` / `home_work_revision_grade_check` |
| INV-HW3 | first session: homework assigned, not graded | SVC composition | COVERED | `backend/services/classes/session-report.service.test.ts:710` (+ `:751`, `:778`) | VERIFY-BY-REFERENCE |
| INV-HW4 | subsequent sessions grade-previous + assign-new | SVC · REPO · JRN | COVERED | `backend/services/classes/session-report.service.test.ts:952` (+ write-once `:805`) | EXTEND — routing pin: two ungraded rows ⇒ grades land on the NEWEST prior row only (`backend/db/repo/classes/home-work.repository.ts:142-171` has no grade predicate) |
| INV-PR1 | progress links student↔lesson (FKs; `lesson_id` nullable) | SCHEMA | PARTIAL | `backend/db/test/repo/classes/progress.repository.test.ts:408` (pointer semantics) | EXTEND — `student_id` NULL ⇒ 23502; orphan student/lesson ⇒ 23503 (both FK names); legal `lesson_id=NULL` row pinned (set-null artifact) |
| INV-PR2 | progress advances on Tajweed dual-confirm only | SVC · JRN | COVERED | `backend/db/test/logic/classes/student-progress.service.test.ts:222` (+ `test/workflows/classes/tajweed-progress-increment.test.ts:559`) | VERIFY-BY-REFERENCE |
| INV-PR3 | lessons belong to plans | SVC gate (`plan_id` nullable by design) | PARTIAL (N/A-as-written at DB tier) | `backend/db/test/logic/classes/lesson.service.test.ts:253` | EXTEND — wire-shaped `planId: null` ⇒ `LESSON_PLAN_NOT_FOUND` (the only plan-membership write surface, `backend/services/classes/lesson.service.ts:172-173`) † |
| INV-E1 | `evaluations.score` 0-100 | DB CHECK · SVC guard | PARTIAL | `backend/db/test/repo/teachers/evaluation.repository.test.ts:420` (bounds accepted, CHECK never tripped) | EXTEND — savepoint trip 101/-1 ⇒ raw 23514 `evaluations_score_check` (concrete integers — column is nullable) + NEW static pin `backend/db/schema/teachers/evaluations-schema.static-assertions.test.ts` |
| INV-E2 | soft-delete only; never hard-deleted | REPO read-exclusion (NO delete guard) | PARTIAL | `backend/db/test/repo/teachers/evaluation.repository.test.ts:388` (exclusion semantics) | PIN-APP-LAYER+DOC-DRIFT — no `prevent_evaluations_delete` trigger exists; pin the no-delete-surface via source pins; a raw DELETE-rejection test is FORBIDDEN (would fail — teardowns delete successfully, `evaluation.repository.test.ts:290-292`; D-403) † |
| INV-E3 | evaluated user + optional session link (FKs) | SCHEMA | PARTIAL | `backend/db/test/repo/teachers/evaluation.repository.test.ts:531` (evaluated FK 23503) | EXTEND — evaluator-FK 23503 probe (`evaluations_evaluator_id_users_id_fkey`) + committed-fixture set-null survival (session hard-deleted ⇒ evaluation survives, `session_id` NULL) |
| INV-E4 | student ratings update `teacher.average_rating` (0-5) | SVC · REPO · JRN · wire | COVERED | `backend/db/test/repo/teachers/teacher.repository.test.ts:2447` (CHECK-trip) | VERIFY-BY-REFERENCE |
| INV-E5 | student metrics aggregated from reports/grades | SVC (academic tracking) | PARTIAL | `backend/db/test/repo/admin/academic-tracking.repository.test.ts:348` (piecewise) | EXTEND — one labeled INV-E5 composite: grades + report history + `progressRowCount` + attention flag for one known student |
| INV-E6 | evaluation records permanently retained | set-null design + U4 transitivity (NO guard) | GAP | none | PIN-APP-LAYER+DOC-DRIFT — testable core = the E3 set-null survival pin; full retention guard = new migration → ledger D-403 † |

**Census tally — verdict:** 45 COVERED · 18 PARTIAL (incl. PR3, N/A-as-written at DB tier) · 4 GAP (TV7, U1, PAY1, E6). **Disposition:** 32 VERIFY-BY-REFERENCE · 24 EXTEND · 5 NEW-PROBE (TV7, A3, PC2, U1, U5) · 6 PIN-APP-LAYER+DOC-DRIFT (B5, W7, U4, E2, E6, PC3). **16 rows carry `†`** (REQ-130 doc-truthing).

---

## Requirements
### REQ-000: Pre-Implementation Baseline & Execution Protocol

**User Story:** As the executing agent, I need a recorded quality baseline and a persistent outcome/deferred ledger, so new issues are distinguishable from pre-existing ones and no research is re-done.

#### Acceptance Criteria
1. WHEN implementation begins THEN baselines SHALL be recorded into `ai/plans/milestone_4/state_machine_invariant_verification/outcome/phase0-baseline.md`: `bun tsgo`, `bun biome:check`, `bun run scripts/lint-service.ts --json --id baseline`, plus the current pass/fail state of the suites this plan touches.
2. WHEN implementation begins THEN `ai/plans/milestone_4/state_machine_invariant_verification/deferred-items.md` SHALL exist, pre-seeded with: D-401 INV-TV7 producer (rubric writes `tajweed_level`/`hifz_level`); D-402 INV-W7 DB CHECK `type <> 'earning' OR session_id IS NOT NULL`; D-403 INV-E2/E6 `prevent_evaluations_delete` trigger; D-404 INV-U4 users DELETE trigger; D-405 INV-PC3 plans DELETE trigger; D-406 INV-B5 reviews-lane decrementer surface; D-407 duplicate-earning-per-session unique index (sibling financial-safety deferred item); D-408 session-status DB-trigger hardening option (dossier 01 §6.9).
3. WHEN an agent starts any task THEN it SHALL read ALL files under `ai/plans/milestone_4/state_machine_invariant_verification/outcome/` first (the 12 research dossiers are the ground truth).
4. WHEN a task completes THEN the agent SHALL write `outcome/<task-id>-outcome.md` and flip its `tasks.md` checkbox `[ ]` → `[x]`.
5. WHEN any file is modified THEN `bun run scripts/health/sub-loop.ts <file> --lifecycle duplicates` SHALL exit 0 before the next file is touched.
6. WHEN any subtask is marked complete THEN the semantic-review checklist SHALL have run (no REQ/task references in code comments; no dead code; no cross-layer imports; layer transaction contracts respected; no forbidden patterns).

- **Priority** High · **Complexity** Low · **Dependencies** none · **Assumptions** quality tooling is green or baselined on the working branch.

### REQ-010: Invariant Census Registry & Anti-Drift Oracle

**User Story:** As the release gate, I want a machine-readable census binding all 67 invariants to named passing tests plus a CI bijection oracle, so "every invariant is tested" is computable and can never silently regress.

#### Acceptance Criteria
1. WHEN `backend/db/test/logic/invariants/invariant-census.catalog.ts` is authored THEN `INVARIANT_CENSUS` SHALL carry exactly 67 rows — one per doc ID — each `{ id, machine, docLine, statement, enforcementTier, verdict, disposition, docDrift?, bindings: { testPath, testName }[] }` with ≥1 binding per row, grouped under 12 machine keys (S, TV, A, B, W, U, P, PAY, HW, PR, E, PC) mirroring the Phase-0 table above.
2. WHEN `backend/db/test/logic/invariants/invariant-census-drift.test.ts` runs THEN it SHALL parse `docs/specs/state-machine-invariants.md`, extract every `INV-` token (corpus sanity ≥60 found — a broken scanner can never fake green), and assert bijection: a doc ID missing from the census, or a census ID missing from the doc, SHALL fail (audit-trail pattern: `backend/db/test/logic/audit/audit-census-drift.test.ts` + `test/workflows/admin/audit-completeness.catalog.ts:143`).
3. WHEN bindings resolve THEN every `testPath` SHALL exist and every `testName` SHALL be greppable in that file — a census row citing a phantom or renamed test fails CI.
4. WHEN an invariant is added to the doc THEN CI SHALL stay red until a census row with ≥1 passing named binding exists — the doc cannot outgrow the census.
5. WHEN the census is consumed THEN it SHALL be the single audit surface for the ticket's criterion; per-domain invariants suites cite it in their headers instead of re-listing tests.

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-000 · **Assumptions** the invariants doc remains the canonical INV-ID source for the life of the plan.

### REQ-020: Session Lifecycle Invariants (INV-S1..INV-S8)

**User Story:** As a platform engineer, I want every session-lifecycle invariant bound to a named test with the residual sweep and homework-composition cells closed, so the session machine's terminality and gating claims are proven.

#### Acceptance Criteria
1. WHEN the S1..S8 census bindings resolve THEN they SHALL cite: S1 5×5 matrix (`backend/services/classes/session-lifecycle.enforcement.test.ts:193`), S2 double-cancel refund-once (`backend/services/classes/session-lifecycle.service.test.ts:1465`), S3 exactly-one-earning + import-allowlist (`backend/services/classes/session-lifecycle.service.test.ts:2505`, `:1517`), S4 raw 23502 (`backend/db/test/repo/classes/session.repository.test.ts:2311`), S5 null-certification boundary (`session-lifecycle.service.test.ts:854`), S6 lock suite (`:3463`), S7 production gate (`backend/services/classes/session-report.service.test.ts:532`) — all passing, none re-authored.
2. WHEN a cancelled session is driven toward complete or dispute through the real service (S2 residuals) THEN both cells SHALL deny `SESSION_INVALID_TRANSITION` with the row byte-identical — added to the `test/workflows/sessions/session-state-machine.journey.test.ts` sweep block (`:395-460`) using the existing `expectServiceDenial` + `readFullSessionRow` helpers (`:106-120`).
3. WHEN the S8 residuals run THEN the source pin SHALL prove `HomeWorkRepository.insertHomeWork` has exactly ONE production call site (`backend/services/classes/session-report.service.ts:227`), the static pin SHALL assert `homeWork.sessionId.notNull === true` and `reports.sessionId.notNull === true` (mirroring the helpers at `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts:32-49`), and the data-level probe SHALL assert zero `home_work` rows without a matching `reports` row (LEFT JOIN count = 0 inside `runInRollback`).
4. IF the two documented off-matrix amendments execute (`sweepExpiredCompletedOnce` completed→cancelled, `backend/db/repo/classes/session.repository.ts:613-627`; `openPostConfirmationDisputeOnce` completed→disputed, `:353`) THEN tests SHALL treat them as whitelisted amendments — never defects.
5. WHILE composing S-domain tests THEN they SHALL NOT touch the arbitration wallet-reversal legs or the availability-toggle seam (sibling-owned surfaces — dossier 01 §6.8).

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** existing session suites stay green unchanged.

### REQ-030: Teacher Verification Invariants (INV-TV1..INV-TV7)

**User Story:** As a platform engineer, I want the certification state machine's invariants bound to named tests and its one true gap (TV7) probed honestly at the schema tier, so certification claims are proven and the unimplemented half is on record.

#### Acceptance Criteria
1. WHEN the TV1..TV6 census bindings resolve THEN they SHALL cite: quorum/pass/fail (`backend/services/teachers/evaluation-rubric.service.test.ts:443/:490/:535`), distinctness + ceiling (`backend/services/teachers/evaluation-booking.service.test.ts:650/:671/:588`), cooldown boundary (`backend/services/teachers/applicant-lifecycle.service.test.ts:433/:447` + `backend/services/teachers/verification-purchase.service.test.ts:301`), override trio + admin gate (`applicant-lifecycle.service.test.ts:1524/:1817/:1959/:2065`), conversion privileges (`test/workflows/teachers/applicant-student-conversion.journey.test.ts:1063`), journeys (`test/workflows/teachers/cooldown-state-machine.test.ts:1002/:1129`, `evaluation-rubric-scoring.journey.test.ts:1027/:1296`) — all passing.
2. WHEN the TV4 tripwire runs THEN `TAJWEED_COOLDOWN_DAYS === 30` and `HIFZ_COOLDOWN_DAYS === 90` SHALL be pinned as literal types (`shared/constants/evaluation-rubric.constants.ts:21,:24`; model `shared/constants/verification-plan.constants.test.ts:55-69`).
3. WHEN the TV7 schema-contract suite runs (`backend/db/test/repo/teachers/teacher-verification.repository.test.ts`, new) THEN `information_schema.columns` SHALL show `teacher_verification.tajweed_level`/`hifz_level` as nullable varchar(50) (DDL `backend/drizzle/20260904084151_omniscient_karen_page/migration.sql:313-320`), with FK `teacher_verification_teacher_id_teacher_id_fkey` (`:502`) and index `teacher_verification_teacher_id_idx` (`:376`), and a round-trip insert inside `runInRollback` SHALL read back verbatim.
4. IF any test asserts the rubric flow writes `tajweed_level`/`hifz_level` THEN review SHALL reject it — no producer exists; levels live in `evaluations.weakness_area` (`backend/db/schema/teachers/evaluations.ts:50`); the invariant is annotated KNOWN-UNIMPLEMENTED and ledgered (D-401).
5. WHEN TV tests assert cooldown state THEN they SHALL target `applicants.cooldown_until` — never `students.suspended_period_days` (dossier 02 §6.2 drift); per-cycle distinctness follows the implementation reference at doc `:68(c)`, not the lifetime reading.

- **Priority** Medium · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** none beyond dossier 02.

### REQ-040: Teacher Availability Invariants (INV-A1..INV-A4)

**User Story:** As a platform engineer, I want the availability machine's invariants bound to named tests plus the wire-tier hole (A3) closed, so no in-session teacher is ever offered to a student through any tier.

#### Acceptance Criteria
1. WHEN the A1..A4 census bindings resolve THEN they SHALL cite: cert-gate BFLA (`backend/services/teachers/teacher-availability.service.test.ts:1374`), in-session 409 (`:1411`), browse exclusion (`test/workflows/teachers/on-demand-matching.journey.test.ts:806`, repo compose-rule `backend/db/test/repo/teachers/teacher.repository.test.ts:2765/:2778/:2793`), marker-restore trio (`teacher.repository.test.ts:897/:917/:1005`) — all passing.
2. WHEN the A1 serialization probe runs THEN a toggle-vs-`demoteToUncertified` interleave under `lockForCertificationCheck` (`backend/db/repo/teachers/teacher.repository.ts:179-189`) SHALL end internally consistent in both orderings — never an uncertified-online row that bypassed the gate.
3. WHEN the A2 writers-battery runs (one `Started` session seeded) THEN all three `is_online` writers SHALL leave `isOnline === false`: `setAvailabilityIntent(id, true)` → null + row untouched (race-block today at `backend/db/test/repo/teachers/teacher.repository.test.ts:1484`), `releaseInSessionLock` → `active_sessions_remain`, sweep writes only `false` (`backend/db/repo/teachers/teacher.repository.ts:800`).
4. WHEN the A3 wire suite runs (`backend/graphql/test/teacher-matching.integration.test.ts`, new, modeled on `backend/graphql/test/teacher-availability.integration.test.ts`) THEN a student caller SHALL NOT see an in-session teacher in the `browseAvailableTeachers` page, and anonymous/teacher/staff roles SHALL be denied at the scope step (authScopes `backend/graphql/query/teachers/teacher-matching.query.ts:123-128`).
5. WHEN the A4 named pin runs (extend `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts`) THEN the shipped contract SHALL be pinned: marker=true restore returns Available; a gone-stale teacher is re-offlined by the next sweep — never an activity-conditioned restore (deviation recorded via `†`).

- **Priority** Medium · **Complexity** Medium · **Dependencies** REQ-010, REQ-120, GraphQL integration harness (`testClient`) · **Assumptions** browse surfaces unchanged.

### REQ-050: Subscription, Balance & Plan-Catalog Invariants (INV-B1..INV-B8, INV-PC1..INV-PC3)

**User Story:** As a billing engineer, I want the balance-lane and plan-catalog invariants bound to named tests with the cancel→sweep interplay, trial ordering, and PC2 invariance journey closed, so credited value is provably safe against catalog mutation.

#### Acceptance Criteria
1. WHEN the B1..B8/PC1 census bindings resolve THEN they SHALL cite: lane CHECKs (`backend/db/repo/students/__tests__/student-grant-free-trial-once.test.ts:191`, `student-lane-debit.test.ts:379`, `backend/db/test/repo/students/student.repository.test.ts:428-458`), activation credit (`backend/services/billing/subscription-activation.service.test.ts:927/:950/:990`), expiry (`backend/services/billing/subscription-expiry.service.test.ts:223-373` + `backend/db/test/logic/billing/subscription-expiry.repository.test.ts:106-133` + trial exemption `backend/db/test/logic/billing/student-zero-lane.repository.test.ts:302/:329`), booking denial (`backend/services/classes/session-lifecycle.booking.test.ts:603` + `test/workflows/sessions/session-lifecycle-denials.journey.test.ts:236`), extend (`backend/services/billing/subscription-admin.service.test.ts:501` + `test/workflows/billing/subscription-admin-lifecycle.journey.test.ts:493`), grant-once (`student-grant-free-trial-once.test.ts:98` + `backend/services/students/__tests__/student-trial.service.test.ts:87`), trial-first journey (`test/workflows/classes/session-report-homework.journey.test.ts:583-584`), catalog gate (`backend/db/test/logic/billing/plan-catalog.repository.test.ts:175/:209` + `backend/services/billing/subscription-purchase.service.test.ts:230`) — all passing.
2. WHEN the B3 interplay case runs THEN a cancel-preserved lane MAY be zeroed by a LATER sweep of another covering subscription (cancelled is NON-covering — doc `:186-187`); the conservative direction is under-revoke only, and exact-count assertions SHALL use the `scopeSweepToUsers` spyOn seam (`backend/services/billing/subscription-expiry.service.test.ts:198-210`).
3. WHEN the B8 ordering cell runs (`runInRollback`, seed `{ balanceTrial: 1, balanceHifz: 3 }`, no sweep) THEN `heldBalanceLane === Trial`, trial 1→0, and the paid lane SHALL be byte-identical (extends `backend/services/classes/session-lifecycle.booking.test.ts`, whose trial-success case `:542` runs post-sweep and proves no ordering).
4. WHILE B5 is pinned THEN the implemented half SHALL be asserted (frozen lane map excludes reviews — `backend/db/repo/students/__tests__/student-lane-debit.test.ts:346`; booking can never target reviews) and the doc's "review sessions decrement `balance_reviews`" clause SHALL be recorded UNIMPLEMENTED (no `HeldBalanceLane.Reviews` member — `backend/enum/scheduling/held-balance-lane.enum.ts:17-21`; zero decrement writers; optional `.test-d.ts` `@ts-expect-error` pin); a runtime reviews-booking test SHALL NOT be written — ledger D-406.
5. WHEN the PC2 journey runs (`test/workflows/billing/plan-catalog-invariance.journey.test.ts`, new — steps in the Journeys section) THEN purchase → confirmed activation → admin deactivate + edit SHALL leave the subscription row and credited lane byte-identical AND a subsequent booking on the credited lane SHALL succeed.
6. WHEN the PC3 probes run THEN `PlanRepository` SHALL expose no delete method (source pin over `backend/db/repo/billing/plan.repository.ts:42-241`), a referenced-plan raw DELETE SHALL raise 23503 via `subscriptions_plan_id_fkey` (`backend/db/schema/billing/subscriptions.ts:35-37`) inside a savepoint, and an unreferenced-plan DELETE SHALL be documented as the accepted design boundary (no `prevent_plans_delete` trigger; `lessons.plan_id` is set-null — `backend/db/schema/classes/lessons.ts:21`) — ledger D-405.

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** sibling subscription journeys stay authoritative (`subscription-full-lifecycle`, `subscription-expiry`, `subscription-purchase`).

### REQ-060: Wallet & Transaction Invariants (INV-W1..INV-W8)

**User Story:** As a financial-safety engineer, I want the wallet invariants verified by reference to the sibling suite with only the four residual probes added, so financial verification stays single-sourced and gap-free.

#### Acceptance Criteria
1. WHEN the W1/W2/W6/W8 census bindings resolve THEN they SHALL cite the sibling-owned suites — `backend/db/test/repo/billing/wallet.repository.test.ts:476/:494/:504/:722-758` and `backend/db/test/logic/billing/financial-immutability.test.ts:364-478` — and this plan SHALL NOT re-author them (boundary: `docs/billing/financial-safety-verification.md:30-41`).
2. WHEN the W3 raw probe runs THEN a second wallet INSERT bypassing ON CONFLICT SHALL raise 23505 `wallet_teacher_id_unique` (`constraintNameOf` + `hasPostgresErrorCode("23505")` + cause-chain contains the name — `causeChainContainsMessage` pattern at `wallet.repository.test.ts:160-171`), with the per-teacher count still 1 after savepoint rollback (extends the CHECK-probe describe at `:475`).
3. WHEN the W4 arbitration arm is strengthened (`backend/services/classes/session-lifecycle.service.test.ts:1900`) THEN it SHALL assert `WalletRepository.findByTeacherId(actors.teacherUserId, tx)` is null (wallet never ensured ⇒ zero earning rows) and `confirmedByStudentAt` is null — completing the "no credit without student confirm" oracle.
4. WHEN the W5 residual trigger matrix runs (extends `backend/db/test/logic/billing/financial-immutability.test.ts` tamper tier, all under `describeTriggerTier`) THEN four probes SHALL raise with the exact RAISE text and leave the row byte-identical: `pending→pending` no-op rewrite; decided `completed→failed` re-open; description freeze; `session_id` NULL-swap (live guard `backend/drizzle/20260914064155_custom_5-teacher-transaction-settlement/migration.sql:54-76`; fixtures via `insertTeacherLedgerFixture` `:262-275`).
5. IF a DB-tier earning-without-session probe is proposed (W7) THEN it SHALL be rejected — no CHECK exists (`backend/db/schema/billing/teacher-transaction.ts:38` is a plain nullable FK); the contract pin SHALL assert `creditEarningOnce` ledger rows carry the fixture `sessionId` (signature-level enforcement at `backend/db/repo/billing/wallet.repository.ts:81`); the schema CHECK stays ledgered (D-402).
6. WHEN W8 is bound THEN the shipped `> 0` semantic SHALL be cited as-is (negative probe `wallet.repository.test.ts:504-518`; zero-amount rejection `:722-758`) — the doc's `>= 0` is weaker than shipped and is annotated (`†`), never "fixed".

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** migrate-provisioned test DB for trigger tiers (`wallet.repository.test.ts:886-895` caveat).

### REQ-070: Student Account Invariants (INV-U1..INV-U5)

**User Story:** As a governance engineer, I want account-lifecycle invariants bound to named tests with history preservation and balance preservation proven on the target's own rows, so governance actions are provably non-destructive.

#### Acceptance Criteria
1. WHEN the U2/U4 census bindings resolve THEN they SHALL cite: governance booking denial (`backend/services/classes/session-lifecycle.service.test.ts:752`) and the grep-lock (`backend/graphql/test/inv-u4-grep-lock.test.ts:211`, protected entities + whitelist at `:52/:61/:94`) — both passing, neither re-authored.
2. WHEN the U1 history suite runs (`backend/db/test/logic/students/student_status_history.test.ts`, new — name pre-documented `backend/db/test/logic/AGENTS.md:23`) THEN `session`/`reports`/`student_payments` rows SHALL be byte-identical across a full suspend→block→soft-delete→reactivate ladder via `AdminUserManagementService.setUserDeleted` and friends, login SHALL be denied while deleted, and reactivate SHALL keep history intact.
3. WHEN the U2 lapsed-suspension cell runs THEN `createSession` SHALL STILL deny FORBIDDEN — the raw-boolean guard (`backend/services/classes/session-lifecycle.governance.ts:53`) is deliberately stricter than the login window predicate (login-lapse ALLOWED is pinned at `backend/services/admin/user-governance.service.test.ts:1357`); pin with a comment, never "fix".
4. WHEN the U3 refresh arms run (committed-credential fixtures + `deleteUsersByIds` teardown — NOT `runInRollback`; mirror the D11 pattern at `backend/services/admin/user-governance.service.test.ts:1205-1319`) THEN `AuthService.refreshToken` on a still-valid token issued pre-block SHALL deny `ForbiddenError(accountBlocked)` (`backend/services/auth/auth.service.ts:270` gate); deleted and active-suspension arms likewise.
5. WHEN the U4 runtime complement runs THEN the FK backstop SHALL be pinned: a referenced-user raw DELETE raises 23503 (`session_student_id_…_fkey`) inside a savepoint bracket (canonical pattern `backend/db/test/repo/billing/wallet.repository.test.ts:475-520`), and an un-referenced-user DELETE SUCCEEDS then rolls back — proving INV-U4 is app-layer (grep-lock) + FK restrict, NOT a trigger; a `prevent_users_delete` expectation is FORBIDDEN.
6. WHEN the U5 ladder suite runs (`backend/db/test/logic/students/student_status_transition.test.ts`, new) THEN the target's own `students` row — all four balance lanes + `trialGrantedAt` — SHALL be byte-identical across every governance transition (sibling-user isolation is already pinned at `backend/services/admin/user-management.service.test.ts:2151`).
7. WHEN governance fixtures are seeded THEN overrides SHALL target `users` columns via `createTestUser` (governance lives on `users` — `backend/db/schema/users/users.ts:37-43`; `students` holds only balances/handshake/parent).

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** admin actor provisioning per `backend/services/admin/user-governance.service.test.ts:164-171`.

### REQ-080: Parent-Child Link Invariants (INV-P1..INV-P4)

**User Story:** As a parent-portal engineer, I want the link invariants bound by reference to the five-layer existing evidence with one thin absence pin added, so monitoring is provably confirmation-gated, read-only, and correctly notified.

#### Acceptance Criteria
1. WHEN the P1..P4 census bindings resolve THEN they SHALL cite: single-writer corpus (`backend/services/parents/parent-link.static-locks.test.ts:533`), guarded link (`backend/db/test/repo/students/student.repository.test.ts:318`), confirm/reject/concurrency journeys (`test/workflows/parents/student-confirmation-of-link.journey.test.ts:721`, `parent-full-journey.journey.test.ts:572`, `backend/services/parents/parent-link-request.chaos.test.ts:534`), denial oracle (`backend/services/parents/parent-monitoring.helpers.test.ts:475`), SDL freeze (`backend/graphql/test/schema-surface.test.ts:1417` + mutation trio `:772-776`), notification contract (`backend/services/classes/session-report-notification.test.ts:248/:317`), handshake (`backend/db/test/logic/students/handshake-code-generation-locks.test.ts:219`) — all passing.
2. WHEN the P3 absence pin runs (extend `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts`) THEN a linked child with a completed-but-unreported session SHALL produce ZERO parent notification rows and ZERO spied publishes (baseline delta 0; `SpiedFanoutTransport`) — the producer is report submission (`backend/services/classes/session-report.service.ts:306`), not the `completed` flip.
3. IF a plan task proposes an "unlink flow" test THEN it SHALL be rejected — no such mutation exists (`link_status` has no `unlinked` member, `backend/db/schema/enums.ts:99`); severance is FK set-null + fixture-only (`backend/db/test/repo/students/student.parent-monitoring.repository.test.ts:126-131`).
4. WHILE binding P-legs THEN the sibling plan's journeys SHALL remain authoritative (`ai/finished_plans/milestone_4_integration_security_launch/workflow_tests_parent_journey_and_subscription_lifecycle/specs.md` REQ-2/REQ-3) — this plan never re-writes them.

- **Priority** Medium · **Complexity** Low · **Dependencies** REQ-010 · **Assumptions** none.

### REQ-090: Payment Invariants (INV-PAY1..INV-PAY7)

**User Story:** As a billing engineer, I want the payment invariants bound to the three-tier existing evidence with the two missing DB probes closed, so the ledger's CHECK, enum, immutability, exactly-once, and quarantine claims are all machine-verified.

#### Acceptance Criteria
1. WHEN the PAY2/PAY3/PAY5/PAY6/PAY7 census bindings resolve THEN they SHALL cite: trigger matrix (`backend/db/test/logic/billing/student-payment.repository.test.ts:169/:227/:259/:295` + provider references `:420-574`), failed-delivery no-credit (`backend/services/billing/subscription-activation.service.test.ts:533`), offline bypass (`backend/services/admin/student-onboarding.service.test.ts:703/:725/:751/:518`), exactly-once (`student-payment.repository.test.ts:190` + `subscription-activation.service.test.ts:577/:612/:1303` + journeys `test/workflows/billing/subscription-purchase.journey.test.ts:625`, `paymob-purchase-journey.test.ts:697` + route storm `app/api/payments/webhook/test/payments-webhook-route.test.ts:1377`), quarantine (`subscription-activation.service.test.ts:894/:1269/:1234/:1728` + `paymob-purchase-journey.test.ts:934` + route ack `payments-webhook-route.test.ts:1027/:1204`) — all passing.
2. WHEN the PAY1 CHECK probe runs (savepoint-bracketed `expectRepoError` + `constraintNameOf` + `hasPostgresErrorCode("23514")`) THEN BOTH `-1.00` AND `"0.00"` inserts SHALL be rejected by `student_payments_amount_check` — the shipped CHECK is `> 0` (`backend/db/schema/billing/student-payments.ts:74`), so zero MUST be asserted to reject; the UPDATE leg SHALL NOT be probed (the immutability trigger raises first — covered at `student-payment.repository.test.ts:259`).
3. WHEN the PAY4 closed-set probes run THEN a bogus gateway enum value SHALL raise 22P02 (cause-chain contains "invalid input value for enum"), a NULL gateway SHALL raise 23502, and `enum_range(NULL::payment_gateway)` SHALL equal the 9 shipped values (stripe, paypal, paymob, fawry, offline_cash, bank_transfer, scholarship, other, mock — `backend/db/schema/enums.ts:67-77`), guarding drift against the doc's stale 5-value list.
4. IF live-gateway E2E is proposed THEN it SHALL be rejected — every INV-PAY leg is verifiable with the mock channel (`test/workflows/billing/paymob-purchase-journey.test.ts:803/:934` deliver real signed callbacks without live creds); `bun run test:ui:e2e:paymob` is out of scope (dossier 08 §6.3).

- **Priority** High · **Complexity** Low-Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** CHECK/enum probes are pglite-safe (no trigger gating needed).

### REQ-100: Homework & Progress Invariants (INV-HW1..INV-HW4, INV-PR1..INV-PR3)

**User Story:** As a curriculum engineer, I want the homework/progress invariants bound to named tests with the constraint legs, routing semantic, and null-plan denial closed, so the grade-assign-grade chain and the Tajweed pointer are provably sound.

#### Acceptance Criteria
1. WHEN the HW3/HW4/PR2 census bindings resolve THEN they SHALL cite: ungraded-assignment composition (`backend/services/classes/session-report.service.test.ts:710/:751/:778`), grade-previous + write-once (`:952/:805/:1518`), repo write-once (`backend/db/test/repo/classes/home-work.repository.test.ts:397/:415`), journey chains (`test/workflows/classes/session-report-homework.journey.test.ts:1228/:1352` + cross-teacher `session-report-cross-teacher.journey.test.ts:556/:668`), Tajweed pointer (`backend/db/test/logic/classes/student-progress.service.test.ts:222/:338/:240-318` + `test/workflows/classes/tajweed-progress-increment.test.ts:559/:606/:685`) — all passing.
2. WHEN the HW1 constraint legs are probed THEN NULL `session_id` SHALL raise 23502, an orphan `session_id` SHALL raise 23503 `home_work_session_id_session_id_fkey`, a session-row delete SHALL cascade the homework row, and the static pin SHALL assert `homeWork.sessionId.notNull === true` (extends `backend/db/test/repo/classes/home-work.repository.test.ts` Tier 4 + `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts`).
3. WHEN the HW2 CHECK trips run THEN `gradeHomeWorkOnce` (which bypasses service validation) with grades 101 and -1 SHALL raise 23514 with `constraintNameOf` naming `home_work_current_grade_check` / `home_work_revision_grade_check` respectively (savepoint bracket, row survives).
4. WHEN the HW4 routing pin runs THEN a student holding TWO ungraded homework rows whose σ3 submission carries `previousGrades` SHALL grade the NEWEST row only, the older staying ungraded — the shipped "newest prior row" semantic behind the doc's "previous session's homework" (`backend/db/repo/classes/home-work.repository.ts:142-171` has no grade predicate).
5. WHEN the PR1 constraint legs are probed THEN NULL `student_id` SHALL raise 23502, orphan student/lesson ids SHALL raise 23503 (`progress_student_id_students_id_fkey` / `progress_lesson_id_lessons_id_fkey`), and a legal `lesson_id = NULL` progress row SHALL persist (documented set-null artifact — `backend/db/test/repo/classes/lesson.repository.test.ts:422-441`).
6. WHEN the PR3 runtime probe runs THEN `updateLesson` receiving a wire-shaped `planId: null` SHALL deny `LESSON_PLAN_NOT_FOUND` (the gate at `backend/services/classes/lesson.service.ts:172-173`); `lessons.plan_id` is nullable BY DESIGN — no NOT NULL probe shall be written.
7. WHILE writing HW/PR tests THEN the INV-S7/S8 shared gates (`backend/services/classes/session-lifecycle.enforcement.ts:127/:164`) SHALL NOT be re-tested — they have no production consumer; the production surface (`backend/services/classes/session-report.service.ts`) is the target (dossier 01 §6.3, dossier 09 §6.2).

- **Priority** Medium · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** existing journey chains stay green.

### REQ-110: Evaluation Invariants (INV-E1..INV-E6)

**User Story:** As an evaluation-domain engineer, I want the evaluation invariants bound to named tests with the CHECK trip, FK legs, set-null survival, and no-delete-surface pins closed, so retention and scoring claims are honest about their enforcement tier.

#### Acceptance Criteria
1. WHEN the E4 census binding resolves THEN it SHALL cite the five-tier evidence: service scale-conversion (`backend/services/teachers/student-evaluation.service.test.ts:718/:733/:756/:801`), CHECK-trip (`backend/db/test/repo/teachers/teacher.repository.test.ts:2447`), journey (`test/workflows/teachers/student-teacher-rating.journey.test.ts:530/:671`), wire denial (`backend/graphql/test/student-evaluation.wire.test.ts:654`) — all passing.
2. WHEN the E1 CHECK trip runs THEN `insertOnce` with concrete out-of-range integers 101 and -1 SHALL raise raw 23514 `evaluations_score_check` inside a savepoint (extends `backend/db/test/repo/teachers/evaluation.repository.test.ts` next to the unique probe at `:460`; the column is nullable — concrete integers, never NULL), and the NEW static pin `backend/db/schema/teachers/evaluations-schema.static-assertions.test.ts` SHALL assert the table's CHECK list is exactly `["evaluations_score_check"]` plus the `is_deleted`/`deleted_at` columns (pattern `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts:72-73`).
3. WHEN the E2 source pins run THEN `backend/db/repo/teachers/evaluation.repository.ts` SHALL expose no `.delete(` call and no delete/softDelete/update symbol — the "not hard-deleted" half is surface-absence only; a raw DELETE-rejection test is FORBIDDEN (no guard exists — teardowns hard-delete successfully, `evaluation.repository.test.ts:290-292`); the gap is ledgered (D-403).
4. WHEN the E3/E6 legs run THEN an orphan evaluator id SHALL raise 23503 `evaluations_evaluator_id_users_id_fkey` (savepoint), and on a committed fixture a session hard-delete SHALL leave the evaluation surviving with `sessionId === null` (set-null — `backend/db/schema/teachers/evaluations.ts:47`; committed fixtures + id registry per `createCommittedCast` `:281-288`, NOT `runInRollback`).
5. WHEN the E5 composite runs THEN one labeled INV-E5 test SHALL assert the drill-down composes homework grades (both tracks) + report history + `progressRowCount` + attention flag for one known student (extends `backend/services/admin/admin-academic-tracking.service.test.ts`); INV-E5 maps to the academic-tracking surface, NOT the `evaluations` table (dossier 10 §6.5).

- **Priority** Medium · **Complexity** Medium · **Dependencies** REQ-010, REQ-120 · **Assumptions** E6's full retention guard stays ledgered (D-403).

### REQ-120: Cross-Tier Verification Conventions

**User Story:** As a test author, I want the layer contracts codified once, so every new probe lands in the right layer with the right transaction discipline and the suite stays fast, isolated, and green.

#### Acceptance Criteria
1. WHEN DB-tier tests run THEN every repo call SHALL take `tx` inside `runInRollback` (`backend/db/test/test-utils.ts:34`); `expect(...).rejects.toThrow()` is FORBIDDEN inside the wrapper — rejections SHALL use `expectRepoError` (`test-utils.ts:77`) with savepoint brackets (`tx.execute(sql\`savepoint …\`)` … `rollback to savepoint`) so the outer tx stays queryable.
2. WHEN CHECK/unique/FK/enum constraints are probed THEN the oracle SHALL be `constraintNameOf` + `hasPostgresErrorCode` with `PG_CHECK_VIOLATION = "23514"` (canonical: `backend/db/test/repo/billing/wallet.repository.test.ts:475-527`); WHEN triggers are probed THEN the `withinSavepoint` + exact-RAISE-text pattern SHALL be used (canonical: `backend/db/test/logic/billing/financial-immutability.test.ts:174-178`, `:363-516`).
3. WHEN service-tier denial tests run THEN they SHALL extend the co-located `*.test.ts` of the guarding service with typed `DomainError.code` + translated-substring assertions.
4. WHEN journeys run THEN `runInRollback` is FORBIDDEN (`test/workflows/AGENTS.md:8-11`); fixtures commit in `beforeAll` with `jrn_`-prefixed identities (pattern `test/workflows/billing/subscription-expiry.journey.test.ts:44-60`), registry-tracked FK-safe teardown, and twice-green reruns; denial text SHALL come from `getServerTranslations("en").errorsTranslations` (`test/workflows/sessions/session-state-machine.journey.test.ts:92-94`).
5. WHEN DB-layer tests need expected denial text THEN `getServerTranslations` SHALL NOT be called directly (i18n loader hang — `backend/db/test/AGENTS.md:121-124`); DB tests assert the repo's own message substrings.
6. WHEN any test executes THEN it SHALL run via `bun run test/scripts/run-test.ts <path>` (db/services) or `bun run test/scripts/run-test.ts test/workflows/<domain>` (journeys) — raw `bun test` on `backend/db/test/**` or `test/workflows/**` is FORBIDDEN.
7. WHEN trigger-tier probes run on embedded providers THEN they SHALL sit under `describeTriggerTier = isPgliteProvider() ? describe.skip : describe` (`backend/db/test/logic/billing/financial-immutability.test.ts:314`); CHECK/enum probes stay ungated.
8. WHEN 10+ new probe files land THEN the savepoint-probe scaffold SHALL be ONE shared helper (`backend/db/test/logic/invariants/invariant-probe.helpers.ts`; extraction precedent `backend/db/test/pg-error.ts:3-5`) so `bun run check:duplicates` stays green; per-domain files cite existing repo-tier probes in their headers instead of duplicating them (`backend/db/test/logic/AGENTS.md:47`).
9. WHEN the new `backend/db/test/logic/invariants/` dir lands THEN `backend/db/test/logic/AGENTS.md` Layout SHALL be refreshed (rule `:50-54`; the current Layout is stale — dossier 11 §3.3).
10. WHEN suites complete THEN `bun run test:db` / `bun run test:services` / the workflows layer SHALL auto-discover every new file by glob with zero `package.json` edits, and each new file SHALL respect the 60s per-file runner budget (per-domain split — no 67-invariant mega-file).

- **Priority** High · **Complexity** Medium · **Dependencies** REQ-010 · **Assumptions** runners and helpers stay unchanged.

### REQ-130: Documentation Truthing & Knowledge Propagation

**User Story:** As a future maintainer, I want the invariants doc to tell the truth about shipped enforcement, so I stop rediscovering doc-vs-code drift the hard way.

#### Acceptance Criteria
1. WHEN doc annotations land THEN `docs/specs/state-machine-invariants.md` SHALL be annotated following its existing `✅ IMPLEMENTED`/`✅ AMENDED` precedent — never silently rewriting invariant semantics: INV-TV7 `KNOWN-UNIMPLEMENTED` (no producer; levels live in `evaluations.weakness_area`); INV-W8 + INV-PAY1 `✅ AMENDED` (shipped CHECK `amount > 0`); INV-PAY4 `✅ AMENDED` (9-value pgEnum); §2.1 cooldown rows (cooldown lives on `applicants.cooldown_until`, not `students.suspended_period_days`); §6 governance note (columns live on `users`); INV-A3 note (directory EXISTS — `browseAvailableTeachers`; retire the "remains owned by the directory/alternatives surfaces" claim at `:127`); INV-A4 note (marker-restore + sweep freshness, not literal app-open); INV-U2 note (booking guard stricter than the login window); INV-B5 reviews-decrement clause marked UNIMPLEMENTED; INV-W7 note (signature-level enforcement); INV-E3 column names (`evaluated_id`/`evaluator_id`); INV-E2/E6 + INV-PC3 design-boundary notes; `:127` writer line-pointer refresh (`:460/:558/:685`).
2. WHEN PRODUCTION_READINESS §5 is refreshed THEN the stale §5.3.3 "no expiry surface" claim SHALL be corrected (the sweep shipped — `backend/services/billing/subscription-expiry.service.ts` + `backend/db/repo/billing/subscription.repository.ts:399-412`), the ☐ rows of §5.1/§5.2/§5.4/§5.5 SHALL flip to ✅ with census test cites, and the missing PAY/HW/PR/E/PC rows SHALL be added (or ledger-deferred with a pointer if checklist ownership resists).
3. WHEN canonical test docs land THEN `docs/testing/invariant-verification.md` (new — the census's human-readable registry, modeled on `docs/billing/financial-safety-verification.md:30-41`) SHALL document the census module, the drift oracle, the per-domain suites, and the PIN-APP-LAYER doctrine.
4. WHEN `docs/parents/monitoring-portal.md` is touched THEN the stale "five SDL queries" rows (`:248/:250/:268`) SHALL be corrected to the seven-field SDL pin (`backend/graphql/test/schema-surface.test.ts:709-717`).
5. WHEN knowledge propagates THEN `backend/db/test/logic/AGENTS.md` gains the `invariants/` Layout entry (REQ-120.9) and the deferred ledger carries D-401..D-408 as future-ticket pointers — this plan ships no schema, triggers, or writers.

- **Priority** Medium · **Complexity** Low · **Dependencies** all machine REQs green · **Assumptions** annotations are ratified at the Phase 1.5 plan review.

---

## UX / Navigation Requirements (MANDATORY section — resolved as N/A)
**Ruling: NO UX/Navigation surface in this ticket.** The deliverable is verification infrastructure (tests + census + doc annotations). No routes, pages, sidebars, tabs, or role-based rendering change; no `frontend/` or `app/` file is created or modified.

| Surface | Ruling |
|---|---|
| New routes | none (test-only) |
| Sidebar navigation placement | N/A |
| Tabs / per-audience rendering | N/A |
| UI files touched | none |

### Roles provisioned by the verification journeys (replaces the role-access matrix)

Journeys provision REAL actors via the actor factory (`test/workflows/helpers/actor-context.ts:88,105,122,136` — `provisionStudentActor` / `provisionCertifiedTeacherActor` / `provisionParentActor` / `provisionAdminActor`, each `(tx, { locale?, tracked? }) => JourneyActor`):

| Real role | Provisioned by | Used by census legs |
|---|---|---|
| Student | `provisionStudentActor` | S2 sweep cells, PC2 invariance journey, governance ladder leg |
| Certified teacher | `provisionCertifiedTeacherActor` | S2, PC2, P3 absence pin |
| Parent | `provisionParentActor` | P3 absence pin |
| Admin | `provisionAdminActor` | PC2 (deactivate + edit), governance ladder leg |
| Denial cast (anonymous / wrong-role) | wire-tier role matrix in the new A3 integration test | A3 |

The applicant→converted-student cast (INV-TV6) and all other cited journeys are executed by their existing suites — this plan binds them by reference and never re-provisions them.

---

## Cross-Actor Workflow Scenarios (Journeys)
### Actor Table

| Actor | Role | Can Do | Cannot Do |
|---|---|---|---|
| Student S | student | book/start/confirm sessions; browse teachers; purchase plans | bypass balances; book while suspended; see in-session teachers |
| Teacher T | teacher (certified) | complete sessions; submit reports | teach uncertified; resurrect own availability |
| Parent P | parent | read linked-child data; receive completion waves | write anything (read-only portal); monitor unlinked children |
| Admin A | admin | deactivate/edit plans; govern users; settle withdrawals | hard-delete protected rows; mutate immutable ledgers |

### Journey disposition (census-driven)

- **Cited, never touched (verify-by-reference):** `session-state-machine` (S1 positive legs), `session-dual-confirmation`, `in-session-lock-release`, `on-demand-matching`, `cooldown-state-machine`, `evaluation-loop-booking`, `evaluation-rubric-scoring`, `applicant-student-conversion`, `verification-plan-purchase`, `session-report-homework`, `subscription-purchase`/`-expiry`/`-full-lifecycle`/`-admin-lifecycle`, `paymob-purchase-journey`, `financial-safety-verification`, `admin-financial-auditing`, the six parent journeys, `student-teacher-rating`, `account-governance` (existing steps), `direct-student-onboarding`.
- **Extended (existing files):** (1) `test/workflows/sessions/session-state-machine.journey.test.ts` — S2 residual cells; (2) `test/workflows/teachers/teacher-inactivity-auto-offline.journey.test.ts` — INV-A4 named pin; (3) `test/workflows/parents/parent-session-completion-deep-link.journey.test.ts` — P3 absence pin; (4) `test/workflows/admin/account-governance.journey.test.ts` — governance ladder leg below.
- **New:** `test/workflows/billing/plan-catalog-invariance.journey.test.ts` (PC2).

### New journey — plan-catalog invariance (PC2), ordered steps

1. **System** → provision S + T + A + a hifz-lane plan in ONE committing transaction (`jrn_` prefix, registry-tracked).
2. **S** → purchases the plan; the mock channel confirms → subscription `active`, `balance_hifz = plan.sessionCount` (byte-snapshot both).
3. **A** → deactivates the plan (`is_active=false`, `deactivated_at`) and edits it (title/price).
4. **Observer assertions** → subscription row byte-identical; credited lane byte-identical; `planCatalog` excludes the plan (PC1 re-proof).
5. **S** → books a session on the credited lane → booking SUCCEEDS (credited value survived deactivation + edit).
6. **System** → teardown via registry; zero residue; immutable tables asserted by zero-row deltas, never tracked.

### Journey extension — student-governance ladder (account-governance leg), ordered steps

1. **S** → books a session pre-suspension (history baseline: session + report + payment rows snapshotted).
2. **A** → suspends S → **S** attempts booking → FORBIDDEN, zero writes (U2); balances byte-identical (U5).
3. **A** → blocks S → **S**'s still-valid refresh token is denied `accountBlocked` (U3 cross-actor arm; the unit arms live at the logic tier per REQ-070.4).
4. **A** → soft-deletes S → history rows byte-identical to every observer (U1); login denied.
5. **A** → reactivates S → history intact; **S** books again successfully.

### Cross-Actor EARS Criteria

1. WHEN Admin A deactivates + edits a plan THEN Student S's subscription and credited lane SHALL remain byte-identical AND S's subsequent booking SHALL succeed (REQ-050.5).
2. WHEN Student S is suspended, blocked, or soft-deleted THEN S's booking/refresh SHALL be denied AND S's historical rows and balances SHALL remain byte-identical to every observer (REQ-070).
3. WHEN a cancelled session is driven toward complete or dispute THEN the real service SHALL deny `SESSION_INVALID_TRANSITION` AND the session row SHALL be byte-identical (REQ-020.2).
4. WHEN a linked child's session completes without report submission THEN the parent observer SHALL receive zero notifications and zero publishes (REQ-080.2).

---

## Non-Functional Requirements
### Performance & Runtime Budget
- WHEN suites run THEN each new per-domain file SHALL stay under the 60s per-file runner budget (`test/scripts/run-db-tests-parallel.ts:14-19`) — the 11-file per-domain split parallelizes across 8 workers; a 67-invariant mega-file is FORBIDDEN.
- WHEN the census drift test runs THEN it SHALL be a pure file-scan (doc + census + cited files), order-of-seconds, with zero DB dependency.

### Isolation & Flake Resistance
- WHEN DB tests run THEN every constraint/trigger probe SHALL sit inside `runInRollback` + its own savepoint bracket so the outer transaction stays queryable and no failed probe poisons later assertions.
- WHEN journeys run THEN fixtures SHALL commit with `jrn_`-prefixed identities, registry-tracked FK-safe teardown (`JOURNEY_TRACKED_TABLE_DELETE_ORDER` — `test/workflows/helpers/journey-fixture-registry.ts:73-83`), and twice-green reruns; immutable tables (`audit_logs`, `teacher_transaction`) are asserted by zero-row deltas, never tracked.
- WHEN exact-count assertions touch the shared-DB expiry sweep THEN the `scopeSweepToUsers` spyOn seam SHALL scope claims to fixture users (`backend/services/billing/subscription-expiry.service.test.ts:198-210`).
- WHEN teardown must delete immutable rows THEN `withImmutabilityTriggersSuspended` / `withAuditDeleteTriggersSuspended` SHALL be used (`afterAll` only, never inside probes — `backend/db/test/repo/billing/wallet.repository.test.ts:68,908-912`).
- WHEN fixtures are created THEN no seed data SHALL be queried — entity-setup helpers only (`backend/db/test/entity-setup.ts:74-571`, all 16 verified in dossier 11 §3.4).

### Portability
- WHEN trigger tiers run on embedded providers THEN they SHALL skip via `describeTriggerTier` (`isPgliteProvider()`) — never silently pass; CHECK/enum probes remain ungated.
- WHEN the test DB is provisioned THEN trigger-tier tests SHALL acknowledge that schema-push-provisioned DBs lack custom-migration triggers (migrate-provisioned `kottaby_test` required — `backend/db/test/repo/billing/wallet.repository.test.ts:886-895`).

### Duplication Control
- WHEN 10+ new probe files land THEN the savepoint-probe scaffold SHALL exist as ONE shared helper (REQ-120.8) so `bun run check:duplicates` stays green — never per-file copies of the bracket/oracle boilerplate.

## Constraints and Assumptions
### Technical Constraints
- Test-writing only: no schema, migrations, triggers, product code, UI, or GraphQL schema changes (the reconciliation ruling; enforced by review, ledgered as D-401..D-408).
- Sibling suites are authoritative; residual probes extend or cite, never fork (`backend/db/test/logic/AGENTS.md:47`).
- Runners auto-discover new files by glob — zero `package.json` edits; `backend/db/test/logic/AGENTS.md` Layout must be refreshed for `invariants/`.
- Forbidden patterns everywhere: raw `bun test` on `backend/db/test/**` or `test/workflows/**`; `expect(...).rejects.toThrow()` inside `runInRollback`; `getServerTranslations` in DB-layer tests; hardcoded user-facing strings.

### Business Constraints
- 5-SP verification overlay over shipped machines — no new behavior may emerge from a test ticket.
- Live Paymob E2E excluded (`PAYMOB_LIVE_TESTS` gate + `build:test` + ngrok — no invariant requires it).

### Assumptions
- The blocked-by Milestone 1–3 tickets are shipped (dossier 12 §7 spot-check).
- A migrate-provisioned test DB is available for trigger-tier probes.
- `docs/specs/state-machine-invariants.md` remains the canonical 67-ID source for the life of the plan.

## Success Criteria
### Definition of Done
- [ ] All 67 census rows bound to ≥1 passing named test; census-drift bijection green (doc ↔ census ↔ real test files); a seeded fake doc-ID addition or phantom cite turns it red.
- [ ] The ticket's five scenarios proven per machine (mapping below); all pre-existing suites stay green (extensions only, no regressions).
- [ ] All 6 PIN-APP-LAYER rows pinned + drift annotated; deferred ledger carries D-401..D-408 as future-ticket pointers.
- [ ] Doc truthing landed: invariants-doc annotations, PRODUCTION_READINESS §5 refresh where stale, `docs/testing/invariant-verification.md`.
- [ ] Per-file `sub-loop` quality loop green on every touched file; `bun run test:db`, `bun run test:services`, and the workflows layer all green.

### Ticket-Scenario Mapping (`docs/planning/TICKETS.md:2903-2907`)
| Ticket scenario | Proven by |
|---|---|
| All 50+ invariants tested | Census bijection (REQ-010) — 67 rows, ≥1 binding each |
| Invalid transitions rejected | REQ-020.2 (S1/S2 terminals), TV3/TV5 + U2/U3 + W5 + PAY6 bindings (census) |
| Check constraints enforced | B1, W1/W2/W8, PAY1 (new probe), HW2 (new trip), E1 (new trip) |
| Immutability verified | W6 + PAY2 (trigger tiers, cited), E2/E6 + U4 + PC3 (pins + boundaries) |
| Uniqueness constraints verified | W3 (new 23505 probe), HW1 (`home_work_session_id_unique`), TV2 (`evaluations_session_evaluator_unique`), P1 (`parent_link_requests_pending_pair_unique`), P4 (`students_handshake_code_unique`) |

### Acceptance Metrics
- Census: 67/67 rows with ≥1 binding; dispositions delivered 32 VBR / 24 EXTEND / 5 NEW-PROBE / 6 PIN; new/extended surfaces: 1 census module + 1 drift test + 1 shared probe helper + per-domain invariants suites + dossier-named new files + 4 journey extensions + 1 new journey.

## Glossary
| Term | Definition |
|---|---|
| Census | The machine-readable catalog of all 67 invariants, each bound to ≥1 named test (`INVARIANT_CENSUS`). |
| Disposition | What the plan does for an invariant: VERIFY-BY-REFERENCE / EXTEND / NEW-PROBE / PIN-APP-LAYER+DOC-DRIFT. |
| Guarded single-statement UPDATE | A repo write whose WHERE clause encodes the precondition; zero matched rows = denial (returns null). |
| Savepoint bracket | `savepoint … probe … rollback to savepoint` around a constraint/trigger trip so the outer `runInRollback` transaction stays queryable. |
| Marker (`was_online_before_lock`) | Nullable teacher column — the lock-held oracle and the pre-lock availability intent restored on the last `started`-exit. |
| Grep-lock | A static test asserting zero forbidden production calls (e.g. `backend/graphql/test/inv-u4-grep-lock.test.ts` — INV-U4's actual enforcement tier). |
| Census drift | Any divergence between the invariants doc, the census, and the cited test files — a CI failure, never a warning. |
| KNOWN-UNIMPLEMENTED | Doc annotation for an invariant whose producer/enforcement does not exist (INV-TV7); tests pin the schema contract and never fabricate behavior. |
| PIN-APP-LAYER | Pinning shipped app-layer semantics with tests + recording the absence of DB-level enforcement (ledger pointer), instead of adding schema. |

## Requirements Review Checklist (author self-certification)
- [x] All user roles identified (journey actors, denial casts, admin/observer splits)
- [x] Normal, edge, and error cases covered (positive + negative/denial direction per machine; boundary cells named)
- [x] Each acceptance criterion maps to an executable assertion or a census binding
- [x] EARS format used consistently (WHEN/IF/WHILE + SHALL)
- [x] No conflicting requirements (dispositions are mutually exclusive per row; sibling boundaries explicit)
- [x] Cross-actor workflow journeys captured (actor table + ordered steps + observer-perspective criteria)
- [x] UX/Navigation resolved explicitly (test-only; role table replaced by journey-provisioned real roles)
- [x] Non-functional requirements addressed (runtime budget, isolation, portability, duplication control)
- [x] Success criteria measurable (67/67 bindings; five ticket scenarios mapped; drift oracle red-on-drift)
- [x] Terminology defined (glossary) and traceable (census ID ↔ REQ ↔ test surface)
