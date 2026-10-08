# Research Dossier — Sibling Plans, Canonical Docs & Ticket Context (cross-cutting)

Scope: sibling-plan ownership of invariant tests, plan-structure conventions, PRODUCTION_READINESS checklist, blocked-by verification, canonical-doc INV bindings. Path:line anchors verified on the live tree 2026-10-08.

## 1. Invariants in scope (per-ID doc lines in `docs/specs/state-machine-invariants.md`)

| Group | Doc lines (per ID) | Count |
|---|---|---|
| INV-S1..S8 | S1:42 S2:43 S3:44 S4:45 S5:46 S6:47 S7:48 S8:49 | 8 |
| INV-TV1..TV7 | TV1:87 TV2:88 TV3:89 TV4:90 TV5:91 TV6:92 TV7:93 | 7 |
| INV-A1..A4 | A1:120 A2:121 A3:122 A4:123 (impl refs :125-127) | 4 |
| INV-B1..B8 | B1:152 B2:153 B3:154 B4:155 B5:156 B6:157 B7:158 B8:159 (refs :161-190) | 8 |
| INV-W1..W8 | W1:213 W2:214 W3:215 W4:216 W5:217 W6:218 W7:219 W8:220 | 8 |
| INV-U1..U5 | U1:251 U2:252 U3:253 U4:254 U5:255 | 5 |
| INV-P1..P4 | P1:274 P2:275 P3:276 P4:277 (binding note :279) | 4 |
| INV-PAY1..PAY7 | PAY1:302 PAY2:303 PAY3:304 PAY4:305 PAY5:306 PAY6:307 PAY7:308 | 7 |
| INV-HW1..HW4, PR1..PR3 | HW1:317 HW2:318 HW3:319 HW4:320; PR1:325 PR2:326 PR3:327 | 7 |
| INV-E1..E6 | E1:336 E2:337 E3:338 E4:339 E5:340 E6:341 | 6 |
| INV-PC1..PC3 | PC1:356 PC2:357 PC3:358 (§11 "Plan Catalog Lifecycle", 11th machine) | 3 |

**Counts:** 64 invariants across the 10 machines named by the ticket + 3 in the doc's 11th machine (PC) = **67 total in the doc**.

**Ticket-vs-doc drift (load-bearing scope reconciliation input):**
- Ticket Gherkin (`docs/planning/TICKETS.md:2893,2897`) enumerates only **INV-B1..B6** and **INV-PAY1..PAY5**; the doc today carries B7 (:158), B8 (:159), PAY6 (:307), PAY7 (:308). Verbatim: PAY6 = "Exactly one `pending → paid` activation ever executes per subscription"; PAY7 = mismatched callback is "QUARANTINED". B7 = trial grant-once via `trial_granted_at IS NULL` guarded UPDATE; B8 = trial-first decrement ladder.
- Ticket says "10 state machines and 50+ invariants" (`:2883`) but the doc's §11 Plan Catalog (INV-PC1..PC3, `:356-358`) is an 11th machine absent from the Gherkin and from PRODUCTION_READINESS §5.
- Ruling the plan must make: the **doc supersedes the ticket enumeration** (doc is the ticket's own named source of truth, `:2883`) — verify all 67, or ledger-defer PC with an explicit disposition.

## 2. Enforcement map (group level; mechanisms verified on the live tree)

| Group | Mechanism | Path:line / symbol |
|---|---|---|
| S1/S2 | Closed transition matrix + guarded repo UPDATEs | `backend/services/classes/session-lifecycle.enforcement.ts:72` `SESSION_TRANSITION_MATRIX`, `:94` `isSessionTransitionAllowed`; doc refs `docs/specs/state-machine-invariants.md:12` |
| S3 | Dual-confirm wallet credit (escrow B.4) | `docs/sessions/session-lifecycle.md:139-141` (hold = guarded debit at request; `fee_held` marker + `held_balance_lane` provenance); schema `backend/db/schema/classes/session.ts:68-69` |
| S4/S5 | Schema NOT NULL FKs; `FOR UPDATE` certification lock | `docs/sessions/session-lifecycle.md:79-80,130` |
| S6 | In-session lock, marker-gated | `backend/db/repo/teachers/teacher.repository.ts:460` `acquireInSessionLock`, `:558` `releaseInSessionLock`; doc `:47` |
| S7/S8 | Service gates | `backend/services/classes/session-lifecycle.enforcement.ts:127` `assertSessionCompletedForReport` (+ `assertReportSubmittedForHomework`, docblock `:28-32`) |
| TV1/TV2 | Booking surface gates | `backend/services/teachers/evaluation-booking.service.ts:56` `VERIFICATION_PLAN_SESSION_COUNT`, `:195` derived `remainingCredits`; `docs/teachers/evaluation-loop-booking.md:73` "Distinct-evaluator rule (INV-TV2)" |
| A1/A2 | Toggle gates | `docs/teachers/teacher-availability.md:25-26,41` (INV-A1 403, INV-A2 409; `setAvailabilityIntent` `backend/db/repo/teachers/teacher.repository.ts:685`) |
| A3 | **No consumer surface** — data-level truthfulness only | milestone_2 ruling `ai/plans/milestone_2/in_session_locking_hide_from_directory/specs.md:9` |
| A4 | Marker-gated release (`was_online_before_lock`) | migration `backend/drizzle/20261006173528_custom_13-teacher-was-online-before-lock`; doc `:127` |
| B1..B8 | CHECK constraints + guarded lane UPDATEs + expiry sweep | `docs/billing/subscription-validity-window-expiry.md:44-52` (B2/B3/B4/B6); trial lane doc `:154-159`; zero-lane repo `backend/db/test/logic/billing/student-zero-lane.repository.test.ts:114` |
| W1/W2/W8 | DB CHECK constraints | `backend/db/repo/billing/wallet.repository.ts` probes (per `docs/billing/financial-safety-verification.md:39`) |
| W3 | `ensureWalletOnce` unique teacher_id | `backend/db/repo/billing/wallet.repository.ts:59` |
| W5 | Guarded settlement + amended trigger | `backend/db/repo/billing/wallet.repository.ts:421` `settleWithdrawalOnce`; migrations `backend/drizzle/20260912091422_custom_5-teacher-transaction-settlement` + `:20260914064155` amend `prevent_teacher_transaction_update` |
| W6/PAY2 | Immutability triggers | `backend/drizzle/20260904084152_custom_3-immutability-triggers` (`prevent_*_update`/`delete` ×3 tables); PAY2 amendment `20260907182426`/`20260908103411_custom_4-student-payments-status-transition` |
| PAY3/PAY6 | Guarded activation | `backend/services/billing/subscription-activation.service.ts:21-91` (guarded-UPDATE docblock) |
| U2/U5 | Governance denials at login/SSR + service re-check | `docs/sessions/session-lifecycle.md:86` |
| P1/P2 | student-row grant + read-only scope | `docs/parents/monitoring-portal.md:17` (INV-P1/P2) |
| PC1..PC3 | Plan catalog deactivation + preservation | `backend/db/test/logic/billing/plan-catalog-preservation.test.ts:16` (REQ-075 = INV-PC2 proof) |

## 3. Existing coverage — OVERLAP MATRIX (group → sibling plan / test owner → verdict)

| Group | Owning sibling plan / existing tests (verified on disk) | Verdict |
|---|---|---|
| INV-S1..S8 | **workflow_tests** (sessions journeys) + **financial-safety** (S2/S3-adjacent) + M2 in-session-locking. Tests: `test/workflows/sessions/session-state-machine.journey.test.ts` (13 tests; disputed open-once/admin-exit/lane-intact refund per doc `:12`), `session-dual-confirmation.journey.test.ts`, `session-lifecycle-denials.journey.test.ts`, `in-session-lock-release.journey.test.ts`, `post-confirmation-dispute.journey.test.ts`, `backend/services/classes/session-lifecycle.service.test.ts` (chaos blocks `:2314,:2346` per finsafe tasks.md:60), `session-lifecycle.enforcement.test.ts`, `test/workflows/classes/session-report-homework.journey.test.ts` (S7/S8) | **PARTIAL** — abundant adjacent tests; PR §5.1 rows all ☐; no single per-invariant ratification registry |
| INV-TV1..TV7 | Milestone-1/3 tickets' own tests: `test/workflows/teachers/evaluation-loop-booking.journey.test.ts` (20 tests; TV2 distinct-evaluator), `cooldown-state-machine.test.ts` (15 tests; TV3/TV4), `evaluation-rubric-scoring.journey.test.ts`, `verification-plan-purchase.journey.test.ts`, `admin-ordered-re-evaluation.journey.test.ts`, `applicant-student-conversion.journey.test.ts` (TV6), `test/workflows/admin/cold-start-certification.journey.test.ts` (TV5/TV1b); service tests `backend/services/teachers/*.test.ts` | **PARTIAL** — TV7 (schema storage of tajweed_level/hifz_level) has no direct assertion found in this slice |
| INV-A1..A4 | `test/workflows/teachers/teacher-availability.journey.test.ts` (A1/A2 denials per `docs/teachers/teacher-availability.md:272`), `test/workflows/sessions/in-session-lock-release.journey.test.ts` (A4 marker), `teacher-inactivity-auto-offline.journey.test.ts` | **PARTIAL** — A3 has no directory consumer; must be ruled data-level (`ai/plans/milestone_2/in_session_locking_hide_from_directory/specs.md:9`) |
| INV-B1..B8 | **workflow_tests** Task 2 `test/workflows/billing/subscription-full-lifecycle.journey.test.ts` (19 tests: B2 credit, B3 expiry zeroing, B6 renew/plan-change/cancel), `subscription-expiry.journey.test.ts` (oracle `specs.md:265`), `subscription-purchase.journey.test.ts`; **financial-safety** Step A double-spend (B4); PR §5.3 ✅ rows B1/B2/B4/B5 (`docs/planning/PRODUCTION_READINESS.md:243-247`); `student-zero-lane.repository.test.ts:114` | **PARTIAL** — B3 PR row stale (see §6); B7/B8 not enumerated by ticket but enforced (trial ladder `docs/sessions/session-lifecycle.md:84,131`) |
| INV-W1..W8 | **financial-safety-verification OWNS THIS GROUP** — `backend/db/test/repo/billing/wallet.repository.test.ts` (100% coverage + CHECK probes W1/W2/W8 + W3 `ensureWalletOnce` + API-surface no-update/delete), `backend/db/test/logic/billing/financial-immutability.test.ts` (W6 trigger tier), `test/workflows/billing/financial-safety-verification.journey.test.ts` (Steps C-H: W4 dual-confirm credit, W5 drain race + fuzz, W6 tamper, W7 row shape). Verified-invariants table: `docs/billing/financial-safety-verification.md:30-41` | **COVERED** (by sibling; do NOT re-author — verify-by-reference) |
| INV-U1..U5 | `test/workflows/admin/account-governance.journey.test.ts:244` (describe at :244; suspend step `:327`), `admin-user-lifecycle.journey.test.ts`, `backend/db/test/logic/users/user.repository.test.ts`; PR §1.1 refs INV-U1/U4/U5 (`docs/planning/PRODUCTION_READINESS.md:28`) | **PARTIAL** — U4 (no hard DELETE) DB-level guard unverified in this slice; needs raw-DELETE probe |
| INV-P1..P4 | **workflow_tests Task 1 OWNS** `test/workflows/parents/parent-full-journey.journey.test.ts` (15 tests: P1 confirm gate + sibling expiry, P2 read-only denials, P3 completion fan-out, P4 parent_id write); plus `handshake-discovery.test.ts`, `parent-link-request.journey.test.ts`, `parent-monitoring.journey.test.ts`, `student-confirmation-of-link.journey.test.ts`, `backend/db/test/repo/students/student.parent-monitoring.repository.test.ts` | **COVERED** (by sibling; verify-by-reference + PR §5.5 check-off) |
| INV-PAY1..PAY7 | `backend/db/test/logic/billing/student-payment.repository.test.ts:206-213` (PAY2 trigger matrix, finsafe tasks.md:59), `subscription-purchase-idempotency.repository.test.ts` + `subscription-purchase.journey.test.ts` (PAY3/PAY6), `test/workflows/admin/direct-student-onboarding.journey.test.ts` (PAY5), `paymob-purchase-journey.test.ts` (PAY7 quarantine — UNVERIFIED in this slice) | **PARTIAL** — PAY1 CHECK probe + PAY4 + PAY7 need per-invariant pinning; ticket names PAY1..PAY5 only |
| INV-HW1..4, PR1..3 | `home-work.repository.test.ts`, `report.repository.test.ts`, `progress.repository.test.ts` (backend/db/test/repo/classes/), `test/workflows/classes/session-report-homework.journey.test.ts`, `tajweed-progress-increment.test.ts`, schema static assertions `backend/db/schema/classes/report-homework-schema.static-assertions.test.ts` | **PARTIAL** — no per-invariant mapping found; HW3/HW4 (first-session-vs-subsequent grading) unverified |
| INV-E1..E6 | `backend/services/teachers/student-evaluation.service.test.ts:350,832,964,1088` (4 describes incl. concurrent same-teacher submissions), `test/workflows/teachers/student-teacher-rating.journey.test.ts` (E4), `evaluation-rubric-scoring.journey.test.ts`; PR §1.3 refs INV-E2/E6 (`PRODUCTION_READINESS.md:61`) | **PARTIAL** — E1 CHECK (score 0-100) + E5 aggregation unverified in this slice |
| INV-PC1..PC3 | `backend/db/test/logic/billing/plan-catalog-preservation.test.ts:16` (INV-PC2, REQ-075), `plan-catalog.service.test.ts`, `plan-catalog.repository.test.ts`, `plan-catalog-schema.test.ts`, audit census `test/workflows/admin/audit-completeness.catalog.ts` | **PARTIAL/GAP at ticket level** — not enumerated by ticket or PR §5; needs scope ruling |

**Group-level tally (67 invariants): COVERED 12 (W×8, P×4) · PARTIAL 52 · GAP-at-ticket-level 3 (PC).**

## 4. Recommended tests for PARTIAL/GAP (what the new plan OWNS vs references)

Ownership rule (from sibling precedent): do not re-author tests owned by financial-safety (W, B4 double-spend, PAY2 trigger) or workflow_tests (P, B2/B3/B6 journeys) — cite them in an invariant→test registry and add only missing per-invariant probes. Registry pattern: machine-readable census + anti-drift static test (audit-trail precedent, plan.md:15 `backend/db/test/logic/audit/audit-census-drift.test.ts` + `test/workflows/admin/audit-completeness.catalog.ts:143`).

| ID(s) | Target test file (repo conventions) | Layer rules | Assertion approach | Fixtures |
|---|---|---|---|---|
| Registry + anti-drift | `test/workflows/…` or `backend/db/test/logic/` census module + drift test mirroring audit pattern | census in test layer; static bijection invariant-ID ↔ test-cite | Enumerate all 67 IDs; each row cites test path:line or "NEW"; drift test fails when an ID loses its cite or a test renames | n/a |
| S1/S2 | extend `backend/db/test/logic/classes/` (matrix probe) | runInRollback + tx | Raw guarded-UPDATE from `completed`/`cancelled` to every other status → zero rows / conflict; full SESSION_TRANSITION_MATRIX sweep asserting allowed pairs succeed | `createTestSession` |
| S4 | `backend/db/test/logic/classes/` | runInRollback | Raw INSERT with NULL teacher_id/student_id → 23502 NOT NULL violation (savepoint-bracketed, `expectRepoError` + `constraintNameOf` per finsafe tasks.md:77) | `createTestUser` ×2 |
| S5 | service tier denial (booking with `is_approved=false/null`) | runInRollback | `TEACHER_NOT_CERTIFIED`/`TEACHER_NOT_FOUND` denial; zero session rows | `createTestTeacherRow(overrides:{isApproved:false})` |
| TV7 | `backend/db/test/logic/teachers/` | runInRollback | Select `teacher_verification`-equivalent columns (verify actual table first — UNVERIFIED) | `createTestApplicant` |
| A3 | journey asserting `is_online=false` readable-truth during `started` | NO runInRollback; committed fixtures | Data-level only: locked teacher's flag is false at every started-moment (directory filter does not exist — cite milestone_2 specs.md:9) | `provisionCertifiedTeacherActor` |
| B3/B6 ratification | reference `subscription-expiry.journey.test.ts` + admin journeys | — | PR §5.3.3 stale-why fix + §5.3.6 check-off; no new test if journey covers | — |
| B7 | `backend/db/test/repo/students/student.repository.test.ts` extension | runInRollback + tx | Two grant attempts → second UPDATE matches zero rows → ConflictError; verify actual grant helper name first (UNVERIFIED in this slice) | `createTestStudent` |
| U4 | `backend/db/test/logic/users/` | runInRollback | Raw DELETE on users/students/teachers rows → blocked (trigger or FK restrict — verify mechanism first; UNVERIFIED whether a DELETE trigger exists on users) | `createTestUser` |
| PAY1/PAY4 | `backend/db/test/logic/billing/` extension | runInRollback | Savepoint probe: negative `amount` insert → CHECK; `payment_gateway` enum presence pin | `createTestStudentPayment` |
| PAY7 | reference `test/workflows/billing/paymob-purchase-journey.test.ts` (verify quarantine leg exists — UNVERIFIED) | journey | Mismatched amount callback → `{processed:false}`, zero mutation | paymob fixtures |
| HW3/HW4, E1, E5 | `backend/db/test/logic/classes/` + repo/service tiers | runInRollback | HW: first-session no-prior-homework rule at service; E1: score out-of-range → CHECK; E5: aggregation recomputation | `createTestSession`, `createTestHomeWork`, `createTestEvaluation` |
| PC1..PC3 | reference `plan-catalog-preservation.test.ts:16` + `setPlanActiveStatus` tests; add catalog-exclusion pin if missing | runInRollback | PC1: deactivated plan absent from purchasable set; PC3: raw DELETE on plans → blocked (verify guard; UNVERIFIED) | `createTestPlan` |

## 5. Fixture/helper needs (verified signatures, `backend/db/test/entity-setup.ts`)

| Helper | Line | Signature (verified) |
|---|---|---|
| createTestUser | :74 | async (tx, …) → UserSelectType |
| createTestStudent | :104 | async (tx, userId) → StudentSelectType |
| createTestParent | :131 | async (tx: DBTransaction, userId: number): Promise<ParentSelectType> |
| createTestApplicant | :143 | async (tx, …) → applicant row |
| createTestAdmin | :169 | async (tx: DBTransaction, userId: number): Promise<AdminSelectType> |
| createTestPlan | :180 | async (tx, …overrides) → PlanSelectType |
| createTestSubscription | :222 | async (tx: DBTransaction, userId: number, planId: number, overrides: Partial<SubscriptionSelectType> = {}): Promise<SubscriptionSelectType> |
| createTestStudentPayment | :264 | async (tx, …) |
| createTestSession | :303 | async (tx: DBTransaction, teacherId: number, studentId: number, overrides: Partial<SessionSelectType> = {}): Promise<SessionSelectType> |
| createTestSessionReport | :344 | async (tx, …) |
| createTestHomeWork | :376 | async (tx, …) |
| createTestLesson | :410 | async (tx, …) |
| createTestEvaluation | :440 | async (tx: DBTransaction, evaluatedId: number, evaluatorId: number, sessionId: number \| null, overrides: Partial<EvaluationSelectType> = {}): Promise<EvaluationSelectType> |
| createTestWallet | :478 | async (tx: DBTransaction, teacherId: number, overrides: Partial<WalletSelectType> = {}): Promise<WalletSelectType> |
| createTestTeacherTransaction | :514 | async (tx, …) |
| createTestTeacherRow | :550 | async (tx, …overrides) — use `overrides:{isApproved:…}` for INV-S5/A1 fixtures |

Probe utilities (finsafe precedent, tasks.md:77): `expectRepoError` + `constraintNameOf` at `backend/db/test/test-utils.ts:77,111`; trigger-tier gating `describeTriggerTier = isPgliteProvider() ? describe.skip : describe` (precedent `backend/db/test/logic/audit/audit-immutability.test.ts:418`); journey helpers `provisionStudentActor`/`provisionCertifiedTeacherActor`/`provisionAdminActor` (test/workflows/helpers/), `createJourneyCast` (`test/workflows/helpers/journey-fixtures.ts:251`), `buildSessionJourneyCast` (`test/workflows/helpers/session-cast.ts:280`) — helper-anchor lines from sibling tasks.md:107,124 (not re-verified).

## 6. Plan-structure conventions extracted from sibling plans

**Header block format (milestone_2 specs.md:3-13):** (1) `> **Plan directory (verbatim — every header, ledger path, task 0.1, and self-reference uses this exact string):** ai/plans/milestone_2/…` (:3); (2) `> **Ticket:** <title> — Owner/Milestone/SP/blocked-by + TICKETS.md anchor + "blocked-by ticket is **verified implemented**" note with code/doc proof (:4); (3) `> **Grounding docs:** path:line list (:5); (4) `> **⚠️ Load-bearing scope reconciliation (READ FIRST — shapes every section below).**` — per-Gherkin-line rulings each ending in a named REQ ruling + deferred pointers (:7-13). This dossier feeds exactly that block.

**Phase-0 ground-truth table (audit-trail specs.md:47-61):** heading `## ⚠️ Phase-0 Ground-Truth Verification (verify-then-claim, ruled against the live tree <date>)`; 5-col rows `| # | Item probed | Evidence | Result | Disposition |` (G-01..G-09); dispositions observed: `CONSUME`, `CONSUME as-is`, `VERIFY via journey`, `REMEDIATE (in scope)`, `DEFER (ledger D-3xx)`. REQ numbering: REQ-000 baseline, REQ-000.5 translation/enum compliance, core REQs in tens (REQ-010/020/030/031/040-043).

**Census + anti-drift pattern (audit-trail plan.md:15,124-166):** machine-readable census lives in the TEST layer (`test/workflows/admin/audit-completeness.catalog.ts:143` ADMIN_ACTION_CENSUS, `kind: "wired" | "deferred"` + `deferredRef`), static drift test asserts bijection census↔shipped surface (`backend/db/test/logic/audit/audit-census-drift.test.ts`), journey executes every wired row. Directly transferable: an INVARIANT_CENSUS (67 rows) + drift test binding each INV-ID to a test cite.

**Review-file formats (milestone_2 outcome/):** `plan-review-R1.md`: title `# Phase 1.5 Plan-Review — Round 1 (R1)`, verbatim plan dir, reviewed artifacts, method (three parallel review agents, ~150 anchors), date, "Governing rulings — RATIFIED", "Round-1 verdict" (sev-counted findings), "Fixes applied" table `| # | Sev | Finding | Fix applied |`, rejected reviewer claims, post-fix verification, final verdict + carry-overs (:1-57). `midpoint-review-R1.md`: scope, method (three parallel subagents backend/types/security), findings table with Disposition, fix round, verdict (:1-27). NOTE: sibling finished plans carry NO outcome/ dirs (only plan.md/specs/tasks.md each — verified by find); the milestone_2 live plan is the only full outcome/ exemplar.

## 7. "Blocked By: All Milestone 1–3 tickets" — spot-check (all CONFIRMED SHIPPED)

| Ticket (TICKETS.md anchor) | Shipped evidence (verified) |
|---|---|
| Fee Escrow: Hold at Request, Decrement at Completion (:1704) | `backend/db/schema/classes/session.ts:68-69` (`feeHeld`, `heldBalanceLane`); `docs/sessions/session-lifecycle.md:139-141` (guarded debit + same-lane refund); finished plan `ai/finished_plans/milestone_2_matching_notifications_escrow/fee_escrow_and_teacher_wallet_crediting-crediting/` |
| Subscription Purchase via Payment Gateway (:448) | `backend/services/billing/subscription-purchase.service.ts` + `subscription-activation.service.ts:21-91` (guarded-UPDATE docblock); `docs/billing/subscription-purchase.md:43-52` (INV-PAY2/3/6/7); finished plan `ai/finished_plans/milestone_1_core_domain_mvp/subscription-purchase-payment-gateway/` |
| 5-Session Evaluation Loop Booking (:719) | `backend/services/teachers/evaluation-booking.service.ts:56` (VERIFICATION_PLAN_SESSION_COUNT import), `:195` (derived remainingCredits); `docs/teachers/evaluation-loop-booking.md:73` (INV-TV2 rule); finished plan `ai/finished_plans/milestone_1_core_domain_mvp/5_session_evaluation_loop_booking/` |
| Audit Trail Completeness (:2837, M4 sibling) | census + drift test + journey all on disk (`test/workflows/admin/audit-completeness.*`) |

Blocked-by status is therefore sound: this ticket is a verification overlay over shipped machines.

## 8. Canonical docs inventory (INV ranges documented · names tests?)

| Doc | INV ranges documented | Names tests? |
|---|---|---|
| docs/sessions/session-lifecycle.md | S1-S8 per-invariant table :76-86; B1/B4/B8 :84; W3/W4 :85; U2/U5 :86; TV1 :87; S6 release semantics :89 | Yes (service/journey suites named throughout, e.g. :81-83,192) |
| docs/teachers/teacher-availability.md | A1-A4 :25-28,41,104-120,289-313 | Yes (:272 journey table) |
| docs/teachers/evaluation-loop-booking.md | TV2 :73; TV1/S5 analog :68 (in invariants doc) | Partial (booking invariants via invariants doc :68) |
| docs/billing/subscription-purchase.md | PAY2 :43, PAY3 :47, PAY6 :49, PAY7 :52; PAY4 :117; B2/B5 :62 | Partial (doc names suites in test-matrix section) |
| docs/billing/subscription-validity-window-expiry.md | B1-B8 header :15; B2 :44, B3 :47/:157/:168/:266, B4 :50, B6 :52 | Partial |
| docs/billing/admin-subscription-management.md | B6/B3 interplay :291-292 (admin cancel vs expiry zeroing asymmetry) | Yes (test table present) |
| docs/billing/admin-financial-auditing.md | W5 :31, W6 :34, W1 :37/:247 | Yes |
| docs/billing/financial-safety-verification.md | verified-invariants table :30-41 (W1/W2/W8, W3, W4, W5, W6, PAY2, B4, S2/S3-adjacent) with test path:line | **Yes — this is the model registry doc for the new plan** |
| docs/parents/monitoring-portal.md | P1/P2 :4,:17 | Yes |
| docs/parents/handshake-code-discovery.md | P1..P4 :4,:19,:231 (read-only binding) | Partial |
| docs/workflows/01-05 | no direct INV-* IDs found in this slice (grep clean) — they are narrative workflows | No |

## 9. Notes for the plan (scope risks, defects, ambiguities)

1. **Doc-supersedes-ticket ruling required** (§1 drift): verify 67 (incl. B7/B8, PAY6/PAY7, PC1-3) or ledger-defer PC with disposition — mirror milestone_2's reconciliation block.
2. **PRODUCTION_READINESS.md §5 (line 213) is the ticket's ratification surface**: §5.1/§5.2/§5.4/§5.5 rows ALL ☐ (unchecked) despite shipped tests — the plan should flip them with test cites. **Defect (stale):** §5.3.3 (:245) claims "no expiry surface exists this milestone" but `SubscriptionExpiryService.expireDue` shipped (invariants doc :161-175; `subscription-expiry.journey.test.ts` exists). §5 omits PAY/HW/PR/E/PC rows entirely.
3. **Non-duplication boundary:** financial-safety owns W1-W8 + PAY2 trigger + B4 double-spend + S2/S3 escrow legs (verified table `docs/billing/financial-safety-verification.md:30-41`); workflow_tests owns P1-P4 + B2/B3/B6 + PAY3/PAY6 journeys. New plan adds the per-invariant registry + only genuinely missing probes.
4. **Known enforcement hole (sibling ledger D1, finsafe tasks.md:172):** NO DB unique index prevents duplicate `earning` per `session_id` — guarded app-side only. An INV-W4 raw-SQL duplicate-earning probe would FAIL by design; the plan must scope INV-W4's uniqueness as app-tier or escalate as release-blocking defect, never paper over.
5. **Res finsafe deferred items** (tasks.md:173-174): D2 arbitration-complete consumes hold without wallet credit (rerouted); D4 schema-push-provisioned DBs lack the trigger tier — trigger-probe tests must keep `describeTriggerTier` gating.
6. **INV-A3 is untestable end-to-end** (no student-facing directory exists — milestone_2 specs.md:9 ruling): test data-level truthfulness only; cite the ruling.
7. **UNVERIFIED items for the enforcement-slice agents:** users DELETE guard for INV-U4 (no trigger found in my slice); TV7 storage table/columns; PAY7 quarantine leg in `paymob-purchase-journey.test.ts`; B7 grant helper name; PC3 plans DELETE guard.
8. Plan directory convention for THIS plan: `ai/plans/milestone_4/state_machine_invariant_verification/` (outcome/research/ already created; this dossier is `12-sibling-plans-canonical-docs.md`).
